# iPhone Health page · redesign brief

**Date:** 2026-06-02
**For:** design agent
**From:** David, via web agent
**Status:** new design ask · port the web Health page pattern to iPhone

## TL;DR

The web Health page is what we want on iPhone too. It's the "all-knowing recovery dashboard." Take its content, hierarchy, and intent as the source of truth; adapt to a single-column native iOS surface. Do not redesign the information architecture, just the layout.

Reference file: `web-v2/components/faff-app/views/HealthView.tsx`
Doctrine comment block lives at the top of that file (lines 3-28); read it before mocking up.

## Architecture intent

**Glance → scan → drill.**

- **Glance** · one focal answer. Did the body bounce back? The hero gives a single readiness score in context (gauge + verdict + 14-day baseline + signed delta).
- **Scan** · uniform bar-card tiles across labeled domains (BODY, SLEEP STAGES, FORM). Pattern repeats so the eye can sweep quickly.
- **Drill** · tap a tile to expand history / trend / target.

The page is long on purpose. The runner who only needs a glance gets it in the first viewport. The runner who wants to investigate keeps scrolling.

## Page order (top to bottom)

1. **Header** · "Health" title + "Recovery & form · MON JUN 2" subline + `+ Log measurement` button on the right
2. **HERO** (3-col on web, stack on iPhone) · readiness gauge + drivers + aerobic fitness + 7-day trend
3. **STORY + WATCHING TOMORROW** (2-col on web, stack on iPhone) · synthesis + streak sparklines + forecast chips
4. **RECOVERY PHASE** (only when `seed.health.recoveryPhase` exists · post-hard-session)
5. **BODY** · metric grid of bar-cards (HRV, RHR, sleep total, etc.)
6. **SLEEP STAGES** · architecture verdict line + 4 stage tiles (deep, REM, light, awake)
7. **FORM** · running form metric grid (cadence, power, stride, vert osc, GCT, balance)
8. **DEEPER INSIGHTS** · 6 mini cards (training form, vs last build, day-of-week, predictors, heat, cycle female-only)

Every section degrades to ABSENT, not a placeholder. If the data isn't there, the section doesn't render. No "no data yet" empty states for whole sections.

## Per-section spec

### 1. Header
- Title "Health" · large display font
- Subline "Recovery & form · <weekday> <mon> <day>"
- Trailing `+ Log measurement` button (sheet trigger). On iPhone this is a circular icon button or a small pill in the top-right · don't let it eat vertical space.

### 2. HERO

This is the focal answer. On web it's 3 columns; on iPhone it's a vertical stack.

**Score column** (top on iPhone)
- **Big circular gauge** · score 0-100, stroke color by band: `sharp #34D058`, `ready #3EBD41`, `moderate #F3AD38`, `pull-back #FC4D64`, `no-data #8A90A0`.
- Below: **verdict text** in coach voice ("Sharp," "Ready to push," "Hold the line," "Pull back today," "Syncing").
- Below that: a one-line baseline summary: `14-day baseline 73 · today 81 · +8`. Signed delta colored green when positive, red when negative.

**Drivers column** (next on iPhone)
- Section label "WHAT IS DRIVING IT" (small uppercase letter-spacing 0.4)
- 3-5 driver rows. Each row:
  - colored pillar dot (status color)
  - pillar name + short why (e.g. "Sleep · 7h 12m last night")
  - thin proportional bar (recovery progress against target)
  - signed pts on the right (`+4`, `−2`)
- Drivers are ranked by absolute contribution to today's score.

**Aerobic fitness card** (next on iPhone, only when present)
- Section label "AEROBIC FITNESS"
- Value line: `2.1% → 1.4%` (drift at block start → drift today)
- One-line summary in coach voice.

**7-day readiness bars** (last in hero on iPhone)
- Section label "7-DAY READINESS" · right side: `NOW 81 · AVG 74`
- 7 vertical bars sized by score within the week's range. Today is highlighted with the band color and a glow. Past days are dim gray.
- Day labels under the bars: `MON TUE WED ...`

### 3. STORY + WATCHING TOMORROW

Only renders when the readiness brief (`seed.readinessBrief`) is present. On web this is a 2-column row; on iPhone it's two stacked cards.

**THE STORY** (first)
- Small magenta-tinted "THE STORY" tag
- One-paragraph synthesis from the brief (`brief.synthesis` or fallback to `trendNote` / `headline`).
- Below the paragraph: **streak sparklines** when one or more pillars have been below baseline for ≥3 days.
  - Each streak: pillar label (SLEEP / HRV / RHR / LOAD / HR RECOVERY) + days-below count + mini sparkline + dashed baseline reference + a short coach line ("HRV down 12% over 4 nights").

**WATCHING TOMORROW** (second)
- Small teal-tinted "WATCHING TOMORROW" tag
- Bullet list of 2-3 things to watch ("Sleep · usually 7h+ before quality, last night 6h").
- Below: **forecast chips** (max 3) · each chip has a small "FORECAST" label + a phrase like "HRV crosses back into ready band by Wed."
- When `brief.watchTomorrow` is empty: "Nothing flagged for tomorrow yet." in a muted color (no chips).

### 4. RECOVERY PHASE (conditional)

Only renders when `seed.health.recoveryPhase` is not null (the runner is in a recovery window after a hard session).

- Header row:
  - LEFT: "RECOVERING FROM" eyebrow + anchor label ("Long run · 12 mi, Sun")
  - RIGHT: percent recovered (big number) + "Day N of M expected"
- Full-width progress bar at the % recovered value
- 2-column grid of pillar rows (sleep, hrv, rhr, load). Each: pillar label + thin colored bar + `XX% back` value. When `pctRecovered` is null: bar empty, text "no data" in dim gray.
- Optional muscle-signals one-liner under the grid ("Quads still tender · stretch added").
- Green-light line at the bottom: "Earliest quality session: <date> · <reason>." OR when data is insufficient: "Recovery tracking awaiting watch sync · pillar measurements not in yet."

### 5. BODY · metric grid

Section label `BODY` with a horizontal hairline rule to its right.

Each metric is a **bar-card** · the foundational tile in this design. The pattern repeats for SLEEP STAGES and FORM, so build it once and reuse.

**Bar-card anatomy** (web class names in parens for reference)
- Top row: small color dot + metric name on the left (`.hmc-k`); current value on the right (`.hmc-v`) in display font, often with a unit ("7h 12m," "58 bpm," "92 ms")
- Middle: a horizontal mini bar chart of the last 14 days (`.hmc-bars`)
  - Each bar's height represents that day's value
  - A horizontal **target line** runs across at the runner's target value
  - Empty days render as a short faded stub or are absent (designer's call)
  - When no data at all: "no data yet" muted text replaces the bars
- Bottom row: caption on the left (e.g. "vs 14d baseline"); status text on the right ("on target" / "below target" / "watching") in the metric's status color

**Tap to expand** (drill behavior): when active, the card expands vertically to show 28-day history + the target value + a short coach line. Spec: keep the expand-in-place pattern; don't navigate away.

**Tiles in BODY** (current shape from `seed.health.body`):
- Resting HR
- HRV (today's reading)
- VO2 max
- Body temperature
- Respiration rate
- Wrist temp (when present)

### 6. SLEEP STAGES

Section label `SLEEP STAGES` with hairline rule.

**Architecture verdict line** (above the tiles):
- "Architecture **stable** across the last 7 nights · 22% deep, 28% REM."
- Verdict word is bold; tone classes: `stable` good, `fragmented` warn, `disrupted` bad.

**Stage tiles** (same bar-card pattern as BODY):
- Deep sleep · h:mm value
- REM sleep · h:mm value
- Light sleep · h:mm value
- Awake time · h:mm value

### 7. FORM

Section label `FORM` with hairline rule.

Same bar-card grid. Tiles from `seed.health.form`:
- Cadence (spm)
- Run power (W)
- Stride length (m)
- Vertical oscillation (cm)
- Ground contact time (ms)
- L/R balance (% / %)

### 8. DEEPER INSIGHTS

Section label `DEEPER INSIGHTS` with hairline rule.

Six mini insight cards (each renders only when its data exists). Layout: 2-col grid on web; on iPhone, stack as full-width cards.

Each card:
- Small uppercase eyebrow (`.hins-k`) · e.g. "TRAINING FORM", "VS LAST BUILD", "DAY-OF-WEEK"
- Display-font headline (`.hins-h`) · e.g. "+18 · Building well"
- One-line meta (`.hins-m`) · e.g. "Fitness 47 · Fatigue 29. ACWR 1.12."

**The six cards:**
- **TRAINING FORM** · fitness/fatigue/ACWR readout
- **VS <previous-block>** · sleep/HRV deltas against the last training block
- **DAY-OF-WEEK** · "Saturday HRV is consistently 8ms above weekday avg."
- **WHAT PREDICTS YOUR BEST RUNS** · "Deep sleep ≥ 1h 30m → 18s/mi faster on quality days."
- **ENVIRONMENT · HEAT** · acclimating / adapting / stable + a coach line
- **CYCLE · PERFORMANCE** · only when `seed.user.biologicalSex === 'female'` and cycle data is present

## Tone

Coach voice. Short, direct, no hype. Periods, commas, middot `·` only · no em dashes, no exclamation marks, no emoji.

Examples of good copy already in the design:
- "Sharp." (verdict)
- "Hold the line."
- "Earliest quality session: Wed · sleep + HRV both back in range."
- "Architecture stable across the last 7 nights · 22% deep, 28% REM."

Examples of bad copy to avoid:
- "You've been crushing it!" (hype, exclamation)
- "Your aerobic fitness is improving steadily" (hedged, wordy)
- "Mitochondrial biogenesis is up" (PhD jargon, design brief banned this)

## Color tokens

Status palette (consistent across all surfaces):
- `good` `#5fd06a` · on target / healthy / building
- `warn` `#F3AD38` · watching / drifting / mild fade
- `neutral` `#5bbfb0` · stable / no concern
- `bad` `#FC4D64` · below target / pull back

Readiness band colors (gauge stroke + week-bar today highlight):
- `sharp` `#34D058`
- `ready` `#3EBD41`
- `moderate` `#F3AD38`
- `pull-back` `#FC4D64`
- `no-data` `#8A90A0`

## Skip rule (doctrine)

Every section degrades to ABSENT, not a placeholder. If `seed.health.recoveryPhase` is null, the RECOVERY PHASE section simply doesn't render. If a bar-card has no data, it shows "no data yet" in the bar area but the card itself still renders so the grid stays balanced. Don't add empty-state copy for whole sections.

## iPhone-specific notes

- **Stack everything vertically.** The web layout uses 2-3 columns in places (hero, story row, deeper insights grid). On iPhone, every multi-column row becomes a vertical stack. Order top to bottom: gauge → verdict → baseline → drivers → aerobic fitness → 7-day bars. Then story, then watching tomorrow. Then deeper-insights cards full-width one after another.
- **Bar-card grid:** 2-column on iPhone (current TodayView pattern). Don't try 3 across · tiles get unreadable.
- **Tap targets:** every bar-card is tappable to expand. Minimum 44pt tap area.
- **Drag dismiss:** if RECOVERY PHASE renders as a sheet on tap, follow the existing iOS sheet drag-dismiss doctrine (locked CLAUDE.md rule).
- **Log measurement** sheet: existing `ManualHealthSheet` doctrine. Same pattern as web · 4-5 manual inputs, save to backend.

## Data

All data already available to iPhone via the same seed contract the web reads:

- `seed.health.readiness` · today's score, band, baseline, trend, drivers
- `seed.readinessBrief` · synthesis, watchTomorrow bullets, forecasts, streaks, pillar trends
- `seed.health.recoveryPhase` · anchor, % recovered, pillar pctRecovered, muscle signals, green-light
- `seed.health.body` · HealthMetric tiles for the BODY grid
- `seed.health.sleepStages` · deep / REM / light / awake (and `sleepArchitectureVerdict`)
- `seed.health.form` · HealthMetric tiles for the FORM grid
- `seed.health.aerobicFitness` · block-start drift % → current drift % + summary
- `seed.health.blockComparison`, `dowPatterns`, `qualityPredictors`, `heatAcclim`, `cyclePerformance` · the DEEPER INSIGHTS cards

The `HealthMetric` shape (one tile's worth):
```ts
{
  k: 'rhr' | 'hrv' | ...    // stable key
  name: string              // display name
  current: number           // today's value
  target: number            // target line position
  trend: { date, value }[]  // last 14 days for the bar chart
  status: 'good' | 'warn' | 'neutral'
  clock?: boolean           // when true, current renders as h:mm
}
```

## What to ship back

Per design's usual format · self-contained HTML mockups at iPhone scale (375pt wide), real brand fonts (Oswald display, Inter body), real palette, real example data. One file per major scenario (full data, recovery-phase active, sparse data showing the absent-section behavior). Drop them under `designs/from Design agent/iphone_health/` and the iPhone agent will implement.

## What this is NOT

- Not a web redesign · the web Health page stays as-is.
- Not a new data model · use the existing seed shape.
- Not a coach-rule change · the doctrine that produces the verdicts and copy lives elsewhere; the design renders what it gets.
- Not pixel-identical to web · the iPhone surface has its own constraints and gets to use its own patterns where they help.

## Reference files

- `web-v2/components/faff-app/views/HealthView.tsx` · the implementation, full source
- `designs/from Design agent/health-page/` · the original 2026-06-01 web handoff (the source-of-truth design bundle the web view was built from)
