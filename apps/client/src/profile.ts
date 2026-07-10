import type { MatchMode } from "@knockout/shared";

export type MatchHistoryEntry = {
  matchId: string;
  playedAt: string;
  mode: MatchMode;
  roomCode: string;
  durationSeconds: number;
  placement: number;
  playerCount: number;
  kos: number;
  assists: number;
  falls: number;
};

export type GuestProfile = {
  matches: number;
  wins: number;
  kos: number;
  assists: number;
  falls: number;
  history: MatchHistoryEntry[];
};

export const emptyProfile: GuestProfile = { matches: 0, wins: 0, kos: 0, assists: 0, falls: 0, history: [] };

export function loadProfile(): GuestProfile {
  try {
    const stored = JSON.parse(localStorage.getItem("ko-profile") ?? "null") as GuestProfile | null;
    if (!stored || !Array.isArray(stored.history)) return emptyProfile;
    return { ...emptyProfile, ...stored, history: stored.history.slice(0, 20) };
  } catch { return emptyProfile; }
}

export function recordMatch(profile: GuestProfile, entry: MatchHistoryEntry): GuestProfile {
  if (profile.history.some(match => match.matchId === entry.matchId)) return profile;
  const next = {
    matches: profile.matches + 1,
    wins: profile.wins + (entry.placement === 1 ? 1 : 0),
    kos: profile.kos + entry.kos,
    assists: profile.assists + entry.assists,
    falls: profile.falls + entry.falls,
    history: [entry, ...profile.history].slice(0, 20),
  };
  try { localStorage.setItem("ko-profile", JSON.stringify(next)); } catch { /* Stats remain available for this session. */ }
  return next;
}
