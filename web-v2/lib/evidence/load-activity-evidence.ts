/**
 * lib/evidence/load-activity-evidence.ts · the database shell for the Evidence
 * Engine's ownership layer.
 *
 * `activity-evidence.ts` is pure by construction — every input arrives as an
 * argument. This file is the only impure part: it reads one `runs` row, the
 * plan day that run was matched against, and whatever subjective report the
 * runner actually filled in, normalises them into `RawActivityInput` /
 * `ClassifyContext`, and hands them to `classifyActivityEvidence`.
 *
 * Same split `capacity-resolver.ts` uses, for the same reason: every judgement
 * stays testable without a database, and this file carries no judgement at all.
 *
 * ── RULE 14 · WHAT POPULATION EACH QUERY READS ──────────────────────────────
 *
 * · The run: by `runs.id` AND `user_uuid`, and it must be a canonical row —
 *   `CANONICAL_ROW_SQL`, the ONE definition, not a re-typed
 *   `absorbed_into_canonical_at` test. A row that was merged into another is a
 *   duplicate of an activity, not an activity.
 * · The plan day, SINGLE-ACTIVITY path (`classifyStoredActivity`): the ACTIVE
 *   plan only (`training_plans.archived_iso IS NULL`). Joining `plan_workouts`
 *   on `user_uuid` alone reads every plan version the runner has ever had — 47
 *   of them on the owner's account — which is the ACTIVEPLAN-1 defect exactly.
 * · The plan day, WINDOW path (`classifyRecentActivities`): `ownedDaysSql`,
 *   which resolves the version that was LIVE FOR THAT DATE (active first, then
 *   newest authored). Different from the single-activity path on purpose and
 *   strictly better over a historical window: the active plan may not cover an
 *   old date at all, and what the runner actually trained against that day is
 *   the version that owned it. Neither reads all 47.
 * · Subjective: `post_run_rpe` by `activity_id`, and `subjective_checkins` by
 *   date. Never `user_id = 'me'`, which is a shared legacy sentinel that
 *   returns other accounts' rows.
 *
 * ── WHAT IS NOT AVAILABLE, STATED RATHER THAN FILLED IN ─────────────────────
 *
 * `SubjectiveReport.appleEffortRating` has NO storage anywhere in this app.
 * `/api/ingest/workout` accepts no such field, `post_run_rpe` has no column for
 * it, and no production row carries one. It is left null here rather than
 * approximated from `rpe`, because an Apple effort rating and a
 * self-reported RPE are different instruments on different scales and merging
 * them would be inventing a measurement (Enforcement §38).
 *
 * `feltHarderOverTime` and `heatPerceived` likewise have no storage. They are
 * part of the classifier's contract because the reference case records them
 * and because they are cheap to wire once a surface collects them; they are
 * null until then.
 */
import { pool } from '@/lib/db/pool';
import { CANONICAL_ROW_SQL } from '@/lib/runs/volume';
import { normalizeSplits, runDaySql, type RunData } from '@/lib/runs/run-shape';
import { ownedDaysSql } from '@/lib/plan/owned-days';
import { runFacts } from '@/lib/runs/run-facts';
import { runCadenceSpm } from '@/lib/runs/coherence';
import {
  classifyActivityEvidence,
  type ActivityEvidenceResult,
  type ClassifyContext,
  type CurrentCapacityBelief,
  type EvidenceSplit,
  type PlannedIntent,
  type PlannedWorkoutContext,
  type RawActivityInput,
  type SplitsReconciliation,
  type SubjectiveReport,
} from './activity-evidence';

/**
 * `plan_workouts.type` → the intent vocabulary this layer reasons in.
 *
 * A LOOSE map on purpose: an unrecognised type becomes `OTHER`, never a guess.
 * `OTHER` is not in `ANCHOR_CAPABLE_INTENTS`, so an unmapped type can only ever
 * make the classifier MORE conservative — the safe direction for a mapping
 * that will meet new plan types it has not been taught.
 */
export function intentForPlanType(raw: string | null | undefined): PlannedIntent | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (t === 'recovery') return 'RECOVERY';
  if (t === 'easy') return 'EASY';
  if (t === 'long') return 'LONG';
  if (t === 'steady' || t === 'marathon_pace' || t === 'mp') return 'STEADY';
  if (t === 'threshold' || t === 'tempo' || t === 'cruise') return 'THRESHOLD';
  if (t === 'intervals' || t === 'interval' || t === 'fartlek') return 'INTERVALS';
  if (t === 'repetition' || t === 'reps' || t === 'strides' || t === 'hills') return 'REPETITION';
  if (t === 'race' || t === 'race_week_tuneup') return 'RACE';
  if (t === 'time_trial' || t === 'timetrial') return 'TIME_TRIAL';
  return 'OTHER';
}

/**
 * Normalise `runs.data.splits` into the classifier's narrow shape.
 *
 * Pace, HR and distance come out of `normalizeSplits` — the ONE reader of the
 * six historical split shapes (`lib/runs/run-shape.ts`), so this file does not
 * grow a seventh opinion, and it preserves source ORDER with nulls intact,
 * which is what the classifier's index-based interruption and segment lanes
 * need. A row with no usable pace is dropped (it can contribute to nothing); a
 * row with pace but no HR is KEPT with `hrBpm: null`, because it still counts
 * toward continuity and pace stability.
 *
 * Distance defaults to one mile only when the row carries none, which is what
 * every per-mile shape in that table means by omitting it.
 *
 * Power is read here rather than there because `NormalizedSplit` has no power
 * field — no split shape in production carries per-split power, so this reads
 * the three plausible spellings and lands null for both reference cases. That
 * null is reported as null rather than back-filled from the run average.
 */
export function normaliseSplits(raw: unknown): EvidenceSplit[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const normalised = normalizeSplits(raw);
  const out: EvidenceSplit[] = [];
  normalised.forEach((s, i) => {
    if (s.paceSec == null || !(s.paceSec > 0)) return;
    const src = (raw[i] ?? {}) as Record<string, unknown>;
    const powerRaw = src.powerW ?? src.avgPowerW ?? src.power ?? null;
    out.push({
      index: s.mile ?? i + 1,
      distanceMi: s.distanceMi != null && s.distanceMi > 0 ? s.distanceMi : 1,
      paceSecPerMi: s.paceSec,
      hrBpm: s.hr,
      powerW: typeof powerRaw === 'number' && Number.isFinite(powerRaw) ? powerRaw : null,
    });
  });
  return out;
}

interface RunRow {
  id: string;
  data: Record<string, unknown>;
}

/** `ownedDaysSql`'s upper bound is exclusive; this file's windows are
 *  inclusive. One conversion, named, rather than an off-by-one at a call site. */
function isoPlusOneDay(isoDate: string): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Build the classifier's activity input from one stored `runs` row.
 *
 * Exported so a test can drive the mapping without a database — the mapping is
 * where a loader's real bugs live, and the two reference-case rows exercise
 * opposite halves of it (one has splits and two clocks; the other has neither).
 */
export function activityInputFromRunData(
  id: string,
  data: Record<string, unknown>,
  lthrBpm: number | null,
): RawActivityInput {
  const weather = (data.weather ?? {}) as Record<string, unknown>;
  const splits = normaliseSplits(data.splits);

  // ── THE CLOCKS · one reader, not a fourth ladder ───────────────────────
  //
  // `runs.data` carries FOUR duration keys and this file must not spell its
  // own COALESCE over them — `lib/conservation/_reader_lint.test.ts` exists
  // because three readers that agreed eventually did not. `runFacts` is the
  // one reader, and `reconcileRun` underneath it already knows the thing a
  // hand-rolled ladder does not: on every watch and strava row in production
  // `elapsedTimeS` is a byte copy of `movingTimeS` and carries no wall-clock
  // information at all.
  //
  // ELAPSED is passed on ONLY when it genuinely exceeds the moving clock, and
  // that is a Rule 11 statement rather than a convenience: `RawActivityInput
  // .elapsedSec` null means "there is no second clock to reconcile against",
  // NOT "the run was continuous", and the classifier's continuity read treats
  // the two differently.
  const facts = runFacts(data as unknown as RunData, { basis: 'moving' });
  const activeSec = facts.timeSec;
  const elapsedSec =
    facts.elapsedSec != null && activeSec != null && facts.elapsedSec > activeSec
      ? facts.elapsedSec
      : null;

  const validation = (data.splits_validation ?? null) as Record<string, unknown> | null;
  const splitsReconciliation: SplitsReconciliation | null =
    validation && num(validation.durationS) != null
      ? {
          splitsSumS: num(validation.splitsSumS) ?? 0,
          durationS: num(validation.durationS) ?? 0,
          deltaS: num(validation.deltaS) ?? 0,
          count: num(validation.droppedCount) ?? 0,
        }
      : null;

  // The PEAK temperature the run fought through, when the weather enrichment
  // recorded one — the quantity `HeatConditions.tempF` documents itself as
  // wanting. Falls back to the single stored temperature.
  const tempF = num(weather.temp_f_peak) ?? num(data.tempF) ?? num(weather.temp_f);
  const humidityPct = num(weather.humidity_pct_peak) ?? num(weather.humidity_pct);

  return {
    activityId: String(data.activityId ?? data.id ?? id),
    date: String(data.date ?? ''),
    distanceMi: facts.distanceMi,
    activeSec,
    elapsedSec,
    avgHrBpm: num(data.avgHr),
    maxHrBpm: num(data.maxHr),
    avgPowerW: num(data.avgPowerW),
    // `avgCadence` is stored in TWO units across the row corpus (steps/min and
    // strides/min) and `runCadenceSpm` is the one reader that resolves which
    // — see `lib/runs/_cadence_units.test.ts`. Reading the raw key would put a
    // 81 spm and a 162 spm run on the same axis.
    avgCadenceSpm: runCadenceSpm(data)?.spm ?? null,
    groundContactMs: num(data.avgGctMs),
    verticalOscillationCm: num(data.avgVertOscCm),
    strideLengthM: num(data.avgStrideLengthM),
    elevationGainFt: num(data.elevGainFt),
    // An EMPTY array and a null mean the same thing to the classifier — no
    // per-split granularity — so it takes the array as it is rather than
    // choosing between two spellings of one fact. That the splits were
    // DROPPED (as opposed to never computed) is carried separately, by
    // `splitsReconciliation`, which is the distinction that matters.
    splits,
    splitsReconciliation,
    splitsUnreliable: data.splits_unreliable === true,
    tempF,
    humidityPct,
    dewpointF: num(weather.dewpoint_f),
    cloudCoverPct: num(weather.cloud_cover_pct),
    conditions: typeof weather.conditions === 'string' ? weather.conditions : null,
    indoor: data.indoor === true,
    lthrBpm,
  };
}

/**
 * Load one activity and classify it.
 *
 * Returns null when the row does not exist, is not this user's, or is not the
 * canonical row for its activity. NO `.catch()` — a query failure throws rather
 * than silently becoming "nothing to classify" (Rule 11).
 */
export async function classifyStoredActivity(
  userUuid: string,
  runId: string,
  opts: { currentBelief?: CurrentCapacityBelief | null } = {},
): Promise<ActivityEvidenceResult | null> {
  const runRes = await pool.query<RunRow>(
    // Unaliased on purpose: `CANONICAL_ROW_SQL` is written against a bare
    // `data`, and rewriting it at the call site would defeat the point of
    // having one greppable definition (Rule 14).
    `SELECT id::text, data
       FROM runs
      WHERE user_uuid = $1::uuid
        AND id = $2::bigint
        AND ${CANONICAL_ROW_SQL}`,
    [userUuid, runId],
  );
  const row = runRes.rows[0];
  if (!row) return null;

  const data = row.data ?? {};
  const dateISO = String(data.date ?? '');

  const profRes = await pool.query<{ lthr: string | number | null }>(
    `SELECT lthr FROM profile WHERE user_uuid = $1::uuid`,
    [userUuid],
  );
  const lthrBpm = num(profRes.rows[0]?.lthr ?? null);

  // ACTIVE plan only — see the Rule 14 note in the file header.
  const planRes = dateISO
    ? await pool.query<{
        type: string | null; distance_mi: string | number | null;
        duration_min: string | number | null; is_quality: boolean | null;
      }>(
        `SELECT pw.type, pw.distance_mi, pw.duration_min, pw.is_quality
           FROM plan_workouts pw
           JOIN training_plans tp ON tp.id = pw.plan_id
          WHERE tp.user_uuid = $1::uuid
            AND tp.archived_iso IS NULL
            AND pw.date_iso = $2
          ORDER BY pw.id ASC
          LIMIT 1`,
        [userUuid, dateISO],
      )
    : { rows: [] as Array<{ type: string | null; distance_mi: string | number | null; duration_min: string | number | null; is_quality: boolean | null }> };

  const planRow = planRes.rows[0] ?? null;
  const intent = intentForPlanType(planRow?.type ?? null);
  const plannedWorkout: PlannedWorkoutContext | null = intent
    ? {
        intent,
        sourceType: planRow?.type ?? null,
        plannedDistanceMi: num(planRow?.distance_mi ?? null),
        plannedDurationSec: (() => {
          const m = num(planRow?.duration_min ?? null);
          return m != null ? m * 60 : null;
        })(),
        quality: planRow?.is_quality ?? null,
      }
    : null;

  // `post_run_rpe.activity_id` keys on THE ID THE CLIENT SAW, which is the
  // `runs` row id on every row the owner has filed, and the source activity id
  // (`data.id`) on older ones. `lib/coach/acknowledge.ts` already documents
  // this ambiguity and searches both; searching only `data.activityId` reads a
  // key nothing writes and reports every run as un-rated (Rule 14 — the query
  // must name the population it reads, and this one was naming the wrong one).
  const rpeKeys = [
    row.id,
    ...(typeof data.id === 'string' || typeof data.id === 'number' ? [String(data.id)] : []),
    ...(typeof data.activityId === 'string' || typeof data.activityId === 'number'
      ? [String(data.activityId)] : []),
  ];
  // And never NARROWER about the user than the writer. `post_run_rpe.user_id`
  // is TEXT for legacy reasons and older rows carry the `'me'` sentinel;
  // `user_uuid` was added later, and `/api/runs/[id]/rpe` still writes both. A
  // reader matching only `user_uuid` turns a saved answer into an unsaved one
  // (`lib/runs/_identity_lint.test.ts`).
  const rpeRes = await pool.query<{ rpe: number | null; notes: string | null }>(
    `SELECT rpe, notes FROM post_run_rpe
      WHERE (user_uuid = $1::uuid OR user_id::text = $1::text)
        AND activity_id = ANY($2::text[])
      ORDER BY logged_at DESC LIMIT 1`,
    [userUuid, [...new Set(rpeKeys)]],
  );
  const checkinRes = dateISO
    ? await pool.query<{ rating: number | null }>(
        `SELECT rating FROM subjective_checkins
          WHERE user_uuid = $1::uuid AND date::date = $2::date
          ORDER BY updated_at DESC LIMIT 1`,
        [userUuid, dateISO],
      )
    : { rows: [] as Array<{ rating: number | null }> };

  const hasSubjective = rpeRes.rows.length > 0 || checkinRes.rows.length > 0;
  const subjectiveReport: SubjectiveReport | null = hasSubjective
    ? {
        rpe: rpeRes.rows[0]?.rpe ?? null,
        notes: rpeRes.rows[0]?.notes ?? null,
        dayRating: checkinRes.rows[0]?.rating ?? null,
        // No storage exists for these three. See the file header.
        appleEffortRating: null,
        feltHarderOverTime: null,
        heatPerceived: null,
      }
    : null;

  const context: ClassifyContext = {
    plannedWorkout,
    subjectiveReport,
    currentBelief: opts.currentBelief ?? null,
  };
  return classifyActivityEvidence(activityInputFromRunData(row.id, data, lthrBpm), context);
}

/**
 * One classified result plus the identity a consumer needs to talk about it.
 *
 * `runId` is `runs.id` (what a `plan_workouts`/`coach_intents` row references);
 * `result.activityId` is the SOURCE activity id, which is a different key on
 * older rows. Both are reported rather than collapsed, because a caller citing
 * evidence provenance needs the one the rest of the app can look up.
 */
export interface ClassifiedActivity {
  runId: string;
  dateISO: string;
  result: ActivityEvidenceResult;
}

/**
 * Classify a WINDOW of the runner's recent activities, in ONE pass over the
 * database rather than N calls to `classifyStoredActivity`.
 *
 * ── WHY A BATCH LOADER EXISTS AT ALL ────────────────────────────────────────
 *
 * `classifyStoredActivity` issues four queries per activity. Two consumers now
 * need the last few weeks at once — the belief-tension accumulator
 * (`lib/evidence/reexamination.ts`) and the Adaptation Engine
 * (`lib/adaptation/adaptation-engine.ts`) — and a per-row loop would issue
 * forty. This runs FIVE queries whatever the window holds, and calls the same
 * pure classifier on the same normalised input, so nothing about the judgement
 * differs between the two paths. §24: when the canonical service is missing
 * functionality, add it there rather than routing around it.
 *
 * ── RULE 14 · WHAT POPULATION THIS READS ────────────────────────────────────
 *
 * Identical to `classifyStoredActivity`'s, stated again because it is a second
 * query set and a copy that drifts is the whole defect class:
 *
 * · Runs: this `user_uuid`, CANONICAL rows only (`CANONICAL_ROW_SQL` — the one
 *   definition), inside the date window. A merged row is a duplicate of an
 *   activity, not an activity, and counting one twice would double a
 *   corroboration count.
 * · Plan days: the ACTIVE plan only. Joining `plan_workouts` on `user_uuid`
 *   alone reads all 47 of the owner's plan versions (ACTIVEPLAN-1).
 * · Subjective: `post_run_rpe` matched on either id spelling AND on either
 *   user column, for the reasons `classifyStoredActivity` documents.
 *
 * Rule 11: a run the window contains but whose data cannot be classified is
 * ABSENT from the result, never present as an empty classification.
 */
export async function classifyRecentActivities(
  userUuid: string,
  fromISO: string,
  toISO: string,
  opts: { currentBelief?: CurrentCapacityBelief | null } = {},
): Promise<ClassifiedActivity[]> {
  const runsRes = await pool.query<RunRow>(
    `SELECT id::text, data
       FROM runs
      WHERE user_uuid = $1::uuid
        AND ${CANONICAL_ROW_SQL}
        AND ${runDaySql()} BETWEEN $2 AND $3
      ORDER BY ${runDaySql()}`,
    [userUuid, fromISO, toISO],
  );
  if (runsRes.rows.length === 0) return [];

  const [profRes, planRes, rpeRes, checkinRes] = await Promise.all([
    pool.query<{ lthr: string | number | null }>(
      `SELECT lthr FROM profile WHERE user_uuid = $1::uuid`,
      [userUuid],
    ),
    pool.query<{
      date_iso: string; type: string | null; distance_mi: string | number | null;
      duration_min: string | number | null; is_quality: boolean | null;
    }>(
      // `ownedDaysSql` · THE one answer to "which plan owned this day", and a
      // strictly better one than the active-plan filter this query first
      // carried: for a HISTORICAL date the active plan may not cover it at all,
      // and the version that was live then is what the runner actually trained
      // against. `_run_shape_lint.test.ts` caught the hand-rolled
      // `DISTINCT ON (pw.date_iso)` and it was right to.
      //
      // Its upper bound is EXCLUSIVE, so `toISO` is advanced one day to keep
      // this function's own inclusive window.
      ownedDaysSql({
        columns: 'pw.date_iso, pw.type, pw.distance_mi, pw.duration_min, pw.is_quality',
      }),
      [userUuid, fromISO, isoPlusOneDay(toISO)],
    ),
    pool.query<{ activity_id: string; rpe: number | null; notes: string | null }>(
      `SELECT DISTINCT ON (activity_id) activity_id, rpe, notes
         FROM post_run_rpe
        WHERE (user_uuid = $1::uuid OR user_id::text = $1::text)
        ORDER BY activity_id, logged_at DESC`,
      [userUuid],
    ),
    pool.query<{ d: string; rating: number | null }>(
      `SELECT DISTINCT ON (date::date) date::date::text AS d, rating
         FROM subjective_checkins
        WHERE user_uuid = $1::uuid AND date::date BETWEEN $2::date AND $3::date
        ORDER BY date::date, updated_at DESC`,
      [userUuid, fromISO, toISO],
    ),
  ]);

  const lthrBpm = num(profRes.rows[0]?.lthr ?? null);
  const planByDate = new Map(planRes.rows.map((r) => [r.date_iso, r]));
  const rpeByKey = new Map(rpeRes.rows.map((r) => [String(r.activity_id), r]));
  const ratingByDate = new Map(checkinRes.rows.map((r) => [r.d, r.rating]));

  const out: ClassifiedActivity[] = [];
  for (const row of runsRes.rows) {
    const data = row.data ?? {};
    const dateISO = String(data.date ?? String(data.startLocal ?? '').slice(0, 10));
    if (!dateISO) continue;

    const planRow = planByDate.get(dateISO) ?? null;
    const intent = intentForPlanType(planRow?.type ?? null);
    const plannedWorkout: PlannedWorkoutContext | null = intent
      ? {
          intent,
          sourceType: planRow?.type ?? null,
          plannedDistanceMi: num(planRow?.distance_mi ?? null),
          plannedDurationSec: (() => {
            const m = num(planRow?.duration_min ?? null);
            return m != null ? m * 60 : null;
          })(),
          quality: planRow?.is_quality ?? null,
        }
      : null;

    const rpeKeys = [
      row.id,
      ...(typeof data.id === 'string' || typeof data.id === 'number' ? [String(data.id)] : []),
      ...(typeof data.activityId === 'string' || typeof data.activityId === 'number'
        ? [String(data.activityId)] : []),
    ];
    const rpeRow = rpeKeys.map((k) => rpeByKey.get(k)).find((r) => r != null) ?? null;
    const dayRating = ratingByDate.get(dateISO) ?? null;
    const subjectiveReport: SubjectiveReport | null = rpeRow || dayRating != null
      ? {
          rpe: rpeRow?.rpe ?? null,
          notes: rpeRow?.notes ?? null,
          dayRating,
          appleEffortRating: null,
          feltHarderOverTime: null,
          heatPerceived: null,
        }
      : null;

    const context: ClassifyContext = {
      plannedWorkout,
      subjectiveReport,
      currentBelief: opts.currentBelief ?? null,
    };
    out.push({
      runId: row.id,
      dateISO,
      result: classifyActivityEvidence(activityInputFromRunData(row.id, data, lthrBpm), context),
    });
  }
  return out;
}
