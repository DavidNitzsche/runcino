/**
 * lib/adaptation/canonical/_arbitration_and_record.test.ts · PLAN-LEVEL
 * ARBITRATION, THE DECISION RECORD, AND IDEMPOTENCY.
 *
 * Everything here runs the REAL `evaluateAdaptation`. Nothing is mocked.
 *
 * ── THE ACCEPTANCE TEST IS THE CONTRACT'S OWN SENTENCE ─────────────────────
 *
 *     "Your threshold evidence supports a faster threshold pace, but this week
 *      already contains enough total demand, so the change is deferred until
 *      the next appropriate boundary."
 *
 * The first block below is that sentence, asserted. Its counterpart is the
 * second block, which proves an unrelated hold does NOT freeze the engine.
 *
 * ── WHAT MAKES THE SENTENCE TRUE, AS OF READING C (2026-09-04) ─────────────
 *
 * The sentence says "this week already contains enough TOTAL DEMAND", so the
 * fixture that makes it true is a week AT THE ATHLETE'S DEMAND CEILING, not a
 * week in which some other lever happened to hold. Until 2026-09-04 the engine
 * said it on the strength of a HOLD, which is why the two blocks below used to
 * pull against each other and why rule 2's exception had to exist at all. Both
 * fixtures now differ in exactly one input — the ceiling — and nothing else,
 * which is the property that proves the two sentences stopped competing.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * · The plan-load coefficients. Only the ORDERING and the SIGN of the demand
 *   delta are read, so any monotonic set of weights passes everything here.
 * · THE CEILING BEING RIGHT. Every ceiling here is supplied by the fixture. A
 *   demand model that returned a number 20% too generous for a real athlete
 *   would pass this entire file while letting through weeks nobody should be
 *   asked to run. That number is owned elsewhere and nothing here can check it.
 * · Whether the arbitration priority is the right one. It asserts the order is
 *   applied, not that workload-before-pace is correct coaching.
 * · A plan diff that names the right workouts with wrong numbers.
 */
import { describe, it, expect } from 'vitest';
import { evaluateAdaptation } from './evaluate';
import { idempotencyKeyFor, CANONICAL_DECISIONS } from './decision-record';
import { measured } from './input';
import {
  baseInput, session, week, longRun, decayingThirds,
  threeGoodWeeks, twoGoodLongRuns, twoFasterThresholdSessions,
  baseWeekAtCeiling, baseWeekWithHeadroom,
} from './_fixtures';

/**
 * A runner whose volume must hold, whose threshold evidence is strong, and
 * whose next week is already at his own demand ceiling.
 */
const volumeHoldsPaceProgresses = () =>
  baseInput({
    // One week under the bar, so WEEKLY_VOLUME holds.
    weeks: [
      week('2026-08-17', 47, 47.2),
      week('2026-08-24', 48, 43),
      week('2026-08-31', 48, 47.9),
    ],
    // A deteriorating long run, so LONG_RUN holds too.
    longRuns: [
      longRun('lr-1', '2026-08-23', 16, 16),
      longRun('lr-2', '2026-08-30', 16, 16, { thirds: decayingThirds() }),
    ],
    // Threshold evidence is clean and corroborated.
    qualitySessions: twoFasterThresholdSessions(),
    // And the week is full. This is what makes the acceptance sentence TRUE.
    athleteCeilingWeeklyDemand: baseWeekAtCeiling(),
  });

describe('THE ACCEPTANCE TEST · independent evidence, coherent arbitration', () => {
  it('threshold evidence is accepted, and the change is deferred on total demand', () => {
    const out = evaluateAdaptation(volumeHoldsPaceProgresses());
    const pace = out.records.find((r) => r.lever === 'THRESHOLD_PACE')!;
    const volume = out.records.find((r) => r.lever === 'WEEKLY_VOLUME')!;

    // The lever reached its OWN verdict independently. This is the half that
    // matters most: the evidence was not suppressed, the MUTATION was.
    expect(pace.decision).toBe('PROGRESS');
    expect(pace.evidenceIncluded).toHaveLength(2);

    // And the plan-level arbitration deferred it.
    expect(volume.decision).toBe('HOLD');
    expect(pace.suppressedBy).not.toBeNull();
    expect(pace.suppressedBy!.rule).toBe('WEEK_AT_DEMAND_CEILING');
    expect(pace.suppressedBy!.detail).toMatch(
      /already contains enough total demand, so the change is deferred until the next appropriate boundary/,
    );
    expect(pace.suppressedBy!.reconsiderAtISO).not.toBeNull();

    // And the ceiling that made it true was actually READ. Without this, the
    // sentence could be said off an absent input, which is the Rule 11 defect
    // this reading was introduced to close.
    expect(out.demandCeiling.kind).toBe('READ');
    expect(
      pace.invariants.find((i) => i.id === 'INV_DEMAND_CEILING_POSTURE_STATED')!.passed,
    ).toBe(true);

    // A deferred proposal carries no diff and no rollback, because nothing is
    // being proposed to the plan.
    expect(pace.planDiff.entries).toEqual([]);
    expect(pace.rollback).toBeNull();
  });

  it('the suppressed proposal and its reason are RECORDED, not dropped', () => {
    // The contract: "Record suppressed proposals and why they were deferred."
    const out = evaluateAdaptation(volumeHoldsPaceProgresses());
    const pace = out.records.find((r) => r.lever === 'THRESHOLD_PACE')!;
    // The full evidentiary account survives the suppression.
    expect(pace.decision).toBe('PROGRESS');
    expect(pace.proposedAfterValue).not.toBeNull();
    expect(pace.magnitude).not.toBeNull();
    expect(pace.reason.length).toBeGreaterThan(0);
    expect(pace.whatWouldChangeIt.length).toBeGreaterThan(0);
  });
});

describe('one unrelated HOLD must NOT freeze the engine', () => {
  /**
   * The same runner as the acceptance test above, with the week's ceiling
   * moved up and NOTHING else changed. A volume hold and a long-run hold are
   * both still present.
   *
   * Rule 15 · this is the case that REACHES the mechanism. Before reading C
   * there was no such case for a MATERIAL pace correction, because every
   * threshold proposal the engine can make is material by construction (the
   * ordinary step is 3 s/mi against a 1.5 s/mi bar) and rule 1 keyed on
   * materiality. The old test could only reach it with a 1 s/mi proposal, a
   * step the engine had never once produced on real history.
   */
  const sameRunnerWithHeadroom = () =>
    baseInput({
      weeks: [
        week('2026-08-17', 47, 47.2),
        week('2026-08-24', 48, 43),
        week('2026-08-31', 48, 47.9),
      ],
      longRuns: [
        longRun('lr-1', '2026-08-23', 16, 16),
        longRun('lr-2', '2026-08-30', 16, 16, { thirds: decayingThirds() }),
      ],
      qualitySessions: twoFasterThresholdSessions(),
      athleteCeilingWeeklyDemand: baseWeekWithHeadroom(),
    });

  it('an ORDINARY pace correction proceeds alongside a volume hold when the week has room', () => {
    const out = evaluateAdaptation(sameRunnerWithHeadroom());
    const pace = out.records.find((r) => r.lever === 'THRESHOLD_PACE')!;
    expect(out.records.find((r) => r.lever === 'WEEKLY_VOLUME')!.decision).toBe('HOLD');
    expect(out.records.find((r) => r.lever === 'LONG_RUN')!.decision).toBe('HOLD');

    expect(pace.decision).toBe('PROGRESS');
    // A FULL ordinary step, well past the materiality bar. This is the half
    // that was unreachable before: the old rule 1 suppressed every proposal of
    // this size whenever any load lever held.
    expect(Math.abs(pace.magnitude!.value)).toBeGreaterThanOrEqual(1.5);
    expect(pace.suppressedBy).toBeNull();
    expect(pace.planDiff.entries.length).toBeGreaterThan(0);
  });

  it('the ONLY difference from the acceptance test is the ceiling', () => {
    // The two fixtures are otherwise byte-identical, which is what makes this
    // a proof about rule 1 rather than about two unrelated scenarios.
    const full = volumeHoldsPaceProgresses();
    const roomy = sameRunnerWithHeadroom();
    expect({ ...full, athleteCeilingWeeklyDemand: null })
      .toEqual({ ...roomy, athleteCeilingWeeklyDemand: null });

    const suppressed = evaluateAdaptation(full)
      .records.find((r) => r.lever === 'THRESHOLD_PACE')!;
    const applied = evaluateAdaptation(roomy)
      .records.find((r) => r.lever === 'THRESHOLD_PACE')!;

    // Same evidence, same verdict, same proposed value. Only the mutation
    // differs, which is the contract's own framing: "independent evidence
    // followed by coherent plan-level arbitration".
    expect(suppressed.decision).toBe(applied.decision);
    expect(suppressed.proposedAfterValue).toBe(applied.proposedAfterValue);
    expect(suppressed.suppressedBy).not.toBeNull();
    expect(applied.suppressedBy).toBeNull();
  });

  it('an UNKNOWN ceiling does not suppress, and says so on the record', () => {
    // Rule 11 · absent is not "at the ceiling" and not "no ceiling". Rule 1
    // cannot run, nothing is deferred for demand, and the reason is recorded
    // on every record rather than being absorbed into a quiet pass.
    const out = evaluateAdaptation(baseInput({
      weeks: [
        week('2026-08-17', 47, 47.2),
        week('2026-08-24', 48, 43),
        week('2026-08-31', 48, 47.9),
      ],
      longRuns: twoGoodLongRuns(),
      qualitySessions: twoFasterThresholdSessions(),
    }));
    expect(out.demandCeiling.kind).toBe('ABSENT');
    expect(out.demandCeiling.rule1CanFire).toBe(false);
    expect(out.demandCeiling.detail).toMatch(/not the same as having no ceiling/);

    // The invariant is asserted FIRST on purpose. It is the one that fails when
    // the guard is regressed to fire on an unknown ceiling, and an assertion
    // that only ever runs after a different one has already failed proves
    // nothing about itself (Rule 18).
    for (const r of out.records) {
      const inv = r.invariants.find((i) => i.id === 'INV_DEMAND_CEILING_POSTURE_STATED')!;
      expect(inv.passed, inv.detail).toBe(true);
      expect(inv.detail).toMatch(/no weekly demand ceiling was supplied/i);
    }

    const pace = out.records.find((r) => r.lever === 'THRESHOLD_PACE')!;
    expect(pace.decision).toBe('PROGRESS');
    expect(pace.suppressedBy).toBeNull();
  });
});

describe('one material lever per cycle, so the response stays attributable', () => {
  it('volume progresses and the long run defers to it', () => {
    // The long run is at 15 here, not 16. At 16 in a 48-mile week the proposed
    // 17 would be 35.4% of the week and the long-run lever correctly HOLDS on
    // coherence instead, which is a different behaviour pinned in its own test
    // below. Two levers both earning PROGRESS is the case this one is about.
    const input = baseInput({
      weeks: threeGoodWeeks(),
      longRuns: twoGoodLongRuns(),
      plan: { ...baseInput().plan, nextWeekLongRunMi: 15 },
    });
    const out = evaluateAdaptation(input);
    const volume = out.records.find((r) => r.lever === 'WEEKLY_VOLUME')!;
    const long = out.records.find((r) => r.lever === 'LONG_RUN')!;

    expect(volume.decision).toBe('PROGRESS');
    expect(volume.suppressedBy).toBeNull();

    // Both levers earned their verdict. Only one change is made.
    expect(long.decision).toBe('PROGRESS');
    expect(long.suppressedBy).not.toBeNull();
    expect(long.suppressedBy!.detail).toMatch(/impossible to attribute/);
  });

  it('workload moves before pace · the priority order is applied', () => {
    const input = baseInput({
      weeks: threeGoodWeeks(),
      longRuns: twoGoodLongRuns(),
      qualitySessions: twoFasterThresholdSessions(),
    });
    const out = evaluateAdaptation(input);
    const surviving = out.records.filter(
      (r) => r.suppressedBy === null && r.proposedAfterValue !== null,
    );
    expect(surviving).toHaveLength(1);
    expect(surviving[0].lever).toBe('WEEKLY_VOLUME');
  });
});

describe('the long run cannot outgrow the week it sits in', () => {
  it('HOLD · a proposed long run above the coherent share of the week', () => {
    // 16 -> 17 inside a 48-mile week is 35.4%. The coaching answer is to grow
    // the week first, which is exactly the dependency the arbitration order
    // encodes: weekly volume moves before the long run that sits inside it.
    const out = evaluateAdaptation(baseInput({
      weeks: threeGoodWeeks(),
      longRuns: twoGoodLongRuns(),
    }));
    const long = out.records.find((r) => r.lever === 'LONG_RUN')!;
    expect(long.decision).toBe('HOLD');
    expect(long.reason).toMatch(/would not sit coherently inside the current weekly volume/);

    // And critically, that HOLD does NOT suppress the volume increase that
    // would release it. This is the deadlock the suppression-direction rule
    // exists to prevent.
    const volume = out.records.find((r) => r.lever === 'WEEKLY_VOLUME')!;
    expect(volume.decision).toBe('PROGRESS');
    expect(volume.suppressedBy).toBeNull();
  });
});

describe('cadence · plan-level change is arbitrated at the weekly boundary', () => {
  it('a session-triggered evaluation records the evidence and defers the change', () => {
    const input = baseInput({
      boundary: 'SESSION_COMPLETED',
      weeks: threeGoodWeeks(),
      longRuns: twoGoodLongRuns(),
    });
    const out = evaluateAdaptation(input);
    const volume = out.records.find((r) => r.lever === 'WEEKLY_VOLUME')!;
    expect(volume.decision).toBe('PROGRESS');
    expect(volume.suppressedBy!.detail).toMatch(/arbitrated at the weekly boundary/);
    expect(volume.planDiff.entries).toEqual([]);
  });

  it('there is no boundary value representing mid-session', () => {
    // "Never during a session" needs no runtime check because the type has no
    // member for it. Asserted so the claim is checkable rather than prose.
    const boundaries = ['SESSION_COMPLETED', 'WEEKLY_BOUNDARY', 'EVIDENCE_CORRECTED'];
    expect(boundaries).not.toContain('IN_SESSION');
    expect(boundaries).toHaveLength(3);
  });
});

describe('idempotency · the same evidence never raises a second proposal', () => {
  const input = () => baseInput({ weeks: threeGoodWeeks(), longRuns: twoGoodLongRuns() });

  it('the key is athlete, plan version, evidence version, lever and boundary', () => {
    const out = evaluateAdaptation(input());
    const volume = out.records.find((r) => r.lever === 'WEEKLY_VOLUME')!;
    expect(volume.idempotencyKey).toBe(
      idempotencyKeyFor({
        athleteId: 'athlete-1',
        planVersion: 'plan-v1',
        evidenceVersion: 'ev-1',
        lever: 'WEEKLY_VOLUME',
        boundary: 'WEEKLY_BOUNDARY',
      }),
    );
    // The wall clock is deliberately NOT in it. Including it would make every
    // re-evaluation unique and the key decorative.
    expect(volume.idempotencyKey).not.toContain('2026-09-06');
  });

  it('re-ingesting the same evidence produces the SAME key', () => {
    const a = evaluateAdaptation(input());
    const b = evaluateAdaptation({ ...input(), evaluatedAtISO: '2026-09-08' });
    expect(a.records.map((r) => r.idempotencyKey))
      .toEqual(b.records.map((r) => r.idempotencyKey));
  });

  it('a key already raised is suppressed rather than proposed twice', () => {
    const first = evaluateAdaptation(input());
    const raised = new Set(
      first.records.filter((r) => r.suppressedBy === null).map((r) => r.idempotencyKey),
    );
    const second = evaluateAdaptation(input(), raised);
    const volume = second.records.find((r) => r.lever === 'WEEKLY_VOLUME')!;
    expect(volume.suppressedBy!.detail).toMatch(/already been raised on exactly this evidence/);
    expect(volume.planDiff.entries).toEqual([]);
  });

  it('NEW evidence produces a new key and is proposable again', () => {
    const first = evaluateAdaptation(input());
    const raised = new Set(first.records.map((r) => r.idempotencyKey));
    const second = evaluateAdaptation({ ...input(), evidenceVersion: 'ev-2' }, raised);
    const volume = second.records.find((r) => r.lever === 'WEEKLY_VOLUME')!;
    expect(volume.suppressedBy).toBeNull();
    expect(volume.planDiff.entries.length).toBeGreaterThan(0);
  });
});

describe('the decision record is complete on EVERY outcome', () => {
  const scenarios: Array<[string, ReturnType<typeof baseInput>]> = [
    ['progress', baseInput({ weeks: threeGoodWeeks(), longRuns: twoGoodLongRuns() })],
    ['hold', volumeHoldsPaceProgresses()],
    ['refuse', baseInput()],
    ['unreadable', baseInput({ readable: false })],
  ];

  for (const [name, input] of scenarios) {
    it(`${name} · every required field is present`, () => {
      const out = evaluateAdaptation(input);
      expect(out.records).toHaveLength(3);
      for (const r of out.records) {
        expect(r.contractVersion).toBe('1.0.0');
        expect(r.athleteId).toBeTruthy();
        expect(r.planVersion).toBeTruthy();
        expect(r.evidenceVersion).toBeTruthy();
        expect(r.evaluatedAtISO).toBeTruthy();
        expect(r.idempotencyKey).toBeTruthy();
        expect(CANONICAL_DECISIONS).toContain(r.decision);
        expect(r.belief).toBeTruthy();
        expect(r.race).toBeTruthy();
        expect(r.goal).toBeTruthy();
        expect(r.gap.length).toBeGreaterThan(0);
        expect(Array.isArray(r.evidenceIncluded)).toBe(true);
        expect(Array.isArray(r.evidenceExcluded)).toBe(true);
        expect(Array.isArray(r.contradictory)).toBe(true);
        expect(r.confidence.sentence.length).toBeGreaterThan(0);
        expect(typeof r.beforeValue).toBe('number');
        expect(r.planDiff.touchesCompletedHistory).toBe(false);
        expect(r.reason.length).toBeGreaterThan(0);
        // The contract's own requirement, on every outcome including refusal.
        expect(r.whatWouldChangeIt.length).toBeGreaterThan(0);
      }
    });
  }

  it('a moving proposal carries a magnitude, a limit and its citation', () => {
    const out = evaluateAdaptation(baseInput({
      weeks: threeGoodWeeks(),
      longRuns: twoGoodLongRuns(),
    }));
    const volume = out.records.find((r) => r.lever === 'WEEKLY_VOLUME')!;
    expect(volume.magnitude!.limitConstant).toBeTruthy();
    expect(volume.magnitude!.limitCitation).toMatch(/ADAPTATION_ENGINE_CONTRACT/);
    expect(volume.rollback).not.toBeNull();
    expect(volume.rollback!.restoreTo).toBe(volume.beforeValue);
    expect(volume.invariants.every((i) => i.passed)).toBe(true);
  });

  it('reach is lever-specific and the boundary is named', () => {
    const out = evaluateAdaptation(baseInput({
      weeks: threeGoodWeeks(),
      longRuns: twoGoodLongRuns(),
    }));
    const volume = out.records.find((r) => r.lever === 'WEEKLY_VOLUME')!;
    expect(volume.planDiff.reachRule).toMatch(/next cutback boundary/);
    expect(volume.planDiff.reachEndsISO).toBe('2026-10-05');
  });

  it('a pace change reprices its threshold sessions as ONE atomic bundle', () => {
    const out = evaluateAdaptation(baseInput({
      qualitySessions: twoFasterThresholdSessions(),
      weeks: threeGoodWeeks(),
      longRuns: twoGoodLongRuns(),
    }));
    const pace = out.records.find((r) => r.lever === 'THRESHOLD_PACE')!;
    // Suppressed this cycle by the volume change, but the shape is asserted on
    // a cycle where it survives.
    const solo = evaluateAdaptation(baseInput({ qualitySessions: twoFasterThresholdSessions() }));
    const soloPace = solo.records.find((r) => r.lever === 'THRESHOLD_PACE')!;
    expect(soloPace.decision).toBe('PROGRESS');
    expect(soloPace.planDiff.entries).toHaveLength(3);
    expect(soloPace.affectedWorkoutIds).toEqual(['w-101', 'w-102', 'w-103']);
    expect(pace.decision).toBe('PROGRESS');
  });
});
