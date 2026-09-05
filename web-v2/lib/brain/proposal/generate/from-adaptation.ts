/**
 * lib/brain/proposal/generate/from-adaptation.ts · THE LIVE DETECTION PASS,
 * SPEAKING THE ACTION SCHEMA.
 *
 * ── THE PROBLEM THIS SOLVES ────────────────────────────────────────────────
 *
 * `plan_workout_proposals.action_payload` carries `newType`, `newDate`,
 * `shaveFraction`, `newDistanceMi` and — for one kind — `reprice`. Everything
 * downstream that wants a `BrainAction` therefore RECONSTRUCTS one by guessing
 * which of those fields the writer happened to populate
 * (`staleness.ts:actionFromPending`). That works for five kinds and is
 * structurally incapable of carrying a sixth: there is no field in that payload
 * that could hold a rep count, a recovery interval, or a coordinated part list.
 *
 * So the writer states the action instead of leaving the reader to infer it.
 * The generated action rides in the SAME jsonb column under `action`, exactly
 * as `reprice` and `newDistanceMi` already do — no migration, because the
 * column never had a constraint and only the TYPE said a proposal must be one
 * of five things.
 *
 * The legacy fields stay, and stay authoritative for the apply path. This is
 * additive: `actionFromPending` reads the stored action when it is there and
 * falls back to its own reconstruction when it is not, so the seven rows
 * already in production keep working unchanged.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 * · THE DETECTION ITSELF. It translates what `detectAdaptations` decided. A
 *   wrong shave is translated into a faithful DISTANCE_CHANGE and nothing here
 *   objects.
 * · A KIND THE PASS EMITS THAT HAS NO TRANSLATION. `recompute_paces`,
 *   `mark_dirty` and `note` return null, because none of them is a per-workout
 *   change and inventing an action for them would put a card on the phone for
 *   something that never touches a session. Null is the refusal, and the caller
 *   simply stores no action — never a no-op one.
 * · WHETHER THE ACTION IS EVER READ. That is `_action_completeness.test.ts`'s
 *   question and the reason the generator facet is checked against a live
 *   caller rather than against the existence of this file.
 */

import type { AdaptationAction } from '@/lib/plan/adapt';
import type { BrainAction, RowBefore } from '../action';
import { ACTION_SCHEMA_VERSION } from '../action';
import { actionFromProgression } from './from-progression';
import { roundTo } from '@/lib/format/run';

/** The session as the writer read it, straight off `plan_workouts`. */
export interface PlanRowSnapshot {
  readonly planWorkoutId: string;
  readonly dateISO: string;
  readonly type: string;
  readonly distanceMi: number | null;
  readonly planVersion?: string | null;
}

/**
 * One detected action, as the decision it is.
 *
 * Returns null for a kind that is not a per-workout change. Rule 11: null here
 * means "this pass produced nothing a card can describe", which the caller
 * records by storing no action — as against an action that applies nothing
 * while reporting success.
 */
export function actionFromAdaptation(
  action: AdaptationAction,
  row: PlanRowSnapshot,
): BrainAction | null {
  const before: readonly RowBefore[] = [{
    planWorkoutId: row.planWorkoutId,
    dateISO: row.dateISO,
    type: row.type,
    distanceMi: row.distanceMi,
    ...(row.planVersion === undefined ? {} : { planVersion: row.planVersion }),
  }];
  const base = { schemaVersion: ACTION_SCHEMA_VERSION, before } as const;

  switch (action.kind) {
    case 'downgrade': {
      const to = action.newType;
      if (typeof to !== 'string' || to.length === 0) return null;
      return { ...base, kind: 'WORKOUT_TYPE_CHANGE', direction: 'LESS', to };
    }

    case 'shave': {
      const frac = action.shaveFraction;
      if (typeof frac !== 'number' || !(frac > 0) || !(frac < 1)) return null;
      /* The proportion is what was DECIDED; the mileage is what it prices to
       * when the session's own distance is on record. Recording only the miles
       * throws away the sentence the runner should read ("take 17% off
       * Thursday"), and recording only the fraction leaves the accept path with
       * no target. Both, or as much of both as the row supports. */
      const from = row.distanceMi;
      return {
        ...base, kind: 'DISTANCE_CHANGE', direction: 'LESS', ofBefore: frac,
        to: from === null ? null : { unit: 'mi', value: roundTo(from * (1 - frac), 1) },
      };
    }

    case 'mark_upgrade': {
      /* An upgrade names the distance it proposes, or it is a card the runner
       * taps that cannot do anything. `bumps` is per-row, so the row's own
       * entry is the one that matters and another row's is not a fallback. */
      const bump = (action.bumps ?? []).find((b) => b.workoutId === row.planWorkoutId);
      const mi = bump?.newDistanceMi;
      if (typeof mi !== 'number' || !Number.isFinite(mi)) return null;
      return { ...base, kind: 'DISTANCE_CHANGE', direction: 'MORE', to: { unit: 'mi', value: mi } };
    }

    case 'reschedule': {
      const to = action.newDate;
      if (typeof to !== 'string' || to.length === 0 || to === row.dateISO) return null;
      return { ...base, kind: 'RESCHEDULE', direction: 'NEUTRAL', toDateISO: to, swapWithId: null };
    }

    /* `describe` is deliberately FIXED and does NOT echo `action.why`. Rule 17:
     * the trigger's reason already travels to the card as its `why` field, and
     * a describe that repeats it prints the same sentence twice on one screen.
     * It also keeps the string card-shaped: a trigger reason is coach prose of
     * unbounded length that can carry a citation, and `validateAction` would
     * refuse the action at accept time for either — which would have turned a
     * Rule 17 defect into a button that does nothing. */
    case 'field_test':
      return {
        ...base, kind: 'FIELD_TEST', direction: 'NEUTRAL',
        describe: 'a timed effort to re-anchor the paces',
      };

    /* The four session-geometry levers, from the pass that already resolved
     * them. Everything about which lever moved and which way lives in
     * `from-progression.ts`; this only supplies the rows. */
    case 'reshape': {
      const r = action.reshape;
      if (r == null) return null;
      return actionFromProgression(r.resolution, before);
    }

    /* Not per-workout changes. A recompute reprices a whole block (that is the
     * `reprice` lane and it has its own writer), `mark_dirty` is a staleness
     * flag, and a `note` is by definition a record rather than a change. */
    case 'recompute_paces':
    case 'mark_dirty':
    case 'note':
      return null;

    default: {
      const never: never = action.kind;
      throw new Error(`no action translation for adaptation kind ${String(never)}`);
    }
  }
}


