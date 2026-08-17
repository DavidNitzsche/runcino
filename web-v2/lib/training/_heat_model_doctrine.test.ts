/**
 * HEAT · one set of conditions, one number, on every surface.
 *
 * Sibling of lib/coach/_heat_doctrine.test.ts, which locks the ACCLIMATION
 * and SAFETY-GATE side (HEAT-1). This file locks the two defects the
 * 2026-08-17 doctrine-conformance audit found in the PACE and BAND side.
 *
 * CLUSTER 5 · FIVE PRE-PROCESSORS ABOVE ONE SHARED TABLE.
 *   lib/training/heat-model.ts's header claimed the engines "can never
 *   disagree again" after the 2026-06-09 unification. They still did, because
 *   sharing a table is not sharing a model. Each consumer decided for itself
 *   what to feed it:
 *
 *     judgeWeather      Tair + solar bump, dewpoint (measured or from RH)
 *     applyHeatToPace   Tair only
 *     execution-plan    Tair only
 *     drift-monitor     Tair, dewpoint, its own interval halving
 *     env-schedule      Tair only, no dewpoint at all
 *
 *   A half marathon at 80°F, clear sky, dewpoint 70 read +6.4% on the Targets
 *   projection and +9.35% on the same day's post-run verdict.
 *
 * CLUSTER 6 · FOUR HEAT-BAND TAXONOMIES, NONE FROM DOCTRINE.
 *   Doctrine's is the ACSM / Korey Stringer WBGT flag table
 *   (Research/06 §3), and it was implemented only inside the safety gate. At
 *   72°F the server said "hot" (race-conditions, 60/70/80 on Tair) while the
 *   phone said "warm" (60/75/85 on Tair) about the same conditions.
 */
import { describe, it, expect } from 'vitest';
import {
  heatEffort,
  effortSlowdownPct,
  maughanSlowdownPct,
  dewpointAddPct,
  durationHeatScale,
  solarEffectiveBumpF,
  estimateDewpointF,
  INTERVAL_ADJUSTMENT_FACTOR,
  type HeatConditions,
} from './heat-model';
import { applyHeatToPace, heatHrBumpBpm, HEAT_HR_CONFOUNDER } from '@/lib/weather/heat-adjustment';
import { judgeWeather } from '@/lib/coach/weather-adjust';
import { heatAdjustQualitySample } from '@/lib/plan/drift-monitor';
import { heatBandForConditions, heatBandForFlag, wbgtApproxF, flagForWbgt } from '@/lib/coach/heat-gate';

const CITE_TABLE = 'Research/06 §1 · Maughan/Ely/Vihma slowdown table, mid-pack column';
const CITE_DEW = 'Research/06 §12 · "+1% per 10°F dewpoint above 60°F"';
const CITE_SOLAR = 'Research/06 §3 · solar correction · full sun +5°F, partial +2°F, overcast 0°F';
const CITE_INTERVAL = 'Research/06 §2 · "For repeats with ≥1:1 work:rest, apply half the continuous-run adjustment"';
const CITE_WBGT = 'Research/06 §3 · ACSM / Korey Stringer WBGT flag table (white/green/yellow/red/black)';

/** The audit's own example: a half marathon on a hot clear afternoon. */
const HALF: HeatConditions = {
  tempF: 80,
  dewpointF: 70,
  conditions: 'clear',
  cloudCoverPct: 5,
  durationS: 5400,          // 1:30 half
  tier: 'mid_pack',
};

describe('HEAT-M1 · the model is the whole calculation, not just the table', () => {
  it('composes exactly: (table at effective temp + dewpoint) x duration', () => {
    const e = heatEffort(HALF)!;
    expect(e.effectiveTempF, CITE_SOLAR).toBe(85);      // 80 + 5, clear sky
    const expected = (maughanSlowdownPct(85, 'mid_pack') + dewpointAddPct(70))
      * durationHeatScale(5400);
    expect(e.slowdownPct, CITE_TABLE).toBeCloseTo(expected, 9);
  });

  it('the solar bump is doctrine\'s three buckets, and unknown sky is not sun', () => {
    expect(solarEffectiveBumpF('clear', 5), CITE_SOLAR).toBe(5);
    expect(solarEffectiveBumpF('partly cloudy', 50), CITE_SOLAR).toBe(2);
    expect(solarEffectiveBumpF('cloudy', 90), CITE_SOLAR).toBe(0);
    // The pace model does not invent a penalty from a field nobody filled in.
    // (heat-gate takes the opposite default ON PURPOSE — see its comment.)
    expect(solarEffectiveBumpF(null, null), 'unknown sky is unknown, not full sun').toBe(0);
  });

  it('a missing dewpoint is estimated from RH once, in one place', () => {
    const fromRh = heatEffort({ tempF: 80, humidityPct: 60, durationS: 5400 })!;
    expect(fromRh.dewpointF).toBeCloseTo(estimateDewpointF(80, 60), 9);
    // Measured dewpoint always wins over the estimate.
    const measured = heatEffort({ tempF: 80, humidityPct: 60, dewpointF: 55, durationS: 5400 })!;
    expect(measured.dewpointF).toBe(55);
  });

  it('the interval halving lives in the model, not at whichever call site remembers it', () => {
    expect(INTERVAL_ADJUSTMENT_FACTOR, CITE_INTERVAL).toBe(0.5);
    const continuous = effortSlowdownPct({ tempF: 80, humidityPct: 60, durationS: 3600 });
    const repeats = effortSlowdownPct({ tempF: 80, humidityPct: 60, durationS: 3600, intervalStyle: true });
    expect(repeats, CITE_INTERVAL).toBeCloseTo(continuous * 0.5, 9);
  });

  it('no weather means no correction · silently, never an invented one', () => {
    expect(effortSlowdownPct({ tempF: null })).toBe(0);
    expect(heatEffort({ tempF: undefined })).toBeNull();
  });

  it('the dewpoint surcharge is additive at the cited rate', () => {
    expect(dewpointAddPct(60), CITE_DEW).toBe(0);
    expect(dewpointAddPct(70), CITE_DEW).toBeCloseTo(1, 9);
    expect(dewpointAddPct(75), CITE_DEW).toBeCloseTo(1.5, 9);
  });
});

describe('HEAT-M2 · cross-surface agreement · one input, one output, every consumer', () => {
  it('the race projection and the post-run verdict price the same afternoon identically', () => {
    // The exact disagreement the audit reported: +6.4% vs +9.35%.
    const model = effortSlowdownPct(HALF);

    // 1 · the Targets / race-projection path.
    const pace = HALF.durationS! / 13.1;
    const adjusted = applyHeatToPace(pace, HALF.tempF!, 13.1, 'mid_pack', {
      dewpointF: HALF.dewpointF, conditions: HALF.conditions, cloudCoverPct: HALF.cloudCoverPct,
    });
    const projectionPct = ((adjusted / pace) - 1) * 100;

    // 2 · the same-day verdict path.
    const verdict = judgeWeather({
      tempF: HALF.tempF!, dewpointF: HALF.dewpointF, conditions: HALF.conditions,
      cloudCoverPct: HALF.cloudCoverPct, durationS: HALF.durationS,
    });

    // 3 · the drift-monitor's per-run normalisation.
    const drift = heatAdjustQualitySample({
      plannedSPerMi: pace, actualSPerMi: pace, workoutType: 'tempo',
      tempF: HALF.tempF!, dewpointF: HALF.dewpointF!, humidityPct: null,
      // The sky was missing from this sample type until 2026-08-17, which is
      // exactly how it landed 2.15 points under the recap for the same run.
      conditions: HALF.conditions, cloudCoverPct: HALF.cloudCoverPct,
      durationS: HALF.durationS!,
    });

    // Agreement to a tenth of a percentage point. The residue is display
    // rounding — applyHeatToPace returns whole seconds per mile and the
    // verdict rounds to one decimal — not two models disagreeing. The gap
    // this replaced was 2.95 percentage points.
    const msg = 'one set of conditions must produce one number · this is the +6.4% vs +9.35% split';
    for (const [surface, pct] of [
      ['race projection', projectionPct],
      ['post-run verdict', verdict.slowdownPct],
      ['drift monitor', drift.slowdownPct],
    ] as const) {
      expect(Math.abs(pct - model), `${msg} · ${surface} read ${pct.toFixed(2)}% against the model's ${model.toFixed(2)}%`)
        .toBeLessThan(0.1);
    }
  });

  it('the sky matters on every surface or on none', () => {
    const clear = { ...HALF, conditions: 'clear', cloudCoverPct: 5 };
    const overcast = { ...HALF, conditions: 'cloudy', cloudCoverPct: 95 };
    const pace = HALF.durationS! / 13.1;
    const projDelta =
      applyHeatToPace(pace, 80, 13.1, 'mid_pack', { dewpointF: 70, conditions: 'clear', cloudCoverPct: 5 }) -
      applyHeatToPace(pace, 80, 13.1, 'mid_pack', { dewpointF: 70, conditions: 'cloudy', cloudCoverPct: 95 });
    expect(projDelta, `${CITE_SOLAR} · the race projection used to ignore the sun entirely`).toBeGreaterThan(0);
    expect(effortSlowdownPct(clear)).toBeGreaterThan(effortSlowdownPct(overcast));
  });

  it('the dewpoint matters on every surface or on none', () => {
    const pace = HALF.durationS! / 13.1;
    const humid = applyHeatToPace(pace, 80, 13.1, 'mid_pack', { dewpointF: 74, conditions: 'cloudy', cloudCoverPct: 95 });
    const dry = applyHeatToPace(pace, 80, 13.1, 'mid_pack', { dewpointF: 50, conditions: 'cloudy', cloudCoverPct: 95 });
    expect(humid, `${CITE_DEW} · the race projection used to drop the dewpoint on the floor`).toBeGreaterThan(dry);
  });
});

describe('HEAT-M3 · the band taxonomy is the WBGT flag table', () => {
  it('72°F no longer means two different things on two surfaces', () => {
    // The reported contradiction: server "hot" (60/70/80 on Tair), phone
    // "warm" (60/75/85). Doctrine asks a different question entirely.
    const conditions = { tairF: 72, humidityPct: 50, cloudCoverPct: 90 };
    const wbgt = wbgtApproxF(72, 50, 90)!;
    expect(wbgt, `${CITE_WBGT} · 72 − (100−50)/5 + 0`).toBeCloseTo(62, 6);
    const reading = heatBandForConditions(conditions);
    expect(reading.flag, `${CITE_WBGT} · 50-64 is green, "Low risk. Normal sessions."`).toBe('green');
    expect(reading.band).toBe('neutral');
    // And the same conditions read the same way through the verdict engine.
    expect(judgeWeather({ tempF: 72, humidityPct: 50, cloudCoverPct: 90 }).heatBand).toBe(reading.band);
  });

  it('every flag maps to exactly one word, and unknown maps to none', () => {
    expect(heatBandForFlag('white')).toBe('neutral');
    expect(heatBandForFlag('green')).toBe('neutral');
    expect(heatBandForFlag('yellow'), `${CITE_WBGT} · "Moderate risk"`).toBe('warm');
    expect(heatBandForFlag('red'), `${CITE_WBGT} · "High risk"`).toBe('hot');
    expect(heatBandForFlag('black'), `${CITE_WBGT} · "Extreme risk"`).toBe('extreme');
    expect(heatBandForFlag('unknown'), 'a missing input must read as missing, never as neutral').toBeNull();
  });

  it('a surface that cannot compute WBGT degrades explicitly', () => {
    const noHumidity = heatBandForConditions({ tairF: 88, humidityPct: null });
    expect(noHumidity.wbgtF, 'WBGT needs humidity').toBeNull();
    expect(noHumidity.flag).toBe('unknown');
    expect(
      noHumidity.band,
      'the explicit degrade · say the temperature, do not invent a parallel scale',
    ).toBeNull();
    // And the verdict engine passes that null through rather than filling it.
    expect(judgeWeather({ tempF: 88, durationS: 3600 }).heatBand).toBeNull();
  });

  it('the band walks the doctrine table as WBGT climbs', () => {
    const wordAt = (w: number) => heatBandForFlag(flagForWbgt(w).flag);
    expect(wordAt(45), CITE_WBGT).toBe('neutral');   // white  <50
    expect(wordAt(60), CITE_WBGT).toBe('neutral');   // green  50-64
    expect(wordAt(70), CITE_WBGT).toBe('warm');      // yellow 65-72
    expect(wordAt(78), CITE_WBGT).toBe('hot');       // red    73-82
    expect(wordAt(84), CITE_WBGT).toBe('extreme');   // black  83-86
    expect(wordAt(95), CITE_WBGT).toBe('extreme');   // black  >86
  });

  it('risk and pace cost are allowed to disagree · they answer different questions', () => {
    // A dry 72°F morning: green flag (low risk) and a real marathon-scale
    // pace cost. Conflating the two is what produced four taxonomies.
    const dry = judgeWeather({ tempF: 72, humidityPct: 30, conditions: 'cloudy', cloudCoverPct: 90 });
    expect(dry.heatBand).toBe('neutral');
    expect(dry.slowdownPct, CITE_TABLE).toBeGreaterThanOrEqual(4);
    // The runner still gets the advice · silence would be the miscoaching.
    expect(dry.coachTipForNextTime).not.toBeNull();
  });
});

describe('HEAT-M4 · the HR confounder is sourced to a passage that carries a bpm number', () => {
  it('Research/03, not Research/06 §1', () => {
    // The comment used to read "~1 bpm per 1°F above ~60°F (Research/06 §1)".
    // Research/06 §1 is a pace table and carries no bpm claim anywhere.
    expect(HEAT_HR_CONFOUNDER.bandBpm, 'Research/03 §"Limitations and Confounders" · "Heat (≥25°C) | Rises | +5–20 bpm"')
      .toEqual([5, 20]);
    expect(HEAT_HR_CONFOUNDER.thresholdF, 'Research/03 · 25°C is 77°F').toBe(77);
  });

  it('claims nothing below the doctrine threshold, however unusual the day felt', () => {
    // The old code counted degrees above the RUNNER'S baseline, so a 78°F
    // morning for a 70°F runner read "+8 bpm" while its own comment said +18.
    expect(heatHrBumpBpm(70), 'Research/03 gives no heat HR confounder below 25°C').toBe(0);
    expect(heatHrBumpBpm(76)).toBe(0);
    expect(heatHrBumpBpm(77)).toBe(5);
  });

  it('stays inside the stated band at every temperature', () => {
    for (const t of [77, 80, 85, 90, 100, 130]) {
      expect(heatHrBumpBpm(t)).toBeGreaterThanOrEqual(HEAT_HR_CONFOUNDER.bandBpm[0]);
      expect(heatHrBumpBpm(t)).toBeLessThanOrEqual(HEAT_HR_CONFOUNDER.bandBpm[1]);
    }
  });
});
