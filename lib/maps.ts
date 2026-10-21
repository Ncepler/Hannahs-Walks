import { HOME_ID, MAPS_MAX_WAYPOINTS } from './config';
import { distToPolyline } from './geo';
import { adj, LANDMARKS, nodes, segmentBetween } from './graph';
import type { NodeId } from './types';

/* ---------- Dijkstra on our own graph, standing in for "Google picks its own shortest path" ---------- */

const ids = Object.keys(nodes).sort();

/** Shortest path by metres. Ties go to the lower node id so the result is repeatable. */
export function shortestPath(from: NodeId, to: NodeId): NodeId[] {
  const dist = new Map<NodeId, number>(ids.map((n) => [n, Infinity]));
  const prev = new Map<NodeId, NodeId>();
  const done = new Set<NodeId>();
  dist.set(from, 0);
  for (;;) {
    let u: NodeId | undefined;
    for (const n of ids) if (!done.has(n) && dist.get(n)! < Infinity && (u === undefined || dist.get(n)! < dist.get(u)!)) u = n;
    if (u === undefined || u === to) break;
    done.add(u);
    for (const [nb, , m] of adj[u]) {
      const d = dist.get(u)! + m;
      if (d < dist.get(nb)! - 1e-9) {
        dist.set(nb, d);
        prev.set(nb, u);
      }
    }
  }
  const out: NodeId[] = [to];
  while (out[0] !== from) {
    const p = prev.get(out[0]);
    if (!p) return [from];
    out.unshift(p);
  }
  return out;
}

/** The path our stand-in for Google would walk through these points, in order. */
export function simulate(points: readonly NodeId[]): NodeId[] {
  const out: NodeId[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) out.push(...shortestPath(points[i], points[i + 1]).slice(1));
  return out;
}

const same = (a: readonly NodeId[], b: readonly NodeId[]) => a.length === b.length && a.every((n, i) => n === b[i]);

export interface WaypointPlan {
  /** Intermediate nodes to hand to Google, in route order. */
  waypoints: NodeId[];
  /** True when the simulated shortest path through them is exactly the intended path. */
  exact: boolean;
}

/**
 * §12.2: add the node farthest from the simulated path until it matches the intended path or the
 * limit is reached. Start is the first node, finish the last (Home for a loop).
 */
export function selectWaypoints(path: readonly NodeId[], max = MAPS_MAX_WAYPOINTS): WaypointPlan {
  const start = path[0];
  const end = path[path.length - 1];
  const order = (n: NodeId) => path.indexOf(n);
  const through = (w: NodeId[]) => simulate([start, ...w, end]);
  const W: NodeId[] = [];
  let sim = through(W);
  const candidates = [...new Set(path)].filter((n) => n !== start && n !== end);

  while (!same(sim, path) && W.length < max) {
    const open = candidates.filter((n) => !W.includes(n));
    if (!open.length) break;
    let best = open[0];
    let far = -1;
    for (const n of open) {
      const d = distToPolyline(n, sim);
      if (d > far + 1e-9) {
        far = d;
        best = n;
      }
    }
    // Every node already lies on the simulated path (same streets, other order or direction):
    // fall back to the node halfway along the walk.
    if (far < 1) {
      let acc = 0;
      const cum = new Map<NodeId, number>();
      path.forEach((n, i) => {
        if (i > 0) acc += segmentBetween(path[i - 1], n)?.meters ?? 0;
        if (!cum.has(n)) cum.set(n, acc);
      });
      best = open.reduce((a, b) => (Math.abs(cum.get(b)! - acc / 2) < Math.abs(cum.get(a)! - acc / 2) ? b : a));
    }
    W.push(best);
    W.sort((a, b) => order(a) - order(b));
    sim = through(W);
  }

  // "Always include the places the route visits, if the limit allows" (§12.2.5), keeping the match.
  const exact = same(sim, path);
  for (const poi of path.filter((n, i) => LANDMARKS.includes(n) && path.indexOf(n) === i && n !== end)) {
    if (W.length >= max) break;
    if (W.includes(poi)) continue;
    const trial = [...W, poi].sort((a, b) => order(a) - order(b));
    if (exact && !same(through(trial), path)) continue;
    W.splice(0, W.length, ...trial);
  }
  return { waypoints: W, exact };
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
  const params: [string, string][] = [['api', '1']];
  if (opts.startFromHome) params.push(['origin', ll(HOME_ID)]);
  params.push(['destination', ll(path[path.length - 1])]);
  if (waypoints.length) params.push(['waypoints', waypoints.map(ll).join('|')]);
  params.push(['travelmode', 'walking']);
  return `https://www.google.com/maps/dir/?${query(params)}`;
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
