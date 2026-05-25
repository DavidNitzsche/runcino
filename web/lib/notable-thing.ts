/**
 * notable-thing · pick the ONE observation worth telling the runner.
 *
 * Per the coach voice doctrine (see docs/COACH_TODAY_SPEC.md §6), every
 * post-run briefing names ONE thing about the run, not five. This module
 * picks that one thing from the available run data + the runner's
 * baselines, ranked by what a coach would actually notice.
 *
 * Ranking (highest priority first):
 *   1. Form / cadence off baseline (cadence low for easy, etc.)
 *   2. HR drift unusual for the workout type
 *   3. Pace pattern (fade, surge, splits inconsistency)
 *   4. Conditions impact (heat / humidity / wind shifted the run)
 *   5. PR or new ground (longest, fastest, etc.)
 *
 * Returns a short human-readable string the coach prompt embeds, OR
 * null when nothing notable warrants saying. Nothing notable is a valid
 * outcome — coach moves to meta-pattern observations instead.
 */

export interface NotableThingInputs {
  /** The run that just happened. */
  run: {
    distanceMi: number;
    movingTimeS: number;
    paceSPerMi: number;
    avgHr: number | null;
    maxHr: number | null;
    avgCadence: number | null;
    splits?: Array<{ mile: number; paceSPerMi: number; avgHr: number | null }>;
  };
  /** What the plan asked for today. */
  workout: {
    type: 'easy' | 'recovery' | 'long' | 'quality' | 'race' | string;
    label: string;
    distanceMi: number;
    /** Target pace pair if known (low, high), seconds per mile. */
    targetPaceSPerMi?: [number, number] | null;
  };
  /** Runner baselines — what's "normal" for them. */
  baselines: {
    /** Typical cadence for easy runs (spm). 168-180 is healthy adult range. */
    cadenceEasy: number | null;
    /** Typical avg HR for easy runs (bpm). */
    avgHrEasy: number | null;
    /** Resting HR (bpm). */
    restingHr: number | null;
  };
  /** Conditions if known. */
  weather?: {
    tempF: number | null;
    humidityPct: number | null;
    isHot?: boolean;
  };
}

export interface NotableThing {
  /** Short prose for the coach prompt to embed. */
  text: string;
  /** Tag for diagnostics — which rule fired. */
  kind:
    | 'cadence-low'
    | 'cadence-high'
    | 'hr-drift'
    | 'hr-high-for-easy'
    | 'pace-fade'
    | 'splits-clean'
    | 'conditions-warm'
    | 'pr-new-ground'
    | 'none';
}

export function pickNotableThing(input: NotableThingInputs): NotableThing | null {
  const { run, workout, baselines, weather } = input;
  const isEasy = workout.type === 'easy' || workout.type === 'recovery' || workout.type === 'long';
  const isQuality = workout.type === 'quality' || workout.type === 'race';

  // ── 1. Cadence off baseline (only meaningful when we have a baseline) ──
  if (run.avgCadence != null && baselines.cadenceEasy != null && baselines.cadenceEasy > 0) {
    const delta = run.avgCadence - baselines.cadenceEasy;
    // Easy runs: low cadence is fine (relaxed stride), high is a flag.
    if (isEasy && delta <= -8) {
      return {
        text: `Cadence was a bit low today, around ${Math.round(run.avgCadence)} spm (your easy baseline is ~${Math.round(baselines.cadenceEasy)}). For easy that's actually fine — it usually means you're relaxed.`,
        kind: 'cadence-low',
      };
    }
    if (isEasy && delta >= 8) {
      return {
        text: `Cadence ran high today, ${Math.round(run.avgCadence)} spm vs your easy baseline ~${Math.round(baselines.cadenceEasy)}. On easy that usually means you were pushing harder than the plan called for.`,
        kind: 'cadence-high',
      };
    }
    // Quality runs: low cadence is a flag (form breaking down).
    if (isQuality && delta <= -5) {
      return {
        text: `Cadence dropped during quality work — ${Math.round(run.avgCadence)} spm vs your usual ~${Math.round(baselines.cadenceEasy)}. Worth watching on the next hard session; usually means the legs went before the engine did.`,
        kind: 'cadence-low',
      };
    }
  }

  // ── 2. HR drift inside a quality session (need splits) ──
  if (isQuality && run.splits && run.splits.length >= 3) {
    const validSplits = run.splits.filter(s => s.avgHr != null) as Array<{ mile: number; paceSPerMi: number; avgHr: number }>;
    if (validSplits.length >= 3) {
      const firstHr = validSplits[0].avgHr;
      const lastHr = validSplits[validSplits.length - 1].avgHr;
      const drift = lastHr - firstHr;
      if (drift >= 10) {
        return {
          text: `HR climbed ${drift} bpm from rep 1 to the last rep. Bigger drift than usual on quality work — could be heat, could be under-fueled, worth checking the sleep / fueling combo before the next one.`,
          kind: 'hr-drift',
        };
      }
      if (drift <= 5) {
        return {
          text: `HR drift was clean across the reps — ${firstHr} to ${lastHr} bpm. That's the kind of control we want on quality work.`,
          kind: 'splits-clean',
        };
      }
    }
  }

  // ── 3. HR high for an easy run (need baseline) ──
  if (isEasy && run.avgHr != null && baselines.avgHrEasy != null) {
    const delta = run.avgHr - baselines.avgHrEasy;
    if (delta >= 10) {
      return {
        text: `Avg HR was ${run.avgHr} bpm today, well above your easy baseline (~${baselines.avgHrEasy}). Could be heat, could be under-recovery — worth a check on tomorrow.`,
        kind: 'hr-high-for-easy',
      };
    }
  }

  // ── 4. Pace fade on a long run (need splits) ──
  if (workout.type === 'long' && run.splits && run.splits.length >= 6) {
    const half = Math.floor(run.splits.length / 2);
    const firstHalf = run.splits.slice(0, half);
    const lastHalf = run.splits.slice(half);
    const avg = (arr: typeof run.splits) => arr.reduce((s, x) => s + x.paceSPerMi, 0) / arr.length;
    const fade = avg(lastHalf) - avg(firstHalf);
    if (fade >= 30) {
      return {
        text: `Back half ran ~${Math.round(fade)} sec/mi slower than the front half. Some fade is expected on a long run; this is enough that fueling could probably move earlier next time.`,
        kind: 'pace-fade',
      };
    }
  }

  // ── 5. Heat / humidity shaped the run ──
  if (weather && (weather.isHot || (weather.tempF != null && weather.tempF >= 75) || (weather.humidityPct != null && weather.humidityPct >= 80))) {
    const tempStr = weather.tempF != null ? `${Math.round(weather.tempF)}°F` : '';
    const humStr = weather.humidityPct != null ? `${Math.round(weather.humidityPct)}% humidity` : '';
    const condStr = [tempStr, humStr].filter(Boolean).join(' / ');
    return {
      text: `Conditions were tough — ${condStr}. That bends HR up and pace down on any easy or long run; today's effort is honest, the watch numbers will recover when the weather cooperates.`,
      kind: 'conditions-warm',
    };
  }

  // No observation meets the threshold. Coach will fall back to
  // meta-pattern / week-shape observations instead.
  return null;
}
