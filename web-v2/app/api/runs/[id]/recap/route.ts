/**
 * GET /api/runs/[id]/recap
 *
 * Returns the post-run recap payload for a completed canonical run:
 *
 *   {
 *     verdict:  string,                // "Banked the long."
 *     facts:    string[],              // 1-2 sentences on what landed
 *     coach_tip: string | null,        // forward-looking advice
 *     conditions_note: string | null,  // null if conditions were neutral
 *     citations: { slug, label }[]    // research backing
 *   }
 *
 * Doctrine: lib/coach/run-recap.ts header.
 *
 * Surfaces that should consume:
 *   · Web /today CompletedHeroV2 (replaces the static `planRecap` strings)
 *   · Web Activity drawer
 *   · iPhone TodayView post-run card
 *   · iPhone Activity / RunDetailView
 *   · watch SummaryView (compact verdict only)
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { deriveRecap } from '@/lib/coach/run-recap';
import type { Phase, WorkoutType } from '@/lib/coach/run-purpose';

export const dynamic = 'force-dynamic';

const PHASE_FROM_LABEL: Record<string, Phase> = {
  BASE: 'BASE', base: 'BASE',
  BUILD: 'BUILD', build: 'BUILD',
  PEAK: 'PEAK', peak: 'PEAK',
  TAPER: 'TAPER', taper: 'TAPER',
  RECOVERY: 'RECOVERY', recovery: 'RECOVERY',
};

const TYPE_NORMALIZE: Record<string, WorkoutType> = {
  easy: 'easy',
  long: 'long',
  tempo: 'tempo',
  threshold: 'threshold',
  intervals: 'intervals',
  fartlek: 'fartlek',
  progression: 'progression',
  recovery: 'recovery',
  shakeout: 'shakeout',
  race: 'race',
  rest: 'rest',
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { id } = await params;

  // Load the canonical run. Accept either the bigint id or
  // data->>activityId as a lookup key (Strava ids land in both shapes).
  const runRow = (await pool.query<{
    id: string;
    data: Record<string, any>;
  }>(
    `SELECT id::text AS id, data
       FROM strava_activities
      WHERE user_uuid = $1
        AND (id::text = $2 OR data->>'activityId' = $2 OR data->>'id' = $2)
        AND absorbed_into_canonical_at IS NULL
        AND (data ? 'mergedIntoId') = false
      LIMIT 1`,
    [userId, String(id)],
  )).rows[0];

  if (!runRow) {
    return NextResponse.json({ error: 'run not found' }, { status: 404 });
  }

  const data = runRow.data ?? {};
  const date = (data.date as string) ?? String(data.startLocal ?? '').slice(0, 10);

  // Find the matching plan_workouts row for this date (intent vs execution).
  const planRow = date ? (await pool.query<{
    type: string;
    distance_mi: number | string;
    workout_spec: any;
    phase: string | null;
    hr_cap: number | null;
    pace_target_s: number | null;
  }>(
    `SELECT pw.type, pw.distance_mi, pw.workout_spec,
            COALESCE(pwk.phase_label, NULL) AS phase,
            COALESCE(
              (pw.workout_spec->>'hr_cap_bpm')::int,
              (pw.workout_spec->>'hr_target_bpm')::int,
              (pw.workout_spec->>'lthr_bpm')::int
            ) AS hr_cap,
            (pw.workout_spec->>'pace_target_s_per_mi')::int AS pace_target_s
       FROM plan_workouts pw
       JOIN plans p ON p.id = pw.plan_id
       LEFT JOIN plan_weeks pwk ON pwk.id = pw.week_id
      WHERE p.user_uuid = $1
        AND pw.date_iso = $2
      ORDER BY p.created_at DESC LIMIT 1`,
    [userId, date],
  )).rows[0] : null;

  const type = (TYPE_NORMALIZE[(planRow?.type ?? data.workoutType ?? '').toLowerCase()] ?? 'unplanned') as WorkoutType;
  const phase = planRow?.phase ? (PHASE_FROM_LABEL[planRow.phase] ?? null) : null;
  const plannedMi = planRow?.distance_mi ? Number(planRow.distance_mi) : Number(data.distanceMi) || 0;

  const recap = deriveRecap({
    type,
    phase,
    plannedMi,
    plannedPaceSPerMi: planRow?.pace_target_s ?? null,
    plannedHrCap: planRow?.hr_cap ?? null,
    actualMi: Number(data.distanceMi) || 0,
    actualPaceSPerMi: Number(data.paceSPerMi) || null,
    actualAvgHr: data.avgHr != null ? Number(data.avgHr) : null,
    actualMaxHr: data.maxHr != null ? Number(data.maxHr) : null,
    splits: Array.isArray(data.splits) ? data.splits as any[] : undefined,
    weather: data.weather ? {
      tempF: typeof data.weather.temp_f === 'number' ? data.weather.temp_f : (typeof data.tempF === 'number' ? data.tempF : null),
      humidityPct: typeof data.weather.humidity_pct === 'number' ? data.weather.humidity_pct : null,
      windMph: typeof data.weather.wind_mph === 'number' ? data.weather.wind_mph : null,
      conditions: typeof data.weather.conditions === 'string' ? data.weather.conditions : null,
      cloudCoverPct: typeof data.weather.cloud_cover_pct === 'number' ? data.weather.cloud_cover_pct : null,
    } : null,
  });

  return NextResponse.json({
    ok: true,
    runId: runRow.id,
    date,
    type,
    phase,
    ...recap,
  });
}
