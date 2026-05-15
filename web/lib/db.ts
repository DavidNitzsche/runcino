/**
 * Postgres pool + schema bootstrap.
 *
 * Single shared `pg.Pool` for the app. Schema lives here too: tables
 * are created on first query via `ensureSchema()`, idempotent. No
 * separate migration runner — the schema is small enough that
 * conditional CREATEs cover us through M0/M1.
 *
 * Connection comes from DATABASE_URL (Railway sets this automatically
 * when a Postgres service is referenced from the runcino service).
 * Locally, set DATABASE_URL in web/.env.local pointing at any reachable
 * Postgres (e.g. `postgres://localhost/runcino`).
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
    throw new Error('DATABASE_URL not set — Postgres is required. Locally, point it at any Postgres; on Railway, reference the Postgres service from runcino.');
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
  } finally {
    client.release();
  }
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
