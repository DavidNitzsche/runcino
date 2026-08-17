/**
 * mapType invariants (2026-08-17 · extracted from seed.ts).
 *
 * The load-bearing lock: race_week_tuneup maps to a QUALITY bucket
 * (tempo), never 'easy' — the fall-through rendered a taper-week
 * race-pace rehearsal as a cyan EASY hero on web.
 */
import { describe, it, expect } from 'vitest';
import { mapType } from './effort-map';

describe('mapType', () => {
  it('race_week_tuneup is quality (tempo bucket), not easy', () => {
    expect(mapType('race_week_tuneup')).toBe('tempo');
    expect(mapType('RACE_WEEK_TUNEUP')).toBe('tempo');
  });

  it('true race rows map to race · quality race_* subtypes do not', () => {
    expect(mapType('race')).toBe('race');
    expect(mapType('race_a')).toBe('race');
    expect(mapType('race_b_10k')).toBe('race');
    // race_pace / race_simulation are quality subtypes, not race morning
    expect(mapType('race_pace')).not.toBe('race');
    expect(mapType('race_simulation')).not.toBe('race');
    // and the tune-up must not swallow them into 'race' either
    expect(mapType('race_week_tuneup')).not.toBe('race');
  });

  it('nothing planned reads as rest (honesty pass 2026-06-10)', () => {
    expect(mapType('')).toBe('rest');
    expect(mapType(null)).toBe('rest');
    expect(mapType(undefined)).toBe('rest');
    expect(mapType('unplanned')).toBe('rest');
    expect(mapType('rest')).toBe('rest');
  });

  it('standard buckets are stable', () => {
    expect(mapType('long')).toBe('long');
    expect(mapType('threshold')).toBe('tempo');
    expect(mapType('tempo')).toBe('tempo');
    expect(mapType('intervals')).toBe('intervals');
    expect(mapType('vo2max')).toBe('intervals');
    expect(mapType('recovery')).toBe('recovery');
    expect(mapType('shakeout')).toBe('recovery');
    expect(mapType('easy')).toBe('easy');
  });
});
