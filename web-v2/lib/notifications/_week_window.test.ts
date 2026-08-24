/**
 * lib/notifications/_week_window.test.ts — the week runs Sunday to Saturday.
 *
 * This is THE boundary. The plan week (iPhone strip, training calendar,
 * Today's own day resolution) and the weekly check-in cron both read it, so
 * if it drifts the strip and the totals disagree — which is exactly what
 * happened when the check-in anchored to ISO Monday on its own and split a
 * Saturday-long runner's week in two.
 */
import { describe, it, expect } from 'vitest';
import { trainingWeekWindow } from './week-window';

describe('trainingWeekWindow', () => {
  it('runs Sunday to Saturday', () => {
    // Sun 2026-08-23 … Sat 2026-08-29.
    expect(trainingWeekWindow('2026-08-23', 0)).toEqual({
      week_start_iso: '2026-08-23', week_end_iso: '2026-08-29',
    });
  });

  it('puts every day of that week in the same window', () => {
    const days: Array<[string, number]> = [
      ['2026-08-23', 0], ['2026-08-24', 1], ['2026-08-25', 2], ['2026-08-26', 3],
      ['2026-08-27', 4], ['2026-08-28', 5], ['2026-08-29', 6],
    ];
    for (const [iso, dow] of days) {
      expect(trainingWeekWindow(iso, dow)).toEqual({
        week_start_iso: '2026-08-23', week_end_iso: '2026-08-29',
      });
    }
  });

  it('rolls to the next window on the following Sunday', () => {
    expect(trainingWeekWindow('2026-08-30', 0)).toEqual({
      week_start_iso: '2026-08-30', week_end_iso: '2026-09-05',
    });
  });

  it('ignores the long-run day it is still handed', () => {
    // The parameter is accepted so no call site had to change, and is
    // deliberately unused. Every long-run day must give the same window.
    for (let longRunDow = 0; longRunDow < 7; longRunDow++) {
      expect(trainingWeekWindow('2026-08-25', 2, longRunDow)).toEqual({
        week_start_iso: '2026-08-23', week_end_iso: '2026-08-29',
      });
    }
  });

  it('is anchored at noon so a DST transition cannot shift the date', () => {
    // US DST ends Sun 2026-11-01. The window must still start on it.
    expect(trainingWeekWindow('2026-11-04', 3)).toEqual({
      week_start_iso: '2026-11-01', week_end_iso: '2026-11-07',
    });
    // And begins Sun 2026-03-08.
    expect(trainingWeekWindow('2026-03-11', 3)).toEqual({
      week_start_iso: '2026-03-08', week_end_iso: '2026-03-14',
    });
  });

  it('always spans exactly seven days', () => {
    for (let i = 0; i < 40; i++) {
      const d = new Date(Date.parse('2026-01-04T12:00:00Z') + i * 86400000);
      const iso = d.toISOString().slice(0, 10);
      const w = trainingWeekWindow(iso, d.getUTCDay());
      const span = (Date.parse(w.week_end_iso + 'T12:00:00Z')
                  - Date.parse(w.week_start_iso + 'T12:00:00Z')) / 86400000;
      expect(span).toBe(6);
      expect(new Date(w.week_start_iso + 'T12:00:00Z').getUTCDay()).toBe(0);
      expect(new Date(w.week_end_iso + 'T12:00:00Z').getUTCDay()).toBe(6);
    }
  });
});
