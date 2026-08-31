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
 *   · { value: null, source: 'absent' } · suspicious AND uncorroborated
 *
 * Callers fold the source into data.elevGainSource so the read path
 * knows the provenance without redoing the math.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 2026-08-30 · THE SPARSE-SPLITS BRANCH FAILED OPEN (RULE 11)
 *
 * The third bullet used to read "couldn't confidently recompute, trust the
 * source rather than zeroing the field out", and the code did exactly that:
 * a value above the suspicion threshold, presented with too few splits to
 * check, was returned RAW.
 *
 * That collapses "I checked and it is fine" into "I could not check". The
 * whole point of the 250 ft/mi threshold is to declare the number
 * untrustworthy until something corroborates it; answering "no corroborating
 * evidence available" with "trust it then" spends the suspicion on nothing
 * and disables the guard precisely on the rows that most need it — a run with
 * no splits has no second opinion about anything.
 *
 * It was also internally inconsistent. The branch immediately below — splits
 * present with adequate coverage but carrying no elevation fields — already
 * returns `absent` on the identical reasoning ("we cannot corroborate a
 * suspicious raw value"). Having MORE splits could therefore get the value
 * refused while having FEWER got it accepted.
 *
 * Measured on production, 2026-08-30, faff_readonly, over the owner's 153
 * canonical rows (`NOT (data ? 'mergedIntoId')`): 8 rows sit above 250 ft/mi,
 * and exactly 3 of them reached this branch and were accepted raw —
 *
 *     2026-05-27   5.86 mi   1910 ft   326 ft/mi    1 split  (min 4)
 *     2026-05-29   7.71 mi   2492 ft   323 ft/mi    1 split  (min 5)
 *     2026-08-26   7.78 mi   2807 ft   361 ft/mi    0 splits (min 5)
 *
 * 2026-08-26 is the visible cost: `lib/terrain/run-terrain.ts` calls this
 * function on the READ, and 2807 ft over a flat LA route makes `deriveRecap`
 * forgive the pace and tell the runner the effort was harder than it looks.
 *
 * Because that call site is a read, this change repairs those rows on screen
 * with no write to `runs.data` at all.
 *
 * FALSIFICATION ANCHOR · the owner's genuinely hilly runs must survive.
 * Big Sur, 2026-04-26, 26.81 mi / 2140 ft = 80 ft/mi, 27 splits — nowhere
 * near the threshold, so it never reaches this branch. The hilliest
 * non-suspicious row on the account is the Point Mugu half at 164 ft/mi.
 * Both are asserted in `_ingest_integrity.test.ts`.
 */

export interface ElevSanityInput {
  elevGainFt: number | null | undefined;
  distanceMi: number | null | undefined;
  /** Per-mile splits with the per-split elevation DELTA in feet.
   *  Accepts any of the three field names callers use in the wild:
   *   · elev_change_ft         · canonical (Strava-pulled rows after pullSync rename)
   *   · elevation_difference   · raw Strava split shape
   *   · elev_ft                · iPhone HealthKitImporter + Faff watch app
   *     (semantically the per-mile end-start altitude delta, NOT an
   *      absolute altitude · see HealthKitImporter.swift:
   *      `elevDeltaFt = (mileEndAlt - mileStartAlt) * 3.28084`)
   *
   *  Three names exist because of history: HK + watch landed with
   *  elev_ft, pullSync normalized Strava's elevation_difference →
   *  elev_change_ft, and this sanity helper didn't know about elev_ft
   *  so it never fired on HK/watch rows · which is exactly the bug
   *  that let 4684 ft show up on a 12mi suburban long run (2026-05-31). */
  splits?: Array<{
    elev_change_ft?: number | null;
    elevation_difference?: number | null;
    elev_ft?: number | null;
  }>;
}

export interface ElevSanityResult {
  value: number | null;
  source: 'raw' | 'recomputed' | 'absent';
}

/**
 * Cap: above this ft/mi we don't trust the raw without corroboration.
 *
 * Exported so `_ingest_integrity.test.ts` can read the number out of the
 * module it is checking instead of hardcoding a second copy of it — a check
 * that hardcodes both sides only proves the test agrees with itself.
 */
export const SUSPICION_THRESHOLD_FT_PER_MI = 250;

/**
 * How many splits a run of this length must carry before its splits can
 * corroborate (or refute) a suspicious elevation total. 75% mile coverage,
 * floor 3.
 *
 * Exported for the same reason as the threshold above, and because the
 * sparse-splits refusal is now a behaviour worth asserting by name.
 */
export function requiredSplitCoverage(distanceMi: number): number {
  return Math.max(3, Math.floor(distanceMi * 0.75));
}

/**
 * TRUE when a run's per-mile positives sum to MORE than the total climb the
 * same row reports, by more than rounding can explain.
 *
 * That direction is arithmetically impossible, not merely surprising. A split
 * is a NET delta over its mile: a mile that climbs 100 ft and gives it all
 * back contributes 0 to this sum and 100 ft to the true total. So the sum of
 * per-mile positives can only ever UNDER-count the gain. When it over-counts,
 * one of the two figures is wrong and the row does not say which.
 *
 * Three canonical rows: 554 ft of splits against a stored 174 (2026-06-18),
 * 589 against 217 (2026-08-09), 2224 against 1238 (2026-03-21).
 *
 * 10% plus 10 ft of slack, because the two are rounded independently and a
 * short run's rounding is a large share of a small number.
 */
export function splitsContradictTotal(splitPositiveFt: number, storedTotalFt: number): boolean {
  if (!(storedTotalFt > 0) || !(splitPositiveFt > 0)) return false;
  return splitPositiveFt > storedTotalFt * 1.1 + 10;
}

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

  // Barometric-drift outlier check: fires even when the total ft/mi looks
  // credible. A pressure swing during a flat run can spike ONE split while
  // leaving the total below the 250ft/mi threshold. If any single split's
  // elevation delta is > 3× the per-mile average (and > 150ft absolute),
  // both the total and splits derive from the same drifted source — they
  // agree but both are wrong. Return absent so GPS-DEM fires instead.
  // Today's tempo run: split0 = 502ft on a flat LA route (avg = 68ft/mi,
  // threshold = 204ft) → this correctly flags it for DEM fallback.
  const splitsForDriftCheck = input.splits ?? [];
  if (splitsForDriftCheck.length > 0) {
    const driftThreshold = Math.max(150, ftPerMi * 3);
    const maxSingleDelta = splitsForDriftCheck.reduce((m, sp) => {
      const c = Math.abs(Number(sp.elev_change_ft ?? sp.elevation_difference ?? sp.elev_ft ?? 0));
      return Math.max(m, c);
    }, 0);
    if (maxSingleDelta > driftThreshold) {
      return { value: null, source: 'absent' };
    }
  }

  if (ftPerMi <= SUSPICION_THRESHOLD_FT_PER_MI) {
    return { value: Math.round(raw), source: 'raw' };
  }
  // Above threshold · demand at least 75% mile coverage in splits.
  const splits = input.splits ?? [];
  const minSplits = requiredSplitCoverage(distMi);
  if (splits.length < minSplits) {
    // RULE 11 · "cannot check" is not "checked and fine".
    //
    // FAILS CLOSED. A suspicious value with too few splits to corroborate is
    // refused, exactly as the sufficient-coverage-but-no-elevation-data case
    // below is refused, and for the same reason. The caller's GPS/DEM
    // fallback fires instead of a possibly-10x barometric reading being
    // persisted or rendered. See the module header for the three production
    // rows this covers.
    return { value: null, source: 'absent' };
  }
  // Sum positive elev changes. Accept all three known field names ·
  // see ElevSanityInput.splits doc for why we tolerate three names.
  const splitsPositive = splits.reduce((s, sp) => {
    const c = Number(sp.elev_change_ft ?? sp.elevation_difference ?? sp.elev_ft ?? 0);
    return s + (c > 0 ? c : 0);
  }, 0);
  if (splitsPositive <= 0) {
    // Splits exist with sufficient coverage but carry no elevation data (e.g.
    // watch splits with only hr/pace fields) OR all splits are flat/downhill.
    // Either way, we cannot corroborate a suspicious raw value. Return absent
    // so the caller's GPS/DEM fallback fires rather than persisting a
    // potentially 10× inflated barometric reading.
    return { value: null, source: 'absent' };
  }
  // Only swap when splits-positive is meaningfully smaller · otherwise
  // we'd be substituting one inflated number for another. 60% cutoff.
  if (splitsPositive >= raw * 0.6) {
    return { value: Math.round(raw), source: 'raw' };
  }
  return { value: Math.round(splitsPositive), source: 'recomputed' };
}
