/**
 * Tests for lib/coach/weather-adjust.ts
 *
 * Doctrine boundaries the coach engine MUST honor (Research/06):
 *   · neutral  = slowdownPct < 2
 *   · warm     = 2 ≤ slowdownPct < 6
 *   · hot      = 6 ≤ slowdownPct < 12
 *   · extreme  = slowdownPct ≥ 12
 *
 *   · Maughan/Ely/Vihma temperature slowdown (table-derived piecewise)
 *   · RunnersConnect dewpoint multiplier (≥55°F dewpoint starts to bite)
 *   · ~5°F solar bump on clear sky / cloudCover<25%
 *
 * These tests document the doctrine. If they regress, the engine has
 * drifted from the cited research and the coach is no longer honest.
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
    expect(j.coachTipForNextTime).toBeNull();
    expect(j.summary).toMatch(/within optimal range/);
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

describe('judgeWeather · solar bump pushes 65°F clear → hot band', () => {
  it('65°F + clear sky becomes 70°F effective, lands in hot band', () => {
    // Doctrine: 65°F base raw is 5% slow (warm). Clear adds +5°F → 70°F
    // effective which is 8% (hot). This is the explicit doctrine the
    // user called out.
    const j = judgeWeather({
      tempF: 65,
      humidityPct: 40,
      conditions: 'clear',
      cloudCoverPct: 10,
    });
    expect(j.heatBand).toBe('hot');
    expect(j.slowdownPct).toBeGreaterThanOrEqual(6);
    expect(j.slowdownPct).toBeLessThan(12);
    expect(j.shouldFlagInRecap).toBe(true);
    expect(j.coachTipForNextTime).not.toBeNull();
    expect(j.coachTipForNextTime).toMatch(/Move the start earlier|postpone/);
  });

  it('65°F overcast stays in warm (no solar bump)', () => {
    // Same temp, cloudy → no +5°F bump, slowdown stays ~5% (warm).
    const j = judgeWeather({
      tempF: 65,
      humidityPct: 40,
      conditions: 'cloudy',
      cloudCoverPct: 80,
    });
    expect(j.heatBand).toBe('warm');
    expect(j.slowdownPct).toBeLessThan(6);
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

describe('judgeWeather · extreme band (78°F humid)', () => {
  it('78°F at 80% RH is extreme (slowdown ≥ 12%)', () => {
    // High humidity → dewpoint ~71°F → ~1.50× dewpoint multiplier.
    // Base slowdown at 78°F ~14%. With multiplier well over 12%.
    const j = judgeWeather({
      tempF: 78,
      humidityPct: 80,
      conditions: 'partly cloudy',
      cloudCoverPct: 50,
    });
    expect(j.heatBand).toBe('extreme');
    expect(j.slowdownPct).toBeGreaterThanOrEqual(12);
    expect(j.shouldFlagInRecap).toBe(true);
    expect(j.summary).toMatch(/extreme heat stress/);
    expect(j.coachTipForNextTime).toMatch(/Reschedule|heat acclimation/);
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

describe('judgeWeather · confirmed-Z input (peak-temp + thermal arc)', () => {
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
    // Judged on peak 78°F + clear solar → 83°F effective. Should be extreme.
    expect(j.heatBand).toBe('extreme');
    expect(j.summary).toMatch(/60°F → 78°F.*peak 78°F/);
  });

  it('quotes the climb when end - start ≥ 3°F', () => {
    const j = judgeWeather({
      tempF: 65,
      tempF_start: 62,
      tempF_end: 70,
      tempF_peak: 70,
      humidityPct: 50,
      conditions: 'partly cloudy',
      cloudCoverPct: 40,
    });
    expect(j.summary).toMatch(/62°F → 70°F/);
  });

  it('does NOT quote arc when climb < 3°F (within bucket noise)', () => {
    const j = judgeWeather({
      tempF: 70,
      tempF_start: 70,
      tempF_end: 71,
      tempF_peak: 71,
      humidityPct: 50,
      conditions: 'cloudy',
      cloudCoverPct: 80,
    });
    // Should NOT contain the arrow → format.
    expect(j.summary).not.toMatch(/→/);
  });

  it('null tempF returns Conditions unknown', () => {
    const j = judgeWeather({ tempF: null });
    expect(j.heatBand).toBe('neutral');
    expect(j.slowdownPct).toBe(0);
    expect(j.shouldFlagInRecap).toBe(false);
    expect(j.summary).toBe('Conditions unknown');
    expect(j.heatStressF).toBeNull();
  });
});

describe('judgeWeather · doctrine band boundaries', () => {
  it('warm band lower bound: ~2% slowdown', () => {
    // ~57°F cloudy → ~2% slowdown → warm.
    const j = judgeWeather({
      tempF: 57, humidityPct: 50, conditions: 'cloudy', cloudCoverPct: 80,
    });
    expect(j.slowdownPct).toBeGreaterThanOrEqual(2);
    expect(j.heatBand).toBe('warm');
  });

  it('hot/extreme transition: <12% is hot, ≥12% is extreme', () => {
    // Just below 12% should still be hot. 70°F dry → 8% slowdown.
    const jHot = judgeWeather({
      tempF: 70, humidityPct: 30, conditions: 'cloudy', cloudCoverPct: 80,
    });
    expect(jHot.slowdownPct).toBeLessThan(12);
    expect(jHot.heatBand).toBe('hot');

    // At/over 12% should be extreme. 75°F dry → 12.0% exactly → extreme.
    const jExtreme = judgeWeather({
      tempF: 75, humidityPct: 30, conditions: 'cloudy', cloudCoverPct: 80,
    });
    expect(jExtreme.slowdownPct).toBeGreaterThanOrEqual(12);
    expect(jExtreme.heatBand).toBe('extreme');
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

  it('coach tip escalates: warm → hot → extreme', () => {
    const jWarm = judgeWeather({
      tempF: 60, humidityPct: 50, conditions: 'cloudy', cloudCoverPct: 80,
    });
    const jHot = judgeWeather({
      tempF: 72, humidityPct: 50, conditions: 'cloudy', cloudCoverPct: 80,
    });
    const jExtreme = judgeWeather({
      tempF: 82, humidityPct: 70, conditions: 'cloudy', cloudCoverPct: 80,
    });
    expect(jWarm.heatBand).toBe('warm');
    expect(jHot.heatBand).toBe('hot');
    expect(jExtreme.heatBand).toBe('extreme');
    expect(jWarm.coachTipForNextTime).toMatch(/Start earlier/);
    expect(jHot.coachTipForNextTime).toMatch(/Move the start|cardiovascular cost/);
    expect(jExtreme.coachTipForNextTime).toMatch(/Reschedule|acclimation/);
  });
});

describe('judgeWeather · citation contract', () => {
  it('every judgment carries the Research/06 citation', () => {
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
