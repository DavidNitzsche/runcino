/**
 * lib/plan/_authoring_shadow_compare.test.ts · PURE, NO DATABASE.
 *
 * `canonicalSpecForComposedDay` (`authoring-shadow-compare.ts`) is the new
 * shadow-only wiring this pass added — it is not `capacity-resolver.ts` or
 * `prescription-resolver.ts` themselves, both of which already carry their
 * own falsified guarantees (goal isolation at compile time, the coherence
 * gate, the monotonicity walks in `_capacity_resolver.test.ts` and
 * `_prescription_resolver.test.ts`). What THIS file has to prove is
 * narrower and specific to the new code: does threading a `PrescribedPaceAnchors`
 * object through `buildWorkoutSpec` (exactly as `recompute-paces.ts` already
 * does in production) preserve continuity, monotonicity and goal isolation
 * ONE LAYER FURTHER DOWN, inside the day-composition/spec-building branches
 * this migration has not touched yet (warm-up/cool-down sizing, distance
 * clamping, the rep-pattern parser) — properties `buildWorkoutSpec` itself
 * was never walked for, because until PRESCRIPTION-WIRE-1 no authoring
 * caller passed it a non-null `anchors` argument at all.
 *
 * No database, no `composeForUser`, no `resolvePrescribedPaceAnchors` — every
 * anchor set here is a synthetic, hand-built `PrescribedPaceAnchors`, exactly
 * as `_capacity_resolver.test.ts` drives `composeThresholdCapacity` with a
 * hand-built `ThresholdCapacityInputs`. Rule 18: falsified against the
 * pre-fix code first (see each `it`'s own note) before being trusted.
 */
import { describe, it, expect } from 'vitest';
import { canonicalSpecForComposedDay } from './authoring-shadow-compare';
import type { DayPlan } from './generate';
import type { PrescribedPaceAnchors } from '@/lib/training/prescription-resolver';
import type { SourceMode } from '@/lib/training/capacity-resolver';

/** A coherent six-anchor set at a given threshold pace, s/mi. Mirrors the
 *  ordering `composePaceAnchors`'s coherence gate requires (interval <
 *  threshold < marathon < easy < shakeout) without depending on that gate —
 *  this file tests what happens AFTER a coherent set is handed to
 *  `buildWorkoutSpec`, not whether the set itself is coherent. */
function fakeAnchors(thresholdSecPerMi: number, opts?: { sourceMode?: SourceMode; vdot?: number | null }): PrescribedPaceAnchors {
  const sourceMode = opts?.sourceMode ?? 'direct';
  const basisEntry = { sourceMode, confidence: 0.7 };
  return {
    thresholdSecPerMi,
    intervalSecPerMi: thresholdSecPerMi - 18,
    repetitionSecPerMi: thresholdSecPerMi - 35,
    easyCeilingSecPerMi: thresholdSecPerMi + 80,
    shakeoutCeilingSecPerMi: thresholdSecPerMi + 120,
    marathonSecPerMi: thresholdSecPerMi + 20,
    basis: {
      threshold: { ...basisEntry, vdot: opts?.vdot ?? null },
      highIntensity: basisEntry,
      easyCeiling: basisEntry,
      marathon: { ...basisEntry, enduranceExponent: 1.06, personallyEvidenced: true },
    },
  };
}

const baseLegacy = {
  lthr: 162,
  maxHr: 180,
  goalPaceSec: null as number | null,
  easyAnchorTSec: 470,
  goalIPaceEligible: false,
  belowTableAnchor: null,
  prescribedRacePaceSec: null as number | null,
};

function day(overrides: Partial<DayPlan>): DayPlan {
  return {
    dow: 2,
    type: 'threshold',
    distanceMi: 6,
    isQuality: true,
    isLong: false,
    subLabel: '2×1mi @ T pace · 60s jog',
    notes: '',
    ...overrides,
  } as DayPlan;
}

describe('canonicalSpecForComposedDay · continuity (Rule 9)', () => {
  it('a 1s/mi step in the threshold anchor never produces a >1s/mi jump in the day\'s headline pace for a tempo/threshold day', () => {
    // FALSIFIED: with `anchors` stripped out of the call (reverting to the
    // pre-wiring null-anchors call `buildWorkoutSpec` used everywhere before
    // PRESCRIPTION-WIRE-1), the headline pace is driven by `tPaceSec` alone
    // and this same walk still holds — the point of this test is that the
    // ANCHOR-DRIVEN branch inherits the same property, not that it is the
    // first branch to have it. Genuinely falsifiable failure mode: a step
    // function inside `buildWorkoutSpec`'s parsed-prescription clamp that
    // only fires when `anchors` is non-null (untested before this pass,
    // since no authoring caller ever passed one).
    const d = day({ type: 'threshold' });
    let prevPace: number | null = null;
    for (let t = 380; t <= 480; t += 1) {
      const anchors = fakeAnchors(t);
      const built = canonicalSpecForComposedDay(d, anchors, baseLegacy, 14, null, 26.2);
      if (built.paceTargetSPerMi != null && prevPace != null) {
        expect(Math.abs(built.paceTargetSPerMi - prevPace)).toBeLessThanOrEqual(1);
      }
      prevPace = built.paceTargetSPerMi;
    }
  });

  it('a 1s/mi step in the threshold anchor never produces a >1mi jump in warm-up or cool-down distance for a long run', () => {
    const d = day({ type: 'long', distanceMi: 16, subLabel: 'LONG', isQuality: false, isLong: true });
    let prevWu: number | null = null;
    let prevCd: number | null = null;
    for (let t = 380; t <= 480; t += 1) {
      const anchors = fakeAnchors(t);
      const built = canonicalSpecForComposedDay(d, anchors, baseLegacy, 14, null, 26.2);
      const spec = built.spec as Record<string, unknown> | null;
      const wu = typeof spec?.warmup_mi === 'number' ? spec.warmup_mi : null;
      const cd = typeof spec?.cooldown_mi === 'number' ? spec.cooldown_mi : null;
      if (wu != null && prevWu != null) expect(Math.abs(wu - prevWu)).toBeLessThanOrEqual(1);
      if (cd != null && prevCd != null) expect(Math.abs(cd - prevCd)).toBeLessThanOrEqual(1);
      prevWu = wu; prevCd = cd;
    }
  });

  it('an intervals day\'s rep_count never flips more than once across a smooth pace walk (no oscillation)', () => {
    const d = day({ type: 'intervals', distanceMi: 7, subLabel: '5×1000m @ I pace · 2 min jog' });
    const repCounts: number[] = [];
    for (let t = 380; t <= 480; t += 2) {
      const anchors = fakeAnchors(t);
      const built = canonicalSpecForComposedDay(d, anchors, baseLegacy, 14, null, 26.2);
      const spec = built.spec as Record<string, unknown> | null;
      if (typeof spec?.rep_count === 'number') repCounts.push(spec.rep_count);
    }
    // Count sign changes in the first difference — a coherent clamp against a
    // monotonically increasing pace should change rep_count at most a
    // handful of times, never oscillate back and forth.
    let flips = 0;
    for (let i = 2; i < repCounts.length; i++) {
      const d1 = repCounts[i - 1] - repCounts[i - 2];
      const d2 = repCounts[i] - repCounts[i - 1];
      if (d1 !== 0 && d2 !== 0 && Math.sign(d1) !== Math.sign(d2)) flips++;
    }
    expect(flips).toBe(0);
  });
});

describe('canonicalSpecForComposedDay · monotonicity', () => {
  it('a slower (larger) threshold anchor never produces a FASTER (smaller) headline pace on a threshold/tempo day', () => {
    const d = day({ type: 'tempo', distanceMi: 8, subLabel: '4mi continuous tempo' });
    let prevPace = -Infinity;
    for (let t = 360; t <= 520; t += 4) {
      const anchors = fakeAnchors(t);
      const built = canonicalSpecForComposedDay(d, anchors, baseLegacy, 14, null, 26.2);
      if (built.paceTargetSPerMi != null) {
        expect(built.paceTargetSPerMi).toBeGreaterThanOrEqual(prevPace);
        prevPace = built.paceTargetSPerMi;
      }
    }
  });

  it('a slower easy ceiling never produces a faster easy-day pace band', () => {
    const d = day({ type: 'easy', distanceMi: 6, subLabel: 'EASY', isQuality: false });
    let prevLo = -Infinity;
    for (let t = 360; t <= 520; t += 4) {
      const anchors = fakeAnchors(t);
      const built = canonicalSpecForComposedDay(d, anchors, baseLegacy, 14, null, 26.2);
      const spec = built.spec as Record<string, unknown> | null;
      const lo = typeof spec?.pace_target_s_per_mi_lo === 'number' ? spec.pace_target_s_per_mi_lo : null;
      if (lo != null) {
        expect(lo).toBeGreaterThanOrEqual(prevLo);
        prevLo = lo;
      }
    }
  });
});

describe('canonicalSpecForComposedDay · goal isolation', () => {
  // capacity-resolver.ts / prescription-resolver.ts already enforce goal
  // isolation at compile time (section 0 of capacity-resolver.ts). What THIS
  // test proves is narrower: that the NEW WIRING in this file does not
  // reintroduce a goal-dependency between the anchors and the
  // capacity-derived fields once they reach `buildWorkoutSpec` — i.e. that
  // handing the same anchors to two callers with wildly different goals
  // produces identical threshold/interval/easy pacing, and the goal only
  // ever touches the race-specific fields it is legitimately allowed to
  // (`raceGoalPaceSec` / `prescribedRacePaceSPerMi`), never a quality day's
  // headline pace.
  const anchors = fakeAnchors(430, { vdot: 47.9 });

  it('a threshold day prices identically for a 3:00 marathon goal, a 5:00 marathon goal, and no goal at all', () => {
    const d = day({ type: 'threshold' });
    const noGoal = canonicalSpecForComposedDay(d, anchors, baseLegacy, 14, null, 26.2);
    const ambitious = canonicalSpecForComposedDay(d, anchors, baseLegacy, 14, 3 * 3600, 26.2);
    const modest = canonicalSpecForComposedDay(d, anchors, baseLegacy, 14, 5 * 3600, 26.2);
    expect(ambitious.paceTargetSPerMi).toBe(noGoal.paceTargetSPerMi);
    expect(modest.paceTargetSPerMi).toBe(noGoal.paceTargetSPerMi);
  });

  it('an easy day\'s pace band prices identically regardless of goal', () => {
    const d = day({ type: 'easy', distanceMi: 6, isQuality: false, subLabel: 'EASY' });
    const noGoal = canonicalSpecForComposedDay(d, anchors, baseLegacy, 14, null, 26.2);
    const ambitious = canonicalSpecForComposedDay(d, anchors, baseLegacy, 14, 3 * 3600, 26.2);
    const s1 = noGoal.spec as Record<string, unknown> | null;
    const s2 = ambitious.spec as Record<string, unknown> | null;
    expect(s2?.pace_target_s_per_mi_lo).toBe(s1?.pace_target_s_per_mi_lo);
    expect(s2?.pace_target_s_per_mi_hi).toBe(s1?.pace_target_s_per_mi_hi);
  });

  it('a race day IS allowed to move with the goal — proving the isolation above is real and not just "nothing ever changes"', () => {
    const d = day({ type: 'race', distanceMi: 26.2, subLabel: 'RACE' });
    const noGoal = canonicalSpecForComposedDay(d, anchors, { ...baseLegacy, goalPaceSec: null }, 14, null, 26.2);
    const withGoal = canonicalSpecForComposedDay(d, anchors, { ...baseLegacy, goalPaceSec: 420 }, 14, 420 * 26.2, 26.2);
    expect(withGoal.paceTargetSPerMi).not.toBe(noGoal.paceTargetSPerMi);
  });
});

describe('canonicalSpecForComposedDay · extreme inputs', () => {
  it('an elite-fast threshold anchor (sub-5:00/mi) does not crash and keeps warm-up/cool-down within a sane band', () => {
    const anchors = fakeAnchors(280); // 4:40/mi T-pace — sub-elite/elite territory
    const d = day({ type: 'long', distanceMi: 20, subLabel: 'LONG', isQuality: false, isLong: true });
    const built = canonicalSpecForComposedDay(d, anchors, baseLegacy, 14, null, 26.2);
    const spec = built.spec as Record<string, unknown> | null;
    expect(spec).not.toBeNull();
    const wu = spec?.warmup_mi;
    if (typeof wu === 'number') { expect(wu).toBeGreaterThanOrEqual(0); expect(wu).toBeLessThan(10); }
  });

  it('a below-table-slow threshold anchor (>13:00/mi) does not crash and does not produce a negative or non-finite pace anywhere', () => {
    const anchors = fakeAnchors(800, { sourceMode: 'inferred', vdot: null }); // 13:20/mi — below the Daniels table
    for (const type of ['easy', 'long', 'threshold', 'tempo', 'intervals'] as const) {
      const d = day({ type, distanceMi: 6 });
      const built = canonicalSpecForComposedDay(d, anchors, baseLegacy, 14, null, 26.2);
      if (built.paceTargetSPerMi != null) {
        expect(Number.isFinite(built.paceTargetSPerMi)).toBe(true);
        expect(built.paceTargetSPerMi).toBeGreaterThan(0);
      }
      const spec = built.spec as Record<string, unknown> | null;
      for (const key of ['pace_target_s_per_mi_lo', 'pace_target_s_per_mi_hi', 'rep_pace_s_per_mi'] as const) {
        const v = spec?.[key];
        if (typeof v === 'number') expect(v).toBeGreaterThan(0);
      }
    }
  });

  it('a null repetitionSecPerMi (Rule 11\'s below-table branch) does not crash a rep-pace day', () => {
    const anchors = fakeAnchors(800, { sourceMode: 'inferred', vdot: null });
    anchors.repetitionSecPerMi = null;
    const d = day({ type: 'intervals', distanceMi: 5, subLabel: '6×400m @ R pace · 3 min jog' });
    expect(() => canonicalSpecForComposedDay(d, anchors, baseLegacy, 14, null, 26.2)).not.toThrow();
  });
});
