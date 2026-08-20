# faff.run iPhone v5 — the build

The approved design is `reference/README-v5-handoff.md`. The prototype's source
is `reference/Faff-iPhone-App.dc.html`, split per screen under
`reference/screens/`. Its design-system bundle (`_ds/`, `support.js`) was not
shipped with the handoff, so **the prototype does not render** — its source is
the reference, exactly as its own README says ("view source for exact
markup/CSS per screen if a measurement above is ambiguous").

`docs/faff-iphone-design-contract.md` is what the backend can feed and the
rules the design cannot break.

Brief v2 (`Design/running-app-design-brief-v2.md`) governs **web and watch
only**. It forbids orange; the phone's accent is orange. The v5 design wins on
the phone and is not to be reconciled against it.

---

## The four rules

Every screen, every component, every agent prompt carries these verbatim.

**1 · A modelled number must never look measured.** The one real sin. Amber `~`
immediately before the value is the mark, and it is a system rule, not one
screen's fix. The engine flags every case in its payloads.

**2 · One signal never changes a session.** Readiness needs three independent
domains to converge before it can downgrade anything, and that is a build gate.
Any copy about a changed session names the convergence, never a single cause.

**3 · A refusal is a correct answer, not an empty state.** The engine declines
on purpose — a week that cannot carry quality, a distance not planned, a goal
out of reach, a change-the-plan scenario that cannot be satisfied. These must
not look like the data-outage screen, which means *we could not read this*. A
refusal means *we read it and the answer is no*.

**4 · Coach voice.** Short, direct. No hype, no exclamation marks, no emoji, no
em dashes. Never scold.

### How the code enforces them

| Rule | Enforcement |
|---|---|
| 1 | `FaffValue` has no untyped initialiser. Every component that shows a number takes one. `scripts/check-modelled-mark.sh` fails the build on a bare modelled field. |
| 2 | `ConvergenceList` renders nothing below three domains. The engine gates the downgrade itself. |
| 3 | Three components, three jobs: `Alert` (the answer is no), `ErrorNote` (we could not read this), `Silence` (nothing honest to say). Never swap them. |
| 4 | Copy review. No component styles its way out of bad copy. |

---

## Scope

**Race-mode only.** A runner with a goal race. Coached runners, just-run
runners and distance-goal-without-a-race work end to end in the backend and get
**no phone screens** — they get a graceful "not on phone yet". A refusal, not
three blank screens.

Destinations: **Today · Block · Races**, plus the **RUN** pill. Everything else
is reached from those.

---

## The design system

`native-v2/Faff/Faff/DesignV5/`

| File | What |
|---|---|
| `TokensV5.swift` | The prototype's CSS custom properties, one-for-one. Paint from here, never a hex. |
| `ValuesV5.swift` | `FaffValue` / `FaffValueText` / `FaffFmt`. Rule one as a type. |
| `PanelV5.swift` | `DayPanel`, `PanelStatPlate`, the oklab ramp, the grain. |
| `ComponentsV5.swift` | `AppBar` `ListGroup` `ListRow` `ExpandingRow` `CoachSay` `CoachCaveat` `Alert` `ErrorNote` `Skeleton` `Silence` `FaffButton` `FaffSwitch` `FaffRadio` `FaffSelect` `FaffStepper` `FaffInput` `LogEntry` `V5SheetHost` `Tile` `V5SectionLabel` |
| `ChartsV5.swift` | `RangeScale` `ZoneBar` `TrendBars` `PhaseBar` `ElevationProfile` `DualPoint` `WeekStripV5` `WeekShape` `ConvergenceList` |

`ThemeV5.swift` holds the raw CI-locked palette. `FontsV5.swift` holds the two
faces.

**Never call `Font.custom` for the display face.** Archivo wght 800 / wdth 112
is not a named instance, so `Font.custom("Archivo-ExtraBold", …)` returns the
right weight at the wrong width and looks almost correct. Use
`Font.faffDisplay(_:)` and `Font.faffText(_:weight:width:tabular:)`.

---

## Contracts that must not move

- **The watch wire is frozen.** `WatchCompletion` is camelCase with no
  `CodingKeys`. A snake_case typo once silently dropped every GPS track.
- **One row per plan date**, by convention and a lint test. A plan day carries a
  server id — use it as the SwiftUI identity, not the date. The date is a
  lookup, not an identity.
- **Every plan mutation goes through the backend's `mutatePlan` boundary.** A
  source scan fails the build if a writer bypasses it. The phone calls
  endpoints; it does not write plans.

## Two limits the design does not account for

- **Phone run recording is foreground-only.** Confirmed in
  `PhoneRunTracker.swift`: `allowsBackgroundLocationUpdates = false`, no
  background mode. A phone in a pocket with the screen off stops the run. Say
  so where the runner chooses to start one.
- **The treadmill HEART tile has no source without a watch on the wrist.** It
  needs a no-heart layout, not a zero.

---

## Machinery to call, not rebuild

| Need | Call |
|---|---|
| GET | `API.authedGET(url)` → `(Data, HTTPURLResponse)` |
| POST/PATCH | `API.authedSend(request)` |
| 401 | Nothing. `API` posts `.faffSessionExpired`; the root gate reacts. |
| Base URL | `API.baseURL` (`https://www.faff.run`) |
| First paint with no reflow | `AppCache.read(.key, as: T.self)` — synchronous. Seed `@State` at declaration, then `.task` refetches. This is how a screen reserves its exact final height. |
| Numbers that survive Postgres NUMERIC | `FlexibleDouble`, `decodeFlexInt` |
| Run recording | `PhoneRunTracker` (foreground-only) |
| Treadmill HR | `TreadmillHRStreamer` |
| Route map | `RouteMapView(coords:splits:phases:effort:hrZones:showLabels:)` — CartoDB dark tiles + pace gradient. Do NOT revert to the Apple basemap. |
| Watch push | `WatchSync.pushTodayToWatch()` |
| Units | `Units.formatPace`, `Units.formatDistance` (or `FaffFmt` for v5 registers) |
| Sign out | `SessionHygiene.signOut()` and nothing else |
| RUN pill gate | `SettingsCache.shared.read().settings?.phoneRunEnabled ?? true` |

---

## Verification

`swiftc -typecheck` against the simulator SDK is the fast loop:

```bash
cd native-v2 && xcrun swiftc -typecheck \
  -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" \
  -target arm64-apple-ios17.0-simulator \
  $(find Faff/Faff -name '*.swift' ! -name '._*')
```

`/Volumes/WP` is not APFS, so an AppleDouble `._*` shadow sits beside every
source file and fails with "invalid character in source file". **Always exclude
`._*`.** The real file count is 101, not 202.

Backend baseline that must stay green: `npx tsc --noEmit`,
`bash scripts/check-doctrine.sh`, `npx vitest run lib/ --maxWorkers=4`,
`npx vitest run lib/plan/_sweep_allusers.test.ts` at FIRM 0 / WARN 0.

Ten QA accounts exist in production (`qa-*-20260819-1231@faff.run`). Never touch
`dnitch85@me.com` or `apple-review@faff.run`. Delete nothing.

---

## Backend gaps found by audit

Verified against the route handlers, not the contract's claims.

| # | Gap | Needed for |
|---|---|---|
| B1 | The 59-session workout catalogue is generation-time only; no route serves `loadAllWorkouts()`. | Block's library |
| B2 | No write path for race representativeness. The tier is computed from splits/weather and a runner cannot answer "did this race count?". | 18a's confirm |
| B3 | The convergence verdict is computed at 03:00 and discarded; only a prose sentence survives, on the training surface. | 17a's "what converged" |
| B4 | The downgrade never writes `original_type`, so `adaptation.originalType` is null for exactly the mutation 17a is about. And nothing carries it to the Today surface. | 17a's kicker |
| B5 | The Races trigger axis (8 discrete events) has no backend representation at all. | 7a's card shape |
| B6 | The projected-finish series is loaded but not returned. | 7a's trend chart |
| B7 | No evidence list of the races that count toward the read. | 7a |
| B8 | Per-zone pace re-anchor: only a single threshold pace is computed and it is discarded. No evidence assembler. | 18a |
| B9 | The 8-stage walk-run ladder is prose in `sub_label`; no stage number, no ladder check-in endpoint. | 19a |
| B10 | No live "week off" signal. `DayState` has no such state. | 14a |
| B11 | No taper-progress figure. | 8a |
| B12 | Treadmill speed/incline are written but never surfaced on run detail. | 5c |
| B13 | Injury is not on the Today surface; `GlanceState` has no `activeInjury`. | 13a |
| B14 | No gear plan. | 8a |

The contract for each is defined on the phone first (`API+V5.swift`), then
implemented to that contract on the server. A screen is never blocked on a
route: it decodes the contract, and until the route exists it takes the
`unreadable` / `Silence` path the design already specifies.
