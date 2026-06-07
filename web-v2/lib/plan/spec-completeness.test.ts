/**
 * lib/plan/spec-completeness.test.ts · Audit D / D1 falsifiers
 *
 * Proves the long-run HM/M finish segment now survives the full
 * label → spec → watch-execution chain that D1 found broken (label
 * promised "LONG · 7mi @ HM", spec was a flat easy long, watch ran
 * one flat phase under a 144 HR ceiling that fought the finish).
 *
 * Two layers, both pure (no DB):
 *   1. buildWorkoutSpec — derives finish_mi/finish_pace/finish_label
 *      from the prescription. HM finish = T+5, M finish = T+18.
 *   2. expandSpecToPhases — splits a finish spec into easy-build +
 *      finish phases (was one flat phase).
 *
 * Falsifier specs (David, 2026-06-07):
 *   Jul 19 (wk6, weekT 407): 17mi → 10mi easy @ 480 + 7mi @ HM 412
 *   Jun 28 (wk3, weekT 416): 14mi → 10mi easy @ 480 + 4mi @ M  434
 *
 * Cite: Research/22 §3 (HM Advanced "16 mi LR w/ last 8 mi @ HMP").
 */

import { describe, it, expect } from 'vitest';
import { buildWorkoutSpec } from './spec-builder';
import { expandSpecToPhases, subLabelFromSpec } from '../training/expand-spec';

// Active-plan long-run easy band is anchored to goalT (407): lo 462, hi 497,
// mid 480. The 6 UPDATEs add finish fields onto THIS band (easy stays 480);
// the finish pace uses the week's ramped quality-T.
const EASY_BAND = { pace_target_s_per_mi_lo: 462, pace_target_s_per_mi_hi: 497, hr_cap_bpm: 144, fuel_mi: [5, 9, 13] };

describe('D1 · buildWorkoutSpec long-finish derivation', () => {
  it('HM finish: "LONG · 7mi @ HM" at weekT 407 → finish_mi 7, pace 412 (T+5), label HM', () => {
    const { spec } = buildWorkoutSpec('long', 17, 407, 162, 'LONG · 7mi @ HM', 181);
    expect(spec).toMatchObject({ kind: 'long', finish_mi: 7, finish_pace_s_per_mi: 412, finish_label: 'HM' });
  });

  it('M finish wk3: "LONG · 4mi @ M" at weekT 416 → finish_mi 4, pace 434 (T+18), label M', () => {
    const { spec } = buildWorkoutSpec('long', 14, 416, 162, 'LONG · 4mi @ M', 181);
    expect(spec).toMatchObject({ finish_mi: 4, finish_pace_s_per_mi: 434, finish_label: 'M' });
  });

  it('M finish wk4: "LONG · 5mi @ M" at weekT 412 → finish_mi 5, pace 430 (T+18)', () => {
    const { spec } = buildWorkoutSpec('long', 16, 412, 162, 'LONG · 5mi @ M', 181);
    expect(spec).toMatchObject({ finish_mi: 5, finish_pace_s_per_mi: 430, finish_label: 'M' });
  });

  it('plain LONG: no finish fields (backward-compatible flat long)', () => {
    const { spec } = buildWorkoutSpec('long', 12, 407, 162, 'LONG', 181);
    const s = spec as Record<string, unknown>;
    expect(s.finish_mi).toBeUndefined();
    expect(s.finish_pace_s_per_mi).toBeUndefined();
    expect(s.kind).toBe('long');
  });

  it('accepts "@ MP" spelling (marathon plans) → label M, T+18', () => {
    const { spec } = buildWorkoutSpec('long', 20, 400, 162, 'LONG · 8mi @ MP', 181);
    expect(spec).toMatchObject({ finish_mi: 8, finish_pace_s_per_mi: 418, finish_label: 'M' });
  });
});

describe('D1 · expandSpecToPhases long-finish (active-plan spec shapes)', () => {
  it('Jul 19 wk6 falsifier: 17mi + 7mi@HM 412 → [10.0mi easy @ 480, 7.0mi @ HM pace 412]', () => {
    const spec = { kind: 'long', ...EASY_BAND, finish_mi: 7, finish_pace_s_per_mi: 412, finish_label: 'HM' };
    const phases = expandSpecToPhases({ spec, totalMi: 17, easyPaceSec: 540, recoveryPaceSec: 540, toleranceSec: 20 });
    expect(phases).toHaveLength(2);
    expect(phases![0]).toMatchObject({ type: 'work', label: '10.0 mi easy', distanceMi: 10, targetPaceSPerMi: 480 });
    expect(phases![1]).toMatchObject({ type: 'work', label: '7.0 mi @ HM pace', distanceMi: 7, targetPaceSPerMi: 412 });
    expect(phases![1].tolerancePaceSPerMi).toBe(12); // tighter than easy build (race-pace quality)
  });

  it('Jun 28 wk3 falsifier: 14mi + 4mi@M 434 → [10.0mi easy @ 480, 4.0mi @ M pace 434]', () => {
    const spec = { kind: 'long', ...EASY_BAND, finish_mi: 4, finish_pace_s_per_mi: 434, finish_label: 'M' };
    const phases = expandSpecToPhases({ spec, totalMi: 14, easyPaceSec: 540, recoveryPaceSec: 540, toleranceSec: 20 });
    expect(phases).toHaveLength(2);
    expect(phases![0]).toMatchObject({ label: '10.0 mi easy', distanceMi: 10, targetPaceSPerMi: 480 });
    expect(phases![1]).toMatchObject({ label: '4.0 mi @ M pace', distanceMi: 4, targetPaceSPerMi: 434 });
  });

  it('plain long (no finish): single flat phase (unchanged behaviour)', () => {
    const spec = { kind: 'long', ...EASY_BAND };
    const phases = expandSpecToPhases({ spec, totalMi: 12, easyPaceSec: 540, toleranceSec: 20 });
    expect(phases).toHaveLength(1);
    expect(phases![0]).toMatchObject({ type: 'work', label: '12.0 mi long run', targetPaceSPerMi: 480 });
  });

  it('defensive: finish_mi >= totalMi falls back to flat (no negative easy split)', () => {
    const spec = { kind: 'long', ...EASY_BAND, finish_mi: 20, finish_pace_s_per_mi: 412, finish_label: 'HM' };
    const phases = expandSpecToPhases({ spec, totalMi: 16, easyPaceSec: 540, toleranceSec: 20 });
    expect(phases).toHaveLength(1);
  });
});

describe('D1 · subLabelFromSpec long-finish derivation', () => {
  it('derives "LONG · 7mi @ HM" from finish fields', () => {
    const spec = { kind: 'long', ...EASY_BAND, finish_mi: 7, finish_pace_s_per_mi: 412, finish_label: 'HM' };
    expect(subLabelFromSpec(spec)).toBe('LONG · 7mi @ HM');
  });

  it('plain long → null (keeps generator label "LONG")', () => {
    expect(subLabelFromSpec({ kind: 'long', ...EASY_BAND })).toBeNull();
  });

  it('race row (kind:long stash, no finish) → null (keeps "RACE")', () => {
    const race = { kind: 'long', pace_target_s_per_mi_lo: 397, pace_target_s_per_mi_hi: 412, hr_cap_bpm: 154, fuel_mi: [5, 9, 13] };
    expect(subLabelFromSpec(race)).toBeNull();
  });
});
