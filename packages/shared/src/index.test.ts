import { describe, expect, it } from "vitest";
import {
  attackTargetHit,
  fighterHasArenaFloorSupport,
  firstArenaWallIntersection,
  isValidLobbyCode,
  knockbackForce,
  movementBlendFactor,
  normalizeLobbyCode,
  resolveArenaFloorMovement,
  resolvePredictedWalls,
  segmentCrossesArenaFloor,
  segmentCrossesArenaWall,
  sweepArenaWalls,
  TRAINING_MAX_KNOCKBACK,
  type TrainingHitMetrics,
  type TrainingLabSnapshot,
} from "./index";

describe("training lab contract", () => {
  it("exposes a bounded baseline and nullable last-hit metrics", () => {
    const metrics = {
      force: 24,
      launchAngleDegrees: 18,
      launchSpeed: 12,
      flightDistance: 8,
    } satisfies TrainingHitMetrics;
    const populated = {
      baselineKnockback: 100,
      lastHit: metrics,
    } satisfies TrainingLabSnapshot;
    const empty = {
      baselineKnockback: 0,
      lastHit: null,
    } satisfies TrainingLabSnapshot;

    expect(TRAINING_MAX_KNOCKBACK).toBe(200);
    expect(populated.lastHit).toEqual(metrics);
    expect(empty.lastHit).toBeNull();
  });
});

describe("knockbackForce", () => {
  it("grows smoothly and stays controlled", () => {
    expect(knockbackForce(80)).toBeGreaterThan(knockbackForce(20));
    expect(knockbackForce(400)).toBeLessThan(knockbackForce(80) * 1.6);
  });
  it("rewards a charged heavy punch", () => {
    expect(knockbackForce(50, 1)).toBeGreaterThan(knockbackForce(50));
    expect(knockbackForce(50, 1)).toBeLessThan(knockbackForce(50) * 1.8);
  });
  it("makes high damage meaningfully more dangerous", () => {
    expect(knockbackForce(100)).toBeGreaterThan(knockbackForce(0) * 2.3);
  });
});

describe("movement response", () => {
  it("accelerates decisively, brakes cleanly, and preserves dash momentum", () => {
    const accelerate = movementBlendFactor(1 / 30, true, false, true);
    const brake = movementBlendFactor(1 / 30, true, false, false);
    const dash = movementBlendFactor(1 / 30, true, true, true);
    expect(accelerate).toBeGreaterThan(0.4);
    expect(brake).toBeGreaterThan(accelerate);
    expect(dash).toBeLessThan(0.1);
  });
});

describe("lobby codes", () => {
  it("normalizes shareable codes and rejects incomplete values", () => {
    expect(normalizeLobbyCode(" ab-c12! ")).toBe("ABC12");
    expect(isValidLobbyCode("ABC12")).toBe(true);
    expect(isValidLobbyCode("A1")).toBe(false);
  });
});

describe("arena line of sight", () => {
  it("detects an internal wall and allows a clear punch lane", () => {
    expect(
      segmentCrossesArenaWall(
        { x: -7.5, y: 1.1, z: 0 },
        { x: -10.5, y: 1.1, z: 0 },
      ),
    ).toBe(true);
    expect(
      segmentCrossesArenaWall({ x: 0, y: 1.1, z: 0 }, { x: 0, y: 1.1, z: -3 }),
    ).toBe(false);
  });

  it("uses the visible wall height for sloped and overhead punch lanes", () => {
    expect(
      segmentCrossesArenaWall(
        { x: 0, y: 1.1, z: -7.5 },
        { x: 0, y: 3.9, z: -10.5 },
      ),
    ).toBe(true);
    expect(
      segmentCrossesArenaWall(
        { x: 0, y: 2.5, z: -7.5 },
        { x: 0, y: 2.5, z: -10.5 },
      ),
    ).toBe(false);
  });

  it("treats the liked floating floor as solid for punch line of sight", () => {
    expect(
      segmentCrossesArenaFloor(
        { x: 0, y: -2.5, z: 0 },
        { x: 0, y: 1.1, z: 0 },
        0.38,
      ),
    ).toBe(true);
    expect(
      segmentCrossesArenaFloor(
        { x: 0, y: 1.1, z: 0 },
        { x: 0, y: 3.5, z: 0 },
        0.38,
      ),
    ).toBe(false);
  });
});

describe("arena movement hitboxes", () => {
  it("keeps the circular fighter footprint supported at straight and corner edges", () => {
    expect(fighterHasArenaFloorSupport({ x: 15.54, z: 0 })).toBe(true);
    expect(fighterHasArenaFloorSupport({ x: 15.56, z: 0 })).toBe(false);
    expect(fighterHasArenaFloorSupport({ x: 15.38, z: 15.38 })).toBe(true);
    expect(fighterHasArenaFloorSupport({ x: 15.4, z: 15.4 })).toBe(false);
  });

  it("resolves the visible floor top, side and underside as one solid box", () => {
    const edgeLanding = resolveArenaFloorMovement(
      { x: 15.3, y: 1.1, z: 0 },
      { x: 15.38, y: 1.04, z: 0 },
    );
    expect(edgeLanding.position.y).toBe(1.1);
    expect(edgeLanding.contact?.grounded).toBe(true);

    const sideDash = resolveArenaFloorMovement(
      { x: 15.7, y: 0.9, z: 0 },
      { x: 15.2, y: 0.95, z: 0 },
    );
    expect(sideDash.position.x).toBeCloseTo(15.55);
    expect(sideDash.contact?.normal).toMatchObject({ x: 1, y: 0, z: 0 });

    const underside = resolveArenaFloorMovement(
      { x: 0, y: -3, z: 0 },
      { x: 0, y: -2.8, z: 0 },
    );
    expect(underside.position.y).toBeCloseTo(-2.9);
    expect(underside.contact?.normal.y).toBe(-1);
  });

  it("rounds player contact around a visible wall corner", () => {
    const clear = { x: -7.9, y: 1.1, z: 4 };
    expect(resolvePredictedWalls(clear)).toEqual(clear);
    const colliding = { x: -7.9, y: 1.1, z: 3.7 };
    const resolved = resolvePredictedWalls(colliding);
    expect(resolved).not.toEqual(colliding);
    expect(Math.hypot(resolved.x + 8.4, resolved.z - 3.5)).toBeCloseTo(0.55);
  });

  it("sweeps extreme movement without tunneling and slides along walls", () => {
    const hit = sweepArenaWalls(
      { x: -7, y: 1.1, z: 0 },
      { x: -12, y: 1.1, z: 2 },
    );
    expect(hit.contact?.wall.id).toBe("west");
    expect(hit.position.x).toBeCloseTo(-7.85);
    expect(hit.position.z).toBeGreaterThan(0);
  });

  it("does not extend internal wall hitboxes below the floating arena", () => {
    const falling = { x: -9, y: -1.2, z: 0 };
    expect(resolvePredictedWalls(falling)).toEqual(falling);
  });

  it("keeps swept punch corners radial instead of invisibly square", () => {
    const nearCorner = { x: -8.1, y: 1.1, z: 3.8 };
    expect(
      firstArenaWallIntersection(nearCorner, nearCorner, 0.38),
    ).toBeUndefined();
  });
});

describe("3D punch hitbox", () => {
  it("never wraps a point-blank punch behind or sideways", () => {
    const attacker = { x: 0, y: 1.1, z: 0 };
    expect(
      attackTargetHit(attacker, { x: 0, y: 1.1, z: -1.1 }, 0, 0, "light"),
    ).toBeDefined();
    expect(
      attackTargetHit(attacker, { x: 0, y: 1.1, z: 1.1 }, 0, 0, "light"),
    ).toBeUndefined();
    expect(
      attackTargetHit(attacker, { x: 1.1, y: 1.1, z: 0 }, 0, 0, "light"),
    ).toBeUndefined();
  });

  it("follows camera pitch instead of a tall invisible 2D slab", () => {
    const attacker = { x: 0, y: 1.1, z: 0 };
    const airborneTarget = { x: 0, y: 3.6, z: -2.5 };
    expect(
      attackTargetHit(attacker, airborneTarget, 0, 0, "light"),
    ).toBeUndefined();
    expect(
      attackTargetHit(attacker, airborneTarget, 0, 0.68, "light"),
    ).toBeDefined();
  });

  it("keeps a centered target reachable at normal boxing distance", () => {
    expect(
      attackTargetHit(
        { x: 0, y: 1.1, z: 0 },
        { x: 0, y: 1.1, z: -3.45 },
        0,
        0,
        "light",
      ),
    ).toBeDefined();
  });

  it("gives the visible charged heavy sweep a small range bonus", () => {
    const attacker = { x: 0, y: 1.1, z: 0 };
    const target = { x: 0, y: 1.1, z: -4 };
    expect(attackTargetHit(attacker, target, 0, 0, "light")).toBeUndefined();
    expect(attackTargetHit(attacker, target, 0, 0, "heavy")).toBeDefined();
  });

  it("reports the first visible hurtbox surface as the hit point", () => {
    const hit = attackTargetHit(
      { x: 0, y: 1.1, z: 0 },
      { x: 0, y: 1.1, z: -2 },
      0,
      0,
      "light",
    );
    expect(hit?.point.z).toBeCloseTo(-1.28, 2);
    expect(hit?.point.y).toBeCloseTo(1.75, 2);
  });
});
