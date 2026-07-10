import { GAME, resolvePredictedWalls, type PlayerSnapshot, type Vec3 } from "@knockout/shared";

export class MovementPredictor {
  position: Vec3 = { x: 0, y: 0, z: 0 };
  private velocity = { x: 0, z: 0 };
  private initialized = false;
  private enabled = false;
  private pendingSequences: number[] = [];

  setEnabled(enabled: boolean): void { this.enabled = enabled; }

  reconcile(snapshot: PlayerSnapshot): void {
    this.pendingSequences = this.pendingSequences.filter(sequence => sequence > snapshot.lastProcessedInput);
    if (!this.initialized) {
      this.position = { ...snapshot.position };
      this.velocity = { x: snapshot.velocity.x, z: snapshot.velocity.z };
      this.initialized = true;
      return;
    }
    const dx = snapshot.position.x - this.position.x;
    const dz = snapshot.position.z - this.position.z;
    const error = Math.hypot(dx, dz);
    if (error > 2.75) {
      this.position.x = snapshot.position.x;
      this.position.z = snapshot.position.z;
      this.velocity = { x: snapshot.velocity.x, z: snapshot.velocity.z };
    } else {
      this.position.x += dx * 0.22;
      this.position.z += dz * 0.22;
      this.velocity.x += (snapshot.velocity.x - this.velocity.x) * 0.08;
      this.velocity.z += (snapshot.velocity.z - this.velocity.z) * 0.08;
    }
    this.position.y = snapshot.position.y;
  }

  update(dt: number, moveX: number, moveZ: number, yaw: number): void {
    if (!this.initialized || !this.enabled) return;
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    const worldX = moveX * cos + moveZ * sin;
    const worldZ = -moveX * sin + moveZ * cos;
    const length = Math.hypot(worldX, worldZ) || 1;
    const targetX = worldX / length * GAME.moveSpeed;
    const targetZ = worldZ / length * GAME.moveSpeed;
    const control = Math.min(1, dt * 13);
    this.velocity.x += (targetX - this.velocity.x) * control;
    this.velocity.z += (targetZ - this.velocity.z) * control;
    const substeps = Math.min(10, Math.max(1, Math.ceil(Math.max(Math.abs(this.velocity.x), Math.abs(this.velocity.z)) * dt / .28)));
    for (let step = 0; step < substeps; step++) {
      this.position.x += this.velocity.x * dt / substeps;
      this.position.z += this.velocity.z * dt / substeps;
      const resolved = resolvePredictedWalls(this.position);
      if (resolved.x !== this.position.x) this.velocity.x = 0;
      if (resolved.z !== this.position.z) this.velocity.z = 0;
      this.position = resolved;
    }
  }

  recordInput(sequence: number): void { this.pendingSequences.push(sequence); }
  triggerDash(moveX: number, moveZ: number, yaw: number): void {
    if (!this.initialized || !this.enabled || (!moveX && !moveZ)) return;
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    const worldX = moveX * cos + moveZ * sin;
    const worldZ = -moveX * sin + moveZ * cos;
    const length = Math.hypot(worldX, worldZ) || 1;
    this.velocity.x = worldX / length * GAME.dashSpeed;
    this.velocity.z = worldZ / length * GAME.dashSpeed;
  }
  get pendingCount(): number { return this.pendingSequences.length; }
}
