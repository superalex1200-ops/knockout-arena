import assert from "node:assert/strict";
import WebSocket from "ws";

const url = process.env.TEST_SERVER_URL ?? "ws://localhost:2567/ws";
const roomCode = `D${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const socket = new WebSocket(url);
let playerId = "";
let stage = 0;
let finished = false;

const timeout = setTimeout(
  () => finish(new Error("Defense exploit regression timed out")),
  8_000,
);

function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  socket.close();
  if (error) {
    console.error(error);
    process.exitCode = 1;
  } else console.log(`Defense exploit smoke passed in room ${roomCode}`);
}

socket.on("open", () =>
  socket.send(
    JSON.stringify({
      type: "join",
      name: "DefenseSmoke",
      roomCode,
      mode: "training",
      protocolVersion: 1,
      createRoom: true,
    }),
  ),
);

socket.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.type === "welcome") playerId = message.playerId;
  if (message.type === "snapshot" && playerId) {
    const local = message.players.find((player) => player.id === playerId);
    if (stage === 0 && local) {
      stage = 1;
      socket.send(
        JSON.stringify({
          type: "input",
          sequence: 1,
          moveX: 0,
          moveZ: 0,
          yaw: 0,
          jump: false,
          dash: false,
          blocking: true,
          charging: true,
        }),
      );
    } else if (
      stage === 1 &&
      local?.lastProcessedInput >= 1 &&
      !local.blocking &&
      !local.charging
    ) {
      stage = 2;
      socket.send(
        JSON.stringify({
          type: "input",
          sequence: 2,
          moveX: 0,
          moveZ: 0,
          yaw: 0,
          jump: false,
          dash: false,
          blocking: false,
          charging: true,
        }),
      );
      setTimeout(
        () =>
          socket.send(
            JSON.stringify({
              type: "attack",
              kind: "heavy",
              charge: 1,
              yaw: 0,
              clientTime: Date.now(),
            }),
          ),
        300,
      );
    }
  }
  if (message.type === "attack" && message.attackerId === playerId) {
    try {
      assert.ok(message.charge < 0.5, `Server trusted ${message.charge}`);
      finish();
    } catch (error) {
      finish(error);
    }
  }
});
socket.on("error", finish);
