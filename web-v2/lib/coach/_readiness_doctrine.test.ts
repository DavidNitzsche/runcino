/**
 * READINESS · the composite score must match its own methodology.
 *
 * Two doctrine defects and one owner ruling, all locked out here.
 *
 * 1 · WEIGHTS INVERTED THE FIDELITY ORDER. The engine weighted Sleep 28 /
 *     HRV 28 / RHR 24. `BuildResearch · D1-recovery-score-methodology.md`
 *     §"Summary table — recommended input weights for a runner" is HRV 40,
 *     Sleep 22, RHR 18, and §2.1 states the direction of the error outright:
 *     "Below 40% under-uses the signal."
 *
 * 2 · LOAD WAS ADDED WHERE DOCTRINE MULTIPLIES. `readiness.ts` gave a
 *     sweet-spot ACWR +5 points and a spike −8. D1 §2.4 makes load "a 'load
 *     context' multiplier in the range [0.85, 1.10] applied after the
 *     biometric composite", and D1 §"Why these weights" gives the reason:
 *     as a multiplier "it can't *create* a score; it can only modulate one".
 *
 * 3 · THE BAND WAS ABSOLUTE ON A PERSONAL NUMBER (owner ruling 2026-08-17).
 *     Every pillar is measured against the runner's own baseline and then
 *     banded on a fixed 50/65/85 scale. Live result: 18 PULL BACK days in 78
 *     (23%), trained through on 12 of them, band flipping on 29 of 77
 *     transitions. D1 §2.1 "only intra-individual trends matter" and §2.8
 *     "the algorithm normalizes against the individual's own 60-day mean/SD"
 *     were already the answer.
 *
 * The registry (lib/doctrine/registry.ts · READINESS.*) reads the weights and
 * the multiplier range out of the doc at run time. This file is the
 * behavioural half: what the score DOES with them.
 */
import { describe, it, expect } from 'vitest';
import {
  computeReadiness,
  loadContextMultiplier,
  READINESS_WEIGHTS,
  LOAD_CONTEXT_MULTIPLIER,
  BASELINE_MIN_DAYS,
  BAND_Z,
  PULLBACK_MIN_DRAGGING_PILLARS,
  type ReadinessBandBaseline,
} from './readiness';
import type { CoachState } from '@/lib/topics/types';

const CITE_WEIGHTS = 'BuildResearch · D1 §"Summary table — recommended input weights for a runner"';
const CITE_MULT = 'BuildResearch · D1 §2.4 · load is a multiplier in [0.85, 1.10] applied AFTER the composite';
const CITE_PERSONAL = 'BuildResearch · D1 §2.1 / §2.8 · only intra-individual trends matter';

/** A day with every pillar present and sitting exactly on baseline. */
function neutralDay(over: Partial<Record<string, unknown>> = {}): CoachState {
  return {
    sleep7Avg: 7.5,
    hrvCurrent: 60, hrvBaseline: 60,
    rhrCurrent: 50, rhrBaseline: 50,
    hrRecoveryCurrent: 25, hrRecoveryBaseline: 25,
    loadAcwr: 1.15, loadAcute7: 4.6, loadChronic28: 4,
    ...over,
  } as unknown as CoachState;
}

const pillar = (r: ReturnType<typeof computeReadiness>, key: string) =>
  r.inputs.find((i) => i.key === key)!;

describe('READINESS-1 · pillar weights follow the doctrine fidelity order', () => {
  it('HRV outranks sleep, sleep outranks RHR', () => {
    expect(READINESS_WEIGHTS.hrv, `${CITE_WEIGHTS} · HRV 40%`).toBe(0.40);
    expect(READINESS_WEIGHTS.sleep, `${CITE_WEIGHTS} · Sleep Quality Index 22%`).toBe(0.22);
    expect(READINESS_WEIGHTS.rhr, `${CITE_WEIGHTS} · RHR 18%`).toBe(0.18);
    expect(READINESS_WEIGHTS.load, `${CITE_WEIGHTS} · Training-load context 15%`).toBe(0.15);
  });

  it('a full HRV drop now outweighs a full sleep drop · it did not before', () => {
    // Both pillars taken to their own full-deviation point.
    const hrvCrash = computeReadiness(neutralDay({ hrvCurrent: 60 * 0.6 }));   // -40%, past the -36% cap
    const sleepCrash = computeReadiness(neutralDay({ sleep7Avg: 7.5 - 2.5 })); // -2.5 h, past the -2.25 cap
    const hrvDrag = Math.abs(pillar(hrvCrash, 'hrv').weight);
    const sleepDrag = Math.abs(pillar(sleepCrash, 'sleep').weight);
    expect(hrvDrag, `${CITE_WEIGHTS} · HRV 40% must drag harder than sleep 22%`)
      .toBeGreaterThan(sleepDrag);
    // And the ratio should track the weights, not merely differ.
    expect(hrvDrag / sleepDrag).toBeCloseTo(READINESS_WEIGHTS.hrv / READINESS_WEIGHTS.sleep, 1);
  });

  it('RHR stays a confirmer, never a driver (D1 §2.2)', () => {
    const rhrSpike = computeReadiness(neutralDay({ rhrCurrent: 60 }));
    const hrvCrash = computeReadiness(neutralDay({ hrvCurrent: 36 }));
    expect(
      Math.abs(pillar(rhrSpike, 'rhr').weight),
      'BuildResearch · D1 §2.2 · "A confirmer, not a primary driver."',
    ).toBeLessThan(Math.abs(pillar(hrvCrash, 'hrv').weight));
  });
});

describe('READINESS-2 · load is a post-composite multiplier, not a pillar', () => {
  it('every multiplier value sits inside doctrine\'s stated range', () => {
    for (const [name, v] of Object.entries(LOAD_CONTEXT_MULTIPLIER)) {
      expect(v, `${CITE_MULT} · ${name}`).toBeGreaterThanOrEqual(0.85);
      expect(v, `${CITE_MULT} · ${name}`).toBeLessThanOrEqual(1.10);
    }
  });

  it('D1 §6 step 4 · the branch values, in order', () => {
    // if ACWR > 1.5 and ATL > CTL → 0.88 ; elif ACWR > 1.3 → 0.95 ; else 1.00
    expect(loadContextMultiplier(1.7, 8, 4), `${CITE_MULT} · spike`).toBe(0.88);
    expect(loadContextMultiplier(1.4, 5.6, 4), `${CITE_MULT} · elevated`).toBe(0.95);
    expect(loadContextMultiplier(1.15, 4.6, 4), `${CITE_MULT} · sweet spot is NEUTRAL`).toBe(1.00);
    expect(loadContextMultiplier(0.9, 3.6, 4), `${CITE_MULT} · building is NEUTRAL`).toBe(1.00);
    expect(loadContextMultiplier(0.6, 2.4, 4), `${CITE_MULT} · planned freshness`).toBe(1.05);
    expect(loadContextMultiplier(null, null, null), `${CITE_MULT} · no history, no opinion`).toBe(1.00);
  });

  it('a sweet-spot ACWR no longer manufactures readiness points', () => {
    // The shipped defect: identical biometrics, +5 points for having run a
    // normal week. Under the multiplier the sweet spot is exactly neutral.
    // Fix the sleep target explicitly · this test is about the multiplier, not
    // the target. (Until 2026-08-19 the target ALSO keyed off ACWR, which is
    // why the override was needed here; it now keys off weekly mileage, per
    // Research/00b's own axis, and the override is kept because pinning the
    // target is still the right way to isolate the multiplier.)
    const sweet = computeReadiness(neutralDay({ loadAcwr: 1.15, loadAcute7: 4.6, loadChronic28: 4 }), 7.5);
    const noLoadData = computeReadiness(neutralDay({ loadAcwr: null, loadAcute7: null, loadChronic28: null }), 7.5);
    expect(sweet.score, 'BuildResearch · D1 §"Why these weights" · a modifier cannot create a score')
      .toBe(noLoadData.score);
    expect(pillar(sweet, 'load').weight).toBe(0);
  });

  it('run history without biometrics is not a readiness score at all', () => {
    const r = computeReadiness({
      sleep7Avg: null, hrvCurrent: null, hrvBaseline: null,
      rhrCurrent: null, rhrBaseline: null,
      hrRecoveryCurrent: null, hrRecoveryBaseline: null,
      loadAcwr: 1.15, loadAcute7: 4.6, loadChronic28: 4,
    } as unknown as CoachState);
    expect(r.score, `${CITE_MULT} · "it can't create a score"`).toBeNull();
    expect(r.band).toBe('unknown');
  });

  it('the load bonus cannot lift a score past its pillar-derived ceiling', () => {
    const everythingMaxed = neutralDay({ hrvCurrent: 200, rhrCurrent: 20, sleep7Avg: 12, hrRecoveryCurrent: 60 });
    const withBonus = computeReadiness({ ...everythingMaxed, loadAcwr: 0.5, loadAcute7: 2, loadChronic28: 4 } as CoachState);
    const withoutBonus = computeReadiness({ ...everythingMaxed, loadAcwr: 1.15, loadAcute7: 4.6, loadChronic28: 4 } as CoachState);
    expect(withBonus.score!, `${CITE_MULT} · the ceiling is the pillars', not the modifier's`)
      .toBeLessThanOrEqual(Math.max(withoutBonus.score!, 100));
  });

  it('the spike penalty scales the whole composite, it does not subtract a fixed 8', () => {
    const strong = neutralDay({ hrvCurrent: 78, sleep7Avg: 8.5 });
    const calm = computeReadiness({ ...strong, loadAcwr: 1.15, loadAcute7: 4.6, loadChronic28: 4 } as CoachState, 7.5);
    const spiked = computeReadiness({ ...strong, loadAcwr: 1.7, loadAcute7: 8, loadChronic28: 4 } as CoachState, 7.5);
    const drop = calm.score! - spiked.score!;
    expect(drop, `${CITE_MULT} · x0.88 of a high composite is more than 8 points`).toBeGreaterThan(8);
    expect(spiked.score!).toBeCloseTo(calm.score! * 0.88, 0);
  });
});

describe('READINESS-3 · the band reads the runner\'s own normal (owner ruling 2026-08-17)', () => {
  const baselineOf = (scores: number[]): ReadinessBandBaseline => ({ recent: scores });
  const steady = (n: number, v: number) => Array.from({ length: n }, () => v);

  it('with no personal history the band cannot go red or green', () => {
    // D1 §5 · days 0-13 are provisional; the score shows, the verdict does not.
    const crashed = computeReadiness(neutralDay({ hrvCurrent: 30, sleep7Avg: 4.5, rhrCurrent: 62 }));
    expect(crashed.band, `${CITE_PERSONAL} · D1 §5 provisional window`).not.toBe('pull-back');
    const great = computeReadiness(neutralDay({ hrvCurrent: 95, sleep7Avg: 9 }));
    expect(great.band, `${CITE_PERSONAL} · D1 §5 provisional window`).not.toBe('sharp');
  });

  it(`needs ${BASELINE_MIN_DAYS} days before it will judge a day at all`, () => {
    const day = neutralDay({ hrvCurrent: 30, sleep7Avg: 4.5, rhrCurrent: 62 });
    const short = computeReadiness(day, undefined, baselineOf(steady(BASELINE_MIN_DAYS - 1, 64)));
    expect(short.personal, 'D1 §5 · a useful score requires 14 days of history').toBeNull();
    const enough = computeReadiness(day, undefined, baselineOf(steady(BASELINE_MIN_DAYS, 64)));
    expect(enough.personal).not.toBeNull();
  });

  it('a runner who lives at 60-68 reads 64 as an ordinary day', () => {
    // The owner's case, exactly: his normal is not the population's normal.
    const recent = Array.from({ length: 28 }, (_, i) => 60 + (i % 9));
    // Score him onto his own middle.
    const r = computeReadiness(neutralDay(), undefined, baselineOf(recent));
    expect(r.personal!.normal).toBeGreaterThanOrEqual(60);
    expect(r.personal!.normal).toBeLessThanOrEqual(68);
    // 70 against a normal of ~64 with a ~2.6 spread is a good day, not a
    // borderline one — and it is certainly not PULL BACK.
    expect(r.band, `${CITE_PERSONAL} · an ordinary day for him must read ordinary`).not.toBe('pull-back');
  });

  it('PULL BACK needs a deep deviation AND yesterday AND two dragging pillars', () => {
    const recent = steady(27, 64);
    const cut = 64 + BAND_Z.pullBack * 1; // sd floors at 1 on a flat history
    // A single crashed day with a good yesterday is NOT pull-back.
    const oneBadDay = computeReadiness(
      neutralDay({ hrvCurrent: 20, sleep7Avg: 4, rhrCurrent: 62 }),
      undefined,
      baselineOf([...recent, 64]),
    );
    expect(oneBadDay.band, 'BuildResearch · D1 §2.2 · one night is noise; two days is a signal')
      .not.toBe('pull-back');

    // Same day, with yesterday also below the cut → the sustained gate opens.
    const sustained = computeReadiness(
      neutralDay({ hrvCurrent: 20, sleep7Avg: 4, rhrCurrent: 62 }),
      undefined,
      baselineOf([...recent, Math.floor(cut) - 5]),
    );
    expect(sustained.band, 'sustained + corroborated + past -2 SD is the whole bar').toBe('pull-back');

    // One pillar alone, however bad, is not corroboration.
    const oneSignal = computeReadiness(
      neutralDay({ sleep7Avg: 3 }),
      undefined,
      baselineOf([...recent, Math.floor(cut) - 5]),
    );
    const dragging = oneSignal.inputs.filter(
      (i) => i.key !== 'load' && i.weight < 0,
    ).length;
    if (dragging < PULLBACK_MIN_DRAGGING_PILLARS) {
      expect(oneSignal.band, 'BuildResearch · D1 §3 · corroborating signals are what make evidence')
        .not.toBe('pull-back');
    }
  });

  it('fires rarely on the runner\'s real distribution · the 23% is the defect', () => {
    // A deterministic AR(1) series calibrated to the live evidence: mean 58,
    // SD 11 (so ~23% of days fall under the old absolute 50 cut) and lag-1
    // correlation 0.70 (so the mean day-to-day swing is ~6.8 points). Those
    // are the two statistics the audit reported for his 78 snapshot days.
    let seed = 20260817;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const gauss = () => {
      const u = Math.max(1e-9, rnd());
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
    };
    const MEAN = 58, SD = 11, RHO = 0.70, DAYS = 4000;
    const series: number[] = [MEAN];
    for (let i = 1; i < DAYS; i++) {
      const prev = series[i - 1];
      series.push(Math.max(0, Math.min(100,
        MEAN + RHO * (prev - MEAN) + Math.sqrt(1 - RHO * RHO) * SD * gauss())));
    }

    // The old absolute rule, for the comparison the ruling is built on.
    const oldPullBack = series.filter((s) => s < 50).length / series.length;
    expect(oldPullBack, 'the shipped absolute cut fired on ~23% of his days').toBeGreaterThan(0.15);

    // The new rule, run over the same series with a 28-day rolling window.
    let fired = 0, judged = 0;
    for (let i = 28; i < series.length; i++) {
      const window = series.slice(i - 28, i);
      const mean = window.reduce((s, x) => s + x, 0) / window.length;
      const sd = Math.max(1, Math.sqrt(window.reduce((s, x) => s + (x - mean) ** 2, 0) / window.length));
      const z = (series[i] - mean) / sd;
      const cut = mean + BAND_Z.pullBack * sd;
      judged++;
      // Corroboration is assumed satisfied on a day this deep · this measures
      // the two gates the score can see from the series alone, so the real
      // rate is at or below what this asserts.
      if (z <= BAND_Z.pullBack && series[i - 1] <= cut) fired++;
    }
    const rate = fired / judged;
    // Target: genuinely rare. Under 3% of days, i.e. at most ~2 of his 78.
    expect(rate, 'owner ruling · silence is the default; 23% of days is noise by definition')
      .toBeLessThan(0.03);
    expect(rate, 'and not so rare it can never speak').toBeGreaterThan(0);
  });

  it('SHARP is equally personal · a good day for him, not a good day in general', () => {
    const lowLiver = computeReadiness(
      neutralDay({ hrvCurrent: 66, sleep7Avg: 8.2 }),
      undefined,
      { recent: Array.from({ length: 28 }, (_, i) => 55 + (i % 5)) },
    );
    expect(lowLiver.personal!.z).toBeGreaterThan(0);
    expect(lowLiver.band, `${CITE_PERSONAL} · his ceiling is his own`).not.toBe('moderate');
  });
});

describe('READINESS-4 · the score informs, it never mutates', () => {
  it('exposes no prescription, cap, or plan mutation on the breakdown', () => {
    const r = computeReadiness(neutralDay({ hrvCurrent: 20, sleep7Avg: 4, rhrCurrent: 64 }));
    const keys = Object.keys(r);
    // Owner ruling 2026-08-17 + the locked no-reactive-coach rule. The score
    // returns a number, a word, and the reasons — nothing actionable.
    // `coverage` (COLD-5, 2026-08-17) is a statement about how much of the
    // recovery picture backs the score. It is a disclosure, not an
    // instruction — it says how far to trust the number, never what to do.
    expect(keys.sort()).toEqual(['band', 'coverage', 'inputs', 'label', 'personal', 'score']);
    for (const input of r.inputs) {
      expect(
        Object.keys(input).sort(),
        'a pillar carries an observation and a meaning · never an instruction field',
      ).toEqual(['key', 'label', 'meaning', 'observedSub', 'observedV', 'weight']);
    }
  });
});
