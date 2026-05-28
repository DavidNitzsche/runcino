-- 114_day_actions.sql
-- Skip Today (and future day-level actions): records explicit runner choices
-- on a specific date that are distinct from check-ins or planned rest days.
--
-- The `skip` action means: "the plan said run today, but I'm actively choosing
-- not to. Not sick, not injured — just skipping." Distinct semantics from:
--   • plan_workout.type='rest'  → planned rest (no run was prescribed)
--   • missed (passive)          → time ran out without a run
--   • sick / niggle             → health-related; plan should pause
--
-- A skip does NOT cascade: tomorrow's plan continues exactly as written.
-- Skipping is reversible — DELETE the row to undo. The unique index enforces
-- one skip per (user, date, action) so re-tapping POST is idempotent.
--
-- The CHECK constraint pins the enum to just 'skip' today; future day-level
-- actions (e.g. 'fasted', 'doubled') can be added by ALTER-ing the check
-- without losing referential safety on existing rows.
--
-- Apply with: psql $DATABASE_URL -f web-v2/db/migrations/114_day_actions.sql

CREATE TABLE IF NOT EXISTS day_actions (
    id           bigserial PRIMARY KEY,
    user_id      uuid NOT NULL,
    date_iso     text NOT NULL,            -- YYYY-MM-DD (matches glance-state's "today" computation)
    action       text NOT NULL CHECK (action IN ('skip')),
    note         text,                     -- optional freeform; reserved for future use
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- Unique per (user, date, action) so POST upserts are safe (idempotent).
-- The glance-state lookup is a point-read on (user_id, date_iso, action),
-- so the unique index doubles as the access-path index.
CREATE UNIQUE INDEX IF NOT EXISTS day_actions_user_date_action_idx
  ON day_actions (user_id, date_iso, action);

COMMENT ON TABLE day_actions IS
  'Explicit per-day runner actions (currently just skip). One row per (user, date, action). DELETE to undo.';
