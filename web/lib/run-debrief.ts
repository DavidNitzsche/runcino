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
  /** The morning's recovery vitals + 30-day baselines (Apple Health). When
   *  present, an elevated-HR / off-day read names the actual cause instead
   *  of "possible fatigue — worth a check". */
  recovery?: RecoveryContext | null;
}

export interface RecoveryContext {
  hrvMs: number | null;
  hrvBaselineMs: number | null;
  restingHrBpm: number | null;
  restingHrBaselineBpm: number | null;
  sleepHours: number | null;
}

/** Join ["a","b","c"] → "a, b and c". */
function joinList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Read the recovery context into "off" factors (meaningfully worse than
 * baseline) and "normal" factors. Drives whether an elevated-HR run gets
 * a concrete cause ("HRV down 22%, 5.8h sleep") or a clean bill.
 */
export function recoveryRead(r?: RecoveryContext | null): {
  hasData: boolean; offFactors: string[]; normalFactors: string[];
} {
  const off: string[] = [];
  const normal: string[] = [];
  let has = false;
  if (!r) return { hasData: false, offFactors: off, normalFactors: normal };

  if (r.hrvMs != null) {
    has = true;
    if (r.hrvBaselineMs != null && r.hrvBaselineMs > 0) {
      const pct = Math.round((1 - r.hrvMs / r.hrvBaselineMs) * 100);
      if (pct >= 10) off.push(`HRV ${Math.round(r.hrvMs)}ms (down ${pct}% from your ${Math.round(r.hrvBaselineMs)}ms baseline)`);
      else normal.push(`HRV ${Math.round(r.hrvMs)}ms`);
    }
  }
  if (r.restingHrBpm != null) {
    has = true;
    if (r.restingHrBaselineBpm != null && r.restingHrBaselineBpm > 0) {
      const delta = Math.round(r.restingHrBpm - r.restingHrBaselineBpm);
      if (delta >= 4) off.push(`resting HR ${Math.round(r.restingHrBpm)} (+${delta} over your ${Math.round(r.restingHrBaselineBpm)} baseline)`);
      else normal.push(`resting HR ${Math.round(r.restingHrBpm)}`);
    }
  }
  if (r.sleepHours != null) {
    has = true;
    if (r.sleepHours < 6.5) off.push(`only ${r.sleepHours.toFixed(1)}h sleep`);
    else normal.push(`${r.sleepHours.toFixed(1)}h sleep`);
  }
  return { hasData: has, offFactors: off, normalFactors: normal };
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
    splits = [], maxHr, recovery,
  } = input;
  const rec = recoveryRead(recovery);

  const sentences: string[] = [];
  // Track whether the pace sentence already cited HR + %max so we don't
  // restate it in the dedicated HR sentence. When this is true we
  // either skip the HR line entirely (zone already mentioned in pace
  // sentence) or replace it with a TARGET-HR sentence telling the
  // runner where their HR should have been.
  let paceSentenceHadHr = false;

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

  // ── PACE + HR (cross-referenced for easy/long) ──────────────
  // Different logic per workout type:
  //   - easy/long: pace + HR cross-referenced into ONE narrative
  //     (so we don't say "ran too fast" AND "clean aerobic" — those
  //     contradict; the joint read is "fitness gain, target needs
  //     to update")
  //   - quality: avg pace is misleading, look at splits instead
  //   - race: comment on goal pace
  const isContinuous = planType === 'easy' || planType === 'long' || planType === 'recovery';

  if (isContinuous && paceLow && paceHigh && actualPaceSPerMi > 0) {
    // Compute pace status
    type PaceStatus = 'on-target' | 'slightly-fast' | 'fast' | 'very-fast' | 'slightly-slow' | 'slow';
    let paceStatus: PaceStatus;
    if (actualPaceSPerMi >= paceLow && actualPaceSPerMi <= paceHigh) paceStatus = 'on-target';
    else if (actualPaceSPerMi < paceLow) {
      const delta = paceLow - actualPaceSPerMi;
      paceStatus = delta < 20 ? 'slightly-fast' : delta < 60 ? 'fast' : 'very-fast';
    } else {
      const delta = actualPaceSPerMi - paceHigh;
      paceStatus = delta < 30 ? 'slightly-slow' : 'slow';
    }

    // Compute HR status (uses max_hr when available, otherwise qualitative)
    type HrStatus = 'unknown' | 'aerobic' | 'moderate' | 'elevated';
    let hrStatus: HrStatus = 'unknown';
    let hrPctSuffix = '';
    if (actualAvgHr && actualAvgHr > 0) {
      if (maxHr && maxHr > 0) {
        const pct = Math.round((actualAvgHr / maxHr) * 100);
        hrPctSuffix = ` (${pct}% max)`;
        hrStatus = pct < 70 ? 'aerobic' : pct < 80 ? 'moderate' : 'elevated';
      } else {
        // Qualitative bands without max HR
        hrStatus = actualAvgHr < 145 ? 'aerobic' : actualAvgHr < 160 ? 'moderate' : 'elevated';
      }
    }

    const pace = fmtPace(actualPaceSPerMi);
    const target = `${fmtPace(paceLow)}–${fmtPace(paceHigh)}/mi`;
    const hr = actualAvgHr ?? 0;
    // Any pace sentence that interpolates `${hrPctSuffix}` will mention
    // HR with %max — set the flag so the HR section knows the data is
    // already in the response.
    if (hr > 0 && hrPctSuffix) paceSentenceHadHr = true;

    // Cross-referenced narrative
    if (paceStatus === 'on-target') {
      if (hrStatus === 'aerobic') {
        sentences.push(`${pace}/mi at HR ${hr}${hrPctSuffix} — textbook easy execution.`);
      } else if (hrStatus === 'moderate') {
        sentences.push(`Pace held in target at ${pace}/mi but HR averaged ${hr}${hrPctSuffix} — moderate effort. Probably fine, but flag a check-in if it keeps trending up.`);
      } else if (hrStatus === 'elevated') {
        if (rec.offFactors.length > 0) {
          sentences.push(`Pace was right at ${pace}/mi but HR ran hot at ${hr}${hrPctSuffix} — and your recovery shows why: ${joinList(rec.offFactors)}. Under-recovered, not the run.`);
        } else if (rec.hasData) {
          sentences.push(`Pace was right at ${pace}/mi but HR ran hot at ${hr}${hrPctSuffix}, yet recovery looks normal (${joinList(rec.normalFactors)}) — likely heat or in-run dehydration, not fatigue.`);
        } else {
          sentences.push(`Pace was right at ${pace}/mi but HR ran hot at ${hr}${hrPctSuffix} — possible heat, fatigue, or sleep deficit. Worth a check.`);
        }
      } else {
        sentences.push(`Pace held in the target band at ${pace}/mi.`);
      }
    } else if (paceStatus === 'slightly-fast') {
      sentences.push(`Slightly quick at ${pace}/mi${hr ? `, HR ${hr}${hrPctSuffix}` : ''} — within reason.`);
    } else if (paceStatus === 'fast') {
      if (hrStatus === 'aerobic') {
        sentences.push(`Ran ${pace}/mi at HR ${hr}${hrPctSuffix} — well below the ${target} target but HR stayed firmly aerobic. That reads as a fitness gain, not "running too fast." Time to update your training paces — log a recent race to recalibrate.`);
      } else if (hrStatus === 'moderate') {
        sentences.push(`Ran ${pace}/mi at HR ${hr}${hrPctSuffix} — faster than easy target with moderate HR. Borderline aerobic; recovery should still be normal but watch for cumulative fatigue.`);
      } else if (hrStatus === 'elevated') {
        sentences.push(`Ran ${pace}/mi at HR ${hr}${hrPctSuffix} — that's a tempo, not an easy day. Recovery will take longer than a normal easy run.`);
      } else {
        sentences.push(`Ran ${pace}/mi — below the ${target} target. Easy days work best when they stay easy; watch that creep.`);
      }
    } else if (paceStatus === 'very-fast') {
      if (hrStatus === 'aerobic') {
        sentences.push(`Ran ${pace}/mi at HR ${hr}${hrPctSuffix} — way faster than the ${target} target but HR stayed aerobic. The pace target is clearly out of sync with your fitness. Update it.`);
      } else {
        sentences.push(`Ran ${pace}/mi${hr ? ` at HR ${hr}${hrPctSuffix}` : ''} — way faster than the ${target} target. That's a hard workout, not an easy day. Recovery tomorrow.`);
      }
    } else if (paceStatus === 'slightly-slow') {
      sentences.push(`Slightly slower than target at ${pace}/mi${hr ? `, HR ${hr}${hrPctSuffix}` : ''} — probably terrain or freshness.`);
    } else {
      // slow
      if (hrStatus === 'elevated') {
        if (rec.offFactors.length > 0) {
          sentences.push(`Slower than target at ${pace}/mi WITH elevated HR (${hr}${hrPctSuffix}) — and the data backs it up: ${joinList(rec.offFactors)}. That's a real off day; recovery needed.`);
        } else {
          sentences.push(`Slower than target at ${pace}/mi WITH elevated HR (${hr}${hrPctSuffix}) — strong signal of an off day. Sleep, hydration, or accumulated fatigue. Real recovery needed.`);
        }
      } else {
        sentences.push(`Slower than target at ${pace}/mi${hr ? `, HR ${hr}${hrPctSuffix}` : ''} — possibly fatigue, heat, or terrain. Worth a check.`);
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
  // With max HR available, use %max for exact zone labels and add a
  // TARGET-HR sentence telling the runner where their HR should have
  // been (eg "Easy target: Z2 / 122–140 bpm"). Without it, fall back
  // to qualitative bands (works for most recreational runners but not
  // personalized).
  //
  // If the pace sentence above ALREADY mentioned HR + %max, suppress
  // the duplicate `HR averaged X (Y% max · Zn)` sentence and replace
  // it with the target-HR reference — that's the missing info.
  if (actualAvgHr && actualAvgHr > 0) {
    const pct = maxHr && maxHr > 0 ? Math.round((actualAvgHr / maxHr) * 100) : null;
    if (pct !== null && maxHr) {
      // Personalized: %max zones
      const zone =
        pct < 60 ? 'Z1' :
        pct < 70 ? 'Z2' :
        pct < 80 ? 'Z3' :
        pct < 90 ? 'Z4' : 'Z5';

      // Target zone for this workout type
      const easyTargetLow = Math.round(maxHr * 0.60);
      const easyTargetHigh = Math.round(maxHr * 0.70);
      const longTargetLow = Math.round(maxHr * 0.65);
      const longTargetHigh = Math.round(maxHr * 0.75);

      if (isContinuous) {
        const isEasy = planType === 'easy' || planType === 'recovery';
        const tgtLow = isEasy ? easyTargetLow : longTargetLow;
        const tgtHigh = isEasy ? easyTargetHigh : longTargetHigh;
        const tgtZone = isEasy ? 'Z1–Z2' : 'Z2 (low Z3 ok)';

        if (paceSentenceHadHr) {
          // Pace sentence already said the HR + %max + qualitative read.
          // Just provide the target reference.
          if (zone === 'Z1' || zone === 'Z2') {
            sentences.push(`Target ${tgtZone} (${tgtLow}–${tgtHigh} bpm) — landed it.`);
          } else {
            const delta = Math.round(actualAvgHr - tgtHigh);
            const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;
            sentences.push(`Target ${tgtZone}: ${tgtLow}–${tgtHigh} bpm. You ran ${deltaStr} bpm over the easy ceiling.`);
          }
        } else {
          // Pace sentence didn't include HR — give the full HR read.
          if (zone === 'Z1' || zone === 'Z2') {
            sentences.push(`HR averaged ${actualAvgHr} (${pct}% max · ${zone}) — clean aerobic effort. Target ${tgtZone} (${tgtLow}–${tgtHigh} bpm).`);
          } else if (zone === 'Z3') {
            sentences.push(`HR averaged ${actualAvgHr} (${pct}% max · ${zone}) — moderate, above the easy zone. Target ${tgtZone}: ${tgtLow}–${tgtHigh} bpm.`);
          } else {
            sentences.push(`HR averaged ${actualAvgHr} (${pct}% max · ${zone}) — high for an easy day. Target ${tgtZone}: ${tgtLow}–${tgtHigh} bpm.`);
          }
        }
      } else if (planType === 'quality') {
        const tLow = Math.round(maxHr * 0.85);
        const tHigh = Math.round(maxHr * 0.92);
        if (zone === 'Z4' || zone === 'Z5') {
          sentences.push(`HR averaged ${actualAvgHr} (${pct}% max · ${zone}) — the work showed up. Target Z4 (${tLow}–${tHigh} bpm).`);
        } else {
          sentences.push(`HR averaged ${actualAvgHr} (${pct}% max · ${zone}) — lower than expected for threshold. Target Z4: ${tLow}–${tHigh} bpm.`);
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
