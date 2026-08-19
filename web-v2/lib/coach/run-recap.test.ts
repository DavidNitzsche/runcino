/**
 * Tests for lib/coach/run-recap.ts
 *
 * Doctrine focus:
 *   · HR drift requires ≥4 splits with avgHr to fire (Research/15).
 *   · Heat-aware framing: 'warm' / 'hot' / 'extreme' → heat attributes the
 *     drift to the body cooling itself, not a fitness signal.
 *   · Neutral conditions → fueling/hydration framing.
 *   · conditions_note + coach_tip are null when heat is neutral.
 *   · Dual-key split tolerance: {mile, hr, pace} AND {mile, avgHr,
 *     paceSPerMi} both work.
 *
 * Voice doctrine (David, 2026-05-31): plain runner-English, no PhD jargon
 * ("mitochondrial / cardiovascular drift / lactate threshold" all gone),
 * citations are NOT in the output.
 */

import { describe, it, expect } from 'vitest';
import { deriveRecap, type RecapInput } from './run-recap';
import { resolveRunTerrain } from '@/lib/terrain/run-terrain';

/** An outdoor terrain context, the way a stored row would produce one. */
function terrainOf(o: {
  gainFt: number; lossFt: number; distanceMi?: number; paceSPerMi?: number;
}) {
  const distanceMi = o.distanceMi ?? 6;
  const pace = o.paceSPerMi ?? 480;
  return resolveRunTerrain({
    source: 'watch',
    distanceMi,
    durationSec: distanceMi * pace,
    splits: [{ mile: 1, elev_ft: o.gainFt }, { mile: 2, elev_ft: -o.lossFt }],
  });
}

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
  it('returns verdict + facts + coach_tip + conditions_note (no citations)', () => {
    const r = deriveRecap(baseLongRun);
    expect(typeof r.verdict).toBe('string');
    expect(r.verdict.length).toBeGreaterThan(0);
    expect(Array.isArray(r.facts)).toBe(true);
    expect(r.facts.length).toBeGreaterThanOrEqual(1);
    // coach_tip + conditions_note may be null (that's a valid state).
    expect(r.coach_tip === null || typeof r.coach_tip === 'string').toBe(true);
    expect(r.conditions_note === null || typeof r.conditions_note === 'string').toBe(true);
    // Citations are NOT on the payload (David, 2026-05-31).
    expect((r as unknown as { citations?: unknown }).citations).toBeUndefined();
  });
});

describe('deriveRecap · HR drift detection gate (≥4 splits w/ avgHr)', () => {
  it('does NOT fire HR-drift fact with 3 splits (below threshold)', () => {
    const r = deriveRecap({
      ...baseLongRun,
      splits: makeSplits(3, 150, 170),
    });
    expect(r.facts.join(' ')).not.toMatch(/HR climbed/);
  });

  it('fires HR-drift fact with exactly 4 splits + drift ≥8 bpm', () => {
    const r = deriveRecap({
      ...baseLongRun,
      splits: makeSplits(4, 150, 165),  // 15 bpm drift
    });
    expect(r.facts.join(' ')).toMatch(/HR climbed/);
  });

  it('does NOT fire when drift < 8 bpm (signal too small)', () => {
    const r = deriveRecap({
      ...baseLongRun,
      splits: makeSplits(6, 155, 159),  // 4 bpm drift
    });
    expect(r.facts.join(' ')).not.toMatch(/HR climbed/);
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
    expect(r.facts.join(' ')).not.toMatch(/HR climbed/);
  });
});

describe('deriveRecap · dual-key split tolerance', () => {
  // Canonical wire shape is {mile, hr, pace} but legacy code paths emit
  // {mile, avgHr, paceSPerMi}. Both must work for drift detection.
  it('detects HR drift with canonical {mile, hr, pace} shape', () => {
    const splits = Array.from({ length: 6 }, (_, i) => ({
      mile: i + 1,
      pace: '8:45',
      hr: i < 3 ? 150 : 168,
    }));
    const r = deriveRecap({ ...baseLongRun, splits });
    expect(r.facts.join(' ')).toMatch(/HR climbed/);
  });

  it('detects HR drift with legacy {mile, avgHr, paceSPerMi} shape', () => {
    const r = deriveRecap({
      ...baseLongRun,
      splits: makeSplits(6, 150, 168),
    });
    expect(r.facts.join(' ')).toMatch(/HR climbed/);
  });
});

describe('deriveRecap · heat-aware drift attribution · LONG type', () => {
  const driftingSplits = makeSplits(6, 150, 168);  // 18 bpm drift

  it('HOT heat → drift attributed to body cooling itself, not fitness', () => {
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
    // Heat-attributed framing: "normal in heat", "body works harder to
    // cool itself", "not because you're slowing down".
    expect(text).toMatch(/normal in heat|cool itself|not because you're slowing down/i);
    expect(r.conditions_note).not.toBeNull();
    expect(r.coach_tip).not.toBeNull();
  });

  it('EXTREME heat → drift attributed to heat, not fitness', () => {
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
    expect(r.facts.join(' ')).toMatch(/normal in heat|cool itself|not because you're slowing down/i);
  });

  it('NEUTRAL heat → drift attributed to fuel/water', () => {
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
    expect(text).toMatch(/Usually fuel or water|eating something earlier|drinking more/i);
    // NOT heat-attributed.
    expect(text).not.toMatch(/normal in heat|cool itself/i);
  });

  it('NO weather provided → fuel/water framing', () => {
    const r = deriveRecap({
      ...baseLongRun,
      splits: driftingSplits,
      // weather omitted entirely.
    });
    expect(r.facts.join(' ')).toMatch(/Usually fuel or water|eating something earlier|drinking more/i);
  });

  it('WARM (band) → drift treated as heat-explained too (not just hot/extreme)', () => {
    // Doctrine in run-recap.ts: heatExplainsDrift true for warm/hot/extreme.
    const r = deriveRecap({
      ...baseLongRun,
      splits: driftingSplits,
      weather: {
        tempF: 65,
        humidityPct: 50,
        conditions: 'cloudy',
        cloudCoverPct: 80,
      },
    });
    // 65°F cloudy = 2.5% per the Research/06 mid-pack table → warm band.
    // (2026-06-09 heat re-base: 60°F is 1.5% = neutral under doctrine ·
    // the old 60°F fixture relied on the inflated pre-audit curve.)
    expect(r.facts.join(' ')).toMatch(/normal in heat|cool itself|not because you're slowing down/i);
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
    // New plain-English template: "<temp> · hot for running. Costs you
    // about X% on pace." (or "Started at X°F, climbed to Y°F." when arc
    // is material).
    expect(r.conditions_note).toMatch(/hot for running|seriously hot|Costs you about/);
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
    expect(r.verdict).toBe('Easy done.');
    // Reads the run: actual 9:10 vs 9:00 target = in the easy range (David 2026-06-12).
    expect(r.facts.join(' ')).toMatch(/easy range|aerobic work/);
    expect(r.facts.join(' ')).not.toMatch(/ran past the.*target/);
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
    expect(r.facts.join(' ')).toMatch(/ran past the 145 target.*Slow it down|easy days only work when they're actually easy/);
  });

  it('HR overshoot in HOT conditions → heat-explained, effort right', () => {
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
    expect(r.facts.join(' ')).toMatch(/it was hot.*effort was right|effort was right/);
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
    expect(r.verdict).toBe('Tempo done.');
    // df2e3527 replaced the tempo filler phrase with the factual lead line ·
    // no work-phase or split signal here, so the recap is the totals line.
    expect(r.facts.join(' ')).toContain('Tempo done · 6.0 mi total at 7:35/mi, avg HR 168.');
  });

  it('threshold in hot weather with ≥4% slowdown adds heat-cost fact', () => {
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
    expect(r.facts.join(' ')).toMatch(/heat was costing you about|stimulus was right|ignore the clock/);
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
    expect(r.verdict).toBe('Reps done.');
    // 2026-06-09 · pre-existing stale expectation: the recap rework
    // (216f76c7 / 203358ad) replaced the "Pushed the work bouts /
    // jogged the recoveries" copy with the structured lead line +
    // "Building the top end · these stack." and updated the tempo
    // tests but missed this one. Aligned to the committed copy.
    expect(r.facts.join(' ')).toMatch(/Building the top end|Reps done ·/);
  });

  it('intervals in hot weather: no prospective "go by feel" fact (heat lives in conditions_note)', () => {
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
    // Recap facts describe a finished run · they must not hand out
    // prospective "go by feel" advice. Heat is explained by conditions_note.
    expect(r.facts.join(' ')).not.toMatch(/Go by feel and HR|workout still counted|Heat makes interval pace harder/);
  });

  it('intervals: hot start then settled → pacing fact vs heat-adjusted target + HR guardrail', () => {
    const r = deriveRecap({
      type: 'intervals',
      phase: 'PEAK',
      plannedMi: 7,
      plannedPaceSPerMi: 403, // 6:43
      plannedHrCap: null,
      actualMi: 7,
      actualPaceSPerMi: 405,
      actualAvgHr: 147,
      actualMaxHr: 160,
      repCount: 4,
      repPaces: [400, 398, 412, 410], // 6:40, 6:38 (hot), 6:52, 6:50 (settled)
      splits: makeSplits(6, 145, 150),
      weather: { tempF: 63, humidityPct: 50, conditions: 'clear', cloudCoverPct: 10 },
    });
    // Leads with the RESULT (in-range count), not the prescription.
    expect(r.facts.join(' ')).toMatch(/in range/i);
    // Reads the pattern, not the generic filler · "fast", never "hot".
    expect(r.facts.join(' ')).toMatch(/went out .* fast on the first 2, then settled/i);
    expect(r.facts.join(' ')).not.toMatch(/hot/i);
    expect(r.facts.join(' ')).toMatch(/HR 147/);
    expect(r.facts.join(' ')).not.toMatch(/Building the top end/);
    // Heat-adjusted target is exposed and slower than the raw 6:43.
    expect(r.intervals_adjusted_target_s_per_mi ?? 0).toBeGreaterThan(403);
  });

  it('intervals: fewer reps than prescribed → "did N of M reps" (missed/stopped early)', () => {
    const r = deriveRecap({
      type: 'intervals',
      phase: 'PEAK',
      plannedMi: 7,
      plannedPaceSPerMi: 403,
      plannedHrCap: null,
      actualMi: 5,
      actualPaceSPerMi: 405,
      actualAvgHr: 150,
      actualMaxHr: 165,
      repCount: 3,
      prescribedRepCount: 4,
      repPaces: [402, 405, 410], // only 3 of the 4 planned reps
      splits: makeSplits(5, 148, 156),
      weather: null,
    });
    expect(r.facts.join(' ')).toMatch(/3 of 4 reps/i);
    expect(r.facts.join(' ')).not.toMatch(/All 3 reps in range/);
  });

  it('intervals: no per-rep signal (Strava) → falls back to generic phase line', () => {
    const r = deriveRecap({
      type: 'intervals',
      phase: 'PEAK',
      plannedMi: 7,
      plannedPaceSPerMi: 403,
      plannedHrCap: null,
      actualMi: 7,
      actualPaceSPerMi: 405,
      actualAvgHr: 147,
      actualMaxHr: 160,
      splits: makeSplits(6, 145, 150),
      weather: null,
    });
    expect(r.facts.join(' ')).toMatch(/Building the top end/);
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
    expect(r.verdict).toBe('Legs cleared.');
    expect(r.facts.join(' ')).toMatch(/Recovery jog|blood flow|Box checked/);
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
    expect(r.facts.join(' ')).toMatch(/Race ·/);
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

describe('deriveRecap · plain-English voice doctrine', () => {
  // Voice doctrine (David, 2026-05-31): no PhD jargon on payloads.
  // The engine reads research-grounded rules, but the words shown to
  // the runner are everyday talk.
  const jargonWords = [
    'mitochondrial',
    'lactate threshold',
    'lactate-clearance',
    'VO2max',
    'VO2 stimulus',
    'cardiovascular drift',
    'thermoregulation',
    'thermoregulatory',
    'evaporative cooling',
    'Maughan',
    'Ely',
  ];

  function assertNoJargon(text: string): void {
    const lower = text.toLowerCase();
    for (const word of jargonWords) {
      expect(lower).not.toContain(word.toLowerCase());
    }
  }

  it('long-run payload has no PhD jargon (neutral)', () => {
    const r = deriveRecap(baseLongRun);
    assertNoJargon(r.verdict + ' ' + r.facts.join(' '));
  });

  it('long-run payload has no PhD jargon (hot, with drift)', () => {
    const r = deriveRecap({
      ...baseLongRun,
      splits: makeSplits(6, 150, 168),
      weather: { tempF: 78, humidityPct: 60, conditions: 'clear', cloudCoverPct: 10 },
    });
    const text = r.verdict + ' ' + r.facts.join(' ')
      + ' ' + (r.coach_tip ?? '') + ' ' + (r.conditions_note ?? '');
    assertNoJargon(text);
  });

  it('threshold payload has no PhD jargon (hot)', () => {
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
      weather: { tempF: 78, humidityPct: 60, conditions: 'clear', cloudCoverPct: 10 },
    });
    const text = r.verdict + ' ' + r.facts.join(' ')
      + ' ' + (r.coach_tip ?? '') + ' ' + (r.conditions_note ?? '');
    assertNoJargon(text);
  });

  it('intervals payload has no PhD jargon (hot)', () => {
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
      weather: { tempF: 82, humidityPct: 60, conditions: 'clear', cloudCoverPct: 10 },
    });
    const text = r.verdict + ' ' + r.facts.join(' ')
      + ' ' + (r.coach_tip ?? '') + ' ' + (r.conditions_note ?? '');
    assertNoJargon(text);
  });
});

// ── Terrain · the recap judges effort on grade-adjusted pace ────────────────
//
// 2026-08-17. The bug: a hilly easy run read as "relaxed and well inside easy"
// because the clock was slow, and a net-downhill run read as fitness. The recap
// now compares against the target on grade-adjusted pace and PRINTS the pace
// the runner actually ran. Both numbers appear; they never swap jobs.

describe('deriveRecap · terrain', () => {
  const easyBase: RecapInput = {
    type: 'easy',
    phase: 'BUILD',
    plannedMi: 6,
    plannedPaceSPerMi: 8 * 60 + 20,   // 8:20 easy target
    actualMi: 6,
    actualPaceSPerMi: 9 * 60 + 10,    // 9:10 on the road · 50s "off" the target
    actualAvgHr: 145,
    actualMaxHr: 158,
  };

  it('with no terrain field the output is byte-identical to before', () => {
    const a = deriveRecap(easyBase);
    expect(deriveRecap({ ...easyBase, terrain: null })).toEqual(a);
    // And a genuinely flat run adds nothing either.
    const flat = deriveRecap({ ...easyBase, terrain: terrainOf({ gainFt: 20, lossFt: 20 }) });
    expect(flat.facts).toEqual(a.facts);
  });

  it('a hilly easy run stops reading as "relaxed" and prints the REAL pace', () => {
    // Shaped on David's 2026-07-06: 6 mi with 572 ft of climb, run at 9:10
    // against an 8:20 easy target. Judged flat that effort is worth ~8:40 —
    // inside the easy range, not 50 seconds of loafing.
    const hilly = deriveRecap({
      ...easyBase,
      terrain: terrainOf({ gainFt: 572, lossFt: 60, distanceMi: 6, paceSPerMi: 550 }),
    });
    const text = hilly.facts.join(' ');
    expect(text).toContain('9:10/mi');            // real pace, printed
    expect(text).not.toMatch(/8:4\d/);            // adjusted pace, never printed as pace
    expect(text).toContain('Right in the easy range');
    // Pre-terrain this same run landed in the "Relaxed and well inside easy"
    // branch, which is the mis-read being fixed.
    expect(deriveRecap(easyBase).facts.join(' ')).toContain('Relaxed and well inside easy');
  });

  it('a net-downhill run stops being praised for pace gravity handed over', () => {
    const quick: RecapInput = { ...easyBase, actualPaceSPerMi: 7 * 60 + 40 };
    expect(deriveRecap(quick).facts.join(' ')).toContain('touch quicker');
    const downhill = deriveRecap({
      ...quick,
      terrain: terrainOf({ gainFt: 40, lossFt: 900, distanceMi: 6, paceSPerMi: 460 }),
    });
    const text = downhill.facts.join(' ');
    expect(text).toContain('7:40/mi');                    // real pace still shown
    expect(text).not.toContain('touch quicker');          // no longer flattered
    expect(text).toMatch(/Net downhill gave you/);
  });

  it('a tempo up a hill is not "short of the target"', () => {
    const tempo: RecapInput = {
      type: 'tempo',
      phase: 'BUILD',
      plannedMi: 8,
      plannedPaceSPerMi: 7 * 60 + 44,
      actualMi: 8.15,
      actualPaceSPerMi: 8 * 60 + 3,
      workPaceSPerMi: 8 * 60 + 3,
      actualAvgHr: 149,
      actualMaxHr: 168,
      splits: Array.from({ length: 8 }, (_, i) => ({ mile: i + 1, paceSPerMi: 483 })),
    };
    expect(deriveRecap(tempo).facts.join(' ')).toMatch(/off the|fell short/);
    const onHills = deriveRecap({
      ...tempo,
      terrain: terrainOf({ gainFt: 554, lossFt: 50, distanceMi: 8.15, paceSPerMi: 483 }),
    });
    expect(onHills.facts.join(' ')).not.toMatch(/fell short/);
    expect(onHills.facts.join(' ')).toContain('8:03');   // the pace actually run
  });

  it('a treadmill with an unrecorded incline is not judged against the target', () => {
    const belt = deriveRecap({
      ...easyBase,
      actualPaceSPerMi: 7 * 60 + 40,
      terrain: resolveRunTerrain({ source: 'treadmill', indoor: true, distanceMi: 6, durationSec: 2760 }),
    });
    const text = belt.facts.join(' ');
    expect(text).toContain('7:40/mi');
    expect(text).not.toMatch(/quicker than|Relaxed and well inside/);
    expect(text).toContain('incline not recorded');
  });

  it('a treadmill at the standard 1% belt reads exactly like a flat run', () => {
    // David's 2026-07-15 row, elevGainFt and all.
    const belt = resolveRunTerrain({
      source: 'treadmill', indoor: true, distanceMi: 9.01, durationSec: 4636,
      elevGainFt: 476, elevGainSource: 'treadmill_incline',
      phases: [{ type: 'work', actualInclinePct: 1, actualDistanceMi: 9.01 }],
    });
    const r = deriveRecap({ ...easyBase, terrain: belt });
    const plain = deriveRecap(easyBase);
    expect(r.verdict).toBe(plain.verdict);
    // Same judgement as a flat run · plus one honest sentence about where it
    // happened. No phantom 476 ft hill.
    expect(r.facts.slice(0, plain.facts.length)).toEqual(plain.facts);
    expect(r.facts.join(' ')).toContain('flat-equivalent');
  });

  it('heat and hills together move the interval target ONCE, multiplicatively', () => {
    const base: RecapInput = {
      type: 'intervals', phase: 'BUILD', plannedMi: 6,
      plannedPaceSPerMi: 392, actualMi: 6, actualPaceSPerMi: 470,
      actualAvgHr: 165, actualMaxHr: 180,
      repPaces: [400, 402, 401, 403], repCount: 4,
      weather: { tempF: 82, dewpointF: 66, durationS: 2820 },
    };
    const terrain = terrainOf({ gainFt: 500, lossFt: 60, distanceMi: 6, paceSPerMi: 470 });
    const heatOnly = deriveRecap(base).intervals_adjusted_target_s_per_mi!;
    const both = deriveRecap({ ...base, terrain }).intervals_adjusted_target_s_per_mi!;

    expect(both).toBeGreaterThan(heatOnly);      // hills stack on top of heat
    // Exactly one product: target × heat leg × grade leg, per Research/01
    // §Combined conditions. Within a second of heat-alone scaled by the grade
    // factor (the slack is the integer rounding of heatOnly itself).
    expect(Math.abs(both - heatOnly * terrain.factor)).toBeLessThanOrEqual(1);
    // Applying heat a second time lands somewhere else entirely — that is the
    // double-count this design makes unreachable.
    const doubleCounted = heatOnly * (heatOnly / 392) * terrain.factor;
    expect(doubleCounted - both).toBeGreaterThan(5);
  });
});

/**
 * 2026-08-19 · two things the long-run recap asserted without evidence.
 *
 *   · `|| 'HMP'` named a marathoner's own marathon-pace finish "half-marathon
 *     pace" whenever the workout spec carried no `finish_label`.
 *   · The drift and fade branches blamed fuelling on ANY long run, including a
 *     5K runner's 45-minute one, where Research/18 sets the carbohydrate target
 *     to 0 g/hr and §8 prescribes water only.
 */
describe('LONG RUN · the recap says only what it knows', () => {
  const long = (o: Partial<RecapInput> = {}): RecapInput => ({
    type: 'long', phase: null, plannedMi: 20, actualMi: 20,
    actualPaceSPerMi: 480, actualAvgHr: 148, ...o,
  } as RecapInput);

  it('a missing finish label prints the pace and nothing else', () => {
    const f = deriveRecap(long({ finishMi: 6, finishPaceSPerMi: 412, finishLabel: null })).facts.join(' ');
    expect(f).toContain('6mi @ 6:52');
    expect(f).not.toContain('HMP');
    expect(f).not.toContain('MP');
  });

  it('a spec that says "M" still says MP · the label was never the problem', () => {
    const f = deriveRecap(long({ finishMi: 6, finishPaceSPerMi: 412, finishLabel: 'M' })).facts.join(' ');
    expect(f).toContain('6mi @ MP 6:52');
  });

  it('an "HM" spec still says HMP', () => {
    const f = deriveRecap(long({ finishMi: 4, finishPaceSPerMi: 400, finishLabel: 'HM' })).facts.join(' ');
    expect(f).toContain('HMP');
  });

  /** 5 mi with HR climbing and the last third fading · 45 minutes of running. */
  const fadingSplits = [
    { mile: 1, paceSPerMi: 520, avgHr: 138 },
    { mile: 2, paceSPerMi: 525, avgHr: 142 },
    { mile: 3, paceSPerMi: 530, avgHr: 150 },
    { mile: 4, paceSPerMi: 570, avgHr: 156 },
    { mile: 5, paceSPerMi: 575, avgHr: 158 },
  ];

  it('a 45-minute long run is not told to eat earlier', () => {
    const f = deriveRecap(long({
      plannedMi: 5, actualMi: 5, actualPaceSPerMi: 544,
      actualDurationSec: 45 * 60, actualAvgHr: 149, splits: fadingSplits,
    })).facts.join(' ');
    expect(f).toMatch(/HR climbed \d+ bpm/);      // the observation still lands
    expect(f).not.toMatch(/eating something earlier/);
    expect(f).not.toMatch(/checking your fueling/);
    expect(f).toMatch(/effort, not fuel/);
    expect(f).toMatch(/Too short to be fuel/);
  });

  it('the same run over two hours keeps the fuelling read', () => {
    const f = deriveRecap(long({
      plannedMi: 14, actualMi: 14, actualPaceSPerMi: 514,
      actualDurationSec: 7200, actualAvgHr: 149, splits: fadingSplits,
    })).facts.join(' ');
    expect(f).toMatch(/eating something earlier/);
    expect(f).toMatch(/checking your fueling/);
  });

  it('with no duration on the wire it is derived from distance × pace', () => {
    // 5 mi at 9:04/mi = 45 min · same verdict as the explicit-duration case.
    const f = deriveRecap(long({
      plannedMi: 5, actualMi: 5, actualPaceSPerMi: 544,
      actualAvgHr: 149, splits: fadingSplits,
    })).facts.join(' ');
    expect(f).toMatch(/effort, not fuel/);
  });
});
