import assert from "node:assert/strict";
import WebSocket from "ws";
import { websocketOptions } from "./ws-origin.mjs";

const url = process.env.TEST_SERVER_URL ?? "ws://localhost:2567/ws";
const roomCode = `TR${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
const socket = new WebSocket(url, websocketOptions(url));
let sawMode = false,
  sawBot = false,
  sawApproach = false,
  sawAttack = false,
  sawBotHit = false,
  initialDistance,
  dummySpawn,
  playerId = "",
  inputSequence = 0,
  aimedInputSequence = 0,
  stage = "bot-combat",
  joinedAt = 0,
  finished = false;
const timer = setTimeout(
  () => finish(new Error(`Training Lab smoke timed out during ${stage}`)),
  22_000,
);

function send(message) {
  socket.send(JSON.stringify(message));
}

function sendMovement(human, bot, moveZ) {
  const dx = bot.position.x - human.position.x;
  const dz = bot.position.z - human.position.z;
  const yaw = Math.atan2(-dx, -dz);
  inputSequence = Math.max(inputSequence + 1, human.lastProcessedInput + 1);
  send({
    type: "input",
    sequence: inputSequence,
    moveX: 0,
    moveZ,
    yaw,
    pitch: 0,
    jump: false,
    dash: false,
    blocking: false,
    charging: false,
  });
  return yaw;
}

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
  send({
    type: "join",
    name: "Trainee",
    roomCode,
    mode: "training",
    protocolVersion: 1,
    createRoom: true,
  });
});
socket.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.type === "welcome") playerId = message.playerId;
  if (message.type === "snapshot") {
    if (!sawMode && message.trainingBotMode !== "aggressive")
      return finish(
        new Error(
          `Training should start in aggressive mode, got ${message.trainingBotMode}`,
        ),
      );
    sawMode = true;
    const bot = message.players.find((player) => player.bot);
    const human = message.players.find((player) => player.id === playerId);
    if (bot) sawBot = true;
    if (bot && !dummySpawn) dummySpawn = { ...bot.position };
    if (bot && human) {
      const distance = Math.hypot(
        bot.position.x - human.position.x,
        bot.position.z - human.position.z,
      );
      initialDistance ??= distance;
      if (distance < initialDistance - 0.35) sawApproach = true;

      if (stage === "lab-reset-acknowledged") {
        try {
          assert.equal(message.trainingBotMode, "static");
          assert.equal(message.training?.baselineKnockback, 100);
          assert.equal(message.training?.lastHit, null);
          assert.equal(bot.knockback, 100);
          assert.ok(dummySpawn, "Missing original dummy spawn");
          assert.ok(
            Math.hypot(
              bot.position.x - dummySpawn.x,
              bot.position.y - dummySpawn.y,
              bot.position.z - dummySpawn.z,
            ) < 0.05,
            "Dummy reset did not restore its training spawn",
          );
          assert.ok(
            Math.hypot(bot.velocity.x, bot.velocity.y, bot.velocity.z) < 0.05,
            "Dummy reset did not clear velocity",
          );
          stage = "drive-to-dummy";
        } catch (error) {
          return finish(error);
        }
      }

      if (stage === "drive-to-dummy") {
        if (distance > 2.05) sendMovement(human, bot, -1);
        else {
          sendMovement(human, bot, 0);
          aimedInputSequence = inputSequence;
          stage = "await-aim";
        }
      } else if (
        stage === "await-aim" &&
        human.lastProcessedInput >= aimedInputSequence
      ) {
        const yaw = Math.atan2(
          -(bot.position.x - human.position.x),
          -(bot.position.z - human.position.z),
        );
        send({
          type: "attack",
          kind: "light",
          charge: 0,
          yaw,
          pitch: 0,
          inputSequence: aimedInputSequence,
          clientTime: Date.now(),
        });
        stage = "await-player-hit";
      } else if (stage === "await-metrics" && message.training?.lastHit) {
        try {
          const metrics = message.training.lastHit;
          assert.equal(message.training.baselineKnockback, 100);
          assert.ok(metrics.force > 0, "Training force was not recorded");
          assert.ok(metrics.launchSpeed > 0, "Launch speed was not recorded");
          assert.ok(
            Number.isFinite(metrics.launchAngleDegrees),
            "Launch angle was not finite",
          );
          assert.ok(
            metrics.flightDistance > 0,
            "Flight distance did not update after the hit",
          );
          send({ type: "resetTraining" });
          stage = "await-final-reset";
        } catch (error) {
          return finish(error);
        }
      } else if (stage === "final-reset-acknowledged") {
        try {
          assert.equal(message.training?.baselineKnockback, 100);
          assert.equal(message.training?.lastHit, null);
          assert.equal(bot.knockback, 100);
          assert.ok(dummySpawn, "Missing original dummy spawn");
          assert.ok(
            Math.hypot(
              bot.position.x - dummySpawn.x,
              bot.position.y - dummySpawn.y,
              bot.position.z - dummySpawn.z,
            ) < 0.05,
            "Final reset did not restore the dummy spawn",
          );
          finish();
        } catch (error) {
          return finish(error);
        }
      }
    }
  }
  if (message.type === "attack" && message.attackerId === "coach-bot") {
    if (Date.now() - joinedAt < 1_400)
      return finish(
        new Error("Training bot attacked during the opening grace"),
      );
    sawAttack = true;
  }
  if (message.type === "notice" && message.text.includes("DUMMY")) {
    if (stage === "await-lab-reset") stage = "lab-reset-acknowledged";
    else if (stage === "await-final-reset") stage = "final-reset-acknowledged";
  }
  if (
    message.type === "hit" &&
    message.attackerId === "coach-bot" &&
    sawMode &&
    sawBot &&
    sawApproach &&
    sawAttack
  ) {
    sawBotHit = true;
    send({ type: "setTrainingBotMode", mode: "static" });
    send({ type: "setTrainingKnockback", value: 100 });
    send({ type: "resetTraining" });
    stage = "await-lab-reset";
  }
  if (
    message.type === "hit" &&
    message.attackerId === playerId &&
    message.victimId === "coach-bot" &&
    sawBotHit &&
    stage === "await-player-hit"
  )
    stage = "await-metrics";
});
socket.on("error", finish);
