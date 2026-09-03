/**
 * ABSORPTION-SPLIT-1 (2026-09-01) · PRODUCT_DECISIONS.md §1 / CLAUDE.md Rule 8.
 *
 * `classifyAdaptation`'s execution dimension used to answer two questions
 * under one name off one unfiltered 42-day window: "how much load has this
 * runner absorbed" (Rule 8's corollary — leave literal) and "has this runner
 * demonstrated capability / earned progression" (Rule 8 proper — a taper is
 * never this runner's normal). `filterExecutionEvidenceByPrescribedWindow` in
 * `load.ts` is the one place that now applies the second reading; these tests
 * hold it directly, PURE and DB-free (Rule 18), the same posture
 * `_progression_pass.test.ts` takes with `resolveWeekProgression`: real
 * `classifyAdaptation`, not hand-picked verdicts.
 *
 * See docs/reports/absorption-reader-split-2026-09-01.md for the full
 * shadow-run against the one real account this database holds, and the
 * Rule 9 continuity walk across two real taper/recovery boundaries.
 */
import { describe, it, expect } from 'vitest';
import {
  filterExecutionEvidenceByPrescribedWindow,
  type AdaptationAbsorptionSplit,
} from './load';
import { classifyAdaptation, type AdaptationInput } from './adaptation-model';
import { prescribedWindowsFrom, type RanRace } from '@/lib/training/normal-window';

const HALF_A: RanRace = { slug: 'fixture-half', dateISO: '2026-08-16', distanceMi: 13.1, priority: 'A' };

function planned(dateISO: string) {
  return { dateISO, readable: true, read: { state: 'AS_PLANNED' as const, stimulusCompletion: 1 }, earnsProgression: true };
}
function missed(dateISO: string) {
  return { dateISO, readable: true, read: { state: 'MISSED' as const, stimulusCompletion: 0 }, earnsProgression: false };
}
function unreadable(dateISO: string) {
  return { dateISO, readable: false, read: null, earnsProgression: false };
}

describe('filterExecutionEvidenceByPrescribedWindow', () => {
  it('drops sessions landing inside a prescribed window and keeps everything outside', () => {
    const windows = prescribedWindowsFrom([HALF_A]); // excludes 2026-08-02..2026-08-30
    const rows = [
      planned('2026-07-21'), // outside · kept
      missed('2026-08-05'),  // inside taper · dropped
      missed('2026-08-22'),  // inside recovery · dropped
      planned('2026-07-28'), // outside · kept
    ];
    const out = filterExecutionEvidenceByPrescribedWindow(rows, [], windows);
    expect(out.keySessionExecutions).toHaveLength(2);
    expect(out.keySessionExecutions!.every((e) => e.state === 'AS_PLANNED')).toBe(true);
    expect(out.keySessionsPlanned).toBe(2);
    expect(out.keySessionsCompleted).toBe(2);
  });

  it('drops unreadable sessions the same way the unfiltered reader does, independent of the window', () => {
    const rows = [planned('2026-01-01'), unreadable('2026-01-02')];
    const out = filterExecutionEvidenceByPrescribedWindow(rows, [], []);
    expect(out.keySessionExecutions).toHaveLength(1);
  });

  it('is a true no-op with no prescribed windows at all', () => {
    const rows = [planned('2026-01-01'), missed('2026-01-08'), planned('2026-01-15')];
    const out = filterExecutionEvidenceByPrescribedWindow(rows, [], []);
    expect(out.keySessionExecutions).toHaveLength(3);
    expect(out.keySessionsPlanned).toBe(3);
    expect(out.keySessionsCompleted).toBe(2);
  });

  it('returns null (not zero) fields when everything filtered out is UNREADABLE — Rule 11 still applies to true absence', () => {
    // Rule 11's refusal is for a runner we genuinely cannot see — an
    // unreadable session, not a readable one that happened to fail on a
    // prescribed day. This is the case Rule 11 was written for: nothing
    // survives, and nothing was measured either.
    const windows = prescribedWindowsFrom([HALF_A]);
    const rows = [unreadable('2026-08-05'), unreadable('2026-08-12')];
    const out = filterExecutionEvidenceByPrescribedWindow(rows, [], windows);
    expect(out.keySessionExecutions).toBeNull();
    expect(out.keySessionsPlanned).toBeNull();
    expect(out.keySessionsCompleted).toBeNull();
  });

  it('MASKING-1: a fully-masked window whose only evidence is real failures keeps that evidence, never nulls it', () => {
    // The corrected contract: dropping a day from PROVING normal capability
    // (Rule 8) is not the same operation as excusing a genuine failure from
    // counting against progression. When the window-exclusion would erase
    // EVERY readable row, negative-valence rows (MISSED / PARTIAL_FAILED)
    // survive the exclusion rather than vanishing with it — see the incident
    // note above `filterExecutionEvidenceByPrescribedWindow` in load.ts.
    const windows = prescribedWindowsFrom([HALF_A]);
    const rows = [missed('2026-08-05'), missed('2026-08-12')];
    const out = filterExecutionEvidenceByPrescribedWindow(rows, [], windows);
    expect(out.keySessionExecutions).toHaveLength(2);
    expect(out.keySessionExecutions!.every((e) => e.state === 'MISSED')).toBe(true);
    expect(out.keySessionsPlanned).toBe(2);
    expect(out.keySessionsCompleted).toBe(0);
  });

  it('filters target verdicts by the same predicate and dedups by date, same as the unfiltered reader', () => {
    const windows = prescribedWindowsFrom([HALF_A]);
    const verdictRows = [
      { dateISO: '2026-07-21', verdict: 'on' as const },
      { dateISO: '2026-08-05', verdict: 'slow' as const }, // inside window · dropped
      { dateISO: '2026-07-21', verdict: 'fast' as const }, // dup date · dropped
    ];
    const out = filterExecutionEvidenceByPrescribedWindow([], verdictRows, windows);
    expect(out.targetVerdicts).toEqual(['on']);
  });

  it('MASKING-1 applies to target verdicts too: a fully-masked window of real "slow" misses keeps them', () => {
    const windows = prescribedWindowsFrom([HALF_A]);
    const verdictRows = [
      { dateISO: '2026-08-05', verdict: 'slow' as const }, // inside window, genuinely missed the target
      { dateISO: '2026-08-12', verdict: 'slow' as const },
    ];
    const out = filterExecutionEvidenceByPrescribedWindow([], verdictRows, windows);
    expect(out.targetVerdicts).toEqual(['slow', 'slow']);
  });

  it('MASKING-1 does not preserve "on"/"fast" inside a fully-masked window — only genuine shortfalls survive', () => {
    // A target hit (or an over-pace) during a prescribed day is exactly the
    // kind of evidence Rule 8 says must not be credited toward "normal"
    // capability — MASKING-1 only ever rescues NEGATIVE evidence from
    // erasure, never positive evidence.
    const windows = prescribedWindowsFrom([HALF_A]);
    const verdictRows = [
      { dateISO: '2026-08-05', verdict: 'on' as const },
      { dateISO: '2026-08-12', verdict: 'fast' as const },
    ];
    const out = filterExecutionEvidenceByPrescribedWindow([], verdictRows, windows);
    expect(out.targetVerdicts).toBeNull();
  });
});

/**
 * The classifier-level proof, through the REAL `classifyAdaptation` — mirrors
 * `_progression_pass.test.ts`'s own discipline of driving the real classifier
 * rather than asserting against a hand-built verdict.
 */
describe('the split through classifyAdaptation (real classifier, hand-built evidence)', () => {
  const BLANK: AdaptationInput = {
    keySessionExecutions: null, keySessionsPlanned: null, keySessionsCompleted: null,
    targetVerdicts: null, repConsistency: null, rpeReported: null, rpeHarderThanExpected: null,
    decouplingVerdicts: null, lateDriftBpm: null, easyDiscipline: null,
    recoveryPctOfExpected: null,
    weeklyPlannedMi: null, weeklyActualMi: null, trainingForm: null,
    distinctEvidenceWeeks: null, adapterDowngrades: null,
  };

  it('a taper that masks real clean execution reads STRONGER filtered than unfiltered', () => {
    const windows = prescribedWindowsFrom([HALF_A]);
    const raw = [
      planned('2026-07-07'), planned('2026-07-12'), planned('2026-07-16'),
      planned('2026-07-21'), planned('2026-07-28'),
      missed('2026-08-05'), missed('2026-08-12'), missed('2026-08-22'),
    ];
    const unfiltered = classifyAdaptation({
      ...BLANK,
      keySessionExecutions: raw.filter((r) => r.readable).map((r) => ({
        state: r.read!.state, stimulusCompletion: r.read!.stimulusCompletion, earnsProgression: r.earnsProgression,
      })),
    });
    const filteredFields = filterExecutionEvidenceByPrescribedWindow(raw, [], windows);
    const filtered = classifyAdaptation({ ...BLANK, ...filteredFields });

    const execUnfiltered = unfiltered.dimensions.find((d) => d.dimension === 'execution')!.score!;
    const execFiltered = filtered.dimensions.find((d) => d.dimension === 'execution')!.score!;
    expect(execFiltered).toBeGreaterThan(execUnfiltered);
  });

  it('genuine detraining with no race nearby is read IDENTICALLY by both — the corollary control case', () => {
    const raw = [
      planned('2026-07-07'), planned('2026-07-12'), planned('2026-07-16'),
      planned('2026-07-21'), planned('2026-07-28'),
      missed('2026-08-05'), missed('2026-08-12'), missed('2026-08-22'),
    ];
    const unfiltered = classifyAdaptation({
      ...BLANK,
      keySessionExecutions: raw.map((r) => ({
        state: r.read!.state, stimulusCompletion: r.read!.stimulusCompletion, earnsProgression: r.earnsProgression,
      })),
    });
    const filteredFields = filterExecutionEvidenceByPrescribedWindow(raw, [], []); // no race, no windows
    const filtered = classifyAdaptation({ ...BLANK, ...filteredFields });

    expect(filtered.band).toBe(unfiltered.band);
    expect(filtered.dimensions.find((d) => d.dimension === 'execution')!.score)
      .toBe(unfiltered.dimensions.find((d) => d.dimension === 'execution')!.score);
  });

  it('MASKING-1 falsifier: a fully-masked window of real failures must not flip the decision toward MORE permission', () => {
    // Every session in the window is a genuine MISS, and every one of them
    // falls inside the prescribed window. Before the MASKING-1 fix,
    // `filterExecutionEvidenceByPrescribedWindow` erased all four rows,
    // `readExecution` scored null, `classifyAdaptation` fell through its
    // MIN_DIMENSIONS_FOR_VERDICT refusal (Rule 11's "not enough evidence,
    // proceed as planned"), and the filtered verdict came out
    // normal/PROGRESS — MORE permissive than the unfiltered poor/MODIFY it
    // was supposed to be a stricter, more honest read of. That is the exact
    // "total-evidence-masking" risk named in
    // docs/reports/absorption-dual-log-2026-09-01.md §7.2 and never fixed
    // there. This assertion is the falsifier: it fails against the
    // pre-MASKING-1 code and passes after the fix.
    //
    // BLANK alone is too thin to isolate the mechanism: with only `execution`
    // ever populated, `classifyAdaptation`'s general
    // `MIN_DIMENSIONS_FOR_VERDICT` floor (>=2 known dimensions before it will
    // render a real verdict) fires identically for both readers regardless of
    // the fix, masking the very thing being tested. In production, exactly
    // one field carries a second dimension through UNCHANGED from the
    // unfiltered base — `loadRepresentativeExecutionInput` only overrides
    // `keySessionExecutions`/`keySessionsPlanned`/`keySessionsCompleted`/
    // `targetVerdicts`; `internal_cost`/`recovery`/`consistency`/`trend` are
    // always identical between the two readers. `trainingForm` (consistency)
    // stands in for that here — the same value on both sides, exactly as
    // `{ ...base, ...filtered }` produces in the real loader.
    const windows = prescribedWindowsFrom([HALF_A]);
    const raw = [missed('2026-08-05'), missed('2026-08-12'), missed('2026-08-19'), missed('2026-08-24')];
    const unfiltered = classifyAdaptation({
      ...BLANK,
      trainingForm: 'BUILDING',
      keySessionExecutions: raw.map((r) => ({
        state: r.read!.state, stimulusCompletion: r.read!.stimulusCompletion, earnsProgression: r.earnsProgression,
      })),
    });
    const filteredFields = filterExecutionEvidenceByPrescribedWindow(raw, [], windows);
    const filtered = classifyAdaptation({ ...BLANK, trainingForm: 'BUILDING', ...filteredFields });

    // The real fix: a real failure is not erased by the calendar it fell on.
    expect(filtered.dimensions.find((d) => d.dimension === 'execution')!.score).not.toBeNull();
    expect(filteredFields.keySessionExecutions).not.toBeNull();
    // The decisive assertion: filtering must never be MORE permissive than
    // the unfiltered read when what it excluded was entirely negative
    // evidence. Here they must land on the identical verdict, since nothing
    // outside the window existed to differentiate them.
    expect(filtered.decision).toBe(unfiltered.decision);
    expect(filtered.band).toBe(unfiltered.band);
    expect(unfiltered.decision).not.toBe('PROGRESS'); // sanity: the scenario is a real shortfall
    expect(filtered.decision).not.toBe('PROGRESS');
  });

  it('MASKING-1 corollary: a window with real OUTSIDE evidence still excludes the in-window days (3a is unaffected)', () => {
    // Falsifies the fix in the other direction: MASKING-1 must fire ONLY on
    // total washout. When representative evidence survives outside the
    // window, the taper-day exclusion must behave exactly as before — this
    // is what lets a genuinely good runner's taper/recovery misses stop
    // dragging down a block that was, outside the window, clean.
    const windows = prescribedWindowsFrom([HALF_A]);
    const raw = [
      planned('2026-07-07'), planned('2026-07-12'), planned('2026-07-16'),
      planned('2026-07-21'), planned('2026-07-28'),
      missed('2026-08-05'), missed('2026-08-12'), missed('2026-08-22'),
    ];
    const filteredFields = filterExecutionEvidenceByPrescribedWindow(raw, [], windows);
    // Only the 5 outside-window AS_PLANNED sessions survive — the 3 missed
    // in-window sessions stay excluded, because washout never occurred.
    expect(filteredFields.keySessionExecutions).toHaveLength(5);
    expect(filteredFields.keySessionExecutions!.every((e) => e.state === 'AS_PLANNED')).toBe(true);
  });
});

/** The shape of the split's exported type, so a future rename is caught here
 *  rather than discovered at the report-writing stage. */
describe('AdaptationAbsorptionSplit shape', () => {
  const EMPTY: AdaptationInput = {
    keySessionExecutions: null, keySessionsPlanned: null, keySessionsCompleted: null,
    targetVerdicts: null, repConsistency: null, rpeReported: null, rpeHarderThanExpected: null,
    decouplingVerdicts: null, lateDriftBpm: null, easyDiscipline: null,
    recoveryPctOfExpected: null,
    weeklyPlannedMi: null, weeklyActualMi: null, trainingForm: null,
    distinctEvidenceWeeks: null, adapterDowngrades: null,
  };

  it('carries both named outputs', () => {
    const shape: AdaptationAbsorptionSplit = {
      actual_load_absorption: classifyAdaptation(EMPTY),
      representative_execution: classifyAdaptation(EMPTY),
    };
    expect(Object.keys(shape).sort()).toEqual(['actual_load_absorption', 'representative_execution']);
  });
});
