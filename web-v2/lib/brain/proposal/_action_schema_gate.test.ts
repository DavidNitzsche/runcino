/**
 * THE ACTION SCHEMA GATE.
 *
 * WHAT THIS ASSERTS
 *   1 · Every kind in the union reaches real writes, or is non-mutating for a
 *       stated reason. No kind may quietly do nothing.
 *   2 · A proposal raised against one plan cannot mutate a newer one.
 *   3 · The union can express INCREASE as fluently as DECREASE (Rule 21/22).
 *
 * WHAT THIS CANNOT FAIL ON — stated here because Rule 22 requires it:
 *   · Whether the write is GOOD COACHING. A pace change to 4:00/mi maps to a
 *     perfectly well-formed write and this file will pass it. Sizing belongs to
 *     the adjudicator and the plan validator.
 *   · Whether anything ever RAISES these actions. A union nobody constructs is
 *     still fully covered here. That is `_lever_coverage` gate's question.
 *   · Whether the phone renders them. Swift is not in this process.
 *
 * LIVENESS · the exhaustiveness comes from a `Record<ActionKind, …>`, so a new
 * kind is a COMPILE error rather than a silently-skipped row, and the count
 * assertion below catches a fixture map that has been gutted.
 */

import { describe, it, expect } from 'vitest';
import {
  ALL_ACTION_KINDS,
  type ActionKind,
  type BrainAction,
  type LiveRow,
  ACTION_SCHEMA_VERSION,
  staleAgainst,
  transitionAllowed,
} from './action';
import { plannedWrites, prepareAction, isNonMutatingKind } from './execute';
import { phoneDirectionOf, actionHeadline } from '@/lib/faff/v5-action-render';
import { actionFromPending } from './staleness';

const BEFORE = {
  planWorkoutId: 'pw_1',
  dateISO: '2026-09-22',
  type: 'tempo',
  distanceMi: 9.5,
  paceTargetSecPerMi: 430,
  planVersion: 'v7',
} as const;

const base = { schemaVersion: ACTION_SCHEMA_VERSION, before: [BEFORE] } as const;

/** One specimen per kind. Typed as a total Record, so the compiler is the gate. */
const SPECIMENS: Record<ActionKind, BrainAction> = {
  PACE_CHANGE: { ...base, kind: 'PACE_CHANGE', direction: 'MORE', lever: 'THRESHOLD', to: { unit: 'sec_per_mi', value: 424 } },
  DISTANCE_CHANGE: { ...base, kind: 'DISTANCE_CHANGE', direction: 'MORE', to: { unit: 'mi', value: 11 } },
  DURATION_CHANGE: { ...base, kind: 'DURATION_CHANGE', direction: 'LESS', to: { unit: 'min', value: 50 } },
  REPETITION_CHANGE: { ...base, kind: 'REPETITION_CHANGE', direction: 'MORE', to: { unit: 'reps', value: 6 } },
  RECOVERY_INTERVAL_CHANGE: { ...base, kind: 'RECOVERY_INTERVAL_CHANGE', direction: 'LESS', to: { unit: 'min', value: 2 } },
  QUALITY_DOSE_CHANGE: { ...base, kind: 'QUALITY_DOSE_CHANGE', direction: 'MORE', lever: 'THRESHOLD', to: { unit: 'mi', value: 6 } },
  LONG_RUN_STRUCTURE_CHANGE: { ...base, kind: 'LONG_RUN_STRUCTURE_CHANGE', direction: 'MORE', to: 'LONG_MP', describe: 'last 6 at MP' },
  WORKOUT_TYPE_CHANGE: { ...base, kind: 'WORKOUT_TYPE_CHANGE', direction: 'LESS', to: 'easy' },
  ADD_WORKOUT: { ...base, before: [], kind: 'ADD_WORKOUT', direction: 'MORE', dateISO: '2026-09-24', type: 'easy', distanceMi: 5 },
  REMOVE_WORKOUT: { ...base, kind: 'REMOVE_WORKOUT', direction: 'LESS' },
  FREQUENCY_CHANGE: { ...base, kind: 'FREQUENCY_CHANGE', direction: 'LESS', to: { unit: 'count', value: 5 } },
  RESCHEDULE: { ...base, kind: 'RESCHEDULE', direction: 'NEUTRAL', toDateISO: '2026-09-23', swapWithId: null },
  COORDINATED: {
    ...base, kind: 'COORDINATED', direction: 'MORE', describe: 're-anchor threshold across the block',
    parts: [{ ...base, kind: 'PACE_CHANGE', direction: 'MORE', lever: 'THRESHOLD', to: { unit: 'sec_per_mi', value: 424 } }],
  },
  RACE_TARGET_CHANGE: { ...base, kind: 'RACE_TARGET_CHANGE', direction: 'MORE', raceSlug: 'cim-2026', toSecPerMi: 412 },
  TAPER_CHANGE: { ...base, kind: 'TAPER_CHANGE', direction: 'LESS', describe: 'deepen the final week' },
  RECOVERY_CHANGE: { ...base, kind: 'RECOVERY_CHANGE', direction: 'LESS', describe: 'add a rest day' },
  CONDITIONAL: { ...base, kind: 'CONDITIONAL', direction: 'MORE', defaultTo: { unit: 'mi', value: 5.5 }, earnedTo: { unit: 'mi', value: 7 }, assessOnISO: '2026-09-20' },
  FIELD_TEST: { ...base, kind: 'FIELD_TEST', direction: 'NEUTRAL', describe: '3 mi time trial' },
  HOLD: { ...base, kind: 'HOLD', direction: 'NEUTRAL', because: 'one hard week is not evidence' },
  REFUSAL: { ...base, kind: 'REFUSAL', direction: 'NEUTRAL', because: 'the HR trace is not credible' },
  SAFETY_STOP: { ...base, kind: 'SAFETY_STOP', direction: 'STOP', because: 'escalating pain reported', until: null },
};

const LIVE: ReadonlyMap<string, LiveRow> = new Map([['pw_1', { ...BEFORE }]]);

describe('action schema · coverage', () => {
  it('exercises every kind in the union', () => {
    const covered = Object.keys(SPECIMENS) as ActionKind[];
    expect(covered.length).toBe(ALL_ACTION_KINDS.length);
    expect(covered.length).toBeGreaterThan(0);
    for (const k of ALL_ACTION_KINDS) expect(covered).toContain(k);
  });

  it('every kind either writes or is non-mutating for a stated reason', () => {
    for (const kind of ALL_ACTION_KINDS) {
      const plan = plannedWrites(SPECIMENS[kind]);
      if (plan.nonMutating) {
        expect(isNonMutatingKind(kind), `${kind} produced no writes but is not a declared non-mutating kind`).toBe(true);
        expect(plan.because.length, `${kind} refused without saying why`).toBeGreaterThan(0);
      } else {
        expect(plan.writes.length, `${kind} claims to mutate and produced no writes`).toBeGreaterThan(0);
      }
    }
  });

  it('a mutating kind names the rows it will touch', () => {
    for (const kind of ALL_ACTION_KINDS) {
      const plan = plannedWrites(SPECIMENS[kind]);
      if (plan.nonMutating) continue;
      for (const w of plan.writes) {
        if (w.op === 'insert') expect(w.dateISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        else expect(w.planWorkoutId.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('action schema · staleness', () => {
  it('accepts an action whose before state still matches', () => {
    expect(staleAgainst(SPECIMENS.DISTANCE_CHANGE, LIVE).stale).toBe(false);
  });

  it('refuses when the plan was rebuilt under it', () => {
    const rebuilt = new Map(LIVE);
    rebuilt.set('pw_1', { ...BEFORE, planVersion: 'v8' });
    const v = staleAgainst(SPECIMENS.DISTANCE_CHANGE, rebuilt);
    expect(v.stale).toBe(true);
    if (v.stale) expect(v.why).toContain('the plan changed');
  });

  it('refuses when the row is gone rather than treating absence as fine', () => {
    const v = staleAgainst(SPECIMENS.DISTANCE_CHANGE, new Map());
    expect(v.stale).toBe(true);
    if (v.stale) expect(v.why).toContain('no longer exists');
  });

  it('refuses when the session already changed type or distance', () => {
    const moved = new Map(LIVE);
    moved.set('pw_1', { ...BEFORE, distanceMi: 7 });
    expect(staleAgainst(SPECIMENS.DISTANCE_CHANGE, moved).stale).toBe(true);
  });

  it('checks the parts of a coordinated action, not just its own before list', () => {
    const rebuilt = new Map(LIVE);
    rebuilt.set('pw_1', { ...BEFORE, paceTargetSecPerMi: 999 });
    expect(staleAgainst(SPECIMENS.COORDINATED, rebuilt).stale).toBe(true);
  });

  it('prepareAction refuses a stale action before planning any write', () => {
    const out = prepareAction(SPECIMENS.DISTANCE_CHANGE, new Map());
    expect(out.ok).toBe(false);
  });
});

describe('action schema · the union is not one-directional (Rule 21)', () => {
  it('can express an increase in every lever it can express a decrease in', () => {
    // The old payload carried newType / newDate / shaveFraction. Shave is the
    // whole story: the lane could make a session smaller and nothing else.
    const canGrow = ALL_ACTION_KINDS.filter((k) => {
      const s = SPECIMENS[k];
      return !plannedWrites({ ...s, direction: 'MORE' } as BrainAction).nonMutating;
    });
    const canShrink = ALL_ACTION_KINDS.filter((k) => {
      const s = SPECIMENS[k];
      return !plannedWrites({ ...s, direction: 'LESS' } as BrainAction).nonMutating;
    });
    expect(canGrow.length).toBe(canShrink.length);
    expect(canGrow.length).toBeGreaterThanOrEqual(15);
  });
});

describe('action schema · lifecycle', () => {
  it('a declined proposal is terminal', () => {
    expect(transitionAllowed('declined', 'accepted')).toBe(false);
    expect(transitionAllowed('declined', 'applied')).toBe(false);
  });

  it('a pending proposal cannot skip acceptance and apply itself', () => {
    expect(transitionAllowed('pending', 'applied')).toBe(false);
    expect(transitionAllowed('accepted', 'applied')).toBe(true);
  });

  it('an applied proposal can be undone but not re-accepted', () => {
    expect(transitionAllowed('applied', 'undone')).toBe(true);
    expect(transitionAllowed('applied', 'accepted')).toBe(false);
  });
});

describe('action schema · every kind reaches the runner', () => {
  it('has a direction and a headline for every kind, with nothing withheld', () => {
    let rendered = 0;
    for (const kind of ALL_ACTION_KINDS) {
      const a = SPECIMENS[kind];
      const dir = phoneDirectionOf(a);
      expect(['push', 'hold', 'pull_back', 'move', 'recovery', 'stop'],
        `${kind} produced a direction the card cannot draw`).toContain(dir);
      const head = actionHeadline(a, 'Tuesday');
      expect(head.trim().length, `${kind} has an empty headline`).toBeGreaterThan(0);
      expect(head, `${kind}'s headline leaked an engine word`).not.toMatch(/undefined|NaN|\[object/);
      rendered += 1;
    }
    // Liveness (Rule 18): fail loudly rather than report clean on zero.
    expect(rendered).toBe(ALL_ACTION_KINDS.length);
  });

  it('a push reads as a push and a pull-back as a pull-back', () => {
    expect(phoneDirectionOf({ ...SPECIMENS.DISTANCE_CHANGE, direction: 'MORE' } as BrainAction)).toBe('push');
    expect(phoneDirectionOf({ ...SPECIMENS.DISTANCE_CHANGE, direction: 'LESS' } as BrainAction)).toBe('pull_back');
  });

  it('prescribed easing is not drawn as a pull-back', () => {
    // Being told to taper and being told you overreached are different things
    // to read on a Tuesday, and the card's colour is the whole difference.
    expect(phoneDirectionOf(SPECIMENS.TAPER_CHANGE)).toBe('recovery');
    expect(phoneDirectionOf(SPECIMENS.RECOVERY_CHANGE)).toBe('recovery');
    expect(phoneDirectionOf(SPECIMENS.SAFETY_STOP)).toBe('stop');
  });

  it('never prints a raw seconds-per-mile at the runner', () => {
    expect(actionHeadline(SPECIMENS.PACE_CHANGE, 'Tuesday')).toContain('7:04');
    expect(actionHeadline(SPECIMENS.RACE_TARGET_CHANGE, 'Tuesday')).toContain('6:52');
  });
});

describe('action schema · what the proposal did not record is not a change', () => {
  /**
   * The bug this pins, caught before it shipped: every proposal written before
   * the action schema carries no plan version and, for most triggers, no
   * prescribed distance. An earlier cut of `actionFromPending` filled those in
   * as `null`, the staleness check read the live values as differences, and the
   * Accept button would have refused EVERY card on the runner's phone with
   * "the plan changed since this was raised".
   *
   * A staleness check that refuses everything is not a safe staleness check.
   * It is an Accept button that does nothing, which is the failure this whole
   * consolidation exists to stop.
   */
  const LEGACY_ROW = {
    actionKind: 'shave',
    planWorkoutId: 'pw_1',
    workoutDateISO: '2026-09-22',
    actionPayload: { shaveFraction: 0.17 },
    evidence: {},
  };

  it('accepts a legacy proposal that recorded no plan version', () => {
    const action = actionFromPending(LEGACY_ROW);
    expect(action).not.toBeNull();
    expect(staleAgainst(action!, LIVE).stale).toBe(false);
  });

  it('still catches a real change on a field the proposal DID record', () => {
    const action = actionFromPending({ ...LEGACY_ROW, evidence: { planned_distance_mi: 9.5 } });
    const resized = new Map(LIVE);
    resized.set('pw_1', { ...BEFORE, distanceMi: 6 });
    expect(staleAgainst(action!, resized).stale).toBe(true);
    expect(staleAgainst(action!, LIVE).stale).toBe(false);
  });

  it('a recorded null is compared; an unrecorded field is not', () => {
    const recordedNull: BrainAction = {
      ...base, kind: 'DISTANCE_CHANGE', direction: 'LESS',
      before: [{ planWorkoutId: 'pw_1', distanceMi: null }],
      to: { unit: 'mi', value: 5 },
    };
    // LIVE says 9.5 mi. The proposal claims it was null, so that IS a change.
    expect(staleAgainst(recordedNull, LIVE).stale).toBe(true);

    const unrecorded: BrainAction = {
      ...base, kind: 'DISTANCE_CHANGE', direction: 'LESS',
      before: [{ planWorkoutId: 'pw_1' }],
      to: { unit: 'mi', value: 5 },
    };
    expect(staleAgainst(unrecorded, LIVE).stale).toBe(false);
  });
});
