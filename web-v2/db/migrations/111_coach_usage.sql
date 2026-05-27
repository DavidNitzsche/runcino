-- 111 — P43 coach LLM usage tracking
--
-- One row per generateBriefing() call. Captures all four token counters
-- the Anthropic SDK returns (input + output + cache_creation + cache_read)
-- so we can compute real $ spend, see cache-hit ratios, and identify
-- regen patterns that need debouncing.

CREATE TABLE IF NOT EXISTS coach_usage (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID,
  surface       TEXT NOT NULL,
  mode          TEXT,
  compact       BOOLEAN DEFAULT FALSE,
  model         TEXT NOT NULL,

  -- Aggregated across the tool-use loop's rounds
  rounds            INT NOT NULL DEFAULT 1,
  input_tokens      INT NOT NULL DEFAULT 0,
  output_tokens     INT NOT NULL DEFAULT 0,
  cache_creation_tokens INT NOT NULL DEFAULT 0,
  cache_read_tokens     INT NOT NULL DEFAULT 0,

  -- Cost in USD micro-cents (1 USD = 1_000_000) so we can sum without
  -- float drift. Computed at insert from current sonnet-4-5 pricing.
  cost_micro_usd    BIGINT NOT NULL DEFAULT 0,

  trigger_source    TEXT,        -- 'cache_warm' | 'cron' | 'user_open' | null
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coach_usage_user_date
  ON coach_usage (user_id, generated_at);
CREATE INDEX IF NOT EXISTS idx_coach_usage_date
  ON coach_usage (generated_at);
