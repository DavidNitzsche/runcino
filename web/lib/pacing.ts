/**
 * Pacing engine.
 *
 * 1. Segment the course into ~800m chunks.
 * 2. Compute mean grade + Minetti GAF per segment.
 * 3. Scale paces so the sum of (distance × pace) equals the goal time.
 *    This is the "even effort" strategy — hold effort constant, let
 *    pace vary with the course.
 *
 * See docs/ALGORITHM.md for the math.
 */

import { FT_PER_M, M_PER_MI } from './time';
import { gaf } from './minetti';
import type { GpxTrack, PacingInput, Segment } from './types';

const DEFAULT_SEGMENT_M = 800;

export function segmentCourse(
  track: GpxTrack,
  segmentM = DEFAULT_SEGMENT_M
): Segment[] {
  const { points, totalDistanceM } = track;
  if (points.length < 2) return [];

  const segments: Segment[] = [];
  let segStart = 0; // index into points[]

  for (let boundary = segmentM; boundary <= totalDistanceM + 1; boundary += segmentM) {
    // Skip boundaries already behind the current start (happens when a GPS
    // point spans multiple 800m boundaries — sparse GPX files from route
    // planners like plotaroute can have inter-point gaps of 500-3000m).
    if (boundary <= points[segStart].distM) continue;

    // Find the first point at or past `boundary`
    let end = segStart;
    while (end < points.length - 1 && points[end].distM < boundary) end++;

    const a = points[segStart];
    const b = points[end];
    if (b.distM <= a.distM) break;

    const rise = b.eleM - a.eleM;
    const run = b.distM - a.distM;
    const gradePct = (rise / run) * 100;

    let gainFt = 0, lossFt = 0;
    for (let i = segStart + 1; i <= end; i++) {
      const d = (points[i].eleM - points[i - 1].eleM) * FT_PER_M;
      if (d > 0) gainFt += d;
      else lossFt -= d;
    }

    segments.push({
      startMi: a.distM / M_PER_MI,
      endMi: b.distM / M_PER_MI,
      distanceM: run,
      meanGradePct: gradePct,
      gainFt,
      lossFt,
      gaf: gaf(gradePct),
      targetPaceSPerMi: 0, // filled in by applyStrategy()
    });

    segStart = end;
    if (end >= points.length - 1) break;
  }

  return segments;
}

/**
 * Mutates segments to fill `targetPaceSPerMi` according to the chosen
 * strategy and goal finish time.
 */
export function applyStrategy(
  segments: Segment[],
  input: PacingInput
): void {
  const totalM = segments.reduce((s, seg) => s + seg.distanceM, 0);
  const totalMi = totalM / M_PER_MI;
  const flatPace = input.goalFinishS / totalMi;   // seconds per mile

  if (input.strategy === 'even_split') {
    for (const seg of segments) seg.targetPaceSPerMi = flatPace;
    return;
  }

  if (input.strategy === 'even_effort') {
    // Effort-scale: paces are flatPace × GAF × scaling so sum equals goal.
    // Σ (distance_mi × pace) = goalFinishS
    // pace_i = flatPace × GAF_i × k
    // Σ (distance_mi_i × flatPace × GAF_i × k) = goalFinishS
    // k = goalFinishS / (flatPace × Σ (distance_mi_i × GAF_i))
    const sumWeighted = segments.reduce(
      (s, seg) => s + (seg.distanceM / M_PER_MI) * seg.gaf, 0
    );
    const k = input.goalFinishS / (flatPace * sumWeighted);
    for (const seg of segments) {
      seg.targetPaceSPerMi = flatPace * seg.gaf * k;
    }
    return;
  }

  if (input.strategy === 'negative_split') {
    // First half: flat-pace + 5 s/mi (slower).
    // Second half: solve for target such that overall time = goal.
    // Both halves individually get the even-effort GAF treatment.
    const halfMi = totalMi / 2;
    let cum = 0;
    const firstHalf: Segment[] = [];
    const secondHalf: Segment[] = [];
    for (const seg of segments) {
      const segMi = seg.distanceM / M_PER_MI;
      if (cum + segMi / 2 < halfMi) firstHalf.push(seg);
      else secondHalf.push(seg);
      cum += segMi;
    }
    const firstFlat = flatPace + 5;
    const firstSum = firstHalf.reduce(
      (s, seg) => s + (seg.distanceM / M_PER_MI) * seg.gaf, 0
    );
    const firstMi = firstHalf.reduce((s, seg) => s + seg.distanceM / M_PER_MI, 0);
    const kFirst = (firstFlat * firstMi) / (firstFlat * firstSum);
    for (const seg of firstHalf) {
      seg.targetPaceSPerMi = firstFlat * seg.gaf * kFirst;
    }
    const firstTime = firstHalf.reduce(
      (s, seg) => s + (seg.distanceM / M_PER_MI) * seg.targetPaceSPerMi, 0
    );
    const remainingTime = input.goalFinishS - firstTime;
    const secondMi = secondHalf.reduce((s, seg) => s + seg.distanceM / M_PER_MI, 0);
    const secondFlat = remainingTime / secondMi;
    const secondSum = secondHalf.reduce(
      (s, seg) => s + (seg.distanceM / M_PER_MI) * seg.gaf, 0
    );
    const kSecond = remainingTime / (secondFlat * secondSum);
    for (const seg of secondHalf) {
      seg.targetPaceSPerMi = secondFlat * seg.gaf * kSecond;
    }
    return;
  }

  throw new Error(`Unknown strategy: ${(input as PacingInput).strategy}`);
}

/** Convenience wrapper: parse + segment + apply strategy in one call. */
export function buildSegments(track: GpxTrack, input: PacingInput): Segment[] {
  const segments = segmentCourse(track, input.segmentDistanceM ?? DEFAULT_SEGMENT_M);
  applyStrategy(segments, input);
  return segments;
}
