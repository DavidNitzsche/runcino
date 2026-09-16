/**
 * lib/race/last-known-good-projection.ts — the process-local cache of the
 * last successfully-resolved "Projected finish" figure, per runner, per
 * race, per day.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MOVED FROM `lib/plan/plan-snapshot.ts` (BA-01R item 12, 2026-09-15)
 *
 * This was private to `plan-snapshot.ts`, written and read from the same
 * function. Per BACKEND-IMPLEMENTATION-SCOPE-AND-SETUP-2026-09-15.md item
 * 12 — "Temporarily remove race-outlook recomputation from Plan Snapshot if
 * a prepared last-good value exists; otherwise return an explicit
 * pending/unknown field rather than hold the entire block request" —
 * `loadPlanSnapshot` no longer calls `resolveRaceOutlookBySlug` at all, so
 * it can only ever be a READER of this cache now. The WRITER moved to
 * `lib/race/race-outlook.ts`'s `resolveRaceOutlookBySlug` and
 * `resolveRaceOutlookCooperative` — the two functions `/api/v5/race/[slug]`
 * and `/api/v5/races` call to resolve this same quantity fresh, on their
 * own schedule, as the source of truth (Rule 16). Living here, in neither
 * of those two files, is what lets both write to the SAME cache
 * `loadPlanSnapshot` reads without a circular import between them.
 *
 * WHY THIS IS NOT THE THING READS-DEDUP-1 REFUSED TO BUILD. That file's
 * header argues, correctly, against a TTL cache over the EVIDENCE BUNDLE:
 * those reads decide coaching, and one request must never serve another
 * request's view of the runner. This holds something categorically smaller
 * and later — a formatted string that has already been through
 * `raceProjectionFromOutlook`, kept only so a resolution that could not run
 * (a timeout) or was deliberately not attempted (item 12) does not blank a
 * figure a fresh resolution elsewhere has already stood behind.
 */

/** How stale a last-known-good projection may be before it stops being
 *  served. Rule 16 is the constraint that sets this, not comfort: Race
 *  Detail and the Races list resolve this same quantity FRESH on their own
 *  screens, so a value served here after a mid-day evidence change could
 *  disagree with them. Fifteen minutes bounds that window to something a
 *  runner cannot practically observe. */
const RACE_PROJECTION_LKG_MAX_AGE_MS = 15 * 60_000;

/** Hard ceiling on the map, so a long-lived process cannot grow it without
 *  bound if pruning by age alone is not enough (many users, many races). */
const RACE_PROJECTION_LKG_MAX_ENTRIES = 500;

const lastKnownGoodProjection = new Map<string, { text: string; at: number }>();

export function projectionCacheKey(userUuid: string, slug: string, today: string): string {
  return `${userUuid}::${slug}::${today}`;
}

export function readLastKnownGoodProjection(key: string): { text: string; at: number } | null {
  const hit = lastKnownGoodProjection.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > RACE_PROJECTION_LKG_MAX_AGE_MS) {
    lastKnownGoodProjection.delete(key);
    return null;
  }
  return hit;
}

/**
 * FINISHEST-RESURRECT-1 · forget a projection the engine has WITHDRAWN.
 *
 * The cache exists so a read that could not run does not blank a figure a
 * fresh resolution already stood behind. It must never survive the
 * engine's own decision to stop making the claim. Without this, the
 * sequence is: a fresh resolution succeeds and is remembered; a LATER fresh
 * resolution legitimately finds nothing to project and the stat correctly
 * disappears there; a THIRD read — one that only consults this cache and
 * never resolves fresh (`loadPlanSnapshot`, under item 12) — reads the
 * stale entry and puts the withdrawn figure back on screen as a live value.
 *
 * That is strictly worse than the flicker this cache exists to cure — a
 * flicker is visible and this is not — and it is Rule 11 exactly:
 * "withdrawn" and "we could not find out" are different facts, and a cache
 * that outlives the withdrawal collapses them into the last good one.
 */
export function clearLastKnownGoodProjection(key: string): void {
  lastKnownGoodProjection.delete(key);
}

export function writeLastKnownGoodProjection(key: string, text: string): void {
  lastKnownGoodProjection.set(key, { text, at: Date.now() });
  const cutoff = Date.now() - RACE_PROJECTION_LKG_MAX_AGE_MS;
  for (const [k, v] of lastKnownGoodProjection) {
    if (v.at < cutoff) lastKnownGoodProjection.delete(k);
  }
  // Insertion order is eviction order; `set` on an existing key does not move
  // it, so a hot entry can be evicted — acceptable, because eviction costs at
  // most one render of the honest third state, never a wrong number.
  while (lastKnownGoodProjection.size > RACE_PROJECTION_LKG_MAX_ENTRIES) {
    const oldest = lastKnownGoodProjection.keys().next();
    if (oldest.done) break;
    lastKnownGoodProjection.delete(oldest.value);
  }
}

/** Test-only reset. The cache is process-global by design, which is exactly
 *  what makes it invisible to a test that cannot clear it. */
export function __resetLastKnownGoodProjectionsForTest(): void {
  lastKnownGoodProjection.clear();
}
