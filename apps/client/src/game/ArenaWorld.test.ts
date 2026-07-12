import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ARENA_WALLS } from "@knockout/shared";
import { arenaWallTransform, createArenaWorld } from "./ArenaWorld";

describe("arena world", () => {
  it("keeps the original floor dimensions and height", () => {
    const world = createArenaWorld("low");
    const floor = world.getObjectByName("arena-floor-solid");
    expect(floor).toBeDefined();
    world.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(floor!);
    const size = bounds.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(30);
    expect(size.y).toBeCloseTo(1.8);
    expect(size.z).toBeCloseTo(30);
    expect(bounds.max.y).toBeCloseTo(0);
  });

  it("derives every visible solid wall from the shared collider", () => {
    const world = createArenaWorld("low");
    world.updateMatrixWorld(true);
    for (const wall of ARENA_WALLS) {
      const mesh = world.getObjectByName(`arena-wall-${wall.id}-bounds`);
      expect(mesh).toBeDefined();
      const bounds = new THREE.Box3().setFromObject(mesh!);
      expect(bounds.min.x).toBeCloseTo(wall.minX);
      expect(bounds.max.x).toBeCloseTo(wall.maxX);
      expect(bounds.min.y).toBeCloseTo(0);
      expect(bounds.max.y).toBeCloseTo(wall.height);
      expect(bounds.min.z).toBeCloseTo(wall.minZ);
      expect(bounds.max.z).toBeCloseTo(wall.maxZ);
    }
  });

  it("has a real backdrop but no fake solid corner pylons", () => {
    const world = createArenaWorld("high");
    expect(world.getObjectByName("arena-gradient-sky")).toBeDefined();
    expect(world.getObjectByName("arena-distant-towers")).toBeDefined();
    expect(world.getObjectByName("arena-death-well")).toBeDefined();
    expect(world.getObjectByName("arena-corner-pylon")).toBeUndefined();
  });

  it("reports wall transforms without renderer-side magic numbers", () => {
    for (const wall of ARENA_WALLS) {
      const transform = arenaWallTransform(wall);
      expect(transform.width).toBeCloseTo(wall.maxX - wall.minX);
      expect(transform.depth).toBeCloseTo(wall.maxZ - wall.minZ);
      expect(transform.y).toBeCloseTo(wall.height * 0.5);
    }
  });
});
