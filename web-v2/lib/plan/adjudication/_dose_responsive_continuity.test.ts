/**
 * lib/plan/adjudication/_dose_responsive_continuity.test.ts · Rule 9, walked.
 *
 * Rule 9's audit said the apparatus could not see this class at all: "every
 * gate samples the output space at POINTS and asks whether each point is legal.
 * That is precisely the check a discontinuity passes, because both sides of a
 * cliff are legal plans. Nothing sampled the derivative."
 *
 * `_dose_responsive.test.ts` samples points. This file samples the derivative.
 * It walks a synthetic runner's evidence across every threshold in this
 * module's decision surface in fine increments and asserts two things at every
 * step: the dose moves MONOTONICALLY with the evidence, and it never moves more
 * than one grain for one increment of evidence.
 *
 * ── THIS FOUND A REAL CLIFF, AND THAT IS WHY IT EXISTS ─────────────────────
 *
 * The first version of `resolveDose` checked the reduction evidence first and
 * returned early whenever any of it was present. Written that way,
 * "deteriorated sessions in the window" crossing from 0.000 to 0.001 moved a
 * fully earned marathon-pace block from 8.0 miles to 4.5, because one branch
 * ran the earning path and the other did not. Both outputs were legal doses.
 * Rule 9's recurring signature was present too: the better-executing runner
 * got the smaller prescription, because the reduction evidence he happened to
 * have a trace for was what pushed him to the other side.
 *
 * The fix was a crossfade rather than a wider tolerance, per Rule 9's own
 * instruction that widening a tolerance around a threshold relocates the cliff
 * instead of removing it. The walk in §"the branch boundary" below was RED
 * against the early-return version and is the falsifier for it.
 *
 * ── RULE 22 · WHAT THIS SUITE CANNOT FAIL ON ───────────────────────────────
 *
 * It cannot fail on a cliff in a quantity it does not sweep. It walks the
 * READINGS, one requirement at a time, over the fixture below. A discontinuity
 * that only appears when two requirements move together, or on an axis this
 * fixture does not instantiate, is invisible here.
 *
 * It cannot fail on the GRAIN being too coarse. The bound it asserts is "one
 * grain", so setting a grain of ten miles would make every walk pass while
 * making the prescription jump ten miles at a time. The grains are pinned by
 * value in `_dose_responsive.test.ts` and are a design choice, not a
 * measurement.
 *
 * It cannot fail on a cliff OUTSIDE the swept range. Each walk runs from below
 * `rampFrom` to above `threshold` and no further.
 */
import { describe, it, expect } from 'vitest';
import {
  DOSE_AXIS_SHAPE, reading, resolveDose,
  type DoseAxis, type DoseEvidence, type DoseRequirement,
  type DoseResponsivePrescription,
} from '@/lib/plan/adjudication/dose-responsive';
import type { Measured } from '@/lib/adaptation/canonical/input';

const measured = reading.of;

/** Difficulty as a signed number, so monotonicity reads the same on every axis. */
function difficulty(axis: DoseAxis, v: number): number {
  return DOSE_AXIS_SHAPE[axis].harderIs === 'HIGHER' ? v : -v;
}

function req(over: Partial<DoseRequirement> = {}): DoseRequirement {
  return {
    requirementId: 'r',
    what: 'a condition',
    measurable: 'a count',
    reader: 'STIMULUS_GRADE',
    comparator: 'AT_LEAST',
    threshold: 3,
    rampFrom: 1,
    discreteBecause: null,
    byISO: '2026-11-16',
    ...over,
  };
}

const EARN: readonly DoseRequirement[] = [
  req({ requirementId: 'e1' }),
  req({ requirementId: 'e2', reader: 'DETERIORATION_PATTERN', comparator: 'AT_MOST', threshold: 0, rampFrom: 2 }),
  req({ requirementId: 'e3', reader: 'HABIT_WEEKLY_MI', threshold: 48, rampFrom: 40 }),
];
const REDUCE: readonly DoseRequirement[] = [
  req({ requirementId: 'd1', reader: 'DETERIORATION_PATTERN', threshold: 2, rampFrom: 0 }),
  req({ requirementId: 'd2', reader: 'EXECUTION_IDENTITY', comparator: 'AT_MOST', threshold: 2, rampFrom: 5 }),
  req({ requirementId: 'd3', reader: 'ABSORBED_WEEKLY_MI', comparator: 'AT_MOST', threshold: 30, rampFrom: 45 }),
];

function rx(over: Partial<DoseResponsivePrescription> = {}): DoseResponsivePrescription {
  return {
    prescriptionId: 'walk',
    what: 'The marathon-pace block',
    landsOnISO: '2026-11-22',
    axis: 'QUALITY_DOSE_MI',
    target: 'SPECIFICITY',
    defaultDose: { value: 5, provenance: 'CALCULATED_PHYSIOLOGY', basis: 'fixture' },
    earnedDose: { value: 8, provenance: 'CALCULATED_PHYSIOLOGY', basis: 'fixture' },
    reducedDose: { value: 3, provenance: 'CALCULATED_PHYSIOLOGY', basis: 'fixture' },
    earn: EARN,
    reduce: REDUCE,
    assessOnISO: '2026-11-16',
    onIncompleteEvidence: 'HOLD_DEFAULT',
    cap: {
      maxHarder: { value: 3, provenance: 'POLICY_ASSUMPTION', basis: 'fixture' },
      maxEasier: { value: 2, provenance: 'POLICY_ASSUMPTION', basis: 'fixture' },
      hardCeiling: { value: 8, provenance: 'CALCULATED_PHYSIOLOGY', basis: 'fixture' },
      easyFloor: { value: 2, provenance: 'CALCULATED_PHYSIOLOGY', basis: 'fixture' },
    },
    citations: [{ source: 'Research/04', section: '4.5', says: 'fixture', force: 'GUIDELINE' }],
    asymmetryJustified: {},
    ...over,
  };
}

/** Every earning requirement satisfied in full, nothing pressing for a reduction. */
const BASELINE: Record<string, number> = {
  e1: 3, e2: 0, e3: 52,
  d1: 0, d2: 6, d3: 50,
};

/**
 * The reduction set with its OTHER two members already fully pressing, so one
 * reading can be swept and actually move the answer.
 *
 * This is not a convenience, it is the combiner showing through, and it is
 * worth stating. `combinedSatisfaction` takes the MINIMUM on BOTH sides, so a
 * requirement set is an AND in both directions. One adverse signal on its own
 * therefore moves nothing, exactly as one good session on its own earns
 * nothing. That symmetry is the Rule 21 choice: making the reduction set an OR
 * while the earning set stays an AND is precisely how an engine acquires a
 * disposition to only ever come down, one reasonable-looking decision at a
 * time. A caller who genuinely wants "any one of these" must express it as a
 * single requirement over a combined reading, and must do it on both sides or
 * neither.
 */
const REDUCTION_PRESSING: Record<string, number> = { d1: 2, d2: 2, d3: 30 };

function evidenceFrom(over: Record<string, number>): DoseEvidence {
  const merged = { ...BASELINE, ...over };
  const readings = new Map<string, Measured<number>>();
  for (const [k, v] of Object.entries(merged)) readings.set(k, measured(v));
  return { assessedOnISO: '2026-11-16', readings };
}

interface WalkResult {
  readonly samples: readonly { readonly x: number; readonly dose: number }[];
  readonly maxJump: number;
  readonly monotone: boolean;
}

/**
 * Sweep one reading from `lo` to `hi` and record what the dose does.
 *
 * `sense` says which way the dose is expected to move as the reading rises:
 * +1 for an earning requirement, -1 for a reduction one. Monotonicity is
 * asserted in that direction, so a walk that goes the wrong way fails rather
 * than merely being noted.
 */
function walk(
  prescription: DoseResponsivePrescription,
  key: string, lo: number, hi: number, steps: number, sense: 1 | -1,
  hold: Record<string, number> = {},
): WalkResult {
  const samples: { x: number; dose: number }[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const x = lo + ((hi - lo) * i) / steps;
    const v = resolveDose(prescription, evidenceFrom({ ...hold, [key]: x }));
    samples.push({ x, dose: v.resolvedDose });
  }
  let maxJump = 0;
  let monotone = true;
  for (let i = 1; i < samples.length; i += 1) {
    const prev = difficulty(prescription.axis, samples[i - 1]!.dose);
    const cur = difficulty(prescription.axis, samples[i]!.dose);
    maxJump = Math.max(maxJump, Math.abs(cur - prev));
    if (sense === 1 ? cur < prev - 1e-9 : cur > prev + 1e-9) monotone = false;
  }
  return { samples, maxJump, monotone };
}

describe('every earning requirement moves the dose continuously and the right way', () => {
  const cases: readonly { key: string; lo: number; hi: number }[] = [
    { key: 'e1', lo: 0, hi: 4 },
    { key: 'e3', lo: 36, hi: 52 },
  ];
  for (const c of cases) {
    it(`${c.key} · monotone up, never more than one grain per step`, () => {
      const p = rx();
      const w = walk(p, c.key, c.lo, c.hi, 400, 1);
      expect(w.monotone, `${c.key} moved the dose backwards as the evidence improved`).toBe(true);
      expect(w.maxJump).toBeLessThanOrEqual(DOSE_AXIS_SHAPE[p.axis].grain + 1e-9);
      // The walk actually reached both ends, so it is not passing on a flat line.
      expect(w.samples[0]!.dose).toBe(5);
      expect(w.samples[w.samples.length - 1]!.dose).toBe(8);
    });
  }

  it('e2 is an AT_MOST requirement · monotone as the reading FALLS', () => {
    const p = rx();
    const w = walk(p, 'e2', 3, -1, 400, 1);
    expect(w.monotone).toBe(true);
    expect(w.maxJump).toBeLessThanOrEqual(DOSE_AXIS_SHAPE[p.axis].grain + 1e-9);
    expect(w.samples[0]!.dose).toBe(5);
    expect(w.samples[w.samples.length - 1]!.dose).toBe(8);
  });
});

describe('every reduction requirement moves the dose continuously and the right way', () => {
  it('d1 · more sessions falling away late reduces the dose, step by step', () => {
    const p = rx();
    const w = walk(p, 'd1', 0, 3, 400, -1, REDUCTION_PRESSING);
    expect(w.monotone, 'more deterioration produced a HARDER dose').toBe(true);
    expect(w.maxJump).toBeLessThanOrEqual(DOSE_AXIS_SHAPE[p.axis].grain + 1e-9);
    expect(w.samples[0]!.dose).toBe(8);
    expect(w.samples[w.samples.length - 1]!.dose).toBe(3);
  });

  it('d3 · falling absorbed volume reduces the dose, step by step', () => {
    const p = rx();
    const w = walk(p, 'd3', 50, 25, 400, -1, REDUCTION_PRESSING);
    expect(w.monotone).toBe(true);
    expect(w.maxJump).toBeLessThanOrEqual(DOSE_AXIS_SHAPE[p.axis].grain + 1e-9);
    expect(w.samples[w.samples.length - 1]!.dose).toBe(3);
  });

  it('one adverse signal on its own moves nothing · the AND is symmetric', () => {
    const p = rx();
    const only = walk(p, 'd1', 0, 3, 20, -1);
    for (const s of only.samples) expect(s.dose).toBe(8);
  });
});

describe('the branch boundary · the cliff this suite was written to find', () => {
  /**
   * FALSIFIED against the early-return version of `resolveDose`, where this
   * walk jumped 3.5 miles in one increment of a thousandth of a session.
   *
   * The reading swept here is the one that decides whether ANY reduction
   * evidence exists, with every earning requirement fully met. Under the
   * early return, the left half of the walk sat at the earned 8.0 and the
   * right half dropped to 4.5 the instant the reduction fraction left zero.
   */
  it('crossing from no reduction evidence to a hair of it moves at most one grain', () => {
    const p = rx();
    const w = walk(p, 'd1', -0.5, 0.5, 500, -1, REDUCTION_PRESSING);
    expect(w.maxJump).toBeLessThanOrEqual(DOSE_AXIS_SHAPE[p.axis].grain + 1e-9);
    expect(w.monotone).toBe(true);
  });

  it('and the same crossing on the OTHER reduction reading', () => {
    const p = rx();
    // d2 is AT_MOST 2 ramping from 5, so the boundary is at a reading of 5.
    const w = walk(p, 'd2', 5.5, 4.5, 500, -1, REDUCTION_PRESSING);
    expect(w.maxJump).toBeLessThanOrEqual(DOSE_AXIS_SHAPE[p.axis].grain + 1e-9);
    expect(w.monotone).toBe(true);
  });

  it('a hair of missing earning evidence does not move it a categorical step', () => {
    const p = rx();
    const w = walk(p, 'e1', 2.9, 3.1, 400, 1);
    expect(w.maxJump).toBeLessThanOrEqual(DOSE_AXIS_SHAPE[p.axis].grain + 1e-9);
  });
});

describe('the caps do not introduce a cliff of their own', () => {
  it('the step cap binds smoothly as the earned option is raised past it', () => {
    // Sweep the earned dose itself, which is a plan-authoring input rather than
    // a reading: a plan whose author asks for a hair more must not get a
    // categorically different prescription once the cap starts to bite.
    let prev: number | null = null;
    let maxJump = 0;
    for (let earned = 5.0; earned <= 14.0; earned += 0.01) {
      const p = rx({
        earnedDose: { value: Number(earned.toFixed(4)), provenance: 'POLICY_ASSUMPTION', basis: 'f' },
      });
      const v = resolveDose(p, evidenceFrom({}));
      if (prev !== null) maxJump = Math.max(maxJump, Math.abs(v.resolvedDose - prev));
      prev = v.resolvedDose;
    }
    expect(maxJump).toBeLessThanOrEqual(DOSE_AXIS_SHAPE.QUALITY_DOSE_MI.grain + 1e-9);
  });
});

describe('the inverted axis walks the same way', () => {
  it('a recovery jog shortens continuously as the evidence arrives', () => {
    const p = rx({
      axis: 'RECOVERY_JOG_S',
      defaultDose: { value: 120, provenance: 'POLICY_ASSUMPTION', basis: 'f' },
      earnedDose: { value: 60, provenance: 'POLICY_ASSUMPTION', basis: 'f' },
      reducedDose: { value: 180, provenance: 'POLICY_ASSUMPTION', basis: 'f' },
      cap: {
        maxHarder: { value: 60, provenance: 'POLICY_ASSUMPTION', basis: 'f' },
        maxEasier: { value: 60, provenance: 'POLICY_ASSUMPTION', basis: 'f' },
        hardCeiling: null, easyFloor: null,
      },
    });
    const w = walk(p, 'e1', 0, 4, 400, 1);
    expect(w.monotone, 'a shorter jog is harder, so the walk must run that way').toBe(true);
    expect(w.maxJump).toBeLessThanOrEqual(DOSE_AXIS_SHAPE.RECOVERY_JOG_S.grain + 1e-9);
    expect(w.samples[0]!.dose).toBe(120);
    expect(w.samples[w.samples.length - 1]!.dose).toBe(60);
  });
});

describe('a discrete requirement is the only step, and it is argued', () => {
  it('a declared step moves at most one grain, because the cap holds it', () => {
    const p = rx({
      earn: [req({
        requirementId: 'e1', threshold: 3, rampFrom: 3,
        discreteBecause: 'A session either happened or it did not.',
      })],
      reduce: [req({ requirementId: 'd1', comparator: 'AT_MOST', threshold: 0, rampFrom: 2 })],
      earnedDose: { value: 5.5, provenance: 'POLICY_ASSUMPTION', basis: 'f' },
      cap: {
        maxHarder: { value: 0.5, provenance: 'POLICY_ASSUMPTION', basis: 'f' },
        maxEasier: { value: 0.5, provenance: 'POLICY_ASSUMPTION', basis: 'f' },
        hardCeiling: null, easyFloor: null,
      },
    });
    const w = walk(p, 'e1', 2, 4, 200, 1);
    // The declared step is real, and the change it can produce is one grain.
    expect(w.maxJump).toBeLessThanOrEqual(DOSE_AXIS_SHAPE.QUALITY_DOSE_MI.grain + 1e-9);
    expect(w.monotone).toBe(true);
  });
});
