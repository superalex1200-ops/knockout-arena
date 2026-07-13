import { describe, expect, it } from "vitest";
import type { PlayerSnapshot } from "@knockout/shared";
import {
  REMOTE_TELEPORT_DISTANCE,
  shouldSnapRemoteFighter,
} from "./remoteInterpolation";

const snapshot = (
  position: PlayerSnapshot["position"],
  protectedPlayer = false,
): PlayerSnapshot => ({
  id: "remote",
  name: "Remote",
  position,
  velocity: { x: 0, y: 0, z: 0 },
  grounded: true,
  yaw: 0,
  knockback: 0,
  score: 0,
  assists: 0,
  falls: 0,
  combo: 0,
  lastProcessedInput: 0,
  stocksRemaining: 3,
  eliminated: false,
  blocking: false,
  charging: false,
  protected: protectedPlayer,
  ready: false,
  host: false,
});

describe("remote fighter interpolation", () => {
  const previous = snapshot({ x: 0, y: 1.1, z: 0 });

  it.each([0.95, 3.6, 7.9])(
    "keeps interpolating an ordinary %.2f meter snapshot delta",
    (distance) => {
      const current = snapshot({ x: distance, y: 1.1, z: 0 });
      expect(shouldSnapRemoteFighter(previous, current, false)).toBe(false);
    },
  );

  it("snaps at the eight meter teleport threshold", () => {
    const current = snapshot({ x: REMOTE_TELEPORT_DISTANCE, y: 1.1, z: 0 });
    expect(shouldSnapRemoteFighter(previous, current, false)).toBe(true);
  });

  it("snaps when spawn protection rises", () => {
    const current = snapshot({ x: 0.2, y: 1.1, z: 0 }, true);
    expect(shouldSnapRemoteFighter(previous, current, false)).toBe(true);
  });

  it("snaps an explicit short-range teleport without spawn protection", () => {
    const current = {
      ...snapshot({ x: 0.2, y: 1.1, z: 0 }),
      teleportSequence: 1,
    };
    expect(shouldSnapRemoteFighter(previous, current, false)).toBe(true);
  });

  it("snaps every remote fighter when the match changes", () => {
    const current = snapshot({ x: 0.2, y: 1.1, z: 0 });
    expect(shouldSnapRemoteFighter(previous, current, true)).toBe(true);
  });
});
