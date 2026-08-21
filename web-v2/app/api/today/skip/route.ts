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
 * Auth: requireUserId session auth (multi-user since 2026-05-30). `today` is computed with the same
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
  //
  // 2026-08-17 · race-lifecycle · race-day suppression. The nudge fires
  // the MORNING AFTER the skip; when that morning is a race day (a
  // race-type plan row or a races meta date), "YESTERDAY · SKIPPED.
  // Today is easy 5.0mi. still feeling it?" landing at 07:15 on race
  // morning is exactly wrong — the skipped shakeout the day before a
  // race is deliberate taper conservation, not a recovery question.
  // (This fired on AFC Half morning, 2026-08-16.)
  try {
    const tomorrow = new Date(date + 'T00:00:00Z');
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowIso = tomorrow.toISOString().slice(0, 10);
    if (!(await dayHoldsRace(userId, tomorrowIso))) {
      const planned = await lookupPlannedWorkout(userId, tomorrowIso);
      const tpl = renderSkipRecovery({
        user_id: userId,
        date_iso: tomorrowIso,
        planned_today_verb: planned.verb,
        planned_today_distance: planned.distance,
      });
      await enqueueNotification(userId, tpl, nextMorning0715(new Date()));
    }
  } catch { /* notif enqueue is non-blocking */ }

  return NextResponse.json({ skipped: true, date });
}

/** True when `dateIso` is a race day for this runner — either the
 *  active plan holds a race-type row that day, or a races-table entry
 *  carries that meta date. Fails open to false (a DB hiccup must not
 *  block the skip itself; worst case the nudge fires as before). */
async function dayHoldsRace(userId: string, dateIso: string): Promise<boolean> {
  try {
    const r = await pool.query(
      `SELECT 1 FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1
          AND tp.archived_iso IS NULL
          AND pw.date_iso = $2
          AND pw.type = 'race'
       UNION ALL
       SELECT 1 FROM races
        WHERE user_uuid = $1 AND meta->>'date' = $2
       LIMIT 1`,
      [userId, dateIso],
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

/** Read tomorrow's planned workout to slot into the recovery notification.
 *
 *  2026-08-21 · watch/push audit · TWO defects, one message:
 *
 *  1. The query read `plan_workouts` by user and date with a bare LIMIT 1 and
 *     no plan filter. A runner carries MORE THAN ONE plan — David has rows
 *     from a stale plan and the active one on the very same dates (3 mi vs
 *     5 mi on 2026-08-23) — so an unordered LIMIT 1 picked an arbitrary plan's
 *     row, and could quote a session from a plan that is no longer his.
 *
 *     (An earlier draft of this comment said `plan_workouts.user_uuid` was
 *     NULL since the multi-user cutover. It is not: all 4389 rows carry it.
 *     The join is still the right fix — it is what pins the read to the
 *     ACTIVE plan — but the reason is plan ambiguity, not a null column.)
 *  2. That fallback was a hardcoded 'easy' / '5.0mi'. The push therefore told
 *     the runner "Today is easy 5.0mi" on a rest day, on an interval day, and
 *     on a 16-mile long-run day alike — a prescription the plan never made,
 *     presented as the plan.
 *
 *  Now: joined through the ACTIVE plan, and a miss returns nulls so the
 *  template says nothing about today rather than inventing it. A rest row
 *  returns verb 'rest' so the template can name it.
 */
async function lookupPlannedWorkout(
  userId: string,
  dateIso: string,
): Promise<{ verb: string | null; distance: string | null }> {
  try {
    const r = await pool.query(
      `SELECT pw.type, pw.distance_mi
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1
          AND tp.archived_iso IS NULL
          AND pw.date_iso = $2
        ORDER BY (pw.type = 'rest') ASC
        LIMIT 1`,
      [userId, dateIso],
    );
    const row = r.rows[0];
    if (!row) return { verb: null, distance: null };
    const verbMap: Record<string, string> = {
      easy: 'easy', long: 'long', tempo: 'tempo', threshold: 'threshold',
      intervals: 'intervals', progression: 'progression', recovery: 'recovery',
      fartlek: 'fartlek', rest: 'rest', shakeout: 'shakeout',
    };
    const verb = verbMap[row.type] ?? null;
    if (verb == null || verb === 'rest') return { verb: verb ?? null, distance: null };
    const mi = row.distance_mi == null ? null : Number(row.distance_mi);
    return {
      verb,
      distance: mi != null && mi > 0 ? `${mi.toFixed(1)}mi` : null,
    };
  } catch {
    // A DB hiccup is not knowledge about the runner's day. Say nothing.
    return { verb: null, distance: null };
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
