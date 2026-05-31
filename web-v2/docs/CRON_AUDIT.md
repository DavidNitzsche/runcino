# Cron audit — 2026-05-30

Six cron routes ship in `web-v2/app/api/cron/*`. Four have a GitHub Actions
workflow that fires them. Two have **no scheduler config of any kind** — the
route exists, but nothing on the planet POSTs to it on a schedule. Doctrine
that depends on those two crons is silently dead.

## Summary table

| Route | Purpose | Auth | Evidence of recent run | Scheduler | Risk |
|---|---|---|---|---|---|
| `refresh-briefings` | No-op since 2026-05-28 LLM rip — preserved so cron-job.org doesn't 404 | `CRON_SECRET` | Briefings table last updated 2026-05-28 (LLM rip date — expected) | `.github/workflows/refresh-briefings.yml` — daily 07:05 UTC | Low — endpoint is intentionally a no-op |
| `enrich-weather` | Walk recent un-enriched Strava runs, fold tempF + weather blob | `CRON_SECRET` | **Weak** — 6/125 rows enriched total (5%). Last batch 2026-05-30 had 5 rows (likely from webhook ingestion, not cron pass). Previous batch was 2026-05-27 (3 days earlier — should be daily) | `.github/workflows/enrich-weather.yml` — daily 07:30 UTC | **P2** — workflow exists but evidence pattern suggests cron is failing or the route returns empty; doctrine ("pre-run pace adjustment from weather") relies on enriched rows |
| `run-adaptations` | Detect missed key workouts, RHR spike, sleep crater, volume overshoot → mutate plan_workouts | `CRON_SECRET` | **None for cron path** — `coach_actions` has only 2 rows total, both 2026-05-24/25 (manual seed era, trigger='fitness_shift'), never from `cron-adapt` source. 5 days stale | `.github/workflows/run-adaptations.yml` — daily 07:15 UTC | **P0** — 9 adaptation triggers are wired in `lib/plan/adapt.ts` (GOAL_CHANGED, RHR_SPIKE, SLEEP_CRATER, etc.) but no proof they ever ran in production. The "coach as mastermind" doctrine sits on this cron |
| `keep-warm` | Ping pg pool + warm CoachState loaders per active user | `CRON_SECRET` | No DB writes by design → no direct evidence. No `ops_alerts` rows from `cron` source either, which is good (no failures) | `.github/workflows/keep-warm.yml` — every 15 min, 14-06 UTC | Low — even if it stops, cost is one slow first-load per cold start |
| `notifications` | Drain `notifications_pending` queue + schedule time-based categories (race eve, weekly check-in, niggle/sick, race countdown) | `CRON_SECRET` | **None.** `notifications_log` is empty (0 rows). 1 pending row from 2026-05-29 with `fire_at=2026-05-29T07:15Z` is **still unprocessed**. The cron is not running — the pending row is stuck | **MISSING — no GH workflow, no Vercel config** | **P0** — notification system is wired end-to-end (APNs dispatch, templates, prefs, dedup) but nothing fires the cron. Skip-recovery notification has been sitting in queue for 1+ day |
| `snapshot-projections` | Daily VDOT + race projection snapshot per active user (HM, M, anchor distance) | `CRON_SECRET` | **None for cron path.** 14 rows exist in `projection_snapshots` but **all have `source='seed-script'`** — never `'cron-daily'`. The route hardcodes `'cron-daily'` on line 185, so zero rows from cron | **MISSING — no GH workflow, no Vercel config** | **P0** — race-header.ts uses `projection_snapshots` to compute the projection-trend delta. With no daily snapshots, the trend line is static and silently wrong |

## Scheduler config inventory

**GitHub Actions** (`.github/workflows/`):
- `enrich-weather.yml` → `30 7 * * *`
- `keep-warm.yml` → `*/15 14-23 * * *` + `*/15 0-6 * * *`
- `refresh-briefings.yml` → `5 7 * * *`
- `run-adaptations.yml` → `15 7 * * *`

**Vercel config**: no `vercel.json` in the repo. App ships on Railway (see `web-v2/railway.json`), not Vercel.

**Railway**: `web-v2/railway.json` only defines build + start command. Railway cron uses the cron-job.org integration referenced in route docstrings, but that config lives outside this repo — not visible from here. The comments in `notifications/route.ts` line 11 say *"runs every 15 min via Railway's cron-job.org integration"*, but no evidence shows this is wired.

**npm scripts**: none cron-related (`package.json` only has `dev / build / start / lint / typecheck / eval:voice / test:adapt / test:truth`).

## Open questions worth chasing

1. The two P0 missing crons (`notifications`, `snapshot-projections`) need either a GH workflow added or the cron-job.org dashboard verified. The doc strings *claim* cron-job.org runs notifications every 15 min but evidence contradicts that.
2. `enrich-weather` workflow exists but enrichment is sparse. Either:
   - the cron is returning 200 with `processed=0` (route silently skips a misconfigured row filter)
   - GH Action is failing — check Actions tab for red runs
   - `enrichRecent(14, 30)` window is wrong (only looks at last 14 days but most runs are older)
3. `run-adaptations` has zero historical evidence — was it ever proven to run end-to-end against the production DB, or only in tests?

## Verification queries used

```sql
-- weather coverage
SELECT COUNT(*) AS total, COUNT(weather_enriched_at) AS enriched,
       MAX(weather_enriched_at) AS last_enrich
  FROM strava_activities WHERE user_uuid IS NOT NULL;
-- → 125 total, 6 enriched, last 2026-05-30T22:53:14Z

-- coach_actions (adaptations)
SELECT id, action_type, trigger, created_at FROM coach_actions ORDER BY created_at DESC;
-- → 2 rows, both 2026-05-24/25, trigger='fitness_shift' (NOT a cron trigger)

-- projection_snapshots source
SELECT source, COUNT(*), MAX(snapshot_date) FROM projection_snapshots GROUP BY source;
-- → seed-script: 14 rows, last 2026-05-30. Zero from 'cron-daily'

-- notifications queue
SELECT COUNT(*) FROM notifications_log;       -- → 0
SELECT id, fire_at, processed_at FROM notifications_pending;
-- → 1 row, fire_at 2026-05-29T07:15:00, processed_at NULL (STUCK)
```
