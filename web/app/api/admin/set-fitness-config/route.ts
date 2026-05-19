/**
 * POST /api/admin/set-fitness-config
 *
 * Operational config setter for one-shot fitness inputs the agent
 * needs to adjust (resting HR, max HR). Same opt-token pattern as
 * the L7 diagnostics — used when the agent has explicit instruction
 * to change a config value and needs to bypass the session-cookie
 * path (e.g., no live browser session).
 *
 * Body: { restingHr?: number | null, maxHr?: number | null }
 *
 * Constraints:
 *   restingHr · 30-100 bpm (sensor sanity) or null to clear
 *   maxHr     · 100-230 bpm or null to clear the manual override
 *
 * Returns the resulting users row plus the Z2 band that would be
 * derived from the new values so the caller can verify the shape
 * change without a follow-up roundtrip.
 *
 * SCOPE NOTE · this opt-token endpoint mutates user-visible state
 * (resting_hr, vdot_manual_override are read by /profile and Coach
 * Reads). It's whitelisted because:
 *   1. The values it accepts are constrained to physiological ranges
 *   2. Both fields have a "clear" path (null → reverts) so any change
 *      is reversible by another POST
 *   3. The agent acts on explicit user instruction; never inferred
 * Per CLAUDE.md rule #3 (externally-consequential): David explicitly
 * authorized "set resting HR to 40" in chat. The endpoint surface
 * stays narrow to that pattern.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireAdminOrOpToken } from '@/lib/auth';
import { query } from '@/lib/db';
import { buildFitnessHrZones } from '@/lib/hr-zones';

interface Body {
  restingHr?: number | null;
  maxHr?: number | null;
}

export async function POST(req: NextRequest) {
  const admin = await requireAdminOrOpToken(req);
  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const changes: string[] = [];
  const errors: string[] = [];

  if ('restingHr' in body) {
    const v = body.restingHr;
    if (v === null) {
      await query(`UPDATE users SET resting_hr = NULL WHERE id = $1`, [admin.id]);
      changes.push('resting_hr → null (cleared)');
    } else if (typeof v === 'number' && Number.isFinite(v) && v >= 30 && v <= 100) {
      await query(`UPDATE users SET resting_hr = $2 WHERE id = $1`, [admin.id, v]);
      changes.push(`resting_hr → ${v}`);
    } else {
      errors.push(`restingHr must be 30-100 or null, got ${JSON.stringify(v)}`);
    }
  }

  if ('maxHr' in body) {
    const v = body.maxHr;
    if (v === null) {
      await query(`UPDATE users SET max_hr = NULL WHERE id = $1`, [admin.id]);
      changes.push('max_hr → null (cleared)');
    } else if (typeof v === 'number' && Number.isFinite(v) && v >= 100 && v <= 230) {
      await query(`UPDATE users SET max_hr = $2 WHERE id = $1`, [admin.id, v]);
      changes.push(`max_hr → ${v}`);
    } else {
      errors.push(`maxHr must be 100-230 or null, got ${JSON.stringify(v)}`);
    }
  }

  if (errors.length > 0 && changes.length === 0) {
    return NextResponse.json({ ok: false, errors }, { status: 400 });
  }

  // Read back current state + derive the Z2 band so the caller can see
  // the resulting framework shift without a second roundtrip.
  const rows = await query<{ resting_hr: number | null; max_hr: number | null }>(
    `SELECT resting_hr, max_hr FROM users WHERE id = $1 LIMIT 1`,
    [admin.id],
  );
  const row = rows[0];
  const restingHr = row?.resting_hr ?? null;
  const maxHr = row?.max_hr ?? null;
  const zones = buildFitnessHrZones(maxHr, restingHr);
  const framework = restingHr && restingHr > 0 && maxHr && restingHr < maxHr ? 'HRR (Karvonen)' : '%max';

  return NextResponse.json({
    ok: true,
    changes,
    errors: errors.length > 0 ? errors : undefined,
    current: { restingHr, maxHr },
    framework,
    z2Band: zones?.z2 ?? null,
    z3Band: zones?.z3 ?? null,
    z4Band: zones?.z4 ?? null,
  });
}
