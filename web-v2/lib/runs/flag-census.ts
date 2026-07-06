/**
 * lib/runs/flag-census.ts · count the LOAD-BEARING dedup flags.
 *
 * 2026-06-09 state-audit Tier 2.3 · a `mergedIntoId` flag is
 * load-bearing when identity clustering would NOT re-merge the pair if
 * the flag vanished (isSameRun(flagged, canonical) === false — legacy
 * Z-convention timestamps, null-source rows). For David that is 8 rows
 * carrying 49.6 mi of would-be double-count, all outside the dedupe
 * cron's 14-day repair window: the flag bytes are the ONLY protection.
 *
 * The census is the tripwire. Computed nightly per user by
 * /api/cron/dedupe-runs; a DROP against the previous census (a
 * load-bearing flag was wiped — the Cluster-1b full-replace class)
 * raises an ops alert the same night, instead of volume silently
 * jumping 25-50 mi and TSB lying for weeks.
 *
 * Same isSameRun the merge + volume readers use — write-time,
 * read-time, and tripwire can never disagree about what a flag is
 * worth.
 */
import { pool } from '@/lib/db/pool';
import { runnerTimezoneOrPacific } from '@/lib/runtime/runner-tz';
import { isSameRun, type RunRow } from '@/lib/runs/identity';

export interface FlagCensus {
  userUuid: string;
  /** Rows carrying mergedIntoId. */
  flaggedTotal: number;
  /** Flags whose pair would NOT re-cluster · the flag is the protection. */
  loadBearing: number;
  /** Miles that would double-count if the load-bearing flags vanished. */
  loadBearingMi: number;
  /** The load-bearing row ids · stable identity for diffing censuses. */
  loadBearingIds: string[];
}

export async function computeFlagCensus(userUuid: string): Promise<FlagCensus> {
  // Bounded: flagged rows + their canonical partners only — never the
  // whole history.
  const flagged = (await pool.query(
    `SELECT id::text AS id, user_uuid::text AS user_uuid, data
       FROM runs
      WHERE user_uuid = $1::uuid AND data ? 'mergedIntoId'`,
    [userUuid],
  )).rows as RunRow[];

  if (flagged.length === 0) {
    return { userUuid, flaggedTotal: 0, loadBearing: 0, loadBearingMi: 0, loadBearingIds: [] };
  }

  const canonicalIds = [...new Set(
    flagged.map((f) => String(f.data?.mergedIntoId ?? '')).filter(Boolean),
  )];
  const canonicalRows = (await pool.query(
    `SELECT id::text AS id, user_uuid::text AS user_uuid, data
       FROM runs
      WHERE user_uuid = $1::uuid AND id = ANY($2::bigint[])`,
    [userUuid, canonicalIds],
  ).catch(() => ({ rows: [] as RunRow[] }))).rows as RunRow[];
  const byId = new Map(canonicalRows.map((r) => [String(r.id), r]));

  // 2026-07-06 · audit P1-51 · same runner-tz threading as merge.ts /
  // volume.ts, so the tripwire values a flag exactly the way the merge
  // and the volume reader would re-derive it.
  const runnerTz = await runnerTimezoneOrPacific(userUuid);

  const loadBearingIds: string[] = [];
  let loadBearingMi = 0;
  for (const f of flagged) {
    const canonical = byId.get(String(f.data?.mergedIntoId ?? ''));
    // Canonical row missing entirely → the flag is all that hides this
    // row · count it load-bearing.
    if (!canonical || !isSameRun(f, canonical, runnerTz)) {
      loadBearingIds.push(String(f.id));
      loadBearingMi += Number(f.data?.distanceMi ?? 0);
    }
  }

  return {
    userUuid,
    flaggedTotal: flagged.length,
    loadBearing: loadBearingIds.length,
    loadBearingMi: Math.round(loadBearingMi * 10) / 10,
    loadBearingIds: loadBearingIds.sort(),
  };
}
