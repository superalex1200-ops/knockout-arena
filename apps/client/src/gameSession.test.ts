import { describe, expect, it } from "vitest";
import {
  clearGameSession,
  loadActiveGameSession,
  loadReconnectToken,
  saveGameSession,
} from "./gameSession";

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
};

describe("tab-scoped game session", () => {
  it("restores the authoritative room and reconnect token", () => {
    const storage = memoryStorage();
    expect(
      saveGameSession("private", "ab12cd", "reconnect-token", storage),
    ).toBe(true);
    expect(loadActiveGameSession(storage)).toEqual({
      mode: "private",
      code: "AB12CD",
      createRoom: false,
    });
    expect(loadReconnectToken("private", "AB12CD", storage)).toBe(
      "reconnect-token",
    );
  });

  it("does not reuse a token for another mode or room", () => {
    const storage = memoryStorage();
    saveGameSession("private", "ABC123", "reconnect-token", storage);
    expect(loadReconnectToken("quick", "ABC123", storage)).toBe("");
    expect(loadReconnectToken("private", "XYZ789", storage)).toBe("");
  });

  it("rejects manipulated storage and clears both records on leave", () => {
    const storage = memoryStorage();
    storage.setItem("ko-active-session", '{"mode":"admin","code":"ABC123"}');
    storage.setItem("ko-reconnect", "not-json");
    expect(loadActiveGameSession(storage)).toBeUndefined();
    expect(loadReconnectToken("private", "ABC123", storage)).toBe("");

    saveGameSession("training", "T23456", "training-token", storage);
    clearGameSession(storage);
    expect(loadActiveGameSession(storage)).toBeUndefined();
    expect(loadReconnectToken("training", "T23456", storage)).toBe("");
  });
});
