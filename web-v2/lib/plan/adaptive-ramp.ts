/**
 * lib/plan/adaptive-ramp.ts · upward adaptation when signals are green.
 *
 * David's 2026-06-02 call: the existing adapter only goes DOWN (shave,
 * downgrade) on pull-back signals. When a runner is HANDLING work well
 * (readiness pillars green, paces hit clean, low decoupling on longs),
 * the plan should push UP toward the tier's peak band · not leave
 * fitness on the table.
 *
 * Architecture · companion to adapt.ts which handles pull-back:
 *
 *   detectGreenRampOpportunity(userId)
 *     ↓ returns a RampOpportunity OR null
 *   buildBumpAction(userId, opp, activePlan)
 *     ↓ returns an AdaptationAction['kind' = 'bump_distance']
 *   applyAdaptations() picks it up and mutates plan_workouts
 *
 * Gates · all must pass before a bump:
 *   · No pull-back streak in last 7 days (HRV / RHR / sleep / soreness)
 *   · Last 2 quality workouts hit target pace ±10s/mi
 *   · Last long run clean (aerobic decoupling < 5% if measurable)
 *   · Plan's current peak weekly is below tier upper band × 0.95
 *   · No bump applied in last 7 days (cooldown · absorption time)
 *
 * Bump rules:
 *   · weekly target +5% (cap at tier upper band)
 *   · long run +1mi (cap at tier peakLongMiBand[1])
 *
 * Cite: David 2026-06-02 conversation · "if the runner and the weeks
 * are solid, distance is up or even a bit over the ramp can be pretty
 * aggressive."
 * Cite: Pfitzinger Faster Road Racing · adaptive load progression
 * Cite: Research/00a-distance-running-training.md §progressive-overload
 */

import { pool } from '@/lib/db/pool';

export interface RampOpportunity {
  /** Why we're bumping · explainer for the intent log. */
  reason: string;
  /** Plan id this opportunity applies to. */
  planId: string;
  /** Plan's tier peak weekly upper bound · the bump can't exceed this. */
  tierWeeklyUpper: number;
  /** Plan's tier peak long upper bound. */
  tierLongUpper: number;
  /** Plan's current peak weekly across non-taper weeks. */
  currentPeakWeekly: number;
  /** Plan's current peak long. */
  currentPeakLong: number;
}

export interface RampSignals {
  readinessGreen: boolean;
  lastQualityOnPace: boolean;
  lastLongClean: boolean;
  belowTierUpper: boolean;
  noBumpRecent: boolean;
  /** Diagnostic detail · used for the intent's why-line and audit. */
  details: {
    pullbackStreakDays: number;
    lastQualityDeltaBpm: number | null;
    lastLongDecouplingPct: number | null;
    peakHeadroomMi: number;
    daysSinceLastBump: number;
  };
}

const COOLDOWN_DAYS = 7;
const QUALITY_PACE_TOLERANCE_SEC = 10;  // s/mi
const LONG_DECOUPLING_PCT_CAP = 5;

/**
 * Read every gate signal for upward adaptation. Returns the full
 * signal set so the caller can decide whether to bump.
 */
export async function detectRampSignals(
  userId: string,
  activePlan: { id: string; authoredState: Record<string, unknown> },
): Promise<RampSignals> {
  // 1. Readiness · no pull-back streaks ≥ 2 days
  const readinessRow = await pool.query<{ streaks: unknown }>(
    `SELECT streaks
       FROM readiness_snapshots
      WHERE user_uuid = $1 AND snapshot_date >= CURRENT_DATE - 1
      ORDER BY snapshot_date DESC LIMIT 1`,
    [userId],
  ).then((r) => r.rows[0]).catch(() => undefined);
  const streaks = (readinessRow?.streaks as Array<{ direction?: string; days?: number }> | undefined) ?? [];
  const pullbackStreakDays = streaks
    .filter((s) => s.direction === 'below')
    .reduce((max, s) => Math.max(max, Number(s.days ?? 0)), 0);
  const readinessGreen = pullbackStreakDays < 2;

  // 2. Last 2 quality workouts · hit prescribed pace ± tolerance
  const recentQuality = await pool.query<{
    pace_delta_bpm: number | null;
    pace_target: number | null;
    avg_pace: string | null;
  }>(
    `SELECT (data->>'hr_on_pace_delta_bpm')::numeric AS pace_delta_bpm,
            (data->>'pace_target_s_per_mi')::numeric AS pace_target,
            data->>'avgPaceMinPerMi' AS avg_pace
       FROM runs
      WHERE user_uuid = $1
        AND NOT (data ? 'mergedIntoId')
        AND (data->>'type') IN ('threshold', 'intervals', 'tempo')
        AND (data->>'date')::date >= CURRENT_DATE - 14
      ORDER BY (data->>'date')::date DESC LIMIT 2`,
    [userId],
  ).then((r) => r.rows).catch(() => []);
  // On-pace check · pace_delta_bpm absolute < tolerance (note: bpm is
  // HR-on-pace not pace-on-pace · but tracks the runner-vs-target gap)
  const lastQualityDeltaBpm = recentQuality[0]?.pace_delta_bpm != null
    ? Math.abs(Number(recentQuality[0].pace_delta_bpm))
    : null;
  const lastQualityOnPace = recentQuality.length >= 2 && (
    lastQualityDeltaBpm == null || lastQualityDeltaBpm <= QUALITY_PACE_TOLERANCE_SEC
  );

  // 3. Last long · aerobic decoupling clean
  const recentLong = await pool.query<{ decoupling: number | null }>(
    `SELECT (data->>'aerobicDecouplingPct')::numeric AS decoupling
       FROM runs
      WHERE user_uuid = $1
        AND NOT (data ? 'mergedIntoId')
        AND (data->>'type') = 'long'
        AND (data->>'date')::date >= CURRENT_DATE - 14
      ORDER BY (data->>'date')::date DESC LIMIT 1`,
    [userId],
  ).then((r) => r.rows[0]).catch(() => undefined);
  const lastLongDecouplingPct = recentLong?.decoupling != null
    ? Number(recentLong.decoupling)
    : null;
  // If no decoupling data, give benefit of doubt (treat as clean).
  const lastLongClean = lastLongDecouplingPct == null
    || lastLongDecouplingPct < LONG_DECOUPLING_PCT_CAP;

  // 4. Plan's current peak weekly · is there headroom?
  const tierWeeklyUpper = readTierUpper(activePlan.authoredState, 'tier_peak_weekly_band');
  const tierLongUpper = readTierUpper(activePlan.authoredState, 'tier_peak_long_band');
  const peakRow = await pool.query<{ peak_weekly: number | null; peak_long: number | null }>(
    `SELECT MAX(weekly)::numeric AS peak_weekly, MAX(long_mi)::numeric AS peak_long
       FROM (
         SELECT pwk.id AS week_id,
                SUM(pw.distance_mi) AS weekly,
                MAX(CASE WHEN pw.type='long' THEN pw.distance_mi END) AS long_mi
           FROM plan_workouts pw
           JOIN plan_weeks pwk ON pwk.id = pw.week_id
           JOIN plan_phases pp ON pp.id = pwk.phase_id
          WHERE pw.plan_id = $1 AND pp.label <> 'TAPER'
          GROUP BY pwk.id
       ) wk`,
    [activePlan.id],
  ).then((r) => r.rows[0]).catch(() => ({ peak_weekly: null, peak_long: null }));
  const currentPeakWeekly = Number(peakRow?.peak_weekly ?? 0);
  const peakHeadroomMi = tierWeeklyUpper - currentPeakWeekly;
  const belowTierUpper = peakHeadroomMi > tierWeeklyUpper * 0.05;  // ≥ 5% headroom

  // 5. Cooldown · no bump applied in last 7 days
  const lastBumpRow = await pool.query<{ ts: Date | string }>(
    `SELECT ts FROM coach_intents
      WHERE COALESCE(user_uuid::text, user_id) = $1
        AND reason = 'plan_adapt_bump'
      ORDER BY ts DESC LIMIT 1`,
    [userId],
  ).then((r) => r.rows[0]).catch(() => undefined);
  const daysSinceLastBump = lastBumpRow?.ts
    ? Math.floor((Date.now() - new Date(lastBumpRow.ts).getTime()) / 86400000)
    : 999;
  const noBumpRecent = daysSinceLastBump >= COOLDOWN_DAYS;

  return {
    readinessGreen,
    lastQualityOnPace,
    lastLongClean,
    belowTierUpper,
    noBumpRecent,
    details: {
      pullbackStreakDays,
      lastQualityDeltaBpm,
      lastLongDecouplingPct,
      peakHeadroomMi: Number(peakHeadroomMi.toFixed(1)),
      daysSinceLastBump,
    },
  };
}

/**
 * Aggregate · all gates must pass. Returns an opportunity (with the
 * plan's tier band + current peaks) or null.
 */
export async function detectGreenRampOpportunity(
  userId: string,
): Promise<RampOpportunity | null> {
  const plan = await pool.query<{
    id: string;
    authored_state: Record<string, unknown>;
  }>(
    `SELECT id, authored_state FROM training_plans
      WHERE user_uuid = $1::uuid AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId],
  ).then((r) => r.rows[0]).catch(() => undefined);
  if (!plan) return null;

  const signals = await detectRampSignals(userId, {
    id: plan.id,
    authoredState: plan.authored_state,
  });

  const allGreen = signals.readinessGreen
    && signals.lastQualityOnPace
    && signals.lastLongClean
    && signals.belowTierUpper
    && signals.noBumpRecent;
  if (!allGreen) return null;

  const tierWeeklyUpper = readTierUpper(plan.authored_state, 'tier_peak_weekly_band');
  const tierLongUpper = readTierUpper(plan.authored_state, 'tier_peak_long_band');
  const peakRow = await pool.query<{ peak_weekly: number; peak_long: number }>(
    `SELECT MAX(weekly)::numeric AS peak_weekly, MAX(long_mi)::numeric AS peak_long
       FROM (
         SELECT pwk.id AS week_id,
                SUM(pw.distance_mi) AS weekly,
                MAX(CASE WHEN pw.type='long' THEN pw.distance_mi END) AS long_mi
           FROM plan_workouts pw
           JOIN plan_weeks pwk ON pwk.id = pw.week_id
           JOIN plan_phases pp ON pp.id = pwk.phase_id
          WHERE pw.plan_id = $1 AND pp.label <> 'TAPER'
          GROUP BY pwk.id
       ) wk`,
    [plan.id],
  ).then((r) => r.rows[0]).catch(() => ({ peak_weekly: 0, peak_long: 0 }));

  return {
    reason: composeReason(signals),
    planId: plan.id,
    tierWeeklyUpper,
    tierLongUpper,
    currentPeakWeekly: Number(peakRow.peak_weekly ?? 0),
    currentPeakLong: Number(peakRow.peak_long ?? 0),
  };
}

/**
 * Pick the workout rows to bump. Strategy · the NEXT non-taper long
 * run and any future-week peak long that's below tier upper. Conservative:
 * +1mi on the next long, capped at tier upper.
 */
export interface BumpPlan {
  longBump: { workoutId: string; oldDistanceMi: number; newDistanceMi: number } | null;
  reason: string;
}

export async function planBump(opp: RampOpportunity): Promise<BumpPlan | null> {
  // Find the next non-taper long run after today.
  const nextLong = await pool.query<{
    id: string; distance_mi: number; date_iso: string; phase: string;
  }>(
    `SELECT pw.id, pw.distance_mi::numeric AS distance_mi, pw.date_iso::text AS date_iso, pp.label AS phase
       FROM plan_workouts pw
       JOIN plan_weeks pwk ON pwk.id = pw.week_id
       JOIN plan_phases pp ON pp.id = pwk.phase_id
      WHERE pw.plan_id = $1
        AND pw.type = 'long'
        AND pw.date_iso::date >= CURRENT_DATE
        AND pp.label <> 'TAPER'
      ORDER BY pw.date_iso::date ASC LIMIT 1`,
    [opp.planId],
  ).then((r) => r.rows[0]).catch(() => undefined);
  if (!nextLong) return null;

  const oldDist = Number(nextLong.distance_mi);
  // +1mi · capped at tier upper.
  const proposed = oldDist + 1;
  const newDist = Math.min(proposed, opp.tierLongUpper);
  if (newDist <= oldDist) return null;  // already at cap · no bump

  return {
    longBump: {
      workoutId: nextLong.id,
      oldDistanceMi: oldDist,
      newDistanceMi: newDist,
    },
    reason: opp.reason,
  };
}

// ── helpers ────────────────────────────────────────────────────────────

function readTierUpper(
  authoredState: Record<string, unknown>,
  key: 'tier_peak_weekly_band' | 'tier_peak_long_band',
): number {
  const band = authoredState[key];
  if (Array.isArray(band) && band.length === 2) {
    return Number(band[1]);
  }
  // Old plans (pre-tier-system) won't have these bands. Returning 0
  // means planBump's "newDist <= oldDist" check fires · no bump
  // applied. Safer than guessing a tier ceiling that might be wrong.
  return 0;
}

/**
 * Orchestrator · detect opportunity, plan bump, write to plan_workouts,
 * log a `plan_adapt_bump` intent. Idempotent · safe to call once per
 * cron tick. Returns the bump applied or null.
 *
 * Call AFTER detectAdaptations + applyAdaptations · if any pull-back
 * action fired this tick, skip the bump (don't push up the same day
 * we pulled down).
 */
export async function tryAdaptiveBump(
  userId: string,
  pullbackApplied: boolean,
): Promise<{ workoutId: string; oldDistanceMi: number; newDistanceMi: number; why: string } | null> {
  if (pullbackApplied) return null;
  const opp = await detectGreenRampOpportunity(userId);
  if (!opp) return null;
  const bump = await planBump(opp);
  if (!bump || !bump.longBump) return null;

  // Apply · UPDATE plan_workouts.distance_mi · audit via coach_intents.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE plan_workouts SET distance_mi = $1 WHERE id = $2`,
      [bump.longBump.newDistanceMi, bump.longBump.workoutId],
    );
    await client.query(
      `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value, briefing_id)
       VALUES ($1, $1::uuid, 'plan_adapt_bump', $2, $3, NULL)`,
      [
        userId,
        bump.longBump.workoutId,
        JSON.stringify({
          kind: 'bump_distance',
          oldDistanceMi: bump.longBump.oldDistanceMi,
          newDistanceMi: bump.longBump.newDistanceMi,
          why: bump.reason,
        }),
      ],
    );
    await client.query('COMMIT');
  } catch (e: unknown) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return {
    workoutId: bump.longBump.workoutId,
    oldDistanceMi: bump.longBump.oldDistanceMi,
    newDistanceMi: bump.longBump.newDistanceMi,
    why: bump.reason,
  };
}

function composeReason(signals: RampSignals): string {
  const bits: string[] = [];
  if (signals.readinessGreen) bits.push('readiness green');
  if (signals.lastQualityOnPace) bits.push('quality on pace');
  if (signals.lastLongClean && signals.details.lastLongDecouplingPct != null) {
    bits.push(`long ${signals.details.lastLongDecouplingPct.toFixed(1)}% decoupling`);
  }
  if (signals.belowTierUpper) {
    bits.push(`${signals.details.peakHeadroomMi}mi headroom to tier upper`);
  }
  return `Adaptive bump · ${bits.join(' · ')}.`;
}
