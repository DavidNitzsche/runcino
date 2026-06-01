# Handoff: This Week strip card (web) · Direction A

## Overview
A redesign of the **"This Week" strip** on the web Today view (`TodayView.tsx`) — the row of 7 day cards. It cleans up the layout now that runs can be **adapted by the coach** ("was X") and carry a **strength add-on** ("+ strength"). The current cards grow taller when annotated, leaving a ragged bottom edge. Direction A fixes that.

## About the design file
`Faff Week Strip (Direction A).html` is a **design reference** (working HTML/JS), not production code. Recreate the card in the web app's existing component (the day chip in `TodayView.tsx`) using its tokens and the `seed.week[i]` data. The prototype renders a full mixed-state week plus an isolated gallery of every state.

## Fidelity
**High-fidelity.** Match layout, sizing, color, and the state logic below.

---

## The core idea
**Fixed card height (152px) with a reserved meta row.** Every card always renders the bottom meta zone (16px tall) whether or not it has an adaptation note, so cards never change height and the bottom edge stays flush. Annotations have one consistent home each:
- **Done** and **strength** → small 20px glyph chips in the **top-right cluster**.
- **Adaptation** ("was X") → a single **amber meta line** at the bottom.
- Strength is **demoted from a full text row to a glyph** (it used to add a 5th line to only some cards).

## Card anatomy (top → bottom)
Card: `background rgba(6,26,28,.4)`, `border 1px rgba(255,255,255,.1)`, `radius 16`, `padding 15px 15px 14px`, **`height 152px`**, `backdrop-filter blur(8px)`, flex column.

1. **Top row** (`min-height 18px`, space-between):
   - Left: day label + date. `11px / 800 / ls .8`, color `rgba(255,255,255,.5)`; the date `b` is `14px` white. On **today**, the label turns `#FF8847` (orange), date stays white.
   - Right: **icon cluster** (`gap 6`). Each glyph is a 20×20 rounded chip (radius 6) with a 13px icon:
     - **strength** → dumbbell icon, `bg rgba(243,173,56,.16)`, color `#ffce8a`.
     - **done** → check icon, `bg rgba(62,189,65,.18)`, color `#62e08a`.
     - (order: strength then done, so done sits rightmost.)
2. **Run name** (`19px / 700 / ls -.3`, `margin-top 13`): an **effort dot** (8px, effort color) + the name. Rest shows just "Rest" (no dot, `font-weight 600`, slight dim).
3. **Metrics** (`12.5px / 600`, `rgba(255,255,255,.78)`, in a `flex:1` middle zone so the meta row pins to the bottom): `"{dist} · {pace}"` e.g. `6.0 mi · 8:12`. **No leading dot** (the effort dot lives on the name only — do not duplicate it here). Rest shows a dim `"rest"`.
4. **Meta row** (always present, `height 16`, `margin-top 10`): the **adaptation line** when adapted — `swap icon + "WAS {ORIGINAL}"`, `10px / 800 / ls .6`, color `#ffce8a`. Empty (but space reserved) when not adapted. Skipped shows `"SKIPPED"` here instead.

## States
| State | Trigger (`seed.week[i]`) | Treatment |
|---|---|---|
| **Planned** | default | base card |
| **Today** | `d.today` | darker fill `rgba(4,16,18,.66)`, brighter border, soft shadow, orange day label |
| **Done** | `d.done` | green check glyph top-right |
| **Adapted** | `d.adaptation.wasAdapted && original !== current` | amber `WAS {ORIGINAL}` meta line + swap icon |
| **+ Strength** | `d.strengthSuggested` | dumbbell glyph top-right |
| **Adapted + strength** | both | dumbbell + (done) glyphs top-right, amber meta line bottom — still one row each, height unchanged |
| **Rest** | `d.type === 'rest'` | dimmer fill, "Rest" + dim "rest", no effort dot |
| **Skipped** | `d.skipped` | `grayscale(.85)` + `opacity .5`, name strike-through, `SKIPPED` meta |

**Suppression rule (important):** only render the adaptation line when the original label actually differs from the current one. The current strip shows `Easy · WAS EASY` (a no-op) — that must be hidden. Use a real downgrade like `Easy · WAS THRESHOLD`.

## Tokens
- **Effort palette** (the name dot): recovery `#27B4E0` · easy `#14C08C` · long `#F3AD38` · tempo/threshold `#FF8847` · intervals `#FC4D64` · rest `#8A90A0`.
- **Adaptation amber**: `#ffce8a` on `rgba(243,173,56,.16)`.
- **Done green**: `#62e08a` on `rgba(62,189,65,.18)`.
- **Today accent**: `#FF8847`.
- Type: Oswald is not used on the card; **Inter** throughout (name 19/700, day 11/800, metrics 12.5/600). Numbers stay Inter here (small).
- Icons are inline SVG: check `M20 6L9 17l-5-5`; dumbbell `M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11`; swap/refresh `M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5`.

## Layout
- 7-column grid, `gap 12`. On the real Today view it spans the content width (~1180–1480px → cards ~150–200px each). The name should fit at that width; if a name is very long ("Cruise Intervals") allow it to wrap or ellipsize within the 19px line — do not let it push the card taller.

## Doctrine
No em dashes (use `·`). Dark-first, white text, color from the effort dots + amber adaptation accent, not background blocks.

## Files
- `Faff Week Strip (Direction A).html` — the approved card, a mixed-state week row, a legend, and an isolated state gallery.
- For reference, the exploration with both directions: `designs/Week Strip States.html` (in the prototype project).
- Web source to modify: `web-v2/components/faff-app/views/TodayView.tsx` (the day chip / This Week strip).
