/**
 * profile-store · validation + write path coverage.
 *
 * Pure-logic coverage of validateProfileInput is run always. The DB
 * round-trip (saveProfile → getProfile) only runs when DATABASE_URL
 * is set — locally and on Railway it is; in pure-CI it can be opted
 * out by leaving DATABASE_URL unset. We mark the integration test
 * `.skip` in that case so the suite still reports a meaningful count.
 */

import { describe, it, expect } from 'vitest';
import {
  validateProfileInput,
  VALID_SEX,
  type ProfileInput,
} from '../profile-types';
import { getProfile } from '../profile-store';
import { saveProfile } from '../profile-write';

describe('validateProfileInput', () => {
  const baseValid: ProfileInput = {
    full_name: 'Alex Rivera',
    age: 38,
    sex: 'M',
    city: 'Los Angeles, CA',
    hrmax: 188,
  };

  it('accepts a fully-populated valid input', () => {
    const v = validateProfileInput(baseValid);
    expect(v.full_name).toBe('Alex Rivera');
    expect(v.age).toBe(38);
    expect(v.sex).toBe('M');
    expect(v.city).toBe('Los Angeles, CA');
    expect(v.hrmax).toBe(188);
  });

  it('trims whitespace from text fields', () => {
    const v = validateProfileInput({
      ...baseValid,
      full_name: '  Alex Rivera  ',
      city: '  LA  ',
    });
    expect(v.full_name).toBe('Alex Rivera');
    expect(v.city).toBe('LA');
  });

  it('coerces string-form numeric inputs (form submissions arrive as strings)', () => {
    const v = validateProfileInput({
      ...baseValid,
      age: '38',
      hrmax: '188',
    });
    expect(v.age).toBe(38);
    expect(v.hrmax).toBe(188);
  });

  it('normalizes empty/whitespace city to null', () => {
    expect(validateProfileInput({ ...baseValid, city: '' }).city).toBeNull();
    expect(validateProfileInput({ ...baseValid, city: '   ' }).city).toBeNull();
    expect(validateProfileInput({ ...baseValid, city: undefined }).city).toBeNull();
  });

  it('normalizes empty hrmax to null (Tanaka-fallback path)', () => {
    expect(validateProfileInput({ ...baseValid, hrmax: '' }).hrmax).toBeNull();
    expect(validateProfileInput({ ...baseValid, hrmax: undefined }).hrmax).toBeNull();
  });

  it('defaults sex to "Prefer not to say" when omitted', () => {
    const v = validateProfileInput({ full_name: 'A', age: 30 });
    expect(v.sex).toBe('Prefer not to say');
  });

  it('rejects missing name', () => {
    expect(() => validateProfileInput({ ...baseValid, full_name: '' })).toThrow(/Name is required/);
    expect(() => validateProfileInput({ ...baseValid, full_name: '   ' })).toThrow(/Name is required/);
    expect(() => validateProfileInput({ ...baseValid, full_name: undefined })).toThrow(/Name is required/);
  });

  it('rejects missing age', () => {
    expect(() => validateProfileInput({ ...baseValid, age: undefined })).toThrow(/Age is required/);
    expect(() => validateProfileInput({ ...baseValid, age: '' })).toThrow(/Age is required/);
  });

  it('rejects out-of-range age', () => {
    expect(() => validateProfileInput({ ...baseValid, age: 5 })).toThrow(/between 10 and 100/);
    expect(() => validateProfileInput({ ...baseValid, age: 150 })).toThrow(/between 10 and 100/);
  });

  it('rejects out-of-range hrmax', () => {
    expect(() => validateProfileInput({ ...baseValid, hrmax: 50 })).toThrow(/between 100 and 250/);
    expect(() => validateProfileInput({ ...baseValid, hrmax: 300 })).toThrow(/between 100 and 250/);
  });

  it('rejects unknown sex values', () => {
    expect(() => validateProfileInput({ ...baseValid, sex: 'Robot' })).toThrow(/Sex must be one of/);
  });

  it('accepts every valid sex value', () => {
    for (const s of VALID_SEX) {
      expect(validateProfileInput({ ...baseValid, sex: s }).sex).toBe(s);
    }
  });

  it('rejects oversize name', () => {
    expect(() => validateProfileInput({ ...baseValid, full_name: 'x'.repeat(121) }))
      .toThrow(/120 characters/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Round-trip integration test — only runs when DATABASE_URL is set.
// Uses a non-'me' user_id so it can't clobber the dev profile.
// ─────────────────────────────────────────────────────────────────────

const TEST_USER = '__profile_store_test__';
const haveDb = !!process.env.DATABASE_URL;
const dbDescribe = haveDb ? describe : describe.skip;

dbDescribe('saveProfile + getProfile round-trip (DATABASE_URL required)', () => {
  it('saves required fields and reads them back identically', async () => {
    const input: ProfileInput = {
      full_name: 'Round Trip',
      age: 41,
      sex: 'F',
      city: 'Portland, OR',
      hrmax: 180,
    };
    const saved = await saveProfile(input, TEST_USER);
    expect(saved.full_name).toBe('Round Trip');
    expect(saved.age).toBe(41);
    expect(saved.sex).toBe('F');
    expect(saved.city).toBe('Portland, OR');
    expect(saved.hrmax).toBe(180);

    const read = await getProfile(TEST_USER);
    expect(read).not.toBeNull();
    expect(read!.full_name).toBe(saved.full_name);
    expect(read!.age).toBe(saved.age);
    expect(read!.sex).toBe(saved.sex);
    expect(read!.city).toBe(saved.city);
    expect(read!.hrmax).toBe(saved.hrmax);
  });

  it('upserts on conflict — second save overwrites first', async () => {
    await saveProfile({ full_name: 'First', age: 30 }, TEST_USER);
    const second = await saveProfile({ full_name: 'Second', age: 50, hrmax: 170 }, TEST_USER);
    expect(second.full_name).toBe('Second');
    expect(second.age).toBe(50);
    expect(second.hrmax).toBe(170);

    const read = await getProfile(TEST_USER);
    expect(read!.full_name).toBe('Second');
  });

  it('round-trips an empty-hrmax (Tanaka-fallback) profile', async () => {
    const saved = await saveProfile({ full_name: 'No HR', age: 28, hrmax: null }, TEST_USER);
    expect(saved.hrmax).toBeNull();
    const read = await getProfile(TEST_USER);
    expect(read!.hrmax).toBeNull();
  });

  it('rejects missing required fields before the DB write', async () => {
    await expect(saveProfile({ full_name: '', age: 30 }, TEST_USER)).rejects.toThrow(/Name is required/);
    await expect(saveProfile({ full_name: 'X', age: undefined }, TEST_USER)).rejects.toThrow(/Age is required/);
  });
});
