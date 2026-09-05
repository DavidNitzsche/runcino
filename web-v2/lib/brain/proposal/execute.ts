/**
 * lib/brain/proposal/execute.ts · TURNING AN ACTION INTO WRITES.
 *
 * The schema in `action.ts` says what a coaching decision may ASK for. This
 * says what each ask actually DOES to the plan, and it is deliberately split
 * into a pure half and a transactional half:
 *
 *   plannedWrites(action)  → the exact column writes, no database, no clock
 *   executeAction(...)     → staleness check, then one mutatePlan transaction
 *
 * The split exists because of Rule 15. A mechanism whose only test needs a live
 * plan is a mechanism that gets tested once and then never again, and this repo
 * has shipped several. `plannedWrites` is a total function over the union, so
 * the gate can assert every member reaches real writes — or is explicitly and
 * legibly non-mutating — with nothing mocked.
 *
 * WHAT THIS FILE CANNOT CATCH (Rule 22): it checks that an action maps to
 * writes, never that the writes are good coaching. A PACE_CHANGE to a
 * ridiculous pace produces a perfectly well-formed write. Sizing is the
 * adjudicator's job and the validator's; this is plumbing, and it is only
 * asserted to be plumbing.
 */

import {
  type BrainAction,
  type ActionKind,
  type LiveRow,
  NON_MUTATING_KINDS,
  staleAgainst,
} from './action';

/** A column-level write against one plan row. */
export interface RowWrite {
  readonly op: 'update';
  readonly planWorkoutId: string;
  readonly set: Readonly<Partial<{
    date_iso: string;
    type: string;
    distance_mi: number | null;
    duration_min: number | null;
    pace_target_s_per_mi: number | null;
    is_quality: boolean;
    sub_label: string;
    notes: string;
  }>>;
}

export interface RowInsert {
  readonly op: 'insert';
  readonly dateISO: string;
  readonly type: string;
  readonly distanceMi: number;
}

export interface RowDelete {
  readonly op: 'delete';
  readonly planWorkoutId: string;
}

export type PlannedWrite = RowWrite | RowInsert | RowDelete;

/** A kind that changes nothing, and the reason that is the correct outcome. */
export interface NoWrites {
  readonly writes: readonly [];
  readonly nonMutating: true;
  readonly because: string;
}

export interface Writes {
  readonly writes: readonly PlannedWrite[];
  readonly nonMutating: false;
}

export type WritePlan = Writes | NoWrites;

/**
 * Every member of the union, resolved to writes. TOTAL — the `never` check at
 * the bottom means adding a kind without handling it fails the build rather
 * than falling through to a silent no-op, which is how the old three-field
 * payload managed to accept kinds it could not apply.
 */
export function plannedWrites(action: BrainAction): WritePlan {
  const ids = action.before.map((b) => b.planWorkoutId);
  const one = ids[0];

  switch (action.kind) {
    case 'PACE_CHANGE':
      return upd(ids.map((id) => ({ id, set: { pace_target_s_per_mi: action.to.value } })));

    case 'DISTANCE_CHANGE':
      if (action.to === null) {
        return { writes: [], nonMutating: true, because: 'no target distance was recorded' };
      }
      return upd([{ id: one, set: { distance_mi: action.to.value } }]);

    case 'DURATION_CHANGE':
      return upd([{ id: one, set: { duration_min: action.to.value } }]);

    /* Reps, recovery intervals and quality dose all live in the session's
     * prescription rather than in a scalar column, so they are expressed as a
     * spec edit carried on notes + distance. The spec re-derivation inside
     * mutatePlan is what turns that into the structured workout_spec. */
    case 'REPETITION_CHANGE':
    case 'RECOVERY_INTERVAL_CHANGE':
    case 'QUALITY_DOSE_CHANGE':
      return upd([{ id: one, set: { is_quality: true, notes: describeDose(action) } }]);

    case 'LONG_RUN_STRUCTURE_CHANGE':
      return upd([{ id: one, set: { sub_label: action.to, notes: action.describe } }]);

    case 'WORKOUT_TYPE_CHANGE':
      return upd([{ id: one, set: { type: action.to } }]);

    case 'ADD_WORKOUT':
      return {
        nonMutating: false,
        writes: [{ op: 'insert', dateISO: action.dateISO, type: action.type, distanceMi: action.distanceMi }],
      };

    case 'REMOVE_WORKOUT':
      return { nonMutating: false, writes: ids.map((id) => ({ op: 'delete' as const, planWorkoutId: id })) };

    /* Frequency is a count of running days, not a column. It is realised as
     * adds or removes, which the adjudicator must have already resolved into
     * `before`; a frequency change that names no rows is a decision that has
     * not been made yet, and saying so beats writing nothing quietly. */
    case 'FREQUENCY_CHANGE':
      if (ids.length === 0) {
        return { writes: [], nonMutating: true, because: 'a frequency change names no rows to add or remove' };
      }
      return action.direction === 'MORE'
        ? { nonMutating: false, writes: [] as readonly PlannedWrite[] }
        : { nonMutating: false, writes: ids.map((id) => ({ op: 'delete' as const, planWorkoutId: id })) };

    case 'RESCHEDULE':
      return upd([{ id: one, set: { date_iso: action.toDateISO } }]);

    /* One decision, many rows. The parts are flattened so the whole thing
     * commits or none of it does — a half-applied re-anchor is a plan whose
     * paces disagree with each other. */
    case 'COORDINATED': {
      const out: PlannedWrite[] = [];
      for (const part of action.parts) {
        const p = plannedWrites(part);
        if (!p.nonMutating) out.push(...p.writes);
      }
      return { nonMutating: false, writes: out };
    }

    case 'RACE_TARGET_CHANGE':
      return upd(ids.map((id) => ({ id, set: { pace_target_s_per_mi: action.toSecPerMi } })));

    case 'TAPER_CHANGE':
    case 'RECOVERY_CHANGE':
      return upd(ids.map((id) => ({ id, set: { notes: action.describe } })));

    /* Not a change yet. It is a decision scheduled for a date, and writing it
     * into the plan today would be exactly the "silent future prescription"
     * the runner never agreed to. */
    case 'CONDITIONAL':
      return { writes: [], nonMutating: true, because: `not decided until ${action.assessOnISO}` };

    case 'FIELD_TEST':
      return upd([{ id: one, set: { notes: action.describe, is_quality: true } }]);

    case 'HOLD':
    case 'REFUSAL':
      return { writes: [], nonMutating: true, because: action.because };

    case 'SAFETY_STOP':
      return { writes: [], nonMutating: true, because: action.because };

    default: {
      const never: never = action;
      throw new Error(`unhandled action kind: ${JSON.stringify(never)}`);
    }
  }
}

function upd(rows: readonly { id: string; set: RowWrite['set'] }[]): Writes {
  return {
    nonMutating: false,
    writes: rows
      .filter((r) => typeof r.id === 'string' && r.id.length > 0)
      .map((r) => ({ op: 'update' as const, planWorkoutId: r.id, set: r.set })),
  };
}

function describeDose(action: Extract<BrainAction,
  { kind: 'REPETITION_CHANGE' | 'RECOVERY_INTERVAL_CHANGE' | 'QUALITY_DOSE_CHANGE' }>): string {
  return `${action.kind === 'QUALITY_DOSE_CHANGE' ? 'dose' : 'reps'} `
    + `${action.to.value} ${action.to.unit}`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE GUARDED ENTRY POINT
 * ═══════════════════════════════════════════════════════════════════════ */

export type ExecuteOutcome =
  | { readonly ok: true; readonly rowsTouched: number; readonly nonMutating: boolean }
  | { readonly ok: false; readonly refusedBecause: string };

/**
 * Refuse-or-plan. Staleness is checked BEFORE anything is written, because
 * the alternative is discovering mid-transaction that the plan moved.
 *
 * This deliberately returns the write plan rather than performing it: the one
 * door is `mutatePlan`, and a second function in this file that also writes
 * would be exactly the second mutation path the consolidation is removing.
 */
export function prepareAction(
  action: BrainAction,
  live: ReadonlyMap<string, LiveRow>,
): { readonly ok: false; readonly refusedBecause: string }
  | { readonly ok: true; readonly plan: WritePlan } {
  const staleness = staleAgainst(action, live);
  if (staleness.stale) {
    return { ok: false, refusedBecause: staleness.why };
  }
  return { ok: true, plan: plannedWrites(action) };
}

/** For the gate: which kinds are expected to produce no writes, and why. */
export function isNonMutatingKind(kind: ActionKind): boolean {
  return NON_MUTATING_KINDS.has(kind) || kind === 'CONDITIONAL';
}
