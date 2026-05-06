/**
 * Doctrine §11 — Heat and altitude as training tools.
 *
 * Extracted from docs/coaching-research.md §11.1, §11.2.
 * For most amateurs heat acclimation is the practical, comparable-
 * magnitude alternative to altitude.
 */
import { cite, type Cited } from '.';

/** Heat acclimation block — produces hematological gains comparable
 *  to altitude (Rønnestad and colleagues, Scandinavian cycling/skiing). */
export const HEAT_ACCLIMATION_BLOCK: Cited<{
  durationWeeksLow: number;
  durationWeeksHigh: number;
  sessionsPerWeek: number;
  sessionMinutes: number;
  /** Hemoglobin mass uplift. */
  hbMassUpliftPctLow: number;
  hbMassUpliftPctHigh: number;
  /** Maintenance dosage. */
  maintenanceSessionsPerWeek: number;
  /** When in the cycle to schedule the block. */
  schedule: 'late_build_phase';
}> = {
  value: {
    durationWeeksLow: 3, durationWeeksHigh: 5,
    sessionsPerWeek: 5,
    sessionMinutes: 50,
    hbMassUpliftPctLow: 2.4, hbMassUpliftPctHigh: 2.6,
    maintenanceSessionsPerWeek: 3,
    schedule: 'late_build_phase',
  },
  note: '5 weeks × 5 × 50-min heat sessions → ~2.5% hemoglobin mass uplift. Easier to maintain than altitude gains; preserve through the taper at 2–3 sessions/week.',
  citations: [
    cite('§11.1', '5 weeks of heat training (5 x 50 min sessions per week in a heat chamber or with a heat suit) produced approximately 2.4 to 2.6 percent increases in hemoglobin mass.'),
    cite('§11.1', 'Heat-induced hemoglobin gains can be maintained with as few as 3 sessions per week.'),
  ],
};

/** Adaptation timing — what changes when. */
export const HEAT_ADAPTATION_TIMING: Cited<{
  plasmaVolumeExpandsByEndOf: 'week_1';
  rbcMassAdaptsWeeksLow: number;
  rbcMassAdaptsWeeksHigh: number;
}> = {
  value: { plasmaVolumeExpandsByEndOf: 'week_1', rbcMassAdaptsWeeksLow: 3, rbcMassAdaptsWeeksHigh: 5 },
  citations: [cite('§11.1', 'Plasma volume expansion happens within the first week of heat exposure. Red blood cell mass and hemoglobin take 3 to 5 weeks.')],
};

/** Practical heat exposure methods, ranked by accessibility. */
export const HEAT_METHODS: Cited<string[]> = {
  value: [
    'sauna sessions of 20–40 minutes post-run',
    'heat suit runs',
    'training in the warmest part of the day during summer months',
  ],
  citations: [cite('§11.1', 'Practical methods: sauna sessions of 20 to 40 minutes post-run, heat suit runs, or training in the warmest part of the day during summer months.')],
};

/** Altitude — gold standard, but reverses fast. For most amateurs,
 *  heat is the practical alternative. */
export const ALTITUDE_PROTOCOL: Cited<{
  liveHighSleepAltitudeMLow: number;
  liveHighSleepAltitudeMHigh: number;
  reverseAfterReturnWeeksLow: number;
  reverseAfterReturnWeeksHigh: number;
}> = {
  value: { liveHighSleepAltitudeMLow: 2000, liveHighSleepAltitudeMHigh: 2500, reverseAfterReturnWeeksLow: 1, reverseAfterReturnWeeksHigh: 2 },
  note: 'Live-high / train-low. Hematological gains reverse within 1–2 weeks of returning to sea level — timing matters.',
  citations: [
    cite('§11.2', 'sleep at 2,000 to 2,500m, train at lower altitude or at lower intensities at altitude'),
    cite('§11.2', 'The hematological gains reverse within 1 to 2 weeks of returning to sea level'),
  ],
};

/** Hot-weather race-day cutoffs. The "we're not running 18 in this"
 *  threshold the Coach voice already references. */
export const HOT_DAY_RACE_CUTOFFS: Cited<{
  /** Above this temp F, recommend earlier start or move long run. */
  startEarlierAboveTempF: number;
  /** Above this temp F, hard cut volume. */
  cutHardAboveTempF: number;
  /** Pace adjustment in s/mi when running by HR not pace. */
  paceSlowdownIfRunningByHrSPerMiLow: number;
  paceSlowdownIfRunningByHrSPerMiHigh: number;
}> = {
  value: {
    startEarlierAboveTempF: 75,
    cutHardAboveTempF: 90,
    paceSlowdownIfRunningByHrSPerMiLow: 30,
    paceSlowdownIfRunningByHrSPerMiHigh: 45,
  },
  note: 'Practical Coach-voice thresholds; not a published rule. Tunable in calibration.',
  citations: [cite('§11.1', 'training in the warmest part of the day during summer months')],
};
