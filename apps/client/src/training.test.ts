import { describe, expect, it } from "vitest";
import { TRAINING_MAX_KNOCKBACK } from "@knockout/shared";
import {
  defaultTrainingPreferences,
  loadTrainingPreferences,
  markTutorialDone,
  resetTutorialProgress,
  saveTrainingPreferences,
  TRAINING_PREFERENCES_KEY,
} from "./training";

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
};

describe("training preferences", () => {
  it("returns isolated defaults for missing or malformed data", () => {
    const storage = memoryStorage();
    const first = loadTrainingPreferences(storage);
    first.tutorialDone.push("move");

    expect(loadTrainingPreferences(storage)).toEqual(
      defaultTrainingPreferences,
    );

    storage.setItem(TRAINING_PREFERENCES_KEY, "not-json");
    expect(loadTrainingPreferences(storage)).toEqual(
      defaultTrainingPreferences,
    );
    storage.setItem(TRAINING_PREFERENCES_KEY, "[]");
    expect(loadTrainingPreferences(storage)).toEqual(
      defaultTrainingPreferences,
    );
  });

  it("saves and restores valid preferences", () => {
    const storage = memoryStorage();
    const preferences = {
      tutorialDone: ["move", "look", "hit"] as const,
      botMode: "blocking" as const,
      baselineKnockback: 125,
    };

    expect(
      saveTrainingPreferences(
        { ...preferences, tutorialDone: [...preferences.tutorialDone] },
        storage,
      ),
    ).toBe(true);
    expect(loadTrainingPreferences(storage)).toEqual(preferences);
  });

  it("filters unknown and duplicate steps and validates manipulated fields", () => {
    const storage = memoryStorage();
    storage.setItem(
      TRAINING_PREFERENCES_KEY,
      JSON.stringify({
        tutorialDone: ["move", "admin", "move", 42, "knockout"],
        botMode: "aimbot",
        baselineKnockback: TRAINING_MAX_KNOCKBACK + 999,
      }),
    );

    expect(loadTrainingPreferences(storage)).toEqual({
      tutorialDone: ["move", "knockout"],
      botMode: "aggressive",
      baselineKnockback: TRAINING_MAX_KNOCKBACK,
    });

    storage.setItem(
      TRAINING_PREFERENCES_KEY,
      JSON.stringify({ baselineKnockback: -50 }),
    );
    expect(loadTrainingPreferences(storage).baselineKnockback).toBe(0);
  });

  it("marks tutorial actions idempotently and resets only the progress", () => {
    const once = markTutorialDone(defaultTrainingPreferences, "dash");
    const twice = markTutorialDone(once, "dash");

    expect(once.tutorialDone).toEqual(["dash"]);
    expect(twice).toBe(once);
    expect(resetTutorialProgress(once)).toEqual({
      ...defaultTrainingPreferences,
      tutorialDone: [],
    });
    expect(resetTutorialProgress(defaultTrainingPreferences)).toBe(
      defaultTrainingPreferences,
    );
  });

  it("survives unavailable storage without throwing", () => {
    const unavailable = {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: () => {
        throw new Error("storage disabled");
      },
    };

    expect(loadTrainingPreferences(unavailable)).toEqual(
      defaultTrainingPreferences,
    );
    expect(
      saveTrainingPreferences(defaultTrainingPreferences, unavailable),
    ).toBe(false);
  });
});
