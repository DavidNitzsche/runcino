/**
 * Tests for the HealthKit ingest validation layer.
 *
 * Storage paths (DB writes) are exercised via integration; this file
 * locks the validation rules, what's accepted vs rejected, so a
 * future agent can't quietly broaden the plausibility ranges or
 * relax the date-format check.
 */
import { describe, expect, it } from 'vitest';
import { validateSample, SAMPLE_TYPES, type HealthSampleInput } from '../health-samples';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

describe('SAMPLE_TYPES · canonical taxonomy', () => {
  it('exposes the known sample types', () => {
    expect(SAMPLE_TYPES).toEqual([
      'resting_hr',
      'max_hr',
      'vo2_max',
      'sleep_hours',
      'workout_hr_avg',
      'hrv',
    ]);
  });
});

describe('validateSample · happy path · each type', () => {
  it('accepts resting_hr at 48 bpm', () => {
    expect(validateSample({ type: 'resting_hr', value: 48, dateISO: today() })).toBeNull();
  });
  it('accepts max_hr at 183 bpm', () => {
    expect(validateSample({ type: 'max_hr', value: 183, dateISO: today() })).toBeNull();
  });
  it('accepts vo2_max at 52', () => {
    expect(validateSample({ type: 'vo2_max', value: 52, dateISO: today() })).toBeNull();
  });
  it('accepts sleep_hours at 7.2', () => {
    expect(validateSample({ type: 'sleep_hours', value: 7.2, dateISO: today() })).toBeNull();
  });
  it('accepts workout_hr_avg at 165 bpm', () => {
    expect(validateSample({ type: 'workout_hr_avg', value: 165, dateISO: today() })).toBeNull();
  });
  it('accepts hrv at 65 ms', () => {
    expect(validateSample({ type: 'hrv', value: 65, dateISO: today() })).toBeNull();
  });
});

describe('validateSample · type rejection', () => {
  it('rejects unknown sample type', () => {
    const out = validateSample({ type: 'cadence', value: 180, dateISO: today() } as HealthSampleInput);
    expect(out?.reason).toContain('unknown sample type');
  });
  it('rejects missing type', () => {
    const out = validateSample({ value: 48, dateISO: today() } as unknown as HealthSampleInput);
    expect(out?.reason).toContain('type missing');
  });
  it('rejects non-string type', () => {
    const out = validateSample({ type: 42 as unknown as string, value: 48, dateISO: today() });
    expect(out?.reason).toContain('type missing');
  });
});

describe('validateSample · plausibility ranges', () => {
  it('rejects resting_hr below 25', () => {
    expect(validateSample({ type: 'resting_hr', value: 20, dateISO: today() })?.reason).toContain('outside plausible range');
  });
  it('rejects resting_hr above 100', () => {
    expect(validateSample({ type: 'resting_hr', value: 105, dateISO: today() })?.reason).toContain('outside plausible range');
  });
  it('rejects max_hr below 100', () => {
    expect(validateSample({ type: 'max_hr', value: 90, dateISO: today() })?.reason).toContain('outside plausible range');
  });
  it('rejects max_hr above 230', () => {
    expect(validateSample({ type: 'max_hr', value: 240, dateISO: today() })?.reason).toContain('outside plausible range');
  });
  it('rejects sleep_hours of 24 (over cap)', () => {
    expect(validateSample({ type: 'sleep_hours', value: 24, dateISO: today() })?.reason).toContain('outside plausible range');
  });
  it('accepts sleep_hours of 0 (insomnia case)', () => {
    expect(validateSample({ type: 'sleep_hours', value: 0, dateISO: today() })).toBeNull();
  });
  it('rejects negative values', () => {
    expect(validateSample({ type: 'resting_hr', value: -1, dateISO: today() })?.reason).toContain('outside plausible range');
  });
  it('rejects NaN', () => {
    expect(validateSample({ type: 'resting_hr', value: NaN, dateISO: today() })?.reason).toContain('finite number');
  });
  it('rejects Infinity', () => {
    expect(validateSample({ type: 'resting_hr', value: Infinity, dateISO: today() })?.reason).toContain('finite number');
  });
});

describe('validateSample · dateISO format + range', () => {
  it('rejects bad format (no leading zero)', () => {
    expect(validateSample({ type: 'resting_hr', value: 48, dateISO: '2026-5-19' })?.reason).toContain('YYYY-MM-DD');
  });
  it('rejects timestamp-looking strings', () => {
    expect(validateSample({ type: 'resting_hr', value: 48, dateISO: '2026-05-19T12:00:00Z' })?.reason).toContain('YYYY-MM-DD');
  });
  it('rejects empty date', () => {
    expect(validateSample({ type: 'resting_hr', value: 48, dateISO: '' })?.reason).toContain('dateISO missing');
  });
  it('rejects dates more than 365 days old', () => {
    expect(validateSample({ type: 'resting_hr', value: 48, dateISO: daysAgo(400) })?.reason).toContain('365 days old');
  });
  it('accepts dates exactly 30 days old', () => {
    expect(validateSample({ type: 'resting_hr', value: 48, dateISO: daysAgo(30) })).toBeNull();
  });
  it('rejects dates far in the future', () => {
    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 30);
    const iso = future.toISOString().slice(0, 10);
    expect(validateSample({ type: 'resting_hr', value: 48, dateISO: iso })?.reason).toContain('future');
  });
  it('accepts today (timezone-edge slack permits)', () => {
    expect(validateSample({ type: 'resting_hr', value: 48, dateISO: today() })).toBeNull();
  });
});

describe('validateSample · optional fields', () => {
  it('accepts samples with no source (defaults to apple_health server-side)', () => {
    expect(validateSample({ type: 'resting_hr', value: 48, dateISO: today() })).toBeNull();
  });
  it('accepts samples with explicit source string', () => {
    expect(validateSample({ type: 'resting_hr', value: 48, dateISO: today(), source: 'garmin' })).toBeNull();
  });
  it('accepts metadata objects', () => {
    expect(validateSample({
      type: 'workout_hr_avg',
      value: 165,
      dateISO: today(),
      metadata: { workoutId: 'abc-123' },
    })).toBeNull();
  });
});
