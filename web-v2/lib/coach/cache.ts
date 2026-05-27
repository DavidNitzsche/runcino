/**
 * cache.ts — briefing cache backed by Postgres (table: briefings).
 *
 * EVENT-DRIVEN. Briefings are pre-built on triggers (day rollover, run
 * ingest, check-in, profile edit, plan swap, race edit) and read forever
 * until the next mutating endpoint calls bustBriefingCache().
 *
 * No signature hashing — that was a fallback for "any state change should
 * regenerate." With comprehensive event-bust coverage (see audit
 * P17.6), the events ARE the invalidation, and the briefing is just the
 * latest one written.
 *
 * Schema note: the existing `briefings` table has a `signature` column.
 * We keep it for backward compatibility but write a fixed sentinel so
 * the (user_id, surface, signature) unique key collapses to (user_id,
 * surface). When migrations next pass, drop the column.
 */
import { pool } from '@/lib/db/pool';
import type { Topic } from '@/lib/topics/types';

// Fixed sentinel — old `signature` column is no longer used as an input
// hash; collapses the unique key to (user_id, surface_key).
const SIGNATURE_SENTINEL = 'event-driven';

// The cache key is the surface, optionally suffixed with `:ios` for the
// compact-voice variant. We pass it as a string so the engine controls
// the bucket name.
export type CacheKey = string;

export interface CachedBriefing {
  surface: string;
  mode: string;
  lead: string;
  voice: string[];
  topics: Topic[];
  _state: any;
}

function todayPT(): string {
  return new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
}

export async function readCachedBriefing(userId: string, key: CacheKey): Promise<CachedBriefing | null> {
  try {
    const r = (await pool.query(
      `SELECT payload FROM briefings
        WHERE user_id = $1 AND surface = $2
        ORDER BY generated_at DESC LIMIT 1`,
      [userId, key]
    )).rows[0];
    if (!r) return null;
    const payload = r.payload as CachedBriefing;
    // Day-rollover invalidation: a briefing whose embedded today != now is
    // stale by definition (TODAY moved underneath it). Treat as miss so
    // the engine regenerates against the new day. Cheaper than running a
    // midnight cron + survives if a cron ever misses.
    if (payload?._state?.today && payload._state.today !== todayPT()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function writeCachedBriefing(
  userId: string,
  key: CacheKey,
  mode: string,
  payload: CachedBriefing,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO briefings (user_id, surface, mode, signature, payload)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, surface, signature)
       DO UPDATE SET payload = EXCLUDED.payload, generated_at = now(), mode = EXCLUDED.mode`,
      [userId, key, mode, SIGNATURE_SENTINEL, payload]
    );
  } catch {
    // non-fatal — engine still returned the live result.
  }
}

/**
 * Bust the cache for a user. Called from EVERY mutating endpoint so the
 * next /api/briefing fetch regenerates voice with fresh tool reads.
 *
 * Cache-bust is the ONLY invalidation now — there's no signature/TTL
 * safety net. Events must be exhaustive (audit P17.6).
 *
 * After busting, kicks off a BACKGROUND regeneration of the most-used
 * surfaces (today + today:ios) so the next /today open is instant rather
 * than a 15-20s LLM wait. Fire-and-forget — the caller (mutating endpoint)
 * is not blocked. Failures are swallowed: the day-rollover-on-read
 * staleness check + lazy regen on next fetch are the safety net.
 */
export async function bustBriefingCache(userId: string, key?: CacheKey): Promise<void> {
  try {
    if (key) {
      await pool.query(`DELETE FROM briefings WHERE user_id = $1 AND surface = $2`, [userId, key]);
    } else {
      await pool.query(`DELETE FROM briefings WHERE user_id = $1`, [userId]);
    }
  } catch {
    // non-fatal
  }

  // Fire background regen. Non-blocking. The mutating endpoint already
  // returned to the caller before this Promise even starts the LLM call.
  void warmBriefingsAfterBust(userId);
}

/**
 * Background warm — regenerate the surfaces the user actually opens.
 *
 * Today + today:ios are always warmed (every runner reads them daily).
 * Other surfaces (training/races/etc.) are warmed only if they have a
 * cached entry from within the last 14 days for this user — no point
 * burning LLM cycles on surfaces the runner never visits.
 *
 * Concurrent regens of the same surface are fine: writeCachedBriefing
 * does an upsert, latest-write-wins.
 */
async function warmBriefingsAfterBust(userId: string): Promise<void> {
  // P43 pause — when COACH_PAUSED=1, skip the warm fan-out entirely.
  // Cache stays busted (next read fully regenerates once paused clears).
  if (process.env.COACH_PAUSED === '1') return;
  try {
    // Dynamic import to dodge the circular dep (engine.ts imports from cache.ts).
    const { generateBriefing } = await import('./engine');

    // Always warm today (web + iOS variant).
    const targets: Array<{ surface: 'today' | 'training' | 'races' | 'health' | 'profile'; compact?: boolean }> = [
      { surface: 'today' },
      { surface: 'today', compact: true },
    ];

    // Optionally warm other surfaces if the user has touched them recently.
    const recent = (await pool.query(
      `SELECT DISTINCT surface FROM briefings
        WHERE user_id = $1
          AND generated_at >= NOW() - interval '14 days'
          AND surface IN ('training', 'races', 'health', 'profile')`,
      [userId]
    ).catch(() => ({ rows: [] }))).rows;
    for (const r of recent) {
      const s = r.surface as 'training' | 'races' | 'health' | 'profile';
      targets.push({ surface: s });
    }

    console.log(`[cache] warming ${targets.length} briefing(s) for ${userId}`);
    // Fire all in parallel. Each generateBriefing call writes to cache on success.
    await Promise.all(targets.map((t) =>
      generateBriefing(userId, t.surface, undefined, t.compact).catch((e) => {
        console.error(`[cache] warm failed surface=${t.surface}${t.compact ? ':ios' : ''}:`, e?.message ?? e);
      })
    ));
    console.log(`[cache] warm done for ${userId}`);
  } catch (e: any) {
    console.error('[cache] warmBriefingsAfterBust crashed:', e?.message ?? e);
  }
}
