# Workout day · pre-run and post-run inventory for iPhone

**For:** design agent (iPhone)
**From:** frontend (faff-web)
**Date:** 2026-06-01
**Status:** Inventory of every element the web surface renders for a
single workout day. The iPhone version should render the same data,
re-arranged for a vertical-scroll native surface.

---

## What this doc covers

Every visible element on the web's Today surface for a single
workout day, organized by state. Each element is paired with:

- **Source** · the field on `seed.readinessBrief`, `seed.week[i]`,
  or the lazy-fetched `useRunSummary(activityId)` payload.
- **When** · which day-state(s) render it (planned / done / rest /
  skipped / adapted).
- **Interactions** · runner-initiated actions (tap, swipe, edit) and
  the backend endpoint they hit.

Doctrine rules that apply to the iPhone too:

- **No prescription on the readiness surfaces.** The coach voice
  prescribes on workout cards. The readiness panel describes.
- **No em dashes.** Periods, commas, or middot `·`. En dashes only
  for numeric ranges (5–10 reps).
- **No citations anywhere.** Never `Research/X`, `docs/Y.md`,
  `§Section`, or "per <doctrine>". Doctrine lives in code, not on
  the runner's screen.
- **State both numbers, no derived deltas.** "7.2h sleep · target
  7.5h" YES. "Sleep -0.3h short" NO.
- **Dark first.** Color hierarchy is typography weight + accent
  dots, never opacity below ~0.8 on body text.
- **Subjective beats objective.** When the runner's 1-10 wellness
  reading disagrees with the objective composite by ≥15 pts, the
  override block fires loud at the top of the readiness drawer.

---

## Day-states

A single calendar day on the plan is in one of these states. The
iPhone needs renderings for each.

| State | Trigger | Visual treatment on web |
|---|---|---|
| **Planned · upcoming** | `d.done === false && d.skipped !== true && d.type !== 'rest'` | PlannedHeroV2 (the green/teal hero with stats + session + plan card) |
| **Planned · today** | Same as above, plus `d.today === true` | Same as planned-upcoming + "TODAY" badge in eyebrow |
| **Done** | `d.done === true` | CompletedHeroV2 (results-focused hero with real splits, map, RPE entry) |
| **Rest day** | `d.type === 'rest'` | Compact Recovery panel · "Rest is training. Sleep, hydrate, mobilize." |
| **Skipped** | `d.skipped === true` (from `day_actions` table) | PlannedHeroV2 with `.skipped` class · grayscale wash + SKIPPED badge + Restore CTA |
| **Adapted** | `d.adaptation.wasAdapted === true && originalLabel !== currentLabel` | Layered on top of the relevant state above · amber adaptation banner + chip dot + "was X" subline |

---

## TODAY HEADER (always visible)

| Element | Source | Notes |
|---|---|---|
| Date · full | `d.full` (e.g. "Monday, June 1") | Top-left |
| Week-of label | `seed.weekOf` (e.g. "Week 3 of 13 · BASE") | Below date |
| Readiness ring | `seed.readinessBrief.score` (preferred) → `seed.readiness.score` fallback | Right side · 56px ring |
| Readiness band color | `seed.readinessBrief.band` mapped to: `sharp #34D058` · `ready #3EBD41` · `moderate #F3AD38` · `pull-back #FC4D64` · `no-data #8A90A0` | Stroke color of the ring + the label text color |
| Readiness label | `seed.readinessBrief.label` (e.g. "PULL BACK") | Above the ring |
| Tap target | Whole chip opens the **Readiness drawer** | See "Readiness drawer" section below |

---

## CARD STACK (above the week strip · order locked)

Renders 0-5 cards depending on what's active. Order is fixed:

### 1. Coach proposals · `seed.pendingProposals[]`

Illness or injury proposals from the coach engine. Red-warn gradient
card. Renders Accept + Decline buttons.

| Element | Source | Notes |
|---|---|---|
| Eyebrow | Derived from `proposal_type` (e.g. "INJURY · COACH PROPOSAL") | |
| Headline | Hardcoded by proposal type ("Switch to injury-return plan" / "Acknowledge recovery week") | |
| Reason | `proposal.reason` | What the coach noticed |
| Suggested action | `proposal.suggested` | What to do |
| Accept button | POST `/api/coach/proposal/[id]/accept` | |
| Decline button | POST `/api/coach/proposal/[id]/decline` | |

### 2. Plan proposals · `seed.planProposals` where `status === 'pending'`

Drift detection from the autonomous plan adapter. Amber-warn card.
Accept + Dismiss buttons.

| Element | Source | Notes |
|---|---|---|
| Eyebrow | Derived from `kind` (e.g. "VOLUME · DRIFT", "FITNESS · DRIFT") | |
| Headline | Derived from `kind` ("Volume off plan", "Fitness moved") | |
| Body | `proposal.message` | Always populated · plain-language one-liner |
| Accept button | POST `/api/plan/proposal { id, action: 'accept' }` | Regenerates the plan |
| Dismiss button | POST `/api/plan/proposal { id, action: 'dismiss' }` | 14-day silence on the same kind |

### 3. Plan proposals · `seed.planProposals` where `status === 'auto_applied'`

Hard drift the system already rebuilt for (race date / goal time
change). Teal passive notification, no buttons (action already taken).

| Element | Source | Notes |
|---|---|---|
| Eyebrow | "{kind} · APPLIED" (e.g. "RACE · DATE · APPLIED") | |
| Headline | Same kind-derived label | |
| Body | `proposal.message` | "We rebuilt your plan because race date moved to Aug 23 · 11 weeks remaining" |
| Link · "See the new plan ›" | When `newPlanId` non-null · router.refresh to pull the new seed | |

### 4. Physiology nudge · ProfileGapCard (conditional)

Fires when: 3+ days post-onboarding AND no LTHR/HRmax/weight/height
AND no HealthKit connected. Surfaces a Profile/Health CTA.

| Element | Source | Notes |
|---|---|---|
| Headline | Hardcoded · "Tell Faff your LTHR + HRmax" | |
| Fragment | Hardcoded · "so the coach can dial in your zones. Takes ~30 seconds." | |
| CTA | Routes to `/health` | |
| Dismiss | Persists `physiologyNudgeDismissed` in localStorage | |

### 5. Missed yesterday · DayStatePill (conditional)

Fires when yesterday was planned + not rest + not done + not skipped.

| Element | Source | Notes |
|---|---|---|
| Tag | "MISSED" | |
| Label | `Yesterday's {missedYesterday.name.toLowerCase()} · {missedYesterday.dist} mi` | |
| Actions | "Log different effort" · "Skip retroactively" · "Carry forward" | Each POSTs to `/api/today/skip` or similar |

---

## THIS WEEK STRIP (7 chips, Mon-Sun)

7 chips in a horizontal row. Each chip represents `seed.week[i]`.

| Element | Source | Notes |
|---|---|---|
| Day-of-week label | `d.dw` (MON / TUE / ...) | Or "TODAY" badge when `d.today === true` |
| Day number | `d.dn` | Day of month |
| Done checkmark | `d.done === true` | Green check icon |
| Skipped tag | `d.skipped === true` | Replaces stats with "SKIPPED" |
| Name | `d.name` (e.g. "Easy", "Cruise Intervals", "Long") | Sub_label-aware · `humanName` fallback |
| Effort dot color | `d.type` mapped to effort palette | recovery / easy / long / tempo / intervals / rest |
| Distance + pace | `d.dist + ' mi · ' + d.pace` | "6.0 mi · 8:45" |
| Adaptation dot | `d.adaptation.wasAdapted` | Small amber dot next to name |
| "was X" subline | `d.adaptation.originalSubLabel || originalType` | Uppercase, dimmed amber. Hidden when no-op adaptation |
| "+ STRENGTH" annotation | `d.strengthSuggested` (true when ISO matches `seed.strengthRecommendation.recommendedDays`) | Hidden on done days |
| Tap target | Updates `curDay` state → hero swaps to that day | NO modal on TodayView · just hero swap |

---

## PRE-RUN HERO · PlannedHeroV2

The big card for planned-and-not-done days. Three columns on web (will
likely stack on iPhone).

### Column 1 · Left stack

| Element | Source | Notes |
|---|---|---|
| Eyebrow | `{TODAY/dw} · {type.toUpperCase()} · PLANNED` | "TUE · EASY · PLANNED" |
| Title | `d.name` (uppercase, Oswald 62px) | "EASY" or "CRUISE INTERVALS" |
| Adaptation banner | When `d.adaptation.wasAdapted && labels differ` | Amber card with: kind verb + originalLabel + reason + "Restore original →" link |
| Stats grid · Distance | `d.dist` | "6.0 mi" |
| Stats grid · Target pace | `d.pace` | "8:45/mi" |
| Stats grid · Est time | `d.est` | "~53 min" |
| Effort target bar | `d.type` → `EFF[type].mark` position on a Z1-Z5 gradient | EASY label bubble sits above the marker |
| Effort copy | `effortLbl.copy` (e.g. "Conversational · Z2") | Right-aligned above the bar |
| Forecast | `useDayForecast(d.iso)` → "57-78° · Cloudy" | Lazy-fetched |
| Shoe picker | `seed.shoes[]` + `seed.todayShoeId` or coach rec | Tap opens ShoePicker portal |
| Fuel | `KIT[d.type].fuel` (hardcoded per effort) | "Water" / "PF 30 gel @ mi 5" / etc. |
| Best window | Derived from `forecast` (coolest 2-hr window) | "6-8 AM" |

### Column 2 · Session card (middle)

| Element | Source | Notes |
|---|---|---|
| Header | "SESSION" eyebrow | |
| Shape bar | `SEGS[d.type]` (hardcoded segment widths) | Visual workout shape (warmup / work / cooldown) |
| Segment rows | One per segment in `SEGS[d.type]` | Each row · color dot + label + sub ("Easy aerobic 6.0 mi · 8:45/mi") |
| Cue | `KIT[d.type].coach` | Single line at bottom · "Keep it truly easy. Nose-breathing pace the whole way." |

### Column 3 · "The Plan" card (right)

| Element | Source | Notes |
|---|---|---|
| Header | "THE PLAN · UPCOMING" (badge changes to SKIPPED when skipped) | |
| Verdict | Coach engine: `purpose.verdict` → `planVerdict(d.type)` fallback | "Keep it easy." |
| Recap | Coach engine: `purpose.facts.join(' ')` → `planRecap(d.type)` fallback | "Base-building, not a workout. Keep it boring and bank the aerobic volume..." |
| Heart rate target | `hrTargetLabel(d)` → reads `d.hrCap` from workout_spec | "< 130 bpm · Z2" |
| Effort target | `effortLbl.ratio` (e.g. "3 / 10 · easy") | |
| Cadence target | `planCadenceTarget(type, cadenceBaseline)` | "relaxed" / "182 spm" etc. |
| SKIP THIS RUN button | POST `/api/today/skip { date }` | Optimistic flip to skipped state |
| RESTORE RUN button | DELETE `/api/today/skip { date }` | When already skipped |

---

## POST-RUN HERO · CompletedHeroV2

Replaces PlannedHeroV2 when `d.done === true`. Real run data from
`useRunSummary(activityId)` (lazy-fetched).

### Lazy data shape · `RunSummary`

`useRunSummary(activityId)` fetches `/api/run-summary/[activityId]`
and returns:

| Field | What |
|---|---|
| `time_moving` | Moving time (seconds) |
| `pace` | Avg pace string |
| `hr_avg` | Average HR (bpm) |
| `temp_f` | Conditions temperature |
| `elev_gain_ft` | Total elevation gain |
| `shoe_id`, `shoes[]` | Garage + selected shoe |
| `splits[]` | Per-mile splits · `{ paceSec, hr, gainFt, lossFt }` |
| `polyline` | Encoded route geometry |
| `cadence_avg`, `cadence_max` | Form metrics |
| `gct_ms`, `vertical_osc_cm` | Ground contact time, vertical oscillation |
| `run_power_w` | Power (when watch supports) |
| `rpe`, `feel_chips[]` | Runner self-report (RPE 1-10, post-run check-in chips) |

### Pre-run shape preserved

The CompletedHero keeps the left stack structure (DISTANCE / PACE /
TIME) but populates with REAL values from `runData`. Adds:

| Element | Source | Notes |
|---|---|---|
| Eyebrow | "TODAY · EASY · DONE" | |
| Win line | `result.win + result.winx` (derived from coach engine) | "Hit pace · steady all the way" |
| Average HR | `runData.hr_avg` | "134 bpm" |
| Elev gain | `runData.elev_gain_ft` | "245 ft" |
| Conditions (actual) | `renderTempRange(runData.temp_f, weather)` | "65°F → 77°F" (start → end) |
| HR vs usual callout | When `avg HR` deviates from runner's baseline | "10 bpm higher than your usual easy pace" |
| Route map | `polyline` → SVG path | RouteMap component · pannable on web, swipeable on iPhone |
| Map stats overlay | `dist` + `gain` | "5.0 MI · ↗ 245 FT" overlay on map |
| Per-mile splits table | `splits[]` | One row per mile · pace + HR + gain · color-coded by phase (warmup/work/cooldown) for quality workouts |
| Form metrics | `runData.cadence_avg`, `gct_ms`, `vertical_osc_cm`, `run_power_w` | FormMetrics card · only renders fields actually present |
| RPE entry | `runData.rpe` ?? null | RPEEntryCard · runner taps 1-10 → POST `/api/run/[id]/rpe { rpe }` |
| Post-run check-in chips | `runData.feel_chips` ?? null | PostRunCheckinChips · multi-select chips (Strong / Tired / Heavy / Smooth / etc.) → POST `/api/run/[id]/feel-chips` |
| Right card "HOW IT WENT" verdict | Coach engine | "On plan" / "Off plan" / "Below target" |
| Right card recap | Coach engine | What the data means |
| Right card targets | Compares planned vs actual (HR, pace, cadence) | |

---

## REST DAY

When `d.type === 'rest'`, hero collapses to a compact panel.

| Element | Source | Notes |
|---|---|---|
| Eyebrow | "TODAY · REST · PLANNED" | |
| Title | "REST" | |
| Subhead | Hardcoded · "Sleep, hydrate, mobilize. Let the work land." | |
| Coach line | `KIT.rest.coach` · "Rest is training. An easy 20-min walk is fine, but do not turn it into a session." | |
| No SKIP button (rest is the floor) | | |

---

## READINESS DRAWER · opens from the Today header readiness ring

Right-side slide-out drawer (392px on web). Vertical scroll. Replaces
the legacy drawer entirely as of 2026-06-01.

Source · `seed.readinessBrief` (full envelope) + the day's current
state for context.

Render order (top → bottom), each section conditional:

### 1 · Subjective override callout (when `subjectiveOverride !== null`)

Loud orange-red gradient at the top. Triggers when subjective 1-10
disagrees with objective composite by ≥15 pts.

| Element | Source |
|---|---|
| Tag | "SUBJECTIVE OVERRIDE" (pulsing dot) |
| Two scores | `subjectiveScore` (yours) vs `objectiveScore` (the numbers) |
| Advice | `subjectiveOverride.advice` |

### 2 · Hero · score ring + headline

| Element | Source |
|---|---|
| Score ring (84px) | `brief.score` · band-colored stroke · no label inside |
| Band eyebrow | `brief.label` (e.g. "READY", "PULL BACK") · color matches ring |
| Headline | `brief.headline` · the band-aware coach-voice framing |
| OneLineMover | `brief.oneLineMover` (when non-null) · "HRV down 8 pts vs yesterday" |

### 3 · Gap report · "am I on track" (when `brief.gapReport !== null`)

The keystone surface for "am I on track for my race?"

| Element | Source |
|---|---|
| Headline (status-tinted) | `gapReport.headline` |
| Confidence band (when `confidenceBand !== null`) | 3 stops · p25 / median / p75 (each in HMS) |
| What closes it · bulleted list | `gapReport.whatClosesIt[]` |
| Realistic outcomes A/B/C (when `alternativeRanges !== null`) | Three goal options · interactive Choose buttons when `daysToRenegotiate === 0` → PATCH `/api/race/[slug] { goalSec, source: 'renegotiate' }` |
| Plan risks (when `riskFlags[]` non-empty) | Amber bullets · "Wk 3: 14% volume ramp" |

**No citation footer.** Backend ships a citation field but it never renders.

### 4 · 14-day score trend

| Element | Source |
|---|---|
| Bar chart (when `scoreTrend.length >= 4`) | One bar per day · today highlighted with glow · band-colored bars |
| Date axis | First date · "TODAY" |
| Trend note | `brief.trendNote` (composer-authored, names the cause) |
| Building-trend message (when `scoreTrend.length < 4`) | "Building trend · N days logged. A few more snapshots and the chart will fill in." |

### 5 · Streak banners (when `streaks[]` non-empty)

| Element | Source |
|---|---|
| Pillar key | `streak.pillar.toUpperCase()` (SLEEP / HRV / RHR) |
| Direction badge | `↓ N days below` or `↑ N days above` (red or green) |
| Short (collapsed default) | `streak.short` (5-10 words) |
| Meaning (tap to expand) | `streak.meaning` (full paragraph) |
| Tap target | Toggle short ↔ meaning |

### 6 · What's driving it · 5 pillars

| Element | Source |
|---|---|
| Pillar dot color | `pillar.band` · sharp/ready→green · moderate→amber · pull-back→red · no-data→grey |
| Pillar label | `pillar.label.toUpperCase()` |
| Contribution bar | `pillar.weightContribution` (signed, color-coded) |
| Observed value | `pillar.observedValue` (e.g. "44ms", "47 bpm", "1.25 ACWR") |
| Baseline | `pillar.baseline` (e.g. "baseline 55ms", "target 7.5h") |
| Signed pts | `weightContribution` colored by sign |
| Tap to expand | |
| Expanded · sub line | `observedValue · observedSub · baseline` |
| Expanded · meaning | `pillar.meaning` |
| Expanded · 14-day history | `pillar.trend[]` mini bar chart |
| Expanded · confounders | Only `confounders.filter(c => c.likely)` under "MOST LIKELY BEHIND IT". Unlikely confounders dropped entirely. |

**Auto-expand rule** · pull-back-band pillars expand by default when
overall band is `pull-back` or `moderate`.

### 7 · Composition line (when `composition !== null`)

`BASELINE 53 · NET -11 · TODAY 42` · the math. NET signed-colored by
contribution sign. TODAY in band color.

### 8 · Watch tomorrow (when `watchTomorrow[]` non-empty)

0-3 forward-looking callouts. Each row · small amber dot + text.

### 9 · Morning check-in (when `subjectiveCheckin.answered === false`)

| Element | Source |
|---|---|
| Eyebrow | "MORNING CHECK-IN" |
| Question | "How do you feel this morning?" |
| Scale | 2 / 4 / 6 / 8 / 10 buttons (Oswald) |
| Note | "When your read disagrees with the numbers, yours wins." |
| POST | `/api/readiness/subjective { rating }` → response includes `willTriggerOverride` boolean |
| Success state | "Logged · 8/10. In line with today's read." or "Your read disagrees with the numbers · yours wins on the next refresh." |

### 10 · View full health link

Routes to `/health`.

---

## ADAPTATION PROVENANCE · cross-cutting

When a row is mutated by the auto-adapter (`d.adaptation.wasAdapted === true`),
provenance surfaces on:

| Surface | Element |
|---|---|
| Week strip chip | Small amber dot next to name · "WAS THRESHOLD" strikethrough subline |
| FULL PLAN month cell | Same pattern, smaller |
| Hero adaptation banner | Amber card · `{kindVerb} from {originalLabel}. {reason}` · "Restore original →" link |
| WorkoutDetail modal (Train tab) | "HOW IT CHANGED" block with same content + Restore original button |

**Restore action** (any surface):
- POST `/api/plan/restore { workoutId }` (where workoutId = `d.planWorkoutId`)
- Backend promotes `original_*` columns back to active fields, re-derives workout_spec, logs `coach_intents` with `reason='plan_adapt_overridden'`
- Frontend fires `router.refresh()` → seed re-pulls → adaptation provenance clears

**Suppression rule**: when `originalSubLabel || originalType` equals
the current label/type (no real change), the banner is hidden. The
"Adjusted from EASY" when still EASY case never renders.

---

## DESIGN CONSTRAINTS (carry to iPhone)

- **Effort palette** (color of dots, mesh, accents):
  - recovery `#27B4E0`
  - easy `#14C08C`
  - long `#F3AD38`
  - tempo `#FF8847`
  - intervals `#FC4D64`
  - rest `#8A90A0`

- **Band palette** (readiness ring/sparkline):
  - sharp `#34D058`
  - ready `#3EBD41`
  - moderate `#F3AD38`
  - pull-back `#FC4D64`
  - no-data `#8A90A0`

- **Type stack**:
  - Oswald · big numerics + display titles (workout name, score)
  - Inter · all body, labels, headlines
  - Anton · brand wordmark only · NOT body

- **Tone** (Coach voice):
  - Short, direct
  - No hype, no exclamation marks
  - No emoji
  - No em dashes (use `·` middot)
  - No citations (`Research/X`, `docs/Y.md`, `§Section`, "per X")

- **Composition is state-driven, not template-driven**. The iPhone
  rendering of a planned EASY day in base phase should look
  meaningfully different from a planned LONG day in race week.
  Sections add/remove/promote based on state, not just numbers.

---

## OPEN UI QUESTIONS THE IPHONE DESIGN SHOULD ADDRESS

1. **Vertical stacking of hero columns** · web has left stack +
   session + plan side-by-side. iPhone needs to decide a tab order
   or vertical priority. Suggest: stats → session → targets/cues →
   verdict/recap.

2. **Readiness drawer placement** · slide-up sheet from a tap on
   the score ring at the top of Today, OR a dedicated tab? Web is a
   right-side slide-out, doesn't translate directly.

3. **Map gestures on completed runs** · web is interactive
   pan-zoom. iPhone could use a full-screen tap-to-expand modal
   instead of inline gestures.

4. **Restore CTA placement on iPhone** · web has it inline in the
   hero adaptation banner. iPhone might want a swipe-to-restore on
   the chip, OR an action sheet on long-press, OR just a button.

5. **Morning check-in placement** · web has it in the readiness
   drawer at section 9 (deep). iPhone might want it as a
   first-thing-this-morning prompt above the fold.

---

## RELATED

- Web source · `web-v2/components/faff-app/views/TodayView.tsx`
- Hero variants · `PlannedHeroV2` (line 657) + `CompletedHeroV2` (line 974)
- Readiness drawer · `web-v2/components/faff-app/overlays/Drawer.tsx`
- Workout detail modal · `web-v2/components/faff-app/overlays/WorkoutDetail.tsx`
- Run detail modal · `web-v2/components/faff-app/overlays/RunDetailModal.tsx`
- Seed types · `web-v2/components/faff-app/types.ts` (FaffSeed, ReadinessBriefSeed, RaceDetailSeed)
- Effort + segment data · `web-v2/components/faff-app/constants.ts` (EFF, SEGS, KIT)
