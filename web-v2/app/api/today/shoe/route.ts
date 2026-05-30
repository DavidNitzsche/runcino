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
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

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

function todayIso(): string {
  // PDT-shifted ISO date — same offset every other coach loader uses
  // (state-loader.ts §state.today) so day boundaries line up.
  return new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { date_iso?: string; shoe_id?: string; user_id?: string } | null;
  if (!body?.shoe_id) {
    return NextResponse.json({ error: 'shoe_id required' }, { status: 400 });
  }
  const userId = body.user_id ?? DAVID_USER_ID;
  const dateIso = body.date_iso || todayIso();

  try {
    await ensureShoeAction();
    await pool.query(
      `INSERT INTO day_actions (user_id, date_iso, action, note)
       VALUES ($1, $2, 'shoe', $3)
       ON CONFLICT (user_id, date_iso, action)
       DO UPDATE SET note = EXCLUDED.note, created_at = NOW()`,
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
  const body = await req.json().catch(() => null) as { date_iso?: string; user_id?: string } | null;
  const userId = body?.user_id ?? DAVID_USER_ID;
  const dateIso = body?.date_iso || todayIso();
  try {
    await pool.query(
      `DELETE FROM day_actions
        WHERE user_id = $1 AND date_iso = $2 AND action = 'shoe'`,
      [userId, dateIso]
    );
    await bustBriefingCacheForEvent(userId, 'shoe_crud');
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
