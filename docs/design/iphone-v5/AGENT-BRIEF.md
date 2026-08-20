# v5 screen brief — read this before writing a line

You are transcribing ONE screen of an approved, final design into SwiftUI.
Colours, typography, spacing, radii and copy are exact. This is not a redesign.

## Read, in this order

1. `docs/design/iphone-v5/reference/screens/<id>.html` — your screen's markup.
   Every measurement is in it. `docs/design/iphone-v5/reference/screens/_script-data.js`
   holds the sample data and the real copy strings for every screen.
2. `docs/design/iphone-v5/reference/README-v5-handoff.md` — the section for
   your screen, plus "Design tokens" and "Interactions & behavior summary".
3. `docs/design/iphone-v5/BUILD-PLAN.md` — the four rules and the machinery.
4. `native-v2/Faff/Faff/DesignV5/` — the kit. Read all five files before you
   write anything. You are almost certainly not adding a component.

The prototype cannot be opened in a browser: its design-system bundle was not
shipped with the handoff. Its SOURCE is the reference, exactly as its own
README says.

## The four rules

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

## Translation table

| Prototype | SwiftUI |
|---|---|
| `var(--material-tile)` | `V5.materialTile` |
| `var(--text-quiet)` | `V5.textQuiet` |
| `var(--signal)` | `V5.signal` |
| `background:{{ d.gradPanel }}` + grain | `DayPanel(fill: .state(...))` |
| `class="faff-display"` ≥20px | `.font(.faffDisplay(size)).textCase(.uppercase)` |
| `class="faff-display"` <20px | `V5SectionLabel(text:)` |
| `class="faff-value"` | `.font(.faffText(size, weight:))` — tabular by default |
| `…ListGroup header=…` | `ListGroup(header:) { … }` |
| `…ListRow label= sub= value= onClick=` | `ListRow(label:sub:value:onTap:)` |
| `…CoachSay size="md"` | `CoachSay(text:size:.md)` |
| `…Alert tone="attention"` | `Alert(text:tone:.attention)` |
| `…ErrorNote onRetry=` | `ErrorNote(text:onRetry:)` |
| `…Skeleton lines={{3}}` | `Skeleton(lines: 3)` |
| `…Silence reason=` | `Silence(reason:)` |
| `…Button variant= size= full=` | `FaffButton(_:variant:size:full:action:)` |
| `…RangeScale mode= min= max= band= value=` | `RangeScale(mode:min:max:band:value:endpoints:)` |
| `…ZoneBar shares= target=` | `ZoneBar(shares:target:height:labels:)` |
| `…PhaseBar phases=` | `PhaseBar(phases:height:)` |
| `…ElevationProfile points= marks=` | `ElevationProfile(points:marks:footnotes:height:)` |
| `…DualPoint left-label= …` | `DualPoint(leftLabel:leftValue:rightLabel:rightValue:…)` |
| `…TrendBars values= highlight=` | `TrendBars(values:highlight:height:headline:…)` |
| a sheet | `V5SheetHost(isPresented:title:) { … }` |
| an editable row | `ExpandingRow(label:value:question:isExpanded:) { … }` |

## Hard rules for the code you write

- **Never a hex literal, never `Color(red:…)`.** Paint from `V5.*` only. A hex
  in your file fails `scripts/check-palette-sync.sh`.
- **Never `Font.custom`.** Archivo 800 / width 112 is not a named instance, so
  `Font.custom("Archivo-ExtraBold", …)` silently returns the right weight at the
  wrong width. Use `Font.faffDisplay(_:)` / `Font.faffText(_:weight:width:tabular:)`.
- **Never a `String` where the kit takes a `FaffValue`.** That is rule one.
- **No borders.** Containment is a fill-step change, never a hairline. Nothing
  you write may call `.border`, `.stroke` on a container, or `.overlay` a
  1pt rule.
- **Nothing bounces, pulses, or scales up.** Use `V5.Motion.*` and nothing else.
  No `.spring`, no `.repeatForever`, no shimmer — the design says the loading
  placeholder specifically does not pulse.
- **Reserve the final layout height always.** "Nothing appears or disappears and
  reflows." Seed state synchronously from `AppCache.read(...)` where a cache key
  exists; otherwise render `Skeleton` at the real content's height.
- **No assets.** Every graphic is drawn from data. The only icons are system
  stroke glyphs (chevron, plus, minus, calendar).
- **Identity is the server id, never the date.** A plan day carries one.
- **Expand in place.** Never a full-screen picker, never a wheel, and never a
  chevron on a row that has nothing to open.

## Shape of your deliverable

ONE new file, `native-v2/Faff/Faff/ViewsV5/<Name>V5.swift`. It exposes a
`struct <Name>V5: View` that takes its decoded model as a `let` and renders it.
It does NOT fetch, does not own navigation, and does not define new tokens or
components. Callbacks for anything that leaves the screen come in as closures.

Add a `#Preview` driven by a `static let sample` built from the prototype's own
sample data, so the screen can be looked at without a server.

## Verify before you report

```bash
cd native-v2 && xcrun swiftc -typecheck \
  -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" \
  -target arm64-apple-ios17.0-simulator \
  $(find Faff/Faff -name '*.swift' ! -name '._*')
```

`/Volumes/WP` is not APFS, so an AppleDouble `._*` shadow sits beside every
source file and fails with "invalid character in source file". Always exclude
`._*`. Do not claim "compiles by inspection" — run it.

Report: the file you wrote, anything in the design you could not build and why,
and any place the prototype and the README disagree.
