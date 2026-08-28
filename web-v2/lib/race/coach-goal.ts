/**
 * lib/race/coach-goal.ts · coach-set A/B/C goals for a race the runner left
 * without one (2026-08-28, David's ruling).
 *
 * ── The rule this module exists to enforce ──────────────────────────────────
 *
 * A race with an EMPTY goal gets a coach-set goal, derived from current
 * evidence and framed to push the runner. A race with a runner-STATED goal is
 * untouchable — the coach projects against it, it never renegotiates it
 * (standing rule, `feedback_no_forced_goal_decisions`). This module therefore
 * refuses to produce anything when a stated goal exists, structurally: the
 * very first check in `deriveCoachGoal` returns null.
 *
 * A coach goal is COACH-SET, not runner-confirmed: every number it emits is
 * modelled, labelled as coach-set, and editable — the existing race-edit path
 * writes `meta.goalDisplay`, and the moment that field is non-empty this
 * module goes silent for that race. Nothing here ever writes `goalDisplay`
 * (that is the runner's field), and nothing here feeds training paces or plan
 * composition: goals never distort training (paces come from evidence —
 * `feedback_easy_pace_anchored_current_vdot`).
 *
 * ── The tiers (Research/20-mental-training.md §Daniels' A/B/C) ─────────────
 *
 *   A · stretch — "ideal conditions, perfect day", ~20-30% probability.
 *   B · realistic — "solid execution, minor adversity", ~50-60%.
 *   C · floor — "finish respectably despite significant adversity", ~80-90%.
 *
 * The engine's mapping, derived rather than invented:
 *
 *   B = the equivalent-fitness prediction at the race distance — the honest
 *       centre of the runner's demonstrated fitness, which is by construction
 *       the ~50% outcome (Research/02 §13.7 publishes the CI half-widths
 *       AROUND exactly this number).
 *   A = B minus one CI half-width — the fast edge of the 80% band, i.e. the
 *       roughly-one-in-four-or-five day. That lands inside doctrine's ~20-30%
 *       A-tier without inventing a magic number.
 *   C = B plus one CI half-width — the slow edge of the same band, the
 *       defensible bad-day floor (~80-90%).
 *
 * The CI half-width is the SAME span table every projection band uses
 * (`Research/02` §13.7 via `crossSpanCi`/`researchSpanBasePct` in
 * lib/training/goal-projection.ts) — a coach goal wider or tighter than the
 * band the app draws would be two answers to one question.
 *
 * Marathon specificity (Research/02 §13.1 :382 + REVIEW_NOTES A5): a marathon
 * predicted from sub-marathon evidence without a marathon-specific block runs
 * one-sided slow. There the raw equivalence IS the perfect-day A, B carries
 * the +5% one-sided adjustment, and C sits at the slow edge of the one-sided
 * band. See `marathonSpecificityAdjustment` in goal-projection.ts.
 *
 * Special framings, both time-less by doctrine:
 *   · C-priority races get NO time goal — a C race is run "like a hard
 *     workout" (Research/00b effort table), and doctrine's C-tier framing is
 *     emotional, not chronometric. Effort line instead.
 *   · Hilly courses are raced on effort, not pace (Research/11 §Pacing Rule
 *     for Hilly Courses: "Effort-based pacing (HR or RPE), NOT pace-based").
 *     A flat-equivalent time on a hilly course is a number the runner cannot
 *     pace off, so none is offered.
 *
 * ── Personal Riegel exponent (Research/02 §11.4) ───────────────────────────
 *
 * With two qualifying recent races the runner's own fatigue exponent
 * b = ln(T2/T1) / ln(D2/D1) replaces the population default for the
 * cross-distance projection (§14 rule 3: "Two recent races available: fit the
 * runner's own exponent and use that for the third distance"). Qualifying is
 * strict, per §11.4's own caveat ("Best when both races are recent, on flat
 * courses, in similar weather") and §11.2 rule 4 ("Discard any race run in
 * heat > 18°C, on a hilly course, or in a depleted state without
 * correction"):
 *   · both within the freshness window (Research/01 §Freshness window:
 *     "within the last 8 weeks (≤56 days)")
 *   · both graded representative by the race-authority machinery — A/B
 *     priority (selectionAuthority ≥ REPRESENTATIVE_FLOOR) and no downgrading
 *     runner report — and not flagged hilly
 *   · both inside Riegel's own validity window (1500m–marathon, §2.4)
 *   · distances far enough apart that the fit is signal, not noise
 *     amplification (denominator ln(D2/D1) → 0 as the distances converge)
 * A fitted exponent outside the range doctrine has ever observed for
 * sub-ultra running (§6.1 table: George women's-road 1.0397 … §7.2 Speedster
 * ~1.10-1.13) means the two races are not comparable — the fit is discarded
 * rather than clamped, and the Daniels equivalence stands.
 *
 * Pure module — no DB. Callers load evidence (bestRecentVdot inputs, course
 * geometry, the plan's marathon-block signal) and hand it in.
 */

import {
  predictRaceTime,
  formatRaceTime,
  DANIELS_MAX_VALID_DISTANCE_MI,
} from '@/lib/training/vdot';
import {
  crossSpanCi,
  researchSpanBasePct,
  marathonSpecificityAdjustment,
} from '@/lib/training/goal-projection';
import { roundTargetSec } from './effective-race-target';
import { selectionAuthority, REPRESENTATIVE_FLOOR } from './effort-authority';
import type { AuthorityTier } from './effort-authority';

// ── Personal Riegel exponent (Research/02 §11.4) ────────────────────────────

/** Riegel validity window (Research/02 §2.4 "1500m to marathon") — same
 *  bounds `predictRaceTimeFromAnchor` enforces in lib/training/vdot.ts. */
const RIEGEL_MIN_DISTANCE_MI = 0.93;
const RIEGEL_MAX_DISTANCE_MI = 26.22;

/** Both races must sit inside the freshness window. Research/01 §"Freshness
 *  window": "within the last 8 weeks (≤56 days), the strongest race result is
 *  the canonical VDOT input" — and Research/02 §11.2 fits exponents from races
 *  "within the last 8 weeks". Same number as VDOT_FULL_VALUE_DAYS. */
export const EXPONENT_FIT_WINDOW_DAYS = 56;

/**
 * The band of fatigue exponents doctrine has observed for sub-ultra running.
 * Research/02 §6.1's exponent table runs from George 2017's women's-road
 * 1.0397 up through Riegel's running-only 1.0773, and §7.2's runner-type
 * table tops out at the Speedster's ~1.10-1.13 (ultra exponents 1.13-1.15
 * are §6.2's, out of scope below the marathon). A two-point fit outside
 * [1.03, 1.13] is not a runner type doctrine describes — it is two races
 * that are not comparable (one of them soft, short-course, or mis-measured),
 * so the fit is REJECTED, never clamped into range.
 */
export const PERSONAL_EXPONENT_MIN = 1.03;
export const PERSONAL_EXPONENT_MAX = 1.13;

/**
 * Minimum distance ratio between the two fitted races. b's denominator is
 * ln(D2/D1): as the distances converge it goes to zero and per-race timing
 * noise (±1-3%, §11.1) blows up into an arbitrary exponent. 1.5 admits every
 * adjacent standard span (5K→10K = 2.0, 10K→HM = 2.11, HM→M = 2.0) and
 * rejects same-category near-duplicates, where §11.2 says to average VDOTs
 * instead of fitting a shape.
 */
export const EXPONENT_FIT_MIN_DISTANCE_RATIO = 1.5;

export interface ExponentFitRace {
  /** Race identity for the basis line ("your 10K on Aug 3"). */
  slug?: string | null;
  name?: string | null;
  date: string;               // ISO
  distance_mi: number | null;
  finish_seconds: number | null;
  /** races.meta priority · graded by selectionAuthority. */
  priority?: string | null;
  /** Unconfirmed finish (watch/GPS match) — excluded: an exponent fit off a
   *  time nobody confirmed bakes the GPS error into every projection. */
  provisional?: boolean;
  /** The runner's own report (POST /api/v5/race-authority) · a downgrade
   *  disqualifies the race from the fit, same direction as bestRecentVdot. */
  runner_authority_tier?: AuthorityTier | null;
  /** Course judged hilly (caller derives from course geometry / meta). §11.2
   *  rule 4 discards hilly races as prediction inputs. */
  hilly?: boolean | null;
}

export interface PersonalExponentFit {
  /** The fitted exponent b = ln(T2/T1) / ln(D2/D1). */
  b: number;
  /** The two races the fit came from, shorter distance first. */
  races: [ExponentFitRace, ExponentFitRace];
}

function qualifiesForFit(r: ExponentFitRace, todayISO: string): boolean {
  if (!r.date || !r.distance_mi || !r.finish_seconds) return false;
  if (r.finish_seconds < 60) return false;
  if (r.distance_mi < RIEGEL_MIN_DISTANCE_MI || r.distance_mi > RIEGEL_MAX_DISTANCE_MI) return false;
  if (r.provisional === true) return false;
  if (r.hilly === true) return false;
  const age = (Date.parse(todayISO + 'T12:00:00Z') - Date.parse(r.date + 'T12:00:00Z')) / 86400000;
  if (!Number.isFinite(age) || age < 0 || age > EXPONENT_FIT_WINDOW_DAYS) return false;
  // Representative races only: A/B priority by doctrine's effort grading, and
  // no downgrading runner report. A jogged C race or a "ran it sick" report is
  // exactly the depleted-state input §11.2 rule 4 discards.
  if (selectionAuthority(r.priority ?? null) < REPRESENTATIVE_FLOOR) return false;
  const tier = r.runner_authority_tier ?? null;
  if (tier != null && tier !== 'representative') return false;
  return true;
}

/**
 * Fit the runner-specific Riegel exponent from their two most recent
 * qualifying races (Research/02 §11.4). Null whenever doctrine's conditions
 * for the fit are not met — the caller falls back to the Daniels equivalence,
 * which is always a valid answer.
 */
export function fitPersonalExponent(
  races: ExponentFitRace[],
  todayISO: string,
): PersonalExponentFit | null {
  const pool = races
    .filter((r) => qualifiesForFit(r, todayISO))
    .sort((a, b) => b.date.localeCompare(a.date)); // most recent first
  if (pool.length < 2) return null;

  // Most recent race, paired with the most recent OTHER race far enough away
  // in distance for the fit to be signal.
  const first = pool[0];
  const second = pool.find((r) => {
    const ratio = Math.max(r.distance_mi!, first.distance_mi!) /
                  Math.min(r.distance_mi!, first.distance_mi!);
    return ratio >= EXPONENT_FIT_MIN_DISTANCE_RATIO;
  });
  if (!second) return null;

  const [shorter, longer] = first.distance_mi! <= second.distance_mi!
    ? [first, second] : [second, first];
  const b =
    Math.log(longer.finish_seconds! / shorter.finish_seconds!) /
    Math.log(longer.distance_mi! / shorter.distance_mi!);
  if (!Number.isFinite(b)) return null;
  // Outside the doctrine-observed band → the races are not comparable.
  // Rejected, not clamped (see PERSONAL_EXPONENT_MIN's doc).
  if (b < PERSONAL_EXPONENT_MIN || b > PERSONAL_EXPONENT_MAX) return null;
  return { b: Math.round(b * 10000) / 10000, races: [shorter, longer] };
}

/**
 * Project a race time at `targetDistanceMi` with the runner's own exponent:
 * T = T1 × (Dtarget/D1)^b, anchored on whichever of the two fitted races sits
 * closest to the target in log-distance (the smaller extrapolation). Null
 * outside Riegel's validity window — same refusal as predictRaceTimeFromAnchor.
 */
export function predictWithPersonalExponent(
  fit: PersonalExponentFit,
  targetDistanceMi: number,
): number | null {
  if (!targetDistanceMi || targetDistanceMi <= 0) return null;
  if (targetDistanceMi < RIEGEL_MIN_DISTANCE_MI || targetDistanceMi > RIEGEL_MAX_DISTANCE_MI) return null;
  const anchor = [...fit.races].sort(
    (a, b2) =>
      Math.abs(Math.log(targetDistanceMi / a.distance_mi!)) -
      Math.abs(Math.log(targetDistanceMi / b2.distance_mi!)),
  )[0];
  const t = anchor.finish_seconds! * Math.pow(targetDistanceMi / anchor.distance_mi!, fit.b);
  return Number.isFinite(t) && t > 0 ? Math.round(t) : null;
}

// ── Hilly classification (display gate only) ────────────────────────────────

/**
 * Gross climb per mile above which a course is raced on effort, not pace.
 *
 * Research/02 §13.2's course-profile table calls 500-1500 ft of gain over a
 * road race "Hilly (2-5% slowdown)". The table is written at marathon scale;
 * expressed per mile its Hilly floor is 500 ft / 26.2 mi ≈ 19 ft/mi, which is
 * the per-distance-fair reading (a 10K with 120 ft of climb is the same
 * terrain as a marathon with 500). Research/11 §Pacing Rule for Hilly Courses
 * then withholds pace-based targets on such a course outright.
 */
export const HILLY_GAIN_FT_PER_MI = 19;

/** Is this course hilly, from whatever the caller could resolve? An explicit
 *  meta flag wins; else the measured gain per mile against the doctrine floor.
 *  Unknown terrain is NOT hilly — absence of geometry is not evidence. */
export function courseIsHilly(input: {
  metaTerrain?: unknown;
  elevationGainFt?: number | null;
  distanceMi?: number | null;
}): boolean {
  const t = typeof input.metaTerrain === 'string' ? input.metaTerrain.toLowerCase() : '';
  if (t.includes('hill')) return true;
  if (
    input.elevationGainFt != null && input.distanceMi != null && input.distanceMi > 0 &&
    Number.isFinite(input.elevationGainFt)
  ) {
    return input.elevationGainFt / input.distanceMi >= HILLY_GAIN_FT_PER_MI;
  }
  return false;
}

// ── Distance inference (display defaults only) ──────────────────────────────

/**
 * Infer a race distance from its NAME or SLUG when `meta.distanceMi` and
 * `meta.distanceLabel` are both missing (e.g. a row created before the
 * distance fields settled: "santa-monica-10k-2026-09-13" is a 10K by its own
 * slug). DISPLAY DEFAULTS ONLY — this feeds the coach-goal framing and its
 * labels, never a stored field and never pacing math on a surface that owns
 * a real distance. The caller reports the row's gap instead of writing it.
 */
export function inferDistanceMiFromNameOrSlug(
  name: string | null | undefined,
  slug: string | null | undefined,
): number | null {
  const hay = `${name ?? ''} ${slug ?? ''}`.toLowerCase();
  // Order matters: check the longer, more specific tokens first so "half
  // marathon" never reads as "marathon" and "50k" never reads as "5k".
  if (/\b50\s*k\b|50k/.test(hay)) return null;             // ultra — no Daniels framing anyway
  if (/\b100\s*k\b|100k/.test(hay)) return null;
  if (/half\s*-?\s*marathon|\bhalf\b|13\.1/.test(hay)) return 13.1094;
  if (/marathon|26\.2/.test(hay)) return 26.2188;
  if (/\b10\s*k\b|10k|6\.2/.test(hay)) return 6.21371;
  if (/\b5\s*k\b|5k|3\.1/.test(hay)) return 3.10686;
  if (/\b10\s*mi(le|ler)?\b/.test(hay)) return 10;
  if (/\b15\s*k\b|15k/.test(hay)) return 9.32057;
  return null;
}

// ── The coach goal ──────────────────────────────────────────────────────────

export interface CoachGoalTargets {
  kind: 'time';
  /** Always true — a coach goal is proposed by the engine, never confirmed
   *  fitness, and every surface labels it coach-set and editable. */
  coachSet: true;
  /** Every number here is modelled (the ~ convention on surfaces). */
  modelled: true;
  aSec: number;
  bSec: number;
  cSec: number;
  aDisplay: string;
  bDisplay: string;
  cDisplay: string;
  /** CI half-width (%) that sized the A/C band · Research/02 §13.7. */
  ciPct: number;
  /** True when the marathon-specificity one-sided rule shaped the tiers
   *  (A = raw equivalence, B = +5%, C = slow edge of the one-sided band). */
  oneSided: boolean;
  /** +5 when Research/02 §13.1's specificity adjustment moved B · else null. */
  specificityAdjustedPct: number | null;
  /** How B was predicted. */
  method: 'daniels-vdot' | 'personal-exponent';
  /** The fitted exponent when method === 'personal-exponent'. */
  personalExponent: number | null;
  /** The VDOT evidence B came from (null for a pure exponent projection). */
  vdotBasis: number | null;
  /** Coach-voice basis line, e.g. "Set from your current fitness. Yours to
   *  edit." */
  line: string;
  setAt: string; // ISO date
}

export interface CoachGoalEffort {
  kind: 'effort';
  coachSet: true;
  reason: 'c_priority' | 'hilly';
  /** Coach-voice framing line. No time goal by design, not by data gap. */
  line: string;
  setAt: string;
}

export type CoachGoalFraming = CoachGoalTargets | CoachGoalEffort;

export interface CoachGoalInput {
  /** Parsed runner-stated goal. ANY positive value → this module refuses. */
  statedGoalSec: number | null | undefined;
  /** races.meta.priority. */
  priority: string | null | undefined;
  /** Official distance, or the name/slug inference for a row missing one. */
  distanceMi: number | null | undefined;
  /** Course judged hilly (courseIsHilly above). */
  hilly?: boolean | null;
  /** Current evidence VDOT (bestRecentVdot). */
  vdot: number | null | undefined;
  /** Distance of the race/run that anchors that VDOT · sizes the §13.7 span. */
  vdotAnchorDistanceMi?: number | null;
  /** Whether the runner's plan meets §13.1's marathon-specificity minima
   *  (loadMarathonSpecificTraining). null = unknown = treated as absent. */
  marathonSpecificTraining?: boolean | null;
  /** Personal exponent fit when two qualifying recent races exist. */
  exponentFit?: PersonalExponentFit | null;
  todayISO: string;
}

/**
 * Derive the coach-set goal framing for one race. Null means "nothing to
 * set": a stated goal exists (untouchable), or there is no honest evidence to
 * set one from (no VDOT and no exponent fit, or an unusable distance) — a
 * fabricated goal is worse than an empty one.
 */
export function deriveCoachGoal(input: CoachGoalInput): CoachGoalFraming | null {
  // 1 · A runner-stated goal is untouchable. Standing rule; checked first so
  //     no later branch can ever produce a competing number.
  const stated = input.statedGoalSec;
  if (stated != null && Number.isFinite(stated) && stated > 0) return null;

  const setAt = input.todayISO;

  // 2 · C races carry no time goal — run hard, enjoy it, recover fast
  //     (Research/00b grades a C race a hard workout, no taper, no chase).
  if (input.priority === 'C') {
    return {
      kind: 'effort',
      coachSet: true,
      reason: 'c_priority',
      line: 'No time goal. Run it hard and enjoy the day.',
      setAt,
    };
  }

  // 3 · Hilly course → effort framing, never a flat-equivalent time
  //     (Research/11 §Pacing Rule for Hilly Courses).
  if (input.hilly === true) {
    return {
      kind: 'effort',
      coachSet: true,
      reason: 'hilly',
      line: 'Hilly course. Race it on effort, not a flat time. Steady on the climbs, controlled on the descents.',
      setAt,
    };
  }

  const distanceMi = input.distanceMi ?? null;
  if (distanceMi == null || !(distanceMi > 0)) return null;
  if (distanceMi > DANIELS_MAX_VALID_DISTANCE_MI) return null; // ultra — no honest band to set

  // 4 · B = the equivalent-fitness prediction. Personal exponent when two
  //     qualifying races exist (§14 rule 3), else the Daniels equivalence.
  let baseSec: number | null = null;
  let method: CoachGoalTargets['method'] = 'daniels-vdot';
  let personalExponent: number | null = null;
  let anchorDistanceMi = input.vdotAnchorDistanceMi ?? null;
  if (input.exponentFit) {
    const t = predictWithPersonalExponent(input.exponentFit, distanceMi);
    if (t != null) {
      baseSec = t;
      method = 'personal-exponent';
      personalExponent = input.exponentFit.b;
      // The span the CI pays for is the one actually projected across.
      const anchor = [...input.exponentFit.races].sort(
        (a, b2) =>
          Math.abs(Math.log(distanceMi / a.distance_mi!)) -
          Math.abs(Math.log(distanceMi / b2.distance_mi!)),
      )[0];
      anchorDistanceMi = anchor.distance_mi ?? anchorDistanceMi;
    }
  }
  if (baseSec == null && input.vdot != null && input.vdot > 0) {
    baseSec = predictRaceTime(input.vdot, distanceMi);
  }
  if (baseSec == null) return null;

  // 5 · Marathon-specificity honesty (Research/02 §13.1 :382, one-sided).
  const spec = marathonSpecificityAdjustment(
    distanceMi,
    anchorDistanceMi,
    input.marathonSpecificTraining ?? null,
  );

  // 6 · The CI half-width that sizes A and C — the same §13.7 span table the
  //     projection band uses. Cross-span row when doctrine states one and it
  //     is wider; the same-distance default otherwise.
  const cross = crossSpanCi(anchorDistanceMi, distanceMi, input.marathonSpecificTraining ?? null);
  let ciPct = researchSpanBasePct(distanceMi);
  let oneSided = false;
  if (cross != null && cross.pct > ciPct) {
    ciPct = cross.pct;
    oneSided = cross.oneSided;
  }

  let aSec: number;
  let bSec: number;
  let cSec: number;
  if (spec != null) {
    // One-sided shape: the raw equivalence is already the perfect-day
    // ceiling (§14.7: predictions here systematically over-predict), so it
    // IS the A. B carries §13.1's +5%. C sits one CI half-width past B —
    // for the §13.7 one-sided ±10% row that lands at raw +10%, its own slow
    // edge, since the band there is stated from the unadjusted prediction.
    aSec = roundTargetSec(baseSec);
    bSec = roundTargetSec(baseSec * (1 + spec.pct / 100));
    cSec = roundTargetSec(
      oneSided ? baseSec * (1 + ciPct / 100) : bSec * (1 + ciPct / 100),
    );
  } else {
    bSec = roundTargetSec(baseSec);
    aSec = roundTargetSec(baseSec * (1 - ciPct / 100));
    cSec = roundTargetSec(baseSec * (1 + ciPct / 100));
  }
  // Rounding must never invert the ladder.
  if (!(aSec < bSec && bSec < cSec)) {
    aSec = Math.min(aSec, bSec - 5);
    cSec = Math.max(cSec, bSec + 5);
  }

  const aDisplay = formatRaceTime(aSec);
  const bDisplay = formatRaceTime(bSec);
  const cDisplay = formatRaceTime(cSec);
  if (!aDisplay || !bDisplay || !cDisplay) return null;

  return {
    kind: 'time',
    coachSet: true,
    modelled: true,
    aSec, bSec, cSec,
    aDisplay, bDisplay, cDisplay,
    ciPct,
    oneSided,
    specificityAdjustedPct: spec?.pct ?? null,
    method,
    personalExponent,
    vdotBasis: method === 'daniels-vdot' ? (input.vdot ?? null) : null,
    line: 'Coach set from your current fitness. Yours to edit.',
    setAt,
  };
}
