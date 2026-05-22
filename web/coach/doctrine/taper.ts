/**
 * Doctrine §14, Tapering.
 *
 * Extracted from docs/coaching-research.md §14.
 * The mantra: in the final two weeks, the fitness is built. The job is
 * to arrive at the start line rested without losing edge.
 */
import { cite, type Cited } from './cite';

/** Taper duration by race distance. */
export const TAPER_DURATION_WEEKS: Cited<{
  marathon: { low: number; high: number };
  half_marathon: { low: number; high: number };
  tenK: { low: number; high: number };
  fiveK: { low: number; high: number };
}> = {
  value: {
    marathon:      { low: 2, high: 3 },
    half_marathon: { low: 1, high: 2 },
    tenK:          { low: 1, high: 1 },
    fiveK:         { low: 1, high: 1 },
  },
  note: 'Longer tapers offer minimal additional benefit and may produce detraining.',
  citations: [cite('§14', '2 to 3 weeks for marathon distance. Shorter for half marathon and below; longer tapers offer minimal additional benefit and may produce detraining.')],
};

/** Volume-reduction curve. The largest cuts go to easy mileage,
 *  not to quality work. */
export const TAPER_VOLUME_REDUCTION: Cited<{
  /** % cut from peak by end of taper. */
  totalReductionPctLow: number;
  totalReductionPctHigh: number;
  /** Run frequency during taper, % of normal. */
  frequencyPctOfNormal: number;
  /** Where the cuts go. */
  cutAllocation: 'easy_mileage_first';
}> = {
  value: {
    totalReductionPctLow: 40, totalReductionPctHigh: 60,
    frequencyPctOfNormal: 80,
    cutAllocation: 'easy_mileage_first',
  },
  note: 'Frequency stays near 80 %, don\'t suddenly add rest days; keep the body in its rhythm.',
  citations: [
    cite('§14', '40 to 60 percent reduction from peak. The largest cuts go to easy mileage, not to quality work.'),
    cite('§14', 'maintain run frequency at approximately 80 percent of normal'),
  ],
};

/** Intensity preservation rule. */
export const TAPER_INTENSITY_PRESERVATION: Cited<{
  rule: 'preserve_short_sharp_at_race_pace';
  /** Eliminating intensity entirely is detrimental. */
  noIntensityIsBad: true;
}> = {
  value: { rule: 'preserve_short_sharp_at_race_pace', noIntensityIsBad: true },
  note: 'Keep some short, sharp work at race pace through the taper. Eliminating intensity entirely is detrimental.',
  citations: [cite('§14', 'keep some short, sharp work at race pace through the taper. Eliminating intensity entirely is detrimental.')],
};

/** Common taper errors, the things the Coach should call out. */
export const TAPER_ERRORS: Cited<string[]> = {
  value: [
    'cutting intensity along with volume (loses sharpness)',
    'adding novel workouts in the final 10 days (no time to absorb them, only time to fatigue from them)',
    'overcompensating with rest, eating, or napping changes that disrupt normal rhythm',
    'using the freed-up time for extra strength work, foam rolling, or other ancillary stress',
  ],
  citations: [cite('§14', 'Common errors: Cutting intensity along with volume … Adding novel workouts in the final 10 days … Overcompensating with rest, eating, or napping changes')],
};

/** Predicted benefit of a well-executed taper. */
export const TAPER_BENEFIT: Cited<{
  marathonImprovementMinutes: number;
  marathonImprovementSeconds: number;
}> = {
  value: { marathonImprovementMinutes: 5, marathonImprovementSeconds: 32 },
  citations: [cite('§14', 'a well-executed taper has been measured at approximately 5 minutes 32 seconds of marathon improvement on average across one large recreational-runner data set.')],
};
