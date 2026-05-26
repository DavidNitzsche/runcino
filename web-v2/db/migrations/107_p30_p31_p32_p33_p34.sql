-- 107 — P30/P31/P32/P33/P34 schema additions
--
-- All ADD COLUMN IF NOT EXISTS — idempotent.

-- ── P30 onboarding real persistence ──────────────────────────────────
ALTER TABLE profile ADD COLUMN IF NOT EXISTS strava_connected_at  TIMESTAMPTZ;
ALTER TABLE profile ADD COLUMN IF NOT EXISTS health_connected_at  TIMESTAMPTZ;
ALTER TABLE profile ADD COLUMN IF NOT EXISTS onboarded_at         TIMESTAMPTZ;
ALTER TABLE profile ADD COLUMN IF NOT EXISTS notification_token   TEXT;

-- ── P34 cross-training opt-in ────────────────────────────────────────
-- TEXT[] of {'bike','swim','strength','other'}. Empty array = off (default).
-- Plan generator slots cross-training only when the array is non-empty.
ALTER TABLE profile ADD COLUMN IF NOT EXISTS cross_training_modes TEXT[] DEFAULT ARRAY[]::TEXT[];

-- ── P31 weather enrichment ───────────────────────────────────────────
-- Lives inside strava_activities.data jsonb (no new columns needed).
-- Just track that we tried to enrich, so the nightly re-enrich job
-- doesn't hammer Open-Meteo for the same rows forever.
ALTER TABLE strava_activities ADD COLUMN IF NOT EXISTS weather_enriched_at TIMESTAMPTZ;

-- ── P36 race retrospective fields ────────────────────────────────────
-- The legacy races.meta jsonb already takes finish_time / how_it_felt /
-- lessons; no new columns needed. Index helps "past races" queries:
CREATE INDEX IF NOT EXISTS idx_races_meta_date ON races ((meta->>'date'));
