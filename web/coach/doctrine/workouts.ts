/**
 * Doctrine §5 — The primary workout types.
 *
 * Extracted from docs/coaching-research.md §5.1 through §5.8.
 * Each workout type's purpose, structure, and pace anchor.
 */
import { cite, type Cited } from '.';

export type WorkoutType =
  | 'recovery'
  | 'general_aerobic'
  | 'medium_long'
  | 'long_steady'
  | 'long_progression'
  | 'long_mp_block'
  | 'long_fast_finish'
  | 'long_dress_rehearsal'
  | 'tempo_continuous'
  | 'threshold_intervals'
  | 'sub_threshold'
  | 'long_tempo'
  | 'vo2'
  | 'marathon_specific_combo'
  | 'marathon_specific_long'
  | 'strides'
  | 'hill_sprints';

/** Recovery run — circulation, not adaptation. */
export const RECOVERY_RUN: Cited<{
  durationMinLow: number;
  durationMinHigh: number;
  paceNote: string;
}> = {
  value: { durationMinLow: 30, durationMinHigh: 50, paceNote: 'truly easy, often well below conversational pace' },
  citations: [cite('§5.1', 'Truly easy, often well below conversational pace. 30 to 50 minutes.')],
};

/** General aerobic / endurance run. */
export const GENERAL_AEROBIC: Cited<{
  durationMinLow: number;
  durationMinHigh: number;
  pctSlowerThanMpLow: number;
  pctSlowerThanMpHigh: number;
}> = {
  value: { durationMinLow: 60, durationMinHigh: 90, pctSlowerThanMpLow: 15, pctSlowerThanMpHigh: 25 },
  note: 'Easy but not slow. Bread and butter aerobic adaptation.',
  citations: [cite('§5.2', '60 to 90 minutes at an easy but not slow pace, roughly 15 to 25 percent slower than marathon pace')],
};

/** Pfitzinger medium-long run — second weekly run, distinct from long. */
export const MEDIUM_LONG: Cited<{
  distanceMiLow: number;
  distanceMiHigh: number;
  paceAnchor: 'endurance';
  perWeekRecommended: number;
}> = {
  value: { distanceMiLow: 11, distanceMiHigh: 15, paceAnchor: 'endurance', perWeekRecommended: 1 },
  note: 'One per week is good. Two per week separates serious marathoners from the field.',
  citations: [cite('§5.3', "A second weekly run of 11 to 15 miles, distinct from the long run. … Two per week separates serious marathoners from the field.")],
};

/** Long run — distance + duration anchors and the variants. */
export const LONG_RUN: Cited<{
  distanceMiLow: number;
  distanceMiHigh: number;
  durationHrLow: number;
  durationHrHigh: number;
  /** Cap of long runs over 18 mi during build + peak. */
  longRunsOver18MiLow: number;
  longRunsOver18MiHigh: number;
  /** The 90-min threshold below which it isn't really a long run. */
  thresholdMinutes: number;
}> = {
  value: {
    distanceMiLow: 16, distanceMiHigh: 22,
    durationHrLow: 2, durationHrHigh: 3,
    longRunsOver18MiLow: 4, longRunsOver18MiHigh: 7,
    thresholdMinutes: 90,
  },
  note: 'Below 90 min the work is largely aerobic; above it, fast-twitch recruitment into aerobic metabolism is the marathon adaptation.',
  citations: [
    cite('§5.4', '16 to 22 miles or 2 to 3 hours.'),
    cite('§5.4', 'A mature marathon plan includes 4 to 7 long runs over 18 miles in the build and peak phases.'),
    cite('§5.4', 'The 90-minute threshold matters.'),
  ],
};

/** Long-run variant: progression. */
export const LONG_PROGRESSION: Cited<{
  finishMilesLow: number;
  finishMilesHigh: number;
  finishPaceOffsetSPerMi: number; // negative = faster
}> = {
  value: { finishMilesLow: 4, finishMilesHigh: 8, finishPaceOffsetSPerMi: -30 },
  note: 'Pfitzinger: final 4–8 miles ramp from MP+30 toward MP at the end.',
  citations: [cite('§5.4', 'start at easy pace, finish the last 4 to 8 miles at marathon pace or slightly faster')],
};

/** Marathon-pace long run — most race-specific workout. */
export const LONG_MP_BLOCK: Cited<{
  totalMiLow: number;
  totalMiHigh: number;
  mpBlockMiLow: number;
  mpBlockMiHigh: number;
}> = {
  value: { totalMiLow: 14, totalMiHigh: 22, mpBlockMiLow: 8, mpBlockMiHigh: 14 },
  note: 'The single most race-specific workout in marathon training. Schedule 3–5 weeks before race day.',
  citations: [
    cite('§5.4', '14 to 22 miles total with 8 to 14 miles at goal MP'),
    cite('§5.7', 'probably the single most predictive workout of marathon outcome'),
  ],
};

/** Hanson "fast finish" long run. */
export const LONG_FAST_FINISH: Cited<{
  totalMiLow: number;
  totalMiHigh: number;
  finishMiLow: number;
  finishMiHigh: number;
  finishPaceAnchor: 'half_marathon';
}> = {
  value: { totalMiLow: 16, totalMiHigh: 18, finishMiLow: 2, finishMiHigh: 4, finishPaceAnchor: 'half_marathon' },
  note: 'High training stress, high specificity to closing strong on tired legs.',
  citations: [cite('§5.4', '16 to 18 miles with the final 2 to 4 miles well below MP (closer to half marathon pace)')],
};

/** Threshold workout structures. */
export const TEMPO_CONTINUOUS: Cited<{ miLow: number; miHigh: number; paceAnchor: 'threshold' }> = {
  value: { miLow: 4, miHigh: 8, paceAnchor: 'threshold' },
  citations: [cite('§5.5', '4 to 8 miles at threshold pace (approximately 15K to half marathon effort)')],
};

export const THRESHOLD_INTERVALS: Cited<{
  miReps: number;
  repsLow: number;
  repsHigh: number;
  recoveryJogSecLow: number;
  recoveryJogSecHigh: number;
}> = {
  value: { miReps: 1, repsLow: 4, repsHigh: 6, recoveryJogSecLow: 60, recoveryJogSecHigh: 90 },
  note: "Daniels' staple: 4–6 × 1 mile at threshold with 60–90 s jog. Higher total time at intensity than a continuous tempo.",
  citations: [cite('§5.5', '4 to 6 x 1 mile at threshold pace with 60 to 90 seconds jog recovery')],
};

export const SUB_THRESHOLD: Cited<{
  miRepsLow: number;
  miRepsHigh: number;
  paceNote: string;
}> = {
  value: { miRepsLow: 5, miRepsHigh: 8, paceNote: 'just below LT2 — the Norwegian-singles adaptation' },
  citations: [cite('§5.5', 'longer total volume (5 to 8 x 1 mile) at slightly easier pace (just below LT2)')],
};

/** VO2max work — secondary importance for marathon training. */
export const VO2_INTERVALS: Cited<{
  totalWorkMiLow: number;
  totalWorkMiHigh: number;
  paceAnchor: '3K_to_5K';
  pctVO2maxLow: number;
  pctVO2maxHigh: number;
  recoveryFractionOfWorkLow: number; // 0.5 = 50%
  recoveryFractionOfWorkHigh: number;
}> = {
  value: {
    totalWorkMiLow: 3, totalWorkMiHigh: 6,
    paceAnchor: '3K_to_5K',
    pctVO2maxLow: 95, pctVO2maxHigh: 100,
    recoveryFractionOfWorkLow: 0.5, recoveryFractionOfWorkHigh: 1.0,
  },
  note: 'For marathon training, secondary importance — raises the ceiling so MP feels easier, but doesn\'t directly train the marathon energy system. One per week during build, transitioning out in the specific phase.',
  citations: [
    cite('§5.6', '95 to 100 percent of VO2max … total work volume around 3 to 6 miles'),
    cite('§5.6', 'recoveries that are 50 to 100 percent of the work interval duration'),
  ],
};

/** Strides — short bursts of fast running, neuromuscular maintenance. */
export const STRIDES: Cited<{
  distanceMLow: number;
  distanceMHigh: number;
  repsLow: number;
  repsHigh: number;
  perWeekLow: number;
  perWeekHigh: number;
}> = {
  value: { distanceMLow: 80, distanceMHigh: 100, repsLow: 6, repsHigh: 10, perWeekLow: 2, perWeekHigh: 3 },
  note: 'Consistently underused by recreational marathoners and consistently emphasized by elite coaches.',
  citations: [cite('§5.8', '80 to 100m at near-sprint pace, 6 to 10 reps with full recovery. … 2 to 3 times per week')],
};

/** Hill sprints — same neuromuscular stimulus, lower injury risk. */
export const HILL_SPRINTS: Cited<{
  durationSLow: number;
  durationSHigh: number;
  effortNote: string;
}> = {
  value: { durationSLow: 8, durationSHigh: 12, effortNote: 'all-out, on a steep hill' },
  citations: [cite('§5.8', '8 to 12 seconds, all-out, on a steep hill')],
};

/** Pace offsets for the easy-pace floor used in pacing.ts. Easy
 *  honestly is harder than the threshold day — these numbers tell the
 *  Coach when an "easy" run drifted too fast. */
export const EASY_PACE_FLOOR: Cited<{
  /** s/mi slower than goal marathon pace, minimum. */
  minSlowerThanMpSPerMi: number;
}> = {
  value: { minSlowerThanMpSPerMi: 60 },
  note: 'Floor; closer to 90+ for high-volume runners.',
  citations: [cite('§4.1', '60 to 90 seconds per mile slower than marathon pace')],
};
