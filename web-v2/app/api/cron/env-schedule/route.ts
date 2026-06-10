/**
 * POST /api/cron/env-schedule · Phase 2 (3.6) · nightly environment-aware
 * scheduling pass.
 *
 * For every active-plan user: price the next 3 days' quality + long
 * windows with the unified heat model; when a materially cooler option
 * exists (6 AM start or an adjacent-easy-day swap, hard-easy guarded),
 * write ONE `env_schedule_suggest` coach intent per workout date. The
 * Today/Train chips render unacked intents; /api/env-schedule/act
 * applies or dismisses them.
 *
 * Schedule: nightly after the forecast is fresh — recommended 04:30 PT
 * (11:30 UTC), alongside the other morning crons. Re-runs are no-ops
 * while an unacked suggestion exists for the same date.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { computeEnvScheduleSuggestions } from '@/lib/coach/env-schedule';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  const auth = req.headers.get('authorization') ?? '';
  if (auth.replace(/^Bearer\s+/i, '').trim() !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const users = (await pool.query<{ user_uuid: string }>(
    `SELECT DISTINCT user_uuid FROM training_plans
      WHERE archived_iso IS NULL AND user_uuid IS NOT NULL`,
  ).catch(() => ({ rows: [] }))).rows.map((r) => r.user_uuid);

  let written = 0;
  let skippedDup = 0;
  const errors: string[] = [];
  for (const u of users) {
    try {
      const suggestions = await computeEnvScheduleSuggestions(u);
      for (const s of suggestions) {
        const dup = (await pool.query(
          `SELECT 1 FROM coach_intents
            WHERE COALESCE(user_uuid, user_id) = $1::uuid
              AND reason = 'env_schedule_suggest'
              AND field = $2
              AND acknowledged_at IS NULL
            LIMIT 1`,
          [u, s.workoutDateISO],
        )).rows.length > 0;
        if (dup) { skippedDup++; continue; }
        await pool.query(
          `INSERT INTO coach_intents (user_id, user_uuid, ts, reason, field, value)
           VALUES ($1, $1, NOW(), 'env_schedule_suggest', $2, $3)`,
          [u, s.workoutDateISO, JSON.stringify(s)],
        );
        written++;
      }
    } catch (e: unknown) {
      errors.push(`${u.slice(0, 8)}…: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    users: users.length,
    written,
    skipped_duplicates: skippedDup,
    errors,
    timestamp: new Date().toISOString(),
  });
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/cron/env-schedule',
    auth: 'Authorization: Bearer <CRON_SECRET>',
    recommended_schedule: '30 11 * * *  (04:30 PT · after the forecast refresh)',
    purpose: 'Suggest earlier starts / easy-day swaps when a quality window prices ≥4% heat and an alternative prices ≤2%. One unacked intent per workout date.',
  });
}
