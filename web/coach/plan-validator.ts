/**
 * Plan validator — runs declarative integrity rules against the
 * engine's generated plan. Every rule is rooted in
 * coach/doctrine/plan_integrity.ts and returns a structured
 * PlanIssue when it fails.
 *
 * Why this file exists:
 *
 * The engine had implicit rules baked into imperative code. A
 * regression in any branch (a stage gate using the wrong end of a
 * range, a hardcoded magic dow, an aged-out flag not refreshed in
 * advanceState) silently produced a 7-day-easy stretch, a 26mi long
 * run, a 30-day-rest projection, or a Sat-hardcoded long for a
 * Sunday-runner. None of these failures surfaced until the runner
 * screenshotted the broken UI.
 *
 * Now: every rule from plan_integrity.ts is asserted here. Failures
 * land on the response as planIssues[]. UI banner surfaces errors.
 * Tests assert zero validator errors across a tier × phase × race
 * matrix. Engine refactors that break a rule fail in CI.
 *
 * Pure module — no DB, no Postgres, no fetch. Takes the engine's
 * already-computed plan + state, returns issues. Safe to run on
 * every coachDaily call (~5ms).
 */

import {
  MAX_CONSECUTIVE_NON_REST_DAYS_BY_TIER,
  MIN_WEEKLY_MILEAGE_FRAC_BY_PHASE,
  QUALITY_DAYS_PER_WEEK_BY_PHASE,
  LONG_RUN_SPIKE_MAX_RATIO,
  HARD_EASY_ALTERNATION_REQUIRED,
  mileageTier,
  type Cited,
} from './doctrine';
import type { CoachState } from '../lib/coach-state';
import type { CoachToday } from '../lib/coach-engine';

export type PlanIssueSeverity = 'error' | 'warn' | 'info';

export interface PlanIssue {
  /** Stable rule key. Used for grouping + UI styling. */
  rule:
    | 'consecutive_non_rest_days'
    | 'weekly_mileage_floor'
    | 'quality_cadence'
    | 'long_run_spike'
    | 'hard_easy_alternation'
    | 'long_run_day_preference'
    | 'post_race_quality_blackout';
  severity: PlanIssueSeverity;
  /** Human-readable explanation including the offending number(s). */
  message: string;
  /** Where in the plan this fired — date range, day index, week. */
  location: string;
  /** Doctrine source for the rule. Read off the rule's Cited<T>
   *  citation in plan_integrity.ts so the runner can trace why
   *  this constraint exists. */
  doctrineCitation: string;
}

function firstCitationStr<T>(c: Cited<T>): string {
  const cit = c.citations?.[0];
  if (!cit) return '';
  return `${cit.doc} ${cit.section}`;
}

/** Run every integrity rule against the engine's plan output.
 *  Returns a flat list of issues (empty array = clean plan). */
export function validatePlan(plan: {
  next30Days: CoachToday['next30Days'];
  buildCurve: CoachToday['buildCurve'];
  weekShape: CoachToday['weekShape'];
}, state: CoachState): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const tier = mileageTier(state.volume.weeklyAvg4w);

  // ── Rule 1: max consecutive non-rest days ─────────────────────
  const maxConsec = MAX_CONSECUTIVE_NON_REST_DAYS_BY_TIER.value[tier];
  let streak = 0;
  let streakStartIdx = 0;
  for (let i = 0; i < plan.next30Days.length; i++) {
    const day = plan.next30Days[i];
    const isRest = day.type === 'rest';
    if (isRest) {
      streak = 0;
    } else {
      if (streak === 0) streakStartIdx = i;
      streak += 1;
      if (streak > maxConsec) {
        issues.push({
          rule: 'consecutive_non_rest_days',
          severity: 'error',
          message: `${streak} consecutive non-rest days exceeds the ${maxConsec}-day cap for ${tier}-tier runners (${MAX_CONSECUTIVE_NON_REST_DAYS_BY_TIER.value.low}-${MAX_CONSECUTIVE_NON_REST_DAYS_BY_TIER.value.elite} by tier).`,
          location: `${plan.next30Days[streakStartIdx].date} → ${plan.next30Days[i].date}`,
          doctrineCitation: firstCitationStr(MAX_CONSECUTIVE_NON_REST_DAYS_BY_TIER),
        });
        // Don't continue accumulating beyond the first violation in
        // a single streak; let the streak reset rule fire when a rest
        // day actually appears. Otherwise we'd flag every day in a
        // 10-day stretch.
        streak = -1000;  // suppress until next rest day
      }
    }
  }

  // ── Rule 2: weekly mileage floor by phase ─────────────────────
  // Walk buildCurve weeks; flag any week where totalMi < frac × weeklyAvg4w.
  // Skip the first week if it's mid-recovery (POST_RACE phase) and
  // skip race-weeks (TAPER intentional drop).
  const baselineMi = state.volume.weeklyAvg4w;
  if (baselineMi >= 12 && plan.buildCurve.length > 0) {
    for (const wk of plan.buildCurve) {
      // Skip race weeks and post-race phase — taper/recovery
      // intentionally drop volume per doctrine.
      if (wk.isRaceWeek || wk.phase === 'POST_RACE' || wk.phase === 'TAPER') continue;
      const phaseFrac = MIN_WEEKLY_MILEAGE_FRAC_BY_PHASE.value[wk.phase];
      if (phaseFrac == null) continue;
      const minMi = baselineMi * phaseFrac;
      if (wk.totalMi < minMi) {
        issues.push({
          rule: 'weekly_mileage_floor',
          severity: 'warn',
          message: `Week of ${wk.weekStartISO} (${wk.phase}) projects ${wk.totalMi.toFixed(1)} mi — below the ${minMi.toFixed(1)}-mi floor (${(phaseFrac * 100).toFixed(0)}% of ${baselineMi}-mi weeklyAvg4w baseline). Detraining risk if it persists.`,
          location: `week ${wk.weekIndex} (${wk.weekStartISO})`,
          doctrineCitation: firstCitationStr(MIN_WEEKLY_MILEAGE_FRAC_BY_PHASE),
        });
      }
    }
  }

  // ── Rule 3: quality cadence per phase ─────────────────────────
  // Walk buildCurve; assert qualityCount within phase band.
  for (const wk of plan.buildCurve) {
    if (wk.isRaceWeek || wk.phase === 'POST_RACE') continue;  // skip recovery + race week
    const band = QUALITY_DAYS_PER_WEEK_BY_PHASE.value[wk.phase];
    if (!band) continue;
    if (wk.qualityCount < band.min) {
      issues.push({
        rule: 'quality_cadence',
        severity: 'warn',
        message: `Week of ${wk.weekStartISO} (${wk.phase}) has ${wk.qualityCount} quality session(s) — below the ${band.min}-${band.max} expected for this phase. No race-pace adaptation this week.`,
        location: `week ${wk.weekIndex} (${wk.weekStartISO})`,
        doctrineCitation: firstCitationStr(QUALITY_DAYS_PER_WEEK_BY_PHASE),
      });
    } else if (wk.qualityCount > band.max) {
      issues.push({
        rule: 'quality_cadence',
        severity: 'error',
        message: `Week of ${wk.weekStartISO} (${wk.phase}) has ${wk.qualityCount} quality session(s) — exceeds the ${band.min}-${band.max} cap. Injury/overtraining risk.`,
        location: `week ${wk.weekIndex} (${wk.weekStartISO})`,
        doctrineCitation: firstCitationStr(QUALITY_DAYS_PER_WEEK_BY_PHASE),
      });
    }
  }

  // ── Rule 4: long-run spike rule ──────────────────────────────
  // Validates that prescribed long runs across the projection don't
  // exceed 110% of state.volume.longestLast28Mi. State already
  // filters races out of longestLast28Mi (per the engine fix); this
  // is the second line of defense in case that filter regresses.
  const longestTraining = state.volume.longestLast28Mi;
  const ratio = LONG_RUN_SPIKE_MAX_RATIO.value.ratio;
  const cap = longestTraining > 0 ? longestTraining * ratio : Infinity;
  for (const day of plan.next30Days) {
    if (day.isLong && day.distanceMi > cap) {
      issues.push({
        rule: 'long_run_spike',
        severity: 'error',
        message: `Long run on ${day.date} (${day.distanceMi.toFixed(1)} mi) exceeds the ${cap.toFixed(1)}-mi spike cap (${(ratio * 100).toFixed(0)}% of training-only longest ${longestTraining.toFixed(1)} mi). Connective-tissue injury risk.`,
        location: day.date,
        doctrineCitation: firstCitationStr(LONG_RUN_SPIKE_MAX_RATIO),
      });
    }
  }

  // ── Rule 5: hard-easy alternation ────────────────────────────
  // Two consecutive quality days violates 24h-recovery doctrine.
  const minGap = HARD_EASY_ALTERNATION_REQUIRED.value.minEasyDaysBetweenQuality;
  for (let i = 1; i < plan.next30Days.length; i++) {
    const today = plan.next30Days[i];
    const prev = plan.next30Days[i - 1];
    if (today.isQuality && prev.isQuality) {
      issues.push({
        rule: 'hard_easy_alternation',
        severity: 'error',
        message: `Quality on ${today.date} immediately follows quality on ${prev.date}. Hard-easy alternation requires ≥${minGap} easy day between quality sessions.`,
        location: `${prev.date} → ${today.date}`,
        doctrineCitation: firstCitationStr(HARD_EASY_ALTERNATION_REQUIRED),
      });
    }
  }

  // ── Rule 6: long-run-day preference honored ──────────────────
  // When state.runner.longRunDow is set, every prescribed long-run
  // day in the projection should fall on that dow.
  const preferredLongDow = state.runner.longRunDow;
  if (preferredLongDow != null) {
    for (const day of plan.next30Days) {
      if (!day.isLong) continue;
      const d = new Date(day.date + 'T12:00:00Z');
      const actualDow = d.getUTCDay();
      if (actualDow !== preferredLongDow) {
        const dowName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        issues.push({
          rule: 'long_run_day_preference',
          severity: 'error',
          message: `Long run scheduled on ${dowName[actualDow]} (${day.date}) but runner prefers ${dowName[preferredLongDow]}. Engine ignored profile preference.`,
          location: day.date,
          doctrineCitation: 'internal · runner_profile.long_run_dow',
        });
        break;  // one error is enough — don't flood
      }
    }
  }

  // ── Rule 7: POST_RACE quality blackout ───────────────────────
  // No quality during the recovery window. recoveryWindowEndsISO
  // marks when POST_RACE phase ends.
  const recoveryEnd = state.recoveryWindowEndsISO;
  if (recoveryEnd) {
    for (const day of plan.next30Days) {
      if (day.date <= recoveryEnd && day.isQuality) {
        issues.push({
          rule: 'post_race_quality_blackout',
          severity: 'error',
          message: `Quality session on ${day.date} falls inside the post-race recovery window (closes ${recoveryEnd}). Doctrine: no quality work until window closes.`,
          location: day.date,
          doctrineCitation: 'Research/00b §Post-Race Recovery › Recovery by Distance',
        });
      }
    }
  }

  return issues;
}
