-- 127_course_library_provenance.sql
--
-- L1 → L2 promotion: each user's race GPX enriches the shared course_library
-- for the next user. Before this migration every course_library row was a
-- stub (or editorial JSON without real trackPoints) — there was no way to
-- distinguish "this slug has real GPS" from "this slug is a name-only
-- placeholder".
--
-- This migration adds provenance columns so promotion can be honest:
--
--   source                = 'editorial'    — curated by us (don't overwrite)
--                           'crowd-sourced' — promoted from a runner's race
--                           'stub'         — slug-only placeholder
--   contributor_count     = how many user races have contributed (>=1 for
--                           crowd-sourced; bumps on every additional runner
--                           even though first-contributor's geometry wins)
--   first_contributed_iso = when crowd-sourcing started for this slug
--
-- Plus a per-race marker so the daily promotion cron can skip races it's
-- already promoted (idempotency — re-running the backfill must not
-- double-count contributors):
--
--   races.promoted_to_library_iso
--
-- Apply with: node scripts/apply-127.mjs

ALTER TABLE course_library
  ADD COLUMN IF NOT EXISTS source text
     CHECK (source IN ('editorial', 'crowd-sourced', 'stub'))
     DEFAULT 'stub',
  ADD COLUMN IF NOT EXISTS contributor_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_contributed_iso timestamptz;

-- Backfill: the 4 editorial JSONs from legacy/web/data/courses/ are
-- canonical — they carry curated phase annotations + facts even though
-- their trackPoints[] is currently empty (real GPS pending).
UPDATE course_library
   SET source = 'editorial'
 WHERE slug IN (
   'americas-finest-city',
   'big-sur-marathon',
   'cim',
   'sombrero-half'
 );

-- All other existing rows are stub (the column default already gives
-- them source='stub', but be explicit so re-runs after data churn are
-- well-defined).
UPDATE course_library
   SET source = 'stub'
 WHERE source IS NULL;

-- Per-race promotion tracker. NULL = not promoted yet; set to NOW() the
-- first time promoteCourseFromRace() runs for this race. The daily cron
-- and the backfill both look for races where this is NULL.
ALTER TABLE races
  ADD COLUMN IF NOT EXISTS promoted_to_library_iso timestamptz;

CREATE INDEX IF NOT EXISTS races_promoted_to_library_iso_idx
  ON races (promoted_to_library_iso)
  WHERE promoted_to_library_iso IS NULL AND course_geometry IS NOT NULL;

COMMENT ON COLUMN course_library.source IS
  'editorial = our curated JSON (do not overwrite geometry); '
  'crowd-sourced = promoted from a runner''s race; '
  'stub = slug-only placeholder (no real geometry yet).';
COMMENT ON COLUMN course_library.contributor_count IS
  'How many distinct user races have contributed to this slug. '
  'First contributor''s geometry wins; later contributors bump this counter only.';
COMMENT ON COLUMN races.promoted_to_library_iso IS
  'Set the first time this race''s course_geometry was promoted into '
  'course_library. NULL = candidate for promotion by the daily cron.';
