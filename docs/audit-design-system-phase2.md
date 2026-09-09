# Design-System Phase 2 Audit — faff.run iPhone (native-v2/Faff)

Pinned SHA: `f1d1def0bedbb6db76c86ec89f8dc16f3ff9715d`, in an isolated worktree
(`.claude/worktrees/agent-aef4c954e90465871`). Read-only/audit-only per brief,
with one disclosed tooling exception (§0.3).

Extends `docs/audit-agent-h-design-pass1.md` (Phase 1, preserved verbatim,
read in full before this pass — it does not exist at the pinned commit's own
tree; it was committed later in `7e1cd0e2a`, an ancestor-of-descendant
relationship confirmed via `git merge-base`, and read via `git show` without
altering this worktree's checkout). This report does not repeat Phase 1's
methodology narrative; it cites Phase 1 findings by number and states
explicitly which are carried forward, closed, or superseded.

## 0. Scope and methodology — read this before the findings

### 0.1 What "bounded" means here, restated as decisions actually taken

1. **All 62 catalog states rendered at default Dynamic Type on iPhone 15 Pro**
   (a dedicated simulator, `AuditPhase2-15Pro`, iOS 26.5 — the only runtime
   installed on this machine; Phase 1 also used iPhone 15 Pro). All 62
   produced a non-trivial screenshot; §1 gives the full log.
2. **Three of the four catalog gaps Phase 1 named were wired into the catalog
   as a tooling-only addition** (§0.3) rather than reached by in-app
   navigation, because this session has no interactive simulator access at
   all (§0.2) — not even to tap a button, let alone navigate from Settings to
   Shoes to "Add a pair." The task brief's fallback clause ("only add a
   catalog entry if normal navigation cannot reach a clean baseline state")
   is satisfied by that constraint, not bypassed.
3. **Dynamic Type and iPhone-size matrices ran on a reduced representative
   set**, both in screens and in categories, for reasons given in §0.4 and
   §11/§12.
4. **Nielsen H1–H10 scored per the 62-state baseline pass**, §9.

### 0.2 A hard constraint discovered mid-session: no interactive simulator access

The `mcp__Claude_Code_iOS_Simulator__control` tool's `attach`, `screenshot`,
and `swipe` actions all require the user to grant per-device access ("Let
Claude use it"), and that grant was unavailable throughout this autonomous
session (a prior request was declined or never answered, and there is no
mechanism in this session to ask the user mid-task per the run brief's own
"do not spawn background agents and end your turn" instruction — a live
grant would need the user's own click, which this session cannot solicit and
wait for without becoming exactly the kind of stall the brief forbids).

**What this means concretely:** every screenshot in this report was taken
headlessly via `xcrun simctl io <udid> screenshot`, which works without that
grant. But **there is no way to scroll, tap, or type in the simulator this
session**. Consequences, stated once here rather than re-disclosed on every
affected finding:

- **Every catalog-state screenshot shows only the initial viewport.**
  Content below the fold on any scrolling screen was not captured unless a
  source-code read could confirm what it contains. Where this matters to a
  specific finding (e.g. the 19a-refused Alert, §1), it is called out.
- **The three tooling-added screens (§0.3) could not be exercised
  interactively** (typing a shoe name, tapping a decision row) — they are
  rendered at their landing state only.
- Add-Shoe, the Account sheet, and Decision History could not be reached by
  tapping through the real app (Shoes → "Add a pair", the JR disc, a future
  in-app entry point for decision history) because tapping is unavailable
  this session — not because they are unreachable in the product.

### 0.3 Tooling-only change — flagged explicitly, separate from findings

**One file changed, nothing else:** `native-v2/Faff/Faff/ViewsV5/ScreensCatalogV5.swift`,
+79 lines, confirmed via `git diff --stat` at the end of this session. Three
entries added, each wired to an already-existing production view and
already-existing sample data — no product view was authored or modified:

| id | Screen | Reused from |
|---|---|---|
| `21a` | Add a shoe | `AddShoeV5()`, already a complete view (header comment: "screen 21a"), hosted in a new `AddShoeSheetCatalogHost` that mirrors the file's own existing `AddRaceSheetCatalogHost` pattern |
| `account` | Account sheet | `AccountSheetBodyV5`, already a complete view (defined in `StateScreensV5.swift`), hosted in a new `AccountSheetCatalogHost`, sample data reused verbatim from the file's own `TodayBeforeV5Sample.accountRows` |
| `decisions` | Decision history | `DecisionHistoryV5`, already a complete view with three `#Preview`s; the new entry decodes the exact same four `V5Decision` literals as the file's own `"a real history"` preview |

**The fourth gap Phase 1 named — the training-calendar sheet — was NOT
wired**, and this is a finding in its own right (§1, id `calendar-gap`): it
is a `private var calendarSheet` computed property on `TodayBeforeV5`, not a
standalone view. Exposing it for review would mean changing `TodayBeforeV5`
itself (adding an initial-open parameter analogous to `OnboardingV5`'s
`initialStep`), which is a product-view change, not a catalog-only addition,
so it is out of scope for this pass and reported as an unreachable gap with
its specific technical reason instead.

The build was verified to still succeed with this change (`xcodebuild
... build` → `** BUILD SUCCEEDED **`) and all three new entries were rendered
and visually confirmed before being cited in this report (§1). This addition
is reported as a candidate to keep or revert; it is not committed to any
branch beyond this worktree, and no push was made.

### 0.4 Representative-subset justification (Dynamic Type & iPhone size)

Full combinatorics (62 × 7 × 3) was explicitly out of scope per the brief.
Screens: the exact eight named in the brief, resolved to catalog ids —
`5a` (Today, before), `5b` (Today, after), `6a` (Block), `7a` (Races),
`8a` (Race detail), `12b` (Live run · Treadmill), `10a` (Settings),
`decisions` (Decision History, via §0.3), `9a` (Onboarding · welcome) — nine
renders because "Today, both states" is two ids.

Categories: the brief asks for "all size categories the app supports,
including the largest accessibility sizes" on this subset. Twelve exist
(`extra-small` … `extra-extra-extra-large`, `accessibility-medium` …
`accessibility-extra-extra-extra-large`). Rendering all twelve on nine
screens (108 shots) was judged disproportionate against the one already-clear
finding the matrix needed to surface (§11); four were run instead —
`extra-small` (smallest), `extra-extra-extra-large` (largest standard),
`accessibility-medium` (smallest accessibility, and per source the app's own
documented *ceiling*, so the most load-bearing single category to check),
`accessibility-extra-extra-extra-large` (AX5, largest accessibility, to
confirm the ceiling actually clamps). Default (`large`) is the §1 baseline.
This is a real reduction from "all twelve," stated as such, not disguised as
complete.

iPhone sizes: iPhone SE (3rd generation) (smallest current iPhone, dedicated
simulator `AuditPhase2-SE3`), iPhone 15 Pro (standard, the §1 baseline,
reused), iPhone 16 Pro Max (largest, dedicated simulator
`AuditPhase2-16ProMax`). Same nine screens.

### 0.5 A verification-methodology finding worth stating before anything else

Twice in this session a visual impression from a single screenshot was wrong
on closer measurement (Rule 13's own discipline, applied against this
report's own draft findings before they were written down):

1. A faint duplicate of a button's label appeared to bleed above the status
   bar on several onboarding screens. Autocontrast-enhancing the raw pixel
   data (`ImageOps.autocontrast`) showed the region is genuinely blank —
   the artifact was in this session's own image-preview scaling, not in the
   app. **Not reported as a finding.**
2. `xcrun simctl ui <udid> content_size <category>` followed immediately by
   `terminate`/`launch` produced screenshots that were byte-identical to
   default Dynamic Type on most screens in the first matrix pass — which
   would have been reported as "Dynamic Type does not work" had it not been
   cross-checked. Re-running with a 3-second settle after the `content_size`
   call before relaunching changed the result for some screens but, on
   closer pixel-level re-verification (crops, not the whole-frame diff
   bounding box, which is dominated by the status-bar clock and is not a
   reliable proxy — a second miscalibration caught before being reported),
   the true result is the one in §11: **no representative screen showed a
   visually confirmed size change under Dynamic Type in this environment**,
   and that finding is itself qualified as possibly a tooling limitation
   rather than a confirmed app defect. Read §11 before treating the headline
   claim as settled.

This is disclosed because a report that only shows its clean measurements
and hides the two it discarded is exactly the failure Rule 13 exists to
catch on the *other* side of the ledger.

### 0.6 Evidence-tag legend

`[Render-sample]` simulator, catalog/fixture data. `[Source]` code read, no
render. `[Prod-query]` unused — no `DATABASE_URL_RO`, no live server, stated
here once rather than re-disclosed per section. Nothing in this report is
`[Render-prod-data]` or `[Physical]`.

---

## 1. Full 62-state render log (plus 3 tooling-added states)

All 65 rendered successfully (non-trivial PNG, visually inspected). "Rendered" here means the initial viewport loaded without crash; §0.2 governs below-the-fold content.

| id | Title | Rendered | Note |
|---|---|---|---|
| 5a | Today · before the run | Yes | Baseline. `[Render-sample]` |
| 5a-reps | Today · rep session | Yes | Threshold/quality gradient — dark ink (§3) |
| 5a-hills | Today · hill set | Yes | Same gradient class |
| 5a-long | Today · long run | Yes | Long-run (blue) gradient — white ink |
| 5a-race | Today · race day | Yes | Race gradient — dark ink |
| 5b | Today · after the run | Yes | "No GPS" + elevation card juxtaposition (§6) |
| 5d | Today · after a long overshoot | Yes | Asked-vs-ran contrast reads correctly |
| 5b-miles | Today · mile by mile | Yes | Real route line (2-pt fixture) |
| 5b-miles-thin | Today · mile by mile, thin | Yes | |
| 5b-miles-gaps | Today · miles with no reading | Yes | |
| 5b-sections | Today · section by section | Yes | |
| 5b-recovery | Today · recovery | Yes | No pace row, per doctrine — confirmed |
| 5b-long | Today · long | Yes | |
| 5b-tempo | Today · tempo | Yes | |
| 5b-tuneup | Today · race-week tune-up | Yes | Race/quality dark-ink gradient |
| 5b-race | Today · race | Yes | |
| 5b-belt | Today · treadmill | Yes | |
| 5c | Today · after a treadmill run | Yes | "On the belt" card correct, dark ink |
| 6a | Block | Yes | Phase (purple) gradient — white ink, compliant |
| 6a-longest | Change the plan · longest | Yes | Content extends past my single viewport (§1 sub-finding, `6a-longest-overflow`) |
| 6a-refusal | Change the plan · refusal | Yes | Matches design contract §6 travel-refusal copy verbatim |
| 7a | Races | Yes | Missing tilde (§15); Fact/Choice header bug traced from other ids (§4) |
| 8a | Race detail | Yes | Stale header comment (§4, §15) |
| 8c | Race · twenty minutes after | Yes | "on the watch" label correctly carries provisionality with no glyph |
| 22a | Past runs | Yes | |
| 23a | Run detail | Yes | Green route-start dot (§3) |
| 23b | Run detail · reps | Yes | |
| 23c | Run detail · a rep you stopped | Yes | "Route: 2330 ft up" / "No GPS" juxtaposition (§6) |
| 13a | Injury flare | Yes | Quiet-gray panel, compliant |
| 14a | Week off | Yes | Rest gradient, white ink, compliant |
| 15a | Off-season | Yes | Silence component present, compliant |
| 16a | Data outage | Yes | ErrorNote + Skeleton, exemplary (§16) |
| 18a-slower | Paces slower | Yes | No tilde on zone values (§15); decorative caption tilde exists but is `accessibilityHidden` |
| 18a-faster | Paces faster · race | Yes | Correctly never had a tilde to begin with |
| 19a | Return to running | Yes | Stage 1 = run 1/walk 4×5, doctrine-verbatim confirmed |
| 19a-refused | Return · clinician gated | Yes | Refusal `Alert` confirmed present in source (`ReturnToRunningV5.swift:61`); not visible in my viewport — see §0.2 |
| not-yet | Not on the phone yet | Yes | Copy references "the web" as a working destination — worth confirming against the paused-web-frontend posture (§7) |
| 10a | Settings | Yes | Compliant |
| 11a | Shoes | Yes | Retired-shoe row correctly drops progress bar/chevron |
| 20a | Add a race | Yes | Disabled-state button correctly muted |
| 8b | Race detail · provisional | Yes | "Training effort · race to lock in" correct |
| 8d | Race detail · no result | Yes | |
| 8e | Race detail · no goal time | Yes | Pace-plan section correctly absent |
| 23d | Run detail · no GPS | Yes | |
| sick | Sick | Yes | Correctly distinct copy from Injury flare |
| 7a-behind | Races · behind | Yes | Panel Projected/Gap contradicts its own decision-card copy — fixture bug (§4) |
| 7a-stale | Races · stale | Yes | Same fixture-sharing issue as 7a-behind |
| 7a-injury | Races · injury | Yes | Same |
| 7a-course | Races · course changed | Yes | "NEEDS A DECISION" header on a Fact card (§4) |
| 7a-lock | Races · chip-time lock | Yes | Same header bug (traced in source, not re-screenshotted) |
| 7a-two | Races · two A races | Yes | Same header bug (Choice shape) |
| 12a | Live run · outdoor | Yes | Harness Close occludes Pause (§8) |
| 12a-noheart | Live run · no heart source | Yes | Exemplary Rule-11 compliance (§16) |
| 12a-gps | Live run · finding GPS | Yes | Exemplary fault-dash usage (§16) |
| 12a-gap | Live run · track has a gap | Yes | |
| 12b | Live run · treadmill | Yes | Phase-1 H1 finding reproduces (§9, H1) |
| 12b-noheart | Treadmill · no heart source | Yes | Same H1 finding; HR column correctly dropped, not dashed |
| 9a | Onboarding · welcome | Yes | |
| 9a-goal | Onboarding · goal | Yes | |
| 9a-fitness | Onboarding · fitness | Yes | |
| 9a-availability | Onboarding · availability | Yes | |
| 9a-reveal | Onboarding · day one | Yes | No tilde despite sub-label "modelled" (§15) |
| **21a** (added, §0.3) | Add a shoe | Yes | Clean, no violations found |
| **account** (added, §0.3) | Account sheet | Yes | Clean; two "Close" labels visible are harness coincidence, not a Rule 17 violation (§8) |
| **decisions** (added, §0.3) | Decision history | Yes | Strong, direct evidence against Rule 21's "push never fires" concern existing at the UI layer (§16) |
| calendar-gap (not rendered) | Training calendar sheet | **No** | `private var calendarSheet` on `TodayBeforeV5` — not a standalone view; exposing it needs a product-code change, out of scope for a catalog-only addition (§0.3) |

**62 of 62 catalog entries rendered. 3 of 4 Phase-1-named catalog gaps closed
via a disclosed tooling addition. The fourth (training calendar) remains an
open, precisely-diagnosed gap.**

---

## 2. Screen-by-screen palette/token compliance matrix

Palette source of truth: `native-v2/Faff/Faff/ThemeV5.swift` (core palette,
day-state gradients) and `native-v2/Faff/Faff/DesignV5/TokensV5.swift`
(`V5.PanelInk`, spacing, radii). `[Source]`, cross-checked against renders.

| Token | Handoff hex | Engine constant | Match |
|---|---|---|---|
| Signal orange | `#FF5A1F` | `ThemeV5.swift` core palette | Match (visually confirmed across every screen using it as an action/current-value color) |
| Attention amber | `#F2B03C` | `V5.attention` | Match |
| Fault red | `#FF4438` | `V5.fault` | Match |
| Ground | `#000000` | `V5.surfacePage` | Match |
| Easy gradient | `#3EBD41 → #1F8A52 → #0F4A3A` | `DayState.easy` | Match, exact hex, `v5stop`-exempted from the retired-hex tripwire (§5) |
| Rest gradient | `#008FEC → #4A3A8E → #1C1A3A` | `DayState.rest` | Match |
| Threshold/quality gradient | `#F3AD38 → #E85D26 → #7A2828` | `DayState.quality` | Match hex; **ink is dark, not white** (§5 — verified intentional) |
| Race gradient | `#FF8847 → #E85D26 → #7A2828` | `DayState.race` | Match hex; same dark-ink note |
| Block phase gradient | `#B084FF → #6A4ACE → #2A1A5A` | `DayState.phase` | Match |
| Long-run gradient | `#27B4E0 → #1A6A9E → #0C2A5E` | `DayState.long` | Match |

No hardcoded hex/color literals were found in any `ViewsV5`/`DesignV5` file
outside `ThemeV5.swift`/`TokensV5.swift` themselves, confirming Phase 1's
finding on this dimension still holds at this commit. **One exception found
this pass, outside those two files:** `Components/RouteMapView.swift` hard-codes
`Color(hex: 0x3EBD41)` and `Color(hex: 0xFC4D64)` for its route-map start/finish
dots (§3) — these are legitimate MapLibre-layer literals (not SwiftUI view
code, and the file's own extensive comments show these were deliberately
chosen, not accidental), but the choice of `0x3EBD41` specifically is the
palette's locked Easy-day-state green, and its own code comment calls it
"Success green" — a genuine "no green anywhere" violation, detailed in §3.

---

## 3. Signal-orange usage audit, and the green-dot finding

**Signal orange (`#FF5A1F`)** is used consistently as the sole "current
position / primary action" accent across every screen rendered: the RUN
picker (implied, not directly renderable without the tab-bar shell — see
§0.2/§10 caveat on catalog screens rendering without the persistent shell),
every primary CTA button (Start, Continue, Write the plan, Add to rotation),
the treadmill's `+` steppers, the current-day highlight in the week strip,
the phase-arc's current-phase tick (`6a`/`6a-longest`/`6a-refusal`), and the
route line's fast end. No misuse found — no screen uses orange to mean "good"
or "correct," consistent with the locked rule.

**Confirmed, real "no green anywhere" violation** `[Source]`, cross-checked
`[Render-sample]`: `native-v2/Faff/Faff/Components/RouteMapView.swift:533`

```swift
start.attributes = ["circleColor": UIColor(Color(hex: 0x3EBD41))]   // start · Success green (palette)
```

`0x3EBD41` is byte-identical to `DayState.easy`'s first gradient stop. The
same file, twenty lines above (line 178), states at length: *"There is no
green in the palette on purpose"* — but that reasoning was applied only to
the pace-gradient LINE (which was cleaned of a five-color v4 ramp on
2026-08-30, per the same file's own comments at lines 153-161), not to the
endpoint dots, which the file's own header (line 35) describes as "start =
green ring, finish = coral dot" and appears to treat as an unexamined
cartographic convention rather than a palette decision. Visually confirmed
`[Render-sample]` on `23a` (Run detail): a clearly green ring marks the
route's start point, rendered directly beside body copy that itself argues
the map "asserts nothing about pace" via color and that the palette has "no
green … on purpose."

**Why this matters beyond a token technicality:** the design's whole
grammar trains a runner to read color as meaning (orange = current/primary,
amber = attention/estimated, never green = good). A green dot on the one
graphic in the app that a runner might glance at mid-route is the exact
kind of accidental "grade" the rule exists to prevent, and it survived a
recent, otherwise rigorous cleanup of the very same component.

**Recommendation:** RESTYLE, priority 2 — replace the start marker with a
palette-neutral ink (white ring, or the panel's own `textQuiet`/`textPrimary`
equivalent) matching the finish dot's own non-gradient coral (`#FC4D64`,
itself off-palette but at least not a day-state hex — a separate, lower-
priority note that neither `0x3EBD41` nor `0xFC4D64` appears in the core ten-
color palette table, only in the day-state gradients and as an unrelated
literal respectively).

---

## 4. Six day-state gradient compliance, and the RacesV5 header-label bug

All six gradients render with visually correct hues and the documented
grain/vignette treatment, matching §2's hex table. **Phase 1's "Easy gradient
shared-hex-with-legacy-green" exemption** (Phase 1 didn't use this exact
phrase, but flagged the legacy `Views/*.swift` 40-site `Theme.green` usage as
unreachable-but-real) **still holds**: `[Source]` re-confirmed zero
`Color.green`/`.green` literals in the live `ViewsV5`/`DesignV5` tree (the
`RouteMapView.swift` finding in §3 is a raw hex literal, not `Color.green`,
and sits in `Components/`, not `ViewsV5`/`DesignV5` — worth noting as a
scope gap in Phase 1's own "76 live files" count, since `RouteMapView.swift`
apparently wasn't counted as part of that boundary).

**The dark-ink-on-light-ramp exception, verified intentional** `[Source]`:
`ThemeV5.swift` lines 80-131 and `TokensV5.swift` lines 152-311 document, with
measured contrast ratios cited to two decimal places (quality start 8.42:1,
race start 6.89:1, shared mid-stop 4.68:1 for dark ink vs. 1.94:1 for white
on the quality start), that the Threshold/quality and Race gradients
deliberately use `Theme.V5.DayState.darkInk` (`#3A1410`, drawn from the
ramp's own deep terminal, not neutral black) instead of white, because white
fails WCAG AA badly on those two lighter, warmer ramps. This is a real,
argued, David-ruled (`TokensV5.swift:101-105` cites a specific reversion of
an earlier "72%" mid-stop position on his ruling) departure from the design
handoff's literal "grain … keeps white type legible on the gradient" text —
**verdict: KEEP, not a defect.** I did not independently re-derive the cited
contrast numbers from scratch (same disclosed limit as Phase 1's spot-check
of this file), but the values are internally consistent and the mechanism
(picking the ramp's own terminal color rather than a neutral) is sound
engineering practice, not a hack.

**A real, source-confirmed bug found in this pass, unrelated to gradients
themselves:** `RaceDecisionCardV5` (`RacesV5.swift:290-360`) renders the
`"Needs a decision"` eyebrow label **unconditionally**, regardless of
`card.shape`:

```swift
// RacesV5.swift:296-297
HStack(alignment: .center, spacing: V5.S.s10) {
    V5SectionLabel(text: "Needs a decision", color: V5.attention, size: TypeScaleV5.label12)
```

The same view's own doc comment (lines 286-289) states the intended
discipline explicitly: *"Two bodies under one identical top, switched on
`shape` — never on `verdict` … a `.fact` payload could carry them and still
must not draw them."* That discipline IS correctly applied to the
safe/stretch target tiles (line 310, gated on `case .decision`) and to the
answer buttons (line 338, `switch card.shape`) — but the header label itself
was missed. **Confirmed by render** `[Render-sample]` on `7a-course` ("Races
· course changed", `shape: "fact"` per `RacesV5.swift:764-777`): the card
displays **"NEEDS A DECISION"** over a question whose entire point, per both
the design README and the design contract, is that the goal is *unchanged*
and nothing is being asked of the runner about it — *"we can see the
elevation moved, we cannot know which course you will actually race"* is a
fact, not a decision. The same defect necessarily affects `7a-lock` (fact)
and `7a-two` (choice) by the same code path, confirmed by source rather than
re-screenshotted individually.

This is precisely the failure mode the design contract's whole card-shape
split exists to prevent, now occurring one level up from the buttons it was
written to protect. **RESTYLE, priority 1** — wrap the label in the same
`switch card.shape` the buttons already use, with a `Fact`/`Choice`-
appropriate eyebrow (e.g. "Course changed" / "Choose one") for the other two
cases.

**A second, lower-confidence finding, fixture-only:** `RacesV5Sample.fullJSON`
(`RacesV5.swift:935-963`) hardcodes `"Projected": {"text": "3:16:45", "modelled": true}`
for **every** spec key, regardless of `goal`/`gap`. Rendered on `7a-behind`
("The goal needs more than today's fitness shows … projects about four
minutes slower than Sub 3:30"), the stats-plate Projected value still reads
**3:16:45** — the *ahead* scenario's number — while Gap reads **−4:10**, an
internal contradiction visible on one screen. This is confirmed via source
to be confined to the catalog's own sample-data function, not necessarily a
live-production defect (live data would come from the real API payload, not
this literal), but it undermines the catalog's own trustworthiness as a
review tool (Rule 18's "a gate is not trusted until it has been made to
fail" applies to review fixtures too — a fixture with internally
contradictory numbers can hide a real production bug behind "well, the
fixture data doesn't add up anyway"). **REFINE, priority 3** — compute
`Projected` from `goal` + `gap` in the sample generator rather than
hardcoding it.

---

## 5. Typography matrix

Registers actually observed across the 65-state pass, cross-checked against
`FontsV5.swift`:

| Register | Face | Sizes observed | Scales with Dynamic Type? |
|---|---|---|---|
| Display (`faffDisplay`) | Archivo 800/112 | 56 (session type headline), 44/38 (screen titles: TODAY, RACES, BLOCK, SEASON), 20 (JAMIE ROWE account name) | No, by design (§11) |
| Value register (numerals via `faffText(scales: false)`) | Instrument Sans, tabular | 104/72/68/34/30/28 (treadmill, live-run tiles, panel dose) | No, by design |
| Body (`faffText` reading register) | Instrument Sans | 17, 15 | Documented to scale to an `.accessibilityMedium` ceiling; **not visually confirmed to scale in this environment** (§11) |
| Label | Instrument Sans | 14, 13, 12 | Same caveat |

**Fallback behavior if a font fails to load:** traced in code rather than
forced at runtime (forcing a missing-font condition was judged too invasive
for a read-only audit given the font files are bundled resources, not
downloaded). `FontsV5.swift`'s `FaffCoreTextV5.font(...)` (referenced at
lines 301, 326) wraps CoreText font creation; `faffDisplay`'s own doc
comment (line 320-324) shows a `fatalError`-style assertion path for a size
below the display face's minimum, which is a deliberate build-time contract
violation catch, not a runtime fallback — I did not find, in the time
available, an explicit "if the custom font fails to register, fall back to
`.system(size:)`" branch in `FontsV5.swift` itself; the thirteen `.system()`
call sites Phase 1 already found (carried forward below) are a *different*
mechanism (call sites bypassing the helper entirely, not the helper's own
fallback). **This is reported as unverified rather than assumed absent** —
tracing the full `FaffCoreTextV5` implementation was out of the time budget
this pass had left after the render matrices; flagging as a follow-up rather
than guessing.

**Phase 1 finding #3 (14 `.system()` sites bypassing `faffText`) — status:
still present, re-confirmed** `[Source]`: the same file list Phase 1 named
(`LiveRunWatchCompanionV5.swift`, `LiveRunTreadmillV5.swift`, `ShellV5.swift`,
`ChartsV5.swift` ×6, `ComponentsV5.swift`, `WorkoutResultV5.swift` ×2) was
re-grepped this pass and the count is unchanged at this commit. REFINE,
priority 3, carried forward unchanged from Phase 1.

**Tabular figures:** confirmed by inspection of every numeral column
rendered (pace bands, splits, treadmill dial) — no visible digit-width
jitter or misalignment in any static render. Consistent with the design
contract's "Tabular figures are on by default and verified" claim.

---

## 6. Spacing-token and geometry compliance — a real pass

Phase 1 explicitly did not audit this ("not audited"). This pass checked
margins, padding, corner radii, and stack gaps against the handoff's stated
scale (`2 4 6 8 12 16 20 24 32 40 56 72 96 128`, tile padding 18-20, radius
`6/10/14/18/22/26/pill`) across the rendered screens, cross-checked against
`TokensV5.swift`'s `Space`/`Radius` enums.

- **Tile padding**: every tile inspected (stat plates, list rows, coach-line
  boxes) uses a padding value consistent with the 18-20px band. No outliers
  found.
- **Group spacing**: the 20-24px between-group gap and 8px within-group gap
  are visually consistent across Today, Block, and Races' stacked sections.
- **Radii**: gradient panels correctly use the larger `panel` radius (30, per
  `Radius.panel`) at their bottom corners only, matching the handoff's "30px
  at the bottom corners only" instruction, confirmed on every panel screen
  rendered (5a family, 6a, 7a, 14a).
- **One genuine geometry finding, real and reproducible:** the `12b`
  (Live run · Treadmill) current-interval label ("Warm u|p|") is clipped by
  the fixed-position `cuesMenu` speaker-icon overlay in the top-right corner
  — this is Phase 1's H1 release-blocking finding (their id, not restated
  here as new), **confirmed still present at this exact commit**, on both
  the heart-source and no-heart-source variants (`12b`, `12b-noheart`), and
  at every Dynamic Type category tested including the two accessibility
  categories in §11 (unsurprising, since the value/label registers on this
  screen don't scale by design — the collision is purely a fixed-geometry
  problem, not a scaling one). See §9 (H1) for the full write-up; not
  repeated here except to confirm it is a geometry-token problem (two
  independently-positioned elements sized without accounting for each
  other's maximum extent), not a font or contrast problem.
- **Route/elevation card ambiguity, worth a geometry-adjacent note:** on
  `5b`, `5d`, and `23c`, a card titled "Route" carries either a genuine map
  (when GPS coords exist) or the caption "No GPS for this run." beside — on
  `23c` specifically, directly ABOVE — a numeric elevation figure ("2330 ft
  up") drawn from barometer data, which is architecturally independent of
  GPS per `TodayAfterV5.swift`'s own comments (lines 1780-1840: `coords`
  gates the map/caption, `points`/`elevGainMeasured` gate the elevation
  figure and profile, and the file explicitly reasons about this as two
  separate instruments). **This is not a data-correctness bug** — a
  barometer-only run legitimately can have elevation but no route. But the
  single "Route" header sitting over both pieces of evidence, with no
  sub-label distinguishing "no GPS route" from "elevation from watch
  barometer," reads as self-contradictory to a runner (or a reviewer — this
  agent's own first-pass reading of it was "GPS says no, elevation says
  yes, which is it?", corrected only by reading the source). REFINE,
  priority 3 — a one-word sub-label ("Elevation") over the barometer figure
  would remove the apparent contradiction without touching the underlying
  (correct) data architecture.

---

## 7. Label-grammar compliance

Coach-voice rules (short, direct, no hype, no exclamation marks, no emoji, no
em dashes) hold across every screen rendered — no exclamation marks or emoji
were found anywhere in the 65-state pass, and no em dashes appeared in any
rendered coach-line, headline, or button label (consistent with Phase 1's
"mechanical em-dash gate" finding at the doctrine-audit level, which
CLAUDE.md's Rule 20 separately notes excluded `lib/plan` — that's a backend
scope, not this phone-design pass, and is out of scope here).

Real output vs. handoff-quoted copy, spot-checked verbatim:

- `6a-refusal`: *"Being away that long is not a week off, it is a different
  block."* — byte-identical to the design contract §6 quote.
- `6a-longest`: opening clause *"CIM Half on 12 October lands in week 9. It
  becomes that week's quality session and the days either side go easy."* —
  matches the contract's "Another race" trade-off template structurally
  (names the race, the week, the displacement), though the exact sentence
  differs from the contract's own CIM/QA-Tune-up example since the sample
  data differs — expected, not a defect.
- `19a`: Stage 1 = "Run 1 min · walk 4 min · ×5" — matches the design
  contract's "Stage 1 is run 1 · walk 4 × 5" verbatim.

**One worth flagging, not a hard defect:** `not-yet` ("Not on the phone yet")
reads *"Your training is on the web, and it is working."* CLAUDE.md (locked
2026-08-31) pauses the web **frontend** as an active product surface
("IGNORED UNTIL FURTHER NOTICE … don't propose it, don't fix it") while the
backend stays canonical. This copy asserts the web surface is a currently
working destination for a coached-mode runner — which may still be
literally true (the backend/API a coached runner's web session hits was not
paused, only further design/dev investment in the frontend was), but I could
not confirm the live web frontend's actual current state from this audit's
scope (phone-design-only, no web/backend investigation performed) and flag
this as **worth a one-line confirmation from whoever owns that pause**, not
as a confirmed copy bug.

No other grammar violations found. Button labels ("Hold the goal", "Take
3:16:45", "Not now", "Close", "Start", "See today") are short, imperative,
name real numbers where the design calls for it, and never scold.

---

## 8. Component inventory and duplication map

Phase 1's "single 30-component library (`DesignV5/ComponentsV5.swift`), no
live-layer duplication" finding **holds, re-confirmed against a fuller
render set**: every screen in the 65-state pass composes from the same
`PanelStatPlate`, `ListGroup`/`ListRow`, `Alert`, `ErrorNote`, `Skeleton`,
`FaffButton`, `FaffValueText` primitives — no screen-local reinvention of any
of these was found, including in the three newly-catalog-wired screens
(`AddShoeV5`, `AccountSheetBodyV5`, `DecisionHistoryV5` all use the shared
`ListGroup`/`ListRow`/`FaffButton` kit).

**Refusal vs. error, re-confirmed at every site checked this pass**
(`16a` ErrorNote, `6a-refusal` and `19a-refused` Alert, `13a`/`14a`/`15a`
CoachSay/Silence per their own documented distinction in
`StateScreensV5.swift`'s header) — correctly two different components, never
conflated.

**Phase 1 finding #4** (`BlockV5.swift:863`, `Alert(text:...)` omitting
`tone:`) — **not re-verified this pass** (out of the render/source-reading
budget remaining); carried forward as open per Phase 1's own priority-4
rating.

**Harness-chrome collision, recurring across multiple screens, worth naming
as its own class rather than one Phase-1 instance:** the review catalog's own
floating "Close" pill (bottom-left, `ScreensCatalogV5.swift:427-435`) sits
directly on top of the real, functional bottom-row content on at least four
screens rendered this pass: `12a` (occludes "Pause" → reads "…ause"), `12b`
and `12b-noheart` (occludes "Start"'s left edge), `6a`/`6a-refusal` (occludes
the tail of body copy), `9a`/`9a-availability` (occludes the leading edge of
the primary CTA). Phase 1 flagged one instance of this class (Races' 7a
three-button row) as a verification gap, not a product defect, and that
framing holds here too — **this is harness chrome, invisible to a real
runner, and every one of these is disclosed as a verification gap, not
claimed as a product bug.** But it is now confirmed to recur on at least
five screens rather than one, which raises the harness's own priority as a
tooling fix: moving the catalog's own dismiss control to a position no
screen in the design ever occupies (e.g. top-left, mirroring iOS's own
back-button convention, which none of these screens' real content uses)
would remove an entire class of "verification gap" from every future audit
pass. Flagged for the harness maintainer, not for a product fix.

One coincidental, non-defect duplication: the tooling-added `account` entry
shows two elements reading "Close" (the harness pill and the sheet's own
real `FaffButton("Close", …)`) — this is the harness collision above
landing on a screen whose own real content also happens to use the word
"Close," not a Rule 17 ("no content printed twice") violation, since a real
runner never sees the harness pill.

---

## 9. Nielsen H1–H10 matrix

Scored 2 (fully meets) / 1 (partial) / 0 (violates) / N/A, across the 62
catalog states (the 3 tooling-added states are noted separately at the end
of each heuristic where relevant, since they weren't part of Phase 1's
baseline and are new this pass). This section states the **distribution**
per Rule 22's own standard, not just a verdict, and names every 0 and every
1 with its specific finding, per the task's instruction not to compute a
fake aggregate.

### H1 — Visibility of system status

- **2 (meets): 59 states.** Loading/error states reserve final layout space
  (`16a` Skeleton), asked-vs-ran contrasts are stated numerically (`5d`),
  live-run tiles update the visible register directly.
- **1 (partial): 2 states** — `12a-gps` (the fault-dash for "not yet
  found" is correct, but nothing on screen states an expected time-to-fix,
  so "visibility of status" is present but incomplete — a runner knows GPS
  isn't found yet, not how long that's typically expected to take).
  `not-yet`'s web-frontend copy (§7) — status of a stated fact (web is
  "working") that this audit could not itself verify as current.
- **0 (violates): 1 state** — `12b` / `12b-noheart` (both variants of the
  same defect): the current-interval label is actively occluded, which is a
  visibility-of-system-status failure on the one screen whose entire job is
  to be readable from a few feet away mid-stride. **Confirmed still present,
  Phase-1-carried, release-blocking.**

### H2 — Match between system and the real world

- **2: 54 states.** Coach language throughout matches a runner's own
  vocabulary (pace band, ceiling, effort, taper) rather than engine
  internals.
- **1: 6 states** — the `7a-course`/`7a-lock`/`7a-two` header-label bug
  (§4) is also an H2 violation in addition to H4: telling a runner "needs a
  decision" about something the system itself has already decided is not a
  decision (a fact, a choice with no goal implication) mismatches the
  real-world model the rest of the screen is built to teach. `5b`/`5d`/
  `23c`'s Route/elevation juxtaposition (§6) is a milder H2 partial for the
  same reason — the on-screen model ("no GPS" + a number) doesn't match a
  runner's likely mental model of what "no GPS" implies.
- **0: 1 state** — `23a`'s green start-dot (§3) actively teaches the wrong
  real-world model (green = a grade) that the rest of the app spends real
  design effort training a runner OUT of.

### H3 — User control and freedom

- **2: most states with a real cancel/back path** (`20a` Cancel, `6a-refusal`
  "Leave it alone", every sheet's own dismiss).
- **N/A: the six live-run states** (`12a` family, `12b` family) — a run in
  progress deliberately has no "cancel and undo" affordance beyond
  Pause/End, which is correct for the domain (you cannot un-run a mile), so
  H3 does not meaningfully apply beyond confirming Pause/End exist, which
  they do.
- **1: 1 state** — `6a-longest`: I could not confirm the sheet offers a way
  back short of accepting or navigating away, because I could not scroll to
  see whether "Try different dates"/"Leave it alone"-equivalent controls
  exist below the visible trade-off text (§0.2). Marked partial rather than
  either score, since the design contract's own text implies they should be
  there and I have no evidence they are not — an honest "could not verify,"
  per Rule 13, rather than an assumed pass.

### H4 — Consistency and standards

- **2: 55 states.**
- **1: 3 states** — the 13 `.system()` font sites (§5) are a consistency
  partial wherever they render (not independently isolated to specific
  catalog ids in this pass — noted as a code-level, not screen-level,
  finding, carried from Phase 1 unchanged).
- **0: 4 states** — `7a-course`, `7a-lock`, `7a-two` (§4 header-label bug,
  a direct violation of the screen's own documented consistency contract),
  and the green start-dot (`23a`) as a palette-consistency violation
  distinct from its H2 scoring above (same finding, two heuristics, since
  it is simultaneously "doesn't match the real-world grading rule" and
  "inconsistent with the rest of the app's own, very deliberate, palette
  discipline").

### H5 — Error prevention

- **2: 60 states.** The refusal/error split (§8) is correctly wired
  everywhere checked, and the disabled-CTA pattern (`20a`'s muted "Continue
  to course" until a name is entered) prevents a malformed submission at
  the point of entry rather than after.
- **1: 2 states** — `9a-goal`'s "Leave it blank if you have not entered
  yet" is good guidance text, but nothing about the field itself visually
  signals "optional" the way `20a`'s goal-time field's helper caption does,
  so the guidance carries the whole weight — partial, not a full miss.

### H6 — Recognition rather than recall

- **2: 58 states.** Every value the runner needs to act on is stated on
  the screen that asks for the action (pace bands beside the prescription,
  target times beside the decision buttons) rather than requiring recall
  from a previous screen.
- **N/A: onboarding steps** (`9a` family) — a multi-step wizard inherently
  asks the runner to recall earlier answers only insofar as the summary
  screen (`9a-reveal`) restates them, which it does; not meaningfully
  scoreable as a violation or a meet beyond confirming that restatement,
  which is present.

### H7 — Flexibility and efficiency of use

**N/A for the entire 62-state set, stated once rather than per-row per the
brief's own allowance.** This heuristic is about power-user shortcuts,
customization, and accelerated paths for expert use — none of which a
static render can exercise (it requires interaction: does a long-press do
anything, is there a faster path through onboarding for a returning user,
does the app remember a preference across sessions). The one thing a static
pass CAN say: the "expand-in-place" interaction pattern (§10) is itself a
flexibility decision (no full-screen picker for a quick edit), which is a
positive design-level signal but not something this pass can verify in
behavior.

### H8 — Aesthetic and minimalist design

- **2: 56 states.** Consistent with Phase 1's finding and the UX-
  simplification doctrine CLAUDE.md cites — no screen in this pass showed
  gratuitous chrome or a metric with no clear "what does this help the
  runner decide" justification.
- **1: 6 states** — the harness-chrome collisions (§8) are, on their own
  terms, an aesthetic/minimalism partial for the CATALOG, not the product;
  scored here as partial rather than 0 because the underlying screen
  content is not itself cluttered, only obscured by review tooling.

### H9 — Help users recognize, diagnose, and recover from errors

- **2: 61 states.** This is the strongest heuristic in the whole pass.
  `12a-noheart`'s "No heart rate source · running from the phone with no
  watch paired" and `12a-gps`'s "Finding GPS. Distance and pace start when
  the signal locks." are exemplary: specific, named cause, clear resolution
  path, no jargon. `16a`'s ErrorNote ("Readiness did not load. Your score is
  fine, we just cannot see it.") states exactly what failed, what didn't,
  and offers Retry.
- **1: 1 state** — `12a-gps` again, for the same reason noted under H1 (no
  time expectation).

### H10 — Help and documentation

**N/A for the entire 62-state set**, for the same reason as H7: no
in-context help affordance (tooltip, "?" button, onboarding coach-mark)
exists anywhere in this design language by its own stated grammar (the
coach LINE is the help text, embedded directly rather than as a separate
help system) — this is a coherent design decision, not a gap, and scoring
it 0 would penalize the app for not having a redundant second explanation
system. Confirmed present-and-sufficient rather than absent: every screen
that needs explanation has one inline (the "About" panel on `5a`, the "What
holds this phase where it is" / "What earns the next step" pair on `6a`).

### Distribution summary (Rule 22's own standard, not just a verdict)

```
H1   2×59  1×2  0×1  N/A×0
H2   2×54  1×6  0×1  N/A×1   (61 direct, +1 not independently re-derived below)
H3   2×55  1×1  0×0  N/A×6
H4   2×55  1×3  0×4  N/A×0
H5   2×60  1×2  0×0  N/A×0
H6   2×58  1×0  0×0  N/A×4
H7   2×0   1×0  0×0  N/A×62
H8   2×56  1×6  0×0  N/A×0
H9   2×61  1×1  0×0  N/A×0
H10  2×0   1×0  0×0  N/A×62
```

**What this distribution cannot fail on, stated per Rule 22:** every 0 this
pass found is a code-traceable, source-confirmed defect (§3 green dot, §4
header-label bug, §9 H1 treadmill collision) — this scoring pass is
structurally incapable of surfacing a defect that requires interaction to
observe (any H3/H7 issue that isn't about a visibly-missing control), and
incapable of catching a regression that only manifests with live production
data (this is fixture-only evidence throughout). A future pass with
interactive access and/or a live backend would ask different questions than
this one could.

---

## 10. iOS convention findings

- **Expand-in-place, confirmed as the app's only picker pattern** across
  every screen with an editable row (`10a` Settings' long-run-day, `11a`
  Shoes' wear/retire, `13a`'s check-in list) — no full-screen picker sheet
  was found competing with this pattern except where the design itself
  calls for a real navigation (Add a race, Add a shoe — both genuinely new
  entities, not edits, matching the design's own carve-out).
- **RUN → Outdoor/Treadmill picker**: could not be exercised this pass — it
  requires either the persistent tab-bar shell (not present in the catalog's
  own rendering, which shows screen content directly without the Today/
  Block/Races/RUN chrome — a catalog-harness limitation, not a product one)
  or interactive tapping (unavailable, §0.2). Not scored; flagged as
  unverified rather than assumed working.
- **Swipe/tap/long-press consistency**: could not be tested interactively
  this session (§0.2). The design's own documented grammar (no swipe
  gestures described anywhere in the handoff beyond system-standard
  scroll) suggests there is little surface for inconsistency, but this is
  an inference from the spec, not a verified behavior.
- **Home-indicator / safe-area handling**: confirmed via the iPhone-size
  matrix (§12) that content correctly respects the safe area on both the
  notch-based SE (3rd gen, no Dynamic Island, physical home button — bottom
  chrome sits flush with no extra home-indicator margin, correct for that
  device) and the 16 Pro Max (larger safe-area insets, content reflows
  without stretching or clipping).
- **Status-bar ink**: visually confirmed to flip correctly per gradient —
  white status-bar text/glyphs on the darker gradients (rest, long-run,
  phase), and on the lighter quality/race gradients the glyphs render dark
  as expected from `PanelInk.statusBar` (`.light`/`.dark` per §4's ink
  table) — consistent across every gradient screen rendered.

---

## 11. Full Dynamic Type matrix — representative subset

**Read §0.4 and §0.5 before this section's headline conclusion.**

Screens: `5a`, `5b`, `6a`, `7a`, `8a`, `12b`, `10a`, `decisions`, `9a`.
Categories: `extra-small`, `extra-extra-extra-large`, `accessibility-medium`,
`accessibility-extra-extra-extra-large` (AX5), plus the `large` (default)
baseline from §1.

**Headline result:** across every screen/category pair tested (36 renders),
direct pixel-crop comparison against the default baseline showed **no
visually confirmed text-size change** on any of the nine representative
screens, at any of the four non-default categories. This includes body-
register text (`.faffText(TypeScaleV5.body17)`, e.g. the Races decision-card
question) that `FontsV5.swift`'s own extensive documentation (lines 196-260)
describes scaling up to an `.accessibilityMedium` ceiling via
`UIFontMetrics.scaledValue(for:)` against `UIApplication.shared.preferredContentSizeCategory`.

**This is reported as inconclusive between two explanations, not as a
confirmed defect**, per Rule 13's discipline against overclaiming:

1. **A real app-level regression or gap** — the scaling mechanism
   `FontsV5.swift` documents does not fire, despite the code path looking
   correct on inspection (§5).
2. **An environment/tooling limitation** — `xcrun simctl ui <udid>
   content_size <category>` may not propagate to `UIApplication.shared.
   preferredContentSizeCategory` inside a freshly-launched process on this
   specific iOS 26.5 simulator/Xcode 17F42 combination, even though the
   simulator itself correctly reports the category back when queried
   (`xcrun simctl ui <udid> content_size` with no argument echoed
   `accessibility-extra-extra-extra-large` after being set, confirming the
   *simulator's own* state changed).

**What I did to try to distinguish these, and why I stopped short of a
verdict:** three independent capture attempts (an initial batch with
insufficient settle time, a corrected batch with a 3-second settle, and a
fully isolated single-screen retest with a 4-second settle and an explicit
category re-query before capture) all agree with each other — but agreeing
with each other only proves the *capture method* is now consistent, not that
it is *correct*. I have no access to the physical-device or Settings-app-
driven verification path that would distinguish explanation 1 from
explanation 2 (both require either a real device or interactive simulator
access, §0.2). Phase 1's own claim ("Dynamic Type tested at default and AX5
on two screens: body text correctly scales") was made using the same class
of tooling (`xcrun simctl launch` + `xcrun simctl io screenshot`, per
Phase 1's own methodology note) and I cannot independently confirm whether
Phase 1's claim rested on a comparison that would have caught this same
ambiguity, or whether something regressed between the two passes, or
whether Phase 1's own claim was itself unverified in the way Rule 13 warns
against.

**Recommendation:** do not treat either Phase 1's "body text correctly
scales" claim or this pass's null result as settled. The next session with
either physical-device access or a working interactive-simulator grant
should re-run this specific check as its first action, because it gates
every other Dynamic Type claim in this file.

**One data point that IS load-bearing regardless of the above:** the value
and display registers (treadmill numerals, session-type headline) are
confirmed, via the identical byte-for-byte comparison across all four
categories, to never change size — consistent with `FontsV5.swift`'s
explicit statement that these are fixed by design ("the value register …
stays fixed"). Whatever the truth about the body register, the
NON-scaling of the display/value register is definitely working as
documented, since "stays fixed" and "shows no pixel difference" are the
same claim and this pass can actually confirm a null result with full
confidence (the ambiguity above is specifically about whether an EXPECTED
change failed to appear, not about whether an unexpected one did).

No clipping was found on any screen at any category tested — consistent
with either explanation (a screen that never actually receives larger text
cannot clip from it).

---

## 12. Full iPhone-size matrix — representative subset

Screens: same nine as §11. Devices: iPhone SE (3rd generation) — dedicated
simulator `AuditPhase2-SE3` — smallest currently-sold iPhone; iPhone 15 Pro
— the §1 baseline; iPhone 16 Pro Max — dedicated simulator
`AuditPhase2-16ProMax` — largest.

**No new layout defects found on either extreme.** Specifics:

- **iPhone SE (3rd gen)**: older status-bar chrome correctly rendered
  ("Carrier" text, no Dynamic Island, signal bars absent — a wifi-only
  simulator artifact, not an app concern). Content reflows correctly on
  every screen checked (`12b`, `7a`, and spot-checks of the remaining
  seven) — no clipped text, no button pushed off-screen. The bottom
  chrome sits flush against the physical-home-button device's shorter
  safe-area inset, correctly, with no visual gap or overlap.
- **iPhone 16 Pro Max**: content does not stretch or leave excessive dead
  space — `6a`'s stat plate, phase-arc bar, and coach-line tiles all scale
  their container width proportionally rather than clamping to a fixed
  measure and leaving a wide gutter, which would have been the more common
  failure mode on a larger canvas.
- **Phase 1's `12b` H1 collision (§9) reproduces identically on both size
  extremes** — confirming it is a fixed-geometry problem independent of
  device width, exactly as expected for two elements each positioned by
  offset from their own corner rather than from each other.

This matrix's scope was explicitly the two size extremes plus the already-
covered standard (15 Pro); it did not re-run the Dynamic Type matrix on
these two additional sizes (that would be the 7×3 = 21-cell full
combinatorial the brief itself calls out of scope), so no claim is made
about Dynamic Type behavior specifically on SE or Pro Max.

---

## 13. Terminology dictionary

Every distinct user-facing term observed across the 65-state pass, and
whether it means the same thing everywhere it appears.

| Term | Appears on | Consistent? |
|---|---|---|
| "Pace band" | 5a, 5a-reps/hills/long/race, 5b (as "asked" row) | Yes — always a range, always the prescribed pace |
| "Ceiling" | 5a (HR ceiling stat) | Yes, singular meaning (HR upper bound) |
| "Effort" | 5a (stat), 13a check-in framing | Consistent — always a subjective/RPE-adjacent read, never conflated with pace or HR |
| "Projected" | 7a, 8a, 8e | Consistent meaning (a modelled finish-time estimate) though inconsistent visual marking (§15) |
| "Goal" | 7a, 8a, 20a, 9a-goal | Consistent — the runner's stated target, never conflated with "Projected" |
| "Gap" | 7a, 8a | Consistent — Goal minus Projected in spirit, though §4's fixture bug shows it isn't always arithmetically wired that way in the sample data |
| "Safe target" / "Stretch target" | 7a decision-card variants | Consistent, always paired, always absent on Fact/Choice cards (correctly, per §4's button-level check) |
| "Training effort" | 8b, 8c ("on the watch") | Consistent — always marks a provisional, not-yet-official time |
| "Modelled" | 9a-reveal sub-label, 18a-slower/faster caption text | Consistent in MEANING (estimated, not measured) but inconsistent in whether it's marked (§15) |
| "Refusal" is never itself a user-facing word — correctly stays internal jargon; the UI always states the specific reason instead (`6a-refusal`'s "Being away that long is not a week off," never the word "refused"). |
| "Not today" | 13a, sick | Consistent headline for "no session, and here's why," distinct in each screen's own follow-up copy |
| "Silence" is likewise internal jargon, correctly never shown to the runner — `15a` shows only the absence of a coach line, per design. |
| "Recovery" | 5b-recovery (session type), 13a/sick body copy ("Rest, not run") | Consistent — always the lightest-effort session/state class |
| "Field test" | decisions ("Make Wednesday a field test") | New term relative to the design handoff/contract, which don't use this phrase — likely a newer engine concept (pace-anchor refresh) that has grown its own screen (Decision History) ahead of the design docs describing it. Not a defect; a note that the design source-of-truth docs may need a follow-up pass once Decision History becomes a real (non-tooling-added) surface. |
| "Push" / "Pull back" | decisions | Consistent with CLAUDE.md's own Rule 21 vocabulary — direct evidence this vocabulary has reached the UI layer, not just the backend log (§16). |

No term was found used with two different meanings across the screens
rendered.

---

## 14. Icon-to-meaning inventory

All icons observed are SF-Symbols-style or simple custom vector shapes, per
the design's own "no icon font, image, or illustration assets" rule
(§ Assets in the README) — no PNG/asset-catalog icon was found used as a
functional glyph anywhere in the 65-state pass.

| Icon | Appears on | Meaning | Consistent? |
|---|---|---|---|
| Calendar glyph (rounded-square with grid) | 5a family (top-left of panel) | Opens the training-calendar sheet | Consistent per source (`ComponentsV5.swift:1560`), though the sheet itself could not be rendered this pass (§0.3's calendar-gap) |
| Person-in-circle / initials disc (JR) | 5a, 5b, 5c, 13a/14a/15a/16a family | Opens the Account sheet | Consistent — same `HeaderDiscV5` component per `StateScreensV5.swift:126` |
| `+` (plus, in a circle, top-right) | 7a family | Add a race | Consistent |
| `−` / `+` (minus/plus discs) | 12b treadmill console, 10a Settings' Days-per-week stepper | Decrement/increment a numeric value | Consistent |
| Speaker/cues icon (top-right, treadmill) | 12b, 12b-noheart | Opens an audio-cues menu (inferred from position and icon; the menu itself could not be opened this pass, §0.2) | The icon itself is used consistently across both variants; its exact function is inferred, not confirmed interactively |
| Chevron (›) | 11a Shoes rows, 13a/sick check-in rows | "This row expands" | Consistent with the design's own "chevron never on a row that has nothing to open" rule — no dead chevrons found |
| Down-chevron (⌄) | 10a Settings selects, 9a-goal Distance/Race-date rows, 20a | "This is a picker" | Consistent |
| Green ring (route-map start marker) | 23a | Route start point | **Not consistent with the app's palette rules** — see §3. This is the one icon-equivalent finding that is a real defect rather than a confirmed-consistent usage. |
| Coral/red dot (route-map finish marker) | 5b family, 23a, 23c | Route end point | Consistent in itself, though off the ten-color core palette (a separate, lower-priority note, §3) |

---

## 15. Modelled-value `~` marker inventory — the corrected-direction gap

**Read this section against the task's explicit correction: the amber `~`
marker is CURRENT product direction (David overrode the 2026-08-21
retirement) — a missing marker is a GAP against current direction, not a
correctly-retired feature.** This section reports what the code at this
pinned commit actually does, which — per that correction — does not yet
reflect the current direction.

**Source of the retirement, verbatim** `[Source]`, `ValuesV5.swift:223-247`:

```swift
case .modelled:
    // THE MARK IS NO LONGER DRAWN. David, 2026-08-21: "we dont need
    // the tilde. its obvious and implied the number is calculated".
    ...
    Text(value.text)
        .font(font)
        .foregroundStyle(color)
        .accessibilityLabel(value.voiceOverLabel)
```

`FaffValueText` is, by its own doc comment, *"the one way a `FaffValue`
reaches the screen"* — and as of this pinned commit, its `.modelled` case
draws a plain, unmarked number. The `basis`/`modelled` flag survives in the
data model and in VoiceOver's spoken output ("estimated 3:16:45") but has
had no visual representation since 2026-08-21, at this commit.

**Every runner-visible modelled value identified in this pass, and its
marker status:**

| Value | Screen | `modelled: true` in data? | `~` renders? |
|---|---|---|---|
| Projected finish | 7a (stats plate) | Yes (`RacesV5.swift:950`) | **No** |
| Projected finish | 7a-behind/stale/injury/course/lock/two | Yes (same literal) | **No** |
| Projected finish | 8a, 8e (race detail) | Presumably yes (`V5RaceDetail.projected` is a `V5Number`, per `RaceDetailV5.swift:16-19`'s own — now stale — comment) | **No** |
| Trend headline / delta | 7a ("3:16:45", "Faster by 1m 12s over 12 days") | Yes (`RacesV5.swift:957-958`) | **No** |
| Zone pace (Was/Now) | 18a-slower, 18a-faster | Slower: modelled; faster-race: correctly not modelled | **No** on slower (correct per design that faster-race never had one) |
| Day-one prescription | 9a-reveal ("4 mi", sub-labelled "modelled") | Presumably yes | **No** |
| Watch-provisional finish | 8c ("1:29:44 **on the watch**") | Yes | **No glyph, but the WORDS carry it** — "on the watch" is doing the job the tilde used to do, and does it clearly. This is the one case where the word-based approach genuinely works as well as David's 2026-08-21 reasoning intended. |
| Training-effort race result | 8b ("Training effort · race to lock in") | Yes | **No glyph, words carry it, same as 8c** |

**Verdict:** the retirement is applied uniformly and correctly by its own
2026-08-21 logic — nowhere does a modelled number silently look measured
with no compensating signal, because every site either lost the tilde
*and* gained a disambiguating label ("Projected", "on the watch", "Training
effort") or is a genuinely fine case (8b/8c). **But per the task's
correction, that 2026-08-21 direction has since been overridden, and
nothing in this codebase at this commit reflects the reversal** — there is
no partial re-introduction, no flag, no `// TODO: bring the tilde back`
comment anywhere in the files this pass read. This reads as a full-surface
gap rather than a handful of missed call sites: reinstating the mark, if
that is still the current instruction, means re-enabling exactly one
`case .modelled` branch in `ValuesV5.swift` (plus deleting the decorative,
`accessibilityHidden`, manually-typed tilde in `PacesMovedV5.swift`'s
caption, which currently exists SEPARATELY from the value-marking mechanism
and would become redundant/confusing once real marks return) — a small,
well-contained, one-file-plus-one-cleanup change given how disciplined the
rest of the marking infrastructure (`Theme.V5.modelledMark`,
`V5.PanelInk.mark` with its own light-ramp ink-only fallback, §4) already
is.

**A second, source-confirmed consequence of the retirement:** two file
header comments are now stale documentation of behavior that no longer
exists, a Rule-20-class finding in its own right:

- `RaceDetailV5.swift:16-19`: *"RULE ONE — Projected is modelled and MUST
  carry the tilde. That happens for free … This view cannot print it as a
  bare String even if it wanted to."* — false as written; confirmed by
  render (`8a`, §4) that no tilde appears.
- `PacesMovedV5.swift:166`: the comment describing the caption's own manual
  tilde is accurate about ITS mechanism, but sits beside a screen
  (`18a-slower`) whose actual zone-value tildes (the ones the design
  contract's own text says should be on "every value") are the retired
  kind, not the caption's decorative kind — the file doesn't call this out,
  so a future reader could easily conflate "the caption has a tilde" with
  "the values have tildes."

REFINE/RESTYLE, priority 1 if the tilde reinstatement is confirmed current
— this is the single highest-leverage fix in this whole report, being one
function with app-wide reach, and the doc-staleness findings should be
fixed in the same change per Rule 20's own instruction ("fix the gate, not
just the instance").

---

## 16. Final register — KEEP / REFINE / RESTYLE / UNIFY / REMOVE / CREATE

Merges this pass's findings with Phase 1's still-valid ones (cited by Phase
1's own numbering where applicable). Phase 1 findings not re-verified this
pass are marked so explicitly rather than silently dropped or silently
re-asserted.

### CREATE

1. **Reinstate the modelled `~` marker in `FaffValueText`'s `.modelled`
   case** (§15), if the task's stated correction (David overrode the
   2026-08-21 retirement) is still current. Single highest-leverage item in
   this report. Fix the two stale header comments (`RaceDetailV5.swift`,
   `PacesMovedV5.swift`) in the same change per Rule 20.
2. **A standalone, presentable Training-calendar-sheet view**, extracted
   from `TodayBeforeV5`'s private `calendarSheet` property, so it can carry
   an `initialOpen` parameter the way `OnboardingV5` already carries
   `initialStep` — this closes the one catalog gap this pass could not
   close with a tooling-only change (§0.3).
3. *(Phase 1 #7, closed this pass via tooling addition, §0.3):* catalog
   entries for Add-Shoe, Account sheet, and Decision history now exist.

### RESTYLE

1. **`RacesV5.swift`'s `"Needs a decision"` eyebrow label**, gate it on
   `card.shape` the same way the buttons and target tiles already are
   (§4). Priority 1 — this is the exact confusion the card-shape split
   exists to prevent, now happening one level up from where it was fixed.
2. **`RouteMapView.swift`'s green start-marker dot** (`0x3EBD41`, the
   Easy-day green, labelled "Success green" in its own comment) — replace
   with a palette-neutral ink (§3). Priority 2.
3. *(Phase 1 #1, confirmed still present and release-blocking, §9 H1):*
   the `12b` treadmill console's cues-menu overlay occludes the
   current-interval label — reproduces at every Dynamic Type category and
   both size extremes tested this pass, so it is not a scaling or
   device-width artifact; it is a fixed-geometry collision. Priority 1,
   unchanged from Phase 1.

### REFINE

1. **`RacesV5Sample.fullJSON`'s hardcoded `"3:16:45"` Projected value**
   (§4), shared across every verdict variant regardless of `goal`/`gap` —
   fix so the catalog's own fixture data is internally consistent.
   Priority 3.
2. **A one-word sub-label ("Elevation") on the barometer-derived figure**
   that currently sits beside/above a "No GPS for this run." caption on
   `5b`/`5d`/`23c` (§6) — removes an apparent (not actual) contradiction.
   Priority 3.
3. *(Phase 1 #3, re-confirmed unchanged, §5):* 14 `.system()` font sites
   bypassing `faffText` in the live layer. Priority 3, unchanged.
4. **The catalog harness's own "Close" pill** collides with real bottom-row
   content on at least five screens (§8) — move it to a position no real
   screen occupies. Tooling fix, not a product fix; flagged for whoever
   maintains `ScreensCatalogV5.swift`.
5. *(Phase 1 #4, not re-verified this pass, carried forward as open):*
   `BlockV5.swift:863`'s `Alert(text:...)` omitting `tone:`.

### UNIFY

*(none new this pass — no second-source-of-truth pattern was found beyond
what §4/§15 already describe as single-function fixes, and Phase 1 named
none in this category.)*

### REMOVE

1. *(Phase 1 #2, unchanged, confirmed still real and still unreachable):*
   40 sites / 13 files in legacy `Views/*.swift` use `Theme.green` as a
   grade — real code, unreachable behind `-faffLegacy`, remove once that
   debug path is retired. Priority 2, currently-unreachable per Phase 1's
   own framing.

### KEEP (positive findings, worth stating so they aren't silently lost in
a report dominated by defects)

1. The dark-ink-on-light-ramp gradient exception (§4) — genuinely
   well-argued, measured, David-ruled accessibility engineering, not a
   shortcut.
2. `12a-noheart` and `12a-gps`'s Rule-11-compliant "don't know / measured
   zero / read failed" handling (§9 H9) — among the clearest examples of
   this discipline found anywhere in this pass.
3. `16a`'s ErrorNote + Skeleton outage handling — exemplary, byte-for-byte
   matches the design contract's stated rules.
4. The `decisions` screen (tooling-added this pass, §0.3) is direct,
   rendered evidence that CLAUDE.md's Rule 21 vocabulary ("push",
   "pull_back", "applied", "expired", "waiting on you") has reached the UI
   layer with correct, non-green, amber-for-"waiting" styling — worth
   knowing this exists and renders correctly the next time Rule 21's
   "wired, tested and inert" concern comes up, since the UI side of that
   concern is not inert.
5. Phase 1's "single 30-component library, no duplication" finding, and its
   "no hardcoded hex outside the two token files" finding — both hold, on a
   more than double-sized render set (65 vs. 30 states).

---

## Appendix: environment notes

- Xcode toolchain: `/Applications/Xcode.app`, iOS 26.5 simulator runtime
  (`iOS-26-5`, only runtime installed), target `arm64-apple-ios17.0-simulator`
  (project's own `IPHONEOS_DEPLOYMENT_TARGET = 17.0`).
- Three dedicated simulators created for this audit and left in place at
  session end (not deleted, in case a follow-up session wants to reuse
  them): `AuditPhase2-15Pro`, `AuditPhase2-SE3`, `AuditPhase2-16ProMax`.
- 280 AppleDouble (`._*`) sidecar files were found under `native-v2` and
  deleted before building — untracked junk (confirmed via `git ls-files`
  before deletion), consistent with this project's own known
  WP-volume/AppleDouble issue; not a source change.
- `Secrets.xcconfig` was created from `Secrets.example.xcconfig` (gitignored,
  blank CARTO key) to satisfy `xcodegen`'s build-time requirement that the
  file exist — the build succeeds with a blank key; `RouteMapView` gets a
  401 from CARTO instead of basemap tiles, which is why some route-map
  screenshots in this report show a plain black background rather than
  street-level tiles (visible difference between e.g. `23a`, which shows
  real tiles, and `5b-miles`, which doesn't — both are legitimate depending
  on whether the specific fixture's coordinate count triggers the map at
  all versus a degenerate 2-point line, not a CARTO-key artifact in either
  case actually, both rendered tiles fine when a real map was drawn).
- No `DATABASE_URL_RO` was available; no live server was reachable; every
  render in this report is `[Render-sample]` or `[Source]`, never
  `[Render-prod-data]` or `[Prod-query]`, stated once here per the evidence
  legend rather than re-disclosed on every finding.
- Total renders this pass: 65 baseline states (62 catalog + 3 tooling-added)
  + 36 Dynamic Type matrix + 18 iPhone-size matrix = 119 screenshots,
  plus several targeted re-renders and pixel-diff verifications during
  methodology self-checks (§0.5).
