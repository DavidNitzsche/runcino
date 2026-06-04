/**
 * lib/plan/drift-monitor.ts · detect when a training plan has drifted
 * from the runner's reality.
 *
 * Why this exists: plans get authored once with a snapshot of the
 * runner's volume + VDOT + race target. Over weeks of training those
 * inputs drift. The plan keeps prescribing against stale anchors.
 *
 * The runner CANNOT be expected to manually click "Regenerate plan"
 * when this happens · this build has no coach chat to ask. Drift
 * detection has to be autonomous.
 *
 * Two modes of action:
 *
 *   1. Soft drift (volume / VDOT / staleness) · write a pending
 *      proposal to plan_proposals. Today view surfaces an accept-or-
 *      dismiss card. The decision is the runner's because the
 *      tradeoffs are real ("do I want a harder plan?" "does this
 *      new VDOT reflect a real change?").
 *
 *   2. Hard drift (race date moved, goal time changed, A-race added/
 *      removed) · NOT handled here. Those fire from immediate-action
 *      hooks at the route level (POST /api/race + PATCH /api/race)
 *      and auto-apply without a proposal · the runner already made
 *      the underlying change, so the plan follows automatically.
 *
 * This file does the SOFT detection. Pure function · no side effects.
 * Writes happen in the cron route (lib/plan/drift-cron.ts).
 *
 * Doctrine:
 *   · Research/00a §plan-adaptation · plans need re-authoring when
 *     "training conditions diverge materially from authored state."
 *   · Research/00a § VDOT re-rating · ~2 VDOT drift = "materially."
 *   · Research/04 § volume progression · sustained baseline drift
 *     >40% means the runner is training a different fitness than
 *     the plan was built for.
 */

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { bestRecentVdot } from '@/lib/training/vdot';

export type DriftKind =
  | 'volume_drift'
  | 'vdot_drift'
  | 'staleness'
  // 2026-06-01 · Phase 1.1 · goal-gap engine.
  | 'goal_gap_widening'
  // 2026-06-01 · Phase 1.2 · per-day-type drift detection (replaces
  // volume_drift's blunt 40% threshold with targeted axes).
  | 'easy_drift'
  | 'long_drift'
  | 'quality_drift';

export interface DriftSignal {
  /** What triggered the signal. */
  kind: DriftKind;
  /** Severity 0-1 · 0=barely-tripped, 1=clearly-needs-rebuild. */
  severity: number;
  /** Plain-language explanation for the Today-view card. */
  message: string;
  /** Numeric details for the proposal row's reasons jsonb. */
  details: Record<string, unknown>;
}

export interface DriftReport {
  userUuid: string;
  planId: string;
  /** All triggered signals · empty means no drift. */
  signals: DriftSignal[];
  /** Highest-severity signal · drives the proposal card copy. */
  primary: DriftSignal | null;
}

// ─── Tuning constants · doctrine-derived ────────────────────────────────

/** Volume drift threshold · % delta vs authored 4-week avg.
 *  Research/04 §progression notes >40% sustained shift = different
 *  fitness · the plan's volume curve is no longer right.
 *
 *  2026-06-01 · Phase 1.2 · this stays at 40% as the BLUNT system-
 *  wide check · but per-axis drift below now catches the silent
 *  20-30% gaps that volume_drift misses. */
const VOLUME_DRIFT_PCT_THRESHOLD = 40;

/** Per-day-type drift thresholds · Phase 1.2.
 *  These catch the gap David called out ("my easy runs are 5-6 mi ·
 *  why does the plan say 4.5?"). 20% is the noise-floor where a
 *  deviation stops being "normal variation" and becomes "the plan
 *  doesn't match reality."
 *  Cite: docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 1.2 */
const PER_TYPE_DRIFT_PCT_THRESHOLD = 20;

/** VDOT drift threshold · drift > 2 = paces materially wrong.
 *  Daniels VDOT tables show each +1 VDOT shifts T/I paces ~5-7 s/mi ·
 *  +2 is a full pace tier. */
const VDOT_DRIFT_THRESHOLD = 2.0;

/** Staleness threshold · plans authored more than 8 weeks ago should
 *  re-evaluate. Most build cycles run 12-16 wks · 8 wks is the rough
 *  midpoint where fitness has moved enough to warrant a refit. */
const STALENESS_WEEKS_THRESHOLD = 8;

/** Window for "current" weekly avg. Mirrors what generatePlan uses
 *  internally (recentWeeklyMileage = last 28 days). */
const VOLUME_WINDOW_DAYS = 28;

// ─── Top-level entry ────────────────────────────────────────────────────

/**
 * Compute drift signals for one runner's active plan.
 * No side effects · returns the report. Caller (cron route) decides
 * what to do with it.
 *
 * Returns DriftReport with empty signals when there's nothing to act
 * on (no active plan, runner perfectly on-baseline, etc.).
 */
export async function detectDrift(userUuid: string): Promise<DriftReport | null> {
  const plan = await loadActivePlan(userUuid);
  if (!plan) return null;

  const signals: DriftSignal[] = [];

  // 1. Volume drift (system-wide blunt check)
  const vol = await checkVolumeDrift(userUuid, plan);
  if (vol) signals.push(vol);

  // 2. VDOT drift
  const vdot = await checkVdotDrift(userUuid, plan);
  if (vdot) signals.push(vdot);

  // 3. Staleness
  const stale = checkStaleness(plan);
  if (stale) signals.push(stale);

  // 4-6. Per-day-type drift (Phase 1.2 · catches what volume_drift
  // misses at sub-40% deviation). These trigger TARGETED rebuilds
  // rather than full plan refreshes.
  const easy = await checkEasyDrift(userUuid, plan);
  if (easy) signals.push(easy);
  const long = await checkLongDrift(userUuid, plan);
  if (long) signals.push(long);
  const quality = await checkQualityDrift(userUuid, plan);
  if (quality) signals.push(quality);

  const primary = signals.length > 0
    ? signals.slice().sort((a, b) => b.severity - a.severity)[0]
    : null;

  return {
    userUuid,
    planId: plan.id,
    signals,
    primary,
  };
}

// ─── per-signal detectors ───────────────────────────────────────────────

interface ActivePlan {
  id: string;
  race_id: string | null;
  authored_iso: string;
  authored_state: Record<string, unknown>;
}

async function loadActivePlan(userUuid: string): Promise<ActivePlan | null> {
  const r = (await pool.query<{
    id: string;
    race_id: string | null;
    authored_iso: Date;
    authored_state: Record<string, unknown>;
  }>(
    `SELECT id, race_id, authored_iso, authored_state
       FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r) return null;
  return {
    id: r.id,
    race_id: r.race_id,
    authored_iso: r.authored_iso instanceof Date ? r.authored_iso.toISOString() : String(r.authored_iso),
    authored_state: r.authored_state ?? {},
  };
}

/**
 * Volume drift · runner's current 28-day avg is >40% off the plan's
 * authored 4-week baseline.
 *
 * Triggers both directions:
 *   · Trained UP (actual > authored × 1.40) · plan's volume curve
 *     starts behind where the runner actually is. Time on plan is
 *     under-stimulus. (David's current situation.)
 *   · Trained DOWN (actual < authored × 0.60) · plan caps above
 *     what the runner can absorb. Injury risk + abandoned workouts.
 */
async function checkVolumeDrift(
  userUuid: string,
  plan: ActivePlan,
): Promise<DriftSignal | null> {
  const authoredAvg = Number((plan.authored_state as { weeklyAvg4w?: number }).weeklyAvg4w);
  if (!isFinite(authoredAvg) || authoredAvg <= 0) return null;

  const currentAvg = await loadCurrentWeeklyMileage(userUuid);
  if (currentAvg == null || currentAvg <= 0) return null;

  const pctDrift = ((currentAvg - authoredAvg) / authoredAvg) * 100;
  const absPctDrift = Math.abs(pctDrift);

  if (absPctDrift < VOLUME_DRIFT_PCT_THRESHOLD) return null;

  // Severity: scale from threshold (0) to 2× threshold (1.0)
  const severity = Math.min(1, (absPctDrift - VOLUME_DRIFT_PCT_THRESHOLD) /
                            VOLUME_DRIFT_PCT_THRESHOLD);

  const direction = pctDrift > 0 ? 'UP' : 'DOWN';
  const message = direction === 'UP'
    ? `Your recent 4-week average (${currentAvg.toFixed(1)} mi/wk) is ` +
      `${Math.round(pctDrift)}% higher than what this plan was built for ` +
      `(${authoredAvg.toFixed(1)} mi/wk). The plan's volume curve starts ` +
      `behind where you actually are · refit to use the work you've been ` +
      `doing.`
    : `Your recent 4-week average (${currentAvg.toFixed(1)} mi/wk) is ` +
      `${Math.abs(Math.round(pctDrift))}% LOWER than this plan was built ` +
      `for (${authoredAvg.toFixed(1)} mi/wk). The plan's targets may be ` +
      `out of reach right now · refit to a sustainable baseline.`;

  return {
    kind: 'volume_drift',
    severity,
    message,
    details: {
      authored_avg: Number(authoredAvg.toFixed(1)),
      current_avg: Number(currentAvg.toFixed(1)),
      pct_drift: Number(pctDrift.toFixed(1)),
      direction,
      threshold_pct: VOLUME_DRIFT_PCT_THRESHOLD,
    },
  };
}

/**
 * VDOT drift · runner's current VDOT (computed off recent races + quality
 * runs) is >2 off the VDOT the plan's pace targets were calibrated to.
 *
 * The plan doesn't store its anchor VDOT explicitly · we infer from the
 * pace targets on quality workouts (T-pace and I-pace are pure VDOT
 * lookups). Then compare to the current bestRecentVdot.
 */
async function checkVdotDrift(
  userUuid: string,
  plan: ActivePlan,
): Promise<DriftSignal | null> {
  const anchor = await inferPlanAnchorVdot(plan.id);
  const current = await loadCurrentVdot(userUuid);
  if (anchor == null || current == null) return null;

  const drift = current - anchor;  // signed · positive = runner faster than plan anchor
  const absDrift = Math.abs(drift);

  if (absDrift < VDOT_DRIFT_THRESHOLD) return null;

  const severity = Math.min(1, (absDrift - VDOT_DRIFT_THRESHOLD) / VDOT_DRIFT_THRESHOLD);
  const direction = drift > 0 ? 'UP' : 'DOWN';

  const message = direction === 'UP'
    ? `Your current VDOT (${current.toFixed(1)}) is ${absDrift.toFixed(1)} ` +
      `points above the plan's anchor (~${anchor.toFixed(1)}). The plan's ` +
      `pace targets are softer than your real fitness · refit to push the ` +
      `quality work where it actually belongs.`
    : `Your current VDOT (${current.toFixed(1)}) is ${absDrift.toFixed(1)} ` +
      `points below the plan's anchor (~${anchor.toFixed(1)}). The plan's ` +
      `pace targets are too aggressive for where you are · refit so the ` +
      `quality work stays sustainable.`;

  return {
    kind: 'vdot_drift',
    severity,
    message,
    details: {
      anchor_vdot: Number(anchor.toFixed(1)),
      current_vdot: Number(current.toFixed(1)),
      drift: Number(drift.toFixed(1)),
      direction,
      threshold: VDOT_DRIFT_THRESHOLD,
    },
  };
}

/**
 * Staleness · plan authored more than 8 weeks ago without a re-author.
 * Doesn't say anything is WRONG · just that we should re-examine.
 */
function checkStaleness(plan: ActivePlan): DriftSignal | null {
  const authoredMs = Date.parse(plan.authored_iso);
  if (!Number.isFinite(authoredMs)) return null;
  const ageWeeks = (Date.now() - authoredMs) / (1000 * 86400 * 7);
  if (ageWeeks < STALENESS_WEEKS_THRESHOLD) return null;

  // Severity 0 at threshold · 1 at 2× threshold
  const severity = Math.min(1, (ageWeeks - STALENESS_WEEKS_THRESHOLD) / STALENESS_WEEKS_THRESHOLD);

  return {
    kind: 'staleness',
    severity,
    message:
      `This plan was authored ${ageWeeks.toFixed(0)} weeks ago. Fitness ` +
      `usually moves enough across that window to warrant a refit · check ` +
      `the current paces still match the work you're doing.`,
    details: {
      authored_iso: plan.authored_iso,
      age_weeks: Number(ageWeeks.toFixed(1)),
      threshold_weeks: STALENESS_WEEKS_THRESHOLD,
    },
  };
}

// ─── data helpers ───────────────────────────────────────────────────────

async function loadCurrentWeeklyMileage(userUuid: string): Promise<number | null> {
  // 2026-06-02 · delegated to lib/runs/volume.ts § recentMileageMi
  // which uses smart-dedup (date + 0.1-mi distance bucket). Old
  // MAX-per-day was undercounting David by ~3 mi/wk on weeks with
  // legitimate same-day doubles.
  const { recentMileageMi } = await import('@/lib/runs/volume');
  const total = await recentMileageMi(userUuid, VOLUME_WINDOW_DAYS);
  return total > 0 ? Math.round((total / 4) * 10) / 10 : null;
}

/**
 * Infer the plan's anchor VDOT from its threshold workouts. The plan
 * doesn't store its anchor VDOT directly, but pace_target_s_per_mi on
 * threshold workouts is a deterministic lookup off VDOT (Daniels'
 * T-pace tables). We reverse-lookup.
 *
 * Returns null when the plan has no pace targets (workout-library
 * pace-resolver bug · the generator currently produces null
 * pace_target_s_per_mi on freshly-generated plans · see
 * targets-gap-panel-backend-landed.md for the gap doc).
 */
async function inferPlanAnchorVdot(planId: string): Promise<number | null> {
  const rows = (await pool.query<{ pace: number }>(
    `SELECT pace_target_s_per_mi::int AS pace
       FROM plan_workouts
      WHERE plan_id = $1
        AND type = 'threshold'
        AND pace_target_s_per_mi IS NOT NULL
        AND pace_target_s_per_mi > 0
      LIMIT 4`,
    [planId],
  ).catch(() => ({ rows: [] }))).rows;
  if (rows.length === 0) return null;

  // Average T-pace across the plan's threshold workouts.
  const avgPace = rows.reduce((s, r) => s + r.pace, 0) / rows.length;

  // Inverse Daniels lookup: T-pace s/mi → VDOT (rough · we use the same
  // VDOT-85 cap doctrine).
  return inverseTPaceToVdot(avgPace);
}

/**
 * Daniels T-pace lookup table (s/mi · VDOT 30-65 covers 99% of runners).
 * Source: Daniels' Running Formula 4e, Table 2.2 · T-pace column.
 * Inverse-interpolates to estimate VDOT from observed T-pace.
 */
const T_PACE_TABLE: ReadonlyArray<{ vdot: number; tPaceSec: number }> = [
  { vdot: 30, tPaceSec: 660 },  // 11:00/mi
  { vdot: 35, tPaceSec: 570 },  // 9:30/mi
  { vdot: 40, tPaceSec: 503 },  // 8:23
  { vdot: 45, tPaceSec: 451 },  // 7:31
  { vdot: 50, tPaceSec: 408 },  // 6:48
  { vdot: 55, tPaceSec: 373 },  // 6:13
  { vdot: 60, tPaceSec: 343 },  // 5:43
  { vdot: 65, tPaceSec: 317 },  // 5:17
];

function inverseTPaceToVdot(tPaceSec: number): number | null {
  if (!isFinite(tPaceSec) || tPaceSec <= 0) return null;
  // Below fastest tier · clamp
  if (tPaceSec <= T_PACE_TABLE[T_PACE_TABLE.length - 1].tPaceSec) {
    return T_PACE_TABLE[T_PACE_TABLE.length - 1].vdot;
  }
  // Above slowest tier · clamp
  if (tPaceSec >= T_PACE_TABLE[0].tPaceSec) {
    return T_PACE_TABLE[0].vdot;
  }
  for (let i = 0; i < T_PACE_TABLE.length - 1; i++) {
    const hi = T_PACE_TABLE[i];      // slower vdot · slower pace
    const lo = T_PACE_TABLE[i + 1];  // faster vdot · faster pace
    if (tPaceSec >= lo.tPaceSec && tPaceSec <= hi.tPaceSec) {
      const t = (tPaceSec - hi.tPaceSec) / (lo.tPaceSec - hi.tPaceSec);
      return hi.vdot + (lo.vdot - hi.vdot) * t;
    }
  }
  return null;
}

async function loadCurrentVdot(userUuid: string): Promise<number | null> {
  // Pull recent A/B races (60d window) + recent quality runs (60d window),
  // hand off to bestRecentVdot. Same path the projection snapshot cron uses.
  const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);

  const raceRows = (await pool.query<{
    slug: string; meta: Record<string, unknown>; actual_result: Record<string, unknown> | null;
  }>(
    `SELECT slug, meta, actual_result FROM races
      WHERE user_uuid = $1
        AND (meta->>'date')::date >= ($2::date - interval '180 days')::date
        AND (meta->>'date')::date < $2::date
        AND meta->>'priority' IN ('A', 'B')`,
    [userUuid, today],
  ).catch(() => ({ rows: [] }))).rows;

  const raceCandidates = raceRows.map((r) => {
    const m = r.meta ?? {};
    const ar = r.actual_result ?? {};
    const distMi = m.distanceMi ? Number(m.distanceMi) : null;
    const finishSec = (ar as { finishS?: number }).finishS != null
      ? Number((ar as { finishS: number }).finishS)
      : null;
    return {
      slug: r.slug,
      name: (m.name as string) ?? r.slug,
      date: (m.date as string) ?? '',
      priority: ((m.priority as string) ?? null) as 'A' | 'B' | 'C' | null,
      distance_mi: distMi,
      finish_seconds: finishSec,
    };
  });

  const runRows = (await pool.query<{
    id: string; date: string; workout_type: string | null;
    distance_mi: string | null; finish_seconds: string | null; avg_hr: string | null;
  }>(
    `SELECT sa.id::text AS id,
            COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10)) AS date,
            sa.data->>'workoutType' AS workout_type,
            (sa.data->>'distanceMi')::numeric AS distance_mi,
            (sa.data->>'movingTimeS')::numeric AS finish_seconds,
            (sa.data->>'avgHr')::numeric AS avg_hr
       FROM runs sa
      WHERE sa.user_uuid = $1
        AND NOT (sa.data ? 'mergedIntoId')
        AND COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10))::date
            >= ($2::date - interval '60 days')::date
        AND (sa.data->>'distanceMi')::numeric >= 4
        AND (sa.data->>'movingTimeS')::numeric > 60`,
    [userUuid, today],
  ).catch(() => ({ rows: [] }))).rows;

  const runCandidates = runRows.map((r) => ({
    id: r.id,
    date: r.date,
    workout_type: r.workout_type,
    distance_mi: r.distance_mi != null ? Number(r.distance_mi) : null,
    finish_seconds: r.finish_seconds != null ? Number(r.finish_seconds) : null,
    avg_hr: r.avg_hr != null ? Number(r.avg_hr) : null,
    max_hr: null,
  }));

  const { best } = bestRecentVdot(raceCandidates, today, 180, runCandidates);
  return best?.vdot ?? null;
}

/**
 * Should we WRITE a fresh proposal of this kind for this plan?
 *
 * Returns true to skip:
 *   · a pending row already exists for the same kind, OR
 *   · a dismissed row was written in the last 14 days
 *     (respect the runner's "no, I don't want to do this" answer ·
 *     don't re-propose every night for 2 weeks)
 *
 * Returns false → cron can write a fresh proposal.
 */
// ─── per-day-type drift detectors (Phase 1.2) ──────────────────────────

/**
 * Easy-day drift · runner's actual 14-day easy-day median deviates
 * >20% from the plan's authored easy-day distance for the current week.
 *
 * Catches the silent gap (David's case): plan asks for 4.5 mi easy
 * days, runner is comfortably running 6+ mi. The volume_drift check
 * misses this because total weekly volume stays close to the budget.
 *
 * Trigger: targeted easy-day rebuild (floors `perEasy` at the median
 * in generate.ts · which we already shipped in commit 89fc6eec).
 *
 * Cite: docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 1.2
 */
async function checkEasyDrift(
  userUuid: string,
  plan: ActivePlan,
): Promise<DriftSignal | null> {
  // 2026-06-03 · runner TZ anchors the plan window.
  const today = await runnerToday(userUuid);
  // Runner's actual easy-day median (last 14d)
  const actualMed = await loadEasyDayMedian(userUuid);
  if (actualMed == null || actualMed <= 0) return null;

  // Plan's current-week easy-day median (authored)
  const planMed = await loadPlanEasyDayMedian(plan.id, today);
  if (planMed == null || planMed <= 0) return null;

  const pctDrift = ((actualMed - planMed) / planMed) * 100;
  const absPct = Math.abs(pctDrift);
  if (absPct < PER_TYPE_DRIFT_PCT_THRESHOLD) return null;

  const severity = Math.min(1, (absPct - PER_TYPE_DRIFT_PCT_THRESHOLD) /
                                PER_TYPE_DRIFT_PCT_THRESHOLD);
  const direction = pctDrift > 0 ? 'UP' : 'DOWN';
  const message = direction === 'UP'
    ? `Your easy days are running ${actualMed} mi (median, last 14d) but ` +
      `the plan is asking for ${planMed} mi · refloor easy-day distance ` +
      `to your real baseline.`
    : `Your easy days are running ${actualMed} mi but the plan is asking ` +
      `for ${planMed} mi · either reduce the easy-day target or check why ` +
      `you're cutting them short.`;

  return {
    kind: 'easy_drift',
    severity,
    message,
    details: {
      actual_median_mi: actualMed,
      authored_median_mi: planMed,
      pct_drift: Number(pctDrift.toFixed(1)),
      direction,
      threshold_pct: PER_TYPE_DRIFT_PCT_THRESHOLD,
      citation: 'docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 1.2',
    },
  };
}

/**
 * Long-run drift · runner's last 3 long runs deviate >20% from the
 * plan's authored long-run progression.
 */
async function checkLongDrift(
  userUuid: string,
  plan: ActivePlan,
): Promise<DriftSignal | null> {
  // 2026-06-03 · runner TZ anchors the plan window.
  const today = await runnerToday(userUuid);
  const actualLong = await loadRecentLongRunMedian(userUuid);
  if (actualLong == null || actualLong <= 0) return null;

  const planLong = await loadPlanLongRunMedian(plan.id, today);
  if (planLong == null || planLong <= 0) return null;

  const pctDrift = ((actualLong - planLong) / planLong) * 100;
  const absPct = Math.abs(pctDrift);
  if (absPct < PER_TYPE_DRIFT_PCT_THRESHOLD) return null;

  const severity = Math.min(1, (absPct - PER_TYPE_DRIFT_PCT_THRESHOLD) /
                                PER_TYPE_DRIFT_PCT_THRESHOLD);
  const direction = pctDrift > 0 ? 'UP' : 'DOWN';
  const message = direction === 'UP'
    ? `Your long runs are landing at ${actualLong} mi (median, last 3) ` +
      `but the plan is asking for ${planLong} mi · long-run progression ` +
      `is ahead of plan · adjust upward.`
    : `Your long runs are landing at ${actualLong} mi but the plan is ` +
      `asking for ${planLong} mi · long-run progression is behind plan · ` +
      `verify the long-day calendar.`;

  return {
    kind: 'long_drift',
    severity,
    message,
    details: {
      actual_median_mi: actualLong,
      authored_median_mi: planLong,
      pct_drift: Number(pctDrift.toFixed(1)),
      direction,
      threshold_pct: PER_TYPE_DRIFT_PCT_THRESHOLD,
      citation: 'docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 1.2',
    },
  };
}

/**
 * Quality drift · runner's actual quality-workout pace deviates >5%
 * from the plan's prescribed pace targets.
 *
 * Quality drift is more sensitive than easy/long because pace targets
 * are calibrated to current VDOT. >5% means the runner has either
 * leveled up (running faster than prescribed) or is fatigued (slower
 * than prescribed).
 */
async function checkQualityDrift(
  userUuid: string,
  plan: ActivePlan,
): Promise<DriftSignal | null> {
  const PACE_DRIFT_PCT = 5;
  const r = (await pool.query<{ actual_med: string | null; planned_med: string | null }>(
    `WITH recent_quality AS (
       SELECT pw.pace_target_s_per_mi AS planned,
              CASE
                WHEN (r.data->>'avgPaceMinPerMi') ~ '^[0-9]+:[0-9]+$'
                THEN EXTRACT(EPOCH FROM (r.data->>'avgPaceMinPerMi')::interval)
                ELSE NULL
              END AS actual
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
         LEFT JOIN runs r ON r.user_uuid = $1::uuid
              AND (r.data->>'date')::date = pw.date_iso
         WHERE tp.id = $2
           AND pw.is_quality = true
           AND pw.date_iso >= $3::date - INTERVAL '21 days'
           AND pw.date_iso <  $3::date
           AND pw.pace_target_s_per_mi IS NOT NULL
     )
     SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY actual)::text  AS actual_med,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY planned)::text AS planned_med
       FROM recent_quality
      WHERE actual IS NOT NULL`,
    [userUuid, plan.id, await runnerToday(userUuid)],
  ).catch(() => ({ rows: [{ actual_med: null, planned_med: null }] }))).rows[0];

  const actualMed = Number(r?.actual_med);
  const plannedMed = Number(r?.planned_med);
  if (!Number.isFinite(actualMed) || !Number.isFinite(plannedMed) || plannedMed <= 0) return null;

  const pctDrift = ((actualMed - plannedMed) / plannedMed) * 100;
  const absPct = Math.abs(pctDrift);
  if (absPct < PACE_DRIFT_PCT) return null;

  const severity = Math.min(1, (absPct - PACE_DRIFT_PCT) / PACE_DRIFT_PCT);
  // Note · negative pace_drift means runner is FASTER than prescribed
  const fasterThanPlan = pctDrift < 0;
  const message = fasterThanPlan
    ? `Your quality workouts are landing ${Math.abs(Math.round(pctDrift))}% ` +
      `FASTER than prescribed · pace targets are too soft · refit VDOT and ` +
      `tighten the threshold/interval paces.`
    : `Your quality workouts are landing ${Math.round(pctDrift)}% SLOWER ` +
      `than prescribed · pace targets may be too aggressive · check ` +
      `accumulated fatigue or refit to a lower VDOT.`;

  return {
    kind: 'quality_drift',
    severity,
    message,
    details: {
      actual_pace_s_per_mi: Math.round(actualMed),
      planned_pace_s_per_mi: Math.round(plannedMed),
      pct_drift: Number(pctDrift.toFixed(1)),
      direction: fasterThanPlan ? 'FASTER' : 'SLOWER',
      threshold_pct: PACE_DRIFT_PCT,
      citation: 'docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 1.2 + Daniels Running Formula §VDOT pace tables',
    },
  };
}

async function loadEasyDayMedian(userUuid: string): Promise<number | null> {
  const r = (await pool.query<{ med: string | null }>(
    `WITH easy_runs AS (
       SELECT (data->>'distanceMi')::numeric AS mi
         FROM runs
        WHERE user_uuid = $1::uuid
          AND NOT (data ? 'mergedIntoId')
          AND (data->>'distanceMi')::numeric BETWEEN 3 AND 9
          AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10))::text
              >= (NOW() - interval '14 days')::date::text
     )
     SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY mi)::text AS med
       FROM easy_runs`,
    [userUuid],
  ).catch(() => ({ rows: [{ med: null }] }))).rows[0];
  const m = Number(r?.med);
  if (!Number.isFinite(m) || m <= 0) return null;
  return Math.round(m * 2) / 2;
}

async function loadPlanEasyDayMedian(planId: string, today: string): Promise<number | null> {
  const r = (await pool.query<{ med: string | null }>(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY distance_mi)::text AS med
       FROM plan_workouts
      WHERE plan_id = $1
        AND type = 'easy'
        AND date_iso >= $2::date
        AND date_iso <  $2::date + INTERVAL '21 days'`,
    [planId, today],
  ).catch(() => ({ rows: [{ med: null }] }))).rows[0];
  const m = Number(r?.med);
  return Number.isFinite(m) && m > 0 ? Math.round(m * 2) / 2 : null;
}

async function loadRecentLongRunMedian(userUuid: string): Promise<number | null> {
  const r = (await pool.query<{ med: string | null }>(
    `WITH long_runs AS (
       SELECT (data->>'distanceMi')::numeric AS mi
         FROM runs
        WHERE user_uuid = $1::uuid
          AND NOT (data ? 'mergedIntoId')
          AND (data->>'distanceMi')::numeric >= 10
          AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10))::text
              >= (NOW() - interval '21 days')::date::text
        ORDER BY (data->>'distanceMi')::numeric DESC
        LIMIT 5
     )
     SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY mi)::text AS med
       FROM long_runs`,
    [userUuid],
  ).catch(() => ({ rows: [{ med: null }] }))).rows[0];
  const m = Number(r?.med);
  if (!Number.isFinite(m) || m <= 0) return null;
  return Math.round(m * 2) / 2;
}

async function loadPlanLongRunMedian(planId: string, today: string): Promise<number | null> {
  const r = (await pool.query<{ med: string | null }>(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY distance_mi)::text AS med
       FROM plan_workouts
      WHERE plan_id = $1
        AND type = 'long'
        AND date_iso >= $2::date - INTERVAL '14 days'
        AND date_iso <  $2::date + INTERVAL '14 days'`,
    [planId, today],
  ).catch(() => ({ rows: [{ med: null }] }))).rows[0];
  const m = Number(r?.med);
  return Number.isFinite(m) && m > 0 ? Math.round(m * 2) / 2 : null;
}

export async function hasPendingProposal(
  userUuid: string,
  planId: string,
  kind: DriftKind,
): Promise<boolean> {
  const r = (await pool.query<{ id: number }>(
    `SELECT id FROM plan_proposals
      WHERE user_uuid = $1 AND plan_id = $2 AND proposal_kind = $3
        AND (
              status = 'pending'
              OR (status = 'dismissed' AND resolved_at >= NOW() - interval '14 days')
            )
      ORDER BY created_at DESC LIMIT 1`,
    [userUuid, planId, kind],
  ).catch(() => ({ rows: [] }))).rows[0];
  return r != null;
}
