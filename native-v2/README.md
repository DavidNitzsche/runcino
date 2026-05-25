# faff.run · native-v2 (SwiftUI)

Replacement for the iPhone app at `legacy/native/Faff/Faff/`. Built against
the deck at `docs/coach/mockups/deck-v1-2026-05-25.html` — same design
system as `web-v2`, just rendered with SwiftUI.

## ⚠️ Watch app is OUT OF SCOPE

The watch app (`legacy/native/Faff/FaffWatch Watch App/`) stays as-is.
**Do not rebuild it.** native-v2's only obligation is to speak its existing
wire format (`applicationContext` keys + `WatchWorkout` JSON shape).

See `docs/coach/WATCH_CONTRACT.md` for the frozen contract and v2's
obligations (P1.5 in the task list).

## Current state

**Phase 0 scaffold.** Source files exist (Theme, Fonts, API, models, view
stubs) but no Xcode project yet — the legacy project at
`legacy/native/Faff/Faff.xcodeproj` is the current TestFlight target.

P0.3a (this commit): Swift source structure laid out.
P0.3b (next): generate Xcode project (XcodeGen recommended) so these
files compile into a new app target.

## Tree

```
native-v2/Faff/Faff/
  FaffApp.swift           @main + RootTabView (5 tabs)
  Theme.swift             design tokens (matches web-v2/app/globals.css)
  Fonts.swift             Bebas Neue + Inter wrappers
  API.swift               briefing + check-in + profile-update client
  Models/
    Briefing.swift        wire types matching /api/briefing response
  Views/
    TodayView.swift       P1 — loads briefing from API
    TrainingView.swift    P3 scaffold
    RacesView.swift       P3 scaffold
    HealthView.swift      P4 scaffold
    ProfileView.swift     P4 scaffold
  Components/             (P1+ — shared card primitives)
```

## Generating the Xcode project

Recommend [XcodeGen](https://github.com/yonaskolb/XcodeGen):

```bash
brew install xcodegen
cd native-v2
xcodegen generate   # uses project.yml (to be added in P0.3b)
open Faff.xcodeproj
```

Until P0.3b, you can manually create a new iOS app project in Xcode and
add the `Faff/` source files as references.

## TestFlight

Will follow `legacy/native` patterns. `scripts/ship-testflight.sh` will
be ported to target `native-v2/` once we cut over.
