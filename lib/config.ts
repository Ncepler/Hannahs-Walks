import type { Pace } from './types';

export const APP_NAME = 'Schnitzel Walks';

export const HOME_ID = 'HOME';

export const METERS_PER_MILE = 1609.344;
export const FT_PER_METER = 3.28084;

/** Validator bounds for any walk (§5 rule 4). */
export const MIN_MILES = 0.3;
export const MAX_MILES = 8;

/** The composer keeps walks inside this window (§8.1). */
export const COMPOSE_MIN_MILES = 0.4;
export const COMPOSE_MAX_MILES = 7.5;

/** Minutes per mile by pace, plus a climb allowance (§9.3). */
export const PACE_MIN_PER_MILE: Record<Pace, number> = { easy: 24, steady: 20, brisk: 16.5 };
export const CLIMB_MIN_PER_100FT = 3;

/** Platform limit for Maps URL waypoints is unverified; 3 is safe everywhere (§12.2). */
export const MAPS_MAX_WAYPOINTS = 3;

export const PREMIUM_MAX_CHARS = 600;

export const COPY = {
  hero: 'Tell me what kind of walk you need.',
  toggleRegular: { label: 'One-time schnitzel fee', sub: 'Pick a few buttons. Get a walk.' },
  togglePremium: { label: 'Monthly schnitzel fee', sub: 'Describe the walk. Claude plans it.' },
  moods: {
    clear: { label: 'Clear my head', sub: 'Quiet streets, an easy rhythm.' },
    workout: { label: 'Work it out', sub: 'Hills, distance, a pulse.' },
    ponder: { label: 'Stare at the trees & ponder life', sub: 'Pretty places and room to wander.' },
  },
  returnHome: { label: 'End back at Home', sub: 'A loop, so you never retrace your steps. Uncheck it if you don’t need to walk home.' },
  surprise: 'Surprise me',
  plan: 'Plan my walk',
  planNow: 'Plan it now',
  spinnerRegular: ['Reading the hills…', 'Matching your mood…', 'Choosing your route…'],
  spinnerPremium: ['Reading your note…', 'Looking at the hills…', 'Drawing your route…'],
  actions: {
    directions: 'Get directions',
    maps: 'Open in Google Maps',
    another: 'Show me another',
    change: 'Change answers',
  },
  noMatch: 'Nothing nearby fits that exactly. This is the closest.',
  busyNote: 'Part of this route is on a busy road. Use the sidewalk or shoulder and cross at signals.',
  hoursNote: 'Check posted hours before you go.',
  directionsHeader: 'Follow along here, or open it in Google Maps for live turn-by-turn.',
  mapsMismatch: 'Google may pick a slightly different path on this one. The list here is the exact route.',
  footer: 'Distances are approximate. Street data © OpenStreetMap contributors.',
  premiumPlaceholder: 'Describe the walk you want…',
  premiumExamples: [
    'Flat and quiet, about 30 minutes, I need to stop thinking.',
    'Hilly. I want to sweat, an hour or so.',
    'Somewhere pretty. End at the pond if you can.',
  ],
} as const;

export const relaxedLine = (what: string) => `Nothing nearby fit "${what}" exactly, so I loosened it.`;
