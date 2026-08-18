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
import {
  parseRaceTime, zoneFromType, vdotRunFloorMi, goalDistanceMiFromCode,
  FADE_TAIL_DAYS,
  VDOT_FULL_VALUE_DAYS,
} from '@/lib/training/vdot';
import { loadEffectiveMaxHr } from '@/lib/training/max-hr';
import { runnerTimezoneOrPacific } from '@/lib/runtime/runner-tz';
import { excludeDistanceReviewSql } from '@/lib/runs/distance-guard';
import {
  runDaySql,
  runDistanceMiSql,
  runFinishSecSql,
  runAvgHrSql,
  runElevGainFtSql,
  runSplitsSql,
  runPhasesSql,
  runWorkoutTypeSql,
  runSourceSql,
  runIndoorSql,
  runNotMergedSql,
} from '@/lib/runs/run-shape';
import { distanceMiFromLabel } from '@/lib/race/distance';
import { resolveRunTerrain } from '@/lib/terrain/run-terrain';

// ── Input shapes — match exactly what bestRecentVdot() accepts ──────────────

export interface RaceVdotInput {
  slug: string;
  name: string;
  date: string;
  /**
   * Raw `races.meta->>'priority'`. `string | null`, not the A/B/C union: the
   * SQL no longer filters on it, and `lib/faff/types.ts` allows `training_run`
   * and `hilly_excluded` too. `selectionAuthority` grades every value, so an
   * unrecognised one is priced rather than silently read as an A race.
   */
  priority: string | null;
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
  /**
   * 2026-08-17 · terrain. `finish_seconds` above is GRADE-ADJUSTED when the
   * run carried a material elevation signal — a fitness estimate is a
   * judgement about effort, and effort is what the grade adjustment recovers.
   * These two fields keep the real numbers alongside it so no display path
   * ever mistakes the adjusted time for what the runner actually ran.
   */
  raw_finish_seconds: number | null;
  /** Seconds the terrain adjustment moved this candidate. 0 on flat runs. */
  terrain_delta_seconds: number;
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

// 2026-07-07 · ultra-honesty audit · delegate to the shared parser (was a
// local 4-branch fork that already returned null on unmatched — no 13.1
// fallthrough bug here — but silently didn't recognize 50K/50M/100K/100M
// labels at all, so an ultra race candidate's distance never resolved for
// bestRecentVdot's raceCandidates. vdotFromRace's own DANIELS_MAX_VALID_
// DISTANCE_MI gate still refuses to derive a VDOT from a resolved ultra
// distance — this just lets the candidate resolve its real distance
// instead of silently dropping out at the label-parse step.
function distFromLabel(label: string | null | undefined): number | null {
  return distanceMiFromLabel(label);
}

/**
 * Load race + run candidates for bestRecentVdot from one canonical query path.
 *
 * @param userId     - the runner's UUID
 * @param today      - ISO date (caller must pass their runnerToday() result)
 * @param windowDays - full-value race lookback in days (default
 *                     VDOT_FULL_VALUE_DAYS = 56, Research/01 §"Freshness
 *                     window"; must match the lookbackDays the caller passes to
 *                     bestRecentVdot). Race rows are FETCHED over
 *                     windowDays + FADE_TAIL_DAYS — bestRecentVdot owns
 *                     staleness (full value through windowDays, then the F1
 *                     fade); this loader's job is only to deliver every
 *                     candidate the fade can still see. Run candidates
 *                     always use a fixed 60-day window because training-derived
 *                     VDOT estimates go stale faster than race anchors.
 *
 * Throws on DB error — callers must NOT silently catch this into a numeric
 * default (that's the C1 bug class: swallow → undefined → goal-pace plan).
 */
export async function loadVdotInputs(
  userId: string,
  today: string,
  windowDays = VDOT_FULL_VALUE_DAYS,
): Promise<VdotInputs> {

  // ── Race candidates ──────────────────────────────────────────────────────

  // Compute cutoff in TS to keep the SQL parameters simple.
  //
  // 2026-08-17 · F1 regression fix: cutoff = windowDays + FADE_TAIL_DAYS, not
  // windowDays. The stale-anchor fade (bestRecentVdot, race-killer F1) keeps
  // an aging anchor at full value through windowDays and then fades it 0.1
  // VDOT / 14 days for FADE_TAIL_DAYS more — so it needs candidates up to
  // windowDays + FADE_TAIL_DAYS old. This loader's hard windowDays cutoff
  // starved it: fade-window candidates never left the DB, the fade never
  // fired in prod, and the exact cliff F1 was built to prevent happened on
  // schedule (Disney HM exited the SQL window overnight on Aug 1 → 47.9 →
  // 44.1, 15 days before the A-race). The fade's unit tests passed the whole
  // time because they fed candidates in-memory. Staleness judgment lives in
  // bestRecentVdot — including fresh-race precedence over faded anchors
  // (FRESH_RACE_PRECEDENCE_DAYS) — never in this fetch window.
  const raceCutoff = new Date(Date.parse(today + 'T12:00:00Z') - (windowDays + FADE_TAIL_DAYS) * 86400000)
    .toISOString().slice(0, 10);

  // Pull EVERY race within the lookback window.
  //
  // 2026-08-17 · the `AND meta->>'priority' IN ('A','B')` that stood here is
  // gone. It read as data hygiene and was load-bearing safety: it was the only
  // thing standing between the candidate pool and a jogged C race, because
  // selection is max-wins and `assessRaceRepresentativeness` was never on this
  // path. Opening it on its own would have let a C race set every prescribed
  // pace and let it supersede every legitimate training lead behind it.
  //
  // Both are closed first, in `bestRecentVdot`: a race's authority
  // (`lib/race/effort-authority.ts`) now bands it in the ranking, bounds the
  // training soft-cap ceiling, and gates the superseded-lead rule. So every
  // race can count, at the weight `Research/00b`'s effort table gives it,
  // instead of an A/B race counting fully and a C race not at all.
  //
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
        AND (meta->>'date')::date <  $3::date`,
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
            AND ${runNotMergedSql()}
            AND ${runDistanceMiSql()} > 2.5
            AND ${runDaySql()} >= $2
            AND ${runDaySql()} <= $3`,
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
      priority: (m.priority as string) ?? null,
      distance_mi: distMi,
      finish_seconds: finishSec,
    };
  });

  // ── Run candidates ───────────────────────────────────────────────────────

  // Fixed 60-day window: race results above are valid anchors for the full
  // windowDays; training-derived VDOT from quality runs goes stale faster.
  const runCutoff = new Date(Date.parse(today + 'T12:00:00Z') - 60 * 86400000)
    .toISOString().slice(0, 10);

  // 2026-07-06 · audit P1-52 · bucket ci.ts (UTC sync instant) into the
  // RUNNER'S calendar day before joining to the run's local date. Was
  // hardcoded 'America/Los_Angeles' — wrong-day joins dropped the
  // work-phase effort (the honest "virtual race") for any non-Pacific
  // runner. LA fallback for null-tz profiles keeps pre-fix behavior.
  const ciTz = await runnerTimezoneOrPacific(userId);

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
    src: string | null;
    indoor: boolean | null;
    elev_gain_ft: string | null;
    splits: unknown;
    phases: unknown;
  }>(
    `SELECT sa.id::text AS id,
            ${runDaySql('sa')} AS date,
            ${runWorkoutTypeSql('sa')} AS workout_type,
            ${runDistanceMiSql('sa')} AS distance_mi,
            -- 2026-08-17 · terrain inputs for the grade adjustment. A hilly
            -- training run under-reads as fitness and a net-downhill one
            -- over-reads; both feed the same VDOT estimate. See
            -- lib/terrain/run-terrain.ts for why splits are preferred over
            -- the rolled-up gain (they are the only source of LOSS) and why
            -- a treadmill row's elevGainFt is deliberately not read here.
            ${runSourceSql('sa')} AS src,
            ${runIndoorSql('sa')} AS indoor,
            ${runElevGainFtSql('sa')} AS elev_gain_ft,
            ${runSplitsSql('sa')} AS splits,
            ${runPhasesSql('sa')} AS phases,
            ${runFinishSecSql('sa')} AS finish_seconds,
            ${runAvgHrSql('sa')} AS avg_hr,
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
                AND (ci.ts AT TIME ZONE $4::text)::date = ${runDaySql('sa')}::date
                AND ci.id = (SELECT MAX(ci2.id) FROM coach_intents ci2
                              WHERE COALESCE(ci2.user_uuid, ci2.user_id) = sa.user_uuid
                                AND ci2.reason = 'watch_completion'
                                AND (ci2.ts AT TIME ZONE $4::text)::date = (ci.ts AT TIME ZONE $4::text)::date)
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
                AND (ci.ts AT TIME ZONE $4::text)::date = ${runDaySql('sa')}::date
                AND ci.id = (SELECT MAX(ci2.id) FROM coach_intents ci2
                              WHERE COALESCE(ci2.user_uuid, ci2.user_id) = sa.user_uuid
                                AND ci2.reason = 'watch_completion'
                                AND (ci2.ts AT TIME ZONE $4::text)::date = (ci.ts AT TIME ZONE $4::text)::date)
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
                AND pw.date_iso = ${runDaySql('sa')}
                AND pw.type IN ('tempo','threshold','intervals','marathon_pace','race','race_week_tuneup')
              ORDER BY pw.type
              LIMIT 1) AS plan_type
       FROM runs sa
      WHERE sa.user_uuid = $1
        AND ${runNotMergedSql('sa')}
        AND ${runDaySql('sa')} >= $2
        AND ${runDaySql('sa')} <  $3
        -- 2026-06-15 · floor lowered 4 → 3mi so a 5K-goal runner's ~3.1mi
        -- quality efforts leave the DB at all. The GOAL-RELATIVE gate
        -- (vdotRunFloorMi: 3.0 for 5K, 4.0 for longer) is applied downstream
        -- in vdotFromRun/bestRecentVdot — this WHERE is just the cheap row
        -- prefilter, set to the lowest floor any goal can ask for (5K = 3.0).
        AND ${runDistanceMiSql('sa')} >= 3
        -- 2026-07-06 · P1-26 · skip distance-quarantined rows. Runs over the
        -- 50 mi soft bound now ingest with data.qualityFlag='distance_review'
        -- instead of being 400'd + dead-lettered; they count toward volume
        -- (real ultra miles) but must NOT anchor fitness until reviewed — a
        -- forgot-to-End treadmill phantom here would fabricate a VDOT.
        -- See lib/runs/distance-guard.ts.
        AND ${excludeDistanceReviewSql('sa')}
        -- 2026-06-09 state-audit fix: was movingTimeS-only, a Strava field
        -- watch rows don't carry (they carry durationSec; their timeMoving
        -- is a display string, never castable) — which structurally
        -- excluded every watch-source run from VDOT candidacy. The
        -- HR-quality gate inside vdotFromRun was built for exactly those
        -- runs and never received one.
        AND ${runFinishSecSql('sa')} > 60
        -- C1-1e: exclude race-day runs. The curated races row is canonical for
        -- race-day performance; a GPS-over-measured Strava activity on the same
        -- day produces phantom-high VDOT (e.g. Disney 13.38mi vs curated
        -- 13.109mi at the same finish time → VDOT 49.2 vs correct 47.9).
        AND NOT EXISTS (
          SELECT 1 FROM races rr
           WHERE rr.user_uuid = $1
             AND ABS(
               (rr.meta->>'date')::date
               - ${runDaySql('sa')}::date
             ) <= 1
        )`,
    [userId, runCutoff, today, ciTz],
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
    const distMi = useWork ? workMi : (r.distance_mi != null ? Number(r.distance_mi) : null);
    const rawSec = useWork ? workSec : (r.finish_seconds != null ? Number(r.finish_seconds) : null);

    // ── Terrain ────────────────────────────────────────────────────────────
    // 2026-08-17 · a VDOT candidate is an effort estimate, so it is judged on
    // grade-adjusted pace. Doctrine: Research/11 §Mechanical Effects of Uphill
    // Running (3.3% per 1% grade) and Research/01 §Hills (descents refund only
    // 60-70%). The elevation is a property of the WHOLE run, so the factor is
    // computed once from the whole run and then applied to whichever segment
    // the candidate uses.
    //
    // Applying a whole-run factor to a work block assumes the climbing was
    // spread evenly through the session. That assumption is not free, and it is
    // stated rather than hidden: there is no per-phase elevation on the wire to
    // do better with. It is bounded by the materiality floor below — a run flat
    // enough for the assumption to be doubtful is also a run whose adjustment
    // is under 4 s/mi and therefore skipped entirely. In David's history every
    // run with a work block sits at 5-30 ft/mi, well inside that floor.
    const terrain = resolveRunTerrain({
      source: r.src,
      indoor: r.indoor,
      distanceMi: r.distance_mi != null ? Number(r.distance_mi) : null,
      durationSec: r.finish_seconds != null ? Number(r.finish_seconds) : null,
      elevGainFt: r.elev_gain_ft != null ? Number(r.elev_gain_ft) : null,
      splits: r.splits,
      phases: r.phases,
    });
    // Only act when the terrain moved the judgement by more than pace noise,
    // and never on a treadmill whose incline nobody recorded — an unknown
    // belt angle is not evidence of a flat one.
    const applyTerrain =
      terrain.material &&
      terrain.basis !== 'treadmill-incline-unknown' &&
      terrain.factor > 0 &&
      rawSec != null;
    const finishSec = applyTerrain ? rawSec! / terrain.factor : rawSec;

    return {
      id: String(r.id),
      date: r.date,
      // C1-1b: Strava's numeric workoutType → string taxonomy.
      // 0/2/null pass through to the HR gate.
      workout_type: r.workout_type != null
        ? (STRAVA_WORKOUT_TYPE[r.workout_type] ?? r.workout_type)
        : null,
      distance_mi: distMi,
      finish_seconds: finishSec != null ? Math.round(finishSec) : null,
      avg_hr: r.avg_hr != null ? Number(r.avg_hr) : null,
      max_hr: maxHrValue,
      // Zone-read ONLY the work-phase pace · applying a zone inversion to a
      // WU+CD-dragged overall pace would badly understate. Without work-phase
      // data the run keeps the conservative race interpretation (zone null).
      zone: useWork ? zoneFromType(r.plan_type) : null,
      raw_finish_seconds: rawSec != null ? Math.round(rawSec) : null,
      terrain_delta_seconds:
        applyTerrain && finishSec != null && rawSec != null ? Math.round(finishSec - rawSec) : 0,
    };
  });

  return { raceCandidates, runCandidates };
}

/**
 * Resolve the runner's goal-relative training-VDOT floor (vdotRunFloorMi) from
 * their stored goal — race goal preferred, else time-trial goal (goal-mode
 * runners have no race). A 5K-goal runner gets 3.0mi so their ~3.1mi quality
 * efforts qualify as fitness candidates; every longer/unknown goal keeps the
 * 4mi default. Pass the result as bestRecentVdot's minRunDistanceMi so the
 * projection cron, drift monitor, and plan generator all gate identically (a
 * mismatch would have the cron compute a 5K runner's VDOT while drift sees
 * none → false drift). Best-effort — returns 4 on any read failure.
 *
 * Cite: Research/01-pace-zones-vdot.md §field-test (a solo 5K IS a VDOT input).
 */
export async function goalRunFloorMiForUser(userId: string): Promise<number> {
  const row = (await pool.query<{ grd: string | null; ttd: string | null }>(
    `SELECT goal_race_distance AS grd, tt_goal_distance AS ttd
       FROM profile WHERE user_uuid = $1`,
    [userId],
  ).catch(() => ({ rows: [] as Array<{ grd: string | null; ttd: string | null }> }))).rows[0];
  const code = (row?.grd && row.grd !== 'none') ? row.grd : row?.ttd;
  return vdotRunFloorMi(goalDistanceMiFromCode(code));
}
