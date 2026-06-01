/**
 * lib/runs/elev-sanity.ts · barometric-drift sanity check at ingest.
 *
 * Why this exists:
 *
 *   Barometric altimeters (the Apple Watch, the Forerunner, the COROS,
 *   etc.) drift when ambient pressure swings during a run · indoor-to-
 *   outdoor transition, weather front rolling in, humidity spike. The
 *   raw elev_gain_ft can come back at 5-10x the real climb. David's
 *   12.1mi long this week reported 4684 ft of gain (387 ft/mi) on a
 *   suburban route · mountain-running territory.
 *
 *   The read-side fallback in lib/coach/run-state.ts already swaps the
 *   bad value for a credible sum-of-positive-splits when the run is
 *   read. This module gives the WRITER the same check so newly-ingested
 *   rows persist the corrected value AND a provenance stamp · readers
 *   know whether the gain they see is raw or recomputed.
 *
 * Doctrine threshold: 250 ft/mi. From Research/12 (course-specific
 * training) the credible urban / trail ceiling. Above that, demand
 * splits-derived corroboration before trusting the number.
 *
 * sanitizeElevGain returns either:
 *   · { value: raw, source: 'raw' } · raw was credible
 *   · { value: corrected, source: 'recomputed' } · splits agreed
 *   · { value: raw, source: 'raw' } · couldn't confidently recompute,
 *      trust the source rather than zeroing the field out
 *
 * Callers fold the source into data.elevGainSource so the read path
 * knows the provenance without redoing the math.
 */

export interface ElevSanityInput {
  elevGainFt: number | null | undefined;
  distanceMi: number | null | undefined;
  /** Per-mile splits with `elev_change_ft` per row · accepts either
   *  this canonical name or `elevation_difference` (Strava splits). */
  splits?: Array<{ elev_change_ft?: number | null; elevation_difference?: number | null }>;
}

export interface ElevSanityResult {
  value: number | null;
  source: 'raw' | 'recomputed' | 'absent';
}

/** Cap: above this ft/mi we don't trust the raw without corroboration. */
const SUSPICION_THRESHOLD_FT_PER_MI = 250;

export function sanitizeElevGain(input: ElevSanityInput): ElevSanityResult {
  const raw = Number(input.elevGainFt);
  if (!isFinite(raw) || raw <= 0) {
    return { value: null, source: 'absent' };
  }
  const distMi = Number(input.distanceMi);
  if (!isFinite(distMi) || distMi <= 0) {
    return { value: Math.round(raw), source: 'raw' };
  }
  const ftPerMi = raw / distMi;
  if (ftPerMi <= SUSPICION_THRESHOLD_FT_PER_MI) {
    return { value: Math.round(raw), source: 'raw' };
  }
  // Above threshold · demand at least 75% mile coverage in splits.
  const splits = input.splits ?? [];
  const minSplits = Math.max(3, Math.floor(distMi * 0.75));
  if (splits.length < minSplits) {
    return { value: Math.round(raw), source: 'raw' };
  }
  // Sum positive elev changes. Accept either field name.
  const splitsPositive = splits.reduce((s, sp) => {
    const c = Number(sp.elev_change_ft ?? sp.elevation_difference ?? 0);
    return s + (c > 0 ? c : 0);
  }, 0);
  if (splitsPositive <= 0) {
    return { value: Math.round(raw), source: 'raw' };
  }
  // Only swap when splits-positive is meaningfully smaller · otherwise
  // we'd be substituting one inflated number for another. 60% cutoff.
  if (splitsPositive >= raw * 0.6) {
    return { value: Math.round(raw), source: 'raw' };
  }
  return { value: Math.round(splitsPositive), source: 'recomputed' };
}
