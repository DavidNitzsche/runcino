/**
 * Long-run cap math — single source of truth.
 *
 * Both the coach engine (lib/coach-engine.ts longRunTarget) and the
 * dashboard's TrainingPulseTile project per-phase long-run targets
 * from the same per-phase multipliers. Previously each had its own
 * inline copy of the constants — a doctrine-drift risk where one
 * could change without the other. This module is the canonical home.
 *
 * Doctrine source: Research/01 §13.1 single-session-spike rule
 * (never >110% of recent peak) + Daniels' general progression
 * guidance for phase-specific multipliers.
 */

/** Hard ceiling: a single long run never exceeds this multiple of
 *  the peak long run in the last 28 days. Doctrine: Research/01
 *  §13.1 (single-session-spike rule) + general Daniels +10% rule. */
export const LONG_RUN_HARD_CAP_MULTIPLIER = 1.10;

/** Per-phase target multipliers + floor distances. Phase keys match
 *  the engine's `Phase` enum. The floor protects against tiny peaks
 *  collapsing the prescribed long run to nothing — e.g. a runner
 *  with a 6-mile peak in PEAK phase still needs a 14-mile floor. */
export interface LongRunPhaseSpec {
  /** Multiplier applied to peakLast (longest run in last 28 days). */
  multiplier: number;
  /** Minimum miles regardless of multiplier × peakLast. */
  floorMi: number;
}

export const LONG_RUN_PHASE_SPEC: Record<EnginePhase, LongRunPhaseSpec> = {
  TAPER:            { multiplier: 0.65, floorMi: 8  },
  PEAK:             { multiplier: 1.05, floorMi: 14 },
  BUILD:            { multiplier: 1.05, floorMi: 10 },
  BASE:             { multiplier: 1.00, floorMi: 8  },
  BASE_MAINTENANCE: { multiplier: 1.00, floorMi: 8  },
  POST_RACE:        { multiplier: 0.40, floorMi: 6  },
  REBUILD:          { multiplier: 0.60, floorMi: 6  },
};

/** The Phase enum — kept here so both engine + dashboard can import
 *  without a circular dependency. Mirrors lib/coach-engine.ts. */
export type EnginePhase =
  | 'TAPER' | 'PEAK' | 'BUILD' | 'BASE' | 'BASE_MAINTENANCE'
  | 'POST_RACE' | 'REBUILD';

/** Compute the long-run target for a given phase + peak. Used by
 *  the engine's longRunTarget() and the dashboard's NEXT-WEEK CAP
 *  tile. Both should ALWAYS go through this function — never reimplement. */
export function longRunTargetMi(phase: EnginePhase, peakLast28Mi: number): number {
  const spec = LONG_RUN_PHASE_SPEC[phase];
  return Math.max(spec.floorMi, peakLast28Mi * spec.multiplier);
}

/** The dashboard uses a different phase enum (TrainingPulse phase
 *  strings) than the engine. This map normalizes dashboard strings
 *  to engine enum keys so a single phase-spec table works for both. */
export const TRAINING_PULSE_TO_ENGINE_PHASE: Record<string, EnginePhase> = {
  'TAPER':       'TAPER',
  'PEAK':        'PEAK',
  'BUILDING':    'BUILD',
  'BASE BLOCK':  'BASE_MAINTENANCE',
  'POST-RACE':   'POST_RACE',
  'RACE MONTH':  'BUILD',  // race month is a build phase by another name
};
