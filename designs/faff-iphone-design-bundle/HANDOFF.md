# Faff · iOS handoff

A working, navigable HTML mockup of the Faff app, assembled from the **28 approved iOS screens**. This is the spec for building the real iOS (SwiftUI) app. Open **`Faff App.html`**.

---

## 1. What's here

```
Faff App.html        ← the running app shell (open this)
app/
  tokens.css            ← design tokens: TYPE SYSTEM + palette + effort scale
  shell.css             ← host chrome (iPhone frame, status bar, tab bar, sheets)
  screens.js            ← screen registry: every screen's role + tab mapping
  shell.js              ← router: gate flow, tab nav, push/pop, modals, launcher
screens/                ← the 28 approved screens, one file each (chrome-stripped)
uploads/                ← original source screens (untouched, for reference)
Faff Web App.html       ← the canonical web app (type-system source of truth)
```

Every screen in `screens/` is a self-contained view sized to a 393×852 iPhone. The host
shell loads them and provides the persistent chrome + navigation. For the iOS build, each
`screens/*.html` maps to one SwiftUI view.

---

## 2. Type system  (this was the correction)

The approved screens originally used Hanken Grotesk + JetBrains Mono · **wrong**. They now
match the canonical web app:

| Role | Font | Usage |
|---|---|---|
| **Brand wordmark** | **Anton** | "Faff" lockup only · uppercase · skewed −9° · gradient sweep |
| **Display + numerics** | **Oswald** (500/600) | headlines, big stats, ring values, paces, countdowns, gap numbers · condensed · tight tracking |
| **Body / UI** | **Inter** (400–800) | paragraphs, labels, eyebrows (tracked caps), captions, buttons |

SwiftUI: map Oswald → a condensed display face, Inter → body. Numerics are Oswald, **not** a
monospace. See `app/tokens.css` for the scale.

---

## 3. Color & the effort idea

The product's core concept is an **effort temperature scale** · every run/day has a
temperature, cool (recovery) to hot (race), and the background mesh + accents are driven by it.
The **canonical color export** (effort dots + meshes, view meshes, HR zones, shoe roles, accents)
lives in **`color-system.md`** · match it exactly.

```
EFFORT DOTS  recovery #27B4E0 · easy #48B3B5 · long #F3AD38 · tempo #FF8847 · intervals #FC4D64 · rest #8A90A0
SEMANTIC     green #3EBD41 · goal #F3AD38 · over #FC4D64 · dist #27B4E0 · rest #008FEC · race #FF8847
```

Every page outside Today uses a view mesh; the Today mesh re-themes per the selected workout's
effort key with a 0.7s ease. Full token set in `colors_and_type.css` and `color-system.md`.

### Color tokens (Swift) · drop into `Color+Faff.swift`
```swift
extension Color {
  static let faffBg    = Color(hex: 0x0A0C10)
  static let faffCard  = Color(hex: 0x11141A)
  static let faffTxt   = Color(hex: 0xF6F7F8)
  static let faffMute  = Color(hex: 0x8A90A0)
  static let faffLine  = Color.white.opacity(0.08)
  // semantic
  static let faffGreen = Color(hex: 0x3EBD41)
  static let faffGoal  = Color(hex: 0xF3AD38)
  static let faffOver  = Color(hex: 0xFC4D64)
  static let faffDist  = Color(hex: 0x27B4E0)
  static let faffRace  = Color(hex: 0xFF8847)
  // effort dots
  static let effortRecovery  = Color(hex: 0x27B4E0)
  static let effortEasy      = Color(hex: 0x48B3B5)
  static let effortLong      = Color(hex: 0xF3AD38)
  static let effortTempo     = Color(hex: 0xFF8847)
  static let effortIntervals = Color(hex: 0xFC4D64)
  static let effortRest      = Color(hex: 0x8A90A0)
}
```

---

## 4. Navigation map

**Front door (gate)** → `signin` → `rolepick` → `onboarding` → **enter app**

**Tab bar** (persistent, 5 tabs):
`Today (effort)` · `Train` · `Activity` · `Health` · `Targets`
Profile is reached via the **avatar** in a tab header.

**Today states** (variants of the Today tab): `restday`, `coldstart` (default = `effort`).

**Pushed detail screens** (slide in, host back button):
- Activity → run card → **rundetail**
- Train → **weekahead** → **planned** → (start) → **watchmirror** → **completed**
- Today / Planned → start → **watchmirror**; **treadmill**; **raceday**
- Profile → **settings**, **shoes**, **pro** → **paywall**
- **spectator** (cheer-mode follow, from the role picker's "cheer" path)

**Coach moments** (modal sheets): `nudge` (readiness retune), `withinreach` (PR within reach),
`weekly` (weekly check-in), `pr` (PR celebration). In the mockup the coach bell on Today opens
`nudge`; all four are reachable from **All screens**.

> The mockup wires the high-confidence paths (tab bar, gate, avatar→profile, card→detail,
> start→live, profile rows). **Every** screen is reachable from the **All screens** launcher
> (the grid button top-right, the Dynamic Island, or press `g`), grouped by flow · that grid
> doubles as the full flow overview.

---

## 5. How the mockup is built (and what's mockup-only)

- Screens are loaded in iframes; the host reaches into each (same-origin) to strip its old fake
  bezel / status bar / caption and wire taps to the router. **For iOS, ignore the iframe
  mechanism** · it's just how 28 standalone HTML files are composed into one shell here.
- The iPhone frame, Dynamic Island, status bar, tab bar and home indicator are **host chrome**
  (`shell.css`) · the real status bar / tab bar should be native.
- Each screen keeps its own animated mesh + micro-interactions (scrubbable traces, drag sheets,
  calendars, heatmaps). Those are the intended behaviors; rebuild them natively.
- State (current tab + nav stack + modal) persists to `localStorage` so a refresh keeps your place.

---

## 6. Screen inventory (28)

Front door: signin, rolepick, onboarding ·
Tabs: effort (Today), train, activity, health, targets ·
Today states: restday, coldstart ·
Detail & live: weekahead, planned, rundetail, completed, watchmirror, treadmill, raceday ·
Profile: profile, settings, shoes, pro, paywall ·
Coach moments: nudge, withinreach, weekly, pr ·
Social: spectator · Reference: shell (original tab-bar study).

---

## 7. Fonts (handoff detail)

The mockup loads three families from Google Fonts via CDN. **No font files are bundled** · the
HTML just links them. All three are **Open Font License**, so they can ship inside the iOS app.

| Role | Family | Weights used | iOS PostScript names |
|---|---|---|---|
| Brand wordmark | **Anton** | 400 | `Anton-Regular` |
| Display + numerics | **Oswald** | 300–700 (mostly 500/600) | `Oswald-Light/Regular/Medium/SemiBold/Bold` |
| Body / UI | **Inter** | 400–800 | `Inter-Regular/Medium/SemiBold/Bold/ExtraBold` |

To bundle in SwiftUI:
1. Download the families (Google Fonts → "Get font" / `fonts.google.com/specimen/{Anton,Oswald,Inter}`), add the `.ttf`s to the app target.
2. Register them in `Info.plist` under `UIAppFonts`.
3. Use via `Font.custom("Oswald-SemiBold", size:)` etc. Numerics are Oswald (apply
   `.monospacedDigit()`-style tabular figures where columns must align · Oswald has tabular nums).
4. Wordmark "FAFF·RUN": Anton, `text-transform: uppercase`, skew ≈ −9°, animated gradient sweep
   `#F43F5E→#FF5722→#F5C518→#14C08C→#4F8FF7→#F43F5E` with a yellow (`#F5C518`) dot between FAFF and RUN.

---

## 8. What Claude Code still needs (beyond these screens)

The screens are the **UI + interaction spec**. **Much of the backend already exists** · so this is
primarily a front-end build: implement these screens in SwiftUI and **wire them to the existing
backend / APIs** rather than rebuilding data or integrations. Still required:

1. **Bundle the 3 fonts** (see §7).
2. **Build the screens in SwiftUI** per the §4 navigation map (TabView + NavigationStack + sheets),
   preserving the type system (§2) and effort palette (`app/tokens.css`).
3. **Bind to existing backend** · map each screen to the data it already has. The entities the UI
   expects: `Run` (date, type/effort, distance, pace, time, splits, route, HR/zones),
   `PlannedWorkout` (segments, target paces, fuel, cues), `Target` (race *with* date or goal
   *without*; projected vs goal + the "gap"), `Shoe` (role, mileage, life), `Readiness`
   (score, HRV, RHR, sleep), `WeeklyRecap`, `Connection`. *(Confirm field names against the
   existing API · these are the shapes the screens render.)*
4. **Hook up existing integrations** in the onboarding "connect" step (Apple Health / Strava /
   Garmin) + Sign in with Apple/Google.
5. **Effort-temperature mapping** · each run/day's temperature (recovery→race) drives the mesh +
   accents; map workout type & readiness → palette (tokens in `app/tokens.css`). Wire to whatever
   readiness/classification the backend already provides.
6. **Coach surfaces** · nudge / within-reach / weekly recap / PR sheets + local notifications,
   driven by existing coach logic.
7. **Icons** · inline SVG today → SF Symbols or bundled SVGs.

Micro-interactions to preserve: scrubbable pace/HR trace (run detail), drag-up detail sheets,
calendar date picker (onboarding), consistency heatmap (activity), animated projection beam.

