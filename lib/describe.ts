import { FT_PER_METER } from './config';
import { isOneWay, traverse } from './graph';
import { apmOf, roundMinutes, type PoolRoute } from './score';
import type { Mood, NodeId } from './types';

/* ---------- Display numbers: always approximate (§4.6) ---------- */

export const fmtMiles = (miles: number) => `≈ ${miles.toFixed(1)} mi`;
export const fmtTime = (minutes: number) => `about ${roundMinutes(minutes)} min`;
export const fmtClimb = (ft: number) => `≈ +${Math.round(ft / 10) * 10} ft`;

const LONG: Record<string, string> = { Dr: 'Drive', Rd: 'Road', Ln: 'Lane', Blvd: 'Boulevard', Ave: 'Avenue', St: 'Street' };
/** "Ash Dr" to "Ash Drive" for prose. */
export const longStreet = (name: string) => name.replace(/\b(Dr|Rd|Ln|Blvd|Ave|St)\b/g, (m) => LONG[m]);
export const primaryStreet = (street: string) => street.split(' / ')[0].replace(/\s*\(.*\)$/, '').trim();

/* ---------- Pause points (§10.3 item 6) ---------- */

export interface PausePoint {
  id: NodeId;
  title: string;
  text: string;
  /** Museum and Cedarmere: hours are never promised. */
  hours: boolean;
}

// Only facts from §4.4.
const PLACE: Record<string, Omit<PausePoint, 'id'> & { noun: string }> = {
  VILLAGE: { title: 'Roslyn village', text: 'pond and old mill', hours: false, noun: 'Roslyn village' },
  NCMA: { title: 'Museum grounds', text: 'sculpture and walking grounds', hours: true, noun: 'the museum grounds' },
  CEDARMERE: { title: 'Cedarmere', text: 'home of the poet William Cullen Bryant', hours: true, noun: 'Cedarmere' },
  LIBRARY: { title: 'Bryant Library', text: 'a good place to pause', hours: false, noun: 'the library' },
  VIADUCT: { title: 'Roslyn Viaduct', text: 'stone arch at the head of the pond', hours: false, noun: 'the viaduct' },
  POPLAR_ASH: { title: 'The ridge', text: 'about 316 ft, the highest ground near Home', hours: false, noun: 'the ridge' },
  POPLAR_W: { title: 'The ridge', text: 'about 316 ft, the highest ground near Home', hours: false, noun: 'the ridge' },
};

export const placeTitle = (id: NodeId): string | undefined => PLACE[id]?.title;

/** Up to two places on the route, landmarks first, then the ridge. */
export function pausePoints(route: PoolRoute): PausePoint[] {
  const landmarks = route.stats.pois.filter((id) => PLACE[id] && !id.startsWith('POPLAR'));
  const ridge = route.stats.pois.filter((id) => id.startsWith('POPLAR'));
  return [...landmarks, ...ridge].slice(0, 2).map((id) => {
    const { title, text, hours } = PLACE[id];
    return { id, title, text, hours };
  });
}

/** True when any walked segment is on a busy road (traffic 3). */
export const hasBusyRoad = (route: PoolRoute) => traverse(route.path).some((t) => t.seg.traffic === 3);

/* ---------- "Why this one" (§10.3 item 5) ---------- */

function steepestClimb(route: PoolRoute): { street: string; grade: number } | null {
  let best: { street: string; grade: number } | null = null;
  for (const t of traverse(route.path)) {
    if (t.deltaFt <= 0) continue;
    const grade = (t.deltaFt / (t.seg.meters * FT_PER_METER)) * 100;
    if (!best || grade > best.grade) best = { street: primaryStreet(t.seg.street), grade };
  }
  return best;
}

export function whyThisOne(route: PoolRoute, mood: Mood): string {
  const s = route.stats;
  const apm = apmOf(s);

  const traffic =
    s.quietShare === 1
      ? 'quiet streets the whole way'
      : s.quietShare >= 0.8
        ? 'mostly quiet streets'
        : s.busyShare >= 0.2
          ? 'some time on busy roads'
          : 'mostly residential streets';

  const hill = steepestClimb(route);
  const hills =
    hill && hill.grade >= 6
      ? `one real hill on ${longStreet(hill.street)}`
      : apm <= 45
        ? 'barely any climbing'
        : 'gentle grades';

  const end = route.path[route.path.length - 1];
  const place = s.pois.find((id) => PLACE[id]);
  const pause = isOneWay(route.path) && PLACE[end]
    ? `${PLACE[end].noun} as your finish`
    : place
      ? `${PLACE[place].noun} as your pause point`
      : null;

  const order =
    mood === 'workout' ? [hills, traffic, pause] : mood === 'ponder' ? [pause, traffic, hills] : [traffic, hills, pause];
  const parts = order.filter((p): p is string => !!p);
  const sentence =
    parts.length > 2 ? `${parts[0]}, ${parts[1]}, and ${parts[2]}` : parts.join(' and ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.';
}

export const joinList = (items: string[]) =>
  items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : (items[0] ?? '');
