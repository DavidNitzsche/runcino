/**
 * lib/execution/day-resolver.ts · the ONE place that decides which run
 * satisfies which prescription.
 *
 * WORKOUT-EXECUTION-ID-1 (2026-09-03). Found live, on David's own phone: an
 * unrelated 4.48mi easy run with a friend, synced from Apple Workouts, was
 * rendered as `INTERVALS · done` — complete with rep-grading prose ("Reps
 * done") — over a 6mi hill-interval session he had not yet gone out to run.
 *
 * The prior fix (TWO-RUNS-ONE-DAY-1, same day) reordered which run wins a
 * tie when several exist, preferring one carrying `plannedWorkoutType`. It
 * did not hold, because it never addressed the real defect: SAME DATE was
 * still being read as sufficient evidence that a run completes a
 * prescription. When only one run exists that day — the overwhelmingly
 * common case — the tie-break never even runs, and "the only run of the
 * day" is not identity. David's own ruling, verbatim:
 *
 *   "A completed activity may satisfy a prescribed workout only when there
 *    is an exact, durable association between them." Same calendar date,
 *    largest run of the day, only run of the day, similar distance, workout
 *    type alone, and the mere existence of a scheduled workout that day are
 *    all named EXPLICITLY INSUFFICIENT.
 *
 * ## The two tiers of evidence this file trusts
 *
 *   EXACT   — `data.planWorkoutId` equals the prescription's own
 *             `plan_workouts.id`. Stamped by `/api/watch/workouts/complete`
 *             at the moment a run the app itself tracked (watch, phone GPS,
 *             or treadmill) is written — the one write path that resolves a
 *             specific `plan_workouts` row and can carry its id forward.
 *             This is a durable, row-to-row link: once stamped it never has
 *             to be re-derived from type or distance again.
 *
 *   LEGACY  — `data.workoutType` (with `data.workoutTypeSource === 'plan'`)
 *             matches the prescription's `type`, with NO `planWorkoutId`
 *             (pre-WORKOUT-EXECUTION-ID-1 rows, or a completion whose
 *             distance missed the ±30% sanity band the completion route
 *             uses to pick a day). NOT `data.plannedWorkoutType` — that key
 *             looks like the right field and is the one the prior,
 *             non-holding fix read, but it is populated on 1 of this
 *             runner's 276 rows; the completion route has only ever written
 *             the semantically identical value into `workoutType` /
 *             `workoutTypeSource`. Explicit, conservative fallback: usable
 *             only when the day carries exactly ONE prescription of that
 *             type, so two same-type sessions in one day can never be
 *             resolved by type alone — Rule 16 read onto identity: one
 *             quantity (this execution's association) needs one name, and a
 *             tie is not a name.
 *
 * A run with NEITHER is SUPPLEMENTAL, full stop, regardless of whether it is
 * the day's biggest, smallest, or only run. Supplemental is not a lesser
 * grade of completion — it is a different fact: a real run that happened,
 * that counts toward mileage and training load, and that never seals,
 * completes, or grades a prescription it was not shown to have executed.
 *
 * Every surface that has to answer "what did the runner do today, and did it
 * complete what was asked" calls THIS. No other surface re-derives the
 * question independently — that was the exact shape of the defect this file
 * closes.
 */

import { pool } from '@/lib/db/pool';
import { getCanonicalRunIds } from '@/lib/runs/volume';
import { ownedDaysSql } from '@/lib/plan/owned-days';
import {
  runDaySql,
  runNotMergedSql,
  asRunData,
  type RunData,
} from '@/lib/runs/run-shape';

export type ExecutionMatch = 'exact' | 'legacy_type' | 'supplemental';

export interface ResolvedRun {
  runId: string;
  data: RunData;
  /** The `runs.shoe_id` column — not part of `data`, carried separately so a
   *  caller using the resolver's matched run doesn't have to re-query it. */
  shoeId: number | null;
  distanceMi: number | null;
  match: ExecutionMatch;
  /** The `plan_workouts.id` this run satisfies, or null when supplemental. */
  matchedWorkoutId: string | null;
}

export interface PrescribedWorkout {
  id: string;
  type: string;
  distanceMi: number | null;
  subLabel: string | null;
  isQuality: boolean;
  isLong: boolean;
  /** Null when nothing has satisfied this prescription yet — it is still
   *  upcoming/incomplete, however many OTHER runs exist that date. */
  matchedRun: ResolvedRun | null;
}

export interface ResolvedDay {
  dateISO: string;
  /** Every non-rest workout the active plan asked for on this date. Usually
   *  one row; can be more than one on a two-a-day. */
  prescriptions: PrescribedWorkout[];
  /** Every canonical run this date that did not satisfy any prescription. A
   *  real run, real training, real mileage — never a completion. */
  supplementalRuns: ResolvedRun[];
}

/** Same normalisation the completion route already applies when it stamps
 *  `plannedWorkoutType` (`race_week_tuneup` reads as the T-effort it is) —
 *  reused here rather than re-derived, so a type comparison never disagrees
 *  with the comparison that produced the stamp in the first place. */
function normType(t: string): string {
  return t === 'race_week_tuneup' ? 'threshold' : t;
}

function richer(a: ResolvedRun, b: ResolvedRun): ResolvedRun {
  const aPhases = Array.isArray(a.data.phases) ? a.data.phases.length : 0;
  const bPhases = Array.isArray(b.data.phases) ? b.data.phases.length : 0;
  if (aPhases !== bPhases) return aPhases > bPhases ? a : b;
  const aSplits = Array.isArray(a.data.splits) ? a.data.splits.length : 0;
  const bSplits = Array.isArray(b.data.splits) ? b.data.splits.length : 0;
  if (aSplits !== bSplits) return aSplits > bSplits ? a : b;
  return (a.distanceMi ?? 0) >= (b.distanceMi ?? 0) ? a : b;
}

function pickRichest(runs: ResolvedRun[]): ResolvedRun | null {
  if (runs.length === 0) return null;
  return runs.reduce(richer);
}

function nextDayISO(dateISO: string): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

interface PrescribedRow {
  id: string;
  date_iso: string;
  type: string;
  distance_mi: string | null;
  sub_label: string | null;
  is_quality: boolean | null;
  is_long: boolean | null;
}

interface RunRow {
  id: string;
  day: string;
  data: unknown;
  shoe_id: number | null;
}

/**
 * Classify one day's already-fetched rows. Pure — no I/O — so both the
 * single-day and date-range entry points below share exactly one
 * implementation of the EXACT/LEGACY/SUPPLEMENTAL rule rather than risking
 * two copies drifting apart.
 */
function classifyDay(
  dateISO: string,
  prescribedRows: PrescribedRow[],
  runRows: RunRow[],
): ResolvedDay {
  const resolvedRuns: ResolvedRun[] = runRows.map((r) => {
    const data = asRunData(r.data);
    const planWorkoutId = typeof data.planWorkoutId === 'string' && data.planWorkoutId !== ''
      ? data.planWorkoutId : null;
    return {
      runId: r.id,
      data,
      shoeId: r.shoe_id ?? null,
      distanceMi: typeof data.distanceMi === 'number' ? data.distanceMi : null,
      // Provisional — refined below once we know which ids the day's
      // prescriptions actually carry. `exact` here is a CANDIDATE, not yet
      // confirmed against a real prescription (a stale id from a plan that
      // has since been rebuilt must not count).
      match: 'supplemental',
      matchedWorkoutId: planWorkoutId,
    };
  });

  const prescriptions: PrescribedWorkout[] = [];
  const claimed = new Set<string>();

  // Pass 1 · EXACT. A run's stamped id must equal a real prescription's id
  // TODAY — a run stamped against a workout id from a plan version that has
  // since been rebuilt is not evidence of anything (Rule 10: a persisted
  // derived value is recomputed or refused, never trusted stale).
  for (const p of prescribedRows) {
    const exactRuns = resolvedRuns.filter(
      (r) => !claimed.has(r.runId) && r.matchedWorkoutId === p.id,
    );
    const best = pickRichest(exactRuns);
    if (best) {
      best.match = 'exact';
      claimed.add(best.runId);
    }
    prescriptions.push({
      id: p.id,
      type: p.type,
      distanceMi: p.distance_mi == null ? null : Number(p.distance_mi),
      subLabel: p.sub_label ?? null,
      isQuality: p.is_quality === true,
      isLong: p.is_long === true,
      matchedRun: best,
    });
  }

  // Pass 2 · LEGACY TYPE, conservative. Only when this date carries exactly
  // ONE prescription of the type in question — two prescribed sessions of
  // the same type on one day can never be told apart by type alone, and
  // guessing would be exactly the "ordering decides association" failure
  // David's ruling forbids. Runs already exact-claimed are excluded so the
  // same physical run cannot satisfy two prescriptions.
  const typeCounts = new Map<string, number>();
  for (const p of prescribedRows) {
    const t = normType(p.type);
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }
  for (const entry of prescriptions) {
    if (entry.matchedRun) continue; // already exact
    const t = normType(entry.type);
    if ((typeCounts.get(t) ?? 0) !== 1) continue; // ambiguous, refuse
    const legacyRuns = resolvedRuns.filter((r) => {
      if (claimed.has(r.runId)) return false;
      // A run that carries a planWorkoutId, even a stale/foreign one, has
      // already declared an exact opinion about which prescription it
      // executed — it does not fall back to a type guess that might name a
      // DIFFERENT prescription than the one it actually claimed.
      if (r.matchedWorkoutId) return false;
      /* LIVE-TRACKED SOURCES ONLY. Found live, 2026-09-03: the friend's
       * unrelated 4.48mi run — `source: 'apple_watch'`, a passive HealthKit
       * sync — already carried `workoutType: 'intervals'` /
       * `workoutTypeSource: 'plan'`, stamped by `/api/ingest/workout`'s OWN
       * independent date + ±30%-distance heuristic (the "EXACT mirror" of
       * the completion route's stamp, per that file's own comment) —
       * completely apart from whether the run had anything to do with the
       * prescription. Trusting `workoutTypeSource === 'plan'` alone would
       * have let this exact defect back in through the "legacy" door this
       * same fix was meant to close: a run's type STILL would have decided
       * association, exactly what David's ruling forbids.
       *
       * `/api/watch/workouts/complete` (the app's own live tracker — watch,
       * treadmill, or the phone's own GPS recorder) is the one write path
       * this file trusts for ANY type-based evidence, live or legacy,
       * because starting a session through the app is itself a declaration
       * of intent to run whatever the app loaded, at the moment the runner
       * pressed start — categorically different from a passive sync's
       * after-the-fact guess from date and distance alone. A run synced from
       * Apple Workouts, Strava, or manual entry never qualifies here, no
       * matter what its stamped `workoutType` says. */
      const LIVE_TRACKED_SOURCES = new Set(['watch', 'treadmill', 'phone']);
      const source = typeof r.data.source === 'string' ? r.data.source : null;
      if (source == null || !LIVE_TRACKED_SOURCES.has(source)) return false;
      if (r.data.workoutTypeSource !== 'plan') return false;
      const plannedType = typeof r.data.workoutType === 'string'
        ? r.data.workoutType : null;
      return plannedType != null && normType(plannedType) === t;
    });
    const best = pickRichest(legacyRuns);
    if (best) {
      best.match = 'legacy_type';
      best.matchedWorkoutId = entry.id;
      claimed.add(best.runId);
      entry.matchedRun = best;
    }
  }

  const supplementalRuns = resolvedRuns.filter((r) => !claimed.has(r.runId))
    .map((r) => ({ ...r, match: 'supplemental' as const, matchedWorkoutId: null }));

  return { dateISO, prescriptions, supplementalRuns };
}

/**
 * Resolve every prescription and every run across `[fromISO, toISO)` in a
 * FIXED number of queries — one for every prescription in range, one for
 * canonical run ids, one for the run rows themselves — rather than one round
 * trip per day. `lib/execution/load.ts` walks ranges of weeks to a season;
 * the single-day entry point below is built on top of this rather than the
 * reverse, so a multi-day caller never pays for N separate resolutions of
 * the same rule.
 *
 * Reads the prescription side through `ownedDaysSql`, same reign-aware
 * ownership `resolveDayExecutions`'s doc comment explains — required here
 * more than anywhere else, since an evidence/adaptation walk is exactly the
 * caller that routinely crosses a plan rollover.
 */
export async function resolveDateRangeExecutions(
  userUuid: string,
  fromISO: string,
  toISO: string,
): Promise<Map<string, ResolvedDay>> {
  const prescribedRows = (await pool.query<PrescribedRow>(
    `WITH owned AS (${ownedDaysSql({
      columns: 'pw.id, pw.date_iso, pw.type, pw.distance_mi::text, pw.sub_label, pw.is_quality, pw.is_long',
    })})
     SELECT * FROM owned WHERE owned.type <> 'rest' ORDER BY owned.date_iso, owned.id`,
    [userUuid, fromISO, toISO],
  )).rows;

  const canonicalIds = await getCanonicalRunIds(userUuid, fromISO, toISO)
    .catch((err: unknown) => {
      console.warn('[day-resolver] canonical run ids unreadable:',
        err instanceof Error ? err.message : err);
      return [] as string[];
    });

  const runRows = canonicalIds.length === 0 ? [] : (await pool.query<RunRow>(
    `SELECT id::text AS id, ${runDaySql('r')} AS day, r.data, r.shoe_id
       FROM runs r
      WHERE r.user_uuid = $1
        AND ${runNotMergedSql('r')}
        AND ${runDaySql('r')} >= $2 AND ${runDaySql('r')} < $3
        AND r.id::text = ANY($4::text[])
      ORDER BY day, id`,
    [userUuid, fromISO, toISO, canonicalIds],
  )).rows;

  const prescribedByDay = new Map<string, PrescribedRow[]>();
  for (const p of prescribedRows) {
    const arr = prescribedByDay.get(p.date_iso) ?? [];
    arr.push(p);
    prescribedByDay.set(p.date_iso, arr);
  }
  const runsByDay = new Map<string, RunRow[]>();
  for (const r of runRows) {
    const arr = runsByDay.get(r.day) ?? [];
    arr.push(r);
    runsByDay.set(r.day, arr);
  }

  const allDays = new Set<string>([...prescribedByDay.keys(), ...runsByDay.keys()]);
  const out = new Map<string, ResolvedDay>();
  for (const day of allDays) {
    out.set(day, classifyDay(day, prescribedByDay.get(day) ?? [], runsByDay.get(day) ?? []));
  }
  return out;
}

/**
 * Resolve every prescription and every run for one runner-local calendar
 * date, with an explicit, evidence-graded association between them.
 *
 * This never mutates anything — it is a read, same posture as
 * `loadKeySessionExecutions` in `lib/execution/load.ts`. Callers that need to
 * SEAL a day or mark a workout complete do so off `matchedRun`, not off this
 * function reaching into `plan_workouts` itself (Rule 14: this file states
 * its scope, it does not also own writes).
 */
export async function resolveDayExecutions(
  userUuid: string,
  dateISO: string,
): Promise<ResolvedDay> {
  const map = await resolveDateRangeExecutions(userUuid, dateISO, nextDayISO(dateISO));
  return map.get(dateISO) ?? { dateISO, prescriptions: [], supplementalRuns: [] };
}

/** Convenience for a caller that only wants one prescription's own state —
 *  e.g. Today, which shows the day's key session. Null when the date carries
 *  no non-rest prescription at all. */
export function primaryPrescription(day: ResolvedDay): PrescribedWorkout | null {
  // Quality first, then the earliest-declared row — matches how `ownedDaysSql`
  // callers already treat a two-a-day (the quality session is the one that
  // drives the day's hero state; a supporting shakeout does not).
  const quality = day.prescriptions.find((p) => p.isQuality);
  return quality ?? day.prescriptions[0] ?? null;
}
