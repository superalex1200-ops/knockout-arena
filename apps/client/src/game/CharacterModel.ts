import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { PlayerSnapshot } from "@knockout/shared";

const FIGHTER_FLOOR_OFFSET = 1.1;
const ARM_GEOMETRY_LENGTH = 0.47;

type Palette = {
  key: string;
  primary: number;
  trim: number;
  emissive: number;
  visor: number;
};

type Appearance = {
  key: string;
  primary: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  visor?: THREE.MeshStandardMaterial;
};

type ArmRig = {
  side: -1 | 1;
  upper: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  forearm: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
};

export type FighterVisual = {
  root: THREE.Group;
  leftGlove: THREE.Group;
  rightGlove: THREE.Group;
  leftArm: ArmRig;
  rightArm: ArmRig;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  guard: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  ring: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  appearance: Appearance;
  walkPhase: number;
};

const paletteFor = (player: Pick<PlayerSnapshot, "bot" | "team">): Palette => {
  if (player.bot)
    return {
      key: "bot",
      primary: 0xffad24,
      trim: 0xffe080,
      emissive: 0x5c2400,
      visor: 0xffd35a,
    };
  if (player.team === "red")
    return {
      key: "red",
      primary: 0xff385f,
      trim: 0xff9bb0,
      emissive: 0x540715,
      visor: 0x77efff,
    };
  if (player.team === "blue")
    return {
      key: "blue",
      primary: 0x2c91ff,
      trim: 0x8bd8ff,
      emissive: 0x052c5c,
      visor: 0x73f3ff,
    };
  return {
    key: "neutral",
    primary: 0x705cff,
    trim: 0xafa3ff,
    emissive: 0x1d125d,
    visor: 0x76efff,
  };
};

const transformed = (
  geometry: THREE.BufferGeometry,
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
): THREE.BufferGeometry => {
  const transform = new THREE.Object3D();
  transform.position.set(...position);
  transform.rotation.set(...rotation);
  transform.scale.set(...scale);
  transform.updateMatrix();
  geometry.applyMatrix4(transform.matrix);
  return geometry;
};

const merged = (...parts: THREE.BufferGeometry[]): THREE.BufferGeometry => {
  const normalized = parts.map((part) =>
    part.index ? part.toNonIndexed() : part,
  );
  const geometry = mergeGeometries(normalized, false);
  if (!geometry) throw new Error("Could not merge fighter geometry");
  for (const part of parts) part.dispose();
  for (const part of normalized) if (!parts.includes(part)) part.dispose();
  geometry.computeBoundingSphere();
  return geometry;
};

const standardMaterial = (
  color: number,
  options: Partial<THREE.MeshStandardMaterialParameters> = {},
) =>
  new THREE.MeshStandardMaterial({
    color,
    roughness: 0.38,
    metalness: 0.3,
    ...options,
  });

const makeFirstPersonHandGeometry = (side: -1 | 1) =>
  merged(
    transformed(
      new THREE.SphereGeometry(0.175, 12, 8),
      [0, 0, 0],
      [0, 0, 0],
      [1.12, 0.88, 1.18],
    ),
    transformed(
      new THREE.SphereGeometry(0.075, 8, 6),
      [-side * 0.125, -0.03, 0.015],
      [0, 0, -0.35],
      [0.86, 1.15, 0.9],
    ),
    transformed(
      new THREE.CylinderGeometry(0.105, 0.14, 0.22, 10),
      [0, -0.01, 0.19],
      [Math.PI / 2, 0, 0],
    ),
  );

export type FirstPersonGlovePose = {
  position: THREE.Vector3;
  rotationX: number;
  rotationZ: number;
};

export const firstPersonGlovePose = ({
  side,
  blocking,
  charging,
  chargeAmount,
  punching,
  punchPhase,
  handBob = 0,
  handSway = 0,
}: {
  side: -1 | 1;
  blocking: boolean;
  charging: boolean;
  chargeAmount: number;
  punching: boolean;
  punchPhase: number;
  handBob?: number;
  handSway?: number;
}): FirstPersonGlovePose => {
  if (blocking)
    return {
      position: new THREE.Vector3(side * 0.24, -0.24, -1.15),
      rotationX: -0.55,
      rotationZ: side * 0.38,
    };
  if (charging)
    return {
      position: new THREE.Vector3(
        side * (0.5 + chargeAmount * 0.07),
        -0.58 - chargeAmount * 0.04,
        -1.3 + chargeAmount * 0.12,
      ),
      rotationX: -0.25 - chargeAmount * 0.35,
      rotationZ: side * -0.22 * chargeAmount,
    };
  return {
    position: new THREE.Vector3(
      side * (0.43 + (punching ? punchPhase * 0.07 : 0)) + handSway,
      -0.58 + handBob + (punching ? punchPhase * 0.02 : 0),
      -1.42 - (punching ? punchPhase * 0.66 : 0),
    ),
    rotationX: 0,
    rotationZ: 0,
  };
};

export const createFirstPersonGlove = (side: -1 | 1): THREE.Group => {
  const group = new THREE.Group();
  group.name =
    side < 0 ? "first-person-glove-left" : "first-person-glove-right";
  group.userData.side = side;

  const primary = standardMaterial(0xff385f, {
    roughness: 0.25,
    emissive: 0x430611,
    emissiveIntensity: 0.55,
  });
  const trim = standardMaterial(0xff9bb0, {
    roughness: 0.22,
    metalness: 0.62,
    emissive: 0x430611,
    emissiveIntensity: 0.8,
  });
  const sleeveMaterial = standardMaterial(0x20263d, {
    roughness: 0.62,
    metalness: 0.16,
  });
  const glove = new THREE.Mesh(makeFirstPersonHandGeometry(side), primary);
  glove.name = "fp-palm";
  group.add(glove);

  const sleeve = new THREE.Mesh(
    transformed(
      new THREE.CylinderGeometry(0.095, 0.125, 0.24, 10),
      [0, -0.035, 0.4],
      [Math.PI / 2, 0, 0],
    ),
    sleeveMaterial,
  );
  sleeve.name = "fp-sleeve";
  group.add(sleeve);

  const armor = new THREE.Mesh(
    merged(
      transformed(
        new THREE.CapsuleGeometry(0.043, 0.18, 4, 8),
        [0, 0.085, -0.09],
        [0, 0, Math.PI / 2],
        [1, 1, 1.35],
      ),
      transformed(
        new THREE.DodecahedronGeometry(0.043, 0),
        [-0.09, 0.105, -0.17],
      ),
      transformed(new THREE.DodecahedronGeometry(0.043, 0), [0, 0.115, -0.18]),
      transformed(
        new THREE.DodecahedronGeometry(0.043, 0),
        [0.09, 0.105, -0.17],
      ),
    ),
    trim,
  );
  armor.name = "fp-knuckle-armor";
  group.add(armor);

  const cuff = new THREE.Mesh(
    new THREE.TorusGeometry(0.13, 0.018, 6, 16),
    trim,
  );
  cuff.name = "fp-cuff";
  cuff.position.z = 0.3;
  group.add(cuff);

  group.position.copy(
    firstPersonGlovePose({
      side,
      blocking: false,
      charging: false,
      chargeAmount: 0,
      punching: false,
      punchPhase: 0,
    }).position,
  );
  group.rotation.y = side * -0.06;
  group.userData.appearance = {
    key: "",
    primary,
    trim,
  } satisfies Appearance;
  return group;
};

export const fighterRestHandPosition = (side: -1 | 1): THREE.Vector3 =>
  side < 0
    ? new THREE.Vector3(-0.36, 1.28, -0.34)
    : new THREE.Vector3(0.4, 1.16, -0.25);

const makeGlove = (
  side: -1 | 1,
  primary: THREE.MeshStandardMaterial,
  trim: THREE.MeshStandardMaterial,
): THREE.Group => {
  const glove = new THREE.Group();
  glove.name = side < 0 ? "glove-left" : "glove-right";
  glove.position.copy(fighterRestHandPosition(side));

  const base = new THREE.Mesh(
    merged(
      transformed(
        new THREE.SphereGeometry(0.175, 10, 7),
        [0, 0, 0],
        [0, 0, 0],
        [1.04, 0.88, 1.12],
      ),
      transformed(
        new THREE.SphereGeometry(0.075, 8, 5),
        [-side * 0.125, -0.025, -0.005],
        [0, 0, side * 0.35],
        [0.85, 1.2, 0.9],
      ),
      transformed(
        new THREE.CylinderGeometry(0.115, 0.15, 0.2, 9),
        [0, 0, 0.18],
        [Math.PI / 2, 0, 0],
      ),
    ),
    primary,
  );
  base.name = side < 0 ? "glove-shell-left" : "glove-shell-right";
  glove.add(base);

  const detail = new THREE.Mesh(
    merged(
      transformed(
        new THREE.CapsuleGeometry(0.038, 0.17, 4, 8),
        [0, 0.08, -0.09],
        [0, 0, Math.PI / 2],
        [1, 1, 1.3],
      ),
      transformed(
        new THREE.DodecahedronGeometry(0.038, 0),
        [-0.08, 0.1, -0.16],
      ),
      transformed(new THREE.DodecahedronGeometry(0.038, 0), [0, 0.11, -0.17]),
      transformed(new THREE.DodecahedronGeometry(0.038, 0), [0.08, 0.1, -0.16]),
    ),
    trim,
  );
  detail.name = side < 0 ? "knuckles-left" : "knuckles-right";
  detail.castShadow = false;
  glove.add(detail);
  return glove;
};

const makeLeg = (
  side: -1 | 1,
  material: THREE.MeshStandardMaterial,
  trim: THREE.MeshStandardMaterial,
): THREE.Group => {
  const pivot = new THREE.Group();
  pivot.name = side < 0 ? "leg-left" : "leg-right";
  pivot.position.set(side * 0.19, 0.86, 0);
  const leg = new THREE.Mesh(
    merged(
      transformed(new THREE.CapsuleGeometry(0.175, 0.2, 4, 8), [0, -0.2, 0]),
      transformed(new THREE.CapsuleGeometry(0.15, 0.2, 4, 8), [0, -0.56, 0.01]),
      transformed(
        new THREE.BoxGeometry(0.34, 0.18, 0.45),
        [0, -0.78, -0.085],
        [0.04, 0, 0],
      ),
    ),
    material,
  );
  leg.name = side < 0 ? "leg-base-left" : "leg-base-right";
  pivot.add(leg);
  const armor = new THREE.Mesh(
    merged(
      transformed(
        new THREE.DodecahedronGeometry(0.1, 0),
        [0, -0.41, -0.13],
        [-0.08, 0, 0],
        [1.3, 0.72, 0.68],
      ),
      transformed(
        new THREE.CapsuleGeometry(0.065, 0.14, 4, 8),
        [0, -0.57, -0.135],
        [-0.04, 0, 0],
        [1.45, 1, 0.75],
      ),
    ),
    trim,
  );
  armor.name = side < 0 ? "leg-trim-left" : "leg-trim-right";
  armor.castShadow = false;
  pivot.add(armor);
  return pivot;
};

const makeArm = (
  side: -1 | 1,
  upperMaterial: THREE.MeshStandardMaterial,
  forearmMaterial: THREE.MeshStandardMaterial,
): ArmRig => {
  const geometry = new THREE.CapsuleGeometry(0.095, 0.28, 4, 8);
  const upper = new THREE.Mesh(geometry, upperMaterial);
  const forearm = new THREE.Mesh(geometry.clone(), forearmMaterial);
  upper.name = side < 0 ? "upper-arm-left" : "upper-arm-right";
  forearm.name = side < 0 ? "forearm-left" : "forearm-right";
  return { side, upper, forearm };
};

const initialWalkPhase = (id: string): number => {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return (Math.abs(hash) % 628) / 100;
};

export const createRemoteFighter = (
  player: PlayerSnapshot,
  highQuality: boolean,
): FighterVisual => {
  const root = new THREE.Group();
  root.name = `fighter-${player.id}`;
  root.position.set(
    player.position.x,
    player.position.y - FIGHTER_FLOOR_OFFSET,
    player.position.z,
  );
  root.rotation.y = player.yaw;

  const palette = paletteFor(player);
  const primary = standardMaterial(palette.primary, {
    emissive: palette.emissive,
    emissiveIntensity: 0.34,
  });
  const underSuit = standardMaterial(0x20263d, {
    roughness: 0.6,
    metalness: 0.18,
  });
  const trim = standardMaterial(palette.trim, {
    roughness: 0.26,
    metalness: 0.66,
    emissive: palette.emissive,
    emissiveIntensity: 0.45,
  });
  const visorMaterial = standardMaterial(palette.visor, {
    roughness: 0.12,
    metalness: 0.4,
    emissive: palette.visor,
    emissiveIntensity: 2,
  });

  const primaryArmor = new THREE.Mesh(
    merged(
      transformed(
        new THREE.CylinderGeometry(0.4, 0.31, 0.8, 8, 1),
        [0, 1.18, 0],
        [0, 0, 0],
        [1, 1, 0.72],
      ),
      transformed(
        new THREE.DodecahedronGeometry(0.17, 0),
        [-0.44, 1.41, 0],
        [0, 0, -0.14],
        [1.15, 0.72, 0.9],
      ),
      transformed(
        new THREE.DodecahedronGeometry(0.17, 0),
        [0.44, 1.41, 0],
        [0, 0, 0.14],
        [1.15, 0.72, 0.9],
      ),
      transformed(
        new THREE.BoxGeometry(0.075, 0.22, 0.16),
        [-0.285, 1.86, -0.005],
        [0, 0, -0.05],
      ),
      transformed(
        new THREE.BoxGeometry(0.075, 0.22, 0.16),
        [0.285, 1.86, -0.005],
        [0, 0, 0.05],
      ),
      transformed(
        new THREE.BoxGeometry(0.2, 0.075, 0.22),
        [0, 2.13, 0.01],
        [0.04, 0, 0],
      ),
      transformed(
        new THREE.CylinderGeometry(0.18, 0.2, 0.08, 8),
        [0, 1.59, 0],
        [0, 0, 0],
        [1, 1, 0.76],
      ),
    ),
    primary,
  );
  primaryArmor.name = "primary-armor";
  root.add(primaryArmor);

  const darkCore = new THREE.Mesh(
    merged(
      transformed(
        new THREE.CylinderGeometry(0.34, 0.29, 0.28, 8),
        [0, 0.72, 0],
        [0, 0, 0],
        [1, 1, 0.72],
      ),
      transformed(
        new THREE.CylinderGeometry(0.31, 0.3, 0.24, 8),
        [0, 0.93, 0],
        [0, 0, 0],
        [1, 1, 0.7],
      ),
      transformed(
        new THREE.CylinderGeometry(0.13, 0.15, 0.18, 8),
        [0, 1.55, 0],
      ),
      transformed(
        new THREE.DodecahedronGeometry(0.3, highQuality ? 1 : 0),
        [0, 1.85, 0],
        [0, 0, 0],
        [1, 1.05, 0.88],
      ),
    ),
    underSuit,
  );
  darkCore.name = "dark-core";
  root.add(darkCore);

  const armorParts = [
    transformed(
      new THREE.CapsuleGeometry(0.065, 0.42, 4, 8),
      [0, 1.27, -0.32],
      [-0.08, 0, Math.PI / 2],
      [1, 1, 0.9],
    ),
    transformed(
      new THREE.CapsuleGeometry(0.035, 0.36, 4, 8),
      [0, 0.94, -0.235],
      [0, 0, Math.PI / 2],
      [1, 1, 0.9],
    ),
    transformed(
      new THREE.CapsuleGeometry(0.052, 0.225, 4, 8),
      [0, 1.69, -0.26],
      [0.08, 0, Math.PI / 2],
      [1, 1, 0.9],
    ),
  ];
  if (highQuality)
    armorParts.push(
      transformed(
        new THREE.BoxGeometry(0.07, 0.13, 0.08),
        [0, 2.16, 0.005],
        [0.08, 0, 0],
      ),
    );
  const metalArmor = new THREE.Mesh(merged(...armorParts), trim);
  metalArmor.name = "metal-trim";
  metalArmor.castShadow = false;
  root.add(metalArmor);

  const visor = new THREE.Mesh(
    transformed(
      new THREE.CapsuleGeometry(0.055, 0.32, 4, 8),
      [0, 1.91, -0.275],
      [0, 0, Math.PI / 2],
      [1, 1, 0.58],
    ),
    visorMaterial,
  );
  visor.name = "visor";
  visor.castShadow = false;
  root.add(visor);

  const leftArm = makeArm(-1, underSuit, trim);
  const rightArm = makeArm(1, underSuit, trim);
  root.add(leftArm.upper, leftArm.forearm, rightArm.upper, rightArm.forearm);

  const leftGlove = makeGlove(-1, primary, trim);
  const rightGlove = makeGlove(1, primary, trim);
  root.add(leftGlove, rightGlove);

  const leftLeg = makeLeg(-1, underSuit, trim);
  const rightLeg = makeLeg(1, underSuit, trim);
  root.add(leftLeg, rightLeg);

  const guard = new THREE.Mesh(
    new THREE.TorusGeometry(0.64, 0.035, 8, 32),
    new THREE.MeshBasicMaterial({
      color: 0x72edff,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  guard.position.set(0, 1.5, -0.58);
  guard.name = "guard";
  guard.visible = false;
  root.add(guard);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.67, 0.035, 8, 28),
    new THREE.MeshBasicMaterial({
      color: 0x55f7ff,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.08;
  ring.name = "ring";
  ring.visible = player.protected;
  root.add(ring);

  if (highQuality) {
    primaryArmor.castShadow = true;
    darkCore.castShadow = true;
    for (const leg of [leftLeg, rightLeg]) {
      const mesh = leg.children[0];
      if (mesh instanceof THREE.Mesh) mesh.castShadow = true;
    }
  }

  const visual: FighterVisual = {
    root,
    leftGlove,
    rightGlove,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    guard,
    ring,
    appearance: { key: palette.key, primary, trim, visor: visorMaterial },
    walkPhase: initialWalkPhase(player.id),
  };
  poseFighterArms(visual);
  return visual;
};

const applyPalette = (appearance: Appearance, palette: Palette): void => {
  if (appearance.key === palette.key) return;
  appearance.key = palette.key;
  appearance.primary.color.setHex(palette.primary);
  appearance.primary.emissive.setHex(palette.emissive);
  appearance.trim.color.setHex(palette.trim);
  appearance.trim.emissive.setHex(palette.emissive);
  if (appearance.visor) {
    appearance.visor.color.setHex(palette.visor);
    appearance.visor.emissive.setHex(palette.visor);
  }
};

export const updateFighterAppearance = (
  visual: FighterVisual,
  player: PlayerSnapshot,
): void => applyPalette(visual.appearance, paletteFor(player));

export const updateFirstPersonGloveAppearance = (
  glove: THREE.Group,
  player: PlayerSnapshot,
): void => {
  const appearance = glove.userData.appearance as Appearance | undefined;
  if (appearance) applyPalette(appearance, paletteFor(player));
};

const alignArmSegment = (
  segment: THREE.Mesh,
  start: THREE.Vector3,
  end: THREE.Vector3,
): void => {
  const direction = end.clone().sub(start);
  const length = Math.max(0.001, direction.length());
  segment.position.copy(start).add(end).multiplyScalar(0.5);
  segment.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.multiplyScalar(1 / length),
  );
  segment.scale.set(1, length / ARM_GEOMETRY_LENGTH, 1);
};

const poseArm = (arm: ArmRig, glove: THREE.Group): void => {
  const shoulder = new THREE.Vector3(arm.side * 0.44, 1.41, 0);
  const wrist = glove.position.clone().add(new THREE.Vector3(0, -0.015, 0.14));
  const shoulderToWrist = wrist.clone().sub(shoulder);
  const distance = Math.max(0.001, shoulderToWrist.length());
  const direction = shoulderToWrist.clone().multiplyScalar(1 / distance);
  const midpoint = shoulder.clone().add(wrist).multiplyScalar(0.5);
  const bend = new THREE.Vector3(arm.side * 0.7, -0.9, -0.2);
  bend.addScaledVector(direction, -bend.dot(direction));
  if (bend.lengthSq() < 0.0001) bend.set(arm.side, -1, 0);
  bend.normalize();
  const segmentLength = Math.max(0.37, distance * 0.51);
  const bendDistance = Math.sqrt(
    Math.max(0.0025, segmentLength ** 2 - (distance * 0.5) ** 2),
  );
  const elbow = midpoint.addScaledVector(bend, bendDistance);
  alignArmSegment(arm.upper, shoulder, elbow);
  alignArmSegment(arm.forearm, elbow, wrist);
};

export const poseFighterArms = (visual: FighterVisual): void => {
  poseArm(visual.leftArm, visual.leftGlove);
  poseArm(visual.rightArm, visual.rightGlove);
};

export const disposeObject3D = (root: THREE.Object3D): void => {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    const renderable = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    if (renderable.geometry) geometries.add(renderable.geometry);
    const objectMaterials = Array.isArray(renderable.material)
      ? renderable.material
      : renderable.material
        ? [renderable.material]
        : [];
    for (const material of objectMaterials) materials.add(material);
  });
  for (const material of materials)
    for (const value of Object.values(material))
      if (value instanceof THREE.Texture) textures.add(value);
  for (const texture of textures) texture.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
};
