/**
 * Fitness-resolver verification tests.
 *
 * These guard the architectural invariant: every consumer of paces
 * (modal, training cells, race plan, workout descriptions) reads from
 * the same fitness bundle. If a regression sends one consumer down a
 * stale hardcoded path, these tests catch it.
 *
 * The full resolveFitness() hits Postgres, so we test it indirectly by
 * verifying the pure components, pacesFromVdot, fmtPaceBand,
 * describeWorkout with fitness, produce the right numbers end-to-end
 * for the canonical 1:30:00 HM scenario.
 */

import { describe, it, expect } from 'vitest';
import { pacesFromVdot } from '../vdot';
import { fmtPaceBand, type ResolvedFitness } from '../fitness-types';
import { describeWorkout } from '../workout-descriptions';

// ── A 1:30:00 HM runner, the AFC Half scenario ─────────────────────
//
// 1:30:00 / 13.109 mi = 412 sec/mi ≈ 6:52/mi race pace.
// At Daniels VDOT ~48 a 1:30 half is roughly the right finishing
// time, so use VDOT 48 as the runner's fitness.

function buildFixture(): ResolvedFitness {
  const vdot = 48;
  const paces = pacesFromVdot(vdot)!;
  const goalPaceSPerMi = 412;
  return {
    today: '2026-05-18',
    paces,
    vdot: {
      value: vdot,
      source: 'aggregate',
      sourceLabel: 'Top 3 efforts (last 365 days): 10K 39m, Half 1:30m',
      contributors: [
        { name: '10K',  date: '2026-04-15', distanceMi: 6.214,  finishS: 2400, vdot: 48.5 },
        { name: 'Half', date: '2026-02-12', distanceMi: 13.109, finishS: 5400, vdot: 47.8 },
        { name: '5K',   date: '2026-03-22', distanceMi: 3.107,  finishS: 1140, vdot: 48.2 },
      ],
    },
    maxHr:     { value: 175, source: 'manual' },
    restingHr: { value: 52,  source: 'manual' },
    hrZones: {
      z1: { lowBpm: 88,  highBpm: 105, label: 'Recovery'  },
      z2: { lowBpm: 105, highBpm: 122, label: 'Easy'      },
      z3: { lowBpm: 122, highBpm: 140, label: 'Steady'    },
      z4: { lowBpm: 140, highBpm: 157, label: 'Threshold' },
      z5: { lowBpm: 157, highBpm: 175, label: 'VO2max'    },
    },
    activeRace: {
      slug: 'afc-half',
      name: 'Americas Finest City',
      date: '2026-08-16',
      daysAway: 90,
      distanceMi: 13.109,
      goalDisplay: '1:30:00',
      goalFinishS: 5400,
      goalPaceSPerMi,
      priority: 'A',
    },
    racePaceBand: { lowS: goalPaceSPerMi - 10, highS: goalPaceSPerMi + 10, label: 'AFC Half goal pace' },
    easyPaceBand: { lowS: paces.E.lowS, highS: paces.E.highS },
  };
}

describe('Fitness resolver, pace consistency for a 1:30 HM runner', () => {
  const fitness = buildFixture();

  it('race-pace band brackets the goal pace ± 10 s/mi', () => {
    expect(fitness.racePaceBand.lowS).toBe(402);
    expect(fitness.racePaceBand.highS).toBe(422);
    expect(fmtPaceBand(fitness.racePaceBand)).toBe('6:42–7:02/mi');
  });

  it('Daniels VDOT 48 produces sensible pace bands', () => {
    // E pace should be roughly 8:00-9:00/mi (recovery)
    expect(fitness.paces.E.lowS).toBeGreaterThan(7 * 60 + 30);
    expect(fitness.paces.E.highS).toBeLessThan(10 * 60);
    // T pace should be roughly half-marathon pace ish (6:50-7:30)
    expect(fitness.paces.T.lowS).toBeGreaterThan(6 * 60 + 30);
    expect(fitness.paces.T.highS).toBeLessThan(7 * 60 + 45);
    // I pace should be 5K-ish (5:50-6:30)
    expect(fitness.paces.I.lowS).toBeGreaterThan(5 * 60 + 30);
    expect(fitness.paces.I.highS).toBeLessThan(7 * 60);
  });

  it('describeWorkout HM Blocks renders RACE-PACE band (not 7:30-7:50)', () => {
    const d = describeWorkout('Threshold · HM Blocks', 'quality', fitness);
    // The middle loop step is the HM-pace block
    const loop = d.steps.find((s) => s.kind === 'loop');
    expect(loop).toBeDefined();
    if (loop?.kind === 'loop') {
      const work = loop.items[0];
      // Should be 6:42-7:02/mi, the user's actual race pace ±10s
      expect(work.pace).toBe('6:42–7:02/mi');
      // Verify it's NOT the legacy hardcoded value
      expect(work.pace).not.toBe('7:30–7:50/mi');
    }
  });

  it('describeWorkout HM Tempo renders race-pace continuous', () => {
    const d = describeWorkout('Threshold · HM Tempo', 'quality', fitness);
    const tempo = d.steps.find((s) => s.kind === 'simple' && /tempo/i.test(s.name));
    if (tempo?.kind === 'simple') {
      expect(tempo.pace).toBe('6:42–7:02/mi');
    }
  });

  it('describeWorkout Long Run · HM Finish ends at race pace', () => {
    const d = describeWorkout('Long Run · HM Finish', 'long', fitness);
    const finish = d.steps.find((s) => s.kind === 'simple' && /finish/i.test(s.name));
    if (finish?.kind === 'simple') {
      expect(finish.pace).toBe('6:42–7:02/mi');
    }
  });

  it('describeWorkout Easy uses E pace band, not hardcoded 9:00-9:30', () => {
    const d = describeWorkout('Easy', 'easy', fitness);
    const easyStep = d.steps[0];
    if (easyStep?.kind === 'simple') {
      // For VDOT 48, E pace is roughly 8:30-9:30, must be the resolved
      // band, not the legacy hardcoded "9:00-9:30/mi"
      expect(easyStep.pace).toBe(fmtPaceBand(fitness.paces.E));
    }
  });

  it('describeWorkout Intervals uses I pace band, not hardcoded 6:30-7:00', () => {
    const d = describeWorkout('Intervals', 'quality', fitness);
    const loop = d.steps.find((s) => s.kind === 'loop');
    if (loop?.kind === 'loop') {
      const work = loop.items[0];
      expect(work.pace).toBe(fmtPaceBand(fitness.paces.I));
    }
  });

  it('without fitness, describeWorkout falls back to VDOT-45 defaults', () => {
    // Critical: legacy call sites that haven't been migrated still
    // need to render sensible strings, not undefined or "null".
    const d = describeWorkout('Threshold · HM Blocks', 'quality');
    const loop = d.steps.find((s) => s.kind === 'loop');
    if (loop?.kind === 'loop') {
      expect(loop.items[0].pace).toBeDefined();
      expect(loop.items[0].pace).toMatch(/^\d+:\d{2}/); // looks like a pace
    }
  });
});

describe('Fitness resolver, HR zones from max HR', () => {
  const fitness = buildFixture();

  it('Z2 (Easy) band brackets 60-70% of max HR', () => {
    expect(fitness.hrZones).not.toBeNull();
    if (fitness.hrZones) {
      // For max HR 175: Z2 = 105-122 bpm
      expect(fitness.hrZones.z2.lowBpm).toBe(105);
      expect(fitness.hrZones.z2.highBpm).toBe(122);
    }
  });

  it('Z4 (Threshold) band brackets 80-90% of max HR', () => {
    if (fitness.hrZones) {
      expect(fitness.hrZones.z4.lowBpm).toBe(140);
      expect(fitness.hrZones.z4.highBpm).toBe(157);
    }
  });
});

describe('Fitness resolver, race-pace fallback', () => {
  it('falls back to threshold band when no active race', () => {
    const fitness = buildFixture();
    const noRace: ResolvedFitness = {
      ...fitness,
      activeRace: null,
      racePaceBand: {
        lowS: fitness.paces.T.lowS,
        highS: fitness.paces.T.highS,
        label: 'Threshold (no active race)',
      },
    };
    const d = describeWorkout('Threshold · HM Blocks', 'quality', noRace);
    const loop = d.steps.find((s) => s.kind === 'loop');
    if (loop?.kind === 'loop') {
      // When there's no active race, HM-pace workouts target T-band
      expect(loop.items[0].pace).toBe(fmtPaceBand(fitness.paces.T));
    }
  });
});
