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

const boundsFor = (object: THREE.Object3D): THREE.Box3 =>
  new THREE.Box3().setFromObject(object);

const overlapVolume = (
  first: THREE.Object3D,
  second: THREE.Object3D,
): number => {
  const overlap = boundsFor(first).intersect(boundsFor(second));
  if (overlap.isEmpty()) return 0;
  const size = overlap.getSize(new THREE.Vector3());
  return size.x * size.y * size.z;
};

const namedMesh = (root: THREE.Object3D, name: string): THREE.Mesh => {
  const object = root.getObjectByName(name);
  expect(object, `${name} should exist`).toBeInstanceOf(THREE.Mesh);
  return object as THREE.Mesh;
};

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
    expect(namedMesh(visual.root, "helmet-shell")).toBeDefined();
    expect(namedMesh(visual.root, "faceplate")).toBeDefined();
    expect(namedMesh(visual.root, "visor-frame")).toBeDefined();
    expect(namedMesh(visual.root, "visor")).toBeDefined();
    expect(namedMesh(visual.root, "chest-chevron")).toBeDefined();
    expect(meshes.length).toBe(23);
    expect(visual.root.userData.design).toBe("cohesive-combat-robot-v9");
    expect(meshes.some((mesh) => mesh.name.includes("knuckle"))).toBe(false);
    expect(
      meshes.some((mesh) => mesh.geometry.constructor === THREE.BoxGeometry),
    ).toBe(false);
    expect(visual.root.rotation.y).toBeCloseTo(0.75);
    visual.root.rotation.y = 0;

    const size = new THREE.Box3()
      .setFromObject(visual.root)
      .getSize(new THREE.Vector3());
    expect(size.y).toBeGreaterThan(2.2);
    expect(size.y).toBeLessThan(2.4);
    expect(size.x).toBeGreaterThan(1.25);
    expect(size.x / size.y).toBeLessThan(0.72);
    expect(visual.leftLeg.children).toHaveLength(2);
    expect(visual.rightLeg.children).toHaveLength(2);
    expect(visual.leftGlove.position.y).not.toBe(visual.rightGlove.position.y);
    expect(visual.leftGlove.position.z).not.toBe(visual.rightGlove.position.z);
    expect(visual.root.position).toMatchObject({ x: 4, y: 0, z: -3 });

    const torsoSize = boundsFor(
      namedMesh(visual.root, "primary-shell"),
    ).getSize(new THREE.Vector3());
    const helmetSize = boundsFor(
      namedMesh(visual.root, "helmet-shell"),
    ).getSize(new THREE.Vector3());
    const gloveSize = boundsFor(
      namedMesh(visual.leftGlove, "glove-shell-left"),
    ).getSize(new THREE.Vector3());
    expect(torsoSize.y).toBeGreaterThan(0.7);
    expect(torsoSize.y).toBeLessThan(0.86);
    expect(torsoSize.x / torsoSize.z).toBeGreaterThan(1.8);
    expect(torsoSize.x / torsoSize.z).toBeLessThan(2.2);
    expect(helmetSize.x / torsoSize.x).toBeGreaterThan(0.52);
    expect(helmetSize.x / torsoSize.x).toBeLessThan(0.7);
    expect(helmetSize.z / helmetSize.x).toBeLessThan(0.9);
    expect(gloveSize.x / torsoSize.x).toBeLessThan(0.42);
    expect(gloveSize.z / gloveSize.x).toBeGreaterThan(0.9);
    expect(gloveSize.z / gloveSize.x).toBeLessThan(1.3);
    const legSuit = namedMesh(visual.leftLeg, "leg-suit-left");
    legSuit.geometry.computeBoundingBox();
    expect(legSuit.geometry.boundingBox!.max.y).toBeLessThan(-0.015);
    for (const jointName of ["elbow-left", "elbow-right"]) {
      const jointSize = boundsFor(namedMesh(visual.root, jointName)).getSize(
        new THREE.Vector3(),
      );
      expect(jointSize.y / jointSize.x).toBeLessThan(0.92);
    }
  });

  it("layers a readable visor and overlaps every major body connection", () => {
    const visual = createRemoteFighter(snapshot(), true);
    visual.root.position.set(0, 0, 0);
    visual.root.rotation.set(0, 0, 0);
    visual.root.updateMatrixWorld(true);

    const helmet = namedMesh(visual.root, "helmet-shell");
    const faceplate = namedMesh(visual.root, "faceplate");
    const visorFrame = namedMesh(visual.root, "visor-frame");
    const visor = namedMesh(visual.root, "visor");
    const torso = namedMesh(visual.root, "primary-shell");
    const suitCore = namedMesh(visual.root, "suit-core");
    const visorSize = boundsFor(visor).getSize(new THREE.Vector3());
    const frameSize = boundsFor(visorFrame).getSize(new THREE.Vector3());
    const faceSize = boundsFor(faceplate).getSize(new THREE.Vector3());
    suitCore.geometry.computeBoundingBox();

    expect(boundsFor(helmet).intersectsBox(boundsFor(faceplate))).toBe(true);
    expect(boundsFor(faceplate).intersectsBox(boundsFor(visorFrame))).toBe(
      true,
    );
    expect(boundsFor(visorFrame).intersectsBox(boundsFor(visor))).toBe(true);
    expect(visorSize.x / visorSize.y).toBeGreaterThan(3.8);
    expect(frameSize.x).toBeGreaterThan(visorSize.x);
    expect(faceSize.x).toBeGreaterThan(frameSize.x);
    expect(boundsFor(torso).intersectsBox(boundsFor(suitCore))).toBe(true);
    expect(suitCore.geometry.boundingBox!.min.y).toBeGreaterThan(1.2);
    expect(boundsFor(torso).intersectsBox(boundsFor(visual.leftLeg))).toBe(
      true,
    );
    expect(boundsFor(torso).intersectsBox(boundsFor(visual.rightLeg))).toBe(
      true,
    );

    for (const [arm, glove, shellName] of [
      [visual.leftArm, visual.leftGlove, "glove-shell-left"],
      [visual.rightArm, visual.rightGlove, "glove-shell-right"],
    ] as const) {
      expect(boundsFor(torso).containsPoint(arm.shoulder)).toBe(true);
      const shell = namedMesh(glove, shellName);
      const cuff = namedMesh(
        glove,
        arm.side < 0 ? "glove-cuff-left" : "glove-cuff-right",
      );
      expect(boundsFor(cuff).containsPoint(arm.wrist)).toBe(true);
      expect(overlapVolume(shell, cuff)).toBeGreaterThan(0.00005);
    }
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
      visual.root.updateMatrixWorld(true);
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
      expect(visual.leftArm.elbow.position).toEqual(
        visual.leftArm.shoulder
          .clone()
          .add(visual.leftArm.wrist)
          .multiplyScalar(0.5),
      );
      expect(visual.rightArm.elbow.position).toEqual(
        visual.rightArm.shoulder
          .clone()
          .add(visual.rightArm.wrist)
          .multiplyScalar(0.5),
      );
      for (const [arm, glove, cuffName] of [
        [visual.leftArm, visual.leftGlove, "glove-cuff-left"],
        [visual.rightArm, visual.rightGlove, "glove-cuff-right"],
      ] as const) {
        expect(
          overlapVolume(
            visual.root.getObjectByName("primary-shell")!,
            arm.upper,
          ),
        ).toBeGreaterThan(0.0001);
        expect(overlapVolume(arm.upper, arm.elbow)).toBeGreaterThan(0.0001);
        expect(overlapVolume(arm.elbow, arm.forearm)).toBeGreaterThan(0.0001);
        expect(
          overlapVolume(arm.forearm, namedMesh(glove, cuffName)),
        ).toBeGreaterThan(0.00005);
      }
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

        const shell = namedMesh(fist, "fp-glove-shell");
        const cuff = namedMesh(fist, "fp-cuff");
        const sleeve = namedMesh(fist, "fp-sleeve");
        expect(fist.children.map((child) => child.name)).toEqual([
          "fp-glove-shell",
          "fp-cuff",
          "fp-sleeve",
        ]);
        expect(fist.userData.design).toBe("combat-robot-glove-v9");
        expect(
          fist.children.some((child) => child.name.includes("knuckle")),
        ).toBe(false);
        expect(fist.getObjectByName("fp-forearm-armor")).toBeUndefined();
        expect(shell.geometry).toBeInstanceOf(THREE.SphereGeometry);
        expect(overlapVolume(shell, cuff)).toBeGreaterThan(0.00005);
        expect(overlapVolume(cuff, sleeve)).toBeGreaterThan(0.001);
        expect(cuff.material).toBe(shell.material);
        expect(sleeve.material).not.toBe(shell.material);
        expect(bounds.max.z, `${state}:${side} camera clearance`).toBeLessThan(
          -0.9,
        );
        expect(size.x).toBeLessThan(0.44);
        expect(size.y).toBeLessThan(0.62);
        expect(size.z).toBeLessThan(0.9);
        shell.geometry.computeBoundingBox();
        const localShellSize = shell.geometry.boundingBox!.getSize(
          new THREE.Vector3(),
        );
        const localShellCenter = shell.geometry.boundingBox!.getCenter(
          new THREE.Vector3(),
        );
        expect(localShellCenter.x).toBeCloseTo(0, 5);
        expect(localShellSize.z / localShellSize.x).toBeGreaterThan(0.9);
        expect(localShellSize.z / localShellSize.x).toBeLessThan(1.3);
        cuff.geometry.computeBoundingBox();
        const localCuffSize = cuff.geometry.boundingBox!.getSize(
          new THREE.Vector3(),
        );
        sleeve.geometry.computeBoundingBox();
        const localSleeveSize = sleeve.geometry.boundingBox!.getSize(
          new THREE.Vector3(),
        );
        const localSleeveCenter = sleeve.geometry.boundingBox!.getCenter(
          new THREE.Vector3(),
        );
        expect(localSleeveCenter.x).toBeCloseTo(0, 5);
        expect(localShellSize.x / localCuffSize.x).toBeGreaterThan(1.4);
        expect(localShellSize.x / localSleeveSize.x).toBeGreaterThan(1.3);
        expect(localSleeveSize.z / localSleeveSize.x).toBeLessThan(3.5);
        expect(localSleeveSize.y / localSleeveSize.x).toBeGreaterThan(1.5);
        expect(sleeve.geometry).toBeInstanceOf(THREE.CylinderGeometry);
        const sleeveShape = sleeve.geometry as THREE.CylinderGeometry;
        expect(sleeveShape.parameters.height).toBeCloseTo(0.45);
        expect(sleeveShape.parameters.radiusTop).toBeCloseTo(0.07);
        expect(sleeveShape.parameters.radiusBottom).toBeCloseTo(0.085);
        expect(sleeveShape.parameters.radialSegments).toBe(24);
        expect(sleeveShape.parameters.heightSegments).toBe(1);
      }
      expect(boundsBySide.get(-1)!.max.x).toBeLessThan(-0.035);
      expect(boundsBySide.get(1)!.min.x).toBeGreaterThan(0.035);
    }

    for (const side of [-1, 1] as const) {
      const rest = firstPersonGlovePose({
        side,
        blocking: false,
        charging: false,
        chargeAmount: 0,
        punching: false,
        punchPhase: 0,
      });
      const punch = firstPersonGlovePose({
        side,
        blocking: false,
        charging: false,
        chargeAmount: 0,
        punching: true,
        punchPhase: 1,
      });
      expect(rest.position.z - punch.position.z).toBeGreaterThanOrEqual(0.85);
      expect(
        Math.abs(rest.position.x) - Math.abs(punch.position.x),
      ).toBeGreaterThanOrEqual(0.18);
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
