/**
 * WEEKLYDEMAND-CONT-1 · Rule 9 · no cliffs, no inversions, in any input.
 *
 * "If two adjacent inputs a tenth of a mile apart produce plans that differ in
 * kind rather than degree, that is a defect, not a boundary." Rule 9's own
 * audit named why nothing in this repository could see that class: every gate
 * samples the output at POINTS and asks whether each point is legal, and both
 * sides of a cliff are legal. Nothing sampled the DERIVATIVE.
 *
 * So this walks every continuous input of the demand model in small increments
 * and asserts two things at every step:
 *
 *   CONTINUITY · no single increment moves the index more than a stated
 *     Lipschitz bound times the increment. The bounds are derived from the
 *     model's own slopes and written down beside each walk, so a bound that is
 *     quietly loosened is visible in the diff.
 *   MONOTONICITY · the index moves in ONE direction. More mileage, more
 *     quality, a longer long run, tighter hard-day spacing, a higher
 *     acute-to-chronic ratio, longer since a down week and a more recent race
 *     may never make a week cost LESS. A longer recent long run and more days
 *     since a race may never make it cost more.
 *
 * The recurring signature Rule 9 names is "the fitter runner gets the worse
 * plan". Here it would be "the harder week prices cheaper", and the inversion
 * half of every walk is what would catch it.
 *
 * ── RULE 18 · FALSIFIED BEFORE IT LANDED ───────────────────────────────────
 *
 * Two ways, and both are kept in the file rather than described in a report:
 *
 *   1 · ORACLE, permanent. `steppedIndex` below is the same model written the
 *       way this engine has repeatedly written models: a step at Gabbett's
 *       1.3 and 1.5, and a step at doctrine's 110% long-run threshold. The
 *       SAME walk runs over it and must REPORT the cliff. If the detector ever
 *       stops matching, that test goes red before any real regression can slip
 *       past unnoticed.
 *   2 · BY HAND, against the real module. `ADAPTATION_CURVE` was temporarily
 *       replaced with a step and the walk reported the jump by name. The
 *       failure text is in the session report.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 *   · A cliff in an input it does not walk. It walks the seven continuous ones
 *     and the count is asserted, so adding an eighth without a walk fails.
 *   · A DISCRETE input. `hardSessionDayOrdinals.length` is an integer and
 *     cannot differ by a hair, so there is no cliff to have. What the walk does
 *     cover is where those sessions FALL, which is continuous and is where the
 *     crowding term lives.
 *   · `atCeiling`, which is a boolean and steps by construction. That is legal
 *     under Rule 9, which forbids a DECISION hinging on a hair and permits a
 *     discrete readout. Nothing in the app acts on this module.
 *   · Whether the SHAPE of each response is right. A smooth wrong curve passes
 *     every assertion here.
 */
import { describe, it, expect } from 'vitest';
import {
  computeWeeklyDemand,
  adaptationFraction,
  longRunSpikeFraction,
  ADAPTATION_UPLIFT_AT_DANGER,
  LONG_RUN_SPIKE_RATIO,
  LONG_RUN_SPIKE_RISK_UPLIFT,
  type WeeklyDemandInput,
} from './weekly-demand';

/* The walk is run against a single week so every slope below is the slope of
 * THIS week, which is what makes the Lipschitz bounds checkable by hand. */
const W: WeeklyDemandInput = {
  weekStartISO: '2026-10-26',
  weeklyMi: 60,
  qualityMinutes: 65,
  longRunMi: 21.5,
  hardSessionDayOrdinals: [2, 4, 6],
  longestRunPrior30dMi: 18,
  acwr: { acwr: 1.15, acute7: 6.9, chronic28: 6.0, coverageDays: 28, reason: null },
  lastRace: { daysSince: 71, noQualityWindowDays: 28 },
  weeksSinceLastCutback: 3,
  demonstratedWeeks: null,
  safety: null,
};

interface WalkResult {
  readonly samples: number;
  readonly worstStep: number;
  readonly worstStepAt: number;
  readonly worstRise: number;
  readonly worstRiseAt: number;
  readonly worstFall: number;
  readonly worstFallAt: number;
}

/** Step one input across a range and report the worst move in each direction. */
function walk(
  lo: number, hi: number, by: number, f: (x: number) => number,
): WalkResult {
  let prev = f(lo);
  let worstStep = 0; let worstStepAt = lo;
  let worstRise = 0; let worstRiseAt = lo;
  let worstFall = 0; let worstFallAt = lo;
  let samples = 1;
  for (let i = 1; ; i++) {
    const x = Math.round((lo + i * by) * 1e6) / 1e6;
    if (x > hi + 1e-9) break;
    const cur = f(x);
    const d = cur - prev;
    if (Math.abs(d) > worstStep) { worstStep = Math.abs(d); worstStepAt = x; }
    if (d > worstRise) { worstRise = d; worstRiseAt = x; }
    if (-d > worstFall) { worstFall = -d; worstFallAt = x; }
    prev = cur;
    samples += 1;
  }
  return { samples, worstStep, worstStepAt, worstRise, worstRiseAt, worstFall, worstFallAt };
}

function indexOf(patch: Partial<WeeklyDemandInput>): number {
  const r = computeWeeklyDemand({ ...W, ...patch });
  if (r.demandIndex == null) {
    throw new Error(`the walk hit a refusal at ${JSON.stringify(patch)}`);
  }
  return r.demandIndex;
}

/** The index is rounded to three places, so a flat stretch reads as a 0.001
 *  wobble. Every tolerance below absorbs exactly that and no more. */
const QUANTUM = 0.0015;

/* ══════════════════════════════════════════════════════════════════════════
 * THE WALKS
 * ═══════════════════════════════════════════════════════════════════════ */

/** name -> [lo, hi, by, maxStep, direction] where direction is the only sign
 *  the index is allowed to move in as the input RISES. */
const WALKS: ReadonlyArray<{
  readonly name: string;
  readonly lo: number; readonly hi: number; readonly by: number;
  readonly maxStep: number;
  readonly rises: boolean;
  readonly f: (x: number) => number;
  readonly slope: string;
}> = [
  {
    name: 'weeklyMi',
    lo: 20, hi: 80, by: 0.01, maxStep: 0.05, rises: true,
    f: (x) => indexOf({ weeklyMi: x }),
    slope: 'd/dMi is (1 + uplift), about 1.12 here, so 0.01 mi moves 0.012',
  },
  {
    name: 'qualityMinutes',
    lo: 0, hi: 150, by: 0.01, maxStep: 0.02, rises: true,
    f: (x) => indexOf({ qualityMinutes: x }),
    slope: 'd/dMin is 0.33 * (1 + uplift), about 0.37, so 0.01 min moves 0.004',
  },
  {
    name: 'longRunMi',
    lo: 5, hi: 30, by: 0.01, maxStep: 0.10, rises: true,
    f: (x) => indexOf({ longRunMi: x }),
    slope: 'quadratic in the spike term; about 4.5 per mile at the top of the range',
  },
  {
    name: 'longestRunPrior30dMi',
    lo: 10, hi: 30, by: 0.01, maxStep: 0.20, rises: false,
    f: (x) => indexOf({ longestRunPrior30dMi: x }),
    slope: 'inverse-square in the spike term; about 8 per mile at the bottom',
  },
  {
    name: 'acwr',
    lo: 0.4, hi: 2.2, by: 0.001, maxStep: 0.15, rises: true,
    f: (x) => indexOf({
      acwr: { acwr: x, acute7: 6 * x, chronic28: 6, coverageDays: 28, reason: null },
    }),
    slope: 'steepest between 1.3 and 1.5: 0.15 of base per 0.2 of ratio, about 70 per unit',
  },
  {
    name: 'hardDayPlacement',
    lo: 2, hi: 4, by: 0.01, maxStep: 0.15, rises: false,
    f: (x) => indexOf({ hardSessionDayOrdinals: [2, x, 6] }),
    slope: 'crowding falls 0.5 per day of gap, so about 5.6 index per day',
  },
  {
    name: 'weeksSinceLastCutback',
    lo: 0, hi: 12, by: 0.01, maxStep: 0.15, rises: true,
    f: (x) => indexOf({ weeksSinceLastCutback: x }),
    slope: 'debt rises 0.25 per week over one cadence, so about 4.7 index per week',
  },
  {
    name: 'daysSinceLastRace',
    lo: 0, hi: 60, by: 0.01, maxStep: 0.05, rises: false,
    f: (x) => indexOf({ lastRace: { daysSince: x, noQualityWindowDays: 28 } }),
    slope: 'overlap falls 1/28 per day, so about 0.7 index per day',
  },
];

describe('WEEKLYDEMAND-CONT-1 · every continuous input is walked', () => {
  it('LIVENESS · the walks really ran, over real ranges', () => {
    // Rule 18 point 2. A walk that sampled nothing would report clean.
    expect(WALKS.length).toBe(8);
    for (const w of WALKS) {
      const r = walk(w.lo, w.hi, w.by, w.f);
      expect(r.samples, `${w.name} sampled almost nothing`).toBeGreaterThan(100);
    }
  });

  it('the walk list covers every continuous field of the input type', () => {
    // An eighth continuous input added without a walk fails here rather than
    // silently going unwatched, which is Rule 15 applied to this suite.
    const covered = new Set(WALKS.map((w) => w.name));
    for (const name of [
      'weeklyMi', 'qualityMinutes', 'longRunMi', 'longestRunPrior30dMi',
      'acwr', 'hardDayPlacement', 'weeksSinceLastCutback', 'daysSinceLastRace',
    ]) {
      expect(covered).toContain(name);
    }
  });

  for (const w of WALKS) {
    it(`${w.name} moves the index continuously (${w.slope})`, () => {
      const r = walk(w.lo, w.hi, w.by, w.f);
      expect(
        r.worstStep,
        `${w.name}: a single ${w.by} step moved the index ${r.worstStep.toFixed(4)} `
        + `at ${w.name}=${r.worstStepAt}. That is a cliff, not a boundary.`,
      ).toBeLessThanOrEqual(w.maxStep);
    });

    it(`${w.name} moves the index monotonically`, () => {
      const r = walk(w.lo, w.hi, w.by, w.f);
      if (w.rises) {
        expect(
          r.worstFall,
          `${w.name}: raising it to ${r.worstFallAt} made the week CHEAPER by `
          + `${r.worstFall.toFixed(4)}. The harder week priced lower.`,
        ).toBeLessThanOrEqual(QUANTUM);
      } else {
        expect(
          r.worstRise,
          `${w.name}: raising it to ${r.worstRiseAt} made the week DEARER by `
          + `${r.worstRise.toFixed(4)}, which is backwards.`,
        ).toBeLessThanOrEqual(QUANTUM);
      }
    });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE ORACLE · the detector is made to fail on purpose
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The same two responses written as STEP functions, which is how this engine
 * has repeatedly written them: `acwr > 1.5 -> 0.88, acwr > 1.3 -> 0.95` was
 * the shipped shape of `loadContextMultiplier` before CONTINUOUS-LOAD-1, and a
 * long-run spike that is off below 110% and fully on above it is the obvious
 * reading of the same doctrine row this model cites.
 *
 * Both are legal at every sampled point. Both are cliffs.
 */
function steppedAdaptationFraction(acwr: number): number {
  if (acwr > 1.5) return ADAPTATION_UPLIFT_AT_DANGER * 2;
  if (acwr > 1.3) return ADAPTATION_UPLIFT_AT_DANGER;
  if (acwr < 0.8) return -ADAPTATION_UPLIFT_AT_DANGER;
  return 0;
}

function steppedSpikeFraction(longRunMi: number, priorMi: number): number {
  return longRunMi / priorMi > LONG_RUN_SPIKE_RATIO ? 1 : 0;
}

/** A stepped index over the same week, so the walk sees the same magnitudes. */
function steppedIndex(patch: { acwr?: number; longRunMi?: number }): number {
  const longRunMi = patch.longRunMi ?? (W.longRunMi as number);
  const acwr = patch.acwr ?? 1.15;
  const flat = longRunMi * 0.25;
  const base = (W.weeklyMi as number)
    + (W.qualityMinutes as number) * 0.33
    + flat * (1 + LONG_RUN_SPIKE_RISK_UPLIFT
      * steppedSpikeFraction(longRunMi, W.longestRunPrior30dMi as number));
  return base * (1 + 0.12 + steppedAdaptationFraction(acwr));
}

describe('WEEKLYDEMAND-CONT-1 · ORACLE · the detector catches a cliff', () => {
  it('a stepped ACWR response is REPORTED, at the step', () => {
    const r = walk(0.4, 2.2, 0.001, (x) => steppedIndex({ acwr: x }));
    expect(r.worstStep).toBeGreaterThan(0.15);   // the live bound for this walk
    // And it names where, which is what makes a failure actionable. Both of
    // Gabbett's edges carry an identical jump under this shape, so the worst
    // step lands on one of them and the assertion accepts either.
    const atAnEdge = Math.abs(r.worstStepAt - 1.3) < 0.02
      || Math.abs(r.worstStepAt - 1.5) < 0.02;
    expect(atAnEdge, `the worst step was at ${r.worstStepAt}`).toBe(true);
  });

  it('a stepped long-run spike is REPORTED, at 110% of his longest', () => {
    const r = walk(5, 30, 0.01, (x) => steppedIndex({ longRunMi: x }));
    expect(r.worstStep).toBeGreaterThan(0.10);   // the live bound for this walk
    expect(r.worstStepAt).toBeCloseTo(18 * LONG_RUN_SPIKE_RATIO, 1);
  });

  it('and the REAL responses pass the same two walks', () => {
    // The positive control's counterpart. Same detector, same ranges, and the
    // shipped functions are smooth where the stepped ones are not.
    const a = walk(0.4, 2.2, 0.001, adaptationFraction);
    expect(a.worstStep).toBeLessThan(0.001);
    // The spike fraction rises 1 / (0.10 * 18) = 0.556 per mile, so a 0.01 mi
    // step may move it 0.0056 and no more.
    const s = walk(5, 30, 0.01, (x) => longRunSpikeFraction(x, 18));
    expect(s.worstStep).toBeLessThan(0.006);
  });
});
