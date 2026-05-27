/**
 * POST /api/race/gpx   (multipart/form-data: slug + file)
 *
 * §8.2 GPX ingestion (vector 1: upload). Parses the file into
 * CourseGeometry, writes to races.course_geometry, sets
 * races.course_source = 'upload'.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { parseGPX } from '@/lib/race/gpx-parser';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let form: FormData;
  try { form = await req.formData(); }
  catch { return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 }); }

  const slug = String(form.get('slug') ?? '').trim();
  const file = form.get('file') as File | null;
  if (!slug)  return NextResponse.json({ error: 'slug required' }, { status: 400 });
  if (!file)  return NextResponse.json({ error: 'file required' }, { status: 400 });
  if (file.size > 8 * 1024 * 1024) {
    return NextResponse.json({ error: 'file too large (max 8MB)' }, { status: 400 });
  }

  const text = await file.text();
  // Sniff format
  let geometry;
  try {
    if (text.includes('<gpx') || file.name.toLowerCase().endsWith('.gpx')) {
      geometry = parseGPX(text, file.name);
    } else {
      return NextResponse.json({
        error: 'Only .gpx supported for now. TCX + FIT land in a follow-up.',
      }, { status: 415 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: `Parse failed: ${e.message}` }, { status: 400 });
  }

  try {
    const updated = await pool.query(
      `UPDATE races
          SET course_geometry = $1,
              course_source = 'upload'
        WHERE slug = $2
      RETURNING slug`,
      [geometry, slug]
    );
    if (updated.rowCount === 0) {
      return NextResponse.json({ error: 'race not found' }, { status: 404 });
    }
    // Race-detail and races-page coaches frame the season; a fresh course
    // changes the elevation/grade context. Bust + warm.
    await bustBriefingCacheForEvent(DAVID_USER_ID, 'race_crud');
    return NextResponse.json({
      ok: true,
      slug,
      summary: {
        points: geometry.trackPoints.length,
        distance_mi: geometry.distance_mi,
        elevation_gain_ft: geometry.elevation_gain_ft,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
