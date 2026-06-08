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
import { runnerToday } from '@/lib/runtime/runner-tz';
import { derivePurpose, type Phase, type WorkoutType } from '@/lib/coach/run-purpose';
import { composeCue } from '@/lib/coach/session-cue';
import { workoutTypeTitle } from '@/lib/coach/workout-title';

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

/** 2026-06-02 · phase mapping for the iPhone TodayPurpose decoder.
 *  Internal Phase enum is UPPER; iPhone expects lowercase + `off-season`
 *  instead of `recovery`. Centralized so both copies stay in sync. */
const PHASE_TO_LOWER: Record<Phase, string> = {
  BASE: 'base',
  BUILD: 'build',
  PEAK: 'peak',
  TAPER: 'taper',
  RECOVERY: 'off-season',
  OFF: 'off-season',
};

interface AnchorRace {
  slug: string;
  name: string;
  date: string;          // YYYY-MM-DD
  distanceMi: number | null;
  priority: 'A' | 'B' | 'C';
}

/**
 * 2026-06-02 · iPhone brief response · resolve the anchor race for
 * the "TO RACE" chip on Today. Highest-priority future race by
 * `meta->>'priority'` ASC (A > B > C), tie-broken by earliest
 * `meta->>'date'`. Excludes `priority='hilly-excluded'` (context-only
 * races like Big Sur that don't anchor training). Returns null when
 * no future qualifying race exists.
 */
async function loadAnchorRace(userId: string, todayIso: string): Promise<AnchorRace | null> {
  try {
    const row = (await pool.query<{
      slug: string;
      name: string;
      date: string;
      dist: number | string | null;
      priority: string;
    }>(
      `SELECT slug,
              COALESCE(meta->>'name', slug) AS name,
              meta->>'date' AS date,
              (meta->>'distanceMi')::numeric AS dist,
              meta->>'priority' AS priority
         FROM races
        WHERE user_uuid::text = $1
          AND meta->>'date' IS NOT NULL
          AND (meta->>'date')::date >= $2::date
          AND meta->>'priority' IN ('A', 'B', 'C')
        ORDER BY meta->>'priority' ASC, (meta->>'date')::date ASC
        LIMIT 1`,
      [userId, todayIso],
    )).rows[0];
    if (!row) return null;
    return {
      slug: row.slug,
      name: row.name,
      date: row.date,
      distanceMi: row.dist != null ? Number(row.dist) : null,
      priority: row.priority as 'A' | 'B' | 'C',
    };
  } catch {
    return null;
  }
}

/**
 * 2026-06-02 · iPhone CUE field context loader.
 *
 * Pulls three lightweight signals composeCue() reads to make the cue
 * specific to TODAY · was yesterday hard · is it hot · are pillars
 * trending red. Every signal defaults to false/null on failure so
 * the cue still composes from the bare type fallback. Failures here
 * NEVER 500 the route.
 */
async function loadCueContext(userId: string, date: string): Promise<{
  recentHardSession: boolean;
  heatPenaltyBpm: number | null;
  pillarDownStreak: boolean;
}> {
  const hardYesterday = await pool.query<{ type: string | null; dist: number | string | null }>(
    `SELECT data->>'type' AS type, (data->>'distanceMi')::numeric AS dist
       FROM runs WHERE user_uuid = $1::uuid AND NOT (data ? 'mergedIntoId')
        AND (data->>'date')::date = ($2::date - interval '1 day')
       ORDER BY (data->>'date')::date DESC LIMIT 1`,
    [userId, date],
  ).then((r) => r.rows[0]).catch(() => undefined);
  const t = (hardYesterday?.type ?? '').toLowerCase();
  const dist = hardYesterday?.dist != null ? Number(hardYesterday.dist) : 0;
  const recentHardSession = t === 'race' || t === 'long' || t === 'intervals'
    || t === 'tempo' || t === 'threshold' || t === 'fartlek' || dist >= 12;

  let heatPenaltyBpm: number | null = null;
  try {
    const { resolveHomeLatLng, fetchDayForecast } = await import('@/lib/weather/openmeteo');
    const home = await resolveHomeLatLng(userId);
    if (home) {
      const f = await fetchDayForecast(home.lat, home.lng, date);
      if (f?.temp_max_f != null && f.temp_max_f >= 75) {
        // Research/06 §heat · ~1 bpm per 2°F over 65°F baseline.
        heatPenaltyBpm = Math.round((f.temp_max_f - 65) / 2);
      }
    }
  } catch { /* swallow · null is fine */ }

  let pillarDownStreak = false;
  try {
    const { loadCoachState } = await import('@/lib/coach/state-loader');
    const { loadReadinessBrief } = await import('@/lib/coach/readiness-brief');
    const state = await loadCoachState(userId);
    if (state) {
      const brief = await loadReadinessBrief(userId, state);
      pillarDownStreak = (brief?.streaks ?? []).some((s) =>
        s.direction === 'below' && s.days >= 3
      );
    }
  } catch { /* swallow · false is fine */ }

  return { recentHardSession, heatPenaltyBpm, pillarDownStreak };
}

/** 2026-06-02 · compute weeks between two dates · `Math.ceil(days/7)` ·
 *  null when date is missing or invalid. */
function weeksBetween(todayIso: string, raceIso: string | null): number | null {
  if (!raceIso) return null;
  const today = new Date(todayIso + 'T12:00:00Z').getTime();
  const race = new Date(raceIso + 'T12:00:00Z').getTime();
  if (!Number.isFinite(today) || !Number.isFinite(race)) return null;
  const days = (race - today) / 86400000;
  if (days < 0) return null;
  return Math.ceil(days / 7);
}

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const url = new URL(req.url);
  const date = (url.searchParams.get('date') || await runnerToday(userId)).slice(0, 10);

  try {
    // 2026-06-02 · rewrite per iPhone brief.
    // Three independent queries · failure on any one returns a sensible
    // partial response, never a 500.
    //
    // Was: a single JOIN that crashed with
    //   `pg_catalog.extract(unknown, integer)` because Postgres
    //   `date - date` returns INTEGER days, not an interval, and EXTRACT
    //   needs an interval/timestamp.
    //
    // New shape: plan workout (today) + anchor race (independent of
    // plan.race_id, per the doctrine rule) · weeks-to-race computed
    // in JS from the resolved anchor's date.
    const [planRow, anchor] = await Promise.all([
      pool.query<{
        type: string;
        distance_mi: number | string;
        phase: string | null;
      }>(
        `WITH active AS (
           SELECT id FROM training_plans
            WHERE COALESCE(user_uuid::text, user_id) = $1 AND archived_iso IS NULL
            ORDER BY authored_iso DESC LIMIT 1
         )
         SELECT pw.type,
                pw.distance_mi,
                pp.label AS phase
           FROM active a
           JOIN plan_workouts pw ON pw.plan_id = a.id AND pw.date_iso = $2
           LEFT JOIN plan_weeks pwk ON pwk.id = pw.week_id
           LEFT JOIN plan_phases pp ON pp.id = pwk.phase_id
          LIMIT 1`,
        [userId, date],
      ).then((r) => r.rows[0]).catch(() => undefined),
      loadAnchorRace(userId, date),
    ]);

    const weeksToRace = weeksBetween(date, anchor?.date ?? null);
    const raceDistanceMi = anchor?.distanceMi ?? null;

    // No plan row · still return the race chip so iPhone's TO RACE
    // surfaces (the plan side stays "unplanned").
    if (!planRow) {
      return NextResponse.json({
        ok: true,
        date,
        type: 'unplanned',
        typeTitle: workoutTypeTitle('unplanned'),
        phase: null,
        plannedMi: 0,
        raceDistanceMi,
        weeksToRace,
        race: anchor,
        ...derivePurpose({ type: 'unplanned', phase: null, plannedMi: 0 }),
      });
    }

    const type = (TYPE_NORMALIZE[(planRow.type ?? '').toLowerCase()] ?? 'unplanned') as WorkoutType;
    const phaseUpper: Phase | null = planRow.phase ? (PHASE_FROM_LABEL[planRow.phase] ?? null) : null;
    // 2026-06-02 · iPhone wants lowercase + 'off-season' for RECOVERY.
    // Keep the upper-case `phase` field for back-compat web consumers,
    // emit `phaseLower` on the same response so the iPhone TodayPurpose
    // decoder reads its expected enum.
    const phaseLower = phaseUpper ? PHASE_TO_LOWER[phaseUpper] : null;
    const plannedMi = Number(planRow.distance_mi) || 0;

    const purpose = derivePurpose({
      type, phase: phaseUpper, plannedMi, raceDistanceMi, weeksToRace,
    });

    // 2026-06-02 · iPhone brief · one-line SESSION CUE.
    // Composer reads recent context (hard session yesterday, pillar
    // streaks, heat) and produces a single-sentence coach-voice cue.
    // Returns null on rest/unplanned · iPhone hides the section.
    const cueContext = await loadCueContext(userId, date);
    const cue = composeCue({
      type, phase: phaseUpper, plannedMi,
      recentHardSession: cueContext.recentHardSession,
      heatPenaltyBpm: cueContext.heatPenaltyBpm,
      pillarDownStreak: cueContext.pillarDownStreak,
    });

    return NextResponse.json({
      ok: true,
      date,
      type,
      // 2026-06-02 · one-word hero title for the Today card.
      // Single source across web + iPhone + watch. See
      // lib/coach/workout-title.ts for the locked vocabulary.
      typeTitle: workoutTypeTitle(type),
      phase: phaseUpper,
      phaseLower,
      plannedMi,
      raceDistanceMi,
      weeksToRace,
      race: anchor,
      cue,
      ...purpose,
    });
  } catch (err: unknown) {
    // 2026-06-02 · the endpoint MUST NEVER 500 on a missing or weird
    // race row. Hard-default to the empty-race state. Log so we can
    // see it in Railway logs.
    console.error('[today/purpose]', err);
    return NextResponse.json({
      ok: true,
      date,
      type: 'unplanned',
      typeTitle: workoutTypeTitle('unplanned'),
      phase: null,
      phaseLower: null,
      plannedMi: 0,
      raceDistanceMi: null,
      weeksToRace: null,
      race: null,
      ...derivePurpose({ type: 'unplanned', phase: null, plannedMi: 0 }),
    });
  }
}
