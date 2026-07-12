import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { PlayerSnapshot } from "@knockout/shared";
import {
  createFirstPersonGlove,
  createRemoteFighter,
  disposeObject3D,
  fighterArmConnectionError,
  firstPersonGlovePose,
  poseFighterArms,
  updateFighterAppearance,
  updateFirstPersonGloveAppearance,
} from "./CharacterModel";

const snapshot = (overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot => ({
  id: "remote-player",
  name: "Fighter",
  position: { x: 4, y: 1.1, z: -3 },
  velocity: { x: 0, y: 0, z: 0 },
  grounded: true,
  yaw: 0.75,
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
  ready: true,
  host: false,
  ...overrides,
});

describe("CharacterModel", () => {
  it("builds a clean fighter silhouette with named animation pivots", () => {
    const visual = createRemoteFighter(snapshot({ team: "blue" }), true);
    const meshes: THREE.Mesh[] = [];
    visual.root.traverse((object) => {
      if (object instanceof THREE.Mesh) meshes.push(object);
    });

    expect(visual.leftGlove.name).toBe("glove-left");
    expect(visual.rightGlove.name).toBe("glove-right");
    expect(visual.leftLeg.name).toBe("leg-left");
    expect(visual.rightLeg.name).toBe("leg-right");
    expect(visual.root.getObjectByName("visor")).toBeInstanceOf(THREE.Mesh);
    expect(meshes.length).toBe(20);
    expect(visual.root.userData.design).toBe("smooth-boxer-v3");
    expect(meshes.some((mesh) => mesh.name.includes("knuckle"))).toBe(false);
    expect(visual.root.rotation.y).toBeCloseTo(0.75);
    visual.root.rotation.y = 0;

    const size = new THREE.Box3()
      .setFromObject(visual.root)
      .getSize(new THREE.Vector3());
    expect(size.y).toBeGreaterThan(2);
    expect(size.y).toBeLessThan(2.5);
    expect(size.x).toBeGreaterThan(1.1);
    expect(size.x / size.y).toBeLessThan(0.72);
    expect(visual.leftLeg.children).toHaveLength(2);
    expect(visual.rightLeg.children).toHaveLength(2);
    expect(visual.leftGlove.position.y).not.toBe(visual.rightGlove.position.y);
    expect(visual.leftGlove.position.z).not.toBe(visual.rightGlove.position.z);
    expect(visual.root.position).toMatchObject({ x: 4, y: 0, z: -3 });
  });

  it("keeps both arm chains connected through every combat pose", () => {
    const visual = createRemoteFighter(snapshot(), false);
    const poses = [
      () => {},
      () => {
        visual.leftGlove.position.set(-0.3, 1.55, -0.5);
        visual.rightGlove.position.set(0.3, 1.55, -0.5);
        visual.leftGlove.rotation.set(-0.62, 0, -0.38);
        visual.rightGlove.rotation.set(-0.62, 0, 0.38);
      },
      () => {
        visual.leftGlove.position.set(-0.48, 1.07, 0.12);
        visual.rightGlove.position.set(0.48, 1.07, 0.12);
        visual.leftGlove.rotation.set(-0.48, 0, 0.26);
        visual.rightGlove.rotation.set(-0.48, 0, -0.26);
      },
      () => {
        visual.leftGlove.position.set(-0.42, 1.3, -1.08);
        visual.rightGlove.position.set(0.42, 1.2, -1.08);
        visual.leftGlove.rotation.set(-0.35, 0, 0);
        visual.rightGlove.rotation.set(-0.35, 0, 0);
      },
    ];

    for (const applyPose of poses) {
      applyPose();
      poseFighterArms(visual);
      expect(fighterArmConnectionError(visual.leftArm)).toBeLessThan(1e-8);
      expect(fighterArmConnectionError(visual.rightArm)).toBeLessThan(1e-8);
      expect(visual.leftArm.upper.material).toBe(
        visual.leftArm.forearm.material,
      );
      expect(visual.rightArm.upper.material).toBe(
        visual.rightArm.forearm.material,
      );
      expect(
        visual.leftArm.elbow.position.toArray().every(Number.isFinite),
      ).toBe(true);
      expect(
        visual.rightArm.elbow.position.toArray().every(Number.isFinite),
      ).toBe(true);
    }
  });

  it("keeps smooth first-person gloves clear of the camera and crosshair", () => {
    for (const state of ["rest", "block", "charge", "punch"] as const) {
      const boundsBySide = new Map<number, THREE.Box3>();
      for (const side of [-1, 1] as const) {
        const fist = createFirstPersonGlove(side);
        const pose = firstPersonGlovePose({
          side,
          blocking: state === "block",
          charging: state === "charge",
          chargeAmount: state === "charge" ? 1 : 0,
          punching: state === "punch",
          punchPhase: state === "punch" ? 1 : 0,
        });
        fist.position.copy(pose.position);
        fist.rotation.x = pose.rotationX;
        fist.rotation.z = pose.rotationZ;
        const bounds = new THREE.Box3().setFromObject(fist);
        const size = bounds.getSize(new THREE.Vector3());
        boundsBySide.set(side, bounds);

        expect(fist.children).toHaveLength(3);
        expect(fist.userData.design).toBe("smooth-boxing-glove-v3");
        expect(
          fist.children.some((child) => child.name.includes("knuckle")),
        ).toBe(false);
        expect(bounds.max.z).toBeLessThan(-0.72);
        expect(size.x).toBeLessThan(0.45);
        expect(size.y).toBeLessThan(0.55);
      }
      expect(boundsBySide.get(-1)!.max.x).toBeLessThan(-0.015);
      expect(boundsBySide.get(1)!.min.x).toBeGreaterThan(0.015);
    }
  });

  it("updates remote and first-person colors when teams are assigned later", () => {
    const neutral = snapshot();
    const red = snapshot({ team: "red" });
    const visual = createRemoteFighter(neutral, false);
    const fist = createFirstPersonGlove(1);

    updateFighterAppearance(visual, red);
    updateFirstPersonGloveAppearance(fist, red);

    expect(visual.appearance.primary.color.getHex()).toBe(0xf23d63);
    const fistPalm = fist.getObjectByName("fp-glove-shell") as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshStandardMaterial
    >;
    expect(fistPalm.material.color.getHex()).toBe(0xf23d63);
    expect(fistPalm.material.roughness).toBeGreaterThanOrEqual(0.45);
    expect(fistPalm.material.metalness).toBeLessThanOrEqual(0.1);
    expect(fist.userData.side).toBe(1);
    expect(fist.getObjectByName("fp-cuff")).toBeInstanceOf(THREE.Mesh);
  });

  it("disposes shared geometry, materials, and textures exactly once", () => {
    const root = new THREE.Group();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const texture = new THREE.Texture();
    const material = new THREE.MeshBasicMaterial({ map: texture });
    root.add(
      new THREE.Mesh(geometry, material),
      new THREE.Mesh(geometry, material),
    );
    let geometryDisposals = 0,
      materialDisposals = 0,
      textureDisposals = 0;
    geometry.addEventListener("dispose", () => geometryDisposals++);
    material.addEventListener("dispose", () => materialDisposals++);
    texture.addEventListener("dispose", () => textureDisposals++);

    disposeObject3D(root);

    expect(geometryDisposals).toBe(1);
    expect(materialDisposals).toBe(1);
    expect(textureDisposals).toBe(1);
  });
});
