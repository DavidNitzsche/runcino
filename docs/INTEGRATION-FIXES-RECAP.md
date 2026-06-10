# INTEGRATION RACE-KILLER FIXES — RECAP FOR GO

**Date:** 2026-06-10 · **Race:** AFC Half, Aug 16 · **Branch:** `worktree-integration-fixes` (worktree off origin/main ac8ba054, uncommitted, NOT merged)
**Scope delivered:** all 7 RACE-KILLERs + M-1, M-6, M-9, M-16, M-19, M-20, M-21 + runbook + alerts MVP.
**Verification:** `tsc --noEmit` clean across web-v2; xcodebuild clean-build result recorded below; no DB writes, no deploys, no commits — everything below waits for GO.

Diff shape: 21 code files, ~2,500 insertions. Audit cross-reference: `docs/INTEGRATION-AUDIT-REPORT.md`.

---

## What changed, by race-killer

### RK-1 · Watch race payload is no longer hollow — `web-v2/lib/watch/build-workout.ts`, `lib/training/fueling.ts`
Race day now sends `goalSec` (from the A-race goal), `strategyLabel` ("1:29:30 goal · 1:32:00 safe"), and `gelsMi` (fueling plan converted to course miles via goal pace). Long/quality runs send the full `fueling` object (time-anchored gel prompts, runner's own product prefs from `users.fuel_*`), so the 30/60/90-min haptics fire on real runs for the first time. `computeFueling` gained the three wire fields the watch's strict decoder requires (`gPerHr`, `isRehearsal`, `heatAdjusted`). `readinessScore` is rounded server-side (a fractional score used to fail the watch's whole decode — M-13).

### RK-2 · Staleness gate works end-to-end — server + watch
- Server emits `expiresAt` without fractional seconds → **the gate starts working on currently-fielded watch builds the moment this deploys**, no TF required.
- Watch parser accepts both forms (`.withFractionalSeconds` + plain) for the future.
- Stale workout no longer silently ignores START: a STALE state shows, a refetch fires (with a new unreachable callback + sendMessage errorHandler), and after 10s an explicit START ANYWAY appears — race morning with the phone in a gear bag can never brick the button.
- **Server-side backstop (deploys immediately):** a completion whose workoutId's planned date ≠ the run's actual local date is forked to `${workoutId}@${date}` — it lands as a new run on its true date instead of DELETEing the planned day's run. The May-31-style overwrite is structurally impossible even under old watch builds.
- Sim fixtures carried already-expired `expiresAt` values that the broken parser never noticed — bumped, or every simulator drive would have come up stale.

### RK-3 · Mid-run crash recovery — watch `WorkoutTracker/WorkoutEngine/WorkoutRootView`
`recoverActiveWorkoutSession` on launch; re-attach session + live builder; engine snapshot (UserDefaults, written on phase transitions + every 60s) reconstructs the guided workout. RECOVERED screen offers **RESUME** (full engine reconstruction — cursor, banked reps, fired cues; in-flight phase restarts honestly) and **END & SAVE** (HKWorkout persisted, completion built from builder statistics, sent through the normal dual-lane path). Treadmill HR sessions are recognized and discarded exactly as their own flow would. Audio stays inactive during recovery — the documented mile-1 NSException crash class is deliberately avoided. Normal finish/cancel clears the snapshot.

### RK-4 · Race-morning delivery — `native-v2 FaffApp/WatchSync`
Foregrounding the iPhone app now re-pushes the watch context, flushes pending context, and flushes the completion relay queue (`WatchSync.refresh()`, 60s self-throttle). Also refreshes when the watch becomes reachable. Cold launch no longer the only push trigger.

### RK-5 · Race-day push is fireable — `.github/workflows/notifications.yml` + cron route + dispatch
New `*/15 11-13 * * *` UTC tick band covers 04:00–06:59 PT wake times; `isAtLocalTime` window widened 15→30 min (kills straddle-misses on every wake minute; double-enqueue blocked by existing dedup). Quiet hours are now actually enforced in dispatch (runner-local, `bypass_quiet_hours` exempt — race-day/race-eve sail through; a 23:00 streak push defers to morning). Failed sends are no longer consumed: retryable failures (network, 429, 5xx, APNs-not-configured, no-tokens) leave the row pending with `payload._attempts`, give-up marker at 8; permanent rejections (400/403/410) consume with a recorded reason. A transient APNs 503 on race-eve now retries to delivery instead of silently eating the notification.

### RK-6 · APNs — root cause found in prod config, code observability added
**Railway has ZERO `APNS_*` variables** (verified via `railway variables`): APNs was never configured in production — that alone explains both failed sends (May 31, `apns_id NULL`, no error). The host-selection doc trap was real but secondary: `docs/OPERATIONS.md` previously said "unset for TestFlight," which would have pointed production tokens at the sandbox host the moment a key WAS added. Fixed the doc (TestFlight = production host), added `apns_host`/`apns_production`/`delivered_24h`/`failed_24h`/`unacked_alerts` to the health probe, and every failure log row now records the host used. **Needs you:** the actual APNs key (GO item 2).

### RK-7 · races.meta wipe — `app/api/race/route.ts` + `onboarding/complete/route.ts`
Both writers now `SET meta = races.meta || jsonb_strip_nulls(EXCLUDED.meta)`. Existing keys (finishTime, bib, wave, goalSafeDisplay, retro, avgHrBpm) survive any re-add or re-onboarding; non-null incoming values still win; clearing a field remains PATCH's job. The armed wipe on `americas-finest-city` (`goalSafeDisplay`) is defused on deploy.

### RK-0 · Silence broken — alerts MVP
`raiseAlert` now fires (6h-deduped) on: APNs send failures, notifications-cron exceptions, Strava webhook rejections, and webhook lookup errors. The notifications GET probe exposes delivery counts + unacked alerts. (Slack webhook env is optional — GO item 7 if you want pushes about the pushes.)

---

## The majors that rode along

| Fix | What changed |
|---|---|
| **M-1 webhook** (2 root causes) | (a) The validation SELECT referenced `user_uuid` — a column that **never existed** on `strava_webhook_subscriptions`; every event since Jun 5 died on a SQL error, not just the empty table. Fixed to select `subscription_id`. (b) The table is empty — GO item 3 inserts the row (sub 347351 verified ALIVE on Strava's side, callback correct). Plus: optional `?key=` secret layer (`STRAVA_WEBHOOK_SECRET_PATH`, off until set + re-subscribed), rejection alerts. |
| **M-6** | Webhook activity-delete now re-merges the run's date — merged losers can't be stranded pointing at a deleted canonical. |
| **M-9** | Watch-complete: retryable runs-write failures now return **500** (both durable queues hold + retry); permanent refusals (cross-user collision) stay 200-with-error so queues don't loop. `coach_intents` is create-before-delete with errors surfaced (`intents_write` in response) — the trd_* loss class is closed on both ends. |
| **M-16 / Rule 6** | All three run upserts (watch, HK, webhook) converted from DELETE+INSERT to `ON CONFLICT (id) DO UPDATE SET data = runs.data \|\| jsonb_strip_nulls(EXCLUDED.data)` with `WHERE runs.user_uuid = EXCLUDED.user_uuid` backstops. Columns (`shoe_id`, `shoe_auto_assigned_at`, `provenance`, `weather_enriched_at`) survive re-ingest; manual shoe picks stay; tier doctrine can't invert; merged-loser resurrection by Strava rename events is gone. HK warmup-bonus math untouched (it recomputes, then rides the incoming side). |
| **M-19** | Plan rebuild is one transaction (snapshot → archive → persist → mode → COMMIT) with batched inserts (~120 statements → ~7), sealed-snapshot passed as a param (module-state cross-contamination gone), silent-unseal catch removed, poisoned-socket release. Migration `142_active_plan_unique.sql` written, NOT run (GO item 4). |
| **M-20** | `pool.on('error')` (idle-client death no longer crashes the process mid-write), `connectionTimeoutMillis 10s`, `statement_timeout 30s`. |
| **M-21** | One-shot delivery + dead quiet-hours + server-local morning times all fixed (see RK-5); `nextMorning0715` now computes in the runner's timezone. |

## Verified OK during this pass
- Subscription 347351 alive on Strava (`GET /push_subscriptions` with client creds): callback `https://www.faff.run/api/strava/webhook`, created May 18.
- `CRON_SECRET` + `STRAVA_WEBHOOK_VERIFY_TOKEN` present on Railway and GH Actions runs green.
- tsc clean over the combined diff; wire contract: no encoded watch fields changed, no new required decode fields (all additions optional or server-side).

---

## GO CHECKLIST — in order

Everything below is gated on your word. Items 1–5 are the race-critical path.

1. **GO: merge + deploy the code** (this branch → main → Railway). I do the git per deployment doctrine. Immediately live: RK-1, RK-2 server half, RK-4..7 server sides, M-1 code, M-6, M-9, M-16, M-19, M-20, M-21, alerts. (RK-5's new tick band ships with the workflow file on main.)
2. **APNs credentials** (you, ~10 min): Apple Developer → Certificates → Keys → create an APNs auth key (or reuse an existing .p8). Then I set on Railway: `APNS_KEY_ID`, `APNS_TEAM_ID` (same value as existing `APPLE_TEAM_ID`), `APNS_KEY_PEM` (p8 contents), `APNS_BUNDLE_ID=run.faff.app`, `APNS_PRODUCTION=1` — say the word and hand me the key, or set them yourself. Then **I send one end-to-end test push** to your phone and verify `delivered=true` + `apns_id` in `notifications_log`.
3. **DB write GO (one INSERT)** — revives the webhook:
   ```sql
   INSERT INTO strava_webhook_subscriptions (subscription_id, callback_url, verify_token, created_at)
   VALUES (347351, 'https://www.faff.run/api/strava/webhook',
           '<value of STRAVA_WEBHOOK_VERIFY_TOKEN on Railway>', '2026-05-18T17:19:11Z')
   ON CONFLICT (subscription_id) DO UPDATE
     SET callback_url = EXCLUDED.callback_url, verify_token = EXCLUDED.verify_token;
   ```
   Verification: next faff→Strava push echoes a webhook event → `strava_webhook_events` gains a row with `process_status='ok'`.
4. **DDL GO (one statement)** — `web-v2/db/migrations/142_active_plan_unique.sql`:
   `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS training_plans_active_uq ON training_plans (user_uuid) WHERE archived_iso IS NULL;`
5. **TestFlight build** (ships RK-2 watch UI, RK-3 recovery, RK-4 foreground push, M-13 lenient decode): `scripts/ship-testflight-v2.sh` as usual. The watch changes ride the v2 build via the symlink.
6. **Post-deploy reconciliation (M-5):** after the next daily strava-sync refreshes the token, I read your Strava for May 31 (two uploads — possible duplicate activity) and Jun 8 (did the "failed" upload actually process?). Strava-side deletion, if any, is a separate confirm. Alternative: you eyeball the Strava app for those two dates — 30 seconds.
7. **Optional:** `OPS_SLACK_WEBHOOK_URL` on Railway if you want ops alerts pushed to Slack rather than only in `ops_alerts` + the probe; `STRAVA_WEBHOOK_SECRET_PATH` + re-subscribe with `?key=` for webhook Layer 3.
8. **Race-morning runbook:** `docs/RACE-MORNING-RUNBOOK.md` (night-before + morning procedure + during/after).

## Standing checks (weekly until race — I can run these on ask)
- `strava_webhook_events`: ≥1 new `ok` row weekly (your own pushes echo back).
- `strava_pushes`: no `pending` older than 24h.
- `notifications_log`: `delivered=true` present in last 7d once APNs is live.
- HK twin lag: newest `apple_watch` run ≤2 days behind newest `watch` run.
- `sessions`: nothing expiring within 21 days (current phone session: Aug 29 — clears race day; re-auth resets it anyway).
