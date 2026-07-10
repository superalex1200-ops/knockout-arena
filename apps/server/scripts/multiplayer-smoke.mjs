import WebSocket from "ws";

const url = process.env.TEST_SERVER_URL ?? "ws://localhost:2567/ws";
const roomCode = `T${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const clients = [new WebSocket(url), new WebSocket(url)];
const ids = new Set();
const playerIds = [];
const rulesSeenBy = new Set();
const readySent = new Set();
let rulesSent = false;
let sawCountdown = false;
let sawChat = false;
let sawPong = false;
let sawSequenceGuard = false;
let resolved = false;

const finish = (error) => {
  if (resolved) return;
  resolved = true;
  for (const client of clients) client.close();
  if (error) {
    console.error(error);
    process.exitCode = 1;
  } else
    console.log(
      `Multiplayer smoke passed: room ${roomCode}, ${ids.size} replicated players`,
    );
};

clients.forEach((client, index) => {
  client.on("open", () =>
    client.send(
      JSON.stringify({
        type: "join",
        name: `Test${index + 1}`,
        roomCode,
        mode: "private",
        protocolVersion: 1,
        createRoom: index === 0,
      }),
    ),
  );
  client.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === "welcome") {
      ids.add(message.playerId);
      playerIds[index] = message.playerId;
      if (index === 0) {
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
          }),
        );
      }
    }
    if (message.type === "chat" && message.text === "Multiplayer smoke")
      sawChat = true;
    if (message.type === "pong" && message.clientTime === 12345) sawPong = true;
    if (message.type === "snapshot") {
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
    }
    if (message.type === "snapshot" && message.phase === "countdown")
      sawCountdown = true;
    if (
      message.type === "snapshot" &&
      message.phase === "playing" &&
      sawCountdown &&
      sawChat &&
      sawPong &&
      sawSequenceGuard &&
      rulesSeenBy.size === 2 &&
      message.players.every((player) => player.stocksRemaining === 5) &&
      new Set(
        message.players
          .filter((player) => !player.bot)
          .map((player) => player.team),
      ).size === 2 &&
      message.players.filter((player) => !player.bot).length === 2 &&
      ids.size === 2
    )
      finish();
  });
  client.on("error", (error) => finish(error));
});

setTimeout(
  () =>
    finish(
      new Error(
        "Timed out waiting for lobby countdown and two replicated players",
      ),
    ),
  8_000,
);
