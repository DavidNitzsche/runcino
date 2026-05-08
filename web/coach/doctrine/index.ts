/**
 * Doctrine barrel — re-exports the cite helper + every topic file.
 *
 * Pattern (see intensity.ts for the canonical example):
 *
 *   export const POLARIZED_DISTRIBUTION: Cited<IntensityDistribution> = {
 *     value: { easyPct: 80, thresholdPct: 5, hardPct: 15 },
 *     citations: [cite('§3.1', 'roughly 80 percent easy …')],
 *   };
 *
 * Consumers can import either by-topic (`import { POLARIZED_DISTRIBUTION }
 * from '@/coach/doctrine'`) or by-file (`import * as Intensity from
 * '@/coach/doctrine/intensity'`).
 *
 * Topic files import the cite helper FROM './cite' directly (not from
 * this barrel) to avoid a TDZ regression under Turbopack production
 * bundling — see cite.ts header for details.
 */

export { cite, type Cited, type ResearchDocId } from './cite';

// ── Topic barrels ────────────────────────────────────────────────────
export * from './intensity';
export * from './volume';
export * from './workouts';
export * from './strength';
export * from './fueling';
export * from './recovery';
export * from './shoes';
export * from './cadence';
export * from './heat';
export * from './masters';
export * from './load';
export * from './taper';
export * from './post_race';
export * from './pace_zones';
export * from './hr_zones';
export * from './race_prediction';
export * from './weather';
export * from './pacing';
export * from './race_week';
export * from './injury_return';
export * from './recovery_protocols';
export * from './plan_templates';
export * from './plan_integrity';
export * from './hydration';
export * from './cross_training';
export * from './mental';
export * from './sex';
export * from './course';
export * from './mobility';
export * from './wearables';
export * from './age';
export * from './travel';
export * from './grading';
