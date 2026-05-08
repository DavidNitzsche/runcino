/**
 * Doctrine §6 — Strength training for runners.
 *
 * Extracted from docs/coaching-research.md §6.1, §6.2, §6.3 and
 * docs/amp-research.md (Amp resistance modes used by amp-workouts.ts).
 */
import { cite, type Cited } from './cite';

export type RunPhase = 'base' | 'build' | 'peak' | 'taper';

/** Heavy resistance — what "heavy" means for a runner. */
export const HEAVY_RESISTANCE: Cited<{
  pct1RMLow: number;
  pct1RMHigh: number;
  repsPerSetLow: number;
  repsPerSetHigh: number;
  setsLow: number;
  setsHigh: number;
  /** Adaptation appears at this duration. */
  durationWeeksMin: number;
  /** Improvement target — running economy, not VO2 / HR / lactate. */
  primaryAdaptation: 'running_economy';
}> = {
  value: {
    pct1RMLow: 80, pct1RMHigh: 90,
    repsPerSetLow: 3, repsPerSetHigh: 6,
    setsLow: 3, setsHigh: 5,
    durationWeeksMin: 10,
    primaryAdaptation: 'running_economy',
  },
  note: 'Neural and tendon-stiffness focused — not bodybuilding, not muscle-endurance reps.',
  citations: [
    cite('§6.1', 'Heavy resistance training with loads above 80 percent of 1RM (often 90 percent) improves running economy and time-trial performance more than plyometric training alone.'),
    cite('§6.1', 'The benefit appears at training durations of 10+ weeks'),
    cite('§6.2', 'Loaded with weight that allows 3 to 6 reps for 3 to 5 sets'),
  ],
};

/** Plyometric work — improves running economy at slower paces. */
export const PLYOMETRICS: Cited<{
  setsLow: number;
  setsHigh: number;
  contactsPerSetLow: number;
  contactsPerSetHigh: number;
  /** Pace below which plyos shine (s/mi). 12 km/h ≈ 8:00/mi. */
  beneficialAtPaceSlowerThanSPerMi: number;
}> = {
  value: { setsLow: 3, setsHigh: 5, contactsPerSetLow: 5, contactsPerSetHigh: 10, beneficialAtPaceSlowerThanSPerMi: 480 },
  note: 'Pogo hops, jump squats, box jumps, depth jumps. Fully recovered between sets.',
  citations: [
    cite('§6.2', '3 to 5 sets of 5 to 10 contacts, fully recovered between sets'),
    cite('§6.1', 'Plyometrics improve running economy at slower paces (below about 12 km/h, or roughly 8:00 per mile)'),
  ],
};

/** Strength sessions per week, by run phase. Strength periodization
 *  intentionally opposes the running cycle: high-load when run intensity
 *  is low, drop intensity as run intensity rises. */
export const STRENGTH_PERIODIZATION: Cited<Record<RunPhase, {
  sessionsPerWeek: number;
  /** What the sessions emphasize. */
  emphasis: 'heavy' | 'heavy_plus_power' | 'maintain' | 'drop';
  /** Sessions to drop entirely in the final stretch (taper week 2). */
  dropEntirelyDaysBeforeRace?: number;
}>> = {
  value: {
    base:  { sessionsPerWeek: 2, emphasis: 'heavy' },
    build: { sessionsPerWeek: 2, emphasis: 'heavy_plus_power' },
    peak:  { sessionsPerWeek: 1, emphasis: 'maintain' },
    taper: { sessionsPerWeek: 1, emphasis: 'drop', dropEntirelyDaysBeforeRace: 10 },
  },
  note: 'Most common error: same routine year-round at moderate intensity. Enough to fatigue without driving adaptations.',
  citations: [
    cite('§6.3', 'Base phase: 2 sessions per week, heavy.'),
    cite('§6.3', 'Build phase: 2 sessions per week, one heavy and one focused on power / plyometrics.'),
    cite('§6.3', 'Peak / specific phase: 1 to 2 sessions per week, lower volume, maintaining intensity.'),
    cite('§6.3', 'Taper: 1 short session in the first taper week. Drop strength work entirely in the final 7 to 10 days.'),
  ],
};

/** Strength's injury-prevention dividend across meta-analyses. */
export const STRENGTH_INJURY_REDUCTION_PCT: Cited<number> = {
  value: 50,
  note: 'One of the highest-leverage injury-prevention interventions available.',
  citations: [cite('§13.2', 'Strength training reduces injury risk by approximately half across multiple meta-analyses.')],
};

/** Amp-specific resistance modes. From amp-research.md.
 *  amp-workouts.ts already references these — formalize here. */
export const AMP_MODES: Cited<{
  fixed: { description: string };
  band: { description: string };
  eccentric: { description: string };
  tempo: { description: string };
  dropSet: { description: string };
}> = {
  value: {
    fixed: { description: 'Constant resistance throughout the rep — equivalent to lifting a barbell.' },
    band: { description: 'Resistance increases as you stretch the cable — peak load at end-range.' },
    eccentric: { description: 'Heavier on the lowering phase than the lifting phase. The Amplify mode.' },
    tempo: { description: 'Cadence-controlled reps — useful for power and rhythm.' },
    dropSet: { description: 'Auto-decreases load as fatigue accumulates within a set.' },
  },
  citations: [cite('§3.1', 'Fixed mode … constant resistance', 'amp')],
};
