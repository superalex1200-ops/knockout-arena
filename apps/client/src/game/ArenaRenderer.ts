import * as THREE from "three";
import {
  DEFAULT_MATCH_RULES,
  GAME,
  type PlayerSnapshot,
  type ServerMessage,
} from "@knockout/shared";
import type { GameSocket } from "../network";
import { AudioSystem } from "./AudioSystem";
import type { GameSettings } from "../settings";
import { MovementPredictor } from "./MovementPredictor";
import {
  cooldownReadiness,
  isPunchTargetValid,
  type CombatHudState,
} from "./combatHud";
import {
  createFirstPersonGlove,
  createRemoteFighter,
  disposeObject3D,
  poseFighterArms,
  updateFighterAppearance,
  updateFirstPersonGloveAppearance,
  type FighterVisual,
} from "./CharacterModel";

type Input = {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  dash: boolean;
  block: boolean;
  charging: boolean;
};
export type TutorialAction =
  | "move"
  | "look"
  | "jump"
  | "punch"
  | "hit"
  | "heavy"
  | "dash"
  | "block"
  | "knockback"
  | "knockout";
export type GameUiAction = "scoreboard" | "chat";

export class ArenaRenderer {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(76, 1, 0.05, 240);
  private renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  private clock = new THREE.Clock();
  private players = new Map<string, FighterVisual>();
  private snapshots = new Map<string, PlayerSnapshot>();
  private remoteAttacks = new Map<
    string,
    {
      startedAt: number;
      kind: "light" | "heavy";
      side: -1 | 1;
      charge: number;
    }
  >();
  private remoteAttackSides = new Map<string, -1 | 1>();
  private playerId = "";
  private phase: "lobby" | "countdown" | "playing" | "results" = "lobby";
  private spectatorTargetId = "";
  private frame = 0;
  private sequence = 0;
  private yaw = 0;
  private pitch = 0;
  private chargeStart = 0;
  private fists: THREE.Group[] = [];
  private activeFist = 0;
  private punchTime = 0;
  private punchDuration = 0.22;
  private lastLightPunch = 0;
  private lastHeavyPunch = 0;
  private dashEffect = 0;
  private lastDashEffect = Number.NEGATIVE_INFINITY;
  private blockStartedAt = 0;
  private blockExhausted = false;
  private suppressNextPointerPause = false;
  private lastSpeedTrail = 0;
  private lastHudEmit = 0;
  private rules = { ...DEFAULT_MATCH_RULES };
  private impactKick = 0;
  private inputAccumulator = 0;
  private audio: AudioSystem;
  private effects: Array<{
    mesh: THREE.Mesh;
    velocity: THREE.Vector3;
    life: number;
    grow?: number;
    spin?: number;
  }> = [];
  private predictor = new MovementPredictor();
  private input: Input = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    dash: false,
    block: false,
    charging: false,
  };

  constructor(
    private host: HTMLElement,
    private socket: GameSocket,
    private notify: (message: ServerMessage, local?: PlayerSnapshot) => void,
    private settings: GameSettings,
    private onTutorialAction: (action: TutorialAction) => void = () => {},
    private onPause: () => void = () => {},
    private onCombatHud: (state: CombatHudState) => void = () => {},
    private onUiAction: (
      action: GameUiAction,
      active: boolean,
    ) => void = () => {},
  ) {
    this.audio = new AudioSystem(settings.volume);
    this.renderer.setPixelRatio(
      Math.min(
        devicePixelRatio,
        settings.graphics === "low"
          ? 1
          : settings.graphics === "medium"
            ? 1.4
            : 1.8,
      ),
    );
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = settings.graphics === "high";
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);
    this.buildWorld();
    this.bindEvents();
    this.resize();
  }

  private buildWorld(): void {
    this.scene.background = new THREE.Color(0x060914);
    this.scene.fog = new THREE.FogExp2(0x071024, 0.014);
    this.scene.add(new THREE.HemisphereLight(0x8fbcff, 0x111424, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 3.2);
    sun.position.set(8, 18, 7);
    sun.castShadow = this.settings.graphics === "high";
    this.scene.add(sun);
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(30, 1.8, 30),
      new THREE.MeshStandardMaterial({
        color: 0x151b32,
        roughness: 0.55,
        metalness: 0.34,
      }),
    );
    floor.position.y = -0.9;
    floor.receiveShadow = this.settings.graphics === "high";
    this.scene.add(floor);
    const grid = new THREE.GridHelper(30, 30, 0x22e7ff, 0x26304d);
    grid.position.y = 0.02;
    this.scene.add(grid);
    const edgeMat = new THREE.MeshStandardMaterial({
      color: 0x00d9ff,
      emissive: 0x008eb8,
      emissiveIntensity: 3,
    });
    for (const [x, z, sx, sz] of [
      [0, -15, 30, 0.16],
      [0, 15, 30, 0.16],
      [-15, 0, 0.16, 30],
      [15, 0, 0.16, 30],
    ] as number[][]) {
      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(sx!, 0.13, sz!),
        edgeMat,
      );
      edge.position.set(x!, 0.12, z!);
      this.scene.add(edge);
    }
    for (const [x, z, h] of [
      [-9, 0, 3.2],
      [9, 0, 3.2],
      [0, -9, 2.2],
      [0, 9, 2.2],
    ] as number[][]) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(x === 0 ? 7 : 1.2, h!, x === 0 ? 1.2 : 7),
        new THREE.MeshStandardMaterial({
          color: 0x303958,
          metalness: 0.45,
          roughness: 0.35,
          emissive: 0x071126,
        }),
      );
      wall.position.set(x!, h! / 2, z!);
      this.scene.add(wall);
    }
    const under = new THREE.Mesh(
      new THREE.CylinderGeometry(21, 26, 8, 8),
      new THREE.MeshStandardMaterial({
        color: 0x0d1327,
        metalness: 0.8,
        roughness: 0.25,
      }),
    );
    under.position.y = -5;
    this.scene.add(under);
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
    this.scene.add(centerRing);
    for (const [x, z, color] of [
      [-13, -13, 0x3eeaff],
      [13, -13, 0xff3e76],
      [-13, 13, 0xff3e76],
      [13, 13, 0x3eeaff],
    ] as number[][]) {
      const pylon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.3, 3.8, 8),
        new THREE.MeshStandardMaterial({
          color: 0x141a31,
          emissive: color!,
          emissiveIntensity: 0.55,
          metalness: 0.75,
          roughness: 0.3,
        }),
      );
      pylon.position.set(x!, 1.9, z!);
      this.scene.add(pylon);
      if (this.settings.graphics !== "low") {
        const light = new THREE.PointLight(color!, 2.8, 10, 2);
        light.position.set(x!, 3.6, z!);
        this.scene.add(light);
      }
    }
    this.fists = [createFirstPersonGlove(-1), createFirstPersonGlove(1)];
    for (const fist of this.fists) this.camera.add(fist);
    this.scene.add(this.camera);
  }

  onMessage(message: ServerMessage): void {
    if (message.type === "welcome") {
      this.playerId = message.playerId;
      this.sequence = Math.max(this.sequence, message.lastProcessedInput + 1);
    }
    if (message.type === "snapshot") {
      this.phase = message.phase;
      this.rules = message.rules;
      const ids = new Set(message.players.map((p) => p.id));
      for (const [id, visual] of this.players)
        if (!ids.has(id)) {
          this.scene.remove(visual.root);
          disposeObject3D(visual.root);
          this.players.delete(id);
          this.remoteAttacks.delete(id);
          this.remoteAttackSides.delete(id);
        }
      this.snapshots = new Map(
        message.players.map((player) => [player.id, player]),
      );
      for (const player of message.players) {
        if (player.id !== this.playerId && !this.players.has(player.id)) {
          const visual = createRemoteFighter(
            player,
            this.settings.graphics === "high",
          );
          this.scene.add(visual.root);
          this.players.set(player.id, visual);
        } else {
          const visual = this.players.get(player.id);
          if (visual) updateFighterAppearance(visual, player);
        }
      }
      const local = message.players.find((p) => p.id === this.playerId);
      if (local)
        for (const fist of this.fists)
          updateFirstPersonGloveAppearance(fist, local);
      this.notify(message, local);
      this.predictor.setEnabled(message.phase === "playing");
      if (local) this.predictor.reconcile(local);
      if (local && local.knockback > 0) this.onTutorialAction("knockback");
    } else {
      if (message.type === "attack" && message.attackerId !== this.playerId) {
        const previousSide = this.remoteAttackSides.get(message.attackerId);
        const side =
          previousSide === undefined ? 1 : previousSide === 1 ? -1 : 1;
        this.remoteAttackSides.set(message.attackerId, side);
        this.remoteAttacks.set(message.attackerId, {
          startedAt: performance.now(),
          kind: message.kind,
          side,
          charge: message.charge,
        });
      }
      if (message.type === "hit") {
        if (message.attackerId === this.playerId) this.punchTime = 0.12;
        if (message.victimId === this.playerId)
          this.impactKick = message.kind === "heavy" ? 1 : 0.55;
        const victim = this.snapshots.get(message.victimId);
        if (victim) this.spawnImpact(victim.position, message.kind === "heavy");
        this.audio.playHit(message.parried || message.blocked);
      }
      if (message.type === "hit" && message.attackerId === this.playerId)
        this.onTutorialAction("hit");
      if (message.type === "wallHit") {
        this.spawnWallHit(message.position, message.intensity);
        this.audio.playHit(false);
      }
      if (message.type === "knockout") this.audio.playPunch(true);
      if (message.type === "knockout" && message.attackerId === this.playerId)
        this.onTutorialAction("knockout");
      this.notify(message, this.snapshots.get(this.playerId));
    }
  }

  private bindEvents(): void {
    const matches = (code: string, action: keyof GameSettings["bindings"]) =>
      code === this.settings.bindings[action] ||
      (action === "dash" &&
        this.settings.bindings.dash === "ShiftLeft" &&
        code === "ShiftRight");
    const down = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      )
        return;
      if (e.code === "Tab") {
        e.preventDefault();
        this.onUiAction("scoreboard", true);
        return;
      }
      if (e.code === "Enter" && this.phase === "playing") {
        e.preventDefault();
        blur();
        this.suppressNextPointerPause = true;
        if (document.pointerLockElement) document.exitPointerLock();
        this.onUiAction("chat", true);
        return;
      }
      if (e.code === "Escape") {
        blur();
        if (document.pointerLockElement) document.exitPointerLock();
        this.onPause();
        return;
      }
      if (
        (
          ["forward", "back", "left", "right", "jump", "dash", "block"] as const
        ).some((action) => matches(e.code, action))
      )
        e.preventDefault();
      if (matches(e.code, "forward")) this.input.forward = true;
      if (matches(e.code, "back")) this.input.back = true;
      if (matches(e.code, "left")) this.input.left = true;
      if (matches(e.code, "right")) this.input.right = true;
      if (
        ["forward", "back", "left", "right"].some((action) =>
          matches(e.code, action as keyof GameSettings["bindings"]),
        )
      )
        this.onTutorialAction("move");
      if (matches(e.code, "jump")) {
        this.input.jump = true;
        this.onTutorialAction("jump");
      }
      if (matches(e.code, "dash") && this.rules.dashEnabled) {
        this.input.dash = true;
        if (performance.now() - this.lastDashEffect >= GAME.dashCooldownMs) {
          const dashX = Number(this.input.right) - Number(this.input.left);
          const dashZ = Number(this.input.back) - Number(this.input.forward);
          if (dashX || dashZ) {
            this.lastDashEffect = performance.now();
            this.dashEffect = 1;
            this.spawnDashBurst(dashX, dashZ);
            this.audio.playDash();
          }
        }
        this.onTutorialAction("dash");
      }
      if (matches(e.code, "block") && this.rules.blockEnabled) {
        if (this.chargeStart) {
          this.chargeStart = 0;
          this.input.charging = false;
        }
        if (!this.input.block && !this.blockExhausted) {
          this.blockStartedAt = performance.now();
          this.audio.playGuard();
          this.input.block = true;
        }
        this.onTutorialAction("block");
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Tab") {
        e.preventDefault();
        this.onUiAction("scoreboard", false);
        return;
      }
      if (matches(e.code, "forward")) this.input.forward = false;
      if (matches(e.code, "back")) this.input.back = false;
      if (matches(e.code, "left")) this.input.left = false;
      if (matches(e.code, "right")) this.input.right = false;
      if (matches(e.code, "block")) {
        this.input.block = false;
        this.blockExhausted = false;
      }
    };
    const blur = () => {
      this.input = {
        forward: false,
        back: false,
        left: false,
        right: false,
        jump: false,
        dash: false,
        block: false,
        charging: false,
      };
      this.chargeStart = 0;
      this.blockExhausted = false;
    };
    const move = (e: MouseEvent) => {
      if (document.pointerLockElement !== this.renderer.domElement) return;
      this.yaw -= e.movementX * 0.0021 * this.settings.sensitivity;
      this.pitch = Math.max(
        -1.2,
        Math.min(
          1.2,
          this.pitch - e.movementY * 0.0018 * this.settings.sensitivity,
        ),
      );
      if (e.movementX || e.movementY) this.onTutorialAction("look");
    };
    const mouseDown = (e: MouseEvent) => {
      if (document.pointerLockElement !== this.renderer.domElement) {
        if (e.target === this.renderer.domElement)
          void this.renderer.domElement.requestPointerLock();
        return;
      }
      if (e.button === 0 && !this.input.block && !this.chargeStart)
        this.attack("light", 0);
      if (e.button === 2 && this.rules.heavyEnabled && !this.input.block) {
        const now = performance.now();
        if (
          this.lastHeavyPunch === 0 ||
          now - this.lastHeavyPunch >= GAME.heavyCooldownMs
        ) {
          this.activeFist = 1 - this.activeFist;
          this.chargeStart = now;
          this.input.charging = true;
        }
      }
    };
    const mouseUp = (e: MouseEvent) => {
      if (e.button === 2 && this.chargeStart) {
        this.attack(
          "heavy",
          Math.min(
            1,
            (performance.now() - this.chargeStart) / GAME.heavyChargeMs,
          ),
        );
        this.chargeStart = 0;
        this.input.charging = false;
      }
    };
    const resize = () => this.resize();
    const contextMenu = (e: MouseEvent) => {
      if (e.target === this.renderer.domElement) e.preventDefault();
    };
    let hadPointerLock = false;
    const pointerLockChange = () => {
      if (document.pointerLockElement === this.renderer.domElement)
        hadPointerLock = true;
      else if (hadPointerLock) {
        hadPointerLock = false;
        blur();
        if (this.suppressNextPointerPause)
          this.suppressNextPointerPause = false;
        else this.onPause();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    window.addEventListener("mousemove", move);
    window.addEventListener("mousedown", mouseDown);
    window.addEventListener("mouseup", mouseUp);
    window.addEventListener("resize", resize);
    window.addEventListener("contextmenu", contextMenu);
    document.addEventListener("pointerlockchange", pointerLockChange);
    this.cleanup = () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mousedown", mouseDown);
      window.removeEventListener("mouseup", mouseUp);
      window.removeEventListener("resize", resize);
      window.removeEventListener("contextmenu", contextMenu);
      document.removeEventListener("pointerlockchange", pointerLockChange);
    };
  }
  private cleanup = () => {};
  private attack(kind: "light" | "heavy", charge: number): void {
    if (kind === "heavy" && !this.rules.heavyEnabled) return;
    const now = performance.now();
    if (
      (kind === "light" &&
        this.lastLightPunch > 0 &&
        now - this.lastLightPunch < GAME.punchCooldownMs) ||
      (kind === "heavy" &&
        this.lastHeavyPunch > 0 &&
        now - this.lastHeavyPunch < GAME.heavyCooldownMs)
    )
      return;
    if (kind === "light") this.lastLightPunch = now;
    else this.lastHeavyPunch = now;
    if (kind === "light") this.activeFist = 1 - this.activeFist;
    this.punchDuration = kind === "heavy" ? 0.32 : 0.22;
    this.punchTime = this.punchDuration;
    this.onTutorialAction(kind === "heavy" ? "heavy" : "punch");
    this.audio.playPunch(kind === "heavy");
    this.socket.send({
      type: "attack",
      kind,
      charge,
      yaw: this.yaw,
      clientTime: Date.now(),
    });
  }
  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.host;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }
  private spawnDashBurst(moveX: number, moveZ: number): void {
    if (this.settings.graphics === "low") return;
    const sin = Math.sin(this.yaw),
      cos = Math.cos(this.yaw);
    const direction = new THREE.Vector3(
      moveX * cos + moveZ * sin,
      0,
      -moveX * sin + moveZ * cos,
    ).normalize();
    const origin = this.predictor.position;
    const count = this.settings.graphics === "high" ? 10 : 6;
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.025, 0.025, 0.55 + Math.random() * 0.45),
        new THREE.MeshBasicMaterial({
          color: i % 3 === 0 ? 0xff4778 : 0x68edff,
          transparent: true,
          opacity: 0.75,
          depthWrite: false,
        }),
      );
      mesh.position.set(
        origin.x + (Math.random() - 0.5) * 1.2,
        origin.y + 0.2 + Math.random() * 1.25,
        origin.z + (Math.random() - 0.5) * 1.2,
      );
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
      this.scene.add(mesh);
      this.effects.push({
        mesh,
        velocity: direction
          .clone()
          .multiplyScalar(-2.4 - Math.random() * 2)
          .add(new THREE.Vector3(0, (Math.random() - 0.5) * 0.5, 0)),
        life: 0.22 + Math.random() * 0.16,
      });
    }
  }
  private spawnSpeedTrail(player: PlayerSnapshot): void {
    if (this.settings.graphics === "low") return;
    const velocity = new THREE.Vector3(
      player.velocity.x,
      player.velocity.y * 0.25,
      player.velocity.z,
    );
    if (velocity.lengthSq() < 1) return;
    const direction = velocity.normalize();
    const count = this.settings.graphics === "high" ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 0.02, 0.65 + Math.random() * 0.5),
        new THREE.MeshBasicMaterial({
          color: i === 0 ? 0xffffff : 0x68edff,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
        }),
      );
      mesh.position.set(
        player.position.x + (Math.random() - 0.5) * 0.9,
        player.position.y + (Math.random() - 0.5) * 1.1,
        player.position.z + (Math.random() - 0.5) * 0.9,
      );
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
      this.scene.add(mesh);
      this.effects.push({
        mesh,
        velocity: direction.clone().multiplyScalar(-2.2),
        life: 0.18 + Math.random() * 0.1,
      });
    }
  }
  private spawnWallHit(
    position: { x: number; y: number; z: number },
    intensity: number,
  ): void {
    const count = Math.min(14, 6 + Math.floor(intensity / 2));
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.045 + Math.random() * 0.055, 0),
        new THREE.MeshBasicMaterial({
          color: i % 3 === 0 ? 0xff4778 : 0x68edff,
          transparent: true,
        }),
      );
      mesh.position.set(position.x, position.y + 0.7, position.z);
      this.scene.add(mesh);
      this.effects.push({
        mesh,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 5,
          1.5 + Math.random() * 4,
          (Math.random() - 0.5) * 5,
        ),
        life: 0.45 + Math.random() * 0.25,
      });
    }
  }
  private spawnImpact(
    position: { x: number; y: number; z: number },
    heavy: boolean,
  ): void {
    const count =
      this.settings.graphics === "low"
        ? 3
        : this.settings.graphics === "medium"
          ? 7
          : heavy
            ? 14
            : 9;
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(heavy ? 0.065 : 0.04, 0),
        new THREE.MeshBasicMaterial({
          color: i % 2 ? 0xffffff : 0xff4778,
          transparent: true,
        }),
      );
      mesh.position.set(position.x, position.y + 0.7, position.z);
      this.scene.add(mesh);
      this.effects.push({
        mesh,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 4,
          1 + Math.random() * 3,
          (Math.random() - 0.5) * 4,
        ),
        life: 0.28 + Math.random() * 0.18,
      });
    }
    if (heavy && this.settings.graphics !== "low") {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.22, 0.025, 8, 30),
        new THREE.MeshBasicMaterial({
          color: 0x8ff5ff,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
        }),
      );
      ring.position.set(position.x, position.y + 0.8, position.z);
      ring.rotation.x = Math.PI / 2;
      this.scene.add(ring);
      this.effects.push({
        mesh: ring,
        velocity: new THREE.Vector3(),
        life: 0.32,
        grow: 4.8,
        spin: 3,
      });
    }
  }
  start(): void {
    this.clock.start();
    this.frame = requestAnimationFrame(this.loop);
  }
  capturePointer(): void {
    void this.renderer.domElement.requestPointerLock();
  }
  setSpectatorTarget(playerId: string): void {
    this.spectatorTargetId = playerId;
  }
  private loop = () => {
    const dt = Math.min(0.05, this.clock.getDelta());
    const local = this.snapshots.get(this.playerId);
    const moveX = Number(this.input.right) - Number(this.input.left),
      moveZ = Number(this.input.back) - Number(this.input.forward);
    const spectating = !!local?.eliminated && this.phase === "playing";
    const hudNow = performance.now();
    if (
      this.input.block &&
      hudNow - this.blockStartedAt >= GAME.blockMaxHoldMs
    ) {
      this.input.block = false;
      this.blockExhausted = true;
    }
    const flightSpeed = local
      ? Math.hypot(local.velocity.x, local.velocity.y, local.velocity.z)
      : 0;
    if (
      local &&
      !local.grounded &&
      flightSpeed > 12 &&
      hudNow - this.lastSpeedTrail >= 75
    ) {
      this.lastSpeedTrail = hudNow;
      this.spawnSpeedTrail(local);
    }
    if (hudNow - this.lastHudEmit >= 50) {
      this.lastHudEmit = hudNow;
      this.onCombatHud({
        dashReady: cooldownReadiness(
          this.lastDashEffect,
          GAME.dashCooldownMs,
          hudNow,
        ),
        lightReady: cooldownReadiness(
          this.lastLightPunch,
          GAME.punchCooldownMs,
          hudNow,
        ),
        heavyReady: cooldownReadiness(
          this.lastHeavyPunch,
          GAME.heavyCooldownMs,
          hudNow,
        ),
        heavyCharge: this.chargeStart
          ? Math.min(1, (hudNow - this.chargeStart) / GAME.heavyChargeMs)
          : 0,
        blocking: this.input.block,
        parryActive: this.input.block && hudNow - this.blockStartedAt < 190,
        validTarget:
          !!local &&
          !spectating &&
          [...this.snapshots.values()].some((target) =>
            isPunchTargetValid(
              local,
              target,
              this.yaw,
              this.rules.gameMode !== "team" || this.rules.friendlyFire,
            ),
          ),
        dashEnabled: this.rules.dashEnabled,
        heavyEnabled: this.rules.heavyEnabled,
        blockEnabled: this.rules.blockEnabled,
      });
    }
    if (!spectating) this.predictor.update(dt, moveX, moveZ, this.yaw);
    if (spectating) {
      const watched =
        this.snapshots.get(this.spectatorTargetId) ??
        [...this.snapshots.values()].find(
          (player) =>
            player.id !== this.playerId && !player.bot && !player.eliminated,
        );
      if (watched) {
        const behind = new THREE.Vector3(
          Math.sin(watched.yaw) * 4.4,
          2.8,
          Math.cos(watched.yaw) * 4.4,
        );
        this.camera.position.lerp(
          new THREE.Vector3(
            watched.position.x,
            watched.position.y,
            watched.position.z,
          ).add(behind),
          Math.min(1, dt * 7),
        );
        this.camera.lookAt(
          watched.position.x,
          watched.position.y + 0.75,
          watched.position.z,
        );
      }
    } else if (local) {
      const movementAmount = Math.min(1, Math.hypot(moveX, moveZ));
      const headBob =
        local.grounded && !this.settings.reducedMotion
          ? Math.sin(hudNow * 0.012) * 0.014 * movementAmount
          : 0;
      this.camera.position.lerp(
        new THREE.Vector3(
          this.predictor.position.x,
          this.predictor.position.y + 0.72 + headBob,
          this.predictor.position.z,
        ),
        1 - Math.exp(-dt * 22),
      );
      const kick =
        this.impactKick * (this.settings.reducedMotion ? 0.006 : 0.022);
      this.camera.rotation.set(
        this.pitch + kick,
        this.yaw + kick * 0.45,
        -kick * 0.6,
        "YXZ",
      );
    }
    for (const [id, visual] of this.players) {
      const p = this.snapshots.get(id);
      if (!p) continue;
      const root = visual.root;
      root.position.lerp(
        new THREE.Vector3(p.position.x, p.position.y - 1.1, p.position.z),
        1 -
          Math.exp(
            -dt * (Math.hypot(p.velocity.x, p.velocity.z) > 12 ? 18 : 12),
          ),
      );
      const turnDelta = Math.atan2(
        Math.sin(p.yaw - root.rotation.y),
        Math.cos(p.yaw - root.rotation.y),
      );
      root.rotation.y += turnDelta * (1 - Math.exp(-dt * 16));
      visual.ring.visible = p.protected;
      visual.guard.visible = p.blocking;
      visual.guard.scale.setScalar(1 + Math.sin(hudNow / 70) * 0.035);
      visual.guard.material.opacity = 0.5 + Math.sin(hudNow / 85) * 0.14;

      const attack = this.remoteAttacks.get(id);
      const duration =
        attack?.kind === "heavy" ? 360 + attack.charge * 120 : 250;
      const attackAge = attack ? hudNow - attack.startedAt : duration;
      if (attack && attackAge >= duration) this.remoteAttacks.delete(id);
      const attackPhase =
        attack && attackAge < duration
          ? Math.sin((attackAge / duration) * Math.PI)
          : 0;
      const previousSide = this.remoteAttackSides.get(id);
      const chargingSide: -1 | 1 =
        previousSide === undefined ? 1 : previousSide === 1 ? -1 : 1;
      for (const [side, glove] of [
        [-1, visual.leftGlove],
        [1, visual.rightGlove],
      ] as const) {
        const isAttacking = attack?.side === side && attackPhase > 0;
        const isCharging =
          !attack && p.charging && chargingSide === side && !p.blocking;
        const reach =
          attack?.kind === "heavy" ? 0.72 + attack.charge * 0.28 : 0.62;
        const target = new THREE.Vector3(
          side * (p.blocking ? 0.36 : 0.48) +
            (isAttacking ? side * attackPhase * 0.08 : 0),
          p.blocking ? 1.63 : isCharging ? 1.06 : 1.2,
          p.blocking ? -0.45 : isCharging ? 0.18 : -0.15,
        );
        if (isAttacking) {
          target.y += attackPhase * 0.08;
          target.z -= attackPhase * reach;
        }
        glove.position.lerp(target, Math.min(1, dt * 16));
        const targetRotationX = p.blocking
          ? -0.62
          : isCharging
            ? -0.48
            : isAttacking
              ? -attackPhase * 0.38
              : 0;
        const targetRotationZ = p.blocking
          ? side * 0.38
          : isCharging
            ? side * -0.26
            : 0;
        glove.rotation.x +=
          (targetRotationX - glove.rotation.x) * Math.min(1, dt * 18);
        glove.rotation.z +=
          (targetRotationZ - glove.rotation.z) * Math.min(1, dt * 18);
      }
      poseFighterArms(visual);

      const stride = Math.min(1, Math.hypot(p.velocity.x, p.velocity.z) / 7);
      if (stride > 0.025) visual.walkPhase += dt * (5 + stride * 9);
      const swing = Math.sin(visual.walkPhase) * 0.48 * stride;
      visual.leftLeg.rotation.x +=
        (swing - visual.leftLeg.rotation.x) * Math.min(1, dt * 14);
      visual.rightLeg.rotation.x +=
        (-swing - visual.rightLeg.rotation.x) * Math.min(1, dt * 14);
    }
    this.punchTime = Math.max(0, this.punchTime - dt);
    const phase =
      this.punchTime > 0
        ? Math.sin((this.punchTime / this.punchDuration) * Math.PI)
        : 0;
    const chargeAmount = this.chargeStart
      ? Math.min(1, (hudNow - this.chargeStart) / GAME.heavyChargeMs)
      : 0;
    const movementAmount = Math.min(1, Math.hypot(moveX, moveZ));
    const handSway = this.settings.reducedMotion
      ? 0
      : Math.sin(hudNow * 0.009) * 0.025 * movementAmount;
    const handBob = this.settings.reducedMotion
      ? 0
      : Math.abs(Math.cos(hudNow * 0.009)) * 0.018 * movementAmount;
    for (let i = 0; i < this.fists.length; i++) {
      const fist = this.fists[i]!,
        side = fist.userData.side as number;
      fist.visible = !spectating;
      const active = i === this.activeFist;
      const target = this.input.block
        ? new THREE.Vector3(side * 0.25, -0.16, -0.62)
        : chargeAmount > 0 && active
          ? new THREE.Vector3(
              side * (0.62 + chargeAmount * 0.16),
              -0.52 - chargeAmount * 0.12,
              -0.9 + chargeAmount * 0.36,
            )
          : new THREE.Vector3(
              side * (0.55 + (active ? phase * 0.08 : 0)),
              -0.5 + handBob,
              -1.15 - (active ? phase * 0.8 : 0),
            );
      if (!this.input.block && chargeAmount === 0) target.x += handSway;
      fist.position.lerp(target, Math.min(1, dt * 26));
      fist.rotation.x +=
        ((this.input.block
          ? -0.72
          : chargeAmount > 0 && active
            ? -0.35 - chargeAmount * 0.75
            : 0) -
          fist.rotation.x) *
        Math.min(1, dt * 20);
      fist.rotation.z +=
        ((this.input.block
          ? side * 0.42
          : chargeAmount > 0 && active
            ? side * -0.3 * chargeAmount
            : 0) -
          fist.rotation.z) *
        Math.min(1, dt * 20);
    }
    this.dashEffect = Math.max(0, this.dashEffect - dt * 4.5);
    const flightFov = Math.min(6, Math.max(0, flightSpeed - 10) * 0.32);
    const targetFov =
      76 +
      this.dashEffect * 9 +
      flightFov * (this.settings.reducedMotion ? 0.2 : 1);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 20);
      this.camera.updateProjectionMatrix();
    }
    this.impactKick = Math.max(0, this.impactKick - dt * 7.5);
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i]!;
      effect.life -= dt;
      effect.velocity.y -= 9 * dt;
      effect.mesh.position.addScaledVector(effect.velocity, dt);
      if (effect.grow)
        effect.mesh.scale.addScalar(Math.max(0, effect.grow * dt));
      if (effect.spin) effect.mesh.rotation.z += effect.spin * dt;
      (effect.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(
        0,
        effect.life * 2,
      );
      if (effect.life <= 0) {
        this.scene.remove(effect.mesh);
        effect.mesh.geometry.dispose();
        (effect.mesh.material as THREE.Material).dispose();
        this.effects.splice(i, 1);
      }
    }
    this.inputAccumulator += dt;
    if (this.inputAccumulator >= 1 / 30) {
      this.inputAccumulator %= 1 / 30;
      const sequence = this.sequence++;
      this.predictor.recordInput(sequence);
      if (this.input.dash) this.predictor.triggerDash(moveX, moveZ, this.yaw);
      this.socket.send({
        type: "input",
        sequence,
        moveX: spectating ? 0 : moveX,
        moveZ: spectating ? 0 : moveZ,
        yaw: this.yaw,
        jump: spectating ? false : this.input.jump,
        dash: spectating ? false : this.input.dash,
        blocking: spectating ? false : this.input.block,
        charging: spectating ? false : this.input.charging,
      });
      this.input.jump = false;
      this.input.dash = false;
    }
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.loop);
  };
  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.cleanup();
    this.audio.dispose();
    for (const effect of this.effects) {
      this.scene.remove(effect.mesh);
      effect.mesh.geometry.dispose();
      (effect.mesh.material as THREE.Material).dispose();
    }
    this.effects = [];
    disposeObject3D(this.scene);
    this.scene.clear();
    this.players.clear();
    this.snapshots.clear();
    this.remoteAttacks.clear();
    this.remoteAttackSides.clear();
    this.fists = [];
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.host)
      this.host.removeChild(this.renderer.domElement);
  }
}
