# Handoff: Health page redesign (web)

## Overview
A full redesign of the web **Health** page (`HealthView.tsx`). Goal: an "all-knowing" recovery dashboard that stays calm and scannable. It surfaces the readiness score + a synthesis "story," post-session recovery, aerobic-fitness trajectory, the full body/sleep/form metric set, and cross-domain insight cards, all on the dark-green health mesh.

## About the design file
`Faff Health Redesign.html` is a **design reference** (vanilla HTML/JS, data-driven render), not production code. Recreate in the app's React env, binding to the real seed (`seed.readinessBrief`, `seed.health.*`). The prototype is a wide desktop layout (1500px); open full-width.

## Fidelity
**High-fidelity.** Match layout, the bar-chart tiles, hierarchy, tokens.

## The architecture · glance → scan → drill
Everything maps to three depths so density reads as organized, not cluttered:
1. **Glance** — the hero (score + why + trend). The one focal point.
2. **Scan** — labeled metric domains as uniform bar-cards.
3. **Drill** — every tile is tap-expandable for detail (history, meaning, confounders). Build the expand as the depth valve.

## Page order (top → bottom)
1. **Header** — "HEALTH" + "Recovery & form · <date>".
2. **HERO** (`.hero`, 3-col grid `300px 1fr 300px`, stretch):
   - **Gauge** — big ring, number only, arc colored by band (`sharp #34D058 / ready #3EBD41 / moderate #F3AD38 / pull-back #FC4D64 / no-data #8A90A0`), with the band verdict sentence + `14-day baseline 58 · today 42 · −16` (honest same-scale net per the baseline-correction brief).
   - **WHAT IS DRIVING IT** — 5 pillar rows: status dot, label, observed/baseline, a **center-anchored contribution bar** (right=green +, left=amber/red −), big signed pts.
   - **Right column** stacks **AEROBIC FITNESS** (compact card: `9.2% → 6.1%` decoupling trend) on top of **7-DAY READINESS** (horizontal band-colored bar chart + `NOW · AVG`).
3. **Intelligence layer** (`.storyrow`, 2-col, **align-items:start** so cards size to content):
   - **THE STORY** (`#1 synthesis`) — coach-voice 2-3 sentence paragraph (amber left accent). Below a hairline, **STREAKS** (`#2`) render as small **bar sparklines** per pillar: the metric's recent values with a dashed baseline line, trailing below-baseline days in red + "N days below · note". (Not abstract day-cells — show the actual dip.)
   - **WATCHING TOMORROW** (teal left accent) — `watchTomorrow[]` rows (amber dot + text); below a hairline, **FORECASTS** (`#9`) as rows with a small `FORECAST` tag + predictive sentence.
4. **RECOVERY PHASE** (`#15`, `.recov-card`) — `RECOVERING FROM` anchor session + `% recovered` + day timeline + progress bar; a **6-up per-pillar bounce-back grid** (`repeat(6,1fr)` so it spans the card width) each with `%-back` mini bar colored by recovery; **muscle signals** lines (cadence/stride/power deltas, amber); **earliest quality session** green-light line.
5. **BODY** — bar-card grid (auto-fill `minmax(186px,1fr)`): HRV, Resting HR, HRV CV, Sleep, Resp rate, SpO₂, Wrist temp, Weight, Body fat, Lean mass, VO₂ max, Max HR.
6. **SLEEP STAGES** — architecture framing line (`#6`) + bar-cards: Deep/REM (with targets) + Light/Awake (context).
7. **FORM** — bar-cards: Cadence, Ground contact, Vertical osc, Vert ratio, Stride length, Run power.
8. **DEEPER INSIGHTS** — insight cards (label + headline + one-liner): Training Form (`#7` TSB), Vs Last Build (`#11`), Day-of-week (`#12`), Quality predictors (`#14`), Environment·Heat (`#10`). Each renders only when it has data.
- **Cycle phase / cycle performance** (`#13`) — render only when `seed.user.biologicalSex === 'female'`. Not shown for David (male).

## The bar-card (every metric tile)
`.mc`: label + status dot · signed/direction arrow · big value (Oswald) + unit · a **14-bar chart** (last bar = today, colored by status; others muted) with a dashed **target line** · caption (e.g. `target 53`) + status tag (`on target / watch / below target / steady`). Status colors: `good #5fd06a · watch #F3AD38 · bad #FC4D64 · neutral #5bbfb0`.

## Data → features (the 15 power moves)
Bind tiles/sections to: `readinessBrief.{synthesis #1, streaks #2, watchTomorrow #3, pillars[].confounders #4, subjectiveCheckin/subjectiveOverride #5, forecasts #9, trainingForm #7}`, `health.{sleepStages.architectureFraming #6, aerobicFitness #8, recoveryPhase #15, heatAcclim #10, blockComparison #11, dowPatterns #12, cyclePhase/cyclePerformance #13, qualityPredictors #14}`, plus the body/form tile series. Every section degrades to absent (not a placeholder) when its field is null.

## Doctrine
No prescription on readouts (coach voice is descriptive); state both numbers, no derived deltas on raw metrics (signed score pts are OK); dark-first, white text, color from status dots + accents; **no em dashes** (use `·`); cold-start → "Baseline forming · day 1 of trend tracking", sparse trend → faded placeholder bars.

## Tokens
Bands + status colors above. Fonts: **Oswald** (numbers/score), **Inter** (everything else), Anton (logo only). Mesh: green health gradient. Cards `rgba(4,18,16,.4)` + `1px rgba(255,255,255,.1)`, radius 16.

## Files
- `Faff Health Redesign.html` — the prototype (open full-width).
- Brief refs (project): `health-page-power-moves-v2.md`, `health-page-full-data-ready-v2.md`, `readiness-baseline-correction-design-brief.md`.
- Web source to update: `web-v2/components/faff-app/views/HealthView.tsx`.
