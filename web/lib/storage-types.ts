/**
 * SavedRace + ActualResult shapes. Lives outside lib/storage.ts (the
 * client-side API wrapper) and lib/race-store.ts (the server-side
 * Postgres CRUD) so both can import without dragging in each other's
 * runtime — pg on the client, fetch on the server.
 *
 * The shape is the contract that crosses the wire between /api/races
 * (server) and useRaces() (client). Treat it as semi-frozen — the iOS
 * app reads the same shape from iCloud once that pipe lands.
 */

import type { RuncinoPlan } from './types';

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
  plan: RuncinoPlan;
  gpxText: string;
  savedAt: string;
  meta: {
    name: string;
    date: string;
    distanceMi: number;
    goalDisplay: string;
    courseSlug: string;
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
