/**
 * Fitness types + pure formatters — safe for client AND server.
 *
 * The full fitness-resolver.ts module hits Postgres so it can only
 * run on the server. Client islands (the workout modal, training
 * cells) need the SHAPE of ResolvedFitness so they can consume what
 * the server passes them via API, plus the pure-string formatters.
 * Those live here.
 */

import type { DanielsPaceSet } from './vdot';

export interface FitnessActiveRace {
  slug: string;
  name: string;
  date: string;
  daysAway: number;
  distanceMi: number;
  goalDisplay: string;
  goalFinishS: number;
  goalPaceSPerMi: number;
  priority: 'A' | 'B' | 'C';
}

export interface FitnessVdot {
  value: number;
  source: 'aggregate' | 'single-race' | 'level-default' | 'none';
  sourceLabel?: string;
  contributors: Array<{
    name: string;
    date: string;
    distanceMi: number;
    finishS: number;
    vdot: number;
    /** Provenance of finishS — 'races' = curated chip time, 'strava' = raw Strava. */
    source?: 'races' | 'strava';
    /** Total weight in the aggregate (recency × length × tier). */
    weight?: number;
    /** True when this contributor's distance tier matches the goal tier. */
    isGoalTier?: boolean;
    /** True when the race date falls within the current cycle window. */
    isInCycle?: boolean;
    /** Recency component of weight (exp decay, 1.0 = full / exempt). */
    recency?: number;
    /** Tier-match component (3.0 exact / 1.0 adjacent / 0.4 distant). */
    tierFactor?: number;
    /** Length component (sqrt(km/10)). */
    lengthFactor?: number;
    /** Race-effort multiplier (A=1.0, B=0.7, C=0.4, tune-up=0.4,
     *  training-run=0.2, hilly-excluded=0.0). */
    effortFactor?: number;
    /** Race priority / effort level from meta.priority. */
    priority?: 'A' | 'B' | 'C' | 'tune-up' | 'training-run' | 'hilly-excluded';
  }>;
  /** Goal race tier used for tier-factor scoring in the aggregate. */
  goalTier?: 'SPRINT' | 'TEN_K_ISH' | 'HM_ISH' | 'M_ISH' | null;
  /** Cycle window start (ISO date). Goal-tier races on or after this
   *  date keep full recency weight per the C3 cycle-aware rule. */
  cycleStartIso?: string;
}

export interface FitnessMaxHr {
  value: number | null;
  source: 'manual' | 'computed' | 'none';
  sourceLabel?: string;
}

export interface FitnessRestingHr {
  value: number | null;
  source: 'manual' | 'computed' | 'none';
}

export interface FitnessHrZones {
  z1: { lowBpm: number; highBpm: number; label: 'Recovery' };
  z2: { lowBpm: number; highBpm: number; label: 'Easy' };
  z3: { lowBpm: number; highBpm: number; label: 'Steady' };
  z4: { lowBpm: number; highBpm: number; label: 'Threshold' };
  z5: { lowBpm: number; highBpm: number; label: 'VO2max' };
}

export interface ResolvedFitness {
  today: string;
  paces: DanielsPaceSet;
  vdot: FitnessVdot;
  maxHr: FitnessMaxHr;
  restingHr: FitnessRestingHr;
  hrZones: FitnessHrZones | null;
  activeRace: FitnessActiveRace | null;
  racePaceBand: { lowS: number; highS: number; label: string };
  easyPaceBand: { lowS: number; highS: number };
}

/** Format a pace-band in seconds as "M:SS–M:SS/mi". */
export function fmtPaceBand(band: { lowS: number; highS: number }): string {
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  if (band.lowS === band.highS) return `${fmt(band.lowS)}/mi`;
  return `${fmt(band.lowS)}–${fmt(band.highS)}/mi`;
}

export function paceStringFromFitness(
  fitness: ResolvedFitness,
  zone: 'E' | 'M' | 'T' | 'I' | 'R' | 'race-pace',
): string {
  if (zone === 'race-pace') return fmtPaceBand(fitness.racePaceBand);
  return fmtPaceBand(fitness.paces[zone]);
}
