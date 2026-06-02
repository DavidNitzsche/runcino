# Handoff: Run Detail · Intervals (completed)

## Overview
A completed-run detail surface for an **interval workout** in the Faff running app. It is the post-run view a runner sees after finishing a structured session. The defining feature is the right-hand **plan-vs-result** panel ("THE REPS"): instead of generic per-mile splits (which are meaningless for intervals), it shows each prescribed work rep measured against its target pace, plus the warm-up, recoveries, and cool-down.

This document describes one screen (the intervals run-detail). It is themed in the app's **intervals accent (coral/red)**; the same layout is used for other run types with a different accent + right-panel content.

## About the Design Files
The file in this bundle (`Faff Run Detail (Intervals).html`) is a **design reference created in HTML** — a prototype showing the intended look and behavior. It is **not** production code to copy directly.

The task is to **recreate this design in the target codebase's existing environment** (the Faff web app is React/TSX per the project's other handoffs — e.g. `TodayView.tsx`, `WorkoutDetail.tsx`), using its established components, tokens, and patterns. If no environment exists yet, choose the most appropriate framework and implement there. Treat the HTML/CSS as a precise spec for measurements, color, type, and behavior — not as the deliverable.

`image-slot.js` is a prototype-only helper that renders the drag-and-drop map placeholder; in production the map area is a real route-map component (polyline render of the activity), not this placeholder.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, and the plan-vs-result visualization are all specified below. Recreate pixel-faithfully using the codebase's existing libraries. The only intentionally-stubbed element is the center map (drop slot in the prototype → real route map in production).

---

## Screen: Run Detail · Intervals

### Purpose
Show the runner how a completed structured-interval session went: headline stats, heart-rate zone distribution, running-form metrics, route map, and — the focus — how each work rep compared to its target pace ("plan vs result").

### Page layout
- Root fills the viewport. Content is centered in a **max-width 1480px** container with padding `30px 40px 44px`, laid out as a vertical flex column.
- Top to bottom: **quality-session counter** → **week strip** → **hero** (the main 3-column body, `flex:1`).
- Background is an animated **coral/red mesh** (5 blurred blobs, 48–58px blur, slow drift) over base `#8a1733`, plus a faint noise grain overlay (`opacity .05`, `mix-blend overlay`) and a top/bottom vignette.

### Hero — three columns
A flex row, `gap: 26px`, `align-items: stretch` (so all three columns are equal height and **their tops line up**):

| Column | Width | Contents |
|---|---|---|
| **Left** (`.hmain`) | `flex: 0 0 400px` | eyebrow, title + check, stats, zones, running form, conditions |
| **Center** (`.mapcol`) | `flex: 1` | route map (fills full column height) |
| **Right** (`.wcard`) | `flex: 0 0 372px` | "HOW IT WENT" plan-vs-result card |

The left column is a vertical flex; its inner stack is `flex:1` and the **conditions block is pushed to the bottom** with `margin-top:auto`, so the bottom of the left column bottoms out level with the map and card.

---

### LEFT COLUMN

**Quality counter** (above the hero, top of page)
- Small heartbeat/activity icon (15px) + text `1/1 QUALITY THIS WEEK`.
- `11px / 700 / letter-spacing 2px`, color `rgba(255,255,255,.72)`.

**Eyebrow** (`.htag`)
- Text: `TODAY · INTERVALS · DONE`
- `12px / 700 / letter-spacing 3px`, `opacity .95`.

**Title row** (`.titlerow`, `white-space:nowrap`)
- Title `INTERVALS`: Oswald, `60px / 600`, uppercase, `line-height .9`, subtle text-shadow `0 2px 20px rgba(0,0,0,.16)`.
- Inline **check badge** immediately after the title: 32px circle, background `#3ED06a` (success green), dark check glyph `#06210a`, `box-shadow 0 4px 14px -4px rgba(62,208,106,.7)`, `vertical-align: middle`, `margin: 0 0 6px 18px`.
- NOTE: the check is laid out as an **inline** element after the title (not a flex sibling) so it always follows the title's actual rendered width across fonts. Keep this behavior to avoid overlap during font load.

**Stats** (`.stats`, flex row, `gap 34px`) — three stats, each = big Oswald value + small unit + uppercase key beneath:
- `7.5 mi` — DISTANCE
- `60:25` — TIME
- `8:09 /mi` — AVG PACE
- Value: Oswald `36px / 600 / line-height .9`, `white-space:nowrap`. Unit `small`: `14px`, `opacity .85`. Key: `10.5px / 700 / ls 1.2px`, `opacity .78`, `margin-top 8px`.

**Time in zones** (`.zones`, `margin-top 30px`)
- Header row: left `TIME IN ZONES` (`11px/700`), right `avg ♥ 155 · pk 177` (the two numbers bold/white).
- Bar: 13px tall, radius 7px, track `rgba(255,255,255,.08)`, filled with one `<i>` per non-zero zone, width = % , colored by zone.
- Legend below: one item per zone `[swatch] Zn NN%`, `10px/600`, zero-value zones dimmed to `opacity .4`.
- Zone values: **Z1 14% · Z2 0% · Z3 29% · Z4 43% · Z5 14%**.
- Zone colors: `--z1 #54ddd0`, `--z2 #8ef0b0`, `--z3 #ffe0a0`, `--z4 #ff9560`, `--z5 #ff5a52`.

**Running form** (`.form`, `margin-top 30px`)
- Label `RUNNING FORM` (`11px/700`, `margin-bottom 14px`).
- 2-column grid (`grid-template-columns: 1fr 1fr`, `gap 16px 22px`), six metrics, each = tiny uppercase key (`9.5px/700/ls 1px`, `opacity .55`) + value (Oswald `19px/600`) + small unit (Inter `10px/500`, `opacity .6`):
  - CADENCE `182 spm`
  - RUN POWER `312 W`
  - STRIDE `1.18 m`
  - VERT OSC `8.4 cm`
  - GROUND CONTACT `244 ms`
  - L/R BALANCE `50 / 50`

**Conditions** (`.cond`, pinned to bottom via `margin-top:auto`, `padding-top 30px`)
- 2-column grid (`gap 18px 22px`), each = key (`9.5px/700/ls 1px`, `opacity .55`) + value (`14px/700`):
  - WEATHER `61° · Clear`
  - SHOE — a dashed-underline `<select>` (shoe picker), default `New Balance SC Trainer v3`. Options: Vaporfly 3, Zoom Fly 6, Superblast 3, Ghost 16.
  - ELEV GAIN `543 ft`
  - CALORIES `974 kcal`

---

### CENTER COLUMN — Route map
- Fills the full column height, radius 16px, border `1px rgba(255,255,255,.12)`, `box-shadow 0 18px 40px -22px rgba(0,0,0,.6)`.
- In the prototype this is a drop-slot placeholder; **in production, render the actual route polyline** for the activity. There is intentionally **no caption row** beneath the map (distance/elevation already live in the stats).

---

### RIGHT COLUMN — "HOW IT WENT" card (`.wcard`)
Glass card: background `rgba(20,6,12,.40)`, `backdrop-filter blur(13px)`, border `1px rgba(255,255,255,.14)`, radius 16px, padding `25px 25px 22px`, vertical flex.

**Header** (`.wcl`, space-between)
- Left: `HOW IT WENT` (`11px/700/ls 2px`, `rgba(255,255,255,.55)`).
- Right: `✓ ON PLAN` badge, color `#8af0a6`, 13px check icon.

**Verdict** — `Reps done.` — Oswald `30px/600`, `margin-top 15px`.

**Recap** — `13.5px/500/line-height 1.55`, `rgba(255,255,255,.88)`:
> "Four 1-mile reps at 6:30 goal. Pushed every work bout to target or quicker, jogged the recoveries honest."

**Divider** — 1px `rgba(255,255,255,.12)`, `margin-top 20px`.

**Reps header** (`.repshead`, space-between, `margin 18px 0 4px`)
- Left `THE REPS` (Oswald `15px/600`).
- Right `TARGET 6:30/mi` — `10px/700` label with the `6:30` bold/white in Oswald 13px.

**The rail** (`.rail`) — the plan-vs-result list. Three row types, top to bottom:

1. **Phase rows** (warm-up, cool-down) — `.phase`:
   - teal dot (`#54ddd0`, 8px) + name (`11px/700/ls 1px`, `rgba(255,255,255,.72)`) + ` · 1.5 mi` dim sub + right-aligned pace (Oswald `14px`, `rgba(255,255,255,.8)`) with small `/mi`.
   - WARM-UP · 1.5 mi → `9:48/mi`
   - COOL-DOWN · 1.0 mi → `9:40/mi`

2. **Work rep rows** — `.rep`, a 3-col grid `46px / 1fr / 70px`, `align-items center`, `padding 9px 0`:
   - **Col 1:** rep number (Oswald `16px/600`) stacked over `REP` (`8.5px/700/ls .6px`, `opacity .5`).
   - **Col 2:** the comparison bar (`.rtrk`) — 11px tall, radius 6px, track `rgba(255,255,255,.1)`:
     - **Fill** (`.rfill`) anchored left, width = `pct(actualSeconds)` (see formula), colored **green `#3ED06a` if the rep beat/met goal, amber `#ffb24d` if slower**.
     - **Target tick** (`.rtick`) — a 2px white vertical line at `40%` (the 6:30 position), drawn on top, `z-index 2`, extends 3px above/below the track.
   - **Col 3** (right-aligned): actual pace (Oswald `16px/600`) over a delta (`10px/700`) colored green (beat) or amber (missed).
   - Reps: **1 → 6:28 (−2)** · **2 → 6:22 (−8)** · **3 → 6:35 (+5, amber)** · **4 → 6:18 (−12)**.

3. **Recovery connector rows** — `.rec`, between reps:
   - dashed left border `1.5px rgba(255,255,255,.18)`, indented (`margin-left 14px`, `padding-left 8px`), small text `9.5px/600`, `rgba(255,255,255,.42)`.
   - `3:02 jog · recovery`, `3:00 jog · recovery`, `2:58 jog · recovery`.

**Rep summary** (`.repsum`, space-between, top border `1px rgba(255,255,255,.1)`, `margin-top 16px`, `padding-top 14px`)
- Left `AVG WORK PACE` (`10px/700/ls 1px`, `rgba(255,255,255,.55)`).
- Right: Oswald `17px/600` `6:26/mi` + green delta `−4 vs goal` (`12px`, `#3ED06a`).

---

## The plan-vs-result bar (core logic)
Each work rep's bar visualizes actual pace against the target on a fixed pace window. Faster = longer fill. The white tick marks the target; a fill that passes the tick = beat goal.

```
GOAL = 390            // target 6:30/mi, in seconds
LO   = 360            // fast end of window (6:00) → ~98% fill
HI   = 410            // slow end of window (6:50) → ~4% fill

pct(sec)  = clamp( (HI - sec) / (HI - LO) * 100, 4, 98 )   // fill width %
TICK      = (HI - GOAL) / (HI - LO) * 100                  // = 40% (target marker)
beatGoal  = sec <= GOAL                                    // green if true, else amber
```
Rep actuals (seconds): 1 = 388 (6:28), 2 = 382 (6:22), 3 = 395 (6:35), 4 = 378 (6:18).
Deltas are `actual − goal` in seconds, shown signed (negative = faster = good).

Generalize for production: derive `GOAL` from the prescribed rep target; `LO`/`HI` can be `GOAL ∓ 30s` or scaled to the session's spread.

---

## Interactions & behavior
The prototype is largely static (a detail view). For production:
- **Week strip** day cards → navigate to that day's run/detail. The "today/selected" card is highlighted (brighter bg + border); past days show a green check; future days are dimmed (`opacity .58`).
- **Shoe `<select>`** → changing it reassigns the shoe for this activity (PATCH the run's `shoe_id`).
- **Map** → tap to expand full-screen (per other Faff handoffs).
- **Mesh blobs** animate with slow drift/breathe keyframes; gate behind `prefers-reduced-motion` if you port the animation.
- No loading/error/empty states are designed here; add per codebase conventions.

## State / data model (suggested)
The screen renders from a completed-activity record plus the prescribed workout:
- **Run summary:** `distance_mi`, `duration`, `avg_pace`, `avg_hr`, `peak_hr`, `elev_gain_ft`, `calories_kcal`, `weather`, `shoe_id` + `shoes[]`.
- **Zones:** `zones[] = [{ z, pct }]` (Z1–Z5) with avg/peak HR.
- **Form:** `cadence_spm`, `run_power_w`, `stride_m`, `vertical_osc_cm`, `ground_contact_ms`, `lr_balance` (render only fields present).
- **Plan vs result:** the prescribed structure (`warmup`, `reps[] = { target_pace, distance }`, `recoveries[]`, `cooldown`) joined with measured per-rep actuals. Compute fill %, tick, and delta with the formula above.
- **Verdict / recap / on-plan flag:** from the coach/analysis engine ("on plan" when reps met target within tolerance).
- **Week strip:** 7 days `{ dow, date, type, accent, meta, done, isToday }`.

## Design tokens
**Type:** `Oswald` (display: titles, stat values, paces) · `Inter` (body, labels, units).

**Colors**
| Token | Value | Use |
|---|---|---|
| text | `#F6F7F8` | primary text |
| mute | `#8A90A0` | (rest-day dot) |
| success green | `#3ED06a` | check badge, beat-goal bars/deltas |
| on-plan badge | `#8af0a6` | "ON PLAN" text |
| warn amber | `#ffb24d` | missed-goal bars/deltas |
| mesh base | `#8a1733` | background |
| mesh blobs | `#ff8d7a`, `#ff9f5a`, `#c5223f`, `#e23a5e`, `#a81639` | animated background |
| body base | `#5a0e22` | `<body>` behind mesh |
| glass | `rgba(20,6,12,.40)` | right card + day cards |
| glass line | `rgba(255,255,255,.14)` | card borders |
| zone 1–5 | `#54ddd0` `#8ef0b0` `#ffe0a0` `#ff9560` `#ff5a52` | HR zone bar/legend |
| run-type dots | easy `#2faf7c`, intervals `#ec3a54`, long `#F3AD38`, rest `#8A90A0` | week strip |

**Radius:** cards 16px · day cards 12–13px · bars/track 5–7px.
**Card shadow:** `0 18px 40px -22px rgba(0,0,0,.6)` (map) · day "on": `0 12px 28px -16px rgba(0,0,0,.6)`.
**Layout constants:** stage max-width 1480px · hero gap 26px · left col 400px · right card 372px · week strip gap 10px.

## Assets
- No raster/icon assets required. All icons (check, heartbeat, chevron, heart `♥`) are inline SVG or glyphs.
- The center map is a **route polyline** in production (no asset in this bundle).
- Fonts loaded from Google Fonts (Oswald, Inter) — swap to the codebase's font pipeline.

## Files
- `Faff Run Detail (Intervals).html` — the full design reference (self-contained: inline CSS + a small JS block that builds the week strip, zone bar, and rep rail from data arrays — see `WEEK`, `ZONES`, `REPS` near the bottom of the file).
- `image-slot.js` — prototype-only map drop-slot helper (not for production).
