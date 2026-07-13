const ORIGIN_ENV_KEYS = [
  "CLIENT_ORIGIN",
  "PUBLIC_BASE_URL",
  "PUBLIC_URL",
  "RENDER_EXTERNAL_URL",
] as const;

const MAX_RATE_LIMIT_KEY_LENGTH = 256;

export type SecurityEnvironment = Partial<
  Record<
    (typeof ORIGIN_ENV_KEYS)[number] | "NODE_ENV" | "ALLOW_MISSING_WS_ORIGIN",
    string
  >
>;

export type OriginPolicy = {
  allowedOrigins: ReadonlySet<string>;
  allowMissingOrigin: boolean;
  allowSameOrigin: boolean;
};

export type OriginRequest = {
  origin?: string;
  host?: string;
  forwardedProto?: string;
  encrypted?: boolean;
};

function normalizedOrigin(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
    if (parsed.username || parsed.password) return;
    return parsed.origin.toLowerCase();
  } catch {
    return;
  }
}

function configuredOrigins(value: string | undefined, key: string): string[] {
  if (!value?.trim()) return [];
  return value.split(",").map((candidate) => {
    const origin = normalizedOrigin(candidate.trim());
    if (!origin || candidate.trim() === "*")
      throw new Error(`${key} contains an invalid or unsafe origin`);
    return origin;
  });
}

/** Builds an exact-origin policy. Production rejects non-browser clients by default. */
export function createOriginPolicy(env: SecurityEnvironment): OriginPolicy {
  const allowedOrigins = new Set<string>();
  for (const key of ORIGIN_ENV_KEYS)
    for (const origin of configuredOrigins(env[key], key))
      allowedOrigins.add(origin);

  return {
    allowedOrigins,
    allowMissingOrigin:
      env.ALLOW_MISSING_WS_ORIGIN === "true" || env.NODE_ENV !== "production",
    allowSameOrigin: true,
  };
}

function requestOrigin(request: OriginRequest): string | undefined {
  if (!request.host) return;
  const forwardedProto = request.forwardedProto?.split(",", 1)[0]?.trim();
  const protocol =
    forwardedProto === "http" || forwardedProto === "https"
      ? forwardedProto
      : request.encrypted
        ? "https"
        : "http";
  return normalizedOrigin(`${protocol}://${request.host}`);
}

/** Exact allowlist plus reverse-proxy-aware same-origin validation for WebSocket upgrades. */
export function isWebSocketOriginAllowed(
  request: OriginRequest,
  policy: OriginPolicy,
): boolean {
  if (!request.origin) return policy.allowMissingOrigin;
  if (request.origin === "null") return false;
  const origin = normalizedOrigin(request.origin);
  if (!origin) return false;
  if (policy.allowedOrigins.has(origin)) return true;
  return policy.allowSameOrigin && origin === requestOrigin(request);
}

export type TokenBucketOptions = {
  capacity: number;
  refillPerSecond: number;
  idleTtlMs: number;
  maxEntries: number;
  pruneIntervalMs?: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  reason?: "invalid-key" | "invalid-cost" | "rate-limited";
};

type Bucket = {
  tokens: number;
  lastRefillAt: number;
  lastSeenAt: number;
};

function assertIntegerInRange(
  name: string,
  value: number,
  minimum: number,
  maximum: number,
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new RangeError(
      `${name} must be an integer from ${minimum} to ${maximum}`,
    );
}

function assertFiniteInRange(
  name: string,
  value: number,
  minimum: number,
  maximum: number,
): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum)
    throw new RangeError(`${name} must be from ${minimum} to ${maximum}`);
}

/**
 * Allocation-bounded token bucket. Callers supply a trusted, compact identity
 * such as a normalized remote address or an internal socket/player id.
 */
export class TokenBucketLimiter {
  readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly idleTtlMs: number;
  private readonly maxEntries: number;
  private readonly pruneIntervalMs: number;
  private readonly buckets = new Map<string, Bucket>();
  private nextPruneAt = 0;

  constructor(options: TokenBucketOptions) {
    assertIntegerInRange("capacity", options.capacity, 1, 1_000_000);
    assertFiniteInRange(
      "refillPerSecond",
      options.refillPerSecond,
      0.001,
      1_000_000,
    );
    assertIntegerInRange("idleTtlMs", options.idleTtlMs, 1_000, 86_400_000);
    assertIntegerInRange("maxEntries", options.maxEntries, 1, 1_000_000);
    const pruneIntervalMs =
      options.pruneIntervalMs ?? Math.min(60_000, options.idleTtlMs);
    assertIntegerInRange(
      "pruneIntervalMs",
      pruneIntervalMs,
      250,
      options.idleTtlMs,
    );

    this.capacity = options.capacity;
    this.refillPerMs = options.refillPerSecond / 1_000;
    this.idleTtlMs = options.idleTtlMs;
    this.maxEntries = options.maxEntries;
    this.pruneIntervalMs = pruneIntervalMs;
  }

  consume(key: string, cost = 1, now = Date.now()): RateLimitDecision {
    if (!key || key.length > MAX_RATE_LIMIT_KEY_LENGTH)
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: this.idleTtlMs,
        reason: "invalid-key",
      };
    if (!Number.isSafeInteger(cost) || cost < 1 || cost > this.capacity)
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: this.idleTtlMs,
        reason: "invalid-cost",
      };
    const safeNow = Number.isFinite(now) ? Math.max(0, now) : Date.now();
    if (safeNow >= this.nextPruneAt || this.buckets.size >= this.maxEntries)
      this.prune(safeNow);

    let bucket = this.buckets.get(key);
    if (!bucket) {
      this.makeCapacityForOne();
      bucket = {
        tokens: this.capacity,
        lastRefillAt: safeNow,
        lastSeenAt: safeNow,
      };
      this.buckets.set(key, bucket);
    }

    const effectiveNow = Math.max(safeNow, bucket.lastRefillAt);
    bucket.tokens = Math.min(
      this.capacity,
      bucket.tokens + (effectiveNow - bucket.lastRefillAt) * this.refillPerMs,
    );
    bucket.lastRefillAt = effectiveNow;
    bucket.lastSeenAt = effectiveNow;

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        retryAfterMs: 0,
      };
    }
    return {
      allowed: false,
      remaining: Math.floor(bucket.tokens),
      retryAfterMs: Math.max(
        1,
        Math.ceil((cost - bucket.tokens) / this.refillPerMs),
      ),
      reason: "rate-limited",
    };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  clear(): void {
    this.buckets.clear();
    this.nextPruneAt = 0;
  }

  prune(now = Date.now()): number {
    const safeNow = Number.isFinite(now) ? Math.max(0, now) : Date.now();
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      if (safeNow - bucket.lastSeenAt < this.idleTtlMs) continue;
      this.buckets.delete(key);
      removed++;
    }
    this.nextPruneAt = safeNow + this.pruneIntervalMs;
    return removed;
  }

  get size(): number {
    return this.buckets.size;
  }

  private makeCapacityForOne(): void {
    if (this.buckets.size < this.maxEntries) return;
    let oldestKey: string | undefined;
    let oldestSeenAt = Number.POSITIVE_INFINITY;
    for (const [key, bucket] of this.buckets)
      if (bucket.lastSeenAt < oldestSeenAt) {
        oldestKey = key;
        oldestSeenAt = bucket.lastSeenAt;
      }
    if (oldestKey !== undefined) this.buckets.delete(oldestKey);
  }
}

export type ConcurrentConnectionOptions = {
  maxPerKey: number;
  maxTotal: number;
};

export type ConnectionLimitDecision = {
  allowed: boolean;
  activeForKey: number;
  activeTotal: number;
  reason?: "invalid-key" | "per-key-limit" | "total-limit";
};

/** Tracks live connections separately from the connection-attempt token bucket. */
export class ConcurrentConnectionLimiter {
  private readonly maxPerKey: number;
  private readonly maxTotal: number;
  private readonly counts = new Map<string, number>();
  private total = 0;

  constructor(options: ConcurrentConnectionOptions) {
    assertIntegerInRange("maxPerKey", options.maxPerKey, 1, 10_000);
    assertIntegerInRange(
      "maxTotal",
      options.maxTotal,
      options.maxPerKey,
      1_000_000,
    );
    this.maxPerKey = options.maxPerKey;
    this.maxTotal = options.maxTotal;
  }

  acquire(key: string): ConnectionLimitDecision {
    if (!key || key.length > MAX_RATE_LIMIT_KEY_LENGTH)
      return {
        allowed: false,
        activeForKey: 0,
        activeTotal: this.total,
        reason: "invalid-key",
      };
    const activeForKey = this.counts.get(key) ?? 0;
    if (activeForKey >= this.maxPerKey)
      return {
        allowed: false,
        activeForKey,
        activeTotal: this.total,
        reason: "per-key-limit",
      };
    if (this.total >= this.maxTotal)
      return {
        allowed: false,
        activeForKey,
        activeTotal: this.total,
        reason: "total-limit",
      };
    this.counts.set(key, activeForKey + 1);
    this.total++;
    return {
      allowed: true,
      activeForKey: activeForKey + 1,
      activeTotal: this.total,
    };
  }

  release(key: string): void {
    const activeForKey = this.counts.get(key) ?? 0;
    if (activeForKey <= 0) return;
    if (activeForKey === 1) this.counts.delete(key);
    else this.counts.set(key, activeForKey - 1);
    this.total--;
  }

  clear(): void {
    this.counts.clear();
    this.total = 0;
  }

  get activeTotal(): number {
    return this.total;
  }

  activeFor(key: string): number {
    return this.counts.get(key) ?? 0;
  }
}

export type IngressRateLimiters = {
  connection: TokenBucketLimiter;
  join: TokenBucketLimiter;
  message: TokenBucketLimiter;
  input: TokenBucketLimiter;
};

const DEFAULT_LIMITS = {
  connection: {
    capacity: 16,
    refillPerSecond: 0.5,
    idleTtlMs: 10 * 60_000,
    maxEntries: 10_000,
  },
  join: {
    capacity: 12,
    refillPerSecond: 0.2,
    idleTtlMs: 10 * 60_000,
    maxEntries: 10_000,
  },
  message: {
    capacity: 180,
    refillPerSecond: 90,
    idleTtlMs: 2 * 60_000,
    maxEntries: 10_000,
  },
  input: {
    capacity: 90,
    refillPerSecond: 45,
    idleTtlMs: 2 * 60_000,
    maxEntries: 10_000,
  },
} satisfies Record<keyof IngressRateLimiters, TokenBucketOptions>;

export function createIngressRateLimiters(
  overrides: Partial<
    Record<keyof IngressRateLimiters, Partial<TokenBucketOptions>>
  > = {},
): IngressRateLimiters {
  return {
    connection: new TokenBucketLimiter({
      ...DEFAULT_LIMITS.connection,
      ...overrides.connection,
    }),
    join: new TokenBucketLimiter({ ...DEFAULT_LIMITS.join, ...overrides.join }),
    message: new TokenBucketLimiter({
      ...DEFAULT_LIMITS.message,
      ...overrides.message,
    }),
    input: new TokenBucketLimiter({
      ...DEFAULT_LIMITS.input,
      ...overrides.input,
    }),
  };
}

export type BackpressurePriority = "snapshot" | "realtime" | "critical";
export type BackpressureAction = "send" | "drop" | "close";
export type BackpressureLimits = { softBytes: number; hardBytes: number };

export const DEFAULT_BACKPRESSURE_LIMITS: BackpressureLimits = {
  softBytes: 256 * 1024,
  hardBytes: 1024 * 1024,
};

/** Drops disposable snapshots first and closes sockets whose queue is unsafe. */
export function decideBackpressure(
  bufferedAmount: number,
  priority: BackpressurePriority = "realtime",
  limits: BackpressureLimits = DEFAULT_BACKPRESSURE_LIMITS,
): BackpressureAction {
  if (
    !Number.isSafeInteger(limits.softBytes) ||
    !Number.isSafeInteger(limits.hardBytes) ||
    limits.softBytes < 0 ||
    limits.hardBytes <= limits.softBytes
  )
    throw new RangeError("backpressure limits must be increasing byte counts");
  if (!Number.isFinite(bufferedAmount) || bufferedAmount < 0) return "close";
  if (bufferedAmount >= limits.hardBytes) return "close";
  if (bufferedAmount >= limits.softBytes && priority === "snapshot")
    return "drop";
  return "send";
}
