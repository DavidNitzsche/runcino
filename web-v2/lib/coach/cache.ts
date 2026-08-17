/**
 * cache.ts — neutralized briefing-cache shim.
 *
 * 2026-05-28 · Cardinal Rule #1 (PROJECT.md, locked 2026-05-28): "Zero
 * LLM · anywhere · ever." The old engine.ts that wrote here is deleted.
 * /api/coach/facts is the new source of truth and recomputes facts
 * deterministically on every read (cheap pg queries only) — there is
 * nothing to cache.
 *
 * We keep the EXPORTED FUNCTION SIGNATURES so the dozens of mutating
 * endpoints (run ingest, profile edit, race CRUD, plan swap, watch
 * complete, etc.) that call `bustBriefingCacheForEvent` continue to
 * compile and run. They just become no-ops (other than busting the
 * in-process race-lookup memo, which is still cheap + correct).
 *
 * The `briefings` and `coach_usage` Postgres tables are LEFT ON DISK —
 * cheap, harmless, and they hold a historical record of the LLM era.
 * A follow-up phase can drop them.
 *
 * NOTHING in this file imports Anthropic. NOTHING calls fetch().
 * NOTHING writes to the `briefings` table any more.
 */
import { bustRaceCache } from './race-lookup';

// ── Call-site vocabulary ──────────────────────────────────────────────
// 2026-08-17 · these two unions used to live in regen-policy.ts, whose
// runtime half (REGEN_MAP + the cadence table) died with the LLM rip and
// had no callers left. The unions themselves still earn their keep: the
// ~30 mutation endpoints that call bustSurfacesForEvent pass literals,
// and the union is what stops a typo from compiling.

/** Coach surfaces a mutation can invalidate. */
export type Surface =
  | 'today'
  | 'training'
  | 'races'
  | 'race-detail'
  | 'health'
  | 'profile';

/** Mutation hooks that bust the cache. Each corresponds to a real route
 *  handler or cron in the app. */
export type RegenEvent =
  | 'run_ingest'        // /api/watch/workouts/complete, /api/gpx/import, etc.
  | 'check_in'          // /api/checkin
  | 'plan_swap'         // /api/plan/workout, /api/plan/generate
  | 'profile_edit'      // /api/profile
  | 'race_crud'         // /api/race
  | 'shoe_crud'         // /api/shoe
  | 'hk_signal_sample'  // /api/ingest/health (sleep_hours / resting_hr / hrv / hr_recovery)
  | 'day_rollover'      // daily 00:05 PT cron
  | 'keep_warm_tick';   // 15min DB-only warm (no LLM)

// ── Constants kept for import-site compatibility ──────────────────────

/** Was used by the LLM-era engine to invalidate cached briefs when
 *  prompt doctrine changed. Now meaningless — left as a constant so
 *  any code that imports it still type-checks. */
export const PROMPT_VERSION = 'deterministic-fact-reciter-v1';

export type CacheKey = string;

export interface CachedBriefing {
  surface: string;
  mode: string;
  lead: string;
  voice: string[];
  topics: unknown[];
  _state: any;
}

// ── Reads always miss ─────────────────────────────────────────────────

export async function readCachedBriefing(
  _userId: string,
  _key: CacheKey,
): Promise<CachedBriefing | null> {
  return null;
}

// ── Writes are no-ops ─────────────────────────────────────────────────

export async function writeCachedBriefing(
  _userId: string,
  _key: CacheKey,
  _mode: string,
  _payload: CachedBriefing,
): Promise<void> {
  /* no-op */
}

// ── Busts bust the in-process race-lookup memo only ───────────────────

export async function bustBriefingCache(
  _userId: string,
  _keyOrSurfaces?: CacheKey | readonly Surface[],
): Promise<void> {
  bustRaceCache();
}

export async function bustBriefingCacheForEvent(
  _userId: string,
  _event: RegenEvent,
): Promise<void> {
  bustRaceCache();
}

export function bustBriefingCacheDebounced(_userId: string): void {
  /* no-op */
}
