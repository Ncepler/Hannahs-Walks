import { CURATED } from '../data/curated';
import { CLIMB_MIN_PER_100FT, PACE_MIN_PER_MILE } from './config';
import { composeAll, composeOneWay } from './compose';
import { computeStats, isOneWay, traverse } from './graph';
import type { Mood, NodeId, Pace, Route, RouteStats, SegmentId, WalkKind } from './types';

export const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));

/* ---------- Mood scores (§9.2) ---------- */

export const apmOf = (s: RouteStats) => s.ascentFt / s.miles;

export function moodScores(s: RouteStats): Record<Mood, number> {
  const apm = apmOf(s);
  const gentle = 1 - clamp((0.5 * apm) / 150 + (0.5 * s.maxGradePct) / 8);
  const simple = 1 - clamp((s.turnsPerMile - 3) / 5);
  const lowBusy = 1 - clamp(s.busyShare * 3);
  const lenFitC = s.miles >= 0.4 && s.miles <= 2.5 ? 1 : clamp(1 - (s.miles - 2.5) / 3);
  const lenFitP = s.miles >= 1 && s.miles <= 5 ? 1 : s.miles < 1 ? clamp(s.miles) : clamp(1 - (s.miles - 5) / 3);

  const clear =
    0.35 * s.quietShare + 0.25 * gentle + 0.15 * simple + 0.1 * lowBusy + 0.1 * s.scenic + 0.05 * lenFitC - 0.3 * s.repeatShare;
  const workout =
    (0.4 * clamp(apm / 150) + 0.25 * clamp(s.miles / 4) + 0.2 * clamp(s.maxGradePct / 8) + 0.15 * (1 - s.busyShare)) *
    (0.4 + 0.6 * clamp(s.miles / 1.5));
  const ponder =
    0.4 * s.scenic + 0.2 * clamp(s.pois.length / 3) + 0.2 * s.quietShare + 0.1 * gentle + 0.1 * lenFitP - 0.3 * s.repeatShare;
  return { clear, workout, ponder };
}

/* ---------- Time (§9.3) ---------- */

export const minutesFor = (s: RouteStats, pace: Pace) =>
  s.miles * PACE_MIN_PER_MILE[pace] + (CLIMB_MIN_PER_100FT * s.ascentFt) / 100;

/** Display minutes rounded to the nearest 5. */
export const roundMinutes = (m: number) => Math.max(5, Math.round(m / 5) * 5);

/* ---------- Naming and blurbs (§8.3) ---------- */

const primaryStreet = (street: string) => street.split(' / ')[0].replace(/\s*\(.*\)$/, '').trim();
const shortStreet = (name: string) => name.replace(/\s+(Dr|Rd|Ln)$/, '');

const POI_SHORT: Record<string, string> = {
  CEDARMERE: 'Cedarmere',
  NCMA: 'Museum grounds',
  VIADUCT: 'The viaduct',
  VILLAGE: 'Roslyn village',
  LIBRARY: 'Bryant Library',
};
/** The landmark that names a route when several are visited. */
const POI_PRIORITY = ['CEDARMERE', 'NCMA', 'VIADUCT', 'VILLAGE', 'LIBRARY'];

const KIND_LABEL: Record<WalkKind, string> = {
  loop: 'Loop',
  'out-and-back': 'Out-and-Back',
  lollipop: 'Lollipop',
  'one-way': 'One Way',
  custom: 'Walk',
};

function topStreets(path: readonly NodeId[], skip?: string): string[] {
  const meters = new Map<string, number>();
  for (const t of traverse(path)) {
    const name = shortStreet(primaryStreet(t.seg.street));
    meters.set(name, (meters.get(name) ?? 0) + t.seg.meters);
  }
  return [...meters.entries()]
    .filter(([name]) => name !== skip)
    .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
    .slice(0, 3)
    .map(([name]) => name);
}

export function nameFor(path: readonly NodeId[], kind: WalkKind, stats: RouteStats): string {
  if (kind === 'one-way') {
    const end = path[path.length - 1];
    return `${POI_SHORT[end]} via ${topStreets(path, end === 'NCMA' ? 'Museum' : undefined)[0]}, one way`;
  }
  const poi = POI_PRIORITY.find((id) => stats.pois.includes(id));
  // "Museum grounds via Museum" says nothing, so the museum's own access road is skipped.
  if (poi) return `${POI_SHORT[poi]} via ${topStreets(path, poi === 'NCMA' ? 'Museum' : undefined)[0]}`;
  const streets = topStreets(path);
  const list = streets.length > 1 ? `${streets.slice(0, -1).join(', ')} & ${streets[streets.length - 1]}` : streets[0];
  return `${list} ${KIND_LABEL[kind]}`;
}

const BLURB_POI: Record<string, string> = {
  LIBRARY: 'past the library',
  VILLAGE: 'through Roslyn village',
  VIADUCT: 'to the viaduct',
  NCMA: 'out to the museum grounds',
  CEDARMERE: 'down to Cedarmere',
  POPLAR_ASH: 'over the ridge',
  POPLAR_W: 'over the ridge',
};

const END_PHRASE: Record<string, string> = {
  LIBRARY: 'the library',
  VILLAGE: 'Roslyn village',
  VIADUCT: 'the viaduct',
  NCMA: 'the museum grounds',
  CEDARMERE: 'Cedarmere',
};

export function blurbFor(s: RouteStats, finish?: NodeId): string {
  const apm = apmOf(s);
  const hills = apm > 100 ? 'A steady climb' : apm >= 70 ? 'A rolling walk' : 'A mostly flat walk';
  const traffic = s.quietShare >= 0.8 ? ' on quiet streets' : s.busyShare >= 0.2 ? ' with some time on busy roads' : ', mostly residential';
  // The finish is said once, in its own sentence.
  const places = s.pois.filter((id) => id !== finish).map((id) => BLURB_POI[id]).filter(Boolean).slice(0, 3);
  const tail = places.length > 1 ? `, ${places.slice(0, -1).join(', ')} and ${places[places.length - 1]}` : places.length ? `, ${places[0]}` : '';
  const sentence = `${hills}${traffic}${tail}.`;
  return finish && END_PHRASE[finish] ? `${sentence} You finish at ${END_PHRASE[finish]}, not at Home.` : sentence;
}

function tagsFor(s: RouteStats, kind: WalkKind): string {
  const area = s.pois.some((id) => ['VILLAGE', 'LIBRARY', 'VIADUCT'].includes(id))
    ? 'village'
    : s.pois.some((id) => ['NCMA', 'CEDARMERE'].includes(id))
      ? 'destination'
      : s.pois.length
        ? 'ridge'
        : 'neighborhood';
  return `${area} · ${kind}`;
}

/* ---------- Pool: curated plus composed (§8.3) ---------- */

export interface PoolRoute extends Route {
  segSet: ReadonlySet<SegmentId>;
  visited: ReadonlySet<NodeId>;
  scores: Record<Mood, number>;
}

function finish(r: Omit<Route, 'stats'> & { moods?: Mood[] }, stats: RouteStats): PoolRoute {
  const scores = moodScores(stats);
  const ranked = (Object.keys(scores) as Mood[]).sort((a, b) => scores[b] - scores[a]);
  const moods = r.moods?.length ? r.moods : ranked.filter((m, i) => i === 0 || scores[m] >= scores[ranked[0]] - 0.08);
  return {
    ...r,
    moods,
    stats,
    segSet: new Set(traverse(r.path).map((t) => t.seg.id)),
    visited: new Set(r.path),
    scores,
  };
}

const directedKey = (path: readonly NodeId[]) =>
  traverse(path)
    .map((t) => `${t.seg.id}${t.forward ? '+' : '-'}`)
    .sort()
    .join(',');

export interface Pool {
  routes: PoolRoute[];
  /** Walks that finish at a named place instead of Home. Only offered when the box is unchecked. */
  oneWay: PoolRoute[];
  curated: number;
  composed: number;
  /** Composed walks dropped because a curated route covers the same segments the same way. */
  duplicatesDropped: number;
}

let pool: Pool | undefined;

export function getPool(): Pool {
  if (pool) return pool;
  const routes: PoolRoute[] = CURATED.map((c) =>
    finish(
      { id: c.id, name: c.name, origin: 'curated', path: [...c.path], moods: [...c.moods], blurb: c.blurb, tags: c.tags },
      computeStats(c.path),
    ),
  );
  const seen = new Set(routes.map((r) => directedKey(r.path)));

  const { walks } = composeAll();
  const sorted = [...walks].sort((a, b) => (a.path.join('>') < b.path.join('>') ? -1 : 1));
  let dropped = 0;
  let n = 0;
  for (const w of sorted) {
    if (seen.has(directedKey(w.path))) {
      dropped++;
      continue;
    }
    const stats = computeStats(w.path);
    n++;
    routes.push(
      finish(
        {
          id: `G${String(n).padStart(4, '0')}`,
          name: nameFor(w.path, w.kind, stats),
          origin: 'generated',
          path: w.path,
          moods: [],
          blurb: blurbFor(stats),
          tags: tagsFor(stats, w.kind),
          kind: w.kind,
        },
        stats,
      ),
    );
  }
  const oneWay = [...composeOneWay()]
    .sort((a, b) => (a.path.join('>') < b.path.join('>') ? -1 : 1))
    .map((w, i) => {
      const stats = computeStats(w.path);
      return finish(
        {
          id: `W${String(i + 1).padStart(4, '0')}`,
          name: nameFor(w.path, w.kind, stats),
          origin: 'generated',
          path: w.path,
          moods: [],
          blurb: blurbFor(stats, w.path[w.path.length - 1]),
          tags: tagsFor(stats, w.kind),
          kind: w.kind,
        },
        stats,
      );
    });
  pool = { routes, oneWay, curated: CURATED.length, composed: n, duplicatesDropped: dropped };
  return pool;
}

/** Builds a pool-shaped route from any validated path (used for AI answers). */
export function routeFromPath(
  id: string,
  name: string,
  origin: Route['origin'],
  path: readonly NodeId[],
  moods: Mood[],
  blurb?: string,
): PoolRoute {
  return finish({ id, name, origin, path: [...path], moods, blurb, kind: 'custom' }, computeStats(path));
}

/* ---------- Matching (§9.4) ---------- */

export type Hills = 'flat' | 'rolling' | 'hilly' | 'any';
export type DistanceBand = '<1' | '1-2' | '2-3' | '3-5' | '5+';
export type Stop = 'village' | 'museum' | 'cedarmere' | 'library' | 'ridge' | 'pond';

export interface TimeChoice {
  min: number;
  /** "2 hr +": anything from 100 minutes up. */
  orMore?: boolean;
}

export interface Answers {
  mood: Mood;
  /** The "End back at Home" box. On by default; off also considers one-way walks. */
  returnHome: boolean;
  time: TimeChoice | null;
  distance: DistanceBand | null;
  hills: Hills;
  stops: ReadonlySet<Stop>;
  avoidBusy: boolean;
  pace: Pace;
}

/** §9.5 defaults when the user skips a question. */
export function defaultAnswers(mood: Mood): Answers {
  return {
    mood,
    returnHome: true,
    time: null,
    distance: null,
    hills: 'any',
    stops: new Set(),
    avoidBusy: mood === 'clear',
    pace: mood === 'workout' ? 'brisk' : mood === 'clear' ? 'steady' : 'easy',
  };
}

const STOP_NODES: Record<Stop, readonly NodeId[]> = {
  village: ['VILLAGE'],
  museum: ['NCMA'],
  cedarmere: ['CEDARMERE'],
  library: ['LIBRARY'],
  ridge: ['POPLAR_ASH'],
  pond: ['VILLAGE', 'VIADUCT'],
};
const STOP_LABEL: Record<Stop, string> = {
  village: 'Roslyn village',
  museum: 'the museum grounds',
  cedarmere: 'Cedarmere',
  library: 'the library',
  ridge: 'the ridge',
  pond: 'the pond',
};
const BAND_LABEL: Record<DistanceBand, string> = {
  '<1': 'under 1 mi',
  '1-2': '1 to 2 mi',
  '2-3': '2 to 3 mi',
  '3-5': '3 to 5 mi',
  '5+': '5 mi or more',
};
const HILLS_LABEL: Record<Hills, string> = { flat: 'flat', rolling: 'rolling hills', hilly: 'big hills', any: 'any hills' };

function timeLabel(t: TimeChoice): string {
  if (t.orMore) return 'two hours or more';
  if (t.min === 60) return 'an hour';
  if (t.min === 90) return 'an hour and a half';
  return `${t.min} minutes`;
}

const visitsStop = (r: PoolRoute, stop: Stop) => STOP_NODES[stop].some((id) => r.visited.has(id));
const bandMiles: Record<DistanceBand, [number, number]> = { '<1': [0, 1], '1-2': [1, 2], '2-3': [2, 3], '3-5': [3, 5], '5+': [5, Infinity] };
const inBand = (miles: number, band: DistanceBand) => miles >= bandMiles[band][0] && (miles < bandMiles[band][1] || band === '5+');
const hillsOk = (apm: number, h: Hills) => (h === 'any' ? true : h === 'flat' ? apm <= 70 : h === 'rolling' ? apm > 70 && apm <= 100 : apm > 100);
const timeOk = (minutes: number, t: TimeChoice) => (t.orMore ? minutes >= 100 : minutes >= 0.8 * t.min && minutes <= 1.2 * t.min);

interface Filter {
  key: 'avoidBusy' | 'stops' | 'hills' | 'time' | 'distance';
  active: boolean;
  label: string;
  test: (r: PoolRoute, minutes: number) => boolean;
}

function buildFilters(a: Answers): Filter[] {
  // Listed top to bottom; relaxation drops from the bottom up.
  return [
    { key: 'avoidBusy', active: a.avoidBusy, label: 'no busy roads', test: (r) => r.stats.busyShare <= 0.1 },
    {
      key: 'stops',
      active: a.stops.size > 0,
      label: [...a.stops].map((s) => STOP_LABEL[s]).join(' and '),
      test: (r) => [...a.stops].every((s) => visitsStop(r, s)),
    },
    { key: 'hills', active: a.hills !== 'any', label: HILLS_LABEL[a.hills], test: (r) => hillsOk(apmOf(r.stats), a.hills) },
    { key: 'time', active: !!a.time, label: a.time ? timeLabel(a.time) : '', test: (_r, m) => (a.time ? timeOk(m, a.time) : true) },
    { key: 'distance', active: !!a.distance, label: a.distance ? BAND_LABEL[a.distance] : '', test: (r) => (a.distance ? inBand(r.stats.miles, a.distance) : true) },
  ];
}

function prefFit(r: PoolRoute, a: Answers): number {
  const fits: number[] = [];
  if (a.stops.size) fits.push([...a.stops].filter((s) => visitsStop(r, s)).length / a.stops.size);
  if (a.hills !== 'any') {
    const apm = apmOf(r.stats);
    const gap = a.hills === 'flat' ? apm - 70 : a.hills === 'hilly' ? 100 - apm : apm <= 70 ? 70 - apm : apm - 100;
    fits.push(hillsOk(apm, a.hills) ? 1 : 1 - clamp(Math.max(0, gap) / 70));
  }
  if (a.distance) {
    const [lo, hi] = bandMiles[a.distance];
    const gap = r.stats.miles < lo ? lo - r.stats.miles : r.stats.miles > hi ? r.stats.miles - hi : 0;
    fits.push(1 - clamp(gap / 2));
  }
  if (a.avoidBusy) fits.push(1 - clamp((r.stats.busyShare - 0.1) / 0.3));
  // Unchecking "End back at Home" says finishing elsewhere is welcome, so one-way walks are preferred.
  if (!a.returnHome) fits.push(isOneWay(r.path) ? 1 : 0);
  return fits.length ? fits.reduce((x, y) => x + y, 0) / fits.length : 1;
}

export interface Scored {
  route: PoolRoute;
  minutes: number;
  score: number;
}

export interface Candidates {
  ranked: Scored[];
  /** Labels for the constraints that had to be loosened, bottom-up. */
  relaxed: string[];
  /** Survivors of the hard filters that were still applied. */
  count: number;
}

export function rank(a: Answers): Candidates {
  const { routes, oneWay } = getPool();
  const all = (a.returnHome ? routes : [...routes, ...oneWay]).map((route) => ({ route, minutes: minutesFor(route.stats, a.pace) }));
  const filters = buildFilters(a);
  const active = filters.filter((f) => f.active);
  const relaxed: string[] = [];
  let survivors = all;
  for (;;) {
    survivors = all.filter(({ route, minutes }) => active.every((f) => f.test(route, minutes)));
    if (survivors.length || !active.length) break;
    relaxed.push(active.pop()!.label);
  }
  const t = a.time;
  const tTarget = t ? (t.orMore ? 120 : t.min) : 0;
  const ranked = survivors
    .map(({ route, minutes }) => {
      const timeFit = !t ? 1 : t.orMore && minutes >= tTarget ? 1 : 1 - clamp(Math.abs(minutes - tTarget) / (0.35 * tTarget));
      const score =
        0.55 * route.scores[a.mood] + 0.25 * timeFit + 0.1 * prefFit(route, a) + 0.1 * (route.origin === 'curated' ? 1 : 0);
      return { route, minutes, score };
    })
    .sort((x, y) => y.score - x.score || (x.route.id < y.route.id ? -1 : 1));
  return { ranked, relaxed, count: survivors.length };
}

/* ---------- Diversity and "show another" (§9.4 steps 3 - 6) ---------- */

const jaccard = (a: ReadonlySet<string>, b: ReadonlySet<string>) => {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
};

/** Top `window` by score, then up to `n` greedy picks whose segment sets overlap at most `maxJaccard`. */
export function diversePicks(ranked: Scored[], start = 0, window = 40, n = 5, maxJaccard = 0.55): Scored[] {
  const picks: Scored[] = [];
  for (const cand of ranked.slice(start, start + window)) {
    if (picks.every((p) => jaccard(p.route.segSet, cand.route.segSet) <= maxJaccard)) picks.push(cand);
    if (picks.length === n) break;
  }
  return picks;
}

/** Small seeded generator so a tap can be reproduced in tests. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const freshRng = () => mulberry32((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);

const RECENT_KEY = 'sw_recent';
const RECENT_MAX = 5;
let recent: string[] | undefined;

function recentIds(): string[] {
  if (!recent) {
    recent = [];
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(RECENT_KEY) : null;
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) recent = parsed.filter((x): x is string => typeof x === 'string').slice(-RECENT_MAX);
    } catch {
      /* storage can be blocked */
    }
  }
  return recent;
}

function remember(id: string) {
  const list = recentIds().filter((x) => x !== id);
  list.push(id);
  recent = list.slice(-RECENT_MAX);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    /* storage can be blocked */
  }
}

export interface PlanSession {
  answers: Answers;
  ranked: Scored[];
  relaxed: string[];
  /** True when every constraint had to go: nothing fit, this is the closest. */
  closest: boolean;
  current: PoolRoute;
  windowStart: number;
  queue: Scored[];
}

/** Picks the first route. Pass a seeded `rng` in tests. */
export function plan(answers: Answers, rng: () => number = freshRng()): PlanSession {
  const { ranked, relaxed } = rank(answers);
  const picks = diversePicks(ranked);
  const fresh = picks.filter((p) => !recentIds().includes(p.route.id));
  const pool = fresh.length ? fresh : picks;
  // Show pick #1, or sometimes #2, for variety.
  const first = pool.length > 1 && rng() < 0.5 ? pool[1] : pool[0];
  const session: PlanSession = {
    answers,
    ranked,
    relaxed,
    closest: relaxed.length > 0 && relaxed.length === buildFilters(answers).filter((f) => f.active).length,
    current: first.route,
    windowStart: 0,
    queue: picks.filter((p) => p !== first),
  };
  remember(first.route.id);
  return session;
}

/**
 * "Show me another": remaining picks first, then a re-roll from the next 40.
 * Never the same route twice in a row, and not one that carries the same name either, since
 * different routes can share a name (§8.3) and would look like a repeat. The name rule gives
 * way before the id rule does.
 */
export function another(session: PlanSession): PoolRoute {
  const bad = new Set(recentIds());
  bad.add(session.current.id);

  const search = (sameNameOk: boolean) => {
    const take = () => {
      const i = session.queue.findIndex(
        (p) => !bad.has(p.route.id) && (sameNameOk || p.route.name !== session.current.name),
      );
      return i === -1 ? undefined : session.queue.splice(i, 1)[0];
    };
    let found = take();
    const windows = Math.max(1, Math.ceil(session.ranked.length / 40));
    for (let w = 0; !found && w < windows; w++) {
      session.windowStart += 40;
      if (session.windowStart >= session.ranked.length) session.windowStart = 0;
      session.queue = diversePicks(session.ranked, session.windowStart);
      found = take();
    }
    return found;
  };

  let pick = search(false) ?? search(true);
  if (!pick) {
    // Everything left was shown recently: settle for anything other than the current route.
    pick = session.ranked.find((s) => s.route.id !== session.current.id);
  }
  if (pick) {
    session.current = pick.route;
    remember(pick.route.id);
  }
  return session.current;
}
