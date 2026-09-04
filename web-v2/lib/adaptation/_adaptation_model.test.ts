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
  PROGRESSION_GATE,
  type AdaptationInput,
  type KeySessionRead,
} from './adaptation-model';
import { interpretExecution } from '../execution/interpret';

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
    weeklyPlannedMi: [40, 44, 46],
    weeklyActualMi: [40, 44, 46],
    trainingForm: 'PRODUCTIVE',
    distinctEvidenceWeeks: 4,
    adapterDowngrades: 0,
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
    weeklyPlannedMi: null,
    weeklyActualMi: null,
    trainingForm: null,
    distinctEvidenceWeeks: null,
    adapterDowngrades: null,
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

  it('Rule 11 · and SAYS it could not see · the verdict names itself a refusal, not a read', () => {
    // `PROGRESS` above means "the calendar's own step proceeds". It does not
    // mean "this runner demonstrated room for more", and a consumer adding
    // load beyond the plan must be able to tell (the Adaptation Engine's LOAD
    // levers read this field). Both branches, so the field is never undefined
    // on a classifier verdict.
    expect(classifyAdaptation(blind()).evidenceSufficient).toBe(false);
    expect(classifyAdaptation(baseline()).evidenceSufficient).toBe(true);
    // 2026-09-02 · a line here read "a veto is a read: the runner reported
    // something", posing `illnessActive`. Vetoes are gone — illness, injury
    // and niggle no longer reach a training decision at all — so the case it
    // covered no longer exists. The smallest-read case below is unaffected.
    // Exactly two readable dimensions is the smallest read, and it IS a read.
    const twoDims = classifyAdaptation({ ...blind(), targetVerdicts: ['on', 'on'], trainingForm: 'PRODUCTIVE' });
    expect(twoDims.confidence).toBe('low');
    expect(twoDims.evidenceSufficient).toBe(true);
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
    // RULE8CLOSE-1 (2026-09-04): this used to spell "struggling" with three
    // MISSED sessions. A miss is absence of evidence, never itself the
    // negative signal — see the `execution is a gate` and `EXECUTION-IDENTITY-1`
    // blocks below for that doctrine directly. This band/decision test's own
    // job is the mapping downstream of a genuinely bad read, so it now uses
    // `partial_failed` — three REAL, attempted sessions that came apart —
    // which is the honest way to construct "struggling" without leaning on
    // the mechanism this file no longer treats as punitive.
    // Real struggle, not absence — internal-cost and recovery are genuinely
    // degraded too, moderately rather than severely (that is the `poor`
    // test's job below). Calibrated against the live model rather than
    // hand-derived: a fixture that leans on only ONE dimension being bad
    // while the rest stay pristine no longer reaches `marginal` under the
    // corrected training-credit average, because a small real-but-imperfect
    // sample reads honestly rather than punitively.
    const struggling: AdaptationInput = {
      ...baseline(),
      keySessionExecutions: [...repeat(as_planned, 5), ...repeat(partial_failed, 3)],
      keySessionsCompleted: 8,
      targetVerdicts: ['slow', 'slow', 'on', 'slow', 'on', 'on'],
      repConsistency: ['fading', 'fading', 'even'],
      trainingForm: 'LOADED',
      adapterDowngrades: 2,
      rpeReported: 6,
      rpeHarderThanExpected: 4,
      decouplingVerdicts: ['poor', 'poor', 'building'],
      lateDriftBpm: [12, 10, 9],
      recoveryPctOfExpected: 0.65,
      weeklyActualMi: [30, 34, 36],
    };
    const v = classifyAdaptation(struggling);
    expect(v.band).toBe('marginal');
    expect(v.decision).toBe('STAY');
    expect(v.stepMultiplier).toBe(0);
  });

  it('poor reduces or modifies the stimulus', () => {
    // Same substitution and the same reason: real, poorly-executed sessions
    // (not misses) carry this to `poor`, alongside genuinely bad internal-cost
    // and consistency signals (decoupling, late drift, RPE, downgrades) —
    // this test was always meant to prove those dimensions can reach `poor`
    // together, not to prove that skipping sessions can.
    const failing: AdaptationInput = {
      ...baseline(),
      keySessionExecutions: [...repeat(as_planned, 2), ...repeat(partial_failed, 6)],
      keySessionsCompleted: 8,
      targetVerdicts: ['slow', 'slow', 'slow', 'slow'],
      repConsistency: ['fading', 'fading', 'fading'],
      decouplingVerdicts: ['poor', 'poor', 'poor'],
      lateDriftBpm: [16, 18, 15],
      rpeReported: 6,
      rpeHarderThanExpected: 6,
      trainingForm: 'OVERREACH',
      weeklyActualMi: [20, 22, 18],
      adapterDowngrades: 4,
      easyDiscipline: { established: true, read: 'ran_faster_than_band' },
      recoveryPctOfExpected: 0.45,
    };
    const v = classifyAdaptation(failing);
    expect(v.band).toBe('poor');
    expect(['MODIFY', 'PROTECT']).toContain(v.decision);
    expect(v.stepMultiplier).toBeLessThan(0);
  });
});

describe('execution is a gate — you cannot earn stress by not doing the work', () => {
  /**
   * RULE8CLOSE-1 (2026-09-04) rewrote this whole block. The trap the original
   * tests closed still matters — skip the sessions and your HR, recovery and
   * decoupling all look excellent, because the stimulus that would have taxed
   * them was never delivered — but the OLD fix was to let missed sessions drag
   * the execution score itself into `marginal`/`poor`. David's ruling: "No
   * activity on a prescribed day is not evidence that fitness declined. It is
   * absence of execution evidence" — a miss must not read as negative, in any
   * amount. The trap is still closed, correctly, by the PROGRESSION gate
   * (`compliantSessions` still counts a miss in its denominator, so a block
   * that skipped enough of the schedule cannot demonstrate room for more) —
   * never by treating the miss as punitive evidence of decline.
   */
  it('missing most of the block blocks strong, but does not punish the block that happened', () => {
    // 5 of 8 key sessions missed — decisively below PROGRESSION_GATE's 0.6
    // share, so `strong` cannot fire however good the 3 real sessions were.
    const mostlyMissed: AdaptationInput = {
      ...baseline(),
      keySessionExecutions: [...repeat(as_planned, 3), ...repeat(missed, 5)],
      keySessionsCompleted: 3,
      targetVerdicts: ['on', 'on', 'on'],
      repConsistency: ['even'],
    };
    const v = classifyAdaptation(mostlyMissed);
    // The trap: HR/recovery/decoupling never got taxed, and still must not
    // read as evidence of GOOD absorption either — but that is what `strong`
    // would claim, and it is blocked.
    expect(v.dimensions.find((d) => d.dimension === 'internal_cost')!.score).toBeGreaterThan(0);
    expect(v.dimensions.find((d) => d.dimension === 'recovery')!.score).toBeGreaterThan(0);
    expect(v.band).not.toBe('strong');
    // And not punished into a downgrade either — the 5 misses are absence of
    // evidence, not evidence of decline, so nothing here forces MODIFY/PROTECT.
    expect(['PROGRESS', 'STAY']).toContain(v.decision);
    expect(progressionCreditShare(mostlyMissed)).toBeLessThan(PROGRESSION_GATE.strongMinShare);
  });

  it('wholesale non-execution blocks strong via the progression gate, not via a punitive score', () => {
    // Internally consistent this time: a block where 7 of 8 key sessions were
    // missed has nothing to grade a quality target or rep consistency
    // against for the 7 that did not happen — the old fixture glued pristine
    // 'slow'/'fading' verdicts onto a near-total miss, which does not
    // correspond to anything that could really be measured.
    const absent: AdaptationInput = {
      ...baseline(),
      keySessionExecutions: [as_planned, ...repeat(missed, 7)],
      keySessionsCompleted: 1,
      targetVerdicts: null,
      repConsistency: null,
    };
    const v = classifyAdaptation(absent);
    // The 7 misses contribute nothing to the average either way — they are
    // simply excluded, never a hard zero. What is left is an honest read of
    // the one real session that happened, which was perfect: the
    // training-credit dimension correctly says "of what was attempted, it
    // was all fully delivered" — that is a true, narrow fact, not a claim
    // about the other 7 sessions. It is exactly what stops this dimension
    // from EVER being the strongly negative number that used to force `poor`
    // off nothing but absence.
    expect(v.dimensions.find((d) => d.dimension === 'execution')!.score).toBe(2);
    // The claim that matters is downstream: 1 of 8 attempted cannot
    // demonstrate room for more, so `strong` is blocked by the progression
    // gate regardless of how good that one session was.
    expect(v.band).not.toBe('strong');
    expect(progressionCreditShare(absent)).toBeCloseTo(1 / 8, 5);
  });

  it('the gate explains itself in terms of the sessions, not the heart rate, when execution is what actually failed', () => {
    // Repoints to a REAL struggle (partial_failed — attempted and came apart),
    // which is the case this sentence is actually describing. A pure miss
    // carries no session-quality story to tell; see the tests above for that.
    const struggling: AdaptationInput = {
      ...baseline(),
      keySessionExecutions: [...repeat(as_planned, 2), ...repeat(partial_failed, 6)],
      keySessionsCompleted: 8,
      targetVerdicts: ['slow', 'slow', 'slow', 'slow'],
      repConsistency: ['fading', 'fading', 'fading'],
    };
    expect(classifyAdaptation(struggling).summary).toMatch(/session|rep/i);
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
    // RULE8CLOSE-1 (2026-09-04): the headcount claims 8 of 8 ran, and the
    // resolver must still see through that to `MISSED` — that part of this
    // test's name is unchanged. What changed is what "reads as missed" means:
    // absence of evidence, not a punitive score. Every session in this block
    // is a real MISS, so there is no attempted evidence at all for the
    // training-credit dimension — it stays null, exactly like the "no HR
    // strap" case elsewhere in this file, rather than the strongly negative
    // number the old model computed from eight hard zeros.
    const v = classifyAdaptation(skipped);
    expect(v.dimensions.find((d) => d.dimension === 'execution')!.score).toBeNull();
    // Nothing here can demonstrate room for more — progression share is 0.
    expect(progressionCreditShare(skipped)).toBe(0);
    expect(v.band).not.toBe('strong');
    // And it is not punished into `poor` either — a whole block of absence is
    // still absence, not decline. The other four pristine dimensions carry
    // the read to `normal`, and the calendar's own step proceeds.
    expect(v.band).toBe('normal');
    expect(v.decision).toBe('PROGRESS');
    expect(v.stepMultiplier).toBe(1);
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
    // RULE8CLOSE-1 (2026-09-04): this used to compare against a fully MISSED
    // block's score. That comparison no longer proves what it once did — a
    // miss is now excluded from the training-credit average entirely (Rule 1:
    // absence of evidence is not evidence of poor adaptation), so "missed"
    // reads as `null`/no-opinion, not as a competing negative number, and the
    // two are no longer the same kind of thing to compare. What this test
    // actually needs to prove is unchanged: a genuinely partial but REAL
    // effort (attempted, measured, real data) must not be scored as though
    // it were the worst possible reading on the scale — compare it directly
    // against that floor instead.
    const partialScore = classifyAdaptation(allPartial)
      .dimensions.find((d) => d.dimension === 'execution')!.score!;
    expect(partialScore).not.toBeNull();
    // shareToScore(0) === -2, the scale's own floor. 8 real sessions at 0.6
    // completion land well clear of it.
    expect(partialScore).toBeGreaterThan(-2);
  });

  it('and a miss is excluded from the average, never scored as a competing negative', () => {
    // The corollary Rule 1 now enforces directly on this dimension: a fully
    // missed block carries no training-credit opinion at all (null), which is
    // categorically different from — and never lower than — a real partial
    // effort's actual measured number.
    const missedScore = classifyAdaptation({
      ...baseline(),
      keySessionExecutions: repeat(missed, 8),
      targetVerdicts: null,
      repConsistency: null,
    }).dimensions.find((d) => d.dimension === 'execution')!.score;
    expect(missedScore).toBeNull();
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

describe('recovery is the lightest dimension, and cannot drive a verdict alone', () => {
  /* 2026-09-02 · this describe was "readiness informs, it never acts (locked
   * 2026-08-17)" and held four tests, three of whose SUBJECT was the readiness
   * window (`readinessBelowNormalDays` / `READINESS_MIN_WINDOW_DAYS`). The
   * owner has ruled that readiness influences no training decision, the fields
   * are gone from `AdaptationInput`, and `readRecovery`'s readiness half is
   * deleted — so those three are deleted rather than retagged: there is no
   * surviving quantity for them to be about.
   *
   * The fourth is kept because its property never depended on readiness. The
   * recovery dimension still reads `recoveryPctOfExpected`, it is still the
   * lightest-weighted dimension, and "one bad dimension does not collapse a
   * verdict" is exactly the guard that stops the engine's downward instinct
   * getting a cheap lever (CLAUDE.md Rule 21). */

  it('a fully negative recovery read does not collapse an otherwise excellent block', () => {
    const onlyRecoveryBad: AdaptationInput = {
      ...baseline(),
      recoveryPctOfExpected: 0.4,
    };
    const v = classifyAdaptation(onlyRecoveryBad);
    // Recovery is fully negative, everything else is excellent. The verdict
    // must not collapse to marginal on the strength of recovery alone.
    const recovery = v.dimensions.find((d) => d.dimension === 'recovery')!;
    expect(recovery.score, 'the fixture did not actually pose a bad recovery read')
      .toBeLessThan(0);
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
    // The third fixture was `{ ...baseline(), injuryActive: true }` — the
    // veto copy path, which no longer exists. A poor block is posed instead,
    // so the register is still checked on a NEGATIVE verdict and not only on
    // the two easy ones.
    const poor: AdaptationInput = {
      ...baseline(),
      keySessionExecutions: repeat(partial_failed, 8),
      keySessionsCompleted: 4,
      targetVerdicts: ['slow', 'slow', 'slow', 'slow', 'slow', 'slow'],
      recoveryPctOfExpected: 0.4,
    };
    for (const input of [baseline(), blind(), poor]) {
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

/**
 * EXECUTION-IDENTITY-1 (2026-09-03), corrected under RULE8CLOSE-1
 * (2026-09-04) · one exact-linked, telemetry-compromised session must not
 * be able to trigger a downgrade — and must not be scored at all, positive
 * or negative, off data an app-side capture failure produced.
 *
 * David's own ruling on the live incident: an EXACT `planWorkoutId` match
 * proves which run this was, never that it was fully executed, and a
 * shortfall the app itself caused (automatic phase transitions failing,
 * prescribed targets never round-tripping to post-run) must not read as a
 * demonstrated pace/HR/incline/rep failure.
 *
 * The first version of this block (2026-09-03) proved the session "scored
 * better than a plain miss" and read that as the safe direction. David's
 * follow-up ruling named exactly why that was still wrong: it treated a MISS
 * as a legitimate negative baseline for the telemetry-compromised session to
 * beat, when a miss must never be negative evidence at all — "must not... make
 * a later partial run appear beneficial merely because it replaced a negative
 * 'miss' score." The corrected property is stronger and cleaner than
 * "not worse": a genuine miss and a telemetry-compromised session are BOTH
 * excluded from this dimension's score, so replacing one with the other
 * leaves the number EXACTLY unchanged, never merely "no worse."
 *
 * Verified live against David's real account the night the incident happened
 * (Rule 13): `buildAdaptationComparisonRecord` run at '2026-09-02' (before
 * the session) and '2026-09-04' (after) — same 42-day window, same runner,
 * one session added, execution score moved from -0.679 to -0.559. That
 * finding is superseded by this corrected model, not restated by it — see
 * `docs/handback-2026-09-04-sealing-and-adaptation-doctrine.md` for the
 * re-verification against the corrected code.
 */
describe('RULE8CLOSE-1 · a telemetry-compromised session scores exactly like the miss it replaced, never worse and never "improved"', () => {
  // The real incident, typed: an EXACT match (planWorkoutId present upstream,
  // out of scope for this pure model), 4.71 of 6mi recorded, automatic phase
  // transitions failed, prescribed targets never round-tripped — the app's own
  // fault, not the runner's. `telemetryCompromised: true` is how a caller who
  // knows that reports it (`lib/execution/interpret.ts` RULE8CLOSE-1).
  const telemetry_compromised_partial: KeySessionRead = {
    state: 'PARTIAL_PRODUCTIVE',
    stimulusCompletion: 0.336,
    earnsProgression: false,
    telemetryCompromised: true,
  };

  // The realistic, boundary-adjacent window — not a pristine one. Same shape
  // the original incident used: 5 clean sessions, 2 plain misses, one more
  // slot that varies per test. A pristine 8-for-8 window is too far from any
  // gate to prove anything by swapping one slot.
  function boundaryWindow(third: KeySessionRead): AdaptationInput {
    return {
      ...baseline(),
      keySessionExecutions: [...repeat(as_planned, 5), ...repeat(missed, 2), third],
      keySessionsCompleted: 5,
      targetVerdicts: ['slow', 'slow', 'on', 'slow', 'on', 'on'],
      repConsistency: ['fading', 'fading', 'even'],
    };
  }

  it('swapping one MISS for the telemetry-compromised session leaves the execution score exactly unchanged', () => {
    const withMiss = classifyAdaptation(boundaryWindow(missed));
    const withCompromised = classifyAdaptation(boundaryWindow(telemetry_compromised_partial));
    const execScore = (v: ReturnType<typeof classifyAdaptation>) =>
      v.dimensions.find((d) => d.dimension === 'execution')!.score!;
    // Both sessions are excluded from the training-credit average — there is
    // nothing here for either one to beat or lose to. Exact equality is the
    // correct, stronger claim; "not worse" would still tolerate exactly the
    // "beat a negative miss score" framing David's ruling rejected.
    expect(execScore(withCompromised)).toBe(execScore(withMiss));
    expect(withCompromised.band).toBe(withMiss.band);
    expect(withCompromised.decision).toBe(withMiss.decision);
    expect(withCompromised.stepMultiplier).toBe(withMiss.stepMultiplier);
  });

  it('the telemetry-compromised session is narrated separately from a plain miss and from an honest partial', () => {
    const v = classifyAdaptation(boundaryWindow(telemetry_compromised_partial));
    const detail = v.dimensions.find((d) => d.dimension === 'execution')!.detail;
    expect(detail).toMatch(/telemetry-compromised/i);
    expect(detail).not.toMatch(/1 partial/i);
  });

  it('an honest, non-compromised partial at the same completion still contributes its own real evidence', () => {
    // The distinguishing case: a REAL partial session (same 0.336, no capture
    // failure) is not the same fact as a telemetry-compromised one, and must
    // not be silently excluded too — that would quarantine real, trustworthy
    // evidence the runner actually produced.
    const honestPartial: KeySessionRead =
      { state: 'PARTIAL_PRODUCTIVE', stimulusCompletion: 0.336, earnsProgression: false };
    const withMiss = classifyAdaptation(boundaryWindow(missed));
    const withHonestPartial = classifyAdaptation(boundaryWindow(honestPartial));
    const execScore = (v: ReturnType<typeof classifyAdaptation>) =>
      v.dimensions.find((d) => d.dimension === 'execution')!.score!;
    // Real data changes the reading — this is the training-credit dimension
    // doing its job, not a punishment. It differs from the miss/compromised
    // case above specifically because THIS session's numbers can be trusted.
    expect(execScore(withHonestPartial)).not.toBe(execScore(withMiss));
  });

  it('the telemetry-compromised session never earns progression credit, and never claims high fitness evidence', () => {
    const withOneCompromised = boundaryWindow(telemetry_compromised_partial);
    const share = progressionCreditShare(withOneCompromised);
    expect(share).toBeLessThan(1);
    // 5 of 8 compliant sessions earn progression (the 2 misses and the
    // compromised session do not) — 0.625, never a number that credits it.
    expect(share).toBeCloseTo(5 / 8, 5);
  });

  it('interpretExecution itself quarantines fitness/adaptation evidence when telemetryCompromised is set, and preserves the trustworthy completion figure', () => {
    const read = interpretExecution(
      // workMi:12 sits outside the interval at-pace band (3-6mi,
      // `AT_PACE_SESSION_MI.interval`) so this exercises the genuine PARTIAL
      // path rather than accidentally landing in `bothInsideBand`'s
      // same-stimulus read — both planned and actual otherwise mirror the
      // real incident's shape (a hill session cut well short).
      { domain: 'interval', workMinutes: 20, workMi: 12, meanWorkPaceSPerMi: null, recoveryIntent: 'incomplete' },
      { domain: 'interval', workMinutes: 6.72, workMi: 4.71, meanWorkPaceSPerMi: null, recoveryIntent: 'incomplete' },
      { telemetryCompromised: true },
    );
    expect(read.telemetryCompromised).toBe(true);
    expect(read.evidence.fitness).toBe('none');
    expect(read.evidence.adaptation).toBe('unknown');
    // Distance/duration-derived completion is preserved — the trustworthy half.
    expect(read.stimulusCompletion).toBeCloseTo(6.72 / 20, 2);
    expect(read.why).toMatch(/could not be captured reliably/i);
  });
});
