# Handoff: Today screen redesign (iPhone)

## Overview
A redesign of the Faff **Today** tab (the iOS app's home). It keeps the week strip, leads with a **simple, graphic readiness panel** in place of the old run-summary hero, moves the **run/session detail into a slide-up sheet**, and gives the whole screen a **time-of-day background** that shifts morning → afternoon → evening → night.

It answers the morning question ("how's my body, what's the session?") at a glance, then lets the runner pull up the session detail when they want it.

## About the design file
`Faff Today Redesign.html` is a **design reference** — a working HTML/JS prototype of the intended look and behavior. It is **not production code to ship**. Recreate it in the Faff iOS app's existing environment (the live Today screen is `screens/effort.html` in this prototype project; in the real app, build with its established components, tokens, and the readiness data that already feeds the panel). The prototype is self-contained vanilla JS so it runs standalone.

This **replaces / forks the current `screens/effort.html`** Today tab. What changes vs the current screen:
- The big run-name + pace + effort-meter hero is **removed** and replaced by the readiness panel.
- The run detail (which was the slide-up sheet already) **stays a slide-up sheet**, now with a peek that summarizes the session.
- The mesh background **no longer recolors per selected run** — it recolors by **time of day** instead.

## Fidelity
**High-fidelity.** Match layout, type, spacing, the mesh treatment, and the interactions. Exact values below.

---

## Frame & layers
- Phone canvas **392 × 792**, radius 44 (prototype draws a device bezel; in-app it's the full screen).
- z-order: `.mesh` (0) · `.grain` + `.scrim` (1) · `.status` (6) · `.hero` (2) · `.sheet` (4) · `.startbar` (5) · shoe picker overlay (9).

## Time-of-day background
The signature element. An animated **mesh of 5 blurred radial blobs** over a base color, driven by 6 CSS custom props `--c1..--c5` + `--cbg` (registered via `@property` as `<color>` so they **animate/tween** on change — transition `1.1s ease`). Blobs use `filter: blur(34px)` and slow infinite drifts (`f1..f5`, 19–27s).

Four palettes `[c1,c2,c3,c4,c5,cbg]`:
- **morning** `#62e3d4 #2faf7c #ffd98a #1f8a68 #0f6a5a #0a3a2e` — teal-green → warm amber (the look the runner liked).
- **afternoon** `#8fd0ff #34b6d6 #5fd0c4 #2a86b8 #1c6f9a #0a2f44` — sky / teal-blue.
- **evening** `#ffcf8a #ff8e6a #f2673a #c0457a #7a3a86 #2a142e` — sunset orange → pink → violet.
- **night** `#7e8ad8 #5360b4 #3a4a8e #2a2f6e #181f54 #0b0e26` — deep indigo / blue.

Pick by local hour: `<5 night · <12 morning · <17 afternoon · <21 evening · else night`. Also drives the greeting ("Good morning/afternoon/evening", "Late night") and (in the prototype) a mocked clock. The prototype has a Time-of-day switcher **below the phone for review only — it does not ship.**

A `.grain` overlay (SVG noise, 5% overlay) and a top/bottom `.scrim` gradient sit above the mesh for depth and text legibility. Text is always solid white; never auto-invert (dark-first doctrine).

---

## Hero (top → bottom)

### Topbar
- Greeting eyebrow: dot + time-aware text, `11px / 800 / ls 1.4 / uppercase`, `white-space:nowrap`.
- Date `22px / 800` (e.g. "Monday 1").
- Week label `11px / 700 / opacity .66` (e.g. "Week 14 of 26").

### Week strip — **kept**
Row of 7 `.day` cells (flex, gap 5). Each: weekday letter (`.dow`), date (`.dt`), and an accent **dot** colored by that day's run type (rest = a short bar). `.today` is full-opacity; the selected day gets `.sel` (translucent white fill + border + blur). Tapping a day **swaps the session** in the sheet (readiness stays "today").

### Readiness panel — the new graphic hero (`.ready`, tappable)
- **Ring** 108px: track `rgba(255,255,255,.2)` w6.5; progress arc colored by band (`stroke-dasharray 289`, `dashoffset = 289 − 289*(score/100)`, rotate −90). **Center shows the number only** (Oswald `42px / 600`) — no label inside the ring.
- **Words**: eyebrow `READINESS` + a colored **band tag** (e.g. `MODERATE` in band color, `11px / 800 / ls 2`), then a bold headline (`24px / 800`, ~2 lines, e.g. "Sleep and HRV are dragging."). Headline is **descriptive, not prescriptive** (doctrine: no imperatives on this surface).
- **WHY strip** (`.why`): 5 rows (SLEEP, HRV, RHR, LOAD, HR REC). Each: key label (42px col, `9.5px / 800`), a **center-anchored bar** (track `rgba(255,255,255,.14)`, center axis tick; fill extends right=green for positive, left=amber/red for negative, width ~ magnitude), and the observed value right-aligned (`11px / 700`, e.g. "5.9h · 7-night", "44 ms", "47 bpm", "1.25 ACWR", "45 bpm drop"). State the value — no derived deltas.
- **Quick stats row** (`.stats`): three equal **glass stat chips** (`flex:1`, `rgba(255,255,255,.12)` + border, radius 16, blur). Each: tiny uppercase label + Oswald value. Current set: **Last night `6h 12m`**, **This week `42 mi`**, **VO₂ max `52`**. These complement the WHY pillars (e.g. last-night sleep vs the 7-night average); swap freely for other Apple Health metrics. Must fit one row, **no horizontal scroll**.

Tapping the readiness panel is the entry point to the full readiness brief (see the separate `design_handoff_readiness_brief` bundle) — wire it to push/sheet that surface. (Stub in the prototype.)

---

## Run/session slide-up sheet (`.sheet`)
Light sheet (`#faf7f1`, radius 30 top) pinned to screen bottom; `transform: translateY(COLLAPSED=498 → 0)`, spring `cubic-bezier(.32,.72,0,1)`. Drag the `.grab` handle to expand/collapse (snap logic: tap toggles, drag past 55% snaps).

- **Peek** (always visible): accent dot + run title + "Today's session" subtitle on the left; pace (Oswald) + effort label on the right. Accent color = the run's color.
- **Body**: `The Session` (segment list with accent ticks) · `Conditions & Kit` (2×2 info grid: Distance, Weather, **Shoe**, Fuel) · `Faff Coach` note.
- **Start bar**: fixed bottom button "Start <Run>" (or "Log Recovery" on rest), accent dot.

### Shoe picker
The Shoe cell in the info grid is a **picker**, not static text: it shows the shoe + a chevron and is tappable. Tapping opens a **bottom action sheet** (`.shoeov`, scrim + slide-up card) titled "Shoe for this run" listing the shoe garage (name + mileage/role), with a checkmark on the current pick (accent-colored). Selecting updates the run's shoe and closes.

---

## Data (prototype fixtures → wire to real app data)
- `TOD` — the 4 time-of-day palettes + greeting + mock clock.
- `READY` — today's readiness: score, band, band color, arc color, headline, and 5 `pillars` `{k, v, dir(-1/0/1), mag, c}`. In-app this comes from the same readiness source as the full brief.
- `RUNS` — per run-type session data (accent, effort, title, dist, pace, weather, shoe, fuel, segs, note).
- `WEEK` — 7 days `{dow, dt, full, run, today}`.
- `GARAGE` — shoe list `{n, m}` for the picker.

## Interactions
- Tap a week day → swap the session sheet (readiness unchanged).
- Drag the sheet handle → expand/collapse session detail.
- Tap the Shoe cell → shoe picker bottom sheet → select.
- Tap readiness panel → (wire to) full readiness brief.
- Background + greeting + clock auto-set from local hour on load.

## Doctrine (carried from the readiness briefs)
- **No prescription** on this surface — readiness copy is descriptive; the planned session lives in the sheet, the coach note is descriptive framing.
- **State both numbers, no derived deltas** in the WHY rows.
- **Dark-first**, solid white text, color from the mesh + weight, not background blocks.
- **No em dashes** anywhere in copy (use `·`, periods, commas).

## Files
- `Faff Today Redesign.html` — the prototype (open in a browser; use the time-of-day switcher below the phone to preview each palette).
- Current live screen for reference (in the prototype project): `screens/effort.html`.
