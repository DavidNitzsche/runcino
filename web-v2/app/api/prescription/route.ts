/**
 * GET /api/prescription?type=threshold&weeklyMi=43 → structured workout
 *
 * Reads the runner's profile (LTHR + race goal) and returns a fully
 * broken-out prescription so the modal doesn't have to ship the
 * pace-derivation logic to the client.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { prescriptionFor, type WorkoutType } from '@/lib/training/prescriptions';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

const VALID: WorkoutType[] = ['easy','long','tempo','threshold','intervals','race','shakeout','rest','unplanned'];

function parseGoalSeconds(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = String(s).match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
}

function distanceMiFromLabel(label: string | null): number | null {
  if (!label) return null;
  const l = label.toLowerCase();
  if (l.includes('marathon') && !l.includes('half')) return 26.2;
  if (l.includes('half') || l.includes('21k')) return 13.1;
  if (l.includes('10k')) return 6.2;
  if (l.includes('5k')) return 3.1;
  return null;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const userId = sp.get('user_id') ?? DAVID_USER_ID;
  const typeRaw = (sp.get('type') ?? 'easy').toLowerCase() as WorkoutType;
  const type: WorkoutType = VALID.includes(typeRaw) ? typeRaw : 'easy';
  const weeklyMi = Number(sp.get('weeklyMi')) || 30;
  const targetMiRaw = sp.get('targetMi');
  const targetMi = targetMiRaw != null ? Number(targetMiRaw) : undefined;

  // Profile: LTHR
  const profRow = (await pool.query(
    `SELECT lthr FROM profile WHERE user_uuid = $1 OR (user_uuid IS NULL AND user_id='me') ORDER BY (user_uuid=$1) DESC LIMIT 1`,
    [userId]
  ).catch(() => ({ rows: [] }))).rows[0];
  const lthr = profRow?.lthr ?? null;

  // Race goal: closest upcoming A-race with a goal time
  const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
  const raceRow = (await pool.query(
    `SELECT meta FROM races
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND meta->>'priority' = 'A'
        AND meta->>'goalDisplay' IS NOT NULL
        AND (meta->>'date')::date >= $2::date
      ORDER BY (meta->>'date') ASC LIMIT 1`,
    [userId, today]
  ).catch(() => ({ rows: [] }))).rows[0];
  const meta = raceRow?.meta ?? {};
  const goal_seconds = parseGoalSeconds(meta.goalDisplay);
  const goal_distance_mi = meta.distanceMi ? Number(meta.distanceMi) : distanceMiFromLabel(meta.distanceLabel);

  const prescription = prescriptionFor(type, weeklyMi, {
    lthr, goal_seconds, goal_distance_mi,
  }, isFinite(targetMi as number) ? (targetMi as number) : undefined);

  // Prescriptions are deterministic from (type, weeklyMi, lthr, goal_*).
  // The same query string returns the same output until the runner's
  // profile changes — safe to cache aggressively client-side.
  return NextResponse.json(prescription, {
    headers: { 'Cache-Control': 'private, max-age=600, stale-while-revalidate=60' },
  });
}
