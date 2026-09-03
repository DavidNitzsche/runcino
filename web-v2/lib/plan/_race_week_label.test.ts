/**
 * RACEWEEK-1 · a week the runner races in never reads as an ordinary week.
 *
 * FALSIFIED against the real defect before it landed: with `weekFlag` reading
 * `isRaceWeek` alone, the first case here returns "QUALITY" — which is what the
 * owner's Block screen actually said over his Santa Monica 10K week, with the
 * race ten days away. The fixture below is his live row shape, not an invented
 * one: week starting 2026-09-07, `is_race_week` FALSE, a 6.2 mi day typed
 * `race` on 2026-09-13.
 *
 * WHAT THIS GATE CANNOT FAIL ON (Rule 22):
 *   · It checks the LABEL, not the coaching. If a tune-up race week should also
 *     suppress quality or pull the workout library into race-week mode, nothing
 *     here would notice — those read `is_race_week` directly and deliberately
 *     still do. That is an open decision for the owner.
 *   · It cannot see a race the PLAN does not know about. A race the runner
 *     enters without adding it writes no `type: 'race'` day, and this reports a
 *     perfectly ordinary week, correctly and uselessly.
 *   · It says nothing about whether the composer SHOULD have set the column.
 */
import { describe, it, expect } from 'vitest';
import { weekFlag } from './v5-block';
import { isGoalRaceWeek, weekContainsRace, racePresence } from './race-week';

/** His live week 2, verbatim in shape. */
const tuneUpWeek = {
  id: 'wk_x', idx: 2, phase: 'QUALITY', startDate: '2026-09-07', plannedMi: 44,
  isRaceWeek: false, isCutback: false, isCurrent: false,
  days: [
    { id: 'd1', date: '2026-09-08', dow: 2, type: 'easy', mi: 6, label: null },
    { id: 'd2', date: '2026-09-13', dow: 0, type: 'race', mi: 6.2, label: 'RACE' },
  ],
} as never;

const goalWeek = {
  id: 'wk_g', idx: 14, phase: 'TAPER', startDate: '2026-11-30', plannedMi: 26,
  isRaceWeek: true, isCutback: false, isCurrent: false,
  days: [{ id: 'd', date: '2026-12-06', dow: 0, type: 'race', mi: 26.22, label: 'RACE' }],
} as never;

const ordinaryWeek = {
  id: 'wk_o', idx: 3, phase: 'QUALITY', startDate: '2026-09-14', plannedMi: 46,
  isRaceWeek: false, isCutback: false, isCurrent: false,
  days: [{ id: 'd', date: '2026-09-16', dow: 3, type: 'tempo', mi: 8, label: null }],
} as never;

describe('RACEWEEK-1 · the label names the week the runner actually has', () => {
  it('labels a tune-up race week as a race week, not by its phase', () => {
    // The regression this exists for: this returned 'QUALITY'.
    expect(weekFlag(tuneUpWeek)).toBe('Race week');
  });

  it('still labels the goal race week', () => {
    expect(weekFlag(goalWeek)).toBe('Race week');
  });

  it('leaves an ordinary week alone', () => {
    expect(weekFlag(ordinaryWeek)).not.toBe('Race week');
  });

  it('keeps the two quantities apart — the tune-up week is NOT the goal week', () => {
    expect(weekContainsRace(tuneUpWeek)).toBe(true);
    expect(isGoalRaceWeek(tuneUpWeek)).toBe(false);
    expect(isGoalRaceWeek(goalWeek)).toBe(true);
  });

  it('reports an unreadable week as unreadable, never as "no race" (Rule 11)', () => {
    expect(racePresence({ isRaceWeek: false, days: null })).toBe('unreadable');
    expect(racePresence({ isRaceWeek: false, days: [] })).toBe('none');
    expect(racePresence({ isRaceWeek: true, days: null })).toBe('goal-race');
  });
});
