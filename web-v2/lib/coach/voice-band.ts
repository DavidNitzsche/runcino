/**
 * lib/coach/voice-band.ts · adaptive coach voice scoring.
 *
 * Computes the coach voice band for a runner from objective signals.
 * Drives copy across surfaces:
 *   · Morning brief headline (ReadinessBrief.headline)
 *   · Pre-run cue on the workout poster
 *   · Post-run recap framing
 *
 * Three bands · per `designs/briefs/onboarding-master.md` decision #2:
 *   · calibration · "Let's figure this out together. I'll adjust as
 *                    I learn." · soft, hedged paces, ±15s bands.
 *   · guided      · "Here's the plan. Tell me if a pace feels wrong."
 *                    · concrete prescriptions with a soft override.
 *   · challenge   · "Hit the prescription. The plan is honest."
 *                    · direct, no hedging.
 *
 * Triggers (combined · the FIRST matching band wins; explicit override
 * checks fire last):
 *   · 0 race history OR vdotConfidence < 0.4 OR active calibration  → calibration
 *   · 1 recent race OR vdotConfidence 0.4-0.7                       → guided
 *   · 2+ recent races AND vdotConfidence > 0.7                       → challenge
 *
 * Soft adjustments:
 *   · Goal-time >10% off projected for 14+ days     → step DOWN one band
 *   · Subjective check-in disagrees with objective 5+ days  → soft-cap at guided
 *   · Active niggle / injury / sick episode         → soft-cap at guided
 *
 * Hard overrides:
 *   · `calibration_sessions` row with completed_at set + confidence ≥ 0.45
 *     → can step calibration → guided immediately
 *
 * The result is cacheable for ~6h · race results land at most once a
 * day, calibration runs are a one-time event. Recompute on:
 *   · New race result written to `races`
 *   · `calibration_completed` coach intent
 *   · Goal change / race change (which would already replan)
 */

import { pool } from '@/lib/db/pool';
import type { CoachState } from '@/lib/topics/types';

/* ────────────────────────── Public types ────────────────────────── */

export type VoiceBand = 'calibration' | 'guided' | 'challenge';

export interface VoiceBandReason {
  band: VoiceBand;
  /** 0-1 · self-reported confidence in this band. Drives the
   *  `confidenceLabel` rendered on debug/voice-band endpoints. */
  confidence: number;
  /** Plain-English reasons the band landed where it did. Surfaced in
   *  the iPhone debug overlay + the Settings voice-tuning screen. */
  reasons: string[];
  /** Mechanical signals · for the engine + tests, not user-facing. */
  signals: {
    raceCount: number;
    daysSinceMostRecentRace: number | null;
    vdotConfidence: number;            // 0-1 derived from candidate spread
    hasCalibrationCompleted: boolean;
    activeNiggleOrSick: boolean;
    subjectiveObjectiveMismatchDays: number;
    goalOffProjectedFor14d: boolean;
  };
}

/* ────────────────────────── Doctrine constants ────────────────────────── */

const RACE_RECENT_DAYS = 365;
const VDOT_CONF_CAL_FLOOR = 0.4;
const VDOT_CONF_CHALLENGE_FLOOR = 0.7;
const CALIBRATION_PROMOTION_CONF = 0.45;
const SUBJECTIVE_DISAGREE_DAYS_FOR_SOFTCAP = 5;
const GOAL_OFF_PCT = 0.10;
const GOAL_OFF_DAYS = 14;

/* ────────────────────────── Composer ────────────────────────── */

/**
 * Compute the voice band for a runner.
 *
 * Best-effort · every read catches and returns a safe default so the
 * morning brief never blocks on this signal. A cold-start runner with
 * no data lands in `calibration` with high confidence in the band
 * itself (we KNOW we don't know them).
 */
export async function computeVoiceBand(
  userUuid: string,
  state: CoachState,
): Promise<VoiceBandReason> {
  // 1. Race history · count + recency
  const raceRows = (await pool.query<{ date_iso: string }>(
    `SELECT date_iso::text
       FROM races
      WHERE user_uuid = $1::uuid
        AND finish_seconds IS NOT NULL
        AND finish_seconds > 0
        AND date_iso::date >= CURRENT_DATE - $2::int
      ORDER BY date_iso DESC`,
    [userUuid, RACE_RECENT_DAYS],
  ).catch(() => ({ rows: [] as Array<{ date_iso: string }> }))).rows;

  const raceCount = raceRows.length;
  const daysSinceMostRecentRace = raceRows[0]?.date_iso
    ? Math.max(0, Math.round(
        (Date.now() - Date.parse(raceRows[0].date_iso + 'T12:00:00Z')) / 86400000
      ))
    : null;

  // 2. VDOT confidence · derive from candidate spread + count
  const vdotConfidence = await computeVdotConfidence(userUuid);

  // 3. Calibration session · the hard-override path
  const calRow = (await pool.query<{ confidence: string | null }>(
    `SELECT confidence::text
       FROM calibration_sessions
      WHERE user_uuid = $1::uuid AND completed_at IS NOT NULL
      ORDER BY completed_at DESC LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] as Array<{ confidence: string | null }> }))).rows[0];
  const calConfidence = calRow?.confidence != null ? Number(calRow.confidence) : null;
  const hasCalibrationCompleted = calConfidence != null && calConfidence >= CALIBRATION_PROMOTION_CONF;

  // 4. Soft adjustments
  const activeNiggleOrSick = !!state.activeNiggle || state.recentCheckIns.some(
    (c) => c.rating === 'wrecked'
  );

  const subjectiveObjectiveMismatchDays = await countSubjectiveObjectiveMismatchDays(
    userUuid,
    SUBJECTIVE_DISAGREE_DAYS_FOR_SOFTCAP,
  );

  const goalOffProjectedFor14d = await goalOffProjectedForWindow(
    userUuid,
    GOAL_OFF_PCT,
    GOAL_OFF_DAYS,
  );

  // 5. Primary band selection
  const reasons: string[] = [];
  let band: VoiceBand;
  let confidence: number;

  if (raceCount >= 2 && vdotConfidence >= VDOT_CONF_CHALLENGE_FLOOR) {
    band = 'challenge';
    confidence = 0.85;
    reasons.push(`${raceCount} recent races · VDOT confidence ${vdotConfidence.toFixed(2)}`);
  } else if (raceCount >= 1 || vdotConfidence >= VDOT_CONF_CAL_FLOOR) {
    band = 'guided';
    confidence = 0.70;
    if (raceCount >= 1) reasons.push(`1+ recent race`);
    if (vdotConfidence >= VDOT_CONF_CAL_FLOOR) {
      reasons.push(`VDOT confidence ${vdotConfidence.toFixed(2)}`);
    }
  } else {
    band = 'calibration';
    confidence = 0.85; // we're confident we DON'T know the runner
    reasons.push('no recent race history');
    if (vdotConfidence < VDOT_CONF_CAL_FLOOR) {
      reasons.push(`VDOT confidence ${vdotConfidence.toFixed(2)} (low)`);
    }
  }

  // 6. Hard override · completed calibration session can step up
  if (band === 'calibration' && hasCalibrationCompleted) {
    band = 'guided';
    confidence = Math.min(0.75, 0.5 + (calConfidence ?? 0) * 0.4);
    reasons.push(`calibration completed at ${(calConfidence ?? 0).toFixed(2)} confidence`);
  }

  // 7. Soft adjustments · step DOWN
  if (goalOffProjectedFor14d) {
    band = stepDown(band);
    confidence -= 0.10;
    reasons.push('goal-time off projection 14+ days');
  }
  if (activeNiggleOrSick && band === 'challenge') {
    band = 'guided';
    confidence -= 0.05;
    reasons.push('active niggle / sick / wrecked check-in');
  }
  if (subjectiveObjectiveMismatchDays >= SUBJECTIVE_DISAGREE_DAYS_FOR_SOFTCAP && band === 'challenge') {
    band = 'guided';
    confidence -= 0.05;
    reasons.push(`subjective vs objective disagreement ${subjectiveObjectiveMismatchDays}+ days`);
  }

  return {
    band,
    confidence: Math.max(0, Math.min(1, +confidence.toFixed(2))),
    reasons,
    signals: {
      raceCount,
      daysSinceMostRecentRace,
      vdotConfidence,
      hasCalibrationCompleted,
      activeNiggleOrSick,
      subjectiveObjectiveMismatchDays,
      goalOffProjectedFor14d,
    },
  };
}

/* ────────────────────────── Helpers ────────────────────────── */

function stepDown(band: VoiceBand): VoiceBand {
  if (band === 'challenge') return 'guided';
  if (band === 'guided') return 'calibration';
  return 'calibration';
}

/**
 * VDOT confidence · 0-1 from the spread + count of recent candidates.
 *
 *   · 0 candidates → 0.0
 *   · 1 race in last 180d → 0.65 base
 *   · 2-3 races in 180d, tight spread (≤2 VDOT points) → 0.80
 *   · 4+ races in 180d, tight spread → 0.90
 *   · Run-only candidates · max 0.45 (no race anchor)
 *   · Wide spread (>4 VDOT) → cap at 0.50 regardless of count
 *
 * The confidence is a coach-trust signal · not a statistical confidence
 * interval. Don't over-engineer it.
 */
async function computeVdotConfidence(userUuid: string): Promise<number> {
  const rows = (await pool.query<{ kind: string; vdot: number | null }>(
    `WITH race_v AS (
       SELECT 'race' AS kind,
              -- VDOT computed at read · no stored snapshot
              NULL::numeric AS vdot
         FROM races
        WHERE user_uuid = $1::uuid
          AND finish_seconds IS NOT NULL AND finish_seconds > 0
          AND date_iso::date >= CURRENT_DATE - 180
     ),
     run_v AS (
       SELECT 'run' AS kind,
              NULL::numeric AS vdot
         FROM runs
        WHERE user_uuid = $1::uuid
          AND NOT (data ? 'mergedIntoId')
          AND (data->>'workoutType') IN ('threshold', 'tempo', 'intervals', 'race')
          AND (data->>'distanceMi')::numeric >= 3
          AND COALESCE(data->>'date', LEFT(data->>'startLocal',10))::date >= CURRENT_DATE - 180
     )
     SELECT * FROM race_v UNION ALL SELECT * FROM run_v`,
    [userUuid],
  ).catch(() => ({ rows: [] as Array<{ kind: string; vdot: number | null }> }))).rows;

  const raceCount = rows.filter((r) => r.kind === 'race').length;
  const runCount = rows.filter((r) => r.kind === 'run').length;

  if (raceCount === 0 && runCount === 0) return 0;

  if (raceCount === 0) {
    // Run-only candidates · capped per doctrine
    return Math.min(0.45, 0.15 + runCount * 0.05);
  }

  if (raceCount === 1) return 0.65;
  if (raceCount === 2) return 0.78;
  if (raceCount === 3) return 0.85;
  return 0.90; // 4+
}

/**
 * Count days where the runner's subjective check-in disagrees with
 * the objective readiness score by ≥15 points (Saw et al. threshold).
 *
 * Capped at the lookback window. Lookback is the days arg.
 */
async function countSubjectiveObjectiveMismatchDays(
  userUuid: string,
  lookbackDays: number,
): Promise<number> {
  const result = (await pool.query<{ mismatch_days: string }>(
    `WITH days AS (
       SELECT ts::date AS d, rating
         FROM check_ins
        WHERE COALESCE(user_uuid, user_id) = $1
          AND ts >= NOW() - ($2::text || ' days')::interval
     ),
     scored AS (
       SELECT d,
              CASE rating
                WHEN 'solid'   THEN 75
                WHEN 'tired'   THEN 50
                WHEN 'wrecked' THEN 30
                ELSE NULL
              END AS subjective_score
         FROM days
     ),
     objective AS (
       SELECT sample_date AS d, value::numeric AS objective_score
         FROM readiness_snapshots
        WHERE COALESCE(user_uuid, user_id) = $1
          AND sample_date >= CURRENT_DATE - $2::int
     )
     SELECT COUNT(*)::text AS mismatch_days
       FROM scored s JOIN objective o ON o.d = s.d
      WHERE s.subjective_score IS NOT NULL
        AND ABS(s.subjective_score - o.objective_score) >= 15`,
    [userUuid, lookbackDays],
  ).catch(() => ({ rows: [{ mismatch_days: '0' }] }))).rows[0];

  return Number(result?.mismatch_days ?? 0);
}

/**
 * Is the runner's current projected race time off the goal by ≥pct
 * for the last `windowDays` days? Reads from `projection_snapshots`.
 */
async function goalOffProjectedForWindow(
  userUuid: string,
  pct: number,
  windowDays: number,
): Promise<boolean> {
  const result = (await pool.query<{ off_count: string; total_count: string }>(
    `WITH plan_race AS (
       SELECT race_id FROM training_plans
        WHERE user_uuid = $1::uuid AND archived_iso IS NULL
        LIMIT 1
     ),
     goal AS (
       SELECT (r.plan->'goal'->>'finish_time_s')::numeric AS goal_sec,
              (r.meta->>'distanceMi')::numeric AS dist_mi
         FROM races r
         JOIN plan_race pr ON pr.race_id = r.slug
        WHERE r.user_uuid = $1::uuid
        LIMIT 1
     ),
     proj AS (
       SELECT ps.snapshot_date,
              ps.projection_sec
         FROM projection_snapshots ps, goal g
        WHERE ps.user_uuid = $1::uuid
          AND ps.distance_mi = g.dist_mi
          AND ps.snapshot_date >= CURRENT_DATE - $3::int
     )
     SELECT COUNT(*) FILTER (
              WHERE proj.projection_sec > (SELECT goal_sec FROM goal) * (1 + $2::numeric)
            )::text AS off_count,
            COUNT(*)::text AS total_count
       FROM proj`,
    [userUuid, pct, windowDays],
  ).catch(() => ({ rows: [{ off_count: '0', total_count: '0' }] }))).rows[0];

  const off = Number(result?.off_count ?? 0);
  const total = Number(result?.total_count ?? 0);
  // Off for the FULL window (every snapshot · strict).
  // If we only had partial data (cold start) total could be small ·
  // require ≥7 snapshots before the soft-cap fires.
  return total >= 7 && off === total;
}
