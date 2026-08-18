/**
 * Reconstruction · the two `Stimulus` values the interpreter compares, and the
 * context flags it reasons over.
 *
 * Most of these are locks on things the live data got wrong before they were
 * written, and the fixtures are the real shapes rather than invented ones.
 */

import { describe, it, expect } from 'vitest';
import {
  actualDomain,
  actualStimulus,
  establishedPaceFor,
  executionContext,
  paceDomain,
  plannedDomain,
  plannedStimulus,
  DOMAIN_WINDOW_FASTER_S,
  DOMAIN_WINDOW_SLOWER_S,
  type PlannedSession,
} from './reconstruct';
import { runPhases, watchStoppedInsideWork, workToleranceShare, asRunData } from '@/lib/runs/run-shape';

const T = 462; // David's T-pace at VDOT 44.1, 7:42/mi.
const VDOT = 44.1;

/** A 2 mi warm-up, 4 mi of tempo, 2 mi cool-down — the shape of every quality
 *  day in the AFC block. */
function tempoSession(over: Partial<PlannedSession> = {}): PlannedSession {
  return {
    dateISO: '2026-07-07',
    type: 'tempo',
    isQuality: true,
    isLong: false,
    distanceMi: 8,
    paceTargetSPerMi: 419,
    spec: {
      kind: 'tempo', warmup_mi: 2, cooldown_mi: 2,
      tempo_distance_mi: 4, tempo_pace_s_per_mi: 419, hr_target_bpm: 149,
    },
    ...over,
  };
}

/* ════════════════════════════════════════════════════════════ domains */

describe('domain · the session is the session, run well or badly', () => {
  it('reads the plan s intent rather than inferring it from a pace', () => {
    expect(plannedDomain('tempo', { kind: 'tempo' })).toBe('threshold');
    expect(plannedDomain('intervals', { kind: 'intervals' })).toBe('interval');
    expect(plannedDomain('race', null)).toBe('race');
    expect(plannedDomain('long', { kind: 'long' })).toBe('easy');
    // A long run with a closing block at half-marathon pace IS the stimulus.
    expect(plannedDomain('long', { kind: 'long', finish_mi: 6 })).toBe('marathon');
  });

  it('keeps the intended domain for work run inside the session s own window', () => {
    const inside = (pace: number) => actualDomain({
      intended: 'threshold', workTargetSPerMi: 419, actualPaceSPerMi: pace, tPaceSPerMi: T,
    });
    // 27 s/mi slow. Executed badly, not a different session — and the verdict
    // path already grades that miss at ±10 with a heat adjustment. Counting it
    // here too would count one miss twice.
    expect(inside(446)).toBe('threshold');
    expect(inside(419 + DOMAIN_WINDOW_SLOWER_S)).toBe('threshold');
    expect(inside(419 - DOMAIN_WINDOW_FASTER_S)).toBe('threshold');
  });

  it('names what was actually run once the work leaves that window', () => {
    // Easy jogging on a threshold day is a different session entirely — the
    // case `interpretExecution` refuses equivalence for.
    expect(actualDomain({
      intended: 'threshold', workTargetSPerMi: 419, actualPaceSPerMi: T + 100, tPaceSPerMi: T,
    })).toBe('easy');
  });

  it('rounds to whole seconds before deciding · a tenth must not pick the system', () => {
    // The live case: three treadmill reps each at exactly the prescribed
    // 389 s/mi, whose duration-derived mean came out 388.9 and fell out of its
    // own domain, taking the session with it.
    expect(actualDomain({
      intended: 'threshold', workTargetSPerMi: 419, actualPaceSPerMi: 388.9, tPaceSPerMi: T,
    })).toBe('threshold');
  });

  it('a race is a race whatever pace it was run at', () => {
    // David ran AFC 61 s/mi slower than the goal the plan was built on. That
    // is a fitness finding, not evidence he ran a different kind of session.
    expect(actualDomain({
      intended: 'race', workTargetSPerMi: 405, actualPaceSPerMi: 466, tPaceSPerMi: T,
    })).toBe('race');
  });

  it('assumes the session when there is nothing to place the work against', () => {
    expect(actualDomain({
      intended: 'threshold', workTargetSPerMi: null, actualPaceSPerMi: null, tPaceSPerMi: null,
    })).toBe('threshold');
  });

  it('paceDomain sits on derivePaces own anchors', () => {
    expect(paceDomain(T - 30, T)).toBe('repetition');
    expect(paceDomain(T - 18, T)).toBe('interval');
    expect(paceDomain(T, T)).toBe('threshold');
    expect(paceDomain(T + 18, T)).toBe('marathon');
    expect(paceDomain(T + 100, T)).toBe('easy');
  });

  it('the established pace for a domain comes from the runner s own anchor', () => {
    expect(establishedPaceFor('threshold', VDOT)).toBe(T);
    expect(establishedPaceFor('interval', VDOT)).toBe(T - 18);
    expect(establishedPaceFor('threshold', null)).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════ planned stimulus */

describe('planned stimulus', () => {
  it('reads the progression block first when the row carries one', () => {
    const r = plannedStimulus(tempoSession({
      spec: {
        kind: 'threshold', rep_count: 4, rep_distance_mi: 1, rep_rest_s: 90,
        rep_pace_s_per_mi: 440,
        progression: {
          reps: 5, rep_minutes: 7, recovery_minutes: 1.5,
          pace_s_per_mi: 440, zone: 'PROGRESSIVE', lever: null,
        },
      },
      type: 'threshold',
    }), { vdot: VDOT });
    expect(r?.basis).toBe('progression-spec');
    expect(r?.stimulus.workMinutes).toBe(35);
    expect(r?.stimulus.recoveryIntent).toBe('incomplete');
    expect(r?.workTargetSPerMi).toBe(440);
  });

  it('falls back to the app s own spec expander · work phases only', () => {
    const r = plannedStimulus(tempoSession(), { vdot: VDOT });
    expect(r?.basis).toBe('expanded-spec');
    // 4 miles of tempo — the warm-up and cool-down are not the stimulus.
    expect(r?.stimulus.workMi).toBeCloseTo(4, 2);
    expect(r?.stimulus.meanWorkPaceSPerMi).toBeCloseTo(419, 0);
    expect(r?.stimulus.domain).toBe('threshold');
    expect(r?.stimulus.recoveryIntent).toBe('none');
  });

  it('abstains rather than claim a quality day was eight miles at threshold', () => {
    // The plan row's distance is the WHOLE run and its pace is the WORK pace.
    // Reading them together is how "8 mi @ 6:59" gets invented.
    const r = plannedStimulus(tempoSession({ spec: null }), { vdot: VDOT });
    expect(r).toBeNull();
  });

  it('uses the bare plan row where the target IS a whole-run pace', () => {
    const r = plannedStimulus({
      dateISO: '2026-07-12', type: 'long', isQuality: false, isLong: true,
      distanceMi: 12, paceTargetSPerMi: 480, spec: null,
    }, { vdot: VDOT });
    expect(r?.basis).toBe('plan-row');
    expect(r?.stimulus.workMi).toBe(12);
    expect(r?.stimulus.domain).toBe('easy');
  });
});

/* ════════════════════════════════════════════════════ actual stimulus */

describe('actual stimulus', () => {
  const planned = plannedStimulus(tempoSession(), { vdot: VDOT })!;

  /** The live 2026-07-07 row, trimmed to the fields that matter. */
  const watchRow = asRunData({
    date: '2026-07-07', distanceMi: 7.56, movingTimeS: 3695,
    phases: [
      { index: 0, type: 'warmup', label: 'Warm-up', targetPaceSPerMi: 537, actualPaceSPerMi: 524, actualDistanceMi: 2, actualDurationSec: 1049, verdict: 'drifted', completed: true, timeInToleranceSec: 480, timeOutOfToleranceSec: 555 },
      { index: 1, type: 'work', label: '4.0 mi tempo', targetPaceSPerMi: 419, actualPaceSPerMi: 446, actualDistanceMi: 4, actualDurationSec: 1786, verdict: 'missed', completed: true, timeInToleranceSec: 1140, timeOutOfToleranceSec: 640 },
      { index: 2, type: 'cooldown', label: 'Cool-down', targetPaceSPerMi: 537, actualPaceSPerMi: 552, actualDistanceMi: 1.56, actualDurationSec: 860, verdict: 'incomplete', completed: false, timeInToleranceSec: 360, timeOutOfToleranceSec: 495 },
    ],
    status: 'abandoned',
  });

  it('takes the work from the watch s own phases and nothing else', () => {
    const a = actualStimulus(watchRow, planned, tempoSession(), { vdot: VDOT });
    expect(a?.basis).toBe('watch-phases');
    // 4 miles, not the 7.56 the runner covered. Warm-up and cool-down are not
    // the stimulus, and every distance-heuristic read of this run counted them.
    expect(a?.stimulus.workMi).toBeCloseTo(4, 2);
    expect(a?.stimulus.workMinutes).toBeCloseTo(1786 / 60, 2);
    expect(a?.stimulus.meanWorkPaceSPerMi).toBeCloseTo(446.5, 0);
  });

  it('carries the device s own grades through instead of re-deriving them', () => {
    const a = actualStimulus(watchRow, planned, tempoSession(), { vdot: VDOT });
    expect(a?.watchStatus).toBe('abandoned');
    expect(a?.workVerdicts).toEqual(['missed']);
    // 1140 of 1780 graded seconds inside the band, per the device, against the
    // server's own tolerance. Nothing read this number before.
    expect(a?.toleranceShare).toBeCloseTo(1140 / 1780, 3);
  });

  it('accepts the status from the completion blob for rows written before it was stored', () => {
    const noStatus = asRunData({ ...watchRow, status: undefined });
    const a = actualStimulus(noStatus, planned, tempoSession(), {
      vdot: VDOT, watchStatusFallback: 'abandoned',
    });
    expect(a?.watchStatus).toBe('abandoned');
  });

  it('returns null — never a zero — when a run exists and no basis can read it', () => {
    const opaque = asRunData({ date: '2026-07-07', distanceMi: 7.5 });
    expect(actualStimulus(opaque, planned, tempoSession(), { vdot: VDOT })).toBeNull();
  });

  it('reads the whole run where the whole run is the work', () => {
    const longPlanned = plannedStimulus({
      dateISO: '2026-07-12', type: 'long', isQuality: false, isLong: true,
      distanceMi: 12, paceTargetSPerMi: 480, spec: null,
    }, { vdot: VDOT })!;
    const a = actualStimulus(
      asRunData({ date: '2026-07-12', distanceMi: 12.6, movingTimeS: 6276 }),
      longPlanned,
      { dateISO: '2026-07-12', type: 'long', isQuality: false, isLong: true, distanceMi: 12, paceTargetSPerMi: 480, spec: null },
      { vdot: VDOT },
    );
    expect(a?.basis).toBe('whole-run');
    expect(a?.stimulus.workMi).toBeCloseTo(12.6, 2);
  });
});

/* ══════════════════════════════════════════════════════════ collapse */

describe('the watch s `abandoned` is not the athlete coming apart', () => {
  const phasesWith = (workCompleted: boolean, cooldownCompleted: boolean) => [
    { index: 0, type: 'warmup', actualDurationSec: 600, completed: true },
    { index: 1, type: 'work', actualDurationSec: 1786, actualDistanceMi: 4, completed: workCompleted },
    { index: 2, type: 'cooldown', actualDurationSec: 500, completed: cooldownCompleted },
  ];

  it('a workout ended during the cool-down is `abandoned` and was fully executed', () => {
    // 13 of 50 live completions carry `abandoned`, including an 18-mile long
    // run. Reading the flag alone would mark every one of them as coming apart.
    const d = asRunData({ status: 'abandoned', phases: phasesWith(true, false) });
    expect(executionContext({ runData: d }).effortCollapsed).toBe(false);
  });

  it('a workout ended inside the work IS the athlete coming apart', () => {
    const d = asRunData({ status: 'abandoned', phases: phasesWith(false, false) });
    expect(executionContext({ runData: d }).effortCollapsed).toBe(true);
  });

  it('an unfinished work phase on a run the device called complete is not a collapse', () => {
    // Treadmill payloads stamp `completed` on every session and leave the
    // trailing phases false. Without the conjunction, every treadmill workout
    // would read as a failure.
    const d = asRunData({ status: 'completed', phases: phasesWith(false, false) });
    expect(executionContext({ runData: d }).effortCollapsed).toBe(false);
  });

  it('a session the runner reported as harder than prescribed collapses on its own', () => {
    const d = asRunData({ status: 'completed', phases: phasesWith(true, true) });
    expect(executionContext({ runData: d, rpe: 9 }).effortCollapsed).toBe(true);
    expect(executionContext({ runData: d, rpe: 5 }).effortCollapsed).toBe(false);
  });

  it('distinguishes "they finished" from "we cannot see"', () => {
    const noFlags = runPhases(asRunData({
      phases: [{ type: 'work', actualDurationSec: 600 }],
    }));
    expect(watchStoppedInsideWork(noFlags)).toBeNull();
    expect(workToleranceShare(noFlags)).toBeNull();
  });
});
