// FILE: lib/rules.ts
import type { NodeId, Segment, WalkNode } from './types';

export type ForbiddenRoad = 'glen cove road' | 'northern boulevard';

/** Normalised names of the roads nobody may walk along. */
export const FORBIDDEN_ALONG: readonly ForbiddenRoad[] = ['glen cove road', 'northern boulevard'];
/** OSM `ref` values (normalised) that identify a forbidden road. NY 25A is Northern Boulevard. */
export const FORBIDDEN_REFS: readonly string[] = ['ny 25a'];

/** Segment ids that may cross a forbidden road. Nothing else may. */
export const GLEN_COVE_CROSSINGS: readonly string[] = ['X01'];   // Midwood Cross <-> Lakeville Ct/Dr, at the signal
export const NORTHERN_CROSSINGS: readonly string[] = [];         // none whitelisted (H5)

export const MAX_CROSSINGS_PER_WALK = 2;
export const CROSSING_WAIT_SECONDS = 60;
/** Footways closer than this and roughly parallel to a forbidden road count as "along" it (pipeline). */
export const PARALLEL_BUFFER_M = 25;
export const PARALLEL_MAX_BEARING_DIFF_DEG = 30;
export const PARALLEL_MIN_LENGTH_M = 30;

const ABBREVIATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bblvd\b/g, 'boulevard'], [/\brd\b/g, 'road'], [/\bdr\b/g, 'drive'], [/\bln\b/g, 'lane'],
  [/\bave\b/g, 'avenue'], [/\bst\b/g, 'street'], [/\bct\b/g, 'court'], [/\bpl\b/g, 'place'],
  [/\bter\b/g, 'terrace'], [/\bcir\b/g, 'circle'], [/\bpkwy\b/g, 'parkway'],
];

/** Lower-case, drop parentheticals and punctuation, expand abbreviations, collapse spaces. */
export function norm(s: string): string {
  let t = s.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[.,]/g, ' ');
  for (const [re, to] of ABBREVIATIONS) t = t.replace(re, to);
  return t.replace(/\s+/g, ' ').trim();
}

/** Which forbidden road (if any) does this name/ref belong to? Exact whole-name match only. */
export function forbiddenRoadOf(street: string, ref?: string): ForbiddenRoad | null {
  for (const part of street.split(/\s*[\/;]\s*/)) {
    const n = norm(part);
    const hit = FORBIDDEN_ALONG.find((f) => f === n);
    if (hit) return hit;
  }
  if (ref && ref.split(';').some((r) => FORBIDDEN_REFS.includes(norm(r)))) return 'northern boulevard';
  return null;
}

export function isWhitelistedCrossing(segmentId: string): boolean {
  return GLEN_COVE_CROSSINGS.includes(segmentId) || NORTHERN_CROSSINGS.includes(segmentId);
}

/** True if this segment may appear in the walkable graph. */
export function isLegalSegment(s: Pick<Segment, 'id' | 'street' | 'kind' | 'ref'>): boolean {
  if (s.kind === 'crossing') return isWhitelistedCrossing(s.id);
  return forbiddenRoadOf(s.street, s.ref) === null;
}

export interface PathCheck { ok: boolean; reasons: string[]; crossings: number; waitSeconds: number }

/**
 * Validate a node path against the hard rules. `between` returns the segment joining two nodes
 * (either direction) or undefined. Use this in the composer, the premium validator, the library
 * builder, the Maps link builder and the acceptance script.
 */
export function checkPath(
  path: readonly NodeId[],
  between: (a: NodeId, b: NodeId) => Segment | undefined,
  nodes: Readonly<Record<string, WalkNode>>,
): PathCheck {
  const reasons: string[] = [];
  let crossings = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const s = between(a, b);
    if (!s) { reasons.push(`no segment between ${a} and ${b}`); continue; }
    if (s.kind === 'crossing') {
      crossings++;
      if (!isWhitelistedCrossing(s.id)) reasons.push(`${s.id} is a crossing that is not whitelisted`);
    } else {
      const road = forbiddenRoadOf(s.street, s.ref);
      if (road) reasons.push(`${s.id} (${s.street}) walks along ${road}`);
    }
  }
  for (let i = 1; i < path.length - 1; i++) {
    if (nodes[path[i]!]?.kind === 'terminus' && path[i - 1] !== path[i + 1]) {
      reasons.push(`${path[i]} is a dead end at a forbidden road; the walk must turn back there`);
    }
  }
  if (crossings > MAX_CROSSINGS_PER_WALK) {
    reasons.push(`${crossings} crossings; the limit is ${MAX_CROSSINGS_PER_WALK}`);
  }
  return { ok: reasons.length === 0, reasons, crossings, waitSeconds: crossings * CROSSING_WAIT_SECONDS };
}

/** User text that asks for a walk along a forbidden road. "Old Northern Boulevard" must not match (lookbehind). */
export const FORBIDDEN_ASK = /\bglen cove (rd|road)\b|(?<!old )\bnorthern (blvd|boulevard)\b/i;
export const mentionsForbiddenRoad = (text: string): boolean => FORBIDDEN_ASK.test(text);
