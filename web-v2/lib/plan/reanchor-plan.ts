/**
 * reanchor-plan — the daily self-heal that ends a provisional anchor.
 *
 * A plan's paces are baked when it is authored. If the runner's fitness was not
 * measurable then — data not synced yet, or a true cold start — the plan was
 * anchored on `conservativeVdotFromMileage`, a VDOT invented out of a
 * self-reported weekly-mileage bucket. Nothing upgraded it, so the runner stayed
 * on fabricated paces for the life of the block. That is the Justin bug,
 * generalised.
 *
 * This runs daily inside the projection cron, which has already computed every
 * runner's measured VDOT through the canonical evidence-only loader. When a
 * measured read becomes available, or the runner's fitness has shifted
 * materially, it refreshes the FUTURE workouts' paces IN PLACE. Plan structure,
 * dates, distances, phases and any already-run history are untouched.
 *
 * It also powers the calibration intro: a plan whose opening weeks prescribe
 * quality BY EFFORT (`anchor-provenance.ts` · `CALIBRATION_INTRO_WEEKS`) commits
 * to real paces here the moment its first honest effort reads. That is what
 * makes the intro temporary rather than permanent.
 *
 * ── 2026-08-17 · COLD-4 · SCOPE AND NAME ────────────────────────────────────
 *
 * This was `reanchorMaintenancePlan`, scoped `mode = 'maintenance' AND race_id
 * IS NULL`. Every honest cold-start mechanism in this codebase was built on the
 * no-race path and race-prep — where a new runner WITH a goal lands — got none
 * of them. So a runner training for a marathon off an invented VDOT had no way
 * back: the intro could start but nothing could end it.
 *
 * The function now covers the runner's active plan whatever its mode, and the
 * name says so. The two modes need genuinely different machinery and each gets
 * the one that already exists:
 *
 *   · race-prep → `recomputePacesForPlan`, which knows the seal predicate, the
 *     exempt types and the sub-label derivation.
 *   · maintenance / recovery / no-race → the in-place refresh below.
 *
 * Both now price off ONE anchor set (see PRESCRIPTION-WIRE-1 below). The older
 * note here said the maintenance arm used "the same `buildWorkoutSpec` call
 * shape the seeder uses, so a re-anchor and a fresh seed at the same VDOT
 * converge" — that convergence was with the AUTHORING path and it is
 * deliberately over; the convergence that holds now is between the two arms.
 *
 * ── THE THREE GUARDS ────────────────────────────────────────────────────────
 *
 * 1. SEALED DAYS ARE NEVER REWRITTEN. A date the runner has already run is
 *    immutable — they trained against the prescription that was there, and
 *    changing it after the fact makes every retro lie (Rule 15). The race-prep
 *    arm inherits this from `recomputePacesForPlan`; the maintenance arm below
 *    now applies the same `EXISTS` predicate, which it previously did not.
 *
 * 2. ONLY A MEASURED READ FIRES IT. `measuredVdot` comes from
 *    `bestRecentVdot(raceCandidates, …, runCandidates)` — races, time trials and
 *    qualifying training efforts, nothing else. Re-anchoring a provisional
 *    anchor onto another provisional one would launder the same fabrication
 *    through a second column and reset the intro window for free.
 *
 * 3. IT CLEARS THE MARKS IT RESOLVES. A plan that has been re-anchored must stop
 *    advertising a calibration that has ended, or the next authoring re-opens
 *    the intro and `paceBlendAnchorIsProvisional` keeps three readers refusing
 *    an anchor that is now real.
 *
 * Cite: Research/01-pace-zones-vdot.md §"How to recalibrate paces" — update
 * VDOT and re-derive zones when a new measured signal lands.
 *
 * ── PRESCRIPTION-WIRE-1 (2026-08-31) · WHAT "RE-ANCHOR" NOW MEANS ───────────
 *
 * Both arms have stopped deriving paces from a VDOT. `measuredVdot` is still
 * the TRIGGER — it is what says evidence moved, and `shouldReanchor` /
 * `shouldReanchorRacePrep` still gate on its delta — but the numbers written
 * come from `resolvePrescribedPaceAnchors`: the four canonical capacity
 * resolvers, through the Pace Prescription layer. `tPaceFromVdot` and
 * `iPaceFromVdot` are no longer imported by this file at all.
 *
 * That closes a Rule 16 divergence the two arms carried since they were joined:
 * race-prep priced a block through the goal blend and maintenance through
 * `tPaceFromVdot(measuredVdot)`, so the same runner at the same fitness got two
 * different threshold paces depending on which mode their plan was in.
 */

import { pool } from '@/lib/db/pool';
import { buildWorkoutSpec } from './spec-builder';
import { preserveProgressionSql } from './progression-spec';
import { paceBlendAnchorIsProvisional } from './anchor-provenance';
import { loadEffectiveMaxHr } from '@/lib/training/max-hr';
import { rowOrNull } from '@/lib/db/read';
import { resolvePrescribedPaceAnchors } from '@/lib/training/load-prescription-anchors';
import type { PrescribedPaceAnchors } from '@/lib/training/prescription-resolver';
import { mutatePlan } from './mutate';
import { runDaySql, runNotMergedSql } from '@/lib/runs/run-shape';
import { recordPaceZoneEvent, type PaceZoneEvidenceSource } from './pace-drop-event';
import {
  SELF_HEAL_REANCHOR_DELTA,
  ADAPTER_ANCHOR_DEFER_HOURS,
  adapterMovedAnchorWithin,
  selfHealShouldDefer,
} from '@/lib/training/pace-anchor';

/**
 * What licensed the new VDOT, as far as the caller can say. Threaded through
 * from `bestRecentVdot`'s winning candidate (`app/api/cron/snapshot-
 * projections/route.ts`) or from the race-authority fallback
 * (`lib/race/next-best-anchor.ts`) so `GET /api/v5/paces` can tell "a race
 * confirmed this" from "training evidence modelled this" days later. Optional
 * and best-effort — omitting it just means the pace-drop card reads as
 * training-modelled with no named race.
 */
export interface ReanchorEvidence {
  source: 'race' | 'run' | null;
  refId: string | null;
}

/** Refresh only when fitness moved enough to matter — avoids churning paces on
 *  day-to-day VDOT jitter (the fade/candidate set wiggles ±~0.5).
 *  2026-08-28 · the VALUE now lives in the shared anchor-policy module
 *  (`lib/training/pace-anchor.ts`), beside the adapter's evidence-kind gates,
 *  so the two writers' thresholds can no longer drift apart unseen. This
 *  export is kept for its existing consumers. */
export const REANCHOR_VDOT_DELTA = SELF_HEAL_REANCHOR_DELTA;

/**
 * 2026-09-02 · THE PLAN FOLLOWS EVERY BELIEF, NOT ONE OF THEM.
 *
 * The repricing gate read the VDOT anchor delta and nothing else, so a block
 * stayed on stale prices whenever a belief OTHER than threshold moved. Found
 * in production on this date: the durability correction moved the owner's
 * marathon anchor 475 → 472 s/mi and new interval evidence moved his interval
 * anchor 407 → 401, his threshold VDOT did not move, and the nightly job
 * therefore repriced nothing. Two of his marathon-pace rehearsals and five
 * interval sessions kept prices the Runner Model no longer holds.
 *
 * The plan already records what it was last priced at
 * (`authored_state.pace_recompute.anchors`, the Rule 10 stamp), so the honest
 * trigger is "has any canonical anchor moved from the stamp", with no new
 * data and no new read.
 *
 * The threshold is a CONVENTION for model stability, not a physiological
 * finding: a prescribed pace is written to the row in whole seconds per mile,
 * and the composer's own rounding moves a band edge by up to a second, so a
 * one-second difference is arithmetic rather than a changed belief. Three
 * seconds per mile is the smallest move that survives that rounding on every
 * anchor and is still invisible inside a workout — the same order as the
 * `MEANINGFUL_MOVE_SEC` convention the race target uses, scaled to a pace.
 */
export const REANCHOR_ANCHOR_DELTA_S_PER_MI = 3;

/** The six canonical anchors as the Rule 10 stamp records them. */
const STAMPED_ANCHOR_KEYS = [
  'threshold_s_per_mi', 'interval_s_per_mi', 'repetition_s_per_mi',
  'easy_ceiling_s_per_mi', 'shakeout_ceiling_s_per_mi', 'marathon_s_per_mi',
] as const;

/**
 * Pure · has any canonical anchor moved from what this plan was last priced
 * at? Null stamp (a block authored before the stamp existed) returns false —
 * "we cannot tell" is not "it moved", and the VDOT gate still covers that
 * runner (Rule 11).
 */
export function anchorsMovedFromStamp(
  stampedAnchors: unknown,
  live: Partial<Record<'thresholdSecPerMi' | 'intervalSecPerMi' | 'repetitionSecPerMi' | 'easyCeilingSecPerMi' | 'shakeoutCeilingSecPerMi' | 'marathonSecPerMi', number | null>>,
): { moved: boolean; deltas: Array<{ key: string; from: number; to: number; delta: number }> } {
  const stamp = (stampedAnchors ?? null) as Record<string, unknown> | null;
  if (!stamp) return { moved: false, deltas: [] };
  const liveByKey: Record<string, number | null | undefined> = {
    threshold_s_per_mi: live.thresholdSecPerMi,
    interval_s_per_mi: live.intervalSecPerMi,
    repetition_s_per_mi: live.repetitionSecPerMi,
    easy_ceiling_s_per_mi: live.easyCeilingSecPerMi,
    shakeout_ceiling_s_per_mi: live.shakeoutCeilingSecPerMi,
    marathon_s_per_mi: live.marathonSecPerMi,
  };
  const deltas: Array<{ key: string; from: number; to: number; delta: number }> = [];
  for (const key of STAMPED_ANCHOR_KEYS) {
    const was = stamp[key] != null ? Number(stamp[key]) : null;
    const now = liveByKey[key] ?? null;
    if (was == null || now == null || !Number.isFinite(was) || !Number.isFinite(now)) continue;
    const delta = now - was;
    if (Math.abs(delta) >= REANCHOR_ANCHOR_DELTA_S_PER_MI) deltas.push({ key, from: was, to: now, delta });
  }
  return { moved: deltas.length > 0, deltas };
}

/**
 * Should we re-anchor? Yes when a measured read exists AND either the plan is
 * still on a provisional / calibrating anchor (one-time upgrade), or measured
 * fitness has diverged from the plan's anchor by >= the threshold.
 */
export function shouldReanchor(
  anchorSource: string | null,
  anchorVdot: number | null,
  measuredVdot: number | null,
): boolean {
  if (measuredVdot == null) return false;
  if (anchorSource !== 'measured_run') return true; // provisional / calibrating → upgrade
  if (anchorVdot == null) return true;
  return Math.abs(measuredVdot - anchorVdot) >= REANCHOR_VDOT_DELTA;
}

/**
 * The race-prep arm's gate, in the vocabulary `composePlan` persists.
 *
 * `pace_blend.season_anchor_source` / `season_anchor_provisional`
 * (`anchor-provenance.ts`) rather than `authored_state.anchorSource`, which is
 * the maintenance seeder's key and is absent on a race-prep plan. Same three
 * conditions as `shouldReanchor`, and deliberately symmetric with it:
 *
 *   · a provisional anchor upgrades on the first measurement
 *   · NO anchor recorded at all also upgrades on the first measurement
 *   · a measured anchor moves only when fitness genuinely has
 *
 * The middle case is not hypothetical. The live `apple-review@faff.run` plan —
 * the account this whole fix exists for — carries `pace_blend: null`, because it
 * was authored before the provenance column existed. It was anchored on the
 * mileage estimate all the same: nine weeks of tempo work from 8:23/mi off zero
 * recorded runs. `paceBlendAnchorIsProvisional` correctly returns false for it
 * (its contract is about what a READER may believe, and an unmarked anchor is
 * not evidence of fabrication), so without this branch that plan would get
 * neither the calibration intro — which needs a fresh authoring — nor the
 * self-heal, and would run its whole block on the invented pace.
 *
 * Upgrading it is safe in the direction that matters: a measured read is
 * strictly better information than an anchor we cannot account for, and the
 * maintenance arm has treated an absent `anchorSource` exactly this way since it
 * was written.
 */
export function shouldReanchorRacePrep(
  paceBlend: unknown,
  measuredVdot: number | null,
): boolean {
  if (measuredVdot == null) return false;
  if (paceBlendAnchorIsProvisional(paceBlend)) return true;
  const pb = (paceBlend ?? {}) as Record<string, unknown>;
  const anchor = pb.season_anchor_vdot != null ? Number(pb.season_anchor_vdot) : null;
  if (anchor == null || !Number.isFinite(anchor)) return true;  // nothing recorded → take the measurement
  return Math.abs(measuredVdot - anchor) >= REANCHOR_VDOT_DELTA;
}

/**
 * The refreshed pace + spec for one workout at the runner's canonical capacity.
 *
 * PRESCRIPTION-WIRE-1 (2026-08-31) · takes ANCHORS, not a VDOT.
 *
 * It used to derive a threshold from `tPaceFromVdot(newVdot)` and an interval
 * from `iPaceFromVdot(newVdot)` — the VDOT cascade, twice — and then let
 * `buildWorkoutSpec` derive easy, long, recovery, marathon and stride paces off
 * fixed offsets from the first of those. Every one of those five now comes from
 * the service that owns it, and this function's whole body is the plumbing.
 *
 * IT ALSO CARRIED A GOAL. `ttDistance` — the runner's stated time-trial
 * distance — decided whether they got a true Daniels I-pace or the cruise
 * default, which is the same "what race have you entered decides your interval
 * pace" gate `recomputePacesForPlan` just deleted (Constitution §7, §G). Gone
 * for the same reason; the parameter is kept only so the two live call sites and
 * the unit suite keep their shape, and nothing reads it.
 *
 * IT ALSO TAKES THE LIVE HR ANCHORS NOW (ANCHORSTAMP-1). It used to pass a
 * literal `null` for both `lthr` and `maxHr`, and it carried an argued
 * exemption in `ANCHOR_DERIVATION_SITES` for doing so. That exemption's entire
 * argument was PARITY: "this function's contract is to be identical to what the
 * seeder emits at that VDOT, so passing live anchors here while the seeder
 * passes null would FORK that parity."
 *
 * The parity is gone — this function prices off canonical capacity and the
 * seeder still prices off the cascade — so the argument that licensed the null
 * is gone with it, and the exemption is deleted rather than re-worded. A
 * `workout_spec` written with `hr_cap_bpm: null` is a row whose HR ceiling
 * describes nobody, and nothing downstream re-derives it (rendering is a READ
 * path). Rule 10's "recompute" posture, taken: the caller reads `profile.lthr`
 * raw and `loadEffectiveMaxHr`, exactly as `recomputePacesForPlan` does, so the
 * two self-heal arms write the same HR numbers for the same runner.
 *
 * Note the absent `effortCued`: a re-anchor never emits it. That is the whole
 * point — this function only runs when a measurement exists, and a measured
 * pace is exactly what the calibration intro was waiting for.
 */
export function refreshedPaceAndSpec(
  type: string,
  distanceMi: number | null,
  anchors: PrescribedPaceAnchors,
  hr?: { lthr: number | null; maxHr: number | null },
  /** Retained for call-site compatibility. Deliberately unread — see above. */
  _ttDistance?: string | null,
): { paceTargetSPerMi: number | null; spec: unknown } {
  const built = buildWorkoutSpec(
    type, distanceMi, anchors.thresholdSecPerMi,
    hr?.lthr ?? null, undefined, hr?.maxHr ?? null, null,
    anchors.intervalSecPerMi,
    anchors.thresholdSecPerMi,
    false, null,
    anchors,
  );
  return { paceTargetSPerMi: built.paceTargetSPerMi, spec: built.spec };
}

export interface ReanchorResult {
  planId: string;
  /** Which arm ran. */
  mode: 'race-prep' | 'maintenance';
  fromVdot: number | null;
  toVdot: number;
  fromSource: string | null;
  workoutsUpdated: number;
  /** Future dates skipped because a run already exists on them (Rule 15). */
  workoutsSealed: number;
  /** True when this run ended a provisional anchor rather than tracking a
   *  fitness change — i.e. it is what closed a calibration intro. */
  clearedProvisional: boolean;
}

/**
 * 2026-08-28 · the same-morning skip, recorded rather than silent.
 *
 * The 03:00 adapter and this 07:30 self-heal both write
 * `pace_target_s_per_mi`; when the adapter has already moved the anchor
 * within `ADAPTER_ANCHOR_DEFER_HOURS`, the self-heal stands down UNLESS its
 * own move is strictly more authoritative (a provisional→measured upgrade,
 * which the adapter cannot perform). The skip is returned as an explicit
 * no-op with a reason so the cron's audit trail says "deferred", never
 * nothing — `null` still means "nothing warranted a refresh".
 */
export interface ReanchorDeferral {
  planId: string;
  skipped: true;
  reason: 'deferred_to_adapter_recompute';
  windowHours: number;
}

export type ReanchorOutcome = ReanchorResult | ReanchorDeferral | null;

/** Discriminant helper for consumers of `ReanchorOutcome`. */
export function isReanchorDeferral(o: ReanchorOutcome): o is ReanchorDeferral {
  return o != null && (o as ReanchorDeferral).skipped === true;
}

/**
 * CANNOT-CONVERGE-1 (2026-09-01) · THE ARM FOR A RUNNER WITH NO MEASURED VDOT.
 *
 * `reanchorActivePlan`'s GUARD 2 used to return null here, which meant a
 * cold-start runner's plan kept whatever authoring gave it, forever. That was
 * survivable only while authoring and the flex agreed; they never did, and the
 * 2026-09-01 audit measured 6 of 7 live plans in production that had NEVER
 * been through the canonical resolvers.
 *
 * WHAT THIS DOES, AND WHAT IT REFUSES TO DO.
 *
 *   · It re-prices the block off `resolvePrescribedPaceAnchors` — the same
 *     canonical answer authoring now uses — so a plan written before
 *     AUTHORING-CANONICAL-1 converges onto one brain.
 *   · It stamps `reanchored_at` so `authoring-convergence.ts` can see that it
 *     ran, and `season_anchor_source` / `season_anchor_provisional` from the
 *     canonical THRESHOLD's own source mode. It does NOT write
 *     `'measured_vdot'` and it does NOT clear the provisional flag: nothing
 *     was measured, and saying otherwise is the laundering GUARD 2 exists to
 *     prevent.
 *   · It is a NO-OP on a plan already authored canonically. Such a plan has
 *     nothing to converge with; re-writing its rows nightly would be churn
 *     that the mutation boundary would have to fingerprint for no gain.
 *
 * RULE 23 · IT ENSURES ITS OWN PRECONDITION rather than assuming a sibling
 * job ran. It resolves the anchors itself; nothing about being late changes
 * what it does.
 */
async function reanchorOffCanonicalPrior(
  userId: string,
  today: string,
): Promise<ReanchorOutcome> {
  // `rowOrNull`, not a `.catch(() => ({rows: []}))`: a failed read and "this
  // runner has no active plan" would otherwise be the same empty, and this
  // function's whole job is to notice a plan nothing is pricing (Rule 11 ·
  // lib/db/read.ts logs the failure).
  const planRow = await rowOrNull<{
    id: string; mode: string | null; race_id: string | null;
    authored_state: Record<string, unknown> | null;
  }>(
    'reanchor-plan/canonical-prior/active-plan',
    pool.query(
      `SELECT id, mode, race_id, authored_state FROM training_plans
        WHERE user_uuid = $1 AND archived_iso IS NULL
        ORDER BY authored_iso DESC LIMIT 1`,
      [userId],
    ),
  );
  if (!planRow) return null;

  const st = (planRow.authored_state ?? {}) as Record<string, any>;

  // Already canonical at authoring — nothing to converge. Reported as a
  // deferral rather than a bare null so a caller can tell "no work needed"
  // from "no plan" (Rule 11).
  if (st.pace_authoring?.source === 'canonical') return null;

  const anchorRead = await resolvePrescribedPaceAnchors(userId, today);
  if (!anchorRead.ok) {
    console.error(
      `[reanchorPlan] canonical-prior REFUSED · plan=${planRow.id} · `
      + `anchors ${anchorRead.reason} · ${anchorRead.detail} · plan left untouched`,
    );
    return null;
  }
  const anchors = anchorRead.anchors;
  // The canonical threshold's own derived VDOT. Null for a runner outside the
  // [30,85] table, which `recomputePacesForPlan` handles: it prices from the
  // anchors and reads this only for the race-target input and the stamp.
  const priorVdot = anchors.basis.threshold.vdot;
  const sourceMode = anchors.basis.threshold.sourceMode;

  const boundary = await mutatePlan<{ workoutsUpdated: number; workoutsSealed: number } | null>({
    // AUTHORITY (2026-09-05) · this IS a coaching adaptation: it rewrites
    // prescribed paces on a live plan from the engine's own judgement, and it
    // is called from an unattended cron. Held, not exempted: the hold is
    // logged on every run and the gate fails when any field is missing.
    authority: 'COACHING_ADAPTATION',
    hold: {
      owner: 'David',
      blocker: 'the refusal has nowhere to go until reanchor raises a proposal instead of writing',
      expiresWhen: 'reanchorActivePlan creates a proposal and applies it under RUNNER_ACCEPTED',
    },
    userUuid: userId,
    source: 'reanchor-plan/canonical-prior',
    todayISO: today,
    planId: planRow.id,
    touches: 'derivations',
    detail: { to_vdot: priorVdot, source_mode: sourceMode, measured: false },
    apply: async (client) => {
      await client.query(
        `UPDATE training_plans
            SET authored_state = COALESCE(authored_state, '{}'::jsonb) || jsonb_build_object(
                  'pace_blend',
                  COALESCE(authored_state->'pace_blend', '{}'::jsonb) || $2::jsonb
                )
          WHERE id = $1`,
        [planRow.id, JSON.stringify({
          // NOT `measured_vdot`. The canonical mode is carried through as it
          // is, so a reader can see exactly how well this number is known.
          season_anchor_vdot: priorVdot,
          season_anchor_source: sourceMode,
          season_anchor_provisional: sourceMode === 'user_prior' || sourceMode === 'population_prior',
          reanchored_at: new Date().toISOString(),
          reanchored_from: 'canonical_prior',
        })],
      );
      const { recomputePacesForPlan } = await import('./recompute-paces');
      const res = await recomputePacesForPlan(planRow.id, priorVdot ?? 0, {
        source: 'reanchor_canonical_prior',
        client,
      });
      return res
        ? { workoutsUpdated: res.workoutsUpdated, workoutsSealed: res.workoutsSealed }
        : null;
    },
  });

  if (!boundary.ok || boundary.value == null) return null;
  return {
    planId: planRow.id,
    mode: (planRow.mode === 'race-prep' || planRow.race_id != null) ? 'race-prep' : 'maintenance',
    fromVdot: st.pace_blend?.season_anchor_vdot != null ? Number(st.pace_blend.season_anchor_vdot) : null,
    toVdot: priorVdot ?? 0,
    fromSource: (st.pace_blend?.season_anchor_source as string) ?? null,
    workoutsUpdated: boundary.value.workoutsUpdated,
    workoutsSealed: boundary.value.workoutsSealed,
    // Nothing was measured, so nothing ended a calibration.
    clearedProvisional: false,
  };
}

/**
 * Re-anchor a user's ACTIVE plan to their measured fitness, whatever its mode.
 *
 * No-op (returns null) when there is no active plan, no measured VDOT, or no
 * refresh is warranted. Returns a `ReanchorDeferral` when the adapter already
 * moved this anchor this morning (see the type above). Best-effort by design
 * — the cron catches per-user.
 */
export async function reanchorActivePlan(
  userId: string,
  measuredVdot: number | null,
  today: string,
  evidence?: ReanchorEvidence | null,
): Promise<ReanchorOutcome> {
  /* ── GUARD 2 · REVISED 2026-09-01 · A RUNNER WITH NO MEASURED VDOT IS NOT A
   *    RUNNER THE APP MAY LEAVE ON LEGACY PRICES FOREVER ────────────────────
   *
   * This read `if (measuredVdot == null) return null` — and the caller
   * (`snapshot-projections`) passes an EVIDENCE-ONLY `bestRecentVdot`. So a
   * runner without a qualifying measured VDOT was never reanchored: not late,
   * NEVER. The 2026-09-01 independent audit measured the consequence in
   * production — 6 of 7 live plans had never been through the canonical
   * resolvers, one of them for 24 days — and named it: "the population for
   * which authoring pace-authority actually matters most is exactly the
   * population the reanchor safety net never reaches."
   *
   * The guard's ORIGINAL reasoning is still right and is preserved: a
   * PROVISIONAL anchor must never be "upgraded" off another provisional one,
   * because that launders a guess into a measurement. What was wrong was the
   * conclusion drawn from it — that the correct response is to do nothing.
   *
   * The correct response is to price the plan HONESTLY. The canonical
   * resolvers always answer (their last rung is a prior), and every answer
   * carries its own `source_mode` and confidence, so re-pricing a cold-start
   * plan off `resolvePrescribedPaceAnchors` does not claim a measurement — it
   * replaces the legacy cascade's number with the canonical layer's number at
   * the SAME epistemic strength, correctly labelled. That is convergence
   * (Constitution §8), not an upgrade.
   *
   * `reanchorOffCanonicalPrior` is deliberately a SEPARATE function rather
   * than a null-tolerant `measuredVdot`: the measured arms stamp
   * `season_anchor_source: 'measured_vdot'` and `season_anchor_provisional:
   * false`, and a prior-priced rewrite must stamp neither. One function that
   * did both would be one `if` away from writing "measured" over a guess.
   */
  if (measuredVdot == null || !Number.isFinite(measuredVdot) || measuredVdot <= 0) {
    return reanchorOffCanonicalPrior(userId, today);
  }

  const planRow = (await pool.query<{
    id: string; mode: string | null; race_id: string | null;
    authored_state: Record<string, unknown> | null;
  }>(
    `SELECT id, mode, race_id, authored_state FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId],
  )).rows[0];
  if (!planRow) return null;

  const st = (planRow.authored_state ?? {}) as Record<string, any>;
  const isRacePrep = planRow.mode === 'race-prep' || planRow.race_id != null;

  // ── ONE ANCHOR AUTHORITY (2026-08-28) · defer to the 03:00 adapter ────────
  //
  // Is this run an UPGRADE (non-measured anchor → measured)? Race-prep reads
  // the pace_blend vocabulary, maintenance the seeder's `anchorSource` — the
  // same predicates the two arms' own gates use, evaluated here so the
  // deferral question is answered before either arm runs.
  const upgradesProvisionalAnchor = isRacePrep
    ? (paceBlendAnchorIsProvisional(st.pace_blend)
       || st.pace_blend?.season_anchor_vdot == null
       || !Number.isFinite(Number(st.pace_blend?.season_anchor_vdot)))
    : ((st.anchorSource as string | undefined) !== 'measured_run');
  if (!upgradesProvisionalAnchor) {
    const adapterMoveRecent = await adapterMovedAnchorWithin(pool, userId, ADAPTER_ANCHOR_DEFER_HOURS);
    if (selfHealShouldDefer({ upgradesProvisionalAnchor, adapterMoveRecent })) {
      // The adapter re-anchored this morning with evidence-kind context this
      // self-heal does not have (or the record could not be read, which must
      // mean the same thing). Recorded, not silent.
      console.log(
        `[reanchorPlan] deferred to adapter recompute within ${ADAPTER_ANCHOR_DEFER_HOURS}h · `
        + `plan=${planRow.id} · user=${userId.slice(0, 8)}`,
      );
      return {
        planId: planRow.id,
        skipped: true,
        reason: 'deferred_to_adapter_recompute',
        windowHours: ADAPTER_ANCHOR_DEFER_HOURS,
      };
    }
  }

  return isRacePrep
    ? reanchorRacePrep(userId, planRow.id, st, measuredVdot, today, evidence)
    : reanchorMaintenance(userId, planRow.id, st, measuredVdot, today, evidence);
}

/**
 * The race-authority fallback (`POST /api/v5/race-authority`, HARD
 * CONSTRAINT: a `compromised`/`unrepresentative` answer must move the plan to
 * the next-best anchor, not back to the pre-race paces). That is a runner's
 * deliberate, confirmed answer to a question the engine asked — not the
 * daily opportunistic self-heal — so it applies UNCONDITIONALLY: it skips
 * `shouldReanchorRacePrep`/`shouldReanchor`'s "did fitness move enough to
 * matter" gate entirely. Everything else — the sealed-day guard, the
 * plan-mutation boundary, the provenance-mark clearing, the pace-drop-event
 * stamp — is identical to the opportunistic path, because a fallback that
 * skipped any of THOSE would be a second, less-safe re-anchor mechanism.
 */
export async function forceReanchorActivePlan(
  userId: string,
  newVdot: number,
  today: string,
  evidence?: ReanchorEvidence | null,
): Promise<ReanchorResult | null> {
  if (!Number.isFinite(newVdot) || newVdot <= 0) return null;

  const planRow = (await pool.query<{
    id: string; mode: string | null; race_id: string | null;
    authored_state: Record<string, unknown> | null;
  }>(
    `SELECT id, mode, race_id, authored_state FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId],
  )).rows[0];
  if (!planRow) return null;

  const st = (planRow.authored_state ?? {}) as Record<string, any>;
  const isRacePrep = planRow.mode === 'race-prep' || planRow.race_id != null;

  return isRacePrep
    ? reanchorRacePrep(userId, planRow.id, st, newVdot, today, evidence, /* force */ true)
    : reanchorMaintenance(userId, planRow.id, st, newVdot, today, evidence, /* force */ true);
}

/** `ReanchorEvidence.source` → the vocabulary `pace-drop-event.ts` stores. */
function evidenceSourceFor(evidence: ReanchorEvidence | null | undefined): PaceZoneEvidenceSource {
  if (evidence?.source === 'race') return 'race';
  if (evidence?.source === 'run') return 'training';
  return null;
}

// ── race-prep arm ────────────────────────────────────────────────────────────

/**
 * Clear the provenance marks, THEN recompute.
 *
 * PRESCRIPTION-WIRE-1 (2026-08-31) · THE ORDER NO LONGER CHANGES ANY PACE, and
 * the clearing is kept for what it was always also doing. It used to matter
 * arithmetically: `recomputePacesForPlan` read `pace_blend.season_anchor_vdot`
 * to grade `measuredProgressFraction` — "how much of the goal gap has the runner
 * banked" — and clearing first made the new anchor the measurement itself. That
 * blend is gone; the recompute prices the block off resolved capacity and reads
 * no anchor VDOT at all.
 *
 * What the clearing still does, and why it stays FIRST: it is GUARD 3. Three
 * readers refuse an anchor marked provisional (`paceBlendAnchorIsProvisional`),
 * and a plan that has been re-anchored must stop advertising a calibration that
 * has ended before anything downstream reads it in the same transaction.
 *
 * Rule 6 · the write is a field-level jsonb merge on `pace_blend`, never a
 * full-column replace. `authored_state` has several writers with different field
 * coverage and this one knows about three keys.
 */
async function reanchorRacePrep(
  userId: string,
  planId: string,
  st: Record<string, any>,
  measuredVdot: number,
  today: string,
  evidence?: ReanchorEvidence | null,
  force = false,
): Promise<ReanchorResult | null> {
  const paceBlend = st.pace_blend ?? null;
  // The plan follows EVERY belief: reprice when the VDOT anchor moved, or
  // when any canonical anchor has drifted from the Rule 10 stamp (see
  // `REANCHOR_ANCHOR_DELTA_S_PER_MI`).
  let anchorDrift: ReturnType<typeof anchorsMovedFromStamp> = { moved: false, deltas: [] };
  if (!force && !shouldReanchorRacePrep(paceBlend, measuredVdot)) {
    // No `.catch`: the anchor read already returns a TYPED refusal for
    // "cannot price this runner", so a throw here is a failure the cron's
    // per-user handler must see rather than a silent "nothing moved"
    // (Rule 11 — the three facts).
    const liveAnchors = await resolvePrescribedPaceAnchors(userId, today);
    anchorDrift = liveAnchors.ok
      ? anchorsMovedFromStamp(st.pace_recompute?.anchors ?? null, liveAnchors.anchors)
      : { moved: false, deltas: [] };
    if (!anchorDrift.moved) return null;
    console.log(
      `[reanchor] plan=${planId} · VDOT unchanged but ${anchorDrift.deltas.length} anchor(s) drifted: `
      + anchorDrift.deltas.map((d) => `${d.key} ${d.from}→${d.to}`).join(', '),
    );
  }

  const wasProvisional = paceBlendAnchorIsProvisional(paceBlend);
  const fromVdot = paceBlend?.season_anchor_vdot != null
    ? Number(paceBlend.season_anchor_vdot) : null;
  const fromSource = (paceBlend?.season_anchor_source as string) ?? null;

  // Routed through the plan mutation boundary (lib/plan/mutate.ts) as a
  // 'derivations' mutation. A re-anchor rewrites pace_target_s_per_mi and
  // workout_spec off a new VDOT; it changes no date, no type, no distance and
  // no quality flag. The boundary fingerprints those columns before and after
  // and rolls back if the claim turns out to be false, so the declaration is
  // proven rather than trusted.
  const boundary = await mutatePlan<{ workoutsUpdated: number; workoutsSealed: number } | null>({
    // AUTHORITY (2026-09-05) · this IS a coaching adaptation: it rewrites
    // prescribed paces on a live plan from the engine's own judgement, and it
    // is called from an unattended cron. Held, not exempted: the hold is
    // logged on every run and the gate fails when any field is missing.
    authority: 'COACHING_ADAPTATION',
    hold: {
      owner: 'David',
      blocker: 'the refusal has nowhere to go until reanchor raises a proposal instead of writing',
      expiresWhen: 'reanchorActivePlan creates a proposal and applies it under RUNNER_ACCEPTED',
    },
    userUuid: userId,
    source: 'reanchor-plan/race-prep',
    todayISO: today,
    planId,
    touches: 'derivations',
    detail: { to_vdot: measuredVdot, was_provisional: wasProvisional },
    apply: async (client) => {
    // GUARD 3 · the marks this run resolves are cleared, so the plan stops
    // advertising a calibration that has ended. `jsonb ||` is a shallow merge,
    // so building the new pace_blend from the old object preserves goal_vdot,
    // build_weeks and anything a future writer adds.
    await client.query(
      `UPDATE training_plans
          SET authored_state = COALESCE(authored_state, '{}'::jsonb) || jsonb_build_object(
                'pace_blend',
                COALESCE(authored_state->'pace_blend', '{}'::jsonb) || $2::jsonb
              )
        WHERE id = $1`,
      [planId, JSON.stringify({
        season_anchor_vdot: measuredVdot,
        season_anchor_source: 'measured_vdot',
        season_anchor_provisional: false,
        reanchored_at: new Date().toISOString(),
      })],
    );
    // GUARD 1 · sealed days · owned by recomputePacesForPlan, which skips any
    // future date that already has a run and reports the count.
    const { recomputePacesForPlan } = await import('./recompute-paces');
    const res = await recomputePacesForPlan(planId, measuredVdot, {
      source: wasProvisional ? 'reanchor_calibration_end' : 'reanchor_fitness_shift',
      client,
    });
    return res
      ? { workoutsUpdated: res.workoutsUpdated, workoutsSealed: res.workoutsSealed }
      : null;
    },
  });
  if (!boundary.ok) {
    console.error(
      `[reanchorPlan] race-prep re-anchor REFUSED by the plan mutation boundary · plan=${planId} · ` +
      boundary.violations.join(' · '),
    );
    return null;
  }

  try { (await import('./lookup')).bustPlanLookupCache(userId); } catch { /* best-effort */ }

  // GET /api/v5/paces reads this days later — the whole reason it exists is
  // that nothing else durable records "the anchor just moved". Best-effort:
  // a failure here must not undo a re-anchor that already committed.
  try {
    await recordPaceZoneEvent(pool, planId, {
      fromVdot,
      toVdot: measuredVdot,
      evidenceSource: evidenceSourceFor(evidence),
      evidenceRaceSlug: evidence?.source === 'race' ? evidence.refId : null,
    });
  } catch { /* best-effort */ }

  return {
    planId,
    mode: 'race-prep',
    fromVdot,
    toVdot: measuredVdot,
    fromSource,
    workoutsUpdated: boundary.value?.workoutsUpdated ?? 0,
    workoutsSealed: boundary.value?.workoutsSealed ?? 0,
    clearedProvisional: wasProvisional,
  };
}

// ── maintenance / no-race arm ────────────────────────────────────────────────

async function reanchorMaintenance(
  userId: string,
  planId: string,
  st: Record<string, any>,
  measuredVdot: number,
  today: string,
  evidence?: ReanchorEvidence | null,
  force = false,
): Promise<ReanchorResult | null> {
  const anchorVdot = st.anchorVdot != null ? Number(st.anchorVdot) : null;
  const anchorSource = (st.anchorSource as string) ?? null;
  if (!force && !shouldReanchor(anchorSource, anchorVdot, measuredVdot)) return null;

  /* ── THE ANCHORS · one resolution for the whole plan (PRESCRIPTION-WIRE-1) ──
   *
   * Same seam and same refusal contract as `recomputePacesForPlan`, which is
   * the race-prep arm's engine. Rule 16: the two arms of one self-heal must not
   * price a runner off two different fitness reads, and before this they did —
   * race-prep went through the goal blend and maintenance through
   * `tPaceFromVdot` — so a runner switching modes changed physiology.
   *
   * Rule 11 · a refusal writes nothing and does not reach for the cascade. Note
   * this cannot fire for lack of evidence: every capacity resolver's last rung
   * is a population prior, so a genuine cold start still produces an ordered
   * set. A refusal here means the set is INCOHERENT, which is a defect worth
   * stopping for.
   */
  const anchorRead = await resolvePrescribedPaceAnchors(userId, today);
  if (!anchorRead.ok) {
    console.error(
      `[reanchorPlan] maintenance REFUSED · plan=${planId} · anchors ${anchorRead.reason} · `
      + `${anchorRead.detail} · plan left untouched`,
    );
    return null;
  }
  const anchors = anchorRead.anchors;

  /* ── THE HR ANCHORS, READ LIVE (ANCHORSTAMP-1) ────────────────────────────
   *
   * The same two reads `recomputePacesForPlan` makes, for the same reasons and
   * with the same subtleties:
   *
   *   · `profile.lthr` RAW, not through `resolveThresholdHr`. That resolver's
   *     second rung crosswalks a threshold out of HRmax, which is right for a
   *     display surface that can label a number as estimated and wrong here,
   *     because the value lands in `workout_spec.lthr_bpm` where the watch reads
   *     it as measured. A row we READ decides even when its `lthr` is null; only
   *     an unreadable profile leaves it absent.
   *   · `loadEffectiveMaxHr`, the canonical resolver, never `users.max_hr` —
   *     that column is a nightly ratchet mirror that never falls.
   */
  // `rowOrNull` returns THREE states — a row, `undefined` for a read that
  // matched nothing, and `null` for a read that FAILED — which is the only
  // reason this is not a bare `.catch(() => null)`. Rule 11: "no profile row"
  // and "could not reach the profile table" are different facts, and the second
  // one is worth a line in the log rather than a silently HR-less block.
  const lthrRow = await rowOrNull<{ lthr: number | null }>(
    'reanchor-plan/profile-lthr',
    pool.query(`SELECT lthr FROM profile WHERE user_uuid = $1 LIMIT 1`, [userId]),
  );
  if (lthrRow === null) {
    console.warn(
      `[reanchorPlan] profile.lthr unreadable · plan=${planId} · every rewritten spec will carry `
      + 'no threshold HR. The easy cap falls back to its HRmax arm, which is the tighter branch.',
    );
  }
  const lthr = lthrRow != null && lthrRow.lthr != null ? Number(lthrRow.lthr) : null;
  const maxHr = await loadEffectiveMaxHr(userId, today).then((r) => r.bpm).catch(() => null);

  // Future, pace-bearing workouts only — rest/cross/strength carry no pace
  // target and are exempt from the workout_spec CHECK.
  //
  // PRESCRIPTION-WIRE-1 · `shakeout` left this exclusion, in step with
  // `RECOMPUTE_EXEMPT_TYPES`. It does carry a pace band, and it now takes
  // doctrine's recovery ceiling. The two arms must exclude the same set or a
  // runner's shakeout would be current in one mode and frozen in the other.
  //
  // GUARD 1 · sealed days. This arm used to rewrite every row dated >= today,
  // including today's, which the runner may already have run — the race-prep
  // arm has honoured Rule 15 since it was written and this one did not. Same
  // EXISTS predicate as `recomputePacesForPlan` and `adapt.ts`
  // filterUnsealedWorkouts: a date with a non-merged run on it is immutable.
  const wkos = (await pool.query<{ id: string; type: string; distance_mi: string | null; sealed: boolean }>(
    `SELECT pw.id, pw.type, pw.distance_mi,
            EXISTS (
              SELECT 1 FROM runs r
               WHERE r.user_uuid = $3::uuid
                 AND ${runDaySql('r')}::date = pw.date_iso::date
                 AND ${runNotMergedSql('r')}
            ) AS sealed
       FROM plan_workouts pw
      WHERE pw.plan_id = $1 AND pw.date_iso >= $2
        AND pw.type NOT IN ('rest','cross','strength')`,
    [planId, today, userId],
  )).rows;

  // Same 'derivations' declaration as the race-prep arm above — paces and specs
  // only — proven by the boundary's structural fingerprint.
  let updated = 0;
  let sealedCount = 0;
  const boundary = await mutatePlan<void>({
    // AUTHORITY (2026-09-05) · this IS a coaching adaptation: it rewrites
    // prescribed paces on a live plan from the engine's own judgement, and it
    // is called from an unattended cron. Held, not exempted: the hold is
    // logged on every run and the gate fails when any field is missing.
    authority: 'COACHING_ADAPTATION',
    hold: {
      owner: 'David',
      blocker: 'the refusal has nowhere to go until reanchor raises a proposal instead of writing',
      expiresWhen: 'reanchorActivePlan creates a proposal and applies it under RUNNER_ACCEPTED',
    },
    userUuid: userId,
    source: 'reanchor-plan/maintenance',
    todayISO: today,
    planId,
    touches: 'derivations',
    detail: { to_vdot: measuredVdot, rows: wkos.length },
    apply: async (client) => {
    for (const w of wkos) {
      if (w.sealed) { sealedCount++; continue; }
      const { paceTargetSPerMi, spec } = refreshedPaceAndSpec(
        w.type, w.distance_mi != null ? Number(w.distance_mi) : null, anchors,
        { lthr, maxHr },
      );
      await client.query(
        // Rule 6 · a maintenance re-anchor rewrites the same session's paces;
        // the trajectory's shape survives it.
        `UPDATE plan_workouts SET pace_target_s_per_mi = $1,
                workout_spec = ${preserveProgressionSql('$2')} WHERE id = $3`,
        [paceTargetSPerMi, spec ? JSON.stringify(spec) : null, w.id],
      );
      updated++;
    }
    // GUARD 3 · the calibration marks this arm owns.
    //
    // PRESCRIPTION-WIRE-1 · `tPaceSec`/`iPaceSec` are what the seeder reads back
    // when it rebuilds this plan, so they must be the numbers the rows were
    // ACTUALLY written at. They used to be re-derived here off `measuredVdot` —
    // a second derivation of a quantity the rows had already been priced from,
    // which is precisely the drift Rule 16 is about. They are now copied from
    // the anchor set the loop above spent, so the state and the rows cannot
    // disagree. `pace_anchors` records the whole set beside them (Rule 10's
    // stamp: a persisted derived value carries its anchor).
    const newState = {
      ...st,
      anchorVdot: measuredVdot,
      anchorSource: 'measured_run',
      tPaceSec: anchors.thresholdSecPerMi,
      iPaceSec: anchors.intervalSecPerMi,
      pace_anchors: {
        at: new Date().toISOString(),
        threshold_s_per_mi: anchors.thresholdSecPerMi,
        interval_s_per_mi: anchors.intervalSecPerMi,
        repetition_s_per_mi: anchors.repetitionSecPerMi,
        easy_ceiling_s_per_mi: anchors.easyCeilingSecPerMi,
        shakeout_ceiling_s_per_mi: anchors.shakeoutCeilingSecPerMi,
        marathon_s_per_mi: anchors.marathonSecPerMi,
        basis: anchors.basis,
        model: 'prescription_resolver',
      },
      calibrating: false,
      reanchored_at: today,
    };
    await client.query(
      `UPDATE training_plans SET authored_state = $1 WHERE id = $2`,
      [JSON.stringify(newState), planId],
    );
    },
  });
  if (!boundary.ok) {
    console.error(
      `[reanchorPlan] maintenance re-anchor REFUSED by the plan mutation boundary · plan=${planId} · ` +
      boundary.violations.join(' · '),
    );
    return null;
  }

  try { (await import('./lookup')).bustPlanLookupCache(userId); } catch { /* best-effort */ }

  // Same durable stamp as the race-prep arm — best-effort, never undoes a
  // re-anchor that already committed.
  try {
    await recordPaceZoneEvent(pool, planId, {
      fromVdot: anchorVdot,
      toVdot: measuredVdot,
      evidenceSource: evidenceSourceFor(evidence),
      evidenceRaceSlug: evidence?.source === 'race' ? evidence.refId : null,
    });
  } catch { /* best-effort */ }

  return {
    planId,
    mode: 'maintenance',
    fromVdot: anchorVdot,
    toVdot: measuredVdot,
    fromSource: anchorSource,
    workoutsUpdated: updated,
    workoutsSealed: sealedCount,
    clearedProvisional: anchorSource !== 'measured_run',
  };
}
