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
  /** HM-specific peak-phase workouts (Pfitz/Daniels HM build doctrine).
   *  PEAK weeks for a HM A-race route to these instead of the
   *  marathon-shaped long_mp_block / marathon_specific. */
  | 'hm_specific_continuous'  // 6-8mi @ HM goal pace, mid-PEAK
  | 'hm_specific_tune'         // long run with 3-4mi HM-pace block, early PEAK
  | 'hm_race_rehearsal'        // 3mi @ HM goal pace tune-up, T-10 days
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
  // No goal race, use recent weekly volume + an aerobic pace estimate.
  // The recent activities have actual paces; use the median of the
  // mile-weighted easy pace as the anchor.
  return null;
}

function paceFor(type: RunWorkoutType, state: CoachState): PaceTarget | null {
  // 1. VDOT-derived band (preferred), anchored on the runner's most
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
    type: 'general_aerobic', label: 'Easy Run',
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
    description: `${r1(distanceMi)} mi easy + 6 × 100m strides at the end · keeps your legs quick without adding hard miles`,
    isQuality: false, isLong: false, appendStrides: true,
  };
}

export function mediumLong(distanceMi: number, state: CoachState): RunPrescription {
  return {
    type: 'medium_long', label: 'Medium-long',
    distanceMi: r1(distanceMi), durationMin: null,
    paceTargetSPerMi: paceFor('medium_long', state), hrZone: 2,
    description: `${r1(distanceMi)} mi at an easy, steady pace · a second longer run in the week that builds the endurance a marathon needs`,
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
    description: `${r1(distanceMi)} mi total · easy for the first ${r1(distanceMi - lastN)} mi · then ramp the final ${lastN} mi down into goal race pace`,
    isQuality: true, isLong: true, appendStrides: false,
  };
}

export function longMpBlock(distanceMi: number, state: CoachState, mpBlockMi: number): RunPrescription {
  const goal = goalPaceSPerMi(state);
  return {
    type: 'long_mp_block', label: 'Long run · race-pace block',
    distanceMi: r1(distanceMi), durationMin: null,
    paceTargetSPerMi: goal ? { lowS: goal - 5, highS: goal + 5 } : null,
    hrZone: 3,
    description: `${r1(distanceMi)} mi total with ${mpBlockMi} mi at goal race pace in the middle · the most race-like session in marathon training`,
    isQuality: true, isLong: true, appendStrides: false,
  };
}

export function thresholdContinuous(distanceMi: number, state: CoachState): RunPrescription {
  return {
    type: 'threshold', label: 'Threshold tempo',
    distanceMi: r1(distanceMi), durationMin: null,
    paceTargetSPerMi: paceFor('threshold', state), hrZone: 4,
    description: `2 mi easy warm-up · ${r1(distanceMi - 3)} mi at a comfortably hard pace (about half-marathon effort) · 1 mi easy cool-down`,
    isQuality: true, isLong: false, appendStrides: false,
  };
}

export function thresholdIntervals(state: CoachState): RunPrescription {
  return {
    type: 'threshold_intervals', label: 'Cruise intervals',
    distanceMi: 7, durationMin: null,
    paceTargetSPerMi: paceFor('threshold', state), hrZone: 4,
    description: `2 mi easy warm-up · 4 × 1 mi at threshold pace, jog 60–90s between · 1 mi easy cool-down`,
    isQuality: true, isLong: false, appendStrides: false,
  };
}

export function subThreshold(state: CoachState): RunPrescription {
  return {
    type: 'sub_threshold', label: 'Sub-threshold',
    distanceMi: 8, durationMin: null,
    paceTargetSPerMi: paceFor('sub_threshold', state), hrZone: 3,
    description: `2 mi easy warm-up · 5 × 1 mi at a steady, controlled effort (just below threshold), jog 60s between · 1 mi easy cool-down`,
    isQuality: true, isLong: false, appendStrides: false,
  };
}

export function vo2(state: CoachState): RunPrescription {
  return {
    type: 'vo2', label: 'Speed intervals',
    distanceMi: 7, durationMin: null,
    paceTargetSPerMi: paceFor('vo2', state), hrZone: 5,
    description: `2 mi easy warm-up · 5 × 1000m at 5K pace, jog 400m between · 1 mi easy cool-down`,
    isQuality: true, isLong: false, appendStrides: false,
  };
}

export function marathonSpecific(state: CoachState): RunPrescription {
  const goal = goalPaceSPerMi(state);
  return {
    type: 'marathon_specific', label: 'Race-pace combo',
    distanceMi: 12, durationMin: null,
    paceTargetSPerMi: goal ? { lowS: goal - 10, highS: goal + 5 } : null,
    hrZone: 4,
    description: `2 mi easy warm-up · 15 min at race pace / 4 × (90s at 10K pace + 90s easy) / 15 min at race pace · 1 mi easy cool-down · teaches you to recover while still holding race pace`,
    isQuality: true, isLong: false, appendStrides: false,
  };
}

/** HM-specific continuous race-pace block (Pfitz HM Plan §5: PEAK weeks
 *  need 6-8 continuous miles at HMP to rehearse the demand and pace
 *  discipline). 8-10 mi total: warm-up, sustained HMP block, cool-down. */
export function hmSpecificContinuous(distanceMi: number, state: CoachState): RunPrescription {
  const goal = goalPaceSPerMi(state);
  const blockMi = Math.max(5, Math.min(8, Math.round(distanceMi - 3)));
  return {
    type: 'hm_specific_continuous', label: 'Half-marathon pace block',
    distanceMi: r1(distanceMi), durationMin: null,
    paceTargetSPerMi: goal ? { lowS: goal - 5, highS: goal + 5 } : null,
    hrZone: 4,
    description: `2 mi easy warm-up · ${blockMi} mi continuous at HM goal pace · 1 mi easy cool-down · the most race-like piece in the HM build`,
    isQuality: true, isLong: false, appendStrides: false,
  };
}

/** Long run with an HM-pace block in the middle (Pfitz HM §5: early
 *  PEAK long runs insert a 3-4mi HMP tune inside the long to bridge
 *  general aerobic and race-specific work). distanceMi sized by the
 *  caller; HMP block is 3-5mi depending on long-run size. */
export function hmSpecificTune(distanceMi: number, state: CoachState): RunPrescription {
  const goal = goalPaceSPerMi(state);
  const hmBlockMi = distanceMi >= 14 ? 5 : distanceMi >= 12 ? 4 : 3;
  return {
    type: 'hm_specific_tune', label: 'Long run · HMP tune',
    distanceMi: r1(distanceMi), durationMin: null,
    paceTargetSPerMi: goal ? { lowS: goal - 5, highS: goal + 5 } : null,
    hrZone: 3,
    description: `${r1(distanceMi)} mi total with ${hmBlockMi} mi at HM goal pace in the middle · long-run aerobic load plus race-pace rehearsal in one session`,
    isQuality: true, isLong: true, appendStrides: false,
  };
}

/** HM race-week rehearsal (Pfitz HM §6 race-week protocol: a short
 *  HMP tune-up 10 days out grooves pace + readies legs without
 *  draining them). 5mi total, 3mi at HM goal pace. */
export function hmRaceRehearsal(state: CoachState): RunPrescription {
  const goal = goalPaceSPerMi(state);
  return {
    type: 'hm_race_rehearsal', label: 'Race rehearsal',
    distanceMi: 5, durationMin: null,
    paceTargetSPerMi: goal ? { lowS: goal - 5, highS: goal + 5 } : null,
    hrZone: 4,
    description: `1 mi easy warm-up · 3 mi at HM goal pace · 1 mi easy cool-down · last race-pace check, leaves you fresh for race day`,
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
   engine then trim distance / swap workout types as needed.

   Day-of-week placement is driven by the runner's `user_prefs` cadence
   (passed in as `prefs`). When prefs are defaults (Sat long / Tue+Thu
   quality / Mon rest), this behaves identically to the pre-refactor
   hardcoded version. */

export interface DefaultByDow {
  /** Mon=1 ... Sun=0 (JS Date.getDay()). Default workout type. */
  primary: RunWorkoutType;
}

/** Cadence inputs the day-picker reads. Subset of CoachState['prefs']
 *  so this module stays light-weight + easy to unit test. */
export interface DayPrefs {
  longRunDow: number;
  qualityDows: number[];
  restDow: number | null;
}

/** Picks one quality day for the phase template's primary quality slot,
 *  preferring the first user-quality-day that's NOT the long-run day. */
function pickPrimaryQualityDow(prefs: DayPrefs): number | null {
  for (const d of prefs.qualityDows) {
    if (d !== prefs.longRunDow) return d;
  }
  return prefs.qualityDows[0] ?? null;
}

/** Picks a secondary quality day (medium-long), the second
 *  user-quality-day that's NOT the long-run day. */
function pickSecondaryQualityDow(prefs: DayPrefs): number | null {
  const used = new Set<number>();
  const primary = pickPrimaryQualityDow(prefs);
  if (primary != null) used.add(primary);
  for (const d of prefs.qualityDows) {
    if (d === prefs.longRunDow) continue;
    if (used.has(d)) continue;
    return d;
  }
  return null;
}

/** Post-long recovery dow, used inside defaultByDow for the "easy day
 *  after the long" slot. Mirrors recoveryDowFor() in coach-engine. */
function postLongRecoveryDow(prefs: DayPrefs): number {
  return (prefs.longRunDow + 1) % 7;
}

/** Race distance categorizer for phase templates. HM-distance races
 *  (≤ 16mi) get the HM-specific doctrine in PEAK; full marathons / ultras
 *  get marathon-specific work. Used by defaultByDow to branch PEAK
 *  prescriptions on what the runner is actually training for. */
function isHmDistance(raceDistanceMi: number | null | undefined): boolean {
  return raceDistanceMi != null && raceDistanceMi > 0 && raceDistanceMi <= 16;
}

export function defaultByDow(
  phase: Phase,
  dow: number,
  prefs: DayPrefs,
  /** A-race distance in miles. Lets PEAK branch HM vs marathon
   *  doctrine. Undefined → fall back to marathon-specific (legacy
   *  behavior, never wrong for marathon training but coarse for HM). */
  raceDistanceMi?: number | null,
): DefaultByDow {
  const longDow = prefs.longRunDow;
  const recoveryDow = postLongRecoveryDow(prefs);
  const restDow = prefs.restDow;
  const primaryQualityDow = pickPrimaryQualityDow(prefs);
  const secondaryQualityDow = pickSecondaryQualityDow(prefs);

  // Within race-mode phases, place quality midweek and long on the
  // user's configured long day. Within base-mode, fewer hard days,
  // more general aerobic.
  if (phase === 'BASE') {
    if (dow === longDow) return { primary: 'long_steady' };
    if (dow === primaryQualityDow) return { primary: 'threshold_intervals' };
    if (dow === recoveryDow) return { primary: 'recovery' };
    if (dow === restDow) return { primary: 'rest' };
    return { primary: 'general_aerobic' };
  }
  if (phase === 'BUILD') {
    if (dow === longDow) return { primary: 'long_progression' };
    if (dow === primaryQualityDow) return { primary: 'threshold_intervals' };
    if (dow === secondaryQualityDow) return { primary: 'medium_long' };
    if (dow === recoveryDow) return { primary: 'recovery' };
    if (dow === restDow) return { primary: 'rest' };
    return { primary: 'general_aerobic' };
  }
  if (phase === 'PEAK') {
    // HM-distance A-race → HM-specific doctrine (Pfitz HM Plan §5):
    //   long day → long run with HMP block (hm_specific_tune)
    //   primary quality → continuous HMP block (hm_specific_continuous)
    // Marathon / ultra → marathon-specific (legacy):
    //   long day → long_mp_block, primary → marathon_specific
    if (isHmDistance(raceDistanceMi)) {
      if (dow === longDow) return { primary: 'hm_specific_tune' };
      if (dow === primaryQualityDow) return { primary: 'hm_specific_continuous' };
    } else {
      if (dow === longDow) return { primary: 'long_mp_block' };
      if (dow === primaryQualityDow) return { primary: 'marathon_specific' };
    }
    if (dow === secondaryQualityDow) return { primary: 'medium_long' };
    if (dow === recoveryDow) return { primary: 'recovery' };
    if (dow === restDow) return { primary: 'rest' };
    return { primary: 'general_aerobic' };
  }
  if (phase === 'TAPER') {
    if (dow === longDow) return { primary: 'long_steady' };
    if (dow === primaryQualityDow) return { primary: 'threshold' };
    if (dow === recoveryDow) return { primary: 'recovery' };
    return { primary: 'general_aerobic' };
  }
  if (phase === 'POST_RACE') {
    // POST_RACE: 2 rest days per week (rest-day + the user's secondary
    // quality day repurposed as rest while in recovery).
    if (dow === restDow) return { primary: 'rest' };
    if (dow === secondaryQualityDow) return { primary: 'rest' };
    return { primary: 'recovery' };
  }
  if (phase === 'REBUILD') {
    if (dow === longDow) return { primary: 'long_steady' };
    if (dow === restDow) return { primary: 'rest' };
    // Day before the long-run also gets a rest (originally dow=5 when
    // long is Sat). Preserve that "day before the long is rest"
    // invariant relative to the user's configured long-run day.
    if (dow === (prefs.longRunDow + 6) % 7) return { primary: 'rest' };
    return { primary: 'general_aerobic' };
  }
  // BASE_MAINTENANCE, default state.
  if (dow === longDow) return { primary: 'long_steady' };
  if (dow === primaryQualityDow) return { primary: 'threshold' };
  if (dow === recoveryDow) return { primary: 'recovery' };
  if (dow === restDow) return { primary: 'rest' };
  return { primary: 'general_aerobic' };
}

function r1(n: number): number { return Math.round(n * 10) / 10; }
