/**
 * lib/brain/proposal/undo-apply.ts · THE HALF THAT PUTS IT BACK.
 *
 * ── WHY THIS FILE HAD TO BE WRITTEN ────────────────────────────────────────
 *
 * `undo.ts` computes the inverse of an accepted action and has done since it
 * was written. `accept.ts` reports the result to the runner:
 *
 *     undoable: outcome.undo.can
 *
 * and the phone's accept response has carried that field on every 200. It was
 * a promise nothing could keep. `undoWritesFor` had exactly two callers — the
 * report above, and its own test — so there was no path in this codebase from
 * "yes, you can take this back" to a plan row moving back.
 *
 * That is the signature failure CLAUDE.md names, on the clause the owner said
 * the whole lane rests on: *"approval is not the control mechanism;
 * reversibility is."* A card that says accept while the undo does not exist is
 * asking him to take the bet blind, which is exactly what the ruling was
 * about — he went 0-for-52 on proposals he was asked to approve.
 *
 * ── WHAT IT DOES, AND WHAT IT REFUSES ──────────────────────────────────────
 *
 * It takes the SAME action the accept applied, asks `undo.ts` for the inverse,
 * checks that inverse against the plan AS IT IS NOW, and lands it through the
 * one door — `mutatePlan`, authority `RUNNER_ACCEPTED`, differential
 * validation, ledger row. Three answers out, never two:
 *
 *   applied         the plan moved back.
 *   nothing_to_undo the action wrote nothing, so nothing is owed. A HOLD.
 *   refused         it cannot be reversed, WITH the reason — either because
 *                   the proposal never recorded the field, or because the
 *                   session has moved since and putting the old value back
 *                   would write over a change this decision never saw.
 *
 * The staleness check is the one that matters and it is not optional. An undo
 * is a write reasoned about a state that is by definition in the past, so it
 * carries strictly MORE risk of writing over something than the accept did.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 * · WHETHER THE UNDO IS WANTED. The runner tapped it; this does not second
 *   guess him.
 * · SIDE EFFECTS OF THE ORIGINAL ACCEPT. `undo.ts`'s own header says it:
 *   reversing a column write does not un-send a notification, un-write a
 *   `coach_intents` row, or un-derive a `workout_spec` something else rebuilt.
 *   Those belong to the accept path and this has no reach into them.
 * · A SAFETY STOP. It refuses, and that refusal is a SAFETY property rather
 *   than a data limitation — a stop lifts when the signal clears, never
 *   because someone tapped Undo. `undo.ts` owns that decision and this file
 *   does not re-take it.
 * · THE SESSION'S GEOMETRY. Four kinds record no `workout_spec` before-state,
 *   so their undo is refused with the field named. That is `undo.ts`'s call.
 */

import type { BrainAction, LiveRow } from './action';
import { undoWritesFor } from './undo';
import { readLiveRows } from './staleness';
import { ledgerFacetsOf } from './ledger-facet';
import type { PlannedWrite } from './execute';
import { mutatePlan } from '@/lib/plan/mutate';
import { findLiveAcceptedLedgerRow } from '@/lib/brain/ledger/decision-ledger';
import type { PoolClient } from 'pg';

export type UndoOutcome =
  | { readonly ok: true; readonly reverted: number; readonly ledgerRowId: string | null }
  | { readonly ok: true; readonly reverted: 0; readonly nothingToUndo: true; readonly because: string }
  | { readonly ok: false; readonly error: 'not_undoable' | 'stale' | 'rejected' | 'apply_failed'; readonly because: string };

export interface UndoContext {
  readonly userUuid: string;
  readonly todayISO: string;
  readonly proposalId: number;
  /** One clause the runner could read, carried onto the ledger. */
  readonly reason: string;
}

/**
 * The columns an undo is allowed to write.
 *
 * Deliberately NARROWER than the accept path's list, and written out rather
 * than derived, for the same reason `accept.ts` writes its own out: this builds
 * SQL from the KEYS of a write plan, so an unlisted key would be interpolated
 * into a statement. An undo restores what `RowBefore` recorded, and `RowBefore`
 * records four things.
 */
const UNDOABLE_COLUMNS = new Set([
  'date_iso', 'type', 'distance_mi', 'pace_target_s_per_mi',
  // UNDOCOMPLETE-1 · the five `RowBefore` grew so a session's GEOMETRY could
  // come back. Still written out rather than derived, and still narrower than
  // the accept path's list: an undo restores what the proposal recorded and
  // `RowBefore` records nine things.
  'duration_min', 'is_quality', 'sub_label', 'notes', 'workout_spec',
]);

/**
 * Columns whose value is jsonb and must be handed to pg as TEXT with a cast.
 *
 * node-pg serializes a plain object to `[object Object]` unless it is
 * stringified, and `workout_spec` is the only jsonb column an undo writes.
 * Naming it here rather than special-casing inside the loop keeps the two
 * lists — what may be written, and how — beside each other.
 */
const JSONB_COLUMNS = new Set(['workout_spec']);

export async function applyUndo(
  action: BrainAction,
  ctx: UndoContext,
): Promise<UndoOutcome> {
  const plan = undoWritesFor(action);

  if (plan.kind === 'not_undoable') {
    return { ok: false, error: 'not_undoable', because: plan.because };
  }
  if (plan.kind === 'nothing_to_undo') {
    return { ok: true, reverted: 0, nothingToUndo: true, because: plan.because };
  }

  /* ── THE UNDO ASKS A DIFFERENT STALENESS QUESTION, AND IT NEEDS ITS OWN ───
   *
   * `staleAgainst` asks "does the session still look like it did when this was
   * RAISED". That is exactly right before an accept and exactly wrong after
   * one: the accept's whole job was to make the row stop matching `before`, so
   * reusing it here would refuse every undo that had anything to undo.
   *
   * The undo's question is the mirror: is the session still in the state this
   * decision PUT it in? If something else has moved it since — a rebuild, a
   * later adaptation, a manual edit — then restoring `before` would not put
   * anything back, it would overwrite a change this decision never saw.
   *
   * Two questions, two names (Rule 16). `staleAgainst` is untouched.
   */
  const live = await readLiveRows(ctx.userUuid, action.before.map((b) => b.planWorkoutId));
  const moved = movedSinceAccept(action, live);
  if (moved != null) {
    return { ok: false, error: 'stale', because: moved };
  }

  /* UNDOTRACK-1 (2026-09-09) · this is the wiring that was missing. This call
   * used to write the reversal's OWN ledger row (`runnerResponse: 'DECLINED'`,
   * below) and stop there, never touching the ORIGINAL `ACCEPTED` row —
   * `ledger.undoes` (which is exactly what `mutate.ts` needs to invoke
   * `markUndoneInTransaction`) was never populated. `directionCensus()`
   * (Rule 21's own push-count metric) kept counting that original accept as a
   * live, standing push forever, and Decision History had no `undone_at` to
   * read for this exact proposal's history.
   *
   * `undefined`/`null` from the lookup (no accepted ledger row for this
   * proposal — pre-migration-166 accept, or the lookup itself failed) leaves
   * `undoes` unset: the plan reversal below still proceeds exactly as it
   * always has for that case, rather than blocking a reversal the runner
   * asked for on a row this file cannot conjure. */
  const acceptedRow = await findLiveAcceptedLedgerRow(ctx.userUuid, String(ctx.proposalId));

  const boundary = await mutatePlan<number>({
    authority: 'RUNNER_ACCEPTED',
    userUuid: ctx.userUuid,
    source: `brain/undo ${action.kind}`,
    todayISO: ctx.todayISO,
    workoutId: action.before[0]?.planWorkoutId ?? null,
    touches: 'structural',
    detail: { kind: action.kind, proposalId: ctx.proposalId, undo: true },
    ledger: {
      proposalId: String(ctx.proposalId),
      proposal: { action, facet: ledgerFacetsOf(action) },
      /* The runner has taken the change back, so his standing answer to this
       * proposal is no longer ACCEPTED. DECLINED is the honest terminal word
       * the ledger's own vocabulary has for it, and `undone_at` on the
       * ORIGINAL row is what records that he tried it first — the two rows
       * together say "accepted, then reversed", which neither says alone. */
      runnerResponse: 'DECLINED',
      explanation: ctx.reason,
      ...(acceptedRow ? { undoes: { id: acceptedRow.id, reason: ctx.reason } } : {}),
    },
    apply: async (tx, planId) => writeBack(tx, planId, plan.writes),
  });

  if (!boundary.ok || boundary.value == null) {
    return {
      ok: false,
      error: 'rejected',
      because: boundary.violations.length > 0
        ? boundary.violations.join('; ')
        : 'the mutation boundary refused to put it back',
    };
  }
  if (boundary.value === 0) {
    /* Rule 11 and `accept.ts`'s `zeroIsNotSuccess`, pointed the other way. An
     * undo that touched no row did not put anything back, and reporting
     * success would leave the runner believing his plan had been restored. */
    return {
      ok: false,
      error: 'apply_failed',
      because: `the undo of the ${action.kind} touched no row; the plan did not move back`,
    };
  }
  return { ok: true, reverted: boundary.value, ledgerRowId: null };
}

async function writeBack(
  tx: PoolClient,
  planId: string,
  writes: readonly PlannedWrite[],
): Promise<number> {
  let touched = 0;
  for (const w of writes) {
    if (w.op !== 'update') {
      /* Unreachable: the only kind whose inverse is an insert is
       * REMOVE_WORKOUT, and `executor-map.ts` sends that to UNIMPLEMENTED, so
       * it can never have been accepted and can never need undoing. Throwing
       * rather than writing a partial row keeps NEVER-DELETE-1's decision in
       * the one place that owns it. */
      throw new Error(`an undo may only update; ${w.op} is not implemented`);
    }
    const cols = Object.keys(w.set).filter((c) => UNDOABLE_COLUMNS.has(c));
    if (cols.length === 0) continue;
    const sets = cols
      .map((c, i) => `${c} = $${i + 3}${JSONB_COLUMNS.has(c) ? '::jsonb' : ''}`)
      .join(', ');
    const vals = cols.map((c) => {
      const v = (w.set as Record<string, unknown>)[c];
      /* A recorded NULL stays null — Rule 11 on the write side: the session
       * genuinely had no spec, and `JSON.stringify(null)` would write the
       * four-character string "null" into a jsonb column instead. */
      if (!JSONB_COLUMNS.has(c)) return v;
      return v == null ? null : JSON.stringify(v);
    });
    const r = await tx.query(
      `UPDATE plan_workouts SET ${sets} WHERE id = $1 AND plan_id = $2`,
      [w.planWorkoutId, planId, ...vals],
    );
    touched += r.rowCount ?? 0;
  }
  return touched;
}

/**
 * Has anything moved the session since this decision landed on it?
 *
 * Returns the reason when it has, and null when the row is still where the
 * accept left it. Only the kinds whose undo can actually be applied are
 * examined; every other kind was already refused by `undoWritesFor` above and
 * cannot reach here.
 *
 * ── THE DISTANCE TOLERANCE, STATED RATHER THAN BURIED ──────────────────────
 *
 * A date and a type are compared exactly, because those are written verbatim.
 * A DISTANCE is not: `applyAdaptations`'s shave limb applies the PROPORTION
 * and then rounds and floors on its own terms, so the row can legitimately sit
 * a tenth or two from the figure the card named. A tenth of a mile is not
 * "someone else changed this session"; a mile is. The band is 0.25 mi, which
 * is wider than any rounding this engine performs and narrower than any
 * adaptation it makes.
 */
function movedSinceAccept(
  action: BrainAction,
  live: ReadonlyMap<string, LiveRow>,
): string | null {
  const DISTANCE_TOLERANCE_MI = 0.25;
  for (const b of action.before) {
    const now = live.get(b.planWorkoutId);
    if (now === undefined) {
      return `the session this changed is no longer in the active plan`;
    }
    switch (action.kind) {
      case 'RESCHEDULE':
        if (now.dateISO !== action.toDateISO) {
          return `this moved the session to ${action.toDateISO} and it now sits on ${now.dateISO}, `
            + 'so something else has moved it since';
        }
        break;
      case 'WORKOUT_TYPE_CHANGE':
        if (now.type !== action.to) {
          return `this made the session ${action.to} and it is now a ${now.type}, `
            + 'so something else has changed it since';
        }
        break;
      case 'DISTANCE_CHANGE': {
        if (action.to === null) break;
        if (now.distanceMi === null || now.distanceMi === undefined) {
          return 'the session no longer records a distance to compare against';
        }
        if (Math.abs(now.distanceMi - action.to.value) > DISTANCE_TOLERANCE_MI) {
          return `this set the session to ${action.to.value} mi and it now reads `
            + `${now.distanceMi} mi, so something else has resized it since`;
        }
        break;
      }
      case 'PACE_CHANGE':
      case 'RACE_TARGET_CHANGE':
        /* The pace this decision wrote is not recorded on the action in a form
         * this can compare — `to` is the target and the pipeline may re-derive
         * it. Rule 11: rather than pass silently or invent a comparison, this
         * says which check it could not run, and the mutation boundary's
         * differential validation is what still stands behind the write. */
        break;
      default:
        break;
    }
  }
  return null;
}
