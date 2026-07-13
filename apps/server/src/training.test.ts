import { describe, expect, it } from "vitest";
import { TRAINING_MAX_KNOCKBACK, type Vec3 } from "@knockout/shared";
import { createPlayer } from "./simulation.js";
import {
  createTrainingLabState,
  recordTrainingHit,
  resetTrainingDummy,
  restoreTrainingBaselineAfterRespawn,
  setTrainingBaseline,
  toTrainingLabSnapshot,
  updateTrainingFlightDistance,
} from "./training.js";

const launch = {
  force: 14.5,
  launchAngleDegrees: 31,
  launchSpeed: 18.25,
};

describe("authoritative training lab state", () => {
  it("creates an empty lab and clamps every baseline to the supported range", () => {
    expect(createTrainingLabState()).toEqual({
      baselineKnockback: 0,
      lastHit: null,
      activeFlightStart: null,
    });
    expect(createTrainingLabState(-25).baselineKnockback).toBe(0);
    expect(createTrainingLabState(72.5).baselineKnockback).toBe(72.5);
    expect(createTrainingLabState(500).baselineKnockback).toBe(
      TRAINING_MAX_KNOCKBACK,
    );

    const state = createTrainingLabState(20);
    expect(setTrainingBaseline(state, 155)).toBe(155);
    expect(state.baselineKnockback).toBe(155);
    expect(setTrainingBaseline(state, Number.POSITIVE_INFINITY)).toBe(
      TRAINING_MAX_KNOCKBACK,
    );
    expect(setTrainingBaseline(state, Number.NEGATIVE_INFINITY)).toBe(0);
    expect(setTrainingBaseline(state, Number.NaN)).toBe(0);
  });

  it("clears stale telemetry when the baseline changes", () => {
    const state = createTrainingLabState(20);
    recordTrainingHit(state, launch, { x: 0, y: 1.1, z: 0 });
    updateTrainingFlightDistance(state, { x: 3, y: 2, z: 4 });

    expect(setTrainingBaseline(state, 20)).toBe(20);
    expect(state.lastHit?.flightDistance).toBe(5);

    expect(setTrainingBaseline(state, 80)).toBe(80);
    expect(state.lastHit).toBeNull();
    expect(state.activeFlightStart).toBeNull();
  });

  it("fully resets a dirty dummy to its lab spawn and clears telemetry", () => {
    const state = createTrainingLabState(125);
    recordTrainingHit(state, launch, { x: 1, y: 2, z: 3 });
    updateTrainingFlightDistance(state, { x: 4, y: -20, z: 7 });
    const dummy = createPlayer("coach-bot", "Coach", 1, true);
    const previousInput = dummy.input;
    const spawn: Vec3 = { x: -3, y: 1.1, z: 6 };
    const now = 42_000;

    dummy.position = { x: 90, y: -15, z: 80 };
    dummy.velocity = { x: 12, y: -8, z: 9 };
    Object.assign(dummy.input, {
      moveX: 1,
      moveZ: -1,
      jump: true,
      dash: true,
      blocking: true,
      charging: true,
    });
    dummy.grounded = false;
    dummy.knockback = 280;
    dummy.respawnAt = 50_000;
    dummy.eliminated = true;
    dummy.protected = true;
    dummy.protectionUntil = 60_000;
    dummy.lastAttack = 1;
    dummy.lastDash = 40_000;
    dummy.dashUntil = 43_000;
    dummy.blocking = true;
    dummy.blockStarted = 30_000;
    dummy.blockCooldownUntil = 50_000;
    dummy.blockNeedsRelease = true;
    dummy.charging = true;
    dummy.chargeStarted = 30_000;
    dummy.lastAttacker = "player";
    dummy.lastWallHit = 39_000;
    dummy.airRecoveryAvailable = false;
    dummy.combo = 4;
    dummy.lastComboAt = 40_000;
    dummy.comboTargetId = "player";
    dummy.damageContributors.set("player", 41_000);
    dummy.hitStunUntil = 45_000;
    dummy.hitWindowStartedAt = 41_000;
    dummy.recentHitCount = 3;
    dummy.resistanceUntil = 45_000;
    dummy.finisherUntil = 45_000;
    const previousTeleportSequence = dummy.teleportSequence ?? 0;

    resetTrainingDummy(state, dummy, spawn, now);

    expect(dummy.position).toEqual(spawn);
    expect(dummy.position).not.toBe(spawn);
    expect(dummy.teleportSequence).toBe(previousTeleportSequence + 1);
    expect(dummy.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(dummy.input).not.toBe(previousInput);
    expect(dummy.input).toEqual({
      moveX: 0,
      moveZ: 0,
      yaw: dummy.yaw,
      pitch: dummy.pitch ?? 0,
      jump: false,
      dash: false,
      blocking: false,
      charging: false,
    });
    expect(dummy.grounded).toBe(true);
    expect(dummy.knockback).toBe(125);
    expect(dummy.respawnAt).toBe(0);
    expect(dummy.eliminated).toBe(false);
    expect(dummy.protected).toBe(false);
    expect(dummy.protectionUntil).toBe(0);
    expect(dummy.lastAttack).toBe(now);
    expect(dummy.lastDash).toBe(0);
    expect(dummy.dashUntil).toBe(0);
    expect(dummy.blocking).toBe(false);
    expect(dummy.blockStarted).toBe(0);
    expect(dummy.blockCooldownUntil).toBe(0);
    expect(dummy.blockNeedsRelease).toBe(false);
    expect(dummy.charging).toBe(false);
    expect(dummy.chargeStarted).toBe(0);
    expect(dummy.lastAttacker).toBeUndefined();
    expect(dummy.lastWallHit).toBe(0);
    expect(dummy.airRecoveryAvailable).toBe(true);
    expect(dummy.combo).toBe(0);
    expect(dummy.lastComboAt).toBe(0);
    expect(dummy.comboTargetId).toBeUndefined();
    expect(dummy.damageContributors.size).toBe(0);
    expect(dummy.hitStunUntil).toBe(0);
    expect(dummy.hitWindowStartedAt).toBe(0);
    expect(dummy.recentHitCount).toBe(0);
    expect(dummy.resistanceUntil).toBe(0);
    expect(dummy.finisherUntil).toBe(0);
    expect(dummy.positionHistory).toEqual([
      { time: now, position: { ...spawn } },
    ]);
    expect(state.lastHit).toBeNull();
    expect(state.activeFlightStart).toBeNull();
  });

  it("restores baseline and disables spawn protection without deleting the last measurement", () => {
    const state = createTrainingLabState(88);
    recordTrainingHit(state, launch, { x: 0, y: 1.1, z: 0 });
    updateTrainingFlightDistance(state, { x: 6, y: -9, z: 8 });
    const previousHit = { ...state.lastHit! };
    const dummy = createPlayer("coach-bot", "Coach", 0, true);
    dummy.knockback = 0;
    dummy.protected = true;
    dummy.protectionUntil = 99_000;

    restoreTrainingBaselineAfterRespawn(state, dummy);

    expect(dummy.knockback).toBe(88);
    expect(dummy.protected).toBe(false);
    expect(dummy.protectionUntil).toBe(0);
    expect(state.lastHit).toEqual(previousHit);
    expect(state.activeFlightStart).toBeNull();

    updateTrainingFlightDistance(state, { x: 100, y: 1.1, z: 100 });
    expect(state.lastHit).toEqual(previousHit);
  });

  it("tracks maximum horizontal displacement monotonically and ignores height", () => {
    const state = createTrainingLabState();
    const start = { x: 2, y: 1.1, z: -3 };
    recordTrainingHit(state, launch, start);
    start.x = 1_000;

    updateTrainingFlightDistance(state, { x: 5, y: 100, z: 1 });
    expect(state.lastHit?.flightDistance).toBe(5);
    updateTrainingFlightDistance(state, { x: 2.5, y: -100, z: -2.5 });
    expect(state.lastHit?.flightDistance).toBe(5);
    updateTrainingFlightDistance(state, { x: 8, y: 1.1, z: 5 });
    expect(state.lastHit?.flightDistance).toBe(10);
  });

  it("replaces the complete measurement and flight origin on every new hit", () => {
    const state = createTrainingLabState();
    recordTrainingHit(state, launch, { x: 0, y: 0, z: 0 });
    updateTrainingFlightDistance(state, { x: 12, y: 0, z: 0 });

    const replacement = {
      force: 25,
      launchAngleDegrees: 44,
      launchSpeed: 30,
    };
    recordTrainingHit(
      state,
      { ...replacement, flightDistance: 999 },
      { x: 10, y: 4, z: 10 },
    );

    expect(state.lastHit).toEqual({ ...replacement, flightDistance: 0 });
    expect(state.activeFlightStart).toEqual({ x: 10, y: 4, z: 10 });
    updateTrainingFlightDistance(state, { x: 13, y: -50, z: 14 });
    expect(state.lastHit?.flightDistance).toBe(5);
  });

  it("does nothing without an active hit and returns detached snapshots", () => {
    const state = createTrainingLabState(40);
    updateTrainingFlightDistance(state, { x: 100, y: 100, z: 100 });
    expect(state.lastHit).toBeNull();

    recordTrainingHit(state, launch, { x: 0, y: 0, z: 0 });
    updateTrainingFlightDistance(state, { x: 3, y: 99, z: 4 });
    const snapshot = toTrainingLabSnapshot(state);
    expect(snapshot).toEqual({
      baselineKnockback: 40,
      lastHit: { ...launch, flightDistance: 5 },
    });

    snapshot.baselineKnockback = 200;
    snapshot.lastHit!.force = 999;
    expect(state.baselineKnockback).toBe(40);
    expect(state.lastHit?.force).toBe(launch.force);
  });
});
