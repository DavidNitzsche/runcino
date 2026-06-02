# Watch ↔ Backend wire spec

**Purpose:** field-by-field documentation of the JSON shapes exchanged
between backend and the legacy Faff Watch app.

**Companion to:** `docs/coach/WATCH_CONTRACT.md` (the freeze notice ·
explains WHY the watch is frozen + at what code state).

**Canonical source of truth:** the Swift struct at
`legacy/native/Faff/FaffWatch Watch App/WatchWorkoutModels.swift`.

When this doc and the Swift struct disagree, the Swift struct wins ·
this doc is informational + a backend reference. Watch agent reviews
all changes here for accuracy.

**Last sync with Swift:** 2026-06-02 (commit f9a17cd5 baseline).

**Updates since baseline:**
- `2026-06-02` · `expiresAt` is now a sliding 14h window from issue
  time (`Date.now() + 14h`), not end-of-day-UTC. Watch agent
  enforces on `WorkoutRootView.start()` per Flag 6.
- `2026-06-02` · `runs.data.splits[i]._raw` passthrough on the
  completion ingest path · every WatchCompletionPhase field lands
  in DB regardless of whether it's typed at ingest. Composers prefer
  typed fields; `_raw` is the escape hatch for pre-greenlight /
  exploratory fields.
- `2026-06-02` · **Tier 1** shipped (watch `5b8bcc80`) · `paceSamples[]`,
  `hrSamples[]`, `timeInToleranceSec`, `timeOutOfToleranceSec`,
  `verdict` typed on `WatchCompletionPhase`. Backend
  `deriveSplitsFromPhases` preserves them as typed fields on
  `runs.data.splits[i]`. Composers `winVerdictHit` +
  `winTimeInTolerance` read them.
- `2026-06-02` · **Tier 2** shipped (watch `2cc8bdd0`) · `repRpe`
  (1-5) + `repRpeTag` (closed-set qualifier · `legs|lungs|mind|pace`)
  on `WatchCompletionPhase`. Opt-in honesty UX: prompt during
  recovery after completed work rep, applies to the prior rep,
  null when skipped / dismissed / 30s auto-timeout. Composers
  `flagRpeMismatch` / `winRpeUndershot` / `winRpeMatched` /
  `winRpeTrajectory` read them.

---

## Architecture recap

```
Backend                       iPhone (relay)              Apple Watch
─────────                     ──────────────              ───────────

GET /api/watch/today  ──────▶ Bearer auth fetch
                              ↓
                              JSON decoded to
                              WatchWorkout
                              ↓
                              WatchConnectivity
                              .applicationContext
                              ───────────────────────▶   WatchWorkoutModels
                                                          decodes JSON
                                                          ↓
                                                          Engine drives faces

Run ends                                                  Engine emits
                                                          WatchCompletion
                                                          ↓
                              WatchConnectivity           ◀───────────────────
                              transferUserInfo
                              + persistent retry queue
                              ↓
POST /api/watch/workouts/complete
  Bearer auth POST ◀──── JSON body
↓
INSERT runs row
autoMerge HK dupes
bust briefing cache
maybe Strava push
```

Watch has zero network in the running app. iPhone is the only path
in/out.

---

## Direction 1 · `GET /api/watch/today`

### Auth

`Authorization: Bearer <token>` · MANDATORY.
The legacy `?user_id=` query param is **hard-rejected** with HTTP
400 (locked 2026-05-30 after confirmed cross-user data-leak vector).

### Optional query params

- `?date=YYYY-MM-DD` · iPhone-only · lets the WorkoutDetailModal
  fetch the structured payload for any day's tile. The watch never
  sends this · always wants today.

### Response

Either a `WatchWorkout` or a `{ message: string }` short-circuit for
rest days / no plan.

```ts
type WatchTodayResponse =
  | { workout: WatchWorkout }
  | { message: 'Rest day' | 'no plan' | string }
```

---

## `WatchWorkout`

The structured workout payload. Swift struct at
`WatchWorkoutModels.swift:112-223`.

| Field | Type | Required | Units | Notes |
|---|---|---|---|---|
| `workoutId` | `string` | yes | — | Stable id. Drives idempotency on completion (`stableBigintFromString(workoutId)`). Re-issuing the same id means re-issuing the same workout. |
| `name` | `string` | yes | — | "CRUISE INTERVALS" · header on the watch face. |
| `summary` | `string` | yes | — | "Threshold · 4 × 1 mile reps" · subtitle. |
| `totalEstimatedMinutes` | `int` | yes | min | Sum of all `phases[].durationSec / 60`. Watch uses this for the home-screen glance. |
| `phases` | `WatchPhase[]` | yes | — | Folded-out · repeat blocks become individual phases (warmup → work₁ → recovery₁ → work₂ → ... → workN → cooldown). |
| `completionEndpoint` | `string` | yes | — | URL the watch POSTs back to. Typically `/api/watch/workouts/complete`. |
| `expiresAt` | `ISO string` | yes | UTC | Sliding 14h window from issue time (`Date.now() + 14h`). Covers early-AM (PM issue → next-morning) and late-PM (AM issue → same-evening) windows. Watch agent enforces on `WorkoutRootView.start()` · refuses + re-fetches when stale (Flag 6 · enforcement shipped `d935c0d2`). |
| `readinessScore` | `int?` | no | 0-100 | Top-of-watch glance. Falls back to last-known when nil. |
| `readinessLabel` | `string?` | no | — | "Primed" / "Hold easy" / "Back off". |
| `distanceMi` | `double?` | no | mi | Total expected distance. |
| `paceLabel` | `string?` | no | — | Training zone tag: "T" / "I" / "E" / "Goal". |
| `isRace` | `bool` | yes | — | Flips watch faces to the race layout. Default false. |
| `goalSec` | `int?` | no | s | Goal finish time (race-only). |
| `strategyLabel` | `string?` | no | — | "Even effort · 8:46 flat" (race-only). |
| `gelsMi` | `double[]?` | no | mi | Gel marker miles (race-only, distance-anchored). |
| `fueling` | `WatchFueling?` | no | — | TIME-anchored training fueling plan · see below. |
| `hrCeilingBpm` | `int?` | no | bpm | Easy / Z2 / heat-flag HR ceiling. Live HR above this flips the guardrail row red. |
| `displayHint` | `string?` | no | — | Optional in-run face override: `"hr"` / `"progression"` / `"strides"`. Watch falls back to phase-driven defaults when nil/unknown. |

### `WatchPhase`

| Field | Type | Required | Units | Notes |
|---|---|---|---|---|
| `type` | enum | yes | — | `"warmup"` / `"work"` / `"recovery"` / `"cooldown"` |
| `label` | `string` | yes | — | "Rep 1/4" / "Warmup" / "Recovery 2/3" |
| `durationSec` | `int` | yes | s | Always set, even for distance reps (used as time estimate). |
| `targetPaceSPerMi` | `int?` | no | s/mi | Goal pace. Nil for free-form phases (warmup/cooldown often). |
| `tolerancePaceSPerMi` | `int?` | no | s/mi | ± window around target. e.g. 8s = ±8 s/mi acceptable. |
| `haptic` | enum | yes | — | `"start"` / `"transition-work"` / `"transition-recovery"` / `"transition-cooldown"` / `"end"` |
| `repUnit` | enum | yes | — | `"time"` (default) or `"distance"`. Drives whether the engine counts down by elapsed time or by GPS distance. |
| `distanceMi` | `double?` | no | mi | Fixed rep distance · set only when `repUnit == "distance"`. |

**Index assignment:** the JSON has no `index` field on phases · the
watch's `WatchWorkout.init(from:)` re-stamps each phase with its
array position on decode. This is CRITICAL · earlier versions
dropped `repUnit` + `distanceMi` during decode by reconstructing
phases without those fields, which caused 5.8mi runs to overshoot
to 6.0 (fell through to time-based finish because distanceMi was
lost). Don't refactor without exercising
`WatchFixtures.cruise-decode-tomorrow`.

### `WatchFueling`

Time-anchored gel plan. Parity with `lib/training/fueling.ts`.

| Field | Type | Units | Notes |
|---|---|---|---|
| `needed` | `bool` | — | False → engine skips fueling alerts. |
| `gels` | `int` | count | Total gel count for the run. |
| `atMins` | `int[]` | min | When to fire each prompt, minutes from run start. The engine matches `elapsed >= atMins[i]` and fires a haptic + screen note. |
| `gPerHr` | `int` | g/hr | Target carb rate. |
| `totalCarbsG` | `int` | g | Sum across all gels. |
| `isRehearsal` | `bool` | — | Race-day fueling rehearsal session flag. |
| `heatAdjusted` | `bool` | — | True when the plan was bumped for heat conditions. |
| `shortLine` | `string` | — | "Maurten 100 now — 1 of 3" · runner-facing copy. |
| `why` | `string` | — | Plain-language rationale shown on tap-through. |

---

## Direction 2 · `POST /api/watch/workouts/complete`

### Auth

`Authorization: Bearer <token>` · MANDATORY. Same token the iPhone
uses for all other Faff API calls.

### Idempotency

Backend computes `stableId = -stableBigintFromString(workoutId)`.
Negative values are reserved for non-Strava sources (disjoint from
Strava's positive id keyspace).

DELETE-then-INSERT pattern keyed on `(user_uuid, client_workout_id)`
means re-POSTing the same `workoutId` lands one row. Safe to retry
unboundedly.

### Request body · `WatchCompletion`

Swift struct at `WatchWorkoutModels.swift:252-272`.

| Field | Type | Required | Units | Notes |
|---|---|---|---|---|
| `workoutId` | `string` | yes | — | The same id from the matching `WatchWorkout`. |
| `startedAt` | `ISO string` | yes | local | Drives `data.date` (`.slice(0,10)`) and `data.startLocal`. |
| `completedAt` | `ISO string` | yes | local | Backend ignores · totalDurationSec is the source of truth. |
| `status` | `string` | yes | — | `"completed"` / `"partial"` / `"abandoned"`. Drives recap framing. |
| `totalDistanceMi` | `double?` | no | mi | GPS-measured total. Falls back to phase sum when nil. |
| `totalDurationSec` | `int` | yes | s | Elapsed run time. Drives `avgPace`. |
| `avgHr` | `int?` | no | bpm | Run-wide average. |
| `maxHr` | `int?` | no | bpm | Run-wide peak. |
| `avgCadence` | `int?` | no | spm | Run-wide average. |
| `kcal` | `int?` | no | kcal | Total active calories from `HKLiveWorkoutBuilder.activeEnergyBurned`. **TIER 1** for run-detail calories · skips estimator fallback when present. Nil when HK reported zero (very short run or sensor glitch). Doctrine: `designs/briefs/iphone-calories-and-absorption-brief.md`. |
| `phases` | `WatchCompletionPhase[]` | yes | — | Per-phase actuals · the watch's unique value. See below. |

### `WatchCompletionPhase`

The watch's unique value-add. No other source ships structured
per-phase actuals. Swift struct at `WatchWorkoutModels.swift:227-250`.

| Field | Type | Required | Units | Notes |
|---|---|---|---|---|
| `index` | `int` | yes | — | Cursor position from the matching `WatchPhase`. |
| `type` | `string` | yes | — | Phase type string · matches the `WatchPhaseType` enum from the incoming workout. Backend tolerates additional values (`"rep"` / `"rest"` / `"tempo"` / `"threshold"`) from non-watch sources. |
| `label` | `string` | yes | — | "Rep 3/4" / "Recovery 2/3" etc. |
| `targetPaceSPerMi` | `int?` | no | s/mi | Echoes the workout's `targetPaceSPerMi` for this phase. Lets recap compare planned vs actual without re-loading the original workout. |
| `actualPaceSPerMi` | `int?` | no | s/mi | TRUE per-phase average · `actualDistanceMi / actualDurationSec` at phase end. NOT a snapshot of instantaneous reading. Earlier versions used the snapshot which overstated by the runner's end-of-rep kick. |
| `actualDurationSec` | `int` | yes | s | Elapsed time spent in this phase. |
| `actualDistanceMi` | `double?` | no | mi | GPS-measured distance covered DURING the phase. For a 1-mile rep this reads e.g. 1.02 mi · separate from the planned `WatchPhase.distanceMi` which says 1.0. |
| `avgHr` | `int?` | no | bpm | TRUE phase average · sum of every per-second sample divided by count. NOT a snapshot. |
| `maxHr` | `int?` | no | bpm | Peak HR observed during the phase. |
| `avgCadence` | `int?` | no | spm | Average cadence across the phase. |
| `completed` | `bool` | yes | — | True when auto-advance fired (target reached). False when runner long-pressed end / abandoned. Backend's `!== false` default treats missing as truthy · the watch ALWAYS supplies this field, so the default only applies to non-watch sources. |
| `paceSamples` | `PaceSample[]?` | no | — | Tier 1 · 5-second pace timeline · `{ tSec, paceSPerMi?, distMi }`. Null for phases too short (<5s). |
| `hrSamples` | `HRSample[]?` | no | — | Tier 1 · 5-second HR timeline · `{ tSec, bpm? }`. Null when sensor never reported. |
| `timeInToleranceSec` | `int?` | no | s | Tier 1 · seconds within target pace ±tolerance. Null for phases without a target pace. |
| `timeOutOfToleranceSec` | `int?` | no | s | Tier 1 · seconds outside the target band. Pair with `timeInToleranceSec` for percentage. |
| `verdict` | `string?` | no | — | Tier 1 · watch-derived per-phase verdict: `'hit'` (≥70% in tolerance + avg in band) / `'drifted'` (avg in band but <70% in tolerance) / `'missed'` (avg outside band) / `'incomplete'` (early stop). Null for phases without a target. |
| `rep_rpe` | `int?` | no | 1-5 | Tier 2 · subjective per-rep RPE. Maffetone 5-category: 1=easy · 2=light · 3=moderate · 4=hard · 5=max. Opt-in honesty: null when runner skipped, dismissed, or 30s timeout fired. Watch posts as `repRpe` (camelCase); backend stores as `rep_rpe` (snake_case) to match split convention. |
| `rep_rpe_tag` | `string?` | no | — | Tier 2 · optional qualifier · closed set: `'legs'` (muscular limit) / `'lungs'` (cardio limit) / `'mind'` (focus/motivation) / `'pace'` (target felt off). Posted as `repRpeTag`. |

### `_raw` passthrough on `runs.data.splits[i]`

`deriveSplitsFromPhases` writes a `_raw` field on every ingested
split that carries the full original `WatchCompletionPhase` object
from the watch payload, untouched.

**Purpose:** every future watch field lands in DB with zero backend
ingest change. Composers prefer typed fields (fast path) but can
read `_raw.xxx` for fields not yet typed.

**Rule of thumb (agreed with watch agent 2026-06-02):**

- **TYPE** when a composer reads the field within 1 sprint (hot path
  · typed access is faster + safer + clearer to read)
- **`_raw`** for exploratory or pre-greenlight fields (escape hatch
  · keeps the data available without committing to a typed contract)

**Shape:** `runs.data.splits[i]._raw === phases[i]` from the
incoming payload.

**Composer doctrine:** When the watch ships Tier 1/2/3 fields, the
sequence is:
1. Backend ships nothing · `_raw` already preserves the field
2. Backend writes the composer · reads from `_raw.xxx` initially
3. Once the composer is stable + the field is hot-path, backend
   adds a typed entry to `deriveSplitsFromPhases` and the composer
   switches to the typed accessor

### Treadmill-only fields (NOT on watch payloads)

The watch app does not do treadmill runs. The fields below appear
ONLY on completion payloads from the iPhone TreadmillView (see
`designs/briefs/treadmill-backend-wire-brief.md`):

- `body.source = 'treadmill'` (watch always sends `'watch'`)
- `body.indoor = true` (watch always sends false or omits)
- `phases[i].actualSpeedMph` (watch has no reference to this field)
- `phases[i].actualInclinePct` (watch has no reference to this field)

Backend's whitelist accepts both source paths. The watch path never
populates the treadmill-only fields, so backend's `winTreadmill()`
pattern detection won't fire on watch-sourced runs.

---

## Backend side effects after INSERT

In order:

1. **Stable id assignment** · `stableBigintFromString(workoutId)`.
2. **DELETE existing rows** where `data->>'client_workout_id' = workoutId`.
3. **INSERT new row** into `runs (id, user_uuid, data)`.
4. **autoMergeForDate(userId, date)** · folds in any HKWorkout import
   that landed for the same day. Source tier ladder: `watch=5,
   manual=4, apple_watch=3, apple_health=2, strava=1`. Higher tier
   wins · richer data merges into canonical.
5. **bustBriefingCacheForEvent('run_ingest')** · clears the
   downstream cache for Today + Train. Health + Profile don't bust.
6. **maybeAutoPush(userId, runId)** · fire-and-forget Strava push
   when `profile.strava_auto_push = true`. Idempotent on `run_id`.

---

## Wire reliability

Watch agent shipped two independent delivery paths plus persistent
retry queue (see `PhoneSync.swift:127-140`):

- **Path 1** · `WCSession.transferUserInfo({completion: ...})` ·
  preferred when iPhone is around. WatchKit queues + persists across
  phone sleeps.
- **Path 2** · Direct POST from watch → backend · covers iPhone off
  / killed scenarios. Persisted to UserDefaults under `pendingDirect`.
  Bounded at 50 items. Retried on:
  - `WCSession.activate()`
  - New auth token from iPhone
  - Manual `sendCompletion()`
  - HTTP 200-299 → drop. 401/403 → mark token stale. 5xx/network →
    keep + retry.

Backend dedupe via stable bigint id means both paths landing the
same completion is safe.

**One caveat:** the direct path needs an auth token, which the watch
only has after the iPhone has pushed it at least once. First-ever
sync requires the iPhone path.

---

## Doctrine references

Briefs that established the contract:

- `designs/briefs/iphone-calories-and-absorption-brief.md` · `kcal`
  Tier 1 source from `HKLiveWorkoutBuilder`.
- `designs/briefs/treadmill-backend-wire-brief.md` · `source`
  whitelist + `indoor` + per-phase treadmill fields.
- `designs/briefs/watch-backend-integration-summary.md` · full
  audit + 6 flags.
- `designs/briefs/watch-agent-response-to-backend-2026-06-02.md` ·
  watch agent's response · resolved 5 of 6 flags · Flag 6
  (`expiresAt` enforcement) in flight.

Locked code paths:

- Auth · 2026-05-30 cross-user leak fix · Bearer required.
- Run absorber source tier ladder · `lib/runs/merge.ts`.
- Briefing cache busting policy · `lib/coach/regen-policy.ts`.
- Treadmill `winTreadmill()` patterns · `lib/coach/run-win.ts`.

---

## How to update this doc

When the Swift struct in `WatchWorkoutModels.swift` changes:

1. Watch agent ships a brief noting the change.
2. Backend updates this file's tables + version-stamps the "Last
   sync with Swift" date in the header.
3. Watch agent reviews this doc's accuracy in their next pass.

Don't edit this file in isolation · the Swift struct wins disputes.
