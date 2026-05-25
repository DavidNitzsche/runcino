# Coach Pulse · Data Staleness Audit (Wave H)

Read-only sweep of every data source the app reads and every surface that renders it. Goal: tell the user when the "always-watching coach" is actually looking at fresh data vs cached, and what surfaces silently render stale numbers.

Audit scope: branch `claude/build-faff-app-OIRJr` at `/Volumes/WP/06 Claude Code/Runcino`. Not committed.

Today: 2026-05-12.

---

## TL;DR

**The coach is not "always watching." It's looking at a 15-minute snapshot of Strava, a check-in table that is not wired into CoachState, and zero HealthKit signal. Nothing on the app surfaces a freshness timestamp.** Two specific bugs surfaced during the audit (live, breaking signals — not opinions):

1. `state.checkin` is referenced by `/api/overview` and `/api/training` but is never populated by `gatherCoachState()` — the field is not declared on `CoachState` and `gatherCheckinAggregate()` is never called. Every coach decision computes against `undefined`.
2. The Strava activity cache only refreshes on read AND only via the `/overview`, `/profile`, `/log` API routes (which call `getCachedActivities`). The `autoSyncStrava()` client trigger is wired ONLY on `/races/[slug]` — visiting `/overview`, `/training`, `/health`, `/profile`, `/log`, `/races` never POSTs to `/api/strava/sync`. The cache TTL is read-triggered, not proactively refreshed.

---

## Section 1 · Per-table freshness

Tables defined in `web/lib/db.ts` (`bootstrap()`):

| Table | Last-updated column | Last-write event | Read by | Cadence expected | Read of `updated_at` anywhere? |
|---|---|---|---|---|---|
| `races` | `saved_at TIMESTAMPTZ` | INSERT/UPDATE in `setRaceDB`, `setActualResultDB`, sync writes | `/api/overview`, `/api/training`, `/api/profile`, `/api/health`, `/api/log`, `/api/races`, `coach-state.ts` | event-driven (when a race is added or finished) | `saved_at` is selected by `listRacesDB`/`getRaceDB` but never displayed |
| `strava_activities` | `fetched_at TIMESTAMPTZ` summary, `detail_at TIMESTAMPTZ` per-activity detail | `refreshActivities()` upserts every row; per-activity detail filled on demand by `/api/strava/bests`, `/api/strava/sync` | every Coach-state consumer (transitively) via `getCachedActivities()` | every run (≤24h after the run lands on Strava) | `fetched_at` is read inside `getCachedActivities` to decide TTL but never returned to a UI surface |
| `strava_sync_state` (key='activities_sync') | `updated_at`, value contains `lastFetchedAt` | `setSyncState({lastFetchedAt})` after every successful `refreshActivities` | `getSyncState` (server only) | every 15 min on read | `getCacheFetchedAt()` exists but only `/api/strava/sync` calls it; UI never displays |
| `shoes` | `created_at` only — **no `updated_at`** | `createShoe`, `updateShoe`, increment on shoe-tagged activity | `/api/profile`, `/api/shoes` | event-driven | none |
| `recovery_sessions` | `created_at`, `done_at` (per row done timestamp) | `createSession`, `markDone` | `/api/recovery`, `/api/profile` | event-driven (per run/race) | `done_at` is rendered as the "checked off" pin |
| `personal_goals` | `created_at`, `updated_at` | `createGoal`, `updateGoal` | `/api/goals`, `/api/profile` | event-driven | `updated_at` selected but only used for ordering |
| `daily_checkin` | `logged_at TIMESTAMPTZ` (one row per user+date, UNIQUE) | `POST /api/health/checkin` writes with `logged_at = NOW()` on conflict | `/api/health` (direct query), `/api/overview` & `/api/training` (via `state.checkin?.poorDaysCount` — **field never populated, see Bug #1**) | daily | `logged_at` read in `/api/health` for the "logged at 7:42 AM" chip; nowhere else |
| `profile` | `updated_at` | `upsertProfile` | `/api/profile` | event-driven (rare) | `updated_at` not selected |
| `user_prefs` | `updated_at` | `upsertUserPrefs` | `/api/profile` | event-driven (rare) | `updated_at` not selected |

**Schema note:** every mutable row in the DB has `updated_at` or equivalent. The app reads the columns only inside store helpers; it does not surface any freshness signal to the UI.

---

## Section 2 · Per-surface freshness map

Status legend:
- **FRESH** — recomputed per request from the source of truth, no cache layer in between
- **STALE-OK** — cached but with a sensible TTL, refresh-on-read covers it
- **STALE-BAD** — reads cached data with no refresh trigger or no user-visible freshness signal
- **NO DATA YET** — the source pipe is not built; surface renders an explicit empty state

Routes are server-side; all client `fetch()` calls use `cache: 'no-store'` so there is no Next.js or browser-cache layer.

### /overview

| Surface | Source | Last refreshed | Budget | Status |
|---|---|---|---|---|
| Today Card (workout prescription) | `coach.prescribeWorkout(state)` recomputed per GET `/api/overview` | per request | none | FRESH |
| TodayCard pin / "why" (adjustForReality) | `coach.adjustForReality(workout, signals)` per request — but `checkinPoorDaysLast7d: state.checkin?.poorDaysCount` reads `undefined` (Bug #1) | per request, **broken input** | none | STALE-BAD (silently degraded) |
| Readiness | `coach.assessReadiness(state)` per request | per request | none | FRESH |
| Body Systems | `coach.bodySystems(state)` per request | per request | none | FRESH |
| Trajectory 14wk | `coach.trajectory14wk(state)` per request | per request | none | FRESH |
| Race-fitness A/B | `coach.raceFitnessPrediction` per request | per request | none | FRESH |
| Week Deltas / Plan Adapted | `coach.weekDeltas` + `coach.recentAdjustments` per request | per request | none | FRESH |
| Weekly Miles strip | `weeklyMiles(runs)` from Strava cache | Strava-cache age (≤15 min when read on overview load) | per run | STALE-OK |
| Long-Run strip | runs from Strava cache | same | per run | STALE-OK |
| VDOT tile | `vdotSnapshot(state)` — anchored on the most recent canonical race finish | bound by Strava cache + race-row update | weekly cadence, or every race | STALE-OK (data is intrinsically infrequent) |
| Pace zones | derived from VDOT | same | weekly | STALE-OK |
| ACWR / Load gauge | `state.volume.last7Mi / weeklyAvg8w` from Strava cache | Strava-cache age | per run | STALE-OK |
| Year Heatmap / Monthly / PRs / YTD | Strava cache | per run | per run | STALE-OK |
| HRV / RHR / Sleep cards (Biometrics) | `getBiometricsSnapshot()` returns `null` unconditionally | never | n/a (HealthKit M2) | NO DATA YET |
| Profile greeting | hardcoded "Runner", local time-of-day | per request | n/a | FRESH (but trivial) |

### /training

| Surface | Source | Last refreshed | Budget | Status |
|---|---|---|---|---|
| Today / Readiness / WeekDeltas / Trajectory / ProofSessions | Coach methods per request | per request | none | FRESH |
| `adjustForReality` (broken via same Bug #1) | per request, undefined input | broken | none | STALE-BAD |
| RaceFitness A | per request | per request | none | FRESH |
| HR-zones 14-day distribution (`buildHrZones`) | **synthesized pattern in route**; `easyShare` from state, daily mix is mock | per request but content is mock | per run | STALE-BAD (looks live, isn't) |

### /profile

| Surface | Source | Last refreshed | Budget | Status |
|---|---|---|---|---|
| Identity hero (name/age/city/lifetime stats) | `profile` table + Strava cache | profile event-driven; activities ≤15 min | event-driven | STALE-OK |
| Lifetime PRs | `naivePRs(runs)` from Strava cache | Strava-cache age | per run | STALE-OK |
| Personal Goals | `personal_goals` rows | event-driven | event-driven | FRESH (event-driven) |
| VDOT card | derived from state | bound to race-row + Strava | weekly | STALE-OK |
| HR block (HRmax estimate) | profile table | event-driven | rare | FRESH |
| Mileage Tier | state.volume | Strava-cache age | per run | STALE-OK |
| Training Prefs | `user_prefs` table (or default fallback) | event-driven | rare | FRESH |
| Shoes | `shoes` table | event-driven | per shoe-tagged run | FRESH |
| Connections (Strava activity count, HealthKit, Garmin) | activity-count from cache; HealthKit hard-coded "SOON" | cache age | per run | STALE-OK / NO DATA YET (HealthKit, Garmin) |
| Engine details (pace zones, easy share, recovery cadence) | state-derived | Strava-cache age | weekly | STALE-OK |
| Plan integrity ("12 of 12 pass") | **hard-coded 12/12** in `buildEngineBlock` | never | n/a | STALE-BAD (mock pretending to be live) |

### /health

| Surface | Source | Last refreshed | Budget | Status |
|---|---|---|---|---|
| Body Systems centerpiece | `coach.bodySystems(state)` per request | per request | none | FRESH |
| Readiness composite | `coach.assessReadiness(state)` per request | per request | none | FRESH |
| Form / CTL / ATL / TSB | `buildTrainingStress(state.volume)` per request | Strava-cache age | per run | STALE-OK (derived) |
| HR-zones daily mix | `buildHrZones` — easyShare from state, **per-day mix is empty/zero stub** | per request | per run | NO DATA YET (per docstring TODO) |
| HRV detail | `stubHrvDetail` — isAvailable:false | never | n/a (HealthKit M2) | NO DATA YET |
| Sleep, VO2max, RHR, Respiratory rate, Body temp | all `stub*()` — isAvailable:false | never | n/a (HealthKit M2) | NO DATA YET |
| Illness composite (5 markers) | stub — isAvailable:false | never | n/a | NO DATA YET |
| Body mass trend | stub — isAvailable:false | never | n/a | NO DATA YET |
| Submax HR drift | stub — isAvailable:false (needs HR streams) | never | n/a | NO DATA YET |
| Cycle / Ferritin (female users) | stub — isAvailable:false | never | n/a | NO DATA YET |
| Expanded daily check-in | `readExpandedCheckin(today)` — direct query against `daily_checkin` for TODAY's row | per request | daily | FRESH |
| Subjective-vs-objective agreement | derived from check-in + readiness | per request | daily | FRESH |
| Mood check-in banner | `stubMoodCheckin` — always null | never | n/a | NO DATA YET |
| Profile sex/age band | `stubProfile` — hard-coded "male/M 38" | never | n/a | STALE-BAD (literal hard-code) |

### /races

| Surface | Source | Last refreshed | Budget | Status |
|---|---|---|---|---|
| Upcoming race calendar | `races` table | event-driven (save) | event-driven | FRESH |
| Past race results | `races.actual_result` filled by `/api/strava/sync` matcher | only when `/races/[slug]` loads (autoSyncStrava is only there) | per race | STALE-BAD (sync only triggered on per-race deep-link; landing on `/races` does not refresh actuals) |
| Season timeline | derived from races table | event-driven | event-driven | FRESH |

### /log

| Surface | Source | Last refreshed | Budget | Status |
|---|---|---|---|---|
| Recent activities list | Strava cache | Strava-cache age | per run | STALE-OK |
| Daily log entries / notes | not persisted (no `daily_log` table exists) | — | n/a | NO DATA YET |

---

## Section 3 · Stale-detection wishlist (what the coach can't see)

Signals the engine should have but doesn't:

1. **"Days since last check-in"** — the user might not have logged subjective data in 4 days; the coach has no concept of this gap because `state.checkin` is not populated. Even if it were, `loggedToday` is the only freshness flag — no "days since latest" signal.
2. **"Days since last Strava sync succeeded"** — the engine reads cached activities but never asks "is this data more than a day old?" If Strava auth dies, the coach silently coaches against a 3-week-old picture. There's no health-check on the Strava token.
3. **"Hours since the activity cache was refreshed"** — `getCacheFetchedAt()` exists but never bubbles into any surface. No "Strava synced 2h ago" footnote on Today's card.
4. **"Time since profile / prefs were updated"** — every recommendation depends on prefs (long-run day, quality days, rest day). If prefs are 18 months stale, coach has no signal.
5. **"Is HealthKit connected at all?"** — `state.flags.healthKitAvailable` is hard-coded `false`. The coach knows HealthKit isn't there but doesn't degrade gracefully or surface "I'd coach you better with HRV — connect Apple Health."
6. **"Has the user run today yet?"** — `state.recovery.today` exists but only via Strava cache; if today's run was 30 min ago, it might not be on Strava yet, and the coach will tell the runner to "go run" when they already did. There's no Apple Watch live-feed.
7. **"Did the last check-in disagree with wearable?"** — Health page computes `subjectiveAgreement` but coach engine doesn't read it for `adjustForReality`. Coach can't say "you said you feel bad — I'm pulling back."
8. **"How stale is the VDOT anchor race?"** — `vdotSnapshot` includes `daysAgo` for the source race but engine does not down-weight or warn when the anchor is >90 days old. A 6-month-old half marathon still drives today's pace zones with full confidence.
9. **"Recovery session marked done but on what date?"** — `recovery_sessions.done_at` exists but isn't fed into state to detect "user logged a recovery session 5 days in a row." Pattern detection missing.
10. **"Goal staleness"** — `personal_goals.updated_at` exists, never read by engine. The coach doesn't say "we set this goal 3 months ago — still right?"

---

## Section 4 · Recommendations

Prioritized by "how badly does this break the alive-coach feel."

### P0 · Fix the silent breakage

1. **Wire `state.checkin` into `CoachState`.** Three steps:
   - Add `checkin: CheckinAggregate | null` to the `CoachState` interface in `web/lib/coach-state.ts`.
   - Call `gatherCheckinAggregate(todayISO)` in `gatherCoachState()` and attach.
   - Confirm `/api/overview` and `/api/training` `adjustForReality` calls now see a real `poorDaysCount`.
   *Without this, every reference to `state.checkin?.poorDaysCount` evaluates to `undefined`. Today the coach makes "I see your check-ins are steady" decisions on no data.*

2. **Add a server-side proactive Strava refresh.** Right now `getCachedActivities` refreshes only when called. Wire either:
   - a tiny `useEffect`-mounted client trigger that POSTs `/api/strava/sync` on `/overview`, `/training`, `/health` mount (5-min throttle, same as `autoSyncStrava`), OR
   - a Railway cron job hitting `/api/strava/sync` every 15 min.
   *Today, if the user lands on `/overview` first, they get whatever the activity cache last decided — and `/overview` API doesn't trigger the race-result matcher, so a race finished today won't show as completed.*

### P1 · Surface freshness to the user

3. **Add a "Coach Pulse" badge to every page header.** Show "Last synced 2m ago · Strava ✓ · Apple Health —" so the runner knows the coach's data picture is current. Pull from `getCacheFetchedAt()` and HealthKit `state.flags.healthKitAvailable`.

4. **On `/overview` Today's card, render "Pulled from N runs · last run NDh ago · check-in logged today"** so the coach's "alive" feel has visible roots.

5. **On `/races`, trigger `/api/strava/sync` on page mount** (not just on per-race deep-link). Otherwise the runner finishes a race, opens `/races`, and sees yesterday's data.

### P2 · Replace hard-coded mocks that look live

6. **Plan integrity "12 of 12 pass"** in `/api/profile` `buildEngineBlock` is a literal — wire to a real rule run or remove the card.
7. **HR-zones daily mix in `/api/training` `buildHrZones`** is a 14-day synthesized pattern — surface NO DATA YET until the HR-stream rollup ships (already TODO'd).
8. **`stubProfile` sex/age** in `/api/health` is literally `'male' / 'M 38'` — read from the `profile` table or surface NO DATA YET.

### P3 · Stale-detection signals the engine doesn't have

9. **Add `freshness` block to CoachState** containing `stravaSyncAgeMin`, `checkinLatestDaysAgo`, `vdotAnchorDaysAgo`, `prefsAgeDays`. Let the engine read these to prompt: "Your check-in is 4 days old — give me an update" / "Your VDOT anchor race is 5 months old — log a recent benchmark."
10. **Surface degraded state explicitly.** When HealthKit isn't connected, the body-systems card should say so once at the top of `/health` ("connect Apple Health to unlock HRV / sleep / illness signals") rather than 5 separate NO DATA YET tiles.

---

## Appendix · Source inventory (file paths)

Tables: `web/lib/db.ts` lines 70–204.

Strava pipeline:
- `web/lib/strava.ts` (OAuth, fetchActivities, fetchActivityDetail)
- `web/lib/strava-cache.ts` (Postgres-backed 15-min TTL)
- `web/lib/strava-auto.ts` (client trigger, only used on `/races/[slug]`)
- `web/app/api/strava/sync/route.ts` (race matcher + actualResult writer)

Check-in pipeline:
- `web/lib/checkin-aggregate.ts` (defined, **not wired into CoachState**)
- `web/app/api/health/checkin/route.ts` (POST writer)
- `web/app/api/health/route.ts` line 814 `readExpandedCheckin` (direct read)

Coach state:
- `web/lib/coach-state.ts` (gatherCoachState — does NOT call gatherCheckinAggregate)

API routes (all `cache: 'no-store'` on the client side, no Next.js cache layer):
- `/api/overview`, `/api/training`, `/api/profile`, `/api/health`, `/api/log`, `/api/races-page`, `/api/strava/sync`, `/api/strava/activities`, `/api/strava/bests`

Data files:
- `web/app/overview/data.ts`, `web/app/training/data.ts`, `web/app/profile/data.ts`, `web/app/health/data.ts`, `web/app/log/data.ts`, `web/app/races/data.ts`
