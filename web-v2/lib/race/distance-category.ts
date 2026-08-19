/**
 * lib/race/distance-category.ts · THE race-distance categorizer.
 *
 * 2026-08-18 · distance-categorizer unification. The app carried THREE
 * incompatible answers to "what kind of race is this?", so the same race was
 * two different events depending on which module asked:
 *
 *   | boundary | plan/goal-tiers | race/distance-doctrine | plan/gap-report |
 *   |----------|-----------------|------------------------|-----------------|
 *   | 5k       | ≤ 4             | ≤ 4.4                  | ≤ 3.5           |
 *   | 10k      | ≤ 8             | ≤ 8.0                  | ≤ 7             |
 *   | hm       | ≤ 17            | ≤ 15.0                 | ≤ 14            |
 *   | m        | ≤ 30            | ≤ 30.0                 | else            |
 *   | ultra    | > 30            | > 30                   | ABSENT          |
 *   | null     | n/a             | 'hm'                   | n/a             |
 *
 * What that shipped:
 *
 *   · a 15-16 mile race trained as a half (2-week taper, HM tier bands,
 *     racePaceTag 'HM') and raced as a marathon (marathon warm-up, marathon
 *     carb load, marathon HR ceiling). The training plan and the race-day
 *     execution plan disagreed about the event.
 *   · a 4.2-mile race was a 10K to the plan engine and a 5K to race doctrine.
 *   · an ultra fell through to the marathon's renegotiation window.
 *   · `raceDistanceCategory(null)` returned 'hm' — a distance-unknown race got
 *     the half's HR ceiling, warm-up, carb load and caffeine schedule, in a
 *     codebase whose own parser (lib/race/distance.ts) says "callers must treat
 *     null as no distance, never default it".
 *   · `Number(null) === 0` and `distanceCategoryOf(0)` returned '5k', so a
 *     marathoner on a legacy race row with no numeric distance got a 10-week
 *     build window instead of 18.
 *
 * ── The boundaries ────────────────────────────────────────────────────────
 *
 * Doctrine publishes ROWS, not boundaries. Research/ tables are keyed to the
 * named race distances (Research/02 §5.1: 1500m · 5K · 10K · 15K · 10mi · Half
 * · Marathon; Research/08 §10.1 adds `Ultra (50K+)`). Nothing in Research/
 * states where one row stops applying and the next begins. Two things doctrine
 * DOES state, and both are bound by claims in lib/doctrine/registry.ts:
 *
 *   1. THE THRESHOLD CLASS STARTS AT 15K. Research/01 §"Pace conversion from a
 *      race time" defines T as "~half-marathon pace to 15K pace (faster runners
 *      use HM, slower runners use 15K)" — the 15K and the half are one
 *      LT-anchored class, and the 10K is not in it (§I is "~3K to 5K race
 *      pace"). So a 15K and a 10-miler are half-marathon-class races, and the
 *      10k|hm boundary sits between the 10K and the 15K.
 *      → claim DISTANCE.threshold-class-floor
 *
 *   2. THE ULTRA STARTS AT 50K. Research/08 §10.1 labels its longest row
 *      `Ultra (50K+)` and §9.1 labels it `Ultra (50K-100M)`; Research/00a's
 *      volume table starts the ultra ladder at `50K`. The row names its own
 *      floor, so the m|ultra boundary is 50 km (31.07 mi on the codebase's
 *      canonical rounding), not the 30 the two old categorizers used.
 *      → claim DISTANCE.ultra-floor
 *
 * Everywhere else doctrine is silent and this module states a CONVENTION:
 * **a boundary sits at the arithmetic midpoint of the two named doctrine race
 * distances that flank it.** It is the only rule that needs no judgment call
 * per boundary, it puts every named distance comfortably inside its own row,
 * and it is checkable against the doc rather than against itself — the claim
 * DISTANCE.category-boundaries reads Research/02 §5.1's own header row, maps
 * each named distance through the canonical label parser, and asserts every
 * boundary equals the midpoint of the pair that straddles it.
 *
 *   5k  | 10k   (3.1 + 6.2)  / 2 = 4.65   convention
 *   10k | hm    (6.2 + 9.3)  / 2 = 7.75   convention, over a doctrine-fixed pair
 *   hm  | m     (13.1 + 26.2)/ 2 = 19.65  convention
 *   m   | ultra 50 km              31.07  DOCTRINE (Research/08 §10.1)
 *
 * Upper bounds are EXCLUSIVE throughout, so each named distance lands in the
 * row doctrine wrote for it and 50K itself is an ultra.
 *
 * ── Unknown distance ──────────────────────────────────────────────────────
 *
 * `distanceCategoryOrNull` returns null for a missing, non-finite or
 * non-positive distance. It never guesses. The precedent is generate.ts, which
 * refuses outright — "race distance unrecognized; cannot build a plan for an
 * unknown distance" — rather than composing a plan for the wrong event.
 * Callers propagate the null and prescribe nothing distance-keyed; they do not
 * substitute a row.
 *
 * Pure: no DB, no Date.now(), no I/O, no imports.
 */

/** The five doctrine rows every per-distance table is keyed to. */
export type DistanceCategory = '5k' | '10k' | 'hm' | 'm' | 'ultra';

/** Every category, shortest first. Tests and the categorizer both iterate this. */
export const DISTANCE_CATEGORIES: readonly DistanceCategory[] =
  ['5k', '10k', 'hm', 'm', 'ultra'] as const;

/**
 * Upper bound of each category in miles, EXCLUSIVE.
 *
 * See the header for where each number comes from. Bound by
 * DISTANCE.category-boundaries, DISTANCE.threshold-class-floor and
 * DISTANCE.ultra-floor in lib/doctrine/registry.ts, all three of which parse
 * the flanking distances out of the Research/ docs at run time.
 */
export const DISTANCE_CATEGORY_MAX_MI: Readonly<Record<DistanceCategory, number>> = {
  // (5K 3.1 + 10K 6.2) / 2 · convention, doctrine states no boundary
  '5k': 4.65,
  // (10K 6.2 + 15K 9.3) / 2 · the 15K is the shortest LT-anchored race in
  // Research/01 §"Pace conversion from a race time", so the threshold class
  // starts above the 10K and the midpoint convention places the line
  '10k': 7.75,
  // (Half 13.1 + Marathon 26.2) / 2 · convention, doctrine states no boundary
  'hm': 19.65,
  // 50 km · DOCTRINE. Research/08 §10.1 `Ultra (50K+)` names the ultra's floor
  'm': 31.07,
  'ultra': Infinity,
};

/**
 * What every caller must say instead of guessing, when the distance is unknown.
 * Worded to match the existing refusal in lib/plan/generate.ts.
 */
export const UNKNOWN_DISTANCE_REASON =
  'race distance unrecognized; cannot build a plan for an unknown distance';

/**
 * THE categorizer. Null when the distance is missing, non-finite or
 * non-positive — never a default row.
 */
export function distanceCategoryOrNull(
  distanceMi: number | null | undefined,
): DistanceCategory | null {
  if (distanceMi == null || !Number.isFinite(distanceMi) || distanceMi <= 0) return null;
  for (const cat of DISTANCE_CATEGORIES) {
    if (distanceMi < DISTANCE_CATEGORY_MAX_MI[cat]) return cat;
  }
  // Unreachable · the last bound is Infinity.
  return 'ultra';
}

/**
 * The same answer for code that has already established the distance is real.
 * Throws rather than returning a row it cannot justify — a loud failure at the
 * one call site that skipped its guard beats a silent half-marathon plan.
 */
export function distanceCategoryOrThrow(distanceMi: number): DistanceCategory {
  const cat = distanceCategoryOrNull(distanceMi);
  if (cat == null) {
    throw new Error(
      `distanceCategory: ${UNKNOWN_DISTANCE_REASON} (got ${String(distanceMi)}). ` +
        'Guard the call site with distanceCategoryOrNull and handle the unknown case.',
    );
  }
  return cat;
}
