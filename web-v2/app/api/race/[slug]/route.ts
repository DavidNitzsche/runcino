/**
 * GET /api/race/[slug]
 *
 * P40 — JSON race detail for the iPhone RaceDetailSheet. Mirrors what
 * web /races/[slug] composes server-side: race meta + course geometry +
 * derived proximity mode.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { loadRacesState } from '@/lib/coach/races-state';
import { requireUserId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { slug } = await params;
  try {
    const races = await loadRacesState(userId);
    const race = [...races.aRaces, ...races.upcomingBs, ...races.upcomingCs, ...races.past]
      .find((r: any) => r?.slug === slug);
    if (!race) return NextResponse.json({ error: 'race not found' }, { status: 404 });

    // Scope course-geometry lookup by user_uuid so a slug guess can't leak
    // another runner's GPX even if a name collision would otherwise match.
    const geoRow = await pool.query(
      `SELECT course_geometry, course_source FROM races WHERE slug = $1 AND user_uuid = $2`,
      [slug, userId],
    ).catch(() => ({ rows: [] }));
    const courseGeometry = geoRow.rows[0]?.course_geometry ?? null;
    const courseSource = geoRow.rows[0]?.course_source ?? null;

    const proximity = (race as any).days < 0 ? 'post-race'
      : (race as any).days <= 7 ? 'race-week'
      : (race as any).days <= 60 ? 'sharpening'
      : 'building';

    return NextResponse.json({
      race,
      proximity,
      course_geometry: courseGeometry,
      course_source: courseSource,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
