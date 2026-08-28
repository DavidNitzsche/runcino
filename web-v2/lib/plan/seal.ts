/**
 * lib/plan/seal.ts · Rule 15 · completed days are immutable.
 *
 * Doctrine (designs/briefs/backend-rule-completed-days-immutable-2026-06-02.md):
 *
 *   Once a plan_workouts row has a corresponding completed run,
 *   NOTHING on that row's prescription fields may change. Type,
 *   distance, target pace, target HR, spec, sub_label, name, none
 *   of it. Plan adjustments, doctrine updates, rule-engine retroactives,
 *   rebuilds — all stop at the boundary of "did the runner complete
 *   this day."
 *
 * Why: every retro surface (post-run hero, run-detail page, badges,
 * VDOT computation) relies on "what the plan prescribed for that day
 * is fixed at the moment the runner completed it." Without sealing,
 * the badge says OFF PLAN when the runner did exactly what was asked.
 *
 * Two enforcement points:
 *
 *   1. UPDATE path (adapt.ts) · `assertDayIsMutable` is called before
 *      every UPDATE; the call site SKIPs the write on false with a
 *      [plan/seal] log line. No throw · skip + log.
 *
 *   2. REBUILD path (generate.ts persistPlan) · `getPriorPrescription`
 *      reads the prior active plan's row for the same date BEFORE
 *      archiving. The new plan's row for that date inherits the prior
 *      prescription · the new generator's freshly-composed values for
 *      completed days are DISCARDED.
 *
 * What's sealed (prescription fields):
 *   type, distance_mi, pace_target_s_per_mi, sub_label, workout_spec,
 *   is_quality, is_long, notes (when prescription-bearing).
 *
 * What's NOT sealed (structural · OK to update on rebuild):
 *   plan_id (changes by definition · new plan), week_id (new plan's
 *   week structure), dow (recomputed from date_iso), original_*
 *   columns (those track the runner's adapter history, not the
 *   prescription itself).
 *
 * What's NOT sealed (measured · always written post-hoc):
 *   none currently · the runs table holds actuals separately. If a
 *   future schema adds `actual_*` columns to plan_workouts those
 *   would be explicitly mutable.
 *
 * Cite: docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md §Rule 15
 */
import { pool } from '@/lib/db/pool';
import { rowOrNull } from '@/lib/db/read';
import { runnerTimezoneOrPacific } from '@/lib/runtime/runner-tz';
import type { PoolClient } from 'pg';

/**
 * Does a completed run exist for this user/date?
 *
 * A day becomes immutable the moment ANY of:
 *   · runs row exists for this date with no mergedIntoId
 *   · coach_intents row with reason='watch_completion' for this date
 *
 * Returns true when sealed (callers must SKIP writes), false when
 * mutable (callers may write).
 */
export async function isDaySealed(userUuid: string, dateIso: string): Promise<boolean> {
  // 2026-08-24 · swallowed-failure sweep · `$1` was bare on BOTH sides of the
  // sum. `runs.user_uuid` is `uuid` and `coach_intents.user_id::text` is text,
  // so Postgres deduced `$1` as text from the second subquery and then refused
  // the first: `operator does not exist: text = uuid`. Verified against prod on
  // 2026-08-24 — it threw for every user and every date. The `.catch` under it
  // returned `n: '0'`, so `isDaySealed` answered FALSE for every completed day
  // this app has ever had, and Rule 15 has never once held a write back.
  //
  // Both sides are pinned explicitly now: uuid where the column is uuid, text
  // where the comparison is text. A bare `$1` shared across two differently
  // typed columns is the shape to watch for.
  // runnerTimezoneOrPacific — this is the exact "coach_intents
  // watch-completion day bucketing" case that helper is named for. A
  // runner with no stored timezone is legacy single-user-era data
  // stamped in Pacific wall time, never UTC. This is the plan's own
  // write-gate (isDaySealed), so getting the fallback wrong here would
  // wrongly permit or block a plan write, not just mis-render a card.
  const sealTz = await runnerTimezoneOrPacific(userUuid).catch(() => 'America/Los_Angeles');
  const r = await rowOrNull<{ n: string }>(
    'plan/seal · isDaySealed',
    pool.query<{ n: string }>(
      `SELECT (
       (SELECT COUNT(*) FROM runs
         WHERE user_uuid = $1::uuid
           AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10))::date = $2::date
           AND NOT (data ? 'mergedIntoId'))
       + (SELECT COUNT(*) FROM coach_intents
         WHERE COALESCE(user_uuid::text, user_id::text) = $1::text
           AND reason = 'watch_completion'
           AND (ts AT TIME ZONE $3::text)::date = $2::date)
     )::text AS n`,
      [userUuid, dateIso, sealTz],
    ),
  );
  // A read that FAILED is not a day we know to be mutable. This guard exists to
  // protect a run the runner has already done; when it cannot see, it seals.
  // Refusing to write is recoverable, overwriting a completed session is not.
  if (r === null) return true;
  return Number(r?.n ?? 0) > 0;
}

/**
 * UPDATE-path guard · assert the day is mutable. Returns false when
 * sealed (call site should skip + log). Returns true when mutable.
 *
 * Convention: callers use this as `if (!await assertDayIsMutable(...))
 * { console.log('[plan/seal] skipped ...'); continue; }`.
 */
export async function assertDayIsMutable(
  userUuid: string,
  dateIso: string,
): Promise<boolean> {
  return !(await isDaySealed(userUuid, dateIso));
}

/**
 * Standard log line · use this on every skip so prod logs are
 * greppable.
 */
export function logSealSkip(
  source: string,
  userUuid: string,
  dateIso: string,
  field?: string,
): void {
  const fieldClause = field ? ` field=${field}` : '';
  console.log(
    `[plan/seal] skipped immutable day ${dateIso} · source=${source}${fieldClause} · user=${userUuid.slice(0, 8)}`,
  );
}

/**
 * Prescription snapshot · what gets preserved across a rebuild.
 * Mirrors the columns persistPlan inserts (minus structural ones).
 */
export interface SealedPrescription {
  date_iso: string;
  type: string;
  distance_mi: number;
  pace_target_s_per_mi: number | null;
  sub_label: string | null;
  workout_spec: unknown | null;
  is_quality: boolean;
  is_long: boolean;
  notes: string | null;
}

/**
 * REBUILD-path snapshot · before clearActivePlansFor archives the
 * current plan, capture the prescription values for every completed
 * day so persistPlan can overlay them onto the new plan's rows.
 *
 * Returns a Map keyed by date_iso (YYYY-MM-DD).
 *
 * 2026-06-09 · M-19 · runs on the rebuild transaction's client (passed
 * in, not the pool) so the snapshot reads the SAME still-active plan
 * the archive UPDATE that follows will touch. A query failure now
 * THROWS instead of returning an empty map — the old `.catch(() =>
 * ({ rows: [] }))` silently unsealed every completed day on a
 * transient DB error. Throwing aborts the rebuild transaction and the
 * prior plan stays active, which is the correct outcome.
 */
export async function snapshotSealedDays(
  client: PoolClient,
  userUuid: string,
): Promise<Map<string, SealedPrescription>> {
  const rows = (await client.query<{
    date_iso: string;
    type: string;
    distance_mi: string;
    pace_target_s_per_mi: string | null;
    sub_label: string | null;
    workout_spec: unknown | null;
    is_quality: boolean;
    is_long: boolean;
    notes: string | null;
  }>(
    `SELECT pw.date_iso::text AS date_iso, pw.type, pw.distance_mi::text,
            pw.pace_target_s_per_mi::text, pw.sub_label, pw.workout_spec,
            pw.is_quality, pw.is_long, pw.notes
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1
        AND tp.archived_iso IS NULL
        AND EXISTS (
          SELECT 1 FROM runs r
           WHERE r.user_uuid = $1
             AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10))::date = pw.date_iso::date
             AND NOT (r.data ? 'mergedIntoId')
        )`,
    [userUuid],
  )).rows;

  const m = new Map<string, SealedPrescription>();
  for (const r of rows) {
    m.set(r.date_iso, {
      date_iso: r.date_iso,
      type: r.type,
      distance_mi: Number(r.distance_mi),
      pace_target_s_per_mi: r.pace_target_s_per_mi != null ? Number(r.pace_target_s_per_mi) : null,
      sub_label: r.sub_label,
      workout_spec: r.workout_spec,
      is_quality: r.is_quality,
      is_long: r.is_long,
      notes: r.notes,
    });
  }
  return m;
}
