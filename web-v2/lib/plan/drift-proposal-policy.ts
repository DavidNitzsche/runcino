/**
 * lib/plan/drift-proposal-policy.ts · pure policy for the nightly
 * plan-drift cron's proposal writer. No pg, unit-testable.
 *
 * 2026-08-17 · proposal-spam killer. The verified failure chain:
 *
 *   1. cron's staleness/drift block fired fireAutoRebuild with a
 *      synthetic kind 'goal_time_changed'
 *   2. generatePlan refused inside 14 days of the race ("target < 2
 *      weeks away") → the failure wrote a status='pending' row
 *   3. the next day's dedupe checked kinds volume_drift / vdot_drift /
 *      staleness, which never matched the written kind → a duplicate
 *      pending row every day (19 found on one runner), each rendered
 *      as "Goal time updated" for what was a staleness observation.
 *
 * Three policy pieces close it:
 *
 *   · driftProposalKind — the writer stamps the signal's TRUE kind on
 *     the row ('staleness' → 'staleness'). 'goal_time_changed' is
 *     reserved for actual goal edits.
 *   · SOFT_DRIFT_PROPOSAL_KINDS — the exact kind set the soft-drift
 *     writer can produce · the dedupe guard iterates THIS list, so
 *     guard and writer agree by construction.
 *   · suppressDriftNearRace — staleness/drift rebuild proposals are
 *     suppressed entirely when the target race is within 14 days.
 *     The generator refuses to build inside that window anyway
 *     (generate.ts: 'target < 2 weeks away'), so the surface must
 *     not ask. Race week is briefing territory, not rebuild territory.
 */

import type { DriftKind } from './drift-monitor';
import type { AutoRebuildKind } from './auto-rebuild';

/** Every kind the nightly soft-drift writer can stamp on a proposal
 *  row. Must cover detectDrift's emit set minus goal_gap_widening
 *  (which has its own dedupe in the cron's goal-gap block). */
export const SOFT_DRIFT_PROPOSAL_KINDS = [
  'volume_drift',
  'vdot_drift',
  'staleness',
  'easy_drift',
  'long_drift',
  'quality_drift',
] as const satisfies readonly DriftKind[];

/** Drift signals write their TRUE kind. Identity by design — the
 *  compile-time constraint (DriftKind is assignable to
 *  AutoRebuildKind) plus the tests lock the honesty. */
export function driftProposalKind(kind: DriftKind): AutoRebuildKind {
  return kind;
}

/** Days from todayISO to raceDateISO (negative when past). */
export function daysToRace(raceDateISO: string, todayISO: string): number {
  return Math.round(
    (Date.parse(raceDateISO.slice(0, 10) + 'T12:00:00Z')
      - Date.parse(todayISO.slice(0, 10) + 'T12:00:00Z')) / 86400000,
  );
}

/**
 * True when staleness/drift rebuild proposals must be suppressed
 * because the target race is within 14 days (inclusive of race day).
 * Mirrors generatePlan's own refusal boundary (totalDays < 14 →
 * 'target < 2 weeks away; use race-week briefing only').
 *
 * A race already in the past does NOT suppress — the graduate path
 * owns that state and drift monitoring of a dead plan is moot anyway.
 */
export function suppressDriftNearRace(
  raceDateISO: string | null | undefined,
  todayISO: string,
): boolean {
  if (!raceDateISO || !todayISO) return false;
  const d = daysToRace(raceDateISO, todayISO);
  return d >= 0 && d < 14;
}
