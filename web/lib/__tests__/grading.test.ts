import { describe, expect, it } from 'vitest';
import { gradeVdot, ageDeclineFromThirty } from '../../coach/doctrine/grading';

describe('ageDeclineFromThirty', () => {
  it('returns 0 for under-30 runners', () => {
    expect(ageDeclineFromThirty(25, 'male')).toBe(0);
    expect(ageDeclineFromThirty(30, 'female')).toBe(0);
  });

  it('accumulates decline through age decades for men', () => {
    // 30→40 at 0.3/yr = 3.0; 40→50 at 0.6/yr = 6.0; 30→50 = 9.0
    expect(ageDeclineFromThirty(50, 'male')).toBeCloseTo(9.0, 1);
    // 30→55: 30→40 (3.0) + 40→50 (6.0) + 50→55 (5 * 0.9 = 4.5) = 13.5
    expect(ageDeclineFromThirty(55, 'male')).toBeCloseTo(13.5, 1);
  });

  it('accumulates decline through age decades for women', () => {
    // 30→40 at 0.25/yr = 2.5; 40→50 at 0.5/yr = 5.0; 30→50 = 7.5
    expect(ageDeclineFromThirty(50, 'female')).toBeCloseTo(7.5, 1);
  });

  it('averages male/female for unspecified or other sex', () => {
    const m50 = ageDeclineFromThirty(50, 'male');     // 9.0
    const f50 = ageDeclineFromThirty(50, 'female');   // 7.5
    expect(ageDeclineFromThirty(50, 'unspecified')).toBeCloseTo((m50 + f50) / 2, 1);
    expect(ageDeclineFromThirty(50, 'other')).toBeCloseTo((m50 + f50) / 2, 1);
  });
});

describe('gradeVdot', () => {
  it('returns ageGraded null when age unknown', () => {
    const g = gradeVdot(47.1, null, 'male');
    expect(g.ageGraded).toBeNull();
    expect(g.raw).toBe(47.1);
  });

  it('returns same as raw for under-30 runners', () => {
    const g = gradeVdot(50, 25, 'male');
    expect(g.ageGraded).toBe(50);
  });

  it('shifts a 55yo male VDOT 47.1 up to ~60.6', () => {
    // 30→55 male decline = 13.5 → ageGraded = 47.1 + 13.5 = 60.6
    const g = gradeVdot(47.1, 55, 'male');
    expect(g.ageGraded).toBeCloseTo(60.6, 1);
  });

  it('applies +7 sex-cohort offset for women', () => {
    const g = gradeVdot(50, 35, 'female');
    expect(g.sexCohortVdot).toBe(57);
  });

  it('no sex cohort offset for unspecified/other', () => {
    expect(gradeVdot(50, 35, 'unspecified').sexCohortVdot).toBeNull();
    expect(gradeVdot(50, 35, 'other').sexCohortVdot).toBe(50);
  });
});
