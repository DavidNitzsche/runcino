/**
 * STRENGTH-1/2 · strength dosing must match Research/07 and Research/09.
 *
 * The defects this locks out:
 *
 *   1. pickCandidates scored ANY `isQuality` day at 10 and prescribed
 *      HEAVY there. Research/07:553-554 splits the two kinds of quality
 *      day, and the one it rules out is precisely the one the picker
 *      preferred:
 *        | Threshold workout | Heavy lifting    | 24 h, or same day ≥4 h gap |
 *        | VO2 / interval    | Maintenance only | 24 h                       |
 *   2. The intensity doc claimed "3-5 reps @ 85%+ 1RM" (:190 max
 *      strength) while sessionFor() emitted 6-8 / 8-10 / 12-15, and the
 *      8-10 hip thrust matched no row in the research at all (:130 is
 *      3-4 × 5-8 at 75-85%).
 *   3. Heavy was demoted from 14 days out while the copy told the runner
 *      the rule was "last heavy 7-10 days before race" (:113, :166).
 *   4. strength-load.ts converted strength minutes into running miles at
 *      0.07 mi/min and folded that into ACWR. Research/09:350:
 *      "Quantify session load via sRPE; do not equate to run minutes."
 *      Its citation pointed at Research/07 §1.1-1.3, which contains no
 *      such factor.
 *
 * STRENGTH-3 (2026-08-17) · the recommender is UNWIRED — nothing in the
 * app calls it, and no surface renders strength. This suite stays green
 * against the retained module so that if David ever asks for it back, it
 * comes back correct rather than as the version that fabricated a
 * mi/min coefficient. Do not read its presence as the feature being live.
 */
import { describe, it, expect } from 'vitest';
import {
  pickCandidates,
  shouldDemoteHeavy,
  HEAVY_PAIRABLE_QUALITY_TYPES,
  MAINTENANCE_ONLY_QUALITY_TYPES,
  type WeekDay,
  type PhaseContext,
  type RaceContext,
} from './strength-recommender';
import * as strengthLoad from './strength-load';
import { sessionRpeAu } from './strength-load';

const day = (date: string, dow: number, type: string, extra: Partial<WeekDay> = {}): WeekDay => ({
  date, dow, type, isQuality: false, isLong: false, distanceMi: 6, ...extra,
});

/** A week with one threshold day, one interval day, easy days between. */
function mixedWeek(): WeekDay[] {
  return [
    day('2026-08-17', 0, 'easy'),
    day('2026-08-18', 1, 'threshold', { isQuality: true }),
    day('2026-08-19', 2, 'easy'),
    day('2026-08-20', 3, 'intervals', { isQuality: true }),
    day('2026-08-21', 4, 'easy'),
    day('2026-08-22', 5, 'rest', { distanceMi: 0 }),
    day('2026-08-23', 6, 'long', { isLong: true, distanceMi: 16 }),
  ];
}

const byDate = (date: string) => (c: { date: string }) => c.date === date;

describe('STRENGTH-1 · placement doctrine · Research/07:553-554', () => {
  it('a VO2/interval day gets MAINTENANCE, never heavy (:554)', () => {
    const c = pickCandidates(mixedWeek()).find(byDate('2026-08-20'));
    expect(c, 'the interval day must still be a candidate, just not a heavy one').toBeTruthy();
    expect(
      c!.intensity,
      'Research/07:554 · "VO2 / interval | Maintenance only | 24 h" · the shipped picker scored this 10 and prescribed heavy',
    ).toBe('maintenance');
  });

  it('a threshold day keeps the heavy PM pick (:553)', () => {
    const c = pickCandidates(mixedWeek()).find(byDate('2026-08-18'));
    expect(c!.intensity, 'Research/07:553 · threshold + heavy lifting, same day with a >=4 h gap').toBe('heavy');
    expect(c!.timing, 'Research/07:553 · the >=4 h gap means PM').toBe('pm');
    expect(c!.pairedWithRun).toBe(true);
  });

  it('the threshold day outranks the interval day when the week offers both', () => {
    const cands = pickCandidates(mixedWeek());
    const threshold = cands.find(byDate('2026-08-18'))!;
    const intervals = cands.find(byDate('2026-08-20'))!;
    expect(
      threshold.preferenceScore,
      'Research/07:553-554 · when only one slot is taken it should be the one heavy lifting is allowed on',
    ).toBeGreaterThan(intervals.preferenceScore);
  });

  it('the two type sets are disjoint and cover the engine vocabulary', () => {
    for (const t of MAINTENANCE_ONLY_QUALITY_TYPES) {
      expect(HEAVY_PAIRABLE_QUALITY_TYPES.has(t), `${t} cannot be both`).toBe(false);
    }
    // The quality types generate.ts actually emits.
    expect([...HEAVY_PAIRABLE_QUALITY_TYPES].sort()).toEqual(['tempo', 'threshold']);
    for (const t of ['intervals', 'vo2max', 'fartlek', 'hills']) {
      expect(MAINTENANCE_ONLY_QUALITY_TYPES.has(t), `Research/07:554 covers ${t}`).toBe(true);
    }
  });

  it('an unrecognised quality type degrades to the maintenance row', () => {
    const week = [day('2026-08-18', 1, 'some_new_quality_type', { isQuality: true }), day('2026-08-19', 2, 'easy')];
    const c = pickCandidates(week).find(byDate('2026-08-18'))!;
    expect(c.intensity, 'doctrine silence degrades to the more conservative of the two rows').toBe('maintenance');
  });

  it('the long-run day and the day before hard are still excluded (:540, :555)', () => {
    const cands = pickCandidates(mixedWeek());
    expect(cands.find(byDate('2026-08-23')), 'Research/07:555 · "Long run | None | 24 h+"').toBeUndefined();
    // 08-17 sits the day before the threshold day.
    expect(cands.find(byDate('2026-08-17')), 'day-before-hard · legs not fresh').toBeUndefined();
  });
});

describe('STRENGTH-1 · last heavy session is 7-10 days out (:113, :166)', () => {
  const phase: PhaseContext = { mode: 'race-prep', phaseLabel: 'QUALITY' };
  const taper = (daysToRace: number): RaceContext => ({ kind: 'taper_week', daysToRace });

  it('day 11-14 of the taper keeps its heavy session', () => {
    for (const d of [11, 12, 13, 14]) {
      expect(
        shouldDemoteHeavy(phase, taper(d)),
        `Research/07:113 · "Last heavy session 7-10 d before race" · ${d} days out is outside that window, and :82 still allows 70-85% loads in taper`,
      ).toBe(false);
    }
  });

  it('day 10 and inside is maintenance only', () => {
    for (const d of [10, 9, 8]) {
      expect(shouldDemoteHeavy(phase, taper(d)), `Research/07:166 · ${d} days out is inside the 7-10 day cut-off`).toBe(true);
    }
  });

  it('race week is always demoted (:114 · "Stop entirely 5-10 d out")', () => {
    expect(shouldDemoteHeavy(phase, { kind: 'race_week', daysToRace: 3 })).toBe(true);
  });

  it('peak and taper phases stay maintenance (:81, :86)', () => {
    const normal: RaceContext = { kind: 'normal', daysToRace: null };
    expect(shouldDemoteHeavy({ mode: 'race-prep', phaseLabel: 'RACE-SPECIFIC' }, normal)).toBe(true);
    expect(shouldDemoteHeavy({ mode: 'race-prep', phaseLabel: 'TAPER' }, normal)).toBe(true);
    // :83 off-season "Load 60-80%" but :791 "Heaviest lifting in
    // off-season/base" · heavy stays available.
    expect(shouldDemoteHeavy({ mode: 'maintenance', phaseLabel: 'MAINTENANCE' }, normal)).toBe(false);
  });
});

describe('STRENGTH-2 · session load is sRPE, not run-miles · Research/09:350', () => {
  it('the run-mile equivalence is gone', () => {
    // ":350 Quantify session load via sRPE; do not equate to run minutes."
    expect(
      (strengthLoad as Record<string, unknown>).STRENGTH_MI_PER_MIN,
      'Research/09:350 forbids a minute-to-mile equivalence; 0.07 was invented and cited to Research/07 §1.1-1.3, which contains no such factor',
    ).toBeUndefined();
    expect((strengthLoad as Record<string, unknown>).strengthLoadByDay).toBeUndefined();
    expect((strengthLoad as Record<string, unknown>).strengthLoadSum).toBeUndefined();
  });

  it('minutes are still available, as minutes', () => {
    expect(typeof strengthLoad.strengthMinutesByDay).toBe('function');
    expect(typeof strengthLoad.strengthMinutesSum).toBe('function');
  });

  it('sRPE is RPE x duration in arbitrary units (:350)', () => {
    expect(sessionRpeAu(7, 45)).toBe(315);
    expect(sessionRpeAu(5, 20)).toBe(100);
  });

  it('sRPE refuses to invent a reading', () => {
    // No RPE captured yet (strength_sessions has no rpe column), and a
    // defaulted RPE would be the same class of fabrication as 0.07.
    expect(sessionRpeAu(null, 45)).toBeNull();
    expect(sessionRpeAu(7, null)).toBeNull();
    expect(sessionRpeAu(0, 45)).toBeNull();
    expect(sessionRpeAu(11, 45)).toBeNull();
    expect(sessionRpeAu(7, 0)).toBeNull();
  });
});
