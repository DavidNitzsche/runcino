// POST /api/admin/reseed-maintenance
//
// Re-author a no-race (maintenance / TT-goal) runner's plan from their STORED
// onboarding goals, through the current seeder. Used to pick up an engine fix
// on an already-onboarded runner without making them re-onboard — e.g. the
// 2026-06-15 goal-relative VDOT floor + measured-anchor + true-I-pace fix,
// which a runner's baked plan_workouts rows don't get retroactively.
//
// seedMaintenancePlanFromOnboarding archives the active plan and writes a new
// one (idempotent-ish — safe to re-run), now anchored on the runner's MEASURED
// current fitness instead of a mileage estimate.
//
// Auth: CRON_SECRET bearer (server-to-server op, same trust level as the cron
// routes). NOT a public surface. Body: { "userId": "<uuid>" }.
//
// This is a DATA WRITE (archives + creates plan rows) — invoked deliberately,
// per the CLAUDE.md operational-vs-data-write boundary, with David's explicit
// go for the target user.

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { seedMaintenancePlanFromOnboarding } from '@/lib/plan/seed-from-onboarding';
import type {
  TTDistance, WeeklyMileage, WeeklyFrequency,
} from '@/lib/onboarding/state';

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (token !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const userId = typeof body.userId === 'string' ? body.userId : null;
  if (!userId) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 });
  }

  // Pull the runner's stored no-race goals. The plan's VOLUME curve is driven
  // by weekly_mileage_target; PACES now come from measured fitness inside the
  // seeder. History chips aren't reconstructed (profile stores numeric
  // midpoints) — null degrades to the same mileage-floor start the runner
  // already had, so the curve reproduces; only the pace anchor improves.
  const row = (await pool.query<{
    grd: string | null; ttd: string | null; ttt: string | null;
    wmt: number | null; wf: number | null;
  }>(
    `SELECT goal_race_distance AS grd, tt_goal_distance AS ttd, tt_goal_time AS ttt,
            weekly_mileage_target AS wmt, weekly_frequency AS wf
       FROM profile WHERE user_uuid = $1`,
    [userId],
  )).rows[0];

  if (!row) {
    return NextResponse.json({ error: 'profile not found' }, { status: 404 });
  }
  if (row.grd && row.grd !== 'none') {
    return NextResponse.json({
      error: `runner has a race goal (${row.grd}) — use the race-prep generator, not the maintenance seeder`,
    }, { status: 409 });
  }

  // Preserve the runner's intended start date (captured at onboarding as their
  // ORIGINAL plan's week-0). Without this, a re-seed yanked the plan to "today"
  // and silently discarded the "start in N days" choice. The seeder clamps to
  // >= today, so a past start just becomes today. Body can override.
  let startDateISO: string | undefined = typeof body.startDateISO === 'string' ? body.startDateISO : undefined;
  if (!startDateISO) {
    const startRow = (await pool.query<{ start: string | null }>(
      `SELECT MIN(week_start_iso)::text AS start FROM plan_weeks
        WHERE plan_id = (SELECT id FROM training_plans WHERE user_uuid = $1 ORDER BY authored_iso ASC LIMIT 1)`,
      [userId],
    ).catch(() => ({ rows: [] as Array<{ start: string | null }> }))).rows[0];
    startDateISO = startRow?.start ?? undefined;
  }

  try {
    const result = await seedMaintenancePlanFromOnboarding({
      userId,
      startDateISO,
      goals: {
        ttDistance: (row.ttd as TTDistance) ?? null,
        ttTimeBucket: row.ttt ?? null,
        weeklyMiTarget: (row.wmt as WeeklyMileage) ?? null,
        weeklyFrequency: (row.wf as WeeklyFrequency) ?? null,
        historyAvg: null,
        historyLong: null,
        historyYears: null,
      },
    });
    return NextResponse.json({ userId, ...result });
  } catch (err: unknown) {
    return NextResponse.json({
      ok: false, userId,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
