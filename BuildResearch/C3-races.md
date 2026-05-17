# C3 — Content Inventory: Races

Comprehensive inventory of every races-related surface across web and iOS. Eight surfaces: web Race Calendar, web Race Detail (Past), web Race Detail (Upcoming), web Race Goal Calculator, web Race History / Multi-Year Archive, web Course Library, iOS Races (mobile-condensed), iOS Race Day Mode.

KB references use the form `KB-08:§3.5` meaning Research doc 08, section 3.5.

---

## 1. Web: Race Calendar (Past + Upcoming)

### Job-to-be-done

"Show me every race I have on the books — what's coming, what I've finished, and let me jump into any of them in one click." Single timeline anchored on today, with upcoming races above and past races below. Answers: what's next, when, how soon, and what did I just do.

### Element inventory

| Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|
| Page header with athlete name + race count | P3 | User profile, Race entity count | — | Identity + scale ("12 races logged") |
| "Add race" CTA | P0 | n/a (writes Race entity) | — | Calendar must be additive at any time |
| Filter chips (distance, year, status, A/B/C) | P1 | Race entity | — | 50+ races needs filtering |
| Sort toggle (chronological vs. distance vs. time) | P2 | Race entity | — | Multiple lenses on archive |
| Today marker / "now" line | P0 | System clock | — | Anchor for the timeline |
| Next race card (hero, full width above the fold) | P0 | Race entity (next upcoming) | KB-08:§9 | First job is "what's next" |
| Days-to-next-race countdown | P0 | Race entity, system clock | — | Race week proximity drives surface state |
| Upcoming races list (by date asc) | P0 | Race entity (status=upcoming) | — | Core listing |
| Past races list (by date desc) | P0 | Race entity (status=completed) | — | Core listing |
| Race row: name, distance, date | P0 | Race entity | — | Minimum identifier |
| Race row: location (city, country) | P1 | Race entity | KB-12 | Travel context affects taper |
| Race row: A/B/C goal chip | P1 | RaceGoal entity | KB-08:§14.1 | Visible commitment level |
| Race row: course profile mini-sparkline (elevation) | P2 | CourseProfile entity | KB-11 | Hill/flat at-a-glance |
| Race row: weather forecast badge (upcoming, T-7 to T-0) | P1 | Weather API | KB-06:§1, §10 | Heat warning surfaces early |
| Race row: chip-time finish (past) | P0 | RaceResult entity | — | The result is the row |
| Race row: pace + age-grade (past) | P1 | RaceResult, WMA tables | KB-02:§9 | Cross-distance comparison |
| Race row: PR badge | P2 | Computed across Race history | — | Recognition of milestones |
| Race row: vs-prediction delta (past) | P2 | RacePrediction snapshot at T-0 | KB-02:§13.7 | "Did I beat my goal" answer |
| Race row: heat-corrected equivalent (past, hot races) | P2 | Weather log + KB-06:§10.4 | KB-06:§10 | Honest comparison across conditions |
| Race row: training cycle thumbnail | P3 | Plan entity | KB-11:§Periodization | Which build led here |
| Race row: status icon (registered, paid, training, taper, done) | P1 | Race entity status field | — | Logistical readiness |
| Year-divider headers | P2 | Computed | — | Visual grouping |
| Year-summary stat strip (count, total miles, PRs) | P2 | Aggregated RaceResults | — | Fun-stats layer |
| Empty state for upcoming ("no races on the books") | P1 | n/a | — | Onboarding nudge |
| Empty state for past (first-time user) | P2 | n/a | — | Friendly start |
| Bulk import (Strava history, manual upload) | P2 | External APIs | — | Migration path |
| Race-search-and-add (race finder integration) | P3 | Race aggregator API (e.g. Find My Marathon) | KB-08 | Nice-to-have planning utility |
| "View calendar in iCal" / .ics export | P3 | Race entity → ics generator | — | Ecosystem integration |
| Hover preview (mini-card on row hover) | P2 | Race entity | — | Drill-down without click |

---

## 2. Web: Race Detail (Past) — Full Recap

### Job-to-be-done

"Give me the full forensic breakdown of how that race went — the splits, the conditions, what I planned vs. what I executed, what the coach makes of it, and what to learn for next time." This is the single most read-after-the-fact surface in the app.

### Element inventory

| Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|
| Race name + date + location header | P0 | Race entity | — | Identity |
| Distance + chip time (hero) | P0 | RaceResult | — | The headline |
| Gun time vs. chip time | P1 | RaceResult | — | Crowded-start context |
| Overall / age-group / gender place | P2 | RaceResult.placement | — | Competitive context |
| Pace (min/mi or min/km) hero | P0 | RaceResult | — | Companion to time |
| Result chip (PR, course PR, season best, DNF) | P1 | Computed | — | Recognition |
| A/B/C goal achievement bar | P0 | RaceGoal × RaceResult | KB-08:§14.1 | Did the plan land? |
| Predicted-time vs. actual delta | P1 | Predicted snapshot at taper | KB-02:§13.7 | Calibration of the model |
| Heat/altitude-adjusted equivalent time | P1 | KB-06:§10.4 conversion | KB-06:§10 | "What this would have been at sea level / 50°F" |
| Age-graded percentage | P2 | WMA 2023 table | KB-02:§9 | Lifetime comparison |
| Coach narrative block (post-race analysis) | P0 | CoachInsight | — | The "what just happened" voice |
| Coach voice: what worked | P1 | CoachInsight | — | Reinforcement |
| Coach voice: what to fix | P1 | CoachInsight | — | Honest critique |
| Splits table (per mile/km: pace, HR, elevation, cadence) | P0 | Split entity | KB-08:§2.2 | Diaz/Hettinga 5K-segment lens |
| 5K-segment view (marathon) with CV | P1 | Computed | KB-08:§2.2 | Pacing literature standard |
| First-half / second-half split + delta | P0 | Computed | KB-08:§2.1 | Even/positive/negative diagnosis |
| Pace chart (line, with target band overlay) | P0 | Activity stream | — | Pacing narrative |
| HR chart with drift annotation | P1 | Activity HR stream | KB-08:§6.1 | Cardio drift quantified |
| Cadence chart with late-race fade marker | P2 | Activity cadence stream | KB-08:§7.1 | Form failure detection |
| Elevation profile overlay | P1 | Activity stream | KB-11 | Hill segments visible |
| Grade-adjusted pace chart | P2 | Strava-style GAP | KB-06 | Effort vs. raw pace |
| Power chart (if running power available) | P3 | Activity power stream | — | Stryd/Garmin power users |
| Course map with split markers | P1 | Activity GPS | — | Spatial recall |
| Aid station hits (logged or auto-detected) | P2 | FuelingPlan executed | KB-08:§10.5 | Did fueling plan run on time |
| Conditions panel: weather at gun time | P0 | Weather log | KB-06 | Always relevant |
| Conditions: Tair, Td, RH, wind, AQI, sun | P1 | Weather log | KB-06:§1, §2, §6, §9 | Full atmosphere readout |
| Conditions: WBGT and flag color | P2 | KB-06:§3 | KB-06:§3 | Heat-stress framing |
| Conditions: weather slowdown estimate | P1 | KB-06:§10 | KB-06:§10 | Quantify the cost |
| Course profile: total vert, max grade, descent | P1 | CourseProfile | KB-11 | Hill summary |
| Pacing analysis card (CV, fade %, wall trigger) | P0 | Computed splits | KB-08:§2.2, §8.2 | The wall-vs-no-wall verdict |
| 10-10-10 / quartile breakdown (marathon) | P2 | Splits | KB-08:§3.5 | Pacing-method comparison |
| Fueling log (planned vs. taken) | P0 | FuelingPlan + executed log | KB-08:§10.5, KB-18:§11 | Did the plan execute |
| Fueling: gels taken, timing, brand | P1 | FuelingPlan log | KB-18:§3 | Brand-level recall |
| Fueling: total CHO/h, sodium/h, fluid/h | P1 | Computed | KB-18:§1, §5 | Goals vs. actual |
| Fueling: caffeine schedule | P2 | FuelingPlan log | KB-08:§13, KB-18:§6 | Caffeine timing review |
| GI symptoms log | P2 | SubjectiveLog tied to race | KB-18:§14 | Pattern detection across races |
| Pre-race notes (sleep T-2/T-1, taper feel, nerves) | P1 | Note entity | KB-08:§9.4, §11.1 | Context for the result |
| Race morning log (wake, breakfast, caffeine, bathroom) | P2 | Note + SubjectiveLog | KB-08:§11.2, §11.3 | Routine debrief |
| Post-race subjective rating (RPE, satisfaction, soreness) | P1 | SubjectiveLog | — | How it felt |
| Post-race notes (free text + structured prompts) | P1 | Note entity | — | Athlete journaling |
| Post-race recovery context (next 7 days) | P2 | Activities post-race | — | How body responded |
| Equipment used (race shoe, model, miles on it) | P1 | Shoe entity link | KB-08:§17.3 | Gear attribution |
| Other equipment (singlet, socks, bra, watch, fuel belt) | P3 | Equipment links | KB-08:§17.4 | Full kit log |
| Sleep last 7 nights heatmap | P2 | HealthMetric | KB-08:§11.1 | Sleep-bank story |
| HRV trend last 14 days | P2 | HealthMetric | KB-08 | Recovery-state narrative |
| Comparison to previous attempt (same race) | P0 | Race history | — | "Vs. last year" |
| Comparison to most recent race (any distance) | P2 | Race history | KB-02:§9 | Form trend |
| Comparison to similar weather races | P3 | Race history × weather | KB-06 | Heat-corrected leaderboard |
| Comparison to best chunk (mile, 5K, 10K) inside this race | P2 | Computed | — | Internal records |
| Race photos (auto-pulled from race service) | P2 | MarathonFoto/RaceJoy/Sportograf API | KB-08 (research q) | Memory layer |
| User-uploaded photos | P2 | Asset upload | — | Personal moments |
| Bib + finisher's medal photo | P3 | Asset upload | — | Memorabilia |
| Strava activity link | P1 | Strava integration | — | Cross-platform context |
| Garmin Connect link | P1 | Garmin integration | — | Cross-platform context |
| Apple Health activity link | P2 | HealthKit | — | Source-of-truth audit |
| Race results / official link | P2 | Race entity URL | — | Provenance |
| Finisher certificate generator / share card | P3 | Computed render | — | Social share |
| Lessons-learned block (coach + athlete) | P1 | CoachInsight + Note | — | Forward application |
| "Apply to next plan" button (carry lesson into next cycle) | P2 | Plan integration | — | Closes the loop |
| Coach Q&A (ask about this race) | P3 | Coach chat with race in context | — | Conversational drill |
| Edit race / correct splits | P2 | Race entity write | — | Data hygiene |
| Delete race | P3 | Race entity write | — | Mistakes happen |

---

## 3. Web: Race Detail (Upcoming) — Planning Hub

### Job-to-be-done

"This is the cockpit for the race I'm training for. Show me everything I need to commit to it: countdown, course, weather forecast, pacing strategy, fueling plan, race-week schedule, taper, logistics, and how my training is tracking." Becomes the home page in race week.

### Element inventory

| Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|
| Race name + date + location header | P0 | Race entity | — | Identity |
| Days-to-race countdown (hero) | P0 | System clock | KB-08:§9 | Single most-read number |
| Hours/minutes (race week, T-7 to T-0) | P1 | System clock | KB-08:§9.3 | Race-week granularity |
| Race-state chip (build / specific / taper / race-week / race-day) | P0 | Plan phase | KB-08:§9, KB-11 | Drives surface emphasis |
| Editable A/B/C goals (time targets) | P0 | RaceGoal entity | KB-08:§14.1 | Commitment hierarchy |
| Goal pace per mile / per km (each goal) | P0 | RaceGoal | KB-08:§14.1 | Practical paces |
| First-mile target (GP + 5–20s, distance-aware) | P1 | KB-08:§3.1 | KB-08:§3.1 | Highest-leverage decision |
| Halfway split target with band | P1 | KB-08:§14.1 | KB-08:§14.1 | Pacing checkpoint |
| Predicted time (current fitness) | P0 | Race Goal Calculator | KB-02 | Reality check on goals |
| Confidence interval on prediction | P1 | KB-02:§13.7 | KB-02:§13.7 | Honest range, not point estimate |
| Course profile chart (elevation) | P0 | CourseProfile | KB-11 | Course archetype recognition |
| Course archetype label (front-loaded / late-hill / rolling / net-down / flat) | P1 | KB-11 classification | KB-11 | Strategy framing |
| Course total vert, max grade, longest climb | P1 | CourseProfile | KB-11 | Hill load |
| Net elevation (gain - loss) | P2 | CourseProfile | KB-02:§13.2 | PR-potential signal |
| Course map (interactive) | P1 | CourseProfile GeoJSON | — | Spatial study |
| Course landmarks (bridges, key climbs, aid stations) | P2 | CourseProfile annotations | KB-08:§8.1 | Race-chunking landmarks |
| Course recon recommendation | P3 | KB-11 decision rule | KB-11:§Course Recon | When to drive/run course |
| Weather forecast (T-14 to T-0, sliding window) | P0 | Weather API | KB-06 | Decision-driving variable |
| Weather: Tair, Td, RH, wind, sun, AQI at gun time | P1 | Weather API forecast | KB-06:§1, §2, §6, §9 | Full atmosphere |
| Weather slowdown adjustment to goal pace | P0 | KB-06:§10 | KB-06:§10 | Practical re-target |
| WBGT flag projection | P2 | KB-06:§3 | KB-06:§3 | Cancellation/race-day warning |
| Heat acclimation status | P2 | Sauna/heat log + KB-06:§4 | KB-06:§4 | Adaptation completeness |
| Pacing strategy block (even / negative / pos) | P0 | Coach + KB-08 | KB-08:§2.1, §2.3 | Strategy lock-in |
| Pacing strategy: 10-10-10 or quartile or segment (distance-aware) | P1 | KB-08:§3 | KB-08:§3.5 | Specific template |
| Pacing strategy: hill/downhill rules (course-aware) | P1 | KB-08:§4.4, §4.5, KB-11 | KB-08:§4.4, KB-11 | Boston/CIM/SF require effort-based |
| Pre-committed if/then rules (editable) | P2 | RaceGoal.rules | KB-08:§14.3 | Decision-fatigue cut |
| Pace band / wrist-tattoo printable | P2 | RaceGoal render | KB-08:§14.2 | Backup if watch fails |
| Watch field setup recommendation | P3 | KB-08:§14.2 | KB-08:§14.2 | Watch config |
| Fueling plan (gels, drink, caffeine schedule by mile/time) | P0 | FuelingPlan | KB-18:§11, KB-08:§10.5 | Race execution document |
| Fueling totals (CHO/h, fluid/h, sodium/h, caffeine total) | P1 | Computed from FuelingPlan | KB-18:§1, §5, §6 | Goal verification |
| Fueling product picker (brand-by-brand) | P1 | KB-18 catalog | KB-18:§3, §4 | Specific gels chosen |
| Fueling: gut-training status | P2 | Long-run fueling logs | KB-18:§13 | Has 90 g/h been rehearsed |
| Fueling: race-day-conditions adjustment | P2 | KB-18 + KB-06 | KB-18:§1, KB-06:§11 | Hot day cuts gut tolerance |
| Race-week schedule (T-7 to T-0 day-by-day) | P0 | Plan + KB-08:§9.3 | KB-08:§9.3 | Distance-specific template |
| Each race-week day: workout, duration, notes | P0 | Workout entity | KB-08:§9.3 | Daily prescription |
| Taper compliance tracker | P2 | Plan adherence | KB-08:§9 | Did I follow taper |
| Last quality-session check-in (T-3 to T-7) | P2 | Activity reconciliation | KB-08:§9.2 | Final fitness signal |
| Carb-load tracker (g/kg/day across T-3 → T-1) | P1 | NutritionLog | KB-08:§10.1 | Marathon glycogen target |
| Fiber-reduction reminder (T-1 to T-0) | P2 | KB-08:§10.2 | KB-08:§10.2 | GI safety |
| Hydration tracker (T-2, T-1) | P2 | NutritionLog | KB-08:§10.4 | Race-morning hydration |
| Pre-race meal plan | P1 | Meal template | KB-08:§10.3 | Breakfast lock-in |
| Caffeine plan (pre + mid-race doses) | P1 | KB-08:§13, KB-18:§6 | KB-08:§13.2 | Dose + timing |
| Sleep banking tracker (T-7 to T-2) | P2 | HealthMetric.sleep | KB-08:§11.1 | Bank sleep |
| Sleep T-2 emphasis (big-night-is-T-2) | P2 | KB-08:§11.1 | KB-08:§11.1 | Right night to prioritize |
| HRV trend last 21 days | P2 | HealthMetric.hrv | — | Body readiness |
| RHR trend last 21 days | P3 | HealthMetric.rhr | — | Body readiness |
| Bathroom strategy reminder | P3 | KB-08:§11.3 | KB-08:§11.3 | Coffee + porta-potty plan |
| Race morning timeline (T-4h to T-0) | P0 | KB-08:§11.2 | KB-08:§11.2 | Wake-to-gun execution |
| Logistics: hotel, transit, gear-check, parking | P1 | Race.logistics fields | KB-12:§Race-Morning | Travel planning |
| Bib pickup (location, hours, deadline) | P1 | Race.logistics | — | Don't miss expo |
| Corral / wave / start-time | P1 | Race.logistics | — | Specific gun time |
| Travel plan (flights, drive, arrival/departure) | P1 | Race.travel | KB-12:§Pre-Race | Days on-site planner |
| Time-zone shift (zones crossed, direction) | P1 | KB-12 calc | KB-12:§Time Zone | Adaptation days |
| Recommended on-site arrival date | P1 | KB-12 table | KB-12:§Pre-Race | Decision support |
| Light/melatonin protocol (if zones ≥3) | P2 | KB-12:§Light, §Melatonin | KB-12:§Light, §Melatonin | Jet-lag protocol |
| Compression-sock reminder | P3 | KB-12 | KB-12:§Compression | Flight DVT |
| Heat acclimation protocol (if hot destination) | P2 | KB-06:§4 + KB-11 | KB-06:§4, KB-11 | 10–14 day protocol |
| Altitude protocol (if altitude race) | P2 | KB-06:§7, KB-11 | KB-06:§7, KB-11 | Arrival timing |
| Race kit checklist (KB-08:§17.4 expanded) | P1 | KB-08:§17.4 | KB-08:§17.4 | Don't forget X |
| Shoe selection (race shoe + backup) | P1 | Shoe entity | KB-08:§17.3 | ≥40 mi training use, ≤200–250 mi |
| "Nothing new on race day" check (every kit item tested) | P2 | Kit + activity history | KB-08:§17.1 | Failure prevention |
| Visualization / mental prep prompt (T-14 to T-0) | P3 | KB-08:§15.1 | KB-08:§15.1 | Two-week visualization |
| Self-talk phrase library | P3 | KB-08:§15.2 | KB-08:§15.2 | In-race scripts |
| Training cycle progress (current build vs plan) | P1 | Plan adherence | — | Are we on track |
| Key workouts done vs missed | P2 | Workout reconciliation | KB-08:§9.2 | Build verification |
| Predicted-time history graph (week by week) | P2 | RacePrediction snapshots | KB-02 | Form trajectory |
| Coach narrative for this race | P0 | CoachInsight | — | The "where you are" voice |
| Coach voice: confidence statement | P1 | CoachInsight | — | "You're ready / hold form / rebuild" |
| Coach voice: pacing prescription | P1 | CoachInsight | KB-08 | Rationale for the plan |
| Q&A: ask coach about this race | P2 | Coach chat in context | — | Conversational drill |
| "Send race day mode to phone" CTA | P1 | Push to iOS | — | Phone race-day setup |
| Share goals with friends/spectators | P3 | Share-link generator | — | Social commitment |
| DNS / withdraw race | P3 | Race entity write | — | Plans change |

---

## 4. Web: Race Goal Calculator

### Job-to-be-done

"From my recent races and current fitness, what time should I target at this distance — and how confident is the answer?" Stand-alone tool that also feeds Race Detail (Upcoming).

### Element inventory

| Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|
| Target distance picker | P0 | n/a | KB-02 | Required input |
| Target race date | P1 | n/a | KB-02:§13 | Recency-decay applies |
| Recent race input (auto-populated from Race history) | P0 | Race entity | KB-02:§11 | Multi-input default |
| Manual override of recent races | P1 | RaceResult | KB-02:§11 | Edge cases |
| Predictor workout input (Yasso, fast-finish LR, MP tempo) | P2 | Activity log | KB-02:§12 | Alternative when no recent race |
| Riegel prediction | P0 | KB-02:§2 | KB-02:§2 | Default formula |
| Cameron prediction | P1 | KB-02:§3 | KB-02:§3 | Better at >half |
| Daniels VDOT prediction | P0 | KB-02:§4 | KB-02:§4 | Industry-standard |
| Computed VDOT from inputs | P1 | KB-02:§4 | KB-02:§4 | Fitness number |
| Side-by-side prediction comparison | P1 | KB-02:§5.3 | KB-02:§5.3 | Show the spread |
| Empirical exponent fit (from 2+ races) | P2 | KB-02:§11.4 | KB-02:§11.4 | User-specific b |
| Runner type classification (Speedster / Combo / Endurance) | P2 | KB-02:§7 | KB-02:§7 | Curve shape diagnostic |
| Runner-type adjustment applied | P2 | KB-02:§7.3 | KB-02:§7.3 | Shifted prediction |
| Sex-specific adjustment | P3 | KB-02:§10.3 | KB-02:§10.3 | Women's lower exponent |
| Age-grading display | P2 | KB-02:§9 | KB-02:§9 | Masters-relevant |
| Marathon-specificity penalty toggle | P2 | KB-02:§13.1 | KB-02:§13.1 | Without long-run base |
| Weather adjustment input (Tair, Td) | P1 | KB-06:§10 | KB-06:§10 | Race-day forecast |
| Altitude adjustment | P2 | KB-06:§7 | KB-06:§7 | Mountain races |
| Wind adjustment | P3 | KB-06:§6 | KB-06:§6 | Headwind cost |
| Course-profile adjustment (vert) | P2 | KB-02:§13.2, KB-11 | KB-02:§13.2 | Hilly course |
| Confidence interval on each prediction | P0 | KB-02:§13.7 | KB-02:§13.7 | Range, not point |
| Input quality score | P2 | Computed | KB-02:§13 | "Trust this number how much" |
| A/B/C goal generator (stretch / realistic / fallback) | P0 | Computed | KB-08:§14.1 | The output users actually want |
| Pace per mile + per km for each goal | P0 | Computed | — | Practical paces |
| Per-mile / per-km pace band export | P1 | Render | KB-08:§14.2 | Pace-band print |
| Save goals to Race entity | P0 | Write to RaceGoal | — | Connection to Race Detail |
| Equivalent times across distances (table) | P1 | KB-02:§5 | KB-02:§5 | "If I run X 5K, my equivalent half is..." |
| Predictor workout target prescription | P3 | KB-02:§12 + plan | KB-02:§12 | "Run a 3:00 Yasso to confirm" |
| Coach commentary on the prediction | P1 | CoachInsight | KB-02:§14 | "VDOT says X, but specificity gap → Y" |
| History of predictions over the cycle (graph) | P2 | RacePrediction snapshots | — | Form trajectory |
| Print / share goal sheet | P3 | Render | — | Coach handoff |

---

## 5. Web: Race History / Multi-Year Archive

### Job-to-be-done

"Give me the lifetime view: every race I've ever run, sortable, filterable, with PR tracking and trend lines." A different lens than Calendar — Calendar is timeline, this is database.

### Element inventory

| Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|
| Lifetime summary (race count, total miles, distance breakdown) | P0 | Aggregated RaceResult | — | Identity stat |
| Filter: distance, year, status, course | P0 | Race entity | — | Database |
| Sort: date, time, pace, age-grade, conditions | P1 | Race entity | KB-02:§9 | Multiple lenses |
| Search by name / location | P1 | Race entity | — | Fast lookup |
| PR table by distance (current + history of PR resets) | P0 | Computed | — | "What's my best 5K, 10K, half, marathon?" |
| Course PR table (best time at each repeated race) | P1 | Computed by Race.name | — | "My best Boston" |
| Age-graded leaderboard (athlete's own, top 10) | P1 | KB-02:§9 | KB-02:§9 | Account for aging |
| Heat-corrected leaderboard | P2 | KB-06:§10.4 | KB-06:§10.4 | Honest comparisons |
| Race-result row (compact: name, date, distance, time, pace, conditions) | P0 | RaceResult | — | Listing primitive |
| PR badge + delta from previous PR | P1 | Computed | — | Recognition |
| Multi-year progression chart (per distance) | P1 | RaceResult timeline | — | Decade-arc story |
| Pace-vs-fitness curve over years | P2 | VDOT history | KB-02:§11 | Lifetime fitness |
| Year-by-year mileage + races run | P2 | Aggregated | — | Volume trend |
| Conditions distribution (hot/cold/altitude races) | P3 | Weather log | KB-06 | Context layer |
| Course-archetype distribution (flat/rolling/hilly/trail) | P3 | CourseProfile | KB-11 | Athlete preference signal |
| Geographic map (every race location pinned) | P2 | Race.location | — | Travel-history visual |
| Export to CSV | P2 | RaceResult | — | User portability |
| Strava import (bulk historical) | P1 | Strava integration | — | Migration path |
| Comparison view (side-by-side any two races) | P2 | RaceResult × 2 | — | "How did this Boston compare to last Boston" |
| Streak / consistency stats | P3 | Computed | — | Years racing, longest streak |

---

## 6. Web: Course Library

### Job-to-be-done

"Every course I've raced or am scoping is here, with profile, archetype, and context — so I can study it before training and after." Independent of any specific race instance (a course can be raced multiple times).

### Element inventory

| Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|
| Course list (saved courses) | P0 | Course entity | KB-11 | Catalog |
| Course tile: name, distance, archetype, vert | P0 | Course entity | KB-11 | At-a-glance |
| Filter by archetype (flat / rolling / front-loaded / late-hill / net-down / trail / altitude) | P1 | KB-11 | KB-11 | Decision support |
| Add course (manual or from race) | P1 | Course write | — | Catalog growth |
| Course detail header (name, location, distance, surface) | P0 | Course entity | KB-11 | Identity |
| Elevation profile chart (full course) | P0 | CourseProfile | KB-11 | The hero data |
| Map (course route) | P1 | CourseProfile GeoJSON | — | Spatial |
| Course archetype classification + description | P1 | KB-11 | KB-11 | Strategy frame |
| Total vert (gain + loss) | P0 | CourseProfile | KB-11 | Hill load |
| Max sustained grade | P1 | CourseProfile | KB-11 | Steepest section |
| Longest climb (length, grade, distance into race) | P1 | CourseProfile | KB-11 | "Heartbreak hill" identification |
| Steepest descent (length, grade) | P1 | CourseProfile | KB-11:§Eccentric | Quad-damage warning |
| Surface distribution (asphalt / concrete / dirt / trail) | P2 | CourseProfile | KB-11 | Shoe selection |
| Aid station map | P2 | Course annotations | KB-08:§8.1 | Fueling plan |
| Course landmarks (bridges, turns, key markers) | P2 | Course annotations | KB-08:§8.1 | Mental segmentation |
| Course-specific pacing notes | P1 | KB-08:§4.4, §4.5 | KB-08 | Effort-based hill rules |
| Course-specific training prescription | P2 | KB-11 | KB-11:§Hilly | "Do downhill repeats if Boston" |
| Recommended downhill block (start lead time) | P2 | KB-11 | KB-11:§Eccentric | 8–10 wk lead |
| Athlete's history at this course (every attempt) | P0 | RaceResult.course | — | Personal history |
| Best time / course PR | P0 | Computed | — | Recognition |
| Average finish (this athlete) | P2 | Computed | — | Pattern |
| Other courses with similar profile (suggestions) | P3 | Course similarity | KB-11 | "Like Boston" |
| External links (race website, Strava segment) | P2 | Course.urls | — | Provenance |
| Photos (course landmarks) | P3 | Asset upload | — | Memory |
| Race reports from this course (athlete's own, indexed) | P2 | Note × Race | — | Searchable journal |

---

## 7. iOS: Races (Mobile-Condensed)

### Job-to-be-done

"On phone: what's coming up, how did the last one go, and let me start race-day mode if today's the day." Glanceable, reduced density vs. web. Two-tab structure (Upcoming / Past) with race-day-mode override.

### Element inventory

| Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|
| Tab bar: Upcoming / Past | P0 | n/a | — | Primary navigation |
| Race-day mode override banner (T-0 day) | P0 | System clock + Race | — | Auto-elevate race day |
| Next race hero card (countdown, name, date, location) | P0 | Race entity | KB-08 | First job |
| Goal pace + A/B/C chip on hero | P1 | RaceGoal | KB-08:§14.1 | Commitment visible |
| Weather forecast badge on hero (T-7 to T-0) | P1 | Weather API | KB-06 | Heat warning |
| "Send race day mode to watch" CTA (T-1 to T-0) | P1 | Watch sync | — | Setup transfer |
| Upcoming race row (name, date, distance, days-out) | P0 | Race entity | — | Listing |
| Upcoming race row: race-state chip (build / taper / race-week) | P1 | Plan phase | KB-08:§9 | State at-a-glance |
| Past race row (name, date, distance, time, pace) | P0 | RaceResult | — | Listing |
| Past race row: PR / heat-corrected chip | P2 | Computed | KB-06:§10.4 | Recognition + honesty |
| Add race FAB | P1 | Race write | — | Quick capture |
| Filter chip strip (distance, year) | P2 | Race entity | — | Light filtering |
| Race-detail (mobile) — collapsed stack | P0 | Race entity | — | Mobile recap |
| Mobile race-detail: hero stats (time, pace, place) | P0 | RaceResult | — | Top of detail |
| Mobile: A/B/C goal achievement bar | P0 | RaceGoal × Result | KB-08:§14.1 | Headline |
| Mobile: coach narrative card | P0 | CoachInsight | — | Voice |
| Mobile: splits (collapsed table, expandable) | P1 | Split entity | KB-08:§2.2 | Drill-down |
| Mobile: pace chart (full-width swipeable) | P1 | Activity stream | — | Visual |
| Mobile: conditions card | P1 | Weather log | KB-06 | Context |
| Mobile: fueling log card | P1 | FuelingPlan executed | KB-18:§11 | Plan vs. actual |
| Mobile: photos carousel | P2 | Asset list | — | Memorabilia |
| Mobile: comparison chip ("vs last year") | P2 | Race history | — | Drill-out |
| Mobile: notes (read + add) | P1 | Note entity | — | Quick capture |
| Mobile: share recap | P2 | Render | — | Social |
| Mobile race-upcoming: countdown hero | P0 | System clock | — | Headline |
| Mobile race-upcoming: this-week schedule (T-7) | P0 | Workout entity | KB-08:§9.3 | Race-week list |
| Mobile race-upcoming: weather forecast | P0 | Weather API | KB-06 | Forecast tile |
| Mobile race-upcoming: goal pace + first-mile target | P1 | RaceGoal + KB-08:§3.1 | KB-08:§3.1 | Practical pace |
| Mobile race-upcoming: fueling plan (compact) | P1 | FuelingPlan | KB-18:§11 | Plan visible |
| Mobile race-upcoming: race kit checklist | P2 | KB-08:§17.4 | KB-08:§17.4 | Don't forget |
| Mobile race-upcoming: travel info (flight/drive/hotel) | P2 | Race.travel | KB-12 | Logistics |
| Mobile race-upcoming: time-zone protocol (if relevant) | P3 | KB-12 | KB-12 | Jet-lag plan |
| Mobile race-upcoming: bib pickup reminder | P2 | Race.logistics | — | Notification trigger |
| Mobile race-upcoming: race morning timeline | P1 | KB-08:§11.2 | KB-08:§11.2 | T-4h to T-0 |
| Mobile race-upcoming: "start race day mode" big button (T-0) | P0 | Race state | — | One-tap entry |
| Pull-to-refresh sync | P1 | Sync layer | — | Native gesture |
| Push notification: race-week start | P1 | Notification system | KB-08:§9 | T-7 reminder |
| Push notification: weather change ≥3% adjustment | P2 | Weather monitor | KB-06:§10 | Goal recalibration |
| Push notification: bib pickup window | P2 | Race.logistics | — | Logistics |
| Push notification: race-day wake | P1 | KB-08:§11.2 | KB-08:§11.2 | Wake-up alarm coordinated |
| Live Activity (lock screen): countdown last 24h | P2 | iOS Live Activity | — | Glanceable |
| Live Activity (lock screen): race in progress | P0 | Race-day mode | — | The killer mobile feature |

---

## 8. iOS: Race Day Mode (During Race)

### Job-to-be-done

"I'm racing right now — give me only what matters: am I on pace, when's my next gel, where's the next aid station, and how am I doing relative to plan." Watch is primary screen mid-race; phone is secondary / spectator-facing / fallback. Auto-activates at race start, deactivates at finish.

### Element inventory

| Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|
| Auto-activation at gun time (geofence + scheduled) | P0 | Race.start_time + GPS | — | Zero-friction entry |
| Manual start ("I'm starting now") | P1 | n/a | — | Override |
| Race-mode lockscreen UI (replaces normal app surface) | P0 | iOS UI | — | Reduce noise |
| Hero: elapsed time | P0 | System | — | Always-on number |
| Hero: distance covered | P0 | Watch GPS | — | Always-on number |
| Hero: current lap pace (last mile/km) | P0 | Watch GPS | KB-08:§14.2 | Best-of-class pacing feedback (avoid noisy instant pace) |
| Pace vs. target band (color-coded) | P0 | RaceGoal × current pace | KB-08:§14.1 | Instant on-pace check |
| Projected finish time (rolling) | P1 | Computed | — | "On track for X" |
| HR vs. plan ceiling | P1 | Watch HR | KB-08:§6.1 | Backstop against blowup |
| HR drift indicator | P2 | Watch HR vs. baseline | KB-08:§6.1 | 3–5 bpm/h drift normal |
| Cadence (current + target) | P2 | Watch cadence | KB-08:§7.1 | Late-race form check |
| Splits ribbon (last 5 laps) | P1 | Split entity stream | KB-08:§2.2 | Recent trend |
| Half-split delta (after halfway) | P1 | Computed | KB-08:§2.1 | Even/positive/negative live |
| 5K-segment view (after each 5K) | P2 | Computed | KB-08:§2.2 | Diaz/Hettinga frame |
| Distance to next aid station | P0 | CourseProfile aid map | KB-08:§8.1, KB-18 | Fueling logistics |
| Next aid station: what's offered | P2 | Aid station data | KB-18:§7 | Plan ahead |
| Distance to next mile/km marker | P2 | Course distance | — | Mental anchor |
| Distance to finish | P1 | Computed | — | "Just X to go" |
| Course profile: position marker | P1 | CourseProfile + GPS | KB-11 | "Where am I in the race" |
| Upcoming hill / climb warning | P2 | CourseProfile lookahead | KB-11 | Pre-empt effort shift |
| Upcoming descent warning (with eccentric advice) | P3 | CourseProfile | KB-11:§Eccentric | Quad protection cue |
| Fueling reminder: time to next gel | P0 | FuelingPlan | KB-08:§10.5, KB-18:§11 | Don't miss a gel |
| Fueling reminder: caffeine timing | P1 | FuelingPlan | KB-08:§13.2 | Mile 13 / mile 20 doses |
| Fueling: log-this-gel tap | P1 | FuelingPlan executed write | — | Closes plan-vs-actual loop |
| Hydration reminder | P2 | FuelingPlan fluid schedule | KB-18:§16 | Drink-to-thirst calibration |
| Late-race form-cue ticker ("quick feet" / "tall and proud") | P2 | KB-08:§7.2 | KB-08:§7.2 | Cycle every 30–60s |
| Self-talk script display (phase-aware) | P3 | KB-08:§15.2 | KB-08:§15.2 | Wall mile cue |
| Wall-rescue protocol (if pace drops 15+ s/mi) | P2 | Computed trigger | KB-08:§8.3, §18.3 | Walk + gel + caffeine prompt |
| Cramping protocol prompt (manual trigger) | P3 | KB-08:§18.3 | KB-08:§18.3 | Salt + slow + shorten stride |
| GPS-vs-marker drift warning | P3 | KB-08:§18.3 | KB-08:§18.3 | "Your GPS is 0.3 mi short of mile 12" |
| Audio cues (interval/split/target deviation) | P1 | iOS audio | KB-08:§14.2 | Eyes-off |
| Haptic cues (mile, off-pace) | P2 | iOS/watch haptic | — | Wrist tap |
| Spectator share-link (live tracking URL) | P0 | Live tracking endpoint | — | Family follows along |
| Spectator share: ETA at next checkpoint | P2 | Computed | — | "I'll be at mile 18 at 10:42" |
| Music / podcast control overlay | P3 | iOS media controls | — | Convenience |
| SOS button (call emergency contact) | P1 | iOS contact | — | Safety |
| Photo capture (one-tap, tagged to mile) | P3 | Camera | — | Memory layer |
| End-race manual trigger ("I finished") | P0 | n/a | — | Manual fallback |
| Auto-end at finish-line geofence | P0 | GPS + course end | — | Zero-friction exit |
| Immediate post-finish confetti + result hero | P0 | Computed | — | Celebration + handoff |
| Auto-prompt subjective rating (10s after finish) | P1 | SubjectiveLog | — | Capture while fresh |
| Auto-prompt fueling-actuals (gels confirmed) | P2 | FuelingPlan | KB-18:§14 | GI-symptom debrief |
| Auto-route to Race Detail (Past) within 60s | P0 | Navigation | — | Recap handoff |
| Battery-conservation mode (dim screen, reduce GPS) | P1 | iOS battery | — | Marathon-length runs |
| Phone-only fallback mode (no watch) | P1 | Detected hardware | — | Watch dies / not paired |
| Watch is offline indicator | P2 | Sync state | — | Trust signal |

---

## 9. Quick Competitor Scan

- **Strava race recap**: photo-first; emphasizes splits + segment PRs + kudos count. Strong on social share, weak on goal-vs-actual analysis, no pacing strategy or fueling log. Pace + HR + elevation overlay is the gold-standard chart. Achievement badges drive return visits.
- **Garmin Connect race report**: dense, technical, multi-tab. Strong on device-derived metrics (training effect, anaerobic contribution, GAP, performance condition). Good course profile + grade-adjusted pace. Weak on coach narrative, fueling, race-week planning. Race Predictor surfaces predicted times for 5K/10K/half/marathon — useful precedent.
- **Runna race day**: best-in-class race-day mode UX. Pre-race: course profile, weather forecast with goal-pace adjustment, A/B/C goals. During: live splits with target-pace coaching, audio cues, fueling reminders. Post: structured recap with coach feedback. Mobile-first; minimal web.
- **TrainingPeaks race report**: PMC chart context (CTL/ATL/TSB at race day), coach annotations, structured pre/post-race notes, planned-vs-actual matched workouts in the build. Strong on training-load context, weak on weather/fueling integration.
- **Athlytic / HumanOS / Whoop race day**: minimal race-specific UX; wraps the day in a recovery/strain frame. Useful precedent for "race week" mode that elevates sleep/HRV/strain emphasis but otherwise hands off to a dedicated tool.

---

## 10. Open Questions

- A/B/C goal commitment: visible to coach only, or visible to spectator share-links too? Privacy-vs-accountability balance.
- Race photos: license/integrate with MarathonFoto / Sportograf / RaceJoy via API, or user-upload only? API costs, race-by-race availability.
- Spectator share-link: build a custom live-tracking endpoint, or piggyback on Strava Beacon / Find My / RaceJoy? Battery + data plan implications.
- Course library: source course profiles from where? Strava routes, race RD-supplied GPX, athlete activity-derived, third party (FindMyMarathon). De-duplication when same course is run by 100k athletes.
- Predicted-time confidence interval display: numeric range, visual band, or qualitative ("low/medium/high confidence")? Risk of over-trusting a point estimate is the main failure mode.
- Heat-corrected equivalent times: show alongside raw chip-time, or as a click-to-reveal? Don't bury the actual result, but don't overweight a model.
- Race-day-mode auto-activation: geofence vs. manual vs. scheduled? Falsy-positive at expo (geofence triggers when picking up bib) is a real risk.
- Fueling-plan log on watch vs. phone vs. auto-detect from heart-rate spike at fueling? Manual tap is reliable but adds cognitive load mid-race.
- Comparison to "best similar race" — what makes races similar (distance + weather + course profile + season)? Fuzzy match algorithm needs design.
- Race-week home-screen takeover: should the iOS Today tab pivot to race-week view automatically T-7 to T-0, or only when user enters Races tab?
- DNF / DNS / withdrawn race handling: separate status from completed? Recap surface for DNFs (lessons + diagnosis) vs. just a row?
- Multi-race seasons (A/B/C race chains, not goal tiers): how does the data model link races as part of a season arc? Boston → Eugene → CIM as one narrative.
- Past races imported from Strava with no goal data: do we backfill A/B/C as "goal unknown," and offer the user a chance to retroactively log one? Race Detail (Past) gracefully degrades.
- Course recon recommendation: surface as a coach insight 4 weeks out, or as a permanent block on Race Detail (Upcoming)? When does it become noise.
- Live Activity for upcoming race countdown: how many days before the race does it appear on the lock screen? T-7 default; user-toggleable.

---

## 11. Data Model Implications

### Race entity

```
Race
  id, athlete_id
  name, location (city, country, lat/lon)
  distance (meters), distance_label (5K, 10K, half, marathon, ultra-50K, etc.)
  date (with timezone), gun_time, status (upcoming, completed, dns, dnf, withdrawn)
  course_id  (FK → Course; many races share one course)
  plan_id    (FK → Plan; the training cycle for this race)
  registration_status (registered, paid, waitlist)
  bib_number, corral, wave, start_time
  logistics: { hotel, flight_in, flight_out, drive_distance, parking_note,
               bag_drop, bib_pickup_window, expo_url }
  travel: { zones_crossed, direction, on_site_arrival_date, on_site_departure_date }
  external_links: { race_url, results_url, strava_id, garmin_id, healthkit_id }
  importance_tier (A, B, C, tune-up)  — distinct from goal tiers
  notes_id (FK → Note)
  created_at, updated_at
```

### RaceGoal entity (1:many per Race)

```
RaceGoal
  id, race_id
  tier (A, B, C)
  goal_time (seconds)
  goal_pace (sec/mi, sec/km)
  first_mile_target (sec/mi delta from goal_pace)
  halfway_split_target (seconds)
  late_race_rule (string, e.g., "no push before mile 20")
  pacing_strategy (even, neg_split, pos_split, segment, custom)
  if_then_rules (JSON array of conditional decision rules)
  weather_adjusted_goal_time (computed at T-3 to T-0)
  created_at, updated_at, locked_at  (when committed)
```

### RaceResult entity (0..1 per Race; only for completed races)

```
RaceResult
  id, race_id
  chip_time, gun_time (separate)
  pace_seconds_per_mile
  overall_place, age_group_place, gender_place, total_finishers
  split_pattern (even, pos, neg, blowup, fade, kick)
  cv_5k (coefficient of variation, marathon Diaz/Hettinga)
  half_split_delta (seconds; positive = pos split)
  goal_outcome ({ a: hit/miss/dns, b: hit/miss, c: hit/miss })
  predicted_time_at_taper (snapshot for delta calc)
  vs_predicted_delta (seconds)
  age_grade_pct (WMA 2023)
  heat_corrected_equivalent_time (KB-06:§10.4)
  heat_correction_pct
  hr_avg, hr_max, hr_drift_bpm_per_hour
  cadence_avg, cadence_drop_late_race
  course_pr_flag, distance_pr_flag, season_best_flag
  activity_id (FK → Activity for stream data)
  created_at, updated_at
```

### Split entity (many per RaceResult)

```
Split
  id, race_result_id
  segment_index, segment_distance, segment_unit (mi, km, 5k)
  split_time, cumulative_time
  pace_seconds, hr_avg, hr_max
  elevation_gain, elevation_loss, avg_grade
  cadence_avg, power_avg (if available)
  notes (e.g., "fueled here", "cramp")
```

### CourseProfile / Course entity

```
Course
  id, name, distance, location
  archetype (flat, rolling, front_loaded, late_hill, net_down, persistent_rollers, mountain, trail)
  total_vert_gain, total_vert_loss, net_elevation
  max_grade, max_sustained_grade, longest_climb_length, longest_climb_grade
  steepest_descent_length, steepest_descent_grade
  surface_distribution (asphalt %, concrete %, dirt %, trail %, track %)
  altitude_avg, altitude_max
  geo_json (full route)
  landmarks (array of { name, distance_into_race, lat/lon, type })
  aid_stations (array of { distance_into_race, offerings })
  external_refs (race_url, strava_route_id, ridewithgps_id)
  created_at, updated_at
```

### FuelingPlan entity (1 per Workout or Race)

```
FuelingPlan
  id, race_id (or workout_id)
  target_carbs_per_hour, target_fluid_per_hour, target_sodium_per_hour
  target_total_caffeine_mg
  glucose_fructose_ratio
  schedule (array of { time_or_distance, product_id, amount_g_carb, amount_caffeine_mg, fluid_ml, sodium_mg })
  pre_race_carb_load_target_g_per_kg_per_day (KB-08:§10.1)
  pre_race_meal (timing, items, total_g_carb)
  weather_adjustment_applied (boolean + factor)
  gut_training_status (untested, in_progress, race_ready)
  notes
```

### FuelingPlanExecuted entity (links to FuelingPlan)

```
FuelingPlanExecuted
  id, fueling_plan_id, race_id
  schedule_executed (array of { time, product_id, taken (bool), gi_symptoms (array) })
  total_carbs_taken_g, total_fluid_ml, total_sodium_mg, total_caffeine_mg
  gi_symptoms_summary
  notes
```

### RacePrediction entity (snapshots over time)

```
RacePrediction
  id, race_id
  computed_at
  source (riegel, cameron, daniels_vdot, empirical_exponent, predictor_workout, coach_override)
  predicted_time (seconds)
  confidence_low, confidence_high
  confidence_pct (e.g., 80% CI)
  vdot_estimate
  empirical_exponent (b)
  runner_type (speedster, combo, endurance)
  inputs (array of { race_id or activity_id, distance, time, recency_weight })
  weather_adjustment_pct, altitude_adjustment_pct, course_adjustment_pct
```

### CoachInsight entity (ties to race)

```
CoachInsight
  id, athlete_id, race_id (nullable)
  type (pre_race_narrative, post_race_recap, weather_alert, prediction_update, ...)
  voice_block (string with structured "WHY" / "FOCUS" / "BACK OFF IF" labels)
  evidence_refs (array of activity_ids, race_ids, kb_doc_refs)
  created_at, expires_at (nullable), dismissed_by_user (bool)
```

### Note entity (flexible attachment)

```
Note
  id, athlete_id
  attached_to (date, activity_id, race_id, plan_id)
  type (free_text, structured_pre_race, structured_post_race, lesson_learned)
  content (markdown)
  subjective_ratings (energy, soreness, mood, motivation, satisfaction, RPE)
  created_at, updated_at
```

### SubjectiveLog entity

```
SubjectiveLog
  id, athlete_id, date
  context (daily_checkin, pre_race, post_race, mid_taper)
  attached_race_id (nullable)
  ratings (energy, soreness_overall, soreness_quads, mood, motivation, sleep_quality, satisfaction, rpe)
  free_text
```

### LiveRaceTracking entity (Race Day Mode runtime)

```
LiveRaceTracking
  id, race_id, athlete_id
  status (pre_start, active, finished, ended_manually, dnf)
  start_time_actual, finish_time_actual
  current_distance, current_pace, current_hr, current_cadence
  current_lat_lon
  next_aid_distance, next_fuel_event_eta
  spectator_share_token (signed, expirable)
  battery_mode (full, conserve)
  watch_connected (bool)
```

### Critical relationships

```
Race ──< RaceGoal (1:many)
Race ──< RaceResult (1:0..1)
Race ──< FuelingPlan (1:0..1)
Race ──< RacePrediction (1:many; one per snapshot)
Race ──> Course (many:1)
Race ──> Plan (many:1; many races share one season plan)
Race ──< Note (1:many)
Race ──< CoachInsight (1:many)
Race ──< Asset (photos) (1:many)
RaceResult ──< Split (1:many)
RaceResult ──> Activity (1:1)  — the actual GPS/HR record
FuelingPlan ──< FuelingPlanExecuted (1:1)
Course ──< Race (1:many)
Course ──< CourseAnnotation (landmarks, aid stations)
Shoe ──< Race (via Activity attribution)
```

### Key derived/cached fields

- `Race.next_milestone` (computed: T-? days, current race-week phase)
- `RaceResult.heat_corrected_equivalent_time` (computed once at race entry from Weather log + KB-06:§10.4)
- `RaceResult.age_grade_pct` (computed from WMA 2023 tables; refresh annually as athlete ages)
- `Race.course_archetype` (denormalized from Course for fast filter queries)
- `Athlete.lifetime_stats` (race count, total miles, distance breakdown, PRs by distance) — materialized

### Migration / sync notes

- Strava import populates Race + RaceResult + Activity but leaves RaceGoal, FuelingPlan, Note empty. UI must gracefully degrade.
- Course de-duplication: if two athletes log "Boston Marathon 2026" with different GPX, merge to single Course at canonical race level (admin-curated) but preserve athlete-specific Activity GPS.
- Race Day Mode requires offline-capable LiveRaceTracking write path on watch + phone — sync when network returns.
- Race history bulk-import: provide a CSV template (date, name, distance, time, place) for manual migration; many athletes have decades of paper logs.

---

## Cross-references

- KB-08 (Pacing & Race Week) drives pacing strategies, race-week schedules, fueling plans, race-day timeline, and warmups.
- KB-02 (Race Time Prediction) drives the Race Goal Calculator and predicted-time delta on Race Detail (Past).
- KB-06 (Weather Adjustments) drives weather forecasts on Race Detail (Upcoming), heat-corrected equivalent times on Race Detail (Past), and bail triggers in Race Day Mode.
- KB-11 (Course-Specific Training) drives Course Library archetypes, course-specific training prescriptions on Race Detail (Upcoming), and downhill/altitude/heat protocols.
- KB-12 (Travel & Time Zone) drives travel logistics on Race Detail (Upcoming), arrival timing recommendations, and the iOS race-week travel block.
- KB-18 (Fueling Products) drives FuelingPlan composition, brand-level gel/drink picker, and gut-training status badge.
