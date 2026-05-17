# Running App — Product Plan

A page-by-page implementation plan for a personal running app. Synthesized from APP_FEATURE_SPEC.md, four deep-research docs (D1 recovery score, D2 watch active workout, D3 sync architecture, D4 coach LLM design), eight content-inventory docs (C1-C8), and a 24-doc generic running-research knowledge base.

This is the "press go" deliverable. Each surface specifies what's on it, where the data comes from, what changes by user state, and what must be built. The build-sequence section defines the order.

---

## Executive summary

**What it is.** A multi-surface running app for one user (the developer). Three surfaces, one source of truth: a web command center for planning and analysis, an iPhone daily companion, an Apple Watch execution layer. An AI coach interprets the running knowledge base against the user's actual training data to produce prescriptions, recap analysis, insights, and chat answers.

**The brand.** Hero numbers. Small-caps gray labels. Color as semantic signal (green recovery / blue training / amber upcoming / red shortfalls / purple milestones). Coach voice over neutrality — direct, honest, specific. "Recovery is the workout. Volume drop is intentional." Density without clutter, scaled by device.

**The non-negotiable loop.** Plan flows web → backend → phone → watch. Activity flows watch → phone → backend → web → external services. Auto-logging is the default. The user opens the app to *review* a run, never to *log* one.

---

## Architecture decisions

### Recovery score

A composite 0–100 daily readiness number with a four-band traffic light, three contributing-factor cards, and a coach voice read.

```
Composite = (
  0.40 × HRV_score        // 7-day rolling LnRMSSD vs. 60-day mean ± SD
  + 0.18 × RHR_score      // 7-day rolling nocturnal RHR vs. 60-day mean ± SD
  + 0.22 × Sleep_score    // (TST / personalized_need) × efficiency vs. 14-day
  + 0.05 × Temp_score     // 3-night rolling deviation, flag only beyond ±0.5°C
) × Load_modifier         // [0.85, 1.10], driven by ACWR and ATL trend
× Subjective_modifier     // [0.85, 1.15] when user logs daily check-in; else 1.0
```

**Bands.** Red 0–33 / Yellow 34–49 / Green 50–79 / Optimal 80–100. Single source of truth across all surfaces.

**Output.** A number, a word, and a color. Three contributing-factor cards underneath show the top three drivers (positive or negative) in plain English. The coach voice block synthesizes them into one sentence.

**Baselines.** 60 days for HRV/RHR; 14 days for sleep; 28 days for training load. Score is hidden for the first 7 days of data with a "calibrating" state. Confidence floor: ≥4 valid nights of HRV/RHR in the last 7. Below that, fall back to a wider window with a confidence flag.

**When score and feeling disagree** (>30-point delta from a logged subjective wellness rating), surface the disagreement explicitly. Do not average it away. The coach voice acknowledges the disagreement and asks the user to trust their body.

**Source.** D1.

---

### Sync & integration architecture

**Source-of-truth hierarchies** per data type. Higher fidelity wins. Multiple-source records dedupe on time-window + distance + duration overlap.

| Data | Priority order | Notes |
|---|---|---|
| Activity (run) | faff.run Watch > Apple Watch built-in > Garmin/Coros device > Strava > manual | Strava is downstream — outbound only after Watch sync settles |
| HRV (LnRMSSD) | Oura > Whoop > Apple Watch (SDNN, never blended) > Garmin | SDNN and rMSSD never merged into one trend |
| RHR | Oura > Whoop > Garmin > Apple Watch | Use nocturnal lowest 30-min average, not morning supine spot |
| Sleep | Oura > Whoop > Apple Watch > Garmin | Dedicated trackers more accurate than wrist |
| Body composition | Smart-scale via HealthKit > Health-app manual > faff.run manual | |
| VO2max | Apple Watch HK > Garmin | Separate trends, never merged |
| Run power | Stryd > Apple Watch native > Garmin native | |

**External integrations.**
- **Apple HealthKit** (read+write): activities, HRV, RHR, sleep, body comp, VO2max. Background delivery + observer queries.
- **Strava** (read+write): activities in/out. Write workouts with rich metadata (workout name from plan, optional coach analysis as private description). Use `faff:` external_id prefix to break the self-upload webhook loop. Rate limits 100/15min, 1000/day.
- **Garmin Connect** (read+write): daily metrics + push planned workouts to user's Garmin device. Requires Health/Activity API approval (B2B legal-entity step). HealthKit fallback recommended if approval lags.
- **Coros** (read+write): similar shape to Garmin.
- **Whoop** (read-only): recovery, strain, sleep, HRV. Webhook-driven.
- **Oura** (read-only): readiness, sleep, HRV, body temp. Polling.
- **Stryd** (read-only): via HealthKit or Garmin.

**Conflict resolution.** Auto-pick by source priority for biometrics. For activities, dedupe by (start_time ± 30s, distance ± 100m, duration ± 60s). User-set primary source can override per data type in Settings.

**Offline.** Watch caches today's workout + queues activities until paired. Phone caches today's workout, recovery score, and last 30 days of activity. Coach chat requires connection.

**Source.** D3.

---

### Coach LLM

**Model.** Anthropic Claude Sonnet 4.6 for chat + analysis + insights. Claude Haiku 4.5 for intent detection, summarization, output validators. Anthropic prompt caching is the cost lever — pinning the system prompt + user state + retrieved KB chunks gives 90% input discount on cache hits.

**Retrieval.** Hybrid: BM25 keyword + Voyage-3-large dense embeddings + Cohere rerank-v3 + RRF fusion. KB stored in pgvector (Postgres extension). Intent-gated — not every message triggers retrieval. Chunks are KB doc sections (~500-1000 tokens), with the full KB INDEX always pinned so the model can look up doc-level context.

**Voice.** System prompt template with embedded few-shot examples drawn from the brand voice principles in APP_FEATURE_SPEC. Direct. Honest. No emoji. Coach voice format: "WHY" / "FOCUS" / "BACK OFF IF" labels for inline blocks. Output validator (Haiku-backed) flags responses that drift sycophantic or vague before they reach the user.

**Safety / hallucination.** Five layers: (1) retrieval-grounded responses for factual claims, (2) explicit "not a doctor" hedge on prescriptive medical advice, (3) refusal rules for diagnosis or "safe to run on" calls for stress fractures and similar, (4) citations to KB doc sections for any prescription, (5) an output validator that checks for unsupported numerical claims.

**Insight surfacing.** Insights run on a daily batch + on-demand triggers. Each insight has trigger criteria, confidence (high/med/low), action class (observe / consider / act), frequency cap, and dismiss/snooze. Default budget: max 3 push notifications/day, max 2 insight pushes/week. Plan mutations remain user-initiated even when the coach proposes; same-day heat/AQI exceptions can auto-shift workouts.

**Cost.** ~$4/active-user/month average at ~6 turns/day with cache hits. Heavy users $8-10. The cost lives in cache misses (first call of the day, post-deploy).

**Privacy.** No PII other than what the user signs up with. User data is sent to Anthropic for inference — opt-out toggle in Settings disables LLM features entirely. Region pinning (US) on the API.

**Source.** D4.

---

### Watch active workout

**Hero screen layout (single screen, no swipe required mid-run).**

```
┌─────────────────────────┐
│ MILE 3 OF 5 · THRESHOLD │  ← interval banner (small caps, color = phase)
│                         │
│      6:42               │  ← current pace (display font, max size)
│      /mi                │
│   ▼ 7 sec               │  ← target delta (color: green on / yellow drift / red off)
│                         │
│   3.21mi  21:34  168bpm │  ← distance / time / HR (small, edge)
│                         │
│ NEXT: 90s recovery      │  ← next interval preview (bottom)
└─────────────────────────┘
```

**Always-On Display.** Pace stays huge; target delta + interval banner visible. HR tile dims. Updates throttle to 1 Hz.

**Audio cues.** Coach voice TTS. Interval transitions ("threshold, 3 minutes, go"), 30-second-warning before each transition, mile splits with pace, halfway in long intervals, finish line.

**Haptic patterns.**
- Single tap: mile split / lap
- Double tap: interval transition (1s before audio cue)
- Triple tap: halfway in current interval
- Long buzz: off-target for ≥30s
- Quadruple tap: workout complete

**Structured intervals.** Auto-advance based on distance OR time, whichever the workout specifies. Manual lap button overrides. Pause auto-detects at stops (>10s of stationary). End-workout requires confirmation hold to prevent accidental termination.

**Outdoor readability.** Display font (Oswald/Headliner) at max possible size. 100% white on l0 black for current pace. Color targets: success green / caution yellow / warning red use the faff.css tokens.

**WorkoutKit.** Use Apple's native WorkoutKit for structured workouts (watchOS 9+). Custom rendering on top for faff.run-branded labels. Falls back to "free run" if workout structure is unavailable.

**Battery.** GPS at standard accuracy + AOD off by default; user toggles AOD-on for shorter workouts. Below 30% battery, auto-suggest disabling AOD and dropping to balanced GPS.

**Source.** D2.

---

## Web surfaces (1–20)

The web app is the planner and analyzer. 1440px design, dark theme, faff.css design system.

### 1. Overview (default web landing)

**Job.** Where am I, what am I doing today, how am I doing — answered in <5 seconds.

**Hero.** Identity badge with phase + status one-liner. Today's workout card. Recovery score with one contributing factor. This-week strip (7 days, status colors).

**What's on it.**

| Element | Priority | Source | KB ref |
|---|---|---|---|
| Greeting + name (huge display) | must | app | — |
| Phase badge (Base/Build/Peak/Taper/Race Week/Recovery/Off-season) | must | app-computed (plan) | 00a |
| Status one-liner ("Day 12 of 16 in Build") | must | app-computed | 00a |
| Today's workout card (type, distance/duration, paces, why, send-to-watch) | must | app-computed (plan + VDOT) | 04, 01 |
| Recovery score 0–100 + band + top contributor | must | app-computed | 00b, 15, D1 |
| This week 7-day strip | must | app-computed (plan vs. activity) | 22 |
| Mileage logged / prescribed | must | app-computed | 22 |
| Goal race countdown + race name + days remaining | should | user-input + app | 02, 08 |
| Conditions card for today (weather, suggested shoe, optimal time window) | should | weather-API + app | 06, 17 |
| Recent runs (last 3, with reconciliation badge) | should | activity reconciliation | 04 |
| Coach insight (when triggered, otherwise hidden) | should | coach-LLM | — |
| Quick actions strip (log feel, move workout, see tomorrow, open coach) | should | app | — |
| Volume context (4-week avg + 12-week sparkline) | nice | app-computed | — |
| Easy/hard ratio bar | nice | app-computed | 00a |

**Conditional states.**
- **Race week (≤7 days):** countdown becomes the dominant block (orange greet-hl). Today's prescription is taper-framed. Race plan teaser (pacing strategy, fueling plan, weather forecast for race day) replaces the goal race card. Logistics checklist appears.
- **Post-race (≤14 days):** post-race recovery countdown replaces today's workout. Race recap teaser. "What's next" — next race or maintenance plan suggestion.
- **Active injury:** injury status card replaces recovery score with return-to-run protocol stage. Today's prescription is the protocol's prescribed activity (walk-run, cross-train, full rest).
- **Off-season / no plan:** today's workout card swaps to "no plan — run easy or use plan builder." Volume trend becomes hero.

**Coach voice example (Build phase, mid-week):**
> WHY · You've absorbed last weekend's long run. Today is general aerobic — keep effort easy and let the legs reload before Thursday's threshold session.

**Build notes.**
- Backend: User, Plan, Workout, Activity, ReadinessScore, CoachInsight, weather provider integration.
- Frontend: Real-time recovery score subscription, plan adherence calc, 7-day strip with status colors, conditional layout switcher.
- Depends on: Recovery score algorithm (D1), plan + workout data, coach insight pipeline.

---

### 2. Training (calendar)

**Job.** See my plan, edit it, understand the structure.

**Hero.** Cycle header (plan name, target race, weeks remaining, current phase, completion %). Multi-week calendar grid with planned + actual side-by-side per day.

**What's on it.**

| Element | Priority | Source | KB ref |
|---|---|---|---|
| Cycle header (plan, race, weeks, phase, completion %) | must | app-computed | 22 |
| Week-row with mileage planned vs. actual + key workout | must | app-computed | 22 |
| Day cell (workout type pill, distance, status, pace target) | must | app-computed | 04, 01 |
| Day-detail drawer on click (full workout, fueling, conditions, notes) | must | app-computed | 04 |
| Drag-to-reschedule | must | app | — |
| Plan-level actions (regenerate from here, shift cycle, swap plan) | should | app + coach | 22 |
| Phase coloration (base/build/peak/taper distinct) | should | app | 00a |
| Adherence percentage | should | app-computed | — |
| Compliance heat-map (last 12 weeks) | nice | app-computed | — |
| Lock a date (don't let the regenerator move it) | nice | app | — |

**Conditional states.**
- **Race week:** week-row becomes the focus, taper visualization. Long run greys out (replaced by tune-up).
- **Post-race:** active cycle ends; show recovery week + transition into next cycle.

**Build notes.**
- Backend: Plan versioning, plan-modification audit trail, locked-date support.
- Frontend: CSS-grid calendar at multiple zoom levels (week / 4-week / cycle), drag-and-drop, conflict detection.
- Depends on: Plan Builder (#17) for regenerate-from-here.

---

### 3. Workout Detail (web)

**Job.** Show me what I'm about to do, why, and let me execute it.

**Hero.** Workout name, type, distance/duration, target paces. Coach voice "WHY" block. Big "Send to Watch" button.

**What's on it.**

| Element | Priority | Source | KB ref |
|---|---|---|---|
| Workout name + type | must | app-computed | 04 |
| Structure: warmup, main set, cooldown, with paces (range or single, see KB) | must | app-computed | 04, 01 |
| Coach "WHY" block (1-2 sentences) | must | coach-LLM | 00a, 04 |
| Send-to-Watch button | must | app | D3 |
| Send-to-Garmin button (if connected) | should | app | D3 |
| Conditions card (weather, optimal time window, route suggestion, indoor alternative) | should | weather + app | 06 |
| Suggested shoe (from active rotation) | should | app-computed | 17 |
| Fueling plan (if duration warrants — 75min+) | should | app-computed | 18, 19 |
| History of this workout (past attempts, fastest, average) | should | app-computed | — |
| Audio queue preview ("hear how the coach guides you") | nice | coach-TTS | — |
| Predicted recovery time post-workout | nice | app-computed | 00b |
| "WHAT IT BUILDS" coach block (physiological adaptation) | nice | KB-derived | 00a, 04 |
| Variation alternatives (easier/harder if user can't do prescribed) | nice | coach-LLM | 04 |

**Conditional states.**
- **Bad weather forecast for the optimal window:** conditions card shows alternative time windows or treadmill conversion (with pace adjustment per KB doc 06).
- **Heat warning (WBGT >27°C predicted):** auto-prompt to shift workout to early morning OR adjust paces with explicit warning. Coach LLM proposes; user confirms.

**Coach voice example (threshold workout):**
> WHY · You're three weeks from race-specific work. This builds the lactate clearance you'll need to hold marathon pace into the late miles.
> FOCUS · Settle into the threshold pace by mile 2 of the main set. Don't chase the bottom of the range.

**Build notes.**
- Backend: WorkoutTemplate, FuelingPlan, weather provider, route suggester.
- Frontend: Pace pill components, send-to-watch flow with confirmation state.
- Depends on: Coach LLM (D4), pace calculation (#5), shoe rotation (#18).

---

### 4. Workout Library

**Job.** Browse every workout type the coach can prescribe. Reference + "try this."

**Hero.** Grid of workout templates (cards). Filter strip on top.

**What's on it.**

| Element | Priority | Source | KB ref |
|---|---|---|---|
| Filter strip (purpose, duration, distance, equipment) | must | — | — |
| Workout card (name, structure summary, paces calc'd from VDOT, purpose) | must | KB + app-computed | 04, 01 |
| Detail drawer / full workout view | must | app-computed | 04 |
| "Try this" button (slot into plan or one-off) | should | app | — |
| Audio walkthrough (per workout type) | nice | coach-TTS | 04 |
| Use cases (when in cycle, by race distance) | nice | KB-derived | 04, 22 |

**Build notes.**
- Backend: WorkoutTemplate seeded from KB doc 04, slot-into-plan API.
- Frontend: Card grid, filter UI.
- Depends on: Pace zones (#5), Plan (#2).

---

### 5. Pace Zones / VDOT

**Job.** Show training paces, where they came from, recalibrate.

**Hero.** VDOT number (huge). Race time predictions across all distances. Pace zone table (E/M/T/I/R + Pfitz + McMillan + Hansons).

**What's on it.**

| Element | Priority | Source | KB ref |
|---|---|---|---|
| Current VDOT (huge display number) | must | app-computed | 01 |
| Source race + date (which race calibrated this) | must | app | 02 |
| Race time predictions (1500m / 5K / 10K / HM / Marathon) | must | app-computed | 02 |
| Pace zone table (E, M, T, I, R from Daniels) | must | app-computed | 01 |
| System cross-walk (Daniels ↔ Pfitz ↔ McMillan ↔ Hansons) | should | KB | 01 |
| Recalibrate button (input new race time → recalc) | must | app | 01 |
| HR zones (linked to VDOT, optional) | should | app | 03 |
| Last calibration date | must | app | — |
| Pace adjustment for terrain / weather (small tool) | nice | app-computed | 06, 11 |

**Build notes.**
- Backend: VDOT calc service, race-time prediction (Riegel + Daniels formulas).
- Frontend: Big-number layout, recalibration form.
- Depends on: Race results (#9), pace formula library.

---

### 6. Phase view

**Job.** Where am I in periodization, what's it building, what to watch for.

**What's on it.**

| Element | Priority | Source | KB ref |
|---|---|---|---|
| Current phase label (huge) + days into / remaining | must | app | 00a |
| What this phase builds (physiological one-liner) | must | KB | 00a |
| Workout emphasis breakdown (% easy, threshold, VO2, etc.) | should | app-computed | 00a |
| Phase timeline (visual, current + adjacent phases) | should | app | 00a |
| What to watch for (overreaching signs, deload timing) | should | KB-derived coach | 00b, 00a |
| Cross-link to workouts in this phase | nice | — | — |

**Build notes.** Mostly read-only display. Lives within Training tab. Reuses Phase Bar component.

---

### 7. Strength

**Job.** Programmed strength sessions matched to the running cycle phase.

**What's on it.**

| Element | Priority | Source | KB ref |
|---|---|---|---|
| Today's strength session (if scheduled) | must | app-computed | 07 |
| Weekly strength layout | must | app-computed | 07 |
| Exercise library with form video links | must | KB + content | 07 |
| Set/rep/weight tracking (per exercise) | must | user-input | 07 |
| Periodized programming visible (heavy/power/maintenance phase) | should | KB | 07 |
| Equipment-aware variations (cable trainer / bodyweight / barbell) | should | app-computed | 07 |
| RPE per set | should | user-input | 05, 07 |
| Comparison to last session | nice | app-computed | — |

**Build notes.**
- Backend: StrengthSession, Exercise, Set entities. Cable-trainer programming maps to Amp-style devices (5-100 lb electromagnetic, fixed/band/eccentric/tempo modes) per KB doc 07.
- Frontend: Set tracker, video embed.

---

### 8. Races (calendar)

**Job.** Past, current, future races in one timeline.

**What's on it.**

| Element | Priority | Source | KB ref |
|---|---|---|---|
| Past races list (date, name, distance, finish time, place, A/B/C achieved) | must | app | 02 |
| Upcoming races list (date, name, distance, days out, goal time, training cycle status) | must | app | — |
| Add race button (prominent) | must | — | — |
| Filter (year, distance, status) | should | — | — |
| Year-view toggle (multi-year archive) | should | — | — |
| Predicted finish for each upcoming race (based on current VDOT) | should | app-computed | 02 |
| Course profile teaser per race | nice | external-route-data | 11 |
| PR per distance highlighted | nice | app-computed | — |

---

### 9. Race Detail — Past

**Job.** Full forensic recap of one race.

**Hero.** Race name + finish time (huge). A/B/C goal achievement banner. Splits chart.

**What's on it.**

| Element | Priority | Source | KB ref |
|---|---|---|---|
| Header (name, date, finish, place, age-group rank) | must | app | — |
| Splits table (mile or 5K, with pace, HR, elevation, cadence) | must | activity | 04 |
| Pace chart with markers (fueling, conditions changes, terrain) | must | activity + user-input | — |
| Performance vs. A/B/C goals | must | app | 02 |
| Conditions (temp, humidity, wind, dewpoint, WBGT) | must | weather | 06 |
| Heat-corrected equivalent time | should | app-computed | 06 |
| Coach analysis (what worked, what didn't, what to learn) | must | coach-LLM | 08, 04 |
| Fueling log (what was consumed, when) | should | user-input | 18 |
| Comparison to predicted time (Riegel/VDOT) | should | app-computed | 02 |
| Pacing analysis (positive/negative/even split, intentional?) | should | app-computed | 08 |
| Sleep / HRV last 7 days leading in | should | wearable | 00b |
| Equipment (shoes worn, kit) | should | app | 17 |
| Pre-race notes / post-race reflection | should | user-input | — |
| Photos | nice | user-input + race-photo-service | — |
| Strava / Garmin link | nice | external | D3 |
| Compare to previous attempts at the distance | nice | app-computed | — |

**Coach voice example (post-marathon):**
> YESTERDAY · You held within 2% of goal pace through 32K. The wall came at 35K, exactly where the HR-drift curve predicted at this fitness. The fade isn't a fueling failure — it's a 3-week-late training stimulus.

---

### 10. Race Detail — Upcoming

**Job.** Plan and prepare for one upcoming race.

**Hero.** Race name + countdown (huge). A/B/C goal cards. Course profile preview.

**What's on it.**

| Element | Priority | Source | KB ref |
|---|---|---|---|
| Race name + date + days remaining | must | user-input | — |
| Countdown (large) | must | app | — |
| A/B/C goals (with predicted times based on current fitness) | must | app-computed + user-input | 02 |
| Course profile + elevation chart | must | external-route-data + KB | 11 |
| Weather forecast (with goal pace adjustment) | must | weather + KB | 06 |
| Fueling plan (pre-race nights, race morning, during) | must | KB-derived + user-input | 18 |
| Pacing strategy (mile-by-mile or 5K-by-5K, terrain-aware) | must | KB-derived + coach | 08 |
| Race week schedule (taper plan, day-by-day) | must | KB + app-computed | 08 |
| Logistics checklist (travel, hotel, gear list, kit) | should | user-input | 12 |
| Bib number, corral, start time | should | user-input | — |
| Training cycle status (weeks completed, peak workout completion) | should | app-computed | — |
| Last workout check-in | should | app | — |
| Sleep / HRV trends entering race | should | wearable | 00b |
| Carb-load tracker | should | user-input | 18 |
| Travel / timezone plan | should | user-input | 12 |
| Bathroom strategy (the unglamorous reality) | nice | KB | 08 |
| Spectator share-link | nice | app | — |

**Coach voice example (3 days out, calm conditions):**
> FOCUS · Forecast holds — 12°C, light wind. Goal pace stays 7:24. You've banked 18 miles at MP this cycle. Trust the work.

---

### 11. Race Goal Calculator

**Job.** Given current fitness + race conditions, what's a realistic A/B/C goal?

**What's on it.**

| Element | Priority | Source | KB ref |
|---|---|---|---|
| Current VDOT (auto-fill) | must | app | 01 |
| Distance picker | must | — | — |
| Date / weather forecast | must | weather | 06 |
| Course profile (manual or import) | must | user-input + external | 11 |
| Predicted finish time + range | must | app-computed | 02 |
| A/B/C goal recommendation | must | app-computed | 02 |
| Comparison to current PB | should | app | — |
| Required training adjustments to hit A goal | nice | coach-LLM | 22, 00a |

---

### 12. Health (recovery dashboard)

**Job.** Today's recovery snapshot — body state at a glance.

**Hero.** Recovery score expanded. HRV / RHR / Sleep tiles in a row. Subjective check-in prompt (if not yet done today).

**What's on it.**

| Element | Priority | Source | KB ref |
|---|---|---|---|
| Recovery score 0–100 + band + 3 contributing factors | must | app-computed | D1, 15 |
| HRV tile (today, 7-day, 60-day baseline, LnRMSSD with smallest worthwhile change) | must | wearable | 15 |
| RHR tile (today, 7-day, 60-day baseline) | must | wearable | 15 |
| Sleep last night (duration, efficiency, debt — 7-day rolling deficit) | must | wearable | 00b |
| Subjective inputs prompt (energy, soreness, mood, motivation — 1-5 each) | must | user-input | 00b |
| Training load (CTL/ATL/TSB or ACWR — flag as directional, not deterministic) | should | app-computed | 15, 00a |
| Coach's read (1-2 sentence narrative) | must | coach-LLM | 00b |
| Body composition tile (weight trend) | nice | wearable + scale | — |
| VO2max estimate trend | nice | wearable | 14 |
| Cardiac drift over last long run | nice | activity | 03 |
| Active injury status (if any, with return-to-run protocol stage) | conditional | user-input + KB | 05 |

**Sub-pages (linked from Health hub):**
- **Sleep Detail** — duration trend (28-day, 90-day), stages, bedtime/wake consistency, debt, correlation with training quality.
- **Body Composition** — weight, body-fat %, lean mass trends. Privacy-first (opt-in, dedicated tier — see C4 privacy classes).
- **Nutrition & Fueling** — daily macros, protein vs. target (1.6-2.0 g/kg), hydration, sodium, caffeine, supplement stack, fueling-plan adherence on long runs, race carb-load tracker. KB-grounded reference ranges (KB 18, 19).
- **Injuries & Body Map** — interactive front/back diagram, tap to log soreness/pain (0-10), pain trends per body part, active injury timeline + return-to-run protocol stage. KB doc 05.
- **Biometric Trends** — HRV/RHR/sleep/VO2max/training load, source attribution per metric.
- **Lab Results & Bloodwork** — iron/ferritin (athlete reference ranges), vit D, B12, testosterone, thyroid, lipid, CRP. Athlete-specific thresholds (ferritin >50 replete, vit D 30-50 ng/mL, DEXA Z ≤ -1.0 = low-for-athlete).
- **Recovery Modalities Log** — sauna, cold plunge, contrast, massage, compression, IV. Each with frequency/duration/temp. Evidence-tier badges (A-D) per modality (KB 00b).
- **Cycle tracking (sex-specific)** — phase, symptoms, predicted impacts. Honest about the McNulty 2020 weak-evidence verdict — cycle-phase periodization is N=1 hypothesis, not coach prescription. KB 13.

**Conditional states.**
- **Active illness flag (RHR ↑ + HRV ↓ + temp deviation):** coach explicitly recommends rest. Today's workout greys with "consider rest" override.
- **First 7 days of data:** Recovery score is "calibrating" — show contributing tiles only.

**Coach voice example (HRV down 3 days):**
> BACK OFF IF · HRV is 1.8 SD below your 60-day baseline for the third straight morning. RHR is steady, sleep is fine, no illness signs — but the pattern says incomplete recovery from last weekend's long run. Today's threshold becomes general aerobic. Reassess tomorrow.

---

### 13. Log (activity feed)

**Job.** What I've done, ordered by recency. Auto-logged.

**What's on it.**

| Element | Priority | Source | KB ref |
|---|---|---|---|
| Reverse-chronological feed (runs, strength, recovery activities, notes, coach insights) | must | mixed | — |
| Each entry: type, date, key stats, status (matched/unplanned/missed) | must | app-computed | — |
| Filter by type / date / distance / pace / shoe / route | should | — | — |
| Search across notes | should | — | — |
| Quick-add note button (free-form, voice-to-text) | should | user-input | — |
| Photos and notes journal (#tagged) | should | user-input | — |
| Export (GPX, CSV, JSON) | should | — | — |

---

### 14. Run Detail

**Job.** Full breakdown of one run, with workout reconciliation.

**Hero.** Map (auto from GPS). Hero stats (distance, duration, avg pace, avg HR). Workout reconciliation badge.

**What's on it.**

| Element | Priority | Source | KB ref |
|---|---|---|---|
| Map (GPS trace) | must | activity | — |
| Hero stats (distance, time, avg pace, avg HR, elevation gain, calories) | must | activity | — |
| Splits table (auto laps + manual lap markers) | must | activity | 04 |
| Pace chart (with prescribed pace overlay if planned) | must | activity + plan | 04 |
| HR chart with zone bands | must | activity | 03 |
| Elevation chart | should | activity | 11 |
| Cadence chart | should | activity | 16 |
| Power chart (if Stryd or watch native) | nice | activity | 15 |
| Vertical oscillation / GCT / vertical ratio | nice | activity | 16 |
| Weather conditions (auto-pulled from time + location) | must | weather | 06 |
| Heat-corrected pace equivalent | should | app-computed | 06 |
| Shoe worn (auto from rotation, user-confirmable) | should | app-computed | 17 |
| Subjective feel rating (CR-10 0-10 slider, prompted post-sync) | must | user-input | 05 |
| Notes (text + voice-to-text) | must | user-input | — |
| Workout reconciliation: target paces hit? volume hit? structure followed? | must | app-computed | 04 |
| Coach analysis (1-3 sentences, references the data) | must | coach-LLM | 00a, 04 |
| Linked workout from plan (one-tap to plan context) | should | app | — |
| Source attribution (Watch / Garmin / Strava) | should | app | D3 |
| Compare to similar past runs | nice | app-computed | — |
| Cardiac drift analysis (long runs) | nice | app-computed | 03 |
| Music played (if Apple Music integrated) | nice | external | — |
| Strava segments / Strava upload status | should | external | D3 |

**Coach voice example (easy run hit prescribed):**
> NICE · Held the easy zone the whole way, HR drifted 4bpm late — fine for warm conditions. Recovery should be quick.

---

### 15. Coach (chat)

**Job.** Ask the coach anything; get a contextual answer grounded in the user's data + KB.

**What's on it.**

| Element | Priority | Source | KB ref |
|---|---|---|---|
| Chat conversation pane (text + inline data references) | must | coach-LLM | — |
| Voice input (hold to speak, transcribed) | must | speech-to-text | — |
| Voice output (TTS playback for short replies) | should | TTS | — |
| Suggested questions (context-aware: "How's recovery today?" / "Should I run?" / "What pace tomorrow?") | should | coach-LLM | — |
| Inline data references (charts, runs, plans rendered inline in replies) | should | app | — |
| Conversation history (searchable, archived) | should | app | — |
| Topic threading (group by goal/race/injury) | nice | app | — |
| "Save this answer" → notes | nice | app | — |
| "Apply this suggestion" → modify plan / log subjective state | nice | app + coach | — |
| Coach personality dial (Direct ↔ Encouraging — restrained scope) | nice | app | — |
| Citation surfacing (which KB doc backs the answer) | should | coach-LLM | — |
| Latency indicator (streaming response) | must | — | D4 |
| Privacy indicator (what data was sent, link to opt-out) | should | — | D4 |

---

### 16. Insights

**Job.** Surface patterns the user can't see themselves.

**Top insight kinds (selected from C6's 41-item list).**

| Insight | Trigger | Confidence | Action |
|---|---|---|---|
| Easy pace improvement at same HR | 8-week trend | high | observe |
| HRV trend declining | 5+ days below baseline | high | consider |
| Volume jump warning (ACWR > 1.5) | weekly | med | consider |
| Plan adherence high | 4-week >90% | high | observe |
| Long runs faster than prescribed | 4 of 5 weeks | med | consider |
| Predicted race-time trajectory | weekly during plan | high | observe |
| Best-time-of-day for HR/pace | rolling, 30+ runs | med | observe |
| Heat impact on pace | recurring | med | observe |
| Cardiac drift trend | last 5 long runs | med | consider |
| Sleep debt impact on workouts | 14-day correlation | med | act |
| Illness watch (RHR ↑ + HRV ↓ + subjective ≤ 2) | composite | high | act |

**Insight properties.** Each insight is logged with: trigger, confidence, action class, frequency cap, dismiss/snooze, surface (Insights page / Today card / push / silent). Default budget: max 1-2 insight pushes/week.

**Build notes.** Insight pipeline runs daily as a batch + on-demand at sync time. Coach LLM generates insight prose from rule-based triggers; rules don't trigger from prose. (D4.)

---

### 17. Plan Builder

**Job.** Generate or modify a training plan.

**Wizard inputs.**

| Input | Required | Source |
|---|---|---|
| Goal (race name, distance, date, target time / "general fitness") | must | user |
| Current fitness (recent race, VDOT, or field test) | must | app + user |
| Days/week available | must | user |
| Max long run cap | should | user |
| Must-skip days (work, travel) | should | user |
| Equipment (Apple Watch only / + Garmin / + Stryd) | should | user |
| Strength training preference (yes/no/days) | should | user |
| Cross-training preference | nice | user |
| Plan template (Pfitzinger / Hansons / Daniels / custom) | should | user |
| Plan length (12 / 16 / 18 / 20 / 24 weeks) | must | user |

**Output.** Plan preview week-by-week with phase breakdown, predicted race time at completion, confidence indicator, warnings (volume jumps, conflicts with race calendar), customize affordances.

**Build notes.**
- Backend: Plan templates seeded from KB doc 22; PlanGenerator service that takes inputs + KB and outputs a cycle of Workouts.
- Frontend: Multi-step wizard, plan preview with editable cells.
- Depends on: VDOT (#5), Workout Library (#4), KB doc 22.

---

### 18. Gear

**Job.** Track shoes, equipment, fueling inventory.

**What's on it.**

| Element | Priority | Source | KB ref |
|---|---|---|---|
| Active shoe rotation (mileage on each, replacement reminder per KB) | must | app + user | 17 |
| Shoe history / archive (retired with lifetime mileage, avg pace, avg feel) | should | app | — |
| Per-shoe analytics (preferred pace range, weather, route) | should | app-computed | 17 |
| Other equipment (watches, HR straps, headphones, vests, GPS pods) | should | user | — |
| Fueling product inventory (gels, drink mix, expiration tracking) | should | user | 18 |
| Reorder reminders | nice | app | — |
| Wishlist | nice | user | — |
| Reviews / notes per item | nice | user | — |
| Cost tracking | nice | user | — |

---

### 19. Routes

**Job.** Saved routes, route library, suggestions.

**What's on it.**

| Element | Priority | Source | KB ref |
|---|---|---|---|
| Saved routes (favorites, name, distance, elevation, surface) | must | user | — |
| Route library (suggestions by distance/terrain/time of day) | should | app + external | — |
| Strava segment integration (PR per segment) | should | external | D3 |
| Weather-aware suggestions (shaded for hot, sheltered for windy) | should | weather + KB | 06 |
| Route generator (Komoot / Strava integration) | nice | external | — |
| Pace per-route history (controlling for course/season) | nice | app-computed | — |
| Route safety flags (lighting, traffic, isolation) | nice | user | — |
| Route sharing | nice | external | — |

---

### 20. Settings

**Job.** Account, integrations, preferences.

**What's on it.**

| Element | Priority | Source |
|---|---|---|
| User profile (age, sex, height, weight, body comp targets) | must | user |
| Fitness baselines (VDOT, max HR, LTHR, sweat sodium) | must | user + app |
| Training preferences (units mi/km, time format, week start, easy pace target style) | must | user |
| Wearable connections (status, last sync, reconnect) | must | app + external |
| Service connections (Strava, HealthKit, Garmin, Coros, Whoop, Oura) — granular permissions | must | OAuth |
| Notification preferences (per category, quiet hours, race-day mode override) | must | user |
| Coach personality (Direct ↔ Encouraging dial; LLM opt-out) | should | user |
| Privacy (data sharing, analytics opt-out, LLM provider opt-out) | must | user |
| Subscription (minimal — single user) | nice | — |
| Data export (GPX, CSV, JSON) | should | app |
| Account management (email, password, sign-out, delete) | must | user |

---

## iOS surfaces (21–29)

The phone is the daily companion and bridge. Glanceable, push-driven, quick-capture. Same brand as web.

### 21. Today (default landing)

**Job.** What am I doing today, how am I doing — answered in <2 seconds.

**What's on it.**

| Element | Priority | Source |
|---|---|---|
| Greeting + status badge | must | app |
| Today's workout card (prominent — what's prescribed, big "Send to Watch") | must | app + plan |
| Recovery score hero (single number, trend arrow) | must | app-computed |
| Coach's daily message (one-liner) | must | coach-LLM |
| Weekly progress (small bar, "X of Y miles") | should | app-computed |
| Quick action strip (log feel · move workout · see tomorrow · open coach) | should | app |
| Conditions for today (weather, suggested shoe, optimal time) | should | weather + app |

Conditional layouts mirror web Overview.

---

### 22. Plan (calendar swipe)

**Job.** See plan on the go, edit lightly.

**What's on it.**

| Element | Priority | Source |
|---|---|---|
| Week-at-a-glance, swipe between weeks | must | app |
| Each day: planned workout pill + status | must | app |
| Tap day → workout detail | must | app |
| Long-press day → quick actions (move, swap, skip) | should | app |
| Mileage progress bar (top) | should | app-computed |
| Phase indicator strip | should | app |

Heavy editing defers to web (#2).

---

### 23. Workout Detail (iOS)

**Job.** Pre-workout briefing on phone, push to watch.

**What's on it.** Mirror of web (#3) with mobile layout. Big "Send to Watch" CTA dominant. Audio preview button. Fueling plan card if duration warrants.

---

### 24. Run Recap (auto-shown post-sync)

**Job.** "Just finished a run — show me how it went" — auto-prompted via push.

**What's on it.**

| Element | Priority | Source |
|---|---|---|
| Push notification trigger ("Nice work. 6.2 mi at 7:42/mi avg. Tap for recap.") | must | app |
| Hero stats (4-5 numbers: distance, time, avg pace, avg HR) | must | activity |
| Pace chart with prescribed pace overlay (if planned) | must | activity + plan |
| Workout reconciliation badge (one-line verdict) | must | app-computed |
| Coach voice analysis (1-2 sentences) | must | coach-LLM |
| Subjective feel prompt (CR-10 slider, primary CTA) | must | user |
| Photo / note / share buttons | should | user |
| "See full detail" → web-equivalent | should | app |

iOS Recap is intentionally tight — 30 elements per C5 — and centered on the subjective rating capture as the load-bearing primary CTA before the user puts the phone down.

---

### 25. Coach Chat (iOS)

**Job.** Ask the coach a quick question.

**What's on it.** Same as web (#15) optimized for phone. Voice input prominent (hold to speak). Quick-tap suggested questions context-aware. Inline data references where helpful.

---

### 26. Health (iOS)

**Job.** How's my body today.

**What's on it.** Mobile-condensed of web Health (#12). Recovery score detail, HRV/RHR trends (last 30 days), sleep last night, body composition, body map for injury logging (touch-optimized), quick logs (sauna, massage, recovery activity).

---

### 27. Races (iOS)

**Job.** What's coming up, how did the last one go.

**What's on it.** Mobile-condensed of web Races (#8-#11). Upcoming race countdown card prominent if race ≤30 days. Tap any race for detail. Race day mode separate (#28).

---

### 28. Race Day Mode

**Job.** Active during a race — guide me.

**What's on it.**

| Element | Priority | Source |
|---|---|---|
| Live splits | must | activity |
| Pace vs. target | must | app-computed + plan |
| HR vs. plan ceiling | must | activity + plan |
| Distance to next aid station / fueling reminder | must | course + plan |
| Spectator share-link (live tracking) | should | app + external |
| Phone fallback if Watch fails | should | app |
| Auto-activates via geofence + scheduled gun time | must | app |
| Auto-handoff to Race Detail (Past) within 60s of finish | must | app |

Watch is primary mid-race; phone is secondary screen for spectator share + fallback.

---

### 29. Settings (iOS)

Mobile version of web Settings (#20). Wearable connections, notification preferences (granular), watch app settings, subscription, data export, sign out.

---

## Apple Watch surfaces (30–34)

The execution layer. Reductive. Audio + haptic over visual.

### 30. Today

**Job.** What am I doing, let me start it.

**What's on it.** Today's prescribed workout, single screen. Big "Start" button. Mini stats: distance / duration / target pace. Swipe down for quick alternatives ("Easy 4 mi" / "Rest").

### 31. Active Workout (the hero)

**Job.** Guide me through this run.

See **Architecture decisions → Watch active workout** above for full spec. Single hero screen, audio + haptic cues, structured-interval auto-advance.

### 32. Quick Log

**Job.** Log something not auto-tracked.

**What's on it.** Type selector (Strength / Bike / Swim / Yoga / Other). Duration. Subjective effort (1-10). Optional voice note. Saves to Health.

### 33. Recovery

**Job.** Quick check on my recovery and today's plan.

**What's on it.** Recovery score (single number + color band). HRV last night. Sleep duration. Coach's one-line read. "Force rest" button.

### 34. Coach (voice)

**Job.** Ask the coach a question via voice.

**What's on it.** Hold to speak. Coach replies via audio + summary card on watch. Long answer? Text "see phone for detail."

---

## Extensions (35–38)

### 35. Live Activities

Five contexts, mutually exclusive at any moment:

| Context | When | Lock Screen | Dynamic Island |
|---|---|---|---|
| During-run | run active | current pace, distance, time, next interval | leading: pace · trailing: split |
| Race countdown | within 7 days of race | days · race name · readiness | leading: days · trailing: race name |
| Today's workout | morning of | type · distance · target pace | leading: type · trailing: time |
| Recovery score | morning sync | score · band · top contributor | leading: score · trailing: arrow |
| Race day mode | during race | live splits · target pace · next aid | leading: split · trailing: pace |

Recovery + Today's-workout are mutually exclusive before 9 AM (recovery wins on sync).

### 36. Widgets

Sizes × content:

- **Small:** today's workout (one-line) | recovery score | days to race | week mileage progress | tomorrow's workout teaser | last run quick stats
- **Medium:** today's workout detail | week progress + recovery | recovery + next race | upcoming workouts (next 3) | recent run + shoe
- **Large:** mini overview (today + week + recovery + next race) | full week-at-a-glance | health snapshot

Refresh policy: timeline budget, deep-link to relevant screen on tap. Streak widget exists; streak push notifications dropped (injury-risk pattern).

### 37. Siri Shortcuts

| Shortcut | Intent | Response |
|---|---|---|
| "Log how I feel" | open subjective check-in | voice rating capture |
| "What's my workout today?" | read today's workout aloud | TTS |
| "Send my workout to my watch" | push to watch | confirmation chime |
| "How am I doing?" | read recovery score + coach message | TTS |
| "Log a sauna session" | quick recovery activity log | voice confirmation |
| "Move today's workout to tomorrow" | plan modification with confirm | voice confirm |
| "What pace should I run?" | context-aware pace target | TTS |
| "Start my workout" | trigger watch start | confirmation |
| "What's the weather for my run?" | conditions readout | TTS |

### 38. Push Notifications

Categories with default-on/off and frequency caps:

| Category | Default | Cap |
|---|---|---|
| Workout reminder (morning of) | on | 1/day |
| Post-run prompt (rate that run) | on | 1/run |
| Recovery alert (HRV/RHR/sleep flag) | on | escalating |
| Plan adjustment (coach modified plan) | on | as-needed |
| Race countdown (7d/3d/2d/1d/morning) | on | 5/race |
| Coach insight | on | 2/week |
| Milestone / streak | OFF (widget only) | — |
| Service update (sync failure) | on | as-needed |
| Weather warning (heat alert) | on | as-needed |
| Shoe replacement reminder | on | 1/shoe |
| Recovery-week reminder | on | 1/week |
| Subjective state daily check-in | on | 1/day |
| Race day morning logistics | on | 1/race |
| Carb-load reminder (race week) | on | 3/race |

Quiet hours: 9pm–6am unless race-day mode. Time Sensitive interrupt only on red recovery alerts and race-day morning. Default opt-in is the 4 high-signal categories rather than all-on (per C8).

---

## Build sequence

### Phase 1 — Foundation (weeks 1–4)

**Goal:** core scaffolding for the training loop.

- Backend: User, Activity, Workout, Plan, HealthMetric, ReadinessScore entities. Auth. Sync infra.
- Backend: HealthKit integration (read+write workouts, HRV, RHR, sleep). Strava integration (read activities).
- iOS: Onboarding flow + Apple Health connection + Today screen scaffolding (recovery + today's workout cards).
- Watch: Project scaffolding, HealthKit pairing, Today screen showing prescribed workout.
- Web: Overview page (rebuilt per this plan, replacing existing hub.html with research-informed content).

**Definition of done:** A planned workout shows on web → phone → watch. The watch can start a basic run that syncs back to phone → backend → web. Recovery score computes from HRV/RHR/sleep with a baseline still in calibration.

---

### Phase 2 — Workout execution loop (weeks 5–8)

**Goal:** the loop that defines the product.

- Watch: Active Workout screen with structured intervals, pace targets, audio + haptic cues. WorkoutKit integration.
- iOS: Workout Detail + Send-to-Watch flow.
- Backend: Workout reconciliation logic (matching activity to prescribed workout — paces hit / volume hit / structure followed).
- iOS: Run Recap screen + post-sync push notification + subjective rating capture.
- Web: Run Detail page with reconciliation visualization.

**Definition of done:** Plan a structured workout on web → push to phone → execute on watch with audio/haptic guidance → recap on phone with reconciliation badge → analyze on web with coach voice. The full loop works for one user, end-to-end.

---

### Phase 3 — Planning depth (weeks 9–12)

- Web: Training Plan calendar (multi-week with planned + actual side-by-side, drag-to-reschedule).
- Web: Pace Zones / VDOT view (calibration foundation, recalibrate flow).
- Web: Workout Library.
- iOS: Plan calendar swipe view.
- Web: Plan Builder wizard (KB doc 22 templates).

**Definition of done:** User can build a plan from scratch via wizard, edit any workout, see all paces calibrated to their VDOT, and browse the workout library.

---

### Phase 4 — Race system (weeks 13–16)

- Web + iOS: Race Calendar.
- Web + iOS: Race Detail (Upcoming) with countdown, course profile, weather forecast, fueling plan, pacing strategy, taper schedule.
- Web + iOS: Race Detail (Past) with full forensic recap, splits, conditions, coach analysis.
- iOS + Watch: Race Day Mode (live splits, geofence auto-activate).
- Race Goal Calculator.

**Definition of done:** User can plan an upcoming race end-to-end, race it with phone+watch active during, and review a polished recap immediately after.

---

### Phase 5 — Health & recovery deep (weeks 17–20)

- Backend: HealthKit deeper (HRV, RHR, sleep, body comp, VO2max).
- Backend: Recovery score algorithm (D1).
- Web + iOS: Recovery Dashboard.
- Web: Sleep Detail, Body Composition, Biometric Trends.
- Web + iOS: Body Map / Injury tracking with return-to-run protocols (KB 05).
- iOS: Health quick logs (sauna, massage, recovery activity).
- Watch: Recovery glance screen + complication.
- iOS: Live Activities for during-run + race countdown.
- iOS: Widgets (small/medium/large).

**Definition of done:** Recovery score is trusted (calibrated, contributing factors visible). Injuries can be tracked from logging through return-to-run. Live Activities work during a run.

---

### Phase 6 — Coach & insights (weeks 21–24)

- Backend: Coach LLM integration with KB + user data (D4 stack).
- Web + iOS: Coach chat interface.
- Web: Insights page.
- Backend + iOS: Daily coach message integration on Today.
- Watch: Voice coach query.
- Coach proactive insight pipeline (rule-triggered, LLM-narrated).

**Definition of done:** Coach answers user questions with citations and tools. Insights surface when triggered, not as noise. Daily message lands on Today.

---

### Phase 7 — External integrations (weeks 25–28)

- Backend + iOS: Strava bidirectional sync (write completed workouts with metadata).
- Backend + iOS: Garmin Connect (push planned workouts to Garmin device).
- Backend + iOS: Coros sync.
- Backend + iOS: Whoop read-only sync.
- Backend + iOS: Oura read-only sync.
- Conflict resolution + dedup logic per D3.

**Definition of done:** All six integrations active. Source-of-truth hierarchy enforced. User can switch primary biometric source from Settings.

---

### Phase 8 — Ancillary (weeks 29–32)

- Web + iOS: Strength training view (with cable-trainer programming for Amp-style devices per KB 07).
- Web + iOS: Nutrition & Fueling (with race carb-load tracker).
- Web + iOS: Bloodwork tracking (athlete reference ranges).
- Web + iOS: Recovery Modalities Log.
- Web + iOS: Gear / Shoe rotation.
- Web + iOS: Routes.
- Web + iOS: Notes & Journal (#tagged, voice-to-text).
- Web + iOS: Settings deepening.

---

### Phase 9 — Platform polish (weeks 33–36)

- iOS: Siri Shortcuts.
- Watch: Complications (recovery, today's workout, days to race, week progress).
- Web: Share-out cards (race recaps, milestones).
- Apple Watch independent mode (workouts without phone, queue sync).
- Reduce Motion + VoiceOver across all surfaces.
- Performance pass.
- Public TestFlight (single-user is the goal, but TestFlight is the deployment vehicle).

---

## Open questions for the user

1. **Garmin / Coros API access.** These require legal-entity B2B approval. Worth the months-long process for a personal app, or accept HealthKit fallback for those wearables?

2. **Coach personality default voice.** "Direct" or "Encouraging" as the default position on the dial? My read: Direct, given the brand voice principles, but you may prefer the warmer default.

3. **Subjective wellness compliance.** Daily 4-tap check-in (energy/soreness/mood/motivation) only works if completed daily. Are you committed to logging? If not, drop the subjective modifier from the recovery score and treat it as opt-in only.

4. **iOS deployment.** TestFlight (single-user) sufficient, or do you want to publish to App Store eventually (in case you decide to go public)?

5. **LLM provider commitment.** Anthropic Claude is the recommended stack. Comfortable with that, or want to evaluate alternatives (OpenAI, on-device Apple Intelligence)?

6. **Race photo integration.** MarathonFoto / Sportograf / FinisherPix all have proprietary APIs. Defer to Phase 9 polish, or skip entirely?

7. **Strength equipment scope.** The Amp-style cable-trainer programming is built into the strength research. Do you actually own/plan to use such a device, or program for barbell / bodyweight only?

8. **Plan template starting point.** Pfitzinger-style is the implicit default in the KB. Do you want explicit support for Hansons, Daniels, Lydiard, Norwegian-singles, or just the one canonical method?

9. **Public Strava description default.** Coach analysis on Strava posts is opt-in per OAuth setup. Default to the analysis showing in description, or default off?

10. **Health data privacy tier.** Body composition, bloodwork, cycle tracking are independently togglable. Comfortable with all of them on by default, or prefer opt-in per category?

---

## File references

- Spec: `BuildResearch/APP_FEATURE_SPEC.md`
- Deep research: `D1-recovery-score-methodology.md`, `D2-watch-active-workout.md`, `D3-sync-architecture.md`, `D4-coach-llm-design.md`
- Content inventories: `C1-overview-and-today.md`, `C2-training-and-plan.md`, `C3-races.md`, `C4-health.md`, `C5-log-and-run-recap.md`, `C6-coach-and-insights.md`, `C7-ancillary.md`, `C8-ios-extensions.md`
- Knowledge base: `Research/INDEX.md` (entry point to 24 generic running-research docs)
- Design system: `designs/faff.css`, existing mockups in `designs/*.html`
