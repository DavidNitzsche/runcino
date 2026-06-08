/**
 * GET    /api/today/skip               — { skipped: boolean, date }
 * POST   /api/today/skip   { date? }   — record an explicit skip for `date` (default today)
 * DELETE /api/today/skip   { date? }   — undo the skip
 *
 * "Skip" = "the plan said run today and I'm actively choosing not to. Not
 * sick, not injured, just skipping." Distinct from rest (plan-prescribed),
 * missed (passive), or sick/niggle (health). See db/migrations/114_day_actions.sql
 * for the full semantics rationale.
 *
 * Single-user beta pattern: user_id comes from process.env.DEFAULT_USER_ID
 * (matches app/api/checkin/route.ts:25). `today` is computed with the same
 * -7h offset as lib/coach/glance-state.ts:56 so the API and the glance
 * loader agree on what "today" means.
 *
 * The GET handler (added Phase 12 · 2026-05-28) lets the iPhone hydrate
 * `todaySkipped` without re-running the full glance-state loader. The
 * web client doesn't need it (the glance loader already carries the bit
 * inline), but iOS reads /api/briefing + /api/plan/week + /api/readiness
 * separately and needs a small dedicated endpoint for this signal.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { enqueueNotification, nextMorning0715 } from '@/lib/notifications/enqueue';
import { renderSkipRecovery } from '@/lib/notifications/templates';
import { requireUserId } from '@/lib/auth/session';

interface SkipBody {
  date?: string;
}

async function readBody(req: NextRequest): Promise<SkipBody> {
  try {
    const text = await req.text();
    if (!text) return {};
    return JSON.parse(text) as SkipBody;
  } catch {
    return {};
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  // Optional ?date=YYYY-MM-DD override (matches the POST/DELETE body
  // shape). Defaults to today using the same -7h offset as
  // lib/coach/glance-state.ts:56 so iPhone and web agree on "today".
  const dateParam = req.nextUrl.searchParams.get('date');
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : await runnerToday(userId);

  try {
    const row = await pool.query(
      `SELECT 1 FROM day_actions
        WHERE COALESCE(user_uuid, user_id) = $1 AND date_iso = $2 AND action = 'skip' LIMIT 1`,
      [userId, date],
    );
    return NextResponse.json({ skipped: row.rows.length > 0, date });
  } catch (err: any) {
    // Migration not applied yet → degrade to `skipped: false` rather than
    // 500ing. Same posture as glance-state.ts:268.
    return NextResponse.json({ skipped: false, date });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await readBody(req);
  const date = body.date ?? await runnerToday(userId);

  try {
    await pool.query(
      `INSERT INTO day_actions (user_id, user_uuid, date_iso, action)
       VALUES ($1, $1, $2, 'skip')
       ON CONFLICT (user_id, date_iso, action) DO UPDATE
         SET user_uuid = COALESCE(day_actions.user_uuid, EXCLUDED.user_uuid)`,
      [userId, date],
    );
  } catch (err: any) {
    return NextResponse.json({
      error: 'skip insert failed',
      detail: err?.message ?? String(err),
      hint: 'Did you apply web-v2/db/migrations/114_day_actions.sql?',
    }, { status: 500 });
  }

  // Notifications v1 §C — enqueue skip-recovery for tomorrow 07:15.
  // Soft-fail: if notifications tables aren't migrated yet the call
  // catches inside enqueueNotification, the skip itself still succeeds.
  try {
    const tomorrow = new Date(date + 'T00:00:00Z');
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowIso = tomorrow.toISOString().slice(0, 10);
    const planned = await lookupPlannedWorkout(userId, tomorrowIso);
    const tpl = renderSkipRecovery({
      user_id: userId,
      date_iso: tomorrowIso,
      planned_today_verb: planned.verb,
      planned_today_distance: planned.distance,
    });
    await enqueueNotification(userId, tpl, nextMorning0715(new Date()));
  } catch { /* notif enqueue is non-blocking */ }

  return NextResponse.json({ skipped: true, date });
}

/** Read tomorrow's planned workout to slot into the recovery notification.
 *  Falls back to 'easy 5.0mi' if no plan row — matches deck §C SLOTS
 *  default phrasing. */
async function lookupPlannedWorkout(
  userId: string,
  dateIso: string,
): Promise<{ verb: string; distance: string }> {
  try {
    const r = await pool.query(
      `SELECT type, distance_mi FROM plan_workouts
        WHERE user_uuid = $1 AND date_iso = $2 LIMIT 1`,
      [userId, dateIso],
    );
    const row = r.rows[0];
    if (!row) return { verb: 'easy', distance: '5.0mi' };
    const verbMap: Record<string, string> = {
      easy: 'easy', long: 'long', tempo: 'tempo', threshold: 'threshold',
      intervals: 'intervals', progression: 'progression', recovery: 'recovery',
      fartlek: 'fartlek', rest: 'rest', shakeout: 'shakeout',
    };
    return {
      verb: verbMap[row.type] ?? 'easy',
      distance: `${Number(row.distance_mi ?? 5).toFixed(1)}mi`,
    };
  } catch {
    return { verb: 'easy', distance: '5.0mi' };
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await readBody(req);
  const date = body.date ?? await runnerToday(userId);

  try {
    await pool.query(
      `DELETE FROM day_actions
        WHERE COALESCE(user_uuid, user_id) = $1 AND date_iso = $2 AND action = 'skip'`,
      [userId, date],
    );
  } catch (err: any) {
    return NextResponse.json({
      error: 'skip delete failed',
      detail: err?.message ?? String(err),
    }, { status: 500 });
  }

  return NextResponse.json({ skipped: false, date });
}

export const dynamic = 'force-dynamic';
