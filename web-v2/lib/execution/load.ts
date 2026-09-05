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
import { ownedDaysSql } from '@/lib/plan/owned-days';
import { resolveDateRangeExecutions } from './day-resolver';
import type { PhaseVerdict } from '@/lib/training/execution-semantics';
import type { PrescribedPaceAnchors } from '@/lib/training/prescription-resolver';
import { resolvePrescribedPaceAnchors } from '@/lib/training/load-prescription-anchors';
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
  /** THE canonical per-rep grades (`lib/execution/verdict.ts`), not the
   *  device's stored word — see `ActualRead.workVerdicts`. */
  workVerdicts: PhaseVerdict[];
  /**
   * The pace this runner has established for THIS session's domain, s/mi, as
   * the interpreter actually used it.
   *
   * Carried rather than left to be recomputed. `findPartialFitnessEvidence`
   * used to call `establishedPaceFor` a second time with its own `vdot`
   * argument, and its own comment named the hazard — "a different vdot
   * argument than the one load.ts used could theoretically disagree". Rule 16:
   * one quantity, one name, resolved once.
   *
   * Null when the anchor set was refused, which is a real answer (Rule 11).
   */
  establishedPaceSPerMi: number | null;
  replacedByRace: boolean;
}

interface OwnedQualityRow {
  id: string;
  date_iso: string;
  type: string | null;
  is_quality: boolean | null;
  is_long: boolean | null;
  distance_mi: string | null;
  pace_target_s_per_mi: number | null;
  workout_spec: unknown;
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
        'pw.id, pw.date_iso, pw.type, pw.is_quality, pw.is_long, pw.distance_mi, ' +
        'pw.pace_target_s_per_mi, pw.workout_spec',
    })})
     SELECT * FROM owned WHERE owned.is_quality = true ORDER BY owned.date_iso`,
    [userUuid, fromISO, toISO],
  )).rows;
  if (owned.length === 0) return [];

  /* F-5 · THE ANCHORS THE PLAN WAS PRICED FROM, not a second fitness.
   *
   * `establishedPaceFor` used to take a raw VDOT and apply its own offsets
   * (`t - 30` for R, `t - 18` for I, `t + 100` for E) which were 11-46 s/mi
   * SLOWER than what the prescription side actually uses. Every one erred the
   * same way, which biased `failedAtKnownPace` toward true — a session that
   * came apart at a pace well inside the prescription read as HIGH fitness
   * evidence, and the number was printed at the runner.
   *
   * These are the same six numbers the plan builder prices a block from, off
   * the same four capacity resolvers. `resolvePrescribedPaceAnchors` takes a
   * userId and a date and nothing else, so no goal, race or readiness can
   * reach the grader through it.
   *
   * RULE 11 · a refusal is carried, never patched over. `PaceAnchorRead`'s
   * refusal branch has no `anchors` field, and `load-prescription-anchors.ts`
   * states the rule in its own header: "A refusal must never be answered by
   * reaching for the old VDOT cascade." A null anchor set means
   * `establishedPaceSPerMi` is null, which means `failedAtKnownPace` cannot
   * fire, which is the correct answer when nobody knows what pace this runner
   * has established. */
  let anchors: PrescribedPaceAnchors | null = null;
  try {
    const anchorRead = await resolvePrescribedPaceAnchors(userUuid, toISO);
    anchors = anchorRead.ok ? anchorRead.anchors : null;
  } catch {
    // A THROWN read and a REFUSED one both mean "nobody knows this runner's
    // established pace today", and both produce exactly the same downstream
    // behaviour: `establishedPaceFor` returns null, `failedAtKnownPace`
    // cannot fire, and no session is credited with high fitness evidence on
    // an anchor nobody has. Written as try/catch rather than `.catch(() =>
    // …)` so the collapse is visible and argued here rather than hidden in a
    // one-liner (Rule 11).
    anchors = null;
  }

  /* EXECUTION-IDENTITY-1 (2026-09-03) · replaces "one run per day, choosing
   * the richest" — the exact shape WORKOUT-EXECUTION-ID-1 fixed on Today,
   * Watch Today and Run Detail, applied here because this is the file that
   * feeds capacity belief and the Adaptation Engine. Grading a session off
   * whichever run merely LOOKED richest that day is the same misattribution
   * risk with higher stakes: a threshold session graded off an unrelated
   * easy run would silently poison VDOT belief, not just paint one screen
   * wrong. THE canonical resolver (`lib/execution/day-resolver.ts`) decides
   * which run, if any, satisfies each prescription — never this file
   * re-deriving "richest" on its own, and never a passive sync's type stamp
   * alone (the resolver's LEGACY tier already excludes those — see its own
   * header for the live find that made that necessary).
   *
   * A prescription with no matched run reads as a genuine MISS below, exactly
   * as if no run existed that day — David's ruling: "A missing prescribed
   * workout must remain missing even when supplemental mileage exists." The
   * supplemental run is not lost, it simply never enters THIS function,
   * because this function's only question is "was the prescribed session
   * executed" — total mileage, load and durability are answered by separate
   * readers (`canonicalMileageByDay` et al.) that already sum every canonical
   * run regardless of prescription match, and a run that carries its own
   * genuine capacity signal still reaches the Evidence Engine through
   * whichever activity-level detector reads it — never by inheriting the
   * prescription that happened to sit on its calendar date. */
  const resolvedDays = await resolveDateRangeExecutions(userUuid, fromISO, toISO);

  const matchedWatchRefs = [...resolvedDays.values()]
    .flatMap((d) => d.prescriptions.map((p) => p.matchedRun))
    .filter((r): r is NonNullable<typeof r> => r != null)
    .map((r) => (typeof r.data.watchCompletionRef === 'string' ? r.data.watchCompletionRef : null))
    .filter((ref): ref is string => ref != null);
  const watchStatusByRef = await loadWatchStatuses(userUuid, matchedWatchRefs);
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
    const matchedRun = resolvedDays.get(row.date_iso)?.prescriptions
      .find((p) => p.id === row.id)?.matchedRun ?? null;
    const runData = matchedRun ? matchedRun.data : null;
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
        establishedPaceSPerMi: null,
      });
      continue;
    }

    const watchRef = runData && typeof runData.watchCompletionRef === 'string'
      ? runData.watchCompletionRef : null;
    const statusFallback = watchRef ? watchStatusByRef.get(watchRef) ?? null : null;
    const actual: ActualRead | null = runData
      ? actualStimulus(runData, planned, session, {
        vdot,
        // THRESHOLD-OWNER-1 · the SAME canonical threshold `establishedPaceFor`
        // reads three lines below, instead of `tPaceFromVdot(vdot)` inside the
        // grader. The anchors were already resolved above; the grader was
        // simply not being handed them. Null when the anchor read refused,
        // which `paceDomain`'s caller already treats as "no reclassification"
        // rather than as a domain (Rule 11).
        tPaceSecPerMi: anchors?.thresholdSecPerMi ?? null,
        watchStatusFallback: statusFallback,
      })
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
        establishedPaceSPerMi: establishedPaceFor(planned.stimulus.domain, anchors),
      });
      continue;
    }

    const ctx = executionContext({
      runData,
      watchStatusFallback: statusFallback,
      rpe: rpeByDay.get(row.date_iso) ?? null,
      replacedByRace,
      establishedPaceSPerMi: establishedPaceFor(planned.stimulus.domain, anchors),
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
      establishedPaceSPerMi: ctx.establishedPaceSPerMi ?? null,
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
