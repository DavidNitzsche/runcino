/**
 * POST /api/gpx/import
 *
 * Body: { raceSlug: string; source: 'strava_route'; sourceId: string }
 *
 * Fetches the GPX from the chosen source, parses it, and writes the
 * geometry onto races.course_geometry + sets course_source='strava_match'.
 *
 * After import, the race detail page renders the real polyline + elevation
 * curve instead of the schematic placeholder.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { userIdFromRequest } from '@/lib/auth/session';
import { fetchStravaRouteGpx } from '@/lib/gpx/finder';
import { parseGPX } from '@/lib/race/gpx-parser';
import { bustBriefingCache } from '@/lib/coach/cache';

export async function POST(req: NextRequest) {
  const userId = await userIdFromRequest(req);
  const body = await req.json().catch(() => null);
  if (!body || !body.raceSlug || !body.source || !body.sourceId) {
    return NextResponse.json({ error: 'raceSlug + source + sourceId required' }, { status: 400 });
  }

  // Verify the race belongs to the user before mutating.
  const race = (await pool.query(
    `SELECT id, name FROM races WHERE slug = $1 AND (user_uuid = $2 OR user_uuid IS NULL) LIMIT 1`,
    [body.raceSlug, userId]
  )).rows[0];
  if (!race) {
    return NextResponse.json({ error: 'race not found' }, { status: 404 });
  }

  // Fetch + parse GPX based on source.
  let gpxXml: string;
  try {
    switch (body.source) {
      case 'strava_route':
      case 'strava_starred':
        gpxXml = await fetchStravaRouteGpx(userId, String(body.sourceId));
        break;
      default:
        return NextResponse.json({ error: `unsupported source: ${body.source}` }, { status: 400 });
    }
  } catch (e: any) {
    console.error('[/api/gpx/import] fetch failed:', e?.message);
    return NextResponse.json({ error: `fetch failed: ${e?.message ?? 'unknown'}` }, { status: 502 });
  }

  let geometry;
  try {
    geometry = parseGPX(gpxXml);
    geometry.source = 'strava_match' as any;
  } catch (e: any) {
    return NextResponse.json({ error: `parse failed: ${e?.message ?? 'invalid gpx'}` }, { status: 422 });
  }

  // Persist
  try {
    await pool.query(
      `UPDATE races
          SET course_geometry = $1,
              course_source   = 'strava_match'
        WHERE id = $2`,
      [geometry, race.id]
    );
  } catch (e: any) {
    return NextResponse.json({ error: `persist failed: ${e?.message}` }, { status: 500 });
  }

  // Cache-bust: race detail page changes when course geometry lands.
  await bustBriefingCache(userId).catch(() => {});

  return NextResponse.json({
    ok: true,
    distanceMi: geometry.distance_mi,
    elevationGainFt: geometry.elevation_gain_ft,
    trackPointCount: geometry.trackPoints.length,
  });
}
