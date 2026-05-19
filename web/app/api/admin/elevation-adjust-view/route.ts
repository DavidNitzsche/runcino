/**
 * GET /api/admin/elevation-adjust-view
 *
 * Diagnostic for S3 elevation-adjusted finish times. Surfaces every
 * race in the user's calendar with elevation data, showing raw +
 * adjusted finish times and the hilly-threshold check.
 *
 * Read-only. opt-token or admin session.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireAdminOrOpToken } from '@/lib/auth';
import { query } from '@/lib/db';
import { computeElevationAdjustment } from '@/lib/elevation-adjust';

function fmtTime(s: number): string {
  if (!s || s <= 0) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

interface ResultRow {
  slug: string;
  name: string;
  date: string;
  distance_mi: string;
  finish_s: string;
  elev_gain_ft: string | null;
}

export async function GET(req: NextRequest) {
  const admin = await requireAdminOrOpToken(req);

  // Pull races with results + look up linked Strava elevation
  // (actual_result.activityId → strava_activities.data.elevGainFt).
  const rows = await query<ResultRow>(
    `SELECT r.slug, r.meta->>'name' AS name, r.meta->>'date' AS date,
            (r.meta->>'distanceMi')::TEXT AS distance_mi,
            (r.actual_result->>'finishS')::TEXT AS finish_s,
            COALESCE(
              (SELECT (s.data->>'elevGainFt')::TEXT
                 FROM strava_activities s
                WHERE s.id = (r.actual_result->>'activityId')::BIGINT
                LIMIT 1),
              NULL
            ) AS elev_gain_ft
       FROM races r
      WHERE (r.user_uuid = $1 OR r.user_uuid IS NULL)
        AND r.actual_result IS NOT NULL
        AND (r.actual_result->>'finishS')::NUMERIC > 0
      ORDER BY r.meta->>'date' DESC`,
    [admin.id],
  );

  const results = rows.map((r) => {
    const rawFinishS = Number(r.finish_s);
    const distanceMi = Number(r.distance_mi);
    const elevGainFt = r.elev_gain_ft != null ? Number(r.elev_gain_ft) : null;
    if (elevGainFt == null || !Number.isFinite(elevGainFt) || elevGainFt <= 0) {
      return {
        slug: r.slug,
        name: r.name,
        date: r.date,
        distanceMi,
        rawFinish: fmtTime(rawFinishS),
        elevGainFt: null,
        adjustmentApplicable: false,
        note: 'No elevation data linked to race result.',
      };
    }
    const adj = computeElevationAdjustment(rawFinishS, elevGainFt, distanceMi);
    return {
      slug: r.slug,
      name: r.name,
      date: r.date,
      distanceMi,
      rawFinish: fmtTime(adj.rawFinishS),
      elevGainFt: adj.elevGainFt,
      elevPerMi: adj.elevPerMi,
      adjustedFinish: fmtTime(adj.adjustedFinishS),
      adjustmentSeconds: adj.adjustmentSeconds,
      isSignificantlyHilly: adj.isSignificantlyHilly,
      adjustmentApplicable: true,
    };
  });

  return NextResponse.json({
    note: 'S3 elevation adjustment. Aggregate VDOT will use adjusted value when course is significantly hilly (≥50 ft/mi); user can override.',
    results,
  });
}
