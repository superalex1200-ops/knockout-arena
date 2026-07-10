import WebSocket from "ws";

const url = process.env.TEST_SERVER_URL ?? "ws://localhost:2567/ws";
const roomCode = `TR${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
const socket = new WebSocket(url);
let sawMode = false, sawBot = false, finished = false;
const timer = setTimeout(() => finish(new Error("Timed out waiting for an authoritative training-bot hit")), 12_000);

function finish(error) {
  if (finished) return;
  finished = true; clearTimeout(timer); socket.close();
  if (error) { console.error(error); process.exitCode = 1; }
  else console.log(`Training bot smoke passed in room ${roomCode}`);
}

socket.on("open", () => socket.send(JSON.stringify({ type: "join", name: "Trainee", roomCode, mode: "training" })));
socket.on("message", raw => {
  const message = JSON.parse(raw.toString());
  if (message.type === "snapshot") {
    if (message.trainingBotMode === "aggressive") sawMode = true;
    if (message.players.some(player => player.bot)) sawBot = true;
  }
  if (message.type === "hit" && message.attackerId === "coach-bot" && sawMode && sawBot) finish();
});
socket.on("error", finish);
