import { describe, expect, it } from "vitest";
import {
  ConcurrentConnectionLimiter,
  TokenBucketLimiter,
  createIngressRateLimiters,
  createOriginPolicy,
  decideBackpressure,
  isWebSocketOriginAllowed,
} from "./security.js";

describe("WebSocket origin policy", () => {
  it("accepts configured origins and reverse-proxy same-origin upgrades", () => {
    const policy = createOriginPolicy({
      NODE_ENV: "production",
      CLIENT_ORIGIN: "https://play.example, https://party.example:8443/path",
      PUBLIC_BASE_URL: "https://public.example/invite",
    });
    expect(policy.allowedOrigins).toEqual(
      new Set([
        "https://play.example",
        "https://party.example:8443",
        "https://public.example",
      ]),
    );
    expect(
      isWebSocketOriginAllowed(
        {
          origin: "https://arena.example",
          host: "arena.example",
          forwardedProto: "https",
        },
        policy,
      ),
    ).toBe(true);
    expect(
      isWebSocketOriginAllowed(
        { origin: "https://play.example", host: "arena.example" },
        policy,
      ),
    ).toBe(true);
  });

  it("rejects cross-origin, opaque, wrong-scheme, and missing production origins", () => {
    const policy = createOriginPolicy({ NODE_ENV: "production" });
    expect(
      isWebSocketOriginAllowed(
        { origin: "https://evil.example", host: "arena.example" },
        policy,
      ),
    ).toBe(false);
    expect(
      isWebSocketOriginAllowed(
        { origin: "https://arena.example", host: "arena.example" },
        policy,
      ),
    ).toBe(false);
    expect(
      isWebSocketOriginAllowed(
        { origin: "null", host: "arena.example" },
        policy,
      ),
    ).toBe(false);
    expect(isWebSocketOriginAllowed({ host: "arena.example" }, policy)).toBe(
      false,
    );
  });

  it("permits origin-less development clients only under the explicit policy", () => {
    expect(
      isWebSocketOriginAllowed(
        { host: "localhost:2567" },
        createOriginPolicy({ NODE_ENV: "development" }),
      ),
    ).toBe(true);
    expect(
      createOriginPolicy({
        NODE_ENV: "production",
        ALLOW_MISSING_WS_ORIGIN: "true",
      }).allowMissingOrigin,
    ).toBe(true);
  });

  it("fails closed on wildcard or malformed configured origins", () => {
    expect(() =>
      createOriginPolicy({ NODE_ENV: "production", CLIENT_ORIGIN: "*" }),
    ).toThrow(/unsafe origin/);
    expect(() =>
      createOriginPolicy({
        NODE_ENV: "production",
        PUBLIC_BASE_URL: "javascript:alert(1)",
      }),
    ).toThrow(/invalid/);
  });
});

const limiter = (overrides = {}) =>
  new TokenBucketLimiter({
    capacity: 3,
    refillPerSecond: 2,
    idleTtlMs: 2_000,
    maxEntries: 3,
    pruneIntervalMs: 250,
    ...overrides,
  });

describe("TokenBucketLimiter", () => {
  it("limits bursts and returns a precise retry delay before refilling", () => {
    const gate = limiter();
    expect(gate.consume("socket-a", 1, 1_000)).toMatchObject({
      allowed: true,
      remaining: 2,
    });
    expect(gate.consume("socket-a", 2, 1_000)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(gate.consume("socket-a", 1, 1_100)).toMatchObject({
      allowed: false,
      retryAfterMs: 400,
      reason: "rate-limited",
    });
    expect(gate.consume("socket-a", 1, 1_500)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
  });

  it("does not mint tokens when a caller supplies a backwards clock", () => {
    const gate = limiter();
    expect(gate.consume("socket-a", 3, 5_000).allowed).toBe(true);
    expect(gate.consume("socket-a", 1, 4_000)).toMatchObject({
      allowed: false,
      retryAfterMs: 500,
    });
  });

  it("rejects abusive identities and costs without allocating state", () => {
    const gate = limiter();
    expect(gate.consume("", 1, 0).reason).toBe("invalid-key");
    expect(gate.consume("x".repeat(257), 1, 0).reason).toBe("invalid-key");
    expect(gate.consume("socket", 4, 0).reason).toBe("invalid-cost");
    expect(gate.size).toBe(0);
  });

  it("prunes idle identities and remains allocation-bounded", () => {
    const gate = limiter();
    gate.consume("one", 1, 0);
    gate.consume("two", 1, 1);
    gate.consume("three", 1, 2);
    gate.consume("four", 1, 3);
    expect(gate.size).toBe(3);
    expect(gate.consume("one", 1, 3).remaining).toBe(2);
    expect(gate.prune(2_005)).toBe(3);
    expect(gate.size).toBe(0);
  });

  it("validates resource bounds at construction", () => {
    expect(() => limiter({ capacity: 0 })).toThrow(/capacity/);
    expect(() => limiter({ maxEntries: Number.POSITIVE_INFINITY })).toThrow(
      /maxEntries/,
    );
    expect(() => limiter({ pruneIntervalMs: 2_001 })).toThrow(/pruneInterval/);
  });

  it("creates independent gates sized for connection, join, message, and input", () => {
    const gates = createIngressRateLimiters({
      input: { capacity: 2, refillPerSecond: 1 },
    });
    expect(gates.input.consume("player", 2, 0).allowed).toBe(true);
    expect(gates.input.consume("player", 1, 0).allowed).toBe(false);
    expect(gates.message.consume("player", 1, 0).allowed).toBe(true);
    expect(gates.connection.consume("ip", 1, 0).allowed).toBe(true);
    expect(gates.join.consume("ip", 1, 0).allowed).toBe(true);
    gates.message.clear();
    expect(gates.message.size).toBe(0);
  });
});

describe("ConcurrentConnectionLimiter", () => {
  it("caps live connections per identity and releases them idempotently", () => {
    const gate = new ConcurrentConnectionLimiter({ maxPerKey: 2, maxTotal: 3 });
    expect(gate.acquire("ip-a")).toMatchObject({
      allowed: true,
      activeForKey: 1,
      activeTotal: 1,
    });
    expect(gate.acquire("ip-a").allowed).toBe(true);
    expect(gate.acquire("ip-a").reason).toBe("per-key-limit");
    expect(gate.acquire("ip-b").allowed).toBe(true);
    expect(gate.acquire("ip-c").reason).toBe("total-limit");
    gate.release("ip-a");
    gate.release("unknown");
    expect(gate.activeFor("ip-a")).toBe(1);
    expect(gate.activeTotal).toBe(2);
    expect(gate.acquire("ip-c").allowed).toBe(true);
    gate.clear();
    expect(gate.activeTotal).toBe(0);
  });

  it("validates limits and rejects malformed identities without allocation", () => {
    expect(
      new ConcurrentConnectionLimiter({ maxPerKey: 2, maxTotal: 3 }).acquire(
        "x".repeat(257),
      ).reason,
    ).toBe("invalid-key");
    expect(
      () => new ConcurrentConnectionLimiter({ maxPerKey: 0, maxTotal: 3 }),
    ).toThrow(/maxPerKey/);
    expect(
      () => new ConcurrentConnectionLimiter({ maxPerKey: 4, maxTotal: 3 }),
    ).toThrow(/maxTotal/);
  });
});

describe("slow-client backpressure", () => {
  const limits = { softBytes: 100, hardBytes: 200 };

  it("sends normally, drops disposable snapshots first, and closes at hard limit", () => {
    expect(decideBackpressure(99, "snapshot", limits)).toBe("send");
    expect(decideBackpressure(100, "snapshot", limits)).toBe("drop");
    expect(decideBackpressure(100, "critical", limits)).toBe("send");
    expect(decideBackpressure(200, "critical", limits)).toBe("close");
    expect(decideBackpressure(Number.NaN, "realtime", limits)).toBe("close");
  });

  it("rejects misordered byte thresholds", () => {
    expect(() =>
      decideBackpressure(0, "snapshot", { softBytes: 200, hardBytes: 100 }),
    ).toThrow(/increasing/);
  });
});
