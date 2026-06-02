# Watch face design handoff

Self-contained brief for a fresh design pass on the Runcino watchOS faces. Read this top-to-bottom; you'll have everything you need to evaluate, critique, and propose changes.

**Companion artifacts:**
- [`docs/watch-faces-2026-05-26.html`](watch-faces-2026-05-26.html) — visual contact sheet of all 45 fixtures (self-contained, 2.5MB, open in a browser)
- [`legacy/native/Faff/FaffWatch Watch App/FaceKit.swift`](../legacy/native/Faff/FaffWatch%20Watch%20App/FaceKit.swift) — the layout primitive
- [`legacy/native/Faff/FaffWatch Watch App/Faces.swift`](../legacy/native/Faff/FaffWatch%20Watch%20App/Faces.swift) — face structs

---

## TL;DR

Runcino is a structured-running watchOS app. The faces are the runtime UI: WARMUP / REST / REP n/m / EASY / PHASE n/m / etc. The system was redesigned mid-2026 around a **single layout primitive** (`NumberFace`) and a **locked grammar** (the "law" — 9 rules covering margins, gaps, fonts, color, row order). Most faces inherit the law by being built on `NumberFace`; a small set of intentional exceptions (takeovers, countdown) stay custom.

The system **works** — the contact sheet shows 45 fixtures rendering cleanly with consistent rhythm. What's open: per-face semantic decisions (labels, colors), a handful of faces still flagged for review, and any opinions on aesthetics-level changes (typography, color, mood, density).

---

## The locked law (DO NOT silently violate)

These rules are non-negotiable without explicit user (David) approval. Memory rule: [`feedback_watch_face_layout_rules.md`](../../Users/david/.claude/projects/-Volumes-WP-06-Claude-Code-Runcino/memory/feedback_watch_face_layout_rules.md).

1. **Small top label rides the OS clock baseline.** Tags like `WARMUP`, `REST`, `REP 2/4` share a baseline with the watchOS system clock at top-right. Realized by `TOP_MARGIN = CLOCK_BASELINE − labelCap`, with `CLOCK_BASELINE = 0.1323` (calibrated on Ultra 3).
2. **Top margin = bottom margin.** Strict pixel symmetry. `BOTTOM_MARGIN := TOP_MARGIN`. Exception: when a strip or button reservation replaces the bottom region.
3. **Small labels stay at `LABEL_FONT` (= 0.080 · H).** Never resize.
4. **Canonical inter-line gap, ALWAYS.** Every consecutive pair of lines (top-label↔row 0, row↔row, row N↔bottom-label) sits at the SAME gap value (≈ 0.042 · H). NO derived-gap math that grows with row count.
5. **Big rows FLEX vertically to fill.** Cap height is whatever satisfies the equation given the locked TOP_MARGIN, labels, canonical gap. Numbers grow as row count drops — `REST` (3 rows + 1 label) gets BIGGER digits than `WARMUP` (3 rows + 2 labels).
6. **Width cap by widest row.** Multi-row faces auto-shrink so the longest text clears the screen. Elapsed past 1hr drops to `h:mm` (not `h:mm:ss`) so it matches `m:ss` rows.
7. **Anchored faces get full-width.** With a top label, big rows sit BELOW the clock zone and use full screen width minus bezel margins (`W − 2·H·leadF`). Bare-rows faces use the strict clock-clear cap (`clockClearF·W − H·leadF`).
8. **Single-row anchored faces auto-center.** If width-binding leaves slack below the row, shift down to vertically center it in the band — prevents "top-heavy big number floating with empty bottom" on `GO` / `FUEL` / `CALIBRATE`.
9. **Distance lives at the bottom row.** `pace · time/HR/etc · distance` — distance is always the last big row. Color: blue (`.dist`) normally, purple (`.bonus`) when past the plan.

**Pixel calibration:** `firstCharLSB("1") = 0.115·F` — empirical adjustment so rows starting with "1" (e.g. `145` HR, `1:12` elapsed, `1.5` mi) visually left-align with rows starting with `9`/`8`. Without it, "1" rows indent ~18px on Ultra 3 due to HelveticaNeue-Bold's wide internal left side bearing.

---

## Visual system

### Typography

| Use | Font | Source |
|---|---|---|
| All big number rows | `HelveticaNeue-Bold` (proportional, .custom font) | Bundled |
| All small labels (top tag, bottom subtitle) | `HelveticaNeue-Bold` | Bundled |
| SF Symbol icons (heart, flame, figure.run, etc.) | `.system(...)` weights | watchOS |

**Why HelveticaNeue-Bold:** brand-decided early, locked. It's geometric, no quirky terminals, reads well at watch scale. It is NOT tabular — see below.

**Known typography quirks (accepted, NOT bugs):**
- HelveticaNeue's `1` is much narrower than other digits. The `firstCharLSB` table compensates the row's bounding-box position so `1`-starting rows visually left-align with other rows, but the COLON or PERIOD inside the row (`1:12`, `1.5`) sits slightly left of where it would in `9:02`, `8.10`. This is a font characteristic, not a layout bug. SF Mono fixes it but the brand look becomes utilitarian (rejected). SF Compact also doesn't fix it.

### Color palette (canonical tokens)

| Token | Hex | Meaning |
|---|---|---|
| `.live` | `#3EBD41` (green) | On-target / governed / "go" |
| `.dist` | `#27B4E0` (blue) | Distance, always |
| `.goal` | `#F3AD38` (amber) | Attention / target / "act now" (fuel) |
| `.over` | `#FC4D64` (red) | Warning / off-target / over ceiling |
| `.rest` | `#008FEC` (corporate blue) | Recovery / landmark chrome |
| `.bonus` | `#A78BFA` (purple) | Past the plan (bonus distance / overtime) |
| `.ink` | `#F6F7F8` (off-white) | Neutral readout |
| `.mute` | `#8A90A0` (grey) | Muted labels |
| `.dim` | `#646464` (darker grey) | Paused / disabled |
| `.redish` | `#D03F3F` (destructive red) | Destructive buttons (matches web `--color-phase-2`) |

Background: pure `#000` (black) for normal faces. Washes for takeovers:
- GoFace: `#0C2A14` (green wash, ~5% lightness)
- FuelFace: `#3A2B08` (amber wash)
- PhaseChangeFace: `#3A2B08`
- LandmarkFace: `#06243F` (calm blue wash)
- CompleteFace: `#0C2A14` (green wash with radial gradient)

The race-day phase color gradients (rainbow across course phases) are separate and **must not be touched** per the canonical palette memory.

### Spacing / dimensions

Calibrated on watchOS Ultra 3 (422×514, aspect ≈ 0.818). All values are fractions of screen height H.

| Constant | Value | Meaning |
|---|---|---|
| `CLOCK_BASELINE` | 0.1323 | y-fraction of OS clock cap-bottom |
| `TOP_MARGIN` (= `BOTTOM_MARGIN`) | 0.0739 | derived; cap-top of top label sits here |
| `LABEL_FONT` | 0.080 | font size of small labels |
| `capRatio` | 0.73 | HelveticaNeue-Bold cap-height ÷ point-size |
| `CANONICAL_GAP` | ≈ 0.042 | inter-line gap (derived from warmup reference, treated as constant) |
| `leadF` | 0.060 | x-fraction of canonical left edge of all lines |
| `clockClearF` | 0.70 | top row width cap when no top label (clears OS clock at top-right) |
| `stripBottomF` / `stripBarF` | 0.075 / 0.027 | strip-from-bottom + strip bar height |
| `K_SMALL` / `K_BIG` | 0.0316 / 0.0434 | cap-top residual offset compensation (`size · K_*` subtracted from offset.y) |

---

## Component primitives

### `NumberFace` (the workhorse)

In `FaceKit.swift`. Used by 33 of 45 fixtures. The single source of truth for layout.

```swift
NumberFace(
    rows: [NumRow],                 // 1-4 big rows
    topLabel: String?,              // small tag at clock baseline
    topLabelColor: Color,           // defaults to Faff.mute
    topIcon: String?,               // SF Symbol; mutually exclusive with topLabel
    topIconColor: Color,
    bottomLabel: String?,           // small subtitle below rows
    strip: Strip?,                  // progress bar at bottom (reps/phases)
    bottomReservation: CGFloat?,    // reserves bottom area for a button overlay
    faceBackground: Color           // wash for takeovers
)

struct NumRow {
    let text: String                // "8:18", "138", "2.55"
    let role: Role                  // .live / .dist / .goal / .over / .rest / .neutral / .bonus / .mute / .dim
    let icon: String?               // optional SF Symbol (heart.fill, figure.run, etc.)
}
```

### `Strip` (bottom progress)

```swift
Strip(
    states: [Int],                  // 0 empty, 1 done, 2 now
    doneColor: Color = Faff.live,
    nowColor: Color = .white
)
```

### `Takeover` (private)

In `Faces.swift`. Full-bleed 1.5–3s flash layout: glyph + big cue + sub. Used by `PhaseChangeFace`, `LandmarkFace`. Not exposed for general use.

### Button-overlay pattern (new this session)

Faces with action buttons (`START`, `Done`, `Set`, `Resume`) use:
```swift
ZStack(alignment: .bottom) {
    NumberFace(rows: [...], topLabel: ..., bottomReservation: 0.20)
    GeometryReader { geo in
        Button(action: ...) { ... }
            .padding(.bottom, ...)
            .frame(maxHeight: .infinity, alignment: .bottom)
    }
}
```

`bottomReservation: 0.20` carves out 20% of H at the bottom; rows flex above it. The button overlays into that reserved area.

---

## Face catalog (45 fixtures)

See `docs/watch-faces-2026-05-26.html` for visuals. Grouped by status as of 2026-05-26 night.

### ✅ Canonical NumberFace (22)
Already inherit the law. Visually consistent. No design work needed unless rethinking semantics.

| Fixture | Struct | Top label | Notes |
|---|---|---|---|
| `cruise-warmup` / `warmup` | WarmupFace | `WARMUP` | reference face: 5 lines (top + 3 rows + bottom) |
| `rest` / `recovery` / `cruise-rec` | RestFace | `REST` (blue) | 4 lines, distance at bottom |
| `cruise-cooldown` | SteadyRunFace | `COOL DOWN` | |
| `overtime` / `cruise-cooldown-overtime` | SteadyRunFace | `OVERTIME` | distance purple (.bonus), h:mm elapsed |
| `steady` | SteadyRunFace | `STEADY` | |
| `hr` | HRFace | `MAF` | label = Maffetone aerobic ceiling — *open question, see below* |
| `easy` / `easy-no-gps` / `easy-hr-over` / `tomorrow-easy-mid` / `tomorrow-easy-cadence` | EasyFace | `EASY` | rotating HR/cadence guardrail |
| `strides` | StridesFace | `STRIDES` | 2 rows + strip |
| `rep` / `cruise-rep-mid` / `cruise-rep-end` | WorkIntervalFace | `REP n/m` | 4 rows + strip |
| `race` | LiveRaceFace | `PHASE n/m` (orange) | 4 rows + strip |
| `today` | TodayDoneFace | ✓ icon | post-Done 1.5s flash |
| `stats` | InRunStatsFace | `STATS` | 4 rows (distance / elapsed / avg pace / cal) |
| `go` | GoFace | `REP n/m` (green) | 1-row centered, green-wash 1.5s announcement |

### ✅ Converted this session (10)
Rebuilt on NumberFace + button overlay during the 2026-05-26 sweep.

| Fixture | Struct | Top label | Notes |
|---|---|---|---|
| `fuel` / `tomorrow-fuel-1` / `tomorrow-fuel-3` | FuelFace | `FUEL` (amber) | 1-row centered, persistent until swipe |
| `complete` / `summary-workout` / `summary-race` / `tomorrow-summary` | CompleteFace | workout-type label | Done button overlays bottom |
| `cruise-lobby` / `lobby-easy` / `lobby-race` | LobbyFace | workout/race name | START button overlays bottom |
| `calibrate` | CalibrateFace | `CALIBRATE` | redesigned: dropped +/- stepper, big "Set mile N" button |

### 🟡 Intentional takeover exceptions (8)
Don't inherit the law on purpose. 1.5–3s full-bleed flashes (countdown, race-day cues, mile splits).

| Fixture | Struct | Reason |
|---|---|---|
| `headsup` / `headsup-time` | HeadsUpFace | 2.6s amber takeover ("0.25 LEFT") |
| `phase-change` | PhaseChangeFace | race-day phase transition, mountain glyph |
| `landmark` | LandmarkFace | course cue (calm blue, diamond glyph) |
| `milesplit` / `tomorrow-milesplit` | MileSplitFace | auto-lap flash |
| `countdown` / `endcountdown` | CountdownView | David's locked exception — big number countdown |

### 🔴 Flagged for review (4)
Need a design + UX decision before conversion or keeping custom.

| Fixture | Struct | Notes |
|---|---|---|
| `pause` / `tomorrow-pause` | LivePauseFace | greyed-out distance + elapsed + Resume capsule. Could become NumberFace + button overlay (like Complete), but the visual treatment (greyed, monochromatic) signals "frozen" — keep that read |
| `justrun` | JustRunFace | tiny tag + big figure.run icon + START. Minimal data. Conversion would lose the icon hero |

---

## Code map

```
legacy/native/Faff/
├── Faff.xcodeproj                       Project (open in Xcode)
└── FaffWatch Watch App/
    ├── FaceKit.swift                    NumberFace + Role + NumRow + Strip + LSB table
    ├── Faces.swift                      All face structs (WarmupFace, RestFace, etc.)
    ├── WatchFixtures.swift              -face <name> switch, fixture renderings, sample data
    ├── ActiveWorkoutView.swift          PRODUCTION wiring: LiveWarmup / LiveRep / LiveSteady route engine state to faces
    ├── WorkoutEngine.swift              State machine (start, advance, tick, pause, overtime)
    ├── WorkoutTracker.swift             Sensor data (HK + GPS + sim mock)
    ├── WatchWorkoutModels.swift         WatchWorkout / WatchPhase Codables, PaceFormat
    ├── WatchTheme.swift                 Color palette, font registration
    ├── CountdownView.swift              3-2-1 pre-start countdown
    ├── ResponsiveFace.swift             Scales canvas uniformly per device
    └── ... (other supporting files)

docs/
├── watch-faces-2026-05-26.html          ⭐ visual contact sheet (open in browser)
└── watch-face-design-handoff.md         ⭐ this file
```

To run the app:
1. Open `Faff.xcodeproj`
2. Scheme: `FaffWatch Watch App`
3. Destination: `Apple Watch Ultra 3 (49mm)` (or any watchOS sim)
4. Run (`⌘R`)

To see a specific fixture: launch with `-face <name>` arg. Example: `xcrun simctl launch <SIM> run.faff.app.watchkitapp -face cruise-warmup`.

To exercise the engine end-to-end: launch with `-cruise -warp 30 -autostart` (loads sample cruise workout, time-warps 30×, auto-starts past the lobby).

---

## What's open / opinions wanted

### Per-face semantic decisions
- **HRFace label** — currently `"MAF"` (Maffetone aerobic ceiling). Also used for Z2 and heat-flag training. Options: keep `MAF`, generalize to `Z2`, generalize further to `HR` or `HEART`. Or parameterize so the live caller picks based on workout type. Brand voice: David is a serious runner so methodology terms (`MAF`) are not too jargon-y.
- **Distance row color in overtime** — currently purple (`.bonus`). David explicitly approved this on 2026-05-26.
- **OVERTIME row order** — now `pace · elapsed · distance` (matches EasyFace convention). Locked.

### Faces still in review pile
- **`pause`** — keep the greyed-monochromatic frozen treatment, or convert to standard NumberFace with a `PAUSED` top label? The greyed look strongly signals "frozen" but breaks the system. Worth a design opinion.
- **`justrun`** — tiny tag + big icon hero + START. Could become a NumberFace with `topIcon: "figure.run"` and zero big rows. Would lose visual punch.
- **`splits`** — per-rep split table (rows of "1 / 6:29", "2 / 6:30", ...). Different layout primitive than NumberFace (table of small rows, not stacked-big-numbers). Probably stays custom or wants its own primitive.

### Aesthetic-level questions (free-fire)
- **Density** — current canonical face shows 5 lines (label + 3 rows + label). Is that too dense at watch-glance? Should some faces be sparser?
- **Color usage** — is the role-based grammar (green=on-target, blue=distance, etc.) reading clearly? Any rows where the color is fighting the meaning?
- **Hierarchy** — top label is small (8% H) and the same color as bottom subtitle (mute). Should the top label be more prominent? Currently it just rides the clock baseline.
- **Icons** — heart.fill / figure.run / flame.fill / clock are all SF Symbols at ~42% of row font size. They sit at the right of the digits. Are they doing enough work, or noise?
- **Transitions** — currently haptics fire on phase change but no visual animation between faces (instant swap). Worth designing transitions, or is instant better for glanceability?
- **Bottom labels** — currently `"1.0 mi · 6:47"` style. Bullet separator (`·`) is consistent. Should they be MORE prominent (semibold? different color?), or LESS (fade them more)?

### Constraints to respect
- **Brand fonts**: HelveticaNeue-Bold locked. SF Pro / SF Mono / SF Compact all rejected.
- **Black background**: locked for non-takeover faces.
- **The 9 layout rules**: locked. Anything that violates them needs explicit David approval (preferably in writing).
- **Clock baseline**: WARMUP-tier labels ALWAYS share the OS clock baseline. Non-negotiable.

---

## Recent changes log (2026-05-26)

- Watch face law established (the 9 rules above)
- 10 faces converted to NumberFace (Fuel, Complete, Lobby, Calibrate + tomorrow/summary variants)
- `bottomReservation` parameter added (button overlay pattern)
- Width-cap binds by widest row (fixes h:mm:ss overflow)
- 1-row auto-centering (GO, FUEL, CALIBRATE no longer top-heavy)
- CALIBRATE redesigned (no stepper, single Set button)
- OVERTIME rows reordered to pace · elapsed · distance (matches EasyFace convention)
- `firstCharLSB("1") = 0.115` empirically calibrated (rows starting with "1" now left-align with rows starting with "9"/"8")
- HTML contact sheet generated (all 45 fixtures at watch scale)

## Bugs identified but not yet fixed

1. **Mile-split flash fires during work rep** — distracting during structured intervals. Should be gated to non-work phases (warmup / cooldown / just-run). Engine fix: 1-line guard in `WorkoutEngine.tick()` around `flash(.split(...))`.
2. **Engine end-to-end behavior unverified for today's specific failures** — David reported on a real run: time counter went UP instead of DOWN, intervals never advanced, distance wasn't tracking. Engine code review suggests the logic is correct; a test suite covering auto-advance + countdown + distance tracking has been written but couldn't run tonight due to a Xcode 26 / watchOS sim test-runner regression (Pseudo Terminal Setup Error). Tests are at `legacy/native/Faff/FaffWatch Watch AppTests/WorkoutEngineTests.swift` and ready to run via `⌘U` in Xcode after a Mac reboot.

---

## How to propose changes

1. **Visual / aesthetic opinions** — open `docs/watch-faces-2026-05-26.html` in a browser, annotate or describe by fixture name. The card shows the fixture, struct, label, and any notes.
2. **Layout rule changes** — propose against the 9 numbered rules. Locked rules require explicit David sign-off.
3. **New face proposals** — default answer is "build it on NumberFace and inherit the law." If a new face genuinely can't fit the system, write up the constraint and propose either an extension to NumberFace or a new primitive.
4. **Per-face label changes** — easy. Just identify the face by fixture name and propose the new label string + reasoning.

The whole system is centralized — most face changes are 5-10 line edits, not hundreds. The law in `NumberFace` does the heavy lifting.
