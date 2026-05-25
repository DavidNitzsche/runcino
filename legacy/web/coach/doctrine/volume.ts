/**
 * Doctrine §4, Base / maintenance training: weekly volume.
 *
 * Extracted from docs/coaching-research.md §4.1, §4.2, §4.3.
 * What easy volume actually does, how much is realistic, and how to
 * structure maintenance phases between cycles.
 */
import { cite, type Cited } from './cite';

/** Easy-pace anchors used to define what "easy aerobic running" means. */
export const EASY_PACE_ANCHORS: Cited<{
  hrPctOfMaxLow: number;
  hrPctOfMaxHigh: number;
  /** s/mi slower than marathon pace, low end of easy band */
  marathonPaceOffsetSPerMiLow: number;
  marathonPaceOffsetSPerMiHigh: number;
}> = {
  value: {
    hrPctOfMaxLow: 65,
    hrPctOfMaxHigh: 75,
    marathonPaceOffsetSPerMiLow: 60,
    marathonPaceOffsetSPerMiHigh: 90,
  },
  note: 'Easy aerobic = 65–75% max HR or 60–90 s/mi slower than marathon pace.',
  citations: [cite('§4.1', 'roughly 65 to 75 percent of max heart rate or about 60 to 90 seconds per mile slower than marathon pace')],
};

/** Peak-week mileage tiers for marathon training. */
export const PEAK_WEEK_VOLUME_MI: Cited<{
  worldClassLow: number;
  worldClassHigh: number;
  amateurRealisticLow: number;
  amateurRealisticHigh: number;
  amateurStretchLow: number;
  amateurStretchHigh: number;
  hardCeilingForMostAmateurs: number;
}> = {
  value: {
    worldClassLow: 100, worldClassHigh: 160,
    amateurRealisticLow: 50, amateurRealisticHigh: 70,
    amateurStretchLow: 70, amateurStretchHigh: 85,
    hardCeilingForMostAmateurs: 85,
  },
  note: 'Above 85 mpw, diminishing returns + injury risk are real for runners without years of base.',
  citations: [
    cite('§4.2', 'world-class distance runners reviewed by Tjelta and colleagues run 100 to 160 miles per week at marathon training peak'),
    cite('§4.2', 'For competitive amateurs, peak weeks of 50 to 70 miles are realistic and effective. Pushing toward 70 to 85 will likely yield further gains'),
  ],
};

/** Weekly mileage allocation for general aerobic / endurance work. */
export const GA_PCT_OF_WEEKLY_MILEAGE: Cited<{ low: number; high: number }> = {
  value: { low: 50, high: 70 },
  note: 'GA/endurance is the bread and butter, 50–70 % of weekly mileage for most runners.',
  citations: [cite('§5.2', 'For most runners these account for 50 to 70 percent of total weekly mileage.')],
};

/** Maintenance phase between marathon cycles. */
export const MAINTENANCE_BLOCK: Cited<{
  durationWeeksLow: number;
  durationWeeksHigh: number;
  pctOfPeakVolumeLow: number;
  pctOfPeakVolumeHigh: number;
  daysPerWeekLow: number;
  daysPerWeekHigh: number;
  qualitySessionsPerWeek: number;
  longRunMinutesLow: number;
  longRunMinutesHigh: number;
  stridesPerWeekLow: number;
  stridesPerWeekHigh: number;
}> = {
  value: {
    durationWeeksLow: 4, durationWeeksHigh: 12,
    pctOfPeakVolumeLow: 50, pctOfPeakVolumeHigh: 70,
    daysPerWeekLow: 5, daysPerWeekHigh: 6,
    qualitySessionsPerWeek: 1,
    longRunMinutesLow: 90, longRunMinutesHigh: 120,
    stridesPerWeekLow: 2, stridesPerWeekHigh: 3,
  },
  note: 'Keep the engine warm; chase shorter race goals (5K/10K) here to raise the marathon ceiling.',
  citations: [
    cite('§4.3', '50 to 70 percent of peak marathon volume; 5 to 6 days per week; one quality session per week'),
    cite('§4.3', 'One long run of 90 to 120 minutes, easy effort'),
    cite('§4.3', 'Strides 2 to 3 times per week to preserve neuromuscular sharpness'),
  ],
};

/** Weekly volume progression rules, Research/00a §Volume progression rules. */
export const VOLUME_PROGRESSION: Cited<{
  /** Conservative weekly increase cap for trained athletes (pct). */
  weeklyIncreaseCapPct: number;
  /** Single-session long-run spike cap vs prior longest long run (pct).
   *  Exceeding raises injury risk significantly. */
  singleSessionSpikeCapPctOfPriorLongRun: number;
  /** Injury risk increase when spike cap exceeded, Gabbett 2016. */
  injuryRiskIncreasePct: number;
}> = {
  value: {
    weeklyIncreaseCapPct: 10,
    singleSessionSpikeCapPctOfPriorLongRun: 110,
    injuryRiskIncreasePct: 64,
  },
  note: '10%/week is the conservative cap; single-session spikes >110% of prior longest run raise injury risk 64%.',
  citations: [
    cite('§Volume progression rules', '5–15% weekly increase for trained athletes; accumulate volume gradually in cycles', 'research', '00a'),
    cite('§Volume progression rules', 'Single-session spike >110% of prior longest long run raises injury risk 64%', 'research', '00a'),
  ],
};

/** Cutback / down-week rules, every 3rd or 4th week. */
export const CUTBACK_WEEK_RULES: Cited<{
  /** How often to take a down week (weeks of build before cutback). */
  frequencyWeeksLow: number;
  frequencyWeeksHigh: number;
  /** Volume reduction from the preceding build week (pct). */
  volumeReductionPctLow: number;
  volumeReductionPctHigh: number;
}> = {
  value: {
    frequencyWeeksLow: 3,
    frequencyWeeksHigh: 4,
    volumeReductionPctLow: 20,
    volumeReductionPctHigh: 30,
  },
  note: 'Pattern: 3 weeks build, 1 week cutback (or 4 + 1). Reduces volume 20–30% from build peak.',
  citations: [
    cite('§Volume progression rules', 'Every 3–4 weeks, reduce volume 20–30% from peak', 'research', '00a'),
  ],
};

/** Taper rules by race distance. */
export const TAPER_VOLUME_RULES: Cited<{
  volumeReductionPctFromPeakLow: number;
  volumeReductionPctFromPeakHigh: number;
  durationWeeksByDistance: {
    fiveK: number;
    tenK: number;
    halfMarathon: number;
    marathon: { low: number; high: number };
  };
}> = {
  value: {
    volumeReductionPctFromPeakLow: 50,
    volumeReductionPctFromPeakHigh: 70,
    durationWeeksByDistance: {
      fiveK: 2,
      tenK: 2,
      halfMarathon: 3,
      marathon: { low: 3, high: 4 },
    },
  },
  note: 'Taper reduces 50–70% from peak weekly volume. Intensity preserved, volume drops, quality touches remain.',
  citations: [
    cite('§12 Tapering', 'Reduce 50–70% from peak weekly volume over 2–4 weeks depending on race distance', 'research', '00a'),
  ],
};

/** Recovery period after a marathon, by peak weekly volume. */
export const POST_MARATHON_RECOVERY: Cited<{
  peak70mpwWeeksLow: number;
  peak70mpwWeeksHigh: number;
  peak100plusMpwWeeksLow: number;
  peak100plusMpwWeeksHigh: number;
  pctOfPeakDuringRecoveryLow: number;
  pctOfPeakDuringRecoveryHigh: number;
}> = {
  value: {
    peak70mpwWeeksLow: 2, peak70mpwWeeksHigh: 4,
    peak100plusMpwWeeksLow: 3, peak100plusMpwWeeksHigh: 6,
    pctOfPeakDuringRecoveryLow: 30, pctOfPeakDuringRecoveryHigh: 50,
  },
  note: 'Easy mileage at 30–50 % of peak. The "1 day per mile" rule is overly conservative for experienced runners doing easy running.',
  citations: [cite('§13.3', 'A runner who peaks at 70 mpw and runs a marathon needs 2 to 4 weeks of substantially reduced training before returning to focused work.')],
};
