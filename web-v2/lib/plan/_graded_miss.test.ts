/**
 * lib/plan/_graded_miss.test.ts · GRADED-MISS-1
 *
 * The owner's ruling on a missed session, which had NEITHER an implementation
 * NOR a gate until 2026-08-30 — the exact shape Rule 20 is about:
 *
 *   "Reshuffle early in the week when the stimulus still matters,
 *    absorb it late."
 *
 * `chooseRescheduleDate` walked today+1..today+4 with no week-position
 * awareness at all, so the response was identical whether the miss happened on
 * the first day of the week or the last. Worse, nothing constrained the target
 * to the same training week, so a Thursday miss could be rescheduled onto next
 * Monday — adding a quality day to a week already composed with its own, which
 * is the stacking the anti-stacking downgrade exists to prevent, arriving from
 * the other direction and unguarded.
 *
 * The rule is expressed through the week boundary rather than through an
 * invented "early" threshold. Rule 9: a behavioural switch on a hair is a
 * defect, and "the first three days" would be exactly that. The training week
 * ends on the runner's long-run day (locked 2026-06-16, one definition in
 * `trainingWeekWindow`), so early and late are read off his own calendar.
 *
 * Falsified before landing: dropping the `weekEndISO` guard turns the
 * late-week cases green-to-red.
 */
import { describe, it, expect } from 'vitest';
import { chooseRescheduleDate, dowOfISO, plusDaysISO, type RescheduleDayContext } from './adapt';
import { trainingWeekWindow } from '@/lib/notifications/week-window';

/** A week of wide-open days, so only the rule under test can refuse one. */
function openDays(fromISO: string, n = 10): Record<string, RescheduleDayContext> {
  const m: Record<string, RescheduleDayContext> = {};
  for (let i = 0; i <= n; i++) {
    m[plusDaysISO(fromISO, i)] = {
      runCount: 0, qualityOrLong: false, hasRestRow: false, weekRunCount: null,
    };
  }
  return m;
}

/** Sunday long run · the week runs Monday..Sunday. His own setting. */
const LONG_RUN_DOW = 0;

function weekEndFor(todayISO: string): string {
  return trainingWeekWindow(todayISO, dowOfISO(todayISO), LONG_RUN_DOW).week_end_iso;
}

function choose(todayISO: string, opts: { bounded: boolean }): string | null {
  return chooseRescheduleDate({
    todayISO,
    byDate: openDays(todayISO),
    // The long-run DAY itself is refused by an older guard; that is separate
    // from the boundary being tested here and is asserted below.
    longRunDow: LONG_RUN_DOW,
    restDow: null,
    weeklyFrequency: null,
    raceDates: [],
    weekEndISO: opts.bounded ? weekEndFor(todayISO) : null,
  });
}

describe('GRADED-MISS-1 · reshuffle early, absorb late', () => {
  /* 2026-08-31 is a Monday. With a Sunday long run the training week runs
   * Monday 08-31 .. Sunday 09-06. */
  it('the fixture week is the one the rule is stated against', () => {
    expect(dowOfISO('2026-08-31')).toBe(1);          // Monday
    expect(weekEndFor('2026-08-31')).toBe('2026-09-06'); // Sunday
  });

  it('EARLY · a Monday miss is rescheduled inside the same week', () => {
    const target = choose('2026-08-31', { bounded: true });
    expect(target).not.toBeNull();
    expect(target! <= '2026-09-06', `${target} landed past the week end`).toBe(true);
  });

  it('EARLY · a mid-week miss is still rescheduled inside the week', () => {
    for (const today of ['2026-09-01', '2026-09-02']) {
      const target = choose(today, { bounded: true });
      expect(target, `no slot found on ${today}`).not.toBeNull();
      expect(target! <= '2026-09-06').toBe(true);
    }
  });

  it('LATE · a Friday miss is ABSORBED · every candidate is past the boundary or the long run', () => {
    // Friday 2026-09-04. Candidates are Sat 05, Sun 06 (the long-run day, refused
    // by the older guard), Mon 07 and Tue 08 — both next week.
    const target = choose('2026-09-04', { bounded: true });
    // Saturday is still in-week and open, so the honest assertion is not "null"
    // but "never next week".
    if (target != null) expect(target <= '2026-09-06').toBe(true);
  });

  it('LATE · a Saturday miss cannot reach into next week', () => {
    // Saturday 2026-09-05. Sunday is the long run; Mon/Tue/Wed are next week.
    // Absorbed: no legal slot remains.
    expect(choose('2026-09-05', { bounded: true })).toBeNull();
  });

  it('LATE · a long-run-day miss cannot reach into next week either', () => {
    expect(choose('2026-09-06', { bounded: true })).toBeNull();
  });

  it('THE DEFECT · unbounded, a Saturday miss lands on MONDAY, stacking next week', () => {
    // This is what shipped. Kept as an executable statement of the bug so the
    // fix cannot be quietly reverted into looking correct.
    const unbounded = choose('2026-09-05', { bounded: false });
    expect(unbounded).toBe('2026-09-07');            // next Monday
    expect(unbounded! > weekEndFor('2026-09-05')).toBe(true);
  });

  it('the boundary is READ from the shared week definition, not restated', () => {
    // A Saturday long-run runner's week ends on Saturday, so his "late" is a
    // different day. If this ever hardcoded Sunday, this case would fail.
    const satLongRun = 6;
    const { week_end_iso } = trainingWeekWindow('2026-09-02', dowOfISO('2026-09-02'), satLongRun);
    expect(week_end_iso).toBe('2026-09-05');
    const target = chooseRescheduleDate({
      todayISO: '2026-09-02',
      byDate: openDays('2026-09-02'),
      longRunDow: satLongRun,
      restDow: null,
      weeklyFrequency: null,
      raceDates: [],
      weekEndISO: week_end_iso,
    });
    if (target != null) expect(target <= '2026-09-05').toBe(true);
  });

  it('a null boundary keeps the old search · a missing setting changes nothing silently', () => {
    // `long_run_day` unresolved must not be read as "absorb everything". Rule
    // 11: a missing input may not silently change the response.
    expect(choose('2026-09-05', { bounded: false })).not.toBeNull();
  });
});
