/**
 * Coach calendar · persistence + read-through cache.
 *
 * URL lives in profile.user_settings.coach_calendar_url (jsonb field-
 * merge, Rule 6 — same envelope as coached_externally, zero DDL).
 * Parsed events live in coach_reads_cache (UNIQUE (user_uuid, read_kind,
 * cache_key)) under read_kind='coach_calendar' / cache_key='feed', with
 * source_state_hash = the feed URL so changing the link invalidates the
 * cached events.
 *
 * Refresh model: read-through with a 6h TTL. Reads NEVER block on the
 * network — a stale (or missing) cache kicks a fire-and-forget refresh
 * and serves what's on hand; the save endpoint refreshes inline so the
 * runner sees their workouts the moment they connect. No new cron, no
 * new infra.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 2026-08-24 · `coach_reads_cache` DID NOT EXIST. NOW IT DOES — migration 153.
 *
 * Nothing in `db/migrations` created it, so the whole loop below ran on a
 * relation that was not there, and it looked exactly like a working feature:
 *
 *   · `readCache` threw and `.catch(() => ({ rows: [] }))` reported a cache
 *     MISS, which is a perfectly ordinary thing for a cache to report;
 *   · the miss set `expired`, which kicked `refreshCoachCalendar`;
 *   · that fetched the runner's real ICS feed over the network, then threw on
 *     the INSERT, into `void …catch(() => {})`;
 *   · `getCoachCalendarStatus` returned `events: []`, `lastError: null` —
 *     "connected, and your coach has scheduled nothing."
 *
 * Every load re-fetched the feed and threw the parsed events away. The runner
 * saw an empty calendar and no error, and the coach's ICS host saw the traffic.
 *
 * Both halves are fixed. `lastError` carries the storage failure, because a
 * status object with a `lastError` field is exactly where a failure belongs;
 * and `153_coach_reads_cache.sql` (applied to prod 2026-08-24) means there is
 * no storage failure to carry. Verified end to end against a local clone: a
 * three-event feed connects, caches, serves from cache on the next read with
 * an unchanged `fetchedAt`, and disconnect removes the row.
 *
 * KEEP the `attempt()` around the write and the `null`-means-unreadable branch
 * in `readCache`. A cache that cannot be written is still a real condition, and
 * "we could not read the cache" must never again collapse into "your coach has
 * scheduled nothing".
 */
import { pool } from '@/lib/db/pool';
import { attempt, rowOrNull } from '@/lib/db/read';
import { fetchIcsFeed, type CoachCalendarEvent } from './ics';

const KIND = 'coach_calendar';
const KEY = 'feed';
const TTL_HOURS = 6;

interface CacheContent {
  events: CoachCalendarEvent[];
  lastError: string | null;
  /** ISO timestamp of the last SUCCESSFUL fetch (computed_at tracks the
   *  last write, which may have been an error-stamp). */
  fetchedAt: string | null;
}

export interface CoachCalendarStatus {
  urlSet: boolean;
  events: CoachCalendarEvent[];
  fetchedAt: string | null;
  lastError: string | null;
}

export async function getCoachCalendarUrl(userId: string): Promise<string | null> {
  const r = await pool.query<{ url: string | null }>(
    `SELECT user_settings->>'coach_calendar_url' AS url FROM profile WHERE user_uuid = $1 LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] as Array<{ url: string | null }> }));
  return r.rows[0]?.url ?? null;
}

/** Set (or clear, with null) the runner's feed URL. Clearing also drops
 *  the cached events — disconnect means gone, not lingering. */
export async function setCoachCalendarUrl(userId: string, url: string | null): Promise<void> {
  if (url) {
    await pool.query(
      `UPDATE profile SET user_settings = user_settings || jsonb_build_object('coach_calendar_url', $2::text)
        WHERE user_uuid = $1`,
      [userId, url],
    );
  } else {
    await pool.query(
      `UPDATE profile SET user_settings = user_settings - 'coach_calendar_url' WHERE user_uuid = $1`,
      [userId],
    );
    await pool.query(
      `DELETE FROM coach_reads_cache WHERE user_uuid = $1 AND read_kind = $2 AND cache_key = $3`,
      [userId, KIND, KEY],
    );
  }
}

/** Fetch the feed now and write the cache row. Returns the outcome.
 *  On fetch failure the previous events are KEPT (stale beats empty)
 *  and lastError is stamped for the UI. */
export async function refreshCoachCalendar(userId: string): Promise<
  { ok: true; events: CoachCalendarEvent[] } | { ok: false; error: string }
> {
  const url = await getCoachCalendarUrl(userId);
  if (!url) return { ok: false, error: 'no calendar connected' };

  const prior = await readCache(userId);
  const result = await fetchIcsFeed(url);

  const content: CacheContent = result.ok
    ? { events: result.events, lastError: null, fetchedAt: new Date().toISOString() }
    : { events: prior?.content.events ?? [], lastError: result.error, fetchedAt: prior?.content.fetchedAt ?? null };

  // coach_reads_cache keeps the legacy text user_id PK-mate ('me'-default
  // single-user era) — write it as uuid-text like every post-2026-06-10
  // writer. See the profile/user_prefs landmine notes.
  //
  // The write is allowed to fail — a calendar we fetched but could not cache is
  // still a calendar we fetched, and the events go back to the caller either
  // way. It is not allowed to fail QUIETLY: without this the whole feature was
  // a network round-trip whose result went in the bin, and the runner saw an
  // empty calendar with no error on it.
  const stored = await attempt(
    'coach-calendar · cache write',
    pool.query(
    `INSERT INTO coach_reads_cache (user_id, user_uuid, read_kind, cache_key, content, computed_at, ttl_at, source_state_hash)
     VALUES ($1::text, $1::uuid, $2, $3, $4::jsonb, NOW(), NOW() + interval '${TTL_HOURS} hours', $5)
     ON CONFLICT (user_uuid, read_kind, cache_key) DO UPDATE
       SET content = EXCLUDED.content,
           computed_at = EXCLUDED.computed_at,
           ttl_at = EXCLUDED.ttl_at,
           source_state_hash = EXCLUDED.source_state_hash,
           user_id = EXCLUDED.user_id`,
      [userId, KIND, KEY, JSON.stringify(content), url],
    ),
  );

  // A fetch that worked but could not be stored is reported as a failure to
  // the caller, because the next read will find nothing and the runner would
  // otherwise be told their coach has scheduled nothing. `attempt` has already
  // logged the driver's own words.
  if (!stored.ok) return { ok: false, error: 'calendar could not be saved' };

  return result.ok ? { ok: true, events: result.events } : { ok: false, error: result.error };
}

/**
 * The cached feed.
 *
 *   · a row      → the cache HIT
 *   · `undefined`→ a genuine cache MISS (nothing stored yet)
 *   · `null`     → the cache could not be READ. Not a miss. See the header.
 */
async function readCache(userId: string): Promise<
  { content: CacheContent; ttlAt: string | null; sourceHash: string | null } | undefined | null
> {
  const row = await rowOrNull<{ content: CacheContent; ttl_at: string | null; source_state_hash: string | null }>(
    'coach-calendar · readCache',
    pool.query<{ content: CacheContent; ttl_at: string | null; source_state_hash: string | null }>(
      `SELECT content, ttl_at, source_state_hash FROM coach_reads_cache
      WHERE user_uuid = $1 AND read_kind = $2 AND cache_key = $3 LIMIT 1`,
      [userId, KIND, KEY],
    ),
  );
  if (row === null) return null;
  if (!row?.content) return undefined;
  return { content: row.content, ttlAt: row.ttl_at, sourceHash: row.source_state_hash };
}

/** The read path for seed/API. Serves cache; when the URL is set and the
 *  cache is missing/expired/url-changed, kicks a background refresh and
 *  serves what exists NOW (page render never blocks on a coach's
 *  calendar host). */
export async function getCoachCalendarStatus(userId: string): Promise<CoachCalendarStatus> {
  const url = await getCoachCalendarUrl(userId);
  if (!url) return { urlSet: false, events: [], fetchedAt: null, lastError: null };

  const cached = await readCache(userId);

  // `null` = the cache could not be read at all. That is NOT a miss, and it
  // must not render as "your coach has scheduled nothing". Say so on
  // `lastError`, which is the field this status object already has for exactly
  // this, and do not kick a refresh that will only fail to store.
  if (cached === null) {
    return {
      urlSet: true,
      events: [],
      fetchedAt: null,
      lastError: 'Calendar storage is unavailable. Your feed is still connected.',
    };
  }

  const expired = !cached
    || (cached.ttlAt != null && new Date(cached.ttlAt).getTime() < Date.now())
    || cached.sourceHash !== url;

  if (expired) {
    // Fire-and-forget · errors land in the cache row's lastError.
    void refreshCoachCalendar(userId).catch(() => {});
  }

  return {
    urlSet: true,
    events: cached?.content.events ?? [],
    fetchedAt: cached?.content.fetchedAt ?? null,
    lastError: cached?.content.lastError ?? null,
  };
}
