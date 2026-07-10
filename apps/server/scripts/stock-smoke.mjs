import WebSocket from "ws";

const url = process.env.TEST_SERVER_URL ?? "ws://localhost:2567/ws";
const roomCode = `S${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const clients = [new WebSocket(url), new WebSocket(url)];
const playerIds = [];
const ready = new Set();
let rulesSent = false,
  movementSent = false,
  finished = false;
const timer = setTimeout(
  () => finish(new Error("Timed out waiting for stock elimination")),
  14_000,
);

function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  for (const client of clients) client.close();
  if (error) {
    console.error(error);
    process.exitCode = 1;
  } else console.log(`Stock smoke passed in room ${roomCode}`);
}

clients.forEach((client, index) => {
  client.on("open", () =>
    client.send(
      JSON.stringify({
        type: "join",
        name: `Stock${index + 1}`,
        roomCode,
        mode: "private",
        protocolVersion: 1,
        createRoom: index === 0,
      }),
    ),
  );
  client.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === "welcome") playerIds[index] = message.playerId;
    if (message.type !== "snapshot") return;
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
    if (message.rules?.stocks === 1 && !ready.has(index)) {
      ready.add(index);
      client.send(JSON.stringify({ type: "ready", ready: true }));
    }
    if (index === 1 && message.phase === "playing" && !movementSent && mine) {
      movementSent = true;
      client.send(
        JSON.stringify({
          type: "input",
          sequence: 1,
          moveX: 0,
          moveZ: mine.position.z >= 0 ? 1 : -1,
          yaw: 0,
          jump: false,
          dash: false,
          blocking: false,
        }),
      );
    }
    const victim = message.players.find((player) => player.id === playerIds[1]);
    const winner = message.players.find((player) => player.id === playerIds[0]);
    if (
      message.phase === "results" &&
      victim?.eliminated &&
      victim.stocksRemaining === 0 &&
      winner &&
      !winner.eliminated
    )
      finish();
  });
  client.on("error", finish);
});
