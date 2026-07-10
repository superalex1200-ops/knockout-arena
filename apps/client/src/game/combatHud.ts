import {
  GAME,
  PLAYER_RADIUS,
  segmentCrossesArenaWall,
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
): boolean {
  if (target.id === local.id || target.eliminated || target.protected)
    return false;
  if (!friendlyFire && local.team && target.team === local.team) return false;
  const dx = target.position.x - local.position.x,
    dz = target.position.z - local.position.z;
  const centerDistance = Math.hypot(dx, dz);
  const distance = Math.max(0, centerDistance - PLAYER_RADIUS * 0.65);
  const facing =
    (dx * -Math.sin(yaw) + dz * -Math.cos(yaw)) /
    Math.max(centerDistance, 0.001);
  return (
    distance < GAME.punchRange &&
    facing > 0.27 &&
    Math.abs(target.position.y - local.position.y) < 2.85 &&
    !segmentCrossesArenaWall(local.position, target.position)
  );
}
