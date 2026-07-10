import { beforeEach, describe, expect, it } from "vitest";
import { defaultSettings, loadSettings, rebindKey, saveSettings } from "./settings";

let value: string | null = null;
beforeEach(() => {
  value = null;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
  }});
});

describe("persistent settings", () => {
  it("uses safe defaults for missing data", () => expect(loadSettings()).toEqual(defaultSettings));
  it("saves and restores user values", () => {
    const settings = { ...defaultSettings, sensitivity: 1.35, volume: 0.4, reducedMotion: true };
    saveSettings(settings);
    expect(loadSettings()).toEqual(settings);
  });
  it("clamps manipulated values", () => {
    value = JSON.stringify({ sensitivity: 99, volume: -2 });
    expect(loadSettings()).toMatchObject({ sensitivity: 2, volume: 0 });
  });
  it("swaps conflicting bindings instead of creating duplicates", () => {
    const bindings = rebindKey(defaultSettings.bindings, "forward", "KeyS");
    expect(bindings.forward).toBe("KeyS");
    expect(bindings.back).toBe("KeyW");
    expect(new Set(Object.values(bindings)).size).toBe(Object.keys(bindings).length);
  });
});
