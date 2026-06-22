import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { capSpecToDistance, totalDistanceMiFromSpec, buildWorkoutSpec } from './spec-builder';

// ── Reproduce the adversarial claim g-persist-quality-over-long ──────────
// Claim: capSpecToDistance({intervals 3x1mi 180s}, maxMi=6.0) yields a spec
// whose totalDistanceMiFromSpec returns 6.1 > 6.0, because per-segment
// .toFixed(1) rounds wu/cd UP. Persisted quality 6.1 > week long 6.0.

describe('R3 g-repro: capSpecToDistance overshoot', () => {
  // Build the EXACT spec the auditor describes: 3x1mi @ I, 180s jog rest.
  // This mirrors what buildWorkoutSpec('intervals', ...) emits when the
  // prescription is "3x1 mi @ I" with a 180s rest, BEFORE capping.
  function makeIntervalSpec(reps: number, repMi: number, restS: number) {
    return {
      kind: 'intervals',
      warmup_mi: 1.2,
      rep_count: reps,
      rep_distance_mi: repMi,
      rep_pace_s_per_mi: 300,
      rep_rest_s: restS,
      cooldown_mi: 1.2,
      lthr_bpm: null,
    } as Record<string, unknown>;
  }

  it('maxMi=6.0, 3x1mi/180s -> what does the capped total persist as?', () => {
    const spec = makeIntervalSpec(3, 1.0, 180);
    const preTotal = totalDistanceMiFromSpec(spec, 6.0);
    const capped = capSpecToDistance(spec, 6.0);
    const postTotal = totalDistanceMiFromSpec(capped, 6.0);
    // eslint-disable-next-line no-console
    console.log('G6.0', JSON.stringify({ preTotal, capped, postTotal }));
    // Auditor asserts postTotal === 6.1 (over maxMi 6.0)
    expect(postTotal).toBeLessThanOrEqual(6.0);
  });

  it('maxMi=5.0, 3x1mi/180s -> persists as?', () => {
    const spec = makeIntervalSpec(3, 1.0, 180);
    const capped = capSpecToDistance(spec, 5.0);
    const postTotal = totalDistanceMiFromSpec(capped, 5.0);
    // eslint-disable-next-line no-console
    console.log('G5.0', JSON.stringify({ capped, postTotal }));
    expect(postTotal).toBeLessThanOrEqual(5.0);
  });

  // Now the END-TO-END path: buildWorkoutSpec with a real prescription,
  // THEN capSpecToDistance at d.distanceMi, THEN totalDistanceMiFromSpec —
  // exactly the persistPlan chain (generate.ts:2164-2165).
  it('e2e persistPlan chain: intervals prescription, day clamped to 6.0', () => {
    // weekT (T-pace) ~ 6:00/mi = 360s for an 18:30 5K intermediate.
    const built = buildWorkoutSpec(
      'intervals', 6.0, 360, null, '3×1 mi @ I · 180s jog', null, null, 360,
    );
    const preTotal = totalDistanceMiFromSpec(built.spec, 6.0);
    const capped = capSpecToDistance(built.spec, 6.0);
    const finalTotal = totalDistanceMiFromSpec(capped, 6.0);
    // eslint-disable-next-line no-console
    console.log('E2E', JSON.stringify({ builtSpec: built.spec, preTotal, capped, finalTotal }));
    expect(finalTotal).toBeLessThanOrEqual(6.0);
  });

  // Sweep a band of maxMi values + rep specs to find ALL overshoot cases.
  it('SWEEP: scan maxMi x rep configs for any persisted total > maxMi', () => {
    const overshoots: Array<Record<string, unknown>> = [];
    const restOptions = [60, 90, 120, 180, 90, 60];
    const repMiOptions = [1.0, 0.62, 0.497, 0.621371]; // mi, ~1km, 800m, 1km exact
    for (let maxMi10 = 30; maxMi10 <= 90; maxMi10++) {
      const maxMi = maxMi10 / 10;
      for (const kind of ['intervals', 'threshold', 'tempo'] as const) {
        for (const restS of restOptions) {
          for (const repMi of repMiOptions) {
            let spec: Record<string, unknown>;
            if (kind === 'tempo') {
              spec = {
                kind: 'tempo', warmup_mi: 2.0, tempo_distance_mi: 4.0,
                tempo_pace_s_per_mi: 372, cooldown_mi: 2.0, hr_target_bpm: null,
              };
            } else {
              spec = {
                kind, warmup_mi: 1.5, rep_count: 5, rep_distance_mi: repMi,
                rep_pace_s_per_mi: 360, rep_rest_s: restS, cooldown_mi: 1.0, lthr_bpm: null,
              };
            }
            const capped = capSpecToDistance(spec, maxMi);
            const total = totalDistanceMiFromSpec(capped, maxMi);
            if (total > maxMi) {
              overshoots.push({ maxMi, kind, restS, repMi, total, capped });
            }
          }
        }
      }
    }
    writeFileSync('/tmp/r3_sweep_overshoots.json', JSON.stringify({
      count: overshoots.length,
      byOvershootAmount: overshoots.reduce((acc: Record<string, number>, o) => {
        const amt = ((o.total as number) - (o.maxMi as number)).toFixed(2);
        acc[amt] = (acc[amt] ?? 0) + 1; return acc;
      }, {}),
      sample: overshoots.slice(0, 20),
    }, null, 1));
    // Document, do not assert here — we want to SEE all overshoots.
    expect(true).toBe(true);
  });
});
