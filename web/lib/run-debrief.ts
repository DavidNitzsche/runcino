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

export interface DebriefSplit {
  mile: number;
  paceSPerMi: number;
  avgHr: number | null;
}

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
  /** Per-mile splits from Strava. Empty when not available yet. */
  splits?: DebriefSplit[];
  /** User's max HR (bpm). When set, HR commentary uses %max zones
   *  instead of qualitative ranges. */
  maxHr?: number | null;
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

/**
 * Analyze per-mile splits against an interval pace target to detect
 * which miles were "working" (interval pace held) vs "recovery".
 * Returns null when splits are missing or there's no numeric target.
 */
function analyzeIntervalSplits(
  splits: DebriefSplit[],
  paceLow: number,
  paceHigh: number,
): {
  workingMiles: number;
  workingPaceAvg: number;       // average pace across working miles
  workingPaceLow: number;       // fastest working mile
  workingPaceHigh: number;      // slowest working mile
  totalMiles: number;
} | null {
  if (splits.length === 0) return null;
  // "Working" = pace within (paceLow - 30s, paceHigh + 30s).
  // Generous on the slow side because the first/last mile of a working
  // interval often shows mixed pace (the warm-up tail bleeds in).
  const lo = paceLow - 30;
  const hi = paceHigh + 30;
  const working = splits.filter((s) => s.paceSPerMi >= lo && s.paceSPerMi <= hi);
  if (working.length === 0) return null;
  const paces = working.map((s) => s.paceSPerMi);
  return {
    workingMiles: working.length,
    workingPaceAvg: Math.round(paces.reduce((a, b) => a + b, 0) / paces.length),
    workingPaceLow: Math.min(...paces),
    workingPaceHigh: Math.max(...paces),
    totalMiles: splits.length,
  };
}

export function generateRunDebrief(input: DebriefInput): string {
  const {
    planType, planDistanceMi, paceLow, paceHigh,
    actualDistanceMi, actualPaceSPerMi, actualAvgHr,
    splits = [], maxHr,
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
    // For threshold/intervals: avg pace IS misleading (includes warm/
    // cool down). Look at the actual splits to decide if intervals
    // landed on target.
    const ivl = paceLow && paceHigh ? analyzeIntervalSplits(splits, paceLow, paceHigh) : null;
    if (ivl) {
      const range = ivl.workingPaceLow === ivl.workingPaceHigh
        ? `${fmtPace(ivl.workingPaceLow)}/mi`
        : `${fmtPace(ivl.workingPaceLow)}–${fmtPace(ivl.workingPaceHigh)}/mi`;
      sentences.push(
        `${ivl.workingMiles} working mile${ivl.workingMiles === 1 ? '' : 's'} at ${range} — intervals landed on target.`,
      );
    } else if (splits.length > 0 && paceLow && paceHigh) {
      // Splits exist but none fall in the interval band — workout didn't land
      const fastestSplit = Math.min(...splits.map((s) => s.paceSPerMi));
      sentences.push(
        `Intervals didn't land — fastest split was ${fmtPace(fastestSplit)}/mi vs the ${fmtPace(paceLow)}–${fmtPace(paceHigh)}/mi target. Either you bailed or the pace target's too aggressive.`,
      );
    } else if (paceLow && actualPaceSPerMi > paceLow + 90) {
      sentences.push(`Avg pace ${fmtPace(actualPaceSPerMi)}/mi suggests the interval targets weren't hit — check splits to confirm.`);
    } else {
      sentences.push(`Avg pace ${fmtPace(actualPaceSPerMi)}/mi. Splits column shows the per-mile detail.`);
    }
  } else if (planType === 'race' && actualPaceSPerMi > 0) {
    sentences.push(`Race pace: ${fmtPace(actualPaceSPerMi)}/mi.`);
  }

  // ── HEART RATE ──────────────────────────────────────────────
  // With max HR available, use %max for exact zone labels.
  // Without it, fall back to qualitative bands (works for most
  // recreational runners but not personalized).
  if (actualAvgHr && actualAvgHr > 0) {
    const pct = maxHr && maxHr > 0 ? Math.round((actualAvgHr / maxHr) * 100) : null;
    if (pct !== null) {
      // Personalized: %max zones
      const zone =
        pct < 60 ? 'Z1' :
        pct < 70 ? 'Z2' :
        pct < 80 ? 'Z3' :
        pct < 90 ? 'Z4' : 'Z5';
      if (isContinuous) {
        if (zone === 'Z1' || zone === 'Z2') {
          sentences.push(`HR averaged ${actualAvgHr} (${pct}% max · ${zone}) — clean aerobic effort.`);
        } else if (zone === 'Z3') {
          sentences.push(`HR averaged ${actualAvgHr} (${pct}% max · ${zone}) — moderate effort, above the easy zone.`);
        } else {
          sentences.push(`HR averaged ${actualAvgHr} (${pct}% max · ${zone}) — high for an easy day.`);
        }
      } else if (planType === 'quality') {
        if (zone === 'Z4' || zone === 'Z5') {
          sentences.push(`HR averaged ${actualAvgHr} (${pct}% max · ${zone}) — the work showed up.`);
        } else {
          sentences.push(`HR averaged ${actualAvgHr} (${pct}% max · ${zone}) — lower than expected for threshold work.`);
        }
      } else if (planType === 'race') {
        sentences.push(`HR averaged ${actualAvgHr} (${pct}% max · ${zone}).`);
      }
    } else {
      // Fallback: qualitative bands
      if (isContinuous) {
        if (actualAvgHr < 145) {
          sentences.push(`HR averaged ${actualAvgHr} — clean aerobic effort.`);
        } else if (actualAvgHr < 160) {
          sentences.push(`HR averaged ${actualAvgHr} — moderate effort, on the upper edge of easy.`);
        } else {
          sentences.push(`HR averaged ${actualAvgHr} — high for an easy day.`);
        }
      } else if (planType === 'quality' || planType === 'race') {
        sentences.push(`Avg HR ${actualAvgHr}${actualAvgHr >= 160 ? ' — the work showed up' : ''}.`);
      }
    }
  }

  // Fallback if nothing matched
  if (sentences.length === 0) {
    sentences.push(`Logged ${actualDistanceMi.toFixed(1)} mi at ${fmtPace(actualPaceSPerMi)}/mi${actualAvgHr ? `, HR ${actualAvgHr}` : ''}.`);
  }

  // Keep first 2-3 sentences max — concise > exhaustive
  return sentences.slice(0, 3).join(' ');
}
