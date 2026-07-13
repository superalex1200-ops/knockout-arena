import WebSocket from "ws";
import { websocketOptions } from "./ws-origin.mjs";

const url = process.env.TEST_SERVER_URL ?? "ws://localhost:2567/ws";
const roomCode = `TR${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
const socket = new WebSocket(url, websocketOptions(url));
let sawMode = false,
  sawBot = false,
  sawApproach = false,
  sawAttack = false,
  initialDistance,
  joinedAt = 0,
  finished = false;
const timer = setTimeout(
  () =>
    finish(
      new Error("Timed out waiting for an authoritative training-bot hit"),
    ),
  15_000,
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

socket.on("open", () => {
  joinedAt = Date.now();
  socket.send(
    JSON.stringify({
      type: "join",
      name: "Trainee",
      roomCode,
      mode: "training",
      protocolVersion: 1,
      createRoom: true,
    }),
  );
});
socket.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.type === "snapshot") {
    if (!sawMode && message.trainingBotMode !== "aggressive")
      return finish(
        new Error(
          `Training should start in aggressive mode, got ${message.trainingBotMode}`,
        ),
      );
    sawMode = true;
    const bot = message.players.find((player) => player.bot);
    const human = message.players.find((player) => !player.bot);
    if (bot) sawBot = true;
    if (bot && human) {
      const distance = Math.hypot(
        bot.position.x - human.position.x,
        bot.position.z - human.position.z,
      );
      initialDistance ??= distance;
      if (distance < initialDistance - 0.35) sawApproach = true;
    }
  }
  if (message.type === "attack" && message.attackerId === "coach-bot") {
    if (Date.now() - joinedAt < 1_400)
      return finish(
        new Error("Training bot attacked during the opening grace"),
      );
    sawAttack = true;
  }
  if (
    message.type === "hit" &&
    message.attackerId === "coach-bot" &&
    sawMode &&
    sawBot &&
    sawApproach &&
    sawAttack
  )
    finish();
});
socket.on("error", finish);
