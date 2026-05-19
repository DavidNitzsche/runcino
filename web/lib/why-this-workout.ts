/**
 * C1 · "Why this workout" rationale builder
 *
 * Produces a structured explanation for the prescribed workout that
 * shows up as a tooltip / expandable note on /overview TodayCard.
 *
 * Four facets · pulls from existing plan/coach data:
 *
 *   1. Workout TYPE         — easy / tempo / intervals / long / recovery / race
 *   2. CYCLE POSITION       — build / peak / taper / recovery / base
 *   3. PURPOSE              — aerobic base / lactate threshold / VO2max /
 *                              race-specific / recovery
 *   4. VOLUME CHOICE        — matches Daniels prescription for current
 *                              VDOT + cycle phase
 *
 * HONESTY DISCIPLINE (per Rule 2 falsifier-required, Rule 3 surface attribution)
 *   When the system doesn't have explicit rationale for a workout's
 *   prescription (e.g., plan generated before this module landed),
 *   the tooltip says so:
 *     - "Type known. Cycle position inferred from week index. Purpose
 *        inferred from type. Volume choice not yet tracked per
 *        workout — comes from week-level plan target."
 *   Better to flag uncertainty than fabricate reasoning.
 */

export interface WhyThisWorkout {
  type: string;
  cyclePosition: string;
  purpose: string;
  volumeChoice: string;
  uncertaintyNotes: string[];
}

function purposeForType(type: string): string {
  switch (type) {
    case 'easy':
    case 'general_aerobic':
      return 'aerobic base · capillary density + mitochondrial efficiency at low intensity';
    case 'long':
      return 'aerobic endurance · time-on-feet stimulus for fat oxidation + glycogen sparing';
    case 'recovery':
    case 'shakeout':
      return 'active recovery · maintains blood flow without adding training load';
    case 'tempo':
    case 'threshold':
    case 'sub_threshold':
    case 'threshold_intervals':
      return 'lactate threshold · raises the pace your body can sustain before lactate accumulates';
    case 'intervals':
      return 'VO₂max · top-end aerobic-power adaptation; intervals force the body to operate near max O₂ uptake';
    case 'race':
      return 'race-specific · executing the race-day plan';
    case 'quality':
      return 'depends on session — see workout-specific details';
    default:
      return 'general training';
  }
}

function cyclePositionFor(phase: string, phaseWeekIdx: number): string {
  const labelLower = (phase ?? '').toLowerCase();
  if (labelLower === 'base')   return `Base week ${phaseWeekIdx} · aerobic foundation`;
  if (labelLower === 'build')  return `Build week ${phaseWeekIdx} · adding volume + quality`;
  if (labelLower === 'peak')   return `Peak week ${phaseWeekIdx} · maximum specific stimulus`;
  if (labelLower === 'taper')  return `Taper week ${phaseWeekIdx} · drop volume, hold intensity`;
  if (labelLower === 'race_week' || labelLower === 'race week') return 'Race week · sharpening for race day';
  if (labelLower === 'post_race' || labelLower === 'rebuild') return 'Recovery / rebuild · absorbing recent race load';
  return `${phase} week ${phaseWeekIdx}`;
}

function volumeRationale(distanceMi: number, type: string, vdot: number | null): string {
  if (type === 'easy' || type === 'general_aerobic' || type === 'recovery') {
    if (distanceMi >= 6) return `${distanceMi}mi · moderate-volume easy. Builds capacity without race-pace stress.`;
    if (distanceMi >= 3) return `${distanceMi}mi · short-to-moderate easy. Frequency over volume here.`;
    return `${distanceMi}mi · short recovery distance.`;
  }
  if (type === 'long') {
    return `${distanceMi}mi · long-run target. Daniels caps long runs at 25-30% of weekly mileage AND 2.5h time — pick the lower limit.`;
  }
  if (type === 'tempo' || type === 'threshold') {
    return `${distanceMi}mi · threshold session. Daniels prescribes T-pace work at 20-30 min cumulative (warmup + work + cooldown).`;
  }
  if (type === 'intervals') {
    return `${distanceMi}mi · interval session. Total work duration ~3-5% of weekly mileage at I-pace, divided into 3-5 min reps.`;
  }
  if (type === 'race') {
    return `${distanceMi}mi · race-day prescription.`;
  }
  return `${distanceMi}mi · plan target.`;
}

export function buildWhyThisWorkout(
  type: string,
  label: string,
  distanceMi: number,
  phase: string,
  phaseWeekIdx: number,
  vdot: number | null,
): WhyThisWorkout {
  const uncertaintyNotes: string[] = [];
  // Surface uncertainty when we can't verify the plan has explicit
  // per-workout rationale. Currently the plan stores type + volume
  // per day; purpose + cycle position are INFERRED from those.
  uncertaintyNotes.push('Purpose inferred from workout type · plan stores type + volume, not explicit rationale per session');

  return {
    type: label ? `${label} · ${type}` : type,
    cyclePosition: cyclePositionFor(phase, phaseWeekIdx),
    purpose: purposeForType(type),
    volumeChoice: volumeRationale(distanceMi, type, vdot),
    uncertaintyNotes,
  };
}
