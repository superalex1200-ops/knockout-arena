import {
  isValidLobbyCode,
  normalizeLobbyCode,
  type MatchMode,
} from "@knockout/shared";

const ACTIVE_SESSION_KEY = "ko-active-session";
const RECONNECT_KEY = "ko-reconnect";

export type ActiveGameSession = {
  mode: MatchMode;
  code: string;
  createRoom: false;
};

type ReconnectSession = {
  mode: MatchMode;
  roomCode: string;
  token: string;
};

type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const currentStorage = (): SessionStorageLike | undefined => {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
};

const validMode = (value: unknown): value is MatchMode =>
  value === "quick" || value === "private" || value === "training";

export function loadActiveGameSession(
  storage = currentStorage(),
): ActiveGameSession | undefined {
  try {
    const value = JSON.parse(
      storage?.getItem(ACTIVE_SESSION_KEY) ?? "null",
    ) as Partial<ActiveGameSession> | null;
    const code = normalizeLobbyCode(String(value?.code ?? ""));
    if (!value || !validMode(value.mode) || !isValidLobbyCode(code)) return;
    return { mode: value.mode, code, createRoom: false };
  } catch {
    return;
  }
}

export function loadReconnectToken(
  mode: MatchMode,
  roomCode: string,
  storage = currentStorage(),
): string {
  try {
    const value = JSON.parse(
      storage?.getItem(RECONNECT_KEY) ?? "null",
    ) as Partial<ReconnectSession> | null;
    const code = normalizeLobbyCode(roomCode);
    const storedCode = normalizeLobbyCode(String(value?.roomCode ?? ""));
    if (
      !value ||
      value.mode !== mode ||
      storedCode !== code ||
      typeof value.token !== "string" ||
      value.token.length < 8 ||
      value.token.length > 256
    )
      return "";
    return value.token;
  } catch {
    return "";
  }
}

export function saveGameSession(
  mode: MatchMode,
  roomCode: string,
  token: string,
  storage = currentStorage(),
): boolean {
  const code = normalizeLobbyCode(roomCode);
  if (
    !storage ||
    !validMode(mode) ||
    !isValidLobbyCode(code) ||
    token.length < 8 ||
    token.length > 256
  )
    return false;
  try {
    storage.setItem(
      ACTIVE_SESSION_KEY,
      JSON.stringify({ mode, code, createRoom: false }),
    );
    storage.setItem(
      RECONNECT_KEY,
      JSON.stringify({ mode, roomCode: code, token }),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearGameSession(storage = currentStorage()): void {
  try {
    storage?.removeItem(ACTIVE_SESSION_KEY);
    storage?.removeItem(RECONNECT_KEY);
  } catch {
    /* Storage can be disabled; the live in-memory session still works. */
  }
}
