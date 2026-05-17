# faff.run Design System

**Status:** locked as of hub.html hero-hub iteration.
**Canonical reference mockup:** `designs/hub.html` (hero hub · v.1)
**Prior system reference:** `designs/hub-system.html` (superseded)
**Palette research:** `designs/palette-research.html`

The hub ripples to everything else — watch, iOS, future tabs. If a decision isn't in this doc, check hub-system.html before inventing a new rule.

---

## 1 · Color system

Based on a layered dark-first product palette. Five background values give real spatial depth; five semantic colors give role-based meaning; additional data colors are used sparingly for chart coding.

### 1.1 Layers (background scale)

| Token | Hex       | Role                                 |
|-------|-----------|--------------------------------------|
| `--l0`| `#10131A` | Basement. Page canvas.               |
| `--l1`| `#141820` | Background. Default tile.            |
| `--l2`| `#1A212D` | First. Raised tile / today card.     |
| `--l3`| `#1D2736` | Second. Inset (calendar cells, progress tracks, chip default). |
| `--l4`| `#21303F` | Third. Borders, strokes, hairlines.  |
| `--l5`| `#2b3a4e` | Hairline highlight (rare).           |

**Rule:** tiles step up one layer from their container. Never jump more than one. Canvas `l0` → tile `l1` → raised tile `l2` → inset content `l3`.

### 1.2 Type colors

| Token | Value                      | Role                       |
|-------|----------------------------|----------------------------|
| `--t0`| `#F6F7F8`                  | Primary type.              |
| `--t1`| `rgba(246,247,248,.72)`    | Secondary body.            |
| `--t2`| `rgba(246,247,248,.48)`    | Tertiary / labels.         |
| `--t3`| `rgba(246,247,248,.32)`    | Meta / captions / muted.   |

### 1.3 Semantic (system) colors

Each has one job. Never mix roles.

| Token          | Hex       | Role & usage |
|----------------|-----------|--------------|
| `--corporate`  | `#008FEC` | **Primary accent.** Active state, today, primary links, default chart stroke, "Send to watch" CTA. |
| `--warning`    | `#FC4D54` | **Alert only.** Overtraining, shoe retirement, ACWR danger zone, injury-risk flags. **Never decorative.** Red reads as ALARM — do not use for race signal, highlights, or accents. |
| `--success`    | `#3EBD41` | **Good / on-track / completed.** Done workouts, positive deltas, recovery ring, metrics inside target range. |
| `--caution`    | `#F0DF47` | **Needs work / soft warning.** Middle tier of the green→yellow→red health scale. Metrics drifting off target but not alarming: sleep short a night, HRV dip, one long run missed, shoe approaching rotation, pace behind plan. *Not* an alert — a nudge. |
| `--attention`  | `#F3AD3B` | **Race signal / taper / special day.** Race day + race-week countdown, race tile border + glow, race-day bar, race cell in calendar, taper notice. Amber reads as *special day*, not alarm. |
| `--xp`         | `#9013FE` | **Milestone / aspiration.** Season-goal tile gradient, marathon-prediction tile, brand logo, avatar. Reserved for achievement moments — the big annual arc, not the weekly race. |

### 1.4 Additional / data colors

Used for calendar & chart category coding. Never for chrome.

| Token         | Hex       | Role                         |
|---------------|-----------|------------------------------|
| `--lt-blue`   | `#2784E0` | Easy workout days.           |
| `--dk-blue`   | `#2264E3` | Long workout days.           |
| `--aqua`      | `#27E087` | Quality / interval workouts. |
| `--yellow`    | `#F0DF47` | *Promoted to semantic `--caution` — see 1.3. No longer used decoratively.* |
| `--pink`      | `#CD317C` | *Reserved — cross-training?* |
| `--orange`    | `#E88221` | *Reserved — warmup zones?*   |
| `--green`     | `#139520` | *Reserved — ultra category?* |
| `--gray`      | `#646464` | Rest days, muted states.     |

### 1.5 Gradients

Two canonical gradients. Don't invent new ones.

- **XP → Corporate**: `linear-gradient(135deg, #9013FE 0%, #008FEC 100%)` — season goal tile, brand logo, avatar. The signature brand gesture.
- **Layer → Accent wash**: `linear-gradient(135deg, var(--l2) 0%, rgba(ACCENT, .12) 100%)` — used with XP for marathon prediction tile, with Warning for race countdown tile. Soft accent wash on a raised tile.

### 1.6 Chip system

Chips are the small status/delta labels. All share one structure:

```
font: Jost 8.5px / letter-spacing 1.2px / weight 700 / uppercase
padding: 3px 7px / radius 4px / border 1px solid {variant}
```

Variants: `chip` (default, layer-3 bg) · `chip--success` · `chip--warning` · `chip--attention` · `chip--corporate` · `chip--xp` · `chip--yellow`. Each uses the accent color at 12–15% bg, full color text, 30% color border.

---

## 2 · Typography system

Three fonts, three jobs. Never mix outside these roles.

### 2.1 Font stacks

| Token         | Stack                                                                           | Google Fonts |
|---------------|----------------------------------------------------------------------------------|--------------|
| `--f-display` | `"Oswald", "Headliner", "Bebas Neue", "Helvetica Neue Condensed", "Arial Narrow", sans-serif` | Oswald |
| `--f-body`    | `"Jost", "Futura PT", "Futura", "Trebuchet MS", "Century Gothic", Avenir, sans-serif`          | Jost |
| `--f-label`   | Same as body (used where casing/tracking differ from body defaults)              | Jost |
| `--f-data`    | `"JetBrains Mono", "SF Mono", "IBM Plex Mono", ui-monospace, monospace`          | JetBrains Mono |

**Production license plan:** swap in Headliner (or Futura Condensed Bold) + Futura PT when the iOS/native app ships. The Google Fonts stack is the universal fallback.

### 2.2 Role map

| Role                          | Font      | Treatment                                                     |
|-------------------------------|-----------|---------------------------------------------------------------|
| Hero numbers (pace, distance) | display   | `.inst-num` 38px, `.stat-num` 36px, weight 800, tabular-nums, letter-spacing −.035em |
| Headlines (race names, workout titles, "Ready to run", user name) | display | UPPERCASE, weight 600, letter-spacing .005em, line-height ~1 |
| Name / hero headline          | display   | 68px uppercase, weight 600                                    |
| Body text, KPI values         | body      | 14–19px, weight 500–800                                       |
| Tile labels                   | label     | 9px UPPERCASE, weight 700, letter-spacing 1.8px               |
| Timestamps, meta, technical   | data      | 8.5–10px, weight 700, letter-spacing 1.2–1.8px                |
| Eyebrow labels ("Good morning") | label   | 11px UPPERCASE, letter-spacing 2px                            |

### 2.3 Rules

- **No Georgia, no italic serifs.** The condensed display carries all the editorial weight. Serifs fight Oswald.
- **Display font is always uppercase** at headline sizes. Mixed case breaks the condensed rhythm.
- **Display font drops periods** (`David Nitzsche`, not `David Nitzsche.`). Uppercase display doesn't want punctuation.
- **Tabular numerals** on all numeric hero values (`font-variant-numeric: tabular-nums`).
- **No highlighter blocks** on multi-line text. If text wraps, the highlight breaks. Use accent bars + tracked labels instead.

---

## 3 · Layout & spacing

### 3.1 Containers

- Page max-width: `1440px`
- Stage radius: `20px`
- Tile radius: `14px`
- Small chip/cell radius: `4–8px`
- Body padding: `26px 28px 30px`

### 3.2 Grids

- **Stat row:** 4 columns, equal, `gap: 10px`
- **Charts row:** `1.4fr 1fr 1.1fr`, `gap: 10px` (This week / Calendar / Today)
- **Instrument grid:** 6 columns, `grid-auto-rows: minmax(172px, 1fr)`, `gap: 10px`
- Hero tiles: `grid-column: span 2`

### 3.3 Spacing scale

Roughly 4/8/12/16/20/24/28 px. Use 10px for tile gaps (tight), 14–20px for tile interior padding.

---

## 4 · Component rules

### 4.1 Tiles

- Default: `background: var(--l1)`, `border: 1px solid var(--l4)`
- Raised: `background: var(--l2)` (today card, recovery hero)
- Accent-washed: `linear-gradient(135deg, var(--l2), rgba(ACCENT, .12))` + matching colored border at 30% alpha
- Race tile: `var(--l1)` bg + `border: 1px solid var(--warning)` + radial glow in corner

### 4.2 Data visualization

- **One color per tile.** Each instrument tile commits to one accent. No rainbow zone bars.
- **Sparklines** always include a filled area gradient (accent at 35% → 0%) + stroke line + endpoint dot.
- **Bars** use layer-3 for inactive, accent for active. Race day bar in time/pace charts is always warning-red.
- **Rings** use `var(--l4)` as track, accent as fill, `transform: rotate(-90deg)` so they start at 12 o'clock.
- **Gauges** (ACWR) use corporate → success → warning arc for safe/sweet/danger zones.

### 4.3 Calendar color coding

Always: Easy=light-blue · Quality=aqua · Long=dark-blue · Race=warning · Rest=layer-3. Today cell: corporate bg with layer-0 + corporate shadow ring.

---

## 5 · Motion & interaction (forward notes)

Not yet designed. When added:
- Transitions: 180ms ease-out default, 240ms for modal/sheet
- No bouncing, no springs. Sports dashboards feel serious.
- Hover raises tile by one layer value (l1 → l2) + 1px border brightening
- Active tap: 0.96 scale, 120ms

---

## 6 · What NOT to do

Mistakes made during exploration, locked out:

1. **No rainbow within a single tile.** Multi-hue HR zone bars, rainbow training-year histograms — killed. Grid richness comes from 12 single-note tiles, not from each tile being colorful.
2. **No orange + warm brown pairing.** Reads Halloween.
3. **No Georgia italic.** Fights Oswald. All editorial weight comes from the condensed display.
4. **No highlighter blocks on wrapping text.** The yellow "TAPER BEGINS / WEDNESDAY" wrap was the canonical failure.
5. **No lime anywhere.** It was an attempted third accent — not in the system.
6. **No flat mixing of bone + ink.** Use the layer scale. Depth is built into the palette.
7. **No multi-line period-terminated sentences in display type.** Trim the period, trim the extra clause.
8. **No red for race signal, decoration, or highlights.** Red (`--warning`) reads as ALARM / ALERT and nothing else. It appears only when something is genuinely wrong: overtraining, ACWR danger zone, retired shoes, injury flags. Race day, countdown, race-week bars, race calendar cells all live on `--attention` (amber) — race is a special day, not an emergency.

---

## 7 · Cross-platform parity

Because the hub ripples to watch + iOS:

- **Watch (SwiftUI + HKWorkoutSession):** uses same semantic tokens. Ring colors lock to: recovery = success; target pace = corporate; behind pace = warning; ahead = aqua. Race-day HUD uses warning accent throughout.
- **iOS native:** inherits the dark palette as default; optional light mode flips layer scale (basement → white, inverting the t0–t3 scale) but keeps all semantic colors identical.
- **Light mode (future):** palette system already supports it. Light layers from source palette: `#F6F7F8` / `#E6E8EF` / `#BFBFBF` / `#FFFFFF` / `#B6BBCC`.

---

## Change log

- **2026-04-21** — Initial lock. Palette + typography + tile rules derived from hub-system.html. Previous experiments (paper/cobalt/lime/bone variants) archived in `designs/` but superseded.
- **2026-04-21** — Hero hub locked (`designs/hub.html`). Instrument grid extended to 3 rows × 6 cols, organized into Readiness (row 1), Fitness (row 2), Volume + Race (row 3). Five research-backed training metrics integrated at hub surface: HRV 7d trend, threshold pace, aerobic decoupling, cadence, last-5K vs goal. ACWR gauge and resting HR round out the diagnostic set. Hub-system.html retained as palette reference only.
- **2026-04-21** — Hub simplified to 2 rows × 6 cols (10 tiles). Cut: Streak, Resting HR, Longest 30d, Pace·week, Training 12mo, 2026 ring, Shoe rotation, Conditions. Added Sleep · 7d (research short-list addition). Heroes staggered diagonally (Recovery top-right, Marathon bottom-left) to avoid vertical stacking.
- **2026-04-21** — **Red reassigned to alerts only.** `--warning` no longer carries race signal. Race day / countdown / race-week moved to `--xp` (purple), unifying the "race = goal = aspiration" color story. Red reads as ALARM and is now reserved for actual warnings (overtraining, ACWR danger, retired shoes, injury flags).
