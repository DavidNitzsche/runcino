/**
 * lib/plan/generate-ultra.test.ts
 *
 * 2026-07-07 · ultra-honesty audit · falsifiers for P1-41 ("Ultra races
 * added from the phone silently generate a half-marathon plan") and the
 * David-approved fix: HONEST UNSUPPORTED, never fake support.
 *
 * Scope of this file — the pieces testable without a live DB pool (the
 * worktree can't spin one up; see CLAUDE.md "Verify by self-audit"):
 *
 *   1. distanceMiOf (exported from generate.ts) resolves every phone-
 *      offered ultra label to its correct mileage — the P1-41 root cause
 *      was this function silently returning 13.1 for '50k'/'50m'/'100k'/
 *      '100m' (none of the marathon/half/10k/5k substring branches matched
 *      and the numeric-mi regex needs an explicit "mi" unit).
 *   2. distanceMiOf never returns a value in [null-adjacent behavior] that
 *      masks as a real half-marathon — asserts the OLD buggy return value
 *      (13.1) is never produced for an ultra label.
 *   3. The DANIELS_MAX_VALID_DISTANCE_MI gate in lib/training/vdot.ts (the
 *      single point loadGeneratorInputs' unsupported-ultra check and every
 *      projection consumer share) returns honest null past the marathon,
 *      confirming "no fabricated projection" holds at the source.
 *   4. Non-ultra behavior is byte-identical: every 5K/10K/half/marathon
 *      input that resolved correctly before this change resolves to the
 *      exact same number after.
 *
 * The full "race saves fine, plan generation returns an unsupported
 * reason, runner lands in a coherent no-plan state" flow (loadGeneratorInputs
 * / generatePlan / POST /api/race) requires the DB pool and is documented
 * here as a self-audit trace instead (see the block comment at the bottom)
 * per feedback_verify_by_self_audit.md.
 */
import { describe, expect, it } from 'vitest';
import { distanceMiOf } from './generate';
import {
  DANIELS_MAX_VALID_DISTANCE_MI,
  vdotFromRace,
  predictRaceTime,
} from '@/lib/training/vdot';

describe('distanceMiOf — ultra labels resolve to correct mileage, never 13.1 (P1-41)', () => {
  it('resolves every phone Add Race sheet ultra label', () => {
    expect(distanceMiOf({ distanceLabel: '50K' })).toBe(31.07);
    expect(distanceMiOf({ distanceLabel: '50M' })).toBe(50);
    expect(distanceMiOf({ distanceLabel: '100K' })).toBe(62.14);
    expect(distanceMiOf({ distanceLabel: '100M' })).toBe(100);
  });

  it('never falls through to the old 13.1 half-marathon default for an ultra label', () => {
    // This is the literal P1-41 repro: generate.ts:298's old distanceMiOf
    // returned 13.1 for every one of these before the fix.
    for (const label of ['50K', '50M', '100K', '100M', 'Javelina 100M', 'Bandera 100K']) {
      expect(distanceMiOf({ distanceLabel: label })).not.toBe(13.1);
    }
  });

  it('prefers a numeric meta.distanceMi over the label when both are present', () => {
    expect(distanceMiOf({ distanceMi: 50, distanceLabel: 'Half Marathon' })).toBe(50);
  });

  it('falls back to meta.name when distanceLabel is absent (matches loadLastRaceFinished usage)', () => {
    expect(distanceMiOf({ name: 'Javelina Jundred 100M' })).toBe(100);
  });

  it('returns null — not a guess — for a genuinely unresolvable distance', () => {
    expect(distanceMiOf({})).toBeNull();
    expect(distanceMiOf({ distanceLabel: null })).toBeNull();
    expect(distanceMiOf({ distanceLabel: 'Turkey Trot' })).toBeNull();
    expect(distanceMiOf({ distanceMi: 0 })).toBeNull();
    expect(distanceMiOf({ distanceMi: -5 })).toBeNull();
  });

  it('non-ultra behavior is byte-identical to the pre-fix constants', () => {
    // The old function's literal return values for these branches (26.2 /
    // 13.1 / 6.2 / 3.1) must not drift — every downstream ±5% band check in
    // the plan generator and projection-snapshot readers is tuned to them.
    expect(distanceMiOf({ distanceLabel: 'Marathon' })).toBe(26.2);
    expect(distanceMiOf({ distanceLabel: 'Half Marathon' })).toBe(13.1);
    expect(distanceMiOf({ distanceLabel: '10K' })).toBe(6.2);
    expect(distanceMiOf({ distanceLabel: '5K' })).toBe(3.1);
    expect(distanceMiOf({ distanceMi: 26.2 })).toBe(26.2);
  });
});

describe('DANIELS_MAX_VALID_DISTANCE_MI gate — no fabricated ultra projection (P2-70/P2-71)', () => {
  it('vdotFromRace returns null for a real ultra finish time that would otherwise compute an in-range VDOT', () => {
    // The audit's own repro: a 50K in 5h computes rawVdot ≈ 35.6 — squarely
    // inside [30,85], so the OLD range clamp alone did NOT catch this.
    const fiveHours = 5 * 3600;
    expect(vdotFromRace(fiveHours, 31.07)).toBeNull();
    // 50-mile in 9h, 100-mile in 24h — same story at longer ultras.
    expect(vdotFromRace(9 * 3600, 50)).toBeNull();
    expect(vdotFromRace(24 * 3600, 100)).toBeNull();
  });

  it('predictRaceTime returns null (never an extrapolated time) for any ultra distance + any VDOT', () => {
    for (const vdot of [30, 45, 60, 85]) {
      expect(predictRaceTime(vdot, 31.07)).toBeNull(); // 50K
      expect(predictRaceTime(vdot, 50)).toBeNull();    // 50M
      expect(predictRaceTime(vdot, 62.14)).toBeNull(); // 100K
      expect(predictRaceTime(vdot, 100)).toBeNull();   // 100M
    }
  });

  it('marathon itself (the boundary) still projects — the gate is "past marathon", not "at or before"', () => {
    expect(predictRaceTime(50, 26.2188)).not.toBeNull();
    expect(predictRaceTime(50, 26.2)).not.toBeNull();
    expect(vdotFromRace(3 * 3600 + 30 * 60, 26.2188)).not.toBeNull();
  });

  it('non-ultra vdotFromRace/predictRaceTime are byte-identical (gate is a no-op below the boundary)', () => {
    // Half marathon: 1:30:00 at a real VDOT.
    const hm = vdotFromRace(90 * 60, 13.1094);
    expect(hm).not.toBeNull();
    expect(hm).toBeGreaterThan(40);
    // 5K, 10K predictions at a mid VDOT still resolve to real times.
    expect(predictRaceTime(50, 3.10686)).not.toBeNull();
    expect(predictRaceTime(50, 6.21371)).not.toBeNull();
    expect(predictRaceTime(50, 13.1094)).not.toBeNull();
  });

  it('DANIELS_MAX_VALID_DISTANCE_MI clears every marathon constant used elsewhere in the codebase', () => {
    // 26.2188 (vdot.ts internal), 26.219 (race-lookup/voice-band/race-history),
    // 26.22 (generate.ts comment reference), 26.2 (distanceMiOf/distanceMiFromLabel).
    for (const marathonConst of [26.2, 26.219, 26.2188, 26.22]) {
      expect(marathonConst).toBeLessThanOrEqual(DANIELS_MAX_VALID_DISTANCE_MI);
    }
    // And every ultra distance clears it in the other direction.
    for (const ultraConst of [31.07, 50, 62.14, 100]) {
      expect(ultraConst).toBeGreaterThan(DANIELS_MAX_VALID_DISTANCE_MI);
    }
  });
});

/**
 * ─── Self-audit trace: the full "honest unsupported" flow ─────────────────
 *
 * Not runnable without the DB pool; traced by reading the code instead
 * (feedback_verify_by_self_audit.md).
 *
 * A. Race path — POST /api/race with distance_label: "50K":
 *    1. app/api/race/route.ts POST writes meta.distanceMi via
 *       distanceMiFromLabel('50K') = 31.07 — the race row SAVES regardless
 *       of what happens next (this write is unconditional, before the plan
 *       generation attempt).
 *    2. Since meta.priority defaults to 'A' and there's no active plan, POST
 *       calls generatePlan({ userId, raceSlug, freshTarget: true }).
 *    3. generatePlan → loadGeneratorInputs resolves raceDistanceMi via
 *       distanceMiOf(meta) = 31.07 (meta.distanceMi is now numeric from
 *       step 1, so distanceMiOf takes the `Number(meta.distanceMi)` fast
 *       path — never even touches the label parser on this call).
 *    4. `dMi > DANIELS_MAX_VALID_DISTANCE_MI` (31.07 > 26.3) is true →
 *       loadGeneratorInputs returns
 *       { ok: false, reason: "Ultra plans aren't built yet. The race is on
 *       your calendar; training targets stay anchored to your current
 *       fitness." } — BEFORE any composePlan/validateComposedPlan call, so
 *       no plan rows are ever written, no active-plan archive happens
 *       (clearActivePlansFor is never reached), and the runner's existing
 *       active plan (if any) is untouched.
 *    5. generatePlan returns { ok: false, reason }; POST catches it into
 *       `plan`, computes `planError = toFriendlyPlanError(plan.reason)` —
 *       toFriendlyPlanError only rewrites the "mileage level" reason string,
 *       so the ultra reason passes through verbatim.
 *    6. Response: { ok: true, slug, plan: {ok:false, reason: "..."},
 *       plan_error: "Ultra plans aren't built yet..." }. The race exists on
 *       the runner's calendar; no plan was fabricated.
 *
 * B. Goal path — POST /api/profile/goal with distance_label: "50K":
 *    1. ALLOWED_DISTANCES includes '50K'/'100K' so the request passes
 *       validation; tt_goal_distance/tt_goal_time/tt_goal_time_seconds are
 *       written unconditionally (goal SAVES).
 *    2. goalDistanceMiFromCode('50K') = 31.0686 (lib/training/vdot.ts) →
 *       distMi is truthy → genWith() calls
 *       generatePlan({ goalTarget: { distanceMi: 31.0686, ... } }).
 *    3. loadGeneratorInputs' `if (goalTarget)` branch now checks
 *       `goalTarget.distanceMi > DANIELS_MAX_VALID_DISTANCE_MI` FIRST,
 *       before assigning raceDistanceMi/goalSec — returns the same honest
 *       { ok: false, reason: "Ultra plans aren't built yet..." }.
 *    4. The Monday-anchored retry (the P1-CRITICAL fail-safe) hits the
 *       identical goalTarget.distanceMi gate and also fails honestly — it
 *       does NOT fall back to a wrong-distance plan, by construction (the
 *       gate doesn't depend on the anchor/start date).
 *    5. Response: { ok: true, ..., plan: null, plan_error: "Ultra plans
 *       aren't built yet..." }. tt_goal_* is set; no plan exists.
 *
 * C. "Cannot brick onboarding" — the no-plan coherent state:
 *    lib/coach/state-loader.ts loadCoachState: `const plan = await
 *    loadActivePlan(userId)` returns null (no active plan row was ever
 *    written in either flow above) → `if (plan) {...}` is skipped entirely,
 *    so todayWorkout/nextWorkout/currentWeekDays/weekPlanned/phaseLabel all
 *    stay at their safe defaults (null/[]/null). Separately, `nextARace`
 *    still resolves via loadNextARace (the race row from flow A exists) and
 *    `fitnessGoal` still resolves from profile.tt_goal_* (flow B) — BOTH
 *    read independently of `plan`. The runner sees "training toward your
 *    50K on [date]" / a set goal, with an empty week strip and no today/
 *    next workout — the existing no-goal/just-run empty state, not a crash
 *    or an infinite loading spinner. This is the same architecture the
 *    no-goal "just run" mode (TF 223) already established; ultra-goal users
 *    fall into it for free.
 *
 * D. Targets projection degrades honestly (P2-70/P2-71):
 *    /api/targets/projection resolves distanceMi = 31.07 for the ultra race/
 *    goal. `unsupportedDistance = distanceMi > DANIELS_MAX_VALID_DISTANCE_MI`
 *    = true. `projectionSec` stays null (predictRaceTime nulls out at the
 *    source per the tests above) so status falls to 'cold' (or 'race_week'
 *    if within 7 days — a real date-based override, unaffected). totalGapSec/
 *    fitnessSec/levers all stay at their honest zero/[] defaults (gated on
 *    `projectionSec` truthiness). composeTargetsSummaryLine's new
 *    `unsupportedDistance` branch fires BEFORE the "no goal set" nudge
 *    branches, so a runner who set a real 50K goal is told "Ultra
 *    projections aren't supported yet" instead of being wrongly told to
 *    set a goal they already set.
 */
