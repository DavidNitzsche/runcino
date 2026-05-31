# Cron audit — 2026-05-30 (updated 2026-05-30 PM: schedulers wired)

Six cron routes ship in `web-v2/app/api/cron/*`. **All six now have a GitHub
Actions workflow.** The two previously-missing schedulers (`notifications`,
`snapshot-projections`) were added in this pass. Both depend on
`CRON_SECRET` being set in the GitHub repo secrets — **ops action required**
(see "Ops note for David" below).

## Summary table

| Route | Purpose | Auth | Evidence of recent run | Scheduler | Risk |
|---|---|---|---|---|---|
| `refresh-briefings` | No-op since 2026-05-28 LLM rip — preserved so cron-job.org doesn't 404 | `CRON_SECRET` | Briefings table last updated 2026-05-28 (LLM rip date — expected) | `.github/workflows/refresh-briefings.yml` — daily 07:05 UTC | Low — endpoint is intentionally a no-op |
| `enrich-weather` | Walk recent un-enriched Strava runs, fold tempF + weather blob | `CRON_SECRET` | **Weak** — 6/125 rows enriched total (5%). Last batch 2026-05-30 had 5 rows (likely from webhook ingestion, not cron pass). Previous batch was 2026-05-27 (3 days earlier — should be daily) | `.github/workflows/enrich-weather.yml` — daily 07:30 UTC | **P2** — workflow exists but evidence pattern suggests cron is failing or the route returns empty; doctrine ("pre-run pace adjustment from weather") relies on enriched rows |
| `run-adaptations` | Detect missed key workouts, RHR spike, sleep crater, volume overshoot → mutate plan_workouts | `CRON_SECRET` | **None for cron path** — `coach_actions` has only 2 rows total, both 2026-05-24/25 (manual seed era, trigger='fitness_shift'), never from `cron-adapt` source. 5 days stale | `.github/workflows/run-adaptations.yml` — daily 07:15 UTC | **P0** — 9 adaptation triggers are wired in `lib/plan/adapt.ts` (GOAL_CHANGED, RHR_SPIKE, SLEEP_CRATER, etc.) but no proof they ever ran in production. The "coach as mastermind" doctrine sits on this cron |
| `keep-warm` | Ping pg pool + warm CoachState loaders per active user | `CRON_SECRET` | No DB writes by design → no direct evidence. No `ops_alerts` rows from `cron` source either, which is good (no failures) | `.github/workflows/keep-warm.yml` — every 15 min, 14-06 UTC | Low — even if it stops, cost is one slow first-load per cold start |
| `notifications` | Drain `notifications_pending` queue + schedule time-based categories (race eve, weekly check-in, niggle/sick, race countdown) | `CRON_SECRET` | **None.** `notifications_log` is empty (0 rows). 1 pending row from 2026-05-29 with `fire_at=2026-05-29T07:15Z` is **still unprocessed**. The cron is not running — the pending row is stuck | `.github/workflows/notifications.yml` — every 30 min, 14-06 UTC (**NEW 2026-05-30 PM**) | **Scheduler now configured, needs CRON_SECRET in GH repo secrets** |
| `snapshot-projections` | Daily VDOT + race projection snapshot per active user (HM, M, anchor distance) | `CRON_SECRET` | **None for cron path.** 14 rows exist in `projection_snapshots` but **all have `source='seed-script'`** — never `'cron-daily'`. The route hardcodes `'cron-daily'` on line 185, so zero rows from cron | `.github/workflows/snapshot-projections.yml` — daily 07:30 UTC (**NEW 2026-05-30 PM**) | **Scheduler now configured, needs CRON_SECRET in GH repo secrets** |

## Scheduler config inventory

**GitHub Actions** (`.github/workflows/`):
- `enrich-weather.yml` → `30 7 * * *`
- `keep-warm.yml` → `*/15 14-23 * * *` + `*/15 0-6 * * *`
- `notifications.yml` → `*/30 14-23 * * *` + `*/30 0-6 * * *` (added 2026-05-30 PM)
- `refresh-briefings.yml` → `5 7 * * *`
- `run-adaptations.yml` → `15 7 * * *`
- `snapshot-projections.yml` → `30 7 * * *` (added 2026-05-30 PM)

**Vercel config**: no `vercel.json` in the repo. App ships on Railway (see `web-v2/railway.json`), not Vercel.

**Railway**: `web-v2/railway.json` only defines build + start command. Railway cron uses the cron-job.org integration referenced in route docstrings, but that config lives outside this repo — not visible from here. The comments in `notifications/route.ts` line 11 say *"runs every 15 min via Railway's cron-job.org integration"*, but no evidence shows this is wired.

**npm scripts**: none cron-related (`package.json` only has `dev / build / start / lint / typecheck / eval:voice / test:adapt / test:truth`).

## Ops note for David

The two new workflows (`notifications.yml`, `snapshot-projections.yml`) both
authenticate with `Bearer $CRON_SECRET` against `https://www.faff.run/api/cron/*`.
They will **fail with HTTP 401** until the GH repo secret is set:

```
# At https://github.com/<owner>/<repo>/settings/secrets/actions
CRON_SECRET = <same value as Railway env var of the same name>
```

The existing four workflows (`enrich-weather`, `keep-warm`, `refresh-briefings`,
`run-adaptations`) already use this same secret, so if they're running green
in the Actions tab the new ones will too once the file lands on main.

Verify after first run by querying:

```sql
-- notifications drained?
SELECT COUNT(*) FROM notifications_log;
SELECT COUNT(*) FROM notifications_pending WHERE processed_at IS NOT NULL;

-- projection snapshots from cron path?
SELECT source, COUNT(*), MAX(snapshot_date)
  FROM projection_snapshots
 GROUP BY source;
-- expect a 'cron-daily' row group appearing the day after the first run
```

## Open questions worth chasing

1. ~~The two P0 missing crons (`notifications`, `snapshot-projections`) need either a GH workflow added or the cron-job.org dashboard verified.~~ **RESOLVED 2026-05-30 PM** — workflows added; awaiting CRON_SECRET deploy.
2. ~~`enrich-weather` workflow exists but enrichment is sparse.~~ **RESOLVED 2026-05-30 PM** — see "enrich-weather sparseness — root cause + fix" section below. Wasn't the GH-Action; was three compounding code bugs.
3. `run-adaptations` has zero historical evidence — was it ever proven to run end-to-end against the production DB, or only in tests?

## enrich-weather sparseness — root cause + fix (2026-05-30 PM)

The "71/126 enriched" symptom was actually three compounding issues in
`lib/weather/openmeteo.ts`, not the GH-Action failure suspected upstream.

### Reality of the 126 rows (pre-fix)

| Bucket | Count | Why |
|---|---|---|
| `enriched` (data.weather present) | 46 | Working as designed |
| `attempted_no_weather` (stamp set, no weather) | 25 | Transient Open-Meteo flake from earlier passes |
| `no_coords` (no usable GPS) | 32 | HK pure-time runs — un-enrichable by definition |
| `pending` (NULL stamp) | 23 | Had `startLatLng` key but value was JSONB `null` |

### Root cause (three bugs)

1. **`enrichOneActivity` didn't stamp un-enrichable rows.** When `!coords ||
   !startISO`, it returned `null` without setting `weather_enriched_at`.
   That left ~30 GPS-less HK rows in the pending queue *forever* — every
   cron run pulled them into the `LIMIT 20` batch, returned null, repeated.
   Real GPS-having rows behind them in the date sort never got reached.

2. **`enrichRecent` filter used `data ? 'startLatLng'`.** Postgres `?`
   tests key *existence*, not value type. 23 rows had the key with value
   JSONB `null` (Strava ingests this when a run had no recorded route).
   These passed the filter, hit `pickLatLng` → null, bailed at the
   un-stamp-on-null path above. Same wasted-slot pattern.

3. **No retry of `attempted_no_weather` rows.** Once stamped, a row was
   excluded from future batches by `weather_enriched_at IS NULL`, even
   when the prior failure was a transient 5xx that would now succeed.

### Fix shipped (in `lib/weather/openmeteo.ts`)

- `enrichOneActivity`: stamp `weather_enriched_at = NOW()` even when
  `!coords || !startISO` so un-enrichable rows exit the pending queue
  on first sight.
- `enrichRecent`: filter on `jsonb_typeof(data->'startLatLng') = 'array'`
  (or equivalent flat-scalar check) instead of `data ? 'startLatLng'`,
  plus retry rows stamped > 7 days ago with no weather — covers the
  transient-Open-Meteo-flake recovery case.

### Result

Re-ran `enrichRecent(365, 50)` post-fix + a one-shot backfill of the 24
retriable GPS rows (Open-Meteo returned valid temps for all 24):

| Bucket | Count |
|---|---|
| `enriched` | 71 |
| `no_gps_marked_attempted` | 23 (the former JSONB-null bucket — correctly drained) |
| `pending_no_gps` | 32 (HK pure-time, no GPS — correctly excluded from batch now) |

**100% of GPS-having activities now have weather** (65/65, plus 6 enriched
shadows on merged/flat-coord rows = 71 with data.weather). The remaining
55 GPS-less rows are un-enrichable by definition — the briefing voice
already hides the weather card for them (checks `data.weather` before render).

### Re-verify

```sql
SELECT
  COUNT(*) FILTER (WHERE data ? 'weather') AS has_weather,
  COUNT(*) FILTER (WHERE jsonb_typeof(data->'startLatLng') = 'array') AS has_gps,
  COUNT(*) FILTER (WHERE jsonb_typeof(data->'startLatLng') = 'array'
                     AND data ? 'weather') AS gps_and_weather
  FROM strava_activities;
-- → 71 / 65 / 65 (100% of GPS rows enriched)
```

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
