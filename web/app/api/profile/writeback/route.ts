/**
 * POST /api/profile/writeback — toggle the strava_writeback setting.
 * Body: { enabled: boolean }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireActiveUser } from '@/lib/auth';
import { query } from '@/lib/db';

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireActiveUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: { enabled?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const enabled = !!body.enabled;
  await query(
    `UPDATE users SET strava_writeback = $2, updated_at = NOW() WHERE id = $1`,
    [user.id, enabled],
  );
  return NextResponse.json({ ok: true, enabled });
}

export async function GET() {
  let user;
  try {
    user = await requireActiveUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const rows = await query<{ enabled: boolean }>(
    `SELECT COALESCE(strava_writeback, TRUE) AS enabled FROM users WHERE id = $1 LIMIT 1`,
    [user.id],
  );
  return NextResponse.json({ ok: true, enabled: rows[0]?.enabled ?? true });
}
