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

export interface NextARace {
  slug: string;
  name: string | null;
  date: string;
  goal: string | null;
  days_to_race: number;
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
    const row = (await pool.query(
      `SELECT slug, meta FROM races WHERE slug = $1`,
      [planRaceId]
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
        };
      }
    }
  }

  // Step 2: fallback to soonest upcoming A-race
  if (!race) {
    const row = (await pool.query(
      `SELECT slug, meta FROM races
        WHERE (user_uuid = $1 OR user_uuid IS NULL)
          AND meta->>'priority' = 'A'
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
