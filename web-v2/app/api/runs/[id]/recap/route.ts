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
import { loadHeatEasingPct } from '@/lib/watch/heat';
import { deriveWin } from '@/lib/coach/run-win';
import { composeRecap } from '@/lib/faff/recap-voice';
import { mapWatchPhases } from '@/lib/coach/run-state';
import { deriveReadingScopes } from '@/lib/coach/reading-scope';
import { resolveRunTerrain } from '@/lib/terrain/run-terrain';
import { reconcileRun, runCadenceSpm } from '@/lib/runs/coherence';
import { rowOrNull } from '@/lib/db/read';
import { runAvgHr, runMaxHr, runElevGainFt, type RunData } from '@/lib/runs/run-shape';
import { loadRunTwins, resolveElevationGain } from '@/lib/runs/twins';
import type { Phase, WorkoutType } from '@/lib/coach/run-purpose';

export const dynamic = 'force-dynamic';

const PHASE_FROM_LABEL: Record<string, Phase> = {
  BASE: 'BASE', base: 'BASE',
  BUILD: 'BUILD', build: 'BUILD',
  PEAK: 'PEAK', peak: 'PEAK',
  TAPER: 'TAPER', taper: 'TAPER',
  RECOVERY: 'RECOVERY', recovery: 'RECOVERY',
};

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
      LIMIT 1`,
    [userId, String(id)],
  )).rows[0];

  if (!runRow) {
    return NextResponse.json({ error: 'run not found' }, { status: 404 });
  }

  const data = runRow.data ?? {};
  const date = (data.date as string) ?? String(data.startLocal ?? '').slice(0, 10);

  /* The absorbed twins, and the climb ranked by instrument across them. See
   * `lib/runs/twins.ts`. A failed read refuses rather than letting the
   * canonical row's weaker instrument win by default. */
  const elevTwins = await loadRunTwins(runRow.id);
  const elevationReading = resolveElevationGain({
    elevGainFt: runElevGainFt(data as RunData),
    elevGainSource: typeof data.elevGainSource === 'string' ? data.elevGainSource : null,
    source: typeof data.source === 'string' ? data.source : null,
    splits: null,
    distanceMi: null,
  }, elevTwins);

  /* ── E4 (2026-08-24 · rewritten, then finished) ────────────────────────────
   *
   * THE RECAP IS THE SENTENCE THE RUNNER ACTUALLY READS, and it was the last
   * surface assembling its own facts inline.
   *
   * The pace line used to read `Number(data.paceSPerMi) || parsePaceToSec(...)`
   * and on 2026-08-23 that made this route say: "Easy 11.0 mi at 3:37/mi. A
   * touch quicker than the 9:22/mi easy target." The row stored `paceSPerMi`
   * 217 beside a `durationSec` of 5298 for 11.01 miles — 8:01/mi — because the
   * merge absorbed Strava's moving time onto the watch's row without its
   * matching clock. Preferring the NUMBER also disagreed with
   * `lib/coach/log-state.ts`, which preferred the STRING, so the same run
   * printed two paces on two screens even when nothing was corrupt.
   *
   * That fix went in through `coherentPace` / `coherentElapsedSec`. What it
   * left behind was three separate reconciliations of one row plus a set of
   * raw reads beside them — `Number(data.distanceMi)`, `data.durationSec` into
   * the weather window, `data.avgHr`, `data.elevGainFt` — each of which is a
   * place this row can go back to answering one question two ways.
   *
   * ONE reconciliation now, and every fact below comes off it. `reconcileRun`
   * is the same decision point `runFacts`, `coherentPace` and
   * `coherentDurationSec` are all façades over, so the recap cannot drift from
   * the poster, the log or run detail: they are reading the same object.
   *
   * MEASURED, so the claim is not bigger than the change (256 canonical rows,
   * 2026-08-24, `faff_readonly`): the reconciled elapsed clock equals the raw
   * `durationSec` on 256 of 256, and the reconciled distance equals the raw
   * `distanceMi` on 256 of 256. Today this migration changes NO number on any
   * screen. It removes the four places where the next merge could. */
  const runc = reconcileRun(data as RunData);

  const actualPaceSPerMi = runc.paceSecPerMi;
  const actualElapsedSec = runc.elapsedSec;
  // `?? 0` is kept from the read this replaces, deliberately and not by
  // inertia: `deriveRecap` and `deriveWin` both take `actualMi: number`, and
  // widening that signature to nullable is a change to the recap ENGINE with
  // its own blast radius, not to this route's reads. Worth knowing that the
  // two are not the same claim — 0 says "ran nothing", null would say "we do
  // not know how far this was" — but no canonical row in production reaches
  // it: all 256 carry a distance the reconciler accepts.
  const actualMi = runc.distanceMi ?? 0;
  const actualAvgHr = runAvgHr(data as RunData);
  const actualMaxHr = runMaxHr(data as RunData);

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
  // No plan row for this date · the run itself is the only intent there is,
  // and it is read through the reconciler like every other fact here.
  const plannedMi = planRow?.distance_mi ? Number(planRow.distance_mi) : actualMi;

  // A4 — load per-rep phases from coach_intents for interval/structured
  // runs. Same query as loadPhaseBreakdown in run-state.ts; winIntervals
  // uses these instead of unreliable per-mile splits.
  // Cold-start: returns [] when no watch_completion intent exists (any
  // runner's first run, non-Faff-watch sources, open easy runs).
  let winPhases: Array<{ type?: string | null; verdict?: string | null; actualPaceSPerMi?: number | null; targetPaceSPerMi?: number | null; actualDistanceMi?: number | null; isFinishSegment?: boolean; actualSpeedMph?: number | null; actualInclinePct?: number | null; completed?: boolean | null }> = [];
  if (date) {
    try {
      const intentRow = (await pool.query(
        `SELECT value FROM coach_intents
          WHERE COALESCE(user_uuid, user_id) = $1
            AND reason = 'watch_completion'
            AND (
              -- 2026-08-11 · see lib/coach/run-state.ts loadPhaseBreakdown
              -- for the full note · field's optional #HHmm suffix (P1-34)
              -- broke the old suffix check, silently falling to the
              -- UTC-shifted ts::date fallback for every modern completion.
              CASE WHEN field ~ '-[0-9]{4}-[0-9]{2}-[0-9]{2}(#[0-9]+)?$'
                   THEN field ~ ('-' || $2::text || '(#[0-9]+)?$')
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
          isFinishSegment: p.isFinishSegment === true,
          // BELT-WIN-1 · the treadmill console's own readings, carried so
          // `winTreadmill` has something to read. `completed` keeps its
          // three states — a phase that never said is not a phase that
          // said no, and the composer's `!== false` test depends on that.
          actualSpeedMph: Number(p.actualSpeedMph) || null,
          actualInclinePct: typeof p.actualInclinePct === 'number' ? p.actualInclinePct : null,
          completed: typeof p.completed === 'boolean' ? p.completed : null,
        }));
      }
    } catch { /* non-fatal: win falls back to per-mile heuristic */ }
  }

  /* SPLITS · deliberately NOT gated on `runc.splitsCoverRun`.
   *
   * 35 of the 256 canonical rows carry a splits array whose distances sum more
   * than a quarter mile away from the run's own distance, and the reconciler
   * correctly reports those as not decomposing the run. But `deriveRecap` uses
   * splits for exactly two things — `detectHrDrift` and `detectPaceFade` — and
   * both read a TREND across the sequence. Neither sums the array. Refusing
   * the sequence because its total drifts would delete a valid first-half /
   * second-half read from one run in seven to protect an arithmetic nobody is
   * doing.
   *
   * Two of the 35 are a different matter: a 0.84-mile row carrying four
   * splits, and a 1.34-mile row carrying five, both totalling three to four
   * miles. Those arrays describe some other run, and a fade read across them
   * is meaningless. Separating those from an ordinary 5% GPS drift needs a
   * PROPORTIONAL bound, and `MAX_SPLIT_SUM_DRIFT_MI` is a flat quarter mile —
   * 5% of an 18-mile run and 209% of a 1.34-mile one. Picking that ratio is a
   * threshold decision with two defensible answers, so it is reported rather
   * than chosen here. See the session report. */
  //
  // A5 — when GPS splits are flagged unreliable at ingest, don't feed
  // them into drift/fade heuristics. The flag signals the splits-sum
  // exceeded run duration by >5s (pause events inflated GPS timestamps).
  const splitsReliable = data.splits_unreliable !== true;
  const splitsForRecap = splitsReliable && Array.isArray(data.splits) && (data.splits as any[]).length > 0
    ? data.splits as any[]
    : undefined;

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

  // 2026-08-24 · heat · the frozen target came off the watch payload, and that
  // payload now eases its targets for the day's real conditions before the
  // runner ever sees them (lib/watch/heat.ts). So when a run was built on a
  // hot day, `frozenTargetSPerMi` ALREADY carries the Research/06 correction
  // and the recap must not apply its own on top — that is the double-pricing
  // David named in decision 3, and it would let a hot run read better than the
  // identical effort in the cold. Only true when the target actually came from
  // the frozen phases; a live-plan fallback was never eased.
  //
  // FAILS CLOSED. `loadHeatEasingPct` returns null when the read itself
  // failed, which is NOT the same as "nothing was eased" — and collapsing the
  // two would let a lost connection reintroduce the double-pricing through
  // the error path. Unknown is therefore treated as eased: on a cool day the
  // correction is ~0 so it costs nothing, and on a hot day it grades slightly
  // harder rather than flattering the run.
  const heatEasedPct = frozenTargetSPerMi != null && date
    ? await loadHeatEasingPct(userId, date)
    : 0;
  const targetAlreadyHeatEased = heatEasedPct == null || heatEasedPct > 0;

  // Work-phase pace + distance for tempo recap copy. Both derived from the
  // same work-phase filter so the "4.0 mi @ 7:18" pair is always consistent.
  const workPhases = winPhases.filter((p) => p.type === 'work' && p.actualPaceSPerMi);
  const workDistMiRaw = workPhases.reduce((s, p) => s + (p.actualDistanceMi ?? 0), 0);
  const workDistanceMi: number | null = workDistMiRaw > 0 ? workDistMiRaw : null;
  // AUDIT #33 · DISTANCE-WEIGHTED work pace = total work time / total work
  // distance. The old unweighted mean of rep paces over-/under-weighted short
  // reps (1mi@6:00 + 0.5mi@7:00 → mean 6:30 but true avg 6:20) and disagreed
  // with the workDistanceMi printed beside it. For equal-length reps the
  // weighted value EQUALS the mean, so this is a no-op on the standard set.
  // Weight only phases that carry a real distance; fall back to the unweighted
  // mean when none do (so we never lose a value we previously had).
  const weightablePhases = workPhases.filter((p) => (p.actualDistanceMi ?? 0) > 0);
  const workPaceSPerMi: number | null = (() => {
    if (workPhases.length === 0) return null;
    if (weightablePhases.length > 0) {
      const totalDist = weightablePhases.reduce((s, p) => s + (p.actualDistanceMi as number), 0);
      const totalTime = weightablePhases.reduce(
        (s, p) => s + (p.actualPaceSPerMi as number) * (p.actualDistanceMi as number), 0);
      return totalDist > 0 ? totalTime / totalDist : null;
    }
    // No phase carries a distance — keep the legacy unweighted mean.
    return workPhases.reduce((s, p) => s + (p.actualPaceSPerMi as number), 0) / workPhases.length;
  })();
  const repCount: number | null = workPhases.length > 0 ? workPhases.length : null;
  // Per-rep actual paces (in rep order) for the interval pacing-pattern read.
  const repPaces: number[] = workPhases
    .map((p) => p.actualPaceSPerMi as number)
    .filter((p) => typeof p === 'number' && p > 0);
  // Prescribed rep count · lets the recap say "did 3 of 4" when reps were
  // missed or the session stopped early, instead of treating the reps run
  // as the whole workout.
  const prescribedRepCount: number | null =
    Number((planRow?.workout_spec as any)?.rep_count) || null;

  // Finish-segment spec fields for the long-run structured recap copy.
  // finish_mi / finish_pace_s_per_mi / finish_label live in workout_spec
  // for long runs that carry an HM/M finish segment. Actual finish pace
  // prefers the isFinishSegment phase from the watch completion; falls back
  // to the spec target when no watch phases are present (Strava / cold-start).
  const finishMiSpec = type === 'long' ? (Number((planRow?.workout_spec as any)?.finish_mi) || null) : null;
  const finishPaceSpec = type === 'long' ? (Number((planRow?.workout_spec as any)?.finish_pace_s_per_mi) || null) : null;
  const finishLabelRaw = type === 'long' ? (String((planRow?.workout_spec as any)?.finish_label ?? '').trim() || null) : null;
  const finishPhase = winPhases.find((p) => p.isFinishSegment === true && p.actualPaceSPerMi != null);
  const finishPaceSPerMi = finishPhase?.actualPaceSPerMi ?? finishPaceSpec;

  /* THE RACE BEHIND THIS RUN, for the recap's per-finding race-recency filter.
   *
   * CLAUDE.md, per-finding context filters: a surface that aggregates N
   * findings runs N filter applications. The recap engine had no race-recency
   * input at all, so the day after a marathon an easy run whose heart rate sat
   * above its cap read "Slow it down next time · easy days only work when
   * they're actually easy" — a true observation with a wrong instruction and a
   * scold attached, on the screen the runner opens in the week he most needs
   * the app to be right about why his heart rate is high.
   *
   * `rowOrNull`, so the read's three states stay three. A row means a race,
   * `undefined` means the runner has none, and `null` means the read FAILED —
   * and all three leave the filter off, because a race nobody could look up is
   * not a race the copy may lean on. What the helper buys is that the failure
   * is logged instead of arriving as an answer, which is the whole argument of
   * `lib/audit/swallow-scan.ts`: the same `.catch(() => ({ rows: [] }))` shape
   * hid four broken date comparisons for months.
   *
   * The window itself is `expectedDaysForAnchor('race', distance)` inside the
   * engine — the same distance-keyed band `lib/coach/recovery-phase.ts` reads
   * out of Research/00b, not a second number. */
  const lastRace = date ? await rowOrNull<{ date: string; distance_mi: string | null }>(
    'runs/recap · the race behind this run',
    pool.query(
      `SELECT meta->>'date' AS date, meta->>'distanceMi' AS distance_mi
         FROM races
        WHERE user_uuid::text = $1 AND meta->>'priority' IN ('A', 'B')
          AND meta->>'date' IS NOT NULL AND (meta->>'date')::date < $2::date
        ORDER BY (meta->>'date')::date DESC LIMIT 1`,
      [userId, date],
    ),
  ) : null;
  const daysSinceRace = lastRace?.date
    ? Math.max(0, Math.round(
        (Date.parse(date + 'T12:00:00Z') - Date.parse(lastRace.date + 'T12:00:00Z')) / 86400000))
    : null;

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
    // The reconciled wall clock, not a fourth raw read of `durationSec`.
    // This decides which hour's temperature the run is judged against.
    durationS: actualElapsedSec,
  } : null;

  // 2026-08-17 · adaptive voice band for recap framing. Best-effort ·
  // null on failure and null renders as 'guided' (the default band, whose
  // copy is byte-identical to the pre-band output).
  const voiceBand = await import('@/lib/coach/voice-band')
    .then((m) => m.loadVoiceBandLite(userId))
    .catch(() => null);

  // 2026-08-17 · terrain. Resolved from the stored row once and handed to the
  // recap, which judges pace-vs-target through it and prints the real pace
  // beside it. `splits_unreliable` rows still resolve here: the flag is about
  // pause-inflated split TIMES, and the elevation deltas on those same splits
  // are unaffected — and the rolled-up gain is the fallback either way.
  const terrain = resolveRunTerrain({
    source: typeof data.source === 'string' ? data.source : null,
    indoor: data.indoor === true,
    distanceMi: runc.distanceMi,
    durationSec: actualElapsedSec,
    paceSPerMi: actualPaceSPerMi,
    /* ── THE CLIMB · ONE READER, 2026-08-24 ───────────────────────────────
     *
     * `runElevGainFt(data)` read the canonical row alone, which made this the
     * FOURTH reader of one number: the log took the row raw, run detail ran
     * its own 250 ft/mi heuristic, the poster asked `pickElevationGain`, and
     * this asked the accessor. On 2026-08-23 they answered 3195 / 57 / 57 for
     * one eleven-mile run.
     *
     * The recap's use is not cosmetic — terrain feeds the grade-adjusted pace
     * the coach judges the run against, so an invented 3195 ft becomes an
     * invented verdict about how hard the runner worked. `null` when nothing
     * trustworthy survives simply drops the terrain adjustment, which is the
     * refusal this path should already have had. */
    elevGainFt: elevationReading?.ft ?? null,
    elevGainSource: elevationReading?.source ?? null,
    startLatLng: data.startLatLng,
    endLatLng: data.endLatLng,
    splits: Array.isArray(data.splits) ? data.splits : undefined,
    phases: Array.isArray(data.phases) ? data.phases : undefined,
  });

  // 2026-08-24 · WHICH AVERAGES THIS RECAP MAY QUOTE.
  //
  // `mapWatchPhases` rather than `data.phases` straight: the stored payload is
  // the watch's camelCase shape and the scoping rule reads the mapped one.
  // Going through the same mapper the run-detail wire uses is what stops the
  // recap and the screen from disagreeing about the same session — two
  // readers of one blob with two field-name conventions is exactly the bug
  // class this repo keeps re-finding.
  const readings = deriveReadingScopes({
    phases: mapWatchPhases(Array.isArray(data.phases) ? data.phases : []),
    wholeHrBpm: actualAvgHr,
    // BOTH FEET · `cadence.units-split`. The raw key is a per-leg count on the
    // pre-May-2026 Strava imports and the recap read it as a step rate.
    wholeCadenceSpm: runCadenceSpm(data)?.spm ?? null,
  });

  const recap = deriveRecap({
    type,
    phase,
    plannedMi,
    plannedPaceSPerMi: evalPlannedPaceSPerMi,
    targetAlreadyHeatEased,
    plannedHrCap: planRow?.hr_cap ?? null,
    actualMi,
    actualPaceSPerMi,
    // Real elapsed time where the row carries one · the recap otherwise derives
    // it from distance × pace. Drives the Research/18 fuelling-relevance gate.
    actualDurationSec: actualElapsedSec,
    workPaceSPerMi,
    workDistanceMi,
    repCount,
    repPaces,
    prescribedRepCount,
    finishMi: finishMiSpec,
    finishPaceSPerMi,
    finishLabel: finishLabelRaw,
    actualAvgHr,
    actualMaxHr,
    readings,
    splits: splitsForRecap,
    weather: weatherInput,
    // 2026-06-09 Phase 2 (3.2) · taken bail leads the recap (bail ≠ fail).
    ruleOutcomes: Array.isArray(data.ruleOutcomes) ? data.ruleOutcomes : null,
    terrain,
    voiceBand,
    // Per-finding race-recency filter · see RecapInput.daysSinceRace.
    daysSinceRace,
    raceDistanceMi: lastRace?.distance_mi != null ? Number(lastRace.distance_mi) : null,
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
    actualMi,
    actualPaceSPerMi,
    actualAvgHr,
    splits: splitsForRecap,
    phases: winPhases.length > 0 ? winPhases : undefined,
    verdict: recap.verdict,
    weather: weatherInput,
    indoor: data.indoor === true,
    source: typeof data.source === 'string' ? data.source : undefined,
  });

  // SAID ONCE. `deriveRecap` returns four parts and `deriveWin` a fifth,
  // each composed without sight of the others — this is the exact route
  // David was reading on his own easy four miles (recap-voice.ts's own
  // docstring): "Steady the whole way / Easy done. / Easy 4 mi at 8:34/mi.
  // Run by feel · the right way to take an easy day. / 88°F · hot for
  // running. Warm enough to cost a little pace. Heat does that · your
  // fitness is fine." One judgement, three times; one condition, three
  // times. `composeRecap` was written to fix exactly this and had been
  // wired into the Today after-run sheet (`v5/today/route.ts`) since — this
  // route, which is what `RunDetailV5` (run history) actually reads, was
  // still shipping the five raw, unmerged parts. Same reshape as `today`'s:
  // the composed paragraph rides in `verdict`, `facts` carries only what
  // didn't fit, `conditions_note`/`coach_tip` are folded in already spoken.
  const spoken = composeRecap({
    win,
    verdict: recap.verdict,
    facts: recap.facts,
    conditionsNote: recap.conditions_note,
    coachTip: recap.coach_tip,
  });

  return NextResponse.json({
    ok: true,
    runId: runRow.id,
    date,
    type,
    phase,
    ...recap,
    verdict: spoken.body[0] ?? '',
    facts: spoken.body.slice(1),
    conditions_note: null,
    coach_tip: null,
    win: spoken.headline,
    // E3: the target the verdict was judged against (frozen prescribed when a
    // watch completion exists, else the live plan) + the current plan target,
    // so consumers/falsifiers can see which contract was used and the divergence.
    prescribed_pace_s_per_mi: frozenTargetSPerMi,
    plan_now_pace_s_per_mi: livePlanTargetSPerMi,
    evaluated_pace_s_per_mi: evalPlannedPaceSPerMi ?? null,
  });
}
