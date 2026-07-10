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

type Input = {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  dash: boolean;
  block: boolean;
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
  private players = new Map<string, THREE.Group>();
  private snapshots = new Map<string, PlayerSnapshot>();
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
  private suppressNextPointerPause = false;
  private lastHudEmit = 0;
  private rules = { ...DEFAULT_MATCH_RULES };
  private impactKick = 0;
  private inputAccumulator = 0;
  private audio: AudioSystem;
  private effects: Array<{
    mesh: THREE.Mesh;
    velocity: THREE.Vector3;
    life: number;
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
    this.fists = [this.makeFist(-1), this.makeFist(1)];
    for (const fist of this.fists) this.camera.add(fist);
    this.scene.add(this.camera);
  }

  private makeFist(side: -1 | 1): THREE.Group {
    const group = new THREE.Group();
    const glove = new THREE.MeshStandardMaterial({
      color: 0xff3e76,
      roughness: 0.28,
      metalness: 0.2,
      emissive: 0x31000e,
    });
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.21, 16, 12), glove);
    hand.scale.set(1.12, 0.88, 1.3);
    group.add(hand);
    const cuff = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.19, 0.31, 12),
      new THREE.MeshStandardMaterial({ color: 0x191e36, metalness: 0.6 }),
    );
    cuff.rotation.x = Math.PI / 2;
    cuff.position.z = 0.27;
    group.add(cuff);
    const knuckle = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.09, 0.15),
      new THREE.MeshStandardMaterial({
        color: 0xff7a9d,
        roughness: 0.3,
        emissive: 0x250008,
      }),
    );
    knuckle.position.set(0, 0.1, -0.1);
    group.add(knuckle);
    group.position.set(side * 0.55, -0.5, -1.15);
    group.userData.side = side;
    return group;
  }

  private makePlayer(player: PlayerSnapshot): THREE.Group {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: player.bot
        ? 0xffbd2e
        : player.team === "red"
          ? 0xff3e62
          : player.team === "blue"
            ? 0x379dff
            : 0x6d5cff,
      roughness: 0.42,
      metalness: 0.16,
      emissive: player.bot
        ? 0x301900
        : player.team === "red"
          ? 0x3b0611
          : player.team === "blue"
            ? 0x061d3b
            : 0x10083a,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x171b30,
      roughness: 0.5,
    });
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.52, 0.85, 6, 12),
      bodyMat,
    );
    body.position.y = 0.95;
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.41, 16, 12), dark);
    head.position.y = 1.95;
    group.add(head);
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.12, 0.08),
      new THREE.MeshStandardMaterial({
        color: 0x72edff,
        emissive: 0x1ba7c4,
        emissiveIntensity: 2.5,
        metalness: 0.35,
      }),
    );
    visor.position.set(0, 1.98, -0.36);
    group.add(visor);
    const chest = new THREE.Mesh(
      new THREE.BoxGeometry(0.72, 0.24, 0.08),
      new THREE.MeshStandardMaterial({
        color: 0xf3f6ff,
        emissive: player.bot ? 0x6b3d00 : 0x1c175d,
        emissiveIntensity: 0.9,
        metalness: 0.45,
      }),
    );
    chest.position.set(0, 1.22, -0.49);
    group.add(chest);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.14, 0.42, 4, 8),
        dark,
      );
      arm.rotation.z = side * -0.28;
      arm.position.set(side * 0.58, 1.18, 0);
      group.add(arm);
      const glove = new THREE.Mesh(
        new THREE.SphereGeometry(0.27, 12, 9),
        bodyMat,
      );
      glove.position.set(side * 0.7, 1.2, -0.15);
      glove.name = side < 0 ? "glove-left" : "glove-right";
      group.add(glove);
      const leg = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.17, 0.4, 4, 8),
        dark,
      );
      leg.position.set(side * 0.24, 0.28, 0);
      group.add(leg);
    }
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.67, 0.035, 8, 28),
      new THREE.MeshBasicMaterial({
        color: player.protected ? 0x55f7ff : 0xff416c,
        transparent: true,
        opacity: 0.8,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.08;
    ring.name = "ring";
    group.add(ring);
    if (this.settings.graphics === "high")
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) object.castShadow = true;
      });
    return group;
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
      for (const [id, mesh] of this.players)
        if (!ids.has(id)) {
          this.scene.remove(mesh);
          this.players.delete(id);
        }
      for (const player of message.players) {
        this.snapshots.set(player.id, player);
        if (player.id !== this.playerId && !this.players.has(player.id)) {
          const mesh = this.makePlayer(player);
          this.scene.add(mesh);
          this.players.set(player.id, mesh);
        }
      }
      const local = message.players.find((p) => p.id === this.playerId);
      this.notify(message, local);
      this.predictor.setEnabled(message.phase === "playing");
      if (local) this.predictor.reconcile(local);
      if (local && local.knockback > 0) this.onTutorialAction("knockback");
    } else {
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
          this.lastDashEffect = performance.now();
          this.dashEffect = 1;
        }
        this.onTutorialAction("dash");
      }
      if (matches(e.code, "block") && this.rules.blockEnabled) {
        if (!this.input.block) this.blockStartedAt = performance.now();
        this.input.block = true;
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
      if (matches(e.code, "block")) this.input.block = false;
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
      };
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
      if (e.button === 0) this.attack("light", 0);
      if (e.button === 2 && this.rules.heavyEnabled)
        this.chargeStart = performance.now();
    };
    const mouseUp = (e: MouseEvent) => {
      if (e.button === 2 && this.chargeStart) {
        this.attack(
          "heavy",
          Math.min(1, (performance.now() - this.chargeStart) / 1100),
        );
        this.chargeStart = 0;
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
    this.activeFist = 1 - this.activeFist;
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
          ? Math.min(1, (hudNow - this.chargeStart) / 1100)
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
      this.camera.position.lerp(
        new THREE.Vector3(
          this.predictor.position.x,
          this.predictor.position.y + 0.72,
          this.predictor.position.z,
        ),
        Math.min(1, dt * 22),
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
    for (const [id, mesh] of this.players) {
      const p = this.snapshots.get(id);
      if (!p) continue;
      mesh.position.lerp(
        new THREE.Vector3(p.position.x, p.position.y - 1.1, p.position.z),
        Math.min(1, dt * 12),
      );
      mesh.rotation.y = p.yaw;
      const ring = mesh.getObjectByName("ring") as THREE.Mesh | undefined;
      if (ring) ring.visible = p.protected;
      const left = mesh.getObjectByName("glove-left"),
        right = mesh.getObjectByName("glove-right");
      if (left && right) {
        const targetY = p.blocking ? 1.65 : 1.2,
          targetZ = p.blocking ? -0.48 : -0.15;
        left.position.lerp(
          new THREE.Vector3(-0.48, targetY, targetZ),
          Math.min(1, dt * 15),
        );
        right.position.lerp(
          new THREE.Vector3(0.48, targetY, targetZ),
          Math.min(1, dt * 15),
        );
      }
    }
    this.punchTime = Math.max(0, this.punchTime - dt);
    const phase =
      this.punchTime > 0
        ? Math.sin((this.punchTime / this.punchDuration) * Math.PI)
        : 0;
    for (let i = 0; i < this.fists.length; i++) {
      const fist = this.fists[i]!,
        side = fist.userData.side as number;
      fist.visible = !spectating;
      const active = i === this.activeFist;
      const target = this.input.block
        ? new THREE.Vector3(side * 0.25, -0.16, -0.62)
        : new THREE.Vector3(
            side * (0.55 + (active ? phase * 0.08 : 0)),
            -0.5,
            -1.15 - (active ? phase * 0.8 : 0),
          );
      fist.position.lerp(target, Math.min(1, dt * 26));
      fist.rotation.x +=
        ((this.input.block ? -0.45 : this.chargeStart && active ? -0.55 : 0) -
          fist.rotation.x) *
        Math.min(1, dt * 20);
      fist.rotation.z +=
        ((this.input.block ? side * 0.26 : 0) - fist.rotation.z) *
        Math.min(1, dt * 20);
    }
    this.dashEffect = Math.max(0, this.dashEffect - dt * 4.5);
    const targetFov = 76 + this.dashEffect * 9;
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
    this.renderer.dispose();
    this.host.removeChild(this.renderer.domElement);
  }
}
