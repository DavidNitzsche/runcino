# Watch → Backend Completion Payload Spec (build 69+)

Source: watch-agent handoff, 2026-05-26.

## Wire

- **Endpoint**: `POST {workout.completionEndpoint}` — the full URL ships in
  the workout payload (e.g. `https://www.faff.run/api/watch/workouts/complete`)
- **Auth**: Bearer token from iPhone-shared `authToken` (forwarded by iPhone
  bridge OR direct-POST from watch when iPhone is offline)
- **Idempotent**: on `workoutId` — re-POSTing the same id overwrites, so the
  watch's durable retry queue is safe.

## WatchCompletion shape

```json
{
  "workoutId":        "0645f40c-...-2026-05-26",
  "startedAt":        "2026-05-26T14:00:00Z",    // ISO-8601 UTC
  "completedAt":      "2026-05-26T15:01:42Z",
  "status":           "completed",                // "completed" | "partial" | "abandoned"
  "totalDistanceMi":  7.92,                       // GPS, 2dp, nullable
  "totalDurationSec": 3702,                       // wall-clock, paused-corrected
  "avgHr":            154,                        // workout-wide, nullable
  "maxHr":            178,                        //   "
  "avgCadence":       178,                        //   "
  "phases":           [ /* one per phase, ordered */ ]
}
```

## WatchCompletionPhase shape

```json
{
  "index":              0,
  "type":               "warmup",   // warmup | work | recovery | cooldown
  "label":              "Warmup",
  "targetPaceSPerMi":   492,        // PLANNED · nullable on recovery
  "actualPaceSPerMi":   488,        // TRUE AVG · nullable when GPS too thin
  "actualDurationSec":  891,
  "actualDistanceMi":   1.81,       // GPS truth, NOT prescribed · nullable
  "avgHr":              142,        // TRUE AVG · nullable
  "maxHr":              158,        // peak in phase · nullable
  "avgCadence":         174,        // avg spm during phase · nullable
  "completed":          true        // false if runner tapped "End rep" early
}
```

## Semantics that matter for the coach

- `actualPaceSPerMi` and `avgHr` are TRUE averages in build 69+. (Build 68
  used instantaneous snapshots at phase end.) `actual vs target` is now
  meaningful.
- `actualDistanceMi` is GPS truth. For a 1-mile rep where the runner went
  1.02 mi (overshot the heads-up cue), `actualDistanceMi = 1.02`. Compare
  to the prescribed `phases[i].distanceMi` from the WORKOUT payload to
  compute plan-vs-actual delta.
- Recovery phases: `targetPaceSPerMi=null`; `actualPaceSPerMi` may be null
  if GPS coverage <0.02 mi.
- `null` everywhere = data wasn't available. Treat as "no signal," NOT zero.

## Coach analytical surface (what the post-run brief can compute)

- Rep-pace consistency: stddev of `actualPaceSPerMi` across work reps.
  Tight clustering = strong execution.
- Pace drift across reps: rep 1 vs rep N.
- HR drift: `avgHr` trend across same-pace reps. Up = aerobic stress
  accumulating.
- Plan-vs-actual distance per phase.
- Cadence stability across reps. Final-rep drop = form breaking down.
- Recovery quality: `avgHr` during recovery — did HR drop enough?

## Backend ingest path

`POST /api/watch/workouts/complete` (web-v2/app/api/watch/workouts/complete/route.ts):

- Idempotent on `workoutId`.
- Persists the full payload as a `coach_intents` row with
  `reason='watch_completion'`, `field=workoutId`, `value=JSON.stringify(body)`.
- Calls `bustBriefingCache(userId)` so the next /api/briefing fetch
  regenerates the post-run brief.

## Coach access path

`getWorkoutCompletion({ workoutId? })` tool (web-v2/lib/coach/tools.ts):

- Returns the parsed WatchCompletion shape above.
- If `workoutId` is omitted, returns the latest completion for the user.
- If no completion logged: `{ completion: null, note: '...' }`.

## TODOs

- P20 (next): migrate to a dedicated `workout_completions` table with
  per-phase rows. coach_intents was the P1.5 stub; structured columns
  beat JSON blobs for future analytics tools (avg pace drift per session
  type over 30 days, etc.).
- Strava-push integration (when the eventual auto-push toggle ships) reads
  from the same `workout_completions` table.

## Canonical Swift definitions

`legacy/native/Faff/FaffWatch Watch App/WatchWorkoutModels.swift` —
`WatchCompletionPhase` + `WatchCompletion` structs. Phone-side TS decoder
must match field-for-field. JSONEncoder default settings (no date
strategy override — ISO-8601 strings, not Date).
