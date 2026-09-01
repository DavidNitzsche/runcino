/**
 * lib/execution/load.ts · read the runner's key sessions and interpret them.
 *
 * The layer between the database and `interpretExecution`. Everything it
 * assembles has a home already — `ownedDaysSql` answers which plan owned each
 * day, `getCanonicalRunIds` answers which row is the real run, `run-shape`
 * answers what is in the blob — and this file's whole job is to put them in
 * front of the interpreter rather than to grow a second opinion about any of
 * them.
 *
 * ## The honesty contract, restated for this file
 *
 * Three outcomes for a planned session, and they are NOT the same:
 *
 *   · a run happened and we could describe its work    → an execution state
 *   · no run happened                                  → MISSED
 *   · a run happened and no basis could describe it    → `readable: false`
 *
 * The third is missing evidence. It is dropped from the aggregate rather than
 * scored, for the same reason `loadRecentTestPoints` drops an abstained
 * verdict: a session we cannot judge is not a session that was failed.
 */

import { pool } from '@/lib/db/pool';
import { getCanonicalRunIds } from '@/lib/runs/volume';
import { ownedDaysSql } from '@/lib/plan/owned-days';
import {
  runDaySql,
  runPhasesSql,
  runSplitsSql,
  runWatchCompletionRefSql,
  runDistanceMiSql,
  asRunData,
} from '@/lib/runs/run-shape';
import type { WirePhaseVerdict } from '@/lib/training/execution-semantics';
import {
  actualStimulus,
  establishedPaceFor,
  executionContext,
  plannedStimulus,
  type ActualBasis,
  type ActualRead,
  type PlannedBasis,
  type PlannedSession,
} from './reconstruct';
import {
  interpretExecution,
  earnsProgressionCredit,
  type ExecutionRead,
  type Stimulus,
} from './interpret';
import type { WorkoutSpec } from '@/lib/plan/spec-builder';

/** One planned key session, as it was prescribed and as it was run. */
export interface KeySessionExecution {
  dateISO: string;
  type: string | null;
  /** Null when no rung could describe what the session asked for. */
  planned: Stimulus | null;
  plannedBasis: PlannedBasis | null;
  /** Null when nothing ran, or when a run existed and no basis could read it —
   *  `readable` tells the two apart. */
  actual: Stimulus | null;
  actualBasis: ActualBasis | null;
  /** False when a run exists but its work could not be described. Such a
   *  session contributes no evidence in either direction. */
  readable: boolean;
  /** Null when unreadable. */
  read: ExecutionRead | null;
  earnsProgression: boolean;
  /** The device's own signals, carried through for surfaces and audits. */
  watchStatus: 'completed' | 'partial' | 'abandoned' | null;
  toleranceShare: number | null;
  workVerdicts: WirePhaseVerdict[];
  replacedByRace: boolean;
}

interface OwnedQualityRow {
  date_iso: string;
  type: string | null;
  is_quality: boolean | null;
  is_long: boolean | null;
  distance_mi: string | null;
  pace_target_s_per_mi: number | null;
  workout_spec: unknown;
}

interface RunRow {
  id: string;
  day: string;
  data: unknown;
  ref: string | null;
}

/**
 * Interpret every KEY session the runner was prescribed over `[from, to)`.
 *
 * Key = `plan_workouts.is_quality`, the same predicate the adaptation model's
 * execution gate has always counted. What changes is that each one now
 * resolves to a doctrine state rather than to "a run exists on that date".
 */
export async function loadKeySessionExecutions(
  userUuid: string,
  fromISO: string,
  toISO: string,
  vdot: number | null,
): Promise<KeySessionExecution[]> {
  const owned = (await pool.query<OwnedQualityRow>(
    `WITH owned AS (${ownedDaysSql({
      columns:
        'pw.date_iso, pw.type, pw.is_quality, pw.is_long, pw.distance_mi, ' +
        'pw.pace_target_s_per_mi, pw.workout_spec',
    })})
     SELECT * FROM owned WHERE owned.is_quality = true ORDER BY owned.date_iso`,
    [userUuid, fromISO, toISO],
  )).rows;
  if (owned.length === 0) return [];

  const canonicalIds = await getCanonicalRunIds(userUuid, fromISO, toISO).catch(() => [] as string[]);

  /* One run per DAY, choosing the richest.
   *
   * `getCanonicalRunIds` settles WHICH physical run is real, and that is not
   * the same question as which ROW carries the most signal — its own header
   * says it optimises for mileage truth. A day with a watch row and a Strava
   * row has one run and two descriptions of it, and only one of them has
   * phases. Ordering by phase presence, then split count, then distance keeps
   * the richest description while `DISTINCT ON (day)` keeps the count honest.
   * Same shape as the long-run pick in `lib/adaptation/load.ts`.
   *
   * No merge-loser filter on top of the canonical ids, deliberately. Canonical
   * selection has already chosen the winner of each dedup cluster; a second
   * predicate that disagreed with it would drop the day entirely, and a day
   * with no run reads as MISSED. A session must never be marked missed by a
   * filter mismatch. */
  const runs = (await pool.query<RunRow>(
    `SELECT DISTINCT ON (day) r.id::text, ${runDaySql('r')} AS day, r.data,
            ${runWatchCompletionRefSql('r')} AS ref
       FROM runs r
      WHERE r.user_uuid = $1
        AND r.id::text = ANY($4::text[])
        AND ${runDaySql('r')} >= $2 AND ${runDaySql('r')} < $3
      ORDER BY day,
               jsonb_array_length(COALESCE(${runPhasesSql('r')}, '[]'::jsonb)) DESC,
               jsonb_array_length(COALESCE(${runSplitsSql('r')}, '[]'::jsonb)) DESC,
               ${runDistanceMiSql('r')} DESC,
               r.id DESC`,
    [userUuid, fromISO, toISO, canonicalIds],
  )).rows;
  const runByDay = new Map(runs.map((r) => [r.day, r]));

  const watchStatusByRef = await loadWatchStatuses(
    userUuid,
    runs.map((r) => r.ref).filter((r): r is string => r != null),
  );
  const rpeByDay = await loadRpe(userUuid, fromISO, toISO);
  const raceDays = await loadRaceDays(userUuid, fromISO, toISO);

  const out: KeySessionExecution[] = [];
  for (const row of owned) {
    const session: PlannedSession = {
      dateISO: row.date_iso,
      type: row.type,
      isQuality: row.is_quality === true,
      isLong: row.is_long === true,
      distanceMi: row.distance_mi == null ? null : Number(row.distance_mi),
      paceTargetSPerMi: row.pace_target_s_per_mi == null ? null : Number(row.pace_target_s_per_mi),
      spec: (row.workout_spec ?? null) as WorkoutSpec,
    };
    const planned = plannedStimulus(session, { vdot });
    const run = runByDay.get(row.date_iso) ?? null;
    const runData = run ? asRunData(run.data) : null;
    /* A race day, however it got there.
     *
     * Doctrine's `REPLACED` read is written for a race that displaced a
     * workout, and it is the right read for a race the plan asked for too. The
     * adaptation model's question is whether the athlete has earned MORE
     * training stress, and a race answers that identically in both cases:
     * training credit yes, fitness evidence high, recovery cost higher than
     * planned, progression credit no. "Adjust downstream training rather than
     * marking Saturday green."
     *
     * Grading a goal race as an ordinary session instead reads a completed
     * race as a demonstration of room for more work, which is the opposite of
     * what a race leaves behind. It is not hypothetical: without this, David's
     * half marathon graded AS_PLANNED and carried his progression share over
     * the gate on the strength of the event that cost him the most recovery in
     * the block. */
    const replacedByRace = raceDays.has(row.date_iso) || row.type === 'race';

    if (planned == null) {
      out.push({
        dateISO: row.date_iso, type: row.type,
        planned: null, plannedBasis: null, actual: null, actualBasis: null,
        readable: false, read: null, earnsProgression: false,
        watchStatus: null, toleranceShare: null, workVerdicts: [], replacedByRace,
      });
      continue;
    }

    const statusFallback = run?.ref ? watchStatusByRef.get(run.ref) ?? null : null;
    const actual: ActualRead | null = runData
      ? actualStimulus(runData, planned, session, { vdot, watchStatusFallback: statusFallback })
      : null;

    // A run happened and nothing could describe its work. Missing evidence,
    // not a miss — recorded and excluded from the aggregate.
    if (runData != null && actual == null && !replacedByRace) {
      out.push({
        dateISO: row.date_iso, type: row.type,
        planned: planned.stimulus, plannedBasis: planned.basis,
        actual: null, actualBasis: null,
        readable: false, read: null, earnsProgression: false,
        watchStatus: statusFallback, toleranceShare: null, workVerdicts: [], replacedByRace,
      });
      continue;
    }

    const ctx = executionContext({
      runData,
      watchStatusFallback: statusFallback,
      rpe: rpeByDay.get(row.date_iso) ?? null,
      replacedByRace,
      establishedPaceSPerMi: establishedPaceFor(planned.stimulus.domain, vdot),
    });
    const read = interpretExecution(planned.stimulus, actual?.stimulus ?? null, ctx);

    out.push({
      dateISO: row.date_iso,
      type: row.type,
      planned: planned.stimulus,
      plannedBasis: planned.basis,
      actual: actual?.stimulus ?? null,
      actualBasis: actual?.basis ?? null,
      readable: true,
      read,
      earnsProgression: earnsProgressionCredit(read),
      watchStatus: actual?.watchStatus ?? statusFallback,
      toleranceShare: actual?.toleranceShare ?? null,
      workVerdicts: actual?.workVerdicts ?? [],
      replacedByRace,
    });
  }
  return out;
}

/**
 * The watch's run-level `status` for rows written before it was persisted onto
 * the run.
 *
 * The completion endpoint has always stored the whole payload in
 * `coach_intents.value` under the workout id, and `data.watchCompletionRef` is
 * that id. So the field exists for every historical watch run; it has simply
 * never been read. `value` is TEXT, not jsonb — the cast is required.
 */
async function loadWatchStatuses(
  userUuid: string,
  refs: string[],
): Promise<Map<string, 'completed' | 'partial' | 'abandoned'>> {
  const out = new Map<string, 'completed' | 'partial' | 'abandoned'>();
  if (refs.length === 0) return out;
  try {
    const r = await pool.query<{ field: string; status: string | null }>(
      `SELECT DISTINCT ON (field) field, value::jsonb->>'status' AS status
         FROM coach_intents
        WHERE COALESCE(user_uuid::text, user_id::text) = $1
          AND reason = 'watch_completion'
          AND field = ANY($2::text[])
        ORDER BY field, id DESC`,
      [userUuid, refs],
    );
    for (const row of r.rows) {
      if (row.status === 'completed' || row.status === 'partial' || row.status === 'abandoned') {
        out.set(row.field, row.status);
      }
    }
  } catch (err) {
    // Always log · a swallowed error and absent data are indistinguishable,
    // and the only reason the bigint bug in ARCHITECTURE.md was ever found.
    console.warn('[execution] watch status unreadable:',
      err instanceof Error ? err.message : err);
  }
  return out;
}

/** Highest RPE logged per day. Doctrine's "RPE spiked" half of the collapse
 *  test — the only self-report the system captures. */
async function loadRpe(
  userUuid: string,
  fromISO: string,
  toISO: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const r = await pool.query<{ day: string; rpe: number | null }>(
      `SELECT to_char(logged_at, 'YYYY-MM-DD') AS day, MAX(rpe) AS rpe
         FROM post_run_rpe
        -- Both user columns; see lib/runs/_identity_lint.test.ts.
        WHERE (user_uuid = $1 OR user_id::text = $1::text)
          AND logged_at >= $2::date AND logged_at < $3::date
        GROUP BY 1`,
      [userUuid, fromISO, toISO],
    );
    for (const row of r.rows) if (row.rpe != null) out.set(row.day, Number(row.rpe));
  } catch (err) {
    console.warn('[execution] rpe unreadable:', err instanceof Error ? err.message : err);
  }
  return out;
}

/** Days the runner raced. `races` is per-user and slugs are shared between
 *  athletes, so this is scoped by `user_uuid` — see ARCHITECTURE.md §2. */
async function loadRaceDays(
  userUuid: string,
  fromISO: string,
  toISO: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const r = await pool.query<{ d: string | null }>(
      `SELECT plan->>'date' AS d FROM races
        WHERE user_uuid = $1 AND plan->>'date' >= $2 AND plan->>'date' < $3`,
      [userUuid, fromISO, toISO],
    );
    for (const row of r.rows) if (row.d) out.add(row.d);
  } catch (err) {
    console.warn('[execution] race days unreadable:', err instanceof Error ? err.message : err);
  }
  return out;
}
