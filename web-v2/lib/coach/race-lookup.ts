/**
 * race-lookup.ts — shared, memoized lookup of the runner's next A-race.
 *
 * Was duplicated between loadCoachState (state-loader.ts) and
 * loadGlanceState (glance-state.ts): both query the races table on
 * every load. /today and /health load via Promise.all simultaneously,
 * so both queries fire and one is wasted.
 *
 * Memoize for 60s so the second call within a short window — typical
 * page-load fan-out — gets the cached value. TTL matches BriefingLoader's
 * in-flight cache shape.
 */
import { pool } from '@/lib/db/pool';
import { distanceMiFromLabel } from '@/lib/race/distance';

export interface NextARace {
  slug: string;
  name: string | null;
  date: string;
  goal: string | null;
  days_to_race: number;
  /** 2026-06-03 · race distance for downstream consumers · phase-focus
   *  authoring + iPhone poster eyebrow + CoachState.phase. Null when
   *  meta.distanceLabel is unset or unparseable. */
  distanceMi: number | null;
  /** Raw distance label string · "5K", "Half Marathon", "Marathon", etc.
   *  Surfaced for clients that prefer the label over the numeric mileage. */
  distanceLabel: string | null;
}

interface CacheEntry {
  value: NextARace | null;
  expires: number;
}

const TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

/**
 * Resolve the runner's next A-race.
 *
 * Tries plan.race_id first when supplied (matches the active plan), else
 * falls back to the soonest upcoming A-race in the user's calendar. This
 * is the same two-step the state-loader was doing inline; consolidating
 * here means /today + /health share the work.
 */
export async function loadNextARace(
  userId: string,
  today: string,
  planRaceId?: string | null,
): Promise<NextARace | null> {
  const key = `${userId}|${today}|${planRaceId ?? ''}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  let race: NextARace | null = null;

  // Step 1: plan-anchored race
  if (planRaceId) {
    // 2026-06-05 · backend audit P0-7 fix · races.slug is per-user not
    // global. Step 1 was selecting by slug alone and then promoting the
    // row into a per-user-key cache · two users with the same plan
    // race slug got the wrong row. Step 2 below already passes userId;
    // Step 1 now matches. Cite docs/2026-06-05-backend-audit.html § P0-7.
    const row = (await pool.query(
      `SELECT slug, meta FROM races WHERE slug = $1 AND user_uuid = $2`,
      [planRaceId, userId]
    ).catch(() => ({ rows: [] }))).rows[0];
    if (row) {
      const date = row.meta?.date;
      if (date) {
        race = {
          slug: row.slug,
          name: row.meta?.name ?? null,
          date,
          goal: row.meta?.goalDisplay ?? null,
          days_to_race: daysBetween(today, date),
          distanceMi: parseDistanceMi(row.meta),
          distanceLabel: row.meta?.distanceLabel ?? null,
        };
      }
    }
  }

  // Step 2: fallback to soonest upcoming A/B race.
  //
  // 2026-06-09 · regression-audit G3 · was A-only, which left a hole in
  // the race-week readiness guard (health-actions.ts keys on
  // nextARace.days_to_race): a runner whose next race is priority B and
  // who has no active plan got no guard, no countdown, no race-day mode.
  // Step 1 (plan-anchored) never filtered by priority — a plan targeting
  // a B race already flowed through here — so widening Step 2 to A/B
  // makes the no-plan fallback consistent with the plan path rather than
  // introducing a new semantic. C races stay out: tune-ups shouldn't
  // flip race-day takeovers or suppress training advice for a week.
  if (!race) {
    const row = (await pool.query(
      `SELECT slug, meta FROM races
        WHERE user_uuid = $1
          AND meta->>'priority' IN ('A','B')
          AND (meta->>'date')::date >= $2::date
        ORDER BY (meta->>'date') ASC LIMIT 1`,
      [userId, today]
    ).catch(() => ({ rows: [] }))).rows[0];
    if (row) {
      const date = row.meta?.date;
      if (date) {
        race = {
          slug: row.slug,
          name: row.meta?.name ?? null,
          date,
          goal: row.meta?.goalDisplay ?? null,
          days_to_race: daysBetween(today, date),
          distanceMi: parseDistanceMi(row.meta),
          distanceLabel: row.meta?.distanceLabel ?? null,
        };
      }
    }
  }

  cache.set(key, { value: race, expires: Date.now() + TTL_MS });
  // Bound the cache so a long-lived process doesn't grow unbounded if
  // the userId/today key set churns (multi-user, day rollover).
  if (cache.size > 256) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].expires - b[1].expires)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  return race;
}

/** Cache bust hook — call this from races CRUD mutations. */
export function bustRaceCache(): void {
  cache.clear();
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(toIso + 'T12:00:00Z') - Date.parse(fromIso + 'T12:00:00Z')) / 86400000
  );
}

/** Parse race distance from meta.distanceLabel or meta.distanceMi · the
 *  races row may carry either depending on the writer (race CRUD uses
 *  distanceLabel; plan generator sets distanceMi numerically).
 *
 * 2026-07-07 · ultra-honesty audit P1-41 · this local fork required BOTH
 * "ultra" AND "50k" in the label to resolve a 50K ('50k'-only labels fell
 * through to null) and never matched the phone's "50M"/"100M" labels at
 * all (only 'M'-suffixed "50mi"/"100mi"/"50 mile"/"100 mile"). Delegate to
 * the shared distanceMiFromLabel (lib/race/distance.ts) — the one parser
 * every write/read path is converging on — instead of maintaining a
 * fourth divergent copy. Still returns null on unresolved (unchanged
 * contract: "no distance", never a guessed one). */
function parseDistanceMi(meta: any): number | null {
  const direct = Number(meta?.distanceMi);
  if (Number.isFinite(direct) && direct > 0) return direct;
  return distanceMiFromLabel(meta?.distanceLabel);
}
