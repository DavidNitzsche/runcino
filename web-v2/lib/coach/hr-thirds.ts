/**
 * lib/coach/hr-thirds.ts · EARLY / MIDDLE / LATE heart rate across a work
 * block, measured where the data allows it and clearly labelled where it
 * does not.
 *
 * ── The defect ───────────────────────────────────────────────────────
 * TodayView's TempoPanel rendered a panel headed "HR ACROSS THE BLOCK"
 * with three cards — EARLY, MIDDLE, LATE — and three bpm numbers. The
 * numbers were arithmetic:
 *
 *     const climb  = max_hr - avg_hr;
 *     const early  = avg - climb / 4;
 *     const middle = avg;
 *     const late   = avg + climb / 2;
 *
 * Nothing in that is a measurement of the early, middle, or late part of
 * the block. It is one average and one peak, spread across three cards
 * shaped like a time series. The runner reads "your HR was 148 early and
 * 163 late" and believes the run drifted 15 bpm; what actually happened
 * is that some single sample hit 173, which could be a cadence-lock
 * artefact, a hill, or a strap glitch on mile one — the "late" card would
 * read the same either way, because the position of the peak within the
 * block never enters the calculation.
 *
 * The amber LATE warning rode on the same fiction. It fired off the
 * avg/max spread alone, so a lone sensor spike painted a warning about
 * cardiac drift on a run that never drifted.
 *
 * ── The fix ──────────────────────────────────────────────────────────
 * The data to do this honestly is already on the wire. `RunSplit` carries
 * a per-mile `hr` and, since the phase-tagging work, a `phase` telling us
 * which miles were the work block. Averaging the HR-carrying work splits
 * by thirds is a real measurement of early / middle / late.
 *
 * Below three HR-carrying work splits there is no thirds to compute, so
 * the synthesized shape stays as a FALLBACK — but it stops claiming to be
 * a measurement. `source: 'estimated'` is returned alongside, the caller
 * relabels the panel, and no warning is raised from it, because you
 * cannot detect drift in data that has no time axis.
 *
 * Pure and synchronous. No React, no fetch, no clock.
 */

/** The per-mile split fields this module needs. Structurally satisfied by
 *  `lib/coach/run-state.ts` RunSplit; narrowed so tests need no fixtures. */
export interface HrThirdsSplit {
  hr?: number | null;
  phase?: 'warmup' | 'work' | 'recovery' | 'cooldown' | 'unknown' | null;
}

export type HrThirdsSource = 'measured' | 'estimated';

export interface HrThird {
  label: 'EARLY' | 'MIDDLE' | 'LATE';
  bpm: number;
  /** Amber treatment. Only ever set on a measured LATE third. */
  warn: boolean;
}

export interface HrThirds {
  thirds: [HrThird, HrThird, HrThird];
  source: HrThirdsSource;
  /** True when the late third DID clear the warn edge but heat explains it,
   *  so no warning was raised. Lets a surface say "hot day" instead of going
   *  silently quiet, which reads as nothing having happened. */
  heatSuppressedWarn?: boolean;
  /**
   * LATE − EARLY in bpm. Null on the estimated path: the synthesized
   * numbers have no time axis, so their difference is not a drift.
   */
  driftBpm: number | null;
  /** Splits that contributed. 0 on the estimated path. */
  measuredSplits: number;
}

/**
 * Minimum HR-carrying work splits before thirds are a measurement rather
 * than a re-slicing of one or two numbers. Three is the floor because
 * three is what it takes to give each third a sample of its own.
 */
export const MIN_MEASURED_SPLITS = 3;

/**
 * Late-third rise, in bpm, that earns the amber card.
 *
 * 8 bpm is the threshold the neighbouring LongMpPanel and LongPanel
 * already use for their own first-vs-final-third HR read, so a tempo
 * block and a long run now flag drift at the same place. It is a product
 * convention, not a cited constant; if it is ever tuned off Research/02
 * §decoupling, all three surfaces should move together.
 */
export const LATE_DRIFT_WARN_BPM = 8;

/**
 * Heat-adjusted slowdown, in percent, at or above which this panel stops
 * raising a drift warning at all.
 *
 * `Research/03` §2 puts heat at or above 25°C at **+5 to +20 bpm**, and §12
 * names rising core temperature as the first driver of cardiac drift itself.
 * The warn edge above is 8 bpm — comfortably inside what heat alone produces,
 * so on a hot run the amber card can be entirely weather.
 *
 * Suppressing rather than raising the bar, for the same reason the decoupling
 * trend excludes hot runs instead of adjusting them: doctrine's band here is
 * 5-20 bpm, and picking a number inside a spread that wide to keep the finding
 * alive would be inventing precision the research does not offer. On a hot run
 * the panel still shows the three measured thirds — the numbers are real — it
 * just declines to call them drift.
 *
 * 6% is the existing HOT-run gate (`lib/coach/run-state.ts`), reused so two
 * surfaces cannot disagree about what counts as hot.
 */
export const HEAT_SUPPRESSES_DRIFT_WARN_PCT = 6;

const mean = (xs: readonly number[]): number =>
  Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);

/**
 * Compute EARLY / MIDDLE / LATE HR for a work block.
 *
 * @param splits    the run's per-mile splits, in order. Only `phase ===
 *                  'work'` splits carrying a positive `hr` are used.
 * @param fallback  phase-summary avg/max, for the sub-threshold case.
 * @returns null when there is nothing honest to show at all (no work
 *          splits AND no summary avg_hr) — callers render no panel.
 */
export function computeHrThirds(
  splits: readonly HrThirdsSplit[] | null | undefined,
  fallback: { avgHr?: number | null; maxHr?: number | null },
  /** Heat-adjusted slowdown for this run, if known. At or above
   *  `HEAT_SUPPRESSES_DRIFT_WARN_PCT` the late-third warning is withheld —
   *  heat moves HR by more than the warn edge on its own. Omitted / null
   *  behaves exactly as before. */
  heatSlowdownPct?: number | null,
): HrThirds | null {
  const heatConfounded = heatSlowdownPct != null
    && Number.isFinite(heatSlowdownPct)
    && heatSlowdownPct >= HEAT_SUPPRESSES_DRIFT_WARN_PCT;
  const work = (splits ?? []).filter(
    (s) =>
      s.phase === 'work' &&
      typeof s.hr === 'number' &&
      Number.isFinite(s.hr) &&
      (s.hr ?? 0) > 0,
  );

  if (work.length >= MIN_MEASURED_SPLITS) {
    const hrs = work.map((s) => s.hr as number);
    const n = hrs.length;
    // Same third boundaries as LongMpPanel's pace thirds, so a runner
    // comparing the two panels is comparing the same slices of the run.
    const slices = [
      hrs.slice(0, Math.floor(n / 3)),
      hrs.slice(Math.floor(n / 3), Math.floor((2 * n) / 3)),
      hrs.slice(Math.floor((2 * n) / 3)),
    ];
    // n >= 3 guarantees every slice is non-empty: floor(n/3) >= 1 and
    // n - floor(2n/3) >= 1 for all n >= 3.
    const [early, middle, late] = slices.map(mean);
    const driftBpm = late - early;
    return {
      thirds: [
        { label: 'EARLY', bpm: early, warn: false },
        { label: 'MIDDLE', bpm: middle, warn: false },
        // Heat withholds the warning, never the measurement. The three
        // numbers below are real either way; only the claim that they mean
        // cardiac drift is suppressed.
        { label: 'LATE', bpm: late, warn: !heatConfounded && driftBpm > LATE_DRIFT_WARN_BPM },
      ],
      source: 'measured',
      driftBpm,
      measuredSplits: n,
      heatSuppressedWarn: heatConfounded && driftBpm > LATE_DRIFT_WARN_BPM,
    };
  }

  const avg = fallback.avgHr;
  if (avg == null || !Number.isFinite(avg) || avg <= 0) return null;

  // ── Fallback · shape only, no claim ────────────────────────────────
  // Kept because an avg + peak still tells the runner roughly where the
  // block sat and whether it topped out well above that. What it does
  // NOT tell them is when. So: no warn flag on any card, and driftBpm is
  // null so no caller can derive a drift verdict from it. The caller is
  // responsible for dropping the measured framing — see `source`.
  const peak = fallback.maxHr ?? avg;
  const climb = Math.max(0, peak - avg);
  return {
    thirds: [
      { label: 'EARLY', bpm: Math.round(avg - climb / 4), warn: false },
      { label: 'MIDDLE', bpm: Math.round(avg), warn: false },
      { label: 'LATE', bpm: Math.round(avg + climb / 2), warn: false },
    ],
    source: 'estimated',
    driftBpm: null,
    measuredSplits: 0,
  };
}

/**
 * Panel heading for a given source.
 *
 * The measured heading is a statement about the run. The estimated one
 * must not be: "SHAPE" and the "from avg + peak" caption say the numbers
 * describe a distribution, not a sequence.
 */
export function hrThirdsHeading(source: HrThirdsSource): string {
  return source === 'measured' ? 'HR ACROSS THE BLOCK' : 'HR SHAPE · ESTIMATED';
}

/** Sub-caption for the estimated path. Null when measured. */
export function hrThirdsCaption(source: HrThirdsSource): string | null {
  return source === 'measured'
    ? null
    : 'Estimated from block average and peak. Per-mile HR not recorded.';
}
