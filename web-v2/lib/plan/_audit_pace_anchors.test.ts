/**
 * Pace-anchor regression guard (third deep audit, 2026-06-23).
 *
 * Locks the Phase-1 pace fixes so they cannot silently regress the way VAR-05 did
 * (specified in the 2026-06-22 audit, never applied — by-feel runners shipped a flat
 * 8:00/mi threshold for months):
 *   VAR-05 · no-goal (by-feel) T-pace anchors to the runner's fitness (currentT), not 480.
 *   PACE-5 · ultra (50K+) T-pace comes from VDOT, not the marathon goalPace−18 offset.
 *   PACE-3 · an absurd implied pace (HM time on a 5K goal) is guarded, not threaded.
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';

const base = {
  startDateISO: '2026-07-06', raceDateISO: '', lastRaceFinishedDaysAgo: 0, lastRaceDistance: null,
  raceHistory: [], longRunDay: 'sun', availableDays: [],
} as any;

describe('pace anchors', () => {
  it('VAR-05 · by-feel anchors T to currentT, never the 480 literal', () => {
    const r = buildSimPlan({ ...base, goalMode: 'goal', distance: '5k', planWeeks: 12, goalTimeSec: null,
      experienceLevel: 'intermediate', weeklyFrequency: 4, weeklyMileageBucket: 25, longestRunBucket: '6-10', bestRecentVdotOverride: 54 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // VDOT 54 → true T ≈ 387s/mi. Must NOT be the old flat 480.
    expect(r.derived.tPaceSec).toBeLessThan(420);
    expect(r.derived.tPaceSec).not.toBe(480);
    // every quality week paced off fitness, not 480
    for (const w of r.composed.weeks) {
      if (w.tPaceSec != null) expect(w.tPaceSec).toBeLessThan(440);
    }
  });

  it('PACE-5 · ultra T comes from VDOT, not goalPace−18', () => {
    const goalSec = 5 * 3600 + 24 * 60; // 50K in 5:24 → goalPace ≈ 626s/mi → bogus T would be ~608
    const r = buildSimPlan({ ...base, goalMode: 'goal', distance: '50k', planWeeks: 16, goalTimeSec: goalSec,
      experienceLevel: 'advanced', weeklyFrequency: 5, weeklyMileageBucket: 35, longestRunBucket: '10+', bestRecentVdotOverride: 50 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // VDOT 50 → T ≈ 414s/mi, far faster than the marathon-offset goalPace−18 (~608).
    expect(r.derived.tPaceSec).toBeLessThan(460);
    expect(r.derived.goalPaceSec! - r.derived.tPaceSec).toBeGreaterThan(120);
  });

  it('PACE-3 · an absurd implied pace is guarded, not threaded', () => {
    const r = buildSimPlan({ ...base, goalMode: 'goal', distance: '5k', planWeeks: 12, goalTimeSec: 5585, // 1:33 HM time on a 5K goal
      experienceLevel: 'intermediate', weeklyFrequency: 4, weeklyMileageBucket: 25, longestRunBucket: '6-10' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // ~30 min/mi implied → guarded to absent; pace falls to the fitness anchor.
    expect(r.derived.goalPaceSec).toBeNull();
    expect(r.derived.tPaceSec).toBeLessThan(900);
  });
});
