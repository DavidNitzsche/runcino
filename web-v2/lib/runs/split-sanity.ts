/**
 * split-sanity.ts · per-mile split plausibility guard.
 *
 * The whole-run guard in watch/complete (splits-sum-vs-duration) and the
 * ingest reconciliation both operate on the WHOLE run. Neither catches a
 * SINGLE mile whose pace is physiologically impossible for the effort —
 * the classic GPS-distance-spike artifact: a stretch where the watch's
 * cumulative GPS distance jumps, so a "mile" completes in far less real
 * time than the runner actually ran, producing a fast split pace while the
 * HR and cadence sensors (independent of GPS) correctly show easy effort.
 *
 * Real-world example (David, 2026-07-09 tempo): mile 2 read 5:44/mi at
 * HR 130 and cadence 109, sitting between 6:57–7:05 miles at HR 160–165.
 * A 5:44/mi (4.68 m/s) at 109 steps/min (1.82 steps/s) implies a 2.57 m
 * stride per step — physically impossible; elite distance stride is
 * ~1.5–1.8 m, and even sprinters top out near 2.5 m at 200+ cadence. The
 * split distances also summed to 6.45 mi against a 5.86 mi run (GPS
 * over-count of ~0.6 mi, all of it landing in that one mile).
 *
 * This guard flags such a split `unreliable` and nulls its numeric pace so
 * every downstream consumer (the mile-splits display, tempo/work averages,
 * VDOT, drift/fade heuristics) skips it instead of trusting a fabricated
 * fast pace. Non-destructive: the mile row survives (renders "—") and HR /
 * cadence / elevation are untouched — only the impossible PACE is dropped.
 *
 * Two independent detectors, either one flags:
 *   1. STRIDE (needs cadence): implied metres-per-step > MAX_STRIDE_M. The
 *      rigorous, physics-based test — a real fast rep has fast pace AND
 *      high cadence, so its stride stays plausible and it is never flagged.
 *   2. PACE↔EFFORT CONTRADICTION (fallback when cadence is absent, e.g.
 *      pure watch-derived splits): a split much faster than the run's
 *      median that ALSO has an HR well below the median — fast pace with
 *      easy-effort HR, the same GPS-spike signature without cadence to
 *      prove it. Deliberately conservative so a genuine fast+hard mile
 *      (fast pace + high HR) is never flagged.
 */

const METRES_PER_MILE = 1609.344;
/** Max plausible running stride (metres per single step). Distance-running
 *  strides run ~1.0–1.8 m; 2.3 m at any distance-running cadence is
 *  impossible, so this never flags a real mile. */
const MAX_STRIDE_M = 2.3;

export interface SplitLike {
  mile?: number;
  pace?: string | null;             // "M:SS" — the human-readable pace
  paceSecPerMi?: number | null;     // numeric seconds/mi (watch-derived)
  hr?: number | null;
  cadence?: number | null;
  unreliable?: boolean;
  [k: string]: unknown;
}

/** Parse "M:SS" / "MM:SS" to seconds. Returns null on anything else. */
export function paceStrToSec(pace: unknown): number | null {
  if (typeof pace === 'number' && Number.isFinite(pace) && pace > 0) return pace;
  if (typeof pace !== 'string') return null;
  const m = pace.match(/^(\d+):(\d{2})$/);
  if (!m) return null;
  const sec = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return sec > 0 ? sec : null;
}

/** Seconds/mile for a split, from either the numeric or the "M:SS" field. */
function splitPaceSec(s: SplitLike): number | null {
  if (typeof s.paceSecPerMi === 'number' && s.paceSecPerMi > 0) return s.paceSecPerMi;
  return paceStrToSec(s.pace);
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/**
 * Return a copy of `splits` with any physiologically-impossible split
 * flagged `unreliable: true` and its numeric pace nulled. Everything else
 * is preserved byte-for-byte. Runs with <3 splits skip the median-based
 * fallback (too few peers to establish a baseline) but still apply the
 * stride test, which is absolute.
 */
export function sanitizeSplits<T extends SplitLike>(splits: T[] | null | undefined): T[] {
  if (!Array.isArray(splits) || splits.length === 0) return splits ?? [];

  const paces = splits.map(splitPaceSec).filter((p): p is number => p != null);
  const hrs = splits.map((s) => (typeof s.hr === 'number' && s.hr > 0 ? s.hr : null))
    .filter((h): h is number => h != null);
  const medPace = median(paces);
  const medHr = median(hrs);

  return splits.map((s) => {
    const paceSec = splitPaceSec(s);
    if (paceSec == null) return s;

    let impossible = false;

    // 1 · Stride test (absolute, needs cadence).
    if (typeof s.cadence === 'number' && s.cadence > 0) {
      const metresPerSec = METRES_PER_MILE / paceSec;
      const stepsPerSec = s.cadence / 60;
      const strideM = metresPerSec / stepsPerSec;
      if (strideM > MAX_STRIDE_M) impossible = true;
    }

    // 2 · Pace↔effort contradiction (fallback, needs peers + HR).
    if (!impossible && splits.length >= 3 && medPace != null && medHr != null
        && typeof s.hr === 'number' && s.hr > 0) {
      const muchFaster = paceSec <= medPace - 75;      // ≥75 s/mi faster than the run's median
      const easyHr = s.hr <= medHr * 0.85;             // yet HR ≥15% below median — fast pace, easy effort
      if (muchFaster && easyHr) impossible = true;
    }

    if (!impossible) return s;
    // Flag + null the fabricated pace; keep the mile row and its other metrics.
    return { ...s, pace: null, paceSecPerMi: null, unreliable: true };
  });
}
