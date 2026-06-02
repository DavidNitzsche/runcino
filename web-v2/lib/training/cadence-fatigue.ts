/**
 * cadence-fatigue.ts
 *
 * Cadence drop on closing splits · neuromuscular fatigue marker.
 *
 * Doctrine: Research/16 §form · "cadence under fatigue."
 *
 *   Stride rate is one of the first markers of neuromuscular fatigue
 *   to drop in long efforts. A runner holds an even pace and HR for
 *   most of the run, but in the closing miles cadence drifts down
 *   by 4-8 spm · the gait economy is decaying even while the runner
 *   doesn't feel it yet. Catching this signal trains the runner to
 *   either back off effort earlier or build closing-mile durability
 *   in training (form drills, strides, heavy strength work).
 *
 * Bands (informed by Adams et al. + practical coaching):
 *   · < 2 spm drop  · sustained  · neuromuscular durability is solid
 *   · 2-4 spm drop  · fading     · normal late-run fatigue
 *   · > 4 spm drop  · breaking   · economy is decaying meaningfully
 *
 * Computation: split into halves, compare H2 avg cadence vs H1 avg
 * cadence. Negative delta = cadence dropped.
 *
 * Filters (so the signal stays honest):
 *   · Distance ≥ 6 miles (need enough volume for fatigue to manifest)
 *   · Splits must carry cadence
 *   · Workout type is steady-state (not intervals/race/tempo where
 *     cadence variability is by design)
 *   · Pace must be roughly steady (within ±20 sec/mi H2 vs H1) so we
 *     measure fatigue at constant effort, not at a different intensity
 *
 * Returns null when filters fail · per-run, no average.
 */

export interface CadenceFatigueResult {
  /** spm change H2 vs H1. Negative = dropped. */
  deltaSpm: number;
  /** Banding · positive frame ("sustained") vs negative ("breaking"). */
  verdict: 'sustained' | 'fading' | 'breaking';
  /** First-half mean cadence. */
  h1Spm: number;
  /** Second-half mean cadence. */
  h2Spm: number;
  /** Number of splits used. */
  splitsCount: number;
}

interface SplitRow {
  cadence?: number | string;
  // also handle the pace-stability check (reuses the same filter shape
  // as the aerobic-decoupling helper)
  pace?: number | string;
  paceSPerMi?: number | string;
  paceSecPerMi?: number | string;
}

function paceToSec(p: unknown): number | null {
  if (p == null) return null;
  if (typeof p === 'number') return Number.isFinite(p) && p > 0 ? p : null;
  if (typeof p !== 'string') return null;
  if (/^\d+:\d{1,2}$/.test(p)) {
    const [m, s] = p.split(':').map((x) => parseInt(x, 10));
    return Number.isFinite(m) && Number.isFinite(s) ? m * 60 + s : null;
  }
  const n = Number(p);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function cadenceToNum(c: unknown): number | null {
  if (c == null) return null;
  const n = typeof c === 'number' ? c : Number(c);
  // Apple Watch sometimes reports half-cadence (single foot strikes)
  // around 70-95. Real running cadence (steps per minute) is 140-220.
  if (Number.isFinite(n) && n >= 70 && n <= 230) {
    return n < 130 ? n * 2 : n;  // double the half-cadence values
  }
  return null;
}

/**
 * Compute cadence-under-fatigue for a run.
 *
 * @param splits per-mile split rows from runs.data.splits
 * @param distanceMi total run distance
 * @returns delta + verdict + half stats, or null
 */
export function computeCadenceFatigue(
  splits: SplitRow[] | undefined | null,
  distanceMi: number | null | undefined,
): CadenceFatigueResult | null {
  if (!splits || splits.length < 4) return null;
  if (distanceMi == null || distanceMi < 6) return null;

  const valid = splits.map((s) => {
    const cad = cadenceToNum(s.cadence);
    const paceSec = paceToSec(s.pace ?? s.paceSPerMi ?? s.paceSecPerMi);
    return cad != null && paceSec != null ? { cad, paceSec } : null;
  }).filter((x): x is { cad: number; paceSec: number } => x != null);
  if (valid.length < 4) return null;

  // Split into halves · same convention as aerobic-decoupling.
  const mid = Math.ceil(valid.length / 2);
  const h1 = valid.slice(0, mid);
  const h2 = valid.slice(mid);
  if (h1.length === 0 || h2.length === 0) return null;

  const avg = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
  const h1Spm = avg(h1.map((r) => r.cad));
  const h2Spm = avg(h2.map((r) => r.cad));
  const h1PaceSec = avg(h1.map((r) => r.paceSec));
  const h2PaceSec = avg(h2.map((r) => r.paceSec));

  // Pace-stability filter · only measure fatigue at constant effort.
  if (Math.abs(h2PaceSec - h1PaceSec) > 20) return null;

  const deltaSpm = h2Spm - h1Spm;
  if (!Number.isFinite(deltaSpm) || Math.abs(deltaSpm) > 25) return null;

  // Bands (negative = cadence dropped = fatigue).
  let verdict: CadenceFatigueResult['verdict'];
  if (deltaSpm >= -2) verdict = 'sustained';
  else if (deltaSpm >= -4) verdict = 'fading';
  else verdict = 'breaking';

  return {
    deltaSpm: +deltaSpm.toFixed(1),
    verdict,
    h1Spm: Math.round(h1Spm),
    h2Spm: Math.round(h2Spm),
    splitsCount: valid.length,
  };
}
