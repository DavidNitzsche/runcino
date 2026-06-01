-- Migration 132 · plan_proposals
-- ----------------------------------------------------------------------
-- Captures plan-drift detections so the Today view can surface them as
-- a card (or auto-apply when the case is unambiguous). Mirrors the
-- existing coach_proposals table that powers illness/injury accept-
-- decline cards · same architecture, different signal source.
--
-- Two streams write here:
--   1. Nightly drift cron · proposal_kind IN ('volume_drift', 'staleness',
--      'vdot_drift'). Always requires user accept · these involve
--      tradeoffs (do I want a bigger plan, do I trust this VDOT change).
--
--   2. Immediate-fire hooks · proposal_kind IN ('race_date_changed',
--      'goal_time_changed', 'a_race_added', 'a_race_removed'). These
--      auto-apply on insert via a status='auto_applied' default ·
--      the row is written for AUDIT, not approval. The runner sees a
--      "we rebuilt your plan because X" notification, not an Accept
--      button.
--
-- Why proposals (not direct mutations to training_plans):
--   · A persistent log of what changed and why · the runner can see
--     "plan rebuilt 5 days ago because race moved from Aug 16 to Aug 23"
--   · Idempotency · drift cron can run nightly without spamming the
--     same volume_drift proposal · we check for an existing pending
--     row before writing.
--   · Future · LLM-free coach voice can read these to surface "since
--     we rebuilt your plan, your projection moved by X".
-- ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS plan_proposals (
  id              BIGSERIAL PRIMARY KEY,
  user_uuid       UUID NOT NULL,
  plan_id         TEXT,                  -- the plan being adapted · null for "no active plan"
  proposal_kind   TEXT NOT NULL,         -- 'volume_drift' | 'vdot_drift' | 'staleness'
                                          -- | 'race_date_changed' | 'goal_time_changed'
                                          -- | 'a_race_added' | 'a_race_removed'

  -- Reasons JSONB · canonical shape:
  --   { trigger: 'volume_drift', authored_avg: 20.1, current_avg: 42.0,
  --     pct_drift: 108.9, threshold: 40 }
  --   { trigger: 'race_date_changed', from_iso: '2026-08-16',
  --     to_iso: '2026-08-23', delta_days: 7 }
  reasons         JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Status lifecycle:
  --   'pending'      · user hasn't acted (drift-cron writes start here)
  --   'auto_applied' · immediate-fire kinds skip user gate
  --   'accepted'     · user accepted via Today-view card
  --   'dismissed'    · user dismissed · don't re-propose for a while
  --   'superseded'   · newer proposal supersedes (e.g. another race change)
  status          TEXT NOT NULL DEFAULT 'pending',

  -- new_plan_id is set after the rebuild lands · the runner's "see what
  -- changed" link points to this plan.
  new_plan_id     TEXT,

  -- Author info · what kicked it off (cron run, API hook, etc.)
  source          TEXT NOT NULL,         -- 'drift_cron' | 'race_hook' | 'goal_hook' | 'race_priority_hook'

  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS plan_proposals_user_status_idx
  ON plan_proposals (user_uuid, status, created_at DESC);

CREATE INDEX IF NOT EXISTS plan_proposals_active_idx
  ON plan_proposals (user_uuid, plan_id, proposal_kind)
  WHERE status IN ('pending', 'auto_applied');

COMMENT ON TABLE plan_proposals IS
  'Plan-drift detections + immediate-fire rebuilds. Drift cron writes pending rows · immediate hooks write auto_applied rows. Today view reads pending for accept/dismiss cards + auto_applied for "we just rebuilt your plan" notifications.';

COMMENT ON COLUMN plan_proposals.proposal_kind IS
  'What triggered the proposal. Auto-applied kinds (race_date_changed, goal_time_changed, a_race_added, a_race_removed) skip the accept gate · the runner already made the underlying change, so the rebuild follows automatically.';
