# Brief · HK strength ingest · iPhone HealthKitImporter extension

**For:** iPhone agent
**From:** backend / coach-engine agent
**Date:** 2026-06-01
**Status:** Backend ready · iPhone-side wiring is the remaining work

---

## Why

Today we have two strength-session sources: runner-logged via
`LogNonRunSheet` (POST `/api/strength`), and... that's it. If the
runner does strength outside the app — Apple Fitness, gym app, Strava
strength workout, watch's built-in strength type — we never see it.
The recommender thinks they're dormant. The ACWR fold (commit
`9ad0d31b`) under-counts load. The "2/2 this week" reconcile chip
shows 0/2 even when they lifted.

Same fix pattern the run importer already does · pull HKWorkout rows
of strength-flavored activity types, POST to `/api/strength` with
idempotency on `HKWorkout.uuid`.

---

## Backend state · what's ready to consume

### Migration 133 (already applied)

```sql
ALTER TABLE strength_sessions
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS hk_uuid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS strength_sessions_hk_uuid_uniq
  ON strength_sessions (hk_uuid) WHERE hk_uuid IS NOT NULL;
```

### `POST /api/strength` · extended payload (already shipped)

```jsonc
// Existing manual logging (unchanged):
{ "date": "2026-06-01", "session_type": "compound lift",
  "duration_min": 45, "notes": "..." }

// NEW · HK ingest path:
{
  "date": "2026-06-01",          // YYYY-MM-DD from HKWorkout.startDate
  "session_type": "strength" |   // map from HKWorkoutActivityType
                 "functional_strength" |
                 "core" |
                 "cross_training" |
                 "yoga" |
                 "pilates",
  "duration_min": 45,             // HKWorkout.duration ÷ 60, rounded
  "source": "apple_health",       // REQUIRED for HK path
  "hk_uuid": "ABC-123-DEF-456"    // REQUIRED · HKWorkout.uuid.uuidString
}
```

Behavior:
- `source` defaults to `'manual'` when omitted (existing behavior preserved)
- When `source='apple_health'`, `hk_uuid` is required · returns `400` if missing
- INSERT becomes `UPSERT ON CONFLICT (hk_uuid)` · re-syncing the same
  HKWorkout overwrites date/session_type/duration/source. Notes are
  preserved if the runner added them via manual log path on a row
  that's now being HK-overwritten (rare edge case).
- The unique partial index handles the upsert key safely (hk_uuid
  is nullable for manual rows; partial index ignores nulls).

### What's ALSO already shipped (so you don't have to think about it)

- The strength recommender (`lib/coach/strength-recommender.ts`) reads
  `strength_sessions` for habit detection. HK-imported rows count
  identically to manual.
- The ACWR fold (`lib/coach/strength-load.ts`) reads
  `strength_sessions.duration_min`. HK rows count identically.
- The scheduled-vs-actual reconcile (`lib/coach/strength-status.ts`)
  surfaces a `confirmed / skipped / bonus` triple on
  `glance.strengthWeekStatus`. HK rows that land on recommended days
  count as `confirmed`. Rows on non-recommended days count as `bonus`.

---

## What the iPhone needs to build

### 1. HealthKitImporter · strength workout fetcher

Pattern matches the existing run fetcher
(`native-v2/Faff/Faff/HealthKitImporter.swift` · function that does
HKWorkout query for activityType=running).

Activity types to include · `HKWorkoutActivityType`:

| Type | session_type to send |
|---|---|
| `.traditionalStrengthTraining` | `'strength'` |
| `.functionalStrengthTraining` | `'functional_strength'` |
| `.coreTraining` | `'core'` |
| `.crossTraining` | `'cross_training'` |
| `.yoga` | `'yoga'` |
| `.pilates` | `'pilates'` |
| `.flexibility` | `'mobility'` |

Skip these activity types (they're either runs or non-strength):
- `.running` (handled by existing run importer)
- `.walking` / `.hiking` / `.cycling` / `.swimming` (not strength)
- `.dance` / `.boxing` / `.kickboxing` (could be cardio · ambiguous · skip for now)

### 2. Per-workout payload

```swift
struct HKStrengthPayload: Encodable {
    let date: String          // ISO YYYY-MM-DD from HKWorkout.startDate, local TZ
    let session_type: String  // mapped from HKWorkoutActivityType
    let duration_min: Int     // HKWorkout.duration in seconds, ÷ 60, rounded
    let source: String        // always "apple_health"
    let hk_uuid: String       // workout.uuid.uuidString
}
```

POST to `https://www.faff.run/api/strength` with `Authorization: Bearer <token>`.

Idempotent · re-syncing the same `hk_uuid` upserts. Safe to re-POST
the entire 28-day window on every sync if simpler than tracking what's
new.

### 3. Sync cadence

Same pattern as run sync · on app foreground + after a background HK
delivery. Don't need a separate cron.

### 4. Sync window

Last 28 days. The recommender's habit detection uses a 28-day window.
The strength-load fold (ACWR) uses 28 days. The recommender's
"dormant" threshold is 21 days. 28 covers everything with headroom.

### 5. Notes field handling

The brief recommends NOT setting `notes` from HK · the HKWorkout
metadata is usually empty or device-name junk. Leave `notes` null on
HK posts; the runner can add notes manually if they want via the
existing LogNonRunSheet.

If the user has notes on an HK-imported row (rare: they manually added
to a row that later got HK-overwritten), the UPSERT preserves notes
via `COALESCE(EXCLUDED.notes, strength_sessions.notes)`.

---

## Smoke test

```bash
# Manual log (unchanged)
curl -X POST https://www.faff.run/api/strength \
  -H "Cookie: faff_session=<token>" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-06-01","session_type":"compound lift","duration_min":45}'

# HK ingest
curl -X POST https://www.faff.run/api/strength \
  -H "Cookie: faff_session=<token>" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-06-01","session_type":"strength","duration_min":45,"source":"apple_health","hk_uuid":"ABC-123"}'

# Re-POST same hk_uuid · should return same id, not create duplicate
curl -X POST https://www.faff.run/api/strength \
  -H "Cookie: faff_session=<token>" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-06-01","session_type":"strength","duration_min":50,"source":"apple_health","hk_uuid":"ABC-123"}'
# duration_min updated to 50; id preserved

# Verify
curl https://www.faff.run/api/strength?days=7 \
  -H "Cookie: faff_session=<token>"
# Look for source + hk_uuid fields in the response
```

---

## How the runner sees the result

Once HK strength is flowing:

1. **Habit detection becomes accurate** · runner doing 2x/week via
   Apple Fitness will register as `on_track` instead of `dormant`.
   Dormant coach intent stops firing for the wrong reason.

2. **ACWR includes the load** · the readiness brief's LOAD pillar
   now reflects total stress, not just running stress. Heavy strength
   weeks tip ACWR up · readiness brief may show "pull-back" earlier
   than running-only ACWR would.

3. **Reconcile chip lights up** · the new `strengthWeekStatus`
   surfaces "2/2 this week + 1 bonus" once HK strength sessions land
   on recommended days. Without HK, it's currently "0/2" for any
   runner who doesn't log manually.

4. **Skipped detection becomes honest** · when a recommended day
   passes with no HK + no manual log, `skipped` surfaces it. The
   next morning's brief can call it out: "Yesterday's recommended
   strength didn't land · two short sessions a week protects your
   hips and hamstrings."

---

## Edge cases handled by the backend

| Case | Behavior |
|---|---|
| Same HKWorkout synced twice | UPSERT on hk_uuid · no duplicates |
| Runner manually logs a session AND HK syncs same day | Both rows persist · counts as 1 confirmed + 1 bonus (per the reconciler's same-day logic) |
| HKWorkout activityType missing from our allowed set | iPhone skips · backend never sees |
| `source='apple_health'` but missing `hk_uuid` | Backend returns 400 |
| Manual log later, then HK row imports same date | Both rows persist · same-day bonus pattern |
| User deletes a strength workout in Apple Fitness | iPhone should DELETE on backend · brief endpoint addition needed (see below) |

---

## Open question for iPhone agent

**DELETE handling.** When the runner deletes a HKWorkout in Apple
Fitness, the import sync should ideally delete the corresponding
strength_sessions row. Currently there's no DELETE endpoint scoped to
hk_uuid · only the existing `/api/strength/[id]` DELETE that the
manual log UI uses (or doesn't · check).

Options:
- (a) iPhone deletes via existing route by matching local hk_uuid → id
- (b) Add `DELETE /api/strength?hk_uuid=...` endpoint
- (c) Skip DELETE for now · stale rows count as "habit signal that
       happened" · low-priority cleanup

Tell me which you want; (b) is ~5 min on the backend.

---

## How to respond

Reply with:
1. Estimated complexity (~hours)
2. Any HKWorkoutActivityType you want to add/remove from the allowed list
3. Choice on DELETE handling (a/b/c)
4. PR link when shipped · I'll verify the reconcile chip lights up
   for David

---

## Reference files (backend, no edits needed)

```
web-v2/db/migrations/133_strength_sessions_hk.sql       schema
web-v2/app/api/strength/route.ts                         POST contract
web-v2/lib/coach/strength-load.ts                        ACWR fold
web-v2/lib/coach/strength-recommender.ts                 habit + day pick
web-v2/lib/coach/strength-status.ts                      ⭐ scheduled-vs-actual reconcile
web-v2/lib/coach/glance-state.ts                         exposes strengthWeekStatus on the seed
```

Backend commit: `<next>` on main. iPhone side is unblocked.
