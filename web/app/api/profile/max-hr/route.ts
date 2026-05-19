/**
 * GET  /api/profile/max-hr → resolved max HR for the user
 * POST /api/profile/max-hr → set/clear the manual override
 *
 * The response shape is the same for both:
 *   { value: number | null, source: 'manual' | 'computed' | 'none',
 *     computed: { value, source: { id, name, date, workoutType, distanceMi } } | null }
 *
 * The /profile HR Zones card uses this to show what we know (and from
 * where) and lets the runner override it if Strava's reading is off.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireActiveUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { resolveEffectiveMaxHr, computeMaxHrFromActivities } from '@/lib/compute-max-hr';

async function buildPayload(userId: string) {
  const resolved = await resolveEffectiveMaxHr(userId);
  const computed = resolved.source === 'computed'
    ? resolved.computed ?? null
    : await computeMaxHrFromActivities(userId);
  return {
    value: resolved.value,
    source: resolved.source,
    computed,
  };
}

export async function GET() {
  let user;
  try { user = await requireActiveUser(); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  return NextResponse.json({ ok: true, ...(await buildPayload(user.id)) });
}

export async function POST(req: NextRequest) {
  let user;
  try { user = await requireActiveUser(); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  let body: { maxHr?: number | null };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const v = body.maxHr;
  // null/undefined clears the override; otherwise must be in 100-230 range
  if (v !== null && v !== undefined) {
    if (typeof v !== 'number' || v < 100 || v > 230) {
      return NextResponse.json({ error: 'maxHr must be a number between 100 and 230, or null to clear' }, { status: 400 });
    }
  }
  await query(
    `UPDATE users
        SET max_hr = $2,
            -- Setting a new max HR clears any prior validation dismissal
            -- so the user can be re-prompted if their stored value
            -- diverges from race data in the future.
            max_hr_validation_dismissed_at = NULL,
            -- V7 item 4 · stamp max HR change so the Z2 sparkline
            -- cross-reference can detect recalibration within its
            -- window.  Cleared (NULL) when max HR is cleared too.
            max_hr_updated_at = CASE WHEN $2 IS NULL THEN NULL ELSE NOW() END,
            updated_at = NOW()
      WHERE id = $1`,
    [user.id, v ?? null],
  );
  return NextResponse.json({ ok: true, ...(await buildPayload(user.id)) });
}
