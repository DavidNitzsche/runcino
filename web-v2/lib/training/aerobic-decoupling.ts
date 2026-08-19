/**
 * aerobic-decoupling.ts
 *
 * Pa:Hr decoupling on long, steady-state runs. The single best
 * aerobic-fitness signal we can extract from per-mile splits.
 *
 * Doctrine: Research/03-heart-rate-zones.md §12 "Cardiac Drift and Aerobic
 * Decoupling (Pa:HR)".
 *
 *   The relationship between pace and HR is stable when the runner is
 *   aerobically fit. When HR climbs while pace stays constant (or pace
 *   slows while HR stays constant), the cardiovascular system is doing
 *   more work for the same output. That's aerobic decoupling.
 *
 *   §12's own interpretation table, which is what the bands below read:
 *     · < 5%    = strong aerobic endurance; sustainable  → race-ready
 *     · 5-8%    = acceptable; approaching aerobic limit  → building
 *     · 8-10%   = endurance gap; build base before progressing
 *     · > 10%   = above aerobic threshold or insufficient endurance
 *
 * Computation: split the run into halves, compute beats-per-meter
 * (or HR / pace-in-mph) for each half, then drift % = (h2 − h1) / h1.
 *
 * ── 2026-08-19 · THE GATE IS DURATION, NOT DISTANCE ──────────────────────
 *
 * This used to require `distanceMi >= 6`, which is not a quantity doctrine
 * states anywhere. §12 gives the protocol in TIME: "Compare first vs. second
 * half of a steady aerobic run (60–90 min)", and repeats it under Use — "fixed
 * 60-min run at presumed AeT pace". §16's Field Alternatives table names the
 * instrument by its duration too: "60-min drift run".
 *
 * Six miles is 36 minutes for a 6:00/mi runner and 78 minutes for a 12:00/mi
 * runner, so the distance gate did two wrong things at once. It read drift off
 * efforts far too short to have developed any — §2's confounder table scopes
 * cardiac drift to ">30 min steady", growing "+5–15% over 60 min" — and it made
 * the signal structurally unreachable for a 5K/10K-focused runner whose long
 * run is 5 miles. `decoupling-trend.ts` inherited the same gate, so that
 * runner's whole aerobic-trajectory surface was dark, which in turn left
 * `lib/coach/limiter.ts`'s DECOUPLING_ENDURANCE_GAP_PCT finding with no
 * observations to feed it.
 *
 * The duration is measured off the splits themselves — the sum of the analysed
 * splits' per-mile times IS the time spent in the segment being compared — so
 * no caller has to learn a new argument for the gate to become correct.
 *
 * There is deliberately NO upper gate at §12's 90 minutes. The same section
 * applies the same <5% band to a marathon ("A well-paced marathon shows <5%
 * Pa:HR decoupling at 30 km"), so doctrine itself carries the reading past the
 * protocol's nominal ceiling.
 *
 * Filters (so we only measure when the signal is meaningful):
 *   · Analysed segment ≥ 60 minutes (§12's protocol duration)
 *   · Runs whose splits carry both HR and pace
 *   · NOT race or interval (workout type filter applied by caller)
 *
 * Returns null when filters fail · the run just doesn't carry this
 * signal · the run-detail card simply doesn't render the chip.
 */

import { splitsWithHrAndPace, DECOUPLING_SPLIT_SHAPES } from '@/lib/runs/run-shape';

/**
 * Research/03 §12's protocol duration, minutes. "Compare first vs. second half
 * of a steady aerobic run (60–90 min)" — the floor of the stated window, which
 * §12's Use clause repeats as a "fixed 60-min run" and §16's Field Alternatives
 * table lists as the "60-min drift run".
 *
 * This is the whole instrument, not a convenience filter: §12's interpretation
 * bands (and `DECOUPLING_ENDURANCE_GAP_PCT` in lib/coach/limiter.ts, which is
 * the floor of one of its rows) describe what drift means on a run of this
 * length. Reading them off a 36-minute effort is quoting a table outside its
 * own scope.
 *
 * Bound by `DECOUPLING.protocol-duration` in lib/doctrine/registry.ts, which
 * parses the window out of the passage.
 */
export const DECOUPLING_PROTOCOL_MIN_MINUTES = 60;

/**
 * Research/03 §12's interpretation-table boundaries, drift %.
 *
 * `< 5%` / `5–8%` / `8–10%` / `> 10%`. The engine had 5 / 7 here, and 7 is not
 * a boundary the table publishes — it split "5–8% Acceptable" in the middle and
 * so called a 7.5% reading `poor` while `limiter.ts` (correctly reading the
 * "8–10% Endurance gap" row) called the same reading fine. One table, one set
 * of boundaries.
 *
 * Bound by `DECOUPLING.interpretation-bands`.
 */
export const DECOUPLING_BAND_STRONG_PCT = 5;
export const DECOUPLING_BAND_ACCEPTABLE_PCT = 8;
export const DECOUPLING_BAND_ABOVE_AET_PCT = 10;

export interface AerobicDecouplingResult {
  /** Drift % · positive = HR climbed faster than pace (decoupling).
   *  Negative is rare but possible (warm-up effect on early miles). */
  driftPct: number;
  /** Research/03 §12's banding · `poor` is the doc's "Endurance gap" row and
   *  above, so it lines up exactly with the limiter's endurance finding. */
  verdict: 'race-ready' | 'building' | 'poor';
  /** Minutes of running in the analysed segment · the quantity §12's protocol
   *  is stated in, kept so a consumer can show why a run did or didn't qualify. */
  durationMin: number;
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

/**
 * Shape of a split row as it lives in runs.data.splits.
 *
 * 2026-08-17 · the pace/HR normalisation that used to live here is now
 * `splitsWithHrAndPace` in `lib/runs/run-shape.ts`. It was a private third
 * opinion about split shape, and `runs.data.splits` carries SIX of them —
 * this file knew about three.
 *
 * `DECOUPLING_SPLIT_SHAPES` pins the reach to exactly what this function has
 * always been able to read, so lifting the helper changed nothing. In
 * particular it still reads NOTHING from the Strava-raw shape (`average_speed`,
 * `moving_time`, `average_heartrate`), which 36 rows carry inside `splits` and
 * which has never produced a decoupling signal. Widening that is a behaviour
 * change and belongs in its own commit.
 */
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
 * Compute aerobic decoupling for a run.
 *
 * @param splits per-mile split rows from runs.data.splits
 * @param distanceMi total run distance · kept for the caller's convenience and
 *        for the sanity check that the splits describe the run they came from.
 *        It is NOT the gate any more; see the duration note in the file header.
 * @returns drift % + verdict + half stats, or null if signal absent
 */
export function computeAerobicDecoupling(
  splits: SplitRow[] | undefined | null,
  distanceMi: number | null | undefined,
): AerobicDecouplingResult | null {
  if (!splits || splits.length < 4) return null;       // need ≥4 splits to halve meaningfully
  if (distanceMi != null && !(distanceMi > 0)) return null;

  const valid = splitsWithHrAndPace(splits, { shapes: DECOUPLING_SPLIT_SHAPES });
  if (valid.length < 4) return null;                   // need enough valid rows

  // Research/03 §12's protocol duration, measured on the segment actually being
  // compared. Each valid row is one mile, so its `paceSec` is that mile's
  // elapsed time and the sum is the segment's duration.
  const durationSec = valid.reduce((s, r) => s + r.paceSec, 0);
  const durationMin = durationSec / 60;
  if (!(durationMin >= DECOUPLING_PROTOCOL_MIN_MINUTES)) return null;

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

  // Research/03 §12's interpretation table.
  let verdict: AerobicDecouplingResult['verdict'];
  if (driftPct < DECOUPLING_BAND_STRONG_PCT) verdict = 'race-ready';
  else if (driftPct < DECOUPLING_BAND_ACCEPTABLE_PCT) verdict = 'building';
  else verdict = 'poor';

  return {
    driftPct: +driftPct.toFixed(1),
    verdict,
    durationMin: +durationMin.toFixed(1),
    h1Hr: Math.round(h1Hr),
    h1PaceSec: Math.round(h1PaceSec),
    h2Hr: Math.round(h2Hr),
    h2PaceSec: Math.round(h2PaceSec),
    splitsCount: valid.length,
  };
}
