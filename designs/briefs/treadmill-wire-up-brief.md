# Brief · TreadmillView · wire-up to plan + completion ingest

**For:** next iPhone agent session (self-brief)
**From:** iPhone agent (2026-06-01)
**Status:** Open · Treadmill picker option ships in build 135 with the
visual stub. Wire-up scheduled for build 136.

---

## Why

The Today Start-Run picker now exposes two options:

- **Outdoor · Apple Watch** → `WatchMirrorView` · live-mirrors the
  Faff Watch app, completion POST handled by the watch (existing,
  works end-to-end)
- **Treadmill** → `TreadmillView` · **currently a visual stub** ·
  hardcoded 4-interval session, no plan read, no runner input, no
  completion POST, nothing persists

A runner who taps Treadmill today:

1. Sees a prototype session (5.5/7.0/5.0 mph, not their plan)
2. Watches the timer animate
3. Hits the back chip
4. Nothing landed in the runs table · the workout never happened
   as far as the coach is concerned

This brief covers the five pieces needed to make Treadmill a real
session-logging surface.

---

## 1 · Read today's actual plan

Replace the hardcoded `segments` array with phases derived from
`WatchWorkout.phases` (same source the pre-run sheet already reads).

```swift
// TodayView already fetches displayWorkout · pass it in:
TreadmillView(planned: displayWorkout)

// Inside TreadmillView, derive segments from planned.phases:
//   warmup phase  → TreadSeg(kind: .warm, dur: phase.duration, ...)
//   work phases   → TreadSeg(kind: .work, ...)
//   recovery jogs → TreadSeg(kind: .rec, ...)
//   cooldown      → TreadSeg(kind: .cool, ...)
```

When `planned == nil` (rest day · just-run · no plan loaded yet),
fall back to a single "open run" segment with no preset target ·
runner just logs total time + distance at the end.

---

## 2 · Runner input · speed + incline per segment

Treadmills vary wildly (gym machines, home decks, factory presets).
We can't read speed/incline over Bluetooth across all hardware ·
the runner is the source of truth.

UX:

- Each segment shows the planned mph (from the plan's target pace
  converted to mph) and the planned incline (default 1.0% per Daniels
  "treadmill-vs-outdoor equivalence" rule).
- Two steppers below the live counter: **speed (±0.1 mph)** and
  **incline (±0.5%)**. Defaults to the plan's target; runner adjusts
  to match what they actually set on the treadmill.
- "Next segment" button advances · captures the runner's final
  speed/incline for that segment into per-phase actuals.
- Skip / pause work the same as outdoor watch · per-phase
  `completed: bool` lands in the payload.

---

## 3 · Live HR from HK (optional)

Apple Watch streams `HKQuantityType(.heartRate)` to the phone during
a workout session. If the runner is wearing the watch on the
treadmill (most do), pull live HR via `HKAnchoredObjectQuery` and
display it next to the speed counter.

- Hook into `HKHealthStore.execute(query)` on session start
- Append samples to a per-phase HR buffer · `avgHr` / `maxHr` per
  phase get computed at phase end
- Watch users see real-time HR · non-watch users see "—" gracefully

This step is optional for v1 · ship without it if it's blocking. The
completion payload's `avgHr` can be omitted and the backend handles
null already.

---

## 4 · Completion POST · WatchCompletion shape with source='treadmill'

The session-end button POSTs to `/api/watch/workouts/complete`
(same endpoint the watch uses · single ingest path keeps the runs
table consistent). The payload mirrors `WatchCompletion` from the
watch app:

```swift
let payload: [String: Any] = [
    "workoutId": UUID().uuidString,                  // synth · prefix "trd_"
    "startedAt": startTime.iso8601,
    "completedAt": Date().iso8601,
    "status": "completed",                            // or "abandoned" if back-chip-out
    "totalDistanceMi": dist,                          // accumulated from speed × time
    "totalDurationSec": totalSec,
    "avgHr": liveHrBuffer.average,                    // when HK streamed
    "maxHr": liveHrBuffer.max,
    "kcal": estimatedKcal,                            // distance × weight × 1.04 ~estimator
    "source": "treadmill",                            // NEW · backend gates on this
    "indoor": true,                                   // NEW · so resolveRoute knows to skip
    "phases": [
        [
            "label": seg.label,
            "type": "warmup" | "work" | "recovery" | "cooldown",
            "targetPaceSPerMi": planned.targetPaceSPerMi,
            "actualPaceSPerMi": 3600 / (speedMph * 0.0166667),
            "actualSpeedMph": speedMph,
            "actualInclinePct": inclinePct,
            "actualDurationSec": seg.dur,
            "actualDistanceMi": seg.dur / 3600 * speedMph,
            "avgHr": phaseHrBuffer.average,
            "maxHr": phaseHrBuffer.max,
            "completed": seg.completed,
        ],
        ...
    ]
]
```

### Backend ask

`/api/watch/workouts/complete` is source-agnostic today (it doesn't
inspect `body.source`) so this should land in `runs` correctly. Two
things to confirm with backend agent before shipping:

1. **`indoor: true` flag** · pass to `data.indoor` in the row so
   `has_route` correctly returns false and downstream consumers
   (RoutePolylineCard, /races RUNS list, etc.) don't expect GPS data
2. **Per-phase incline** · `actualInclinePct` is new · backend's
   recap/run-state composers may want to surface it ("ran 3 reps at
   7mph / 1.5% incline") · file a follow-up brief when this lands so
   the run-recap composer knows about the field

---

## 5 · UI polish + edge cases

- **Paused mid-session** · timer halts, leftInSeg preserved, runner
  can resume or skip phase
- **Skipped phase** · marks `completed: false` on that phase in the
  payload, segment moves to next
- **Ran short** · runner hits "End now" before all phases done ·
  status='partial', remaining phases marked incomplete
- **Back-chip without ending** · prompt "End workout? (saves progress)
  / Discard?" · prevents accidental data loss
- **No plan loaded** · single open segment, runner logs total +
  speed/incline at the end · still POSTs as a treadmill session

---

## Why ship the stub in build 135 anyway

The picker has the slot for Treadmill · runners who try it today see
a clearly prototype-shaped screen (the segments don't match their
plan, the timer is already running, the back-chip exits cleanly). It
won't pretend to log a session that didn't happen.

The risk is a runner DOES do their treadmill workout while staring
at the stub and expects it to land. Mitigation: build 135 carries a
"Coming soon" badge on the Treadmill menu row would help, but the
ship for 135 was already in flight when this gap surfaced · file a
follow-up if the picker option needs gating.

---

## Files to touch (next session)

- `native-v2/Faff/Faff/Views/TreadmillView.swift` · gut the
  hardcoded segments, accept `planned: WatchWorkout?` param, derive
  segments + targets from the plan
- `native-v2/Faff/Faff/Views/TodayView.swift` · the Menu's Treadmill
  NavigationLink needs `.treadmill(planned: displayWorkout)` instead
  of bare `.treadmill` · add an associated value to the FaffRoute case
- `native-v2/Faff/Faff/Views/RootTabView.swift` · update the
  routeDestination's `.treadmill` arm to pass the workout through
- `native-v2/Faff/Faff/API.swift` (or API+Toolkit) · add
  `postWatchCompletion(payload:)` if not already there · mirrors the
  watch app's POST format
- Backend (separate brief if `indoor: true` needs explicit handling) ·
  confirm `/api/watch/workouts/complete` accepts the treadmill
  payload + writes `data.indoor` for downstream consumers

---

## How to pick this up next session

1. Read this brief
2. Confirm `WatchWorkout.phases` shape with the runner's actual today
   payload (use the smoke session script pattern to fetch
   `/api/watch/today`)
3. Decide HR scope (v1 with HK live, or v1 without · ship as PR1)
4. Build · compile-verify · commit · push
5. Ship build 136 to TestFlight · smoke a real treadmill session
   (David has to actually do one on a treadmill to validate)

---

## Reference

- Outdoor analog: `WatchMirrorView.swift` · live mirror of watch GPS
  run · completion lands via the watch's own POST
- Completion endpoint: `web-v2/app/api/watch/workouts/complete/route.ts`
- Completion payload shape: `legacy/native/Faff/FaffWatch Watch App/WatchWorkoutModels.swift` · `WatchCompletion` struct
- Hardcoded stub it replaces: `native-v2/Faff/Faff/Views/TreadmillView.swift`
