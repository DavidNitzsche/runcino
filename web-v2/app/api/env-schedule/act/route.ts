/**
 * POST /api/env-schedule/act · Phase 2 (3.6) · apply or dismiss an
 * environment-scheduling suggestion.
 *
 * Body: { intentId: number, action: 'earlier' | 'swap' | 'dismiss' }
 *
 *   earlier · stamps "Start by ~6 AM · heat." onto the workout's notes
 *             (notes-level — no row moves; the runner just starts early)
 *   swap    · swaps date_iso/dow between the quality row and the easy
 *             row the suggestion named · re-verifies at act time that
 *             both days are still unrun and the hard-easy guard still
 *             holds (the plan may have changed since the cron wrote it)
 *   dismiss · acknowledges only
 *
 * Every path acknowledges the intent · the chip disappears either way.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

const QUALITY_TYPES = new Set(['tempo', 'threshold', 'intervals', 'race_week_tuneup', 'long']);

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const body = await req.json().catch(() => null) as { intentId?: number; action?: string } | null;
  const intentId = Number(body?.intentId);
  const action = String(body?.action ?? '');
  if (!Number.isFinite(intentId) || !['earlier', 'swap', 'dismiss'].includes(action)) {
    return NextResponse.json({ error: 'intentId + action (earlier|swap|dismiss) required' }, { status: 400 });
  }

  const intent = (await pool.query<{ id: number; field: string | null; value: unknown }>(
    `SELECT id, field, value FROM coach_intents
      WHERE id = $1 AND COALESCE(user_uuid, user_id) = $2::uuid
        AND reason = 'env_schedule_suggest' AND acknowledged_at IS NULL
      LIMIT 1`,
    [intentId, userId],
  )).rows[0];
  if (!intent) return NextResponse.json({ error: 'suggestion not found or already handled' }, { status: 404 });

  const ack = () => pool.query(
    `UPDATE coach_intents SET acknowledged_at = NOW() WHERE id = $1`, [intentId],
  );

  try {
    const s = (typeof intent.value === 'string' ? JSON.parse(intent.value) : intent.value) as {
      workoutDateISO?: string; suggestion?: string; suggestedDateISO?: string; suggestedStartHour?: number;
    } | null;
    const workoutDate = s?.workoutDateISO ?? intent.field;

    if (action === 'dismiss') {
      await ack();
      return NextResponse.json({ ok: true, applied: 'dismiss' });
    }

    if (action === 'earlier') {
      const hour = s?.suggestedStartHour ?? 6;
      const r = await pool.query(
        `UPDATE plan_workouts pw
            SET notes = 'Start by ' || $3 || ' AM · heat. ' || COALESCE(pw.notes, '')
           FROM training_plans tp
          WHERE tp.id = pw.plan_id AND tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL
            AND pw.date_iso = $2
            AND NOT EXISTS (
              SELECT 1 FROM runs rr
               WHERE rr.user_uuid = $1::uuid AND NOT (rr.data ? 'mergedIntoId')
                 AND COALESCE(rr.data->>'date', LEFT(rr.data->>'startLocal',10)) = pw.date_iso
            )`,
        [userId, workoutDate, String(hour)],
      );
      await ack();
      return NextResponse.json({ ok: true, applied: 'earlier', rows: r.rowCount });
    }

    // swap · re-verify both rows now, then exchange dates atomically.
    const swapDate = s?.suggestedDateISO;
    if (!swapDate || !workoutDate) {
      await ack();
      return NextResponse.json({ error: 'suggestion lacks swap target · dismissed' }, { status: 409 });
    }
    const rows = (await pool.query<{ id: string; date_iso: string; dow: number; type: string }>(
      `SELECT pw.id, pw.date_iso, pw.dow, pw.type
         FROM plan_workouts pw JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL
          AND pw.date_iso IN ($2, $3)`,
      [userId, workoutDate, swapDate],
    )).rows;
    const a = rows.find((r) => r.date_iso === workoutDate);
    const b = rows.find((r) => r.date_iso === swapDate);
    if (!a || !b || b.type !== 'easy' || !QUALITY_TYPES.has(a.type)) {
      await ack();
      return NextResponse.json({ error: 'plan changed since suggestion · dismissed instead' }, { status: 409 });
    }
    // Unrun guard on both days.
    const ran = (await pool.query(
      `SELECT 1 FROM runs
        WHERE user_uuid = $1::uuid AND NOT (data ? 'mergedIntoId')
          AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) IN ($2, $3)
        LIMIT 1`,
      [userId, workoutDate, swapDate],
    )).rows.length > 0;
    if (ran) {
      await ack();
      return NextResponse.json({ error: 'one of the days already has a run · dismissed instead' }, { status: 409 });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE plan_workouts SET date_iso = $2, dow = $3 WHERE id = $1`, [a.id, b.date_iso, b.dow]);
      await client.query(`UPDATE plan_workouts SET date_iso = $2, dow = $3 WHERE id = $1`, [b.id, a.date_iso, a.dow]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    await ack();
    return NextResponse.json({ ok: true, applied: 'swap', moved: { quality: b.date_iso, easy: a.date_iso } });
  } catch (e: unknown) {
    console.error('[env-schedule/act]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
