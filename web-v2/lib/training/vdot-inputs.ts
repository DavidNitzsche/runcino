/**
 * loadVdotInputs — single shared DB-access layer for bestRecentVdot inputs.
 *
 * All surfaces that compute VDOT (profile-state, snapshot-projections,
 * generate.ts, race-header, drift-monitor) call this function instead of
 * assembling their own SQL. A fix to the race/run query propagates to every
 * caller automatically — this was the B2 failure class (Audit C C1 broke
 * only generate.ts's inputs; the other three sites diverged silently).
 *
 * Throws on DB error — no silent swallow. The caller decides what a failure
 * means: propagate up and refuse to generate a plan, refuse to project,
 * log-and-skip in a cron, or degrade gracefully in a display path.
 *
 * Race query: reads meta/actual_result jsonb per the C1 fix (2026-06-06).
 * Run query:  COALESCE(durationSec|movingTimeS|movingSec|elapsedTimeS)
 *             + Strava workoutType numeric→string mapping (C1-1b)
 *             + race-day exclusion (C1-1e).
 *
 * Cite: docs/OVERNIGHT-REPORT.md §B2.
 */

import { pool } from '@/lib/db/pool';
import { parseRaceTime, zoneFromType } from '@/lib/training/vdot';
import { loadEffectiveMaxHr } from '@/lib/training/max-hr';

// ── Input shapes — match exactly what bestRecentVdot() accepts ──────────────

export interface RaceVdotInput {
  slug: string;
  name: string;
  date: string;
  priority: 'A' | 'B' | 'C' | null;
  distance_mi: number | null;
  finish_seconds: number | null;
}

export interface RunVdotInput {
  id: string;
  date: string;
  workout_type: string | null;
  distance_mi: number | null;
  finish_seconds: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  /** Prescribed training zone (from the plan day this run matched) for the
   *  zone-aware VDOT read. Only set when the work-phase pace is used (so the
   *  zone applies to the zone pace, not a WU+CD-dragged overall pace). */
  zone: 'threshold' | 'marathon' | 'interval' | 'race' | null;
}

export interface VdotInputs {
  raceCandidates: RaceVdotInput[];
  runCandidates: RunVdotInput[];
}

// Strava's numeric workoutType enum → string taxonomy bestRecentVdot expects.
// 1 = race effort, 3 = workout (tempo/quality). 0/2/null → non-quality;
// the HR gate inside vdotFromRun decides those.
// Cite: docs/OVERNIGHT-REPORT.md §B2 C1-1b.
const STRAVA_WORKOUT_TYPE: Record<string, string> = { '1': 'race', '3': 'tempo' };

function distFromLabel(label: string | null | undefined): number | null {
  const l = String(label ?? '').toLowerCase();
  if (l.includes('marathon') && !l.includes('half')) return 26.2;
  if (l.includes('half') || l.includes('21k')) return 13.1;
  if (l.includes('10k')) return 6.2;
  if (l.includes('5k')) return 3.1;
  return null;
}

/**
 * Load race + run candidates for bestRecentVdot from one canonical query path.
 *
 * @param userId     - the runner's UUID
 * @param today      - ISO date (caller must pass their runnerToday() result)
 * @param windowDays - race lookback in days (default 180). Run candidates
 *                     always use a fixed 60-day window because training-derived
 *                     VDOT estimates go stale faster than race anchors.
 *
 * Throws on DB error — callers must NOT silently catch this into a numeric
 * default (that's the C1 bug class: swallow → undefined → goal-pace plan).
 */
export async function loadVdotInputs(
  userId: string,
  today: string,
  windowDays = 180,
): Promise<VdotInputs> {

  // ── Race candidates ──────────────────────────────────────────────────────

  // Compute cutoff in TS to keep the SQL parameters simple.
  const raceCutoff = new Date(Date.parse(today + 'T12:00:00Z') - windowDays * 86400000)
    .toISOString().slice(0, 10);

  // Pull A/B races within the lookback window.
  // No .catch() — throws on error so the caller refuses to generate rather
  // than producing a goal-pace plan (the C1 bug class).
  const raceRows = await pool.query<{
    slug: string;
    meta: Record<string, unknown> | null;
    actual_result: Record<string, unknown> | null;
  }>(
    `SELECT slug, meta, actual_result
       FROM races
      WHERE user_uuid = $1
        AND (meta->>'date')::date >= $2::date
        AND (meta->>'date')::date <  $3::date
        AND meta->>'priority' IN ('A', 'B')`,
    [userId, raceCutoff, today],
  ).then(r => r.rows);

  // Strava match-fallback: for races where neither actual_result.finishS nor
  // meta.finishTime is populated, match by date+distance against the runs table.
  // Only fetch when we have at least one race row (avoids an unnecessary query
  // for cold-start runners with no race history).
  const earliestDate = raceRows.length
    ? raceRows.reduce<string>((min, r) => {
        const d = (r.meta?.date as string) ?? '';
        return !min || (d && d < min) ? d : min;
      }, '')
    : '';
  const matchRuns = earliestDate
    ? await pool.query<{ data: Record<string, unknown> }>(
        `SELECT data
           FROM runs
          WHERE user_uuid = $1
            AND NOT (data ? 'mergedIntoId')
            AND (data->>'distanceMi')::numeric > 2.5
            AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) >= $2
            AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) <= $3`,
        [userId, earliestDate, today],
      ).then(r => r.rows)
    : [];

  const raceCandidates: RaceVdotInput[] = raceRows.map((r) => {
    const m = (r.meta ?? {}) as Record<string, unknown>;
    const ar = (r.actual_result ?? {}) as Record<string, unknown>;
    const distMi = m.distanceMi
      ? Number(m.distanceMi)
      : distFromLabel(m.distanceLabel as string);

    // Source-of-truth ladder (CLAUDE.md §Race-data, locked 2026-05-19):
    //   1. actual_result.finishS  — curated chip time (canonical)
    //   2. meta.finishTime        — legacy stored time
    //   3. Strava date+dist match — provisional fallback
    let finishSec: number | null = ar.finishS != null ? Number(ar.finishS) : null;
    if (!finishSec) finishSec = parseRaceTime(m.finishTime as string);
    if (!finishSec && distMi && m.date) {
      let best: Record<string, unknown> | null = null;
      let bestScore = Infinity;
      for (const c of matchRuns) {
        const d = c.data;
        const day = (d.date as string) || String(d.startLocal ?? '').slice(0, 10);
        if (!day) continue;
        const dayDelta = Math.abs(
          (Date.parse(day + 'T12:00:00Z') - Date.parse((m.date as string) + 'T12:00:00Z')) / 86400000,
        );
        if (dayDelta > 1) continue;
        const miDelta = Math.abs(Number(d.distanceMi) - distMi);
        if (miDelta > 2.0) continue;
        const score = dayDelta * 10 + miDelta;
        if (score < bestScore) { best = d; bestScore = score; }
      }
      if (best) finishSec = Number(best.movingTimeS) || Number(best.elapsedTimeS) || null;
    }

    return {
      slug: r.slug,
      name: (m.name as string) ?? r.slug,
      date: (m.date as string) ?? '',
      priority: ((m.priority as string) ?? null) as 'A' | 'B' | 'C' | null,
      distance_mi: distMi,
      finish_seconds: finishSec,
    };
  });

  // ── Run candidates ───────────────────────────────────────────────────────

  // Fixed 60-day window: race results above are valid anchors for the full
  // windowDays; training-derived VDOT from quality runs goes stale faster.
  const runCutoff = new Date(Date.parse(today + 'T12:00:00Z') - 60 * 86400000)
    .toISOString().slice(0, 10);

  const runRows = await pool.query<{
    id: string;
    date: string;
    workout_type: string | null;
    distance_mi: string | null;
    finish_seconds: string | null;
    avg_hr: string | null;
    work_mi: string | null;
    work_seconds: string | null;
    plan_type: string | null;
  }>(
    `SELECT sa.id::text AS id,
            COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10)) AS date,
            sa.data->>'workoutType' AS workout_type,
            (sa.data->>'distanceMi')::numeric AS distance_mi,
            COALESCE(
              (sa.data->>'durationSec')::numeric,
              (sa.data->>'movingTimeS')::numeric,
              (sa.data->>'movingSec')::numeric,
              (sa.data->>'elapsedTimeS')::numeric
            ) AS finish_seconds,
            (sa.data->>'avgHr')::numeric AS avg_hr,
            -- 2026-06-09 Phase 2 / regression-audit F10 · WORK-PHASE
            -- effort from the watch completion. A tempo's whole-run pace
            -- (WU + blocks + CD) reads ~VDOT 40 for a 47.9 runner — the
            -- run-VDOT path could never beat a fading race anchor and the
            -- Jul-31 anchor cliff stood. The work block IS the honest
            -- "virtual race": 4mi @ T. Distances are the phase-anchored
            -- prescription values (reps are distance-anchored on the
            -- wire); seconds = Σ(dist × actual pace). Latest completion
            -- per date wins (re-syncs override).
            (SELECT SUM(COALESCE(phase->>'actualDistanceMi', phase->>'distanceMi')::numeric)
               FROM coach_intents ci,
                    jsonb_array_elements(
                      CASE jsonb_typeof(ci.value::jsonb)
                        WHEN 'object' THEN ci.value::jsonb->'phases'
                        ELSE '[]'::jsonb END) AS phase
              WHERE COALESCE(ci.user_uuid, ci.user_id) = sa.user_uuid
                AND ci.reason = 'watch_completion'
                AND ci.ts::date = COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10))::date
                AND ci.id = (SELECT MAX(ci2.id) FROM coach_intents ci2
                              WHERE COALESCE(ci2.user_uuid, ci2.user_id) = sa.user_uuid
                                AND ci2.reason = 'watch_completion'
                                AND ci2.ts::date = ci.ts::date)
                AND phase->>'type' = 'work'
                AND (phase->>'actualPaceSPerMi')::numeric > 0
                AND COALESCE(phase->>'actualDistanceMi', phase->>'distanceMi') IS NOT NULL
                AND COALESCE(phase->>'actualDistanceMi', phase->>'distanceMi')::numeric > 0
            ) AS work_mi,
            (SELECT SUM(COALESCE(phase->>'actualDistanceMi', phase->>'distanceMi')::numeric * (phase->>'actualPaceSPerMi')::numeric)
               FROM coach_intents ci,
                    jsonb_array_elements(
                      CASE jsonb_typeof(ci.value::jsonb)
                        WHEN 'object' THEN ci.value::jsonb->'phases'
                        ELSE '[]'::jsonb END) AS phase
              WHERE COALESCE(ci.user_uuid, ci.user_id) = sa.user_uuid
                AND ci.reason = 'watch_completion'
                AND ci.ts::date = COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10))::date
                AND ci.id = (SELECT MAX(ci2.id) FROM coach_intents ci2
                              WHERE COALESCE(ci2.user_uuid, ci2.user_id) = sa.user_uuid
                                AND ci2.reason = 'watch_completion'
                                AND ci2.ts::date = ci.ts::date)
                AND phase->>'type' = 'work'
                AND (phase->>'actualPaceSPerMi')::numeric > 0
                AND COALESCE(phase->>'actualDistanceMi', phase->>'distanceMi') IS NOT NULL
                AND COALESCE(phase->>'actualDistanceMi', phase->>'distanceMi')::numeric > 0
            ) AS work_seconds,
            -- 2026-06-11 · the prescribed zone for this run's date (if it
            -- matched a plan quality day). Drives the zone-aware VDOT read so a
            -- threshold/marathon-pace effort reads by zone, not as a race.
            (SELECT pw.type
               FROM plan_workouts pw
               JOIN training_plans tp ON tp.id = pw.plan_id
              WHERE tp.user_uuid = sa.user_uuid
                AND tp.archived_iso IS NULL
                AND pw.date_iso = COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10))
                AND pw.type IN ('tempo','threshold','intervals','marathon_pace','race','race_week_tuneup')
              ORDER BY pw.type
              LIMIT 1) AS plan_type
       FROM runs sa
      WHERE sa.user_uuid = $1
        AND NOT (sa.data ? 'mergedIntoId')
        AND COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10)) >= $2
        AND COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10)) <  $3
        AND (sa.data->>'distanceMi')::numeric >= 4
        -- 2026-06-09 state-audit fix: was movingTimeS-only, a Strava field
        -- watch rows don't carry (they carry durationSec; their timeMoving
        -- is a display string, never castable) — which structurally
        -- excluded every watch-source run from VDOT candidacy. The
        -- HR-quality gate inside vdotFromRun was built for exactly those
        -- runs and never received one.
        AND COALESCE(
              (sa.data->>'durationSec')::numeric,
              (sa.data->>'movingTimeS')::numeric,
              (sa.data->>'movingSec')::numeric,
              (sa.data->>'elapsedTimeS')::numeric
            ) > 60
        -- C1-1e: exclude race-day runs. The curated races row is canonical for
        -- race-day performance; a GPS-over-measured Strava activity on the same
        -- day produces phantom-high VDOT (e.g. Disney 13.38mi vs curated
        -- 13.109mi at the same finish time → VDOT 49.2 vs correct 47.9).
        AND NOT EXISTS (
          SELECT 1 FROM races rr
           WHERE rr.user_uuid = $1
             AND ABS(
               (rr.meta->>'date')::date
               - COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10))::date
             ) <= 1
        )`,
    [userId, runCutoff, today],
  ).then(r => r.rows);
  // No .catch() — throws on error.

  // Max HR for the HR-quality gate inside vdotFromRun (≥ 80% MaxHR).
  const effMaxHr = await loadEffectiveMaxHr(userId, today);
  const maxHrValue = effMaxHr.bpm;

  const runCandidates: RunVdotInput[] = runRows.map((r) => {
    // F10 · prefer the work-phase effort when the watch captured one
    // big enough to read (vdotFromRun's own ≥4 mi floor). The whole-run
    // numbers remain the fallback for Strava/HK-only runs.
    const workMi = r.work_mi != null ? Number(r.work_mi) : null;
    const workSec = r.work_seconds != null ? Math.round(Number(r.work_seconds)) : null;
    const useWork = workMi != null && workSec != null && workMi >= 4 && workSec > 60;
    return {
      id: String(r.id),
      date: r.date,
      // C1-1b: Strava's numeric workoutType → string taxonomy.
      // 0/2/null pass through to the HR gate.
      workout_type: r.workout_type != null
        ? (STRAVA_WORKOUT_TYPE[r.workout_type] ?? r.workout_type)
        : null,
      distance_mi: useWork ? workMi : (r.distance_mi != null ? Number(r.distance_mi) : null),
      finish_seconds: useWork ? workSec : (r.finish_seconds != null ? Number(r.finish_seconds) : null),
      avg_hr: r.avg_hr != null ? Number(r.avg_hr) : null,
      max_hr: maxHrValue,
      // Zone-read ONLY the work-phase pace · applying a zone inversion to a
      // WU+CD-dragged overall pace would badly understate. Without work-phase
      // data the run keeps the conservative race interpretation (zone null).
      zone: useWork ? zoneFromType(r.plan_type) : null,
    };
  });

  return { raceCandidates, runCandidates };
}
