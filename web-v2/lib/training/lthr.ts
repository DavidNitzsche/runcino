/**
 * P33 — LTHR auto-calibration from race data.
 *
 * Joe Friel's protocol: LTHR ≈ avg HR sustained during a hard ~60-minute
 * steady effort. A half-marathon at race effort is the cleanest proxy
 * available without a dedicated LT test (close to 60 min for sub-1:30
 * runners, slightly longer for slower; the over-estimation is small).
 *
 * For shorter races (10K, 5K) the average HR exceeds LTHR — we only
 * accept half-marathon ± 1.1mi and longer. Marathons go too long
 * (cardiac drift inflates avg HR vs steady LT); cap upper bound.
 *
 * Returns the estimated LTHR (rounded int) or null if the race doesn't
 * qualify or HR is implausible.
 */
export function lthrFromRace(distanceMi: number, avgHrBpm: number): number | null {
  if (!isFinite(distanceMi) || !isFinite(avgHrBpm)) return null;
  if (avgHrBpm < 100 || avgHrBpm > 220) return null;          // bogus HR
  if (distanceMi < 12.0 || distanceMi > 14.5) return null;    // half-marathon only
  // Avg HR of a well-paced half-marathon ≈ LTHR. Round to integer.
  return Math.round(avgHrBpm);
}

/**
 * Same as above but with a wider net for marathon distance — applies a
 * cardiac-drift correction (5 bpm). Per Friel + AltitudeCoach research:
 * marathon avg HR ≈ LTHR - 5 bpm at race effort. Only valid when the
 * runner actually raced (not paced through).
 */
export function lthrFromMarathon(distanceMi: number, avgHrBpm: number): number | null {
  if (!isFinite(distanceMi) || !isFinite(avgHrBpm)) return null;
  if (avgHrBpm < 100 || avgHrBpm > 210) return null;
  if (distanceMi < 25.5 || distanceMi > 27.5) return null;
  return Math.round(avgHrBpm + 5);
}

/**
 * Choose the right method for the race distance, return both the
 * suggested LTHR and the method string so the caller can stamp the
 * lthr_method column for audit.
 */
export function calibrateLthr(distanceMi: number, avgHrBpm: number): { lthr: number; method: string } | null {
  const half = lthrFromRace(distanceMi, avgHrBpm);
  if (half != null) return { lthr: half, method: 'race_half' };
  const full = lthrFromMarathon(distanceMi, avgHrBpm);
  if (full != null) return { lthr: full, method: 'race_full' };
  return null;
}
