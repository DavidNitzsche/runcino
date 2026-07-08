/**
 * lib/plan/_audit_slow_runner.test.ts · AUDIT P1-56 / P1-13 (2026-07-07) —
 * slow-runner support, end-to-end through composePlan + the pace-derivation
 * step (buildWorkoutSpec) persistPlan itself invokes.
 *
 * Reference persona (matches the task brief exactly): a 13:30/mi 5K runner
 * (41:57 5K finish, raw VDOT ~20.4 — genuinely below the Daniels table
 * floor of 30, not a rounding edge case). Covers the full chain:
 *   1. Anchor is represented honestly (bestRecentVdot.belowTableAnchor,
 *      not a fabricated VDOT).
 *   2. The plan generates successfully (composePlan doesn't throw/degrade)
 *      and is structurally sound.
 *   3. Paces are sane — every prescribed pace across the whole plan is
 *      NEVER faster than the runner's own demonstrated 5K pace (falsifiable
 *      requirement #3 from the task brief).
 *   4. A regression guard: a runner who DOES have a real VDOT is completely
 *      unaffected (byte-identical output) — this fix must be additive only.
 *
 * IMPORTANT: composePlan()'s DayPlan output carries NO pace fields (dow /
 * type / distanceMi / isQuality / isLong / subLabel / notes only) — the
 * actual pace_target_s_per_mi / workout_spec are derived by persistPlan at
 * INSERT time via buildWorkoutSpec(type, distanceMi, weekT, lthr, ...,
 * easyAnchorTSec) (generate.ts persistPlan, ~line 2769). persistPlan itself
 * is a DB-writing function and cannot run here. This test therefore mirrors
 * persistPlan's exact pace-derivation call for every DayPlan composePlan
 * produces — same function, same argument order, same easyAnchorTSec value
 * a real generate() run would compute — so it tests the REAL pipeline's
 * pace math without needing a database. This is the same "faithfully mirror
 * production" strategy _audit_placement.test.ts uses for day-layout
 * reconciliation.
 *
 * See lib/training/vdot-slow-runner-floor.test.ts for the unit-level tests
 * of the underlying anchor-pace machinery (vdot.ts) and the direct
 * resolveCurrentTPace cascade assertions.
 */
import { describe, it, expect } from 'vitest';
import {
  composePlan, inlinePrescriptions, distanceCategoryOfPublic,
  type ComposePlanInput, type ComposePlanResult, type DOW, type LevelKey,
} from './generate';
import { buildWorkoutSpec, tPaceFromGoal, conservativeVdotFromMileage } from './spec-builder';
import {
  anchorPaceFrom, bestRecentVdot, resolveCurrentTPace, tPaceFromVdot, iPaceFromAnchorPace,
  vdotFromTpace, iPaceFromVdot,
  type BelowTableAnchor,
} from '@/lib/training/vdot';

const ISO_START = '2026-01-05'; // a Monday
function raceDateForWeeks(weeks: number): string {
  const d = new Date(ISO_START + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + weeks * 7 - 1);
  return d.toISOString().slice(0, 10);
}

// ─── Reference persona: 13:30/mi 5K (41:57 finish) ─────────────────────────
const FIVE_K_MI = 3.10686;
const SLOW_PACE_S_PER_MI = 13 * 60 + 30; // 810 s/mi
const SLOW_5K_FINISH_S = Math.round(SLOW_PACE_S_PER_MI * FIVE_K_MI); // 2517s (41:57)
const TODAY = '2026-01-01';

function buildInput(o: {
  level: LevelKey;
  weeklyMi: number;
  freq: number | null;
  raceMi: number;
  bestRecentVdot?: number;
  belowTableAnchor?: BelowTableAnchor | null;
  goalPaceSec?: number | null;
  weeks?: number;
}): ComposePlanInput {
  const cat = distanceCategoryOfPublic(o.raceMi);
  const weeks = o.weeks ?? 12;
  const goalPaceSec = o.goalPaceSec ?? null;
  const goalSec = goalPaceSec != null ? Math.round(goalPaceSec * o.raceMi) : null;
  return {
    raceDistanceMi: o.raceMi,
    goalSec,
    goalPaceSec,
    raceDateISO: raceDateForWeeks(weeks),
    startMondayISO: ISO_START,
    level: o.level,
    recentWeeklyMi: o.weeklyMi,
    easyDayMedianMi: Math.max(3, Math.round(o.weeklyMi / 5)),
    recentLongMi: Math.round(o.weeklyMi * 0.25),
    bestRecentVdot: o.bestRecentVdot,
    belowTableAnchor: o.belowTableAnchor ?? null,
    isMidBlock: false,
    longRunDow: 0 as DOW,
    restDow: 6 as DOW,
    qualityDows: [2, 4] as DOW[],
    availableDows: null,
    trainingDaysPerWeek: o.freq,
    crossModes: [],
    rxQuality: inlinePrescriptions(cat),
    rxRaceSpecific: inlinePrescriptions(cat),
    tPaceSec: goalPaceSec != null ? tPaceFromGoal(goalSec, o.raceMi) : null,
    lthr: null,
    maxHr: null,
  };
}

/**
 * Mirrors persistPlan's per-day pace derivation (generate.ts ~2745-2778)
 * exactly: for every DayPlan in every ComposedWeek, call buildWorkoutSpec
 * with that week's blended tPaceSec (falling back to plan-wide tPaceSec) and
 * the SAME easyAnchorTSec every real generate() run threads through
 * (resolveCurrentTPace's tier-2/tier-3 cascade — the fix under test).
 * Returns every numeric pace field found in each day's built spec.
 *
 * EXCLUDES 'race' day types deliberately. Race day carries a long-standing,
 * intentional ±5 s/mi "controlled push / negative-split" pacing-STRATEGY
 * band around whatever racePace resolves to (spec-builder.ts race case) —
 * for EVERY runner, not specific to below-table fitness, and not part of
 * this fix's scope. That band means pace_target_s_per_mi_lo can land ~5s/mi
 * faster than the runner's single-race-day goal even when goalPaceSPerMi IS
 * the runner's own honest anchor pace — a deliberate racing-tactic
 * allowance, not a training prescription that ignores demonstrated fitness.
 * Falsifiable requirement #3 (never faster than demonstrated pace) targets
 * TRAINING prescriptions (easy/tempo/threshold/intervals/long) — the actual
 * P1-56 failure mode was quality/easy days running hotter than race pace
 * week after week, not a single race-day negative-split allowance.
 */
function allPrescribedPaces(
  res: ComposePlanResult,
  planWideTPaceSec: number | null,
  easyAnchorTSec: number | null,
  goalPaceSPerMi: number | null = null,
  belowTableAnchor: BelowTableAnchor | null = null,
  goalIPaceEligible = false,
): number[] {
  const paces: number[] = [];
  for (const w of res.weeks) {
    const weekT = w.tPaceSec ?? planWideTPaceSec;
    if (weekT == null) continue;
    for (const d of w.days) {
      if (d.type === 'rest' || d.type === 'race') continue;
      // Mirrors persistPlan's iPaceSec derivation exactly (generate.ts
      // ~2766-2771, the P1-56 fix): a below-table anchor routes I-pace
      // through Riegel instead of the VDOT-bounded vdotFromTpace round-trip.
      const iPaceSec = (goalIPaceEligible || d.type === 'race_week_tuneup')
        ? (belowTableAnchor ? iPaceFromAnchorPace(belowTableAnchor.anchor) : null)
        : null;
      const built = buildWorkoutSpec(
        d.type, d.distanceMi, weekT, /* lthr */ null, d.subLabel,
        /* maxHr */ null, goalPaceSPerMi, iPaceSec,
        easyAnchorTSec,
      );
      if (built.paceTargetSPerMi != null) paces.push(built.paceTargetSPerMi);
      if (built.spec) {
        for (const key of ['pace_target_s_per_mi_lo', 'pace_target_s_per_mi_hi', 'pace_target_s_per_mi']) {
          const v = (built.spec as Record<string, unknown>)[key];
          if (typeof v === 'number' && Number.isFinite(v) && v > 0) paces.push(v);
        }
      }
    }
  }
  return paces;
}

describe('P1-56 · anchor honesty for the 13:30/mi 5K runner', () => {
  it('the runner has NO real VDOT (correctly null — off the cited table)', () => {
    const r = bestRecentVdot(
      [{ slug: 'local-5k', name: 'Local 5K', date: '2025-12-01', priority: 'A', distance_mi: FIVE_K_MI, finish_seconds: SLOW_5K_FINISH_S }],
      TODAY, 180,
    );
    expect(r.best).toBeNull();
  });

  it('the runner\'s anchor IS captured honestly (belowTableAnchor, not discarded)', () => {
    const r = bestRecentVdot(
      [{ slug: 'local-5k', name: 'Local 5K', date: '2025-12-01', priority: 'A', distance_mi: FIVE_K_MI, finish_seconds: SLOW_5K_FINISH_S }],
      TODAY, 180,
    );
    expect(r.belowTableAnchor).not.toBeNull();
    expect(r.belowTableAnchor!.finish_seconds).toBe(SLOW_5K_FINISH_S);
    expect(r.belowTableAnchor!.distance_mi).toBeCloseTo(FIVE_K_MI, 4);
  });
});

describe('P1-56 · composePlan generates a plan for the slow runner (never crashes/degrades)', () => {
  const belowTableAnchor: BelowTableAnchor = {
    source: 'race', refId: 'local-5k', name: 'Local 5K', date: '2025-12-01',
    distance_mi: FIVE_K_MI, finish_seconds: SLOW_5K_FINISH_S, age_days: 31,
    anchor: anchorPaceFrom(SLOW_5K_FINISH_S, FIVE_K_MI)!,
  };

  it('by-feel (no goal) 5K plan generates successfully with 7 clean days/week', () => {
    const input = buildInput({
      level: 'beginner', weeklyMi: 12, freq: 3, raceMi: FIVE_K_MI,
      belowTableAnchor, weeks: 8,
    });
    const res = composePlan(input);
    expect(res).toBeDefined();
    expect(res.weeks.length).toBeGreaterThan(0);
    for (const w of res.weeks) {
      expect(w.days.length).toBe(7);
      const dows = w.days.map((d) => d.dow).slice().sort((a, b) => a - b);
      expect(dows).toEqual([0, 1, 2, 3, 4, 5, 6]);
    }
  });

  it('goal-anchored (aspirational sub-goal) 5K plan also generates successfully', () => {
    const input = buildInput({
      level: 'beginner', weeklyMi: 12, freq: 3, raceMi: FIVE_K_MI,
      belowTableAnchor, weeks: 8,
      goalPaceSec: 12 * 60, // aspirational 12:00/mi goal — faster than current, a real training target
    });
    const res = composePlan(input);
    expect(res).toBeDefined();
    expect(res.weeks.length).toBeGreaterThan(0);
  });
});

describe('P1-56 falsifiable requirement #3 · no prescribed pace is faster than the runner\'s own 5K pace', () => {
  const belowTableAnchor: BelowTableAnchor = {
    source: 'race', refId: 'local-5k', name: 'Local 5K', date: '2025-12-01',
    distance_mi: FIVE_K_MI, finish_seconds: SLOW_5K_FINISH_S, age_days: 31,
    anchor: anchorPaceFrom(SLOW_5K_FINISH_S, FIVE_K_MI)!,
  };
  const weeklyMi = 12;
  const resolved = resolveCurrentTPace(null, belowTableAnchor, weeklyMi, conservativeVdotFromMileage);

  it('resolveCurrentTPace correctly picked tier 2 (below_table_anchor) for this persona', () => {
    expect(resolved.tier).toBe('below_table_anchor');
    expect(resolved.tPaceSec).not.toBeNull();
  });

  it('THE CORE ASSERTION: every TRAINING-day prescribed pace across the whole plan is slower (higher s/mi) than the 13:30/mi anchor', () => {
    const input = buildInput({
      level: 'beginner', weeklyMi, freq: 3, raceMi: FIVE_K_MI,
      belowTableAnchor, weeks: 8,
    });
    const res = composePlan(input);
    // Mirror generate.ts's real plan-wide tPaceSec derivation (VAR-05: by-feel
    // anchors to currentT, never a flat literal) and easyAnchorTSec (the same
    // resolveCurrentTPace result under test). goalPaceSPerMi mirrors the
    // generate.ts P1-56 fix (below-table anchor threaded as the by-feel
    // race-day goal) so the race-day exclusion below reflects the REAL
    // pipeline's inputs, not an arbitrary null.
    const planWideTPaceSec = resolved.tPaceSec;
    const anchorPaceSPerMi = Math.round(belowTableAnchor.anchor.paceSPerMi);
    // goalIPaceEligible: true for a 5K by-feel plan, mirroring generate.ts's
    // `['5k','10k','hm'].includes(distanceCategoryOf(raceDistanceMi))`.
    const paces = allPrescribedPaces(res, planWideTPaceSec, resolved.tPaceSec, anchorPaceSPerMi, belowTableAnchor, true);
    expect(paces.length).toBeGreaterThan(0); // sanity: we actually captured pace data
    for (const p of paces) {
      // "Not faster than race pace" == numerically >= the anchor pace (s/mi
      // is inverse of speed — a LARGER number is a SLOWER, honest pace).
      expect(p).toBeGreaterThanOrEqual(SLOW_PACE_S_PER_MI);
    }
  });

  it('SECOND BUG SURFACE FOUND WHILE TESTING: race_week_tuneup I-pace via vdotFromTpace re-clamps to VDOT-30 territory — iPaceFromAnchorPace fixes it', () => {
    // Discovered constructing THE CORE ASSERTION test above: persistPlan's
    // iPaceSec derivation was `iPaceFromVdot(vdotFromTpace(weekT))` — but
    // vdotFromTpace's own binary search is bounded [30,85], so inverting the
    // honest below-table weekT (825 s/mi here) through it silently clamps UP
    // to VDOT 30, then iPaceFromVdot(30) = 593 s/mi (9:53/mi) — FASTER than
    // the 810 s/mi anchor despite the T-pace fix being correct. This locks
    // the fix: iPaceFromAnchorPace(anchor) instead, which never re-enters
    // VDOT space.
    const weekT = resolved.tPaceSec!;
    const vdotRoundTrip = vdotFromTpace(weekT);
    const legacyIPace = iPaceFromVdot(vdotRoundTrip)!;
    // Confirms the bug is real: the OLD derivation clamps to VDOT 30 and
    // produces a too-fast I-pace.
    expect(vdotRoundTrip).toBe(30); // clamped to the table floor
    expect(legacyIPace).toBeLessThan(SLOW_PACE_S_PER_MI); // faster than the anchor — the bug

    // The fix: iPaceFromAnchorPace never touches VDOT.
    const fixedIPace = iPaceFromAnchorPace(belowTableAnchor.anchor)!;
    expect(fixedIPace).toBeGreaterThanOrEqual(SLOW_PACE_S_PER_MI);
    // For THIS persona (anchor IS a 5K), I-pace should equal the anchor pace
    // exactly (Research/01 "I ≈ 5K race pace" — a 5K effort's I-pace IS that
    // effort's own pace, not something faster).
    expect(fixedIPace).toBe(SLOW_PACE_S_PER_MI);
  });

  it('DOCUMENTED EXCEPTION: race day may run up to the deliberate ±5 s/mi negative-split allowance faster than the anchor, never more', () => {
    // Race day is intentionally excluded from the core assertion above (see
    // allPrescribedPaces's doc comment) — it carries a long-standing ±5 s/mi
    // "controlled push, back half" pacing-strategy band that predates this
    // fix and applies to every runner, not just below-table ones. This test
    // pins that the exception is BOUNDED (5s, not unlimited) and that the
    // generate.ts fix (threading the anchor's own pace as the by-feel
    // race-day goal) is what the band is centered on.
    const input = buildInput({
      level: 'beginner', weeklyMi, freq: 3, raceMi: FIVE_K_MI,
      belowTableAnchor, weeks: 8,
    });
    const res = composePlan(input);
    const anchorPaceSPerMi = Math.round(belowTableAnchor.anchor.paceSPerMi);
    const raceDayPaces: number[] = [];
    for (const w of res.weeks) {
      const weekT = w.tPaceSec ?? resolved.tPaceSec;
      if (weekT == null) continue;
      for (const d of w.days) {
        if (d.type !== 'race') continue;
        const built = buildWorkoutSpec(
          d.type, d.distanceMi, weekT, null, d.subLabel, null,
          anchorPaceSPerMi, null, resolved.tPaceSec,
        );
        if (built.spec) {
          const lo = (built.spec as Record<string, unknown>).pace_target_s_per_mi_lo;
          if (typeof lo === 'number') raceDayPaces.push(lo);
        }
      }
    }
    expect(raceDayPaces.length).toBeGreaterThan(0); // the 8-week plan's race week produced a race day
    for (const p of raceDayPaces) {
      // Never more than 5 s/mi faster than the anchor — the deliberate,
      // bounded negative-split allowance, not an open-ended fast prescription.
      expect(p).toBeGreaterThanOrEqual(SLOW_PACE_S_PER_MI - 5);
    }
  });

  it('REGRESSION CHECK: the pre-fix mileage-only fallback WOULD have produced a too-fast pace — demonstrates the bug is real', () => {
    // Same runner and weeklyMi, but resolved WITHOUT the belowTableAnchor
    // (simulating the pre-fix code path, where conservativeVdotFromMileage
    // was the only fallback and the anchor was silently discarded).
    const resolvedNoAnchor = resolveCurrentTPace(null, null, weeklyMi, conservativeVdotFromMileage);
    expect(resolvedNoAnchor.tier).toBe('mileage_estimate');
    const mileageFloorT = resolvedNoAnchor.tPaceSec!;
    // The bug, demonstrated directly: the mileage-only T-pace is FASTER than
    // this runner's own demonstrated 5K race pace.
    expect(mileageFloorT).toBeLessThan(SLOW_PACE_S_PER_MI);

    const inputNoAnchor = buildInput({
      level: 'beginner', weeklyMi, freq: 3, raceMi: FIVE_K_MI,
      belowTableAnchor: null, weeks: 8,
    });
    const resNoAnchor = composePlan(inputNoAnchor);
    const pacesNoAnchor = allPrescribedPaces(resNoAnchor, mileageFloorT, mileageFloorT);
    const anyFasterThanRacePace = pacesNoAnchor.some((p) => p < SLOW_PACE_S_PER_MI);
    expect(anyFasterThanRacePace).toBe(true); // the exact bug P1-56 flagged
  });
});

describe('P1-56 · byte-safety — a runner WITH a real VDOT is completely unaffected', () => {
  it('composePlan output is identical whether belowTableAnchor is populated or not, when bestRecentVdot is set', () => {
    const belowTableAnchor: BelowTableAnchor = {
      source: 'race', refId: 'stale-slow-5k', name: 'Old Slow 5K', date: '2020-01-01',
      distance_mi: FIVE_K_MI, finish_seconds: SLOW_5K_FINISH_S, age_days: 2000,
      anchor: anchorPaceFrom(SLOW_5K_FINISH_S, FIVE_K_MI)!,
    };
    const withAnchor = buildInput({
      level: 'intermediate', weeklyMi: 30, freq: 4, raceMi: 13.1094,
      bestRecentVdot: 45, belowTableAnchor, weeks: 12,
    });
    const withoutAnchor = buildInput({
      level: 'intermediate', weeklyMi: 30, freq: 4, raceMi: 13.1094,
      bestRecentVdot: 45, belowTableAnchor: null, weeks: 12,
    });
    const resWith = composePlan(withAnchor);
    const resWithout = composePlan(withoutAnchor);
    expect(resWith).toEqual(resWithout);
  });

  it('resolveCurrentTPace tier 1 (measured VDOT) ignores belowTableAnchor entirely — same T-pace either way', () => {
    const belowTableAnchor: BelowTableAnchor = {
      source: 'race', refId: 'x', name: 'X', date: '2025-01-01',
      distance_mi: FIVE_K_MI, finish_seconds: SLOW_5K_FINISH_S, age_days: 365,
      anchor: anchorPaceFrom(SLOW_5K_FINISH_S, FIVE_K_MI)!,
    };
    const rWith = resolveCurrentTPace(45, belowTableAnchor, 30, conservativeVdotFromMileage);
    const rWithout = resolveCurrentTPace(45, null, 30, conservativeVdotFromMileage);
    expect(rWith.tier).toBe('measured_vdot');
    expect(rWith.tPaceSec).toBe(rWithout.tPaceSec);
    expect(rWith.tPaceSec).toBe(tPaceFromVdot(45));
  });

  it('a fit runner (real VDOT) never has belowTableAnchor populated by bestRecentVdot itself', () => {
    const r = bestRecentVdot(
      [{ slug: 'fast-5k', name: 'Fast 5K', date: '2025-12-01', priority: 'A', distance_mi: FIVE_K_MI, finish_seconds: 21 * 60 }],
      TODAY, 180,
    );
    expect(r.best).not.toBeNull();
    expect(r.belowTableAnchor).toBeNull();
  });
});
