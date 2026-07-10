import {
  ARENA_WALLS,
  GAME,
  PLAYER_RADIUS,
  knockbackForce,
  type AttackKind,
  type PlayerSnapshot,
  type Vec3,
} from "@knockout/shared";

export type InputState = {
  moveX: number;
  moveZ: number;
  yaw: number;
  jump: boolean;
  dash: boolean;
  blocking: boolean;
};
export type PositionSample = { time: number; position: Vec3 };
export type SimPlayer = PlayerSnapshot & {
  input: InputState;
  grounded: boolean;
  lastAttack: number;
  lastDash: number;
  dashUntil: number;
  lastAttacker?: string;
  respawnAt: number;
  protectionUntil: number;
  blockStarted: number;
  lastWallHit: number;
  airRecoveryAvailable: boolean;
  lastChat: number;
  lastComboAt: number;
  comboTargetId?: string;
  damageContributors: Map<string, number>;
  hitStunUntil: number;
  hitWindowStartedAt: number;
  recentHitCount: number;
  resistanceUntil: number;
  finisherUntil: number;
  positionHistory: PositionSample[];
};

export type StepResult = {
  knockedOut: boolean;
  wallHit?: { position: Vec3; intensity: number };
};

const spawnPoints: Vec3[] = [
  { x: -7, y: 1.1, z: -7 },
  { x: 7, y: 1.1, z: 7 },
  { x: 7, y: 1.1, z: -7 },
  { x: -7, y: 1.1, z: 7 },
];

export function createPlayer(
  id: string,
  name: string,
  index: number,
  bot = false,
): SimPlayer {
  const spawn = spawnPoints[index % spawnPoints.length] ?? spawnPoints[0]!;
  return {
    id,
    name,
    position: { ...spawn },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    knockback: 0,
    score: 0,
    assists: 0,
    falls: 0,
    combo: 0,
    lastProcessedInput: -1,
    stocksRemaining: 3,
    eliminated: false,
    blocking: false,
    protected: true,
    ready: bot,
    host: false,
    bot,
    input: {
      moveX: 0,
      moveZ: 0,
      yaw: 0,
      jump: false,
      dash: false,
      blocking: false,
    },
    grounded: true,
    lastAttack: 0,
    lastDash: 0,
    dashUntil: 0,
    respawnAt: 0,
    protectionUntil: Date.now() + GAME.spawnProtectionMs,
    blockStarted: 0,
    lastWallHit: 0,
    airRecoveryAvailable: true,
    lastChat: 0,
    lastComboAt: 0,
    damageContributors: new Map(),
    hitStunUntil: 0,
    hitWindowStartedAt: 0,
    recentHitCount: 0,
    resistanceUntil: 0,
    finisherUntil: 0,
    positionHistory: [{ time: Date.now(), position: { ...spawn } }],
  };
}

export function respawn(player: SimPlayer, index: number, now: number): void {
  const spawn = spawnPoints[index % spawnPoints.length] ?? spawnPoints[0]!;
  player.position = { ...spawn };
  player.velocity = { x: 0, y: 0, z: 0 };
  player.knockback = Math.max(0, player.knockback - 18);
  player.grounded = true;
  player.respawnAt = 0;
  player.protectionUntil = now + GAME.spawnProtectionMs;
  player.protected = true;
  player.airRecoveryAvailable = true;
  player.dashUntil = 0;
  player.damageContributors.clear();
  player.hitStunUntil = 0;
  player.recentHitCount = 0;
  player.resistanceUntil = 0;
  player.finisherUntil = 0;
  player.lastAttacker = undefined;
  player.eliminated = false;
  player.positionHistory = [{ time: now, position: { ...player.position } }];
}

function resolveWalls(player: SimPlayer, now: number): StepResult["wallHit"] {
  if (player.position.y > 4.8) return undefined;
  for (const wall of ARENA_WALLS) {
    const minX = wall.minX - PLAYER_RADIUS,
      maxX = wall.maxX + PLAYER_RADIUS;
    const minZ = wall.minZ - PLAYER_RADIUS,
      maxZ = wall.maxZ + PLAYER_RADIUS;
    if (
      player.position.x <= minX ||
      player.position.x >= maxX ||
      player.position.z <= minZ ||
      player.position.z >= maxZ ||
      player.position.y > wall.height + 1.1
    )
      continue;
    const sides = [
      { depth: player.position.x - minX, nx: -1, nz: 0, x: minX },
      { depth: maxX - player.position.x, nx: 1, nz: 0, x: maxX },
      { depth: player.position.z - minZ, nx: 0, nz: -1, z: minZ },
      { depth: maxZ - player.position.z, nx: 0, nz: 1, z: maxZ },
    ];
    sides.sort((a, b) => a.depth - b.depth);
    const side = sides[0]!;
    if (side.x !== undefined) player.position.x = side.x;
    if (side.z !== undefined) player.position.z = side.z;
    const normalVelocity =
      player.velocity.x * side.nx + player.velocity.z * side.nz;
    const intensity = Math.max(0, -normalVelocity);
    if (normalVelocity < 0) {
      player.velocity.x -= side.nx * normalVelocity * 1.28;
      player.velocity.z -= side.nz * normalVelocity * 1.28;
    }
    if (intensity >= 7 && now - player.lastWallHit > 450) {
      player.lastWallHit = now;
      player.knockback = Math.min(
        300,
        player.knockback + Math.min(5, intensity * 0.28),
      );
      return { position: { ...player.position }, intensity };
    }
  }
  return undefined;
}

export function stepPlayer(
  player: SimPlayer,
  dt: number,
  now: number,
): StepResult {
  if (player.respawnAt) return { knockedOut: false };
  player.protected = now < player.protectionUntil;
  player.yaw = player.input.yaw;
  if (player.input.blocking !== player.blocking) {
    player.blocking = player.input.blocking;
    if (player.blocking) player.blockStarted = now;
  }
  const sin = Math.sin(player.yaw),
    cos = Math.cos(player.yaw);
  const worldX = player.input.moveX * cos + player.input.moveZ * sin;
  const worldZ = -player.input.moveX * sin + player.input.moveZ * cos;
  const length = Math.hypot(worldX, worldZ) || 1;
  const stunned = now < player.hitStunUntil;
  const speed =
    (player.grounded ? GAME.moveSpeed : GAME.airSpeed) *
    (player.bot ? 0.62 : 1);
  const targetX = stunned ? 0 : (worldX / length) * speed;
  const targetZ = stunned ? 0 : (worldZ / length) * speed;
  const dashing = now < player.dashUntil;
  const control = Math.min(1, dt * (dashing ? 0.75 : player.grounded ? 13 : 3));
  player.velocity.x += (targetX - player.velocity.x) * control;
  player.velocity.z += (targetZ - player.velocity.z) * control;
  if (!stunned && player.input.jump && player.grounded) {
    player.velocity.y = GAME.jumpSpeed;
    player.grounded = false;
  }
  if (
    !stunned &&
    player.input.dash &&
    now - player.lastDash >= GAME.dashCooldownMs &&
    (worldX || worldZ) &&
    (player.grounded || player.airRecoveryAvailable)
  ) {
    const dashSpeed = player.grounded ? GAME.dashSpeed : GAME.dashSpeed * 0.82;
    player.velocity.x = (worldX / length) * dashSpeed;
    player.velocity.z = (worldZ / length) * dashSpeed;
    if (!player.grounded) {
      player.airRecoveryAvailable = false;
      player.velocity.y = Math.max(player.velocity.y, 2.8);
    }
    player.lastDash = now;
    player.dashUntil = now + GAME.dashDurationMs;
  }
  player.input.jump = false;
  player.input.dash = false;
  player.velocity.y -= GAME.gravity * dt;
  const travel =
    Math.max(
      Math.abs(player.velocity.x),
      Math.abs(player.velocity.y),
      Math.abs(player.velocity.z),
    ) * dt;
  const substeps = Math.min(10, Math.max(1, Math.ceil(travel / 0.28)));
  let wallHit: StepResult["wallHit"];
  for (let step = 0; step < substeps; step++) {
    player.position.x += (player.velocity.x * dt) / substeps;
    player.position.y += (player.velocity.y * dt) / substeps;
    player.position.z += (player.velocity.z * dt) / substeps;
    if (now >= player.finisherUntil) wallHit ??= resolveWalls(player, now);
  }
  const onPlatform =
    Math.abs(player.position.x) < GAME.arenaHalfSize &&
    Math.abs(player.position.z) < GAME.arenaHalfSize;
  if (onPlatform && player.position.y <= 1.1) {
    player.position.y = 1.1;
    player.velocity.y = 0;
    player.grounded = true;
    player.airRecoveryAvailable = true;
  }
  player.positionHistory.push({ time: now, position: { ...player.position } });
  while (
    player.positionHistory.length > 2 &&
    player.positionHistory[0]!.time < now - 300
  )
    player.positionHistory.shift();
  return { knockedOut: player.position.y < GAME.deathHeight, wallHit };
}

function historicalPosition(player: SimPlayer, targetTime: number): Vec3 {
  const history = player.positionHistory;
  if (!history.length || targetTime >= history[history.length - 1]!.time)
    return { ...player.position };
  let before = history[0]!,
    after = history[history.length - 1]!;
  for (let i = 1; i < history.length; i++) {
    if (history[i]!.time >= targetTime) {
      before = history[i - 1]!;
      after = history[i]!;
      break;
    }
  }
  const span = Math.max(1, after.time - before.time),
    t = Math.max(0, Math.min(1, (targetTime - before.time) / span));
  return {
    x: before.position.x + (after.position.x - before.position.x) * t,
    y: before.position.y + (after.position.y - before.position.y) * t,
    z: before.position.z + (after.position.z - before.position.z) * t,
  };
}

function blockingWall(from: Vec3, to: Vec3) {
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
    if (enter <= exit && exit >= 0 && enter <= 1) return wall;
  }
  return undefined;
}

function segmentCrossesWall(from: Vec3, to: Vec3): boolean {
  return Boolean(blockingWall(from, to));
}

export function botNavigationTarget(from: Vec3, requestedTarget: Vec3): Vec3 {
  const target = {
    x: Math.max(-13, Math.min(13, requestedTarget.x)),
    y: 1.1,
    z: Math.max(-13, Math.min(13, requestedTarget.z)),
  };
  const wall = blockingWall(from, target);
  if (!wall) return target;
  const margin = PLAYER_RADIUS + 0.9;
  const corners = [
    { x: wall.minX - margin, y: 1.1, z: wall.minZ - margin },
    { x: wall.minX - margin, y: 1.1, z: wall.maxZ + margin },
    { x: wall.maxX + margin, y: 1.1, z: wall.minZ - margin },
    { x: wall.maxX + margin, y: 1.1, z: wall.maxZ + margin },
  ].filter(
    (point) =>
      Math.abs(point.x) < 14 &&
      Math.abs(point.z) < 14 &&
      !segmentCrossesWall(from, point),
  );
  return (
    corners.sort(
      (a, b) =>
        Math.hypot(a.x - from.x, a.z - from.z) +
        Math.hypot(target.x - a.x, target.z - a.z) -
        Math.hypot(b.x - from.x, b.z - from.z) -
        Math.hypot(target.x - b.x, target.z - b.z),
    )[0] ?? { x: 0, y: 1.1, z: 0 }
  );
}

export function performAttack(
  attacker: SimPlayer,
  players: Iterable<SimPlayer>,
  kind: AttackKind,
  charge: number,
  yaw: number,
  now: number,
  requestedRewindMs = 0,
  knockbackMultiplier = 1,
  canHit: (target: SimPlayer) => boolean = () => true,
) {
  if (attacker.respawnAt || attacker.eliminated) return undefined;
  attacker.protectionUntil = 0;
  attacker.protected = false;
  const cooldown =
    kind === "heavy" ? GAME.heavyCooldownMs : GAME.punchCooldownMs;
  if (now - attacker.lastAttack < cooldown) return undefined;
  attacker.lastAttack = now;
  const fx = -Math.sin(yaw),
    fz = -Math.cos(yaw);
  const rewindMs = Math.max(0, Math.min(150, requestedRewindMs));
  const targetTime = now - rewindMs;
  const attackerPosition = rewindMs
    ? historicalPosition(attacker, targetTime)
    : attacker.position;
  let target: SimPlayer | undefined;
  let best = GAME.punchRange + (kind === "heavy" ? 0.35 : 0);
  for (const candidate of players) {
    if (
      candidate.id === attacker.id ||
      candidate.respawnAt ||
      candidate.eliminated ||
      now < candidate.protectionUntil ||
      !canHit(candidate)
    )
      continue;
    const candidatePosition = rewindMs
      ? historicalPosition(candidate, targetTime)
      : candidate.position;
    const dx = candidatePosition.x - attackerPosition.x;
    const dz = candidatePosition.z - attackerPosition.z;
    const centerDistance = Math.hypot(dx, dz);
    const distance = Math.max(0, centerDistance - PLAYER_RADIUS * 0.65);
    const facing = (dx * fx + dz * fz) / Math.max(centerDistance, 0.001);
    if (
      distance < best &&
      facing > 0.27 &&
      Math.abs(candidatePosition.y - attackerPosition.y) < 2.85 &&
      !segmentCrossesWall(attackerPosition, candidatePosition)
    ) {
      target = candidate;
      best = distance;
    }
  }
  if (!target) return undefined;
  const parried = target.blocking && now - target.blockStarted < 190;
  const defended = target.blocking ? (parried ? 0.025 : 0.14) : 1;
  const safeCharge = kind === "heavy" ? Math.min(1, Math.max(0.15, charge)) : 0;
  const finisher =
    !target.blocking &&
    kind === "heavy" &&
    safeCharge >= 0.65 &&
    target.knockback >= 100;
  const force =
    knockbackForce(target.knockback, safeCharge) *
    defended *
    Math.max(0.5, Math.min(2, knockbackMultiplier)) *
    (finisher ? 1.8 : 1);
  target.velocity.x += fx * force;
  target.velocity.z += fz * force;
  target.velocity.y = Math.max(
    target.velocity.y,
    finisher ? 10.5 : 3.6 + force * 0.18,
  );
  target.grounded = false;
  target.knockback = Math.min(
    300,
    target.knockback + (kind === "heavy" ? 17 + safeCharge * 8 : 10) * defended,
  );
  target.lastAttacker = attacker.id;
  target.damageContributors.set(attacker.id, now);
  if (now - target.hitWindowStartedAt > 2_400) {
    target.hitWindowStartedAt = now;
    target.recentHitCount = 0;
  }
  target.recentHitCount++;
  if (target.recentHitCount >= 3) target.resistanceUntil = now + 750;
  const resistance =
    now < target.resistanceUntil
      ? 0.35
      : Math.max(0.5, 1 - (target.recentHitCount - 1) * 0.16);
  target.hitStunUntil = Math.max(
    target.hitStunUntil,
    now +
      (finisher ? 800 : (kind === "heavy" ? 210 : 120) * resistance * defended),
  );
  if (finisher) target.finisherUntil = now + 650;
  attacker.combo =
    attacker.comboTargetId === target.id && now - attacker.lastComboAt < 1_600
      ? attacker.combo + 1
      : 1;
  attacker.comboTargetId = target.id;
  attacker.lastComboAt = now;
  if (parried) {
    attacker.velocity.x -= fx * 3.5;
    attacker.velocity.z -= fz * 3.5;
  }
  return { victim: target, parried, blocked: target.blocking, finisher };
}

export function creditKnockout(
  victim: SimPlayer,
  players: Map<string, SimPlayer>,
  now: number,
) {
  victim.falls++;
  const attacker = victim.lastAttacker
    ? players.get(victim.lastAttacker)
    : undefined;
  if (attacker) attacker.score++;
  const assistIds: string[] = [];
  for (const [playerId, hitAt] of victim.damageContributors) {
    if (playerId === attacker?.id || now - hitAt > 5_000) continue;
    const assistant = players.get(playerId);
    if (assistant) {
      assistant.assists++;
      assistIds.push(playerId);
    }
  }
  victim.damageContributors.clear();
  return { attacker, assistIds };
}
