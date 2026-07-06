import { describe, it, expect } from 'vitest';
import { expandSpecToPhases } from './expand-spec';

/**
 * P1-47 (phone+watch audit 2026-07-06) · WU/CD/recovery pace targets were
 * fabricated from goal race pace (or a hardcoded 9:00/mi) instead of the
 * runner's own easy pace. The fix threads a nullable easy-pace anchor
 * through expandSpecToPhases:
 *   · anchor present → WU/CD/recovery targets ride it (Research/01 §E-pace)
 *   · anchor null (no fitness signal) → by-feel phases: targetPaceSPerMi
 *     null, tolerance null — never an invented number. durationSec stays
 *     populated (wire contract requires it) via an internal estimate that
 *     is never surfaced as a target.
 */
describe('P1-47 · null easy anchor → by-feel WU/CD/recovery, never a fabricated pace', () => {
  const tempoSpec = {
    kind: 'tempo', warmup_mi: 2, tempo_distance_mi: 4,
    tempo_pace_s_per_mi: 420, cooldown_mi: 1,
  };

  it('tempo · null anchor → WU/CD have no pace target but keep a duration', () => {
    const phases = expandSpecToPhases({ spec: tempoSpec, totalMi: 7, easyPaceSec: null })!;
    expect(phases).toHaveLength(3);
    const [wu, work, cd] = phases;
    expect(wu.targetPaceSPerMi).toBeNull();
    expect(wu.tolerancePaceSPerMi).toBeNull();
    expect(wu.durationSec).toBeGreaterThan(0);
    expect(cd.targetPaceSPerMi).toBeNull();
    // The authored tempo pace is real — it must survive untouched.
    expect(work.targetPaceSPerMi).toBe(420);
  });

  it('tempo · real anchor → WU/CD ride the runner\'s easy pace, not 9:00', () => {
    const phases = expandSpecToPhases({ spec: tempoSpec, totalMi: 7, easyPaceSec: 517 })!;
    const [wu, , cd] = phases;
    expect(wu.targetPaceSPerMi).toBe(517);
    expect(cd.targetPaceSPerMi).toBe(517);
    expect(wu.durationSec).toBe(Math.round(2 * 517));
  });

  it('reps · null anchor → jog recoveries carry no pace target (was 9:00/mi)', () => {
    const spec = {
      kind: 'threshold', warmup_mi: 1.5, cooldown_mi: 1,
      rep_count: 4, rep_distance_mi: 1, rep_pace_s_per_mi: 430, rep_rest_s: 120,
    };
    const phases = expandSpecToPhases({ spec, totalMi: 8, easyPaceSec: null })!;
    const recoveries = phases.filter((p) => p.type === 'recovery');
    expect(recoveries).toHaveLength(3);
    for (const r of recoveries) {
      expect(r.targetPaceSPerMi).toBeNull();
      expect(r.durationSec).toBe(120);
    }
    // Authored rep pace survives.
    for (const w of phases.filter((p) => p.type === 'work')) {
      expect(w.targetPaceSPerMi).toBe(430);
    }
  });

  it('reps · anchor present → recoveries ride the easy anchor', () => {
    const spec = {
      kind: 'intervals', warmup_mi: 1, cooldown_mi: 1,
      rep_count: 3, rep_distance_m: 800, rep_pace_s_per_mi: 390, rep_rest_s: 90,
    };
    const phases = expandSpecToPhases({ spec, totalMi: 5, easyPaceSec: 560, recoveryPaceSec: 560 })!;
    const rec = phases.find((p) => p.type === 'recovery')!;
    expect(rec.targetPaceSPerMi).toBe(560);
  });

  it('easy · spec band absent + null anchor → by feel; spec band present → band wins', () => {
    const bare = expandSpecToPhases({ spec: { kind: 'easy' }, totalMi: 5, easyPaceSec: null })!;
    expect(bare[0].targetPaceSPerMi).toBeNull();
    expect(bare[0].durationSec).toBeGreaterThan(0);

    const banded = expandSpecToPhases({
      spec: { kind: 'easy', pace_target_s_per_mi_lo: 600, pace_target_s_per_mi_hi: 660 },
      totalMi: 5, easyPaceSec: null,
    })!;
    expect(banded[0].targetPaceSPerMi).toBe(630);
  });

  it('long · spec band absent + null anchor → by feel; recovery kind same', () => {
    const long = expandSpecToPhases({ spec: { kind: 'long' }, totalMi: 12, easyPaceSec: null })!;
    expect(long[0].targetPaceSPerMi).toBeNull();
    const rec = expandSpecToPhases({ spec: { kind: 'recovery' }, totalMi: 3, easyPaceSec: null })!;
    expect(rec[0].targetPaceSPerMi).toBeNull();
  });

  it('regression · numeric anchor keeps prior behavior byte-for-byte', () => {
    // Same shapes spec-completeness.test.ts pins at easyPaceSec 540.
    const phases = expandSpecToPhases({
      spec: {
        kind: 'long', pace_target_s_per_mi_lo: 517, pace_target_s_per_mi_hi: 557,
        finish_mi: 4, finish_pace_s_per_mi: 435, finish_label: 'HM',
      },
      totalMi: 14, easyPaceSec: 540, recoveryPaceSec: 540, toleranceSec: 20,
    })!;
    expect(phases).toHaveLength(2);
    expect(phases[0].targetPaceSPerMi).toBe(537);
    expect(phases[1].targetPaceSPerMi).toBe(435);
    expect(phases[1].isFinishSegment).toBe(true);
    expect(phases[1].tolerancePaceSPerMi).toBe(12);
  });
});
