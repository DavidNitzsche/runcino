/**
 * lib/coach/session-cue.ts · one-line coach-voice cue for today's run.
 *
 * iPhone pre-run sheet's SESSION CUE row. Single sentence, max two
 * short ones · imperative, direct, no hype, no exclamation, no
 * emoji, no em dashes. Specific to today's workout type and the
 * runner's recent context.
 *
 * Returns null when the engine can't compose honestly · iPhone hides
 * the CUE section rather than showing a generic placeholder. Empty
 * state IS the honest signal per the brief.
 *
 * Doctrine:
 *   · CLAUDE.md · facts only, never fabricate · "honest projection
 *     over heroic prescription"
 *   · designs/briefs/iphone-cue-field-2026-06-02.md · 6 example cues
 *     per workout type · this composer matches the shape
 *   · coaching-research.md doctrine · coach voice rules
 *
 * Generic mechanism · works for any runner. Context-aware (recent
 * hard session, heat, streaks) but doesn't fabricate · falls back to
 * a clean type-specific cue when context is thin.
 */

import type { Phase, WorkoutType } from './run-purpose';

export interface CueInput {
  type: WorkoutType;
  phase: Phase | null;
  plannedMi: number;
  /** 2026-06-02 · was yesterday a hard session (race/long/intervals
   *  /tempo/threshold)? Drives the "easy after hard" voice. */
  recentHardSession?: boolean;
  /** 2026-06-02 · expected HR penalty in bpm from heat today (per
   *  Research/06 heat adjustment). Adds an honest "it's hot, give
   *  yourself the bump" line on threshold/tempo. */
  heatPenaltyBpm?: number | null;
  /** 2026-06-02 · is HRV / RHR / sleep tracking 3+ days red? Adjusts
   *  voice for "we're watching this · don't push." */
  pillarDownStreak?: boolean;
}

/**
 * Compose the cue. Returns null when there's nothing honest to say
 * (cold-start, unrecognized type, or the type's cue space is empty).
 */
export function composeCue(input: CueInput): string | null {
  // Type-specific cue. Hard gate · unknown types return null.
  switch (input.type) {
    case 'easy':
      return composeEasyCue(input);
    case 'recovery':
      return 'Conversational. If you can\'t talk, you\'re going too hard.';
    case 'tempo':
      return composeTempoCue(input);
    case 'threshold':
      return composeThresholdCue(input);
    case 'intervals':
      return composeIntervalsCue(input);
    case 'long':
      return composeLongCue(input);
    case 'race':
      return composeRaceCue(input);
    case 'progression':
      return 'Build through the run. Last mile is the fastest mile.';
    case 'fartlek':
      return 'Mix the pace. Hard surges, easy floats, no clock chasing.';
    case 'shakeout':
      return 'Easy and short. Loosen the legs, save the engine.';
    case 'rest':
    case 'unplanned':
      return null;
    default:
      return null;
  }
}

// ─── per-type composers ────────────────────────────────────────────────

function composeEasyCue(input: CueInput): string {
  if (input.recentHardSession) {
    return 'Truly easy today. Yesterday\'s session needs the recovery to count.';
  }
  if (input.pillarDownStreak) {
    return 'Easy effort. Listen to the body, not the watch.';
  }
  if (input.plannedMi >= 8) {
    return 'Conversational pace. The volume is the workout, not the pace.';
  }
  return 'Keep the first mile slow. The pace finds itself by mile 3.';
}

function composeTempoCue(input: CueInput): string {
  if (input.heatPenaltyBpm != null && input.heatPenaltyBpm >= 5) {
    return `Hold the line by effort. Heat will bump HR ${input.heatPenaltyBpm} bpm above target.`;
  }
  if (input.pillarDownStreak) {
    return 'Bail if it feels off. One missed tempo doesn\'t cost a build.';
  }
  return 'Hold the line. Comfortably hard, not racing.';
}

function composeThresholdCue(input: CueInput): string {
  if (input.heatPenaltyBpm != null && input.heatPenaltyBpm >= 5) {
    return `Effort over HR today. Heat adds ${input.heatPenaltyBpm} bpm even on the right pace.`;
  }
  if (input.pillarDownStreak) {
    return 'Threshold is the bank. Skip a rep if form breaks before quality.';
  }
  return 'Run the band, not the cutoff. Drift early and you cook the back half.';
}

function composeIntervalsCue(input: CueInput): string {
  if (input.recentHardSession) {
    return 'Hold the first rep back. The set wins or loses on the opener.';
  }
  if (input.pillarDownStreak) {
    return 'Quality over quantity. Bail if form breaks before the count.';
  }
  return 'Even effort across the reps. Rep one sets the ceiling.';
}

function composeLongCue(input: CueInput): string {
  if (input.heatPenaltyBpm != null && input.heatPenaltyBpm >= 5) {
    return 'Hydrate early and often. Heat compounds across long miles.';
  }
  if (input.plannedMi >= 18) {
    return 'First half easy, second half is the workout. Trust the build.';
  }
  return 'Conversational through the middle. Close the last 2 with intent.';
}

function composeRaceCue(input: CueInput): string {
  if (input.phase === 'TAPER') {
    return 'Run your own race. Goal pace, not the field.';
  }
  if (input.plannedMi >= 13.1) {
    return 'Patience the first quarter. Race the last quarter.';
  }
  return 'Goal pace, settle quick, finish strong.';
}
