/**
 * POST /api/profile/max-hr/validate/dismiss
 *
 * Suppresses the max-HR validation banner for 30 days. The validator
 * (lib/validate-max-hr.ts) still re-fires within the window if a NEW
 * validated peak exceeds stored max by 3+ bpm — that's the "new
 * evidence" override.
 */

import { NextResponse } from 'next/server';
import { requireActiveUser } from '@/lib/auth';
import { query } from '@/lib/db';

export async function POST() {
  let user;
  try { user = await requireActiveUser(); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  await query(
    `UPDATE users SET max_hr_validation_dismissed_at = NOW() WHERE id = $1`,
    [user.id],
  );
  return NextResponse.json({ ok: true });
}
