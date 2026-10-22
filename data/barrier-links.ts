// FILE: data/barrier-links.ts
// Seed v3: the segments that were removed because they walk along a forbidden road.
// Used ONLY to simulate Google's shortest path (lib/waypoints.ts) and to draw the "Not walked" lines in seed mode.
// Nothing in routing, composing or the premium catalogue may import this file.
export interface BarrierLink {
  id: string;
  a: string;
  b: string;
  meters: number;
  road: 'glen cove road' | 'northern boulevard';
}

export const BARRIER_LINKS: readonly BarrierLink[] = [
  { id: 'B1', a: 'ELM_GC', b: 'GC_MIDWOOD', meters: 529.2, road: 'glen cove road' },        // was S22
  { id: 'B2', a: 'ELM_GC', b: 'GC_RED', meters: 620.4, road: 'glen cove road' },             // was S41
  { id: 'B3', a: 'GC_RED', b: 'GC_ROUNDHILL', meters: 563.7, road: 'glen cove road' },       // was S43
  { id: 'B4', a: 'CHEST_NB', b: 'NB_WITTES', meters: 1104.9, road: 'northern boulevard' },   // was S24 + S25 + S26
  { id: 'B5', a: 'VILLAGE', b: 'BRYANT_ON', meters: 1923.8, road: 'northern boulevard' },    // was S47 + S48
];
