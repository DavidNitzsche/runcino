/**
 * Doctrine §8 — Recovery: sleep, modalities, and the hard/easy ratio.
 *
 * Extracted from docs/coaching-research.md §8.1, §8.2, §8.3.
 */
import { cite, type Cited } from './cite';

/** Sleep is the single highest-leverage recovery variable. */
export const SLEEP: Cited<{
  generalHoursLow: number;
  generalHoursHigh: number;
  highLoadHoursLow: number;
  highLoadHoursHigh: number;
  /** Pre-race "sleep banking" window in nights. */
  preRaceSleepBankingNightsLow: number;
  preRaceSleepBankingNightsHigh: number;
  napMinutesLow: number;
  napMinutesHigh: number;
}> = {
  value: {
    generalHoursLow: 7, generalHoursHigh: 9,
    highLoadHoursLow: 8, highLoadHoursHigh: 10,
    preRaceSleepBankingNightsLow: 3, preRaceSleepBankingNightsHigh: 7,
    napMinutesLow: 20, napMinutesHigh: 90,
  },
  note: '50–80 % of elite athletes report disturbed sleep. Prioritization beats accident.',
  citations: [
    cite('§8.1', '7 to 9 hours per night is the general recommendation, with 8 to 10 hours often suggested for high-load training periods'),
    cite('§8.1', 'Sleep extension before key races (3 to 7 nights of "sleep banking")'),
    cite('§8.1', 'Naps of 20 to 90 minutes can complement night sleep'),
  ],
};

export type RecoveryEvidence = 'high' | 'moderate' | 'mixed' | 'low';

/** Recovery modality evidence ranking. */
export const RECOVERY_MODALITIES: Cited<Record<string, { evidence: RecoveryEvidence; note?: string }>> = {
  value: {
    sleep:                       { evidence: 'high' },
    nutrition_timing:            { evidence: 'high', note: 'Carbs + protein within 30–60 min post-workout.' },
    active_recovery:             { evidence: 'high', note: 'Easy spinning or jogging at very low intensity.' },
    compression_during_travel:   { evidence: 'high' },
    compression_boots:           { evidence: 'moderate', note: 'Subjective recovery + soreness reduction; modest objective effects.' },
    massage:                     { evidence: 'moderate' },
    foam_rolling:                { evidence: 'moderate' },
    cold_water_immersion:        { evidence: 'mixed', note: 'Useful tactically near races; chronic use may blunt mitochondrial / hypertrophy adaptations.' },
    sauna:                       { evidence: 'low', note: 'Real benefit lives in heat acclimation, not pure recovery.' },
    contrast_therapy:            { evidence: 'low' },
    iv_therapy:                  { evidence: 'low' },
  },
  citations: [
    cite('§8.2', 'High-evidence: Sleep, nutrition timing (carbs and protein within 30 to 60 minutes post-workout), active recovery, compression garments during travel.'),
    cite('§8.2', 'Mixed evidence: Cold water immersion. … post-workout cold immersion may blunt long-term adaptive responses'),
  ],
};

/** Recovery time between hard sessions, by stress. */
export const HARD_SESSION_RECOVERY: Cited<{
  /** Hours of recovery between two hard efforts. */
  hoursLow: number;
  hoursHigh: number;
  /** Two hard back-to-back is OK only if intensities differ
   *  substantially (e.g. long run after track). */
  backToBackRule: string;
}> = {
  value: {
    hoursLow: 24, hoursHigh: 72,
    backToBackRule: 'Two hard sessions back-to-back only if intensities are substantially different (e.g. long run after track), unless using the Norwegian double-threshold method.',
  },
  citations: [
    cite('§8.3', 'every hard training stress requires a recovery period of 24 to 72 hours'),
    cite('§8.3', 'Stack two hard efforts back to back only if the second is at substantially different intensity'),
  ],
};
