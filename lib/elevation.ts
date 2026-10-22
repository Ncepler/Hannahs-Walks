import type { NodeId, Segment } from './types';

export interface ElevationSamples {
  /** Metres along the walk, from the segments' stored lengths. */
  x: number[];
  /** Feet. */
  y: number[];
}

/**
 * Stored elevation samples along a walk (ROADS-ADDENDUM §7.5), reversed for a step walked b -> a. Null when any
 * step has none, which is always the case in seed mode: callers then use node-to-node elevations.
 */
export function elevationSamples(
  path: readonly NodeId[],
  between: (a: NodeId, b: NodeId) => Segment | undefined,
): ElevationSamples | null {
  const x: number[] = [];
  const y: number[] = [];
  let at = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = between(path[i]!, path[i + 1]!);
    const e = seg?.elevs;
    if (!seg || !e || e.length < 2) return null;
    const ft = seg.a === path[i] ? e : e.slice().reverse();
    ft.forEach((v, k) => {
      if (i > 0 && k === 0) return; // the joint is already there
      x.push(at + (seg.meters * k) / (ft.length - 1));
      y.push(v);
    });
    at += seg.meters;
  }
  return y.length ? { x, y } : null;
}

const median3 = (v: readonly number[]): number[] =>
  v.map((_, i) => {
    const w = [v[Math.max(0, i - 1)]!, v[i]!, v[Math.min(v.length - 1, i + 1)]!].sort((a, b) => a - b);
    return w[1]!;
  });

/** Ascent and descent of median-filtered samples, ignoring changes under `deadband` ft (noise). */
export function ascentDescent(samples: readonly number[], deadband = 2): { ascentFt: number; descentFt: number } {
  const s = median3(samples);
  let anchor = s[0] ?? 0;
  let ascentFt = 0;
  let descentFt = 0;
  for (const v of s) {
    const d = v - anchor;
    if (Math.abs(d) < deadband) continue;
    if (d > 0) ascentFt += d;
    else descentFt -= d;
    anchor = v;
  }
  return { ascentFt, descentFt };
}
