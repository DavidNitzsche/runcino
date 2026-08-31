/**
 * lib/plan/goal-immutability.ts · THE COACH PROJECTS. IT NEVER RENEGOTIATES.
 *
 * The owner's rule, app-wide, given in his own words and recorded in project
 * memory as [[feedback_no_forced_goal_decisions]]:
 *
 *   the coach PROJECTS, it never RENEGOTIATES a stated goal via a card or a
 *   button. A verdict is not a trigger.
 *
 * ── WHAT WENT WRONG ─────────────────────────────────────────────────────────
 *
 * The rule lived only in memory, so a cron violated it silently into the
 * owner's live account. `plan_proposals` row 57, status pending, source
 * `goal_gap_cron`, kind `goal_renegotiation`, written 2026-08-28:
 *
 *   "Evidence says 3:31:48. The 3:00:00 stays on the board as the season
 *    ambition. Recommended race target: 3:31:48, with 3:38:21 as the safe
 *    floor. Set the revised target to race off the fitness you have. The
 *    ambition carries to the next block."
 *
 *   accept_path: "PATCH /api/race/cim { goalSec, source: 'renegotiate' }"
 *
 * The second sentence is right. The violation is the imperative plus the
 * accept path: an instruction to lower the goal, wired to a button that
 * writes a new `goalSec`. Two web surfaces shipped that button
 * (TargetsView, the redesign SeasonClient) and the phone shipped the verb
 * ("SET THE REVISED TARGET").
 *
 * ── THE SEAM, DECLARED ONCE ─────────────────────────────────────────────────
 *
 * A goal is runner-stated state. Exactly two routes write it, and they may
 * only ever be reached because a human typed a number into a goal editor.
 * Nothing the coach composes — proposal, card, notification, brief — may
 * carry an action that lands on them.
 *
 * This module is data only. No imports, no database, so a `'use client'`
 * component can import it without dragging `pg` into the browser graph
 * (Rule 19). It is the single declaration `scripts/check-goal-immutability.sh`
 * reads at run time rather than hardcoding both sides of its own check.
 */

/** Routes that write a runner-stated goal, relative to `web-v2/`. */
export const GOAL_MUTATION_ROUTES = [
  'app/api/race/[slug]/route.ts',   // PATCH { goalSec } → races.plan.goal.finish_time_s
  'app/api/profile/goal/route.ts',  // POST  { goal_time } → profile.tt_goal_*
] as const;

/**
 * The ONLY `source` values a goal write may carry.
 *
 * Every one of them means a human typed the number. `'renegotiate'` was the
 * third value and it meant "a coach card's button sent this" — it is retired,
 * and the gate fails if it (or any other non-runner source) reappears in a
 * goal-mutation route.
 */
export const RUNNER_INITIATED_GOAL_SOURCES = ['manual', 'onboarding'] as const;

/** Retired goal-write sources. Present so the gate can name them by hand. */
export const RETIRED_GOAL_SOURCES = ['renegotiate'] as const;

/**
 * Proposal kinds that are NOTES, not decisions.
 *
 * An informational kind states what the evidence says and asks for nothing.
 * `POST /api/plan/proposal` refuses `accept` on these, no accept verb may be
 * declared for them on any surface, and the runner's only resolution is to
 * clear the note.
 */
export const INFORMATIONAL_PROPOSAL_KINDS = ['goal_outlook'] as const;

/**
 * Kinds no writer may stamp any more. Historical rows still exist and still
 * render — the owner has a standing `goal_renegotiation` row — so readers must
 * keep understanding them. Writers must not.
 */
export const RETIRED_PROPOSAL_KINDS = ['goal_renegotiation'] as const;

/**
 * Every kind the goal-outlook surface renders: the live informational kind
 * plus the retired one, so a standing row keeps forcing the status chip to
 * BEHIND and keeps rendering as a note rather than vanishing on deploy.
 */
export const GOAL_OUTLOOK_KINDS = [
  ...INFORMATIONAL_PROPOSAL_KINDS,
  ...RETIRED_PROPOSAL_KINDS,
] as const;

/** True for a row the goal-outlook surface owns (live or retired). */
export function isGoalOutlookKind(kind: string | null | undefined): boolean {
  return kind != null && (GOAL_OUTLOOK_KINDS as readonly string[]).includes(kind);
}

/** True when `accept` must be refused for this kind. */
export function isInformationalProposalKind(kind: string | null | undefined): boolean {
  // A retired renegotiation is informational too: its accept path is gone, and
  // the generic accept branch would rebuild a block the note never asked for.
  return isGoalOutlookKind(kind);
}
