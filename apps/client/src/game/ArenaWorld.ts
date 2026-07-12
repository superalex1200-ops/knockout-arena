import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import {
  ARENA_FLOOR_THICKNESS,
  ARENA_FLOOR_TOP,
  ARENA_WALLS,
  GAME,
  type ArenaWall,
} from "@knockout/shared";

export type GraphicsQuality = "low" | "medium" | "high";

export const arenaWallTransform = (wall: ArenaWall) => ({
  width: wall.maxX - wall.minX,
  height: wall.height,
  depth: wall.maxZ - wall.minZ,
  x: (wall.minX + wall.maxX) * 0.5,
  y: wall.height * 0.5,
  z: (wall.minZ + wall.maxZ) * 0.5,
});

const accentColor = (wall: ArenaWall): number =>
  wall.accent === "cyan" ? 0x43e9ff : 0xff477d;

function createFloor(): THREE.Group {
  const group = new THREE.Group();
  group.name = "arena-floor";
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(
      GAME.arenaHalfSize * 2,
      ARENA_FLOOR_THICKNESS,
      GAME.arenaHalfSize * 2,
    ),
    new THREE.MeshStandardMaterial({
      color: 0x151b32,
      roughness: 0.55,
      metalness: 0.34,
    }),
  );
  floor.name = "arena-floor-solid";
  floor.position.y = ARENA_FLOOR_TOP - ARENA_FLOOR_THICKNESS * 0.5;
  floor.receiveShadow = true;
  group.add(floor);

  const grid = new THREE.GridHelper(30, 30, 0x22e7ff, 0x26304d);
  grid.name = "arena-floor-grid";
  grid.position.y = 0.02;
  group.add(grid);

  const edgeMaterial = new THREE.MeshStandardMaterial({
    color: 0x00d9ff,
    emissive: 0x008eb8,
    emissiveIntensity: 3,
  });
  for (const [x, z, width, depth] of [
    [0, -15, 30, 0.16],
    [0, 15, 30, 0.16],
    [-15, 0, 0.16, 30],
    [15, 0, 0.16, 30],
  ] as const) {
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.13, depth),
      edgeMaterial,
    );
    edge.position.set(x, 0.12, z);
    group.add(edge);
  }

  const centerRing = new THREE.Mesh(
    new THREE.TorusGeometry(4.2, 0.055, 8, 64),
    new THREE.MeshBasicMaterial({
      color: 0xff3e76,
      transparent: true,
      opacity: 0.55,
    }),
  );
  centerRing.rotation.x = Math.PI / 2;
  centerRing.position.y = 0.045;
  group.add(centerRing);
  return group;
}

function createLights(graphics: GraphicsQuality): THREE.Group {
  const group = new THREE.Group();
  group.name = "arena-lighting";
  group.add(new THREE.HemisphereLight(0x8fbcff, 0x111424, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 3.2);
  sun.position.set(8, 18, 7);
  sun.castShadow = graphics === "high";
  if (sun.castShadow) {
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 55;
    sun.shadow.normalBias = 0.025;
  }
  group.add(sun);
  return group;
}

function createCollisionWall(wall: ArenaWall): THREE.Group {
  const transform = arenaWallTransform(wall);
  const color = accentColor(wall);
  const longOnX = transform.width > transform.depth;
  const group = new THREE.Group();
  group.name = `arena-wall-${wall.id}`;
  group.position.set(transform.x, 0, transform.z);
  group.userData.collider = wall;

  const bounds = new THREE.Mesh(
    new THREE.BoxGeometry(transform.width, transform.height, transform.depth),
    new THREE.MeshStandardMaterial({
      color: 0x14213c,
      emissive: color,
      emissiveIntensity: 0.24,
      metalness: 0.78,
      roughness: 0.28,
      transparent: true,
      opacity: 0.38,
    }),
  );
  bounds.name = `arena-wall-${wall.id}-bounds`;
  bounds.position.y = transform.y;
  bounds.renderOrder = 0;
  bounds.castShadow = false;
  bounds.receiveShadow = false;
  (bounds.material as THREE.MeshStandardMaterial).depthWrite = false;
  bounds.userData.colliderId = wall.id;
  group.add(bounds);

  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0x192743,
    emissive: 0x071528,
    emissiveIntensity: 0.8,
    metalness: 0.88,
    roughness: 0.23,
  });
  const glowMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const makeBeam = (
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
  ) => {
    const radius = Math.min(0.055, width * 0.2, height * 0.2, depth * 0.2);
    const beam = new THREE.Mesh(
      new RoundedBoxGeometry(width, height, depth, 3, radius),
      frameMaterial,
    );
    beam.position.set(x, y, z);
    beam.castShadow = true;
    group.add(beam);
  };
  const beam = 0.16;
  makeBeam(transform.width, beam, transform.depth, 0, beam * 0.5, 0);
  makeBeam(
    transform.width,
    beam,
    transform.depth,
    0,
    transform.height - beam * 0.5,
    0,
  );
  if (longOnX) {
    makeBeam(
      beam,
      transform.height - beam * 2,
      transform.depth,
      -transform.width * 0.5 + beam * 0.5,
      transform.height * 0.5,
      0,
    );
    makeBeam(
      beam,
      transform.height - beam * 2,
      transform.depth,
      transform.width * 0.5 - beam * 0.5,
      transform.height * 0.5,
      0,
    );
  } else {
    makeBeam(
      transform.width,
      transform.height - beam * 2,
      beam,
      0,
      transform.height * 0.5,
      -transform.depth * 0.5 + beam * 0.5,
    );
    makeBeam(
      transform.width,
      transform.height - beam * 2,
      beam,
      0,
      transform.height * 0.5,
      transform.depth * 0.5 - beam * 0.5,
    );
  }

  const field = new THREE.Mesh(
    new THREE.BoxGeometry(
      longOnX ? transform.width - 0.26 : 0.12,
      transform.height - 0.34,
      longOnX ? 0.12 : transform.depth - 0.26,
    ),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  field.name = `arena-wall-${wall.id}-energy`;
  field.position.y = transform.height * 0.5;
  field.renderOrder = 1;
  group.add(field);

  const groove = new THREE.Mesh(
    new THREE.BoxGeometry(
      longOnX ? transform.width - 0.34 : 0.035,
      0.035,
      longOnX ? 0.035 : transform.depth - 0.34,
    ),
    glowMaterial,
  );
  groove.position.y = 0.29;
  groove.renderOrder = 2;
  group.add(groove);

  const marker = new THREE.Mesh(
    new THREE.TorusGeometry(0.22, 0.022, 8, 28),
    glowMaterial,
  );
  marker.position.y = transform.height * 0.57;
  if (!longOnX) marker.rotation.y = Math.PI / 2;
  marker.renderOrder = 2;
  group.add(marker);
  return group;
}

function createPlatformSkirt(): THREE.Group {
  const group = new THREE.Group();
  group.name = "arena-platform-skirt";
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(16.2, 12.8, 5.8, 48, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x0b1329,
      emissive: 0x050b18,
      emissiveIntensity: 0.7,
      metalness: 0.86,
      roughness: 0.3,
      side: THREE.DoubleSide,
    }),
  );
  shell.position.y = -4.65;
  group.add(shell);

  const panelMaterial = new THREE.MeshStandardMaterial({
    color: 0x101b34,
    emissive: 0x072033,
    emissiveIntensity: 0.7,
    metalness: 0.8,
    roughness: 0.28,
  });
  for (const [x, z, width, depth] of [
    [0, -15.05, 28.6, 0.12],
    [0, 15.05, 28.6, 0.12],
    [-15.05, 0, 0.12, 28.6],
    [15.05, 0, 0.12, 28.6],
  ] as const) {
    const panel = new THREE.Mesh(
      new RoundedBoxGeometry(width, 0.48, depth, 2, 0.04),
      panelMaterial,
    );
    panel.position.set(x, -1.42, z);
    group.add(panel);
  }
  return group;
}

function seededRandom() {
  let state = 0x4b4f4152;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function createBackdrop(graphics: GraphicsQuality): THREE.Group {
  const group = new THREE.Group();
  group.name = "arena-backdrop";
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(125, graphics === "low" ? 20 : 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `
        varying vec3 vSkyPosition;
        void main() {
          vSkyPosition = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vSkyPosition;
        void main() {
          float heightMix = smoothstep(-0.28, 0.68, vSkyPosition.y);
          vec3 lowColor = vec3(0.075, 0.035, 0.16);
          vec3 highColor = vec3(0.008, 0.018, 0.07);
          vec3 color = mix(lowColor, highColor, heightMix);
          float horizon = exp(-pow((vSkyPosition.y + 0.08) * 6.5, 2.0));
          color += vec3(0.03, 0.16, 0.22) * horizon;
          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    }),
  );
  sky.name = "arena-gradient-sky";
  group.add(sky);

  const random = seededRandom();
  const starCount =
    graphics === "high" ? 320 : graphics === "medium" ? 210 : 100;
  const positions = new Float32Array(starCount * 3);
  for (let index = 0; index < starCount; index++) {
    const angle = random() * Math.PI * 2;
    const y = random() * 1.1 - 0.2;
    const horizontal = Math.sqrt(Math.max(0, 1 - Math.min(1, y * y)));
    const radius = 78 + random() * 30;
    positions[index * 3] = Math.cos(angle) * horizontal * radius;
    positions[index * 3 + 1] = y * radius;
    positions[index * 3 + 2] = Math.sin(angle) * horizontal * radius;
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3),
  );
  const stars = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({
      color: 0xbcefff,
      size: graphics === "high" ? 0.24 : 0.2,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      fog: false,
    }),
  );
  stars.name = "arena-stars";
  group.add(stars);

  const towerCount = graphics === "high" ? 30 : graphics === "medium" ? 22 : 14;
  const towerGeometry = new THREE.BoxGeometry(1, 1, 1);
  const towers = new THREE.InstancedMesh(
    towerGeometry,
    new THREE.MeshStandardMaterial({
      color: 0x101a34,
      emissive: 0x08142f,
      emissiveIntensity: 1.1,
      metalness: 0.82,
      roughness: 0.36,
    }),
    towerCount,
  );
  const caps = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ vertexColors: true }),
    towerCount,
  );
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  for (let index = 0; index < towerCount; index++) {
    const angle = (index / towerCount) * Math.PI * 2 + (random() - 0.5) * 0.08;
    const radius = 43 + random() * 10;
    const width = 1.4 + random() * 2.5;
    const depth = 1.2 + random() * 2.2;
    const height = 7 + random() * 15;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle);
    matrix.compose(
      new THREE.Vector3(x, -8 + height * 0.5, z),
      quaternion,
      new THREE.Vector3(width, height, depth),
    );
    towers.setMatrixAt(index, matrix);
    matrix.compose(
      new THREE.Vector3(x, -7.93 + height, z),
      quaternion,
      new THREE.Vector3(width * 0.72, 0.09, depth * 0.72),
    );
    caps.setMatrixAt(index, matrix);
    caps.setColorAt(
      index,
      new THREE.Color(index % 3 === 0 ? 0xff477d : 0x43e9ff),
    );
  }
  towers.name = "arena-distant-towers";
  caps.name = "arena-distant-lights";
  towers.instanceMatrix.needsUpdate = true;
  caps.instanceMatrix.needsUpdate = true;
  if (caps.instanceColor) caps.instanceColor.needsUpdate = true;
  group.add(towers, caps);

  for (const [radius, y, color, opacity] of [
    [39, 6.5, 0x43e9ff, 0.36],
    [52, 11, 0xff477d, 0.2],
  ] as const) {
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.075, 5, graphics === "low" ? 72 : 128),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
      }),
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = y;
    group.add(halo);
  }

  if (graphics !== "low") {
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(7.5, 24, 16),
      new THREE.ShaderMaterial({
        fog: false,
        vertexShader: `
          varying vec3 vPlanetNormal;
          varying vec3 vPlanetPosition;
          void main() {
            vPlanetNormal = normalize(normalMatrix * normal);
            vPlanetPosition = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec3 vPlanetNormal;
          varying vec3 vPlanetPosition;
          void main() {
            float light = 0.42 + 0.58 * max(dot(vPlanetNormal, normalize(vec3(-0.5, 0.7, 0.8))), 0.0);
            float bands = 0.5 + 0.5 * sin(vPlanetPosition.y * 31.0 + vPlanetPosition.x * 2.5);
            vec3 violet = vec3(0.25, 0.08, 0.48);
            vec3 rose = vec3(0.63, 0.16, 0.56);
            vec3 color = mix(violet, rose, bands * 0.28) * light;
            float rim = pow(1.0 - max(vPlanetNormal.z, 0.0), 2.4);
            color += vec3(0.24, 0.12, 0.42) * rim;
            gl_FragColor = vec4(color, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      }),
    );
    moon.name = "arena-distant-moon";
    moon.position.set(48, 27, -91);
    group.add(moon);
    const moonRing = new THREE.Mesh(
      new THREE.TorusGeometry(10.2, 0.1, 6, 96),
      new THREE.MeshBasicMaterial({
        color: 0xff7fc4,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
        fog: false,
      }),
    );
    moonRing.name = "arena-distant-moon-ring";
    moonRing.position.copy(moon.position);
    moonRing.rotation.set(1.05, 0.38, -0.18);
    group.add(moonRing);
  }
  return group;
}

function createDeathWell(): THREE.Group {
  const group = new THREE.Group();
  group.name = "arena-death-well";
  const well = new THREE.Mesh(
    new THREE.CircleGeometry(17, 64),
    new THREE.MeshBasicMaterial({
      color: 0xe22f75,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  well.rotation.x = -Math.PI / 2;
  well.position.y = -10.5;
  group.add(well);
  for (const radius of [6, 11, 16]) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.055, 5, 96),
      new THREE.MeshBasicMaterial({
        color: radius === 11 ? 0x43e9ff : 0xff477d,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -10.4;
    group.add(ring);
  }
  return group;
}

export function createArenaWorld(graphics: GraphicsQuality): THREE.Group {
  const world = new THREE.Group();
  world.name = "arena-world";
  world.add(
    createBackdrop(graphics),
    createLights(graphics),
    createFloor(),
    createPlatformSkirt(),
    createDeathWell(),
  );
  for (const wall of ARENA_WALLS) world.add(createCollisionWall(wall));
  return world;
}
