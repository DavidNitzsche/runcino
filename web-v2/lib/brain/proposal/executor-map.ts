/**
 * lib/brain/proposal/executor-map.ts · WHICH APPLY PATH LANDS THIS ACTION.
 *
 * ── WHY THIS IS A SEPARATE, PURE FILE ──────────────────────────────────────
 *
 * `accept.ts` next door does the applying and imports the pool, `mutatePlan`
 * and `applyAdaptations`. This holds the DECISION about which path an action
 * takes, and holds it with no database, so:
 *
 *   1 · the completeness gate can assert every kind reaches a named executor
 *       without a Postgres instance (Rule 15 — a mechanism whose only test
 *       needs a live plan is a mechanism that gets tested once);
 *   2 · `accept.ts` switches on the PATH rather than on the kind, so there is
 *       exactly one kind-switch and the map and the dispatcher cannot drift
 *       apart about which kind is which (Rule 16).
 *
 * ── `UNIMPLEMENTED` IS A FIRST-CLASS ANSWER, AND THAT IS THE POINT ─────────
 *
 * Two kinds have no honest apply path today and say so here rather than in a
 * comment. The completeness gate cross-checks this against its ratchet in BOTH
 * directions: a kind that says UNIMPLEMENTED with no gap entry fails, and a gap
 * entry for a kind that now has a real path fails until deleted. That is what
 * makes the ratchet self-verifying instead of a list somebody has to remember
 * to update (Rule 20).
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 * · WHETHER THE NAMED PATH ACTUALLY WORKS. It names a destination; whether
 *   `applyAdaptations` handles a kind correctly is that module's own business
 *   and its own tests.
 * · WHETHER THE PATH IS THE BEST ONE. `ADAPTATION_PIPELINE` is chosen for the
 *   four legacy-shaped kinds because it already does provenance, `original_*`
 *   tracking, `coach_intents` and `workout_spec` re-derivation. A direct write
 *   would be simpler and would lose all four, and nothing here would notice.
 */

import type { ActionKind, BrainAction } from './action';

export type ExecutorPath =
  /** `lib/plan/adapt.ts:applyAdaptations`. Carries provenance, `original_*`
   *  columns, the `coach_intents` row and the `workout_spec` re-derivation. */
  | 'ADAPTATION_PIPELINE'
  /** `lib/plan/reanchor-plan.ts:applyReanchorProposal`. One decision over the
   *  whole remaining block, re-resolved against canonical anchors at accept
   *  time (Rule 10's recompute posture). */
  | 'REPRICE_APPLY'
  /** `mutatePlan` + `plannedWrites`, for the kinds whose whole effect is a
   *  column write no existing pipeline covers. */
  | 'DIRECT_PLAN_WRITE'
  /** Changes nothing by design. The decision is recorded and the plan is not
   *  touched, which is the correct outcome and not a failure. */
  | 'RECORD_ONLY'
  /** No honest path exists yet. Carries the reason and is watched by the
   *  completeness ratchet. */
  | 'UNIMPLEMENTED';

export interface ExecutorRef {
  readonly path: ExecutorPath;
  /** For the four real paths: what it does. For UNIMPLEMENTED: what is missing. */
  readonly because: string;
}

/**
 * Where an accepted action goes.
 *
 * TOTAL over the union — the `never` below means a new kind cannot reach the
 * accept route with nowhere to land, which is the "runner taps a button that
 * does nothing" failure this whole consolidation exists to stop.
 */
export function executorFor(action: BrainAction): ExecutorRef {
  switch (action.kind) {
    /* The four the pipeline already implements, statement for statement. Going
     * around it would drop `original_type` / `original_sub_label`, the intent
     * row the "was CRUISE INTERVALS" kicker reads, and the spec rebuild that
     * stops the chip disagreeing with the row. */
    case 'WORKOUT_TYPE_CHANGE':
      return pipeline('the downgrade limb sets type and preserves original_type');
    case 'DISTANCE_CHANGE':
      return pipeline('the shave and mark_upgrade limbs resize and rebuild the spec and sub_label');
    case 'RESCHEDULE':
      return pipeline('the reschedule limb moves the day, re-homes week_id and preserves original_date_iso');
    case 'FIELD_TEST':
      return pipeline('the field_test limb rewrites the session into a timed test with its own spec');

    /* The session-geometry kinds. `applyProgressionReshape` writes
     * workout_spec, sub_label and pace_target from ONE rendered label so the
     * three cannot disagree, and it is reached through the same pipeline. */
    case 'REPETITION_CHANGE':
    case 'RECOVERY_INTERVAL_CHANGE':
    case 'QUALITY_DOSE_CHANGE':
    case 'DURATION_CHANGE':
      return pipeline('the reshape limb writes spec, sub_label and pace together from one rendered shape');

    /* DURATIONOFFER-1 (2026-09-12) · a DISTINCT kind from `DURATION_CHANGE`
     * immediately above, deliberately never routed to the reshape pipeline.
     * The 2026-09-02 ruling withholds the session-geometry levers from any
     * WRITE; this kind exists so the same ACCELERATE evidence can be OFFERED
     * without ever being able to reach that write, structurally — accepting
     * it records the runner's answer and nothing else, exactly like HOLD and
     * SAFETY_STOP below. */
    case 'DURATION_PROGRESS_OFFER':
      return record('an offered duration step; accepting it records the runner\'s answer and writes no session geometry');

    /* A repricing is one decision over the block and cannot be replayed as N
     * row writes: the arms re-resolve canonical anchors at accept time, so the
     * applied answer is the current one rather than the one the card promised. */
    case 'COORDINATED':
      return { path: 'REPRICE_APPLY', because: 'a coordinated repricing is applied against canonical anchors, not replayed row by row' };

    /* Column writes with no pipeline of their own. Each is a single SET the
     * mutation boundary validates in the context of the whole week. */
    case 'PACE_CHANGE':
      return direct('sets pace_target_s_per_mi on the named rows');
    case 'LONG_RUN_STRUCTURE_CHANGE':
      return direct('sets sub_label and the note describing the new shape');
    case 'RACE_TARGET_CHANGE':
      return direct('sets pace_target_s_per_mi on every row pointed at the race');
    case 'TAPER_CHANGE':
    case 'RECOVERY_CHANGE':
      return direct('writes the reason onto the named rows and moves no prescribed quantity');

    /* ── the two with no honest path, named rather than faked ─────────────── */

    /* A new row needs a plan_id, a week_id, a dow and a workout_spec, and the
     * last of those is authored by the composer against the whole week — a
     * session inserted with a null spec renders as a blank card on the phone
     * and ships nothing to the wrist. Writing a partial row here would be a
     * second, worse authoring path beside `composePlan`, which is exactly the
     * duplication BRAIN_CONSTITUTION forbids. */
    case 'ADD_WORKOUT':
      return unimplemented(
        'a new session needs a week, a day-of-week and a composer-authored workout_spec, and '
        + 'inserting one without a spec would put a blank card on the phone and nothing on the wrist',
      );

    /* NEVER-DELETE-1, which is a standing rule with its own gate
     * (`lib/plan/_move_never_deletes.test.ts`): a prescribed session is never
     * destroyed. The engine downgrades to rest instead, keeping original_type,
     * the provenance chip and the day the runner can still see he was meant to
     * run. So this is not "unbuilt", it is REFUSED BY DOCTRINE, and the honest
     * apply path for wanting a day gone is WORKOUT_TYPE_CHANGE to rest. */
    case 'REMOVE_WORKOUT':
      return unimplemented(
        'a prescribed session is never deleted (NEVER-DELETE-1); the way to empty a day is a '
        + 'downgrade to rest, which keeps the row, its provenance and the day the runner can see',
      );

    /* Frequency is a COUNT, realised as adds and removes. Its downward half
     * would work today, and shipping only the downward half of a lever is the
     * exact asymmetry Rule 21 measures — so it waits for ADD_WORKOUT rather
     * than landing as a delete-only mechanism. */
    case 'FREQUENCY_CHANGE':
      return unimplemented(
        'realised as adds and removes, and the add half is unimplemented; landing only the remove '
        + 'half would ship a lever that can lower a runner frequency and never raise it',
      );

    /* Deliberately no write. Recorded so the judgement is visible, which is
     * the entire reason these kinds exist. */
    case 'CONDITIONAL':
      return record('not decided until its assessment date');
    case 'HOLD':
    case 'REFUSAL':
      return record('a judgement to change nothing, recorded so it can be counted');
    case 'SAFETY_STOP':
      return record('training is withheld by the safety owner; accepting a stop writes no plan row');

    default: {
      const never: never = action;
      throw new Error(`no executor for ${JSON.stringify(never)}`);
    }
  }
}

/** The kinds whose executor is honestly missing. Read by the completeness gate. */
export function unimplementedExecutorKinds(
  specimens: Readonly<Record<ActionKind, BrainAction>>,
): readonly ActionKind[] {
  return (Object.keys(specimens) as ActionKind[])
    .filter((k) => executorFor(specimens[k]).path === 'UNIMPLEMENTED');
}

const pipeline = (because: string): ExecutorRef => ({ path: 'ADAPTATION_PIPELINE', because });
const direct = (because: string): ExecutorRef => ({ path: 'DIRECT_PLAN_WRITE', because });
const record = (because: string): ExecutorRef => ({ path: 'RECORD_ONLY', because });
const unimplemented = (because: string): ExecutorRef => ({ path: 'UNIMPLEMENTED', because });
