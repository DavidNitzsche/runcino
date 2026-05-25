/**
 * /api/shoe
 *   POST   { brand, model, color?, run_types?, mileage_cap? }              create
 *   PATCH  { id, mileage?, mileage_cap?, run_types?, retired?, preferred? } update
 *   DELETE { id }                                                            delete
 *
 * Writes to shoes table. Idempotent on id for PATCH/DELETE.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { bustBriefingCache } from '@/lib/coach/cache';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export async function POST(req: NextRequest) {
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
        body.user_uuid ?? DAVID_USER_ID,
      ]
    );
    await bustBriefingCache(DAVID_USER_ID);
    return NextResponse.json({ ok: true, id: r.rows[0].id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

const ALLOWED_PATCH = new Set(['mileage', 'mileage_cap', 'run_types', 'retired', 'preferred', 'color', 'notes']);

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const cols: string[] = [];
  const vals: any[] = [body.id];
  for (const k of Object.keys(body)) {
    if (k === 'id') continue;
    if (!ALLOWED_PATCH.has(k)) continue;
    cols.push(`${k} = $${vals.length + 1}`);
    vals.push(body[k]);
  }
  if (cols.length === 0) {
    return NextResponse.json({ error: 'no allowed fields in body' }, { status: 400 });
  }

  try {
    const r = await pool.query(`UPDATE shoes SET ${cols.join(', ')} WHERE id = $1 RETURNING id`, vals);
    if (r.rowCount === 0) return NextResponse.json({ error: 'shoe not found' }, { status: 404 });
    await bustBriefingCache(DAVID_USER_ID);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  try {
    await pool.query(`DELETE FROM shoes WHERE id = $1`, [body.id]);
    await bustBriefingCache(DAVID_USER_ID);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
