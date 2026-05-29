-- 117_sick_episodes.sql
-- Sick log: systemic illness the runner reports. UNLIKE niggle, this DOES
-- pause the plan — resolveDayState routes /today through the `sick` state
-- which renders REST and a return-gate card.
--
-- One row per illness episode. `cleared_at` flips when the runner taps
-- "Run today" after all three return gates clear (fever-free 24h + sleep
-- ≥ 7h last night + RHR within +5 of baseline). DELETE /api/sick undoes
-- the most recent active row (e.g. tapped by mistake).
--
-- Active episode = most recent row WHERE cleared_at IS NULL.
--
-- The `symptoms` jsonb is an array of one or more of:
--   head_cold | chest | fever | gi | aches | fatigue | voice | other
-- `has_fever` is a denormalized boolean so the resolver doesn't need to
-- parse jsonb to know whether to render the DO-NOT-RUN copy or skip the
-- fever-free gate.
--
-- Apply with: node scripts/apply-117.mjs

CREATE TABLE IF NOT EXISTS sick_episodes (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL,
  symptoms    jsonb NOT NULL,        -- array of: head_cold|chest|fever|gi|aches|fatigue|voice|other
  started     text NOT NULL,         -- 'today'|'yesterday'|'few_days'|'week_plus'
  has_fever   boolean NOT NULL,
  note        text,
  logged_at   timestamptz NOT NULL DEFAULT now(),
  cleared_at  timestamptz
);

CREATE INDEX IF NOT EXISTS sick_user_active_idx
  ON sick_episodes (user_id, logged_at DESC) WHERE cleared_at IS NULL;

-- Recovery trend log: append-only check-ins on an active sick episode.
-- 'recovered' ALSO sets the parent episode's cleared_at via the API route.
CREATE TABLE IF NOT EXISTS sick_recovery (
  id          bigserial PRIMARY KEY,
  episode_id  bigint NOT NULL REFERENCES sick_episodes(id) ON DELETE CASCADE,
  response    text NOT NULL CHECK (response IN ('better','same','worse','recovered')),
  logged_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sick_recovery_episode_idx
  ON sick_recovery (episode_id, logged_at DESC);

COMMENT ON TABLE sick_episodes IS
  'Systemic illness episode. Pauses the plan via resolveDayState. Active = most recent WHERE cleared_at IS NULL.';
COMMENT ON TABLE sick_recovery IS
  'Daily check trend on an active sick episode. better/same/worse/recovered. "recovered" also clears the parent episode.';
