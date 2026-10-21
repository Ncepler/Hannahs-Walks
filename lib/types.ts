export type NodeId = string;
export type SegmentId = string;
export type Mood = 'clear' | 'workout' | 'ponder';

export interface WalkNode {
  id: NodeId;
  name: string;            // display name; HOME is always 'Home'
  lat: number;
  lon: number;
  elevFt: number;          // USGS 3DEP sample at the node
  kind: 'home' | 'poi' | 'junction';
}

export interface Segment {
  id: SegmentId;
  a: NodeId;               // traversal 'forward' = a -> b
  b: NodeId;
  street: string;          // street name(s) for directions
  meters: number;          // driving-network length, treat as ≈ walking length
  traffic: 1 | 2 | 3;      // 1 quiet residential, 2 moderate, 3 busy arterial
  scenic: 0 | 1 | 2 | 3;   // judgment, see §4.6 (not measured)
  src: 'osrm' | 'derived'; // 'derived' = computed from two OSRM measurements
  note?: string;           // optional one-liner shown in directions
}

export interface CuratedRoute {
  id: string;
  name: string;
  moods: readonly Mood[];  // first entry is the primary mood
  tags: string;            // display chip text
  blurb: string;
  path: readonly NodeId[]; // closed walk: starts and ends at 'HOME', consecutive nodes are adjacent
}

export interface Route {                    // curated or generated, after stats
  id: string;
  name: string;
  origin: 'curated' | 'generated' | 'ai';
  path: NodeId[];
  stats: RouteStats;
  moods: Mood[];
  blurb?: string;
  tags?: string;                            // display chip text
  kind?: WalkKind;                          // how the walk is shaped
}

export interface RouteStats {
  meters: number; miles: number;
  ascentFt: number; descentFt: number;     // node-to-node, lower bound
  maxGradePct: number;
  quietShare: number; busyShare: number;   // 0..1 by length
  scenic: number;                          // 0..1 length-weighted
  turnsPerMile: number;
  pois: NodeId[];                          // visited POI nodes
  repeatShare: number;                     // share of length on edges walked 3+ times
}

export type WalkKind = 'loop' | 'out-and-back' | 'lollipop' | 'custom';
export type Pace = 'easy' | 'steady' | 'brisk';
