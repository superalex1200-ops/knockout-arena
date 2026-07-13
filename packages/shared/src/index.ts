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
  punchRange: 2.55,
  punchCooldownMs: 340,
  heavyCooldownMs: 850,
  heavyChargeMs: 1_100,
  heavyMinChargeMs: 180,
  blockMaxHoldMs: 900,
  blockCooldownMs: 650,
  finisherDurationMs: 650,
  respawnMs: 1_700,
  spawnProtectionMs: 1_600,
} as const;
export const PROTOCOL_VERSION = 1;

export const PLAYER_RADIUS = 0.55;
export const PLAYER_HALF_HEIGHT = 1.1;
export const PLAYER_GROUND_Y = PLAYER_HALF_HEIGHT;
export const ARENA_FLOOR_TOP = 0;
export const ARENA_FLOOR_THICKNESS = 1.8;
export const ARENA_FLOOR_BOTTOM = ARENA_FLOOR_TOP - ARENA_FLOOR_THICKNESS;
export const ARENA_WALLS = [
  {
    id: "west",
    accent: "cyan",
    minX: -9.6,
    maxX: -8.4,
    minZ: -3.5,
    maxZ: 3.5,
    height: 3.2,
  },
  {
    id: "east",
    accent: "magenta",
    minX: 8.4,
    maxX: 9.6,
    minZ: -3.5,
    maxZ: 3.5,
    height: 3.2,
  },
  {
    id: "north",
    accent: "cyan",
    minX: -3.5,
    maxX: 3.5,
    minZ: -9.6,
    maxZ: -8.4,
    height: 2.2,
  },
  {
    id: "south",
    accent: "magenta",
    minX: -3.5,
    maxX: 3.5,
    minZ: 8.4,
    maxZ: 9.6,
    height: 2.2,
  },
] as const;

export const FIGHTER_HURTBOX = {
  radius: 0.72,
  halfSegment: 0.55,
  centerOffsetY: 0.15,
} as const;

export const ATTACK_HITBOX = {
  radius: 0.38,
  originHeight: 0.65,
  heavyReachBonus: 0.35,
  maxPitch: 1.2,
} as const;

export type Vec3 = { x: number; y: number; z: number };
export type AttackKind = "light" | "heavy";
export type MatchMode = "quick" | "private" | "training";
export type MatchPhase = "lobby" | "countdown" | "playing" | "results";
export type TrainingBotMode = "static" | "strafe" | "aggressive" | "blocking";
export const TRAINING_MAX_KNOCKBACK = 200;
export type TrainingHitMetrics = {
  force: number;
  launchAngleDegrees: number;
  launchSpeed: number;
  flightDistance: number;
};
export type TrainingLabSnapshot = {
  baselineKnockback: number;
  lastHit: TrainingHitMetrics | null;
};
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
  pitch?: number;
  knockback: number;
  score: number;
  assists: number;
  falls: number;
  combo: number;
  lastProcessedInput: number;
  stocksRemaining: number;
  eliminated: boolean;
  blocking: boolean;
  charging: boolean;
  protected: boolean;
  finisher?: boolean;
  finisherRemainingMs?: number;
  ready: boolean;
  host: boolean;
  connected?: boolean;
  team?: Team;
  bot?: boolean;
  teleportSequence?: number;
};

export type ServerMessage =
  | {
      type: "welcome";
      playerId: string;
      roomCode: string;
      roomMode: MatchMode;
      reconnectToken: string;
      lastProcessedInput: number;
    }
  | {
      type: "joinError";
      code:
        | "ROOM_FULL"
        | "ROOM_NOT_FOUND"
        | "ROOM_MODE_MISMATCH"
        | "RECONNECT_EXPIRED"
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
      roomMode: MatchMode;
      rematchVotes: string[];
      trainingBotMode: TrainingBotMode;
      training?: TrainingLabSnapshot;
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
      position?: Vec3;
      finisherDurationMs?: number;
    }
  | {
      type: "attack";
      attackerId: string;
      kind: AttackKind;
      charge: number;
      pitch?: number;
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
  | { type: "leave" }
  | { type: "startMatch" }
  | { type: "rematchVote"; vote: boolean }
  | { type: "returnToLobby" }
  | { type: "chat"; text: string }
  | { type: "ping"; clientTime: number }
  | { type: "setTrainingBotMode"; mode: TrainingBotMode }
  | { type: "setTrainingKnockback"; value: number }
  | { type: "resetTraining" }
  | { type: "updateRules"; patch: Partial<MatchRules> }
  | {
      type: "input";
      sequence: number;
      moveX: number;
      moveZ: number;
      yaw: number;
      pitch?: number;
      jump: boolean;
      dash: boolean;
      blocking: boolean;
      charging: boolean;
    }
  | {
      type: "attack";
      kind: AttackKind;
      charge: number;
      yaw: number;
      pitch?: number;
      inputSequence?: number;
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

export type ArenaWall = (typeof ARENA_WALLS)[number];
export type ArenaWallContact = {
  wall: ArenaWall;
  normal: { x: number; z: number };
  time: number;
};
export type ArenaMovementResult = {
  position: Vec3;
  contact?: ArenaWallContact;
};

const COLLISION_EPSILON = 1e-7;
const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * Treats the fighter footprint as a circle against the exact square floor.
 * This keeps a capsule supported while any part of its base still rests on
 * the platform, including at corners, instead of dropping its centre through
 * a visibly remaining strip of floor.
 */
export function fighterHasArenaFloorSupport(
  position: Pick<Vec3, "x" | "z">,
  radius = PLAYER_RADIUS,
): boolean {
  const outsideX = Math.max(0, Math.abs(position.x) - GAME.arenaHalfSize);
  const outsideZ = Math.max(0, Math.abs(position.z) - GAME.arenaHalfSize);
  return (
    outsideX * outsideX + outsideZ * outsideZ <=
    radius * radius + COLLISION_EPSILON
  );
}

export type ArenaFloorContact = {
  normal: Vec3;
  grounded: boolean;
};

export type ArenaFloorMovementResult = {
  position: Vec3;
  contact?: ArenaFloorContact;
};

function resolveFloorHorizontalOverlap(
  position: Vec3,
  radius: number,
): { position: Vec3; normal: Vec3 } | undefined {
  const closestX = clamp(position.x, -GAME.arenaHalfSize, GAME.arenaHalfSize);
  const closestZ = clamp(position.z, -GAME.arenaHalfSize, GAME.arenaHalfSize);
  const dx = position.x - closestX;
  const dz = position.z - closestZ;
  const distanceSquared = dx * dx + dz * dz;
  if (distanceSquared >= radius * radius - COLLISION_EPSILON) return;

  if (distanceSquared > COLLISION_EPSILON) {
    const distance = Math.sqrt(distanceSquared);
    const normal = { x: dx / distance, y: 0, z: dz / distance };
    const push = radius - distance;
    return {
      position: {
        ...position,
        x: position.x + normal.x * push,
        z: position.z + normal.z * push,
      },
      normal,
    };
  }

  const nearest = [
    {
      distance: position.x + GAME.arenaHalfSize,
      position: {
        ...position,
        x: -GAME.arenaHalfSize - radius,
      },
      normal: { x: -1, y: 0, z: 0 },
    },
    {
      distance: GAME.arenaHalfSize - position.x,
      position: {
        ...position,
        x: GAME.arenaHalfSize + radius,
      },
      normal: { x: 1, y: 0, z: 0 },
    },
    {
      distance: position.z + GAME.arenaHalfSize,
      position: {
        ...position,
        z: -GAME.arenaHalfSize - radius,
      },
      normal: { x: 0, y: 0, z: -1 },
    },
    {
      distance: GAME.arenaHalfSize - position.z,
      position: {
        ...position,
        z: GAME.arenaHalfSize + radius,
      },
      normal: { x: 0, y: 0, z: 1 },
    },
  ].sort((a, b) => a.distance - b.distance)[0]!;
  return { position: nearest.position, normal: nearest.normal };
}

/**
 * Resolves a vertical fighter capsule against the complete visible floor box.
 * Sub-stepped simulation uses this for top, side and underside contacts, so an
 * edge dash cannot enter the solid slab and a standing capsule keeps contact
 * until its round footprint has actually cleared the platform.
 */
export function resolveArenaFloorMovement(
  from: Vec3,
  to: Vec3,
  radius = PLAYER_RADIUS,
  halfHeight = PLAYER_HALF_HEIGHT,
): ArenaFloorMovementResult {
  const fromBottom = from.y - halfHeight;
  const fromTop = from.y + halfHeight;
  const toBottom = to.y - halfHeight;
  const toTop = to.y + halfHeight;
  const hasHorizontalContact = fighterHasArenaFloorSupport(to, radius);

  if (
    fromBottom >= ARENA_FLOOR_TOP - COLLISION_EPSILON &&
    toBottom <= ARENA_FLOOR_TOP + COLLISION_EPSILON &&
    hasHorizontalContact
  )
    return {
      position: { ...to, y: ARENA_FLOOR_TOP + halfHeight },
      contact: { normal: { x: 0, y: 1, z: 0 }, grounded: true },
    };

  if (
    fromTop <= ARENA_FLOOR_BOTTOM + COLLISION_EPSILON &&
    toTop >= ARENA_FLOOR_BOTTOM - COLLISION_EPSILON &&
    hasHorizontalContact
  )
    return {
      position: { ...to, y: ARENA_FLOOR_BOTTOM - halfHeight },
      contact: { normal: { x: 0, y: -1, z: 0 }, grounded: false },
    };

  const overlapsFloorHeight =
    toTop > ARENA_FLOOR_BOTTOM + COLLISION_EPSILON &&
    toBottom < ARENA_FLOOR_TOP - COLLISION_EPSILON;
  if (!overlapsFloorHeight) return { position: { ...to } };

  const horizontal = resolveFloorHorizontalOverlap(to, radius);
  if (!horizontal) return { position: { ...to } };
  return {
    position: horizontal.position,
    contact: { normal: horizontal.normal, grounded: false },
  };
}

export function fighterOverlapsWallHeight(
  centerY: number,
  wall: ArenaWall,
  halfHeight = PLAYER_HALF_HEIGHT,
): boolean {
  return centerY + halfHeight > 0 && centerY - halfHeight < wall.height;
}

function resolveCircleWallOverlap(
  position: Vec3,
  wall: ArenaWall,
  radius: number,
  halfHeight: number,
): { position: Vec3; normal: { x: number; z: number } } | undefined {
  if (!fighterOverlapsWallHeight(position.y, wall, halfHeight)) return;
  const closestX = clamp(position.x, wall.minX, wall.maxX);
  const closestZ = clamp(position.z, wall.minZ, wall.maxZ);
  const dx = position.x - closestX;
  const dz = position.z - closestZ;
  const distanceSquared = dx * dx + dz * dz;
  if (distanceSquared >= radius * radius - COLLISION_EPSILON) return;

  if (distanceSquared > COLLISION_EPSILON) {
    const distance = Math.sqrt(distanceSquared);
    const normal = { x: dx / distance, z: dz / distance };
    const push = radius - distance;
    return {
      position: {
        ...position,
        x: position.x + normal.x * push,
        z: position.z + normal.z * push,
      },
      normal,
    };
  }

  const nearest = [
    {
      distance: position.x - wall.minX,
      position: { ...position, x: wall.minX - radius },
      normal: { x: -1, z: 0 },
    },
    {
      distance: wall.maxX - position.x,
      position: { ...position, x: wall.maxX + radius },
      normal: { x: 1, z: 0 },
    },
    {
      distance: position.z - wall.minZ,
      position: { ...position, z: wall.minZ - radius },
      normal: { x: 0, z: -1 },
    },
    {
      distance: wall.maxZ - position.z,
      position: { ...position, z: wall.maxZ + radius },
      normal: { x: 0, z: 1 },
    },
  ].sort((a, b) => a.distance - b.distance)[0]!;
  return { position: nearest.position, normal: nearest.normal };
}

export function resolveArenaWallOverlaps(
  position: Vec3,
  radius = PLAYER_RADIUS,
  halfHeight = PLAYER_HALF_HEIGHT,
): ArenaMovementResult {
  let resolved = { ...position };
  let firstContact: ArenaWallContact | undefined;
  for (let pass = 0; pass < ARENA_WALLS.length * 2; pass++) {
    let changed = false;
    for (const wall of ARENA_WALLS) {
      const overlap = resolveCircleWallOverlap(
        resolved,
        wall,
        radius,
        halfHeight,
      );
      if (!overlap) continue;
      resolved = overlap.position;
      firstContact ??= { wall, normal: overlap.normal, time: 0 };
      changed = true;
    }
    if (!changed) break;
  }
  return { position: resolved, contact: firstContact };
}

type SweepCandidate = ArenaWallContact;

function sweepCircleAgainstWall(
  from: Vec3,
  to: Vec3,
  wall: ArenaWall,
  radius: number,
  halfHeight: number,
): SweepCandidate | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  let best: SweepCandidate | undefined;
  const consider = (
    time: number,
    normal: { x: number; z: number },
    validHorizontal: (x: number, z: number) => boolean,
  ) => {
    if (time < -COLLISION_EPSILON || time > 1 + COLLISION_EPSILON) return;
    const safeTime = clamp(time, 0, 1);
    const x = from.x + dx * safeTime;
    const y = from.y + dy * safeTime;
    const z = from.z + dz * safeTime;
    if (
      dx * normal.x + dz * normal.z >= -COLLISION_EPSILON ||
      !fighterOverlapsWallHeight(y, wall, halfHeight) ||
      !validHorizontal(x, z) ||
      (best && best.time <= safeTime)
    )
      return;
    best = { wall, normal, time: safeTime };
  };

  if (dx > COLLISION_EPSILON)
    consider(
      (wall.minX - radius - from.x) / dx,
      { x: -1, z: 0 },
      (_, z) =>
        z >= wall.minZ - COLLISION_EPSILON &&
        z <= wall.maxZ + COLLISION_EPSILON,
    );
  else if (dx < -COLLISION_EPSILON)
    consider(
      (wall.maxX + radius - from.x) / dx,
      { x: 1, z: 0 },
      (_, z) =>
        z >= wall.minZ - COLLISION_EPSILON &&
        z <= wall.maxZ + COLLISION_EPSILON,
    );

  if (dz > COLLISION_EPSILON)
    consider(
      (wall.minZ - radius - from.z) / dz,
      { x: 0, z: -1 },
      (x) =>
        x >= wall.minX - COLLISION_EPSILON &&
        x <= wall.maxX + COLLISION_EPSILON,
    );
  else if (dz < -COLLISION_EPSILON)
    consider(
      (wall.maxZ + radius - from.z) / dz,
      { x: 0, z: 1 },
      (x) =>
        x >= wall.minX - COLLISION_EPSILON &&
        x <= wall.maxX + COLLISION_EPSILON,
    );

  const speedSquared = dx * dx + dz * dz;
  if (speedSquared > COLLISION_EPSILON) {
    for (const [cornerX, cornerZ, quadrantX, quadrantZ] of [
      [wall.minX, wall.minZ, -1, -1],
      [wall.minX, wall.maxZ, -1, 1],
      [wall.maxX, wall.minZ, 1, -1],
      [wall.maxX, wall.maxZ, 1, 1],
    ] as const) {
      const offsetX = from.x - cornerX;
      const offsetZ = from.z - cornerZ;
      const b = 2 * (offsetX * dx + offsetZ * dz);
      const c = offsetX * offsetX + offsetZ * offsetZ - radius * radius;
      const discriminant = b * b - 4 * speedSquared * c;
      if (discriminant < 0) continue;
      const root = (-b - Math.sqrt(discriminant)) / (2 * speedSquared);
      const hitX = from.x + dx * root;
      const hitZ = from.z + dz * root;
      const normalLength = Math.hypot(hitX - cornerX, hitZ - cornerZ);
      if (normalLength <= COLLISION_EPSILON) continue;
      consider(
        root,
        {
          x: (hitX - cornerX) / normalLength,
          z: (hitZ - cornerZ) / normalLength,
        },
        (x, z) =>
          (quadrantX < 0
            ? x <= cornerX + COLLISION_EPSILON
            : x >= cornerX - COLLISION_EPSILON) &&
          (quadrantZ < 0
            ? z <= cornerZ + COLLISION_EPSILON
            : z >= cornerZ - COLLISION_EPSILON),
      );
    }
  }
  return best;
}

export function sweepArenaWalls(
  from: Vec3,
  to: Vec3,
  radius = PLAYER_RADIUS,
  halfHeight = PLAYER_HALF_HEIGHT,
): ArenaMovementResult {
  const resolvedStart = resolveArenaWallOverlaps(from, radius, halfHeight);
  let current = resolvedStart.position;
  let remaining = {
    x: to.x - from.x,
    y: to.y - from.y,
    z: to.z - from.z,
  };
  let firstContact = resolvedStart.contact;
  for (let pass = 0; pass < 4; pass++) {
    const target = {
      x: current.x + remaining.x,
      y: current.y + remaining.y,
      z: current.z + remaining.z,
    };
    let earliest: SweepCandidate | undefined;
    for (const wall of ARENA_WALLS) {
      const candidate = sweepCircleAgainstWall(
        current,
        target,
        wall,
        radius,
        halfHeight,
      );
      if (candidate && (!earliest || candidate.time < earliest.time))
        earliest = candidate;
    }
    if (!earliest) {
      current = resolveArenaWallOverlaps(target, radius, halfHeight).position;
      break;
    }
    firstContact ??= earliest;
    current = {
      x: current.x + remaining.x * earliest.time,
      y: current.y + remaining.y * earliest.time,
      z: current.z + remaining.z * earliest.time,
    };
    const remainingScale = 1 - earliest.time;
    remaining = {
      x: remaining.x * remainingScale,
      y: remaining.y * remainingScale,
      z: remaining.z * remainingScale,
    };
    const inward =
      remaining.x * earliest.normal.x + remaining.z * earliest.normal.z;
    if (inward < 0) {
      remaining.x -= earliest.normal.x * inward;
      remaining.z -= earliest.normal.z * inward;
    }
    if (Math.hypot(remaining.x, remaining.y, remaining.z) < COLLISION_EPSILON)
      break;
  }
  return { position: current, contact: firstContact };
}

export function resolvePredictedWalls(
  position: Vec3,
  radius = PLAYER_RADIUS,
): Vec3 {
  return resolveArenaWallOverlaps(position, radius).position;
}

export type ArenaSegmentHit = { wall: ArenaWall; time: number };

function pointWallDistanceSquared(
  from: Vec3,
  to: Vec3,
  wall: ArenaWall,
  time: number,
): number {
  const x = from.x + (to.x - from.x) * time;
  const y = from.y + (to.y - from.y) * time;
  const z = from.z + (to.z - from.z) * time;
  const dx = Math.max(wall.minX - x, 0, x - wall.maxX);
  const dy = Math.max(-y, 0, y - wall.height);
  const dz = Math.max(wall.minZ - z, 0, z - wall.maxZ);
  return dx * dx + dy * dy + dz * dz;
}

function paddedWallEntryTime(
  from: Vec3,
  to: Vec3,
  wall: ArenaWall,
  padding: number,
): number | undefined {
  const radiusSquared = padding * padding;
  if (
    pointWallDistanceSquared(from, to, wall, 0) <=
    radiusSquared + COLLISION_EPSILON
  )
    return 0;
  let minimumLeft = 0;
  let minimumRight = 1;
  for (let iteration = 0; iteration < 32; iteration++) {
    const first = minimumLeft + (minimumRight - minimumLeft) / 3;
    const second = minimumRight - (minimumRight - minimumLeft) / 3;
    if (
      pointWallDistanceSquared(from, to, wall, first) <
      pointWallDistanceSquared(from, to, wall, second)
    )
      minimumRight = second;
    else minimumLeft = first;
  }
  const minimumTime = (minimumLeft + minimumRight) * 0.5;
  if (
    pointWallDistanceSquared(from, to, wall, minimumTime) >
    radiusSquared + COLLISION_EPSILON
  )
    return;
  let entryLeft = 0;
  let entryRight = minimumTime;
  for (let iteration = 0; iteration < 32; iteration++) {
    const middle = (entryLeft + entryRight) * 0.5;
    if (pointWallDistanceSquared(from, to, wall, middle) <= radiusSquared)
      entryRight = middle;
    else entryLeft = middle;
  }
  return entryRight;
}

export function firstArenaWallIntersection(
  from: Vec3,
  to: Vec3,
  padding = 0,
): ArenaSegmentHit | undefined {
  let closest: ArenaSegmentHit | undefined;
  for (const wall of ARENA_WALLS) {
    if (padding > COLLISION_EPSILON) {
      const time = paddedWallEntryTime(from, to, wall, padding);
      if (time !== undefined && (!closest || time < closest.time))
        closest = { wall, time };
      continue;
    }
    let enter = 0;
    let exit = 1;
    for (const [start, delta, min, max] of [
      [from.x, to.x - from.x, wall.minX, wall.maxX],
      [from.y, to.y - from.y, 0, wall.height],
      [from.z, to.z - from.z, wall.minZ, wall.maxZ],
    ] as const) {
      if (Math.abs(delta) < COLLISION_EPSILON) {
        if (start < min || start > max) {
          enter = 2;
          break;
        }
        continue;
      }
      const near = (min - start) / delta;
      const far = (max - start) / delta;
      enter = Math.max(enter, Math.min(near, far));
      exit = Math.min(exit, Math.max(near, far));
    }
    if (
      enter <= exit &&
      exit >= 0 &&
      enter <= 1 &&
      (!closest || enter < closest.time)
    )
      closest = { wall, time: Math.max(0, enter) };
  }
  return closest;
}

export function segmentCrossesArenaWall(
  from: Vec3,
  to: Vec3,
  padding = 0,
): boolean {
  return Boolean(firstArenaWallIntersection(from, to, padding));
}

export function segmentCrossesArenaFloor(
  from: Vec3,
  to: Vec3,
  padding = 0,
): boolean {
  let enter = 0;
  let exit = 1;
  for (const [start, delta, min, max] of [
    [
      from.x,
      to.x - from.x,
      -GAME.arenaHalfSize - padding,
      GAME.arenaHalfSize + padding,
    ],
    [
      from.y,
      to.y - from.y,
      ARENA_FLOOR_BOTTOM - padding,
      ARENA_FLOOR_TOP + padding,
    ],
    [
      from.z,
      to.z - from.z,
      -GAME.arenaHalfSize - padding,
      GAME.arenaHalfSize + padding,
    ],
  ] as const) {
    if (Math.abs(delta) < COLLISION_EPSILON) {
      if (start < min || start > max) return false;
      continue;
    }
    const near = (min - start) / delta;
    const far = (max - start) / delta;
    enter = Math.max(enter, Math.min(near, far));
    exit = Math.min(exit, Math.max(near, far));
  }
  return enter <= exit && exit >= 0 && enter <= 1;
}

function closestSegmentPoints(
  firstStart: Vec3,
  firstEnd: Vec3,
  secondStart: Vec3,
  secondEnd: Vec3,
) {
  const first = {
    x: firstEnd.x - firstStart.x,
    y: firstEnd.y - firstStart.y,
    z: firstEnd.z - firstStart.z,
  };
  const second = {
    x: secondEnd.x - secondStart.x,
    y: secondEnd.y - secondStart.y,
    z: secondEnd.z - secondStart.z,
  };
  const offset = {
    x: firstStart.x - secondStart.x,
    y: firstStart.y - secondStart.y,
    z: firstStart.z - secondStart.z,
  };
  const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
  const firstLength = dot(first, first);
  const secondLength = dot(second, second);
  const secondOffset = dot(second, offset);
  let firstTime = 0;
  let secondTime = 0;
  if (firstLength <= COLLISION_EPSILON) {
    secondTime =
      secondLength <= COLLISION_EPSILON
        ? 0
        : clamp(secondOffset / secondLength, 0, 1);
  } else {
    const firstOffset = dot(first, offset);
    if (secondLength <= COLLISION_EPSILON) {
      firstTime = clamp(-firstOffset / firstLength, 0, 1);
    } else {
      const cross = dot(first, second);
      const denominator = firstLength * secondLength - cross * cross;
      firstTime =
        denominator > COLLISION_EPSILON
          ? clamp(
              (cross * secondOffset - firstOffset * secondLength) / denominator,
              0,
              1,
            )
          : 0;
      secondTime = (cross * firstTime + secondOffset) / secondLength;
      if (secondTime < 0) {
        secondTime = 0;
        firstTime = clamp(-firstOffset / firstLength, 0, 1);
      } else if (secondTime > 1) {
        secondTime = 1;
        firstTime = clamp((cross - firstOffset) / firstLength, 0, 1);
      }
    }
  }
  const firstPoint = {
    x: firstStart.x + first.x * firstTime,
    y: firstStart.y + first.y * firstTime,
    z: firstStart.z + first.z * firstTime,
  };
  const secondPoint = {
    x: secondStart.x + second.x * secondTime,
    y: secondStart.y + second.y * secondTime,
    z: secondStart.z + second.z * secondTime,
  };
  const distanceSquared =
    (firstPoint.x - secondPoint.x) ** 2 +
    (firstPoint.y - secondPoint.y) ** 2 +
    (firstPoint.z - secondPoint.z) ** 2;
  return { firstTime, firstPoint, secondPoint, distanceSquared };
}

export function attackDirection(yaw: number, pitch: number): Vec3 {
  const safePitch = clamp(
    pitch,
    -ATTACK_HITBOX.maxPitch,
    ATTACK_HITBOX.maxPitch,
  );
  const horizontal = Math.cos(safePitch);
  return {
    x: -Math.sin(yaw) * horizontal,
    y: Math.sin(safePitch),
    z: -Math.cos(yaw) * horizontal,
  };
}

export type AttackTargetHit = {
  score: number;
  point: Vec3;
  attackDistance: number;
};

export function attackTargetHit(
  attackerPosition: Vec3,
  targetPosition: Vec3,
  yaw: number,
  pitch: number,
  kind: AttackKind,
): AttackTargetHit | undefined {
  const direction = attackDirection(yaw, pitch);
  const reach =
    GAME.punchRange + (kind === "heavy" ? ATTACK_HITBOX.heavyReachBonus : 0);
  const origin = {
    x: attackerPosition.x,
    y: attackerPosition.y + ATTACK_HITBOX.originHeight,
    z: attackerPosition.z,
  };
  const end = {
    x: origin.x + direction.x * reach,
    y: origin.y + direction.y * reach,
    z: origin.z + direction.z * reach,
  };
  const targetCenterY = targetPosition.y + FIGHTER_HURTBOX.centerOffsetY;
  const targetBottom = {
    x: targetPosition.x,
    y: targetCenterY - FIGHTER_HURTBOX.halfSegment,
    z: targetPosition.z,
  };
  const targetTop = {
    x: targetPosition.x,
    y: targetCenterY + FIGHTER_HURTBOX.halfSegment,
    z: targetPosition.z,
  };
  const forwardProjection =
    (targetPosition.x - origin.x) * direction.x +
    (targetCenterY - origin.y) * direction.y +
    (targetPosition.z - origin.z) * direction.z;
  if (forwardProjection <= 0.08) return;
  const closest = closestSegmentPoints(origin, end, targetBottom, targetTop);
  const combinedRadius = ATTACK_HITBOX.radius + FIGHTER_HURTBOX.radius;
  if (closest.distanceSquared > combinedRadius * combinedRadius) return;

  const distanceToTargetAxis = (time: number) => {
    const point = {
      x: origin.x + direction.x * reach * time,
      y: origin.y + direction.y * reach * time,
      z: origin.z + direction.z * reach * time,
    };
    const axisPoint = {
      x: targetPosition.x,
      y: clamp(point.y, targetBottom.y, targetTop.y),
      z: targetPosition.z,
    };
    return {
      point,
      axisPoint,
      distanceSquared:
        (point.x - axisPoint.x) ** 2 +
        (point.y - axisPoint.y) ** 2 +
        (point.z - axisPoint.z) ** 2,
    };
  };
  let contactTime = 0;
  if (distanceToTargetAxis(0).distanceSquared > combinedRadius ** 2) {
    let left = 0;
    let right = closest.firstTime;
    for (let iteration = 0; iteration < 32; iteration++) {
      const middle = (left + right) * 0.5;
      if (distanceToTargetAxis(middle).distanceSquared <= combinedRadius ** 2)
        right = middle;
      else left = middle;
    }
    contactTime = right;
  }
  const contact = distanceToTargetAxis(contactTime);
  if (
    contactTime > COLLISION_EPSILON &&
    (firstArenaWallIntersection(origin, contact.point, ATTACK_HITBOX.radius) ||
      segmentCrossesArenaFloor(origin, contact.point, ATTACK_HITBOX.radius))
  )
    return;

  const distance = Math.sqrt(contact.distanceSquared);
  const contactScale =
    distance > COLLISION_EPSILON ? FIGHTER_HURTBOX.radius / distance : 0;
  const point = {
    x:
      contact.axisPoint.x +
      (contact.point.x - contact.axisPoint.x) * contactScale,
    y:
      contact.axisPoint.y +
      (contact.point.y - contact.axisPoint.y) * contactScale,
    z:
      contact.axisPoint.z +
      (contact.point.z - contact.axisPoint.z) * contactScale,
  };
  const attackDistance = contactTime * reach;
  return {
    score: Math.sqrt(closest.distanceSquared) * 4 + attackDistance * 0.1,
    point,
    attackDistance,
  };
}
