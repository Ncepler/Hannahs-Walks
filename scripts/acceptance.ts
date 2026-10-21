// Run from the repo root: npx tsx scripts/acceptance.ts
// Imports the real data and libs. The only literals are the expected numbers from the spec.
import fs from 'node:fs';
import path from 'node:path';
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
import { MAPS_MAX_WAYPOINTS } from '../lib/config';
import { computeStats, isClosedLoop, isOneWay, LANDMARKS, milesOf, retraceOf, reversalHolds, segmentsBetween, traverse, validatePath } from '../lib/graph';
import { another, apmOf, defaultAnswers, diversePicks, getPool, minutesFor, plan, rank, type Answers, type Stop } from '../lib/score';
import type { Mood } from '../lib/types';

let failures = 0;
const out = (line = '') => process.stdout.write(`${line}\n`);
const section = (title: string) => out(`\n${title}`);
function check(id: string, what: string, ok: boolean, actual: string) {
  if (!ok) failures++;
  out(`  ${ok ? 'PASS' : 'FAIL'}  ${id}  ${what}  [${actual}]`);
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
  const streets = '(?:Birch|Elm|Chestnut|Sycamore|Cypress|Fir|Poplar|Ash|Pinewood|Teakwood|Midwood|Maplewood|Greenwood|Harbor Hill|Round Hill|Glen Cove|Northern|Museum|Wittes|Bryant|Old Northern|East Broadway|Main|Glen|Roslyn|Red Ground|Old Farm)';
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
  out(`  INFO  pool: ${pool.curated} curated + ${pool.composed} composed (${pool.duplicatesDropped} composed dropped as curated duplicates)`);

  const base = (mood: Mood, over: Partial<Answers>): Answers => ({ ...defaultAnswers(mood), pace: 'steady', ...over });
  const stops = (...s: Stop[]) => new Set<Stop>(s);

  // A9 is the spec's filter pipeline on the whole pool. A flat, quiet half hour and a hilly hour and a half
  // only exist as out-and-backs here, so these two run with "End back at Home" unchecked (X7 covers the loops).
  const a1 = base('clear', { time: { min: 30 }, hills: 'flat', avoidBusy: true, returnHome: false });
  const r1 = rank(a1);
  const t1 = r1.ranked[0];
  check('A9', 'clear, 30 min, flat, avoid busy: 24 - 36 min, apm <= 70, busy <= 0.10, nothing relaxed', !!t1 && r1.relaxed.length === 0 && t1.minutes >= 24 && t1.minutes <= 36 && apmOf(t1.route.stats) <= 70 && t1.route.stats.busyShare <= 0.1, `${t1?.route.name}: ${t1?.minutes.toFixed(0)} min, apm ${t1 ? apmOf(t1.route.stats).toFixed(0) : '-'}; ${r1.count} candidates in the pool`);

  const a2 = base('workout', { time: { min: 90 }, hills: 'hilly', returnHome: false });
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
  check('X7', 'checked: curated out-and-backs and the Chestnut lollipop are not offered; the true curated loops are', curatedDoubling.length >= 10 && curatedDoubling.every((id) => !offered.has(id)) && ['R01', 'R04', 'R05', 'R09', 'R10', 'R11', 'R14', 'R15', 'R16', 'R17'].every((id) => offered.has(id)), `${curatedDoubling.length} held back (${curatedDoubling.slice(0, 4).join(', ')}, ...)`);

  // The museum and Cedarmere sit at the ends of dead-end roads, so a walk to one has to go in and out. That is
  // allowed only for a place the person picked.
  const museum = rank({ ...defaultAnswers('ponder'), stops: new Set<Stop>(['museum']) });
  const museumOk = museum.relaxed.length === 0 && museum.ranked.length > 0 && museum.ranked.every((s) => s.route.visited.has('NCMA') && !s.route.visited.has('CEDARMERE') && isClosedLoop(s.route.retrace, new Set(['NCMA'])));
  const both = rank({ ...defaultAnswers('ponder'), stops: new Set<Stop>(['museum', 'cedarmere']) });
  const bothOk = both.relaxed.length === 0 && both.ranked.length > 0 && both.ranked.every((s) => s.route.visited.has('NCMA') && s.route.visited.has('CEDARMERE') && isClosedLoop(s.route.retrace, new Set(['NCMA', 'CEDARMERE'])));
  const unasked = rank(defaultAnswers('ponder')).ranked.filter((s) => s.route.visited.has('NCMA') || s.route.visited.has('CEDARMERE')).length;
  check('X7', 'checked: a picked museum or Cedarmere is reached by its dead-end road only; nobody walks one unasked', museumOk && bothOk && unasked === 0, `museum ${museum.ranked.length} walks, museum + Cedarmere ${both.ranked.length}, unasked ${unasked}`);

  // Unchecked is as before: walks that double back are still on offer.
  const free = rank({ ...defaultAnswers('clear'), returnHome: false }).ranked;
  check('X7', 'unchecked: out-and-backs and lollipops are still offered, beside the one-way walks', free.some((s) => retraceOf(s.route.path).repeated.length > 0) && free.some((s) => isOneWay(s.route.path)), `${free.filter((s) => retraceOf(s.route.path).repeated.length > 0).length} double back, ${free.filter((s) => isOneWay(s.route.path)).length} one-way`);
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

async function phase5() {
  section('Premium planner (Phase 5): validators and pipeline on fixtures; the live model call is not exercised');
  const R = (id: string) => [...CURATED.find((c) => c.id === id)!.path];
  const ask = (prompt: string, over: Partial<Ask> = {}): Ask => ({ prompt, pace: 'steady', returnHome: true, ...over });
  const body = { title: 'Test walk', mood: 'clear', why: 'You get quiet streets.' };
  const reject = (path: unknown, a: Ask) => {
    const c = checkPlan({ ...body, path }, a);
    return c.ok ? 'ACCEPTED' : c.error;
  };

  // A12
  const notHome = reject(['BIRCH_ELM', 'HOME', 'BIRCH_SYC', 'HOME'], ask('a walk'));
  const jump = reject(['HOME', 'NCMA', 'HOME', 'BIRCH_ELM', 'HOME'], ask('a walk'));
  const ghost = reject(['HOME', 'BIRCH_ELM', 'ATLANTIS', 'BIRCH_ELM', 'HOME'], ask('a walk'));
  const ten = [...R('R17'), ...R('R14').slice(1)];
  const tenMi = milesOf(ten);
  const tooLong = reject(ten, ask('about 2 miles'));
  const sixVsTwo = reject(R('R17'), ask('about 2 miles'));
  check('A12', 'rejects a path that does not start at HOME', /start at HOME/.test(notHome), notHome);
  check('A12', 'rejects a non-adjacent pair', /does not exist/.test(jump), jump);
  check('A12', 'rejects an unknown node', /Unknown node ATLANTIS/.test(ghost), ghost);
  check('A12', `rejects a ${tenMi.toFixed(1)} mi walk when the request says "about 2 miles" (and a 6 mi one by the 30% rule)`, tooLong !== 'ACCEPTED' && /requested about 2/.test(sixVsTwo), `${tooLong}; ${sixVsTwo}`);
  const okPlain = checkPlan({ ...body, path: R('R04') }, ask('a gentle loop'));
  const okNumber = checkPlan({ ...body, path: R('R04') }, ask('about 1 mile'));
  check('A12', "accepts R04's path, with and without a number in the note", okPlain.ok && okNumber.ok, `R04 = ${milesOf(R('R04')).toFixed(2)} mi`);

  // The rest of §13.5 and the parsing helper
  const pp = checkPlan({ ...body, path: R('R04'), pause_points: ['LIBRARY', 'CYP_ELM', 'BIRCH_SYC', 'ELM_W'] }, ask('x'));
  check('X5', 'pause points not on the path are dropped, at most two kept', pp.ok && pp.plan.pausePoints.join() === 'CYP_ELM,BIRCH_SYC', pp.ok ? pp.plan.pausePoints.join() : 'rejected');
  check('X5', 'a time in the note is held to ±30%', checkPlan({ ...body, path: R('R04') }, ask('about 30 minutes')).ok && !checkPlan({ ...body, path: R('R04') }, ask('about 90 minutes')).ok, 'R04 is ~25 min');
  const t = (s: string) => parseTargets(s);
  const near2 = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 0.05;
  const one = (x: Span | undefined, v: number) => !!x && near2(x.lo, v) && near2(x.hi, v);
  check('X5', 'distance and time parsing: 3 miles, 5k, 45 minutes, an hour, an hour and a half, a 3-mile walk', one(t('3 miles').miles, 3) && one(t('5k').miles, 3.11) && one(t('about 45 minutes').minutes, 45) && one(t('an hour or so').minutes, 60) && one(t('an hour and a half').minutes, 90) && one(t('1.5 hours').minutes, 90) && one(t('half an hour').minutes, 30) && one(t('a 3-mile walk').miles, 3) && one(t('a 30-minute walk').minutes, 30) && one(t('1 hour and 15 minutes').minutes, 75) && t('I need to stop thinking').minutes === undefined && t('I need to stop thinking').miles === undefined, JSON.stringify([t('5k'), t('an hour and a half')]));
  const lib = ['HOME', 'BIRCH_SYC', 'SYC_FIR', 'FIR_CHEST', 'GREEN_CHEST', 'CHEST_NB', 'NB_MUSEUM', 'NB_BEECH', 'NB_WITTES', 'WITTES_BRYANT', 'BRYANT_ON', 'ON_EBWAY', 'LIBRARY'];
  check('X5', 'one-way: a walk finishing at the library passes only when the box is unchecked; a junction finish never does', checkPlan({ ...body, path: lib }, ask('x', { returnHome: false })).ok && !checkPlan({ ...body, path: lib }, ask('x', { returnHome: true })).ok && !checkPlan({ ...body, path: lib.slice(0, 6) }, ask('x', { returnHome: false })).ok, 'ok');

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
  const bad = use({ ...body, mood: 'mixed', path: ['HOME', 'NCMA', 'HOME', 'BIRCH_ELM', 'HOME'] });

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
  check('X5', 'fallback for "somewhere pretty, end at the pond": ponder mood, passes the pond', e.mood === 'ponder' && (e.path.includes('VILLAGE') || e.path.includes('VIADUCT')), `${e.title}`);
  const f = await planWalk(fake([bad]).client, ask('x', { returnHome: false, prompt: 'a short walk to the library' }));
  check('X5', 'fallback honours "no need to return": library stop, and the result may be one-way', f.path.includes('LIBRARY'), `${f.title}${isOneWay(f.path) ? ' (one-way)' : ''}`);
  const g = await planWalk(fake([use({ ...body, mood: 'ponder', path: ['HOME', 'NCMA', 'HOME', 'BIRCH_ELM', 'HOME'] })]).client, ask('go for a walk'));
  check('X5', "fallback takes the model's own mood when it gave one", g.source === 'fallback' && g.mood === 'ponder', g.mood);
  check('X5', 'mood keywords: sweat, quiet, pretty', inferMood('I want to sweat') === 'workout' && inferMood('something calm') === 'clear' && inferMood('trees please') === 'ponder' && inferMood('x', 'ponder') === 'ponder', 'ok');

  // The prompt is generated from the data and carries no address
  const sys = buildSystemPrompt();
  const allIds = Object.keys(NODES).every((id) => sys.includes(`${id} |`)) && SEGMENTS.every((s) => sys.includes(`${s.id} |`));
  const examples = CURATED.every((c) => sys.includes(`${c.id} | ${c.name} |`));
  const user = JSON.stringify(a.calls[0].messages);
  check('X5', 'system prompt lists all 39 nodes, 48 segments and 22 examples (no example paths), no ZIP, no Walnut', allIds && examples && !/11576|Walnut/i.test(sys) && !/HOME, BIRCH/.test(sys) && /must finish back at HOME/.test(user), `${sys.length} chars, about ${Math.round(sys.length / 4)} tokens`);

  // X7: a walk that ends at HOME must be a closed loop, in the validator, the prompt and the fallback
  const outAndBack = reject(R('R08'), ask('a walk'));
  const lollipop = reject(R('R06'), ask('a walk'));
  const museumLoop = rank({ ...defaultAnswers('ponder'), stops: new Set<Stop>(['museum']) }).ranked[0].route.path;
  check('X7', 'checkPlan: an out-and-back or a lollipop is refused with the street and "closed loop"; a real loop and the unchecked box pass', /Birch Dr/.test(outAndBack) && /closed loop/.test(outAndBack) && /closed loop/.test(lollipop) && lollipop !== 'ACCEPTED' && checkPlan({ ...body, path: R('R04') }, ask('a walk')).ok && checkPlan({ ...body, path: R('R08') }, ask('a walk', { returnHome: false })).ok, outAndBack);
  check('X7', 'checkPlan: a dead-end spur is fine for a place the note names and refused for one it does not', checkPlan({ ...body, path: museumLoop }, ask('something by the museum')).ok && /dead end/.test(reject(museumLoop, ask('a walk'))) && /closed loop/.test(reject(R('R12'), ask('the museum, please'))), reject(museumLoop, ask('a walk')));
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
  const trip = ask('a 3-4 mile walk');
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
phase2();
oneWay();
phase4();

phase5().then(() => {
  out(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
});
