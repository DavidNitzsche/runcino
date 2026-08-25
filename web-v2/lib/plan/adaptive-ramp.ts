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
 * DOCTRINE-BOOK-15 (2026-08-17) · THE BUMP POLICY IS A PRODUCT CONVENTION.
 * This used to cite `Pfitzinger Faster Road Racing · adaptive load progression`,
 * which the gate could not open — and Faster Road Racing's plans are fixed
 * schedules, so there is no adaptive-progression protocol in it to cite. The
 * gates above (readiness green, last two qualities on pace, clean long,
 * 7-day cooldown) are ours, and so are MAX_LONG_BUMP_MI / MAX_WEEKLY_BUMP_MI.
 * +5 mi in a week is NOT inside Research/00a's per-week ramp band at low
 * volume — at 20 mpw it is +25% — which is exactly why the bump is bounded by
 * the tier band rather than by a percentage, and why it only fires when the
 * runner is demonstrably absorbing load. CONVENTION.adaptive-bump-ceiling
 * binds the property it actually owes: a bump can never carry a runner past
 * the upper band of their own tier.
 *
 * Cite: Research/00a-distance-running-training.md §Volume-Progression-Rules  // was §progressive-overload · heading: ### Volume progression rules
 * Cite: Research/00a-distance-running-training.md §"Practical load rules" — add
 *       stress one-at-a-time; the fatigue gate that the pull-back streak mirrors
 */

import { pool } from '@/lib/db/pool';
import { rowOrNull } from '@/lib/db/read';
import { runnerToday } from '@/lib/runtime/runner-tz';

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
  // 2026-06-03 · runner TZ for "today" anchors.
  const today = await runnerToday(userId);
  // 1. Readiness · no pull-back streaks ≥ 2 days
  const readinessRow = await rowOrNull<{ streaks: unknown }>(
    'plan/adaptive-ramp · readiness pull-back streaks',
    pool.query<{ streaks: unknown }>(
      `SELECT streaks
       FROM readiness_snapshots
      WHERE user_uuid = $1 AND snapshot_date >= $2::date - 1
      ORDER BY snapshot_date DESC LIMIT 1`,
      [userId, today],
    ),
  );
  // A failed read is not "no pull-back streak". `.catch(() => undefined)` here
  // gave `streaks = []`, `pullbackStreakDays = 0`, `readinessGreen = true` — a
  // dropped connection read as a runner absorbing load well, and this gate is
  // one of five that authorise PRESCRIBING MORE MILEAGE. The one signal that
  // would stop a bump is exactly the one an unreadable table cannot show.
  const readinessReadFailed = readinessRow === null;
  const streaks = (readinessRow?.streaks as Array<{ direction?: string; days?: number }> | undefined) ?? [];
  const pullbackStreakDays = streaks
    .filter((s) => s.direction === 'below')
    .reduce((max, s) => Math.max(max, Number(s.days ?? 0)), 0);
  const readinessGreen = !readinessReadFailed && pullbackStreakDays < 2;

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
        AND (data->>'date')::date >= $2::date - 14
      ORDER BY (data->>'date')::date DESC LIMIT 2`,
    [userId, today],
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
  const recentLong = await rowOrNull<{ decoupling: number | null }>(
    'plan/adaptive-ramp · last long decoupling',
    pool.query<{ decoupling: number | null }>(
      `SELECT (data->>'aerobicDecouplingPct')::numeric AS decoupling
       FROM runs
      WHERE user_uuid = $1
        AND NOT (data ? 'mergedIntoId')
        AND (data->>'type') = 'long'
        AND (data->>'date')::date >= $2::date - 14
      ORDER BY (data->>'date')::date DESC LIMIT 1`,
      [userId, today],
    ),
  );
  const longReadFailed = recentLong === null;
  const lastLongDecouplingPct = recentLong?.decoupling != null
    ? Number(recentLong.decoupling)
    : null;
  // A long run we looked for and did not find, or found without decoupling
  // recorded, still counts as clean · that is a fact about the data we have.
  // A read that FAILED is not that fact. The old comment argued "benefit of
  // doubt" for both cases at once, and the benefit was being handed to the
  // engine, not the runner: the answer it produced was permission to add
  // mileage. We do not get the doubt when we cannot see.
  const lastLongClean = !longReadFailed
    && (lastLongDecouplingPct == null
      || lastLongDecouplingPct < LONG_DECOUPLING_PCT_CAP);

  // 4. Plan's current peak weekly · is there headroom?
  const tierWeeklyUpper = readTierUpper(activePlan.authoredState, 'tier_peak_weekly_band');
  const tierLongUpper = readTierUpper(activePlan.authoredState, 'tier_peak_long_band');
  const peakRow = await rowOrNull<{ peak_weekly: number | null; peak_long: number | null }>(
    'plan/adaptive-ramp · plan peak weekly headroom',
    pool.query<{ peak_weekly: number | null; peak_long: number | null }>(
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
    ),
  );
  // A failed read is not "the plan peaks at zero". `.catch(() => ({ peak_weekly:
  // null }))` minted 0, and 0 against the tier upper is FULL headroom · the one
  // reading that makes the ceiling gate wave everything through. The plan we
  // could not measure is the plan we must not add to.
  const peakReadFailed = peakRow === null;
  const currentPeakWeekly = Number(peakRow?.peak_weekly ?? 0);
  const peakHeadroomMi = tierWeeklyUpper - currentPeakWeekly;
  const belowTierUpper = !peakReadFailed
    && peakHeadroomMi > tierWeeklyUpper * 0.05;  // ≥ 5% headroom

  // 5. Cooldown · no bump applied in last 7 days
  //
  // 2026-08-24 · swallowed-failure sweep · `coach_intents.user_id` is `uuid`,
  // so `COALESCE(user_uuid::text, user_id)` gave Postgres two types it cannot
  // match and the read threw on every call. `.catch(() => undefined)` then fell
  // to `daysSinceLastBump = 999`, i.e. "no bump in nearly three years" — the
  // cooldown was OPEN for every runner on every evaluation, which is the one
  // answer that lets a ramp fire back-to-back.
  const lastBump = await rowOrNull<{ ts: Date | string }>(
    'plan/adaptive-ramp · lastBump cooldown',
    pool.query<{ ts: Date | string }>(
      `SELECT ts FROM coach_intents
      WHERE COALESCE(user_uuid, user_id) = $1::uuid
        AND reason = 'plan_adapt_bump'
      ORDER BY ts DESC LIMIT 1`,
      [userId],
    ),
  );
  // A failed read is not "no recent bump". The cooldown holds CLOSED when it
  // cannot see, because a ramp we cannot justify must not fire. `999` stays the
  // sentinel for a genuine no-bump-on-record; a failure is its own state.
  const bumpReadFailed = lastBump === null;
  const daysSinceLastBump = lastBump?.ts
    ? Math.floor((Date.now() - new Date(lastBump.ts).getTime()) / 86400000)
    : 999;
  const noBumpRecent = !bumpReadFailed && daysSinceLastBump >= COOLDOWN_DAYS;

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
 * Compute the per-row bumps for the next 7 days. Two caps:
 *   · Long run · +1mi (capped at tier.peakLongMiBand[1])
 *   · Weekly total · +5mi (distributed across easy days, capped per
 *     easy day at +1mi so we don't accidentally shift a 5mi easy to
 *     10mi · doctrine: distribute reward, don't pile on one day)
 *
 * Returns an AdaptationAction of kind 'mark_upgrade' that
 * applyAdaptations() consumes.
 */
export const MAX_LONG_BUMP_MI = 1.0;
export const MAX_WEEKLY_BUMP_MI = 5.0;
export const MAX_PER_EASY_BUMP_MI = 1.0;

export interface UpgradePlan {
  bumps: Array<{ workoutId: string; oldDistanceMi: number; newDistanceMi: number; type: string }>;
  longBumpMi: number;
  weeklyBumpMi: number;
  reason: string;
}

export async function planUpgrade(opp: RampOpportunity): Promise<UpgradePlan | null> {
  // 2026-06-03 · resolve runner TZ via plan_id → user_uuid lookup.
  // RampOpportunity doesn't carry userId, so we look it up. Off-by-1-day
  // matters here · upgrading "next 7 days" of plan workouts shouldn't
  // shift at UTC-midnight.
  const userRow = (await pool.query<{ user_uuid: string }>(
    `SELECT user_uuid::text FROM training_plans WHERE id = $1 LIMIT 1`,
    [opp.planId],
  ).catch(() => ({ rows: [] as Array<{ user_uuid: string }> }))).rows[0];
  const today = userRow?.user_uuid
    ? await runnerToday(userRow.user_uuid)
    // No owning user means the plan row is gone, so the query below
    // returns nothing and this value is never read against real data.
    // Server UTC is the only thing available and cannot mislead here.
    : new Date().toISOString().slice(0, 10);
  // Pull next 7 days of rows on the active plan.
  const rows = await pool.query<{
    id: string; type: string; distance_mi: number; date_iso: string;
  }>(
    `SELECT pw.id, pw.type, pw.distance_mi::numeric AS distance_mi, pw.date_iso::text AS date_iso
       FROM plan_workouts pw
       JOIN plan_weeks pwk ON pwk.id = pw.week_id
       JOIN plan_phases pp ON pp.id = pwk.phase_id
      WHERE pw.plan_id = $1
        AND pw.date_iso::date BETWEEN $2::date AND $2::date + 6
        AND pp.label <> 'TAPER'
      ORDER BY pw.date_iso::date ASC`,
    [opp.planId, today],
  ).then((r) => r.rows).catch(() => []);

  if (rows.length === 0) return null;

  const bumps: UpgradePlan['bumps'] = [];
  let longBumpApplied = 0;
  let weeklyBumpApplied = 0;

  // 1) Long bump · +1mi capped at tier upper.
  const longRow = rows.find((r) => r.type === 'long');
  if (longRow) {
    const old = Number(longRow.distance_mi);
    const proposed = old + MAX_LONG_BUMP_MI;
    const capped = Math.min(proposed, opp.tierLongUpper);
    if (capped > old) {
      bumps.push({ workoutId: longRow.id, oldDistanceMi: old, newDistanceMi: capped, type: 'long' });
      longBumpApplied = capped - old;
    }
  }

  // 2) Easy bumps · distribute up to (MAX_WEEKLY_BUMP_MI - longBumpApplied)
  //    across easy days. Per-easy cap = MAX_PER_EASY_BUMP_MI.
  const easyBudgetMi = MAX_WEEKLY_BUMP_MI - longBumpApplied;
  if (easyBudgetMi > 0) {
    const easyRows = rows.filter((r) => r.type === 'easy' || r.type === 'recovery');
    let remaining = easyBudgetMi;
    for (const r of easyRows) {
      if (remaining <= 0) break;
      const add = Math.min(MAX_PER_EASY_BUMP_MI, remaining);
      const old = Number(r.distance_mi);
      const newDist = Number((old + add).toFixed(1));
      bumps.push({ workoutId: r.id, oldDistanceMi: old, newDistanceMi: newDist, type: r.type });
      remaining -= add;
      weeklyBumpApplied += add;
    }
  }

  if (bumps.length === 0) return null;

  return {
    bumps,
    longBumpMi: longBumpApplied,
    weeklyBumpMi: longBumpApplied + weeklyBumpApplied,
    reason: opp.reason,
  };
}

/** Back-compat alias · the old name still works for the test bench. */
export const planBump = planUpgrade;

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
 * Build the `mark_upgrade` AdaptationAction for the canonical applyAdaptations
 * path. Returns null when no opportunity exists or no rows to bump.
 * Caller's pattern · `actions.push(...)` next to the other adapter
 * triggers, then `applyAdaptations(userId, actions)`.
 */
export async function actionForAdaptiveRamp(
  userId: string,
): Promise<{
  kind: 'mark_upgrade';
  bumps: Array<{ workoutId: string; newDistanceMi: number }>;
  longBumpMi: number;
  weeklyBumpMi: number;
  why: string;
} | null> {
  const opp = await detectGreenRampOpportunity(userId);
  if (!opp) return null;
  const upgrade = await planUpgrade(opp);
  if (!upgrade) return null;
  return {
    kind: 'mark_upgrade',
    bumps: upgrade.bumps.map((b) => ({ workoutId: b.workoutId, newDistanceMi: b.newDistanceMi })),
    longBumpMi: upgrade.longBumpMi,
    weeklyBumpMi: upgrade.weeklyBumpMi,
    why: opp.reason,
  };
}

/**
 * Cron-path orchestrator · run after detectAdaptations + applyAdaptations.
 * Skips bump when pull-back actions fired this tick · we don't push up
 * the same day we pulled down. Calls applyAdaptations with the
 * mark_upgrade action so all mutations + intent logging go through
 * one canonical path.
 *
 * Returns the upgrade summary or null.
 */
export async function tryAdaptiveBump(
  userId: string,
  pullbackApplied: boolean,
): Promise<{ bumps: number; longBumpMi: number; weeklyBumpMi: number; why: string } | null> {
  if (pullbackApplied) return null;
  const action = await actionForAdaptiveRamp(userId);
  if (!action) return null;
  const { applyAdaptations } = await import('./adapt');
  await applyAdaptations(userId, [{
    kind: 'mark_upgrade',
    bumps: action.bumps,
    why: action.why,
  }]);
  return {
    bumps: action.bumps.length,
    longBumpMi: action.longBumpMi,
    weeklyBumpMi: action.weeklyBumpMi,
    why: action.why,
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
