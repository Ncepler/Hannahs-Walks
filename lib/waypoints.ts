// FILE: lib/waypoints.ts
import type { LatLon } from './polyline';

export interface SimEdge { id: string; to: string; meters: number }
export type SimGraph = (node: string) => readonly SimEdge[];

export interface SimPath { nodes: string[]; edges: string[] }

/** Dijkstra by metres on a small graph. Returns null if `to` is unreachable. */
export function shortestPath(g: SimGraph, from: string, to: string): SimPath | null {
  if (from === to) return { nodes: [from], edges: [] };
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, { node: string; edge: string }>();
  const done = new Set<string>();
  for (;;) {
    let u: string | undefined;
    let best = Infinity;
    for (const [n, d] of dist) if (!done.has(n) && d < best) { best = d; u = n; }
    if (u === undefined) return null;
    if (u === to) break;
    done.add(u);
    for (const e of g(u)) {
      const nd = best + e.meters;
      if (nd < (dist.get(e.to) ?? Infinity) - 1e-9) { dist.set(e.to, nd); prev.set(e.to, { node: u, edge: e.id }); }
    }
  }
  const nodes: string[] = [to];
  const edges: string[] = [];
  for (let n = to; n !== from; ) {
    const p = prev.get(n)!;
    edges.push(p.edge);
    nodes.push(p.node);
    n = p.node;
  }
  return { nodes: nodes.reverse(), edges: edges.reverse() };
}

function approxM(a: LatLon, b: LatLon): number {
  return Math.hypot((a[0] - b[0]) * 111_034, (a[1] - b[1]) * 111_320 * Math.cos((a[0] * Math.PI) / 180));
}

export interface WaypointPlan {
  indices: number[];        // indices into `path`, ascending: the nodes to pass to Google as pins
  exact: boolean;           // every leg's simulated shortest path equals the intended edges
  usesBarrier: boolean;     // some simulated leg runs along a refused road
}

export function chooseWaypoints(
  path: readonly string[],
  pathEdges: readonly string[],            // edge id for each step, length path.length - 1
  g: SimGraph,
  coord: (node: string) => LatLon,
  isBarrierEdge: (edgeId: string) => boolean,
  limit: number,
): WaypointPlan {
  const chosen: number[] = [];
  for (;;) {
    const idx = [0, ...[...chosen].sort((x, y) => x - y), path.length - 1];
    let exact = true;
    let usesBarrier = false;
    let worst = -1;
    let worstD = -1;
    for (let k = 0; k + 1 < idx.length; k++) {
      const a = idx[k]!;
      const b = idx[k + 1]!;
      const sp = shortestPath(g, path[a]!, path[b]!);
      if (!sp) { exact = false; continue; }
      if (sp.edges.some(isBarrierEdge)) usesBarrier = true;
      const want = pathEdges.slice(a, b);
      if (sp.edges.length === want.length && sp.edges.every((e, i) => e === want[i])) continue;
      exact = false;
      for (let i = a + 1; i < b; i++) {
        const c = coord(path[i]!);
        let d = Infinity;
        for (const n of sp.nodes) d = Math.min(d, approxM(c, coord(n)));
        if (d > worstD + 1e-9) { worstD = d; worst = i; }
      }
    }
    const indices = [...chosen].sort((x, y) => x - y);
    if (exact) return { indices, exact: true, usesBarrier: false };
    if (chosen.length >= limit || worst < 0 || worstD <= 0.5) return { indices, exact: false, usesBarrier };
    chosen.push(worst);
  }
}
