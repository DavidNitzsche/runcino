/**
 * lib/brain/proposal/accept.ts · ONE DOOR FROM AN ACCEPTED ACTION TO THE PLAN.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * `POST /api/plan/workout-proposals/:id/accept` switched on the ROW's
 * `action_kind` — one of five engine words — and rebuilt an `AdaptationAction`
 * from three payload fields. So the accept path could apply exactly what the
 * legacy payload could describe, and the twenty-one-kind schema was, in the
 * owner's words, "the generalized schema acting only as a reader".
 *
 * This is the writer half. It takes a `BrainAction` and lands it, dispatching
 * on `executor-map.ts`'s named path rather than on the kind — so there is
 * exactly ONE kind-switch in the accept lane and the map and the dispatcher
 * cannot drift apart (Rule 16).
 *
 * ── THE AUTHORITY BOUNDARY IS NOT NEGOTIATED HERE ──────────────────────────
 *
 * Every write below declares `RUNNER_ACCEPTED`, which is permitted because the
 * runner tapped the button — not because this file decided it was. The seam is
 * `lib/plan/adaptation-authority.ts` and it is untouched;
 * `AUTOMATIC_ADAPTATION_AUTHORITY` stays false and nothing here reads it. A
 * caller that is NOT a runner accepting must not use this function, and the
 * `acceptedBy` field exists so that is a statement rather than an assumption.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 * · WHETHER THE CHANGE IS GOOD. Sizing is the adjudicator's and the mutation
 *   boundary re-validates the whole week; this routes and writes.
 * · STALENESS. `prepareAction` owns that and the caller runs it first. This
 *   deliberately does not re-read the plan, because a second staleness check on
 *   a second snapshot would be a second answer to one question.
 * · WHETHER THE PIPELINE LIMB DOES THE RIGHT THING. `applyAdaptations` has its
 *   own tests; this hands it a shape and takes its row count.
 * · A KIND WHOSE EXECUTOR IS `UNIMPLEMENTED`. It refuses, out loud, with the
 *   reason `executor-map.ts` gave. That refusal is the correct outcome and is
 *   ratcheted in `facets.ts` — it is not a bug this file can fix.
 * · THE WATCH ACTUALLY RELOADING. It reports the effect; the caller busts the
 *   cache and watchOS is not in this process.
 */

import type { PoolClient } from 'pg';
import type { BrainAction } from './action';
import { plannedWrites, type PlannedWrite } from './execute';
import { executorFor } from './executor-map';
import { validateAction } from './validate';
import { ledgerFacetsOf } from './ledger-facet';
import { watchBehaviorOf, type WatchEffect } from './watch-facet';
import { undoWritesFor } from './undo';
import type { RepricePayload } from '@/lib/plan/reprice-payload';
import type { AdaptationAction } from '@/lib/plan/adapt';
import { mutatePlan } from '@/lib/plan/mutate';

export interface AcceptContext {
  readonly userUuid: string;
  /** Runner-local today. The boundary skips sealed past weeks against it. */
  readonly todayISO: string;
  /** The proposal row this applies, for the ledger. */
  readonly proposalId?: number | null;
  /** The runner-facing reason, carried onto the intent row. */
  readonly why: string;
  /**
   * A repricing's own payload. Required for COORDINATED and for nothing else:
   * the anchors are re-resolved at accept time, so the action's parts describe
   * and the payload applies.
   */
  readonly reprice?: RepricePayload | null;
  /**
   * The progression resolution behind a session-geometry change.
   *
   * Required for the four dose kinds, because `applyProgressionReshape` writes
   * `workout_spec`, `sub_label` and `pace_target` from ONE rendered label so
   * the three cannot disagree, and it needs the resolution to render it. An
   * action without it is refused rather than applied as a bare column write,
   * which would leave the chip saying one thing and the row another.
   */
  readonly reshape?: AdaptationAction['reshape'] | null;
}

export type AcceptOutcome =
  | {
      readonly ok: true;
      /** Plan rows touched. Zero is legitimate for a recorded-only decision. */
      readonly applied: number;
      readonly recordedOnly: boolean;
      readonly watch: WatchEffect;
      /**
       * CAN THE RUNNER PUT THIS BACK?
       *
       * Answered on the way out, not asked for later, because it is the half of
       * the bargain this whole lane rests on. The owner went 0-for-52 on
       * proposals he was asked to approve and 4-for-4 on repairs that
       * auto-applied, and the ruling from that was "approval is not the control
       * mechanism; reversibility is". A card that says accept without saying
       * whether accept is reversible is asking him to take the same bet blind.
       *
       * `because` on a NO is the reason from `undo.ts`, so the surface can say
       * which field was not recorded rather than a flat "cannot undo".
       */
      readonly undo:
        | { readonly can: true }
        | { readonly can: false; readonly because: string };
      /** Present on a recorded-only outcome, so a caller can say why nothing moved. */
      readonly because?: string;
    }
  | {
      readonly ok: false;
      readonly error: 'invalid' | 'unsupported' | 'missing_context' | 'apply_failed' | 'rejected';
      readonly detail: string;
    };

/**
 * Land one accepted action.
 *
 * Rule 11 all through: an apply that fails returns a FAILURE, never
 * `{ ok: true, applied: 0 }`. The runner tapped a button, and a response that
 * says it worked while the plan did not move is the lie this lane has told
 * before.
 */
export async function applyBrainAction(
  action: BrainAction,
  ctx: AcceptContext,
): Promise<AcceptOutcome> {
  const valid = validateAction(action);
  if (!valid.ok) {
    return { ok: false, error: 'invalid', detail: valid.refusals.join('; ') };
  }

  const route = executorFor(action);
  const watch = watchBehaviorOf(action);
  /* Computed from the action's OWN recorded `before`, which is the only place
   * the pre-change state exists. A kind whose inverse cannot be built says so
   * with the reason, and the three states stay three (Rule 11): reversible,
   * nothing to reverse, and reversible-in-principle-but-not-recorded. */
  const undoPlan = undoWritesFor(action);
  const undo = undoPlan.kind === 'not_undoable'
    ? { can: false as const, because: undoPlan.because }
    : { can: true as const };

  switch (route.path) {
    case 'RECORD_ONLY':
      /* Nothing is written and that is the correct outcome, not a failure. The
       * decision is the record; `HOLD`, `REFUSAL` and `SAFETY_STOP` exist so a
       * judgement is visible rather than invisible (Rule 11). */
      return { ok: true, applied: 0, recordedOnly: true, watch, undo, because: route.because };

    case 'UNIMPLEMENTED':
      return { ok: false, error: 'unsupported', detail: route.because };

    case 'REPRICE_APPLY': {
      const reprice = ctx.reprice ?? null;
      if (reprice == null) {
        return {
          ok: false, error: 'missing_context',
          detail: 'a coordinated repricing carries its anchors in the row payload, and none was supplied',
        };
      }
      const { applyReanchorProposal } = await import('@/lib/plan/reanchor-plan');
      const res = await applyReanchorProposal(
        ctx.userUuid,
        { planId: reprice.planId, arm: reprice.arm, toVdot: reprice.toVdot },
        ctx.todayISO,
      ).catch((e: unknown) => {
        console.error('[proposal/accept] reprice apply threw:', e);
        return null;
      });
      if (res == null) {
        return { ok: false, error: 'apply_failed', detail: 'the repricing was refused by its own apply path' };
      }
      return { ok: true, applied: res.workoutsUpdated, recordedOnly: false, watch, undo };
    }

    case 'ADAPTATION_PIPELINE': {
      const adaptation = adaptationFromAction(action, ctx);
      if (adaptation === null) {
        return {
          ok: false, error: 'missing_context',
          detail: 'this change rewrites the session geometry and the resolution behind it was not stored',
        };
      }
      const { applyAdaptations } = await import('@/lib/plan/adapt');
      try {
        const applied = await applyAdaptations(ctx.userUuid, [adaptation], 'RUNNER_ACCEPTED');
        return { ok: true, applied, recordedOnly: false, watch, undo };
      } catch (e) {
        console.error('[proposal/accept] pipeline apply failed:', e);
        return { ok: false, error: 'apply_failed', detail: 'the adaptation pipeline refused the write' };
      }
    }

    case 'DIRECT_PLAN_WRITE': {
      const plan = plannedWrites(action);
      if (plan.nonMutating) {
        /* A kind routed here that resolves to nothing is a bug in the routing,
         * not a legitimate no-op — RECORD_ONLY is where nothing belongs. Saying
         * so beats consuming the card and reporting success. */
        return { ok: false, error: 'invalid', detail: `nothing to write: ${plan.because}` };
      }
      const facet = ledgerFacetsOf(action);
      const boundary = await mutatePlan<number>({
        authority: 'RUNNER_ACCEPTED',
        userUuid: ctx.userUuid,
        source: `brain/accept ${action.kind}`,
        todayISO: ctx.todayISO,
        workoutId: action.before[0]?.planWorkoutId ?? null,
        touches: 'structural',
        detail: { kind: action.kind, proposalId: ctx.proposalId ?? null },
        ledger: {
          proposalId: ctx.proposalId == null ? undefined : String(ctx.proposalId),
          /* The action as raised, including the lever it ASKED for. The lever
           * COLUMN is measured from the rows by the boundary itself and this
           * never touches it — see `ledger-facet.ts` on why the two names are
           * different quantities. */
          proposal: { action, facet },
          runnerResponse: 'ACCEPTED',
          explanation: ctx.why,
        },
        apply: async (tx, planId) => applyWritePlan(tx, planId, plan.writes),
      });
      if (!boundary.ok || boundary.value == null) {
        return {
          ok: false, error: 'rejected',
          detail: boundary.violations.length > 0
            ? boundary.violations.join('; ')
            : 'the mutation boundary refused the write',
        };
      }
      return { ok: true, applied: boundary.value, recordedOnly: false, watch, undo };
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE TWO BRIDGES
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * A `BrainAction` as the `AdaptationAction` the pipeline already implements.
 *
 * This is a SECOND mapping and it is deliberate: `applyAdaptations` carries
 * provenance, the `original_*` columns, the `coach_intents` row the "was CRUISE
 * INTERVALS" kicker reads, and the `workout_spec` rebuild that stops the chip
 * disagreeing with the row. Going around it to save one translation would drop
 * all four, and the runner would see a resized session with a label describing
 * the old one.
 *
 * Returns null when the action needs context the row did not store, which for
 * the four geometry kinds is the progression resolution. Rule 11: refusing is
 * the right answer, and applying a bare column write in its place would be the
 * silent partial the whole lane exists to avoid.
 */
function adaptationFromAction(
  action: BrainAction,
  ctx: AcceptContext,
): AdaptationAction | null {
  const ids = action.before.map((b) => b.planWorkoutId);
  const why = ctx.why;

  switch (action.kind) {
    case 'WORKOUT_TYPE_CHANGE':
      return { kind: 'downgrade', workoutIds: ids, newType: action.to, why };

    case 'RESCHEDULE':
      return { kind: 'reschedule', workoutIds: ids, newDate: action.toDateISO, why };

    case 'FIELD_TEST':
      return { kind: 'field_test', workoutIds: ids, why };

    case 'DISTANCE_CHANGE': {
      if (action.direction === 'MORE') {
        if (action.to === null) return null;
        return {
          kind: 'mark_upgrade', workoutIds: ids, why,
          bumps: ids.map((workoutId) => ({ workoutId, newDistanceMi: action.to!.value })),
        };
      }
      /* A cut is applied as the PROPORTION it was decided as, because that is
       * what the pipeline's `shave` limb takes and what its rounding and its
       * 0.5-mile floor are written against. When the proposal only ever held a
       * target distance, the fraction is derived from the session's own
       * recorded distance — and when that was not recorded either, this
       * refuses rather than inventing a denominator. */
      if (typeof action.ofBefore === 'number' && action.ofBefore > 0 && action.ofBefore < 1) {
        return { kind: 'shave', workoutIds: ids, shaveFraction: action.ofBefore, why };
      }
      const from = action.before[0]?.distanceMi;
      if (action.to === null || from == null || !(from > 0)) return null;
      const frac = 1 - (action.to.value / from);
      if (!(frac > 0) || !(frac < 1)) return null;
      return { kind: 'shave', workoutIds: ids, shaveFraction: frac, why };
    }

    /* The four session-geometry kinds. The pipeline's `reshape` limb needs the
     * whole resolution, so the caller has to have kept it. */
    case 'DURATION_CHANGE':
    case 'REPETITION_CHANGE':
    case 'RECOVERY_INTERVAL_CHANGE':
    case 'QUALITY_DOSE_CHANGE': {
      if (ctx.reshape == null) return null;
      return { kind: 'reshape', workoutIds: ids, reshape: ctx.reshape, why };
    }

    /* Everything else is routed elsewhere by `executorFor` and cannot reach
     * here. Returning null rather than throwing keeps a routing bug a refused
     * accept instead of a 500 on the runner's phone. */
    default:
      return null;
  }
}

/**
 * The write plan, executed inside the boundary's transaction.
 *
 * The column allowlist is the whole safety property: `set` comes from
 * `plannedWrites`, which is typed, but this builds SQL from its KEYS and an
 * unlisted key would be interpolated into a statement. The list is written out
 * rather than derived from the type so it cannot widen by accident.
 */
async function applyWritePlan(
  tx: PoolClient,
  planId: string,
  writes: readonly PlannedWrite[],
): Promise<number> {
  const ALLOWED = new Set([
    'date_iso', 'type', 'distance_mi', 'duration_min',
    'pace_target_s_per_mi', 'is_quality', 'sub_label', 'notes',
  ]);
  let touched = 0;

  for (const w of writes) {
    if (w.op === 'delete') {
      /* Unreachable, and deliberately so. NEVER-DELETE-1
       * (`lib/plan/_move_never_deletes.test.ts`) is the standing rule that a
       * prescribed session is never destroyed: the engine downgrades to rest,
       * which keeps `original_type`, the provenance chip and the day the runner
       * can still see he was meant to run. `executorFor` sends REMOVE_WORKOUT
       * to UNIMPLEMENTED for that reason. Throwing rather than issuing the
       * DELETE keeps the decision in one place. */
      throw new Error('deleting a session is not implemented; see the REMOVE_WORKOUT gap in facets.ts');
    }
    if (w.op === 'insert') {
      /* Unreachable: `executorFor` sends ADD_WORKOUT to UNIMPLEMENTED, and the
       * reason is in `facets.ts` — a row with no composer-authored
       * `workout_spec` renders as a blank card. Throwing rather than writing a
       * partial row keeps that decision in one place. */
      throw new Error('inserting a session is not implemented; see the ADD_WORKOUT gap in facets.ts');
    }

    const cols = Object.keys(w.set).filter((c) => ALLOWED.has(c));
    if (cols.length === 0) continue;
    const sets = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
    const vals = cols.map((c) => (w.set as Record<string, unknown>)[c]);
    const r = await tx.query(
      `UPDATE plan_workouts SET ${sets} WHERE id = $1 AND plan_id = $2`,
      [w.planWorkoutId, planId, ...vals],
    );
    touched += r.rowCount ?? 0;
  }
  return touched;
}
