import {
  GAME,
  movementBlendFactor,
  PLAYER_HALF_HEIGHT,
  PLAYER_RADIUS,
  resolveArenaWallOverlaps,
  sweepArenaWalls,
  type PlayerSnapshot,
  type Vec3,
} from "@knockout/shared";

export class MovementPredictor {
  position: Vec3 = { x: 0, y: 0, z: 0 };
  private velocity = { x: 0, z: 0 };
  private initialized = false;
  private enabled = false;
  private grounded = true;
  private wallBypassUntil = 0;
  private dashRemaining = 0;
  private pendingSequences: number[] = [];
  private snapshotRevision = 0;
  private lastBodyCollisionRevision = -1;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  reconcile(snapshot: PlayerSnapshot): void {
    this.snapshotRevision++;
    if (snapshot.finisherRemainingMs !== undefined)
      this.wallBypassUntil =
        performance.now() + Math.max(0, snapshot.finisherRemainingMs);
    else if (snapshot.finisher)
      this.wallBypassUntil = performance.now() + GAME.finisherDurationMs;
    else this.wallBypassUntil = 0;
    this.pendingSequences = this.pendingSequences.filter(
      (sequence) => sequence > snapshot.lastProcessedInput,
    );
    if (!this.initialized) {
      this.position = { ...snapshot.position };
      this.velocity = { x: snapshot.velocity.x, z: snapshot.velocity.z };
      this.grounded = snapshot.grounded;
      this.initialized = true;
      return;
    }
    const dx = snapshot.position.x - this.position.x;
    const dz = snapshot.position.z - this.position.z;
    const error = Math.hypot(dx, dz);
    const authoritativeSpeed = Math.hypot(
      snapshot.velocity.x,
      snapshot.velocity.z,
    );
    const launched =
      !snapshot.grounded && authoritativeSpeed > GAME.airSpeed + 2;
    if (error > 7) {
      this.position.x = snapshot.position.x;
      this.position.z = snapshot.position.z;
      this.velocity = { x: snapshot.velocity.x, z: snapshot.velocity.z };
    } else if (launched) {
      this.position.x += dx * 0.55;
      this.position.z += dz * 0.55;
      this.velocity = { x: snapshot.velocity.x, z: snapshot.velocity.z };
    } else {
      this.position.x += dx * 0.22;
      this.position.z += dz * 0.22;
      this.velocity.x += (snapshot.velocity.x - this.velocity.x) * 0.08;
      this.velocity.z += (snapshot.velocity.z - this.velocity.z) * 0.08;
    }
    this.position.y = snapshot.position.y;
    this.grounded = snapshot.grounded;
  }

  update(dt: number, moveX: number, moveZ: number, yaw: number): void {
    if (!this.initialized || !this.enabled) return;
    const sin = Math.sin(yaw),
      cos = Math.cos(yaw);
    const worldX = moveX * cos + moveZ * sin;
    const worldZ = -moveX * sin + moveZ * cos;
    const length = Math.hypot(worldX, worldZ) || 1;
    const targetX = (worldX / length) * GAME.moveSpeed;
    const targetZ = (worldZ / length) * GAME.moveSpeed;
    const dashing = this.dashRemaining > 0;
    this.dashRemaining = Math.max(0, this.dashRemaining - dt);
    const control = movementBlendFactor(
      dt,
      this.grounded,
      dashing,
      Boolean(worldX || worldZ),
    );
    this.velocity.x += (targetX - this.velocity.x) * control;
    this.velocity.z += (targetZ - this.velocity.z) * control;
    const substeps = Math.min(
      10,
      Math.max(
        1,
        Math.ceil(
          (Math.max(Math.abs(this.velocity.x), Math.abs(this.velocity.z)) *
            dt) /
            0.28,
        ),
      ),
    );
    for (let step = 0; step < substeps; step++) {
      const intended = {
        ...this.position,
        x: this.position.x + (this.velocity.x * dt) / substeps,
        z: this.position.z + (this.velocity.z * dt) / substeps,
      };
      if (this.isBypassingWalls()) this.position = intended;
      else {
        const result = sweepArenaWalls(this.position, intended);
        this.position = result.position;
        if (result.contact) {
          const inward =
            this.velocity.x * result.contact.normal.x +
            this.velocity.z * result.contact.normal.z;
          if (inward < 0) {
            this.velocity.x -= result.contact.normal.x * inward;
            this.velocity.z -= result.contact.normal.z * inward;
          }
        }
      }
    }
  }

  resolvePlayerCollisions(
    local: PlayerSnapshot,
    targets: Iterable<PlayerSnapshot>,
  ): void {
    if (
      !this.initialized ||
      !this.enabled ||
      this.isBypassingWalls() ||
      local.protected ||
      this.lastBodyCollisionRevision === this.snapshotRevision
    )
      return;
    this.lastBodyCollisionRevision = this.snapshotRevision;
    for (const target of targets) {
      if (
        target.id === local.id ||
        target.eliminated ||
        target.protected ||
        Math.abs(target.position.y - this.position.y) >= PLAYER_HALF_HEIGHT * 2
      )
        continue;
      const dx = target.position.x - this.position.x;
      const dz = target.position.z - this.position.z;
      const distance = Math.hypot(dx, dz);
      const minimumDistance = PLAYER_RADIUS * 2;
      if (distance >= minimumDistance - 1e-6) continue;
      const normal =
        distance > 1e-6
          ? { x: dx / distance, z: dz / distance }
          : { x: local.id.localeCompare(target.id) < 0 ? 1 : -1, z: 0 };
      const correction = (minimumDistance - distance) * 0.5;
      this.position.x -= normal.x * correction;
      this.position.z -= normal.z * correction;
      const relativeNormalVelocity =
        (target.velocity.x - this.velocity.x) * normal.x +
        (target.velocity.z - this.velocity.z) * normal.z;
      if (relativeNormalVelocity < 0) {
        this.velocity.x += normal.x * relativeNormalVelocity * 0.5;
        this.velocity.z += normal.z * relativeNormalVelocity * 0.5;
      }
      this.position = resolveArenaWallOverlaps(this.position).position;
    }
  }

  triggerFinisher(durationMs: number = GAME.finisherDurationMs): void {
    this.wallBypassUntil = Math.max(
      this.wallBypassUntil,
      performance.now() + Math.max(0, durationMs),
    );
  }

  private isBypassingWalls(): boolean {
    return performance.now() < this.wallBypassUntil;
  }

  recordInput(sequence: number): void {
    this.pendingSequences.push(sequence);
  }
  triggerDash(moveX: number, moveZ: number, yaw: number): void {
    if (!this.initialized || !this.enabled || (!moveX && !moveZ)) return;
    const sin = Math.sin(yaw),
      cos = Math.cos(yaw);
    const worldX = moveX * cos + moveZ * sin;
    const worldZ = -moveX * sin + moveZ * cos;
    const length = Math.hypot(worldX, worldZ) || 1;
    this.velocity.x = (worldX / length) * GAME.dashSpeed;
    this.velocity.z = (worldZ / length) * GAME.dashSpeed;
    this.dashRemaining = GAME.dashDurationMs / 1000;
  }
  get pendingCount(): number {
    return this.pendingSequences.length;
  }
}
