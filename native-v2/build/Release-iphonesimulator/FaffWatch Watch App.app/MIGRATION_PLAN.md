# Bringing the locked design into the shipping Faff watch app

> **Premise (revised).** The TestFlight build tracks runs, but its in-run UI
> is unusable. The locked watch-face system we designed in the prototype IS
> the new standard. So this is **not** a surgical tweak — it's a rendering
> replacement. We keep the parts that work (engine, tracker, sync, haptics)
> and swap the faces out for the new ones.

---

## What we keep vs what we replace

| Keep (works today) | Replace (the redesign) |
|---|---|
| `WorkoutEngine.swift` — state machine, transitions, paceZone, planComplete | `WatchFaces.swift` — entire file, gone |
| `WorkoutTracker.swift` — HealthKit / GPS / HR / cadence / distance | `ResponsiveFace.swift` — replaced by `FaceKit.NumberFace` |
| `PhoneSync.swift` — WatchConnectivity in both directions | `WatchTheme.swift` — replaced by `Faff` palette in `FaceKit.swift` |
| `PaceDrift.swift` — drift evaluator | `WatchFixtures.swift` — re-stub once faces stabilise |
| `Haptics.swift` — taps + cues |  |
| `WatchWorkoutModels.swift` — plan shape (extend slightly, see below) |  |
| `ActiveWorkoutView.swift` — keep as the **router**, gut the face calls |  |

The engine's published surface — `state`, `currentIndex`, `phaseElapsedSec`,
`totalElapsedSec`, `isPaused`, `planComplete`, `transition`, `paceZone`,
`paceDeltaSPerMi`, `tracker?.heartRate`, `tracker?.paceSPerMi`,
`tracker?.distanceMi`, `tracker?.cadenceSpm` — is exactly what the new faces
read. No engine API changes required for the visual swap.

---

## The grammar we're enforcing (locked rules)

1. 🟢 **green = live, on target**
2. 🔴 **red = alert, reserved** — off-pace, HR over ceiling, behind goal
3. 🟠 **amber = "act now"** — fuel; pace caution band
4. 🔵 **blue = distance, ALWAYS** — "look for the blue"
5. ⚪ **white = reference / readout** — target, counters, time, HR-in-zone
6. 🟣 **purple = distance past plan**
7. 🟦 **calm blue = recovery / landmark chrome**
8. **No labels.** Position + format + colour carry meaning. Exceptions:
   `REST`/`NEXT`, `WARMUP`/`THEN`, `MILE 7`, `THRESHOLD`, `TODAY COMPLETE`.
9. **Equal vertical spacing** between rows.
10. **Top row clears the OS clock** (width-capped).
11. **Numbers reach the very top** (`.ignoresSafeArea()`).
12. **Long-press → pause.** Anywhere on a workout face.
13. **HR alert override.** When HR > ceiling, snap to red HR row, hold until back.
14. **Bottom counter = "how much of the current thing is left."**

These come from the prototype gallery at
`ios/RuncinoWatch/Sources/Faces.swift` + `FaceKit.swift`. Both files are
production-quality SwiftUI with measured-to-spec layouts — no static prototype
behaviour, they just need plan + live data plugged in.

---

## Drop-in plan

### Step 1 — Bring the new rendering layer over

Copy these files from the prototype worktree into the shipping target:

```
ios/RuncinoWatch/Sources/FaceKit.swift     →  native/Faff/FaffWatch Watch App/FaceKit.swift
ios/RuncinoWatch/Sources/Faces.swift       →  native/Faff/FaffWatch Watch App/Faces.swift
```

Delete (after step 4 lands, not before):
- `WatchFaces.swift`
- `ResponsiveFace.swift`
- `WatchTheme.swift`
- `WatchFixtures.swift` (re-stub for parity tests later)

`FaceKit.swift` ships its own palette (`Faff.live`, `Faff.goal`, `Faff.over`,
`Faff.dist`, `Faff.rest`, `Faff.bonus`, `Faff.muted`, etc.) so we don't need
`WP` or `WatchTheme` anymore. Existing call sites in `ActiveWorkoutView` will
break; that's intentional — they get rewritten in step 2.

### Step 2 — Rewrite `ActiveWorkoutView` as the live-data router

Currently `ActiveWorkoutView` switches on the phase type and renders the old
faces with engine + tracker params. The new version is the same shape, just
calling the new faces:

```swift
// ActiveWorkoutView.body, illustrative
switch engine.currentPhase?.type {
case .warmup:    WarmupFace(distance: trackerMi, then: engine.nextPhase?.label ?? "")
case .work where engine.isRace:
    RaceFace(phase: engine.currentPhase!.label,
             elapsed: PaceFormat.hms(engine.totalElapsedSec),
             livePace: tracker.paceDisplay,
             paceColor: engine.paceZone.faffColor,
             targetPace: PaceFormat.mmss(engine.currentPhase!.targetPaceSPerMi!),
             distanceToGo: engine.distanceToGoMi.map(distString) ?? "—",
             heartRate: tracker.hrDisplay,
             hrOver: engine.hrOverCeiling,
             nextFuel: engine.nextGel.map { "Gel \($0.number) · \(distString($0.toGoMi))" })
case .work:
    WorkIntervalFace(rep: repLabel,
                     livePace: tracker.paceDisplay, paceColor: engine.paceZone.faffColor,
                     targetPace: PaceFormat.mmss(engine.currentPhase!.targetPaceSPerMi!),
                     deltaSec: engine.paceDeltaSPerMi,
                     heartRate: tracker.hrDisplay, hrOver: engine.hrOverCeiling,
                     cadence: tracker.cadenceDisplay,
                     repCounter: engine.phaseCounterDisplay)
case .recovery: RecoveryFace(timeLeft: PaceFormat.clock(engine.phaseRemainingSec),
                             nextTarget: engine.nextPhase?.targetPaceDisplay ?? "")
case .cooldown: CooldownFace(...)
default:        EasyFace(...)   // long runs / steady runs
}
```

The exact prop list per face is in `ios/RuncinoWatch/Sources/Faces.swift`.
Most faces take 3-5 strings + 1-2 colours; they're flat, no state inside.

### Step 3 — Add the missing published bits to `WorkoutEngine`

Two small additions; both are derivations of state the engine already has:

```swift
// in WorkoutEngine
@Published private(set) var hrOverCeiling: Bool = false

// somewhere we subscribe to tracker.heartRate (existing PaceDrift hook works):
let ceiling = workout.hrCeilingBpm ?? 0    // ← add `hrCeilingBpm` to WatchWorkout
hrOverCeiling = (ceiling > 0 && (tracker?.heartRate ?? 0) > ceiling)
```

Add `hrCeilingBpm: Int?` to `WatchWorkout` (Codable, optional — older payloads
still decode). The phone side sends it for easy / Z2 / heat-flag runs.

### Step 4 — Fuel cues work on training runs (not just races)

**This is the user-flagged fix.** Today the engine has two fuel paths:

| Path | Trigger | Currently gated? |
|---|---|---|
| `workout.fueling.atMins[]` | elapsed minutes | **No — fires on any run** ✓ |
| `workout.gelsMi[]` | GPS distance | **Yes — `if isRace`** ✗ |

The second path needs to open up. Edit `WorkoutEngine.tick()`:

```swift
// WAS:
if isRace, let gels = workout.gelsMi {
    for (i, mark) in gels.enumerated() where coveredMi >= mark && !firedGels.contains(i) { ... }
}

// SHOULD BE:
if let gels = workout.gelsMi {        // ← drop `isRace` gate
    for (i, mark) in gels.enumerated() where coveredMi >= mark && !firedGels.contains(i) {
        firedGels.insert(i)
        Haptics.almostDone()
        let label = workout.isRace ? "Gel \(i + 1)" : "Fuel · \(i + 1) of \(gels.count)"
        flash(.fuel(title: label, sub: "+ water"), for: 3)
    }
}
```

That's it — `gelsMi` becomes the canonical distance-anchored fuel list for
**any** workout that ships one, race or training. (The time-anchored
`fueling.atMins` path was already workout-type-agnostic.)

**Plan-side note:** the iOS app already populates `gelsMi` only on races
today. When the training-run fueling work goes in, it should set `gelsMi` for
training runs whose plan calls for distance-anchored gels (long runs of a
certain length / glycogen-depletion sessions / etc.). The watch needs no
further change — it just renders whatever markers the plan ships.

### Step 5 — Long-press to pause

In `ActiveWorkoutView.body` root view modifier:

```swift
.onLongPressGesture(minimumDuration: 0.6) {
    if !engine.isPaused { engine.pause() }
}
```

The existing pause path runs unchanged. The `PauseFace` from `Faces.swift`
already takes an `onResume` closure → wire to `engine.resume()`.

### Step 6 — HR alert override (the snap-to-HR-row behaviour)

When `engine.hrOverCeiling == true` while on an easy / long-run face, the
`EasyFace(hrOver: true)` variant renders red HR in the guardrail slot and
stays put until the flag clears. This is already wired in `Faces.swift` —
just pass the flag down from the router.

---

## Cutover order (low risk → higher)

1. **Bring `FaceKit.swift` + `Faces.swift` in** alongside the existing files
   (no deletions yet). Compile passes; nothing on screen changes because
   nothing calls them yet.
2. **Add `hrOverCeiling` flag + `hrCeilingBpm` field.** Engine + model change,
   no UI yet. Compile passes.
3. **Open the `gelsMi` gate** (drop `if isRace`). Five-line diff. Compile passes.
4. **Rewrite `ActiveWorkoutView`** to call new faces. This is the visible
   moment. Deletes the old face calls. Visual diff on TestFlight is full.
5. **Add long-press → pause** in `ActiveWorkoutView`. One line.
6. **Delete `WatchFaces.swift`, `ResponsiveFace.swift`, `WatchTheme.swift`.**
   Compiles because nothing references them anymore. (Run a grep first.)
7. **New faces** — mile-split takeover (on `WorkoutEvent` lap), today-done
   confirmation, calibrate stepper. These are pure additions; ship them when
   the engine emits the right events.

Each step is independently shippable.

---

## What this plan deliberately doesn't touch

- `WorkoutEngine` state machine (we add `hrOverCeiling`, open one gate, no other changes).
- `WorkoutTracker` / HealthKit / GPS.
- `PhoneSync` / WatchConnectivity / completion writeback.
- Bundle id, signing, TestFlight, entitlements.
- BebasNeue typography — **but**: the new faces use `HelveticaNeue-Bold`
  via the `TightNumber` modifier in `FaceKit.swift`. If you want to keep
  Bebas on device, swap one line: `.font(.custom("HelveticaNeue-Bold", ...))`
  → `.font(.custom("BebasNeue", ...))` inside `TightNumber.body`. (I
  recommend trying Helvetica first — the cap-height crop math is tuned to
  it; Bebas may need its own crop constant.)

---

## QA pass after migration

Per face on a real Apple Watch, eyeball:

- Top row clears the OS clock; clock is fully visible.
- Live pace turns green on target, amber in 11-15 s/mi drift band, red beyond.
- Target reads as **white** (not pace-colored). Distance numbers are **blue**.
- HR row turns red when over ceiling; stays red until back in zone.
- Recovery face counts the rest-bar down; "NEXT" pace is the next work target.
- Long-press pauses from any workout face; Resume from the green oval works.
- Fuel cue fires on a long run that has `fueling` or `gelsMi` in its plan
  (not just on race day).
- Auto-lap fires the mile-split takeover at every mile boundary.
- All existing flows still work: countdown, end-of-plan overtime, abandon,
  summary write-back to phone.

---

## File map after migration

```
native/Faff/FaffWatch Watch App/
├── ActiveWorkoutView.swift     ← rewritten as router (smaller!)
├── ContentView.swift            ← unchanged
├── CountdownView.swift          ← unchanged
├── FaceKit.swift                ← NEW (from prototype)
├── Faces.swift                  ← NEW (from prototype)
├── FaffWatchApp.swift           ← unchanged
├── Haptics.swift                ← unchanged
├── IdleView.swift               ← unchanged (touch up palette tokens)
├── PaceDrift.swift              ← unchanged
├── PhoneSync.swift              ← unchanged
├── ReadinessGlanceView.swift    ← touch up palette tokens
├── SummaryView.swift            ← touch up palette tokens
├── WatchWorkoutModels.swift     ← + `hrCeilingBpm: Int?`
├── WorkoutEngine.swift          ← + `hrOverCeiling`, open `gelsMi` gate
├── WorkoutRootView.swift        ← unchanged
└── WorkoutTracker.swift         ← unchanged

DELETED:
- WatchFaces.swift
- WatchTheme.swift
- ResponsiveFace.swift
- WatchFixtures.swift (re-stub later)
```

Net: **~600 lines deleted, ~900 lines added** (the new faces are heftier
because they encode their own layout math, not because they're more
complicated to use).
