-- Migration 138 · calibration_sessions
-- ----------------------------------------------------------------------
-- "Calibration session" = the runner's first easy run, framed as a
-- baseline-capture instead of a workout. The system reads pace +
-- HR-drift + pace-variance from miles 2-3 and stamps the runner's
-- calibrated easy pace ± confidence band.
--
-- Distinct from `runner_calibration` (migration 136) which is the
-- per-runner per-week learned state vector. THIS table is the one-
-- time onboarding-anchor that lets the coach voice move from
-- 'calibration' → 'guided' band on day 2 instead of guessing for
-- two weeks.
--
-- Pairs with:
--   · designs/briefs/calibration-session.md
--   · designs/briefs/onboarding-master.md § decision #3
--   · lib/coach/voice-band.ts § calibration_sessions read
--
-- Triggered by:
--   · Today screen banner when voiceBand=calibration + no completed row
--   · iPhone watch app prompt at start of first run
--
-- Completed by:
--   · POST /api/coach/calibration/complete (manual)
--   · Run-write pipeline (auto, when an in_progress row exists)
--
-- The partial UNIQUE INDEX prevents duplicate "in_progress" rows if
-- the start-tap races with the watch-app prompt. One active session
-- per runner; once completed (or skipped) a new one can be created.
-- ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS calibration_sessions (
  id            BIGSERIAL PRIMARY KEY,
  user_uuid     UUID NOT NULL,

  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  skipped_at    TIMESTAMPTZ,

  -- references runs.data->>'id' · text because run ids are mixed
  -- (Strava bigints, watch UUIDs, manual strings).
  run_id        TEXT,

  -- Output of the calibration math · null until completed.
  calibrated_easy_pace_s_per_mi  INT,
  confidence    NUMERIC(3,2),  -- 0-1

  -- Detailed metrics from the run · matches CalibrationResult.pillars
  -- in lib/coach/calibration.ts.
  pillars       JSONB,

  -- "Start calibration" tap vs runner just running without prompt.
  -- Affects the confidence band width (tapped → tighter ±15s,
  -- untapped → wider ±20s).
  was_start_tapped BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS calibration_sessions_user_idx
  ON calibration_sessions (user_uuid);

CREATE INDEX IF NOT EXISTS calibration_sessions_user_completed_idx
  ON calibration_sessions (user_uuid, completed_at DESC)
  WHERE completed_at IS NOT NULL;

-- One ACTIVE session per runner. The voice-band read on every
-- briefing fetches LIMIT 1 from completed_at IS NOT NULL · this
-- index just prevents start-tap + watch-prompt from racing.
CREATE UNIQUE INDEX IF NOT EXISTS calibration_sessions_active_uq
  ON calibration_sessions (user_uuid)
  WHERE completed_at IS NULL AND skipped_at IS NULL;

COMMENT ON TABLE calibration_sessions IS
  'One-time onboarding-anchor for cold-start runners · captures honest easy-pace baseline from miles 2-3 of the first qualifying easy run. Read by lib/coach/voice-band.ts to step calibration→guided band immediately. Distinct from runner_calibration (mig 136) which is a per-week learned state vector.';

COMMENT ON COLUMN calibration_sessions.confidence IS
  '0-1 calibration confidence · 0.70 when qualifying run (pace variance ≤ 30s, HR drift ≤ 5bpm/mi, distance ≥ 2mi), 0.45 when run completes but does not qualify (still useful, wider band). Below 0.45 means no actionable calibration.';

COMMENT ON COLUMN calibration_sessions.was_start_tapped IS
  'TRUE when the runner explicitly tapped "Start calibration" on the Today banner or watch prompt · gives a confidence boost (±15s vs ±20s band) because intent matched execution. FALSE when calibration auto-fires from the first qualifying easy run without an explicit start tap.';
