/**
 * Write-time dedupe — flags lesser-source rows as "merged into" a higher-
 * rank canonical when a duplicate-session pair exists in strava_activities.
 *
 * Mirrors what the read-edge `dedupeRunsForDisplay` grouper concludes, but
 * persists the conclusion as `data.mergedIntoId` on the lesser row so SQL
 * aggregations (weekly mileage, monthly volume, anywhere that sums
 * distance_mi server-side) can cheaply filter out the dupe without loading
 * every row into JS.
 *
 * Source rank (ties broken by larger distance, then longer moving time):
 *   3 — positive id Strava (rich detail, GPS, splits)
 *   2 — synthetic watch (HR + planned link)
 *   1 — synthetic Apple Health (just totals)
 *
 * Idempotent: re-running is a no-op when the pairing already matches. The
 * grouper at read-edge still wins for keep-separate overrides — the hint
 * here is informational, not authoritative.
 */

import { query } from './db';
import { findNearbyRunId } from './run-dedup';

interface RowMeta {
  id: number;
  source: string | null;
  name: string | null;
  distanceMi: number;
  movingTimeS: number;
  mergedIntoId: number | null;
}

function rank(row: RowMeta): number {
  if (row.id > 0) return 3;
  const n = (row.name || '').toLowerCase();
  const s = (row.source || '').toLowerCase();
  if (s.includes('watch') || n.includes('watch')) return 2;
  return 1; // apple_health or unknown synthetic
}

async function loadRowMeta(userId: string, id: number): Promise<RowMeta | null> {
  const rows = await query<{
    id: string; source: string | null; name: string | null;
    distance_mi: string | null; moving_s: string | null;
    merged_into: string | null;
  }>(
    `SELECT id::text AS id,
            data->>'source' AS source,
            data->>'name' AS name,
            (data->>'distanceMi')::TEXT AS distance_mi,
            (data->>'movingTimeS')::TEXT AS moving_s,
            (data->>'mergedIntoId')::TEXT AS merged_into
       FROM strava_activities
      WHERE id = $1::BIGINT
        AND (user_uuid = $2 OR user_uuid IS NULL)
      LIMIT 1`,
    [id, userId],
  ).catch(() => [] as Array<{
    id: string; source: string | null; name: string | null;
    distance_mi: string | null; moving_s: string | null;
    merged_into: string | null;
  }>);
  const r = rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    source: r.source,
    name: r.name,
    distanceMi: Number(r.distance_mi ?? 0) || 0,
    movingTimeS: Number(r.moving_s ?? 0) || 0,
    mergedIntoId: r.merged_into ? Number(r.merged_into) : null,
  };
}

/** Pick the canonical of two rows: higher source rank wins; on a tie pick
 *  the one with larger distance, then longer moving time, then the
 *  positive (Strava) id (stable). */
function pickCanonical(a: RowMeta, b: RowMeta): { canonical: RowMeta; lesser: RowMeta } {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra > rb ? { canonical: a, lesser: b } : { canonical: b, lesser: a };
  // Same rank — pick by data quality, then by id sign as tiebreak.
  if (a.distanceMi !== b.distanceMi) {
    return a.distanceMi > b.distanceMi ? { canonical: a, lesser: b } : { canonical: b, lesser: a };
  }
  if (a.movingTimeS !== b.movingTimeS) {
    return a.movingTimeS > b.movingTimeS ? { canonical: a, lesser: b } : { canonical: b, lesser: a };
  }
  // Final tiebreak: positive (Strava) id wins over negative (synthetic),
  // then smaller absolute id.
  if (a.id > 0 && b.id < 0) return { canonical: a, lesser: b };
  if (b.id > 0 && a.id < 0) return { canonical: b, lesser: a };
  return Math.abs(a.id) <= Math.abs(b.id) ? { canonical: a, lesser: b } : { canonical: b, lesser: a };
}

/**
 * After a new activity row lands (Strava sync OR canonical watch/AH upsert),
 * scan for an existing nearby session and, if found, fold the lesser-source
 * row into the higher-rank canonical via `mergedIntoId`.
 *
 * Bidirectional: handles "Strava arrives, AH already present" AND "AH/watch
 * arrives, Strava already present" AND "two Strava ids 5 sec apart" (Jan 2
 * case — same-rank tie broken by distance then moving time).
 *
 * Race-safe: only writes when the lesser row has no existing mergedIntoId.
 * Best-effort — failures are swallowed so they never break the ingest.
 */
export async function markLesserSourceAsMerged(
  userId: string,
  newRowId: number,
  startISO: string,
): Promise<void> {
  if (!Number.isFinite(newRowId)) return;
  try {
    const nearbyId = await findNearbyRunId(userId, startISO, 15);
    if (nearbyId == null || nearbyId === newRowId) return;
    const [newRow, nearbyRow] = await Promise.all([
      loadRowMeta(userId, newRowId),
      loadRowMeta(userId, nearbyId),
    ]);
    if (!newRow || !nearbyRow) return;
    // If the nearby is already merged into the same target the new row
    // would consolidate into, nothing to do. Likewise if the new row is
    // already merged into nearby (or vice versa).
    if (nearbyRow.mergedIntoId === newRow.id) return;
    if (newRow.mergedIntoId === nearbyRow.id) return;

    const { canonical, lesser } = pickCanonical(newRow, nearbyRow);
    if (lesser.mergedIntoId === canonical.id) return; // already pointing the right way
    await query(
      `UPDATE strava_activities
          SET data = jsonb_set(data, '{mergedIntoId}', to_jsonb($1::BIGINT))
        WHERE id = $2::BIGINT
          AND (user_uuid = $3 OR user_uuid IS NULL)
          AND NOT (data ? 'mergedIntoId')`,
      [canonical.id, lesser.id, userId],
    );
  } catch {
    /* dedup hint is decorative; never break ingest on it */
  }
}
