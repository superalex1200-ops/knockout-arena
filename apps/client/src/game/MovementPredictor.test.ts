import { describe, expect, it } from "vitest";
import type { PlayerSnapshot } from "@knockout/shared";
import { MovementPredictor } from "./MovementPredictor";

const snapshot = (x: number, z: number, ack = -1): PlayerSnapshot => ({
  id: "p",
  name: "Player",
  position: { x, y: 1.1, z },
  velocity: { x: 0, y: 0, z: 0 },
  grounded: true,
  yaw: 0,
  knockback: 0,
  score: 0,
  assists: 0,
  falls: 0,
  combo: 0,
  stocksRemaining: 3,
  eliminated: false,
  lastProcessedInput: ack,
  blocking: false,
  protected: false,
  ready: false,
  host: true,
});

describe("MovementPredictor", () => {
  it("moves immediately from local input", () => {
    const predictor = new MovementPredictor();
    predictor.reconcile(snapshot(0, 0));
    predictor.setEnabled(true);
    predictor.update(0.1, 0, -1, 0);
    expect(predictor.position.z).toBeLessThan(0);
  });
  it("keeps forward movement aligned with the rotated view", () => {
    const predictor = new MovementPredictor();
    predictor.reconcile(snapshot(0, 0));
    predictor.setEnabled(true);
    predictor.update(0.1, 0, -1, Math.PI / 2);
    expect(predictor.position.x).toBeLessThan(0);
    expect(Math.abs(predictor.position.z)).toBeLessThan(0.001);
  });
  it("prunes acknowledged inputs and softly corrects small errors", () => {
    const predictor = new MovementPredictor();
    predictor.reconcile(snapshot(0, 0));
    predictor.setEnabled(true);
    predictor.recordInput(1);
    predictor.recordInput(2);
    predictor.reconcile(snapshot(1, 0, 1));
    expect(predictor.pendingCount).toBe(1);
    expect(predictor.position.x).toBeCloseTo(0.22);
  });
  it("snaps large divergence to the authority", () => {
    const predictor = new MovementPredictor();
    predictor.reconcile(snapshot(0, 0));
    predictor.reconcile(snapshot(8, 3));
    expect(predictor.position).toMatchObject({ x: 8, z: 3 });
  });
  it("does not visually tunnel through arena walls", () => {
    const predictor = new MovementPredictor();
    predictor.reconcile(snapshot(-7.7, 0));
    predictor.setEnabled(true);
    predictor.update(0.2, 0, -1, Math.PI / 2);
    expect(predictor.position.x).toBeGreaterThanOrEqual(-7.851);
  });
  it("preserves the short dash burst instead of braking it immediately", () => {
    const predictor = new MovementPredictor();
    predictor.reconcile(snapshot(0, 0));
    predictor.setEnabled(true);
    predictor.triggerDash(0, -1, 0);
    predictor.update(1 / 30, 0, -1, 0);
    expect(predictor.position.z).toBeLessThan(-0.5);
  });
  it("adopts authoritative launch velocity without a lagging correction", () => {
    const predictor = new MovementPredictor();
    predictor.reconcile(snapshot(0, 0));
    predictor.setEnabled(true);
    predictor.reconcile({
      ...snapshot(0, 0),
      grounded: false,
      velocity: { x: 0, y: 5, z: -18 },
    });
    predictor.update(1 / 30, 0, 0, 0);
    expect(predictor.position.z).toBeLessThan(-0.5);
  });
});
