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

    /* ── THE SESSION-GEOMETRY KINDS · UNDOCOMPLETE-1 (2026-09-05) ─────────
     *
     * These five REFUSED, all five for one reason: the shape they replaced
     * lives in `workout_spec`, `sub_label` and the derived pace, and
     * `RowBefore` recorded none of the three. That refusal was honest and it
     * was the right answer to the wrong shape — so the shape changed.
     * `RowBefore` now carries the five columns a session's geometry actually
     * occupies, and the inverse restores them TOGETHER.
     *
     * TOGETHER is the whole point and the reason this is one arm and not five.
     * `applyProgressionReshape` writes spec, sub_label and pace from ONE
     * rendered shape precisely so the three cannot disagree; an undo that put
     * back the spec and left the chip is the "is it 5 or 4 miles" defect
     * running backwards. So `shapeRestore` demands the spec was recorded and
     * refuses the whole undo when it was not — Rule 11, and the same refusal
     * the four used to give unconditionally, now given only when it is true.
     *
     * A row written before this shape existed carries none of the five, reads
     * `undefined`, and refuses exactly as it did yesterday. Nothing about the
     * decisions already in production changes. */
    case 'DURATION_CHANGE':
    case 'REPETITION_CHANGE':
    case 'RECOVERY_INTERVAL_CHANGE':
    case 'QUALITY_DOSE_CHANGE':
      return shapeRestore(action.before, 'the session shape');

    /* The long run's structure is written as `sub_label` + `notes`
     * (`plannedWrites`), so its inverse is those two and NOT the spec: a
     * progressive-finish note does not re-author the prescription. Demanding a
     * spec here would refuse an undo that is genuinely complete without one. */
    case 'LONG_RUN_STRUCTURE_CHANGE':
      return fromFields(action.before, ['subLabel', 'notes'], 'the long run shape', (b) => ({
        sub_label: b.subLabel as string,
        notes: b.notes as string,
      }));

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

    /* Both write only `notes`. This refused because `RowBefore` did not record
     * notes, so the inverse would have BLANKED the sentence rather than
     * restoring it — a loss worth refusing over, and the refusal was correct
     * for as long as the field did not exist. It does now, and a row that
     * recorded no note still refuses by name. */
    case 'TAPER_CHANGE':
    case 'RECOVERY_CHANGE':
      return fromFields(action.before, ['notes'], 'the sentence it replaced',
        (b) => ({ notes: b.notes as string }));

    case 'CONDITIONAL':
      return { kind: 'nothing_to_undo', because: 'a conditional writes nothing until its assessment date' };

    /* A field test REPLACES the session — type, spec, sub_label and the
     * quality flag all move together — so its inverse is the whole shape plus
     * the type, and `shapeRestore` already demands every one of them. */
    case 'FIELD_TEST':
      return shapeRestore(action.before, 'the session a field test replaced', { withType: true });

    case 'HOLD':
    case 'REFUSAL':
      return { kind: 'nothing_to_undo', because: action.because };

    /* DURATIONOFFER-1 · nothing was ever written (RECORD_ONLY executor), so
     * there is nothing for an undo to put back. */
    case 'DURATION_PROGRESS_OFFER':
      return { kind: 'nothing_to_undo', because: 'this was an offer, not an applied change; accepting it wrote no session geometry' };

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

/**
 * THE SESSION'S GEOMETRY, PUT BACK WHOLE.
 *
 * Five columns, restored together or not at all. Partial is not an option and
 * that is the design rather than caution: `workout_spec`, `sub_label` and
 * `pace_target_s_per_mi` are three renderings of ONE shape, and a row where
 * they disagree is the defect the spec rebuild was written to end. Distance and
 * duration ride with them because a dose change moves both.
 *
 * The SPEC is the field this insists on. A proposal that recorded a sub_label
 * and no spec would restore the chip onto a prescription it no longer
 * describes, which is worse than refusing, so the refusal names the spec.
 */
function shapeRestore(
  before: readonly RowBefore[],
  human: string,
  opts: { readonly withType?: boolean } = {},
): UndoPlan {
  const writes: PlannedWrite[] = [];
  for (const b of before) {
    if (b.workoutSpec === undefined) {
      return notUndoable(
        `the proposal did not record ${human} it replaced, and putting back only the sentence `
        + 'would leave the label disagreeing with the prescription',
      );
    }
    if (opts.withType === true && b.type === undefined) {
      return notUndoable(`the proposal did not record the session type ${human} replaced`);
    }
    const set: RowWrite['set'] = {
      workout_spec: b.workoutSpec,
      ...(opts.withType === true ? { type: b.type as string } : {}),
      ...(b.subLabel === undefined ? {} : { sub_label: b.subLabel as string }),
      ...(b.notes === undefined ? {} : { notes: b.notes as string }),
      ...(b.paceTargetSecPerMi === undefined ? {} : { pace_target_s_per_mi: b.paceTargetSecPerMi }),
      ...(b.distanceMi === undefined ? {} : { distance_mi: b.distanceMi }),
      ...(b.durationMin === undefined ? {} : { duration_min: b.durationMin }),
      ...(b.isQuality === undefined || b.isQuality === null ? {} : { is_quality: b.isQuality }),
    };
    writes.push({ op: 'update', planWorkoutId: b.planWorkoutId, set });
  }
  return reverse(writes);
}

/**
 * Several recorded fields per row, restored together, or a refusal naming the
 * first one that was never recorded.
 *
 * The plural sibling of `fromField` below. Separate rather than folded into it
 * because the singular case reads better at its four call sites and because a
 * one-field restore has no "together" property to defend.
 */
function fromFields(
  before: readonly RowBefore[],
  fields: readonly (keyof RowBefore)[],
  human: string,
  set: (b: RowBefore) => RowWrite['set'],
): UndoPlan {
  const writes: PlannedWrite[] = [];
  for (const b of before) {
    for (const f of fields) {
      if (b[f] === undefined) {
        return notUndoable(`the proposal did not record ${human} (${String(f)} was not stored)`);
      }
    }
    writes.push({ op: 'update', planWorkoutId: b.planWorkoutId, set: set(b) });
  }
  return reverse(writes);
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
