// Run from the repo root: npx tsx scripts/acceptance.ts
// Imports the real data and libs. The only literals are the expected numbers from the spec.
import fs from 'node:fs';
import path from 'node:path';
import { CURATED } from '../data/curated';
import { NODES } from '../data/nodes';
import { SEGMENTS } from '../data/segments';
import { METERS_PER_MILE } from '../lib/config';
import { computeStats, reversalHolds, segmentsBetween, validatePath } from '../lib/graph';

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

phase1();

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
