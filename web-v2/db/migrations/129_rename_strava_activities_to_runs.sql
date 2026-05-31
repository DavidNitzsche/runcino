-- 129_rename_strava_activities_to_runs.sql
-- The naming-was-a-lie cleanup.
--
-- David (2026-05-31):
--   "If data is not FROM strava, do not call it STRAVA."
--   "can you never say strava unless its actually strava the app"
--
-- The table held canonical run rows from the Faff watch app, Faff manual
-- entry, Apple Watch via HK, Apple Health raw, and Strava (webhook + pull).
-- Per the canonical-run doctrine (lib/runs/canonical.ts, migration 128),
-- Strava is one of five contributors · not the source of truth. The
-- table name carried Strava's bias and was actively misleading.
--
-- This migration:
--   1. RENAME `strava_activities` → `runs` · the truthful name.
--   2. CREATE VIEW `strava_activities AS SELECT * FROM runs` · a Postgres
--      automatically-updatable view that lets every existing callsite
--      (~350 across ~117 files) keep working unchanged. SELECT, INSERT,
--      UPDATE, DELETE all auto-rewrite to the renamed table.
--   3. Index, foreign-key, trigger, and sequence references follow the
--      rename automatically · Postgres tracks them by OID, not by the
--      table name in the DDL.
--
-- Migration strategy after this lands:
--   · New code references `runs` directly.
--   · Existing callsites get migrated one at a time in follow-up commits.
--   · Once every callsite is updated, drop the view in a future migration.
--
-- Apply: cd web-v2&& node scripts/apply-129.mjs
--
-- This is an ACCESS EXCLUSIVE lock for the duration of the ALTER TABLE,
-- but the table is ~100 rows and the operation completes in milliseconds.
-- Wrapped in BEGIN/COMMIT so the rename + view land atomically · no
-- window where readers see "table doesn't exist."

BEGIN;

ALTER TABLE strava_activities RENAME TO runs;

CREATE VIEW strava_activities AS SELECT * FROM runs;

COMMENT ON TABLE runs IS
  'Canonical run rows. One row per actual run. Multiple providers (Faff watch app, Faff manual entry, Apple Watch via HK, Apple Health raw, Strava) contribute via the source-tier ladder in lib/runs/canonical.ts SOURCE_TIER. The legacy view `strava_activities` aliases this table for backward compatibility during the migration window · drop it once every callsite reads from `runs` directly.';

COMMENT ON VIEW strava_activities IS
  'Backward-compat alias for the renamed `runs` table · scheduled for removal once every callsite migrates. Updatable: SELECT/INSERT/UPDATE/DELETE auto-rewrite to runs. Doctrine: David 2026-05-31 · "If data is not FROM strava, do not call it STRAVA."';

COMMIT;
