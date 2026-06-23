/**
 * VAR-01 regression guard (third deep audit, 2026-06-23).
 *
 * experienceLevel must CLAMP the pace-derived tier (Research/22 has distinct per-experience
 * templates). Before the fix, classifyGoalTier ignored level entirely (arity 2) — a beginner,
 * intermediate, and advanced runner with the same goal pace got byte-identical plans.
 *
 * Clamp: advanced(+) never below advanced; beginner never above intermediate.
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
    expect(classifyGoalTier(410, 26.2, 'beginner')).toBe('intermediate');
    expect(classifyGoalTier(410, 26.2, 'advanced')).toBe('advanced');
    // Soft marathon goal (~4:20 → developing by pace); an advanced runner keeps advanced capacity.
    expect(classifyGoalTier(595, 26.2, 'advanced')).toBe('advanced');
    expect(classifyGoalTier(595, 26.2, 'beginner')).toBe('developing');
    expect(classifyGoalTier(595, 26.2, 'intermediate')).toBe('developing');
    // No goal → defaults off experience, not a hardcoded intermediate.
    expect(classifyGoalTier(null, 26.2, 'beginner')).toBe('developing');
    expect(classifyGoalTier(null, 26.2, 'advanced')).toBe('advanced');
    // No level → unchanged legacy behavior (pace-only).
    expect(classifyGoalTier(410, 26.2)).toBe('advanced');
    expect(classifyGoalTier(null, 26.2)).toBe('intermediate');
  });

  it('experience moves the composed weekly peak (soft-goal marathon)', () => {
    const soft = (lvl: string) => buildSimPlan({ ...base, goalMode: 'goal', distance: 'marathon', planWeeks: 18,
      goalTimeSec: 15600, experienceLevel: lvl, weeklyMileageBucket: 35, longestRunBucket: '10+' });
    // advanced clamps UP from the developing pace-tier → a higher weekly peak than a beginner.
    expect(peakWk(soft('advanced'))).toBeGreaterThan(peakWk(soft('beginner')) + 5);
  });
});
