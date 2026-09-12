/**
 * lib/brain/proposal/decline-facet.ts · WHAT "NO" MEANS, PER KIND.
 *
 * ── THE HOLE THIS FILLS ────────────────────────────────────────────────────
 *
 * Accept had a total map, an executor per kind, a ledger classification and a
 * watch effect. DECLINE had `UPDATE plan_workout_proposals SET status =
 * 'dismissed'` and nothing else — one statement for twenty-one kinds.
 *
 * That is not a small asymmetry. It is Rule 22's asymmetry pointed at the
 * runner's own answer: the engine's yes is modelled to eleven facets and the
 * runner's no is a status word. Three specific things went wrong because of it:
 *
 *   1 · A SAFETY_STOP could be dismissed. The route asks no question and no
 *       kind, so tapping "Leave it" on a withhold marked it answered. A stop
 *       lifts when the SIGNAL clears — never because a card was cleared — and
 *       `undo.ts` and `executor-map.ts` both say so in their own arms. The one
 *       path that could actually act on the runner's tap did not.
 *   2 · A DECLINED PUSH WAS INVISIBLE. Rule 21 measures "309 intents, zero
 *       upward" and could not tell "never proposed" from "proposed and
 *       declined". The propose lane exists now; without a modelled decline the
 *       census still cannot separate them.
 *   3 · A HOLD OR A CONDITIONAL HAS NOTHING TO DECLINE. Both were shown with
 *       the same two buttons as a change, so the runner was asked to answer a
 *       question nobody had asked him.
 *
 * ── WHAT THIS FILE OWNS AND WHAT IT DOES NOT ───────────────────────────────
 *
 * It owns the CLASSIFICATION: what the runner's no means for this kind, and
 * whether the card may be answered no at all. It does NOT own the write — the
 * dismiss route does — and it does NOT own the ledger row, which is
 * `ledger-facet.ts`'s classification and the mutation boundary's write.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 * · WHETHER THE RUNNER WAS RIGHT TO DECLINE. It never second-guesses him. The
 *   one refusal below is not about his judgement, it is about a card that was
 *   never a question.
 * · WHETHER THE DECLINE IS RECORDED. It classifies; the route writes. A route
 *   that ignores this file leaves every kind dismissable exactly as before,
 *   and only `_action_completeness.test.ts`'s DECLINE scan would notice.
 * · WHAT THE ENGINE DOES NEXT TIME. `reraise` says whether re-raising the same
 *   decision tomorrow would be honest; nothing here suppresses anything, and
 *   the detection passes do not read it yet. It is a stated posture, and per
 *   Rule 20 that means it is documentation until a detector consults it.
 * · A DECLINE THE RUNNER NEVER MADE. An expiry is not a decline and does not
 *   come through here; `expireStaleWorkoutProposals` owns that and the two
 *   must stay apart, because "he said no" and "it ran out of road" are
 *   opposite facts about the same row.
 */

import type { ActionKind, BrainAction } from './action';

export type DeclineKind =
  /** The plan stands as prescribed. The ordinary answer, and the ordinary no. */
  | 'KEEP_AS_PRESCRIBED'
  /** There was no change to refuse. Dismissing clears the card and nothing else. */
  | 'ACKNOWLEDGE_ONLY'
  /** May not be declined. The card is a notice, not a question. */
  | 'NOT_DECLINABLE';

export interface DeclineBehavior {
  readonly kind: DeclineKind;
  /** One clause the runner could read, and the route logs. Never empty. */
  readonly because: string;
  /**
   * May the engine raise this decision again tomorrow?
   *
   * `true` for anything whose evidence can move — the runner declining a shave
   * today does not make the same fatigue reading wrong tomorrow. `false` where
   * re-asking would be nagging about a judgement he has already given, which
   * is what a card the engine keeps re-raising after a no actually is.
   */
  readonly reraise: boolean;
}

/**
 * What declining this action means.
 *
 * TOTAL over the union. A kind added without a decline posture fails the build
 * here, which is the point: "what happens when he says no" is a question every
 * lever owes an answer to, and until this file existed twenty-one levers gave
 * one answer between them.
 */
export function declineBehaviorOf(action: BrainAction): DeclineBehavior {
  switch (action.kind) {
    /* ── the ordinary no · the prescription stands ────────────────────────── */
    case 'PACE_CHANGE':
    case 'DISTANCE_CHANGE':
    case 'DURATION_CHANGE':
    case 'DURATION_PROGRESS_OFFER':
    case 'REPETITION_CHANGE':
    case 'RECOVERY_INTERVAL_CHANGE':
    case 'QUALITY_DOSE_CHANGE':
    case 'LONG_RUN_STRUCTURE_CHANGE':
    case 'WORKOUT_TYPE_CHANGE':
    case 'ADD_WORKOUT':
    case 'REMOVE_WORKOUT':
    case 'FREQUENCY_CHANGE':
    case 'RESCHEDULE':
    case 'FIELD_TEST':
      return keep('the session stays exactly as it was prescribed');

    /* Whole or not at all, on the way down as on the way up. Declining one
     * part of a coordinated repricing would leave a block whose paces
     * disagree with each other, which is the state the single card exists to
     * prevent. */
    case 'COORDINATED':
      return keep('the whole block keeps the paces it already has; a repricing is answered once');

    /* His stated goal is his. The coach may not renegotiate it and may not
     * re-raise a renegotiation he has refused — CLAUDE.md Rule 20 records what
     * that cost once, and the card that produced it had an accept action which
     * PATCHed a 3:00:00 goal down to 3:31:48. */
    case 'RACE_TARGET_CHANGE':
      return { kind: 'KEEP_AS_PRESCRIBED', reraise: false,
        because: 'the target you stated stands, and the coach does not ask again' };

    /* Both write a sentence and move nothing prescribed, so the no costs the
     * runner nothing and the evidence behind it can genuinely change. */
    case 'TAPER_CHANGE':
    case 'RECOVERY_CHANGE':
      return keep('the plan keeps the shape it has');

    /* ── nothing was asked, so there is nothing to refuse ─────────────────── */

    /* A hold and a refusal are RECORDS. The engine looked and left the plan
     * alone; there is no change for the runner to decline, and drawing two
     * buttons on one asks him to answer a question nobody put. Dismissing
     * clears the card. */
    case 'HOLD':
    case 'REFUSAL':
      return { kind: 'ACKNOWLEDGE_ONLY', reraise: true,
        because: 'nothing was going to change, so there is nothing to turn down' };

    /* A conditional has not decided yet. Declining it would answer a question
     * whose evidence does not exist, and the honest thing to show is what
     * would earn it — which is what `standingOf` already draws. */
    case 'CONDITIONAL':
      return { kind: 'ACKNOWLEDGE_ONLY', reraise: true,
        because: `nothing is prescribed until ${action.assessOnISO}, so there is nothing to answer yet` };

    /* ── the one refusal, and it is a SAFETY property ─────────────────────── */

    /* THE MIRROR OF `undo.ts`'s SAFETY_STOP ARM, AND THE SAME RULE.
     *
     * A stop lifts when the SIGNAL that raised it clears. A dismissable stop is
     * a button that overrides safety, which is the one thing the whole
     * authority boundary exists to make impossible — and it is worse than the
     * undo case, because Undo at least follows an accept the runner made,
     * while this would let a card be cleared before it was ever read.
     *
     * The card can still be got rid of: the safety owner clearing the signal
     * expires it. What cannot happen is the runner answering it no. */
    case 'SAFETY_STOP':
      return { kind: 'NOT_DECLINABLE', reraise: true,
        because: 'a stop lifts when the signal that raised it clears, not when the card is cleared' };

    default: {
      const never: never = action;
      throw new Error(`no decline posture for ${JSON.stringify(never)}`);
    }
  }
}

/** May a card carrying this kind be answered "no" at all? */
export function isDeclinable(kind: ActionKind): boolean {
  return kind !== 'SAFETY_STOP';
}

const keep = (because: string): DeclineBehavior =>
  ({ kind: 'KEEP_AS_PRESCRIBED', because, reraise: true });
