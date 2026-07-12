import { describe, expect, it } from "vitest";
import type { PlayerSnapshot } from "@knockout/shared";
import { cooldownReadiness, isPunchTargetValid } from "./combatHud";

const player = (id: string, x: number, z: number): PlayerSnapshot => ({
  id,
  name: id,
  position: { x, y: 1.1, z },
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
  protected: false,
  ready: false,
  host: false,
});

describe("combat HUD state", () => {
  it("reports cooldown progress", () => {
    expect(cooldownReadiness(1_000, 1_000, 1_500)).toBe(0.5);
    expect(cooldownReadiness(0, 1_000, 1_500)).toBe(1);
  });
  it("highlights a reachable target but never one behind a wall", () => {
    expect(isPunchTargetValid(player("a", 0, 0), player("b", 0, -2), 0)).toBe(
      true,
    );
    expect(
      isPunchTargetValid(
        player("a", -7.5, 0),
        player("b", -10.5, 0),
        Math.PI / 2,
      ),
    ).toBe(false);
  });
  it("does not highlight a teammate when friendly fire is disabled", () => {
    const local = player("a", 0, 0),
      teammate = player("b", 0, -2);
    local.team = teammate.team = "red";
    expect(isPunchTargetValid(local, teammate, 0, false)).toBe(false);
    expect(isPunchTargetValid(local, teammate, 0, true)).toBe(true);
  });
  it("tracks pitch and rejects peripheral targets outside the glove sweep", () => {
    const local = player("a", 0, 0);
    const airborne = player("b", 0, -2.5);
    airborne.position.y = 3.6;
    expect(isPunchTargetValid(local, airborne, 0, true, 0)).toBe(false);
    expect(isPunchTargetValid(local, airborne, 0, true, 0.68)).toBe(true);
    expect(isPunchTargetValid(local, player("c", 3.1, -1.05), 0)).toBe(false);
  });
  it("previews the charged heavy-only reach band", () => {
    const local = player("a", 0, 0);
    const distant = player("b", 0, -3.9);
    expect(isPunchTargetValid(local, distant, 0, true, 0, "light")).toBe(false);
    expect(isPunchTargetValid(local, distant, 0, true, 0, "heavy")).toBe(true);
  });
});
