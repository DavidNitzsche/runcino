/**
 * RACEWEEK-2 · a graded race that replaced the week's quality session must
 * not read as "no key session this week".
 *
 * Before this fix, `familyOf` graded every `type: 'race'` row family `'race'`
 * unconditionally, and `assessWeekAgainstThesis`'s `addressing` count only
 * ever matched `f === wanted` — so a week whose only quality was a B or C
 * race, with no separately-typed threshold/intervals/long row, fell through
 * to `WEEK_HOLDS_NO_KEY_SESSION`. That is the exact defect the owner's ruling
 * names: "Do NOT penalize the week for omitting a quality workout the race
 * intentionally replaced — a quality-completion check must know the race WAS
 * the quality session."
 *
 * The Dodgers fixture below is the owner's REAL live week (production,
 * `faff_readonly`, plan `pln_9a57561debb776e5`, week starting 2026-09-21),
 * trimmed to the fields `ThesisWeekRow` reads. It is the one week of his four
 * named scenarios where this defect is reachable TODAY: Santa Monica and Run
 * Malibu both carry `is_cutback=true` in production, so
 * `assessWeekAgainstThesis`'s non-normal branch (cutback) already short-
 * circuits before family-matching runs; Dodgers carries `is_cutback=false`
 * and `is_race_week=false`, so it reaches the family-matching code this file
 * tests. CIM (`is_race_week=true`) short-circuits on the FIRST branch and is
 * asserted unchanged below (the regression case).
 *
 * FALSIFIED (Rule 18): reverting `familyOf`'s race branch to unconditionally
 * `return 'race'` (dropping the `row.is_long ?` check) and reverting
 * `assessWeekAgainstThesis`'s `addressing` line to `families.filter((f) => f
 * === wanted)` reproduces `WEEK_HOLDS_NO_KEY_SESSION` on the HIGH_INTENSITY
 * case below — checked by hand against the pre-fix source before landing.
 */
import { describe, it, expect } from 'vitest';
import {
  assessWeekAgainstThesis, matchesCapacity, type ThesisWeekRow, type PrimaryCapacity,
} from './coaching-thesis';

const row = (over: Partial<ThesisWeekRow> & Pick<ThesisWeekRow, 'id' | 'dateIso' | 'type'>): ThesisWeekRow => ({
  subLabel: null,
  isLong: false,
  distanceMi: null,
  workoutSpec: null,
  phaseLabel: 'QUALITY',
  isRaceWeek: false,
  isCutback: false,
  ...over,
});

/** His live Dodgers week (2026-09-21 .. 2026-09-27), trimmed to what the
 *  thesis reads. `is_cutback=false`, `is_race_week=false` in production — the
 *  week that actually reaches family-matching. */
const dodgersWeek: ThesisWeekRow[] = [
  row({ id: 'd1', dateIso: '2026-09-21', type: 'easy' }),
  row({ id: 'd2', dateIso: '2026-09-22', type: 'tempo', isLong: false }),
  row({ id: 'd3', dateIso: '2026-09-23', type: 'easy' }),
  row({ id: 'd4', dateIso: '2026-09-24', type: 'rest' }),
  row({ id: 'd5', dateIso: '2026-09-25', type: 'easy' }),
  row({ id: 'd6', dateIso: '2026-09-26', type: 'race', isLong: false }),   // the C race
  row({ id: 'd7', dateIso: '2026-09-27', type: 'long', isLong: true }),    // the separate long run
];

/** His live Run Malibu week (2026-11-02 .. 2026-11-08), same trim, but with
 *  `is_cutback` forced false to isolate the family-matching question from the
 *  (separately correct) cutback short-circuit production currently applies
 *  to this specific week. */
const runMalibuWeekIgnoringCutback: ThesisWeekRow[] = [
  row({ id: 'm1', dateIso: '2026-11-02', type: 'easy' }),
  row({ id: 'm2', dateIso: '2026-11-03', type: 'threshold' }),
  row({ id: 'm3', dateIso: '2026-11-04', type: 'easy' }),
  row({ id: 'm4', dateIso: '2026-11-05', type: 'easy' }),
  row({ id: 'm5', dateIso: '2026-11-06', type: 'shakeout' }),
  row({ id: 'm6', dateIso: '2026-11-07', type: 'rest' }),
  row({ id: 'm7', dateIso: '2026-11-08', type: 'race', isLong: true }),   // the B race, on the long-run day
];

/** His live CIM week (2026-11-30 .. 2026-12-06) — the regression case. */
const cimWeek: ThesisWeekRow[] = [
  row({ id: 'c1', dateIso: '2026-11-30', type: 'easy', phaseLabel: 'TAPER', isRaceWeek: true }),
  row({ id: 'c2', dateIso: '2026-12-01', type: 'race_week_tuneup', phaseLabel: 'TAPER', isRaceWeek: true }),
  row({ id: 'c7', dateIso: '2026-12-06', type: 'race', phaseLabel: 'TAPER', isRaceWeek: true, isLong: true }),
];

describe('RACEWEEK-2 · a graded race stands in for the quality it replaced', () => {
  it('Dodgers (C, non-long): addresses HIGH_INTENSITY or THRESHOLD, never falls through to WEEK_HOLDS_NO_KEY_SESSION', () => {
    // Before the fix this was WEEK_HOLDS_NO_KEY_SESSION — no row in the week
    // is typed 'intervals'/'vo2max', and the race's family was unconditionally
    // 'race', which nothing matched.
    expect(assessWeekAgainstThesis('HIGH_INTENSITY', dodgersWeek).code).toBe('WEEK_ADDRESSES_LIMITER');
  });

  it('Dodgers: THRESHOLD is (also, independently) addressed by the separate tempo day — unaffected either way', () => {
    expect(assessWeekAgainstThesis('THRESHOLD', dodgersWeek).code).toBe('WEEK_ADDRESSES_LIMITER');
  });

  it('Dodgers: the race never stands in for DURABILITY — it did not take the long-run slot, the separate long run does', () => {
    const v = assessWeekAgainstThesis('DURABILITY', dodgersWeek);
    expect(v.code).toBe('WEEK_ADDRESSES_LIMITER');
    expect(v.detail).toContain('1 long session'); // the 09-27 long run, not the race
  });

  it('Run Malibu (B, is_long true): the race IS the week\'s long run for DURABILITY — no separate long run demanded', () => {
    const v = assessWeekAgainstThesis('DURABILITY', runMalibuWeekIgnoringCutback);
    expect(v.code).toBe('WEEK_ADDRESSES_LIMITER');
  });

  it('Run Malibu: also addresses HIGH_INTENSITY/THRESHOLD independently via the race, not only via the separate threshold day', () => {
    // Strip the separate threshold day to isolate what the race alone proves.
    const raceOnly = runMalibuWeekIgnoringCutback.filter((r) => r.type !== 'threshold');
    expect(assessWeekAgainstThesis('HIGH_INTENSITY', raceOnly).code).toBe('WEEK_ADDRESSES_LIMITER');
  });

  it('a graded race never stands in for a limiter by ITSELF being counted twice as a contradiction', () => {
    // The race must stay excluded from `otherQuality` (the CONTRADICTS count)
    // regardless of which limiter is wanted — it is this week's designated
    // stimulus, never "the wrong kind of quality crowding the slot".
    const v = assessWeekAgainstThesis('DURABILITY', dodgersWeek);
    expect(v.code).not.toBe('WEEK_CONTRADICTS_THESIS');
  });

  it('CIM (goal race week) is unaffected — is_race_week short-circuits before family-matching runs at all', () => {
    for (const capacity of ['THRESHOLD', 'HIGH_INTENSITY', 'DURABILITY'] as const) {
      const v = assessWeekAgainstThesis(capacity, cimWeek);
      expect(v.code).toBe('WEEK_IS_NON_NORMAL');
      expect(v.detail).toContain('race week');
    }
  });

  it('matchesCapacity agrees with assessWeekAgainstThesis (one predicate, Rule 16)', () => {
    const dodgersRaceDay = dodgersWeek.find((r) => r.id === 'd6')!;
    for (const capacity of ['THRESHOLD', 'HIGH_INTENSITY'] as PrimaryCapacity[]) {
      expect(matchesCapacity(capacity, { type: dodgersRaceDay.type, is_long: dodgersRaceDay.isLong })).toBe(true);
    }
    expect(matchesCapacity('DURABILITY', { type: dodgersRaceDay.type, is_long: dodgersRaceDay.isLong })).toBe(false);
  });
});
