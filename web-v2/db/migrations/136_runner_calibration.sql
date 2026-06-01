-- Migration 136 · runner_calibration
-- ----------------------------------------------------------------------
-- Per-runner state vector that the plan engine reads instead of
-- coarse experience_level buckets. Replaces hardcoded defaults with
-- learned response curves.
--
-- One row per (user, week). Refreshed weekly Sunday night after the
-- long-run by lib/coach/cron/calibration-refresh.ts.
--
-- Cold-start runners (less than 14d of training history) get
-- bucket-derived defaults from experience_level. Once 14d of data is
-- in, calibration becomes the source of truth.
--
-- Read by:
--   · lib/plan/generate.ts · volume curve, taper depth, quality density
--   · lib/plan/simulator.ts · per-runner response curves (vdotPerQuality
--     etc.) replace cold-start COLD_START_CALIBRATION defaults
--   · lib/plan/adapt-block.ts · recoveryMult informs hard-easy spacing
--
-- Cite: docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 2.2
-- ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS runner_calibration (
  id            BIGSERIAL PRIMARY KEY,
  user_uuid     UUID NOT NULL,
  as_of         DATE NOT NULL,

  -- VDOT response (learned from completed quality workouts vs projected)
  vdot_per_quality       NUMERIC(5,3) NOT NULL DEFAULT 0.10,
  long_run_weight        NUMERIC(4,2) NOT NULL DEFAULT 0.30,
  recovery_mult          NUMERIC(4,2) NOT NULL DEFAULT 1.00,
  plateau_vdot           NUMERIC(4,1) NOT NULL DEFAULT 75.0,

  -- Per-day-type tolerances (used by drift detection + adapter)
  easy_tolerance_mi      NUMERIC(4,1),
  long_tolerance_mi      NUMERIC(4,1),
  quality_tolerance_mi   NUMERIC(4,1),

  -- ACWR + RHR sensitivity (drives pullback adapter sensitivity)
  acwr_slope             NUMERIC(4,3),
  rhr_sensitivity        NUMERIC(4,2),

  -- Volume tolerance (caps weekly volume curve)
  volume_ceiling_mi      NUMERIC(5,1),

  -- Data quality marker · cold-start, building, calibrated
  data_quality           TEXT NOT NULL DEFAULT 'cold-start'
    CHECK (data_quality IN ('cold-start', 'building', 'calibrated')),

  -- Audit: which completed workouts informed this calibration
  source_workout_count   INTEGER NOT NULL DEFAULT 0,
  source_quality_count   INTEGER NOT NULL DEFAULT 0,

  citation               TEXT NOT NULL DEFAULT 'docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 2.2',
  created_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  UNIQUE (user_uuid, as_of)
);

CREATE INDEX IF NOT EXISTS runner_calibration_user_asof_idx
  ON runner_calibration (user_uuid, as_of DESC);

COMMENT ON TABLE runner_calibration IS
  'Per-runner per-week learned state vector. Replaces coarse experience_level bucket in the plan engine. Updated weekly Sunday night by calibration-refresh cron. Cold-start defaults applied when data_quality=cold-start.';

COMMENT ON COLUMN runner_calibration.vdot_per_quality IS
  'VDOT points gained per quality workout · learned from prior quality completion vs projection trajectory. Default 0.10 = ~0.4 pts per 4-week block at 1 quality/wk (Daniels baseline).';

COMMENT ON COLUMN runner_calibration.long_run_weight IS
  'Endurance contribution factor 0..1 · scales with race distance. Marathon=0.6, HM=0.3, 10K=0.2, 5K=0.1 cold-start defaults. Calibrated weekly from long-run completion + pace stability.';

COMMENT ON COLUMN runner_calibration.recovery_mult IS
  'Per-runner recovery rate multiplier. 1.0 = Daniels-baseline. Sleep-debt-prone or RHR-sensitive runners drift below 1.0 · their plan needs fewer quality days per week + longer recovery between blocks.';

COMMENT ON COLUMN runner_calibration.plateau_vdot IS
  'VDOT ceiling above which marginal gain falls to <0.05/wk. Most runners plateau 70-75 · elite runners 80+. Calibrated from observed gain rate over the last 12 weeks.';
