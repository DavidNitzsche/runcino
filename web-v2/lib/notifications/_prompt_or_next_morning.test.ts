/**
 * promptOrNextMorning — the recovery→next-block coach note's delivery timing.
 *
 * 2026-08-30 · David's own ask: "I don't love waking up blind Monday am to
 * a new plan." Root cause was recoveryCompleteDue's strict `<` (see
 * lib/plan/race-lifecycle.ts) — same-day-eligible now, paired with a second
 * evening cron tick (.github/workflows/plan-drift.yml). This file is the
 * OTHER half: nextMorning0715 alone would have taken a 9pm-triggered
 * transition and pushed its notification to the NEXT day's 7:15am, quietly
 * recreating the exact problem being fixed, one layer down.
 *
 * The rule under test: fire close to now during a reasonable window
 * (07:00–21:30 local), defer to the next 7:15am outside it.
 */
import { describe, it, expect } from 'vitest';
import { promptOrNextMorning } from './enqueue';

const TZ = 'America/Los_Angeles';

/** Build a UTC instant for a given PT wall-clock hour:minute on a fixed
 *  August date (PDT, UTC-7, matches the doc comment's own math). */
function ptInstant(hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 7, 30, hour + 7, minute, 0));
}

describe('promptOrNextMorning · fires close to now in a reasonable window', () => {
  it('9pm PT (the new evening cron tick) fires within the minute, not next-morning', () => {
    const now = ptInstant(21, 0);
    const fireAt = promptOrNextMorning(now, TZ);
    const deltaMs = fireAt.getTime() - now.getTime();
    expect(deltaMs).toBeGreaterThanOrEqual(0);
    expect(deltaMs).toBeLessThanOrEqual(120_000);
  });

  it('mid-afternoon fires close to now', () => {
    const now = ptInstant(14, 30);
    const fireAt = promptOrNextMorning(now, TZ);
    expect(fireAt.getTime() - now.getTime()).toBeLessThanOrEqual(120_000);
  });

  it('right at the 07:00 open of the window fires close to now', () => {
    const now = ptInstant(7, 0);
    const fireAt = promptOrNextMorning(now, TZ);
    expect(fireAt.getTime() - now.getTime()).toBeLessThanOrEqual(120_000);
  });

  it('just before the 07:00 open still waits for 7:15 (same morning)', () => {
    const now = ptInstant(6, 59);
    const fireAt = promptOrNextMorning(now, TZ);
    // Same PT calendar day, 07:15 — a few minutes later, not next-morning.
    const fireHourFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', day: '2-digit',
    });
    const parts: Record<string, string> = {};
    for (const p of fireHourFmt.formatToParts(fireAt)) parts[p.type] = p.value;
    expect(parts.day).toBe('30');
    expect(`${parts.hour}:${parts.minute}`).toBe('07:15');
  });

  it('9:30pm boundary (21:30) is outside the window — defers to next morning', () => {
    const now = ptInstant(21, 30);
    const fireAt = promptOrNextMorning(now, TZ);
    const deltaMs = fireAt.getTime() - now.getTime();
    // Deferred well past a couple minutes — to tomorrow 7:15am.
    expect(deltaMs).toBeGreaterThan(3 * 60 * 60 * 1000);
  });

  it("2am PT (the original morning cron tick) still waits for 7:15 THAT SAME morning, not tomorrow", () => {
    const now = ptInstant(2, 0);
    const fireAt = promptOrNextMorning(now, TZ);
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', day: '2-digit',
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(fireAt)) parts[p.type] = p.value;
    expect(parts.day).toBe('30'); // same day, not the 31st
    expect(`${parts.hour}:${parts.minute}`).toBe('07:15');
  });

  it('with no timezone available, falls back to server-local next-morning-0715 (never throws)', () => {
    const now = new Date('2026-08-30T20:00:00Z');
    expect(() => promptOrNextMorning(now)).not.toThrow();
  });
});
