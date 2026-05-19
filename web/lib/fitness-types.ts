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
  }>;
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
