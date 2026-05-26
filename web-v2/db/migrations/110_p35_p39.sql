-- 110 — P35 settings + P39 auth columns
--
-- NOTE: `sessions` table already exists from legacy (with session_token /
-- ip_address / user_agent / kind / revoked_at columns). We don't recreate
-- it — we'll plug per-user auth into the existing shape in P39 follow-up.

-- ── P35 ── per-user toggles
ALTER TABLE profile ADD COLUMN IF NOT EXISTS strava_auto_push BOOLEAN DEFAULT FALSE;
ALTER TABLE profile ADD COLUMN IF NOT EXISTS phone_hr_alerts  BOOLEAN DEFAULT FALSE;

-- ── P39 ── per-user OAuth credentials
ALTER TABLE profile ADD COLUMN IF NOT EXISTS apple_user_id        TEXT;
ALTER TABLE profile ADD COLUMN IF NOT EXISTS apple_email          TEXT;
ALTER TABLE profile ADD COLUMN IF NOT EXISTS strava_athlete_id    TEXT;
ALTER TABLE profile ADD COLUMN IF NOT EXISTS strava_access_token  TEXT;
ALTER TABLE profile ADD COLUMN IF NOT EXISTS strava_refresh_token TEXT;
ALTER TABLE profile ADD COLUMN IF NOT EXISTS strava_expires_at    TIMESTAMPTZ;

-- Unique on apple_user_id (skipping if already exists)
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_apple_user_id
  ON profile(apple_user_id) WHERE apple_user_id IS NOT NULL;
