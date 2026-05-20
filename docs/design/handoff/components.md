# Component inventory (item 6)

Reusable pieces — build once, reuse everywhere. Each lists variants + states.
All literal values are in `faff-app.html`; this is the catalogue + the matrix.

---

### 1. `FaffCard` (surface) — exists in Theme
White, radius **18**, no border, soft shadow (`0 6px 20 .05`). Padding variants:
hero `17`, default `16`, tile `12`, list-card `4–6 vertical` (rows carry their own padding).

### 2. Sticky top bar ➕ NEW
Height ≈44. Left: **FAFF wordmark** (Bebas italic, `faffMark` gradient, 22 pt).
Right: **race chip** + **avatar** (28 pt). Sits above the scroll on every tab,
does not scroll. Background `bg` at 78% + blur(20), bottom hairline `divider`.

### 3. Race countdown chip ➕ NEW
Pill, `chipSm` radius, `orangeWash` bg, `race` text. Content: flag glyph + race
short name + "· {N}d". Variants: header (compact). **Interaction:** tap → Race detail.

### 4. Avatar ➕
28 pt (sticky bar) / 34 / 52 (Profile) circle, `faffMark` gradient, white initial.
**Interaction:** tap → Profile (push).

### 5. Bottom tab bar
Height 84 (62 + 22 inset). 5 items: Today · Plan · Coach · Health · Races.
Active = `race` orange; inactive = `textDim`. Icons: SF Symbols (see assets).
Label Inter 9.5/600.

### 6. Date strip ➕ NEW (Today)
7 equal day-cells. Each: dow letter (`textDim`), day-of-month (Bebas 20),
status dot. Cell states:
- **selected** — ink pill fill, white text.
- **today (not selected)** — `race` orange 1.5 pt inset ring + orange text/number.
- default — plain.
Dots: done = `recovery` green · today = `milestone` amber · upcoming = `textFaint` ·
rest = hollow ring. **Interaction:** tap a cell → re-render Today for that date
(see screens-spec: recap/preview).

### 7. Coach brief (paragraph)
Inter 14 / line-height 1.5, `ink`. Inline **bold** (700) for emphasis; race
reference rendered in `race` orange. Optional preceding coach label
(eyebrow, only on Coach tab — removed from Today, the date strip provides context).

### 8. Stat pill
`pillBg` fill, 1 pt `pillLine` border, radius **12**, padding 11/12/10.
Value Bebas 27 (+ `race` orange variant for pace), unit Inter 11, label Inter 9 upper.
Used 3-up (Today hero) or 4-up (Run recap: Distance/Avg pace/Time/Avg HR).

### 9. Button variants
- **Primary** — `ink` fill, white, radius 13, Oswald 13/600 upper, leading SF icon.
  ("Open Workout", "Start Run".)
- **Ghost** — surface fill, 1.5 pt `pillLine` border, `ink` text, soft shadow.
  ("Skip", "Substitute", "View full recap", "Open workout", "Connect Apple Health",
  "Race-day brief unlocks…" with lock icon.)
- Button **row** — equal-width ghosts side by side (Skip / Substitute; Move / Skip / Swap).

### 10. Badge / chip
Radius `chip` (8), Inter 9.5/700 upper. Variants:
`green` (recovery wash + green text) "On plan" · `amber` (amberWash + `amberInk`)
"Watch Load" / "Hold easy" · `orange` (race fill, white) "Mile 14" / race-day ·
`grey` (pillBg + textDim) "Connect" / "Upcoming" / "Sat AM" · `warn` (red wash) errors.

### 11. Readiness ring ➕ NEW
Circular progress, 270° arc (gap at bottom), track `ink08`, fill = state color
(green/amber/red). Center: Bebas number (no label inside — label is external).
Sizes: 54 (Today inline), 62, 70 (Health hero), 42–48 (placeholder/empty).
Empty: dashed track, "—" center.

### 12. Metric tile ➕ NEW (Health dashboard)
`FaffCard` variant, radius 14, padding 12. Stack: label (Inter 8.5 upper, ellipsis),
value (Bebas 26) + unit (Inter 8.5), delta (Inter 8.5/700 — `good` green /
`watch` amberInk / `flat` textDim). 3-column grid, gap 8. **Interaction:** tap →
Metric detail sheet. Empty: value "—", delta "No data".

### 13. Segmented control ➕ NEW (Metric detail range)
`pillBg` + 1 pt border, radius 9, padding 3. Segments equal; selected = surface
fill + shadow + ink; others `textMuted`. Labels Inter 11/600 ("7D / 30D / 90D").

### 14. Coach verdict block ➕ NEW (Coach, Workout, Why-this)
`FaffCard` with 3 pt **left border** in the verdict color. Label (Inter 9.5/700
upper) + body (Inter 13). Variants: **Why** green border/label · **Focus** amber ·
**Back off if** red.

### 15. Signal row ➕ NEW (Coach, Why-this)
Leading badge + body text (Inter 12, `textMuted`). Variants: green "On track" /
amber "Watching" / grey "Connect" / "Evidence".

### 16. Trend row ➕ (Health legacy / Today readiness inline)
Label + value (colored) on top; track bar (`track`) with colored fill below.

### 17. Check-in slider
Label (54 pt fixed) + track (7 pt, radius 4) with green gradient fill + 20 pt
white thumb + value (Bebas 21). States: editable (Today, today only),
**read-only/logged** (recap: Energy + RPE shown), **disabled** (preview:
opacity 0.4, "—", "Opens Sat AM").

### 18. Structure row ➕ NEW (Workout detail)
4 pt color **bar** (warm = ink14 / work = green) + body (name Inter 15.5/700,
sub Inter 11.5 `textDim`) + distance (Bebas 27 + unit). One per segment.

### 19. Split row ➕ NEW (Run recap)
Mile # (Bebas 17 `textDim`) + progress bar (`sbar`, green fill) + pace (Bebas 18)
+ HR (Inter 10 `textDim`). Target band shown in card header.

### 20. Phase row ➕ NEW (Race detail)
Numbered square chip (color by grade: green/amber/blue/orange) + name + grade pill +
mile range + target pace (Bebas) + cumulative time. Last row "FINISH" in `race`.

### 21. Grade band ➕ NEW (Race detail)
Horizontal bar split into proportional colored segments (green/blue/green/amber)
under the elevation chart.

### 22. Elevation chart ➕ (Race detail)
Line + area SVG, dashed phase-boundary verticals. (In SwiftUI: `Path` / Swift Charts.)

### 23. Route map ➕ NEW (Run recap, Race detail)
**Image** (PNG/SVG), full card width, 140 pt tall. Bold orange route + white casing,
green start pin / orange finish pin, on a light street-map base. Overlaid start/finish
labels (white pill chips). See assets — in SwiftUI use `MapKit` `Map` with a polyline
overlay for real GPS, or the supplied static image as placeholder.

### 24. Push-detail header ➕ (Race detail, Profile)
Back chevron + label (left), title (center, Oswald upper), action (right: Share / Done).

### 25. Sheet grab handle
38 × 5 pt, `textFaint`, centered, top of slide-up sheets.

### 26. Why chip ➕ NEW (Today hero)
Small pill (`chipSm`), `pillBg`, `textMuted`, "?" SF circle glyph + "Why this".
Top-right of hero card. **Interaction:** tap → Why-this sheet.

---

## State matrix (which components show which states)

| Component | populated | empty | loading | error |
|---|---|---|---|---|
| Stat pill | value | "—" | shimmer | — |
| Readiness ring | score + color | dashed "—" | spin/shimmer | dashed "—" |
| Metric tile | value+delta | "—" / "No data" | shimmer | "No data" |
| Coach brief | copy | "No data yet" copy | 3-line shimmer | error card |
| Check-in slider | value | unlogged (thumb 50%, "—") | — | — |
| Route map | image | grey card + "Route syncs from your watch" | shimmer | grey card |
| Week list row | day | — | shimmer rows | — |

Loading = skeleton that **mirrors the final layout** (design law). Empty =
collapse to the honest copy, never a placeholder shape. Error = single card,
title + one line + "Try again" ghost button.
