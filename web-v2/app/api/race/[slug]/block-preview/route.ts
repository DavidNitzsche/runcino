/**
 * GET /api/race/[slug]/block-preview
 *
 * 2026-08-18 · David asked why the CIM block's shape stays invisible until
 * the night his post-race recovery window closes and the `recovery_complete`
 * cron (app/api/cron/plan-drift/route.ts) fires the real rebuild. Read-only
 * preview of that upcoming block's phase SHAPE (weeks of BASE / QUALITY /
 * RACE-SPECIFIC / TAPER) — computed with lib/plan/block-preview.ts's
 * `previewBlockShape`, which calls generate.ts's real `sizeBlocks` so this
 * can never silently drift from what the real generator will eventually
 * produce.
 *
 * Backend-only, no DB writes. UI/visual work is explicitly on hold pending
 * the outside studio's redesign (David, 2026-08-18) — this route exists so
 * a consumer can be wired up later without more compute logic living in a
 * component.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { loadRacesState } from '@/lib/coach/races-state';
import { loadSettings } from '@/lib/coach/settings';
import { dayKeyToDow, type DayKey } from '@/lib/plan/generate';
import { previewBlockShape } from '@/lib/plan/block-preview';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { slug } = await params;

  try {
    const races = await loadRacesState(userId);
    const race = [...races.aRaces, ...races.upcomingBs, ...races.upcomingCs, ...races.past]
      .find((r) => r?.slug === slug);
    if (!race) return NextResponse.json({ error: 'race not found' }, { status: 404 });
    if (!race.date || !race.distance_mi) {
      return NextResponse.json(
        { error: 'race is missing a date or distance · cannot preview a block' },
        { status: 422 },
      );
    }

    const todayISO = await runnerToday(userId);

    // Week-start boundary — the day AFTER the runner's long-run day, the
    // exact convention generate.ts's weekStartDow uses (see block-preview.ts
    // header). loadSettings/dayKeyToDow are the same helpers generate.ts
    // reads prefs.long_run_day with.
    const prefs = await loadSettings(userId).catch(() => null);
    const longRunDow = dayKeyToDow((prefs?.long_run_day ?? 'sun') as DayKey);
    const weekStartDow = (longRunDow + 1) % 7;

    // Active recovery-mode plan currently targeting THIS race, if any — same
    // predicate app/api/cron/plan-drift/route.ts's recovery re-entry block
    // reads (tp.mode = 'recovery' OR authored_state.mode = 'recovery', joined
    // to plan_workouts for the last prescribed day).
    const recoveryRow = (await pool.query<{ last_workout_iso: string | null }>(
      `SELECT (SELECT MAX(pw.date_iso) FROM plan_workouts pw WHERE pw.plan_id = tp.id) AS last_workout_iso
         FROM training_plans tp
        WHERE tp.user_uuid = $1
          AND tp.archived_iso IS NULL
          AND tp.race_id = $2
          AND (tp.mode = 'recovery' OR tp.authored_state->>'mode' = 'recovery')
        ORDER BY tp.authored_iso DESC LIMIT 1`,
      [userId, slug],
    ).catch(() => ({ rows: [] }))).rows[0];

    const preview = previewBlockShape({
      todayISO,
      raceDateISO: race.date,
      raceDistanceMi: race.distance_mi,
      weekStartDow,
      recoveryEndISO: recoveryRow?.last_workout_iso ?? null,
    });

    return NextResponse.json({
      race_slug: slug,
      race_name: race.name,
      ...preview,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
