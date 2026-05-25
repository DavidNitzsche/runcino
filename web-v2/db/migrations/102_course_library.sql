-- 102_course_library.sql
-- Closed loop §8.2: real-route GPX ingestion.
-- Two storage spots:
--   - course_library: curated GPX for known races (auto-attached on race creation)
--   - races.course_geometry: per-race-row GPS line + elevation samples (from any source)
--
-- Apply with: psql $DATABASE_URL -f web-v2/db/migrations/102_course_library.sql

CREATE TABLE IF NOT EXISTS course_library (
    id              bigserial PRIMARY KEY,
    slug            text NOT NULL UNIQUE,    -- e.g. 'afc-half', 'cim', 'boston-marathon'
    name            text NOT NULL,           -- display name
    distance_mi     numeric,                 -- nominal distance
    geometry_json   jsonb NOT NULL,          -- { trackPoints: [{lat, lon, ele}], ... }
    elevation_gain_ft integer,
    start_label     text,                    -- e.g. 'Cabrillo Monument'
    finish_label    text,                    -- e.g. 'Embarcadero'
    notes           text,                    -- editorial — segment annotations
    updated_ts      timestamptz NOT NULL DEFAULT now()
);

-- Per-race attached geometry (from any ingest vector: library / upload / strava-match).
-- races.meta is jsonb; we add course_geometry + course_source under it.
-- Existing races rows untouched; new fields are nullable.
ALTER TABLE races
  ADD COLUMN IF NOT EXISTS course_geometry jsonb,
  ADD COLUMN IF NOT EXISTS course_source   text CHECK (course_source IN ('library', 'upload', 'strava_match', NULL));

CREATE INDEX IF NOT EXISTS races_course_source_idx ON races (course_source) WHERE course_source IS NOT NULL;

COMMENT ON TABLE course_library IS
  'Curated GPX library for known races. Match on (name + date locality) at race creation time to auto-attach.';
COMMENT ON COLUMN races.course_geometry IS
  'Per-race GPS line + elevation. NULL → render schematic placeholder. Set → render real polyline + per-mile bars.';
