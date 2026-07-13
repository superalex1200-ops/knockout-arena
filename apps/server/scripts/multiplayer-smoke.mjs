import assert from "node:assert/strict";
import WebSocket from "ws";
import { websocketOptions } from "./ws-origin.mjs";

const url = process.env.TEST_SERVER_URL ?? "ws://localhost:2567/ws";
const clients = [];
const playerIds = [];
const rulesSeenBy = new Set();
const readySent = new Set();
let roomCode = "";
let rulesSent = false;
let unauthorizedStartSent = false;
let lobbySnapshotsAfterUnauthorizedStart = 0;
let authorizedStartSent = false;
let sawCountdown = false;
let sawChat = false;
let sawPong = false;
let sawSequenceGuard = false;
let modeLockVerified = false;
let hostLeaveSent = false;
let resolved = false;

const timer = setTimeout(
  () => finish(new Error("Timed out waiting for authoritative room lifecycle")),
  14_000,
);

function finish(error) {
  if (resolved) return;
  resolved = true;
  clearTimeout(timer);
  for (const client of clients) client.close();
  if (error) {
    console.error(error);
    process.exitCode = 1;
  } else
    console.log(
      `Multiplayer lifecycle smoke passed in server room ${roomCode}`,
    );
}

function connectPlayer(index, createRoom) {
  const client = new WebSocket(url, websocketOptions(url));
  clients.push(client);
  client.on("open", () =>
    client.send(
      JSON.stringify({
        type: "join",
        name: `Test${index + 1}`,
        roomCode: createRoom ? "IGNORED" : roomCode,
        mode: "private",
        protocolVersion: 1,
        createRoom,
      }),
    ),
  );
  client.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === "welcome") {
      playerIds[index] = message.playerId;
      assert.equal(message.roomMode, "private");
      if (index === 0) {
        roomCode = message.roomCode;
        assert.match(roomCode, /^P[A-HJ-NP-Z2-9]{5}$/);
        verifyModeLock();
        connectPlayer(1, false);
        client.send(
          JSON.stringify({ type: "chat", text: "Multiplayer smoke" }),
        );
        client.send(JSON.stringify({ type: "ping", clientTime: 12345 }));
        client.send(
          JSON.stringify({
            type: "input",
            sequence: 2,
            moveX: 0,
            moveZ: 0,
            yaw: 0,
            jump: false,
            dash: false,
            blocking: false,
            charging: false,
          }),
        );
        client.send(
          JSON.stringify({
            type: "input",
            sequence: 1,
            moveX: 0,
            moveZ: 0,
            yaw: 1,
            jump: false,
            dash: false,
            blocking: false,
            charging: false,
          }),
        );
        client.send(
          JSON.stringify({
            type: "input",
            sequence: 10_003,
            moveX: 0,
            moveZ: 0,
            yaw: 2,
            jump: false,
            dash: false,
            blocking: false,
            charging: false,
          }),
        );
      }
    }
    if (message.type === "chat" && message.text === "Multiplayer smoke")
      sawChat = true;
    if (message.type === "pong" && message.clientTime === 12345) sawPong = true;
    if (message.type !== "snapshot") return;
    assert.equal(message.roomMode, "private");
    assert.ok(Array.isArray(message.rematchVotes));
    const mine = message.players.find(
      (player) => player.id === playerIds[index],
    );
    if (mine?.host && !rulesSent) {
      rulesSent = true;
      client.send(
        JSON.stringify({
          type: "updateRules",
          patch: {
            gameMode: "team",
            matchDurationSeconds: 120,
            stocks: 5,
            knockbackMultiplier: 1.25,
            dashEnabled: false,
            friendlyFire: false,
          },
        }),
      );
    }
    if (
      message.rules?.gameMode === "team" &&
      message.rules?.matchDurationSeconds === 120 &&
      message.rules?.stocks === 5 &&
      message.rules?.knockbackMultiplier === 1.25 &&
      message.rules?.dashEnabled === false &&
      message.rules?.friendlyFire === false
    ) {
      rulesSeenBy.add(index);
      if (!readySent.has(index)) {
        readySent.add(index);
        client.send(JSON.stringify({ type: "ready", ready: true }));
      }
    }
    const guarded = message.players.find((player) => player.name === "Test1");
    if (guarded?.lastProcessedInput === 2 && guarded.yaw === 0)
      sawSequenceGuard = true;

    const humans = message.players.filter((player) => !player.bot);
    if (humans.length === 2)
      assert.ok(
        humans.every((player) => player.connected === true),
        "Connected lobby players must be marked online",
      );
    if (
      index === 1 &&
      message.phase === "lobby" &&
      humans.length === 2 &&
      humans.every((player) => player.ready) &&
      !unauthorizedStartSent
    ) {
      unauthorizedStartSent = true;
      client.send(JSON.stringify({ type: "startMatch" }));
      return;
    }
    if (unauthorizedStartSent && !authorizedStartSent) {
      if (message.phase !== "lobby")
        return finish(
          new Error("Non-host was able to start the private match"),
        );
      if (index === 0 && ++lobbySnapshotsAfterUnauthorizedStart >= 2) {
        authorizedStartSent = true;
        client.send(JSON.stringify({ type: "startMatch" }));
      }
    }
    if (message.phase === "countdown") sawCountdown = true;
    if (
      index === 0 &&
      message.phase === "playing" &&
      sawCountdown &&
      sawChat &&
      sawPong &&
      sawSequenceGuard &&
      modeLockVerified &&
      rulesSeenBy.size === 2 &&
      message.players.every((player) => player.stocksRemaining === 5) &&
      !hostLeaveSent
    ) {
      hostLeaveSent = true;
      client.send(JSON.stringify({ type: "leave" }));
    }
    if (
      index === 1 &&
      hostLeaveSent &&
      message.phase === "results" &&
      mine?.host &&
      humans.length === 1
    )
      finish();
  });
  client.on("error", finish);
}

function verifyModeLock() {
  const probe = new WebSocket(url, websocketOptions(url));
  clients.push(probe);
  probe.on("open", () =>
    probe.send(
      JSON.stringify({
        type: "join",
        name: "ModeProbe",
        roomCode,
        mode: "training",
        protocolVersion: 1,
      }),
    ),
  );
  probe.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type !== "joinError") return;
    try {
      assert.equal(message.code, "ROOM_MODE_MISMATCH");
      modeLockVerified = true;
      probe.close();
    } catch (error) {
      finish(error);
    }
  });
  probe.on("error", finish);
}

connectPlayer(0, true);
