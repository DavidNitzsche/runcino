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
    // Single-row runner profile (no auth yet — assumes one runner per
    // deploy). When auth lands, add a user_id PK + drop the singleton
    // constraint. Fields all nullable so an empty profile is valid.
    await client.query(`
      CREATE TABLE IF NOT EXISTS runner_profile (
        id            INTEGER PRIMARY KEY DEFAULT 1,
        birth_year    INTEGER,
        sex           TEXT,
        hrmax_bpm     INTEGER,
        rhr_bpm       INTEGER,
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT runner_profile_singleton CHECK (id = 1)
      );
    `);
    // Migrate birth_year → birth_date so age computation can handle
    // "has the birthday passed yet". Keep birth_year column populated
    // (derived from birth_date) for any legacy reader. If only year
    // is known, birth_date will be null and we fall back to year-only
    // age (with the +/- 1 imprecision the user just flagged).
    await client.query(`
      ALTER TABLE runner_profile
        ADD COLUMN IF NOT EXISTS birth_date DATE;
    `);
    // Cache for the dashboard's /api/coach/today payload. Keyed by
    // (cache_date, latest_activity_id) so reads are cheap and the
    // cache auto-invalidates when a new activity lands. Pre-warmed
    // by the Strava webhook + a midnight cron.
    await client.query(`
      CREATE TABLE IF NOT EXISTS coach_today_cache (
        id                  SERIAL PRIMARY KEY,
        cache_date          DATE NOT NULL,
        latest_activity_id  BIGINT,
        payload             JSONB NOT NULL,
        computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (cache_date, latest_activity_id)
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS coach_today_cache_date_idx
        ON coach_today_cache (cache_date DESC, computed_at DESC);
    `);
    // Workout RPE log — runner self-reports how today's workout felt
    // on a 1-10 scale (Borg CR-10 / RPE) along with optional notes.
    // One entry per (workout_date) — re-saving the same date overwrites,
    // so the runner can correct their answer if they tap wrong. Engine
    // consumes recent RPE entries to detect drift between prescribed
    // load and perceived load (a "Recovery 5/10" + "Hard 7/10" pattern
    // says volume is fine but sessions feel heavier than expected).
    await client.query(`
      CREATE TABLE IF NOT EXISTS workout_rpe (
        workout_date  DATE PRIMARY KEY,
        rpe           SMALLINT NOT NULL CHECK (rpe BETWEEN 1 AND 10),
        notes         TEXT,
        recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
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
