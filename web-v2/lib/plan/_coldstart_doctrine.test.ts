/**
 * COLD-START DOCTRINE (2026-08-17)
 *
 * A live account — 0 runs, 0 races, a 30 mi/wk self-report and a typed 3:30
 * marathon goal — was handed a plan with a 13-mile long run and a threshold
 * session in week one, and the plan recorded `goal_realism: { flag: false }`:
 * an affirmative statement that the goal was realistic, made about a runner the
 * engine had never seen take a step.
 *
 * The structural cause was that every honest cold-start mechanism
 * (`calibrating`, `anchorSource: 'provisional_mileage'`, the maintenance
 * re-anchor) lived on the no-race path. `composePlan` — where a new runner WITH
 * a goal lands — wrote no provenance at all.
 *
 * Three defects, three fixes, one test file. Each test below fails against the
 * code as it stood on 2026-08-17 and passes after.
 *
 * Doctrine: Design/adaptive-progression-engine.md
 *   §A  "Fitness must be demonstrated."
 *   §A  non-evidence leaks · `conservativeVdotFromMileage` named by construction
 *   Non-negotiable rule 1 · time alone cannot increase fitness
 */
import { describe, it, expect } from 'vitest';
import { classifyGoalTier, lookupTierTarget, TIER_TARGETS } from './goal-tiers';
import { weeklyAvgFromWindow, MIN_COVERAGE_DAYS } from '@/lib/runs/volume';
import { paceBlendAnchorIsProvisional, isProvisionalAnchor } from './anchor-provenance';
import { buildSimPlan } from './sim-inputs';
import type { SimInputs } from './sim-constants';
import { predictRaceTime } from '@/lib/training/vdot';

const MARATHON_MI = 26.2188;
/** The apple-review@faff.run shape: 0 runs, 0 races, 30 mi/wk self-report. */
const COLD_START: SimInputs = {
  goalMode: 'race',
  distance: 'marathon',
  startDateISO: '2026-08-08',
  planWeeks: 0,
  goalTimeSec: 12600,          // 3:30:00
  raceDateISO: '2026-10-02',
  experienceLevel: null as unknown as SimInputs['experienceLevel'], // NULL in production
  weeklyFrequency: 4,
  weeklyMileageBucket: 25,     // → recentWeeklyMi 30
  longestRunBucket: '10+',     // → recentLongMi 12
  raceHistory: [],             // nothing demonstrated
  longRunDay: 'sun',
} as unknown as SimInputs;

/* ─────────────────────────────────────────────────────────────────────────
 * FIX 1 · a typed goal time is an aspiration, not a demonstrated capacity
 * ───────────────────────────────────────────────────────────────────────── */
describe('COLD-1 · goal pace alone must not authorize elite volume', () => {
  // sub-3 marathon = 6:40/mi. Before the fix this classified `advanced` off the
  // goal pace alone, for an account with no runs: peak band 65-90 mi/wk with
  // 22-24 mi long runs.
  const SUB_3_PACE = Math.round((2 * 3600 + 55 * 60) / MARATHON_MI);

  it('an UNSTATED experience level (production NULL) caps at intermediate', () => {
    expect(classifyGoalTier(SUB_3_PACE, MARATHON_MI, null)).toBe('intermediate');
    expect(classifyGoalTier(SUB_3_PACE, MARATHON_MI, undefined)).toBe('intermediate');
    // and the band the plan is actually built to comes down with it
    const { target } = lookupTierTarget(SUB_3_PACE, MARATHON_MI, null);
    expect(target.peakWeeklyMileageBand).toEqual(TIER_TARGETS.m.intermediate.peakWeeklyMileageBand);
    expect(target.peakWeeklyMileageBand[1]).toBeLessThan(TIER_TARGETS.m.advanced.peakWeeklyMileageBand[1]);
  });

  it('an EXPLICIT intermediate level never reaches elite off a typed goal', () => {
    const ELITE_PACE = Math.round((2 * 3600 + 20 * 60) / MARATHON_MI); // 5:20/mi
    expect(classifyGoalTier(ELITE_PACE, MARATHON_MI, 'intermediate')).toBe('advanced');
  });

  it('DEMONSTRATED fitness lifts the unstated-level cap · a mileage self-report does not', () => {
    // A measured VDOT that itself grades advanced at this distance earns the tier.
    const advancedVdot = 62;
    const t = predictRaceTime(advancedVdot, MARATHON_MI)!;
    const demonstratedPace = Math.round(t / MARATHON_MI);
    expect(classifyGoalTier(SUB_3_PACE, MARATHON_MI, null, demonstratedPace)).toBe('advanced');
    // No measurement → the cap holds, whatever was typed.
    expect(classifyGoalTier(SUB_3_PACE, MARATHON_MI, null, null)).toBe('intermediate');
  });

  it('the cold-start runner is never ramped to advanced-tier volume', () => {
    const built = buildSimPlan({ ...COLD_START, goalTimeSec: 2 * 3600 + 55 * 60, raceDateISO: '2026-12-05' });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const peakWeekly = Math.max(...built.composed.weeks.map((w) => w.weeklyMi));
    expect(peakWeekly).toBeLessThanOrEqual(TIER_TARGETS.m.intermediate.peakWeeklyMileageBand[1]);
    // the pre-fix plan peaked in the 60s off a 30 mi/wk base with zero runs
    expect(peakWeekly).toBeLessThan(TIER_TARGETS.m.advanced.peakWeeklyMileageBand[0]);
  });

  it('an explicit advanced level is unaffected (no demotion of a stated runner)', () => {
    expect(classifyGoalTier(SUB_3_PACE, MARATHON_MI, 'advanced')).toBe('advanced');
    expect(classifyGoalTier(SUB_3_PACE, MARATHON_MI, 'advanced_plus')).toBe('advanced');
    expect(classifyGoalTier(null, MARATHON_MI, 'advanced')).toBe('advanced');
    expect(classifyGoalTier(null, MARATHON_MI, 'beginner')).toBe('developing');
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * FIX 2 · a perfect first week must not read as a volume collapse
 * ───────────────────────────────────────────────────────────────────────── */
describe('COLD-2 · the weekly-average divisor follows real coverage', () => {
  it('one perfectly-executed week reads at its real volume, not a quarter of it', () => {
    // 30 miles run across a 7-day-old account.
    expect(weeklyAvgFromWindow(30, 7, 28)).toBe(30);
    // The old fixed divisor produced 7.5 — a 75% drop against a 30 mi/wk plan,
    // past the drift monitor's 40% threshold, firing an UNCONFIRMED rebuild
    // that re-authored the plan at the deflated base.
    expect(weeklyAvgFromWindow(30, 7, 28)).not.toBe(7.5);
  });

  it('two weeks in reads at the real weekly rate', () => {
    expect(weeklyAvgFromWindow(60, 14, 28)).toBe(30);
  });

  it('under a week of history returns null · unknown, not a fabricated collapse', () => {
    expect(weeklyAvgFromWindow(12, 3, 28)).toBeNull();
    expect(weeklyAvgFromWindow(30, MIN_COVERAGE_DAYS - 1, 28)).toBeNull();
  });

  it('a full window is byte-identical to the old fixed divisor', () => {
    // The established-runner path must not move.
    for (const total of [40, 120, 137.5, 200]) {
      expect(weeklyAvgFromWindow(total, 28, 28)).toBe(Math.round((total / 4) * 10) / 10);
    }
  });

  it('a runner with long history who genuinely stopped still reads as stopped', () => {
    // Full coverage, zero miles → null (the pre-existing "no signal" contract),
    // NOT a coverage-inflated number.
    expect(weeklyAvgFromWindow(0, 28, 28)).toBeNull();
  });

  it('coverage never exceeds the window (no inflation from a long history)', () => {
    expect(weeklyAvgFromWindow(120, 365, 28)).toBe(30);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * FIX 3 · the cold-start anchor carries its provenance
 * ───────────────────────────────────────────────────────────────────────── */
describe('COLD-3 · a mileage-derived anchor is marked, and readers refuse it', () => {
  it('a cold-start race-prep plan records the anchor as provisional', () => {
    const built = buildSimPlan(COLD_START);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const pb = (built.composed.authoredState as Record<string, any>).pace_blend;
    expect(pb.season_anchor_source).toBe('provisional_mileage');
    expect(pb.season_anchor_provisional).toBe(true);
    expect(paceBlendAnchorIsProvisional(pb)).toBe(true);
  });

  it('a runner with a MEASURED vdot records a measured anchor', () => {
    const built = buildSimPlan({ ...COLD_START, bestRecentVdotOverride: 48 });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const pb = (built.composed.authoredState as Record<string, any>).pace_blend;
    expect(pb.season_anchor_source).toBe('measured_vdot');
    expect(pb.season_anchor_provisional).toBe(false);
    expect(paceBlendAnchorIsProvisional(pb)).toBe(false);
  });

  it('goal_realism reports NOT ASSESSABLE rather than a false all-clear', () => {
    const built = buildSimPlan(COLD_START);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const gr = (built.composed.authoredState as Record<string, any>).goal_realism;
    // The pre-fix value was exactly `{ flag: false }` — the guard silenced by
    // the fabrication it exists to catch: goal VDOT ~44.6 against a mileage-
    // invented 40 is +11.5%, under the 15% trigger.
    expect(gr.assessable).toBe(false);
    expect(gr.basis).toBe('provisional_mileage');
    expect(Object.prototype.hasOwnProperty.call(gr, 'estimatedCurrentVdot')).toBe(false);
  });

  it('goal_realism still fires for a MEASURED runner with an over-ambitious goal', () => {
    // Measured VDOT 40, goal 2:55 marathon (VDOT ~53) → +30%, well past 15%.
    const built = buildSimPlan({
      ...COLD_START, bestRecentVdotOverride: 40,
      goalTimeSec: 2 * 3600 + 55 * 60, raceDateISO: '2026-12-05',
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const gr = (built.composed.authoredState as Record<string, any>).goal_realism;
    expect(gr.assessable).toBe(true);
    expect(gr.flag).toBe(true);
    expect(gr.basis).toBe('measured_vdot');
  });

  it('the reader predicate refuses a provisional anchor by either mark', () => {
    expect(paceBlendAnchorIsProvisional({ season_anchor_vdot: 40, season_anchor_source: 'provisional_mileage' })).toBe(true);
    expect(paceBlendAnchorIsProvisional({ season_anchor_vdot: 40, season_anchor_provisional: true })).toBe(true);
    expect(paceBlendAnchorIsProvisional({ season_anchor_vdot: 48, season_anchor_source: 'measured_vdot' })).toBe(false);
    // Plans authored before the provenance landed carry neither mark. They all
    // predate the mileage fallback reaching this column, so they stay readable.
    expect(paceBlendAnchorIsProvisional({ season_anchor_vdot: 48 })).toBe(false);
    expect(paceBlendAnchorIsProvisional(null)).toBe(false);
    expect(isProvisionalAnchor('below_table_anchor')).toBe(false);
  });
});
