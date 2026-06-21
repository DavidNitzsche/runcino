// Plan-template catalog — the coach-designed STRUCTURE per (distance × level),
// encoded from Research/22-plan-templates.md (Higdon, Pfitzinger, Daniels,
// Hansons, Galloway, Koop, Mayo, C25K). This is the source of truth for what a
// plan should look like, replacing the one-size periodization that shrank a
// competitive-runner plan for every runner (caught 2026-06-20: a 5mi/wk
// beginner was getting 5×800m intervals from week 1, which no coach prescribes).
//
// The generator reads `qualityCharacter` to decide what KIND of hard work a
// runner does, and `longRunEasy` / `speedworkEntryFrac` to shape the build.
// Numbers (peak volume, peak long, paces) still come from the runner's own
// fitness + goal-tiers + VDOT — the template governs STRUCTURE, the engine
// governs personalisation. Exactly the research's directive: "the coach scales
// mileage to user fitness, swaps pace zones to user VDOT, and shifts rest days
// to user schedule."
//
// PROTECTION: intermediate / advanced / advanced_plus templates describe the
// EXISTING engine behaviour (it was built from this same research), so the
// generator only changes structure for `beginner`. David's advanced plan is
// untouched by construction.

import type { DistCategory } from './goal-tiers';

export type PlanLevel = 'beginner' | 'intermediate' | 'advanced' | 'advanced_plus';

/** What kind of quality work the runner does — the load-bearing structural knob.
 *  · base_building : E runs + strides + LIGHT fartlek only; speedwork is a few
 *                    short surges, never structured I/R reps. Beginner doctrine.
 *  · tempo_threshold : adds continuous T tempo + cruise intervals + light I.
 *  · full_periodized : R + I + T + race-pace work, the Daniels/Pfitz machine. */
export type QualityCharacter = 'base_building' | 'tempo_threshold' | 'full_periodized';

export interface PlanTemplate {
  distance: DistCategory;
  level: PlanLevel;
  /** Typical plan length (weeks) from the research. */
  durationWeeks: [number, number];
  daysPerWeek: [number, number];
  peakWeeklyMi: [number, number];
  peakLongMi: [number, number];
  /** The structural knob the generator branches on. */
  qualityCharacter: QualityCharacter;
  /** Long run is a steady EASY progression (true) vs carries M/T race-pace
   *  inserts (false, advanced HM/marathon). */
  longRunEasy: boolean;
  /** When real speedwork enters, as a fraction of the plan (0 = week 1). A
   *  beginner sharpens late (~0.65 → only the last third); an advanced runner
   *  runs quality almost from the start (~0.15). */
  speedworkEntryFrac: number;
  /** The actual key-workout vocabulary for this runner, verbatim-ish from the
   *  research sample weeks. Used for the quality-day prescription. */
  keyWorkouts: string;
  source: string;
}

const T = (
  distance: DistCategory, level: PlanLevel, durationWeeks: [number, number],
  daysPerWeek: [number, number], peakWeeklyMi: [number, number], peakLongMi: [number, number],
  qualityCharacter: QualityCharacter, longRunEasy: boolean, speedworkEntryFrac: number,
  keyWorkouts: string, source: string,
): PlanTemplate => ({
  distance, level, durationWeeks, daysPerWeek, peakWeeklyMi, peakLongMi,
  qualityCharacter, longRunEasy, speedworkEntryFrac, keyWorkouts, source,
});

// distance categories used by the engine: '5k' | '10k' | 'hm' | 'm' | 'ultra'
export const PLAN_TEMPLATES: PlanTemplate[] = [
  // ── 5K ──────────────────────────────────────────────────────────────
  T('5k', 'beginner',      [8, 8],   [3, 4], [12, 15], [3.5, 4],  'base_building',   true,  0.65,
    'E runs, strides, light fartlek (4×1 min @ T effort), 5K time-trial wk 6', 'Higdon Novice / Mayo 7-week'),
  T('5k', 'intermediate',  [8, 10],  [4, 5], [25, 30], [6, 7],    'tempo_threshold', true,  0.30,
    'T tempo 15-25 min, I reps 400-1200m, R 200s, hill repeats', 'Higdon Intermediate / Daniels'),
  T('5k', 'advanced',      [12, 18], [6, 7], [40, 70], [8, 12],   'full_periodized', false, 0.15,
    'R reps 200-400m, I reps 1000-1200m @ 5K, cruise T, hill sprints', 'Daniels Phases II-IV'),
  T('5k', 'advanced_plus', [12, 18], [6, 7], [50, 80], [10, 14],  'full_periodized', false, 0.10,
    'R reps, I reps @ 5K, cruise T, hill sprints, doubles', 'Daniels elite'),

  // ── 10K ─────────────────────────────────────────────────────────────
  T('10k', 'beginner',      [10, 10], [3, 4], [18, 22], [6, 7],   'base_building',   true,  0.60,
    'E runs, strides, fartlek 1min on/off, light hills', 'step-up from 5K'),
  T('10k', 'intermediate',  [12, 12], [5, 5], [30, 40], [9, 10],  'tempo_threshold', true,  0.30,
    'T tempo 20-30 min, I reps @ 10K-5K, progression LR', 'RunnersConnect / Hudson'),
  T('10k', 'advanced',      [12, 18], [6, 7], [50, 75], [13, 15], 'full_periodized', false, 0.15,
    'I reps 1200-1600m, T cruise 3-5×1mi, race-pace sim, strides', 'Daniels / Pfitz FRR'),
  T('10k', 'advanced_plus', [12, 18], [6, 7], [60, 90], [14, 17], 'full_periodized', false, 0.10,
    'I reps, T cruise, race-pace sim, hill sprints, doubles', 'Pfitz FRR elite'),

  // ── Half marathon ───────────────────────────────────────────────────
  T('hm', 'beginner',      [12, 12], [3, 4], [22, 28], [10, 12],  'base_building',   true,  0.70,
    'E runs, strides, optional light tempo 10-15 min', 'Higdon Novice 1/2'),
  T('hm', 'intermediate',  [12, 12], [5, 5], [35, 45], [12, 14],  'tempo_threshold', false, 0.30,
    'T tempo 4-7mi, MLR w/ M segments, I 1000-1600m, race-pace LR', 'Higdon Int / Pfitz 12/47'),
  T('hm', 'advanced',      [12, 12], [6, 7], [55, 85], [15, 17],  'full_periodized', false, 0.20,
    'LT 5-8mi, MLR w/ HMP-MP, I reps, tune-up race', 'Pfitz 12/63-12/84'),
  T('hm', 'advanced_plus', [12, 12], [6, 7], [70, 95], [16, 18],  'full_periodized', false, 0.15,
    'LT, MLR w/ HMP, I reps, tune-up race, doubles', 'Pfitz elite'),

  // ── Marathon ────────────────────────────────────────────────────────
  T('m', 'beginner',      [18, 18], [3, 4], [30, 35], [20, 20],   'base_building',   true,  0.75,
    'E runs, strides, optional MP segments in some long runs', 'Higdon Novice 1'),
  T('m', 'intermediate',  [18, 18], [5, 6], [45, 55], [20, 22],   'tempo_threshold', false, 0.30,
    'LT 4-7mi @ T, MP runs 8-14mi, MLR 11-15mi, VO2 3-5×1000-1600m', 'Higdon Int / Pfitz 18/55'),
  T('m', 'advanced',      [18, 18], [6, 7], [65, 90], [22, 24],   'full_periodized', false, 0.20,
    'LT 6-8mi @ T, GMP-LR 18-22mi w/ 12-16 @ M, VO2, MLR, tune-up half', 'Pfitz 18/70-18/85'),
  T('m', 'advanced_plus', [18, 18], [7, 7], [85, 110], [22, 24],  'full_periodized', false, 0.15,
    'Advanced marathon w/ PM doubles on E + quality days', 'Pfitz 18/85-100+'),

  // ── Ultra (50K → 100mi) · all levels build aerobically; B2B long runs ─
  T('ultra', 'beginner',      [16, 16], [4, 5], [30, 50], [22, 25], 'base_building',   true, 0.60,
    'E/GA, hill repeats, MLR, back-to-back weekend long runs, race terrain', 'Higdon 50K / MOTTIV'),
  T('ultra', 'intermediate',  [20, 20], [5, 6], [50, 75], [28, 32], 'base_building',   true, 0.50,
    'E volume, hill power, T efforts 20-40min, B2B long runs, terrain', 'Koop-CTS / INOV-8'),
  T('ultra', 'advanced',      [22, 24], [5, 6], [60, 90], [32, 40], 'tempo_threshold', true, 0.40,
    'High aerobic volume, hills, T efforts, B2Bs w/ race elevation', '50mi→100K structures'),
  T('ultra', 'advanced_plus', [24, 28], [5, 6], [70, 100], [35, 40], 'tempo_threshold', true, 0.35,
    'Massive aerobic volume, hill power, T early, mega B2Bs', '100mi structures'),
];

const NORM_LEVEL = (l: string | null | undefined): PlanLevel =>
  (l === 'beginner' || l === 'intermediate' || l === 'advanced' || l === 'advanced_plus') ? l : 'intermediate';

/** The template for a runner's distance + level. Defaults level → intermediate
 *  when unknown (matches the engine's historical default, so a null-experience
 *  runner is unchanged). */
export function templateFor(distance: DistCategory, level: string | null | undefined): PlanTemplate {
  const lvl = NORM_LEVEL(level);
  const exact = PLAN_TEMPLATES.find((t) => t.distance === distance && t.level === lvl);
  if (exact) return exact;
  // distance miss (shouldn't happen) → nearest by category, intermediate
  return PLAN_TEMPLATES.find((t) => t.distance === distance && t.level === 'intermediate')
    ?? PLAN_TEMPLATES.find((t) => t.distance === 'm' && t.level === lvl)!;
}

/** True when this runner's plan should be base-building structure (E + strides +
 *  light fartlek, progressive easy long, late speedwork) rather than the
 *  periodized I/T/R machine. The single behavioural gate — only `beginner`
 *  flips it, so intermediate/advanced (incl. David) are unchanged. */
export function isBaseBuildingPlan(distance: DistCategory, level: string | null | undefined): boolean {
  return templateFor(distance, level).qualityCharacter === 'base_building';
}
