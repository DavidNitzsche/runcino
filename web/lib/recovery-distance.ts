/**
 * Pure distance → post-race recovery band mapping.
 *
 * Lives in its own module (no DB imports) so client code can use it
 * without dragging the Postgres client into the browser bundle.
 * Doctrine source: POST_RACE_BY_DISTANCE in coach/doctrine/recovery_protocols.ts.
 */

import type { PostRaceDistance } from '../coach/doctrine';

export function postRaceDistanceBand(distMi: number): PostRaceDistance {
  if (distMi >= 90)  return '100_mile';
  if (distMi >= 55)  return '100K';
  if (distMi >= 40)  return '50_mile';
  if (distMi >= 28)  return '50K';
  if (distMi >= 22)  return 'marathon';
  if (distMi >= 11)  return 'half_marathon';
  if (distMi >= 5)   return '10K';
  return '5K';
}
