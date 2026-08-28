/**
 * sim-matrix.ts · THE all-user archetype matrix (extracted 2026-08-28).
 *
 * This generator IS the sweep's corpus — every meaningful user archetype
 * across the full onboarding input matrix, plus the targeted arcs
 * (available-days geometry, elite tiers, PR-seeded paces) that cover the
 * rungs the cross-product alone never instantiates.
 *
 * Extracted verbatim from `_sweep_allusers.test.ts` so a second gate can
 * drive the SAME corpus without importing a test file (vitest would register
 * its describes twice) and without a copy that drifts. The sweep imports it
 * back; the two files grade different things over one matrix:
 *
 *   · `_sweep_allusers.test.ts` — research conformance (bands, ramps,
 *     validator, structure).
 *   · `_dosing_sweep_gate.test.ts` — Daniels' dosing caps (Research/01
 *     §"Dosing rules — Daniels' caps"), the measurement the owner's
 *     "measure, then enforce if clean" ruling asked for, kept as a gate.
 *
 * Do not add arcs here casually: every consumer sweeps the whole generator,
 * so a new arc is a new obligation on every gate at once. That is the point.
 */
import type { SimDistance } from './sim-constants';

export const DISTANCES: SimDistance[] = ['5k', '10k', 'half', 'marathon', '50k', '100k'];
// COLD-1 (2026-08-17) · `null` IS the production state — `profile.experience_level` is
// NULL on real accounts and the sweep could not see it, so the rung where a typed goal
// time picked the tier by itself was never graded. Keep it first: it is the default a
// new signup lands on.
export const EXPERIENCE = [null, 'beginner', 'intermediate', 'advanced', 'advanced_plus'];
export const FREQ = [3, 4, 5, 6];
// CC2-2 (2026-06-23) · bucket 0 = true-zero base. The refuse-vs-plan boundary (where BRK-2/CC2-1 live)
// was untested — lowest fed was recentWeeklyMiFromBucket(5)=10. Split-graded in grade().
export const MILEAGE = [0, 5, 15, 25, 35, 45];
export const LONGEST = ['0-3', '3-6', '6-10', '10+'];
// representative goal times that, with the experience clamp, exercise tiers
export const GOAL_SEC: Record<SimDistance, number> = { '5k': 1350, '10k': 2700, half: 6300, marathon: 13500, '50k': 18000, '100k': 43200 };
export const WEEKS: Record<SimDistance, number> = { '5k': 10, '10k': 12, half: 14, marathon: 18, '50k': 22, '100k': 24 };

export const catOf: Record<SimDistance, '5k' | '10k' | 'hm' | 'm' | 'ultra'> = { '5k': '5k', '10k': '10k', half: 'hm', marathon: 'm', '50k': 'ultra', '100k': 'ultra' };
export const isUltra = (d: SimDistance) => catOf[d] === 'ultra';

export type Arc = { goalMode: 'goal' | 'justRun' | 'race'; distance: SimDistance; experienceLevel: string | null; weeklyFrequency: number; weeklyMileageBucket: number; longestRunBucket: string; goalTimeSec: number | null; planWeeks: number; raceDateISO?: string; availableDays?: string[]; bestRecentVdotOverride?: number };

export function* matrix(): Generator<Arc> {
  for (const distance of DISTANCES)
    for (const experienceLevel of EXPERIENCE)
      for (const weeklyFrequency of FREQ)
        for (const weeklyMileageBucket of MILEAGE)
          for (const longestRunBucket of LONGEST) {
            const common = { distance, experienceLevel, weeklyFrequency, weeklyMileageBucket, longestRunBucket };
            // goal mode (race-prep) — with a goal time and by-feel
            for (const goal of [GOAL_SEC[distance], null])
              yield { ...common, goalMode: 'goal', goalTimeSec: goal, planWeeks: WEEKS[distance] };
            // just-run (maintenance / consistency block)
            yield { ...common, goalMode: 'justRun', goalTimeSec: null, planWeeks: 0 };
            // far-out race (≥26 weeks → maintenance until the build window opens)
            yield { ...common, goalMode: 'race', goalTimeSec: GOAL_SEC[distance], planWeeks: 0, raceDateISO: '2027-03-01' };
          }
  // GOAL-1 · available_days geometry (the scheduler↔validator dead-end that left a saved goal with
  // NO plan). Purely geometric, so a reduced cross over distance × constraining set × freq suffices:
  // adjacent pairs (NOQ-mode fold), tight pairs (GAP-mode downgrade), weekday-only, full-week.
  const AVAIL_SETS = [['sat', 'sun'], ['mon', 'fri'], ['sun', 'fri'], ['tue', 'thu', 'sat'], ['mon', 'tue', 'wed', 'thu', 'fri']];
  for (const distance of DISTANCES)
    for (const availableDays of AVAIL_SETS)
      for (const weeklyFrequency of [3, 5])
        yield { goalMode: 'goal', distance, experienceLevel: 'intermediate', weeklyFrequency, weeklyMileageBucket: 25, longestRunBucket: '6-10', goalTimeSec: GOAL_SEC[distance], planWeeks: WEEKS[distance], availableDays };
  // CC-5 · elite-tier coverage — the 5 elite (cat,tier) rows are otherwise never instantiated (a single
  // moderate GOAL_SEC + by-feel only reaches intermediate/advanced). Elite goal × advanced experience
  // (so the clamp doesn't fight) × high mileage so the band is reachable.
  const ELITE_GOAL: Record<SimDistance, number> = { '5k': 1000, '10k': 2050, half: 4650, marathon: 9300, '50k': 16200, '100k': 39000 };
  for (const distance of DISTANCES)
    yield { goalMode: 'goal', distance, experienceLevel: 'advanced', weeklyFrequency: 6, weeklyMileageBucket: 45, longestRunBucket: '10+', goalTimeSec: ELITE_GOAL[distance], planWeeks: WEEKS[distance] };
  // CC-4 · PR-seeded pace path (bestRecentVdotOverride) — the matrix otherwise always passes the empty
  // raceHistory, so the fitness-anchored pace path ships ungraded. A slow + a fast fitness signal: a
  // fast PR on a low base must not push peak above the safe ramp, and paces must stay sane.
  for (const distance of DISTANCES)
    for (const bestRecentVdotOverride of [38, 55])
      yield { goalMode: 'goal', distance, experienceLevel: 'intermediate', weeklyFrequency: 5, weeklyMileageBucket: 25, longestRunBucket: '6-10', goalTimeSec: GOAL_SEC[distance], planWeeks: WEEKS[distance], bestRecentVdotOverride };
}

export const arcStr = (a: Arc) => `${a.distance}/${a.experienceLevel}/f${a.weeklyFrequency}/m${a.weeklyMileageBucket}/L${a.longestRunBucket}/${a.goalTimeSec ? 'goal' : 'byfeel'}`;
