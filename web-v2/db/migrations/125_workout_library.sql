-- 125_workout_library.sql
-- Materialize the workout catalog as a real shared L2 table.
--
-- Until now, the "workout library" lived as hardcoded TypeScript in
-- lib/plan/generate.ts (lines 269–388). That worked for David but left
-- zero runtime flexibility: every doctrine change required a code deploy,
-- no per-runner overrides were possible, and the coverage gap against
-- Research/04 (the full vocabulary) was real (hills, fartlek, progression
-- runs, standalone strides, ladders, MP runs, race-rehearsal long — all
-- absent from the inline catalog).
--
-- This migration creates the canonical shared table. Doctrine source:
--   Research/04-workout-vocabulary.md  (the vocabulary — 60+ entries)
--   Research/22-plan-templates.md      (per-distance, per-level templates)
--
-- The engine (lib/plan/workout-library.ts) reads from this table; if the
-- DB read returns nothing, it falls back to the inline catalog so plan
-- generation never blocks on a missing template.
--
-- Apply with: psql $DATABASE_URL -f web-v2/db/migrations/125_workout_library.sql

CREATE TABLE IF NOT EXISTS workout_library (
    id                    bigserial PRIMARY KEY,
    slug                  text NOT NULL UNIQUE,
    name                  text NOT NULL,
    family                text NOT NULL CHECK (family IN (
                            'recovery',
                            'easy',
                            'medium_long',
                            'long',
                            'threshold',
                            'vo2max',
                            'speed',
                            'hills',
                            'fartlek',
                            'combo',
                            'marathon_specific',
                            'cutdown',
                            'ladder',
                            'race_specific',
                            'base_building',
                            'maintenance',
                            'walk_run',
                            'race',
                            'shakeout',
                            'rest'
                          )),
    distance_focus        text[] NOT NULL DEFAULT '{}', -- ['5k','10k','hm','m','ultra','all']
    phase_fit             text[] NOT NULL DEFAULT '{}', -- ['base','build','quality','race_specific','taper','race_week','maintenance']
    level_fit             text[] NOT NULL DEFAULT '{}', -- ['beginner','intermediate','advanced','advanced_plus']

    -- Effort signature
    pace_zones            text[] NOT NULL DEFAULT '{}', -- ['E','M','T','I','R','ST','HM','MP','10K','5K','3K']
    is_quality            boolean NOT NULL DEFAULT FALSE,
    is_long               boolean NOT NULL DEFAULT FALSE,

    -- Dose
    typical_duration_min  int4range,                   -- e.g. int4range(45, 75)
    typical_distance_mi   numrange,                    -- e.g. numrange(8, 12)
    frequency_max_per_week int NOT NULL DEFAULT 1,

    -- Structured prescription
    structure             jsonb NOT NULL,              -- the machine-readable recipe
    prescription_text     text NOT NULL,               -- short display string (e.g. "5×800m @ I · 90s jog")
    notes                 text,                        -- coach-facing guidance
    warmup_cooldown       text,                        -- standard WU/CD recipe

    -- Doctrine anchor
    citation              text NOT NULL,               -- e.g. 'Research/04-workout-vocabulary.md §6.2'

    -- Operations
    active                boolean NOT NULL DEFAULT TRUE,
    updated_ts            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workout_library_family_idx       ON workout_library (family) WHERE active;
CREATE INDEX IF NOT EXISTS workout_library_distance_idx     ON workout_library USING GIN (distance_focus);
CREATE INDEX IF NOT EXISTS workout_library_phase_idx        ON workout_library USING GIN (phase_fit);
CREATE INDEX IF NOT EXISTS workout_library_level_idx        ON workout_library USING GIN (level_fit);
CREATE INDEX IF NOT EXISTS workout_library_quality_long_idx ON workout_library (is_quality, is_long) WHERE active;

COMMENT ON TABLE workout_library IS
  'Shared L2 workout catalog. Source: Research/04 (vocabulary) + Research/22 (templates). Engine reads via lib/plan/workout-library.ts with inline fallback. Same rows visible to every user; per-runner customization is a follow-up via a workout_library_overrides table keyed by user_uuid.';
COMMENT ON COLUMN workout_library.structure IS
  'jsonb recipe — varies by family. Typical shape: { reps, distance_m, pace_zone, recovery_sec, total_at_pace_mi, blocks: [...] }. Engine reads this to build plan_workouts.workout_spec.';
COMMENT ON COLUMN workout_library.citation IS
  'Canonical Research/ path + section anchor. Every row MUST cite. No anonymous prescriptions.';
COMMENT ON COLUMN workout_library.frequency_max_per_week IS
  'Doctrine guard rail. Daniels: T cap = 10% wkly mi; I cap = 8%; R cap = 5%. Coach should never schedule above this.';
