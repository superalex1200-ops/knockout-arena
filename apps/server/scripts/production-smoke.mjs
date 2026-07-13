import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import WebSocket from "ws";
import { websocketOptions } from "./ws-origin.mjs";

const root = resolve(import.meta.dirname, "../../..");
const port = 31_000 + Math.floor(Math.random() * 2_000);
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["apps/server/dist/index.js"], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    CLIENT_DIST: resolve(root, "apps/client/dist"),
    CLIENT_ORIGIN: origin,
    TRUST_PROXY: "false",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
server.stderr.on("data", (chunk) => {
  stderr += chunk;
});

async function waitForHealth() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return;
    } catch {
      /* server is still starting */
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Production server did not become healthy: ${stderr}`);
}

async function verifyWebSocket() {
  await new Promise((resolveSocket, reject) => {
    const socketUrl = `ws://127.0.0.1:${port}/ws`;
    const socket = new WebSocket(socketUrl, websocketOptions(socketUrl));
    const timeout = setTimeout(
      () => reject(new Error("Same-origin WebSocket timed out")),
      8_000,
    );
    socket.on("open", () => {
      socket.send("null");
      socket.send(
        JSON.stringify({
          type: "join",
          name: "ProductionSmoke",
          roomCode: "PRODSM",
          mode: "training",
          protocolVersion: 1,
          createRoom: true,
        }),
      );
    });
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (
        message.type !== "snapshot" ||
        !message.players.some((player) => player.bot)
      )
        return;
      clearTimeout(timeout);
      socket.close();
      resolveSocket();
    });
    socket.on("error", reject);
  });
}

async function verifyWrongOriginRejected() {
  await new Promise((resolveSocket, reject) => {
    const socketUrl = `ws://127.0.0.1:${port}/ws`;
    const socket = new WebSocket(
      socketUrl,
      websocketOptions(socketUrl, "https://cross-origin.invalid"),
    );
    const timeout = setTimeout(
      () => reject(new Error("Cross-origin WebSocket was not rejected")),
      3_000,
    );
    socket.on("open", () => {
      clearTimeout(timeout);
      socket.close();
      reject(new Error("Cross-origin WebSocket unexpectedly opened"));
    });
    socket.on("unexpected-response", (_request, response) => {
      try {
        assert.equal(response.statusCode, 403);
        clearTimeout(timeout);
        response.resume();
        resolveSocket();
      } catch (error) {
        reject(error);
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function verifyMessageRateLimit() {
  await new Promise((resolveSocket, reject) => {
    const socketUrl = `ws://127.0.0.1:${port}/ws`;
    const socket = new WebSocket(socketUrl, websocketOptions(socketUrl));
    const timeout = setTimeout(
      () => reject(new Error("Message-rate limiter did not close the socket")),
      4_000,
    );
    socket.on("open", () => {
      for (let index = 0; index < 220; index++) socket.send("null");
    });
    socket.on("close", (code) => {
      try {
        assert.equal(code, 1008);
        clearTimeout(timeout);
        resolveSocket();
      } catch (error) {
        reject(error);
      }
    });
    socket.on("error", reject);
  });
}

async function verifyJoinError(payload, expectedCode) {
  await new Promise((resolveSocket, reject) => {
    const socketUrl = `ws://127.0.0.1:${port}/ws`;
    const socket = new WebSocket(socketUrl, websocketOptions(socketUrl));
    const timeout = setTimeout(
      () => reject(new Error(`Expected join error ${expectedCode}`)),
      3_000,
    );
    socket.on("open", () => socket.send(JSON.stringify(payload)));
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type !== "joinError") return;
      try {
        assert.equal(message.code, expectedCode);
        clearTimeout(timeout);
        socket.close();
        resolveSocket();
      } catch (error) {
        reject(error);
      }
    });
    socket.on("error", reject);
  });
}

async function verifyDefenseExploitIsClosed() {
  await new Promise((resolveSocket, reject) => {
    const socketUrl = `ws://127.0.0.1:${port}/ws`;
    const socket = new WebSocket(socketUrl, websocketOptions(socketUrl));
    const roomCode = `D${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    let playerId = "";
    let stage = 0;
    const timeout = setTimeout(
      () => reject(new Error("Defense exploit regression timed out")),
      6_000,
    );
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
          local &&
          local.lastProcessedInput >= 1 &&
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
          assert.ok(
            message.charge < 0.5,
            `Server trusted forged charge ${message.charge}`,
          );
          clearTimeout(timeout);
          socket.close();
          resolveSocket();
        } catch (error) {
          reject(error);
        }
      }
    });
    socket.on("error", reject);
  });
}

try {
  await waitForHealth();
  const rootResponse = await fetch(`${origin}/`);
  assert.equal(rootResponse.status, 200);
  assert.match(rootResponse.headers.get("content-type") ?? "", /^text\/html/);
  const html = await rootResponse.text();
  const assetPath = html.match(/src="([^"]+\.js)"/)?.[1];
  assert.ok(assetPath, "Built JavaScript asset was not referenced");
  const assetResponse = await fetch(`${origin}${assetPath}`);
  assert.equal(assetResponse.status, 200);
  assert.match(assetResponse.headers.get("cache-control") ?? "", /immutable/);
  const bundle = await assetResponse.text();
  assert.equal(
    bundle.includes("ws://localhost"),
    false,
    "Production bundle contains a localhost WebSocket URL",
  );
  const inviteResponse = await fetch(`${origin}/invite/ABC123`);
  assert.equal(inviteResponse.status, 200, "SPA fallback route failed");
  await verifyWrongOriginRejected();
  await verifyWebSocket();
  await verifyJoinError(
    {
      type: "join",
      name: "OldClient",
      roomCode: "OLD123",
      mode: "private",
      protocolVersion: 0,
      createRoom: true,
    },
    "VERSION_MISMATCH",
  );
  await verifyJoinError(
    {
      type: "join",
      name: "MissingRoom",
      roomCode: "NOPE99",
      mode: "private",
      protocolVersion: 1,
    },
    "ROOM_NOT_FOUND",
  );
  await verifyDefenseExploitIsClosed();
  await verifyMessageRateLimit();
  console.log(`Production smoke passed on one HTTP/WebSocket origin (${port})`);
} finally {
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => server.once("exit", resolveExit)),
    new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000)),
  ]);
}
