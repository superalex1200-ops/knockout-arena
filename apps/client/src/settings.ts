export type KeyAction = "forward" | "back" | "left" | "right" | "jump" | "dash" | "block";
export type KeyBindings = Record<KeyAction, string>;
export type GameSettings = {
  sensitivity: number;
  volume: number;
  reducedMotion: boolean;
  bindings: KeyBindings;
  graphics: "low" | "medium" | "high";
};

export const defaultBindings: KeyBindings = { forward: "KeyW", back: "KeyS", left: "KeyA", right: "KeyD", jump: "Space", dash: "ShiftLeft", block: "KeyQ" };
export const defaultSettings: GameSettings = { sensitivity: 1, volume: 0.75, reducedMotion: false, bindings: defaultBindings, graphics: "high" };

export function loadSettings(): GameSettings {
  try {
    const stored = JSON.parse(localStorage.getItem("ko-settings") ?? "{}") as Partial<GameSettings>;
    return {
      sensitivity: Math.max(0.35, Math.min(2, Number(stored.sensitivity) || defaultSettings.sensitivity)),
      volume: Math.max(0, Math.min(1, Number.isFinite(stored.volume) ? Number(stored.volume) : defaultSettings.volume)),
      reducedMotion: Boolean(stored.reducedMotion),
      bindings: Object.fromEntries(Object.entries(defaultBindings).map(([action, fallback]) => [action, typeof stored.bindings?.[action as KeyAction] === "string" ? stored.bindings[action as KeyAction] : fallback])) as KeyBindings,
      graphics: stored.graphics === "low" || stored.graphics === "medium" || stored.graphics === "high" ? stored.graphics : defaultSettings.graphics,
    };
  } catch { return defaultSettings; }
}

export function saveSettings(settings: GameSettings): void { try { localStorage.setItem("ko-settings", JSON.stringify(settings)); } catch { /* Keep in-memory settings. */ } }

export function formatKey(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return ({ Space: "LEERTASTE", ShiftLeft: "L-SHIFT", ShiftRight: "R-SHIFT", ControlLeft: "L-STRG", ControlRight: "R-STRG", Mouse0: "LMB", Mouse2: "RMB" } as Record<string, string>)[code] ?? code.toUpperCase();
}

export function rebindKey(bindings: KeyBindings, action: KeyAction, code: string): KeyBindings {
  const next = { ...bindings };
  const conflict = (Object.keys(next) as KeyAction[]).find(candidate => candidate !== action && next[candidate] === code);
  if (conflict) next[conflict] = next[action];
  next[action] = code;
  return next;
}
