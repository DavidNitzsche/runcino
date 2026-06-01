# Runcino watch design pass — handoff folder

Self-contained handoff for a fresh design pass on the Runcino Apple Watch app.
Everything you need is in this folder.

---

## Read this first (5 minutes)

The Runcino watch app already exists and is in production via TestFlight. The
visual face system (45 fixtures · 9 locked layout rules · NumberFace primitive)
is the work of an earlier session and is well-documented in
`02-VISUAL_HANDOFF.md`. **Don't redesign from scratch.** This pass is about:

1. **Filling the gaps the existing system doesn't cover** — backend contract,
   routing/state machine, options/complications, in-run information audit.
2. **Auditing the 45 existing faces** for cross-cutting information gaps
   (does the runner see HR on work reps? is "next gel in X mi" surfaced?
   does the runner know how much warmup is left?).
3. **Designing the cold-start / null-data states** (no GPS, no HR, no cached
   workout, no iPhone reachable).
4. **Producing hero-scale mockups** per the existing brand standards.

The runner is a serious distance runner training for marathons. He uses the
watch to execute structured workouts (intervals, tempo, long runs) and on
race day. Glance time on a real run is 1.5 s at hard effort. Everything in
this brief is calibrated to that reality.

---

## What's in this folder

```
watch-design-pass/
├── README.md                          ← this file
├── 01-DESIGN_BRIEF.md                 ← backend + routing + options + doctrine
├── 02-VISUAL_HANDOFF.md               ← 9 layout rules + 45 face catalog + primitives
├── 03-IN_RUN_INFO_AUDIT.md            ← what's surfaced vs missing per moment
├── 04-WIRE_CONTRACT.md                ← the WatchCompletion payload spec
├── visuals/
│   ├── face-contact-sheet.html        ← every fixture rendered (2.5 MB · open in browser)
│   └── takeovers-v2.html              ← takeover concepts
└── code/
    ├── FaceKit.swift                  ← NumberFace primitive + palette tokens
    ├── Faces.swift                    ← all 22 face structs
    ├── WorkoutEngine.swift            ← state machine + transitions + pace zone
    ├── WatchWorkoutModels.swift       ← wire format (Codable structs)
    ├── ActiveWorkoutView.swift        ← in-run router (face selector)
    └── WorkoutTracker.swift           ← HK + GPS + HR sensor reads
```

---

## Suggested read order

For a 30-minute orientation pass:

1. **`README.md`** (this file) — 5 min
2. **`visuals/face-contact-sheet.html`** — open in browser, scroll through.
   Get a feel for the visual system as it stands. 5 min.
3. **`02-VISUAL_HANDOFF.md`** — the 9 locked layout rules + face catalog.
   This is the visual primitive layer. 10 min.
4. **`01-DESIGN_BRIEF.md`** — backend contract, routing state machine,
   options surface, cross-surface doctrine, deliverable spec, open
   questions. 10 min.
5. **`03-IN_RUN_INFO_AUDIT.md`** — moment-by-moment audit of what's
   surfaced vs missing. The substantive new design ask. 10 min.

For deeper dives:
- **`04-WIRE_CONTRACT.md`** — the WatchCompletion payload (what the watch
  writes back; source-tier 5 means this becomes the canonical row)
- **`code/`** — read FaceKit.swift first (the primitive), then Faces.swift
  (the 22 face structs), then WorkoutEngine.swift (state machine that
  drives routing).

---

## What the design pass should produce

End-to-end deliverable:

### A. Routing diagram
One canonical state-machine diagram covering:
- `Idle → Lobby → Countdown → Running → Complete → TodayDone → Idle`
- All in-run face selections (per `WorkoutEngine.State` + `currentPhase.type`)
- All 5 takeover triggers (`headsUp` / `go` / `phase` / `fuel` / `split`) +
  the HR-over-ceiling snap

### B. Per-face mockups
Hero scale (422×514, watchOS Ultra 3), real brand fonts
(HelveticaNeue-Bold currently — design can propose alternatives with
calibration math), black canvas with OS clock bezel rendered.

Cover:
- The 22 canonical NumberFace faces (audit-driven — most won't need changes)
- The 8 takeover exceptions (already custom; audit only)
- The 4 review-pile faces (decisions needed — see open questions)
- The 3 palette-touch-up needed (IdleView, ReadinessGlanceView, SummaryView)
- New cold-start states (no GPS, no HR, no cached workout)
- New cross-face badges from the in-run audit (next-gel chip, HR badge,
  next-phase-distance indicator)

### C. Cross-face badge system
The corner/strip indicators that surface info across multiple faces:
- Pre-fuel countdown chip ("gel in 0.5 mi")
- HR-over badge (snaps red when over ceiling)
- Next-move preview (bottom label or last row)
- Phase-boundary distance indicator (race day)

For each: position, size, color token, dismiss behavior.

### D. Decisions on open questions
10 cross-surface questions in `01-DESIGN_BRIEF.md` §7 plus the per-face
questions in `02-VISUAL_HANDOFF.md` §"What's open / opinions wanted".
Each gets one of: ship, ship modified, defer, kill.

### E. Per-face spec sheet (one page each)
```
Face name:           WorkIntervalFace
Renders when:        engine.state == .running
                     && currentPhase.type == .work
                     && !workout.isRace
Top label:           "REP n/m"
Data props:          livePace · paceRole · targetPace · totalDistance
                     · repCounter · stripStates · [new] hrRole · hrValue
Color tokens used:   .live / .goal / .over (live pace)
                     .ink (target) / .dist (distance) / .neutral (counter)
                     .over (HR when over ceiling)
Haptic on entry:     workout.phases[i].haptic
Dismiss trigger:     phase complete OR runner tap "end rep"
Null-data fallback:  livePace = "—" with role=.mute
```

---

## Hard constraints

These are locked. Violating any of them needs explicit user (David) approval.

| Constraint | Source | What it means |
|---|---|---|
| The 9 layout rules in `02-VISUAL_HANDOFF.md` | Locked 2026-05-26 | Top margin = bottom margin, canonical inter-line gap, big rows flex, distance at bottom row, etc. |
| HelveticaNeue-Bold font | Brand decision | Can propose alternatives, but include calibration math (FaceKit's capRatio etc. are tuned to it) |
| Black background on normal faces | Locked | Washes only on takeovers (green, amber, calm-blue, etc.) |
| 10 locked palette tokens | FaceKit.swift | live / dist / goal / over / rest / bonus / ink / mute / dim / brand. New tokens need a hex + semantic meaning + David approval. |
| Race-day phase gradients untouched | project_color_palette.md | The rainbow course-phase palette is canonical; LiveRaceFace + LandmarkFace use it as-is. |
| iPhone owns settings + history + plan | Cross-surface doctrine | The watch is the run instrument. Don't propose pulling iPhone surfaces onto the watch. |
| No web-views | David standard 2026-05-27 | The watch is already native SwiftUI. Stays that way. |
| Mockups are mockups | David standard | Hero scale, real brand fonts, real device frame. Never a wireframe deck wrapped in audit prose. |
| Plain English on face labels | Coach voice doctrine | `THRESHOLD` is fine. `LACTATE T2 CEILING` is not. `MAF` is borderline (open question). |
| Wire contract is FROZEN | docs/coach/WATCH_CONTRACT.md | Adding fields to WatchCompletion is fine. Renaming or removing them breaks the watch app. |

---

## The data the watch shows

In one place, so design knows what's available:

### From the iPhone (cached pre-run)
- `workout.name, summary, totalEstimatedMinutes`
- `workout.phases[]` — every phase has `type, label, targetPaceSPerMi,
  targetHrBpm, distanceMi, durationSec, repUnit, tolerance, haptic`
- `workout.isRace, goalSec, strategyLabel, gelsMi[], fueling.atMins[]`
- `workout.hrCeilingBpm` — Z2 ceiling for easy / long runs
- `workout.displayHint` — face-flavor selector (hr / progression / strides)
- `readiness.score, label`

### From the sensors (live during run)
- `tracker.heartRate` — live HR
- `tracker.paceSPerMi` — live pace from GPS
- `tracker.distanceMi` — cumulative GPS distance
- `tracker.cadenceSpm` — cadence

### From the engine (derived live state)
- `engine.state` — `.idle / .countingDown / .running / .finished`
- `engine.currentPhase, currentIndex` — current phase + index
- `engine.phaseElapsedSec, totalElapsedSec`
- `engine.phaseRemainingSec, phaseDistanceRemainingMi`
- `engine.isPaused, planComplete, countdownValue, endingCountdownSec`
- `engine.transition` — TransitionCue for the current takeover (or nil)
- `engine.paceZone` — `.onTarget / .ahead / .behind` (color drives live pace)
- `engine.paceDeltaSPerMi` — signed delta vs target
- `engine.hrOverCeiling` — true when HR > workout.hrCeilingBpm

### From the workout completion (post-run computed)
- See `04-WIRE_CONTRACT.md` for the full WatchCompletion shape

---

## Open questions — the 10 that need David's call

From `01-DESIGN_BRIEF.md` §7. Quoted here so they're in one place:

1. **Complication scope.** Ship launcher + glance complications, or none for v1?
2. **Lobby skip.** Should the iPhone be able to send `autoStart: true` that
   skips the watch lobby and goes straight to countdown?
3. **Post-run sync affordance.** Silent durable retry (current), or show a
   tiny "synced" chip?
4. **Mile-split during work reps.** Gate to non-work phases, or render
   visually different during work, or leave as-is?
5. **`displayHint`-driven face flavors.** Keep (backend picks face per
   workout) or remove (face is data-driven from a single decision tree)?
6. **JustRunFace fate.** Convert to NumberFace (loses icon hero) or keep custom?
7. **Pause face treatment.** Keep greyed-monochromatic frozen look, or
   conform to NumberFace + `PAUSED` label?
8. **Font swap.** HelveticaNeue-Bold (current, locked) vs Bebas Neue (iPhone
   + web brand). Design opinion would be useful here.
9. **End-rep affordance.** No UI exists today for "abandon this rep
   early." Should there be one? On long-press? Side-button?
10. **Onboarding for first-time pairing.** Currently the watch shows
    `IdleView` until the iPhone sends an applicationContext. Should
    there be a first-time-pair walkthrough on the watch, or rely on the
    iPhone to coach the runner through it?

Plus the per-face questions in `02-VISUAL_HANDOFF.md` §"What's open" and
the cross-cutting Gap A-H in `03-IN_RUN_INFO_AUDIT.md` §3 (each gets a
ship / modify / defer / kill decision).

---

## What success looks like

The runner can:

- Glance at the work-rep face at 6:30/mile pace and know: on pace? · how
  much rep left? · what's next? · is HR ok? — in 1.5 seconds. **Currently
  the HR part is missing.**
- Glance at an easy-run face and know: in Z2? · current pace · what mile ·
  next fuel coming. **Currently next-fuel is buried.**
- See a fuel cue 30+ seconds before they need to take the gel, not at the
  exact moment they need to be reaching for it. **Currently no pre-warning.**
- On race day, glance and know: on goal pace? · current phase · distance
  to next phase · time to next fuel. **Currently no phase-distance, no
  predicted-finish, no next-fuel-distance.**

These are the in-run information gaps. Design's main substantive job is to
fix them, within the visual system that already exists.

The visual system is good. Don't redesign it. Audit it, fix the gaps,
ship.

---

## Questions while you work

For per-face decisions, post in the per-face open questions section.
For cross-surface questions, post in the 10 above. For routing /
state-machine questions, point at `01-DESIGN_BRIEF.md` §3.

All decisions ultimately need David's approval. Recommend, don't decide
unilaterally on anything in the "hard constraints" table above.

---

## Status

- Build: TestFlight build 90+ shipping
- Last visual system update: 2026-05-26 (the 9 rules locked, 10 faces converted)
- Wire contract: frozen at `WatchWorkoutModels.swift` and `WatchCompletion`
- This brief: 2026-05-31

---

## TL;DR

Start with `visuals/face-contact-sheet.html` in a browser to see what
exists. Then read the three numbered briefs in order. Then propose a
routing diagram, audit-driven face changes, cross-face badge system, and
mockups for the cold-start states. Hero scale, brand fonts, black canvas,
OS clock bezel rendered. The 9 layout rules are locked. The wire contract
is frozen. Everything else is design's to propose.
