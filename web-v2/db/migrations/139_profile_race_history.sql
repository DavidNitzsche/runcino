-- Migration 139 · profile.race_history JSONB
-- ----------------------------------------------------------------------
-- Self-reported race history captured at onboarding (Step 1b · no-race
-- path, OR Step 3 · race path). Distinct from the `races` table which
-- tracks the runner's UPCOMING races + completed race results from the
-- app's own race lifecycle.
--
-- Shape: [{distance, otherDistanceMi?, timeSec, whenRaced, source}, ...]
--   · distance: '5k' | '10k' | 'half' | 'marathon' | 'other'
--   · otherDistanceMi: optional numeric (required when distance='other')
--   · timeSec: integer finish time in seconds
--   · whenRaced: '<6mo' | '6-12mo' | '1-2yr' | '2+yr'
--   · source: 'self_reported' (only value for now · future: 'strava_pr')
--
-- Read by:
--   · lib/coach/voice-band.ts · race history depth signal for the
--     calibration/guided/challenge band selection
--   · lib/coach/profile-state.ts (future) · race-history-aware VDOT
--     seed when no recent races exist in the `races` table
--   · designs/briefs/onboarding-master.md § Race history capture
--
-- Captured by:
--   · components/onboarding/Step1bGoalDetails.tsx · RaceHistorySection
--     (2026-06-03 · TASK B4 from onboarding-master-execution)
--   · POST /api/onboarding/complete · accepts body.raceHistory[]
--
-- Apply with:
--   psql $DATABASE_URL -f web-v2/db/migrations/139_profile_race_history.sql
-- ----------------------------------------------------------------------

ALTER TABLE profile
  ADD COLUMN IF NOT EXISTS race_history JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Backfill check · existing rows already get [] via the default. The
-- NOT NULL constraint protects voice-band's read path from a NULL/jsonb
-- mismatch when the runner has no entries.

COMMENT ON COLUMN profile.race_history IS
  'Self-reported race history captured at onboarding · [{distance, otherDistanceMi?, timeSec, whenRaced, source}, ...]. Distinct from the races table which tracks upcoming/completed races. Read by voice-band for raceCount signal. Empty array on cold-start, never NULL.';
