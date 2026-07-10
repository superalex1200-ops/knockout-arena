export const GAME = {
  tickRate: 30,
  snapshotRate: 20,
  arenaHalfSize: 15,
  deathHeight: -9,
  moveSpeed: 8.5,
  airSpeed: 3.2,
  jumpSpeed: 8.2,
  gravity: 22,
  dashSpeed: 19,
  dashDurationMs: 260,
  dashCooldownMs: 1_300,
  punchRange: 3.55,
  punchCooldownMs: 340,
  heavyCooldownMs: 850,
  respawnMs: 1_700,
  spawnProtectionMs: 1_600,
} as const;
export const PROTOCOL_VERSION = 1;

export const PLAYER_RADIUS = 0.55;
export const ARENA_WALLS = [
  { minX: -9.6, maxX: -8.4, minZ: -3.5, maxZ: 3.5, height: 3.2 },
  { minX: 8.4, maxX: 9.6, minZ: -3.5, maxZ: 3.5, height: 3.2 },
  { minX: -3.5, maxX: 3.5, minZ: -9.6, maxZ: -8.4, height: 2.2 },
  { minX: -3.5, maxX: 3.5, minZ: 8.4, maxZ: 9.6, height: 2.2 },
] as const;

export type Vec3 = { x: number; y: number; z: number };
export type AttackKind = "light" | "heavy";
export type MatchMode = "quick" | "private" | "training";
export type MatchPhase = "lobby" | "countdown" | "playing" | "results";
export type TrainingBotMode = "static" | "strafe" | "aggressive" | "blocking";
export type Team = "red" | "blue";
export type MatchRules = {
  gameMode: "stock" | "team";
  matchDurationSeconds: number;
  stocks: number;
  knockbackMultiplier: number;
  heavyEnabled: boolean;
  dashEnabled: boolean;
  blockEnabled: boolean;
  friendlyFire: boolean;
};
export const DEFAULT_MATCH_RULES: MatchRules = {
  gameMode: "stock",
  matchDurationSeconds: 180,
  stocks: 3,
  knockbackMultiplier: 1,
  heavyEnabled: true,
  dashEnabled: true,
  blockEnabled: true,
  friendlyFire: false,
};

export type PlayerSnapshot = {
  id: string;
  name: string;
  position: Vec3;
  velocity: Vec3;
  grounded: boolean;
  yaw: number;
  knockback: number;
  score: number;
  assists: number;
  falls: number;
  combo: number;
  lastProcessedInput: number;
  stocksRemaining: number;
  eliminated: boolean;
  blocking: boolean;
  protected: boolean;
  ready: boolean;
  host: boolean;
  team?: Team;
  bot?: boolean;
};

export type ServerMessage =
  | {
      type: "welcome";
      playerId: string;
      roomCode: string;
      reconnectToken: string;
      lastProcessedInput: number;
    }
  | {
      type: "joinError";
      code:
        | "ROOM_FULL"
        | "ROOM_NOT_FOUND"
        | "INVALID_CODE"
        | "MATCH_STARTED"
        | "VERSION_MISMATCH";
      message: string;
    }
  | {
      type: "snapshot";
      serverTime: number;
      matchId: string;
      matchStartedAt: number;
      phase: MatchPhase;
      phaseEndsAt: number;
      trainingBotMode: TrainingBotMode;
      rules: MatchRules;
      players: PlayerSnapshot[];
    }
  | {
      type: "hit";
      attackerId: string;
      victimId: string;
      kind: AttackKind;
      parried: boolean;
      blocked: boolean;
      finisher: boolean;
      knockback: number;
      combo: number;
    }
  | { type: "wallHit"; playerId: string; position: Vec3; intensity: number }
  | {
      type: "knockout";
      victimId: string;
      attackerId?: string;
      assistIds: string[];
    }
  | {
      type: "chat";
      playerId: string;
      name: string;
      text: string;
      sentAt: number;
    }
  | { type: "pong"; clientTime: number; serverTime: number }
  | { type: "notice"; text: string };

export type ClientMessage =
  | {
      type: "join";
      name: string;
      roomCode: string;
      mode: MatchMode;
      protocolVersion: number;
      createRoom?: boolean;
      reconnectToken?: string;
    }
  | { type: "ready"; ready: boolean }
  | { type: "chat"; text: string }
  | { type: "ping"; clientTime: number }
  | { type: "setTrainingBotMode"; mode: TrainingBotMode }
  | { type: "updateRules"; patch: Partial<MatchRules> }
  | {
      type: "input";
      sequence: number;
      moveX: number;
      moveZ: number;
      yaw: number;
      jump: boolean;
      dash: boolean;
      blocking: boolean;
    }
  | {
      type: "attack";
      kind: AttackKind;
      charge: number;
      yaw: number;
      clientTime: number;
    };

export function knockbackForce(percent: number, heavyCharge = 0): number {
  const curved = 1 + 1.9 * (1 - Math.exp(-Math.max(0, percent) / 65));
  const finisher = 1 + Math.min(0.25, Math.max(0, percent - 85) / 90);
  return (heavyCharge > 0 ? 9.2 + heavyCharge * 3.8 : 8.2) * curved * finisher;
}

export function movementBlendFactor(
  dt: number,
  grounded: boolean,
  dashing: boolean,
  hasInput: boolean,
): number {
  const sharpness = dashing
    ? 2.2
    : grounded
      ? hasInput
        ? 18
        : 26
      : hasInput
        ? 4.5
        : 1.8;
  return 1 - Math.exp(-Math.max(0, dt) * sharpness);
}

export function normalizeLobbyCode(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

export function isValidLobbyCode(value: string): boolean {
  return /^[A-Z0-9]{4,6}$/.test(value);
}

export function resolvePredictedWalls(
  position: Vec3,
  radius = PLAYER_RADIUS,
): Vec3 {
  const resolved = { ...position };
  for (const wall of ARENA_WALLS) {
    if (resolved.y > wall.height + 1.1) continue;
    const minX = wall.minX - radius,
      maxX = wall.maxX + radius,
      minZ = wall.minZ - radius,
      maxZ = wall.maxZ + radius;
    if (
      resolved.x <= minX ||
      resolved.x >= maxX ||
      resolved.z <= minZ ||
      resolved.z >= maxZ
    )
      continue;
    const sides = [
      { d: resolved.x - minX, axis: "x", value: minX },
      { d: maxX - resolved.x, axis: "x", value: maxX },
      { d: resolved.z - minZ, axis: "z", value: minZ },
      { d: maxZ - resolved.z, axis: "z", value: maxZ },
    ] as const;
    const nearest = [...sides].sort((a, b) => a.d - b.d)[0]!;
    resolved[nearest.axis] = nearest.value;
  }
  return resolved;
}

export function segmentCrossesArenaWall(from: Vec3, to: Vec3): boolean {
  for (const wall of ARENA_WALLS) {
    if (Math.max(from.y, to.y) > wall.height + 1.1) continue;
    let enter = 0,
      exit = 1;
    for (const [start, delta, min, max] of [
      [from.x, to.x - from.x, wall.minX, wall.maxX],
      [from.z, to.z - from.z, wall.minZ, wall.maxZ],
    ] as number[][]) {
      if (Math.abs(delta!) < 1e-8) {
        if (start! < min! || start! > max!) {
          enter = 2;
          break;
        }
        continue;
      }
      const a = (min! - start!) / delta!,
        b = (max! - start!) / delta!;
      enter = Math.max(enter, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
    }
    if (enter <= exit && exit >= 0 && enter <= 1) return true;
  }
  return false;
}
