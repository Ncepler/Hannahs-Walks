import { nodes } from './graph';
import type { NodeId } from './types';

const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle initial bearing between two nodes, degrees clockwise from north. */
export function bearing(a: NodeId, b: NodeId): number {
  const p1 = rad(nodes[a].lat);
  const p2 = rad(nodes[b].lat);
  const dl = rad(nodes[b].lon - nodes[a].lon);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Signed turn from one heading to the next, -180..180; positive is a right turn. */
export function turnDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

const M_PER_DEG = 111320;
/** Local planar metres, good enough for distances of a few miles. */
export function planar(id: NodeId): [number, number] {
  const k = Math.cos(rad(nodes.HOME.lat));
  return [nodes[id].lon * k * M_PER_DEG, nodes[id].lat * M_PER_DEG];
}

/** Straight-line distance from a node to the polyline through `line`, metres. */
export function distToPolyline(id: NodeId, line: readonly NodeId[]): number {
  const [px, py] = planar(id);
  let best = Infinity;
  for (let i = 0; i < line.length; i++) {
    const [ax, ay] = planar(line[i]);
    const [bx, by] = i + 1 < line.length ? planar(line[i + 1]) : [ax, ay];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}
