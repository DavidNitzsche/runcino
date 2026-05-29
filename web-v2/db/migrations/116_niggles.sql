-- 116_niggles.sql
-- Niggle log: musculoskeletal flags the runner reports. Modifier on the
-- base-4 day-states. Plan does NOT pause for a niggle — but resolveDayState
-- routes /today through the `niggle` surface so the workout is rendered
-- with awareness rather than the unmodified prescription.
--
-- One row per niggle event. `cleared_at` flips when the runner marks GONE
-- via the recovery row, or DELETE /api/niggle (undo the most recent log).
-- Active niggle = most recent row WHERE cleared_at IS NULL.
--
-- Multi-niggle is intentionally NOT supported in v1 (per design footer Q3) —
-- the SELECT to find "the active niggle" takes LIMIT 1 ORDER BY logged_at
-- DESC. The schema allows multiple active rows for the future, but the
-- resolver and UI surface only the most recent until v1.1.
--
-- Apply with: node scripts/apply-116.mjs

CREATE TABLE IF NOT EXISTS niggles (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL,
  body_part   text NOT NULL,        -- 'hamstring'|'calf'|'achilles'|'it_band'|'knee'|'hip'|'plantar'|'shin'|'foot'|'quad'|'glute'|'other'
  side        text,                 -- 'left'|'right'|'both'|null
  severity    int NOT NULL CHECK (severity BETWEEN 1 AND 10),
  status      text NOT NULL,        -- 'just_started'|'few_days'|'weeks'
  note        text,
  logged_at   timestamptz NOT NULL DEFAULT now(),
  cleared_at  timestamptz             -- non-null when runner reports GONE
);

CREATE INDEX IF NOT EXISTS niggles_user_active_idx
  ON niggles (user_id, logged_at DESC) WHERE cleared_at IS NULL;

-- Recovery trend log: append-only daily check-in trend on an active niggle.
-- Each row is one BETTER/SAME/WORSE/GONE response. 'gone' ALSO sets the
-- parent niggle's cleared_at via the API route — this table just keeps the
-- trend history (so a future "down from 3 over the week" copy can read it).
CREATE TABLE IF NOT EXISTS niggle_recovery (
  id          bigserial PRIMARY KEY,
  niggle_id   bigint NOT NULL REFERENCES niggles(id) ON DELETE CASCADE,
  response    text NOT NULL CHECK (response IN ('better','same','worse','gone')),
  logged_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS niggle_recovery_niggle_idx
  ON niggle_recovery (niggle_id, logged_at DESC);

COMMENT ON TABLE niggles IS
  'Musculoskeletal flag the runner reports. Modifier on base-4. Active row = most recent WHERE cleared_at IS NULL.';
COMMENT ON TABLE niggle_recovery IS
  'Daily check trend on an active niggle. better/same/worse/gone. "gone" also clears the parent niggle (API-side).';
