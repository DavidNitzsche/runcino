/**
 * POST /api/profile/goal
 *
 * Set or update the runner's fitness goal (no-race time target).
 * Writes profiles.tt_goal_distance + tt_goal_time + tt_goal_time_seconds.
 *
 * Body: { distance_label: "5K" | "10K" | "Half Marathon" | "Marathon" | "50K" | "100K",
 *         goal_time: "23:50" | "1:45:00" }
 *
 * Distance maps to the same labels the onboarding/plan system recognises.
 * goal_time is stored as-is (display string) and also parsed to seconds.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';

const ALLOWED_DISTANCES = ['5K', '10K', 'Half Marathon', 'Marathon', '50K', '100K'];

/** Accepts MM:SS or H:MM:SS */
function parseTimeSeconds(s: string): number | null {
  const parts = s.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 2 && parts[1] < 60) return parts[0] * 60 + parts[1];
  if (parts.length === 3 && parts[1] < 60 && parts[2] < 60) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const body = await req.json().catch(() => null);
  const distanceLabel = String(body?.distance_label ?? '').trim();
  const goalTime = String(body?.goal_time ?? '').trim();

  if (!ALLOWED_DISTANCES.includes(distanceLabel)) {
    return NextResponse.json(
      { error: `distance_label must be one of: ${ALLOWED_DISTANCES.join(', ')}` },
      { status: 400 }
    );
  }
  if (!goalTime) {
    return NextResponse.json({ error: 'goal_time required (e.g. "23:50" or "1:45:00")' }, { status: 400 });
  }

  const goalSeconds = parseTimeSeconds(goalTime);
  if (!goalSeconds) {
    return NextResponse.json(
      { error: 'Could not parse goal_time. Use MM:SS or H:MM:SS format.' },
      { status: 400 }
    );
  }

  await pool.query(
    `UPDATE profiles
        SET tt_goal_distance        = $1,
            tt_goal_time            = $2,
            tt_goal_time_seconds    = $3
      WHERE user_uuid = $4`,
    [distanceLabel, goalTime, goalSeconds, userId]
  );

  await bustBriefingCacheForEvent(userId, 'profile_edit');

  return NextResponse.json({ ok: true, distance_label: distanceLabel, goal_time: goalTime, goal_seconds: goalSeconds });
}
