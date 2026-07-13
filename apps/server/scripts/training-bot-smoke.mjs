import WebSocket from "ws";
import { websocketOptions } from "./ws-origin.mjs";

const url = process.env.TEST_SERVER_URL ?? "ws://localhost:2567/ws";
const roomCode = `TR${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
const socket = new WebSocket(url, websocketOptions(url));
let sawMode = false,
  sawStaticMode = false,
  sawBot = false,
  sawAttack = false,
  requestedAggressiveMode = false,
  finished = false;
const timer = setTimeout(
  () =>
    finish(
      new Error("Timed out waiting for an authoritative training-bot hit"),
    ),
  12_000,
);

function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  socket.close();
  if (error) {
    console.error(error);
    process.exitCode = 1;
  } else console.log(`Training bot smoke passed in room ${roomCode}`);
}

socket.on("open", () =>
  socket.send(
    JSON.stringify({
      type: "join",
      name: "Trainee",
      roomCode,
      mode: "training",
      protocolVersion: 1,
      createRoom: true,
    }),
  ),
);
socket.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.type === "snapshot") {
    if (message.trainingBotMode === "static" && !requestedAggressiveMode) {
      sawStaticMode = true;
      requestedAggressiveMode = true;
      socket.send(
        JSON.stringify({ type: "setTrainingBotMode", mode: "aggressive" }),
      );
    }
    if (message.trainingBotMode === "aggressive") sawMode = true;
    if (message.players.some((player) => player.bot)) sawBot = true;
  }
  if (message.type === "attack" && message.attackerId === "coach-bot")
    sawAttack = true;
  if (
    message.type === "hit" &&
    message.attackerId === "coach-bot" &&
    sawStaticMode &&
    sawMode &&
    sawBot &&
    sawAttack
  )
    finish();
});
socket.on("error", finish);
