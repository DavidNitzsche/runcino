/**
 * /api/today/shoe
 *
 *   POST   { date_iso, shoe_id }  → upsert per-day shoe assignment
 *   DELETE { date_iso }           → clear it
 *
 * Persists to day_actions (action='shoe', note=shoe_id) per migration 123.
 * Self-applies the action-enum-extension on first POST so the endpoint is
 * runnable even if 123 hasn't been migrated manually yet — same idempotent
 * pattern as 114's DDL.
 *
 * The Faff /today ShoePicker calls this on every change. Optimistic UI
 * stays responsive; failures don't block the rest of the view.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { requireUserId } from '@/lib/auth/session';

let constraintEnsured = false;
async function ensureShoeAction(): Promise<void> {
  if (constraintEnsured) return;
  // Idempotent: DROP + ADD the check constraint so the enum supports 'shoe'.
  // First runs in a fresh DB silently succeed; subsequent runs are no-ops
  // because the constraint after DROP already matches what we ADD.
  await pool.query(`
    ALTER TABLE day_actions
      DROP CONSTRAINT IF EXISTS day_actions_action_check
  `);
  await pool.query(`
    ALTER TABLE day_actions
      ADD CONSTRAINT day_actions_action_check
      CHECK (action IN ('skip', 'shoe'))
  `);
  constraintEnsured = true;
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await req.json().catch(() => null) as { date_iso?: string; shoe_id?: string } | null;
  if (!body?.shoe_id) {
    return NextResponse.json({ error: 'shoe_id required' }, { status: 400 });
  }
  const dateIso = body.date_iso || await runnerToday(userId);

  try {
    await ensureShoeAction();
    await pool.query(
      `INSERT INTO day_actions (user_id, user_uuid, date_iso, action, note)
       VALUES ($1, $1, $2, 'shoe', $3)
       ON CONFLICT (user_id, date_iso, action)
       DO UPDATE SET note = EXCLUDED.note, created_at = NOW(),
                     user_uuid = COALESCE(day_actions.user_uuid, EXCLUDED.user_uuid)`,
      [userId, dateIso, String(body.shoe_id)]
    );
    // shoe_crud is the canonical regen event for any shoe-row mutation.
    await bustBriefingCacheForEvent(userId, 'shoe_crud');
    return NextResponse.json({ ok: true, date_iso: dateIso, shoe_id: body.shoe_id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await req.json().catch(() => null) as { date_iso?: string } | null;
  const dateIso = body?.date_iso || await runnerToday(userId);
  try {
    await pool.query(
      `DELETE FROM day_actions
        WHERE COALESCE(user_uuid, user_id) = $1 AND date_iso = $2 AND action = 'shoe'`,
      [userId, dateIso]
    );
    await bustBriefingCacheForEvent(userId, 'shoe_crud');
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
