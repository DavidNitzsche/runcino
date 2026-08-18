/**
 * Adaptation model · doctrine tests.
 *
 * These encode `Design/adaptive-progression-engine.md` System B directly, so
 * drift fails with the rule it broke rather than with a number that moved.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyAdaptation,
  progressionCreditShare,
  MIN_WEEKS_FOR_STRONG,
  NIGGLE_VETO_SEVERITY,
  PROGRESSION_GATE,
  READINESS_MIN_WINDOW_DAYS,
  type AdaptationInput,
  type KeySessionRead,
} from './adaptation-model';

/** Shorthand for a session in a given state. The execution dimension scores
 *  these; the planned/completed headcount beside them is narration. */
const as_planned: KeySessionRead =
  { state: 'AS_PLANNED', stimulusCompletion: 1, earnsProgression: true };
const equivalent: KeySessionRead =
  { state: 'EQUIVALENT', stimulusCompletion: 1, earnsProgression: true };
const partial_failed: KeySessionRead =
  { state: 'PARTIAL_FAILED', stimulusCompletion: 0.6, earnsProgression: false };
const missed: KeySessionRead =
  { state: 'MISSED', stimulusCompletion: 0, earnsProgression: false };
const replaced: KeySessionRead =
  { state: 'REPLACED', stimulusCompletion: 1, earnsProgression: false };
const extra: KeySessionRead =
  { state: 'EXTRA', stimulusCompletion: 0, earnsProgression: false };

const repeat = (r: KeySessionRead, n: number): KeySessionRead[] => Array.from({ length: n }, () => r);

/** A runner we can see clearly and who is doing fine. Tests mutate from here. */
function baseline(): AdaptationInput {
  return {
    keySessionExecutions: repeat(as_planned, 8),
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
    keySessionExecutions: null,
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
      keySessionExecutions: [...repeat(as_planned, 5), ...repeat(missed, 3)],
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
      keySessionExecutions: [...repeat(as_planned, 2), ...repeat(missed, 6)],
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
      keySessionExecutions: [...repeat(as_planned, 5), ...repeat(missed, 3)],
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
      keySessionExecutions: [as_planned, ...repeat(missed, 7)],
      keySessionsCompleted: 1,
      targetVerdicts: ['slow', 'slow', 'slow', 'slow'],
      repConsistency: ['fading', 'fading', 'fading'],
    };
    expect(classifyAdaptation(absent).band).toBe('poor');
  });

  it('the gate explains itself in terms of the sessions, not the heart rate', () => {
    const skipping: AdaptationInput = {
      ...baseline(),
      keySessionExecutions: [...repeat(as_planned, 5), ...repeat(missed, 3)],
      keySessionsCompleted: 5,
      targetVerdicts: ['slow', 'slow', 'on', 'slow', 'on', 'on'],
      repConsistency: ['fading', 'fading', 'even'],
    };
    expect(classifyAdaptation(skipping).summary).toMatch(/session|rep/i);
  });
});

describe('execution reads STATES · a run on the date is not a session done', () => {
  // `Design/execution-memory-firing.md` Part 1. The old gate counted a quality
  // day as done if a run existed on that date, which cannot tell EQUIVALENT
  // from MISSED — the two runners below scored identically under it.
  const swapped: AdaptationInput = {
    ...baseline(),
    keySessionExecutions: repeat(equivalent, 8),
    keySessionsCompleted: 8,
  };
  const skipped: AdaptationInput = {
    ...baseline(),
    keySessionExecutions: repeat(missed, 8),
    // The headcount still says every session had a run on its date. It is
    // narration now, and narration must not move the verdict.
    keySessionsCompleted: 8,
    // Nothing was run, so there is nothing to grade against a target. Leaving
    // baseline's six on-target verdicts here would be describing a runner who
    // both skipped every session and nailed six of them.
    targetVerdicts: null,
    repConsistency: null,
  };

  it('an equivalent session earns full credit · different shape, same stimulus', () => {
    const v = classifyAdaptation(swapped);
    expect(v.dimensions.find((d) => d.dimension === 'execution')!.score)
      .toBe(classifyAdaptation(baseline()).dimensions.find((d) => d.dimension === 'execution')!.score);
    expect(progressionCreditShare(swapped)).toBe(1);
  });

  it('a missed block reads as missed even when a run exists on every date', () => {
    const v = classifyAdaptation(skipped);
    expect(v.dimensions.find((d) => d.dimension === 'execution')!.score).toBeLessThan(-1);
    expect(v.band).toBe('poor');
  });

  it('a replaced session is not a miss and is not room for more', () => {
    // "Adjust downstream training rather than marking Saturday green."
    const raced: AdaptationInput = {
      ...baseline(),
      keySessionExecutions: [...repeat(as_planned, 7), replaced],
    };
    expect(classifyAdaptation(raced).dimensions.find((d) => d.dimension === 'execution')!.detail)
      .toMatch(/replaced by a race/);
    expect(progressionCreditShare(raced)).toBeCloseTo(7 / 8, 5);
  });

  it('EXTRA never counts as compliance · extra work is data, not achievement', () => {
    const withExtra: AdaptationInput = {
      ...baseline(),
      keySessionExecutions: [...repeat(as_planned, 4), ...repeat(missed, 4), ...repeat(extra, 8)],
    };
    const without: AdaptationInput = {
      ...baseline(),
      keySessionExecutions: [...repeat(as_planned, 4), ...repeat(missed, 4)],
    };
    // Eight unplanned runs must not raise the share of the plan that was done.
    expect(progressionCreditShare(withExtra)).toBe(progressionCreditShare(without));
    expect(classifyAdaptation(withExtra).dimensions.find((d) => d.dimension === 'execution')!.score)
      .toBe(classifyAdaptation(without).dimensions.find((d) => d.dimension === 'execution')!.score);
  });

  it('nothing interpretable leaves the dimension to the verdicts, not to a headcount', () => {
    const uninterpretable: AdaptationInput = {
      ...baseline(),
      keySessionExecutions: null,
      keySessionsCompleted: 1,
      keySessionsPlanned: 8,
      targetVerdicts: null,
      repConsistency: null,
    };
    // 1 of 8 would once have scored −1.6 and capped the band at marginal off a
    // predicate that cannot see whether a session happened. Absence of
    // evidence is not evidence of poor adaptation.
    expect(classifyAdaptation(uninterpretable).dimensions
      .find((d) => d.dimension === 'execution')!.score).toBeNull();
  });
});

describe('rule 4 · training credit and progression credit are different currencies', () => {
  /** Every session useful, none of them fully delivered. */
  const allPartial: AdaptationInput = {
    ...baseline(),
    keySessionExecutions: repeat(partial_failed, 8),
    keySessionsCompleted: 8,
  };

  it('partial work is not scored as zero', () => {
    const partialScore = classifyAdaptation(allPartial)
      .dimensions.find((d) => d.dimension === 'execution')!.score!;
    const missedScore = classifyAdaptation({ ...baseline(), keySessionExecutions: repeat(missed, 8) })
      .dimensions.find((d) => d.dimension === 'execution')!.score!;
    expect(partialScore).toBeGreaterThan(missedScore);
  });

  it('and is not rewarded as though it demonstrated capacity for more', () => {
    const partialScore = classifyAdaptation(allPartial)
      .dimensions.find((d) => d.dimension === 'execution')!.score!;
    const fullScore = classifyAdaptation(baseline())
      .dimensions.find((d) => d.dimension === 'execution')!.score!;
    expect(partialScore).toBeLessThan(fullScore);
  });

  it('a block carried by partials cannot reach strong, however good the rest looks', () => {
    // The gate the single band cap could not express: the work counted, and it
    // did not show room for more.
    const v = classifyAdaptation({
      ...allPartial,
      // Everything else pristine and spread over enough weeks.
      targetVerdicts: ['on', 'on', 'on', 'on', 'on', 'on'],
      distinctEvidenceWeeks: 5,
    });
    expect(progressionCreditShare(allPartial)).toBeLessThan(PROGRESSION_GATE.strongMinShare);
    expect(v.band).not.toBe('strong');
  });

  it('and the summary says which of the two failed', () => {
    const v = classifyAdaptation({
      ...baseline(),
      keySessionExecutions: [...repeat(as_planned, 4), ...repeat(partial_failed, 4)],
      distinctEvidenceWeeks: 5,
    });
    if (v.band === 'normal') expect(v.summary).toMatch(/short of the session|as expected/i);
  });

  it('an uninterpretable block does not trip the gate · absence is not a finding', () => {
    expect(progressionCreditShare({ ...baseline(), keySessionExecutions: null })).toBeNull();
    // Same input as the strong case, with the states removed entirely.
    const v = classifyAdaptation({ ...baseline(), keySessionExecutions: null });
    expect(['strong', 'normal']).toContain(v.band);
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

describe('heat is filtered per observation, not per surface', () => {
  // CLAUDE.md's locked per-finding rule: a guard on the parent surface does
  // not protect a sub-finding. Research/03 §12 — heat manufactures 2-5% of
  // decoupling on its own, so a hot-day reading must clear the endurance
  // threshold BY that artifact before it accuses the runner's aerobic base.
  // The loader owns the filtering; these hold the consequence.
  it('a decoupling verdict that survived filtering still counts against absorption', () => {
    const withPoor = classifyAdaptation({ ...baseline(), decouplingVerdicts: ['poor', 'poor', 'race-ready'] });
    const withClean = classifyAdaptation({ ...baseline(), decouplingVerdicts: ['race-ready', 'race-ready', 'race-ready'] });
    const cost = (v: ReturnType<typeof classifyAdaptation>) =>
      v.dimensions.find((d) => d.dimension === 'internal_cost')!.score!;
    expect(cost(withPoor)).toBeLessThan(cost(withClean));
  });

  it('filtered-out observations leave the dimension unreadable rather than clean', () => {
    // A hot run below the raised bar is not evidence either way. Recording it
    // as a good run would be the same error in the other direction.
    const v = classifyAdaptation({
      ...baseline(),
      decouplingVerdicts: null,
      lateDriftBpm: null,
      rpeReported: null,
      rpeHarderThanExpected: null,
      easyDiscipline: null,
    });
    expect(v.dimensions.find((d) => d.dimension === 'internal_cost')!.score).toBeNull();
  });
});
