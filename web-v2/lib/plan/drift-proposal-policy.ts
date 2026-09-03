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

/**
 * ── 2026-09-02 · THE SOFT-DRIFT WRITER IS GONE ──────────────────────────
 *
 * `app/api/cron/plan-drift/route.ts` no longer writes a proposal for any
 * drift kind. Soft drift and the goal-gap widening trend are TRANSIENT
 * READINGS, and the owner's ruling removed their authority to re-phase a
 * block: "too many independent levers can soften, reshape, re-phase,
 * refuse, or automatically mutate the plan."
 *
 * `SOFT_DRIFT_PROPOSAL_KINDS` and `driftProposalKind` therefore describe
 * something that no longer happens. They are kept, not deleted, for one
 * reason and it is not sentiment: `RETIRED_REBUILD_PROPOSAL_KINDS` below is
 * derived from them, and that list is what stops a `plan_proposals` row
 * written BEFORE the seal — a pending card still sitting in the runner's
 * account tonight — from re-authoring his block when he taps it. The set
 * has to stay accurate for that refusal to be complete.
 *
 * `suppressDriftNearRace` is NOT retired: `lib/plan/replan-scenarios.ts`
 * and `app/api/race/route.ts` both still call it on runner-initiated paths.
 */

/** Every kind the nightly soft-drift writer COULD stamp on a proposal row,
 *  before the writer was deleted. Covered detectDrift's emit set minus
 *  goal_gap_widening (which had its own dedupe in the cron's goal-gap
 *  block). Now read only as the retired-kinds source below. */
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

/**
 * Proposal kinds whose ACCEPT used to re-author the runner's block off a
 * transient reading, and that nothing writes any more.
 *
 * This is the other half of the 2026-09-02 seal, and without it the seal
 * leaks. Deleting the writer stops NEW cards; it does nothing about a
 * `plan_proposals` row already sitting at `status = 'pending'` in a live
 * account. `POST /api/plan/proposal` resolves the underlying race and calls
 * `generatePlan` for any kind it does not special-case, so a stale
 * `long_drift` card from last week would still rebuild his block tonight —
 * the exact lever the ruling removed, arriving one tap late.
 *
 * A retired kind is REFUSED on accept and left visible. Not silently
 * dismissed: the runner tapped a button and is owed an answer, and an
 * operator reading the table is owed the row.
 *
 * Ratchet, in the honest direction: a kind may be ADDED here when its
 * writer is deleted, and may only be REMOVED when the kind itself is gone
 * from `AutoRebuildKind`. If a future change re-introduces a writer for one
 * of these, that writer has to take the kind off this list, which is a
 * visible act rather than an omission.
 */
export const RETIRED_REBUILD_PROPOSAL_KINDS: ReadonlySet<string> =
  new Set<string>([...SOFT_DRIFT_PROPOSAL_KINDS, 'goal_gap_widening']);

/** Is this a proposal kind whose rebuild authority was retired? */
export function isRetiredRebuildProposalKind(kind: string | null | undefined): boolean {
  return kind != null && RETIRED_REBUILD_PROPOSAL_KINDS.has(kind);
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
