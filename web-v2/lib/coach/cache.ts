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
import type { RegenEvent, Surface } from './regen-policy';

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
