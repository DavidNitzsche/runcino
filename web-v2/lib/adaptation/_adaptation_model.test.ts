/**
 * Adaptation model · doctrine tests.
 *
 * These encode `Design/adaptive-progression-engine.md` System B directly, so
 * drift fails with the rule it broke rather than with a number that moved.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyAdaptation,
  MIN_WEEKS_FOR_STRONG,
  NIGGLE_VETO_SEVERITY,
  READINESS_MIN_WINDOW_DAYS,
  type AdaptationInput,
} from './adaptation-model';

/** A runner we can see clearly and who is doing fine. Tests mutate from here. */
function baseline(): AdaptationInput {
  return {
    keySessionsPlanned: 8,
    keySessionsCompleted: 8,
    targetVerdicts: ['on', 'on', 'on', 'on', 'on', 'on'],
    repConsistency: ['even', 'even', 'even'],
    rpeReported: 6,
    rpeHarderThanExpected: 0,
    decouplingVerdicts: ['race-ready', 'race-ready', 'building'],
    lateDriftBpm: [4, 5, 3],
    easyDiscipline: { established: false, read: null },
    recoveryPctOfExpected: 1.0,
    readinessBelowNormalDays: 4,
    readinessWindowDays: 28,
    weeklyPlannedMi: [40, 44, 46],
    weeklyActualMi: [40, 44, 46],
    trainingForm: 'PRODUCTIVE',
    distinctEvidenceWeeks: 4,
    adapterDowngrades: 0,
    niggleSeverity: 0,
    illnessActive: false,
    injuryActive: false,
  };
}

/** A runner we can barely see at all. */
function blind(): AdaptationInput {
  return {
    keySessionsPlanned: null,
    keySessionsCompleted: null,
    targetVerdicts: null,
    repConsistency: null,
    rpeReported: null,
    rpeHarderThanExpected: null,
    decouplingVerdicts: null,
    lateDriftBpm: null,
    easyDiscipline: null,
    recoveryPctOfExpected: null,
    readinessBelowNormalDays: null,
    readinessWindowDays: null,
    weeklyPlannedMi: null,
    weeklyActualMi: null,
    trainingForm: null,
    distinctEvidenceWeeks: null,
    adapterDowngrades: null,
    niggleSeverity: null,
    illnessActive: null,
    injuryActive: null,
  };
}

describe('absence of evidence is not evidence of poor adaptation', () => {
  it('a runner we cannot see gets normal + low confidence, never marginal or poor', () => {
    const v = classifyAdaptation(blind());
    expect(v.band).toBe('normal');
    expect(v.confidence).toBe('low');
    expect(v.decision).toBe('PROGRESS');
    expect(v.stepMultiplier).toBe(1);
  });

  it('a runner with no HR data is not penalised for the missing dimension', () => {
    const noHr: AdaptationInput = {
      ...baseline(),
      decouplingVerdicts: null,
      lateDriftBpm: null,
      rpeReported: null,
      rpeHarderThanExpected: null,
      easyDiscipline: null,
    };
    const v = classifyAdaptation(noHr);
    // internal_cost is unreadable and must be excluded from the mean, not zeroed.
    expect(v.dimensions.find((d) => d.dimension === 'internal_cost')!.score).toBeNull();
    expect(v.dimensions.find((d) => d.dimension === 'internal_cost')!.weight).toBe(0);
    expect(['strong', 'normal']).toContain(v.band);
  });

  it('unknown dimensions carry zero weight so they cannot drag the mean', () => {
    const v = classifyAdaptation(blind());
    expect(v.dimensions.every((d) => d.score == null && d.weight === 0)).toBe(true);
  });
});

describe('strong requires repeated evidence, not one good day', () => {
  it('excellent execution inside a single week cannot reach strong', () => {
    const oneWeek: AdaptationInput = { ...baseline(), distinctEvidenceWeeks: 1 };
    const v = classifyAdaptation(oneWeek);
    expect(v.band).not.toBe('strong');
    expect(v.stepMultiplier).toBeLessThanOrEqual(1);
  });

  it('the same evidence spread over enough weeks does reach strong', () => {
    const v = classifyAdaptation({ ...baseline(), distinctEvidenceWeeks: MIN_WEEKS_FOR_STRONG });
    expect(v.band).toBe('strong');
    expect(v.decision).toBe('PROGRESS');
    expect(v.stepMultiplier).toBeGreaterThan(1);
  });

  it('says plainly that it is waiting for a trend rather than going quiet', () => {
    const v = classifyAdaptation({ ...baseline(), distinctEvidenceWeeks: 1 });
    expect(v.summary).toMatch(/trend/i);
  });
});

describe('the doctrine progression table', () => {
  it('strong progresses and may accelerate', () => {
    const v = classifyAdaptation(baseline());
    expect(v.band).toBe('strong');
    expect(v.decision).toBe('PROGRESS');
    expect(v.stepMultiplier).toBeGreaterThan(1);
  });

  it('marginal holds the current stimulus rather than adding to it', () => {
    const struggling: AdaptationInput = {
      ...baseline(),
      keySessionsCompleted: 5,
      targetVerdicts: ['slow', 'slow', 'on', 'slow', 'on', 'on'],
      repConsistency: ['fading', 'fading', 'even'],
      trainingForm: 'LOADED',
      adapterDowngrades: 1,
    };
    const v = classifyAdaptation(struggling);
    expect(v.band).toBe('marginal');
    expect(v.decision).toBe('STAY');
    expect(v.stepMultiplier).toBe(0);
  });

  it('poor reduces or modifies the stimulus', () => {
    const failing: AdaptationInput = {
      ...baseline(),
      keySessionsCompleted: 2,
      targetVerdicts: ['slow', 'slow', 'slow', 'slow'],
      repConsistency: ['fading', 'fading', 'fading'],
      decouplingVerdicts: ['poor', 'poor', 'poor'],
      lateDriftBpm: [16, 18, 15],
      rpeReported: 6,
      rpeHarderThanExpected: 6,
      trainingForm: 'OVERREACH',
      weeklyActualMi: [26, 28, 24],
      adapterDowngrades: 4,
      easyDiscipline: { established: true, read: 'ran_faster_than_band' },
    };
    const v = classifyAdaptation(failing);
    expect(v.band).toBe('poor');
    expect(['MODIFY', 'PROTECT']).toContain(v.decision);
    expect(v.stepMultiplier).toBeLessThan(0);
  });
});

describe('execution is a gate — you cannot earn stress by not doing the work', () => {
  it('missed and missed-target sessions cap the band even when everything else is pristine', () => {
    // The trap this closes: skip the sessions and your HR, recovery and
    // decoupling all look excellent, because the stimulus that would have
    // taxed them was never delivered. Averaging calls that "absorbing well".
    const skipping: AdaptationInput = {
      ...baseline(),
      keySessionsCompleted: 5,
      targetVerdicts: ['slow', 'slow', 'on', 'slow', 'on', 'on'],
      repConsistency: ['fading', 'fading', 'even'],
    };
    const v = classifyAdaptation(skipping);
    expect(v.dimensions.find((d) => d.dimension === 'internal_cost')!.score).toBeGreaterThan(0);
    expect(v.dimensions.find((d) => d.dimension === 'recovery')!.score).toBeGreaterThan(0);
    expect(v.band).toBe('marginal');
    expect(v.decision).toBe('STAY');
  });

  it('wholesale non-execution caps at poor', () => {
    const absent: AdaptationInput = {
      ...baseline(),
      keySessionsCompleted: 1,
      targetVerdicts: ['slow', 'slow', 'slow', 'slow'],
      repConsistency: ['fading', 'fading', 'fading'],
    };
    expect(classifyAdaptation(absent).band).toBe('poor');
  });

  it('the gate explains itself in terms of the sessions, not the heart rate', () => {
    const skipping: AdaptationInput = {
      ...baseline(),
      keySessionsCompleted: 5,
      targetVerdicts: ['slow', 'slow', 'on', 'slow', 'on', 'on'],
      repConsistency: ['fading', 'fading', 'even'],
    };
    expect(classifyAdaptation(skipping).summary).toMatch(/session|rep/i);
  });
});

describe('vetoes outrank every other reading', () => {
  it('an active injury protects regardless of how well training was going', () => {
    const v = classifyAdaptation({ ...baseline(), injuryActive: true });
    expect(v.decision).toBe('PROTECT');
    expect(v.veto).toBe('injury_active');
    expect(v.band).toBe('poor');
  });

  it('illness protects, and the copy treats it as recovery not toughness', () => {
    const v = classifyAdaptation({ ...baseline(), illnessActive: true });
    expect(v.veto).toBe('illness');
    expect(v.decision).toBe('PROTECT');
    expect(v.summary).toMatch(/recovery/i);
  });

  it('a loud pain signal vetoes', () => {
    const v = classifyAdaptation({ ...baseline(), niggleSeverity: NIGGLE_VETO_SEVERITY });
    expect(v.veto).toBe('pain');
    expect(v.decision).toBe('PROTECT');
  });

  it('a quiet niggle does not veto', () => {
    const v = classifyAdaptation({ ...baseline(), niggleSeverity: NIGGLE_VETO_SEVERITY - 1 });
    expect(v.veto).toBeNull();
  });
});

describe('readiness informs, it never acts (locked 2026-08-17)', () => {
  it('a short readiness window is ignored entirely — daily reads do not act', () => {
    const shortWindow: AdaptationInput = {
      ...baseline(),
      recoveryPctOfExpected: null,
      readinessBelowNormalDays: READINESS_MIN_WINDOW_DAYS - 1,
      readinessWindowDays: READINESS_MIN_WINDOW_DAYS - 1,
    };
    const v = classifyAdaptation(shortWindow);
    // Every readiness day below normal, but the window is too short to speak.
    expect(v.dimensions.find((d) => d.dimension === 'recovery')!.score).toBeNull();
  });

  it('ordinary life variance does not read as poor adaptation', () => {
    // The 2026-08-17 audit: the old detector fired on 23% of days and was
    // measuring a 41-year-old with two kids and a company, not overreaching.
    const normalLife: AdaptationInput = {
      ...baseline(),
      readinessBelowNormalDays: 11,
      readinessWindowDays: 28,
    };
    const v = classifyAdaptation(normalLife);
    expect(v.band).toBe('strong');
  });

  it('a sustained multi-week deviation does count, and only then', () => {
    const sustained: AdaptationInput = {
      ...baseline(),
      readinessBelowNormalDays: 26,
      readinessWindowDays: 28,
    };
    const v = classifyAdaptation(sustained);
    const recovery = v.dimensions.find((d) => d.dimension === 'recovery')!;
    expect(recovery.score).toBeLessThan(0);
    expect(recovery.detail).toMatch(/own recovery normal/i);
  });

  it('readiness alone can never drive the verdict — it is the lightest dimension', () => {
    const onlyReadinessBad: AdaptationInput = {
      ...baseline(),
      readinessBelowNormalDays: 28,
      readinessWindowDays: 28,
      recoveryPctOfExpected: 0.4,
    };
    const v = classifyAdaptation(onlyReadinessBad);
    // Recovery is fully negative, everything else is excellent. The verdict
    // must not collapse to marginal on the strength of recovery alone.
    expect(['strong', 'normal']).toContain(v.band);
  });
});

describe('signal semantics that are easy to get backwards', () => {
  it("running quality FASTER than target is not counted as absorbing well", () => {
    const allFast: AdaptationInput = {
      ...baseline(),
      targetVerdicts: ['fast', 'fast', 'fast', 'fast', 'fast', 'fast'],
    };
    const onTarget = classifyAdaptation(baseline());
    const fast = classifyAdaptation(allFast);
    const exec = (v: ReturnType<typeof classifyAdaptation>) =>
      v.dimensions.find((d) => d.dimension === 'execution')!.score!;
    expect(exec(fast)).toBeLessThan(exec(onTarget));
  });

  it('easy days inside the band but with high HR do not cost the runner', () => {
    // `in_band_but_high_hr` points at the pace band, not the runner's choices.
    const bandProblem: AdaptationInput = {
      ...baseline(),
      easyDiscipline: { established: true, read: 'in_band_but_high_hr' },
    };
    const runnerProblem: AdaptationInput = {
      ...baseline(),
      easyDiscipline: { established: true, read: 'ran_faster_than_band' },
    };
    const cost = (v: ReturnType<typeof classifyAdaptation>) =>
      v.dimensions.find((d) => d.dimension === 'internal_cost')!.score!;
    expect(cost(classifyAdaptation(bandProblem))).toBeGreaterThan(cost(classifyAdaptation(runnerProblem)));
  });

  it('chronically over-running the plan is not scored as good consistency', () => {
    const overshoot: AdaptationInput = {
      ...baseline(),
      weeklyPlannedMi: [40, 44, 46],
      weeklyActualMi: [52, 58, 60],
    };
    const cons = (v: ReturnType<typeof classifyAdaptation>) =>
      v.dimensions.find((d) => d.dimension === 'consistency')!.score!;
    expect(cons(classifyAdaptation(overshoot))).toBeLessThan(cons(classifyAdaptation(baseline())));
  });

  it('sustained adapter downgrades read as not absorbing the plan', () => {
    const downgraded: AdaptationInput = { ...baseline(), adapterDowngrades: 4 };
    const trend = (v: ReturnType<typeof classifyAdaptation>) =>
      v.dimensions.find((d) => d.dimension === 'trend')!.score!;
    expect(trend(classifyAdaptation(downgraded))).toBeLessThan(trend(classifyAdaptation(baseline())));
  });
});

describe('the verdict is explainable', () => {
  it('every scored dimension carries a detail line a human can check', () => {
    const v = classifyAdaptation(baseline());
    for (const d of v.dimensions) {
      if (d.score != null) expect(d.detail.length).toBeGreaterThan(0);
    }
  });

  it('the summary stays in the coach register — no hype, no exclamation marks', () => {
    for (const input of [baseline(), blind(), { ...baseline(), injuryActive: true }]) {
      const v = classifyAdaptation(input);
      expect(v.summary).not.toMatch(/[!🔥]/);
      expect(v.summary.length).toBeGreaterThan(0);
    }
  });

  it('confidence tracks how much of the runner we can actually see', () => {
    expect(classifyAdaptation(blind()).confidence).toBe('low');
    expect(classifyAdaptation(baseline()).confidence).toBe('high');
  });
});

describe('consistency means the shape of the block, not just its average', () => {
  it('an interrupted block scores below a steady one at the same average', () => {
    const steady: AdaptationInput = {
      ...baseline(),
      weeklyPlannedMi: [50, 50, 50, 50, 50, 50],
      weeklyActualMi: [40, 40, 40, 40, 40, 40],
    };
    const interrupted: AdaptationInput = {
      ...baseline(),
      weeklyPlannedMi: [50, 50, 50, 50, 50, 50],
      weeklyActualMi: [50, 50, 50, 5, 50, 35],
    };
    const cons = (v: ReturnType<typeof classifyAdaptation>) =>
      v.dimensions.find((d) => d.dimension === 'consistency')!.score!;
    // Same 80% average, different blocks.
    expect(cons(classifyAdaptation(interrupted))).toBeLessThan(cons(classifyAdaptation(steady)));
  });

  it('names the missed week rather than hiding it in the mean', () => {
    const interrupted: AdaptationInput = {
      ...baseline(),
      weeklyPlannedMi: [50, 50, 50, 50, 50, 50],
      weeklyActualMi: [50, 50, 50, 5, 50, 35],
    };
    const detail = classifyAdaptation(interrupted).dimensions.find(
      (d) => d.dimension === 'consistency',
    )!.detail;
    expect(detail).toMatch(/one week at/i);
  });

  it('needs at least three weeks before it judges spread at all', () => {
    const twoWeeks: AdaptationInput = {
      ...baseline(),
      weeklyPlannedMi: [50, 50],
      weeklyActualMi: [50, 5],
    };
    const detail = classifyAdaptation(twoWeeks).dimensions.find(
      (d) => d.dimension === 'consistency',
    )!.detail;
    expect(detail).not.toMatch(/one week at/i);
  });
});
