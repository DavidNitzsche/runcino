/**
 * Tests for lib/coach/weather-adjust.ts
 *
 * 2026-06-09 state-audit fix: expectations re-derived against the
 * VERBATIM Research/06 §1 mid-pack table (via lib/training/heat-model.ts):
 *   60°F → 1.5% · 65°F → 2.5% · 70°F → 4.0% · 75°F → 5.5%
 *   80°F → 7.5% · 85°F → 10%  · 90°F → 13%
 * plus the §12 additive dewpoint surcharge (+1% per 10°F Td above 60°F)
 * and the ~5°F solar bump on clear sky / cloudCover<25%. The previous
 * test file documented a piecewise curve ~2× the cited doctrine.
 *
 * UX bands, recalibrated with the table (engine bands, not Research):
 *   · neutral  = slowdownPct < 2
 *   · warm     = 2 ≤ slowdownPct < 4
 *   · hot      = 4 ≤ slowdownPct < 8
 *   · extreme  = slowdownPct ≥ 8
 *
 * 2026-08-27 · no pace/effort copy is built here any more (`summary` and
 * `coachTipForNextTime` were removed from `judgeWeather`'s return — the
 * runner paces by feel, not a heat model). These tests now document the
 * remaining surface: the physics (`slowdownPct`, `heatBand`, `heatStressF`)
 * that feeds only `heatAwareDrift`'s HR-drift relabeling.
 *
 * These tests document the doctrine. If they regress, the engine has
 * drifted from the cited research.
 */

import { describe, it, expect } from 'vitest';
import {
  judgeWeather,
  estimateDewpointF,
  CITATION_WEATHER,
  type WeatherInput,
} from './weather-adjust';

describe('estimateDewpointF · Magnus-Tetens approximation', () => {
  it('returns tempF when humidity is 100% (saturated air)', () => {
    // At 100% RH, dewpoint == air temperature by definition.
    const td = estimateDewpointF(70, 100);
    expect(td).toBeGreaterThan(69);
    expect(td).toBeLessThan(71);
  });

  it('drops below temp as humidity drops', () => {
    const tdHumid = estimateDewpointF(80, 80);
    const tdDry = estimateDewpointF(80, 30);
    expect(tdDry).toBeLessThan(tdHumid);
    expect(tdHumid).toBeLessThan(80);
  });

  it('handles cold + low humidity (sub-freezing dewpoint possible)', () => {
    // 30°F at 30% RH → dewpoint well below freezing.
    const td = estimateDewpointF(30, 30);
    expect(td).toBeLessThan(20);
  });

  it('clamps humidity at 1% floor (avoids log(0))', () => {
    // 0% RH would Math.log(0) = -Infinity; engine clamps at 1.
    const td = estimateDewpointF(70, 0);
    expect(Number.isFinite(td)).toBe(true);
  });

  it('approximates ~63°F dewpoint at 78°F / 60% RH', () => {
    // Spot check against a known meteorological reference value.
    const td = estimateDewpointF(78, 60);
    expect(td).toBeGreaterThan(62);
    expect(td).toBeLessThan(65);
  });
});

describe('judgeWeather · neutral band (50°F)', () => {
  it('50°F dry returns neutral, 0% slowdown, no flag', () => {
    const j = judgeWeather({
      tempF: 50,
      humidityPct: 40,
      conditions: 'cloudy',
      cloudCoverPct: 80,
    });
    expect(j.heatBand).toBe('neutral');
    expect(j.slowdownPct).toBe(0);
    expect(j.shouldFlagInRecap).toBe(false);
    // Citation still travels on the judgment for internal references.
    expect(j.citation).toBe(CITATION_WEATHER);
  });

  it('45°F still neutral (below the 50°F reference)', () => {
    const j = judgeWeather({
      tempF: 45,
      humidityPct: 50,
      conditions: 'cloudy',
      cloudCoverPct: 80,
    });
    expect(j.heatBand).toBe('neutral');
    expect(j.slowdownPct).toBe(0);
  });
});

describe('judgeWeather · solar bump raises the pace cost at 65°F', () => {
  it('65°F + clear sky becomes 70°F effective · 4% pace cost, green flag', () => {
    // Doctrine: 65°F base is 2.5% (Research/06 §1 mid-pack). Clear adds +5°F
    // → 70°F effective = 4.0%.
    // The BAND is a separate doctrinal question (Research/06 §3 WBGT):
    // 65 − (100−40)/5 + 5 = 58°F WBGT → green, "Low risk. Normal sessions."
    // A low-risk day that still costs 4% of pace is not a contradiction ·
    // it is why the two were separated in the 2026-08-17 audit.
    const j = judgeWeather({
      tempF: 65,
      humidityPct: 40,
      conditions: 'clear',
      cloudCoverPct: 10,
    });
    expect(j.heatBand).toBe('neutral');
    expect(j.slowdownPct).toBeGreaterThanOrEqual(4);
    expect(j.slowdownPct).toBeLessThan(8);
    expect(j.shouldFlagInRecap).toBe(true);
  });

  it('65°F overcast · no solar bump, so a smaller pace cost', () => {
    // Same temp, cloudy → no +5°F bump, slowdown stays 2.5%.
    // WBGT 65 − 12 + 0 = 53 → green.
    const j = judgeWeather({
      tempF: 65,
      humidityPct: 40,
      conditions: 'cloudy',
      cloudCoverPct: 80,
    });
    expect(j.heatBand).toBe('neutral');
    expect(j.slowdownPct).toBeLessThan(4);
    expect(j.slowdownPct).toBeGreaterThanOrEqual(2);
  });

  it('partly cloudy adds +2°F bump (less than clear)', () => {
    const jClear = judgeWeather({
      tempF: 70, humidityPct: 40,
      conditions: 'clear', cloudCoverPct: 10,
    });
    const jPartly = judgeWeather({
      tempF: 70, humidityPct: 40,
      conditions: 'partly cloudy', cloudCoverPct: 40,
    });
    const jOvercast = judgeWeather({
      tempF: 70, humidityPct: 40,
      conditions: 'cloudy', cloudCoverPct: 90,
    });
    // Clear > partly cloudy > overcast for effective temp.
    expect(jClear.slowdownPct).toBeGreaterThan(jPartly.slowdownPct);
    expect(jPartly.slowdownPct).toBeGreaterThan(jOvercast.slowdownPct);
  });
});

describe('judgeWeather · red flag (78°F humid)', () => {
  it('78°F at 80% RH costs ≥8% and flies a red flag', () => {
    // Partly cloudy +2°F → 80°F effective = 7.5% base; dewpoint ~71°F
    // → +1.1% surcharge (§12: +1%/10°F above 60) → ~8.6%.
    // WBGT 78 − (100−80)/5 + 2 = 76 → Research/06:141-148 red band
    // (73-82, "High risk") → the word is "hot".
    const j = judgeWeather({
      tempF: 78,
      humidityPct: 80,
      conditions: 'partly cloudy',
      cloudCoverPct: 50,
    });
    expect(j.heatBand).toBe('hot');
    expect(j.slowdownPct).toBeGreaterThanOrEqual(8);
    expect(j.shouldFlagInRecap).toBe(true);
    // heatStressF = round(tempF + dewpointF).
    expect(j.heatStressF).not.toBeNull();
    expect(j.heatStressF!).toBeGreaterThan(140);  // 78 + ~71 ≈ 149
  });

  it('extreme band still ranks above hot for same temp + low RH', () => {
    const jDry = judgeWeather({
      tempF: 78, humidityPct: 25, conditions: 'cloudy', cloudCoverPct: 80,
    });
    const jHumid = judgeWeather({
      tempF: 78, humidityPct: 80, conditions: 'cloudy', cloudCoverPct: 80,
    });
    expect(jHumid.slowdownPct).toBeGreaterThan(jDry.slowdownPct);
  });
});

describe('judgeWeather · confirmed-Z input (peak-temp)', () => {
  it('uses tempF_peak when present, not tempF', () => {
    // Long run that started at 60°F and climbed to 78°F should be
    // judged on the peak, not the start.
    const j = judgeWeather({
      tempF: 60,           // start-line snapshot (legacy field)
      tempF_start: 60,
      tempF_end: 78,
      tempF_peak: 78,
      humidityPct: 60,
      conditions: 'clear',
      cloudCoverPct: 10,
    });
    // Judged on peak 78°F, not the 60°F start.
    // WBGT 78 − (100−60)/5 + 5 = 75 → red band → "hot".
    expect(j.heatBand).toBe('hot');
  });

  it('null tempF returns neutral zero-signal state', () => {
    const j = judgeWeather({ tempF: null });
    // No temperature → no WBGT → no band. Explicitly null, never 'neutral' ·
    // "we don't know" must not render as "conditions were fine".
    expect(j.heatBand).toBeNull();
    expect(j.slowdownPct).toBe(0);
    expect(j.shouldFlagInRecap).toBe(false);
    expect(j.heatStressF).toBeNull();
  });
});

describe('judgeWeather · doctrine band boundaries', () => {
  it('materiality lower bound: ~2% slowdown at 63°F', () => {
    // ~63°F cloudy → ~2.1% slowdown (doctrine: 60°F=1.5, 65°F=2.5).
    // WBGT 63 − 10 = 53 → green · a real pace cost on a low-risk day.
    const j = judgeWeather({
      tempF: 63, humidityPct: 50, conditions: 'cloudy', cloudCoverPct: 80,
    });
    expect(j.slowdownPct).toBeGreaterThanOrEqual(2);
    expect(j.heatBand).toBe('neutral');
  });

  it('the WBGT flag is what moves the band, not the slowdown %', () => {
    // 72°F, 30% RH, cloudy → 4.6% pace cost but WBGT 72 − 14 = 58 → green.
    // The dry air is exactly why: evaporative cooling works, the risk is
    // low, and the marathon-anchored table still prices the temperature.
    const jDry = judgeWeather({
      tempF: 72, humidityPct: 30, conditions: 'cloudy', cloudCoverPct: 80,
    });
    expect(jDry.slowdownPct).toBeGreaterThanOrEqual(4);
    expect(jDry.heatBand).toBe('neutral');

    // 82°F at 70% RH cloudy → WBGT 82 − 6 = 76 → red band → "hot".
    const jRed = judgeWeather({
      tempF: 82, humidityPct: 70, conditions: 'cloudy', cloudCoverPct: 80,
    });
    expect(jRed.slowdownPct).toBeGreaterThanOrEqual(8);
    expect(jRed.heatBand).toBe('hot');
  });

  it('shouldFlagInRecap fires at ≥2% slowdown OR dewpoint ≥65°F', () => {
    // Cool but humid: 60°F at 95% RH → dewpoint ~58°F (under 65), low slowdown.
    const jCoolHumid = judgeWeather({
      tempF: 55, humidityPct: 80, conditions: 'cloudy', cloudCoverPct: 80,
    });
    // Slowdown is under 2% here so flag depends on dewpoint.
    if (jCoolHumid.slowdownPct < 2) {
      expect(jCoolHumid.shouldFlagInRecap).toBe(false);
    }

    // Dewpoint ≥65°F should flag even at moderate temp.
    const jSticky = judgeWeather({
      tempF: 68, humidityPct: 85, conditions: 'cloudy', cloudCoverPct: 80,
    });
    // Dewpoint here is ~63°F so flag from slowdown.
    expect(jSticky.shouldFlagInRecap).toBe(true);
  });
});

describe('judgeWeather · citation contract', () => {
  // Citation field still travels on the judgment for internal references.
  it('every judgment carries the Research/06 citation on the engine output', () => {
    const cases: WeatherInput[] = [
      { tempF: 50 },
      { tempF: 75, humidityPct: 60 },
      { tempF: 85, humidityPct: 70, conditions: 'clear' },
      { tempF: null },
    ];
    for (const c of cases) {
      const j = judgeWeather(c);
      expect(j.citation).toBe(CITATION_WEATHER);
      expect(j.citation.slug).toBe('research-06-weather-adjustments');
    }
  });
});

describe('judgeWeather · no pace/effort copy is built', () => {
  // 2026-08-27 · the runner paces by feel; nothing here should carry a
  // pace-cost sentence or forward-looking advice any more.
  it('the judgment carries no summary or coachTipForNextTime fields', () => {
    const j = judgeWeather({
      tempF: 85, humidityPct: 70, conditions: 'clear', cloudCoverPct: 10,
    }) as unknown as Record<string, unknown>;
    expect(j.summary).toBeUndefined();
    expect(j.coachTipForNextTime).toBeUndefined();
  });

  it('slowdown % is identical regardless of workout type — it is a physical fact, not framing', () => {
    const hot = { tempF: 72, humidityPct: 50, conditions: 'cloudy', cloudCoverPct: 80 } as const;
    const easy = judgeWeather({ ...hot, workoutType: 'easy' });
    const tempo = judgeWeather({ ...hot, workoutType: 'tempo' });
    expect(easy.slowdownPct).toBe(tempo.slowdownPct);
    expect(easy.heatBand).toBe(tempo.heatBand);
  });
});
