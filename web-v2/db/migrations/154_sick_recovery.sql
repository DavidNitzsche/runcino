-- 154_sick_recovery.sql
-- The half of migration 117 that never landed.
--
-- 117_sick_episodes.sql declares TWO tables. `sick_episodes` is in prod;
-- `sick_recovery` is not. Confirmed with `faff_readonly` on 2026-08-24 — and
-- the sibling pair from migration 116 (`niggles` + `niggle_recovery`) BOTH
-- landed, which is what makes this a partial apply rather than a design.
--
-- This was the one with a live cost. Two handlers write the trend row:
-- app/api/sick/recovery/route.ts and app/api/notifications/ack/route.ts. In
-- both, the INSERT ran BEFORE the `cleared_at` UPDATE and inside the same
-- try — so a runner who tapped "I'm better, let's run" got a 500 and STAYED
-- MARKED SICK, with resolveDayState still routing /today to the sick state and
-- the plan still paused, on an illness they had told us was over. The
-- 2026-08-24 sweep wrapped the INSERT in `attempt()` so the state change can
-- no longer be taken down by the log row. This migration means there is
-- nothing left to take it down.
--
-- The statements are 117's, verbatim, so applying this leaves the schema
-- byte-identical to what a clean 117 apply would have produced. 117 is
-- `IF NOT EXISTS` throughout and stays safe to re-run.
--
-- No user column by design: `sick_recovery` is a child of `sick_episodes` and
-- is cleared by the parent's ON DELETE CASCADE. /api/account/delete already
-- accounts for exactly this (lib/account/deletion-plan.ts · externalChildEdges,
-- which names niggle_recovery and sick_recovery), so account deletion needs no
-- code change.
--
-- Additive only: one new table, one new index. Idempotent.
--
-- REVERSED BY: DROP TABLE IF EXISTS sick_recovery;
-- (created empty; it is an append-only log, and no other table reads it)

CREATE TABLE IF NOT EXISTS sick_recovery (
  id          bigserial PRIMARY KEY,
  episode_id  bigint NOT NULL REFERENCES sick_episodes(id) ON DELETE CASCADE,
  response    text NOT NULL CHECK (response IN ('better','same','worse','recovered')),
  logged_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sick_recovery_episode_idx
  ON sick_recovery (episode_id, logged_at DESC);

COMMENT ON TABLE sick_recovery IS
  'Daily check trend on an active sick episode. better/same/worse/recovered. '
  '"recovered" also clears the parent episode via the API route.';
