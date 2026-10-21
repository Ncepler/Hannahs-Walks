// Run from the repo root: npx tsx scripts/acceptance.ts
// Imports the real data and libs. The only literals are the expected numbers from the spec.
import fs from 'node:fs';
import path from 'node:path';
import { CURATED } from '../data/curated';
import { NODES } from '../data/nodes';
import { SEGMENTS } from '../data/segments';
import { METERS_PER_MILE } from '../lib/config';
import { composeAll, composeOneWay } from '../lib/compose';
import { buildDirections, fmtStepDistance, stepsToText, turnWord } from '../lib/directions';
import { embedUrl, mapsLink, selectWaypoints, simulate } from '../lib/maps';
import { MAPS_MAX_WAYPOINTS } from '../lib/config';
import { computeStats, isOneWay, LANDMARKS, milesOf, reversalHolds, segmentsBetween, traverse, validatePath } from '../lib/graph';
import { another, apmOf, defaultAnswers, diversePicks, getPool, minutesFor, plan, rank, type Answers, type Stop } from '../lib/score';
import type { Mood } from '../lib/types';

let failures = 0;
const section = (title: string) => console.log(`\n${title}`);
function check(id: string, what: string, ok: boolean, actual: string) {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${id}  ${what}  [${actual}]`);
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// §7 test vector: id, miles, meters, climb ft, max grade %, quiet %, busy %, scenic,
// clear, workout, ponder, minutes at 20 min/mi (+3 min per 100 ft).
type VectorRow = [string, number, number, number, number, number, number, number, number, number, number, number];
const VECTOR: VectorRow[] = [
  ['R01', 0.63, 1017.9, 94, 7.8, 100, 0, 0.51, 0.56, 0.51, 0.47, 15],
  ['R02', 0.46, 747.4, 27, 3.9, 100, 0, 0.33, 0.67, 0.25, 0.44, 10],
  ['R03', 0.87, 1396.2, 110, 7.2, 100, 0, 0.33, 0.60, 0.54, 0.43, 21],
  ['R04', 1.11, 1786.9, 103, 7.8, 100, 0, 0.60, 0.63, 0.56, 0.56, 25],
  ['R05', 1.28, 2060.8, 92, 7.2, 100, 0, 0.44, 0.63, 0.55, 0.51, 28],
  ['R06', 1.46, 2353.6, 153, 7.8, 100, 0, 0.53, 0.67, 0.70, 0.53, 34],
  ['R07', 1.44, 2318.0, 130, 7.2, 100, 0, 0.33, 0.63, 0.65, 0.46, 33],
  ['R08', 2.13, 3426.2, 162, 7.8, 100, 0, 0.61, 0.70, 0.68, 0.64, 47],
  ['R09', 2.87, 4620.5, 168, 8.5, 54, 13, 0.53, 0.53, 0.67, 0.51, 62],
  ['R10', 2.87, 4620.5, 168, 8.5, 54, 13, 0.53, 0.53, 0.67, 0.51, 62],
  ['R11', 3.65, 5876.4, 222, 8.5, 42, 20, 0.45, 0.44, 0.71, 0.46, 80],
  ['R12', 2.98, 4798.8, 157, 7.2, 48, 7, 0.60, 0.54, 0.65, 0.54, 64],
  ['R13', 3.95, 6357.2, 333, 7.2, 36, 35, 0.46, 0.35, 0.75, 0.45, 89],
  ['R14', 4.04, 6495.4, 384, 8.5, 52, 17, 0.53, 0.41, 0.83, 0.56, 92],
  ['R15', 4.29, 6904.3, 384, 8.5, 49, 16, 0.59, 0.42, 0.81, 0.59, 97],
  ['R16', 5.11, 8228.9, 417, 8.5, 41, 37, 0.61, 0.36, 0.76, 0.64, 115],
  ['R17', 6.01, 9668.5, 313, 7.2, 16, 44, 0.49, 0.32, 0.65, 0.53, 130],
  ['R18', 4.37, 7035.2, 436, 8.5, 60, 0, 0.71, 0.54, 0.87, 0.65, 101],
  ['R19', 3.11, 5010.6, 382, 8.5, 100, 0, 0.63, 0.56, 0.87, 0.53, 74],
  ['R20', 4.75, 7637.5, 344, 7.2, 30, 29, 0.49, 0.33, 0.73, 0.52, 105],
  ['R21', 5.27, 8482.2, 346, 7.2, 27, 26, 0.60, 0.38, 0.72, 0.55, 116],
  ['R22', 0.70, 1131.2, 37, 3.9, 100, 0, 0.33, 0.68, 0.29, 0.46, 15],
];

function phase1() {
  section('Data (Phase 1)');

  const nodeIds = Object.keys(NODES);
  const totalM = SEGMENTS.reduce((sum, s) => sum + s.meters, 0);
  check('A1', '39 nodes', nodeIds.length === 39, `${nodeIds.length}`);
  check('A1', '48 segments', SEGMENTS.length === 48, `${SEGMENTS.length}`);
  check('A1', 'total length 19,347.9 m (±0.5)', near(totalM, 19347.9, 0.5), `${totalM.toFixed(1)} m = ${(totalM / METERS_PER_MILE).toFixed(2)} mi`);

  const missing = SEGMENTS.filter((s) => !(s.a in NODES) || !(s.b in NODES)).map((s) => s.id);
  const dupes = SEGMENTS.filter((s) => segmentsBetween(s.a, s.b).length !== 1).map((s) => s.id);
  check('A2', 'every segment end exists', missing.length === 0, missing.join(',') || 'none missing');
  check('A2', 'no duplicate segment between a node pair', dupes.length === 0, dupes.join(',') || 'none duplicated');

  const invalid = CURATED.filter((r) => !validatePath([...r.path]).ok).map((r) => r.id);
  check('A3', `${CURATED.length} curated routes pass the validators`, invalid.length === 0, invalid.join(',') || 'all valid');

  const byId = new Map(VECTOR.map((row) => [row[0], row]));
  const off: string[] = [];
  let compared = 0;
  for (const r of CURATED) {
    const v = byId.get(r.id);
    const st = computeStats([...r.path]);
    if (!v) {
      off.push(`${r.id}: not in vector`);
      continue;
    }
    compared++;
    const [, mi, m, climb, grade, quiet, busy, scenic, , , , minutes] = v;
    const mins = st.miles * 20 + (3 * st.ascentFt) / 100;
    if (!near(st.meters, m, 1)) off.push(`${r.id} meters ${st.meters.toFixed(1)} vs ${m}`);
    if (!near(st.miles, mi, 0.005)) off.push(`${r.id} miles ${st.miles.toFixed(2)} vs ${mi}`);
    if (!near(st.ascentFt, climb, 1)) off.push(`${r.id} ascent ${st.ascentFt} vs ${climb}`);
    if (!near(st.maxGradePct, grade, 0.05)) off.push(`${r.id} grade ${st.maxGradePct.toFixed(2)} vs ${grade}`);
    if (!near(st.quietShare * 100, quiet, 0.5)) off.push(`${r.id} quiet ${(st.quietShare * 100).toFixed(1)} vs ${quiet}`);
    if (!near(st.busyShare * 100, busy, 0.5)) off.push(`${r.id} busy ${(st.busyShare * 100).toFixed(1)} vs ${busy}`);
    if (!near(st.scenic, scenic, 0.005)) off.push(`${r.id} scenic ${st.scenic.toFixed(3)} vs ${scenic}`);
    if (Math.round(mins) !== minutes) off.push(`${r.id} minutes ${mins.toFixed(1)} vs ${minutes}`);
  }
  check('A4', `meters ±1, miles, ascent ±1 ft (and grade, quiet, busy, scenic, minutes) match the vector for ${compared} routes`, off.length === 0 && compared === CURATED.length, off.join('; ') || 'all match');

  const badReverse = CURATED.filter((r) => !reversalHolds([...r.path])).map((r) => r.id);
  check('A5', 'reversing a route keeps meters and swaps ascent/descent', badReverse.length === 0, badReverse.join(',') || 'all hold');

  const root = process.cwd();
  const files: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|tsx|css|html|txt|svg)$/.test(entry.name)) files.push(p);
    }
  };
  for (const d of ['app', 'components', 'lib']) walk(path.join(root, d));
  const streets = '(?:Birch|Elm|Chestnut|Sycamore|Cypress|Fir|Poplar|Ash|Pinewood|Teakwood|Midwood|Maplewood|Greenwood|Harbor Hill|Round Hill|Glen Cove|Northern|Museum|Wittes|Bryant|Old Northern|East Broadway|Main|Glen|Roslyn|Red Ground|Old Farm)';
  const houseNumber = new RegExp(`\\b\\d{1,5}\\s+(?:[NSEW]\\.?\\s+)?${streets}\\b`);
  const hits: string[] = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const rel = path.relative(root, f);
    if (houseNumber.test(text)) hits.push(`${rel}: house number next to a street name`);
    if (/11576/.test(text)) hits.push(`${rel}: ZIP code`);
    if (/console\.log/.test(text)) hits.push(`${rel}: console.log`);
  }
  const layout = fs.readFileSync(path.join(root, 'app/layout.tsx'), 'utf8');
  if (new RegExp(`${streets}|East Hills|Searingtown`).test(layout)) hits.push('app/layout.tsx: place or street name in metadata');
  check('A6', `no house number, ZIP, console.log or place name in metadata (${files.length} files scanned)`, hits.length === 0, hits.join('; ') || 'clean');
}

function phase2() {
  section('Composer and scoring (Phase 2)');

  const comp = composeAll();
  const bad = comp.walks.filter((w) => !validatePath(w.path).ok).length;
  const outside = comp.walks.filter((w) => {
    const mi = milesOf(w.path);
    return mi < 0.4 || mi > 7.5;
  }).length;
  const multisets = new Set(comp.walks.map((w) => traverse(w.path).map((t) => t.seg.id).sort().join(','))).size;
  check('A7', '116 simple cycles', comp.cycles === 116, `${comp.cycles}`);
  check('A7', '3,296 closed walks', comp.walks.length === 3296, `${comp.walks.length} in ${comp.ms.toFixed(0)} ms`);
  check('A7', 'all walks pass the validators, none outside 0.4 - 7.5 mi', bad === 0 && outside === 0, `${bad} invalid, ${outside} out of range`);
  check('A7', '2,307 distinct segment multisets', multisets === 2307, `${multisets}`);

  const pool = getPool();
  const curated = pool.routes.filter((r) => r.origin === 'curated');
  const top = (mood: Mood, n: number) => [...curated].sort((a, b) => b.scores[mood] - a.scores[mood]).slice(0, n).map((r) => r.id);
  const inSet = (ids: string[], allowed: string[]) => ids.every((id) => allowed.includes(id));
  const clearTop = top('clear', 3);
  const workTop = top('workout', 4);
  const ponderTop = top('ponder', 4);
  check('A8', 'clear: top 3 within {R02,R04,R05,R06,R08,R22}', inSet(clearTop, ['R02', 'R04', 'R05', 'R06', 'R08', 'R22']), clearTop.join(' '));
  check('A8', 'workout: top 4 within {R14,R15,R16,R18,R19}, R18 and R19 first two', inSet(workTop, ['R14', 'R15', 'R16', 'R18', 'R19']) && inSet(workTop.slice(0, 2), ['R18', 'R19']), workTop.join(' '));
  check('A8', 'ponder: top 4 within {R04,R08,R15,R16,R18}, R18 or R08 first', inSet(ponderTop, ['R04', 'R08', 'R15', 'R16', 'R18']) && ['R18', 'R08'].includes(ponderTop[0]), ponderTop.join(' '));
  const offScores: string[] = [];
  for (const row of VECTOR) {
    const r = curated.find((c) => c.id === row[0])!;
    const [, , , , , , , , c, w, p] = row;
    if (!near(r.scores.clear, c, 0.0051)) offScores.push(`${row[0]} clear ${r.scores.clear.toFixed(3)} vs ${c}`);
    if (!near(r.scores.workout, w, 0.0051)) offScores.push(`${row[0]} work ${r.scores.workout.toFixed(3)} vs ${w}`);
    if (!near(r.scores.ponder, p, 0.0051)) offScores.push(`${row[0]} ponder ${r.scores.ponder.toFixed(3)} vs ${p}`);
  }
  check('A8', 'all 66 mood scores match the §7 vector to 2 decimals', offScores.length === 0, offScores.join('; ') || 'all match');
  console.log(`  INFO  pool: ${pool.curated} curated + ${pool.composed} composed (${pool.duplicatesDropped} composed dropped as curated duplicates)`);

  const base = (mood: Mood, over: Partial<Answers>): Answers => ({ ...defaultAnswers(mood), pace: 'steady', ...over });
  const stops = (...s: Stop[]) => new Set<Stop>(s);

  const a1 = base('clear', { time: { min: 30 }, hills: 'flat', avoidBusy: true });
  const r1 = rank(a1);
  const t1 = r1.ranked[0];
  check('A9', 'clear, 30 min, flat, avoid busy: 24 - 36 min, apm <= 70, busy <= 0.10, nothing relaxed', !!t1 && r1.relaxed.length === 0 && t1.minutes >= 24 && t1.minutes <= 36 && apmOf(t1.route.stats) <= 70 && t1.route.stats.busyShare <= 0.1, `${t1?.route.name}: ${t1?.minutes.toFixed(0)} min, apm ${t1 ? apmOf(t1.route.stats).toFixed(0) : '-'}; ${r1.count} candidates in the pool`);

  const a2 = base('workout', { time: { min: 90 }, hills: 'hilly' });
  const r2 = rank(a2);
  const t2 = r2.ranked[0];
  check('A9', 'workout, 90 min, hilly: 72 - 108 min, apm > 100, nothing relaxed', !!t2 && r2.relaxed.length === 0 && t2.minutes >= 72 && t2.minutes <= 108 && apmOf(t2.route.stats) > 100, `${t2?.route.name}: ${t2?.minutes.toFixed(0)} min, apm ${t2 ? apmOf(t2.route.stats).toFixed(0) : '-'}; ${r2.count} candidates in the pool`);

  const a3 = base('ponder', { stops: stops('museum') });
  const r3 = rank(a3);
  check('A9', 'ponder with stop museum: visits NCMA', r3.relaxed.length === 0 && !!r3.ranked[0]?.route.visited.has('NCMA'), `${r3.ranked[0]?.route.name}; ${r3.count} candidates`);

  const a4 = base('ponder', { time: { min: 120, orMore: true }, stops: stops('cedarmere', 'museum') });
  const r4 = rank(a4);
  const t4 = r4.ranked[0];
  check('A9', 'ponder, 2 hr +, Cedarmere + museum: visits both', r4.relaxed.length === 0 && !!t4 && t4.route.visited.has('NCMA') && t4.route.visited.has('CEDARMERE') && t4.minutes >= 100, `${t4?.route.name}: ${t4?.minutes.toFixed(0)} min; ${r4.count} candidates in the pool`);

  // The reference run counts composed walks before curated duplicates are dropped from the pool.
  const composedAll = comp.walks.map((w) => ({ path: w.path, stats: computeStats(w.path) }));
  const refCount = (pred: (x: (typeof composedAll)[number], minutes: number) => boolean) =>
    composedAll.filter((x) => pred(x, minutesFor(x.stats, 'steady'))).length;
  const n1 = refCount((x, m) => m >= 24 && m <= 36 && apmOf(x.stats) <= 70 && x.stats.busyShare <= 0.1);
  const n2 = refCount((x, m) => m >= 72 && m <= 108 && apmOf(x.stats) > 100);
  const n4 = refCount((x, m) => m >= 100 && x.path.includes('NCMA') && x.path.includes('CEDARMERE'));
  check('A9', 'reference candidate counts reproduce (composed walks, before curated dedupe): 4, 30, 223', n1 === 4 && n2 === 30 && n4 === 223, `${n1}, ${n2}, ${n4}`);

  const repeats: string[] = [];
  for (const answers of [defaultAnswers('ponder'), a1, a4, defaultAnswers('workout')]) {
    const session = plan(answers);
    let prev = session.current.id;
    for (let i = 0; i < 100; i++) {
      const next = another(session).id;
      if (next === prev) repeats.push(`${answers.mood}@${i}`);
      prev = next;
    }
  }
  check('A10', '100 "Show me another" calls on 4 different sessions never repeat a route back to back', repeats.length === 0, repeats.join(',') || '400 calls, 0 repeats');

  // Different routes can share a name, so a name repeat reads as a repeat. Checked where alternatives are plentiful.
  const sameName: string[] = [];
  for (const answers of [defaultAnswers('ponder'), defaultAnswers('workout'), defaultAnswers('clear')]) {
    const session = plan(answers);
    let prev = session.current.name;
    for (let i = 0; i < 100; i++) {
      const next = another(session).name;
      if (next === prev) sameName.push(`${answers.mood}@${i}`);
      prev = next;
    }
  }
  check('A10', 'and never repeat a route name back to back where other routes exist (3 broad sessions)', sameName.length === 0, sameName.join(',') || '300 calls, 0 repeated names');
}

// "End back at Home" (added after the spec): checked by default, unchecked also offers one-way walks.
function oneWay() {
  section('End back at Home');
  const walks = composeOneWay();
  const bad = walks.filter((w) => {
    const p = w.path;
    const ends = LANDMARKS.includes(p[p.length - 1]);
    const simple = new Set(p).size === p.length;
    const mi = milesOf(p);
    return !validatePath(p, { oneWay: true }).ok || !isOneWay(p) || !ends || !simple || mi < 0.4 || mi > 7.5;
  }).length;
  const pool = getPool();
  check('X1', 'one-way walks: simple paths from HOME ending at a named place, valid, 0.4 - 7.5 mi', walks.length > 0 && bad === 0, `${walks.length} walks, ${bad} bad, ${Math.min(...pool.oneWay.map((r) => r.stats.miles)).toFixed(2)} - ${Math.max(...pool.oneWay.map((r) => r.stats.miles)).toFixed(2)} mi`);
  check('X1', 'the closed-walk pool contains no one-way walk', pool.routes.every((r) => !isOneWay(r.path)), `${pool.routes.length} closed routes`);
  check('X1', 'the validator still rejects an open path unless oneWay is set', !validatePath(['HOME', 'BIRCH_ELM'], {}).ok && validatePath(['HOME', 'BIRCH_SYC', 'SYC_FIR', 'FIR_CHEST', 'GREEN_CHEST', 'CHEST_NB', 'NB_MUSEUM', 'NCMA'], { oneWay: true }).ok, 'default rejects an open path; oneWay accepts it');

  // Checked (the default): every result ends at Home, for every mood and for 100 show-another calls each.
  const open: string[] = [];
  for (const mood of ['clear', 'workout', 'ponder'] as const) {
    const answers = defaultAnswers(mood);
    if (!answers.returnHome) open.push(`${mood}: default is not checked`);
    open.push(...rank(answers).ranked.filter((s) => isOneWay(s.route.path)).map((s) => `${mood}:${s.route.id}`));
    const session = plan(answers);
    if (isOneWay(session.current.path)) open.push(`${mood}: first result`);
    for (let i = 0; i < 100; i++) if (isOneWay(another(session).path)) open.push(`${mood}: another #${i}`);
  }
  check('X2', 'checked by default: every result and 300 show-another calls end back at HOME', open.length === 0, open.slice(0, 4).join('; ') || 'all closed');

  // Unchecked: one-way walks are offered when the time fits.
  const shown: string[] = [];
  let missing = 0;
  for (const mood of ['clear', 'workout', 'ponder'] as const) {
    const a: Answers = { ...defaultAnswers(mood), pace: 'steady', time: { min: 60 }, returnHome: false };
    const n = diversePicks(rank(a).ranked).filter((s) => isOneWay(s.route.path)).length;
    const checked = diversePicks(rank({ ...a, returnHome: true }).ranked).filter((s) => isOneWay(s.route.path)).length;
    shown.push(`${mood} ${n}/5 (checked: ${checked})`);
    if (n < 1 || checked !== 0) missing++;
  }
  check('X3', 'unchecked, 60 min: each mood gets at least one one-way pick of 5; checked gets none', missing === 0, shown.join(', '));
}

function phase4() {
  section('Directions and maps (Phase 4)');
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((n, i) => n === b[i]);

  // A11: at most MAPS_MAX_WAYPOINTS nodes, and either the simulated path matches or the route is flagged approximate.
  let exact = 0;
  const wrong: string[] = [];
  const approx: string[] = [];
  for (const r of CURATED) {
    const path = [...r.path];
    const { waypoints, exact: flag } = selectWaypoints(path);
    const sim = simulate(['HOME', ...waypoints, 'HOME']);
    if (waypoints.length > MAPS_MAX_WAYPOINTS) wrong.push(`${r.id}: ${waypoints.length} waypoints`);
    if (flag !== same(sim, path)) wrong.push(`${r.id}: flag ${flag} disagrees with the simulation`);
    if (flag) exact++;
    else approx.push(r.id);
  }
  check('A11', `every curated route: at most ${MAPS_MAX_WAYPOINTS} waypoints, and exact or flagged approximate`, wrong.length === 0, `${exact} exact, ${approx.length} approximate (${approx.join(' ')})` + (wrong.length ? `; ${wrong.join('; ')}` : ''));

  // Links
  const r04 = [...CURATED.find((c) => c.id === 'R04')!.path];
  const w = selectWaypoints(r04).waypoints;
  const link = mapsLink(r04, w);
  const withOrigin = mapsLink(r04, w, { startFromHome: true });
  const streets = /Birch|Elm|Chestnut|Sycamore|Cypress|Drive|Road|Lane/;
  check('A11', 'deep link: walking, Home coordinates as destination, pipe-encoded waypoints, no origin, no address', link.startsWith('https://www.google.com/maps/dir/?api=1&') && link.includes('destination=40.80055,-73.62756') && link.includes('travelmode=walking') && (w.length < 2 || link.includes('%7C')) && !link.includes('origin=') && !streets.test(link), link.replace('https://www.google.com/maps/dir/', '…/'));
  check('A11', '"Start from Home" adds origin with the Home coordinates', withOrigin.includes('origin=40.80055,-73.62756'), 'origin present');
  const oneWayRoute = getPool().oneWay[0];
  const owLink = mapsLink(oneWayRoute.path, selectWaypoints(oneWayRoute.path).waypoints);
  const end = oneWayRoute.path[oneWayRoute.path.length - 1];
  check('A11', 'one-way link ends at the finish, not Home', owLink.includes(`destination=${NODES[end as keyof typeof NODES].lat},${NODES[end as keyof typeof NODES].lon}`) && !owLink.includes('destination=40.80055,-73.62756'), end);
  check('A11', 'no Embed URL without a key; with one it is a walking directions URL', embedUrl(r04, w, undefined) === null && (embedUrl(r04, w, 'K') ?? '').includes('/embed/v1/directions?key=K') && (embedUrl(r04, w, 'K') ?? '').includes('mode=walking'), 'ok');

  // Directions
  const bad: string[] = [];
  let turnarounds = 0;
  for (const c of CURATED) {
    const path = [...c.path];
    const steps = buildDirections(path);
    const st = computeStats(path);
    const first = steps[0];
    const last = steps[steps.length - 1];
    if (first.turn !== 'Head out of Home onto') bad.push(`${c.id}: first step "${first.turn}"`);
    if (last.street !== 'Arrive Home.') bad.push(`${c.id}: last step "${last.street}"`);
    if (Math.abs(steps.reduce((m, s) => m + s.meters, 0) - st.meters) > 0.01) bad.push(`${c.id}: step meters do not add up`);
    if (Math.abs(last.cumMeters - st.meters) > 0.01) bad.push(`${c.id}: cumulative ends at ${last.cumMeters}`);
    let reversals = 0;
    for (let i = 1; i < path.length - 1; i++) if (path[i - 1] === path[i + 1]) reversals++;
    const t = steps.filter((s) => s.kind === 'turnaround').length;
    turnarounds += t;
    if (t !== reversals) bad.push(`${c.id}: ${t} turnaround steps for ${reversals} reversals`);
    if (!steps.every((s) => s.street.length > 0)) bad.push(`${c.id}: empty street`);
    if (!stepsToText(c.name, 'x', steps).includes('1. Head out of Home onto')) bad.push(`${c.id}: copy text`);
  }
  check('X4', 'directions for all 22 curated routes: start at Home, arrive Home, distances add up, one turnaround per reversal', bad.length === 0, bad.slice(0, 3).join('; ') || `${turnarounds} turnaround steps`);
  const words = [turnWord(0), turnWord(50), turnWord(-50), turnWord(80), turnWord(-80), turnWord(170)];
  check('X4', 'turn words: continue, bear, turn, turn back; softer word near a threshold', words.join(' | ') === 'Continue onto | Bear right onto | Bear left onto | Turn right onto | Turn left onto | Turn back onto' && turnWord(70) === 'Bear right onto' && turnWord(140) === 'Turn right onto', words.join(' | '));
  check('X4', 'distance display: feet under 0.1 mi, miles otherwise', fmtStepDistance(97.4) === 'about 300 ft' && fmtStepDistance(279.3) === '0.2 mi' && fmtStepDistance(20) === 'about 50 ft', `${fmtStepDistance(97.4)}, ${fmtStepDistance(279.3)}, ${fmtStepDistance(20)}`);
  const ow = buildDirections(oneWayRoute.path);
  check('X4', 'a one-way walk ends "Arrive at <place>."', /^Arrive at .+\.$/.test(ow[ow.length - 1].street), ow[ow.length - 1].street);
  const steep = buildDirections([...CURATED.find((c) => c.id === 'R19')!.path]).filter((s) => s.cue?.includes('steep'));
  check('X4', 'hill cues: steep stretches on the Ash Drive route are called out', steep.length > 0 && steep.every((s) => /climbs|drops|steep/.test(s.cue!)), steep.map((s) => s.cue).join(' / '));
}

phase1();
phase2();
oneWay();
phase4();

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
