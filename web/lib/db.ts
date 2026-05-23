/**
 * Postgres pool + schema bootstrap.
 *
 * Single shared `pg.Pool` for the app. Schema lives here too: tables
 * are created on first query via `ensureSchema()`, idempotent. No
 * separate migration runner, the schema is small enough that
 * conditional CREATEs cover us through M0/M1.
 *
 * Connection comes from DATABASE_URL (Railway sets this automatically
 * when a Postgres service is referenced from the faff service).
 * Locally, set DATABASE_URL in web/.env.local pointing at any reachable
 * Postgres (e.g. `postgres://localhost/faff`).
 *
 * SSL: Railway's internal Postgres routing requires no SSL between
 * services in the same project, but external connections do. We
 * detect by URL host, `*.railway.internal` skips SSL, anything else
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
    throw new Error('DATABASE_URL not set, Postgres is required. Locally, point it at any Postgres; on Railway, reference the Postgres service from faff.');
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
  // be free to pass non-index-signatured types, cast through unknown.
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
    // visible to all users until backfilled, query pattern is
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
    // CLEAR this column, once the user touches the field, the row
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
    // Multi-tenant unique key: one check-in per (real user, date). The legacy
    // UNIQUE(user_id,date) hardcodes user_id='me' for every authenticated
    // POST, which means two users on the same date would conflict and
    // overwrite each other. This partial unique on user_uuid is the proper
    // per-user constraint; the POST upserts against it for real users and
    // keeps the legacy ('me', date) path for anonymous demo writes.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS daily_checkin_uuid_date_uq
        ON daily_checkin (user_uuid, date) WHERE user_uuid IS NOT NULL;
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
    // Apple Health VO2max, WELLNESS signal (never a training signal).
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
        changed_fields    JSONB NOT NULL,
        -- 'applied' (auto), 'proposed' (awaiting runner approval for big
        -- changes), or 'declined'. See plan-adapter requiresApproval.
        status            TEXT NOT NULL DEFAULT 'applied'
      );
    `);
    // Existing tables predate the status column.
    await client.query(`ALTER TABLE plan_mutations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'applied';`);
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
    // Uniqueness: (user_id, date), re-clicking Skip on the same day
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

    // users, one row per signed-up account
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

    // Approval gate, private beta until SIGNUP_REQUIRES_APPROVAL=false.
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
    // Split: max_hr / resting_hr are the AUTO values (Apple Health ingest
    // ratchets them); *_override are the runner's MANUAL override, which
    // wins until cleared. Previously the manual edit and Apple ingest both
    // wrote max_hr, so whichever ran last won, overrides got clobbered.
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS max_hr_override INTEGER
        CHECK (max_hr_override IS NULL OR (max_hr_override >= 100 AND max_hr_override <= 230));
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS resting_hr_override INTEGER
        CHECK (resting_hr_override IS NULL OR (resting_hr_override >= 30 AND resting_hr_override <= 100));
    `);
    // User-chosen brand accent color (`#RRGGBB`). Null falls back to the
    // canonical faff.run orange (#E85D26) in app/layout.tsx.
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS accent_color TEXT
        CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9A-Fa-f]{6}$');
    `);
    // IANA timezone identifier reported by the user's device (e.g.
    // "America/Los_Angeles"). Drives every "today"/date computation so a
    // run logged at 6 PM local is dated today, not tomorrow (UTC). NULL
    // falls back to the app-default FAFF_TZ in lib/dates.ts.
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT;
    `);
    // Fueling preference — the runner's chosen gel product. Drives the
    // training-fueling planner (lib/training-fueling.ts) so plans count
    // the runner's ACTUAL gels (a 25g Maurten 100 vs a 40g Maurten 160 vs
    // a 22g GU) and prompts read "2 Maurten 100s" instead of generic
    // "2 gels". fuel_target_g_per_hr is the race-day carb-intake target;
    // long-run plans ramp toward it via Costa periodization (Research/18
    // §13). All NULL-safe: defaults kick in when unset.
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS fuel_brand TEXT;
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS fuel_gel_carbs_g SMALLINT
        CHECK (fuel_gel_carbs_g IS NULL OR (fuel_gel_carbs_g BETWEEN 10 AND 80));
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS fuel_target_g_per_hr SMALLINT
        CHECK (fuel_target_g_per_hr IS NULL OR (fuel_target_g_per_hr BETWEEN 30 AND 120));
    `);
    // Pace-migration acknowledgment, set when the user confirms the
    // one-time pace-band correction from the legacy race-pace-derived
    // formula to canonical Daniels Table 2. While NULL, /profile's
    // Coach Reads card surfaces a migration banner explaining the
    // canonical correction. POST /api/profile/acknowledge-pace-migration
    // sets the timestamp. See web/scripts/sim-sweep-pace-bands.ts +
    // docs/2026-05-19-sim-sweep.md for the migration diff context.
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS pace_migration_ack_at TIMESTAMPTZ;
    `);

    // L7 · Passive VDOT updater · adaptive VDOT bump state
    //
    // vdot_manual_override:
    //   Set when the user clicks Apply on an adaptive-VDOT-bump banner.
    //   compute-vdot uses this value INSTEAD of the race-derived
    //   aggregate, until a new race result lands AFTER override_at
    //   (the new race result then clears the override automatically, 
    //   race-first source-of-truth still wins long term, but training
    //   evidence can move the displayed VDOT between races).
    //
    // vdot_manual_override_at:
    //   Timestamp the override was set. Used to detect "new race
    //   since override", if any race result post-dates this, the
    //   override is considered stale and ignored.
    //
    // adaptive_vdot_dismissed_at:
    //   Set when the user clicks "Keep current" on the adaptive-VDOT
    //   banner. Suppresses the banner for 30 days OR until new
    //   evidence (e.g., 3 more corroborating workouts) appears.
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS vdot_manual_override NUMERIC(4,1)
        CHECK (vdot_manual_override IS NULL OR (vdot_manual_override >= 20 AND vdot_manual_override <= 90));
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS vdot_manual_override_at TIMESTAMPTZ;
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS adaptive_vdot_dismissed_at TIMESTAMPTZ;
    `);

    // Ongoing large-shift guard · "VDOT moved >2pts since last review"
    //
    // vdot_last_reviewed:
    //   The aggregate VDOT value the user last acknowledged. Set on
    //   first-time profile load (baseline), bumped to current on Apply
    //   for the shift-guard banner, on Apply for the L7 adaptive-VDOT
    //   banner, and on manual override clear.
    //
    // vdot_last_reviewed_at: timestamp of the last review event.
    //
    // vdot_shift_dismissed_at: 30-day suppress when user clicks
    //   Dismiss on the shift-guard banner.
    //
    // vdot_shift_snoozed_at: 24-hour snooze when user clicks
    //   Investigate (intent: "I'm looking into this, come back tomorrow").
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS vdot_last_reviewed NUMERIC(4,1);
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS vdot_last_reviewed_at TIMESTAMPTZ;
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS vdot_shift_dismissed_at TIMESTAMPTZ;
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS vdot_shift_snoozed_at TIMESTAMPTZ;
    `);

    // E1 + E4 · Strava activity gap tracking
    //
    // activity_gap_status:
    //   'planned' · user marked planned break (E1 silent for 7 days OR
    //               until next activity)
    //   'injured' · user marked injured (L7 signals + V5 suspended
    //               until next activity)
    //   NULL      · no mark; gap surfaces fire per state machine in
    //               lib/strava-gap.ts
    //
    // activity_gap_at: timestamp of the mark
    // activity_gap_resume_at: timestamp of auto-clear when activity resumes
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS activity_gap_status TEXT
        CHECK (activity_gap_status IS NULL OR activity_gap_status IN ('planned', 'injured'));
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS activity_gap_at TIMESTAMPTZ;
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS activity_gap_resume_at TIMESTAMPTZ;
    `);

    // L7 Signal 1 context filters · workout weather cache
    //
    // Caches Open-Meteo historical archive lookups for (lat, lon, date)
    // triples so the adaptive-VDOT signal evaluator doesn't refetch
    // weather every render. lat/lon are stored rounded to 0.1° (~10 km
    // grid), workouts near each other share a row, neighbourhood noise
    // collapses to a single cache entry. See lib/workout-weather.ts.
    await client.query(`
      CREATE TABLE IF NOT EXISTS workout_weather_cache (
        lat_round       NUMERIC(4,1) NOT NULL,
        lon_round       NUMERIC(5,1) NOT NULL,
        date            DATE NOT NULL,
        temperature_f   INTEGER,
        fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (lat_round, lon_round, date)
      );
    `);
    // Adaptive-recommendation dismissals, when the user clicks
    // "Keep current" on a max-HR validation prompt, the timestamp
    // here suppresses the banner for 30 days OR until new evidence
    // overrides (validated peak ≥ stored+3 bpm). See
    // lib/validate-max-hr.ts.
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS max_hr_validation_dismissed_at TIMESTAMPTZ;
    `);
    // V7 item 4 · timestamp of last max HR change.  Used by the Z2
    // sparkline cross-reference to detect whether recent zone-data
    // reflects a recalibration (zones changed mid-window vs. settled
    // history vs. fully in new framework).  Set by the max-hr Apply
    // endpoint; null when max HR has never been set.
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS max_hr_updated_at TIMESTAMPTZ;
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);`);

    // health_samples, time-series storage for HealthKit ingest data
    // (Phase 1 item 3 of the iPhone-bridge work).  Stores anything the
    // iPhone bridge pushes from HealthKit: sleep hours per night,
    // workout average HR, etc.  Dedicated columns (users.resting_hr,
    // profile.vo2max_apple) remain the "latest value" cache for fast
    // reads; this table is the durable time-series source.
    //
    // Idempotent ingest: UNIQUE(user_id, sample_type, sample_date)
    // means re-sending the same sample (Apple Health reconnects can
    // re-emit) UPSERTs rather than duplicating.
    await client.query(`
      CREATE TABLE IF NOT EXISTS health_samples (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        sample_type     TEXT NOT NULL,
        value           NUMERIC NOT NULL,
        sample_date     DATE NOT NULL,
        source          TEXT NOT NULL DEFAULT 'apple_health',
        metadata        JSONB,
        recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, sample_type, sample_date)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_health_samples_user_type_date ON health_samples (user_id, sample_type, sample_date DESC);`);

    // workout_completions, structured result of executing a watch
    // workout (docs/native/01-watchos-scoping.md §6).  The companion
    // endpoint POST /api/watch/workouts/complete writes here; distinct
    // from health_samples (biometric time-series).  Stores prescribed-
    // vs-executed per-interval data in the phases JSONB so coaching
    // surfaces can compare on next render.
    //
    // Idempotent: UNIQUE(user_id, workout_id), the iPhone HealthKit
    // observer can fire more than once for the same completed workout,
    // so re-POSTing the same workoutId UPSERTs rather than duplicating.
    await client.query(`
      CREATE TABLE IF NOT EXISTS workout_completions (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        workout_id         TEXT NOT NULL,
        status             TEXT NOT NULL,
        started_at         TIMESTAMPTZ NOT NULL,
        completed_at       TIMESTAMPTZ NOT NULL,
        total_distance_mi  NUMERIC,
        total_duration_sec INTEGER NOT NULL,
        avg_hr             INTEGER,
        max_hr             INTEGER,
        phases             JSONB NOT NULL,
        source             TEXT NOT NULL DEFAULT 'apple_watch',
        recorded_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, workout_id)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_workout_completions_user_date ON workout_completions (user_id, completed_at DESC);`);

    // workout_routes, GPS route + per-mile splits read from an Apple Health
    // HKWorkoutRoute (watch-only runs that never reach Strava). The iPhone
    // POSTs to /api/watch/route; /api/runs/by-date serves the polyline + splits
    // so the recap shows a map for watch-only runs. Keyed by start time to
    // dedupe re-uploads; route_date is the local run day for date lookups.
    await client.query(`
      CREATE TABLE IF NOT EXISTS workout_routes (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        route_date    DATE NOT NULL,
        started_at    TIMESTAMPTZ NOT NULL,
        distance_mi   NUMERIC,
        duration_sec  INTEGER,
        polyline      TEXT NOT NULL,
        start_lat     DOUBLE PRECISION,
        start_lng     DOUBLE PRECISION,
        end_lat       DOUBLE PRECISION,
        end_lng       DOUBLE PRECISION,
        splits        JSONB NOT NULL DEFAULT '[]',
        source        TEXT NOT NULL DEFAULT 'apple_health',
        recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, started_at)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_workout_routes_user_date ON workout_routes (user_id, route_date DESC);`);

    // Auto-promote the legacy owner to admin + active on every boot so
    // we can never lock the founder out of the admin panel.
    const legacyOwner = (process.env.LEGACY_OWNER_EMAIL || 'dnitch85@me.com').toLowerCase();
    await client.query(
      `UPDATE users SET is_admin = TRUE, status = 'active', approved_at = COALESCE(approved_at, NOW())
       WHERE LOWER(email) = $1;`,
      [legacyOwner],
    );

    // sessions, cookie-token lookup (server-side session store)
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

    // Native token auth (S6/iPhone-bridge phase 1) · extend sessions
    // to support three token kinds:
    //   · 'cookie'  · existing web cookie session · 30d TTL
    //   · 'access'  · native Bearer token · 24h TTL
    //   · 'refresh' · native refresh token · 90d TTL
    //
    // All three are opaque 32-byte tokens stored hashed at rest.  No
    // JWT, no separate table, single auth machinery serves all three
    // surfaces.  revoked_at marks a token as no longer valid (refresh
    // rotation, logout, suspected leak).
    //
    // Existing 'cookie' rows have kind='cookie' via the DEFAULT.  No
    // backfill needed.
    await client.query(`
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'cookie';
    `);
    await client.query(`
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sessions_user_kind ON sessions (user_id, kind);`);

    // connector_tokens, per-user OAuth credentials for every source
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

    // Data-migration tracking table, guards one-shot data fixups so
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
  // ── 2026-05-21 · claim legacy 'me' connector_tokens to the owner ──
  //
  // The signup backfill (maybeBackfillLegacyOwner) reassigned the user_uuid
  // tables and the user_id-text tables, but MISSED connector_tokens, which
  // is keyed by user_id (text). So the owner's Strava OAuth row stayed under
  // 'me' while strava_activities got claimed to the owner's UUID. Result:
  // listUserConnectors(ownerId) returned nothing, and every client showed
  // Strava as "Connect" despite a live, syncing connection.
  //
  // Reassign each legacy 'me' connector to the owner, per-provider, skipping
  // any provider the owner already holds (so we never violate the
  // (user_id, provider) uniqueness, e.g. an apple_health row from ingest).
  // Self-gated by its own name so it runs regardless of the block below.
  const CONN_MIG = '2026-05-21-claim-connector-tokens';
  const connDone = await client.query<{ name: string }>(
    `SELECT name FROM data_migrations WHERE name = $1 LIMIT 1`, [CONN_MIG],
  );
  if (connDone.rows.length === 0) {
    try {
      const legacy = (process.env.LEGACY_OWNER_EMAIL || 'dnitch85@me.com').toLowerCase();
      const owner = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1`, [legacy],
      );
      const ownerId = owner.rows[0]?.id;
      if (ownerId) {
        await client.query(
          `UPDATE connector_tokens ct
              SET user_id = $1, updated_at = NOW()
            WHERE ct.user_id = 'me'
              AND ct.disconnected_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM connector_tokens o
                 WHERE o.user_id = $1 AND o.provider = ct.provider
                   AND o.disconnected_at IS NULL)`,
          [ownerId],
        );
      }
      await client.query(
        `INSERT INTO data_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
        [CONN_MIG],
      );
    } catch (e) {
      console.error('[data-migrations] connector_tokens claim failed:', e);
    }
  }

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
  //      migration based on it", so set users.pace_migration_ack_at
  //      automatically rather than requiring a click.
  // Round 2 extension (David 2026-05-19): "Big Sur still at 17%
  // weight, VDOT 42.9, eats ~0.7 VDOT points. L2 (hilly-course
  // exclusion) remains the highest-leverage remaining unlock. Ship
  // it." The UI for hilly-excluded was shipped in ec5d5b6; this
  // migration also applies it for Big Sur so David doesn't have to
  // click. Bumping the migration name to force the new block to
  // run after the first migration already recorded.
  const MIG_NAME = '2026-05-19-race-priorities-and-rose-bowl-r2';
  const already = await client.query<{ name: string }>(
    `SELECT name FROM data_migrations WHERE name = $1 LIMIT 1`,
    [MIG_NAME],
  );
  if (already.rows.length > 0) return;

  try {
    // 1a. Priority bumps. Match by slug (primary key), works without
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
    // 1c. Big Sur → hilly-excluded (round 2: David authorized this
    //     directly; Big Sur was eating 17% of aggregate at VDOT
    //     42.9 because of elevation-distorted finish time, not
    //     fitness).
    await client.query(
      `UPDATE races
          SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{priority}', '"hilly-excluded"'::jsonb)
        WHERE slug = 'big-sur-marathon'`,
    );

    // 2. Rose Bowl seed, only if not already present.
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
    //    Daniels migration, David said "ship it based on the sim
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
    // Don't crash the bootstrap on migration failure, log and skip.
    // If the migration fails partially, the next request will retry
    // (since data_migrations name wasn't recorded).
    console.error('[data-migrations] 2026-05-19 migration failed:', e);
  }
}

/**
 * Backfill claim, runs once on first signup. If the new user's email
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
      // Tables that have no user_id column, claim everything that's still unclaimed
      for (const tbl of ['recovery_sessions', 'shoes', 'strava_activities', 'races']) {
        await client.query(`UPDATE ${tbl} SET user_uuid = $1 WHERE user_uuid IS NULL;`, [userId]);
      }
      // connector_tokens is keyed by user_id (text), reassign legacy 'me'
      // rows, skipping any provider the new owner already holds so the
      // (user_id, provider) uniqueness is never violated.
      await client.query(
        `UPDATE connector_tokens ct SET user_id = $1, updated_at = NOW()
          WHERE ct.user_id = 'me' AND ct.disconnected_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM connector_tokens o
                             WHERE o.user_id = $1 AND o.provider = ct.provider
                               AND o.disconnected_at IS NULL);`,
        [userId],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });
}

/** Test helper, drops all app tables. Never call in production. */
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
