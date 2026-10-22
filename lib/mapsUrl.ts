// FILE: lib/mapsUrl.ts
import type { LatLon } from './polyline';

const fmt = (p: LatLon): string => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;

/** Coordinates only, never an address. `URLSearchParams` encodes the pipe as %7C. */
export function buildMapsUrl(home: LatLon, waypoints: readonly LatLon[], origin?: LatLon): string {
  const params = new URLSearchParams({ api: '1', destination: fmt(home), travelmode: 'walking' });
  if (origin) params.set('origin', fmt(origin));
  if (waypoints.length > 0) params.set('waypoints', waypoints.map(fmt).join('|'));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
