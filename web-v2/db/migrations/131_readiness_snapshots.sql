-- Migration 131 · readiness_snapshots
-- ----------------------------------------------------------------------
-- Daily snapshot of the runner's readiness score + per-pillar values, so
-- the morning brief can render trends ("how is your score trending over
-- 14 days?", "HRV down 3 days in a row · streak detection") without
-- recomputing the entire historical score each render.
--
-- Why a table and not just on-the-fly:
--
--   1. The score itself is a function of CURRENT inputs. To draw a
--      14-day score trend we'd have to reconstruct what the inputs were
--      30/29/28...1 days ago. health_samples carries the raw HRV/RHR/
--      sleep history but `loadAcute7 / loadChronic28` requires
--      reconstructing the runs feed too — meaning a full historical
--      replay per render. Snapshot once nightly, read fast forever.
--
--   2. Streak detection needs prior days' BAND for each pillar. The
--      band changes when raw value crosses thresholds, not linearly
--      with value · cleaner to store the band per row than re-derive.
--
--   3. Hand-off to the design agent: the trend lines are first-class
--      data the panel renders, not computed JIT in the React layer.
--
-- Idempotent on (user_uuid, snapshot_date) — nightly cron upserts.
-- Per-pillar JSONB blob is forward-compatible · new pillars don't
-- need a schema change.
-- ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS readiness_snapshots (
  id            BIGSERIAL PRIMARY KEY,
  user_uuid     UUID NOT NULL,
  snapshot_date DATE NOT NULL,
  score         INTEGER NOT NULL,
  band          TEXT NOT NULL,            -- 'sharp' | 'ready' | 'moderate' | 'pull-back'

  -- Per-pillar JSONB · canonical shape:
  --   {
  --     sleep:       { value: 7.2, baseline: 7.5, weight: 4, band: 'ready' },
  --     hrv:         { value: 62, baseline: 70, weight: -8, band: 'moderate', plewsRolling: 63.4, swc: 4.1 },
  --     rhr:         { value: 52, baseline: 50, weight: -4, band: 'moderate' },
  --     load:        { value: 1.05, weight: 5, band: 'ready', acute7: 6.8, chronic28: 6.5 },
  --     hr_recovery: { value: 28, baseline: 26, weight: 2, band: 'ready' }
  --   }
  -- Forward-compatible · new pillars just add keys.
  pillars       JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Active streaks for surfacing in the brief.
  --   [{ pillar: 'hrv', direction: 'below', days: 3, band: 'moderate', startDate: '2026-05-29' }]
  streaks       JSONB NOT NULL DEFAULT '[]'::jsonb,

  computed_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  UNIQUE (user_uuid, snapshot_date)
);

CREATE INDEX IF NOT EXISTS readiness_snapshots_user_date_idx
  ON readiness_snapshots (user_uuid, snapshot_date DESC);

COMMENT ON TABLE readiness_snapshots IS
  'Daily readiness score + per-pillar values for trend display. Written by the nightly /api/cron/readiness-snapshot route. See lib/coach/readiness-snapshot.ts for the writer.';

COMMENT ON COLUMN readiness_snapshots.pillars IS
  'Per-pillar JSONB: { sleep, hrv, rhr, load, hr_recovery } with { value, baseline, weight, band, ...pillar-specific } per. Forward-compatible.';

COMMENT ON COLUMN readiness_snapshots.streaks IS
  'Array of active streaks: [{ pillar, direction: above|below, days, band, startDate }]. Read by the brief to surface "HRV down 3 days in a row".';
