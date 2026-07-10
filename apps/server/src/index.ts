import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import {
  DEFAULT_MATCH_RULES,
  GAME,
  PROTOCOL_VERSION,
  isValidLobbyCode,
  normalizeLobbyCode,
  type ClientMessage,
  type MatchMode,
  type MatchPhase,
  type MatchRules,
  type ServerMessage,
  type TrainingBotMode,
} from "@knockout/shared";
import {
  botNavigationTarget,
  consumeHeavyCharge,
  createPlayer,
  creditKnockout,
  performAttack,
  respawn,
  stepPlayer,
  type SimPlayer,
} from "./simulation.js";
import { parseClientMessage } from "./protocol.js";

type Client = {
  socket: WebSocket;
  player?: SimPlayer;
  room?: Room;
  reconnectToken?: string;
};
type Room = {
  code: string;
  players: Map<string, SimPlayer>;
  clients: Set<Client>;
  phase: MatchPhase;
  phaseEndsAt: number;
  matchId: string;
  matchStartedAt: number;
  mode: MatchMode;
  trainingBotMode: TrainingBotMode;
  rules: MatchRules;
  hostId?: string;
};
type ReconnectRecord = { room: Room; player: SimPlayer; expiresAt: number };
const rooms = new Map<string, Room>();
const reconnects = new Map<string, ReconnectRecord>();
const port = Number(process.env.PORT ?? 2567);
const clientDist = resolve(
  process.env.CLIENT_DIST ??
    fileURLToPath(new URL("../../client/dist", import.meta.url)),
);
const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify(message));
}
function broadcast(room: Room, message: ServerMessage): void {
  for (const c of room.clients) send(c.socket, message);
}
function roomFor(code: string): Room {
  const clean = normalizeLobbyCode(code) || "QUICK";
  let room = rooms.get(clean);
  if (!room) {
    room = {
      code: clean,
      players: new Map(),
      clients: new Set(),
      phase: "lobby",
      phaseEndsAt: 0,
      matchId: randomUUID(),
      matchStartedAt: 0,
      mode: "private",
      trainingBotMode: "aggressive",
      rules: { ...DEFAULT_MATCH_RULES },
    };
    rooms.set(clean, room);
    console.log(JSON.stringify({ event: "room_created", code: clean }));
  }
  return room;
}

function quickRoom(): Room {
  const available = [...rooms.values()].find(
    (room) =>
      room.mode === "quick" &&
      (room.phase === "lobby" || room.phase === "countdown") &&
      [...room.players.values()].filter((player) => !player.bot).length < 8,
  );
  if (available) return available;
  let code: string;
  do {
    code = `Q${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  } while (rooms.has(code));
  const room = roomFor(code);
  room.mode = "quick";
  return room;
}

const http = createServer(async (req, res) => {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=()",
  );
  if (req.url === "/health") {
    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(
      JSON.stringify({
        status: "ok",
        rooms: rooms.size,
        players: [...rooms.values()].reduce((n, r) => n + r.players.size, 0),
      }),
    );
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" });
    res.end();
    return;
  }
  try {
    const pathname = decodeURIComponent(
      new URL(req.url ?? "/", "http://game.invalid").pathname,
    );
    const requested =
      pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const candidate = resolve(clientDist, requested);
    const insideDist =
      candidate === clientDist ||
      candidate.startsWith(`${clientDist}\\`) ||
      candidate.startsWith(`${clientDist}/`);
    const file =
      insideDist && existsSync(candidate)
        ? candidate
        : resolve(clientDist, "index.html");
    if (!existsSync(file)) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "client_not_built" }));
      return;
    }
    const body = await readFile(file);
    const immutable = file.startsWith(resolve(clientDist, "assets"));
    res.writeHead(200, {
      "content-type":
        contentTypes[extname(file).toLowerCase()] ?? "application/octet-stream",
      "cache-control": immutable
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(400);
    res.end();
  }
});
const wss = new WebSocketServer({
  server: http,
  path: "/ws",
  maxPayload: 16 * 1024,
});
const liveSockets = new WeakSet<WebSocket>();
wss.on("connection", (socket) => {
  liveSockets.add(socket);
  socket.on("pong", () => liveSockets.add(socket));
});
const heartbeatTimer = setInterval(() => {
  for (const socket of wss.clients) {
    if (!liveSockets.has(socket)) {
      socket.terminate();
      continue;
    }
    liveSockets.delete(socket);
    socket.ping();
  }
}, 25_000);
heartbeatTimer.unref();

wss.on("connection", (socket) => {
  const client: Client = { socket };
  socket.on("message", (raw) => {
    const msg: ClientMessage | undefined = parseClientMessage(raw.toString());
    if (!msg) return;
    if (msg.type === "join" && !client.player) {
      if (msg.protocolVersion !== PROTOCOL_VERSION) {
        send(socket, {
          type: "joinError",
          code: "VERSION_MISMATCH",
          message: "Spielversion veraltet. Bitte die Seite neu laden.",
        });
        return;
      }
      const reconnect = msg.reconnectToken
        ? reconnects.get(msg.reconnectToken)
        : undefined;
      let room: Room;
      if (reconnect && reconnect.expiresAt > Date.now()) room = reconnect.room;
      else if (msg.mode === "quick") room = quickRoom();
      else {
        const code = normalizeLobbyCode(msg.roomCode);
        if (!isValidLobbyCode(code)) {
          send(socket, {
            type: "joinError",
            code: "INVALID_CODE",
            message:
              "Der Lobbycode muss aus 4 bis 6 Buchstaben oder Zahlen bestehen.",
          });
          return;
        }
        const existing = rooms.get(code);
        if (msg.mode === "private" && !msg.createRoom && !existing) {
          send(socket, {
            type: "joinError",
            code: "ROOM_NOT_FOUND",
            message:
              "Diese Lobby wurde nicht gefunden. Prüfe den Code und versuche es erneut.",
          });
          return;
        }
        room = existing ?? roomFor(code);
      }
      if (
        reconnect &&
        reconnect.expiresAt > Date.now() &&
        reconnect.room.code === room.code
      ) {
        reconnects.delete(msg.reconnectToken!);
        reconnect.room.clients.add(client);
        client.player = reconnect.player;
        client.room = reconnect.room;
        client.reconnectToken = msg.reconnectToken;
        send(socket, {
          type: "welcome",
          playerId: reconnect.player.id,
          roomCode: reconnect.room.code,
          reconnectToken: msg.reconnectToken!,
          lastProcessedInput: reconnect.player.lastProcessedInput,
        });
        broadcast(reconnect.room, {
          type: "notice",
          text: `${reconnect.player.name} ist wieder verbunden`,
        });
        console.log(
          JSON.stringify({
            event: "player_reconnected",
            room: reconnect.room.code,
            playerId: reconnect.player.id,
          }),
        );
        return;
      }
      const humanCount = [...room.players.values()].filter(
        (candidate) => !candidate.bot,
      ).length;
      if (humanCount >= 8) {
        send(socket, {
          type: "joinError",
          code: "ROOM_FULL",
          message: "Diese Arena ist bereits voll.",
        });
        return;
      }
      if (msg.mode === "private" && room.phase !== "lobby") {
        send(socket, {
          type: "joinError",
          code: "MATCH_STARTED",
          message: "Dieses Match läuft bereits.",
        });
        return;
      }
      const id = randomUUID().slice(0, 8);
      const reconnectToken = randomUUID();
      const player = createPlayer(
        id,
        msg.name.trim().slice(0, 18) || "Rookie",
        room.players.size,
      );
      if (msg.mode === "private") {
        const humanIndex = [...room.players.values()].filter(
          (candidate) => !candidate.bot,
        ).length;
        player.team = humanIndex % 2 === 0 ? "red" : "blue";
      }
      if (room.players.size === 0) room.mode = msg.mode;
      if (!room.hostId && !player.bot) {
        room.hostId = id;
        player.host = true;
      }
      room.players.set(id, player);
      room.clients.add(client);
      client.player = player;
      client.room = room;
      client.reconnectToken = reconnectToken;
      if (msg.mode === "training" && !room.players.has("coach-bot"))
        room.players.set(
          "coach-bot",
          createPlayer("coach-bot", "SPARR-BOT", 1, true),
        );
      if (msg.mode === "training" && room.phase !== "playing") {
        room.phase = "playing";
        room.matchId = randomUUID();
        room.matchStartedAt = Date.now();
        room.phaseEndsAt = Date.now() + room.rules.matchDurationSeconds * 1_000;
      }
      if (msg.mode === "quick") {
        const humans = [...room.players.values()].filter(
          (candidate) => !candidate.bot,
        );
        if (humans.length >= 2 && room.phase === "lobby") {
          room.phase = "countdown";
          room.phaseEndsAt = Date.now() + 3_500;
          broadcast(room, { type: "notice", text: "GEGNER GEFUNDEN" });
        }
      }
      send(socket, {
        type: "welcome",
        playerId: id,
        roomCode: room.code,
        reconnectToken,
        lastProcessedInput: player.lastProcessedInput,
      });
      broadcast(room, {
        type: "notice",
        text: `${player.name} betritt die Arena`,
      });
      return;
    }
    const player = client.player,
      room = client.room;
    if (!player || !room) return;
    if (msg.type === "updateRules") {
      if (
        room.mode !== "private" ||
        room.phase !== "lobby" ||
        !player.host ||
        !msg.patch ||
        typeof msg.patch !== "object"
      )
        return;
      const patch = msg.patch;
      room.rules = {
        gameMode:
          patch.gameMode === "stock" || patch.gameMode === "team"
            ? patch.gameMode
            : room.rules.gameMode,
        matchDurationSeconds: Number.isFinite(patch.matchDurationSeconds)
          ? Math.max(60, Math.min(420, Math.round(patch.matchDurationSeconds!)))
          : room.rules.matchDurationSeconds,
        stocks: Number.isFinite(patch.stocks)
          ? Math.max(1, Math.min(9, Math.round(patch.stocks!)))
          : room.rules.stocks,
        knockbackMultiplier: Number.isFinite(patch.knockbackMultiplier)
          ? Math.max(
              0.5,
              Math.min(2, Math.round(patch.knockbackMultiplier! * 4) / 4),
            )
          : room.rules.knockbackMultiplier,
        heavyEnabled:
          typeof patch.heavyEnabled === "boolean"
            ? patch.heavyEnabled
            : room.rules.heavyEnabled,
        dashEnabled:
          typeof patch.dashEnabled === "boolean"
            ? patch.dashEnabled
            : room.rules.dashEnabled,
        blockEnabled:
          typeof patch.blockEnabled === "boolean"
            ? patch.blockEnabled
            : room.rules.blockEnabled,
        friendlyFire:
          typeof patch.friendlyFire === "boolean"
            ? patch.friendlyFire
            : room.rules.friendlyFire,
      };
    } else if (msg.type === "setTrainingBotMode") {
      if (
        room.mode !== "training" ||
        !player.host ||
        !["static", "strafe", "aggressive", "blocking"].includes(msg.mode)
      )
        return;
      room.trainingBotMode = msg.mode;
      broadcast(room, {
        type: "notice",
        text: `Sparr-Bot: ${msg.mode.toUpperCase()}`,
      });
    } else if (msg.type === "ping") {
      if (Number.isFinite(msg.clientTime))
        send(socket, {
          type: "pong",
          clientTime: msg.clientTime,
          serverTime: Date.now(),
        });
    } else if (msg.type === "chat") {
      const now = Date.now();
      const text = String(msg.text).trim().replace(/\s+/g, " ").slice(0, 120);
      if (!text || now - player.lastChat < 700) return;
      player.lastChat = now;
      broadcast(room, {
        type: "chat",
        playerId: player.id,
        name: player.name,
        text,
        sentAt: now,
      });
    } else if (msg.type === "ready") {
      if (room.phase !== "lobby") return;
      player.ready = !!msg.ready;
      const humans = [...room.players.values()].filter(
        (candidate) => !candidate.bot,
      );
      if (humans.length >= 2 && humans.every((candidate) => candidate.ready)) {
        room.phase = "countdown";
        room.phaseEndsAt = Date.now() + 3_500;
        broadcast(room, {
          type: "notice",
          text: "Alle bereit – Match startet",
        });
      }
    } else if (msg.type === "input") {
      if (![msg.moveX, msg.moveZ, msg.yaw].every(Number.isFinite)) return;
      if (
        !Number.isSafeInteger(msg.sequence) ||
        msg.sequence <= player.lastProcessedInput
      )
        return;
      if (msg.sequence - player.lastProcessedInput > 10_000)
        console.warn(
          JSON.stringify({
            event: "suspicious_input_jump",
            playerId: player.id,
            from: player.lastProcessedInput,
            to: msg.sequence,
          }),
        );
      player.lastProcessedInput = msg.sequence;
      player.input = {
        moveX: Math.max(-1, Math.min(1, msg.moveX)),
        moveZ: Math.max(-1, Math.min(1, msg.moveZ)),
        yaw: msg.yaw,
        jump: !!msg.jump,
        dash: room.rules.dashEnabled && !!msg.dash,
        blocking: room.rules.blockEnabled && !!msg.blocking && !msg.charging,
        charging: room.rules.heavyEnabled && !!msg.charging && !msg.blocking,
      };
    } else if (
      msg.type === "attack" &&
      room.phase === "playing" &&
      (msg.kind === "light" || msg.kind === "heavy") &&
      Number.isFinite(msg.charge) &&
      Number.isFinite(msg.yaw) &&
      Number.isFinite(msg.clientTime)
    ) {
      const now = Date.now();
      const rewindMs = Math.max(0, Math.min(150, now - msg.clientTime));
      if (msg.kind === "heavy" && !room.rules.heavyEnabled) return;
      if (msg.kind === "light" && (player.blocking || player.charging)) return;
      const verifiedCharge =
        msg.kind === "heavy" ? consumeHeavyCharge(player, msg.charge, now) : 0;
      if (msg.kind === "heavy" && verifiedCharge === undefined) return;
      const previousAttackAt = player.lastAttack;
      const result = performAttack(
        player,
        room.players.values(),
        msg.kind,
        verifiedCharge ?? 0,
        msg.yaw,
        now,
        rewindMs,
        room.rules.knockbackMultiplier,
        (candidate) =>
          room.rules.gameMode !== "team" ||
          room.rules.friendlyFire ||
          !player.team ||
          candidate.team !== player.team,
      );
      if (player.lastAttack !== previousAttackAt)
        broadcast(room, {
          type: "attack",
          attackerId: player.id,
          kind: msg.kind,
          charge: verifiedCharge ?? 0,
        });
      if (result)
        broadcast(room, {
          type: "hit",
          attackerId: player.id,
          victimId: result.victim.id,
          kind: msg.kind,
          parried: result.parried,
          blocked: result.blocked,
          finisher: result.finisher,
          knockback: result.victim.knockback,
          combo: player.combo,
        });
    }
  });
  socket.on("close", () => {
    if (!client.room || !client.player) return;
    client.room.clients.delete(client);
    if (client.reconnectToken)
      reconnects.set(client.reconnectToken, {
        room: client.room,
        player: client.player,
        expiresAt: Date.now() + 12_000,
      });
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [token, record] of reconnects) {
    if (record.expiresAt > now) continue;
    reconnects.delete(token);
    record.room.players.delete(record.player.id);
    if (record.room.hostId === record.player.id) {
      record.player.host = false;
      const nextHost = [...record.room.clients]
        .map((connected) => connected.player)
        .find((player): player is SimPlayer => Boolean(player && !player.bot));
      record.room.hostId = nextHost?.id;
      if (nextHost) {
        nextHost.host = true;
        broadcast(record.room, {
          type: "notice",
          text: `${nextHost.name} ist jetzt Host`,
        });
      }
    }
    const remainingHumans = [...record.room.players.values()].some(
      (player) => !player.bot,
    );
    if (!remainingHumans && record.room.clients.size === 0)
      rooms.delete(record.room.code);
  }
}, 1_000);

setInterval(() => {
  const now = Date.now(),
    dt = 1 / GAME.tickRate;
  for (const room of rooms.values()) {
    if (room.phase === "countdown" && now >= room.phaseEndsAt) {
      room.phase = "playing";
      room.matchId = randomUUID();
      room.matchStartedAt = now;
      room.phaseEndsAt = now + room.rules.matchDurationSeconds * 1_000;
      let spawnIndex = 0;
      let humanIndex = 0;
      for (const player of room.players.values()) {
        if (!player.bot) player.team = humanIndex++ % 2 === 0 ? "red" : "blue";
        player.score = 0;
        player.assists = 0;
        player.falls = 0;
        player.combo = 0;
        player.comboTargetId = undefined;
        player.lastComboAt = 0;
        player.knockback = 0;
        player.stocksRemaining = room.rules.stocks;
        player.eliminated = false;
        respawn(player, spawnIndex++, now);
      }
      broadcast(room, { type: "notice", text: "FIGHT!" });
    } else if (
      room.phase === "playing" &&
      room.mode !== "training" &&
      now >= room.phaseEndsAt
    ) {
      room.phase = "results";
      room.phaseEndsAt = now + 10_000;
      if (room.rules.gameMode === "team") {
        const red = [...room.players.values()]
          .filter((player) => player.team === "red")
          .reduce((sum, player) => sum + player.score, 0);
        const blue = [...room.players.values()]
          .filter((player) => player.team === "blue")
          .reduce((sum, player) => sum + player.score, 0);
        broadcast(room, {
          type: "notice",
          text:
            red === blue
              ? "UNENTSCHIEDEN"
              : `${red > blue ? "ROT" : "BLAU"} GEWINNT!`,
        });
      } else broadcast(room, { type: "notice", text: "MATCH BEENDET" });
    } else if (room.phase === "results" && now >= room.phaseEndsAt) {
      if (room.mode === "private") {
        room.phase = "lobby";
        room.phaseEndsAt = 0;
        for (const player of room.players.values())
          player.ready = player.bot ?? false;
      } else {
        room.phase = "playing";
        room.matchId = randomUUID();
        room.matchStartedAt = now;
        room.phaseEndsAt = now + room.rules.matchDurationSeconds * 1_000;
        let spawnIndex = 0;
        for (const player of room.players.values()) {
          player.score = 0;
          player.assists = 0;
          player.falls = 0;
          player.combo = 0;
          player.knockback = 0;
          player.stocksRemaining = room.rules.stocks;
          player.eliminated = false;
          respawn(player, spawnIndex++, now);
        }
        broadcast(room, { type: "notice", text: "NEUES MATCH – FIGHT!" });
      }
    }
    let index = 0;
    for (const player of room.players.values()) {
      if (player.bot && !player.respawnAt) {
        const human = [...room.players.values()].find((p) => !p.bot);
        if (human) {
          const dx = human.position.x - player.position.x,
            dz = human.position.z - player.position.z;
          const distance = Math.hypot(dx, dz);
          const waypoint = botNavigationTarget(player.position, human.position);
          const moveDx = waypoint.x - player.position.x,
            moveDz = waypoint.z - player.position.z;
          const navigatingAroundWall =
            Math.hypot(
              waypoint.x - human.position.x,
              waypoint.z - human.position.z,
            ) > 0.25;
          player.yaw = Math.atan2(-moveDx, -moveDz);
          player.input.yaw = player.yaw;
          player.input.blocking = false;
          player.input.moveX = 0;
          player.input.moveZ = 0;
          if (room.trainingBotMode === "strafe")
            player.input.moveX = Math.sin(now / 900) * 0.45;
          if (room.trainingBotMode === "aggressive") {
            player.input.moveZ =
              navigatingAroundWall || distance > 2.8 ? -0.48 : 0;
            const attackYaw = Math.atan2(-dx, -dz);
            const previousAttackAt = player.lastAttack;
            const attack =
              distance < GAME.punchRange && now - player.lastAttack >= 950
                ? performAttack(
                    player,
                    room.players.values(),
                    "light",
                    0,
                    attackYaw,
                    now,
                    0,
                    room.rules.knockbackMultiplier,
                  )
                : undefined;
            if (player.lastAttack !== previousAttackAt)
              broadcast(room, {
                type: "attack",
                attackerId: player.id,
                kind: "light",
                charge: 0,
              });
            if (attack)
              broadcast(room, {
                type: "hit",
                attackerId: player.id,
                victimId: attack.victim.id,
                kind: "light",
                parried: attack.parried,
                blocked: attack.blocked,
                finisher: attack.finisher,
                knockback: attack.victim.knockback,
                combo: player.combo,
              });
          }
          if (room.trainingBotMode === "blocking") {
            player.input.moveX = Math.sin(now / 1_100) * 0.18;
            player.input.blocking = Math.floor(now / 1_200) % 3 !== 2;
          }
        }
      }
      if (player.respawnAt && !player.eliminated && now >= player.respawnAt)
        respawn(player, index, now);
      else if (room.phase === "playing" && !player.eliminated) {
        const step = stepPlayer(player, dt, now);
        if (step.wallHit)
          broadcast(room, {
            type: "wallHit",
            playerId: player.id,
            position: step.wallHit.position,
            intensity: step.wallHit.intensity,
          });
        if (step.knockedOut) {
          if (room.mode === "private" && room.rules.gameMode === "stock")
            player.stocksRemaining = Math.max(0, player.stocksRemaining - 1);
          player.eliminated =
            room.mode === "private" &&
            room.rules.gameMode === "stock" &&
            player.stocksRemaining <= 0;
          player.respawnAt = player.eliminated ? 0 : now + GAME.respawnMs;
          const credit = creditKnockout(player, room.players, now);
          broadcast(room, {
            type: "knockout",
            victimId: player.id,
            attackerId: credit.attacker?.id,
            assistIds: credit.assistIds,
          });
        }
      }
      index++;
    }
    if (
      room.phase === "playing" &&
      room.mode === "private" &&
      room.rules.gameMode === "stock"
    ) {
      const humans = [...room.players.values()].filter((player) => !player.bot);
      const active = humans.filter((player) => !player.eliminated);
      if (humans.length >= 2 && active.length <= 1) {
        room.phase = "results";
        room.phaseEndsAt = now + 10_000;
        broadcast(room, {
          type: "notice",
          text: active[0] ? `${active[0].name} GEWINNT!` : "UNENTSCHIEDEN",
        });
      }
    }
  }
}, 1000 / GAME.tickRate);

setInterval(() => {
  for (const room of rooms.values())
    broadcast(room, {
      type: "snapshot",
      serverTime: Date.now(),
      matchId: room.matchId,
      matchStartedAt: room.matchStartedAt,
      phase: room.phase,
      phaseEndsAt: room.phaseEndsAt,
      trainingBotMode: room.trainingBotMode,
      rules: room.rules,
      players: [...room.players.values()].map(
        ({
          input: _i,
          lastAttack: _a,
          lastDash: _d,
          dashUntil: _du,
          lastAttacker: _la,
          respawnAt: _r,
          protectionUntil: _p,
          blockStarted: _b,
          blockCooldownUntil: _bc,
          chargeStarted: _cs,
          lastWallHit: _w,
          airRecoveryAvailable: _ar,
          lastChat: _c,
          lastComboAt: _co,
          comboTargetId: _ct,
          damageContributors: _dc,
          hitStunUntil: _hs,
          hitWindowStartedAt: _hw,
          recentHitCount: _rh,
          resistanceUntil: _rs,
          finisherUntil: _fi,
          positionHistory: _ph,
          ...snapshot
        }) => snapshot,
      ),
    });
}, 1000 / GAME.snapshotRate);

http.listen(port, "0.0.0.0", () =>
  console.log(JSON.stringify({ event: "server_started", port })),
);

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ event: "server_shutdown", signal }));
  clearInterval(heartbeatTimer);
  for (const socket of wss.clients)
    socket.close(1012, "Server wird aktualisiert");
  wss.close();
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
