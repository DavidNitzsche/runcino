/**
 * GET /api/today/purpose
 *
 * Returns the pre-run "WHY THIS RUN" payload for today's planned workout:
 *
 *   {
 *     verdict:  string,        // "Build the base."
 *     facts:    string[],      // 1-2 sentences on the purpose
 *     citations: { slug, label }[]
 *   }
 *
 * Doctrine: lib/coach/run-purpose.ts header.
 *
 * Surfaces that should consume:
 *   · Web /today "THE PLAN · UPCOMING" right-rail card (replaces the
 *     static planVerdict / planRecap strings in TodayView.tsx)
 *   · iPhone TodayView pre-run brief card
 *   · watch IdleView preview
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { derivePurpose, type Phase, type WorkoutType } from '@/lib/coach/run-purpose';

export const dynamic = 'force-dynamic';

function todayPT(): string {
  return new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
}

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

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const url = new URL(req.url);
  const date = (url.searchParams.get('date') || todayPT()).slice(0, 10);

  const planRow = (await pool.query<{
    type: string;
    distance_mi: number | string;
    phase: string | null;
    race_distance_mi: number | null;
    weeks_to_race: number | null;
  }>(
    `WITH active AS (
       SELECT id, race_id FROM plans
        WHERE user_uuid = $1 AND archived_at IS NULL
        ORDER BY created_at DESC LIMIT 1
     )
     SELECT pw.type,
            pw.distance_mi,
            pwk.phase_label AS phase,
            (r.meta->>'distanceMi')::numeric AS race_distance_mi,
            CASE WHEN r.meta->>'date' IS NOT NULL
                 THEN CEIL(EXTRACT(EPOCH FROM ((r.meta->>'date')::date - $2::date)) / 86400.0 / 7)
                 ELSE NULL END AS weeks_to_race
       FROM active a
       JOIN plan_workouts pw ON pw.plan_id = a.id AND pw.date_iso = $2
       LEFT JOIN plan_weeks pwk ON pwk.id = pw.week_id
       LEFT JOIN races r ON r.id = a.race_id
      LIMIT 1`,
    [userId, date],
  )).rows[0];

  if (!planRow) {
    return NextResponse.json({
      ok: true,
      date,
      type: 'unplanned',
      ...derivePurpose({ type: 'unplanned', phase: null, plannedMi: 0 }),
    });
  }

  const type = (TYPE_NORMALIZE[(planRow.type ?? '').toLowerCase()] ?? 'unplanned') as WorkoutType;
  const phase = planRow.phase ? (PHASE_FROM_LABEL[planRow.phase] ?? null) : null;
  const plannedMi = Number(planRow.distance_mi) || 0;
  const raceDistanceMi = planRow.race_distance_mi != null ? Number(planRow.race_distance_mi) : null;
  const weeksToRace = planRow.weeks_to_race != null ? Number(planRow.weeks_to_race) : null;

  const purpose = derivePurpose({ type, phase, plannedMi, raceDistanceMi, weeksToRace });

  return NextResponse.json({
    ok: true,
    date,
    type,
    phase,
    plannedMi,
    raceDistanceMi,
    weeksToRace,
    ...purpose,
  });
}
