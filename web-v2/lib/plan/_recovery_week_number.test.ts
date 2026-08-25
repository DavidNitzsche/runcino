import { describe, it, expect } from 'vitest';
import { composeRecoveryPlan } from './generate';

/**
 * RECOVERY-2's comment has said since 2026-06-23 that "a mid-recovery REGEN
 * must not restart at week 1". The offset reached the taper row, the run-day
 * cap and the final-week test. It never reached the LABEL.
 *
 * David, on day nine of a fourteen-day half-marathon recovery, reading his
 * own Today screen: "still says week 1 of 1. its week 2 of 2. concerning."
 *
 * The block held one week because one was left — not because recovery is one
 * week long.
 */
describe('recovery · a week knows its number within the recovery', () => {
  const halfRecovery = (daysSinceRace: number) => {
    const race = '2026-08-16';
    const start = new Date(Date.parse(race + 'T12:00:00Z') + daysSinceRace * 86400000)
      .toISOString().slice(0, 10);
    return composeRecoveryPlan({
      startMondayISO: start,
      lastRaceFinished: { date: race, distanceMi: 13.1, priority: 'A' },
      recentWeeklyMi: 33,
      recentPeakWeeklyMi: 40,
      longRunDay: 'sun',
      weeklyFrequency: 5,
    } as never);
  };

  it('authored the day after the race starts at week one', () => {
    const p = halfRecovery(1);
    expect(p.weeks[0].blockWeekIdx ?? 0).toBe(0);
  });

  it('authored EIGHT days on states week two, not week one', () => {
    // His case exactly: race 2026-08-16, block authored for the week of
    // 2026-08-24. One week remains, and it is the SECOND.
    const p = halfRecovery(8);
    expect(p.weeks.length).toBe(1);
    expect(p.weeks[0].blockWeekIdx).toBe(1);
  });

  it('the number it claims is what a Week N of M line would read', () => {
    const p = halfRecovery(8);
    const idx = p.weeks[0].blockWeekIdx ?? 0;
    // The route reads MAX(week_idx)+1 as the denominator, so a block whose
    // only week claims index 1 reads "of 2" rather than "of 1".
    expect(`Week ${idx + 1} of ${idx + 1}`).toBe('Week 2 of 2');
  });

  it('CONTROL · the array position alone would have said week one', () => {
    // Guards the fixture: if the composer ever emits every recovery week
    // including elapsed ones, this test is measuring the wrong thing and
    // should be rewritten rather than quietly passing.
    const p = halfRecovery(8);
    expect(p.weeks.length).toBe(1);
    expect(p.weeks[0].blockWeekIdx).not.toBe(0);
  });
});
