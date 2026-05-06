/**
 * Doctrine — Post-race recovery progression.
 *
 * Source: docs/coaching-research.md §13.3 (recovery between cycles)
 * and §8.3 (recovery ratio for hard efforts).
 *
 * The research is explicit only about the marathon. Half-marathon,
 * 10K, and 5K windows are scaled extrapolations of the same logic
 * (24-72h hard-stress recovery + 1-day-per-mile to structured work)
 * because the research doesn't enumerate them. Each scaling is noted
 * inline so a future reader can challenge it.
 */
import { cite, type Cited } from '.';

/** §8.3 — Recovery period after any hard training stress. The post-race
 *  rest stage is bounded by this rule. The high end (72h) applies to
 *  the most stressful efforts (marathon); the low end (24h) covers
 *  shorter sharp efforts. */
export const HARD_STRESS_RECOVERY_HOURS: Cited<{
  low: number;
  high: number;
}> = {
  value: { low: 24, high: 72 },
  citations: [
    cite('§8.3', 'every hard training stress requires a recovery period of 24 to 72 hours depending on the stress'),
  ],
};

/** §13.3 — Post-marathon reduced-training window for a runner peaking
 *  at ~70 mpw. Higher-volume runners scale up. */
export const POST_MARATHON_REDUCED_TRAINING_WEEKS: Cited<{
  /** For a runner peaking at ~70 mpw. */
  weeksLow: number;
  weeksHigh: number;
  /** For a runner peaking at 100+ mpw. */
  highVolumeWeeksLow: number;
  highVolumeWeeksHigh: number;
}> = {
  value: { weeksLow: 2, weeksHigh: 4, highVolumeWeeksLow: 3, highVolumeWeeksHigh: 6 },
  citations: [
    cite('§13.3', 'A runner who peaks at 70 mpw and runs a marathon needs 2 to 4 weeks of substantially reduced training before returning to focused work. A runner peaking at 100+ mpw may need 3 to 6 weeks.'),
  ],
};

/** §13.3 — Volume target during the reduced-training window. */
export const POST_RACE_REDUCED_VOLUME_FRACTION: Cited<{
  fractionLow: number;
  fractionHigh: number;
}> = {
  value: { fractionLow: 0.30, fractionHigh: 0.50 },
  note: 'No quality work during this window — easy mileage only.',
  citations: [
    cite('§13.3', 'easy mileage at 30 to 50 percent of peak, no quality work, and active monitoring of resting heart rate and subjective fatigue'),
  ],
};

/** §13.3 — Time before resuming structured workouts. The "1 day per
 *  race-mile" guideline. The research notes it's overly conservative
 *  for *easy running* (recovery jogs are fine sooner) but a useful
 *  frame for when *quality work* should return. */
export const STRUCTURED_RETURN_DAYS_PER_RACE_MILE: Cited<{
  daysPerRaceMile: number;
}> = {
  value: { daysPerRaceMile: 1 },
  note: 'Bounds when structured/quality workouts can resume. Easy running can return well before this.',
  citations: [
    cite('§13.3', 'The 1 day per mile guideline (26 days of "recovery" after a marathon) is overly conservative for experienced runners doing easy running, but a useful frame for the time before resuming structured workouts'),
  ],
};

/** Stage cutoffs the engine uses to graduate from rest → recovery jog
 *  → easy aerobic → return-to-base. Derived from §8.3 + §13.3:
 *
 *  - REST stage: bounded by §8.3's 24-72h rule, scaled by race
 *    intensity. Marathon = full 72h (3 days); half = ~48h (2 days);
 *    shorter = 24h (1 day).
 *  - LIGHT recovery: light recovery jogs (§8.1 active recovery).
 *    Window length scales linearly with race distance.
 *  - EASY: general aerobic at base volume but no quality (§13.3
 *    "no quality work" while inside the recovery window).
 *
 *  Heavy-block stacking (multiple races within ~30 days, doctrine on
 *  load.ts) extends the reduced-volume window — the time before
 *  structured work returns — by ~1.8x. This scaling is engine-internal
 *  and not directly cited in §13.3; it preserves the research's
 *  "higher peak load → longer reduced-volume window" relationship
 *  applied to acute multi-race blocks. */
export const POST_RACE_STAGES: Cited<{
  stages: Array<{
    /** Race distance band — applies when biggest recent race is ≥ this. */
    minRaceMi: number;
    /** Last day-since-race that's full rest (§8.3 envelope). */
    restEndDay: number;
    /** Last day-since-race in the light recovery jog window. */
    lightEndDay: number;
    /** Last day-since-race in the easy aerobic window
     *  (§13.3 reduced-training, no quality). */
    easyEndDay: number;
  }>;
  heavyBlockMultiplier: number;
}> = {
  value: {
    stages: [
      // Marathon — 14-day total recovery window aligns with §13.3's
      // "2 to 4 weeks of substantially reduced training" (low end).
      { minRaceMi: 22, restEndDay: 3, lightEndDay: 7, easyEndDay: 14 },
      // Half marathon — half the marathon impact, half the windows.
      { minRaceMi: 11, restEndDay: 2, lightEndDay: 5, easyEndDay: 9 },
      // Shorter (10K / 5K) — 24h rest envelope per §8.3, short ramp.
      { minRaceMi: 0,  restEndDay: 1, lightEndDay: 3, easyEndDay: 5 },
    ],
    heavyBlockMultiplier: 1.8,
  },
  note: 'Stage durations are engine-derived from §8.3 + §13.3. Marathon (14d total) aligns with §13.3\'s low-end "2 weeks reduced training". Half + 10K windows scale linearly down — these are extrapolations the research doesn\'t enumerate explicitly.',
  citations: [
    cite('§8.3', 'every hard training stress requires a recovery period of 24 to 72 hours depending on the stress'),
    cite('§13.3', 'A runner who peaks at 70 mpw and runs a marathon needs 2 to 4 weeks of substantially reduced training'),
    cite('§13.3', 'easy mileage at 30 to 50 percent of peak, no quality work'),
  ],
};
