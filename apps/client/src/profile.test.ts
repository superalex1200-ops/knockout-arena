import { beforeEach, describe, expect, it } from "vitest";
import { emptyProfile, loadProfile, recordMatch, type MatchHistoryEntry } from "./profile";

let value: string | null = null;
beforeEach(() => {
  value = null;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
  }});
});

const match: MatchHistoryEntry = { matchId: "m1", playedAt: "2026-07-10T20:00:00.000Z", mode: "private", roomCode: "ABC123", durationSeconds: 180, placement: 1, playerCount: 2, kos: 4, assists: 1, falls: 2 };

describe("guest profile", () => {
  it("records aggregate stats and history", () => {
    const profile = recordMatch(emptyProfile, match);
    expect(profile).toMatchObject({ matches: 1, wins: 1, kos: 4, assists: 1, falls: 2 });
    expect(loadProfile().history[0]?.matchId).toBe("m1");
  });
  it("does not count the same match twice", () => {
    const once = recordMatch(emptyProfile, match);
    expect(recordMatch(once, match)).toBe(once);
  });
});
