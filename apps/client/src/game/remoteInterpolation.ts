import type { PlayerSnapshot } from "@knockout/shared";

export const REMOTE_TELEPORT_DISTANCE = 8;

export function shouldSnapRemoteFighter(
  previous: PlayerSnapshot,
  current: PlayerSnapshot,
  matchChanged: boolean,
): boolean {
  if (matchChanged || (!previous.protected && current.protected)) return true;

  const dx = current.position.x - previous.position.x;
  const dy = current.position.y - previous.position.y;
  const dz = current.position.z - previous.position.z;
  return (
    dx * dx + dy * dy + dz * dz >=
    REMOTE_TELEPORT_DISTANCE * REMOTE_TELEPORT_DISTANCE
  );
}
