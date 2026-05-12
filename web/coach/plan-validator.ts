/**
 * Plan validator — runs declarative integrity checks against the
 * engine's generated week-shape and surfaces issues for the runner.
 *
 * Pure module — no DB, no Postgres, no fetch. Takes the engine's
 * already-computed plan + state, returns an array of issues.
 *
 * Rules covered (each cites Research/):
 *   1. Max consecutive non-rest days by tier (Research/00b)
 *   2. Hard-easy alternation (Research/00a / 00b)
 *   3. Long-run single-session spike (Research/00a §13.1)
 *   4. Easy-share polarized ratio drift (Research/00a §Polarized)
 *
 * The engine's `enforceWeekStreakCap` already MAY prevent rule 1
 * from firing in practice — this validator runs as a second line of
 * defense, surfacing any rules that slipped through OR aren't enforced
 * by the engine. Empty array = clean plan.
 */

import type { CoachState } from '../lib/coach-state';
import type { CoachToday } from '../lib/coach-engine';
import { SINGLE_SESSION_SPIKE } from './doctrine/load';

export type PlanIssueSeverity = 'error' | 'warn' | 'info';

export interface PlanIssue {
  /** Stable rule key. Used for grouping + UI styling. */
  rule:
    | 'consecutive_non_rest_days'
    | 'hard_easy_alternation'
    | 'long_run_spike'
    | 'easy_share_drift';
  severity: PlanIssueSeverity;
  /** Human-readable explanation including the offending number(s). */
  message: string;
  /** Where in the plan this fired — date range, day index, week. */
  location: string;
  /** Research doc that motivates the rule. */
  citation: string;
}

/** Tier cap per Research/00b §Recovery Scaled to Weekly Mileage.
 *  Match the same thresholds the engine's enforceWeekStreakCap uses. */
function tierCap(weeklyAvg4w: number): number {
  if (weeklyAvg4w < 40) return 5;
  if (weeklyAvg4w < 80) return 6;
  return 7;
}

export function validatePlan(
  plan: { weekShape: CoachToday['weekShape'] },
  state: CoachState,
): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const days = plan.weekShape;

  // ── Rule 1: max consecutive non-rest days ─────────────────────
  const cap = tierCap(state.volume.weeklyAvg4w);
  let streak = 0;
  let streakStartIdx = 0;
  for (let i = 0; i < days.length; i++) {
    if (days[i].type === 'rest') { streak = 0; continue; }
    if (streak === 0) streakStartIdx = i;
    streak += 1;
    if (streak > cap) {
      issues.push({
        rule: 'consecutive_non_rest_days',
        severity: 'error',
        message: `${streak} consecutive non-rest days exceeds the ${cap}-day cap for runners at ${state.volume.weeklyAvg4w.toFixed(0)} mi/wk.`,
        location: `${days[streakStartIdx].date} → ${days[i].date}`,
        citation: 'Research/00b §Recovery Scaled to Weekly Mileage',
      });
      streak = -1000; // suppress until next rest
    }
  }

  // ── Rule 2: hard-easy alternation ─────────────────────────────
  // Two consecutive quality days violates the 24h-recovery rule.
  for (let i = 1; i < days.length; i++) {
    if (days[i].isQuality && days[i - 1].isQuality) {
      issues.push({
        rule: 'hard_easy_alternation',
        severity: 'error',
        message: `Quality on ${days[i].date} immediately follows quality on ${days[i - 1].date}. Hard-easy alternation requires ≥1 easy day between quality sessions.`,
        location: `${days[i - 1].date} → ${days[i].date}`,
        citation: 'Research/00a §Hard-Easy Alternation',
      });
    }
  }

  // ── Rule 3: long-run single-session spike ─────────────────────
  // Daniels' rule: long run ≤ 110% of training-only longest (last 28d).
  const longest28 = state.volume.longestLast28Mi;
  const ceilingPct = SINGLE_SESSION_SPIKE.value.ceilingPctAboveLongestRecent;
  const spikeRatio = 1 + ceilingPct / 100;
  const cap28 = longest28 > 0 ? longest28 * spikeRatio : Infinity;
  for (const d of days) {
    if (d.isLong && d.distanceMi > cap28) {
      issues.push({
        rule: 'long_run_spike',
        severity: 'error',
        message: `Long run on ${d.date} (${d.distanceMi.toFixed(1)} mi) exceeds the ${cap28.toFixed(1)}-mi cap (${(spikeRatio * 100).toFixed(0)}% of recent training longest ${longest28.toFixed(1)} mi). Connective-tissue injury risk.`,
        location: d.date,
        citation: 'Research/00a §13.1 Single-Session Spike',
      });
    }
  }

  // ── Rule 4: easy-share drift ──────────────────────────────────
  // Polarized 80/20 — easy share should sit ≥0.78 (78%).
  if (state.intensity.easyShare14d > 0 && state.intensity.easyShare14d < 0.75) {
    issues.push({
      rule: 'easy_share_drift',
      severity: 'warn',
      message: `Easy share is ${Math.round(state.intensity.easyShare14d * 100)}% over the last 14 days — below the 80% polarized target. More easy miles, fewer moderate ones.`,
      location: 'last 14 days',
      citation: 'Research/00a §Polarized 80/20',
    });
  }

  return issues;
}
