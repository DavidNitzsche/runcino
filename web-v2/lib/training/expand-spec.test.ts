import { describe, it, expect } from 'vitest';
import { expandSpecToPhases, subLabelFromSpec } from './expand-spec';
import { extractLongSegments } from '@/lib/plan/spec-builder';

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

describe('SEGLONG-1 · a long run with easy running BETWEEN its quality blocks', () => {
  // The shape doctrine calls a modified block (Research/04 §11.1 Variations,
  // "two segments separated by short rest") and a coach writes as descending
  // LT blocks with easy running between them. Before this, every segment was
  // contiguous and tail-anchored: all the easy miles went in one bulk phase up
  // front and the blocks ran back-to-back to the finish, which can express a
  // progression or a fast finish and cannot express re-entering threshold
  // under accumulating fatigue.
  const segmented = () => expandSpecToPhases({
    spec: {
      kind: 'long',
      pace_target_s_per_mi_lo: 517, pace_target_s_per_mi_hi: 557,
      finish_segments: [
        { mi: 3, pace_s_per_mi: 420, label: 'T', recovery_mi: 1 },
        { mi: 2, pace_s_per_mi: 420, label: 'T', recovery_mi: 1 },
        { mi: 1, pace_s_per_mi: 420, label: 'T' },
      ],
    },
    totalMi: 14, easyPaceSec: 540, recoveryPaceSec: 540, toleranceSec: 20,
  })!;

  it('interleaves the gaps instead of hoisting every easy mile to the front', () => {
    const phases = segmented();
    // bulk, T, easy, T, easy, T
    expect(phases).toHaveLength(6);
    expect(phases.map((p) => p.targetPaceSPerMi))
      .toEqual([537, 420, 537, 420, 537, 420]);
  });

  it('takes the gap miles OUT of the opening bulk, never adds them to the day', () => {
    const phases = segmented();
    const total = phases.reduce((a, p) => a + (p.distanceMi ?? 0), 0);
    // 14 total = 6 quality + 2 gap + 6 bulk. A day that grew because its
    // recoveries were counted on top would be a session the week never
    // budgeted for.
    expect(Number(total.toFixed(1))).toBe(14);
    expect(phases[0].distanceMi).toBe(6);
  });

  it('marks the blocks as finish segments and the gaps as not', () => {
    // `isFinishSegment` is what the day is judged on, so a recovery carrying
    // it would have the runner graded on the jog between the efforts.
    expect(segmented().map((p) => p.isFinishSegment === true))
      .toEqual([false, true, false, true, false, true]);
  });

  it('a contiguous long run is untouched · no recovery_mi, no extra phases', () => {
    const phases = expandSpecToPhases({
      spec: {
        kind: 'long',
        pace_target_s_per_mi_lo: 517, pace_target_s_per_mi_hi: 557,
        finish_segments: [
          { mi: 3, pace_s_per_mi: 480, label: 'M' },
          { mi: 2, pace_s_per_mi: 420, label: 'T' },
        ],
      },
      totalMi: 14, easyPaceSec: 540, recoveryPaceSec: 540, toleranceSec: 20,
    })!;
    expect(phases).toHaveLength(3);
    expect(phases[0].distanceMi).toBe(9);
  });
});

describe('SEGLONG-1 · the label round-trips the gaps', () => {
  // `extractLongSegments` reads the label, `subLabelFromSpec` writes it back.
  // If the writer drops the gaps, the next derivation turns a segmented long
  // into a contiguous one — the label would claim the blocks run back-to-back
  // while the spec still separated them, which is exactly the
  // label-drifts-from-spec defect subLabelFromSpec exists to prevent.
  it('writes the easy blocks back out', () => {
    expect(subLabelFromSpec({
      kind: 'long',
      finish_segments: [
        { mi: 3, pace_s_per_mi: 420, label: 'T', recovery_mi: 1 },
        { mi: 2, pace_s_per_mi: 420, label: 'T', recovery_mi: 1 },
        { mi: 1, pace_s_per_mi: 420, label: 'T' },
      ],
    })).toBe('LONG · 3mi @ T + 1mi @ E + 2mi @ T + 1mi @ E + 1mi @ T');
  });

  it('survives a full label → segments → label cycle', () => {
    const label = 'LONG · 3mi @ T + 1mi @ E + 2mi @ T + 1mi @ E + 1mi @ T';
    const segs = extractLongSegments(label);
    // Three QUALITY blocks — the easy tokens are gaps hanging off the block
    // before them, never entries of their own. That is what keeps every
    // consumer summing `mi` as hard miles correct with no edit.
    expect(segs).toEqual([
      { mi: 3, tag: 'T', recoveryMi: 1 },
      { mi: 2, tag: 'T', recoveryMi: 1 },
      { mi: 1, tag: 'T' },
    ]);
    expect(subLabelFromSpec({
      kind: 'long',
      finish_segments: segs.map((s) => ({
        mi: s.mi, pace_s_per_mi: 420, label: s.tag,
        ...(s.recoveryMi ? { recovery_mi: s.recoveryMi } : {}),
      })),
    })).toBe(label);
  });

  it('a contiguous label still parses and writes exactly as before', () => {
    const label = 'LONG · 3mi @ M + 2mi @ T';
    expect(extractLongSegments(label)).toEqual([
      { mi: 3, tag: 'M' }, { mi: 2, tag: 'T' },
    ]);
    expect(subLabelFromSpec({
      kind: 'long',
      finish_segments: [
        { mi: 3, pace_s_per_mi: 480, label: 'M' },
        { mi: 2, pace_s_per_mi: 420, label: 'T' },
      ],
    })).toBe(label);
  });

  it('a leading easy block is the opening bulk, not a gap', () => {
    // The expander computes the bulk as the remainder, so an easy token
    // before any quality block has nothing to attach to and is dropped.
    expect(extractLongSegments('LONG · 5mi @ E + 3mi @ T + 2mi @ T')).toEqual([
      { mi: 3, tag: 'T' }, { mi: 2, tag: 'T' },
    ]);
  });
});
