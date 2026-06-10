/**
 * GET    /api/niggle  — { active: NiggleRow | null }
 * POST   /api/niggle  — body { body_part, side?, severity, status, note? }
 *                       Returns { niggle_id, active: true }
 * DELETE /api/niggle  — clears the most recent active niggle (sets cleared_at).
 *                       Returns { active: false }
 *
 * "Niggle" = mild musculoskeletal flag the runner reports. The runner can
 * still train; the plan does NOT pause. resolveDayState routes /today
 * through the `niggle` surface so the workout renders with awareness.
 *
 * v1 supports a SINGLE active niggle per user. The most recent active row
 * is treated as "the niggle"; older un-cleared rows are tolerated in the
 * schema but ignored by GET. (Multi-niggle is a v1.1 design problem per
 * the deck's footer Q3.)
 *
 * Auth: requireUserId session auth · same posture as app/api/today/skip.
 *
 * Spec: docs/2026-05-28-niggle-sick-logging.html §SECTION 02 (modal),
 *       §SECTION 04 (state on /today), §SECTION 06 (recovery).
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { enqueueNotification, nextMorning0715 } from '@/lib/notifications/enqueue';
import { renderNiggleCheck } from '@/lib/notifications/templates';
import { requireUserId } from '@/lib/auth/session';

interface NigglePostBody {
  body_part: string;
  side?: 'left' | 'right' | 'both' | null;
  severity: number;          // 1-10 (runner-anchored scale per deck §02)
  status: 'just_started' | 'few_days' | 'weeks';
  note?: string | null;
}

async function readJson<T>(req: NextRequest): Promise<Partial<T>> {
  try {
    const text = await req.text();
    if (!text) return {};
    return JSON.parse(text) as Partial<T>;
  } catch {
    return {};
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  try {
    const row = (await pool.query(
      `SELECT id, body_part, side, severity, status, note, logged_at, cleared_at
         FROM niggles
        WHERE COALESCE(user_uuid, user_id) = $1 AND cleared_at IS NULL
        ORDER BY logged_at DESC
        LIMIT 1`,
      [userId],
    )).rows[0];
    return NextResponse.json({ active: row ?? null });
  } catch (err: any) {
    return NextResponse.json({ active: null, warning: err?.message ?? String(err) });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await readJson<NigglePostBody>(req);
  if (!body.body_part || typeof body.severity !== 'number' || !body.status) {
    return NextResponse.json(
      { error: 'missing required fields', need: ['body_part', 'severity', 'status'] },
      { status: 400 },
    );
  }
  if (body.severity < 1 || body.severity > 10) {
    return NextResponse.json({ error: 'severity must be 1-10' }, { status: 400 });
  }

  try {
    const ins = await pool.query(
      `INSERT INTO niggles (user_id, user_uuid, body_part, side, severity, status, note)
       VALUES ($1, $1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        userId,
        body.body_part,
        body.side ?? null,
        body.severity,
        body.status,
        body.note ?? null,
      ],
    );
    const niggleId = Number(ins.rows[0].id);
    // Notifications v1 §E — enqueue the first daily check for tomorrow 07:15.
    try {
      const fireAt = nextMorning0715(new Date());
      const dateIso = fireAt.toISOString().slice(0, 10);
      const tpl = renderNiggleCheck({
        user_id: userId,
        niggle_id: niggleId,
        date_iso: dateIso,
        body_part: body.body_part,
        days_active: 1,
      });
      await enqueueNotification(userId, tpl, fireAt);
    } catch { /* non-blocking */ }
    return NextResponse.json({ niggle_id: niggleId, active: true });
  } catch (err: any) {
    return NextResponse.json({
      error: 'niggle insert failed',
      detail: err?.message ?? String(err),
      hint: 'Did you apply web-v2/db/migrations/116_niggles.sql?',
    }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  try {
    await pool.query(
      `UPDATE niggles
          SET cleared_at = now()
        WHERE id = (
          SELECT id FROM niggles
           WHERE COALESCE(user_uuid, user_id) = $1 AND cleared_at IS NULL
           ORDER BY logged_at DESC
           LIMIT 1
        )`,
      [userId],
    );
    return NextResponse.json({ active: false });
  } catch (err: any) {
    return NextResponse.json({
      error: 'niggle delete failed',
      detail: err?.message ?? String(err),
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
