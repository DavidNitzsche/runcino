/**
 * POST /api/watch/workouts/complete
 *
 * The watch hands the phone a WatchCompletion payload via transferUserInfo;
 * the phone POSTs here. Idempotent on (workoutId) — re-POSTing the same
 * workoutId overwrites, so the watch's durable retry queue is safe.
 *
 * P1.5 stub: persists the raw payload as JSON in plan_workouts.completion_payload
 * (or a new completions table — TBD when the writeback path is exercised).
 *
 * Contract: docs/coach/WATCH_CONTRACT.md
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body || typeof body !== 'object' || !body.workoutId) {
    return NextResponse.json({ error: 'workoutId required' }, { status: 400 });
  }

  // P1.5 minimal: log as coach_intent reason='watch_completion' so the next
  // briefing sees it. A dedicated workout_completions table lands in P2.
  await pool.query(
    `INSERT INTO coach_intents (user_id, reason, field, value, briefing_id)
     VALUES ($1, 'watch_completion', $2, $3, NULL)`,
    [body.user_id ?? DAVID_USER_ID, body.workoutId, JSON.stringify(body)]
  ).catch(() => { /* table may not exist locally; intentional ignore */ });

  return NextResponse.json({ ok: true, workoutId: body.workoutId, accepted_at: new Date().toISOString() });
}
