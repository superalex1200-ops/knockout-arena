import {
  attackTargetHit,
  type AttackKind,
  type PlayerSnapshot,
} from "@knockout/shared";

export type CombatHudState = {
  dashReady: number;
  lightReady: number;
  heavyReady: number;
  heavyCharge: number;
  blocking: boolean;
  parryActive: boolean;
  validTarget: boolean;
  dashEnabled: boolean;
  heavyEnabled: boolean;
  blockEnabled: boolean;
};

export const EMPTY_COMBAT_HUD: CombatHudState = {
  dashReady: 1,
  lightReady: 1,
  heavyReady: 1,
  heavyCharge: 0,
  blocking: false,
  parryActive: false,
  validTarget: false,
  dashEnabled: true,
  heavyEnabled: true,
  blockEnabled: true,
};

export function cooldownReadiness(
  lastUsed: number,
  cooldownMs: number,
  now: number,
): number {
  if (lastUsed <= 0) return 1;
  return Math.max(0, Math.min(1, (now - lastUsed) / cooldownMs));
}

export function isPunchTargetValid(
  local: PlayerSnapshot,
  target: PlayerSnapshot,
  yaw: number,
  friendlyFire = true,
  pitch = 0,
  kind: AttackKind = "light",
): boolean {
  if (target.id === local.id || target.eliminated || target.protected)
    return false;
  if (!friendlyFire && local.team && target.team === local.team) return false;
  return Boolean(
    attackTargetHit(local.position, target.position, yaw, pitch, kind),
  );
}
