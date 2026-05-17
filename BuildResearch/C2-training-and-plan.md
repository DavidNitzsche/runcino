# C2 — Content Inventory: Training & Plan

Inventory of every reasonable element that could appear on the Training-side surfaces of the app — web (planning, library, detail, zones, phase, strength) and iOS (calendar swipe, workout detail). Inclusive, not curated. Brand assumptions: dark theme, hero numbers, small-caps gray labels, semantic color (green=recovery/easy, blue=active/quality, purple=milestone, gold=race, red=warn/risk), coach-voice blocks with WHY/FOCUS/BACK OFF IF labels, honest tone, density without clutter.

KB references use filenames in `/Research/`. Priority: **must** = ship-blocking, **should** = strong default, **nice** = good-to-have, **later** = post-MVP.

---

## Surface 1 — Web: Training Plan Calendar (multi-week view)

### Job-to-be-done

"Show me my plan over time. Let me see what's coming, what I've done, and how it all hangs together — at a week, month, or full-cycle resolution. Let me edit it without leaving the calendar." This is the planner's command center: it answers "what's the shape of my training?" before it answers "what am I doing today?"

### Element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | View toggle: week / 2-week / month / full-cycle | must | app-computed | `22-plan-templates.md` | Different jobs need different zooms. Week = today-context, full-cycle = arc context. |
| 2 | Today highlight pill on grid | must | app-computed | — | Anchors orientation in any zoom. |
| 3 | Phase ribbon across the top (Base / Build / Peak / Taper / Race / Recovery) | must | app-computed | `00a-distance-running-training.md`, `22-plan-templates.md` | The "where am I?" frame; brand-consistent with arc viz. |
| 4 | Phase-boundary vertical lines on grid | should | app-computed | `00a-distance-running-training.md` | Visual transition cues. |
| 5 | Goal-race marker (gold pin) on its date | must | user-input | `08-pacing-and-race-week.md` | Plan terminates here; everything points at it. |
| 6 | B/C-race markers (smaller pins) | should | user-input | `08-pacing-and-race-week.md` | Tune-up races and supporting events. |
| 7 | Day cell: workout type tag (E/M/T/I/R/LR/Rest/Strength/XT) | must | app-computed | `04-workout-vocabulary.md`, `01-pace-zones-vdot.md` | Glance-readable zone color + letter. |
| 8 | Day cell: planned distance / duration | must | app-computed | `22-plan-templates.md` | Volume read at a glance. |
| 9 | Day cell: workout name (e.g. "6×1K @ I", "Long run 16 mi") | must | app-computed | `04-workout-vocabulary.md` | Specific enough to mean something. |
| 10 | Day cell: completed-vs-planned ring/checkmark | must | HealthKit / Strava / Garmin / app-computed | — | "Did I actually do it?" at a glance. |
| 11 | Day cell: actual pace/distance/time (post-run) | should | HealthKit / Strava / Garmin / Coros | — | Reconciliation visible without drilling. |
| 12 | Day cell: adherence color (green hit, amber close, red missed/over) | should | app-computed | — | Honest mirror — see C1 brand stance. |
| 13 | Day cell: subjective RPE chip if logged | nice | user-input | `03-heart-rate-zones.md` | Effort-vs-pace context. |
| 14 | Day cell: weather glyph (sun/cloud/rain/heat-flag) | nice | weather-API | `06-weather-adjustments.md` | Quick scan for hot/wet days. |
| 15 | Day cell: shoe glyph if assigned | nice | app-computed | `17-footwear.md` | Auto-rotation visibility. |
| 16 | Week summary row (planned vs actual mileage, intensity TID bar) | must | app-computed | `00a-distance-running-training.md`, `01-pace-zones-vdot.md` | Volume + TID is the dominant input pair. |
| 17 | Week summary: long run distance + % of week | should | app-computed | `00a-distance-running-training.md` | Long-run share is a plan-quality signal. |
| 18 | Week summary: ACWR for that week | should | app-computed | `15-wearable-data.md` | Risk read per week. |
| 19 | Week summary: quality-session count (T+I+R) | nice | app-computed | `01-pace-zones-vdot.md` | Cap check (≤2 quality sessions/week typical). |
| 20 | Cumulative cycle mileage progress bar | nice | app-computed | `22-plan-templates.md` | "200 of 720 mi planned this cycle." |
| 21 | Days-to-race countdown banner | must | user-input + app-computed | `08-pacing-and-race-week.md` | Always-on race anchor. |
| 22 | Plan name + version + last-modified date | should | app-computed | — | Edit history and provenance. |
| 23 | Plan editor entry point (button: "Edit plan") | must | — | — | Surfaces destructive-zone affordance. |
| 24 | Add-workout button per day (+ on hover) | should | user-input | `04-workout-vocabulary.md` | Insertion without going to builder. |
| 25 | Mini phase-arc legend (color/letter key) | should | — | `00a-distance-running-training.md` | First-run orientation. |
| 26 | Filter bar (show only quality / show only completed / hide rest days) | nice | — | — | Power-user readability. |
| 27 | Toggle: planned-only / actual-only / both overlay | should | — | — | Different reading jobs. |
| 28 | Planned-vs-actual delta callout when week >10% off | should | app-computed | — | Surfaces drift before it becomes a problem. |
| 29 | Risk banner (ACWR spike, 3+ missed quality, illness flag) | must | app-computed | `15-wearable-data.md`, `00b-recovery-protocols.md` | Don't let the user blow up. |
| 30 | "Rebalance week" suggestion when adherence drifts | should | coach-LLM | `00a-distance-running-training.md` | Coach proactivity. |
| 31 | Print / export to PDF | nice | — | — | Coaches and pre-race binders. |
| 32 | Export to Garmin Connect / Apple Watch / Coros | should | external | — | Cross-platform users. |
| 33 | Import plan (Pfitz/Daniels/Hansons template) | should | knowledge-base-derived | `22-plan-templates.md` | Migration on-ramp. |
| 34 | Compare-cycle overlay (this cycle vs prior, ghosted) | nice | app-computed | `22-plan-templates.md` | Trajectory across cycles. |
| 35 | Notes lane below each week (free-text) | nice | user-input | — | Travel, life context. |
| 36 | Lock-icon per week (frozen weeks pre-race) | should | user-input | `08-pacing-and-race-week.md` | Race week + taper shouldn't auto-regenerate. |
| 37 | Per-day right-click context menu (Move/Swap/Skip/Duplicate/Lock) | must | user-input | — | TrainingPeaks-style efficiency. |
| 38 | Drag handle on workouts | must | — | — | Reschedule by drag. |
| 39 | Drag-with-modifier to duplicate (TrainingPeaks pattern: hold C) | nice | — | — | Power-user shortcut. |
| 40 | Hover preview popover (full workout summary) | should | app-computed | `04-workout-vocabulary.md` | Read without clicking through. |
| 41 | Calendar URL deep-links per day/week | nice | — | — | Coach-share or self-bookmark. |
| 42 | Strength session row (parallel lane, distinct color) | should | app-computed | `07-strength-programming.md` | Concurrent training is part of the plan. |
| 43 | XT/cross-train row (bike/swim/elliptical) | nice | app-computed | `09-cross-training.md` | When prescribed or substituted. |
| 44 | Mobility/recovery row | nice | app-computed | `10-mobility-warmup.md` | Foam-roll, sauna, dynamic warmup. |
| 45 | Travel/altitude banner if known trip falls in week | nice | user-input | `12-travel-timezone.md` | Heads-up for plan friction. |
| 46 | Cycle-tracking indicator if female user opted in | nice | HealthKit / user-input | `13-sex-specific-training.md` | Phase-aware shading. |

### Plan editing affordances (this surface)

- **Drag to reschedule** any non-locked workout day-to-day.
- **Swap** between two days via right-click → Swap (or shift-drag).
- **Mark skipped** (red strike + reason: sick / time / weather / by-feel).
- **Push by N days** (offset whole plan or from-this-point).
- **Regenerate from this point** (coach rebuilds remaining cycle, taper untouched if locked).
- **Lock a date** (race date, key workout, taper week — won't move on regenerate).
- **Add note** to a day.
- **Duplicate workout** to another day.
- **Substitute workout** (e.g. swap T tempo for cruise intervals on a bad day) — coach-suggested alternatives.
- **Bulk-edit week** (e.g. "scale week down 30% — sick").

### Quick competitor scan

- **TrainingPeaks**: drag-drop reschedule (premium-gated), C+drag duplicate, dual calendar for compare, recurring-workout patterns, Workout Builder with structured intervals.
- **Final Surge**: infinite scroll calendar, color-coded completion, drag from library onto calendar, easy plan-to-calendar drop.
- **Runna**: "Not Feeling 100%" one-tap recalibration, dynamic schedule changes, pre-workout briefings personalized per user, mobile-first calendar.
- **McMillan / Final Surge co-delivery**: pace ranges (not points), four-zone Endurance/Stamina/Speed/Sprint structure, plan length 1–52 wk.
- **Stridist** (multi-discipline): drag-and-drop builder, save master templates, duplicate weeks/sessions, video demos inline.
- **Garmin Coach**: phone-driven calendar view, auto-pushes day's workout to watch.
- **Hansons app**: cumulative-fatigue logic baked in, visible "SOS" (Something of Substance) days color-coded.

### Open questions

- Should completed runs unattached to a planned slot float as "extra" entries, or auto-snap to the nearest planned day?
- How to render double-day workouts (AM + PM) in a single cell without crowding?
- Is week-numbering anchored to plan start or calendar week?
- Default zoom on first load: today's week, or full cycle?
- Should locked weeks visually differ from unlocked beyond an icon?
- When the user marks a workout skipped, does coach proactively offer a re-shuffled remainder of the week, or wait?

### Data model implications

- `Workout` entity: `planned_date`, `actual_date_completed`, `locked: bool`, `phase_ref`, `plan_id`, `notes`, `intensity_zones[] (E/M/T/I/R/...)`, `prescribed_distance`, `prescribed_duration`, `actual_activity_id` (FK to Activity).
- `Plan` entity: versioned (`version_n`, `previous_version_id`), `phase_array[]`, `goal_race_id`, `start_date`, `end_date`, `template_origin` (Pfitz, Daniels, custom).
- Reconciliation join: Activity ↔ Workout matched on date+distance+intensity heuristic, with manual override.
- ACWR: rolling 7-day TSS / 28-day TSS, computed per-week, surfaced per-cell.

---

## Surface 2 — Web: Workout Library

### Job-to-be-done

"Browse, search, and discover workouts. Use this to swap in alternatives, build a custom plan, or learn what a name means before committing." Library is the lookup-and-learn surface — separate from the plan, but feeds it.

### Element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | Search bar (free-text by name, tag, zone) | must | — | `04-workout-vocabulary.md` | "Mona fartlek" should resolve. |
| 2 | Filter: distance focus (5K / 10K / HM / M / Ultra) | must | knowledge-base-derived | `22-plan-templates.md` | Match training cycle. |
| 3 | Filter: zone (E / M / T / I / R / mixed) | must | knowledge-base-derived | `01-pace-zones-vdot.md` | Targeted browsing. |
| 4 | Filter: phase fit (Base / Build / Peak / Taper) | should | knowledge-base-derived | `00a-distance-running-training.md` | Workouts have phase-appropriate windows. |
| 5 | Filter: duration (≤30 / 30–60 / 60–90 / 90+ min) | should | app-computed | — | Time-budget search. |
| 6 | Filter: terrain (track / road / trail / hill / treadmill) | nice | app-computed | `08-pacing-and-race-week.md` | Match available environment. |
| 7 | Filter: equipment / gear required | nice | app-computed | `15-wearable-data.md` | Some need a track or HR strap. |
| 8 | Filter: difficulty (entry / standard / advanced) | should | knowledge-base-derived | `04-workout-vocabulary.md` | Daniels: "first time doing this rep length" notes. |
| 9 | Filter: source (Daniels / Pfitz / Hansons / Canova / Lydiard / custom) | should | knowledge-base-derived | `04-workout-vocabulary.md` | Methodology preference. |
| 10 | Sort: alphabetical / by zone / by duration / by recently-used | nice | — | — | Different browse modes. |
| 11 | Workout card: name + zone color + duration + distance | must | knowledge-base-derived | `04-workout-vocabulary.md` | Browse-grid primitive. |
| 12 | Workout card: structure preview (mini segment bar) | should | knowledge-base-derived | `04-workout-vocabulary.md` | Visual at-a-glance pattern. |
| 13 | Workout card: tags (5K-specific / VO2 / threshold / Norwegian / etc.) | should | knowledge-base-derived | `04-workout-vocabulary.md` | Cross-cut search. |
| 14 | Workout card: "Used 3× this cycle" stat | nice | app-computed | — | Personalization. |
| 15 | "Recently used" section | nice | app-computed | — | Quick re-pick. |
| 16 | "Recommended for current phase" carousel | should | coach-LLM | `00a-distance-running-training.md`, `22-plan-templates.md` | Phase-aware on-ramp. |
| 17 | "Coach picks for you" carousel | should | coach-LLM | `22-plan-templates.md` | Personalized based on VDOT, history, plan. |
| 18 | "Workouts I've never done" exploration row | nice | app-computed | `04-workout-vocabulary.md` | Variety stimulus. |
| 19 | Custom workout creator entry point | should | user-input | `04-workout-vocabulary.md` | Power-user pattern. |
| 20 | Saved/starred workouts collection | nice | user-input | — | Personal favorites. |
| 21 | Group view (bucket by family: Threshold / VO2 / Long Run / Speed / Hills / Combo) | should | knowledge-base-derived | `04-workout-vocabulary.md` | Vocabulary doc structure mirrors this. |
| 22 | Empty-state coaching ("Try a Mona fartlek to introduce intensity in base") | nice | coach-LLM | `04-workout-vocabulary.md` | First-load guidance. |
| 23 | "Add to plan" affordance per card (date picker) | must | user-input | — | Library → calendar bridge. |
| 24 | "Send to Watch as one-off" affordance | should | external | — | Use without planning. |
| 25 | Comparison view (pick 2–3, see side-by-side structure) | nice | — | `04-workout-vocabulary.md` | Decide between cruise intervals vs. tempo. |
| 26 | History per workout name (every time you've done it, with paces) | should | app-computed | — | Know the workout — see your record. |
| 27 | Share workout (link or to coach) | nice | — | — | Coach-discussion. |
| 28 | Difficulty estimate for current fitness ("hard at your VDOT 48") | nice | app-computed | `01-pace-zones-vdot.md` | Calibration context. |
| 29 | Predicted recovery cost (low / medium / high) | nice | knowledge-base-derived | `00b-recovery-protocols.md` | Schedule planning. |
| 30 | Source attribution (Daniels p.156, Pfitzinger ch.4, etc.) | nice | knowledge-base-derived | `04-workout-vocabulary.md` | Trust + learnability. |

### Quick competitor scan

- **TrainingPeaks**: structured workout builder with multiple target types (pace, HR, power), drop-into-calendar.
- **Final Surge**: searchable/filterable revamped library, drag from library onto calendar, sync to Garmin/Apple Watch.
- **Stryd Library**: power-based plans curated with named coaches, plan + workout + segment hierarchy.
- **Garmin Connect**: workouts categorized, structured-interval editor, push-to-watch.
- **Stridist**: master templates, exercise-demo videos inline, duplicate sessions/weeks fast.

### Open questions

- Is the library purely curated (knowledge-base sourced), or does it learn from what users build?
- Should community-shared workouts be allowed (and moderated) post-MVP?
- How are paces shown — generic (T zone) until user is logged in, then specific (7:25/mi at user's VDOT)?
- Treadmill workouts shown with speed/incline rather than pace?

### Data model implications

- `WorkoutTemplate` entity (separate from `Workout` instance): `name`, `family`, `zone_targets[]`, `structure_segments[]`, `duration_range`, `distance_range`, `phase_fit[]`, `difficulty`, `source`, `tags[]`.
- `WorkoutHistory` projection: per-template, list of past `Activity`s with paces and dates.
- Custom-workout records linked to user, with optional "share with coach" flag.

---

## Surface 3 — Web: Workout Detail

### Job-to-be-done

"Show me everything about this specific session — what to do, why, how to do it, what to wear/eat/expect, what happened last time, and what'll happen if I push it through to my watch." This is the page you read the night before, the morning of, and again post-run.

### Special section — full element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | Workout name + zone color header | must | app-computed | `04-workout-vocabulary.md` | Identity. |
| 2 | Date + day-of-week + plan-week reference ("Week 8 of 16, Build phase") | must | app-computed | `22-plan-templates.md` | Anchors in cycle. |
| 3 | Time-of-day suggestion (AM/PM, with rationale) | nice | coach-LLM | `00b-recovery-protocols.md`, `06-weather-adjustments.md` | Heat avoidance, sleep recovery. |
| 4 | Total prescribed distance and duration | must | app-computed | `04-workout-vocabulary.md` | Hero stats. |
| 5 | Structure visualization (segment bar with WU / work / rec / CD) | must | app-computed | `04-workout-vocabulary.md`, `17-footwear.md` | Pattern read in 1 second. |
| 6 | Per-segment table (segment / target zone / distance or time / target pace range / target HR / RPE) | must | app-computed | `01-pace-zones-vdot.md`, `03-heart-rate-zones.md` | Execution-grade detail. |
| 7 | "Why this workout today" coach narrative | must | coach-LLM | `00a-distance-running-training.md`, `22-plan-templates.md` | The brand-defining "why before what." |
| 8 | Physiological adaptation explainer (what this trains) | should | knowledge-base-derived | `04-workout-vocabulary.md`, `01-pace-zones-vdot.md` | "VO2max ceiling. Mitochondrial density. Lactate clearance." |
| 9 | KB cross-reference link ("Learn: Threshold workouts §5.3") | should | knowledge-base-derived | `04-workout-vocabulary.md` | Trust + depth on demand. |
| 10 | "Back off if…" guardrails | must | coach-LLM | `00b-recovery-protocols.md`, `15-wearable-data.md` | Honest brand promise. |
| 11 | Predicted recovery cost (low/med/high) + how-many-days-easy-after | should | knowledge-base-derived + coach-LLM | `00b-recovery-protocols.md` | Schedule context. |
| 12 | Predicted TSS / training load for the session | nice | app-computed | `15-wearable-data.md` | Power-user. |
| 13 | Estimated calories burned | nice | app-computed | `18-fueling-products.md` | Fueling math. |
| 14 | Fueling plan (pre-run / during / after, with timing) | should | coach-LLM | `18-fueling-products.md`, `19-hydration-electrolytes.md` | Long/quality runs need stated plan. |
| 15 | Carbs-per-hour target during run | should | app-computed | `18-fueling-products.md` | 60–90 g/hr depending on duration. |
| 16 | Hydration target with electrolyte ranges | should | app-computed + weather-API | `19-hydration-electrolytes.md` | Heat-adjusted. |
| 17 | Caffeine guidance | nice | knowledge-base-derived | `18-fueling-products.md`, `08-pacing-and-race-week.md` | Quality/race-week relevance. |
| 18 | Conditions card (temp, dew, wind, AQI, precip, sunrise/sunset, UV) | must | weather-API | `06-weather-adjustments.md` | Drives pace + gear + fueling. |
| 19 | Heat/cold pace-adjustment callout (today's T pace is 6:55, not 6:48) | should | app-computed + weather-API | `06-weather-adjustments.md` | Honest pacing. |
| 20 | Suggested shoe (auto-rotation pick + rationale) | should | app-computed | `17-footwear.md` | Daily trainer vs. tempo trainer vs. super shoe by intent. |
| 21 | Shoe mileage stamp ("Pegasus 41: 312 mi / 500 mi life") | nice | app-computed | `17-footwear.md` | Replacement awareness. |
| 22 | Suggested route(s) matched to terrain need | nice | app-computed + user-input | `11-course-specific-training.md` | Track for repeats, hilly for hill day. |
| 23 | Warmup protocol (jog / drills / strides) | should | knowledge-base-derived | `04-workout-vocabulary.md` (§17), `10-mobility-warmup.md` | Standard track warmup. |
| 24 | Drill list (A skip, B skip, high knees…) | nice | knowledge-base-derived | `10-mobility-warmup.md`, `04-workout-vocabulary.md` | Beginner-friendly checklist. |
| 25 | Cooldown protocol | should | knowledge-base-derived | `04-workout-vocabulary.md` (§17) | Easy 10–20 min jog + dynamic mobility. |
| 26 | Mobility / activation pre-warmup (5–10 min) | nice | knowledge-base-derived | `10-mobility-warmup.md` | Hip openers, glute activation. |
| 27 | "Send to Watch" affordance with platform pickers (Apple/Garmin/Coros) | must | external | — | The plan-flow handoff. |
| 28 | Watch-preview ("This is what you'll see at lap 1") | nice | app-computed | — | Pre-run mental model. |
| 29 | Audio cue plan (countdowns, lap announcements, target-deviation alerts) | should | app-computed | — | Headphone-cue scheduling. |
| 30 | Audio coach toggle (verbose / minimal / silent) | nice | user-input | — | User pref for mid-run nag. |
| 31 | Voice/coach pre-run briefing (Runna-style 30s personalized read) | nice | coach-LLM | — | Briefing before pressing Start. |
| 32 | History tab (every previous attempt at this workout name) | should | app-computed | — | "Last 3 times: 7:24, 7:18, 7:22 — getting cleaner." |
| 33 | Last-attempt comparison (planned vs. actual paces by rep) | should | app-computed | `01-pace-zones-vdot.md` | Trajectory on a specific session. |
| 34 | Variations / alternatives ("entry / standard / advanced" + "hill version" + "treadmill version") | should | knowledge-base-derived | `04-workout-vocabulary.md` | One-click swap. |
| 35 | "Make it easier" / "Make it harder" coach swap | should | coach-LLM | `04-workout-vocabulary.md` | Day-of adjustment. |
| 36 | "Substitute due to weather/illness/time" picker | should | coach-LLM | `06-weather-adjustments.md`, `00b-recovery-protocols.md` | Real-life flex. |
| 37 | Notes field (pre-run intent + post-run reflection) | must | user-input | — | Personal layer. |
| 38 | RPE log (1–10) post-run | should | user-input | `03-heart-rate-zones.md` | Subjective vs. wearable reconciliation. |
| 39 | Felt-pace tag (easier / on / harder than expected) | nice | user-input | — | Cheap signal. |
| 40 | Post-run completion stats (distance / time / avg pace / avg HR / cadence / power) | must | HealthKit / Garmin / Coros / Strava | `15-wearable-data.md` | The recap if just done. |
| 41 | Per-rep splits table (planned vs. actual, color-coded) | must | HealthKit / Garmin / Coros | `01-pace-zones-vdot.md` | Did the work hit zones? |
| 42 | Map with route + km/mi splits | should | HealthKit / Garmin / Strava | — | Spatial recap. |
| 43 | HR-zone time-in-zone bars | should | HealthKit / wearable | `03-heart-rate-zones.md` | Distribution check. |
| 44 | Pace stability chart (rep-to-rep variance) | nice | app-computed | — | Pacing skill metric. |
| 45 | Cadence + stride length panel | nice | wearable | `16-form-biomechanics.md` | Form trend. |
| 46 | Power (Stryd / Garmin) with target band | nice | Stryd / Garmin | — | Power-zone users. |
| 47 | GAP (grade-adjusted pace) per segment | nice | app-computed | `01-pace-zones-vdot.md` | Honest pace on hilly routes. |
| 48 | Reconciliation banner ("Hit the zones — green / Drift on rep 4 — amber") | should | coach-LLM | `01-pace-zones-vdot.md` | Coach analysis up front. |
| 49 | Coach post-run analysis block (3–5 sentences) | must | coach-LLM | `00a-distance-running-training.md`, `01-pace-zones-vdot.md` | "What this run says." |
| 50 | Adjustment to next workout ("Next T tempo gets +5s/mi target") | should | coach-LLM | `01-pace-zones-vdot.md` | Closed-loop adaptation. |
| 51 | Photo attachment | nice | user-input | — | Day-one journal pattern. |
| 52 | Music/podcast suggestion (BPM-matched for tempo) | later | external | — | Quality-of-life. |
| 53 | Strava share / Instagram share (with explicit consent) | nice | external | — | Social share opt-in. |
| 54 | Mark as completed (manual override) | should | user-input | — | Treadmill / non-tracked fallback. |
| 55 | Mark as skipped + reason | should | user-input | — | Honest plan adherence. |
| 56 | "Move to tomorrow" 1-click | should | user-input | — | Common life flex. |
| 57 | Lock workout (won't auto-regenerate) | nice | user-input | `08-pacing-and-race-week.md` | Race-week sanity. |
| 58 | Course profile preview (elevation chart) for assigned route | nice | external | `11-course-specific-training.md` | Hilly day awareness. |
| 59 | Headwind/tailwind direction overlay on route | later | weather-API | `06-weather-adjustments.md` | Effort planning. |
| 60 | Daylight/sunrise overlay for AM/PM choice | nice | weather-API | — | Visibility planning. |
| 61 | Buddy/group invite (run-with) | later | external | — | Social — opt-in. |
| 62 | Coach-chat inline ("Ask: should I bail at rep 4?") | should | coach-LLM | — | Conversation in context. |
| 63 | Insight surfacing ("3rd T session this block — economy improving") | nice | coach-LLM + app-computed | — | Pattern from history. |
| 64 | "Why these paces?" tooltip → opens VDOT view | nice | knowledge-base-derived | `01-pace-zones-vdot.md` | Trust on calibration. |
| 65 | Race-pace context ("This T pace is your current HM pace") | nice | app-computed | `01-pace-zones-vdot.md` | Anchor in race terms. |
| 66 | Substitute-with-cross-train option (if injured/sore) | should | coach-LLM | `09-cross-training.md`, `05-injury-return-protocols.md` | Real-life pivot. |
| 67 | Mental-cue list ("relax shoulders, count breath on rep 3") | nice | knowledge-base-derived | `20-mental-training.md` | Pre-rep mental rehearsal. |
| 68 | Form cues for the day's intent | nice | knowledge-base-derived | `16-form-biomechanics.md`, `21-form-corrections.md` | Reps + form pairing. |
| 69 | Strength-pairing note ("Lift today is light — heavy lift tomorrow") | nice | app-computed | `07-strength-programming.md` | Concurrent-training awareness. |
| 70 | Recovery-modality suggestion post-quality (sauna / contrast / sleep target) | nice | coach-LLM | `00b-recovery-protocols.md` | Recovery-as-workout. |

### Plan editing affordances (from this surface)

- Move to another date (drag in mini-calendar or pick).
- Skip with reason.
- Swap to alternative variant (entry/standard/advanced).
- Substitute family (T → I, or run → cross-train).
- Lock the workout.
- Regenerate forward from this date.
- Add note (pre-run intent and post-run reflection separate).

### Quick competitor scan

- **Runna**: per-workout personalized briefings; "Not Feeling 100%" auto-adjust; treadmill mode shows speed and progress; pre-workout briefing is uniquely-generated text.
- **TrainingPeaks**: per-rep target-type richness (pace, HR, power, cadence), structured-workout pre-run preview matches what arrives on watch.
- **Garmin Coach**: workout pushes to watch with audio cues; per-step alerts on/off granularity.
- **Stryd**: power-based execution targets, structured workouts with grade-adjusted power.
- **Final Surge**: structured workouts with multiple target types, sync to Apple Watch and Garmin.
- **McMillan**: paces given as **ranges** not points — important UX choice; "good day / bad day" framing.

### Open questions

- Voice briefing — pre-recorded or TTS? Cost, latency, brand voice tradeoff.
- How long is "history" — last 3 attempts, last 12 months, all time?
- When the user has a power meter, do power targets replace pace targets or live alongside?
- Send-to-watch: send-once or auto-sync each morning?
- Treadmill mode — does the app try to control treadmill (Zwift-style) or just guide the user?
- Should the coach-narrative regenerate as conditions change (heat warning at 6 AM = new "why")?

### Data model implications

- `WorkoutInstance`: structure_segments[] (each with target zones + targets), assigned_route_id, assigned_shoe_id, fueling_plan_id, weather_snapshot, conditions_pace_adjust_factor.
- `WorkoutResult`: per-rep splits (planned vs. actual), HR series, cadence series, power series, GAP per segment, RPE, felt-pace, notes_pre, notes_post, photos[], reconciliation_status.
- Audio-cue schedule: derivable from segments; stored as device-portable schema.

---

## Surface 4 — Web: Pace Zones / VDOT View

### Job-to-be-done

"Show me my training paces and how they were calibrated. Let me update or override. Tell me how confident the system is in this number." Foundation surface — every workout's paces hang off this.

### Element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | Current VDOT (hero number) | must | app-computed | `01-pace-zones-vdot.md` | Single fitness anchor. |
| 2 | VDOT confidence band ("48 ± 1.5 — last test 14d ago") | should | app-computed | `01-pace-zones-vdot.md`, `02-race-time-prediction.md` | Honest uncertainty. |
| 3 | Source-of-VDOT line ("Derived from 21:25 5K, Mar 30") | must | app-computed | `01-pace-zones-vdot.md` | Provenance. |
| 4 | Pace zones table (E / M / T / I / R) with min-max ranges | must | app-computed | `01-pace-zones-vdot.md` | The whole point of the page. |
| 5 | Zone shorthand legend (zone code, % VO2max, % HRmax, anchor) | should | knowledge-base-derived | `01-pace-zones-vdot.md` | Definitional anchor. |
| 6 | Race-equivalent times table (Mile / 3K / 5K / 10K / 15K / HM / M) | must | app-computed | `01-pace-zones-vdot.md`, `02-race-time-prediction.md` | "What can I run today?" |
| 7 | VDOT trend chart (8/26/52 weeks) | should | app-computed | `01-pace-zones-vdot.md` | Trajectory. |
| 8 | "Last calibration" date + "next recommended test" date | should | app-computed | `01-pace-zones-vdot.md` | Stale-data awareness. |
| 9 | Recalibrate from race result (input) | must | user-input | `01-pace-zones-vdot.md` | Race-driven update. |
| 10 | Recalibrate from time-trial / field test | should | user-input | `02-race-time-prediction.md` | Self-test option. |
| 11 | Recalibrate from coach (LLM-driven from training trend) | should | coach-LLM + app-computed | `01-pace-zones-vdot.md` | When recent race is stale. |
| 12 | Manual override toggle (user sets VDOT) | nice | user-input | — | Power-user escape hatch. |
| 13 | Methodology toggle: Daniels VDOT / Pfitz / McMillan / Hansons | should | knowledge-base-derived | `01-pace-zones-vdot.md` | Coach-system preference. |
| 14 | Range vs. point display toggle | nice | — | `01-pace-zones-vdot.md` | McMillan ranges vs. Daniels points. |
| 15 | HR-zone view (Zone 1–5 with bpm ranges + HRR-derived) | should | HealthKit / wearable | `03-heart-rate-zones.md` | HR-by-feel runners. |
| 16 | LT1 / LT2 estimates (from running tests or wearable) | nice | wearable / app-computed | `03-heart-rate-zones.md`, `01-pace-zones-vdot.md` | 3-zone Norwegian users. |
| 17 | Conditions-adjusted paces (today's E pace at 78F = X) | should | app-computed + weather-API | `06-weather-adjustments.md` | Honest day-of pace. |
| 18 | Altitude adjustment factor | nice | app-computed | `11-course-specific-training.md` | Altitude users. |
| 19 | Treadmill-incline adjustment table | nice | knowledge-base-derived | — | Treadmill users. |
| 20 | Pace cap warnings ("E run >M effort = wasted day") | nice | coach-LLM | `01-pace-zones-vdot.md` | Coach honesty. |
| 21 | Weekly cap reminders (T ≤10% / I ≤8% / R ≤5%) | nice | knowledge-base-derived | `01-pace-zones-vdot.md` | Daniels dosing rules. |
| 22 | TID summary (last 4 wks: 78% Z1 / 14% Z2 / 8% Z3) | should | app-computed | `00a-distance-running-training.md` | Polarization view. |
| 23 | Pace-by-distance reference (5K=X, HM=Y, M=Z at current VDOT) | must | app-computed | `02-race-time-prediction.md` | Quick reference. |
| 24 | "Why this VDOT?" coach explanation block | nice | coach-LLM | `01-pace-zones-vdot.md` | Understanding. |
| 25 | Compare-to-prior-VDOT delta ("46 → 48 in 12 wks") | nice | app-computed | `01-pace-zones-vdot.md` | Progression visibility. |
| 26 | Marathon-specific modifier ("VDOT 48 but no MP work yet — predict 3:25, not 3:17") | should | coach-LLM | `01-pace-zones-vdot.md`, `02-race-time-prediction.md` | Honest M-prediction. |
| 27 | Export pace zones (PDF / share to coach) | nice | — | — | Off-app reference card. |
| 28 | Print-friendly summary card | nice | — | — | Pre-race printout. |

### Quick competitor scan

- **VDOT.O2 (Daniels)**: clean lookup tool, table per VDOT, all five paces.
- **McMillan**: pace **ranges** (good day / bad day), six-zone resolution incl. Steady State sub-zone.
- **Garmin Connect**: HR zones based on lab estimate or %max, pace zones derived from "Race Predictor" lab adaptation.
- **Stryd**: power zones (Critical Power), with auto-update from training history.
- **Hansons app**: anchored to pace, less flexibility but plan-coupled.

### Open questions

- Default methodology — Daniels or McMillan? Show both?
- How aggressive should auto-recalibration be? Every workout that beats prediction nudges VDOT, or only races?
- HR zones from Karvonen, %max, or LTHR — pick one default with override?
- When the user races and the result conflicts with predicted VDOT by >2 points, surface a confirmation flow.

### Data model implications

- `FitnessSnapshot`: vdot, lthr, hrmax, ltmax_pace, source_event_id, source_kind (race/timetrial/coach/manual), confidence_score, computed_at.
- Versioned history of FitnessSnapshots (every recalibration is a row).
- `PaceZones` derived view (computed live from active FitnessSnapshot + methodology + conditions).

---

## Surface 5 — Web: Phase / Periodization View

### Job-to-be-done

"Show me the shape of my training cycle — where I've been, where I am, where I'm going. Let me understand the structure." This is the macro view. The Plan Calendar shows weeks; this shows phases.

### Element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | Phase ribbon: full cycle, color-coded blocks (Off / Base / Build / Peak / Taper / Race / Recovery) | must | app-computed | `00a-distance-running-training.md`, `22-plan-templates.md` | Hero. |
| 2 | "Today" pin position on ribbon | must | app-computed | — | Where am I. |
| 3 | Phase name + week N of M label | must | app-computed | `22-plan-templates.md` | Brand-consistent ("Day 8 of 21"). |
| 4 | Days-to-race countdown overlay | must | app-computed | `08-pacing-and-race-week.md` | The driver. |
| 5 | Volume curve overlay (planned weekly mileage as line chart) | should | app-computed | `00a-distance-running-training.md` | Periodization signature. |
| 6 | Intensity curve overlay (% of weekly time at quality) | should | app-computed | `00a-distance-running-training.md` | TID arc. |
| 7 | Long-run progression line (peak weekly long run) | should | app-computed | `22-plan-templates.md` | Endurance progression. |
| 8 | Key-workout markers on timeline (MP long run, dress rehearsal, Yasso 800s, Canova block) | should | app-computed | `04-workout-vocabulary.md`, `11-course-specific-training.md` | Milestone visibility. |
| 9 | B-race / tune-up race markers | should | user-input | `08-pacing-and-race-week.md` | Mid-cycle race. |
| 10 | Phase narrative (per-phase coach paragraph: what we're doing, why, what success looks like) | must | coach-LLM | `00a-distance-running-training.md`, `22-plan-templates.md` | The "why" voice. |
| 11 | Phase-specific dosing rules ("base: cap T at 10% wkly mi") | nice | knowledge-base-derived | `01-pace-zones-vdot.md` | Daniels caps. |
| 12 | Phase-specific strength block overlay | should | app-computed | `07-strength-programming.md` | Concurrent training arc. |
| 13 | "What changes when you transition" block (Base→Build, Build→Peak, etc.) | nice | knowledge-base-derived | `00a-distance-running-training.md` | Transition awareness. |
| 14 | Periodization model name (Linear / Reverse / Canova / Block) | should | knowledge-base-derived | `00a-distance-running-training.md` | Methodology transparency. |
| 15 | Compare-cycles overlay (this cycle vs. prior cycle ghost) | nice | app-computed | — | Year-over-year. |
| 16 | Phase-completion progress bar | nice | app-computed | — | "Base: 6 of 10 wks." |
| 17 | Predicted VDOT trajectory across cycle | nice | coach-LLM | `01-pace-zones-vdot.md`, `02-race-time-prediction.md` | Forward-looking. |
| 18 | Predicted goal-race time band (P50 / P25 / P75) | should | coach-LLM | `02-race-time-prediction.md` | Honest range. |
| 19 | Risk hotspots in cycle (where ACWR likely spikes) | nice | app-computed | `15-wearable-data.md` | Pre-emptive flagging. |
| 20 | Phase edit (extend / shorten / re-anchor to new race date) | should | user-input | `22-plan-templates.md` | Plan flex. |
| 21 | Mesocycle drill-down (4-week building blocks within phase) | nice | knowledge-base-derived | `00a-distance-running-training.md` | Block-periodization users. |
| 22 | Microcycle pattern viewer (typical week shape per phase) | nice | knowledge-base-derived | `22-plan-templates.md` | "Phase pattern." |
| 23 | Past phases archive (prior cycles in same view) | nice | app-computed | — | Self-history. |
| 24 | Plan-source attribution ("Pfitzinger 18/70 base") | nice | knowledge-base-derived | `22-plan-templates.md` | Methodology trust. |
| 25 | Sex/age-specific phase modifier callouts | nice | knowledge-base-derived | `13-sex-specific-training.md`, `14-age-considerations.md` | Adaptation context. |

### Quick competitor scan

- **TrainingPeaks**: PMC chart (CTL/ATL/TSB) plays the phase-arc role; less prescriptive but quantitative.
- **Final Surge**: phase blocks visible on calendar, less standalone.
- **Runna**: phase progress shown as "Week 5 of 12 — Build phase" tagline; minimal viz.
- **Hansons**: cumulative-fatigue principle visible in week shapes.
- **Daniels VDOT.O2**: phase grids per plan, no live arc.

### Open questions

- Is this a separate page or a panel within the Plan Calendar?
- How much detail is right — is this a viz-heavy story page, or a diagnostic tool?
- Should the user be able to see the explicit "rule" behind each phase ("Daniels phase III calls for X")?

### Data model implications

- `Phase` entity: name, start_date, end_date, plan_id, dosing_rules{}, narrative_template_id.
- Phase is a sub-entity of Plan; multiple phases per Plan.

---

## Surface 6 — Web: Strength Training View

### Job-to-be-done

"Show me my lifts and plyos — what to do today, what's the program shape, and how it fits with running." Concurrent training is part of the plan, not adjacent to it.

### Element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | Today's strength session card (if scheduled) | must | app-computed | `07-strength-programming.md` | Hero. |
| 2 | Session type label (Heavy / Power / Plyo / Maintenance / Mobility) | must | app-computed | `07-strength-programming.md` | Intent at a glance. |
| 3 | Per-exercise table (name, sets × reps, % 1RM, RPE cap, rest) | must | app-computed | `07-strength-programming.md` | Execution detail. |
| 4 | Phase × strength matrix display (Off / Base / Build / Peak / Taper) | should | knowledge-base-derived | `07-strength-programming.md` (§2.1) | Inverse-of-run-arc concept. |
| 5 | "Why this lift today" coach narrative | should | coach-LLM | `07-strength-programming.md` | Brand voice. |
| 6 | Pairing context ("Heavy day — light run tomorrow") | should | app-computed | `07-strength-programming.md` | Concurrent-training honesty. |
| 7 | Run-strength interference alert ("Don't lift heavy <24h before quality run") | should | knowledge-base-derived | `07-strength-programming.md` | Avoid the no-no. |
| 8 | Exercise demo video / GIF | should | knowledge-base-derived | `07-strength-programming.md` | Form reference. |
| 9 | Form cue list per exercise | nice | knowledge-base-derived | `07-strength-programming.md`, `21-form-corrections.md` | Cue-based execution. |
| 10 | 1RM tracker per primary lift (squat/dead/RDL/Bulg split etc.) | should | user-input | `07-strength-programming.md` | Auto-load suggestions. |
| 11 | 1RM trend chart | nice | app-computed | `07-strength-programming.md` | Strength progression. |
| 12 | Auto-load suggestion per set ("today: 245 lb at 5×3") | should | app-computed | `07-strength-programming.md` | %1RM math. |
| 13 | Set logger (weight × reps × RPE in-session) | should | user-input | `07-strength-programming.md` | Capture during. |
| 14 | Session timer + rest-timer | nice | app-computed | — | Practical UX. |
| 15 | Plyometric contact-count tracker (per week) | should | app-computed | `07-strength-programming.md` (§2.1) | Phase-volume cap. |
| 16 | Plyo-volume cap warning | nice | knowledge-base-derived | `07-strength-programming.md` | "200/200 weekly contacts." |
| 17 | Equipment toggle (Bodyweight / Cable / Full gym) | should | user-input | `07-strength-programming.md` | Substitution per equipment. |
| 18 | Substitution suggestions per exercise | should | knowledge-base-derived | `07-strength-programming.md` | "No squat rack? Bulg split squat instead." |
| 19 | Single-leg / asymmetry corrective cues | nice | knowledge-base-derived | `07-strength-programming.md` | Glute-med, posterior-chain focus. |
| 20 | Mobility/warmup pre-lift block | nice | knowledge-base-derived | `10-mobility-warmup.md`, `07-strength-programming.md` | Activation. |
| 21 | Session history (last 4–8 sessions per exercise) | should | app-computed | — | Progression visibility. |
| 22 | "Last heavy session" countdown to race | should | app-computed | `07-strength-programming.md` (§2.1) | Race-week cutoff (7–10d). |
| 23 | Phase progression overview (how strength evolves with run cycle) | should | knowledge-base-derived | `07-strength-programming.md` (§2) | Arc visualization. |
| 24 | Concurrent-load score (today's run + lift = total CNS load) | nice | app-computed | `07-strength-programming.md` | Power-user. |
| 25 | Skip / move / substitute affordances | should | user-input | — | Plan flex. |
| 26 | Notes per session | nice | user-input | — | "Felt heavy today." |
| 27 | Pain/injury flag per exercise | should | user-input | `05-injury-return-protocols.md` | Trigger sub or skip. |
| 28 | Compare-to-baseline (relative-strength: squat as %BW) | nice | app-computed | `07-strength-programming.md` | Standardized fitness. |
| 29 | Send to phone / wearable timer cue | nice | external | — | In-gym hands-free. |
| 30 | Lifts-per-week summary (2× sweet spot — `07-strength-programming.md` §1.1) | should | app-computed | `07-strength-programming.md` | Dose visibility. |

### Quick competitor scan

- **Hevy / Strong**: per-exercise log, 1RM tracking, set-by-set capture, rest timers — purpose-built strength UX.
- **Garmin Connect**: strength workouts with set/reps/weight; phone/watch logging.
- **Future**: coach-driven, video-rich; concurrent-training framing minimal.
- **TrainingPeaks**: strength as a generic workout slot; weak per-exercise structure.
- **None of the running apps integrate strength deeply** — opportunity zone.

### Open questions

- Treat strength as a parallel plan sibling, or a sub-track of the run plan?
- Default to bodyweight-only for the user with no gym, or always assume gym access and let them substitute?
- Should the app sync to Hevy / Strong if user prefers those?
- 1RM testing — coach-driven AMRAP estimation, or user enters?

### Data model implications

- `StrengthSession`: scheduled_date, type (heavy/power/plyo/mobility), exercises[].
- `Exercise`: name, sets[], demo_video_url, equipment_required, substitutions[].
- `Set`: target_weight, target_reps, target_rpe, actual_weight, actual_reps, actual_rpe, notes.
- `OneRepMax`: per exercise, history of estimated/tested values.

---

## Surface 7 — iOS: Plan Calendar Swipe View

### Job-to-be-done

"Skim my plan on the go. Swipe through weeks. Tap a day for detail. Make a small edit if needed." Mobile-condensed plan view; light editing only — heavy edits go to web.

### Element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | Week-at-a-time horizontal swipe pager | must | — | — | Native mobile pattern. |
| 2 | Today highlight (filled pill) | must | app-computed | — | Anchor. |
| 3 | Week summary header (mileage planned/actual, days remaining) | must | app-computed | `00a-distance-running-training.md` | Quick read. |
| 4 | Phase tag in header ("Build · Wk 6 of 10") | must | app-computed | `22-plan-templates.md` | Context. |
| 5 | Days-to-race chip | must | user-input + app-computed | `08-pacing-and-race-week.md` | Always visible. |
| 6 | Per-day row: zone color bar + workout name + distance/duration | must | app-computed | `04-workout-vocabulary.md` | List density. |
| 7 | Per-day row: completion glyph (ring / checkmark / strike) | must | HealthKit / Strava | — | Adherence. |
| 8 | Per-day row: actual pace/distance summary if completed | should | HealthKit / wearable | — | Recap inline. |
| 9 | Per-day row: weather glyph | nice | weather-API | `06-weather-adjustments.md` | Quick scan. |
| 10 | Tap-to-detail (push to Workout Detail) | must | — | — | Drilldown flow. |
| 11 | Long-press menu: Move / Skip / Send-to-Watch / Add note | should | user-input | — | Light editing. |
| 12 | Drag-to-reschedule (long-press lift, drop on day) | should | user-input | — | Touch-native. |
| 13 | "Not feeling 100%" 1-tap recalibration | should | coach-LLM | `00b-recovery-protocols.md` | Runna-pattern; high-value. |
| 14 | Toggle: This week / Next week / Month-mini | should | — | — | Zoom flex. |
| 15 | Mini month-grid view (12 cells × N weeks) | nice | app-computed | — | Macro context. |
| 16 | Phase ribbon mini at top of swipe | nice | app-computed | `00a-distance-running-training.md` | Where am I. |
| 17 | Pull-to-refresh (re-sync HealthKit / Strava) | must | — | — | Mobile expectation. |
| 18 | Coach-message banner if plan adjusted recently | should | coach-LLM | — | "Heads-up: tomorrow's tempo moved to Thu." |
| 19 | Add-workout button (+ floating) | nice | user-input | `04-workout-vocabulary.md` | Quick add. |
| 20 | Strength-session row inline when scheduled | should | app-computed | `07-strength-programming.md` | Concurrent visibility. |
| 21 | Quick-jump to today (button if scrolled away) | should | — | — | Navigation aid. |
| 22 | Filter chip: hide rest days / show only quality | nice | — | — | Reading mode. |
| 23 | Race countdown card pinned at top | should | user-input | `08-pacing-and-race-week.md` | Persistent driver. |
| 24 | Edit-on-web hint when complex edit attempted | nice | — | — | Set expectation. |
| 25 | Adherence percentage strip (last 4 wks) | nice | app-computed | — | Honest mirror. |
| 26 | Risk banner (ACWR spike / illness flag) | must | app-computed | `15-wearable-data.md` | Surface critical alerts. |
| 27 | Active-injury banner | must | user-input | `05-injury-return-protocols.md` | Override context. |
| 28 | Shoe-rotation glyph if assigned | nice | app-computed | `17-footwear.md` | Context. |
| 29 | Haptic feedback on swipe-week transitions | nice | — | — | Native feel. |
| 30 | Live Activity opt-in for race-week countdown | nice | — | `08-pacing-and-race-week.md` | iOS-specific surface. |

### Plan editing affordances (mobile)

- Tap-and-hold to lift workout, drag to new day.
- Swipe-left for Skip / Move-tomorrow.
- Swipe-right for Send-to-Watch / Mark-complete.
- "Not feeling 100%" sheet with options (sick / busy / sore / by-feel).
- Single-day re-shuffle; multi-day or cycle regeneration deferred to web with a hint.

### Quick competitor scan

- **Runna**: week-swipe primary view, dynamic recalibration, "Not Feeling 100%" sheet — strong baseline pattern.
- **Garmin Connect**: list-week view with day expansion; less interactive.
- **Strava (training plans)**: simple weekly card, low edit affordance.
- **TrainingPeaks mobile**: full calendar with drag-rearrange; heavier than typical mobile.
- **Apple Fitness+ Custom Plans**: minimal calendar, push-driven.

### Open questions

- Default zoom: week or 2-week? Test with users.
- Should drag-to-reschedule be enabled by default, or opt-in (tutorial-gated)?
- How aggressively to push "open on web for big edits" hints?

### Data model implications

- Same `Workout` entity as web; mobile reads same data, with reduced write surface.
- Sync state visible (last sync timestamp, refreshing state).

---

## Surface 8 — iOS: Workout Detail

### Job-to-be-done

"Show me what I'm about to do, push it to my watch, and start. Pre-run briefing on the device I have in my hand at the door." Reduced from web Workout Detail to a phone-native, action-oriented surface.

### Element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | Workout name + zone color hero | must | app-computed | `04-workout-vocabulary.md` | Identity. |
| 2 | Total distance + duration hero stats | must | app-computed | — | Headline. |
| 3 | Structure visualization (segment bar) | must | app-computed | `04-workout-vocabulary.md` | Pattern at a glance. |
| 4 | Per-segment summary (collapsed; expand for full table) | should | app-computed | `01-pace-zones-vdot.md` | Density-by-default. |
| 5 | "Why this workout today" coach narrative (3 lines) | must | coach-LLM | `22-plan-templates.md` | Brand voice. |
| 6 | "Back off if…" callout | must | coach-LLM | `00b-recovery-protocols.md` | Honest guardrail. |
| 7 | Predicted recovery cost chip (low/med/high) | should | knowledge-base-derived | `00b-recovery-protocols.md` | Schedule context. |
| 8 | Conditions strip (temp + dew + wind + AQI) | must | weather-API | `06-weather-adjustments.md` | Day-of context. |
| 9 | Heat/cold pace adjustment chip | should | app-computed | `06-weather-adjustments.md` | "T pace today: 6:55 not 6:48." |
| 10 | Today's training paces strip (inline E/M/T/I/R) | should | app-computed | `01-pace-zones-vdot.md` | Reference. |
| 11 | Suggested shoe with mileage stamp | should | app-computed | `17-footwear.md` | Auto-rotation. |
| 12 | Suggested route(s) (1–2 picks with elevation glyph) | nice | user-input + external | `11-course-specific-training.md` | Match terrain. |
| 13 | Fueling plan for long/quality (carbs/hr, hydration) | should | coach-LLM | `18-fueling-products.md`, `19-hydration-electrolytes.md` | Pre-run prep. |
| 14 | Pre-run briefing (text + optional voice playback) | nice | coach-LLM | — | Runna-style; on-tap audio. |
| 15 | "Send to Watch" primary button (Apple/Garmin/Coros pickers) | must | external | — | Hero action. |
| 16 | "Start on phone" secondary button (no-watch users) | nice | — | — | Coverage. |
| 17 | Audio cue toggle (verbose / minimal / silent) | nice | user-input | — | Pref. |
| 18 | Last-attempt summary card ("Last time: 6×1K avg 4:12, RPE 8") | should | app-computed | — | Confidence + memory. |
| 19 | Variation switcher (entry/standard/advanced or hill/treadmill) | should | knowledge-base-derived | `04-workout-vocabulary.md` | Day-of swap. |
| 20 | Substitute action sheet ("Sub T tempo for cruise intervals") | should | coach-LLM | `04-workout-vocabulary.md` | Adjustment. |
| 21 | Move-to-tomorrow 1-tap | should | user-input | — | Common flex. |
| 22 | Skip with reason | should | user-input | `00b-recovery-protocols.md` | Honest log. |
| 23 | Notes field (pre + post) | must | user-input | — | Personal layer. |
| 24 | Photo attach | nice | user-input | — | Journal. |
| 25 | Warmup checklist (drills/strides) collapsible | should | knowledge-base-derived | `10-mobility-warmup.md`, `04-workout-vocabulary.md` (§17) | Optional depth. |
| 26 | Cooldown reminder | nice | knowledge-base-derived | `04-workout-vocabulary.md` (§17) | Habit. |
| 27 | Mental cue card | nice | knowledge-base-derived | `20-mental-training.md` | Pre-rep mental rehearsal. |
| 28 | Form cue card | nice | knowledge-base-derived | `16-form-biomechanics.md` | Form-rep pairing. |
| 29 | "Ask coach" inline prompt | should | coach-LLM | — | "Should I bail at 4 reps?" |
| 30 | Live Activity start (Lock Screen segment progress) | nice | — | — | iOS-specific surface for solo phone users. |
| 31 | Post-run reconciliation (when activity returns) | must | HealthKit / Strava / wearable | — | Closes the loop. |
| 32 | Per-rep splits table (planned vs. actual) post-run | must | HealthKit / wearable | `01-pace-zones-vdot.md` | Recap. |
| 33 | RPE prompt post-run (1–10 wheel) | should | user-input | `03-heart-rate-zones.md` | Subjective layer. |
| 34 | Felt-pace tag post-run (easier/on/harder) | nice | user-input | — | Cheap signal. |
| 35 | Coach post-run analysis (3 sentences) | must | coach-LLM | — | Recap voice. |
| 36 | Share to Strava / Instagram (with explicit consent) | nice | external | — | Optional social. |
| 37 | Calendar add (block time pre-run) | nice | external | — | Pre-run calendar block. |
| 38 | Live Activity for active workout countdown | nice | — | — | If user starts on phone. |
| 39 | Strength-pairing note ("Light lift today, heavy tomorrow") | nice | app-computed | `07-strength-programming.md` | Concurrent context. |
| 40 | Recovery suggestion post-quality (sleep target, sauna) | nice | coach-LLM | `00b-recovery-protocols.md` | Recovery-as-workout. |

### Plan editing affordances (mobile workout detail)

- Move to tomorrow / pick day.
- Skip with reason.
- Substitute variant.
- Lock workout.
- Mark complete (manual override / treadmill).
- Add note (pre + post separate).
- Sub family (run → cross-train if injured).

### Quick competitor scan

- **Runna**: pre-workout briefing personalized; treadmill mode shows speed; "Send to Watch" with Apple-Watch-native experience.
- **Garmin Connect mobile**: workout detail with structured intervals; one-tap push to watch; per-step audio cues.
- **TrainingPeaks mobile**: full structured workout detail; per-rep targets visible.
- **Strava (Routes + Workouts)**: minimal workout structure; route-first.
- **Hansons mobile**: simple workout cards, low interactivity.

### Open questions

- Voice-briefing format: real-coach recordings or TTS? Cost/latency.
- Live Activity for active phone-driven workouts — show segment progress, target pace, current pace?
- Treadmill mode UI: speed/incline scrubber for setting up the run?
- Default audio cues — what fires (lap split, target deviation, halfway, finish)?
- One-tap "send to all available watches" or pick-each-time?

### Data model implications

- Same `WorkoutInstance` and `WorkoutResult` as web.
- Live-Activity intent payload schema (segment, target_pace_band, elapsed, remaining).
- Audio-cue schedule serializable to watch + phone playback.

---

## Cross-surface notes

- **Pace zones must be one-source-of-truth.** All eight surfaces read from the same FitnessSnapshot. A user editing VDOT on one surface must update all others within a single sync.
- **Brand discipline**: zone color (E green, M blue-green, T amber-blue, I orange, R red) reused across calendar pills, workout headers, segment bars, library cards.
- **Coach narrative reuse**: same "why this workout" string surfaces on web Workout Detail and iOS Workout Detail; pre-run briefing is a derived voice variant.
- **History is shared**: prior-attempt comparisons and per-workout-name history is the same data on web and mobile, with mobile showing fewer rows.

## Open cross-surface questions

- When a user edits a workout on mobile and the watch already has the prior version pushed, who wins?
- Should "send to watch" happen automatically each morning, or only on user tap?
- How are double-day workouts represented in the calendar cell on both surfaces?
- Locked vs. unlocked dates — visual treatment consistent across web and mobile?
- Coach proactivity threshold — when does the coach surface a "rebalance suggestion" without being asked?

---

Sources for competitor scan (light-touch):

- [TrainingPeaks Athlete User Guide](https://help.trainingpeaks.com/hc/en-us/articles/231472468-TrainingPeaks-Athlete-User-Guide)
- [TrainingPeaks calendar efficiency features](https://www.trainingpeaks.com/coach-blog/speed-up-your-coaching-with-5-trainingpeaks-calendar-efficiency-features/)
- [Final Surge top features](https://site.finalsurge.com/Features)
- [Final Surge structured workouts mobile](https://blog.finalsurge.com/build-edit-and-sync-structured-workouts-in-final-surge-app/)
- [Runna training calendar guide](https://support.runna.com/en/articles/10137793-how-to-use-your-training-calendar)
- [Runna 2026 beginner plans](https://www.runna.com/press/runna-introduces-updated-beginner-running-plans-for-2026)
- [McMillan training plan guide](https://www.mcmillanrunning.com/mcmillan-training-plan-guide/)
- [McMillan zones & workouts](https://www.mcmillanrunning.com/zones-workouts-a-runners-guide-to-training-smarter/)
- [Stryd training plan builder & library](https://blog.stryd.com/2021/09/28/training-plan-builder/)
- [Stridist workout builder](https://stridist.com/features/workout-builder/)
