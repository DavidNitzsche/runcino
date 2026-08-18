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
import {
  paceBlendAnchorIsProvisional, isProvisionalAnchor,
  CALIBRATION_INTRO_WEEKS, EFFORT_CUED_TYPES,
} from './anchor-provenance';
import { buildSimPlan } from './sim-inputs';
import type { SimInputs } from './sim-constants';
import { predictRaceTime, tPaceFromVdot } from '@/lib/training/vdot';
import { specForComposedDay } from './generate';
import { conservativeVdotFromMileage } from './spec-builder';
import { expandSpecToPhases, subLabelFromSpec } from '@/lib/training/expand-spec';

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

/* ─────────────────────────────────────────────────────────────────────────
 * FIX 4 · marking the anchor was not enough — the plan still PRESCRIBED it
 *
 * COLD-3 stopped three readers believing the invented VDOT. It did not stop
 * the runner being handed it: the same cold-start account still got a week-one
 * threshold session at 8:23/mi, a pace derived entirely from a 30 mi/wk
 * self-report. The distance is the runner's own claim; the pace was ours.
 *
 * The maintenance path solved this in June (`CALIBRATION_INTRO_WEEKS`) and
 * race-prep never got it.
 * ───────────────────────────────────────────────────────────────────────── */
describe('COLD-4 · the calibration intro reaches the race-prep path', () => {
  /** persistPlan's own argument shape for the cold-start marathon plan. */
  const persistArgs = (built: Extract<ReturnType<typeof buildSimPlan>, { ok: true }>) => ({
    lthr: null,
    maxHr: null,
    goalPaceSec: built.derived.goalPaceSec,
    easyAnchorTSec: tPaceFromVdot(conservativeVdotFromMileage(built.derived.recentWeeklyMi)),
    goalIPaceEligible: false,   // marathon goal → cruise default
    belowTableAnchor: null,
  });

  const build = () => {
    const built = buildSimPlan(COLD_START);
    if (!built.ok) throw new Error(built.reason);
    return built;
  };

  it('the intro window covers the opening weeks and NOTHING after them', () => {
    const built = build();
    for (let wi = 0; wi < built.composed.weeks.length; wi++) {
      const cued = built.composed.weeks[wi].days.filter((d) => (d as { effortCued?: boolean }).effortCued === true);
      if (wi < CALIBRATION_INTRO_WEEKS) {
        expect(cued.length, `week ${wi + 1} should carry the intro`).toBeGreaterThan(0);
        // ONLY quality. The runner's own volume claim is untouched.
        for (const d of cued) {
          expect(d.isQuality).toBe(true);
          expect(EFFORT_CUED_TYPES.has(d.type)).toBe(true);
        }
      } else {
        expect(cued.length, `week ${wi + 1} is past the window`).toBe(0);
      }
    }
  });

  it('week one quality carries NO pace target · week three does', () => {
    const built = build();
    const args = persistArgs(built);
    const qualityOf = (wi: number) => built.composed.weeks[wi].days
      .filter((d) => d.isQuality)
      .map((d) => ({ d, ...specForComposedDay(d, built.composed.weeks[wi].tPaceSec ?? null, args) }));

    const w1 = qualityOf(0);
    expect(w1.length).toBeGreaterThan(0);
    for (const q of w1) {
      expect(q.paceTargetSPerMi, 'week-one quality must not carry a pace column').toBeNull();
      const spec = q.spec as Record<string, unknown>;
      expect(spec.by_effort).toBe(true);
      // The pace is withheld. Everything else about the session is intact.
      expect(spec.rep_pace_s_per_mi ?? spec.tempo_pace_s_per_mi ?? null).toBeNull();
      expect(Number(spec.warmup_mi)).toBeGreaterThan(0);
      expect(Number(spec.cooldown_mi)).toBeGreaterThan(0);
      expect(Number(spec.rep_count ?? 1)).toBeGreaterThan(0);
      // ...and the label says EFFORT rather than promising a pace it lacks.
      const label = subLabelFromSpec(q.spec as Parameters<typeof subLabelFromSpec>[0]) ?? '';
      expect(label).not.toMatch(/@\s*[TIRME]\s*pace\b/i);
      expect(label).toMatch(/effort/i);
    }

    const w3 = qualityOf(2);
    expect(w3.length).toBeGreaterThan(0);
    for (const q of w3) {
      expect(q.paceTargetSPerMi, 'week three is past the window · pace returns').not.toBeNull();
      expect((q.spec as Record<string, unknown>).by_effort).toBeUndefined();
    }
  });

  it('the long run and the weekly volume are IDENTICAL either way', () => {
    // The owner's ruling: effort-cue the pace only. Volume and the long run are
    // the runner's own claim and are already doctrine-bounded, so the intro must
    // not move a single mile.
    const built = build();
    const args = persistArgs(built);
    for (const wi of [0, 1]) {
      const w = built.composed.weeks[wi];
      const long = w.days.find((d) => d.isLong)!;
      expect((long as { effortCued?: boolean }).effortCued).toBeUndefined();
      const { paceTargetSPerMi, spec } = specForComposedDay(long, w.tPaceSec ?? null, args);
      expect(paceTargetSPerMi).not.toBeNull();          // long keeps its band
      expect((spec as Record<string, unknown>).by_effort).toBeUndefined();
      expect(long.distanceMi).toBeGreaterThan(0);
    }
  });

  it('an effort-cued session is still executable on the watch', () => {
    // A phase list with structure, distances/durations and jog recoveries — and
    // a null target on the work, which every watch face already handles. The
    // failure this guards is an EMPTY or paceless-and-shapeless expansion,
    // which would leave the runner with nothing to run.
    const built = build();
    const args = persistArgs(built);
    const w = built.composed.weeks[0];
    const q = w.days.find((d) => d.isQuality)!;
    const { spec } = specForComposedDay(q, w.tPaceSec ?? null, args);
    const easy = args.easyAnchorTSec != null ? args.easyAnchorTSec + 100 : null;
    const phases = expandSpecToPhases({
      spec: spec as Parameters<typeof expandSpecToPhases>[0]['spec'],
      totalMi: q.distanceMi, easyPaceSec: easy, recoveryPaceSec: easy,
    });
    expect(phases).not.toBeNull();
    const work = (phases ?? []).filter((p) => p.type === 'work');
    expect(work.length).toBeGreaterThan(0);
    for (const p of work) {
      expect(p.targetPaceSPerMi ?? null).toBeNull();        // no invented pace
      expect(p.tolerancePaceSPerMi ?? null).toBeNull();     // and no band around one
      // Still countable: every work phase knows how far or how long it runs.
      expect((p.distanceMi ?? 0) > 0 || (p.durationSec ?? 0) > 0).toBe(true);
      // And it is not mislabelled as a hill just because it has no pace.
      expect(p.label).not.toMatch(/hill/i);
    }
    // Warm-up and cool-down keep the runner's own easy band — that pace is not
    // the fabrication being withheld.
    expect((phases ?? []).find((p) => p.type === 'warmup')?.targetPaceSPerMi).toBe(easy);
  });

  it('a MEASURED runner gets no intro at all (byte-identical to before)', () => {
    const built = buildSimPlan({ ...COLD_START, bestRecentVdotOverride: 48 });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    for (const w of built.composed.weeks) {
      for (const d of w.days) {
        expect((d as { effortCued?: boolean }).effortCued).toBeUndefined();
      }
    }
  });
});
