# C1 — Content Inventory: Web Overview + iOS Today

Inventory of every reasonable element that could appear on the Web Overview page and the iPhone Today screen. Inclusive, not curated — the product owner picks what ships. Two surfaces, same job, different context: web is the seated command-center read; iOS Today is the standing 2-second glance.

Brand assumed: dark theme, hero numbers, small-caps gray labels, semantic color (green=recovery, blue=active, purple=milestone, gold=race, red=warn), coach-voice blocks with WHY/FOCUS/BACK OFF IF labels, honest tone.

KB references use the filenames in `/Research/` (e.g., `01-pace-zones-vdot.md`).

---

## Web Overview

### Job-to-be-done

"Where am I right now and what should I do today?" — answered in under 5 seconds at first glance, with everything needed for a 2-minute deeper read directly below.

### Element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | Time-aware greeting ("Good evening, [name]") | should | app-computed | — | Anchors the page in time and continues the established brand voice. |
| 2 | Today's date + day-of-week | must | app-computed | — | Orientation; pairs with phase/arc context. |
| 3 | Coach's daily message (1–3 sentence narrative read) | must | coach-LLM | `00b-recovery-protocols.md`, `00a-distance-running-training.md` | The page's headline. Tells user the WHY before they see the prescription. |
| 4 | Today's prescribed workout card (name, structure, target paces, duration) | must | app-computed (plan) | `04-workout-vocabulary.md`, `01-pace-zones-vdot.md` | The single most important answer — what am I doing today. |
| 5 | "Why this workout today" coach block | must | coach-LLM | `00a-distance-running-training.md`, `22-plan-templates.md` | Context: where the workout fits in the arc, what stimulus it's chasing. |
| 6 | "Back off if…" guardrails | should | coach-LLM | `00b-recovery-protocols.md`, `15-wearable-data.md` | Honest brand promise: not blind execution. |
| 7 | "Send to Watch" affordance | must | app-computed | — | Plan-flow to the device that runs the run. |
| 8 | Move/swap/skip workout actions | should | user-input | `00a-distance-running-training.md` | One-click flexibility without going to Plan editor. |
| 9 | Readiness/recovery composite score (hero) | must | app-computed (HRV+RHR+sleep+subjective) | `15-wearable-data.md`, `03-heart-rate-zones.md` | Single number anchors the body-state read. |
| 10 | Readiness breakdown (HRV / RHR / sleep / subjective) | should | HealthKit / Whoop / Oura / Garmin | `15-wearable-data.md` | Drill-down into what drove the score. |
| 11 | HRV trend (7/30/60-day baseline + today) | should | HealthKit / Oura / Whoop / Garmin | `03-heart-rate-zones.md`, `15-wearable-data.md` | Trend vs. baseline matters more than absolute value. |
| 12 | RHR trend with baseline band | should | HealthKit / wearable | `03-heart-rate-zones.md`, `15-wearable-data.md` | Early warning for illness/overreach. |
| 13 | Sleep last night (duration + quality + debt) | must | HealthKit / Oura / Whoop | `00b-recovery-protocols.md`, `15-wearable-data.md` | Highest-ROI recovery modality; prominent. |
| 14 | Subjective wellness check-in prompt (energy/soreness/mood/motivation) | should | user-input | `15-wearable-data.md`, `00b-recovery-protocols.md` | Subjective beats wearable when they disagree; quick capture. |
| 15 | Phase/arc visualization (where in cycle: base / build / peak / taper / race / recovery) | must | app-computed (plan) | `00a-distance-running-training.md`, `22-plan-templates.md` | The "where am I?" frame everything else hangs off. |
| 16 | Day N of M in current phase | should | app-computed | `22-plan-templates.md` | Time-aware, brand-consistent. |
| 17 | Days since last race / hard effort | should | app-computed | `00b-recovery-protocols.md` | Recovery context (e.g. "1 day since Sombrero"). |
| 18 | This week's plan strip (Mon–Sun, prescribed + completed) | must | app-computed | `22-plan-templates.md` | Glanceable adherence + what's coming. |
| 19 | Week mileage so far / target | must | HealthKit / Strava / app-computed | `00a-distance-running-training.md` | Volume is the dominant training input. |
| 20 | Week intensity distribution (E/M/T/I/R minutes) | nice | app-computed | `00a-distance-running-training.md`, `01-pace-zones-vdot.md` | TID is the hidden input most plans get wrong; show it. |
| 21 | Acute:Chronic Workload Ratio (ACWR) gauge | should | app-computed | `00a-distance-running-training.md`, `15-wearable-data.md` | Injury-risk signal; band-colored. |
| 22 | Fitness / Fatigue / Form (CTL/ATL/TSB) chart | should | app-computed | `15-wearable-data.md` | Power-user trajectory view. |
| 23 | 4–8 week training arc visualization | should | app-computed | `22-plan-templates.md` | Zoom-out context — see peak coming. |
| 24 | Race countdown card (next A-race) | must | user-input + app-computed | `08-pacing-and-race-week.md` | Top motivator and pacing/taper anchor. |
| 25 | Course conditions for next race (elev, climate forecast band) | nice | weather-API + user-input | `06-weather-adjustments.md`, `11-course-specific-training.md` | Becomes critical inside 2 weeks out. |
| 26 | Current race-time prediction (per distance) | should | app-computed | `02-race-time-prediction.md`, `01-pace-zones-vdot.md` | "Here's what your fitness says you can run." |
| 27 | VDOT / current fitness number with trend | should | app-computed | `01-pace-zones-vdot.md`, `02-race-time-prediction.md` | Single number for fitness; brand-fit hero. |
| 28 | Today's training paces strip (E / M / T / I / R) | should | app-computed | `01-pace-zones-vdot.md` | Quick reference even when not on workout day. |
| 29 | Conditions card for today (temp, dew point, wind, AQI, precip, sunrise/sunset) | must | weather-API | `06-weather-adjustments.md`, `19-hydration-electrolytes.md` | Drives pace/effort/fueling adjustments. |
| 30 | Heat/cold pace-adjustment callout when relevant | should | app-computed + weather-API | `06-weather-adjustments.md` | Honest: today's E pace is X, not Y. |
| 31 | Recommended shoe for today's session | should | app-computed | `17-footwear.md` | Auto-rotation; ties to mileage tracker. |
| 32 | Suggested route(s) for today's workout | nice | app-computed + user-input | `11-course-specific-training.md` | Match terrain to session intent. |
| 33 | Fueling plan for today (if long/quality) | should | app-computed | `18-fueling-products.md`, `19-hydration-electrolytes.md` | Long runs and races need a stated plan. |
| 34 | Daily mobility / warmup checklist | nice | app-computed | `10-mobility-warmup.md` | Session-matched warmup. |
| 35 | Strength session for today (if scheduled) | should | app-computed | `07-strength-programming.md` | Concurrent training is part of the plan. |
| 36 | Most recent run recap (hero stats + match vs prescribed) | must | HealthKit / Strava / Garmin / Coros | `04-workout-vocabulary.md`, `01-pace-zones-vdot.md` | If the user just ran, the page should acknowledge it. |
| 37 | "Yesterday in one line" coach block | nice | coach-LLM | `15-wearable-data.md` | Continuity narrative. |
| 38 | Active streak / consistency tile | nice | app-computed | `20-mental-training.md` | Motivational; with anti-streak guardrails (don't reward through-injury runs). |
| 39 | Insights ticker (1–3 system-detected patterns) | should | app-computed + coach-LLM | `15-wearable-data.md` | "Easy pace dropped 10s/mi at same HR over 4 weeks." |
| 40 | Risk alerts (overtraining, ACWR spike, illness flags) | must | app-computed | `15-wearable-data.md`, `00b-recovery-protocols.md` | Don't let user blow themselves up. |
| 41 | Active injury banner (with stage + return-to-run protocol) | must | user-input + coach | `05-injury-return-protocols.md` | If injured, this is THE context — overrides almost everything else. |
| 42 | Cycle-tracking card (female users, opt-in) | should | user-input / HealthKit | `13-sex-specific-training.md` | Phase-aware coaching when user opts in. |
| 43 | Personal bests strip (5K / 10K / HM / M / recent) | nice | app-computed | `02-race-time-prediction.md` | Identity + motivation. |
| 44 | Recent achievements / milestones (purple accent) | nice | app-computed | `20-mental-training.md` | Celebrate, sparingly. |
| 45 | Year-to-date mileage + projection | nice | app-computed | `00a-distance-running-training.md` | Macro view; opt-in. |
| 46 | Mileage trend (4-week / 12-week / 52-week) | should | app-computed | `00a-distance-running-training.md` | Trajectory at a glance. |
| 47 | Long-run progression chart | nice | app-computed | `00a-distance-running-training.md`, `22-plan-templates.md` | Marathon-prep cue. |
| 48 | Quick-action strip (log feel, mark sick, request rest day, ask coach) | should | user-input | — | Reduce navigation overhead. |
| 49 | Ask-the-coach inline prompt | should | coach-LLM | — | "What about tomorrow?" type one-shots. |
| 50 | Tomorrow preview card | nice | app-computed | `22-plan-templates.md` | Plan-ahead users. |
| 51 | Plan adherence percentage (last 4 weeks) | nice | app-computed | — | Truthful mirror; no hype. |
| 52 | Hydration target for today | nice | app-computed + weather-API | `19-hydration-electrolytes.md` | Heat days especially. |
| 53 | Caffeine guidance (race-week and quality days) | nice | app-computed | `08-pacing-and-race-week.md`, `18-fueling-products.md` | Quiet, contextual. |
| 54 | Body-weight trend (opt-in, sensitive UI) | nice | HealthKit / user-input | `13-sex-specific-training.md` | Privacy-respectful display rules. |
| 55 | Travel/timezone race banner (when applicable) | later | user-input + app-computed | `12-travel-timezone.md` | Activates only when traveling for race. |
| 56 | Altitude indicator (when current location ≠ baseline) | later | app-computed | `11-course-specific-training.md` | Auto-detect when user is up high. |
| 57 | Air quality alert with training adjustment | should | weather-API | `06-weather-adjustments.md` | Wildfire-season relevance. |
| 58 | Bloodwork / lab callouts (recent flags) | nice | user-input | `13-sex-specific-training.md` | Ferritin, vit D etc. for endurance context. |
| 59 | Notes / journal prompt for today | nice | user-input | — | "How did that feel?" capture. |
| 60 | Session log: laceup time / RPE / felt-pace prompt | nice | user-input | `03-heart-rate-zones.md` | Subjective layer for reconciliation. |

### Conditional layouts

How the page reshuffles by training state. Each bullet is "promote / demote / appear / disappear."

- **Build phase (base / general prep)**
  - Promote: Week mileage (19), TID (20), long-run progression (47), VDOT trend (27), insights (39).
  - Demote: Race countdown (24), course conditions (25), fueling card (33), taper-adjacent items.
  - Appear: 12-week mileage trend (46) prominent.
  - Disappear: Race-week banners.

- **Peak**
  - Promote: Today's workout (4), prescribed paces (28), readiness (9), ACWR gauge (21), risk alerts (40), recent recap (36).
  - Promote: Race countdown (24) starts to climb hierarchy if A-race within 6–8 weeks.
  - Demote: Streak (38), YTD mileage (45).

- **Taper (final 2–3 weeks)**
  - Promote: Race countdown (24), course conditions (25), fueling plan for race (33), pacing/strategy preview, race-week protocol checklist.
  - Promote: Coach voice block emphasizing "Volume drop is intentional" tone.
  - Demote: Mileage trend (46), TID (20), week mileage target (less judgmental during taper).
  - Appear: Travel/timezone banner (55) if traveling.

- **Race week**
  - Promote: Race countdown (24) becomes hero, pacing plan, weather forecast band for race day, kit/shoe/fueling checklist, sleep banking, caffeine timing, warmup protocol.
  - Demote: Plan strip (18) replaced by race-week schedule.
  - Disappear: ACWR gauge (21), VDOT trend (27), normal workout card replaced with "Shakeout" or "Rest" framed in race-week tone.
  - Appear: Logistics card (start time, gear pickup, drop bags, transport).

- **Post-race (next 1–14 days)**
  - Promote: Recovery score (9), sleep (13), days-since-race (17) becomes hero, subjective wellness (14), coach-voice block on reverse periodization.
  - Demote: Today's workout (4) shown as "Rest" or "Walk 20 min" with explicit WHY.
  - Disappear: Race countdown (24) until next race assigned, intensity prescriptions, ACWR alerts (intentional drop expected).
  - Appear: Race recap link, lessons-learned prompt.

- **Injury**
  - Promote: Active injury banner (41) at top with stage and return-to-run protocol.
  - Promote: Cross-training substitution card, mobility (34), pain log capture.
  - Demote / Disappear: Race countdown (24, unless still on calendar), prescribed paces (28), VDOT trend (27), streak (38).
  - Appear: Red-flag referral criteria callout, modified plan summary.

- **Off-season / between cycles**
  - Promote: Maintenance plan summary, off-season goals, body-state trends, gear (shoe replacement reminders).
  - Demote: Today's workout structure (lighter, optional).
  - Appear: Plan-builder CTA ("Pick your next race"), strength emphasis card.
  - Disappear: Race countdown, taper/race-week machinery.

### Quick competitor scan

- **Whoop home (web/app):** Recovery score (color-coded ring), strain target for today, sleep performance, "Coach" weekly summary block, monthly performance assessment. Worth borrowing: the single composite score with color band as the page's first read; the "today's strain target" framing analogous to a prescribed effort budget.
- **Oura home:** Readiness score with breakdown (HRV balance, RHR, body temp, recovery index, sleep, activity balance), trends with baseline ribbons, contextual messages ("Pay attention to recovery today"). Worth borrowing: the baseline ribbon visualization for HRV/RHR; honest copy when readiness is low.
- **Garmin Connect home:** "My Day" widget with steps/intensity minutes/sleep/stress/Body Battery, Training Status (productive/maintaining/overreaching/peaking/detraining), Training Readiness, today's suggested workout from Daily Suggested Workouts, race predictor. Worth borrowing: training-status state label as a brand-fit phase chip; race predictor by distance.
- **Runna home:** Today's workout dominant, week strip, plan progress, swap-workout affordance, simple coaching note. Worth borrowing: the clean "Today" hero with one-tap "Send to Watch."
- **Athlytic home:** Recovery + strain composite for athletes specifically (Whoop-style but Apple-Watch-native), training load context, sleep need vs. got. Worth borrowing: "sleep need vs. got" framing, Apple-native recovery score that doesn't require a separate band.
- **TrainingPeaks athlete view (web):** PMC chart (CTL/ATL/TSB) front and center, week calendar with planned/actual reconciliation, compliance percentage, athlete notes timeline. Worth borrowing: PMC chart as a power-user surface; planned-vs-actual reconciliation visualization.

### Mobile vs. web variants

For elements present on both surfaces, the variant differences:

| Element | Web variant | iOS Today variant |
|---|---|---|
| Coach's daily message | 2–4 sentences, can include inline data refs (charts, links) | 1 sentence, expandable to full read on tap |
| Today's workout card | Full structure visible (intervals, paces, warmup/cooldown), inline edit | Compact (name + duration + key target), tap-through for detail |
| Readiness score | Composite + breakdown gauges visible inline | Composite hero only; breakdown on tap |
| Phase/arc | 4–8 week timeline visible | Current phase chip + Day N of M |
| Week strip | Mon–Sun grid with prescribed + actual | Horizontal scrollable strip with today highlighted |
| HRV / RHR trends | 30/60-day chart inline | Sparkline only, full chart in Health tab |
| Conditions card | Full forecast with adjustment math | Temp/dew point/wind chips with single adjustment line |
| Race countdown | Full card with course, weather, plan link | Tile with "[N] days · [Race]" |
| Insights | Up to 3 inline with charts | Single insight ticker, swipeable |
| Quick actions | Left rail or strip; full set | Bottom sheet or floating; top 3–4 only |
| Send-to-Watch | Button on workout card | Persistent CTA at top of workout card; primary affordance on Today |
| Ask-the-coach | Inline text input on page | Sheet/modal opened from action strip |

### Open questions

- Single composite readiness score vs. multi-score breakdown vs. coach narrative — pick one as hero, others as drill-down. Whoop/Oura/Garmin/Athlytic disagree.
- Coach daily message: always present, on-demand, or contextual (only when meaningful)? Risk of preachy filler if always on.
- How much "next 7 days" lives on Overview vs. Plan? Current bias: keep week strip on Overview; full editable view on Plan/Training.
- Streak mechanics — show, hide, or replace with "consistency band" that doesn't punish smart rest days?
- Customizable card order on web (drag-rearrange) vs. opinionated fixed layout? Opinionated by default, with hide/show toggles per card.
- Do we ship a "race-time prediction by distance" widget on Overview, or only on Races page? Argument for Overview: it's the most motivating metric.
- Should fun-stats / gamified content live on Overview or its own surface? Bias: separate; Overview stays serious.
- When the user has multiple A-races in a season, does the countdown show the next or the most-prepared-for? Most likely the chronologically next.
- Time-of-day adaptation: does the page show different content morning vs. evening (e.g., "what's tomorrow" promoted at night)?
- Data freshness markers — how visible should sync state be? (e.g., "HRV from Oura · 4 min ago.")
- How does the page handle a brand-new user with no plan, no race, no recent runs? An empty state that's still useful, not a placeholder.
- Should the Coach's daily message be voice-playable from web? Ties to Coach research.

### Data model implications

Backend entities/fields that must exist to populate this surface (delta on top of the existing data-model entities listed in the spec):

- **User**: timezone, week-start day, units, sex (cycle-tracking opt-in), date-of-birth (age physiology), display name, fitness baselines (current VDOT, HR zones, threshold pace), goals.
- **Activity**: source (HealthKit / Strava / Garmin / Coros / manual), start/stop, distance, duration, splits, HR series, pace series, cadence, GPS, weather snapshot at start, shoe ref, perceived effort, notes, prescribed-workout ref, reconciliation status.
- **Workout (planned)**: date, plan ref, type (E/M/T/I/R/long/strength/cross/recovery/race), structure (warmup, main set, cooldown), target paces (computed from current VDOT), target HR bands, prescribed duration, prescribed distance, fueling plan ref, conditions guidance, watch-pushed timestamp.
- **Plan**: phase array with start/end dates, peak week, A-race ref, generated-from settings, version, last modified, adherence rolling stats.
- **Race**: name, date, distance, course profile, target time (A/B/C), conditions forecast snapshot, location (timezone for travel handling), status (upcoming / in-week / completed / DNF / DNS).
- **HealthMetric (daily)**: date, HRV (LnRMSSD), RHR, sleep duration + stages, sleep score, body weight, body temp, source per metric (multi-source resolution rules).
- **ReadinessScore (daily, computed)**: composite score, component breakdown, inputs version, baseline window snapshot, narrative output from coach-LLM.
- **SubjectiveLog (daily)**: energy, soreness, mood, motivation, freeform note, timestamp.
- **CoachMessage (daily)**: surface (overview / today), generated_at, narrative, references (entity refs to Activity / Workout / Race / HealthMetric), tone tag, dismissed flag.
- **CoachInsight**: pattern type, time window, evidence refs, severity (info / nudge / warn), action suggested, expires_at, dismissed flag.
- **Injury**: location, severity, stage in return-to-run protocol, started_at, last_updated, modified-plan ref, red-flag triggered flag.
- **Shoe**: model, brand, mileage, status (active / retired / paused), last-rotated date, recommended-for tags, replacement threshold.
- **FuelingPlan**: workout/race ref, carb-per-hour target, sodium target, products list, water plan, gut-training context.
- **Route**: name, GPS polyline, distance, elevation profile, terrain tags, time-of-day suitability, last run date, frequency, weather-suitability tags.
- **WeatherSnapshot**: location, time, T_air, T_dew, wind, gust, AQI, precip, UV, sunrise/sunset, source.
- **TrainingLoadDaily (computed)**: CTL, ATL, TSB, ACWR, weekly mileage, intensity distribution minutes, source activities.
- **CycleLog (opt-in)**: phase, day-of-cycle, symptoms, notes.
- **Streak/Consistency**: current value, type (any-activity / run-only / quality-only), last-broken date, override-on-injury flag.
- **NotificationPreferences**: per-category toggles (workout reminder, post-run prompt, recovery alert, plan adjust, race countdown, insight, milestone), quiet hours.

Critical computed views needed:
- `getOverviewSnapshot(userId, date)` returning a single payload composed of: today's workout, readiness, conditions, week strip, race countdown, recent activity, insights, alerts.
- `getCoachDailyMessage(userId, date)` returning narrative with structured references.
- `reconcileActivity(activityId)` matching auto-synced runs to prescribed workouts.

---

## iOS Today

### Job-to-be-done

"What am I doing today and how am I doing?" — answered in 2 seconds at first glance from a phone-in-hand context, with deeper read available by scrolling, not by navigating.

### Element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | Time-aware greeting | should | app-computed | — | Brand continuity from web. |
| 2 | Date + day chip | must | app-computed | — | Anchor. |
| 3 | Phase chip (e.g., "Peak · Day 3 of 7") | should | app-computed | `22-plan-templates.md` | Compact arc context. |
| 4 | Coach's daily message (1 sentence, expandable) | must | coach-LLM | `00b-recovery-protocols.md` | The headline, mobile-condensed. |
| 5 | Readiness/recovery hero (composite) | must | app-computed | `15-wearable-data.md` | Single number, color band, primary glance answer. |
| 6 | Readiness breakdown sheet (HRV/RHR/sleep/subjective) | should | wearable / HealthKit | `15-wearable-data.md` | Tap to expand. |
| 7 | Sleep last night tile | must | HealthKit / Oura / Whoop | `00b-recovery-protocols.md` | High-value glance. |
| 8 | HRV today vs. baseline sparkline | should | HealthKit / wearable | `03-heart-rate-zones.md`, `15-wearable-data.md` | Trend signal in one tile. |
| 9 | RHR sparkline | nice | HealthKit / wearable | `15-wearable-data.md` | Companion to HRV. |
| 10 | Subjective check-in tap-to-log (energy/soreness 1–5) | should | user-input | `15-wearable-data.md` | One thumb, two taps. |
| 11 | Today's workout card (compact: name + duration + key target) | must | app-computed | `04-workout-vocabulary.md`, `01-pace-zones-vdot.md` | Primary actionable. |
| 12 | "Send to Watch" persistent CTA on workout | must | app-computed | — | The canonical mobile action. |
| 13 | "Why today" coach micro-block (2 lines) | should | coach-LLM | `00a-distance-running-training.md` | Brand fit, condensed. |
| 14 | "Back off if…" guardrail line | nice | coach-LLM | `00b-recovery-protocols.md` | Honest, terse. |
| 15 | Move/swap/skip actions (sheet) | should | user-input | — | Quick adjustments without leaving Today. |
| 16 | Conditions for today (temp / dew / wind / AQI chips) | must | weather-API | `06-weather-adjustments.md`, `19-hydration-electrolytes.md` | Drives effort/fueling. |
| 17 | Heat-pace adjustment line ("E pace +10s/mi today") | should | app-computed + weather-API | `06-weather-adjustments.md` | Honest in-context coaching. |
| 18 | Recommended shoe tile | should | app-computed | `17-footwear.md` | Auto-rotation reminder. |
| 19 | Fueling plan tile (long/quality only) | should | app-computed | `18-fueling-products.md` | Pre-run trigger. |
| 20 | Hydration target tile | nice | app-computed + weather-API | `19-hydration-electrolytes.md` | Heat-day prompt. |
| 21 | Suggested route tile | nice | app-computed + user-input | `11-course-specific-training.md` | Match terrain to session. |
| 22 | Daily mobility / warmup checklist | nice | app-computed | `10-mobility-warmup.md` | Pre-run nudge. |
| 23 | Strength session card (if scheduled) | should | app-computed | `07-strength-programming.md` | Concurrent workload. |
| 24 | Week strip (horizontal Mon–Sun) | must | app-computed | `22-plan-templates.md` | Context + adherence. |
| 25 | Week mileage so far / target chip | should | HealthKit / Strava | `00a-distance-running-training.md` | One tap to commit/observe. |
| 26 | Race countdown tile (next A-race) | must | user-input + app-computed | `08-pacing-and-race-week.md` | Top motivator. |
| 27 | Course/weather forecast strip for race (when within 14 days) | should | weather-API | `06-weather-adjustments.md`, `08-pacing-and-race-week.md` | Activates contextually. |
| 28 | Recent run recap card (if just finished) | must | HealthKit / Strava / Watch | `04-workout-vocabulary.md` | Auto-prompts on app open after a run. |
| 29 | "Yesterday" one-line summary | nice | coach-LLM | `15-wearable-data.md` | Continuity. |
| 30 | Insights ticker (1 swipeable card) | should | app-computed + coach-LLM | `15-wearable-data.md` | Surfaces patterns; not preachy. |
| 31 | Risk alert banner (overtraining / illness / ACWR) | must | app-computed | `00b-recovery-protocols.md`, `15-wearable-data.md` | Don't bury warnings. |
| 32 | Active injury banner with stage + RTR step | must | user-input + coach | `05-injury-return-protocols.md` | Top-of-screen when injured. |
| 33 | Cycle phase tile (female users, opt-in) | should | user-input / HealthKit | `13-sex-specific-training.md` | Phase-aware. |
| 34 | Streak / consistency chip | nice | app-computed | `20-mental-training.md` | With anti-streak guardrails. |
| 35 | Quick action strip (log feel, mark sick, request rest, ask coach, log strength) | should | user-input | — | One-thumb capture. |
| 36 | "Ask the coach" sheet entry | should | coach-LLM | — | Mobile chat handoff. |
| 37 | Tomorrow preview chip | nice | app-computed | `22-plan-templates.md` | Plan-ahead users. |
| 38 | VDOT / fitness number chip | nice | app-computed | `01-pace-zones-vdot.md` | Brand-fit hero number. |
| 39 | Race-time prediction by distance (small) | nice | app-computed | `02-race-time-prediction.md` | Motivational. |
| 40 | Today's pace zones strip (E/M/T/I/R) | nice | app-computed | `01-pace-zones-vdot.md` | Power users. |
| 41 | Personal bests chip strip | nice | app-computed | `02-race-time-prediction.md` | Identity. |
| 42 | Live Activity affordance (start now) | should | app-computed | — | Lock-screen presence during run. |
| 43 | Pull-to-refresh sync indicator | must | app-computed | — | Trust the data. |
| 44 | Sync state per source (HealthKit / Strava / Garmin) | should | integrations | `15-wearable-data.md` | Trust + debugging. |
| 45 | Notification permission/upsell card (early sessions) | should | app-computed | — | Push is the lifeblood. |
| 46 | Watch app install/upsell card (if not installed) | should | app-computed | — | Watch is the runner. |
| 47 | Bloodwork callouts (recent flags) | nice | user-input | `13-sex-specific-training.md` | Endurance-relevant labs. |
| 48 | Travel/timezone race banner | later | user-input + app-computed | `12-travel-timezone.md` | Activates when traveling. |
| 49 | Altitude indicator | later | app-computed | `11-course-specific-training.md` | Auto-detect. |
| 50 | Air-quality alert banner | should | weather-API | `06-weather-adjustments.md` | Wildfire-season. |
| 51 | Caffeine timing nudge (race week / quality) | nice | app-computed | `08-pacing-and-race-week.md`, `18-fueling-products.md` | Quiet contextual. |
| 52 | Body weight log entry (opt-in, sensitive) | nice | HealthKit / user-input | `13-sex-specific-training.md` | Privacy-aware. |
| 53 | Notes / journal one-tap capture | nice | user-input | — | "How did that feel?" |
| 54 | RPE capture for last run (if missing) | nice | user-input | `03-heart-rate-zones.md` | Reconciliation. |
| 55 | Coach voice play (TTS daily message) | nice | coach-LLM | — | Hands-free morning. |
| 56 | Send-to-Watch + start workout shortcut (Siri) | nice | app-computed | — | Discoverable shortcut. |
| 57 | Lock-screen Live Activity (today's workout / race countdown) | should | app-computed | — | Glanceable without opening app. |
| 58 | Home-screen widget tie-in CTA | nice | app-computed | — | "Add to Home Screen." |
| 59 | Plan adherence percentage tile | nice | app-computed | — | Honest mirror. |
| 60 | "Mark workout done" if not synced | should | user-input | — | Manual fallback. |

### Conditional layouts

- **Build phase**
  - Promote: Today's workout (11), week strip (24), week mileage chip (25), insights (30).
  - Demote: Race countdown (26), fueling tile (19), course/weather strip (27).
  - Disappear: Race-week banners.

- **Peak**
  - Promote: Workout (11), readiness (5), conditions (16), heat-adjustment (17), risk alert banner (31), recent recap (28).
  - Promote: Race countdown (26) climbs hierarchy.
  - Demote: Streak (34), VDOT chip (38).

- **Taper**
  - Promote: Race countdown (26) becomes hero, fueling plan (19), course/weather strip (27), pacing strategy CTA, mobility (22).
  - Demote: Week mileage chip (25), insights (30).
  - Appear: Travel banner (48) if traveling.

- **Race week**
  - Hero: Race countdown (26) with weather forecast band.
  - Promote: Race-week schedule (replaces week strip), pacing plan, fueling/hydration/caffeine card, kit/shoe checklist, sleep banking nudge, warmup protocol.
  - Disappear: Pace zones strip (40), VDOT chip (38), risk alerts about ACWR (taper drop is intended).
  - Appear: Logistics card (start time, transport, drop bags).

- **Post-race**
  - Promote: Recovery hero (5), sleep tile (7), days-since-race chip, subjective check-in (10), reverse-periodization coach line.
  - Demote: Today's workout (11) framed as "Walk 20 min" or "Rest" with WHY.
  - Disappear: Race countdown (until next assigned), risk alerts about volume drop, intensity prescriptions.
  - Appear: Race recap CTA, lessons-learned prompt, return-to-run progression card.

- **Injury**
  - Hero: Active injury banner (32) with stage and next step.
  - Promote: Cross-training substitute card, mobility (22), pain log capture, red-flag referral callout.
  - Demote / Disappear: Race countdown (unless still calendar-bound), pace zones (40), VDOT chip (38), streak (34).

- **Off-season**
  - Promote: Maintenance plan summary, gear reminders (shoe replacement), strength card (23).
  - Demote: Workout (11) shown lightly.
  - Appear: Plan-builder CTA, off-season goals tile.

### Quick competitor scan

- **Whoop iOS home:** Strain target ring, recovery score color band, sleep performance, monthly performance card, "Coach" prompt. Worth borrowing: the central recovery ring as today's first read.
- **Oura iOS home:** Readiness score with 1-line message, sleep score, activity score, contributors as taps. Worth borrowing: the contextual one-liner under the score; baseline ribbon visualizations on tap.
- **Garmin Connect iOS:** "My Day" stack with Body Battery, sleep, stress, intensity minutes, today's suggested workout pill, training readiness factor list. Worth borrowing: the suggested-workout pill format and factor list on tap.
- **Runna iOS home:** Today's workout dominant, week strip, simple swap, plan progress, single coaching note. Worth borrowing: workout-first hierarchy and one-tap "Send to Watch" prominence.
- **Athlytic iOS:** Recovery + strain ring on Apple Watch + iPhone, sleep need vs. got, training-load context. Worth borrowing: native-feel recovery without requiring a separate band; "sleep need" framing.

### Mobile vs. web variants

Already enumerated under Web Overview's "Mobile vs. web variants" section. Highlights specific to iOS Today:

- iOS Today is single-column scroll; web is multi-column grid.
- iOS uses sheets/modals for drill-down; web uses inline expand or side rail.
- iOS surfaces Live Activities and widgets; web does not.
- iOS uses bottom-sheet quick-action strip; web uses left rail or top strip.
- iOS auto-prompts subjective check-in on first open of the morning; web shows a passive prompt.
- iOS shows recent run recap as auto-modal after a run finishes; web shows as a card on the page.

### Open questions

- Should the iOS Today screen be customizable card order, or strictly opinionated? Bias: opinionated with hide-show toggles per card; customization in Settings.
- Live Activity: should it auto-start on every workout or only on long-runs / races / structured intervals?
- Push cadence: which categories default on, off, opt-in? Bias: workout reminder + race countdown + risk alert default on; insight + milestone opt-in.
- Where does "log strength session" live — Today action strip, Plan, or Log? Bias: action strip on Today for friction.
- One-thumb subjective check-in: 1–5 scale vs. emoji vs. slider? Lean 1–5 with optional emoji affordance.
- Should HealthKit auto-write subjective ratings as Mindful Minutes or only stay local? Privacy decision.
- How does iOS Today degrade gracefully without a Watch? Bias: keep the surface useful — manual log + phone-tracked option.
- Should the Coach daily message TTS auto-play on first open? Almost certainly no — opt-in only.
- Pull-to-refresh: trigger a coach message regeneration, or just a sync? Sync only by default.
- Should "tomorrow preview" be a swipe-left gesture from Today, or a separate tab/screen?
- iOS widget priorities — which 3 widget types ship first (recovery / today's workout / race countdown is the obvious set)?

### Data model implications

iOS Today reads from the same backend entities as Web Overview. Additional or emphasized requirements:

- **Push notification queue**: per-user category-tagged scheduled and event-driven payloads; Live Activity stream IDs; quiet-hours-aware scheduler.
- **Live Activity payload format**: today's workout structure compact form, race countdown with target time, in-run pace/HR/distance feed (later phase).
- **Widget timeline provider**: small/medium/large variants of recovery, today's workout, race countdown; refresh cadence rules; offline cache.
- **Subjective log endpoint**: very low-latency write (one-thumb capture), idempotent on day key, append-but-replace-current-day semantics.
- **Sync state per integration**: last-sync timestamp, error state, retry status, source priority (HealthKit vs. Strava vs. Garmin vs. Coros for the same activity).
- **OverviewSnapshot v2 (mobile-optimized)**: a smaller, prioritized payload — composite readiness only, today's workout compact, week strip, race countdown, top-1 insight, top-1 alert. Server-driven UI hints (which cards to show given user state) reduce client phase-state logic.
- **Send-to-Watch dispatch**: pending workout queue per user, watch acknowledgement state, retry on watch-not-available.
- **Run-finished event**: triggers post-run prompt push + auto-modal on next app open.
- **Coach daily message cache**: regenerate-on-context-change, regenerate-on-pull-to-refresh policy; TTL per category.
- **Notification preference resolution**: server-side filter per-payload before push so client doesn't show suppressed categories.
- **Permission state model**: HealthKit category granularity, push permission, Watch app installed, Siri donation state — drives upsell cards.

---

## Cross-surface notes

Both surfaces share entities and a common job. The web variant prioritizes density, drill-down, and editing; the iOS variant prioritizes glanceability, capture, and the Send-to-Watch action. The same coach voice, color semantics, and brand vocabulary apply across both.

When in doubt: web answers "what's the full picture" in 2 minutes; iOS Today answers "what now" in 2 seconds.
