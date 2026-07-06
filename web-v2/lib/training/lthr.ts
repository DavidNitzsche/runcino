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

/**
 * 2026-07-06 · P1-43 fix · LTHR estimated from max HR via the zone-system
 * crosswalk. Research/03-heart-rate-zones.md §11: the Threshold band sits at
 * 86–92% HRmax ≈ 95–102% LTHR (Daniels T crosswalk) → 100% LTHR ≈ ~90% HRmax.
 * A %HRmax-derived LTHR carries the SEE the file header warns about (±10-15
 * bpm for trained runners) — callers must label it estimated, never present
 * it as a tested threshold. Bounds mirror computeZones' maxHr validity gate.
 * Null when maxHr is implausible — never fabricate.
 */
export function lthrFromMaxHr(maxHrBpm: number): number | null {
  if (!isFinite(maxHrBpm) || maxHrBpm < 140 || maxHrBpm > 230) return null;
  return Math.round(maxHrBpm * 0.90);
}

/** How a resolved threshold HR was obtained · drives honest labeling. */
export type ThresholdHrMethod = 'stored-lthr' | 'maxhr-crosswalk';

/**
 * 2026-07-06 · P1-43 fix · resolve the runner's REAL threshold HR — the
 * replacement for the hardcoded LTHR 162 the phone's easy-run analysis was
 * judging every user against. Resolution order:
 *
 *   1. profile.lthr · stored (manual, race-calibrated via calibrateLthr,
 *      or profile-state's race-derived estimate written back). Best signal.
 *   2. loadEffectiveMaxHr (the canonical max-HR resolver · user override →
 *      observed 12-month ceiling → manual stored) × the §11 crosswalk.
 *   3. null · cold start. Callers must SKIP the HR judgment entirely —
 *      no verdict beats a verdict against someone else's physiology.
 */
export async function resolveThresholdHr(
  userUuid: string,
): Promise<{ bpm: number; method: ThresholdHrMethod } | null> {
  const { pool } = await import('@/lib/db/pool');
  const row = (await pool.query<{ lthr: number | string | null }>(
    `SELECT lthr FROM profile WHERE user_uuid = $1 LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] as Array<{ lthr: number | string | null }> }))).rows[0];
  const stored = row?.lthr != null ? Number(row.lthr) : null;
  // Validity gate mirrors computeZones' lthr bounds (100–210).
  if (stored != null && stored > 100 && stored < 210) {
    return { bpm: Math.round(stored), method: 'stored-lthr' };
  }
  const { loadEffectiveMaxHr } = await import('./max-hr');
  const max = await loadEffectiveMaxHr(userUuid).catch(() => null);
  const est = max?.bpm != null ? lthrFromMaxHr(Number(max.bpm)) : null;
  if (est != null) return { bpm: est, method: 'maxhr-crosswalk' };
  return null;
}
