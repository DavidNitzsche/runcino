-- 108 — P34 expanded check-in, P36 race packing list, P37 ops tables

-- ── P34 — expanded check-in ──────────────────────────────────────────
-- Optional jsonb 'extras' on check_ins: { energy, soreness:[areas], mood, sleep_quality, notes }
ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS extras JSONB;

-- ── P36 — race packing list ──────────────────────────────────────────
-- Per-race packing list lives in races.meta.packing[] (jsonb). No new
-- columns needed — meta is already jsonb. Just an index so packing
-- queries by date are fast.

-- ── P37 — alerts log ─────────────────────────────────────────────────
-- Captures cron / regen failures so the alerts cron has somewhere to
-- read from. Append-only.
CREATE TABLE IF NOT EXISTS ops_alerts (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,          -- 'cron_fail' | 'regen_fail' | 'asc_stall' | 'crash'
  severity    TEXT NOT NULL DEFAULT 'warn',  -- 'info' | 'warn' | 'error' | 'critical'
  message     TEXT NOT NULL,
  metadata    JSONB,
  source      TEXT,                   -- which endpoint / job
  acked_at    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ops_alerts_unacked
  ON ops_alerts (kind, severity)
  WHERE acked_at IS NULL;
