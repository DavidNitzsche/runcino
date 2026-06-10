/**
 * 2026-06-09 · race-killer F2 regression tests.
 *
 * parseRaceTime is now the ONE race-clock parser — every surface that
 * reads a goal/finish string (web race-day hero, GapPanel, TrainView
 * purpose copy, phase-focus, RaceView goal editor, retrospective form;
 * iPhone mirrors it as RaceClock in API.swift) delegates here.
 *
 * The bug class these lock down: the stored AFC goal is "1:30" (h:mm,
 * no seconds). Private 2-part parsers read it as 90 seconds, so the
 * first-ever race-morning render would have shown 5K split "0:21",
 * B-goal "8:30", and goal pace "0:07/mi". Cite: vdot.ts:137-144,
 * docs/ADVERSARIAL-AUDIT-REPORT.md §F2.
 */
import { describe, expect, it } from 'vitest';
import { parseRaceTime } from './vdot';

describe('parseRaceTime — the shared race-clock parser', () => {
  it('parses the production AFC goal "1:30" as 1h30m, never 90s', () => {
    expect(parseRaceTime('1:30')).toBe(5400);
  });

  it('parses full H:MM:SS finish times', () => {
    expect(parseRaceTime('1:34:54')).toBe(5694);   // Disney HM · VDOT anchor
    expect(parseRaceTime('1:38:38')).toBe(5918);   // Rose Bowl HM
    expect(parseRaceTime('3:31:40')).toBe(12700);  // LA Marathon
  });

  it('keeps MM:SS for short-race times (first part > 9)', () => {
    expect(parseRaceTime('23:15')).toBe(23 * 60 + 15); // 5K finish
    expect(parseRaceTime('45:00')).toBe(2700);         // 10K goal
    expect(parseRaceTime('59:59')).toBe(3599);
  });

  it('treats small first parts as hours (goal shorthand)', () => {
    expect(parseRaceTime('3:00')).toBe(10800);  // sub-3 marathon goal
    expect(parseRaceTime('0:45')).toBe(2700);   // 10K goal written 0:45
    expect(parseRaceTime('9:59')).toBe(9 * 3600 + 59 * 60); // ultra goal edge
  });

  it('converges every way of writing ninety minutes to 5400 (task brief edge cases)', () => {
    expect(parseRaceTime('1:30')).toBe(5400);    // h:mm goal shorthand
    expect(parseRaceTime('1:30:00')).toBe(5400); // full h:mm:ss
    expect(parseRaceTime('90:00')).toBe(5400);   // mm:ss long-form (90 > 9 → minutes)
    expect(parseRaceTime('1:30:30')).toBe(5430); // h:mm:ss with seconds
  });

  it('derives sane race-morning numbers from the production meta', () => {
    // The exact computations RaceDayHero / RaceDayView run on Aug 16.
    const goalSec = parseRaceTime('1:30')!;
    const distanceMi = 13.1;
    const goalPaceSPerMi = Math.round(goalSec / distanceMi);
    expect(goalPaceSPerMi).toBe(412);                       // 6:52/mi, not 0:07/mi
    const bGoal = goalSec + 420;
    expect(bGoal).toBe(5820);                               // 1:37:00, not 8:30
    const split5k = Math.round((3.1069 / distanceMi) * goalSec);
    expect(split5k).toBeGreaterThan(1200);                  // ~21:21, not 0:21
    expect(split5k).toBeLessThan(1330);
  });

  it('rejects malformed input', () => {
    expect(parseRaceTime('1:5')).toBeNull();     // trailing part must be 2 digits
    expect(parseRaceTime('90')).toBeNull();      // no colon
    expect(parseRaceTime('')).toBeNull();
    expect(parseRaceTime(null)).toBeNull();
    expect(parseRaceTime(undefined)).toBeNull();
    expect(parseRaceTime('·')).toBeNull();
    expect(parseRaceTime('a:bc')).toBeNull();
  });
});
