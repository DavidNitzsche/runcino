-- 159_travel_windows.sql
-- Travel windows · runner-declared travel as a first-class plan input.
--
-- Owner ruling (2026-08-28): "traveling but I'll want to stay as consistent
-- with my runs as possible. But something the phone should surface, not me
-- and you in the backend." The runner tells the app the dates they are away;
-- the plan engine keeps them running through the window — travel days are
-- easy-preferred, never rest-by-default — and lands quality and the long run
-- on home days where the week has room. Doctrine: Research/12-travel-timezone
-- (post-flight running adjustments · "avoid hard efforts" until re-entrained)
-- and Research/00b consistency principles.
--
-- A real table, not a jsonb field on user_prefs: windows are plural (a
-- runner can have Thanksgiving AND a work trip on file), each carries its
-- own range + note, and readers filter by date overlap — a shape jsonb
-- makes every reader re-implement.
--
-- Distinct from the existing one-shot 'travel' scenario in /api/plan/change
-- (replan-scenarios.ts), which means "days I CANNOT run · clear them". A
-- travel window means the opposite: still running, easy-preferred. The two
-- deliberately coexist.
--
-- Readers:
--   lib/plan/generate.ts        loadGeneratorInputs → composePlan (shaping)
--   lib/plan/adapt.ts           chooseRescheduleDate guard
--   lib/coach/convergence-loader.ts  daysSinceTravel confound (Research/15)
-- Writer: app/api/travel/route.ts (GET/POST/PATCH/DELETE, per-user).
--
-- user_uuid carries the standard FK to users, so account deletion covers
-- this table both via the runtime user-keyed enumeration (it has a
-- user_uuid column) and via ON DELETE CASCADE. NOTE for the weekly
-- deletion-plan fixture probe: once this is applied, the fixture in
-- lib/account/deletion-plan.test.ts needs its next repaste (same pending
-- state as goal_projection_snapshots from migration 155).
--
-- Additive only: one new table, one new index. Idempotent.
--
-- Apply with: psql $DATABASE_URL -f web-v2/db/migrations/159_travel_windows.sql
-- REVERSED BY: DROP TABLE IF EXISTS travel_windows;

CREATE TABLE IF NOT EXISTS travel_windows (
  id          bigserial PRIMARY KEY,
  user_uuid   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT travel_windows_range_ck CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS travel_windows_user_range_idx
  ON travel_windows (user_uuid, start_date, end_date);

COMMENT ON TABLE travel_windows IS
  'Runner-declared travel dates (inclusive range + optional note). The plan '
  'engine keeps the runner running through a window: travel days are '
  'easy-preferred, quality and the long run avoid them where the week has '
  'room. Not "days away from running" (that is /api/plan/change travel).';
