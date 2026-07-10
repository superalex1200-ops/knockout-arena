import { describe, expect, it } from "vitest";
import { GAME } from "@knockout/shared";
import {
  botNavigationTarget,
  createPlayer,
  creditKnockout,
  performAttack,
  stepPlayer,
} from "./simulation.js";

describe("authoritative combat simulation", () => {
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

  it("does not let an air dash recover through the underside of the arena", () => {
    const player = createPlayer("a", "Alpha", 0);
    player.position = { x: 15.2, y: 0.9, z: 0 };
    player.velocity = { x: 0, y: 0.8, z: 0 };
    player.grounded = false;
    player.airRecoveryAvailable = true;
    player.input = { ...player.input, moveX: -1, dash: true };
    stepPlayer(player, 0.1, 2_000);
    expect(player.position.x).toBeLessThan(GAME.arenaHalfSize);
    expect(player.position.y).toBeLessThan(1.1);
    expect(player.velocity.y).toBeLessThanOrEqual(0);
    expect(player.grounded).toBe(false);
  });

  it("removes grounded state immediately after leaving the platform", () => {
    const player = createPlayer("a", "Alpha", 0);
    player.position = { x: GAME.arenaHalfSize - 0.05, y: 1.1, z: 0 };
    player.velocity = { x: 8, y: 0, z: 0 };
    player.input = { ...player.input, moveX: 1 };
    stepPlayer(player, 0.1, 2_000);
    expect(player.position.x).toBeGreaterThan(GAME.arenaHalfSize);
    expect(player.grounded).toBe(false);
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
    expect(player.velocity.x).toBeGreaterThan(0);
    expect(player.knockback).toBeGreaterThan(0);
  });
  it("cannot tunnel through a wall at extreme knockback speed", () => {
    const player = createPlayer("a", "Alpha", 0);
    player.position = { x: -7, y: 1.1, z: 0 };
    player.velocity = { x: -120, y: 0, z: 0 };
    player.grounded = false;
    stepPlayer(player, 1 / 30, 2_000);
    expect(player.position.x).toBeGreaterThanOrEqual(-7.851);
    expect(player.velocity.x).toBeGreaterThan(0);
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

  it("accepts a forgiving off-center punch sweep", () => {
    const attacker = createPlayer("a", "Alpha", 0),
      victim = createPlayer("b", "Bravo", 0);
    attacker.position = { x: 0, y: 1.1, z: 0 };
    victim.position = { x: 3.1, y: 1.1, z: -1.05 };
    attacker.protectionUntil = 0;
    victim.protectionUntil = 0;
    expect(
      performAttack(attacker, [attacker, victim], "light", 0, 0, 1_000)?.victim
        .id,
    ).toBe(victim.id);
  });

  it("launches a 100-percent heavy finisher beyond the arena", () => {
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
