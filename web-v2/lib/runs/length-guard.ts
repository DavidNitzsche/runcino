/**
 * lib/runs/length-guard.ts · sub-threshold run filter at ingest.
 *
 * David tests workouts on the Runcino watch (tap-around, abort early).
 * Without a guard, those land in `runs` and pollute the 4-week volume
 * average, which feeds the drift monitor's "your plan is 62% behind
 * where you actually are" banner.
 *
 * Rule (locked 2026-06-02 with David):
 *   Drop the row if distanceMi < 0.25 AND durationSec < 180.
 *
 * Why AND, not OR:
 *   · Indoor / treadmill runs may report distanceMi=0 (no GPS) but a
 *     legit 30+ minute duration. Distance-only would drop those.
 *   · An outdoor run aborted at 0.4 mi after 60 s is still 0.4 mi of
 *     real running. Duration-only would drop those.
 *   · Tap-tests fail BOTH thresholds. Real runs fail at most one.
 *
 * Applied at every ingest write site:
 *   · POST /api/watch/workouts/complete   (Runcino watch)
 *   · POST /api/ingest/workout            (HealthKit / iPhone)
 *   · POST /api/run/manual                (manual log)
 *   · lib/strava/pullSync.ts              (Strava connector)
 *
 * On hit, the endpoint returns 200 with { ok: true, dropped:
 * 'sub_threshold', distanceMi, durationSec } so the caller knows the
 * post landed but was rejected as a tap test. Watch + iPhone clients
 * treat that as "completed and quiet · don't surface."
 */

export const MIN_DISTANCE_MI = 0.25;
export const MIN_DURATION_SEC = 180;

export interface SubThresholdInput {
  distanceMi: number | null | undefined;
  durationSec: number | null | undefined;
}

export interface SubThresholdResult {
  isSubThreshold: boolean;
  reason: 'sub_threshold' | null;
  /** Echoed back to the caller so we can debug "why did it drop?"
   *  in production logs without reading the request body. */
  distanceMi: number;
  durationSec: number;
}

/**
 * Returns whether a run is too short to keep. Inputs may be null/undef
 * if the upstream parser couldn't extract them · treat both as 0 (which
 * fails the threshold and drops the row · the safer side, since a run
 * with NO distance AND NO duration carries no signal anyway).
 */
export function isSubThresholdRun(input: SubThresholdInput): SubThresholdResult {
  const distanceMi = Number(input.distanceMi ?? 0) || 0;
  const durationSec = Number(input.durationSec ?? 0) || 0;
  const subThreshold = distanceMi < MIN_DISTANCE_MI && durationSec < MIN_DURATION_SEC;
  return {
    isSubThreshold: subThreshold,
    reason: subThreshold ? 'sub_threshold' : null,
    distanceMi,
    durationSec,
  };
}
