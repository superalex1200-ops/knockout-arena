import type { ClientMessage, MatchRules } from "@knockout/shared";

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function isRulesPatch(value: unknown): value is Partial<MatchRules> {
  if (!isObject(value)) return false;
  if (
    value.gameMode !== undefined &&
    value.gameMode !== "stock" &&
    value.gameMode !== "team"
  )
    return false;
  for (const key of [
    "matchDurationSeconds",
    "stocks",
    "knockbackMultiplier",
  ] as const)
    if (value[key] !== undefined && !isFiniteNumber(value[key])) return false;
  for (const key of [
    "heavyEnabled",
    "dashEnabled",
    "blockEnabled",
    "friendlyFire",
  ] as const)
    if (value[key] !== undefined && typeof value[key] !== "boolean")
      return false;
  return true;
}

/** Parses and validates every client-controlled field before simulation code sees it. */
export function parseClientMessage(raw: string): ClientMessage | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isObject(value) || typeof value.type !== "string") return undefined;

  switch (value.type) {
    case "join":
      if (
        typeof value.name !== "string" ||
        typeof value.roomCode !== "string" ||
        !Number.isSafeInteger(value.protocolVersion) ||
        !["quick", "private", "training"].includes(String(value.mode)) ||
        (value.createRoom !== undefined &&
          typeof value.createRoom !== "boolean") ||
        (value.reconnectToken !== undefined &&
          typeof value.reconnectToken !== "string")
      )
        return undefined;
      return value as ClientMessage;
    case "ready":
      return typeof value.ready === "boolean"
        ? (value as ClientMessage)
        : undefined;
    case "leave":
    case "startMatch":
    case "returnToLobby":
    case "resetTraining":
      return Object.keys(value).length === 1
        ? (value as ClientMessage)
        : undefined;
    case "rematchVote":
      return typeof value.vote === "boolean"
        ? (value as ClientMessage)
        : undefined;
    case "chat":
      return typeof value.text === "string"
        ? (value as ClientMessage)
        : undefined;
    case "ping":
      return isFiniteNumber(value.clientTime)
        ? (value as ClientMessage)
        : undefined;
    case "setTrainingBotMode":
      return ["static", "strafe", "aggressive", "blocking"].includes(
        String(value.mode),
      )
        ? (value as ClientMessage)
        : undefined;
    case "setTrainingKnockback":
      return isFiniteNumber(value.value) ? (value as ClientMessage) : undefined;
    case "updateRules":
      return isRulesPatch(value.patch) ? (value as ClientMessage) : undefined;
    case "input":
      return Number.isSafeInteger(value.sequence) &&
        isFiniteNumber(value.moveX) &&
        isFiniteNumber(value.moveZ) &&
        isFiniteNumber(value.yaw) &&
        (value.pitch === undefined || isFiniteNumber(value.pitch)) &&
        typeof value.jump === "boolean" &&
        typeof value.dash === "boolean" &&
        typeof value.blocking === "boolean" &&
        typeof value.charging === "boolean"
        ? (value as ClientMessage)
        : undefined;
    case "attack":
      return (value.kind === "light" || value.kind === "heavy") &&
        isFiniteNumber(value.charge) &&
        isFiniteNumber(value.yaw) &&
        (value.pitch === undefined || isFiniteNumber(value.pitch)) &&
        (value.inputSequence === undefined ||
          Number.isSafeInteger(value.inputSequence)) &&
        isFiniteNumber(value.clientTime)
        ? (value as ClientMessage)
        : undefined;
    default:
      return undefined;
  }
}
