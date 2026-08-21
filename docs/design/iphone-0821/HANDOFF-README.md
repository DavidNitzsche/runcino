# Handoff: faff.run iPhone App

## Overview
faff.run is a marathon-training coaching app. This bundle covers the full iPhone
"daily companion" surface: the three destinations (Today, Block, Races), every
screen reached from them (race detail, live run, onboarding, settings, shoes,
state screens), and the shared shell (status bar, bottom tab bar, RUN picker).

## About the Design Files
The file in this bundle (`Faff-iPhone-App.dc.html`) is a **design reference built
in HTML** — a working prototype used to design and review the screens, not
production code to copy directly. The task is to **recreate these screens
natively for iOS** (SwiftUI or UIKit, whichever the target codebase already
uses) using the codebase's existing patterns, navigation stack, and networking
layer. If no iOS codebase exists yet, SwiftUI is the natural choice given the
component structure described below.

The HTML file is self-contained: open it in a browser to see and click through
every screen (it also uses simulated state, e.g. clicking "+"/"−" on the
treadmill console updates the numbers live, tapping RUN opens the
Outdoor/Treadmill picker, tapping a shoe expands wear/retire options). Screens
are laid out side by side in one horizontal scroll for easy comparison; in the
real app each is its own full-screen view.

## Fidelity
**High-fidelity for screens 5a through 19a.** Colors, typography, spacing,
radii, and copy are final. Treat hex values and pixel measurements below as
exact. A few interactive affordances are intentionally left as no-ops in the
prototype (shoe "Change", Settings "Sign out") — these need real handlers in
the app but their visual design is final.

**Screens 20a through 24a are a first design pass, not yet approved.** They
cover seven pieces the v5 kit had no shape for at all (see "The seven new
pieces" below). Layout, components, and tokens all come from the same system
as the rest of the bundle, but treat the specific copy, field choices, and
sample data as a starting point for review, not a locked spec — particularly
the shoe-type list, which is explicitly a placeholder.

## Design tokens

**Ground and containment.** Pure black page (`#000000`). Four surface steps
above it: `#0F1011`, `#17191B`, `#212427`, `#2A2E32`. No borders anywhere —
containment is always a fill-step change, never a hairline. A tile inside a
tile steps up one fill level.

**Color — one accent, one meaning each:**
- Signal orange `#FF5A1F` — the runner's current position/value, the primary
  action, the one highlighted bar in any chart. Never means "good."
- Attention amber `#F2B03C` — outside its target range, stale data, a decision
  waiting. Never means "error." A modelled/projected number (not a hard read)
  carries a small amber `~` (tilde) immediately before its value — the app's
  one mark for "this number is estimated," used on the Races poster and on
  any training-derived (not race-confirmed) pace read.
- Fault red `#FF4438` — we could not read this value. Never used to render a
  real value.
- No green anywhere — this app never grades a number as "good."

**Type.** Two families:
- **Instrument Sans** — all interface text and numerals (tabular figures).
- **Archivo**, weight 800, width 112, uppercase — the display register used
  as the graphic itself (session type, screen headline). Not used below 20px.

Registers used across these screens: display 76/56/44/38px, value
28–104px (numerals), body 17/15px, label 14/13/12px. Nothing renders smaller
than 12px.

**Space scale:** 2 4 6 8 12 16 20 24 32 40 56 72 96 128 (px). Tile padding
18–20px. Stack gap 8px between tiles in a group, 20–24px between groups.

**Radius:** 6 / 10 / 14 / 18 / 22 / 26 / pill (999px). Larger surfaces get
larger radii. All pills (buttons, tab-bar RUN pill, range-scale tracks) use
999px.

**Shadow.** Flat by default. The only shadow in the system is under a phone
frame / floating sheet: `0 32px 80px -24px rgba(0,0,0,.85)`.

**Motion.** 120ms hover/press, 200ms fill/color transitions, 320ms sheet
slide-up (`cubic-bezier(.2,.7,.3,1)`, translateY 24px→0 with opacity
.4→1). Nothing bounces, pulses, or scales up.

**Day-state gradients** (135deg, interpolated in oklab so there's no hue
"crease" at the midpoint):
- Easy → `#3EBD41 → #1F8A52 → #0F4A3A`
- Rest → `#008FEC → #4A3A8E → #1C1A3A`
- Threshold/quality → `#F3AD38 → #E85D26 → #7A2828`
- Race → `#FF8847 → #E85D26 → #7A2828`
- Block phase → `#B084FF → #6A4ACE → #2A1A5A`
- Long run → `#27B4E0 → #1A6A9E → #0C2A5E`

Each gradient panel also carries a fine `feTurbulence` grain layer at 50%
opacity, `mix-blend-mode: overlay`, sitting between the gradient and the type —
this is what keeps white text legible on the gradient without a scrim.

## Shell (applies to every screen)
- Frame: 390×844pt, corner radius 44pt (standard iPhone proportions — build to
  the actual device safe areas, not a fixed 390×844 box).
- Status bar: 44pt band, system clock + signal/wifi/battery glyphs.
- One scrolling content band between the status bar and the bottom chrome.
- Bottom chrome: 62pt tab bar + 34pt home-indicator strip, both pinned.
- Tab bar destinations: **Today, Block, Races**, plus a filled **RUN** pill
  (signal-orange background) that only appears when "start runs from this
  phone" is on in Settings.
- Tapping **RUN** opens a bottom sheet from any screen: two choices, **Outdoor**
  (GPS pace and route) or **Treadmill** (speed and incline, no GPS) — see Live
  run below.

## Screens

### Today — before the run (5a)
**Purpose:** the day's prescription.
**Layout:** full-bleed gradient panel from the status bar down (rounded 30px
at the bottom corners only), scrolls away with the content. Panel contains:
place label ("Today") + a small round calendar-icon button + JR avatar button
(top-right, opens account sheet); a 7-day week strip (day letter, date number,
a status rail underneath); kicker (weather + duration) + display-face session
type (56px) + dose (28px value face); a translucent stats plate
(`rgba(255,255,255,.16)`, radius 18) with 3 values (pace band / ceiling /
effort).
Below the panel: instruction groups (Warm up / Work / Cool down, each a tile
with step rows), a "Why this run" CoachSay line, a "Where you are" list, and a
"Before you go" list (shoes picker, fuel, move/skip options — each expands
in place when tapped, replacing its own row rather than opening a new screen).
**Calendar icon** opens a full-height sheet: AppBar "Training calendar" +
one grouped list per week (each day row: date, type/dose or "Rest day",
"Today"/"Done" status).

### Today — after the run (5b)
Same panel grammar, but the poster reads distance/time/pace instead of a
prescription, and "Logged HH:MM" replaces the week line. Below: an
asked-vs-ran summary table (pace/heart/effort rows — effort is the only one
that's actually tappable, opening a 1–10 scale in place), a coach verdict,
per-mile instruction groups with actual numbers, a zone-time bar, a route
elevation profile (SVG line + start/end dots), shoes worn, "what this did to
the week," a "flag a niggle" row (expands to a body-part picker in place, and
once flagged shows a link to screen 13a), and a "Push to Strava" button.

### Today — after the run, treadmill (5c)
Identical to 5b except: kicker reads "Treadmill · indoor, no GPS" (no
weather), and the route/elevation card is replaced by an "On the belt" card
showing avg speed (mph) and avg incline (%) side by side.

### Block (6a)
**Purpose:** where today sits in the 16-week plan.
Panel: phase name (display, 56px) + "N weeks to [race]" + a stats plate
(quality share / long run / this week's mileage). Below: a phase-arc bar
(PhaseBar component, current phase highlighted), a coach line on where this
goes, "so far in this block" stats, a **"Change the plan"** row (opens a
bottom sheet with **5 scenarios**: cutback, travel, extra day, another race,
move a day), all 16 weeks listed (not sampled) as rows sized by that week's
biggest day, each expandable to long run / quality count / mileage, and a
workout library list.

**Change the plan is real output, not sample copy**, and its trade-off
strings are built from conditional clauses, not fixed sentences — e.g.
cutback names the second quality session becoming easy only when a quality
session is actually displaced, and another-race's second sentence swaps
entirely by race priority (a C race gets one line; an A/B race gets a
different, longer one naming the taper-like days around it). The sheet must
hold its **longest realistic string** without scrolling — another-race with
an A-race and a displaced session runs 5 clauses (the last one is itself two
sentences, 6 sentences total) — the wrap risk concentrates at the end of the
string, not spread evenly, so size the container for that.

**The sheet has a refusal state.** A scenario can come back unavailable with
a reason (a cutback on a taper week, a race week, a week already cut or
underway) — shown as an `Alert`, no confirm button, since a refusal is a
correct answer, not an error. The prototype demonstrates this concretely on
**travel**: it's a real **date-range picker** (from/to), not a length
toggle — the actual endpoint takes a date range and the server decides
satisfiability against that runner's specific block (where the weeks fall,
what's in them), not a fixed day-count boundary. The prototype's pass/fail
check is a placeholder standing in for that server call, not the real rule.

**Caveats get quieter treatment than the trade-off.** Another-race's
trade-off is a forecast, not the actual result (the plan engine re-authors
the surrounding weeks once it runs) — that caveat renders as a small quiet
line below the CoachSay, not folded into the trade-off sentence itself.

**One caveat that doesn't show on screen, worth knowing:** extra-day changes
the block only — it doesn't touch the runner's saved weekly frequency, so a
later full plan rebuild reverts it.

### Races (7a)
**Purpose:** is the A-race goal still realistic.
Panel: "Next A race" + race name (display, 56px) + date/distance + a stats
plate (Goal / Projected / Gap — gap in amber when behind; Projected carries
the modelled `~` mark). **Two axes drive the decision card, and both are
real:** the design's 8 triggers are *why we're asking now* (a discrete
event); the backend's 8 verdicts are *what it thinks of the goal today*
(`comfortable · realistic · ambitious · aggressive · out-of-reach ·
open-ended · date-passed · unreadable`), shown as a quiet badge on the card
regardless of trigger. The trigger decides the card's **shape**, not just its
copy — only 4 of the 8 triggers are actually a decision about the goal:

| Trigger | Verdict badge | Shape |
|---|---|---|
| Fitness ahead of goal | Comfortable · realistic | Decision |
| Fitness behind goal | Aggressive | Decision |
| Evidence gone stale | Unreadable | Decision |
| Returning from injury | Out-of-reach · date-passed | Decision |
| Race-morning heat | Unchanged | Fact |
| Course changed | Unchanged · projection moves | Fact |
| Chip-time lock approaching | Training effort · race to lock in | Fact |
| Two A races conflicting | Open-ended, loosely | Choice |

**Decision** shape: safe target, stretch target, up to 3 cautions, and 3
buttons naming real numbers ("Hold the goal" / "Take 3:16:45" / "Not now").
The button row wraps (`flex-wrap`, no forced `nowrap`) so a longer label like
"Wait for Saturday" drops to its own line instead of clipping.
**Fact/Choice** shape: no safe/stretch pair, no target-naming buttons — just
the question and its own 1–2 answers (e.g. heat: "Acknowledge" / "Re-pace
the day"; two A races: "CIM is the goal" / "The half is the goal"). A
"Take 3:16:45" button under a heat question answers something nobody asked,
which is the mistake this split prevents. In the prototype this is a
Tweaks-panel enum (`verdict`) so a developer can click through all 8 without
re-deriving the copy. Below: the full 6-race schedule (upcoming ranked A/B/C
in color, past races dimmed, each expandable), a projected-finish trend
chart, an "evidence" list (races that count toward the read), and a coach's
log.

### Race detail (8a)
Pushed from a schedule row on Races. No gradient panel (pushed screens are
AppBar + plain list, per the shell exception below) — race name + date as
the AppBar title/eyebrow, a Goal/Projected/Gap stat row, a course elevation
profile with 3 labeled marks, a pace plan broken into named sections (e.g.
"Miles 1–6 · easy into it · 8:00–8:10/mi") rather than a per-mile chart, a
taper-progress bar, gear plan, and a coach line.

### Onboarding — day one (9a)
No shell at all (there's no plan yet to navigate to). 5-step flow with a
progress-dot row: welcome → goal (distance, date, optional goal time) →
fitness (5 mutually-exclusive radio options — recent race, known hard-effort
pace, consistent training no race, coming back from time off, new to
structured training — each reveals exactly one relevant follow-up field) →
availability (days/week stepper, long-run-day select, "start from phone"
switch) → reveal (a mini version of the Today gradient poster showing day
one's prescription, plus a coach line and a link into 5a).

### Settings (10a)
AppBar + plain black background. A "Training" tile (long-run-day select,
days/week stepper, "start runs from this phone" switch — this switch is the
single source of truth for whether RUN appears in the tab bar everywhere),
a "Coach" statement row, a "Notifications" tile (two switches), a "Units"
select, a "Data" list (Strava connect toggle, email), and a full-width
destructive "Sign out" button.

### Shoes (11a)
AppBar + a card per shoe in rotation: name, current mileage, and a
progress bar against that model's retirement mileage — tapping a card
expands "Wear these" / "Retire these" buttons in place. A ghost "Add a pair"
button, then a quiet "Retired" list for retired pairs (mileage only, no
progress bar, no chevron). **The retirement bands are a backend concern, not
a design constant** — don't hardcode figures from this doc; pull them from
the shoe-type config the engine owns.

### Live run — outdoor (12a)
**Purpose:** glanceable while moving, phone in hand or armband. No tab bar —
this is immersive. Large elapsed time + distance row, then two large tiles:
Pace (72px numeral) with its target-band progress bar underneath, and Heart
rate (72px numeral) with its ceiling progress bar underneath. A single
current-interval line below. Two full-width buttons at the bottom: Pause
(secondary) and End (destructive/red outline).

### Live run — treadmill (12b)
**Purpose:** a console meant to be read from a few feet away, mid-stride —
this is its own thing, not a shrunk version of 12a. Solid black background
(no gradient — maximum contrast). Top row: elapsed time (34px) and current
interval (34px, signal orange). Two dominant control tiles: **Speed**
(104px numeral, mph) and **Incline** (68px numeral, %), each flanked by large
round −/+ buttons (72px and 60px hit targets) that adjust the value live. A
3-column stat row (Dist / Pace / Heart, 30px numerals). One "what's next"
line (24px). Pause/End buttons at the bottom, same as 12a.

### Injury flare (13a)
A Today-like screen where the panel has no gradient (quiet gray fill) because
there's no session to prescribe. Headline "Not today," the flagged area and
when, a coach verdict, "what changed this week" (reduced mileage), and a
"how does it feel today" check-in list (Better / About the same / Worse —
tapping logs a note in place).

### Week off (14a)
Rest-hue gradient panel, headline "Week off," the reason and date range, a
coach line ("a zero week goes in the book…"), and a "next up" row showing
what Monday looks like.

### Off-season (15a)
No gradient (quiet gray fill), headline "Off-season," time since the last
goal race, a **Silence** component instead of a coach line (the coach has
nothing honest to say about a block that doesn't exist yet — this is a
designed empty state, not a missing one), a loose weekly-mileage range, and a
"Plan the next block" row.

### Data outage (16a)
Same Today shell, but demonstrates the network-failure content rules: the
readiness section is replaced by an **ErrorNote** ("Readiness did not load.
Your score is fine, we just cannot see it.", with a Retry action) and the
weekly-stats area by a **Skeleton** placeholder (reserves the exact layout
height, does not shimmer/pulse). A coach line clarifies today's session still
works because it's stored on-device.

### Today changed overnight (17a)
A Today variant for when readiness moved while the runner slept and the
session downgraded before they woke up. Panel uses the rest-hue gradient,
kicker states the update time and what the session was ("Updated 3:12 AM ·
was Threshold"). The coach line always names a **convergence of independent
signals** — sleep, HRV, and resting heart rate together — never a single
metric; the backend's own severity rule requires three domains to agree
before downgrading a session, so the copy can't cite one cause. Below: a
"What converged" list (three rows, each value against the runner's own
rolling baseline — readiness has no single evening/morning reading to
compare, only 7-day-median and 3-day-average baselines), then a "What moved"
row showing where the original session went. Real copy: "Three short nights,
four days of low HRV and a resting heart rate above your usual. Today is
easy running instead. The threshold session comes back when the numbers do."

### Paces slower / faster (18a)
One mirrored component, three data variants selectable via a `paceDirection`
Tweaks enum (`slower` / `faster-training` / `faster-race`) — direction and
source change the tone and the accent, never the structure. All three show:
a plain-gray panel with the headline and a coach line, a per-zone before/after
table (Threshold / Interval / Rep, each its own `DualPoint` — zones move by
different amounts, so there is no single headline delta), an evidence list,
and a confirm section.
- **Slower and faster-training** are modelled reads: each zone's value
  carries the `~` mark, a caption states "Modelled from training · not
  confirmed by a race," and both are dismissible.
- **Faster-race** is hard evidence (a real race result) — no `~` marks, the
  evidence list shows the race/finish/effort instead of training causes, and
  the confirm section is a single "Update my paces" action, since a race
  result isn't something to dismiss as noise.
- **The slower confirm is a race-representativeness question, not an
  accept/deny.** Paces come from evidence; declining them outright would mean
  training at paces the runner's fitness doesn't support. So the question is
  "Did this race count?" with three tiers matching the engine's own race
  tiering (`representative / compromised / unrepresentative`). Answering
  "compromised" or "unrepresentative" must fall back to the **next-best
  anchor**, never to the old (faster) paces — otherwise the question becomes
  a disguised "make me faster" button.
None of the three coach lines assert an unconfirmed cause (e.g. "fatigue") —
they state the re-anchor as a fact and, where a diagnosis isn't confirmed,
say so directly.

### Return to running (19a)
The 8-stage walk-run ladder that follows an injury flare once it clears to
return (cites the app's own return-to-run protocol: max one stage per week,
two sessions minimum at each, no walk-only stage — stage 1 is run 1·walk
4×5). Panel shows "Stage N of 8" and the current stage's prescription. Coach
line states the advancement gate in one sentence (silent during, silent the
next morning, or the stage repeats). Below: all 8 stages as a list (done /
today / upcoming), and a "How did today go" check (Calf stayed silent →
advances the stage; Something felt off → repeats it), same expand-in-place
pattern as 13a.

### The seven new pieces (20a–24a)

No screen in the approved set covered any of these; each closes a real gap
between the v5 kit and what the backend already does.

**Add a race — details (20a) → course import (20b).** A sheet off Races:
name, date, distance, priority (A/B/C, same tiers as the Races schedule),
optional goal time. Continuing pushes into a dedicated course-import screen
rather than a second sheet step, since it involves a real network round trip.
The import step has four states, demonstrated via `courseImportState`
(internal component state, not a Tweaks prop — paste any URL and press
"Look up" to see loading resolve to found; include the word "fail" in the
URL to see the failure state instead): idle (paste a Strava route link or a
race's own page URL), loading (skeleton, no shimmer per the system's motion
rule), found (course name, distance, a mini elevation profile, and an amber
`~` note when the found distance doesn't match what was entered), and failed
(`Alert` `tone="fault"` — "we could not read this," per the color system,
never a fact about the runner). **Failure never blocks the race from
saving** — "Skip for now" and "Add the course manually" are always available,
because the race is the important object and the course is secondary.

**Add a shoe (21a).** Name, shoe type (`Select`), starting mileage. The shoe
type list ships eight placeholder options (daily trainer, tempo, racing ·
super shoe, racing · flat, trail, max cushion, stability, spikes) with a
caption flagging them as a stand-in — **the real eight types and their
CI-gated retirement bands live in Research/17 and must replace this list
before ship.** No mileage band or retirement number is shown anywhere in
this screen, deliberately: that data is backend-owned, same rule as the
existing Shoes screen (11a).

**Past runs — list (22a), a stepped-to day (22b), and run detail (23a).**
The browsing entry point is two doors, not one. 22a is a plain pushed list
(`AppBar` + `ListGroup`/`ListRow` per week) reached from **Block**, not
Today — "show me my history." 22b is what opens when you tap a past "Done"
row in the training-calendar sheet (5a) — "what did I do on the 12th."
22b is deliberately **not** a Today variant despite reusing Today's poster
grammar: the panel drops the day-state gradient for a quiet flat fill, there
is no avatar/account button and no week strip, and a "‹ Today" link sits
where the avatar would be — all of it there so a day you've stepped to
cannot be mistaken for today, which was the open risk in the day-stepping
control this replaces. Both 22a rows and 22b's "Open full run detail" land
on 23a, a full run-detail push screen: stat row, a route line colored by
pace intensity (single-hue signal-orange opacity ramp, never a second hue —
**placeholder geometry, needs the real polyline**, same caveat the design
system already carries), elevation (`ElevationProfile`), a per-mile split
bar chart, `ZoneBar`, shoes worn, and a coach line.

**Sick (24a).** Its own shape, not a reskin of the injury flare (13a).
Keeps 13a's posture — quiet flat panel, no gradient, "not today" as the
headline — but not its structure: illness has no return ladder, because it
just ends. The check-in is Better/Same/Worse rather than a stage gate, and
"Better" simply lets the plan resume where it left off next session. No
entry point into this screen is drawn yet (e.g. from a Today action or a
settings toggle) — this covers the destination only.

## Interactions & behavior summary
- **Expand-in-place** is the app's one interaction pattern for pickers: a row
  that's editable expands its own group (header naming what's being asked,
  the options, then collapses) — never a full-screen picker, never a chevron
  on a row that has nothing to open.
- **RUN → Outdoor/Treadmill picker**: bottom sheet, identical everywhere the
  tab bar shows RUN. Selecting a mode is the only navigation action in the
  bundle that jumps to a different top-level screen (12a or 12b) rather than
  expanding in place, since starting a run is a real mode switch.
- **Niggle → next-day link**: flagging a niggle in 5b/5c reveals a link to
  13a, showing what tomorrow becomes if the niggle is still there.
- No content is ever printed twice on one screen (e.g. elapsed time appears
  once, not repeated in a stats plate below it).
- Loading/error states reserve their final layout space always — nothing
  appears or disappears and reflows.

## Assets
No icon font, image, or illustration assets are used — every graphic (route
line, elevation profile, week shape, phase bar, zone bar, trend bars, range
scales) is drawn from data with inline SVG/CSS, not an asset. The one
exception is Lucide-style stroke icons (chevron, plus, minus, calendar) drawn
as inline SVG masks — swap for the target app's own icon set.

## Files
- `Faff-iPhone-App.dc.html` — every screen listed above, self-contained,
  open directly in a browser. View source for exact markup/CSS per screen if
  a measurement above is ambiguous. Tweaks-panel props (`verdict` on Races,
  `paceDirection` on the paces screen) switch between content variants
  without editing code; the course-import states (20b) are demonstrated
  through the screen's own "Look up" interaction instead, described above.
