-- 152_personal_goals.sql
-- The table `/api/goals` has been writing to since it shipped.
--
-- `personal_goals` is named by four statements in web-v2 (GET/POST in
-- app/api/goals/route.ts, PATCH/DELETE in app/api/goals/[id]/route.ts) and by
-- nothing else. No migration ever created it. Confirmed absent in prod with
-- `faff_readonly` on 2026-08-24, and absent from every file in db/migrations.
--
-- The cost, before the 2026-08-24 swallowed-failure sweep: GET threw
-- `relation "personal_goals" does not exist` (SQLSTATE 42P01) on every call and
-- `.catch(() => ({ rows: [] }))` turned that into `{ ok: true, goals: [] }` — a
-- 200 saying the runner has no goals, stated confidently, forever. The sweep
-- replaced that with `outage()`, which is the correct answer to a question you
-- cannot answer. This migration is the answer to the question itself.
--
-- SHAPE. This is the DDL the route header proposed verbatim, which is the
-- shape the four live statements need:
--   · `user_uuid` is the only user key. The legacy single-tenant table (see
--     legacy/web/lib/db.ts, and the local faff_sandbox clone that still carries
--     it) had `user_id text NOT NULL DEFAULT 'me'` alongside. web-v2 never
--     writes it and never reads it, and a column that defaults every runner to
--     the string 'me' is the multi-tenant landmine, not compatibility.
--   · 'strength' stays in the CHECK. STRENGTH-3 (2026-08-17) stopped OFFERING
--     strength goals — `VALID_GOAL_TYPES` in the route gates writes — but it
--     deliberately kept existing rows readable. The constraint has to permit
--     what the reader promises to render.
--   · The index is (user_uuid, deadline): the GET filters on user_uuid and
--     `deadline IS NULL OR deadline >= CURRENT_DATE` and orders by deadline.
--     The legacy (user_id, created_at DESC) index served a query nothing runs.
--
-- ON DELETE CASCADE mirrors every other user-keyed coach table, so
-- /api/account/delete (which enumerates user-keyed tables from pg_catalog at
-- runtime) picks this up with no code change.
--
-- Additive only: one new table, one new index. No drop, no rename, no
-- type change, no NOT NULL on existing data. Idempotent.
--
-- REVERSED BY: DROP TABLE IF EXISTS personal_goals;
-- (the table is created empty, so nothing is lost by dropping it)

CREATE TABLE IF NOT EXISTS personal_goals (
  id          bigserial PRIMARY KEY,
  user_uuid   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_type   text NOT NULL CHECK (goal_type IN
                ('volume','speed','distance','habit','health','strength')),
  target      text NOT NULL,
  current     text,
  deadline    date,
  tolerance   text,
  rationale   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS personal_goals_user_idx
  ON personal_goals (user_uuid, deadline);

COMMENT ON TABLE personal_goals IS
  'Non-race goals (volume/speed/distance/habit/health). Written by /api/goals. '
  'goal_type=''strength'' is READ-ONLY legacy: STRENGTH-3 stopped accepting new '
  'strength goals but existing rows still render.';
