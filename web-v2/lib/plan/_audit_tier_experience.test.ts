/**
 * VAR-01 regression guard (third deep audit, 2026-06-23).
 *
 * experienceLevel must CLAMP the pace-derived tier (Research/22 has distinct per-experience
 * templates). Before the fix, classifyGoalTier ignored level entirely (arity 2) — a beginner,
 * intermediate, and advanced runner with the same goal pace got byte-identical plans.
 *
 * Clamp: beginner never above intermediate.
 *
 * ── TIEREVIDENCE-1 (2026-09-02) · THE OTHER HALF OF VAR-01'S CLAMP IS GONE ──
 *
 * VAR-01 was written as a two-directional clamp: "advanced(+) never below
 * advanced; beginner never above intermediate." The first half is a FLOOR set
 * by a word the runner typed, and it is the defect the owner named on his own
 * account — a typed 'advanced' produced a 65-90 mi/wk band against a measured
 * best week of 48.5 and demonstrated race pace that grades 'intermediate'.
 *
 * VAR-01's actual finding survives intact and is what this file still guards:
 * experience must not be IGNORED, and three runners with one goal pace must not
 * get byte-identical plans. What changed is the direction it may move them. A
 * self-report may hold a runner DOWN (a stated beginner is not handed an elite
 * load table off one fast race) and may no longer lift one UP.
 *
 * The second test below is inverted for that reason and says so in place.
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';
import { classifyGoalTier } from './goal-tiers';

const base = {
  startDateISO: '2026-07-06', raceDateISO: '', lastRaceFinishedDaysAgo: 0, lastRaceDistance: null,
  raceHistory: [], longRunDay: 'sun', availableDays: [], weeklyFrequency: 5,
} as any;

const peakWk = (r: any) => (r.ok ? Math.max(...r.composed.weeks.map((w: any) => w.weeklyMi)) : -1);

describe('VAR-01 · experience clamps the tier', () => {
  it('classifier clamps both directions', () => {
    // Fast marathon goal (sub-3 → advanced by pace); a beginner cannot absorb advanced bands.
    //
    // GOALVOL-1 (2026-09-02) · MOVED, 'intermediate' → 'developing', and it moved
    // DOWN. The old expectation was the beginner CEILING doing the work: the goal
    // set the tier and `min(goalTier, intermediate)` stopped it one rung short of
    // advanced. David's ruling — "a typed goal must not directly increase training
    // volume ... it cannot manufacture readiness for more load" — means the band is
    // now the beginner's own CAPACITY, which with no demonstrated pace is
    // 'developing'; the same runner with NO goal at all has always resolved to
    // 'developing' (the line ten below asserts it), and a typed 6:50/mi is not
    // evidence they can absorb 15 more miles a week. The ceiling still exists and
    // still binds the moment demonstrated evidence lifts them — see
    // `_goal_volume_seal.test.ts` §5, which asserts a beginner demonstrating elite
    // pace reaches intermediate and stops there.
    expect(classifyGoalTier(410, 26.2, 'beginner')).toBe('developing');
    // TIEREVIDENCE-1 · 'advanced' with NO demonstrated pace is now 'developing'
    // too. The word was the only thing holding the advanced band up.
    expect(classifyGoalTier(410, 26.2, 'advanced')).toBe('developing');
    // Soft marathon goal (~4:20 → developing by pace) · nothing demonstrated.
    expect(classifyGoalTier(595, 26.2, 'advanced')).toBe('developing');
    expect(classifyGoalTier(595, 26.2, 'beginner')).toBe('developing');
    expect(classifyGoalTier(595, 26.2, 'intermediate')).toBe('developing');
    // No goal, nothing demonstrated → the bottom row for every level.
    expect(classifyGoalTier(null, 26.2, 'beginner')).toBe('developing');
    expect(classifyGoalTier(null, 26.2, 'advanced')).toBe('developing');
    // COLD-1 (2026-08-17) · this line used to assert "no level → unchanged legacy
    // behavior (pace-only)" and expect 'advanced'. That legacy behavior WAS the
    // bug: `profile.experience_level` is NULL on production accounts, so a goal
    // time somebody typed picked the tier by itself — a sub-3 marathon goal on an
    // account with zero runs authorized the advanced band (65-90 mi/wk, 22-24 mi
    // long runs). An unstated level is unknown capacity, not permission.
    // See _coldstart_doctrine.test.ts § COLD-1.
    //
    // TIEREVIDENCE-1 · and the answer moved one more rung down, to the bottom of
    // the table, because `UNSTATED_LEVEL_TIER_CEILING` was a promotion wearing a
    // ceiling's name — it PUT an unevidenced account on the middle row.
    expect(classifyGoalTier(410, 26.2)).toBe('developing');
    expect(classifyGoalTier(null, 26.2)).toBe('developing');
    // ...and it is liftable, but only by DEMONSTRATED pace, never by the goal
    // and never by the word. This is the Rule 21 half: the band still has a way
    // up, and evidence is the whole of it.
    expect(classifyGoalTier(410, 26.2, null, 405)).toBe('advanced');
    expect(classifyGoalTier(410, 26.2, 'advanced', 405)).toBe('advanced');
    expect(classifyGoalTier(410, 26.2, 'beginner', 405)).toBe('intermediate');
  });

  it('TIEREVIDENCE-1 · a typed level alone no longer moves the composed weekly peak', () => {
    const soft = (lvl: string, demoVdot?: number) => buildSimPlan({ ...base, goalMode: 'goal',
      distance: 'marathon', planWeeks: 18, goalTimeSec: 15600, experienceLevel: lvl,
      weeklyMileageBucket: 35, longestRunBucket: '10+',
      ...(demoVdot != null ? { bestRecentVdotOverride: demoVdot } : {}) });
    // INVERTED ON PURPOSE. This used to read "advanced clamps UP from the
    // developing pace-tier → a higher weekly peak than a beginner", which is the
    // authority TIEREVIDENCE-1 removes: two runners with identical training and
    // identical goals got peaks 5+ mi/wk apart because of a word.
    expect(peakWk(soft('advanced'))).toBe(peakWk(soft('beginner')));
    // …and VAR-01's own finding still holds, on evidence rather than on the
    // word: a runner who has DEMONSTRATED advanced marathon fitness gets the
    // bigger peak, and a stated beginner demonstrating the same is held under it
    // by the ceiling the level still owns.
    const demonstrated = peakWk(soft('advanced', 58));
    expect(demonstrated).toBeGreaterThan(peakWk(soft('advanced')) + 5);
    expect(peakWk(soft('beginner', 58))).toBeLessThan(demonstrated);
  });
});
