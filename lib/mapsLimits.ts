// FILE: lib/mapsLimits.ts
export const MAPS_MAX_WAYPOINTS_MOBILE = 3;
export const MAPS_MAX_WAYPOINTS_OTHER = 9;

/** `maxTouchPoints > 1` with a Macintosh UA is iPadOS asking for the desktop site. */
export function mapsMaxWaypoints(userAgent: string, maxTouchPoints: number): number {
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
  const iPadOS = /Macintosh/.test(userAgent) && maxTouchPoints > 1;
  return mobileUA || iPadOS ? MAPS_MAX_WAYPOINTS_MOBILE : MAPS_MAX_WAYPOINTS_OTHER;
}
