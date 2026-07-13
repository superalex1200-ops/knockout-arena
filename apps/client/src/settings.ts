export type KeyAction =
  "forward" | "back" | "left" | "right" | "jump" | "dash" | "block";

export type KeyBindings = Record<KeyAction, string>;

export type GameSettings = {
  sensitivity: number;
  volume: number;
  reducedMotion: boolean;
  invertY: boolean;
  fov: number;
  bindings: KeyBindings;
  graphics: "low" | "medium" | "high";
};

type MatchMedia = (query: string) => { matches: boolean };

export const defaultBindings: KeyBindings = {
  forward: "KeyW",
  back: "KeyS",
  left: "KeyA",
  right: "KeyD",
  jump: "Space",
  dash: "ShiftLeft",
  block: "KeyQ",
};

export const defaultSettings: GameSettings = {
  sensitivity: 1,
  volume: 0.75,
  reducedMotion: false,
  invertY: false,
  fov: 76,
  bindings: defaultBindings,
  graphics: "high",
};

export function prefersReducedMotion(matchMedia?: MatchMedia): boolean {
  const query =
    matchMedia ??
    (typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia.bind(window)
      : undefined);
  try {
    return query?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

export function loadSettings(matchMedia?: MatchMedia): GameSettings {
  try {
    const stored = JSON.parse(
      localStorage.getItem("ko-settings") ?? "{}",
    ) as Partial<GameSettings>;
    const sensitivity = Number(stored.sensitivity);
    const volume = Number(stored.volume);
    const fov = Number(stored.fov);
    return {
      sensitivity: Number.isFinite(sensitivity)
        ? clamp(sensitivity, 0.35, 2)
        : defaultSettings.sensitivity,
      volume: Number.isFinite(volume)
        ? clamp(volume, 0, 1)
        : defaultSettings.volume,
      reducedMotion:
        typeof stored.reducedMotion === "boolean"
          ? stored.reducedMotion
          : prefersReducedMotion(matchMedia),
      invertY:
        typeof stored.invertY === "boolean"
          ? stored.invertY
          : defaultSettings.invertY,
      fov: Number.isFinite(fov) ? clamp(fov, 75, 110) : defaultSettings.fov,
      bindings: Object.fromEntries(
        Object.entries(defaultBindings).map(([action, fallback]) => [
          action,
          typeof stored.bindings?.[action as KeyAction] === "string"
            ? stored.bindings[action as KeyAction]
            : fallback,
        ]),
      ) as KeyBindings,
      graphics:
        stored.graphics === "low" ||
        stored.graphics === "medium" ||
        stored.graphics === "high"
          ? stored.graphics
          : defaultSettings.graphics,
    };
  } catch {
    return {
      ...defaultSettings,
      reducedMotion: prefersReducedMotion(matchMedia),
    };
  }
}

export function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem("ko-settings", JSON.stringify(settings));
  } catch {
    /* Keep in-memory settings. */
  }
}

export function formatKey(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return (
    (
      {
        Space: "LEERTASTE",
        ShiftLeft: "L-SHIFT",
        ShiftRight: "R-SHIFT",
        ControlLeft: "L-STRG",
        ControlRight: "R-STRG",
        Mouse0: "LMB",
        Mouse2: "RMB",
      } as Record<string, string>
    )[code] ?? code.toUpperCase()
  );
}

export function rebindKey(
  bindings: KeyBindings,
  action: KeyAction,
  code: string,
): KeyBindings {
  const next = { ...bindings };
  const conflict = (Object.keys(next) as KeyAction[]).find(
    (candidate) => candidate !== action && next[candidate] === code,
  );
  if (conflict) next[conflict] = next[action];
  next[action] = code;
  return next;
}
