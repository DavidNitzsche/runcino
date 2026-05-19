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
    // Multi-tenant: add user_uuid to races so each user's races are
    // scoped to them. Existing rows have user_uuid=NULL and remain
    // visible to all users until backfilled — query pattern is
    // `WHERE (user_uuid = $1 OR user_uuid IS NULL)` so no regression.
    await client.query(`
      ALTER TABLE races
        ADD COLUMN IF NOT EXISTS user_uuid UUID REFERENCES users(id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS races_user_uuid_idx ON races (user_uuid);
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
    // Auto-assign attribution: when syncSingleActivity's shoe-picker
    // assigned the row, the timestamp is set here. Manual user picks
    // CLEAR this column — once the user touches the field, the row
    // is no longer auto-attributed even if they pick the same shoe.
    // The /runs/[id] UI reads `auto_assigned = (shoe_auto_assigned_at
    // IS NOT NULL)` to render the "auto-assigned as your easy-day
    // shoe" caption.
    await client.query(`
      ALTER TABLE strava_activities
        ADD COLUMN IF NOT EXISTS shoe_auto_assigned_at TIMESTAMPTZ;
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
    // Apple Health VO2max — WELLNESS signal (never a training signal).
    // Range 25-90 covers untrained → elite. Stored manually because
    // HealthKit integration is M2; written via /api/profile/vo2-max.
    // NOT used by VDOT / pace / feasibility / zone code; only cold-start
    // fallback when no race data exists. See lib/vo2max-apple.ts.
    await client.query(`
      ALTER TABLE profile
        ADD COLUMN IF NOT EXISTS vo2max_apple INTEGER
        CHECK (vo2max_apple IS NULL OR (vo2max_apple BETWEEN 25 AND 90));
    `);
    await client.query(`
      ALTER TABLE profile
        ADD COLUMN IF NOT EXISTS vo2max_apple_updated_at TIMESTAMPTZ;
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
    // Pace-migration acknowledgment — set when the user confirms the
    // one-time pace-band correction from the legacy race-pace-derived
    // formula to canonical Daniels Table 2. While NULL, /profile's
    // Coach Reads card surfaces a migration banner explaining the
    // canonical correction. POST /api/profile/acknowledge-pace-migration
    // sets the timestamp. See web/scripts/sim-sweep-pace-bands.ts +
    // docs/2026-05-19-sim-sweep.md for the migration diff context.
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS pace_migration_ack_at TIMESTAMPTZ;
    `);
    // Adaptive-recommendation dismissals — when the user clicks
    // "Keep current" on a max-HR validation prompt, the timestamp
    // here suppresses the banner for 30 days OR until new evidence
    // overrides (validated peak ≥ stored+3 bpm). See
    // lib/validate-max-hr.ts.
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS max_hr_validation_dismissed_at TIMESTAMPTZ;
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

    // Data-migration tracking table — guards one-shot data fixups so
    // they run exactly once across deploys.
    await client.query(`
      CREATE TABLE IF NOT EXISTS data_migrations (
        name        TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── Run one-time data migrations ────────────────────────────
    await runDataMigrations(client);
  } finally {
    client.release();
  }
}

/** One-shot data migrations run after schema bootstrap. Each named
 *  migration runs exactly once (guarded by `data_migrations` table)
 *  so deploys don't keep re-applying them. */
async function runDataMigrations(client: PoolClient): Promise<void> {
  // ── 2026-05-19 · race priorities + Rose Bowl seed + pace-ack ──
  //
  // David's overnight review on 2026-05-19 produced three corrections
  // that should apply automatically on the next deploy (he explicitly
  // asked NOT to click admin endpoints to apply them):
  //
  //   1. Race priorities:
  //      la-marathon-2026     → 'A'   (was B)
  //      big-sur-marathon     → 'A'   (David trained for the elevation)
  //      disney-half-2026     → 'A'   (was B)
  //      sombrero-half        → 'C'   (tune-up race, not goal-tier effort)
  //
  //   2. Rose Bowl Half (David's Jan 18 race that wasn't in the curated
  //      table). Auto-detected from strava_activities by date+distance.
  //
  //   3. Auto-acknowledge the pace migration banner for the admin
  //      user. Sim sweep was clean; David said "ship the pace band
  //      migration based on it" — so set users.pace_migration_ack_at
  //      automatically rather than requiring a click.
  const MIG_NAME = '2026-05-19-race-priorities-and-rose-bowl';
  const already = await client.query<{ name: string }>(
    `SELECT name FROM data_migrations WHERE name = $1 LIMIT 1`,
    [MIG_NAME],
  );
  if (already.rows.length > 0) return;

  try {
    // 1a. Priority bumps. Match by slug (primary key) — works without
    //     user_uuid scoping because slugs are globally unique.
    await client.query(
      `UPDATE races
          SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{priority}', '"A"'::jsonb)
        WHERE slug IN ('la-marathon-2026', 'big-sur-marathon', 'disney-half-2026')`,
    );
    // 1b. Sombrero → C
    await client.query(
      `UPDATE races
          SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{priority}', '"C"'::jsonb)
        WHERE slug = 'sombrero-half'`,
    );

    // 2. Rose Bowl seed — only if not already present.
    const roseExists = await client.query<{ slug: string }>(
      `SELECT slug FROM races WHERE slug = 'rose-bowl-half-2026' LIMIT 1`,
    );
    if (roseExists.rows.length === 0) {
      // Find the Strava activity around 2026-01-18 with HM distance.
      const candidates = await client.query<{
        id: string; date: string; name: string;
        distance_mi: string; canonical_finish_s: string | null;
        moving_time_s: string; avg_hr: string | null;
      }>(
        `SELECT
            id::text                                  AS id,
            data->>'date'                             AS date,
            COALESCE(data->>'name', '')               AS name,
            (data->>'distanceMi')::NUMERIC::TEXT      AS distance_mi,
            data->>'canonicalFinishS'                 AS canonical_finish_s,
            (data->>'movingTimeS')::NUMERIC::TEXT     AS moving_time_s,
            data->>'avgHr'                            AS avg_hr
           FROM strava_activities
          WHERE (data->>'date') BETWEEN '2026-01-13' AND '2026-01-23'
            AND (data->>'distanceMi')::NUMERIC BETWEEN 12.5 AND 13.7
            AND (data->>'movingTimeS')::NUMERIC > 0
          ORDER BY ABS((data->>'date')::DATE - DATE '2026-01-18') ASC
          LIMIT 1`,
      );
      const pick = candidates.rows[0];
      if (pick) {
        const finishS = pick.canonical_finish_s != null
          ? Math.round(Number(pick.canonical_finish_s))
          : Math.round(Number(pick.moving_time_s));
        const distMi = 13.109;
        const paceSPerMi = finishS / distMi;
        const fmtFinish = (s: number) => {
          const h = Math.floor(s / 3600);
          const m = Math.floor((s % 3600) / 60);
          const sec = s % 60;
          return h > 0
            ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
            : `${m}:${String(sec).padStart(2, '0')}`;
        };
        const fmtPace = (sPerMi: number) => {
          const m = Math.floor(sPerMi / 60);
          const s = Math.round(sPerMi % 60);
          return `${m}:${String(s).padStart(2, '0')}/mi`;
        };
        const actualResult = {
          finishS,
          finishDisplay: fmtFinish(finishS),
          paceSPerMi: Math.round(paceSPerMi),
          paceDisplay: fmtPace(paceSPerMi),
          recordedAt: new Date().toISOString(),
          source: 'manual',
          stravaActivityId: Number(pick.id),
          avgHr: pick.avg_hr != null ? Math.round(Number(pick.avg_hr)) : null,
        };
        const plan = {
          meta: {
            name: 'Rose Bowl Half', date: pick.date, distanceMi: distMi,
            goalDisplay: actualResult.finishDisplay, courseSlug: 'rose-bowl-half-2026',
          },
          miles: [], segments: [],
        };
        const meta = {
          name: 'Rose Bowl Half', date: pick.date, distanceMi: distMi,
          goalDisplay: actualResult.finishDisplay, courseSlug: 'rose-bowl-half-2026',
          priority: 'A',
        };
        // Scope to the admin user (David). If no admin found yet, leave
        // user_uuid NULL; the existing query pattern still picks it up.
        const adminRows = await client.query<{ id: string }>(
          `SELECT id FROM users WHERE is_admin = TRUE ORDER BY created_at ASC LIMIT 1`,
        );
        const adminId = adminRows.rows[0]?.id ?? null;
        await client.query(
          `INSERT INTO races (slug, plan, gpx_text, meta, actual_result, user_uuid, saved_at)
           VALUES ($1, $2::jsonb, $3, $4::jsonb, $5::jsonb, $6, NOW())
           ON CONFLICT (slug) DO NOTHING`,
          [
            'rose-bowl-half-2026',
            JSON.stringify(plan),
            '',
            JSON.stringify(meta),
            JSON.stringify(actualResult),
            adminId,
          ],
        );
      }
    }

    // 3. Auto-acknowledge pace migration for the admin user. The sim
    //    sweep (docs/2026-05-19-sim-sweep.md) cleared the canonical
    //    Daniels migration — David said "ship it based on the sim
    //    sweep alone" so we apply the ack automatically rather than
    //    waiting for a click.
    await client.query(
      `UPDATE users
          SET pace_migration_ack_at = COALESCE(pace_migration_ack_at, NOW())
        WHERE is_admin = TRUE`,
    );

    // Record the migration so it doesn't run again.
    await client.query(
      `INSERT INTO data_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
      [MIG_NAME],
    );
  } catch (e) {
    // Don't crash the bootstrap on migration failure — log and skip.
    // If the migration fails partially, the next request will retry
    // (since data_migrations name wasn't recorded).
    console.error('[data-migrations] 2026-05-19 migration failed:', e);
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
