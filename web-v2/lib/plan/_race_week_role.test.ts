/**
 * RACEWEEK-2 · the four typed distinctions (`goal` / `tuneup` / `controlled` /
 * `none`), against the owner's own live authored weeks.
 *
 * Fixture data read from production (`faff_readonly`) 2026-09-03, active plan
 * `pln_9a57561debb776e5` (authored 2026-08-31, race `cim`):
 *
 *   week 2026-09-07  Santa Monica 10k  B  is_race_week=false is_cutback=true
 *   week 2026-09-21  Dodgers           C  is_race_week=false is_cutback=false
 *   week 2026-11-02  Run Malibu half   B  is_race_week=false is_cutback=true
 *   week 2026-11-30  CIM               A  is_race_week=true
 *
 * FALSIFIED (Rule 18): with the pre-fix `libraryPhaseKey(phaseLabel: string |
 * null, isRaceWeek: boolean)`, feeding it `resolveRaceWeekRole(...).role` does
 * not even compile (a `RaceWeekRole` is not a `boolean`) — the type itself is
 * the falsifier for that half. For `resolveRaceWeekRole`, reverting the `if
 * (priorities.includes('B')) return 'tuneup'` branch to always resolve
 * `'controlled'` (simulating "priority never read") is the way this file was
 * checked to fail the `role: 'tuneup'` assertions below before the fix; the
 * `role: 'controlled'` assertions were checked the other way, forcing `'B'`
 * unconditionally.
 */
import { describe, it, expect } from 'vitest';
import { resolveRaceWeekRole, type RaceWeekRoleReadable } from './race-week-role';
import { libraryPhaseKey } from './v5-block';

/** His live week 2 — Santa Monica 10K, B tune-up. `is_long=true` on the race
 *  row: the composer's own `embedMidBlockRaces` carried the long-run slot's
 *  flag onto the race because the 10K landed on the week's long-run day. */
const santaMonicaWeek: RaceWeekRoleReadable = {
  isRaceWeek: false,
  days: [
    { type: 'easy' }, { type: 'tempo' }, { type: 'easy' }, { type: 'easy' },
    { type: 'shakeout' }, { type: 'rest' }, { type: 'race' },
  ],
  raceDayPriorities: ['B'],
};

/** His live week 4 — Dodgers 10K, C controlled, the day before a separate
 *  15.5mi long run (the designed-weekend transaction). `is_race_week` and
 *  `is_cutback` are both false: nothing else in the plan currently marks
 *  this week non-normal, which is exactly why the family-matching fix in
 *  coaching-thesis.ts (see that file's own test) is reachable on this week
 *  specifically. */
const dodgersWeek: RaceWeekRoleReadable = {
  isRaceWeek: false,
  days: [
    { type: 'easy' }, { type: 'tempo' }, { type: 'easy' }, { type: 'rest' },
    { type: 'easy' }, { type: 'race' }, { type: 'long' },
  ],
  raceDayPriorities: ['C'],
};

/** His live week 10 — Run Malibu half, B tune-up, `is_long=true` (it stood in
 *  for both the quality slot and the long-run slot the same week). */
const runMalibuWeek: RaceWeekRoleReadable = {
  isRaceWeek: false,
  days: [
    { type: 'easy' }, { type: 'threshold' }, { type: 'easy' }, { type: 'easy' },
    { type: 'shakeout' }, { type: 'rest' }, { type: 'race' },
  ],
  raceDayPriorities: ['B'],
};

/** His live week 14 — CIM, the goal race. `is_race_week=true`. */
const cimWeek: RaceWeekRoleReadable = {
  isRaceWeek: true,
  days: [
    { type: 'easy' }, { type: 'race_week_tuneup' }, { type: 'easy' }, { type: 'easy' },
    { type: 'rest' }, { type: 'shakeout' }, { type: 'race' },
  ],
  raceDayPriorities: ['A'],
};

const noRaceWeek: RaceWeekRoleReadable = {
  isRaceWeek: false,
  days: [{ type: 'easy' }, { type: 'tempo' }, { type: 'long' }],
};

describe('RACEWEEK-2 · resolveRaceWeekRole against the owner\'s real authored weeks', () => {
  it('grades Santa Monica (B) tuneup, and containsRace true', () => {
    expect(resolveRaceWeekRole(santaMonicaWeek)).toEqual({
      role: 'tuneup', containsRace: true, priority: 'B',
    });
  });

  it('grades Dodgers (C) controlled, and containsRace true — never a taper', () => {
    expect(resolveRaceWeekRole(dodgersWeek)).toEqual({
      role: 'controlled', containsRace: true, priority: 'C',
    });
  });

  it('grades Run Malibu (B) tuneup, same as Santa Monica', () => {
    expect(resolveRaceWeekRole(runMalibuWeek)).toEqual({
      role: 'tuneup', containsRace: true, priority: 'B',
    });
  });

  it('grades CIM goal — is_race_week wins outright, priority read as A', () => {
    expect(resolveRaceWeekRole(cimWeek)).toEqual({
      role: 'goal', containsRace: true, priority: 'A',
    });
  });

  it('grades a week with no race as none', () => {
    expect(resolveRaceWeekRole(noRaceWeek)).toEqual({
      role: 'none', containsRace: false, priority: null,
    });
  });

  it('never re-derives containsRace — it is weekContainsRace, called once', () => {
    // Rule 16: pull `containsRace` for every non-none week and confirm it
    // agrees with the label's own answer (`weekContainsRace`, tested in
    // `_race_week_label.test.ts`) rather than trusting a second computation.
    for (const w of [santaMonicaWeek, dodgersWeek, runMalibuWeek, cimWeek]) {
      expect(resolveRaceWeekRole(w).containsRace).toBe(true);
    }
  });

  it('an ungraded or unreadable race falls to controlled, never tuneup (Rule 11)', () => {
    const unreadable: RaceWeekRoleReadable = {
      isRaceWeek: false,
      days: [{ type: 'race' }],
      // no raceDayPriorities supplied at all
    };
    expect(resolveRaceWeekRole(unreadable)).toEqual({
      role: 'controlled', containsRace: true, priority: null,
    });
  });
});

describe('RACEWEEK-2 · libraryPhaseKey takes the role, not the goal-only boolean', () => {
  it('only GOAL pulls the catalogue into race_week mode', () => {
    expect(libraryPhaseKey('TAPER', resolveRaceWeekRole(cimWeek).role)).toBe('race_week');
  });

  it('Santa Monica, Dodgers and Run Malibu all keep their ordinary phase catalogue', () => {
    expect(libraryPhaseKey('QUALITY', resolveRaceWeekRole(santaMonicaWeek).role)).toBe('quality');
    expect(libraryPhaseKey('QUALITY', resolveRaceWeekRole(dodgersWeek).role)).toBe('quality');
    expect(libraryPhaseKey('RACE-SPECIFIC', resolveRaceWeekRole(runMalibuWeek).role)).toBe('race_specific');
  });
});
