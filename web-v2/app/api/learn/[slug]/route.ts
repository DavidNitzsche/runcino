/**
 * GET /api/learn/[slug] — JSON view of a single learn article for the modal.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const r = (await pool.query(
      `SELECT slug, title, eyebrow, body_md, citations_json, related_slugs
         FROM learn_articles WHERE slug = $1`,
      [slug]
    )).rows[0];
    if (r) return NextResponse.json(r);
  } catch { /* fall through to seed */ }
  // Mirror the SEED in app/learn/[slug]/page.tsx — keeping the modal usable
  // even when the DB isn't seeded. Source of truth is the page file.
  const { SEED } = await import('@/app/learn/[slug]/seed');
  const seed = SEED[slug];
  if (seed) return NextResponse.json(seed);
  return NextResponse.json({ error: 'not found' }, { status: 404 });
}
