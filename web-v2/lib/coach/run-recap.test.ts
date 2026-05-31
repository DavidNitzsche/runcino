/**
 * Tests for lib/coach/run-recap.ts
 *
 * Doctrine focus:
 *   · HR drift requires ≥4 splits with avgHr to fire (Research/15).
 *   · Heat-aware framing: 'hot' / 'extreme' → thermoregulation framing.
 *   · Neutral conditions → fueling/hydration framing.
 *   · conditions_note + coach_tip are null when heat is neutral.
 *
 * Tests document the exact split-count gate (the "4" is in detectHrDrift).
 */

import { describe, it, expect } from 'vitest';
import { deriveRecap, type RecapInput } from './run-recap';

const baseLongRun: RecapInput = {
  type: 'long',
  phase: 'BUILD',
  plannedMi: 16,
  plannedPaceSPerMi: 8 * 60 + 30,
  plannedHrCap: 160,
  actualMi: 16,
  actualPaceSPerMi: 8 * 60 + 45,
  actualAvgHr: 158,
  actualMaxHr: 172,
};

/**
 * Build splits[] with avgHr ramped from `firstHalfHr` to `secondHalfHr`
 * over `nSplits` segments. Used to feed detectHrDrift.
 */
function makeSplits(
  nSplits: number,
  firstHalfHr: number,
  secondHalfHr: number,
  paceSPerMi = 8 * 60 + 45,
): RecapInput['splits'] {
  const half = Math.floor(nSplits / 2);
  return Array.from({ length: nSplits }, (_, i) => ({
    mile: i + 1,
    paceSPerMi,
    avgHr: i < half ? firstHalfHr : secondHalfHr,
  }));
}

describe('deriveRecap · payload shape', () => {
  it('returns verdict + facts + coach_tip + conditions_note + citations', () => {
    const r = deriveRecap(baseLongRun);
    expect(typeof r.verdict).toBe('string');
    expect(r.verdict.length).toBeGreaterThan(0);
    expect(Array.isArray(r.facts)).toBe(true);
    expect(r.facts.length).toBeGreaterThanOrEqual(1);
    // coach_tip + conditions_note may be null (that's a valid state).
    expect(r.coach_tip === null || typeof r.coach_tip === 'string').toBe(true);
    expect(r.conditions_note === null || typeof r.conditions_note === 'string').toBe(true);
    expect(Array.isArray(r.citations)).toBe(true);
    expect(r.citations.length).toBeGreaterThanOrEqual(1);
  });
});

describe('deriveRecap · HR drift detection gate (≥4 splits w/ avgHr)', () => {
  it('does NOT fire HR-drift fact with 3 splits (below threshold)', () => {
    const r = deriveRecap({
      ...baseLongRun,
      splits: makeSplits(3, 150, 170),
    });
    expect(r.facts.join(' ')).not.toMatch(/HR (climbed|drifted)/);
  });

  it('fires HR-drift fact with exactly 4 splits + drift ≥8 bpm', () => {
    const r = deriveRecap({
      ...baseLongRun,
      splits: makeSplits(4, 150, 165),  // 15 bpm drift
    });
    expect(r.facts.join(' ')).toMatch(/HR (climbed|drifted)/);
  });

  it('does NOT fire when drift < 8 bpm (signal too small)', () => {
    const r = deriveRecap({
      ...baseLongRun,
      splits: makeSplits(6, 155, 159),  // 4 bpm drift
    });
    expect(r.facts.join(' ')).not.toMatch(/HR (climbed|drifted)/);
  });

  it('skips splits that lack avgHr (need 4 with HR, not just 4 splits)', () => {
    // 6 splits but only 3 have avgHr → drift detector should pass.
    const splits = [
      { mile: 1, paceSPerMi: 525, avgHr: 150 },
      { mile: 2, paceSPerMi: 525, avgHr: null },
      { mile: 3, paceSPerMi: 525, avgHr: null },
      { mile: 4, paceSPerMi: 525, avgHr: 165 },
      { mile: 5, paceSPerMi: 525, avgHr: null },
      { mile: 6, paceSPerMi: 525, avgHr: 170 },
    ];
    const r = deriveRecap({ ...baseLongRun, splits });
    expect(r.facts.join(' ')).not.toMatch(/HR (climbed|drifted)/);
  });
});

describe('deriveRecap · heat-aware drift attribution · LONG type', () => {
  const driftingSplits = makeSplits(6, 150, 168);  // 18 bpm drift

  it("HOT heat → drift attributed to thermoregulation ('right thermoregulatory work')", () => {
    const r = deriveRecap({
      ...baseLongRun,
      splits: driftingSplits,
      weather: {
        tempF: 78,
        humidityPct: 50,
        conditions: 'clear',
        cloudCoverPct: 10,
      },
    });
    const text = r.facts.join(' ');
    // Heat-attributed framing.
    expect(text).toMatch(/thermoregulat|expected, not a fitness signal/i);
    expect(r.conditions_note).not.toBeNull();
    expect(r.coach_tip).not.toBeNull();
  });

  it("EXTREME heat → drift attributed to thermoregulation", () => {
    const r = deriveRecap({
      ...baseLongRun,
      splits: driftingSplits,
      weather: {
        tempF: 85,
        humidityPct: 70,
        conditions: 'clear',
        cloudCoverPct: 10,
      },
    });
    expect(r.facts.join(' ')).toMatch(/thermoregulat|expected, not a fitness signal/i);
  });

  it("NEUTRAL heat → drift attributed to fueling/hydration", () => {
    const r = deriveRecap({
      ...baseLongRun,
      splits: driftingSplits,
      weather: {
        tempF: 50,
        humidityPct: 50,
        conditions: 'cloudy',
        cloudCoverPct: 80,
      },
    });
    const text = r.facts.join(' ');
    expect(text).toMatch(/Fueling \+ hydration|fueling cadence/i);
    // NOT heat-attributed.
    expect(text).not.toMatch(/thermoregulat/i);
  });

  it("NO weather provided → fueling/hydration framing", () => {
    const r = deriveRecap({
      ...baseLongRun,
      splits: driftingSplits,
      // weather omitted entirely.
    });
    expect(r.facts.join(' ')).toMatch(/Fueling \+ hydration|fueling cadence/i);
  });

  it("WARM (band) → drift treated as heat-explained too (not just hot/extreme)", () => {
    // Doctrine in run-recap.ts: heatExplainsDrift true for warm/hot/extreme.
    const r = deriveRecap({
      ...baseLongRun,
      splits: driftingSplits,
      weather: {
        tempF: 60,
        humidityPct: 50,
        conditions: 'cloudy',
        cloudCoverPct: 80,
      },
    });
    // 60°F cloudy = warm band (~3% slowdown).
    expect(r.facts.join(' ')).toMatch(/thermoregulat|expected, not a fitness signal/i);
  });
});

describe('deriveRecap · null conditions_note + coach_tip when heat is neutral', () => {
  it('50°F cloudy → conditions_note null + coach_tip null', () => {
    const r = deriveRecap({
      ...baseLongRun,
      weather: {
        tempF: 50,
        humidityPct: 50,
        conditions: 'cloudy',
        cloudCoverPct: 80,
      },
    });
    expect(r.conditions_note).toBeNull();
    expect(r.coach_tip).toBeNull();
  });

  it('no weather input → conditions_note null + coach_tip null', () => {
    const r = deriveRecap(baseLongRun);
    expect(r.conditions_note).toBeNull();
    expect(r.coach_tip).toBeNull();
  });

  it('material heat (hot) → conditions_note + coach_tip both populated', () => {
    const r = deriveRecap({
      ...baseLongRun,
      weather: {
        tempF: 78,
        humidityPct: 60,
        conditions: 'clear',
        cloudCoverPct: 10,
      },
    });
    expect(r.conditions_note).not.toBeNull();
    expect(r.conditions_note).toMatch(/Maughan\/Ely model.*honest slowdown vs 50°F/);
    expect(r.coach_tip).not.toBeNull();
  });
});

describe('deriveRecap · type=easy', () => {
  it('clean easy run: verdict + 1 fact, no overshoot flag', () => {
    const r = deriveRecap({
      type: 'easy',
      phase: 'BASE',
      plannedMi: 6,
      plannedPaceSPerMi: 9 * 60,
      plannedHrCap: 145,
      actualMi: 6.1,
      actualPaceSPerMi: 9 * 60 + 10,
      actualAvgHr: 142,
      actualMaxHr: 152,
    });
    expect(r.verdict).toBe('Banked the easy.');
    expect(r.facts.join(' ')).toMatch(/Aerobic miles in the bank/);
    expect(r.facts.join(' ')).not.toMatch(/drifted past the.*cap/);
  });

  it('HR overshoot (>cap+5) in NEUTRAL conditions → slow-down nudge', () => {
    const r = deriveRecap({
      type: 'easy',
      phase: 'BASE',
      plannedMi: 6,
      plannedPaceSPerMi: 9 * 60,
      plannedHrCap: 145,
      actualMi: 6.1,
      actualPaceSPerMi: 8 * 60 + 30,
      actualAvgHr: 158,  // > 145+5
      actualMaxHr: 168,
      weather: { tempF: 48, conditions: 'cloudy', cloudCoverPct: 80 },
    });
    expect(r.facts.join(' ')).toMatch(/drifted past the 145 cap.*Slow it down/);
  });

  it('HR overshoot in HOT conditions → heat-explained, effort honest', () => {
    const r = deriveRecap({
      type: 'easy',
      phase: 'BASE',
      plannedMi: 6,
      plannedPaceSPerMi: 9 * 60,
      plannedHrCap: 145,
      actualMi: 6.1,
      actualPaceSPerMi: 9 * 60 + 30,
      actualAvgHr: 158,
      actualMaxHr: 168,
      splits: makeSplits(6, 150, 165),  // drifting to qualify heatExplainsDrift
      weather: {
        tempF: 80, humidityPct: 60, conditions: 'clear', cloudCoverPct: 10,
      },
    });
    expect(r.facts.join(' ')).toMatch(/effort was honest/);
  });
});

describe('deriveRecap · type=tempo/threshold', () => {
  it('clean threshold run: verdict + 1 fact', () => {
    const r = deriveRecap({
      type: 'threshold',
      phase: 'BUILD',
      plannedMi: 6,
      plannedPaceSPerMi: 7 * 60 + 30,
      plannedHrCap: 170,
      actualMi: 6,
      actualPaceSPerMi: 7 * 60 + 35,
      actualAvgHr: 168,
      actualMaxHr: 175,
    });
    expect(r.verdict).toBe('Sat on threshold.');
    expect(r.facts.join(' ')).toMatch(/Threshold work landed|Lactate-clearance/);
  });

  it('threshold in hot weather with ≥4% slowdown adds heat-adjusted-pace fact', () => {
    const r = deriveRecap({
      type: 'threshold',
      phase: 'BUILD',
      plannedMi: 6,
      plannedPaceSPerMi: 7 * 60 + 30,
      plannedHrCap: 170,
      actualMi: 6,
      actualPaceSPerMi: 8 * 60 + 5,
      actualAvgHr: 172,
      actualMaxHr: 178,
      splits: makeSplits(6, 165, 175),
      weather: {
        tempF: 78, humidityPct: 60, conditions: 'clear', cloudCoverPct: 10,
      },
    });
    expect(r.facts.join(' ')).toMatch(/Pace targets read|stimulus is the same/);
  });
});

describe('deriveRecap · type=intervals', () => {
  it('clean intervals: verdict + 1 fact', () => {
    const r = deriveRecap({
      type: 'intervals',
      phase: 'PEAK',
      plannedMi: 7,
      plannedPaceSPerMi: 6 * 60 + 30,
      plannedHrCap: null,
      actualMi: 7,
      actualPaceSPerMi: 7 * 60 + 10,
      actualAvgHr: 165,
      actualMaxHr: 184,
    });
    expect(r.verdict).toBe('Emptied the engine.');
    expect(r.facts.join(' ')).toMatch(/VO2 stimulus delivered/);
  });

  it('intervals in hot weather adds "pace by feel" fact', () => {
    const r = deriveRecap({
      type: 'intervals',
      phase: 'PEAK',
      plannedMi: 7,
      plannedPaceSPerMi: 6 * 60 + 30,
      plannedHrCap: null,
      actualMi: 7,
      actualPaceSPerMi: 7 * 60 + 10,
      actualAvgHr: 168,
      actualMaxHr: 186,
      splits: makeSplits(6, 160, 175),
      weather: {
        tempF: 82, humidityPct: 60, conditions: 'clear', cloudCoverPct: 10,
      },
    });
    expect(r.facts.join(' ')).toMatch(/Heat compresses interval splits|pace by feel/);
  });
});

describe('deriveRecap · type=recovery/shakeout/race/default', () => {
  it('recovery: short verdict, no judgment beyond box-checked', () => {
    const r = deriveRecap({
      type: 'recovery',
      phase: 'BUILD',
      plannedMi: 3,
      plannedPaceSPerMi: null,
      plannedHrCap: null,
      actualMi: 3,
      actualPaceSPerMi: 9 * 60 + 30,
      actualAvgHr: 125,
      actualMaxHr: 135,
    });
    expect(r.verdict).toBe('Cleared the legs.');
    expect(r.facts.join(' ')).toMatch(/Recovery miles|Box checked/);
  });

  it('race: race-effort framing', () => {
    const r = deriveRecap({
      type: 'race',
      phase: 'PEAK',
      plannedMi: 26.2,
      plannedPaceSPerMi: 7 * 60 + 30,
      plannedHrCap: null,
      actualMi: 26.2,
      actualPaceSPerMi: 7 * 60 + 40,
      actualAvgHr: 165,
      actualMaxHr: 180,
    });
    expect(r.verdict).toBe('Raced it.');
    expect(r.facts.join(' ')).toMatch(/Race effort.*block's full test/);
  });

  it('unknown type falls back to Logged.', () => {
    const r = deriveRecap({
      type: 'unplanned',
      phase: null,
      plannedMi: 5,
      plannedPaceSPerMi: null,
      plannedHrCap: null,
      actualMi: 5.3,
      actualPaceSPerMi: 9 * 60,
      actualAvgHr: 140,
      actualMaxHr: 150,
    });
    expect(r.verdict).toBe('Logged.');
  });
});

describe('deriveRecap · citations are always present', () => {
  it('every recap includes the workout-vocab citation', () => {
    const r = deriveRecap(baseLongRun);
    const slugs = r.citations.map((c) => c.slug);
    expect(slugs).toContain('research-04-workout-vocabulary');
  });

  it('weather flagged → weather citation included', () => {
    const r = deriveRecap({
      ...baseLongRun,
      weather: {
        tempF: 78, humidityPct: 60, conditions: 'clear', cloudCoverPct: 10,
      },
    });
    const slugs = r.citations.map((c) => c.slug);
    expect(slugs).toContain('research-06-weather-adjustments');
  });

  it('HR drift detected → wearable citation included', () => {
    const r = deriveRecap({
      ...baseLongRun,
      splits: makeSplits(6, 150, 168),
    });
    const slugs = r.citations.map((c) => c.slug);
    expect(slugs).toContain('research-15-wearable-data');
  });
});
