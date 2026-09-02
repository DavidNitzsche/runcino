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
import { resolveRaceOutlook, loadRaceForOutlook, RACE_EXECUTION_BAND_S_PER_MI, type RaceOutlook, type RaceForOutlook } from './race-outlook';

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
  pace_target_s_per_mi: string | number | null;
  distance_mi: string | number | null;
  workout_spec: Record<string, unknown> | null;
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

export function raceExecutionSpecFields(o: RaceOutlook): Record<string, unknown> {
  const x = o.execution;
  const pace = x.paceSecPerMi;
  return {
    ...(pace != null
      ? { pace_target_s_per_mi_lo: pace - RACE_EXECUTION_BAND_S_PER_MI, pace_target_s_per_mi_hi: pace + RACE_EXECUTION_BAND_S_PER_MI }
      : {}),
    race_execution: {
      model_version: o.modelVersion,
      resolved_at: o.resolvedAt,
      target_sec: x.targetSec,
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

async function refreshRaceRowsCore(
  client: Queryable,
  planId: string,
  userUuid: string,
  today: string,
  source: string | undefined,
): Promise<RaceRowRefreshResult> {

  const rows = (await client.query<RaceRow>(
    `SELECT pw.id::text AS id, pw.date_iso::text AS date_iso, pw.pace_target_s_per_mi, pw.distance_mi, pw.workout_spec,
            EXISTS (
              SELECT 1 FROM runs r
               WHERE r.user_uuid = $2::uuid
                 AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10))::date = pw.date_iso::date
                 AND NOT (r.data ? 'mergedIntoId')
            ) AS sealed
       FROM plan_workouts pw
      WHERE pw.plan_id = $1 AND pw.type = 'race'
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
      slug = await raceSlugForRow(client, userUuid, planId, row.date_iso);
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
    const fields = raceExecutionSpecFields(outlook);
    const after = { paceSecPerMi: outlook.execution.paceSecPerMi };
    const prevExec = (row.workout_spec?.race_execution ?? null) as { target_sec?: number } | null;
    const unchanged = before.paceSecPerMi === after.paceSecPerMi
      && prevExec?.target_sec === outlook.execution.targetSec
      && row.workout_spec != null && !('hr_cap_bpm' in row.workout_spec)
      && row.workout_spec.race_hr != null;
    if (unchanged) {
      result.rows.push({ id: row.id, dateISO: row.date_iso, slug, action: 'unchanged', before, after, outlook: summary });
      continue;
    }
    // Rule 6 · field-level merge. Everything the row already carries that this
    // path does not own (rules, fuel_mi, strides, progression) survives.
    await client.query(
      `UPDATE plan_workouts
          SET pace_target_s_per_mi = $2,
              workout_spec = (COALESCE(workout_spec, '{}'::jsonb) - 'hr_cap_bpm') || $3::jsonb
        WHERE id = $1`,
      [row.id, after.paceSecPerMi, JSON.stringify(fields)],
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
