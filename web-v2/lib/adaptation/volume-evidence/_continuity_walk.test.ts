/**
 * lib/adaptation/volume-evidence/_continuity_walk.test.ts · CONTINUOUS-EVIDENCE-1.
 *
 * THE WALK. CLAUDE.md Rule 9's own enforcement clause, applied to the path this
 * change rebuilt:
 *
 *     "`_restore_continuity.test.ts` and `_coach_sensible.test.ts` walk a
 *      synthetic runner across each boundary in small increments and assert the
 *      output vector moves continuously and monotonically. ANY NEW BEHAVIOURAL
 *      SWITCH DERIVED FROM COMPARING TWO COMPUTED QUANTITIES GETS A WALK."
 *
 * Three axes are walked, because three genuinely continuous inputs feed this
 * path and each one had a step on it before this change:
 *
 *   1 · the SIZE of the surplus          (the owner's 0.4-mile cliff)
 *   2 · the following week's COMPLETION  (the 94.9% / 95.1% cliff)
 *   3 · the AGE of the evidence          (the window-edge cliff, in time)
 *
 * and then the WHOLE PIPELINE end to end, because a composition of continuous
 * functions with hard gates in it is only continuous if every gate sits where
 * its curve already returns zero. That is the load-bearing structural claim of
 * this change and asserting it is the point of case 4.
 *
 * ── RULE 22 · WHAT THIS SUITE CANNOT FAIL ON ──────────────────────────────
 *
 * Stated first and deliberately, because a green continuity walk reads as a
 * much stronger result than it is:
 *
 * · IT CANNOT FAIL ON A CURVE THAT IS SMOOTH AND WRONG. Continuity and
 *   monotonicity are the only properties asserted. A curve that credits ten
 *   times too much evidence, smoothly and monotonically, passes every case
 *   here. Whether the coefficients are right is `_continuous_evidence.test.ts`'s
 *   question, and whether they are good COACHING is nobody's test.
 * · IT CANNOT FAIL ON A CLIFF IN AN INPUT IT DOES NOT WALK. It walks surplus
 *   size, following-week completion and evidence age. A discontinuity in, say,
 *   the number of deteriorated sessions would not be seen — deliberately, since
 *   that input is an integer count and has no neighbourhood to be continuous
 *   over.
 * · IT CANNOT FAIL ON A CLIFF BETWEEN SAMPLE POINTS. A discontinuity narrower
 *   than one walk step is invisible. The pure-curve walks step at 0.00005 to
 *   0.001 of their input, far finer than anything the engine expresses; the
 *   PIPELINE walks step at 0.1 mi, which is the finest distance this engine
 *   has (`roundTo`), so nothing narrower than one step exists there to find.
 *   It remains a theoretical hole.
 * · IT CANNOT FAIL ON THE SEAM. `AUTOMATIC_ADAPTATION_AUTHORITY` is false and
 *   this directory has no writer. A perfectly continuous advisory says nothing
 *   about the plan on the runner's phone.
 * · IT CANNOT FAIL ON A BAD LOADER. Every case constructs its own week.
 *
 * ── RULE 18 · THIS GATE HAS BEEN MADE TO FAIL ─────────────────────────────
 *
 * `_falsify_continuity.script.ts` re-runs case 1's walk against a deliberately
 * STEPPED implementation of the same curve — the binary bar this change
 * removed, reconstructed — and the assertion below names it. The failure
 * message is recorded in the report. A walk that has never failed is a
 * hypothesis, and `assertContinuousAndMonotone` is exported precisely so the
 * falsifier can run the identical assertion over a different function rather
 * than a paraphrase of it.
 */
import { describe, expect, it } from 'vitest';
import { admitSurplus, type AdmissionInput } from './admit';
import type { HrTraceVerdict } from '@/lib/adaptation/canonical/hr-trace-credibility';
import { classifyWeekSurplus } from './classify';
import { accumulateCapacityEvidence, weighCapacity, type CapacityEvidence } from './evidence';
import { respondToVolumeEvidence } from './respond';
import {
  absorptionWeight,
  creditedSurplusFrac,
  EVIDENCE_WINDOW_DAYS,
  recencyWeight,
} from './weight';
import {
  absent, measured, VOLUME_WEEK_COMPLETION_MIN_FRAC,
  type FutureWeek, type SurplusRun, type WeekSurplusInput,
} from './contract';

/* ══════════════════════════════════════════════════════════════════════════
 * THE ASSERTION, ONCE
 *
 * Exported so `_falsify_continuity.script.ts` runs THIS function over a
 * stepped curve rather than a paraphrase of it. Rule 18: a falsifier that
 * re-implements the check proves the re-implementation fails, not the check.
 * ═══════════════════════════════════════════════════════════════════════ */

export interface WalkResult {
  readonly samples: number;
  readonly range: number;
  readonly maxJump: number;
  /** `max |Delta output / Delta input|`. THE NUMBER THAT DISCRIMINATES. */
  readonly maxSlope: number;
  readonly maxSlopeAt: number;
  readonly monotone: boolean;
  readonly firstDecreaseAt: number | null;
}

/**
 * Walk `f` from `from` to `to` in `step` increments and measure how it moves.
 *
 * -- WHY THE METRIC IS SLOPE AND NOT "SHARE OF THE OUTPUT RANGE" ------------
 *
 * The first cut of this file measured `maxJump / range` and FAILED all five
 * pipeline cases, on a curve that is provably continuous. Recorded here rather
 * than quietly corrected, because the wrong metric is instructive:
 *
 *   · `roundTo` quantises miles to 0.1 in `classify.ts`, so the pipeline's
 *     input is a STAIRCASE however finely the walk samples it. Sampling at
 *     0.01 mi reported a 10 per cent jump that was one 0.1-mile quantum.
 *   · a LINEAR RAMP sampled coarsely reports large per-sample shares by
 *     definition. `recencyWeight` ramps over seven days; walking it at
 *     0.25-day steps puts one twenty-eighth of the range in every step, and
 *     that is 3.6 per cent. Nothing is wrong with the ramp.
 *
 * Both are artefacts of SAMPLING, and a metric that cannot tell an artefact
 * from a defect is a metric that will eventually be relaxed until it means
 * nothing. Slope cannot be fooled by either: a ramp has the same bounded slope
 * at every sampling density, and a STEP has slope `jump / step`, which grows
 * without bound as the walk gets finer. That is exactly the difference between
 * "continuous" and "has a cliff", stated the way mathematics states it, and it
 * is the derivative the Rule 9 audit said nothing in this repo was sampling.
 */
export function walk(
  f: (x: number) => number,
  from: number,
  to: number,
  step: number,
): WalkResult {
  const xs: number[] = [];
  for (let x = from; x <= to + 1e-12; x += step) xs.push(x);
  const ys = xs.map(f);
  let maxJump = 0;
  let maxSlope = 0;
  let maxSlopeAt = from;
  let monotone = true;
  let firstDecreaseAt: number | null = null;
  for (let i = 1; i < ys.length; i += 1) {
    const dy = ys[i] - ys[i - 1];
    const dx = xs[i] - xs[i - 1];
    if (Math.abs(dy) > maxJump) maxJump = Math.abs(dy);
    const slope = Math.abs(dy / dx);
    if (slope > maxSlope) {
      maxSlope = slope;
      maxSlopeAt = xs[i];
    }
    // A tolerance of 1e-12 rather than 0: these are floating-point sums and a
    // reversal of one part in 1e12 is representation, not behaviour.
    if (dy < -1e-12) {
      monotone = false;
      if (firstDecreaseAt == null) firstDecreaseAt = xs[i];
    }
  }
  const range = Math.max(...ys) - Math.min(...ys);
  return { samples: xs.length, range, maxJump, maxSlope, maxSlopeAt, monotone, firstDecreaseAt };
}

/**
 * THE CONTRACT: monotone, and Lipschitz-bounded.
 *
 * `maxSlope` is asserted against a bound stated at each call site and derived
 * from the curve there, never chosen to make the case pass. Every bound in
 * this file sits at or a little above the analytic slope of the smooth curve,
 * and `_falsify_continuity.script.ts` shows a stepped implementation of the
 * SAME curve exceeding its bound by more than two orders of magnitude. That
 * gap is what makes the bound a discriminator rather than a tolerance: there
 * is nothing in between for a bound to be tuned into.
 *
 * Exported so the falsifier runs THIS function over a stepped curve rather
 * than a paraphrase of it. Rule 18: a falsifier that re-implements the check
 * proves the re-implementation fails, not the check.
 */
export function assertContinuousAndMonotone(
  label: string,
  r: WalkResult,
  maxSlopeBound: number,
): void {
  if (!r.monotone) {
    throw new Error(
      `CONTINUITY · ${label} is NOT MONOTONE. Output decreased at input `
      + `${r.firstDecreaseAt}. A runner who did MORE must never be credited LESS `
      + '(CLAUDE.md Rule 9 · "the fitter runner gets the worse plan" is the signature).',
    );
  }
  if (r.maxSlope > maxSlopeBound) {
    throw new Error(
      `CONTINUITY · ${label} HAS A CLIFF. The steepest increment, at input `
      + `${r.maxSlopeAt}, moved the output by ${r.maxJump.toPrecision(4)} for a slope of `
      + `${r.maxSlope.toPrecision(4)} per unit of input, against a bound of ${maxSlopeBound}. `
      + `Measured across ${r.samples} samples spanning an output range of `
      + `${r.range.toPrecision(4)}. CLAUDE.md Rule 9: a hair's difference in input must never `
      + 'produce a categorically different outcome.',
    );
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * FIXTURES · the owner's own week, so the walk is over real magnitudes.
 * ═══════════════════════════════════════════════════════════════════════ */

/** 2026-06-15, the week the owner named. */
const PRESCRIBED = 45.5;
const WEEK = '2026-06-15';

const dayRun = (dateISO: string, mi: number, prescribedMi: number | null): SurplusRun => ({
  activityId: `day:${dateISO}`,
  dateISO,
  distanceMi: measured(mi),
  match: prescribedMi == null ? 'supplemental' : 'legacy_type',
  mergedIntoAnother: false,
  isRace: false,
  prescribedMi,
  movedFromDateISO: null,
});

/**
 * An ordinary BUILD week prescribing `PRESCRIBED` across seven days, run at
 * `completedMi`. The surplus lands on one day, which is the shape the owner's
 * own week had: a long run that went further than asked.
 */
function weekAt(completedMi: number): WeekSurplusInput {
  const perDay = PRESCRIBED / 7;
  const runs: SurplusRun[] = [];
  for (let i = 0; i < 7; i += 1) {
    const d = `2026-06-${String(15 + i).padStart(2, '0')}`;
    // Six days exactly to prescription, the seventh carrying the whole surplus.
    const mi = i < 6 ? perDay : perDay + (completedMi - PRESCRIBED);
    runs.push(dayRun(d, mi, perDay));
  }
  return {
    weekStartISO: WEEK,
    prescribedMi: PRESCRIBED,
    runs,
    authoredPlanMode: 'BUILD',
    isCutback: false,
    isRaceWeek: false,
    inPrescribedRaceWindow: false,
    dataComplete: true,
  };
}

const conditionsWith = (followingFrac: number | null): Omit<AdmissionInput, 'week'> => ({
  identityResolved: measured(true),
  telemetry: absent<HrTraceVerdict>('no heart-rate question on a distance lever'),
  deterioration: measured({
    repeated: false, deterioratedCount: 0, unknownCount: 0, cleanCount: 3,
    detail: 'clean',
  }),
  keySessionGrades: [],
  painOrInjuryReported: measured(false),
  unplannedRecoveryTaken: measured(false),
  followingWeekCompletionFrac: followingFrac == null
    ? absent('the week after this one has not been run yet')
    : measured(followingFrac),
  absorptionCompletionBar: VOLUME_WEEK_COMPLETION_MIN_FRAC,
});

/** The whole per-week path, as one number: what this week is worth. */
export function unitsForCompletedMi(completedMi: number, followingFrac = 1.0): number {
  const surplus = classifyWeekSurplus(weekAt(completedMi));
  const conditions = conditionsWith(followingFrac);
  const admission = admitSurplus({ ...conditions, week: surplus });
  return weighCapacity(surplus, admission, conditions).units;
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE WALKS
 * ═══════════════════════════════════════════════════════════════════════ */

describe('CONTINUOUS-EVIDENCE-1 · the continuity walk (CLAUDE.md Rule 9)', () => {
  it('LIVENESS · every walk below took real samples and moved a real range', () => {
    // Rule 18 · "a scanner states how many files it read and fails on zero.
    // Reporting clean because it looked at nothing is the worst outcome
    // available, since it also reports confidence." A walk over a constant
    // function is monotone and cliff-free and proves nothing at all.
    const r = walk((mi) => unitsForCompletedMi(mi), PRESCRIBED, PRESCRIBED * 1.35, 0.1);
    expect(r.samples).toBeGreaterThan(150);
    expect(r.range).toBeGreaterThan(0.04);
    expect(r.maxSlope).toBeGreaterThan(0);
  });

  /* ── 1 · THE OWNER'S OWN CLIFF ──────────────────────────────────────── */

  it('1 · the SIZE of the surplus · 45.5 to 61.4 mi at the engine resolution, no cliff', () => {
    // This is the exact axis the owner's finding sits on. The old code
    // returned zero below 47.775 mi and the full surplus above it; 47.3 was
    // 0.4 mi short. The walk crosses that point 1,590 times over.
    // Walked at 0.1 mi, which is this engine's own distance resolution
    // (`roundTo`). Sampling finer than the quantum measures the staircase
    // `classify.ts` imposes, not this curve.
    //
    // BOUND · `creditedSurplusFrac` peaks at a slope of about 2.06 per unit of
    // surplus FRACTION, in the middle of the GPS noise ramp. Over a 45.5 mi
    // prescription that is about 0.045 per MILE. The bound is 0.15, a little
    // over three times it, to absorb quantum alignment. The stepped
    // implementation the falsifier runs reaches 0.5 on this same walk.
    const r = walk((mi) => unitsForCompletedMi(mi), PRESCRIBED, PRESCRIBED * 1.35, 0.1);
    assertContinuousAndMonotone('units vs completed miles', r, 0.15);

    // And the specific number the owner asked about is non-zero.
    expect(unitsForCompletedMi(47.3)).toBeGreaterThan(0);
    // A hair either side of the OLD bar moves the output by a hair, not a
    // category. This is the falsifiable form of "the cliff is gone".
    const below = unitsForCompletedMi(47.7);
    const above = unitsForCompletedMi(47.9);
    expect(above - below).toBeLessThan(0.005);
    expect(above).toBeGreaterThan(below);
  });

  it('1b · GPS noise still contributes nothing, and does so without a step', () => {
    // The one hard zero on this axis, and the gate sits exactly where the
    // curve already returns zero AND has zero derivative. Both halves matter:
    // a gate at a point where the curve is non-zero would be a cliff.
    expect(creditedSurplusFrac(0.010)).toBe(0);
    expect(creditedSurplusFrac(0.0099)).toBe(0);
    expect(creditedSurplusFrac(0.0101)).toBeGreaterThan(0);
    expect(creditedSurplusFrac(0.0101)).toBeLessThan(1e-5);
    assertContinuousAndMonotone(
      'creditedSurplusFrac across the GPS noise floor',
      // BOUND · the analytic maximum of d(credited)/ds is about 2.06, at the
      // steepest point of the smoothstep. A step at the old 5 per cent bar
      // would show 0.05 / 0.00005 = 1000 on this same walk.
      walk(creditedSurplusFrac, 0, 0.06, 0.00005),
      3,
    );
  });

  it('1c · saturation is continuous · an extreme week is capped, not stepped', () => {
    assertContinuousAndMonotone(
      'creditedSurplusFrac across the per-week ceiling',
      // BOUND · past the noise gate the curve is `min(s, 0.05)`, whose slope
      // is exactly 1 below the ceiling and 0 above it.
      walk(creditedSurplusFrac, 0.03, 0.30, 0.0001),
      1.01,
    );
    // A 40-per-cent week and a 15-per-cent week are the same evidence about
    // SUSTAINABLE capacity, which is the owner's own requirement.
    expect(creditedSurplusFrac(0.40)).toBe(creditedSurplusFrac(0.15));
  });

  /* ── 2 · THE ABSORPTION CLIFF ───────────────────────────────────────── */

  it('2 · the following week COMPLETION · 0.80 to 1.00, no cliff at 0.95', () => {
    // BOUND · a straight ramp from 0 at 0.90 to 1 at 0.95 has slope exactly
    // 1 / 0.05 = 20 inside the band and 0 outside it. A step at 0.95 would
    // show 1 / 0.0005 = 2000.
    const r = walk(absorptionWeight, 0.80, 1.00, 0.0005);
    assertContinuousAndMonotone('absorptionWeight vs following-week completion', r, 20.01);
    // The doctrine bars are where doctrine put them, and the ramp meets them
    // exactly, which is why the composite has no step at either.
    expect(absorptionWeight(0.90)).toBe(0);
    expect(absorptionWeight(0.95)).toBe(1);
    expect(absorptionWeight(0.949)).toBeGreaterThan(0.9);
    expect(absorptionWeight(0.949)).toBeLessThan(1);
  });

  it('2b · the SPENDABLE half moves continuously with the following week too', () => {
    const spendable = (frac: number): number => {
      const surplus = classifyWeekSurplus(weekAt(PRESCRIBED * 1.08));
      const conditions = conditionsWith(frac);
      const admission = admitSurplus({ ...conditions, week: surplus });
      return weighCapacity(surplus, admission, conditions).confirmedUnits;
    };
    assertContinuousAndMonotone(
      'confirmedUnits vs following-week completion',
      // BOUND · `confirmedUnits` is `credited × absorptionWeight`, and
      // `credited` saturates at 0.05 here, so the slope is at most
      // 0.05 × 20 = 1.
      walk(spendable, 0.50, 1.00, 0.001),
      1.01,
    );
  });

  /* ── 3 · THE CLIFF IN TIME ──────────────────────────────────────────── */

  it('3 · the AGE of the evidence · 0 to 35 days, decays without vanishing', () => {
    // recencyWeight DECREASES with age, so the monotone assertion is applied
    // to its negation. A flat window would drop a week's whole contribution in
    // one day, which is Rule 9's cliff on the time axis.
    // BOUND · a straight ramp from 1 at 21 days to 0 at 28 has slope exactly
    // 1/7 = 0.1429. A flat window would drop the whole weight in one day, for
    // a slope of 4 at this sampling.
    const r = walk((age) => -recencyWeight(age), 0, 35, 0.25);
    assertContinuousAndMonotone('recencyWeight vs age (negated for direction)', r, 0.143);
    expect(recencyWeight(0)).toBe(1);
    expect(recencyWeight(21)).toBe(1);
    expect(recencyWeight(EVIDENCE_WINDOW_DAYS)).toBe(0);
    expect(recencyWeight(EVIDENCE_WINDOW_DAYS + 7)).toBe(0);
  });

  /* ── 4 · THE WHOLE PIPELINE, WHICH IS THE REAL CLAIM ────────────────── */

  it('4 · END TO END · miles run in, miles proposed out, no cliff anywhere', () => {
    /* THE STRUCTURAL CLAIM OF THIS CHANGE, ASSERTED RATHER THAN DESCRIBED.
     *
     * The pipeline still contains hard gates. A composition of continuous
     * functions WITH hard gates is continuous only if every gate sits at a
     * point where the curve behind it already returns zero. That is how each
     * remaining gate was placed, and this case is what proves it: it runs
     * classify -> admit -> weigh -> accumulate -> respond and measures the
     * MILES the responder would add. */
    const future: FutureWeek[] = [0, 1, 2].map((i) => ({
      weekStartISO: `2026-06-${String(22 + i * 7).padStart(2, '0')}`,
      prescribedMi: 46,
      sealed: false,
      isCutback: false,
      isTaper: false,
      isRaceWeek: false,
      stressors: [],
      longestMi: 14,
      mpMi: 0,
    }));

    const addedMiFor = (completedMi: number): number => {
      const surplus = classifyWeekSurplus(weekAt(completedMi));
      const conditions = conditionsWith(1.0);
      const admission = admitSurplus({ ...conditions, week: surplus });
      const capacity = weighCapacity(surplus, admission, conditions);
      const ledger = accumulateCapacityEvidence([capacity], '2026-06-22');
      const belief = {
        asOfISO: '2026-06-22',
        peakWeeklyMi: 47, sustainedWeeklyMi: 44, heldWeeklyMi: 45, meanWeeklyMi: 43,
        absorbedWeeklyMiUnfiltered: 47, moves: [],
      };
      return respondToVolumeEvidence({
        asOfISO: '2026-06-22',
        athleteId: 'walk',
        planVersion: 'v1',
        evidenceVersion: 'e1',
        week: surplus,
        admission,
        progressionFraction: ledger.progressionFraction,
        beliefBefore: belief,
        beliefAfter: { ...belief, peakWeeklyMi: Math.max(47, completedMi) },
        futureWeeks: future,
        weekBeforeFirstFuture: null,
        phase: 'BUILD',
        distanceFloorMi: 30,
        templatePeakBandMi: [40, 70],
        stepsTakenThisCycle: 0,
        nextBoundaryISO: '2026-07-20',
      }).totalAddedMi;
    };

    // BOUND · two effects add here. The curve carries about 0.045 units per
    // mile, through progressionFraction (divide by 0.15) into three future
    // weeks each capped at 5 per cent of 46 mi, which is roughly 2.1 mi of
    // proposal per mile run. And `totalAddedMi` is rounded to 0.1 mi, which at
    // a 0.1 mi walk step contributes at most another 1.0. The bound is 5,
    // above both and far below what a step produces: the old binary behaviour
    // put the ENTIRE 2.4 mi range into one increment, a slope of 24.
    const r = walk(addedMiFor, PRESCRIBED, PRESCRIBED * 1.30, 0.1);
    assertContinuousAndMonotone('proposed added miles vs completed miles', r, 5);
    expect(r.range).toBeGreaterThan(0.5);
    // The runner who ran further is never proposed less. Rule 9's signature.
    expect(addedMiFor(PRESCRIBED * 1.20)).toBeGreaterThanOrEqual(addedMiFor(PRESCRIBED * 1.02));
  });

  /* ── 5 · THE ACCUMULATOR ────────────────────────────────────────────── */

  it('5 · the LEDGER moves continuously as one week in it grows', () => {
    const three = (growingCompletedMi: number): number => {
      const readings: CapacityEvidence[] = ['2026-06-01', '2026-06-08', '2026-06-15']
        .map((ws, i) => {
          const input = { ...weekAt(i === 2 ? growingCompletedMi : PRESCRIBED * 1.03), weekStartISO: ws };
          const surplus = classifyWeekSurplus(input);
          const conditions = conditionsWith(1.0);
          return weighCapacity(surplus, admitSurplus({ ...conditions, week: surplus }), conditions);
        });
      return accumulateCapacityEvidence(readings, '2026-06-22').progressionFraction;
    };
    assertContinuousAndMonotone(
      'ledger progressionFraction vs the newest week',
      // BOUND · progressionFraction is units divided by 0.15, so the per-mile
      // slope is about 0.045 / 0.15 = 0.30.
      walk(three, PRESCRIBED, PRESCRIBED * 1.20, 0.1),
      1.0,
    );
  });
});
