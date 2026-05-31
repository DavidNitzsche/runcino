/**
 * GET    /api/sick  — { active: SickRow | null }
 * POST   /api/sick  — body { symptoms[], started, has_fever, note? }
 *                     Returns { episode_id, active: true }
 * DELETE /api/sick  — clears the most recent active episode.
 *                     Returns { active: false }
 *
 * "Sick" = systemic illness. UNLIKE niggle, this PAUSES the plan —
 * resolveDayState routes /today through the `sick` state which renders
 * REST + a return-gate card.
 *
 * symptoms is a string[] of: head_cold|chest|fever|gi|aches|fatigue|voice|other
 * started:   today|yesterday|few_days|week_plus
 * has_fever: boolean (denormalized · gates DO-NOT-RUN copy + the return gate)
 *
 * Single-user beta pattern: user_id = DEFAULT_USER_ID.
 *
 * Spec: docs/2026-05-28-niggle-sick-logging.html §SECTION 03 (modal),
 *       §SECTION 05 (state on /today), §SECTION 07 (recovery + gates).
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { enqueueNotification, nextMorning0715 } from '@/lib/notifications/enqueue';
import { renderSickCheck } from '@/lib/notifications/templates';
import { requireUserId } from '@/lib/auth/session';

interface SickPostBody {
  symptoms: string[];
  started: 'today' | 'yesterday' | 'few_days' | 'week_plus';
  has_fever: boolean;
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
      `SELECT id, symptoms, started, has_fever, note, logged_at, cleared_at
         FROM sick_episodes
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
  const body = await readJson<SickPostBody>(req);

  if (!Array.isArray(body.symptoms) || body.symptoms.length === 0) {
    return NextResponse.json(
      { error: 'symptoms must be a non-empty array' },
      { status: 400 },
    );
  }
  if (!body.started) {
    return NextResponse.json({ error: 'started is required' }, { status: 400 });
  }
  if (typeof body.has_fever !== 'boolean') {
    return NextResponse.json({ error: 'has_fever is required (boolean)' }, { status: 400 });
  }

  try {
    const ins = await pool.query(
      `INSERT INTO sick_episodes (user_id, user_uuid, symptoms, started, has_fever, note)
       VALUES ($1, $1, $2::jsonb, $3, $4, $5)
       RETURNING id`,
      [
        userId,
        JSON.stringify(body.symptoms),
        body.started,
        body.has_fever,
        body.note ?? null,
      ],
    );
    const episodeId = Number(ins.rows[0].id);
    // Notifications v1 §E — enqueue the first daily sick check for tomorrow 07:15.
    try {
      const fireAt = nextMorning0715(new Date());
      const dateIso = fireAt.toISOString().slice(0, 10);
      const tpl = renderSickCheck({
        user_id: userId,
        episode_id: episodeId,
        date_iso: dateIso,
        days_active: 1,
      });
      await enqueueNotification(userId, tpl, fireAt);
    } catch { /* non-blocking */ }
    return NextResponse.json({ episode_id: episodeId, active: true });
  } catch (err: any) {
    return NextResponse.json({
      error: 'sick insert failed',
      detail: err?.message ?? String(err),
      hint: 'Did you apply web-v2/db/migrations/117_sick_episodes.sql?',
    }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  try {
    await pool.query(
      `UPDATE sick_episodes
          SET cleared_at = now()
        WHERE id = (
          SELECT id FROM sick_episodes
           WHERE COALESCE(user_uuid, user_id) = $1 AND cleared_at IS NULL
           ORDER BY logged_at DESC
           LIMIT 1
        )`,
      [userId],
    );
    return NextResponse.json({ active: false });
  } catch (err: any) {
    return NextResponse.json({
      error: 'sick delete failed',
      detail: err?.message ?? String(err),
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
