/**
 * lib/execution/day-resolution.ts · Finding 3 (`docs/audit-2026-09-11-
 * session-handback.md` §5) · the ONE place that answers "what actually
 * happened to this day's prescription" as one of five distinguishable facts:
 *
 *   completed    · a canonical run satisfies the prescription
 *                  (`day-resolver.ts`'s EXACT or LEGACY tier).
 *   moved        · a `plan_reschedules` decision relocated this prescription
 *                  to another date (Move-a-Run, `lib/plan/reschedule.ts`).
 *   skipped      · an explicit runner declaration exists in `day_actions`
 *                  (`POST /api/today/skip`).
 *   missed       · past the sync-grace boundary, no completion, no move, no
 *                  skip, and no run at all that date.
 *   supplemental · past the sync-grace boundary, no completion, no move, no
 *                  skip, but a real run exists that date and does not
 *                  satisfy the prescription (day-resolver's SUPPLEMENTAL
 *                  tier, or a WATCHMATCH-1 ambiguity refusal that left the
 *                  run unstamped). Distinct from `missed` on purpose — an
 *                  activity happened, and treating it as either "done" or
 *                  "nothing happened" would both be wrong (Rule 11).
 *
 * This is a WIRING layer, not a new identity mechanism. Every fact above is
 * read from infrastructure that already exists and is already
 * production-proven — `day-resolver.ts` (hardened by the just-merged
 * `fix/execution-identity-watch-matcher`), `plan_reschedules` (Move-a-Run's
 * own ledger), and `day_actions` (the existing skip mechanism, extended to
 * arbitrary past days as of SKIPOWNER-1 — `isDaySkipped`/`loadSkippedDates`
 * already take an explicit `dateIso`, not just "today"). Nothing here
 * re-derives a match, re-implements a reschedule, or re-decides what counts
 * as a skip.
 *
 * ── THE DATE BOUNDARY AND GRACE PERIOD ─────────────────────────────────────
 *
 * See `docs/design/missed-state-boundary-2026-09-11.md` for the full
 * reasoning. Summary: "past" is `dateISO < runnerToday(userUuid)` — the same
 * comparison `week-loader.ts`'s `is_past` and every other "today" caller in
 * this app already makes, via the ONE canonical `runnerToday()` resolver
 * (Rule 16 — no second definition of "today"). A past day does not resolve
 * to `missed`/`supplemental` until `MISSED_GRACE_HOURS` past the START of
 * the FOLLOWING runner-local calendar day, so a late-night run that has not
 * yet synced does not flash "missed" before flipping back. `completed`,
 * `moved` and `skipped` are never grace-gated — they are affirmative facts
 * and resolve the instant they are true, including for a day that has not
 * happened yet.
 *
 * `missed`/`supplemental`/`completed`/`moved` are never persisted. Every
 * call recomputes from the live tables, so a late sync, a later move, or an
 * undo all take effect on the very next read with nothing to un-stick
 * (Rule 10 — no frozen derived verdict to go stale).
 */

import { pool } from '@/lib/db/pool';
import { runnerTimezone } from '@/lib/runtime/runner-tz';
import { loadSkippedDates } from '@/lib/plan/week-loader';
import {
  resolveDateRangeExecutions,
  primaryPrescription,
  type ResolvedDay,
  type ExecutionMatch,
} from './day-resolver';

/** See `docs/design/missed-state-boundary-2026-09-11.md` — an engineering
 *  default sized against HealthKit background-sync latency, not a doctrine
 *  citation. Named and single-owner so a future change is one line, not a
 *  hunt. */
export const MISSED_GRACE_HOURS = 6;

export type DayResolution = 'completed' | 'moved' | 'skipped' | 'missed' | 'supplemental';

export interface DayResolutionDetail {
  /**
   * `null` when there is nothing to resolve yet — no non-rest prescription
   * that date, or a prescription that is still live (not past, or past but
   * inside the sync-grace window). A `null` here means "render this day as a
   * normal, still-open prescription," not "we don't know."
   */
  resolution: DayResolution | null;
  /** `moved` only — where the prescription actually landed. */
  movedToISO?: string;
  /** `completed` only — which evidence tier matched, for a detail view that
   *  wants to say so (e.g. a legacy-type match reads slightly less certain
   *  than an exact id match). */
  matchTier?: Extract<ExecutionMatch, 'exact' | 'legacy_type'>;
  /** `supplemental` only — the run ids that exist but do not satisfy the
   *  prescription, so a future manual-resolution UI (WATCHMATCH-1's own
   *  header names this as not yet built) has something to point at rather
   *  than re-deriving the ambiguity from scratch. */
  supplementalRunIds?: string[];
}

const UNRESOLVED: DayResolutionDetail = { resolution: null };

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD HH:mm:ss` in `tz`'s wall clock — lexicographically comparable
 *  to another string in the same shape, which is all `missedGraceElapsed`
 *  needs. Deliberately not doing UTC-offset arithmetic: this app's other
 *  "today" resolvers (`runnerToday`) use the same `Intl.DateTimeFormat`
 *  wall-clock-read approach rather than a timezone-math library. */
function localClockKey(tz: string, at: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  // Some ICU builds emit "24" for local midnight under hour12:false —
  // normalise so the string stays lexicographically ordered.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')}`;
}

/**
 * True once `dateISO` is far enough past that silence should read as
 * `missed`/`supplemental` rather than "still live." Exported and pure (takes
 * `now` explicitly) so `_day_resolution_boundary.test.ts` can walk the
 * boundary in small increments per Rule 9, with no clock or database.
 */
export function missedGraceElapsed(dateISO: string, tz: string, now: Date): boolean {
  const boundary = `${addDaysISO(dateISO, 1)} ${String(MISSED_GRACE_HOURS).padStart(2, '0')}:00:00`;
  return localClockKey(tz, now) >= boundary;
}

/** One `plan_reschedules` row naming this date as the ORIGINAL date of a
 *  still-live move — the mirror image of `classify-evidence.ts`'s
 *  `loadRescheduleRows` (which reads by `new_date_iso`, the landing date).
 *  Same table, same `undone_at IS NULL` filter, same NOT_DEPLOYED posture:
 *  an undeployed table reads as "nothing moved" here specifically because
 *  `plan_workouts` itself still carries the day as a live prescription
 *  before this table exists, so falling through to the normal resolver is
 *  the honest answer, not a guess.
 *
 *  EXPORTED (SNAPSHOT-RESOLUTION-1, 2026-09-11 follow-up) so
 *  `lib/plan/plan-snapshot.ts` can feed the SAME `resolveOneDay` this file's
 *  own `resolveDateRangeDayStatus` uses, rather than re-deriving "was this
 *  date moved away" a second way for the offline/snapshot path — Rule 16,
 *  one owner. */
export async function loadMovedAwayRows(
  userUuid: string,
  fromISO: string,
  toISOExclusive: string,
): Promise<Map<string, string> | null> {
  try {
    const r = await pool.query<{ original_date_iso: string; new_date_iso: string }>(
      `SELECT DISTINCT ON (original_date_iso) original_date_iso, new_date_iso
         FROM plan_reschedules
        WHERE user_uuid = $1::uuid
          AND original_date_iso >= $2 AND original_date_iso < $3
          AND undone_at IS NULL
        ORDER BY original_date_iso, decided_at DESC`,
      [userUuid, fromISO, toISOExclusive],
    );
    const out = new Map<string, string>();
    for (const row of r.rows) out.set(row.original_date_iso, row.new_date_iso);
    return out;
  } catch (e) {
    if (/relation .*plan_reschedules.* does not exist/i.test(String((e as Error)?.message ?? ''))) {
      return null;
    }
    throw e;
  }
}

/**
 * Classify one already-fetched date. Pure — no I/O — mirroring
 * `day-resolver.ts`'s own `classifyDay`: EXPORTED so falsification tests can
 * drive every branch directly rather than only through a live database.
 * `resolveDateRangeDayStatus` below is the only production caller.
 */
export function resolveOneDay(
  resolvedDay: ResolvedDay | undefined,
  movedTo: string | undefined,
  skipped: boolean,
  skipReadFailed: boolean,
  graceElapsed: boolean,
): DayResolutionDetail {
  // MOVED IS CHECKED FIRST, AHEAD OF THE PRESCRIPTION LOOKUP.
  //
  // `applyReschedule`'s own edit set (`reschedule.ts`'s `restOn()`) rewrites
  // the ORIGINAL date's `plan_workouts` row to `type: 'rest'` as part of the
  // move — correct for "what does this date prescribe now" (nothing), but
  // that also means `day-resolver.ts`'s `ownedDaysSql` (which filters
  // `type <> 'rest'`) will never return a prescription for this date again.
  // Falling through to the primary-prescription check below would read that
  // absence as "nothing was ever asked here" and lose the move entirely —
  // exactly the failure this whole feature exists to close. `plan_reschedules
  // .original_date_iso` is the durable record that survives the rewrite.
  if (movedTo != null) return { resolution: 'moved', movedToISO: movedTo };

  const primary = resolvedDay ? primaryPrescription(resolvedDay) : null;
  if (primary == null) return UNRESOLVED; // rest day / nothing prescribed — no fact to report

  if (primary.matchedRun != null) {
    const tier = primary.matchedRun.match;
    return {
      resolution: 'completed',
      ...(tier === 'exact' || tier === 'legacy_type' ? { matchTier: tier } : {}),
    };
  }

  // Rule 11 · a failed skip read must never silently fall through to
  // "missed" — that would be exactly the swallowed-failure shape CLAUDE.md's
  // Rule 11 names (a read we could not do is not evidence nothing happened).
  if (skipReadFailed) return UNRESOLVED;
  if (skipped) return { resolution: 'skipped' };

  if (!graceElapsed) return UNRESOLVED;

  const supplementalRunIds = (resolvedDay?.supplementalRuns ?? []).map((r) => r.runId);
  if (supplementalRunIds.length > 0) return { resolution: 'supplemental', supplementalRunIds };
  return { resolution: 'missed' };
}

/**
 * Resolve every date in `[fromISO, toISOExclusive)` in a fixed number of
 * queries — the week-strip's shape, so paging a week never costs more than
 * paging a single day. `now` is injectable for tests; production callers
 * omit it.
 */
export async function resolveDateRangeDayStatus(
  userUuid: string,
  fromISO: string,
  toISOExclusive: string,
  now: Date = new Date(),
): Promise<Map<string, DayResolutionDetail>> {
  const [resolvedDays, movedAway, skipRead, tz] = await Promise.all([
    resolveDateRangeExecutions(userUuid, fromISO, toISOExclusive),
    loadMovedAwayRows(userUuid, fromISO, toISOExclusive),
    // `loadSkippedDates` takes an INCLUSIVE end; the range here is exclusive,
    // so the day immediately before `toISOExclusive` is the last one to ask
    // about.
    loadSkippedDates(userUuid, fromISO, addDaysISO(toISOExclusive, -1)),
    runnerTimezone(userUuid),
  ]);

  const out = new Map<string, DayResolutionDetail>();
  const allDates = new Set<string>([
    ...resolvedDays.keys(),
    ...(movedAway ? movedAway.keys() : []),
    ...skipRead.skippedDates,
  ]);
  for (const dateISO of allDates) {
    out.set(dateISO, resolveOneDay(
      resolvedDays.get(dateISO),
      movedAway?.get(dateISO),
      skipRead.skippedDates.has(dateISO),
      skipRead.failed,
      missedGraceElapsed(dateISO, tz, now),
    ));
  }
  return out;
}

/**
 * One date's resolution. Convenience for a caller that only needs the past-
 * day hero, not a whole week strip — built on the range function above so
 * there is exactly one implementation of the rule (mirrors
 * `day-resolver.ts`'s own `resolveDayExecutions`/`resolveDateRangeExecutions`
 * split).
 */
export async function resolveDayStatus(
  userUuid: string,
  dateISO: string,
  now: Date = new Date(),
): Promise<DayResolutionDetail> {
  const nextDayISO = addDaysISO(dateISO, 1);
  const map = await resolveDateRangeDayStatus(userUuid, dateISO, nextDayISO, now);
  return map.get(dateISO) ?? UNRESOLVED;
}
