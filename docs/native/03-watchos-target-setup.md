# Adding the watchOS target to the Faff Xcode project

When ready to start watchOS development (after iPhone bridge v0 runs
end-to-end), David needs to add a watchOS app target to the existing
Xcode project.  This is a one-time setup task; the actual watch app
code lives in a new folder alongside the iOS target.

**Why a docs page**: claude can't drive Xcode's GUI.  Adding a target
requires interactive clicks in Xcode's "New Target" wizard.  This
doc is the recipe; David executes once, then claude resumes writing
Swift.

## When to do this

After:
- iPhone bridge v0 builds + runs successfully (verified end-to-end)
- Railway is back so we can confirm the backend contracts work
- iOS 26.5 simulator runtime is downloaded

NOT before · adding the watch target while the iPhone bridge is
still unverified just creates more surface area to debug at once.

## The recipe

### Step 1 · File → New → Target

In Xcode menu bar:
1. **File** → **New** → **Target...**
2. Pick **watchOS** in the platform tabs at the top
3. Pick **App** (not "App for iOS App" — that's the legacy embedded
   pattern; we want a modern single-target watchOS app companion)
4. Click **Next**

### Step 2 · Target options

| Field | Value | Notes |
|---|---|---|
| Product Name | `FaffWatch` | Internal target name, NOT user-facing app name |
| Team | David Nitzsche | Should auto-populate |
| Organization Identifier | `run.faff` | Same as iOS target |
| Bundle Identifier | (auto) `run.faff.FaffWatch` | **Override to `run.faff.app.watchkitapp`** to match the App ID we'll auto-register via Xcode |
| Interface | **SwiftUI** | Same as iOS target |
| Language | **Swift** | Same as iOS target |
| Include Notification Scene | ❌ unchecked | Deferred per scoping doc |
| Include Complication | ❌ unchecked | Deferred per scoping doc |

Click **Finish**.

Xcode prompts: **"Activate FaffWatch scheme?"** → Click **Activate**.

### Step 3 · Verify the project structure

After the target is added, the left sidebar should show:

```
Faff (project root)
├── Faff           (iOS target folder — existing)
│   ├── API.swift, ContentView.swift, ... etc
├── FaffWatch      (watchOS target folder — NEW)
│   ├── FaffWatchApp.swift   (auto-generated entry point)
│   ├── ContentView.swift    (auto-generated Hello World)
│   └── Assets.xcassets/
├── FaffTests
├── FaffUITests
```

The synchronized-folders behavior applies to FaffWatch too · any
Swift file claude writes into the `FaffWatch/` folder gets picked
up automatically.

### Step 4 · Add capabilities to the watch target

Same pattern as the iOS target.  Click the top-level `Faff` project,
then select the **FaffWatch** target, then **Signing & Capabilities**
tab.

Add:
- **HealthKit** (no sub-options needed for the watch target · the iOS
  target already declares the usage descriptions; the watch inherits)
- **App Groups** → tick the existing `group.run.faff.app` checkbox
- **Background Modes** → check **Workout processing** (the
  watch-specific background mode that lets HKWorkoutSession run when
  the wrist is down)

Don't add:
- Sign in with Apple (the iPhone holds the auth; watch trusts paired iPhone)
- Push Notifications (deferred per scoping)
- Location (deferred · we're not doing Maps in v1)

### Step 5 · Verify build

Hit **⌘B**.  Both targets should build clean.

If you see a `WCSession` or `WatchConnectivity` import error · that
comes later when we add the actual sync code.  Empty FaffWatch
target should build with no issues.

### Step 6 · Commit + push

Once the target is added and building, the project.pbxproj gets
substantial new content (target definitions, build phases, capability
entitlements).  Commit the changes:

```bash
cd "/Volumes/WP/06 Claude Code/Runcino"
git add native/
git status   # confirm: FaffWatch/ + project.pbxproj changes
git commit -m "Native · add FaffWatch watchOS target (companion app)"
git push origin main
```

After this commit lands, claude can write Swift into
`native/Faff/FaffWatch/` and it'll be part of the watch target
automatically (synchronized folder pattern).

## What comes next in code

Per the watchOS scoping doc (`01-watchos-scoping.md`), build order
from step 3:

  3. Watch UI shell + state machine (timer-driven · simulator-testable)
  4. HKWorkoutSession integration (requires physical Apple Watch)
  5. Transition haptics (requires physical device for timing)
  6. HealthKit completion writeback
  7. TestFlight build · real run validation

Claude writes steps 3-6 in Swift.  Step 7 is a David action (Xcode
Archive → Distribute → upload to App Store Connect, then TestFlight
internal install).

## Notes for claude (next-session pickup)

- `FaffWatch` target uses the same App Group (`group.run.faff.app`) as
  the iOS target — they share UserDefaults via the suite name
  `group.run.faff.app` for any data that needs to round-trip
- `WCSession` is the framework for iPhone ↔ Watch message passing
- Workout payload sent from iPhone to Watch is the same `WatchWorkout`
  shape defined in `Faff/API.swift` — reuse the type via a shared
  module or duplicate the Codable struct in the watch target (v0
  duplication is fine; consolidate later)
- The iPhone bridge needs a new screen (or augmented TodayView) to
  trigger "push to watch" on demand AND nightly via a background task

## Open issue · iOS Target name "Faff" vs Bundle "run.faff.app"

Reminder: the iOS app's product name is `Faff` (Xcode project label),
its bundle ID is `run.faff.app`, and its App Store display name is
`faff.run` (entered in App Store Connect).  Three names, three
contexts.  Same will apply to the watch target:

- Product name: `FaffWatch` (internal)
- Bundle ID: `run.faff.app.watchkitapp` (Apple-required suffix pattern)
- Display name on the Apple Watch home screen: `Faff` (set in
  Info.plist via `INFOPLIST_KEY_CFBundleDisplayName` or similar)

The watch screen is small · `Faff` (4 chars) fits cleanly.
