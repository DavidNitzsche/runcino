-- 123_day_actions_shoe.sql
-- Extend day_actions to support per-day shoe assignments.
--
-- Today's ShoePicker on /today (Faff design) lets the runner pick which
-- pair from the garage they're wearing for this session. The choice
-- should survive a page reload AND be visible on the past-run detail
-- modal once the run is logged. day_actions (migration 114) is the
-- right home: same (user, date_iso, action) shape, same UNIQUE
-- constraint, same delete-to-undo semantics.
--
-- Schema change: relax the CHECK enum to allow 'shoe'. note holds the
-- shoe_id (uuid string) so we don't need a foreign-key join — the
-- shoes table can come and go without invalidating historical rows.
--
-- Idempotent. Safe to run repeatedly — DROP CONSTRAINT IF EXISTS +
-- re-ADD gives us forward-compatible enum extension without losing
-- existing skip rows.

ALTER TABLE day_actions
  DROP CONSTRAINT IF EXISTS day_actions_action_check;

ALTER TABLE day_actions
  ADD CONSTRAINT day_actions_action_check
  CHECK (action IN ('skip', 'shoe'));

COMMENT ON COLUMN day_actions.note IS
  'For action=skip: optional freeform. For action=shoe: shoe_id (uuid string from shoes table).';
