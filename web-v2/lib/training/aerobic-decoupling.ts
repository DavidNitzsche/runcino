/**
 * aerobic-decoupling.ts
 *
 * Pa:Hr decoupling on long, steady-state runs. The single best
 * aerobic-fitness signal we can extract from per-mile splits.
 *
 * Doctrine: Research/15 §cardiac decoupling.
 *
 *   The relationship between pace and HR is stable when the runner is
 *   aerobically fit. When HR climbs while pace stays constant (or pace
 *   slows while HR stays constant), the cardiovascular system is doing
 *   more work for the same output. That's aerobic decoupling.
 *
 *   Standard threshold (Joel Friel, used widely):
 *     · < 5% drift   = aerobic engine is solid (race-ready)
 *     · 5-7%         = building aerobic base
 *     · > 7%         = poor aerobic fitness · base needs more work
 *
 * Computation: split the run into halves, compute beats-per-meter
 * (or HR / pace-in-mph) for each half, then drift % = (h2 − h1) / h1.
 *
 * Filters (so we only measure when the signal is meaningful):
 *   · Distance ≥ 6 miles (need enough volume for steady-state)
 *   · Runs whose splits carry both HR and pace
 *   · NOT race or interval (workout type filter applied by caller)
 *
 * Returns null when filters fail · the run just doesn't carry this
 * signal · the run-detail card simply doesn't render the chip.
 */

export interface AerobicDecouplingResult {
  /** Drift % · positive = HR climbed faster than pace (decoupling).
   *  Negative is rare but possible (warm-up effect on early miles). */
  driftPct: number;
  /** Joel Friel's banding. */
  verdict: 'race-ready' | 'building' | 'poor';
  /** First-half mean HR (bpm). */
  h1Hr: number;
  /** First-half mean pace (sec/mile). */
  h1PaceSec: number;
  /** Second-half mean HR (bpm). */
  h2Hr: number;
  /** Second-half mean pace (sec/mile). */
  h2PaceSec: number;
  /** Number of splits used (helpful for transparency). */
  splitsCount: number;
}

/** Shape of a split row as it lives in runs.data.splits. The shape has
 *  changed over time (older runs use avgHr/paceSPerMi, newer use
 *  hr/pace mm:ss). The helper normalizes both. */
interface SplitRow {
  mile?: number;
  hr?: number | string;
  avgHr?: number | string;
  hrAvgBpm?: number | string;
  pace?: number | string;          // "9:16" mm:ss OR seconds OR null
  paceSPerMi?: number | string;
  paceSecPerMi?: number | string;
}

/**
 * Normalize a pace value to seconds per mile.
 * Accepts: "9:16" mm:ss strings · numeric seconds · null.
 */
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

function hrToNum(h: unknown): number | null {
  if (h == null) return null;
  const n = typeof h === 'number' ? h : Number(h);
  return Number.isFinite(n) && n > 40 && n < 230 ? n : null;
}

/**
 * Extract (hr, paceSec) per split, dropping rows missing either signal.
 */
function extractValidSplits(splits: SplitRow[]): Array<{ hr: number; paceSec: number }> {
  return splits.map((s) => {
    const hr = hrToNum(s.hr ?? s.avgHr ?? s.hrAvgBpm);
    const paceSec = paceToSec(s.pace ?? s.paceSPerMi ?? s.paceSecPerMi);
    return hr != null && paceSec != null ? { hr, paceSec } : null;
  }).filter((x): x is { hr: number; paceSec: number } => x != null);
}

/**
 * Compute aerobic decoupling for a run.
 *
 * @param splits per-mile split rows from runs.data.splits
 * @param distanceMi total run distance (used for the ≥6mi filter)
 * @returns drift % + verdict + half stats, or null if signal absent
 */
export function computeAerobicDecoupling(
  splits: SplitRow[] | undefined | null,
  distanceMi: number | null | undefined,
): AerobicDecouplingResult | null {
  if (!splits || splits.length < 4) return null;       // need ≥4 splits to halve meaningfully
  if (distanceMi == null || distanceMi < 6) return null;

  const valid = extractValidSplits(splits);
  if (valid.length < 4) return null;                   // need enough valid rows

  // Split into halves · for odd counts, give the extra split to first half
  // so the second half starts on a clean mid-point.
  const mid = Math.ceil(valid.length / 2);
  const h1 = valid.slice(0, mid);
  const h2 = valid.slice(mid);
  if (h1.length === 0 || h2.length === 0) return null;

  const avg = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
  const h1Hr = avg(h1.map((r) => r.hr));
  const h1PaceSec = avg(h1.map((r) => r.paceSec));
  const h2Hr = avg(h2.map((r) => r.hr));
  const h2PaceSec = avg(h2.map((r) => r.paceSec));

  // Steady-state filter · the decoupling signal is only valid when the
  // runner held an even effort. Progressions, fartleks, races and
  // long-run finishers all break this. If the two halves differ by
  // more than ±20 sec/mile (~4% at 8-min pace), drop the signal · the
  // runner was deliberately varying intensity and the math gets noisy.
  if (Math.abs(h2PaceSec - h1PaceSec) > 20) return null;

  // Ratio: HR per unit of speed. Higher = more cardio cost per meter.
  // Use HR / (1/paceSec) = HR × paceSec. Larger = more HR for same pace.
  // Drift = (h2 ratio − h1 ratio) / h1 ratio.
  const h1Ratio = h1Hr * h1PaceSec;
  const h2Ratio = h2Hr * h2PaceSec;
  if (h1Ratio <= 0) return null;
  const driftPct = ((h2Ratio - h1Ratio) / h1Ratio) * 100;
  // Sanity bound: ≥ |20%| means the splits are noisy / not steady-state.
  // Suppress rather than report a misleading number.
  if (!Number.isFinite(driftPct) || Math.abs(driftPct) > 20) return null;

  // Joel Friel bands.
  let verdict: AerobicDecouplingResult['verdict'];
  if (driftPct < 5) verdict = 'race-ready';
  else if (driftPct < 7) verdict = 'building';
  else verdict = 'poor';

  return {
    driftPct: +driftPct.toFixed(1),
    verdict,
    h1Hr: Math.round(h1Hr),
    h1PaceSec: Math.round(h1PaceSec),
    h2Hr: Math.round(h2Hr),
    h2PaceSec: Math.round(h2PaceSec),
    splitsCount: valid.length,
  };
}
