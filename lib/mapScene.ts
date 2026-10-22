import { BARRIER_LINKS } from '../data/barrier-links';
import { longStreet, primaryStreet } from './describe';
import { buildDirections, type DirStep } from './directions';
import { nodes, segmentBetween, segmentById, segments } from './graph';
import { cumulativeM, haversineM, pointAtDistance } from './geo';
import { decodePolyline, type LatLon } from './polyline';
import { routeGeometry, type RouteGeometry } from './routeGeometry';
import type { NodeId } from './types';

/** Stored geometry of a segment, if the build scripts produced any. Seed mode has none. */
export const geomOf = (segmentId: string): string | undefined => segmentById[segmentId]?.geom;

export interface NetworkLine { id: string; street: string; pts: LatLon[]; approx: boolean; crossing: boolean }
export interface BarrierLine { id: string; road: 'glen cove road' | 'northern boulevard'; pts: LatLon[]; label: string; approx: boolean }
export interface StreetLabel { text: string; pos: LatLon; angle: LatLon; route: boolean; lengthM: number }

const BARRIER_LABEL = { 'glen cove road': 'Glen Cove Rd · not walked', 'northern boulevard': 'Northern Blvd · not walked' } as const;
const coord = (id: NodeId): LatLon => [nodes[id].lat, nodes[id].lon];

/** The legal network, drawn from stored geometry, or as a straight chord (flagged) where there is none. */
export const NETWORK: readonly NetworkLine[] = segments.map((s) => {
  const g = s.geom ? decodePolyline(s.geom) : null;
  return { id: s.id, street: s.street, pts: g ?? [coord(s.a), coord(s.b)], approx: !g, crossing: s.kind === 'crossing' };
});

/** True when no segment has stored geometry: every line on the map is a chord and the map says so. */
export const SEED_ONLY = NETWORK.every((n) => n.approx);

/** Refused roads, for display only. Seed mode has chords between the street ends where they start and finish. */
export const BARRIERS: readonly BarrierLine[] = BARRIER_LINKS.map((b) => ({
  id: b.id,
  road: b.road,
  pts: [coord(b.a), coord(b.b)],
  label: BARRIER_LABEL[b.road],
  approx: true,
}));

export interface MapScene {
  route: RouteGeometry;
  cum: number[];
  steps: DirStep[];
  /** Per walk step: the same segment is also walked the other way somewhere in this walk. */
  bothWays: boolean[];
  /** Per walk step: it is the signal crossing. */
  crossingStep: boolean[];
  /** The crossing badge position, if the walk uses it. */
  crossing: LatLon | null;
  turnarounds: NodeId[];
  places: NodeId[];
  labels: StreetLabel[];
  approximate: boolean;
  ariaLabel: string;
}

const mid = (pts: readonly LatLon[]): { pos: LatLon; angle: LatLon } => {
  const cum = cumulativeM(pts);
  const total = cum[cum.length - 1] ?? 0;
  const a = pointAtDistance(pts, cum, Math.max(0, total / 2 - 8));
  const b = pointAtDistance(pts, cum, Math.min(total, total / 2 + 8));
  return { pos: pointAtDistance(pts, cum, total / 2), angle: [b[0] - a[0], b[1] - a[1]] };
};

const lengthOf = (pts: readonly LatLon[]) => {
  const c = cumulativeM(pts);
  return c[c.length - 1] ?? 0;
};

export function buildScene(path: readonly NodeId[]): MapScene {
  const route = routeGeometry(path, segmentBetween, geomOf, nodes);
  const steps = buildDirections(path);

  const dir = new Map<string, Set<boolean>>();
  const crossingStep: boolean[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const s = segmentBetween(path[i]!, path[i + 1]!);
    crossingStep.push(s?.kind === 'crossing');
    if (!s) continue;
    dir.set(s.id, (dir.get(s.id) ?? new Set()).add(s.a === path[i]));
  }
  const bothWays = path.slice(0, -1).map((n, i) => {
    const s = segmentBetween(n, path[i + 1]!);
    return !!s && (dir.get(s.id)?.size ?? 0) > 1;
  });

  const x = segmentById['X01'];
  const usesX = crossingStep.some(Boolean) && !!x;
  const crossing: LatLon | null = usesX ? mid(NETWORK.find((n) => n.id === 'X01')!.pts).pos : null;

  const turnarounds = new Set<NodeId>();
  for (let i = 1; i < path.length - 1; i++) if (path[i - 1] === path[i + 1]) turnarounds.add(path[i]!);
  const places = [...new Set(path.filter((id) => nodes[id]?.kind === 'poi'))];

  // Street labels: the route's own streets first (on their longest piece), then the nearest legal streets.
  const walked = new Set<string>();
  for (let i = 0; i < path.length - 1; i++) {
    const s = segmentBetween(path[i]!, path[i + 1]!);
    if (s && s.kind !== 'crossing') walked.add(s.id);
  }
  const best = new Map<string, { line: NetworkLine; len: number; route: boolean }>();
  const centre = route.points[Math.floor(route.points.length / 2)] ?? coord('HOME');
  for (const line of NETWORK) {
    if (line.crossing) continue;
    const text = longStreet(primaryStreet(line.street));
    const len = lengthOf(line.pts);
    const isRoute = walked.has(line.id);
    const prev = best.get(text);
    const rank = (r: boolean, l: number) => (r ? 1e6 : 0) + l;
    if (!prev || rank(isRoute, len) > rank(prev.route, prev.len)) best.set(text, { line, len, route: isRoute });
  }
  const labels: StreetLabel[] = [...best.entries()]
    .map(([text, b]) => ({ text, ...mid(b.line.pts), route: b.route, lengthM: b.len }))
    .sort((p, q) => Number(q.route) - Number(p.route) || haversineM(p.pos, centre) - haversineM(q.pos, centre));

  const names = [...new Set(steps.filter((s) => s.kind === 'street').map((s) => s.street))].slice(0, 3);
  const miles = (cumulativeM(route.points).at(-1) ?? 0) / 1609.344;
  const along = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? 'nearby streets');
  const ariaLabel = `Map of a ${miles.toFixed(1)} mile walk from Home along ${along}; the Directions list has the full route.`;

  return {
    route,
    cum: cumulativeM(route.points),
    steps,
    bothWays,
    crossingStep,
    crossing,
    turnarounds: [...turnarounds],
    places,
    labels,
    approximate: route.approximate || SEED_ONLY,
    ariaLabel,
  };
}
