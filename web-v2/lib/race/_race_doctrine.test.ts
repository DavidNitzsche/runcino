/**
 * RACE-EXECUTION DOCTRINE CONFORMANCE · the "could wreck a race" cluster.
 *
 * Commissioned by docs/DOCTRINE-CONFORMANCE-AUDIT-2026-08-17.md, whose
 * headline finding was one shape repeated ten times: a per-distance
 * research table read at ONE row and applied to every distance. Five
 * instances lived in the race-execution path, and one of them was
 * regression-locked by a test that asserted the wrong row.
 *
 * Every assertion below encodes a cell of a research table and names the
 * citation in its failure message. They walk EVERY distance category, not
 * the half the fixtures happen to use — a suite that only ever exercises
 * one row is how a single-row constant survives review.
 *
 * Tables under test:
 *   Research/08 §3.1  (:58-64)   first mile vs goal pace, by distance
 *   Research/08 §4.3  (:182-189) controlled even / 1-2% negative split
 *   Research/08 §6.1  (:271-278) HR ceilings by distance
 *   Research/08 §10.1 (:452-457) carb loading by distance
 *   Research/08 §12.1 (:588-595) warm-up by distance
 *   Research/10       (:110-146) race warm-up detail · marathon: no strides
 *   Research/18 §11   (:367-376) during-race CHO/hr + caffeine by distance
 */
import { describe, it, expect } from 'vitest';
import {
  RACE_DISTANCE_CATEGORIES,
  RACE_OPENING_ALLOWANCE,
  RACE_CARB_LOAD,
  RACE_CARB_G_PER_HR,
  RACE_HR_PCT_LTHR,
  RACE_HR_PCT_MAX,
  RACE_WARMUP,
  raceDistanceCategory,
  raceOpeningPlan,
  raceOpeningSegments,
  openingAdjustmentOverSpan,
  raceCheckpointMi,
  raceAbortHrBpm,
  raceCarbsPerHourTarget,
  warmupTotalMin,
  type RaceDistanceCategory,
} from './distance-doctrine';
import { composeRaceExecutionPlan, computeRaceFueling } from './execution-plan';
import { buildGels } from './race-detail-pacing';
import { computeFueling } from '@/lib/training/fueling';

/** One realistic race per row of every doctrine table. */
const FIXTURES: Record<RaceDistanceCategory, { label: string; goalSec: number; distanceMi: number }> = {
  '5k': { label: '5K · 20:00', goalSec: 1200, distanceMi: 3.1 },
  '10k': { label: '10K · 42:00', goalSec: 2520, distanceMi: 6.2 },
  'hm': { label: 'Half · 1:30:00', goalSec: 5400, distanceMi: 13.1 },
  'm': { label: 'Marathon · 3:15:00', goalSec: 11700, distanceMi: 26.2 },
  'ultra': { label: '50K · 5:00:00', goalSec: 18000, distanceMi: 31.07 },
};

const LTHR = 162;
const MAX_HR = 181;

const planFor = (cat: RaceDistanceCategory) =>
  composeRaceExecutionPlan({ ...FIXTURES[cat], lthr: LTHR, maxHr: MAX_HR, vdot: 47.9, startTimeLocal: '7:00 AM' })!;

// ─────────────────────────────────────────────────────────────────────────
describe('the distance categories cover the doctrine tables', () => {
  it('every table has a row for every category', () => {
    for (const cat of RACE_DISTANCE_CATEGORIES) {
      expect(RACE_OPENING_ALLOWANCE[cat], cat).toBeDefined();
      expect(RACE_CARB_LOAD[cat], cat).toBeDefined();
      expect(RACE_CARB_G_PER_HR[cat], cat).toBeDefined();
      expect(RACE_HR_PCT_LTHR[cat], cat).toBeDefined();
      expect(RACE_HR_PCT_MAX[cat], cat).toBeDefined();
      expect(RACE_WARMUP[cat], cat).toBeDefined();
    }
  });

  it('the named distances land on their own row', () => {
    expect(raceDistanceCategory(3.1)).toBe('5k');
    expect(raceDistanceCategory(6.2)).toBe('10k');
    expect(raceDistanceCategory(13.1)).toBe('hm');
    expect(raceDistanceCategory(26.2)).toBe('m');
    expect(raceDistanceCategory(31.07)).toBe('ultra');
    expect(raceDistanceCategory(100)).toBe('ultra');
    // In-between distances take the row whose physiology they share.
    expect(raceDistanceCategory(10)).toBe('hm');   // 10-miler
    expect(raceDistanceCategory(20)).toBe('m');    // 20-miler
  });
});

// ── 1 · OPENING ALLOWANCE ────────────────────────────────────────────────
describe('Research/08 §3.1 (:58-64) · first mile vs goal pace, by distance', () => {
  const BANDS: Record<RaceDistanceCategory, [number, number]> = {
    '5k': [-2, 5],      // :60
    '10k': [5, 10],     // :61
    'hm': [10, 15],     // :62
    'm': [10, 20],      // :63
    'ultra': [10, 20],  // :63 — no ultra row; marathon band, conservative end
  };

  for (const cat of RACE_DISTANCE_CATEGORIES) {
    it(`${FIXTURES[cat].label} opens inside its own band, not the half's +12`, () => {
      const [lo, hi] = BANDS[cat];
      const plan = planFor(cat);
      expect(
        plan.firstMileAllowanceSPerMi,
        `${cat}: Research/08 §3.1 gives ${lo} to ${hi} s/mi over goal pace`,
      ).toBeGreaterThanOrEqual(lo);
      expect(plan.firstMileAllowanceSPerMi).toBeLessThanOrEqual(hi);
      // …and the split card actually emits it.
      const goalPace = FIXTURES[cat].goalSec / FIXTURES[cat].distanceMi;
      expect(plan.splits[0].paceSPerMi).toBe(Math.round(goalPace + plan.firstMileAllowanceSPerMi));
      expect(plan.splits[0].label).toBe('settle');
    });
  }

  it('the extremes are genuinely different · a 5K is not paced like a marathon', () => {
    // The shipped defect: +12 s/mi everywhere. A 5K cannot give away 12 s
    // in mile 1 (§3.2 :73 "hit goal pace within 1-2 sec"), and a marathon
    // giving away only 12 is short of the glycogen-conservation opener.
    expect(RACE_OPENING_ALLOWANCE['5k'].firstMileSPerMi).toBeLessThanOrEqual(5);
    expect(RACE_OPENING_ALLOWANCE.m.firstMileSPerMi).toBeGreaterThan(
      RACE_OPENING_ALLOWANCE.hm.firstMileSPerMi,
    );
    expect(RACE_OPENING_ALLOWANCE.m.firstMileSPerMi).toBeGreaterThanOrEqual(
      RACE_OPENING_ALLOWANCE['5k'].firstMileSPerMi * 5,
    );
  });

  it('the early block matches each distance template (§3.2-3.5)', () => {
    // 5K/10K return to goal pace after mile 1; the half holds +5-10 through
    // mile 3 (:102-105); the marathon holds it through mile 10 (:114-118).
    expect(RACE_OPENING_ALLOWANCE['5k'].earlyThroughMi).toBe(1);
    expect(RACE_OPENING_ALLOWANCE['10k'].earlyThroughMi).toBe(1);
    expect(RACE_OPENING_ALLOWANCE.hm.earlyThroughMi).toBe(3);
    expect(RACE_OPENING_ALLOWANCE.m.earlyThroughMi).toBe(10);
    for (const cat of ['hm', 'm'] as const) {
      const row = RACE_OPENING_ALLOWANCE[cat];
      expect(row.earlySPerMi, `${cat}: §3.4/§3.5 early block is GP +5-10`).toBeGreaterThanOrEqual(5);
      expect(row.earlySPerMi).toBeLessThanOrEqual(10);
    }
  });

  for (const cat of RACE_DISTANCE_CATEGORIES) {
    it(`${FIXTURES[cat].label} lands a 0-2% negative split (§4.3 :182-189)`, () => {
      const { goalSec, distanceMi } = FIXTURES[cat];
      const plan = raceOpeningPlan({ goalSec, distanceMi });
      const half = distanceMi / 2;
      const adj1 = openingAdjustmentOverSpan(plan, 0, half);
      const adj2 = openingAdjustmentOverSpan(plan, half, distanceMi);
      const pct = ((adj1 - adj2) / (plan.goalPaceSPerMi + adj1)) * 100;
      expect(pct, `${cat}: second half must not be SLOWER than the first`).toBeGreaterThanOrEqual(0);
      expect(
        pct,
        `${cat}: §4.3 (:189) — 1-2% is the realistic stretch, 3%+ means the first half was too slow`,
      ).toBeLessThanOrEqual(2.0);
    });
  }

  for (const cat of RACE_DISTANCE_CATEGORIES) {
    it(`${FIXTURES[cat].label} splits still sum to the goal exactly`, () => {
      const plan = planFor(cat);
      expect(plan.splits[plan.splits.length - 1].cumulativeSec).toBe(FIXTURES[cat].goalSec);
    });
  }
});

// ── 2 · WATCH / PHONE AGREEMENT ─────────────────────────────────────────
describe('the watch and the phone open the race the same way', () => {
  for (const cat of RACE_DISTANCE_CATEGORIES) {
    it(`${FIXTURES[cat].label} · watch settle phase === phone mile 1`, () => {
      const { goalSec, distanceMi } = FIXTURES[cat];
      // What lib/watch/build-workout.ts pushes to the wrist…
      const segments = raceOpeningSegments({ goalSec, distanceMi });
      // …and what lib/race/execution-plan.ts prints on the phone.
      const plan = planFor(cat);
      expect(segments.length, 'the watch must carry a settle phase, not flat goal pace').toBeGreaterThan(1);
      expect(segments[0].label).toBe('Settle');
      expect(
        segments[0].paceSPerMi,
        `${cat}: the wrist and the split card must prescribe the same opening (Research/08 §3.1)`,
      ).toBe(plan.splits[0].paceSPerMi);
    });
  }

  it('the watch never races flat from the gun · every distance settles', () => {
    for (const cat of RACE_DISTANCE_CATEGORIES) {
      const { goalSec, distanceMi } = FIXTURES[cat];
      const segments = raceOpeningSegments({ goalSec, distanceMi });
      const goalPace = goalSec / distanceMi;
      expect(segments[0].paceSPerMi, `${cat}: opening segment must be at or over goal pace`)
        .toBeGreaterThanOrEqual(Math.round(goalPace));
      expect(segments[segments.length - 1].paceSPerMi, `${cat}: the close repays the opening`)
        .toBeLessThan(Math.round(goalPace));
    }
  });

  it('the watch segments still add up to the goal', () => {
    for (const cat of RACE_DISTANCE_CATEGORIES) {
      const { goalSec, distanceMi } = FIXTURES[cat];
      const segments = raceOpeningSegments({ goalSec, distanceMi });
      const total = segments.reduce((s, x) => s + x.durationSec, 0);
      const dist = segments.reduce((s, x) => s + x.distanceMi, 0);
      expect(Math.abs(total - goalSec), `${cat}: watch plan drifts from the goal`).toBeLessThanOrEqual(30);
      expect(Math.abs(dist - distanceMi)).toBeLessThan(0.02);
    }
  });
});

// ── 3 · MID-RACE ABORT · HR + CHECKPOINT ────────────────────────────────
describe('Research/08 §6.1 (:271-278) · abort HR by distance', () => {
  const PCT_LTHR: Record<RaceDistanceCategory, [number, number]> = {
    '5k': [1.05, 1.10],
    '10k': [1.00, 1.05],
    'hm': [0.96, 1.00],
    'm': [0.88, 0.95],
    'ultra': [0.88, 0.95],
  };

  for (const cat of RACE_DISTANCE_CATEGORIES) {
    it(`${FIXTURES[cat].label} trips off its own %LTHR row, not LTHR+3`, () => {
      const [, hi] = PCT_LTHR[cat];
      const trigger = raceAbortHrBpm({ distanceMi: FIXTURES[cat].distanceMi, lthr: LTHR })!;
      const ceiling = Math.round(LTHR * hi);
      expect(trigger, `${cat}: §6.1 caps at ${Math.round(hi * 100)}% LTHR`).toBe(ceiling + 3);
      expect(planFor(cat).bGoalTriggers[0].hrAboveBpm).toBe(trigger);
    });
  }

  it('a marathoner is not told LTHR+3 is fine · that is 7% over the ceiling', () => {
    // The shipped defect: lthr + 3 = 165 for every distance. §6.1 caps a
    // marathon at 88-95% LTHR — 154 bpm for LTHR 162. A runner sitting at
    // 165 by mile 10 is blown and the trigger read "fine".
    const m = raceAbortHrBpm({ distanceMi: 26.2, lthr: LTHR })!;
    const hm = raceAbortHrBpm({ distanceMi: 13.1, lthr: LTHR })!;
    const k5 = raceAbortHrBpm({ distanceMi: 3.1, lthr: LTHR })!;
    expect(m).toBeLessThan(hm);
    expect(hm).toBeLessThan(k5);
    expect(m).toBeLessThanOrEqual(Math.round(LTHR * 0.95) + 3);
    expect(k5).toBeGreaterThanOrEqual(Math.round(LTHR * 1.05));
  });

  it('the %HRmax fallback is the same table, not a 0.91 constant', () => {
    for (const cat of RACE_DISTANCE_CATEGORIES) {
      const hi = RACE_HR_PCT_MAX[cat][1];
      expect(raceAbortHrBpm({ distanceMi: FIXTURES[cat].distanceMi, maxHr: MAX_HR }))
        .toBe(Math.round(MAX_HR * hi));
    }
    expect(raceAbortHrBpm({ distanceMi: 13.1 })).toBeNull();
  });

  for (const cat of RACE_DISTANCE_CATEGORIES) {
    it(`${FIXTURES[cat].label} checkpoint is inside the race`, () => {
      const { distanceMi } = FIXTURES[cat];
      const mi = raceCheckpointMi(distanceMi);
      expect(mi, `${cat}: a mile-5 checkpoint is dead in a 5K`).toBeLessThan(distanceMi);
      expect(mi).toBeGreaterThanOrEqual(1);
      expect(planFor(cat).bGoalTriggers[0].atMile).toBe(mi);
    });
  }

  it('the checkpoint scales with the race (§2.2 :44 · the prognostic segment)', () => {
    expect(raceCheckpointMi(3.1)).toBe(1);
    expect(raceCheckpointMi(6.2)).toBe(2);
    expect(raceCheckpointMi(13.1)).toBe(5);
    expect(raceCheckpointMi(26.2)).toBe(10);
  });

  it('the pace trigger is 5% of goal pace at every distance (§18.2 :767)', () => {
    for (const cat of RACE_DISTANCE_CATEGORIES) {
      const { goalSec, distanceMi } = FIXTURES[cat];
      const goalPace = goalSec / distanceMi;
      const trigger = planFor(cat).bGoalTriggers[0].paceSlowerThanSPerMi;
      expect(trigger / goalPace, `${cat}: a flat +23 s/mi was 5.6% of a half and 7% of a 5K`)
        .toBeCloseTo(1.05, 2);
    }
  });
});

// ── 4 · CARB LOADING ────────────────────────────────────────────────────
describe('Research/08 §10.1 (:452-457) · carb loading by distance', () => {
  it('the marathon loads 8-12 g/kg over 36-48h · NOT the half\'s 7-8 / 24-36h', () => {
    // This is the row the app shipped to everyone, and the row
    // execution-plan.test.ts:129 asserted unconditionally — the test
    // regression-locked the drift.
    const m = planFor('m').fueling.join(' ');
    expect(m, 'Research/08 §10.1 (:456) — Marathon 8-12 g/kg/day for 36-48 h').toContain('8-12 g/kg');
    expect(m).toContain('36-48h');
    expect(m, 'the half row must not appear on a marathon').not.toContain('7-8 g/kg');
  });

  it('the half loads 7-8 g/kg over 24-36h (:455)', () => {
    const hm = planFor('hm').fueling.join(' ');
    expect(hm).toContain('7-8 g/kg');
    expect(hm).toContain('24-36h');
  });

  it('5K and 10K get no load at all (:454 · supercompensation needs >90 min)', () => {
    for (const cat of ['5k', '10k'] as const) {
      const txt = planFor(cat).fueling.join(' ');
      expect(txt, `${cat}: Research/08 §10.1 (:450, :454) — normal training carbs`).toContain('No carb load needed');
      expect(txt).toContain('5-7 g/kg');
    }
  });

  it('the ultra loads over 48-72h (:457)', () => {
    const txt = planFor('ultra').fueling.join(' ');
    expect(txt).toContain('8-12 g/kg');
    expect(txt).toContain('48-72h');
  });

  it('no row exceeds the §18.2 (:770) 12 g/kg GI ceiling', () => {
    for (const cat of RACE_DISTANCE_CATEGORIES) {
      expect(RACE_CARB_LOAD[cat].gPerKgBand[1], cat).toBeLessThanOrEqual(12);
    }
  });
});

// ── 5 · DURING-RACE FUELLING + CAFFEINE ─────────────────────────────────
describe('Research/18 §11 (:367-376) · during-race CHO/hr by distance', () => {
  const BANDS: Record<RaceDistanceCategory, [number, number]> = {
    '5k': [0, 0],       // :369
    '10k': [0, 30],     // :370
    'hm': [30, 60],     // :371
    'm': [60, 90],      // :372
    'ultra': [60, 90],  // :373
  };

  for (const cat of RACE_DISTANCE_CATEGORIES) {
    it(`${FIXTURES[cat].label} targets its own g/hr band`, () => {
      const [lo, hi] = BANDS[cat];
      const { goalSec, distanceMi } = FIXTURES[cat];
      const target = raceCarbsPerHourTarget(distanceMi, goalSec).targetGPerHr;
      expect(target, `${cat}: Research/18 §11 gives ${lo}-${hi} g/hr`).toBeGreaterThanOrEqual(lo);
      expect(target).toBeLessThanOrEqual(hi);
      // …and the composer emits it.
      const fp = computeRaceFueling({ goalSec, distanceMi, goalPaceSPerMi: goalSec / distanceMi });
      expect(fp.targetCarbsPerHourG).toBe(target);
    });
  }

  it('a half is not fed the marathon\'s 75 g/hr', () => {
    // The shipped defect: DEFAULT_RACE_TARGET_G_PER_HR = 75 for any race.
    // §11 (:371) gives a half 30-60, and §1 (:27) makes 60 the threshold
    // above which single-source glucose causes GI distress.
    const hm = raceCarbsPerHourTarget(13.1, 5400).targetGPerHr;
    expect(hm).toBeLessThanOrEqual(60);
    expect(hm).toBeLessThan(raceCarbsPerHourTarget(26.2, 11700).targetGPerHr);
    expect(RACE_CARB_G_PER_HR.m.targetGPerHr).toBe(75);
  });

  it('a 20-minute 5K is prescribed nothing · no gel, no caffeine (:369)', () => {
    const fp = computeRaceFueling({ goalSec: 1200, distanceMi: 3.1, goalPaceSPerMi: 387 });
    expect(fp.targetCarbsPerHourG).toBe(0);
    expect(fp.recommendedServings).toBe(0);
    expect(fp.scheduleMi).toEqual([]);
    // The web race-detail card is where the caffeinated gel actually
    // shipped (race-detail-pacing.ts `hours × 1.7`, min 1).
    expect(buildGels(1200, 3.1), 'Research/18 §11 (:369) — 5K: 0 g/hr').toEqual([]);
    expect(buildGels(2520, 6.2), 'Research/18 §11 (:370) — 10K: pre-race caffeine only').toEqual([]);
  });

  it('an entered product cannot override doctrine-zero on a short race', () => {
    const fp = computeRaceFueling({
      goalSec: 1200, distanceMi: 3.1, goalPaceSPerMi: 387,
      fuel: { product: 'Maurten Gel 100', carbsPerServingG: 25, cadenceMin: 20 },
    });
    expect(fp.targetCarbsPerHourG).toBe(0);
  });

  it('caffeine follows the §11 plan · half one mid-race, marathon two', () => {
    const hm = buildGels(5400, 13.1);
    const m = buildGels(11700, 26.2);
    expect(hm.filter((g) => g.caf).length, 'Research/18 §11 (:371) — pre + 1 caf gel mid-race').toBe(1);
    expect(m.filter((g) => g.caf).length, 'Research/18 §11 (:372) — 100 mg @ mi 13 + 100 mg @ mi 20').toBe(2);
    // …and it is placed mid-race, not on the last two stops whatever the race.
    const cafMi = Number(hm.find((g) => g.caf)!.mi.replace(/[^\d.]/g, ''));
    expect(cafMi).toBeGreaterThan(13.1 * 0.3);
    expect(cafMi).toBeLessThan(13.1 * 0.8);
  });

  it('a long race still gets the §1 duration floor (:17-18)', () => {
    // A 3-hour half is governed by the duration table, not the distance
    // row · both are floors, the higher wins.
    expect(raceCarbsPerHourTarget(13.1, 3 * 3600).targetGPerHr).toBe(75);
    expect(raceCarbsPerHourTarget(13.1, 5400).targetGPerHr).toBe(45);
  });
});

describe('lib/training/fueling · the race target is the race\'s own row', () => {
  it('a marathon race day runs 60-90 g/hr, a half 30-60', () => {
    const m = computeFueling({ durationEstMin: 195, distanceMi: 26.2, raceDistanceMi: 26.2, workoutType: 'race' });
    const hm = computeFueling({ durationEstMin: 90, distanceMi: 13.1, raceDistanceMi: 13.1, workoutType: 'race' });
    expect(m.gPerHr).toBeGreaterThanOrEqual(60);
    expect(m.gPerHr).toBeLessThanOrEqual(90);
    expect(hm.gPerHr, 'Research/18 §11 (:371) — half is 30-60 g/hr, not the marathon\'s 75')
      .toBeLessThanOrEqual(60);
  });

  it('a 5K race day is fuelled with nothing', () => {
    const k5 = computeFueling({ durationEstMin: 20, distanceMi: 3.1, raceDistanceMi: 3.1, workoutType: 'race' });
    expect(k5.needed).toBe(false);
    expect(k5.gels).toBe(0);
  });

  it('the gut-training ramp only ever climbs (§13 + §1 :17-19)', () => {
    // A 5K goal race has a race-day target of 0. Ramping a three-hour long
    // run TOWARD zero would strip the fuel its own duration requires.
    const longRun = computeFueling({
      durationEstMin: 180, distanceMi: 20, workoutType: 'long',
      daysToARace: 7, raceDistanceMi: 3.1,
    });
    const noRace = computeFueling({ durationEstMin: 180, distanceMi: 20, workoutType: 'long' });
    expect(longRun.gPerHr).toBeGreaterThanOrEqual(noRace.gPerHr);
    expect(longRun.gPerHr).toBeGreaterThan(0);
  });

  it('a marathon goal still ramps long runs up toward race intake', () => {
    const far = computeFueling({
      durationEstMin: 150, distanceMi: 18, workoutType: 'long', daysToARace: 60, raceDistanceMi: 26.2,
    });
    const near = computeFueling({
      durationEstMin: 150, distanceMi: 18, workoutType: 'long', daysToARace: 7, raceDistanceMi: 26.2,
    });
    expect(near.gPerHr).toBeGreaterThan(far.gPerHr);
    expect(near.isRehearsal).toBe(true);
  });
});

// ── 6 · WARM-UP ─────────────────────────────────────────────────────────
describe('Research/08 §12.1 (:588-595) + Research/10 (:110-146) · warm-up by distance', () => {
  const stridesOf = (cat: RaceDistanceCategory) =>
    planFor(cat).warmup.filter((w) => w.step.includes('strides'));

  it('the marathon runs NO strides (Research/10 :133)', () => {
    expect(RACE_WARMUP.m.strides, 'Research/10 (:133) — "Marathon warmup… No strides."').toBe(0);
    expect(stridesOf('m')).toHaveLength(0);
    expect(stridesOf('ultra')).toHaveLength(0);
    // …and the whole protocol fits the 5-10 min band.
    expect(warmupTotalMin(RACE_WARMUP.m), 'Research/08 §12.1 (:593) — marathon warm-up is 5-10 min')
      .toBeLessThanOrEqual(10);
  });

  it('the 5K runs 4-6 strides and 15-25 min of warm-up (:590)', () => {
    const wu = RACE_WARMUP['5k'];
    expect(wu.strides).toBeGreaterThanOrEqual(4);
    expect(wu.strides).toBeLessThanOrEqual(6);
    expect(stridesOf('5k')).toHaveLength(1);
    expect(stridesOf('5k')[0].step).toContain('3K-mile pace');
  });

  it('warm-up volume falls monotonically as the race lengthens (:584)', () => {
    // "The shorter the race, the longer the warmup."
    expect(warmupTotalMin(RACE_WARMUP['5k'])).toBeGreaterThan(warmupTotalMin(RACE_WARMUP['10k']));
    expect(warmupTotalMin(RACE_WARMUP['10k'])).toBeGreaterThan(warmupTotalMin(RACE_WARMUP.hm));
    expect(warmupTotalMin(RACE_WARMUP.hm)).toBeGreaterThan(warmupTotalMin(RACE_WARMUP.m));
  });

  it('every prescribed protocol sits inside its §12.1 total-time band', () => {
    for (const cat of RACE_DISTANCE_CATEGORIES) {
      const wu = RACE_WARMUP[cat];
      const total = warmupTotalMin(wu);
      expect(total, `${cat}: §12.1 band is ${wu.totalMinBand[0]}-${wu.totalMinBand[1]} min`)
        .toBeGreaterThanOrEqual(wu.totalMinBand[0]);
      expect(total).toBeLessThanOrEqual(wu.totalMinBand[1]);
      expect(wu.strides).toBeGreaterThanOrEqual(wu.stridesBand[0]);
      expect(wu.strides).toBeLessThanOrEqual(wu.stridesBand[1]);
    }
  });

  it('a marathoner is not started 45 minutes before the gun', () => {
    // The shipped defect: one 45-min/1mi/drills/3-4-strides block for every
    // distance, with the comment naming the half it came from. Clock
    // position is corral logistics; the doctrine claim is about the WORK,
    // so compare each protocol's span (first step → corral).
    const span = (cat: RaceDistanceCategory) => {
      const w = planFor(cat).warmup;
      return w[0].minutesBeforeGun - w[w.length - 1].minutesBeforeGun;
    };
    expect(span('m')).toBeLessThan(span('hm'));
    expect(span('hm')).toBeLessThan(span('5k'));
    // And the marathoner's morning starts inside half an hour of the gun.
    expect(planFor('m').warmup[0].minutesBeforeGun).toBeLessThanOrEqual(30);
    expect(planFor('m').warmup[0].minutesBeforeGun).toBeLessThan(45);
  });
});
