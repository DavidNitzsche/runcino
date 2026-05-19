/**
 * Postgres pool + schema bootstrap.
 *
 * Single shared `pg.Pool` for the app. Schema lives here too: tables
 * are created on first query via `ensureSchema()`, idempotent. No
 * separate migration runner — the schema is small enough that
 * conditional CREATEs cover us through M0/M1.
 *
 * Connection comes from DATABASE_URL (Railway sets this automatically
 * when a Postgres service is referenced from the faff service).
 * Locally, set DATABASE_URL in web/.env.local pointing at any reachable
 * Postgres (e.g. `postgres://localhost/faff`).
 *
 * SSL: Railway's internal Postgres routing requires no SSL between
 * services in the same project, but external connections do. We
 * detect by URL host — `*.railway.internal` skips SSL, anything else
 * uses `rejectUnauthorized:false` (matching Neon/Railway public certs).
 */

import { Pool, type PoolClient } from 'pg';

let pool: Pool | null = null;
let schemaReady = false;
let bootstrapping: Promise<void> | null = null;

function getPool(): Pool {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL not set — Postgres is required. Locally, point it at any Postgres; on Railway, reference the Postgres service from faff.');
  }
  const isInternal = /\.railway\.internal/.test(url);
  pool = new Pool({
    connectionString: url,
    ssl: isInternal ? false : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
  });
  return pool;
}

/** Run a query against the shared pool. Bootstraps schema lazily on
 *  first call so cold-start cost is paid once, not on every request. */
export async function query<T = unknown>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await ensureSchema();
  // pg's QueryResult generic wants a row shape, but we want callers to
  // be free to pass non-index-signatured types — cast through unknown.
  const res = await getPool().query(sql, params);
  return res.rows as unknown as T[];
}

export async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  await ensureSchema();
  const client = await getPool().connect();
  try { return await fn(client); }
  finally { client.release(); }
}

async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  if (bootstrapping) return bootstrapping;
  bootstrapping = bootstrap();
  try { await bootstrapping; schemaReady = true; }
  finally { bootstrapping = null; }
}

async function bootstrap(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS races (
        slug          TEXT PRIMARY KEY,
        plan          JSONB NOT NULL,
        gpx_text      TEXT NOT NULL,
        meta          JSONB NOT NULL,
        actual_result JSONB,
        saved_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS strava_activities (
        id            BIGINT PRIMARY KEY,
        data          JSONB NOT NULL,
        detail        JSONB,
        fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        detail_at     TIMESTAMPTZ
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS strava_sync_state (
        key           TEXT PRIMARY KEY,
        value         JSONB NOT NULL,
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS strava_activities_date_idx
        ON strava_activities ((data->>'date'));
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS shoes (
        id            SERIAL PRIMARY KEY,
        brand         TEXT NOT NULL,
        model         TEXT NOT NULL,
        color         TEXT,
        run_types     TEXT[] NOT NULL DEFAULT '{}',
        mileage       NUMERIC NOT NULL DEFAULT 0,
        mileage_cap   NUMERIC,
        retired       BOOLEAN NOT NULL DEFAULT FALSE,
        notes         TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      ALTER TABLE strava_activities
        ADD COLUMN IF NOT EXISTS shoe_id INTEGER REFERENCES shoes(id);
    `);
    await client.query(`
      ALTER TABLE shoes
        ADD COLUMN IF NOT EXISTS preferred BOOLEAN NOT NULL DEFAULT TRUE;
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS recovery_sessions (
        id            SERIAL PRIMARY KEY,
        date          DATE NOT NULL,
        service       TEXT NOT NULL,
        credits       INTEGER NOT NULL,
        done          BOOLEAN NOT NULL DEFAULT FALSE,
        done_at       TIMESTAMPTZ,
        note          TEXT,
        source        TEXT NOT NULL DEFAULT 'suggested',
        tied_to_run   BIGINT,
        tied_to_race  TEXT REFERENCES races(slug) ON DELETE SET NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS recovery_sessions_date_idx ON recovery_sessions (date);
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS personal_goals (
        id          SERIAL PRIMARY KEY,
        user_id     TEXT NOT NULL DEFAULT 'me',
        goal_type   TEXT NOT NULL CHECK (goal_type IN ('volume','speed','distance','habit','strength','health')),
        target      TEXT NOT NULL,
        current     TEXT,
        deadline    DATE,
        tolerance   TEXT,
        rationale   TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS personal_goals_user_idx ON personal_goals (user_id, created_at DESC);
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_checkin (
        id          BIGSERIAL PRIMARY KEY,
        user_id     TEXT NOT NULL DEFAULT 'me',
        date        DATE NOT NULL,
        energy      SMALLINT NOT NULL CHECK (energy BETWEEN 1 AND 10),
        soreness    SMALLINT NOT NULL CHECK (soreness BETWEEN 1 AND 10),
        stress      SMALLINT NOT NULL CHECK (stress BETWEEN 1 AND 10),
        notes       TEXT,
        logged_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, date)
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS daily_checkin_user_date_idx ON daily_checkin (user_id, date DESC);
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS profile (
        user_id     TEXT PRIMARY KEY DEFAULT 'me',
        full_name   TEXT,
        sex         TEXT,
        age         INTEGER,
        city        TEXT,
        runner_id   TEXT,
        since_year  INTEGER,
        hrmax       INTEGER,
        rhr         INTEGER,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_prefs (
        user_id        TEXT PRIMARY KEY DEFAULT 'me',
        long_run_day   TEXT,
        quality_days   TEXT,
        rest_day       TEXT,
        rest_cadence   TEXT,
        units          TEXT,
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // Plan-driving inputs surfaced by the Profile modal. These coexist
    // with the legacy string-based day columns above so old reads keep
    // working; the plan-builder reads the numeric dow + level columns.
    await client.query(`
      ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS level         TEXT;
    `);
    await client.query(`
      ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS long_run_dow  INTEGER;
    `);
    await client.query(`
      ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS quality_dows  TEXT;
    `);
    await client.query(`
      ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS rest_dow      INTEGER;
    `);

    // ── Plan-as-artifact schema (docs/PLAN_ARCHITECTURE.md §Database) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS training_plans (
        id              TEXT PRIMARY KEY,
        user_id         TEXT NOT NULL DEFAULT 'me',
        mode            TEXT NOT NULL CHECK (mode IN ('race-prep','maintenance')),
        race_id         TEXT,
        goal_iso        TEXT NOT NULL,
        authored_iso    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        authored_state  JSONB NOT NULL,
        archived_iso    TIMESTAMPTZ
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS training_plans_active
        ON training_plans (user_id) WHERE archived_iso IS NULL;
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS plan_phases (
        id              TEXT PRIMARY KEY,
        plan_id         TEXT NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
        label           TEXT NOT NULL,
        start_week_idx  INTEGER NOT NULL,
        end_week_idx    INTEGER NOT NULL,
        rationale       TEXT NOT NULL,
        citation        TEXT NOT NULL
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS plan_weeks (
        id              TEXT PRIMARY KEY,
        plan_id         TEXT NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
        week_idx        INTEGER NOT NULL,
        week_start_iso  TEXT NOT NULL,
        phase_id        TEXT NOT NULL REFERENCES plan_phases(id) ON DELETE CASCADE,
        is_cutback      BOOLEAN NOT NULL DEFAULT FALSE,
        is_peak         BOOLEAN NOT NULL DEFAULT FALSE,
        is_race_week    BOOLEAN NOT NULL DEFAULT FALSE,
        rationale       TEXT NOT NULL
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS plan_workouts (
        id                    TEXT PRIMARY KEY,
        plan_id               TEXT NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
        week_id               TEXT NOT NULL REFERENCES plan_weeks(id) ON DELETE CASCADE,
        date_iso              TEXT NOT NULL,
        dow                   INTEGER NOT NULL CHECK (dow BETWEEN 0 AND 6),
        type                  TEXT NOT NULL,
        distance_mi           NUMERIC NOT NULL,
        pace_target_s_per_mi  INTEGER,
        duration_min          INTEGER,
        is_quality            BOOLEAN NOT NULL DEFAULT FALSE,
        is_long               BOOLEAN NOT NULL DEFAULT FALSE,
        notes                 TEXT NOT NULL DEFAULT '',
        sub_label             TEXT,
        original_date_iso     TEXT NOT NULL,
        original_type         TEXT NOT NULL,
        original_distance_mi  NUMERIC NOT NULL
      );
    `);
    // Migration: add sub_label to existing plan_workouts tables.
    await client.query(`
      ALTER TABLE plan_workouts ADD COLUMN IF NOT EXISTS sub_label TEXT;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS plan_workouts_date
        ON plan_workouts (plan_id, date_iso);
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS plan_mutations (
        id                TEXT PRIMARY KEY,
        workout_id        TEXT NOT NULL REFERENCES plan_workouts(id) ON DELETE CASCADE,
        ts                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reason            TEXT NOT NULL,
        citation          TEXT NOT NULL,
        trigger_kind      TEXT NOT NULL,
        signal_snapshot   JSONB NOT NULL,
        changed_fields    JSONB NOT NULL
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS plan_mutations_by_ts
        ON plan_mutations (ts DESC);
    `);

    // ── skipped_workouts ──────────────────────────────────────────
    // Runner-initiated skips. Written by POST /api/plan/skip when the
    // runner clicks Skip Today on the hero card. Read by:
    //   • gatherCoachState (last 14 days roll into state.flags.recentSkips
    //     + state.skipCounts so adaptPlan can react)
    //   • /log page (surfaces skip rows alongside Strava runs)
    //   • coach.adaptPlan (a skip on a planned quality day fires a
    //     `runner-skip` mutation trigger per Research/00b §Decision Matrix)
    //
    // Uniqueness: (user_id, date) — re-clicking Skip on the same day
    // updates the row instead of duplicating. Undo deletes the row.
    await client.query(`
      CREATE TABLE IF NOT EXISTS skipped_workouts (
        id                    SERIAL PRIMARY KEY,
        user_id               TEXT NOT NULL DEFAULT 'me',
        date                  DATE NOT NULL,
        planned_workout_type  TEXT,
        planned_mi            NUMERIC,
        reason                TEXT,
        ts                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, date)
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS skipped_workouts_by_date
        ON skipped_workouts (user_id, date DESC);
    `);

    // ════════════════════════════════════════════════════════════════
    // MULTI-TENANT AUTH + CONNECTORS
    // Applied additively. Legacy `user_id TEXT='me'` columns stay until
    // every row has been claimed by a real users row (see backfill
    // below). The legacy + new columns coexist; readers should prefer
    // user_uuid when set.
    // ════════════════════════════════════════════════════════════════

    // Required extensions (pgcrypto for gen_random_uuid, citext for emails)
    await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
    await client.query(`CREATE EXTENSION IF NOT EXISTS citext;`);

    // users — one row per signed-up account
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email               CITEXT NOT NULL UNIQUE,
        password_hash       TEXT NOT NULL,
        email_verified_at   TIMESTAMPTZ,
        name                TEXT NOT NULL DEFAULT '',
        age                 INTEGER CHECK (age IS NULL OR (age >= 13 AND age <= 100)),
        sex                 TEXT CHECK (sex IS NULL OR sex IN ('M','F')),
        location            TEXT,
        avatar_mode         TEXT NOT NULL DEFAULT 'initials' CHECK (avatar_mode IN ('initials','upload','strava')),
        avatar_upload_url   TEXT,
        avatar_strava_url   TEXT,
        level               TEXT NOT NULL DEFAULT 'intermediate' CHECK (level IN ('beginner','intermediate','advanced','elite')),
        long_run_day        TEXT NOT NULL DEFAULT 'sun' CHECK (long_run_day IN ('mon','tue','wed','thu','fri','sat','sun')),
        quality_days        TEXT[] NOT NULL DEFAULT ARRAY['tue','thu']::TEXT[],
        rest_day            TEXT NOT NULL DEFAULT 'sat' CHECK (rest_day IN ('mon','tue','wed','thu','fri','sat','sun')),
        onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_login_at       TIMESTAMPTZ
      );
    `);

    // Approval gate — private beta until SIGNUP_REQUIRES_APPROVAL=false.
    // New signups land as 'pending' (unless email matches LEGACY_OWNER_EMAIL,
    // which auto-approves + auto-admins). Existing rows default to 'active'
    // so anyone already signed up doesn't get locked out by the rollout.
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('pending','active','denied'));
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL;
    `);
    // Auto-rename Strava activities to match the planned workout. On by
    // default. Toggle from /profile Connectors card.
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS strava_writeback BOOLEAN NOT NULL DEFAULT TRUE;
    `);
    // Heart-rate inputs for personalized debrief + training-load math.
    // Both nullable; coach falls back to qualitative bands when unset.
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS max_hr INTEGER
        CHECK (max_hr IS NULL OR (max_hr >= 100 AND max_hr <= 230));
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS resting_hr INTEGER
        CHECK (resting_hr IS NULL OR (resting_hr >= 30 AND resting_hr <= 100));
    `);
    // User-chosen brand accent color (`#RRGGBB`). Null falls back to the
    // canonical faff.run orange (#E85D26) in app/layout.tsx.
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS accent_color TEXT
        CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9A-Fa-f]{6}$');
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);`);

    // Auto-promote the legacy owner to admin + active on every boot so
    // we can never lock the founder out of the admin panel.
    const legacyOwner = (process.env.LEGACY_OWNER_EMAIL || 'dnitch85@me.com').toLowerCase();
    await client.query(
      `UPDATE users SET is_admin = TRUE, status = 'active', approved_at = COALESCE(approved_at, NOW())
       WHERE LOWER(email) = $1;`,
      [legacyOwner],
    );

    // sessions — cookie-token lookup (server-side session store)
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_token   TEXT NOT NULL UNIQUE,
        expires_at      TIMESTAMPTZ NOT NULL,
        ip_address      INET,
        user_agent      TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_used_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sessions_token   ON sessions (session_token);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions (user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);`);

    // connector_tokens — per-user OAuth credentials for every source
    await client.query(`
      CREATE TABLE IF NOT EXISTS connector_tokens (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider          TEXT NOT NULL CHECK (provider IN (
                            'strava','garmin','apple_health','coros','polar','suunto',
                            'wahoo','google_fit','final_surge','training_peaks','whoop','oura'
                          )),
        provider_user_id  TEXT,
        scope             TEXT,
        access_token      TEXT NOT NULL,
        refresh_token     TEXT,
        expires_at        TIMESTAMPTZ,
        metadata          JSONB NOT NULL DEFAULT '{}'::JSONB,
        last_sync_at      TIMESTAMPTZ,
        last_sync_status  TEXT CHECK (last_sync_status IS NULL OR last_sync_status IN ('success','error','in_progress','rate_limited')),
        last_sync_error   TEXT,
        activities_count  INTEGER NOT NULL DEFAULT 0,
        connected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        disconnected_at   TIMESTAMPTZ,
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, provider)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_connector_tokens_user ON connector_tokens (user_id) WHERE disconnected_at IS NULL;`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_connector_tokens_provider_user_id ON connector_tokens (provider, provider_user_id) WHERE disconnected_at IS NULL;`);

    // Link existing tables to users via nullable user_uuid FK columns.
    // Legacy user_id='me' rows keep working until they get claimed by
    // the backfill on first signup.
    for (const tbl of [
      'daily_checkin', 'personal_goals', 'profile', 'user_prefs',
      'training_plans', 'skipped_workouts', 'recovery_sessions',
      'shoes', 'strava_activities', 'races',
    ]) {
      await client.query(`ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS user_uuid UUID REFERENCES users(id) ON DELETE CASCADE;`);
    }
  } finally {
    client.release();
  }
}

/**
 * Backfill claim — runs once on first signup. If the new user's email
 * matches LEGACY_OWNER_EMAIL (set via env var; defaults to dnitch85@me.com),
 * every existing user_id='me' row is reassigned to their UUID.
 *
 * Called from the signup route after a successful insert into users.
 * Idempotent: subsequent calls find no 'me' rows and do nothing.
 */
export async function maybeBackfillLegacyOwner(userId: string, email: string): Promise<void> {
  const legacy = (process.env.LEGACY_OWNER_EMAIL || 'dnitch85@me.com').toLowerCase();
  if (email.toLowerCase() !== legacy) return;
  await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      // Tables that keyed by user_id TEXT
      for (const tbl of ['daily_checkin', 'personal_goals', 'profile', 'user_prefs', 'training_plans', 'skipped_workouts']) {
        await client.query(`UPDATE ${tbl} SET user_uuid = $1 WHERE user_id = 'me' AND user_uuid IS NULL;`, [userId]);
      }
      // Tables that have no user_id column — claim everything that's still unclaimed
      for (const tbl of ['recovery_sessions', 'shoes', 'strava_activities', 'races']) {
        await client.query(`UPDATE ${tbl} SET user_uuid = $1 WHERE user_uuid IS NULL;`, [userId]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });
}

/** Test helper — drops all app tables. Never call in production. */
export async function _resetSchemaForTests(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('refusing to reset schema in production');
  const client = await getPool().connect();
  try {
    await client.query('DROP TABLE IF EXISTS races, strava_activities, strava_sync_state CASCADE;');
    schemaReady = false;
  } finally {
    client.release();
  }
}
