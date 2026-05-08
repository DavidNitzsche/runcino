import { describe, expect, it } from 'vitest';
import { ageFromBirthDate } from '../runner-profile';

describe('ageFromBirthDate', () => {
  it('returns null on null input', () => {
    expect(ageFromBirthDate(null)).toBeNull();
  });

  it('returns null on malformed input', () => {
    expect(ageFromBirthDate('not-a-date')).toBeNull();
    expect(ageFromBirthDate('1985')).toBeNull();
    expect(ageFromBirthDate('')).toBeNull();
  });

  it('returns 40 for someone born 1985-08-31 evaluated on 2026-05-08', () => {
    // Birthday hasn't passed yet (Aug 31 > May 8) → age should be
    // 2026 - 1985 - 1 = 40, NOT 41 (the year-only math bug).
    const today = new Date(2026, 4, 8);  // May = month 4 (0-indexed)
    expect(ageFromBirthDate('1985-08-31', today)).toBe(40);
  });

  it('returns 41 for someone born 1985-08-31 evaluated on 2026-09-01', () => {
    // Day after birthday → age advances.
    const today = new Date(2026, 8, 1);  // Sep = month 8
    expect(ageFromBirthDate('1985-08-31', today)).toBe(41);
  });

  it('returns 41 for someone born 1985-05-08 on their birthday in 2026', () => {
    // On the birthday itself → age increments today.
    const today = new Date(2026, 4, 8);
    expect(ageFromBirthDate('1985-05-08', today)).toBe(41);
  });

  it('returns 40 for someone born 1985-05-09 evaluated on 2026-05-08', () => {
    // Birthday tomorrow.
    const today = new Date(2026, 4, 8);
    expect(ageFromBirthDate('1985-05-09', today)).toBe(40);
  });
});
