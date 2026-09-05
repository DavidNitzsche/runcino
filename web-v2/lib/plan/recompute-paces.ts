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
 * evidence moved — the reason this function was called at all — and it is
 * recorded in the audit stamp so the next reader can tell which measurement
 * occasioned a rewrite. (It fed `achievableRaceTarget` until B2, 2026-09-02,
 * deleted that call: its result reached no row, and the prescribed race target
 * belongs to `race-outlook.execution`.) Kept rather than removed because the callers' gates
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
import { seasonalVdotCeiling } from '@/lib/training/achievable-target';
import { loadEffectiveMaxHr } from '@/lib/training/max-hr';
import { buildWorkoutSpec } from './spec-builder';
import { preserveProgressionSql, readSelectionRationale, RATIONALE_SPEC_KEY } from './progression-spec';
import { rationaleForRow } from '@/lib/workout-catalogue/select';
import { resolvePrescribedPaceAnchors } from '@/lib/training/load-prescription-anchors';
import type { PrescribedPaceAnchors } from '@/lib/training/prescription-resolver';

/* ══════════════════════════════════════════════════════════════════════════
 * THE GOAL→TRAINING-PACE BLEND IS DELETED · AUTHORING-CANONICAL-1 (2026-09-01)
 *
 * Five exports lived here and every one of them existed to serve ONE
 * mechanism: walking a prescribed threshold pace from the runner's current
 * fitness toward the pace their STATED GOAL implies.
 *
 *   BLEND_GRACE_FRACTION      the 15% of the gap granted on zero evidence
 *   maxSeasonalVdotGain       the ceiling that bounded how far the goal reached
 *   measuredProgressFraction  the share of the goal gap actually banked
 *   gatedBlendFraction        measured + grace, capped at 1
 *   blendedTPaceForWeek       currentT + (goalT − currentT) × blend
 *
 * `recomputePacesForPlan` stopped calling them on 2026-08-31 (PRESCRIPTION-
 * WIRE-1: "this path no longer reads a goal at all"). `generate.ts` was the
 * only remaining caller, and as of AUTHORING-CANONICAL-1 it prices every zone
 * from `resolvePrescribedPaceAnchors` instead — so nothing in the app can
 * reach a training pace from a goal, and Constitution §7/§G is enforced by
 * ABSENCE rather than by a guard someone has to remember.
 *
 * WHAT REPLACED IT, AND WHY IT IS NOT A LOSS. The blend's honest half — "a
 * plan should aim a little beyond today" — belongs to the Adaptation Engine
 * (§I), which moves a pace when EVIDENCE says the runner has earned it, and to
 * `achievableRaceTarget`, which bounds RACE DAY against the runway. Neither
 * needs a calendar and neither reads a goal into a training zone.
 *
 * THE SEASONAL CEILING SURVIVES, IN ITS OWN HOME. `maxSeasonalVdotGain` was a
 * one-line delegation to `seasonalVdotCeiling` (`lib/training/achievable-
 * target.ts`), which is Race Prediction's own function and is still called by
 * `achievableRaceTarget`. Deleting the alias removes a second name for one
 * quantity (Rule 16); it removes no doctrine.
 *
 * RULE 20 · THIS DELETION IS GATED, NOT MERELY DONE. `scripts/check-goal-pace-
 * leak.sh` fails if any training pace in `lib/plan`, `lib/training` or
 * `lib/prescription` is derived from a goal outside the two owners allowed to,
 * and `EVIDENCE.no-calendar-pace-advance` in the doctrine registry now asserts
 * these five symbols STAY deleted — the same "guarded as removed" shape
 * `weeklyVolWoWMaxPct` already uses.
 * ═══════════════════════════════════════════════════════════════════════ */

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
  /** 2026-09-01 · race rows refreshed through the dedicated race-row path. */
  raceRowsUpdated: number;
  raceRowsRefused: number;
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
   * `goalPaceSec` is threaded to `buildWorkoutSpec` and to nothing else, and
   * nothing below derives a TRAINING pace from it. Under the old cascade
   * `goalSec` reached `tPaceFromGoal` and shaped every quality session in the
   * block; that path is gone.
   *
   * B2 (2026-09-02) · `goalSec`, `raceDistanceMi` and `totalWeeks` were read
   * here for one call — `achievableRaceTarget`, whose result reached no row,
   * because `race` and `race_week_tuneup` are both in
   * `RECOMPUTE_EXEMPT_TYPES`. That call is deleted (see the block below), so
   * the three reads go with it rather than sitting here as an unused goal read
   * inside the module whose whole point is that the goal does not price
   * training. The prescribed race target is resolved by
   * `lib/race/race-row-refresh.ts` from the race-pace brain.
   */
  const goalPaceSec = st.goal_pace_s_per_mi != null ? Number(st.goal_pace_s_per_mi) : null;
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

  /*
   * B2 (2026-09-02) · DELETED, not disabled. This recompute used to re-run
   * `achievableRaceTarget` here and thread the result into every
   * `buildWorkoutSpec` call below as `prescribedRacePaceSec`.
   *
   * `RECOMPUTE_EXEMPT_TYPES` (:195) contains BOTH `race` and
   * `race_week_tuneup`, so no row in this loop has ever read it — the previous
   * comment said so itself ("Race rows never reach this loop … no row reads
   * this; it is threaded so the builder's race branch has a coherent seed").
   *
   * A third live derivation of the prescribed race target, computed on every
   * recompute and consumed by nothing, is not a coherent seed. It is a second
   * answer waiting for a caller (Rule 16), and the caller it was waiting for
   * would have got 436 s/mi while `refreshRaceRowsForPlan` — which this
   * function invokes twenty lines below — wrote 443 onto the actual row.
   *
   * The race rows of this plan are priced by that call and by nothing else.
   */
  const { subLabelFromSpec } = await import('@/lib/training/expand-spec');

  let updated = 0;
  let raceRefresh = null as import('@/lib/race/race-row-refresh').RaceRowRefreshResult | null;
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
        // B2 · null, and it must stay null. Race rows are exempt from this
        // loop; the race branch of the builder is unreachable from here, and
        // the prescribed race target has one owner (`race-outlook.execution`,
        // written by `refreshRaceRowsForPlan` below).
        null,
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
    // 2026-09-01 · P0 · RACE ROWS ARE NOT PERMANENTLY EXEMPT. They are
    // excluded from the generic loop above because a race pace is not a
    // threshold offset — it is the race-pace brain's execution target — and
    // then refreshed here through the dedicated canonical path, inside the
    // same transaction, every time this recompute runs. The owner's CIM row
    // sat at 7:16/mi for a whole block while every rehearsal moved; that
    // was `race` in the exemption list and nothing on the other side of it.
    const { refreshRaceRowsForPlan } = await import('@/lib/race/race-row-refresh');
    raceRefresh = await refreshRaceRowsForPlan(planId, {
      client: tx, todayISO: today, source: `recompute-paces/${opts?.source ?? 'standalone'}`,
    }).catch((e) => {
      console.error(`[recomputePacesForPlan] race-row refresh failed · plan=${planId}`, e);
      return null;
    });
    /* PLANVERSION-1 (2026-09-03) · a recompute that actually MOVED a
     * prescribed pace is exactly the "in-place pace re-anchor" case that
     * field's own doc comment names as a trigger — and this UPDATE never
     * touched it, so a client cache keyed on `${id}:${last_adapted_at}`
     * (Today, the week strip, the watch) had no signal that 72 workouts'
     * paces had just changed underneath it. Found auditing the pace-
     * recompute run against David's own account this session — the exact
     * "Today/week caches invalidated?" check his own protocol asks for.
     *
     * Gated on something having actually changed, not run unconditionally:
     * a no-op recompute (every anchor already current, nothing to write)
     * must not force every client to refetch and redraw for zero real
     * content change — that would be its own small Rule 9 violation in the
     * other direction. */
    const raceRowsChanged = (raceRefresh?.rows ?? []).some((r) => r.action === 'updated');
    if (updated > 0 || raceRowsChanged) {
      await tx.query(
        `UPDATE training_plans SET last_adapted_at = now() WHERE id = $1`,
        [planId],
      );
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
    // AUTHORITY (2026-09-05) · this IS a coaching adaptation: it rewrites
    // prescribed paces on a live plan from the engine's own judgement, and it
    // is called from an unattended cron. Held, not exempted: the hold is
    // logged on every run and the gate fails when any field is missing.
    authority: 'COACHING_ADAPTATION',
    hold: {
      owner: 'David',
      blocker: 'called by reanchor and plan-drift, so it inherits reanchor own blocker',
      expiresWhen: 'its callers stop writing directly and go through a proposal',
    },
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
    raceRowsUpdated: raceRefresh?.updated ?? 0,
    raceRowsRefused: raceRefresh?.refused ?? 0,
    workoutsSealed: sealedCount,
    weekT,
    anchors,
  };
}
