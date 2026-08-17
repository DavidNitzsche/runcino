-- 2026-08-17-races-composite-pk.sql
--
-- races: PRIMARY KEY (slug) → PRIMARY KEY (slug, user_uuid).
--
-- WHY: slug is a GLOBAL key today. Two users naming the same race on the
-- same date contend for one row; the app layer disambiguates with a
-- userId-suffixed slug (P0-8, made atomic 2026-08-17 in
-- app/api/race/route.ts + app/api/onboarding/complete/route.ts). The
-- composite PK removes the residual risk class entirely: each user owns
-- their own slug namespace and clean URLs stop being first-come-first-served.
--
-- DAVID-GATED. DO NOT RUN without explicit per-statement go. This is a
-- non-additive schema change with a REQUIRED coordinated code deploy.
--
-- ════════════════════════════════════════════════════════════════════
-- PRE-RUN READER/WRITER AUDIT CHECKLIST — every box must be checked
-- before this file is executed. After the PK change, slug alone no
-- longer identifies a row; ANY query filtering races by slug without
-- user_uuid can return/affect another user's race.
-- ════════════════════════════════════════════════════════════════════
--
-- [ ] 1. ON CONFLICT targets. Both upsert sites currently write
--        ON CONFLICT (slug); after this migration that conflict target has
--        no unique index and the INSERTs will ERROR. Coordinated code
--        change to ON CONFLICT (slug, user_uuid) must deploy with this:
--          - app/api/race/route.ts (POST claimSlug)
--          - app/api/onboarding/complete/route.ts (race-path claimSlug)
--        (Their WHERE races.user_uuid = EXCLUDED.user_uuid guard becomes
--        redundant-but-harmless; the suffix-retry loop can be retired.)
--
-- [ ] 2. Slug-scoped readers. Verify every `FROM/UPDATE/DELETE races`
--        with a slug predicate ALSO carries user_uuid = $user (or joins
--        through a user-scoped table). Files touching races at audit time
--        (grep 'FROM races|INTO races|UPDATE races|DELETE FROM races'):
--          app/api/race/route.ts, app/api/race/[slug]/route.ts,
--          app/api/race/[slug]/autofill/route.ts,
--          app/api/race/[slug]/execution-plan/route.ts,
--          app/api/race/gpx/route.ts, app/api/race/result/route.ts,
--          app/api/race/strava-course/route.ts, app/api/gpx/import/route.ts,
--          app/api/onboarding/complete/route.ts, app/api/plan/restore/route.ts,
--          app/api/prescription/route.ts, app/api/targets/projection/route.ts,
--          app/api/today/purpose/route.ts, app/api/today/skip/route.ts,
--          app/api/cron/{notifications,plan-drift,promote-courses,
--            readiness-snapshot,snapshot-projections}/route.ts,
--          app/api/admin/backfill-workout-spec/route.ts,
--          lib/coach/{block-comparison,env-schedule,glance-state,
--            profile-state,projection-levers,race-lookup,races-state,
--            readiness-brief,sleep-coaching,strength-recommender,
--            training-state,voice-band}.ts,
--          lib/courses/promote-from-race.ts,
--          lib/plan/{adapt,generate,goal-gap,simulator}.ts,
--          lib/race/{auto-result,personal-records,result-chain}.ts,
--          lib/training/{goal-projection,vdot-inputs}.ts,
--          lib/watch/build-workout.ts
--        Special attention: training_plans.race_id stores a bare slug.
--        Every join races.slug = training_plans.race_id must also match
--        races.user_uuid = training_plans.user_uuid.
--
-- [ ] 3. URL routes. /races/[slug] pages and /api/race/[slug]/* resolve
--        the row from (slug + session user), never slug alone.
--
-- [ ] 4. Foreign keys. Confirm no FK references races(slug):
--          SELECT conname, conrelid::regclass FROM pg_constraint
--           WHERE confrelid = 'races'::regclass;
--        Any hit must be migrated to the composite key first.
--
-- [ ] 5. user_uuid completeness. The PK requires NOT NULL:
--          SELECT COUNT(*) FROM races WHERE user_uuid IS NULL;
--        Must be 0 (assign legacy rows to David's uuid first if not).
--
-- [ ] 6. No same-user duplicate (slug, user_uuid) pairs (should be
--        impossible under the current single-column PK — sanity only):
--          SELECT slug, user_uuid, COUNT(*) FROM races
--           GROUP BY 1, 2 HAVING COUNT(*) > 1;
--
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- Fails loudly if any NULL user_uuid remains (checklist item 5).
ALTER TABLE races ALTER COLUMN user_uuid SET NOT NULL;

ALTER TABLE races DROP CONSTRAINT races_pkey;
ALTER TABLE races ADD CONSTRAINT races_pkey PRIMARY KEY (slug, user_uuid);

-- Keep slug lookups fast for the (slug + user) access path; the composite
-- PK index already serves it, so no extra index is required. Left here as
-- a reminder in case query plans regress:
--   CREATE INDEX IF NOT EXISTS idx_races_user ON races (user_uuid);

COMMIT;

-- ROLLBACK PLAN (only valid while no two users share a slug):
--   BEGIN;
--   ALTER TABLE races DROP CONSTRAINT races_pkey;
--   ALTER TABLE races ADD CONSTRAINT races_pkey PRIMARY KEY (slug);
--   COMMIT;
