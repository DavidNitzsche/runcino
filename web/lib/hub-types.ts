/**
 * RunnerHub — the canonical shape for the entire app's runtime state.
 *
 * North star: ONE source of truth, many ways to use it. Every page in
 * the app projects from this single payload — dashboard, training,
 * races, race-detail, profile — instead of each making its own fetch.
 *
 * Composition:
 *   - coach:   today's prescription, week, 30-day, VDOT, daily brief,
 *              readiness (the existing CoachTodayPayloadShape verbatim
 *              so the dashboard migration is mechanical)
 *   - races:   the saved race plans + actuals (replaces /api/races on
 *              first load)
 *   - profile: runner identity (age, sex, hrmax, rhr)
 *   - meta:    cache provenance — when was this hub built, was it a
 *              cache hit, what's the latest activity ID it saw
 *
 * The shape is the contract that crosses the wire between /api/hub
 * (server) and useHub() (client). Treat it as semi-frozen — bumping
 * the shape requires a coordinated client + server change.
 *
 * Lives outside lib/hub.ts (server compute) and lib/hub-provider.tsx
 * (client React) so both can import without dragging in each other's
 * runtime — pg on the client, fetch on the server.
 */

import type { CoachTodayPayloadShape } from './coach-today-payload';
import type { SavedRace } from './storage-types';
import type { RunnerProfile } from './runner-profile-store';

export interface RunnerHub {
  ok: true;

  /** Coach payload — today's prescription, week shape, 30-day outlook,
   *  VDOT snapshot, daily brief, readiness. Identical shape to what
   *  /api/coach/today previously returned, so consumers can be ported
   *  by replacing `useCoachToday()` with `useHub()?.coach`. */
  coach: CoachTodayPayloadShape;

  /** All saved races, sorted: future races first (soonest first), then
   *  past races (most recent first). Same sort as `listRacesDB()`. */
  races: SavedRace[];

  /** Runner identity — age, sex, hrmax, rhr. Sourced from the
   *  Postgres `runner_profile` singleton (id=1). Will be `null` until
   *  the runner has filled in /profile. */
  profile: RunnerProfile | null;

  /** Cache + provenance metadata. Lets clients know how fresh the
   *  payload is and whether they're seeing a cache hit. */
  meta: {
    /** ISO timestamp (UTC) when this hub was computed. */
    computedAt: string;
    /** LA-calendar date the cache key keyed off. Used for client-side
     *  staleness detection — if the date has rolled over since this
     *  was computed, the client should re-fetch. */
    cacheDate: string;
    /** The strava_activities.id that was the latest at compute time.
     *  Null if the runner has no activities yet. */
    latestActivityId: number | null;
    /** True if this came from the read-through cache (no recompute). */
    cacheHit: boolean;
  };
}

export interface RunnerHubError {
  ok: false;
  error: string;
}

export type RunnerHubResponse = RunnerHub | RunnerHubError;
