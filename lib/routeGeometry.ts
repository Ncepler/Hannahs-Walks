// FILE: lib/routeGeometry.ts
import type { NodeId, Segment, WalkNode } from './types';
import type { LatLon } from './polyline';
import { decodePolyline } from './polyline';

export interface RouteGeometry {
  points: LatLon[];          // the whole walk, in order, with no duplicated joints
  stepStart: number[];       // index in `points` where each path step begins (length = path.length - 1)
  approximate: boolean;      // true if any step had no stored geometry (drawn as a straight chord)
}

/**
 * Build the drawn line for a walk. For each step a -> b: use the segment's `geom` (reversed when the
 * walk goes b -> a); if there is none, fall back to the two node coordinates and flag `approximate`.
 */
export function routeGeometry(
  path: readonly NodeId[],
  between: (a: NodeId, b: NodeId) => Segment | undefined,
  geomOf: (segmentId: string) => string | undefined,
  nodes: Readonly<Record<string, WalkNode>>,
): RouteGeometry {
  const points: LatLon[] = [];
  const stepStart: number[] = [];
  let approximate = false;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const seg = between(a, b);
    const encoded = seg ? geomOf(seg.id) : undefined;
    let piece: LatLon[];
    if (seg && encoded) {
      piece = decodePolyline(encoded);
      if (seg.a !== a) piece = piece.slice().reverse();
    } else {
      const na = nodes[a];
      const nb = nodes[b];
      if (!na || !nb) throw new Error(`unknown node in path: ${a} or ${b}`);
      piece = [[na.lat, na.lon], [nb.lat, nb.lon]];
      approximate = true;
    }
    stepStart.push(points.length === 0 ? 0 : points.length - 1);
    points.push(...(points.length === 0 ? piece : piece.slice(1)));
  }
  return { points, stepStart, approximate };
}
