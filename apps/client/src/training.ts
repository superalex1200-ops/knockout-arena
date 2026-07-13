import { TRAINING_MAX_KNOCKBACK, type TrainingBotMode } from "@knockout/shared";

export const TRAINING_PREFERENCES_KEY = "ko-training-v1";

export const TUTORIAL_ACTIONS = [
  "move",
  "look",
  "jump",
  "punch",
  "hit",
  "heavy",
  "dash",
  "block",
  "knockback",
  "knockout",
] as const;

export type TutorialAction = (typeof TUTORIAL_ACTIONS)[number];

export type TrainingPreferences = {
  tutorialDone: TutorialAction[];
  botMode: TrainingBotMode;
  baselineKnockback: number;
};

type TrainingStorage = Pick<Storage, "getItem" | "setItem">;

const BOT_MODES: readonly TrainingBotMode[] = [
  "static",
  "strafe",
  "aggressive",
  "blocking",
];

export const defaultTrainingPreferences: TrainingPreferences = {
  tutorialDone: [],
  botMode: "aggressive",
  baselineKnockback: 0,
};

const currentStorage = (): TrainingStorage | undefined => {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

const isTutorialAction = (value: unknown): value is TutorialAction =>
  typeof value === "string" &&
  (TUTORIAL_ACTIONS as readonly string[]).includes(value);

const isBotMode = (value: unknown): value is TrainingBotMode =>
  typeof value === "string" && (BOT_MODES as readonly string[]).includes(value);

const clampBaselineKnockback = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(TRAINING_MAX_KNOCKBACK, value))
    : defaultTrainingPreferences.baselineKnockback;

const normalizeTrainingPreferences = (
  value: Partial<TrainingPreferences> | null | undefined,
): TrainingPreferences => ({
  tutorialDone: Array.isArray(value?.tutorialDone)
    ? [...new Set(value.tutorialDone.filter(isTutorialAction))]
    : [],
  botMode: isBotMode(value?.botMode)
    ? value.botMode
    : defaultTrainingPreferences.botMode,
  baselineKnockback: clampBaselineKnockback(value?.baselineKnockback),
});

export function loadTrainingPreferences(
  storage: TrainingStorage | undefined = currentStorage(),
): TrainingPreferences {
  try {
    const raw = storage?.getItem(TRAINING_PREFERENCES_KEY);
    if (!raw) return { ...defaultTrainingPreferences, tutorialDone: [] };
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return { ...defaultTrainingPreferences, tutorialDone: [] };
    return normalizeTrainingPreferences(parsed as Partial<TrainingPreferences>);
  } catch {
    return { ...defaultTrainingPreferences, tutorialDone: [] };
  }
}

export function saveTrainingPreferences(
  preferences: TrainingPreferences,
  storage: TrainingStorage | undefined = currentStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      TRAINING_PREFERENCES_KEY,
      JSON.stringify(normalizeTrainingPreferences(preferences)),
    );
    return true;
  } catch {
    return false;
  }
}

export function markTutorialDone(
  preferences: TrainingPreferences,
  action: TutorialAction,
): TrainingPreferences {
  if (preferences.tutorialDone.includes(action)) return preferences;
  return {
    ...preferences,
    tutorialDone: [...preferences.tutorialDone, action],
  };
}

export function resetTutorialProgress(
  preferences: TrainingPreferences,
): TrainingPreferences {
  if (preferences.tutorialDone.length === 0) return preferences;
  return { ...preferences, tutorialDone: [] };
}
