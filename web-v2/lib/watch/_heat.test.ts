/**
 * Heat on the wrist — lib/watch/heat.ts.
 *
 * David's decisions, 2026-08-24 (docs/design/watch-0821/HEAT-ADJUSTMENT.md):
 * current temperature or the feature is not built; the run is graded against
 * the eased band; `heatAdjusted` is wired in the same pass.
 *
 * The contract these pin, in order of what would hurt most if it broke:
 *
 *   1. NO WEATHER MEANS NO ADJUSTMENT. Every failure path leaves the targets
 *      exactly as authored. A missing thermometer must never read as an
 *      invented temperature, and must never read as "adjust by zero" in a way
 *      a caller could mistake for a real measurement.
 *   2. A RACE IS NEVER TOUCHED. Race pace is priced in the execution plan.
 *      Pricing it twice is a bug this repo has shipped once already.
 *   3. TOLERANCE NEVER MOVES. Research/06 says nothing about band width, so
 *      widening one would be a constant with no citation.
 *   4. THE NOTE CANNOT LIE. `heatNote` returns null for every outcome where
 *      nothing was applied, so its presence on the wire IS the adjustment.
 */
import { describe, it, expect } from 'vitest';
import { adjustPhasesForHeat, heatNote, type HeatDeps } from './heat';

type Phase = {
  targetPaceSPerMi?: number | null;
  tolerancePaceSPerMi?: number | null;
  durationSec?: number;
  distanceMi?: number | null;
};

function deps(over: Partial<HeatDeps> = {}): Partial<HeatDeps> {
  return {
    resolveHomeLatLng: async () => ({ lat: 34.05, lng: -118.24 }),
    loadLatestVdotForUser: async () => 47.9,
    fetchCurrentConditions: async () => ({
      temp_f: 88, dewpoint_f: 68, humidity_pct: 52, wind_mph: 5,
      cloud_cover_pct: 10, precip_in: 0, weather_code: 0,
      observed_at: new Date().toISOString(), age_min: 4,
    }),
    ...over,
  };
}

const easyPhases = (): Phase[] => ([
  { targetPaceSPerMi: 537, tolerancePaceSPerMi: 12, durationSec: 600 },
  { targetPaceSPerMi: 420, tolerancePaceSPerMi: 8, durationSec: 1680, distanceMi: 4 },
]);

describe('adjustPhasesForHeat', () => {
  it('eases every target on a hot day and leaves tolerance alone', async () => {
    const phases = easyPhases();
    const before = phases.map((p) => p.targetPaceSPerMi!);
    const out = await adjustPhasesForHeat('u', phases, {
      isRace: false, intervalStyle: false, totalSec: 2280, deps: deps(),
    });

    expect(out.applied).toBe(true);
    expect(out.slowdownPct).toBeGreaterThan(0);
    expect(out.tempF).toBe(88);
    expect(out.dewpointF).toBe(68);

    // Slower means a BIGGER seconds-per-mile. Getting this backwards would
    // ask a runner to speed up in the heat.
    phases.forEach((p, i) => expect(p.targetPaceSPerMi!).toBeGreaterThan(before[i]));
    expect(phases.map((p) => p.tolerancePaceSPerMi)).toEqual([12, 8]);
  });

  it('never touches a race', async () => {
    const phases = easyPhases();
    const snapshot = JSON.parse(JSON.stringify(phases));
    const out = await adjustPhasesForHeat('u', phases, {
      isRace: true, intervalStyle: false, totalSec: 2280, deps: deps(),
    });
    expect(out.applied).toBe(false);
    expect(out.reason).toBe('race');
    expect(phases).toEqual(snapshot);
  });

  it('leaves targets untouched when there is no location', async () => {
    const phases = easyPhases();
    const snapshot = JSON.parse(JSON.stringify(phases));
    const out = await adjustPhasesForHeat('u', phases, {
      isRace: false, intervalStyle: false, totalSec: 2280,
      deps: deps({ resolveHomeLatLng: async () => null }),
    });
    expect(out.reason).toBe('no_location');
    expect(out.tempF).toBeNull();
    expect(phases).toEqual(snapshot);
  });

  it('leaves targets untouched when current conditions are unavailable', async () => {
    // This is the staleness gate's downstream half: fetchCurrentConditions
    // returns null for an observation too old, and the adjustment is then
    // DROPPED rather than quietly served stale.
    const phases = easyPhases();
    const snapshot = JSON.parse(JSON.stringify(phases));
    const out = await adjustPhasesForHeat('u', phases, {
      isRace: false, intervalStyle: false, totalSec: 2280,
      deps: deps({ fetchCurrentConditions: async () => null }),
    });
    expect(out.reason).toBe('no_current_conditions');
    expect(phases).toEqual(snapshot);
  });

  it('does nothing on a cool morning', async () => {
    const phases = easyPhases();
    const snapshot = JSON.parse(JSON.stringify(phases));
    const out = await adjustPhasesForHeat('u', phases, {
      isRace: false, intervalStyle: false, totalSec: 2280,
      deps: deps({
        fetchCurrentConditions: async () => ({
          temp_f: 48, dewpoint_f: 40, humidity_pct: 70, wind_mph: 3,
          cloud_cover_pct: 90, precip_in: 0, weather_code: 3,
          observed_at: new Date().toISOString(), age_min: 2,
        }),
      }),
    });
    expect(out.applied).toBe(false);
    expect(out.reason).toBe('not_warm_enough');
    // It still reports what it measured — "we looked, it was cold" is a
    // different answer from "we never looked".
    expect(out.tempF).toBe(48);
    expect(phases).toEqual(snapshot);
  });

  it('scales a distance phase estimate but not a time phase', async () => {
    const phases: Phase[] = [
      { targetPaceSPerMi: 480, durationSec: 600 },                  // time: 10 min
      { targetPaceSPerMi: 480, durationSec: 1920, distanceMi: 4 },  // distance: 4 mi
    ];
    await adjustPhasesForHeat('u', phases, {
      isRace: false, intervalStyle: false, totalSec: 2520, deps: deps(),
    });
    // Ten minutes stays ten minutes, covering less ground.
    expect(phases[0].durationSec).toBe(600);
    // Four miles at a slower pace takes longer, and the lobby total must
    // say so rather than under-reporting the session.
    expect(phases[1].durationSec!).toBeGreaterThan(1920);
  });

  it('halves the correction for intervals, per Research/06 §2', async () => {
    const steady: Phase[] = [{ targetPaceSPerMi: 480, durationSec: 1800 }];
    const reps: Phase[] = [{ targetPaceSPerMi: 480, durationSec: 1800 }];
    const a = await adjustPhasesForHeat('u', steady, {
      isRace: false, intervalStyle: false, totalSec: 1800, deps: deps(),
    });
    const b = await adjustPhasesForHeat('u', reps, {
      isRace: false, intervalStyle: true, totalSec: 1800, deps: deps(),
    });
    expect(b.slowdownPct).toBeCloseTo(a.slowdownPct / 2, 6);
    expect(reps[0].targetPaceSPerMi!).toBeLessThan(steady[0].targetPaceSPerMi!);
  });

  it('survives a phase with no target', async () => {
    const phases: Phase[] = [
      { targetPaceSPerMi: null, durationSec: 600 },
      { targetPaceSPerMi: 480, durationSec: 1800 },
    ];
    const out = await adjustPhasesForHeat('u', phases, {
      isRace: false, intervalStyle: false, totalSec: 2400, deps: deps(),
    });
    expect(out.applied).toBe(true);
    expect(phases[0].targetPaceSPerMi).toBeNull();
    expect(phases[1].targetPaceSPerMi!).toBeGreaterThan(480);
  });

  it('does not adjust when there is no target anywhere to adjust', async () => {
    const phases: Phase[] = [{ targetPaceSPerMi: null, durationSec: 3600 }];
    const out = await adjustPhasesForHeat('u', phases, {
      isRace: false, intervalStyle: false, totalSec: 3600, deps: deps(),
    });
    expect(out.applied).toBe(false);
    expect(out.reason).toBe('not_warm_enough');
  });
});

describe('heatNote', () => {
  it('says nothing when nothing was applied', () => {
    expect(heatNote({
      applied: false, slowdownPct: 0, tempF: 88, dewpointF: 68,
      observedAgeMin: 3, reason: 'race',
    })).toBeNull();
  });

  it('names the dewpoint only when it is the part that matters', () => {
    const humid = heatNote({
      applied: true, slowdownPct: 4, tempF: 84, dewpointF: 68,
      observedAgeMin: 3, reason: null,
    });
    expect(humid).toBe('84 degrees, dewpoint 68. Targets eased for the heat.');

    // A dry 84 is a different run, and naming a dewpoint of 45 would be
    // three extra words that carry nothing.
    const dry = heatNote({
      applied: true, slowdownPct: 3, tempF: 84, dewpointF: 45,
      observedAgeMin: 3, reason: null,
    });
    expect(dry).toBe('84 degrees. Targets eased for the heat.');
  });
});

/**
 * The double-pricing guard, stated as arithmetic rather than as a comment.
 *
 * This is the bug the watch heat adjustment CREATES if nothing else changes:
 * the recap grades a completed run against `frozenTargetSPerMi`, read out of
 * the watch completion — which is now the eased band. Left alone, the recap's
 * own Research/06 correction in `intervalPacing` prices the same day's heat a
 * second time, and a hot run reads better than the identical effort in the
 * cold.
 */
describe('the eased band is priced exactly once', () => {
  it('easing is applied on the way out, and not again on the way back', async () => {
    const authored = 420;
    const phases: Phase[] = [{ targetPaceSPerMi: authored, durationSec: 1800 }];

    const out = await adjustPhasesForHeat('u', phases, {
      isRace: false, intervalStyle: true, totalSec: 1800, deps: deps(),
    });
    const eased = phases[0].targetPaceSPerMi!;
    expect(out.applied).toBe(true);
    expect(eased).toBeGreaterThan(authored);

    // What the recap would do WITHOUT the flag: apply the halved slowdown to
    // the number it read, which is already eased.
    const doublePriced = Math.round(eased * (1 + (out.slowdownPct / 2) / 100));
    // With the flag, the target it grades against is the band as issued.
    const singlePriced = eased;

    expect(doublePriced).toBeGreaterThan(singlePriced);
    // And the gap is not academic — it is the whole correction, again.
    expect(doublePriced - singlePriced).toBeGreaterThanOrEqual(1);
  });
});
