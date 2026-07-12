import { describe, expect, it } from "vitest";
import { parseClientMessage } from "./protocol.js";

describe("client protocol validation", () => {
  it("rejects malformed JSON and non-object payloads", () => {
    expect(parseClientMessage("{")).toBeUndefined();
    expect(parseClientMessage("null")).toBeUndefined();
    expect(parseClientMessage("42")).toBeUndefined();
    expect(parseClientMessage('"attack"')).toBeUndefined();
  });

  it("rejects non-finite or structurally invalid simulation inputs", () => {
    expect(
      parseClientMessage(
        JSON.stringify({
          type: "input",
          sequence: 1,
          moveX: "fast",
          moveZ: 0,
          yaw: 0,
          jump: false,
          dash: false,
          blocking: false,
          charging: false,
        }),
      ),
    ).toBeUndefined();
    expect(
      parseClientMessage(
        JSON.stringify({
          type: "attack",
          kind: "instant-kill",
          charge: 1,
          yaw: 0,
          clientTime: Date.now(),
        }),
      ),
    ).toBeUndefined();
  });

  it("accepts a valid join and clamps gameplay values later in simulation", () => {
    expect(
      parseClientMessage(
        JSON.stringify({
          type: "join",
          name: "Rookie",
          roomCode: "ABC123",
          mode: "private",
          protocolVersion: 1,
          createRoom: true,
        }),
      ),
    ).toMatchObject({ type: "join", roomCode: "ABC123" });
  });

  it("accepts ordered aim input and rejects invalid aim metadata", () => {
    expect(
      parseClientMessage(
        JSON.stringify({
          type: "input",
          sequence: 7,
          moveX: 0,
          moveZ: -1,
          yaw: 0.4,
          pitch: -0.3,
          jump: false,
          dash: false,
          blocking: false,
          charging: false,
        }),
      ),
    ).toMatchObject({ type: "input", sequence: 7, pitch: -0.3 });
    expect(
      parseClientMessage(
        JSON.stringify({
          type: "attack",
          kind: "light",
          charge: 0,
          yaw: 0.4,
          pitch: -0.3,
          inputSequence: 7,
          clientTime: Date.now(),
        }),
      ),
    ).toMatchObject({ type: "attack", inputSequence: 7 });
    expect(
      parseClientMessage(
        JSON.stringify({
          type: "attack",
          kind: "light",
          charge: 0,
          yaw: 0,
          inputSequence: 1.5,
          clientTime: Date.now(),
        }),
      ),
    ).toBeUndefined();
  });
});
