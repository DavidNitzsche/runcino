/**
 * lib/plan/recompute-paces.ts · evidence-gated pace blend + adaptation-time
 * pace recompute.
 *
 * 2026-08-17 · coaching-loop reconciliation (David's direction: "the goal is
 * 3:00 for CIM but coach me there — the engine proposes evidence-based
 * targets and pushes me"). Two defects this module closes:
 *
 *   1. CALENDAR-GATED BLEND · composePlan's tPaceForWeek blended
 *      currentT → goalT over the first 60% of the build INDEXED BY WEEK
 *      NUMBER, so a runner whose measured fitness stalled still got
 *      goal-anchored quality paces on schedule. The blend math now lives
 *      here (blendedTPaceForWeek).
 *
 *      2026-08-17 (later the same day) · EVIDENCE-1 · the first cut of this
 *      module kept the calendar as the default and let a measured fraction
 *      CAP it, which left the violation intact whenever no evidence existed —
 *      i.e. on every fresh authoring. `Design/engine-doctrine-evidence-and-
 *      levers.md` Rule 1 is now locked and names it: "time passing, plan
 *      completion, or scheduled progression alone cannot increase or decrease
 *      demonstrated fitness." The calendar term is gone. The blend is the
 *      demonstrated fraction of the current→goal gap plus a fixed grace, and
 *      nothing else; with no evidence it is zero and the plan prescribes
 *      honest current-fitness paces until a measurement moves them.
 *      Cite: Research/01-pace-zones-vdot.md §"How to recalibrate paces"
 *      (:304-321 · retest triggers; VDOT moves ~1-3 pts per verified
 *      signal, never on schedule) and §"Freshness window" (:659-677 ·
 *      a stale anchor is a floor, not a pace source).
 *
 *   2. AUTHORING-ONLY PACES · weekly pace rows were derivable only inside
 *      composePlan. recomputePacesForPlan() re-derives every FUTURE,
 *      UNSEALED workout's pace_target_s_per_mi + workout_spec using the SAME
 *      buildWorkoutSpec call shape persistPlan uses. Sealed/completed days are
 *      immutable (Rule 15 · same guard predicate as adapt.ts
 *      filterUnsealedWorkouts).
 *      Cite: Research/01 §Recalibrate-Paces ("update VDOT and re-derive
 *      zones when a new measured signal lands").
 *
 * ── PRESCRIPTION-WIRE-1 (2026-08-31) · THIS IS NOW THE PACE PRESCRIPTION
 *    LAYER'S LIVE PATH, AND IT NO LONGER SPEAKS VDOT ─────────────────────────
 *
 * The 2026-08-30 decision settled what a block may change once authored: "the
 * whole block should be built but week to week there can be shifts in pace or
 * distance as needed" — layout, session types, dates, phases and taper FIXED;
 * pace and distance flexing on the weeks not yet run. This function is the pace
 * half of that mechanism, which makes it the one place a live plan's numbers can
 * be brought onto the canonical brain without re-authoring anything.
 *
 * So it is: every pace this function writes now comes from
 * `resolvePrescribedPaceAnchors` — the four capacity resolvers, through
 * `resolveCapacityPrescription` — and NOT ONE comes from the VDOT cascade. What
 * left with the cascade, and why each departure is the doctrine rather than a
 * simplification:
 *
 *   · `tPaceFromVdot(vdotNow)` as the threshold anchor → `resolveThresholdCapacity`.
 *     Constitution §5: one canonical resolver per derived value. VDOT survives
 *     UNDERNEATH it, as that resolver's own fourth rung, which is exactly the
 *     "VDOT becomes the fallback rather than the source every number passes
 *     through" call from 2026-08-31.
 *   · THE GOAL BLEND — `tPaceFromGoal`, `maxSeasonalVdotGain`, `goalVdot`,
 *     `measuredProgressFraction`, `blendedTPaceForWeek` — is GONE from this
 *     path entirely. Not softened: gone. Constitution §G's hard rule is
 *     "goal ≠ current training capacity", the standing constraint is "paces come
 *     from evidence, the goal never distorts training", and a per-week ramp from
 *     current fitness toward a goal-derived ceiling is that distortion in its
 *     purest form. The five functions remain exported because `generate.ts`'s
 *     authoring path still calls them and is a separately-scoped migration; this
 *     path does not.
 *   · `iPaceFromVdot(vdotFromTpace(t))`, and the `goalIPaceEligible` gate that
 *     decided whether a runner got a true I-pace based on WHAT RACE THEY HAD
 *     ENTERED → `resolveHighIntensityCapacity`, unconditionally. That gate was a
 *     goal reaching an interval pace, and Constitution §7 names it: "no
 *     feature-specific overrides."
 *   · The flat `T + 18` marathon offset and its goal-pace branch →
 *     `marathonPaceFromDurability`, the runner's own fitted Riegel exponent.
 *     The 2026-08-31 decision, verbatim: "adopt the new, personally-evidenced
 *     number ... no A/B toggle, no fallback to the old number."
 *   · The easy/long/recovery band, derived from a threshold offset →
 *     `resolveEasyCeiling`. And `shakeout` leaves `RECOMPUTE_EXEMPT_TYPES`,
 *     because it does carry a pace band and it now gets doctrine's RECOVERY
 *     ceiling rather than a general easy one.
 *
 * WHAT `vdotNow` IS STILL FOR. It is no longer a pace source and nothing below
 * derives a prescription from it. It remains the caller's statement that
 * evidence moved — the reason this function was called at all — it still feeds
 * `achievableRaceTarget` (Race Prediction's own input, §J), and it is recorded
 * in the audit stamp so the next reader can tell which measurement occasioned a
 * rewrite. Kept rather than removed because the callers' gates
 * (`shouldReanchor`, the adapter's delta checks) are genuinely about a VDOT
 * delta and are not this function's to redesign.
 *
 * RULE 11 · IF THE ANCHORS REFUSE, NOTHING IS WRITTEN. There is no fallback to
 * the old cascade. A silent fallback would be Constitution §8's "sometimes old,
 * sometimes new" and would make a real coherence defect invisible; leaving the
 * plan untouched is a safe, inspectable state and the refusal is logged.
 */

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { seasonalVdotCeiling, achievableRaceTarget } from '@/lib/training/achievable-target';
import { loadEffectiveMaxHr } from '@/lib/training/max-hr';
import { buildWorkoutSpec } from './spec-builder';
import { preserveProgressionSql, readSelectionRationale, RATIONALE_SPEC_KEY } from './progression-spec';
import { rationaleForRow } from '@/lib/workout-catalogue/select';
import { resolvePrescribedPaceAnchors } from '@/lib/training/load-prescription-anchors';
import type { PrescribedPaceAnchors } from '@/lib/training/prescription-resolver';

/**
 * Grace allowance on the measured-progress gate. Week 1-2 of a block has
 * no new race/test evidence yet — without the grace the gated blend would
 * pin every early week at exactly currentT and the first quality
 * progression step could never open. +0.15 of the currentT→goalT span is
 * ~1 VDOT point of pace on a 6-point season gap — inside the Research/01
 * :314-316 "tempo feels easier → +1 VDOT" single-signal step, so the
 * grace can never outrun what one honest retest could confirm.
 */
export const BLEND_GRACE_FRACTION = 0.15;

/**
 * GOAL-2 seasonal-gain cap · the ceiling `achievableFloorT` floors goal-T at,
 * and (since RACEPACE-1) the ceiling the prescribed RACE pace is floored at too.
 *
 * GAINRATE-2 (2026-08-25) · THE FOURTH GAIN MODEL, RECONCILED.
 *
 * This was `Math.min(6, 2 + totalWeeks * 0.22)`, carrying the citation
 * "Research/01:314-321 — retest deltas ~+2-3, scaled with build length, capped
 * ~+6". Three problems, and the third is the one that matters:
 *
 *  1. It is a LINE-NUMBER citation, which Rule 7 forbids precisely because
 *     line numbers rot.
 *  2. Its cap (6) sits ABOVE `MAX_BLOCK_GAIN_VDOT` (5.0), the bound ceiling
 *     every other consumer honours — so this formula could authorise a gain
 *     the rest of the engine calls impossible.
 *  3. The 2026-08-18 gain-rate reconciliation collapsed THREE incompatible
 *     rates (goal-ready 0.167-0.25, fitness-trajectory 0.35, goal-gap 0.5)
 *     into `lib/training/vdot-gain-rate.ts`, bound by ADAPTATION.vdot-gain-rate.
 *     It did not find this one. There were four.
 *
 * A fresh sweep of `Research/` and `BuildResearch/` confirms what that
 * reconciliation concluded: **the corpus contains no VDOT-gain-per-build rate
 * at all.** Every VDOT delta in it is REACTIVE — a trigger fired by an observed
 * signal (`Research/01` §"Triggers to retest": a race, a tempo that felt
 * easier, an HR that dropped). The single per-TIME quantum is §"Testing cadence
 * — how often to deliberately test", and `vdot-gain-rate.ts` already derives
 * the 0.167-0.25/wk band from it. So there is no third opinion available to
 * hold; there is one derivation, and this function now reads it.
 *
 * `+2 for free` is gone with it: it awarded two VDOT points to a zero-week
 * block, which is Rule 1's violation in its purest form (fitness from nothing
 * but the existence of a plan).
 *
 * TAPER DOES NOT BUILD. The old formula spent the whole `totalWeeks`, taper
 * included. `fitness-trajectory.ts` has always subtracted the taper before
 * sizing a gain ("taper expresses fitness, doesn't build it") and `assessGoal`
 * does the same; this now agrees with both, off the one shared
 * `taperWeeksForDistance` table.
 *
 * NET EFFECT: strictly more conservative at every horizon (14 weeks: 5.08 → 2.75).
 * Prescribed paces get slower, never faster, so no runner inherits work they
 * were not already being given.
 *
 * @param totalWeeks   the block's full length, taper included.
 * @param raceDistanceMi  used only to look up the taper length. Null → the
 *   shortest taper in the table, which maximises the build window and is
 *   therefore the direction that never silently withholds gain from a runner
 *   whose distance we could not read.
 */
export function maxSeasonalVdotGain(
  totalWeeks: number,
  raceDistanceMi: number | null = null,
): number {
  // RACEPACE-1 · delegated, not duplicated. The ceiling under THRESHOLD work
  // and the ceiling under RACE work are the same physiological claim about the
  // same runway, so they are the same call. `achievable-target.ts` owns it
  // because it must also be reachable from a client bundle, which this module
  // (it imports `pg`) can never be.
  return seasonalVdotCeiling(0, totalWeeks, raceDistanceMi).gainVdot;
}

/**
 * Measured share of the season's VDOT gap actually banked.
 *
 *   (vdotNow − vdotAtAuthoring) / (goalVdot − vdotAtAuthoring), clamped [0,1]
 *
 * null (= "no gate · trust the calendar") when any input is missing or the
 * goal isn't above the authoring fitness (soft goal · BRK-1 handles it).
 */
export function measuredProgressFraction(
  vdotAtAuthoring: number | null | undefined,
  vdotNow: number | null | undefined,
  goalVdot: number | null | undefined,
): number | null {
  if (vdotAtAuthoring == null || vdotNow == null || goalVdot == null) return null;
  if (!Number.isFinite(vdotAtAuthoring) || !Number.isFinite(vdotNow) || !Number.isFinite(goalVdot)) return null;
  const span = goalVdot - vdotAtAuthoring;
  if (span <= 0.1) return null;  // at/above goal already · no gap to gate
  return Math.min(1, Math.max(0, (vdotNow - vdotAtAuthoring) / span));
}

/**
 * EVIDENCE-1 (2026-08-17) · THE BLEND IS DRIVEN BY EVIDENCE, NOT BY THE WEEK
 * NUMBER.
 *
 * `Design/engine-doctrine-evidence-and-levers.md` Rule 1, locked by the owner:
 *
 *   > Time passing, plan completion, or scheduled progression alone cannot
 *   > increase or decrease demonstrated fitness.
 *
 * and it names this function's caller as violation #1 by file. The blend used
 * to advance from measured fitness toward the goal-derived ceiling on
 * `weekIdx / round(buildWeeks × 0.6)` — a calendar fraction — with the measured
 * gate only ever capping it. So when no evidence existed the calendar ran
 * unopposed, and the plan asserted a fitness change nobody measured: on the
 * owner's CIM block, threshold work by week 8 at a VDOT he has never run.
 *
 * There is now no calendar term. The fraction of the current→goal gap the
 * prescription may claim is the fraction the runner has DEMONSTRATED, plus the
 * standing grace below. No evidence supplied → 0 → the block trains at
 * current, demonstrated fitness for its whole length, and moves the day a race,
 * a time trial or a re-anchor lands (`recomputePacesForPlan`, which is the
 * evidence path and passes a real `measured`).
 *
 * The corollary the doctrine states for coming out of a recovery block —
 * "preserve the prior estimate, reduce confidence if warranted, and require
 * fresh evidence before moving the ceiling" — is exactly this: the prior
 * estimate is preserved because nothing moves it but a measurement.
 */
export function gatedBlendFraction(
  _calendarFraction: number,
  measured: number | null | undefined,
): number {
  if (measured == null) return 0;
  return Math.min(1, measured + BLEND_GRACE_FRACTION);
}

export interface BlendTPaceArgs {
  /** T-pace at current fitness (s/mi). */
  currentT: number | null;
  /** GOAL-2-floored goal T-pace (s/mi). */
  goalT: number | null;
  weekIdx: number;
  /** Phase label · 'TAPER' short-circuits (VAR-07). */
  phase: string;
  /** Non-TAPER weeks in the plan (blend denominator base). */
  buildWeeks: number;
  /** Measured-progress gate · null/undefined = calendar-only (authoring
   *  parity — byte-identical to the pre-2026-08-17 tPaceForWeek). */
  measuredProgressFraction?: number | null;
}

/**
 * Per-week T-pace · the single blend implementation shared by
 * composePlan (authoring) and recomputePacesForPlan (adaptation).
 * Semantics with measuredProgressFraction == null are byte-identical to
 * the historical composePlan-local tPaceForWeek (Rule 3 + BRK-1 + VAR-07).
 */
export function blendedTPaceForWeek(args: BlendTPaceArgs): number | null {
  const { currentT, goalT } = args;
  if (goalT == null) return null;
  if (currentT == null) return goalT;
  // BRK-1 · soft goal (runner already fitter than the goal) trains quality
  // at CURRENT fitness. See composePlan for the full rationale.
  if (currentT <= goalT) return currentT;
  const measured = args.measuredProgressFraction ?? null;
  // EVIDENCE-1 · TAPER used to return `goalT` verbatim when no evidence
  // existed — the sharpest form of the violation, since it prescribed
  // goal-anchored quality in the last three weeks to a runner who had never
  // demonstrated it. Taper now sharpens exactly as far as the evidence does,
  // like every other week. Race-pace work is unaffected: MP/HMP segments and
  // race day anchor on `goalPaceSec`, not on this T (Research/01:659-677 ·
  // a stale anchor is a floor, not a pace source).
  //
  // `weekIdx` and `buildWeeks` remain on the args for callers and for the
  // audit trail; nothing reads them any more, which is the point.
  const blend = gatedBlendFraction(0, measured);
  return Math.round(currentT + (goalT - currentT) * blend);
}

// ── Adaptation-time recompute ───────────────────────────────────────────

export interface RecomputePacesResult {
  planId: string;
  vdotNow: number;
  /**
   * PRESCRIPTION-WIRE-1 · always null now, and kept rather than removed so a
   * consumer that logs it (`adapt.ts`'s intent detail) keeps compiling and keeps
   * recording an honest value. The measured-progress gate graded a runner's
   * banked share of a GOAL gap, and this path no longer reads a goal at all —
   * so there is no fraction to report, which is a different fact from "the gate
   * ran and found zero" (Rule 11).
   */
  measuredProgressFraction: null;
  workoutsUpdated: number;
  workoutsSealed: number;
  /**
   * weekIdx → the threshold pace that week was priced at, for audit surfaces.
   *
   * Every entry now holds the SAME number. That is the point rather than a
   * degradation: the per-week variation it used to carry was a calendar-indexed
   * ramp toward a goal, and capacity does not vary by week index. When capacity
   * genuinely moves, this function runs again and every unrun week moves with
   * it.
   */
  weekT: Record<number, number | null>;
  /** The anchors this run priced the block at, for the audit trail and for a
   *  caller that wants to report what changed without re-resolving. */
  anchors: PrescribedPaceAnchors;
}

/** Types the recompute never touches: no pace to carry (rest/cross/strength)
 *  or owned by the race machinery (race day pacing is the effective-race-target
 *  resolver's job · lib/race/effective-race-target.ts; the tune-up is authored
 *  race-goal-relative and stays).
 *
 *  PRESCRIPTION-WIRE-1 · `shakeout` LEFT THIS LIST. The stated reason for its
 *  exemption was "no pace to carry", and that was simply not true: a shakeout
 *  row carries a `pace_target_s_per_mi_lo/hi` band in its spec, and on the
 *  owner's live block it was the one row type nothing could ever bring up to
 *  date — authored at 9:42/mi off a threshold offset and frozen there for the
 *  life of the plan. It now takes doctrine's recovery ceiling like every other
 *  easy-family row. `subLabelFromSpec` returns null for its `kind: 'easy'` spec,
 *  so the "SHAKEOUT · 4×20s strides" label survives the rewrite untouched. */
const RECOMPUTE_EXEMPT_TYPES = ['rest', 'cross', 'strength', 'race', 'race_week_tuneup'];

/**
 * Rewrite FUTURE (unsealed, incomplete) plan_workouts' pace targets +
 * workout_spec at the runner's CANONICAL, currently-resolved capacity.
 *
 * · Every zone is priced by the service that owns it, through one call to
 *   `resolvePrescribedPaceAnchors` per plan rather than one per row — the same
 *   six numbers for the whole block, because capacity is a property of the
 *   runner and not of a week index. See the file header for the full list of
 *   what each replaces.
 * · The anchors are CAPACITY-derived only. No readiness signal reaches them:
 *   this function writes months of future days and readiness answers a
 *   question about today (Constitution §D).
 * · A refused anchor set writes NOTHING and returns null. No fallback to the
 *   VDOT cascade (Rule 11, Constitution §8).
 * · Sealed days (a completed run exists for the date) are never touched —
 *   same predicate as adapt.ts filterUnsealedWorkouts (Rule 15).
 * · LAYOUT IS UNTOUCHED. Dates, types, distances, phases, quality flags and the
 *   taper are not columns this function writes, and the plan mutation boundary
 *   PROVES that by fingerprint rather than taking the claim on trust — which is
 *   the 2026-08-30 decision's fixity guarantee enforced rather than asserted.
 *
 * ROUTED THROUGH THE PLAN MUTATION BOUNDARY (2026-08-18).
 *
 * Every statement this function issues against `plan_workouts` touches only
 * `pace_target_s_per_mi`, `workout_spec` and `sub_label` — none of which any
 * invariant in `validate.ts` reads. It is a `'derivations'` mutation, and the
 * boundary PROVES that claim by fingerprinting the structural columns before
 * and after rather than taking the declaration on trust.
 *
 * Pass `client` to run inside a transaction the boundary ALREADY owns
 * (`applyAdaptations`, `reanchorPlan`) — the caller's `mutatePlan` covers these
 * writes and this function must not open a nested one. Omit it and the function
 * enters the boundary itself.
 */
export async function recomputePacesForPlan(
  planId: string,
  vdotNow: number,
  opts?: {
    source?: string;
    client?: { query: typeof pool.query };
  },
): Promise<RecomputePacesResult | null> {
  if (!Number.isFinite(vdotNow) || vdotNow <= 0) return null;
  const q = opts?.client ?? pool;

  const plan = (await q.query<{
    id: string; user_uuid: string; authored_state: Record<string, unknown> | null;
  }>(
    `SELECT id, user_uuid::text AS user_uuid, authored_state
       FROM training_plans
      WHERE id = $1 AND archived_iso IS NULL
      LIMIT 1`,
    [planId],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!plan) return null;

  const st = (plan.authored_state ?? {}) as Record<string, any>;
  /**
   * THE GOAL, READ ONCE, FOR ONE CONSUMER.
   *
   * These three are threaded to `achievableRaceTarget` and to
   * `buildWorkoutSpec`'s `race` branch, and to nothing else. That branch is
   * Race Prediction's (Constitution §J) and a race target legitimately reads a
   * stated goal — it is the one prescription in this app that does.
   *
   * Nothing below derives a TRAINING pace from any of them. Under the old
   * cascade `goalSec` reached `tPaceFromGoal` and shaped every quality session
   * in the block; that path is gone, and `race` is in `RECOMPUTE_EXEMPT_TYPES`
   * besides, so on today's engine no row reads them at all. They are threaded
   * so that the day race rows come into scope they cannot come in anchored to
   * something stale.
   */
  const raceDistanceMi = Number(st.race_distance_mi ?? st.goal_distance_mi) || null;
  const goalPaceSec = st.goal_pace_s_per_mi != null ? Number(st.goal_pace_s_per_mi) : null;
  const goalSec = st.goal_sec != null
    ? Number(st.goal_sec)
    : (goalPaceSec != null && raceDistanceMi != null ? Math.round(goalPaceSec * raceDistanceMi) : null);
  const totalWeeks = Number(st.total_weeks) || 0;
  /**
   * ANCHOR-STALE-2 (2026-08-30) · THE FROZEN THRESHOLD, KEPT ONLY AS A
   * FALLBACK FOR AN UNREADABLE PROFILE.
   *
   * `composePlan` writes `authored_state.lthr_bpm` once, at authoring, from
   * `profile.lthr`. This function used to READ that frozen value and hand it
   * straight to `buildWorkoutSpec` — so the one mechanism whose entire job is
   * to bring a plan up to date re-cemented the threshold anchor the plan was
   * born with, every time evidence moved the VDOT. The staleness was not
   * merely surviving the recompute; the recompute was rewriting it back in.
   *
   * The owner's anchor was re-derived from race evidence on 2026-08-30
   * (162 → 168 · `lib/training/lthr-reanchor.ts`). Under the old read, a
   * re-anchor firing after that would have rewritten every future workout's
   * `hr_cap_bpm` at 145 (89% of 162) and every quality session's `lthr_bpm`
   * at 162 — numbers about a runner who no longer exists, written by the
   * function that had just been told he had changed.
   *
   * Kept because a FAILED read is not the same as an absent threshold: if the
   * profile row cannot be reached we fall back to what the plan recorded
   * rather than silently stripping HR from every future session. An explicit
   * NULL in a profile row we DID read wins over it — see the `lthr` resolution
   * beside the `loadEffectiveMaxHr` call below.
   */
  const authoredLthr = st.lthr_bpm != null ? Number(st.lthr_bpm) : null;

  const today = await runnerToday(plan.user_uuid);

  /* ── THE ANCHORS · one resolution, for the whole block ───────────────────
   *
   * This replaces the entire currentT / goalT / measured-fraction /
   * per-week-blend apparatus that used to sit here. Six numbers, each from the
   * service that owns its question, and no goal among them.
   *
   * RULE 11 · A REFUSAL WRITES NOTHING. `composePaceAnchors` refuses only when
   * the set is INCOHERENT — an easy ceiling faster than threshold, a marathon
   * pace faster than a threshold pace, a non-finite number — which is a real
   * defect and not a thin-evidence case (every capacity resolver's last rung is
   * a population prior, so thin evidence still produces an ordered set). There
   * is deliberately no fallback: reaching for the VDOT cascade on a refusal
   * would put the defect on the runner's phone under a different derivation.
   */
  const anchorRead = await resolvePrescribedPaceAnchors(plan.user_uuid, today);
  if (!anchorRead.ok) {
    console.error(
      `[recomputePacesForPlan] REFUSED · plan=${planId} · anchors ${anchorRead.reason} · ${anchorRead.detail} · `
      + 'plan left untouched (Rule 11 · no fallback to the VDOT cascade)',
    );
    return null;
  }
  const anchors = anchorRead.anchors;

  // Week layout · read for the audit surface's per-week map and for nothing
  // else. The per-week BLEND it used to feed is gone: capacity does not vary by
  // week index, and a pace that advanced on the calendar was Rule 1's violation.
  const weekRows = (await q.query<{ week_id: string; week_idx: number; phase: string | null }>(
    `SELECT wk.id AS week_id, wk.week_idx, ph.label AS phase
       FROM plan_weeks wk
       LEFT JOIN plan_phases ph ON ph.id = wk.phase_id
      WHERE wk.plan_id = $1
      ORDER BY wk.week_idx ASC`,
    [planId],
  ).catch(() => ({ rows: [] }))).rows;
  if (weekRows.length === 0) return null;

  const weekT: Record<number, number | null> = {};
  for (const w of weekRows) weekT[w.week_idx] = anchors.thresholdSecPerMi;
  // RATIONALE-BACKFILL-1 · the doctrine phase per week, so a recomposed
  // rationale names the phase the session was actually placed in rather than
  // omitting it. Built off the same `weekRows` read, never a second query.
  const phaseByWeekId = new Map<string, string | null>(
    weekRows.map((w) => [String(w.week_id), w.phase ?? null]),
  );

  /**
   * ANCHOR-STALE-2 · THE HR ANCHORS, READ LIVE.
   *
   * Both of these used to be wrong in the same direction and for the same
   * reason — the recompute described the runner as he was at authoring:
   *
   *   · LTHR came off `authored_state.lthr_bpm`, frozen (above).
   *   · maxHr was passed as a literal `null`, with the standing note that HR
   *     caps "re-derive on the next full rebuild". They do not. Nothing else
   *     rewrites `workout_spec.hr_cap_bpm` for these rows, so the recompute
   *     was the rebuild, and it demoted `hrCapEasy` to its LTHR-only branch
   *     every time it ran.
   *
   * `profile.lthr` is read RAW, exactly as `composePlan` reads it (see
   * generate.ts §"7. T-pace + LTHR + maxHR"), and deliberately NOT through
   * `resolveThresholdHr`. That resolver's second rung estimates a threshold
   * from HRmax via the §11 crosswalk, which is the right answer for a
   * DISPLAY surface that can label a number as estimated. `buildWorkoutSpec`
   * cannot: it writes the value into `workout_spec.lthr_bpm`, where the
   * watch's quality HR target and the recap's aerobic gate read it as the
   * runner's measured threshold. Feeding it a crosswalk estimate would also
   * loosen the easy cap to ~81% of HRmax — above the 78% Daniels E ceiling
   * `hrCapEasy`'s maxHr arm exists to enforce — so a runner with no stored
   * LTHR would get a HIGHER cap than one whose threshold we actually know.
   * The raw read keeps authoring and recompute converging, which is this
   * module's stated contract.
   *
   * `loadEffectiveMaxHr` is the canonical resolver (override → 12-month
   * observed ceiling → stored) and is the ONLY correct reader here:
   * `users.max_hr` is a nightly ratchet mirror that never falls, and for this
   * runner it holds 181 from a single 2025-08-17 sample now outside the
   * 365-day window, against a live resolved 180.
   *
   * At LTHR 162 this pair is byte-identical to what the old call produced —
   * `hrCapEasy(162, 180)` is `max(145, 140)` = 145, the same 145 the
   * LTHR-only branch gave — so nothing regresses before the anchor moves. At
   * 168 every derived number moves with it: caps 145 → 151, tempo target
   * 149 → 155, the work-pass gate 158 → 164, the bail 167 → 173.
   */
  const lthrRow = (await q.query<{ lthr: number | null }>(
    `SELECT lthr FROM profile WHERE user_uuid = $1 LIMIT 1`,
    [plan.user_uuid],
  ).catch(() => null));
  // A row we READ decides, even when its `lthr` is null (the runner has no
  // threshold and the spec should carry none). Only an unreadable profile —
  // query error or no row at all — falls back to what the plan recorded.
  const lthr = lthrRow?.rows?.[0] != null
    ? (lthrRow.rows[0].lthr != null ? Number(lthrRow.rows[0].lthr) : null)
    : authoredLthr;
  const maxHr = await loadEffectiveMaxHr(plan.user_uuid, today)
    .then((r) => r.bpm)
    .catch(() => null);

  // Future rows + seal predicate in one read (same sealed EXISTS as
  // adapt.ts filterUnsealedWorkouts · Rule 15).
  const rows = (await q.query<{
    id: string; week_id: string | null; type: string; distance_mi: string | null;
    sub_label: string | null; date_iso: string; sealed: boolean;
    notes: string | null; workout_spec: unknown;
  }>(
    // RATIONALE-BACKFILL-1 · `notes` and `workout_spec` are read for one
    // purpose: to tell a row that already carries a `selection_rationale` from
    // one that predates the field, and to recompose the identifying half of the
    // line for the latter. See the write below.
    `SELECT pw.id::text AS id, pw.week_id::text AS week_id, pw.type,
            pw.distance_mi::text AS distance_mi, pw.sub_label,
            pw.date_iso::text AS date_iso, pw.notes, pw.workout_spec,
            EXISTS (
              SELECT 1 FROM runs r
               WHERE r.user_uuid = $2::uuid
                 AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10))::date = pw.date_iso::date
                 AND NOT (r.data ? 'mergedIntoId')
            ) AS sealed
       FROM plan_workouts pw
      WHERE pw.plan_id = $1
        AND pw.date_iso::date >= $3::date
        AND pw.type <> ALL($4::text[])
      ORDER BY pw.date_iso::date ASC`,
    [planId, plan.user_uuid, today, RECOMPUTE_EXEMPT_TYPES],
  ).catch(() => ({ rows: [] }))).rows;

  /**
   * PRESCRIPTION-WIRE-1 · THE I-PACE ELIGIBILITY GATE IS DELETED, NOT MOVED.
   *
   * It read: a 5K/10K/HM goal earns a true Daniels I-pace; a marathon or ultra
   * goal keeps the `T - 18` cruise default. That is a runner's ENTERED RACE
   * deciding what interval pace their intervals are run at — Constitution §7's
   * "no feature-specific overrides" and §G's "goal ≠ current training capacity",
   * in one line. High-intensity capacity is a property of the runner; a
   * marathoner's 800s are run at their own 3-5K effort, not at a slower pace
   * because of what is on their calendar.
   *
   * `resolveHighIntensityCapacity` now answers for every runner, unconditionally.
   * It is honest about how well it knows the number — on this account it is a
   * flagged `vdot_fallback` at confidence 0.29, because this app still has no
   * direct high-intensity reader — and that is a stated gap rather than a
   * silent one.
   */

  // RACEPACE-1 · the achievable race target, re-run against TODAY's fitness.
  // `currentVdot` is the CANONICAL threshold capacity's derived VDOT where one
  // exists, not the caller's `vdotNow` — Race Prediction consumes the Runner
  // Model (Constitution §J), and handing it a different fitness read than the
  // one that priced the block would be two answers to one question (Rule 16).
  // `vdotNow` remains the fallback for a runner whose threshold pace sits
  // outside the table's [30,85] range and therefore has no derived VDOT at all.
  const prescribedRacePaceSec = achievableRaceTarget({
    goalSec,
    currentVdot: anchors.basis.threshold.vdot ?? vdotNow,
    raceDistanceMi,
    totalWeeks,
  })?.paceSPerMi ?? null;

  const { subLabelFromSpec } = await import('@/lib/training/expand-spec');

  let updated = 0;
  let sealedCount = 0;
  // RATIONALE-BACKFILL-1 · counted so the audit stamp can say how many rows the
  // recompute gave a provenance line to, rather than leaving the backfill's
  // effect unobservable (Rule 21: a log that says something happened but not
  // what is not a log).
  let rationalesWritten = 0;
  const core = async (tx: { query: typeof pool.query }): Promise<void> => {
    for (const row of rows) {
      if (row.sealed) { sealedCount++; continue; }
      const distanceMi = row.distance_mi != null ? Number(row.distance_mi) : null;
      const built = buildWorkoutSpec(
        row.type, distanceMi,
        // PRESCRIPTION-WIRE-1 · the CANONICAL threshold, the same number the
        // anchor set carries, passed in both places so a branch that reads
        // `tPaceSec` and a branch that reads `anchors.thresholdSecPerMi` can
        // never be priced off different fitness (Rule 16).
        anchors.thresholdSecPerMi,
        lthr, row.sub_label,
        maxHr,              // ANCHOR-STALE-2 · the LIVE effective HRmax, so
                            // `hrCapEasy` gets both of its anchors and the
                            // max(89% LTHR, 78% HRmax) doctrine can actually
                            // run. Was a literal null on the claim that HR
                            // caps re-derive on the next full rebuild; this
                            // IS that rebuild.
        goalPaceSec,
        // The I-pace argument, superseded by `anchors` below and passed anyway
        // so the two agree if a branch ever reads the bare argument.
        anchors.intervalSecPerMi,
        // `easyAnchorTSec`, superseded likewise. Every easy/long/recovery band
        // now opens on `anchors.easyCeilingSecPerMi`; this is what the branches
        // that still consult the raw anchor would fall back to.
        anchors.thresholdSecPerMi,
        false,              // effortCued · a recompute runs on measured evidence
                            // by definition, so the calibration intro is over
        // RACEPACE-1 · re-derived off the canonical threshold's VDOT, not
        // carried forward. `RECOMPUTE_EXEMPT_TYPES` excludes `race`, so no row
        // reads this today — it is threaded so that the day race rows come into
        // scope they cannot come in still anchored to the authoring-time ceiling.
        prescribedRacePaceSec,
        // PRESCRIPTION-WIRE-1 · the six canonical anchors. This is the argument
        // that makes every derived pace below a READ rather than an offset.
        anchors,
      );
      if (!built.spec && built.paceTargetSPerMi == null) continue;
      const derivedLabel = built.spec
        ? subLabelFromSpec(built.spec as Parameters<typeof subLabelFromSpec>[0])
        : null;

      // ── RATIONALE-BACKFILL-1 (2026-09-01) ────────────────────────────────
      //
      // `preserveProgressionSql` already CARRIES an existing
      // `selection_rationale` forward (RATIONALE-PERSIST-1 widened its fold to
      // `DURABLE_SPEC_KEYS`), so nothing here can erase one. What it cannot do
      // is create one, and every row authored before that change carries none
      // — 103 of 103 on the owner's live block, so "why was this session
      // selected" has no answer in production on any row.
      //
      // `buildWorkoutSpec` knows nothing about the catalogue, so the recompute
      // cannot regenerate the selector's own line. `rationaleForRow` recomposes
      // the identifying half of it from what the row does carry, and refuses
      // (null) on a day the catalogue never filled rather than claiming a
      // provenance that day never had.
      //
      // WRITTEN ONLY WHEN ABSENT. A stored rationale is the selector's own
      // record of a real choice and outranks anything recomposed after the
      // fact, so this never overwrites one — the new spec simply does not carry
      // the key, and the preserve guard's "old had one" branch keeps it.
      const existingRationale = readSelectionRationale(row.workout_spec);
      if (built.spec && !existingRationale) {
        const recomposed = rationaleForRow({
          notes: row.notes,
          slot: row.type,
          phase: phaseByWeekId.get(row.week_id ?? '') ?? null,
        });
        if (recomposed) {
          (built.spec as Record<string, unknown>)[RATIONALE_SPEC_KEY] = recomposed;
          rationalesWritten++;
        }
      }
      await tx.query(
        // Rule 6 · this rebuilds the spec for the SAME session off a new pace.
        // `buildWorkoutSpec` knows nothing about the overload trajectory, so a
        // full replace would silently erase the shape every time evidence moved
        // the anchor — the one moment the adaptation model most needs to know
        // what the runner was already doing.
        `UPDATE plan_workouts
            SET pace_target_s_per_mi = $1,
                workout_spec = ${preserveProgressionSql('$2')},
                sub_label = COALESCE($3, sub_label)
          WHERE id = $4`,
        [built.paceTargetSPerMi, built.spec ? JSON.stringify(built.spec) : null, derivedLabel, row.id],
      );
      updated++;
    }
    // Audit stamp · field-level jsonb merge (Rule 6 · never full-replace).
    await tx.query(
      `UPDATE training_plans
          SET authored_state = COALESCE(authored_state, '{}'::jsonb)
              || jsonb_build_object('pace_recompute', $2::jsonb)
        WHERE id = $1`,
      [planId, JSON.stringify({
        at: new Date().toISOString(),
        vdot: vdotNow,
        // PRESCRIPTION-WIRE-1 · the gate this recorded graded a runner's banked
        // share of a GOAL gap, and this path no longer reads a goal. Written as
        // an explicit null rather than dropped, so a reader of an OLD stamp can
        // still tell "the gate ran" from "there is no gate any more" — the same
        // Rule 11 distinction the field itself used to carry.
        measured_progress_fraction: null,
        source: opts?.source ?? 'recompute_paces',
        workouts_updated: updated,
        // RATIONALE-BACKFILL-1 · how many rows gained a `selection_rationale`
        // they did not have. Zero on a block authored after RATIONALE-PERSIST-1,
        // which is the honest steady state, not a failure.
        rationales_written: rationalesWritten,
        // PRESCRIPTION-WIRE-1 · WHAT THESE ROWS WERE ACTUALLY PRICED AT, and how
        // well each number was known. Rule 10's stamp requirement, and the
        // answer to "was this block written before or after the prescription
        // layer landed" without an inference.
        anchors: {
          threshold_s_per_mi: anchors.thresholdSecPerMi,
          interval_s_per_mi: anchors.intervalSecPerMi,
          repetition_s_per_mi: anchors.repetitionSecPerMi,
          easy_ceiling_s_per_mi: anchors.easyCeilingSecPerMi,
          shakeout_ceiling_s_per_mi: anchors.shakeoutCeilingSecPerMi,
          marathon_s_per_mi: anchors.marathonSecPerMi,
          basis: anchors.basis,
        },
        model: 'prescription_resolver',
        // ANCHOR-STALE-2 · WHICH HR ANCHORS THESE SPECS WERE BUILT AGAINST.
        // The whole defect above was that nothing on a workout row records
        // the threshold that produced its HR numbers, so a stale one could
        // not be told from a current one by looking. This does not fix that
        // for the workout rows, but it does mean the PLAN carries the answer
        // for its most recent recompute — enough for the next audit to ask
        // "was this written before or after the re-anchor" and get a number
        // back instead of an inference.
        lthr_bpm: lthr,
        max_hr_bpm: maxHr,
      })],
    );
  };

  if (opts?.client) {
    // The caller's `mutatePlan` already owns this transaction and will validate
    // its whole batch. Opening a second one here would nest, and re-validating
    // a subset of the caller's batch would judge an intermediate state.
    await core(opts.client);
  } else {
    const { mutatePlan } = await import('./mutate');
    const boundary = await mutatePlan<void>({
      userUuid: plan.user_uuid,
      source: `recompute-paces/${opts?.source ?? 'standalone'}`,
      todayISO: today,
      planId,
      touches: 'derivations',
      detail: { vdot: vdotNow, rows: rows.length },
      apply: async (tx) => { await core(tx); },
    });
    if (!boundary.ok) {
      console.error(
        `[recomputePacesForPlan] REFUSED by the plan mutation boundary · plan=${planId} · ` +
        boundary.violations.join(' · '),
      );
      return null;
    }
  }

  try {
    const { bustPlanLookupCache } = await import('./lookup');
    bustPlanLookupCache(plan.user_uuid);
  } catch { /* best-effort */ }

  return {
    planId,
    vdotNow,
    measuredProgressFraction: null,
    workoutsUpdated: updated,
    workoutsSealed: sealedCount,
    weekT,
    anchors,
  };
}
