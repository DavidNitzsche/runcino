/**
 * POST /api/race/strava-course
 *
 * Fetches a public Strava route as GPX using the user's existing OAuth token,
 * then attaches it to the race exactly like /api/race/gpx (file upload).
 *
 * Body: { slug: string, strava_url: string }
 *   strava_url — any of:
 *     https://www.strava.com/routes/3012345678
 *     https://www.strava.com/routes/3012345678/edit
 *
 * The route must be public. The user must have Strava connected.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { parseGPX } from '@/lib/race/gpx-parser';
import { getStravaToken } from '@/lib/strava/auth';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { requireUserId } from '@/lib/auth/session';
import { promoteCourseFromRace } from '@/lib/courses/promote-from-race';

export const maxDuration = 30;

function extractRouteId(url: string): string | null {
  const m = url.match(/strava\.com\/routes\/(\d+)/);
  return m ? m[1] : null;
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const body = await req.json().catch(() => null);
  const slug = String(body?.slug ?? '').trim();
  const stravaUrl = String(body?.strava_url ?? '').trim();

  if (!slug)      return NextResponse.json({ error: 'slug required' }, { status: 400 });
  if (!stravaUrl) return NextResponse.json({ error: 'strava_url required' }, { status: 400 });

  const routeId = extractRouteId(stravaUrl);
  if (!routeId) {
    return NextResponse.json({
      error: 'Could not parse a route ID from that URL. Expected strava.com/routes/{id}.',
    }, { status: 400 });
  }

  // Get (and auto-refresh) the user's Strava token.
  let token: string;
  try {
    token = await getStravaToken(userId);
  } catch {
    return NextResponse.json({
      error: 'Strava not connected. Connect Strava in Settings first.',
    }, { status: 403 });
  }

  // Fetch the GPX from Strava's export endpoint.
  const gpxResp = await fetch(
    `https://www.strava.com/api/v3/routes/${routeId}/export_gpx`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (gpxResp.status === 404) {
    return NextResponse.json({
      error: 'Route not found. Make sure the route is public and the URL is correct.',
    }, { status: 404 });
  }
  if (!gpxResp.ok) {
    return NextResponse.json({
      error: `Strava returned ${gpxResp.status}. The route may be private.`,
    }, { status: 502 });
  }

  const gpxText = await gpxResp.text();
  let geometry;
  try {
    geometry = parseGPX(gpxText, `strava-route-${routeId}.gpx`);
  } catch (e: any) {
    return NextResponse.json({ error: `GPX parse failed: ${e.message}` }, { status: 400 });
  }

  // Write to races table (scoped by user_uuid).
  const updated = await pool.query(
    `UPDATE races
        SET course_geometry = $1,
            course_source   = 'strava_route',
            gpx_text        = $2
      WHERE slug = $3 AND user_uuid = $4
    RETURNING slug`,
    [geometry, gpxText, slug, userId]
  );
  if (updated.rowCount === 0) {
    return NextResponse.json({ error: 'Race not found' }, { status: 404 });
  }

  await bustBriefingCacheForEvent(userId, 'race_crud');

  let promotion = null;
  try {
    const r = await promoteCourseFromRace({ userUuid: userId, raceId: slug });
    promotion = { action: r.action, source: r.source, contributor_count: r.contributor_count };
  } catch (e: any) {
    console.error('[race/strava-course] promotion failed (non-fatal):', e?.message ?? e);
  }

  return NextResponse.json({
    ok: true,
    slug,
    route_id: routeId,
    summary: {
      points: geometry.trackPoints.length,
      distance_mi: geometry.distance_mi,
      elevation_gain_ft: geometry.elevation_gain_ft,
    },
    promotion,
  });
}
