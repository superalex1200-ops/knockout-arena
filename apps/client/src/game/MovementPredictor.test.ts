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
  charging: false,
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
  it("does not predict an under-edge dash through the solid floor side", () => {
    const predictor = new MovementPredictor();
    predictor.reconcile({
      ...snapshot(15.7, 0),
      position: { x: 15.7, y: 0.9, z: 0 },
      grounded: false,
    });
    predictor.setEnabled(true);
    predictor.triggerDash(-1, 0, 0);
    predictor.update(0.1, -1, 0, 0);
    expect(predictor.position.x).toBeGreaterThanOrEqual(15.549);
  });
  it("preserves the short dash burst instead of braking it immediately", () => {
    const predictor = new MovementPredictor();
    predictor.reconcile(snapshot(0, 0));
    predictor.setEnabled(true);
    predictor.triggerDash(0, -1, 0);
    predictor.update(1 / 30, 0, -1, 0);
    expect(predictor.position.z).toBeLessThan(-0.5);
  });
  it("keeps solid wall collision active during a finisher launch", () => {
    const predictor = new MovementPredictor();
    predictor.reconcile({ ...snapshot(-7.7, 0), finisher: true });
    predictor.setEnabled(true);
    predictor.triggerDash(0, -1, Math.PI / 2);
    predictor.update(0.2, 0, -1, Math.PI / 2);
    expect(predictor.position.x).toBeGreaterThanOrEqual(-7.851);
  });
  it("predicts the same half-separation used for fighter body collision", () => {
    const predictor = new MovementPredictor();
    const local = snapshot(0, 0);
    const target = { ...snapshot(0, 0), id: "z" };
    predictor.reconcile(local);
    predictor.setEnabled(true);
    predictor.resolvePlayerCollisions(local, [local, target]);
    expect(predictor.position.x).toBeCloseTo(-0.55);
    predictor.resolvePlayerCollisions(local, [local, target]);
    expect(predictor.position.x).toBeCloseTo(-0.55);
  });
  it("does not predict body separation into the solid floor edge", () => {
    const predictor = new MovementPredictor();
    const local = {
      ...snapshot(15.6, 0),
      position: { x: 15.6, y: 0.5, z: 0 },
      grounded: false,
    };
    const target = {
      ...snapshot(16, 0),
      id: "z",
      position: { x: 16, y: 0.5, z: 0 },
      grounded: false,
    };
    predictor.reconcile(local);
    predictor.setEnabled(true);

    predictor.resolvePlayerCollisions(local, [local, target]);

    expect(predictor.position.x).toBeGreaterThanOrEqual(15.55 - 1e-6);
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
