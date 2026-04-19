/**
 * Auto-group adjacent segments into 6–8 human-readable phases.
 *
 * Heuristic:
 *   Start a new phase when either
 *     (a) mean grade changes direction for > 400m, or
 *     (b) pace differs from current phase mean by > 15 s/mi
 *
 * Then:
 *   - Merge any phase under 0.75 mi into its neighbor
 *   - Label phases using a course-facts file when one is available;
 *     fall back to geometry-based labels ("Long climb", etc.) otherwise
 *
 * Phase labels and notes are ONLY taken from a course-facts file —
 * there is no code path that invents a landmark name. See course-facts.ts.
 */

import { M_PER_MI, formatHMS, formatPaceMi } from './time';
import type { CourseFacts } from './course-facts';
import type { Phase, Segment } from './types';

export interface GroupOptions {
  /** Target phase count. We try to emit this many. Default 6. */
  targetPhases?: number;
  /** Minimum phase distance in miles (merge anything shorter). Default 0.75. */
  minPhaseMi?: number;
  /** Starting pace-deviation threshold. Default 15 s/mi. */
  paceThresholdS?: number;
  /** Course facts for landmark labeling. If omitted, geometry-only. */
  courseFacts?: CourseFacts;
}

interface RawPhase {
  startMi: number;
  endMi: number;
  segments: Segment[];
}

function paceOfRawPhase(p: RawPhase): number {
  let totalMi = 0, totalTimeS = 0;
  for (const seg of p.segments) {
    const mi = seg.distanceM / M_PER_MI;
    totalMi += mi;
    totalTimeS += mi * seg.targetPaceSPerMi;
  }
  return totalMi > 0 ? totalTimeS / totalMi : 0;
}

function gradeOfRawPhase(p: RawPhase): number {
  let sumW = 0, total = 0;
  for (const seg of p.segments) {
    sumW += seg.distanceM;
    total += seg.meanGradePct * seg.distanceM;
  }
  return sumW > 0 ? total / sumW : 0;
}

/** Classify grade with a dead-zone. Grades within ±GRADE_DEADZONE_PCT
 *  count as "flat" — prevents GPS noise from generating spurious phases. */
const GRADE_DEADZONE_PCT = 1.0;
function gradeSign(gradePct: number): -1 | 0 | 1 {
  if (gradePct > GRADE_DEADZONE_PCT) return 1;
  if (gradePct < -GRADE_DEADZONE_PCT) return -1;
  return 0;
}

function splitSegmentsIntoRawPhases(
  segments: Segment[],
  paceThresholdS: number
): RawPhase[] {
  if (segments.length === 0) return [];
  const phases: RawPhase[] = [];
  let cur: RawPhase = {
    startMi: segments[0].startMi,
    endMi: segments[0].endMi,
    segments: [segments[0]],
  };
  let oppositeRunM = 0;
  let lastSign = gradeSign(segments[0].meanGradePct);

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const sign = gradeSign(seg.meanGradePct);

    // Count "opposite-direction" run only when both current and previous
    // have clear signs and they disagree. Flat segments reset the counter.
    if (sign !== 0 && lastSign !== 0 && sign !== lastSign) {
      oppositeRunM += seg.distanceM;
    } else if (sign !== lastSign && sign !== 0) {
      // Coming out of flat in a new direction — start counting
      oppositeRunM = seg.distanceM;
    } else {
      oppositeRunM = 0;
    }
    if (sign !== 0) lastSign = sign;

    const curPace = paceOfRawPhase(cur);
    const paceDelta = Math.abs(seg.targetPaceSPerMi - curPace);

    if (oppositeRunM > 800 || paceDelta > paceThresholdS) {
      phases.push(cur);
      cur = { startMi: seg.startMi, endMi: seg.endMi, segments: [seg] };
      oppositeRunM = 0;
    } else {
      cur.endMi = seg.endMi;
      cur.segments.push(seg);
    }
  }
  phases.push(cur);
  return phases;
}

function mergeShortPhases(phases: RawPhase[], minMi: number): RawPhase[] {
  if (phases.length <= 1) return phases;
  let changed = true;
  let out = [...phases];
  while (changed) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const p = out[i];
      const mi = p.endMi - p.startMi;
      if (mi < minMi) {
        const left = out[i - 1];
        const right = out[i + 1];
        const leftMi = left ? left.endMi - left.startMi : Infinity;
        const rightMi = right ? right.endMi - right.startMi : Infinity;
        if (leftMi <= rightMi && left) {
          left.endMi = p.endMi;
          left.segments.push(...p.segments);
          out.splice(i, 1);
        } else if (right) {
          right.startMi = p.startMi;
          right.segments.unshift(...p.segments);
          out.splice(i, 1);
        } else {
          break;
        }
        changed = true;
        break;
      }
    }
  }
  return out;
}

/** Merge the adjacent pair of phases with the smallest pace delta.
 *  Returns a new array with one fewer phase. */
function mergeSmallestDelta(phases: RawPhase[]): RawPhase[] {
  if (phases.length < 2) return phases;
  let bestI = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < phases.length - 1; i++) {
    const delta = Math.abs(
      paceOfRawPhase(phases[i]) - paceOfRawPhase(phases[i + 1])
    );
    if (delta < bestDelta) {
      bestDelta = delta;
      bestI = i;
    }
  }
  const merged: RawPhase = {
    startMi: phases[bestI].startMi,
    endMi: phases[bestI + 1].endMi,
    segments: [...phases[bestI].segments, ...phases[bestI + 1].segments],
  };
  return [...phases.slice(0, bestI), merged, ...phases.slice(bestI + 2)];
}

function collapseToTarget(
  segments: Segment[],
  targetPhases: number,
  minPhaseMi: number
): RawPhase[] {
  // Start with a tight pace threshold to catch all natural break points.
  let phases = splitSegmentsIntoRawPhases(segments, 10);
  phases = mergeShortPhases(phases, minPhaseMi);

  // Greedily merge the adjacent pair with the smallest pace delta until
  // we reach the target count. Deterministic; always converges.
  let guard = 0;
  while (phases.length > targetPhases) {
    phases = mergeSmallestDelta(phases);
    if (++guard > 200) break;
  }

  return phases;
}

/** Geometric fallback labels — never invent a landmark name. */
function geometricLabel(gradePct: number): { label: string; note: string } {
  if (gradePct > 3.5) return { label: 'Long climb', note: 'Steep grade — hold effort, not pace.' };
  if (gradePct > 1.5) return { label: 'Gradual climb', note: 'Sustained incline — settle in.' };
  if (gradePct < -3.5) return { label: 'Long descent', note: "Protect quads — don't overstride." };
  if (gradePct < -1.5) return { label: 'Gradual descent', note: 'Relax and let the course run you.' };
  return { label: 'Rolling', note: 'Mixed terrain. Hold target pace through the rollers.' };
}

/** Assemble phases using the fact-file's canonical boundaries. Each
 *  segment is assigned to exactly one phase by its midpoint — prevents
 *  double-counting of boundary-crossing segments. Pace is derived from
 *  sum-of-times over sum-of-distances, never from an unweighted average. */
function groupPhasesByFacts(
  segments: Segment[],
  facts: CourseFacts
): Phase[] {
  // Build per-phase bucket
  const buckets: Segment[][] = facts.phases.map(() => []);
  for (const seg of segments) {
    const midMi = (seg.startMi + seg.endMi) / 2;
    let placed = false;
    for (let i = 0; i < facts.phases.length; i++) {
      const pf = facts.phases[i];
      if (midMi >= pf.start_mi && midMi < pf.end_mi) {
        buckets[i].push(seg);
        placed = true;
        break;
      }
    }
    if (!placed) {
      // Midpoint past the last phase end — stick in the final bucket
      buckets[buckets.length - 1].push(seg);
    }
  }

  let cumTime = 0;
  const out: Phase[] = [];
  for (let i = 0; i < facts.phases.length; i++) {
    const pf = facts.phases[i];
    const segs = buckets[i];

    let totalMi = 0, totalTimeS = 0, gainFt = 0, lossFt = 0, gradeW = 0, gradeSum = 0;
    for (const seg of segs) {
      const mi = seg.distanceM / M_PER_MI;
      totalMi += mi;
      totalTimeS += mi * seg.targetPaceSPerMi;
      gainFt += seg.gainFt;
      lossFt += seg.lossFt;
      gradeSum += seg.meanGradePct * seg.distanceM;
      gradeW += seg.distanceM;
    }

    const distanceMi = pf.end_mi - pf.start_mi;
    // Use time-from-segments as authoritative; derive pace from it + facts distance
    const targetPaceSPerMi = distanceMi > 0 ? totalTimeS / distanceMi : 0;
    const grade = gradeW > 0 ? gradeSum / gradeW : 0;
    const phaseTimeS = distanceMi * targetPaceSPerMi;
    cumTime += phaseTimeS;

    out.push({
      index: i,
      label: pf.label,
      startMi: pf.start_mi,
      endMi: pf.end_mi,
      distanceMi: Math.round(distanceMi * 100) / 100,
      targetPaceSPerMi: Math.round(targetPaceSPerMi),
      targetPaceDisplay: formatPaceMi(targetPaceSPerMi),
      meanGradePct: Math.round(grade * 10) / 10,
      elevationGainFt: Math.round(gainFt),
      elevationLossFt: Math.round(lossFt),
      cumulativeTimeS: Math.round(cumTime),
      cumulativeTimeDisplay: formatHMS(cumTime),
      note: pf.note,
    });
  }
  return out;
}

/** Geometric auto-grouping — used when no course-facts file is available. */
function groupPhasesGeometric(
  segments: Segment[],
  targetPhases: number,
  minPhaseMi: number
): Phase[] {
  const raw = collapseToTarget(segments, targetPhases, minPhaseMi);

  let cumTime = 0;
  const out: Phase[] = [];
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    const distanceMi = p.endMi - p.startMi;
    let pace = 0, weight = 0, gainFt = 0, lossFt = 0;
    for (const seg of p.segments) {
      const mi = seg.distanceM / M_PER_MI;
      pace += seg.targetPaceSPerMi * mi;
      weight += mi;
      gainFt += seg.gainFt;
      lossFt += seg.lossFt;
    }
    const targetPaceSPerMi = weight > 0 ? pace / weight : 0;
    const grade = gradeOfRawPhase(p);
    const phaseTimeS = distanceMi * targetPaceSPerMi;
    cumTime += phaseTimeS;

    const { label, note } = geometricLabel(grade);

    out.push({
      index: i,
      label,
      startMi: Math.round(p.startMi * 100) / 100,
      endMi: Math.round(p.endMi * 100) / 100,
      distanceMi: Math.round(distanceMi * 100) / 100,
      targetPaceSPerMi: Math.round(targetPaceSPerMi),
      targetPaceDisplay: formatPaceMi(targetPaceSPerMi),
      meanGradePct: Math.round(grade * 10) / 10,
      elevationGainFt: Math.round(gainFt),
      elevationLossFt: Math.round(lossFt),
      cumulativeTimeS: Math.round(cumTime),
      cumulativeTimeDisplay: formatHMS(cumTime),
      note,
    });
  }
  return out;
}

export function groupPhases(segments: Segment[], opts: GroupOptions = {}): Phase[] {
  const targetPhases = opts.targetPhases ?? 6;
  const minPhaseMi = opts.minPhaseMi ?? 0.75;
  if (opts.courseFacts) {
    // Facts-driven path: use canonical boundaries from the facts file.
    return groupPhasesByFacts(segments, opts.courseFacts);
  }
  return groupPhasesGeometric(segments, targetPhases, minPhaseMi);
}
