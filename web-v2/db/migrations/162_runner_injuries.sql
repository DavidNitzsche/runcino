-- 162_runner_injuries.sql
--
-- BACKFILL OF A MISSING FILE, not a new table. `runner_injuries` has existed
-- in the production database since 2026-08 (`app/api/injuries/route.ts`
-- writes it, `lib/plan/injury-builder.ts` and the v5 Today surface read it)
-- and NO migration in this directory ever declared it. Any environment
-- rebuilt from `db/migrations` therefore has no injury table at all.
--
-- That mattered enough to fix on 2026-09-02 because `lib/safety/**` now
-- treats SQLSTATE 42P01 on this relation as `NOT_DEPLOYED` -> UNKNOWN rather
-- than as "no injury" (the runner's ruling: a failed safety read must never
-- silently become "not injured"). Without this file a fresh environment would
-- correctly, and permanently, refuse to clear anyone.
--
-- Transcribed from the live schema, 2026-09-02, read-only
-- (`information_schema.columns` + `pg_indexes` against `faff_readonly`).
-- Idempotent, per this directory's README. Applied by hand.
--
-- NOTE on `severity`: production has NO check constraint on it, and none is
-- added here. `lib/safety/load-safety.ts` reads an unrecognised value as the
-- MOST serious band rather than the mildest, so the absent constraint cannot
-- produce a permissive verdict. Adding one now would fail against any row
-- already outside the set, which is a migration this file is not.

CREATE TABLE IF NOT EXISTS runner_injuries (
  id                    SERIAL PRIMARY KEY,
  user_id               TEXT        NOT NULL DEFAULT 'me',
  user_uuid             UUID,
  site                  TEXT        NOT NULL,
  severity              TEXT        NOT NULL DEFAULT 'minor',
  return_protocol       TEXT,
  notes                 TEXT,
  start_date            DATE        NOT NULL DEFAULT CURRENT_DATE,
  expected_return_date  DATE,
  resolved_date         DATE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The partial index the open-injury point read depends on. Every safety read
-- is `WHERE user_uuid = $1 AND resolved_date IS NULL ORDER BY start_date DESC
-- LIMIT 1`, and it sits on the wrist's critical path.
CREATE INDEX IF NOT EXISTS idx_runner_injuries_active
  ON runner_injuries (user_uuid)
  WHERE resolved_date IS NULL;
