/**
 * PATCH /api/races/[slug]/priority
 *
 * Updates the priority / effort-level for a single race. The field
 * doubles as planning priority (A/B/C for macrocycle organization)
 * and aggregate-VDOT effort level (tune-up / training-run /
 * hilly-excluded for weighting).
 *
 * Body: { priority: 'A' | 'B' | 'C' | 'tune-up' | 'training-run' |
 *                   'hilly-excluded' }
 *
 * Returns the updated race meta. Auth required, user can only
 * edit their own races (or unclaimed legacy rows).
 *
 * Locked with David 2026-05-19 round 2: per-race effort level is
 * how the runner expresses "this was a tune-up, not an A-race
 * effort" so aggregate VDOT doesn't get dragged toward a sub-effort
 * race result.
 */

import { NextResponse } from 'next/server';
import { requireActiveUser } from '@/lib/auth';
import { query } from '@/lib/db';

const VALID_PRIORITIES = new Set<string>([
  'A', 'B', 'C', 'tune-up', 'training-run', 'hilly-excluded',
]);

export async function PATCH(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const user = await requireActiveUser();
    const { slug } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { priority?: string };
    const priority = body.priority;

    if (!priority || !VALID_PRIORITIES.has(priority)) {
      return NextResponse.json(
        {
          ok: false,
          error: `priority must be one of: ${Array.from(VALID_PRIORITIES).join(', ')}`,
        },
        { status: 400 },
      );
    }

    // Read existing meta, merge in the new priority, write back.
    const rows = await query<{ meta: Record<string, unknown> | null }>(
      `SELECT meta FROM races WHERE slug = $1 AND (user_uuid = $2 OR user_uuid IS NULL) LIMIT 1`,
      [slug, user.id],
    );
    const existing = rows[0];
    if (!existing) {
      return NextResponse.json({ ok: false, error: 'race not found' }, { status: 404 });
    }
    const newMeta = { ...(existing.meta ?? {}), priority };
    await query(
      `UPDATE races SET meta = $1::jsonb WHERE slug = $2 AND (user_uuid = $3 OR user_uuid IS NULL)`,
      [JSON.stringify(newMeta), slug, user.id],
    );
    return NextResponse.json({ ok: true, slug, priority, meta: newMeta });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isUnauth = /unauthorized/i.test(msg);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: isUnauth ? 401 : 500 },
    );
  }
}
