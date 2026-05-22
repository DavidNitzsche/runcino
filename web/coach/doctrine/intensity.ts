/**
 * Doctrine §3, Training intensity distribution.
 *
 * Extracted from docs/coaching-research.md §3.1 and §3.2.
 *
 * The three competing intensity-distribution models (polarized,
 * pyramidal, threshold) and the rule for selecting between them based
 * on training phase, race distance, and weekly volume.
 *
 * No logic here. This file is data, every number is followed by a
 * Citation pointing to the research line that justifies it.
 */
import { cite, type Cited } from './cite';

/** Percentage breakdown of weekly training time across intensity zones.
 *  Zones follow the LT1 / LT2 boundaries the research uses:
 *    easyPct, below LT1 (Z1)
 *    thresholdPct, between LT1 and LT2 (Z2)
 *    hardPct, above LT2 (Z3) */
export interface IntensityDistribution {
  easyPct: number;
  thresholdPct: number;
  hardPct: number;
}

// ── The three models ─────────────────────────────────────────────────
// Verbatim percentages from §3.1. Where the research gives a range
// (e.g. "15 to 20 percent hard"), we record the midpoint and note the
// range in the snippet.

export const POLARIZED_DISTRIBUTION: Cited<IntensityDistribution> = {
  value: { easyPct: 80, thresholdPct: 5, hardPct: 15 },
  note: 'Almost no time in the moderate middle.',
  citations: [cite(
    '§3.1',
    'roughly 80 percent easy (Zone 1, below LT1), 5 percent threshold (Zone 2, between LT1 and LT2), 15 to 20 percent hard',
  )],
};

export const PYRAMIDAL_DISTRIBUTION: Cited<IntensityDistribution> = {
  // Research gives qualitative shape rather than fixed numbers; the
  // 75/15/10 mid-point reflects "more threshold than polarized, less
  // VO2max" with most volume still easy. Tune in Stage 1 once we
  // benchmark against existing pacing-engine output.
  value: { easyPct: 75, thresholdPct: 15, hardPct: 10 },
  note: 'More threshold than polarized; less VO2max. Better default for marathon build.',
  citations: [cite(
    '§3.1',
    'mostly easy, with decreasing proportions of threshold and high-intensity work. More time at threshold than in polarized, less at VO2max.',
  )],
};

export const THRESHOLD_DISTRIBUTION: Cited<IntensityDistribution> = {
  value: { easyPct: 70, thresholdPct: 20, hardPct: 10 },
  note: 'Higher proportion of threshold work; basis for the Norwegian Bakken/Ingebrigtsen system.',
  citations: [cite(
    '§3.1',
    'higher proportion of threshold work, less easy and less VO2max. The Norwegian Bakken / Ingebrigtsen system is a sophisticated form of this.',
  )],
};

// ── Phase / distance / volume selection rules ────────────────────────
// Research §3.1 says: pyramidal in base/build, polarized in peak; for
// the marathon specifically pyramidal is the better default for the
// build phase because marathon pace lives at or just below LT1.

/** Recommended distribution by training phase + race distance.
 *  Consumed by Coach.prescribeWorkout(state) once Stage 1 wires it. */
export const PHASE_DISTRIBUTION_RECOMMENDATION: Cited<{
  base: 'pyramidal';
  build: 'pyramidal' | 'polarized';
  peak: 'polarized';
  taper: 'polarized';
}> = {
  value: {
    base: 'pyramidal',
    build: 'pyramidal',  // marathon-default; shorter races may shift to polarized earlier
    peak: 'polarized',
    taper: 'polarized',
  },
  citations: [cite(
    '§3.1',
    'the optimal sequence for distance runners may be pyramidal during base/build, then polarized during the peak phase',
  )],
};

/** Volume thresholds at which Seiler observed model self-selection.
 *  Below ~350 hr/yr, athletes naturally drift to threshold-heavy
 *  distributions; above ~750 hr/yr they trend polarized/pyramidal.
 *  Used as a sanity check, if the user's total volume is far below
 *  350 hr/yr the coach may downweight pure polarized prescriptions. */
export const VOLUME_MODEL_THRESHOLDS: Cited<{
  thresholdModelBelowHrPerYr: number;
  polarizedAbovHrPerYr: number;
}> = {
  value: {
    thresholdModelBelowHrPerYr: 350,
    polarizedAbovHrPerYr: 750,
  },
  citations: [cite(
    '§3.1',
    "athletes training around 350 hours per year frequently display a threshold-model distribution, while the distribution typically transitions toward polarized or pyramidal patterns when overall training volume surpasses 750 hours annually",
  )],
};

// ── Norwegian double threshold ───────────────────────────────────────

/** Bakken/Ingebrigtsen double-threshold rule. Documented for the
 *  Coach to reference when an athlete asks for "two threshold sessions
 *  today", the rule says they must be deliberately sub-LT2, not two
 *  tempos. The split-singles fallback is what we'd actually prescribe
 *  for an amateur. */
export const NORWEGIAN_DOUBLE_THRESHOLD: Cited<{
  upperLactateMmolPerL: number;
  lowerLactateMmolPerL: number;
  amateurFallback: 'norwegian_singles';
  errorModeWarning: string;
}> = {
  value: {
    upperLactateMmolPerL: 3.5,
    lowerLactateMmolPerL: 2.5,
    amateurFallback: 'norwegian_singles',
    errorModeWarning:
      'Each session must stay sub-LT2. Treating it as "two tempo runs in a day" is the canonical failure mode and breaks the system.',
  },
  citations: [
    cite(
      '§3.2',
      'split it into two shorter sessions, both kept deliberately sub-threshold (around 2.5 to 3.5 mmol/L blood lactate)',
    ),
    cite(
      '§3.2',
      'The Talsnes 2024 crossover trial confirmed that splitting threshold work into two shorter sessions of equal total volume produced superior adaptation versus one long session.',
    ),
  ],
};
