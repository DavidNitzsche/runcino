# Watch 0821 · pre-implementation audit

Source of truth: `/Volumes/WP/06 Claude Code/Faff/design/0821/design_handoff_faff_watch_app/`
(`README.md` + `Faff-Watch-App.dc.html`, 53 boards). Read in full 2026-08-21.

**This handoff supersedes** `docs/design/watch/` (WATCH-DESIGN-BRIEF / COLOUR-SPEC /
BUILD-LIST), `docs/watch-design-pass/`, and `Faff Watch · Faces.dc.html` (Watch v2).
None of those should be cited in implementation.

---

## 1 · What already exists on the wrist

`legacy/native/Faff/FaffWatch Watch App/` (symlinked into `native-v2` as the
`FaffWatch Watch App` target). ~430 KB of Swift. This is a **re-skin plus gap-fill**,
not greenfield.

**Keep — the machinery is sound and the design does not change it:**

| File | What it holds |
|---|---|
| `WorkoutEngine.swift` (76 K) | phase cursor, rep counting, boundary cues, HR-ceiling detection, finish segment |
| `WorkoutTracker.swift` (32 K) | HKWorkoutSession, GPS, route builder, cadence (CMPedometer), elevation (barometer), energy |
| `PhoneSync.swift` / `WatchSync.swift` | WCSession bridge **plus** direct-to-backend background upload with a pending queue. Offline-safe. |
| `WatchWorkoutModels.swift` (42 K) | wire model, lenient Int decode, completion payload |
| `WorkoutRootView.swift` | stale-plan gate, crash recovery, countdown |
| `Haptics.swift`, `ChimePlayer.swift` | per-event haptics + audible cues |
| `TreadmillHRSession/View` | treadmill HR bridge |

**Replace — every pixel.** `WatchTheme.swift`, `FaceKit.swift` (30 K), `Faces.swift`
(40 K), `IdleView.swift`, `SummaryView.swift`, `ActiveWorkoutView.swift` (43 K),
`WatchFaces.swift`, `ResponsiveFace.swift`, `PaceDrift.swift` colour mapping.
The existing faces are the brief-v2 language: Bebas/Oswald/Inter, a five-hue metric
palette (`dist` blue `#27B4E0`, `bonus` yellow `#F0DF47`, `warn` pink `#FC4D64`).
The 0821 design bans all of it — four metrics, one left edge, green/amber grading only.

**Concept coverage already present** (behaviour exists, presentation is wrong):
Go · Phase change · Split · Fuel · Heads-up · Paused · Lobby · Complete · Controls ·
Warm-up · Strides · Rest · Countdown · Summary.

---

## 2 · Blocker — the palette CI gate contradicts this design

`scripts/check-palette-sync.sh` is wired into `web-v2` `prebuild`, so it runs on every
Railway build. It pins the watch to brief v2 and **will fail the moment the first board
is built**:

- Line 220-229 assert the exact old hexes: `amber = 0xF3AD38`, `orange = 0xD03F3F`,
  `warn = 0xFC4D64`, `dist = 0x27B4E0`, `bonus = 0xF0DF47`.
- `WATCH_ALLOWED_HEX` (line ~380) is a **positive allowlist**: any `Color(hex:)`
  literal under the watch target not in that list fails CI.

The 0821 design needs: amber `#F2B03C` (≠ `#F3AD38`), fault red `#FF4438`, signal
orange `#FF5A1F`, surface steps `#0F1011 #17191B #212427 #2A2E32`, plus the day-state
gradient stops. It also **deletes** `dist`, `bonus`, `warn` and the `orange = #D03F3F`
race hue. Band green `#3EBD41` is the one value that already matches.

The script's own header says web + watch → brief v2, iPhone → v5. That ruling is now
stale: the watch is being redesigned onto the v5 token family.

**Decision needed (David):** re-point the watch section of `check-palette-sync.sh` at
the 0821 handoff — new lock table, new allowlist, retired-hex entries for the five
deleted hues — exactly as was done for the iPhone at v5. This is a gate rewrite, not a
loosening. Nothing can be built until it is agreed.

Related: brief v2 forbids orange app-wide and forbids green as a grade. The 0821 design
uses both, deliberately, and argues the case (rule 1 — "the watch is the sanctioned
exception"). `CLAUDE.md`'s required-reading section needs the same amendment the iPhone
got: **watch → 0821 handoff; brief v2 governs web only.**

---

## 3 · Backend gaps

`GET /api/watch/today` (`lib/watch/build-workout.ts`) already carries: phases with
target pace + tolerance + rep unit + distance, `hrCeilingBpm`, `isRace`, `goalSec`,
`strategyLabel`, `gelsMi`, `fueling`, `rules` (bail contingencies), `displayHint`,
`unitsDistance`, `readinessScore` / `readinessLabel`. That covers the running faces,
the phase boards, Fuel, the race plan page and the ceiling.

Missing, all **additive**:

| # | Board | Needed | Where it already exists |
|---|---|---|---|
| B1 | Lobby p3 · This week | 7 days as done/today/remaining + `18 of 42 mi` | `lib/plan/week-loader.ts` `loadPlanWeek()` — call it, project it onto the payload |
| B2 | Lobby · the session already moved | the *reason* + prior dose ("Six hours of sleep · was six miles") | `lib/coach/adaptation-info.ts` `AdaptationInfo` (`originalDistanceMi`, `reason`). **Not** `readinessScore` — the design explicitly refuses to show a score |
| B3 | Rest day | reasoned sentence + weekly context ("you ran 34 miles this week and the long one was Sunday") | today's response is a flat `{ message: "Rest day. Recover hard." }` string. Needs a structured rest state |
| B4 | No session | engine's own sentence for off-season / week off / injury / sick + "the block resumes Monday" | `lib/coach/training-state.ts` has the states; nothing reaches the watch |
| B5 | Spoken cue | mid-run coach lines with trigger points | nothing generates these. Needs a small cue list on the payload (text + trigger), obeying the copy rules |
| B6 | Skip confirm | the coach's opinion on skipping *this* rep ("Three are banked · the last three are where the session earns its name") | not generated. Can be composed server-side per session from rep count |
| B7 | Bail offered | evidence line + judgement, separate strings | `rules[].label` exists but is one string. Design wants evidence quiet, judgement in coach register |
| B8 | Notification · yesterday is unread | fires once, one action | APNs infra exists (`lib/notifications/apns.ts`, categories on phone). No such trigger, no watch category |

`POST /api/watch/workouts/complete` carries `ruleOutcomes` — the bail is already
recordable. **Missing wire fields for the other three wrist decisions** the design says
must reach the phone: ceiling lifted, reps skipped (as a *decision*, distinct from
`completed: false`), recoveries extended. All additive, camelCase per the wire contract.

---

## 4 · New Xcode target required

Complications (3 sizes) and the Smart Stack widget need a **WidgetKit extension** on the
watchOS target. `native-v2/project.yml` has no such target and there is no `WidgetKit`
import anywhere in the tree. New target, new bundle id, added to `project.yml` (which
xcodegen regenerates — edits to the generated plists get clobbered).

Watch notifications need a custom long-look interface
(`WKUserNotificationHostingController` + matching `UNNotificationCategory` registered on
the watch). Today the watch mirrors the phone's notifications, so all three notification
boards are currently undrawable.

---

## 5 · Device-side gaps

- **Running power** — Page 2 wants watts. `WorkoutTracker` collects HR, distance, pace,
  cadence, energy, elevation. `HKQuantityType(.runningPower)` is not requested. Add,
  and drop the slot when unavailable (design: no placeholder).
- **Always-On (wrist down)** — no `isLuminanceReduced` handling anywhere. The three-value
  reduced face does not exist.
- **Water lock** — no handling.
- **Battery + projection** — no battery read, no projection. README flags the projection
  as needing a real estimate, never a constant; if none is available the clause drops.
- **Extend recovery / Skip rep / Discard** — none exist.
- **Fonts** — the watch bundles Bebas/Inter/Oswald. Needs Instrument Sans + Archivo
  (already bundled on the phone at `native-v2/Faff/Faff/Resources/Fonts`, with
  `FontsV5.swift` solving the Archivo 800/wdth-112 problem — it is **not** a named
  instance, so `Font.custom("Archivo-ExtraBold")` returns nil). Port `Font.faffDisplay`
  to the watch. Telemetry moves to SF Rounded Bold, tabular — no bundled font needed.
- **Day-state gradients** — `ThemeV5.DayState` on the phone already holds the six ramps
  plus the grain-layer rule. Port, do not re-derive.

---

## 6 · Designs still needed

1. **The wrist decision on the phone.** The watch records bail / ceiling lift / skipped
   reps / extended recoveries and the design says they "surface on the phone's summary —
   the watch does not quietly forget". The 0821 iPhone handoff's 5b (after the run) and
   23a (run detail) do not draw any of them. **This is the one real hole.**
2. **Watch onboarding / first pairing.** Named as not-designed in the README. Today the
   watch has a stale-plan gate and a crash-recovery flow with no designed presentation.
3. **Landmark and Lock** — README asks for a call on whether they are wanted at all.
   Recommendation: drop Landmark (duplicate of Split), drop Lock.
4. **Back-to-start distance** on long runs — needs the real route polyline; deferred.
5. **`support.js` and the `_ds` design-system folder** are absent from both zips, so the
   HTML renders with fallback fonts. Not a blocker — the README carries exact hexes and
   point sizes — but worth requesting if a faithful visual reference is wanted.

## 7 · Two device confirmations the README itself flags

- Treadmill power and elevation: confirm what watchOS actually reports on a treadmill.
  Unavailable → the slot drops, the board becomes three metrics.
- Battery projection: must be a real estimate. No estimate → the sentence loses the
  clause.

---

## 8 · Addendum received · 2026-08-21 16:17 — every design gap closed

`/Volumes/WP/06 Claude Code/Faff/design/0821/design_handoff_0821_addendum/`
(`README.md`, `Phone-Wrist-Decisions.html`, `Watch-Before-A-Session.html`).
Six new screens. **Nothing in the 15:49 watch bundle changes.**

Section 6's list is now closed:

| Ask | Outcome |
|---|---|
| 1 · wrist decision on the phone | **Drawn.** `8a` / `8b` are alternatives — build `8b` (own group on run detail 23a). Register is called non-negotiable: a decision is a statement, no colour, nothing tappable, every decision carries its reason. Four rows given verbatim. **Phone agent's screen, not this session's.** |
| 2 · watch onboarding / first pairing | **Drawn**, plus the two states that were shipping raw: stale plan (amber kicker, prescription still drawn at 48%, never red) and crash recovery (evidence first, then Carry on / Save it as is / Throw it away as unpilled text). |
| 3 · Landmark and Lock | **Ruled out. Do not build.** |
| 4 · post-race handoff (raised by this session) | **Drawn as `8c`** — a race twenty minutes after it finished. Watch time in `#F2B03C`, **value register 28px, never the display register**. No button that cannot be honoured. **Phone agent's screen.** |
| 5 · `support.js` / `_ds` | README claims a `Faff-Watch-App-standalone.html` with fonts inlined now ships in the watch bundle. **It does not** — that folder still holds only the two 15:49 files. Not blocking; both READMEs carry exact hexes and point sizes. |

### Shared rule for the three pre-session watch boards

**The watch never pretends to be the planner**, and an unusable prescription degrades to a
**plain run** rather than a blocked one. Naming it a plain run is the point — an
unprescribed run is a real thing this product records, not a fallback.

---

## 9 · Colour ruling · settled 2026-08-21

A parallel watch direction existed: `docs/design/watch/WATCH-{DESIGN-BRIEF,COLOUR-SPEC,BUILD-LIST}.md`,
committed 09:03 / 09:54 / 10:56 the same day by the iPhone session, carrying ~20 semantic
hues ("a bit more faff and fun" — a direction given against a black-and-white-plus-one-accent
draft, before the studio handoff existed).

The handoff landed at 15:49. David, with it in front of him: *"I know what I approved in the
watch design files and that's what you should rely on."*

**The watch design files govern.** The three docs are superseded — background, not
constraint. They converged on the same v5 token family for surfaces and grades; the
divergence was per-metric colour on running faces, which handoff rules 1 and 4 forbid
("a coloured number is read as a graded number"). The day-state ramps survive, because
they fill a whole screen on the lobby and the widget and cannot be misread as a verdict
on one figure.

## 10 · Facts inherited from the iPhone session

- **`a0c07c00`** rewrote `watch/workouts/complete` pace to divide by `movingSec`, with
  `timeMoving` null rather than elapsed-mislabelled when absent. Build on it — reverting to
  elapsed-derived pace reinstates the treadmill VDOT error.
- **`scripts/check-wire-keys.sh`** checks 82 Swift decoder keys against web-v2 source and
  fails CI when a key has no server-side writer. The three new decision fields must be
  registered there as they land.
- **`WatchCompletion` has no `CodingKeys`** — the wire IS the property names. Additive and
  camelCase, always. A snake_case server read once silently dropped every GPS track (`6616d766`).
- **Temperature is modelled, not measured.** Nothing in the product has a thermometer; a
  run's temperature is a weather model for a grid square and an hour bucket, and the wire
  carries no source. Same class as the battery projection. Applies to `8b`'s "it was 27
  degrees" clause.
- Build with `xcodebuild` and `-destination` only. **Never `-sdk iphonesimulator`** — it
  breaks the embedded watch target's asset catalog. `swiftc -typecheck` stops before SIL
  and misses definite-initialisation errors, so it passes code `xcodebuild` rejects.
- iPhone 17 Pro simulator belongs to the iPhone session. Use a watch destination.
- Treadmill: **the belt records, the pedometer corroborates.** Moving time drives pace and
  VDOT. David wants HR and cadence tracked on the belt.

## 11 · Sequencing note · the palette gate cannot land alone

`check-palette-sync.sh` *asserts* specific hexes are present in `WatchTheme.swift`, so
rewriting it to demand the 0821 palette before the Swift carries it goes red immediately.
And deleting `Faff.dist` / `Faff.bonus` / `C.warn` breaks every face that references them.

So commit one is **the token layer plus every call site plus the gate, green in a single
commit** — not a script edit. The gate runs in `web-v2` `prebuild`, so a red watch half
fails the iPhone session's Railway deploys too.
