/**
 * lib/race/pacing.ts · course-aware goal splits.
 *
 * 2026-06-09 · race-killer F3 (splits half). The race-day splits cards
 * (iPhone RaceDayView, web race surfaces) interpolated the goal time
 * linearly — flat-course splits for every course. AFC is the motivating
 * case: a climb to mile 2, a −2% descent to 4.5, flat through 10.9, then
 * the Balboa climb to the line. Even-EFFORT racing on that profile means
 * the honest 1:30 plan is slower than 6:52 on the climbs and faster on
 * the descent — a runner holding the linear split through The Drop banks
 * nothing and then bleeds time up 6th Ave wondering what went wrong.
 *
 * Model — even effort, grade-adjusted pace. 2026-08-17: the grade maths
 * moved to lib/training/elevation-model.ts, which is now the single
 * elevation model in the app — this file and the Targets course chunk used
 * to price the same terrain 3-6× apart. The numbers are unchanged here; the
 * Targets side is the one that moved.
 *   · Uphill: pace multiplier 1 + 0.033 × grade%. Energy cost of running
 *     rises ~3.3% per 1% of grade (Cite: Research/11-course-specific-
 *     training.md §"Mechanical Effects of Uphill Running" — "Energy cost
 *     rises ~3.3% per 1% of grade up to ~10–15%").
 *   · Downhill: same coefficient, but the per-mile pace credit is capped
 *     at 15 s/mi. Descending faster than that trades quad damage for time
 *     you repay later. Re-sourced 2026-08-17 from the AFC course row to
 *     Research/11 §"Pacing Rule for Hilly Courses", which states the same
 *     number as doctrine: "On descents: shave 5–15 s/mi".
 *   · Phases are then normalized so the time-weighted total equals the
 *     goal exactly — the output is *how the goal distributes over the
 *     course*, not a re-prediction of the goal.
 *
 * 2026-06-17 · ONE plan (David's call). The page used to carry two pace
 * tables — this terrain plan and a separate per-mile negative-split arc
 * from execution-plan.ts — that averaged the same goal but distributed it
 * differently ("what do I actually follow"). They are now merged here: on
 * top of the terrain pace we lay the race's OPENING ALLOWANCE (settle
 * early, repay it over the remainder), then renormalize so the plan still
 * sums to the goal exactly.
 *
 * 2026-08-17 · that arc used to be a flat ±2%, cited to the half's first
 * mile and applied to every distance. It now reads the distance's own row
 * of Research/08 §3.1 through lib/race/distance-doctrine.ts — the same
 * model the split card, the web pacing blocks and the watch's settle phase
 * use. Net on AFC: the early climb runs
 * slow (terrain + settle), The Drop banks, and the late Balboa climb
 * holds ~goal pace (terrain-slow offset by the closing push). Each phase
 * also carries a position-based STRATEGY CUE so the intent reads, not
 * just the numbers.
 *
 * 2026-08-17 · F2. A course with no authored phase profile now gets the
 * doctrine opening segments (settle / early block / repaid remainder) as
 * its phases, and its splits integrate over them, instead of returning
 * `phases: null` + a linear ladder. Half of `course_library` — LA
 * Marathon, Rose Bowl Half, Disney Half, Run Malibu, Santa Monica 10K —
 * carries zero phases, and every consumer of that null invented its own
 * opening arc to fill the hole. The watch already ran the doctrine
 * segments there (lib/watch/build-workout.ts), so this is the phone and
 * the web catching up to the wrist rather than a new model.
 *
 * This is split *arithmetic* on an already-chosen goal, not a training
 * prescription — the doctrine inputs are the cited grade-cost numbers.
 */

import { raceOpeningPlan, openingAdjustmentOverSpan, raceOpeningSegments } from './distance-doctrine';
import { gradePaceMultiplier } from '@/lib/training/elevation-model';

export interface CoursePhaseInput {
  label?: string;
  start_mi?: number;
  end_mi?: number;
  expected_mean_grade_pct?: number;
  expected_gain_ft?: number;
  expected_loss_ft?: number;
}

export interface CourseGeometryInput {
  facts?: { distance_mi?: number };
  phases?: CoursePhaseInput[];
}

export interface PacingSplit {
  label: string;        // "5K" / "10K" / "HALF" / "30K" / "40K" / "FINISH"
  mi: number;           // checkpoint position
  cum_sec: number;      // cumulative elapsed at the checkpoint
  display: string;      // "21:31" / "1:30:00"
}

export interface PacingPhase {
  label: string;
  start_mi: number;
  end_mi: number;
  pace_s_per_mi: number;
  display: string;      // "6:58/mi"
  /** Position-based race-arc intent for this phase · "Settle in" /
   *  "Find the rhythm" / "Lock goal pace" / "Empty the tank". Optional on
   *  the wire — older consumers ignore it; the iPhone renders it as the
   *  segment sub-label so the merged plan carries the negative-split
   *  intent alongside the terrain pace. */
  cue?: string;
}

export interface RacePacing {
  /** Whether the COURSE informed the plan. 'linear' = no usable profile. */
  source: 'course' | 'linear';
  /**
   * Where `phases` came from. 'course' = named terrain segments; 'opening'
   * = the doctrine opening model (settle / early block / repaid remainder,
   * lib/race/distance-doctrine.ts), which is what a course with no phase
   * profile gets. 'none' only when the race is too short to carry an
   * opening at all.
   */
  phase_source: 'course' | 'opening' | 'none';
  goal_sec: number;
  splits: PacingSplit[];
  phases: PacingPhase[] | null;
}

/**
 * Sub-label for the doctrine opening segments. The terrain phases get a
 * position-based cue (phaseCue); these are already named for their intent,
 * so the cue says what the runner does rather than repeating the label.
 * Cite: Research/08 §3.1 (settle) + §4.3 (the repayment is what makes the
 * cumulative land on the target).
 */
const OPENING_CUES: Readonly<Record<string, string>> = {
  'Settle': 'Bank nothing',
  'Find rhythm': 'Ease onto target',
  'Goal pace': 'Repay the opening, then hold',
};

/** Position-based strategy cue for a phase, keyed on its mid-race fraction
 *  p ∈ [0,1]. Mirrors the negative-split arc's intent so the merged plan
 *  reads as a story, not a number column. Cite: Research/08 §3.4. */
function phaseCue(p: number): string {
  if (p < 0.15) return 'Settle in';
  if (p < 0.40) return 'Find the rhythm';
  if (p < 0.80) return 'Lock goal pace';
  return 'Empty the tank';
}

const CHECKPOINTS: ReadonlyArray<{ label: string; mi: number }> = [
  { label: '5K', mi: 3.1069 },
  { label: '10K', mi: 6.2137 },
  { label: 'HALF', mi: 13.1094 },
  { label: '30K', mi: 18.641 },
  { label: '40K', mi: 24.855 },
];

function fmtClock(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${m}:${String(r).padStart(2, '0')}`;
}

function fmtPace(sPerMi: number): string {
  const s = Math.round(sPerMi);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}/mi`;
}

/** Mean grade % for a phase: explicit field first, else derived from
 *  net gain/loss over the phase length. Returns 0 when underspecified. */
function phaseGradePct(p: CoursePhaseInput): number {
  if (typeof p.expected_mean_grade_pct === 'number' && isFinite(p.expected_mean_grade_pct)) {
    return p.expected_mean_grade_pct;
  }
  const lenMi = (p.end_mi ?? 0) - (p.start_mi ?? 0);
  if (lenMi <= 0) return 0;
  const netFt = (p.expected_gain_ft ?? 0) - (p.expected_loss_ft ?? 0);
  return (netFt / (lenMi * 5280)) * 100;
}

/** Contiguous, ordered, in-bounds phase list or null (→ linear fallback). */
function usablePhases(geometry: CourseGeometryInput | null | undefined, distanceMi: number): CoursePhaseInput[] | null {
  const phases = geometry?.phases;
  if (!Array.isArray(phases) || phases.length === 0) return null;
  const sorted = [...phases].sort((a, b) => (a.start_mi ?? 0) - (b.start_mi ?? 0));
  let cursor = 0;
  for (const p of sorted) {
    const s = p.start_mi ?? NaN;
    const e = p.end_mi ?? NaN;
    if (!isFinite(s) || !isFinite(e) || e <= s) return null;
    if (Math.abs(s - cursor) > 0.35) return null;   // gap/overlap → don't trust
    cursor = e;
  }
  if (Math.abs(cursor - distanceMi) > 0.6) return null; // doesn't cover course
  return sorted;
}

/**
 * Distribute a goal time over a course. Always returns a result —
 * `source` says whether the course profile informed it.
 */
export function buildRacePacing(input: {
  goalSec: number;
  distanceMi: number;
  geometry?: CourseGeometryInput | null;
}): RacePacing {
  const { goalSec, distanceMi } = input;
  const flatPace = goalSec / distanceMi;

  const phases = usablePhases(input.geometry, distanceMi);

  // Per-phase raw multipliers, then normalize total time back to goalSec.
  // `pos` is the phase's mid-race fraction, used for the strategy cue.
  let phasePaces: Array<{ p: CoursePhaseInput; pace: number; pos: number; cue?: string }> | null = null;
  if (phases) {
    const raw = phases.map((p) => ({
      p,
      mult: gradePaceMultiplier(phaseGradePct(p), flatPace),
    }));
    const rawTotal = raw.reduce(
      (s, { p, mult }) => s + ((p.end_mi! - p.start_mi!) * flatPace * mult),
      0,
    );
    const scale = goalSec / rawTotal;
    // Terrain-only pace per phase (even effort, sums to goal).
    const terrainPaced = raw.map(({ p, mult }) => ({ p, pace: flatPace * mult * scale }));

    // ── Opening allowance, layered on the terrain pace ────────────────
    // 2026-08-17 doctrine-conformance audit · this used to be its own
    // symmetric ±2% arc, cited to the HALF's first mile and applied to
    // every distance — one of five different opening models the app ran
    // for a single race. It now samples THE model
    // (lib/race/distance-doctrine.ts): the distance's own §3.1 allowance
    // over the opening miles, minus the repayment after it, averaged
    // across each phase's span. A 5K phase opens ~+2 s/mi, a marathon's
    // ~+15. Renormalized afterward so Σ(mi·pace) is still exactly the goal.
    const opening = raceOpeningPlan({ goalSec, distanceMi });
    const arced = terrainPaced.map(({ p, pace }) => {
      const start = Math.max(0, p.start_mi!);
      const end = Math.min(distanceMi, p.end_mi!);
      const adj = openingAdjustmentOverSpan(opening, start, end);
      const mid = ((p.start_mi! + p.end_mi!) / 2) / distanceMi;
      const pos = Math.min(1, Math.max(0, mid));
      return { p, pace: pace * (1 + adj / flatPace), pos };
    });
    const arcedTotal = arced.reduce(
      (s, { p, pace }) => s + ((p.end_mi! - p.start_mi!) * pace),
      0,
    );
    const arcScale = goalSec / arcedTotal;
    phasePaces = arced.map(({ p, pace, pos }) => ({ p, pace: pace * arcScale, pos }));
  }
  /** True when the terrain profile shaped the paces above. */
  const terrainPhased = phasePaces != null;

  // ── No usable course profile → still not a flat line ──────────────────
  // 2026-08-17 · F2. A course with no authored phases used to return
  // `phases: null` and linearly-interpolated splits, and every consumer
  // then invented its own opening: the iPhone race page ran a 0.22/0.77
  // block split at goal+5 / goal / goal−7 (the fifth opening model the
  // distance-doctrine audit missed), while the watch — for the SAME
  // phase-less course — already ran the doctrine segments. On LA Marathon
  // the phone said miles 1-6 at goal+5 and the wrist said mile 1 at
  // goal+15. Phase-less is a statement about the COURSE, not about the
  // race plan: the distance still has an opening arc, so serve it.
  // Consumers render what they are given instead of each guessing.
  if (!phasePaces) {
    const segs = raceOpeningSegments({ goalSec, distanceMi });
    // A race shorter than its own opening block has nothing to repay over
    // (raceOpeningPlan floors repayMi at 0.1 mi, which would not sum to
    // the target). Leave those linear — the old behaviour, unchanged.
    const covers = segs.length > 1
      && Math.abs(segs[segs.length - 1].endMi - distanceMi) < 0.01;
    if (covers) {
      phasePaces = segs.map((s) => ({
        p: { label: s.label, start_mi: s.startMi, end_mi: s.endMi },
        // Unrounded — the rounded column would drift the FINISH checkpoint
        // off the target by a few seconds over a marathon.
        pace: s.pacePreciseSPerMi,
        pos: Math.min(1, Math.max(0, ((s.startMi + s.endMi) / 2) / distanceMi)),
        cue: OPENING_CUES[s.label],
      }));
    }
  }

  /** Elapsed seconds at mile m, integrating across phases (or linear). */
  const elapsedAt = (m: number): number => {
    if (!phasePaces) return m * flatPace;
    let acc = 0;
    for (const { p, pace } of phasePaces) {
      const s = p.start_mi!;
      const e = Math.min(p.end_mi!, distanceMi);
      if (m <= s) break;
      acc += (Math.min(m, e) - s) * pace;
      if (m <= e) break;
    }
    return acc;
  };

  const splits: PacingSplit[] = CHECKPOINTS
    .filter((c) => c.mi < distanceMi - 0.1)
    .map((c) => ({
      label: c.label,
      mi: c.mi,
      cum_sec: Math.round(elapsedAt(c.mi)),
      display: fmtClock(elapsedAt(c.mi)),
    }));
  splits.push({
    label: 'FINISH',
    mi: distanceMi,
    cum_sec: goalSec,
    display: fmtClock(goalSec),
  });

  return {
    source: terrainPhased ? 'course' : 'linear',
    phase_source: terrainPhased ? 'course' : (phasePaces ? 'opening' : 'none'),
    goal_sec: goalSec,
    splits,
    phases: phasePaces
      ? phasePaces.map(({ p, pace, pos, cue }) => ({
          label: p.label ?? `${p.start_mi}–${p.end_mi} mi`,
          start_mi: p.start_mi!,
          end_mi: p.end_mi!,
          pace_s_per_mi: Math.round(pace),
          display: fmtPace(pace),
          cue: cue ?? phaseCue(pos),
        }))
      : null,
  };
}
