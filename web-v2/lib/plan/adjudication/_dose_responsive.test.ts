/**
 * lib/plan/adjudication/_dose_responsive.test.ts · the gate on the dose gate.
 *
 * ── RULE 22 · WHAT THIS SUITE CANNOT FAIL ON ───────────────────────────────
 *
 * 1 · IT CANNOT FAIL ON THE DOSES BEING WRONG. Every fixture below invents its
 *     own numbers and then checks the arithmetic against them, which is Rule
 *     18's warning verbatim: a test that hardcodes both sides only proves it
 *     agrees with itself. The doctrine numbers are checked in
 *     `_malibu_dose_trace.test.ts`, which parses the cited `Research/` rows at
 *     run time instead of restating them.
 *
 * 2 · IT CANNOT FAIL ON A REQUIREMENT BEING ANSWERED BY THE WRONG READER. The
 *     registry check below proves the named symbol still EXISTS. Nothing here
 *     proves a requirement about marathon-pace execution is answered with
 *     marathon-pace execution rather than with a count of easy runs.
 *
 * 3 · IT CANNOT FAIL ON A THRESHOLD BEING UNREACHABLE IN PRACTICE. Rule 21's
 *     bar is "compute what the runner would have had to do, then check whether
 *     any week he has actually run would have". That check needs real history
 *     and lives in the trace suite. Here a threshold set above anything any
 *     human has run reads as a legal gate.
 *
 * 4 · THE SYMMETRY AUDIT IS ONE-SIDED, and so is its coverage here. Cases below
 *     exercise "up is harder than down" in all three of its forms and NONE
 *     exercises the reverse, because `auditSymmetry` deliberately does not fire
 *     on it. That is Rule 22's own measurement pointed at this file: if the
 *     repository's 29-to-2 hold-versus-accelerate imbalance ever inverts, this
 *     is the suite that will still be looking the wrong way.
 *
 * ── FALSIFICATION · Rule 18 point 1 ────────────────────────────────────────
 *
 * Every assertion here was run against a deliberately broken module before it
 * was trusted, in both directions where the check has two. The recorded
 * failures are in the handback for this change. The cases marked FALSIFIED
 * below are the ones whose inverse was confirmed red.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  DOSE_AXES, DOSE_AXIS_SHAPE, DOSE_EVIDENCE_READERS,
  assertPrescription, auditSymmetry, credibleTraceShare, deterioratedSessions,
  doseEarningGate, executedAtTier, fromNormalReading, harder, resolveDose,
  reading, satisfactionOf, sessionsThatCount, validatePrescription,
  type DoseEvidence, type DoseRequirement, type DoseResponsivePrescription,
  type ReaderId,
} from '@/lib/plan/adjudication/dose-responsive';
import type { Measured } from '@/lib/adaptation/canonical/input';
import type { StimulusGrade } from '@/lib/adaptation/canonical/stimulus';
import type { DeteriorationPattern } from '@/lib/adaptation/canonical/deterioration';

// The canonical engine's own set, restated ONLY as a test fixture. The module
// under test takes it as a parameter and never names these grades itself.
const COUNTS_AS_EVIDENCE: ReadonlySet<StimulusGrade> = new Set<StimulusGrade>(['FULL', 'SUBSTANTIAL']);
const measured = reading.of;
const absent = reading.absent;
const failed = reading.failed;

/* ── a clean, deliberately unremarkable prescription ───────────────────────
 *
 * Quality dose, 5 to 8 miles, three conditions each way, a bigger step up than
 * down. Every defect case below is this object with one field changed, so a
 * failure names the field rather than the fixture.
 */
function req(over: Partial<DoseRequirement> = {}): DoseRequirement {
  return {
    requirementId: 'r1',
    what: 'two of the three blocks land',
    measurable: 'count of sessions graded FULL or SUBSTANTIAL',
    reader: 'STIMULUS_GRADE',
    comparator: 'AT_LEAST',
    threshold: 3,
    rampFrom: 1,
    discreteBecause: null,
    byISO: '2026-11-16',
    ...over,
  };
}

function rx(over: Partial<DoseResponsivePrescription> = {}): DoseResponsivePrescription {
  return {
    prescriptionId: 'test-mp-dose',
    what: 'The marathon-pace block',
    landsOnISO: '2026-11-22',
    axis: 'QUALITY_DOSE_MI',
    target: 'SPECIFICITY',
    defaultDose: { value: 5, provenance: 'CALCULATED_PHYSIOLOGY', basis: 'fixture' },
    earnedDose: { value: 8, provenance: 'CALCULATED_PHYSIOLOGY', basis: 'fixture' },
    reducedDose: { value: 3, provenance: 'CALCULATED_PHYSIOLOGY', basis: 'fixture' },
    earn: [
      req({ requirementId: 'e1' }),
      req({ requirementId: 'e2', reader: 'DETERIORATION_PATTERN', comparator: 'AT_MOST', threshold: 0, rampFrom: 2 }),
      req({ requirementId: 'e3', reader: 'HABIT_WEEKLY_MI', threshold: 48, rampFrom: 40 }),
    ],
    reduce: [
      req({ requirementId: 'd1', reader: 'DETERIORATION_PATTERN', threshold: 2, rampFrom: 0 }),
      req({ requirementId: 'd2', reader: 'EXECUTION_IDENTITY', comparator: 'AT_MOST', threshold: 2, rampFrom: 5 }),
      req({ requirementId: 'd3', reader: 'ABSORBED_WEEKLY_MI', comparator: 'AT_MOST', threshold: 30, rampFrom: 45 }),
    ],
    assessOnISO: '2026-11-16',
    assessOnIsPrescribedNonNormal: false,
    onIncompleteEvidence: 'HOLD_DEFAULT',
    cap: {
      maxHarder: { value: 3, provenance: 'POLICY_ASSUMPTION', basis: 'fixture' },
      maxEasier: { value: 2, provenance: 'POLICY_ASSUMPTION', basis: 'fixture' },
      hardCeiling: { value: 8, provenance: 'CALCULATED_PHYSIOLOGY', basis: 'fixture' },
      easyFloor: { value: 2, provenance: 'CALCULATED_PHYSIOLOGY', basis: 'fixture' },
    },
    citations: [{ source: 'Research/04', section: '4.5', says: 'fixture', force: 'GUIDELINE' }],
    asymmetryJustified: {},
    assessInsideWindowJustified: null,
    ...over,
  };
}

const ev = (pairs: Record<string, Measured<number>>): DoseEvidence => ({
  assessedOnISO: '2026-11-16',
  readings: new Map(Object.entries(pairs)),
});

/** Every earning requirement met in full, no reduction signal readable. */
const FULLY_EARNED = ev({
  e1: measured(3), e2: measured(0), e3: measured(52),
  d1: measured(0), d2: measured(6), d3: measured(50),
});

describe('the reader registry is live and resolves · Rule 16 and Rule 18 point 2', () => {
  it('names at least one reader and every id in the union', () => {
    expect(DOSE_EVIDENCE_READERS.length).toBeGreaterThan(0);
    const ids = new Set(DOSE_EVIDENCE_READERS.map((r) => r.readerId));
    const declared: ReaderId[] = [
      'STIMULUS_GRADE', 'DETERIORATION_PATTERN', 'HR_TRACE_CREDIBILITY',
      'WORK_HR_CEILING', 'EXECUTION_IDENTITY', 'HABIT_WEEKLY_MI',
      'ABSORBED_WEEKLY_MI', 'PRESCRIBED_NON_NORMAL_DAY', 'RECOVERY_PHASE',
      'MISSED_TRAINING',
    ];
    for (const d of declared) expect(ids.has(d)).toBe(true);
    expect(ids.size).toBe(declared.length);
  });

  /**
   * FALSIFIED. Renaming `gradeStimulus` in the registry to `gradeStimulusX`
   * turns this red and names the symbol, which is the whole point: a
   * requirement pointing at a reader that no longer exists is a requirement
   * nobody can answer, and it would otherwise sit there looking correct.
   */
  it('every named reader module exists and still exports the named symbol', () => {
    let read = 0;
    for (const r of DOSE_EVIDENCE_READERS) {
      const p = path.join(process.cwd(), r.module);
      expect(fs.existsSync(p), `${r.readerId}: ${r.module} does not exist`).toBe(true);
      const src = fs.readFileSync(p, 'utf8');
      read += 1;
      const exported = new RegExp(
        `export\\s+(?:async\\s+)?(?:function|const|type|interface|class)\\s+${r.symbol}\\b`,
      ).test(src);
      expect(exported, `${r.readerId}: ${r.module} no longer exports ${r.symbol}`).toBe(true);
    }
    // Liveness. A scanner that read nothing and reported clean is the worst
    // outcome available, because it also reports confidence.
    expect(read).toBe(DOSE_EVIDENCE_READERS.length);
    expect(read).toBeGreaterThanOrEqual(10);
  });

  it('each reader declares which side of Rule 8 it sits on', () => {
    const habit = DOSE_EVIDENCE_READERS.filter((r) => r.rule8Side === 'HABIT');
    const absorbed = DOSE_EVIDENCE_READERS.filter((r) => r.rule8Side === 'ABSORBED_LOAD');
    // Both sides of the corollary are represented, so the split is a real
    // choice at each call site rather than a label nobody ever picks.
    expect(habit.length).toBeGreaterThan(0);
    expect(absorbed.length).toBeGreaterThan(0);
  });
});

describe('the axes', () => {
  it('every axis has a shape and a positive grain', () => {
    for (const a of DOSE_AXES) {
      const s = DOSE_AXIS_SHAPE[a];
      expect(s.unit.length).toBeGreaterThan(0);
      expect(s.grain).toBeGreaterThan(0);
    }
  });

  it('harder respects the inverted axis · a shorter recovery jog is harder', () => {
    expect(harder('QUALITY_DOSE_MI', 8, 5)).toBe(true);
    expect(harder('QUALITY_DOSE_MI', 5, 8)).toBe(false);
    expect(harder('RECOVERY_JOG_S', 60, 90)).toBe(true);
    expect(harder('RECOVERY_JOG_S', 90, 60)).toBe(false);
  });

  it('resizes distance, repetitions and quality dose, not only pace', () => {
    expect(DOSE_AXES).toContain('SESSION_DISTANCE_MI');
    expect(DOSE_AXES).toContain('REPETITIONS');
    expect(DOSE_AXES).toContain('QUALITY_DOSE_MI');
    // Pace is another owner's question and must not appear here.
    expect(DOSE_AXES.some((a) => String(a).includes('PACE'))).toBe(false);
  });
});

describe('Rule 11 · a value, an absence and a failure are three facts', () => {
  it('an absent reading holds the DEFAULT and says so as a posture', () => {
    const v = resolveDose(rx(), ev({
      e1: measured(3), e2: absent('no gradeable session'), e3: measured(52),
      d1: measured(0), d2: measured(6), d3: measured(50),
    }));
    expect(v.posture).toBe('DEFAULT_HELD_ON_INCOMPLETE_EVIDENCE');
    expect(v.resolvedDose).toBe(5);
    expect(v.decision).toBe('HOLD');
    expect(v.earnedFraction).toBeNull();
    expect(v.say).toContain('no data');
  });

  it('a FAILED read is reported as a failed read, not as an absence', () => {
    const v = resolveDose(rx(), ev({
      e1: failed('the heart-rate trace did not parse'), e2: measured(0), e3: measured(52),
      d1: measured(0), d2: measured(6), d3: measured(50),
    }));
    const r = v.earnReadings.find((x) => x.requirementId === 'e1');
    expect(r?.state).toBe('FAILED');
    expect(v.resolvedDose).toBe(5);
  });

  it('a reading nobody supplied is NOT_SUPPLIED and still holds the default', () => {
    const v = resolveDose(rx(), ev({ e2: measured(0), e3: measured(52) }));
    const r = v.earnReadings.find((x) => x.requirementId === 'e1');
    expect(r?.state).toBe('NOT_SUPPLIED');
    expect(v.resolvedDose).toBe(5);
  });

  /**
   * FALSIFIED, and this is the case the rule exists for. Coercing a measured
   * zero to an absence in `satisfactionOf` makes this pass at the DEFAULT
   * instead of the reduced dose, which is the `recentQualityPerWeek` defect
   * pointed the other way: the safest reading of the data producing the least
   * responsive plan.
   */
  it('a measured zero is a real answer and produces satisfaction zero', () => {
    const r = req({ comparator: 'AT_LEAST', threshold: 3, rampFrom: 1 });
    expect(satisfactionOf(r, measured(0))).toBe(0);
    expect(satisfactionOf(r, measured(1))).toBe(0);
    expect(satisfactionOf(r, measured(2))).toBe(0.5);
    expect(satisfactionOf(r, measured(3))).toBe(1);
    expect(satisfactionOf(r, absent('x'))).toBeNull();
  });

  it('an absent reading never destroys the default either', () => {
    // Every reduction signal unreadable. The dose must not fall.
    const v = resolveDose(rx(), ev({
      e1: measured(3), e2: measured(0), e3: measured(52),
      d1: absent('nothing judgeable'),
      d2: absent('no prescriptions'),
      d3: absent('no representative weeks'),
    }));
    expect(v.reduceFraction).toBeNull();
    expect(v.resolvedDose).toBeGreaterThan(5);
  });
});

describe('the earning path · the default is to advance', () => {
  it('full evidence takes the dose to the earned option', () => {
    const v = resolveDose(rx(), FULLY_EARNED);
    expect(v.decision).toBe('PROGRESS');
    expect(v.posture).toBe('EARNED_IN_FULL');
    expect(v.resolvedDose).toBe(8);
    expect(v.changed).toBe(true);
  });

  it('partial evidence buys part of the step, not none of it', () => {
    // e1 at 2 of 3 → 0.5; e2 at 0 → 1; e3 at 44 of 48 from 40 → 0.5. min 0.5.
    const v = resolveDose(rx(), ev({
      e1: measured(2), e2: measured(0), e3: measured(44),
      d1: measured(0), d2: measured(6), d3: measured(50),
    }));
    expect(v.earnedFraction).toBeCloseTo(0.5, 10);
    expect(v.resolvedDose).toBe(6.5);
    expect(v.posture).toBe('EARNED_IN_PART');
  });

  it('the weakest requirement governs · one stressor at a time', () => {
    const v = resolveDose(rx(), ev({
      e1: measured(3), e2: measured(2), e3: measured(52),
      d1: measured(0), d2: measured(6), d3: measured(50),
    }));
    // e2 is AT_MOST 0 ramping from 2, so a reading of 2 is satisfaction 0.
    expect(v.earnedFraction).toBe(0);
    expect(v.resolvedDose).toBe(5);
    expect(v.decision).toBe('HOLD');
    expect(v.posture).toBe('NOT_EARNED_DEFAULT_HELD');
  });
});

describe('the reduction path fires only on MEASURED evidence', () => {
  it('measured non-absorption reduces the dose', () => {
    const v = resolveDose(rx(), ev({
      e1: measured(1), e2: measured(2), e3: measured(40),
      d1: measured(2), d2: measured(2), d3: measured(30),
    }));
    expect(v.decision).toBe('REDUCE');
    expect(v.posture).toBe('REDUCED_ON_MEASURED_EVIDENCE');
    expect(v.resolvedDose).toBe(3);
  });

  it('partial reduction evidence moves part way, continuously', () => {
    // d1 2 of 2 from 0 → 1; d2 at 3.5 of 2 from 5 → 0.5; d3 at 37.5 → 0.5.
    const v = resolveDose(rx(), ev({
      e1: measured(1), e2: measured(2), e3: measured(40),
      d1: measured(2), d2: measured(3.5), d3: measured(37.5),
    }));
    expect(v.reduceFraction).toBeCloseTo(0.5, 10);
    expect(v.resolvedDose).toBe(4);
  });

  it('safety is considered before the earning path', () => {
    // Both sets fully satisfied. The reduction wins, per Brief 11.
    const v = resolveDose(rx(), ev({
      e1: measured(3), e2: measured(0), e3: measured(52),
      d1: measured(2), d2: measured(2), d3: measured(30),
    }));
    expect(v.decision).toBe('REDUCE');
  });
});

describe('the cap · part six of the shape', () => {
  it('a step bigger than the cap is pulled back and the bound is named', () => {
    const v = resolveDose(
      rx({ earnedDose: { value: 12, provenance: 'POLICY_ASSUMPTION', basis: 'fixture' } }),
      FULLY_EARNED,
    );
    expect(v.resolvedDose).toBe(8);
    expect(v.cappedBy).toContain('maximum permitted step toward harder');
  });

  it('the doctrine ceiling binds under the step cap', () => {
    const v = resolveDose(
      rx({
        earnedDose: { value: 12, provenance: 'POLICY_ASSUMPTION', basis: 'fixture' },
        cap: {
          maxHarder: { value: 10, provenance: 'POLICY_ASSUMPTION', basis: 'fixture' },
          maxEasier: { value: 2, provenance: 'POLICY_ASSUMPTION', basis: 'fixture' },
          hardCeiling: { value: 6, provenance: 'CALCULATED_PHYSIOLOGY', basis: 'the taper band' },
          easyFloor: null,
        },
        asymmetryJustified: { SMALLER_STEP_TO_GO_UP: 'not applicable in this fixture' },
      }),
      FULLY_EARNED,
    );
    expect(v.resolvedDose).toBe(6);
    expect(v.cappedBy).toContain('doctrine ceiling');
  });

  it('rounds toward easier, so the grain never manufactures load', () => {
    // 5 + 0.6 * 3 = 6.8, and the grain is 0.5, so it lands at 6.5 not 7.0.
    const v = resolveDose(rx(), ev({
      e1: measured(2.2), e2: measured(0), e3: measured(52),
      d1: measured(0), d2: measured(6), d3: measured(50),
    }));
    expect(v.earnedFraction).toBeCloseTo(0.6, 10);
    expect(v.resolvedDose).toBe(6.5);
  });

  it('rounds toward easier on the inverted axis too', () => {
    const rec = rx({
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
    // Half earned: 120 - 30 = 90, which is on the grain already.
    const half = resolveDose(rec, ev({
      e1: measured(2), e2: measured(0), e3: measured(44),
      d1: measured(0), d2: measured(6), d3: measured(50),
    }));
    expect(half.resolvedDose).toBe(90);
    expect(half.decision).toBe('PROGRESS');
  });
});

describe('validation · a malformed gate fails loudly', () => {
  it('a well-formed prescription has no defects', () => {
    expect(validatePrescription(rx())).toEqual([]);
    expect(() => assertPrescription(rx())).not.toThrow();
  });

  /** FALSIFIED both ways: the clean case above is green, this one is named. */
  it('an earned dose that is not harder than the default is the inert gate', () => {
    const d = validatePrescription(rx({
      earnedDose: { value: 5, provenance: 'POLICY_ASSUMPTION', basis: 'f' },
    }));
    expect(d.map((x) => x.field)).toContain('earnedDose');
    expect(d.find((x) => x.field === 'earnedDose')?.detail).toContain('cannot move anything');
  });

  it('a reduced dose that is not easier than the default is named', () => {
    const d = validatePrescription(rx({
      reducedDose: { value: 6, provenance: 'POLICY_ASSUMPTION', basis: 'f' },
    }));
    expect(d.map((x) => x.field)).toContain('reducedDose');
  });

  it('a reassessment on or after the day it lands is named', () => {
    const d = validatePrescription(rx({ assessOnISO: '2026-11-22' }));
    expect(d.map((x) => x.field)).toContain('assessOnISO');
  });

  it('a step with no argument is named · Rule 9', () => {
    const d = validatePrescription(rx({
      earn: [req({ requirementId: 'e1', threshold: 3, rampFrom: 3 })],
      reduce: [req({ requirementId: 'd1', comparator: 'AT_MOST', threshold: 0, rampFrom: 2 })],
    }));
    expect(d.some((x) => x.detail.includes('rampFrom equals threshold'))).toBe(true);
  });

  it('a step WITH an argument is allowed', () => {
    const d = validatePrescription(rx({
      earn: [req({
        requirementId: 'e1', threshold: 3, rampFrom: 3,
        discreteBecause: 'A session either happened or it did not. There is no half session to '
          + 'ramp through, and inventing one would be a made-up number.',
      })],
      reduce: [req({ requirementId: 'd1', comparator: 'AT_MOST', threshold: 0, rampFrom: 2 })],
    }));
    expect(d.some((x) => x.detail.includes('rampFrom equals threshold'))).toBe(false);
  });

  it('a ramp running backwards is named', () => {
    const d = validatePrescription(rx({
      earn: [req({ requirementId: 'e1', comparator: 'AT_LEAST', threshold: 3, rampFrom: 5 })],
      reduce: [req({ requirementId: 'd1', comparator: 'AT_MOST', threshold: 0, rampFrom: 2 })],
    }));
    expect(d.some((x) => x.detail.includes('satisfied side of threshold'))).toBe(true);
  });

  it('a requirement due after the reassessment is named', () => {
    const d = validatePrescription(rx({
      earn: [req({ requirementId: 'e1', byISO: '2026-11-20' })],
      reduce: [req({ requirementId: 'd1', comparator: 'AT_MOST', threshold: 0, rampFrom: 2 })],
    }));
    expect(d.some((x) => x.detail.includes('could never be read in time'))).toBe(true);
  });

  it('no reduction requirements at all is named', () => {
    const d = validatePrescription(rx({ reduce: [] }));
    expect(d.map((x) => x.field)).toContain('reduce');
  });
});

describe('Rule 21 · the bar to go up beside the bar to come down', () => {
  it('the clean fixture is symmetric and reports nothing', () => {
    expect(auditSymmetry(rx())).toEqual([]);
  });

  it('more conditions to go up than to come down is a finding', () => {
    const f = auditSymmetry(rx({ reduce: [req({ requirementId: 'd1', comparator: 'AT_MOST', threshold: 0, rampFrom: 2 })] }));
    expect(f.map((x) => x.kind)).toContain('MORE_CONDITIONS_TO_GO_UP');
  });

  it('a smaller permitted step up than down is a finding', () => {
    const f = auditSymmetry(rx({
      cap: {
        maxHarder: { value: 1, provenance: 'POLICY_ASSUMPTION', basis: 'f' },
        maxEasier: { value: 2, provenance: 'POLICY_ASSUMPTION', basis: 'f' },
        hardCeiling: null, easyFloor: null,
      },
    }));
    expect(f.map((x) => x.kind)).toContain('SMALLER_STEP_TO_GO_UP');
  });

  it('less time to complete the upward path is a finding', () => {
    const f = auditSymmetry(rx({
      earn: [req({ requirementId: 'e1', byISO: '2026-11-16' })],
      reduce: [req({ requirementId: 'd1', comparator: 'AT_MOST', threshold: 0, rampFrom: 2, byISO: '2026-11-10' })],
    }));
    expect(f.map((x) => x.kind)).toContain('SLOWER_TO_GO_UP');
  });

  /**
   * FALSIFIED. This is the assertion that makes the audit binding rather than
   * advisory: an unjustified asymmetry blocks the prescription, and supplying
   * the justification is what lets it through. Deleting the `asymmetryJustified`
   * loop from `validatePrescription` turns the first half green and the second
   * half stays green, which is why both halves are here.
   */
  it('an unjustified asymmetry blocks, and a justified one does not', () => {
    const skewed = {
      cap: {
        maxHarder: { value: 1, provenance: 'POLICY_ASSUMPTION' as const, basis: 'f' },
        maxEasier: { value: 2, provenance: 'POLICY_ASSUMPTION' as const, basis: 'f' },
        hardCeiling: null, easyFloor: null,
      },
    };
    const blocked = validatePrescription(rx(skewed));
    expect(blocked.map((x) => x.field)).toContain('asymmetryJustified');
    expect(() => assertPrescription(rx(skewed))).toThrow(/SMALLER_STEP_TO_GO_UP/);

    const justified = validatePrescription(rx({
      ...skewed,
      asymmetryJustified: {
        SMALLER_STEP_TO_GO_UP: 'Research/08 §9.1 puts this session inside the marathon taper, '
          + 'where doctrine licenses reduction and forbids a categorical increase in dose.',
      },
    }));
    expect(justified).toEqual([]);
  });
});

describe('the gate extends the one in contract.ts', () => {
  it('derives requires from earn so the two lists cannot drift', () => {
    const g = doseEarningGate(rx());
    expect(g.requires.length).toBe(3);
    expect(g.requires.map((r) => r.what)).toEqual(rx().earn.map((r) => r.what));
    expect(g.forDecisionId).toBe('test-mp-dose');
    // The higher dose is what is conditional, so unmet it comes back to the
    // default rather than the session being dropped.
    expect(g.ifUnmet).toBe('REDUCE');
    expect(g.reduceTo).toBe(5);
  });

  it('the explain sentence names both doses and the date', () => {
    const g = doseEarningGate(rx());
    expect(g.explain).toContain('5 mi');
    expect(g.explain).toContain('8 mi');
    expect(g.explain).toContain('2026-11-16');
  });
});

describe('part seven · a sentence in every branch', () => {
  it('says something when it changes and when it does not', () => {
    const changed = resolveDose(rx(), FULLY_EARNED);
    const held = resolveDose(rx(), ev({}));
    const cut = resolveDose(rx(), ev({
      e1: measured(1), e2: measured(2), e3: measured(40),
      d1: measured(2), d2: measured(2), d3: measured(30),
    }));
    for (const v of [changed, held, cut]) {
      expect(v.say.length).toBeGreaterThan(20);
      expect(v.say).not.toMatch(/[A-Za-z]!/);
      expect(v.say).not.toContain('—');
    }
    expect(held.say).toContain('stays at');
    expect(changed.say).toContain('moves from');
  });
});

describe('the adapters return an absence, never a zero', () => {
  const graded = (n: number): { grade: StimulusGrade }[] =>
    Array.from({ length: n }, () => ({ grade: 'FULL' as StimulusGrade }));

  it('an empty window of sessions is absent, and a window of failures is zero', () => {
    expect(sessionsThatCount([], COUNTS_AS_EVIDENCE).ok).toBe(false);
    const allShort: { grade: StimulusGrade }[] = [{ grade: 'PARTIAL' }];
    const z = sessionsThatCount(allShort, COUNTS_AS_EVIDENCE);
    expect(z.ok).toBe(true);
    if (z.ok) expect(z.value).toBe(0);
    const three = sessionsThatCount(graded(3), COUNTS_AS_EVIDENCE);
    expect(three.ok).toBe(true);
    if (three.ok) expect(three.value).toBe(3);
  });

  it('an unjudgeable deterioration window is absent, not clean', () => {
    const noneJudged: DeteriorationPattern = {
      repeated: false, deterioratedCount: 0, unknownCount: 4, cleanCount: 0, detail: 'f',
    };
    expect(deterioratedSessions(noneJudged).ok).toBe(false);
    const judged: DeteriorationPattern = {
      repeated: false, deterioratedCount: 0, unknownCount: 1, cleanCount: 3, detail: 'f',
    };
    const r = deterioratedSessions(judged);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(0);
  });

  it('no heart-rate traces is absent, and an unreadable one is a share of zero', () => {
    expect(credibleTraceShare([]).ok).toBe(false);
    const r = credibleTraceShare([{ credible: false, why: 'one value carried forward' }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(0);
  });

  it('execution counts only tiers at least as strong as the one asked for', () => {
    const days = [
      { matchedRun: { match: 'exact' as const } },
      { matchedRun: { match: 'legacy_type' as const } },
      { matchedRun: { match: 'supplemental' as const } },
      { matchedRun: null },
    ];
    const exact = executedAtTier(days, 'exact');
    const legacy = executedAtTier(days, 'legacy_type');
    if (exact.ok) expect(exact.value).toBe(1);
    if (legacy.ok) expect(legacy.value).toBe(2);
    expect(executedAtTier([], 'exact').ok).toBe(false);
  });

  it('a normal-window refusal becomes an absence carrying its own sentence', () => {
    const r = fromNormalReading({
      ok: false,
      refusal: {
        code: 'not-enough-representative-training',
        message: 'Not enough ordinary training weeks to answer this honestly.',
        windowFromISO: '2026-08-01', windowToISO: '2026-09-04', needDays: 7,
      },
      representativeDays: 3, excludedDays: 21,
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.why.kind === 'ABSENT') {
      expect(r.why.what).toContain('ordinary training weeks');
    }
  });
});
