/**
 * GET /api/notifications/inbox?days=14&limit=50
 *
 * Recent push-notification history for the signed-in runner · the
 * read-side of notifications_log. Drives the iPhone bell-sheet's
 * "past nudges" tab so the runner can scan what Faff has sent + ack
 * pending items without leaving the app.
 *
 * Returns rows in fired-at-DESC order, hiding apns-failed sends from
 * the inbox (they never landed on device).
 *
 * Response shape (lenient on client):
 *   { ok, items: [{ id, category, title, body, fired_at, delivered, ack_action, ack_at, dedup_key }] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const days  = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get('days') ?? '14')));
  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? '50')));

  try {
    const rows = (await pool.query(
      `SELECT id, category,
              payload->'aps'->'alert'->>'title' AS title,
              payload->'aps'->'alert'->>'body'  AS body,
              fired_at::text AS fired_at,
              delivered,
              ack_action,
              ack_at::text AS ack_at,
              dedup_key
         FROM notifications_log
        WHERE user_id = $1
          AND fired_at > NOW() - ($2 || ' days')::interval
          AND (delivered IS NULL OR delivered = true)
        ORDER BY fired_at DESC
        LIMIT $3`,
      [userId, String(days), limit],
    )).rows;

    const items = rows.map((r: any) => ({
      id: Number(r.id),
      category: String(r.category),
      title: r.title ?? '',
      body: r.body ?? '',
      fired_at: String(r.fired_at),
      delivered: r.delivered == null ? null : Boolean(r.delivered),
      ack_action: r.ack_action ?? null,
      ack_at: r.ack_at ?? null,
      dedup_key: r.dedup_key ?? null,
    }));

    return NextResponse.json({ ok: true, items });
  } catch (err: any) {
    console.error('[api/notifications/inbox] failed:', err);
    return NextResponse.json({ ok: false, items: [], error: err?.message ?? 'lookup failed' }, { status: 500 });
  }
}
