/**
 * /api/coach-intent — closed-loop commitments the runner made via cards.
 *
 * GET  ?kind=cadence_experiment&active=1 → list active intents (not yet
 *      fulfilled, valid_until in future). Used by the watch to know what
 *      to surface during the next run, by the briefing pipeline to check
 *      if a prior commitment landed.
 *
 * POST { kind, payload, validUntil? } → commit a new intent. Card CTAs
 *      like "Lock in for tomorrow" call this. payload is kind-specific
 *      (e.g. { target_spm: 168 } for cadence_experiment).
 *
 * POST :id/fulfill is a separate route handled below in nested folder.
 *
 * See docs/coach/CARD_LIBRARY.md for the contract per kind.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireActiveUser } from '@/lib/auth';
import { query } from '@/lib/db';

type Intent = {
  id: string;
  kind: string;
  payload: unknown;
  valid_from: string;
  valid_until: string | null;
  fulfilled_at: string | null;
  outcome: unknown;
  created_at: string;
};

const ALLOWED_KINDS = new Set([
  'cadence_experiment',
  'sleep_focus',
  'fueling_experiment',
  'pace_target',
]);

export async function GET(req: NextRequest) {
  let user;
  try { user = await requireActiveUser(); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  const kind = req.nextUrl.searchParams.get('kind');
  const activeOnly = req.nextUrl.searchParams.get('active') === '1';

  let sql = `SELECT id::text, kind, payload, valid_from, valid_until, fulfilled_at, outcome, created_at
               FROM coach_intent WHERE user_id = $1`;
  const params: unknown[] = [user.id];
  if (kind) { sql += ` AND kind = $${params.length + 1}`; params.push(kind); }
  if (activeOnly) {
    sql += ` AND fulfilled_at IS NULL AND (valid_until IS NULL OR valid_until > NOW())`;
  }
  sql += ` ORDER BY created_at DESC LIMIT 50`;

  const rows = await query<Intent>(sql, params);
  return NextResponse.json({ ok: true, intents: rows });
}

export async function POST(req: NextRequest) {
  let user;
  try { user = await requireActiveUser(); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  let body: { kind?: string; payload?: unknown; validUntil?: string | null };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { kind, payload, validUntil } = body;
  if (!kind || !ALLOWED_KINDS.has(kind)) {
    return NextResponse.json(
      { error: `kind required and must be one of: ${[...ALLOWED_KINDS].join(', ')}` },
      { status: 400 },
    );
  }
  if (payload == null || typeof payload !== 'object') {
    return NextResponse.json({ error: 'payload required (object)' }, { status: 400 });
  }

  // Light validation per kind — schema enforcement happens via the
  // card-library contract elsewhere; we just guard the obvious shapes.
  if (kind === 'cadence_experiment') {
    const p = payload as Record<string, unknown>;
    if (typeof p.target_spm !== 'number' || p.target_spm < 140 || p.target_spm > 200) {
      return NextResponse.json(
        { error: 'cadence_experiment payload requires target_spm (140-200)' },
        { status: 400 },
      );
    }
  }

  // Mark any prior active intent of the same kind as superseded so we
  // never have two competing live commitments at once.
  await query(
    `UPDATE coach_intent
        SET fulfilled_at = NOW(),
            outcome = jsonb_build_object('superseded_by_new_intent', true)
      WHERE user_id = $1 AND kind = $2 AND fulfilled_at IS NULL`,
    [user.id, kind],
  );

  const inserted = await query<{ id: string }>(
    `INSERT INTO coach_intent (user_id, kind, payload, valid_until)
     VALUES ($1, $2, $3::jsonb, $4)
     RETURNING id::text`,
    [user.id, kind, JSON.stringify(payload), validUntil ?? null],
  );

  return NextResponse.json({ ok: true, id: inserted[0]?.id ?? null, kind, payload });
}
