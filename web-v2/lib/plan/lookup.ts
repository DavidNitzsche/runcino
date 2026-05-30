/**
 * lib/plan/lookup.ts — memoized active-plan lookup.
 *
 * Before this, every state-loader (state-loader, glance-state,
 * log-state, training-state, run-state, race-header, watch/build-workout)
 * separately queried `training_plans` for the runner's active plan.
 * When /today renders, multiple loaders run in parallel via
 * Promise.all → the query fires 5-7 times per request. Same data
 * every time.
 *
 * 60-second per-process memo mirrors the race-lookup.ts pattern. Eliminates
 * the redundant queries without changing any caller behavior.
 *
 * Bust hook for plan mutations: bustPlanLookupCache(userId) is called
 * from /api/plan/generate, /api/plan/workout PATCH, and adapt.ts when
 * a plan changes.
 */
import { pool } from '@/lib/db/pool';

export interface ActivePlan {
  id: string;
  race_id: string | null;
  mode: string | null;
  goal_iso: string | null;
  authored_iso: string;
}

interface CacheEntry { value: ActivePlan | null; expires: number; }
const TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

/**
 * Returns the runner's active training_plans row (archived_iso IS NULL),
 * memoized per-process for 60 seconds.
 *
 * Scoped strictly by user_uuid — no legacy 'me' fallback (per the P0 fix
 * that removed cross-user leakage).
 */
export async function loadActivePlan(userId: string): Promise<ActivePlan | null> {
  const hit = cache.get(userId);
  if (hit && hit.expires > Date.now()) return hit.value;

  const r = await pool.query<ActivePlan>(
    `SELECT id, race_id, mode, goal_iso::text AS goal_iso, authored_iso::text AS authored_iso
       FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] as ActivePlan[] }));

  const value = r.rows[0] ?? null;
  cache.set(userId, { value, expires: Date.now() + TTL_MS });
  // Bound the cache so it doesn't grow unbounded across users/sessions.
  if (cache.size > 256) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].expires - b[1].expires)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  return value;
}

/** Cache bust — call from plan-mutation routes so the next lookup is fresh. */
export function bustPlanLookupCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}
