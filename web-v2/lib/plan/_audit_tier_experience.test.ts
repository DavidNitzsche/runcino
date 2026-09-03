/**
 * VAR-01 regression guard (third deep audit, 2026-06-23).
 *
 * experienceLevel must CLAMP the pace-derived tier (Research/22 has distinct per-experience
 * templates). Before the fix, classifyGoalTier ignored level entirely (arity 2) — a beginner,
 * intermediate, and advanced runner with the same goal pace got byte-identical plans.
 *
 * Clamp: advanced(+) never below advanced; beginner never above intermediate.
 *
 * ── TIEREVIDENCE-1 (2026-09-02) · WHAT THIS FILE NO LONGER COVERS ───────────
 *
 * The clamp's FLOOR half — "advanced(+) never below advanced" — is a floor set
 * by a word the runner typed, and it is the defect the owner named on his own
 * account: a typed 'advanced' produced a 65-90 mi/wk band against a measured
 * best week of 48.5 and demonstrated race pace that grades 'intermediate'.
 *
 * It still stands HERE, because this row also sets the long-run band, the
 * long-run share and the quality/day counts, and re-selecting it off a pace
 * reading shortens a marathoner's long run on evidence that is not about long
 * runs (measured: the frozen INV-12 David-class fixture keeps 66 mi/wk either
 * way and loses 2.5 mi off its peak long). What DID change is that the two
 * numbers the adaptation engine binds on — `authored_state
 * .tier_peak_weekly_band` and `tier_peak_long_band` — no longer read this row
 * at all; they read `demonstratedLoadCeilingTier`, which the typed level may
 * only cap. `_evidence_tier_band.test.ts` is that half's gate.
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
    expect(classifyGoalTier(410, 26.2, 'advanced')).toBe('advanced');
    // Soft marathon goal (~4:20 → developing by pace); an advanced runner keeps advanced capacity.
    expect(classifyGoalTier(595, 26.2, 'advanced')).toBe('advanced');
    expect(classifyGoalTier(595, 26.2, 'beginner')).toBe('developing');
    expect(classifyGoalTier(595, 26.2, 'intermediate')).toBe('developing');
    // No goal → defaults off experience, not a hardcoded intermediate.
    expect(classifyGoalTier(null, 26.2, 'beginner')).toBe('developing');
    expect(classifyGoalTier(null, 26.2, 'advanced')).toBe('advanced');
    // COLD-1 (2026-08-17) · this line used to assert "no level → unchanged legacy
    // behavior (pace-only)" and expect 'advanced'. That legacy behavior WAS the
    // bug: `profile.experience_level` is NULL on production accounts, so a goal
    // time somebody typed picked the tier by itself — a sub-3 marathon goal on an
    // account with zero runs authorized the advanced band (65-90 mi/wk, 22-24 mi
    // long runs). An unstated level is unknown capacity, not permission.
    // See _coldstart_doctrine.test.ts § COLD-1.
    expect(classifyGoalTier(410, 26.2)).toBe('intermediate');
    expect(classifyGoalTier(null, 26.2)).toBe('intermediate');
    // ...and it is liftable, but only by DEMONSTRATED pace, never by the goal.
    expect(classifyGoalTier(410, 26.2, null, 405)).toBe('advanced');
  });

  it('experience moves the composed weekly peak (soft-goal marathon)', () => {
    const soft = (lvl: string) => buildSimPlan({ ...base, goalMode: 'goal', distance: 'marathon', planWeeks: 18,
      goalTimeSec: 15600, experienceLevel: lvl, weeklyMileageBucket: 35, longestRunBucket: '10+' });
    // advanced clamps UP from the developing pace-tier → a higher weekly peak than a beginner.
    expect(peakWk(soft('advanced'))).toBeGreaterThan(peakWk(soft('beginner')) + 5);
  });
});
