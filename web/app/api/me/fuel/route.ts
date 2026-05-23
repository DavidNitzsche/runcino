/**
 * POST /api/me/fuel
 *
 * The runner sets (or updates) their chosen gel product so the training-
 * fueling planner (lib/training-fueling.ts) plans the right NUMBER of gels
 * for the actual product they'll pull from the cupboard, and the watch can
 * prompt by product name ("Maurten 100 now") instead of generic "gel".
 *
 * Body: { brand?: string | null, gelCarbsG?: number | null, targetGPerHr?: number | null }
 *   - brand:        display name, e.g. "Maurten 100", "GU Roctane"
 *   - gelCarbsG:    carbs in one packet (typical 22–44 g; DB CHECK 10–80)
 *   - targetGPerHr: race-day carb-intake target (60–90 typical; DB CHECK 30–120)
 *   - any field omitted → leaves that field unchanged.
 *
 * Response: { ok, fuel: { brand, gelCarbsG, targetGPerHr } }
 *
 * Auth: Bearer access token (native).  Cookie also accepted for the web client.
 *
 * Idempotent — safe to re-send.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';

const MAX_BRAND_LEN = 64;
const MIN_GEL_G = 10;
const MAX_GEL_G = 80;
const MIN_TARGET = 30;
const MAX_TARGET = 120;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.status !== 'active') {
    return NextResponse.json({ error: 'Account not active', status: user.status }, { status: 403 });
  }

  let body: { brand?: unknown; gelCarbsG?: unknown; targetGPerHr?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Brand: string or explicit null (null clears). Trim and bound.
  let brand: string | null | undefined;
  if (body.brand === null) brand = null;
  else if (typeof body.brand === 'string') {
    const t = body.brand.trim();
    if (t.length === 0) brand = null;
    else if (t.length > MAX_BRAND_LEN) {
      return NextResponse.json({ error: `brand must be ≤${MAX_BRAND_LEN} chars` }, { status: 400 });
    } else brand = t;
  }

  // Gel carbs: integer in [10, 80] or null. Reject 0/negative/fractional silently nudge by rounding.
  let gelCarbsG: number | null | undefined;
  if (body.gelCarbsG === null) gelCarbsG = null;
  else if (typeof body.gelCarbsG === 'number' && Number.isFinite(body.gelCarbsG)) {
    const n = Math.round(body.gelCarbsG);
    if (n < MIN_GEL_G || n > MAX_GEL_G) {
      return NextResponse.json({ error: `gelCarbsG must be ${MIN_GEL_G}..${MAX_GEL_G}` }, { status: 400 });
    }
    gelCarbsG = n;
  }

  // Target g/hr: integer in [30, 120] or null.
  let targetGPerHr: number | null | undefined;
  if (body.targetGPerHr === null) targetGPerHr = null;
  else if (typeof body.targetGPerHr === 'number' && Number.isFinite(body.targetGPerHr)) {
    const n = Math.round(body.targetGPerHr);
    if (n < MIN_TARGET || n > MAX_TARGET) {
      return NextResponse.json({ error: `targetGPerHr must be ${MIN_TARGET}..${MAX_TARGET}` }, { status: 400 });
    }
    targetGPerHr = n;
  }

  // Build a partial UPDATE that only touches what was supplied.
  const sets: string[] = [];
  const params: unknown[] = [user.id];
  if (brand !== undefined)        { params.push(brand);        sets.push(`fuel_brand = $${params.length}`); }
  if (gelCarbsG !== undefined)    { params.push(gelCarbsG);    sets.push(`fuel_gel_carbs_g = $${params.length}`); }
  if (targetGPerHr !== undefined) { params.push(targetGPerHr); sets.push(`fuel_target_g_per_hr = $${params.length}`); }

  if (sets.length === 0) {
    return NextResponse.json({ ok: true, fuel: {
      brand: user.fuelBrand, gelCarbsG: user.fuelGelCarbsG, targetGPerHr: user.fuelTargetGPerHr,
    }});
  }

  sets.push(`updated_at = NOW()`);
  const rows = await query<{ brand: string | null; gelCarbsG: number | null; targetGPerHr: number | null }>(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $1
     RETURNING fuel_brand AS "brand", fuel_gel_carbs_g AS "gelCarbsG", fuel_target_g_per_hr AS "targetGPerHr"`,
    params,
  ).catch(() => [] as never[]);

  return NextResponse.json({
    ok: true,
    fuel: rows[0] ?? {
      brand: user.fuelBrand, gelCarbsG: user.fuelGelCarbsG, targetGPerHr: user.fuelTargetGPerHr,
    },
  });
}
