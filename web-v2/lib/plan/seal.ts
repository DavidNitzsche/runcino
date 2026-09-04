/**
 * lib/plan/seal.ts · Rule 15 · completed days are immutable — and "completed"
 * is now an EXACT-IDENTITY question, never a same-date one.
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
 * ═══════════════════════════════════════════════════════════════════════════
 * SEALING-IDENTITY-1 (2026-09-04) · what "completed this day" MEANS
 *
 * Until this fix, every function in this file sealed a plan_workouts row the
 * moment ANY unmerged run (or watch-completion) existed for its CALENDAR
 * DATE — no check that the run had anything to do with the row's own
 * prescription. That is the exact same misattribution WORKOUT-EXECUTION-ID-1
 * closed for display and EXECUTION-IDENTITY-1 closed for evidence, left open
 * in a THIRD place: a friend's unrelated 4.48mi easy run, present on the
 * calendar the same date as a 6mi hill-interval prescription, would have
 * SEALED that prescription's fields against any further write — an adapter
 * could not fix a placement error, a rebuild would freeze the interval
 * session's fields as if the runner had already run it, hours before he
 * actually did.
 *
 * David's ruling, generalised from the incident:
 *
 *   · EXACT or an accepted-unambiguous LEGACY match may seal a prescription.
 *   · SUPPLEMENTAL activity — one run, or many — may never seal one.
 *   · A partial EXACT match still seals (the runner DID execute something
 *     real against THIS prescription, and its fields must not be silently
 *     rewritten out from under him) — sealing is "protect the record of what
 *     was asked," never a claim that every phase completed. That claim lives
 *     entirely in `lib/execution/interpret.ts`'s `ExecutionRead.state`
 *     (`PARTIAL_PRODUCTIVE`, never `AS_PLANNED`, for a real partial), which
 *     this file has no opinion on and does not duplicate.
 *   · A race's warm-up/cooldown, logged as separate activities, are
 *     supplemental to the RACE prescription and cannot seal it — only an
 *     exact/legacy match to the race entry itself can.
 *   · A rescheduled prescription's OLD date carries no plan_workouts row for
 *     it once moved (the row's `date_iso` is what changed), so a run left
 *     behind on the old date has nothing there to match against and reads as
 *     supplemental for that date — this holds by construction, not by a
 *     special case, because every check here asks "does date D's OWN
 *     plan_workouts row have a match", never "did this workoutId ever match
 *     anything on any date."
 *
 * THE ONE CANONICAL ANSWER. Every sealing question in this codebase now
 * routes through `lib/execution/day-resolver.ts` — the same resolver Today,
 * Watch Today, post-run analysis and the Adaptation Engine's evidence path
 * already use to decide "did this run satisfy this prescription." Before
 * this fix there were THREE independent, mutually-agreeing-by-accident
 * definitions of "sealed" in this codebase: this file's `isDaySealed` (a
 * bare date-EXISTS join), this file's `snapshotSealedDays` (the same join,
 * separately written), and `lib/plan/adapt.ts`'s OWN `filterUnsealedWorkouts`
 * (a THIRD, independently-written copy of the identical date-EXISTS query).
 * `adapt.ts` now delegates to this file; nothing computes "sealed" any other
 * way.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two enforcement points:
 *
 *   1. UPDATE path (`lib/plan/adapt.ts`'s `filterUnsealedWorkouts`) · calls
 *      `isPrescriptionSealed` per workout id before every UPDATE; the call
 *      site SKIPs the write on true with a [plan/seal] log line. No throw ·
 *      skip + log.
 *
 *   2. REBUILD path (generate.ts persistPlan) · `snapshotSealedDays` reads
 *      the prior active plan's row for every EXACT/LEGACY-matched date
 *      BEFORE archiving. The new plan's row for that date inherits the
 *      prior prescription · the new generator's freshly-composed values for
 *      sealed days are DISCARDED.
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
import { resolveDayExecutions, resolveDateRangeExecutions } from '@/lib/execution/day-resolver';

/**
 * THE canonical sealing predicate — is this SPECIFIC prescription (one
 * plan_workouts row, by id) locked from being rewritten?
 *
 * True only when the canonical resolver finds an EXACT or unambiguous
 * LEGACY match for it. A run existing on the same calendar date — however
 * many, however large, however similar in type — is never sufficient on
 * its own; see this file's header for the incident that makes this the
 * rule rather than a refinement of it.
 *
 * A resolver read that FAILS is not a prescription we know to be mutable —
 * seal conservatively; refusing to write is recoverable, overwriting a
 * completed session is not (same posture the old date-based check took,
 * carried forward rather than loosened).
 *
 * A resolver read that SUCCEEDS but simply does not find `planWorkoutId`
 * among that date's prescriptions is a different fact, not the same one:
 * there is no row here for this (date, id) pair to protect, most commonly
 * because the prescription has since been RESCHEDULED away from `dateIso`
 * (Rule 15's own requirement — the old date must not be able to seal a
 * relationship it no longer holds). Sealing `true` here would be wrong in
 * the specific direction that matters: it would make a moved workout's old
 * date read as still-locked, which is the reschedule case David named by
 * number. This is a definite negative fact per Rule 11, not an unknown —
 * return `false`, not the resolver-failure default.
 */
export async function isPrescriptionSealed(
  userUuid: string,
  dateIso: string,
  planWorkoutId: string,
): Promise<boolean> {
  const day = await resolveDayExecutions(userUuid, dateIso).catch((err: unknown) => {
    console.warn('[plan/seal] resolver unreadable, sealing conservatively:',
      err instanceof Error ? err.message : err);
    return null;
  });
  if (day === null) return true;
  const prescription = day.prescriptions.find((p) => p.id === planWorkoutId);
  if (!prescription) return false;
  return prescription.matchedRun != null;
}

/**
 * Date-level convenience — is ANY prescription on this date already sealed?
 *
 * Used by callers that reason about a calendar date before they know (or
 * before it matters) which specific prescription lives there — e.g.
 * "can I place a rescheduled workout on this candidate date" or "has this
 * date already happened, in the sense Rule 15 cares about." A date with no
 * prescription at all, or with only unmatched/supplemental activity, is NOT
 * sealed under this definition — exactly the property the friend-run
 * incident needed and the old date-EXISTS join did not have.
 */
export async function isDaySealed(userUuid: string, dateIso: string): Promise<boolean> {
  const day = await resolveDayExecutions(userUuid, dateIso).catch((err: unknown) => {
    console.warn('[plan/seal] resolver unreadable, sealing conservatively:',
      err instanceof Error ? err.message : err);
    return null;
  });
  if (day === null) return true;
  return day.prescriptions.some((p) => p.matchedRun != null);
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
 * current plan, capture the prescription values for every EXACT/LEGACY-
 * matched day so persistPlan can overlay them onto the new plan's rows.
 *
 * Returns a Map keyed by date_iso (YYYY-MM-DD) — unchanged shape from
 * before this fix, so `persistPlan`'s per-date lookup needs no changes.
 * What changed is which dates land in the map: only ones where the
 * resolver confirms a real match, never a date that merely happens to
 * share a calendar day with an unrelated run.
 *
 * SEALING-IDENTITY-1 (2026-09-04) · also fixes a latent two-a-day
 * collision the old date-EXISTS query carried: that query's EXISTS clause
 * was scoped to the DATE only, so a completed run against ONE of two
 * same-day prescriptions made the query return BOTH rows as "sealed" —
 * the second overwrote the first in the map regardless of whether it had
 * actually happened. Per-prescription matching means only the row the
 * resolver actually confirms lands here.
 *
 * 2026-06-09 · M-19 · used to run on the rebuild transaction's client so
 * the snapshot read the SAME still-active plan the archive UPDATE that
 * follows would touch. This read happens strictly BEFORE that archive
 * statement in the same transaction — nothing here has been written yet
 * that a separate connection's READ COMMITTED read could miss — so it now
 * goes through the resolver's own pool connection rather than threading a
 * transaction client through `day-resolver.ts` and its own dependents
 * (`getCanonicalRunIds` and beneath it), which would have widened this fix
 * well past sealing. A query failure still THROWS rather than returning an
 * empty map — an unsealed rebuild on a database blip is the wrong default.
 */
export async function snapshotSealedDays(
  client: { query: typeof pool.query },
  userUuid: string,
): Promise<Map<string, SealedPrescription>> {
  const bounds = (await client.query<{ min_iso: string | null; max_iso: string | null }>(
    `SELECT MIN(pw.date_iso)::text AS min_iso, MAX(pw.date_iso)::text AS max_iso
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL`,
    [userUuid],
  )).rows[0];
  if (!bounds?.min_iso || !bounds?.max_iso) return new Map();

  const toISOExclusive = new Date(`${bounds.max_iso}T00:00:00Z`);
  toISOExclusive.setUTCDate(toISOExclusive.getUTCDate() + 1);
  const resolved = await resolveDateRangeExecutions(
    userUuid, bounds.min_iso, toISOExclusive.toISOString().slice(0, 10),
  );

  const sealedIds: string[] = [];
  for (const day of resolved.values()) {
    for (const p of day.prescriptions) {
      if (p.matchedRun != null) sealedIds.push(p.id);
    }
  }
  if (sealedIds.length === 0) return new Map();

  const rows = (await client.query<{
    id: string;
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
    `SELECT pw.id::text AS id, pw.date_iso::text AS date_iso, pw.type,
            pw.distance_mi::text, pw.pace_target_s_per_mi::text, pw.sub_label,
            pw.workout_spec, pw.is_quality, pw.is_long, pw.notes
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1
        AND tp.archived_iso IS NULL
        AND pw.id = ANY($2::text[])`,
    [userUuid, sealedIds],
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
