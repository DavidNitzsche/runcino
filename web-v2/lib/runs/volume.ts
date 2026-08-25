/**
 * lib/runs/volume.ts · the single canonical mileage reader.
 *
 * `mileageByDay` is THE source of truth for "miles per day, deduped to one
 * row per physical run." It clusters non-merged rows by physical-run
 * identity (lib/runs/identity.ts) — the SAME logic the write-time merge
 * uses — so read-time and write-time can never disagree. Within a cluster
 * the canonical row's distance is summed once.
 *
 * Fix 3 Phase A: recentMileageMi + canonicalMileageByDay (merge.ts) are thin
 * wrappers over this. Phase B migrates the ~30 fragile mergedIntoId-only
 * sums (run-state, log-state, glance-state, …) here too.
 *
 * Replaces the prior (date, 0.1-mi-bucket) MAX heuristic, which missed
 * HK↔Strava divergent-distance dupes and over-collapsed same-distance
 * doubles. Identity clustering handles both (see identity.ts).
 */
import { pool } from '@/lib/db/pool';
import { runnerToday, runnerTimezoneOrPacific } from '@/lib/runtime/runner-tz';
import { memo } from '@/lib/runtime/request-memo';
import { clusterRuns, pickCanonical, type RunRow } from '@/lib/runs/identity';

/**
 * #4 · The ONE canonical-row predicate, shared by the volume reader and
 * pullSync's findCanonicalRow so the two paths can't disagree on what counts
 * as a "live" (non-loser) run.
 *
 * The authoritative loser marker is `data ? 'mergedIntoId'` — merge.ts always
 * sets it on the row that lost a dedup. `absorbed_into_canonical_at` is NOT a
 * reliable canonical/loser discriminator on its own: a row that lost a merge
 * then got PROMOTED back to canonical can carry a stale stamp (merge.ts:66
 * clears it on promotion, but residue exists).
 *
 * 2026-08-24 · RECOUNTED. This note used to say "verified: 1 such row in prod".
 * It is SIX, and they are not old residue — the newest is 2026-08-10:
 *
 *     2026-06-14   13.13 mi      2026-07-07    7.56 mi
 *     2026-06-19    6.45 mi      2026-07-25   18.00 mi   (the long run)
 *     2026-07-06    6.01 mi      2026-08-10    4.02 mi
 *
 * Each is the canonical row for its day, stamped absorbed, with two siblings
 * pointing mergedIntoId → it. 55.17 of this runner's 1114.72 canonical miles,
 * 6 of 149 runs. Filtering on the stamp does not shade those days down, it
 * zeroes them: every one reads 0.00 mi. `_absorption_predicate.test.ts` now
 * fails the build if a reader adds the stamp back. So the shared predicate
 * keys ONLY on mergedIntoId. (pullSync previously also filtered the stamp,
 * which made it the stricter outlier; aligning it here can only let it FIND a
 * stale-stamped canonical to write into — never pick a true loser, since true
 * losers always carry mergedIntoId.)
 *
 * Uses bare `data` (no table alias) — both call sites query `runs` unaliased.
 *
 * 2026-07-06 · P1-26 · distance-quarantined rows (data.qualityFlag =
 * 'distance_review', stamped at ingest for 50–250 mi runs · see
 * lib/runs/distance-guard.ts) are INTENTIONALLY included here. Real ultra
 * miles count toward volume even while the run awaits review; only fitness
 * anchors (VDOT candidates · lib/training/vdot-inputs.ts) exclude the flag.
 * Do not add the exclusion to this predicate.
 */
export const CANONICAL_ROW_SQL = `NOT (data ? 'mergedIntoId')`;

const distMi = (r: RunRow): number => Number(r.data?.distanceMi ?? 0);
const dayOf = (r: RunRow): string =>
  String(r.data?.date ?? String(r.data?.startLocal ?? '').slice(0, 10));

/**
 * Canonical mileage per day in [fromISO, toISO] (inclusive), one entry per
 * physical run. Non-merged rows only; clustered by identity; the canonical
 * row's distance summed once per cluster.
 */
export async function mileageByDay(
  userUuid: string,
  fromISO: string,
  toISO: string,
): Promise<Map<string, { mi: number; canonicalIds: string[] }>> {
  // 2026-08-21 perf · the FETCH is memoized for the request, the clustering
  // below is not. One render asked for this exact (user, from, to) window up
  // to 7 times; each repeat re-read and re-detoasted every run row. Callers
  // still each get their OWN Map built from the shared rows, and neither
  // clusterRuns nor pickCanonical mutates a RunRow (pickCanonical copies
  // before sorting), so sharing the fetched rows cannot alias a caller.
  const rows = await memo(
    `volume:rows:${userUuid}:${fromISO}:${toISO}`,
    async () => (await pool.query(
      `SELECT id::text AS id, user_uuid::text AS user_uuid, data
         FROM runs
        WHERE user_uuid = $1
          AND ${CANONICAL_ROW_SQL}
          AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) BETWEEN $2 AND $3`,
      [userUuid, fromISO, toISO],
    )).rows as RunRow[],
  );

  // 2026-07-06 · audit P1-51 · same runner-tz threading as the write-time
  // merge (merge.ts) — read- and write-time identity MUST use the same
  // default zone or they can disagree on what clusters. LA fallback keeps
  // null-tz profiles byte-identical to the old hardcode.
  const runnerTz = await runnerTimezoneOrPacific(userUuid);

  const byDay = new Map<string, RunRow[]>();
  for (const r of rows) {
    const day = dayOf(r);
    if (!day) continue;
    let arr = byDay.get(day);
    if (!arr) { arr = []; byDay.set(day, arr); }
    arr.push(r);
  }

  const out = new Map<string, { mi: number; canonicalIds: string[] }>();
  for (const [day, dayRows] of byDay) {
    let total = 0;
    const ids: string[] = [];
    for (const cluster of clusterRuns(dayRows, runnerTz)) {
      const { canonical } = pickCanonical(cluster);
      total += distMi(canonical);
      ids.push(canonical.id);
    }
    out.set(day, { mi: Math.round(total * 10) / 10, canonicalIds: ids });
  }
  return out;
}

/**
 * Canonical run IDs in [fromISO, toISO] — one ID per physical run, identity-
 * deduped via the SAME clustering as mileageByDay. Phase B: readers that LIST /
 * COUNT / aggregate runs filter `id = ANY(getCanonicalRunIds(...))` in place of
 * the fragile `NOT (data ? 'mergedIntoId')`, so an unflagged dupe can't inflate
 * a count, median, or sum.
 *
 * Window integrity: pass the SAME window the reader already uses. Dupes are
 * same-day (isSameRun requires equal localDay), so any day-aligned window
 * clusters each pair fully — no boundary straddle. A reader with NO date floor
 * (LIMIT-N-recent) passes an all-history range and lets its own
 * `ORDER BY … LIMIT N` window the result; after dedup the N slots fill with N
 * DISTINCT runs (intended — a dupe no longer steals a slot).
 */
export async function getCanonicalRunIds(
  userUuid: string,
  fromISO: string,
  toISO: string,
): Promise<string[]> {
  const byDay = await mileageByDay(userUuid, fromISO, toISO);
  const ids: string[] = [];
  for (const { canonicalIds } of byDay.values()) ids.push(...canonicalIds);
  return ids;
}

/** ISO date `days` before `isoDate` (noon-anchored → DST-safe). For readers
 *  whose lookback window lives in SQL, to derive the JS `from` bound for
 *  getCanonicalRunIds. `ALL_TIME` is the all-history range for LIMIT-N readers
 *  with no date floor. */
export function isoDaysBefore(isoDate: string, days: number): string {
  return new Date(Date.parse(isoDate + 'T12:00:00Z') - days * 86400000)
    .toISOString().slice(0, 10);
}
export const ALL_TIME: readonly [string, string] = ['1900-01-01', '2999-12-31'];

/**
 * Sum of the last N days of running mileage (deduped via mileageByDay).
 * Returns total miles · caller divides as needed.
 */
export async function recentMileageMi(
  userUuid: string,
  windowDays: number = 28,
): Promise<number> {
  const today = await runnerToday(userUuid);
  const fromISO = new Date(Date.parse(today + 'T12:00:00Z') - windowDays * 86400000)
    .toISOString().slice(0, 10);
  const byDay = await mileageByDay(userUuid, fromISO, today).catch(() => new Map());
  let total = 0;
  for (const { mi } of byDay.values()) total += mi;
  return Math.round(total * 10) / 10;
}

/**
 * COLD-2 (2026-08-17) · minimum OBSERVABLE history before a weekly average
 * means anything. This is a data-sufficiency rule, not a physiological one:
 * below one full week there is no week to average.
 */
export const MIN_COVERAGE_DAYS = 7;

/**
 * COLD-2 · how many of the last `windowDays` this account could possibly have
 * been running in — today minus the FIRST run we have ever seen, capped at the
 * window. Zero for an account with no runs at all.
 *
 * The distinction that matters: a runner who has been with us for a year and
 * ran nothing this month has full coverage and a real zero. A runner three days
 * old who ran every one of those days has three days of coverage and no
 * measurable weekly volume yet. Dividing both by a fixed 4 makes the second one
 * look like a collapse.
 */
export async function observableCoverageDays(
  userUuid: string,
  toISO: string,
  windowDays: number,
): Promise<number> {
  return coverageDaysFrom(await firstRunISO(userUuid), toISO, windowDays);
}

/**
 * COLD-2 · the date of the earliest run we have ever seen for this account,
 * or null for an account with no runs. One query, so a caller resolving
 * coverage at MANY dates (a niggle history walking N episodes) reads the
 * account's start once and does the arithmetic per date.
 */
export async function firstRunISO(userUuid: string): Promise<string | null> {
  // 2026-08-21 perf · depends on nothing but the user, and ran 12 times in a
  // single render (11 of them redundant). The value is a plain string, so
  // there is nothing a caller could mutate. Memo is request-scoped: an
  // account whose earliest run changes mid-request is not a real case, and
  // across requests this reads fresh every time.
  return memo(`volume:firstRun:${userUuid}`, async () => {
    const row = (await pool.query<{ first: string | null }>(
      `SELECT MIN(COALESCE(data->>'date', LEFT(data->>'startLocal', 10))) AS first
         FROM runs
        WHERE user_uuid = $1
          AND ${CANONICAL_ROW_SQL}`,
      [userUuid],
    ).catch(() => ({ rows: [] as { first: string | null }[] }))).rows[0];
    return row?.first ?? null;
  });
}

/**
 * COLD-2 · the pure half of `observableCoverageDays` · how many of the
 * `windowDays` ending at `toISO` this account could possibly have been running
 * in, given it started at `firstISO`.
 *
 * Split out so every window-coverage question in the app answers to one
 * implementation, including the ones that ask it at a historical date rather
 * than today (see `lib/coach/acwr.ts`).
 */
export function coverageDaysFrom(
  firstISO: string | null,
  toISO: string,
  windowDays: number,
): number {
  if (!firstISO) return 0;
  const days = Math.floor((Date.parse(toISO + 'T12:00:00Z') - Date.parse(firstISO + 'T12:00:00Z')) / 86400000) + 1;
  if (!Number.isFinite(days) || days <= 0) return 0;
  return Math.min(windowDays, days);
}

/**
 * COLD-2 · miles/week from a window total and the window's real coverage.
 *
 * Returns null — "we cannot say yet" — below `MIN_COVERAGE_DAYS`, rather than a
 * number deflated by the uncovered remainder. A runner one perfect week into
 * their first plan used to read `30 / 4 = 7.5 mi/wk`, a 75% collapse against a
 * 30 mi/wk authored plan, which is past the drift monitor's 40% trigger and
 * fires an unconfirmed auto-rebuild that re-authors the plan at the deflated
 * base. Three days in, the same runner read one ninth of their real volume.
 *
 * Above `MIN_COVERAGE_DAYS` the divisor is the covered weeks, so a full 28-day
 * window is byte-identical to the old `/ 4`.
 */
export function weeklyAvgFromWindow(
  totalMi: number,
  coveredDays: number,
  windowDays: number = 28,
): number | null {
  if (!(totalMi > 0)) return null;
  const covered = Math.min(coveredDays, windowDays);
  if (covered < MIN_COVERAGE_DAYS) return null;
  return Math.round((totalMi / (covered / 7)) * 10) / 10;
}

/**
 * Total miles in the last `windowDays` AND how much of that window the account
 * could have been running in. The pair callers need to compute an honest weekly
 * average · see `weeklyAvgFromWindow`.
 */
export async function recentMileageWindow(
  userUuid: string,
  windowDays: number = 28,
): Promise<{ totalMi: number; coveredDays: number }> {
  const today = await runnerToday(userUuid);
  const fromISO = new Date(Date.parse(today + 'T12:00:00Z') - windowDays * 86400000)
    .toISOString().slice(0, 10);
  // ANCHORFIT-2 (2026-08-25) · not swallowed. This is the 28-day mean every
  // pace anchor, every cold-start VDOT floor and every volume ramp reads. A
  // failed read used to answer `totalMi: 0`, which `weeklyAvgFromWindow` turns
  // into `null` — indistinguishable from "this account has never run" — and
  // from there `recentWeeklyMileage`'s `?? 0` hands the composer a zero. A
  // 45 mi/wk marathoner would be authored a cold-start block off a database
  // blip, and the drift monitor's volume axis would read a 100% shortfall
  // against the plan and fire a rebuild. Both consumers are better served by
  // a thrown error than by a fabricated zero. See lib/db/read.ts.
  const byDay = await mileageByDay(userUuid, fromISO, today);
  let total = 0;
  for (const { mi } of byDay.values()) total += mi;
  return {
    totalMi: Math.round(total * 10) / 10,
    coveredDays: await observableCoverageDays(userUuid, today, windowDays),
  };
}

/**
 * Weekly average (mi/wk) over the last 4 weeks · rounded to 0.1 mi.
 * Null when total is zero (cold-start) OR when the account has under a week of
 * observable history (COLD-2 · the average would be a fabricated collapse).
 * Used by generate / drift-monitor / adapt.
 */
export async function recentWeeklyMileageMi(
  userUuid: string,
): Promise<number | null> {
  const { totalMi, coveredDays } = await recentMileageWindow(userUuid, 28);
  return weeklyAvgFromWindow(totalMi, coveredDays, 28);
}
