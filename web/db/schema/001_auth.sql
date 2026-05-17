-- ═════════════════════════════════════════════════════════════════
-- 001_auth.sql — users, sessions, password resets
--
-- Purely additive. Applies cleanly against the existing single-user
-- schema. No existing rows touched.
--
-- Apply with:  psql $DATABASE_URL -f 001_auth.sql
-- ═════════════════════════════════════════════════════════════════

-- gen_random_uuid() lives in pgcrypto in older Postgres, native in 13+.
-- Railway runs Postgres 16; gen_random_uuid() is available without the
-- extension. Keeping this guarded for compatibility with local 13/14 setups.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── users ────────────────────────────────────────────────────────
-- One row per signed-up account. Holds identity (from onboarding step 1)
-- + training prefs (from onboarding step 3) + avatar state.
CREATE TABLE IF NOT EXISTS users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auth
  email                 CITEXT NOT NULL UNIQUE,  -- case-insensitive email; see extension below
  password_hash         TEXT NOT NULL,           -- bcrypt with cost 12; includes salt
  email_verified_at     TIMESTAMPTZ,             -- null until verified via email link
  email_verify_token    TEXT,                    -- single-use token, expires 24h
  email_verify_expires  TIMESTAMPTZ,

  -- Identity (onboarding step 1)
  name                  TEXT NOT NULL DEFAULT '',
  age                   INTEGER CHECK (age IS NULL OR (age >= 13 AND age <= 100)),
  sex                   TEXT CHECK (sex IS NULL OR sex IN ('M','F')),
  location              TEXT,

  -- Avatar (Edit Profile modal output)
  avatar_mode           TEXT NOT NULL DEFAULT 'initials' CHECK (avatar_mode IN ('initials','upload','strava')),
  avatar_upload_url     TEXT,   -- S3/CDN url when avatar_mode='upload'
  avatar_strava_url     TEXT,   -- Strava profile photo url when avatar_mode='strava'

  -- Training prefs (onboarding step 3 — these drive buildPlan)
  level                 TEXT NOT NULL DEFAULT 'intermediate'
                          CHECK (level IN ('beginner','intermediate','advanced','elite')),
  long_run_day          TEXT NOT NULL DEFAULT 'sun'
                          CHECK (long_run_day IN ('mon','tue','wed','thu','fri','sat','sun')),
  quality_days          TEXT[] NOT NULL DEFAULT ARRAY['tue','thu']::TEXT[],
  rest_day              TEXT NOT NULL DEFAULT 'sat'
                          CHECK (rest_day IN ('mon','tue','wed','thu','fri','sat','sun')),

  -- Audit
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at         TIMESTAMPTZ
);

-- CITEXT extension for case-insensitive email comparisons (so "Foo@bar.com"
-- and "foo@bar.com" resolve to the same user without explicit LOWER()).
CREATE EXTENSION IF NOT EXISTS citext;

CREATE INDEX IF NOT EXISTS idx_users_email_verify_token
  ON users (email_verify_token)
  WHERE email_verify_token IS NOT NULL;

-- updated_at trigger — bump on every UPDATE
CREATE OR REPLACE FUNCTION set_updated_at_now() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ── sessions ─────────────────────────────────────────────────────
-- Cookie-based auth. Cookie holds an opaque session_token (32 bytes
-- base64url). Server looks up (session_token, expires_at > NOW()) on
-- every protected request. Refresh expiry on use to extend.
CREATE TABLE IF NOT EXISTS sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token   TEXT NOT NULL UNIQUE,    -- 32-byte base64url, never returned to client raw after creation
  expires_at      TIMESTAMPTZ NOT NULL,    -- 30 days by default, refreshed on use
  ip_address      INET,                    -- IP at session creation; informational
  user_agent      TEXT,                    -- UA at session creation
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (session_token);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

-- ── password_resets ──────────────────────────────────────────────
-- Single-use reset tokens. User clicks "Forgot password?" → email arrives
-- with a tokenized link → user lands on /reset-password?token=... → submits
-- new password → token is marked used_at and cannot be re-used.
CREATE TABLE IF NOT EXISTS password_resets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,        -- 32-byte base64url; emailed once
  expires_at  TIMESTAMPTZ NOT NULL,        -- 1 hour from creation
  used_at     TIMESTAMPTZ,                 -- null until consumed
  ip_address  INET,                        -- IP that requested reset
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets (token) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id);
