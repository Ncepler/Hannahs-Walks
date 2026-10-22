import { BARRIER_LINKS } from '../data/barrier-links';
import { HOME_ID } from './config';
import { adj, nodes, segmentBetween } from './graph';
import { buildMapsUrl } from './mapsUrl';
import type { LatLon } from './polyline';
import type { NodeId } from './types';
import { chooseWaypoints, shortestPath, type SimEdge } from './waypoints';

/* ---------- Standing in for "Google picks its own shortest path" (ROADS-ADDENDUM §8.4) ---------- */

/**
 * Legal segments plus the roads we refuse (BARRIER_LINKS), both directions: Google may use either.
 * Only this file and the planner above it may touch BARRIER_LINKS.
 */
const sim = new Map<NodeId, SimEdge[]>();
for (const id of Object.keys(nodes)) sim.set(id, (adj[id] ?? []).map(([to, edgeId, meters]) => ({ id: edgeId, to, meters })));
for (const b of BARRIER_LINKS) {
  sim.get(b.a)?.push({ id: b.id, to: b.b, meters: b.meters });
  sim.get(b.b)?.push({ id: b.id, to: b.a, meters: b.meters });
}
const simGraph = (n: string): readonly SimEdge[] => sim.get(n) ?? [];
const isBarrierEdge = (edgeId: string) => BARRIER_LINKS.some((b) => b.id === edgeId);

/** The path our stand-in for Google would walk through these points, in order. */
export function simulate(points: readonly NodeId[]): NodeId[] {
  const out: NodeId[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) out.push(...(shortestPath(simGraph, points[i], points[i + 1])?.nodes.slice(1) ?? []));
  return out;
}

export interface WaypointPlan {
  /** Intermediate nodes to hand to Google, in route order. */
  waypoints: NodeId[];
  /** True when every leg's simulated shortest path is exactly the intended one. */
  exact: boolean;
  /** The limit was reached and Google's likely path still runs along a road we refuse. */
  risky: boolean;
}

const coordOf = (id: string): LatLon => [nodes[id].lat, nodes[id].lon];

/** Leg-by-leg pins, at most `limit` (3 on mobile browsers, 9 elsewhere: lib/mapsLimits.ts). */
export function selectWaypoints(path: readonly NodeId[], limit: number): WaypointPlan {
  const edges = path.slice(0, -1).map((n, i) => segmentBetween(n, path[i + 1])?.id ?? '');
  const plan = chooseWaypoints(path, edges, simGraph, coordOf, isBarrierEdge, limit);
  return {
    waypoints: plan.indices.map((i) => path[i]),
    exact: plan.exact,
    risky: !plan.exact && plan.usesBarrier,
  };
}

/* ---------- Links ---------- */

const ll = (id: NodeId) => `${nodes[id].lat},${nodes[id].lon}`;

/** Coordinates only, never an address. The pipe is encoded; commas stay readable. */
function query(params: [string, string][]): string {
  const q = new URLSearchParams();
  for (const [k, v] of params) q.append(k, v);
  return q.toString().replace(/%2C/g, ',');
}

/** Deep link for Google Maps. Without `origin`, Google starts from wherever the person is standing. */
export function mapsLink(path: readonly NodeId[], waypoints: readonly NodeId[], opts: { startFromHome?: boolean } = {}): string {
  return buildMapsUrl(coordOf(path[path.length - 1]), waypoints.map(coordOf), opts.startFromHome ? coordOf(HOME_ID) : undefined);
}

/** The Embed key is public by design; restrict it by HTTP referrer in Google Cloud. */
export const embedKey = (): string | undefined => process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY || undefined;

/**
 * Embed "directions" URL, or null without a key. A loop sends origin and destination as the same
 * point; whether the Embed API accepts that was not checked (no key to test with). If it rejects
 * it, send the last waypoint as the destination instead.
 */
export function embedUrl(path: readonly NodeId[], waypoints: readonly NodeId[], key = embedKey()): string | null {
  if (!key) return null;
  const params: [string, string][] = [
    ['key', key],
    ['origin', ll(HOME_ID)],
    ['destination', ll(path[path.length - 1])],
  ];
  if (waypoints.length) params.push(['waypoints', waypoints.map(ll).join('|')]);
  params.push(['mode', 'walking']);
  return `https://www.google.com/maps/embed/v1/directions?${query(params)}`;
}
