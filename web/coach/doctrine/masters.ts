/**
 * Doctrine §12 — Masters considerations (35+).
 *
 * Extracted from docs/coaching-research.md §12.
 * Age-related performance changes and what they mean for prescription.
 */
import { cite, type Cited } from '.';

/** Decline rates by physiological marker. */
export const AGE_DECLINE_PER_DECADE: Cited<{
  vo2maxPctLow: number;
  vo2maxPctHigh: number;
  /** "Slower than VO2max" qualitative. */
  lactateThreshold: 'declines_slower_than_vo2max';
  /** Largely preserved into the 50s for trained runners. */
  runningEconomy: 'preserved_into_50s';
}> = {
  value: {
    vo2maxPctLow: 5, vo2maxPctHigh: 10,
    lactateThreshold: 'declines_slower_than_vo2max',
    runningEconomy: 'preserved_into_50s',
  },
  citations: [
    cite('§12', 'VO2max declines roughly 5 to 10 percent per decade after age 30.'),
    cite('§12', 'Lactate threshold declines more slowly than VO2max.'),
    cite('§12', 'Running economy is largely preserved into the 50s for trained runners.'),
  ],
};

/** Performance-curve waypoints. */
export const PERFORMANCE_AGE_CURVE: Cited<{
  wellMaintainedThroughAge: number;
  moderateDeclineToAge: number;
  abruptDeclineFromAge: number;
  peakMarathonAgeLow: number;
  peakMarathonAgeHigh: number;
}> = {
  value: {
    wellMaintainedThroughAge: 35,
    moderateDeclineToAge: 60,
    abruptDeclineFromAge: 60,
    peakMarathonAgeLow: 30, peakMarathonAgeHigh: 40,
  },
  citations: [
    cite('§12', 'Performance is well maintained until approximately age 35, with moderate decreases until 50 to 60 years, then more abrupt decline.'),
    cite('§12', 'The peak marathon ages for most runners sit between 30 and 40.'),
  ],
};

/** Practical adjustments for masters runners (35+). */
export const MASTERS_ADJUSTMENTS: Cited<{
  /** VO2max work emphasis (counter-intuitive — more, not less). */
  vo2EmphasisShouldIncrease: true;
  /** Two hard sessions/week often beats three after 45. */
  hardSessionsPerWeekAfter45: number;
  /** Total weekly mileage may need to drop vs younger version. */
  weeklyMileageDropPctLow: number;
  weeklyMileageDropPctHigh: number;
  strengthEmphasisShouldIncrease: true;
  sleepNeedsMayIncrease: true;
}> = {
  value: {
    vo2EmphasisShouldIncrease: true,
    hardSessionsPerWeekAfter45: 2,
    weeklyMileageDropPctLow: 10, weeklyMileageDropPctHigh: 20,
    strengthEmphasisShouldIncrease: true,
    sleepNeedsMayIncrease: true,
  },
  note: 'For runners in late 30s / early 40s, "masters" considerations are not yet aggressive. Performance can plateau or improve via better organization, recovery, and ancillary work.',
  citations: [
    cite('§12', 'VO2max-targeted work … may need more emphasis, not less, as a runner ages. The decline is the limiter.'),
    cite('§12', 'Strength training becomes more important, not less.'),
    cite('§12', 'Two hard sessions per week often beats three for masters runners, especially after 45.'),
    cite('§12', 'Total weekly mileage may need to drop 10 to 20 percent compared to a younger version of the same runner'),
  ],
};
