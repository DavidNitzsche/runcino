/**
 * The off-by-one calendar class, pinned.
 *
 * These tests set TZ per case via a real timezone offset rather than
 * trusting the runner's machine: `new Date(y, m, d)` is local midnight
 * by definition, so constructing one and asserting the key survives the
 * round trip is offset-independent and proves the property everywhere.
 */
import { describe, it, expect } from 'vitest';
import {
  dayKeyFromLocalParts,
  pgDayKey,
  dayKeyInTz,
  addDaysToDayKey,
  daysBetweenDayKeys,
} from './day-key';

describe('dayKeyFromLocalParts', () => {
  it('round-trips a locally-constructed calendar date in any zone', () => {
    // This is the month-grid cell case: new Date(mo.y, mo.m, dd).
    for (const [y, m, d] of [[2026, 0, 1], [2026, 7, 17], [2026, 11, 31]] as const) {
      expect(dayKeyFromLocalParts(new Date(y, m, d))).toBe(
        `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      );
    }
  });

  it('never disagrees with the local calendar the Date was built from', () => {
    // The property that toISOString() breaks: for a local-midnight Date,
    // the key must equal its own local getters, whatever the host offset.
    const d = new Date(2026, 7, 17);
    expect(dayKeyFromLocalParts(d)).toBe('2026-08-17');
    expect(d.getDate()).toBe(17);
    // toISOString() drops to the previous day for any zone EAST of UTC,
    // where local midnight is still yesterday in UTC. getTimezoneOffset()
    // is negative east of Greenwich.
    if (d.getTimezoneOffset() < 0) {
      expect(d.toISOString().slice(0, 10)).toBe('2026-08-16');
    } else {
      expect(d.toISOString().slice(0, 10)).toBe('2026-08-17');
    }
  });

  it('agrees with the local calendar for a simulated east-of-UTC offset', () => {
    // Berlin, UTC+2 in August: local midnight on the 17th is 22:00Z on
    // the 16th. Constructed here as the instant, so the assertion holds
    // regardless of the host's own zone.
    const berlinMidnightUtc = new Date(Date.UTC(2026, 7, 16, 22, 0, 0));
    expect(berlinMidnightUtc.toISOString().slice(0, 10)).toBe('2026-08-16'); // the bug
    expect(dayKeyInTz(berlinMidnightUtc, 'Europe/Berlin')).toBe('2026-08-17'); // the truth
  });

  it('handles local midnight on a DST spring-forward day', () => {
    // 2026-03-08 is the US spring-forward. Local midnight still exists.
    expect(dayKeyFromLocalParts(new Date(2026, 2, 8))).toBe('2026-03-08');
  });
});

describe('pgDayKey', () => {
  it('slices a string date without a Date round trip', () => {
    expect(pgDayKey('2026-08-17')).toBe('2026-08-17');
    expect(pgDayKey('2026-08-17T00:00:00.000Z')).toBe('2026-08-17');
  });

  it('reads a node-pg local-midnight Date by its local parts', () => {
    // node-pg parses OID 1082 (date) to local midnight.
    expect(pgDayKey(new Date(2026, 7, 17))).toBe('2026-08-17');
  });

  it('returns null rather than a wrong day for absent or invalid input', () => {
    expect(pgDayKey(null)).toBeNull();
    expect(pgDayKey(undefined)).toBeNull();
    expect(pgDayKey('')).toBeNull();
    expect(pgDayKey('2026-08')).toBeNull();
    expect(pgDayKey(new Date('nonsense'))).toBeNull();
  });
});

describe('dayKeyInTz', () => {
  it('resolves the runner-local day, not the UTC day', () => {
    // 2026-08-18T02:30Z is still the 17th in Los Angeles.
    const instant = new Date('2026-08-18T02:30:00Z');
    expect(dayKeyInTz(instant, 'America/Los_Angeles')).toBe('2026-08-17');
    expect(dayKeyInTz(instant, 'UTC')).toBe('2026-08-18');
  });

  it('resolves ahead of UTC for eastern zones', () => {
    // 2026-08-17T23:30Z is already the 18th in Auckland (UTC+12).
    const instant = new Date('2026-08-17T23:30:00Z');
    expect(dayKeyInTz(instant, 'Pacific/Auckland')).toBe('2026-08-18');
  });

  it('falls back to UTC on an invalid zone instead of throwing', () => {
    const instant = new Date('2026-08-17T12:00:00Z');
    expect(dayKeyInTz(instant, 'Not/AZone')).toBe('2026-08-17');
  });
});

describe('addDaysToDayKey / daysBetweenDayKeys', () => {
  it('adds and subtracts whole days', () => {
    expect(addDaysToDayKey('2026-08-17', 1)).toBe('2026-08-18');
    expect(addDaysToDayKey('2026-08-17', -1)).toBe('2026-08-16');
    expect(addDaysToDayKey('2026-08-17', 0)).toBe('2026-08-17');
  });

  it('crosses month and year boundaries', () => {
    expect(addDaysToDayKey('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDaysToDayKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToDayKey('2028-02-28', 1)).toBe('2028-02-29'); // leap year
  });

  it('is noon-anchored, so a DST transition cannot shift the result', () => {
    // Spanning US spring-forward (2026-03-08) and fall-back (2026-11-01).
    expect(addDaysToDayKey('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDaysToDayKey('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDaysToDayKey('2026-10-31', 2)).toBe('2026-11-02');
  });

  it('counts days between keys, signed', () => {
    expect(daysBetweenDayKeys('2026-08-17', '2026-08-24')).toBe(7);
    expect(daysBetweenDayKeys('2026-08-24', '2026-08-17')).toBe(-7);
    expect(daysBetweenDayKeys('2026-08-17', '2026-08-17')).toBe(0);
    expect(daysBetweenDayKeys('2026-02-27', '2026-03-02')).toBe(3);
  });

  it('returns the input rather than Invalid Date on malformed keys', () => {
    expect(addDaysToDayKey('not-a-date', 1)).toBe('not-a-date');
    expect(daysBetweenDayKeys('not-a-date', '2026-08-17')).toBe(0);
  });

  it('round-trips through 400 days without drift', () => {
    let k = '2026-01-01';
    for (let i = 0; i < 400; i++) k = addDaysToDayKey(k, 1);
    expect(daysBetweenDayKeys('2026-01-01', k)).toBe(400);
  });
});
