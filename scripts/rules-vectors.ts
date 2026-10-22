// FILE: scripts/rules-vectors.ts
import { forbiddenRoadOf } from '../lib/rules';
import { isParallelToForbidden } from './osm/forbidden';
import type { LatLon } from './osm/forbidden';

/** [street, ref, expected]. The Old Northern Boulevard rows are the substring trap. */
export const NAME_CASES: ReadonlyArray<readonly [string, string | undefined, string | null]> = [
  ['Glen Cove Rd', undefined, 'glen cove road'],
  ['GLEN COVE ROAD', undefined, 'glen cove road'],
  ['Glen Cove Road', 'CR 1', 'glen cove road'],
  ['Northern Blvd (NY 25A)', undefined, 'northern boulevard'],
  ['Northern Boulevard', undefined, 'northern boulevard'],
  ['Teakwood Ln / Glen Cove Rd', undefined, 'glen cove road'],
  ['Some Street', 'NY 25A', 'northern boulevard'],
  ['Old Northern Blvd', undefined, null],
  ['Old Northern Blvd / Glen Ave', undefined, null],
  ['Old Northern Boulevard', undefined, null],
  ['Glen Cove Rd crossing (signal)', undefined, null],   // the crossing segment is checked by kind, not by name
  ['Cove Rd', undefined, null],
  ['Glen Ave', undefined, null],
  ['Northern State Pkwy', undefined, null],               // excluded by highway type (H8), not by this test
];

const LAT0 = 40.8;
const LON0 = -73.63;
const M_LAT = 1 / 111_034;
const M_LON = 1 / (111_320 * Math.cos((LAT0 * Math.PI) / 180));
const at = (northM: number, eastM: number): LatLon => [LAT0 + northM * M_LAT, LON0 + eastM * M_LON];

/** A forbidden road running due east for 800 m. */
export const ROAD: ReadonlyArray<readonly LatLon[]> = [[at(0, 0), at(0, 800)]];

export const GEOMETRY_CASES: ReadonlyArray<{ name: string; way: readonly LatLon[]; parallel: boolean }> = [
  { name: 'sidewalk 10 m off, 100 m long', way: [at(10, 100), at(10, 200)], parallel: true },
  { name: 'sidewalk 24 m off, 100 m long', way: [at(24, 100), at(24, 200)], parallel: true },
  { name: 'footway 40 m off, 100 m long', way: [at(40, 100), at(40, 200)], parallel: false },
  { name: 'parallel but only 20 m long', way: [at(10, 100), at(10, 120)], parallel: false },
  { name: 'crossing at right angles', way: [at(-60, 400), at(60, 400)], parallel: false },
  { name: 'diagonal at 45 degrees', way: [at(-40, 300), at(40, 380)], parallel: false },
];

/** Returns a list of failure messages (empty = all good). */
export function runRuleVectors(): string[] {
  const failures: string[] = [];
  for (const [street, ref, want] of NAME_CASES) {
    const got = forbiddenRoadOf(street, ref);
    if (got !== want) failures.push(`forbiddenRoadOf(${JSON.stringify(street)}, ${JSON.stringify(ref)}) = ${got}, wanted ${want}`);
  }
  for (const c of GEOMETRY_CASES) {
    const got = isParallelToForbidden(c.way, ROAD);
    if (got !== c.parallel) failures.push(`geometry "${c.name}": got ${got}, wanted ${c.parallel}`);
  }
  return failures;
}
