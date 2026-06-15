/**
 * The no-race seeder must honor the runner's saved long-run / rest / quality
 * day picks — it used to hardcode Sat-long / Mon-rest / Tue-quality (Justin's
 * "super weird" schedule: he chose Fri-long / Sat-rest and got the opposite).
 * dow: sun=0 mon=1 tue=2 wed=3 thu=4 fri=5 sat=6.
 */
import { describe, it, expect } from 'vitest';
import { layoutFromPrefs } from './seed-from-onboarding';

describe('layoutFromPrefs', () => {
  it("Justin's picks: Friday long, Saturday rest → honored (not Sat-long/Mon-rest)", () => {
    const l = layoutFromPrefs({ long_run_day: 'fri', rest_day: 'sat', quality_days: ['tue', 'thu'] });
    expect(l.longRunDow).toBe(5); // Fri, not 6 (Sat)
    expect(l.restDow).toBe(6);    // Sat, not 1 (Mon)
    expect(l.qualityDows).toEqual([2]); // Tue, capped to 1 for maintenance
  });

  it('defaults (unset prefs via loadSettings): sun-long / sat-rest / tue-quality', () => {
    const l = layoutFromPrefs({ long_run_day: 'sun', rest_day: 'sat', quality_days: ['tue', 'thu'] });
    expect(l.longRunDow).toBe(0);
    expect(l.restDow).toBe(6);
    expect(l.qualityDows).toEqual([2]);
  });

  it('never collides: quality day is never the long or rest day', () => {
    const l = layoutFromPrefs({ long_run_day: 'tue', rest_day: 'wed', quality_days: ['tue', 'wed'] });
    expect(l.qualityDows[0]).not.toBe(l.longRunDow);
    expect(l.qualityDows[0]).not.toBe(l.restDow);
    expect(l.qualityDows).toHaveLength(1);
  });
});
