-- 124_projection_snapshots.sql
--
-- Daily VDOT + projection snapshots for trend computation.
--
-- Today's race-header.ts re-computes "VDOT as of N days ago" by re-running
-- the VDOT chain with race+run data filtered to date < (today - N). That
-- works but is O(N) DB queries per /today request. Snapshots persist the
-- computation once per day so trend reads are O(1).
--
-- One row per (user, snapshot_date, distance_mi) — multiple race distances
-- can be projected from the same VDOT, so distance is part of the key.
-- race_slug is the race the projection was anchored to (nullable for
-- maintenance-mode runners with no race anchor).
--
-- Cron writes daily at 00:30 local. Re-running the cron is idempotent via
-- the UNIQUE constraint.
--
-- Apply with: psql $DATABASE_URL -f web-v2/db/migrations/124_projection_snapshots.sql

CREATE TABLE IF NOT EXISTS projection_snapshots (
  id              bigserial PRIMARY KEY,
  user_uuid       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot_date   date NOT NULL,
  distance_mi     numeric NOT NULL,
  vdot            numeric(4,1),
  projection_sec  integer,
  race_slug       text,
  source          text NOT NULL DEFAULT 'cron',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_uuid, snapshot_date, distance_mi)
);

CREATE INDEX IF NOT EXISTS projection_snapshots_user_date_idx
  ON projection_snapshots (user_uuid, snapshot_date DESC);

COMMENT ON TABLE projection_snapshots IS
  'Daily snapshot of (VDOT, projection_sec) per user per race distance. '
  'Powers projection-trend reads in race-header.ts without re-running the '
  'full VDOT chain on every page load.';

COMMENT ON COLUMN projection_snapshots.vdot IS
  'VDOT computed at snapshot time using bestRecentVdot(races, runs, asOf=date).';

COMMENT ON COLUMN projection_snapshots.projection_sec IS
  'predictRaceTime(vdot, distance_mi) at snapshot time. Cached so trend deltas '
  'are O(1) reads against this table rather than O(180d) recomputes.';
