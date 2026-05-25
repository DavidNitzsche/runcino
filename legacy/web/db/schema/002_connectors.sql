-- ═════════════════════════════════════════════════════════════════
-- 002_connectors.sql — per-user connector tokens + sync state
--
-- Purely additive. Replaces the single-user env-var Strava credentials
-- + the existing `strava_sync_state` table (which is currently a kv
-- store for one user). Old table stays in place for read compatibility
-- until 004 cutover.
-- ═════════════════════════════════════════════════════════════════

-- ── connector_tokens ─────────────────────────────────────────────
-- One row per (user, provider). Holds OAuth credentials, scope, and
-- last-sync metadata. Same table for Strava, Garmin, Apple Health,
-- Whoop, Oura, Coros, Polar, Suunto, Wahoo, Google Fit — extensibility
-- via the `provider` enum-ish text column + a `metadata` JSONB blob
-- for provider-specific fields (e.g. Strava athlete profile snapshot).
CREATE TABLE IF NOT EXISTS connector_tokens (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  provider          TEXT NOT NULL CHECK (provider IN (
                      'strava',
                      'garmin',
                      'apple_health',
                      'coros',
                      'polar',
                      'suunto',
                      'wahoo',
                      'google_fit',
                      'final_surge',
                      'training_peaks',
                      'whoop',
                      'oura'
                    )),
  provider_user_id  TEXT,           -- e.g. Strava athlete_id; for webhook → user lookup
  scope             TEXT,           -- comma-separated OAuth scopes granted

  -- OAuth credentials
  access_token      TEXT NOT NULL,
  refresh_token     TEXT,           -- some providers don't issue these
  expires_at        TIMESTAMPTZ,    -- when the access token expires (refresh before this)

  -- Provider-specific data — athlete profile, capabilities, etc.
  metadata          JSONB NOT NULL DEFAULT '{}'::JSONB,

  -- Sync status (last sync attempt; the actual activity rows live in `runs`)
  last_sync_at      TIMESTAMPTZ,
  last_sync_status  TEXT CHECK (last_sync_status IS NULL OR last_sync_status IN ('success','error','in_progress','rate_limited')),
  last_sync_error   TEXT,
  activities_count  INTEGER NOT NULL DEFAULT 0,  -- how many activities pulled total

  -- Audit
  connected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disconnected_at   TIMESTAMPTZ,                  -- soft-delete; rows are kept for audit
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_connector_tokens_user
  ON connector_tokens (user_id)
  WHERE disconnected_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_connector_tokens_provider_user_id
  ON connector_tokens (provider, provider_user_id)
  WHERE disconnected_at IS NULL;

DROP TRIGGER IF EXISTS trg_connector_tokens_updated_at ON connector_tokens;
CREATE TRIGGER trg_connector_tokens_updated_at
  BEFORE UPDATE ON connector_tokens
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ── connector_sync_log ───────────────────────────────────────────
-- Optional but useful: every sync attempt logs a row. Lets us answer
-- "why didn't this run sync?" / "show last 10 sync attempts" + serves
-- as an audit trail. Strava webhook deliveries also log here.
CREATE TABLE IF NOT EXISTS connector_sync_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,
  trigger         TEXT NOT NULL CHECK (trigger IN ('connect','manual','webhook','cron','backfill')),
  status          TEXT NOT NULL CHECK (status IN ('success','error','in_progress','rate_limited')),
  activities_pulled INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT,
  duration_ms     INTEGER,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_connector_sync_log_user_provider
  ON connector_sync_log (user_id, provider, started_at DESC);
