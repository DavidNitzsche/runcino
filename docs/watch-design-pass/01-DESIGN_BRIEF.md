# Watch design pass — backend + routing + options brief

> **Reading this in the handoff folder?** Sibling docs:
> - `02-VISUAL_HANDOFF.md` — the 9 locked layout rules + 45-face catalog
> - `03-IN_RUN_INFO_AUDIT.md` — what's surfaced vs missing per moment
> - `04-WIRE_CONTRACT.md` — full WatchCompletion payload spec
> - `visuals/face-contact-sheet.html` — every fixture rendered
> - `code/` — FaceKit, Faces, WorkoutEngine, WatchWorkoutModels, ActiveWorkoutView, WorkoutTracker

**Companion to** `02-VISUAL_HANDOFF.md` (the watch agent's handoff,
2026-05-26). Read that one first. It covers the entire visual layer:

- The 9 locked layout rules ("the law")
- All 45 face fixtures cataloged by status (canonical / converted / takeover / flagged)
- The `NumberFace` primitive + `Strip` + `Takeover` + button-overlay pattern
- Pixel calibration constants (CLOCK_BASELINE, LABEL_FONT, CANONICAL_GAP, etc.)
- Color tokens + typography choices (HelveticaNeue-Bold locked)
- Per-face semantic open questions (HRFace label, pause treatment, etc.)
- A visual contact sheet at `visuals/face-contact-sheet.html`

**What this brief adds** that the handoff doesn't cover:

1. **Backend contract** — what the watch READS pre-run, what it WRITES post-run,
   and why the wire format matters more than usual (source-tier 5 wins dedup
   against Strava + Apple Health).
2. **Routing / state machine** — `WorkoutEngine` state → face mapping
   formalized. Which face shows when, what triggers takeovers, what dismisses them.
3. **Options surface** — settings, complications, watch ↔ iPhone responsibility split.
4. **Cross-surface doctrine** — David's locked rules from other parts of the app
   that constrain the watch pass (mockup standards, plain-English voice, etc.).
5. **Deliverable spec** — what design hands back so the work is shippable.
6. **Open questions for David** that aren't per-face — cross-cutting product calls.

**Additionally**, `03-IN_RUN_INFO_AUDIT.md` does the moment-by-moment scrutiny
pass — for every in-run face, what's the dominant question the runner is
asking, what's currently shown, and what's missing or buried (gels not
pre-warned, HR not on work-rep face, next-move not previewed, distance to
next phase boundary not surfaced on race day, etc.). That audit is the
substantive new design ask alongside the architectural layers covered in
this brief.

The existing handoff doc is the authority on visual primitives. This brief is the
authority on data + flow + scope. Where the two contradict, the visual handoff
wins on visuals, this brief wins on data + scope.

---

## 0. Path correction

The handoff doc references `legacy/native/Faff/FaffWatch Watch App/`. The active
build target is now at `native-v2/Faff/FaffWatch Watch App/`. Both directories
exist with identical files (same size, same mtime — they're synced). Open and
edit either; the canonical build target is `native-v2/`.

```
native-v2/Faff/                              ← iPhone app (Faff target)
native-v2/Faff/FaffWatch Watch App/          ← watch app (the subject of this pass)
native-v2/Faff/Faff/Resources/Fonts/         ← brand font bundle
```

---

## 1. The product question

The watch is **not a renderer** of `/api/*` endpoints like the web + iPhone are.
It is the **source** of training data the rest of the app reads. That changes
how design should think about it.

### Jobs to be done

In priority order, from David's actual use:

1. **Execute a structured workout without looking at the phone.** The watch
   knows the plan, plays haptics at phase boundaries, shows current target +
   live performance, and tells the runner when to fuel.
2. **Race-day pacing.** Same as #1 but with course phases (which the watch
   knows from the WatchWorkout payload) and gel timing locked to mileage.
3. **Just run.** A run that's not in the plan — easy day, recovery jog,
   shake-out. Watch records, doesn't prescribe. Source = `watch`, posts
   completion, becomes the canonical row.
4. **Glance at readiness before starting.** Pre-run face shows today's
   workout summary + readiness score so the runner can confirm they're
   doing the right thing.
5. **Post-run summary at hero scale on the wrist.** Distance, pace, HR
   averages, "complete" affirmation, sent home automatically.

What the watch is **NOT** for:

- Browsing past runs (iPhone job)
- Editing the plan (iPhone job)
- Reading coach narrative or briefings (iPhone job)
- Settings beyond on-watch essentials (iPhone job)
- Discovering new workouts (iPhone job)

### Glance-time budget

Design targets:
- **Pre-run lobby**: ≤3 seconds to confirm "yes, this is the right workout"
- **In-run main face**: ≤1.5 seconds to read pace + target + distance + HR + phase
- **Takeover (fuel, mile-split, phase change)**: glanceable in motion at
  hard effort. No reading required — color + position + sound carry meaning.

---

## 2. Backend contract

The handoff doc treats the watch as a self-contained UI system. In reality
every face is fed by either (a) a payload the phone delivered before the run
or (b) live sensor data from the watch itself.

### 2a. Pre-run read: `WatchWorkout` from the iPhone

The watch never hits `/api/*` directly during the run. It receives a
`WatchWorkout` payload via `WatchConnectivity.applicationContext` while the
iPhone is reachable, caches it, and runs against the cache.

**Source of truth shape:**
`native-v2/Faff/FaffWatch Watch App/WatchWorkoutModels.swift` (~524 lines).

Key fields design should know about:

| Field | Type | What faces use it |
|---|---|---|
| `workoutId` | String | Idempotency key on completion writeback |
| `name` | String | Lobby title row ("LONG · BASE") |
| `summary` | String | Lobby subtitle ("12 mi easy · 8:30 target") |
| `totalEstimatedMinutes` | Int | Lobby time hint |
| `phases: [WatchPhase]` | Array | The whole workout — see below |
| `completionEndpoint` | URL | Where the completion POSTs (full URL shipped) |
| `expiresAt` | Date | After this, the cached workout is stale |
| `readinessScore, readinessLabel` | Int + String | Pre-run readiness glance |
| `isRace, goalSec, strategyLabel, gelsMi` | Race-day fields | LiveRaceFace + LandmarkFace |
| `hrCeilingBpm` | Int? | Triggers `hrOverCeiling` → red HR snap on EasyFace |
| `displayHint` | String? | Face-flavor selector (`hr` / `progression` / `strides`) |

### 2b. `WatchPhase` (the rep / interval)

| Field | Type | What faces use it |
|---|---|---|
| `index, type, label` | Identity | TopLabel on every in-run face |
| `type` | enum: `warmup / work / recovery / cooldown` | Face routing (see §3) |
| `targetPaceSPerMi` | Int? | Reference white target row |
| `targetHrBpm` | Int? | HRFace target |
| `distanceMi, durationSec` | Phase scope | Counter on bottom row |
| `repUnit` | enum: `distance / time` | Determines counter format |
| `tolerance` | Int (s/mi) | Drives pace zone (green/amber/red) |
| `haptic` | String | Boundary haptic at phase start/end |

Design implication: **the watch is dumb until the iPhone hands it a
WatchWorkout.** A face for "no workout cached, can't sync, what now" needs
to exist and be designed. Currently `IdleView.swift` handles this with old
palette tokens (flagged in `MIGRATION_PLAN.md` for touch-up).

### 2c. Post-run write: `WatchCompletion`

Endpoint: `POST {workout.completionEndpoint}` (full URL ships in the payload,
typically `https://www.faff.run/api/watch/workouts/complete`).

Auth: Bearer token from `applicationContext.authToken` (iPhone-shared).

Idempotent on `workoutId`. The watch maintains a durable retry queue
(`UserDefaults: faff.watch.pendingCompletions.v1`) and retries until 2xx.

**The payload shape that earns canonical-row status:**

```json
{
  "workoutId":        "0645f40c-uuid-2026-05-31",
  "startedAt":        "2026-05-31T14:00:00Z",
  "completedAt":      "2026-05-31T15:01:42Z",
  "status":           "completed",  // "completed" | "partial" | "abandoned"
  "totalDistanceMi":  7.92,
  "totalDurationSec": 3702,
  "avgHr":            154,
  "maxHr":            178,
  "avgCadence":       178,
  "phases":           [WatchCompletionPhase, ...]
}
```

Per-phase:

```json
{
  "index":             0,
  "type":              "warmup",
  "label":             "Warmup",
  "targetPaceSPerMi":  492,
  "actualPaceSPerMi":  488,
  "actualDurationSec": 891,
  "actualDistanceMi":  1.81,
  "avgHr":             142,
  "maxHr":             158,
  "avgCadence":        174,
  "completed":         true
}
```

**Doctrine that comes from this contract** and affects design decisions:

1. **`null` everywhere = no signal, NOT zero.** Faces that show HR or pace
   must have a "no signal" treatment (currently `--` or `—`). Verify all
   45 fixtures handle nulls.
2. **`actualDistanceMi` is GPS truth, NOT prescribed.** A rep where the runner
   went 1.02 mi (overshot the heads-up cue) writes `actualDistanceMi = 1.02`.
   The coach later compares to the prescribed phase distance. The watch UI
   should reflect this — distance row counts up past the prescribed amount,
   color flips to `.bonus` purple. Already in `OvertimeFace`.
3. **`completed: false` is meaningful.** If the runner taps "end rep" early,
   the phase logs `completed: false`. There's no UI yet for "tap to abandon
   this phase" — design should propose one.

### 2d. Source-tier 5 — why this matters

Per the canonical run-model doctrine, source ranking is:

```
watch (5) > manual (4) > apple_watch/HK (3) > apple_health (2) > strava (1)
```

When the watch posts a completion, it WINS dedup against the same day's
Apple Health import (Apple Watch via HK) AND Strava. The watch's payload
becomes the canonical row everyone reads.

Design implication: every field the watch can stamp with confidence
should be in the payload. Every field it can't should be `null` so the
ladder can fall through to a lower tier. Design proposals that add a new
face which captures new data (notes, perceived effort, RPE) should also
propose the corresponding field addition to `WatchCompletion`.

### 2e. Other endpoints the watch + phone-bridge hits

| Endpoint | Direction | Purpose |
|---|---|---|
| `POST /api/watch/workouts/complete` | Watch → Backend | Above. Canonical write. |
| `GET /api/today` (iPhone-mediated) | Phone → Backend | Source of WatchWorkout the iPhone forwards via applicationContext |
| `GET /api/profile/state` (iPhone-mediated) | Phone → Backend | Readiness score for the pre-run glance |
| `POST /api/watch/heartbeat` | Future / not built | Optional in-run telemetry for live-tracking iPhone view |

The watch itself does not call the network during a run. Connectivity is
assumed unreliable. Everything routes through the iPhone or is cached.

---

## 3. Routing — state machine to face

The handoff doc lists faces. It does NOT formalize **which face shows when**.
David asked for "routing" specifically. This is that.

### 3a. `WorkoutEngine.State` (the top-level state)

```
.idle           → IdleView / LobbyFace (depending on whether a workout is cached)
.countingDown   → CountdownView (David's locked custom exception · big 3-2-1)
.running        → IN-RUN face (see §3b table)
.finished       → CompleteFace → 1.5s → TodayDoneFace → home
```

Two cross-cutting sub-states modify the running face:

- `isPaused` → LivePauseFace overlays whatever else is showing
- `planComplete && !finished` → OVERTIME variant of the current face
  (distance row flips purple, no target enforcement)

### 3b. In-run main face routing (when `state == .running`)

Driven by `engine.currentPhase?.type` AND `workout.isRace` AND `workout.displayHint`.
Pseudocode from `MIGRATION_PLAN.md` §Step 2:

```
switch currentPhase.type {
  case .warmup:
    WarmupFace
  case .work:
    if workout.isRace:                LiveRaceFace
    else if displayHint == .hr:       HRFace
    else if displayHint == .strides:  StridesFace
    else if displayHint == .progression: ProgressionFace
    else:                             WorkIntervalFace
  case .recovery:
    RestFace
  case .cooldown:
    SteadyRunFace (top label = "COOL DOWN")
  default:  // long runs, just-runs, easy runs
    if workout.totalEstimatedMinutes > 40 || displayHint == .easy:
      EasyFace
    else:
      JustRunFace  (← flagged in handoff doc for review)
}
```

Design opinion needed: is the `displayHint` overlay good (lets the
backend pick the face flavor per workout) or should the watch decide based
on data alone (e.g. "HR is the dominant signal for any easy run, always
show HRFace; pace runs always show WorkIntervalFace")?

### 3c. Takeover triggers (`engine.transition: TransitionCue?`)

These are full-screen flashes that interrupt whatever main face is showing.
The cue fires from the engine, the face shows, an internal timer dismisses.

| Trigger | TransitionCue | Face | Duration | Why |
|---|---|---|---|---|
| 0.25 mi or 10 s before phase end | `.headsUp(value)` | HeadsUpFace | 2.6 s | Amber alert · "ease off" |
| Phase end → next phase start | `.go(rep, target)` | GoFace | 1.5 s | Green wash · "go" announcement |
| Race-day course phase boundary | `.phase(title, sub)` | PhaseChangeFace | 3 s | Orange wash · mountain glyph |
| Fueling trigger (`gelsMi` or `fueling.atMins`) | `.fuel(index, total)` | FuelFace | persistent until swipe | Amber · "Fuel · 2 of 3" |
| Race-day landmark cue | (separate state) | LandmarkFace | 3 s | Calm-blue wash · diamond glyph |
| Auto-lap on every mile | `.split(mileNo, paceSec)` | MileSplitFace | 2 s | "Mile 7 · 6:54" |
| HR crosses ceiling | `engine.hrOverCeiling = true` | EasyFace (red HR variant) | persistent while over | Red HR row snap |

Open routing question for design: **mile-split fires during work reps right
now** (a known bug from the handoff doc). Should mile-splits be gated to
non-work phases, or shown but visually different during work? UX call.

### 3d. Pre-run flow

```
IdleView                      ← no workout cached, no readiness
  ↓ (iPhone sends applicationContext with workout+readiness)
ReadinessGlanceView           ← shows readiness score, "swipe for workout"
  ↓ (swipe)
LobbyFace                     ← workout name + summary + START button
  ↓ (tap START)
CountdownView (3-2-1)
  ↓
Active workout (see §3b)
```

Design opinion needed: should the **lobby be skippable**? Some runners tap
START on the iPhone briefing card and want the watch to skip lobby → countdown.
The iPhone could send `autoStart: true` in the context. Should design
formalize this OR keep lobby as a confirm-gate for safety?

### 3e. Post-run flow

```
Last phase complete OR runner taps "End"
  ↓
CompleteFace                  ← workout type label + summary numbers + Done button
  ↓ (tap Done)
TodayDoneFace                 ← 1.5 s checkmark + "TODAY COMPLETE"
  ↓
back to IdleView
```

Meanwhile in the background:
```
PhoneSync queues WatchCompletion
  ↓
durable retry until 2xx from /api/watch/workouts/complete
  ↓
iPhone bursts coach briefing cache · next /today render shows the new run
```

Design opinion needed: do we want a "sent successfully" affordance on the
watch ("Synced") OR is silent durable retry better (assume success, don't
worry the runner)? Currently silent.

---

## 4. Options surface

This is the part design has the most freedom to invent. What lives ON the
watch vs ON the iPhone?

### 4a. On-watch settings — current state

Nothing. The watch has no settings face. All configuration comes from
applicationContext. This is intentional — David's standard ("iPhone stays
fully native") implies "the watch is the run instrument; the iPhone is the
control panel."

### 4b. Possible on-watch settings — for design to propose

Candidates the watch could reasonably own:

| Setting | Why on-watch | Why not |
|---|---|---|
| Haptic intensity | Felt on the watch | Apple's standard already handles this |
| Display always-on during workout | Affects battery | iPhone could send a flag |
| Auto-pause sensitivity | Run-specific | Could live on iPhone |
| Audio cues (chime / no chime) | Runner-preference | Could be a workout-type setting |
| End-rep tap behavior (long-press vs tap) | Safety against false-tap | Probably iPhone |

David's likely answer: **none of these on the watch.** Keep the watch
single-purpose. Push back if design has a strong case for any.

### 4c. Complications

Currently none implemented. Apple Watch supports complications on the
default watchface for quick app launch + glance.

Design opinion needed:

1. **Should we ship a launcher complication?** Tap → Faff app opens to
   either IdleView or directly to LobbyFace if a workout is cached.
2. **Glance complication?** Shows readiness score + today's workout name
   on the user's preferred watchface. Could be the runner's primary
   "today" surface before they even open the app.
3. **Live-workout complication?** During an active workout, the
   complication updates with current pace / mile / HR. Replaces having to
   raise wrist into the app.

Each of these is a separate file to design + a separate piece of code.
Recommendation: **start with the launcher + glance**, defer live-workout
complications (battery + complexity).

### 4d. What stays on iPhone (don't design these for watch)

- Workout selection / swap
- Plan view
- Coach briefing narrative
- Past run history + run detail
- Strava connection + push toggle
- Profile + body metrics
- Race entry + countdown
- Shoe library
- Injury log

If design proposes pulling any of these onto the watch, flag it explicitly
so David can decide. Default: stays on iPhone.

---

## 5. Cross-surface doctrine (David's locked rules)

These are rules from elsewhere in the codebase / memory that constrain
this pass. Design should know them so proposals don't accidentally
violate them.

| Rule | Where locked | What it means for watch design |
|---|---|---|
| iPhone stays fully native — no web-views | CLAUDE.md 2026-05-27 | The watch is already native SwiftUI. Reinforces: no WebKit on watch ever. |
| Mockup decks must be mockups | feedback_mockup_decks_must_be_mockups.md | Deliverables are designed screens at hero scale with real brand fonts. NEVER a wireframe deck wrapped in audit prose. |
| Plain English, no PhD jargon | Coach voice rewrite | Face labels stay short + plain. `THRESHOLD` is fine; `LACTATE T2 CEILING` is not. `MAF` is borderline — see HRFace open question in handoff doc. |
| If data is not FROM strava, don't call it STRAVA | David, 2026-05 | The watch is a SOURCE. Faces shouldn't reference Strava at all. |
| Source ladder: watch=5, manual=4, HK=3, apple_health=2, strava=1 | Canonical run model | Every field the watch can stamp earns canonical-row status — see §2d. |
| Race gradients must not be touched | project_color_palette.md | LiveRaceFace + LandmarkFace use the locked rainbow course-phase palette. Design CAN propose new takeover faces but cannot retint the race-day phase gradients. |
| Colors are an app-wide discussion — make per-face choices provisional | feedback_color_app_wide_discussion.md | If design wants to retint a face token, flag it as provisional. App-wide color semantics get decided later. The 10 locked palette tokens in FaceKit (live/dist/goal/over/rest/bonus/ink/mute/dim/brand) are the current canonical set. |
| Fully autonomous = no stopping at "comfortable points" | CLAUDE.md 2026-05-24 | Doesn't directly affect design, but: design should propose end-to-end face systems, not partial passes. |

---

## 6. Deliverable spec

What design hands back so the work is shippable.

### 6a. Mockups (visual)

- **Hero-scale per-face mockups.** 422×514 (Ultra 3), with the OS clock
  bezel zone rendered. NOT abstract Figma rectangles.
- **Real brand fonts.** Currently HelveticaNeue-Bold. If design wants to
  propose Bebas Neue or Oswald (the iPhone + web brand fonts), include
  a side-by-side comparison + cap-height math (FaceKit's `capRatio`
  is calibrated to HelveticaNeue — a font swap means redoing the
  calibration constants).
- **One file per face state.** Including null-data states (no GPS, no HR,
  no cached workout).
- **No wireframe deck wrapped in audit prose.** This is David's locked
  rule for design output.

### 6b. Routing diagram

- One canonical state-machine diagram covering:
  - Idle → Lobby → Countdown → Running → Complete → TodayDone → Idle
  - All in-run face selections (§3b)
  - All takeover triggers + dismissal (§3c)
- Format: PNG / SVG / interactive (designer's call). One picture > 500 words.

### 6c. Per-face spec sheet

For every face, a one-page spec:

```
Face name:           WorkIntervalFace
Renders when:        engine.state == .running
                     && currentPhase.type == .work
                     && !workout.isRace
                     && displayHint == nil
Top label:           "REP n/m" (computed from stripStates)
Data props:          livePace · paceRole · targetPace · totalDistance
                     · repCounter · stripStates
Color tokens used:   .live / .goal / .over (live pace)
                     .ink (target)
                     .dist (distance)
                     .neutral (counter)
Haptic on entry:     workout.phases[i].haptic
Dismiss trigger:     phase complete OR runner tap "end rep"
Null-data fallback:  livePace = "—" with role=.mute
```

The watch agent's existing handoff has most of this implicitly — design
can lean on it; the goal is to make routing decisions explicit.

### 6d. Asset bundle

- All SF Symbol references explicit (`heart.fill`, `figure.run`,
  `flame.fill`, `clock`, `diamond.fill`, `mountain.2.fill`, etc.)
- Any custom glyphs: SVG + PNG at 2x + 3x
- Color tokens: list of any new tokens vs the existing 10. Each new
  token needs a hex + semantic meaning.

### 6e. Acceptance criteria

A face design is acceptance-ready when:

1. It inherits the 9 layout rules from `FaceKit.swift` (or has an
   explicit David-approved exception).
2. Every data prop maps to a field on `WorkoutEngine` published surface
   OR `WatchWorkout` field OR `WatchTracker` sensor output. No magic data.
3. Null-data state is designed.
4. Color tokens come from the 10 locked tokens OR are explicitly flagged
   as new + provisional.
5. Haptic + dismiss trigger are specified.

---

## 7. Open questions for David (cross-surface)

The handoff doc has per-face questions (HRFace label, pause treatment,
splits primitive). These are the bigger ones that affect scope:

1. **Complication scope.** Ship launcher + glance complications, or none
   for v1?
2. **Lobby skip.** Should the iPhone be able to send `autoStart: true`
   that skips the watch lobby and goes straight to countdown?
3. **Post-run sync affordance.** Silent durable retry (current), or
   show a tiny "synced" chip?
4. **Mile-split during work reps.** Gate to non-work phases, or render
   visually different during work, or leave as-is?
5. **`displayHint`-driven face flavors.** Keep (backend picks face per
   workout) or remove (face is data-driven from a single decision tree)?
6. **JustRunFace fate.** Convert to NumberFace (loses icon hero) or
   keep custom?
7. **Pause face treatment.** Keep greyed-monochromatic frozen look, or
   conform to NumberFace + `PAUSED` label?
8. **Font swap.** HelveticaNeue-Bold (current, locked) vs Bebas Neue
   (iPhone + web brand). Design opinion would be useful here.
9. **End-rep affordance.** No UI exists today for "abandon this rep
   early." Should there be one? On long-press? Side-button?
10. **Onboarding for first-time pairing.** Currently the watch shows
    `IdleView` until the iPhone sends an applicationContext. Should
    there be a first-time-pair walkthrough on the watch, or rely on the
    iPhone to coach the runner through it?

---

## 8. File map (canonical paths)

The handoff doc's paths point at `legacy/native/...`. Update to:

```
native-v2/Faff/FaffWatch Watch App/
├── ActiveWorkoutView.swift     ← in-run router (calls faces by phase type)
├── ContentView.swift           ← unchanged tab host
├── CountdownView.swift         ← 3-2-1 (David's locked exception)
├── FaceKit.swift               ⭐ NumberFace primitive + tokens + Role enum
├── Faces.swift                 ⭐ All 22 face structs
├── FaffWatchApp.swift          ← app entry
├── Haptics.swift               ← haptic taps + cues
├── IdleView.swift              ← "no workout cached" — needs palette touch-up
├── PaceDrift.swift             ← drift evaluator
├── PhoneSync.swift             ← WatchConnectivity + completion queue
├── ReadinessGlanceView.swift   ← pre-run readiness — needs palette touch-up
├── ResponsiveFace.swift        ← canvas scaling per device — to be deleted
├── SummaryView.swift           ← post-run summary — needs palette touch-up
├── WatchFaces.swift            ← LEGACY face set — to be deleted post-migration
├── WatchFixtures.swift         ← fixture renderer for -face <name> flag
├── WatchTheme.swift            ← LEGACY palette — to be deleted post-migration
├── WatchWorkoutModels.swift    ⭐ THE WIRE FORMAT — frozen, don't break
├── WorkoutEngine.swift         ⭐ state machine + transitions + pace zone
├── WorkoutRootView.swift       ← root navigation
└── WorkoutTracker.swift        ← HK + GPS + HR sensor reads
```

⭐ = canonical files design should read first.

Inside this handoff folder, the relevant source files are already mirrored
under `code/` so you don't need repo access:

```
watch-design-pass/
├── README.md                              ⭐ open me first
├── 01-DESIGN_BRIEF.md                     (this file)
├── 02-VISUAL_HANDOFF.md                   ⭐ visual primitives + face catalog
├── 03-IN_RUN_INFO_AUDIT.md                ⭐ moment-by-moment info audit
├── 04-WIRE_CONTRACT.md                    ⭐ WatchCompletion payload spec
├── visuals/
│   ├── face-contact-sheet.html            ⭐ every fixture rendered (browser)
│   └── takeovers-v2.html                  takeover concepts
└── code/
    ├── FaceKit.swift                      ⭐ NumberFace primitive
    ├── Faces.swift                        ⭐ 22 face structs
    ├── WorkoutEngine.swift                ⭐ state machine + transitions
    ├── WatchWorkoutModels.swift           ⭐ wire format (frozen, don't break)
    ├── ActiveWorkoutView.swift            in-run router
    └── WorkoutTracker.swift               HK + GPS + HR sensor reads
```

---

## 9. How to run + screenshot

To exercise a single face from a fixture name:

```
# Open the project
open native-v2/Faff/Faff.xcodeproj

# Build target: FaffWatch Watch App
# Destination: Apple Watch Ultra 3 (49mm) — calibration target
# Launch with a fixture name:
xcrun simctl launch <SIM_UUID> run.faff.app.watchkitapp -face cruise-warmup
```

Fixture names (from `WatchFixtures.swift`): `cruise-warmup` / `rest` /
`cruise-cooldown` / `overtime` / `steady` / `hr` / `easy` / `easy-no-gps` /
`easy-hr-over` / `tomorrow-easy-mid` / `tomorrow-easy-cadence` / `strides` /
`rep` / `cruise-rep-mid` / `cruise-rep-end` / `race` / `today` / `stats` /
`go` / `fuel` / `tomorrow-fuel-1` / `tomorrow-fuel-3` / `complete` /
`summary-workout` / `summary-race` / `tomorrow-summary` / `cruise-lobby` /
`lobby-easy` / `lobby-race` / `calibrate` / `headsup` / `headsup-time` /
`phase-change` / `landmark` / `milesplit` / `tomorrow-milesplit` /
`countdown` / `endcountdown` / `pause` / `tomorrow-pause` / `justrun` /
`splits`.

To exercise the engine end-to-end (cruise workout, 30× time warp, auto-start
past lobby):

```
xcrun simctl launch <SIM_UUID> run.faff.app.watchkitapp -cruise -warp 30 -autostart
```

---

## TL;DR for design

Read `docs/watch-face-design-handoff.md` for the visual system. Read this
brief for the data + routing + scope. Then propose:

1. Routing diagram (the §3 state machine, formalized as one picture)
2. Audit of the 22 canonical NumberFace faces — keep / merge / kill
3. Decisions on the 8 open questions in §7
4. Designs for the four gaps the existing system doesn't cover:
   - Cold-start states (no workout cached, no GPS signal, no HR)
   - Watch-side onboarding (or confirm: none — iPhone handles it)
   - Complication concepts (launcher + glance recommended)
   - The IdleView / ReadinessGlanceView / SummaryView palette touch-ups
     flagged in `MIGRATION_PLAN.md`
5. Hero-scale mockups per §6, in real brand fonts, on a black canvas
   with OS clock bezel rendered.

Deliverable cadence: one face at a time is fine. End-to-end deck is fine.
Wireframe-only is not (locked David rule).
