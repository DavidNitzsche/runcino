/**
 * lib/coach/cadence-target.ts · per-workout cadence prescriptions.
 *
 * Backend owns the prescription · the runner sees a real number range
 * for every workout type ("172-180 spm") instead of vague placeholders
 * ("relaxed" / "drive turnover").
 *
 * Two paths:
 *   1. With personal baseline · shift the canonical range by the
 *      runner's baseline-vs-typical delta so the prescription matches
 *      their actual stride
 *   2. Without baseline · ship canonical ranges from running-form
 *      research (Magness, Daniels, McMillan): tighter cadence with
 *      effort, wider tolerance on easy days
 *
 * Canonical ranges are amateur-runner targets (the elite 180+ floor is
 * unrealistic for most). They're validated against split-cadence data
 * from David's actual runs (avg 162-170 spm easy, 175+ on threshold).
 */

export interface CadenceTarget {
  /** Low end of the range in spm. */
  low: number;
  /** High end of the range in spm. */
  high: number;
  /** Short cue for the chip: "172-180 spm · relaxed turnover" */
  copy: string;
}

/**
 * Canonical cadence ranges by workout type. Tight at race effort,
 * wider on easy days (variation is fine when cruising).
 */
const CANONICAL_RANGE: Record<string, { lo: number; hi: number; cue: string }> = {
  easy:        { lo: 165, hi: 175, cue: 'relaxed turnover' },
  recovery:    { lo: 162, hi: 172, cue: 'easy turnover' },
  long:        { lo: 168, hi: 178, cue: 'sustainable rhythm' },
  shakeout:    { lo: 170, hi: 180, cue: 'easy + strides' },
  tempo:       { lo: 172, hi: 182, cue: 'drive turnover' },
  threshold:   { lo: 175, hi: 185, cue: 'high turnover, low pound' },
  intervals:   { lo: 180, hi: 190, cue: 'crisp + quick' },
  progression: { lo: 170, hi: 180, cue: 'build into range' },
  race:        { lo: 178, hi: 188, cue: 'race rhythm' },
  fartlek:     { lo: 172, hi: 185, cue: 'shift between gears' },
  rest:        { lo: 0,   hi: 0,   cue: 'rest day' },
};

/**
 * Compute the cadence target for a workout type, optionally biased by
 * the runner's personal baseline.
 *
 * When personal baseline is present (e.g. their 60-day median is 168
 * spm) the canonical range gets shifted to land around it: the runner's
 * easy target is now `163-173` instead of generic `165-175`. Quality
 * targets shift proportionally · keeps the +5/+10/+15 spm relationship
 * to easy intact while honoring the runner's natural stride.
 *
 * When no baseline · ship the canonical range. Plain-English copy
 * shows what to aim for even on a brand-new runner with no history.
 */
export function cadenceTargetFor(
  type: string,
  baseline: number | null,
): CadenceTarget {
  const canonical = CANONICAL_RANGE[type] ?? CANONICAL_RANGE.easy;
  if (canonical.lo === 0 && canonical.hi === 0) {
    return { low: 0, high: 0, copy: canonical.cue };
  }

  // Personal-baseline shift · centered on baseline
  let lo = canonical.lo;
  let hi = canonical.hi;
  if (baseline != null && baseline > 130 && baseline < 220) {
    // The canonical easy midpoint is 170. Shift the entire range by
    // (baseline - 170) so the runner's easy target lands on their
    // natural cadence and quality targets stay +5/+10/+15 above it.
    const shift = Math.round(baseline - 170);
    lo += shift;
    hi += shift;
    // Floor at sane values · don't ship < 150 or > 200
    lo = Math.max(150, Math.min(200, lo));
    hi = Math.max(155, Math.min(205, hi));
  }

  return {
    low: lo,
    high: hi,
    copy: `${lo}-${hi} spm · ${canonical.cue}`,
  };
}
