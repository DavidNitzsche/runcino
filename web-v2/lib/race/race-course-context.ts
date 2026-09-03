/**
 * lib/race/race-course-context.ts · RP-4 / RP-5 · WHAT THE COURSE ACTUALLY DOES.
 *
 * ── Q26, AND THE HALF OF IT THIS FILE OWNS ──────────────────────────────────
 *
 * `ADAPTATION_ENGINE_CONTRACT.md` Q26 fixes the chain:
 *
 *   flat-equivalent capability
 *     → one canonical course adjustment
 *       → course-specific finish target
 *         → mile-by-mile pacing plan that SUMS to that target
 *
 * Two of those four links are live and one is not, and this file is careful
 * about which is which:
 *
 *   · The flat-equivalent capability is `race-outlook.ts`'s
 *     `execution.targetSec`. Not this file's.
 *   · The canonical course adjustment is `courseElevationCostSec`
 *     (`lib/training/elevation-model.ts`), which is the ONE elevation model in
 *     the app and the only declarer of `DESCENT_GIVEBACK_FRACTION = 0.50`
 *     (`lib/terrain/grade-adjust.ts`, gated by `TERRAIN.descent-giveback`).
 *     This file calls it, once, for CONTEXT.
 *   · The course-specific finish TARGET does not exist. Measured live on the
 *     owner's CIM, 2026-09-02: the execution target is 3:23:50 and the
 *     canonical model prices the course at +61 s, so the course-specific
 *     target would be about 3:24:51 and no code anywhere produces it.
 *   · The split plan already sums to the target it is given
 *     (`lib/race/pacing.ts` normalises the time-weighted total), so the
 *     "adjust the target and then apply another net course benefit inside the
 *     splits" failure is NOT present. `_race_course_context.test.ts` measures
 *     that rather than trusting the comment (Rule 20).
 *
 * ── WHY THIS FILE DOES NOT PRODUCE A COURSE-ADJUSTED TARGET ─────────────────
 *
 * Because "what should he run this race at" has exactly one owner, and it is
 * `race-outlook.ts` (Rule 16, and the Constitution's one-owner rule). A second
 * module emitting a second finish time is precisely the defect the race page
 * exists to remove — three CIM projections, all defensible, all live at once.
 * The gap is REPORTED to the owner of that module, not patched around here.
 *
 * ── AND WHY THE PAGE SHOWS NO SECOND FINISH TIME ────────────────────────────
 *
 * A row reading "the course adds 61 s, which is not in your target" hands the
 * runner a fifth number under a fourth label on the one page whose whole job is
 * not to do that (Rule 17). So the course is described as a COURSE — measured
 * gain, measured loss, net, and one sentence about what that profile means —
 * and the arithmetic stays in the report.
 *
 * That sentence is also the doctrine's own warning, and it is the
 * counterintuitive part worth saying out loud. CIM is net downhill by 304 ft
 * and the canonical model still prices it as a net COST, because a descent
 * hands back only half of what the matching climb charged. Q26: "The downhill
 * adjustment should be modest and evidence-bounded. It must not create a
 * materially more aggressive race plan merely because CIM is net downhill."
 *
 * ── WHAT THIS FILE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · Whether the elevation NUMBERS are right. `resolveCourseElevation` owns
 *     provenance and trust, and this file reports what it was handed.
 *   · A course with no data. It returns null and the page draws nothing, which
 *     is the required behaviour: "If course data is unreliable, say so rather
 *     than drawing a profile."
 *   · Whether the pacing plan is GOOD. It only checks that its total
 *     reproduces the target it was given.
 */
import { courseElevationCostSec } from '@/lib/training/elevation-model';
import { DESCENT_GIVEBACK_FRACTION } from '@/lib/terrain/grade-adjust';
import { elevationIsTrustedForAdjustment, type ResolvedCourseElevation } from './course-elevation';

export interface RaceCourseContext {
  /** Measured or curated gross climb, feet. Null when unknown. */
  gainFt: number | null;
  /** Gross descent, feet, derived as gain minus net. Null when unknown. */
  lossFt: number | null;
  /** Signed net change, feet. Negative is net downhill. */
  netFt: number | null;
  /** `resolveCourseElevation`'s own provenance word, passed through. */
  provenance: string;
  /** Its own confidence word, passed through. */
  confidence: string;
  /**
   * Measured and curated disagree. The runner is told, because a profile drawn
   * from one while the other is on the race's own page is the sort of quiet
   * disagreement Rule 16 is about. Null when they agree or only one exists.
   */
  conflictNote: string | null;
  /**
   * The canonical model's SIGNED seconds for this course at the target pace.
   * Positive means the profile costs time. Null when there is no course data.
   *
   * NOT APPLIED to any target anywhere. It is here so the sentence below can
   * be true, and so the report can state the size of the missing link.
   */
  adjustmentSec: number | null;
  /** The coefficient and model that produced it, per Q26's persistence list. */
  model: { descentGivebackFraction: number; modelId: string };
  /** The figures as a sentence. Null when there is no data. */
  sentence: string | null;
  /**
   * What the profile MEANS — the half no elevation footnote carries. Null when
   * the elevation is not trustworthy enough to argue from, because an
   * interpretation is an argument and a measurement is not.
   */
  meaning: string | null;
  /**
   * Whether the target the page shows has had this adjustment applied.
   * ALWAYS FALSE TODAY, and named rather than assumed, so a surface can never
   * imply a course-adjusted number it was not given.
   */
  appliedToTarget: false;
}

/**
 * The FIGURES, as one sentence. Kept separate from `meaning` below because the
 * v5 race detail already prints gain and net as elevation footnotes, and Rule
 * 17 is explicit that the yield happens on the rendered text. The phone draws
 * the meaning and lets the footnotes carry the numbers; a surface with no
 * footnotes can draw both.
 */
function describeFigures(gainFt: number, lossFt: number, netFt: number | null): string {
  const figures = `${Math.round(gainFt)} ft of climb and ${Math.round(lossFt)} ft of descent`;
  // RULE 11 · an unknown net is not a flat course. `netFt ?? 0` said "net flat
  // by 0 ft" over a course nobody had measured the net of, which is a claim
  // this file is in no position to make.
  if (netFt == null) return `${figures}. The net change is not known.`;
  const netWord = netFt < -50 ? 'net downhill' : netFt > 50 ? 'net uphill' : 'net flat';
  return `${figures}, ${netWord} by ${Math.abs(Math.round(netFt))} ft.`;
}

/**
 * What the profile MEANS, which is the part no footnote carries.
 *
 * Null when the elevation is not trustworthy enough to argue from, because
 * the interpretation is an argument and the figures are not (Rule 11 · a
 * refusal is a third fact).
 */
function describeMeaning(netFt: number | null, adjustmentSec: number | null): string | null {
  if (adjustmentSec == null) return null;
  // RULE 11 again · with no net there is no net-downhill sentence to write,
  // and the generic ones below would be guessing at the shape of the course.
  if (netFt == null) return null;
  // Q26's own warning, and the reason it is worth saying out loud: a descent
  // hands back only half of what the matching climb charged, so a net-downhill
  // course is not automatically a fast one.
  if (netFt < -50 && adjustmentSec > 0) {
    return 'A descent gives back about half of what the matching climb costs, so this profile is close to neutral rather than a gift.';
  }
  if (adjustmentSec > 0) return 'The climbing is the part that costs you here.';
  return 'The profile is a small help rather than a cost.';
}

/**
 * Build the course context. Null when there is no trustworthy course data,
 * which is the correct refusal rather than a drawn profile.
 *
 * `flatPaceSecPerMi` is the pace the cost is priced at — the canonical model
 * scales with pace because a slower runner pays more seconds per foot.
 */
export function raceCourseContext(args: {
  resolved: ResolvedCourseElevation | null | undefined;
  distanceMi: number;
  flatPaceSecPerMi: number | null;
}): RaceCourseContext | null {
  const r = args.resolved;
  if (!r) return null;
  const gainFt = r.elevationGainFt ?? null;
  const netFt = r.netElevationFt ?? null;
  // Rule 11 · no elevation data at all is a refusal, not a flat course.
  if (gainFt == null && netFt == null) return null;

  const gain = gainFt ?? Math.max(0, netFt ?? 0);
  const loss = Math.max(0, gain - (netFt ?? 0));

  /**
   * THE PER-FINDING CONTEXT FILTER (CLAUDE.md, locked 2026-05-19 round 4).
   *
   * `course-elevation.ts` draws the line itself and says why: display paths
   * "deliberately do NOT call this — they are reporting the measurement, not
   * arguing from it", while anything that turns elevation into SECONDS must
   * pass `elevationIsTrustedForAdjustment`. The gain/loss figures above are a
   * display path and are always reported; `adjustmentSec` argues from them and
   * is gated.
   *
   * The resolver deliberately lets a LOW-confidence trace through when there
   * is no curated row to fall back on — the common case for a race a runner
   * added themselves — and low there is self-refuting ("too coarse for gross
   * gain", "signal dropout"). Rule 11: a refusal is a third fact, so this is
   * null rather than zero, and `describe` then says nothing about cost.
   */
  const adjustmentSec = resolveAdjustmentSec({
    trusted: elevationIsTrustedForAdjustment(r),
    distanceMi: args.distanceMi,
    flatPaceSecPerMi: args.flatPaceSecPerMi,
    gainFt,
    netFt,
  });

  const conflict = (r.conflict ?? null) as { detail?: string } | null;

  return {
    gainFt,
    // Reachable only past the both-absent refusal above, so `loss` is always a
    // real figure here. It used to carry a `gainFt == null && netFt == null`
    // ternary that could never be true — a dead branch collapsing two absences
    // into one null, which is the shape `_coercion_scan` exists to catch.
    lossFt: loss,
    netFt,
    provenance: r.provenance,
    confidence: String(r.confidence ?? 'unknown'),
    conflictNote: conflict?.detail
      ? `Measured elevation differs from the listed course profile (${conflict.detail}). The measured trace is what is drawn.`
      : null,
    adjustmentSec,
    model: { descentGivebackFraction: DESCENT_GIVEBACK_FRACTION, modelId: r.algorithmVersion ?? 'elevation_model' },
    sentence: describeFigures(gain, loss, netFt),
    meaning: describeMeaning(netFt, adjustmentSec),
    appliedToTarget: false,
  };
}

/**
 * The course adjustment, or an explicit refusal — RULE 11, FOUR SEPARATE
 * REASONS, NOT ONE NULL WITH A SHRUG.
 *
 * This began as one compound ternary whose alternate was `null`, and
 * `_coercion_scan` was right to flag it: "the trace is not trustworthy enough
 * to argue from", "there is no pace to price it at", "there is no distance",
 * and "the canonical model itself declined" are four different facts, and a
 * single boolean chain collapsing them means nothing downstream can tell them
 * apart or explain which one happened.
 *
 * They still all return null, because the CALLER's behaviour is the same in
 * every case — say nothing about cost rather than say "no cost". Written as
 * guards, each one is named and any future caller that needs the distinction
 * has somewhere to put it.
 */
function resolveAdjustmentSec(args: {
  trusted: boolean;
  distanceMi: number;
  flatPaceSecPerMi: number | null;
  gainFt: number | null;
  netFt: number | null;
}): number | null {
  // The trace says of itself that it is too coarse for gross gain. Feet may
  // still be reported; seconds may not be argued from them.
  if (!args.trusted) return null;
  // No pace means nothing to price the climb against — the canonical model
  // scales its cost with pace, so there is no answer, not a zero one.
  if (args.flatPaceSecPerMi == null || !(args.flatPaceSecPerMi > 0)) return null;
  // No distance is a different absence again, and a course of zero miles is
  // not a flat one.
  if (!(args.distanceMi > 0)) return null;
  const sec = courseElevationCostSec({
    distanceMi: args.distanceMi,
    flatPaceSPerMi: args.flatPaceSecPerMi,
    gainFt: args.gainFt,
    netFt: args.netFt,
  });
  // The canonical model's own refusal, passed through rather than flattened.
  if (sec == null) return null;
  return Math.round(sec);
}

/** The wire shape. snake_case, additive, nothing computed here. */
export function raceCourseContextPayload(c: RaceCourseContext | null | undefined) {
  if (!c) return null;
  return {
    gain_ft: c.gainFt,
    loss_ft: c.lossFt,
    net_ft: c.netFt,
    provenance: c.provenance,
    confidence: c.confidence,
    conflict_note: c.conflictNote,
    adjustment_sec: c.adjustmentSec,
    descent_giveback_fraction: c.model.descentGivebackFraction,
    model_id: c.model.modelId,
    sentence: c.sentence,
    meaning: c.meaning,
    applied_to_target: c.appliedToTarget,
  };
}

/**
 * Q26'S LOAD-BEARING PROPERTY, AS A FUNCTION ANYONE CAN CALL.
 *
 * "The split plan may redistribute effort for climbing and descending, but its
 * total must reproduce the course-adjusted target. Never adjust the overall
 * target and then apply another net course benefit inside the splits."
 *
 * Returns the signed drift in seconds between the phase plan's time-weighted
 * integral and the target it was built from. A plan that quietly bought itself
 * a second course benefit shows up here as a large negative number.
 *
 * The tolerance is not zero because each phase pace is rounded to whole
 * seconds per mile before display, and that rounding is real: on the owner's
 * CIM it accumulates to -6 s across five phases and 26.22 miles, which is
 * 0.05% and is not a second adjustment.
 */
export function pacingPlanDriftSec(
  phases: readonly { start_mi: number; end_mi: number; pace_s_per_mi: number }[] | null | undefined,
  targetSec: number,
): number | null {
  if (!phases || phases.length === 0) return null;
  const integral = phases.reduce((a, p) => a + p.pace_s_per_mi * (p.end_mi - p.start_mi), 0);
  return Math.round(integral - targetSec);
}

/** One second per mile of race distance, which is the most per-phase rounding
 *  can accumulate to. Anything beyond it is a second adjustment, not rounding. */
export function pacingDriftToleranceSec(distanceMi: number): number {
  return Math.max(5, Math.ceil(distanceMi));
}
