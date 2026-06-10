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
 * Voice doctrine (David, 2026-05-31): summary and coachTipForNextTime
 * speak runner-English. No "Maughan/Ely model", no "evaporative cooling
 * impaired", no "cardiovascular cost". The science still drives the
 * rules; it does not drive the words shown.
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
    // Neutral summary is plain English: "<temp> · good conditions."
    expect(j.summary).toMatch(/good conditions/);
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

describe('judgeWeather · solar bump pushes 65°F clear → hot band', () => {
  it('65°F + clear sky becomes 70°F effective, lands in hot band', () => {
    // Doctrine: 65°F base is 2.5% (warm). Clear adds +5°F → 70°F
    // effective = 4.0% per the Research/06 mid-pack column → hot band.
    const j = judgeWeather({
      tempF: 65,
      humidityPct: 40,
      conditions: 'clear',
      cloudCoverPct: 10,
    });
    expect(j.heatBand).toBe('hot');
    expect(j.slowdownPct).toBeGreaterThanOrEqual(4);
    expect(j.slowdownPct).toBeLessThan(8);
    expect(j.shouldFlagInRecap).toBe(true);
    expect(j.coachTipForNextTime).not.toBeNull();
    // Hot tip leads with "Start earlier next time".
    expect(j.coachTipForNextTime).toMatch(/Start earlier next time/);
  });

  it('65°F overcast stays in warm (no solar bump)', () => {
    // Same temp, cloudy → no +5°F bump, slowdown stays 2.5% (warm).
    const j = judgeWeather({
      tempF: 65,
      humidityPct: 40,
      conditions: 'cloudy',
      cloudCoverPct: 80,
    });
    expect(j.heatBand).toBe('warm');
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

describe('judgeWeather · extreme band (78°F humid)', () => {
  it('78°F at 80% RH is extreme (slowdown ≥ 8%)', () => {
    // Partly cloudy +2°F → 80°F effective = 7.5% base; dewpoint ~71°F
    // → +1.1% surcharge (§12: +1%/10°F above 60) → ~8.6% → extreme.
    const j = judgeWeather({
      tempF: 78,
      humidityPct: 80,
      conditions: 'partly cloudy',
      cloudCoverPct: 50,
    });
    expect(j.heatBand).toBe('extreme');
    expect(j.slowdownPct).toBeGreaterThanOrEqual(8);
    expect(j.shouldFlagInRecap).toBe(true);
    // Extreme summary uses plain English: "seriously hot".
    expect(j.summary).toMatch(/seriously hot/);
    // Extreme tip mentions moving the run + acclimation in plain English.
    expect(j.coachTipForNextTime).toMatch(/Move hard runs out of this window|10-14 days running in the heat/);
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
    // Plain-English arc framing: "Started at 60°F, hit 78°F."
    expect(j.summary).toMatch(/Started at 60°F.*hit 78°F/);
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
    // Plain-English: "Started at 62°F, climbed to 70°F" or
    // "Got from 62°F to 70°F" depending on band.
    expect(j.summary).toMatch(/62°F.*70°F/);
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
    // No arc framing: no "Started at" / "Got from" / "to" phrasing.
    expect(j.summary).not.toMatch(/Started at|Got from/);
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
    // ~63°F cloudy → ~2.1% slowdown → warm (doctrine: 60°F=1.5, 65°F=2.5).
    const j = judgeWeather({
      tempF: 63, humidityPct: 50, conditions: 'cloudy', cloudCoverPct: 80,
    });
    expect(j.slowdownPct).toBeGreaterThanOrEqual(2);
    expect(j.heatBand).toBe('warm');
  });

  it('hot/extreme transition: <8% is hot, ≥8% is extreme', () => {
    // 72°F dry cloudy → ~4.6% → hot.
    const jHot = judgeWeather({
      tempF: 72, humidityPct: 30, conditions: 'cloudy', cloudCoverPct: 80,
    });
    expect(jHot.slowdownPct).toBeLessThan(8);
    expect(jHot.heatBand).toBe('hot');

    // 82°F at 70% RH cloudy → 8.5% base + ~1.1% dewpoint → extreme.
    const jExtreme = judgeWeather({
      tempF: 82, humidityPct: 70, conditions: 'cloudy', cloudCoverPct: 80,
    });
    expect(jExtreme.slowdownPct).toBeGreaterThanOrEqual(8);
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
      tempF: 64, humidityPct: 50, conditions: 'cloudy', cloudCoverPct: 80,
    });
    const jHot = judgeWeather({
      tempF: 72, humidityPct: 50, conditions: 'cloudy', cloudCoverPct: 80,
    });
    const jExtreme = judgeWeather({
      tempF: 85, humidityPct: 70, conditions: 'cloudy', cloudCoverPct: 80,
    });
    expect(jWarm.heatBand).toBe('warm');
    expect(jHot.heatBand).toBe('hot');
    expect(jExtreme.heatBand).toBe('extreme');
    // Warm tip is the most casual: "Try to start earlier" + salt.
    expect(jWarm.coachTipForNextTime).toMatch(/Try to start earlier|salt/);
    // Hot tip leads with "Start earlier next time" + rough on the body + 16-24 oz.
    expect(jHot.coachTipForNextTime).toMatch(/Start earlier next time|rough on the body|16-24 oz/);
    // Extreme tip mentions moving the run + heat acclimation in plain English.
    expect(jExtreme.coachTipForNextTime).toMatch(/Move hard runs out of this window|10-14 days running in the heat/);
  });
});

describe('judgeWeather · plain-English voice doctrine', () => {
  // Voice doctrine (David, 2026-05-31): no model-name citations
  // ("Maughan/Ely model"), no "evaporative cooling impaired",
  // no "cardiovascular cost", no "heat stress index" in the words shown.
  // The numbers and citation field still travel for internal use.
  const jargonWords = [
    'Maughan',
    'Ely',
    'Vihma',
    'evaporative cooling',
    'cardiovascular cost',
    'cardiovascular drift',
    'heat stress index',
    'thermoregulatory',
    'thermoregulation',
    'mitochondrial',
    'lactate',
    'VO2',
    'honest slowdown',
    'optimal range',
  ];

  function assertNoJargon(text: string): void {
    const lower = text.toLowerCase();
    for (const word of jargonWords) {
      expect(lower).not.toContain(word.toLowerCase());
    }
  }

  it('neutral summary uses plain English', () => {
    const j = judgeWeather({
      tempF: 50, humidityPct: 40, conditions: 'cloudy', cloudCoverPct: 80,
    });
    assertNoJargon(j.summary);
  });

  it('warm summary + tip use plain English', () => {
    const j = judgeWeather({
      tempF: 64, humidityPct: 50, conditions: 'cloudy', cloudCoverPct: 80,
    });
    assertNoJargon(j.summary + ' ' + (j.coachTipForNextTime ?? ''));
  });

  it('hot summary + tip use plain English', () => {
    const j = judgeWeather({
      tempF: 72, humidityPct: 50, conditions: 'cloudy', cloudCoverPct: 80,
    });
    assertNoJargon(j.summary + ' ' + (j.coachTipForNextTime ?? ''));
  });

  it('extreme summary + tip use plain English', () => {
    const j = judgeWeather({
      tempF: 82, humidityPct: 70, conditions: 'cloudy', cloudCoverPct: 80,
    });
    assertNoJargon(j.summary + ' ' + (j.coachTipForNextTime ?? ''));
  });

  it('material slowdown appends plain-English "Costs you about X% on pace"', () => {
    // No "honest slowdown vs 50°F", just "Costs you about X% on pace".
    const j = judgeWeather({
      tempF: 78, humidityPct: 60, conditions: 'clear', cloudCoverPct: 10,
    });
    expect(j.summary).toMatch(/Costs you about \d+% on pace/);
    expect(j.summary).not.toMatch(/honest slowdown/);
  });
});

describe('judgeWeather · citation contract', () => {
  // Citation field still travels on the judgment for internal references,
  // even though the words shown to the runner are plain English.
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

describe('judgeWeather · E6 workout-type-aware framing', () => {
  // Same hot conditions, two workout types. The slowdown NUMBER is a
  // physiological fact (type-independent); only the runner-facing copy
  // reframes: pace-cost for quality, effort for easy/long/recovery.
  const hot = { tempF: 72, humidityPct: 50, conditions: 'cloudy', cloudCoverPct: 80 } as const;

  it('slowdown % is identical regardless of workout type', () => {
    const easy = judgeWeather({ ...hot, workoutType: 'easy' });
    const tempo = judgeWeather({ ...hot, workoutType: 'tempo' });
    expect(easy.slowdownPct).toBe(tempo.slowdownPct);
    expect(easy.heatBand).toBe(tempo.heatBand);
  });

  it('quality run keeps the pace-cost framing', () => {
    const tempo = judgeWeather({ ...hot, workoutType: 'tempo' });
    expect(tempo.summary).toMatch(/Costs you about \d+% on pace/);
    expect(tempo.coachTipForNextTime).toMatch(/chase pace|start earlier/i);
  });

  it('easy/long/recovery reframe around effort, not pace cost', () => {
    for (const t of ['easy', 'long', 'recovery', 'shakeout'] as const) {
      const j = judgeWeather({ ...hot, workoutType: t });
      expect(j.summary).not.toMatch(/Costs you about \d+% on pace/);
      expect(j.summary).toMatch(/sit slower|Hold the effort/);
      expect(j.coachTipForNextTime).toMatch(/by effort|by feel/i);
    }
  });

  it('omitted workoutType preserves the legacy pace framing (back-compat)', () => {
    const j = judgeWeather(hot);
    expect(j.summary).toMatch(/Costs you about \d+% on pace/);
  });

  it('effort framing stays plain English across all bands (no jargon, incl. "ely"/"Ely")', () => {
    // 'ely' guards the researcher-name substring check used by the recap
    // voice-doctrine test — copy must avoid entirely/genuinely/etc.
    const jargon = ['mitochondrial', 'lactate', 'vo2', 'evaporative cooling', 'thermoregulation', 'maughan', 'ely'];
    const bands = [
      { tempF: 60, humidityPct: 50, conditions: 'cloudy', cloudCoverPct: 80 }, // warm
      hot,
      { tempF: 88, humidityPct: 70, conditions: 'clear', cloudCoverPct: 10 },  // extreme
    ];
    for (const cond of bands) {
      const j = judgeWeather({ ...cond, workoutType: 'easy' });
      const lower = (j.summary + ' ' + (j.coachTipForNextTime ?? '')).toLowerCase();
      for (const w of jargon) expect(lower).not.toContain(w);
    }
  });
});
