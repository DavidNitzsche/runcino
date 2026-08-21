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
  /** ISO timestamp of the last `run-adaptations` cron pass that touched
   *  this plan (or null if the cron has never run for this plan yet). The
   *  iPhone surfaces "Plan refreshed Xh ago" so the user knows the plan
   *  is alive. Added 2026-05-30 audit pass. */
  last_adapted_at: string | null;
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
  try {
    return await loadActivePlanStrict(userId);
  } catch {
    // Callers of the lenient form treat null as "no active plan". That is
    // wrong for a failed read, but changing every one of them at once is a
    // bigger blast radius than this fix wants. What is fixed here is the
    // part that made the failure OUTLIVE it: see the note in the strict
    // form. A failed read now returns null for THIS call only.
    return null;
  }
}

/**
 * The same lookup, with the read failure left intact.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE LENIENT FORM WAS NOT ENOUGH
 *
 * This query used to end `.catch(() => ({ rows: [] }))`, and the result —
 * failure or genuinely-no-plan, indistinguishable — was then written into
 * the 60-second memo. So a two-second Postgres blip did not cost one
 * request. It cost sixty seconds in which every consumer listed in this
 * file's header (state-loader, glance-state, log-state, training-state,
 * run-state, race-header, watch/build-workout) was told, from cache, with
 * the database healthy again, that the runner had no plan.
 *
 * On `/api/v5/today` that surfaced as `not_on_phone_yet` — "This phone build
 * only coaches toward a goal race" — to a runner in week 9 of a marathon
 * block. A refusal wearing an outage's clothes, which is rule three exactly
 * backwards, and no retry could clear it until the memo aged out.
 *
 * Two changes: a failed read now THROWS here, and a failed read is never
 * cached. Only an answer is cached.
 *
 * Use this form wherever the plan is load-bearing — where "no plan" changes
 * what the runner is told about themselves rather than just omitting a
 * section.
 */
export async function loadActivePlanStrict(userId: string): Promise<ActivePlan | null> {
  const hit = cache.get(userId);
  if (hit && hit.expires > Date.now()) return hit.value;

  // No `.catch` — a failed read is not an empty result.
  const r = await pool.query<ActivePlan>(
    `SELECT id, race_id, mode, goal_iso::text AS goal_iso, authored_iso::text AS authored_iso,
            last_adapted_at::text AS last_adapted_at
       FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId],
  );

  const value = r.rows[0] ?? null;
  // Reached only on a successful read, so the memo now holds answers only.
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
