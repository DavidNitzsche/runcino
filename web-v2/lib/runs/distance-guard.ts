/**
 * lib/runs/distance-guard.ts · run-distance sanity classification at ingest.
 *
 * 2026-07-06 · phone+watch audit P1-26 / P2-62 fix. The old F20 guard
 * hard-400'd any completion with distance > 50 mi — and BOTH durable
 * retry lanes (watch direct-POST queue, iPhone relay) treat 4xx as
 * permanent and dead-letter the payload. A runner who finished a
 * 50-mile ultra lost the whole completion (phases, GPS, elevation)
 * irreversibly, with the watch stuck on "Uploading…". The plan engine
 * explicitly supports ultra goals (goalDistanceMiFromCode handles
 * 50k/100k; Research/00a-distance-running-training.md §long-run tables
 * and Research/00b-recovery-protocols.md §recovery-timelines both treat
 * 100-mile events as in-doctrine), so a >50 mi run is a legitimate
 * outcome, not garbage.
 *
 * Rule (replaces the flat 50 mi ceiling):
 *   · distance ≤ 50 mi              → ok. Store normally.
 *   · 50 mi < distance ≤ 250 mi     → ACCEPT + quarantine. Store the row
 *     with data.qualityFlag = 'distance_review' so the run is visible
 *     (activity feed, weekly volume — real ultra miles COUNT) but
 *     excluded from fitness anchors (VDOT candidates) until reviewed.
 *   · distance > 250 mi             → reject. No single-session run is
 *     250 mi (24-hour world bests are ~190 mi); this is sensor garbage
 *     or a forgot-to-end phantom. Endpoints must NOT answer 400 —
 *     the durable queues dead-letter 4xx silently. Return the
 *     sub-threshold-style 200 + { dropped } shape instead so the queue
 *     drops the payload INTENTIONALLY and the client can surface it.
 *
 * Why quarantine instead of trusting 50–250 mi outright: the original
 * F20 ceiling existed to stop the dedup absorber treating a 100-mile
 * phantom (treadmill forgot-to-End, GPS runaway) as a valid run and
 * poisoning VDOT/fitness reads. The flag keeps that protection where it
 * matters (VDOT anchors skip flagged rows · lib/training/vdot-inputs.ts)
 * without destroying real ultra data.
 *
 * Rule 6 note (multi-writer jsonb): `qualityFlag` rides inside
 * runs.data. Every runs.data writer is merge-shaped (`runs.data ||
 * jsonb_strip_nulls(EXCLUDED.data)` upserts, or spread-from-existing
 * enhance paths in pullSync/canonical.ts), so a payload that OMITS the
 * key preserves an existing flag — safe by construction. Clearing the
 * flag is explicit only: re-POST idempotent paths call
 * clearDistanceReviewSql when the corrected distance is back in bounds.
 *
 * Applied at the ingest write sites that previously 400'd:
 *   · POST /api/watch/workouts/complete   (Runcino watch / treadmill)
 *   · POST /api/ingest/workout            (HealthKit / iPhone)
 *   · POST /api/run/manual                (manual log)
 * Strava paths (pullSync, webhook) never had a ceiling and are
 * unchanged — Strava-side validation is their upstream guard.
 */

/** Soft bound · above this a run is accepted but quarantined for review. */
export const SOFT_DISTANCE_CEILING_MI = 50;

/** Hard sanity bound · above this no single recorded session is real. */
export const HARD_DISTANCE_CEILING_MI = 250;

/** The quarantine marker stored at runs.data.qualityFlag. */
export const DISTANCE_REVIEW_FLAG = 'distance_review' as const;

export type DistanceVerdict = 'ok' | 'review' | 'reject';

export interface DistanceGuardResult {
  verdict: DistanceVerdict;
  /** 'distance_review' when verdict === 'review', else null. Spread-ready:
   *  `...(g.qualityFlag ? { qualityFlag: g.qualityFlag } : {})` keeps the
   *  key ABSENT (not null) on clean runs so merge upserts can't clobber
   *  a previously-set flag with a stripped null. */
  qualityFlag: typeof DISTANCE_REVIEW_FLAG | null;
  /** Echoed for production-log debugging, same idiom as length-guard. */
  distanceMi: number;
}

/**
 * Classify a run distance at ingest. Null/undefined/NaN distances read
 * as 0 (verdict 'ok') — the sub-threshold guard owns the too-short end.
 */
export function classifyRunDistance(
  distanceMi: number | null | undefined,
): DistanceGuardResult {
  const mi = Number(distanceMi ?? 0) || 0;
  if (mi > HARD_DISTANCE_CEILING_MI) {
    return { verdict: 'reject', qualityFlag: null, distanceMi: mi };
  }
  if (mi > SOFT_DISTANCE_CEILING_MI) {
    return { verdict: 'review', qualityFlag: DISTANCE_REVIEW_FLAG, distanceMi: mi };
  }
  return { verdict: 'ok', qualityFlag: null, distanceMi: mi };
}

/**
 * SQL predicate fragment excluding quarantined rows from fitness-anchor
 * readers (VDOT candidates). Volume/feed readers must NOT use this —
 * real ultra miles count toward weekly volume even while under review.
 * `alias` is the runs-table alias in the caller's query.
 */
export function excludeDistanceReviewSql(alias: string): string {
  return `COALESCE(${alias}.data->>'qualityFlag','') <> '${DISTANCE_REVIEW_FLAG}'`;
}
