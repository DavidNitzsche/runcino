/**
 * lib/race/race-row-refresh.ts · the dedicated canonical path that keeps a
 * plan's RACE rows current with the race-pace brain.
 *
 * 2026-09-01 · P0. `recompute-paces.ts` carried `race` in its permanent
 * exemption list, so the owner's CIM race row froze at the pace it was
 * authored with (7:16/mi) while every marathon-pace rehearsal in the same
 * block moved with the evidence (7:55/mi). A race row is not a training
 * row — its pace is not a threshold offset — so the generic recompute is
 * the wrong tool. But "not that tool" was implemented as "never", and never
 * is how the runner ends up on a start line holding a number the brain
 * abandoned months earlier.
 *
 * This is the right tool. For each unsealed race row in the plan it
 * resolves `RaceOutlook` for that race and writes, field-level (Rule 6):
 *
 *   pace_target_s_per_mi           = outlook.execution.paceSecPerMi
 *   workout_spec.pace_target_*     = execution band (±5, the same band
 *                                    spec-builder's race branch authors)
 *   workout_spec.race_execution    = {target_sec, source, expected_sec,
 *                                    likely_range_sec, stated_goal_sec, …}
 *   workout_spec.race_hr           = the evidence-backed HR guidance
 *                                    (expected range / early ceiling /
 *                                    late allowance / bail / informational)
 *   workout_spec.hr_cap_bpm        REMOVED. A race has no "cap" the wrist
 *                                    should alarm on for 26 miles; the
 *                                    guidance object carries its own
 *                                    checkpoint-abort figure instead.
 *
 * Sealed rows (a run already exists on that date) are never touched. A row
 * whose outlook cannot resolve is REFUSED by name, never written with a
 * fallback — Rule 11.
 *
 * Callers: `recomputePacesForPlan` (every pace recompute), the daily
 * `snapshot-projections` cron, and authoring after persist.
 */
import { pool } from '@/lib/db/pool';
import type { PoolClient } from 'pg';

/** Anything with `query` · the pool, a PoolClient, or a transaction handle. */
export type Queryable = Pick<PoolClient, 'query'>;
import { runnerToday } from '@/lib/runtime/runner-tz';
import { runDaySql, runNotMergedSql } from '@/lib/runs/run-shape';
import { resolveRaceOutlook, loadRaceForOutlook, RACE_EXECUTION_BAND_S_PER_MI, type RaceOutlook, type RaceForOutlook } from './race-outlook';
import { MEANINGFUL_MOVE_SEC } from '@/lib/training/projection-trend';
import { racePaceAbortRule } from '@/lib/race/distance-doctrine';
// ROW-CONTRACT-1 · the contract this path is required to leave the row in, and
// the one owner of "which pace a tune-up's reps are prescribed at".
import { raceRowContractViolations, describeViolations, type RaceRowContractView } from '@/lib/race/race-row-contract';
import { repriceRaceNote, type RaceTargetVoice } from '@/lib/race/race-row-note';
import { tuneupPaceAnchor } from '@/lib/plan/spec-builder';

export interface RaceRowRefreshResult {
  planId: string;
  userUuid: string;
  todayISO: string;
  rows: Array<{
    id: string;
    dateISO: string;
    slug: string | null;
    action: 'updated' | 'unchanged' | 'sealed' | 'refused';
    reason?: string;
    before: { paceSecPerMi: number | null };
    after: { paceSecPerMi: number | null } | null;
    outlook?: {
      statedGoalSec: number | null;
      expectedSec: number | null;
      likelyRangeSec: readonly [number, number] | null;
      targetSec: number | null;
      source: RaceOutlook['execution']['source'];
    };
  }>;
  updated: number;
  refused: number;
}

interface RaceRow {
  id: string;
  date_iso: string;
  type: string;
  pace_target_s_per_mi: string | number | null;
  distance_mi: string | number | null;
  workout_spec: Record<string, unknown> | null;
  /** ROW-CONTRACT-1 · the prose and the chip title are part of the contract,
   *  so the refresh reads them rather than writing past them. */
  notes: string | null;
  sub_label: string | null;
  sealed: boolean;
}

/** The race row's slug: the race on the runner's calendar dated that day,
 *  else the plan's own race, else null (refused — never guessed). */
async function raceSlugForRow(
  client: Queryable,
  userUuid: string,
  planId: string,
  dateISO: string,
): Promise<string | null> {
  const byDate = (await client.query<{ slug: string }>(
    `SELECT slug FROM races
      WHERE user_uuid = $1::uuid AND LEFT(meta->>'date', 10) = $2
      ORDER BY (CASE UPPER(COALESCE(meta->>'priority','')) WHEN 'A' THEN 0 WHEN 'B' THEN 1 ELSE 2 END)
      LIMIT 1`,
    [userUuid, dateISO],
  )).rows[0];
  if (byDate) return byDate.slug;
  const plan = (await client.query<{ slug: string | null }>(
    `SELECT COALESCE(authored_state->>'race_slug', authored_state->'detail'->>'race_slug') AS slug
       FROM training_plans WHERE id = $1`,
    [planId],
  )).rows[0];
  return plan?.slug ?? null;
}

async function planRaceSlug(client: Queryable, planId: string): Promise<string | null> {
  const plan = (await client.query<{ slug: string | null }>(
    `SELECT COALESCE(authored_state->>'race_slug', authored_state->'detail'->>'race_slug', race_id) AS slug
       FROM training_plans WHERE id = $1`,
    [planId],
  )).rows[0];
  return plan?.slug ?? null;
}

/**
 * B2 (2026-09-02) · THE ROW'S PACE-ADRIFT ABORT IS REPRICED WITH THE TARGET.
 *
 * `spec-builder` authors the rule from the authoring seed. This path rewrites
 * the target and, before this function existed, did NOT rewrite the rule — so
 * the row shipped the two anchored to different numbers. Verified on the
 * owner's production CIM row 2026-09-02: `pace_target_s_per_mi 443` beside
 * `"pace slower than 7:38/mi" (458)`, 458 being `round(1.05 × 436)` off the
 * authoring seed the brain had already replaced. Correct is 465.
 *
 * Every rule the race path does not own survives untouched (Rule 6 in the
 * jsonb array's own terms). If the outlook has no execution pace the rule is
 * DROPPED rather than left standing on an abandoned anchor — an abort with no
 * owner is not a conservative default, it is an invented number (Rule 11).
 */
export function rulesRepricedTo(
  existing: unknown,
  o: RaceOutlook,
  distanceMi: number | null,
): Array<Record<string, unknown>> {
  const kept = Array.isArray(existing)
    ? (existing as unknown[]).filter((r): r is Record<string, unknown> => {
        if (r == null || typeof r !== 'object') return false;
        const x = r as Record<string, unknown>;
        return !(x.kind === 'abort' && x.metric === 'pace');
      })
    : [];
  const repriced = racePaceAbortRule({
    distanceMi,
    targetPaceSecPerMi: o.execution.paceSecPerMi,
  });
  // Always an array, never null-for-empty. An empty list says "this path owns
  // the field and there is nothing in it", which is a different fact from a
  // missing field, and collapsing the two is exactly Rule 11's shape.
  return repriced != null ? [...kept, { ...repriced }] : kept;
}

/**
 * 2026-09-02 · A MATERIAL CHANGE IS RECORDED, NOT SLIPPED IN. The refresh
 * rewrites what the runner is told to run on the day. A move inside the noise
 * band is housekeeping; a move past `MEANINGFUL_MOVE_SEC` — the same threshold
 * the projection-changed notification uses, so one runner cannot be told a
 * projection moved and a target did not for the same number of seconds — is
 * something the runner is entitled to see, carried on the row itself as
 * `previous_target_sec` + `material_change` for the race detail to say
 * "this moved". It is REPORTED. Nothing here asks the runner to decide
 * anything, and the stated goal is untouched.
 */
export function raceExecutionSpecFields(
  o: RaceOutlook,
  previous?: { target_sec?: unknown } | null,
  row?: { rules?: unknown; distanceMi?: number | null },
): Record<string, unknown> {
  const x = o.execution;
  const pace = x.paceSecPerMi;
  return {
    ...(pace != null
      ? { pace_target_s_per_mi_lo: pace - RACE_EXECUTION_BAND_S_PER_MI, pace_target_s_per_mi_hi: pace + RACE_EXECUTION_BAND_S_PER_MI }
      : {}),
    ...(row !== undefined
      ? { rules: rulesRepricedTo(row.rules, o, row.distanceMi ?? o.race.distanceMi) }
      : {}),
    race_execution: {
      model_version: o.modelVersion,
      resolved_at: o.resolvedAt,
      target_sec: x.targetSec,
      previous_target_sec: typeof previous?.target_sec === 'number' ? previous.target_sec : null,
      material_change: typeof previous?.target_sec === 'number' && x.targetSec != null
        ? Math.abs(x.targetSec - previous.target_sec) >= MEANINGFUL_MOVE_SEC
        : false,
      evidence_age_days: o.staleness.evidenceAgeDays,
      evidence_stale: o.staleness.stale,
      target_pace_s_per_mi: pace,
      source: x.source,
      stated_goal_sec: o.statedGoal.sec,
      current_projection_sec: o.currentProjection.expectedSec,
      expected_race_day_sec: o.expectedRaceDay.expectedSec,
      likely_range_sec: o.expectedRaceDay.likelyRangeSec,
      expected_gain_vdot: o.expectedImprovement.gainVdot,
      training_pace_s_per_mi: o.trainingPrescription.paceSecPerMi,
      threshold_s_per_mi: o.capacity.thresholdSecPerMi,
      threshold_vdot: o.capacity.thresholdVdot,
      durability_exponent: o.capacity.durabilityExponent,
      feasibility: o.goalFeasibility.status,
      reason: x.reasonVsExpected,
    },
    race_hr: x.hr
      ? {
          lthr_bpm: x.hr.lthrBpm,
          expected_range_bpm: x.hr.expectedRangeBpm,
          early_ceiling_bpm: x.hr.earlyCeilingBpm,
          early_through_mi: x.hr.earlyThroughMi,
          late_allowance_bpm: x.hr.lateAllowanceBpm,
          checkpoint_mi: x.hr.checkpointMi,
          checkpoint_abort_bpm: x.hr.checkpointAbortBpm,
          informational_only: x.hr.informationalOnly,
          evidence: {
            comparable_efforts: x.hr.evidence.comparableEfforts,
            observed_mean_hr: x.hr.evidence.observedMeanHr,
            conflict_bpm: x.hr.evidence.conflictBpm,
          },
          reasons: x.hr.reasons,
        }
      : null,
  };
}

/**
 * ROW-CONTRACT-1 (2026-09-02) · THE COMPLETE WRITE FOR ONE RACE ROW, DECIDED
 * IN ONE PLACE.
 *
 * The rule the owner stated: *"A refresh must update the complete workout
 * contract atomically, not one number inside an incompatible structure."*
 *
 * Before this function the loop composed a pace here, a spec fragment there,
 * and left `notes`, `rep_pace_s_per_mi` and the row's own session type alone.
 * Four measured defects, all the same shape. Now there is one function, it is
 * PURE, and the caller applies what it returns without adding anything.
 *
 * ── THE TWO KINDS OF ROW IT ANSWERS FOR ─────────────────────────────────
 *
 * **A race day.** Gets the full execution contract: the target, the ±5 s/mi
 * band, `race_execution`, `race_hr`, the repriced mid-race abort, and the
 * target sentence in its prose repriced to match. `hr_cap_bpm` is dropped —
 * a race has no ceiling the wrist should alarm on for 26 miles.
 *
 * **A race-week tune-up.** A tune-up is a TRAINING session that happens to sit
 * in race week, and only some of them are run at race pace. `tuneupPaceAnchor`
 * is the one owner of that question, in `spec-builder`, where the pace is
 * chosen. When the reps ARE at race pace, both the reps and the headline move
 * together and the row stays coherent. When they are not — the marathon
 * sharpener is 5×400m at 5K pace, deliberately faster than race pace — this
 * path has nothing to say about the row and says nothing, by name.
 *
 * What it never does again is give a tune-up a race's clothes: no
 * `race_execution` describing a different day, no `race_hr` band computed for
 * 26.2 miles sitting on 4.5, and no "Mile 2 check · switch to the B plan" on a
 * session of 400s. Those keys are DROPPED from a tune-up rather than merely
 * not written, because rows in production are already carrying them.
 *
 * ── WHY IT RETURNS DROPS RATHER THAN A WHOLE SPEC ───────────────────────
 *
 * Rule 6. `workout_spec` has several writers with different field coverage,
 * and a full-replace upsert silently erases what the active writer does not
 * know about. So the contract is expressed as "remove exactly these keys, then
 * merge exactly these" and the SQL applies it field-level.
 */
export interface RaceRowWrite {
  paceTargetSecPerMi: number;
  /** Keys this write REMOVES from `workout_spec` before merging. */
  specDrops: string[];
  /** Keys this write merges in. */
  specFields: Record<string, unknown>;
  /** The repriced note, or null to leave `notes` exactly as it stands. */
  notes: string | null;
  /** True when the row already satisfies the contract at this pace, so the
   *  UPDATE would be a no-op. Reported rather than written (Rule 11: an
   *  unchanged row and a skipped row are different facts). */
  unchanged: boolean;
}

/** A row's contract view, straight off the columns. */
export function contractRowOf(row: {
  type: string;
  distance_mi: string | number | null;
  pace_target_s_per_mi: string | number | null;
  workout_spec: Record<string, unknown> | null;
  notes: string | null;
  sub_label: string | null;
}): RaceRowContractView {
  return {
    type: row.type,
    distanceMi: row.distance_mi != null ? Number(row.distance_mi) : null,
    paceTargetSecPerMi: row.pace_target_s_per_mi != null ? Number(row.pace_target_s_per_mi) : null,
    spec: row.workout_spec ?? null,
    notes: row.notes,
    subLabel: row.sub_label,
  };
}

/** The row as it would stand after this write. The projection the atomicity
 *  check runs on, and the same arithmetic the SQL performs — drop, then
 *  merge — so the check sees what the database will. */
export function applyWriteToRow(row: RaceRowContractView, write: RaceRowWrite): RaceRowContractView {
  const spec: Record<string, unknown> = { ...(row.spec ?? {}) };
  for (const k of write.specDrops) delete spec[k];
  Object.assign(spec, write.specFields);
  return {
    ...row,
    paceTargetSecPerMi: write.paceTargetSecPerMi,
    spec,
    notes: write.notes ?? row.notes,
  };
}

/** Keys a refreshed RACE row must not keep. `hr_cap_bpm` because a race has no
 *  wrist alarm; the two execution blocks because they are rewritten whole and
 *  a merge would leave a stale sub-key behind. */
const RACE_SPEC_DROPS = ['hr_cap_bpm', 'race_execution', 'race_hr'] as const;
/**
 * Keys a refreshed TUNE-UP must not keep: the race-day clothes it was given by
 * the version of this path that treated every tune-up as a rehearsal.
 *
 * The two execution blocks describe the RACE — a marathon's HR band, checkpoint
 * and target, sitting on a 4.5-mile session of 400s. The band keys are the same
 * defect one level down: `pace_target_s_per_mi_lo/hi` is the race's ±5 s/mi
 * execution window, and once the headline is restored to the session's own rep
 * pace a band centred 42 s/mi away is a second wrong number, not a leftover.
 *
 * The list grew by two when the coherence gate was first run against this fix
 * and failed it. That is the gate doing its job on its own author.
 */
const TUNEUP_SPEC_DROPS = [
  'race_execution', 'race_hr', 'pace_target_s_per_mi_lo', 'pace_target_s_per_mi_hi',
] as const;

/**
 * The row's rules with every mid-race pace abort removed.
 *
 * A "Mile 2 check · switch to the B plan" belongs to a start line. On a tune-up
 * it is priced off a target that is not the session's pace and names a
 * checkpoint the session may not reach. `rulesRepricedTo` strips the same rule
 * for a race row before re-adding a correctly priced one; this is the strip
 * without the re-add, and the two share the predicate rather than each carrying
 * their own idea of which rule is the race's.
 */
/** The session's own rep pace, or nothing. Guards rather than
 *  `x > 0 ? x : null`, for the reason `effective-race-target.ts` gives: a rep
 *  pace of zero is invalid input, not a measured zero, and the collapsing
 *  shape should stay rare enough that the scanner's findings mean something. */
function repPaceOrNone(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (v <= 0) return null;
  return v;
}

function rulesWithoutRaceAborts(existing: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(existing)) return null;
  const kept = (existing as unknown[]).filter((r): r is Record<string, unknown> => {
    if (r == null || typeof r !== 'object') return false;
    const x = r as Record<string, unknown>;
    return !(x.kind === 'abort' && x.metric === 'pace');
  });
  return kept.length === existing.length ? null : kept;
}

/**
 * ROW-CONTRACT-1 · THE ATOMICITY CHECK, AND IT LIVES IN THE DECIDER.
 *
 * Every return path of `raceRowWrite` goes through here. It projects the row as
 * it would stand once the write lands and hands it to the contract checker; a
 * write that would leave the prose naming one pace and the column carrying
 * another comes back as a REFUSAL, not as a write the caller is trusted to
 * validate afterwards.
 *
 * Placed here rather than at the call site on purpose, and the first version of
 * this fix got that wrong. The check sat in the refresh loop, and switching it
 * off left every assertion in the coherence gate passing — because they were
 * reading the source for the string `CONTRACT_INCOHERENT` rather than
 * exercising the behaviour. That is precisely the tamper-check any comment
 * satisfies, which Rule 18 already caught once in this repo. Found by running
 * the falsifier.
 */
function coherentOrRefused(
  row: RaceRowContractView,
  write: RaceRowWrite,
): RaceRowWrite | { refused: string } {
  const violations = raceRowContractViolations(applyWriteToRow(row, write));
  if (violations.length === 0) return write;
  return { refused: `CONTRACT_INCOHERENT · ${describeViolations(violations)}` };
}

export function raceRowWrite(args: {
  row: RaceRowContractView;
  outlook: RaceOutlook;
}): RaceRowWrite | { refused: string } {
  const { row, outlook } = args;
  const pace = outlook.execution.paceSecPerMi;
  if (pace == null || !Number.isFinite(pace) || pace <= 0) return { refused: 'OUTLOOK_UNAVAILABLE' };
  const spec = row.spec ?? {};

  // Whose number this is, from the owner's own verdict rather than a second
  // reading of the goal. A target that IS the stated goal is the runner's;
  // anything the runway bounded or the projection set is the coach's.
  // EXECTARGET-1 (2026-09-03) · the execution target no longer reads the stated
  // goal at all (Q7: "3:13:30 must not be labelled the current execution target
  // merely because it is the fast edge of a wide range"), so every target this
  // row can carry is the coach's. The runner's number is echoed beside it as
  // `statedGoal` and is never overwritten.
  const voice: RaceTargetVoice = 'coach';

  if (row.type === 'race') {
    const prevExec = (spec.race_execution ?? null) as { target_sec?: number } | null;
    const fields = raceExecutionSpecFields(outlook, prevExec, {
      rules: spec.rules,
      distanceMi: row.distanceMi ?? outlook.race.distanceMi,
    });
    const notes = repriceRaceNote(row.notes, pace, voice);
    const unchanged =
      row.paceTargetSecPerMi === pace
      && prevExec?.target_sec === outlook.execution.targetSec
      && !('hr_cap_bpm' in spec)
      && spec.race_hr != null
      && notes == null
      // B2 · a row whose target is right but whose pace abort is still priced
      // off an abandoned anchor is NOT unchanged. Without this clause the
      // repricing would never land on the rows that need it most — the ones
      // where the target already settled and only the rule stayed behind.
      && JSON.stringify(fields.rules ?? null) === JSON.stringify(spec.rules ?? null);
    return coherentOrRefused(row, {
      paceTargetSecPerMi: pace,
      specDrops: [...RACE_SPEC_DROPS],
      specFields: fields,
      notes,
      unchanged,
    });
  }

  // A race-week tune-up. `tuneupPaceAnchor` reads the prescription the spec
  // was built from — the authored label when the branch kept one, else the
  // chip title the spec derived.
  const prescription = (typeof spec.label === 'string' ? spec.label : null) ?? row.subLabel;
  const anchor = tuneupPaceAnchor(prescription);
  if (anchor !== 'race_pace') {
    // Rule 11 · a named skip, not silence. This row's PACE belongs to
    // `recompute-paces`, which prices training sessions off the runner's own
    // anchors; imposing the race target on it is what produced a 7:23/mi
    // headline over 6:41 reps.
    //
    // But the row must still be left COHERENT, and in production it already is
    // not: rows written by the version of this path that treated every tune-up
    // as a rehearsal are carrying the marathon target as their headline and a
    // marathon HR band. So the headline is restored to the session's OWN pace,
    // which is what `buildWorkoutSpec` returned for it (`paceTargetSPerMi:
    // repPace`), and the race clothes are removed. Healing the rows this path
    // broke is this path's job; a refresh that could only refuse them would
    // leave every existing block wrong for the life of the block.
    const headline = repPaceOrNone(spec.rep_pace_s_per_mi) ?? row.paceTargetSecPerMi;
    if (headline == null) return { refused: 'TUNEUP_HAS_NO_PACE_OF_ITS_OWN' };
    const strippedRules = rulesWithoutRaceAborts(spec.rules);
    return coherentOrRefused(row, {
      paceTargetSecPerMi: headline,
      specDrops: [...TUNEUP_SPEC_DROPS],
      specFields: strippedRules == null ? {} : { rules: strippedRules },
      notes: null,
      unchanged: headline === row.paceTargetSecPerMi
        && strippedRules == null
        && !TUNEUP_SPEC_DROPS.some((k) => spec[k] != null),
    });
  }

  // A tune-up whose reps ARE at race pace. Both halves move, together — which
  // is the whole of the rule: the headline the runner reads and the reps the
  // watch paces cannot be two different numbers. It is still a training
  // session, so it takes no race band and no mid-race abort.
  const strippedRules = rulesWithoutRaceAborts(spec.rules);
  const notes = repriceRaceNote(row.notes, pace, voice);
  const unchanged = row.paceTargetSecPerMi === pace
    && Number(spec.rep_pace_s_per_mi) === pace
    && strippedRules == null
    && notes == null
    && !TUNEUP_SPEC_DROPS.some((k) => spec[k] != null);
  return coherentOrRefused(row, {
    paceTargetSecPerMi: pace,
    specDrops: [...TUNEUP_SPEC_DROPS],
    specFields: { rep_pace_s_per_mi: pace, ...(strippedRules == null ? {} : { rules: strippedRules }) },
    notes,
    unchanged,
  });
}

/**
 * Refresh every unsealed race row of a plan. Runs inside the caller's
 * transaction when one is passed (recompute-paces hands its `tx`), else on
 * the pool. Never throws for a single row — each row reports its own action.
 */
export async function refreshRaceRowsForPlan(
  planId: string,
  opts?: { client?: Queryable; todayISO?: string; source?: string },
): Promise<RaceRowRefreshResult | null> {
  const plan = (await (opts?.client ?? pool).query<{ user_uuid: string }>(
    `SELECT user_uuid::text AS user_uuid FROM training_plans WHERE id = $1`, [planId],
  )).rows[0];
  if (!plan) return null;
  const userUuid = plan.user_uuid;
  const today = opts?.todayISO ?? await runnerToday(userUuid);
  if (opts?.client) {
    // Inside another batch (recompute-paces hands its transaction): the
    // caller's mutatePlan boundary already covers this write.
    return refreshRaceRowsCore(opts.client, planId, userUuid, today, opts?.source);
  }
  // Standalone (the daily cron, authoring's post-persist call): every plan
  // write goes through the plan mutation boundary — it is a derivation
  // rewrite, the same declaration recompute-paces makes.
  const { mutatePlan } = await import('@/lib/plan/mutate');
  const boundary = await mutatePlan<RaceRowRefreshResult | null>({
    userUuid,
    source: `race-row-refresh/${opts?.source ?? 'standalone'}`,
    todayISO: today,
    planId,
    touches: 'derivations',
    detail: { path: 'race-row-refresh' },
    apply: async (tx) => refreshRaceRowsCore(tx, planId, userUuid, today, opts?.source),
  });
  if (!boundary.ok) {
    console.error(`[refreshRaceRowsForPlan] REFUSED by the plan mutation boundary · plan=${planId} · ${boundary.violations.join(' · ')}`);
    return null;
  }
  return boundary.value ?? null;
}

/**
 * B2 (2026-09-02) · THE AUTHORING SEED, RESOLVED BY THE OWNER.
 *
 * `composePlan` used to seed the race row from `achievableRaceTarget` and
 * persist that number on `authored_state.prescribed_race_pace`, which
 * `persistComposedPlan` then read BACK as the seed. Two records of one
 * quantity: on the owner's plan, `authored_state` said 436 s/mi (11430 s,
 * `ceiling_vdot 47.1`) while the race row said 443 s/mi (11610 s) — 180
 * seconds apart, and which one the runner saw depended on whether the
 * refresh had run since authoring (Rule 23 on top of Rule 16).
 *
 * The seed now comes from the same owner that writes the row moments later,
 * so the two cannot disagree and the refresh reports `unchanged`.
 * `race-outlook` reads no plan data, so resolving it before the plan is
 * persisted gives the identical answer the post-persist refresh will.
 *
 * THREE STATES, never one (Rule 11): a pace, an explicit "no race to price"
 * and an explicit failure. A caller that cannot tell them apart would seed a
 * refusal as a number, which is the defect this closes.
 */
export type AuthoringRaceSeed =
  | { ok: true; paceSecPerMi: number; targetSec: number | null; source: RaceOutlook['execution']['source'] }
  | { ok: false; reason: 'NO_RACE' | 'OUTLOOK_UNAVAILABLE' | 'READ_FAILED'; detail?: string };

export async function resolveAuthoringRaceSeed(
  userUuid: string,
  slug: string | null | undefined,
  todayISO: string,
): Promise<AuthoringRaceSeed> {
  if (!slug) return { ok: false, reason: 'NO_RACE' };
  let race: RaceForOutlook | null;
  try {
    race = await loadRaceForOutlook(userUuid, slug, todayISO);
  } catch (e) {
    return { ok: false, reason: 'READ_FAILED', detail: (e as Error).message };
  }
  if (!race || !(race.distanceMi > 0)) return { ok: false, reason: 'NO_RACE' };
  let outlook: RaceOutlook;
  try {
    outlook = await resolveRaceOutlook(userUuid, race, todayISO);
  } catch (e) {
    return { ok: false, reason: 'READ_FAILED', detail: (e as Error).message };
  }
  const pace = outlook.execution.paceSecPerMi;
  if (pace == null || !Number.isFinite(pace) || pace <= 0) {
    return { ok: false, reason: 'OUTLOOK_UNAVAILABLE' };
  }
  return { ok: true, paceSecPerMi: pace, targetSec: outlook.execution.targetSec, source: outlook.execution.source };
}

async function refreshRaceRowsCore(
  client: Queryable,
  planId: string,
  userUuid: string,
  today: string,
  source: string | undefined,
): Promise<RaceRowRefreshResult> {

  const rows = (await client.query<RaceRow>(
    `SELECT pw.id::text AS id, pw.date_iso::text AS date_iso, pw.type, pw.pace_target_s_per_mi, pw.distance_mi, pw.workout_spec,
            pw.notes, pw.sub_label,
            EXISTS (
              SELECT 1 FROM runs r
               WHERE r.user_uuid = $2::uuid
                 AND ${runDaySql('r')}::date = pw.date_iso::date
                 AND ${runNotMergedSql('r')}
            ) AS sealed
       FROM plan_workouts pw
      WHERE pw.plan_id = $1 AND pw.type IN ('race', 'race_week_tuneup')
      ORDER BY pw.date_iso::date ASC`,
    [planId, userUuid],
  )).rows;

  const result: RaceRowRefreshResult = { planId, userUuid, todayISO: today, rows: [], updated: 0, refused: 0 };
  for (const row of rows) {
    const before = { paceSecPerMi: row.pace_target_s_per_mi != null ? Number(row.pace_target_s_per_mi) : null };
    if (row.sealed || row.date_iso < today) {
      result.rows.push({ id: row.id, dateISO: row.date_iso, slug: null, action: 'sealed', before, after: null });
      continue;
    }
    let slug: string | null = null;
    let race: RaceForOutlook | null = null;
    try {
      // A race-week tune-up is a rehearsal AT the race's execution pace, dated
      // inside race week rather than on the race day, so it resolves the
      // plan's race (never a race dated on its own day).
      slug = row.type === 'race_week_tuneup'
        ? await planRaceSlug(client, planId)
        : await raceSlugForRow(client, userUuid, planId, row.date_iso);
      race = slug ? await loadRaceForOutlook(userUuid, slug, today) : null;
      if (race && !(race.distanceMi > 0) && row.distance_mi != null) race = { ...race, distanceMi: Number(row.distance_mi) };
    } catch (e) {
      result.rows.push({ id: row.id, dateISO: row.date_iso, slug, action: 'refused', reason: `race lookup failed: ${(e as Error).message}`, before, after: null });
      result.refused++;
      continue;
    }
    if (!race || !(race.distanceMi > 0)) {
      result.rows.push({ id: row.id, dateISO: row.date_iso, slug, action: 'refused', reason: 'NO_RACE_FOR_ROW', before, after: null });
      result.refused++;
      continue;
    }
    let outlook: RaceOutlook;
    try {
      outlook = await resolveRaceOutlook(userUuid, race, today);
    } catch (e) {
      result.rows.push({ id: row.id, dateISO: row.date_iso, slug, action: 'refused', reason: `outlook failed: ${(e as Error).message}`, before, after: null });
      result.refused++;
      continue;
    }
    const summary = {
      statedGoalSec: outlook.statedGoal.sec,
      expectedSec: outlook.expectedRaceDay.expectedSec,
      likelyRangeSec: outlook.expectedRaceDay.likelyRangeSec,
      targetSec: outlook.execution.targetSec,
      source: outlook.execution.source,
    };
    if (outlook.execution.paceSecPerMi == null) {
      result.rows.push({ id: row.id, dateISO: row.date_iso, slug, action: 'refused', reason: 'OUTLOOK_UNAVAILABLE', before, after: null, outlook: summary });
      result.refused++;
      continue;
    }
    // ROW-CONTRACT-1 · ONE FUNCTION DECIDES THE WHOLE ROW. Everything below is
    // a mechanical application of what it returned; nothing here composes a
    // field of its own.
    const write = raceRowWrite({ row: contractRowOf(row), outlook });
    if ('refused' in write) {
      // CONTRACT_INCOHERENT arrives here too: a write that would leave the row
      // contradicting itself is refused WHOLE and the stale row stands,
      // because a stale row is at least a plan somebody could run (Rule 11).
      console.error(`[race-row-refresh] REFUSED · plan=${planId} row=${row.id} ${row.date_iso} · ${write.refused}`);
      result.rows.push({ id: row.id, dateISO: row.date_iso, slug, action: 'refused', reason: write.refused, before, after: null, outlook: summary });
      result.refused++;
      continue;
    }
    const after = { paceSecPerMi: write.paceTargetSecPerMi };

    if (write.unchanged) {
      result.rows.push({ id: row.id, dateISO: row.date_iso, slug, action: 'unchanged', before, after, outlook: summary });
      continue;
    }
    // Rule 6 · field-level merge. Everything the row already carries that this
    // path does not own (fuel_mi, strides, progression) survives. The keys a
    // refreshed row must NOT keep are named by `raceRowWrite`, not by this
    // statement, so they live with the rest of the contract.
    await client.query(
      `UPDATE plan_workouts
          SET pace_target_s_per_mi = $2,
              workout_spec = (COALESCE(workout_spec, '{}'::jsonb) - $4::text[]) || $3::jsonb,
              notes = COALESCE($5, notes)
        WHERE id = $1`,
      [row.id, after.paceSecPerMi, JSON.stringify(write.specFields), write.specDrops, write.notes],
    );
    result.rows.push({ id: row.id, dateISO: row.date_iso, slug, action: 'updated', before, after, outlook: summary });
    result.updated++;
  }

  if (rows.length > 0) {
    await client.query(
      `UPDATE training_plans
          SET authored_state = COALESCE(authored_state, '{}'::jsonb)
              || jsonb_build_object('race_row_refresh', $2::jsonb)
        WHERE id = $1`,
      [planId, JSON.stringify({
        at: new Date().toISOString(),
        source: source ?? 'race-row-refresh',
        updated: result.updated,
        refused: result.refused,
        rows: result.rows.map((r) => ({ id: r.id, date: r.dateISO, action: r.action, reason: r.reason ?? null, pace: r.after?.paceSecPerMi ?? null })),
      })],
    );
  }
  return result;
}
