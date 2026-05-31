-- 128_run_provenance.sql
-- Canonical run model · provenance tracking.
--
-- David's rule (2026-05-31):
--   "Faff app first, then HealthKit, then Strava. Never duplicate data,
--    always enhance."
--
-- ONE canonical strava_activities row per actual run. Multiple providers
-- (Faff watch app, Faff manual entry, Apple Watch via HK, Apple Health
-- raw, Strava webhook, Strava pull, future Garmin/Coros/Polar) all
-- contribute to the same row. Each provider that arrives enhances the
-- canonical by filling fields that are NULL/missing. Never overwrites
-- a non-null field unless the new source ranks higher than what's
-- recorded in provenance for that field.
--
-- Source priority ladder (highest wins on ties · documented in
-- lib/runs/canonical.ts SOURCE_TIER):
--   1. Faff watch app           (source = 'watch')
--   2. Faff manual entry        (source = 'manual')
--   3. Apple Watch via HK       (source = 'apple_watch')
--   4. Apple Health raw         (source = 'apple_health')
--   5. Strava webhook / pull    (source IN ('strava','strava_webhook'))
--   (anything else: lowest priority)
--
-- This commit:
--   1. Adds `provenance` jsonb column. Schema:
--        { fieldName: sourceTierName, ... }
--      Tracks which provider contributed each populated field on the
--      canonical row. enhanceRun in canonical.ts uses this to decide
--      whether an incoming source is allowed to overwrite.
--
--   2. Adds `absorbed_into_canonical_at` timestamptz. The previous
--      merge.ts set `data.mergedIntoId` on dedup-loser rows but left
--      their unique fields stranded. The new canonical model treats
--      these losers as fully-absorbed contributors · their unique
--      fields get pulled into the canonical row's payload, then the
--      loser is marked absorbed (kept for audit, but skipped by
--      every reader).
--
--   3. Backfills provenance for existing rows based on data->>'source'
--      so we don't lose the audit trail for the 100+ runs already
--      ingested.
--
-- Apply: cd web-v2 && node scripts/apply-128.mjs

ALTER TABLE strava_activities
  ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE strava_activities
  ADD COLUMN IF NOT EXISTS absorbed_into_canonical_at timestamptz;

CREATE INDEX IF NOT EXISTS strava_activities_provenance_gin_idx
  ON strava_activities USING GIN (provenance);

CREATE INDEX IF NOT EXISTS strava_activities_absorbed_idx
  ON strava_activities (absorbed_into_canonical_at)
  WHERE absorbed_into_canonical_at IS NOT NULL;

-- Backfill provenance for existing rows. Every populated key in `data`
-- gets credited to the row's source. This gives the audit trail a
-- starting point without losing the existing data.
UPDATE strava_activities
   SET provenance = (
         SELECT jsonb_object_agg(k, COALESCE(data->>'source', 'unknown'))
           FROM jsonb_object_keys(data) AS k
          WHERE data->k IS NOT NULL AND data->>k != ''
       )
 WHERE provenance = '{}'::jsonb
   AND data IS NOT NULL;

COMMENT ON COLUMN strava_activities.provenance IS
  'Per-field source attribution. { fieldName: sourceTierName }. enhanceRun in lib/runs/canonical.ts reads this to decide whether an incoming provider can populate or overwrite a given field.';

COMMENT ON COLUMN strava_activities.absorbed_into_canonical_at IS
  'When this row was absorbed as a dedup-contributor into another canonical row. NULL = this row IS canonical. NOT NULL = this row is a historical record · its unique fields were pulled into the canonical row identified by data->>mergedIntoId. Every reader filters absorbed_into_canonical_at IS NULL alongside (data ? mergedIntoId) for backward compat.';
