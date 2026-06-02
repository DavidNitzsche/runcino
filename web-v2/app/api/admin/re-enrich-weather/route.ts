/**
 * GET /api/admin/re-enrich-weather?date=YYYY-MM-DD
 * GET /api/admin/re-enrich-weather?id=<runs.id>
 *
 * Forces a fresh weather enrichment for one run · clears the existing
 * data.weather + data.tempF + weather_enriched_at, then re-calls
 * enrichOneActivity (which now picks forecast-api vs archive-api by
 * age · see lib/weather/openmeteo.ts weatherHost()).
 *
 * Use this when:
 *   · A run was enriched while the archive-api was returning stale /
 *     interpolated data for the recent past (the 57°F-in-Burbank bug
 *     David flagged on his interval workout).
 *   · A run's weather feels obviously wrong and you want to force a
 *     re-fetch without waiting for the weekly retry path.
 *
 * Returns the before/after payload so the requester can confirm the
 * new fetch landed real data instead of the stale value.
 *
 * Doctrine · OPERATIONAL: agent-built diagnostic, scoped to the caller's
 * runs only, agent self-executes per CLAUDE.md.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { enrichOneActivity } from '@/lib/weather/openmeteo';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const url = new URL(req.url);
  const date = url.searchParams.get('date');
  const idParam = url.searchParams.get('id');
  if (!date && !idParam) {
    return NextResponse.json({
      error: 'pass ?date=YYYY-MM-DD (most recent run on that date) or ?id=<runs.id>',
    }, { status: 400 });
  }

  try {
    // 1. Find the row · scoped to the caller's userId so a wrong guess
    //    can't touch another runner's data.
    let row: { id: string; data: any; weather_enriched_at: string | null } | undefined;
    if (idParam) {
      row = (await pool.query(
        `SELECT id, data, weather_enriched_at FROM runs
          WHERE user_uuid = $1 AND id = $2::BIGINT LIMIT 1`,
        [userId, idParam],
      )).rows[0];
    } else {
      row = (await pool.query(
        `SELECT id, data, weather_enriched_at FROM runs
          WHERE user_uuid = $1
            AND NOT (data ? 'mergedIntoId')
            AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) = $2
          ORDER BY (data->>'startLocal') DESC NULLS LAST
          LIMIT 1`,
        [userId, date],
      )).rows[0];
    }
    if (!row) {
      return NextResponse.json({ error: 'no matching run for this user' }, { status: 404 });
    }

    const before = {
      id: String(row.id),
      source: row.data?.source ?? null,
      startLocal: row.data?.startLocal ?? null,
      startLat: row.data?.startLat ?? row.data?.start_latitude ?? null,
      startLng: row.data?.startLng ?? row.data?.start_longitude ?? null,
      tempF: row.data?.tempF ?? null,
      weather: row.data?.weather ?? null,
      weather_enriched_at: row.weather_enriched_at,
    };

    // 2. Clear so enrichOneActivity doesn't short-circuit on the cached
    //    row.data.weather. Strip the weather + tempF keys and null the
    //    enriched_at flag.
    await pool.query(
      `UPDATE runs
          SET data = (data - 'weather' - 'tempF'),
              weather_enriched_at = NULL
        WHERE id = $1::BIGINT
          AND user_uuid = $2`,
      [String(row.id), userId],
    );

    // 3. Re-enrich · now uses forecast-api for recent runs (last 5 days),
    //    archive-api for older. Same return shape.
    const enriched = await enrichOneActivity(String(row.id));

    // 4. Read back the persisted row to confirm the UPDATE landed
    //    (enrichOne does its own UPDATE; this is the source of truth).
    const after = (await pool.query(
      `SELECT data, weather_enriched_at FROM runs WHERE id = $1::BIGINT LIMIT 1`,
      [String(row.id)],
    )).rows[0];

    return NextResponse.json({
      ok: true,
      runId: String(row.id),
      before,
      enrichmentReturned: enriched,
      after: {
        tempF: after?.data?.tempF ?? null,
        weather: after?.data?.weather ?? null,
        weather_enriched_at: after?.weather_enriched_at,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
