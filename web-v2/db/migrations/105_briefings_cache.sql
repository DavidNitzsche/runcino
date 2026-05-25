-- 105_briefings_cache.sql
-- Persisted briefing cache. Survives container restarts. Keyed on a
-- signature computed from the state inputs that should change the voice:
--   today date · latest_activity_id · latest_checkin_id · profile_hash · race_signature
--
-- Engine reads cache first; only calls LLM on miss. Mutating endpoints
-- (checkin / profile / race / shoe / workout-swap) bust this cache for
-- the user so the next briefing fetch regenerates.

CREATE TABLE IF NOT EXISTS briefings (
    id            bigserial PRIMARY KEY,
    user_id       uuid NOT NULL,
    surface       text NOT NULL,
    mode          text NOT NULL,
    signature     text NOT NULL,
    payload       jsonb NOT NULL,
    generated_at  timestamptz NOT NULL DEFAULT now()
);

-- Unique on the cache key so upserts work cleanly.
CREATE UNIQUE INDEX IF NOT EXISTS briefings_cache_key
  ON briefings (user_id, surface, signature);

-- Useful for the "latest for surface" read pattern.
CREATE INDEX IF NOT EXISTS briefings_user_surface_at
  ON briefings (user_id, surface, generated_at DESC);

COMMENT ON TABLE briefings IS
  'Persisted briefing cache. Reads cheap; LLM only called on cache miss. Bust by deleting rows for a user.';
