/**
 * POST /api/runs/dedupe-backfill — run the dedupe scan against ALL of the
 * caller's existing runs and write mergedIntoId on the lesser-source half
 * of each duplicate-session pair.
 *
 * Ingest-time dedupe (markLesserSourceAsMerged) only fires on new Strava
 * writes — rows already in the DB before that landed have no flag. This
 * endpoint fills the gap: idempotent, safe to re-run, returns a count of
 * how many rows it folded.
 *
 * Algorithm: load all of the user's activities, group by start-time
 * proximity (the same read-edge grouper that drives /log), then for every
 * non-canonical row in a group write mergedIntoId = canonicalId. Respects
 * keep-separate overrides (those rows stay un-flagged).
 */

import { NextResponse } from 'next/server';
import { requireActiveUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { dedupeRunsForDisplay } from '@/lib/dedupe-runs';
import { loadMergeOverrides } from '@/lib/run-merge-overrides';
import type { NormalizedActivity } from '@/app/api/strava/activities/route-shared';

export async function POST() {
  let user;
  try {
    user = await requireActiveUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Load ALL rows for the user — including ones already flagged, so the
    // grouper can re-evaluate if a previous fold was wrong. Lifts the
    // cache's mergedIntoId filter for this scan.
    const rows = await query<{ id: string; data: Record<string, unknown> }>(
      `SELECT id::text AS id, data
         FROM strava_activities
        WHERE (user_uuid = $1 OR user_uuid IS NULL)
        ORDER BY (data->>'startLocal') DESC`,
      [user.id],
    );

    // Map raw rows to the shape the grouper expects.
    const asNormalized: NormalizedActivity[] = rows.map((r) => {
      const d = r.data as {
        startLocal?: string; date?: string; name?: string;
        distanceMi?: number; movingTimeS?: number; avgHr?: number; type?: string;
      };
      return {
        id: Number(r.id),
        name: d.name || 'Run',
        type: d.type || 'Run',
        sportType: null,
        workoutType: null,
        startLocal: d.startLocal || '',
        date: d.date || (d.startLocal || '').slice(0, 10),
        distanceMi: Number(d.distanceMi) || 0,
        movingTimeS: Number(d.movingTimeS) || 0,
        elapsedTimeS: Number(d.movingTimeS) || 0,
        paceSPerMi: 0,
        avgHr: d.avgHr != null ? Number(d.avgHr) : null,
        maxHr: null,
        avgCadence: null,
        elevGainFt: 0,
        avgSpeedMph: null,
        startLatLng: null,
        endLatLng: null,
        summaryPolyline: null,
        kudosCount: 0,
        achievementCount: 0,
        sufferScore: null,
        canonicalFinishS: null,
        canonicalDistanceMi: null,
        canonicalLabel: null,
      };
    });

    const overrides = await loadMergeOverrides(user.id);
    const deduped = dedupeRunsForDisplay(asNormalized, overrides);

    // For every group with merged sources: write mergedIntoId on each
    // source pointing at the canonical. Also clear stale mergedIntoId on
    // canonicals (in case a previous fold direction reversed).
    let foldedCount = 0;
    for (const canonical of deduped) {
      // Clear flag on the canonical so it surfaces.
      await query(
        `UPDATE strava_activities
            SET data = data - 'mergedIntoId'
          WHERE id = $1::BIGINT
            AND (user_uuid = $2 OR user_uuid IS NULL)
            AND data ? 'mergedIntoId'`,
        [canonical.id, user.id],
      );
      for (const src of canonical.mergedSources) {
        await query(
          `UPDATE strava_activities
              SET data = jsonb_set(data, '{mergedIntoId}', to_jsonb($1::BIGINT))
            WHERE id = $2::BIGINT
              AND (user_uuid = $3 OR user_uuid IS NULL)`,
          [canonical.id, src.id, user.id],
        );
        foldedCount += 1;
      }
    }

    return NextResponse.json({ ok: true, scanned: rows.length, folded: foldedCount });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'dedupe backfill failed' },
      { status: 500 },
    );
  }
}
