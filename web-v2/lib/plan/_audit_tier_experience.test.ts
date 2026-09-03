/**
 * TIEREVIDENCE-2 (2026-09-02) · THE VAR-01 GUARD, INVERTED.
 *
 * ── WHAT THIS FILE USED TO ASSERT, AND WHY IT IS GONE ──────────────────────
 *
 * VAR-01 (2026-06-23) required `experienceLevel` to CLAMP the pace-derived
 * tier: "advanced(+) never below advanced; beginner never above intermediate",
 * and its second case asserted, in its own words, that "experience moves the
 * composed weekly peak" — `peakWk(soft('advanced')) > peakWk(soft('beginner'))
 * + 5`, off byte-identical history.
 *
 * That is exactly the defect `docs/PLAN_SIMPLIFICATION_DOCTRINE.md` §"What may
 * not" names by hand: "`profile.experience_level` reads `advanced` because he
 * typed it at onboarding, yielding a peak band of 65-90 mi/wk against a
 * measured best week of 48.5. A label he typed was outranking his own record."
 * A gate asserting the defect is worse than no gate, because it makes the fix
 * look like the regression.
 *
 * So the file is INVERTED rather than deleted, which is the stronger outcome:
 * the same two cases now assert the opposite, so the old behaviour cannot come
 * back without this file going red.
 *
 * ── WHAT REPLACES THE CLAMP ────────────────────────────────────────────────
 *
 * `classifyCapacityTier(raceDistanceMi, demonstratedPaceSec)` — the tier is a
 * DEMONSTRATED race pace and nothing else, falling back to `UNMEASURED_ROW_TIER`
 * (COLD-1's own constant, at its own value) when there is nothing demonstrated.
 * The PUBLISHED band, which is a permission rather than a template, answers the
 * bottom row instead; `_evidence_tier_band.test.ts` owns that half. The goal
 * still reduces and still cannot raise, which is `_goal_volume_seal.test.ts`'s
 * subject and is untouched here.
 *
 * ── WHAT THIS FILE CANNOT FAIL ON (Rule 22) ────────────────────────────────
 *
 *   · The two other routes the label used to travel — the workout library's
 *     `levelFit` filter and `finalizeComposedPlan`'s third positional argument.
 *     It calls neither. `_declared_level_inert.test.ts` sweeps all three.
 *   · WHETHER THE TIER IS RIGHT. It asserts the tier does not move with a
 *     label; every runner here could be graded into the wrong row and both
 *     cases would still pass.
 *   · The composed case below fixes `weeklyMileageBucket` at 35, so it says
 *     nothing about a runner whose reported base is far from doctrine's band.
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';
import { classifyGoalTier, classifyCapacityTier } from './goal-tiers';

const base = {
  startDateISO: '2026-07-06', raceDateISO: '', lastRaceFinishedDaysAgo: 0, lastRaceDistance: null,
  raceHistory: [], longRunDay: 'sun', availableDays: [], weeklyFrequency: 5,
} as any;

const peakWk = (r: any) => (r.ok ? Math.max(...r.composed.weeks.map((w: any) => w.weeklyMi)) : -1);

describe('TIEREVIDENCE-2 · the tier is demonstrated, never declared', () => {
  it('the classifier has no level argument left to clamp with', () => {
    // There is nowhere left to put a declared level: the parameter is gone from
    // the tuple, which is a COMPILE-time fact pinned by the seal at the bottom
    // of goal-tiers.ts and by scripts/check-goal-volume-leak.sh guard 3. What
    // follows is the runtime half — the answers that used to depend on it.
    //
    // TIEREVIDENCE-2 · with NOTHING demonstrated the COMPOSED row is doctrine's
    // middle template (`UNMEASURED_ROW_TIER`), which is COLD-1's own constant
    // kept at its own value; what changed is that it is no longer also a FLOOR
    // under a measured slow runner. The PUBLISHED band, which is a permission
    // rather than a template, still answers the bottom row —
    // `demonstratedLoadCeilingTier`, gated by `_evidence_tier_band.test.ts`.
    //
    // Fast marathon goal (sub-3, advanced by pace), nothing demonstrated. The
    // goal may only REDUCE, so the answer is the capacity answer. It used to be
    // 'developing' for a typed beginner and 'advanced' for a typed advanced
    // runner, off identical evidence; now there is one answer.
    expect(classifyGoalTier(410, 26.2)).toBe('intermediate');
    // Soft marathon goal (~4:20, developing by pace), nothing demonstrated —
    // and here the GOAL reduces, which GOALVOL-1 licenses and this does not
    // touch.
    expect(classifyGoalTier(595, 26.2)).toBe('developing');
    // No goal at all, nothing demonstrated: the unmeasured row, unreduced.
    expect(classifyGoalTier(null, 26.2)).toBe('intermediate');
    // ...and it is liftable, but only by DEMONSTRATED pace, never by the goal.
    expect(classifyGoalTier(410, 26.2, 405)).toBe('advanced');
    expect(classifyGoalTier(null, 26.2, 405)).toBe('advanced');
    // The capacity half on its own, so a failure names which of the two moved.
    expect(classifyCapacityTier(26.2, null)).toBe('intermediate');
    // ...and a MEASURED slow runner drops below it, which the deleted level
    // floor used to prevent. This is the half of the fix that makes the plan
    // more conservative, not less.
    expect(classifyCapacityTier(26.2, 700)).toBe('developing');
    expect(classifyCapacityTier(26.2, 405)).toBe('advanced');
    expect(classifyCapacityTier(26.2, 330)).toBe('elite');
    // FALSIFIED (Rule 18): restoring the deleted `CAPACITY_BAND.advanced.floor`
    // makes `classifyCapacityTier(26.2, 700)` answer 'advanced' and this red.
  });

  it('experience does NOT move the composed weekly peak (soft-goal marathon)', () => {
    // The exact fixture VAR-01 used, with the assertion turned around. It asked
    // for a greater-than-5 mi/wk gap between a declared advanced runner and a
    // declared beginner off identical history; the doctrine says zero.
    const soft = (lvl: string) => buildSimPlan({
      ...base, goalMode: 'goal', distance: 'marathon', planWeeks: 18,
      goalTimeSec: 15600, experienceLevel: lvl, weeklyMileageBucket: 35, longestRunBucket: '10+',
    });
    const peaks = ['beginner', 'intermediate', 'advanced', 'advanced_plus'].map((lvl) => peakWk(soft(lvl)));
    // LIVENESS · four real plans, not four refusals sharing the -1 sentinel.
    for (const p of peaks) expect(p).toBeGreaterThan(20);
    expect(
      new Set(peaks).size,
      `peak weekly mileage moved with the typed level: ${peaks.join(' / ')}`,
    ).toBe(1);
  });
});
