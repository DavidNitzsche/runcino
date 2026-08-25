/**
 * lib/postrun-siege/_controls.test.ts · THE POSITIVE CONTROLS.
 *
 * A green harness proves nothing until the harness has been shown to go red.
 * Every check in `invariants.ts` is fed a planted fabrication here — the exact
 * sentence or number a real defect produced — and must name it.
 *
 * This is the same discipline `lib/format/_format_lint.test.ts` applies to the
 * formatters and `lib/conservation/_reader_lint.test.ts` applies to the
 * readers: the defect that started this line of work was a correct function
 * with zero call sites and a passing unit test.
 *
 * If you loosen a check, one of these goes green when it should be red, and
 * the loosening becomes visible instead of silent.
 */
import { describe, it, expect } from 'vitest';
import {
  checkNoDebugTokens, checkCoachVoice, checkNoDistanceInflation,
  checkTripleMultipliesOut, checkZoneShares, checkZoneTableTiles,
  checkElevationReading,
} from './invariants';
import { apportionToHundred, reconcileHrZones } from '@/lib/runs/coherence';
import type { ZoneTable } from '@/lib/training/zones';

/** A zone table with whatever bands the control needs. */
const table = (bands: Array<[number, number]>): ZoneTable => ({
  method: 'lthr-friel',
  anchor: { label: 'LTHR', bpm: 162 },
  citation: 'control',
  zones: bands.map(([lower, upper], i) => ({
    idx: i + 1, label: `Z${i + 1}`, shortLabel: `Z${i + 1}`, lower, upper, purpose: '',
    // The percent edges the band was derived FROM. A control table states them
    // so it is the same shape as a real one — a fixture that omits a field the
    // production type carries tests a type nothing produces.
    loPct: 0, hiPct: 0,
  })),
});

describe('CONTROL · the prose checks catch what shipped', () => {
  it('catches the literal null the recap printed for a refused distance', () => {
    // The real sentence, 2026-08-24, from `Easy ${miNum(input.actualMi)} mi`.
    const v = checkNoDebugTokens(['Easy null mi. Run by feel · the right way to take an easy day.']);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('null');
  });

  it('catches undefined, NaN and a stringified object', () => {
    expect(checkNoDebugTokens(['Long run done · undefined mi.'])).toHaveLength(1);
    expect(checkNoDebugTokens(['Tempo done · NaN mi total.'])).toHaveLength(1);
    expect(checkNoDebugTokens(['Shoes: [object Object]'])).toHaveLength(1);
  });

  it('does not fire on prose that merely contains those letters', () => {
    expect(checkNoDebugTokens([
      'Easy 5 mi at 9:00/mi. Right in the easy range.',
      'Nullify 4 · 5 mi on them.',              // a shoe named Nullify
      'Held the line · 6:38 dead even',
    ])).toEqual([]);
  });

  it('catches an exclamation mark, an em dash and an emoji', () => {
    expect(checkCoachVoice(['Great work today!'])).toHaveLength(1);
    expect(checkCoachVoice(['Long run done — kept it aerobic.'])).toHaveLength(1);
    expect(checkCoachVoice(['Long run done 🏃 kept it aerobic.'])).toHaveLength(1);
  });

  it('passes the voice the app actually writes', () => {
    expect(checkCoachVoice([
      'Long run done · 18 mi · avg HR 148 · kept it aerobic.',
      'Ran 12s/mi under the target, and the heart rate went with it.',
      'Held the line · 6:38 dead even',
    ])).toEqual([]);
  });
});

describe('CONTROL · the distance check catches the breakdown that did not add up', () => {
  it('catches a prescribed finish leg longer than the run', () => {
    // The real sentence: a 20-mile long run with a 6-mile marathon-pace
    // finish, abandoned at mile 3.
    const v = checkNoDistanceInflation(
      ['Long run done · 0mi easy + 6mi @ MP 6:40 · avg HR 150.'], 3.0);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('6 mi on a run of 3.00 mi');
  });

  it('catches any stated distance on a row that carries none', () => {
    expect(checkNoDistanceInflation(['Logged · 5 mi at 9:00/mi.'], null)).toHaveLength(1);
  });

  it('does not mistake a pace or a per-mile delta for a distance', () => {
    expect(checkNoDistanceInflation([
      'Easy 5 mi at 9:00/mi. Right in the easy range.',
      'The last third was about 30s/mi slower than the rest.',
      'Ran 12s/mi under the target · that is past threshold, not more of it.',
      'A touch quicker than the 9:22/mi easy target.',
    ], 5.0)).toEqual([]);
  });

  it('allows whole-mile rounding of a real leg but not an invented one', () => {
    // A 5.6-mile finish on a 5.6-mile run legitimately prints "6mi".
    expect(checkNoDistanceInflation(['Long run done · 6mi @ MP 6:40.'], 5.6)).toEqual([]);
    expect(checkNoDistanceInflation(['Long run done · 6mi @ MP 6:40.'], 5.4)).toHaveLength(1);
  });
});

describe('CONTROL · the arithmetic checks catch the 2026-08-23 poster', () => {
  it('catches 11.0 mi in 1:28:18 at 3:37/mi', () => {
    const v = checkTripleMultipliesOut({ distanceMi: 11.01, timeSec: 5298, paceSecPerMi: 217 });
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('the clock says 5298s');
  });

  it('passes the same run read coherently', () => {
    expect(checkTripleMultipliesOut({
      distanceMi: 11.01, timeSec: 5298, paceSecPerMi: 5298 / 11.01,
    })).toEqual([]);
  });

  it('says nothing when a member is absent · a refusal is not a contradiction', () => {
    expect(checkTripleMultipliesOut({ distanceMi: 11.01, timeSec: null, paceSecPerMi: null }))
      .toEqual([]);
  });
});

describe('CONTROL · the zone checks catch both distribution defects', () => {
  it('catches the stored 99 that left a gap at the end of the bar', () => {
    const v = checkZoneShares({ z1: 15, z2: 37, z3: 21, z4: 12, z5: 14 });
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('sum to 99');
  });

  it('catches five zeros beside a measured average', () => {
    expect(checkZoneShares({ z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 })).toHaveLength(1);
  });

  it('catches a fractional or negative share', () => {
    expect(checkZoneShares({ z1: 20.5, z2: 20, z3: 20, z4: 20, z5: 19.5 }).length)
      .toBeGreaterThan(0);
    expect(checkZoneShares({ z1: -10, z2: 40, z3: 30, z4: 20, z5: 20 }).length)
      .toBeGreaterThan(0);
  });

  it('refuses a set carrying a negative share rather than clamping it away', () => {
    // The clamp made `{-10, 40, 30, 20, 20}` come back as `{0, 36, 28, 18, 18}`
    // — five plausible percentages that are neither what the row carried nor a
    // correction of it.
    expect(apportionToHundred([-10, 40, 30, 20, 20])).toBeNull();
    expect(reconcileHrZones({
      avgHr: 140, hrZonePcts: { z1: -10, z2: 40, z3: 30, z4: 20, z5: 20 },
    } as never)).toBeNull();
    // A zero share is still a share, and a real set still apportions.
    expect(checkZoneShares(
      (() => { const a = apportionToHundred([0, 40, 30, 20, 20])!;
               return { z1: a[0], z2: a[1], z3: a[2], z4: a[3], z5: a[4] }; })(),
    )).toEqual([]);
  });

  it('accepts a real distribution and an honest absence', () => {
    expect(checkZoneShares({ z1: 15, z2: 38, z3: 21, z4: 12, z5: 14 })).toEqual([]);
    expect(checkZoneShares(null)).toEqual([]);
  });

  it('catches the band table that shipped · a gap and an overlap in one row', () => {
    // The real bands at LTHR 162 before 2026-08-24.
    const v = checkZoneTableTiles(table([[0, 138], [138, 144], [146, 152], [154, 160], [162, 178]]));
    expect(v).toHaveLength(4);
    expect(v.join(' ')).toContain('overlap');
    expect(v.join(' ')).toContain('gap');
  });

  it('accepts bands that tile', () => {
    expect(checkZoneTableTiles(table([[0, 137], [138, 145], [146, 153], [154, 161], [162, 178]])))
      .toEqual([]);
  });
});

describe('CONTROL · the elevation check catches a figure wearing a measurement', () => {
  const trusted = ['raw', 'treadmill_incline'];

  it('catches a GPS-derived climb presented as measured', () => {
    const v = checkElevationReading({ ft: 3195, source: 'gps_derived', measured: true }, trusted);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('gps_derived');
  });

  it('catches a negative gain', () => {
    expect(checkElevationReading({ ft: -420, source: 'raw', measured: true }, trusted))
      .toHaveLength(1);
  });

  it('accepts a barometric reading and an honest refusal', () => {
    expect(checkElevationReading({ ft: 94, source: 'raw', measured: true }, trusted)).toEqual([]);
    expect(checkElevationReading({ ft: 3195, source: 'gps_derived', measured: false }, trusted))
      .toEqual([]);
    expect(checkElevationReading(null, trusted)).toEqual([]);
  });
});
