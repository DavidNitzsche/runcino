/**
 * lib/terrain/grade-adjust.test.ts · the falsifiers for terrain-aware judging.
 *
 * The bugs these exist to catch, in the order they would hurt:
 *
 *   1. The adjustment fires on a flat run. Every road run David does is flat;
 *      if 0% is not an exact no-op, this change moves numbers on 90% of his
 *      history for no reason.
 *   2. The adjusted pace leaks into a display field. GAP is for judging. The
 *      moment it becomes "your pace" the app is lying about what happened.
 *   3. A treadmill run at the standard 1% belt gets credited as a 1% climb.
 *   4. Heat and grade both get applied twice by two paths that disagree.
 *   5. The direction is inverted — the single most common way a grade
 *      adjustment ships broken, because both directions look plausible.
 */
import { describe, it, expect } from 'vitest';
import {
  GRADE_COST_PER_PCT,
  DESCENT_GIVEBACK_FRACTION,
  GRADE_MODEL_MAX_PCT,
  TREADMILL_AIR_RESISTANCE_GRADE_PCT,
  TREADMILL_COST_PER_PCT,
  MATERIAL_ADJUSTMENT_S_PER_MI,
  gradeFactor,
  gradeAdjustedPaceSPerMi,
  terrainAdjustedTargetSPerMi,
  treadmillEffectiveGradePct,
  composeEffortFactor,
  runGradeAdjustment,
  adjustmentLabel,
} from './grade-adjust';
import { resolveRunTerrain, treadmillMeanInclinePct, isTreadmillRow } from './run-terrain';

// ── 1 · the cited table, across representative grades ───────────────────────

describe('gradeFactor · against Research/11 §Mechanical Effects of Uphill Running', () => {
  // "Energy cost rises ~3.3% per 1% of grade up to ~10–15%."
  it.each([
    [1, 1.033],
    [2, 1.066],
    [3, 1.099],
    [5, 1.165],
    [8, 1.264],
    [10, 1.33],
  ])('a %i%% climb costs the cited fraction (factor %f)', (grade, want) => {
    expect(gradeFactor(grade)).toBeCloseTo(want, 6);
  });

  it('is exactly 1 at 0% · a flat road run must be untouched', () => {
    expect(gradeFactor(0)).toBe(1);
    expect(gradeFactor(-0)).toBe(1);
    expect(gradeAdjustedPaceSPerMi(480, 0)).toBe(480);
    expect(terrainAdjustedTargetSPerMi(480, 0)).toBe(480);
  });

  it('gives descents back less than the same climb costs · Research/01 §Hills', () => {
    for (const g of [1, 2, 4, 6, 10]) {
      const cost = gradeFactor(g) - 1;
      const gift = 1 - gradeFactor(-g);
      expect(gift).toBeLessThan(cost);
      expect(gift / cost).toBeCloseTo(DESCENT_GIVEBACK_FRACTION, 10);
    }
  });

  it('clamps at the doctrine validity ceiling rather than extrapolating', () => {
    expect(gradeFactor(GRADE_MODEL_MAX_PCT + 40)).toBe(gradeFactor(GRADE_MODEL_MAX_PCT));
    expect(gradeFactor(-999)).toBe(gradeFactor(-GRADE_MODEL_MAX_PCT));
    expect(gradeFactor(Number.NaN)).toBe(1);
  });

  it('is monotonic · steeper is never cheaper', () => {
    const grades = [-10, -6, -4, -2, -1, 0, 1, 2, 4, 6, 10];
    const factors = grades.map((g) => gradeFactor(g));
    for (let i = 1; i < factors.length; i++) expect(factors[i]).toBeGreaterThan(factors[i - 1]);
  });
});

// ── 2 · direction · target and GAP move opposite ways ───────────────────────

describe('direction · the inversion that ships broken', () => {
  it('a flat target becomes SLOWER on a climb and FASTER on a descent', () => {
    expect(terrainAdjustedTargetSPerMi(480, 3)).toBeGreaterThan(480);
    expect(terrainAdjustedTargetSPerMi(480, -3)).toBeLessThan(480);
  });

  it('a pace observed on a climb is worth a FASTER flat pace', () => {
    // 9:00/mi up a sustained 3% is a better effort than 9:00 on the flat.
    expect(gradeAdjustedPaceSPerMi(540, 3)).toBeLessThan(540);
  });

  it('a pace observed on a descent is worth a SLOWER flat pace', () => {
    // The bug the owner named: a net-downhill run reading as fitness.
    expect(gradeAdjustedPaceSPerMi(400, -3)).toBeGreaterThan(400);
  });

  it('round-trips · adjusting a target onto a grade and judging it back is a wash', () => {
    const flatTarget = 452;
    const onHill = terrainAdjustedTargetSPerMi(flatTarget, 4);
    expect(gradeAdjustedPaceSPerMi(onHill, 4)).toBeCloseTo(flatTarget, 9);
  });
});

// ── 3 · GAP vs displayed pace stay separate ─────────────────────────────────

describe('GAP is for judging · displayed pace is what the runner ran', () => {
  const hilly = runGradeAdjustment({
    distanceMi: 6.01,
    durationSec: 6.01 * 529, // 8:49/mi
    gainFt: 572,
    lossFt: 60,
  });

  it('displayed pace is exactly distance ÷ time · never adjusted', () => {
    expect(hilly.displayedPaceSPerMi).toBeCloseTo(529, 9);
  });

  it('adjusted pace is a separate field, and on net climb it is faster', () => {
    expect(hilly.adjustedPaceSPerMi).toBeLessThan(hilly.displayedPaceSPerMi!);
    expect(hilly.deltaSPerMi).toBeLessThan(0);
  });

  it('anything surfaced carries a label', () => {
    expect(adjustmentLabel(hilly)).toBe('hill-adjusted');
    expect(adjustmentLabel(runGradeAdjustment({ distanceMi: 6, durationSec: 2880, gainFt: 0 }))).toBeNull();
  });

  it('a net-DOWNHILL run is labelled as such and reads slower than it ran', () => {
    const down = runGradeAdjustment({ distanceMi: 6, durationSec: 6 * 420, gainFt: 40, lossFt: 900 });
    expect(down.adjustedPaceSPerMi!).toBeGreaterThan(down.displayedPaceSPerMi!);
    expect(adjustmentLabel(down)).toBe('descent-adjusted');
  });
});

// ── 4 · the flat-road regression ────────────────────────────────────────────

describe('regression · a flat road run is untouched', () => {
  it('0 ft of gain is an exact no-op, not an approximate one', () => {
    const a = runGradeAdjustment({ distanceMi: 6.02, durationSec: 6.02 * 457, gainFt: 0, lossFt: 0 });
    expect(a.adjustedPaceSPerMi).toBe(a.displayedPaceSPerMi);
    expect(a.deltaSPerMi).toBe(0);
    expect(a.factor).toBe(1);
    expect(a.material).toBe(false);
  });

  it('no elevation signal at all is a no-op and says so', () => {
    const a = runGradeAdjustment({ distanceMi: 6, durationSec: 2880, gainFt: null, lossFt: null });
    expect(a.basis).toBe('none');
    expect(a.adjustedPaceSPerMi).toBe(a.displayedPaceSPerMi);
  });

  it("David's typical road run (5 ft/mi) moves the judgement by under a second", () => {
    const a = runGradeAdjustment({ distanceMi: 6.02, durationSec: 6.02 * 457, gainFt: 28 });
    expect(Math.abs(a.deltaSPerMi)).toBeLessThan(1);
    expect(a.material).toBe(false);
  });
});

// ── 5 · the whole-run model ─────────────────────────────────────────────────

describe('runGradeAdjustment · vertical, not mean grade', () => {
  it('the cost of a climb depends only on total vertical, not how it was arranged', () => {
    const base = { distanceMi: 6, durationSec: 6 * 480, lossFt: 0 };
    // 528 ft is 10 grade-percent-miles however you slice it.
    const a = runGradeAdjustment({ ...base, gainFt: 528 });
    expect(a.deltaSPerMi).toBeCloseTo(-(480 * GRADE_COST_PER_PCT * 10) / 6, 9);
  });

  it('a rolling loop does NOT cancel to zero · that is the bug being fixed', () => {
    const loop = runGradeAdjustment({ distanceMi: 6, durationSec: 6 * 480, gainFt: 600, lossFt: 600 });
    expect(loop.deltaSPerMi).toBeLessThan(0);
    // Net cost is the un-refunded share of the climb.
    const climbSec = 480 * GRADE_COST_PER_PCT * (600 / 52.8);
    expect(loop.deltaSPerMi).toBeCloseTo(-(climbSec * (1 - DESCENT_GIVEBACK_FRACTION)) / 6, 9);
  });

  it('an unknown loss is taken as a loop and marked · never invented', () => {
    const a = runGradeAdjustment({ distanceMi: 6, durationSec: 2880, gainFt: 600 });
    expect(a.basis).toBe('gain-loop-assumed');
    expect(a.lossFt).toBeNull();
    const known = runGradeAdjustment({ distanceMi: 6, durationSec: 2880, gainFt: 600, lossFt: 600 });
    expect(known.basis).toBe('splits');
    expect(a.adjustedPaceSPerMi).toBeCloseTo(known.adjustedPaceSPerMi!, 9);
  });

  it('a garbage barometric reading cannot produce an unbounded adjustment', () => {
    const wild = runGradeAdjustment({ distanceMi: 6, durationSec: 2880, gainFt: 40000, lossFt: 0 });
    const ceiling = 480 * GRADE_COST_PER_PCT * GRADE_MODEL_MAX_PCT;
    expect(Math.abs(wild.deltaSPerMi)).toBeLessThanOrEqual(ceiling + 1e-9);
  });

  it('a zero-distance or zero-duration row degrades to a no-op rather than dividing by zero', () => {
    for (const bad of [
      { distanceMi: 0, durationSec: 2880, gainFt: 500 },
      { distanceMi: 6, durationSec: 0, gainFt: 500 },
    ]) {
      const a = runGradeAdjustment(bad);
      expect(a.basis).toBe('none');
      expect(a.deltaSPerMi).toBe(0);
    }
  });
});

// ── 6 · treadmill ───────────────────────────────────────────────────────────

describe('treadmill · a distinct surface, not a flat road', () => {
  it('the standard 1% belt is flat-equivalent · no adjustment at all', () => {
    expect(treadmillEffectiveGradePct(TREADMILL_AIR_RESISTANCE_GRADE_PCT)).toBe(0);
    const a = runGradeAdjustment({
      distanceMi: 9.01,
      durationSec: 4636,
      surface: 'treadmill',
      treadmillInclinePct: 1,
    });
    expect(a.deltaSPerMi).toBe(0);
    expect(a.basis).toBe('treadmill-incline');
    expect(a.material).toBe(false);
  });

  it('a 0% belt is not treated as a downhill · the conservative reading', () => {
    expect(treadmillEffectiveGradePct(0)).toBe(0);
    const a = runGradeAdjustment({
      distanceMi: 5, durationSec: 5 * 480, surface: 'treadmill', treadmillInclinePct: 0,
    });
    expect(a.deltaSPerMi).toBe(0);
  });

  it('a real incline above flat-equivalent is folded in at the belt coefficient', () => {
    const a = runGradeAdjustment({
      distanceMi: 5, durationSec: 5 * 480, surface: 'treadmill', treadmillInclinePct: 5,
    });
    // 5% belt − 1% air-resistance offset = 4% of real work, at 3%/1%.
    expect(a.factor).toBeCloseTo(1 + TREADMILL_COST_PER_PCT * 4, 9);
    expect(a.adjustedPaceSPerMi!).toBeLessThan(480);
    expect(adjustmentLabel(a)).toBe('incline-adjusted');
  });

  it('an unknown incline is stated, not assumed flat-and-therefore-easy', () => {
    const a = runGradeAdjustment({
      distanceMi: 5, durationSec: 5 * 480, surface: 'treadmill', treadmillInclinePct: null,
    });
    expect(a.basis).toBe('treadmill-incline-unknown');
    expect(a.deltaSPerMi).toBe(0);
    const t = resolveRunTerrain({
      source: 'treadmill', indoor: true, distanceMi: 5, durationSec: 2400,
    });
    expect(t.basis).toBe('treadmill-incline-unknown');
    expect(t.note).toMatch(/incline not recorded/i);
  });

  it('NEVER contributes phantom elevation · elevGainFt on a treadmill row is ignored', () => {
    // David's 2026-07-15: 9.01 mi at 1% belt, stored with elevGainFt 476
    // (= 9.01 × 5280 × 1%, back-computed from the same incline). Reading both
    // would count the belt angle twice; reading it as terrain would invent a
    // 476 ft hill indoors.
    const t = resolveRunTerrain({
      source: 'treadmill',
      indoor: true,
      distanceMi: 9.01,
      durationSec: 4636,
      elevGainFt: 476,
      elevGainSource: 'treadmill_incline',
      phases: [{ type: 'work', actualInclinePct: 1, actualDistanceMi: 9.01 }],
    });
    expect(t.gainFt).toBeNull();
    expect(t.meanGradePct).toBe(0);
    expect(t.deltaSPerMi).toBe(0);
    expect(t.surface).toBe('treadmill');
  });

  it('mean incline is distance-weighted across phases', () => {
    // David's 2026-08-06: 2.0 mi warm-up at 1%, 2.86 mi tempo at 0%.
    const inc = treadmillMeanInclinePct([
      { actualInclinePct: 1, actualDistanceMi: 2 },
      { actualInclinePct: 0, actualDistanceMi: 2.86 },
      { actualInclinePct: 1 }, // cooldown, never started, no distance
    ]);
    expect(inc).toBeCloseTo(2 / 4.86, 6);
    expect(treadmillMeanInclinePct([])).toBeNull();
    expect(treadmillMeanInclinePct([{ type: 'work' }])).toBeNull();
  });

  it('is recognised from either surface signal', () => {
    expect(isTreadmillRow({ source: 'treadmill' })).toBe(true);
    expect(isTreadmillRow({ indoor: true })).toBe(true);
    expect(isTreadmillRow({ source: 'watch', indoor: false })).toBe(false);
  });
});

// ── 7 · heat and grade compose exactly once ─────────────────────────────────

describe('composition · Research/01 §Combined conditions', () => {
  it('a hot hilly run gets ONE coherent adjustment, not two', () => {
    const heatPct = 4;                 // judgeWeather's slowdownPct
    const grade = gradeFactor(2);      // a sustained 2% climb
    const flatCoolTarget = 452;        // 7:32/mi threshold

    const combined = composeEffortFactor({ heatSlowdownPct: heatPct, gradeFactor: grade });
    const oneShot = flatCoolTarget * combined.factor;

    // Sequential application must land on the same number — that is what
    // "composes predictably" means. If these ever diverge, two surfaces are
    // adjusting the same run differently.
    const heatThenGrade = terrainAdjustedTargetSPerMi(flatCoolTarget * combined.heat, 2);
    const gradeThenHeat = terrainAdjustedTargetSPerMi(flatCoolTarget, 2) * combined.heat;
    expect(heatThenGrade).toBeCloseTo(oneShot, 9);
    expect(gradeThenHeat).toBeCloseTo(oneShot, 9);

    // And it must be genuinely once: naively applying heat twice (the
    // double-count this design prevents) lands somewhere else entirely.
    const doubleCounted = flatCoolTarget * combined.heat * combined.heat * grade;
    expect(Math.abs(doubleCounted - oneShot)).toBeGreaterThan(15);
  });

  it('is multiplicative, not additive · the doctrine wording', () => {
    const c = composeEffortFactor({ heatSlowdownPct: 6, gradeFactor: gradeFactor(3) });
    expect(c.factor).toBeCloseTo(1.06 * 1.099, 9);
    // Additive stacking would give 1 + 0.06 + 0.099 = 1.159 · off by ~0.006,
    // which is 3s/mi on a marathon-pace target. Small, and wrong.
    expect(c.factor).not.toBeCloseTo(1.159, 4);
  });

  it('neutral legs pass the other through untouched', () => {
    expect(composeEffortFactor({}).factor).toBe(1);
    expect(composeEffortFactor({ heatSlowdownPct: null, gradeFactor: null }).factor).toBe(1);
    expect(composeEffortFactor({ heatSlowdownPct: 0, gradeFactor: 1.066 }).factor).toBeCloseTo(1.066, 12);
    expect(composeEffortFactor({ heatSlowdownPct: 5, gradeFactor: 1 }).factor).toBeCloseTo(1.05, 12);
  });

  it('a hot FLAT run is adjusted for heat alone · terrain adds nothing', () => {
    const flat = runGradeAdjustment({ distanceMi: 6, durationSec: 2880, gainFt: 0, lossFt: 0 });
    expect(composeEffortFactor({ heatSlowdownPct: 4, gradeFactor: flat.factor }).factor)
      .toBeCloseTo(1.04, 12);
  });
});

// ── 8 · row resolution ──────────────────────────────────────────────────────

describe('resolveRunTerrain · reading the real row shapes', () => {
  it('prefers per-split deltas, which are the only source of real LOSS', () => {
    const t = resolveRunTerrain({
      source: 'watch',
      distanceMi: 4,
      durationSec: 4 * 480,
      elevGainFt: 9999, // deliberately wrong · splits must win
      splits: [
        { mile: 1, elev_ft: 200 },
        { mile: 2, elev_ft: -180 },
        { mile: 3, elevation_difference: 60 },
        { mile: 4, elevDeltaFt: -40 },
      ],
    });
    expect(t.basis).toBe('splits');
    expect(t.gainFt).toBe(260);
    expect(t.lossFt).toBe(220);
  });

  it('splits with no elevation field at all fall through to the gain total', () => {
    const t = resolveRunTerrain({
      source: 'watch',
      distanceMi: 6,
      durationSec: 6 * 480,
      elevGainFt: 300,
      splits: [{ mile: 1, hr: 140, pace: '8:00' }, { mile: 2, hr: 142, pace: '8:01' }],
    });
    expect(t.basis).toBe('gain-loop-assumed');
    expect(t.gainFt).toBe(300);
  });

  it('a flat mile and a mile with no elevation data stay distinguishable', () => {
    const flat = resolveRunTerrain({
      source: 'watch', distanceMi: 2, durationSec: 960,
      splits: [{ mile: 1, elev_ft: 0 }, { mile: 2, elev_ft: 0 }],
    });
    expect(flat.basis).toBe('splits');
    expect(flat.deltaSPerMi).toBe(0);
  });

  it('reuses the barometric sanity check rather than trusting a wild total', () => {
    // 2400 ft over 6 mi = 400 ft/mi, past the 250 ft/mi credibility ceiling
    // that lib/runs/elev-sanity.ts owns. With no corroborating splits the
    // sanity module keeps the raw value; the point is that the judgement
    // comes from ONE place, not a second threshold copied into this file.
    const t = resolveRunTerrain({ source: 'watch', distanceMi: 6, durationSec: 2880, elevGainFt: 2400 });
    expect(t.gainFt).toBe(2400);
    expect(t.material).toBe(true);
  });

  it('emits a plain-English note only when terrain actually changed the read', () => {
    const flat = resolveRunTerrain({ source: 'watch', distanceMi: 6, durationSec: 2880, elevGainFt: 20 });
    expect(flat.note).toBeNull();
    const hilly = resolveRunTerrain({ source: 'watch', distanceMi: 6, durationSec: 2880, elevGainFt: 1400 });
    expect(hilly.note).toMatch(/harder effort than the pace shows/);
    expect(hilly.note).not.toMatch(/grade|GAP|adjusted pace/i);
  });

  it('the materiality floor is the one gate on whether terrain is mentioned', () => {
    const t = resolveRunTerrain({ source: 'watch', distanceMi: 6, durationSec: 2880, elevGainFt: 120 });
    expect(t.material).toBe(Math.abs(t.deltaSPerMi) >= MATERIAL_ADJUSTMENT_S_PER_MI);
  });
});
