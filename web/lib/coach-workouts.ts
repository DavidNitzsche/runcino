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
  | 'vdot_test_5k'          // 5K time trial — anchors VDOT when no recent race
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

function fmtPaceSPerMi(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}/mi`;
}

/** Goal-pace tag for quality workout descriptions. When the runner
 *  has a goal time set on their A-race, surface "race pace ≈ X:XX/mi"
 *  alongside the VDOT-derived pace band so the runner sees what
 *  they're training toward, not just what they CAN do today.
 *  Doctrine: VDOT for current fitness paces, goal pace for race-
 *  specific adaptation target. */
function goalPaceTag(state: CoachState): string {
  const goal = goalPaceSPerMi(state);
  if (goal == null) return '';
  return ` · race pace ≈ ${fmtPaceSPerMi(goal)}`;
}

export function thresholdContinuous(distanceMi: number, state: CoachState): RunPrescription {
  return {
    type: 'threshold', label: 'Threshold tempo',
    distanceMi: r1(distanceMi), durationMin: null,
    paceTargetSPerMi: paceFor('threshold', state), hrZone: 4,
    // Description doesn't reference "half marathon pace" anymore —
    // for VDOT < 50, T-pace = 15K pace (between 10K and HM), so the
    // "~HM pace" descriptor confused the runner when the target band
    // sat 20-30 sec faster than their goal HM pace. Now we let the
    // pace target band below speak for itself + reference comfort
    // ("comfortably hard, sustainable for an hour").
    description: `2 mi WU · ${r1(distanceMi - 3)} mi at threshold pace (comfortably hard — sustainable ~60 min if push) · 1 mi CD${goalPaceTag(state)}`,
    isQuality: true, isLong: false, appendStrides: false,
  };
}

/** Cruise intervals — Daniels' "T intervals". Reps grow over the
 *  build phase: 3 × 1mi early → 5 × 1mi at peak. */
export function thresholdIntervals(state: CoachState, reps: number = 4): RunPrescription {
  const distanceMi = 3 + reps;  // 2mi WU + reps × 1mi + 1mi CD
  return {
    type: 'threshold_intervals', label: 'Cruise intervals',
    distanceMi: r1(distanceMi), durationMin: null,
    paceTargetSPerMi: paceFor('threshold', state), hrZone: 4,
    description: `2 mi WU · ${reps} × 1 mi at threshold pace with 60-90s jog recovery · 1 mi CD${goalPaceTag(state)}`,
    isQuality: true, isLong: false, appendStrides: false,
  };
}

/** Sub-threshold (Norwegian doubles influence). Reps scale: 3 × 1mi
 *  early build → 6 × 1mi peak. */
export function subThreshold(state: CoachState, reps: number = 5): RunPrescription {
  const distanceMi = 3 + reps;
  return {
    type: 'sub_threshold', label: 'Sub-threshold',
    distanceMi: r1(distanceMi), durationMin: null,
    paceTargetSPerMi: paceFor('sub_threshold', state), hrZone: 3,
    description: `2 mi WU · ${reps} × 1 mi at sub-threshold (just below LT2) with 60s jog recovery · 1 mi CD${goalPaceTag(state)}`,
    isQuality: true, isLong: false, appendStrides: false,
  };
}

/** VO₂max intervals. Reps + distance scale: 4 × 800m early → 6 × 1200m
 *  peak. Pfitz prescription pattern. */
export function vo2(state: CoachState, reps: number = 5, repMeters: number = 1000): RunPrescription {
  const totalRepMi = (reps * repMeters) / 1609;
  const distanceMi = 3 + totalRepMi;  // 2mi WU + reps + 1mi CD
  return {
    type: 'vo2', label: 'VO₂ max intervals',
    distanceMi: r1(distanceMi), durationMin: null,
    paceTargetSPerMi: paceFor('vo2', state), hrZone: 5,
    description: `2 mi WU · ${reps} × ${repMeters}m at 5K pace · jog 400m recovery · 1 mi CD`,
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
    description: `2 mi WU · 15 min MP / 4 × (90s 10K pace + 90s easy) / 15 min MP · 1 mi CD · combo workout teaches recovering AT marathon pace${goalPaceTag(state)}`,
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

/** 5K time trial — Coach prescribes this when the runner has no
 *  recent race or VDOT is stale/expired (Research/01 §"Field-test
 *  protocols"). Replaces a quality day, not added on top.
 *
 *  Distance is fixed at 3.1 miles (5K). Total session including
 *  warm-up + cool-down is ~5 mi. */
export function vdotTest5K(): RunPrescription {
  return {
    type: 'vdot_test_5k', label: 'VDOT test · 5K time trial',
    distanceMi: 5.1,                     // 1.5mi WU + 3.1mi TT + 0.5mi CD
    durationMin: null,
    paceTargetSPerMi: null,              // pace target is "all-out", not a band
    hrZone: 5,
    description: '1.5 mi easy WU · 3.1 mi (5K) all-out · 0.5 mi easy CD · run as a race effort, on a flat course or track if you can. We anchor every pace prescription on the result. Apply +1 VDOT for solo effort.',
    isQuality: true, isLong: false, appendStrides: false,
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

export function defaultByDow(phase: Phase, dow: number, longRunDow: number = 0): DefaultByDow {
  // Long run anchors the week. Runner sets the day via
  // /profile → longRunDow (default 0=Sun). Other key days sit at
  // fixed offsets from the anchor:
  //
  //   longDow + 0 : LONG run
  //   longDow + 1 : RECOVERY (the day after — let the long absorb)
  //   longDow + 2 : REST (chill, no quality)
  //   longDow + 4 : QUALITY (mid-week threshold/intervals — 3 days
  //                          before next long, 4 after this one)
  //   longDow + 5 : MEDIUM-LONG (2 days before long)
  //   longDow + 3, +6 : general aerobic fillers
  //
  // For Sat(6)-long this maps to the classic Pfitz pattern (Wed
  // threshold, Thu medium-long, Sat long, Sun recovery).
  // For Sun(0)-long: Mon recovery, Tue rest, Thu quality, Fri ML.
  const longDow = ((longRunDow % 7) + 7) % 7;
  const recoveryDow = (longDow + 1) % 7;
  const restDow = (longDow + 2) % 7;
  const qualityDow = (longDow + 4) % 7;
  const mediumLongDow = (longDow + 5) % 7;

  if (phase === 'BASE') {
    if (dow === longDow) return { primary: 'long_steady' };
    if (dow === qualityDow) return { primary: 'threshold_intervals' };
    if (dow === recoveryDow) return { primary: 'recovery' };
    if (dow === restDow) return { primary: 'rest' };
    return { primary: 'general_aerobic' };
  }
  if (phase === 'BUILD') {
    if (dow === longDow) return { primary: 'long_progression' };
    if (dow === qualityDow) return { primary: 'threshold_intervals' };
    if (dow === mediumLongDow) return { primary: 'medium_long' };
    if (dow === recoveryDow) return { primary: 'recovery' };
    if (dow === restDow) return { primary: 'rest' };
    return { primary: 'general_aerobic' };
  }
  if (phase === 'PEAK') {
    if (dow === longDow) return { primary: 'long_mp_block' };
    if (dow === qualityDow) return { primary: 'marathon_specific' };
    if (dow === mediumLongDow) return { primary: 'medium_long' };
    if (dow === recoveryDow) return { primary: 'recovery' };
    if (dow === restDow) return { primary: 'rest' };
    return { primary: 'general_aerobic' };
  }
  if (phase === 'TAPER') {
    if (dow === longDow) return { primary: 'long_steady' };
    if (dow === qualityDow) return { primary: 'threshold' };
    if (dow === recoveryDow) return { primary: 'recovery' };
    return { primary: 'general_aerobic' };
  }
  if (phase === 'POST_RACE') {
    if (dow === restDow || dow === ((longDow + 4) % 7)) return { primary: 'rest' };
    return { primary: 'recovery' };
  }
  if (phase === 'REBUILD') {
    if (dow === longDow) return { primary: 'long_steady' };
    if (dow === restDow || dow === ((longDow + 5) % 7)) return { primary: 'rest' };
    return { primary: 'general_aerobic' };
  }
  // BASE_MAINTENANCE — default state.
  if (dow === longDow) return { primary: 'long_steady' };
  if (dow === qualityDow) return { primary: 'threshold' };
  if (dow === recoveryDow) return { primary: 'recovery' };
  if (dow === restDow) return { primary: 'rest' };
  return { primary: 'general_aerobic' };
}

function r1(n: number): number { return Math.round(n * 10) / 10; }
