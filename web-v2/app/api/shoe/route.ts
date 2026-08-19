/**
 * /api/shoe
 *   GET                                                                     list
 *   POST   { brand, model, color?, run_types?, shoe_type?, mileage_cap? }   create
 *   PATCH  { id, mileage?, mileage_cap?, shoe_type?, run_types?, retired?,
 *            preferred? }                                                  update
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
import { computeShoeMileage } from '@/lib/shoe/mileage';
import {
  coerceShoeType,
  isShoeType,
  resolveShoeCapMi,
  SHOE_TYPES,
} from '@/lib/shoe/lifespan';

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  // Shape mirrors getShoes() in lib/coach/tools.ts so the coach + UI
  // share the same field set. Ordered preferred-first then by mileage
  // descending so the main shoe appears at the top of the picker.
  // Retired shoes included so /profile can show them; the picker filters
  // them client-side.
  // Mileage is computed ON READ from canonical runs (lib/shoe/mileage.ts),
  // not read from the stale stored column. Order in JS afterward so the
  // mileage-desc sort uses the live value.
  const [rawRows, miles] = await Promise.all([
    pool.query(
      `SELECT id, brand, model, color, color2, run_types,
              mileage_cap::numeric AS mileage_cap,
              -- shoe_type read via to_jsonb so this query works whether or
              -- not migration 151 has been applied yet (it returns NULL for a
              -- column that does not exist, and NULL reads as the default
              -- category). Migrations here are applied by hand, so a query
              -- naming the column directly would 500 every read between the
              -- code deploy and the ALTER.
              to_jsonb(shoes.*) ->> 'shoe_type' AS shoe_type,
              COALESCE(baseline_mi, 0)::numeric AS baseline_mi,
              COALESCE(retired, false) AS retired,
              COALESCE(preferred, false) AS preferred,
              notes
         FROM shoes
        WHERE user_uuid = $1`,
      [userId]
    ).then((r) => r.rows).catch(() => [] as any[]),
    computeShoeMileage(userId),
  ]);
  const rows = rawRows
    .map((s: any) => ({ ...s, _mi: (miles.get(Number(s.id)) ?? 0) + Number(s.baseline_mi ?? 0) }))
    .sort((a: any, b: any) =>
      (a.retired === b.retired ? 0 : a.retired ? 1 : -1) ||
      (b.preferred === a.preferred ? 0 : b.preferred ? 1 : -1) ||
      b._mi - a._mi);
  return NextResponse.json({
    shoes: rows.map((s: any) => ({
      id: s.id,
      brand: s.brand,
      model: s.model,
      color: s.color,
      color2: s.color2,
      run_types: s.run_types ?? [],
      mileage: s._mi,
      // What the runner set, verbatim — null means "never said".
      mileage_cap: s.mileage_cap == null ? null : Number(s.mileage_cap),
      // Category, and the retirement mileage actually being drawn against.
      // `retire_at_mi` is the ONE number every client should use for a
      // progress bar: the runner's own cap when set, else doctrine's band
      // for that category (Research/17-footwear.md). Clients no longer
      // carry a fallback of their own.
      shoe_type: coerceShoeType(s.shoe_type),
      retire_at_mi: resolveShoeCapMi(s.shoe_type, s.mileage_cap),
      baseline_mi: Number(s.baseline_mi ?? 0),
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
  // An unknown category would silently become a daily trainer and quietly set
  // the wrong retirement mileage, so say so instead of guessing.
  if (body.shoe_type != null && !isShoeType(body.shoe_type)) {
    return NextResponse.json(
      { error: `unknown shoe_type: ${body.shoe_type}`, allowed: SHOE_TYPES },
      { status: 400 },
    );
  }
  // shoe_type joins the INSERT only when the caller actually sent one, so a
  // create still works on a database where migration 151 has not been applied
  // yet (the column would not exist to name). Callers that DO send a category
  // fail loudly there rather than silently dropping it.
  const cols = ['brand', 'model', 'color', 'run_types', 'mileage', 'mileage_cap', 'baseline_mi'];
  const vals: any[] = [
    body.brand,
    body.model,
    body.color ?? null,
    body.run_types ?? [],
    body.mileage ?? 0,
    // Stored NULL when the caller doesn't send one (was COALESCE(..., 400),
    // which baked one category's number into every shoe at write time and made
    // it impossible to tell "the runner chose 400" from "nobody said"). NULL
    // now means exactly that, and resolveShoeCapMi answers from the category.
    body.mileage_cap ?? null,
    body.baseline_mi ?? 0,
  ];
  if (body.shoe_type != null) {
    cols.push('shoe_type');
    vals.push(body.shoe_type);
  }
  cols.push('retired', 'preferred', 'user_uuid');
  vals.push(false, false, userId);
  try {
    const r = await pool.query(
      `INSERT INTO shoes (${cols.join(', ')})
       VALUES (${vals.map((_, i) => `$${i + 1}`).join(', ')})
       RETURNING id`,
      vals,
    );
    await bustBriefingCacheForEvent(userId, 'shoe_crud');
    return NextResponse.json({ ok: true, id: r.rows[0].id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

const ALLOWED_PATCH = new Set(['brand', 'model', 'mileage', 'mileage_cap', 'shoe_type', 'baseline_mi', 'run_types', 'retired', 'preferred', 'color', 'color2', 'notes']);

export async function PATCH(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  // Same guard as POST. `null` is allowed and meaningful: it clears the
  // category back to "nobody said", which reads as a daily trainer.
  if (body.shoe_type != null && !isShoeType(body.shoe_type)) {
    return NextResponse.json(
      { error: `unknown shoe_type: ${body.shoe_type}`, allowed: SHOE_TYPES },
      { status: 400 },
    );
  }

  const cols: string[] = [];
  const vals: any[] = [body.id, userId];
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
