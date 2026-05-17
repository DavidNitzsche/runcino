# D3 — Sync & Integration Architecture

**Scope:** personal-use running app, one user (or small private cohort), modest data volume (one Apple Watch primary + 0–4 secondary services). Architecture optimized for correctness and clarity, not industrial throughput.

**Tech context (assumed):** Swift/SwiftUI iOS + watchOS apps; Next.js web; Postgres backend (Supabase or similar); Node/Edge functions for webhooks. Choices below assume that stack but generalize.

---

## 1. Source-of-Truth Hierarchy

For each data type, we define a deterministic priority order. The first source that has a fresh, non-null reading wins. The user can override per data type in Settings.

### 1.1 Activities (a recorded workout)

| Rank | Source | Reason |
|------|--------|--------|
| 1 | **Native faff.run watch app** (own `HKWorkout` save) | Highest fidelity — we control the metric set, splits, intervals, planned-vs-actual mapping, and we own the `externalId`. |
| 2 | **Apple Watch built-in Workout app** (via HealthKit) | Same hardware, same GPS/HR pipeline; lacks our structured-interval metadata but has `HKWorkoutRoute`. |
| 3 | **Garmin / Coros native device** (via Garmin Connect / Coros Open API push) | Often higher-fidelity GPS chip, dual-frequency, optical-HR or chest strap. Use when the runner used a Garmin/Coros instead of the Watch. |
| 4 | **Stryd** (delivered via HealthKit BLE bridge or Garmin) | Power data only; treated as an *enrichment* layer, not a separate activity. |
| 5 | **Strava** (via webhook) | Used only if the activity originated *outside* HealthKit (treadmill, manual log, Zwift). Strava is downstream of the watch in our pipeline, not upstream. |
| 6 | **Manual entry** | Lowest fidelity; user fills gaps. |

**Justification:** the Watch is the user's primary device. Anything else is a fallback for rides/treadmill/non-Watch sessions. Strava is treated as a *distribution channel* that we write to, not as a primary read source — except when it is the only place a workout exists.

### 1.2 Heart Rate Variability (HRV / rMSSD or SDNN)

| Rank | Source | Notes |
|------|--------|-------|
| 1 | **Oura** | Highest measured agreement with ECG (CCC ≈ 0.99 in 2025 nocturnal study); finger PPG > wrist PPG; uses rMSSD averaged across the night. |
| 2 | **Whoop** | Strong agreement (CCC ≈ 0.94); uses last slow-wave-sleep sample. Different sampling window than Oura. |
| 3 | **Apple Watch (via HealthKit)** | SDNN, taken sporadically; not directly comparable to rMSSD. Use only if no ring is connected. |
| 4 | **Garmin** | Lower nocturnal accuracy in independent testing; acceptable when nothing else available. |

**Comparability gotcha:** SDNN (Apple) and rMSSD (Oura/Whoop) measure different things. Store both with the metric type tagged; never mix them in the same trend line. The recovery model uses **one source per user**, picked by hierarchy.

### 1.3 Resting Heart Rate (RHR)

| Rank | Source | Notes |
|------|--------|-------|
| 1 | **Oura** | Continuous nocturnal sampling; lowest noise. |
| 2 | **Whoop** | Continuous nocturnal sampling; comparable. |
| 3 | **Garmin** | 24h minimum or sleep-window average. |
| 4 | **Apple Watch (HealthKit RHR)** | Daily aggregate computed by Apple; reasonable but coarsest. |

### 1.4 Sleep (duration, stages, score)

| Rank | Source | Notes |
|------|--------|-------|
| 1 | **Oura** | Best stage classification in the consumer field. |
| 2 | **Whoop** | Strong sleep architecture; duration agrees with PSG well. |
| 3 | **Apple Watch** (Sleep app) | Decent duration; stages are weaker. |
| 4 | **Garmin** | Use only if it's the only worn device overnight. |

### 1.5 Body composition (weight, body fat %)

| Rank | Source | Notes |
|------|--------|-------|
| 1 | **Smart scale via HealthKit** (Withings/Renpho) | Highest cadence, most consistent. |
| 2 | **Manual entry in Health app** | Fine for weekly checks. |
| 3 | **Manual entry in faff.run** | Last resort. |

### 1.6 VO2max

| Rank | Source | Notes |
|------|--------|-------|
| 1 | **Apple Watch (HealthKit `vo2Max`)** | Calibrated against outdoor runs with HR + GPS. |
| 2 | **Garmin** | Different model; trend it separately, do not blend. |

### 1.7 Power (running)

| Rank | Source | Notes |
|------|--------|-------|
| 1 | **Stryd** (via HealthKit if present, else Garmin Activity API) | Native foot-pod, the gold standard for run power. |
| 2 | **Apple Watch native running power** (HealthKit `runningPower`) | Watch-derived; serviceable when no Stryd. |
| 3 | **Garmin native running power** | Use if user is on Garmin without Stryd. |

**Settings UI:** for each metric class above, expose a "Primary source" picker pre-filled with the recommended default. A user with Whoop only can promote Whoop to rank 1; a user without Oura sees Whoop at the top automatically.

---

## 2. Deduplication Strategy

Activities arrive from multiple pipes (HealthKit observer, Strava webhook, Garmin push, manual entry). The job: collapse them into one canonical `Activity` row per real-world event.

### 2.1 Match keys (in order of strength)

1. **Same `externalId` from same service** → exact duplicate. Drop.
2. **Same `HKWorkout` UUID** seen twice → exact duplicate. Drop.
3. **Cross-service fuzzy match** — apply the rules below.

### 2.2 Fuzzy match thresholds

Two records `A` and `B` from different sources match the same activity if **all** of these hold:

| Dimension | Threshold |
|-----------|-----------|
| Start-time delta | `|A.startedAt − B.startedAt| ≤ 90 s` |
| Duration delta | `|A.duration − B.duration| / max ≤ 5%` (and absolute ≤ 60 s) |
| Distance delta | `|A.distance − B.distance| / max ≤ 10%` (and absolute ≤ 100 m) |
| Activity type | Compatible (run↔run, walk↔walk; run↔walk allowed if both <2 km) |

If only **two of three** numeric dimensions agree (e.g. distance differs because one source missed GPS while paused), **flag for user review** rather than auto-dedup.

### 2.3 Edge cases

- **Treadmill / no-GPS run** → distance check skipped; rely on time + duration + type.
- **Activity split mid-run by a paused-too-long auto-stop** → the watch produces 2 short workouts; the GPS chip on a Garmin produces 1. If two workouts from the same source share a 5-min gap and durations sum to a single workout from another source, they match.
- **Multi-device session** (Watch on wrist, Garmin in pocket, Stryd on shoe) → all three should fold into a single canonical activity. Watch is canonical; Stryd power and Garmin GPS become *enrichments* attached via `Activity.enrichments[]`.
- **Strava manual upload after the fact** (e.g. uploaded a `.fit` file 3 days late) → time-based fuzzy match still works because we always compare on `startedAt`, not ingest time.

### 2.4 Algorithm

```
function reconcile(incoming) {
  // 1. exact id hit
  let exact = activities.find(a => a.externalIds[incoming.source] === incoming.id);
  if (exact) return mergeEnrichment(exact, incoming);

  // 2. fuzzy time bucket: pull all activities within ±10 min
  let bucket = activities.where(a =>
    abs(a.startedAt - incoming.startedAt) <= 10 * 60);

  // 3. score each candidate
  let best = bucket.map(score).maxBy(s => s.score);

  if (best.score >= MATCH_THRESHOLD) {
    return mergeEnrichment(best.activity, incoming);
  }
  if (best.score >= REVIEW_THRESHOLD) {
    queueForReview(incoming, best.activity);
    return null;
  }
  return createNewActivity(incoming);
}
```

`mergeEnrichment` does **not** overwrite the canonical record; it appends `externalIds[source] = id` and copies any *missing* fields the source provides (e.g. fills in `polyline` from Strava if the watch didn't save a route).

---

## 3. Conflict Resolution

When two sources disagree on the **same field** of the same activity (e.g. distance per the Watch = 10.21 km, distance per Strava re-snapped to roads = 10.18 km), apply this policy:

| Field | Policy | Reason |
|-------|--------|--------|
| `startedAt`, `endedAt`, `duration` | Highest-rank activity source wins | Time is owned by whichever device started the session. |
| `distance` | Highest-rank source wins; show secondary in detail view | GPS algorithms differ; we want one consistent number for plan adherence. |
| `route polyline` | Whichever source supplied a non-null polyline first; if both, prefer the one with more samples | Strava's snap-to-road can be helpful but distorts pace splits. |
| `avg HR`, `max HR` | Highest-rank source for *that activity*'s recording device | Don't mix wrist-HR with chest-strap mid-graph. |
| `power` | Stryd > Watch native > Garmin native | Foot pod is the only true measurement. |
| `cadence` | Same as activity rank | Trivial agreement across sources usually. |
| `description`, `name`, `tags` | **Last-writer-wins**, but faff.run's name template overrides if user hasn't typed a custom name | UX-side metadata. |
| HRV nightly | Hierarchy in §1.2; do not blend | rMSSD ≠ SDNN. |
| RHR | Hierarchy in §1.3 | Same reason. |
| Body weight | Most recent measurement, regardless of source | Time-series, not a snapshot. |

**Auto vs. prompt:**
- **Auto-resolve** if the policy table above has an unambiguous winner.
- **Prompt the user** only when (a) two sources are within the same priority tier (e.g. user has Whoop *and* Oura, both rank 2/1 for HRV) and the difference exceeds a noise threshold (>15% rMSSD delta between two devices on the same night), or (b) fuzzy-match queue produced a "review" candidate (§2.3).

The user-set primary trumps auto. Settings has a single "Primary source" picker per data type; we persist that and short-circuit the policy table.

---

## 4. Sync Flows

### 4.1 Plan flow (web → backend → phone → watch)

```
Web (user edits plan)
   │ POST /plan/{id}/days
   ▼
Backend (Postgres: PlanDay rows)
   │ Realtime channel push (Supabase) OR APNs background push
   ▼
iPhone (faff.run app)
   │ - Stores PlanDay locally (Core Data / SwiftData)
   │ - Computes "today" + "next 24h" workout
   │ - WCSession.updateApplicationContext(todayWorkout)
   ▼
Apple Watch
   │ Receives latest planned workout in app context
   │ - SwiftData mirror updated
   │ - Complication timeline reload requested
```

**Notes:**
- `updateApplicationContext` because we only need the *latest* state, not a queue.
- Payload is a stripped-down `WorkoutBlueprint` (intervals, target zones, metadata) ≤ 8 KB. Stay well under Apple's ~64 KB practical ceiling for `applicationContext`.
- If the watch is unreachable (off wrist, not paired), the iPhone retries on next `WCSession` reachability change. No manual action needed.
- For multi-day plan changes, send a digest blob (next 7 days) rather than 7 separate messages.

### 4.2 Activity flow (watch → HealthKit → phone → backend → web → Strava/Garmin)

```
Apple Watch (faff.run workout running)
   │ HKLiveWorkoutBuilder collects samples
   │ Workout ends → builder.finishWorkout() → HKWorkout saved to HealthKit
   ▼
HealthKit (on watch, syncs to phone automatically via iOS)
   │
   ▼
iPhone (faff.run app, woken via HKObserverQuery + background delivery)
   │ HKAnchoredObjectQuery using persisted anchor → only new/changed samples
   │ Reads HKWorkout + HKWorkoutRoute + samples (HR, power, cadence, splits)
   │ POST /activities (multipart: workout JSON + route geojson + raw samples blob)
   ▼
Backend
   │ - Reconcile (§2)
   │ - Enrich: planned-vs-actual diff, splits, zones, training load
   │ - Persist (Postgres + S3 for raw blob)
   │ - Fan-out:
   │     • Realtime push to web (Supabase channel)
   │     • If Strava connected & Settings.pushToStrava → POST /uploads with FIT
   │     • If Garmin connected & Settings.pushPlannedToGarmin → Training API
   ▼
Web (faff.run dashboard)  +  Strava activity feed  +  Garmin Connect
```

**Watch → Phone choice point.** We rely on iOS's native HealthKit-across-devices sync (no `WCSession` payload for the workout body). This is critical: the workout sample can carry tens of thousands of HR/route points, far over WatchConnectivity's practical payload limit. We *do* fire a small `sendMessage` "I just saved a workout, wake up the phone observer" signal to shorten observer latency from ~15 min to a few seconds.

### 4.3 Biometric flow (wearable → backend)

Two patterns coexist:

**Pattern A — HealthKit-native sources (Apple Watch, Withings scale, etc.):**

```
Wearable → HealthKit (phone)
   ▼
faff.run iPhone app (HKObserverQuery + background delivery)
   ▼
Anchored query pulls deltas → POST /metrics (batched)
   ▼
Backend stores HealthMetric{type, value, source='healthkit:apple_watch', recordedAt}
```

**Pattern B — Cloud-native sources (Whoop, Oura, Garmin, Coros):**

```
Wearable → Vendor cloud
   ▼
Vendor webhook → Backend /webhooks/{vendor}
   ▼
Backend fetches the actual metric body using stored OAuth token
   ▼
Backend stores HealthMetric{type, value, source='whoop', recordedAt}
```

Pattern B is preferred where available because it doesn't require the phone to be online. Pattern A is the fallback. Some sources (Oura, Whoop) appear in both because their iOS app *also* writes to HealthKit; we pick whichever arrives first by `recordedAt` and dedupe by `(type, recordedAt±1min, value±2%)`.

---

## 5. Per-Service Integration Spec

### 5.1 Apple HealthKit

| Aspect | Detail |
|--------|--------|
| Auth | iOS HealthKit permissions sheet; per-type read/write toggles. |
| Required types | `HKWorkout`, `HKWorkoutRoute`, HR, RHR, HRV (SDNN), VO2max, body mass, sleep analysis, running power, running speed, distance, energy. |
| Background | `enableBackgroundDelivery(for:frequency:)` per type + `HKObserverQuery` + `HKAnchoredObjectQuery`. |
| Delta sync | Persist `HKQueryAnchor` per type (UserDefaults or Keychain). On wake, run anchored query with last anchor → only new/deleted samples. |
| Latency | Workouts: typically <1 min from save to observer fire. Sleep / readiness analysis Apple writes overnight: appears 7–10am the next day. |
| Write capability | Yes — we write our own `HKWorkout` from the Watch native session. We do **not** write biometrics back. |
| Cost | Free. |
| Gotchas | `HKWorkoutRoute` requires its own auth; route samples come back in batches via `HKWorkoutRouteQuery` — don't load all in memory. The user can revoke any single permission at any time without telling us; always degrade gracefully. |

### 5.2 Strava

| Aspect | Detail |
|--------|--------|
| API | v3, REST. |
| Auth | OAuth 2.0; scopes `read,activity:read_all,activity:write,profile:read_all`. |
| Webhook | One subscription per app; Strava POSTs `aspect_type` (create/update/delete) + `object_id`. Webhook events do **not** count against rate limits. |
| Rate limits | 100 non-upload reads / 15 min, 1,000 / day. Overall (incl. uploads) 200 / 15 min, 2,000 / day. Buckets reset at :00, :15, :30, :45. |
| Read | `/activities/{id}` after webhook fires. Use `external_id` filter to skip our own re-uploaded activities. |
| Write | `POST /uploads` with multipart FIT/TCX/GPX + `name`, `description`, `trainer`, `commute`, `external_id`. Returns an upload ID; poll `/uploads/{id}` until processed. |
| Limitations | API does **not** allow gear assignment on upload (must be done in Strava UI). New (Nov 2024) agreement forbids ML/AI training on Strava data and forbids displaying another athlete's data outside Strava. |
| Latency | Webhook fires within seconds of save. |
| Cost | Free for Single-Player Mode (1 athlete = the developer). For >1 athlete you must apply. Personal-use faff.run fits Single-Player Mode by design. |
| De-dup with our pipeline | Set `external_id = "faff:{ourActivityId}"` on every upload. On webhook, if the incoming activity's `external_id` starts with `faff:`, ignore — we already know about it. |

### 5.3 Garmin

| Aspect | Detail |
|--------|--------|
| Programs | Connect Developer Program → **Activity API** (workouts in) + **Training API** (workouts out) + **Health API** (biometrics in) + **Courses API**. |
| Auth | OAuth 2.0 (PKCE) — currently migrating from OAuth 1.0; OAuth 1.0 retires 2026-12-31. |
| Webhook | Push notifications (POST body contains data) and Ping notifications (POST contains a callback URL to fetch). FIT files via Activity File Service. |
| Rate limits | Per-endpoint, generally generous; details under NDA but irrelevant at personal scale. |
| Read | Activities in FIT/GPX/TCX, daily summaries (steps, RHR, stress, body battery), sleep, HRV (where supported by device). |
| Write | Training API: push structured workouts + training-plan calendar. User syncs watch → workout appears on device. Courses API: push routes. |
| Latency | Push typically <5 min after device→phone sync. |
| Cost | Connect Developer Program: no fee, but **requires a legal entity** (no personal applications); some Health metrics behind license/MOQ. **This is a real blocker for personal use.** |
| Workarounds | (a) Apply as a sole-proprietor LLC, or (b) read Garmin data via HealthKit (Garmin iOS app writes to Health), or (c) use a paid aggregator (Terra, Spike, Rook). |

### 5.4 Coros

| Aspect | Detail |
|--------|--------|
| API | "Coros Open API" — application-only; submit form on developer support page. |
| Auth | OAuth 2.0. |
| Push | Workouts pushed to your endpoint after watch→app sync. |
| Write | Structured workouts + training plans can be pushed to the Coros server (similar to Garmin Training API). |
| Cost / approval | B2B — hobbyist applications often rejected. As with Garmin, pragmatic fallback is HealthKit (Coros iOS app writes to Health) or aggregator. |
| Notes | Less mature docs than Garmin; community SDKs exist but unofficial. |

### 5.5 Whoop

| Aspect | Detail |
|--------|--------|
| API | v2 (v1 deprecated). |
| Auth | OAuth 2.0; default scopes: `offline read:cycles read:sleep read:recovery read:workout read:body_measurement read:profile`. |
| Webhook | `workout.updated`, `sleep.updated`, `recovery.updated` (UUIDs in v2, not int IDs). Subscribe via developer dashboard. |
| Rate limits | 100 req/min, 10,000 req/day per app. ~60–80 connected users supported by default; higher caps on request. |
| Write | None — read-only. |
| Cost | Free for personal/dev use; commercial requires app review. |
| Notes | Recovery webhook references the `sleep` UUID, not a recovery UUID. |

### 5.6 Oura

| Aspect | Detail |
|--------|--------|
| API | v2. |
| Auth | OAuth 2.0; Personal Access Tokens (PATs) supported for *single-user* private apps — perfect fit for personal faff.run. |
| Webhook | Event types include `daily_readiness`, `daily_sleep`, `sleep`, `daily_activity`, `daily_spo2`, `workout`, `session`, `daily_stress`, `daily_resilience`, `vo2_max`, `enhanced_tag`, `ring_configuration`. |
| Rate limits | 5,000 req / 5-min rolling window. Generous. |
| Write | None — read-only. |
| Cost | Free. |
| Notes | OAuth tokens (client-side flow) expire at 30 days with no refresh; server-side flow has refresh tokens. Use server-side flow. |

### 5.7 Stryd

Stryd does not publish a consumer cloud API for third parties at the level of Strava/Garmin. Pragmatic integration:

1. **Via Apple Watch** — Stryd ships an iOS app and a Connect IQ app. The wrist Watch reads Stryd as an external power sensor over BLE during a workout; `runningPower` samples land in HealthKit attached to our `HKWorkout`. Done.
2. **Via Garmin** — if user runs with a Garmin watch + Stryd, power is in the FIT file we ingest from Garmin Activity API.

Treat Stryd as an *enrichment to power samples on existing activities*, never a separate ingest source.

### 5.8 Final Surge / TrainingPeaks (out of MVP scope)

Both have OAuth-based APIs for plan import. Defer until users explicitly ask. One-shot CSV import on signup is a cheaper alternative.

### 5.9 Summary

| Service | Read | Write | Cost-real | Webhook | OAuth | MVP? |
|---------|------|-------|-----------|---------|-------|------|
| HealthKit | yes | own workouts | free | observer | iOS sheet | yes |
| Strava | yes | activity upload | free (1-user) | yes | 2.0 | yes |
| Garmin | yes | workouts/courses | gated (B2B) | yes | 2.0 | maybe (via HK fallback) |
| Coros | yes | workouts | gated | yes | 2.0 | no |
| Whoop | yes | none | free | yes | 2.0 | yes |
| Oura | yes | none | free (PAT ok) | yes | 2.0 / PAT | yes |
| Stryd | via HK/Garmin | n/a | free | n/a | n/a | yes (passive) |

---

## 6. Offline Behavior

### 6.1 Apple Watch

- **Workout recording is fully offline.** `HKLiveWorkoutBuilder` writes to local HealthKit; GPS works without cell.
- Plan for *today* is cached at last sync; user can run the prescribed workout with no connectivity.
- Quick-log (felt-rating, mood) buffered in SwiftData; flushed via `WCSession.transferUserInfo` (queued, guaranteed delivery) on next reachability.
- No live coach voice line generation offline — pre-canned audio assets only.

### 6.2 iPhone

- Full plan + recent activities cached locally (Core Data/SwiftData).
- Compose-time edits (rename activity, add note, log a meal) write local + queue for `/sync` POST.
- Outbound queue is durable across app kills (SQLite-backed, idempotent ops with client-generated UUIDs).
- HealthKit reads work regardless of network — all bio data lives on-device.

### 6.3 Web

- Web is a thin client; assumes connectivity. Read-only "last cached" page if API is unreachable, no edit support.
- Acceptable trade-off: phone is the offline surface, web is the analysis surface.

---

## 7. Bidirectional Patterns

### 7.1 Pushing activity to Strava (rich metadata)

After our backend finalizes an activity:

1. Generate a FIT file from raw samples (preferred over GPX — preserves laps, HR zones, power).
2. `POST /uploads` with:
   - `file`: the .fit
   - `data_type`: `fit`
   - `name`: our auto-generated title (e.g. "Tempo 4×6′ @ 4:25/km")
   - `description`: planned-vs-actual summary, RPE, weather (max ~5 lines — keep tight)
   - `external_id`: `faff:{activity.id}`
   - `trainer`: true/false from activity.environment
   - `commute`: false (always for sport activities)
3. Poll `/uploads/{id}` until `activity_id` is non-null (typically <30 s).
4. Persist `activity.externalIds.strava = activity_id`.
5. **Do not** then re-fetch via webhook — our `external_id` prefix tells us to skip self-uploads.

**Gear is intentionally omitted** because the API can't set it; we surface a one-tap "tag with Adidas Adios Pro 4" deep link to Strava in the post-upload toast, but that's manual.

### 7.2 Pushing planned workouts to Garmin device

Via Training API:

1. User schedules tomorrow's tempo run in faff.run.
2. Backend transforms our `WorkoutBlueprint` → Garmin Training API workout JSON (warmup, repeat blocks, cooldown; targets in pace or HR zones).
3. `POST /workout` to create + `POST /schedule` to put it on the calendar for tomorrow's date.
4. User wakes Garmin, Garmin Connect syncs, workout appears under "Today's Workout" on the watch.
5. After execution, the activity comes back via Activity API as a normal Garmin push and feeds into §4.2.

**Caveat:** requires Connect Developer Program approval. Without it, this feature is hidden behind a feature flag that surfaces only if the user has connected a Garmin via aggregator.

### 7.3 Pushing to multiple destinations

When `pushToStrava` and `pushToGarminCourses` are both on, we fan out from the backend, **never from the client**. Single source of truth, easier retries, no double-uploads if the phone glitches mid-flow.

---

## 8. Data Model Implications

```
Activity
  id              uuid (canonical)
  source          enum  -- 'watch_native' | 'healthkit' | 'garmin' | 'coros' | 'strava' | 'manual'
  externalIds     jsonb -- { strava: 12345, garmin: "abc...", healthkit: "<UUID>" }
  startedAt       timestamptz
  endedAt         timestamptz
  duration        int (seconds)
  distance        float (meters)
  type            enum
  routePolyline   text NULL
  rawBlobUrl      text NULL  -- S3/R2 path to original FIT/HK export
  reconciledAt    timestamptz
  enrichments     jsonb -- { strydPower: { source: 'stryd', samples: [...] }, ... }
  conflictsLog    jsonb -- when policy auto-resolved a disagreement, record what was overridden

HealthMetric
  id              uuid
  type            enum  -- 'hrv_rmssd' | 'hrv_sdnn' | 'rhr' | 'sleep_score' | ...
  value           jsonb -- type-specific shape
  source          enum  -- 'oura' | 'whoop' | 'apple_watch' | 'garmin' | 'manual'
  recordedAt      timestamptz
  ingestedAt      timestamptz
  confidence      enum  -- 'primary' | 'secondary' | 'shadowed'  -- post-reconcile

ServiceConnection
  id              uuid
  service         enum
  accountId       text  -- vendor's user id
  scopes          text[]
  accessToken     text (encrypted)
  refreshToken    text (encrypted) NULL
  expiresAt       timestamptz NULL
  webhookId       text NULL
  status          enum  -- 'connected' | 'expired' | 'revoked' | 'error'
  lastSyncAt      timestamptz NULL
  settings        jsonb -- per-service prefs (push to strava, allowed scopes, primary-flag overrides)

SyncEvent  -- append-only audit log
  id              uuid
  service         enum
  direction       enum  -- 'in' | 'out'
  trigger         enum  -- 'webhook' | 'observer' | 'poll' | 'manual'
  payloadHash     text
  status          enum  -- 'ok' | 'retry' | 'failed' | 'duplicate' | 'review'
  activityId      uuid NULL
  metricId        uuid NULL
  errorCode       text NULL
  durationMs      int
  occurredAt      timestamptz

PrimarySourceOverride
  userId          uuid
  metricClass     enum  -- 'activity' | 'hrv' | 'rhr' | 'sleep' | 'power' | 'weight' | 'vo2max'
  primary         text  -- service id
```

**Indexes that matter:**
- `Activity (userId, startedAt)` — primary lookup for fuzzy match.
- `Activity ((externalIds->>'strava'))`, etc. — gin or expression indexes on each external id key.
- `HealthMetric (userId, type, recordedAt desc)` — chart reads.
- `SyncEvent (occurredAt desc) WHERE status != 'ok'` — debugging.

**Why a dedicated `enrichments` jsonb on Activity rather than separate child tables?** Personal scale; the variety of secondary providers is high and the access pattern is "always read together with the activity." Promote to dedicated tables only if a specific enrichment grows beyond ~50 KB or needs its own query plan.

**Conflict log:** every time the policy table (§3) made a choice over a non-trivial disagreement, write a row. Surfaced in a "Why this number?" disclosure on the activity detail page. Cheap to keep, invaluable for debugging "why is my distance different from Strava."

---

## 9. Recommended Architecture (Concrete)

```
┌───────────────────┐    ┌───────────────────┐    ┌───────────────────┐
│  Apple Watch app  │    │   iPhone app      │    │   Web (Next.js)   │
│  (SwiftUI + HK)   │◄──►│  (SwiftUI + HK)   │◄──►│   API + UI        │
│                   │ WC │                   │REST│                   │
│  HKLiveWorkout    │    │  HKObserverQuery  │    │  Plan editor,     │
│  Build → save     │    │  HKAnchoredQuery  │    │  analysis,        │
│  to HK            │    │  Outbound queue   │    │  settings         │
└───────────────────┘    └─────────┬─────────┘    └─────────┬─────────┘
                                   │                          │
                                   │ HTTPS (REST + Realtime ws)
                                   ▼                          ▼
                         ┌────────────────────────────────────────┐
                         │           Backend (Postgres)           │
                         │                                        │
                         │  /activities  /metrics  /plan          │
                         │  /webhooks/{strava,garmin,whoop,oura}  │
                         │  /sync (idempotent batch)              │
                         │                                        │
                         │  Workers: reconcile, enrich, fan-out   │
                         │  Realtime: Supabase channels per user  │
                         └────────┬───────────────────────────────┘
                                  │
                ┌─────────────────┼─────────────────┐
                ▼                 ▼                 ▼
        ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
        │   Strava     │  │   Garmin     │  │ Whoop / Oura │
        │  (in & out)  │  │  (in & out)  │  │   (in only)  │
        └──────────────┘  └──────────────┘  └──────────────┘
```

**Stack picks:**
- **Backend:** Supabase (Postgres + auth + realtime + edge functions). For a personal app the cost/ops curve is excellent and Realtime channels solve "push plan-update to the phone".
- **Workers:** Supabase Edge Functions for webhook receivers (webhook handlers must be fast — ack <2 s, then enqueue), plus a small queue (Postgres `pgmq` or Inngest) for reconcile/enrich jobs that may take longer.
- **Object storage:** Supabase Storage / R2 for raw FIT blobs. Cheap, durable, never delete.
- **iOS:** Swift, SwiftData for local cache, `HKObserverQuery` + `HKAnchoredObjectQuery` for delta sync, `WCSession` only for small priority context (today's workout, watch→phone "I just saved" nudge).
- **Web:** Next.js (App Router) + Supabase JS client + Realtime channel subscription on dashboard pages.
- **Auth:** Supabase Auth for the user; per-service OAuth tokens stored encrypted (pgsodium / vault) in `ServiceConnection`.

---

## 10. Open Questions and Gotchas

- **Garmin / Coros B2B walls.** Both formally require legal-entity registration. Realistic options: (a) use HealthKit as the conduit (their iOS apps write to Health), (b) sole-prop LLC, (c) paid aggregator (Terra/Rook/Spike charges per connected user). Decide before the first Garmin user shows up.
- **HealthKit silent permission revocation.** A user can switch off any read type in Settings → Health → Data Access without telling our app. The API returns "no data" rather than "you don't have permission." Defensive pattern: every observer cycle, re-check `authorizationStatus(for:)` and surface a banner if it dropped.
- **Strava self-upload feedback loop.** Webhook fires when our own upload completes; we must early-exit on the `faff:` external_id prefix or we'll re-ingest our own data and double-count.
- **HRV unit mismatch.** SDNN vs rMSSD must never be averaged. Two separate metric types (`hrv_sdnn`, `hrv_rmssd`); recovery score consumes one, picked by hierarchy.
- **Time zone & DST.** Always store UTC; render in user's local zone. Apple Watch sleep intervals and Whoop "cycles" cross midnight; treat `cycleDate` (Whoop) and `date` (Oura daily_*) as the local date the cycle ended.
- **Webhook retries vs. idempotency.** All write paths must be idempotent. Strava and Whoop will resend on 5xx; bursting the same webhook twice in 60 s should produce a single canonical record. Keyed on `(service, externalId, aspect_type)` in a 24h Redis-style dedupe (or just a unique constraint + ON CONFLICT in Postgres).
- **Token refresh windows.** Strava tokens last 6h, Whoop ~1h, Oura 30 days (server flow). Refresh proactively at 80% of TTL, not on first 401, to avoid stampedes when the user opens the dashboard at 7 AM.
- **Backfill on connect.** When a user connects Strava on day 30, do we ingest their last 90 days? Yes, but as a one-time backfill job, not via the live webhook path. Bounded to the last 365 days unless user opts in for full history.
- **Watch Connectivity reachability lies.** `WCSession.isReachable` flickers; never gate user-visible state on it — buffer + retry instead.
- **Stryd over Garmin vs over Watch.** If a user runs with both wrist Watch and a Garmin (with Stryd paired to the Garmin only), our two pipes will produce two activities — fuzzy match dedupes them, and Stryd power gets attached as enrichment to the canonical (Watch) activity.
- **Plan-mid-sync editing.** If the user is mid-run and the web edits the plan, do not push the change to the watch. The active workout owns the watch until it ends. Queue plan deltas; deliver them after `HKWorkoutSession` ends.
- **Apple Watch "background running" entitlement.** Required so the app can keep collecting samples when the user lowers the wrist mid-run. Verify it's in the entitlements file before the first beta.

---

## Sources

- [HKWorkout — Apple Developer Documentation](https://developer.apple.com/documentation/healthkit/hkworkout)
- [HKObserverQuery — Apple Developer Documentation](https://developer.apple.com/documentation/healthkit/hkobserverquery)
- [HKAnchoredObjectQuery — Apple Developer Documentation](https://developer.apple.com/documentation/healthkit/hkanchoredobjectquery)
- [HKWorkoutRoute — Apple Developer Documentation](https://developer.apple.com/documentation/healthkit/hkworkoutroute)
- [Reading route data — Apple Developer Documentation](https://developer.apple.com/documentation/healthkit/reading-route-data)
- [Synchronize health data with HealthKit (WWDC20)](https://developer.apple.com/videos/play/wwdc2020/10184/)
- [Track workouts with HealthKit on iOS and iPadOS (WWDC25)](https://developer.apple.com/videos/play/wwdc2025/322/)
- [WCSession — Apple Developer Documentation](https://developer.apple.com/documentation/watchconnectivity/wcsession)
- [Three Ways to Communicate via WatchConnectivity (Teabyte)](https://alexanderweiss.dev/blog/2023-01-18-three-ways-to-communicate-via-watchconnectivity)
- [Strava API v3 Reference](https://developers.strava.com/docs/reference/)
- [Strava Rate Limits](https://developers.strava.com/docs/rate-limits/)
- [Strava Webhook Events API](https://developers.strava.com/docs/webhooks/)
- [Strava Uploads Documentation](https://developers.strava.com/docs/uploads/)
- [Strava API Agreement](https://www.strava.com/legal/api)
- [Strava Community: duplicate detection thread](https://communityhub.strava.com/developers-api-7/how-does-strava-filter-duplicate-activities-uploaded-from-the-same-account-11994)
- [Garmin Connect Developer Program — Overview](https://developer.garmin.com/gc-developer-program/overview/)
- [Garmin Health API](https://developer.garmin.com/gc-developer-program/health-api/)
- [Garmin Activity API](https://developer.garmin.com/gc-developer-program/activity-api/)
- [Garmin Training API](https://developer.garmin.com/gc-developer-program/training-api/)
- [Garmin OAuth 2.0 PKCE Specification](https://developerportal.garmin.com/sites/default/files/OAuth2PKCE_1.pdf)
- [Garmin Connect Developer Program FAQ](https://developer.garmin.com/gc-developer-program/program-faq/)
- [WHOOP Developer Documentation](https://developer.whoop.com/)
- [WHOOP API v1→v2 Migration](https://developer.whoop.com/docs/developing/v1-v2-migration/)
- [WHOOP Webhooks](https://developer.whoop.com/docs/developing/webhooks/)
- [WHOOP API Rate Limiting](https://developer.whoop.com/docs/developing/rate-limiting/)
- [WHOOP OAuth 2.0](https://developer.whoop.com/docs/developing/oauth/)
- [Oura API v2 Documentation](https://cloud.ouraring.com/docs/)
- [Oura API V2 Upgrade Guide](https://partnersupport.ouraring.com/hc/en-us/articles/19907726838163-Oura-API-V2-Upgrade-Guide)
- [The Oura API — Help](https://support.ouraring.com/hc/en-us/articles/4415266939155-The-Oura-API)
- [Coros API Application — Help Center](https://support.coros.com/hc/en-us/articles/17085887816340-Submitting-an-API-Application)
- [Validation of nocturnal HRV in consumer wearables (PMC, 2025)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12367097/)
- [Garmin beaten by Oura & Whoop in HRV accuracy showdown — the5krunner](https://the5krunner.com/2025/10/06/garmin-beaten-by-oura-whoop-in-hrv-accuracy-showdown/)
- [Whoop vs Oura vs Apple Watch HRV — MyHRV](https://www.myhrv.com/posts/comparing-hrv-monitors)
