/**
 * GET /api/runs/[id] — full activity details + matched plan day.
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
import { getRealPlanWeeks } from '@/lib/plan-weeks';
import { resolvePlanUserId } from '@/lib/plan-user';
import { describeWorkout } from '@/lib/workout-descriptions';

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
  const weeks = await getRealPlanWeeks(await resolvePlanUserId());
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
    },
    plan: matchedDay && matchedWeek ? {
      label: matchedDay.label,
      type: matchedDay.type,
      distanceMi: matchedDay.distanceMi,
      isRest: !!matchedDay.isRest,
      phase: matchedWeek.phase,
      paceTarget: planDesc?.paceTarget ?? '—',
      zone: planDesc?.zone ?? null,
    } : null,
  });
}
