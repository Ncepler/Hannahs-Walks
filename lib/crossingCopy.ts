// FILE: lib/crossingCopy.ts
import type { ForbiddenRoad } from './rules';

export const CROSSING_TITLE = 'Cross Glen Cove Road at the signal';
export const CROSSING_DETAIL = 'Press the button, wait for the walk signal, and use the crosswalk. Allow about a minute.';
export const CROSSING_RIGHT_CELL = '+1 min';

const ROAD_LABEL: Record<ForbiddenRoad, string> = {
  'glen cove road': 'Glen Cove Road',
  'northern boulevard': 'Northern Boulevard',
};

export function crossingFromTo(fromStreet: string, toStreet: string): string {
  return `From ${fromStreet} to ${toStreet}`;
}

export function turnBackText(street: string, road: ForbiddenRoad): string {
  return `Turn back at the end of ${street}. ${ROAD_LABEL[road]} is ahead; this app doesn't walk along it.`;
}
