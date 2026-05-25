/**
 * /api/coach-known-terms — terms the runner has already seen the
 * fun_fact for. Suppresses repeated explainers across briefings.
 *
 * GET  → { terms: string[] }
 * POST { term: string } → adds term to profile.known_terms[]
 *
 * Called when the runner taps "Got it" on a fun_fact card. The next
 * briefing reads profile.known_terms and skips emitting a fun_fact for
 * any term in the list.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireActiveUser } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET() {
  let user;
  try { user = await requireActiveUser(); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  const r = await query<{ known_terms: string[] | null }>(
    `SELECT known_terms FROM profile
      WHERE user_uuid = $1 OR (user_uuid IS NULL AND user_id = 'me')
      ORDER BY (user_uuid = $1) DESC LIMIT 1`,
    [user.id],
  );
  return NextResponse.json({ ok: true, terms: r[0]?.known_terms ?? [] });
}

export async function POST(req: NextRequest) {
  let user;
  try { user = await requireActiveUser(); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  let body: { term?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const term = (body.term ?? '').trim();
  if (!term || term.length > 40) {
    return NextResponse.json({ error: 'term required (1-40 chars)' }, { status: 400 });
  }

  // Append to known_terms array if not already present. ARRAY_APPEND is
  // dup-safe via the WHERE NOT IN check.
  await query(
    `UPDATE profile
        SET known_terms = ARRAY(SELECT DISTINCT unnest(known_terms || ARRAY[$2::TEXT])),
            updated_at = NOW()
      WHERE user_uuid = $1 OR (user_uuid IS NULL AND user_id = 'me')`,
    [user.id, term],
  );

  return NextResponse.json({ ok: true, term });
}
