# Faff iPhone — SwiftUI implementation handoff

Everything needed to build the iPhone app in SwiftUI from the finished design,
with no follow-up questions. Authored to mirror the existing format
(`designs/V4_DESIGN_LAW.md`, `web/app/components/v4/tokens.ts`,
`docs/design/iphone-handoff.html`) so it maps ~1:1 to `Theme.swift`.

## Where each thing lives

| You want… | Open |
|---|---|
| The **populated render** of every screen, exact literal values, at iPhone width | **`docs/design/faff-app.html`** (open in a browser; each phone is one screen) |
| **Token delta** vs the current `Theme.swift` (diff this first) | `handoff/tokens.md` |
| **Component inventory** — reusable pieces, variants, states | `handoff/components.md` |
| **Assets** — logo, icons (SF Symbol vs custom), fonts, route maps | `handoff/assets.md` |
| **Per-screen spec** — states, verbatim copy, data binding, interactions, haptics | `handoff/screens-spec.md` |
| **Rendered net-new states** (loading / empty / error) at iPhone width | `handoff/states.html` *(follows this batch)* |

> **Why `faff-app.html` is the populated reference rather than 12 separate files:**
> it already contains every screen at 390 pt width with literal hex / px / font
> values an engineer can read directly, and it's the file the design was approved
> from. Re-authoring it into per-screen files would only duplicate it. The
> handoff docs add the layer `faff-app.html` doesn't carry: the **other states**,
> the **copy/binding/interaction annotations**, and the **token + component
> system**. If you specifically want each screen split into its own file, that's
> a mechanical split — say so and I'll do it.

## Canonical render width

390 pt logical width (iPhone 14/15/16 base). Status bar 54 pt, tab bar 84 pt
(incl. 22 pt home-indicator inset). All values in `faff-app.html` are at this
scale; SwiftUI uses the same point values.

## Screen index (item 8)

States legend: **P** populated · **E** empty/no-data · **L** loading · **X** error

| # | Screen | Kind | States | Notes |
|---|---|---|---|---|
| 1 | **Today** | Tab | P · E (rest day) · L · X | Hero is state-driven (run vs rest day) |
| 1a | Today · past date | Tab (date-scrubbed) | P (recap inline) | Hero → actual vs plan |
| 1b | Today · future date | Tab (date-scrubbed) | P (preview) | Readiness + check-in collapse |
| 2 | **Workout detail** | Sheet (from Today) | P · L | Slides up; primary = Start Run |
| 3 | **Run recap** | Sheet (auto after sync) | P · L | Route map + splits |
| 4 | **Plan** | Tab | P · E · L · X | Week list + coming-up |
| 5 | **Coach** | Tab | P · E · L | Read-only; not a chat |
| 6 | **Health** | Tab | P · E (not connected) · L · X | Tile dashboard |
| 7 | **Metric detail** | Sheet (from a Health tile) | P · L | HRV exemplar; one template for all tiles |
| 8 | **Races** | Tab (under More→Races) | P · E (no race) · L | Orange countdown card |
| 9 | **Race detail** | Push (from Races) | P · L | Route + profile + phase pacing |
| 10 | **Profile** | Push (from avatar) | P | Integrations + settings |
| 11 | **Why this** | Sheet (from Why chip) | P | Workout rationale |

Navigation model: **5 bottom tabs** — Today · Plan · Coach · Health · Races.
A **sticky top bar** (brand + race-countdown chip + avatar) sits above content on
every tab. **Profile** is reached by tapping the avatar (push, not a tab).
**Races** is a first-class tab (replaces the old "More").

## Acceptance

Each value in `faff-app.html` is literal and readable. `tokens.md` tells you what
to change in `Theme.swift`. `screens-spec.md` gives every copy string, data
source, state, and interaction. If anything here conflicts with data already
wired in the live screens, it's called out in `screens-spec.md` under
"Data binding."
