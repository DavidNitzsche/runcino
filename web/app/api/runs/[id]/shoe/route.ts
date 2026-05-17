/**
 * POST /api/runs/:id/shoe — assign or clear a shoe for a Strava activity.
 *
 * Body: { shoeId: number | null }
 * Auth required. Currently writes to the legacy strava_activities table
 * (single-user). Multi-tenant query refactor later will filter by user_uuid.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  let body: { shoeId?: number | null };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const shoeId = typeof body.shoeId === 'number' ? body.shoeId : null;

  try {
    await query(
      `UPDATE strava_activities SET shoe_id = $1 WHERE id = $2;`,
      [shoeId, parseInt(id, 10)],
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'update failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
