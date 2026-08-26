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
 *      UNSEALED workout's pace_target_s_per_mi + workout_spec from a
 *      stated VDOT using the SAME buildWorkoutSpec call shape persistPlan
 *      uses, so an adaptation-time recompute and a fresh authoring at the
 *      same VDOT converge. Sealed/completed days are immutable (Rule 15 ·
 *      same guard predicate as adapt.ts filterUnsealedWorkouts).
 *      Cite: Research/01 §Recalibrate-Paces ("update VDOT and re-derive
 *      zones when a new measured signal lands").
 */

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import {
  tPaceFromVdot, iPaceFromVdot, vdotFromTpace, vdotFromRace,
} from '@/lib/training/vdot';
import { seasonalVdotCeiling, achievableRaceTarget } from '@/lib/training/achievable-target';
import { buildWorkoutSpec, tPaceFromGoal, conservativeVdotFromMileage } from './spec-builder';
import { preserveProgressionSql } from './progression-spec';
import { distanceCategoryOrNull } from './goal-tiers';
import { paceBlendAnchorIsProvisional } from './anchor-provenance';

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
  /** Measured-progress fraction the gate ran with (null = ungated). */
  measuredProgressFraction: number | null;
  workoutsUpdated: number;
  workoutsSealed: number;
  /** weekIdx → recomputed T-pace (s/mi) for audit surfaces. */
  weekT: Record<number, number | null>;
}

/** Types the recompute never touches: no pace to carry (rest/cross/
 *  strength/shakeout) or owned by the race machinery (race day pacing is
 *  the effective-race-target resolver's job · lib/race/effective-race-
 *  target.ts; the tune-up is authored race-goal-relative and stays). */
const RECOMPUTE_EXEMPT_TYPES = ['rest', 'cross', 'strength', 'shakeout', 'race', 'race_week_tuneup'];

/**
 * Rewrite FUTURE (unsealed, incomplete) plan_workouts' pace targets +
 * workout_spec from a stated VDOT.
 *
 * · currentT re-anchors to tPaceFromVdot(vdotNow) — Research/01
 *   §Recalibrate-Paces row 1 ("new race result → update VDOT from race").
 * · goalT re-floors off vdotNow + maxSeasonalVdotGain(remaining weeks) —
 *   the GOAL-2 achievable-floor logic re-run against TODAY's fitness, so
 *   a runner who lost fitness gets a goalT floor that honestly reflects
 *   what the remaining runway can build.
 * · Each week's T comes from blendedTPaceForWeek with the measured gate
 *   active: fraction = (vdotNow − vdotAtAuthoring) / (goalVdot −
 *   vdotAtAuthoring). Fitness stalls → paces stall; fitness advances →
 *   paces advance; fitness tracks the calendar → recompute converges on
 *   the authored numbers (gate no-op).
 * · Sealed days (a completed run exists for the date) are never touched —
 *   same predicate as adapt.ts filterUnsealedWorkouts (Rule 15).
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
  const raceDistanceMi = Number(st.race_distance_mi ?? st.goal_distance_mi) || null;
  const goalPaceSec = st.goal_pace_s_per_mi != null ? Number(st.goal_pace_s_per_mi) : null;
  const goalSec = st.goal_sec != null
    ? Number(st.goal_sec)
    : (goalPaceSec != null && raceDistanceMi != null ? Math.round(goalPaceSec * raceDistanceMi) : null);
  const totalWeeks = Number(st.total_weeks) || 0;
  const lthr = st.lthr_bpm != null ? Number(st.lthr_bpm) : null;

  // Anchor VDOT the plan was authored at · pace_blend.season_anchor_vdot
  // (written by composePlan since 2026-08-17), falling back to the Rule 10
  // transparency envelope, then the cold-start mileage heuristic — the
  // same cascade composePlan's estimatedCurrentVdot ran at authoring.
  // COLD-3 (2026-08-17) · READER 2 · both the provisional anchor AND the
  // re-derivation rung below it are fabrications of the same number. This
  // function feeds `measuredProgressFraction`, whose entire job is to answer
  // "how much of the goal gap has the runner actually banked" — grading measured
  // progress against a mileage-derived starting point makes that number a
  // fiction, and the final rung recomputed the fiction from scratch even when
  // the plan never recorded one. When nothing was measured, the honest anchor is
  // null: `measuredProgressFraction(null, …)` already returns null, and the
  // blend falls back to its calendar forecast, which is at least labelled as a
  // forecast. (Design/adaptive-progression-engine.md §A.)
  const anchorProvisional = paceBlendAnchorIsProvisional(st.pace_blend);
  const vdotAtAuthoring: number | null =
    (!anchorProvisional && st.pace_blend?.season_anchor_vdot != null ? Number(st.pace_blend.season_anchor_vdot) : null)
    ?? (st.derived_from?.bestRecentVdot != null ? Number(st.derived_from.bestRecentVdot) : null);

  const goalVdot = goalSec != null && raceDistanceMi != null
    ? vdotFromRace(goalSec, raceDistanceMi)
    : null;
  const measured = measuredProgressFraction(vdotAtAuthoring, vdotNow, goalVdot);

  // currentT/goalT at TODAY's fitness. GOAL-2 floor re-run against vdotNow
  // over the plan's authored horizon (totalWeeks — the season's gain
  // budget, not the shrinking remainder, so repeated recomputes at stable
  // fitness are idempotent).
  const currentT = tPaceFromVdot(vdotNow);
  const goalTraw = raceDistanceMi != null ? tPaceFromGoal(goalSec, raceDistanceMi) : null;
  const achievableFloorT = tPaceFromVdot(vdotNow + maxSeasonalVdotGain(totalWeeks, raceDistanceMi));
  const goalT = (goalTraw != null && achievableFloorT != null)
    ? Math.max(goalTraw, achievableFloorT)
    : (goalTraw ?? currentT);
  if (goalT == null && currentT == null) return null;

  // Week layout: week_idx + phase label + non-taper count.
  const weekRows = (await q.query<{ week_id: string; week_idx: number; phase: string | null }>(
    `SELECT wk.id AS week_id, wk.week_idx, ph.label AS phase
       FROM plan_weeks wk
       LEFT JOIN plan_phases ph ON ph.id = wk.phase_id
      WHERE wk.plan_id = $1
      ORDER BY wk.week_idx ASC`,
    [planId],
  ).catch(() => ({ rows: [] }))).rows;
  if (weekRows.length === 0) return null;
  const buildWeeks = weekRows.filter((w) => (w.phase ?? '') !== 'TAPER').length;

  const weekT: Record<number, number | null> = {};
  const weekTByWeekId = new Map<string, number | null>();
  for (const w of weekRows) {
    const t = blendedTPaceForWeek({
      currentT,
      goalT,
      weekIdx: w.week_idx,
      phase: w.phase ?? '',
      buildWeeks,
      measuredProgressFraction: measured,
    });
    weekT[w.week_idx] = t;
    weekTByWeekId.set(w.week_id, t);
  }

  const today = await runnerToday(plan.user_uuid);

  // Future rows + seal predicate in one read (same sealed EXISTS as
  // adapt.ts filterUnsealedWorkouts · Rule 15).
  const rows = (await q.query<{
    id: string; week_id: string | null; type: string; distance_mi: string | null;
    sub_label: string | null; date_iso: string; sealed: boolean;
  }>(
    `SELECT pw.id::text AS id, pw.week_id::text AS week_id, pw.type,
            pw.distance_mi::text AS distance_mi, pw.sub_label,
            pw.date_iso::text AS date_iso,
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

  // Same I-pace eligibility rule persistPlan uses (R3 + PACE-I-1):
  // 5K/10K/HM goals carry true VO2max I-pace; marathon/ultra keep the
  // cruise default.
  // 2026-08-18 · resolved through THE categorizer, which answers null for an
  // unresolvable distance instead of bucketing 0 as a 5K.
  const goalIPaceEligible = raceDistanceMi != null
    && ['5k', '10k', 'hm'].includes(distanceCategoryOrNull(raceDistanceMi) ?? '');
  // PACE-E-1 · easy/long/recovery anchor tracks CURRENT fitness.
  const easyAnchorTSec = currentT;

  // RACEPACE-1 · the achievable race target, re-run against TODAY's fitness
  // over the plan's authored horizon — the same posture `achievableFloorT`
  // takes above, and for the same reason: a runner who gained gets a target
  // that reflects it, a runner who lost gets one that reflects that too.
  const prescribedRacePaceSec = achievableRaceTarget({
    goalSec, currentVdot: vdotNow, raceDistanceMi, totalWeeks,
  })?.paceSPerMi ?? null;

  const { subLabelFromSpec } = await import('@/lib/training/expand-spec');

  let updated = 0;
  let sealedCount = 0;
  const core = async (tx: { query: typeof pool.query }): Promise<void> => {
    for (const row of rows) {
      if (row.sealed) { sealedCount++; continue; }
      const t = (row.week_id != null ? weekTByWeekId.get(row.week_id) : null)
        ?? goalT ?? currentT;
      if (t == null) continue;
      const distanceMi = row.distance_mi != null ? Number(row.distance_mi) : null;
      const iPaceSec = goalIPaceEligible ? iPaceFromVdot(vdotFromTpace(t)) : null;
      const built = buildWorkoutSpec(
        row.type, distanceMi, t, lthr, row.sub_label,
        null,               // maxHr not persisted in authored_state · HR caps
                            // re-derive on the next full rebuild (same posture
                            // as adapt.ts rebuildWorkoutDerivations)
        goalPaceSec, iPaceSec, easyAnchorTSec,
        false,              // effortCued · a recompute runs on measured evidence
                            // by definition, so the calibration intro is over
        // RACEPACE-1 · re-derived off vdotNow, not carried forward. This is the
        // point of the whole mechanism: when evidence moves the anchor, the
        // race target the block rehearses moves with it. `RECOMPUTE_EXEMPT_
        // TYPES` currently excludes `race`, so no row reads this today — it is
        // threaded so that the day race rows come into scope they cannot come
        // in still anchored to the authoring-time ceiling.
        prescribedRacePaceSec,
      );
      if (!built.spec && built.paceTargetSPerMi == null) continue;
      const derivedLabel = built.spec
        ? subLabelFromSpec(built.spec as Parameters<typeof subLabelFromSpec>[0])
        : null;
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
        measured_progress_fraction: measured,
        source: opts?.source ?? 'recompute_paces',
        workouts_updated: updated,
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
    measuredProgressFraction: measured,
    workoutsUpdated: updated,
    workoutsSealed: sealedCount,
    weekT,
  };
}
