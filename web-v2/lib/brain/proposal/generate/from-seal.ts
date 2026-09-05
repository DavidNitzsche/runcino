/**
 * lib/brain/proposal/generate/from-seal.ts · A REFUSAL IS A DECISION.
 *
 * ── WHAT THE SEAM CURRENTLY RECORDS, AND WHAT IT LOSES ─────────────────────
 *
 * `sealAutomaticActions` refuses every plan-mutating action an unattended job
 * produces while `AUTOMATIC_ADAPTATION_AUTHORITY` is false, and converts each
 * to an observational note carrying `{ sealed_kind: 'reshape' }`. That is a
 * deliberate improvement on dropping it — the seam's own comment says a
 * dropped judgement and a dropped read become the same nothing (Rule 11).
 *
 * What it still loses is DIRECTION. A refused upward step and a refused
 * pull-back land in `coach_intents` as the same shape, so the engine's own
 * record cannot answer "what has the seam been stopping". Rule 21's measurement
 * — 309 intents, zero upward — is exactly that question, and it had to be
 * answered sideways because nothing recorded the axis.
 *
 * This turns the refusal into a REFUSAL: a first-class member of the action
 * union, with a direction, a reason, and the rows it would have touched. It
 * changes no behaviour. The action is recorded beside the note, not instead of
 * it, and nothing about what the seam permits moves.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 * · WHETHER THE SEAM IS RIGHT TO REFUSE. That is the owner's product decision
 *   and `AUTOMATIC_ADAPTATION_AUTHORITY` is its only expression.
 * · THE DIRECTION OF THE THING REFUSED, when the underlying action does not
 *   say. A `mark_dirty` has no direction and the refusal reads NEUTRAL, which
 *   is honest and is also why the census of refusals is a weaker instrument
 *   than the census of applied changes.
 * · WHETHER ANYTHING READS IT. The note it rides on is read by
 *   `adaptation-info`; the action is read by the completeness gate and by
 *   whatever consumes the intent row next.
 */

import type { AdaptationAction } from '@/lib/plan/adapt';
import type { BrainAction, RowBefore } from '../action';
import { ACTION_SCHEMA_VERSION } from '../action';

/**
 * The refusal the seam just made, as an action.
 *
 * `because` names the mechanism rather than the mood: a refusal that says
 * "sealed" teaches the next reader nothing, and `lib/brain/objective.ts`
 * requires a decline to state a fact.
 */
export function refusalFromSeal(action: AdaptationAction): BrainAction {
  const before: readonly RowBefore[] = (action.workoutIds ?? [])
    .map((planWorkoutId) => ({ planWorkoutId }));

  return {
    schemaVersion: ACTION_SCHEMA_VERSION,
    kind: 'REFUSAL',
    /* A refusal changes nothing, whatever it refused. The direction of the
     * REFUSED action is a different quantity and belongs in the reason, not in
     * this field — labelling a refused push as MORE would put it in the count
     * of pushes the plan actually received. */
    direction: 'NEUTRAL',
    before,
    /* The MECHANISM, not the trigger's prose. `noteValue.sealed_why` already
     * carries the reason verbatim beside this action, so repeating it here
     * would record one sentence twice (Rule 17), and a trigger reason is
     * unbounded coach prose that `validateAction` refuses past the card
     * length. */
    because:
      `automatic coaching adaptation is sealed, so the engine may not apply a ${action.kind}`,
  };
}

/**
 * The engine deciding to leave something alone, as an action.
 *
 * Separate from `refusalFromSeal` because a HOLD and a REFUSAL are different
 * facts and the ledger keeps them apart: a hold is "the evidence does not
 * justify moving yet", a refusal is "I was not permitted to move". Collapsing
 * them would put an authority decision into the coaching census.
 */
export function holdFor(
  because: string,
  workoutIds: readonly string[] = [],
): BrainAction {
  return {
    schemaVersion: ACTION_SCHEMA_VERSION,
    kind: 'HOLD',
    direction: 'NEUTRAL',
    before: workoutIds.map((planWorkoutId) => ({ planWorkoutId })),
    because,
  };
}
