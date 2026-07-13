import { describe, expect, it } from "vitest";
import {
  ARENA_FLOOR_BOTTOM,
  ARENA_FLOOR_TOP,
  GAME,
  PLAYER_HALF_HEIGHT,
  PLAYER_RADIUS,
} from "@knockout/shared";
import {
  botNavigationTarget,
  consumeHeavyCharge,
  createPlayer,
  creditKnockout,
  performAttack,
  respawn,
  resolvePlayerCollisions,
  stepPlayer,
} from "./simulation.js";

const penetratesFloorSlab = (player: ReturnType<typeof createPlayer>) => {
  const outsideX = Math.max(
    0,
    Math.abs(player.position.x) - GAME.arenaHalfSize,
  );
  const outsideZ = Math.max(
    0,
    Math.abs(player.position.z) - GAME.arenaHalfSize,
  );
  const horizontalOverlap =
    outsideX * outsideX + outsideZ * outsideZ <
    PLAYER_RADIUS * PLAYER_RADIUS - 1e-6;
  const verticalOverlap =
    player.position.y + PLAYER_HALF_HEIGHT > ARENA_FLOOR_BOTTOM + 1e-6 &&
    player.position.y - PLAYER_HALF_HEIGHT < ARENA_FLOOR_TOP - 1e-6;
  return horizontalOverlap && verticalOverlap;
};

describe("authoritative combat simulation", () => {
  it("fully clears knockback on every respawn", () => {
    const player = createPlayer("a", "Alpha", 0);
    player.knockback = 147;
    respawn(player, 0, 2_000);
    expect(player.knockback).toBe(0);
  });

  it("makes block and heavy charge mutually exclusive", () => {
    const player = createPlayer("a", "Alpha", 0);
    player.input.blocking = true;
    player.input.charging = true;
    stepPlayer(player, 1 / 30, 1_000);
    expect(player.blocking).toBe(false);
    expect(player.charging).toBe(false);
  });

  it("limits block hold time and validates heavy charge on the server", () => {
    const player = createPlayer("a", "Alpha", 0);
    player.input.blocking = true;
    stepPlayer(player, 1 / 30, 1_000);
    expect(player.blocking).toBe(true);
    stepPlayer(player, 1 / 30, 1_000 + GAME.blockMaxHoldMs);
    expect(player.blocking).toBe(false);

    player.input.blocking = false;
    player.input.charging = true;
    stepPlayer(player, 1 / 30, 3_000);
    expect(player.charging).toBe(true);
    expect(consumeHeavyCharge(player, 1, 4_100)).toBe(1);
    expect(player.charging).toBe(false);
  });

  it("applies a valid hit and scales knockback", () => {
    const attacker = createPlayer("a", "Alpha", 0);
    const victim = createPlayer("b", "Bravo", 0);
    attacker.position = { x: 0, y: 1.1, z: 0 };
    victim.position = { x: 0, y: 1.1, z: -2 };
    attacker.protectionUntil = 0;
    victim.protectionUntil = 0;
    const hit = performAttack(
      attacker,
      [attacker, victim],
      "light",
      0,
      0,
      1_000,
    );
    expect(hit?.victim.id).toBe("b");
    expect(victim.knockback).toBe(10);
    expect(victim.velocity.z).toBeLessThan(0);
  });

  it("rewards a precisely timed parry", () => {
    const attacker = createPlayer("a", "Alpha", 0);
    const victim = createPlayer("b", "Bravo", 0);
    attacker.position = { x: 0, y: 1.1, z: 0 };
    victim.position = { x: 0, y: 1.1, z: -2 };
    attacker.protectionUntil = 0;
    victim.protectionUntil = 0;
    victim.blocking = true;
    victim.blockStarted = 900;
    const hit = performAttack(
      attacker,
      [attacker, victim],
      "heavy",
      1,
      0,
      1_000,
    );
    expect(hit?.parried).toBe(true);
    expect(victim.knockback).toBeLessThan(3);
  });

  it("makes a held block absorb most damage and launch force", () => {
    const attacker = createPlayer("a", "Alpha", 0),
      victim = createPlayer("b", "Bravo", 0);
    attacker.position = { x: 0, y: 1.1, z: 0 };
    victim.position = { x: 0, y: 1.1, z: -2 };
    attacker.protectionUntil = 0;
    victim.protectionUntil = 0;
    victim.blocking = true;
    victim.blockStarted = 0;
    const hit = performAttack(
      attacker,
      [attacker, victim],
      "light",
      0,
      0,
      1_000,
    );
    expect(hit?.blocked).toBe(true);
    expect(hit?.parried).toBe(false);
    expect(victim.knockback).toBeLessThan(2);
    expect(Math.abs(victim.velocity.z)).toBeLessThan(2);
  });

  it("detects a fall below the knockout zone", () => {
    const player = createPlayer("a", "Alpha", 0);
    player.position = { x: 20, y: -8.9, z: 0 };
    player.velocity.y = -4;
    expect(stepPlayer(player, 0.1, 2_000).knockedOut).toBe(true);
  });

  it("does not let an air dash enter through the underside edge", () => {
    const player = createPlayer("a", "Alpha", 0);
    player.position = { x: 15.2, y: 0.9, z: 0 };
    player.velocity = { x: 0, y: 0.8, z: 0 };
    player.grounded = false;
    player.airRecoveryAvailable = true;
    player.input = { ...player.input, moveX: -1, dash: true };
    stepPlayer(player, 0.1, 2_000);
    expect(player.position.x).toBeGreaterThanOrEqual(
      GAME.arenaHalfSize + 0.55 - 0.001,
    );
    expect(player.position.y).toBeLessThan(1.1);
    expect(player.velocity.x).toBeGreaterThanOrEqual(-0.001);
    expect(player.grounded).toBe(false);
  });

  it("keeps edge support until the circular fighter footprint clears the floor", () => {
    const player = createPlayer("a", "Alpha", 0);
    player.position = { x: GAME.arenaHalfSize + 0.35, y: 1.1, z: 0 };
    player.velocity = { x: 0, y: 0, z: 0 };
    stepPlayer(player, 1 / 30, 2_000);
    expect(player.position.y).toBe(1.1);
    expect(player.grounded).toBe(true);

    player.position = { x: GAME.arenaHalfSize + 0.56, y: 1.1, z: 0 };
    stepPlayer(player, 1 / 30, 2_100);
    expect(player.position.x).toBeGreaterThan(GAME.arenaHalfSize);
    expect(player.grounded).toBe(false);
    expect(player.position.y).toBeLessThan(1.1);
  });

  it("blocks an under-edge air dash from entering the solid floor slab", () => {
    const player = createPlayer("a", "Alpha", 0);
    player.position = { x: 15.7, y: 0.9, z: 0 };
    player.velocity = { x: -18, y: 0.8, z: 0 };
    player.grounded = false;
    player.input = { ...player.input, moveX: -1 };
    stepPlayer(player, 0.1, 2_000);
    expect(player.position.x).toBeGreaterThanOrEqual(
      GAME.arenaHalfSize + 0.55 - 0.001,
    );
    expect(player.position.y - PLAYER_HALF_HEIGHT).toBeLessThan(0);
    expect(player.grounded).toBe(false);
  });

  it("never penetrates the floor slab across high-speed edge and corner cases", () => {
    const cases = [
      {
        position: { x: 14.95, y: 1.1, z: 0 },
        velocity: { x: 120, y: 0, z: 0 },
      },
      {
        position: { x: 0, y: 1.1, z: -14.95 },
        velocity: { x: 0, y: 0, z: -120 },
      },
      {
        position: { x: 14.8, y: 1.1, z: 14.8 },
        velocity: { x: 90, y: 0, z: 90 },
      },
      {
        position: { x: 15.7, y: 0.9, z: 0 },
        velocity: { x: -120, y: 1, z: 0 },
      },
      {
        position: { x: -15.7, y: -2.6, z: 0 },
        velocity: { x: 120, y: 8, z: 0 },
      },
    ];
    for (const [index, scenario] of cases.entries()) {
      const player = createPlayer(`edge-${index}`, "Edge", 0);
      player.position = { ...scenario.position };
      player.velocity = { ...scenario.velocity };
      player.grounded = scenario.position.y === PLAYER_HALF_HEIGHT;
      player.input = { ...player.input, moveX: 0, moveZ: 0 };
      for (let tick = 0; tick < 8; tick++) {
        stepPlayer(player, 1 / 30, 2_000 + tick * (1_000 / 30));
        expect(penetratesFloorSlab(player)).toBe(false);
      }
    }
  });

  it("resolves a high-speed wall impact and emits wall-hit data", () => {
    const player = createPlayer("a", "Alpha", 0);
    player.protectionUntil = 0;
    player.position = { x: -7.9, y: 1.1, z: 0 };
    player.velocity = { x: -14, y: 0, z: 0 };
    player.grounded = false;
    player.input = { ...player.input, moveX: 0, moveZ: 0 };
    const result = stepPlayer(player, 0.02, 2_000);
    expect(result.wallHit?.intensity).toBeGreaterThan(7);
    expect(player.position.x).toBeCloseTo(-7.85, 8);
    expect(player.velocity.x).toBeCloseTo(0);
    expect(player.knockback).toBeGreaterThan(0);
  });
  it("cannot tunnel through a wall at extreme knockback speed", () => {
    const player = createPlayer("a", "Alpha", 0);
    player.position = { x: -7, y: 1.1, z: 0 };
    player.velocity = { x: -120, y: 0, z: 0 };
    player.grounded = false;
    stepPlayer(player, 1 / 30, 2_000);
    expect(player.position.x).toBeGreaterThanOrEqual(-7.851);
    expect(player.velocity.x).toBeCloseTo(0);
  });

  it("allows only one air recovery until landing", () => {
    const player = createPlayer("a", "Alpha", 0);
    player.grounded = false;
    player.position = { x: 0, y: 5, z: 0 };
    player.input = { ...player.input, moveZ: -1, dash: true };
    stepPlayer(player, 0.02, 2_000);
    expect(player.airRecoveryAvailable).toBe(false);
    expect(player.dashUntil).toBe(2_000 + GAME.dashDurationMs);
    const firstSpeed = Math.hypot(player.velocity.x, player.velocity.z);
    player.lastDash = 0;
    player.velocity.x = 0;
    player.velocity.z = 0;
    player.input.dash = true;
    stepPlayer(player, 0.02, 4_000);
    expect(Math.hypot(player.velocity.x, player.velocity.z)).toBeLessThan(
      firstSpeed,
    );
  });

  it("aligns forward movement with the attack direction at rotated yaw", () => {
    const player = createPlayer("a", "Alpha", 0);
    player.position = { x: 0, y: 1.1, z: 0 };
    player.input = { ...player.input, moveZ: -1, yaw: Math.PI / 2 };
    stepPlayer(player, 0.1, 2_000);
    expect(player.position.x).toBeLessThan(0);
    expect(Math.abs(player.position.z)).toBeLessThan(0.001);
  });

  it("tracks combos and applies diminishing hitstun resistance", () => {
    const attacker = createPlayer("a", "Alpha", 0);
    const victim = createPlayer("b", "Bravo", 0);
    attacker.position = { x: 0, y: 1.1, z: 0 };
    victim.position = { x: 0, y: 1.1, z: -2 };
    attacker.protectionUntil = 0;
    victim.protectionUntil = 0;
    performAttack(attacker, [attacker, victim], "light", 0, 0, 1_000);
    performAttack(attacker, [attacker, victim], "light", 0, 0, 1_500);
    performAttack(attacker, [attacker, victim], "light", 0, 0, 2_000);
    expect(attacker.combo).toBe(3);
    expect(victim.recentHitCount).toBe(3);
    expect(victim.resistanceUntil).toBeGreaterThan(2_000);
    expect(victim.hitStunUntil - 2_000).toBeLessThan(60);
  });

  it("enforces the short light-punch cooldown server-side", () => {
    const attacker = createPlayer("a", "Alpha", 0),
      victim = createPlayer("b", "Bravo", 0);
    attacker.position = { x: 0, y: 1.1, z: 0 };
    victim.position = { x: 0, y: 1.1, z: -2 };
    attacker.protectionUntil = 0;
    victim.protectionUntil = 0;
    expect(
      performAttack(attacker, [attacker, victim], "light", 0, 0, 1_000),
    ).toBeDefined();
    expect(
      performAttack(attacker, [attacker, victim], "light", 0, 0, 1_200),
    ).toBeUndefined();
    expect(
      performAttack(attacker, [attacker, victim], "light", 0, 0, 1_340),
    ).toBeDefined();
  });

  it("rejects punches through a massive arena wall", () => {
    const attacker = createPlayer("a", "Alpha", 0),
      victim = createPlayer("b", "Bravo", 0);
    attacker.position = { x: -7.5, y: 1.1, z: 0 };
    victim.position = { x: -10.5, y: 1.1, z: 0 };
    attacker.protectionUntil = 0;
    victim.protectionUntil = 0;
    expect(
      performAttack(
        attacker,
        [attacker, victim],
        "light",
        0,
        Math.PI / 2,
        1_000,
      ),
    ).toBeUndefined();
  });

  it("can reject friendly fire while still allowing enemy hits", () => {
    const attacker = createPlayer("a", "Red1", 0),
      friend = createPlayer("f", "Red2", 0),
      enemy = createPlayer("e", "Blue", 0);
    attacker.team = friend.team = "red";
    enemy.team = "blue";
    attacker.position = { x: 0, y: 1.1, z: 0 };
    friend.position = { x: 0, y: 1.1, z: -1.8 };
    enemy.position = { x: 0, y: 1.1, z: -2.2 };
    attacker.protectionUntil =
      friend.protectionUntil =
      enemy.protectionUntil =
        0;
    const hit = performAttack(
      attacker,
      [attacker, friend, enemy],
      "light",
      0,
      0,
      1_000,
      0,
      1,
      (target) => target.team !== attacker.team,
    );
    expect(hit?.victim.id).toBe(enemy.id);
    expect(friend.knockback).toBe(0);
  });

  it("allows a clamped historical hit when the target just left range", () => {
    const attacker = createPlayer("a", "Alpha", 0),
      victim = createPlayer("b", "Bravo", 0);
    attacker.position = { x: 0, y: 1.1, z: 0 };
    victim.position = { x: 0, y: 1.1, z: -5 };
    attacker.positionHistory = [
      { time: 1_000, position: { ...attacker.position } },
      { time: 1_200, position: { ...attacker.position } },
    ];
    victim.positionHistory = [
      { time: 1_000, position: { x: 0, y: 1.1, z: -2 } },
      { time: 1_200, position: { ...victim.position } },
    ];
    attacker.protectionUntil = 0;
    victim.protectionUntil = 0;
    expect(
      performAttack(attacker, [attacker, victim], "light", 0, 0, 1_200, 500)
        ?.victim.id,
    ).toBe(victim.id);
  });

  it("uses a waypoint instead of walking a bot straight through a wall", () => {
    const from = { x: -7.5, y: 1.1, z: 0 },
      target = { x: -10.5, y: 1.1, z: 0 };
    const waypoint = botNavigationTarget(from, target);
    expect(waypoint).not.toEqual(target);
    expect(Math.abs(waypoint.z)).toBeGreaterThan(3.5);
  });

  it("does not let an offscreen target steal a centered punch", () => {
    const attacker = createPlayer("a", "Alpha", 0),
      victim = createPlayer("b", "Bravo", 0);
    attacker.position = { x: 0, y: 1.1, z: 0 };
    victim.position = { x: 3.1, y: 1.1, z: -1.05 };
    attacker.protectionUntil = 0;
    victim.protectionUntil = 0;
    expect(
      performAttack(attacker, [attacker, victim], "light", 0, 0, 1_000),
    ).toBeUndefined();
  });

  it("selects the fighter closest to the crosshair, not the nearest center", () => {
    const attacker = createPlayer("a", "Alpha", 0);
    const peripheral = createPlayer("p", "Peripheral", 0);
    const centered = createPlayer("c", "Centered", 0);
    attacker.position = { x: 0, y: 1.1, z: 0 };
    peripheral.position = { x: 0.9, y: 1.1, z: -0.9 };
    centered.position = { x: 0, y: 1.1, z: -2.5 };
    attacker.protectionUntil =
      peripheral.protectionUntil =
      centered.protectionUntil =
        0;
    expect(
      performAttack(
        attacker,
        [attacker, peripheral, centered],
        "light",
        0,
        0,
        1_000,
      )?.victim.id,
    ).toBe(centered.id);
  });

  it("separates overlapping fighters and keeps point-blank combat valid", () => {
    const attacker = createPlayer("a", "Alpha", 0);
    const victim = createPlayer("b", "Bravo", 0);
    attacker.position = { x: 0, y: 1.1, z: 0 };
    victim.position = { x: 0, y: 1.1, z: 0 };
    attacker.protectionUntil = victim.protectionUntil = 0;
    attacker.protected = victim.protected = false;
    resolvePlayerCollisions([attacker, victim]);
    expect(
      Math.hypot(
        attacker.position.x - victim.position.x,
        attacker.position.z - victim.position.z,
      ),
    ).toBeCloseTo(1.1);
    expect(
      performAttack(
        attacker,
        [attacker, victim],
        "light",
        0,
        -Math.PI / 2,
        1_000,
      )?.victim.id,
    ).toBe(victim.id);
  });

  it("prevents two head-on dash hitboxes from swapping through each other", () => {
    const first = createPlayer("a", "Alpha", 0);
    const second = createPlayer("b", "Bravo", 0);
    first.protected = second.protected = false;
    first.protectionUntil = second.protectionUntil = 0;
    first.position = { x: 1, y: 1.1, z: 0 };
    second.position = { x: -1, y: 1.1, z: 0 };
    first.positionHistory = [
      { time: 1_000, position: { x: -1, y: 1.1, z: 0 } },
      { time: 1_033, position: { ...first.position } },
    ];
    second.positionHistory = [
      { time: 1_000, position: { x: 1, y: 1.1, z: 0 } },
      { time: 1_033, position: { ...second.position } },
    ];
    first.velocity.x = 19;
    second.velocity.x = -19;
    resolvePlayerCollisions([first, second]);
    expect(first.position.x).toBeLessThan(second.position.x);
    expect(second.position.x - first.position.x).toBeCloseTo(1.1);
    expect(first.velocity.x).toBeCloseTo(0);
    expect(second.velocity.x).toBeCloseTo(0);
  });

  it("transfers body separation when one fighter is pinned to a wall", () => {
    const pinned = createPlayer("a", "Pinned", 0);
    const movable = createPlayer("b", "Movable", 0);
    pinned.protected = movable.protected = false;
    pinned.protectionUntil = movable.protectionUntil = 0;
    pinned.position = { x: -7.85, y: 1.1, z: 0 };
    movable.position = { x: -7.2, y: 1.1, z: 0 };
    resolvePlayerCollisions([pinned, movable]);
    expect(pinned.position.x).toBeCloseTo(-7.85);
    expect(movable.position.x - pinned.position.x).toBeCloseTo(1.1);
  });

  it("does not let body separation push a falling fighter into the floor edge", () => {
    const edge = createPlayer("a", "Edge", 0);
    const outside = createPlayer("b", "Outside", 0);
    edge.protected = outside.protected = false;
    edge.protectionUntil = outside.protectionUntil = 0;
    edge.position = { x: 15.6, y: 0.5, z: 0 };
    outside.position = { x: 16, y: 0.5, z: 0 };
    edge.positionHistory = [{ time: 1_000, position: { ...edge.position } }];
    outside.positionHistory = [
      { time: 1_000, position: { ...outside.position } },
    ];

    resolvePlayerCollisions([edge, outside], 1_000);

    expect(penetratesFloorSlab(edge)).toBe(false);
    expect(edge.position.x).toBeGreaterThanOrEqual(15.55 - 1e-6);
    expect(outside.position.x - edge.position.x).toBeCloseTo(PLAYER_RADIUS * 2);
  });

  it("does not body-block a synchronized finisher launch", () => {
    const launched = createPlayer("a", "Launched", 0);
    const other = createPlayer("b", "Other", 0);
    launched.protected = other.protected = false;
    launched.position = { x: 0, y: 1.1, z: 0 };
    other.position = { x: 0, y: 1.1, z: 0 };
    launched.finisherUntil = 2_000;
    resolvePlayerCollisions([launched, other], 1_500);
    expect(launched.position).toEqual(other.position);
  });

  it("never lets a 100-percent heavy finisher ghost through a solid wall", () => {
    const attacker = createPlayer("a", "Alpha", 0),
      victim = createPlayer("b", "Bravo", 0);
    attacker.position = { x: 0, y: 1.1, z: 1 };
    victim.position = { x: 0, y: 1.1, z: -1 };
    victim.knockback = 100;
    attacker.protectionUntil = 0;
    victim.protectionUntil = 0;
    const hit = performAttack(
      attacker,
      [attacker, victim],
      "heavy",
      1,
      0,
      1_000,
    );
    expect(hit?.finisher).toBe(true);
    for (let tick = 1; tick <= 30; tick++)
      stepPlayer(victim, 1 / 30, 1_000 + (tick * 1000) / 30);
    expect(victim.position.z).toBeGreaterThanOrEqual(-7.851);
  });

  it("still launches a 100-percent heavy finisher out through an open lane", () => {
    const attacker = createPlayer("a", "Alpha", 0),
      victim = createPlayer("b", "Bravo", 0);
    attacker.position = { x: 5, y: 1.1, z: 1 };
    victim.position = { x: 5, y: 1.1, z: -1 };
    victim.knockback = 100;
    attacker.protectionUntil = 0;
    victim.protectionUntil = 0;
    const hit = performAttack(
      attacker,
      [attacker, victim],
      "heavy",
      1,
      0,
      1_000,
    );
    expect(hit?.finisher).toBe(true);
    for (let tick = 1; tick <= 30; tick++)
      stepPlayer(victim, 1 / 30, 1_000 + (tick * 1000) / 30);
    expect(victim.position.z).toBeLessThan(-15);
  });

  it("moves training bots slower than players", () => {
    const player = createPlayer("p", "Player", 0),
      bot = createPlayer("b", "Bot", 0, true);
    for (const candidate of [player, bot]) {
      candidate.position = { x: 0, y: 1.1, z: 0 };
      candidate.input = { ...candidate.input, moveZ: -1 };
    }
    stepPlayer(player, 0.1, 2_000);
    stepPlayer(bot, 0.1, 2_000);
    expect(Math.abs(bot.position.z)).toBeLessThan(Math.abs(player.position.z));
  });

  it("credits recent secondary contributors with an assist", () => {
    const attacker = createPlayer("a", "Alpha", 0);
    const assistant = createPlayer("b", "Bravo", 1);
    const victim = createPlayer("v", "Victim", 2);
    victim.lastAttacker = attacker.id;
    victim.damageContributors.set(attacker.id, 4_500);
    victim.damageContributors.set(assistant.id, 4_000);
    const result = creditKnockout(
      victim,
      new Map([
        [attacker.id, attacker],
        [assistant.id, assistant],
        [victim.id, victim],
      ]),
      5_000,
    );
    expect(attacker.score).toBe(1);
    expect(assistant.assists).toBe(1);
    expect(result.assistIds).toEqual([assistant.id]);
  });
});
