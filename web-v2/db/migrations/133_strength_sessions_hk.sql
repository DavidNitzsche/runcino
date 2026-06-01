-- Migration 133 · strength_sessions provenance + HK idempotency
-- ----------------------------------------------------------------------
-- Adds two columns so we can distinguish runner-logged strength
-- sessions from HealthKit-imported ones AND de-duplicate HK imports
-- on their stable identifier:
--
--   · source   · 'manual' (default · runner logs via LogNonRunSheet)
--                'apple_health' (imported from HKWorkout by HK importer)
--                'watch' (future · Faff watch app logs a session)
--                'strava' (future · Strava marks an activity as strength)
--
--   · hk_uuid  · HKWorkout.uuid string · nullable for manual entries ·
--                unique constraint so a re-import of the same HK row
--                upserts cleanly (HK uuids are stable across syncs).
--
-- The iPhone's HealthKitImporter (existing path for runs) extends to
-- also pull HKWorkout rows whose activityType is strength-flavored ·
-- traditional + functional + core + cross-training. The full list +
-- payload shape lives in the iPhone design brief
-- designs/briefs/strength-hk-ingest-brief.md.
--
-- Backward-compatible · existing rows get source='manual' (default) ·
-- existing LogNonRunSheet writes don't change.
-- ----------------------------------------------------------------------

ALTER TABLE strength_sessions
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS hk_uuid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS strength_sessions_hk_uuid_uniq
  ON strength_sessions (hk_uuid)
  WHERE hk_uuid IS NOT NULL;

COMMENT ON COLUMN strength_sessions.source IS
  'Origin of the row · manual / apple_health / watch / strava. Drives the briefing surface (a confirmed-from-HK session reads stronger than a self-logged one for habit tracking).';

COMMENT ON COLUMN strength_sessions.hk_uuid IS
  'HKWorkout.uuid for HK-imported sessions · stable across syncs · UNIQUE so re-import upserts cleanly. Null for manual / watch / strava rows.';
