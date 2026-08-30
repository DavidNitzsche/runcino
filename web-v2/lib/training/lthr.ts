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
 *
 * ⚠ 2026-08-30 · NOT A WRITE PATH ANY MORE. Do not re-wire this to
 * `UPDATE profile SET lthr = ...`.
 *
 * It was one, in `PATCH /api/race`, and it was the only one — which made it
 * wrong twice over. Too eager: it overwrote the anchor from any edited race in
 * the half-marathon band with no recency, effort or provenance gate, so a
 * jogged C-race or a hilly course could move it and a FIELD-TESTED value could
 * be silently replaced by a race proxy. Too narrow: a chip time entered through
 * `POST /api/race/result` never reached it at all, so the owner's anchor sat at
 * 162 from May 2026 while three later qualifying halves went past unread.
 *
 * `lib/training/lthr-reanchor.ts` owns the rule now and
 * `lib/training/lthr-reanchor-store.ts` owns the write. This function survives
 * as the pure distance→method router its name describes, and
 * `lthrFromMarathon` below survives with it — note that the marathon arm's flat
 * +5 bpm disagrees with `Research/08` §6.1, which prices a marathon at 88-95%
 * of LTHR (a ~10 bpm spread once inverted). That disagreement is the stated
 * reason the auto re-anchor accepts halves only.
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

// ── Field-test LTHR capture (2026-08-28) ─────────────────────────────────

/**
 * Friel 30-minute time-trial protocol · Research/03-heart-rate-zones.md
 * ("### Determining LTHR — 30-Minute Time Trial (Friel)"): "LTHR = average
 * HR during final 20 min." The 30-min TT was the only field method of four
 * tested whose HR estimate did not significantly differ from
 * blood-lactate-determined LTHR.
 */
export const FIELD_TEST_FINAL_WINDOW_SEC = 20 * 60;

/** The work segment must actually approximate the 30-min TT for the final-20
 *  average to mean threshold. 25 minutes is the floor — shorter and the HR
 *  average drifts toward VO2 territory (the 5K-proxy problem). */
export const FIELD_TEST_MIN_WORK_SEC = 25 * 60;

/** Need real coverage of the window, not three stray beats: at least this
 *  many samples spanning at least 15 of the final 20 minutes. */
export const FIELD_TEST_MIN_SAMPLES = 20;
export const FIELD_TEST_MIN_SPAN_SEC = 15 * 60;

interface FieldTestPhaseLike {
  type?: string | null;
  label?: string | null;
  actualDurationSec?: number | null;
  hrSamples?: Array<{ tSec: number; bpm?: number | null }> | null;
}

/**
 * Extract LTHR from a completed field test's watch phases.
 *
 * The test is authored as a tempo-shaped spec (warmup / 30-min work / cool-
 * down · lib/plan/adapt.ts field_test conversion), so the work segment is
 * the longest non-warmup/cooldown phase. LTHR = average bpm of the samples
 * inside the final 20 minutes of that phase (Friel, above). Null — never a
 * guess — when the work segment is too short, the HR stream too sparse, or
 * the average implausible.
 *
 * Pure · exported for tests · the watch-completion route calls this and
 * writes profile.lthr with method 'field_test'.
 */
export function lthrFromFieldTestPhases(
  phases: FieldTestPhaseLike[] | null | undefined,
): { lthr: number; sampleCount: number; windowSec: number } | null {
  if (!Array.isArray(phases) || phases.length === 0) return null;
  const isRestPhase = (p: FieldTestPhaseLike) =>
    /warm|cool|recover|rest/i.test(String(p.type ?? '') + ' ' + String(p.label ?? ''));
  const work = phases
    .filter((p) => !isRestPhase(p))
    .reduce<FieldTestPhaseLike | null>((best, p) => {
      const d = Number(p.actualDurationSec) || 0;
      return d > (Number(best?.actualDurationSec) || 0) ? p : best;
    }, null);
  if (!work) return null;
  const samples = (work.hrSamples ?? [])
    .map((s) => ({ tSec: Number(s.tSec), bpm: Number(s.bpm) }))
    .filter((s) => Number.isFinite(s.tSec) && Number.isFinite(s.bpm) && s.bpm >= 60 && s.bpm <= 230)
    .sort((a, b) => a.tSec - b.tSec);
  if (samples.length === 0) return null;
  const endSec = Math.max(
    Number(work.actualDurationSec) || 0,
    samples[samples.length - 1].tSec,
  );
  if (endSec < FIELD_TEST_MIN_WORK_SEC) return null;
  const windowStart = endSec - FIELD_TEST_FINAL_WINDOW_SEC;
  const windowed = samples.filter((s) => s.tSec >= windowStart);
  if (windowed.length < FIELD_TEST_MIN_SAMPLES) return null;
  const span = windowed[windowed.length - 1].tSec - windowed[0].tSec;
  if (span < FIELD_TEST_MIN_SPAN_SEC) return null;
  const avg = windowed.reduce((s, x) => s + x.bpm, 0) / windowed.length;
  // Same plausibility band the race-derived estimators use.
  if (avg < 100 || avg > 210) return null;
  return {
    lthr: Math.round(avg),
    sampleCount: windowed.length,
    windowSec: Math.round(endSec - windowStart),
  };
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
