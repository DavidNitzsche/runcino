/**
 * lib/training/elevation-model.ts · THE elevation doctrine, once.
 *
 * Sibling of lib/training/heat-model.ts and built for the same reason: one
 * doctrinal quantum, one implementation. Before 2026-08-17 the app priced
 * terrain three different ways and they did not agree:
 *
 *   · lib/race/pacing.ts        1 + 0.033 per 1% grade — correct, cited to
 *                               Research/11 "Energy cost rises ~3.3% per 1%
 *                               of grade", used for race-day splits.
 *   · lib/training/course-impact.ts  +10 s/mi per 100 ft/mi of NET climb,
 *                               −7 for net drop, +2 as a "gross fatigue
 *                               tax", times an invented goal-pace scaler.
 *                               Cited to "Daniels' Running Formula
 *                               §elevation correction", a section this repo
 *                               has no copy of.
 *   · a third reading of the same fact lived in the doctrine drawer copy.
 *
 * The two numeric models are 3-6× apart, and the LIGHT one is the one that
 * feeds the Targets projection — so the app systematically under-read hilly
 * goal races. Big Sur (2140 ft gross gain, +260 ft net, marathon at 6:51/mi)
 * was priced at 59 seconds of course cost. The cited model puts it at 308.
 *
 * ── The doctrine ──────────────────────────────────────────────────────────
 *
 * Research/11-course-specific-training.md, two passages:
 *
 *   §"Mechanical Effects of Uphill Running"
 *     "Energy cost rises ~3.3% per 1% of grade up to ~10–15%."
 *
 *   §"Pacing Rule for Hilly Courses"
 *     "On climbs:    add 10–30 s/mi to flat goal pace; keep effort steady."
 *     "On descents:  shave 5–15 s/mi BUT cap at goal pace minus 20 s/mi"
 *
 * The first gives the cost of climbing. The second gives the asymmetry: a
 * descent hands back about half of what the equivalent climb took (band
 * midpoints, 10 s/mi returned against 20 s/mi paid), and never more than
 * 15 s/mi on any single mile. Both are read out of the doc by the doctrine
 * gate rather than pinned here — see ELEVATION.* in lib/doctrine/registry.ts.
 *
 * ── Why the per-foot form is grade-free ───────────────────────────────────
 *
 * A mile at grade g% climbs 52.8·g feet and costs flatPace × 0.033·g extra
 * seconds. Divide: the cost per FOOT climbed is flatPace × 0.033/52.8, with
 * g cancelling out. So a course's climbing cost depends on how many feet it
 * climbs and not on how they are distributed — which is exactly what a
 * course-library row can tell us (gross gain, net change) and nothing more.
 * The relation holds inside doctrine's stated linear band; beyond ~10-15%
 * grade it under-reads, which no road course reaches on a mean-grade basis.
 */

/** Research/11 · fraction of pace added per 1% of uphill grade. */
export const GRADE_COST_PER_PCT = 0.033;

/** Research/11 · "up to ~10–15%" · the conservative end of the linear band. */
export const GRADE_LINEAR_LIMIT_PCT = 10;

/** Feet climbed per mile at 1% grade. 5280 / 100. Geometry, not doctrine. */
const FT_PER_MI_PER_GRADE_PCT = 52.8;

/**
 * Seconds added per foot climbed, per second of flat pace.
 * `GRADE_COST_PER_PCT / FT_PER_MI_PER_GRADE_PCT` — see the header for why
 * the grade cancels.
 */
export const CLIMB_COST_PER_FT_PER_PACE_S = GRADE_COST_PER_PCT / FT_PER_MI_PER_GRADE_PCT;

/**
 * Research/11 §"Pacing Rule for Hilly Courses" · the fraction of a climb's
 * cost that the matching descent hands back. Band midpoints: descents shave
 * 5-15 s/mi (10) against climbs adding 10-30 (20). Half.
 */
export const DESCENT_RECOVERY_FRACTION = 0.5;

/** Research/11 · "shave 5–15 s/mi" · most a single mile of descent may take. */
export const MAX_DESCENT_CREDIT_S_PER_MI = 15;

/** Research/11 · "cap at goal pace minus 20 s/mi" · the hard floor. */
export const DESCENT_HARD_CAP_S_PER_MI = 20;

/**
 * Even-effort pace multiplier for a sustained mean grade.
 *
 * Uphill: doctrine's energy cost, applied to pace, clamped to the band the
 * research states it holds over. Downhill: the same coefficient as a pace
 * credit, capped at the doctrine's per-mile ceiling — descending faster than
 * that buys time with quad damage you repay later (Research/11 §"Eccentric
 * Quad Loading and Late-Race Quad Failure").
 *
 * `flatPaceSPerMi` is needed only for the downhill cap, which doctrine
 * states in seconds rather than as a fraction.
 */
export function gradePaceMultiplier(gradePct: number, flatPaceSPerMi: number): number {
  if (!isFinite(gradePct) || gradePct === 0) return 1;
  if (gradePct > 0) {
    const g = Math.min(gradePct, GRADE_LINEAR_LIMIT_PCT);
    return 1 + GRADE_COST_PER_PCT * g;
  }
  if (!isFinite(flatPaceSPerMi) || flatPaceSPerMi <= 0) return 1;
  const credit = Math.min(
    GRADE_COST_PER_PCT * Math.abs(gradePct) * flatPaceSPerMi,
    MAX_DESCENT_CREDIT_S_PER_MI,
  );
  return (flatPaceSPerMi - credit) / flatPaceSPerMi;
}

export interface CourseElevationCostInput {
  /** Race distance, miles. */
  distanceMi: number;
  /** Flat-course pace the runner would hold, seconds per mile. */
  flatPaceSPerMi: number;
  /** Gross climbed feet across the course. Null when unknown. */
  gainFt: number | null | undefined;
  /**
   * Signed net elevation change, feet (finish − start). Positive = net climb.
   * Used with `gainFt` to derive gross loss; null falls back to a net-flat
   * course, which is the right default for the loop and out-and-back road
   * races that make up nearly every row in course_library.
   */
  netFt?: number | null;
}

/**
 * SIGNED seconds a course's elevation adds to a flat-course finish time.
 * Negative on a course that gives back more than it takes.
 *
 * This is the one function every elevation consumer calls. Callers that want
 * a floor at zero (the Targets doctrine drawer surfaces a net-downhill upside
 * in words rather than as a negative chunk) apply it themselves.
 */
export function courseElevationCostSec(input: CourseElevationCostInput): number | null {
  const { distanceMi, flatPaceSPerMi } = input;
  if (!isFinite(distanceMi) || distanceMi <= 0) return null;
  if (!isFinite(flatPaceSPerMi) || flatPaceSPerMi <= 0) return null;

  const gain = input.gainFt == null || !isFinite(Number(input.gainFt)) ? null : Number(input.gainFt);
  const net = input.netFt == null || !isFinite(Number(input.netFt)) ? null : Number(input.netFt);
  if (gain == null && net == null) return null;

  // Gross gain is the load-bearing input. When only net is known, treat the
  // course as monotonic — that is all the data supports, and it is the
  // conservative read for a net climb.
  const gainFt = gain ?? Math.max(0, net ?? 0);
  // loss = gain − net, floored at 0 · an editorial row whose net exceeds its
  // gross is malformed, not a course that descends negative feet.
  const lossFt = Math.max(0, gainFt - (net ?? 0));

  const perFt = CLIMB_COST_PER_FT_PER_PACE_S * flatPaceSPerMi;
  return perFt * (gainFt - DESCENT_RECOVERY_FRACTION * lossFt);
}
