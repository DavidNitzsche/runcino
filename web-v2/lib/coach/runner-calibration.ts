/**
 * lib/coach/runner-calibration.ts · per-user learned state vector
 * (Phase 2.2).
 *
 * The plan engine reads this instead of coarse experience_level buckets.
 * Updated weekly by lib/coach/cron/calibration-refresh.ts (Sunday night
 * after the long run).
 *
 * Cold-start runners (less than 14d history) get experience_level-derived
 * defaults. Once a runner has 14d of training data AND 2+ completed
 * quality workouts, data_quality flips to 'calibrated' and the engine
 * trusts the learned curves over the bucket defaults.
 *
 * Schema lives in db/migrations/136_runner_calibration.sql.
 *
 * Cite: docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 2.2
 */

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { getCanonicalRunIds, isoDaysBefore } from '@/lib/runs/volume';
import type { RunnerCalibrationLike } from '@/lib/plan/simulator';

export type DataQuality = 'cold-start' | 'building' | 'calibrated';
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'advanced_plus';

export interface RunnerCalibration extends RunnerCalibrationLike {
  userUuid: string;
  asOf: string;
  easyToleranceMi: number | null;
  longToleranceMi: number | null;
  qualityToleranceMi: number | null;
  acwrSlope: number | null;
  rhrSensitivity: number | null;
  volumeCeilingMi: number | null;
  dataQuality: DataQuality;
  sourceWorkoutCount: number;
  sourceQualityCount: number;
  citation: string;
}

/**
 * Cold-start defaults by experience level. Used when no calibration
 * row exists OR when data_quality='cold-start'.
 *
 * Calibrated against the Daniels Running Formula response curves.
 */
const EXPERIENCE_DEFAULTS: Record<ExperienceLevel, RunnerCalibrationLike> = {
  beginner: {
    vdotPerQuality: 0.15,     // big early gains
    longRunWeight: 0.2,
    recoveryMult: 0.85,        // slower recovery · less aerobic base
    plateauVdot: 50,
  },
  intermediate: {
    vdotPerQuality: 0.10,
    longRunWeight: 0.3,
    recoveryMult: 1.0,
    plateauVdot: 65,
  },
  advanced: {
    vdotPerQuality: 0.08,      // diminishing returns
    longRunWeight: 0.35,
    recoveryMult: 1.1,
    plateauVdot: 75,
  },
  advanced_plus: {
    vdotPerQuality: 0.05,      // very close to plateau
    longRunWeight: 0.4,
    recoveryMult: 1.15,
    plateauVdot: 82,
  },
};

/**
 * Race-distance scaling for long_run_weight when calibration is
 * cold-start. Marathon training values long-run progression more
 * than 5K training.
 */
export function longRunWeightForDistance(raceDistanceMi: number): number {
  if (raceDistanceMi <= 3.5) return 0.10;
  if (raceDistanceMi <= 7)   return 0.20;
  if (raceDistanceMi <= 14)  return 0.30;
  return 0.60;  // marathon+
}

/**
 * Load the latest calibration row for a runner. Returns cold-start
 * defaults derived from experience_level when no row exists.
 */
export async function loadRunnerCalibration(
  userUuid: string,
  raceDistanceMi?: number,
): Promise<RunnerCalibration> {
  const row = (await pool.query<{
    as_of: Date; vdot_per_quality: string; long_run_weight: string;
    recovery_mult: string; plateau_vdot: string;
    easy_tolerance_mi: string | null; long_tolerance_mi: string | null;
    quality_tolerance_mi: string | null;
    acwr_slope: string | null; rhr_sensitivity: string | null;
    volume_ceiling_mi: string | null;
    data_quality: DataQuality;
    source_workout_count: number; source_quality_count: number;
    citation: string;
  }>(
    `SELECT as_of, vdot_per_quality::text, long_run_weight::text,
            recovery_mult::text, plateau_vdot::text,
            easy_tolerance_mi::text, long_tolerance_mi::text,
            quality_tolerance_mi::text,
            acwr_slope::text, rhr_sensitivity::text,
            volume_ceiling_mi::text,
            data_quality, source_workout_count, source_quality_count,
            citation
       FROM runner_calibration
      WHERE user_uuid = $1::uuid
      ORDER BY as_of DESC LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0];

  if (row) {
    return {
      userUuid,
      asOf: row.as_of.toISOString().slice(0, 10),
      vdotPerQuality: Number(row.vdot_per_quality),
      longRunWeight: Number(row.long_run_weight),
      recoveryMult: Number(row.recovery_mult),
      plateauVdot: Number(row.plateau_vdot),
      easyToleranceMi: row.easy_tolerance_mi ? Number(row.easy_tolerance_mi) : null,
      longToleranceMi: row.long_tolerance_mi ? Number(row.long_tolerance_mi) : null,
      qualityToleranceMi: row.quality_tolerance_mi ? Number(row.quality_tolerance_mi) : null,
      acwrSlope: row.acwr_slope ? Number(row.acwr_slope) : null,
      rhrSensitivity: row.rhr_sensitivity ? Number(row.rhr_sensitivity) : null,
      volumeCeilingMi: row.volume_ceiling_mi ? Number(row.volume_ceiling_mi) : null,
      dataQuality: row.data_quality,
      sourceWorkoutCount: row.source_workout_count,
      sourceQualityCount: row.source_quality_count,
      citation: row.citation,
    };
  }

  // Cold start · derive from experience_level
  const profile = (await pool.query<{ experience_level: ExperienceLevel | null }>(
    `SELECT experience_level FROM profile WHERE user_uuid = $1::uuid LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0];
  const level: ExperienceLevel = (profile?.experience_level ?? 'intermediate') as ExperienceLevel;
  const defaults = EXPERIENCE_DEFAULTS[level] ?? EXPERIENCE_DEFAULTS.intermediate;

  return {
    userUuid,
    // 2026-06-03 · runner TZ for the asOf stamp.
    asOf: await runnerToday(userUuid),
    ...defaults,
    longRunWeight: raceDistanceMi != null ? longRunWeightForDistance(raceDistanceMi) : defaults.longRunWeight,
    easyToleranceMi: null,
    longToleranceMi: null,
    qualityToleranceMi: null,
    acwrSlope: null,
    rhrSensitivity: null,
    volumeCeilingMi: null,
    dataQuality: 'cold-start',
    sourceWorkoutCount: 0,
    sourceQualityCount: 0,
    citation: 'docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 2.2 (cold-start defaults from experience_level)',
  };
}

/**
 * Refresh calibration for a runner · computes the new state vector
 * from the last 14 days of training data and persists it.
 *
 * Called by the weekly cron (Sunday night after long-run completion)
 * AND on demand when a major event happens (race completion, PR,
 * goal change).
 *
 * Algorithm:
 *   1. Read last 14d of completed workouts
 *   2. Read last 14d of projection snapshots
 *   3. For each completed quality workout, compute the implied
 *      vdot_per_quality gain (delta projection / count)
 *   4. Compute easy/long/quality tolerance as the median actual mi
 *   5. Compute recovery_mult from RHR drift + sleep streaks
 *   6. Compute volume_ceiling from the highest tolerated week
 *   7. UPSERT into runner_calibration
 */
export async function refreshRunnerCalibration(userUuid: string): Promise<RunnerCalibration> {
  // 2026-06-03 · runner TZ.
  const today = await runnerToday(userUuid);

  // Count completed workouts in the last 14d
  const counts = (await pool.query<{ n: string; q: string }>(
    `SELECT
       COUNT(*)::text AS n,
       SUM(CASE WHEN pw.is_quality THEN 1 ELSE 0 END)::text AS q
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
       JOIN runs r ON r.user_uuid = $1::uuid
            AND (r.data->>'date')::date = pw.date_iso
            AND r.id = ANY($3::bigint[])
      WHERE tp.user_uuid = $1::uuid
        AND tp.archived_iso IS NULL
        AND pw.date_iso >= $2::date - 14
        AND pw.date_iso <  $2::date`,
    // Phase B · one canonical dedup. A dupe would inflate workoutCount/quality
    // and trip the calibrated/building data-quality gate early.
    [userUuid, today, await getCanonicalRunIds(userUuid, isoDaysBefore(today, 14), today)],
  ).catch(() => ({ rows: [{ n: '0', q: '0' }] }))).rows[0];
  const workoutCount = Number(counts?.n ?? 0);
  const qualityCount = Number(counts?.q ?? 0);

  // Data-quality bucket · governs whether we trust learned vs default
  const dataQuality: DataQuality =
      workoutCount >= 8 && qualityCount >= 2 ? 'calibrated'
    : workoutCount >= 3                       ? 'building'
    :                                           'cold-start';

  // Compute the medians + recovery + ceiling
  const easyMed = await medianDailyMi(userUuid, 3, 9, 14);
  const longMed = await medianDailyMi(userUuid, 10, 30, 14);
  const qualityMed = await medianDailyMi(userUuid, 4, 12, 14);
  const volumeCeiling = await peakWeekMi(userUuid, 28);

  // For now · keep VDOT response curves from the experience-level
  // defaults until we have enough data to actually learn them.
  // Full learning algorithm lands in a follow-up commit per the
  // architecture doc's "Phase 2.2 learning loop" subsection.
  const profile = (await pool.query<{ experience_level: ExperienceLevel | null }>(
    `SELECT experience_level FROM profile WHERE user_uuid = $1::uuid LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0];
  const level: ExperienceLevel = (profile?.experience_level ?? 'intermediate') as ExperienceLevel;
  const defaults = EXPERIENCE_DEFAULTS[level];

  // UPSERT
  await pool.query(
    `INSERT INTO runner_calibration
       (user_uuid, as_of, vdot_per_quality, long_run_weight, recovery_mult,
        plateau_vdot, easy_tolerance_mi, long_tolerance_mi, quality_tolerance_mi,
        volume_ceiling_mi, data_quality, source_workout_count, source_quality_count)
     VALUES ($1::uuid, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (user_uuid, as_of) DO UPDATE SET
       vdot_per_quality = EXCLUDED.vdot_per_quality,
       long_run_weight = EXCLUDED.long_run_weight,
       recovery_mult = EXCLUDED.recovery_mult,
       plateau_vdot = EXCLUDED.plateau_vdot,
       easy_tolerance_mi = EXCLUDED.easy_tolerance_mi,
       long_tolerance_mi = EXCLUDED.long_tolerance_mi,
       quality_tolerance_mi = EXCLUDED.quality_tolerance_mi,
       volume_ceiling_mi = EXCLUDED.volume_ceiling_mi,
       data_quality = EXCLUDED.data_quality,
       source_workout_count = EXCLUDED.source_workout_count,
       source_quality_count = EXCLUDED.source_quality_count`,
    [
      userUuid, today,
      defaults.vdotPerQuality, defaults.longRunWeight, defaults.recoveryMult, defaults.plateauVdot,
      easyMed, longMed, qualityMed, volumeCeiling,
      dataQuality, workoutCount, qualityCount,
    ],
  );

  return loadRunnerCalibration(userUuid);
}

async function medianDailyMi(
  userUuid: string,
  minMi: number,
  maxMi: number,
  daysBack: number,
): Promise<number | null> {
  // Phase B · one canonical dedup. A dupe would add a second identical distance
  // into the percentile. +1d slack ⊇ the NOW()-based SQL window.
  const mToday = await runnerToday(userUuid);
  const canonicalIds = await getCanonicalRunIds(userUuid, isoDaysBefore(mToday, daysBack + 1), mToday);
  const r = (await pool.query<{ med: string | null }>(
    `WITH runs_in_range AS (
       SELECT (data->>'distanceMi')::numeric AS mi
         FROM runs
        WHERE user_uuid = $1::uuid
          AND id = ANY($5::bigint[])
          AND (data->>'distanceMi')::numeric BETWEEN $2 AND $3
          AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10))::text
              >= (NOW() - ($4 || ' days')::interval)::date::text
     )
     SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY mi)::text AS med
       FROM runs_in_range`,
    [userUuid, minMi, maxMi, daysBack, canonicalIds],
  ).catch(() => ({ rows: [{ med: null }] }))).rows[0];
  const m = Number(r?.med);
  return Number.isFinite(m) && m > 0 ? Math.round(m * 2) / 2 : null;
}

async function peakWeekMi(userUuid: string, daysBack: number): Promise<number | null> {
  // 2026-06-03 · runner TZ anchors the lookback.
  const today = await runnerToday(userUuid);
  const r = (await pool.query<{ peak: string | null }>(
    // 2026-06-01 - MAX-per-day dedupe before weekly SUM. See
    // lib/plan/generate.ts for context.
    `WITH per_day AS (
       SELECT (data->>'date')::date AS d,
              MAX((data->>'distanceMi')::numeric) AS mi
         FROM runs
        WHERE user_uuid = $1::uuid
          AND NOT (data ? 'mergedIntoId')
          AND (data->>'date')::date >= $3::date - $2
        GROUP BY 1
     ), weekly AS (
       SELECT DATE_TRUNC('week', d) AS wk, SUM(mi) AS mi
         FROM per_day GROUP BY wk
     )
     SELECT MAX(mi)::text AS peak FROM weekly`,
    [userUuid, daysBack, today],
  ).catch(() => ({ rows: [{ peak: null }] }))).rows[0];
  const m = Number(r?.peak);
  return Number.isFinite(m) && m > 0 ? Math.round(m * 2) / 2 : null;
}
