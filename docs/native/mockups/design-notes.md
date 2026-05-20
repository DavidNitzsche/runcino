# Faff.run native · design notes

Companion to the HTML mockups in this folder.  Explains typography,
color, spacing, and HIG-deviation rationale so the SwiftUI
implementation follows the design intent, not just the layout.

Reviewed alongside the mockups · approve, push back, or call out
the specific decision that needs change.

---

## Typography

### iOS (iPhone)

System fonts only — Apple's SF Pro Display + SF Pro Text.  Web's
font stack used Inter (very close to SF Pro), so the visual family
carries cleanly.

| Style | Font | Size | Weight | Used for |
|---|---|---|---|---|
| Display L | SF Pro Display | 48pt | Bold (700) | Login brand wordmark "faff.run" |
| Title L | SF Pro Display | 34pt | Bold (700) | Large-title nav ("Today", "History", "Settings") |
| Title M | SF Pro Display | 22-26pt | Bold (700) | Card headlines, workout name, race name |
| Headline | SF Pro Text | 17pt | Semibold (600) | Body emphasis, nav bar titles |
| Body | SF Pro Text | 15-17pt | Regular (400) | Default body text |
| Subhead | SF Pro Text | 14-15pt | Regular (400) | Detail text under headlines |
| Footnote | SF Pro Text | 12-13pt | Regular (400) | Helper text, captions |
| Caption | SF Pro Text | 10-11pt | Semibold (600) | Section labels (TRACK ALL CAPS) |
| Number L | SF Pro Display | 22-34pt | Bold (700) | Stat block values |
| Number M | SF Pro Display | 16-19pt | Bold (700) | Smaller stat values |

**Dynamic Type**: critical text reflows under 2× scale.  Stat-block
numbers use SF Pro Display because it scales cleaner at large sizes;
body text uses SF Pro Text for legibility at small sizes.

### watchOS (Apple Watch)

System fonts: SF Compact (Apple's watch-optimized variant).  Smaller
x-height, tighter spacing, designed for legibility at 1-2 second
glances.

| Style | Font | Size | Weight | Used for |
|---|---|---|---|---|
| Hero numeral | SF Compact Display | 56-72pt | Extra-bold (800) | The big number on each screen (interval timer, current pace, recovery countdown) |
| Secondary numeral | SF Compact Display | 32-38pt | Bold (700) | Target pace, warmup elapsed |
| Stat numeral | SF Compact | 14-18pt | Bold (700) | Bottom-row stats (HR, distance, etc.) |
| Headline | SF Compact | 14-19pt | Semibold (600) | Workout name on idle screen |
| Body | SF Compact | 12-14pt | Regular (400) | Detail lines |
| Label | SF Compact | 9-11pt | Bold (700) | ALL-CAPS phase labels, stat labels |

**Letter spacing** intentionally tight on big numerals (-2 to -3pt)
· hero numerals at 56pt+ need negative tracking to feel
proportional.

---

## Color palette

Mirrors faff.run web app exactly.  Reuses the same hex values for
consistency across the three surfaces.

### Brand + state

| Color | Hex | Used for |
|---|---|---|
| **Orange (race)** | `#E85D26` | Primary accent · brand · race hero · CTAs · primary actions |
| Orange soft | rgba(232,93,38,0.12) | Backgrounds for orange-tagged chips |
| **Green** | `#1f6a21` | Positive state · recovery · readiness green · "on track" · save button |
| Green soft | rgba(31,106,33,0.12) | Recovery card backgrounds, success chips |
| **Amber** | `#B3450A` | Warning · drift state · partial-completion · paused state |
| Amber soft | rgba(179,69,10,0.12) | Paused header background |
| **Red** | `#c92a2a` | Error · sustained drift · end-workout button · sign-out |
| Red soft | rgba(201,42,42,0.10) | Error card backgrounds |
| Blue (warmup) | `#2c5fc7` | Warmup chip + timer color · distinct from work-orange |
| Purple (cooldown) | `#6f42c1` | Cooldown chip + timer color · distinct from warmup-blue |

### Light mode (iPhone + watch)

| Token | Value | Used for |
|---|---|---|
| `--bg-l` | `#ffffff` | Main background |
| `--bg-l-2` | `#fafafa` | Card backgrounds |
| `--border-l` | rgba(13,15,18,0.08) | Hairlines, subtle dividers |
| `--border-l-2` | rgba(13,15,18,0.16) | Button borders, stronger dividers |
| `--text-l` | `#0D0F12` | Primary text |
| `--text-l-2` | rgba(13,15,18,0.65) | Secondary text |
| `--text-l-3` | rgba(13,15,18,0.45) | Tertiary text, placeholders |

### Dark mode (iPhone + watch)

Pure black background on the watch is intentional (OLED + battery).
iPhone uses pure black too for OLED parity; the dark-system grays
(`#1c1c1e`) are reserved for card backgrounds.

| Token | Value | Used for |
|---|---|---|
| `--bg-d` | `#000000` | Main background (OLED-friendly) |
| `--bg-d-2` | `#1c1c1e` | Card backgrounds |
| `--border-d` | rgba(255,255,255,0.10) | Hairlines |
| `--border-d-2` | rgba(255,255,255,0.18) | Stronger dividers |
| `--text-d` | `#ffffff` | Primary text |
| `--text-d-2` | rgba(255,255,255,0.72) | Secondary text |
| `--text-d-3` | rgba(255,255,255,0.50) | Tertiary text |

---

## Spacing

### iPhone

| Token | Value | Used for |
|---|---|---|
| Edge padding | 20pt | Horizontal page margins |
| Card padding | 18pt | Card interior |
| Card vertical gap | 16pt | Between cards |
| Section gap | 24-30pt | Between sections |
| Row padding | 14pt vertical | List rows |

### Watch

| Token | Value | Used for |
|---|---|---|
| Edge padding | 14-16pt | Screen edges |
| Top padding | 16-18pt | Top edge (status area) |
| Bottom padding | 12-14pt | Bottom edge |
| Stat gap | 6-8pt | Between stats in row |

---

## HIG deviations · documented

Faff.run mirrors faff.run web's voice + visual identity.  When iOS
HIG demands a different pattern, we deviate deliberately.

### iPhone deviations

1. **Tab bar uses Faff orange for active state, not iOS blue.**  iOS
   default is system blue.  We use the brand orange to keep visual
   identity consistent with web.

2. **Race hero uses a custom gradient card.**  iOS HIG doesn't have
   a "hero" pattern · we borrow from sport app conventions (Strava,
   Apple Fitness) and add the brand gradient to signal "this is the
   A-race, the thing that matters."

3. **Settings page uses iOS-native grouped lists.**  No deviation
   here · the native pattern works perfectly for fitness settings.

4. **Login screen is intentionally bare.**  No iOS-styled toolbar,
   no "back" affordance, no settings access.  The pre-auth experience
   is just the brand + form · matches what web does.

### Watch deviations

1. **Workout phase screens use a single big number + small context.**
   Apple's native Workout app shows multiple metrics simultaneously
   (HR, pace, time, distance, elevation, calories).  We deviate · we
   show ONE focal number + 2 context numbers.  Rationale: 2-second
   attention window during runs.  HIG bends to the use case.

2. **Color-coded phase chips at top.**  Apple's native app doesn't
   chip-tag phase types · workouts on the native app are unstructured.
   Our workouts are structured · the chip is informational at a
   glance.

3. **End-workout uses a red "END" button on the paused screen,
   green "SAVE" on summary.**  iOS HIG warns against red except for
   destructive actions · ending a workout IS destructive (loses data
   if not saved), so red is appropriate.  Save = green is positive
   confirmation.

4. **Brand wordmark "faff" in icon (not pictogram).**  Apple's
   default for sport apps is a pictogram (a running figure, a heart,
   etc.).  We use the wordmark because the brand is short (4 chars)
   and recognizable.  Future iteration may add a pictogram if the
   wordmark proves unrecognizable at smaller sizes.

---

## Voice consistency

Native apps inherit the V6 voice rules from web:

- **Second-person warm** when speaking to runner's body/state
  ("Ease down. Nice work." on cooldown screen)
- **Impersonal observation** when reporting data ("3 threshold
  workouts trended faster")
- **"We"/"our"** when coach is making a verdict ("What would change
  our mind:")

The watch screens deliberately use minimal copy · the 2-second
attention window doesn't allow for prose.  Visual + haptic carries
the cue.  Prose copy only appears on:
- Cooldown screen ("Ease down. Nice work.") · low-stakes warmth
- Paused screen ("in Interval 3/6 · frozen at 6:31 target") · context
- Summary screen (none beyond stat labels) · the work speaks

---

## Open design questions for David · ANSWERED in round 2

These were the 6 open questions from round 1. All answered + locked
in round 2 deliverables. Original questions kept for archaeology;
answers below each.

1. **App icon · wordmark vs pictogram?**  Mockup uses lowercase "faff"
   wordmark on orange gradient.  Alternative: orange "F" monogram,
   or a running-stride pictogram.

   **ANSWERED · dual-asset split, Apple-standard pattern.**
   - iPhone: wordmark "faff" (italic Bebas Neue, orange gradient) — reads cleanly at 60×60+ pt
   - Watch: italic "f" monogram — 24pt-legible, matches Apple Watch home grid rhythm
   - Pictogram REJECTED · visually indistinguishable from Apple Workout (brand-recognition risk)
   - Capital "F" REJECTED · loses italic-wordmark brand link
   - See `watch/icon-options.html` for rendered candidates at 100pt / 50pt / 24pt + honeycomb context

2. **Light mode default vs dark mode default?**  Currently: light on
   iPhone (matches iOS system default), dark on watch during
   workouts (battery + glare).  Alternative: full system-respect
   (dark when iOS is dark, light when iOS is light).

   **ANSWERED:**
   - iPhone: respect system setting. No surprises.
   - Watch: nuanced. During active workouts, force dark regardless of system (OLED battery + outdoor glare + sweat-on-screen contrast). Outside workouts, follow system.
   - The transition (watch in light mode pre-workout → workout starts → screen goes dark) must feel intentional, not glitchy. Implementation requirement for SwiftUI animation.

3. **iPhone tab bar · 4 tabs (Today / History / Race / Settings) or
   fewer?**  4 tabs is the iOS sweet spot.  If you'd rather defer
   History to a "+ menu" or drop it, the tab count goes to 3.

   **ANSWERED · three tabs for v1: Today / Race / Settings. History dropped.**
   - Reasoning: history is web-screen-real-estate work (trends, splits, retrospectives). iPhone is daily-touch.
   - Cascading impact: Race detail does not link to "see all past races" so no rerouting needed. Per-workout history access (rare) comes via the Race detail screen or a Settings sub-screen.
   - All mockups using a 4-tab bar (signals-suspended.html, others) updated round 2 to 3-tab layout.

4. **Race detail screen · projection chart deferred?**  C9 chart not
   shown on iPhone v1.  Web has it.  Easy to add if you want it on
   iPhone too — would push the trajectory card down on the screen.

   **ANSWERED · defer C9 chart on iPhone v1.** Trajectory tile (AHEAD / ON TRACK / BEHIND / COLLECTING) carries the read. Chart's depth-across-12-weeks value needs screen real estate, doesn't compress to iPhone. Web keeps the chart; native users wanting depth open web for deep race planning.

5. **Drift alerts · audible vs haptic-only?**  Currently haptic-only
   (the watch buzzes).  Adding an audible cue ("ding") for sustained
   red drift could help on noisy runs · but requires user permission
   for audio playback during workouts.  Defer or include?

   **ANSWERED · haptic-only for v1.** No audio. Audio = permission management, music conflicts, headphone routing, no-headphones edge cases. The watch buzz is the entire point. If v1 testing reveals haptics aren't catching attention during hard intervals (sweat, motion, sleeve coverage), revisit. Don't add audio speculatively.

6. **Watch app icon · approval needed.**  Mockup shows the wordmark
   on the orange gradient.  Approve or send back for iteration.

   **ANSWERED in #1 — italic "f" monogram (not wordmark) on watch.**

---

## Round 2 design decisions · captured for SwiftUI implementation

### Work interval screen · ONE pattern, THREE configurations

Highest-stakes screen. One layout pattern adapts to workout context.

**Hero metric defended** — current pace, not target. During execution
the runner is working AGAINST current pace; target is the prescription
already known going in. Delta chip color carries the read in 0.5s
(green/amber/red).

**Three variants:**
1. **Threshold/interval** — pace prescription · current pace hero ·
   target reference · HR small in footer
2. **Easy / Z2 ceiling** — HR prescription · HR hero · ceiling
   reference (labeled "CEILING" not "TARGET") · pace demoted to footer ·
   phase chip turns green
3. **Race-pace + HR ceiling** — both prescriptions · pace hero
   (like #1) · amber/red HR-ceiling chip overlay top-left when CV
   cost climbs into the warning band

**Decision tree** (lives in code):
```
pace_target AND NOT hr_ceiling → V1
hr_ceiling AND NOT pace_target → V2
both → V3
```

See `watch/work-interval.html` for all three variants + inline
design defenses.

### Recovery screen · counts UP, not down

The relevant question during recovery is "how long has this lasted?"
not "how much is left?" The runner asks "am I ready to start the next
rep?" HR drop is the answer to that, not the clock.

**State machine:**
- State A (mid-recovery): HR still elevated, elapsed counter counts up
- State B (HR cleared, ≤130 bpm or 72% of max HR): "READY ✓" chip
  appears + soft single-pulse haptic; runner can tap to start next rep early
- Recovery max-cap: planned duration (60s) is the upper bound; HR-clear
  is the floor; auto-advance at planned end even without HR clear
- If HR didn't clear by planned end: rep starts on schedule, watch
  flags it in summary as "rep N started with elevated HR"

This is V5 doctrine · physiology over prescription, prescription over guess.

See `watch/recovery.html` for both states.

### Always-on display · designed separately, not just dimmed

Six AOD design principles applied uniformly across all four phase
screens (warmup / work / recovery / cooldown):

1. Pure black background always (overrides system light-mode setting)
2. Hero numeral desaturates to pure white (highest-contrast value)
3. State color collapses from saturated fill to a 2px accent strip
   (orange=work, green=recovery, blue=warmup, purple=cooldown, amber/red=drift)
4. Delta chip loses background fill, becomes tinted text only
5. Footer labels shrink to 8pt at 40% opacity but are kept (safety
   net for sweat / sleeve coverage / late-night conditions)
6. Refresh: HR/pace/cadence at 1Hz, elapsed at 1Hz, distance at 0.5Hz

**SwiftUI implementation requirement:** use the `isLuminanceReduced`
EnvironmentValue. Each phase view renders a conditional branch on
this value · don't compute AOD layout from active layout at runtime ·
ship two distinct render paths so each can be optimized independently.

See `watch/always-on.html` for active + AOD pairings per phase.

### OLED orange tuning

Brand orange `#E85D26` on web is sRGB-tuned for backlit LCD. On
Apple Watch OLED it appears more saturated and "loud" with halation
around the boundary.

**Proposed dark-mode palette** (Assets.xcassets ColorSets with Light + Dark variants):

| Color | Light (web hex) | Dark (OLED-tuned) | Δ |
|---|---|---|---|
| race-color | #E85D26 | #DC5F2E | −4% saturation |
| recovery | #2CA82F | #4ade80 | lighter for OLED |
| warn | #B3450A | #F3AD38 | much lighter — readable on black |
| red | #c92a2a | #ff7070 | lighter for OLED contrast |
| blue-warmup | #2c5fc7 | #6f9bff | lighter |
| purple-cooldown | #6f42c1 | #b85cff | slightly desaturated |

**Open issue:** final lock requires physical device testing at three
light conditions (indoor / sunlight / dawn-dusk). Mockup approves
the candidate range; hardware approves the final hex.

See `watch/oled-orange-test.html` for swatch grid + side-by-side
work-interval rendering at 100% vs 96% saturation.

### Dynamic Type 2× survival

Most-cluttered Today layout rendered at 1.0× / 1.5× / 2.0× scales.
Hierarchy survives all three. One known fix:

- Recovery row (Sleep / RHR / HRV) switches to vertical stack at
  >1.8× DT via SwiftUI ViewThatFits

Optional: cap large-title at 1.8× via `.dynamicTypeSize` modifier so
"Tuesday" doesn't dominate the viewport at 3×.

See `iphone/today-dynamic-type.html` for the rendered comparison.

### Voice consistency · V6 maintained across surfaces

Every copy string on every screen tagged by V6 voice rule (warm
second-person · impersonal observation · coach verdict "we"/"our").
35+ strings audited; no deviations currently.

Banned patterns confirmed absent:
- No exclamation marks
- No emoji except utility marks (✓, ⚠, ▶, etc.)
- No "Keep going" / "Great job" generics
- No adjectives on numbers
- No second-person warmth on pure data

Coach line "Last time (4/15)…" deliberately identical on iPhone Today
and watch idle — runner experiences one coach voice regardless of surface.

See `voice-audit.html` for the full string-by-string audit.

### Annotation tooling · round 2 review infrastructure

Self-bootstrapping inline-note system shared by all mockup pages
(`assets/annotate.js` + companion CSS). Toolbar top-right gives:

- **Annotate** · click any element to leave a status-tagged note (approved / iterate / question)
- **Notes** · side panel listing all notes on current page, click to jump-scroll
- **Export all** · single markdown doc, all pages, status counts per page
- **Import** · paste markdown back, notes re-anchor by CSS selector

Notes persist via localStorage. Status pins (numbered, color-coded by
status) overlay each annotated element.

**Workflow:** David toggles Annotate, leaves notes, exports MD, sends
back. Claude opens any mockup, hits Import, pastes the markdown — sees
every note re-anchored in context. Round 3 iterates from that input.

---

---

## What gets implemented when

The mockups become the spec.  SwiftUI implementation phases:

1. **iPhone screens** · Login → Today → Settings → History → Race detail · v0 already has Login + Today (placeholder); refine to mockup spec, then add the three new screens

2. **Watch idle/start screen** · simulator-testable, no HKWorkoutSession needed yet

3. **Watch workout screens** · state machine + phase rendering · simulator-testable

4. **Watch HKWorkoutSession integration** · live HR + pace + distance · requires physical Apple Watch

5. **Watch haptics + transitions** · requires physical Apple Watch for timing validation

6. **Watch summary + completion writeback** · ties to backend POST

Edge states are written alongside each happy-path screen · not a
separate phase.

---

## Approval workflow

1. Open `index.html` in browser
2. Click through each mockup, light + dark side by side
3. For each mockup that needs change · screenshot/note the specific
   element + the change
4. Reply with the list
5. I iterate the HTML
6. You re-review
7. When approved · mockups freeze · SwiftUI implementation begins
   against the locked spec
