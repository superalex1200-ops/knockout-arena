import assert from "node:assert/strict";
import WebSocket from "ws";
import { websocketOptions } from "./ws-origin.mjs";

const url = process.env.TEST_SERVER_URL ?? "ws://localhost:2567/ws";
const clients = [];
const playerIds = [];
const ready = new Set();
const startSent = new Set();
const movementSent = new Set();
const rematchSent = new Set();
let roomCode = "";
let rulesSent = false;
let returnToLobbySent = false;
let stage = 0;
let finished = false;
const timer = setTimeout(
  () => finish(new Error("Timed out waiting for lobby return and rematch")),
  30_000,
);

function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  for (const client of clients) client.close();
  if (error) {
    console.error(error);
    process.exitCode = 1;
  } else console.log(`Stock lifecycle smoke passed in room ${roomCode}`);
}

function connect(index, createRoom) {
  const client = new WebSocket(url, websocketOptions(url));
  clients.push(client);
  client.on("open", () =>
    client.send(
      JSON.stringify({
        type: "join",
        name: `Stock${index + 1}`,
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
        connect(1, false);
      }
    }
    if (message.type !== "snapshot") return;
    assert.equal(message.roomMode, "private");
    const mine = message.players.find(
      (player) => player.id === playerIds[index],
    );
    if (mine?.host && !rulesSent) {
      rulesSent = true;
      client.send(
        JSON.stringify({
          type: "updateRules",
          patch: { stocks: 1, matchDurationSeconds: 60 },
        }),
      );
    }

    const readyKey = `${stage}:${index}`;
    if (
      message.phase === "lobby" &&
      message.rules?.stocks === 1 &&
      !ready.has(readyKey)
    ) {
      ready.add(readyKey);
      client.send(JSON.stringify({ type: "ready", ready: true }));
    }
    const humans = message.players.filter((player) => !player.bot);
    if (
      index === 0 &&
      mine?.host &&
      message.phase === "lobby" &&
      humans.length === 2 &&
      humans.every((player) => player.ready) &&
      !startSent.has(stage)
    ) {
      startSent.add(stage);
      client.send(JSON.stringify({ type: "startMatch" }));
    }

    if (
      index === 1 &&
      message.phase === "playing" &&
      mine &&
      !movementSent.has(stage)
    ) {
      movementSent.add(stage);
      client.send(
        JSON.stringify({
          type: "input",
          sequence: stage + 1,
          moveX: 0,
          moveZ: mine.position.z >= 0 ? 1 : -1,
          yaw: 0,
          jump: false,
          dash: false,
          blocking: false,
          charging: false,
        }),
      );
    }

    const victim = message.players.find((player) => player.id === playerIds[1]);
    if (
      stage === 0 &&
      index === 0 &&
      message.phase === "results" &&
      victim?.eliminated &&
      victim.stocksRemaining === 0 &&
      !returnToLobbySent
    ) {
      returnToLobbySent = true;
      client.send(JSON.stringify({ type: "returnToLobby" }));
    }
    if (stage === 0 && returnToLobbySent && message.phase === "lobby") {
      stage = 1;
      assert.ok(
        message.players
          .filter((player) => !player.bot)
          .every((player) => !player.ready),
        "Returning to the lobby must reset readiness",
      );
    }

    if (stage === 1 && message.phase === "results" && !rematchSent.has(index)) {
      rematchSent.add(index);
      client.send(JSON.stringify({ type: "rematchVote", vote: true }));
    }
    if (
      stage === 1 &&
      rematchSent.size === 2 &&
      message.phase === "playing" &&
      message.players.every(
        (player) =>
          player.bot || (!player.eliminated && player.stocksRemaining === 1),
      )
    )
      finish();
  });
  client.on("error", finish);
}

connect(0, true);
