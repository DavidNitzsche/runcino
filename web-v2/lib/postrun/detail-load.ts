/**
 * lib/postrun/detail-load.ts · the reads behind the run-detail-only sections.
 *
 * ── WHY THESE TWO ARE NOT ON THE POST-RUN WIRE ────────────────────────────
 *
 * `wire.ts` says what it is for in its own header: "the brief's §4 Layer 1 and
 * Layer 3 and nothing else" — the answer, and what it meant. The chart stack
 * and the matched workout are Layer 2 and Layer 3's context: things a runner
 * reaches by scrolling into a single run, on one screen, deliberately.
 *
 * `/api/v5/today` carries the post-run wire on every load of the day's card.
 * Hanging eight hundred wrist samples and a six-month candidate scan off that
 * response would put a chart nobody is looking at into the payload of the
 * most-loaded screen in the app. So these compose on `/api/runs/[id]` only,
 * and the Today response is unchanged.
 *
 * ── ONE PHASE LADDER, NOT TWO (Rule 16) ───────────────────────────────────
 *
 * The raw phase elements are read through `resolveStoredPhases`, exported by
 * `load.ts`, which is the same three-rung ladder the experience composer uses
 * and the one SIMROW-1 hardened. Re-deriving "which completion is this run's"
 * here is precisely how this screen would end up describing a different
 * session from the card above it.
 *
 * ── RULE 14 · THE POPULATION ──────────────────────────────────────────────
 *
 * Every read here states its scope: this user by uuid, canonical rows only
 * (`CANONICAL_ROW_SQL`), and — for candidates — a bounded date window. No
 * query in this file joins `plan_workouts` for a candidate run, because the
 * active plan holds no row for a session run before the last re-authoring and
 * reaching across archived versions to find one is Rule 14's own example.
 *
 * ── NO SQL AGGREGATES, AND THAT IS DELIBERATE ─────────────────────────────
 *
 * The candidate query selects rows and reduces them in TypeScript. Not for
 * performance — for honesty: `check-normal-window.sh`'s scanner watches for
 * `AVG(`, `SUM(`, `MAX(` over this runner's own `runs`, because that is the
 * shape of a reader that quietly turns a taper into a habit. Nothing here
 * aggregates his training. It names ONE prior session, which is a different
 * question, argued at the top of `matched.ts`.
 */
import { pool } from '@/lib/db/pool';
import {
  CANONICAL_ROW_SQL,
  runDaySql,
  runDistanceMiSql,
  runElevGainFtSql,
  runIdentityMatchSql,
  runPhasesSql,
  runPlannedWorkoutTypeSql,
  runTempFSql,
  runWorkoutType,
  runWorkoutTypeSql,
  type RunData,
} from '@/lib/runs/run-shape';
import { resolveWorkoutVerdict, type WorkoutVerdict } from '@/lib/execution/verdict';
import { resolveDayExecutions } from '@/lib/execution/day-resolver';
import { displayTypeFor } from '@/lib/faff/v5-today';
import { resolveStoredPhases } from './load';
import { composePostRunAnalysis, type PostRunAnalysis } from './analysis';
import {
  pickMatchedWorkout, MATCH_WINDOW_DAYS,
  type MatchCandidate, type MatchSegment, type MatchResult, type WorkReading,
} from './matched';

export interface PostRunDetailExtras {
  /** PR-8 / PR-9 / PR-10 / PR-11. Null when the run recorded nothing to draw. */
  analysis: PostRunAnalysis | null;
  /** PR-15. Carries its own refusal sentence when there is no honest match. */
  match: MatchResult;
}

interface Row { id: string; data: Record<string, any> }

/**
 * A graded verdict reduced to what `matched.ts` reads.
 *
 * The segments AND the canonical work figures together, because they come from
 * one grading pass and must describe one session. `WorkSummary.paceSPerMi` and
 * `.hrAvg` are the app's owner for "the mean pace and heart rate across the
 * reps"; `matched.ts` receives them rather than recomputing them.
 */
function readOf(v: WorkoutVerdict): { segments: MatchSegment[]; work: WorkReading } {
  return {
    segments: v.phases.map((p) => ({
      kind: p.type,
      paceSecPerMi: p.avgSecPerMi,
      distanceMi: p.actualDistanceMi,
      durationSec: p.actualDurationSec,
      avgHr: p.avgHr,
      targetSecPerMi: p.targetSecPerMi,
      isStride: p.isStrideSegment,
    })),
    work: { paceSecPerMi: v.work.paceSPerMi, hrBpm: v.work.hrAvg },
  };
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Weeks from a date to the runner's next goal race after it.
 *
 * The block-position key from Q44. NULL when no goal race is known for that
 * date, and null is neutral in the ranking rather than a penalty — a runner
 * with no race on the calendar simply ranks on the other four keys.
 */
function weeksToRaceAt(dateISO: string, raceDates: string[]): number | null {
  const t = Date.parse(`${dateISO}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  let best: number | null = null;
  for (const r of raceDates) {
    const rt = Date.parse(`${r}T00:00:00Z`);
    if (!Number.isFinite(rt) || rt < t) continue;
    const w = (rt - t) / (7 * 86_400_000);
    if (best == null || w < best) best = w;
  }
  return best == null ? null : Math.round(best);
}

export async function loadPostRunDetailExtras(
  userId: string,
  runIdRef: string,
): Promise<PostRunDetailExtras | null> {
  const runRes = await pool.query<Row>(
    `SELECT id::text AS id, data
       FROM runs
      WHERE user_uuid = $1
        AND ${CANONICAL_ROW_SQL}
        AND ${runIdentityMatchSql('$2')}
      LIMIT 1`,
    [userId, runIdRef],
  );
  const row = runRes.rows[0];
  if (!row) return null;

  const data = row.data ?? {};
  const dateISO = String(data.date ?? String(data.startLocal ?? '').slice(0, 10));

  /* EXECUTION-IDENTITY-1 (2026-09-03) · this run only inherits the day's
   * prescription (type, spec, sub-label) when THE CANONICAL RESOLVER
   * confirms this specific run is what satisfies it — never merely because
   * some plan_workouts row exists for its date, which is what the prior
   * `WHERE pw.date_iso = $2 ... LIMIT 1` query did regardless of which run
   * was actually being analysed. This page is reached by run id directly —
   * from the log, from a supplemental run's own secondary card — so a
   * friend's unrelated easy run opened on a day the plan asked for hill
   * intervals would have been rep-graded as the interval session. Same
   * defect class WORKOUT-EXECUTION-ID-1 fixed on Today/Watch/Recap, on the
   * one remaining surface: post-run analysis.
   *
   * No match → `planRow` stays null and `currentType` falls through to
   * `null`, never to `data.workoutType` — that field can carry a PASSIVE
   * sync's date+distance guess (`workoutTypeSource !== 'plan'`-gated
   * evidence is exactly what the resolver's LEGACY tier already refuses to
   * trust without a live-tracked source), and this file must not re-open
   * the door the resolver closes. An ungraded, honestly-labelled analysis is
   * correct for a run that was never shown to execute anything prescribed. */
  const resolvedDay = await resolveDayExecutions(userId, dateISO).catch((err: unknown) => {
    console.warn('[postrun/detail-load] day resolver unreadable:',
      err instanceof Error ? err.message : err);
    return null;
  });
  const matchedPrescription = resolvedDay?.prescriptions.find(
    (p) => p.matchedRun?.runId === row.id,
  ) ?? null;
  let planRow: { type: string | null; sub_label: string | null; workout_spec: Record<string, unknown> | null } | null = null;
  if (matchedPrescription) {
    const specRes = await pool.query<{ workout_spec: Record<string, unknown> | null }>(
      `SELECT workout_spec FROM plan_workouts WHERE id = $1`,
      [matchedPrescription.id],
    );
    planRow = {
      type: matchedPrescription.type,
      sub_label: matchedPrescription.subLabel,
      workout_spec: specRes.rows[0]?.workout_spec ?? null,
    };
  }

  const rawPhases = await resolveStoredPhases(userId, dateISO, data);
  const currentType = planRow?.type ?? null;
  const verdict = resolveWorkoutVerdict({
    type: currentType,
    spec: (planRow?.workout_spec ?? null) as never,
    phases: rawPhases,
  });

  const analysis = composePostRunAnalysis({
    rawPhases,
    gradedPhases: verdict.phases,
    rawSplits: data.splits,
    totalDistanceMi: num(data.distanceMi),
  });

  /* ── the goal races, for the block-position key ────────────────────────── */
  /* `races` stores the date inside `meta`, not as a column — see
   * `lib/race/auto-result.ts`, which is the shape every other reader uses. */
  const raceRes = await pool.query<{ d: string }>(
    `SELECT meta->>'date' AS d
       FROM races
      WHERE user_uuid = $1::uuid AND meta->>'date' IS NOT NULL`,
    [userId],
  );
  const raceDates = raceRes.rows.map((r) => r.d).filter((d): d is string => !!d);

  /* ── the candidates ───────────────────────────────────────────────────────
   *
   * Bounded by date and by the presence of a phase array with real structure.
   * `jsonb_array_length(...) >= 3` is a cheap structural pre-filter and not a
   * judgement: a segmented session is a warm-up, at least two reps and
   * something after them, so nothing with fewer than three elements can pass
   * `matched.ts`'s two-work-segment gate anyway. Filtering it in SQL keeps a
   * six-month scan from detoasting a hundred single-phase easy runs.
   *
   * `hrSamples` and `paceSamples` are STRIPPED in the query. A candidate is
   * read for its phase averages only, and the raw rows carry roughly eight
   * hundred samples each — pulling them for twenty candidates would move
   * megabytes to compute a handful of medians. */
  /* UNALIASED, because `CANONICAL_ROW_SQL` is unaliased by design — its own
   * doc comment says so ("both call sites query `runs` unaliased"). Rewriting
   * the shared predicate to fit a local alias is how a shared predicate stops
   * being shared. */
  const candRes = await pool.query<{
    id: string;
    d: string;
    phases: unknown;
    distance_mi: string | null;
    elev_gain_ft: string | null;
    temp_f: string | null;
    workout_type: string | null;
    planned_workout_type: string | null;
  }>(
    `SELECT id::text AS id,
            ${runDaySql()} AS d,
            (SELECT jsonb_agg(e - 'hrSamples' - 'paceSamples')
               FROM jsonb_array_elements(${runPhasesSql()}) e) AS phases,
            ${runDistanceMiSql()}          AS distance_mi,
            ${runElevGainFtSql()}          AS elev_gain_ft,
            ${runTempFSql()}               AS temp_f,
            ${runWorkoutTypeSql()}         AS workout_type,
            ${runPlannedWorkoutTypeSql()}  AS planned_workout_type
       FROM runs
      WHERE user_uuid = $1
        AND ${CANONICAL_ROW_SQL}
        AND ${runDaySql()} < $2
        AND ${runDaySql()} >= $3
        AND jsonb_typeof(${runPhasesSql()}) = 'array'
        AND jsonb_array_length(${runPhasesSql()}) >= 3
      ORDER BY ${runDaySql()} DESC
      LIMIT 60`,
    [
      userId,
      dateISO,
      new Date(Date.parse(`${dateISO}T00:00:00Z`) - MATCH_WINDOW_DAYS * 86_400_000)
        .toISOString().slice(0, 10),
    ],
  );

  const candidates: MatchCandidate[] = candRes.rows.map((r) => {
    /* WHICH FAMILY THIS CANDIDATE BELONGS TO, in one taxonomy.
     *
     * `plannedWorkoutType` carries faff semantics and nothing else, so it can
     * be read as-is. `workoutType` cannot: it flattens two eras into one
     * column, and a Strava row arrives as the CODE `'1'`. Reading it raw is
     * how `displayTypeFor` would have been handed a number to name a session
     * with. `runWorkoutType` is the one place that knows both eras, so the
     * fallback goes through it and a code that names no family stays null —
     * which makes the basis sentence say "of the same structure" rather than
     * invent a name. */
    const t: string | null =
      r.planned_workout_type || runWorkoutType({ workoutType: r.workout_type } as RunData).semantic;
    const read = readOf(resolveWorkoutVerdict({
      type: t,
      /* NO SPEC. A candidate gets no `plan_workouts` row on purpose — see the
       * Rule 14 note in the header — so the grader falls back to the phase
       * types and to the targets frozen on the phases themselves, which is
       * what the session actually recorded. */
      spec: null as never,
      phases: Array.isArray(r.phases) ? r.phases : [],
    }));
    return {
      runId: r.id,
      dateISO: r.d,
      segments: read.segments,
      work: read.work,
      totalDistanceMi: num(r.distance_mi),
      elevGainFt: num(r.elev_gain_ft),
      tempF: num(r.temp_f),
      weeksToRace: weeksToRaceAt(r.d, raceDates),
      /* A CANDIDATE NAMES ITS FAMILY ONLY IF ITS OWN ROW DOES. `displayTypeFor`
       * is the app's one enum-to-name table; a null here means the basis
       * sentence says "of the same structure" instead of naming a family, and
       * that is the honest version rather than a guessed one. */
      sessionTypeDisplay: t ? displayTypeFor(t, null) : null,
    };
  });

  const currentRead = readOf(verdict);
  const current: MatchCandidate = {
    runId: row.id,
    dateISO,
    segments: currentRead.segments,
    work: currentRead.work,
    totalDistanceMi: num(data.distanceMi),
    elevGainFt: num(data.elevGainFt),
    tempF: num(data.tempF),
    weeksToRace: weeksToRaceAt(dateISO, raceDates),
    sessionTypeDisplay: currentType ? displayTypeFor(currentType, planRow?.sub_label ?? null) : null,
  };

  return { analysis, match: pickMatchedWorkout(current, candidates) };
}
