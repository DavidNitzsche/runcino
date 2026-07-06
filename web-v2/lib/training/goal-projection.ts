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
import { isoDaysBefore } from '@/lib/runs/volume';
import { predictRaceTime, vdotFromRace, tPaceFromVdot, vdotFromTpace, parseRaceTime } from './vdot';
import { computeDecouplingTrend } from './decoupling-trend';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { heatAdjustedStatus } from '@/lib/coach/heat-band';
import { projectFitnessTrajectory, type FitnessTrajectory } from './fitness-trajectory';
import { loadPlannedTargetVdot } from './plan-target';
import { expandSpecToPhases, type ExpandedPhase } from './expand-spec';
import type { WorkoutSpec } from '@/lib/plan/spec-builder';

export type GoalStatus = 'on-track' | 'watching' | 'off-track';
export type DriftWeight = 'strong' | 'medium' | 'weak';

/** 2026-07-06 · P1-10 fix · what a recent-test-point verdict compared.
 *  See GoalProjection.recentTestPoints[].verdictBasis. */
export type TestPointVerdictBasis =
  | 'work-phase-watch'
  | 'work-phase-splits'
  | 'blended-overall'
  | 'overall';

export interface DriftSignal {
  kind: 'recent_race' | 'vdot_trend' | 'aerobic_decoupling'
    | 'tempo_pace_drift' | 'plan_adapter_downgrades' | 'missed_key_workouts';
  weight: DriftWeight;
  /** Plain-language explanation the runner can verify. */
  detail: string;
  /** Raw numbers for diagnostic / debug surfaces. */
  evidence: Record<string, number | string | null>;
}

export interface ConfidenceInterval {
  /** Faster edge · seconds. */
  lo: number;
  /** Slower edge · seconds. */
  hi: number;
  /** Final half-width %, after status scaling · for display/diagnostics. */
  pct: number;
  /** Provenance · 'observed-cv' when sized off the runner's own pacing CV,
   *  'research-span' when off the Research/02 §13.7 table,
   *  'research-span-stale' when the §13.7 ±8% stale-input override fires
   *  (anchor >180 days old). */
  method: 'observed-cv' | 'research-span' | 'research-span-stale';
}

export interface ConfidenceLabel {
  tier: 'high' | 'medium' | 'low';
  word: 'HIGH' | 'MEDIUM' | 'LOW';
  /** Plain-English read · "doable, not banked". */
  descriptor: string;
  /** Supporting line in time terms (no VDOT jargon) · "4:54 to find · 10
   *  weeks to do it". */
  detail: string;
  /** Raw inputs for diagnostic surfaces. */
  evidence: Record<string, number | string>;
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
    /** 2026-06-09 Phase 2 (3.3) · the named test. The SAME numbers the
     *  drift detectors will judge the run by, stated before the run
     *  instead of after: work-phase pace ≤ T+10 (detectTempoPaceDrift's
     *  trigger edge) and avgHr ≤ 0.975×LTHR (the Friel Z4/5a seam — at
     *  or under threshold). Null for non-T-pace test points (long/race)
     *  or when VDOT/LTHR are unknown — never invented. */
    passCriteria: { paceMaxSPerMi: number; hrMaxBpm: number | null } | null;
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
    /** 2026-07-06 · P1-10 fix · WHAT the verdict compared. Additive —
     *  existing fields keep their meanings.
     *    'work-phase-watch'  · watch_completion work-phase pace vs work target
     *    'work-phase-splits' · work-window pace derived from mile splits +
     *                          workout_spec phase distances vs work target
     *    'blended-overall'   · whole-run pace vs a distance-weighted blend
     *                          (WU/CD at easy pace + work at target)
     *    'overall'           · whole-run pace vs a whole-run target
     *                          (long/race · target IS the whole-run pace)
     *  Null when the verdict abstained (no honest basis · never judge a
     *  warmup-included quality run against the bare work target). */
    verdictBasis: TestPointVerdictBasis | null;
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
  /** 2026-06-08 · statistical band around the current-fitness projection
   *  (vdotProjectionSec). Null at cold-start. See computeConfidenceInterval. */
  confidenceInterval: ConfidenceInterval | null;
  /** 2026-06-08 · goal-attainment confidence (HIGH/MEDIUM/LOW). Null at
   *  cold-start. See computeConfidenceLabel. */
  confidenceLabel: ConfidenceLabel | null;
  /** 2026-06-11 · the goal-seeking trajectory · current fitness + the planned
   *  build (scaled by execution quality) projected to race day, with the gap
   *  to goal and whether the plan is built to reach it. Null at cold-start
   *  (no current VDOT) or when the race date is unknown. The piece that makes
   *  the projection answer "executing this plan, where do I land on race day"
   *  instead of "where am I frozen today." See lib/training/fitness-trajectory. */
  trajectory: FitnessTrajectory | null;
}

export async function computeGoalProjection(args: {
  userUuid: string;
  goalSec: number;
  raceDistanceMi: number;
  vdot: number | null;
  /** 2026-06-08 · days until race day · runway axis for the confidence
   *  label. Null when the race date is unknown. */
  daysToRace?: number | null;
  /** 2026-06-08 · pacing-discipline result · sizes the CI off observed split
   *  CV when source='observed'. Computed once in the seed, shared with
   *  executionBufferSec. */
  pacing?: { cv: number | null; source: 'observed' | 'default' } | null;
  /** 2026-06-08 · ISO date of the race/run that produced vdot. Null when
   *  the snapshot predates migration 125. Used for the §13.7 stale-input
   *  ±8% override in computeConfidenceInterval. */
  vdotAnchorDateISO?: string | null;
  /** 2026-06-08 · distance (miles) of that anchor race/run. Null when
   *  unknown. Threaded for Case 1 (marathon one-sided pessimism); not yet
   *  read by computeConfidenceInterval — see docs/AUDIT-FIXES.md CI-followup-1. */
  vdotAnchorDistanceMi?: number | null;
}): Promise<GoalProjection> {
  const { userUuid, goalSec, raceDistanceMi, vdot, daysToRace, pacing,
          vdotAnchorDateISO, vdotAnchorDistanceMi } = args;

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
    loadNextTestPoints(userUuid, vdot).catch(() => []),
    loadRecentTestPoints(userUuid, vdot).catch(() => []),
  ]);
  const transitions = composeTransitions(status, driftSignals);

  // 2026-06-11 · the goal-seeking trajectory. Current fitness + the planned
  // build, scaled by how the runner is actually executing the plan, projected
  // to race day. executionQuality reads the recent quality-session verdicts +
  // missed-workout signal; plannedTargetVdot reads the plan's prescribed
  // ceiling (so the gain can't exceed what the plan trains toward, and an
  // under-built plan gets flagged). Null when there's no current VDOT or the
  // race date is unknown — the display falls back to the static projection.
  // 2026-06-16 · computed BEFORE the confidence band so the band can center on
  // the race-day projection, not the frozen current-fitness number.
  const executionQuality = executionQualityFromTestPoints(
    recentTestPoints,
    driftSignals.some((s) => s.kind === 'missed_key_workouts'),
  );
  const plannedTargetVdot = vdot != null
    ? await loadPlannedTargetVdot(userUuid, raceDistanceMi).catch(() => null)
    : null;
  // 2026-06-12 · the UPGRADE gear · symmetric opposite of the drift detectors.
  // Controlled over-performance on recent threshold work → unconfirmed
  // training-derived fitness the projection can read PAST goal with. Projection
  // space only — never moves vdot or any prescribed pace. 0 unless he's beating
  // the plan, so this is dormant for a runner who's merely on track.
  const overPerf = vdot != null
    ? await computeOverPerformanceBonus(userUuid, vdot).catch(() => ({ bonusVdot: 0, sessions: 0, medianBeatSPerMi: 0 }))
    : { bonusVdot: 0, sessions: 0, medianBeatSPerMi: 0 };
  const trajectory = (vdot != null && daysToRace != null)
    ? projectFitnessTrajectory({
        currentVdot: vdot,
        goalSec,
        raceDistanceMi,
        weeksToRace: daysToRace / 7,
        executionQuality,
        plannedTargetVdot,
        overPerformanceBonusVdot: overPerf.bonusVdot,
      })
    : null;

  // 2026-06-08 · confidence band + 2026-06-16 · RE-ANCHORED to the race-day
  // projection. The band centers on trajectory.projectedSec so it reads "where
  // you'll likely finish" with the goal sitting inside it — not the frozen
  // current-fitness number (whose band sat slower than the projection shown
  // above it, which read as a contradiction). Falls back to vdotProjectionSec
  // when there's no trajectory. The confidence label (goal attainment) is
  // computed once here so web / iPhone / watch all read one number.
  const confidenceInterval = computeConfidenceInterval({
    centerSec: trajectory?.projectedSec ?? vdotProjectionSec,
    raceDistanceMi,
    status,
    pacing: pacing ?? null,
    vdotAnchorDateISO: vdotAnchorDateISO ?? null,
    vdotAnchorDistanceMi: vdotAnchorDistanceMi ?? null,
  });
  const confidenceLabel = computeConfidenceLabel({
    goalSec,
    raceDistanceMi,
    vdot,
    daysToRace: daysToRace ?? null,
    status,
  });

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
    confidenceInterval,
    confidenceLabel,
    trajectory,
  };
}

/** 2026-06-11 · execution quality 0..1 from recent quality-session verdicts +
 *  whether key workouts are being missed. Feeds the fitness trajectory's slope:
 *  a runner hitting every session projects the full planned build; one missing
 *  or under-hitting sessions projects a discounted slope. Recency-weighted —
 *  the most recent session counts most. Default 0.7 when there's no verdict
 *  signal yet (assume roughly-following the plan, not nailing it). */
function executionQualityFromTestPoints(
  points: GoalProjection['recentTestPoints'],
  missedKeyWorkouts: boolean,
): number {
  const scored = points.filter((p) => p.verdict != null);
  if (scored.length === 0) return missedKeyWorkouts ? 0.5 : 0.7;
  // fast = over-eager but hitting the work; slow = a real miss vs target.
  const score = (v: 'on' | 'fast' | 'slow' | null): number =>
    v === 'on' ? 1.0 : v === 'fast' ? 0.9 : 0.45;
  // points arrive most-recent-first (loadRecentTestPoints ORDER BY date DESC).
  let wsum = 0, w = 0;
  scored.forEach((p, i) => {
    const weight = 1 / (i + 1);
    wsum += score(p.verdict) * weight;
    w += weight;
  });
  let q = w > 0 ? wsum / w : 0.7;
  if (missedKeyWorkouts) q *= 0.8;
  return Math.round(Math.max(0, Math.min(1, q)) * 100) / 100;
}

/** 2026-06-12 · the UPGRADE gear · the symmetric opposite of the drift detectors.
 *  Sustained, controlled over-performance on THRESHOLD work → unconfirmed
 *  training-derived fitness the forward projection can apply (projection space
 *  only — never moves currentVdot or any prescribed pace).
 *
 *  Research basis: VDOT updates canonically from races/TTs; a tempo landing
 *  "notably easier" is a +1-estimated LEAD that must be field-tested
 *  (Research/01 §triggers-to-retest). This productizes that lead as a labeled,
 *  capped projection bonus — NOT a canonical VDOT change. Intervals/long are
 *  excluded: the research treats them as stimulus, not fitness reads.
 *
 *  Gate (David 2026-06-12): a session counts only when the work-phase pace beat
 *  the prescribed target by ≥ BEAT_FLOOR s/mi AND avgHr stayed at/under LTHR —
 *  faster at threshold effort = fitter; faster with HR spiking = just overcooked,
 *  no signal. Needs ≥ MIN_SESSIONS so one hot tempo can't swing it. The bonus is
 *  the median demonstrated VDOT gain; the trajectory clamps it to the hard cap. */
async function computeOverPerformanceBonus(
  userUuid: string,
  currentVdot: number | null,
): Promise<{ bonusVdot: number; sessions: number; medianBeatSPerMi: number }> {
  const NONE = { bonusVdot: 0, sessions: 0, medianBeatSPerMi: 0 };
  if (!currentVdot) return NONE;
  const BEAT_FLOOR = 10;   // s/mi faster than prescribed to count as beating it
  const MIN_SESSIONS = 2;  // ≥2 controlled-fast sessions before the projection moves
  const today = await runnerToday(userUuid);
  const since = isoDaysBefore(today, 28);

  const lthr = (await pool.query<{ lthr: number | null }>(
    `SELECT lthr FROM profile WHERE user_uuid = $1::uuid LIMIT 1`, [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0]?.lthr ?? null;
  if (lthr == null) return NONE; // no HR governor → can't confirm "controlled"

  const rows = (await pool.query<{
    target_s: number | string | null;
    work_pace_s: number | string | null;
    avg_hr: number | string | null;
  }>(
    `SELECT pw.pace_target_s_per_mi AS target_s,
            ( SELECT AVG((phase->>'actualPaceSPerMi')::numeric)
                FROM coach_intents ci, jsonb_array_elements(
                  CASE jsonb_typeof(ci.value::jsonb) WHEN 'object'
                    THEN ci.value::jsonb->'phases' ELSE '[]'::jsonb END) AS phase
               WHERE COALESCE(ci.user_uuid, ci.user_id::uuid) = $1::uuid
                 AND ci.reason = 'watch_completion'
                 AND (ci.ts AT TIME ZONE 'America/Los_Angeles')::date = pw.date_iso::date
                 AND ci.id = (SELECT MAX(ci2.id) FROM coach_intents ci2
                               WHERE COALESCE(ci2.user_uuid, ci2.user_id::uuid) = $1::uuid
                                 AND ci2.reason = 'watch_completion'
                                 AND (ci2.ts AT TIME ZONE 'America/Los_Angeles')::date = pw.date_iso::date)
                 AND phase->>'type' = 'work' AND (phase->>'actualPaceSPerMi')::numeric > 0
            ) AS work_pace_s,
            -- AUDIT #35 · read the WORK-PHASE avg HR, not the whole-run avg HR.
            -- The honesty gate ("ran hot → overcooked") must compare HR from the
            -- SAME phase the pace is credited from. Whole-run avgHr is diluted by
            -- warm-up/cool-down (the route documents ~168 work-weighted → ~156
            -- whole-run), so an overcooked work block could clear hr > lthr.
            -- Mirrors the work_pace_s subquery above exactly: same latest
            -- watch_completion intent for the day, same phase->>'type' = 'work'
            -- filter, AVG across the work phases.
            ( SELECT AVG((phase->>'avgHr')::numeric)
                FROM coach_intents ci, jsonb_array_elements(
                  CASE jsonb_typeof(ci.value::jsonb) WHEN 'object'
                    THEN ci.value::jsonb->'phases' ELSE '[]'::jsonb END) AS phase
               WHERE COALESCE(ci.user_uuid, ci.user_id::uuid) = $1::uuid
                 AND ci.reason = 'watch_completion'
                 AND (ci.ts AT TIME ZONE 'America/Los_Angeles')::date = pw.date_iso::date
                 AND ci.id = (SELECT MAX(ci2.id) FROM coach_intents ci2
                               WHERE COALESCE(ci2.user_uuid, ci2.user_id::uuid) = $1::uuid
                                 AND ci2.reason = 'watch_completion'
                                 AND (ci2.ts AT TIME ZONE 'America/Los_Angeles')::date = pw.date_iso::date)
                 AND phase->>'type' = 'work' AND (phase->>'avgHr')::numeric > 0
            ) AS avg_hr
       FROM plan_workouts pw JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL
        AND pw.type IN ('tempo','threshold','race_week_tuneup')
        AND pw.date_iso >= $2 AND pw.date_iso <= $3`,
    [userUuid, since, today],
  ).catch(() => ({ rows: [] }))).rows;

  const bonuses: number[] = [];
  const beats: number[] = [];
  for (const r of rows) {
    const target = r.target_s != null ? Number(r.target_s) : null;
    const work = r.work_pace_s != null ? Number(r.work_pace_s) : null;
    const hr = r.avg_hr != null ? Number(r.avg_hr) : null; // AUDIT #35 · work-phase HR
    if (target == null || work == null || hr == null) continue;
    const beatBy = target - work;      // +ve = faster than prescribed
    if (beatBy < BEAT_FLOOR) continue; // not meaningfully faster
    if (hr > lthr) continue;           // work-phase HR over LTHR → overcooked, not a fitness read
    const demonstrated = vdotFromTpace(work);
    if (demonstrated == null) continue;
    bonuses.push(Math.max(0, demonstrated - currentVdot));
    beats.push(beatBy);
  }
  if (bonuses.length < MIN_SESSIONS) return { ...NONE, sessions: bonuses.length };
  const median = (a: number[]): number => {
    const s = [...a].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  return {
    bonusVdot: Math.round(median(bonuses) * 10) / 10,
    sessions: bonuses.length,
    medianBeatSPerMi: Math.round(median(beats)),
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
  /** Current VDOT · drives the pass-criteria T-pace. Null → no criteria. */
  vdot: number | null = null,
): Promise<GoalProjection['nextTestPoints']> {
  const today = await runnerToday(userUuid);
  // 2026-06-09 Phase 2 (3.3) · pass criteria for T-pace test points.
  // paceMax = T + 10 (the exact slow edge detectTempoPaceDrift tolerates
  // before counting drift); hrMax = 0.975 × LTHR (at-or-under threshold ·
  // same line the tune-up's pass note uses). Computed once per call.
  const tPace = tPaceFromVdot(vdot);
  const lthr = (await pool.query<{ lthr: number | null }>(
    `SELECT lthr FROM profile WHERE user_uuid = $1::uuid LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0]?.lthr ?? null;
  const T_PACE_CRITERIA_TYPES = new Set(['tempo', 'threshold', 'race_week_tuneup']);
  const criteriaFor = (type: string): { paceMaxSPerMi: number; hrMaxBpm: number | null } | null => {
    if (tPace == null || !T_PACE_CRITERIA_TYPES.has(type)) return null;
    return {
      paceMaxSPerMi: Math.round(tPace + 10),
      hrMaxBpm: lthr != null ? Math.round(lthr * 0.975) : null,
    };
  };
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
        AND pw.type IN ('tempo','threshold','intervals','long','race','race_week_tuneup')
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
      passCriteria: criteriaFor(r.type),
    };
  });
}

// ── 2026-07-06 · P1-10 fix · honest execution basis for quality runs ──────
//
// The bug: for runs with no watch_completion payload (Strava-only / HK-only /
// manual — most of the universal population) the verdict fell back to WHOLE-RUN
// pace judged against the WORK-PHASE target. A tempo session is WU + work + CD,
// so overall pace reads ~30-50 s/mi slower than the work target (this file's
// own drift-detector comment quantifies it) — every correctly-executed tempo
// graded 'slow', executionQuality collapsed to ~0.45, and the Targets hero
// flipped BEHIND. detectTempoPaceDrift was fixed to abstain without watch data;
// this is the same honest-absence doctrine applied to the verdict path, plus
// two recoveries that keep a verdict alive when the data supports one:
//
//   1. work-phase-splits · mile splits + workout_spec phase distances locate
//      the work window inside the run; pace over that window vs the work
//      target. Only for a CONTIGUOUS work block (tempo) — mile splits can't
//      resolve sub-mile reps interleaved with jog recoveries.
//   2. blended-overall · whole-run pace vs a distance-weighted expectation
//      (WU/CD at easy pace + work at target + timed recoveries), built from
//      the same expandSpecToPhases every other consumer uses.
//
// When neither basis exists (no spec, no splits, no watch) the verdict is
// null — executionQualityFromTestPoints already filters null verdicts and
// falls back to its no-signal default (0.7), so absence reads as "roughly
// following the plan", never as a fabricated miss.
// Cite: Research/01-pace-zones-vdot.md (E/T bands · easy = T+80..T+120 per
// spec-builder/derivePaces); Research/06-weather-adjustments.md §1 (heat band).

/** Per-mile split reduced to the two numbers the window math needs. */
interface PaceSplit { distMi: number; timeS: number }

/** "8:44" / "8:44/mi" → 524 s/mi. Watch + HK ingest rows carry the per-mile
 *  pace ONLY as this display string (verified against live rows 2026-07-06 ·
 *  keys: hr, mile, pace, cadence, elev_ft, distanceMi) — without parsing it
 *  the splits basis would never fire for the watch/HK population. */
function paceStrToSec(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(v.trim());
  if (!m) return null;
  const s = Number(m[1]) * 60 + Number(m[2]);
  return s > 0 ? s : null;
}

/** Normalize runs.data.splits across source shapes · mirrors the resolution
 *  order in lib/coach/run-state.ts (paceSPerMi legacy · paceSecPerMi watch/HK
 *  numeric · pace_s_per_mi snake · "m:ss" pace string (watch/HK ingest) ·
 *  average_speed Strava m/s · elapsed_time+distance Strava fallback).
 *  Returns [] when any split lacks a resolvable pace — a hole breaks the
 *  cumulative-distance window math, so all-or-nothing. Single-split stubs on
 *  multi-mile runs are legacy phase summaries, not per-mile splits
 *  (run-state.ts 2026-06-05 rule) → []. */
export function normalizePaceSplits(raw: unknown): PaceSplit[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out: PaceSplit[] = [];
  for (const s of raw as Array<Record<string, unknown>>) {
    if (!s || typeof s !== 'object') return [];
    const distM = Number(s.distance) || null;
    const distMi = Number(s.distanceMi ?? s.distance_mi)
      || (distM && distM > 0 ? distM / 1609.34 : 1.0);
    const avgSpeedMps = Number(s.average_speed) || null;
    const elapsedS = Number(s.elapsed_time ?? s.moving_time) || null;
    const sPerMi = Number(s.paceSPerMi)
      || Number(s.paceSecPerMi)
      || Number(s.pace_s_per_mi)
      || paceStrToSec(s.pace ?? s.pace_min_per_mi)
      || (avgSpeedMps && avgSpeedMps > 0 ? 1609.34 / avgSpeedMps : 0)
      || (elapsedS && elapsedS > 0 && distM && distM > 0 ? (elapsedS * 1609.34) / distM : 0);
    if (!sPerMi || sPerMi <= 0 || !isFinite(sPerMi) || distMi <= 0) return [];
    out.push({ distMi, timeS: sPerMi * distMi });
  }
  const totalMi = out.reduce((a, s) => a + s.distMi, 0);
  if (out.length === 1 && totalMi > 1.5) return [];
  return out;
}

/** Locate the single contiguous work window (miles from run start) in an
 *  expanded phase list. Returns null when work is split across disjoint
 *  blocks (threshold/intervals reps · mile splits can't resolve those) or
 *  the window is under half a mile. Time-only phases (jog recoveries)
 *  contribute their pace-implied distance to the cumulative axis. */
export function contiguousWorkWindowMi(
  phases: ExpandedPhase[],
): { startMi: number; endMi: number } | null {
  let cum = 0;
  let start: number | null = null;
  let end: number | null = null;
  let workClosed = false;
  for (const p of phases) {
    const d = p.distanceMi
      ?? (p.durationSec != null && p.targetPaceSPerMi
            ? p.durationSec / p.targetPaceSPerMi : 0);
    if (p.type === 'work') {
      if (workClosed) return null; // second disjoint work block
      if (start == null) start = cum;
      end = cum + d;
    } else if (start != null) {
      workClosed = true;
    }
    cum += d;
  }
  if (start == null || end == null || end - start < 0.5) return null;
  return { startMi: start, endMi: end };
}

/** Average pace (s/mi) over a distance window, using only splits that sit
 *  FULLY inside the window (±0.05mi slack). Straddling splits are excluded —
 *  a mile that is half warmup, half tempo averages the two paces, and the
 *  uniform-pace-within-a-split assumption is systematically wrong exactly at
 *  phase transitions (it read a perfectly-executed tempo ~10-15 s/mi hot at
 *  the edges). Requires the inside splits to cover ≥ half the window and
 *  ≥ 1 mile — under that there's no honest read → null. */
export function paceOverWindow(
  splits: PaceSplit[],
  startMi: number,
  endMi: number,
): number | null {
  const EPS = 0.05;
  let cum = 0, t = 0, d = 0;
  for (const s of splits) {
    const sStart = cum;
    const sEnd = cum + s.distMi;
    if (sStart >= startMi - EPS && sEnd <= endMi + EPS && s.distMi > 0) {
      t += s.timeS;
      d += s.distMi;
    }
    cum = sEnd;
  }
  if (d < Math.max(1.0, (endMi - startMi) * 0.5)) return null;
  return t / d;
}

/** Total expected time + distance from an expanded phase list:
 *  WU/CD at easy pace + work at target + timed recoveries at recovery pace.
 *  Null when any phase can't resolve both axes. */
export function blendedExpectation(
  phases: ExpandedPhase[],
): { timeS: number; distMi: number } | null {
  let t = 0, d = 0;
  for (const p of phases) {
    const pace = p.targetPaceSPerMi ?? null;
    const dist = p.distanceMi
      ?? (p.durationSec != null && pace ? p.durationSec / pace : null);
    const dur = p.durationSec
      ?? (dist != null && pace != null ? dist * pace : null);
    if (dist == null || dur == null || dist < 0 || dur < 0) return null;
    t += dur;
    d += dist;
  }
  return d > 0 ? { timeS: t, distMi: d } : null;
}

/** Distance-weighted whole-run pace expectation · Σtime / Σdistance. */
export function blendedOverallTargetSPerMi(phases: ExpandedPhase[]): number | null {
  const e = blendedExpectation(phases);
  return e ? e.timeS / e.distMi : null;
}

/** Easy pace for WU/CD in the blend. Canonical: T-pace from VDOT + 100
 *  (midpoint of the spec-builder/derivePaces easy band T+80..T+120 ·
 *  Research/01-pace-zones-vdot.md). No-VDOT fallback anchors on the work
 *  target itself: tempo/threshold/tuneup targets ≈ T (PACE-T-1); intervals
 *  target = I = T−18 (derivePaces intervalSec). WU/CD carry ~30% of a
 *  quality day's distance, so a ±20 s/mi easy-pace error moves the blend
 *  ≤ ~6 s/mi — inside the band. Null only when both anchors are missing. */
export function easyPaceForBlend(
  vdot: number | null,
  type: string,
  targetS: number | null,
): number | null {
  const t = tPaceFromVdot(vdot);
  if (t != null) return t + 100;
  if (targetS == null || targetS <= 0) return null;
  return type === 'intervals' ? targetS + 118 : targetS + 100;
}

/** Work-target quality types · pace_target_s_per_mi is the WORK-phase pace,
 *  never a fair whole-run comparison (spec-builder tempo/threshold/intervals/
 *  race_week_tuneup branches all return paceTargetSPerMi = work pace). */
const WORK_TARGET_TYPES = new Set(['tempo', 'threshold', 'intervals', 'race_week_tuneup']);

/**
 * 2026-07-06 · P1-10 fix · pure verdict resolution for one recent test point.
 * Exported for tests. Basis ladder (first honest read wins):
 *   1. work-phase-watch  · watch_completion work pace vs work target (±10)
 *   2. work-phase-splits · splits-derived work-window pace vs work target (±10)
 *   3. blended-overall   · overall pace vs WU/CD/work blend (±15 · the WU/CD
 *                          legs carry a ±30 s/mi band of their own in
 *                          expandSpecToPhases; half their typical ~30%
 *                          distance share widens the run-level band by ~5)
 *   4. abstain           · verdict null (honest absence · matches
 *                          detectTempoPaceDrift's no-watch-data doctrine)
 * Non-work-target types (long/race) keep the whole-run comparison — there the
 * target IS the whole-run pace (long guide band mid / race pace).
 */
export function judgeTestPointExecution(input: {
  type: string;
  targetS: number | null;
  watchWorkS: number | null;
  overallS: number | null;
  rawSplits: unknown;
  splitsUnreliable: boolean;
  spec: WorkoutSpec;
  plannedDistanceMi: number | null;
  actualDistanceMi: number | null;
  vdot: number | null;
  heatSlowdownPct: number;
}): {
  actualS: number | null;
  verdict: 'on' | 'fast' | 'slow' | null;
  basis: TestPointVerdictBasis | null;
} {
  const { type, targetS, watchWorkS, overallS, heatSlowdownPct } = input;
  // Easy/long band stays generous (David 2026-06-11) · quality stays tight.
  const tolerance = type === 'long' ? 40 : 10;
  const hasTarget = targetS != null && targetS > 0;

  // 1 · watch work-phase pace · the existing honest path, unchanged.
  if (watchWorkS != null && watchWorkS > 0) {
    const actualS = Math.round(watchWorkS);
    return {
      actualS,
      verdict: hasTarget ? heatAdjustedStatus(targetS!, actualS, heatSlowdownPct, tolerance) : null,
      basis: 'work-phase-watch',
    };
  }

  // Long/race · pace_target_s_per_mi is a whole-run pace → overall pace is
  // a fair comparison. Preserves pre-fix behavior for these types.
  if (!WORK_TARGET_TYPES.has(type)) {
    if (overallS == null || overallS <= 0) return { actualS: null, verdict: null, basis: null };
    return {
      actualS: overallS,
      verdict: hasTarget ? heatAdjustedStatus(targetS!, overallS, heatSlowdownPct, tolerance) : null,
      basis: 'overall',
    };
  }

  // Quality day without watch data. Never judge overall pace against the
  // bare work target — that's the P1-10 bug.
  if (!hasTarget || overallS == null || overallS <= 0) {
    return { actualS: overallS ?? null, verdict: null, basis: null };
  }

  const easyPaceSec = easyPaceForBlend(input.vdot, type, targetS);
  const phases = (input.spec && easyPaceSec != null)
    ? expandSpecToPhases({
        spec: input.spec,
        totalMi: input.plannedDistanceMi ?? input.actualDistanceMi ?? 8,
        easyPaceSec,
        recoveryPaceSec: 540,
      })
    : null;
  if (!phases || phases.length === 0) {
    // No spec (pre-migration rows) → abstain. Pre-fix these fabricated
    // 'slow'; honest absence beats a wrong number.
    return { actualS: overallS, verdict: null, basis: null };
  }

  // 2 · splits-derived work-window pace. Requires reliable per-mile splits,
  // a contiguous work block, and an actual distance near plan (a rerouted
  // 6mi run can't be windowed by an 8mi plan's mile axis).
  if (!input.splitsUnreliable) {
    const splits = normalizePaceSplits(input.rawSplits);
    const distOk = input.actualDistanceMi != null && input.plannedDistanceMi != null
      && Math.abs(input.actualDistanceMi - input.plannedDistanceMi)
           <= Math.max(1.0, input.plannedDistanceMi * 0.15);
    if (splits.length >= 2 && distOk) {
      const window = contiguousWorkWindowMi(phases);
      const workPace = window ? paceOverWindow(splits, window.startMi, window.endMi) : null;
      if (workPace != null && workPace > 0) {
        const actualS = Math.round(workPace);
        return {
          actualS,
          verdict: heatAdjustedStatus(targetS!, actualS, heatSlowdownPct, tolerance),
          basis: 'work-phase-splits',
        };
      }
    }
  }

  // 3 · blended whole-run expectation, reconciled with the ACTUAL distance
  //     (live rows show runners tack extra miles onto the planned shape ·
  //     e.g. a 3mi tempo spec inside a 5.8mi run):
  //   · ran LONGER  · pad the expectation with the extra miles at easy pace —
  //                   nobody runs bonus tempo; extra distance is easy volume.
  //   · ran well SHORT of the spec (> 1mi / 15%) · abstain — we can't know
  //     whether the work block or the WU/CD got cut, so no honest blend.
  const exp = blendedExpectation(phases);
  if (exp != null && exp.timeS > 0 && exp.distMi > 0) {
    let { timeS, distMi } = exp;
    const actual = input.actualDistanceMi;
    if (actual != null && actual > distMi + 0.1) {
      timeS += (actual - distMi) * easyPaceSec!; // easyPaceSec non-null when phases exist
      distMi = actual;
    } else if (actual != null && actual < distMi - Math.max(1.0, distMi * 0.15)) {
      return { actualS: overallS, verdict: null, basis: null };
    }
    const blend = timeS / distMi;
    return {
      actualS: overallS,
      verdict: heatAdjustedStatus(Math.round(blend), overallS, heatSlowdownPct, 15),
      basis: 'blended-overall',
    };
  }

  // 4 · abstain.
  return { actualS: overallS, verdict: null, basis: null };
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
 *
 * 2026-07-06 · P1-10 fix · WHAT gets compared is now resolved per-point by
 * judgeTestPointExecution (work-phase pace when watch or splits carry it,
 * blended whole-run expectation otherwise, abstention when nothing honest
 * exists). vdot threads through for the easy-pace leg of the blend.
 */
async function loadRecentTestPoints(
  userUuid: string,
  vdot: number | null,
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
    workout_spec: WorkoutSpec;
    splits: unknown;
    splits_unreliable: boolean | null;
  }>(
    `SELECT pw.date_iso, pw.type, pw.sub_label,
            pw.distance_mi, pw.pace_target_s_per_mi AS pace_target_s,
            pw.workout_spec,
            r.data->>'distanceMi' AS distance_actual,
            r.data->>'durationSec' AS duration_s,
            r.data->'weather' AS weather,
            -- P1-10 fix · per-mile splits + reliability flag so non-watch
            -- runs can still get a work-phase read (see judgeTestPointExecution).
            r.data->'splits' AS splits,
            (r.data->>'splits_unreliable')::boolean AS splits_unreliable,
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
                 AND (ci.ts AT TIME ZONE 'America/Los_Angeles')::date = pw.date_iso::date
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
        AND pw.type IN ('tempo','threshold','intervals','long','race','race_week_tuneup')
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

    // Heat context resolved per test point (per-finding context filters ·
    // CLAUDE.md 2026-05-19 round 4) before any comparison happens.
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

    const workS = r.work_pace_s != null ? Number(r.work_pace_s) : null;
    const overallS = (() => {
      const distAct = r.distance_actual != null ? Number(r.distance_actual) : 0;
      const durS = r.duration_s != null ? Number(r.duration_s) : 0;
      if (distAct > 0 && durS > 0) return Math.round(durS / distAct);
      return null;
    })();
    const targetS = r.pace_target_s != null ? Number(r.pace_target_s) : null;

    // P1-10 fix · basis ladder replaces the old "overall pace vs work
    // target" fallback that flipped every warmup-included quality run to
    // 'slow'. Easy/long band note (David 2026-06-11) lives inside the
    // judge: long keeps the generous ±40, quality keeps the tight ±10
    // on work-phase bases and ±15 on the blended whole-run basis.
    const judged = judgeTestPointExecution({
      type: r.type,
      targetS,
      watchWorkS: workS,
      overallS,
      rawSplits: r.splits,
      splitsUnreliable: r.splits_unreliable === true,
      spec: r.workout_spec ?? null,
      plannedDistanceMi: dist,
      actualDistanceMi: r.distance_actual != null ? Number(r.distance_actual) || null : null,
      vdot,
      heatSlowdownPct,
    });
    const actualS = judged.actualS;
    const actualPace = actualS && actualS > 0
      ? `${Math.floor(actualS / 60)}:${String(actualS % 60).padStart(2, '0')}`
      : null;

    return {
      dateISO: r.date_iso,
      type: r.type,
      label,
      distanceMi: dist,
      actualPace,
      verdict: judged.verdict,
      verdictBasis: judged.basis,
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

  // FASTEST qualifying race · ranked by distance-normalized pace. The runner
  // has proven this fitness · we use it as the "current fitness" anchor.
  //
  // 2026-06-16 · finish seconds are resolved in JS, NOT cast in SQL.
  // meta.finishTime is an H:MM:SS display string ("1:32:45"); the old
  // `NULLIF(meta->>'finishTime','')::numeric` threw `invalid input syntax for
  // type numeric` whenever actual_result.finishS was unset (every inline-edited
  // race row). The throw was swallowed by .catch + the detector loop, so the
  // single STRONG signal that flips a goal off-track silently never fired.
  // Parse the string the canonical way (parseRaceTime), then rank in JS.
  const rows = (await pool.query<{
    slug: string;
    name: string | null;
    date: string;
    dist: string | null;
    finish_s: number | string | null;
    finish_time: string | null;
  }>(
    `SELECT slug,
            meta->>'name' AS name,
            meta->>'date' AS date,
            meta->>'distanceMi' AS dist,
            (actual_result->>'finishS')::numeric AS finish_s,
            NULLIF(meta->>'finishTime','') AS finish_time
       FROM races
      WHERE user_uuid = $1::uuid
        AND meta->>'priority' IN ('A','B')
        AND meta->>'date' < $2
        AND meta->>'date' >= $3
        AND (meta->>'distanceMi')::numeric BETWEEN $4 AND $5
        AND (
          (actual_result->>'finishS') IS NOT NULL
          OR NULLIF(meta->>'finishTime','') IS NOT NULL
        )`,
    [userUuid, today, cutoff, minDist, maxDist],
  ).catch(() => ({ rows: [] }))).rows;

  // Resolve finish seconds (finishS, else parse the HMS string) and rank by
  // distance-normalized pace — all in JS, so a string finish can never throw.
  let best: { slug: string; name: string | null; date: string; dist: number; finishS: number; pace: number } | null = null;
  for (const row of rows) {
    const d = Number(row.dist);
    if (!d || d <= 0) continue;
    const fs = row.finish_s != null ? Number(row.finish_s) : parseRaceTime(row.finish_time);
    if (!fs || fs <= 0) continue;
    const pace = fs / d;
    if (!best || pace < best.pace) best = { slug: row.slug, name: row.name, date: row.date, dist: d, finishS: fs, pace };
  }

  if (!best) return null;
  const r = { slug: best.slug, name: best.name, date: best.date };
  const dist = best.dist;
  const finishS = best.finishS;

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
       (SELECT AVG(vdot)::text FROM ranked WHERE rn <= 7) AS recent,
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
 *  VDOT-implied T-pace by ≥ 10 s/mi for 3+ sessions in 21 days.
 *
 *  2026-06-09 state-audit fix · the old query was dead twice over:
 *  it filtered on data->>'workoutType' (a field no device-ingested run
 *  carried until the ingest stamp landed the same day) and averaged
 *  data->>'avgPaceSecPerMi' (a field NO run row carries · AVG was
 *  always null). And even alive it would have been dishonest ·
 *  overall pace on a WU + 4mi T + CD session reads ~30-50 s/mi slower
 *  than the tempo block, so comparing overall pace to T-pace fires on
 *  every well-executed tempo. Now mirrors loadRecentTestPoints: walk
 *  the PLAN's tempo/threshold days and read the watch_completion
 *  work-phase pace for each · the same number the Targets test-point
 *  verdicts use. Sessions without a watch payload contribute nothing
 *  (no watch → no signal, same net behavior as the dead detector ·
 *  honest absence beats a fabricated average). */
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

  const projToday = await runnerToday(userUuid);
  const r = (await pool.query<{
    avg_pace_s: number | string | null;
    count: number | string;
  }>(
    `SELECT AVG(t.work_pace) AS avg_pace_s, COUNT(*) AS count
       FROM (
         SELECT pw.date_iso,
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
                     AND (ci.ts AT TIME ZONE 'America/Los_Angeles')::date = pw.date_iso::date
                     -- 2026-06-11 · latest completion only. A day can carry
                     -- more than one watch_completion (a stale 1-phase push +
                     -- the real 3-phase run); averaging across both pulled a
                     -- 7:17 tempo to ~7:45 and fired a false drift signal.
                     -- Mirror loadRecentTestPoints, which already does this.
                     AND ci.id = (SELECT MAX(ci2.id) FROM coach_intents ci2
                                   WHERE COALESCE(ci2.user_uuid, ci2.user_id) = $1::uuid
                                     AND ci2.reason = 'watch_completion'
                                     AND (ci2.ts AT TIME ZONE 'America/Los_Angeles')::date = pw.date_iso::date)
                     AND phase->>'type' = 'work'
                     AND (phase->>'actualPaceSPerMi')::numeric > 0
                ) AS work_pace
           FROM plan_workouts pw
           JOIN training_plans tp ON tp.id = pw.plan_id
          WHERE tp.user_uuid = $1::uuid
            AND tp.archived_iso IS NULL
            AND pw.type IN ('tempo','threshold')
            AND pw.date_iso >= $3
            AND pw.date_iso <= $2
       ) t
      WHERE t.work_pace IS NOT NULL`,
    [userUuid, projToday, isoDaysBefore(projToday, 21)],
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

// ────────────────────────────────────────────────────────────────────────
// Confidence interval + label
// ────────────────────────────────────────────────────────────────────────

/**
 * Statistical band around the CURRENT-FITNESS projection (vdotProjectionSec),
 * NOT the goal. The honest "if you raced today, here's the spread."
 *
 * Base half-width · Research/02 §13.7 ("Confidence intervals to report with
 * predictions") + §4.3 (Daniels same-distance prediction error 1-3% in
 * well-trained runners) + §11.1 (single-input race noise ±1-3%). Keyed on
 * the TARGET race span:
 *    ≤10K        → ±2.0%   (§13.7 "5K→10K recent ±1.5%" + input-noise margin)
 *    HM (≤16mi)  → ±2.5%   (§13.7 "10K→half, recent input ±2.5%")
 *    marathon+   → ±3.0%   (§13.7 "half→marathon, marathon-trained ±3%")
 *
 * Observed-CV upgrade · once the runner has demonstrated pacing consistency
 * (pacing-discipline source='observed'), size off their own median split CV
 * instead of the table default. Same 0.02 / 0.04 buckets as
 * lib/coach/pacing-discipline.ts, floored at 2.0% — never claim tighter than
 * the §4.3 fundamental error even for a metronome pacer.
 *
 * Status scaling · drift signals add uncertainty (faff overlay on §13.7):
 *    on-track ×1.0 · watching ×1.25 · off-track ×1.5
 *
 * Symmetric today. Two §13.7 refinements are deferred (see docs/AUDIT-FIXES.md):
 * marathon-without-a-block one-sided pessimism (§13.1 / §13.7 "±10% one-sided")
 * and the >6-month-old-input → ±8% override both need the VDOT anchor's
 * distance + age + a marathon-block signal, which aren't threaded yet.
 */
export function computeConfidenceInterval(args: {
  centerSec: number | null;
  raceDistanceMi: number;
  status: GoalStatus;
  pacing?: { cv: number | null; source: 'observed' | 'default' } | null;
  /** ISO date of the VDOT anchor race/run. When supplied and >180 days before
   *  today, the §13.7 stale-input override fires: basePct → 8.0%, symmetric,
   *  superseding both observed-CV and the standard distance table. */
  vdotAnchorDateISO?: string | null;
  /** Distance (miles) of the anchor race/run. Threaded for Case 1 (marathon
   *  one-sided pessimism); not yet consumed here — see AUDIT-FIXES CI-followup-1. */
  vdotAnchorDistanceMi?: number | null;
}): ConfidenceInterval | null {
  const { centerSec, raceDistanceMi, status, pacing, vdotAnchorDateISO } = args;
  if (centerSec == null || centerSec <= 0) return null; // cold-start · no band

  // Research/02 §13.7 "cross-prediction with >6-month-old input → ±8%".
  // 180 days matches the bestRecentVdot lookback window so a VDOT that just
  // barely survives the freshness cut can still trigger the wider band if
  // the anchor race itself is older.
  const STALE_DAYS = 180;
  if (vdotAnchorDateISO) {
    const anchorMs = Date.parse(vdotAnchorDateISO + 'T12:00:00Z');
    if (!isNaN(anchorMs)) {
      const ageDays = (Date.now() - anchorMs) / 86_400_000;
      if (ageDays > STALE_DAYS) {
        const mult = status === 'off-track' ? 1.5 : status === 'watching' ? 1.25 : 1.0;
        const half = Math.round((centerSec * 8.0 * mult) / 100);
        const pct = Math.round(8.0 * mult * 10) / 10;
        return { lo: centerSec - half, hi: centerSec + half, pct, method: 'research-span-stale' };
      }
    }
  }

  let basePct: number;
  let method: ConfidenceInterval['method'];
  if (pacing?.source === 'observed' && pacing.cv != null) {
    // Observed split-CV buckets (mirror pacing-discipline thresholds), floored
    // at the §4.3 minimum.
    basePct = pacing.cv < 0.02 ? 2.0 : pacing.cv < 0.04 ? 2.5 : 3.5;
    method = 'observed-cv';
  } else {
    // Research/02 §13.7 span table, keyed on target distance.
    basePct = raceDistanceMi <= 6.5 ? 2.0 : raceDistanceMi <= 16 ? 2.5 : 3.0;
    method = 'research-span';
  }

  const mult = status === 'off-track' ? 1.5 : status === 'watching' ? 1.25 : 1.0;
  const half = Math.round((centerSec * basePct * mult) / 100);
  const pct = Math.round(basePct * mult * 10) / 10;

  return { lo: centerSec - half, hi: centerSec + half, pct, method };
}

/**
 * Goal-attainment confidence (the LABEL on the goal, distinct from the band).
 * Answers "solidly on track or barely?" by comparing the fitness gap to what
 * the runway can plausibly close, then gating by drift status.
 *
 * Build rate · a focused block typically moves ~3-5 VDOT over 12-16 weeks
 * (≈0.25-0.4 pts/wk · Research/00a periodization). 0.35 is the tunable
 * midpoint, calibrated so a 3-point gap over a 10-week runway reads MEDIUM.
 */
const BUILD_RATE_VDOT_PER_WEEK = 0.35;

export function computeConfidenceLabel(args: {
  goalSec: number;
  raceDistanceMi: number;
  vdot: number | null; // current
  daysToRace: number | null;
  status: GoalStatus;
}): ConfidenceLabel | null {
  const { goalSec, raceDistanceMi, vdot, daysToRace, status } = args;
  if (vdot == null) return null; // cold-start · no honest read
  const goalVdot = vdotFromRace(goalSec, raceDistanceMi);
  if (goalVdot == null) return null;

  const gapVdot = goalVdot - vdot; // +ve = behind the goal
  const gapSec = (predictRaceTime(vdot, raceDistanceMi) ?? goalSec) - goalSec;
  const runwayWeeks = daysToRace != null ? daysToRace / 7 : null;

  // Base tier · gap vs what the runway can close.
  let tier: ConfidenceLabel['tier'];
  if (gapVdot <= 0) {
    tier = 'high'; // already at or ahead of the goal's fitness
  } else if (runwayWeeks == null) {
    tier = 'medium'; // gap exists, runway unknown → middling
  } else if (runwayWeeks < 2) {
    tier = 'low'; // no time left to close it
  } else {
    const closable = runwayWeeks * BUILD_RATE_VDOT_PER_WEEK;
    const ratio = gapVdot / Math.max(closable, 0.1);
    tier = ratio <= 0.5 ? 'high' : ratio <= 1.0 ? 'medium' : 'low';
  }

  // Drift-status cap · soft/hard signals can't co-exist with high confidence.
  if (status === 'off-track' && tier !== 'low') tier = 'low';
  if (status === 'watching' && tier === 'high') tier = 'medium';

  const word: ConfidenceLabel['word'] =
    tier === 'high' ? 'HIGH' : tier === 'medium' ? 'MEDIUM' : 'LOW';
  const descriptor =
    tier === 'high' ? 'tracking to hit it'
    : tier === 'medium' ? 'doable, not banked'
    : 'behind on this runway';
  const detail = gapVdot <= 0
    ? 'ahead of the number · hold the plan'
    : runwayWeeks != null
      ? `${formatGoalTime(Math.round(gapSec))} to find · ${Math.round(runwayWeeks)} weeks to do it`
      : `${formatGoalTime(Math.round(gapSec))} to find`;

  return {
    tier,
    word,
    descriptor,
    detail,
    evidence: {
      gapVdot: Number(gapVdot.toFixed(1)),
      gapSec: Math.round(gapSec),
      currentVdot: vdot,
      goalVdot: Number(goalVdot.toFixed(1)),
      runwayWeeks: runwayWeeks != null ? Number(runwayWeeks.toFixed(1)) : 'unknown',
      status,
    },
  };
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
