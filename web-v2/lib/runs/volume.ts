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
import { runnerToday } from '@/lib/runtime/runner-tz';
import { clusterRuns, pickCanonical, type RunRow } from '@/lib/runs/identity';

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
  const rows = (await pool.query(
    `SELECT id::text AS id, user_uuid::text AS user_uuid, data
       FROM runs
      WHERE user_uuid = $1
        AND NOT (data ? 'mergedIntoId')
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) BETWEEN $2 AND $3`,
    [userUuid, fromISO, toISO],
  )).rows as RunRow[];

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
    for (const cluster of clusterRuns(dayRows)) {
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
 * Weekly average (mi/wk) over the last 4 weeks · rounded to 0.1 mi.
 * Null when total is zero (cold-start). Used by generate / drift-monitor / adapt.
 */
export async function recentWeeklyMileageMi(
  userUuid: string,
): Promise<number | null> {
  const total = await recentMileageMi(userUuid, 28);
  return total > 0 ? Math.round((total / 4) * 10) / 10 : null;
}
