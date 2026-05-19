/**
 * C8 · Workout substitution menu · /overview TodayCard
 *
 * When the user taps Skip on today's workout, offer 2-3 substitutions
 * that target similar adaptations with different constraints (volume,
 * intensity, scheduling).
 *
 * Three substitution shapes per workout class:
 *
 *   SHORT VERSION      · same intensity, less volume — keeps the
 *                        stimulus but reduces fatigue
 *   CROSS-TRAINING     · same energy system, different modality —
 *                        protects from impact load
 *   RESCHEDULE         · move quality to later in the week, sub
 *                        easy/recovery in its place
 *
 * The menu explains what each substitution PRESERVES and what it
 * SACRIFICES. No silent auto-modification — the runner sees the
 * trade-off and chooses.
 *
 * SOURCE OF TRUTH
 * Reads from plan data + workout taxonomy. Suggestions are class-
 * specific (long-run subs differ from threshold subs).
 */

export interface WorkoutSubstitution {
  /** Short label shown on the button. */
  label: string;
  /** What the substitution accomplishes. */
  preserves: string;
  /** What it costs (the honest trade-off). */
  sacrifices: string;
  /** The substituted workout in plain English. */
  prescription: string;
}

export interface SubstitutionMenu {
  workoutLabel: string;
  workoutType: string;
  substitutions: WorkoutSubstitution[];
}

export function buildSubstitutionMenu(
  workoutType: string,
  label: string,
  distanceMi: number,
): SubstitutionMenu {
  const subs: WorkoutSubstitution[] = [];

  const isLong = workoutType === 'long' || distanceMi >= 9;
  const isQuality = workoutType === 'threshold' || workoutType === 'tempo'
    || workoutType === 'intervals' || workoutType === 'sub_threshold'
    || workoutType === 'threshold_intervals';
  const isEasy = workoutType === 'easy' || workoutType === 'general_aerobic'
    || workoutType === 'recovery';

  if (isLong) {
    subs.push({
      label: 'Shorter long run',
      preserves: 'Aerobic stimulus + glycogen demand at long-run pace.',
      sacrifices: `${Math.round(distanceMi * 0.3)} mi of time-on-feet — peak weeks need full distance for marathon-specific adaptation.`,
      prescription: `${Math.round(distanceMi * 0.7)} mi at long-run pace · stop short of full distance.`,
    });
    subs.push({
      label: 'Bike long ride',
      preserves: 'Aerobic time-on-feet equivalent at lower joint impact.',
      sacrifices: 'Running-specific muscle conditioning · neuromuscular pattern for long-pace running.',
      prescription: `${Math.round(distanceMi * 8)} min easy bike or elliptical · conversational effort.`,
    });
    subs.push({
      label: 'Move to tomorrow',
      preserves: 'Full long run intact, just shifted.',
      sacrifices: 'Compresses recovery before next quality day · check if next quality is too close.',
      prescription: 'Sub today: 30-40 min easy. Long run tomorrow at full distance.',
    });
  } else if (isQuality) {
    subs.push({
      label: 'Half-volume quality',
      preserves: 'Threshold/interval intensity stimulus.',
      sacrifices: 'Half the cumulative T-pace time — less aerobic capacity gain than the full session.',
      prescription: 'Cut work intervals in half (e.g., 3 × 1mi instead of 6 × 1mi). Same target pace.',
    });
    subs.push({
      label: 'Tempo at threshold-minus',
      preserves: 'Aerobic stress; cardiovascular stimulus around threshold.',
      sacrifices: 'Lactate-threshold pace specificity. Sustained tempo trains threshold less than intervals do.',
      prescription: `${Math.round(distanceMi * 0.6)} mi tempo at T-pace minus 10 s/mi (one HR zone below).`,
    });
    subs.push({
      label: 'Easy + reschedule',
      preserves: 'Body absorbs fatigue · quality stays in this week, just later.',
      sacrifices: 'Compresses recovery between today and the moved quality. Check Saturday/Sunday availability.',
      prescription: '4-5 mi easy today. Quality session moves to tomorrow (or up to 2 days out).',
    });
  } else if (isEasy) {
    subs.push({
      label: 'Recovery jog',
      preserves: 'Daily movement, blood flow, run streak.',
      sacrifices: '~half the mileage — aerobic-base contribution shrinks slightly.',
      prescription: `${Math.round(distanceMi * 0.5)} mi very easy (Z1) · walk breaks ok.`,
    });
    subs.push({
      label: 'Bike or walk',
      preserves: 'Active recovery, blood flow, no skipped recovery day.',
      sacrifices: 'Running-specific aerobic adaptation · neuromuscular pattern.',
      prescription: '30-45 min easy bike OR brisk 45-60 min walk.',
    });
    subs.push({
      label: 'Full rest',
      preserves: 'Recovery for the next quality session.',
      sacrifices: 'Weekly volume target drops by today\'s mileage.',
      prescription: 'No running today. Stretch, walk, sleep.',
    });
  } else {
    // race day / unknown — minimal menu
    subs.push({
      label: 'Easy 30 min',
      preserves: 'Active recovery, light cardio.',
      sacrifices: 'Original session intent.',
      prescription: '30 min easy at conversational pace.',
    });
    subs.push({
      label: 'Full rest',
      preserves: 'Complete recovery.',
      sacrifices: 'Weekly mileage / training stimulus.',
      prescription: 'No running today.',
    });
  }

  return {
    workoutLabel: label || workoutType,
    workoutType,
    substitutions: subs,
  };
}
