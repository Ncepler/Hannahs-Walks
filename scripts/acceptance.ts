// Run from the repo root: npx tsx scripts/acceptance.ts
// Imports the real data and libs. The only literals are the expected numbers from ROADS-ADDENDUM.md §5.2 and §9.
import fs from 'node:fs';
import path from 'node:path';
import { BARRIER_LINKS } from '../data/barrier-links';
import { CURATED } from '../data/curated';
import { NODES } from '../data/nodes';
import { SEGMENTS } from '../data/segments';
import { METERS_PER_MILE } from '../lib/config';
import { composeAll, composeOneWay } from '../lib/compose';
import type Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt, checkPlan, cleanAvoid, FALLBACK_CAVEAT, fallbackPlan, inferMood, parseTargets, pathSig, planWalk, type Ask, type PlannerClient, type Span } from '../lib/ai';
import { corsHeaders, preflight } from '../lib/cors';
import { codeOk, COOKIE, hasAccess, proof, token } from '../lib/session';
import { buildDirections, fmtStepDistance, stepsToText, turnWord } from '../lib/directions';
import { embedUrl, mapsLink, selectWaypoints, simulate } from '../lib/maps';
import { mapsMaxWaypoints, MAPS_MAX_WAYPOINTS_MOBILE, MAPS_MAX_WAYPOINTS_OTHER } from '../lib/mapsLimits';
import { buildMapsUrl } from '../lib/mapsUrl';
import { adj, computeStats, isClosedLoop, isOneWay, LANDMARKS, milesOf, retraceOf, reversalHolds, segmentBetween, segmentsBetween, traverse, validatePath, nodes as graphNodes } from '../lib/graph';
import { CROSSING_DETAIL, CROSSING_TITLE } from '../lib/crossingCopy';
import { chooseWaypoints } from '../lib/waypoints';
import { checkPath, forbiddenRoadOf, FORBIDDEN_ASK, GLEN_COVE_CROSSINGS, isLegalSegment, MAX_CROSSINGS_PER_WALK, NORTHERN_CROSSINGS } from '../lib/rules';
import { another, apmOf, defaultAnswers, diversePicks, getPool, minutesFor, plan, rank, reachedByOneDoor, type Answers, type Stop } from '../lib/score';
import type { Mood, Segment } from '../lib/types';
import { runRuleVectors } from './rules-vectors';

let failures = 0;
const out = (line = '') => process.stdout.write(`${line}\n`);
const section = (title: string) => out(`\n${title}`);
function check(id: string, what: string, ok: boolean, actual: string) {
  if (!ok) failures++;
  out(`  ${ok ? 'PASS' : 'FAIL'}  ${id}  ${what}  [${actual}]`);
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// ROADS-ADDENDUM §5.2 test vector: id, miles, meters, climb ft, max grade %, quiet %, busy %, crossings,
// clear, workout, ponder, minutes (steady: 20 min/mi + 3 min per 100 ft + 1 min per crossing).
type VectorRow = [string, number, number, number, number, number, number, number, number, number, number, number];
const VECTOR: VectorRow[] = [
  ['R01', 0.63, 1017.9, 94, 7.8, 100, 0, 0, 0.56, 0.51, 0.47, 15],
  ['R02', 0.46, 747.4, 27, 4.5, 100, 0, 0, 0.66, 0.26, 0.43, 10],
  ['R03', 0.87, 1396.2, 110, 7.2, 100, 0, 0, 0.60, 0.54, 0.43, 21],
  ['R04', 1.11, 1786.9, 103, 7.8, 100, 0, 0, 0.63, 0.56, 0.56, 25],
  ['R05', 1.28, 2060.8, 92, 7.2, 100, 0, 0, 0.62, 0.55, 0.51, 28],
  ['R06', 1.46, 2353.6, 153, 7.8, 100, 0, 0, 0.65, 0.70, 0.53, 34],
  ['R07', 1.44, 2318.0, 130, 7.2, 100, 0, 0, 0.63, 0.65, 0.46, 33],
  ['R08', 2.13, 3426.2, 162, 7.8, 100, 0, 0, 0.67, 0.68, 0.64, 47],
  ['R18', 4.39, 7063.4, 454, 8.5, 60, 0, 0, 0.49, 0.88, 0.72, 101],
  ['R19', 3.11, 5010.6, 382, 8.5, 100, 0, 0, 0.54, 0.87, 0.53, 74],
  ['R22', 0.70, 1131.2, 37, 4.5, 100, 0, 0, 0.67, 0.30, 0.46, 15],
  ['N01', 1.93, 3106.1, 124, 6.9, 74, 0, 0, 0.63, 0.62, 0.48, 42],
  ['N02', 2.44, 3934.5, 250, 8.5, 85, 0, 0, 0.61, 0.78, 0.58, 56],
  ['N03', 3.34, 5376.9, 305, 8.5, 81, 0, 0, 0.58, 0.80, 0.55, 76],
  ['N04', 4.81, 7736.1, 429, 8.5, 56, 0, 0, 0.48, 0.84, 0.68, 109],
  ['N05', 4.63, 7456.7, 454, 8.5, 57, 0, 0, 0.48, 0.86, 0.71, 106],
  ['N06', 6.27, 10094.6, 489, 8.5, 42, 0, 0, 0.45, 0.81, 0.67, 140],
  ['N07', 1.65, 2656.6, 72, 8.3, 98, 2, 2, 0.61, 0.57, 0.46, 37],
  ['N08', 2.23, 3592.5, 123, 8.3, 99, 1, 2, 0.60, 0.63, 0.46, 50],
  ['N09', 2.74, 4409.2, 147, 8.3, 99, 1, 2, 0.60, 0.66, 0.46, 61],
  ['N10', 3.34, 5369.4, 213, 8.3, 99, 1, 2, 0.58, 0.73, 0.46, 75],
  ['N11', 3.45, 5553.8, 367, 8.5, 81, 0, 0, 0.55, 0.85, 0.58, 80],
  ['N12', 1.95, 3144.3, 125, 8.3, 99, 1, 2, 0.60, 0.64, 0.47, 45]
];

const reachableFromHome = () => {
  const seen = new Set<string>(['HOME']);
  const queue = ['HOME'];
  while (queue.length) for (const [nb] of adj[queue.shift()!]) if (!seen.has(nb)) (seen.add(nb), queue.push(nb));
  return seen;
};

function phase1() {
  section('Data and rules (Stage 1)');

  const nodeIds = Object.keys(NODES);
  const totalM = SEGMENTS.reduce((sum, s) => sum + s.meters, 0);
  const reach = reachableFromHome();
  check('A1', '68 nodes', nodeIds.length === 68, `${nodeIds.length}`);
  check('A1', '82 segments', SEGMENTS.length === 82, `${SEGMENTS.length}`);
  check('A1', 'total length 21,225.2 m (±0.5)', near(totalM, 21225.2, 0.5), `${totalM.toFixed(1)} m = ${(totalM / METERS_PER_MILE).toFixed(2)} mi`);
  check('A1', 'every node reachable from HOME over legal segments', nodeIds.every((id) => reach.has(id)), `${reach.size} of ${nodeIds.length}`);

  const missing = SEGMENTS.filter((s) => !(s.a in NODES) || !(s.b in NODES)).map((s) => s.id);
  const dupes = SEGMENTS.filter((s) => segmentsBetween(s.a, s.b).length !== 1).map((s) => s.id);
  check('A2', 'every segment end exists', missing.length === 0, missing.join(',') || 'none missing');
  check('A2', 'no duplicate segment between a node pair', dupes.length === 0, dupes.join(',') || 'none duplicated');

  const invalid = CURATED.filter((r) => !validatePath([...r.path]).ok || !checkPath(r.path, segmentBetween, graphNodes).ok).map((r) => r.id);
  check('A3', `${CURATED.length} curated routes pass the validators and checkPath`, invalid.length === 0 && CURATED.length === 23, invalid.join(',') || 'all valid');

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
    const [, mi, m, climb, grade, quiet, busy, cross, , , , minutes] = v;
    const mins = minutesFor(st, 'steady');
    if (!near(st.meters, m, 1)) off.push(`${r.id} meters ${st.meters.toFixed(1)} vs ${m}`);
    if (!near(st.miles, mi, 0.005)) off.push(`${r.id} miles ${st.miles.toFixed(2)} vs ${mi}`);
    if (!near(st.ascentFt, climb, 1)) off.push(`${r.id} ascent ${st.ascentFt} vs ${climb}`);
    if (!near(st.maxGradePct, grade, 0.05)) off.push(`${r.id} grade ${st.maxGradePct.toFixed(2)} vs ${grade}`);
    if (Math.round(st.quietShare * 100) !== quiet) off.push(`${r.id} quiet ${(st.quietShare * 100).toFixed(1)} vs ${quiet}`);
    if (Math.round(st.busyShare * 100) !== busy) off.push(`${r.id} busy ${(st.busyShare * 100).toFixed(1)} vs ${busy}`);
    if (st.crossings !== cross) off.push(`${r.id} crossings ${st.crossings} vs ${cross}`);
    if (Math.round(mins) !== minutes) off.push(`${r.id} minutes ${mins.toFixed(1)} vs ${minutes}`);
  }
  check('A4', `meters ±1, miles, ascent ±1 ft (and grade, quiet, busy, crossings, minutes) match the §5.2 vector for ${compared} routes`, off.length === 0 && compared === CURATED.length, off.join('; ') || 'all match');

  const badReverse = CURATED.filter((r) => !reversalHolds([...r.path])).map((r) => r.id);
  check('A5', 'reversing a route keeps meters and swaps ascent/descent', badReverse.length === 0, badReverse.join(',') || 'all hold');

  const root = process.cwd();
  const LOG_CALL = new RegExp(`console\\.${'lo'}g`);
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
  const streets = '(?:Birch|Elm|Chestnut|Sycamore|Cypress|Fir|Poplar|Ash|Pinewood|Teakwood|Midwood|Maplewood|Greenwood|Harbor Hill|Round Hill|Glen Cove|Northern|Wittes|Bryant|Old Northern|East Broadway|Main|Glen|Roslyn|Red Ground|Old Farm)';
  const houseNumber = new RegExp(`\\b\\d{1,5}\\s+(?:[NSEW]\\.?\\s+)?${streets}\\b`);
  const hits: string[] = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const rel = path.relative(root, f);
    if (houseNumber.test(text)) hits.push(`${rel}: house number next to a street name`);
    if (/11576/.test(text)) hits.push(`${rel}: ZIP code`);
    if (LOG_CALL.test(text)) hits.push(`${rel}: a console logging call`);
  }
  const layout = fs.readFileSync(path.join(root, 'app/layout.tsx'), 'utf8');
  if (new RegExp(`${streets}|East Hills|Searingtown`).test(layout)) hits.push('app/layout.tsx: place or street name in metadata');
  check('A6', `no house number, ZIP, console logging or place name in metadata (${files.length} files scanned)`, hits.length === 0, hits.join('; ') || 'clean');
}

// Hard rules (ROADS-ADDENDUM §1, §9): names, geometry, graph legality, copy.
function rules() {
  section('Hard rules (Stage 1)');
  const failures13 = runRuleVectors();
  check('A13', 'name and geometry vectors pass, including both "Old Northern" rows', failures13.length === 0, failures13.join('; ') || 'all vectors pass');

  const badSeg = SEGMENTS.filter((s) => forbiddenRoadOf(s.street, (s as Segment).ref) !== null && s.id !== 'X01').map((s) => s.id);
  const crossings = (SEGMENTS as readonly Segment[]).filter((s) => s.kind === 'crossing');
  const x01 = crossings[0];
  const termOk = Object.values(NODES)
    .filter((n) => n.kind === 'terminus')
    .every((n) => adj[n.id].every(([, id]) => segmentById_(id).street.split(' / ').some((p) => n.name.includes(p.trim()))));
  const between = segmentBetween;
  const sampleOf = (id: string) => CURATED.find((c) => c.id === id)!.path;
  const fake: Segment = { id: 'F1', a: 'ELM_GC', b: 'GC_MIDWOOD', street: 'Glen Cove Rd', meters: 529.2, traffic: 3, scenic: 0, src: 'osrm' };
  const withFake = (a: string, b: string) => ((a === 'ELM_GC' && b === 'GC_MIDWOOD') || (a === 'GC_MIDWOOD' && b === 'ELM_GC') ? fake : segmentBetween(a, b));
  const fakeCross: Segment = { ...(x01 as Segment), id: 'X99' };
  const withFakeCross = (a: string, b: string) => {
    const s = segmentBetween(a, b);
    return s && s.id === 'X01' ? fakeCross : s;
  };
  const n07 = checkPath(sampleOf('N07'), between, graphNodes);
  const threeX = checkPath(['GC_MIDWOOD', 'GCX_E', 'GC_MIDWOOD', 'GCX_E'], between, graphNodes);
  const throughTerminus = checkPath(['ELM_PINE', 'ELM_GC', 'GC_MIDWOOD'], withFake, graphNodes);
  const rejectsFake = !checkPath(['ELM_GC', 'GC_MIDWOOD'], withFake, graphNodes).ok;
  const rejectsThree = !threeX.ok && /3 crossings/.test(threeX.reasons.join());
  const rejectsTerminus = !throughTerminus.ok && throughTerminus.reasons.some((r) => /dead end/.test(r));
  const rejectsUnlisted = !checkPath(['GC_MIDWOOD', 'GCX_E'], withFakeCross, graphNodes).ok;
  check(
    'A14',
    'no forbidden segment; exactly one crossing X01 (GC_MIDWOOD <-> GCX_E), whitelisted; terminus neighbours on their own street',
    badSeg.length === 0 && crossings.length === 1 && x01.id === 'X01' && [x01.a, x01.b].sort().join() === 'GCX_E,GC_MIDWOOD' && GLEN_COVE_CROSSINGS.includes('X01') && NORTHERN_CROSSINGS.length === 0 && SEGMENTS.every((s) => isLegalSegment(s)) && termOk,
    `${badSeg.length} forbidden, ${crossings.length} crossing(s), terminus streets ${termOk}`,
  );
  check('A14', 'checkPath rejects a fabricated Glen Cove Rd segment, three crossings, a path through a terminus, and a crossing id that is not whitelisted', rejectsFake && rejectsThree && rejectsTerminus && rejectsUnlisted, [rejectsFake, rejectsThree, rejectsTerminus, rejectsUnlisted].join(' '));
  check('A14', 'checkPath accepts N07: 2 crossings, 120 s of waiting', n07.ok && n07.crossings === 2 && n07.waitSeconds === 120 && MAX_CROSSINGS_PER_WALK === 2, `${n07.crossings} crossings, ${n07.waitSeconds} s`);

  // A19: copy sweep. "museum" nowhere; the two roads only in the files that carry the crossing, legend and rule copy.
  const root = process.cwd();
  const all: string[] = [];
  const walkDir = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walkDir(p);
      else if (/\.(ts|tsx|css|html|txt|svg)$/.test(entry.name)) all.push(p);
    }
  };
  for (const d of ['app', 'components', 'lib', 'data']) walkDir(path.join(root, d));
  const museumHits = all.filter((f) => !f.endsWith(path.join('data', 'expected-streets.ts')) && /museum/i.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(root, f));
  const ROAD_COPY_OK = new Set(['lib/rules.ts', 'lib/crossingCopy.ts', 'lib/config.ts', 'lib/ai.ts', 'data/nodes.ts', 'data/segments.ts', 'data/curated.ts', 'data/barrier-links.ts', 'data/expected-streets.ts']);
  const roadHits = all
    .map((f) => path.relative(root, f))
    .filter((f) => !ROAD_COPY_OK.has(f) && /Northern Blvd|Northern Boulevard|Glen Cove/.test(fs.readFileSync(path.join(root, f), 'utf8')));
  const wizard = fs.readFileSync(path.join(root, 'components/Wizard.tsx'), 'utf8');
  check('A19', 'no "museum" in app/, components/, lib/, data/ (expected-streets aside); the wizard offers "East Hills (across the signal)"; the roads are named only in the allowed copy files', museumHits.length === 0 && roadHits.length === 0 && wizard.includes('East Hills (across the signal)') && wizard.includes('One crossing each way, with a signal.'), `museum: ${museumHits.join(',') || 'none'}; roads: ${roadHits.join(',') || 'allowed files only'}`);
  const strayRule = all
    .map((f) => path.relative(root, f))
    .filter((f) => f !== 'lib/rules.ts' && /(?:===|==|includes\(|startsWith\()\s*['"`](?:glen cove|northern)/i.test(fs.readFileSync(path.join(root, f), 'utf8')));
  check('A19', 'no file but lib/rules.ts compares a street name with "glen cove" or "northern"', strayRule.length === 0, strayRule.join(',') || 'none');
}
const segmentById_ = (id: string) => SEGMENTS.find((s) => s.id === id)!;

function phase2() {
  section('Composer and scoring (Stage 1)');

  const comp = composeAll();
  const bad = comp.walks.filter((w) => !validatePath(w.path).ok || !checkPath(w.path, segmentBetween, graphNodes).ok).length;
  const outside = comp.walks.filter((w) => {
    const mi = milesOf(w.path);
    return mi < 0.4 || mi > 7.5;
  }).length;
  const multisets = new Set(comp.walks.map((w) => traverse(w.path).map((t) => t.seg.id).sort().join(','))).size;
  const bands = [0, 0, 0, 0];
  let signal = 0;
  let most = 0;
  for (const w of comp.walks) {
    const mi = milesOf(w.path);
    bands[mi < 1.5 ? 0 : mi < 3 ? 1 : mi < 5 ? 2 : 3]++;
    const x = computeStats(w.path).crossings;
    if (x > 0) signal++;
    most = Math.max(most, x);
  }
  check('A16', '270 simple cycles', comp.cycles === 270, `${comp.cycles}`);
  check('A16', '13,042 closed walks', comp.walks.length === 13042, `${comp.walks.length} in ${comp.ms.toFixed(0)} ms`);
  check('A16', '10,379 distinct segment multisets', multisets === 10379, `${multisets}`);
  check('A16', 'by length: < 1.5 mi 70 · 1.5 - 3 mi 641 · 3 - 5 mi 4,464 · over 5 mi 7,867', bands.join() === '70,641,4464,7867', bands.join(' · '));
  check('A16', '4,278 walks cross the signal; none crosses more than twice; every walk passes checkPath and 0.4 - 7.5 mi', signal === 4278 && most <= 2 && bad === 0 && outside === 0, `${signal} cross, most ${most}, ${bad} invalid, ${outside} out of range`);

  const pool = getPool();
  const curated = pool.routes.filter((r) => r.origin === 'curated');
  const top = (mood: Mood, n: number) => [...curated].sort((a, b) => b.scores[mood] - a.scores[mood]).slice(0, n).map((r) => r.id);
  const inSet = (ids: string[], allowed: string[]) => ids.every((id) => allowed.includes(id));
  const clearTop = top('clear', 3);
  const workTop = top('workout', 3);
  const ponderTop = top('ponder', 3);
  check('A8', 'clear: top 3 within {R08,R22,R02,R06,R04}', inSet(clearTop, ['R08', 'R22', 'R02', 'R06', 'R04']), clearTop.join(' '));
  check('A8', 'workout: top 3 within {R18,R19,N05,N11,N04}, R18 and R19 first two', inSet(workTop, ['R18', 'R19', 'N05', 'N11', 'N04']) && inSet(workTop.slice(0, 2), ['R18', 'R19']), workTop.join(' '));
  check('A8', 'ponder: top 3 within {R18,N05,N04,N06,R08}, R18 first', inSet(ponderTop, ['R18', 'N05', 'N04', 'N06', 'R08']) && ponderTop[0] === 'R18', ponderTop.join(' '));
  const offScores: string[] = [];
  for (const row of VECTOR) {
    const r = curated.find((c) => c.id === row[0])!;
    const [, , , , , , , , c, w, p] = row;
    if (!near(r.scores.clear, c, 0.0051)) offScores.push(`${row[0]} clear ${r.scores.clear.toFixed(3)} vs ${c}`);
    if (!near(r.scores.workout, w, 0.0051)) offScores.push(`${row[0]} work ${r.scores.workout.toFixed(3)} vs ${w}`);
    if (!near(r.scores.ponder, p, 0.0051)) offScores.push(`${row[0]} ponder ${r.scores.ponder.toFixed(3)} vs ${p}`);
  }
  check('A8', 'all 69 mood scores match the §5.2 vector to 2 decimals', offScores.length === 0, offScores.join('; ') || 'all match');
  out(`  INFO  pool: ${pool.curated} curated + ${pool.composed} composed (${pool.duplicatesDropped} composed dropped as curated duplicates)`);

  const base = (mood: Mood, over: Partial<Answers>): Answers => ({ ...defaultAnswers(mood), pace: 'steady', ...over });
  const stops = (...s: Stop[]) => new Set<Stop>(s);

  // A9: the filter pipeline on the whole pool. A flat, quiet half hour and a hilly hour and a half only exist as
  // out-and-backs, so those two run with "End back at Home" unchecked (X7 covers the loops).
  const a1 = base('clear', { time: { min: 30 }, hills: 'flat', avoidBusy: true, returnHome: false });
  const r1 = rank(a1);
  const t1 = r1.ranked[0];
  check('A9', 'clear, 30 min, flat, avoid busy: 24 - 36 min, apm <= 70, busy <= 0.10, no crossings, nothing relaxed', !!t1 && r1.relaxed.length === 0 && t1.minutes >= 24 && t1.minutes <= 36 && apmOf(t1.route.stats) <= 70 && t1.route.stats.busyShare <= 0.1 && t1.route.stats.crossings === 0, `${t1?.route.name}: ${t1?.minutes.toFixed(0)} min, apm ${t1 ? apmOf(t1.route.stats).toFixed(0) : '-'}; ${r1.count} candidates in the pool`);

  const a2 = base('workout', { time: { min: 90 }, hills: 'hilly', returnHome: false });
  const r2 = rank(a2);
  const t2 = r2.ranked[0];
  check('A9', 'workout, 90 min, hilly: 72 - 108 min, apm > 100, nothing relaxed', !!t2 && r2.relaxed.length === 0 && t2.minutes >= 72 && t2.minutes <= 108 && apmOf(t2.route.stats) > 100, `${t2?.route.name}: ${t2?.minutes.toFixed(0)} min, apm ${t2 ? apmOf(t2.route.stats).toFixed(0) : '-'}; ${r2.count} candidates in the pool`);

  const a3 = base('ponder', { time: { min: 120, orMore: true }, stops: stops('cedarmere') });
  const r3 = rank(a3);
  const t3 = r3.ranked[0];
  check('A9', 'ponder, 2 hr +, stop Cedarmere: visits CEDARMERE, >= 120 min, nothing relaxed', r3.relaxed.length === 0 && !!t3 && t3.route.visited.has('CEDARMERE') && t3.minutes >= 120, `${t3?.route.name}: ${t3?.minutes.toFixed(0)} min; ${r3.count} candidates in the pool`);

  const a4 = base('clear', { time: { min: 60 }, stops: stops('easthills') });
  const r4 = rank(a4);
  const t4 = r4.ranked[0];
  check('A9', 'clear, 1 hr, stop East Hills: visits GCX_E, 48 - 72 min, exactly 2 crossings, nothing relaxed', r4.relaxed.length === 0 && !!t4 && t4.route.visited.has('GCX_E') && t4.minutes >= 48 && t4.minutes <= 72 && t4.route.stats.crossings === 2, `${t4?.route.name}: ${t4?.minutes.toFixed(0)} min; ${r4.count} candidates in the pool`);

  // Avoid busy roads excludes any crossing unless East Hills was picked.
  const avoid = rank(base('clear', { avoidBusy: true }));
  const avoidEh = rank(base('clear', { avoidBusy: true, stops: stops('easthills') }));
  check('A9', '"Keep me off busy roads" drops every route with a crossing, unless East Hills was picked', avoid.ranked.every((s) => s.route.stats.crossings === 0) && avoid.relaxed.length === 0 && avoidEh.ranked.length > 0 && avoidEh.relaxed.length === 0 && avoidEh.ranked.every((s) => s.route.visited.has('GCX_E')), `${avoid.count} routes without; ${avoidEh.count} with East Hills`);

  // The reference run counts composed walks, before curated duplicates are dropped from the pool.
  const composedAll = comp.walks.map((w) => ({ path: w.path, stats: computeStats(w.path) }));
  const refCount = (pred: (x: (typeof composedAll)[number], minutes: number) => boolean) =>
    composedAll.filter((x) => pred(x, minutesFor(x.stats, 'steady'))).length;
  const n1 = refCount((x, m) => m >= 24 && m <= 36 && apmOf(x.stats) <= 70 && x.stats.busyShare <= 0.1 && x.stats.crossings === 0);
  const n2 = refCount((x, m) => m >= 72 && m <= 108 && apmOf(x.stats) > 100);
  const n3 = refCount((x, m) => m >= 120 && x.path.includes('CEDARMERE'));
  const n4 = refCount((x, m) => m >= 48 && m <= 72 && x.path.includes('GCX_E') && x.stats.crossings === 2);
  check('A9', 'reference candidate counts reproduce (composed walks, before curated dedupe): 12, 343, 31, 205', n1 === 12 && n2 === 343 && n3 === 31 && n4 === 205, `${n1}, ${n2}, ${n3}, ${n4}`);

  const repeats: string[] = [];
  for (const answers of [defaultAnswers('ponder'), a1, a3, defaultAnswers('workout')]) {
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
  check('X1', 'the validator still rejects an open path unless oneWay is set', !validatePath(['HOME', 'BIRCH_ELM'], {}).ok && validatePath(pool.oneWay[0].path, { oneWay: true }).ok, 'default rejects an open path; oneWay accepts it');

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

  // X7: checked means a closed loop. The way back is never the way out, so no street is walked twice.
  const doubled: string[] = [];
  const loopOnly = (what: string, walk: readonly string[], allowed = new Set<string>()) => {
    if (!isClosedLoop(retraceOf(walk), allowed)) doubled.push(what);
  };
  let looked = 0;
  for (const mood of ['clear', 'workout', 'ponder'] as const) {
    for (const extra of [{}, { time: { min: 60 } }, { hills: 'rolling' as const }, { distance: '3-5' as const }]) {
      const answers: Answers = { ...defaultAnswers(mood), ...extra };
      for (const s of rank(answers).ranked) {
        loopOnly(`${mood}:${s.route.id}`, s.route.path);
        looked++;
      }
    }
    const session = plan(defaultAnswers(mood));
    loopOnly(`${mood}: first result`, session.current.path);
    for (let i = 0; i < 100; i++) loopOnly(`${mood}: another #${i}`, another(session).path);
  }
  check('X7', 'checked: every ranked walk, every first result and 300 show-another calls is a closed loop', doubled.length === 0 && looked > 0, doubled.slice(0, 4).join('; ') || `${looked} ranked walks, none doubles back`);

  // The curated out-and-backs and lollipops are still in the pool; they are just not offered while the box is checked.
  const curatedDoubling = getPool().routes.filter((r) => r.origin === 'curated' && !isClosedLoop(r.retrace)).map((r) => r.id);
  const offered = new Set(rank(defaultAnswers('ponder')).ranked.map((s) => s.route.id));
  check('X7', 'checked: curated out-and-backs and the Chestnut lollipop are not offered; the true curated loops are', curatedDoubling.length >= 10 && curatedDoubling.every((id) => !offered.has(id)) && ['R01', 'R04', 'R05', 'N02', 'N03'].every((id) => offered.has(id)), `${curatedDoubling.length} held back (${curatedDoubling.slice(0, 4).join(', ')}, ...)`);

  // East Hills (through the signal) and Cedarmere (up the Bryant Avenue stem) have one way in, so a walk to one goes in and
  // out. That is allowed only for a place the person picked.
  const eh = rank({ ...defaultAnswers('clear'), avoidBusy: false, stops: new Set<Stop>(['easthills']) });
  const ehOk = eh.relaxed.length === 0 && eh.ranked.length > 0 && eh.ranked.every((s) => s.route.visited.has('GCX_E') && (isClosedLoop(s.route.retrace) || reachedByOneDoor(s.route.visited, ['easthills'])));
  const ced = rank({ ...defaultAnswers('ponder'), stops: new Set<Stop>(['cedarmere']) });
  const cedOk = ced.relaxed.length === 0 && ced.ranked.length > 0 && ced.ranked.every((s) => s.route.visited.has('CEDARMERE'));
  const unasked = rank(defaultAnswers('ponder')).ranked.filter((s) => s.route.visited.has('GCX_E') || s.route.visited.has('CEDARMERE')).length;
  check('X7', 'checked: a picked East Hills or Cedarmere is reached through its one way in; nobody walks there unasked', ehOk && cedOk && unasked === 0, `East Hills ${eh.ranked.length} walks, Cedarmere ${ced.ranked.length}, unasked ${unasked}`);

  // Unchecked is as before: walks that double back are still on offer.
  const free = rank({ ...defaultAnswers('clear'), returnHome: false }).ranked;
  check('X7', 'unchecked: out-and-backs and lollipops are still offered, beside the one-way walks', free.some((s) => retraceOf(s.route.path).repeated.length > 0) && free.some((s) => isOneWay(s.route.path)), `${free.filter((s) => retraceOf(s.route.path).repeated.length > 0).length} double back, ${free.filter((s) => isOneWay(s.route.path)).length} one-way`);
}

function phase4() {
  section('Directions and maps (Stage 1)');
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((n, i) => n === b[i]);
  const pathOf = (id: string) => [...CURATED.find((c) => c.id === id)!.path];

  // A23: waypoints are chosen leg by leg on legal segments plus BARRIER_LINKS.
  for (const [label, limit, wantExact] of [['mobile', MAPS_MAX_WAYPOINTS_MOBILE, 15], ['desktop', MAPS_MAX_WAYPOINTS_OTHER, 22]] as const) {
    let exact = 0;
    const wrong: string[] = [];
    const inexact: string[] = [];
    for (const r of CURATED) {
      const p = selectWaypoints([...r.path], limit);
      if (p.waypoints.length > limit) wrong.push(`${r.id}: ${p.waypoints.length} waypoints`);
      if (p.risky) wrong.push(`${r.id}: mapsRisky`);
      if (p.exact) exact++;
      else inexact.push(r.id);
    }
    check('A23', `${label} limit ${limit}: ${wantExact} of 23 curated routes exact, none risky, at most ${limit} pins` + (label === 'desktop' ? ' (R19 is the only inexact one)' : ''), exact === wantExact && wrong.length === 0 && (label === 'mobile' || inexact.join() === 'R19'), `${exact} exact; inexact ${inexact.join(' ')}` + (wrong.length ? `; ${wrong.join('; ')}` : ''));
  }
  // A synthetic walk whose only shortest path uses a barrier link is flagged risky.
  const sim = new Map<string, { id: string; to: string; meters: number }[]>();
  const link = (id: string, a: string, b: string, m: number) => {
    sim.set(a, [...(sim.get(a) ?? []), { id, to: b, meters: m }]);
    sim.set(b, [...(sim.get(b) ?? []), { id, to: a, meters: m }]);
  };
  link('E1', 'P', 'Q', 100);
  link('E2', 'Q', 'R', 100);
  link('B9', 'P', 'R', 50);
  const risky = chooseWaypoints(['P', 'Q', 'R'], ['E1', 'E2'], (n) => sim.get(n) ?? [], () => [40.8, -73.63], (id) => id.startsWith('B'), 0);
  check('A23', 'a synthetic route whose only shortest path uses a barrier link is flagged risky', !risky.exact && risky.usesBarrier, JSON.stringify(risky));
  check('A23', 'pin limits: 3 on phones and iPadOS-as-Mac, 9 elsewhere', mapsMaxWaypoints('Mozilla/5.0 (iPhone)', 5) === 3 && mapsMaxWaypoints('Mozilla/5.0 (Linux; Android 14) Mobile', 5) === 3 && mapsMaxWaypoints('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 5) === 3 && mapsMaxWaypoints('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 0) === 9 && mapsMaxWaypoints('Mozilla/5.0 (Windows NT 10.0)', 0) === 9, 'ok');

  // A26 and the links
  const r04 = pathOf('R04');
  const w = selectWaypoints(r04, MAPS_MAX_WAYPOINTS_OTHER).waypoints;
  const url = mapsLink(r04, w);
  const withOrigin = mapsLink(r04, w, { startFromHome: true });
  const streets = /Birch|Elm|Chestnut|Sycamore|Cypress|Drive|Road|Lane/;
  const n09 = pathOf('N09');
  const nine = selectWaypoints(n09, MAPS_MAX_WAYPOINTS_OTHER).waypoints;
  const nineUrl = mapsLink(n09, nine);
  check('A26', 'coordinates only, no address, travelmode=walking, Home as destination, at most the limit\'s pins, pipes as %7C', url.startsWith('https://www.google.com/maps/dir/?api=1&') && url.includes('destination=40.800550%2C-73.627560') && url.includes('travelmode=walking') && !url.includes('origin=') && !streets.test(url) && nine.length <= MAPS_MAX_WAYPOINTS_OTHER && nine.length >= 2 && nineUrl.includes('%7C') && !nineUrl.includes('|'), `${nine.length} pins; ${nineUrl.replace('https://www.google.com/maps/dir/', '…/').slice(0, 140)}`);
  check('A26', '"Start from Home" adds origin with the Home coordinates; buildMapsUrl matches', withOrigin.includes('origin=40.800550%2C-73.627560') && buildMapsUrl([40.8, -73.6], []) === 'https://www.google.com/maps/dir/?api=1&destination=40.800000%2C-73.600000&travelmode=walking', 'origin present');
  const oneWayRoute = getPool().oneWay[0];
  const owLink = mapsLink(oneWayRoute.path, selectWaypoints(oneWayRoute.path, MAPS_MAX_WAYPOINTS_MOBILE).waypoints);
  const end = oneWayRoute.path[oneWayRoute.path.length - 1];
  const endNode = NODES[end as keyof typeof NODES];
  check('A26', 'one-way link ends at the finish, not Home', owLink.includes(`destination=${endNode.lat.toFixed(6)}%2C${endNode.lon.toFixed(6)}`) && !owLink.includes('destination=40.800550'), end);
  check('A26', 'no Embed URL without a key; with one it is a walking directions URL', embedUrl(r04, w, undefined) === null && (embedUrl(r04, w, 'K') ?? '').includes('/embed/v1/directions?key=K') && (embedUrl(r04, w, 'K') ?? '').includes('mode=walking'), 'ok');
  check('A23', 'simulate() runs on legal segments plus barrier links and reproduces an exact leg', same(simulate(['HOME', 'BIRCH_ELM']), ['HOME', 'BIRCH_ELM']) && BARRIER_LINKS.length === 5, `${BARRIER_LINKS.length} barrier links`);

  // A17 and A18: crossing and turn-back steps, and the signal minute
  const x01Routes = CURATED.filter((c) => (c.path as readonly string[]).includes('GCX_E')).map((c) => c.id);
  const stepBad: string[] = [];
  for (const c of CURATED) {
    const steps = buildDirections([...c.path]);
    const cross = steps.filter((s) => s.kind === 'crossing');
    const uses = c.path.some((n, i) => i > 0 && [n, c.path[i - 1]].sort().join() === 'GCX_E,GC_MIDWOOD');
    const wantCross = c.path.slice(1).filter((n, i) => [n, c.path[i]].sort().join() === 'GCX_E,GC_MIDWOOD').length;
    if (uses ? cross.length !== wantCross : cross.length !== 0) stepBad.push(`${c.id}: ${cross.length} crossing steps, wanted ${wantCross}`);
    for (const s of cross) {
      if (s.street !== CROSSING_TITLE || s.right !== '+1 min' || !s.notes.some((n) => n.text === CROSSING_DETAIL && n.caution) || !/^From .+ to .+$/.test(s.sub ?? '')) stepBad.push(`${c.id}: crossing step text`);
    }
    const idx = steps.map((s, i) => (s.kind === 'crossing' ? i : -1)).filter((i) => i >= 0);
    for (const i of idx) if (steps[i - 1]?.kind === 'crossing' || steps[i + 1]?.kind === 'crossing' || steps[i - 1]?.street === steps[i + 1]?.street) stepBad.push(`${c.id}: crossing merged or doubled at step ${i + 1}`);
  }
  const n07 = buildDirections(pathOf('N07'));
  const toLake = n07.find((s) => s.kind === 'crossing');
  const back = n07.filter((s) => s.kind === 'crossing')[1];
  const r02 = buildDirections(pathOf('R02'));
  const turnBack = r02.find((s) => s.kind === 'turnaround' && /Elm Drive/.test(s.street));
  check('A17', `every route that uses X01 (${x01Routes.length}) has one separate crossing step per use with the §8.2 title, detail and "+1 min"; routes without X01 have none`, stepBad.length === 0 && x01Routes.length === 5 && toLake?.sub === 'From Midwood Cross to Lakeville Court' && back?.sub === 'From Lakeville Court to Midwood Cross', stepBad.slice(0, 3).join('; ') || `${toLake?.sub}; ${back?.sub}`);
  check('A17', 'an out-and-back that ends at a terminus has the turn-back step', turnBack?.street === "Turn back at the end of Elm Drive. Glen Cove Road is ahead; this app doesn't walk along it.", turnBack?.street ?? 'missing');
  check('A17', '"Copy steps" text carries the crossing and the turn-back steps', stepsToText('x', 'y', n07).includes('Cross Glen Cove Road at the signal') && stepsToText('x', 'y', r02).includes('Turn back at the end of Elm Drive'), 'ok');
  const n07Stats = computeStats(pathOf('N07'));
  check('A18', "N07's time at steady pace equals its Min* (37) and includes the two minutes of waiting", Math.round(minutesFor(n07Stats, 'steady')) === 37 && near(minutesFor(n07Stats, 'steady') - (n07Stats.miles * 20 + 0.03 * n07Stats.ascentFt), 2, 1e-9), `${minutesFor(n07Stats, 'steady').toFixed(2)} min`);

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
  check('X4', 'directions for all 23 curated routes: start at Home, arrive Home, distances add up, one turnaround per reversal', bad.length === 0, bad.slice(0, 3).join('; ') || `${turnarounds} turnaround steps`);
  const words = [turnWord(0), turnWord(50), turnWord(-50), turnWord(80), turnWord(-80), turnWord(170)];
  check('X4', 'turn words: continue, bear, turn, turn back; softer word near a threshold', words.join(' | ') === 'Continue onto | Bear right onto | Bear left onto | Turn right onto | Turn left onto | Turn back onto' && turnWord(70) === 'Bear right onto' && turnWord(140) === 'Turn right onto', words.join(' | '));
  check('X4', 'distance display: feet under 0.1 mi, miles otherwise', fmtStepDistance(97.4) === 'about 300 ft' && fmtStepDistance(279.3) === '0.2 mi' && fmtStepDistance(20) === 'about 50 ft', `${fmtStepDistance(97.4)}, ${fmtStepDistance(279.3)}, ${fmtStepDistance(20)}`);
  const ow = buildDirections(oneWayRoute.path);
  check('X4', 'a one-way walk ends "Arrive at <place>."', /^Arrive at .+\.$/.test(ow[ow.length - 1].street), ow[ow.length - 1].street);
  const steep = buildDirections([...CURATED.find((c) => c.id === 'R19')!.path]).filter((s) => s.cue?.includes('steep'));
  check('X4', 'hill cues: steep stretches on the Ash Drive route are called out', steep.length > 0 && steep.every((s) => /climbs|drops|steep/.test(s.cue!)), steep.map((s) => s.cue).join(' / '));
}

async function phase5() {
  section('Premium planner (Phase 5): validators and pipeline on fixtures; the live model call is not exercised');
  const R = (id: string) => [...CURATED.find((c) => c.id === id)!.path];
  const ask = (prompt: string, over: Partial<Ask> = {}): Ask => ({ prompt, pace: 'steady', returnHome: true, ...over });
  const body = { title: 'Test walk', mood: 'clear', why: 'You get quiet streets.' };
  const reject = (path: unknown, a: Ask) => {
    const c = checkPlan({ ...body, path }, a);
    return c.ok ? 'ACCEPTED' : c.error;
  };

  // A20
  const notHome = reject(['BIRCH_ELM', 'HOME', 'BIRCH_SYC', 'HOME'], ask('a walk'));
  const jump = reject(['HOME', 'CEDARMERE', 'HOME', 'BIRCH_ELM', 'HOME'], ask('a walk'));
  const ghost = reject(['HOME', 'BIRCH_ELM', 'ATLANTIS', 'BIRCH_ELM', 'HOME'], ask('a walk'));
  const ten = [...R('N06'), ...R('N04').slice(1)];
  const tenMi = milesOf(ten);
  const tooLong = reject(ten, ask('about 2 miles', { returnHome: false }));
  const sixVsTwo = reject(R('N06'), ask('about 2 miles', { returnHome: false }));
  check('A20', 'rejects a path that does not start at HOME', /start at HOME/.test(notHome), notHome);
  check('A20', 'rejects a non-adjacent pair', /does not exist/.test(jump), jump);
  check('A20', 'rejects an unknown node', /Unknown node ATLANTIS/.test(ghost), ghost);
  check('A20', `rejects a ${tenMi.toFixed(1)} mi walk when the request says "about 2 miles" (and a 6 mi one by the 30% rule)`, tooLong !== 'ACCEPTED' && /requested about 2/.test(sixVsTwo), `${tooLong}; ${sixVsTwo}`);
  const threeX = ['HOME', 'BIRCH_ELM', 'WALNUT_ELM', 'ELM_PINE', 'PINE_TEAK', 'PINE_N1', 'PINE_MID', 'GC_MIDWOOD', 'GCX_E', 'GC_MIDWOOD', 'GCX_E', 'GC_MIDWOOD', 'PINE_MID', 'PINE_N1', 'PINE_TEAK', 'ELM_PINE', 'WALNUT_ELM', 'BIRCH_ELM', 'HOME'];
  const throughEnd = ['HOME', 'BIRCH_ELM', 'WALNUT_ELM', 'ELM_PINE', 'ELM_GC', 'GC_MIDWOOD', 'GCX_E', 'GC_MIDWOOD', 'ELM_GC', 'ELM_PINE', 'WALNUT_ELM', 'BIRCH_ELM', 'HOME'];
  const rThree = reject(threeX, ask('a walk across the signal'));
  const rEnd = reject(throughEnd, ask('a walk'));
  check('A20', 'rejects a path with three crossings, and a path that continues through a terminus', /crossings|limit/.test(rThree) && /Segment between ELM_GC and GC_MIDWOOD does not exist/.test(rEnd), `${rThree}; ${rEnd}`);
  const okPlain = checkPlan({ ...body, path: R('R04') }, ask('a gentle loop'));
  const okNumber = checkPlan({ ...body, path: R('R04') }, ask('about 1 mile'));
  const okN07 = checkPlan({ ...body, path: R('N07') }, ask('a walk through East Hills'));
  check('A20', "accepts R04's path, with and without a number in the note, and N07's path", okPlain.ok && okNumber.ok && okN07.ok, `R04 = ${milesOf(R('R04')).toFixed(2)} mi; N07 ${okN07.ok ? 'accepted' : 'rejected'}`);
  const sysP = buildSystemPrompt();
  const injected = (text: string) => {
    const c = checkPlan({ ...body, path: R('R04') }, ask(text));
    return c.ok ? (c.plan.caveat ?? '') : 'REJECTED';
  };
  check('A20', 'the system prompt carries the hard rules; the caveat regex fires for "walk down Northern Blvd" and "along Glen Cove Road" and not for "Old Northern Boulevard"',
    sysP.includes('Never route along Glen Cove Road or Northern Boulevard') && sysP.includes('segment X01') && !/museum/i.test(sysP) && FORBIDDEN_ASK.test('walk down Northern Blvd') && FORBIDDEN_ASK.test('along Glen Cove Road') && !FORBIDDEN_ASK.test('Old Northern Boulevard') &&
      injected('walk down Northern Blvd') === "I don't route along Glen Cove Road or Northern Boulevard." && injected('along Glen Cove Road') === "I don't route along Glen Cove Road or Northern Boulevard." && injected('Old Northern Boulevard please') === '', `${injected('walk down Northern Blvd')}`);

  // The rest of §13.5 and the parsing helper
  const pp = checkPlan({ ...body, path: R('R04'), pause_points: ['LIBRARY', 'CYP_ELM', 'BIRCH_SYC', 'ELM_W'] }, ask('x'));
  check('X5', 'pause points not on the path are dropped, at most two kept', pp.ok && pp.plan.pausePoints.join() === 'CYP_ELM,BIRCH_SYC', pp.ok ? pp.plan.pausePoints.join() : 'rejected');
  check('X5', 'a time in the note is held to ±30%', checkPlan({ ...body, path: R('R04') }, ask('about 30 minutes')).ok && !checkPlan({ ...body, path: R('R04') }, ask('about 90 minutes')).ok, 'R04 is ~25 min');
  const t = (s: string) => parseTargets(s);
  const near2 = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 0.05;
  const one = (x: Span | undefined, v: number) => !!x && near2(x.lo, v) && near2(x.hi, v);
  check('X5', 'distance and time parsing: 3 miles, 5k, 45 minutes, an hour, an hour and a half, a 3-mile walk', one(t('3 miles').miles, 3) && one(t('5k').miles, 3.11) && one(t('about 45 minutes').minutes, 45) && one(t('an hour or so').minutes, 60) && one(t('an hour and a half').minutes, 90) && one(t('1.5 hours').minutes, 90) && one(t('half an hour').minutes, 30) && one(t('a 3-mile walk').miles, 3) && one(t('a 30-minute walk').minutes, 30) && one(t('1 hour and 15 minutes').minutes, 75) && t('I need to stop thinking').minutes === undefined && t('I need to stop thinking').miles === undefined, JSON.stringify([t('5k'), t('an hour and a half')]));
  const lib = [...composeOneWay().find((w) => w.path[w.path.length - 1] === 'LIBRARY')!.path];
  check('X5', 'one-way: a walk finishing at the library passes only when the box is unchecked; a junction finish never does', checkPlan({ ...body, path: lib }, ask('x', { returnHome: false })).ok && !checkPlan({ ...body, path: lib }, ask('x', { returnHome: true })).ok && !checkPlan({ ...body, path: lib.slice(0, 3) }, ask('x', { returnHome: false })).ok, 'ok');

  // Pipeline with a fake client (no key, no network)
  const message = (content: unknown[]) => ({ id: 'm', type: 'message', role: 'assistant', model: 'fake', content, stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } }) as unknown as Anthropic.Message;
  const use = (input: object) => message([{ type: 'tool_use', id: 'tu_1', name: 'plan_walk', input }]);
  const fake = (replies: Anthropic.Message[]) => {
    const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const client: PlannerClient = {
      messages: {
        create: async (params) => {
          calls.push(JSON.parse(JSON.stringify(params)));
          return replies[Math.min(calls.length - 1, replies.length - 1)];
        },
      },
    };
    return { client, calls };
  };
  const good = use({ ...body, path: R('R04') });
  // 'mixed' says nothing useful, so the fallback reads the note's keywords (§13.5.6).
  const bad = use({ ...body, mood: 'mixed', path: ['HOME', 'CEDARMERE', 'HOME', 'BIRCH_ELM', 'HOME'] });

  const a = fake([good]);
  const ra = await planWalk(a.client, ask('a gentle loop'));
  const p0 = a.calls[0];
  check('X5', 'a good answer: source "ai", one call, forced plan_walk tool, cached system block, default model', ra.source === 'ai' && a.calls.length === 1 && (p0.tool_choice as { name?: string } | undefined)?.name === 'plan_walk' && p0.model === 'claude-sonnet-5-5' && p0.max_tokens === 1200 && Array.isArray(p0.system) && (p0.system[0] as { cache_control?: { type: string } }).cache_control?.type === 'ephemeral', `${ra.source}, ${a.calls.length} call`);

  const b = fake([bad, good]);
  const rb = await planWalk(b.client, ask('a gentle loop'));
  const retry = b.calls[1]?.messages ?? [];
  const lastMsg = retry[retry.length - 1];
  const toolResult = Array.isArray(lastMsg?.content) ? (lastMsg.content[0] as { type?: string; is_error?: boolean; content?: string }) : undefined;
  check('X5', 'a bad answer is retried once with the specific error as an is_error tool_result', rb.source === 'ai' && b.calls.length === 2 && toolResult?.type === 'tool_result' && toolResult.is_error === true && /does not exist/.test(String(toolResult.content)) && retry[retry.length - 2]?.role === 'assistant', `${b.calls.length} calls; "${toolResult?.content}"`);

  const c = fake([bad]);
  // The hilly loops here are short (about 35 minutes), so that is what the note asks for.
  const rc = await planWalk(c.client, ask('Hilly. I want to sweat, about 35 minutes.'));
  const rcStats = computeStats(rc.path);
  check('X5', 'two bad answers fall back to the regular engine with the exact caveat; the walk is valid and fits the note', rc.source === 'fallback' && c.calls.length === 2 && rc.caveat === FALLBACK_CAVEAT && validatePath(rc.path).ok && rc.mood === 'workout' && apmOf(rcStats) > 100 && minutesFor(rcStats, 'steady') >= 28 && minutesFor(rcStats, 'steady') <= 42, `${rc.title}: ${rcStats.miles.toFixed(1)} mi, ${Math.round(minutesFor(rcStats, 'steady'))} min`);

  const d = fake([message([{ type: 'text', text: 'no tool' }])]);
  // No flat, quiet half-hour loop exists on this map, so the box is unchecked for this one.
  const rd = await planWalk(d.client, ask('Flat and quiet, about 30 minutes, I need to stop thinking.', { returnHome: false }));
  const rdStats = computeStats(rd.path);
  check('X5', 'no tool call twice: falls back; "flat and quiet, about 30 minutes" gives a flat quiet walk of 24 - 36 min', rd.source === 'fallback' && d.calls.length === 2 && rd.mood === 'clear' && apmOf(rdStats) <= 70 && minutesFor(rdStats, 'steady') >= 24 && minutesFor(rdStats, 'steady') <= 36 && rdStats.busyShare <= 0.1, `${rd.title}: ${Math.round(minutesFor(rdStats, 'steady'))} min`);

  const e = await planWalk(fake([bad]).client, ask('Somewhere pretty. End at the pond if you can.'));
  check('X5', 'fallback for "somewhere pretty, end at the pond": ponder mood, passes the pond', e.mood === 'ponder' && e.path.includes('VILLAGE'), `${e.title}`);
  const f = await planWalk(fake([bad]).client, ask('x', { returnHome: false, prompt: 'a short walk to the library' }));
  check('X5', 'fallback honours "no need to return": library stop, and the result may be one-way', f.path.includes('LIBRARY'), `${f.title}${isOneWay(f.path) ? ' (one-way)' : ''}`);
  const g = await planWalk(fake([use({ ...body, mood: 'ponder', path: ['HOME', 'CEDARMERE', 'HOME', 'BIRCH_ELM', 'HOME'] })]).client, ask('go for a walk'));
  check('X5', "fallback takes the model's own mood when it gave one", g.source === 'fallback' && g.mood === 'ponder', g.mood);
  check('X5', 'mood keywords: sweat, quiet, pretty', inferMood('I want to sweat') === 'workout' && inferMood('something calm') === 'clear' && inferMood('trees please') === 'ponder' && inferMood('x', 'ponder') === 'ponder', 'ok');

  // The prompt is generated from the data and carries no address
  const sys = buildSystemPrompt();
  const allIds = Object.keys(NODES).every((id) => sys.includes(`${id} |`)) && SEGMENTS.every((s) => sys.includes(`${s.id} |`));
  const examples = CURATED.every((c) => sys.includes(`${c.id} | ${c.name} |`));
  const user = JSON.stringify(a.calls[0].messages);
  check('X5', 'system prompt lists all 68 nodes, 82 segments and 23 examples (no example paths), no ZIP', allIds && examples && !/11576/i.test(sys) && !/HOME, BIRCH/.test(sys) && /must finish back at HOME/.test(user), `${sys.length} chars, about ${Math.round(sys.length / 4)} tokens`);

  // X7: a walk that ends at HOME must be a closed loop, in the validator, the prompt and the fallback
  const outAndBack = reject(R('R08'), ask('a walk'));
  const lollipop = reject(R('R07'), ask('a walk'));
  const cedarWalk = rank({ ...defaultAnswers('ponder'), stops: new Set<Stop>(['cedarmere']) }).ranked[0].route.path;
  check('X7', 'checkPlan: an out-and-back or a lollipop is refused with the street and "closed loop"; a real loop and the unchecked box pass', /Birch Dr/.test(outAndBack) && /closed loop/.test(outAndBack) && /closed loop/.test(lollipop) && lollipop !== 'ACCEPTED' && checkPlan({ ...body, path: R('R04') }, ask('a walk')).ok && checkPlan({ ...body, path: R('R08') }, ask('a walk', { returnHome: false })).ok, outAndBack);
  check('X7', 'checkPlan: an in-and-out walk to Cedarmere or East Hills is fine when the note names it and refused when it does not', checkPlan({ ...body, path: cedarWalk }, ask('something by Cedarmere')).ok && /closed loop/.test(reject(cedarWalk, ask('a walk'))) && checkPlan({ ...body, path: R('N07') }, ask('across the signal to East Hills')).ok && /closed loop/.test(reject(R('N07'), ask('a walk'))), reject(cedarWalk, ask('a walk')));
  const retried = fake([use({ ...body, path: R('R08') }), good]);
  const rRetry = await planWalk(retried.client, ask('a gentle loop'));
  const retryMsgs = retried.calls[1]?.messages ?? [];
  const retryErr = (retryMsgs[retryMsgs.length - 1]?.content as { content?: string }[] | undefined)?.[0]?.content;
  const sysText = buildSystemPrompt();
  const userText = (calls: Anthropic.MessageCreateParamsNonStreaming[]) => JSON.stringify(calls[0].messages);
  const openAsk = fake([good]);
  await planWalk(openAsk.client, ask('a gentle loop', { returnHome: false }));
  check('X7', 'an out-and-back answer is sent back with the reason; the prompt and the request both say closed loop, and the unchecked request does not', rRetry.source === 'ai' && retried.calls.length === 2 && /closed loop/.test(String(retryErr)) && /closed loop/.test(sysText) && !/Out-and-backs are fine \(walk to a place/.test(sysText) && /closed loop/.test(userText(retried.calls)) && !/closed loop/.test(userText(openAsk.calls)), `${retried.calls.length} calls; "${String(retryErr).slice(0, 60)}..."`);
  const fb = fallbackPlan(ask('Flat and quiet, about 30 minutes, I need to stop thinking.'));
  check('X7', 'the fallback is a closed loop too, even when nothing fits the note exactly', validatePath(fb.path).ok && isClosedLoop(retraceOf(fb.path)), `${fb.title}: ${milesOf(fb.path).toFixed(1)} mi`);

  // Distances and times are for the whole walk: "3-4 miles" is a total, never each way
  const range = (x: Span | undefined, a: number, b: number) => !!x && near2(x.lo, a) && near2(x.hi, b);
  const rg = (x: string) => parseTargets(x);
  check('X6', 'ranges are read as totals: 3-4 miles, 3 to 4, between 3 and 4, 3 - 4, 3 or 4, 3-4 mile, 5 to 6 km, 30-45 minutes, 45 minutes to an hour, an hour to an hour and a half, 1-2 hours',
    range(rg('3-4 miles').miles, 3, 4) && range(rg('about 3 to 4 miles please').miles, 3, 4) && range(rg('between 3 and 4 miles').miles, 3, 4) && range(rg('3–4 mi').miles, 3, 4) && range(rg('3 - 4 miles').miles, 3, 4) && range(rg('3 or 4 miles').miles, 3, 4) && range(rg('a 3-4 mile walk').miles, 3, 4) && range(rg('5 to 6 km').miles, 3.11, 3.73) &&
      range(rg('30-45 minutes').minutes, 30, 45) && range(rg('45 minutes to an hour').minutes, 45, 60) && range(rg('an hour to an hour and a half').minutes, 60, 90) && range(rg('1-2 hours').minutes, 60, 120),
    JSON.stringify([rg('3-4 miles'), rg('45 minutes to an hour')]));
  const two = rg('2 miles and 30 minutes');
  const both = rg('3-4 miles in about 70 minutes');
  check('X6', 'two different numbers are not a range: "2 miles and 30 minutes", "3-4 miles in about 70 minutes"', one(two.miles, 2) && one(two.minutes, 30) && range(both.miles, 3, 4) && one(both.minutes, 70), JSON.stringify([two, both]));
  check('X6', 'only "each way" doubles a figure', one(rg('3 miles each way').miles, 6) && range(rg('3-4 miles each way').miles, 6, 8) && range(rg('3-4 miles').miles, 3, 4), JSON.stringify([rg('3 miles each way'), rg('3-4 miles each way')]));

  const miles = (c: { path: readonly string[] }) => milesOf([...c.path]);
  const inside = CURATED.find((c) => miles(c) >= 3 && miles(c) <= 4)!;
  const runsLong = CURATED.find((c) => miles(c) > 4.6)!;
  const runsShort = CURATED.find((c) => miles(c) < 2.5)!;
  const trip = ask('a 3-4 mile walk', { returnHome: false });
  const longWhy = reject([...runsLong.path], trip);
  check('X6', `a ${miles(inside).toFixed(1)} mi walk fits "3-4 miles"; a ${miles(runsLong).toFixed(1)} mi one and a ${miles(runsShort).toFixed(1)} mi one are refused, with "in total"`, checkPlan({ ...body, path: [...inside.path] }, trip).ok && /in total/.test(longWhy) && /not each way/.test(longWhy) && /in total/.test(reject([...runsShort.path], trip)), longWhy);

  const long2 = fake([use({ ...body, path: [...runsLong.path] }), use({ ...body, path: [...inside.path] })]);
  const re = await planWalk(long2.client, trip);
  const sent = JSON.stringify(long2.calls[0].messages[0]);
  const sentBack = JSON.stringify(long2.calls[1]?.messages.slice(-1)[0] ?? '');
  check('X6', 'the request spells out "3 to 4 miles for the whole walk ... not each way"; a long answer is sent back with that, then the right one is taken',
    /Length: 3 to 4 miles for the whole walk/.test(sent) && /not the distance each way/.test(sent) && /never 3 to 4 miles each way/.test(buildSystemPrompt()) && re.source === 'ai' && long2.calls.length === 2 && /in total/.test(sentBack), `${re.source}, ${long2.calls.length} calls`);

  const f1 = await planWalk(fake([bad]).client, ask('a 3-4 mile walk, somewhere quiet'));
  // Flat and quiet for 30 - 45 minutes is not a loop on this map either (see above).
  const f2 = await planWalk(fake([bad]).client, ask('about 30-45 minutes, flat', { returnHome: false }));
  const f2Min = minutesFor(computeStats(f2.path), 'steady');
  check('X6', 'the fallback also keeps to a range: "3-4 miles" gives 2.7 to 4.4 mi; "30-45 minutes" gives 27 to 50 min', f1.source === 'fallback' && milesOf(f1.path) >= 2.7 && milesOf(f1.path) <= 4.4 && f2.source === 'fallback' && f2Min >= 27 && f2Min <= 49.5, `${milesOf(f1.path).toFixed(1)} mi; ${Math.round(f2Min)} min`);

  // "Another" never repeats a walk that was already shown
  const sigs = [pathSig(R('R04'))];
  const seenOk = !checkPlan({ ...body, path: R('R04') }, ask('x', { avoid: sigs })).ok && !checkPlan({ ...body, path: R('R04').reverse() }, ask('x', { avoid: sigs })).ok && checkPlan({ ...body, path: R('R05') }, ask('x', { avoid: sigs })).ok;
  const g1 = fake([use({ ...body, path: R('R04') }), use({ ...body, path: R('R05') })]);
  const rg1 = await planWalk(g1.client, ask('a gentle loop', { avoid: sigs }));
  const f3 = await planWalk(fake([bad]).client, ask('a gentle loop'));
  const f4 = await planWalk(fake([bad]).client, ask('a gentle loop', { avoid: [pathSig(f3.path)] }));
  check('X6', 'a walk already shown (or its reverse) is refused; the model is told which ones; the fallback picks another walk under another name; junk in the list is dropped',
    seenOk && rg1.source === 'ai' && pathSig(rg1.path) === pathSig(R('R05')) && g1.calls.length === 2 && /already shown/.test(JSON.stringify(g1.calls[0].messages[0])) && pathSig(f4.path) !== pathSig(f3.path) && f4.title !== f3.title && cleanAvoid(['HOME>BIRCH_ELM', 'x y', 5, 'HOME>' + 'A>'.repeat(900) + 'B', "HOME>A'; drop"]).join() === 'HOME>BIRCH_ELM', `${rg1.title}; ${f3.title} then ${f4.title}`);

  // Passcode cookies
  const saved = { p: process.env.PREMIUM_PASSCODE, s: process.env.SESSION_SECRET };
  process.env.PREMIUM_PASSCODE = 'kugel';
  process.env.SESSION_SECRET = 'a-long-random-string-for-the-test';
  const good2 = token('premium');
  const open = hasAccess('premium', good2) && !hasAccess('premium', undefined) && !hasAccess('premium', 'deadbeef') && !hasAccess('premium', good2 + '0') && codeOk('premium', 'kugel') && !codeOk('premium', 'kugel ') && !codeOk('premium', '') && good2 !== token('site') && /^[0-9a-f]{64}$/.test(good2);
  delete process.env.SESSION_SECRET;
  const failsClosed = !hasAccess('premium', good2);
  delete process.env.PREMIUM_PASSCODE;
  const noCode = hasAccess('premium', undefined);
  if (saved.p !== undefined) process.env.PREMIUM_PASSCODE = saved.p;
  if (saved.s !== undefined) process.env.SESSION_SECRET = saved.s;
  check('X5', 'passcode cookie: HMAC, constant-time compare, wrong/missing cookie refused, fails closed without a secret, open when no code is set', open && failsClosed && noCode && COOKIE.premium === 'sw_premium' && COOKIE.site === 'sw_site', 'sw_premium / sw_site');

  // Another host (the Pages site) sends the same proof as a bearer token, and only listed origins get CORS headers
  const bearer = proof(undefined, `Bearer ${good2}`) === good2 && proof(good2, null) === good2 && proof(undefined, null) === undefined && proof(undefined, `Bearer ${good2} x`) === undefined && proof('cookie', `Bearer ${good2}`) === good2;
  const savedOrigin = process.env.ALLOWED_ORIGIN;
  const call = (origin?: string) => new Request('https://api.test/api/plan', { method: 'OPTIONS', headers: origin ? { origin } : {} });
  delete process.env.ALLOWED_ORIGIN;
  const offByDefault = !Object.keys(corsHeaders(call('https://ncepler.github.io'))).length;
  process.env.ALLOWED_ORIGIN = 'https://ncepler.github.io/, http://localhost:3222';
  const h = corsHeaders(call('https://ncepler.github.io'));
  const listedOnly = h['access-control-allow-origin'] === 'https://ncepler.github.io' && /authorization/.test(h['access-control-allow-headers']) && h.vary === 'Origin';
  const strangers = !Object.keys(corsHeaders(call('https://evil.example'))).length && !Object.keys(corsHeaders(call())).length && !Object.keys(corsHeaders(call('https://ncepler.github.io.evil.example'))).length;
  const pre = preflight(call('http://localhost:3222'));
  const answers = pre.status === 204 && pre.headers.get('access-control-allow-origin') === 'http://localhost:3222';
  if (savedOrigin !== undefined) process.env.ALLOWED_ORIGIN = savedOrigin;
  else delete process.env.ALLOWED_ORIGIN;
  check('X5', 'cross-host planner: bearer token reads as the cookie; CORS is off by default and echoes only listed origins', bearer && offByDefault && listedOnly && strangers && answers, `bearer ${bearer}, default off ${offByDefault}, listed ${listedOnly}, strangers refused ${strangers}, preflight ${pre.status}`);
}

phase1();
rules();
phase2();
oneWay();
phase4();

phase5().then(() => {
  out(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
});
