# C5 — Content Inventory: Log + Run Recap

Inventory of every reasonable element across the Log surface family on web (Activity Feed, Run Detail, Strength Session Detail, Notes & Journal, Photo Log, Search/Filter/Export) and the iOS Run Recap that auto-shows after sync. Inclusive, not curated — the product owner picks what ships.

Auto-logging is the default. Workouts arrive automatically via Watch → HealthKit → backend. Manual logging is a fallback. The Log is therefore primarily a **read** surface with light capture overlays (subjective rating, note, photo), not a data-entry app.

Brand assumed: dark theme, hero numbers, small-caps gray labels, semantic color (green=good/recovery, blue=active/aerobic, purple=milestone/PR, gold=race, red=warn/missed), coach voice in dedicated blocks, honest and direct copy.

KB references use the filenames in `/Research/` (e.g., `15-wearable-data.md`).

---

## Web: Activity Feed (default Log landing)

### Job-to-be-done

"Show me what I've done recently — runs, strength, notes, races — at a glance, and let me drill into any one in two clicks." The Activity Feed is the spine of the Log: reverse-chronological history, scannable, with enough summary per row to know whether to open it.

### Element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | Reverse-chronological feed of activity rows | must | app-computed | — | The page itself. Newest first, infinite scroll or paginated. |
| 2 | Day grouping headers (Today / Yesterday / This week / dated weeks) | must | app-computed | — | Time-aware framing matches brand. |
| 3 | Activity-type icon + color (run / strength / cross / race / note / rest / sick / travel) | must | app-computed | `04-workout-vocabulary.md`, `07-strength-programming.md` | Scannable at a glance. |
| 4 | Run row: distance · duration · avg pace · type chip (E/M/T/I/R/Race) | must | HealthKit / Strava / Garmin / Coros | `01-pace-zones-vdot.md`, `04-workout-vocabulary.md` | The five things needed to identify a run. |
| 5 | Avg HR · cadence · power chips (collapsible) | should | wearable | `15-wearable-data.md` | Power users want them inline. |
| 6 | Reconciliation badge (target hit / partial / missed / no plan) | must | coach + app-computed | `04-workout-vocabulary.md`, `22-plan-templates.md` | The Log's load-bearing brand promise: did the actual match the plan? |
| 7 | Subjective feel chip (1–10 or emoji) if rated | should | user-input | `15-wearable-data.md` | Subjective is the primary signal Saw 2016 says we shouldn't ignore. |
| 8 | Coach one-line takeaway per row | should | coach-LLM | `15-wearable-data.md`, `00b-recovery-protocols.md` | "Held T pace through fatigue — clean session." Inline insight. |
| 9 | Source attribution badge (Watch / Phone / Strava / Garmin / Manual) | should | sync metadata | `15-wearable-data.md` | Where this row came from; matters when sources conflict. |
| 10 | Duplicate/conflict warning chip | must | sync logic | `15-wearable-data.md` | Multi-source dedup is real and visible. |
| 11 | Shoe chip (auto-attributed) | should | shoe rotation | `17-footwear.md` | Inline mileage tracking. |
| 12 | Route/location label | nice | GPS + user routes | `11-course-specific-training.md` | "Lake loop", "Sombrero course". |
| 13 | Weather glyph (temp + condition) | nice | weather backfill | `06-weather-adjustments.md` | Context for why pace was off. |
| 14 | Photo thumbnail (if attached) | nice | user-input | — | Race / view / kit. |
| 15 | Note glyph + first line preview | should | user-input | — | Surface text without opening the run. |
| 16 | Strength row: session name · duration · top-set · tonnage | should | user-input / Hevy import | `07-strength-programming.md` | Strength is part of the same loop as running. |
| 17 | Race row: race name · official time · place · A/B/C tag | must | user-input + sync | `08-pacing-and-race-week.md`, `02-race-time-prediction.md` | Races deserve special row treatment with chip-time canonical. |
| 18 | Cross-training row: type · duration · TRIMP/load equivalent | nice | sync / user-input | `15-wearable-data.md` | Bike/swim/elliptical roll into total load. |
| 19 | Recovery activity row (sauna / massage / sleep ≥9h) | nice | user-input + HealthKit | `00b-recovery-protocols.md` | Recovery modalities matter for analysis. |
| 20 | Rest day pill | nice | app-computed | `00b-recovery-protocols.md` | Confirms rest happened (vs. silent gaps). |
| 21 | Sick day pill | should | user-input | `15-wearable-data.md` | Distinguish sick rest from planned rest. |
| 22 | Travel day pill | nice | calendar / user-input | `12-travel-timezone.md` | Explains the gap. |
| 23 | Day summary row (mileage total · sleep · HRV · subjective) | nice | app-computed | `15-wearable-data.md` | Daily aggregation across activities. |
| 24 | Week summary collapsible header (mileage · TID minutes · long run · key sessions) | should | app-computed | `00a-distance-running-training.md`, `01-pace-zones-vdot.md` | Compresses the feed at week boundaries. |
| 25 | Inline missed-workout reconciliation row ("Tuesday tempo skipped") | should | plan vs actual | `22-plan-templates.md` | Don't hide skipped sessions; show them. |
| 26 | Filter strip (type · date range · distance · pace · shoe · route · tag) | must | app-computed | — | The default landing must support narrowing fast. |
| 27 | Search bar (note text · run name · location) | must | app-computed | — | Free-text recall — "that 18 with Mike". |
| 28 | View toggle (feed / calendar grid / list compact) | nice | app-computed | — | Different mental models, same data. |
| 29 | Multi-select for bulk actions (tag / export / delete manual entries) | nice | user-input | — | Power-user maintenance. |
| 30 | Add-manual-entry button (run / strength / note / cross-train) | should | user-input | — | Fallback for non-tracked sessions. |
| 31 | Voice memo capture (drops a note row) | nice | user-input | — | Post-run voice capture is a Final Surge / Strava-missing pattern. |
| 32 | Quick photo capture (drops photo row attached to today) | nice | user-input | — | Mobile-first capture pattern, but available on web. |
| 33 | Empty-state for first-time user | should | app-computed | — | "Run something. We'll log it." |
| 34 | Sync status indicator + last-sync timestamp | should | sync metadata | — | Trust signal — when did data last move? |
| 35 | "Pending review" tray (auto-detected runs needing rating/note) | nice | app-computed | — | Inbox-zero pattern for the recap loop. |

---

## Web: Run Detail

### Job-to-be-done

"Tell me everything about this one run — the numbers, the conditions, how it matched the plan, and what I should learn from it." This is the deepest analytical surface in the app. Strava-killer territory: more honest reconciliation, more coach voice, less social noise.

### Element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | Hero stat strip: distance · duration · avg pace · avg HR · elevation · calories | must | wearable | `15-wearable-data.md`, `01-pace-zones-vdot.md` | The five-to-six numbers that identify the run. |
| 2 | Run name + edit affordance | must | user-input + auto | — | "Lake loop · Tuesday tempo" — editable. |
| 3 | Date/time started + day-of-week + part-of-day | must | wearable | — | Timestamp anchor. |
| 4 | Run type chip (E/M/T/I/R/Race/Long) auto-classified | must | coach + app-computed | `04-workout-vocabulary.md` | Classifier from name patterns + structure (per recent commit 1c02b3d4). |
| 5 | Reconciliation badge (target hit / partial / missed / unplanned) | must | coach + plan | `04-workout-vocabulary.md`, `22-plan-templates.md` | Did the actual match the prescribed? |
| 6 | Linked workout from plan (clickable to plan view) | must | plan ref | `22-plan-templates.md` | Closes the planned↔actual loop. |
| 7 | GPS map (street/sat/terrain toggle) | must | wearable GPS | `11-course-specific-training.md` | Where it happened. |
| 8 | Map: pace-color overlay along path | should | wearable | `01-pace-zones-vdot.md` | See where you sped up / slowed. |
| 9 | Map: HR-zone color overlay along path | should | wearable | `03-heart-rate-zones.md` | Same idea, HR-anchored. |
| 10 | Map: elevation gradient overlay along path | nice | wearable | — | Hills visually annotated. |
| 11 | Map labels (mile/km markers) | should | wearable | — | Already viewport-aware per recent build. |
| 12 | Strava segments crossed (with time + percentile) | nice | Strava API | — | Familiar "PR on segment" hit. |
| 13 | Auto-splits table (per mile or per km, user pref) | must | wearable | `01-pace-zones-vdot.md` | The single most-read run-detail element. |
| 14 | Manual splits / laps table (from Watch button presses) | should | wearable | — | Workout-defined intervals. |
| 15 | Splits with HR + cadence + power per split | should | wearable | `15-wearable-data.md` | Multi-stream split analysis. |
| 16 | Best efforts strip (1mi / 5K / 10K / HM / fastest km) | should | app-computed | `02-race-time-prediction.md` | "PR within run" detection. |
| 17 | Pace chart over time/distance | must | wearable | `01-pace-zones-vdot.md` | Hero line chart. |
| 18 | Pace chart with prescribed-pace bands overlay | must | plan + app-computed | `04-workout-vocabulary.md`, `22-plan-templates.md` | "Were you in the band?" — the reconciliation visual. |
| 19 | Smoothed pace toggle (raw / 30s / lap) | should | app-computed | `15-wearable-data.md` | Raw GPS pace is noisy — smoothing changes the read. |
| 20 | Grade-adjusted pace (GAP) line | should | app-computed | `06-weather-adjustments.md` | Strava parity; honest hill-aware pace. |
| 21 | Heat-corrected pace equivalent (vs. 50°F neutral) | should | weather + app-computed | `06-weather-adjustments.md` | What the same effort would have run in neutral conditions. |
| 22 | HR chart over time | must | wearable | `03-heart-rate-zones.md`, `15-wearable-data.md` | Effort proxy. |
| 23 | HR chart with zone bands (Z1–Z5) | must | wearable + zones | `03-heart-rate-zones.md` | Time-in-zones visual. |
| 24 | Time-in-zone bars (HR) | should | wearable | `03-heart-rate-zones.md` | Aggregate the chart into a quick read. |
| 25 | Cardiac drift % (1st-half vs 2nd-half HR at same pace) | should | app-computed | `15-wearable-data.md`, `03-heart-rate-zones.md` | Aerobic-decoupling proxy; long-run staple. |
| 26 | Elevation chart with grade | should | wearable | — | Hills explain pace dips. |
| 27 | Cadence chart over time | should | wearable | `16-form-biomechanics.md` | Cadence drift = fatigue signal. |
| 28 | Avg cadence + late-run cadence delta | should | app-computed | `16-form-biomechanics.md` | Chan-Roper pattern: cadence drops in non-elites under fatigue. |
| 29 | Power chart (Stryd or wrist power) | should | Stryd / Garmin / Apple | `15-wearable-data.md` | Power-led runners; compare to CP. |
| 30 | Power zones distribution (vs. CP) | nice | Stryd / app-computed | `15-wearable-data.md` | Like HR zones, but pace-independent. |
| 31 | Avg / max stride length | nice | wearable | `16-form-biomechanics.md` | Stride length × cadence = speed equation. |
| 32 | Vertical oscillation (VO) avg | nice | Garmin / Stryd | `16-form-biomechanics.md` | Form metric; trend not absolute. |
| 33 | Ground contact time (GCT) avg + L/R balance | nice | Garmin / Stryd | `16-form-biomechanics.md` | Asymmetry >2% is a flag. |
| 34 | Vertical ratio (VR = VO / stride length) | nice | Garmin / Stryd | `16-form-biomechanics.md` | Composite efficiency proxy. |
| 35 | Form metrics late-run drift (cadence / GCT / VR vs first-third) | nice | app-computed | `16-form-biomechanics.md` | Diagnostic: where did form break? |
| 36 | Weather card (temp · dewpoint · humidity · wind · AQI · sunrise/sunset) | must | weather-API backfill | `06-weather-adjustments.md` | Context that explains pace and HR. |
| 37 | WBGT / heat-stress flag | should | app-computed | `06-weather-adjustments.md` | One-glance "was this a hot run?". |
| 38 | Air-quality flag (with training adjustment if relevant) | nice | weather-API | `06-weather-adjustments.md` | Wildfire-season aware. |
| 39 | Shoe (auto-attributed from rotation) + edit | must | shoe rotation + user | `17-footwear.md` | Tracks mileage; auto from rotation. |
| 40 | Apparel / kit notes | nice | user-input | — | Cold-day what-worked log. |
| 41 | Subjective feel rating (1–10) prompted post-sync | must | user-input | `15-wearable-data.md` | Saw 2016: subjective beats objective when they disagree. |
| 42 | Felt-pace question ("did this feel slower / same / faster than the watch?") | should | user-input | `03-heart-rate-zones.md`, `15-wearable-data.md` | Decoupling subjective effort from clock. |
| 43 | RPE rating (Borg 6–20 or CR-10) — opt configurable | should | user-input | `15-wearable-data.md` | Endurance-research standard. |
| 44 | Energy / soreness / mood pre-run check pulled in | nice | subjective log | `15-wearable-data.md` | Context window for the run. |
| 45 | Notes (rich text, free-form) | must | user-input | — | The journal anchor; supports tagging. |
| 46 | Voice note (transcribed + audio kept) | should | user-input | — | Post-run capture pattern. |
| 47 | Tags on the run (#injury, #fueling, #gear, #motivation, custom) | should | user-input | — | Cross-cutting search. |
| 48 | Photos (multiple, with EXIF preserved) | should | user-input | — | Race photos, kit, view. |
| 49 | Workout reconciliation block: target paces hit? | must | coach + plan | `04-workout-vocabulary.md`, `01-pace-zones-vdot.md` | Per-segment "in band / above / below". |
| 50 | Workout reconciliation: volume hit? (distance/time vs prescribed) | must | coach + plan | `22-plan-templates.md` | Did the work get done? |
| 51 | Workout reconciliation: structure followed? (intervals counted, recoveries respected) | must | coach + plan | `04-workout-vocabulary.md` | Structured-workout adherence. |
| 52 | Coach analysis paragraph (WHY / FOCUS / NEXT) | must | coach-LLM | `15-wearable-data.md`, all KB | The page's narrative read. Honest, brand-voice. |
| 53 | "Compare to similar past runs" panel (same route / same workout / same shoe) | should | app-computed | — | Trajectory. |
| 54 | Same-workout history mini-chart (last 4 attempts) | should | app-computed | `04-workout-vocabulary.md` | "Are you progressing on this session?" |
| 55 | Easy-pace-at-same-HR comparison strip | should | app-computed | `15-wearable-data.md`, `03-heart-rate-zones.md` | Aerobic improvement signal. |
| 56 | Effective VO2max contribution (if hard run) | nice | app-computed | `15-wearable-data.md` | Garmin/Firstbeat-style estimate update. |
| 57 | Training-load contribution (TRIMP / TSS / rTSS) | should | app-computed | `15-wearable-data.md` | Single-source per `15` source-of-truth rule. |
| 58 | CTL/ATL/TSB delta from this run | nice | app-computed | `15-wearable-data.md` | "This added X to fitness, Y to fatigue." |
| 59 | Fueling effectiveness panel (gels taken vs plan, hydration vs plan, late-run cracks) | should | user-input + plan | `18-fueling-products.md`, `19-hydration-electrolytes.md` | Long-run / race specific. |
| 60 | Fueling timeline overlay on pace chart (gels taken at miles X / Y) | nice | user-input | `18-fueling-products.md` | Did energy hold post-fuel? |
| 61 | Music played (Apple Music / Spotify integration) | nice | Apple Music API | `20-mental-training.md` | What was on; correlates with pace surges for some users. |
| 62 | BPM-vs-cadence correlation (music tempo) | later | Apple Music + cadence | `16-form-biomechanics.md` | Tempo lock-in is a real coaching cue. |
| 63 | Route name + saved-route link | nice | app + user | `11-course-specific-training.md` | "Sombrero loop, 3rd time this month". |
| 64 | Strava segments table | nice | Strava API | — | Crossed segments with rank. |
| 65 | Source attribution + raw file (.fit / .gpx) link | should | sync metadata | `15-wearable-data.md` | Power-user transparency; per `15` source-of-truth rule. |
| 66 | Edit affordances (rename · re-tag · re-classify · re-link to workout · merge with another · delete manual) | must | user-input | — | When sync gets it wrong. |
| 67 | Re-classify run type dropdown | should | user-input | `04-workout-vocabulary.md` | Override classifier. |
| 68 | Trim start/end (drop driving-to-trailhead noise) | nice | user-input | — | Cleanup. |
| 69 | Manual HR / pace edit (when sensor failed) | nice | user-input | `15-wearable-data.md` | Rare but matters for canonical record. |
| 70 | Share controls (Strava / Apple Health / link) | should | user-input | — | Explicit consent per privacy. |
| 71 | Export controls (.fit / .gpx / .csv / pdf summary) | should | user-input | — | Portability. |
| 72 | Privacy zone toggle (hide start/end of map) | should | user-input | `15-wearable-data.md` | Strava heatmap risk; explicit. |
| 73 | "Ask the coach about this run" inline prompt | should | coach-LLM | — | Specific question on this dataset. |
| 74 | Comments / reactions (if shared) | later | social | — | Optional social layer; off by default. |
| 75 | Race-detail upgrade banner (if race row) | should | app-computed | `08-pacing-and-race-week.md` | "This is a race — open full race recap". |
| 76 | Health flags caused by this run (RHR spike next morning, HRV dip) | nice | app-computed | `15-wearable-data.md` | Connect cause to next-day state. |
| 77 | Time-of-day comparison ("you run faster in PM") | later | app-computed | — | Pattern detection. |
| 78 | Recovery cost estimate ("plan for 36h easy after this") | nice | coach-LLM | `00b-recovery-protocols.md` | Forward-looking honest read. |

---

## Web: Strength Session Detail

### Job-to-be-done

"Show me what I lifted, how it compares to last time, and whether I'm progressing." Smaller surface than runs but load-bearing for runners following structured strength (Pfitzinger / Hansons-paired strength, posterior-chain work).

### Element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | Session name + date + duration | must | user-input | `07-strength-programming.md` | Identity. |
| 2 | Session type tag (lower / upper / full / posterior chain / plyo / mobility) | should | user-input + classifier | `07-strength-programming.md` | Concurrent-training context. |
| 3 | Exercise list (ordered, with thumbnail / form-cue link) | must | user-input | `07-strength-programming.md` | Body of the page. |
| 4 | Per-exercise: sets · reps · weight (or bodyweight / band) | must | user-input | `07-strength-programming.md` | The numbers. |
| 5 | Per-set: RPE (1–10) | should | user-input | `07-strength-programming.md` | RPE-driven progression beats fixed weights. |
| 6 | Per-set: tempo / rest noted | nice | user-input | `07-strength-programming.md` | Eccentric tempo matters for posterior-chain work. |
| 7 | Per-exercise notes | should | user-input | — | "Right glute fired better than usual." |
| 8 | Comparison to last session (same exercise) — weight / reps / RPE delta | must | app-computed | `07-strength-programming.md` | "Did I progress?" answer. |
| 9 | Tonnage per exercise + session total (sets × reps × weight) | should | app-computed | `07-strength-programming.md` | Volume metric Hevy / StrongLifts use. |
| 10 | E1RM estimate per top set (Epley / Brzycki) | nice | app-computed | `07-strength-programming.md` | Strength progression proxy. |
| 11 | PR badges (rep PR / tonnage PR) | should | app-computed | `07-strength-programming.md` | Motivation. |
| 12 | Coach analysis (WHY / FOCUS / NEXT) — concurrent-training framing | should | coach-LLM | `07-strength-programming.md`, `00a-distance-running-training.md` | "This session was hip-extension focus, paired with tomorrow's tempo." |
| 13 | Reconciliation to plan (was strength scheduled? did it match?) | should | plan vs actual | `07-strength-programming.md` | Same loop as runs. |
| 14 | Pre/post-run timing (gap to morning run, gap to next quality) | nice | app-computed | `07-strength-programming.md` | Concurrent-training scheduling matters. |
| 15 | Subjective feel rating | should | user-input | `15-wearable-data.md` | Same axis as runs. |
| 16 | Photos (form check, gym, body comp opt-in) | nice | user-input | — | Form-self-check. |
| 17 | Voice / video form clip (linked) | nice | user-input | `16-form-biomechanics.md` | Self-analysis ties to form research. |
| 18 | Tags (#injury, #pr, #deload, #posterior-chain) | should | user-input | — | Searchable. |
| 19 | Tonnage trend chart (last 8 / 12 weeks) | nice | app-computed | `07-strength-programming.md` | Macro view. |
| 20 | Per-exercise progression chart (e.g., RDL load over time) | should | app-computed | `07-strength-programming.md` | The Hevy hero feature. |
| 21 | Source: manual / Hevy import / Strong import | should | sync metadata | — | Most users will hand-enter or import. |
| 22 | Edit affordances (modify sets, add note, delete) | must | user-input | — | — |
| 23 | Duplicate-as-template button | should | user-input | `07-strength-programming.md` | "Run yesterday's session again." |
| 24 | Linked running session (same day / paired plan) | nice | plan + app-computed | `07-strength-programming.md` | Concurrent-training connection. |
| 25 | Injury flag if exercise relates to active injury | should | injury + exercise meta | `05-injury-return-protocols.md` | "You did calf raises while flagged for Achilles." |

---

## Web: Notes & Journal

### Job-to-be-done

"Capture an observation, a feeling, or a piece of context — and find it again later." Free-form text + structured tags. Day One / Apple Notes pattern, athlete-specific tag set, and surfaces back into relevant contexts (run detail, coach replies, race recap).

### Element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | Free-form rich-text body | must | user-input | — | Any thought, any length. |
| 2 | Voice-to-text capture | should | user-input | — | Post-run while walking; native iOS dictation. |
| 3 | Audio-clip attachment (kept alongside transcript) | nice | user-input | — | Source-of-truth for tonal notes. |
| 4 | Date/time stamp + edit history | must | app-computed | — | When was this written. |
| 5 | Attached-to entity (run / strength / race / day / standalone) | should | user-input | — | Context anchor. |
| 6 | Structured tag picker (#injury, #motivation, #gear, #fueling, #form, #weather, #travel, #sleep, #stress, #pr, custom) | must | user-input | `05-injury-return-protocols.md`, `18-fueling-products.md`, `17-footwear.md` | Cross-cutting search and surfacing. |
| 7 | @mentions for people (training partner / coach / PT) | nice | user-input | — | "Ran with @Mike". |
| 8 | Body-region tag (left calf / right knee / IT band) for #injury notes | should | user-input | `05-injury-return-protocols.md`, `16-form-biomechanics.md` | Body-map integration. |
| 9 | Severity slider for #injury notes (0–10 pain) | should | user-input | `05-injury-return-protocols.md` | Trend pain over time. |
| 10 | Search across all notes (text + tag + date range) | must | app-computed | — | "Find all #fueling notes from last marathon block." |
| 11 | Note timeline view (chronological journal) | should | app-computed | — | Day One pattern. |
| 12 | Filter by tag | must | app-computed | — | "Show me all #injury notes." |
| 13 | Tag cloud / frequency view | nice | app-computed | — | Pattern: "I write about gear a lot in heat." |
| 14 | Surfaces in run detail (notes attached to that run) | must | app-computed | — | The Log loop closes here. |
| 15 | Surfaces in race detail (notes from race-week, race day, post-race) | must | app-computed | — | Race recap pulls from journal. |
| 16 | Surfaces in coach replies (coach reads notes when asked relevant questions) | should | coach-LLM | — | "Last time you fueled at 75 min, you cracked at 18mi." |
| 17 | Daily journal prompt ("What worked? What didn't?") | nice | app-computed | `20-mental-training.md` | Optional daily nudge. |
| 18 | Pre-race journaling template | nice | app-computed | `08-pacing-and-race-week.md`, `20-mental-training.md` | Sport-psych pattern. |
| 19 | Post-race lessons-learned template | should | app-computed | `08-pacing-and-race-week.md`, `20-mental-training.md` | Codify learning. |
| 20 | Markdown / formatting | should | user-input | — | Power users. |
| 21 | Inline images / photos in note body | should | user-input | — | Mixed-media journal. |
| 22 | Privacy flag per note (private / shareable) | must | user-input | — | Some notes are personal; default private. |
| 23 | Pin/star important notes | nice | user-input | — | "This is the breakthrough run note." |
| 24 | Export journal (markdown / pdf / CSV of tags) | should | user-input | — | Portability. |
| 25 | Word count / streak tracking (opt-in) | nice | app-computed | `20-mental-training.md` | Gentle nudge, not gamified. |

---

## Web: Photo Log

### Job-to-be-done

"Find the photo from that race / route / kit setup, see when and where it was taken, and connect it to the run it belongs to."

### Element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | Grid view of all photos (chronological, scroll-back) | must | user-input | — | Apple Photos pattern. |
| 2 | Auto-attach to run via EXIF timestamp + GPS | must | app-computed | — | Photo taken during a run → linked. |
| 3 | EXIF metadata extraction (date · time · GPS · camera · altitude) | should | app-computed | — | Free metadata; useful. |
| 4 | Filter by category (race / kit/gear / route view / body comp / training partner / other) | should | user-input | — | Drill-down without folders. |
| 5 | Race photo bucket (auto-detected on race-day timestamps) | should | app-computed | `08-pacing-and-race-week.md` | "All photos from Sombrero". |
| 6 | Race-photo-service import (MarathonFoto / FinisherPix / SportsPhoto API) | nice | external API | `08-pacing-and-race-week.md` | Pulls professional race photos. |
| 7 | Body composition private bucket (locked behind biometric / passcode) | should | user-input | `13-sex-specific-training.md` | Privacy-first body-comp tracking. |
| 8 | Gear / kit bucket linked to gear entries | nice | user-input + gear | `17-footwear.md` | "Photos of the Pegasus 41". |
| 9 | Map view of geotagged photos | nice | app-computed | — | Where was I? |
| 10 | Photo search (caption · tag · location) | should | user-input | — | Recall. |
| 11 | Caption / note per photo | should | user-input | — | Context. |
| 12 | Tags inherited from attached run | should | app-computed | — | Auto-categorization. |
| 13 | Bulk select + bulk tag / bulk export | nice | user-input | — | Maintenance. |
| 14 | Privacy flag per photo (default private; explicit share) | must | user-input | — | Body-comp + location-sensitive. |
| 15 | Drop-zone upload (web) + native iOS picker (mobile) | must | user-input | — | Capture. |
| 16 | EXIF GPS strip on share (default on) | should | user-input | `15-wearable-data.md` | Privacy-respecting export. |
| 17 | Storage usage indicator | nice | app-computed | — | Power-user transparency. |
| 18 | Surfaces in run detail / race detail | must | app-computed | — | Photos appear where they belong. |

---

## Web: Activity Search / Filter / Export

### Job-to-be-done

"Find a specific run, set of runs, or activity record fast — and pull it out of the app when needed."

### Element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | Free-text search (run name · note text · location · race name) | must | app-computed | — | The default fallback. |
| 2 | Filter: activity type (run / strength / race / cross / note / rest / sick) | must | app-computed | `04-workout-vocabulary.md` | Most common narrowing. |
| 3 | Filter: date range (presets + custom) | must | app-computed | — | Standard. |
| 4 | Filter: distance range (slider) | should | app-computed | — | "Find my long runs." |
| 5 | Filter: duration range | nice | app-computed | — | — |
| 6 | Filter: avg pace range | should | app-computed | `01-pace-zones-vdot.md` | "Find tempos at ≥ T pace." |
| 7 | Filter: avg HR range / HR zone | should | app-computed | `03-heart-rate-zones.md` | "Find Z2 long runs." |
| 8 | Filter: shoe (multi-select) | should | shoe rotation | `17-footwear.md` | Shoe-specific analysis. |
| 9 | Filter: route / location (multi-select) | should | app-computed | `11-course-specific-training.md` | Same-course history. |
| 10 | Filter: workout type chip (E/M/T/I/R/Long/Race) | should | app-computed | `04-workout-vocabulary.md` | Quality-only views. |
| 11 | Filter: tag (multi-select) | must | app-computed | — | #injury, #fueling, etc. |
| 12 | Filter: weather conditions (temp range, dewpoint, AQI) | nice | weather backfill | `06-weather-adjustments.md` | "All hot runs above 70°F." |
| 13 | Filter: subjective feel range | nice | user-input | — | "All the runs that felt awful." |
| 14 | Filter: source (Watch / Strava / Garmin / manual) | nice | sync metadata | `15-wearable-data.md` | Data hygiene. |
| 15 | Filter: reconciliation outcome (hit / missed / unplanned) | should | coach + plan | `22-plan-templates.md` | "All my missed tempos." |
| 16 | Saved filter views (named) | should | user-input | — | "Long runs in heat" preset. |
| 17 | Sort controls (date / distance / pace / HR / feel) | must | app-computed | — | — |
| 18 | Result count + sum stats (total miles · total time · avg pace) | should | app-computed | `00a-distance-running-training.md` | Useful aggregation. |
| 19 | Bulk export: GPX / TCX / FIT / CSV / PDF | should | user-input | — | Portability. |
| 20 | Per-run export: GPX / TCX / FIT / CSV / PDF | must | user-input | — | Standard. |
| 21 | Coach-summary export (PDF — for sharing with PT / human coach) | nice | coach-LLM + app-computed | — | Differentiator. |
| 22 | Annual / cycle CSV (training-block report) | nice | app-computed | `22-plan-templates.md` | Marathon-block dump. |
| 23 | Strava / Garmin re-push | nice | external API | — | "Resync to Strava." |

---

## iOS: Run Recap (post-sync)

### Job-to-be-done

"I just finished a run — show me how it went in 5 seconds, let me capture how it felt in 10, and link me to the deep view if I want it." Auto-prompts after sync settles. Mobile-condensed: 4–5 hero stats, prescription overlay, one-line coach voice, subjective rating, share/note/photo, link to web for the deep dive.

### What auto-shows after sync

The recap appears as a sheet (or full-screen card) when the watch finishes pushing data via HealthKit. Triggers: activity-end + sync-complete + user opens phone within 60 minutes. After that window, it becomes a dot in the Today feed.

### Element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | Hero stat block (4–5 numbers): distance · duration · avg pace · avg HR · elevation | must | wearable | `15-wearable-data.md`, `01-pace-zones-vdot.md` | The "how did it go" answer in 2 seconds. |
| 2 | Run name (auto + edit) | must | user-input + auto | — | Identity. |
| 3 | Run-type chip (E/M/T/I/R/Race/Long) — auto-classified | must | coach + app-computed | `04-workout-vocabulary.md` | One-glance classification. |
| 4 | Reconciliation badge (hit / partial / missed / unplanned) | must | coach + plan | `04-workout-vocabulary.md`, `22-plan-templates.md` | Did the actual match the plan? Hero status here. |
| 5 | Pace chart with prescribed-pace overlay (compact) | must | wearable + plan | `01-pace-zones-vdot.md`, `04-workout-vocabulary.md` | Single visual that proves the badge. |
| 6 | HR chart (compact, with zone bands) | should | wearable | `03-heart-rate-zones.md` | Effort proxy. |
| 7 | Splits list (per mile or per km, scroll) | should | wearable | `01-pace-zones-vdot.md` | Mobile-tappable split cards. |
| 8 | Best efforts strip (1mi / 5K PR within run) | nice | app-computed | `02-race-time-prediction.md` | Surprise-and-delight. |
| 9 | Coach voice block (1–2 sentences, WHY + NEXT) | must | coach-LLM | `15-wearable-data.md`, all KB | The narrative read. Honest, brand-voice, not a paragraph. |
| 10 | Subjective feel prompt (1–10 slider, primary CTA) | must | user-input | `15-wearable-data.md` | Subjective wins per Saw 2016; capture while fresh. |
| 11 | Felt-pace chip ("easier / same / harder than the watch") | should | user-input | `15-wearable-data.md` | Decoupling subjective from objective. |
| 12 | Quick-add note (text + voice) | must | user-input | — | "How did that feel?" capture in one tap. |
| 13 | Voice-memo button (transcribed) | should | user-input | — | Walking-cooldown capture. |
| 14 | Quick-add photo button | should | user-input | — | Race photo / kit / view. |
| 15 | Tag picker (compact, common tags pre-shown) | should | user-input | — | One-tap #injury / #fueling. |
| 16 | Weather summary chip (temp · dewpoint · AQI) | should | weather backfill | `06-weather-adjustments.md` | Why pace was off. |
| 17 | Heat-corrected pace chip ("≈ 7:25/mi in neutral conditions") | should | app-computed | `06-weather-adjustments.md` | Honest pace read. |
| 18 | Shoe used + remaining mileage chip | should | shoe rotation | `17-footwear.md` | Auto + reorder context. |
| 19 | Training-load contribution ("+45 TSS · ATL → 72") | nice | app-computed | `15-wearable-data.md` | Power-user one-liner. |
| 20 | Recovery cost projection ("plan for easy tomorrow") | should | coach-LLM | `00b-recovery-protocols.md` | Forward-looking honest read. |
| 21 | Health flags ("HR was elevated for this pace — watch RHR tomorrow") | should | coach + wearable | `15-wearable-data.md` | Pre-illness / fatigue early-warn. |
| 22 | "Full detail" link → web Run Detail in browser or in-app webview | must | app-computed | — | The escape hatch to the deep view. |
| 23 | Share sheet (Strava / Apple Health re-share / link / image) | should | user-input | — | Explicit consent. |
| 24 | "Re-link to a different planned workout" affordance | nice | user-input + plan | `22-plan-templates.md` | Classifier was wrong. |
| 25 | "This wasn't my run" / merge-or-delete | should | user-input | `15-wearable-data.md` | Multi-source dedup escape. |
| 26 | Streak / consistency micro-update | nice | app-computed | `20-mental-training.md` | Gentle, not preachy. |
| 27 | Race-detail upgrade banner (if race) | should | app-computed | `08-pacing-and-race-week.md` | Race recap takes over. |
| 28 | Live Activity wind-down / lock-screen recap card | nice | iOS Live Activity | — | Glanceable from lock screen for ~30 min. |
| 29 | Fueling check-in ("did the gels land?") on long runs only | should | user-input | `18-fueling-products.md`, `19-hydration-electrolytes.md` | Long-run-specific capture. |
| 30 | Dismiss / snooze / "remind me to rate later" | should | user-input | — | Don't force the rating gate. |

---

## Subjective rating capture — recommendation

Three viable rating axes exist:

| Axis | Scale | Pros | Cons |
|---|---|---|---|
| Borg RPE 6–20 | Tied historically to HR (HR ≈ RPE × 10) | Endurance-research standard; decades of literature | Awkward range; users don't intuit "13 = somewhat hard"; HR mapping is poor in modern training (β-blockers, individual HRmax variance) |
| CR-10 (Borg Category-Ratio) | 0–10 | Cleaner mental model; modern endurance default for sRPE; multiplied by duration = session-RPE training load | Still requires anchoring ("0 = nothing, 10 = maximal") |
| Simple 1–5 | 1–5 stars or labels | Lowest friction; fast capture | Coarse — collapses real differences; harder to detect drift |
| Emoji (5-face) | Faces | Lowest cognitive load; mobile-native | Ambiguous semantics; not analytically useful for trends |

**Recommendation: CR-10 (0–10) as the default subjective-feel scale**, surfaced as a slider with anchor labels at 0 ("nothing"), 5 ("hard"), and 10 ("max effort, can't continue"). Reasons:

1. **Session-RPE × duration is the most validated subjective training-load metric** in endurance research (Foster et al.). It composes with duration to give an honest internal-load number that complements wearable TRIMP/TSS/Strain.
2. **Users intuit 0–10 better than 6–20.** Casual runners hit a wall at "what's a 14?". A 0–10 scale matches consumer-app expectation (Apple's Mindfulness, Whoop's tag system, Final Surge).
3. **It composes with felt-pace, energy, and soreness** — all already 0–10 in the brand surface — so the user learns one axis.
4. **Power users can opt in to the full Borg 6–20 in settings** for parity with TrainingPeaks if they want.

Pair with a **single emoji-face quick-tap** as a fallback when the user dismisses the slider — at least capture *something* rather than nothing. Surface emoji on activity rows only when the slider is unset.

Avoid the simple 1–5: too coarse to detect overreach drift (HRV CV-style destabilization needs more resolution). Avoid emoji as the primary: ambiguous when surfaced back to coach.

---

## Quick competitor scan

- **Strava activity detail.** Strong: GPS map with pace overlay, splits, segments, social photos, kudos. Missing: workout reconciliation (no concept of prescribed vs actual), no heat-corrected pace, no coach voice. The bar to clear on visuals; the bar to surpass on honesty.
- **Garmin Connect run detail.** Strong: density (every metric Stryd/Garmin produces — power, GCT, VO, VR, training load, lactate-threshold detection, recovery time). Weak: 2010-era UI, opaque insights, "training status" black-box. Borrow the metric coverage; reject the UI.
- **Runna run recap.** Strong: clean mobile recap with prescribed-paces overlay and a coach paragraph. Missing: depth of post-run drill-down, weather correction, journal capture. Closest to the iOS Run Recap target.
- **Final Surge.** Strong: rich note/journal model with structured tags (it's an athlete-coach platform first), per-set strength tracking, RPE per session. Weak: bare visual layer, no coach-LLM. Borrow the journal + tag model and the strength session structure.
- **Apple Workouts (Fitness app).** Strong: clean hero stats, native HealthKit data, Live Activities. Missing: any concept of structured training, reconciliation, journal, photos, coach. The minimalist baseline; we are the opposite.
- **Runalyze.** Strong: cardiac drift, heat-corrected pace (effective VO2max), TRIMP/TSS, training-load math done right. Weak: niche UI, Euro power-user audience. The analytics target.

---

## Open questions

1. **When does the iOS recap auto-prompt vs. wait?** In-app sheet on next foreground? Push notification 30 min after activity end? Locked behind "you opened the app within 1 hour"? Test: too aggressive feels nagging; too passive misses the freshness window for subjective rating.
2. **What's the right granularity for reconciliation badges?** Binary hit/miss is brittle (a tempo run that hit pace but came up 0.4 mi short is "miss"?). Three-state (hit / partial / miss) is the proposed default — confirm with user testing.
3. **How is the "linked workout" set when the watch wasn't given a structured workout?** Time-window match to the day's plan? User confirms on recap? Coach classifier picks?
4. **Subjective rating: required or skippable?** A required gate maximizes capture but trains users to give garbage 5s to dismiss. Suggest skippable with a "remind me later" + a gentle nudge after 24h.
5. **Voice notes: transcribe locally (Whisper / iOS dictation) or cloud?** Privacy implications; transcription quality varies for sweaty post-run audio.
6. **Photo race-bucket detection: timestamp + GPS only, or use vision (race bib detection)?** Vision is heavier but more accurate.
7. **Multi-source conflict UI: auto-resolve and show a "merged from X and Y" badge, or always require user confirmation?** Default policy: auto-resolve via the source-of-truth rules in `15-wearable-data.md` (raw recorder wins), surface a chip, allow override.
8. **How prominent should "delete this run" be?** Strava hides it deep; Garmin makes it fairly visible. Manual entries: easy delete. Synced canonical activities: harder, with a confirm.
9. **Body-composition photos: separate app section or hidden bucket in Photo Log?** Privacy and eating-disorder risk are real (per `13-sex-specific-training.md`). Recommend: hidden bucket, biometric-locked, opt-in feature, no aggregation surfacing.
10. **Strength session: do we model template-and-instance, or just a flat session record?** Template-and-instance is correct (lets the user "run yesterday's session again") but heavier. Suggest template-and-instance once session count > N, flat otherwise.
11. **Weather backfill source: NOAA / OpenWeather / Apple WeatherKit?** WeatherKit is native iOS; NOAA is free but US-only; OpenWeather is most-coverage with cost. Default WeatherKit on iOS, OpenWeather server-side.
12. **Race photo service integration: which provider(s)?** MarathonFoto, FinisherPix, SportsPhoto, Sportograf. Each has different licensing terms; some are paywalled photos. Defer to v2.

---

## Data model implications

The Log surface family asserts the following on the backend:

- **Activity entity must support**: GPS stream, HR stream, cadence stream, power stream, elevation stream, GCT/VO/VR streams, weather snapshot (temp/dewpoint/humidity/wind/AQI/sunrise-sunset), shoe ref, route ref, music ref, source-of-truth metadata (recorder vendor, raw file pointer, sync timestamp, dedup hash).
- **Reconciliation must be a first-class join** between Activity and Workout, with a tri-state outcome (hit / partial / missed) plus per-segment outcomes (target paces hit per interval). Reconciliation should be re-computable when the user re-classifies or re-links.
- **Subjective entity must support** a 0–10 feel rating, a felt-pace chip (easier/same/harder), and optional energy / soreness / mood / motivation 0–10 axes — all attached to a date or activity.
- **Note entity must be polymorphic-attachable**: to Activity, Day, Race, Plan, Strength session, or standalone. Tags are a separate many-to-many.
- **Tag entity** is shared across notes and activities, with a small built-in vocabulary (#injury, #motivation, #gear, #fueling, #form, #weather, #travel, #sleep, #stress, #pr) + user-defined tags + body-region sub-tag for #injury.
- **Photo entity** with EXIF-extracted timestamp / GPS / camera, attachable to Activity / Note / Race / Day, with a privacy flag and a category enum (race / kit / route / body-comp / partner / other). EXIF GPS strip on share by default.
- **Strength session entity** with ordered exercise list, per-set sets/reps/weight/RPE/tempo/rest, per-exercise notes, session-level tonnage, links to Plan and to paired Activity. Template-and-instance pattern.
- **Source-of-truth resolver** per activity: when multiple sources (Watch + Strava + Garmin) provide overlapping records, the resolver picks the raw recorder per `15-wearable-data.md` rules and stores a `merged_from` array.
- **Music ref**: Apple Music / Spotify track-list per activity, stored separately to honor licensing — display in Run Detail but don't redistribute.
- **Coach-analysis entity** is versioned and re-runnable on edit (re-classify, re-link, edit splits → coach analysis recomputes).
- **Voice-memo entity**: audio blob + transcript (separately editable). User must be able to delete the audio and keep the transcript.
- **Run-name auto-generation**: time-of-day + route + workout-type ("Tuesday tempo on lake loop"). Editable.
- **Best-efforts cache**: per-activity sub-distance bests (1mi / 5K / 10K / HM) computed on ingest, stored for fast lookup in Run Detail and in the global PR table.
- **Cardiac-drift, heat-corrected pace, GAP, time-in-zones**: all computed and cached on activity ingest, recomputed when zones / VDOT / weather data updates.
- **Reconciliation re-classification**: when the user re-classifies a run type (e.g., "this was actually a tempo, not a steady"), the reconciliation rerun against the day's prescribed workout (or, if none, against the run-type's expected structure).
- **Privacy zones**: stored at user level (lat/lng/radius), applied to map render at request time — never strip from raw GPS at ingest (would lose canonical data).
- **Edit history**: every edit (rename, re-classify, trim, manual HR override) writes an audit row. Power-user transparency, undo affordance.
