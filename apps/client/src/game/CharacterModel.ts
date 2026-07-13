import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { PlayerSnapshot } from "@knockout/shared";

const FIGHTER_FLOOR_OFFSET = 1.1;
const ARM_GEOMETRY_LENGTH = 0.48;
const ARM_RADIUS = 0.108;
const SHOULDER_Y = 1.46;
const SHOULDER_X = 0.4;
const GLOVE_CUFF_ANCHOR = new THREE.Vector3(0, -0.01, 0.258);

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

export type FighterArmRig = {
  side: -1 | 1;
  upper: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  forearm: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  elbow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  shoulder: THREE.Vector3;
  wrist: THREE.Vector3;
};

export type FighterVisual = {
  root: THREE.Group;
  leftGlove: THREE.Group;
  rightGlove: THREE.Group;
  leftArm: FighterArmRig;
  rightArm: FighterArmRig;
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
      primary: 0xf28c28,
      trim: 0xffc14a,
      emissive: 0x361500,
      visor: 0x8ff5ff,
    };
  if (player.team === "red")
    return {
      key: "red",
      primary: 0xf23d63,
      trim: 0xff91aa,
      emissive: 0x3d0712,
      visor: 0x8ff5ff,
    };
  if (player.team === "blue")
    return {
      key: "blue",
      primary: 0x338ee8,
      trim: 0x84d4ff,
      emissive: 0x062341,
      visor: 0x8ff5ff,
    };
  return {
    key: "neutral",
    primary: 0x7157dd,
    trim: 0xa99aff,
    emissive: 0x17103f,
    visor: 0x8ff5ff,
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
    roughness: 0.46,
    metalness: 0.12,
    ...options,
  });

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
      position: new THREE.Vector3(side * 0.31, -0.27, -1.38),
      rotationX: -0.38,
      rotationZ: side * 0.22,
    };
  if (charging)
    return {
      position: new THREE.Vector3(
        side * (0.48 + chargeAmount * 0.09),
        -0.58 - chargeAmount * 0.06,
        -1.54 + chargeAmount * 0.14,
      ),
      rotationX: -0.04 - chargeAmount * 0.36,
      rotationZ: side * (0.06 - chargeAmount * 0.2),
    };
  const restX = side < 0 ? 0.44 : 0.48;
  const restY = side < 0 ? -0.48 : -0.58;
  const restZ = side < 0 ? -1.46 : -1.52;
  return {
    position: new THREE.Vector3(
      side * (restX - (punching ? punchPhase * 0.22 : 0)) + handSway,
      restY + handBob + (punching ? punchPhase * 0.18 : 0),
      restZ - (punching ? punchPhase * 0.9 : 0),
    ),
    rotationX: -0.04 - (punching ? punchPhase * 0.04 : 0),
    rotationZ: side * (0.06 - (punching ? punchPhase * 0.1 : 0)),
  };
};

const smoothGloveShell = (
  side: -1 | 1,
  firstPerson: boolean,
): THREE.BufferGeometry => {
  const scale = firstPerson ? 0.91 : 1;
  const frontRadius = 0.11 * scale;
  const profile = [
    new THREE.Vector2(frontRadius, -0.245 * scale),
    new THREE.Vector2(0.145 * scale, -0.222 * scale),
    new THREE.Vector2(0.164 * scale, -0.145 * scale),
    new THREE.Vector2(0.166 * scale, -0.035 * scale),
    new THREE.Vector2(0.153 * scale, 0.08 * scale),
    new THREE.Vector2(0.13 * scale, 0.18 * scale),
    new THREE.Vector2(0.103 * scale, 0.275 * scale),
  ];
  const shellScale: [number, number, number] = firstPerson
    ? [1, 0.96, 0.78]
    : [1.04, 1, 0.82];
  const thumbRadius = firstPerson ? 0.052 : 0.059;
  return merged(
    transformed(
      new THREE.LatheGeometry(profile, firstPerson ? 28 : 24),
      [0, 0, 0],
      [Math.PI / 2, 0, 0],
      shellScale,
    ),
    transformed(
      new THREE.CircleGeometry(frontRadius, firstPerson ? 28 : 24),
      [0, 0, -0.245 * scale * shellScale[1]],
      [0, Math.PI, 0],
      [shellScale[0], shellScale[2], 1],
    ),
    transformed(
      new THREE.SphereGeometry(thumbRadius, 16, 12),
      [-side * (firstPerson ? 0.098 : 0.112), -0.026, -0.005],
      [0.08, 0, side * 0.34],
      [0.82, 0.82, 1.12],
    ),
  );
};

const smoothGloveCuff = (firstPerson: boolean): THREE.BufferGeometry => {
  const radius = firstPerson ? 0.092 : 0.108;
  const center = firstPerson ? 0.267 : 0.292;
  const length = firstPerson ? 0.105 : 0.12;
  return merged(
    transformed(
      new THREE.CylinderGeometry(radius * 1.04, radius * 0.96, length, 20),
      [0, 0, center],
      [Math.PI / 2, 0, 0],
      [1, 1, 0.82],
    ),
    transformed(
      new THREE.TorusGeometry(
        radius * 1.01,
        firstPerson ? 0.009 : 0.011,
        8,
        24,
      ),
      [0, 0, center - length * 0.42],
      [0, 0, 0],
      [1, 0.82, 1],
    ),
  );
};

export const createFirstPersonGlove = (side: -1 | 1): THREE.Group => {
  const group = new THREE.Group();
  group.name =
    side < 0 ? "first-person-glove-left" : "first-person-glove-right";
  group.userData.side = side;
  group.userData.design = "combat-robot-glove-v5";

  const primary = standardMaterial(0xf23d63, {
    roughness: 0.5,
    metalness: 0.05,
    emissive: 0x3d0712,
    emissiveIntensity: 0.16,
  });
  const trim = standardMaterial(0xff91aa, {
    roughness: 0.48,
    metalness: 0.08,
    emissive: 0x3d0712,
    emissiveIntensity: 0.18,
  });
  const sleeveMaterial = standardMaterial(0x202a42, {
    roughness: 0.56,
    metalness: 0.1,
  });

  const shell = new THREE.Mesh(smoothGloveShell(side, true), primary);
  shell.name = "fp-glove-shell";
  group.add(shell);

  const cuff = new THREE.Mesh(smoothGloveCuff(true), trim);
  cuff.name = "fp-cuff";
  group.add(cuff);

  const sleeve = new THREE.Mesh(
    merged(
      transformed(
        new THREE.SphereGeometry(0.09, 18, 12),
        [0, -0.01, 0.292],
        [0, 0, 0],
        [1, 0.82, 0.86],
      ),
      transformed(
        new THREE.CylinderGeometry(0.112, 0.087, 0.32, 20),
        [0, -0.01, 0.445],
        [Math.PI / 2, 0, 0],
        [1, 1, 0.82],
      ),
    ),
    sleeveMaterial,
  );
  sleeve.name = "fp-sleeve";
  group.add(sleeve);

  const forearmArmor = new THREE.Mesh(
    transformed(
      new THREE.CapsuleGeometry(0.034, 0.16, 8, 16),
      [0, 0.068, 0.445],
      [Math.PI / 2, 0, 0],
      [1.4, 0.56, 0.82],
    ),
    primary,
  );
  forearmArmor.name = "fp-forearm-armor";
  forearmArmor.castShadow = false;
  group.add(forearmArmor);

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
  group.rotation.y = side * -0.035;
  group.userData.appearance = {
    key: "",
    primary,
    trim,
  } satisfies Appearance;
  return group;
};

export const fighterRestHandPosition = (side: -1 | 1): THREE.Vector3 =>
  side < 0
    ? new THREE.Vector3(-0.38, 1.28, -0.38)
    : new THREE.Vector3(0.42, 1.18, -0.3);

const makeGlove = (
  side: -1 | 1,
  primary: THREE.MeshStandardMaterial,
  trim: THREE.MeshStandardMaterial,
): THREE.Group => {
  const glove = new THREE.Group();
  glove.name = side < 0 ? "glove-left" : "glove-right";
  glove.userData.design = "combat-robot-glove-v5";
  glove.position.copy(fighterRestHandPosition(side));

  const shell = new THREE.Mesh(smoothGloveShell(side, false), primary);
  shell.name = side < 0 ? "glove-shell-left" : "glove-shell-right";
  glove.add(shell);

  const cuff = new THREE.Mesh(smoothGloveCuff(false), trim);
  cuff.name = side < 0 ? "glove-cuff-left" : "glove-cuff-right";
  cuff.castShadow = false;
  glove.add(cuff);
  return glove;
};

const makeLeg = (
  side: -1 | 1,
  suit: THREE.MeshStandardMaterial,
  primary: THREE.MeshStandardMaterial,
): THREE.Group => {
  const pivot = new THREE.Group();
  pivot.name = side < 0 ? "leg-left" : "leg-right";
  pivot.position.set(side * 0.18, 0.88, 0.01);

  const leg = new THREE.Mesh(
    merged(
      transformed(
        new THREE.SphereGeometry(0.15, 18, 12),
        [0, 0.015, 0],
        [0, 0, 0],
        [1, 0.92, 0.9],
      ),
      transformed(
        new THREE.CapsuleGeometry(0.142, 0.18, 8, 16),
        [0, -0.18, 0],
        [0.025 * side, 0, 0],
        [1, 1, 0.9],
      ),
      transformed(
        new THREE.SphereGeometry(0.12, 18, 12),
        [0, -0.405, -0.005],
        [0, 0, 0],
        [1.04, 0.92, 0.92],
      ),
      transformed(
        new THREE.CapsuleGeometry(0.118, 0.18, 8, 16),
        [0, -0.61, 0.008],
        [-0.018 * side, 0, 0],
        [1, 1, 0.9],
      ),
    ),
    suit,
  );
  leg.name = side < 0 ? "leg-suit-left" : "leg-suit-right";
  pivot.add(leg);

  const kneePad = new THREE.Mesh(
    merged(
      transformed(
        new THREE.SphereGeometry(1, 18, 12),
        [0, -0.19, -0.115],
        [-0.05, 0, 0],
        [0.122, 0.18, 0.07],
      ),
      transformed(
        new THREE.SphereGeometry(1, 18, 12),
        [0, -0.405, -0.12],
        [-0.1, 0, 0],
        [0.13, 0.082, 0.072],
      ),
      transformed(
        new THREE.CapsuleGeometry(0.082, 0.15, 8, 14),
        [0, -0.625, -0.066],
        [-0.04, 0, 0],
        [1, 1, 0.74],
      ),
      transformed(
        new THREE.SphereGeometry(1, 18, 12),
        [0, -0.82, -0.075],
        [0, 0, 0],
        [0.158, 0.1, 0.215],
      ),
    ),
    primary,
  );
  kneePad.name = side < 0 ? "leg-armor-left" : "leg-armor-right";
  kneePad.castShadow = false;
  pivot.add(kneePad);
  return pivot;
};

const makeArm = (
  side: -1 | 1,
  suit: THREE.MeshStandardMaterial,
): FighterArmRig => {
  const geometry = new THREE.CapsuleGeometry(
    ARM_RADIUS,
    ARM_GEOMETRY_LENGTH - ARM_RADIUS * 2,
    8,
    14,
  );
  const upper = new THREE.Mesh(geometry, suit);
  const forearm = new THREE.Mesh(geometry.clone(), suit);
  const elbow = new THREE.Mesh(
    transformed(
      new THREE.SphereGeometry(1, 18, 12),
      [0, 0, 0],
      [0, 0, 0],
      [0.118, 0.102, 0.106],
    ),
    suit,
  );
  upper.name = side < 0 ? "upper-arm-left" : "upper-arm-right";
  forearm.name = side < 0 ? "forearm-left" : "forearm-right";
  elbow.name = side < 0 ? "elbow-left" : "elbow-right";
  return {
    side,
    upper,
    forearm,
    elbow,
    shoulder: new THREE.Vector3(side * SHOULDER_X, SHOULDER_Y, 0),
    wrist: new THREE.Vector3(),
  };
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
  root.userData.design = "cohesive-combat-robot-v5";
  root.position.set(
    player.position.x,
    player.position.y - FIGHTER_FLOOR_OFFSET,
    player.position.z,
  );
  root.rotation.y = player.yaw;

  const palette = paletteFor(player);
  const primary = standardMaterial(palette.primary, {
    roughness: 0.38,
    metalness: 0.16,
    emissive: palette.emissive,
    emissiveIntensity: 0.12,
  });
  const suit = standardMaterial(0x252d43, {
    roughness: 0.5,
    metalness: 0.14,
  });
  const trim = standardMaterial(palette.trim, {
    roughness: 0.46,
    metalness: 0.12,
    emissive: palette.emissive,
    emissiveIntensity: 0.12,
  });
  const visorMaterial = standardMaterial(palette.visor, {
    roughness: 0.12,
    metalness: 0.22,
    emissive: palette.visor,
    emissiveIntensity: 2.4,
  });

  const primaryShell = new THREE.Mesh(
    merged(
      transformed(
        new THREE.CylinderGeometry(0.405, 0.34, 0.56, 12),
        [0, 1.39, 0],
        [0, 0, 0],
        [1, 1, 0.66],
      ),
      transformed(
        new THREE.CylinderGeometry(0.34, 0.26, 0.38, 12),
        [0, 1.01, 0.004],
        [0, 0, 0],
        [1, 1, 0.64],
      ),
      transformed(
        new THREE.CylinderGeometry(0.12, 0.105, 0.16, 12),
        [-SHOULDER_X, SHOULDER_Y, -0.002],
        [0, 0, -Math.PI / 2],
        [1, 1, 0.82],
      ),
      transformed(
        new THREE.CylinderGeometry(0.12, 0.105, 0.16, 12),
        [SHOULDER_X, SHOULDER_Y, -0.002],
        [0, 0, Math.PI / 2],
        [1, 1, 0.82],
      ),
    ),
    primary,
  );
  primaryShell.name = "primary-shell";
  root.add(primaryShell);

  const suitCore = new THREE.Mesh(
    merged(
      transformed(
        new THREE.CylinderGeometry(0.25, 0.28, 0.22, 12),
        [0, 0.86, 0.012],
        [0, 0, 0],
        [1, 1, 0.72],
      ),
      transformed(
        new THREE.CylinderGeometry(0.13, 0.115, 0.12, 14),
        [0, 1.7, 0.015],
        [0, 0, 0],
        [1, 1, 0.82],
      ),
      transformed(
        new THREE.CylinderGeometry(0.106, 0.106, 0.14, 12),
        [-SHOULDER_X, SHOULDER_Y, 0],
        [0, 0, -Math.PI / 2],
        [1, 1, 0.86],
      ),
      transformed(
        new THREE.CylinderGeometry(0.106, 0.106, 0.14, 12),
        [SHOULDER_X, SHOULDER_Y, 0],
        [0, 0, Math.PI / 2],
        [1, 1, 0.86],
      ),
      transformed(
        new THREE.CapsuleGeometry(0.105, 0.39, 8, 18),
        [0, 1.42, -0.272],
        [0, 0, Math.PI / 2],
        [1, 0.9, 0.46],
      ),
    ),
    suit,
  );
  suitCore.name = "suit-core";
  root.add(suitCore);

  const helmetShell = new THREE.Mesh(
    transformed(
      new THREE.SphereGeometry(1, 24, 18),
      [0, 1.98, 0.015],
      [0, 0, 0],
      [0.292, 0.31, 0.245],
    ),
    primary,
  );
  helmetShell.name = "helmet-shell";
  root.add(helmetShell);

  const faceplate = new THREE.Mesh(
    transformed(
      new THREE.SphereGeometry(1, 22, 16),
      [0, 1.965, -0.238],
      [0, 0, 0],
      [0.238, 0.205, 0.052],
    ),
    suit,
  );
  faceplate.name = "faceplate";
  faceplate.castShadow = false;
  root.add(faceplate);

  const trimShell = new THREE.Mesh(
    merged(
      transformed(
        new THREE.CapsuleGeometry(0.026, 0.2, 6, 14),
        [-0.105, 1.39, -0.278],
        [-0.03, 0, 0.68],
        [1, 1, 0.74],
      ),
      transformed(
        new THREE.CapsuleGeometry(0.026, 0.2, 6, 14),
        [0.105, 1.39, -0.278],
        [-0.03, 0, -0.68],
        [1, 1, 0.74],
      ),
      transformed(
        new THREE.CylinderGeometry(0.047, 0.047, 0.025, 16),
        [0, 1.28, -0.298],
        [Math.PI / 2, 0, 0],
        [1, 1, 0.72],
      ),
    ),
    trim,
  );
  trimShell.name = "chest-chevron";
  trimShell.castShadow = false;
  root.add(trimShell);

  const visorFrame = new THREE.Mesh(
    transformed(
      new THREE.CapsuleGeometry(0.062, 0.27, 8, 18),
      [0, 1.99, -0.285],
      [0, 0, Math.PI / 2],
    ),
    trim,
  );
  visorFrame.name = "visor-frame";
  visorFrame.castShadow = false;
  root.add(visorFrame);

  const visor = new THREE.Mesh(
    transformed(
      new THREE.CapsuleGeometry(0.045, 0.275, 8, 18),
      [0, 1.99, -0.333],
      [0, 0, Math.PI / 2],
      [1, 1, 0.78],
    ),
    visorMaterial,
  );
  visor.name = "visor";
  visor.castShadow = false;
  root.add(visor);

  const leftArm = makeArm(-1, suit);
  const rightArm = makeArm(1, suit);
  root.add(
    leftArm.upper,
    leftArm.forearm,
    leftArm.elbow,
    rightArm.upper,
    rightArm.forearm,
    rightArm.elbow,
  );

  const leftGlove = makeGlove(-1, primary, trim);
  const rightGlove = makeGlove(1, primary, trim);
  root.add(leftGlove, rightGlove);

  const leftLeg = makeLeg(-1, suit, primary);
  const rightLeg = makeLeg(1, suit, primary);
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
    primaryShell.castShadow = true;
    suitCore.castShadow = true;
    helmetShell.castShadow = true;
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

const poseArm = (arm: FighterArmRig, glove: THREE.Group): void => {
  const wristOffset = GLOVE_CUFF_ANCHOR.clone().applyQuaternion(
    glove.quaternion,
  );
  arm.wrist.copy(glove.position).add(wristOffset);
  const shoulderToWrist = arm.wrist.clone().sub(arm.shoulder);
  const distance = Math.max(0.001, shoulderToWrist.length());
  const direction = shoulderToWrist.clone().multiplyScalar(1 / distance);
  const midpoint = arm.shoulder.clone().add(arm.wrist).multiplyScalar(0.5);
  const bend = new THREE.Vector3(arm.side * 0.28, -1, -0.38);
  bend.addScaledVector(direction, -bend.dot(direction));
  if (bend.lengthSq() < 0.0001) bend.set(arm.side, -1, -0.2);
  bend.normalize();
  const segmentLength = Math.max(0.36, distance * 0.51);
  const bendDistance = Math.sqrt(
    Math.max(0.0025, segmentLength ** 2 - (distance * 0.5) ** 2),
  );
  const elbow = midpoint.addScaledVector(bend, bendDistance);
  arm.elbow.position.copy(elbow);
  alignArmSegment(arm.upper, arm.shoulder, elbow);
  alignArmSegment(arm.forearm, elbow, arm.wrist);
};

export const poseFighterArms = (visual: FighterVisual): void => {
  poseArm(visual.leftArm, visual.leftGlove);
  poseArm(visual.rightArm, visual.rightGlove);
};

const segmentEndpoints = (
  segment: THREE.Mesh,
): [THREE.Vector3, THREE.Vector3] => {
  const halfAxis = new THREE.Vector3(0, 1, 0)
    .applyQuaternion(segment.quaternion)
    .multiplyScalar((ARM_GEOMETRY_LENGTH * segment.scale.y) / 2);
  return [
    segment.position.clone().sub(halfAxis),
    segment.position.clone().add(halfAxis),
  ];
};

export const fighterArmConnectionError = (arm: FighterArmRig): number => {
  const [upperStart, upperEnd] = segmentEndpoints(arm.upper);
  const [forearmStart, forearmEnd] = segmentEndpoints(arm.forearm);
  return Math.max(
    upperStart.distanceTo(arm.shoulder),
    upperEnd.distanceTo(arm.elbow.position),
    forearmStart.distanceTo(arm.elbow.position),
    forearmEnd.distanceTo(arm.wrist),
  );
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
