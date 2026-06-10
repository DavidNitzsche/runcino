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
 */
import { pool } from '@/lib/db/pool';
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
  await pool.query(
    `INSERT INTO coach_reads_cache (user_id, user_uuid, read_kind, cache_key, content, computed_at, ttl_at, source_state_hash)
     VALUES ($1::text, $1::uuid, $2, $3, $4::jsonb, NOW(), NOW() + interval '${TTL_HOURS} hours', $5)
     ON CONFLICT (user_uuid, read_kind, cache_key) DO UPDATE
       SET content = EXCLUDED.content,
           computed_at = EXCLUDED.computed_at,
           ttl_at = EXCLUDED.ttl_at,
           source_state_hash = EXCLUDED.source_state_hash,
           user_id = EXCLUDED.user_id`,
    [userId, KIND, KEY, JSON.stringify(content), url],
  );

  return result.ok ? { ok: true, events: result.events } : { ok: false, error: result.error };
}

async function readCache(userId: string): Promise<
  { content: CacheContent; ttlAt: string | null; sourceHash: string | null } | null
> {
  const r = await pool.query<{ content: CacheContent; ttl_at: string | null; source_state_hash: string | null }>(
    `SELECT content, ttl_at, source_state_hash FROM coach_reads_cache
      WHERE user_uuid = $1 AND read_kind = $2 AND cache_key = $3 LIMIT 1`,
    [userId, KIND, KEY],
  ).catch(() => ({ rows: [] as Array<{ content: CacheContent; ttl_at: string | null; source_state_hash: string | null }> }));
  const row = r.rows[0];
  if (!row?.content) return null;
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
