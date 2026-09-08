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
import { composeRecap } from '@/lib/faff/recap-voice';
import { resolveCanonicalRunRowId } from '@/lib/runs/canonical-ref';
import { loadPostRunExperience, resolveStoredPhases } from '@/lib/postrun/load';
import { recapPhaseReadings } from '@/lib/coach/recap-phase-readings';
import { postRunWire, type PostRunWire } from '@/lib/postrun/wire';
import { mapWatchPhases } from '@/lib/coach/run-state';
import { resolveWorkoutVerdict } from '@/lib/execution/verdict';
import { classifySession } from '@/lib/training/execution-semantics';
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

  /* Load the canonical run.
   *
   * 2026-09-02 · this comment said "canonical" and the query did not. It
   * matched on identity alone, and 43% of the reference runner's rows are
   * merge losers whose ids collide with no canonical row — so every absorbed
   * Strava id landed here on the DISCARDED half of the merge, and then
   * `loadRunTwins(runRow.id)` below asked a loser for its twins and got none,
   * degrading the ranked-instrument elevation read as well. Rule 19's
   * corollary, exactly: a header comment asserting an invariant is not
   * enforcement. `resolveCanonicalRunRowId` is the one place that answers
   * "which row does this id mean", and IDENTITY-1 in
   * lib/runs/_absorption_predicate.test.ts is what now catches the next copy. */
  const ref = await resolveCanonicalRunRowId(userId, String(id));
  const runRow = ref.ok ? (await pool.query<{
    id: string;
    data: Record<string, any>;
  }>(
    `SELECT id::text AS id, data
       FROM runs
      WHERE user_uuid = $1 AND id::text = $2
      LIMIT 1`,
    [userId, ref.rowId],
  )).rows[0] : undefined;

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
    lthr_bpm: number | null;
    pace_target_s: number | null;
  }>(
    `SELECT pw.type, pw.distance_mi, pw.workout_spec,
            pp.label AS phase,
            COALESCE(
              (pw.workout_spec->>'hr_cap_bpm')::int,
              (pw.workout_spec->>'hr_target_bpm')::int,
              (pw.workout_spec->>'lthr_bpm')::int
            ) AS hr_cap,
            -- C-3 · the THRESHOLD anchor on its own, NOT through the cap's
            -- COALESCE ladder. threshold-band.ts multiplies its argument by
            -- 1.02/1.00 to find the Friel 5a seam, so the argument must be the
            -- LTHR; on a tempo row the ladder above returns hr_target_bpm,
            -- which is a hover target well under LT, and the band it produced
            -- called a 160 bpm tempo run past threshold.
            (pw.workout_spec->>'lthr_bpm')::int AS lthr_bpm,
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

  // THE PRESCRIBED PACE WINDOW, off the spec rather than the single target
  // column: `pace_target_s_per_mi` is one number and a window is two. Both
  // ends or nothing — half a window counts nothing honestly.
  const plannedPaceBand: { lo: number; hi: number } | null = (() => {
    const spec = planRow?.workout_spec as Record<string, unknown> | null | undefined;
    if (!spec) return null;
    const lo = Number(spec.pace_target_s_per_mi_lo);
    const hi = Number(spec.pace_target_s_per_mi_hi);
    return lo > 0 && hi >= lo ? { lo, hi } : null;
  })();

  const type = (TYPE_NORMALIZE[(planRow?.type ?? data.workoutType ?? '').toLowerCase()] ?? 'unplanned') as WorkoutType;
  const phase = planRow?.phase ? (PHASE_FROM_LABEL[planRow.phase] ?? null) : null;
  // No plan row for this date · the run itself is the only intent there is,
  // and it is read through the reconciler like every other fact here.
  const plannedMi = planRow?.distance_mi ? Number(planRow.distance_mi) : actualMi;

  /* ── WHICH COMPLETION IS *THIS RUN'S* (SIMROW-1 · RECAP, 2026-09-08) ──────
   *
   * A4 — the per-rep phases the recap sentences are built from. This block
   * used to run its own `coach_intents` query: the runner, the reason, and the
   * DAY, `ORDER BY ts DESC LIMIT 1`, wrapped in a swallowing try/catch. It was
   * never joined to `runRow.id` — the run this route was asked about, resolved
   * through `resolveCanonicalRunRowId` sixty lines above — so on any day
   * carrying more than one completion payload it built the recap from
   * whichever was written last. It was the ONLY unmodified copy of the defect
   * left: no `watchCompletionRef` branch and, unlike `loadPhaseBreakdown`, not
   * even the `sim-%` bound.
   *
   * Confirmed against the owner's own rows, read straight out of production —
   * not theorised. Three days resolve to a stranger, and the recap is a
   * different, worse reading than the Today card's on each:
   *
   *   2026-09-02  his 6.41 mi easy + 6 strides, 7 work phases, 5.33 work mi
   *               at 8:26/mi, frozen target 401 s/mi. The route took
   *               `sim-recovery-live#1038` — a SIMULATOR payload, 47 minutes
   *               later — whose single work phase is 31 s / 0.09 mi. So
   *               `repCount` 1 for 7, `workDistanceMi` 0.09 for 5.33,
   *               `workPaceSPerMi` 5:44 for 8:26, and `frozenTargetSPerMi`
   *               391 for 401 — which is `evalPlannedPaceSPerMi`, the target
   *               the WHOLE verdict is judged against and which this route
   *               returns on the wire as `prescribed_pace_s_per_mi`.
   *   2026-09-03  a 4.48 mi 12:25 watch run with no completion of its own
   *               BORROWED the 21-phase interval session recorded at 17:25
   *               that evening. Five hours and a different workout.
   *   2026-06-01  his 4.9 mi session took a `trd_` treadmill payload of his
   *               own — one 0-mile phase, no frozen target at all.
   *
   * The 2026-09-03 case is the one worth naming twice, and it is NOT closed by
   * this change. Nothing matches that run — its `client_workout_id` names no
   * intent and it carries no phases — so the honest answer is that there are
   * none. `resolveStoredPhases`' third rung is a LEGACY date match for rows
   * written before `watchCompletionRef` existed, bounded only against `sim-%`,
   * and the evening treadmill payload is not `sim-`-prefixed. It still wins.
   * Fixing that is one clause in the OWNER (rung 3 does not run when the run
   * named a ref) and it moves `/api/v5/today`, run detail and the post-run
   * experience too, so it belongs to whoever owns that resolver rather than
   * here. Exactly one of the account's 160 canonical runs is affected. It is
   * pinned, with the evidence, in `_recap_phase_row_identity.test.ts`'s
   * "known gap" block, which fails the day it is fixed.
   *
   * Rule 14: filtering on the runner and the day is not filtering on the right
   * ROWS. Rule 16: `lib/postrun/load.ts#resolveStoredPhases` already owns
   * "which stored phase array belongs to this run" — run detail, the post-run
   * experience and `/api/v5/today` all read it — so this calls it rather than
   * keeping another answer. Its three rungs, most specific first: the intent
   * this run NAMES via `watchCompletionRef`; the run row's OWN `data.phases`,
   * written verbatim by the same request; and only then the legacy date match,
   * bounded so a `sim-` field can never satisfy it.
   *
   * NO try/catch, deliberately. An empty array and a FAILED read are different
   * facts (Rule 11), and the swallow that used to sit here degraded the recap
   * to the per-mile heuristic without saying so. A genuine database failure
   * now propagates to the route's own 500, which is the honest outcome.
   *
   * Cold-start is unchanged and still returns `[]`: a runner's first run, a
   * non-Faff-watch source, an open easy run. */
  const phaseReadings = recapPhaseReadings(await resolveStoredPhases(userId, date, data));
  const winPhases = phaseReadings.phases;

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
  //
  // ALL SIX OFF ONE ARRAY — `phaseReadings`, which SIMROW-1 · RECAP above
  // resolved to THIS RUN'S completion rather than to whatever payload was
  // posted last on this date. The derivations themselves moved to
  // `lib/coach/recap-phase-readings.ts` so a test can exercise the exact code
  // this route runs; see that file's header for why an inline mapping made
  // them unreachable. Nothing here may re-derive one of them from a different
  // array (Rule 16) — a rep count from one payload beside a pace from another
  // is the shape of the defect, not a lesser version of it.
  const {
    frozenTargetSPerMi, workPaceSPerMi, workDistanceMi, repCount, repPaces,
  } = phaseReadings;
  const livePlanTargetSPerMi = planRow?.pace_target_s ?? null;
  const evalPlannedPaceSPerMi = frozenTargetSPerMi ?? livePlanTargetSPerMi;

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
  // Off the SAME `phaseReadings` as everything above — never a seventh read of
  // a possibly-different array.
  const finishPaceSPerMi = phaseReadings.finishPaceSPerMi ?? finishPaceSpec;

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
    phases: mapWatchPhases(
      Array.isArray(data.phases) ? data.phases : [],
      0,
      classifySession(String(planRow?.type ?? data.workoutType ?? ''), (planRow?.workout_spec ?? null) as Record<string, unknown> | null),
    ),
    wholeHrBpm: actualAvgHr,
    // BOTH FEET · `cadence.units-split`. The raw key is a per-leg count on the
    // pre-May-2026 Strava imports and the recap read it as a step rate.
    wholeCadenceSpm: runCadenceSpm(data)?.spm ?? null,
  });

  /* RULE 16 · the WORK heart rate for the threshold-band sentences.
   *
   * `actualAvgHr` is the whole run, and on a session with a 2.1-mile warm-up
   * at 140 bpm and a 2.1-mile cool-down at 153 that is ten beats lower than
   * the reps — enough to move the verdict across two Friel zone boundaries.
   *
   * Read off `readings.hr`, NOT re-derived: `deriveReadingScopes` is already
   * the owner of "what may this run say about its own heart rate", it already
   * refuses below `HR_REP_KINETICS_FLOOR_SEC` (a rep under two minutes has no
   * interval over which an HR mean is true), and a second weighted mean here
   * would be a second answer to one question. `scope === 'work'` is the only
   * case that gives a work number; 'whole' and 'none' both mean there is no
   * separate work reading, and the band arm falls back accordingly. */
  const workAvgHrBpm: number | null =
    readings.hr.scope === 'work' ? readings.hr.value : null;

  const recap = deriveRecap({
    workAvgHrBpm,
    type,
    phase,
    plannedMi,
    plannedPaceSPerMi: evalPlannedPaceSPerMi,
    // THE PRESCRIBED WINDOW, for the recap's band-adherence sentence. See
    // `RecapInput.plannedPaceBandSPerMi`: the phone's mile table stopped
    // colouring by this on 2026-08-30, and this is where the fact went.
    plannedPaceBandSPerMi: plannedPaceBand,
    plannedHrCap: planRow?.hr_cap ?? null,
    lthrBpm: planRow?.lthr_bpm ?? null,
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
  /* VERDICT-1 (2026-09-01) · THE canonical grade, resolved once from the
   * plan row's own type and spec — the same class the wrist graded against. */
  const grade = resolveWorkoutVerdict({
    type: planRow?.type ?? (data.workoutType as string | null) ?? null,
    spec: (planRow?.workout_spec ?? null) as Record<string, unknown> | null,
    phases: Array.isArray(data.phases) ? data.phases : [],
  });
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
    grade,
    phases: winPhases.length > 0 ? winPhases : undefined,
    verdict: recap.verdict,
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

  /* THE BRIEFING WINS WHERE IT SPEAKS (2026-09-02) — the SAME rule, and the
   * same object, as `/api/v5/today`'s after-run branch.
   *
   * `RunDetailV5` reads this route and `TodayAfterV5` reads that one, and
   * until now each composed its own paragraph from the same five parts. On
   * 2026-09-01 that produced "Tempo done, 4 mi @ 7:03, avg HR 162 across the 4
   * reps..." here and "Tempo done, 8.5 mi total at 8:03/mi, avg HR 162 across
   * the 4 reps." there — one run, two distances, two paces, one field name.
   * They now render the same two sentences off the same
   * `lib/postrun/experience.ts` composition, so a run cannot be graded one way
   * on the sheet the runner opens first and another way in history.
   *
   * A throw becomes null and the raw recap stands, which is the behaviour this
   * route has always had.
   */
  let brief: PostRunWire | null = null;
  try {
    const x = await loadPostRunExperience(userId, { runId: runRow.id });
    brief = x ? postRunWire(x) : null;
  } catch (e) {
    console.error('[runs recap] post-run experience failed:', e);
  }
  const graded = brief != null
    && brief.changeState !== 'UNKNOWN'
    && brief.headline !== 'Run recorded'
    && brief.headline !== 'Recorded, not graded';

  return NextResponse.json({
    ok: true,
    runId: runRow.id,
    date,
    type,
    phase,
    ...recap,
    verdict: graded && brief ? brief.summary : (spoken.body[0] ?? ''),
    facts: graded && brief ? (brief.cost ? [brief.cost] : []) : spoken.body.slice(1),
    conditions_note: graded ? (recap.conditions_note ?? null) : null,
    coach_tip: graded && brief ? (brief.next ?? recap.coach_tip ?? null) : null,
    win: graded && brief ? brief.headline : spoken.headline,
    postRun: brief,
    // E3: the target the verdict was judged against (frozen prescribed when a
    // watch completion exists, else the live plan) + the current plan target,
    // so consumers/falsifiers can see which contract was used and the divergence.
    prescribed_pace_s_per_mi: frozenTargetSPerMi,
    plan_now_pace_s_per_mi: livePlanTargetSPerMi,
    evaluated_pace_s_per_mi: evalPlannedPaceSPerMi ?? null,
  });
}
