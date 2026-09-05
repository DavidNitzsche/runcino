/**
 * ARBREACH-2 (2026-09-04) · READING C, THE PROPERTIES THAT MAKE IT SOUND.
 *
 * ARBREACH-1 pinned the defect: rule 1 suppressed on the SIZE OF THE PROPOSAL
 * while its own sentence is about THE WEEK, and rule 2's exception therefore
 * had a live window of [1, 1.5) s/mi against an engine whose ordinary step is
 * 3. Measured on the owner's whole history: fourteen threshold proposals, all
 * of them the ordinary step, exception fired ZERO times.
 *
 * The owner's ruling closed it (`docs/reports/core-closure-2026-09-04/
 * ARBITRATION-CHOICE.md`, reading C):
 *
 *     "Rule 1 should evaluate whether the complete week is at its
 *      athlete-specific demand ceiling; rule 3 should independently evaluate
 *      whether the proposed lever change is material."
 *
 * This file asserts the four properties that reading makes true, each of which
 * was FALSE before it:
 *
 *   1 · Rule 1 responds to THE WEEK, not to any lever's HOLD.
 *   2 · Rule 3 is independent, and still caps material changes per cycle.
 *   3 · The ceiling is a monotone boundary, not a Rule 9 cliff, and what sits
 *       either side of it is APPLY versus DEFER-AND-QUEUE, never APPLY versus
 *       LOSE.
 *   4 · The legacy reading is reachable from exactly one file.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 * · THE CEILING BEING THE RIGHT NUMBER. Every ceiling here is manufactured by
 *   the fixture. This file proves the engine responds correctly to a ceiling;
 *   it says nothing at all about whether a real athlete's ceiling is where a
 *   demand model would put it, and no test in this directory can.
 * · WHETHER DEFERRING IS THE RIGHT COACHING CALL on a full week. It proves the
 *   sentence is only said when the week is full, not that saying it is wise.
 * · The plan-load coefficients, for the same reason every other file here
 *   cannot: only ordering and sign are read.
 * · Whether anything ever CALLS the deferral queue in production. Property 3
 *   proves a suppressed record is queueABLE. Nothing here proves a live caller
 *   exists, and none does yet.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { evaluateAdaptation } from './evaluate';
import { arbitrate, type ArbitrationReading } from './arbitration';
import { demandCeilingForWeek } from './plan-load';
import { enqueueDeferrals } from './deferral-queue';
import { failed, type Measured } from './input';
import type { AthleteWeeklyDemandCeiling } from './demand-ceiling';
import {
  baseInput, week, longRun, decayingThirds, twoGoodLongRuns,
  twoFasterThresholdSessions, threeGoodWeeks, baseWeekWithHeadroom,
  ceilingOf, ceilingAt,
} from './_fixtures';

/**
 * One runner, held on both load levers, with strong threshold evidence. The
 * only thing any test below varies is the ceiling.
 */
const heldOnLoadWithPaceEvidence = (ceiling: Measured<AthleteWeeklyDemandCeiling>) =>
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
    athleteCeilingWeeklyDemand: ceiling,
  });

/** The base fixture's own next week, priced. 48 mi, 16-mile long, 60 quality. */
const BASE_WEEK = { weeklyMi: 48, longRunMi: 16, qualityMinutes: 60 } as const;
const BASE_WEEK_INDEX = demandCeilingForWeek(BASE_WEEK);
/** That week AS A CEILING, through the demand model's own resolver. */
const baseWeekAtItsCeiling = () => ceilingOf(BASE_WEEK);

describe('property 1 · rule 1 responds to the WEEK, not to a HOLD', () => {
  it('a load HOLD alone suppresses nothing when the week has room', () => {
    const out = evaluateAdaptation(heldOnLoadWithPaceEvidence(baseWeekWithHeadroom()));
    expect(out.records.find((r) => r.lever === 'WEEKLY_VOLUME')!.decision).toBe('HOLD');
    expect(out.records.find((r) => r.lever === 'LONG_RUN')!.decision).toBe('HOLD');
    const pace = out.records.find((r) => r.lever === 'THRESHOLD_PACE')!;
    expect(pace.decision).toBe('PROGRESS');
    expect(pace.suppressedBy).toBeNull();
  });

  it('a full week suppresses even with NO load lever holding', () => {
    // The mirror. Three completed weeks and two good long runs, so both load
    // levers have real verdicts rather than holds, and the week is still full.
    // Under the old rule this could not happen at all: with no HOLD there was
    // nothing to suppress with.
    const out = evaluateAdaptation(baseInput({
      weeks: threeGoodWeeks(),
      longRuns: twoGoodLongRuns(),
      qualitySessions: twoFasterThresholdSessions(),
      athleteCeilingWeeklyDemand: baseWeekAtItsCeiling(),
    }));
    const volume = out.records.find((r) => r.lever === 'WEEKLY_VOLUME')!;
    expect(volume.decision).toBe('PROGRESS');
    expect(volume.suppressedBy).not.toBeNull();
    expect(volume.suppressedBy!.rule).toBe('WEEK_AT_DEMAND_CEILING');
  });

  it('a proposal that LOWERS demand is never deferred for demand', () => {
    // A ceiling far below the week. Nothing may grow. A REGRESS still may.
    const out = evaluateAdaptation(baseInput({
      weeks: [
        week('2026-08-17', 47, 30),
        week('2026-08-24', 48, 29),
        week('2026-08-31', 48, 28),
      ],
      longRuns: twoGoodLongRuns(),
      athleteCeilingWeeklyDemand: ceilingAt(1),
    }));
    for (const r of out.records) {
      if (r.decision !== 'REGRESS') continue;
      expect(r.suppressedBy).toBeNull();
    }
  });

  it('a FAILED ceiling read is louder than an absent one, and still cannot suppress', () => {
    // Rule 11's third fact. The engine must not treat a broken read as "no
    // ceiling", and it must not treat it as "at the ceiling" either.
    const out = evaluateAdaptation(
      heldOnLoadWithPaceEvidence(failed<AthleteWeeklyDemandCeiling>('the demand model timed out')),
    );
    expect(out.demandCeiling.kind).toBe('FAILED');
    expect(out.demandCeiling.rule1CanFire).toBe(false);
    expect(out.demandCeiling.detail).toMatch(/failed/i);
    expect(out.demandCeiling.detail).toMatch(/the demand model timed out/);
    expect(out.records.find((r) => r.lever === 'THRESHOLD_PACE')!.suppressedBy).toBeNull();
  });
});

describe('property 2 · rule 3 is independent and still caps material changes', () => {
  it('two material proposals on a roomy week · one applies, one defers for ATTRIBUTABILITY', () => {
    const out = evaluateAdaptation(baseInput({
      weeks: threeGoodWeeks(),
      longRuns: twoGoodLongRuns(),
      plan: { ...baseInput().plan, nextWeekLongRunMi: 15 },
      athleteCeilingWeeklyDemand: baseWeekWithHeadroom(),
    }));
    const volume = out.records.find((r) => r.lever === 'WEEKLY_VOLUME')!;
    const long = out.records.find((r) => r.lever === 'LONG_RUN')!;
    expect(volume.suppressedBy).toBeNull();
    expect(long.decision).toBe('PROGRESS');
    expect(long.suppressedBy!.rule).toBe('ONE_MATERIAL_LEVER_PER_CYCLE');
    // And the two rules are told apart on the record, not by reading prose.
    expect(long.suppressedBy!.rule).not.toBe('WEEK_AT_DEMAND_CEILING');
  });

  it('rule 3 does not consume its slot on a proposal rule 1 already deferred', () => {
    // A full week defers the volume increase. If rule 1 had spent the material
    // slot on it, the long run below would defer for the wrong reason and the
    // record would name a rule that did not apply.
    const out = evaluateAdaptation(baseInput({
      weeks: threeGoodWeeks(),
      longRuns: twoGoodLongRuns(),
      plan: { ...baseInput().plan, nextWeekLongRunMi: 15 },
      athleteCeilingWeeklyDemand: baseWeekAtItsCeiling(),
    }));
    for (const r of out.records) {
      if (r.suppressedBy === null) continue;
      expect(r.suppressedBy.rule).toBe('WEEK_AT_DEMAND_CEILING');
    }
  });
});

describe('property 3 · Rule 9 · the ceiling is a monotone boundary, not a cliff', () => {
  /**
   * The walk `_restore_continuity.test.ts` and `_coach_sensible.test.ts`
   * established for this codebase: move the input across the boundary in small
   * increments and assert the output vector behaves.
   */
  const paceSuppressedAtCeiling = (ceiling: number): boolean => {
    const out = evaluateAdaptation(heldOnLoadWithPaceEvidence(ceilingAt(ceiling)));
    return out.records.find((r) => r.lever === 'THRESHOLD_PACE')!.suppressedBy !== null;
  };

  it('the walk crosses exactly once, and never comes back', () => {
    const readings: boolean[] = [];
    // 0.05 index units per step is roughly a twentieth of a mile of equivalent
    // easy running, well below anything a lever can propose.
    for (let c = BASE_WEEK_INDEX - 1; c <= BASE_WEEK_INDEX + 1.0001; c += 0.05) {
      readings.push(paceSuppressedAtCeiling(Math.round(c * 1000) / 1000));
    }
    expect(readings.length).toBeGreaterThan(20);
    // Suppressed at the tight end, applied at the generous end.
    expect(readings[0]).toBe(true);
    expect(readings[readings.length - 1]).toBe(false);
    // Monotone: once it flips to applied it stays applied. A non-monotone walk
    // is the Rule 9 signature ("the fitter runner gets the worse plan").
    const flips = readings.filter((v, i) => i > 0 && v !== readings[i - 1]).length;
    expect(flips).toBe(1);
  });

  it('a week exactly AT its ceiling is at it, not over it', () => {
    // Rule 9's representation tolerance, asserted rather than trusted. The
    // ceiling is priced from the SAME week the plan context describes, so a
    // bare `>` on two independently rounded reals is a coin toss.
    const out = evaluateAdaptation(baseInput({
      weeks: threeGoodWeeks(),
      longRuns: twoGoodLongRuns(),
      athleteCeilingWeeklyDemand: baseWeekAtItsCeiling(),
    }));
    // The base week itself is admissible. What is refused is GROWING past it.
    const volume = out.records.find((r) => r.lever === 'WEEKLY_VOLUME')!;
    expect(volume.suppressedBy!.rule).toBe('WEEK_AT_DEMAND_CEILING');
    // And a ceiling one step of demand higher lets it through, so the boundary
    // really is where the arithmetic says and not a rounding artefact.
    const roomier = evaluateAdaptation(baseInput({
      weeks: threeGoodWeeks(),
      longRuns: twoGoodLongRuns(),
      athleteCeilingWeeklyDemand: ceilingAt(BASE_WEEK_INDEX + 5),
    }));
    expect(roomier.records.find((r) => r.lever === 'WEEKLY_VOLUME')!.suppressedBy).toBeNull();
  });

  it('what sits on the deferred side is APPLY versus DEFER-AND-QUEUE, never APPLY versus LOSE', () => {
    // This is the sentence that makes the boundary admissible under Rule 9. A
    // proposal that lands a hair over the ceiling must survive as a queued
    // item, so a hair of input buys a week of delay rather than a lost
    // progression.
    const out = evaluateAdaptation(heldOnLoadWithPaceEvidence(baseWeekAtItsCeiling()));
    const pace = out.records.find((r) => r.lever === 'THRESHOLD_PACE')!;
    expect(pace.suppressedBy!.rule).toBe('WEEK_AT_DEMAND_CEILING');

    const queue = enqueueDeferrals([], out.records);
    expect(queue).toHaveLength(1);
    expect(queue[0].lever).toBe('THRESHOLD_PACE');
    expect(queue[0].proposedAfterValue).toBe(pace.proposedAfterValue);
    expect(queue[0].reason).toBe('WEEK_AT_DEMAND_CEILING');
    expect(queue[0].nextBoundaryISO).toBe(pace.suppressedBy!.reconsiderAtISO);
    expect(queue[0].evidence.length).toBeGreaterThan(0);
  });
});

describe('property 4 · the legacy reading is reachable from exactly one file', () => {
  const WEB = path.resolve(__dirname, '..', '..', '..');
  const LEGACY = 'LEGACY_HOLD_PRESENCE';

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('._') || name === 'node_modules' || name === '.next') continue;
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
    }
    return out;
  }

  const SCANNED = [...walk(path.join(WEB, 'lib')), ...walk(path.join(WEB, 'app'))];

  /**
   * The counterfactual harness, and this file. `arbitration.ts` DEFINES the
   * union, which is not a call site. Anything else naming it is a second live
   * engine growing quietly, which is exactly what
   * `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` forbids.
   *
   * A ratchet: this list may shrink, never grow.
   */
  const ALLOWED = new Set([
    path.join(WEB, 'lib/adaptation/canonical/arbitration.ts'),
    path.join(WEB, 'lib/adaptation/canonical/_counterfactual.script.ts'),
    path.join(WEB, 'lib/adaptation/canonical/_arbitration_reading_c.test.ts'),
  ]);

  it('liveness · the scanner read a real tree', () => {
    expect(SCANNED.length).toBeGreaterThan(200);
    expect(SCANNED).toContain(path.join(WEB, 'lib/adaptation/canonical/arbitration.ts'));
    expect(SCANNED).toContain(path.join(WEB, 'lib/adaptation/canonical/_counterfactual.script.ts'));
  });

  it('no file outside the allowlist names the legacy reading', () => {
    const offenders = SCANNED.filter(
      (f) => !ALLOWED.has(f) && readFileSync(f, 'utf8').includes(LEGACY),
    );
    expect(offenders.map((f) => path.relative(WEB, f))).toEqual([]);
  });

  it('ORACLE · the detector fires on a planted caller', () => {
    // Rule 18 · a scan that has never matched proves nothing.
    const planted = `arbitrate({ reading: '${LEGACY}' })`;
    expect(planted.includes(LEGACY)).toBe(true);
    expect('arbitrate({ reading: \'WEEK_DEMAND_CEILING\' })'.includes(LEGACY)).toBe(false);
  });

  it('ORACLE · the legacy reading really does behave the OLD way', () => {
    // Falsification in the other direction: if `LEGACY_HOLD_PRESENCE` had
    // silently become an alias for reading C, the counterfactual would report
    // "nothing changed" and be worthless. So it is exercised directly on the
    // one case the two readings must disagree about: a load HOLD, a material
    // pace proposal, and a week with plenty of room.
    const input = heldOnLoadWithPaceEvidence(baseWeekWithHeadroom());
    const verdicts = evaluateAdaptation(input).records.map((r) => ({
      lever: r.lever, decision: r.decision, beforeValue: r.beforeValue,
      proposedAfterValue: r.proposedAfterValue, magnitude: r.magnitude,
      included: r.evidenceIncluded, excluded: r.evidenceExcluded,
      contradictory: r.contradictory, windowDays: r.windowDays,
      confidence: r.confidence, reason: r.reason,
      whatWouldChangeIt: r.whatWouldChangeIt,
    }));
    const shared = {
      verdicts,
      baseWeekStartISO: input.plan.nextWeekStartISO,
      baseWeeklyMi: input.plan.nextWeekPrescribedMi,
      baseLongRunMi: input.plan.nextWeekLongRunMi,
      baseQualityMinutes: input.plan.nextWeekQualityMinutes,
      athleteCeilingWeeklyDemand: input.athleteCeilingWeeklyDemand,
      nextBoundaryISO: '2026-10-05',
    };
    const paceOf = (reading: ArbitrationReading) =>
      arbitrate({ ...shared, reading })
        .arbitrated.find((a) => a.verdict.lever === 'THRESHOLD_PACE')!;

    expect(paceOf('WEEK_DEMAND_CEILING').suppressedBy).toBeNull();
    expect(paceOf('LEGACY_HOLD_PRESENCE').suppressedBy).not.toBeNull();
  });
});
