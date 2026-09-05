/**
 * lib/brain/proposal/undo.ts · PUTTING ONE ACCEPTED ACTION BACK.
 *
 * ── WHY THIS EXISTS BESIDE `/api/plan/undo` ────────────────────────────────
 *
 * That route undoes a REBUILD, wholesale, by un-archiving the previous block.
 * Its own header explains why wholesale is the right answer there: the runner
 * noticed because his week counter reset, and block identity is what he reads
 * his training through.
 *
 * An accepted proposal is the opposite case. One session moved, one distance
 * changed, and un-archiving the block would throw away every other thing that
 * has happened since. So the undo of an action is the INVERSE OF THAT ACTION,
 * and the only place the pre-change state exists is the `before` the proposal
 * recorded when it was raised — which is the second job that field does, and
 * the reason it carries values rather than only ids.
 *
 * ── THREE ANSWERS, NOT TWO (Rule 11) ───────────────────────────────────────
 *
 * `reverse`          the inverse writes, ready to apply.
 * `nothing_to_undo`  the action changed nothing, so there is nothing to put
 *                    back. A HOLD is the case: it is a decision, it is
 *                    recorded, and undoing it is not a plan write.
 * `not_undoable`     the action DID change something and this cannot reverse
 *                    it, with the reason. Never collapsed into the one above:
 *                    "nothing happened" and "something happened and you are
 *                    stuck with it" are opposite facts, and a card that offers
 *                    Undo on the second is lying.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 * · WHETHER THE UNDO IS SAFE TO APPLY NOW. It is pure. It does not know what
 *   the plan currently holds, so an undo computed here still goes through
 *   `staleAgainst` and the mutation boundary's validator before it lands —
 *   putting a session back onto a day that now holds a race would be caught
 *   there and not here.
 * · SIDE EFFECTS OF THE ORIGINAL ACCEPT. Reversing the column write does not
 *   un-send a push notification, un-write a `coach_intents` row, or un-derive
 *   a `workout_spec` that a downstream re-derivation rebuilt. Those are the
 *   accept path's own business and this file has no reach into them.
 * · A `before` THAT WAS NEVER RECORDED. Then it answers `not_undoable` and says
 *   so, which is correct and is also the reason most legacy rows cannot be
 *   undone: they recorded a date and nothing else.
 */

import type { BrainAction, RowBefore } from './action';
import type { PlannedWrite, RowWrite } from './execute';

export type UndoPlan =
  | { readonly kind: 'reverse'; readonly writes: readonly PlannedWrite[] }
  | { readonly kind: 'nothing_to_undo'; readonly because: string }
  | { readonly kind: 'not_undoable'; readonly because: string };

/**
 * The inverse of an action, from the state it recorded before it was applied.
 *
 * TOTAL over the union. A kind added without an undo posture fails the build
 * here, which is the point: "can the runner take this back" is a question every
 * lever owes an answer to, and the answer is allowed to be no as long as it is
 * SAID.
 */
export function undoWritesFor(action: BrainAction): UndoPlan {
  switch (action.kind) {
    case 'PACE_CHANGE':
    case 'RACE_TARGET_CHANGE': {
      const w: PlannedWrite[] = [];
      for (const b of action.before) {
        if (b.paceTargetSecPerMi === undefined) {
          return notUndoable('the proposal did not record the pace it changed from');
        }
        w.push({ op: 'update', planWorkoutId: b.planWorkoutId, set: { pace_target_s_per_mi: b.paceTargetSecPerMi } });
      }
      return reverse(w);
    }

    case 'DISTANCE_CHANGE': {
      if (action.to === null) {
        return { kind: 'nothing_to_undo', because: 'no distance was written, so none has to be put back' };
      }
      return fromField(action.before, 'distanceMi', 'distance',
        (b) => ({ distance_mi: b.distanceMi as number | null }));
    }

    case 'WORKOUT_TYPE_CHANGE':
      return fromField(action.before, 'type', 'type', (b) => ({ type: b.type as string }));

    case 'RESCHEDULE':
      return fromField(action.before, 'dateISO', 'date', (b) => ({ date_iso: b.dateISO as string }));

    /* The session's geometry lives in `workout_spec`, `sub_label` and the
     * derived pace, and `RowBefore` records none of the three. Reversing the
     * `notes` half alone would leave a row whose sentence disagrees with its
     * prescription, which is worse than a plain refusal — so this says no, and
     * names the field that would have to be recorded for it to say yes. */
    case 'DURATION_CHANGE':
    case 'REPETITION_CHANGE':
    case 'RECOVERY_INTERVAL_CHANGE':
    case 'QUALITY_DOSE_CHANGE':
    case 'LONG_RUN_STRUCTURE_CHANGE':
      return notUndoable(
        'the session shape it replaced was not recorded on the proposal, and putting back only the '
        + 'sentence would leave the label disagreeing with the prescription',
      );

    /* A row this engine inserted has no id until it exists, and `before` is
     * empty by construction. The accept path knows the id it wrote; a pure
     * function reading the action does not. */
    case 'ADD_WORKOUT':
      return notUndoable('the added session has no id until it is written, so a pure inverse cannot name it');

    /* Symmetrical and equally honest: `before` records the day and, when the
     * trigger read it, the type and distance. That is enough to put a deleted
     * ordinary session back, and not enough to restore its quality spec. */
    case 'REMOVE_WORKOUT': {
      const w: PlannedWrite[] = [];
      for (const b of action.before) {
        if (b.dateISO === undefined || b.type === undefined) {
          return notUndoable('the removed session recorded no day and type to restore it from');
        }
        if (b.distanceMi === undefined || b.distanceMi === null) {
          return notUndoable('the removed session recorded no distance to restore it at');
        }
        w.push({ op: 'insert', dateISO: b.dateISO, type: b.type, distanceMi: b.distanceMi });
      }
      return reverse(w);
    }

    case 'FREQUENCY_CHANGE':
      return notUndoable(
        'a frequency change is realised as adds and removes, and the inverse of each is the entry '
        + 'above it rather than a single write',
      );

    /* Whole or not at all, both ways. One part that cannot be reversed makes
     * the decision irreversible, because a half-undone coordinated change is a
     * plan whose paces disagree with each other. */
    case 'COORDINATED': {
      const w: PlannedWrite[] = [];
      for (const part of action.parts) {
        const p = undoWritesFor(part);
        if (p.kind === 'not_undoable') {
          return notUndoable(`one part of this change cannot be reversed: ${p.because}`);
        }
        if (p.kind === 'reverse') w.push(...p.writes);
      }
      return w.length === 0
        ? { kind: 'nothing_to_undo', because: 'no part of this change wrote to the plan' }
        : reverse(w);
    }

    /* Both write only `notes`, so both reverse cleanly — provided the runner's
     * own note is not what gets clobbered. `before` does not record `notes`, so
     * the inverse restores the empty string rather than what was there, and
     * that is a loss worth refusing over. */
    case 'TAPER_CHANGE':
    case 'RECOVERY_CHANGE':
      return notUndoable(
        'the sentence this replaced was not recorded, so reversing it would blank the note rather '
        + 'than restore it',
      );

    case 'CONDITIONAL':
      return { kind: 'nothing_to_undo', because: 'a conditional writes nothing until its assessment date' };

    case 'FIELD_TEST':
      return notUndoable(
        'a field test rewrites the session it replaces and the proposal did not record that shape',
      );

    case 'HOLD':
    case 'REFUSAL':
      return { kind: 'nothing_to_undo', because: action.because };

    /* Deliberately not undoable, and this is the one entry where that is a
     * SAFETY property rather than a data limitation. A stop is lifted by the
     * signal that raised it clearing, never by a button that puts the training
     * back. Making this reversible would give the runner an Undo that
     * overrides safety, which is the one thing the whole boundary exists to
     * make impossible. */
    case 'SAFETY_STOP':
      return notUndoable(
        'a stop is lifted when the signal that raised it clears, not by undoing it',
      );

    default: {
      const never: never = action;
      throw new Error(`no undo posture for ${JSON.stringify(never)}`);
    }
  }
}

function reverse(writes: readonly PlannedWrite[]): UndoPlan {
  return writes.length === 0
    ? { kind: 'nothing_to_undo', because: 'the action produced no writes to reverse' }
    : { kind: 'reverse', writes };
}

function notUndoable(because: string): UndoPlan {
  return { kind: 'not_undoable', because };
}

/** One recorded field per row, restored, or a refusal naming the missing field. */
function fromField(
  before: readonly RowBefore[],
  field: keyof RowBefore,
  human: string,
  set: (b: RowBefore) => RowWrite['set'],
): UndoPlan {
  const writes: PlannedWrite[] = [];
  for (const b of before) {
    if (b[field] === undefined) {
      return notUndoable(`the proposal did not record the ${human} it changed from`);
    }
    writes.push({ op: 'update', planWorkoutId: b.planWorkoutId, set: set(b) });
  }
  return reverse(writes);
}
