# INTEGRATION HEALTH AUDIT — faff.run

**Date:** 2026-06-09 · **Race:** Americas Finest City Half, 2026-08-16 (68 days out)
**Scope:** Strava, HealthKit ingest, watch sync, notifications/crons, DB write paths, reconciliation
**Method:** 5 parallel code-trace audits + read-only prod DB forensics (`faff_readonly` role, 0 write grants) + GitHub Actions run-log inspection. No production data was modified. Every finding carries file:line evidence; prod-confirmed findings carry query results.

**Severity:** 🔴 RACE-KILLER (race data loss / race-day execution failure) · 🟠 MAJOR (training data loss / stuck state needing manual repair) · 🟡 MINOR (friction, latent risk)

---

## Verdict

The **completion return path** (watch → dual-lane upload → idempotent server write → auto-merge) and the **Strava push backstop** are the most hardened parts of the system. The race-day-critical surfaces are the weakest: the watch race payload is hollow, the staleness gate is dead code, mid-run crash recovery doesn't exist, the race-morning notification is structurally unfireable, and **every failure in the system is silent by construction** — `ops_alerts` has zero rows ever, all 100 recent cron runs report green while three pipelines were degraded underneath them.

Seven RACE-KILLERs, ~20 MAJORs, ~25 MINORs. Detail below.

---

## 🔴 RACE-KILLERS

### RK-1 · Watch race payload is hollow — gels, goal, strategy never sent

`web-v2/lib/watch/build-workout.ts:486-512` builds the `WatchWorkout` but never assigns `goalSec`, `strategyLabel`, `gelsMi`, or `fueling` (interface declares all four at :72-75; `goal_seconds` is computed at :328 and dropped). `lib/training/fueling.ts` has zero call sites in this path.

Watch consequences (all confirmed in watch code):
- Gel cues never fire — `WorkoutEngine.swift:764-770` gates on `gelsMi` (nil).
- Long-run fueling prompts never fire — `WorkoutEngine.swift:628-641` gates on `fueling` (nil).
- Goal delta dead — `projectedDeltaSec` (`WorkoutEngine.swift:296-299`) needs `goalSec`; race face shows no ahead/behind read; `SummaryView.swift:121-127` renders "—".

Simulator fixtures (`WatchWorkoutModels.swift:619-655`) set these fields, so sim testing looks perfect. **Confirmed-in-code.**

### RK-2 · Staleness gate is dead code — watch can start YESTERDAY's workout race morning, and its completion DELETEs yesterday's run

- Server stamps `expiresAt` via `toISOString()` (`build-workout.ts:502`) — always fractional seconds (`.000Z`).
- Watch parses with default `ISO8601DateFormatter` (`WorkoutRootView.swift:51`) which **cannot parse fractional seconds** → nil → permissive fall-through (:48-50). The gate has never fired on any production payload.
- `workoutId = ${userId}-${today}` (`build-workout.ts:487`). Starting Saturday's cached workout Sunday morning produces a completion carrying Saturday's workoutId → `complete/route.ts:292-318` `DELETE FROM runs WHERE client_workout_id = $2` + INSERT → **Saturday's run row is destroyed and replaced by Sunday's race**, filed against the wrong day.
- Trap for the fixer: with the formatter fixed, the gate's failure mode is a **silent return** (`WorkoutRootView.swift:51-58`) — START ignores taps with no message, and the re-fetch silently no-ops when the phone is unreachable (`PhoneSync.swift:165`). The fix needs UI + fallback, not just the formatter. **Confirmed-in-code.**

### RK-3 · No HKWorkoutSession recovery — crash/reboot mid-race loses the entire recording on every path

Zero hits for `recoverActiveWorkoutSession` in either app. `WorkoutTracker.swift:124-196` holds the session; the HKWorkout is only persisted in `end()` (:219-247) called from `WorkoutEngine.finish()`. All engine state is in-memory. Watch crash/reboot at mile 20 → relaunch boots to lobby, never reattaches → `finishWorkout()` never runs → **no HKWorkout, so the iPhone HK fallback has nothing either** → no WatchCompletion → total loss. Two prior mid-run crash classes are documented in this very file (`WorkoutTracker.swift:155-161`, `:180-185` — "killed the user's run at mile 1"). **Confirmed-in-code.**

### RK-4 · Race-morning delivery is a single fragile chain — context push fires only on cold phone launch

`WatchSync.shared.start()` (→ `pushTodayToWatch`) is called **only** from `didFinishLaunching` (`NotificationsAppDelegate.swift:44`). The scenePhase foreground handler (`FaffApp.swift:146-155`) re-imports HK but never re-pushes watch context or flushes the completion queue. iOS keeps apps resident for days → race morning, opening the phone does NOT push the race workout. The watch's own pull (`WorkoutRootView.swift:114-116` → `PhoneSync.swift:163-169`) requires phone-in-range + background wake + network + a full fetch inside the WCSession reply window, with a nil `errorHandler` (timeout silent). A payload fetched the previous evening is the previous day's workout (`buildWatchToday` computes `today` at fetch time). Combined with RK-2: watch shows yesterday's session and will happily start it. **Confirmed-in-code** (reply-timeout magnitude needs runtime check).

### RK-5 · Race-day morning push is structurally unfireable — the cron schedule has no tick during the wake window

- Category A fires only when `isAtLocalTime(...)` is true — a strict 15-minute window (`app/api/cron/notifications/route.ts:253-260, 313`).
- `.github/workflows/notifications.yml` schedule: `*/30 14-23 * * *` + `*/30 0-6 * * *` UTC → **no ticks 07:00–13:59 UTC = 23:30–07:00 PT**.
- **Prod-confirmed:** David's `race_day_wake_time` is `06:00` PT = 13:00 UTC — inside the dead zone; window [06:00, 06:15) PT can never contain a tick; first tick of the day (07:00 PT) computes delta 60 min → miss. `master_enabled / race_day_enabled / race_eve_enabled` are all `true` — the push is expected and will never come. The promised "T-wake +5min retry row" (`db/migrations/122_notifications_pending.sql:16-17`) does not exist in code.
- Empirical corroboration: **no time-based notification category has ever enqueued a row** — `notifications_pending` contains only event-based `skip_recovery` (2 rows, ever).

### RK-6 · APNs delivery has never succeeded, and the host selection is likely wrong for TestFlight

- **Prod:** `notifications_log` has exactly 2 rows ever (both `skip_recovery`, 2026-05-31), both `delivered=false`, `apns_id=NULL`, **no error reason recorded**. There is zero evidence any push has ever reached the phone.
- `web-v2/lib/notifications/apns.ts:161-165`: production host only when `APNS_PRODUCTION === '1'`. `docs/OPERATIONS.md:177` instructs "unset for TestFlight" — **wrong**: TestFlight signs with a production profile and registers a production token; sandbox host + production token = APNs 400 `BadDeviceToken`, recorded as `delivered=false`, not retried, not alerted, and hidden by the iPhone inbox filter (`app/api/notifications/inbox/route.ts:42`). 400 ≠ 410 so the token is never revoked — every future send repeats the failure.
- The same dedup_key was logged twice 3h apart (May 31) — failed sends don't dedup, so the system re-fired and re-failed.
- **Decisive runtime checks (cannot be answered from code/DB):** Railway `APNS_PRODUCTION` value, then one end-to-end test push to the physical phone (`docs/OPERATIONS.md:190` documents the procedure). 5 device tokens are registered and fresh (last_seen today), so the token side is ready.

### RK-7 · `races.meta` full-replace upsert wipes finish time, bib, goal-safe, retro — armed on the Aug 16 race row

`app/api/race/route.ts:57-62` (POST) and `app/api/onboarding/complete/route.ts:421-426` both do `ON CONFLICT (slug) DO UPDATE SET meta = EXCLUDED.meta` with a 6-key meta, while PATCH (`race/route.ts:124-140`) accumulates 11 more keys onto the same blob (`finishTime`, `bib`, `wave`, `goalSafeDisplay`, `avgHrBpm`, retro fields — finishTime drives LTHR/VDOT recalc at :199-254). Re-adding the race from the UI or re-running onboarding (same slug by construction, explicitly "idempotent") **silently destroys the race result and goal fields**. This is the legacy `saveRaceDB actual_result` bug shape (CLAUDE.md Rule 6) reincarnated on `races.meta`.

**Prod-confirmed armed:** `americas-finest-city` already carries `goalSafeDisplay` — one re-add wipes it today; a finish time entered after Aug 16 is one re-add away from deletion. Race PATCH is also an unlocked read-modify-write (:119-122 → :141-144). Fix: `meta = races.meta || EXCLUDED.meta` or field-guarded CASE, symmetric on both writers.

### RK-0 (meta) · Zero failure visibility — every failure above is silent by design

- `ops_alerts` has **zero rows ever** (prod). `raiseAlert` has one call site in the whole app (`run-adaptations/route.ts:124`); `recentUnackedAlerts` has zero callers (write-only table); `lib/ops/sentry.ts reportError` has zero callers; Slack webhook is env-gated with swallowed failure.
- All 100 most-recent GitHub Actions runs are green; cron routes return HTTP 200 with errors folded into the body (`notifications/route.ts:107-121` returns `ok:true` with `stats.errors`), and most workflows only hard-fail on non-200/401.
- No dead-man switch. Telemetry HTML is pull-based and delivery-blind ("pending: 0" proves drain, not delivery).
- During this audit, three pipelines were degraded behind green crons (webhook validation rejecting everything, APNs never delivering, sync bookkeeping frozen). Until an alert channel exists and is itself tested, every other fix is unverifiable in operation.

---

## 🟠 MAJOR

### Strava

**M-1 · Inbound webhook is dead right now — `strava_webhook_subscriptions` is empty, so the P0-3 validation rejects every event.**
`app/api/strava/webhook/route.ts:125-160` requires body `subscription_id` to match a stored row; the table has **0 rows** (prod). The 2 events ever processed (May 29, Jun 1, sub id 347351) predate the validation deploy (Jun 5). Since then every real Strava event — including activity deletes and athlete deauth — is dropped with console.warn + HTTP 200 (Strava won't retry). Re-insert the subscription row (or re-subscribe via the admin route) and consider Layer-3 secret path while at it.

**M-2 · No webhook replay path** — `strava_webhook_events` records `pending/error/skipped` states "so failed events can be replayed" (`db/migrations/119_strava_webhook.sql:17`) but the only UPDATE is `markProcessed` in the route itself; nothing re-runs stuck events. Processing is fire-and-forget after the 200 ACK (`webhook/route.ts:201, 228-337`) — a Railway deploy mid-process strands the event at `pending` forever. Sole backstop: the 30-day daily pull.

**M-3 · Pull-sync failure is invisible in the connection UI, and success leaves no heartbeat.**
Refresh-token death writes `last_sync_status='partial'` + `'token: STRAVA_REFRESH_FAILED: 400…'` (`pullSync.ts:299-302, 505-514`), but `needs_reauth` requires `status==='error'` AND `/401|REAUTH/i` (`connection-status.ts:91-94`) → UI keeps saying "connected" forever. **Prod:** `connector_tokens.last_sync_at` is frozen at **May 25** while the cron runs green daily (today: fetched 12, errors 0) — the success path never stamps it, so the one observable signal is already meaningless: a real failure would look identical to the current state.

**M-4 · Token-refresh brick window.** `refreshStravaToken` (`auth.ts:77-130`) persists the rotated refresh token *after* the Strava call; a crash between response and persist leaves the dead old token in the DB → every later refresh throws → combined with M-3, invisibly. Probability gated on Strava actually rotating refresh tokens (needs runtime check); no concurrency guard on simultaneous refreshes (`auth.ts:66-70`, bounded impact).

**M-5 · Strava "failed" pushes may actually exist on Strava — and the same run was uploaded twice.**
**Prod:** `strava_pushes` rows 3+4 are the **same run** (`…-2026-05-31`) with two different upload_ids (no UNIQUE on run_id; pending-row idempotency only short-circuits on `uploaded`, `push.ts:52-65, 131`); all 3 `failed` rows say "unresolved after 24h (upload id expired)" — the uploads were accepted by Strava and only the *status poll* expired (the poll cron didn't exist until Jun 9). The activities may be live on Strava while faff records failure. **Manual reconciliation needed for May 31 + Jun 8 on Strava's side; dup cleanup if both May 31 uploads processed.** The new poll cron works (Jun 9 push resolved `uploaded` + activity id 18856408342 same-minute).

**M-6 · Webhook activity-delete doesn't re-merge the day** (`webhook/route.ts:282-296` hard-DELETE, no `autoMergeForDate`, unlike create/update at :315-322). If the deleted Strava row was the cluster canonical (possible via the GPS-divergence preference, `identity.ts:153-171`), the watch/HK losers stay flagged `mergedIntoId → deleted id` → day vanishes from volume; nightly cron heals only within its 14-day window (`cron/dedupe-runs/route.ts:60`). Currently unreachable only because M-1 killed the webhook entirely.

**M-7 · Ingest-path value drift:** webhook stores `avgCadence = average_cadence * 2` and raw ft elevation (`webhook/route.ts:441-442`); pull stores un-doubled cadence and sanitized elevation (`pullSync.ts:147, 124-128`). **Prod-confirmed:** strava row cadence 159 vs strava_webhook row 114 — same engine, different semantics per lane; which value a run carries depends on arrival order.

### Watch / completion path

**M-8 · Relay lane silently dead for long runs.** Completion payloads carry 5s pace+HR samples with unrounded Doubles (`WorkoutEngine.swift:589-602`, `WatchWorkoutModels.swift:259-269`) — a 2h run ≈ 100-150KB vs WCSession's ~65KB cap; **neither app implements `session(_:didFinish:error:)`**, so `transferUserInfo` failure is invisible (`PhoneSync.swift:177-184`). Long runs arrive only via the watch's direct POST — which never gets the iPhone timezone splice (`WatchSync.swift:171-181`), so long runs land timezone-less. **Prod:** only 5 of 12 watch rows have `timezone`, 4 of 12 have `avgHrKind` — the lane split is real, and which row becomes canonical (watch vs HK) flips with delivery lane (`identity.ts:140-152`).

**M-9 · Server acks 200 when the runs write failed — both durable queues then purge the completion.**
`complete/route.ts:289-326` catches the runs DELETE+INSERT failure, still returns 200 (`:353-365`); watch (`PhoneSync.swift:276-278`) and phone (`WatchSync.swift:190-191`) both dequeue on any 2xx. The `coach_intents` writes are `.catch(() => {})` (`route.ts:142,147` — DELETE-then-INSERT, so a failed INSERT after a successful DELETE also destroys the *previous* blob). **Prod-confirmed instance:** 2 `trd_*` completions (Jun 2) have coach_intents rows and **no runs row** — acked, purged, lost.

**M-10 · Same-day restart overwrite.** `workoutId` is per-day; after Done the lobby allows START again; a second completion clearing the tap-test guard (≥0.25mi or ≥180s, `route.ts:114-133`) DELETEs the day's run and replaces it — **a 0.5mi post-race cooldown jog replaces the race** as the tier-5 canonical (HK twin survives as a non-canonical row). Race-day procedure note at minimum; per-session ids as the fix.

**M-11 · Locked-iPhone 401 chain can sign the user out and strand the watch token.**
Phone keychain token is `WhenUnlockedThisDeviceOnly` (`TokenStore.swift:160`; the comment claims background access — that's `AfterFirstUnlock` semantics, not this). WCSession delivers a queued completion while locked → token read nil → POST without Bearer → 401 → `.faffSessionExpired` → handler **clears the real token + onboarding flag** (`FaffApp.swift:239-249`). Watch token refresh only rides the next cold-launch context push (`WatchSync.swift:56-58`); on its own 401 the watch deletes its token (`PhoneSync.swift:279-281`) and direct uploads stop.

**M-12 · Sessions: fixed 90-day TTL, no refresh-on-use** (`lib/auth/session.ts:32,248`). **Prod:** the live email-kind sessions (phone, last_used today) expire **Aug 29 – Sep 5** — they clear race day by ~2 weeks, but every cookie session dies Jun 16-24 and the refresh-kind batch dies **Aug 18-22 (race week)**. A re-sign-in between now and August resets the clock; an expiry mid-cycle stops all ingest until re-auth. Verify which session the phone actually holds in early August.

**M-13 · Watch decode failure is silent and sticky — and a fractional `readinessScore` can cause it today.**
`PhoneSync.apply` (`PhoneSync.swift:201-210`): decode throw → keep yesterday's workout, no error surface. The frozen watch decodes strict `Int`s (`WatchWorkoutModels.swift:205-241`); readiness pillars produce unrounded floats (`lib/coach/readiness.ts:87,116,228`) → `readinessScore: 67.4` fails the whole WatchWorkout decode on both lanes. The field has **zero consumers on the watch** (pure decode-risk): round it server-side or stop sending it. Readiness on the watch is otherwise fully unwired (no `/api/watch/readiness`; phone never sends the `readiness` key; `ReadinessGlanceView` permanently empty on hardware, sim shows hardcoded 82).

### HealthKit / ingest

**M-14 · HK ingest: no observer query, no background delivery, no watermark, 7-day hard horizon** (`FaffApp.swift:44-131,146-155`; `HealthKitImporter.swift:264-280`). Triggers are cold launch (7d window) and foreground (2d window, 30s throttle). A non-Faff-watch run (Apple Workouts app) is **permanently lost** if no cold launch happens within 7 days; a route that lags HK sync uploads GPS-less and freezes that way if not re-imported in-window. **Prod-corroborated:** HK twins for Jun 1–5 runs all landed Jun 8–9 (cold launches from TF installs); **Jun 7's 12.55mi long run has no HK twin at all** and its watch row arrived GPS-less, elevation-less (`id -266958841059441`, 11 splits for 12.55mi, weather stamped-but-empty) — single-source fragility materialized on the longest run of the block. Open question: why no HK twin for Jun 7 when Jun 8-9 cold launches were inside the 7-day window — check the Workouts app for whether the watch persisted that workout at all (links to RK-3 crash class).

**M-15 · Nightly weather cron can never reach polyline-only rows — i.e., every watch and HK row.**
`enrichRecent`'s SQL filter requires flat lat/lng fields (`openmeteo.ts:751-756`) that watch/HK rows never have (they carry `routePolyline` only), even though `pickLatLng → decodePolylineStart` handles them (`openmeteo.ts:588-592`). Inline Tier-2 fetch failure → permanent gap: the failure path stamps `weather_enriched_at` (`openmeteo.ts:695-701`), and the lazy run-detail re-enrich requires the stamp be NULL (`run-state.ts:331`). **Prod:** 9 of 30 recent polyline-only runs missing weather (8 apple_watch + 1 watch). Heat-adjustment and HEAT-DRIFT relabel degrade silently exactly in race-prep heat season.

**M-16 · All three run upserts are DELETE-then-INSERT that wipe sibling-writer columns** (Rule 6 generalization of Cluster 1b):

| Path | Preserves across re-ingest |
|---|---|
| HK ingest `ingest/workout/route.ts:334,340` | warmup bonus + `mergedIntoId` (Cluster 1b fix present) — **not** `shoe_id`, `provenance`, weather stamp |
| Watch `watch/workouts/complete/route.ts:292,316` | **nothing** |
| Webhook `strava/webhook/route.ts:459-489` | **nothing** |

Consequences: manual shoe picks destroyed then re-auto-assigned as a *different* shoe with a system stamp (`runs/[id]/route.ts:69-75` manual marker vs `auto-assign.ts:88-95`) — race-shoe mileage corrupts silently; `provenance` wiped → `tierFor` reads 0 → **Strava pull overwrites watch/HK values** on enhanced rows (tier doctrine inverts). **Prod:** 7 watch/HK rows already have wiped/empty provenance. DELETE+INSERT is also non-transactional — INSERT failure after DELETE = run gone (watch route then 200-acks, M-9).

**M-17 · Full-replace read-modify-write in the absorber and pull-sync enhancer** (`canonical.ts:123-247 SET data = $1`, `pullSync.ts:329-365`): races with the fire-and-forget post-write hooks (`void afterRunWrite`, ingest `route.ts:297-298`), the sibling request's weather patch, and `autoMergeForDate` — can resurrect a stale `mergedIntoId` (the 2026-06-07 circular-merge class) or drop enrichment fields with no retry (elev gate fires only when `elevGainFt IS NULL`). The ingest route's weather write was already converted to a scoped `data || patch` for exactly this bug; these two writers kept the old pattern.

**M-18 · Timezone model: PT is hardcoded in the importer** (`HealthKitImporter.swift:300-314`), Strava Z-strip re-interprets athlete-local as PT (`identity.ts:74`), `isSameRun` requires equal `localDay` (`identity.ts:99`), watch `date` uses profile tz (`route.ts:176-181`). All self-consistent **only while everything stays Pacific**. AFC (San Diego) is Pacific → dormant for Aug 16, but any away race / travel week re-opens dedup false-negatives (double-counted race) and shifts weather buckets. Known legacy instance already in memory.

### Plans / DB layer

**M-19 · Plan rebuild is archive-then-~100-inserts with no transaction** (`lib/plan/generate.ts:1519-1797`): crash after `clearActivePlansFor` → **no active plan** (today/watch/adaptation crons go dark); crash mid-loop → half-plan that looks healthy; retry loses sealed prescriptions (`seal.ts:143-157` reads only unarchived plans, and its snapshot query ends `.catch(() => rows: [])` — a transient error silently disables sealing). Callable unattended via silent-rebuild/auto-rebuild during taper. Also `sealedSnapshot` is module-scoped mutable state (`generate.ts:1539`) — concurrent generations cross-contaminate (multi-user latent); auto-rebuild's 60s dedup is TOCTOU (`auto-rebuild.ts:98-115`) and `training_plans` has **no unique partial index on active plans** (prod-verified: only pkey + non-unique `training_plans_active`) → two-active-plans state is structurally possible. Prod currently clean (1 active plan, 11 weeks/77 workouts, race-day row present: Aug 16 `race 13.1` with spec).

**M-20 · `lib/db/pool.ts:12-20` has no `pool.on('error')` handler** → an idle-client backend death (Railway restart, proxy idle-kill) emits an unhandled `'error'` event and **crashes the process mid-write** — the very crash that mints M-16/M-19 partial states. Also missing `connectionTimeoutMillis` / `statement_timeout`; `ssl rejectUnauthorized: false`. One-line insurance, do it first.

**M-21 · Notifications are one-shot with sub-tick windows.** Drain marks `processed_at` in `finally` "either way" (`cron/notifications/route.ts:159-166`) — failed sends are consumed, never retried (code comments claim otherwise, `apns.ts:27-31, 349-351`). 15-min fire windows vs 30-min ticks: the hardcoded 07:15 niggle/sick check (`route.ts:376`) is **deterministically missed** on on-time ticks; race-eve 21:00 PT has exactly one eligible tick and GH Actions drift is observed at hours-scale on this repo (telemetry workflow scheduled 06:00 UTC lands 08:29–11:25). Quiet hours are never enforced (`isInQuietHours` zero callers) — currently masked by the schedule dead-zone; **whoever fixes RK-5's window must implement quiet hours simultaneously** or 2am pushes become possible (`nextMorning0715` also uses server-local time = 00:15 PT, `enqueue.ts:70-75` — two bugs currently cancelling).

**M-22 · The whole background-job layer hangs off GitHub Actions with unpinned assumptions:** schedules fire only from the GitHub default branch (currently `main` per `git remote show origin`, but nothing in-repo records/pins this and route comments still claim a "Railway cron-job.org integration" that doesn't exist); GitHub auto-disables schedules after 60 days of repo inactivity; `CRON_SECRET` must match across GH secrets + Railway env; workflow failures email only the workflow author. A default-branch flip or secret rotation kills all 14 crons simultaneously and silently (see RK-0).

---

## 🟡 MINOR (abridged — full detail in agent traces)

1. **Pull-sync 30-day fixed window, no watermark** — late-backfilled older activities never pulled (`pullSync.ts:304`).
2. **No 429 handling anywhere in Strava client** — list 429 aborts the user's sync; detail 429 inserts the run without splits/route with no re-enrich marker (`pullSync.ts:185-216, 333-337`).
3. **Pagination skip hazard** under concurrent Strava-side deletes; `page > 20` cap silently truncates (`pullSync.ts:177-201`).
4. **`isRace` push option is a no-op** — `sport_type: opts.isRace ? 'Run' : 'Run'` (`push.ts:157`); no `workout_type=1` → a pushed race lands unflagged on Strava.
5. **Strava-sourced rows have no `durationSec`** → manual push of one builds a zero-duration TCX (`push.ts:118` vs `pullSync.ts:139-140`); push-recent filters them, the manual route doesn't.
6. **`strava_pushes` lacks UNIQUE(run_id)** (root of M-5's double row); `duplicate`-status runs are re-attempted forever by push-recent (`push-recent/route.ts:71-73`).
7. **Admin strava-webhook subscribe/unsubscribe is requireUserId-only** (any authed user can unsubscribe the app-wide webhook) + non-constant-time CRON_SECRET compares.
8. **`afterRunWrite` voided without `.catch`** on webhook + pullSync paths (`webhook/route.ts:493`, `pullSync.ts:460`) — unhandled rejection noise.
9. **Webhook deauth doesn't clear legacy `profile.strava_*`** → `hasStravaConnection` stays true via fallback (`auth.ts:48-55,143-147`; zero current callers).
10. **`health_samples` UNIQUE(user,type,date) collapses active_energy to 1 row/day** — **prod-confirmed** (1 row/day, 0.1–3.5 kcal slivers); tier-2 calorie resolution is dead code; the phone ships thousands of pointless upserts per sync (`ingest/health/route.ts:120-130`, importer comment claims a `recorded_at` key that isn't in the index).
11. **Cold launch double-fires the HK import** (`FaffApp.swift:24,44-90,146-153` — `lastImportAt` set after the task completes) → concurrent passes; PK protects data, phantom "failed" count, doubles absorber-race exposure.
12. **HK path uploads no raw HR series** → zone distribution for HK-only runs falls to the coarse render-time fallback.
13. **Gate-rejected miles inflate the synthetic tail split; elevation nets to END−START per mile** (undercounts rolling terrain) (`HealthKitImporter.swift:576-683, 731-733`).
14. **HKWorkoutRoute continuation can hang an import pass on mid-stream error; only `routes.first` read** (`HealthKitImporter.swift:503-515, 1675-1679`).
15. **Zero-distance HK workouts 400-rejected forever** (`ingest/workout/route.ts:59-61`) — a 0.0mi treadmill HKWorkout can never ingest (watch route handles this case; length-guard intends AND-semantics).
16. **WatchSync relay queue: lost-enqueue race between flush passes; flush only on activation/new-userInfo, not foreground; cap 50 drops OLDEST** (`WatchSync.swift:93-98,146-155,242-245`; same cap pattern watch-side `PhoneSync.swift:97-102`).
17. **`status`/`completedAt` from WatchCompletion never read into runs** — an abandoned 2mi bail renders as a completed session (`complete/route.ts`).
18. **HRAlerter** fires at 95% of ceiling while saying "above your ceiling", drains full HR history on first enable (nil anchor), no workout gate (`HRAlerter.swift:73-105`).
19. **Watch auth token in plain UserDefaults** (`PhoneSync.swift:79-82`) vs phone keychain.
20. **Treadmill takeover outranks an active outdoor run** (`WorkoutRootView.swift:134-139`).
21. **iPhone notifications inbox renders empty title/body** — reader expects `payload->aps->alert`, writer stores flat keys (`inbox/route.ts:32-33` vs `dispatch.ts:127-129`).
22. **Lock-screen ack never stamps the log** — `dedup_key` not in the APNs payload (`apns.ts:269-275`, `NotificationsAppDelegate.swift:103`); side-effect SQL works, audit fields stay null.
23. **Drain not concurrency-safe** (no FOR UPDATE SKIP LOCKED; read-then-act dedup) — double-send on overlapping invocations.
24. **Token registration fire-and-forget** (`API.swift:772-787` `_ = try?`), no foreground re-register (route comment claims otherwise).
25. **Pending rows >24h stop deduping new enqueues** → multi-push pile-up on cron recovery with APNs failing (`enqueue.ts:36-53`).
26. **Swallowed-catch inventory around writes:** `volume.ts:114` (DB error reads as 0 miles → cold-start plan path), `dedupe-runs/route.ts:44-49` (user list → default user only), `run-adaptations/route.ts:107`, `pullSync.ts:506-514` (sync-status stamp), `auto-rebuild.ts:153` (audit row), `silent-rebuild/route.ts:101`, `canonical.ts:223-237` (RPE TOCTOU — prod has the UNIQUE constraint, so bounded), ROLLBACK-without-`release(err)` idiom in adapt/restore/calibration/onboarding.
27. **`citation.ts:139` casts plan_workouts.id `::uuid`** — ids are `wko_…` text → `applyMutation` throws on every generator id (dead/broken mutation path).
28. **`run-adaptations` action↔trigger index pairing** can misalign multi-action triggers (`route.ts:82-90` vs `adapt.ts:183-186`).
29. **PATCH `/api/runs/[id]` date-only fallback updates EVERY unmerged run that day** (`route.ts:106-119`).
30. **Manual-run double-submit** creates two visible runs when the re-entry differs >0.05mi (`run/manual/route.ts:25` random clientId).
31. **Race DELETE is hard, no tombstone; active plan keeps pointing at the deleted slug by design** (`race/route.ts:288-316`).
32. **Dead/zombie surfaces:** `workout_completions` table (no consumers, writes stopped May 25), `briefings`/`coach_today_cache`/`coach_reads_cache` (retired May 28 — the refresh-briefings cron still pings a deprecated endpoint daily), `strava_sync_state` key (legacy single-tenant path), stale cron docs (`run-adaptations` header says 07:15 UTC, workflow moved to 03:00; `CRON_AUDIT.md` outdated; OPERATIONS.md "Railway cron" fiction).
33. **Splits semantics differ by lane:** watch rows carry segment-style splits (5.86mi→1 split; 12.55mi→11), HK rows carry mile splits (7.41→8) — consumers assuming mile splits cross-read; May 27/29 watch-canonical rows effectively have no usable splits; `splits_unreliable` flag absent on the Jun 7 row.

---

## ✅ VERIFIED OK (what held up under attack)

- **Watch→server wire contract is currently clean**: every encoded WatchCompletion field is read camelCase server-side (polyline camel-with-snake-fallback, elevGainFt camel); the iPhone relay preserves bytes and only splices `timezone`; no silent field drops beyond `status`/`completedAt` (MINOR-17).
- **Completion redundancy design**: dual-lane (relay queue + direct background URLSession with file-based uploads, durable queues, in-flight dedup, removed only on 2xx); WCSession activated in `didFinishLaunching` so background launches deliver; auto-send on engine-finish, not on Done.
- **Server idempotency on runs**: stable content-derived ids + PK (`strava_activities_pkey` on runs) + keyed deletes — double-POSTs cannot duplicate rows; cross-user collision pre-checks on all three write paths refuse loudly (P0-4/5).
- **Dedup/merge engine**: `pickCanonical`/`planMergeOps` pure + idempotent + cycle-breaking; nightly dedupe-runs really re-merges (14d window); read-side `volume.ts` re-clusters independently of flags. **Prod: merge graph fully clean** — 38 merged rows, 0 dangling, 0 chained, 0 self, 0 circular; 0 unmerged same-day duplicates in 60 days; 0 duplicate client_workout_ids; 0 NULL-user runs.
- **OAuth state HMAC-signed + timing-safe on connect and both callbacks**; token dual-write (connector_tokens + profile) consistent in prod; cron routes uniformly Bearer-gated, fail closed (503) when secret unset; watch/ingest/notification routes all requireUserId with no default-user fallback; `?user_id=` rejected.
- **Strava push pipeline**: pending-row-first design, terminal-state convergence, duplicate (409) handled at upload and resolve, merged-run guard skips dedup losers, TCX valid without GPS (treadmill OK), synthesized altitude avoids DEM spikes, GPS-track fix (78d7ec31) and close-loop poll (0f271d98) verified live in prod (Jun 9 push resolved with activity id). Auto-push confirmed OFF by default.
- **HK ingest hardening**: payload size a non-issue (~600-pt polyline, no raw series, few KB for a marathon); splits validated server-side with `splits_unreliable` stamping; elevation sanity + GPS-DEM fallback idempotent; weather failures isolated behind timeouts and never block the run write; `ingest/health` upsert is Rule-6-clean with manual-source protection; HK-metadata weather wins over Open-Meteo; Cluster 1b `mergedIntoId` preservation present at the HK write site.
- **Cron-as-Actions layer mechanics**: all 16 workflows green for 100 straight runs; schedules demonstrably firing from `main`; notifications drain proven live (queue depth 0 daily); telemetry bot commits daily.
- **APNs plumbing details**: 410 → token revoke wired; iOS category/action ids match server exactly; per-user timezone scheduling (incl. Sunday/UTC boundary) correct; registration route upsert + un-revoke correct. (The plumbing is fine — the host selection, scheduling window, and retry semantics around it are the problem.)
- **Race data prerequisites in prod**: AFC race row present (priority A, GPX + course geometry), active plan targets it, race-week plan rows exist (Aug 13 easy 3 / Aug 14 rest / Aug 15 shakeout 2 / Aug 16 race 13.1 with workout_spec), 4 fresh device tokens, phone sessions valid through Aug 29+.

---

## TASK LIST

### Pre-race blockers (fix + verify before Aug 16; ordered)

| # | Fix | Closes | Size |
|---|---|---|---|
| 1 | One end-to-end APNs test push to the physical phone; first check Railway `APNS_PRODUCTION` vs TestFlight signing; fix `docs/OPERATIONS.md:177` | RK-6 | config + 1-line doc |
| 2 | Add notification ticks covering 04:30–07:00 PT (e.g. `*/30 11-13 * * *` UTC) **and** implement quiet-hours in dispatch in the same change; add retry-instead-of-consume for `bypass_quiet_hours` categories (race-eve/race-day) | RK-5, M-21 | yml + ~30 lines |
| 3 | Wire `goalSec`, `gelsMi`, `strategyLabel`, `fueling` into `buildWatchToday` (race + long-run payloads); round `readinessScore` to Int or stop sending it | RK-1, M-13 | ~20 lines server |
| 4 | Fix watch `expiresAt` parse (`.withFractionalSeconds` formatter) + stale-workout UI + re-fetch fallback; make `workoutId` per-session (or guard completion against replacing a different-day run) | RK-2, M-10 | watch + server, needs TF build |
| 5 | Implement HKWorkoutSession recovery (`recoverActiveWorkoutSession` on watch launch, re-attach builder) | RK-3 | watch, needs TF build |
| 6 | Re-push watch context on scenePhase foreground (not just cold launch) + flush relay queue on foreground | RK-4, MINOR-16 | ~10 lines iOS |
| 7 | Guard `races.meta` upsert (`meta = races.meta \|\| EXCLUDED.meta` on both writers) | RK-7 | 2 SQL edits |
| 8 | Re-create/insert the Strava webhook subscription row (sub id was 347351); verify with a live event; add Layer-3 secret path while re-subscribing | M-1 | operational + small |
| 9 | `pool.on('error')` handler + `connectionTimeoutMillis` + statement timeout | M-20 | ~6 lines |
| 10 | Return non-200 (or retry semantics) from watch-complete when the runs write fails; preserve `shoe_id`/`provenance`/`mergedIntoId` across all three DELETE+INSERT upserts (convert to ON CONFLICT guarded merge) | M-9, M-16 | medium |
| 11 | Transaction around `clearActivePlansFor` + `persistPlan` (+ pass sealedSnapshot as param); unique partial index on active plans | M-19 | medium |
| 12 | Manual reconciliation: check Strava for May 31 (×2 uploads) + Jun 8 activities; delete the Strava-side dup if both processed; decide whether to re-push Jun 8 | M-5 | manual, 10 min |
| 13 | Race-morning runbook: cold-launch the iPhone app after waking (forces context push + HK import + token refresh), verify watch shows RACE before leaving; don't START anything after finishing | RK-2/4 interim | doc |
| 14 | Alert channel minimum viable: `raiseAlert` on APNs send failure + webhook rejection + cron body errors; surface `recentUnackedAlerts` somewhere read daily (or Slack webhook env + test it) | RK-0 | small-medium |

### Post-race / hardening queue

- Webhook replay cron for `pending`/`error` events (the schema already supports it) — M-2
- `needs_reauth` detection for `partial`/400 statuses + stamp `last_sync_at` on successful pull — M-3
- Persist rotated refresh token before first use; advisory lock around refresh — M-4
- `autoMergeForDate` after webhook activity-delete; widen dedupe cron window or add full-history sweep — M-6
- Unify cadence×2 + elevation sanitization across webhook/pull ingest paths — M-7
- Relay-lane payload: round/downsample samples below 65KB or chunk; implement `session(_:didFinish:error:)` logging; splice timezone on the direct lane (watch sends `TimeZone.current.identifier`) — M-8, M-18
- Scoped-patch rewrite of `canonical.ts` absorber + `pullSync` enhancer writes — M-17
- HKObserverQuery + `enableBackgroundDelivery` + anchored watermark for workout ingest; widen foreground window to match launch (7d) — M-14
- Weather cron: include polyline-only rows; stop stamping `weather_enriched_at` on failure (or add a retry-N marker) — M-15
- Keychain accessibility → `AfterFirstUnlock`; don't clear session on background 401; watch token via keychain — M-11, MINOR-19
- Session refresh-on-use (sliding TTL) — M-12
- `health_samples` active_energy: per-bucket key or daily-sum semantics; stop shipping thousands of no-op upserts — MINOR-10
- Notifications: row locking in drain, retry counter + backoff, inbox payload shape fix, dedup_key into APNs payload — M-21, MINOR-21/22/23
- Pin/document the GH-Actions-on-main dependency + dead-man check (workflow that alerts if drain hasn't run in 2h) — M-22, RK-0
- Delete zombie surfaces: refresh-briefings workflow, `workout_completions` table decision, `strava_sync_state` legacy key, stale cron docs — MINOR-32
- UNIQUE(run_id, status='pending'-ish) guard on `strava_pushes`; stop re-pushing `duplicate` rows; wire `workout_type=1` for races — MINOR-4/6
- Investigate Jun 7: no HK twin + GPS-less watch row (watch-side workout persistence?) — M-14 open question
- Treadmill `trd_*` lost completions: confirm test-vs-real; if real, the 200-ack fix covers the class — M-9

### Standing checks (cheap, run weekly until race)

- `SELECT count(*) FROM strava_webhook_events WHERE received_at > now()-interval '7 days'` — webhook liveness once M-1 lands (expect >0 weekly; David's own pushes echo back).
- `SELECT status, count(*) FROM strava_pushes GROUP BY 1` — no stuck `pending` >24h.
- `SELECT delivered, count(*) FROM notifications_log WHERE fired_at > now()-interval '7 days' GROUP BY 1` — delivered=true must appear after fix #1.
- `SELECT max(data->>'date') FROM runs WHERE data->>'source'='apple_watch'` — HK twin lag ≤2 days.
- Sessions expiring within 21 days → re-auth proactively, never inside race week.

---

*Full agent traces (file:line for every claim) preserved in the session transcript. DB queries used are reproducible read-only via `DATABASE_URL_RO`. No fixes were applied as part of this audit.*
