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
});
