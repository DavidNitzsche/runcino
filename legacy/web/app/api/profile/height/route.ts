/**
 * GET  /api/profile/height — current height in cm (or null)
 * POST /api/profile/height — set or clear the height
 *
 * Body: { heightCm: number | null } where number is 120-230 (cm).
 * Wire shape on both methods: { value: number | null, units: 'cm' }.
 *
 * Height unlocks coach prescriptions that depend on leg length (cadence
 * research thresholds, stride-length-aware targets). Until set, the
 * coach defers any data-limited prescription and surfaces a profile_gap
 * card asking for it. See docs/coach/CARD_LIBRARY.md → profile_gap +
 * cadence_experiment suppression rules.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireActiveUser } from '@/lib/auth';
import { query } from '@/lib/db';

async function readHeight(userUuid: string): Promise<number | null> {
  // Read by user_uuid first, fall back to legacy user_id='me' rows for
  // pre-migration accounts. height_cm is NUMERIC(5,1) so coerce to Number.
  const r = await query<{ height_cm: string | null }>(
    `SELECT height_cm FROM profile
      WHERE user_uuid = $1 OR (user_uuid IS NULL AND user_id = 'me')
      ORDER BY (user_uuid = $1) DESC LIMIT 1`,
    [userUuid],
  );
  const v = r[0]?.height_cm;
  return v == null ? null : Number(v);
}

export async function GET() {
  let user;
  try { user = await requireActiveUser(); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  const value = await readHeight(user.id);
  return NextResponse.json({ ok: true, value, units: 'cm' });
}

export async function POST(req: NextRequest) {
  let user;
  try { user = await requireActiveUser(); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  let body: { heightCm?: number | null };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const v = body.heightCm;
  if (v !== null && v !== undefined) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 120 || v > 230) {
      return NextResponse.json(
        { error: 'heightCm must be a number 120-230 (cm), or null to clear' },
        { status: 400 },
      );
    }
  }

  // Update existing row, or insert if no profile row yet. Both branches
  // bind user_uuid so future reads find the value cleanly even if a
  // legacy 'me' row also exists.
  const updated = await query(
    `UPDATE profile SET height_cm = $2, updated_at = NOW()
      WHERE user_uuid = $1 OR (user_uuid IS NULL AND user_id = 'me')`,
    [user.id, v ?? null],
  );
  // pg driver returns rowCount via the wrapper but we don't expose it.
  // Detect "row missing" by reading back and inserting if empty.
  const after = await readHeight(user.id);
  if (after === null && v != null) {
    await query(
      `INSERT INTO profile (user_id, user_uuid, height_cm, updated_at)
       VALUES ('me', $1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET height_cm = EXCLUDED.height_cm, user_uuid = EXCLUDED.user_uuid, updated_at = NOW()`,
      [user.id, v],
    );
  }

  return NextResponse.json({ ok: true, value: v ?? null, units: 'cm' });
}
