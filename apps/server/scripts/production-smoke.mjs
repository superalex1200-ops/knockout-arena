import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import WebSocket from "ws";

const root = resolve(import.meta.dirname, "../../..");
const port = 31_000 + Math.floor(Math.random() * 2_000);
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["apps/server/dist/index.js"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    CLIENT_DIST: resolve(root, "apps/client/dist"),
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
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
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

async function verifyJoinError(payload, expectedCode) {
  await new Promise((resolveSocket, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
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
  console.log(`Production smoke passed on one HTTP/WebSocket origin (${port})`);
} finally {
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => server.once("exit", resolveExit)),
    new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000)),
  ]);
}
