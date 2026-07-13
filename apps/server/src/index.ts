import { createServer, type IncomingMessage } from "node:http";
import { randomInt, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { extname, resolve } from "node:path";
import type { Duplex } from "node:stream";
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
  resolvePlayerCollisions,
  stepPlayer,
  TRAINING_BOT_ATTACK_INTERVAL_MS,
  trainingBotCanEngage,
  type SimPlayer,
} from "./simulation.js";
import { parseClientMessage } from "./protocol.js";
import {
  ConcurrentConnectionLimiter,
  createIngressRateLimiters,
  createOriginPolicy,
  decideBackpressure,
  isWebSocketOriginAllowed,
} from "./security.js";

type Client = {
  socket: WebSocket;
  securityId: string;
  ip: string;
  joinTimer?: ReturnType<typeof setTimeout>;
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
  rematchVotes: Set<string>;
  hostId?: string;
};
type ReconnectRecord = { room: Room; player: SimPlayer; expiresAt: number };
const rooms = new Map<string, Room>();
const reconnects = new Map<string, ReconnectRecord>();
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const port = Number(process.env.PORT ?? 2567);

function integerEnvironment(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const configured = process.env[name];
  if (configured === undefined || configured === "") return fallback;
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  return value;
}

const trustProxy =
  process.env.TRUST_PROXY === "true" ||
  process.env.RENDER === "true" ||
  Boolean(process.env.RENDER_EXTERNAL_URL);
const originPolicy = createOriginPolicy(process.env);
const ingressLimits = createIngressRateLimiters();
const concurrentConnections = new ConcurrentConnectionLimiter({
  maxPerKey: integerEnvironment("MAX_CONNECTIONS_PER_IP", 12, 1, 100),
  maxTotal: integerEnvironment("MAX_CONNECTIONS_TOTAL", 2_000, 10, 100_000),
});
const joinTimeoutMs = integerEnvironment(
  "WS_JOIN_TIMEOUT_MS",
  8_000,
  1_000,
  30_000,
);
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

function send(socket: WebSocket, message: ServerMessage): boolean {
  if (socket.readyState !== WebSocket.OPEN) return false;
  const action = decideBackpressure(
    socket.bufferedAmount,
    message.type === "snapshot" ? "snapshot" : "realtime",
  );
  if (action === "drop") return false;
  if (action === "close") {
    socket.terminate();
    return false;
  }
  socket.send(JSON.stringify(message));
  return true;
}
function broadcast(room: Room, message: ServerMessage): void {
  for (const c of room.clients) send(c.socket, message);
}
function generateRoomCode(mode: MatchMode): string {
  const prefix = mode === "quick" ? "Q" : mode === "training" ? "T" : "P";
  let code: string;
  do {
    code = prefix;
    for (let index = 1; index < 6; index++)
      code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  } while (rooms.has(code));
  return code;
}

function createRoom(mode: MatchMode): Room {
  const room: Room = {
    code: generateRoomCode(mode),
    players: new Map(),
    clients: new Set(),
    phase: "lobby",
    phaseEndsAt: 0,
    matchId: randomUUID(),
    matchStartedAt: 0,
    mode,
    trainingBotMode: "aggressive",
    rules: { ...DEFAULT_MATCH_RULES },
    rematchVotes: new Set(),
  };
  rooms.set(room.code, room);
  console.log(JSON.stringify({ event: "room_created", code: room.code, mode }));
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
  return createRoom("quick");
}

function humanPlayers(room: Room): SimPlayer[] {
  return [...room.players.values()].filter((player) => !player.bot);
}

function connectedHumanPlayers(room: Room): SimPlayer[] {
  return [...room.clients]
    .map((client) => client.player)
    .filter((player): player is SimPlayer => Boolean(player && !player.bot));
}

function isPlayerConnected(room: Room, playerId: string): boolean {
  for (const client of room.clients)
    if (client.player?.id === playerId) return true;
  return false;
}

function enterLobby(room: Room, notice?: string): void {
  room.phase = "lobby";
  room.phaseEndsAt = 0;
  room.rematchVotes.clear();
  for (const player of room.players.values())
    player.ready = player.bot ?? false;
  if (notice) broadcast(room, { type: "notice", text: notice });
}

function beginCountdown(room: Room, now: number, notice: string): void {
  room.phase = "countdown";
  room.phaseEndsAt = now + 3_000;
  room.rematchVotes.clear();
  broadcast(room, { type: "notice", text: notice });
}

function beginMatch(room: Room, now: number): void {
  room.phase = "playing";
  room.matchId = randomUUID();
  room.matchStartedAt = now;
  room.phaseEndsAt = now + room.rules.matchDurationSeconds * 1_000;
  room.rematchVotes.clear();
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
  console.log(
    JSON.stringify({
      event: "match_started",
      room: room.code,
      mode: room.mode,
    }),
  );
}

function endMatch(room: Room, now: number, notice: string): void {
  if (room.phase === "results") return;
  room.phase = "results";
  room.phaseEndsAt = now + 10_000;
  room.rematchVotes.clear();
  broadcast(room, { type: "notice", text: notice });
  console.log(
    JSON.stringify({ event: "match_ended", room: room.code, mode: room.mode }),
  );
}

function migrateHost(room: Room): void {
  for (const player of room.players.values()) player.host = false;
  const nextHost = connectedHumanPlayers(room)[0];
  room.hostId = nextHost?.id;
  if (!nextHost) return;
  nextHost.host = true;
  broadcast(room, {
    type: "notice",
    text: `${nextHost.name} ist jetzt Host`,
  });
}

function reconcileRoomAfterDeparture(room: Room, now: number): void {
  const humans = humanPlayers(room);
  const connectedHumans = connectedHumanPlayers(room);
  if (humans.length === 0) {
    rooms.delete(room.code);
    return;
  }
  if (room.phase === "countdown") {
    if (room.mode !== "quick" || connectedHumans.length < 2)
      enterLobby(room, "Countdown abgebrochen – warte auf Spieler");
    return;
  }
  if (room.mode === "quick" && humans.length < 2) {
    if (room.phase !== "lobby")
      enterLobby(room, "Gegner hat verlassen – suche neuen Spieler");
    return;
  }
  if (
    room.mode === "quick" &&
    room.phase === "lobby" &&
    connectedHumans.length >= 2
  ) {
    beginCountdown(room, now, "GEGNER GEFUNDEN");
    return;
  }
  if (room.mode === "private" && room.phase === "playing" && humans.length < 2)
    endMatch(room, now, `${humans[0]?.name ?? "SPIELER"} GEWINNT!`);
}

function removeClientImmediately(client: Client, now: number): void {
  const room = client.room;
  const player = client.player;
  if (!room || !player) return;
  room.clients.delete(client);
  room.players.delete(player.id);
  room.rematchVotes.delete(player.id);
  if (client.reconnectToken) reconnects.delete(client.reconnectToken);
  const wasHost = room.hostId === player.id;
  client.room = undefined;
  client.player = undefined;
  client.reconnectToken = undefined;
  if (wasHost) migrateHost(room);
  reconcileRoomAfterDeparture(room, now);
  console.log(
    JSON.stringify({
      event: "player_left",
      room: room.code,
      playerId: player.id,
    }),
  );
}

function privateRoomCanStart(room: Room): boolean {
  const humans = humanPlayers(room);
  return (
    humans.length >= 2 &&
    connectedHumanPlayers(room).length === humans.length &&
    humans.every((player) => player.ready)
  );
}

function tryStartRematch(room: Room, now: number): void {
  if (room.phase !== "results") return;
  const humans = humanPlayers(room);
  if (
    humans.length >= 2 &&
    connectedHumanPlayers(room).length === humans.length &&
    humans.every((player) => room.rematchVotes.has(player.id))
  )
    beginCountdown(room, now, "REMATCH – ALLE BEREIT");
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
function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function directAddress(request: IncomingMessage): string {
  const address = request.socket.remoteAddress ?? "unknown";
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

function clientAddress(request: IncomingMessage): string {
  const direct = directAddress(request);
  if (!trustProxy) return direct;
  const forwarded = headerValue(request.headers["x-forwarded-for"])
    ?.split(",", 1)[0]
    ?.trim();
  return forwarded && isIP(forwarded) ? forwarded : direct;
}

function rejectUpgrade(
  socket: Duplex,
  status: 403 | 404 | 429 | 503,
  reason: string,
  retryAfterSeconds?: number,
): void {
  const statusText =
    status === 403
      ? "Forbidden"
      : status === 404
        ? "Not Found"
        : status === 429
          ? "Too Many Requests"
          : "Service Unavailable";
  const body = `${reason}\n`;
  const retryHeader =
    retryAfterSeconds === undefined
      ? ""
      : `Retry-After: ${Math.max(1, Math.ceil(retryAfterSeconds))}\r\n`;
  socket.end(
    `HTTP/1.1 ${status} ${statusText}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n${retryHeader}\r\n${body}`,
  );
}

let shuttingDown = false;
const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
const clientsBySocket = new Map<WebSocket, Client>();
const liveSockets = new WeakSet<WebSocket>();
http.on("upgrade", (request, socket, head) => {
  socket.once("error", () => socket.destroy());
  let pathname: string;
  try {
    pathname = new URL(request.url ?? "/", "http://game.invalid").pathname;
  } catch {
    rejectUpgrade(socket, 404, "WebSocket endpoint not found");
    return;
  }
  if (pathname !== "/ws") {
    rejectUpgrade(socket, 404, "WebSocket endpoint not found");
    return;
  }
  if (shuttingDown) {
    rejectUpgrade(socket, 503, "Server is shutting down", 5);
    return;
  }

  const ip = clientAddress(request);
  const allowedOrigin = isWebSocketOriginAllowed(
    {
      origin: headerValue(request.headers.origin),
      host: request.headers.host,
      forwardedProto: trustProxy
        ? headerValue(request.headers["x-forwarded-proto"])
        : undefined,
      encrypted: Boolean(
        (request.socket as typeof request.socket & { encrypted?: boolean })
          .encrypted,
      ),
    },
    originPolicy,
  );
  if (!allowedOrigin) {
    console.warn(JSON.stringify({ event: "websocket_origin_rejected", ip }));
    rejectUpgrade(socket, 403, "WebSocket origin rejected");
    return;
  }

  const connectionRate = ingressLimits.connection.consume(ip);
  if (!connectionRate.allowed) {
    console.warn(
      JSON.stringify({ event: "websocket_connection_rate_limited", ip }),
    );
    rejectUpgrade(
      socket,
      429,
      "Too many connection attempts",
      connectionRate.retryAfterMs / 1_000,
    );
    return;
  }
  const concurrent = concurrentConnections.acquire(ip);
  if (!concurrent.allowed) {
    console.warn(
      JSON.stringify({
        event: "websocket_concurrent_limit",
        ip,
        reason: concurrent.reason,
      }),
    );
    rejectUpgrade(socket, 429, "Too many concurrent connections", 5);
    return;
  }

  let connectionReleased = false;
  socket.once("close", () => {
    if (connectionReleased) return;
    connectionReleased = true;
    concurrentConnections.release(ip);
  });
  try {
    wss.handleUpgrade(request, socket, head, (websocket) => {
      wss.emit("connection", websocket, request);
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "websocket_upgrade_failed",
        error: String(error),
      }),
    );
    socket.destroy();
  }
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

wss.on("connection", (socket, request) => {
  const client: Client = {
    socket,
    securityId: randomUUID(),
    ip: clientAddress(request),
  };
  clientsBySocket.set(socket, client);
  liveSockets.add(socket);
  socket.on("pong", () => liveSockets.add(socket));
  socket.on("error", (error) =>
    console.warn(
      JSON.stringify({
        event: "websocket_error",
        ip: client.ip,
        error: String(error),
      }),
    ),
  );
  client.joinTimer = setTimeout(() => {
    if (!client.player && socket.readyState === WebSocket.OPEN)
      socket.close(1008, "Join timeout");
  }, joinTimeoutMs);
  client.joinTimer.unref();
  const clearJoinTimer = () => {
    if (!client.joinTimer) return;
    clearTimeout(client.joinTimer);
    client.joinTimer = undefined;
  };
  socket.on("message", (raw) => {
    const messageRate = ingressLimits.message.consume(client.securityId);
    if (!messageRate.allowed) {
      console.warn(
        JSON.stringify({
          event: "websocket_message_rate_limited",
          ip: client.ip,
        }),
      );
      socket.close(1008, "Nachrichtenlimit erreicht");
      return;
    }
    const msg: ClientMessage | undefined = parseClientMessage(raw.toString());
    if (!msg) return;
    if (msg.type === "input") {
      const inputRate = ingressLimits.input.consume(
        client.player?.id ?? client.securityId,
      );
      if (!inputRate.allowed) {
        console.warn(
          JSON.stringify({
            event: "websocket_input_rate_limited",
            ip: client.ip,
            playerId: client.player?.id,
          }),
        );
        socket.close(1008, "Inputlimit erreicht");
        return;
      }
    }
    if (msg.type === "join" && !client.player) {
      const joinRate = ingressLimits.join.consume(client.ip);
      if (!joinRate.allowed) {
        console.warn(
          JSON.stringify({
            event: "websocket_join_rate_limited",
            ip: client.ip,
          }),
        );
        socket.close(1013, "Zu viele Beitrittsversuche");
        return;
      }
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
      if (reconnect && reconnect.expiresAt > Date.now()) {
        reconnects.delete(msg.reconnectToken!);
        reconnect.room.clients.add(client);
        client.player = reconnect.player;
        client.room = reconnect.room;
        client.reconnectToken = msg.reconnectToken;
        clearJoinTimer();
        if (!reconnect.room.hostId) {
          reconnect.room.hostId = reconnect.player.id;
          reconnect.player.host = true;
        }
        send(socket, {
          type: "welcome",
          playerId: reconnect.player.id,
          roomCode: reconnect.room.code,
          roomMode: reconnect.room.mode,
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
        if (
          reconnect.room.mode === "quick" &&
          reconnect.room.phase === "lobby" &&
          connectedHumanPlayers(reconnect.room).length >= 2
        )
          beginCountdown(reconnect.room, Date.now(), "GEGNER GEFUNDEN");
        return;
      }
      if (msg.reconnectToken) {
        reconnects.delete(msg.reconnectToken);
        if (reconnect) {
          reconnect.room.players.delete(reconnect.player.id);
          reconnect.room.rematchVotes.delete(reconnect.player.id);
          if (reconnect.room.hostId === reconnect.player.id)
            migrateHost(reconnect.room);
          reconcileRoomAfterDeparture(reconnect.room, Date.now());
        }
        send(socket, {
          type: "joinError",
          code: "RECONNECT_EXPIRED",
          message: "Die Reconnect-Zeit ist abgelaufen. Bitte neu beitreten.",
        });
        return;
      }

      let room: Room;
      if (msg.mode === "quick") room = quickRoom();
      else if (msg.createRoom) room = createRoom(msg.mode);
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
        if (!existing) {
          send(socket, {
            type: "joinError",
            code: "ROOM_NOT_FOUND",
            message:
              "Diese Lobby wurde nicht gefunden. Prüfe den Code und versuche es erneut.",
          });
          return;
        }
        if (existing.mode !== msg.mode) {
          send(socket, {
            type: "joinError",
            code: "ROOM_MODE_MISMATCH",
            message: "Dieser Code gehört zu einem anderen Spielmodus.",
          });
          return;
        }
        room = existing;
      }
      const humanCount = humanPlayers(room).length;
      if (humanCount >= 8) {
        send(socket, {
          type: "joinError",
          code: "ROOM_FULL",
          message: "Diese Arena ist bereits voll.",
        });
        return;
      }
      if (room.mode !== "quick" && room.phase !== "lobby") {
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
      if (room.mode === "private") {
        const humanIndex = humanPlayers(room).length;
        player.team = humanIndex % 2 === 0 ? "red" : "blue";
      }
      if (!room.hostId && !player.bot) {
        room.hostId = id;
        player.host = true;
      }
      room.players.set(id, player);
      room.clients.add(client);
      client.player = player;
      client.room = room;
      client.reconnectToken = reconnectToken;
      clearJoinTimer();
      if (room.mode === "training" && !room.players.has("coach-bot"))
        room.players.set(
          "coach-bot",
          createPlayer("coach-bot", "SPARR-BOT", 1, true),
        );
      if (room.mode === "training" && room.phase !== "playing")
        beginMatch(room, Date.now());
      if (
        room.mode === "quick" &&
        connectedHumanPlayers(room).length >= 2 &&
        room.phase === "lobby"
      )
        beginCountdown(room, Date.now(), "GEGNER GEFUNDEN");
      send(socket, {
        type: "welcome",
        playerId: id,
        roomCode: room.code,
        roomMode: room.mode,
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
    if (msg.type === "leave") {
      removeClientImmediately(client, Date.now());
      return;
    }
    if (msg.type === "startMatch") {
      if (
        room.mode !== "private" ||
        room.phase !== "lobby" ||
        room.hostId !== player.id
      )
        return;
      if (!privateRoomCanStart(room)) {
        send(socket, {
          type: "notice",
          text: "Mindestens zwei verbundene Spieler müssen bereit sein",
        });
        return;
      }
      beginCountdown(room, Date.now(), "HOST STARTET DAS MATCH");
    } else if (msg.type === "rematchVote") {
      if (
        room.phase !== "results" ||
        (room.mode !== "private" && room.mode !== "quick")
      )
        return;
      if (msg.vote) room.rematchVotes.add(player.id);
      else room.rematchVotes.delete(player.id);
      if (msg.vote)
        broadcast(room, {
          type: "notice",
          text: `${player.name} möchte ein Rematch`,
        });
      tryStartRematch(room, Date.now());
    } else if (msg.type === "returnToLobby") {
      if (
        room.mode !== "private" ||
        room.phase !== "results" ||
        room.hostId !== player.id
      )
        return;
      enterLobby(room, "HOST KEHRT ZUR LOBBY ZURÜCK");
    } else if (msg.type === "updateRules") {
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
      if (room.mode !== "private" || room.phase !== "lobby") return;
      player.ready = !!msg.ready;
    } else if (msg.type === "input") {
      if (
        ![msg.moveX, msg.moveZ, msg.yaw].every(Number.isFinite) ||
        (msg.pitch !== undefined && !Number.isFinite(msg.pitch))
      )
        return;
      if (
        !Number.isSafeInteger(msg.sequence) ||
        msg.sequence <= player.lastProcessedInput
      )
        return;
      if (msg.sequence - player.lastProcessedInput > 10_000) {
        console.warn(
          JSON.stringify({
            event: "suspicious_input_jump",
            playerId: player.id,
            from: player.lastProcessedInput,
            to: msg.sequence,
          }),
        );
        return;
      }
      player.lastProcessedInput = msg.sequence;
      player.input = {
        moveX: Math.max(-1, Math.min(1, msg.moveX)),
        moveZ: Math.max(-1, Math.min(1, msg.moveZ)),
        yaw: msg.yaw,
        pitch: Math.max(
          -1.2,
          Math.min(1.2, msg.pitch ?? player.input.pitch ?? 0),
        ),
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
      (msg.pitch === undefined || Number.isFinite(msg.pitch)) &&
      Number.isFinite(msg.clientTime)
    ) {
      const now = Date.now();
      if (
        msg.inputSequence !== undefined &&
        msg.inputSequence > player.lastProcessedInput
      )
        return;
      const rewindMs = Math.min(75, 1000 / GAME.snapshotRate);
      const attackYaw = player.input.yaw;
      const attackPitch = player.input.pitch;
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
        attackYaw,
        now,
        rewindMs,
        room.rules.knockbackMultiplier,
        (candidate) =>
          room.rules.gameMode !== "team" ||
          room.rules.friendlyFire ||
          !player.team ||
          candidate.team !== player.team,
        attackPitch,
      );
      if (player.lastAttack !== previousAttackAt)
        broadcast(room, {
          type: "attack",
          attackerId: player.id,
          kind: msg.kind,
          charge: verifiedCharge ?? 0,
          pitch: attackPitch,
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
          position: result.position,
          finisherDurationMs: result.finisher
            ? GAME.finisherDurationMs
            : undefined,
        });
    }
  });
  socket.on("close", () => {
    clearJoinTimer();
    clientsBySocket.delete(socket);
    ingressLimits.message.reset(client.securityId);
    ingressLimits.input.reset(client.securityId);
    if (client.player) ingressLimits.input.reset(client.player.id);
    if (shuttingDown) {
      client.room?.clients.delete(client);
      return;
    }
    if (!client.room || !client.player) return;
    client.room.clients.delete(client);
    client.player.input.moveX = 0;
    client.player.input.moveZ = 0;
    client.player.input.jump = false;
    client.player.input.dash = false;
    client.player.input.blocking = false;
    client.player.input.charging = false;
    if (client.reconnectToken)
      reconnects.set(client.reconnectToken, {
        room: client.room,
        player: client.player,
        expiresAt: Date.now() + 12_000,
      });
  });
});

const reconnectCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [token, record] of reconnects) {
    if (record.expiresAt > now) continue;
    reconnects.delete(token);
    record.room.players.delete(record.player.id);
    record.room.rematchVotes.delete(record.player.id);
    if (record.room.hostId === record.player.id) migrateHost(record.room);
    reconcileRoomAfterDeparture(record.room, now);
  }
}, 1_000);

const simulationTimer = setInterval(() => {
  const now = Date.now(),
    dt = 1 / GAME.tickRate;
  for (const room of rooms.values()) {
    if (room.phase === "countdown" && now >= room.phaseEndsAt) {
      const humans = humanPlayers(room);
      const connectedHumans = connectedHumanPlayers(room);
      if (
        humans.length < 2 ||
        connectedHumans.length < 2 ||
        (room.mode === "private" && connectedHumans.length !== humans.length)
      )
        enterLobby(room, "Countdown abgebrochen – warte auf Spieler");
      else beginMatch(room, now);
    } else if (
      room.phase === "playing" &&
      room.mode !== "training" &&
      now >= room.phaseEndsAt
    ) {
      if (room.rules.gameMode === "team") {
        const red = [...room.players.values()]
          .filter((player) => player.team === "red")
          .reduce((sum, player) => sum + player.score, 0);
        const blue = [...room.players.values()]
          .filter((player) => player.team === "blue")
          .reduce((sum, player) => sum + player.score, 0);
        endMatch(
          room,
          now,
          red === blue
            ? "UNENTSCHIEDEN"
            : `${red > blue ? "ROT" : "BLAU"} GEWINNT!`,
        );
      } else endMatch(room, now, "MATCH BEENDET");
    } else if (room.phase === "results" && now >= room.phaseEndsAt) {
      if (room.mode === "private") enterLobby(room, "ZURÜCK IN DER LOBBY");
      else if (connectedHumanPlayers(room).length >= 2)
        beginCountdown(room, now, "NÄCHSTES MATCH");
      else enterLobby(room, "WARTE AUF EINEN GEGNER");
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
            const canEngage = trainingBotCanEngage(
              human,
              room.matchStartedAt,
              now,
            );
            if (canEngage) {
              player.input.moveZ =
                navigatingAroundWall || distance > GAME.punchRange - 0.35
                  ? -0.48
                  : 0;
              const attackYaw = Math.atan2(-dx, -dz);
              const previousAttackAt = player.lastAttack;
              const attack =
                distance < GAME.punchRange - 0.05 &&
                now - player.lastAttack >= TRAINING_BOT_ATTACK_INTERVAL_MS
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
                  pitch: 0,
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
                  position: attack.position,
                  finisherDurationMs: attack.finisher
                    ? GAME.finisherDurationMs
                    : undefined,
                });
            }
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
    if (room.phase === "playing")
      resolvePlayerCollisions(room.players.values(), now);
    if (
      room.phase === "playing" &&
      room.mode === "private" &&
      room.rules.gameMode === "stock"
    ) {
      const humans = [...room.players.values()].filter((player) => !player.bot);
      const active = humans.filter((player) => !player.eliminated);
      if (humans.length >= 2 && active.length <= 1)
        endMatch(
          room,
          now,
          active[0] ? `${active[0].name} GEWINNT!` : "UNENTSCHIEDEN",
        );
    }
  }
}, 1000 / GAME.tickRate);

const snapshotTimer = setInterval(() => {
  const snapshotTime = Date.now();
  for (const room of rooms.values())
    broadcast(room, {
      type: "snapshot",
      serverTime: snapshotTime,
      matchId: room.matchId,
      matchStartedAt: room.matchStartedAt,
      phase: room.phase,
      phaseEndsAt: room.phaseEndsAt,
      roomMode: room.mode,
      rematchVotes: [...room.rematchVotes],
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
        }) => ({
          ...snapshot,
          connected: snapshot.bot || isPlayerConnected(room, snapshot.id),
          finisher: snapshotTime < _fi,
          finisherRemainingMs: Math.max(0, _fi - snapshotTime),
        }),
      ),
    });
}, 1000 / GAME.snapshotRate);

http.listen(port, "0.0.0.0", () =>
  console.log(JSON.stringify({ event: "server_started", port })),
);

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ event: "server_shutdown", signal }));
  clearInterval(heartbeatTimer);
  clearInterval(reconnectCleanupTimer);
  clearInterval(simulationTimer);
  clearInterval(snapshotTimer);
  for (const client of clientsBySocket.values()) {
    if (client.joinTimer) clearTimeout(client.joinTimer);
    client.joinTimer = undefined;
  }
  for (const socket of wss.clients)
    socket.close(1012, "Server wird aktualisiert");
  ingressLimits.connection.clear();
  ingressLimits.join.clear();
  ingressLimits.message.clear();
  ingressLimits.input.clear();
  concurrentConnections.clear();
  reconnects.clear();
  rooms.clear();
  clientsBySocket.clear();
  wss.close();
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
