/**
 * The convergence rule · falsifiers.
 *
 * The owner's ruling (2026-08-19) has one clause that is not negotiable and is
 * therefore tested first and hardest:
 *
 *   "ONE METRIC MUST NEVER MOVE A SESSION."
 *
 * Everything else in this file is scaffolding around that. If `single signal`
 * below ever goes green-to-red, the ruling is broken regardless of what the
 * rest of the suite says.
 */
import { describe, it, expect } from 'vitest';
import {
  gradeConvergence,
  convergenceCopy,
  CONVERGENCE,
  type ConvergenceSeries,
  type ConvergenceContext,
} from './convergence';
import { sleepFloorForMileage } from './tier-rules';

const DAYS = 30;
const fill = <T,>(v: T, n = DAYS): T[] => Array.from({ length: n }, () => v);
/** RMSSD in ms → the LnRMSSD the convergence module compares in. */
const ln = (ms: number): number => Math.log(ms);

/** A runner with a full baseline and nothing wrong anywhere. */
function healthy(over: Partial<ConvergenceSeries> = {}): ConvergenceSeries {
  return {
    // HRV lives in LnRMSSD space, per Research/15 §"Plews approach" · `ln`
    // below keeps the fixtures readable in the ms a person would quote.
    hrvLnRolling: fill(ln(60)),
    hrvLnBaseline: ln(60),
    hrvLnSd60d: 0.10,
    rhrDaily: fill(48),
    rhrBaseline: 48,
    sleepNightly: fill(8.2),
    acwrDaily: fill(1.0),
    subjectiveWreckedOnEasy: false,
    baselineDays: 60,
    weeklyMpw: 45,
    ...over,
  };
}

/** No race, no illness, no travel, no heat, no drink. */
function clearContext(over: Partial<ConvergenceContext> = {}): ConvergenceContext {
  return {
    daysToNextRace: null,
    daysSinceLastRace: null,
    postRaceWindowDays: 14,
    inPlannedCutback: false,
    illnessActive: false,
    daysSinceTravel: null,
    heatFlaggedDaysRecent: 0,
    alcoholLastNight: false,
    ...over,
  };
}

/* ────────────────── THE CLAUSE · one signal can never fire ───────────── */

describe('one metric must never move a session', () => {
  it('an extreme, sustained RHR elevation ALONE does not reach red or amber', () => {
    // +20 bpm — four times doctrine's +5 threshold — held for a solid month.
    // This is as loud as a single domain can possibly get.
    const v = gradeConvergence(
      healthy({ rhrDaily: fill(68), rhrBaseline: 48 }),
      clearContext(),
    );
    expect(v.domains.find((d) => d.domain === 'cardiac')?.dragging).toBe(true);
    expect(v.converging).toEqual(['cardiac']);
    expect(v.grade).toBe('green');
  });

  it('an extreme, sustained HRV collapse ALONE does not reach red or amber', () => {
    // Rolling HRV at a third of baseline for a month.
    const v = gradeConvergence(
      healthy({ hrvLnRolling: fill(ln(20)) }),
      clearContext(),
    );
    expect(v.domains.find((d) => d.domain === 'autonomic')?.dragging).toBe(true);
    expect(v.converging).toEqual(['autonomic']);
    expect(v.grade).toBe('green');
  });

  it('catastrophic sleep ALONE does not reach red or amber', () => {
    const v = gradeConvergence(healthy({ sleepNightly: fill(3.5) }), clearContext());
    expect(v.domains.find((d) => d.domain === 'sleep')?.dragging).toBe(true);
    expect(v.converging).toEqual(['sleep']);
    expect(v.grade).toBe('green');
  });

  it('an ACWR far into the danger zone ALONE does not reach red or amber', () => {
    const v = gradeConvergence(healthy({ acwrDaily: fill(3.2) }), clearContext());
    expect(v.converging).toEqual(['load']);
    expect(v.grade).toBe('green');
  });

  it('the runner reporting an easy run as wrecked ALONE does not reach red or amber', () => {
    const v = gradeConvergence(healthy({ subjectiveWreckedOnEasy: true }), clearContext());
    expect(v.converging).toEqual(['subjective']);
    expect(v.grade).toBe('green');
  });

  it('EVERY domain, alone and at maximum severity, grades green', () => {
    // Exhaustive form of the clause: whatever the domain, whatever the
    // magnitude, one is never enough.
    const singles: Array<[string, Partial<ConvergenceSeries>]> = [
      ['cardiac', { rhrDaily: fill(90) }],
      ['autonomic', { hrvLnRolling: fill(ln(1)) }],
      ['sleep', { sleepNightly: fill(0.5) }],
      ['load', { acwrDaily: fill(9) }],
      ['subjective', { subjectiveWreckedOnEasy: true }],
    ];
    for (const [name, over] of singles) {
      const v = gradeConvergence(healthy(over), clearContext());
      expect(v.converging.length, `${name} alone`).toBe(1);
      expect(v.grade, `${name} alone`).toBe('green');
    }
  });
});

/* ────────────────── The ladder ───────────────────────────────────────── */

describe('the ladder', () => {
  it('two mild converging signals grade amber and change nothing', () => {
    // Both only just over their doctrine thresholds.
    const v = gradeConvergence(
      healthy({
        rhrDaily: fill(53),                       // exactly +5, doctrine's bar
        sleepNightly: fill(sleepFloorForMileage(45) - 0.1),
      }),
      clearContext(),
    );
    expect(new Set(v.converging)).toEqual(new Set(['cardiac', 'sleep']));
    expect(v.grade).toBe('amber');
  });

  it('three converging signals grade red', () => {
    const v = gradeConvergence(
      healthy({
        rhrDaily: fill(54),
        sleepNightly: fill(6.0),
        hrvLnRolling: fill(ln(50)),               // 60ms -> 50ms, well past the SWC
      }),
      clearContext(),
    );
    expect(v.converging.length).toBeGreaterThanOrEqual(3);
    expect(v.grade).toBe('red');
  });

  it('the red bar sits one domain above the amber bar, and amber above green', () => {
    expect(CONVERGENCE.redMinDomains).toBe(CONVERGENCE.amberMinDomains + 1);
    expect(CONVERGENCE.amberMinDomains).toBeGreaterThan(1);
  });
});

/* ────────────────── Doctrine thresholds ──────────────────────────────── */

describe('per-domain thresholds are doctrine, and each needs persistence', () => {
  it('RHR needs +5 bpm for 2 consecutive days · one day does not count', () => {
    const oneDay = [...fill(48, 29), 55];
    const twoDays = [...fill(48, 28), 55, 55];
    const ctx = clearContext();
    expect(gradeConvergence(healthy({ rhrDaily: oneDay }), ctx)
      .domains.find((d) => d.domain === 'cardiac')?.dragging).toBe(false);
    expect(gradeConvergence(healthy({ rhrDaily: twoDays }), ctx)
      .domains.find((d) => d.domain === 'cardiac')?.dragging).toBe(true);
  });

  it('RHR at +4 bpm never counts, however long it holds', () => {
    const v = gradeConvergence(healthy({ rhrDaily: fill(52), rhrBaseline: 48 }), clearContext());
    expect(v.domains.find((d) => d.domain === 'cardiac')?.dragging).toBe(false);
  });

  it('HRV needs a > SWC drop for 3 consecutive days · two days does not count', () => {
    // SWC = 0.5 × 0.10 = 0.05 Ln. 60ms → 50ms is 0.18, comfortably past it.
    const twoDays = [...fill(ln(60), 28), ln(50), ln(50)];
    const threeDays = [...fill(ln(60), 27), ln(50), ln(50), ln(50)];
    const ctx = clearContext();
    expect(gradeConvergence(healthy({ hrvLnRolling: twoDays }), ctx)
      .domains.find((d) => d.domain === 'autonomic')?.dragging).toBe(false);
    expect(gradeConvergence(healthy({ hrvLnRolling: threeDays }), ctx)
      .domains.find((d) => d.domain === 'autonomic')?.dragging).toBe(true);
  });

  it('an HRV drop INSIDE the smallest worthwhile change is noise, not a signal', () => {
    // SD 0.10 → SWC 0.05 in Ln. 60ms → 58ms is a 0.034 drop, under it.
    const v = gradeConvergence(
      healthy({ hrvLnRolling: fill(ln(58)) }),
      clearContext(),
    );
    expect(v.domains.find((d) => d.domain === 'autonomic')?.dragging).toBe(false);
  });

  it('without a 60-day SD, HRV falls back to doctrine\'s 7.5% drop form', () => {
    const ctx = clearContext();
    const under = gradeConvergence(
      healthy({ hrvLnSd60d: null, hrvLnRolling: fill(ln(56)) }), ctx,
    ); // 6.7% drop · under doctrine's 7.5% bar
    const over = gradeConvergence(
      healthy({ hrvLnSd60d: null, hrvLnRolling: fill(ln(55)) }), ctx,
    ); // 8.3% drop · over it
    expect(under.domains.find((d) => d.domain === 'autonomic')?.dragging).toBe(false);
    expect(over.domains.find((d) => d.domain === 'autonomic')?.dragging).toBe(true);
  });

  it('the sleep floor is the mileage-scaled doctrine floor, not a fixed number', () => {
    const ctx = clearContext();
    // 8.0h passes at 30 mpw (floor 6.8) and at 70 mpw (floor 7.8) — but 7.5h
    // passes at 30 and fails at 70. One number, scaled by doctrine.
    const light = gradeConvergence(healthy({ weeklyMpw: 30, sleepNightly: fill(7.5) }), ctx);
    const heavy = gradeConvergence(healthy({ weeklyMpw: 70, sleepNightly: fill(7.5) }), ctx);
    expect(light.domains.find((d) => d.domain === 'sleep')?.dragging).toBe(false);
    expect(heavy.domains.find((d) => d.domain === 'sleep')?.dragging).toBe(true);
  });
});

/* ────────────────── Per-finding context filters ──────────────────────── */

describe('each signal is filtered on its own, not behind one surface guard', () => {
  it('a race-week taper that mimics fatigue does not reach red', () => {
    // The V5 Z2 shape. Taper week: load ratio swinging, sleep short from race
    // nerves and travel, RHR up. Three domains would otherwise converge.
    const v = gradeConvergence(
      healthy({
        acwrDaily: fill(1.8),
        sleepNightly: fill(6.2),
        rhrDaily: fill(55),
      }),
      clearContext({ daysToNextRace: 4, daysSinceTravel: 2, inPlannedCutback: true }),
    );
    expect(v.grade).not.toBe('red');
    // And the reason is per-domain, not a blanket suppression:
    const byDomain = Object.fromEntries(v.domains.map((d) => [d.domain, d]));
    expect(byDomain.load.suppressedBy).toBeTruthy();
    expect(byDomain.sleep.suppressedBy).toBe('recent travel');
    expect(byDomain.cardiac.suppressedBy).toBe('recent travel');
  });

  it('a heat block does not let one hot week manufacture a cardiac vote', () => {
    const v = gradeConvergence(
      healthy({ rhrDaily: fill(56), sleepNightly: fill(6.0), hrvLnRolling: fill(ln(50)) }),
      clearContext({ heatFlaggedDaysRecent: 2 }),
    );
    const byDomain = Object.fromEntries(v.domains.map((d) => [d.domain, d]));
    // Heat explains the heart rate ...
    expect(byDomain.cardiac.dragging).toBe(true);
    expect(byDomain.cardiac.suppressedBy).toBe('heat');
    expect(byDomain.cardiac.counts).toBe(false);
    // ... and explains NOTHING about sleep or HRV, which still vote.
    expect(byDomain.sleep.counts).toBe(true);
    expect(byDomain.autonomic.counts).toBe(true);
    // Two survivors, so amber. Heat cost exactly one vote, not the surface.
    expect(v.grade).toBe('amber');
  });

  it('heat does not suppress sleep · a hot night still costs real recovery', () => {
    const v = gradeConvergence(
      healthy({ sleepNightly: fill(6.0) }),
      clearContext({ heatFlaggedDaysRecent: 3 }),
    );
    expect(v.domains.find((d) => d.domain === 'sleep')?.suppressedBy).toBeNull();
  });

  it('active illness disqualifies the domains it explains, and only those', () => {
    const v = gradeConvergence(
      healthy({ rhrDaily: fill(58), hrvLnRolling: fill(ln(45)), acwrDaily: fill(2.0) }),
      clearContext({ illnessActive: true }),
    );
    const byDomain = Object.fromEntries(v.domains.map((d) => [d.domain, d]));
    expect(byDomain.cardiac.suppressedBy).toBe('illness');
    expect(byDomain.autonomic.suppressedBy).toBe('illness');
    expect(byDomain.load.suppressedBy).toBeNull();   // illness explains no ratio
    expect(v.grade).toBe('green');
  });

  it('the post-race window suppresses the disturbance a race is supposed to cause', () => {
    const v = gradeConvergence(
      healthy({ rhrDaily: fill(58), hrvLnRolling: fill(ln(45)), sleepNightly: fill(6.0) }),
      clearContext({ daysSinceLastRace: 3, postRaceWindowDays: 14 }),
    );
    expect(v.grade).toBe('green');
  });

  it('a suppressed domain is still reported, so the working stays inspectable', () => {
    const v = gradeConvergence(
      healthy({ rhrDaily: fill(60) }),
      clearContext({ alcoholLastNight: true }),
    );
    const cardiac = v.domains.find((d) => d.domain === 'cardiac')!;
    expect(cardiac.dragging).toBe(true);
    expect(cardiac.counts).toBe(false);
    expect(cardiac.suppressedBy).toBe('alcohol');
    expect(v.rationale).toContain('alcohol');
  });
});

/* ────────────────── Thin and absent data ─────────────────────────────── */

describe('a picture we cannot see does not vote', () => {
  it('a runner with no HRV data at all still grades on the domains he has', () => {
    const v = gradeConvergence(
      healthy({
        hrvLnRolling: fill(null),
        hrvLnBaseline: null,
        hrvLnSd60d: null,
        rhrDaily: fill(56),
        sleepNightly: fill(6.0),
        acwrDaily: fill(1.9),
      }),
      clearContext(),
    );
    // Absent HRV is not a bad HRV.
    expect(v.domains.find((d) => d.domain === 'autonomic')?.dragging).toBe(false);
    // The three he does have converge.
    expect(new Set(v.converging)).toEqual(new Set(['cardiac', 'sleep', 'load']));
    expect(v.grade).toBe('red');
  });

  it('missing HRV alone never counts as a dragging domain', () => {
    const v = gradeConvergence(
      healthy({ hrvLnRolling: fill(null), hrvLnBaseline: null, hrvLnSd60d: null }),
      clearContext(),
    );
    expect(v.grade).toBe('green');
    expect(v.converging).toEqual([]);
  });

  it('a day-one runner with no baseline cannot fire, however bad the numbers', () => {
    const v = gradeConvergence(
      healthy({
        baselineDays: 1,
        rhrDaily: fill(70),
        hrvLnRolling: fill(ln(20)),
        sleepNightly: fill(4.0),
        acwrDaily: fill(4.0),
        subjectiveWreckedOnEasy: true,
      }),
      clearContext(),
    );
    expect(v.grade).toBe('green');
    expect(v.converging).toEqual([]);
    expect(v.rationale).toContain('cold start');
  });

  it('the cold-start gate is doctrine\'s 14 days, and clears at exactly 14', () => {
    const bad = {
      rhrDaily: fill(58), sleepNightly: fill(6.0), hrvLnRolling: fill(ln(48)),
    };
    const ctx = clearContext();
    expect(gradeConvergence(healthy({ ...bad, baselineDays: 13 }), ctx).grade).toBe('green');
    expect(gradeConvergence(healthy({ ...bad, baselineDays: 14 }), ctx).grade).toBe('red');
    expect(CONVERGENCE.minBaselineDays).toBe(14);
  });

  it('a gap in a series breaks the streak rather than extending it', () => {
    const withGap = [...fill(48, 27), 56, null, 56];
    const v = gradeConvergence(healthy({ rhrDaily: withGap }), clearContext());
    // Only the final day survives the gap · one day is not two.
    expect(v.domains.find((d) => d.domain === 'cardiac')?.daysSustained).toBe(1);
    expect(v.domains.find((d) => d.domain === 'cardiac')?.dragging).toBe(false);
  });
});

/* ────────────────── Determinism ──────────────────────────────────────── */

describe('determinism', () => {
  it('the same evidence always grades the same way', () => {
    const s = healthy({ rhrDaily: fill(56), sleepNightly: fill(6.0), hrvLnRolling: fill(ln(50)) });
    const c = clearContext();
    const runs = Array.from({ length: 25 }, () => JSON.stringify(gradeConvergence(s, c)));
    expect(new Set(runs).size).toBe(1);
  });

  it('the module reads no clock and no randomness', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./convergence.ts', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/Math\.random/);
    expect(code).not.toMatch(/Date\.now|new Date\(\)/);
  });
});

/* ────────────────── Coach voice ──────────────────────────────────────── */

describe('coach voice', () => {
  const red = () => gradeConvergence(
    healthy({ rhrDaily: fill(54), sleepNightly: fill(6.0), hrvLnRolling: fill(ln(50)) }),
    clearContext(),
  );

  it('names the convergence, not the metric', () => {
    const copy = convergenceCopy(red(), { from: 'threshold session', to: 'an easy 6 miles', movedTo: 'Thursday' })!;
    expect(copy).toContain('short nights');
    expect(copy).toContain('resting heart rate');
    // No numbers-about-numbers.
    expect(copy).not.toMatch(/z-score|z score|\bSD\b|standard deviation|percentile/i);
    expect(copy).not.toMatch(/-?\d+\.\d+/);
  });

  it('never scolds', () => {
    const variants = [
      convergenceCopy(red(), { from: 'threshold session', to: 'an easy 6 miles', movedTo: 'Thursday' }),
      convergenceCopy(red(), { from: 'threshold session', to: 'an easy 6 miles', movedTo: null }),
      convergenceCopy(
        gradeConvergence(healthy({ rhrDaily: fill(54), sleepNightly: fill(6.0) }), clearContext()),
        null,
      ),
    ].filter((s): s is string => s != null);
    expect(variants.length).toBeGreaterThan(0);
    for (const copy of variants) {
      // The owner's own line: moralising about a six-hour night gets the app
      // deleted. No instruction, no judgement, no should.
      expect(copy, copy).not.toMatch(
        /\byou (should|need to|must|have to|ought)\b|\bprioriti[sz]e\b|\bmake sure\b|\btry to\b|\bgo to bed\b|\bearlier\b|\bdiscipline\b|\bexcuse\b|\bpoor\b|\bbad\b|\bfailed?\b/i,
      );
    }
  });

  it('obeys the design brief · no exclamation, no emoji, no em dash, no hype', () => {
    const copy = convergenceCopy(red(), { from: 'threshold session', to: 'an easy 6 miles', movedTo: 'Thursday' })!;
    expect(copy).not.toContain('!');
    expect(copy).not.toContain('—');
    expect(copy).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    expect(copy.length).toBeLessThan(220);
  });

  it('amber tells the runner and explicitly leaves the day alone', () => {
    const amber = gradeConvergence(
      healthy({ rhrDaily: fill(54), sleepNightly: fill(6.0) }),
      clearContext(),
    );
    expect(amber.grade).toBe('amber');
    const copy = convergenceCopy(amber, null)!;
    expect(copy).toContain('stands as written');
  });

  it('green says nothing at all', () => {
    expect(convergenceCopy(gradeConvergence(healthy(), clearContext()), null)).toBeNull();
  });

  it('a suppressed domain is never named in the copy', () => {
    const v = gradeConvergence(
      healthy({ rhrDaily: fill(58), sleepNightly: fill(6.0), hrvLnRolling: fill(ln(48)) }),
      clearContext({ heatFlaggedDaysRecent: 2 }),
    );
    const copy = convergenceCopy(v, null);
    expect(copy).not.toBeNull();
    expect(copy!).not.toContain('resting heart rate');
  });
});
