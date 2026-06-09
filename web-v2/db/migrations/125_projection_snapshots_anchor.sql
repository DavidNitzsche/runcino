-- 125_projection_snapshots_anchor.sql
--
-- Adds anchor-race metadata to projection_snapshots so that
-- computeConfidenceInterval can apply §13.7 cross-prediction penalties:
--
--   Case 2 · >6-month-old input → ±8% override (this migration).
--   Case 1 · marathon predicted from sub-half anchor → one-sided pessimism
--            (reuses these columns; pending marathon-block signal).
--
-- Rows written before this migration have both columns NULL; the
-- confidence-interval code treats NULL as "anchor unknown → no penalty".
--
-- Apply with: psql $DATABASE_URL -f web-v2/db/migrations/125_projection_snapshots_anchor.sql

ALTER TABLE projection_snapshots
  ADD COLUMN IF NOT EXISTS vdot_anchor_date           date,
  ADD COLUMN IF NOT EXISTS vdot_anchor_distance_mi    numeric;

COMMENT ON COLUMN projection_snapshots.vdot_anchor_date IS
  'ISO date of the race/run that produced the stored VDOT. '
  'Null for rows written before migration 125.';

COMMENT ON COLUMN projection_snapshots.vdot_anchor_distance_mi IS
  'Distance (miles) of the anchor race/run. '
  'Used by computeConfidenceInterval to detect cross-distance prediction (§13.7 Case 1).';
