/**
 * Tests for user-preference plumbing through the coach engine.
 *
 * Covers:
 *   1. parsePrefsRow, day-name parsing + tolerant fallback to defaults.
 *   2. simulateRange, long-run lands on state.prefs.longRunDow.
 *   3. simulateRange, quality lands on state.prefs.qualityDows.
 *
 * Wave U installed `state.prefs` so the engine stops hardcoding
 * Sat/Tue+Thu/Mon for every runner. These tests guard the three core
 * promises: defaults, custom long-run day, and custom quality days.
 */

import { describe, it, expect } from 'vitest';
import { parsePrefsRow, parseDayName, parseDayCombo } from '../coach-state';
import { simulateRange } from '../coach-engine';
import { STATE_MID_BUILD_WEEK_4 } from './fixtures/coach-states';
import type { CoachState } from '../coach-state';

// ── parsePrefsRow ────────────────────────────────────────────────

describe('parseDayName', () => {
  it('parses canonical 3-letter names', () => {
    expect(parseDayName('Sun')).toBe(0);
    expect(parseDayName('Mon')).toBe(1);
    expect(parseDayName('Tue')).toBe(2);
    expect(parseDayName('Wed')).toBe(3);
    expect(parseDayName('Thu')).toBe(4);
    expect(parseDayName('Fri')).toBe(5);
    expect(parseDayName('Sat')).toBe(6);
  });
  it('parses full names case-insensitively', () => {
    expect(parseDayName('Saturday')).toBe(6);
    expect(parseDayName('SATURDAY')).toBe(6);
    expect(parseDayName('saturday')).toBe(6);
    expect(parseDayName('Tuesday')).toBe(2);
  });
  it('handles alternate spellings', () => {
    expect(parseDayName('Tues')).toBe(2);
    expect(parseDayName('Weds')).toBe(3);
    expect(parseDayName('Thur')).toBe(4);
    expect(parseDayName('Thurs')).toBe(4);
  });
  it('returns null for garbage', () => {
    expect(parseDayName('xyz')).toBeNull();
    expect(parseDayName('')).toBeNull();
    expect(parseDayName(null)).toBeNull();
    expect(parseDayName(undefined)).toBeNull();
  });
});

describe('parseDayCombo', () => {
  it('parses slash-separated "Tue / Thu"', () => {
    expect(parseDayCombo('Tue / Thu')).toEqual([2, 4]);
  });
  it('parses comma-separated "Wed, Sat"', () => {
    expect(parseDayCombo('Wed, Sat')).toEqual([3, 6]);
  });
  it('handles mixed garbage gracefully', () => {
    // 'foo' is dropped, 'Tue' parses
    expect(parseDayCombo('Tue / foo')).toEqual([2]);
  });
  it('dedupes', () => {
    expect(parseDayCombo('Tue / Tuesday')).toEqual([2]);
  });
  it('returns empty for null/garbage', () => {
    expect(parseDayCombo(null)).toEqual([]);
    expect(parseDayCombo('xyz')).toEqual([]);
  });
});

describe('parsePrefsRow', () => {
  it('returns defaults (Sat/Tue+Thu/Mon, isDefaults=true) when row is null', () => {
    const p = parsePrefsRow(null);
    expect(p.longRunDow).toBe(6);
    expect(p.qualityDows).toEqual([2, 4]);
    expect(p.restDow).toBe(1);
    expect(p.isDefaults).toBe(true);
  });

  it('parses a user-configured Sunday long-run runner', () => {
    const p = parsePrefsRow({
      user_id: 'me',
      long_run_day: 'Sunday',
      quality_days: 'Tue / Thu',
      rest_day: 'Mon',
      rest_cadence: null,
      units: null,
    });
    expect(p.longRunDow).toBe(0);
    expect(p.qualityDows).toEqual([2, 4]);
    expect(p.restDow).toBe(1);
    expect(p.isDefaults).toBe(false);
  });

  it('parses an unusual Wed/Sat quality runner', () => {
    const p = parsePrefsRow({
      user_id: 'me',
      long_run_day: 'Sat',
      quality_days: 'Wed, Sat',
      rest_day: null,
      rest_cadence: null,
      units: null,
    });
    expect(p.longRunDow).toBe(6);
    expect(p.qualityDows).toEqual([3, 6]);
    expect(p.restDow).toBe(1);  // fell back to default when null
  });

  it('falls back per-field when individual values are garbage', () => {
    const p = parsePrefsRow({
      user_id: 'me',
      long_run_day: 'xyzday',
      quality_days: 'Tue / Thu',
      rest_day: 'Mon',
      rest_cadence: null,
      units: null,
    });
    expect(p.longRunDow).toBe(6);  // default
    expect(p.qualityDows).toEqual([2, 4]);
    expect(p.restDow).toBe(1);
  });

  it('marks isDefaults=false when at least one field parsed', () => {
    // Even if only quality_days parses, the row isn't pure-default.
    const p = parsePrefsRow({
      user_id: 'me',
      long_run_day: null,
      quality_days: 'Wed, Sat',
      rest_day: null,
      rest_cadence: null,
      units: null,
    });
    expect(p.isDefaults).toBe(false);
  });
});

// ── Engine wiring: simulateRange honors state.prefs ──────────────

function withPrefs(state: CoachState, prefs: Partial<CoachState['prefs']>): CoachState {
  return { ...state, prefs: { ...state.prefs, ...prefs, isDefaults: false } };
}

/** JS getDay() of an ISO date in UTC (matches the engine's jsDow). */
function isoDow(iso: string): number {
  return new Date(iso + 'T12:00:00Z').getUTCDay();
}

describe('simulateRange, long-run day honors state.prefs.longRunDow', () => {
  it('with default prefs (Saturday), long runs land on Saturday', () => {
    // Walk forward 4 weeks. STATE_MID_BUILD_WEEK_4 is a healthy
    // BUILD-phase runner, long runs should appear weekly.
    const state = STATE_MID_BUILD_WEEK_4;
    const start = state.now;
    const endDate = new Date(start + 'T12:00:00Z');
    endDate.setUTCDate(endDate.getUTCDate() + 28);
    const end = endDate.toISOString().slice(0, 10);

    const days = simulateRange(state, start, end);
    const longRunDays = days.filter(d => d.isLong);
    expect(longRunDays.length).toBeGreaterThan(0);
    for (const d of longRunDays) {
      expect(isoDow(d.date), `Long run on ${d.date} (dow=${isoDow(d.date)}), expected Saturday (6)`).toBe(6);
    }
  });

  it('with prefs.longRunDow=0 (Sunday), long runs land on Sunday', () => {
    const state = withPrefs(STATE_MID_BUILD_WEEK_4, { longRunDow: 0 });
    const start = state.now;
    const endDate = new Date(start + 'T12:00:00Z');
    endDate.setUTCDate(endDate.getUTCDate() + 28);
    const end = endDate.toISOString().slice(0, 10);

    const days = simulateRange(state, start, end);
    const longRunDays = days.filter(d => d.isLong);
    expect(longRunDays.length).toBeGreaterThan(0);
    for (const d of longRunDays) {
      expect(isoDow(d.date), `Long run on ${d.date} (dow=${isoDow(d.date)}), expected Sunday (0)`).toBe(0);
    }
  });
});

describe('simulateRange, quality days honor state.prefs.qualityDows', () => {
  it('with unusual prefs.qualityDows=[3, 6] (Wed/Sat), no quality lands on Tue or Thu', () => {
    // Move quality off Tue/Thu so any Tue/Thu quality day is a
    // regression. Sat is both long-run AND quality here, the engine
    // resolves that to a long-on-Sat (long wins).
    const state = withPrefs(STATE_MID_BUILD_WEEK_4, { qualityDows: [3, 6] });
    const start = state.now;
    const endDate = new Date(start + 'T12:00:00Z');
    endDate.setUTCDate(endDate.getUTCDate() + 28);
    const end = endDate.toISOString().slice(0, 10);

    const days = simulateRange(state, start, end);
    const qualityDays = days.filter(d => d.isQuality && !d.isLong);
    for (const d of qualityDays) {
      const dow = isoDow(d.date);
      expect([2, 4]).not.toContain(dow);
    }
    // And at least one quality day landed on Wed across 4 weeks.
    const wedQuality = days.filter(d => d.isQuality && isoDow(d.date) === 3);
    expect(wedQuality.length).toBeGreaterThan(0);
  });
});
