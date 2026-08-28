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
 *   · Research/00a §plan-adaptation · plans need re-authoring when  // TODO: no matching heading in Research/00a — content exists but heading not anchored
 *     "training conditions diverge materially from authored state."
 *   · Research/01-pace-zones-vdot.md §Recalibrate-Paces · ~2 VDOT drift = "materially."  // was Research/00a §VDOT re-rating (wrong file + phantom); heading: ## How to recalibrate paces
 *   · Research/00a-distance-running-training.md §Volume-Progression-Rules · sustained baseline drift  // was Research/04 §volume progression (wrong file + phantom); heading: ### Volume progression rules
 *     >40% means the runner is training a different fitness than
 *     the plan was built for.
 */

import { pool } from '@/lib/db/pool';
import { logReadFailure } from '@/lib/db/read';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { bestRecentVdot, VDOT_FULL_VALUE_DAYS, vdotFromTpace } from '@/lib/training/vdot';
import { loadVdotInputs, goalRunFloorMiForUser } from '@/lib/training/vdot-inputs';
import { primaryZone } from '@/lib/plan/prescription-parser';
// HEAT-DRIFT-1 (2026-08-17) · shared heat doctrine (Research/06 §1 table +
// §12 dewpoint surcharge) + Magnus-Tetens dewpoint estimate + the
// workout_weather_cache reader for runs without enriched weather fields.
import { lookupTempF } from '@/lib/weather/lookup';
import {
  runDaySql,
  runDateKeySql,
  runDistanceMiSql,
  runNotMergedSql,
  runTypeSql,
  runWorkoutTypeSql,
  runWeatherTempFSql,
  runWeatherHumidityPctSql,
  runWeatherConditionsSql,
  runWeatherCloudCoverPctSql,
} from '@/lib/runs/run-shape';
// The threshold-band question lives in a pure module so the drift monitor and
// the run recap can never disagree about whether a session left the band.
import {
  fastQualityLeftTheBand,
  ranAboveThresholdBand,
  ranBelowThresholdBand,
  slowQualityNeverReachedTheBand,
} from '@/lib/training/threshold-band';

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
 *  Research/00a-distance-running-training.md §Volume-Progression-Rules notes >40% sustained shift = different  // was Research/04 §progression (wrong file + phantom)
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

/**
 * VDOT drift threshold · how far current fitness may sit from the plan's
 * authored anchor before the plan is worth re-fitting.
 *
 * DRIFT-T-1 (2026-08-19) · this used to justify itself with a bare
 * pace-per-point claim and no pointer. `Research/01-pace-zones-vdot.md`
 * §"Update logic" states the corpus's own re-derivation quantum in code:
 * `if abs(new_VDOT - current_VDOT) >= 1: regenerate_all_paces()`. One point is
 * where doctrine says the prescribed paces have stopped being the right paces.
 *
 * This constant is deliberately TWO points, and that is ours, not Daniels'.
 * §"Update logic" is about a MEASURED new VDOT replacing a measured old one —
 * one number, one error term. This comparison has two estimates in it (the
 * plan's anchor, inferred back out of its own prescribed T-paces, against
 * `bestRecentVdot`), and its consequence is heavier: it writes a proposal
 * asking the runner to re-author their block, not a silent pace re-derivation.
 * So it fires at twice doctrine's quantum. `ADAPTATION.vdot-drift-threshold`
 * parses the `>= 1` out of §"Update logic" and holds this between one and two
 * times it, so the CONVENTION cannot quietly widen into "we never mention it".
 */
export const VDOT_DRIFT_THRESHOLD = 2.0;

/** Staleness threshold · plans authored more than 8 weeks ago should
 *  re-evaluate. Most build cycles run 12-16 wks · 8 wks is the rough
 *  midpoint where fitness has moved enough to warrant a refit. */
const STALENESS_WEEKS_THRESHOLD = 8;

/** Window for "current" weekly avg. Mirrors what generatePlan uses
 *  internally (recentWeeklyMileage = last 28 days). */
const VOLUME_WINDOW_DAYS = 28;

/** COLD-2 (2026-08-17) · a plan cannot have DRIFTED from a baseline it has not
 *  yet had time to be measured against. Volume drift compares a 28-day trailing
 *  average to the plan's authored `weeklyAvg4w`; inside the first fortnight the
 *  trailing window is still mostly pre-plan history, so the comparison measures
 *  the onboarding transient rather than drift. `checkStaleness` has an age guard
 *  but it only fires in the OTHER direction (too old), so nothing guarded the
 *  too-young end — and a young-plan volume signal auto-rebuilds without asking. */
const VOLUME_DRIFT_MIN_PLAN_AGE_DAYS = 14;


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
  // RECOVERY-DRIFT-1, REVERSED THE SAME DAY (2026-08-25).
  //
  // I guarded these three during a recovery block, on the reasoning that a
  // block which suppresses long runs on purpose cannot meaningfully be said
  // to be drifting. The owner disagreed — "I dont need low mileage after a
  // half for 2 weeks in a recovery. Im obv still putting in high miles" — and
  // the data is his:
  //
  //   RECOVERY_WEEKLY_PCT_OF_BASE.hm is [0.60, 0.80], so recovery week two
  //   is 80% of BASE. His real peak weeks are 47.5, 47.3 and 44.9 mi, which
  //   puts week two at about 38. The block authored on 17 Aug gave him 23,
  //   implying a base of 29 — his DEPRESSED post-race average rather than his
  //   peak, the exact anchor DOCTRINE-4 was written to stop using.
  //
  //   The drift rebuild on 25 Aug re-authored against the right anchor and
  //   produced 38. It did not overreach him; it corrected an
  //   under-prescription, and my guard would have locked him at 23.
  //
  // The thing that was actually wrong was never the adaptation. It was that
  // it happened silently and reset the week counter. Both are fixed
  // elsewhere. Drift stays on.
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
  /** `race-prep` · `maintenance` · `recovery`. See RECOVERY-DRIFT-1 below. */
  mode: string | null;
}

async function loadActivePlan(userUuid: string): Promise<ActivePlan | null> {
  const r = (await pool.query<{
    id: string;
    race_id: string | null;
    authored_iso: Date;
    authored_state: Record<string, unknown>;
    mode: string | null;
  }>(
    `SELECT id, race_id, authored_iso, authored_state, mode
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
    mode: r.mode ?? null,
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

  // COLD-2 · plan-age grace. See VOLUME_DRIFT_MIN_PLAN_AGE_DAYS.
  const authoredMs = Date.parse(plan.authored_iso);
  if (Number.isFinite(authoredMs)) {
    const ageDays = (Date.now() - authoredMs) / 86400000;
    if (ageDays < VOLUME_DRIFT_MIN_PLAN_AGE_DAYS) return null;
  }

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
  // 2026-08-17 · COLD-2 · the fixed `/ 4` divisor is now `/ coveredWeeks`, and
  // returns null under a week of observable history. The old form read a
  // perfectly-executed first week as a 75% volume collapse, which cleared the
  // 40% threshold below and fired an unconfirmed auto-rebuild.
  const { recentMileageWindow, weeklyAvgFromWindow } = await import('@/lib/runs/volume');
  const { totalMi, coveredDays } = await recentMileageWindow(userUuid, VOLUME_WINDOW_DAYS);
  return weeklyAvgFromWindow(totalMi, coveredDays, VOLUME_WINDOW_DAYS);
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
  const rows = (await pool.query<{ pace: number; sub_label: string | null }>(
    // DRIFT-T-1 · ORDER BY, because `LIMIT 4` over an unordered scan is four
    // arbitrary rows and this plan's T-pace ramps across the block — the same
    // query could answer differently on two consecutive nights.
    `SELECT pace_target_s_per_mi::int AS pace, sub_label
       FROM plan_workouts
      WHERE plan_id = $1
        AND type = 'threshold'
        AND pace_target_s_per_mi IS NOT NULL
        AND pace_target_s_per_mi > 0
      ORDER BY date_iso, id
      LIMIT 4`,
    [planId],
  ).catch(() => ({ rows: [] }))).rows;
  if (rows.length === 0) return null;

  // DRIFT-T-1 · a `threshold` ROW is not automatically a T-PACE row. The
  // catalogue can author §5.4's sub-threshold intervals and §14.2's 10K work
  // under the same type, and both carry a declared zone that is not T — the
  // identical mistake CEIL-ZONE-1 fixed in plan-target.ts, on the identical
  // column. Rows whose declared zone is not T are dropped rather than averaged
  // in at the wrong zone; when none survive, the anchor is honestly unknown.
  const tPaces = rows
    .filter((r) => {
      const z = primaryZone(r.sub_label);
      return z == null || z === 'T';
    })
    .map((r) => r.pace);
  if (tPaces.length === 0) return null;

  // Average T-pace across the plan's threshold workouts.
  const avgPace = tPaces.reduce((s, p) => s + p, 0) / tPaces.length;

  // DRIFT-T-1 (2026-08-19) · THE canonical inversion, not a second copy of it.
  //
  // This line used to call a local `inverseTPaceToVdot` over a hand-typed
  // eight-row `T_PACE_TABLE` whose only citation was a book ("Daniels' Running
  // Formula 4e, Table 2.2") rather than anything in `Research/`. It was a
  // duplicate of `vdotFromTpace`, which IS bound to doctrine by
  // `PACE.threshold-anchor` — and the two disagreed, systematically, in one
  // direction, by an amount that GREW with fitness:
  //
  //   VDOT | canonical T | typed table |  the typed table's pace, read
  //        |     (s/mi)  |     (s/mi)  |  canonically → VDOT
  //     45 |         454 |         451 |  45.3
  //     50 |         414 |         408 |  50.8
  //     55 |         381 |         373 |  56.2
  //     60 |         353 |         343 |  61.8
  //     65 |         329 |         317 |  67.6
  //
  // The plan's anchor came out of the typed table and `loadCurrentVdot` comes
  // out of `bestRecentVdot`, so the two sides of the subtraction below were
  // read off different tables. At VDOT 65 the gap is 2.6 points — larger than
  // `VDOT_DRIFT_THRESHOLD` itself, and signed the same way every time. A runner
  // could be told their fitness had drifted UP from the plan when nothing had
  // moved but which lookup table each half of the comparison used.
  return vdotFromTpace(avgPace);
}

async function loadCurrentVdot(userUuid: string): Promise<number | null> {
  const today = await runnerToday(userUuid);
  // Same goal-relative floor as the projection cron so a 5K runner's drift
  // reads off the same candidate set (mismatch → false drift signal).
  const runFloorMi = await goalRunFloorMiForUser(userUuid);
  const { raceCandidates, runCandidates } = await loadVdotInputs(userUuid, today);
  const { best } = bestRecentVdot(raceCandidates, today, VDOT_FULL_VALUE_DAYS, runCandidates, runFloorMi);
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
 *
 * HEAT-DRIFT-1 (2026-08-17), REMOVED 2026-08-27 · this used to normalize
 * each run's actual pace to the 50°F reference before comparing it to
 * plan, so a hot day's slower pace wouldn't read as fitness drift. The
 * runner paces off feel and conditions on the day and does not want any
 * pace adjusted for heat, including this aggregate one, so the
 * normalization is gone: heatAdjustQualitySample is now a pure
 * passthrough, kept only so callers don't need restructuring.
 */
export interface QualityDriftSample {
  /** prescribed pace_target_s_per_mi */
  plannedSPerMi: number;
  /** run's raw average pace (s/mi) */
  actualSPerMi: number;
  /** plan_workouts.type — intervals/vo2max get the §2 half adjustment */
  workoutType: string;
  tempF: number | null;
  dewpointF: number | null;
  humidityPct: number | null;
  /** 2026-08-17 · the sky. Without it this sample dropped the Research/06 §3
   *  solar correction that the post-run verdict applies, so a clear 80°F
   *  tempo normalised at 7.2% here and 9.4% on the recap — the same run,
   *  two answers. Null when the run carries no cloud/condition signal. */
  conditions?: string | null;
  cloudCoverPct?: number | null;
  durationS: number | null;
}

/** REMOVED 2026-08-27 · pure passthrough, kept only so callers don't need
 *  restructuring. Quality drift now scores every run's raw pace against
 *  plan, unadjusted — no run's pace is normalized for heat. */
export function heatAdjustQualitySample(s: QualityDriftSample): { adjustedSPerMi: number; slowdownPct: number } {
  return { adjustedSPerMi: s.actualSPerMi, slowdownPct: 0 };
}

/** percentile_cont(0.5) equivalent · linear-interpolated median. */
function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = (s.length - 1) / 2;
  const lo = Math.floor(mid), hi = Math.ceil(mid);
  return (s[lo] + s[hi]) / 2;
}

async function checkQualityDrift(
  userUuid: string,
  plan: ActivePlan,
): Promise<DriftSignal | null> {
  const PACE_DRIFT_PCT = 5;
  const rows = (await pool.query<{
    planned: string | null;
    pw_type: string;
    hr_target_bpm: string | null;
    avg_hr: string | null;
    actual: string | null;
    run_date: string | null;
    temp_f_peak: string | null;
    humidity_pct: string | null;
    conditions: string | null;
    cloud_cover_pct: string | null;
    duration_s: string | null;
    start_lat: string | null;
    start_lon: string | null;
  }>(
    `SELECT pw.pace_target_s_per_mi::text AS planned,
            pw.type AS pw_type,
            (pw.workout_spec->>'hr_target_bpm')::text AS hr_target_bpm,
            r.data->>'avgHr' AS avg_hr,
            CASE
              WHEN (r.data->>'avgPaceMinPerMi') ~ '^[0-9]+:[0-9]+$'
              THEN EXTRACT(EPOCH FROM (r.data->>'avgPaceMinPerMi')::interval)::text
              ELSE NULL
            END AS actual,
            r.data->>'date' AS run_date,
            -- 2026-08-17 · these read TOP-LEVEL camelCase keys that exist on
            -- zero rows; the enrichment writes snake_case inside
            -- data->'weather'. Every input but bare temperature was silently
            -- null, so the humidity surcharge and the solar correction never
            -- applied here even though the header above describes adding them.
            ${runWeatherTempFSql('r')} AS temp_f_peak,
            ${runWeatherHumidityPctSql('r')} AS humidity_pct,
            ${runWeatherConditionsSql('r')} AS conditions,
            ${runWeatherCloudCoverPctSql('r')} AS cloud_cover_pct,
            COALESCE(r.data->>'durationSec', r.data->>'movingTimeS', r.data->>'elapsedTimeS') AS duration_s,
            COALESCE(r.data->'startLatLng'->>0, r.data->>'startLat', r.data->>'start_latitude') AS start_lat,
            COALESCE(r.data->'startLatLng'->>1, r.data->>'startLng', r.data->>'start_longitude') AS start_lon
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
       -- 2026-08-24 · pw.date_iso is TEXT. Both comparisons below used to
       -- meet a date uncast, and Postgres refused the whole statement
       -- ("operator does not exist: date = text"). The .catch below turned
       -- that into an empty result set, so the PACE axis of the drift monitor
       -- returned no sessions for any runner, ever, since it was written.
       -- Verified against prod on 2026-08-24: 0 rows as shipped, 11 real
       -- quality sessions with the casts (AFC block, 21 days to 2026-07-15).
       --
       -- The canonical-row predicate is part of the same fix, not a bonus. A
       -- physical run lands as up to three rows (watch + Apple Health +
       -- Strava); joining on the day alone returned each session two or three
       -- times, which would have weighted those days that many times over in
       -- the median the moment the join started matching.
       LEFT JOIN runs r ON r.user_uuid = $1::uuid
            AND (r.data->>'date')::date = pw.date_iso::date
            AND ${runNotMergedSql('r')}
       WHERE tp.id = $2
         AND pw.is_quality = true
         AND pw.date_iso::date >= $3::date - INTERVAL '21 days'
         AND pw.date_iso::date <  $3::date
         AND pw.pace_target_s_per_mi IS NOT NULL`,
    [userUuid, plan.id, await runnerToday(userUuid)],
  ).catch((e) => {
    console.error('[drift-monitor] quality-drift read failed:', e);
    return { rows: [] };
  })).rows;

  const adjustedActuals: number[] = [];
  const planneds: number[] = [];
  let adjustedRuns = 0;
  let maxSlowdownPct = 0;
  /* HR corroboration for the FASTER case · see the branch below. Counted over
   * the same rows so the two reads can never describe different sessions. */
  let hrReadable = 0;
  let hrAboveThreshold = 0;
  let hrBelowThreshold = 0;
  for (const row of rows) {
    const actual = row.actual != null ? Number(row.actual) : NaN;
    const planned = row.planned != null ? Number(row.planned) : NaN;
    if (!Number.isFinite(actual) || !Number.isFinite(planned) || planned <= 0) continue;
    // Per-run weather resolution: enriched run fields first, then the
    // workout_weather_cache keyed by the run's start coords + date.
    // One fragment now resolves peak → mean → bare tempF, so there is nothing
    // left to ladder here.
    let tempF: number | null = row.temp_f_peak != null && Number.isFinite(Number(row.temp_f_peak))
      ? Number(row.temp_f_peak)
      : null;
    if (tempF == null) {
      const lat = row.start_lat != null ? Number(row.start_lat) : NaN;
      const lon = row.start_lon != null ? Number(row.start_lon) : NaN;
      if (Number.isFinite(lat) && Number.isFinite(lon) && row.run_date) {
        tempF = await lookupTempF(lat, lon, row.run_date).catch(() => null);
      }
    }
    const num = (raw: string | null): number | null => {
      const v = raw != null ? Number(raw) : NaN;
      return Number.isFinite(v) ? v : null;
    };
    const { adjustedSPerMi, slowdownPct } = heatAdjustQualitySample({
      plannedSPerMi: planned,
      actualSPerMi: actual,
      workoutType: row.pw_type,
      tempF,
      // No stored dewpoint anywhere in runs.data · heat-model estimates it
      // from temperature + humidity (Magnus-Tetens).
      dewpointF: null,
      humidityPct: num(row.humidity_pct),
      conditions: row.conditions ?? null,
      cloudCoverPct: num(row.cloud_cover_pct),
      durationS: num(row.duration_s),
    });
    if (slowdownPct > 0) { adjustedRuns++; maxSlowdownPct = Math.max(maxSlowdownPct, slowdownPct); }

    // Did the heart rate agree that this was threshold work?
    const avgHr = num(row.avg_hr);
    const hrTarget = num(row.hr_target_bpm);
    if (avgHr != null && hrTarget != null && hrTarget > 0) {
      hrReadable++;
      if (ranAboveThresholdBand(avgHr, hrTarget)) hrAboveThreshold++;
      else if (ranBelowThresholdBand(avgHr, hrTarget)) hrBelowThreshold++;
    }

    adjustedActuals.push(adjustedSPerMi);
    planneds.push(planned);
  }

  const actualMed = medianOf(adjustedActuals);
  const plannedMed = medianOf(planneds);
  if (actualMed == null || plannedMed == null || plannedMed <= 0) return null;

  const pctDrift = ((actualMed - plannedMed) / plannedMed) * 100;
  const absPct = Math.abs(pctDrift);
  if (absPct < PACE_DRIFT_PCT) return null;

  const severity = Math.min(1, (absPct - PACE_DRIFT_PCT) / PACE_DRIFT_PCT);
  // Note · negative pace_drift means runner is FASTER than prescribed
  const fasterThanPlan = pctDrift < 0;
  const heatNote = adjustedRuns > 0
    ? ` (heat-normalized · ${adjustedRuns} run${adjustedRuns === 1 ? '' : 's'} adjusted for conditions)`
    : '';
  /* FASTER than prescribed has TWO explanations and they call for opposite
   * responses. The engine used to assume one of them — "pace targets are too
   * soft · refit VDOT" — which validates overcooking and, on a rebuild, hands
   * the runner faster targets that make the next session hotter still.
   *
   * Threshold adaptation comes from time at the intensity where lactate
   * clearance matches production (Research/04 §5). Exceeding that pace does not
   * buy more of it; it ends the session sooner and banks fatigue. So a fast
   * tempo run WITH the heart rate above the band is an execution finding, not a
   * fitness finding, and rebuilding the plan is the wrong move.
   *
   * Where HR says the runner genuinely sat inside the band while running
   * faster, that is a soft LEAD (Research/01 §"Testing cadence") — worth a
   * refit proposal, still not proof of new fitness. */
  if (fasterThanPlan && fastQualityLeftTheBand(hrReadable, hrAboveThreshold)) {
    // Suppress the rebuild proposal. Nothing about the plan is wrong.
    return null;
  }

  /* SLOWER than prescribed is the mirror, and it was left unguarded.
   *
   * It has the same two explanations: the targets really are too aggressive,
   * or the runner never reached the intensity. Heart rate separates them, and
   * the pair was already being counted in the loop above for the fast case
   * only — the discriminator existed and one branch used it.
   *
   * This one also LOOPS, which the fast case does not. "Refit to a lower VDOT"
   * hands back slower targets; slower targets are easier; an obedient runner's
   * next sessions sit lower still on HR and pace; the detector fires again.
   * Gating on HR breaks the cycle at exactly the right place, because a runner
   * dutifully hitting an over-soft target is precisely the case where HR sits
   * under the band. */
  if (!fasterThanPlan && slowQualityNeverReachedTheBand(hrReadable, hrBelowThreshold)) {
    return null;
  }

  const message = fasterThanPlan
    ? `Your quality workouts are landing ${Math.abs(Math.round(pctDrift))}% ` +
      `FASTER than prescribed${heatNote}` +
      (hrReadable > 0
        ? ` and the heart rate agrees they sat inside the band · the targets look soft`
        : ` · the targets may be soft, though no heart-rate data corroborates it`) +
      ` · worth a refit, not proof of new fitness on its own.`
    : `Your quality workouts are landing ${Math.round(pctDrift)}% SLOWER ` +
      `than prescribed${heatNote}` +
      (hrReadable > 0
        ? ` with the heart rate up in the band · the effort was there and the pace was not`
        : ` · no heart-rate data to say whether the effort was there`) +
      ` · check accumulated fatigue before refitting.`;

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
      heat_adjusted_runs: adjustedRuns,
      max_heat_slowdown_pct: maxSlowdownPct,
      hr_readable_runs: hrReadable,
      hr_above_threshold_runs: hrAboveThreshold,
      hr_below_threshold_runs: hrBelowThreshold,
      citation: 'docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 1.2 + Daniels Running Formula §VDOT pace tables + Research/06-weather-adjustments.md §1-§2 (heat normalization)',
    },
  };
}

/**
 * Runs that are NOT ordinary aerobic training, excluded from "what does this
 * runner's easy / long day actually look like" baselines.
 *
 * 2026-08-17 · both baselines below bucketed on BARE DISTANCE. Any 3-9 mile
 * run counted as an easy day — a 5-mile tempo, a 6-mile threshold, a parkrun.
 * Any run over 10 miles in the window counted as long-run capability, so a
 * half marathon RACE became evidence of what this runner's long run should be.
 * That is the same shape as the phantom-5K bug recorded in CLAUDE.md: a race
 * effort leaking into a training baseline.
 *
 * Both baselines drive plan-rebuild proposals, so the contamination did not
 * just mis-describe the runner — it re-authored their plan around the
 * mis-description.
 *
 * Two filters, exactly as `lib/training/decoupling-trend.ts` applies them:
 * the run's own type, and a plan-day join that catches historical rows
 * predating the type stamp. Over-exclusion is the safe direction — a missing
 * point weakens a baseline, a contaminated one moves it.
 */
const NOT_QUALITY_OR_RACE = (runAlias: string) => `
  COALESCE(${runWorkoutTypeSql(runAlias)}, ${runTypeSql(runAlias)}, '')
        NOT IN ('race', 'intervals', 'threshold', 'tempo', 'fartlek')
  AND NOT EXISTS (
    SELECT 1 FROM plan_workouts pw
      JOIN training_plans tp ON tp.id = pw.plan_id
     WHERE tp.user_uuid = $1::uuid
       AND pw.date_iso = ${runDaySql(runAlias)}
       AND pw.type IN ('race', 'intervals', 'threshold', 'tempo', 'fartlek', 'race_week_tuneup')
  )`;

async function loadEasyDayMedian(userUuid: string): Promise<number | null> {
  const r = (await pool.query<{ med: string | null }>(
    `WITH easy_runs AS (
       SELECT ${runDistanceMiSql('r')} AS mi
         FROM runs r
        WHERE r.user_uuid = $1::uuid
          AND NOT (r.data ? 'mergedIntoId')
          AND ${runDistanceMiSql('r')} BETWEEN 3 AND 9
          AND ${runDateKeySql('r')} >= (NOW() - interval '14 days')::date::text
          AND ${NOT_QUALITY_OR_RACE('r')}
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
        -- 2026-08-24 · date_iso is TEXT · see checkQualityDrift. As shipped
        -- this raised "operator does not exist: text >= date" and the null it
        -- fell back to reads as "the plan prescribes no easy days", which is
        -- what the easy-distance drift axis has been told all along. Verified
        -- against prod: error as shipped, 8.5 mi with the casts.
        AND date_iso::date >= $2::date
        AND date_iso::date <  $2::date + INTERVAL '21 days'`,
    [planId, today],
  ).catch((e) => {
    console.error('[drift-monitor] plan easy-day median failed:', e);
    return { rows: [{ med: null }] };
  })).rows[0];
  const m = Number(r?.med);
  return Number.isFinite(m) && m > 0 ? Math.round(m * 2) / 2 : null;
}

async function loadRecentLongRunMedian(userUuid: string): Promise<number | null> {
  const r = (await pool.query<{ med: string | null }>(
    `WITH long_runs AS (
       SELECT ${runDistanceMiSql('r')} AS mi
         FROM runs r
        WHERE r.user_uuid = $1::uuid
          AND NOT (r.data ? 'mergedIntoId')
          AND ${runDistanceMiSql('r')} >= 10
          AND ${runDateKeySql('r')} >= (NOW() - interval '21 days')::date::text
          AND ${NOT_QUALITY_OR_RACE('r')}
        ORDER BY ${runDistanceMiSql('r')} DESC
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
        -- 2026-08-24 · date_iso is TEXT · see checkQualityDrift. Verified
        -- against prod: "operator does not exist: text >= timestamp without
        -- time zone" as shipped, 16.5 mi with the casts.
        AND date_iso::date >= $2::date - INTERVAL '14 days'
        AND date_iso::date <  $2::date + INTERVAL '14 days'`,
    [planId, today],
  ).catch((e) => {
    console.error('[drift-monitor] plan long-run median failed:', e);
    return { rows: [{ med: null }] };
  })).rows[0];
  const m = Number(r?.med);
  return Number.isFinite(m) && m > 0 ? Math.round(m * 2) / 2 : null;
}

/**
 * 2026-08-17 · truth-bug fix · guard and writer now agree.
 *
 *   · kind matches what the writer actually stamps (the cron writes the
 *     signal's TRUE kind via driftProposalKind — no more checking
 *     'staleness' while the row says 'goal_time_changed').
 *   · planId '' (or null-ish) means "any plan for this user". The
 *     goal-gap caller passed '' and the strict plan_id = '' equality
 *     could never match a real row, so that dedupe was dead code.
 */
export async function hasPendingProposal(
  userUuid: string,
  planId: string,
  kind: DriftKind,
): Promise<boolean> {
  const scoped = planId != null && planId !== '';
  const r = (await pool.query<{ id: number }>(
    `SELECT id FROM plan_proposals
      WHERE user_uuid = $1 AND proposal_kind = $2
        AND (
              -- Standing / recently-refused rows, scoped to the plan they
              -- were written against.
              (
                ($3::text IS NULL OR plan_id::text = $3::text)
                AND (
                      status = 'pending'
                      OR (status = 'dismissed' AND resolved_at >= NOW() - interval '14 days')
                    )
              )
              -- 2026-08-25 · A REBUILD THAT ALREADY LANDED IS NOT INVISIBLE.
              --
              -- This arm did not exist. The guard matched 'pending' and
              -- recently-'dismissed' only, so the one outcome it could not see
              -- was the one that matters most: a rebuild that SUCCEEDED. Run
              -- this cron twice in a day and the second run re-authored the
              -- block, because the first run's row says 'auto_applied'.
              --
              -- Deliberately USER-scoped, not plan-scoped. A successful rebuild
              -- archives the plan the row points at and authors a new one, so
              -- by the time the next run asks, planId is the NEW plan's id
              -- and the row carries the OLD one. Scoping this arm the way the
              -- arm above is scoped would make it structurally unable to ever
              -- match — the same dead-guard shape as the plan_id = the empty string
              -- equality the 2026-08-17 fix found.
              --
              -- 20 hours, argued: the schedule is daily (0 9 * * *) and GitHub
              -- Actions runs it late, never early. Observed starts on this
              -- deployment span 09:20-09:58 UTC, so the tightest gap between
              -- two consecutive legitimate runs is ~23h. 20h clears that with
              -- room, and covers any same-day re-run or workflow_dispatch.
              -- This is an IDEMPOTENCE floor — "twice for one cause is once" —
              -- not a policy cooldown. How long a runner should be left alone
              -- after a rebuild is a separate question, and a bigger one.
              -- 2026-08-25 · AND NEITHER IS A REBUILD THAT LOOKED AND FOUND
              -- NOTHING. no_change is what the commit gate writes when the
              -- block it composed was identical to the one already active, so
              -- the rebuild rolled back. That is an OUTCOME for this cause, and
              -- the arm above is an idempotence floor over causes, not over
              -- successes: re-running the same composition four hours later can
              -- only reach the same rollback.
              --
              -- Widening an OR arm can only make this guard fire MORE often,
              -- which is the direction it is safe to be wrong in. It does not
              -- touch the fail-closed catch or the 'auto_applied' arm below it,
              -- both of which are load-bearing and were fixed earlier today.
              OR (status IN ('auto_applied', 'no_change')
                  AND created_at >= NOW() - interval '20 hours')
            )
      ORDER BY created_at DESC LIMIT 1`,
    [userUuid, kind, scoped ? planId : null],
    // 2026-08-25 · FAILS CLOSED. Was `.catch(() => ({ rows: [] }))`, and two
    // lines later `return r != null` turned that empty into `false` — "nothing
    // is pending, go ahead". The consumer of that `false` is the only guard
    // standing between the nightly cron and REPLACING THE RUNNER'S TRAINING
    // BLOCK, so a transient DB error was a licence to re-author it.
    //
    // The 2026-08-24 sweep fixed exactly this shape in the four inline dedupe
    // guards in the plan-drift route and missed this one, because the scanner's
    // taxonomy reads `{ rows: [] }` as EMPTIED (a harmless empty container)
    // and cannot see the minting that happens outside the catch. A guard that
    // cannot see must assume the thing it guards against has already happened.
  ).catch((e) => { logReadFailure('plan/drift-monitor · rebuild guard', e); return { rows: [{ id: -1 }] }; })).rows[0];
  return r != null;
}
