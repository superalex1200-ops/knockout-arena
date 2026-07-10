import { describe, expect, it } from "vitest";
import { knockbackForce, segmentCrossesArenaWall } from "./index";

describe("knockbackForce", () => {
  it("grows smoothly and stays controlled", () => {
    expect(knockbackForce(80)).toBeGreaterThan(knockbackForce(20));
    expect(knockbackForce(400)).toBeLessThan(knockbackForce(80) * 1.6);
  });
  it("rewards a charged heavy punch", () => {
    expect(knockbackForce(50, 1)).toBeGreaterThan(knockbackForce(50));
    expect(knockbackForce(50, 1)).toBeLessThan(knockbackForce(50) * 1.8);
  });
  it("makes high damage meaningfully more dangerous", () => {
    expect(knockbackForce(100)).toBeGreaterThan(knockbackForce(0) * 2.3);
  });
});

describe("arena line of sight", () => {
  it("detects an internal wall and allows a clear punch lane", () => {
    expect(
      segmentCrossesArenaWall(
        { x: -7.5, y: 1.1, z: 0 },
        { x: -10.5, y: 1.1, z: 0 },
      ),
    ).toBe(true);
    expect(
      segmentCrossesArenaWall({ x: 0, y: 1.1, z: 0 }, { x: 0, y: 1.1, z: -3 }),
    ).toBe(false);
  });
});
