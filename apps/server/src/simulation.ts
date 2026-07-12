import {
  attackDirection,
  attackTargetHit,
  GAME,
  movementBlendFactor,
  PLAYER_HALF_HEIGHT,
  PLAYER_RADIUS,
  knockbackForce,
  resolveArenaWallOverlaps,
  sweepArenaWalls,
  type AttackKind,
  type PlayerSnapshot,
  type Vec3,
} from "@knockout/shared";

export type InputState = {
  moveX: number;
  moveZ: number;
  yaw: number;
  pitch: number;
  jump: boolean;
  dash: boolean;
  blocking: boolean;
  charging: boolean;
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
  blockCooldownUntil: number;
  chargeStarted: number;
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
    pitch: 0,
    knockback: 0,
    score: 0,
    assists: 0,
    falls: 0,
    combo: 0,
    lastProcessedInput: -1,
    stocksRemaining: 3,
    eliminated: false,
    blocking: false,
    charging: false,
    protected: true,
    ready: bot,
    host: false,
    bot,
    input: {
      moveX: 0,
      moveZ: 0,
      yaw: 0,
      pitch: 0,
      jump: false,
      dash: false,
      blocking: false,
      charging: false,
    },
    grounded: true,
    lastAttack: 0,
    lastDash: 0,
    dashUntil: 0,
    respawnAt: 0,
    protectionUntil: Date.now() + GAME.spawnProtectionMs,
    blockStarted: 0,
    blockCooldownUntil: 0,
    chargeStarted: 0,
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
  player.knockback = 0;
  player.grounded = true;
  player.respawnAt = 0;
  player.protectionUntil = now + GAME.spawnProtectionMs;
  player.protected = true;
  player.airRecoveryAvailable = true;
  player.dashUntil = 0;
  player.blocking = false;
  player.charging = false;
  player.input.blocking = false;
  player.input.charging = false;
  player.blockStarted = 0;
  player.blockCooldownUntil = 0;
  player.chargeStarted = 0;
  player.damageContributors.clear();
  player.hitStunUntil = 0;
  player.recentHitCount = 0;
  player.resistanceUntil = 0;
  player.finisherUntil = 0;
  player.lastAttacker = undefined;
  player.eliminated = false;
  player.positionHistory = [{ time: now, position: { ...player.position } }];
}

function resolveWalls(
  player: SimPlayer,
  from: Vec3,
  intended: Vec3,
  now: number,
): StepResult["wallHit"] {
  const result = sweepArenaWalls(from, intended);
  player.position = result.position;
  if (!result.contact) return undefined;
  const { normal } = result.contact;
  const normalVelocity =
    player.velocity.x * normal.x + player.velocity.z * normal.z;
  const intensity = Math.max(0, -normalVelocity);
  if (normalVelocity < 0) {
    player.velocity.x -= normal.x * normalVelocity;
    player.velocity.z -= normal.z * normalVelocity;
  }
  if (intensity < 7 || now - player.lastWallHit <= 450) return undefined;
  player.lastWallHit = now;
  player.knockback = Math.min(
    300,
    player.knockback + Math.min(5, intensity * 0.28),
  );
  return { position: { ...player.position }, intensity };
}

export function stepPlayer(
  player: SimPlayer,
  dt: number,
  now: number,
): StepResult {
  if (player.respawnAt) return { knockedOut: false };
  player.protected = now < player.protectionUntil;
  player.yaw = player.input.yaw;
  player.pitch = player.input.pitch;
  const wantsCharging =
    player.input.charging && !player.input.blocking && !player.blocking;
  if (wantsCharging && !player.charging) {
    player.charging = true;
    player.chargeStarted = now;
  } else if (!wantsCharging && player.charging) {
    player.charging = false;
  }
  if (player.blocking && now - player.blockStarted >= GAME.blockMaxHoldMs) {
    player.blocking = false;
    player.blockCooldownUntil = now + GAME.blockCooldownMs;
  }
  const wantsBlock =
    player.input.blocking &&
    !player.input.charging &&
    !player.charging &&
    now >= player.blockCooldownUntil;
  if (wantsBlock !== player.blocking) {
    player.blocking = wantsBlock;
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
    (player.bot ? 0.62 : 1) *
    (player.charging ? 0.52 : 1);
  const targetX = stunned ? 0 : (worldX / length) * speed;
  const targetZ = stunned ? 0 : (worldZ / length) * speed;
  const dashing = now < player.dashUntil;
  const control = movementBlendFactor(
    dt,
    player.grounded,
    dashing,
    Boolean(worldX || worldZ),
  );
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
  let floorContact = false;
  for (let step = 0; step < substeps; step++) {
    const previous = { ...player.position };
    const intended = {
      x: previous.x + (player.velocity.x * dt) / substeps,
      y: previous.y + (player.velocity.y * dt) / substeps,
      z: previous.z + (player.velocity.z * dt) / substeps,
    };
    const overPlatform =
      Math.abs(intended.x) < GAME.arenaHalfSize &&
      Math.abs(intended.z) < GAME.arenaHalfSize;
    if (
      overPlatform &&
      previous.y >= PLAYER_HALF_HEIGHT &&
      intended.y <= PLAYER_HALF_HEIGHT
    ) {
      intended.y = PLAYER_HALF_HEIGHT;
      player.velocity.y = 0;
      floorContact = true;
      player.airRecoveryAvailable = true;
    } else if (
      overPlatform &&
      previous.y < PLAYER_HALF_HEIGHT &&
      player.velocity.y > 0
    ) {
      // Prevent an air dash from phasing upward through the solid arena floor.
      intended.y = Math.min(intended.y, PLAYER_HALF_HEIGHT - 0.001);
      player.velocity.y = 0;
    }
    if (now < player.finisherUntil) player.position = intended;
    else {
      const impact = resolveWalls(player, previous, intended, now);
      wallHit ??= impact;
    }
  }
  player.grounded = floorContact;
  player.positionHistory.push({ time: now, position: { ...player.position } });
  while (
    player.positionHistory.length > 2 &&
    player.positionHistory[0]!.time < now - 300
  )
    player.positionHistory.shift();
  return { knockedOut: player.position.y < GAME.deathHeight, wallHit };
}

function resolveSweptPlayerContact(
  first: SimPlayer,
  second: SimPlayer,
  minimumDistance: number,
): boolean {
  const firstStart = first.positionHistory.at(-2)?.position ?? first.position;
  const secondStart =
    second.positionHistory.at(-2)?.position ?? second.position;
  if (
    Math.max(
      Math.abs(firstStart.y - secondStart.y),
      Math.abs(first.position.y - second.position.y),
    ) >=
    PLAYER_HALF_HEIGHT * 2
  )
    return false;
  const relativeStart = {
    x: secondStart.x - firstStart.x,
    z: secondStart.z - firstStart.z,
  };
  const firstTravel = {
    x: first.position.x - firstStart.x,
    z: first.position.z - firstStart.z,
  };
  const secondTravel = {
    x: second.position.x - secondStart.x,
    z: second.position.z - secondStart.z,
  };
  const relativeTravel = {
    x: secondTravel.x - firstTravel.x,
    z: secondTravel.z - firstTravel.z,
  };
  const quadratic =
    relativeTravel.x * relativeTravel.x + relativeTravel.z * relativeTravel.z;
  if (quadratic < 1e-8) return false;
  const linear =
    2 *
    (relativeStart.x * relativeTravel.x + relativeStart.z * relativeTravel.z);
  const constant =
    relativeStart.x * relativeStart.x +
    relativeStart.z * relativeStart.z -
    minimumDistance * minimumDistance;
  if (constant <= 0 || linear >= 0) return false;
  const discriminant = linear * linear - 4 * quadratic * constant;
  if (discriminant < 0) return false;
  const time = (-linear - Math.sqrt(discriminant)) / (2 * quadratic);
  if (time < 0 || time > 1) return false;

  const firstContact = {
    x: firstStart.x + firstTravel.x * time,
    z: firstStart.z + firstTravel.z * time,
  };
  const secondContact = {
    x: secondStart.x + secondTravel.x * time,
    z: secondStart.z + secondTravel.z * time,
  };
  const distance = Math.hypot(
    secondContact.x - firstContact.x,
    secondContact.z - firstContact.z,
  );
  if (distance < 1e-8) return false;
  const normal = {
    x: (secondContact.x - firstContact.x) / distance,
    z: (secondContact.z - firstContact.z) / distance,
  };
  const firstRemaining = {
    x: firstTravel.x * (1 - time),
    z: firstTravel.z * (1 - time),
  };
  const secondRemaining = {
    x: secondTravel.x * (1 - time),
    z: secondTravel.z * (1 - time),
  };
  const closing =
    (secondRemaining.x - firstRemaining.x) * normal.x +
    (secondRemaining.z - firstRemaining.z) * normal.z;
  if (closing >= 0) return false;
  firstRemaining.x += normal.x * closing * 0.5;
  firstRemaining.z += normal.z * closing * 0.5;
  secondRemaining.x -= normal.x * closing * 0.5;
  secondRemaining.z -= normal.z * closing * 0.5;
  first.position.x = firstContact.x + firstRemaining.x;
  first.position.z = firstContact.z + firstRemaining.z;
  second.position.x = secondContact.x + secondRemaining.x;
  second.position.z = secondContact.z + secondRemaining.z;
  const relativeNormalVelocity =
    (second.velocity.x - first.velocity.x) * normal.x +
    (second.velocity.z - first.velocity.z) * normal.z;
  if (relativeNormalVelocity < 0) {
    const correctionVelocity = relativeNormalVelocity * 0.5;
    first.velocity.x += normal.x * correctionVelocity;
    first.velocity.z += normal.z * correctionVelocity;
    second.velocity.x -= normal.x * correctionVelocity;
    second.velocity.z -= normal.z * correctionVelocity;
  }
  return true;
}

export function resolvePlayerCollisions(
  players: Iterable<SimPlayer>,
  now = Date.now(),
): void {
  const active = [...players]
    .filter(
      (player) =>
        !player.respawnAt &&
        !player.eliminated &&
        !player.protected &&
        now >= player.finisherUntil &&
        player.position.y > -PLAYER_HALF_HEIGHT,
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const minimumDistance = PLAYER_RADIUS * 2;
  for (let pass = 0; pass < 3; pass++) {
    let separated = false;
    for (let firstIndex = 0; firstIndex < active.length; firstIndex++) {
      const first = active[firstIndex]!;
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < active.length;
        secondIndex++
      ) {
        const second = active[secondIndex]!;
        if (
          pass === 0 &&
          resolveSweptPlayerContact(first, second, minimumDistance)
        ) {
          first.position = resolveArenaWallOverlaps(first.position).position;
          second.position = resolveArenaWallOverlaps(second.position).position;
          const firstHistory = first.positionHistory.at(-1);
          const secondHistory = second.positionHistory.at(-1);
          if (firstHistory) firstHistory.position = { ...first.position };
          if (secondHistory) secondHistory.position = { ...second.position };
          separated = true;
        }
        if (
          Math.abs(first.position.y - second.position.y) >=
          PLAYER_HALF_HEIGHT * 2
        )
          continue;
        const dx = second.position.x - first.position.x;
        const dz = second.position.z - first.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance >= minimumDistance - 1e-6) continue;
        const normal =
          distance > 1e-6
            ? { x: dx / distance, z: dz / distance }
            : { x: 1, z: 0 };
        const correction = (minimumDistance - distance) * 0.5;
        first.position.x -= normal.x * correction;
        first.position.z -= normal.z * correction;
        second.position.x += normal.x * correction;
        second.position.z += normal.z * correction;
        first.position = resolveArenaWallOverlaps(first.position).position;
        second.position = resolveArenaWallOverlaps(second.position).position;
        let remainingSeparation = Math.max(
          0,
          minimumDistance -
            ((second.position.x - first.position.x) * normal.x +
              (second.position.z - first.position.z) * normal.z),
        );
        if (remainingSeparation > 1e-6) {
          const before = { ...first.position };
          first.position.x -= normal.x * remainingSeparation;
          first.position.z -= normal.z * remainingSeparation;
          first.position = resolveArenaWallOverlaps(first.position).position;
          const gained = Math.max(
            0,
            -(
              (first.position.x - before.x) * normal.x +
              (first.position.z - before.z) * normal.z
            ),
          );
          remainingSeparation = Math.max(0, remainingSeparation - gained);
        }
        if (remainingSeparation > 1e-6) {
          second.position.x += normal.x * remainingSeparation;
          second.position.z += normal.z * remainingSeparation;
          second.position = resolveArenaWallOverlaps(second.position).position;
        }
        const firstHistory = first.positionHistory.at(-1);
        const secondHistory = second.positionHistory.at(-1);
        if (firstHistory) firstHistory.position = { ...first.position };
        if (secondHistory) secondHistory.position = { ...second.position };

        const relativeNormalVelocity =
          (second.velocity.x - first.velocity.x) * normal.x +
          (second.velocity.z - first.velocity.z) * normal.z;
        if (relativeNormalVelocity < 0) {
          const correctionVelocity = relativeNormalVelocity * 0.5;
          first.velocity.x += normal.x * correctionVelocity;
          first.velocity.z += normal.z * correctionVelocity;
          second.velocity.x -= normal.x * correctionVelocity;
          second.velocity.z -= normal.z * correctionVelocity;
        }
        separated = true;
      }
    }
    if (!separated) break;
  }
}

export function consumeHeavyCharge(
  player: SimPlayer,
  claimedCharge: number,
  now: number,
): number | undefined {
  if (player.blocking || !player.charging || player.chargeStarted <= 0)
    return undefined;
  const chargedFor = now - player.chargeStarted;
  player.charging = false;
  player.input.charging = false;
  player.chargeStarted = 0;
  if (chargedFor < GAME.heavyMinChargeMs) return undefined;
  const serverCharge = Math.min(1, chargedFor / GAME.heavyChargeMs);
  return Math.min(Math.max(0, claimedCharge), serverCharge);
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

function navigationWall(from: Vec3, to: Vec3) {
  return sweepArenaWalls(from, to).contact?.wall;
}

export function botNavigationTarget(from: Vec3, requestedTarget: Vec3): Vec3 {
  const target = {
    x: Math.max(-13, Math.min(13, requestedTarget.x)),
    y: 1.1,
    z: Math.max(-13, Math.min(13, requestedTarget.z)),
  };
  const wall = navigationWall(from, target);
  if (!wall) return target;
  const margin = PLAYER_RADIUS + 0.45;
  const corners = [
    { x: wall.minX - margin, y: 1.1, z: wall.minZ - margin },
    { x: wall.minX - margin, y: 1.1, z: wall.maxZ + margin },
    { x: wall.maxX + margin, y: 1.1, z: wall.minZ - margin },
    { x: wall.maxX + margin, y: 1.1, z: wall.maxZ + margin },
  ].filter(
    (point) =>
      Math.abs(point.x) < 14 &&
      Math.abs(point.z) < 14 &&
      !navigationWall(from, point),
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
  pitch = 0,
) {
  if (attacker.respawnAt || attacker.eliminated) return undefined;
  attacker.protectionUntil = 0;
  attacker.protected = false;
  const cooldown =
    kind === "heavy" ? GAME.heavyCooldownMs : GAME.punchCooldownMs;
  if (now - attacker.lastAttack < cooldown) return undefined;
  attacker.lastAttack = now;
  const direction = attackDirection(yaw, pitch);
  const horizontalLength = Math.max(
    0.001,
    Math.hypot(direction.x, direction.z),
  );
  const fx = direction.x / horizontalLength;
  const fz = direction.z / horizontalLength;
  const rewindMs = Math.max(0, Math.min(150, requestedRewindMs));
  const targetTime = now - rewindMs;
  const attackerPosition = rewindMs
    ? historicalPosition(attacker, targetTime)
    : attacker.position;
  let target: SimPlayer | undefined;
  let targetHit: ReturnType<typeof attackTargetHit> = undefined;
  let best = Number.POSITIVE_INFINITY;
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
    const hit = attackTargetHit(
      attackerPosition,
      candidatePosition,
      yaw,
      pitch,
      kind,
    );
    if (hit && hit.score < best) {
      target = candidate;
      targetHit = hit;
      best = hit.score;
    }
  }
  if (!target || !targetHit) return undefined;
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
    (finisher ? 1.5 : 1);
  target.velocity.x += fx * force;
  target.velocity.z += fz * force;
  target.velocity.y = Math.max(
    target.velocity.y,
    finisher ? 9 : 3.4 + force * 0.16,
  );
  target.grounded = false;
  target.knockback = Math.min(
    300,
    target.knockback + (kind === "heavy" ? 13 + safeCharge * 5 : 10) * defended,
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
  if (finisher) target.finisherUntil = now + GAME.finisherDurationMs;
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
  return {
    victim: target,
    parried,
    blocked: target.blocking,
    finisher,
    position: targetHit.point,
  };
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
