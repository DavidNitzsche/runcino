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

  it('returns null (not zero) fields when everything is filtered out — Rule 11', () => {
    const windows = prescribedWindowsFrom([HALF_A]);
    const rows = [missed('2026-08-05'), missed('2026-08-12')];
    const out = filterExecutionEvidenceByPrescribedWindow(rows, [], windows);
    expect(out.keySessionExecutions).toBeNull();
    expect(out.keySessionsPlanned).toBeNull();
    expect(out.keySessionsCompleted).toBeNull();
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
    recoveryPctOfExpected: null, readinessBelowNormalDays: null, readinessWindowDays: null,
    weeklyPlannedMi: null, weeklyActualMi: null, trainingForm: null,
    distinctEvidenceWeeks: null, adapterDowngrades: null,
    niggleSeverity: null, illnessActive: null, injuryActive: null,
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

  it('a fully-masked window refuses to null evidence rather than fabricating a poor score', () => {
    const windows = prescribedWindowsFrom([HALF_A]);
    const raw = [missed('2026-08-05'), missed('2026-08-12'), missed('2026-08-19'), missed('2026-08-24')];
    const filteredFields = filterExecutionEvidenceByPrescribedWindow(raw, [], windows);
    const filtered = classifyAdaptation({ ...BLANK, ...filteredFields });
    expect(filtered.dimensions.find((d) => d.dimension === 'execution')!.score).toBeNull();
  });
});

/** The shape of the split's exported type, so a future rename is caught here
 *  rather than discovered at the report-writing stage. */
describe('AdaptationAbsorptionSplit shape', () => {
  const EMPTY: AdaptationInput = {
    keySessionExecutions: null, keySessionsPlanned: null, keySessionsCompleted: null,
    targetVerdicts: null, repConsistency: null, rpeReported: null, rpeHarderThanExpected: null,
    decouplingVerdicts: null, lateDriftBpm: null, easyDiscipline: null,
    recoveryPctOfExpected: null, readinessBelowNormalDays: null, readinessWindowDays: null,
    weeklyPlannedMi: null, weeklyActualMi: null, trainingForm: null,
    distinctEvidenceWeeks: null, adapterDowngrades: null,
    niggleSeverity: null, illnessActive: null, injuryActive: null,
  };

  it('carries both named outputs', () => {
    const shape: AdaptationAbsorptionSplit = {
      actual_load_absorption: classifyAdaptation(EMPTY),
      representative_execution: classifyAdaptation(EMPTY),
    };
    expect(Object.keys(shape).sort()).toEqual(['actual_load_absorption', 'representative_execution']);
  });
});
