/**
 * lib/faff/v5-decisions.ts · WHAT THE COACH DECIDED, AND WHAT BECAME OF IT.
 *
 * V5PROPOSALSURFACE-1 (2026-09-05).
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Rule 21: "a log that records that something happened but not what is not a
 * log", and establishing the zero it measures required querying `coach_intents`
 * sideways because nothing could answer "has this engine ever pushed me". The
 * runner is in the same position, one level up: seven proposals have been
 * raised against his plan in the life of the product and he has never seen a
 * single one, accepted, declined or expired.
 *
 * This is the read that answers it. It is a HISTORY, not a second inbox: every
 * row here is closed, or open and already drawn on Today, and nothing on this
 * surface has a button.
 *
 * ── TWO TABLES, ONE VOCABULARY ─────────────────────────────────────────────
 *
 * `plan_workout_proposals` holds per-session decisions and `plan_proposals`
 * holds block-level ones. They are genuinely different rows about genuinely
 * different things, but to the runner they are one list: things the coach
 * decided about his training. Rule 16 says one quantity one name, so their two
 * status vocabularies are mapped ONCE, here, onto `V5DecisionOutcome`.
 *
 * ── THE ONE PLACE THIS DOES NOT TRUST THE DATABASE ─────────────────────────
 *
 * A `pending` row whose workout date has already passed is reported as
 * `expired`, not as `pending`. That is Rule 10's recompute-at-read-time
 * posture, and it is here because of a specific production fact: expiry used
 * to run only when a phone opened a screen, so row 6 has been `pending` since
 * 2026-08-23 for a session on 2026-08-25. `lib/plan/proposal-expiry.ts` is
 * mounted on the nightly cron now and will close it, but a history surface
 * that shows a two-week-old past-dated question as OPEN is lying about the
 * state of the runner's plan, and it would keep lying for as long as any
 * unswept row survives anywhere. The stored status is not the authority on
 * whether a date has passed; the date is.
 */
import { PLAN_TITLES } from '@/lib/coach/decision-cards';
import { loadAllPlanProposals } from '@/lib/plan/proposals-state';
import { loadProposalHistory } from '@/lib/plan/workout-proposals';
import { directionOf, headlineFor, standingOf } from '@/lib/faff/v5-proposals';
import type { V5ProposalDirection } from '@/lib/faff/v5-today';

/**
 * What became of a decision. Every state the two tables can be in, plus the
 * one this file derives.
 *
 *   pending    · still open and still answerable.
 *   accepted   · the runner said yes. The change is in the plan.
 *   declined   · the runner said no. The plan is unchanged.
 *   deferred   · put off to a reassessment date the engine named.
 *   expired    · it aged out, or its day passed, without an answer.
 *   applied    · the engine applied it without asking. Lifecycle facts only:
 *                a race date passing, a block running out. Never an adaptation.
 *   superseded · a newer decision replaced it before it was answered.
 *   undone     · it was applied and then put back.
 */
export type V5DecisionOutcome =
  | 'pending' | 'accepted' | 'declined' | 'deferred'
  | 'expired' | 'applied' | 'superseded' | 'undone';

export interface V5DecisionWire {
  /** Unique across both tables: the table's letter and the row id. */
  id: string;
  /** The day the change lands or landed. Null for a block-level decision,
   *  which is about the whole plan and has no single day. */
  dateISO: string | null;
  /** When this was settled, or when it was raised while it is still open. */
  decidedISO: string;
  /** Null for a block-level decision: those are not a load verdict. */
  direction: V5ProposalDirection | null;
  outcome: V5DecisionOutcome;
  headline: string;
  why: string;
}

export type V5DecisionsRead =
  | { readonly ok: true; readonly decisions: V5DecisionWire[] }
  | { readonly ok: false; readonly error: Error };

/**
 * `plan_workout_proposals.status` to the shared vocabulary.
 *
 * `pastDated` is passed in rather than recomputed per row so one day boundary
 * governs the whole list. See the header for why a stored `pending` is not
 * believed over a date that has gone.
 */
function outcomeOfWorkoutRow(
  status: string,
  pastDated: boolean,
  deferred: boolean,
): V5DecisionOutcome {
  switch (status) {
    case 'accepted': return 'accepted';
    case 'dismissed': return 'declined';
    case 'expired': return 'expired';
    // An open row is not always a live question. `standingOf` reads the same
    // reassessment date the card does, so the history and Today cannot
    // disagree about whether the runner owes an answer (Rule 16).
    case 'pending': return pastDated ? 'expired' : (deferred ? 'deferred' : 'pending');
    // Rule 11: a status this mapping has not been taught is not "pending". It
    // is reported as expired, the reading that promises the runner nothing.
    default: return 'expired';
  }
}

/** `plan_proposals.status` to the shared vocabulary. */
function outcomeOfPlanRow(status: string): V5DecisionOutcome | null {
  switch (status) {
    case 'pending': return 'pending';
    case 'accepted': return 'accepted';
    case 'dismissed': return 'declined';
    case 'auto_applied': return 'applied';
    case 'superseded': return 'superseded';
    case 'expired': return 'expired';
    case 'undone': return 'undone';
    // `no_change` is the cron saying it looked and composed the same block.
    // Its own doc comment: "there is nothing to tell anyone." Not a decision.
    case 'no_change': return null;
    default: return null;
  }
}

/**
 * The runner's decision history, newest first, both lanes merged.
 *
 * Fails as a unit rather than silently serving half a history: a list missing
 * one of its two sources looks exactly like a runner who was never asked
 * anything, which is the fact this surface exists to disprove.
 */
export async function loadV5Decisions(
  userUuid: string,
  todayISO: string,
  limit = 40,
): Promise<V5DecisionsRead> {
  const perWorkout = await loadProposalHistory(userUuid, limit);
  if (!perWorkout.ok) return { ok: false, error: perWorkout.error };

  const out: V5DecisionWire[] = [];

  for (const r of perWorkout.rows) {
    const direction = directionOf(r.actionKind, r.actionPayload);
    // A row whose kind this app cannot describe still HAPPENED, so it is not
    // dropped from a history the way it is withheld from a card: an undrawable
    // direction is a missing word, not a missing decision.
    out.push({
      id: `w${r.id}`,
      dateISO: r.workoutDateISO,
      decidedISO: (r.resolvedAtISO ?? r.createdAt).slice(0, 10),
      direction,
      outcome: outcomeOfWorkoutRow(
        r.storedStatus,
        r.workoutDateISO < todayISO,
        standingOf(r, todayISO) === 'deferral',
      ),
      headline: direction == null ? 'A change to one session' : headlineFor(r),
      why: (r.reason ?? '').trim(),
    });
  }

  // Block-level rows go through the shared loader rather than a second query,
  // so this file cannot grow its own idea of what a plan proposal is. It
  // swallows its own read failure by design (it is listed in the swallowed-
  // failure registry), so an empty result here is not distinguishable from a
  // failure and this surface does not pretend otherwise: the per-workout lane
  // above is the one whose failure it reports.
  const planRows = await loadAllPlanProposals(userUuid, limit);
  for (const p of planRows) {
    const outcome = outcomeOfPlanRow(p.status);
    if (outcome == null) continue;
    out.push({
      id: `p${p.id}`,
      dateISO: null,
      decidedISO: (p.resolvedAt ?? p.createdAt).slice(0, 10),
      direction: null,
      outcome,
      headline: PLAN_TITLES[p.kind] ?? 'Your training plan changed',
      why: (p.message ?? '').trim(),
    });
  }

  out.sort((a, b) => (a.decidedISO < b.decidedISO ? 1 : a.decidedISO > b.decidedISO ? -1 : 0));
  return { ok: true, decisions: out.slice(0, limit) };
}

/** Exported for the gate: every outcome must be reachable from a real status. */
export const DECISION_OUTCOMES: readonly V5DecisionOutcome[] = [
  'pending', 'accepted', 'declined', 'deferred',
  'expired', 'applied', 'superseded', 'undone',
];

/** Exported so a test can walk every status without re-typing the two maps. */
export const _internals = { outcomeOfWorkoutRow, outcomeOfPlanRow };
