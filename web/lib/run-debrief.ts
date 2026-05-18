/**
 * Run debrief generator — produces a 1-3 sentence coach response to a
 * completed run by comparing the actuals to the planned workout.
 *
 * Tone: direct, specific, no hedging. Cite the numbers. The coach is
 * looking at your data; not reading a workout description.
 *
 * Used by the completed-run modal where the "COACH TAKE" section
 * previously rendered the generic plan effort copy regardless of how
 * the runner actually executed.
 */

export interface DebriefInput {
  /** Planned workout label, e.g. "Long" / "Threshold · Cruise Intervals". */
  planLabel: string;
  /** Workout type for category-specific logic. */
  planType: 'easy' | 'long' | 'quality' | 'race' | 'rest' | 'recovery' | string;
  /** Planned distance in miles. 0 / undefined when no plan match. */
  planDistanceMi: number;
  /** Parsed pace bounds in seconds/mile. null when target isn't numeric. */
  paceLow: number | null;
  paceHigh: number | null;
  /** Actual stats. */
  actualDistanceMi: number;
  actualPaceSPerMi: number;
  actualAvgHr: number | null;
}

function fmtPace(s: number): string {
  if (!s || s <= 0) return '—';
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Parse a paceTarget string like "9:00 – 9:30 per mile" into a [low, high]
 * tuple of seconds per mile. Returns nulls when the string is text-only
 * ("Half-marathon goal pace", "Race pace", "—").
 */
export function parsePaceBounds(paceTarget: string): [number | null, number | null] {
  if (!paceTarget) return [null, null];
  const matches = [...paceTarget.matchAll(/(\d+):(\d{2})/g)].map(
    (m) => parseInt(m[1], 10) * 60 + parseInt(m[2], 10),
  );
  if (matches.length === 0) return [null, null];
  if (matches.length === 1) return [matches[0], matches[0]];
  // Range or progressive — use min as low, max as high
  return [Math.min(...matches), Math.max(...matches)];
}

export function generateRunDebrief(input: DebriefInput): string {
  const {
    planType, planDistanceMi, paceLow, paceHigh,
    actualDistanceMi, actualPaceSPerMi, actualAvgHr,
  } = input;

  const sentences: string[] = [];

  // ── DISTANCE ────────────────────────────────────────────────
  if (planDistanceMi > 0) {
    const pct = Math.round((actualDistanceMi / planDistanceMi) * 100);
    if (pct >= 90 && pct <= 110) {
      sentences.push(`Hit the planned distance — ${actualDistanceMi.toFixed(1)} of ${planDistanceMi} mi.`);
    } else if (pct < 60) {
      sentences.push(`Well short — ${actualDistanceMi.toFixed(1)} of ${planDistanceMi} planned mi (${pct}%).`);
    } else if (pct < 90) {
      sentences.push(`Shorter than planned — ${actualDistanceMi.toFixed(1)} of ${planDistanceMi} mi (${pct}%).`);
    } else if (pct <= 130) {
      sentences.push(`Over plan — ${actualDistanceMi.toFixed(1)} mi vs ${planDistanceMi} planned (${pct}%).`);
    } else {
      sentences.push(`Way over plan — ${actualDistanceMi.toFixed(1)} mi vs ${planDistanceMi} planned (${pct}%).`);
    }
  } else if (actualDistanceMi > 0) {
    sentences.push(`Ran ${actualDistanceMi.toFixed(1)} mi off plan.`);
  }

  // ── PACE ────────────────────────────────────────────────────
  // Different logic per workout type:
  //   - easy/long: avg pace IS the pace — compare directly to range
  //   - quality (threshold/intervals): avg pace includes warm/cool, so
  //     it's misleading; just flag if it's way off the easy band
  //   - race: comment on whether goal pace held
  const isContinuous = planType === 'easy' || planType === 'long' || planType === 'recovery';

  if (isContinuous && paceLow && paceHigh && actualPaceSPerMi > 0) {
    if (actualPaceSPerMi >= paceLow && actualPaceSPerMi <= paceHigh) {
      sentences.push(`Pace held in the target band at ${fmtPace(actualPaceSPerMi)}/mi.`);
    } else if (actualPaceSPerMi < paceLow) {
      const delta = paceLow - actualPaceSPerMi;
      if (delta < 20) {
        sentences.push(`Slightly quick at ${fmtPace(actualPaceSPerMi)}/mi — within reason.`);
      } else if (delta < 60) {
        sentences.push(`Ran ${fmtPace(actualPaceSPerMi)}/mi — ${delta} sec/mi below easy target. Watch that creep; aerobic days work best when they stay aerobic.`);
      } else {
        sentences.push(`Ran ${fmtPace(actualPaceSPerMi)}/mi — way faster than the ${fmtPace(paceLow)}/mi floor. That's a tempo, not an easy day. Recovery tomorrow.`);
      }
    } else {
      // slower than paceHigh
      const delta = actualPaceSPerMi - paceHigh;
      if (delta < 30) {
        sentences.push(`Slightly slower than target at ${fmtPace(actualPaceSPerMi)}/mi — probably terrain or freshness.`);
      } else {
        sentences.push(`Slower than target at ${fmtPace(actualPaceSPerMi)}/mi — possibly fatigue, heat, or terrain. Worth a check.`);
      }
    }
  } else if (planType === 'quality' && actualPaceSPerMi > 0) {
    // For threshold/intervals — avg pace isn't a direct comparison
    if (paceLow && actualPaceSPerMi > paceLow + 90) {
      sentences.push(`Avg pace ${fmtPace(actualPaceSPerMi)}/mi suggests the interval targets weren't hit — check the splits to confirm.`);
    } else if (paceLow && actualPaceSPerMi < paceLow + 30) {
      sentences.push(`Avg pace ${fmtPace(actualPaceSPerMi)}/mi across the session is on the fast end — splits will show how the intervals landed.`);
    } else {
      sentences.push(`Avg pace ${fmtPace(actualPaceSPerMi)}/mi. The splits column shows how each interval landed.`);
    }
  } else if (planType === 'race' && actualPaceSPerMi > 0) {
    sentences.push(`Race pace: ${fmtPace(actualPaceSPerMi)}/mi.`);
  }

  // ── HEART RATE ──────────────────────────────────────────────
  // Without user max HR, just give a qualitative feel based on
  // typical aerobic zone (130-145), moderate (145-160), hard (160+).
  if (actualAvgHr && actualAvgHr > 0) {
    if (isContinuous) {
      if (actualAvgHr < 145) {
        sentences.push(`HR averaged ${actualAvgHr} — clean aerobic effort.`);
      } else if (actualAvgHr < 160) {
        sentences.push(`HR averaged ${actualAvgHr} — moderate effort, on the upper edge of easy.`);
      } else {
        sentences.push(`HR averaged ${actualAvgHr} — high for an easy day. The pace was probably the cause.`);
      }
    } else if (planType === 'quality' || planType === 'race') {
      sentences.push(`Avg HR ${actualAvgHr}${actualAvgHr >= 160 ? ' — the work showed up' : ''}.`);
    }
  }

  // Fallback if nothing matched
  if (sentences.length === 0) {
    sentences.push(`Logged ${actualDistanceMi.toFixed(1)} mi at ${fmtPace(actualPaceSPerMi)}/mi${actualAvgHr ? `, HR ${actualAvgHr}` : ''}.`);
  }

  // Keep first 2-3 sentences max — concise > exhaustive
  return sentences.slice(0, 3).join(' ');
}
