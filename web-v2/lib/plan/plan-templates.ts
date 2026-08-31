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

  // ── Ultra (50K → 100mi) · UNREACHABLE · authorship removed 2026-08-19 ──
  //
  // ULTRA-OUT-1 · these four rows are keyed by EXPERIENCE, and every field in
  // them was lifted from a different ultra DISTANCE in Research/22: 'beginner'
  // is its 50K row, 'intermediate' its 50 Mile, 'advanced' its 100K,
  // 'advanced_plus' its 100 Mile. Every number matches exactly. So the axis is
  // wrong, not the values — a first-time 100-miler is graded "beginner" and
  // handed a 50K plan, and a seasoned 50K runner is graded "advanced" and
  // handed a 100K. No amount of retuning fixes that; the table needs a distance
  // dimension the engine does not have.
  //
  // The owner's call was to take ultra out rather than build that dimension
  // now: "lets remove ultra plans and training for now". `planAuthorshipUnsupported`
  // (supported-distances.ts) refuses before anything reaches here, on the race
  // path, the no-race goal path and the simulator alike, so these rows are dead
  // and the mislabel cannot reach a runner.
  //
  // KEPT, NOT DELETED, and kept wrong on purpose. Re-opening ultra means giving
  // this table its missing axis, and the rows are the evidence of what that axis
  // has to be. Deleting them would leave the next reader to rediscover the
  // Research/22 mapping from scratch. Nothing here is doctrine — Research/22 is
  // untouched and is the source either way.
  T('ultra', 'beginner',      [16, 16], [4, 5], [30, 50], [22, 25], 'base_building',   true, 0.60,
    'E/GA, hill repeats, MLR, back-to-back weekend long runs, race terrain', 'Higdon 50K / MOTTIV'),
  T('ultra', 'intermediate',  [20, 20], [5, 6], [50, 75], [28, 32], 'base_building',   true, 0.50,
    'E volume, hill power, T efforts 20-40min, B2B long runs, terrain', 'Koop-CTS / INOV-8'),
  T('ultra', 'advanced',      [22, 24], [5, 6], [60, 90], [32, 40], 'tempo_threshold', true, 0.40,
    'High aerobic volume, hills, T efforts, B2Bs w/ race elevation', '50mi→100K structures'),
  T('ultra', 'advanced_plus', [24, 28], [5, 6], [70, 100], [35, 40], 'tempo_threshold', true, 0.35,
    'Massive aerobic volume, hill power, T early, mega B2Bs', '100mi structures'),
];

const EXPLICIT_LEVEL = (l: string | null | undefined): PlanLevel | null =>
  (l === 'beginner' || l === 'intermediate' || l === 'advanced' || l === 'advanced_plus') ? l : null;

/**
 * LOWVOL-2 (2026-08-19) · the template level an UNSTATED experience earns.
 *
 * `profile.experience_level` is NULL on real production accounts, and this
 * function used to answer `'intermediate'` for every one of them — including a
 * runner whose whole WEEK is smaller than the PEAK week of doctrine's beginner
 * plan for their distance. `Research/22` §"5K — Beginner" peaks at 12-15 mi/wk;
 * a 5-10 mi/wk runner was routed into the periodized interval machine that
 * §"5K — Intermediate" describes, and `classifyGoalTier`'s COLD-1 clamp did not
 * help because it caps the TIER, never the TEMPLATE.
 *
 * The rule is deliberately one-sided and deliberately conservative. Volume can
 * only ever demote an unstated level, never promote it — a big week is not a
 * demonstration of anything (that is COLD-1's whole argument) whereas a week
 * below the beginner peak is a hard fact about what the runner can absorb. And
 * the threshold is the beginner row's own peak FLOOR read out of the table, so
 * a runner sitting anywhere inside doctrine's beginner band keeps the
 * intermediate default exactly as before: it fires only BELOW the band.
 */
function unstatedLevelFor(distance: DistCategory, weeklyMi: number | null | undefined): PlanLevel {
  if (weeklyMi == null || !(weeklyMi > 0)) return 'intermediate';
  const beginnerPeakFloor = PLAN_TEMPLATES
    .find((t) => t.distance === distance && t.level === 'beginner')?.peakWeeklyMi[0];
  if (beginnerPeakFloor == null) return 'intermediate';
  return weeklyMi < beginnerPeakFloor ? 'beginner' : 'intermediate';
}

/** The template for a runner's distance + level. A stated level always wins.
 *  When the level is unknown, `weeklyMi` (the runner's recent weekly volume)
 *  demotes to `beginner` only if that volume is below doctrine's beginner peak
 *  band for the distance; omit it, or pass 0, and the historical intermediate
 *  default stands. */
export function templateFor(
  distance: DistCategory,
  level: string | null | undefined,
  weeklyMi?: number | null,
): PlanTemplate {
  const lvl = EXPLICIT_LEVEL(level) ?? unstatedLevelFor(distance, weeklyMi);
  const exact = PLAN_TEMPLATES.find((t) => t.distance === distance && t.level === lvl);
  if (exact) return exact;
  // distance miss (shouldn't happen) → nearest by category, intermediate
  return PLAN_TEMPLATES.find((t) => t.distance === distance && t.level === 'intermediate')
    ?? PLAN_TEMPLATES.find((t) => t.distance === 'm' && t.level === lvl)!;
}

/** True when this runner's plan should be base-building structure (E + strides +
 *  light fartlek, progressive easy long, late speedwork) rather than the
 *  periodized I/T/R machine. The behavioural gate — `beginner` flips it, so a
 *  stated intermediate/advanced (incl. David) is unchanged; an UNSTATED level
 *  flips it only below doctrine's beginner peak band (see `unstatedLevelFor`). */
export function isBaseBuildingPlan(
  distance: DistCategory,
  level: string | null | undefined,
  weeklyMi?: number | null,
): boolean {
  return templateFor(distance, level, weeklyMi).qualityCharacter === 'base_building';
}


/* ─────────────────────────────────────────────────────────────────────────────
 * RECOVERY-AFTER-LONG-1 (2026-08-30) · the day after the long run has a
 * doctrine-published SIZE, and it is per-tier.
 *
 * ── WHY THIS TABLE EXISTS ───────────────────────────────────────────────────
 *
 * RULE12-VARY-1 sized this day by capping it into `Research/00a` §1's RECOVERY
 * band (20-45 min). That is the generic band for "a recovery run", and it is
 * the wrong authority here, because `Research/22` publishes a SPECIFIC cell for
 * this specific day in each tier's sample week. At the owner's 9:38/mi easy
 * pace §1's ceiling is 4.67 mi, which floored to 4.5 — while his own tier's row
 * says six, and his own training says six (day-after-long distances across the
 * build: 6.7, 6.0, 6.2, 5.1, 6.0, 6.0, 8.1, 6.0, 9.1 · median 6.0; the only
 * 4-mile instances are all inside his post-AFC taper and recovery window, which
 * Rule 8 says is precisely the data not to characterise him with).
 *
 * Six miles at 9:38 is 58 minutes, which is `Research/00a` §2's GENERAL AEROBIC
 * band (40-75 min), not §1's. So the day is not a §1 run for this runner at all
 * — the generic band was answering a question doctrine had already answered
 * more precisely.
 *
 * This is Rule 7's lint shape: a category reaching for a generic value when
 * doctrine publishes a specific one. It shipped because the instruction to
 * "make the day after the long run shorter" was given from intuition without
 * checking what the number was, and the code implemented it faithfully.
 *
 * ── WHY IT IS PER-TIER, AND WHY MOST ENTRIES ARE ABSENT ─────────────────────
 *
 * `Research/22`'s Marathon sample weeks do not agree with each other, and they
 * should not: Advanced reads "Rest or 6 mi recovery", Intermediate reads
 * "Rest", Beginner reads "XT or rest". Only the advanced row publishes a
 * distance. An absent entry is not "unknown" — it is doctrine declining to
 * prescribe a run on that day, and the caller keeps §1's behaviour, which is
 * the right answer for a runner whose own row says rest.
 *
 * Populated only where the sample week's long run is on SUNDAY, so that the
 * Monday cell genuinely is the day after it. Rows whose long run falls
 * elsewhere are omitted rather than guessed.
 * `TEMPLATE.recovery-day-after-long-matches-doctrine` parses each cell out of
 * the doc at run time and fails if this table drifts from it.
 * ────────────────────────────────────────────────────────────────────────── */
export const RECOVERY_DAY_AFTER_LONG_MI: Readonly<
  Partial<Record<DistCategory, Partial<Record<PlanLevel, number>>>>
> = {
  // "| Rest or 6 mi recovery | ... | 22 mi LR w/ last 14 @ M |"
  m: { advanced: 6, advanced_plus: 6 },
  // "| Rest or 5 mi recovery | ... | 16 mi LR w/ last 8 mi @ HMP |"
  hm: { advanced: 5, advanced_plus: 5 },
};

/**
 * The doctrine-published distance for the day after the long run, or null when
 * the tier's own row prescribes rest (or when the row's long run is not on the
 * day before, so the cell would not be describing this day).
 */
export function recoveryDayAfterLongMi(
  cat: DistCategory,
  level: PlanLevel | null | undefined,
): number | null {
  if (!level) return null;
  return RECOVERY_DAY_AFTER_LONG_MI[cat]?.[level] ?? null;
}
