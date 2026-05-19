/**
 * GET /api/admin/audit-races
 *
 * Admin-only. Surfaces gaps in the races table before the Option-B
 * source-of-truth fix lands (compute-vdot will prefer
 * races.actual_result.finishS over strava_activities.canonicalFinishS).
 *
 * Three reports in the response payload:
 *
 *   races[]        — every row, with curation status flag
 *   stravaRaces[]  — Strava race-tagged activities, linked-or-not to races
 *   divergences[]  — races where curated finishS differs from Strava's
 *
 * Doesn't modify anything — read-only. Visit in browser logged in as
 * admin; copy-paste the JSON or use the readable plain-text view at
 * the bottom of the response.
 *
 * This route mirrors the CLI script web/scripts/audit-races.ts but
 * removes the local-DB requirement: hit it on Railway where
 * DATABASE_URL is already set, no shell access needed.
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { query } from '@/lib/db';

interface RaceRow {
  slug: string;
  meta_name: string | null;
  meta_date: string | null;
  meta_distance_mi: number | null;
  actual_finish_s: number | null;
  actual_source: 'manual' | 'strava' | null;
  actual_strava_id: number | null;
}

interface StravaRaceRow {
  id: string;
  date: string;
  name: string;
  distance_mi: number;
  canonical_label: string | null;
  canonical_finish_s: number | null;
  moving_time_s: number;
  workout_type: number | null;
}

function fmtTime(s: number | null): string {
  if (s == null) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

export async function GET() {
  await requireAdmin();

  const races = await query<RaceRow>(`
    SELECT
      slug,
      meta->>'name'                                       AS meta_name,
      meta->>'date'                                       AS meta_date,
      (meta->>'distance_mi')::NUMERIC                     AS meta_distance_mi,
      (actual_result->>'finishS')::NUMERIC                AS actual_finish_s,
      actual_result->>'source'                            AS actual_source,
      (actual_result->>'stravaActivityId')::NUMERIC       AS actual_strava_id
    FROM races
    ORDER BY meta->>'date' DESC
  `);

  const stravaRaces = await query<StravaRaceRow>(`
    SELECT
      id::text                                           AS id,
      data->>'date'                                      AS date,
      COALESCE(data->>'name', '')                        AS name,
      (data->>'distanceMi')::NUMERIC                     AS distance_mi,
      data->>'canonicalLabel'                            AS canonical_label,
      (data->>'canonicalFinishS')::NUMERIC               AS canonical_finish_s,
      (data->>'movingTimeS')::NUMERIC                    AS moving_time_s,
      (data->>'workoutType')::INTEGER                    AS workout_type
    FROM strava_activities
    WHERE
      (data->>'workoutType')::INTEGER = 1
      OR data->>'canonicalLabel' IS NOT NULL
    ORDER BY data->>'date' DESC
    LIMIT 50
  `);

  // Curation flags per row
  const racesReport = races.map((r) => {
    let flag: 'no-curated-result' | 'strava-auto-verify' | 'manual-curated' | 'unknown' = 'unknown';
    if (r.actual_finish_s == null) flag = 'no-curated-result';
    else if (r.actual_source === 'strava') flag = 'strava-auto-verify';
    else if (r.actual_source === 'manual') flag = 'manual-curated';
    return {
      slug: r.slug,
      name: r.meta_name,
      date: r.meta_date,
      distanceMi: r.meta_distance_mi != null ? Number(r.meta_distance_mi) : null,
      actualFinishS: r.actual_finish_s != null ? Number(r.actual_finish_s) : null,
      actualFinishDisplay: fmtTime(r.actual_finish_s != null ? Number(r.actual_finish_s) : null),
      source: r.actual_source,
      stravaActivityId: r.actual_strava_id != null ? Number(r.actual_strava_id) : null,
      flag,
    };
  });

  // Match Strava race-activities against races rows
  const stravaReport = stravaRaces.map((a) => {
    const matchByDate = races.find((r) => {
      if (r.meta_date !== a.date) return false;
      if (r.meta_distance_mi == null || a.distance_mi == null) return false;
      return (
        Math.abs(Number(r.meta_distance_mi) - Number(a.distance_mi)) / Number(a.distance_mi) < 0.05
      );
    });
    const matchByStravaId = races.find(
      (r) => r.actual_strava_id != null && Number(r.actual_strava_id) === Number(a.id),
    );
    const match = matchByStravaId || matchByDate;
    const finishS = a.canonical_finish_s != null ? Number(a.canonical_finish_s) : Number(a.moving_time_s);
    return {
      stravaActivityId: a.id,
      date: a.date,
      name: a.name,
      distanceMi: Number(a.distance_mi),
      canonicalLabel: a.canonical_label,
      finishS,
      finishDisplay: fmtTime(finishS),
      linkedRacesSlug: match?.slug ?? null,
      flag: match ? 'linked' : 'orphan-strava-no-races-row',
    };
  });

  // Chip-time vs Strava divergence
  const divergences: Array<{
    slug: string;
    curatedFinishS: number;
    stravaFinishS: number;
    deltaSeconds: number;
    curatedDisplay: string;
    stravaDisplay: string;
  }> = [];
  for (const r of races) {
    if (r.actual_finish_s == null || r.actual_strava_id == null) continue;
    const strava = stravaRaces.find((a) => Number(a.id) === Number(r.actual_strava_id));
    if (!strava) continue;
    const stravaS = strava.canonical_finish_s != null ? Number(strava.canonical_finish_s) : Number(strava.moving_time_s);
    const delta = Number(r.actual_finish_s) - stravaS;
    if (Math.abs(delta) < 2) continue;
    divergences.push({
      slug: r.slug,
      curatedFinishS: Number(r.actual_finish_s),
      stravaFinishS: stravaS,
      deltaSeconds: delta,
      curatedDisplay: fmtTime(Number(r.actual_finish_s)),
      stravaDisplay: fmtTime(stravaS),
    });
  }

  return NextResponse.json({
    summary: {
      racesTotal: races.length,
      needCuration: racesReport.filter((r) => r.flag === 'no-curated-result').length,
      stravaAutoNeedVerify: racesReport.filter((r) => r.flag === 'strava-auto-verify').length,
      manualCurated: racesReport.filter((r) => r.flag === 'manual-curated').length,
      orphanStravaRaces: stravaReport.filter((s) => s.flag === 'orphan-strava-no-races-row').length,
      divergencesFound: divergences.length,
    },
    races: racesReport,
    stravaRaces: stravaReport,
    divergences,
    legend: {
      'no-curated-result':         'races row has no actual_result.finishS — enter chip time via /races/<slug>',
      'strava-auto-verify':        'races row inherited finishS from Strava — confirm it matches official chip time',
      'manual-curated':            'races row carries user-entered chip time (✓ Option-B-ready)',
      'orphan-strava-no-races-row':'Strava race activity has no curated races entry — add one so compute-vdot can prefer it',
      'linked':                    'Strava activity matched to a races row',
    },
  });
}
