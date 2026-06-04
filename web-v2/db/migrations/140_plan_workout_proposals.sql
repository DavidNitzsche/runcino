-- Migration 140 · plan_workout_proposals
-- ----------------------------------------------------------------------
-- David's "I don't want to wake up to change runs · that was annoying"
-- (2026-06-04).
--
-- Old flow: nightly cron at ~3:45 AM PDT fires detectReadinessPullback
-- → applyAdaptations → plan_workouts mutated in place → runner wakes
-- up to find tomorrow's tempo silently swapped to easy.
--
-- New flow:
--   1. Evening cron (8 PM PT) runs detectReadinessPullback
--   2. For each adaptation action, write a PROPOSAL here (status='pending')
--      instead of UPDATEing plan_workouts directly
--   3. Today view renders pending proposals as a banner with
--      [LET IT HAPPEN] / [KEEP ORIGINAL] buttons
--   4. Runner accepts · existing applyAdaptations path runs · workout
--      gets the change + provenance chip
--   5. Runner dismisses · proposal goes to status='dismissed', plan
--      unchanged
--   6. Auto-expire after the workout's date passes · no apply on a day
--      that already happened
--
-- The runner sees the proposed change BEFORE it lands. Engine still
-- detects the signal; the runner stays in the driver's seat.
--
-- This is the WORKOUT-LEVEL parallel to plan_proposals (mig 132 ·
-- plan-level rebuilds for volume/vdot drift). Two different concepts:
--   · plan_proposals    · "we want to rebuild your plan"
--   · plan_workout_proposals · "we want to swap this one workout"
-- ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS plan_workout_proposals (
  id               BIGSERIAL PRIMARY KEY,
  user_uuid        UUID NOT NULL,
  plan_workout_id  TEXT NOT NULL,           -- plan_workouts.id this targets
  workout_date_iso TEXT NOT NULL,           -- copy of pw.date_iso for indexing
                                            -- + auto-expiry (date passed → drop)

  -- The proposed mutation · same shape as AdaptationAction in
  -- lib/plan/adapt.ts. Lets the accept endpoint re-run applyAdaptations
  -- with the original action without recomputing detectors.
  action_kind      TEXT NOT NULL,           -- 'downgrade' | 'shave' | 'reschedule'
  action_payload   JSONB NOT NULL DEFAULT '{}'::jsonb,
                                            -- { newType, newDate, shaveFraction, why }

  -- Human-readable reason · "HRV down 5 days running". Shows on the
  -- banner so the runner knows WHY before accepting/dismissing.
  reason           TEXT NOT NULL,

  -- Diagnostic evidence · the drift signals + scores that fed the
  -- decision. Useful for debugging "why did it propose this" without
  -- re-running the engine.
  evidence         JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Status lifecycle:
  --   'pending'   · runner hasn't acted · default · banner renders
  --   'accepted'  · runner clicked LET IT HAPPEN · applyAdaptations ran
  --   'dismissed' · runner clicked KEEP ORIGINAL · plan unchanged
  --   'expired'   · workout date passed · auto-marked by cleanup cron
  --                  OR by read-time gate (don't surface proposals for
  --                  past dates)
  status           TEXT NOT NULL DEFAULT 'pending',

  -- Audit · what source generated the proposal · usually 'cron_evening'
  -- but could be 'manual' if runner triggers from settings someday.
  source           TEXT NOT NULL DEFAULT 'cron_evening',

  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMP WITH TIME ZONE
);

-- Most reads · "what's pending for this user right now" for the banner.
CREATE INDEX IF NOT EXISTS plan_workout_proposals_user_pending_idx
  ON plan_workout_proposals (user_uuid, status, workout_date_iso)
  WHERE status = 'pending';

-- Dedupe · don't write a duplicate pending row for the same workout.
-- The cron checks before INSERT; this index makes that check fast.
CREATE INDEX IF NOT EXISTS plan_workout_proposals_workout_idx
  ON plan_workout_proposals (plan_workout_id, status)
  WHERE status = 'pending';

COMMENT ON TABLE plan_workout_proposals IS
  'Per-workout adaptation proposals. Runner accepts/dismisses via the Today banner before the change lands. Replaces the silent-overnight-mutation pattern (David 2026-06-04).';
