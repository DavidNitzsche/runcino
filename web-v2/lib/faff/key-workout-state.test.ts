import { describe, it, expect } from 'vitest';
import { keyWorkoutState, MISSED_COLOR } from './key-workout-state';

const NOW = 10;

describe('keyWorkoutState', () => {
  it('THE BUG · a past incomplete workout reads MISSED, not DONE', () => {
    expect(keyWorkoutState(7, NOW, false)).toBe('MISSED');
  });

  it('a past completed workout reads DONE', () => {
    expect(keyWorkoutState(7, NOW, true)).toBe('DONE');
  });

  it('two workouts in the SAME past week disagree when execution did', () => {
    // The defect could not surface this: `state` was computed once per
    // week, so both of these were DONE. The week is the frame; the flag
    // is the fact.
    expect(keyWorkoutState(4, NOW, true)).toBe('DONE');
    expect(keyWorkoutState(4, NOW, false)).toBe('MISSED');
  });

  it('the current week is live · incomplete is NOW, not MISSED', () => {
    expect(keyWorkoutState(NOW, NOW, false)).toBe('NOW');
  });

  it('the current week still reports a workout already run as DONE', () => {
    expect(keyWorkoutState(NOW, NOW, true)).toBe('DONE');
  });

  it('future weeks carry no badge', () => {
    expect(keyWorkoutState(NOW + 1, NOW, false)).toBe('');
    // A future row flagged done is not a state we expect, but it must not
    // read MISSED — the badge follows the flag, and DONE is the honest
    // answer for a workout the runner completed early.
    expect(keyWorkoutState(NOW + 3, NOW, true)).toBe('DONE');
  });

  it('week 0 with nowIdx 0 is the current week, not the past', () => {
    expect(keyWorkoutState(0, 0, false)).toBe('NOW');
  });

  it('MISSED is not painted in the Off/warn alarm red', () => {
    // Brief v2 §1 · #FC4D64 is "behind goal, off-track, warning signal".
    // A missed session is a record of what happened, not a verdict on the
    // block, so it takes the neutral register instead.
    expect(MISSED_COLOR).not.toBe('#FC4D64');
    expect(MISSED_COLOR).not.toBe('#D03F3F');
    expect(MISSED_COLOR).toBe('#8A90A0');
  });
});

describe('the rolling KEY WORKOUTS window', () => {
  /**
   * TrainView keeps the list pointed at upcoming work with
   * `out.filter(m => !m.done && !m.raceRow)`. Combined with the week-level
   * derivation, that meant the only past rows that ever reached the screen
   * were the incomplete ones — every visible past row was a missed session
   * stamped DONE. This asserts the pairing now produces the right badge.
   */
  const rows = [
    { weekIdx: 3, done: true },
    { weekIdx: 3, done: false },
    { weekIdx: 8, done: false },
    { weekIdx: NOW, done: false },
    { weekIdx: NOW + 2, done: false },
  ];

  it('every row surviving the !done filter is MISSED, NOW or blank', () => {
    const visible = rows
      .filter((r) => !r.done)
      .map((r) => keyWorkoutState(r.weekIdx, NOW, r.done));

    expect(visible).toEqual(['MISSED', 'MISSED', 'NOW', '']);
    expect(visible).not.toContain('DONE');
  });
});
