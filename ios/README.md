# Runcino iOS — Xcode setup

Swift source files are in `ios/Runcino/`. This README is the 15-minute
Xcode setup you'll do on your Mac.

## Prerequisites

- Xcode 15 or later (iOS 17 SDK)
- An Apple Developer account (free tier OK for personal sideload)
- An iPhone paired with an Apple Watch (watchOS 10+)

## Create the project

1. **File → New → Project → iOS → App**
2. Settings:
   - Product Name: `Runcino`
   - Team: your personal team
   - Bundle Identifier: `com.davidnitzsche.runcino`
   - Interface: **SwiftUI**
   - Language: **Swift**
   - Testing System: None (we'll add later)
   - Storage: None
3. Save in a new directory outside the repo (Xcode projects tend to
   pollute with `xcuserdata`, `DerivedData`, etc.). Or save inside `ios/`
   and let `.gitignore` handle the noise.

## Drag in the source files

In Finder, open `ios/Runcino/`. Drag these files into the Xcode project
navigator, checking "Copy items if needed" **off** (we want Xcode to
reference them in place, so the repo is the source of truth):

- `RuncinoApp.swift` — replaces the default @main entry
- `Models/RuncinoPlan.swift`
- `Views/ContentView.swift` — delete Xcode's default `ContentView.swift` first
- `Views/ImportView.swift`
- `Views/PlanView.swift`
- `Workout/WorkoutBuilder.swift`

When prompted, add them to the `Runcino` target.

## Replace Info.plist

Xcode 15+ generates Info.plist from target settings by default. Two options:

**Option A (simplest):** in Target → Info tab, add each key from
`ios/Runcino/Resources/Info.plist` (UTExportedTypeDeclarations,
CFBundleDocumentTypes, NSHealthShareUsageDescription, etc.).

**Option B (repo-sourced):** in Target → Build Settings, set
`Generate Info.plist File = No` and set `Info.plist File = ios/Runcino/Resources/Info.plist`.
Then delete any generated Info.plist from the project.

## Add capabilities

In the target's **Signing & Capabilities** tab, hit `+ Capability`:

- **WorkoutKit** (required — this is what syncs workouts to the Watch)
- **HealthKit** (placeholder for M1; we don't actually read Health yet
  but adding the entitlement now avoids a resign later)

## Run it

1. Plug in your iPhone, select it as the run target
2. Sign in to Xcode with your Apple ID if you haven't
3. Hit ⌘R
4. First launch will fail with a signing error — go to Settings →
   General → VPN & Device Management and trust your developer profile

## Import a plan

1. On your Mac, run the web app: `cd web && npm run dev`
2. Build a plan on http://localhost:3000, download the `.runcino.json`
3. AirDrop it to your iPhone
4. Tap the AirDrop notification → "Open in Runcino" should appear
5. The plan renders — phases, fueling, landmarks
6. Tap "Add to Apple Watch" — confirm in the native sheet
7. Open the Watch → Workout app → find "Big Sur · 3:50:00" in your
   custom workouts

## What's implemented (M0)

- [x] Codable model for `.runcino.json` v1.1.0
- [x] `.fileImporter` import flow
- [x] Plan view: phases, fueling, landmarks, race-morning brief
- [x] `WorkoutBuilder` maps intervals to `CustomWorkout` with pace alerts
- [x] "Add to Apple Watch" via `WorkoutScheduler.shared.preview()`

## What's stubbed for later

- [ ] HealthKit read (M1)
- [ ] Calendar read (M1)
- [ ] Strava OAuth (M2)
- [ ] Post-race retrospective UI (M1)
- [ ] Custom Watch complication (someday, if needed)

## Known open items on this code

The WorkoutKit API surface has shifted across iOS 17 betas. Specific
lines to double-check against the current SDK:

- `IntervalStep(.work, goal: .distance(Double, .miles), alert: SpeedRangeAlert(...))`
  — verify `SpeedRangeAlert` constructor names match your SDK
- `WorkoutScheduler.shared.preview(workout)` — this is an `async throws` method
- `CustomWorkout(activity: .running, location: .outdoor, ...)` — the
  constructor may throw; already wrapped in `try`

If anything red-lines on first build, the fix is usually a one-line API
rename. Report back and we'll patch.
