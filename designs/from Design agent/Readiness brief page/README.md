# Handoff: Full Readiness Brief · iPhone surface

## Overview
The iPhone surface for the full `ReadinessBriefSeed` envelope — the destination the **Today redesign's readiness panel taps into** ("tap for the full read", currently stubbed). It's the mobile counterpart of the web `ReadinessBriefPanel`, re-skinned for iPhone as a **full-height sheet pushed up from Today**, rendered on the same **time-of-day mesh** the Today screen uses.

It answers "how's my body today, and is the trend something to watch?" — a reading, not an instruction.

## About the design files
`Faff Readiness Brief (iPhone).html` is a **design reference** (working HTML/JS prototype), not production code. Rebuild it in SwiftUI against the existing iPhone primitives (`Theme.swift`, `Font.display`=Oswald for numbers, `Font.body`=Inter, the toolkit components). `readiness/readiness-data.js` holds five `ReadinessBriefSeed` fixtures used by both this and the web surface — use them as decode/test fixtures.

## Fidelity
**High-fidelity.** Match layout, type, the mesh treatment, and interactions. Exact values below.

## Placement & chrome
- **Full-height sheet** over Today (not a route/tab). The parent Today screen peeks ~64px at the top.
- Sheet: `rgba(8,11,15,.6)` + `backdrop-filter: blur(28px) saturate(125%)`, `border-radius 30 30 0 0`, top hairline border. The **time-of-day mesh shows through** the blur and in the top gap, so the surface inherits the parent palette (animate across hour boundaries).
- **Grabber** handle at top → **swipe-to-dismiss**. Close ✕ in the header (`READINESS · TODAY`). **Pull-to-refresh** at the top of the scroll (prototype shows a "Pull to refresh" hint).
- All text solid white; color comes from the mesh + the band/pillar accents. Dark-first.

## Content order (top → bottom)
Sections separated by `margin-top:26px`; labels (`.cl`) `10.5px / 700 / ls 2 / uppercase / opacity .48`, `margin-bottom 13px`.

1. **Subjective override** (only when `subjectiveOverride != null`) — renders first and loud: amber→red gradient card, pulsing dot + `SUBJECTIVE OVERRIDE`, the two numbers (HOW YOU FEEL vs THE NUMBERS, the latter dimmed), and `advice`. Currently the slot is always null; render only when populated.
2. **Hero** — compact ring (92px, **number only**, arc colored by band) + `READINESS · <LABEL>` eyebrow (label in band color) + `headline` (Inter 700, ~19px, descriptive) + `oneLineMover` (hidden when null).
3. **14-day trend — the lead element.** Band-colored **bar chart** (height 96px): one bar per `scoreTrend` entry, score domain clamped 35–95 → 14–100% height, each bar colored by that day's band, past bars `opacity .5`, **today** full + glow. Date axis `<firstDate> → TODAY`. `trendNote` below.
4. **Streaks** (hidden when empty) — compact tappable banners: pillar + `↓ N days below` / `↑ N days above` (red/green) + chevron; a one-line `short` takeaway by default; tap reveals the full `meaning` under a divider. (`short` is a compact summary — derive client-side if the envelope only carries `meaning`.)
5. **What's driving it** — label row + right caption `weighted contribution`. Five **tap-to-expand pillar rows**:
   - Collapsed: band dot (pillar band color) · label · **center-anchored contribution bar** (right=green for +, left=amber/red for −, width ∝ |contribution|) · `observedValue` over `baseline` (state both, no derived deltas) · signed `weightContribution` (contribution-colored) · chevron.
   - Expanded: `meaning`, then a **14-day history bar chart** (caption `14-day history · today <value>`, today's bar in the pillar color, axis `14 days ago → today`), then **confounders** — `likely=true` first under "Most likely behind it" (pillar in amber), the rest under "Also worth checking".
   - **No research citations** anywhere (the contract carries `citation`; product decision is to not surface it).
   - A pillar with `band === 'no-data'` renders muted: grey dot, no bar, `·` value (baseline still shown), `—` contribution, not expandable.
   - Composition line below: `BASELINE x · NET ±y · TODAY z` (NET by sign, TODAY by band). Signed score points are allowed (that's the math, not a raw-metric delta).
6. **Watch tomorrow** (hidden when empty) — glass card, one row per `watchTomorrow` string with an amber dot.

## Special state: cold start (`band === 'no-data'` / `coldStart`)
Replaces the body: progress ring `nightsLogged / nightsNeeded`, "Building your baseline.", the `note` copy, "N more nights to your first score", and a "Connect Apple Health to skip the wait" CTA.

## Contribution / band colors
- **Band** (ring, trend bars, label): `sharp #34D058 · ready #3EBD41 · moderate #F3AD38 · pull-back #FC4D64 · no-data #8A90A0`.
- **Pillar band** (dot, history "today" bar): `good #3EBD41 · ok #8A90A0 · watch #F3AD38 · low #FC4D64`.
- **Contribution** (bar fill + signed pts): `≤ -8 #FC4D64 · < 0 #FFB24D · > 0 #3EBD41 · 0 #8A90A0`.

## Time-of-day mesh (shared with Today)
4 palettes `[c1..c5,cbg]` tweened via `@property` colors (transition ~1.1s): **morning** teal-green→amber, **afternoon** sky/teal, **evening** sunset, **night** indigo. Inherit the parent Today screen's current palette; if open across an hour boundary, transition. (Prototype has morning/afternoon/evening/night + state switchers below the phone for review — neither ships.)

## Interactions
- Swipe-down / ✕ → dismiss. Pull-to-refresh → reload the brief.
- Tap a pillar row → expand/collapse its detail.
- Tap a streak → expand/collapse the full meaning.
- Opened from the Today readiness panel tap target (wire the stub to present this sheet).

## Doctrine (locked)
No prescription on this surface · state both numbers, no derived deltas on raw metrics · subjective beats objective when it fires · no false precision · no em dashes · dark-first.

## Files
- `Faff Readiness Brief (iPhone).html` — the prototype (state + time-of-day switchers below the phone are review-only).
- `readiness/readiness-data.js` — five `ReadinessBriefSeed` fixtures (`sharp`, `pullback`, `override`, `partial`, `cold`).
- Web reference (in project): `designs/Readiness Brief.html`. Today redesign (the entry point): `design_handoff_today_redesign/`.
