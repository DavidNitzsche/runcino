/**
 * GET /api/plan/diff?from=<oldPlanId>&to=<newPlanId>
 *
 * Structured comparison between two of the caller's training plans ·
 * powers the "SEE THE NEW PLAN" surface on /today after the auto-adapter
 * rebuilds a plan (race date / goal time / A-race add/remove triggers).
 *
 * The web agent renders this as a side-by-side diff page · backend's
 * job is to align rows by date and classify each day's change kind.
 *
 * Auth · ownership-checked: both plans must belong to the authenticated
 * caller, else 403. Prevents one runner from inspecting another's plan
 * shape.
 *
 * Response shape:
 *   {
 *     ok: true,
 *     from: { id, label, authoredIso, archivedIso, totalMiles, weekCount },
 *     to:   { id, label, authoredIso, archivedIso, totalMiles, weekCount },
 *     byDate: [
 *       { date, old: WorkoutRow | null, new: WorkoutRow | null, changeKind },
 *       ...
 *     ],
 *     summary: { daysChanged, milesDelta, qualityDaysChanged }
 *   }
 *
 * changeKind enum:
 *   · 'unchanged'    · both rows present + identical type + distance ±0.1
 *   · 'distance'     · type same, distance differs > 0.1 mi
 *   · 'type'         · type changed (e.g. tempo → easy)
 *   · 'sub_label'    · type + distance same, sub_label changed
 *   · 'added'        · row exists only in `to` (new day)
 *   · 'removed'      · row exists only in `from` (dropped day)
 *
 * Doctrine:
 *   · CLAUDE.md · facts only, never fabricate
 *   · designs/briefs/backend-state-2026-06-01-landed.md §Card render matrix
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

interface WorkoutRow {
  date: string;
  type: string;
  distanceMi: number;
  subLabel: string | null;
  isQuality: boolean;
  isLong: boolean;
  workoutSpec: Record<string, unknown> | null;
}

interface PlanMeta {
  id: string;
  label: string;
  authoredIso: string | null;
  archivedIso: string | null;
  totalMiles: number;
  weekCount: number;
}

type ChangeKind =
  | 'unchanged'
  | 'distance'
  | 'type'
  | 'sub_label'
  | 'added'
  | 'removed';

async function loadPlanMeta(userId: string, planId: string): Promise<PlanMeta | null> {
  const r = (await pool.query<{
    id: string;
    label: string | null;
    authored_iso: string | null;
    archived_iso: string | null;
    total_miles: number | string | null;
    week_count: number | string | null;
  }>(
    `SELECT
       p.id,
       p.label,
       p.authored_iso::text  AS authored_iso,
       p.archived_iso::text  AS archived_iso,
       COALESCE(SUM(pw.distance_mi), 0) AS total_miles,
       COUNT(DISTINCT pw.week_id)        AS week_count
       FROM training_plans p
       LEFT JOIN plan_workouts pw ON pw.plan_id = p.id
      WHERE p.id = $1
        AND COALESCE(p.user_uuid::text, p.user_id) = $2
      GROUP BY p.id, p.label, p.authored_iso, p.archived_iso
      LIMIT 1`,
    [planId, userId],
  )).rows[0];
  if (!r) return null;
  return {
    id: r.id,
    label: r.label ?? '(unlabeled)',
    authoredIso: r.authored_iso,
    archivedIso: r.archived_iso,
    totalMiles: Number(r.total_miles) || 0,
    weekCount: Number(r.week_count) || 0,
  };
}

async function loadWorkouts(planId: string): Promise<WorkoutRow[]> {
  const r = (await pool.query<{
    date_iso: string;
    type: string;
    distance_mi: number | string;
    sub_label: string | null;
    is_quality: boolean;
    is_long: boolean;
    workout_spec: Record<string, unknown> | null;
  }>(
    `SELECT date_iso::text AS date_iso, type, distance_mi, sub_label,
            is_quality, is_long, workout_spec
       FROM plan_workouts
      WHERE plan_id = $1
      ORDER BY date_iso ASC`,
    [planId],
  )).rows;
  return r.map((row) => ({
    date: row.date_iso,
    type: row.type,
    distanceMi: Number(row.distance_mi) || 0,
    subLabel: row.sub_label,
    isQuality: row.is_quality,
    isLong: row.is_long,
    workoutSpec: row.workout_spec,
  }));
}

function classifyChange(
  oldRow: WorkoutRow | null,
  newRow: WorkoutRow | null,
): ChangeKind {
  if (oldRow && !newRow) return 'removed';
  if (!oldRow && newRow) return 'added';
  if (!oldRow || !newRow) return 'unchanged';  // both null · shouldn't happen
  if (oldRow.type !== newRow.type) return 'type';
  if (Math.abs(oldRow.distanceMi - newRow.distanceMi) > 0.1) return 'distance';
  if ((oldRow.subLabel ?? '') !== (newRow.subLabel ?? '')) return 'sub_label';
  return 'unchanged';
}

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const url = new URL(req.url);
  const fromId = url.searchParams.get('from');
  const toId = url.searchParams.get('to');
  if (!fromId || !toId) {
    return NextResponse.json(
      { error: 'from + to plan ids required' },
      { status: 400 },
    );
  }

  const [fromMeta, toMeta] = await Promise.all([
    loadPlanMeta(userId, fromId),
    loadPlanMeta(userId, toId),
  ]);
  if (!fromMeta) {
    return NextResponse.json(
      { error: `plan ${fromId} not found or not yours` },
      { status: 404 },
    );
  }
  if (!toMeta) {
    return NextResponse.json(
      { error: `plan ${toId} not found or not yours` },
      { status: 404 },
    );
  }

  const [fromRows, toRows] = await Promise.all([
    loadWorkouts(fromId),
    loadWorkouts(toId),
  ]);

  // Align by date · union of all dates in either plan.
  const fromByDate = new Map<string, WorkoutRow>(fromRows.map((r) => [r.date, r]));
  const toByDate = new Map<string, WorkoutRow>(toRows.map((r) => [r.date, r]));
  const allDates = Array.from(
    new Set([...fromByDate.keys(), ...toByDate.keys()]),
  ).sort();

  const byDate = allDates.map((date) => {
    const oldRow = fromByDate.get(date) ?? null;
    const newRow = toByDate.get(date) ?? null;
    return {
      date,
      old: oldRow,
      new: newRow,
      changeKind: classifyChange(oldRow, newRow),
    };
  });

  const daysChanged = byDate.filter((d) => d.changeKind !== 'unchanged').length;
  const qualityDaysChanged = byDate.filter((d) => {
    if (d.changeKind === 'unchanged') return false;
    return (d.old?.isQuality ?? false) || (d.new?.isQuality ?? false);
  }).length;
  const milesDelta = Number(
    (toMeta.totalMiles - fromMeta.totalMiles).toFixed(1),
  );

  return NextResponse.json({
    ok: true,
    from: fromMeta,
    to: toMeta,
    byDate,
    summary: {
      daysChanged,
      milesDelta,
      qualityDaysChanged,
    },
  });
}
