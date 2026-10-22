// FILE: lib/geo.ts
import type { LatLon } from './polyline';

const R_EARTH_M = 6_371_008.8;
const rad = (d: number): number => (d * Math.PI) / 180;

export function haversineM(a: LatLon, b: LatLon): number {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function cumulativeM(pts: readonly LatLon[]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1]! + haversineM(pts[i - 1]!, pts[i]!));
  return out;
}

export function pathLengthM(pts: readonly LatLon[]): number {
  const c = cumulativeM(pts);
  return c[c.length - 1] ?? 0;
}

/** Point at `distM` along the polyline (clamped), linear between vertices. */
export function pointAtDistance(pts: readonly LatLon[], cum: readonly number[], distM: number): LatLon {
  if (pts.length === 0) throw new Error('empty polyline');
  const total = cum[cum.length - 1]!;
  const d = Math.max(0, Math.min(total, distM));
  let i = 1;
  while (i < cum.length - 1 && cum[i]! < d) i++;
  if (pts.length === 1) return pts[0]!;
  const span = cum[i]! - cum[i - 1]!;
  const t = span === 0 ? 0 : (d - cum[i - 1]!) / span;
  const a = pts[i - 1]!;
  const b = pts[i]!;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Local metric projection: x metres east, y metres SOUTH (screen-down) of `origin`. */
export function makeProjector(origin: LatLon): (p: LatLon) => readonly [number, number] {
  const mPerLat = (Math.PI / 180) * R_EARTH_M;
  const mPerLon = mPerLat * Math.cos(rad(origin[0]));
  return (p) => [(p[1] - origin[1]) * mPerLon, -(p[0] - origin[0]) * mPerLat];
}

export interface View { scale: number; cx: number; cy: number }   // px per metre, centre in projected metres

/** The view that fits every point into width x height with `pad` px around. */
export function fitView(pointsXY: ReadonlyArray<readonly [number, number]>, width: number, height: number, pad: number): View {
  if (pointsXY.length === 0) return { scale: 1, cx: 0, cy: 0 };
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const [x, y] of pointsXY) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const w = Math.max(maxX - minX, 1);
  const h = Math.max(maxY - minY, 1);
  const scale = Math.min((width - 2 * pad) / w, (height - 2 * pad) / h);
  return { scale, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

/** A "nice" scale-bar length in metres for a given px-per-metre scale, at most `maxPx` wide. */
export function niceScaleBarM(scale: number, maxPx: number): number {
  const steps = [10, 20, 50, 100, 200, 250, 500, 1000, 2000];
  let best = steps[0]!;
  for (const s of steps) if (s * scale <= maxPx) best = s;
  return best;
}
