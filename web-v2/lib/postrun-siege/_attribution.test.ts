/**
 * lib/postrun-siege/_attribution.test.ts · A FINDING BELONGS TO THE PART OF
 * THE RUN IT CAME FROM, AND A BAND HAS TO CONTAIN SOMETHING.
 *
 * Two defects with one thing in common: every number in the sentence was real
 * and the sentence was still false.
 */
import { describe, it, expect } from 'vitest';
import { deriveRecap, type RecapInput } from '@/lib/coach/run-recap';
import { resolveRunTerrain } from '@/lib/terrain/run-terrain';

describe('ATTRIBUTION · "the last third" has to be the last third of the run', () => {
  /* `detectHrDrift` and `detectPaceFade` both COMPACTED the splits they could
   * use and then sliced the compacted array, so "the back half" and "the last
   * third" meant the back of the survivors rather than the back of the run.
   *
   * Twelve splits, GPS pacing that stopped at mile six: the six survivors
   * compacted to a six-element array, the last third became miles 5 and 6,
   * and the runner read
   *
   *     The last third was about 60s/mi slower than the rest.
   *     Worth checking your fueling.
   *
   * about the middle of his run, with a cause attached to it. */
  const longRun = (splits: RecapInput['splits']): string => deriveRecap({
    type: 'long', phase: 'BASE', plannedMi: 12, actualMi: 12, actualPaceSPerMi: 500,
    actualDurationSec: 6000, actualAvgHr: 148, actualMaxHr: 165, splits,
  }).facts.join(' ');

  it('no fade is claimed when the back of the run carried no pace', () => {
    const halfPaced = [
      ...Array.from({ length: 6 }, (_, i) => ({ mile: i + 1, paceSPerMi: 460 + i * 20, hr: 140 + i })),
      ...Array.from({ length: 6 }, (_, i) => ({ mile: i + 7, hr: 152 + i })),
    ];
    expect(longRun(halfPaced)).not.toContain('last third');
  });

  it('a real fade in the real last third is still reported', () => {
    const faded = Array.from({ length: 12 }, (_, i) => ({
      mile: i + 1, paceSPerMi: i >= 8 ? 560 : 470, hr: 140 + i,
    }));
    expect(longRun(faded)).toContain('last third');
  });

  it('no drift is claimed when the back of the run carried no heart rate', () => {
    const strapDied = Array.from({ length: 12 }, (_, i) => ({
      mile: i + 1, paceSPerMi: 480, ...(i < 6 ? { hr: 140 + i } : {}),
    }));
    expect(longRun(strapDied)).not.toContain('HR climbed');
  });

  it('a real drift across the whole run is still reported', () => {
    const drifting = Array.from({ length: 12 }, (_, i) => ({
      mile: i + 1, paceSPerMi: 480, hr: 138 + i * 2,
    }));
    expect(longRun(drifting)).toContain('HR climbed');
  });
});

describe('ATTRIBUTION · the interval band cannot exclude every possible pace', () => {
  /* `target - 6` to `adj + 4` was written when only heat moved the target, so
   * `adj >= target` always held and the interval was well ordered. Terrain
   * arrived later and goes the other way: on a session downhill enough that
   * `adj + 4 < target - 6` the band is EMPTY, and four reps of 399/401/400/402
   * against a 400 target read
   *
   *     0 of 4 reps in range · HR 160.
   *     Even across all 4 · held the line. HR 160 says the effort was right.
   *
   * Two sentences in one payload, the first false for any rep the runner
   * could have run — including one landing exactly on either target. */
  const downhill = resolveRunTerrain({
    source: 'watch', distanceMi: 6, durationSec: 6 * 400, elevGainFt: 60,
    splits: [{ mile: 1, elev_ft: 10 }, { mile: 2, elev_ft: -180 }, { mile: 3, elev_ft: -180 },
             { mile: 4, elev_ft: -180 }, { mile: 5, elev_ft: -180 }, { mile: 6, elev_ft: -180 }],
  });

  const reps = (repPaces: number[], terrain: typeof downhill | null) => deriveRecap({
    type: 'intervals', phase: 'BUILD', plannedMi: 6, actualMi: 6,
    actualPaceSPerMi: 400, plannedPaceSPerMi: 400, actualAvgHr: 160, actualMaxHr: 180,
    repPaces, repCount: repPaces.length, terrain,
  });

  it('the session is downhill enough to have inverted the band', () => {
    expect(downhill.material).toBe(true);
    expect(downhill.factor).toBeLessThan(1);
    const adj = reps([400, 400], downhill).intervals_adjusted_target_s_per_mi!;
    expect(adj + 4).toBeLessThan(400 - 6);   // the old bounds, out of order
  });

  it('the session that read 0 of 4 now reads 4 of 4', () => {
    expect(reps([399, 401, 400, 402], downhill).facts[0]).toContain('All 4 reps in range');
  });

  it('both anchors are inside the band, whichever way conditions pushed', () => {
    for (const terrain of [downhill, null]) {
      const adj = reps([400, 400], terrain).intervals_adjusted_target_s_per_mi!;
      for (const p of [400, adj]) {
        expect(reps([p, p, p, p], terrain).facts[0],
          `a rep at ${p} against target 400 / adjusted ${adj}`).toContain('All 4 reps in range');
      }
    }
  });

  it('a genuinely slow rep is still called out', () => {
    expect(reps([399, 401, 470, 402], downhill).facts[0]).toContain('3 of 4 reps in range');
  });
});
