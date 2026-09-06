/**
 * THE THREE ROLLING BOUNDARIES.
 *
 * WHAT THIS ASSERTS
 *   · Demand, not stressor count, decides. The 09-21 week reads +14.1% by
 *     demand and +17.9% by mileage, and those are different answers to
 *     different questions — only one of them prices the long run and the
 *     quality minutes together.
 *   · Boundary 1's growth confidence moves CONTINUOUSLY through 10% and 15%
 *     (Rule 9, and the owner's 2026-09-06 ruling, quoted in
 *     `rolling-boundary.ts`'s own header): "do not use either 0.10 or 0.15 as
 *     a binary threshold... no abrupt verdict change at 10% or 15%." A hair's
 *     difference in growth or in context must not produce a categorically
 *     different plan.
 *   · The 09-21 week's real +14.1% demand step is the owner's own acceptance
 *     test: it must resolve as an EARNABLE, LOWER-CONFIDENCE PUSH under a
 *     clean context, not an automatic reduction — see "the 09-21 week, the
 *     owner's own acceptance case" below.
 *   · An unreadable input REFUSES rather than proceeding or reducing, and the
 *     safe direction differs by boundary — which is the point of having three.
 *   · No boundary ever names the long run or a race at boundary 1.
 *
 * WHAT THIS CANNOT FAIL ON (Rule 22)
 *   · Whether the demand model's coefficients are right. They are crude and say
 *     so. What is fixed here is comparing the SAME quantity on both sides.
 *   · Whether the grading upstream is correct. `absorbed` and `effort` arrive
 *     already classified; this decides what to do about them.
 *   · Whether anything schedules these. Persisting the three dates is the
 *     reassessment scheduler's job and migration 167 is not applied.
 *   · Whether the FIVE context weights (0.30/0.25/0.20/0.15/0.10) are the
 *     right weights. They are stated, not derived from doctrine — there is no
 *     citation for "how much should runway matter relative to fatigue" — and
 *     what this suite fixes is that no single one of them can flip a verdict
 *     on its own (a cliff wearing a weighted-average costume).
 */
import { describe, it, expect } from 'vitest';
import {
  priceWeek, demandBaseline, boundaryBeforeWeek, boundaryAfterQuality, boundaryAfterRace,
  boundariesForWeek, demandGrowthBaseConfidence, demandStepConfidence, demandStepContextScore,
  DEMAND_STEP_PUSH_CONFIDENCE_FLOOR, NEUTRAL_FATIGUE_SAFETY_CLEARANCE,
  type DemandStepContext,
} from './rolling-boundary';

/** A context with nothing wrong anywhere — the "clean weeks, low ACWR, no
 *  recent deterioration" case the owner names as what earns a push above the
 *  soft band. Individual tests override one field at a time. */
const CLEAN_CONTEXT: DemandStepContext = {
  recentExecutionCleanliness: 1.0,
  baselineFreedomFromDip: 1.0,
  fatigueSafetyClearance: 1.0,
  trainingPhaseOpenness: 1.0,
  runwayOpenness: 1.0,
};

/** The context this evaluator ACTUALLY produces for the 09-21 week today:
 *  fatigue/safety is honestly neutral (no reader wired), and the trailing
 *  baseline window includes 09-07 — the 24.4-mile race week — so baseline
 *  freedom-from-dip is 2 of 3, not a full 1.0. Everything else about that
 *  block is clean: the preceding week (09-14) was fully completed, it is an
 *  ordinary build week, and the block runs another five weeks past it. */
const REALISTIC_0921_CONTEXT: DemandStepContext = {
  recentExecutionCleanliness: 1.0,
  baselineFreedomFromDip: 2 / 3,
  fatigueSafetyClearance: NEUTRAL_FATIGUE_SAFETY_CLEARANCE,
  trainingPhaseOpenness: 1.0,
  runwayOpenness: 1.0,
};

const never = () => false;

// The owner's real block, as measured 2026-09-05.
const W0831 = priceWeek({ weekStartISO: '2026-08-31', weeklyMi: 46.5, longRunMi: 15, qualityMinutes: 102 });
const W0907 = priceWeek({ weekStartISO: '2026-09-07', weeklyMi: 24.4, longRunMi: 6.2, qualityMinutes: 87 });
const W0914 = priceWeek({ weekStartISO: '2026-09-14', weeklyMi: 46.8, longRunMi: 16.5, qualityMinutes: 65 });
const W0921 = priceWeek({ weekStartISO: '2026-09-21', weeklyMi: 55.2, longRunMi: 17, qualityMinutes: 110 });

describe('rolling boundary · demand is the measure', () => {
  it('prices the owner’s real weeks as measured', () => {
    expect(W0831.load.demandIndex).toBeCloseTo(83.91, 2);
    expect(W0914.load.demandIndex).toBeCloseTo(72.375, 2);
    expect(W0921.load.demandIndex).toBeCloseTo(95.75, 2);
  });

  it('the demand step is SMALLER than the mileage step, and that is the finding', () => {
    const base = demandBaseline([W0831, W0907, W0914], never);
    expect(base.known).toBe(true);
    if (!base.known) return;
    // 08-31 is the baseline, not 09-14 — it carried 102 quality minutes.
    expect(base.fromWeekISO).toBe('2026-08-31');
    const demandStep = W0921.load.demandIndex / base.demandIndex - 1;
    const mileageStep = 55.2 / 46.8 - 1;
    expect(demandStep).toBeCloseTo(0.141, 2);
    expect(mileageStep).toBeCloseTo(0.179, 2);
    expect(demandStep).toBeLessThan(mileageStep);
  });

  it('takes the MAX of the window, so a cutback cannot become the baseline', () => {
    // 09-07 is a 24.4-mile race week. A mean would let it drag the baseline
    // down and manufacture a step that is not there (Rule 8, one level down).
    const base = demandBaseline([W0831, W0907, W0914], never);
    if (!base.known) throw new Error('unreachable');
    expect(base.demandIndex).toBe(W0831.load.demandIndex);
  });

  it('refuses when every trailing week was a prescribed dip', () => {
    const b = demandBaseline([W0907], () => true);
    expect(b.known).toBe(false);
    if (!b.known) expect(b.why).toContain('prescribed dip');
  });
});

describe('demandGrowthBaseConfidence · the bare growth curve, calibrated to the ruling\'s own edges', () => {
  it('reads ~1.0 well below the band — no growth, no hesitation', () => {
    expect(demandGrowthBaseConfidence(0)).toBe(1);
    expect(demandGrowthBaseConfidence(-0.2)).toBe(1);
    expect(demandGrowthBaseConfidence(0.02)).toBeGreaterThan(0.99);
  });

  it('reads EXACTLY 0.85 at 10% and EXACTLY 0.15 at 15% — the two edges the ruling names', () => {
    // Exact by construction: the logistic's scale is solved from these two
    // points, so this is really a check that the constant is still wired up,
    // not a coincidence of tuning.
    expect(demandGrowthBaseConfidence(0.10)).toBeCloseTo(0.85, 6);
    expect(demandGrowthBaseConfidence(0.15)).toBeCloseTo(0.15, 6);
  });

  it('reads exactly 0.5 at the band\'s own midpoint, 12.5%', () => {
    expect(demandGrowthBaseConfidence(0.125)).toBeCloseTo(0.5, 6);
  });

  it('keeps falling smoothly past 15% rather than floor-ing at the edge', () => {
    expect(demandGrowthBaseConfidence(0.20)).toBeLessThan(demandGrowthBaseConfidence(0.15));
    expect(demandGrowthBaseConfidence(0.30)).toBeLessThan(demandGrowthBaseConfidence(0.20));
    expect(demandGrowthBaseConfidence(0.30)).toBeGreaterThan(0);
  });
});

describe('demandStepConfidence · the ruling\'s three zones, walked as ONE continuous line (Rule 9)', () => {
  it('never jumps — no discontinuity anywhere from 0% to 25%, especially not at 10% or 15%', () => {
    /* This is the walk item 4 of the task asks for by name: step the growth
     * rate from 0 to 25% in small increments and assert the resulting
     * confidence is monotonically non-increasing with no discontinuous jump
     * anywhere. `rolling-boundary.ts`'s own header tells the story of the
     * PREDECESSOR test that failed to catch exactly this: it walked the
     * VERDICT, not the quantity, and a hard threshold satisfies "flips at
     * most once" too. This walks `demandStepConfidence` itself. */
    const STEP_SIZE = 0.0005; // 500 samples from 0% to 25%
    const MAX_ALLOWED_JUMP_PER_STEP = 0.01; // generous vs. the ~0.0007 the smooth curve actually produces
    let prev = demandStepConfidence(0, CLEAN_CONTEXT);
    let sawBand10 = false;
    let sawBand15 = false;
    for (let step = STEP_SIZE; step <= 0.25 + 1e-9; step += STEP_SIZE) {
      const cur = demandStepConfidence(Number(step.toFixed(6)), CLEAN_CONTEXT);
      const jump = prev - cur;
      expect(jump, `confidence jumped ${jump.toFixed(5)} between growth=${(step - STEP_SIZE).toFixed(4)} `
        + `and growth=${step.toFixed(4)} — that is a cliff, and both sides of a cliff are legal `
        + 'verdicts, which is exactly what a point-sampled gate cannot see')
        .toBeLessThan(MAX_ALLOWED_JUMP_PER_STEP);
      expect(cur, 'confidence must never RISE as growth increases').toBeLessThanOrEqual(prev + 1e-9);
      if (Math.abs(step - 0.10) < STEP_SIZE) sawBand10 = true;
      if (Math.abs(step - 0.15) < STEP_SIZE) sawBand15 = true;
      prev = cur;
    }
    // Prove the walk actually crossed both named edges, not just the general
    // neighbourhood — an empty walk or one that skips 0.10/0.15 exactly would
    // pass the loop above trivially.
    expect(sawBand10, 'the walk never actually sampled exactly 10% growth').toBe(true);
    expect(sawBand15, 'the walk never actually sampled exactly 15% growth').toBe(true);
    // And confidence still spans a real range across the walk, or the jump
    // check above is satisfied by a constant that ignores growth entirely.
    expect(demandStepConfidence(0, CLEAN_CONTEXT) - demandStepConfidence(0.25, CLEAN_CONTEXT))
      .toBeGreaterThan(0.3);
  });

  it('strong context recovers SOME confidence past 15%, continuously — never a second cliff', () => {
    const weak: DemandStepContext = {
      recentExecutionCleanliness: 0, baselineFreedomFromDip: 0,
      fatigueSafetyClearance: 0, trainingPhaseOpenness: 0, runwayOpenness: 0,
    };
    const strong: DemandStepContext = CLEAN_CONTEXT;
    for (const step of [0.16, 0.20, 0.25, 0.35]) {
      expect(demandStepConfidence(step, strong), `at ${(step * 100).toFixed(0)}% growth`)
        .toBeGreaterThan(demandStepConfidence(step, weak));
    }
    // Even PERFECT context narrows the gap, it does not erase an enormous step.
    expect(demandStepConfidence(0.60, CLEAN_CONTEXT)).toBeLessThan(DEMAND_STEP_PUSH_CONFIDENCE_FLOOR);
  });

  it('the context score itself is a weighted mean, not a hard AND — one weak field alone cannot zero it', () => {
    const oneWeak: DemandStepContext = { ...CLEAN_CONTEXT, fatigueSafetyClearance: 0 };
    expect(demandStepContextScore(oneWeak)).toBeGreaterThan(0.7);
  });
});

describe('boundary 1 · before the week, decided on continuous confidence', () => {
  const base = demandBaseline([W0831, W0907, W0914], never);
  const call = (completionRatio: number | null, context: DemandStepContext) => boundaryBeforeWeek({
    proposed: W0921, baseline: base, completionRatio, context,
    targetWorkoutId: 'pw_tempo', targetDateISO: '2026-09-22',
  });
  const DIRTY_CONTEXT: DemandStepContext = {
    recentExecutionCleanliness: 0.3, baselineFreedomFromDip: 0.3,
    fatigueSafetyClearance: 0.3, trainingPhaseOpenness: 0.5, runwayOpenness: 0.3,
  };

  it('proceeds as an earnable push when growth + a clean context clears the confidence bar', () => {
    const d = call(1.0, CLEAN_CONTEXT);
    expect(d.verdict).toBe('PROCEED');
    expect(d.because).toContain('earnable push');
    expect(d.mutation).toBeNull();
  });

  it('reduces when confidence does not clear the bar, and names a session that is not the long run', () => {
    const d = call(0.5, DIRTY_CONTEXT);
    expect(d.verdict).toBe('REDUCE');
    expect(d.mutation?.planWorkoutId).toBe('pw_tempo');
    expect(d.mutation?.newType).toBe('easy');
  });

  it('refuses on an unreadable completion rather than assuming it was met, regardless of context', () => {
    const d = call(null, CLEAN_CONTEXT);
    expect(d.verdict).toBe('REFUSE');
    expect(d.mutation).toBeNull();
  });

  it('refuses rather than cutting the long run when nothing else can give', () => {
    const d = boundaryBeforeWeek({
      proposed: W0921, baseline: base, completionRatio: 0.5, context: DIRTY_CONTEXT,
      targetWorkoutId: null, targetDateISO: null,
    });
    expect(d.verdict).toBe('REFUSE');
    expect(d.because).toContain('long run');
  });

  it('a hair of context movement moves confidence, not the verdict category, near the bar', () => {
    // Rule 9 applied to the CONTEXT axis, not just the growth axis: nudging
    // one input by a fraction must not be able to flip PROCEED/REDUCE unless
    // it was already sitting exactly on the 0.5 line — and even there the
    // underlying confidence itself must move by a proportional hair, not a mile.
    const base1 = demandStepConfidence(0.14113, REALISTIC_0921_CONTEXT);
    const nudged: DemandStepContext = {
      ...REALISTIC_0921_CONTEXT, recentExecutionCleanliness: REALISTIC_0921_CONTEXT.recentExecutionCleanliness - 0.01,
    };
    const base2 = demandStepConfidence(0.14113, nudged);
    expect(Math.abs(base1 - base2)).toBeLessThan(0.01);
  });

  describe('the 09-21 week · the owner\'s own acceptance case', () => {
    /* "The 9/21 week at +14.1% demand remains an earnable, lower-confidence
     * PUSH — not an automatic reduction." Verbatim from the ruling. The
     * context below is not hand-picked to make this pass — it is what
     * `rolling-boundary-evaluator.ts` actually computes for this exact week:
     * the preceding week (09-14) was fully completed (recentExecutionCleanliness
     * 1.0), fatigue/safety has no reader wired so reads the honest neutral,
     * the proposed week is an ordinary build week (trainingPhaseOpenness 1.0),
     * five more authored weeks follow it (runwayOpenness 1.0), and the
     * trailing baseline window includes one race week out of three
     * (baselineFreedomFromDip 2/3). */
    it('resolves PROCEED — an earnable push, not a reduction', () => {
      const d = call(1.0, REALISTIC_0921_CONTEXT);
      expect(d.verdict).toBe('PROCEED');
      expect(d.because).toContain('14.1%');
    });

    it('and it is a LOWER-CONFIDENCE push, not a confident one — below what a fully clean week earns', () => {
      const realisticConfidence = demandStepConfidence(0.14113, REALISTIC_0921_CONTEXT);
      const cleanConfidence = demandStepConfidence(0.14113, CLEAN_CONTEXT);
      expect(realisticConfidence).toBeGreaterThanOrEqual(DEMAND_STEP_PUSH_CONFIDENCE_FLOOR);
      expect(realisticConfidence).toBeLessThan(cleanConfidence);
      // "Lower-confidence" is meaningful, not a rounding artifact.
      expect(cleanConfidence - realisticConfidence).toBeGreaterThan(0.02);
    });

    it('the SAME growth step reduces once the surrounding context turns genuinely poor', () => {
      // Same +14.1% demand step, same baseline, same target — only the
      // context changes. This is the falsifying half of the acceptance case:
      // if this ALSO proceeded regardless of context, the model would not be
      // reading context at all.
      const d = call(1.0, DIRTY_CONTEXT);
      expect(d.verdict).toBe('REDUCE');
    });
  });
});

describe('boundary 2 · after the mid-week quality session', () => {
  const weekend = { weekendLongWorkoutId: 'pw_long', weekendLongDateISO: '2026-09-27', weekendLongMi: 17 };

  it('adjusts the WEEKEND when the tempo was poorly absorbed', () => {
    const d = boundaryAfterQuality({ absorbed: 'POOR', ...weekend });
    expect(d.verdict).toBe('REDUCE');
    expect(d.mutation?.planWorkoutId).toBe('pw_long');
    expect(d.mutation?.newDistanceMi).toBe(14.5);
    expect(d.because).toContain('rather than the Tuesday being treated as though it had not happened');
  });

  it('leaves the weekend alone when it was absorbed', () => {
    expect(boundaryAfterQuality({ absorbed: 'FULL', ...weekend }).verdict).toBe('PROCEED');
    expect(boundaryAfterQuality({ absorbed: 'PARTIAL', ...weekend }).verdict).toBe('PROCEED');
  });

  it('an ungraded session is not a well-absorbed one, and not a problem either', () => {
    const d = boundaryAfterQuality({ absorbed: null, ...weekend });
    expect(d.verdict).toBe('REFUSE');
    expect(d.mutation).toBeNull();
  });
});

describe('boundary 3 · after the race, before the long run', () => {
  const long = { longWorkoutId: 'pw_long', longDateISO: '2026-09-27', longMi: 17 };

  it('a controlled C effort costs what it was priced at', () => {
    expect(boundaryAfterRace({ effort: 'CONTROLLED_C', ...long }).verdict).toBe('PROCEED');
  });

  it('grades the reduction by what the race actually cost', () => {
    const t = boundaryAfterRace({ effort: 'THRESHOLD_LIKE', ...long });
    const r = boundaryAfterRace({ effort: 'TRUE_RACE', ...long });
    expect(t.mutation?.newDistanceMi).toBe(15.3);
    expect(r.mutation?.newDistanceMi).toBe(12.8);
    // A true race must never cost LESS than a threshold effort.
    expect(r.mutation!.newDistanceMi!).toBeLessThan(t.mutation!.newDistanceMi!);
  });

  it('an unclassifiable race eases, because the cost is unknown and not zero', () => {
    // The safe direction differs from boundary 2's, deliberately: there the
    // session might not have happened, here it certainly did.
    const d = boundaryAfterRace({ effort: 'UNRELIABLE', ...long });
    expect(d.verdict).toBe('REDUCE');
    expect(d.because).toContain('unknown rather than zero');
  });
});

describe('rolling boundary · the three are durable commitments', () => {
  const reqs = boundariesForWeek({
    userUuid: '0645f40c-951d-4ccc-b86e-9979cd26c795',
    planId: 'pln_7636bcc0a201bf2d', planVersion: 'pln_7636bcc0a201bf2d:none',
    weekStartISO: '2026-09-21',
    assessBeforeISO: '2026-09-20',
    assessAfterQualityISO: '2026-09-23',
    assessAfterRaceISO: '2026-09-27',
    todayISO: '2026-09-05',
  });

  it('schedules exactly three, on the three dates', () => {
    expect(reqs).toHaveLength(3);
    expect(reqs.map((r) => r.assessOnISO)).toEqual(['2026-09-20', '2026-09-23', '2026-09-27']);
  });

  it('every boundary is assessed while it can still change the thing it is about', () => {
    // Rule 23: a decision that arrives after the session it governs is not a
    // decision. Boundary 1 precedes the week; 2 precedes the weekend; 3
    // precedes the long run.
    for (const r of reqs) expect(r.assessOnISO < '2026-09-28').toBe(true);
    expect(reqs[0].assessOnISO < '2026-09-21').toBe(true);
  });

  it('a boundary that never fires is NOTICED, not passed over', () => {
    for (const r of reqs) {
      expect(r.overdueAfterISO, `${r.reasonCode} can go missing silently`).toBeTruthy();
      expect(r.overdueAfterISO! > r.assessOnISO).toBe(true);
    }
  });

  it('re-requesting nightly yields one row each, not one per tick', () => {
    const again = boundariesForWeek({
      userUuid: '0645f40c-951d-4ccc-b86e-9979cd26c795',
      planId: 'pln_7636bcc0a201bf2d', planVersion: 'pln_7636bcc0a201bf2d:none',
      weekStartISO: '2026-09-21',
      assessBeforeISO: '2026-09-20', assessAfterQualityISO: '2026-09-23',
      assessAfterRaceISO: '2026-09-27',
      todayISO: '2026-09-06',   // a different night
    });
    expect(again.map((r) => r.idempotencyKey)).toEqual(reqs.map((r) => r.idempotencyKey));
    expect(new Set(reqs.map((r) => r.idempotencyKey)).size).toBe(3);
  });

  it('each says what it is for, in words a person can act on', () => {
    for (const r of reqs) {
      expect(r.reasonDetail.length).toBeGreaterThan(40);
      expect(r.reasonDetail).not.toMatch(/TODO|later/i);
    }
    expect(reqs[1].reasonDetail).toContain('rather than pretending Tuesday never occurred');
  });
});
