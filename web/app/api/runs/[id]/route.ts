/**
 * GET /api/runs/[id], full activity details + matched plan day.
 *
 * Used by the run-detail modal on /log. Returns:
 *   - run: the normalized strava_activities.data shape
 *   - plan: the matched planned workout for that date (or null)
 *
 * Multi-tenant: filters by user_uuid OR null (legacy backfill rows).
 */

import { NextResponse } from 'next/server';
import { requireActiveUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { getActivePlanWeeks } from '@/lib/plan-weeks';
import { describeWorkout } from '@/lib/workout-descriptions';
import { gatherCoachState } from '@/lib/coach-state';
import { coach } from '@/coach/coach';
import { getCachedActivities } from '@/lib/strava-cache';
import { dedupeRunsForDisplay, type MergedSource } from '@/lib/dedupe-runs';
import { loadMergeOverrides } from '@/lib/run-merge-overrides';

interface ActivityRow {
  id: string;
  data: Record<string, unknown>;
  shoe_id: number | null;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  let user;
  try {
    user = await requireActiveUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;

  const rows = await query<ActivityRow>(
    `SELECT id::text AS id, data, shoe_id
       FROM strava_activities
      WHERE id = $1 AND (user_uuid = $2 OR user_uuid IS NULL)
      LIMIT 1`,
    [id, user.id],
  );
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  const d = row.data as {
    name?: string; description?: string | null;
    startLocal?: string; date?: string;
    distanceMi?: number; movingTimeS?: number; paceSPerMi?: number;
    avgHr?: number | null; maxHr?: number | null; avgCadence?: number | null;
    elevGainFt?: number; type?: string; workoutType?: number | null;
    summaryPolyline?: string | null;
  };

  const dateISO = (d.date || (d.startLocal || '').slice(0, 10));

  // Find a matching planned workout for the run's date, from the REAL plan.
  const weeks = await getActivePlanWeeks();
  let matchedDay = null;
  let matchedWeek = null;
  for (const w of weeks) {
    const day = w.days.find((dd) => dd.date === dateISO);
    if (day) { matchedDay = day; matchedWeek = w; break; }
  }

  // Resolve the workout description for the matched plan day
  const planDesc = matchedDay && !matchedDay.isRest
    ? describeWorkout(matchedDay.label, matchedDay.type)
    : null;

  // Optional: load the shoe if assigned
  let shoe = null;
  if (row.shoe_id) {
    const shoes = await query<{ brand: string; model: string; color: string | null }>(
      `SELECT brand, model, color FROM shoes WHERE id = $1 LIMIT 1`,
      [row.shoe_id],
    );
    shoe = shoes[0] ?? null;
  }

  // Coach REFLECTION + FORM read of this run (W1 wiring, Run Detail
  // half). Plan-day match feeds plannedDistanceMi + plannedType so
  // the engine can compare prescribed vs actual. Safe to throw —
  // page degrades gracefully.
  let coachRead: { verdict: string; body: string; unlockPin: string | null; deltas: unknown } | null = null;
  try {
    const state = await gatherCoachState({ userId: user.id });
    const decision = await coach.runRead({
      today: state.now.slice(0, 10),
      activityId: Number(row.id) || 0,
      activity: {
        distanceMi: Number(d.distanceMi) || 0,
        durationS: Number(d.movingTimeS) || 0,
        paceSPerMi: Number(d.paceSPerMi) || 0,
        avgHr: d.avgHr ? Number(d.avgHr) : null,
        name: d.name || 'Untitled run',
        plannedDistanceMi: matchedDay?.distanceMi ?? null,
        plannedType: matchedDay?.type ?? null,
      },
      state,
    });
    coachRead = {
      verdict: decision.answer.verdict,
      body: decision.answer.body,
      unlockPin: decision.answer.unlockPin,
      deltas: decision.answer.deltas,
    };
  } catch (err) {
    console.warn('[api/runs/:id] coach.runRead failed', { id, err });
  }

  // Surface dedup state to the detail modal — so the user can see which
  // other rows were folded into this canonical (and pick any to unmerge),
  // OR see that THIS row was folded into another (and unmerge it back to
  // its own line). One cache + dedup pass; cheap.
  let mergedSources: MergedSource[] = [];
  let mergedIntoId: number | null = null;
  try {
    const cache = await getCachedActivities();
    const overrides = await loadMergeOverrides(user.id);
    const deduped = dedupeRunsForDisplay(cache.activities, overrides);
    const requestedId = Number(row.id);
    const canonical = deduped.find((r) => r.id === requestedId);
    if (canonical) {
      mergedSources = canonical.mergedSources;
    } else {
      const host = deduped.find((r) =>
        r.mergedSources.some((s) => s.id === requestedId),
      );
      if (host) mergedIntoId = host.id;
    }
  } catch { /* decorative — never block the detail load */ }

  return NextResponse.json({
    ok: true,
    run: {
      id: row.id,
      name: d.name || 'Untitled run',
      description: d.description || null,
      date: dateISO,
      distanceMi: Number(d.distanceMi) || 0,
      movingTimeS: Number(d.movingTimeS) || 0,
      paceSPerMi: Number(d.paceSPerMi) || 0,
      avgHr: d.avgHr ? Number(d.avgHr) : null,
      maxHr: d.maxHr ? Number(d.maxHr) : null,
      avgCadence: d.avgCadence ? Number(d.avgCadence) : null,
      elevGainFt: Number(d.elevGainFt) || 0,
      type: d.type || 'Run',
      workoutType: d.workoutType ?? null,
      summaryPolyline: d.summaryPolyline || null,
      shoe,
      mergedSources,
      mergedIntoId,
    },
    plan: matchedDay && matchedWeek ? {
      label: matchedDay.label,
      type: matchedDay.type,
      distanceMi: matchedDay.distanceMi,
      isRest: !!matchedDay.isRest,
      phase: matchedWeek.phase,
      paceTarget: planDesc?.paceTarget ?? '-',
      zone: planDesc?.zone ?? null,
    } : null,
    coachRead,
  });
}

/**
 * DELETE /api/runs/[id] — remove an activity row.
 *
 * Use case: mistaken imports from testing the watch or HK sync. Hard
 * deletes the strava_activities row scoped to the calling user. Watch
 * / HealthKit synthetic runs (negative bigint IDs from run-dedup
 * canonicalRunId) won't re-appear since their source isn't a remote
 * fetch. Strava-sourced runs (positive IDs) MAY re-appear on the next
 * sync — to avoid that, we also insert into deleted_activity_ids so
 * the sync skips them. Idempotent: returns 200 even when the row is
 * already gone.
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  let user;
  try {
    user = await requireActiveUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    // Ensure the tombstone table exists. Idempotent CREATE.
    await query(
      `CREATE TABLE IF NOT EXISTS deleted_activity_ids (
         id BIGINT PRIMARY KEY,
         user_uuid UUID,
         deleted_at TIMESTAMPTZ DEFAULT NOW()
       )`,
    );
    // Tombstone first so even if a re-sync races us, the row is
    // recognized as deleted.
    await query(
      `INSERT INTO deleted_activity_ids (id, user_uuid)
       VALUES ($1::BIGINT, $2)
       ON CONFLICT (id) DO NOTHING`,
      [id, user.id],
    );
    await query(
      `DELETE FROM strava_activities
        WHERE id = $1::BIGINT
          AND (user_uuid = $2 OR user_uuid IS NULL)`,
      [id, user.id],
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Delete failed' }, { status: 500 });
  }
}
