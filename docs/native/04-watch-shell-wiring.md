# Watch UI shell (scoping step 3) — DONE & running

The watch UI shell + state machine is built, wired into the Xcode
project, and **verified running in the watch simulator** (idle → start →
warmup → skip → work interval, clocks and state machine all live).
Timer-driven, no `HKWorkoutSession` yet — that's phase 4 (needs a
physical Apple Watch).

## What was set up

- **Target:** `FaffWatch Watch App`, added via Xcode's New Target wizard
  as **"Watch App for Existing iOS App"** (companion to the Faff iOS
  app — standalone is deferred per the scoping doc).
- **Source folder:** `native/Faff/FaffWatch Watch App/` (synchronized
  folder — drop `.swift` files in, Xcode picks them up).
- **Entry point:** the wizard's `FaffWatchApp.swift` (`@main`) is
  unchanged; the wizard's `ContentView.swift` body was pointed at
  `WorkoutRootView()`.

## Files in the target

| File | Role |
|---|---|
| `WatchWorkoutModels.swift` | Codable models (incoming `WatchWorkout` mirrors `GET /api/watch/today`; outgoing `WatchCompletion` mirrors `POST /api/watch/workouts/complete`), `.sample` workout, pace formatters |
| `WorkoutEngine.swift` | Forward-only state machine · main-actor `Task` loop clock, phase cursor, "end interval" skip, abandon, `completion` payload at finish |
| `Haptics.swift` | `WatchHaptic` cues → `WKInterfaceDevice` haptics (timing tuning is phase 5, on-device) |
| `WorkoutRootView.swift` | Top-level router (IDLE → active → SUMMARY) |
| `IdleView.swift` | Start screen |
| `ActiveWorkoutView.swift` | WARMUP/COOLDOWN, WORK, RECOVERY screens + End interval / End workout |
| `SummaryView.swift` | Per-phase result + Done |

## Verified in the simulator

1. IdleView shows "Threshold · Cruise Intervals · 5×7 min @ 6:31 · 90s
   rec · ≈ 61 min · 11 phases" + green Start. ✓
2. Start → WARMUP, clock counts up, blue progress bar. ✓
3. End interval → jumps to WORK "INTERVAL 1/5 · TARGET 6:31" (orange),
   clock ticking. ✓
4. Phases auto-advance when the clock hits target; SUMMARY lists each
   phase with ✓/✗ + actual duration; Done returns to IDLE.

The sample uses real durations (warmup 10 min, intervals 7 min) — use
**End interval** to step through transitions quickly.

## Known shell limitations (by design)

- **Live pace / HR show "—".** From `HKLiveWorkoutBuilder` in phase 4
  (physical Apple Watch). Clocks, progress, labels, transitions are real.
- **Completion isn't sent anywhere yet.** Displayed locally; the
  `WatchCompletion` shape already matches the backend endpoint, so
  phase-6 writeback is "send this payload up via the iPhone bridge."
- **Workout is the hardcoded sample.** WatchConnectivity (real workout
  push from the iPhone) replaces `WatchWorkout.sample` in a later phase.

## Still to do on the target (before device / TestFlight)

- **Bundle ID:** currently `run.faff.FaffWatch` (wizard default). Change
  to `run.faff.app.watchkitapp` in the target's Signing & Capabilities /
  Build Settings (`PRODUCT_BUNDLE_IDENTIFIER`).
- **Capabilities** (per [03-watchos-target-setup.md](./03-watchos-target-setup.md)
  §4): HealthKit, App Groups (`group.run.faff.app`), Background Modes →
  Workout processing. Not needed for the simulator UI; needed for
  phases 4–6.

## Backend dependency · shipped

`POST /api/watch/workouts/complete`
(`web/app/api/watch/workouts/complete/route.ts` +
`web/lib/watch-completion.ts`) exists and is unit-tested. Every
`GET /api/watch/today` payload advertises it as its `completionEndpoint`.
