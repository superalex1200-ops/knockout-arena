import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultSettings,
  loadSettings,
  prefersReducedMotion,
  rebindKey,
  saveSettings,
} from "./settings";

let value: string | null = null;
beforeEach(() => {
  value = null;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => value,
      setItem: (_key: string, next: string) => {
        value = next;
      },
    },
  });
});

describe("persistent settings", () => {
  it("uses safe defaults for missing data", () =>
    expect(loadSettings()).toEqual(defaultSettings));

  it("saves and restores user values", () => {
    const settings = {
      ...defaultSettings,
      sensitivity: 1.35,
      volume: 0.4,
      reducedMotion: true,
      invertY: true,
      fov: 102,
    };
    saveSettings(settings);
    expect(loadSettings()).toEqual(settings);
  });

  it("clamps manipulated values, including field of view", () => {
    value = JSON.stringify({ sensitivity: 99, volume: -2, fov: 999 });
    expect(loadSettings()).toMatchObject({
      sensitivity: 2,
      volume: 0,
      fov: 110,
    });
  });

  it("uses the operating-system motion preference for legacy settings", () => {
    expect(loadSettings(() => ({ matches: true })).reducedMotion).toBe(true);
    value = JSON.stringify({ reducedMotion: false });
    expect(loadSettings(() => ({ matches: true })).reducedMotion).toBe(false);
  });

  it("safely detects reduced-motion media queries", () => {
    expect(prefersReducedMotion(() => ({ matches: true }))).toBe(true);
    expect(prefersReducedMotion(() => ({ matches: false }))).toBe(false);
    expect(
      prefersReducedMotion(() => {
        throw new Error("media queries unavailable");
      }),
    ).toBe(false);
  });

  it("swaps conflicting bindings instead of creating duplicates", () => {
    const bindings = rebindKey(defaultSettings.bindings, "forward", "KeyS");
    expect(bindings.forward).toBe("KeyS");
    expect(bindings.back).toBe("KeyW");
    expect(new Set(Object.values(bindings)).size).toBe(
      Object.keys(bindings).length,
    );
  });
});
