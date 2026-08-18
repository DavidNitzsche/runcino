/**
 * Execution interpretation · the five cases from
 * `Design/execution-memory-firing.md` Part 1, verbatim.
 *
 * They are the spec, so they are the tests. Each `describe` below is one of
 * David's worked examples with his expected output.
 */

import { describe, it, expect } from 'vitest';
import {
  interpretExecution,
  earnsProgressionCredit,
  EQUIVALENT_WORK_TOLERANCE,
  type Stimulus,
} from './interpret';

const T_PACE = 462; // 7:42/mi

/** 5 × 1 mile threshold · 5 miles of work, ~38 min, short jog recoveries. */
const PLANNED_5x1: Stimulus = {
  domain: 'threshold',
  workMinutes: 38.5,
  workMi: 5,
  meanWorkPaceSPerMi: T_PACE,
  recoveryIntent: 'incomplete',
};

describe('case 1 · same effort, different shape', () => {
  // "Planned 5 × 1 mile threshold. Executed 3 × 2 miles threshold because the
  // track was closed. The athlete did not fail the plan. They solved a
  // logistics problem."
  const ran_3x2: Stimulus = {
    domain: 'threshold',
    workMinutes: 46.2,
    workMi: 6,
    meanWorkPaceSPerMi: T_PACE,
    recoveryIntent: 'incomplete',
  };

  it('is EQUIVALENT with full stimulus completion', () => {
    const r = interpretExecution(PLANNED_5x1, ran_3x2);
    expect(r.state).toBe('EQUIVALENT');
    expect(r.stimulusCompletion).toBe(1);
  });

  it('earns full execution credit — equivalent work earns equivalent credit', () => {
    const r = interpretExecution(PLANNED_5x1, ran_3x2);
    expect(r.evidence.execution).toBe('full');
    expect(earnsProgressionCredit(r)).toBe(true);
  });

  it('counts as evidence rather than as a failed plan', () => {
    const r = interpretExecution(PLANNED_5x1, ran_3x2);
    expect(r.evidence.fitness).not.toBe('none');
    expect(r.why).toMatch(/same stimulus|another way/i);
  });

  it('is NOT equivalent when the recovery structure changed', () => {
    // "Lengthening rest changes the workout" — Research/04 §5.3.
    const withFullRest: Stimulus = { ...ran_3x2, recoveryIntent: 'complete' };
    expect(interpretExecution(PLANNED_5x1, withFullRest).state).not.toBe('EQUIVALENT');
  });

  it('is NOT equivalent when the intensity domain changed', () => {
    // Same duration, easy pace. That is a different session entirely.
    const easyInstead: Stimulus = { ...ran_3x2, domain: 'easy' };
    expect(interpretExecution(PLANNED_5x1, easyInstead).state).not.toBe('EQUIVALENT');
  });
});

describe('case 2 · cut short because the athlete was cooked', () => {
  // "Planned 5 × 1 mile. Executed 3 reps, then stopped because pace collapsed
  // / RPE spiked. execution_state = PARTIAL_FAILED, stimulus_completion 55-70%."
  const three_reps: Stimulus = {
    domain: 'threshold',
    workMinutes: 23.1,
    workMi: 3,
    meanWorkPaceSPerMi: T_PACE + 12,
    recoveryIntent: 'incomplete',
  };
  const cooked = { effortCollapsed: true };

  it('is PARTIAL_FAILED, with completion in the 55-70% band', () => {
    const r = interpretExecution(PLANNED_5x1, three_reps, cooked);
    expect(r.state).toBe('PARTIAL_FAILED');
    expect(r.stimulusCompletion).toBeGreaterThan(0.55);
    expect(r.stimulusCompletion).toBeLessThan(0.7);
  });

  it('gives training credit — 60% completed is not zero', () => {
    const r = interpretExecution(PLANNED_5x1, three_reps, cooked);
    expect(r.evidence.execution).toBe('partial');
    expect(r.stimulusCompletion).toBeGreaterThan(0);
  });

  it('does NOT give progression credit — it is not evidence of room for more', () => {
    // "Do not reward them as though 60% completed demonstrates capacity for 110%."
    const r = interpretExecution(PLANNED_5x1, three_reps, cooked);
    expect(earnsProgressionCredit(r)).toBe(false);
    expect(r.evidence.adaptation).toBe('negative');
  });

  it('cut short WITHOUT the effort collapsing is productive, not failed', () => {
    const r = interpretExecution(PLANNED_5x1, three_reps, {});
    expect(r.state).toBe('PARTIAL_PRODUCTIVE');
    expect(r.evidence.adaptation).not.toBe('negative');
  });
});

describe('evidence value is separate from execution credit', () => {
  // "Partially executed, high evidence: athlete fails badly at a pace
  // previously considered established. That may be extremely informative."
  it('failing at an ESTABLISHED pace is low execution credit and HIGH fitness evidence', () => {
    const collapsedAtKnownPace: Stimulus = {
      domain: 'threshold',
      workMinutes: 23.1,
      workMi: 3,
      meanWorkPaceSPerMi: T_PACE,
      recoveryIntent: 'incomplete',
    };
    const r = interpretExecution(PLANNED_5x1, collapsedAtKnownPace, {
      effortCollapsed: true,
      establishedPaceSPerMi: T_PACE,
    });
    expect(r.evidence.execution).toBe('partial');
    expect(r.evidence.fitness).toBe('high');
    expect(r.why).toMatch(/comfortable before/i);
  });

  it('a fully executed easy run is full credit and says nothing about racing', () => {
    const easy: Stimulus = {
      domain: 'easy', workMinutes: 45, workMi: 5.2,
      meanWorkPaceSPerMi: 560, recoveryIntent: 'none',
    };
    const r = interpretExecution(easy, easy);
    expect(r.evidence.execution).toBe('full');
    expect(r.evidence.fitness).toBe('none');
  });

  it('no single field controls all four readings', () => {
    const r = interpretExecution(PLANNED_5x1, {
      domain: 'threshold', workMinutes: 23.1, workMi: 3,
      meanWorkPaceSPerMi: T_PACE, recoveryIntent: 'incomplete',
    }, { effortCollapsed: true, establishedPaceSPerMi: T_PACE });
    const e = r.evidence;
    // partial execution, negative adaptation, high fitness, meaningful risk —
    // four different answers from one session.
    expect(new Set([e.execution, e.adaptation, e.fitness, e.risk]).size).toBeGreaterThan(2);
  });
});

describe('case 4 · session replaced by a race', () => {
  it('is REPLACED, not a miss, and carries high fitness evidence', () => {
    const r = interpretExecution(PLANNED_5x1, null, { replacedByRace: true });
    expect(r.state).toBe('REPLACED');
    expect(r.evidence.fitness).toBe('high');
  });

  it('flags the recovery cost — replacement does not mean equivalence', () => {
    const r = interpretExecution(PLANNED_5x1, null, { replacedByRace: true });
    expect(r.evidence.risk).not.toBe('none');
    expect(r.why).toMatch(/recovery cost|rest of the week/i);
  });
});

describe('case 5 · unplanned extra run', () => {
  // "Extra training is data, not achievement."
  const extraEasy: Stimulus = {
    domain: 'easy', workMinutes: 30, workMi: 3.4,
    meanWorkPaceSPerMi: 560, recoveryIntent: 'none',
  };
  const extraHard: Stimulus = {
    domain: 'threshold', workMinutes: 55, workMi: 8,
    meanWorkPaceSPerMi: T_PACE, recoveryIntent: 'none',
  };

  it('is EXTRA and never bonus compliance', () => {
    const r = interpretExecution(PLANNED_5x1, extraEasy, { unplanned: true });
    expect(r.state).toBe('EXTRA');
    expect(r.stimulusCompletion).toBe(0);
    expect(r.evidence.execution).toBe('none');
  });

  it('earns no progression credit — more work is not evidence more work was right', () => {
    for (const s of [extraEasy, extraHard]) {
      expect(earnsProgressionCredit(interpretExecution(PLANNED_5x1, s, { unplanned: true }))).toBe(false);
    }
  });

  it('an unplanned hard run carries risk that an easy jog does not', () => {
    const easy = interpretExecution(PLANNED_5x1, extraEasy, { unplanned: true });
    const hard = interpretExecution(PLANNED_5x1, extraHard, { unplanned: true });
    expect(easy.evidence.risk).toBe('none');
    expect(hard.evidence.risk).toBe('watch');
  });
});

describe('missed', () => {
  it('nothing run is MISSED with no evidence of anything', () => {
    const r = interpretExecution(PLANNED_5x1, null);
    expect(r.state).toBe('MISSED');
    expect(r.stimulusCompletion).toBe(0);
    expect(r.evidence.fitness).toBe('none');
    // Absence of evidence is not evidence of poor adaptation.
    expect(r.evidence.adaptation).toBe('unknown');
  });
});

describe('the equivalence band is doctrine s, not invented', () => {
  it('tolerates the brief s own worked example · 5 mi becomes 6 mi', () => {
    expect(Math.abs(6 / 5 - 1)).toBeLessThanOrEqual(EQUIVALENT_WORK_TOLERANCE);
  });

  it('two volumes both inside Research/04 s 4-8 mi threshold band are the same session', () => {
    // 4 mi planned, 7.5 mi run is +88% — past the ratio, but doctrine calls
    // every point in 4-8 the same prescription.
    const planned: Stimulus = { ...PLANNED_5x1, workMi: 4, workMinutes: 30.8 };
    const ran: Stimulus = { ...PLANNED_5x1, workMi: 7.5, workMinutes: 57.8 };
    expect(interpretExecution(planned, ran).state).toBe('EQUIVALENT');
  });

  it('outside the band and outside the ratio is not equivalent', () => {
    const ran: Stimulus = { ...PLANNED_5x1, workMi: 11, workMinutes: 84.7 };
    expect(interpretExecution(PLANNED_5x1, ran).state).not.toBe('EQUIVALENT');
  });
});

describe('rule 4 · training credit and progression credit are different currencies', () => {
  it('every partial state earns training credit and withholds progression', () => {
    const partial: Stimulus = { ...PLANNED_5x1, workMi: 3, workMinutes: 23.1 };
    for (const ctx of [{ effortCollapsed: true }, {}]) {
      const r = interpretExecution(PLANNED_5x1, partial, ctx);
      expect(r.stimulusCompletion).toBeGreaterThan(0);
      expect(earnsProgressionCredit(r)).toBe(false);
    }
  });

  it('only a fully delivered stimulus earns progression', () => {
    expect(earnsProgressionCredit(interpretExecution(PLANNED_5x1, PLANNED_5x1))).toBe(true);
  });
});
