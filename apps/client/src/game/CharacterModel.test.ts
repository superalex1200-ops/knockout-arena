import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { PlayerSnapshot } from "@knockout/shared";
import {
  createFirstPersonGlove,
  createRemoteFighter,
  disposeObject3D,
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
    expect(meshes.length).toBeGreaterThanOrEqual(14);
    expect(meshes.length).toBeLessThanOrEqual(18);
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

  it("keeps the two-bone arms connected to a moving glove target", () => {
    const visual = createRemoteFighter(snapshot(), false);
    const previousForearmZ = visual.rightArm.forearm.position.z;
    visual.rightGlove.position.z = -1;
    poseFighterArms(visual);

    expect(visual.rightArm.forearm.position.z).toBeLessThan(previousForearmZ);
    expect(visual.rightArm.upper.scale.y).toBeGreaterThan(0);
    expect(visual.rightArm.forearm.scale.y).toBeGreaterThan(0);
  });

  it("keeps every first-person pose safely in front of the camera", () => {
    for (const state of ["rest", "block", "charge"] as const) {
      const fist = createFirstPersonGlove(1);
      const pose = firstPersonGlovePose({
        side: 1,
        blocking: state === "block",
        charging: state === "charge",
        chargeAmount: state === "charge" ? 1 : 0,
        punching: false,
        punchPhase: 0,
      });
      fist.position.copy(pose.position);
      fist.rotation.x = pose.rotationX;
      fist.rotation.z = pose.rotationZ;
      const bounds = new THREE.Box3().setFromObject(fist);
      const size = bounds.getSize(new THREE.Vector3());

      expect(bounds.max.z).toBeLessThan(-0.58);
      expect(size.x).toBeLessThan(0.55);
      expect(size.y).toBeLessThan(0.7);
    }
  });

  it("updates remote and first-person colors when teams are assigned later", () => {
    const neutral = snapshot();
    const red = snapshot({ team: "red" });
    const visual = createRemoteFighter(neutral, false);
    const fist = createFirstPersonGlove(1);

    updateFighterAppearance(visual, red);
    updateFirstPersonGloveAppearance(fist, red);

    expect(visual.appearance.primary.color.getHex()).toBe(0xff385f);
    const fistPalm = fist.getObjectByName("fp-palm") as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshStandardMaterial
    >;
    expect(fistPalm.material.color.getHex()).toBe(0xff385f);
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
