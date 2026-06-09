/**
 * GET /api/runs/[id]/recap
 *
 * Returns the post-run recap payload for a completed canonical run:
 *
 *   {
 *     verdict:  string,                // "Banked the long."
 *     facts:    string[],              // 1-2 sentences on what landed
 *     coach_tip: string | null,        // forward-looking advice
 *     conditions_note: string | null,  // null if conditions were neutral
 *     citations: { slug, label }[]    // research backing
 *   }
 *
 * Doctrine: lib/coach/run-recap.ts header.
 *
 * Surfaces that should consume:
 *   · Web /today CompletedHeroV2 (replaces the static `planRecap` strings)
 *   · Web Activity drawer
 *   · iPhone TodayView post-run card
 *   · iPhone Activity / RunDetailView
 *   · watch SummaryView (compact verdict only)
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { deriveRecap } from '@/lib/coach/run-recap';
import { deriveWin } from '@/lib/coach/run-win';
import type { Phase, WorkoutType } from '@/lib/coach/run-purpose';

export const dynamic = 'force-dynamic';

const PHASE_FROM_LABEL: Record<string, Phase> = {
  BASE: 'BASE', base: 'BASE',
  BUILD: 'BUILD', build: 'BUILD',
  PEAK: 'PEAK', peak: 'PEAK',
  TAPER: 'TAPER', taper: 'TAPER',
  RECOVERY: 'RECOVERY', recovery: 'RECOVERY',
};

/**
 * Parse an "M:SS" / "MM:SS" pace string to seconds-per-mile.
 *
 * E4: watch + Apple-Health runs store the human-readable pace in
 * `data.avgPaceMinPerMi` ("8:09") and leave the numeric `data.paceSPerMi`
 * null. The recap previously read only `paceSPerMi`, so `actualPaceSPerMi`
 * was null on every watch/HK run — the dominant pace shape — dropping pace
 * from the recap facts and disabling the pace-gated wins (winTempo/winLong,
 * which both bail when `actualPaceSPerMi` is null). Any runner, any
 * watch/HK-sourced run. Returns null on absent/garbage input (cold-start
 * safe; numeric `paceSPerMi` still wins when present).
 */
function parsePaceToSec(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d+):([0-5]?\d)$/);
  if (!m) return null;
  const sec = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return sec > 0 ? sec : null;
}

/** Most common value in a list (ties resolve to the first seen). Picks the
 *  representative frozen work-phase target across reps (E3). */
function modePace(xs: number[]): number {
  const counts = new Map<number, number>();
  let best = xs[0];
  let bestN = 0;
  for (const x of xs) {
    const n = (counts.get(x) ?? 0) + 1;
    counts.set(x, n);
    if (n > bestN) { bestN = n; best = x; }
  }
  return best;
}

/** seconds-per-mile → "M:SS/mi". */
function fmtPaceSlash(s: number): string {
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}/mi`;
}

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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { id } = await params;

  // Load the canonical run. Accept either the bigint id or
  // data->>activityId as a lookup key (Strava ids land in both shapes).
  const runRow = (await pool.query<{
    id: string;
    data: Record<string, any>;
  }>(
    `SELECT id::text AS id, data
       FROM runs
      WHERE user_uuid = $1
        AND (id::text = $2 OR data->>'activityId' = $2 OR data->>'id' = $2)
        AND absorbed_into_canonical_at IS NULL
        AND (data ? 'mergedIntoId') = false
      LIMIT 1`,
    [userId, String(id)],
  )).rows[0];

  if (!runRow) {
    return NextResponse.json({ error: 'run not found' }, { status: 404 });
  }

  const data = runRow.data ?? {};
  const date = (data.date as string) ?? String(data.startLocal ?? '').slice(0, 10);

  // Find the matching plan_workouts row for this date (intent vs execution).
  const planRow = date ? (await pool.query<{
    type: string;
    distance_mi: number | string;
    workout_spec: any;
    phase: string | null;
    hr_cap: number | null;
    pace_target_s: number | null;
  }>(
    `SELECT pw.type, pw.distance_mi, pw.workout_spec,
            pp.label AS phase,
            COALESCE(
              (pw.workout_spec->>'hr_cap_bpm')::int,
              (pw.workout_spec->>'hr_target_bpm')::int,
              (pw.workout_spec->>'lthr_bpm')::int
            ) AS hr_cap,
            -- A3: read the plan_workouts column first (correct source for
            -- structured workouts); fall back to spec keys for any runner
            -- whose plan was built before the column existed.
            COALESCE(
              pw.pace_target_s_per_mi,
              (pw.workout_spec->>'rep_pace_s_per_mi')::int,
              (pw.workout_spec->>'tempo_pace_s_per_mi')::int,
              (pw.workout_spec->>'pace_target_s_per_mi')::int
            ) AS pace_target_s
       FROM plan_workouts pw
       JOIN training_plans p ON p.id = pw.plan_id
       LEFT JOIN plan_weeks pwk ON pwk.id = pw.week_id
       LEFT JOIN plan_phases pp ON pp.id = pwk.phase_id
      WHERE COALESCE(p.user_uuid::text, p.user_id) = $1
        AND pw.date_iso = $2
        AND p.archived_iso IS NULL
      ORDER BY p.authored_iso DESC LIMIT 1`,
    [userId, date],
  )).rows[0] : null;

  const type = (TYPE_NORMALIZE[(planRow?.type ?? data.workoutType ?? '').toLowerCase()] ?? 'unplanned') as WorkoutType;
  const phase = planRow?.phase ? (PHASE_FROM_LABEL[planRow.phase] ?? null) : null;
  const plannedMi = planRow?.distance_mi ? Number(planRow.distance_mi) : Number(data.distanceMi) || 0;

  // A4 — load per-rep phases from coach_intents for interval/structured
  // runs. Same query as loadPhaseBreakdown in run-state.ts; winIntervals
  // uses these instead of unreliable per-mile splits.
  // Cold-start: returns [] when no watch_completion intent exists (any
  // runner's first run, non-Faff-watch sources, open easy runs).
  let winPhases: Array<{ type?: string | null; verdict?: string | null; actualPaceSPerMi?: number | null; targetPaceSPerMi?: number | null; actualDistanceMi?: number | null }> = [];
  if (date) {
    try {
      const intentRow = (await pool.query(
        `SELECT value FROM coach_intents
          WHERE COALESCE(user_uuid, user_id) = $1
            AND reason = 'watch_completion'
            AND (
              CASE WHEN field LIKE '%-____-__-__'
                   THEN RIGHT(field, 10) = $2
                   ELSE ts::date = $2::date
              END
            )
          ORDER BY ts DESC LIMIT 1`,
        [userId, date],
      )).rows[0];
      if (intentRow?.value) {
        let payload: any = intentRow.value;
        if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { /* leave as-is */ } }
        const phases = Array.isArray(payload?.phases) ? payload.phases : [];
        winPhases = phases.map((p: any) => ({
          type: p.type ?? null,
          verdict: p.verdict ?? null,
          actualPaceSPerMi: Number(p.actualPaceSPerMi) || null,
          targetPaceSPerMi: Number(p.targetPaceSPerMi) || null,
          actualDistanceMi: Number(p.actualDistanceMi) || null,
        }));
      }
    } catch { /* non-fatal: win falls back to per-mile heuristic */ }
  }

  // A5 — when GPS splits are flagged unreliable at ingest, don't feed
  // them into drift/fade heuristics. The flag signals the splits-sum
  // exceeded run duration by >5s (pause events inflated GPS timestamps).
  const splitsReliable = data.splits_unreliable !== true;
  const splitsForRecap = splitsReliable && Array.isArray(data.splits) && (data.splits as any[]).length > 0
    ? data.splits as any[]
    : undefined;

  // E4: numeric pace wins when present; else recover it from the "M:SS"
  // string (watch/HK rows). Single source for both deriveRecap + deriveWin.
  const actualPaceSPerMi = Number(data.paceSPerMi) || parsePaceToSec(data.avgPaceMinPerMi);

  // E3: evaluate a completed run against what it was PRESCRIBED AT THE TIME
  // (the frozen phase target baked into the watch completion), not the live
  // plan_workouts row. A later in-place re-pace must not retroactively flip a
  // missed rep into a hit (Jun 2 reps ran 6:58 vs the prescribed 6:29 = a real
  // miss; the plan was later re-paced to 6:52, against which they'd read "on").
  // The phase panel already judges vs the frozen target (loadPhaseBreakdown);
  // this aligns the recap/win to the same contract. Fall back to the live plan
  // only when no frozen phase exists (non-watch runs, manual entries, cold-start).
  const frozenWorkTargets = winPhases
    .filter((p) => p.type === 'work' && p.targetPaceSPerMi)
    .map((p) => p.targetPaceSPerMi as number);
  const frozenTargetSPerMi = frozenWorkTargets.length > 0 ? modePace(frozenWorkTargets) : null;
  const livePlanTargetSPerMi = planRow?.pace_target_s ?? null;
  const evalPlannedPaceSPerMi = frozenTargetSPerMi ?? livePlanTargetSPerMi;

  // Work-phase pace + distance for tempo recap copy. Both derived from the
  // same work-phase filter so the "4.0 mi @ 7:18" pair is always consistent.
  const workPhases = winPhases.filter((p) => p.type === 'work' && p.actualPaceSPerMi);
  const workPaceSPerMi: number | null = workPhases.length > 0
    ? workPhases.reduce((s, p) => s + (p.actualPaceSPerMi as number), 0) / workPhases.length
    : null;
  const workDistMiRaw = workPhases.reduce((s, p) => s + (p.actualDistanceMi ?? 0), 0);
  const workDistanceMi: number | null = workDistMiRaw > 0 ? workDistMiRaw : null;
  const repCount: number | null = workPhases.length > 0 ? workPhases.length : null;

  // Single weather object · fed to both deriveRecap and deriveWin so the
  // recap verdict, the win line, and the phase bars all judge against the
  // same heat number (no surface shows a different heat % than another).
  const weatherInput = data.weather ? {
    tempF: typeof data.weather.temp_f === 'number' ? data.weather.temp_f : (typeof data.tempF === 'number' ? data.tempF : null),
    tempF_start: typeof data.weather.temp_f_start === 'number' ? data.weather.temp_f_start : null,
    tempF_end: typeof data.weather.temp_f_end === 'number' ? data.weather.temp_f_end : null,
    tempF_peak: typeof data.weather.temp_f_peak === 'number' ? data.weather.temp_f_peak : null,
    humidityPct: typeof data.weather.humidity_pct === 'number' ? data.weather.humidity_pct : null,
    windMph: typeof data.weather.wind_mph === 'number' ? data.weather.wind_mph : null,
    conditions: typeof data.weather.conditions === 'string' ? data.weather.conditions : null,
    cloudCoverPct: typeof data.weather.cloud_cover_pct === 'number' ? data.weather.cloud_cover_pct : null,
    durationS: typeof data.durationSec === 'number' ? data.durationSec : null,
  } : null;

  const recap = deriveRecap({
    type,
    phase,
    plannedMi,
    plannedPaceSPerMi: evalPlannedPaceSPerMi,
    plannedHrCap: planRow?.hr_cap ?? null,
    actualMi: Number(data.distanceMi) || 0,
    actualPaceSPerMi,
    workPaceSPerMi,
    workDistanceMi,
    repCount,
    actualAvgHr: data.avgHr != null ? Number(data.avgHr) : null,
    actualMaxHr: data.maxHr != null ? Number(data.maxHr) : null,
    splits: splitsForRecap,
    weather: weatherInput,
  });

  // E3: light secondary reconciliation note. The verdict above stays anchored
  // to the frozen prescribed target; this only surfaces the current-plan number
  // when an in-place re-pace moved it ≥10 s/mi away, so it isn't a mystery
  // ("why does the plan say 6:52 when this reads against 6:29"). Appended as a
  // muted trailing fact so every recap surface shows it with no renderer change.
  if (
    frozenTargetSPerMi != null &&
    livePlanTargetSPerMi != null &&
    Math.abs(frozenTargetSPerMi - livePlanTargetSPerMi) >= 10
  ) {
    recap.facts = [
      ...recap.facts,
      `Plan now reads ${fmtPaceSlash(livePlanTargetSPerMi)} for this one · it was re-paced after you ran.`,
    ];
  }

  // 2026-06-01 · iPhone brief · synthesized win line.
  // 4-10 word coach-voice sentence summarizing how the run went.
  // Returns null when off-plan / DNF / no usable signal.
  const win = deriveWin({
    type,
    phase,
    plannedMi,
    plannedPaceSPerMi: evalPlannedPaceSPerMi,
    plannedHrCap: planRow?.hr_cap ?? null,
    actualMi: Number(data.distanceMi) || 0,
    actualPaceSPerMi,
    actualAvgHr: data.avgHr != null ? Number(data.avgHr) : null,
    splits: splitsForRecap,
    phases: winPhases.length > 0 ? winPhases : undefined,
    verdict: recap.verdict,
    weather: weatherInput,
    indoor: data.indoor === true,
    source: typeof data.source === 'string' ? data.source : undefined,
  });

  return NextResponse.json({
    ok: true,
    runId: runRow.id,
    date,
    type,
    phase,
    ...recap,
    win,
    // E3: the target the verdict was judged against (frozen prescribed when a
    // watch completion exists, else the live plan) + the current plan target,
    // so consumers/falsifiers can see which contract was used and the divergence.
    prescribed_pace_s_per_mi: frozenTargetSPerMi,
    plan_now_pace_s_per_mi: livePlanTargetSPerMi,
    evaluated_pace_s_per_mi: evalPlannedPaceSPerMi ?? null,
  });
}
