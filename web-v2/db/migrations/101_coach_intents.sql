-- 101_coach_intents.sql
-- Coach memory of recent state changes that the voice should acknowledge ONCE.
-- Example: runner adds height_cm → row logged → next briefing voice says
--   "Now that I have your height, let's run a cadence experiment..."
-- Then we set acknowledged_at so subsequent briefings don't repeat.
--
-- Apply with: psql $DATABASE_URL -f web-v2/db/migrations/101_coach_intents.sql

CREATE TABLE IF NOT EXISTS coach_intents (
    id              bigserial PRIMARY KEY,
    user_id         uuid NOT NULL,
    ts              timestamptz NOT NULL DEFAULT now(),
    reason          text NOT NULL,           -- e.g. 'profile_field_added', 'plan_adapted', 'goal_changed'
    field           text,                    -- e.g. 'height_cm', 'race_goal'
    value           text,                    -- stored as text; coerce on read
    briefing_id     text,                    -- briefing that triggered the intent (if applicable)
    acknowledged_at timestamptz              -- NULL until the voice mentions it once
);

CREATE INDEX IF NOT EXISTS coach_intents_user_pending_idx
  ON coach_intents (user_id, ts DESC)
  WHERE acknowledged_at IS NULL;

COMMENT ON TABLE coach_intents IS
  'State-change log the coach reads to acknowledge once and move on. Pending intents (acknowledged_at NULL) appear in the next briefing voice; ack happens server-side after the LLM call.';
