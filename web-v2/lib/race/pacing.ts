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
 * Model — even effort, grade-adjusted pace:
 *   · Uphill: pace multiplier 1 + 0.033 × grade%. Energy cost of running
 *     rises ~3.3% per 1% of grade (Cite: Research/11-course-specific-
 *     training.md §terminology — "Energy cost rises ~3.3% per 1% of
 *     grade up to ~10–15%").
 *   · Downhill: same coefficient, but the per-mile pace credit is capped
 *     at 15 s/mi. Descending faster than that trades quad damage for
 *     time you repay later (Cite: the AFC course doctrine itself,
 *     course_library.geometry_json phases[1] — "Target 10-15s faster
 *     than goal pace, no more"; Research/11 §downhill — braking forces
 *     rise steeply with descent speed).
 *   · Phases are then normalized so the time-weighted total equals the
 *     goal exactly — the output is *how the goal distributes over the
 *     course*, not a re-prediction of the goal.
 *
 * 2026-06-17 · ONE plan (David's call). The page used to carry two pace
 * tables — this terrain plan and a separate per-mile negative-split arc
 * from execution-plan.ts — that averaged the same goal but distributed it
 * differently ("what do I actually follow"). They are now merged here: on
 * top of the terrain pace we lay a gentle negative-split EFFORT arc
 * (start ~+2% slower = bank nothing early, finish ~-2% faster = empty the
 * tank), linear and symmetric about mid-race, then renormalize so the
 * plan still sums to the goal exactly. Net on AFC: the early climb runs
 * slow (terrain + settle), The Drop banks, and the late Balboa climb
 * holds ~goal pace (terrain-slow offset by the closing push). Each phase
 * also carries a position-based STRATEGY CUE so the intent reads, not
 * just the numbers.
 *
 * This is split *arithmetic* on an already-chosen goal, not a training
 * prescription — the doctrine inputs are the cited grade-cost numbers.
 */

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
  source: 'course' | 'linear';
  goal_sec: number;
  splits: PacingSplit[];
  phases: PacingPhase[] | null;   // null when source === 'linear'
}

/** Uphill cost per 1% mean grade (fraction of pace). Cite: Research/11. */
const GRADE_COST_PER_PCT = 0.033;
/** Max per-mile credit a descent may take, in seconds (AFC course doctrine). */
const MAX_DESCENT_CREDIT_S_PER_MI = 15;
/** Negative-split EFFORT-arc amplitude (fraction of pace) · start ≈ +2%
 *  slower, finish ≈ −2% faster, linear and symmetric about mid-race. The
 *  arc is renormalized to the goal afterward, so this shapes distribution,
 *  not the average. Cite: Research/08 §3.4 (controlled even/negative
 *  split — a half opens ~+10-15s/mi and closes faster). */
const NEG_SPLIT_ARC_K = 0.02;

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
  let phasePaces: Array<{ p: CoursePhaseInput; pace: number; pos: number }> | null = null;
  if (phases) {
    const raw = phases.map((p) => {
      const grade = phaseGradePct(p);
      let mult: number;
      if (grade >= 0) {
        mult = 1 + GRADE_COST_PER_PCT * grade;
      } else {
        const credit = Math.min(
          GRADE_COST_PER_PCT * Math.abs(grade) * flatPace,
          MAX_DESCENT_CREDIT_S_PER_MI,
        );
        mult = (flatPace - credit) / flatPace;
      }
      return { p, mult };
    });
    const rawTotal = raw.reduce(
      (s, { p, mult }) => s + ((p.end_mi! - p.start_mi!) * flatPace * mult),
      0,
    );
    const scale = goalSec / rawTotal;
    // Terrain-only pace per phase (even effort, sums to goal).
    const terrainPaced = raw.map(({ p, mult }) => ({ p, pace: flatPace * mult * scale }));

    // ── Negative-split effort arc, layered on the terrain pace ────────
    // m = 1 + K·(1 − 2p) at the phase midpoint p ∈ [0,1]: start ≈ +K
    // (slower), finish ≈ −K (faster), linear and symmetric about mid-race.
    // Then renormalize so Σ(mi·pace) is still exactly the goal — the arc is
    // ~symmetric so the rescale is ≈1, but we renormalize regardless so the
    // average stays the goal pace.
    const arced = terrainPaced.map(({ p, pace }) => {
      const mid = ((p.start_mi! + p.end_mi!) / 2) / distanceMi;
      const pos = Math.min(1, Math.max(0, mid));
      const m = 1 + NEG_SPLIT_ARC_K * (1 - 2 * pos);
      return { p, pace: pace * m, pos };
    });
    const arcedTotal = arced.reduce(
      (s, { p, pace }) => s + ((p.end_mi! - p.start_mi!) * pace),
      0,
    );
    const arcScale = goalSec / arcedTotal;
    phasePaces = arced.map(({ p, pace, pos }) => ({ p, pace: pace * arcScale, pos }));
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
    source: phasePaces ? 'course' : 'linear',
    goal_sec: goalSec,
    splits,
    phases: phasePaces
      ? phasePaces.map(({ p, pace, pos }) => ({
          label: p.label ?? `${p.start_mi}–${p.end_mi} mi`,
          start_mi: p.start_mi!,
          end_mi: p.end_mi!,
          pace_s_per_mi: Math.round(pace),
          display: fmtPace(pace),
          cue: phaseCue(pos),
        }))
      : null,
  };
}
