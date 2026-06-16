/**
 * GET /api/profile/state — full ProfileState for iPhone parity.
 *
 * Returns the same shape that lib/coach/profile-state.ts ships to the
 * web /profile page: identity (name/sex/age/city/height), physiology
 * (computed MaxHR / RHR / VDOT / LTHR / zones), and connection state.
 * Shoes + nextARace + preferences are omitted here — those have their
 * own dedicated endpoints (/api/shoes, /api/races, /api/settings) the
 * iPhone already calls. Keeping this trim avoids over-fetching on
 * /profile mount.
 *
 * 2026-05-27: shipped after David noticed the iPhone /profile was
 * showing hardcoded "David Nitzsche / MALE · 40 · LOS ANGELES" string
 * literals while the web /profile read real values from the DB. Same
 * data, same screen, both surfaces.
 */
import { NextRequest, NextResponse } from 'next/server';
import { loadProfileState } from '@/lib/coach/profile-state';
import { requireUserId } from '@/lib/auth/session';
import { pool } from '@/lib/db/pool';

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  try {
    const [state, goalRow] = await Promise.all([
      loadProfileState(userId),
      pool.query<{ tt_goal_distance: string | null; tt_goal_time: string | null; tt_goal_time_seconds: number | null }>(
        `SELECT tt_goal_distance, tt_goal_time, tt_goal_time_seconds FROM profile WHERE user_uuid = $1`,
        [userId]
      ),
    ]);
    const g = goalRow.rows[0];
    const fitnessGoal = g?.tt_goal_distance && g?.tt_goal_time
      ? { distance: g.tt_goal_distance, time: g.tt_goal_time, seconds: g.tt_goal_time_seconds ?? null }
      : null;

    return NextResponse.json({
      identity: state.identity,
      physiology: {
        max_hr:        state.physiology.max_hr,
        max_hr_source: state.physiology.max_hr_source,
        rhr:           state.physiology.rhr,
        vo2:           state.physiology.vo2,
        weight_lb:     state.physiology.weight_lb,
        vdot:          state.physiology.vdot,
        lthr:          state.physiology.lthr,
        lthr_method:   state.physiology.lthr_method,
        lthr_set_at:   state.physiology.lthr_set_at,
      },
      connections: state.connections,
      fitnessGoal,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
