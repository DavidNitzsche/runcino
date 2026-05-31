/**
 * /api/shoe
 *   GET                                                                     list
 *   POST   { brand, model, color?, run_types?, mileage_cap? }              create
 *   PATCH  { id, mileage?, mileage_cap?, run_types?, retired?, preferred? } update
 *   DELETE { id }                                                            delete
 *
 * Writes to shoes table. Idempotent on id for PATCH/DELETE.
 *
 * Audit 2026-05-27: GET was missing. fetch('/api/shoe') silently 405'd,
 * so the shoe picker on RunDetailModal has been empty since launch and
 * the iPhone LogView shoe prefetch returned nothing. Adding GET here +
 * embedding shoes in /api/runs/[id] fixes both paths.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { requireUserId } from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  // Shape mirrors getShoes() in lib/coach/tools.ts so the coach + UI
  // share the same field set. Ordered preferred-first then by mileage
  // descending so the main shoe appears at the top of the picker.
  // Retired shoes included so /profile can show them; the picker filters
  // them client-side.
  const rows = (await pool.query(
    `SELECT id, brand, model, color, color2, run_types,
            mileage::numeric AS mileage,
            mileage_cap::numeric AS mileage_cap,
            COALESCE(retired, false) AS retired,
            COALESCE(preferred, false) AS preferred,
            notes
       FROM shoes
      WHERE user_uuid = $1
      ORDER BY retired ASC, preferred DESC, mileage DESC NULLS LAST`,
    [userId]
  ).catch(() => ({ rows: [] }))).rows;
  return NextResponse.json({
    shoes: rows.map((s: any) => ({
      id: s.id,
      brand: s.brand,
      model: s.model,
      color: s.color,
      color2: s.color2,
      run_types: s.run_types ?? [],
      mileage: s.mileage == null ? null : Number(s.mileage),
      mileage_cap: s.mileage_cap == null ? null : Number(s.mileage_cap),
      retired: Boolean(s.retired),
      preferred: Boolean(s.preferred),
      notes: s.notes,
    })),
  }, {
    // Shoes change only on POST/PATCH/DELETE; short window means cache
    // hits absorb common reads while edits still propagate within ~2min.
    headers: { 'Cache-Control': 'private, max-age=120, stale-while-revalidate=30' },
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await req.json().catch(() => null);
  if (!body?.brand || !body?.model) {
    return NextResponse.json({ error: 'brand + model required' }, { status: 400 });
  }
  try {
    const r = await pool.query(
      `INSERT INTO shoes (brand, model, color, run_types, mileage, mileage_cap, retired, preferred, user_uuid)
       VALUES ($1, $2, $3, $4, COALESCE($5, 0), COALESCE($6, 400), false, false, $7)
       RETURNING id`,
      [
        body.brand,
        body.model,
        body.color ?? null,
        body.run_types ?? [],
        body.mileage ?? 0,
        body.mileage_cap ?? 400,
        userId,
      ]
    );
    await bustBriefingCacheForEvent(userId, 'shoe_crud');
    return NextResponse.json({ ok: true, id: r.rows[0].id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

const ALLOWED_PATCH = new Set(['mileage', 'mileage_cap', 'run_types', 'retired', 'preferred', 'color', 'color2', 'notes']);

export async function PATCH(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const cols: string[] = [];
  const vals: any[] = [body.id, userId];
  for (const k of Object.keys(body)) {
    if (k === 'id') continue;
    if (!ALLOWED_PATCH.has(k)) continue;
    cols.push(`${k} = $${vals.length + 1}`);
    vals.push(body[k]);
  }
  if (cols.length === 2) {
    return NextResponse.json({ error: 'no allowed fields in body' }, { status: 400 });
  }

  try {
    // Scope by user_uuid so a runner can't PATCH another runner's shoe by id.
    const r = await pool.query(
      `UPDATE shoes SET ${cols.join(', ')} WHERE id = $1 AND user_uuid = $2 RETURNING id`,
      vals,
    );
    if (r.rowCount === 0) return NextResponse.json({ error: 'shoe not found' }, { status: 404 });
    await bustBriefingCacheForEvent(userId, 'shoe_crud');
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  try {
    // Scope by user_uuid so a runner can't DELETE another runner's shoe by id.
    await pool.query(`DELETE FROM shoes WHERE id = $1 AND user_uuid = $2`, [body.id, userId]);
    await bustBriefingCacheForEvent(userId, 'shoe_crud');
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
