/**
 * lib/faff/_logged_at.test.ts — the after-run panel says WHEN, not how long.
 *
 * The slot printed `Logged ${fmtClock(durationSec)}`: the elapsed time,
 * formatted as a clock, under a word that means "at". An eleven-mile run read
 * "Logged 1:28:18" — nonsense as a time of day, and the same figure already
 * standing in the stats row two lines below.
 *
 * The 0821 README names this exact case: "No content is ever printed twice on
 * one screen (e.g. elapsed time appears once, not repeated in a stats plate
 * below it)."
 */
import { describe, it, expect } from 'vitest';
import { loggedAtLine } from './v5-today';

describe('loggedAtLine', () => {
  it('reads the wall clock out of a local timestamp', () => {
    expect(loggedAtLine('2026-08-23T07:04:00')).toBe('Logged 7:04am');
  });

  it('disambiguates an evening run', () => {
    // The drawn example is a morning run, where a bare "7:04" reads fine. The
    // same format at 19:04 also says 7:04, which is a value the runner cannot
    // interpret — the rule this poster is built on.
    expect(loggedAtLine('2026-08-23T19:04:00')).toBe('Logged 7:04pm');
  });

  it('handles both ends of the clock', () => {
    expect(loggedAtLine('2026-08-23T00:30:00')).toBe('Logged 12:30am');
    expect(loggedAtLine('2026-08-23T12:00:00')).toBe('Logged 12:00pm');
  });

  it('never emits a duration', () => {
    // The regression itself. A duration has no `T`, so it can never be
    // mistaken for a timestamp by this function.
    expect(loggedAtLine('1:28:18')).toBeNull();
    expect(loggedAtLine('5028')).toBeNull();
  });

  it('is null rather than a substitute when there is no start time', () => {
    // An empty slot is honest. The duration in it was not.
    expect(loggedAtLine(null)).toBeNull();
    expect(loggedAtLine('')).toBeNull();
    expect(loggedAtLine('2026-08-23')).toBeNull();
  });

  it('refuses an impossible hour rather than printing it', () => {
    expect(loggedAtLine('2026-08-23T99:04:00')).toBeNull();
  });
});
