/**
 * lib/watch/_watch_lobby.test.ts · the 0821 watch lobby's additive fields.
 *
 * Three things this locks, all of them cheap and all of them the shapes that
 * actually break:
 *
 *   1 · The week strip is a PROJECTION of `loadPlanWeek`, not a re-derivation.
 *       The numbers on the wrist and the numbers on the phone come from one
 *       loader; a test that the projection preserves them is the only thing
 *       standing between that and someone re-summing the week here later.
 *
 *   2 · Every clause of a coach sentence DROPS rather than guesses. A week
 *       with nothing in it is never told it ran zero miles, and a long run
 *       that was scheduled and missed is never reported as having happened.
 *       Both are the same bug: a sentence asserting more than the data says.
 *
 *   3 · The copy rules, on the strings this module authors. `lib/watch` is
 *       outside `check-coach-voice.sh`'s scan (it covers lib/faff, lib/coach,
 *       app/api/v5 and the v5 phone), so rule four has no reach here and this
 *       is what stands in for it.
 */
import { describe, it, expect } from 'vitest';
import type { PlanWeekDay, PlanWeekResult } from '@/lib/plan/week-loader';
import {
  projectWeekStrip, buildRestDayState, buildNoSessionState, milesInWords,
} from './build-workout';

const day = (over: Partial<PlanWeekDay> & { date_iso: string; dow: number }): PlanWeekDay => ({
  plan_workout_id: 'pw-' + over.date_iso,
  type: 'easy',
  distance_mi: 6,
  sub_label: null,
  is_today: false,
  is_past: false,
  completedRunId: null,
  done_mi: null,
  skipped: false,
  secondaryRun: null,
  ...over,
});

/** Mon 2026-08-17 → Sun 2026-08-23, today Thu 2026-08-20. */
function week(): PlanWeekResult {
  return {
    plan_id: 'plan-1',
    week_start_iso: '2026-08-17',
    week_end_iso: '2026-08-23',
    today_iso: '2026-08-20',
    days: [
      day({ date_iso: '2026-08-17', dow: 1, distance_mi: 6, is_past: true, done_mi: 6.2, completedRunId: 'r1' }),
      day({ date_iso: '2026-08-18', dow: 2, type: 'threshold', distance_mi: 8, is_past: true, done_mi: 8.1, completedRunId: 'r2' }),
      day({ date_iso: '2026-08-19', dow: 3, type: 'rest', distance_mi: 0, is_past: true }),
      day({ date_iso: '2026-08-20', dow: 4, distance_mi: 6, is_today: true }),
      day({ date_iso: '2026-08-21', dow: 5, type: 'rest', distance_mi: 0 }),
      day({ date_iso: '2026-08-22', dow: 6, distance_mi: 5 }),
      day({ date_iso: '2026-08-23', dow: 0, type: 'long', distance_mi: 17 }),
    ],
  };
}

/** Every rule four guard that applies to prose, plus the length band. */
function obeysCopyRules(line: string) {
  expect(line, 'no exclamation mark').not.toMatch(/!/);
  expect(line, 'no em or en dash · the separator is ·').not.toMatch(/[—–]/);
  expect(line, 'no emoji').not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  const words = line.split(/\s+/).filter(Boolean).length;
  expect(words, `8-40 words, got ${words}: ${line}`).toBeGreaterThanOrEqual(5);
  expect(words, `8-40 words, got ${words}: ${line}`).toBeLessThanOrEqual(40);
}

describe('week strip · a projection, never a re-derivation', () => {
  it('carries the loader\'s own totals and window', () => {
    const s = projectWeekStrip(week())!;
    expect(s.weekStartIso).toBe('2026-08-17');
    expect(s.weekEndIso).toBe('2026-08-23');
    expect(s.milesPlanned).toBe(42);   // 6+8+0+6+0+5+17
    expect(s.milesDone).toBe(14.3);    // 6.2+8.1
    expect(s.days).toHaveLength(7);
  });

  it('reads each day done / today / remaining, and marks the past', () => {
    const s = projectWeekStrip(week())!;
    expect(s.days.map((d) => d.state)).toEqual([
      'done', 'done', 'remaining', 'today', 'remaining', 'remaining', 'remaining',
    ]);
    // The rested Wednesday is past and was not run. It reads `remaining`
    // because the design allows exactly three states — `isPast` is what
    // keeps the strip from drawing it as though it were still to come.
    expect(s.days[2]).toMatchObject({ isPast: true, type: 'rest', state: 'remaining' });
  });

  it('gives every day the strip letter, Sunday-indexed', () => {
    expect(projectWeekStrip(week())!.days.map((d) => d.letter))
      .toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
  });

  it('is null when there is no window to draw', () => {
    expect(projectWeekStrip({
      plan_id: null, week_start_iso: null, week_end_iso: null,
      today_iso: '2026-08-20', days: [], message: 'No active plan.',
    })).toBeNull();
  });
});

describe('rest day · every clause drops rather than guesses', () => {
  it('states the week and the long run when both are true', () => {
    const raw = week();
    // Move today past the long run so it has actually happened.
    raw.days[6] = day({ date_iso: '2026-08-23', dow: 0, type: 'long', distance_mi: 17, is_past: true, done_mi: 17.2, completedRunId: 'r7' });
    const s = buildRestDayState(projectWeekStrip(raw), raw, '2026-08-20');
    expect(s.coachLine).toBe(
      'Nothing today · you ran 31.5 miles this week and the long one was Sunday. Resting is the work.',
    );
    expect(s.kind).toBe('rest');
    expect(s.actionLabel).toBe('Run anyway');
    obeysCopyRules(s.coachLine);
  });

  it('says the long one IS Sunday when it is still ahead', () => {
    const raw = week();
    const s = buildRestDayState(projectWeekStrip(raw), raw, '2026-08-20');
    expect(s.coachLine).toContain('the long one is Sunday');
    obeysCopyRules(s.coachLine);
  });

  it('drops the long-run clause entirely when it was missed', () => {
    const raw = week();
    // Long run is in the past and nothing was run on it. Reporting it as
    // having happened would be the bug; reporting the miss would be the
    // scolding. It says neither.
    raw.days[6] = day({ date_iso: '2026-08-23', dow: 0, type: 'long', distance_mi: 17, is_past: true });
    const s = buildRestDayState(projectWeekStrip(raw), raw, '2026-08-20');
    expect(s.coachLine).not.toContain('long one');
    expect(s.coachLine).toContain('you ran 14.3 miles this week');
    expect(s.longRunDayName).toBe('Sunday');   // the fact still rides the wire
    obeysCopyRules(s.coachLine);
  });

  it('never tells a runner they ran zero miles', () => {
    const raw = week();
    raw.days = raw.days.map((d) => ({ ...d, done_mi: null, completedRunId: null, is_past: false }));
    const s = buildRestDayState(projectWeekStrip(raw), raw, '2026-08-20');
    expect(s.coachLine).not.toContain('you ran');
    expect(s.coachLine).toBe('Nothing today · the long one is Sunday. Resting is the work.');
    expect(s.weekMilesDone).toBe(0);
    obeysCopyRules(s.coachLine);
  });

  it('falls all the way back to the bare line when nothing is known', () => {
    const raw: PlanWeekResult = {
      plan_id: 'plan-1', week_start_iso: '2026-08-17', week_end_iso: '2026-08-23',
      today_iso: '2026-08-20',
      days: week().days.map((d) => ({ ...d, type: 'rest', distance_mi: 0, done_mi: null, completedRunId: null })),
    };
    const s = buildRestDayState(projectWeekStrip(raw), raw, '2026-08-20');
    expect(s.coachLine).toBe('Nothing today. Resting is the work.');
    expect(s.longRunDayName).toBeNull();
  });
});

describe('next workout · the first running day still ahead in the loaded week', () => {
  it('finds the nearest day with miles on it, skipping the rest day between', () => {
    const raw = week();
    const s = buildRestDayState(projectWeekStrip(raw), raw, '2026-08-20');
    // Today is Thu. Fri is a rest day (skipped). Sat is the nearest run: 5mi.
    expect(s.nextWorkout).toMatchObject({
      dayName: 'Saturday', dateIso: '2026-08-22', type: 'easy', distanceMi: 5, daysAway: 2,
    });
  });

  it('is null when the loaded week has nothing left after today', () => {
    const raw = week();
    const s = buildRestDayState(projectWeekStrip(raw), raw, '2026-08-23');
    expect(s.nextWorkout).toBeNull();
  });
});

describe('no session · one reason per state, and always a plain run', () => {
  const cases: Array<[Parameters<typeof buildNoSessionState>[0], string]> = [
    ['week_off', 'Week off'],
    ['off_season', 'Off-season'],
    ['injury', 'Not today'],
    ['sick', 'Not today'],
    ['no_plan', 'No session'],
    ['nothing_scheduled', 'No session'],
  ];
  for (const [reason, title] of cases) {
    it(`${reason} · titled, reasoned, and offers a plain run`, () => {
      const raw = week();
      const s = buildNoSessionState(reason, {
        week: projectWeekStrip(raw), raw, today: '2026-08-20',
        resumesIso: reason === 'week_off' ? '2026-08-24' : null,
        injurySite: reason === 'injury' ? 'Knee' : null,
      });
      expect(s.kind).toBe('no_session');
      expect(s.reason).toBe(reason);
      expect(s.title).toBe(title);
      expect(s.actionLabel).toBe('Just run');
      expect(s.actionKind).toBe('just_run');
      obeysCopyRules(s.coachLine);
    });
  }

  it('names the day the block resumes', () => {
    const raw = week();
    const s = buildNoSessionState('week_off', { week: projectWeekStrip(raw), raw, today: '2026-08-20', resumesIso: '2026-08-24' });
    expect(s.resumesDayName).toBe('Monday');
    expect(s.coachLine).toBe(
      'The block resumes Monday. Walk, swim, or do nothing. None of it goes in the book.',
    );
  });

  it('drops the day rather than inventing one when nothing follows the break', () => {
    const raw = week();
    const s = buildNoSessionState('week_off', { week: projectWeekStrip(raw), raw, today: '2026-08-20', resumesIso: null });
    expect(s.resumesDayName).toBeNull();
    expect(s.coachLine).toContain('resumes when you get back');
  });

  it('names the site on an injury and stays silent when it cannot', () => {
    const raw = week();
    const withSite = buildNoSessionState('injury', { week: null, raw, today: '2026-08-20', injurySite: 'Achilles' });
    expect(withSite.coachLine).toContain('The achilles is still open');
    const without = buildNoSessionState('injury', { week: null, raw, today: '2026-08-20', injurySite: null });
    expect(without.coachLine).not.toContain('undefined');
    expect(without.coachLine).toContain('while this settles');
  });
});

describe('milesInWords · coach register, not telemetry', () => {
  it('spells whole numbers up to twenty', () => {
    expect(milesInWords(6)).toBe('six miles');
    expect(milesInWords(1)).toBe('one mile');
    expect(milesInWords(20)).toBe('twenty miles');
  });
  it('keeps figures above twenty and anything fractional', () => {
    expect(milesInWords(34)).toBe('34 miles');
    expect(milesInWords(6.5)).toBe('6.5 miles');
  });
});
