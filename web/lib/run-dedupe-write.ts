/**
 * Write-time dedupe — flags lesser-source rows as "merged into" a higher-
 * rank canonical when a duplicate-session pair exists in strava_activities.
 *
 * Mirrors what the read-edge `dedupeRunsForDisplay` grouper concludes, but
 * persists the conclusion as `data.mergedIntoId` on the lesser row so SQL
 * aggregations (weekly mileage, monthly volume, anywhere that sums
 * distance_mi server-side) can cheaply filter out the dupe without loading
 * every row into JS. Source rank: positive id (Strava, rich detail) wins
 * over negative id (watch / Apple Health synthetic canonical).
 *
 * Idempotent: re-running is a no-op when the pairing already matches. The
 * grouper at read-edge still wins for keep-separate overrides — the hint
 * here is informational, not authoritative.
 */

import { query } from './db';
import { findNearbyRunId } from './run-dedup';

/**
 * After a Strava ingest writes a new activity, scan for an existing nearby
 * run (watch / Apple Health canonical) and, if found, mark THAT row as
 * merged into the new Strava one. Race-safe: only writes when the lesser
 * row has no existing mergedIntoId. Best-effort — failures are swallowed
 * so they never break the ingest.
 *
 * Pass the canonical Strava activity id + its startLocal. userId scopes
 * the nearby search.
 */
export async function markLesserSourceAsMerged(
  userId: string,
  canonicalId: number,
  startISO: string,
): Promise<void> {
  if (!Number.isFinite(canonicalId) || canonicalId <= 0) {
    // Only run when the new canonical is Strava (positive id). A watch
    // upload would never outrank an existing Strava row.
    return;
  }
  try {
    const nearbyId = await findNearbyRunId(userId, startISO, 15);
    if (nearbyId == null || nearbyId === canonicalId) return;
    // Only fold a LESSER-source row (negative id watch/health) into the
    // new Strava canonical — never the other way. If the nearby is also
    // Strava (both positive), the grouper handles it at read-edge.
    if (nearbyId > 0) return;
    await query(
      `UPDATE strava_activities
          SET data = jsonb_set(data, '{mergedIntoId}', to_jsonb($1::BIGINT))
        WHERE id = $2::BIGINT
          AND (user_uuid = $3 OR user_uuid IS NULL)
          AND NOT (data ? 'mergedIntoId')`,
      [canonicalId, nearbyId, userId],
    );
  } catch {
    /* dedup hint is decorative; never break ingest on it */
  }
}
