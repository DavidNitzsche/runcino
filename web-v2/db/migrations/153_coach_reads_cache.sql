-- 153_coach_reads_cache.sql
-- The cache the coach calendar has been throwing its work into.
--
-- `coach_reads_cache` is named by lib/coach-calendar/store.ts (one INSERT ...
-- ON CONFLICT, one SELECT, one DELETE) and by nothing else in web-v2. No
-- migration ever created it. Confirmed absent in prod with `faff_readonly` on
-- 2026-08-24.
--
-- The cost, before the 2026-08-24 swallowed-failure sweep, was a loop that
-- looked like a working feature:
--   · readCache threw 42P01 and `.catch(() => ({ rows: [] }))` reported a
--     cache MISS — an entirely ordinary thing for a cache to report;
--   · the miss set `expired`, which kicked refreshCoachCalendar;
--   · that fetched the runner's real ICS feed over the network, then threw on
--     the INSERT into `void ….catch(() => {})`;
--   · getCoachCalendarStatus returned `events: []`, `lastError: null` —
--     "connected, and your coach has scheduled nothing."
-- Every page load re-fetched the feed and binned the parsed events, and the
-- coach's ICS host saw the traffic. This migration ends the loop.
--
-- SHAPE. The DDL the store header proposed, with two deliberate choices:
--   · `ttl_at` is NULLABLE here, where legacy/web/lib/db.ts (and the local
--     faff_sandbox clone) had it NOT NULL. The only web-v2 writer always
--     supplies it (NOW() + 6 hours), and readCache explicitly branches on
--     `cached.ttlAt != null` — so nullable accepts strictly more than the
--     reader already handles, and a future writer that has no TTL to state
--     stores a null instead of inventing one.
--   · `user_id text NOT NULL` is kept, unlike personal_goals, because this
--     table's writer DOES populate it ($1::text alongside $1::uuid) and the
--     ON CONFLICT DO UPDATE sets it. It is a real column here, not a
--     'me'-default landmine.
--
-- PRIMARY KEY (user_uuid, read_kind, cache_key) is what the writer's
-- `ON CONFLICT (user_uuid, read_kind, cache_key)` binds to; a surrogate id
-- with a separate UNIQUE would work identically but buys nothing — nothing
-- addresses a cache row by id.
--
-- Additive only: one new table, one new index. Idempotent.
--
-- REVERSED BY: DROP TABLE IF EXISTS coach_reads_cache;
-- (created empty; it is a CACHE, so dropping it loses nothing that cannot be
--  re-fetched from the runner's feed on the next read)

CREATE TABLE IF NOT EXISTS coach_reads_cache (
  user_id           text NOT NULL,
  user_uuid         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_kind         text NOT NULL,
  cache_key         text NOT NULL,
  content           jsonb NOT NULL,
  computed_at       timestamptz NOT NULL DEFAULT now(),
  ttl_at            timestamptz,
  source_state_hash text,
  PRIMARY KEY (user_uuid, read_kind, cache_key)
);

-- The eviction sweep is `WHERE ttl_at < NOW()`. Plain B-tree, NOT partial:
-- Postgres rejects an index predicate that calls NOW() (STABLE, not
-- IMMUTABLE), and that rejection would take the whole migration down.
CREATE INDEX IF NOT EXISTS idx_coach_reads_cache_expired
  ON coach_reads_cache (ttl_at);

COMMENT ON TABLE coach_reads_cache IS
  'Read-through cache for computed coach reads. Today its only writer is the '
  'coach calendar (read_kind=''coach_calendar'', cache_key=''feed'', '
  'source_state_hash = the feed URL so changing the link invalidates it). '
  'Every row is derived and safe to delete; a miss recomputes.';
