import WebSocket from "ws";

const url = process.env.TEST_SERVER_URL ?? "ws://localhost:2567/ws";
const roomCode = `R${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
let firstId = "",
  token = "",
  finished = false;
let firstAcked = false;

const failTimer = setTimeout(
  () => finish(new Error("Timed out waiting for reconnect")),
  6_000,
);
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(failTimer);
  if (error) {
    console.error(error);
    process.exitCode = 1;
  } else
    console.log(
      `Reconnect smoke passed: ${firstId} retained in room ${roomCode}`,
    );
}

const first = new WebSocket(url);
first.on("open", () =>
  first.send(
    JSON.stringify({
      type: "join",
      name: "ReconnectTest",
      roomCode,
      mode: "private",
      protocolVersion: 1,
      createRoom: true,
    }),
  ),
);
first.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.type === "welcome") {
    firstId = message.playerId;
    token = message.reconnectToken;
    first.send(
      JSON.stringify({
        type: "input",
        sequence: 5,
        moveX: 0,
        moveZ: -1,
        yaw: 0,
        jump: false,
        dash: false,
        blocking: false,
        charging: false,
      }),
    );
  }
  if (
    message.type === "snapshot" &&
    message.players.find((player) => player.id === firstId)
      ?.lastProcessedInput === 5 &&
    !firstAcked
  ) {
    firstAcked = true;
    first.close();
    setTimeout(connectAgain, 150);
  }
});
first.on("error", finish);

function connectAgain() {
  const second = new WebSocket(url);
  second.on("open", () =>
    second.send(
      JSON.stringify({
        type: "join",
        name: "ReconnectTest",
        roomCode,
        mode: "private",
        protocolVersion: 1,
        reconnectToken: token,
      }),
    ),
  );
  second.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === "welcome") {
      if (message.playerId !== firstId)
        finish(new Error(`Expected ${firstId}, received ${message.playerId}`));
      else if (message.lastProcessedInput !== 5)
        finish(
          new Error(
            `Expected input base 5, received ${message.lastProcessedInput}`,
          ),
        );
      else
        second.send(
          JSON.stringify({
            type: "input",
            sequence: 6,
            moveX: 1,
            moveZ: 0,
            yaw: 0,
            jump: false,
            dash: true,
            blocking: false,
            charging: false,
          }),
        );
    }
    if (
      message.type === "snapshot" &&
      message.players.find((player) => player.id === firstId)
        ?.lastProcessedInput === 6
    ) {
      second.close();
      finish();
    }
  });
  second.on("error", finish);
}
