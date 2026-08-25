/**
 * lib/plan/_week_read_agreement.test.ts · one week, four functions, one answer.
 *
 * Run: ./node_modules/.bin/vitest run lib/plan/_week_read_agreement.test.ts
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY
 *
 * "This week" is asked four times on the way to a runner's screen, by four
 * different functions, and until 2026-08-24 two of them answered a different
 * week from the other two:
 *
 *   AUTHORING   `weekStartBoundaryOf(start, (longRunDow + 1) % 7)`
 *               — where `loadGeneratorInputs` starts week 0, and therefore
 *                 where every `plan_weeks` row falls.
 *   THE STRIP   `trainingWeekWindow(today, dow, longRunDow)`
 *               — `/api/plan/week`, the iPhone week strip, the check-in cron.
 *   THE TOTALS  `weekWindowFor(long_run_day, today)`
 *               — `weekDone` and (since WEEK-READ-1) `weekPlanned`, in
 *                 glance-state, state-loader and training-state.
 *   THE PANEL   the seven days the Block screen's stats plate describes.
 *
 * The observable failure, live in production on 2026-08-24: a Today screen
 * printing 29.5 mi planned above a week strip that summed to 31.0, because the
 * headline came from a plan_weeks row on one grid and the strip from a window
 * on another. A second runner had 3.0 above 2.0.
 *
 * This file is the arithmetic gate. It cannot see a database, so it does not
 * assert that the LOADERS call these functions — the surfaces' own tests and
 * `_onboarding_e2e`'s LAW O4 do that. What it asserts is that no matter which
 * of the four a caller reaches for, the seven days are the same seven days,
 * for every long-run day and every day of the year the question can be asked
 * on. If they ever diverge again, the disagreement is arithmetic and it is
 * caught here rather than on somebody's phone.
 */
import { describe, it, expect } from 'vitest';
import { trainingWeekWindow } from '@/lib/notifications/week-window';
import { weekWindowFor } from '@/lib/coach/week-window';
import { weekStartBoundaryOf, requestedBlockStartISO } from './generate';
import { shapePlanWeekDays, type PlanWorkoutRow } from './week-loader';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

const plusDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dowOf = (iso: string) => new Date(iso + 'T12:00:00Z').getUTCDay();

/** A year of dates, so the sweep crosses both DST transitions, both month
 *  boundaries either side of them, and the year edge. */
const DATES = Array.from({ length: 371 }, (_, i) => plusDays('2026-01-01', i));

describe('every reader of "this week" names the same seven days', () => {
  it('the strip window and the totals window are one window', () => {
    const off: string[] = [];
    for (const longRunDay of DAYS)
      for (const iso of DATES) {
        const a = trainingWeekWindow(iso, dowOf(iso), DAYS.indexOf(longRunDay));
        const b = weekWindowFor(longRunDay, iso);
        if (a.week_start_iso !== b.startISO || a.week_end_iso !== b.endISO) {
          off.push(`${longRunDay}/${iso}: strip ${a.week_start_iso}..${a.week_end_iso} vs totals ${b.startISO}..${b.endISO}`);
        }
      }
    expect(off.slice(0, 20), 'the strip and the week totals are measuring different weeks').toEqual([]);
  });

  it('the week the block is AUTHORED in is the week it is READ in', () => {
    // The cross-check that was missing. `weekStartBoundaryOf` decides where a
    // plan_weeks row begins; `trainingWeekWindow` decides which seven days the
    // strip draws. Anchor a block on any day, and the week containing that day
    // must be the week the block starts on.
    const off: string[] = [];
    for (const longRunDay of DAYS)
      for (const iso of DATES) {
        const longRunDow = DAYS.indexOf(longRunDay);
        const anchor = weekStartBoundaryOf(iso, (longRunDow + 1) % 7);
        const win = trainingWeekWindow(iso, dowOf(iso), longRunDow);
        if (anchor !== win.week_start_iso) {
          off.push(`${longRunDay}/${iso}: authored week starts ${anchor}, read window starts ${win.week_start_iso}`);
        }
        // ...and the clip can never reach past the week it is clipping.
        const gap = Math.round((Date.parse(iso + 'T12:00:00Z') - Date.parse(anchor + 'T12:00:00Z')) / 86400000);
        if (gap < 0 || gap > 6) off.push(`${longRunDay}/${iso}: anchor is ${gap} days from the start day`);
      }
    expect(off.slice(0, 20), 'the block is authored in weeks the strip cannot read back whole').toEqual([]);
  });

  it('a block authored on the boundary reads back as whole weeks, and week 0 is the only short one', () => {
    // The end-to-end shape, with no database: author a block on the boundary
    // the way `loadGeneratorInputs` does, clip week 0 the way `persistPlan`
    // does, then read every week back the way the strip does. Every week after
    // the first must contain seven authored days.
    const off: string[] = [];
    for (const longRunDay of DAYS)
      for (let signupShift = 0; signupShift < 7; signupShift++) {
        const longRunDow = DAYS.indexOf(longRunDay);
        const signupISO = plusDays('2026-03-02', signupShift);
        const clipBefore = requestedBlockStartISO(signupISO, 'today', undefined);
        expect(clipBefore, 'the today anchor must name a first day').toBe(signupISO);
        const anchor = weekStartBoundaryOf(signupISO, (longRunDow + 1) % 7);

        const rows: PlanWorkoutRow[] = [];
        for (let wi = 0; wi < 6; wi++)
          for (let i = 0; i < 7; i++) {
            const date = plusDays(anchor, wi * 7 + i);
            if (clipBefore && date < clipBefore) continue;   // persistPlan's clip
            rows.push({
              id: `w${wi}d${i}`, date_iso: date, dow: dowOf(date),
              type: dowOf(date) === longRunDow ? 'long' : 'easy',
              distance_mi: dowOf(date) === longRunDow ? '10' : '4',
              sub_label: null,
            });
          }

        // Nothing before the runner arrived.
        const early = rows.filter((r) => r.date_iso < signupISO);
        if (early.length > 0) off.push(`${longRunDay}/signup ${signupISO}: ${early.length} rows predate the runner`);

        for (let wi = 0; wi < 6; wi++) {
          const weekStart = plusDays(anchor, wi * 7);
          const probe = plusDays(weekStart, 3);
          const win = trainingWeekWindow(probe, dowOf(probe), longRunDow);
          if (win.week_start_iso !== weekStart) {
            off.push(`${longRunDay}/signup ${signupISO}: week ${wi} starts ${weekStart}, the strip reads ${win.week_start_iso}`);
            continue;
          }
          const inWindow = rows.filter((r) => r.date_iso >= win.week_start_iso && r.date_iso <= win.week_end_iso);
          const shaped = shapePlanWeekDays(inWindow, {
            weekStart: win.week_start_iso, today: probe,
            actualByDate: new Map(), skippedDates: new Set(),
          });
          // The strip always emits seven days; what matters is that every one
          // of them is a day the block actually authored, from week 1 on.
          const authored = shaped.filter((d) => d.plan_workout_id != null).length;
          if (wi > 0 && authored !== 7) {
            off.push(`${longRunDay}/signup ${signupISO}: week ${wi} shows ${authored} authored days, not 7`);
          }
          // The strip's total must equal the sum of the rows in the window —
          // the pair that disagreed on a live phone.
          const stripMi = shaped.reduce((s, d) => s + d.distance_mi, 0);
          const rowMi = inWindow.reduce((s, r) => s + Number(r.distance_mi), 0);
          if (Math.abs(stripMi - rowMi) > 0.001) {
            off.push(`${longRunDay}/signup ${signupISO}: week ${wi} strip ${stripMi} vs rows ${rowMi}`);
          }
        }
      }
    expect(off.slice(0, 20), 'an authored block does not read back as whole weeks').toEqual([]);
  });

  it('the lifecycle anchor names no first day, so a regen keeps the week it is in', () => {
    // The other half of `requestedBlockStartISO`. A rebuild mid-week must NOT
    // clip: Rule 15 re-seals the days already run from the prior plan, and
    // dropping them would erase the prescriptions the runner trained against.
    for (const iso of DATES.slice(0, 30)) {
      expect(requestedBlockStartISO(iso, 'monday', undefined)).toBeNull();
      // An explicit future start still names one...
      expect(requestedBlockStartISO(iso, 'monday', plusDays(iso, 3))).toBe(plusDays(iso, 3));
      // ...and a start in the past does not, because it is not a day the
      // runner can be given.
      expect(requestedBlockStartISO(iso, 'monday', plusDays(iso, -3))).toBeNull();
    }
  });
});
