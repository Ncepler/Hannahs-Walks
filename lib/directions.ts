import { COPY, FT_PER_METER, METERS_PER_MILE } from './config';
import { placeNoun, primaryStreet } from './describe';
import { bearing, turnDelta } from './geo';
import { isOneWay, nodes, traverse, type Traversal } from './graph';
import type { NodeId } from './types';

export interface DirNote {
  text: string;
  /** Busy-road notes get a caution icon so the warning is not colour alone. */
  caution: boolean;
}

export interface DirStep {
  kind: 'street' | 'turnaround' | 'arrive';
  /** Lead words, e.g. "Turn right onto". Empty on the arrival step. */
  turn: string;
  /** Street name as it reads on the sign; the whole line for turnaround and arrival steps. */
  street: string;
  meters: number;
  /** Walked so far, at the end of this step. */
  cumMeters: number;
  cue: string | null;
  notes: DirNote[];
}

/** Under a tenth of a mile is feet to the nearest 50; otherwise miles to one decimal. */
export function fmtStepDistance(meters: number): string {
  const miles = meters / METERS_PER_MILE;
  if (miles < 0.1) return `about ${Math.max(50, Math.round((meters * FT_PER_METER) / 50) * 50)} ft`;
  return `${miles.toFixed(1)} mi`;
}
export const fmtCumulative = (meters: number) => `${(meters / METERS_PER_MILE).toFixed(1)} mi in`;

/**
 * Chord bearings are rough on curved roads, so the words are generous: Continue to 25 degrees,
 * Bear to 60, Turn to 135, then Turn back. Within 15 degrees of an edge the softer word wins.
 */
export function turnWord(delta: number): string {
  const a = Math.abs(delta);
  const side = delta > 0 ? 'right' : 'left';
  if (a < 25 + 15) return 'Continue onto';
  if (a < 60 + 15) return `Bear ${side} onto`;
  if (a < 135 + 15) return `Turn ${side} onto`;
  return 'Turn back onto';
}

const TURNAROUND: Record<string, string> = {
  CEDARMERE: 'Turn around at Cedarmere',
  NCMA: 'Turn around at the museum grounds',
  VIADUCT: 'Pause at the pond',
  VILLAGE: 'Pause at Roslyn village',
  LIBRARY: 'Pause at the library',
  POPLAR_ASH: 'Turn around at the ridge',
  POPLAR_W: 'Turn around at the ridge',
};
const turnaroundLine = (id: NodeId) => TURNAROUND[id] ?? `Turn around at ${nodes[id].name}`;

function hillCue(legs: Traversal[]): string | null {
  let climb = 0;
  let drop = 0;
  let steepest = 0;
  for (const t of legs) {
    if (t.deltaFt > 0) climb += t.deltaFt;
    else drop -= t.deltaFt;
    steepest = Math.max(steepest, (Math.abs(t.deltaFt) / (t.seg.meters * FT_PER_METER)) * 100);
  }
  const round = (ft: number) => Math.round(ft / 10) * 10;
  const parts: string[] = [];
  if (steepest >= 7) parts.push('steep');
  if (climb >= 40) parts.push(`climbs about ${round(climb)} ft`);
  if (drop >= 40) parts.push(`drops about ${round(drop)} ft`);
  return parts.length ? parts.join(', ') : null;
}

/** Street-by-street outline of the walk (§11.2). Deterministic and offline. */
export function buildDirections(path: readonly NodeId[]): DirStep[] {
  const legs = traverse(path);

  // Merge consecutive legs on the same street, but never across a turnaround.
  const groups: Traversal[][] = [];
  const turnAfter = new Set<number>(); // group index that a turnaround precedes
  for (const leg of legs) {
    const group = groups[groups.length - 1];
    const prev = group?.[group.length - 1];
    const sameStreet = !!prev && primaryStreet(prev.seg.street) === primaryStreet(leg.seg.street);
    const reversal = !!prev && leg.to === prev.from;
    if (group && sameStreet && !reversal) group.push(leg);
    else {
      if (reversal) turnAfter.add(groups.length);
      groups.push([leg]);
    }
  }

  const steps: DirStep[] = [];
  let cum = 0;
  groups.forEach((g, i) => {
    const first = g[0];
    const meters = g.reduce((m, t) => m + t.seg.meters, 0);

    if (turnAfter.has(i)) {
      steps.push({ kind: 'turnaround', turn: '', street: turnaroundLine(first.from), meters: 0, cumMeters: cum, cue: null, notes: [] });
    }

    let turn = 'Head out of Home onto';
    if (i > 0) {
      const prevGroup = groups[i - 1];
      const pl = prevGroup[prevGroup.length - 1];
      turn = turnWord(turnDelta(bearing(pl.from, pl.to), bearing(first.from, first.to)));
    }

    const seen = new Set<string>();
    const notes: DirNote[] = [];
    for (const t of g) {
      if (t.seg.note && !seen.has(t.seg.note)) {
        seen.add(t.seg.note);
        notes.push({ text: t.seg.note, caution: t.seg.traffic === 3 });
      }
    }

    cum += meters;
    steps.push({
      kind: 'street',
      turn,
      street: first.seg.street.split(' / ')[0],
      meters,
      cumMeters: cum,
      cue: hillCue(g),
      notes,
    });
  });

  const end = path[path.length - 1];
  steps.push({
    kind: 'arrive',
    turn: '',
    street: isOneWay(path) ? `Arrive at ${placeNoun(end) ?? nodes[end].name}.` : 'Arrive Home.',
    meters: 0,
    cumMeters: cum,
    cue: null,
    notes: [],
  });
  return steps;
}

/** Plain text for the clipboard. */
export function stepsToText(title: string, summary: string, steps: DirStep[]): string {
  const lines = [title, summary, COPY.directionsHeader, ''];
  steps.forEach((s, i) => {
    const head = s.kind === 'street' ? `${s.turn} ${s.street}` : s.street;
    const tail = s.kind === 'street' ? ` (${fmtStepDistance(s.meters)}, ${fmtCumulative(s.cumMeters)})` : '';
    lines.push(`${i + 1}. ${head}${tail}${s.cue ? `: ${s.cue}` : ''}`);
    for (const n of s.notes) lines.push(`   ${n.text}`);
  });
  return lines.join('\n');
}
