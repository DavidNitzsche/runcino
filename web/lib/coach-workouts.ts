/**
 * Workout palette + builder helpers.
 *
 * Every workout type the coaching engine can prescribe lives here.
 * Types match the seven categories in docs/coaching-research.md §5
 * (recovery / general aerobic / medium-long / long / threshold /
 * VO2max / marathon-specific) plus strides and rest.
 *
 * Engine in coach-engine.ts decides WHICH type fits today; this
 * module knows how to BUILD a concrete prescription for that type
 * given the runner's current state (goal pace, recent volume, phase).
 */

import { PACE_OFFSETS_S_PER_MI, type Phase } from './coach-principles';
import type { CoachState } from './coach-state';
import { paceTargetFromVdot } from './vdot';

export type RunWorkoutType =
  | 'recovery'
  | 'general_aerobic'
  | 'medium_long'
  | 'long_steady'
  | 'long_progression'
  | 'long_mp_block'
  | 'threshold'
  | 'threshold_intervals'
  | 'sub_threshold'
  | 'vo2'
  | 'marathon_specific'
  | 'strides_appended'      // strides appended to an easy run, not their own day
  | 'rest'
  | 'shakeout'
  | 'race';

export interface PaceTarget {
  lowS: number;
  highS: number;
}

export interface RunPrescription {
  type: RunWorkoutType;
  /** Display label, doc-aligned: "General aerobic", "Long (MP block)", etc. */
  label: string;
  distanceMi: number;
  durationMin: number | null;     // when duration > distance is the load-bearing dimension
  /** Pace target in s/mi. null = no target (recovery, rest, fun). */
  paceTargetSPerMi: PaceTarget | null;
  /** HR zone 1-5. null when not applicable. */
  hrZone: number | null;
  /** Plain-English description the user reads. */
  description: string;
  /** True if this counts as a "hard" effort against the 24-72h spacing
   *  rule and the weekly quality budget. */
  isQuality: boolean;
  /** True if this is the weekly long run. */
  isLong: boolean;
  /** Whether to append strides at the end of an easy run. */
  appendStrides: boolean;
}

/* ── Pace target derivation ──────────────────────────────────────
   Anchored on the runner's goal pace if a goal race exists. Falls
   back to recent average pace when there's no goal. */
function goalPaceSPerMi(state: CoachState): number | null {
  const r = state.races.nextA;
  if (r && r.goalFinishS && r.distanceMi > 0) return Math.round(r.goalFinishS / r.distanceMi);
  // No goal race — use recent weekly volume + an aerobic pace estimate.
  // The recent activities have actual paces; use the median of the
  // mile-weighted easy pace as the anchor.
  return null;
}

function paceFor(type: RunWorkoutType, state: CoachState): PaceTarget | null {
  // 1. VDOT-derived band (preferred) — anchored on the runner's most
  //    recent strong race result. Doctrine source: Daniels VDOT table
  //    + PACE_ZONE_WIDTH (Research/01).
  const vdotTarget = paceTargetFromVdot(state, type);
  if (vdotTarget) {
    return { lowS: vdotTarget.lowS, highS: vdotTarget.highS };
  }
  // 2. Legacy fallback: goal pace ± static offset table. Used when the
  //    runner hasn't logged a recent race. Less precise (a 3:30
  //    marathon goal at peak fitness ≠ same goal mid-build), but
  //    keeps prescriptions sane until VDOT data lands.
  const offsets = PACE_OFFSETS_S_PER_MI[type];
  if (!offsets) return null;
  const goal = goalPaceSPerMi(state);
  if (goal == null) {
    // Without a goal anchor, return null so the description leans on
    // RPE language ("conversational pace", "comfortable hard") rather
    // than misleading numbers.
    return null;
  }
  return { lowS: goal + offsets.lowS, highS: goal + offsets.highS };
}

/* ── Builders for each workout type ─────────────────────────────
   Each takes the engine-decided distance + state + returns a
   RunPrescription. Distance bounds come from the doc; pace bounds
   come from PACE_OFFSETS_S_PER_MI. */

export function recovery(distanceMi: number): RunPrescription {
  return {
    type: 'recovery', label: 'Recovery run',
    distanceMi: r1(distanceMi), durationMin: null,
    paceTargetSPerMi: null, hrZone: 1,
    description: `${r1(distanceMi)} mi very easy · circulation, not adaptation · or rest entirely if legs are dead`,
    isQuality: false, isLong: false, appendStrides: false,
  };
}

export function generalAerobic(distanceMi: number, state: CoachState): RunPrescription {
  return {
    type: 'general_aerobic', label: 'General aerobic',
    distanceMi: r1(distanceMi), durationMin: null,
    paceTargetSPerMi: paceFor('general_aerobic', state), hrZone: 2,
    description: `${r1(distanceMi)} mi easy · conversational · 30-60 s/mi slower than goal pace`,
    isQuality: false, isLong: false, appendStrides: false,
  };
}

export function easyWithStrides(distanceMi: number, state: CoachState): RunPrescription {
  return {
    type: 'general_aerobic', label: 'Easy + strides',
    distanceMi: r1(distanceMi), durationMin: null,
    paceTargetSPerMi: paceFor('general_aerobic', state), hrZone: 2,
    description: `${r1(distanceMi)} mi easy + 6 × 100m strides at the end · keeps neuromuscular sharpness without aerobic cost`,
    isQuality: false, isLong: false, appendStrides: true,
  };
}

export function mediumLong(distanceMi: number, state: CoachState): RunPrescription {
  return {
    type: 'medium_long', label: 'Medium-long',
    distanceMi: r1(distanceMi), durationMin: null,
    paceTargetSPerMi: paceFor('medium_long', state), hrZone: 2,
    description: `${r1(distanceMi)} mi at endurance pace · the second weekly run >90 min that distinguishes serious marathoners (Pfitzinger)`,
    isQuality: false, isLong: false, appendStrides: false,
  };
}

export function longSteady(distanceMi: number, state: CoachState): RunPrescription {
  return {
    type: 'long_steady', label: 'Long run · steady',
    distanceMi: r1(distanceMi), durationMin: null,
    paceTargetSPerMi: paceFor('long_steady', state), hrZone: 2,
    description: `${r1(distanceMi)} mi at endurance pace · stay aerobic the whole way · keep it fun`,
    isQuality: false, isLong: true, appendStrides: false,
  };
}

export function longProgression(distanceMi: number, state: CoachState): RunPrescription {
  const goal = goalPaceSPerMi(state);
  const lastN = Math.min(8, Math.max(4, Math.floor(distanceMi / 3)));
  return {
    type: 'long_progression', label: 'Long run · progression',
    distanceMi: r1(distanceMi), durationMin: null,
    paceTargetSPerMi: goal ? { lowS: goal, highS: goal + 30 } : null,
    hrZone: 3,
    description: `${r1(distanceMi)} mi total · easy first ${r1(distanceMi - lastN)} mi · final ${lastN} mi ramp from MP+30s into MP (Pfitzinger progression)`,
    isQuality: true, isLong: true, appendStrides: false,
  };
}

export function longMpBlock(distanceMi: number, state: CoachState, mpBlockMi: number): RunPrescription {
  const goal = goalPaceSPerMi(state);
  return {
    type: 'long_mp_block', label: 'Long run · MP block',
    distanceMi: r1(distanceMi), durationMin: null,
    paceTargetSPerMi: goal ? { lowS: goal - 5, highS: goal + 5 } : null,
    hrZone: 3,
    description: `${r1(distanceMi)} mi total with ${mpBlockMi} mi at goal MP in the middle · the single most race-specific session in marathon training`,
    isQuality: true, isLong: true, appendStrides: false,
  };
}

export function thresholdContinuous(distanceMi: number, state: CoachState): RunPrescription {
  return {
    type: 'threshold', label: 'Threshold tempo',
    distanceMi: r1(distanceMi), durationMin: null,
    paceTargetSPerMi: paceFor('threshold', state), hrZone: 4,
    description: `2 mi WU · ${r1(distanceMi - 3)} mi at threshold (~half marathon pace) · 1 mi CD`,
    isQuality: true, isLong: false, appendStrides: false,
  };
}

export function thresholdIntervals(state: CoachState): RunPrescription {
  return {
    type: 'threshold_intervals', label: 'Cruise intervals',
    distanceMi: 7, durationMin: null,
    paceTargetSPerMi: paceFor('threshold', state), hrZone: 4,
    description: `2 mi WU · 4 × 1 mi at threshold pace with 60-90s jog recovery · 1 mi CD (Daniels staple)`,
    isQuality: true, isLong: false, appendStrides: false,
  };
}

export function subThreshold(state: CoachState): RunPrescription {
  return {
    type: 'sub_threshold', label: 'Sub-threshold',
    distanceMi: 8, durationMin: null,
    paceTargetSPerMi: paceFor('sub_threshold', state), hrZone: 3,
    description: `2 mi WU · 5 × 1 mi at sub-threshold (just below LT2) with 60s jog recovery · 1 mi CD (Norwegian-singles)`,
    isQuality: true, isLong: false, appendStrides: false,
  };
}

export function vo2(state: CoachState): RunPrescription {
  return {
    type: 'vo2', label: 'VO₂ max intervals',
    distanceMi: 7, durationMin: null,
    paceTargetSPerMi: paceFor('vo2', state), hrZone: 5,
    description: `2 mi WU · 5 × 1000m at 5K pace · jog 400m recovery · 1 mi CD`,
    isQuality: true, isLong: false, appendStrides: false,
  };
}

export function marathonSpecific(state: CoachState): RunPrescription {
  const goal = goalPaceSPerMi(state);
  return {
    type: 'marathon_specific', label: 'MP combo',
    distanceMi: 12, durationMin: null,
    paceTargetSPerMi: goal ? { lowS: goal - 10, highS: goal + 5 } : null,
    hrZone: 4,
    description: `2 mi WU · 15 min MP / 4 × (90s 10K pace + 90s easy) / 15 min MP · 1 mi CD · combo workout teaches recovering AT marathon pace`,
    isQuality: true, isLong: false, appendStrides: false,
  };
}

export function shakeout(): RunPrescription {
  return {
    type: 'shakeout', label: 'Race-eve shakeout',
    distanceMi: 2, durationMin: 20,
    paceTargetSPerMi: null, hrZone: 2,
    description: `20 min easy + 2-3 strides · primer for tomorrow · don't think about it`,
    isQuality: false, isLong: false, appendStrides: true,
  };
}

export function rest(reason: string): RunPrescription {
  return {
    type: 'rest', label: 'Rest day',
    distanceMi: 0, durationMin: 0,
    paceTargetSPerMi: null, hrZone: null,
    description: reason,
    isQuality: false, isLong: false, appendStrides: false,
  };
}

export function race(distanceMi: number, name: string): RunPrescription {
  return {
    type: 'race', label: 'Race day',
    distanceMi: r1(distanceMi), durationMin: null,
    paceTargetSPerMi: null, hrZone: null,
    description: `Race day · ${name} · trust the plan, execute the pacing strategy`,
    isQuality: true, isLong: distanceMi >= 13.1, appendStrides: false,
  };
}

/* ── Default-day pickers per phase ──────────────────────────────
   When the engine knows the phase + day-of-week + recent state, it
   reaches into here for sensible defaults. Hard constraints in the
   engine then trim distance / swap workout types as needed. */

export interface DefaultByDow {
  /** Mon=1 ... Sun=0 (JS Date.getDay()). Default workout type. */
  primary: RunWorkoutType;
}

export function defaultByDow(phase: Phase, dow: number): DefaultByDow {
  // Within race-mode phases, place quality midweek and long Saturday.
  // Within base-mode, fewer hard days, more general aerobic.
  if (phase === 'BASE') {
    if (dow === 6) return { primary: 'long_steady' };
    if (dow === 3) return { primary: 'threshold_intervals' };
    if (dow === 0) return { primary: 'recovery' };
    if (dow === 1) return { primary: 'rest' };
    return { primary: 'general_aerobic' };
  }
  if (phase === 'BUILD') {
    if (dow === 6) return { primary: 'long_progression' };
    if (dow === 3) return { primary: 'threshold_intervals' };
    if (dow === 4) return { primary: 'medium_long' };
    if (dow === 0) return { primary: 'recovery' };
    if (dow === 1) return { primary: 'rest' };
    return { primary: 'general_aerobic' };
  }
  if (phase === 'PEAK') {
    if (dow === 6) return { primary: 'long_mp_block' };
    if (dow === 3) return { primary: 'marathon_specific' };
    if (dow === 4) return { primary: 'medium_long' };
    if (dow === 0) return { primary: 'recovery' };
    if (dow === 1) return { primary: 'rest' };
    return { primary: 'general_aerobic' };
  }
  if (phase === 'TAPER') {
    if (dow === 6) return { primary: 'long_steady' };
    if (dow === 3) return { primary: 'threshold' };
    if (dow === 0) return { primary: 'recovery' };
    return { primary: 'general_aerobic' };
  }
  if (phase === 'POST_RACE') {
    if (dow === 1 || dow === 4) return { primary: 'rest' };
    return { primary: 'recovery' };
  }
  if (phase === 'REBUILD') {
    if (dow === 6) return { primary: 'long_steady' };
    if (dow === 1 || dow === 5) return { primary: 'rest' };
    return { primary: 'general_aerobic' };
  }
  // BASE_MAINTENANCE — default state.
  if (dow === 6) return { primary: 'long_steady' };
  if (dow === 3) return { primary: 'threshold' };
  if (dow === 0) return { primary: 'recovery' };
  if (dow === 1) return { primary: 'rest' };
  return { primary: 'general_aerobic' };
}

function r1(n: number): number { return Math.round(n * 10) / 10; }
