/**
 * lib/runs/run-shape.test.ts
 *
 * Two jobs.
 *
 * 1 · BYTE-EQUIVALENCE. This module was introduced as a refactor, and a
 *     refactor that changes what the app computes is not a refactor. Each SQL
 *     fragment is asserted against the EXACT expression it replaced, copied
 *     from the call site it was lifted out of. If a fragment is ever "tidied",
 *     these fail and the behaviour change becomes a decision instead of an
 *     accident.
 *
 * 2 · THE SIX SPLIT SHAPES. Each shape below is a real key-set measured in the
 *     live table, with real values. The normaliser has to return the same
 *     `NormalizedSplit` for all of them, because the entire point is that no
 *     consumer should have to know which era a row came from.
 */
import { describe, it, expect } from 'vitest';
import {
  runDaySql, runDistanceMiSql, runMovingSecSql, runFinishSecSql,
  runAvgHrSql, runMaxHrSql, runElevGainFtSql, runSplitsSql, runNotMergedSql,
  runDay, runDistanceMi, runMovingSec, runFinishSec, runAvgHr, runMaxHr,
  runElevGainFt, runWorkoutType, isMergedAway,
  normalizeSplits, splitsWithHrAndPace, paceToSec, hrToNum,
  DECOUPLING_SPLIT_SHAPES,
  type RunData,
} from './run-shape';

describe('SQL fragments · byte-equivalent to the expressions they replaced', () => {
  it('runDaySql matches lib/adaptation/load.ts and lib/training/vdot-inputs.ts', () => {
    // load.ts, keySessions join (spaced form)
    expect(runDaySql('r')).toBe("COALESCE(r.data->>'date', LEFT(r.data->>'startLocal', 10))");
    // unaliased form, as in lib/runs/volume.ts
    expect(runDaySql()).toBe("COALESCE(data->>'date', LEFT(data->>'startLocal', 10))");
    // alias may be given with or without the column
    expect(runDaySql('sa.data')).toBe(runDaySql('sa'));
  });

  it('date is preferred over startLocal · the order must never be flipped', () => {
    // 58% of rows carry a Z-suffixed UTC instant in startLocal, so LEFT(...,10)
    // is the UTC day there and rolls an evening run into tomorrow.
    const day = runDaySql('r');
    expect(day.indexOf("'date'")).toBeLessThan(day.indexOf("'startLocal'"));
  });

  it('runDistanceMiSql matches lib/adaptation/load.ts', () => {
    expect(runDistanceMiSql('r')).toBe("(r.data->>'distanceMi')::numeric");
  });

  it('runFinishSecSql prefers MOVING time — a paused clock is not a pace', () => {
    // 2026-08-17 · reordered. This used to put durationSec first, which
    // includes paused time, so every watch-recorded training run entered the
    // VDOT path slower than it was run. One 5.97-mile threshold session
    // carried 305s of pauses and anchored at VDOT 43.6 having been run at
    // ~6:55/mi. Races are unaffected — they never used this ladder.
    expect(runFinishSecSql('sa')).toBe(
      "COALESCE(NULLIF(sa.data->>'movingTimeS','')::numeric, NULLIF(sa.data->>'movingSec','')::numeric, " +
      "NULLIF(sa.data->>'durationSec','')::numeric, NULLIF(sa.data->>'elapsedTimeS','')::numeric)",
    );
  });

  it('runMovingSecSql matches the ladder in lib/coach/recovery-phase.ts', () => {
    expect(runMovingSecSql()).toBe(
      "COALESCE(NULLIF(data->>'movingTimeS','')::numeric, NULLIF(data->>'movingSec','')::numeric, " +
      "NULLIF(data->>'durationSec','')::numeric)",
    );
  });

  it('both ladders now prefer moving time, and neither may regress', () => {
    // They agree on the ordering that matters and differ only in that finish
    // has an elapsedTimeS rung of last resort: a finish time may fall back to
    // wall-clock when nothing better exists, whereas a moving-time reader
    // should return null rather than answer with elapsed.
    for (const sql of [runMovingSecSql('r'), runFinishSecSql('r')]) {
      expect(sql.indexOf('movingTimeS')).toBeLessThan(sql.indexOf('durationSec'));
    }
    expect(runFinishSecSql('r')).toContain('elapsedTimeS');
    expect(runMovingSecSql('r')).not.toContain('elapsedTimeS');
  });

  it('HR and elevation fragments match their call sites', () => {
    expect(runAvgHrSql('sa')).toBe("NULLIF(sa.data->>'avgHr','')::numeric");
    expect(runMaxHrSql()).toBe("NULLIF(data->>'maxHr','')::numeric");
    expect(runElevGainFtSql('sa')).toBe("NULLIF(sa.data->>'elevGainFt','')::numeric");
    expect(runSplitsSql('r')).toBe("r.data->'splits'");
  });

  it('runNotMergedSql tests KEY PRESENCE, not the arrow', () => {
    // `data->'mergedIntoId' IS NULL` classifies a JSON-null marker the
    // opposite way. No row carries that shape today, so the two agree by luck.
    expect(runNotMergedSql('r')).toBe("NOT (r.data ? 'mergedIntoId')");
    expect(runNotMergedSql()).toBe("NOT (data ? 'mergedIntoId')");
  });
});

describe('accessors · null for absent, never a default', () => {
  it('runDay mirrors runDaySql', () => {
    expect(runDay({ date: '2026-06-11', startLocal: '2026-06-12T03:00:00Z' })).toBe('2026-06-11');
    expect(runDay({ startLocal: '2026-06-05T08:35:33' })).toBe('2026-06-05');
    expect(runDay({})).toBeNull();
    expect(runDay({ date: 'not-a-date' })).toBeNull();
  });

  it('missing measurements are null, and zero is never substituted', () => {
    expect(runDistanceMi({})).toBeNull();
    expect(runAvgHr({})).toBeNull();
    expect(runAvgHr({ avgHr: null })).toBeNull();
    expect(runMaxHr({ maxHr: null })).toBeNull();
    expect(runMovingSec({})).toBeNull();
    expect(runFinishSec({})).toBeNull();
    expect(runElevGainFt({})).toBeNull();
  });

  it('a flat run really does gain zero feet · elevation keeps its zero', () => {
    expect(runElevGainFt({ elevGainFt: 0 })).toBe(0);
    // but a zero distance or duration is not a measurement
    expect(runDistanceMi({ distanceMi: 0 })).toBeNull();
    expect(runMovingSec({ movingTimeS: 0 })).toBeNull();
  });

  it('the two duration accessors mirror their SQL ladders', () => {
    const d: RunData = { movingTimeS: 3112, elapsedTimeS: 3112, durationSec: 3326 };
    expect(runMovingSec(d)).toBe(3112);
    expect(runFinishSec(d)).toBe(3326); // the paused-time-inclusive read
    // the 4-row early-HealthKit era, whose only duration key is movingSec
    expect(runMovingSec({ movingSec: 3720 })).toBe(3720);
    expect(runFinishSec({ movingSec: 3720 })).toBe(3720);
  });

  it('out-of-band heart rates read as absent, not as measurements', () => {
    expect(runAvgHr({ avgHr: 0 })).toBeNull();
    expect(runAvgHr({ avgHr: 4 })).toBeNull();
    expect(runAvgHr({ avgHr: 250 })).toBeNull();
    expect(runAvgHr({ avgHr: 117.2 })).toBe(117.2); // fractional values are real
  });

  it('isMergedAway keys on presence, not value', () => {
    expect(isMergedAway({ mergedIntoId: -1010945655 })).toBe(true);
    expect(isMergedAway({ mergedIntoId: 'abc-123' })).toBe(true);
    expect(isMergedAway({})).toBe(false);
  });
});

describe('runWorkoutType · two taxonomies in one key', () => {
  it('resolves Strava numeric codes', () => {
    expect(runWorkoutType({ workoutType: 1 })).toMatchObject({ era: 'strava-code', semantic: 'race' });
    expect(runWorkoutType({ workoutType: 3 })).toMatchObject({ era: 'strava-code', semantic: 'tempo' });
    // 0 = default and 2 = long run carry no quality claim
    expect(runWorkoutType({ workoutType: 0 }).semantic).toBeNull();
    expect(runWorkoutType({ workoutType: 2 }).semantic).toBeNull();
  });

  it('resolves the faff semantic strings', () => {
    for (const t of ['easy', 'long', 'tempo', 'threshold', 'intervals', 'race'] as const) {
      expect(runWorkoutType({ workoutType: t })).toMatchObject({ era: 'faff-semantic', semantic: t });
    }
  });

  it('resolves a Strava code already flattened to text by `->>`', () => {
    // This is the trap: `data->>'workoutType'` gives '1' for Strava and 'race'
    // for faff, and a naive comparison misses one era entirely.
    expect(runWorkoutType({ workoutType: '1' })).toMatchObject({ era: 'strava-code', semantic: 'race' });
    expect(runWorkoutType({ workoutType: 'race' })).toMatchObject({ era: 'faff-semantic', semantic: 'race' });
  });

  it('an unclassified row is `none`, which is the majority of rows', () => {
    expect(runWorkoutType({})).toMatchObject({ era: 'none', semantic: null });
    expect(runWorkoutType({ workoutType: null })).toMatchObject({ era: 'none', semantic: null });
  });
});

describe('normalizeSplits · all six shapes measured in the live table', () => {
  // Each fixture is the real key-set from the census, with plausible values.
  const faffAvgHr = { mile: 1, avgHr: 148, paceSPerMi: 415, elevDeltaFt: 12, gapSPerMi: 410 };
  const faffHrPaceStr = { mile: 1, hr: 152, pace: '6:55', distanceMi: 1, elev_ft: 8, cadence: 176 };
  const faffHrPaceSec = { mile: 1, hr: 150, pace: '7:00', paceSecPerMi: 420 };
  const stravaRaw = {
    split: 1, distance: 1609.344, moving_time: 420, elapsed_time: 430,
    average_speed: 3.8317, average_grade_adjusted_speed: 3.9, elevation_difference: 3.048, pace_zone: 2,
  };
  const stravaRawHr = { ...stravaRaw, average_heartrate: 146 };
  const watchPhase = {
    type: 'work', label: 'T', completed: true, avgHr: 168,
    paceSecPerMi: 390, distanceMi: 2, durationSec: 780, maxHr: 174,
  };

  it('identifies each shape', () => {
    const shape = (s: unknown) => normalizeSplits([s])[0].shape;
    expect(shape(faffAvgHr)).toBe('faff-avghr');
    expect(shape(faffHrPaceStr)).toBe('faff-hr');
    expect(shape(faffHrPaceSec)).toBe('faff-hr');
    expect(shape(stravaRaw)).toBe('strava-raw');
    expect(shape(stravaRawHr)).toBe('strava-raw');
    expect(shape(watchPhase)).toBe('watch-phase');
  });

  it('returns one type across all of them', () => {
    const out = normalizeSplits([faffAvgHr, faffHrPaceStr, faffHrPaceSec, stravaRawHr, watchPhase]);
    expect(out).toHaveLength(5);
    for (const s of out) {
      expect(s.paceSec).toBeGreaterThan(0);
      expect(s.hr).toBeGreaterThan(100);
    }
  });

  it('converts Strava metres to miles and m/s to sec/mile', () => {
    const [s] = normalizeSplits([stravaRaw]);
    expect(s.distanceMi).toBeCloseTo(1, 3);
    expect(s.paceSec).toBeCloseTo(420, 0);   // 3.8317 m/s ≈ 7:00/mi
    expect(s.elevFt).toBeCloseTo(10, 1);     // 3.048 m = 10 ft
    expect(s.hr).toBeNull();                 // this variant carries no HR
  });

  it('derives pace from distance and time when speed is absent', () => {
    const [s] = normalizeSplits([{ split: 2, distance: 1609.344, moving_time: 400 }]);
    expect(s.paceSec).toBeCloseTo(400, 0);
  });

  it('parses `m:ss` pace strings and rejects nonsense', () => {
    expect(paceToSec('6:55')).toBe(415);
    expect(paceToSec('12:17')).toBe(737);
    expect(paceToSec(415)).toBe(415);
    expect(paceToSec(null)).toBeNull();
    expect(paceToSec('')).toBeNull();
    expect(paceToSec(0)).toBeNull();
  });

  it('bounds heart rate to what a human produces', () => {
    expect(hrToNum(148)).toBe(148);
    expect(hrToNum(40)).toBeNull();
    expect(hrToNum(230)).toBeNull();
    expect(hrToNum(null)).toBeNull();
  });

  it('keeps unreadable shapes rather than dropping them', () => {
    // "no splits" and "splits in a shape we do not understand" are different
    // problems and must stay distinguishable.
    const out = normalizeSplits([{ somethingElse: 1 }]);
    expect(out).toHaveLength(1);
    expect(out[0].shape).toBe('unknown');
    expect(out[0].hr).toBeNull();
    expect(out[0].paceSec).toBeNull();
  });

  it('non-arrays and non-objects are dropped, not thrown on', () => {
    expect(normalizeSplits(null)).toEqual([]);
    expect(normalizeSplits(undefined)).toEqual([]);
    expect(normalizeSplits('nope')).toEqual([]);
    expect(normalizeSplits([])).toEqual([]);
    expect(normalizeSplits([null, 3, 'x'])).toEqual([]);
  });
});

describe('splitsWithHrAndPace · reproduces the decoupling extractor exactly', () => {
  const faffAvgHr = { mile: 1, avgHr: 148, paceSPerMi: 415 };
  const faffHr = { mile: 1, hr: 152, pace: '6:55' };
  const stravaRawHr = {
    split: 1, distance: 1609.344, moving_time: 420, average_speed: 3.8317, average_heartrate: 146,
  };

  it('reads both faff shapes, as the old local extractor did', () => {
    const out = splitsWithHrAndPace([faffAvgHr, faffHr], { shapes: DECOUPLING_SPLIT_SHAPES });
    expect(out).toEqual([{ hr: 148, paceSec: 415 }, { hr: 152, paceSec: 415 }]);
  });

  it('does NOT read Strava-raw under the decoupling shape list', () => {
    // The historical reach of computeAerobicDecoupling. 36 rows carry
    // Strava-raw elements inside `splits` and have always produced no signal.
    // Widening this is a behaviour change and is deliberately not made here.
    expect(splitsWithHrAndPace([stravaRawHr], { shapes: DECOUPLING_SPLIT_SHAPES })).toEqual([]);
  });

  it('DOES read Strava-raw when no shape restriction is given', () => {
    const out = splitsWithHrAndPace([stravaRawHr]);
    expect(out).toHaveLength(1);
    expect(out[0].hr).toBe(146);
    expect(out[0].paceSec).toBeCloseTo(420, 0);
  });

  it('drops rows missing either signal', () => {
    const out = splitsWithHrAndPace(
      [faffAvgHr, { mile: 2, avgHr: 150 }, { mile: 3, paceSPerMi: 420 }],
      { shapes: DECOUPLING_SPLIT_SHAPES },
    );
    expect(out).toEqual([{ hr: 148, paceSec: 415 }]);
  });
});
