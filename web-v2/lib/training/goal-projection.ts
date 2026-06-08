/**
 * lib/training/goal-projection.ts · plan-trusts-itself projection.
 *
 * David 2026-06-04: "not everyone, or me, is going to do another race
 * while training for a race, so we have to be sure the coaching and the
 * plan and the adaptation will get me there. if its a goal, the plan
 * should get me there until its very clear I cannot."
 *
 * Doctrine shift. The old engine was backward-looking · projection was
 * derived from the runner's last race result via Daniels predictRaceTime.
 * Without a tune-up race during a long build, the projection stayed
 * frozen at the last race time. That punished anyone in a race-prep
 * build who isn't ALSO racing every 6 weeks.
 *
 * New doctrine · the plan is the path. PROJECTION = GOAL until drift
 * signals fire. The runner is assumed to be ON TRACK while they follow
 * the plan and no specific evidence shows fitness is regressing.
 *
 * Daniels actually backs this · §VDOT chapter: "Training-pace-derived
 * VDOT is valid when training is consistent." Pfitzinger §LT-pace +
 * tempo HR is a fitness gauge that doesn't need a race to read.
 *
 * Status ladder:
 *   · on-track  · projection = goal · no drift signals
 *   · watching  · projection = goal · soft signals firing · "next quality
 *                  run will tell us more"
 *   · off-track · projection = current VDOT-derived · clear evidence the
 *                  plan won't deliver as is · gap is real and worth
 *                  renegotiating
 *
 * Drift signals (weights):
 *   · STRONG · recent priority A/B race > 2% slower than goal pace
 *   · STRONG · VDOT trend down ≥ 1 point over 4+ weeks (snapshot history)
 *   · MEDIUM · aerobic decoupling trending up across last 3 long runs
 *   · MEDIUM · tempo/threshold paces ≥ 10s/mi slower for 3+ weeks
 *   · MEDIUM · plan adapter forced 2+ weeks of easy downgrades
 *   · WEAK   · 30%+ key sessions missed in last 4 weeks
 *
 * Status thresholds:
 *   · 1 strong OR ≥ 2 medium → off-track
 *   · 1 medium OR ≥ 2 weak  → watching
 *   · otherwise              → on-track
 */

import { pool } from '@/lib/db/pool';
import { getCanonicalRunIds, isoDaysBefore } from '@/lib/runs/volume';
import { predictRaceTime, vdotFromRace } from './vdot';
import { computeDecouplingTrend } from './decoupling-trend';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { heatAdjustedStatus } from '@/lib/coach/heat-band';

export type GoalStatus = 'on-track' | 'watching' | 'off-track';
export type DriftWeight = 'strong' | 'medium' | 'weak';

export interface DriftSignal {
  kind: 'recent_race' | 'vdot_trend' | 'aerobic_decoupling'
    | 'tempo_pace_drift' | 'plan_adapter_downgrades' | 'missed_key_workouts';
  weight: DriftWeight;
  /** Plain-language explanation the runner can verify. */
  detail: string;
  /** Raw numbers for diagnostic / debug surfaces. */
  evidence: Record<string, number | string | null>;
}

export interface GoalProjection {
  status: GoalStatus;
  /** What we tell the runner: goal when ON TRACK / WATCHING, VDOT-derived
   *  when OFF TRACK. The single projection number for the gauge. */
  projectionSec: number;
  /** The goal · always present so display can show "X projected · Y goal"
   *  when off-track. */
  goalSec: number;
  /** The raw current-VDOT projection · always computed. Used when status
   *  flips to off-track AND for the "soft watch" hint when WATCHING. */
  vdotProjectionSec: number | null;
  /** All firing drift signals · empty when ON TRACK. */
  driftSignals: DriftSignal[];
  /** One-liner the page can render under the gauge. */
  summary: string;
  /** 2026-06-04 · the next 1-3 quality workouts on the plan · "next test
   *  points." Renders as "Next: Wed Jun 11 · 4mi tempo." Empty when no
   *  active plan or no upcoming quality days. */
  nextTestPoints: Array<{
    dateISO: string;
    type: string;
    label: string;             // e.g. "4mi tempo"
    distanceMi: number | null;
  }>;
  /** 2026-06-04 · the past 1-3 completed quality runs · "recent test
   *  points." Same shape + verdict from the heat-adjusted phase band.
   *  Lets the runner see what the recent quality work landed at without
   *  leaving the Targets page. */
  recentTestPoints: Array<{
    dateISO: string;
    type: string;
    label: string;
    distanceMi: number | null;
    /** Actual avg pace string · "7:17". Null when run lacked pace data. */
    actualPace: string | null;
    /** Heat-adjusted verdict · 'on' when ran inside the duration-scaled
     *  Maughan band, 'fast' when overcooked vs plan, 'slow' when real
     *  miss even with heat allowance. Null when target pace unknown. */
    verdict: 'on' | 'fast' | 'slow' | null;
  }>;
  /** 2026-06-04 · forecast copy · "what would flip the status." Pair of
   *  human-readable conditions derived from the current signals · tells
   *  the runner WHAT moves the gauge without being prescriptive. */
  transitions: {
    /** Copy that explains what would tip the status one rung BETTER
     *  (watching → on-track, or off-track → watching). Null when
     *  already at the top (ON TRACK). */
    toBetter: string | null;
    /** Copy that explains what would tip the status one rung WORSE
     *  (on-track → watching, or watching → off-track). Null when
     *  already at the bottom (OFF TRACK). */
    toWorse: string | null;
  };
}

export async function computeGoalProjection(args: {
  userUuid: string;
  goalSec: number;
  raceDistanceMi: number;
  vdot: number | null;
}): Promise<GoalProjection> {
  const { userUuid, goalSec, raceDistanceMi, vdot } = args;

  const vdotProjectionSec = vdot != null
    ? predictRaceTime(vdot, raceDistanceMi) ?? null
    : null;

  // Collect drift signals · each detector returns 0 or 1 signal. Failures
  // (DB error, missing data) silently produce no signal · we never punish
  // a healthy runner because a query timed out.
  const driftSignals: DriftSignal[] = [];
  const detectors = [
    () => detectRecentRaceDrift(userUuid, goalSec, raceDistanceMi),
    () => detectVdotTrendDrift(userUuid),
    () => detectAerobicDecouplingDrift(userUuid),
    () => detectTempoPaceDrift(userUuid, vdot),
    () => detectPlanAdapterDrift(userUuid),
    () => detectMissedKeyWorkoutDrift(userUuid),
  ];
  for (const detect of detectors) {
    try {
      const signal = await detect();
      if (signal) driftSignals.push(signal);
    } catch {
      // swallow · a broken detector ≠ drift
    }
  }

  // Status ladder
  const strongCount = driftSignals.filter((s) => s.weight === 'strong').length;
  const mediumCount = driftSignals.filter((s) => s.weight === 'medium').length;
  const weakCount = driftSignals.filter((s) => s.weight === 'weak').length;

  let status: GoalStatus = 'on-track';
  if (strongCount >= 1 || mediumCount >= 2) {
    status = 'off-track';
  } else if (mediumCount >= 1 || weakCount >= 2) {
    status = 'watching';
  }

  // Projection = goal until off-track
  const projectionSec = status === 'off-track' && vdotProjectionSec != null
    ? vdotProjectionSec
    : goalSec;

  const summary = composeSummary(status, driftSignals, goalSec, vdotProjectionSec);
  const [nextTestPoints, recentTestPoints] = await Promise.all([
    loadNextTestPoints(userUuid).catch(() => []),
    loadRecentTestPoints(userUuid).catch(() => []),
  ]);
  const transitions = composeTransitions(status, driftSignals);

  return {
    status,
    projectionSec,
    goalSec,
    vdotProjectionSec,
    driftSignals,
    summary,
    nextTestPoints,
    recentTestPoints,
    transitions,
  };
}

/** Load the next 1-3 quality workouts from the active plan · tempo,
 *  threshold, intervals, long, race. Quality days are the test points
 *  · each one tells us something about current fitness.
 *
 *  2026-06-04 · exclude days where a real run already landed. Without
 *  this, today's completed tempo stays in the list as a "next" test
 *  point ("I did June 4 today · should we show its impact or remove
 *  it?" · David's QC). NOT EXISTS join against canonical runs (the
 *  same dedup-aware filter the rest of the system uses · skips
 *  absorbed/merged rows). Run-day-of-week 1mi-minimum guard so a tiny
 *  shake-out doesn't accidentally clear a planned tempo. */
async function loadNextTestPoints(
  userUuid: string,
): Promise<GoalProjection['nextTestPoints']> {
  const today = await runnerToday(userUuid);
  const rows = (await pool.query<{
    date_iso: string;
    type: string;
    sub_label: string | null;
    distance_mi: number | string | null;
  }>(
    `SELECT pw.date_iso, pw.type, pw.sub_label, pw.distance_mi
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1::uuid
        AND tp.archived_iso IS NULL
        AND pw.type IN ('tempo','threshold','intervals','long','race')
        AND pw.date_iso >= $2
        AND NOT EXISTS (
          SELECT 1 FROM runs r
           WHERE r.user_uuid = $1::uuid
             AND r.data->>'date' = pw.date_iso
             AND NOT (r.data ? 'mergedIntoId')
             AND r.absorbed_into_canonical_at IS NULL
             AND COALESCE((r.data->>'distanceMi')::numeric, 0) >= 1.0
        )
      ORDER BY pw.date_iso ASC
      LIMIT 3`,
    [userUuid, today],
  ).catch(() => ({ rows: [] }))).rows;

  return rows.map((r) => {
    const dist = r.distance_mi != null ? Number(r.distance_mi) : null;
    const distLabel = dist != null ? `${dist.toFixed(dist % 1 === 0 ? 0 : 1)}mi` : '';
    // sub_label like "4 mi @ T" preserves the workout architecture · use
    // it when present, else fall back to "4mi tempo" pattern.
    const label = r.sub_label && r.sub_label.length < 40
      ? `${distLabel} ${r.type}${r.sub_label !== r.type.toUpperCase() ? ' · ' + r.sub_label : ''}`.trim()
      : `${distLabel} ${r.type}`.trim();
    return {
      dateISO: r.date_iso,
      type: r.type,
      label,
      distanceMi: dist,
    };
  });
}

/**
 * 2026-06-04 · the past 3 quality workouts that landed a real run.
 * Mirrors loadNextTestPoints in shape but joins to canonical runs to
 * pull the actual pace + weather, then re-derives a heat-adjusted
 * verdict on the fly. Same band rule as lib/coach/run-state.ts
 * loadPhaseBreakdown so the Targets page agrees with the phase
 * breakdown table on the Run Detail page.
 *
 * Verdict bands (mirrors the canonical heat-adjusted rule):
 *   · effectiveTarget = target × (1 + heatSlowdownPct/100)
 *   · 'on'   · actual ∈ [target − 10s, effectiveTarget + 10s]
 *   · 'fast' · actual < target − 10s (overcooked vs plan)
 *   · 'slow' · actual > effectiveTarget + 10s (real miss with heat allowance)
 */
async function loadRecentTestPoints(
  userUuid: string,
): Promise<GoalProjection['recentTestPoints']> {
  const today = await runnerToday(userUuid);
  // 2026-06-04 · pull the work-phase pace from coach_intents
  // (watch_completion) when available · otherwise fall back to
  // overall pace. Overall pace on tempo/intervals/threshold is
  // dragged down by WU + CD + recovery jogs and isn't a fair
  // comparison to the tempo block pace target.
  const rows = (await pool.query<{
    date_iso: string;
    type: string;
    sub_label: string | null;
    distance_mi: number | string | null;
    pace_target_s: number | string | null;
    distance_actual: string | null;
    duration_s: string | null;
    weather: unknown;
    work_pace_s: number | string | null;
  }>(
    `SELECT pw.date_iso, pw.type, pw.sub_label,
            pw.distance_mi, pw.pace_target_s_per_mi AS pace_target_s,
            r.data->>'distanceMi' AS distance_actual,
            r.data->>'durationSec' AS duration_s,
            r.data->'weather' AS weather,
            -- Work-phase actual pace from the watch_completion blob.
            -- jsonb_path_query_first returns the first matching value ·
            -- we then cast to numeric. NULL when no watch payload exists
            -- for the date (Strava-only / HK-only / manual runs).
            (
              SELECT AVG((phase->>'actualPaceSPerMi')::numeric)
                FROM coach_intents ci,
                     jsonb_array_elements(
                       CASE jsonb_typeof(ci.value::jsonb)
                         WHEN 'object' THEN ci.value::jsonb->'phases'
                         ELSE '[]'::jsonb
                       END
                     ) AS phase
               WHERE COALESCE(ci.user_uuid, ci.user_id) = $1::uuid
                 AND ci.reason = 'watch_completion'
                 AND ci.ts::date = pw.date_iso::date
                 AND phase->>'type' = 'work'
                 AND (phase->>'actualPaceSPerMi')::numeric > 0
            ) AS work_pace_s
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
       JOIN runs r
         ON r.user_uuid = $1::uuid
        AND r.data->>'date' = pw.date_iso
        AND NOT (r.data ? 'mergedIntoId')
        AND r.absorbed_into_canonical_at IS NULL
        AND COALESCE((r.data->>'distanceMi')::numeric, 0) >= 1.0
      WHERE tp.user_uuid = $1::uuid
        AND tp.archived_iso IS NULL
        AND pw.type IN ('tempo','threshold','intervals','long','race')
        AND pw.date_iso <= $2
      ORDER BY pw.date_iso DESC
      LIMIT 3`,
    [userUuid, today],
  ).catch(() => ({ rows: [] }))).rows;

  if (rows.length === 0) return [];

  const { judgeWeather } = await import('@/lib/coach/weather-adjust');

  return rows.map((r) => {
    const dist = r.distance_mi != null ? Number(r.distance_mi) : null;
    const distLabel = dist != null ? `${dist.toFixed(dist % 1 === 0 ? 0 : 1)}mi` : '';
    const label = r.sub_label && r.sub_label.length < 40
      ? `${distLabel} ${r.type}${r.sub_label !== r.type.toUpperCase() ? ' · ' + r.sub_label : ''}`.trim()
      : `${distLabel} ${r.type}`.trim();

    // Prefer work-phase pace (watch_completion · honest comparison
    // to the tempo target) · fall back to overall pace (distance /
    // duration · works for Strava-only / HK-only / manual runs).
    const workS = r.work_pace_s != null ? Number(r.work_pace_s) : null;
    const overallS = (() => {
      const distAct = r.distance_actual != null ? Number(r.distance_actual) : 0;
      const durS = r.duration_s != null ? Number(r.duration_s) : 0;
      if (distAct > 0 && durS > 0) return Math.round(durS / distAct);
      return null;
    })();
    const actualS = workS && workS > 0 ? Math.round(workS) : overallS;
    const targetS = r.pace_target_s != null ? Number(r.pace_target_s) : null;
    const actualPace = actualS && actualS > 0
      ? `${Math.floor(actualS / 60)}:${String(actualS % 60).padStart(2, '0')}`
      : null;

    // Heat-adjusted verdict · shared band (heatAdjustedStatus).
    let verdict: 'on' | 'fast' | 'slow' | null = null;
    if (targetS && targetS > 0 && actualS && actualS > 0) {
      const w = (r.weather && typeof r.weather === 'object') ? r.weather as Record<string, unknown> : null;
      let heatSlowdownPct = 0;
      if (w) {
        try {
          const j = judgeWeather({
            tempF: typeof w.temp_f === 'number' ? w.temp_f : null,
            tempF_start: typeof w.temp_f_start === 'number' ? w.temp_f_start : null,
            tempF_end: typeof w.temp_f_end === 'number' ? w.temp_f_end : null,
            tempF_peak: typeof w.temp_f_peak === 'number' ? w.temp_f_peak : null,
            humidityPct: typeof w.humidity_pct === 'number' ? w.humidity_pct : null,
            windMph: typeof w.wind_mph === 'number' ? w.wind_mph : null,
            conditions: typeof w.conditions === 'string' ? w.conditions : null,
            cloudCoverPct: typeof w.cloud_cover_pct === 'number' ? w.cloud_cover_pct : null,
            durationS: r.duration_s != null ? Number(r.duration_s) : null,
          });
          heatSlowdownPct = j.slowdownPct ?? 0;
        } catch { /* leave 0 · band collapses to symmetric */ }
      }
      verdict = heatAdjustedStatus(targetS, actualS, heatSlowdownPct);
    }

    return {
      dateISO: r.date_iso,
      type: r.type,
      label,
      distanceMi: dist,
      actualPace,
      verdict,
    };
  });
}

/** Compose human-readable "what flips the status" copy. Tied to the
 *  current signals · tells the runner WHAT moves the gauge without
 *  being prescriptive. */
function composeTransitions(
  status: GoalStatus,
  signals: DriftSignal[],
): GoalProjection['transitions'] {
  if (status === 'on-track') {
    // ON TRACK · already at the top. Show what would tip to WATCHING.
    return {
      toBetter: null,
      toWorse: 'Watching fires if a recent race lands 5%+ off goal · OR if aerobic decoupling widens · OR if tempo paces drift 10s/mi slower for 3 weeks · OR if the plan adapter forces 2+ weeks of downgrades.',
    };
  }
  if (status === 'watching') {
    // WATCHING · could flip either direction. Build "to better" from
    // the active signals · whatever clears the medium signal puts us
    // back ON TRACK.
    const medium = signals.find((s) => s.weight === 'medium');
    const toBetter = medium
      ? clearSignalCopy(medium)
      : 'Clear the soft signals · the next quality run hitting plan pace puts the plan back on the path.';
    return {
      toBetter,
      toWorse: 'OFF TRACK fires if another medium signal stacks on this one · OR if a recent race lands 10%+ off goal · OR if VDOT trend drops 1+ point over 4 weeks.',
    };
  }
  // OFF TRACK · already at the bottom. Show what would tip back to
  // WATCHING.
  const strong = signals.find((s) => s.weight === 'strong');
  if (strong && strong.kind === 'recent_race') {
    return {
      toBetter: 'A new race result within 5% of goal (or sustained tempo/threshold work at goal pace) lifts the status back to watching.',
      toWorse: null,
    };
  }
  if (strong && strong.kind === 'vdot_trend') {
    return {
      toBetter: 'A VDOT-yielding quality session that beats the current 4-week-ago estimate reverses the trend.',
      toWorse: null,
    };
  }
  return {
    toBetter: 'Clearing the strongest drift signal lifts the status back to watching · a tune-up race or a few weeks of plan-paced quality work usually does it.',
    toWorse: null,
  };
}

/** Per-signal "what clears this" copy. The runner sees exactly what
 *  the engine is waiting for. */
function clearSignalCopy(signal: DriftSignal): string {
  switch (signal.kind) {
    case 'recent_race':
      return 'A new race within 5% of goal pace clears this. Or 3+ weeks of tempo/threshold paces hitting plan targets, which lets the engine update VDOT from training.';
    case 'aerobic_decoupling':
      return 'Aerobic decoupling tightening back toward 5% (current band) on the next 2-3 long runs clears this. Hydration + carb fueling on long runs is the biggest lever.';
    case 'tempo_pace_drift':
      return 'Tempo paces hitting plan target for 2-3 sessions clears this. Cooler conditions, more carb fueling pre-session, or backing off a bit if cumulative fatigue is the culprit.';
    case 'plan_adapter_downgrades':
      return 'A clean 2 weeks where the adapter doesn\'t need to step in (steady readiness, no streaks) clears this.';
    case 'missed_key_workouts':
      return 'Hit the next 3-4 key workouts as planned · the engine reweighs every week.';
    case 'vdot_trend':
      return 'A quality session that yields a VDOT estimate above the 4-week-ago number clears this · usually a tempo or threshold workout at goal pace or faster.';
    default:
      return 'Clearing the soft signal puts the plan back on the path.';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Detectors · each returns 0 or 1 signal. All independent + side-effect
// free · order doesn't matter, double-firing is fine (each is a distinct
// kind).
// ────────────────────────────────────────────────────────────────────────

/** STRONG · a finished priority A/B race at a SIMILAR distance within
 *  180 days that came in more than 2% slower than the goal's
 *  equivalent. Distance band ±30% of the goal · marathons don't count
 *  against half goals (different endurance skill in Daniels' framework
 *  · a runner can hit VDOT 48 at HM and only VDOT 44 at the marathon
 *  due to fueling/endurance, not lack of fitness for half).
 *
 *  Picks the FASTEST qualifying race (best fitness expression), not
 *  just the most recent · "what have you shown you can do." */
async function detectRecentRaceDrift(
  userUuid: string,
  goalSec: number,
  raceDistanceMi: number,
): Promise<DriftSignal | null> {
  const goalPacePerMi = goalSec / Math.max(raceDistanceMi, 0.1);
  const today = await runnerToday(userUuid);
  const cutoff = new Date(Date.parse(today + 'T12:00:00Z') - 180 * 86400000)
    .toISOString().slice(0, 10);
  const minDist = raceDistanceMi * 0.7;
  const maxDist = raceDistanceMi * 1.3;

  // FASTEST qualifying race · ranked by pace (s/mi). The runner has
  // proven this fitness · we use it as the "current fitness" anchor.
  const r = (await pool.query<{
    slug: string;
    name: string | null;
    date: string;
    dist: string | null;
    finish_s: number | string | null;
  }>(
    `SELECT slug,
            meta->>'name' AS name,
            meta->>'date' AS date,
            meta->>'distanceMi' AS dist,
            COALESCE(
              (actual_result->>'finishS')::numeric,
              NULLIF(meta->>'finishTime','')::numeric
            ) AS finish_s
       FROM races
      WHERE user_uuid = $1::uuid
        AND meta->>'priority' IN ('A','B')
        AND meta->>'date' < $2
        AND meta->>'date' >= $3
        AND (meta->>'distanceMi')::numeric BETWEEN $4 AND $5
        AND COALESCE(
              (actual_result->>'finishS')::numeric,
              NULLIF(meta->>'finishTime','')::numeric
            ) IS NOT NULL
      ORDER BY (
        COALESCE(
          (actual_result->>'finishS')::numeric,
          NULLIF(meta->>'finishTime','')::numeric
        ) / NULLIF((meta->>'distanceMi')::numeric, 0)
      ) ASC
      LIMIT 1`,
    [userUuid, today, cutoff, minDist, maxDist],
  ).catch(() => ({ rows: [] }))).rows[0];

  if (!r || !r.finish_s || !r.dist) return null;
  const dist = Number(r.dist);
  const finishS = Number(r.finish_s);

  // 2026-06-04 · compare DISTANCE-NORMALIZED times, not raw paces.
  // Comparing marathon pace (484 s/mi) to half-marathon goal pace
  // (408 s/mi) flagged false positives because marathon pace is
  // naturally slower than half pace · the runner was ON TRACK but the
  // detector said -18% slow.
  //
  // Right move · compute VDOT from the race result, then predict what
  // that VDOT would yield at the GOAL race's distance. Compare to the
  // goal time. Same fitness, same effort, just normalized to the same
  // race length.
  const raceVdot = vdotFromRace(finishS, dist);
  if (raceVdot == null) return null;
  const equivalentGoalDistTime = predictRaceTime(raceVdot, raceDistanceMi);
  if (equivalentGoalDistTime == null) return null;
  const slowdownPct = (equivalentGoalDistTime - goalSec) / goalSec * 100;
  // Goal pace + slowdown context (kept in evidence for the diagnostic
  // line but no longer drives the trigger).
  void goalPacePerMi;

  // Thresholds calibrated to David's "very clear cannot get there"
  // standard. A 6.6% slowdown from a 4-month-old race isn't undeniable
  // · 4 months of training can close that. The plan deserves the
  // benefit of the doubt unless the gap is structural.
  //
  //   < 5%       · no signal · plan is in close range
  //   5% to 10%  · MEDIUM    · trending behind · one of several signals
  //                              before declaring off-track
  //   ≥ 10%      · STRONG    · ~2 VDOT points off · "very clear"
  //                              territory
  //
  // 10% maps roughly to "the runner's recent best time corresponds to
  // a VDOT 2 points below the goal VDOT" · in Daniels-speak that's
  // a real fitness gap, not a training-can-close-it gap.
  if (slowdownPct < 5) return null;
  const weight: DriftWeight = slowdownPct >= 10 ? 'strong' : 'medium';

  return {
    kind: 'recent_race',
    weight,
    detail: `${r.name ?? r.slug} on ${r.date} implies ${formatGoalTime(equivalentGoalDistTime)} at this race's distance · ${slowdownPct.toFixed(1)}% slower than the goal.`,
    evidence: {
      slug: r.slug,
      raceDate: r.date,
      raceFinishSec: finishS,
      raceDistanceMi: dist,
      raceVdot: Number(raceVdot.toFixed(1)),
      equivalentGoalDistTime,
      goalSec,
      slowdownPct: Number(slowdownPct.toFixed(2)),
    },
  };
}

/** STRONG · VDOT trend over 4+ weeks has dropped by ≥ 1 point.
 *  Read from projection_snapshots history. */
async function detectVdotTrendDrift(userUuid: string): Promise<DriftSignal | null> {
  const r = (await pool.query<{ recent: string | null; older: string | null }>(
    `WITH ranked AS (
       SELECT vdot, snapshot_date,
              ROW_NUMBER() OVER (ORDER BY snapshot_date DESC) AS rn
         FROM projection_snapshots
        WHERE user_uuid = $1::uuid
          AND vdot IS NOT NULL
          AND snapshot_date >= CURRENT_DATE - INTERVAL '60 days'
        GROUP BY vdot, snapshot_date
     )
     SELECT
       (SELECT vdot::text FROM ranked WHERE rn <= 7 ORDER BY snapshot_date DESC LIMIT 1) AS recent,
       (SELECT vdot::text FROM ranked WHERE snapshot_date <= CURRENT_DATE - INTERVAL '28 days' ORDER BY snapshot_date DESC LIMIT 1) AS older`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r || !r.recent || !r.older) return null;
  const recent = Number(r.recent);
  const older = Number(r.older);
  if (recent >= older - 1) return null;

  return {
    kind: 'vdot_trend',
    weight: 'strong',
    detail: `VDOT trend is down · ${older.toFixed(1)} four weeks ago, ${recent.toFixed(1)} now · ${(older - recent).toFixed(1)} points of fitness loss.`,
    evidence: { vdotRecent: recent, vdot4wAgo: older, delta: Number((recent - older).toFixed(2)) },
  };
}

/** MEDIUM · aerobic decoupling trending up across recent long runs.
 *  Worsening drift = aerobic engine slipping. */
async function detectAerobicDecouplingDrift(userUuid: string): Promise<DriftSignal | null> {
  const trend = await computeDecouplingTrend(userUuid).catch(() => null);
  if (!trend) return null;
  if (trend.direction !== 'declining') return null;
  // A "declining" trend means decoupling is INCREASING (worse aerobic
  // efficiency). 0.5pp+ worse is the threshold for medium signal.
  if (trend.currentDriftPct - trend.blockStartDriftPct < 0.5) return null;

  return {
    kind: 'aerobic_decoupling',
    weight: 'medium',
    detail: `Aerobic decoupling is widening · ${trend.blockStartDriftPct.toFixed(1)}% drift at block start, ${trend.currentDriftPct.toFixed(1)}% now. The engine is working harder for the same effort.`,
    evidence: {
      currentDriftPct: trend.currentDriftPct,
      blockStartDriftPct: trend.blockStartDriftPct,
      runsCount: trend.runsCount,
      weeksTracked: trend.weeksTracked,
    },
  };
}

/** MEDIUM · recent tempo/threshold paces drifting slower than the
 *  VDOT-implied T-pace by ≥ 10 s/mi for 3+ weeks. */
async function detectTempoPaceDrift(
  userUuid: string,
  vdot: number | null,
): Promise<DriftSignal | null> {
  if (!vdot) return null;
  // T-pace implied by current VDOT (Daniels: T-pace ≈ HM-pace minus
  // ~5 s/mi). Use predictRaceTime for HM, derive pace, subtract 5.
  const hmSec = predictRaceTime(vdot, 13.1);
  if (!hmSec) return null;
  const tPacePerMi = hmSec / 13.1 - 5;

  // Phase B · one canonical dedup. A dupe would inflate COUNT (the ≥3 gate) and
  // double-weight a tempo/threshold pace in the AVG. 22d slack ⊇ the 21d SQL
  // window (runner-TZ vs CURRENT_DATE skew); no run dates past today.
  const projToday = await runnerToday(userUuid);
  const canonicalIds = await getCanonicalRunIds(userUuid, isoDaysBefore(projToday, 22), projToday);
  const r = (await pool.query<{
    avg_pace_s: number | string | null;
    count: number | string;
  }>(
    `SELECT AVG((data->>'avgPaceSecPerMi')::numeric) AS avg_pace_s,
            COUNT(*) AS count
       FROM runs
      WHERE user_uuid = $1::uuid
        AND id = ANY($2::bigint[])
        AND (data->>'workoutType' = 'tempo' OR data->>'workoutType' = 'threshold')
        AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) >= (CURRENT_DATE - INTERVAL '21 days')::text
        AND (data->>'distanceMi')::numeric >= 4`,
    [userUuid, canonicalIds],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r || !r.avg_pace_s || Number(r.count) < 3) return null;
  const observedPaceSec = Number(r.avg_pace_s);
  const driftSecPerMi = observedPaceSec - tPacePerMi;
  if (driftSecPerMi < 10) return null;

  return {
    kind: 'tempo_pace_drift',
    weight: 'medium',
    detail: `Recent tempo paces averaging ${Math.round(driftSecPerMi)} s/mi slower than the VDOT-implied T-pace across ${r.count} sessions in the last 3 weeks.`,
    evidence: {
      observedPaceSec: Math.round(observedPaceSec),
      vdotTPaceSec: Math.round(tPacePerMi),
      driftSecPerMi: Math.round(driftSecPerMi),
      sessionCount: Number(r.count),
    },
  };
}

/** MEDIUM · plan adapter has forced 2+ weeks of downgrades. The
 *  adapter doesn't fire unless something's tripping it · sustained
 *  firing is a fitness drift signal. */
async function detectPlanAdapterDrift(userUuid: string): Promise<DriftSignal | null> {
  const r = (await pool.query<{ count: number | string }>(
    `SELECT COUNT(DISTINCT date_trunc('week', ci.ts)) AS count
       FROM coach_intents ci
      WHERE COALESCE(ci.user_uuid, ci.user_id::uuid) = $1::uuid
        AND ci.reason IN ('plan_adapt_downgrade','plan_adapt_shave')
        AND ci.ts >= NOW() - INTERVAL '28 days'`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r) return null;
  const weeksWithAdapts = Number(r.count);
  if (weeksWithAdapts < 2) return null;

  return {
    kind: 'plan_adapter_downgrades',
    weight: 'medium',
    detail: `Plan adapter has stepped in ${weeksWithAdapts} of the last 4 weeks · sustained downgrades signal the runner isn't absorbing the plan as designed.`,
    evidence: { weeksWithAdaptations: weeksWithAdapts },
  };
}

/** WEAK · 30%+ of scheduled key workouts (quality + long) missed in
 *  the last 4 weeks. */
async function detectMissedKeyWorkoutDrift(userUuid: string): Promise<DriftSignal | null> {
  const r = (await pool.query<{ scheduled: number | string; completed: number | string }>(
    `WITH key_window AS (
       SELECT pw.id, pw.date_iso, pw.type, pw.distance_mi
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1::uuid
          AND tp.archived_iso IS NULL
          AND pw.type IN ('long','tempo','threshold','intervals','race')
          AND pw.date_iso >= (CURRENT_DATE - INTERVAL '28 days')::text
          AND pw.date_iso < CURRENT_DATE::text
     )
     SELECT
       (SELECT COUNT(*) FROM key_window) AS scheduled,
       (SELECT COUNT(*) FROM key_window kw
         WHERE EXISTS (
           SELECT 1 FROM runs r
            WHERE r.user_uuid = $1
              AND NOT (r.data ? 'mergedIntoId')
              AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10)) = kw.date_iso
              AND (r.data->>'distanceMi')::numeric >= kw.distance_mi * 0.8
         )
       ) AS completed`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r) return null;
  const scheduled = Number(r.scheduled);
  const completed = Number(r.completed);
  if (scheduled < 3) return null;
  const missedPct = (scheduled - completed) / scheduled;
  if (missedPct < 0.3) return null;

  return {
    kind: 'missed_key_workouts',
    weight: 'weak',
    detail: `${scheduled - completed} of ${scheduled} key workouts missed in the last 4 weeks · ${Math.round(missedPct * 100)}%.`,
    evidence: {
      scheduledCount: scheduled,
      completedCount: completed,
      missedCount: scheduled - completed,
      missedPct: Number(missedPct.toFixed(2)),
    },
  };
}

// ────────────────────────────────────────────────────────────────────────
// Summary composition
// ────────────────────────────────────────────────────────────────────────

function composeSummary(
  status: GoalStatus,
  signals: DriftSignal[],
  goalSec: number,
  vdotProjectionSec: number | null,
): string {
  // 2026-06-04 · sub-headline copy. Pairs with the panel headline
  // ("The plan is the path." / "Watching · soft signals firing.") ·
  // the SUB is the supporting line. The actual drift signals get
  // listed below as their own chips (don't repeat them in the body).
  if (status === 'on-track') {
    return 'Keep doing the work · the plan is delivering as designed.';
  }
  if (status === 'watching') {
    return 'Hold the plan · the next quality run will tell us more.';
  }
  // off-track · the signals get listed as chips below so this stays
  // a one-liner framing the moment.
  return 'The math is honest · time to look at what the plan can still close, and what it can\'t.';
}

/** Format helper · seconds → "1:30:00" or "30:00". */
export function formatGoalTime(sec: number | null): string {
  if (sec == null) return '·';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}
