// FILE: scripts/osm/forbidden.ts
import {
  PARALLEL_BUFFER_M,
  PARALLEL_MAX_BEARING_DIFF_DEG,
  PARALLEL_MIN_LENGTH_M,
} from '../../lib/rules';

/** [lat, lon] in degrees. */
export type LatLon = readonly [number, number];
type XY = readonly [number, number];

const STEP_M = 5;
const LAT_M = 111_034;   // metres per degree of latitude near 40.8 N

function toXY(line: readonly LatLon[], lat0: number): XY[] {
  const lonM = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  return line.map((p): XY => [p[1] * lonM, p[0] * LAT_M]);
}

function densify(line: readonly XY[], step: number): XY[] {
  const out: XY[] = [line[0]!];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/** Bearing of a -> b in degrees, folded to 0..180 (direction of travel does not matter). */
function axisDeg(a: XY, b: XY): number {
  const d = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
  return ((d % 180) + 180) % 180;
}

function axisDiff(x: number, y: number): number {
  const d = Math.abs(x - y);
  return Math.min(d, 180 - d);
}

function distPointSeg(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Longest contiguous stretch (metres) of `candidate` that stays within PARALLEL_BUFFER_M of one of
 * the forbidden `roads` while running within PARALLEL_MAX_BEARING_DIFF_DEG of its direction.
 */
export function parallelRunMeters(candidate: readonly LatLon[], roads: ReadonlyArray<readonly LatLon[]>): number {
  if (candidate.length < 2) return 0;
  const lat0 = candidate[0]![0];
  const cand = densify(toXY(candidate, lat0), STEP_M);
  const roadsXY = roads.map((r) => toXY(r, lat0));
  let run = 0;
  let best = 0;
  for (let i = 0; i + 1 < cand.length; i++) {
    const a = cand[i]!;
    const b = cand[i + 1]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len === 0) continue;
    const mid: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const axis = axisDeg(a, b);
    let near = false;
    for (const road of roadsXY) {
      for (let j = 0; j + 1 < road.length && !near; j++) {
        const c = road[j]!;
        const d = road[j + 1]!;
        near = distPointSeg(mid, c, d) <= PARALLEL_BUFFER_M && axisDiff(axis, axisDeg(c, d)) <= PARALLEL_MAX_BEARING_DIFF_DEG;
      }
      if (near) break;
    }
    if (near) { run += len; best = Math.max(best, run); } else run = 0;
  }
  return best;
}

export function isParallelToForbidden(candidate: readonly LatLon[], roads: ReadonlyArray<readonly LatLon[]>): boolean {
  return parallelRunMeters(candidate, roads) >= PARALLEL_MIN_LENGTH_M;
}
