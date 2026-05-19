# watchOS scoping doc · what the watch app actually does

David's framing was: "Pick the minimum viable watch experience.  Spec
it.  Then we can decide whether you build it or whether watchOS
development gets handled differently."

This is that spec.  Read it, push back, approve before any Swift code
gets written.

---

## The one job the watch must do well

**Execute today's structured workout on your wrist.**

Current friction: David reads tomorrow's structured workout (e.g.,
6×800 at 6:31 + 60s recovery) on his phone/laptop, then mentally
translates during the run while watching the watch for pace and HR.
The watch doesn't know what the workout is.

This is the gap.  The watch knowing the structure converts
"interval-counting + clock-math while running hard" into "press
start, run, react to haptic cues."  The cognitive cost shifts from
the runner to the device.

---

## MVP scope · what's in

### 1. Today's workout on the watch, ready to start

- iPhone app fetches today's workout from backend, pushes the
  structured form to the watch via WatchConnectivity
- Watch shows the workout name + summary on its main screen ("6×800
  @ 6:31 · 60s rec") with a "Start" button
- No login on watch; auth happens on iPhone, watch trusts the paired
  iPhone

### 2. Workout execution UI · interval-by-interval

Three UI states during a workout:

**WARMUP / COOLDOWN screen**
```
┌───────────────────┐
│  WARMUP           │
│  2:15 / 10:00     │  ← elapsed / target duration
│                   │
│  7:58/mi          │  ← current pace
│  142 bpm          │  ← current HR
│                   │
│  ────────────●    │  ← progress bar
└───────────────────┘
```

**WORK INTERVAL screen** (the high-stakes one)
```
┌───────────────────┐
│  INTERVAL 3 / 6   │  ← which rep
│  TARGET 6:31      │  ← prescribed pace (big)
│                   │
│  6:34/mi   +3s    │  ← current · delta vs target
│  168 bpm          │
│                   │
│  0:24 / 0:48      │  ← elapsed / target (0.5 mile @ ~6:30)
│  ──────●──────    │
└───────────────────┘
```

**RECOVERY screen**
```
┌───────────────────┐
│  RECOVERY 3/6     │
│  0:18 / 1:00      │  ← count UP through the recovery
│                   │
│  9:20/mi          │  ← no target during recovery
│  155 bpm (cooling)│
│                   │
│  next: Interval 4 │
└───────────────────┘
```

### 3. Transition haptics

- **3 seconds before each work interval ends**: triple-tap haptic +
  "almost done" cue
- **At each transition**: distinct haptic pattern (work→recovery
  different from recovery→work)
- **End of workout**: long haptic + "workout complete" screen

Haptic patterns matter; they're the difference between "I knew it
was time to slow down" and "I overran the interval by 15 seconds."

### 4. Pace-drift feedback (work intervals only)

- Single subtle haptic if current pace deviates >10 s/mi from target
  for >5 consecutive seconds
- No haptic if within ±10 s/mi (the prescribed pace has a tolerance
  band; the watch shouldn't nag inside it)
- Color coding on the pace display: green within band, amber drift,
  red sustained drift >15s/mi

### 5. Manual lap button · "I'm done with this rep early"

The user can tap "End interval" if they need to bail.  Workout
continues with the next phase (usually recovery, then the next work
rep).  Honest data flow: completed rep marked partial, not full.

### 6. Workout completion → backend roundtrip

- End of workout: watch writes an HKWorkout record (standard HealthKit
  workout completion) with custom metadata for per-interval results
- iPhone app picks up the new HKWorkout via HealthKit background
  delivery, POSTs to backend via the HealthKit ingest endpoint
- Backend stores workout completion data; coaching surfaces
  (readiness, Signal 1, V5, etc.) react on next render

---

## What's out (deferred v1+)

| Feature | Why deferred |
|---|---|
| Standalone watch (without iPhone) | watchOS standalone needs its own auth + sync layer · adds 2-3 weeks · MVP is companion |
| HR zone targeting on watch | Pace targeting is the primary signal · HR is secondary · defer |
| Race-day pacing strategy | Real-time race-day pacing is a separate UX problem · defer |
| Workout substitutions on watch | Substitutions need the menu UI · doesn't fit watch screen ergonomics · do it on iPhone before the run |
| Coach voice / cross-references on watch | Watch is execution; coaching voice is for reflection · deliberately absent |
| Maps / route display | Apple's native Workout app already does this · don't reinvent |
| Music control during workout | Use existing watchOS controls; not Runcino's job |
| Manual workout entry on watch | iPhone has the screen real estate · do it there |

This list is long on purpose · the MVP is small and the deferred list
gives clear next-arc material.

---

## Architecture · companion app

### Frameworks used

- **SwiftUI** (watchOS 11) · UI layer
- **HKWorkoutSession** + **HKLiveWorkoutBuilder** · running the
  workout in the background while the watch screen is off
- **WatchConnectivity** (WCSession) · iPhone ↔ Watch data sync
- **HealthKit** · read live HR · write completed workout

### Data flow

```
                  ┌─────────────────────────┐
                  │  Backend (Runcino API)  │
                  └─────┬─────────────┬─────┘
                        │             │
                    GET workout    POST completion
                        │             │
                  ┌─────▼─────────────┴─────┐
                  │   iPhone Runcino app    │
                  │   · auth token holder   │
                  │   · backend bridge      │
                  │   · HealthKit anchor    │
                  └────────┬───────────────▲┘
                           │               │
                  WCSession push       HealthKit
                  (workout struct)     workout record
                           │               │
                  ┌────────▼───────────────┴┐
                  │  watchOS Runcino app    │
                  │  · runs workout         │
                  │  · live HR + pace       │
                  │  · transition haptics   │
                  └─────────────────────────┘
```

The iPhone is the bridge.  Watch trusts iPhone, iPhone holds the
auth token, backend talks only to iPhone.  This is the canonical
companion-app pattern; well-trodden by Apple's own Workout app.

### Workout state machine on the watch

```
                   IDLE
                    │ Start button
                    ▼
                  WARMUP
                    │ (timer expires)
                    ▼
              INTERVAL[1..N] ─→ RECOVERY ─→ INTERVAL[2..N]
                                                │
                                               ...
                                                ▼
                                            COOLDOWN
                                                │ timer expires
                                                ▼
                                            SUMMARY
                                                │ Save button
                                                ▼
                                              IDLE
```

Each transition triggers a haptic.  The user can override (tap
"End interval" → skip ahead) but the state machine flows forward
only; no backward jumps.

---

## Workout-to-watch payload shape

The new backend endpoint (`GET /api/watch/today` per the reframed
priority order) returns this shape.  Designed for watchOS direct
consumption — no further parsing required:

```json
{
  "workoutId": "2026-05-20-threshold",
  "name": "6×800 @ T-pace",
  "summary": "6×800 @ 6:31 · 60s rec",
  "totalEstimatedMinutes": 52,
  "phases": [
    {
      "type": "warmup",
      "label": "Warmup",
      "durationSec": 600,
      "targetPaceSPerMi": null,
      "haptic": "start"
    },
    {
      "type": "work",
      "label": "Interval 1/6",
      "durationSec": 192,
      "targetPaceSPerMi": 391,
      "tolerancePaceSPerMi": 10,
      "haptic": "transition-work"
    },
    {
      "type": "recovery",
      "label": "Recovery 1/6",
      "durationSec": 60,
      "targetPaceSPerMi": null,
      "haptic": "transition-recovery"
    },
    // ... 5 more work + recovery pairs ...
    {
      "type": "cooldown",
      "label": "Cooldown",
      "durationSec": 600,
      "targetPaceSPerMi": null,
      "haptic": "transition-cooldown"
    }
  ],
  "completionEndpoint": "/api/watch/workouts/complete",
  "expiresAt": "2026-05-21T08:00:00Z"
}
```

Flat array of phases is intentional · no nested intervals · watchOS
state machine is a simple cursor walking the array.  Each phase has
everything the watch needs to render + drive transitions.

---

## Honest constraints · what I can and cannot do

### What I can do credibly

- Write SwiftUI for watchOS · I know the framework patterns
- Write the HKWorkoutSession boilerplate · well-documented Apple flow
- Write WatchConnectivity message passing · standard
- Design the data shape on the backend side · familiar
- Write the iPhone bridge code (WCSession sender, HealthKit ingest)
- Write XCTest unit tests for non-UI logic (pace deltas, state
  machine transitions)
- Read Apple's docs + Sample Code

### What I cannot do

- **Test on a physical Apple Watch.**  This is the biggest constraint.
  Sensor reliability, GPS lock, background execution behavior,
  haptic timing — none of these are testable without hardware.
  Simulator can prove UI rendering and state machine logic but not
  workout-session reliability.

- **Verify HealthKit permission flows.**  HealthKit permission
  prompts only fire on real devices · simulator behavior diverges.

- **Profile battery usage during a real workout.**  HKWorkoutSession
  + GPS + screen-on is the watch's worst-case battery scenario; only
  measurable on-device.

- **Debug "app got killed mid-workout" failures.**  These are real
  watchOS landmines that show up in production · I can write
  defensive code but not reproduce the failure mode.

- **Submit to App Store · only David can.**

### Required for David before code starts running

- A physical Apple Watch (which David has)
- A paired iPhone (which David has)
- A Mac with Xcode (which David has per Step 3 of practical setup)
- Apple Developer enrollment complete (per Step 2)

---

## Known landmines · plan to mitigate, not avoid

### 1. HKWorkoutSession gets killed in low-power mode
**Mitigation**: rely on HealthKit's auto-resume + checkpoint state
to UserDefaults every 30 seconds · resume from last checkpoint if
session restarts.

### 2. WatchConnectivity is "eventually consistent"
**Mitigation**: design the workout-to-watch sync to tolerate
arrival lag · pre-cache today's workout the night before · don't
rely on real-time push at workout start time.

### 3. GPS lock can take 30+ seconds at the start of an outdoor run
**Mitigation**: warmup phase usually covers GPS lock time · use
pedometer-derived pace as fallback for first 30s if GPS not locked.

### 4. App Store review for HealthKit is finicky
**Mitigation**: usage descriptions specific + truthful · expect 1
re-review cycle on first submission · build in time.

### 5. Companion-only architecture means iPhone-in-pocket assumption
**Mitigation**: documented v1 constraint · standalone watch is the
clean v2 upgrade path · the pattern is well-trodden.

### 6. watchOS battery drain during long workouts
**Mitigation**: screen-off when wrist is down (default behavior),
sensor sampling rate appropriate to workout type, defer GPS-heavy
features to later versions.

---

## Suggested build order (if approved)

1. **Backend · workout-to-watch endpoint first.**
   - `GET /api/watch/today` returns the JSON shape above
   - Pulled from same data path that powers `/overview` TodayCard
   - Token-auth required (per Step 1 of reframed priorities)
   - Test with curl before any watch code

2. **iPhone bridge · workout fetch + watch push.**
   - SwiftUI app, single screen "Today's workout · sent to watch"
   - WCSession sends the workout payload to the watch on demand
   - Background fetch overnight pre-caches tomorrow's

3. **Watch app · UI shell + state machine.**
   - SwiftUI views for IDLE / WARMUP / INTERVAL / RECOVERY / COOLDOWN / SUMMARY
   - State machine walks phases array
   - No HKWorkoutSession yet · just timers · validates UI flow
   - Testable in simulator

4. **Watch app · HKWorkoutSession integration.**
   - Replace timer-driven state with HKLiveWorkoutBuilder
   - Add HR + pace sampling
   - **Requires physical Apple Watch to verify**
   - Most likely point where I need David's hands-on testing

5. **Watch app · transition haptics.**
   - Audio + haptic feedback at transitions
   - Requires physical device for timing validation

6. **HealthKit completion writeback.**
   - End-of-workout HKWorkout sample with custom metadata
   - iPhone picks up via HealthKit observer + POSTs to backend
   - Validates end-to-end data round-trip

7. **TestFlight build to David's devices.**
   - Real run · real validation
   - Iterate based on actual workout experience

Estimated calendar time: **3-4 weeks of focused work**, blocked
periodically on David's device-testing turnaround.

---

## Decision points for David

1. **Approve / push back on the MVP scope.**  Is "6 features in, 8
   features deferred" the right cut?  Want anything added or pulled?

2. **Bundle ID for watchOS app.**  Per Step 4 of practical setup,
   pick the parent bundle ID name.

3. **iPhone bridge UI scope.**  v0 can be one screen ("Today's
   workout · push to watch") or a full TodayCard equivalent.  My
   recommendation: one-screen v0, full bridge in v1.

4. **Standalone watch on the v2 roadmap?**  Affects how much
   auth-on-watch infrastructure to lay foundation for now.  My
   recommendation: defer entirely · v1 is companion-only.

5. **Should the watch surface coaching cross-references (V7)?**
   My strong recommendation: **no**.  Watch is for execution;
   coaching voice is for reflection.  Don't dilute the watch's job.

Once decision points are settled, I can start the backend
workout-to-watch endpoint while practical-setup propagation
finishes.  No watchOS code starts until David explicitly approves
this doc.
