
# Handoff: Readiness Brief panel

## Overview
The **Readiness Brief** is the slide-out panel that opens from the "Readiness" score on the Faff Today view. It is a daily **autonomic + sleep-state readout** the runner can inspect each morning and watch trend over weeks. It replaces the old, shallow drawer (a score ring + five delta rows + a 7-day bar trend) with a richer surface that consumes the new backend `ReadinessBriefSeed` envelope.

It is a **reading, not an order.** It describes state; it never prescribes training. (The one exception is the explicitly-labelled `COACH` block, which is coach voice.)

## About the design files
The files in this bundle are **design references created in HTML/React** — a working prototype showing the intended look, hierarchy, and interactions. They are **not production code to copy directly.** The task is to **recreate this panel in the Faff codebase** (the real app is a Next.js / React + TypeScript web app — see `web-v2/components/faff-app/`) using its existing components, tokens, and patterns. The prototype uses inline Babel + a standalone Tweaks panel purely so it runs as a single static file; none of that scaffolding ships.

The panel renders from the backend contract `ReadinessBriefSeed`, already defined in `web-v2/components/faff-app/types.ts` and wired as `seed.readinessBrief`. **`readiness-brief-backend-landed.md` (included in this bundle) is the authority** on every field, what is null when, and the doctrine guardrails. Read it first.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, layout, and interactions. Recreate the UI to match, using the codebase's existing primitives where they exist (the app already has a drawer/scrim, the score ring, the mesh background, and Oswald/Inter type). Exact values are documented under **Design tokens** below.

---

## The surface

A right-side **slide-out drawer** over a dimmed scrim, opened from the Readiness score on the Today view. It does **not** become a separate route — it stays a drawer, just deeper and scrollable.

- Drawer width **392px**, full height, pinned right.
- Background `rgba(15,18,23,.86)` with `backdrop-filter: blur(26px)`, `border-left: 1px solid rgba(255,255,255,.08)`.
- Slides in via `transform: translateX(102% → 0)`, `.42s cubic-bezier(.4,0,.1,1)`.
- Scrim `rgba(8,10,14,.55)` over the page; behind it the Today view's animated ember **mesh** is visible (existing component).
- A fixed **header** (`READINESS · TODAY` + close ✕) and a **scrollable body** below it.

> The prototype includes a bottom **state switcher** (Sharp / Pull-back / Subj. override / Cold start) and a **Tweaks panel** — both are prototype-only tools for reviewing states and layout variants. **Neither ships.** The shipping layout corresponds to Tweaks defaults: `lead = trend`, `pillar detail = tap`, `confounders = auto`.

---

## Body sections (top → bottom)

Render order, all inside the scroll area. Sections are separated by `margin-top: 26px`. Section labels (`.dcl`) are `11px / 600 / letter-spacing 2px / opacity .45`, uppercase, with `margin-bottom: 13px`.

### 1. Subjective override callout — *only when `subjectiveOverride != null`*
Renders **first and loud**, above everything. Per Saw et al. doctrine, subjective beats objective when they disagree by ≥15 pts.
- Card: `border-radius 15px; padding 18px; background linear-gradient(150deg, rgba(243,173,56,.18), rgba(252,77,100,.12)); border 1px solid rgba(243,173,56,.42); box-shadow 0 0 40px -18px rgba(243,173,56,.5)`.
- Tag row: pulsing dot (`@keyframes` expanding box-shadow) + `SUBJECTIVE OVERRIDE` in `--goal`, `10px / 700 / ls 1.4px`.
- Two numbers side by side: `subjectiveScore` ("HOW YOU FEEL") vs `objectiveScore` ("THE NUMBERS", dimmed to .42), each Oswald `38px / 600`, with a small italic "vs" between.
- `advice` paragraph below, `13.5px / 1.5`.

### 2. Hero
- `.hero{margin-top:7px}`. Row (`.hero-top`, `align-items:center; gap:20px`):
  - **Score ring**, 84px. SVG: track circle `rgba(255,255,255,.14)` strokeWidth 6; progress circle stroke = **band color**, strokeWidth 6, round cap, `stroke-dasharray 220`, `dashoffset = 220 - 220*(score/100)`, rotated -90°. Center: score number only, Oswald `34px / 600` (**no band label inside the ring** — removed intentionally).
  - **Words** (`.hero-words`, flex column, gap 9px, `min-width:0`):
    - `label` — band label **eyebrow** above the headline (e.g. `READY`, `PULL BACK`), colored by band, `10px / 700 / ls 2px`, uppercase. (Surfaces the band word without crowding the ring, which holds the number only.)
    - `headline` — **Inter 600, 16.5px, line-height 1.42** (do NOT use Oswald here; condensed multi-line wrapping caused layout bugs). This is the lead element of the panel.
    - `oneLineMover` — `12px / 500 / opacity .6`. **Hidden when null.**

### 3. 14-day score trend
- Label `14-DAY TREND`.
- **Bar chart** (`.rt-bars`, flex, `align-items:flex-end`, gap 4px, height 60px; the prototype's `lead=number` variant drops it to a shorter form). One bar per `scoreTrend` entry.
  - Bar height: domain clamped **35–95**, mapped to `18%–100%` (formula `14 + ((clamp(s)-35)/60)*86`).
  - Bar color = **that day's band color**; past bars at `opacity .5`, **today's bar** at full opacity + `box-shadow 0 0 9px -1px currentColor`.
  - `border-radius: 2px 2px 0 0`.
- **Date axis** below (`.rt-axis`, flex space-between, `9.5px / 600 / opacity .42`, uppercase): left = formatted first date (e.g. `MAY 18`), right = `TODAY`. This axis was added specifically so the time range is unambiguous.
- `trendNote` paragraph below (`12.5px / opacity .78`). Hidden when null.

### 4. Streak banners — *one per entry in `streaks` (hidden when empty)*
Compact, **tap to expand**. Tile (`.streak`): `border-radius 13px; padding 13px 15px; margin-bottom 10px`. Down streaks tint red (`bg rgba(252,77,100,.09)`, `border rgba(252,77,100,.28)`); up streaks tint green (`rgba(62,189,65,.09 / .26)`).
- Header row: pillar key (`10.5px / 700 / ls 1.2px`) + direction badge (`↓ 4 days below` / `↑ N days above`, colored `--over` / `--green`, `11px / 700`) + a chevron pushed right (`margin-left:auto`, rotates 180° when open).
- **`short`** one-liner shown by default (`13px / 500 / 1.45`).
- **`meaning`** (full text) revealed on tap, below a `1px` top divider, `12.5px / opacity .72`.

**Special: a single pillar with `band === 'no-data'`** (e.g. HRV not synced today): the row renders muted — grey dot, no contribution bar, `observedValue` = `·`, baseline still shown, contribution `—`, not expandable. Other pillars render normally. (The prototype's "Partial" state demonstrates this.)

### 5. What's driving it — the 5 pillars
- Label row (`.dcl-row`, flex space-between): `WHAT'S DRIVING IT` + right caption `weighted contribution` (`10px / 500 / opacity .32`, lowercase).
- Pillar list (`.pils`, flex column, gap 3px). Each pillar is a **tap-to-expand row** (`pillar detail = tap`; an `inline` variant exists that auto-opens all).

**Collapsed row** (`.pil-row`, flex, `gap 10px; padding 9px 8px`):
- Band dot, 7px, color = **pillar band color** (`good #3EBD41 / ok #8A90A0 / watch #F3AD38 / low #FC4D64`).
- `label` (e.g. `SLEEP`), 46px wide, `10.5px / 700 / opacity .78`.
- **Contribution bar** (`.pil-bar`, flex:1, height 7px, track `rgba(255,255,255,.08)`): a center axis line at 50%; the fill `i` extends **right for positive** / **left for negative** `weightContribution`, width `min(46, |c|*3.2 + 4)%`, colored by **contribution color** (`≤-8 #FC4D64 / <0 #FFB24D / >0 #3EBD41 / 0 #8A90A0`).
- Value cell (right aligned, 88px): `observedValue` bold (`12px`) over `baseline` (`9.5px / opacity .45`). **State both numbers — never a derived delta** (show "6.1h" + "target 7.5h", not "−1.4h short").
- Signed `weightContribution` number (`12px / 700`, contribution color).
- Chevron (rotates when open).

**Expanded detail** (`.pil-detail`, `padding 4px 14px 16px`):
- Sub line: `observedValue · observedSub · baseline` (`11px / 600 / opacity .6`).
- `meaning` paragraph (`13px / 1.5 / opacity .9`).
- **14-day history bar chart** (`.hist`):
  - Caption row (`.hist-cap`): `14-DAY HISTORY` left, `today <observedValue>` right (`9.5px / 700 / ls 1px / opacity .4`, value emphasized).
  - Bars (`.bars`, height 46px, gap 3px): one per `trend` point; height domain = data min/max with 25% padding mapped to `18%–100%`; past bars `rgba(255,255,255,.16)`, **today's bar** = pillar band color + glow.
  - Axis (`.bars-axis`): `14 days ago` ··· `today` (`9px / opacity .38`, uppercase).
  - When `trend` is empty: show italic "No history yet · fills in after a few syncs" instead.
- **Confounders** — surfaced per `confounders = auto`:
  - `likely === true` ones first under heading **MOST LIKELY BEHIND IT**, pillar name in `--goal`.
  - The rest under **ALSO WORTH CHECKING**, neutral.
  - Each: pillar name (64px, `600 / opacity .75`) + explanation (`opacity .62`), `12px`.
  - `auto` rule: a pillar with band `low` auto-expands when the overall band is `pull-back`/`moderate`; likely-confounders also "peek" on collapsed rows. (`collapsed` and `likely` variants exist but `auto` ships.)
- **No research citations anywhere.** (The contract carries a `citation` per pillar; per an explicit product decision it is **not rendered** on this panel. Do not surface it.)

### 6. Composition line — *when `composition != null`*
`.dbaseline`, `11.5px / 700 / opacity .62 / ls .6px`, uppercase:
`BASELINE 53 · NET −11 · TODAY 42` — NET colored by sign (contribution color), TODAY colored by band. These signed score-contribution points are "the math" and are allowed (the no-derived-delta rule applies to **raw physiological metrics**, not to score composition).

### 7. Watch tomorrow — *hidden when `watchTomorrow` empty*
Label `WATCH TOMORROW` + card (`.watch`, `bg rgba(255,255,255,.04); border 1px solid --line; border-radius 13px`). One `.wrow` per string: a small `--goal` dot + text (`13px / 1.5`), rows divided by `1px rgba(255,255,255,.06)`.

### 8. Morning check-in — *only when `subjectiveCheckin.answered === false`*
Card prompting "How do you feel this morning?" with a 2/4/6/8/10 button scale (Oswald `16px`) and a note: "when your read disagrees with the numbers, yours wins." (Posts a 1–10 wellness rating; the override slot in the contract consumes it. The input UI itself is new — see backend doc open-question #6.)

> **No COACH block.** The panel is a **diagnostic instrument only** — it never prescribes. Coach voice (imperatives, "ease the load", plan downgrades) lives on other surfaces (coach intents, plan proposals, the planned workout). An earlier draft had a COACH line here; it was removed to honor the no-prescription doctrine. The band-aware `headline` carries the framing.

### 9. View full health link
`.dlink` at the bottom: "View full health" + arrow icon, `13px / 500 / opacity .7`.

---

## Special state: cold start — *`band === 'no-data'` / `coldStart != null`*
Replaces the whole body with an encouraging empty state (the rest of the sections do not render):
- Muted grey mesh (the `.win[data-band="no-data"]` palette).
- Progress ring (120px) showing `nightsLogged` / `nightsNeeded` (grey stroke), center `2` over small `of 7`.
- Heading "Building your baseline." (**Inter 700, 23px** — not Oswald), `coldStart.note` copy, and a `N MORE NIGHTS TO YOUR FIRST READINESS SCORE` line.
- "Connect Apple Health to skip the wait" link.

---

## Interactions & behavior
- **Open/close**: drawer slides from the right over the scrim; ✕ or scrim tap closes.
- **Pillar rows**: tap toggles the detail panel (chevron rotates 180°). In `auto` mode, low-band pillars start expanded when the day is pull-back/moderate.
- **Streak banners**: tap toggles full `meaning` under a divider.
- **Mesh**: the background palette shifts with band (`data-band` on the window) — ember/red for pull-back, warm for ready/sharp, grey for no-data. Transition the mesh, don't hard-cut.
- **Empty/partial data**: every chunk degrades gracefully — hide `oneLineMover`, `streaks`, `movers`, `watchTomorrow`, the composition line, and per-pillar sparklines independently when their data is absent. Never fabricate. (See the null-table in the backend doc.)

## Doctrine guardrails (non-negotiable — from the backend doc)
1. **No prescription on the panel.** The reading describes; the `COACH` block is the only place actions live.
2. **State both numbers, no derived deltas** on raw metrics ("7.2h" + "target 7.5h").
3. **Subjective beats objective** — the override block is loud when it fires.
4. **No false precision** — directional language, no ± medical qualifiers.
5. Lead with the band-aware **headline + trend**, not the spot number.

## State management
- Input: `seed.readinessBrief: ReadinessBriefSeed | null` (null → render cold-start empty state).
- Local UI state only: drawer open/closed; per-pillar expanded set; per-streak expanded set; (if shipping the check-in) the selected 1–10 value.
- No client fetching beyond the seed; the nightly cron + `loadReadinessBrief(userId, state)` produce the envelope.

## Design tokens

**Core**
- `--bg #0A0C10` · `--line rgba(255,255,255,.08)` · `--txt #F6F7F8` · `--mute #8A90A0` · `--dim #4B505E`
- `--green #3EBD41` · `--goal #F3AD38` · `--over #FC4D64` · `--dist #27B4E0` · `--race #FF8847`

**Band colors** (ring, score-trend bars): `sharp #34D058` · `ready #3EBD41` · `moderate #F3AD38` · `pull-back #FC4D64` · `no-data #8A90A0`

**Pillar band colors** (dot, history "today" bar): `good #3EBD41` · `ok #8A90A0` · `watch #F3AD38` · `low #FC4D64`

**Contribution color** (bar fill + signed pts): `≤ -8 → #FC4D64` · `< 0 → #FFB24D` · `> 0 → #3EBD41` · `0 → #8A90A0`

**Typography**
- **Inter** (400/500/600/700) — body, section labels, headline, cold-start heading.
- **Oswald** (600) — score number, override numbers, check-in scale. Use Oswald ONLY for single-line numeric/display; it mis-wraps multi-line.
- Anton — brand logo only; not used in this panel.

**Spacing / shape**
- Drawer padding: header `26px 26px 14px`; body `0 26px 30px`.
- Section gap `26px`; section-label bottom `13px`.
- Radii: cards/banners `13–15px`, pill rows `11px`, bars `2px` top corners.
- Drawer blur `26px`; scrim `rgba(8,10,14,.55)`.

## Assets
None external. Icons are inline SVG (chevron `M6 9l6 6 6-6`, arrow `M5 12h14M13 6l6 6-6 6`, close `M18 6L6 18M6 6l12 12`). Charts are CSS/flex bars + an SVG ring — no chart library required. The ember mesh is the app's existing animated-blob background.

## Files in this bundle
- `Readiness Brief.html` — runnable prototype shell (mesh, scrim, drawer, state switcher, Tweaks mount). Open in a browser to interact.
- `readiness/readiness-app.jsx` — the React render: drawer, hero, `ScoreTrend` (bars), `Bars` (pillar history), `Pillar`, `Streaks`/`StreakRow`, `Override`, `Brief`, plus the prototype-only `App` shell + Tweaks wiring.
- `readiness/readiness-data.js` — five fully-populated sample envelopes (`sharp`, `pullback`, `override`, `partial`, `cold`) matching `ReadinessBriefSeed`. Use as fixtures.
- `readiness/tweaks-panel.jsx` — prototype-only Tweaks shell (does not ship).
- `readiness-brief-backend-landed.md` — **the backend contract + doctrine. Source of truth.**

In the main project, the corresponding live files are `Faff Web App.html` (original drawer) and the `designs/Readiness Brief.html` prototype this bundle was cut from.

