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
  let phasePaces: Array<{ p: CoursePhaseInput; pace: number }> | null = null;
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
    phasePaces = raw.map(({ p, mult }) => ({ p, pace: flatPace * mult * scale }));
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
      ? phasePaces.map(({ p, pace }) => ({
          label: p.label ?? `${p.start_mi}–${p.end_mi} mi`,
          start_mi: p.start_mi!,
          end_mi: p.end_mi!,
          pace_s_per_mi: Math.round(pace),
          display: fmtPace(pace),
        }))
      : null,
  };
}
