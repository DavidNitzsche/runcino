-- 155_goal_projection_snapshots.sql
-- Daily snapshot of computeGoalProjection's trajectory-projected finish time
-- for a runner's next A race, so a push can fire when it moves >= 30s.
--
-- Distinct from projection_snapshots (123/124/125): that table stores the
-- raw VDOT-derived predictRaceTime(vdot, distance) for the canonical HM/M
-- distances, which is the number "Projected" USED to read before
-- 878c623c. This table stores the execution-scaled trajectory number the
-- Races card reads NOW (goal-projection.ts's computeGoalProjection), keyed
-- to the runner's actual goal race rather than a fixed distance. The two
-- are different models of different things; this is not a rename of that
-- table, it is a snapshot of a different value that did not exist before.
--
-- Write path: /api/cron/snapshot-projections, once daily per user, after
-- resolving the user's next A race.
-- Read path: lib/notifications/projection-changed.ts diffs today's row
-- against the most recent prior row to decide whether to push.
--
-- Additive only: one new table, one new index. Idempotent.
--
-- REVERSED BY: DROP TABLE IF EXISTS goal_projection_snapshots;
-- (append-only log; no other table reads it)

CREATE TABLE IF NOT EXISTS goal_projection_snapshots (
  id             bigserial PRIMARY KEY,
  user_uuid      uuid NOT NULL,
  race_slug      text NOT NULL,
  snapshot_date  date NOT NULL,
  projected_sec  integer,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_uuid, race_slug, snapshot_date)
);

CREATE INDEX IF NOT EXISTS goal_projection_snapshots_lookup_idx
  ON goal_projection_snapshots (user_uuid, race_slug, snapshot_date DESC);

COMMENT ON TABLE goal_projection_snapshots IS
  'Daily trajectory-projected finish time (computeGoalProjection) per user '
  'per goal race. Diffed day-over-day to gate the projection-change push.';
