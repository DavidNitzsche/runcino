/**
 * /api/race
 *
 *   POST   { name, date, distance_label, priority, goal? }  → create
 *   PATCH  { slug, ...fields }                              → update
 *   DELETE { slug }                                         → delete
 *
 * Writes races.meta jsonb. Schema is already in place from legacy.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { bustBriefingCache } from '@/lib/coach/cache';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.name || !body?.date) {
    return NextResponse.json({ error: 'name + date required' }, { status: 400 });
  }
  const slug = slugify(`${body.name}-${body.date}`);
  const meta = {
    name: body.name,
    date: body.date,
    distanceLabel: body.distance_label ?? null,
    priority: body.priority ?? 'C',
    goalDisplay: body.goal ?? null,
    location: body.location ?? null,
  };

  try {
    await pool.query(
      `INSERT INTO races (slug, user_uuid, meta)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET meta = EXCLUDED.meta`,
      [slug, body.user_id ?? DAVID_USER_ID, meta]
    );
    await bustBriefingCache(body.user_id ?? DAVID_USER_ID);
    return NextResponse.json({ ok: true, slug });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });

  try {
    const existing = (await pool.query(`SELECT meta FROM races WHERE slug = $1`, [body.slug])).rows[0];
    if (!existing) return NextResponse.json({ error: 'race not found' }, { status: 404 });
    const meta = { ...existing.meta };
    for (const k of ['name', 'date', 'distance_label', 'priority', 'goal', 'location']) {
      if (body[k] !== undefined) {
        const metaKey = k === 'distance_label' ? 'distanceLabel' : k === 'goal' ? 'goalDisplay' : k;
        meta[metaKey] = body[k];
      }
    }
    await pool.query(`UPDATE races SET meta = $1 WHERE slug = $2`, [meta, body.slug]);
    await bustBriefingCache(DAVID_USER_ID);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });
  try {
    await pool.query(`DELETE FROM races WHERE slug = $1`, [body.slug]);
    await bustBriefingCache(DAVID_USER_ID);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
