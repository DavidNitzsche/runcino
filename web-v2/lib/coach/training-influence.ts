/**
 * lib/coach/training-influence.ts · per-done-workout trajectory
 * signal for the KEY WORKOUTS panel.
 *
 * Answers ONE question per row: did this workout move my fitness
 * toward the race?
 *
 * NOT a recap of execution mechanics (that lives in the run-detail
 * modal). This is the trajectory read: did this workout deliver the
 * intended stimulus, is the pattern building, is the goal still on
 * track or slipping.
 *
 * Five kinds:
 *   · on_track    delivered the intended stimulus, fits the phase
 *   · consistent  N-th in a row, the pattern is building
 *   · working     produced a real signal (VDOT bump, HR drop at pace)
 *   · slipping    pace fell off, stimulus not delivered
 *   · compromised adapted/skipped/partial, training cost
 *
 * Doctrine the composer reads:
 *   · workout type → expected stimulus
 *   · done pace + HR vs planned pace + HR
 *   · trend across recent same-type workouts (consistency)
 *   · plan phase (build vs taper · stimulus expectations differ)
 *   · goal race distance (trajectory is goal-anchored)
 *   · active adaptations (compromised state)
 *
 * Web agent brief: designs/briefs/key-workouts-training-trajectory-and-
 * adapt-dedup-brief.md
 */

export type TrainingInfluenceKind =
  | 'on_track'
  | 'consistent'
  | 'working'
  | 'slipping'
  | 'compromised';

export interface TrainingInfluence {
  kind: TrainingInfluenceKind;
  copy: string;
}

export interface InfluenceInput {
  /** Workout type (canonical effort key). */
  type: string;
  /** Planned pace target in seconds per mile, when authored. */
  plannedPaceSec: number | null;
  /** Actual completed pace · work-pace for quality, avg for easy/long. */
  donePaceSec: number | null;
  /** Avg HR if recorded · feeds working-signal detection. */
  doneAvgHr: number | null;
  /** Number of consecutive completed same-type quality workouts INCLUDING this one. */
  sameTypeStreak: number;
  /** Was this workout adapted (downgraded/shaved/etc) by the auto-adapter? */
  wasAdapted: boolean;
  /** If wasAdapted, has the runner subsequently restored the original? */
  wasRestored: boolean;
  /** Plan phase at this workout's date (BASE / BUILD / QUALITY / TAPER / RACE-SPECIFIC). */
  phaseLabel: string | null;
  /** Race distance the plan is anchored to · feeds doctrine notes per distance. */
  raceDistanceMi: number | null;
  /** HR delta vs typical for this pace bucket · negative = improving. */
  hrOnPaceDelta: number | null;
}

/**
 * Compose the training-influence envelope for a completed workout.
 *
 * Returns null when:
 *   · the workout isn't done yet
 *   · no plan reference (off-plan run)
 *   · the type isn't quality + isn't long (we don't trajectory-label
 *     easy/recovery in this panel · they don't move trajectory)
 */
export function composeTrainingInfluence(input: InfluenceInput): TrainingInfluence | null {
  const QUALITY = new Set(['intervals', 'tempo', 'threshold', 'long']);
  if (!QUALITY.has(input.type)) return null;

  // Compromised path · adapted AND not restored.
  // If the runner restored, the workout earns on_track or slipping based
  // on actual execution (not the historical compromise).
  if (input.wasAdapted && !input.wasRestored) {
    return {
      kind: 'compromised',
      copy: composeCompromisedCopy(input),
    };
  }

  // Need pace data to call a trajectory · short-circuit when missing.
  if (input.plannedPaceSec == null || input.donePaceSec == null) {
    // Adapted-and-restored with no execution data yet · still compromised
    // until we see actual paces land.
    if (input.wasAdapted && input.wasRestored) {
      return { kind: 'compromised', copy: 'Restored. Effort and pace data once the run lands.' };
    }
    return null;
  }

  // Pace delta · seconds per mile. Negative = faster than planned.
  const paceDelta = input.donePaceSec - input.plannedPaceSec;
  // Tolerance per type · quality demands tighter execution.
  const tolerance = input.type === 'long' ? 18 : 12;

  // Slipping path · pace fell off by ≥ 2× tolerance.
  if (paceDelta > tolerance * 2) {
    return {
      kind: 'slipping',
      copy: composeSlippingCopy(input, paceDelta),
    };
  }

  // Working path · pace held AND HR notably lower than typical
  // (genuine adaptation signal · the engine learned something).
  if (Math.abs(paceDelta) <= tolerance && input.hrOnPaceDelta != null && input.hrOnPaceDelta <= -4) {
    return {
      kind: 'working',
      copy: composeWorkingCopy(input),
    };
  }

  // Consistent path · 3rd or later in a row of same-type quality.
  // Stronger signal than on_track because the PATTERN is the point.
  if (input.sameTypeStreak >= 3) {
    return {
      kind: 'consistent',
      copy: composeConsistentCopy(input),
    };
  }

  // On-track default · workout hit pace, single-run signal.
  return {
    kind: 'on_track',
    copy: composeOnTrackCopy(input),
  };
}

// ─── copy composers (no citations · doctrine in code, not on screen) ─────

function composeCompromisedCopy(i: InfluenceInput): string {
  if (i.type === 'long') {
    return 'Long run adapted. Cumulative aerobic minutes behind plan.';
  }
  if (i.type === 'intervals') {
    return 'Intervals downgraded. VO2max stimulus deferred to next block.';
  }
  // tempo / threshold
  return 'Threshold work eased. Cumulative tempo behind plan.';
}

function composeSlippingCopy(_i: InfluenceInput, paceDeltaSec: number): string {
  const secStr = `${paceDeltaSec.toFixed(0)}s slow`;
  if (_i.type === 'long') {
    return `Long-run pace ${secStr}. Endurance signal weaker than the plan calls for.`;
  }
  if (_i.type === 'intervals') {
    return `Intervals ${secStr}. VO2max stimulus not delivered this rep set.`;
  }
  return `Threshold pace ${secStr}. Aerobic stimulus not landing.`;
}

function composeWorkingCopy(i: InfluenceInput): string {
  const bumpStr = `${Math.abs(i.hrOnPaceDelta ?? 0)} bpm`;
  if (i.type === 'long') {
    return `Pace held with HR ${bumpStr} lower than usual. Aerobic base deepening.`;
  }
  if (i.type === 'intervals') {
    return `Reps on target with HR ${bumpStr} lower than usual. VO2 ceiling rising.`;
  }
  return `Pace held with HR ${bumpStr} lower than usual. Aerobic engine sharper.`;
}

function composeConsistentCopy(i: InfluenceInput): string {
  if (i.type === 'long') {
    return `${i.sameTypeStreak} long runs in a row. Endurance compounding.`;
  }
  if (i.type === 'intervals') {
    return `${i.sameTypeStreak} interval sessions in a row. VO2max stimulus building.`;
  }
  return `${i.sameTypeStreak} threshold workouts in a row. Aerobic stimulus building.`;
}

function composeOnTrackCopy(i: InfluenceInput): string {
  if (i.type === 'long') {
    return 'Long run hit. Aerobic minutes on plan.';
  }
  if (i.type === 'intervals') {
    return 'Intervals hit. Reps delivered the intended VO2 stimulus.';
  }
  if (i.type === 'tempo' || i.type === 'threshold') {
    return 'Threshold pace hit. Race-pace work compounding.';
  }
  return 'On plan.';
}
