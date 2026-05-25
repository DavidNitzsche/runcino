/**
 * SavedRace + ActualResult shapes. Lives outside lib/storage.ts (the
 * client-side API wrapper) and lib/race-store.ts (the server-side
 * Postgres CRUD) so both can import without dragging in each other's
 * runtime, pg on the client, fetch on the server.
 *
 * The shape is the contract that crosses the wire between /api/races
 * (server) and useRaces() (client). Treat it as semi-frozen, the iOS
 * app reads the same shape from iCloud once that pipe lands.
 */

import type { FaffPlan } from './types';

export interface ActualResult {
  finishS: number;
  finishDisplay: string;
  paceSPerMi: number;
  paceDisplay: string;
  isPR?: boolean;
  notes?: string;
  recordedAt: string;
  source?: 'manual' | 'strava';
  stravaActivityId?: number;
  avgHr?: number | null;
  maxHr?: number | null;
  avgCadence?: number | null;
  totalGainFt?: number;
  activityName?: string;
  description?: string | null;
  sufferScore?: number | null;
  kudosCount?: number;
  achievementCount?: number;
  workoutType?: number | null;
  miles?: Array<{
    mile: number;
    paceSPerMi: number;
    paceDisplay: string;
    elapsedS: number;
    avgHr: number | null;
    elevDeltaFt: number;
  }>;
  bestEfforts?: Array<{
    name: string;
    elapsedS: number;
    elapsedDisplay: string;
    distanceMi: number;
    isPR: boolean;
    rank: number | null;
  }>;
  summaryPolyline?: string;
}

export interface SavedRace {
  slug: string;
  plan: FaffPlan;
  gpxText: string;
  /** DEM elevation in meters, parallel to the GPX trackpoints array.
   *  Set when the race was created via the DEM pipeline. Used by the
   *  detail page to render the elevation profile from DEM (not GPS). */
  demElevations?: number[];
  savedAt: string;
  meta: {
    name: string;
    date: string;
    distanceMi: number;
    goalDisplay: string;
    courseSlug: string;
    /** Race priority / effort level drives BOTH (a) how Coach treats
     *  the race in macrocycle planning and (b) how heavily the result
     *  weights into aggregate VDOT.
     *
     *  Six levels (David spec 2026-05-19):
     *    'A', primary target. Macrocycle built toward
     *                       this date. Result weighted 1.0× in aggregate.
     *    'B', secondary checkpoint. Lighter taper.
     *                       Result weighted 0.7×.
     *    'C', minor race, ran with some intention but not
     *                       full effort. Result weighted 0.4×.
     *    'tune-up', explicit pre-A-race tune-up. Result
     *                       weighted 0.4× (same as C, the runner
     *                       chose to express the intent semantically).
     *    'training-run', race used as a workout, not raced. Result
     *                       weighted 0.2×.
     *    'hilly-excluded', race on a course that's hilly enough to
     *                       systematically distort the time→VDOT
     *                       mapping. Result weighted 0.0×, excluded
     *                       from aggregate. Used for Big Sur, mountain
     *                       races, etc.
     *
     *  Defaults to 'A' when missing, backward compat for races saved
     *  before this field existed. */
    priority?: 'A' | 'B' | 'C' | 'tune-up' | 'training-run' | 'hilly-excluded';
  };
  actualResult?: ActualResult | null;
}

/** Slugify a free-text race name. Falls back to a timestamp suffix on
 *  collision so two races with the same name never overwrite each other. */
export function slugifyRaceName(name: string, taken: Set<string> = new Set()): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'race';
  if (!taken.has(base)) return base;
  const year = new Date().getFullYear();
  if (!taken.has(`${base}-${year}`)) return `${base}-${year}`;
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}
