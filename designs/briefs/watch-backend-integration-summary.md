# Brief · Watch ↔ Backend integration · summary + flags

**For:** watch agent
**From:** backend
**Date:** 2026-06-02
**Status:** Audit + handoff · backend is honest, here's what's live
and what needs your eyes

---

## TL;DR

Two endpoints, one relay, idempotent both ways. The watch never
talks to backend directly — Apple Watch has no network in the
running app, so the iPhone is the relay via
`WatchConnectivity.applicationContext`. Backend's contract is
locked, doctrine-grounded, and currently honest. There are **6
flags** below worth your attention.

---

## Architecture (current state)

### Direction 1 · Backend → Watch (planned workout TO watch)

```
GET /api/watch/today
  Authorization: Bearer <token>          ← MANDATORY · ?user_id= rejected
  ↓
Backend:
  buildWatchToday(userId, date?)
    ↓ calls prescriptionFor() · SAME module the iPhone modal uses
    ↓ folds repeat blocks into phase sequence
    ↓ returns WatchWorkout JSON
  ↓
iPhone receives, forwards via WatchConnectivity.applicationContext
  ↓
Watch decodes via WatchWorkoutModels.swift
```

**Payload shape** (`WatchWorkout`):
- `workoutId` · stable id for completion POST
- `name`, `summary`, `totalEstimatedMinutes`
- `phases[]` · folded out (warmup → work₁ → recovery₁ → work₂ → ...
  → workN → cooldown)
  - `type: 'warmup' | 'work' | 'recovery' | 'cooldown'`
  - `label: string`
  - `durationSec: number` (always set, even for distance reps · estimate)
  - `targetPaceSPerMi?, tolerancePaceSPerMi?`
  - `haptic: 'start' | 'transition-work' | 'transition-recovery' |
            'transition-cooldown' | 'end'`
  - `repUnit?: 'time' | 'distance'`
  - `distanceMi?`
- `completionEndpoint` · URL the watch POSTs back to
- `expiresAt` · ISO timestamp
- `readinessScore?, readinessLabel?` · top-of-watch
- Race extras (when `isRace: true`): `goalSec`, `strategyLabel`,
  `gelsMi[]`, `fueling: { gels, atMins, gPerHr, ... }`,
  `hrCeilingBpm`
- `displayHint?` · optional copy override

**No rest day phantom:** when there's no workout today, backend
returns `{ message: 'Rest day' | 'no plan' }` instead of an empty
WatchWorkout. Watch decoder handles the message branch.

---

### Direction 2 · Watch → Backend (completed run BACK)

```
Run ends on watch
  ↓
Watch sends WatchCompletion blob → iPhone via WatchConnectivity
  ↓
iPhone POSTs to /api/watch/workouts/complete
  Authorization: Bearer <token>
  Body: { workoutId, source, indoor, phases[], totals, ... }
  ↓
Backend:
  1. Whitelist source ('watch' | 'treadmill') · console.warn + fallback
  2. Stamp data.indoor, data.source, data.name
  3. Generate stable bigint id from workoutId (negative · disjoint
     from Strava's positive keyspace)
  4. DELETE existing row where client_workout_id matches
  5. INSERT runs row (id, user_uuid, data jsonb)
  6. autoMergeForDate(userId, date) · HK dupes folded in
  7. bustBriefingCacheForEvent('run_ingest')
  8. maybeAutoPush(strava) · fire-and-forget if user opted in
```

**Idempotency:** re-POSTing same `workoutId` → same bigint id →
DELETE-then-INSERT lands one row. Safe to retry.

**Payload backend reads:**
- `workoutId` (string) · the stable id from the WatchWorkout
- `source: 'watch' | 'treadmill'` · whitelisted
- `indoor: boolean` · gates run-recap "you climbed N ft" facts +
  activity feed glyph
- `startedAt` (ISO) · drives `data.date` and `data.startLocal`
- `totalDistanceMi`, `totalDurationSec`
- `avgHr`, `maxHr`, `avgCadence`
- `kcal?` · from HKLiveWorkoutBuilder · Tier 1 for run-detail
  calories
- `phases[]` · structured per-phase actuals (the WATCH'S UNIQUE
  VALUE):
  - `type: 'warmup' | 'work' | 'rep' | 'recovery' | 'rest' | 'cooldown' | 'tempo' | ...`
  - `actualDistanceMi`, `actualDurationSec`, `actualPaceSPerMi`
  - `avgHr`, `maxHr`, `avgCadence`
  - `completed: boolean`
  - **Treadmill-only:** `actualSpeedMph`, `actualInclinePct`

**No structured per-phase data from any other source** — Strava
ships mile splits, Apple Health ships totals. Watch is the only
source that lets the recap engine say "rep 3 was 4s slow at the
top end of the band."

---

## Why this matters

The watch isn't just another data source · it's the **ONLY** source
that produces structured per-phase actuals. That's what makes the
recap engine able to surface:

- Rep-by-rep planned-vs-actual ("rep 3 was 4 s slow")
- Disciplined recovery jog detection (the new `winTreadmill()`
  treadmill pattern depends on `actualSpeedMph` per phase)
- Phase-aware HR analysis (work HR vs recovery HR separated)
- Work-only pace/HR averages (`pace_work`, `hr_avg_work` ·
  excludes warmup/cooldown dilution)

When the watch ingest is healthy, run-detail is qualitatively
better than any Strava-only run-detail you can buy.

---

## FLAGS · what needs your eyes

### Flag 1 · `docs/coach/WATCH_CONTRACT.md` is referenced but missing

Code comments in `lib/watch/build-workout.ts` and
`app/api/watch/today/route.ts` both point at
`docs/coach/WATCH_CONTRACT.md` as the wire contract source of truth.
That file doesn't exist on disk.

**The actual source of truth** is the Swift struct at
`legacy/native/Faff/FaffWatch Watch App/WatchWorkoutModels.swift`
(per the build-workout.ts comment).

**Ask:** Either resurrect a real `WATCH_CONTRACT.md` from the Swift
file (so the wire shape is documented outside the iOS repo), or
remove the stale references from the TS code so future readers don't
chase a ghost file. Backend can write the markdown if you ship the
canonical Swift struct.

---

### Flag 2 · `kcal` on watch completion (HKLiveWorkoutBuilder)

Backend reads `body.kcal` as Tier 1 in `resolveCalories()` (skip
Strava + active_energy estimator fallback when present). The
iPhone-side brief
`designs/briefs/iphone-calories-and-absorption-brief.md` shipped
this on iPhone 031fe5fd.

**Ask:** Confirm the watch app actually POSTs `kcal` in the
completion payload (not the iPhone). The doctrine note in the brief
specifies "from HKLiveWorkoutBuilder" — which lives on the watch,
not iPhone. If watch is omitting it, the iPhone-side ingest fix
doesn't help because the watch completion path doesn't get HK
backfill.

---

### Flag 3 · `phase.completed` boolean

The new treadmill win composer (`lib/coach/run-win.ts:winTreadmill()`)
gates the "Disciplined recovery jogs · the reps did the work" pattern
on `allRepsCompleted` (every work phase has `completed !== false`).

**Ask:** Does the watch actually emit `completed: true/false` on each
phase, OR does it omit the field on incomplete phases? Backend
treats `!== false` as completed (so missing field = completed). If
the watch's intent is "missing = didn't run," we need to flip the
default.

---

### Flag 4 · Treadmill phase fields on outdoor runs

`actualSpeedMph` and `actualInclinePct` are treadmill-only fields.
Backend stores them as null on outdoor runs.

**Ask:** Does the watch send these as null on outdoor runs, or does
it omit them entirely? Both work backend-side (null vs undefined
both `=== null` after JSON round-trip), but worth confirming the
watch isn't accidentally populating `actualSpeedMph` from GPS speed
on an outdoor run — that would muddle the win composer's pattern
detection.

---

### Flag 5 · WatchConnectivity reliability

The architecture relies on `WatchConnectivity.applicationContext`
to relay both directions. That API has known reliability quirks:

- `applicationContext` is best-effort · not guaranteed delivery
- On weak phone↔watch radio, deliveries can lag minutes-to-hours
- Foreground vs background timing varies wildly

**Ask:** Does the watch have a retry/queue strategy for completion
POSTs that fail to relay to iPhone? Or does it just fire-and-forget?
A dropped completion → no run record on backend → coach engine thinks
the runner skipped the workout.

Backend can't tell the difference between "didn't run" and "ran but
the relay failed." If watch can persist locally and retry on next
phone reconnect, that's the right move.

---

### Flag 6 · `expiresAt` on WatchWorkout

Backend stamps `expiresAt` (some future ISO timestamp) on every
`WatchWorkout`. Couldn't find evidence the watch app actually
respects it — i.e. refuses to start a workout past its expiry.

**Ask:** Does the watch check `expiresAt` and decline / re-fetch
when the cached workout is stale? If not, runners who tap "Start"
on yesterday's workout (because they didn't open the watch face this
morning) get a run logged against the wrong day.

Backend can shorten the expiry window if that's the safer default.

---

## Quick context on the iPhone relay

Worth knowing if you're not steeped in the architecture:

- Watch can ONLY talk to iPhone via `WatchConnectivity` (Apple's
  framework). The watch running app has zero network access.
- iPhone fetches `/api/watch/today` with Bearer auth, parses the
  JSON, builds the Swift `WatchWorkout`, and sends it to watch via
  `applicationContext`.
- When watch finishes a run, it sends a `WatchCompletion` blob to
  iPhone via the same channel. iPhone POSTs to
  `/api/watch/workouts/complete` with the same Bearer token.
- Authorization is iPhone's responsibility · the watch never holds
  a token.

This is why "the watch is frozen" doesn't mean watch development is
dead · the iPhone-side relay code keeps the watch app functional
without watch-side changes. Frozen ≈ stable contract, not abandoned.

---

## What backend will do next

Backend is at rest on watch integration. The next pieces of work that
might touch this contract:

1. **If watch agent adds new per-phase signals** (e.g. cadence
   adherence, HR coupling), backend can extend
   `deriveSplitsFromPhases` to preserve them with the same null-on-
   missing-source pattern used for `actualSpeedMph` / `actualInclinePct`.

2. **If the watch starts shipping per-second time-series** (HR every
   second, pace every second), backend would want a separate
   `/api/watch/workouts/stream` endpoint, NOT to bloat the
   `phases[]` payload. That's a bigger ask.

3. **If `WATCH_CONTRACT.md` gets resurrected**, backend will keep
   it honest — every contract change announced in a brief, every
   field documented with units + nullability + source.

---

## How to respond

1. Confirm or correct the 6 flags above. Even a "we already handle
   that" / "won't fix" / "we'll get to it" is enough — backend just
   needs to know.
2. If you want backend to write the markdown contract from the Swift
   struct, ship me the file path or paste it in a reply.
3. If `expiresAt` semantics need adjusting, name the window you
   want (e.g. "expire 24h after issue") and backend can update
   `buildWatchToday`.

---

## Related files

- `web-v2/app/api/watch/today/route.ts` · GET endpoint
- `web-v2/app/api/watch/workouts/complete/route.ts` · POST endpoint
- `web-v2/lib/watch/build-workout.ts` · the composer (417 lines)
- `web-v2/lib/training/prescriptions.ts` · same module the iPhone
  modal uses · single source of truth for workout structure
- `web-v2/lib/coach/run-state.ts:loadPhaseBreakdown` · how the recap
  surface reads back the per-phase data
- `web-v2/lib/coach/run-win.ts:winTreadmill` · treadmill win patterns
  that depend on the phase completion + speed fields
- `legacy/native/Faff/FaffWatch Watch App/WatchWorkoutModels.swift`
  · canonical wire shape (Swift)
- `designs/briefs/treadmill-backend-wire-brief.md` · the treadmill
  contract changes (recent)
- `designs/briefs/iphone-calories-and-absorption-brief.md` · the
  kcal Tier 1 contract

---

Going to ping you on Flag 1 / 2 / 3 specifically when David picks the
next thread. Everything else is informational.
