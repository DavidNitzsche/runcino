-- 100_check_ins.sql
-- Closed loop §8.1: SOLID / TIRED / WRECKED reply chip records a check-in.
-- Read by the coach engine on next briefing to inform mode + adapt next session.
--
-- Apply with: psql $DATABASE_URL -f web-v2/db/migrations/100_check_ins.sql

CREATE TABLE IF NOT EXISTS check_ins (
    id           bigserial PRIMARY KEY,
    user_id      uuid NOT NULL,
    ts           timestamptz NOT NULL DEFAULT now(),
    rating       text NOT NULL CHECK (rating IN ('solid', 'tired', 'wrecked')),
    briefing_id  text,            -- which briefing was active when chip was tapped
    note         text,            -- optional freeform; reserved for future use
    surface      text NOT NULL DEFAULT 'today'
);

-- Single composite index covers the recent-window queries the coach engine runs
-- (always filtered by user_id, ordered/bounded by ts). Partial index w/ now()
-- isn't allowed (predicate must be IMMUTABLE), and the composite serves the
-- same access pattern.
CREATE INDEX IF NOT EXISTS check_ins_user_ts_idx ON check_ins (user_id, ts DESC);

COMMENT ON TABLE check_ins IS
  'Runner subjective check-ins (SOLID/TIRED/WRECKED). One row per chip tap. Coach reads ~3-7 day window on next briefing.';
