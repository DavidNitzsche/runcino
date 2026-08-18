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
 * 2026-08-18 (same day, follow-up) · David also asked whether the app
 * treats his upcoming races as one continuous calendar — specifically,
 * where his own tune-up races (Santa Monica 10K, Dodgers, Run Malibu) will
 * land once the CIM block above is actually generated. `embedMidBlockRaces`
 * in generate.ts already answers that (composePlan calls it right after
 * laying out the block's weeks) — this route now also calls
 * `previewMidBlockRacePlacement`, which builds a placeholder week skeleton
 * and calls that SAME real function. See block-preview.ts's doc comment
 * above `previewMidBlockRacePlacement` for exactly what's real (which week)
 * vs. approximate (which exact day) about the result.
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
import { loadRacesState, type RaceRow } from '@/lib/coach/races-state';
import { loadSettings } from '@/lib/coach/settings';
import { dayKeyToDow, type DayKey, type MidBlockRace } from '@/lib/plan/generate';
import { previewMidBlockRacePlacement } from '@/lib/plan/block-preview';
import { parseRaceTime } from '@/lib/training/vdot';

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
    // Same defaults generate.ts's loadGeneratorInputs reads (rest_day ??
    // 'sat', quality_days ?? ['tue','thu']) — see previewMidBlockRacePlacement's
    // header for why these (prefs-only, no rolling fitness data) are safe to
    // read early, unlike the recent-quality-habit ramp that also feeds the
    // real generator's per-week quality density.
    const restDow = dayKeyToDow((prefs?.rest_day ?? 'sat') as DayKey);
    const qualityDows = (prefs?.quality_days?.length ? prefs.quality_days : ['tue', 'thu'])
      .map((d) => dayKeyToDow(d as DayKey));

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

    // Runner's stated training frequency (profile.weekly_frequency) — passed
    // straight through to the real embedMidBlockRaces's own frequency-cap
    // trim. Same read + same null-preserves-legacy convention as
    // generate.ts's loadGeneratorInputs (~5808-5827); NOT the 0/1/2 →
    // couch-to-X floor remapping it also does, since that only matters for
    // volumeCurve/layoutWeek sizing, not the embed step's day-count cap.
    const freqRow = (await pool.query<{ f: number | null }>(
      `SELECT weekly_frequency AS f FROM profile WHERE user_uuid = $1 LIMIT 1`,
      [userId],
    ).catch(() => ({ rows: [] as Array<{ f: number | null }> }))).rows[0];
    const rawFreq = freqRow?.f != null ? Number(freqRow.f) : null;
    const trainingDaysPerWeek = rawFreq != null && rawFreq >= 1 && rawFreq <= 7 ? rawFreq : null;

    // Candidate mid-block races: the runner's own upcoming B/C races other
    // than the target itself, distance-capped at the target's own distance
    // — mirrors generate.ts's real `midBlockRaceRows` filter (~6008-6010:
    // dMi > 0 && dMi <= raceDistanceMi, priority strictly 'B' or 'C', slug
    // != target). `loadRacesState`'s `upcomingCs` bucket also folds in
    // priority-null races (its own "untagged = C" convention for display),
    // which the real generator's SQL does NOT — `meta->>'priority' IN
    // ('B','C')` requires an explicit tag — so priority is re-checked here
    // rather than trusted from the bucket. The actual in-block / before-
    // target-race date filtering is NOT re-derived here; every candidate
    // that survives this filter is handed to the real `embedMidBlockRaces`
    // inside previewMidBlockRacePlacement, which applies its own
    // `race.date >= raceDateISO` exclusion and its own plan-window bounds
    // check — the exact predicate the task asked to match, by construction.
    const midBlockRaces: MidBlockRace[] = [...races.upcomingBs, ...races.upcomingCs]
      .filter((r): r is RaceRow => !!r && r.slug !== slug && (r.priority === 'B' || r.priority === 'C'))
      .filter((r) => !!r.date && r.distance_mi != null && r.distance_mi > 0 && r.distance_mi <= race.distance_mi!)
      .map((r) => ({
        slug: r.slug,
        name: r.name,
        date: r.date,
        distanceMi: r.distance_mi as number,
        goalPaceSec: (() => {
          const goalSec = parseRaceTime(r.goal);
          return goalSec && r.distance_mi ? Math.round(goalSec / r.distance_mi) : null;
        })(),
        priority: r.priority as 'B' | 'C',
      }));

    const preview = previewMidBlockRacePlacement({
      todayISO,
      raceDateISO: race.date,
      raceDistanceMi: race.distance_mi,
      weekStartDow,
      recoveryEndISO: recoveryRow?.last_workout_iso ?? null,
      midBlockRaces,
      restDow,
      qualityDows,
      trainingDaysPerWeek,
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
