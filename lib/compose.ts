import { COMPOSE_MAX_MILES, COMPOSE_MIN_MILES, HOME_ID } from './config';
import { adj, LANDMARKS, milesOf, nodes } from './graph';
import type { NodeId, WalkKind } from './types';

export interface ComposedWalk {
  path: NodeId[];
  kind: WalkKind;
}

export interface Composition {
  /** Simple cycles of up to 7 km found anywhere in the graph. */
  cycles: number;
  walks: ComposedWalk[];
  /** How long the composer took, ms. */
  ms: number;
}

const SPUR: Record<NodeId, NodeId> = { NB_MUSEUM: 'NCMA', WITTES_BRYANT: 'CEDARMERE' };
const reversedTail = (p: readonly NodeId[]) => p.slice(0, -1).reverse(); // p[-2::-1]

/** All simple paths from src, total length <= maxm meters. */
function simplePaths(src: NodeId, maxm: number): NodeId[][] {
  const out: NodeId[][] = [];
  const path: NodeId[] = [src];
  const rec = (n: NodeId, dist: number) => {
    out.push([...path]);
    for (const [nb, , m] of adj[n]) {
      if (path.includes(nb) || dist + m > maxm) continue;
      path.push(nb);
      rec(nb, dist + m);
      path.pop();
    }
  };
  rec(src, 0);
  return out;
}

/** Keyed by the undirected edge set, so each cycle is stored once. */
function findCycles(maxm = 7000): Map<string, NodeId[]> {
  const cycles = new Map<string, NodeId[]>();
  const edgeKey = (path: NodeId[], start: NodeId) =>
    path
      .map((n, i) => {
        const next = i + 1 < path.length ? path[i + 1] : start;
        return n < next ? `${n}|${next}` : `${next}|${n}`;
      })
      .sort()
      .join(',');

  for (const start of Object.keys(nodes)) {
    const path: NodeId[] = [start];
    const rec = (n: NodeId, dist: number) => {
      for (const [nb, , m] of adj[n]) {
        if (nb === start && path.length >= 3) {
          const key = edgeKey(path, start);
          if (!cycles.has(key)) cycles.set(key, [...path]);
          continue;
        }
        if (path.includes(nb) || dist + m > maxm || nb < start) continue;
        path.push(nb);
        rec(nb, dist + m);
        path.pop();
      }
    };
    rec(start, 0);
  }
  return cycles;
}

let cached: Composition | undefined;

/** Builds every closed walk the graph allows (§8). Cached in module scope. */
export function composeAll(): Composition {
  if (cached) return cached;
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const cycles = findCycles();
  const cycleList = [...cycles.values()];
  const cyclesByNode = new Map<NodeId, NodeId[][]>();
  for (const c of cycleList) {
    for (const n of c) cyclesByNode.set(n, [...(cyclesByNode.get(n) ?? []), c]);
  }

  const walks = new Map<string, ComposedWalk>();
  const add = (p: NodeId[], kind: WalkKind) => {
    const miles = milesOf(p);
    if (miles < COMPOSE_MIN_MILES || miles > COMPOSE_MAX_MILES) return;
    const key = p.join('>');
    if (!walks.has(key)) walks.set(key, { path: p, kind });
  };

  const paths = simplePaths(HOME_ID, 5000);

  // 2. out-and-backs
  for (const p of paths) {
    if (p.length > 1) add([...p, ...reversedTail(p)], 'out-and-back');
  }

  // 1. cycles through HOME, both directions
  for (const c of cycleList) {
    if (!c.includes(HOME_ID)) continue;
    const i = c.indexOf(HOME_ID);
    const r = [...c.slice(i), ...c.slice(0, i)];
    add([...r, HOME_ID], 'loop');
    add([r[0], ...r.slice(1).reverse(), HOME_ID], 'loop');
  }

  // 3. lollipops: a stem to J, a cycle through J that avoids the stem, the stem back
  for (const p of paths) {
    const J = p[p.length - 1];
    if (J === HOME_ID) continue;
    const stem = new Set(p.slice(0, -1));
    for (const c of cyclesByNode.get(J) ?? []) {
      if (c.some((n) => stem.has(n))) continue;
      const i = c.indexOf(J);
      const r = [...c.slice(i), ...c.slice(0, i)];
      for (const lp of [[...r, J], [J, ...r.slice(1).reverse(), J]]) {
        add([...p, ...lp.slice(1), ...reversedTail(p)], 'lollipop');
      }
    }
  }

  // 4. spurs: each loop iterates over a snapshot taken when it starts
  for (const base of [...walks.values()]) {
    for (const [hub, dest] of Object.entries(SPUR)) {
      const w = base.path;
      if (w.includes(hub) && !w.includes(dest)) {
        const i = w.indexOf(hub);
        add([...w.slice(0, i + 1), dest, hub, ...w.slice(i + 1)], base.kind);
      }
    }
  }
  for (const base of [...walks.values()]) {
    const w = base.path;
    if (w.includes('NB_MUSEUM') && w.includes('WITTES_BRYANT') && !w.includes('NCMA') && !w.includes('CEDARMERE')) {
      const i = w.indexOf('NB_MUSEUM');
      const w1 = [...w.slice(0, i + 1), 'NCMA', 'NB_MUSEUM', ...w.slice(i + 1)];
      const j = w1.indexOf('WITTES_BRYANT');
      add([...w1.slice(0, j + 1), 'CEDARMERE', 'WITTES_BRYANT', ...w1.slice(j + 1)], base.kind);
    }
  }

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  cached = { cycles: cycles.size, walks: [...walks.values()], ms: t1 - t0 };
  return cached;
}

let cachedOneWay: ComposedWalk[] | undefined;

/**
 * One-way walks (not in the spec's §8): every simple path from HOME of up to 5 km that finishes at
 * a named place. Same stem search the composer already runs; nothing new on the map.
 */
export function composeOneWay(): ComposedWalk[] {
  if (cachedOneWay) return cachedOneWay;
  cachedOneWay = simplePaths(HOME_ID, 5000)
    .filter((p) => LANDMARKS.includes(p[p.length - 1]))
    .filter((p) => {
      const miles = milesOf(p);
      return miles >= COMPOSE_MIN_MILES && miles <= COMPOSE_MAX_MILES;
    })
    .map((path) => ({ path, kind: 'one-way' as const }));
  return cachedOneWay;
}
