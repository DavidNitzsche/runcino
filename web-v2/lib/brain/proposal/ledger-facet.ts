/**
 * lib/brain/proposal/ledger-facet.ts · WHAT A DECISION IS ABOUT, FOR THE RECORD.
 *
 * ── THE ONE THING THIS DELIBERATELY DOES NOT SUPPLY ────────────────────────
 *
 * DIRECTION. `lib/brain/ledger/ledger-entry.ts` measures it from the plan
 * snapshots on either side of the write, and its header says exactly why:
 *
 *     "A caller that could label its own change would eventually label a
 *      downgrade 'adjustment', and the log would stop being evidence."
 *
 * A `direction` field here would be a caller labelling its own change. So this
 * answers the two questions the boundary CANNOT measure — what the decision was
 * ABOUT before anything moved, and what kind of decision it was — and leaves
 * direction to the rows.
 *
 * ── AND WHY `proposedLever` IS NOT CALLED `lever` (Rule 16) ────────────────
 *
 * `plan_decision_ledger.lever` is `leverOfDelta`, MEASURED. This is what the
 * action ASKED for, which is a different quantity: a QUALITY_DOSE_CHANGE that
 * the dosing guard refuses lands with a measured lever of RECORD_ONLY and a
 * proposed lever of SESSION_SHAPE, and those two facts together are the
 * interesting ones. Giving both the same name would make the ledger answer
 * "which lever" twice, differently, which is the collision that put three
 * different projected finishes on one runner's screen.
 *
 * This value therefore rides on `MutatePlanOptions.ledger.proposal` — the blob
 * that records the decision as raised — and never on the lever column.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 * · WHETHER THE ROW LANDS. `decision-ledger.ts` owns the write and has its own
 *   gate; this is the classification it is handed.
 * · WHETHER THE CLASSIFICATION IS THE RIGHT COACHING READ. PROGRESS vs HOLD is
 *   read off the action's declared direction, which is the same field Rule 21's
 *   census counts — so a mislabelled action is mislabelled consistently here
 *   and in the census, and neither would notice.
 * · SCOPE BEYOND ROW COUNT. `scopeOfChange` measures the real span from the
 *   rows; this says what the action MEANT to touch, which is why a COORDINATED
 *   naming no parts still reads PLAN.
 */

import type {
  LedgerDecision,
  LedgerScope,
  LedgerLever,
} from '@/lib/brain/ledger/ledger-entry';
import type { BrainAction } from './action';

export interface ActionLedgerFacet {
  /** What the decision was about, as raised. */
  readonly scope: LedgerScope;
  /** The lever the action ASKED for. Never the measured one — see the header. */
  readonly proposedLever: LedgerLever;
  /** Which of the ledger's eight decision words this action is. */
  readonly decision: LedgerDecision;
}

/**
 * Classify one action for the record.
 *
 * TOTAL over the union. A kind with no classification fails the build here,
 * because an unclassified decision is a row in the ledger that answers "what
 * happened" with a shrug — and the whole reason `plan_decision_ledger` exists
 * is that `training_plans.adaptation_log` stored `{"n": 1}` and could not tell
 * an engine that never pushed from a runner who never earned it.
 */
export function ledgerFacetsOf(action: BrainAction): ActionLedgerFacet {
  switch (action.kind) {
    case 'PACE_CHANGE':
      return { scope: 'WORKOUT', proposedLever: 'PACE', decision: decisionOf(action) };

    case 'RACE_TARGET_CHANGE':
      /* A race target reprices every session pointed at that race, so its scope
       * is the block even when the write lands on a handful of rows. */
      return { scope: 'PLAN', proposedLever: 'PACE', decision: decisionOf(action) };

    case 'DISTANCE_CHANGE':
    case 'DURATION_CHANGE':
      return { scope: 'WORKOUT', proposedLever: 'VOLUME', decision: decisionOf(action) };

    /* DURATIONOFFER-1 · the SAME classification as `DURATION_CHANGE` — this is
     * the identical decision (direction MORE, decisionOf → 'PROGRESS'), only
     * not yet applied. Classifying it as `proposedLever: 'RECORD_ONLY'` (HOLD's
     * convention) would UNDERSTATE it: HOLD's lever is 'RECORD_ONLY' because no
     * axis was decided on at all, whereas this row IS a real, evidenced VOLUME
     * decision — Rule 21's whole complaint is that a ledger cannot tell "never
     * proposed" from "proposed and not applied" apart, and collapsing this to
     * RECORD_ONLY would recreate exactly that ambiguity one level up. */
    case 'DURATION_PROGRESS_OFFER':
      return { scope: 'WORKOUT', proposedLever: 'VOLUME', decision: decisionOf(action) };

    case 'LONG_RUN_STRUCTURE_CHANGE':
      return { scope: 'WORKOUT', proposedLever: 'LONG_RUN', decision: decisionOf(action) };

    case 'REPETITION_CHANGE':
    case 'RECOVERY_INTERVAL_CHANGE':
    case 'QUALITY_DOSE_CHANGE':
    case 'WORKOUT_TYPE_CHANGE':
    case 'FIELD_TEST':
      return { scope: 'WORKOUT', proposedLever: 'SESSION_SHAPE', decision: decisionOf(action) };

    case 'RESCHEDULE':
      return { scope: 'WORKOUT', proposedLever: 'SCHEDULE', decision: decisionOf(action) };

    /* Adding or dropping a session changes the WEEK's shape, not one row's —
     * the week's day count and its rest pattern both move. */
    case 'ADD_WORKOUT':
    case 'REMOVE_WORKOUT':
    case 'FREQUENCY_CHANGE':
      return { scope: 'WEEK', proposedLever: 'VOLUME', decision: decisionOf(action) };

    case 'COORDINATED':
      return { scope: 'PLAN', proposedLever: 'PLAN_STRUCTURE', decision: decisionOf(action) };

    case 'TAPER_CHANGE':
    case 'RECOVERY_CHANGE':
      return { scope: 'PLAN', proposedLever: 'PLAN_STRUCTURE', decision: decisionOf(action) };

    /* A conditional has not decided yet, which is precisely DEFER, and its
     * scope is the week it will be re-taken against. */
    case 'CONDITIONAL':
      return { scope: 'WEEK', proposedLever: 'RECORD_ONLY', decision: 'DEFER' };

    case 'HOLD':
      return { scope: 'NONE', proposedLever: 'RECORD_ONLY', decision: 'HOLD' };

    case 'REFUSAL':
      return { scope: 'NONE', proposedLever: 'RECORD_ONLY', decision: 'REFUSE' };

    /* A stop is not a HOLD. A hold is "the evidence does not justify moving
     * yet"; a stop is "training is withheld". Recording both as HOLD would put
     * an injury into the same bucket as a quiet week, and Rule 8's corollary is
     * that a zero measured for opposite reasons is two facts. */
    case 'SAFETY_STOP':
      return { scope: 'PLAN', proposedLever: 'RECORD_ONLY', decision: 'REGRESS' };

    default: {
      const never: never = action;
      throw new Error(`no ledger classification for ${JSON.stringify(never)}`);
    }
  }
}

/**
 * PROGRESS, HOLD or REGRESS, from the action's own declared direction.
 *
 * This is a DECLARATION and it is allowed to be one, because it describes the
 * proposal rather than the outcome: the ledger's `direction` column is still
 * measured from the rows, and the two disagreeing is itself a finding a reader
 * can act on.
 */
function decisionOf(action: BrainAction): LedgerDecision {
  switch (action.direction) {
    case 'MORE': return 'PROGRESS';
    case 'LESS': return 'REGRESS';
    case 'STOP': return 'REGRESS';
    case 'NEUTRAL': return 'HOLD';
  }
}
