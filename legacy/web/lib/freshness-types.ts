/**
 * Freshness wire shapes.
 *
 * Every signal the Coach reads from has a freshness budget, the maximum
 * age past which the signal stops being trustworthy. The shape below is
 * what every API route returns alongside its data so the UI can render
 * "STRAVA · synced 2m ago" or "CHECK-IN · awaiting today" without
 * round-tripping back to the server.
 *
 * Why a separate types file: kept off web/lib/freshness.ts so other
 * modules can import the types without dragging in the DB-bound
 * aggregator (and breaking client-side bundles).
 */

export type FreshnessSource =
  | 'strava'
  | 'checkin'
  | 'vdot-anchor'
  | 'profile'
  | 'race-cal'
  | 'healthkit';

export type FreshnessStaleness =
  | 'fresh'        // inside the budget
  | 'stale-ok'    // past the budget but the signal is still usable
  | 'stale-bad'   // past the budget AND the signal must be refreshed
  | 'unavailable'; // never wired (HealthKit M2)

export interface SignalFreshness {
  /** Which underlying source this is. */
  source: FreshnessSource;
  /** Human-readable, e.g. "STRAVA · synced 2m ago". One-line max. */
  label: string;
  /** True when the source is wired and we have at least one reading. */
  isAvailable: boolean;
  /** True when the source is past its freshness budget. */
  isStale: boolean;
  /** Staleness bucket, drives chip color in the UI. */
  staleness: FreshnessStaleness;
  /** ISO timestamp of the most recent refresh. Null when no signal yet. */
  lastRefreshISO: string | null;
  /** Whole days since the last refresh. Null when no signal yet. */
  daysSince: number | null;
  /** Plain-English reason. Always populated so the UI never has to
   *  synthesize a tooltip. */
  reason: string;
}

export interface FreshnessMap {
  strava: SignalFreshness;
  checkin: SignalFreshness;
  vdotAnchor: SignalFreshness;
  profile: SignalFreshness;
  raceCal: SignalFreshness;
  healthkit: SignalFreshness;
}
