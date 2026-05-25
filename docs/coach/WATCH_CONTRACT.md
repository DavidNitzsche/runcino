# Watch app — DO NOT REBUILD

**Hard constraint (David, 2026-05-25):**
The watch app stays at `legacy/native/Faff/FaffWatch Watch App/` exactly
as-is. The v2 rebuild's job is to **speak its wire format**, not replace it.

## Files that are FROZEN

```
legacy/native/Faff/FaffWatch Watch App/
  FaffWatchApp.swift
  ContentView.swift
  ActiveWorkoutView.swift
  WorkoutEngine.swift
  Faces.swift
  ChimePlayer.swift
  Haptics.swift
  PhoneSync.swift
  WatchWorkoutModels.swift     ← THE WIRE FORMAT
```

These files define the contract. Don't edit them as part of the v2 build.
Bugs go via legacy work; new features go via the iPhone side.

## The wire contract

### Phone → Watch (applicationContext)

The watch's `PhoneSync.apply()` reads:

```swift
applicationContext: [
  "authToken":  String       // backend session token (so watch can POST direct)
  "readiness":  Data         // JSON-encoded WatchReadiness
  "workout":    Data         // JSON-encoded WatchWorkout (when there IS one)
  "noWorkout":  String       // human-readable message (when there isn't)
]
```

If both `workout` and `noWorkout` are absent, the watch leaves current state
untouched (graceful no-op).

### Watch → Phone (transferUserInfo)

The watch sends `WatchCompletion` Encodable payloads on workout finish.
The phone queues them durably (`UserDefaults` key
`faff.watch.pendingCompletions.v1`) and retries until the backend accepts.
Idempotent on the backend.

### WatchWorkout shape (frozen)

Defined in `legacy/native/Faff/FaffWatch Watch App/WatchWorkoutModels.swift`,
~line 112. Key fields:

- `workoutId, name, summary, totalEstimatedMinutes`
- `phases: [WatchPhase]` (intervals with target paces, HR, tolerance, haptic)
- `completionEndpoint, expiresAt`
- Glance: `readinessScore, readinessLabel, distanceMi, paceLabel`
- Race day: `isRace, goalSec, strategyLabel, gelsMi`
- Fueling: time-anchored gel plan
- `hrCeilingBpm` — Z2 ceiling that triggers screen flip
- `displayHint` — face flavour selector (hr/progression/strides)

The watch decodes this with a tolerant decoder; missing optional fields are
fine. Adding new fields is safe (watch ignores unknown keys).

**Renaming or removing an existing field will break the watch app.**

## v2 obligations

1. **native-v2 WatchSync.swift** — mirrors
   `legacy/native/Faff/Faff/WatchSync.swift` behavior. Same delegate
   pattern, same context shape, same completion-queue durability.

2. **web-v2 `/api/watch/today` endpoint** — returns
   `{ workout: WatchWorkout | null, readiness: WatchReadiness, message: string }`.
   Identical JSON shape to what `legacy/web/app/api/today/` returned.

3. **Model files** — `WatchWorkout`, `WatchReadiness`, `WatchCompletion`
   structs reproduced in `native-v2/Faff/Faff/Models/Watch.swift` for the
   phone side. (The watch app uses its own copies from legacy, unchanged.)

4. **Test** — install native-v2 alongside the legacy watch app on a real
   Apple Watch; today's workout appears on the watch face without any
   change to the watch binary. If it doesn't, v2's wire format diverged
   somewhere — fix v2, not the watch.

## Cutover

When v2 cuts over (`www.faff.run` → web-v2 service), the watch app:
- Continues running unchanged
- Receives applicationContext from native-v2 instead of legacy/native
- POSTs completions to web-v2's `/api/workouts/complete` endpoint
  (which web-v2 must implement with the same accept-and-acknowledge shape)

There is no "watch app cutover" — it's the same binary throughout.
