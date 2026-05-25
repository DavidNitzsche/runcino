/**
 * GET /api/profile/max-hr/validate
 *
 * Returns the max HR validation verdict, top peaks, race-anchored
 * estimate, and a recommendation flag (peak-exceeds-current,
 * race-suggests-higher, looks-correct, insufficient-data).
 *
 * The UI uses this to render a hint banner on /profile's Coach
 * Reads card. No mutations; applying the suggested value still goes
 * through /api/profile/max-hr (POST) with explicit user confirmation.
 */

import { NextResponse } from 'next/server';
import { requireActiveUser } from '@/lib/auth';
import { resolveEffectiveMaxHr } from '@/lib/compute-max-hr';
import { validateMaxHr } from '@/lib/validate-max-hr';

export async function GET() {
  let user;
  try { user = await requireActiveUser(); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  const resolved = await resolveEffectiveMaxHr(user.id);
  const verdict = await validateMaxHr(user.id, resolved.value);
  return NextResponse.json(verdict);
}
