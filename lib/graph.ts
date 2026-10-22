import { NODES } from '../data/nodes';
import { SEGMENTS } from '../data/segments';
import { FT_PER_METER, HOME_ID, MAX_MILES, METERS_PER_MILE, MIN_MILES } from './config';
import { ascentDescent, elevationSamples } from './elevation';
import { checkPath, isLegalSegment } from './rules';
import type { NodeId, RouteStats, Segment, SegmentId, WalkNode } from './types';

export const nodes: Readonly<Record<NodeId, WalkNode>> = NODES;
/** Only segments the hard rules allow (lib/rules.ts). A forbidden edge never reaches the router. */
export const segments: readonly Segment[] = SEGMENTS.filter(isLegalSegment);
export const segmentById: Readonly<Record<SegmentId, Segment>> = Object.fromEntries(
  segments.map((s) => [s.id, s]),
);

/** [neighbour, segment id, meters] */
export type Edge = readonly [NodeId, SegmentId, number];
export const adj: Record<NodeId, Edge[]> = {};
for (const id of Object.keys(nodes)) adj[id] = [];
for (const s of segments) {
  adj[s.a].push([s.b, s.id, s.meters]);
  adj[s.b].push([s.a, s.id, s.meters]);
}

const pairKey = (a: NodeId, b: NodeId) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const byPair = new Map<string, Segment[]>();
for (const s of segments) {
  const k = pairKey(s.a, s.b);
  byPair.set(k, [...(byPair.get(k) ?? []), s]);
}

export const segmentsBetween = (a: NodeId, b: NodeId): Segment[] => byPair.get(pairKey(a, b)) ?? [];
export const segmentBetween = (a: NodeId, b: NodeId): Segment | undefined => {
  const found = segmentsBetween(a, b);
  return found.length === 1 ? found[0] : undefined;
};

/** Landmarks that count as places worth walking to (§9.2). */
export const LANDMARKS: readonly NodeId[] = ['CEDARMERE', 'LIBRARY', 'VILLAGE'];
/** Every node of kind 'poi' counts in `stats.pois` (the village, library, Cedarmere, the Paper Mill Rd / Main St corner). */
const POI_NODES: readonly NodeId[] = Object.keys(nodes).filter((id) => nodes[id].kind === 'poi');
export const RIDGE_NODES: readonly NodeId[] = ['POPLAR_ASH', 'POPLAR_W'];

export interface Traversal {
  seg: Segment;
  from: NodeId;
  to: NodeId;
  forward: boolean;
  /** Elevation change in the walked direction, ft. */
  deltaFt: number;
}

const elev = (id: NodeId) => nodes[id].elevFt;

/** Walks a path that has already passed `validatePath`. */
export function traverse(path: readonly NodeId[]): Traversal[] {
  const out: Traversal[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const seg = segmentBetween(path[i], path[i + 1]);
    if (!seg) throw new Error(`No single segment between ${path[i]} and ${path[i + 1]}`);
    const forward = seg.a === path[i];
    const d = elev(seg.b) - elev(seg.a);
    out.push({ seg, from: path[i], to: path[i + 1], forward, deltaFt: forward ? d : -d });
  }
  return out;
}

export const metersOf = (path: readonly NodeId[]): number => {
  let m = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const s = segmentBetween(path[i], path[i + 1]);
    if (s) m += s.meters;
  }
  return m;
};
export const milesOf = (path: readonly NodeId[]): number => metersOf(path) / METERS_PER_MILE;

export interface Validation {
  ok: boolean;
  errors: string[];
}

/** A walk that does not finish at Home. */
export const isOneWay = (path: readonly NodeId[]) => path[path.length - 1] !== HOME_ID;

/** Places at the end of a dead-end road: the only way in is the way back out. */
export const DEAD_ENDS: readonly NodeId[] = Object.keys(nodes).filter((id) => id !== HOME_ID && adj[id].length === 1);

export interface Retrace {
  /** Segments, other than dead-end spurs, that the walk covers more than once. */
  repeated: SegmentId[];
  /** Dead-end places the walk goes into and comes back out of. */
  spurs: NodeId[];
}

/** Where a walk doubles back on itself. Walks a path that has already passed `validatePath`. */
export function retraceOf(path: readonly NodeId[]): Retrace {
  const times = new Map<SegmentId, number>();
  for (const t of traverse(path)) times.set(t.seg.id, (times.get(t.seg.id) ?? 0) + 1);
  const out: Retrace = { repeated: [], spurs: [] };
  for (const [id, n] of times) {
    if (n < 2) continue;
    const { a, b } = segmentById[id];
    const end = DEAD_ENDS.find((d) => d === a || d === b);
    // A spur is walked in and out once. Anything more is a repeat like any other.
    if (end && n === 2) out.spurs.push(end);
    else out.repeated.push(id);
  }
  return out;
}

/**
 * A closed loop: the way back is never the way out, so no road is walked twice. The one allowance is
 * the dead-end road to a place in `allowed`, which can only be visited by walking in and out.
 */
export const isClosedLoop = (r: Retrace, allowed: ReadonlySet<NodeId> = new Set()) =>
  r.repeated.length === 0 && r.spurs.every((id) => allowed.has(id));

/** §5 validation rules 1 - 4, then the hard rules (`checkPath`). Rule 5 (reversal) is `reversalHolds`. A one-way walk may finish elsewhere. */
export function validatePath(path: readonly NodeId[], opts: { oneWay?: boolean } = {}): Validation {
  const errors: string[] = [];
  if (!Array.isArray(path) || path.length < 2) return { ok: false, errors: ['Walk is too short'] };
  const unknown = path.filter((id) => typeof id !== 'string' || !(id in nodes));
  if (unknown.length) errors.push(`Unknown node ${String(unknown[0])}`);
  if (path[0] !== HOME_ID) errors.push('Walk must start at HOME');
  if (!opts.oneWay && path[path.length - 1] !== HOME_ID) errors.push('Walk must end at HOME');
  if (!unknown.length) {
    for (let i = 0; i < path.length - 1; i++) {
      if (segmentsBetween(path[i], path[i + 1]).length !== 1) {
        errors.push(`Segment between ${path[i]} and ${path[i + 1]} does not exist`);
        break;
      }
    }
  }
  if (!errors.length) {
    errors.push(...checkPath(path, segmentBetween, nodes).reasons);
  }
  if (!errors.length) {
    const mi = milesOf(path);
    if (mi < MIN_MILES || mi > MAX_MILES) {
      errors.push(`Walk is ${mi.toFixed(1)} mi, outside ${MIN_MILES} to ${MAX_MILES} mi`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** §5 rule 5: reversing a path keeps the meters and swaps ascent and descent. */
export function reversalHolds(path: readonly NodeId[], tolerance = 1e-6): boolean {
  const fwd = computeStats(path);
  const rev = computeStats([...path].reverse());
  return (
    Math.abs(fwd.meters - rev.meters) <= tolerance &&
    Math.abs(fwd.ascentFt - rev.descentFt) <= tolerance &&
    Math.abs(fwd.descentFt - rev.ascentFt) <= tolerance
  );
}

export function computeStats(path: readonly NodeId[]): RouteStats {
  const legs = traverse(path);
  let meters = 0;
  let ascent = 0;
  let descent = 0;
  let maxGrade = 0;
  let quiet = 0;
  let busy = 0;
  let scenicWeighted = 0;
  let crossings = 0;
  const walked = new Map<SegmentId, number>();

  for (const t of legs) {
    const m = t.seg.meters;
    meters += m;
    if (t.deltaFt > 0) ascent += t.deltaFt;
    else descent -= t.deltaFt;
    maxGrade = Math.max(maxGrade, (Math.abs(t.deltaFt) / (m * FT_PER_METER)) * 100);
    if (t.seg.traffic === 1) quiet += m;
    if (t.seg.traffic === 3) busy += m;
    scenicWeighted += t.seg.scenic * m;
    if (t.seg.kind === 'crossing') crossings++;
    walked.set(t.seg.id, (walked.get(t.seg.id) ?? 0) + 1);
  }

  let repeated = 0;
  for (const t of legs) if ((walked.get(t.seg.id) ?? 0) >= 3) repeated += t.seg.meters;

  const seen = new Set<NodeId>();
  const pois: NodeId[] = [];
  let ridge: NodeId | undefined;
  for (const id of path) {
    if (POI_NODES.includes(id) && !seen.has(id)) {
      seen.add(id);
      pois.push(id);
    }
    if (!ridge && RIDGE_NODES.includes(id)) ridge = id;
  }
  if (ridge) pois.push(ridge);

  // Generated mode: ascent and descent come from the stored samples. Seed mode keeps node-to-node (a lower bound).
  const samples = elevationSamples(path, segmentBetween);
  if (samples) ({ ascentFt: ascent, descentFt: descent } = ascentDescent(samples.y));

  const miles = meters / METERS_PER_MILE;
  return {
    meters,
    miles,
    ascentFt: ascent,
    descentFt: descent,
    maxGradePct: maxGrade,
    quietShare: quiet / meters,
    busyShare: busy / meters,
    scenic: scenicWeighted / meters / 3,
    turnsPerMile: countTurns(legs) / miles,
    pois,
    repeatShare: repeated / meters,
    crossings,
  };
}

/**
 * Every junction passed counts as one decision, so turns = segments walked.
 * The spec leaves this open; the §7 test vector (22 rows, all three mood columns) only
 * reproduces with this definition.
 */
export function countTurns(legs: readonly Traversal[]): number {
  return legs.length;
}
