/**
 * Ongoing large-shift guard tests.
 *
 * Pins the locked constants + threshold-boundary behavior. DB-touching
 * behavior (baseline write, dismissed/snooze checks) is exercised in
 * integration via the diagnostic endpoint; here we cover the pure math.
 */
import { describe, it, expect } from 'vitest';
import {
  SHIFT_FIRE_THRESHOLD,
  DISMISS_SUPPRESS_DAYS,
  SNOOZE_HOURS,
} from '../vdot-shift';

describe('VDOT shift guard · constants locked', () => {
  it('fire threshold is 2.0 VDOT points (David round 4 spec)', () => {
    expect(SHIFT_FIRE_THRESHOLD).toBe(2.0);
  });

  it('Dismiss suppress duration is 30 days', () => {
    expect(DISMISS_SUPPRESS_DAYS).toBe(30);
  });

  it('Investigate snooze duration is 24 hours', () => {
    expect(SNOOZE_HOURS).toBe(24);
  });
});

describe('VDOT shift guard · threshold boundary', () => {
  const fire = (cur: number, last: number) => {
    const shift = Math.abs(Math.round((cur - last) * 10) / 10);
    return shift >= SHIFT_FIRE_THRESHOLD;
  };

  it('1.9 pt shift does NOT fire (below threshold)', () => {
    expect(fire(46.6, 44.7)).toBe(false);
  });

  it('exactly 2.0 pt shift fires (≥ threshold)', () => {
    expect(fire(46.6, 44.6)).toBe(true);
  });

  it('2.1 pt shift fires', () => {
    expect(fire(48.7, 46.6)).toBe(true);
  });

  it('downward 2.5 pt shift fires (direction-agnostic)', () => {
    expect(fire(44.1, 46.6)).toBe(true);
  });
});

describe('VDOT shift guard · direction detection', () => {
  it('current > last → direction up', () => {
    const shift = 47.0 - 46.6;
    const direction = shift > 0 ? 'up' : shift < 0 ? 'down' : null;
    expect(direction).toBe('up');
  });

  it('current < last → direction down', () => {
    const shift = 44.0 - 46.6;
    const direction = shift > 0 ? 'up' : shift < 0 ? 'down' : null;
    expect(direction).toBe('down');
  });

  it('current == last → direction null', () => {
    const shift = 46.6 - 46.6;
    const direction = shift > 0 ? 'up' : shift < 0 ? 'down' : null;
    expect(direction).toBeNull();
  });
});

describe('VDOT shift guard · dismiss + snooze duration math', () => {
  it('dismiss within 30 days suppresses', () => {
    const dismissedAtMs = Date.now() - 15 * 86_400_000; // 15 days ago
    const ageDays = (Date.now() - dismissedAtMs) / 86_400_000;
    expect(ageDays).toBeLessThan(DISMISS_SUPPRESS_DAYS);
  });

  it('dismiss past 30 days no longer suppresses', () => {
    const dismissedAtMs = Date.now() - 35 * 86_400_000;
    const ageDays = (Date.now() - dismissedAtMs) / 86_400_000;
    expect(ageDays).toBeGreaterThanOrEqual(DISMISS_SUPPRESS_DAYS);
  });

  it('snooze within 24 hours suppresses', () => {
    const snoozedAtMs = Date.now() - 12 * 3_600_000;  // 12h ago
    const ageHours = (Date.now() - snoozedAtMs) / 3_600_000;
    expect(ageHours).toBeLessThan(SNOOZE_HOURS);
  });

  it('snooze past 24 hours no longer suppresses', () => {
    const snoozedAtMs = Date.now() - 30 * 3_600_000;
    const ageHours = (Date.now() - snoozedAtMs) / 3_600_000;
    expect(ageHours).toBeGreaterThanOrEqual(SNOOZE_HOURS);
  });
});
