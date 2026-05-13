/**
 * plan-store · Postgres reader+writer for the plan-as-artifact tables.
 *
 * Five tables: training_plans, plan_phases, plan_weeks, plan_workouts,
 * plan_mutations. See docs/PLAN_ARCHITECTURE.md §Database schema.
 *
 * Writes are transactional via `withClient`. Reads run two SELECTs and
 * hand-stitch (phases, weeks-with-workouts, mutations-per-workout).
 * For the small per-user volume (one active plan + ~16 weeks × 7 days)
 * this is well within budget without explicit joins.
 */

import { randomUUID } from 'node:crypto';
import { query, withClient } from './db';
import type {
  Plan,
  PlanPhase,
  PlanWeek,
  PlanWorkout,
  PlanMutation,
  PlanMode,
  WorkoutType,
  PhaseLabel,
  TriggerKind,
  CoachStateSnapshot,
} from '../coach/plan-types';

interface TrainingPlanRow {
  id: string;
  user_id: string;
  mode: PlanMode;
  race_id: string | null;
  goal_iso: string;
  authored_iso: string;
  authored_state: CoachStateSnapshot;
  archived_iso: string | null;
}

interface PlanPhaseRow {
  id: string;
  plan_id: string;
  label: PhaseLabel;
  start_week_idx: number;
  end_week_idx: number;
  rationale: string;
  citation: string;
}

interface PlanWeekRow {
  id: string;
  plan_id: string;
  week_idx: number;
  week_start_iso: string;
  phase_id: string;
  is_cutback: boolean;
  is_peak: boolean;
  is_race_week: boolean;
  rationale: string;
}

interface PlanWorkoutRow {
  id: string;
  plan_id: string;
  week_id: string;
  date_iso: string;
  dow: number;
  type: WorkoutType;
  distance_mi: string | number;
  pace_target_s_per_mi: number | null;
  duration_min: number | null;
  is_quality: boolean;
  is_long: boolean;
  notes: string;
  original_date_iso: string;
  original_type: WorkoutType;
  original_distance_mi: string | number;
}

interface PlanMutationRow {
  id: string;
  workout_id: string;
  ts: string;
  reason: string;
  citation: string;
  trigger_kind: TriggerKind;
  signal_snapshot: PlanMutation['signalSnapshot'];
  changed_fields: Partial<PlanWorkout>;
}

function toNum(v: string | number): number {
  return typeof v === 'string' ? Number(v) : v;
}

/** Persist a freshly-authored plan (Plan-with-Phases-with-Weeks-with-Workouts)
 *  and atomically archive any previously-active plan for the same user. */
export async function saveActivePlan(plan: Plan): Promise<void> {
  await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      // Archive any currently-active plan for this user.
      await client.query(
        `UPDATE training_plans
         SET archived_iso = NOW()
         WHERE user_id = $1 AND archived_iso IS NULL AND id <> $2`,
        [plan.userId, plan.id],
      );
      // Insert the new plan row.
      await client.query(
        `INSERT INTO training_plans (id, user_id, mode, race_id, goal_iso, authored_iso, authored_state, archived_iso)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET
           mode = EXCLUDED.mode,
           race_id = EXCLUDED.race_id,
           goal_iso = EXCLUDED.goal_iso,
           authored_state = EXCLUDED.authored_state,
           archived_iso = EXCLUDED.archived_iso`,
        [
          plan.id, plan.userId, plan.mode, plan.raceId, plan.goalISO,
          plan.authoredISO, JSON.stringify(plan.authoredFromState), plan.archivedISO,
        ],
      );
      // Wipe any pre-existing children for this plan (idempotent re-saves).
      await client.query(`DELETE FROM plan_phases WHERE plan_id = $1`, [plan.id]);
      // Phases.
      for (const ph of plan.phases) {
        await client.query(
          `INSERT INTO plan_phases (id, plan_id, label, start_week_idx, end_week_idx, rationale, citation)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [ph.id, plan.id, ph.label, ph.startWeekIdx, ph.endWeekIdx, ph.rationale, ph.citation],
        );
      }
      // Weeks + workouts.
      for (const wk of plan.weeks) {
        await client.query(
          `INSERT INTO plan_weeks (id, plan_id, week_idx, week_start_iso, phase_id, is_cutback, is_peak, is_race_week, rationale)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [wk.id, plan.id, wk.weekIdx, wk.weekStartISO, wk.phaseId, wk.isCutback, wk.isPeak, wk.isRaceWeek, wk.rationale],
        );
        for (const w of wk.workouts) {
          await client.query(
            `INSERT INTO plan_workouts
               (id, plan_id, week_id, date_iso, dow, type, distance_mi, pace_target_s_per_mi,
                duration_min, is_quality, is_long, notes,
                original_date_iso, original_type, original_distance_mi)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
            [
              w.id, plan.id, wk.id, w.dateISO, w.dow, w.type, w.distanceMi, w.paceTargetSPerMi,
              w.durationMin, w.isQuality, w.isLong, w.notes,
              w.originalDateISO, w.originalType, w.originalDistanceMi,
            ],
          );
          for (const m of w.mutations) {
            await client.query(
              `INSERT INTO plan_mutations (id, workout_id, ts, reason, citation, trigger_kind, signal_snapshot, changed_fields)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
              [m.id, w.id, m.ts, m.reason, m.citation, m.trigger, JSON.stringify(m.signalSnapshot), JSON.stringify(m.changedFields)],
            );
          }
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });
}

/** Read the active plan for a user (one with `archived_iso IS NULL`).
 *  Returns null when no plan exists. */
export async function getActivePlan(userId = 'me'): Promise<Plan | null> {
  const planRows = await query<TrainingPlanRow>(
    `SELECT id, user_id, mode, race_id, goal_iso, authored_iso, authored_state, archived_iso
     FROM training_plans
     WHERE user_id = $1 AND archived_iso IS NULL
     ORDER BY authored_iso DESC
     LIMIT 1`,
    [userId],
  );
  const planRow = planRows[0];
  if (!planRow) return null;

  const phaseRows = await query<PlanPhaseRow>(
    `SELECT id, plan_id, label, start_week_idx, end_week_idx, rationale, citation
     FROM plan_phases WHERE plan_id = $1 ORDER BY start_week_idx ASC`,
    [planRow.id],
  );
  const weekRows = await query<PlanWeekRow>(
    `SELECT id, plan_id, week_idx, week_start_iso, phase_id, is_cutback, is_peak, is_race_week, rationale
     FROM plan_weeks WHERE plan_id = $1 ORDER BY week_idx ASC`,
    [planRow.id],
  );
  const workoutRows = await query<PlanWorkoutRow>(
    `SELECT id, plan_id, week_id, date_iso, dow, type, distance_mi, pace_target_s_per_mi,
            duration_min, is_quality, is_long, notes,
            original_date_iso, original_type, original_distance_mi
     FROM plan_workouts WHERE plan_id = $1 ORDER BY date_iso ASC`,
    [planRow.id],
  );
  const mutationRows = await query<PlanMutationRow>(
    `SELECT pm.id, pm.workout_id, pm.ts, pm.reason, pm.citation, pm.trigger_kind,
            pm.signal_snapshot, pm.changed_fields
     FROM plan_mutations pm
     JOIN plan_workouts pw ON pw.id = pm.workout_id
     WHERE pw.plan_id = $1
     ORDER BY pm.ts ASC`,
    [planRow.id],
  );

  const mutationsByWorkout = new Map<string, PlanMutation[]>();
  for (const m of mutationRows) {
    const list = mutationsByWorkout.get(m.workout_id) ?? [];
    list.push({
      id: m.id,
      ts: m.ts,
      reason: m.reason,
      citation: m.citation,
      trigger: m.trigger_kind,
      signalSnapshot: m.signal_snapshot,
      changedFields: m.changed_fields,
    });
    mutationsByWorkout.set(m.workout_id, list);
  }

  const workoutsByWeek = new Map<string, PlanWorkout[]>();
  for (const w of workoutRows) {
    const list = workoutsByWeek.get(w.week_id) ?? [];
    list.push({
      id: w.id,
      dateISO: w.date_iso,
      dow: w.dow,
      type: w.type,
      distanceMi: toNum(w.distance_mi),
      paceTargetSPerMi: w.pace_target_s_per_mi,
      durationMin: w.duration_min,
      isQuality: w.is_quality,
      isLong: w.is_long,
      hasStrength: w.notes?.includes('\n\nStrength:') ?? false,
      notes: w.notes,
      originalDateISO: w.original_date_iso,
      originalType: w.original_type,
      originalDistanceMi: toNum(w.original_distance_mi),
      mutations: mutationsByWorkout.get(w.id) ?? [],
    });
    workoutsByWeek.set(w.week_id, list);
  }

  const weeks: PlanWeek[] = weekRows.map(wr => ({
    id: wr.id,
    weekIdx: wr.week_idx,
    weekStartISO: wr.week_start_iso,
    phaseId: wr.phase_id,
    isCutback: wr.is_cutback,
    isPeak: wr.is_peak,
    isRaceWeek: wr.is_race_week,
    rationale: wr.rationale,
    workouts: workoutsByWeek.get(wr.id) ?? [],
  }));

  const phases: PlanPhase[] = phaseRows.map(pr => ({
    id: pr.id,
    label: pr.label,
    startWeekIdx: pr.start_week_idx,
    endWeekIdx: pr.end_week_idx,
    rationale: pr.rationale,
    citation: pr.citation,
  }));

  return {
    id: planRow.id,
    userId: planRow.user_id,
    mode: planRow.mode,
    raceId: planRow.race_id,
    goalISO: planRow.goal_iso,
    authoredISO: typeof planRow.authored_iso === 'string'
      ? planRow.authored_iso
      : new Date(planRow.authored_iso).toISOString(),
    authoredFromState: planRow.authored_state,
    phases,
    weeks,
    archivedISO: planRow.archived_iso == null
      ? null
      : (typeof planRow.archived_iso === 'string' ? planRow.archived_iso : new Date(planRow.archived_iso).toISOString()),
  };
}

/** Mark a plan as archived. New buildPlan() calls will supersede it. */
export async function archivePlan(planId: string): Promise<void> {
  await query(
    `UPDATE training_plans SET archived_iso = NOW() WHERE id = $1 AND archived_iso IS NULL`,
    [planId],
  );
}

/** Insert a single mutation row (used by adaptPlan when a trigger fires). */
export async function insertMutation(workoutId: string, mutation: PlanMutation): Promise<void> {
  await query(
    `INSERT INTO plan_mutations (id, workout_id, ts, reason, citation, trigger_kind, signal_snapshot, changed_fields)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (id) DO NOTHING`,
    [mutation.id, workoutId, mutation.ts, mutation.reason, mutation.citation,
     mutation.trigger, JSON.stringify(mutation.signalSnapshot), JSON.stringify(mutation.changedFields)],
  );
}

/** Update an in-place plan_workout row after a mutation applied. */
export async function updateWorkout(workout: PlanWorkout): Promise<void> {
  await query(
    `UPDATE plan_workouts
     SET date_iso = $2, dow = $3, type = $4, distance_mi = $5, pace_target_s_per_mi = $6,
         duration_min = $7, is_quality = $8, is_long = $9, notes = $10
     WHERE id = $1`,
    [workout.id, workout.dateISO, workout.dow, workout.type, workout.distanceMi,
     workout.paceTargetSPerMi, workout.durationMin, workout.isQuality, workout.isLong, workout.notes],
  );
}

/** List mutations on a plan filtered by recency. Used by the PLAN
 *  ADAPTED card to show the last 7 days of changes. */
export async function listMutations(planId: string, sinceISO: string): Promise<Array<PlanMutation & { workoutId: string; workoutDateISO: string }>> {
  const rows = await query<PlanMutationRow & { date_iso: string }>(
    `SELECT pm.id, pm.workout_id, pm.ts, pm.reason, pm.citation, pm.trigger_kind,
            pm.signal_snapshot, pm.changed_fields, pw.date_iso
     FROM plan_mutations pm
     JOIN plan_workouts pw ON pw.id = pm.workout_id
     WHERE pw.plan_id = $1 AND pm.ts >= $2
     ORDER BY pm.ts DESC`,
    [planId, sinceISO],
  );
  return rows.map(r => ({
    id: r.id,
    ts: typeof r.ts === 'string' ? r.ts : new Date(r.ts).toISOString(),
    reason: r.reason,
    citation: r.citation,
    trigger: r.trigger_kind,
    signalSnapshot: r.signal_snapshot,
    changedFields: r.changed_fields,
    workoutId: r.workout_id,
    workoutDateISO: r.date_iso,
  }));
}

/** Generate a stable random id used for new plan/phase/week/workout rows. */
export function newId(): string {
  return randomUUID();
}
