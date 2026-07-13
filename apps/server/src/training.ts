import {
  TRAINING_MAX_KNOCKBACK,
  type TrainingHitMetrics,
  type TrainingLabSnapshot,
  type Vec3,
} from "@knockout/shared";
import type { SimPlayer } from "./simulation.js";

export type TrainingLabState = {
  baselineKnockback: number;
  lastHit: TrainingHitMetrics | null;
  activeFlightStart: Vec3 | null;
};

export type TrainingLaunchMetrics = Omit<TrainingHitMetrics, "flightDistance">;

const clampTrainingBaseline = (value: number): number => {
  if (Number.isNaN(value)) return 0;
  return Math.min(TRAINING_MAX_KNOCKBACK, Math.max(0, value));
};

export const createTrainingLabState = (
  baselineKnockback = 0,
): TrainingLabState => ({
  baselineKnockback: clampTrainingBaseline(baselineKnockback),
  lastHit: null,
  activeFlightStart: null,
});

export const setTrainingBaseline = (
  state: TrainingLabState,
  value: number,
): number => {
  const baselineKnockback = clampTrainingBaseline(value);
  if (baselineKnockback !== state.baselineKnockback) {
    state.baselineKnockback = baselineKnockback;
    state.lastHit = null;
    state.activeFlightStart = null;
  }
  return state.baselineKnockback;
};

export const resetTrainingDummy = (
  state: TrainingLabState,
  dummy: SimPlayer,
  spawn: Vec3,
  now: number,
): void => {
  dummy.teleportSequence = (dummy.teleportSequence ?? 0) + 1;
  dummy.position = { ...spawn };
  dummy.velocity = { x: 0, y: 0, z: 0 };
  dummy.input = {
    moveX: 0,
    moveZ: 0,
    yaw: dummy.yaw,
    pitch: dummy.pitch ?? 0,
    jump: false,
    dash: false,
    blocking: false,
    charging: false,
  };
  dummy.grounded = true;
  dummy.knockback = state.baselineKnockback;
  dummy.respawnAt = 0;
  dummy.eliminated = false;
  dummy.protected = false;
  dummy.protectionUntil = 0;
  dummy.lastAttack = now;
  dummy.lastDash = 0;
  dummy.dashUntil = 0;
  dummy.blocking = false;
  dummy.blockStarted = 0;
  dummy.blockCooldownUntil = 0;
  dummy.blockNeedsRelease = false;
  dummy.charging = false;
  dummy.chargeStarted = 0;
  dummy.lastAttacker = undefined;
  dummy.lastWallHit = 0;
  dummy.airRecoveryAvailable = true;
  dummy.combo = 0;
  dummy.lastComboAt = 0;
  dummy.comboTargetId = undefined;
  dummy.damageContributors.clear();
  dummy.hitStunUntil = 0;
  dummy.hitWindowStartedAt = 0;
  dummy.recentHitCount = 0;
  dummy.resistanceUntil = 0;
  dummy.finisherUntil = 0;
  dummy.positionHistory = [{ time: now, position: { ...spawn } }];

  state.lastHit = null;
  state.activeFlightStart = null;
};

export const restoreTrainingBaselineAfterRespawn = (
  state: TrainingLabState,
  dummy: SimPlayer,
): void => {
  dummy.knockback = state.baselineKnockback;
  dummy.protected = false;
  dummy.protectionUntil = 0;
  state.activeFlightStart = null;
};

export const recordTrainingHit = (
  state: TrainingLabState,
  metrics: TrainingLaunchMetrics | TrainingHitMetrics,
  startPosition: Vec3,
): void => {
  state.lastHit = { ...metrics, flightDistance: 0 };
  state.activeFlightStart = { ...startPosition };
};

export const updateTrainingFlightDistance = (
  state: TrainingLabState,
  position: Vec3,
): void => {
  if (!state.lastHit || !state.activeFlightStart) return;
  const distance = Math.hypot(
    position.x - state.activeFlightStart.x,
    position.z - state.activeFlightStart.z,
  );
  if (Number.isFinite(distance))
    state.lastHit.flightDistance = Math.max(
      state.lastHit.flightDistance,
      distance,
    );
};

export const toTrainingLabSnapshot = (
  state: TrainingLabState,
): TrainingLabSnapshot => ({
  baselineKnockback: state.baselineKnockback,
  lastHit: state.lastHit ? { ...state.lastHit } : null,
});
