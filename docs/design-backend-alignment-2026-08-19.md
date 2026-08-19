# Design ↔ backend alignment · iPhone handoff 2026-08-19

Where the high-fidelity iPhone design and the backend disagree. Written before
anyone writes Swift, so the build session argues with this document instead of
discovering it one screen at a time.

- **Design read:** `/Volumes/WP/06 Claude Code/Faff/design/0819/design_handoff_faff_iphone_app/` — `README.md` and `Faff-iPhone-App.dc.html` (242 KB, 3248 lines, 14 screens). Read-only. Nothing was copied into this repo.
- **Backend base:** `origin/main` @ `de9fd92c`.
- **Method:** every `{{ binding }}` in the design's markup traced to an endpoint, a lib function, or nothing. The design file is a live prototype with a real data model in its `<script type="text/x-dc">` block — that block is the field inventory, and it is what was traced.
- **Nothing in the engine was changed.** Verification at the end.

Three numbers up front:

| | |
|---|---|
| Design fields the backend **cannot feed** | **42** (numbered GAP 1–42 below) — **29 with no source at all**, **13 that exist and are tested in `lib/` but reach no HTTP route** |
| Engine states with **no screen** | **31** (List B) |
| Design screens that **cannot be built** as drawn today | **6** (List A) |

---

## 0 · The thing to understand before reading the field trace

The design is not a redesign of the current iPhone app. It is the **same design
system as the web redesign already shipped at `/redesign/*`**, rendered dark.

`web-v2/app/redesign/tokens/colors.css` carries the identical state palette:
`--state-easy:#3EBD41`, `--state-quality:#F3AD38`, `--state-long:#27B4E0`,
`--state-rest:#008FEC`, `--state-phase:#B084FF`, `--state-race:#FF8847`. Those
six hexes are byte-identical to the six day-state gradient head stops in this
iPhone handoff. The web ground is warm paper `#EFECE6`; the iPhone ground is
pure black `#000000`. Same system, two themes.

That matters twice over:

1. **Reference implementations of three of these screens already exist in
   TypeScript.** `web-v2/components/redesign/block/BlockClient.tsx` (684 lines),
   `web-v2/components/redesign/season/SeasonClient.tsx` (713 lines),
   `web-v2/components/redesign/races/RaceDetailClient.tsx`. They already solved
   most of the "the backend does not serve this, derive it client-side"
   problems the iPhone build is about to hit. **Read them before writing
   Swift.** Every derivation noted below as "client-side" has a working
   precedent there.
2. **The palette gate was already half-opened for exactly this reason** — see
   Collision 1. The iPhone half was left shut because iPhone was not changing.
   It is changing now.

Two structural facts about the design itself, before any field:

- **The design has three destinations; the app has four.** Today · Block ·
  Races, plus the RUN pill. The current app is `today, train, health, targets`
  (`native-v2/Faff/Faff/Views/RootTabView.swift:28`). `train` → Block and
  `targets` → Races map cleanly. **`health` has no home.** The entire Health
  surface — HRV, sleep, RHR, the readiness pillar detail — collapses into one
  `Readiness` row inside Today's "Where you are" list. That is a product
  decision the design makes silently and it should be made out loud.
- **There is no rest-day screen.** The design's `DAYS` object has exactly three
  entries: `easy`, `quality`, `race`. Rest is a gradient in the token list and a
  row in the calendar sheet, but no Today composition. The engine's `rest` is a
  first-class `DayState` (`web-v2/lib/faff/types.ts:230`) and is roughly two
  days in seven. Per `docs/onboarding-qa-2026-08-19.md` §4, **day one for a
  race-mode runner is a rest day**. The most common single screen in the app is
  the one the design does not draw.

---

# PART 1 · Screen by screen

Legend for the second column: **MEASURED** = read from a recorded run, a device,
or something the runner typed. **MODELLED** = computed from a model
(Daniels VDOT, LTHR crosswalk, a gain-rate trajectory, a weather forecast).
**CORRECTED** = measured then adjusted by a model. The locked ruling is that a
modelled number may never be presented as measured, so every MODELLED row that
the design renders without qualification is flagged.

---

## 5a · Today, before the run

There is **no `/api/today`**. `web-v2/app/api/today/` holds only `purpose/`,
`reschedule/`, `shoe/`, `skip/`. The composite contract exists as a type —
`TodayResponse` at `web-v2/lib/faff/types.ts:634` — and **nothing emits it**.
The current iPhone Today screen fans out to ten endpoints in
`native-v2/Faff/Faff/Views/TodayView.swift` `loadAll()`. The new design's Today
is denser than the current one, so it will fan out to at least as many.

| Design field | Source | M/M | Honest at the edges? |
|---|---|---|---|
| `d.dateLine` "Thursday 20 August" | `/api/plan/week` → `today_iso`; client formats | MEASURED | fine |
| `d.weekLine` "Week 6 of 16 · Base" | `/api/training/state` → `currentWeekIdx`, `weeks.length`, `currentPhase` (`web-v2/lib/coach/training-state.ts:77-79`). Three fields, no composed string | MEASURED | **No plan → all three null.** Design has no variant for the plan-less runner |
| 7-day strip: letter, date, status rail | `/api/plan/week` → `days[]`: `is_today`, `is_past`, `completedRunId`, `done_mi`, `skipped`, `secondaryRun` (`web-v2/app/api/plan/week/route.ts:211-227`) | MEASURED | `{"days":[]}` + `"message":"No active plan."` for just-run/coached. Design has no empty strip |
| `d.kicker` duration half | `/api/watch/today` → `totalEstimatedMinutes` (`web-v2/lib/watch/build-workout.ts:626`) | **MODELLED** — sum of phase durations off derived paces; distance-reps fall back to a hardcoded 9:00/7:00 per mile (`build-workout.ts:161-165`) | Design prints "about 54 min" with no hedge. The word "about" is doing all the work |
| `d.kicker` weather half | `/api/forecast/[date]?durationMin=&startHHMM=` → `DayForecast` (`web-v2/lib/weather/openmeteo.ts:311-351`) | **MODELLED** (Open-Meteo forecast) | Wind is day-level, not windowed. Forecast fails → design has no state; 16a covers the readiness outage only |
| `d.type` "Easy"/"Threshold"/"Race" | `/api/today/purpose` → `typeTitle` (`web-v2/app/api/today/purpose/route.ts:405`) | MEASURED (authored plan) | Locked vocabulary. `race_week_tuneup` aliases to `threshold` (`purpose/route.ts:56`) |
| `d.dose` "6 mi" | `/api/plan/week` → `distance_mi` | MEASURED | fine |
| `d.dose` "2 × 3 mi @ 7:22" | **No single field.** Structure without pace in `sub_label`; the full string is composed server-side by `buildWorkoutBreakdown` (`web-v2/lib/faff/glance-adapter.ts:592-599`) and shipped as `/api/briefing` `workout_breakdown[].body`+`.tail`. `plannedSpec` is **not on** `/api/plan/week`'s PlanDay (`native-v2/Faff/Faff/API.swift:1461`) | pace is **MODELLED** | Cold-start runner has no VDOT → `derivePaces` fallback or no pace at all |
| posterStat "Pace band 8:50 · 9:35" | `/api/briefing` `workout_breakdown[0].tail` | **MODELLED** — Daniels VDOT off a goal-race time | **Rendered as a bare number in the poster's stats plate.** No provenance |
| posterStat "Ceiling 146 bpm" | `/api/watch/today` `hrCeilingBpm` (`build-workout.ts:636`) | **MODELLED** — LTHR × zone factor, and LTHR itself may be an `HRmax × 0.92` crosswalk. The flag exists: `hr_zones_from_lthr.method === 'maxhr-crosswalk'` (`web-v2/lib/coach/run-state.ts:246-255`) | **The design never reads that flag.** An estimated ceiling renders identically to a measured one |
| posterStat "Effort 3 of 10" | **NOTHING.** No prescribed 1–10 effort exists anywhere in `web-v2/lib`. The current client fakes it — `native-v2/.../TodayPreRunBodyV3.swift:323-330` is a hardcoded switch on workout type | — | **GAP 1** |
| `d.plan` groups + steps | `/api/prescription` → `PrescriptionStep{label, distance_mi, reps, rep_distance_mi, duration, pace_target, hr_target, note, recovery}` (`web-v2/lib/training/prescriptions.ts:84-111`); or `/api/watch/today` `phases[]` | pace/HR **MODELLED** | Missing anchor → the engine can refuse the whole session (List B #1) |
| `d.why` coach line | `/api/today/purpose` → `verdict`, `facts[]`, `cue`, `citations[]` (`web-v2/lib/coach/run-purpose.ts:103`) | deterministic template | Good. Zero LLM |
| "Where you are" · Readiness 0–100 | `/api/readiness` → `score`, `band`, `label` | **MODELLED** — HRV 40 / sleep 22 / RHR 18 + load modifier (`web-v2/lib/coach/readiness.ts`) | `null` on cold start; needs ≥14 days before the band can move. **The design prints a bare integer.** See the readiness constraint check |
| Readiness expanded detail | `/api/readiness` `inputs[]` = `{key,label,observedV,observedSub,weight,meaning}`; richer at `/api/readiness/brief` → `pillars[]` with `confounders[]` and `trend[14]` | MEASURED inputs, MODELLED weighting | Design shows two rows (Sleep, Resting heart). Backend has five pillars plus confounders. Not wrong, just thin |
| "This week 34 of 44 mi planned" | `/api/training/state` `weekDone`/`weekPlanned` | MEASURED | fine |
| "This week 77%" | **NOTHING on the wire.** `computeWeekMileage()` (`web-v2/lib/faff/week-mileage.ts`) is the canonical splitter and is imported only by a web component | — | **GAP 2** |
| Shoe row name + "214 mi on them" | `/api/shoe` → `mileage`, computed on read from canonical runs (`web-v2/lib/shoe/mileage.ts`) | MEASURED | fine |
| Which shoe is selected for today | `POST/DELETE /api/today/shoe` only — **there is no GET** (`web-v2/app/api/today/shoe/route.ts`). The current client says so in a comment: *"Hydrates from /api/today/shoe in a future round; today this is purely local state"* (`TodayView.swift:151`) | — | **GAP 3** — selection does not survive an app restart |
| Fuel "5 gels" / "At 40 minutes, then every 30" | `/api/watch/today` `fueling{needed,gels,atMins[],gPerHr,shortLine,why}` (`web-v2/lib/training/fueling.ts:169`) | **MODELLED** from distance/duration/temp | `shortLine` enumerates ("at 40 + 70 + 100 min") rather than stating a cadence. Cosmetic |
| Move options + `sub` ("Friday is empty") | `POST /api/today/reschedule` returns a conflict preview for the *target* day only (`route.ts:94-134`) | — | **GAP 4** — nothing computes target-day availability as prose |
| Move options + `doneSub` ("The week loses 6 mi") | **NOTHING.** No endpoint computes the prospective cost of a skip | — | **GAP 5** |
| Calendar sheet, per-week groups | No calendar endpoint. Current client fires 8 parallel `/api/plan/week` calls (`TrainingCalendarView.swift:195-202`). `/api/training/state` `weeks[].days[]` would serve it in one call and is unused | MEASURED | Design's calendar is unbounded scroll; `/api/training/state` is bounded to the active plan |

---

## 5b / 5c · Today, after the run

All post-run data lands on `GET /api/runs/[id]` → `loadRunDetail`
(`web-v2/lib/coach/run-state.ts:102-310`) plus `GET /api/runs/[id]/recap`.

| Design field | Source | M/M | Honest at the edges? |
|---|---|---|---|
| `done.distance` / `time` / `pace` | `run-state.ts:110-114` | MEASURED | fine |
| `done.elev` "148 ft up" | `run-state.ts:120` `elev_gain_ft` | **CORRECTED** — a sanity clamp can substitute the splits-positive sum (`run-state.ts:869-891`) | Unflagged |
| Summary row · Pace asked vs ran | asked: `/api/runs/[id]/recap` `prescribed_pace_s_per_mi` / `plan_now_pace_s_per_mi` / `evaluated_pace_s_per_mi`. ran: `pace`, `pace_work` | asked **MODELLED** | The recap serves **three** different "asked" paces (frozen watch target, plan-as-it-now-stands, what was actually judged against). The design's one "Asked" column has to pick one and say which |
| Summary row · Heart asked vs ran | asked: `planned_spec.hr_cap_bpm`. ran: `hr_avg`, `hr_avg_work`. Plus `easy_hr_read{delta_bpm, threshold_method, verdict}` | asked **MODELLED**, `threshold_method` says whether LTHR was crosswalk-estimated | Design ignores `threshold_method` |
| Summary row · Effort **asked** ("2 to 4") | **NOTHING** — same hole as GAP 1 | — | **GAP 6** |
| Summary row · Effort **ran** | `GET/POST /api/runs/[id]/rpe`, clamped 1–10, table `post_run_rpe` | MEASURED (runner-entered) | fine. Design's tap-to-open 1–10 scale maps exactly |
| `done.verdict` | `/api/runs/[id]/recap` → `verdict`, `facts[]`, `coach_tip`, `conditions_note`, `win` | deterministic, terrain- and heat-aware | Good |
| Per-piece groups, asked + ran | `RunDetail.phase_breakdown[]` = `{label "Rep 1/4", target_pace, tolerance_pace_sec, actual_pace, avg_hr, status:'on'|'fast'|'slow'}` (`run-state.ts:51-71`) | targets are **heat-adjusted before judging** (`heat_slowdown_pct`, `run-state.ts:179`) | **A rep judged "on" against a heat-softened target reads identically to one judged against the authored target.** The adjustment is invisible |
| Zone bar `d.zoneShares` | `RunDetail.hrZonePcts{z1..z5}` (`run-state.ts:245`); edges from `hr_zones_from_lthr` | zone boundaries **MODELLED** from LTHR | Falls back to "missing" when all-zero (`run-state.ts:592-604`). Design has no missing-HR variant |
| Zone bar **target zone** | **NOTHING.** No `WorkoutSpec` carries a zone token (`web-v2/lib/faff/types.ts:105-230` — only bpm caps). Zone naming exists only as prose inside `workout_breakdown[].body` | — | **GAP 7** — inferable client-side by mapping the target bpm into `hr_zones_from_lthr.ranges` |
| Route line (SVG) | `RunDetail.has_route` + `route_polyline` (Strava-encoded) | MEASURED | Design draws a stylised curve; the real thing needs the existing `RouteMapView`. Indoor runs have no polyline — design's 5c handles this |
| Route **elevation profile** | **NOTHING.** `PlanWorkoutElevationProfile` (`types.ts:622-632`) has zero references in the repo — a dead type. The only per-run series is `splits[].elev_change_ft`, one delta per mile | — | **GAP 8** — a 6–13 point step chart, not the smooth trace drawn |
| Shoes worn | `RunDetail.shoe_id` + inline `shoes[]` with live mileage (`run-state.ts:217-222`) | MEASURED | fine |
| "What this did" · week % | same hole as GAP 2 | — | **GAP 9** |
| "What this did" · next-up row + note | derivable from `/api/plan/week`. `CoachState.nextWorkout` exists (`web-v2/lib/coach/state-loader.ts:167`) and is **exposed on no route**. The forward-looking note has no producer | — | **GAP 10** (note) |
| Flag a niggle | `POST /api/niggle` requires `body_part`, `severity` **1–10**, `status` `just_started|few_days|weeks` (`web-v2/app/api/niggle/route.ts:29-37`) | MEASURED | **The design's picker collects a body part and nothing else.** It cannot satisfy the contract. `body_part` is free-form server-side, so Left/Right entries map onto the separate `side` param — but severity and status must be asked for, or defaulted, and defaulting a severity is fabricating one |
| "Send it to Strava" | `GET/POST /api/strava/push/[runId]` (`route.ts:53-83`) | — | Full state machine already exists incl. pending re-poll |
| 5c "On the belt" · avg speed mph | `RunDetail.avg_speed_mph` exists — but `avgSpeedMph` is written **only by the Strava pull-sync** (`web-v2/lib/strava/pullSync.ts:151`). An iPhone-recorded treadmill run posts `phases[].actualSpeedMph` and never the top-level field | — | **GAP 11 — null for exactly the runs this card is for**, unless the run round-trips through Strava |
| 5c "On the belt" · avg incline % | **NOTHING on any read endpoint.** `actualInclinePct` is written into `runs.data.phases[]`, consumed internally by `web-v2/lib/terrain/run-terrain.ts:146` and `run-win.ts:598`, and `loadRunDetail` drops the resulting note | — | **GAP 12** |
| 5c · does the client even know it was a treadmill run? | Backend emits `terrain_surface: 'outdoor'\|'treadmill'` (`run-state.ts:139`). **The Swift `RunDetail` struct does not decode it** (`native-v2/Faff/Faff/Models/Runs.swift:223-293`). The client uses `source == "treadmill"`, which is set only for runs that came through the phone's own `TreadmillView`. `runs.data.indoor` is the real flag and `/api/log` does not emit it — `Runs.swift:152` declares `let indoor: Bool?` and it is **permanently nil, a dead decode** | — | **GAP 13** — a treadmill run synced from Strava or HealthKit renders as 5b with an empty route card |

---

## 6a · Block

Primary endpoint `GET /api/training/state`. Working web precedent:
`web-v2/components/redesign/block/BlockClient.tsx`.

| Design field | Source | M/M | Notes |
|---|---|---|---|
| `block.phase` "Base" | `plan_phases.label` → `TrainingState.phases[].label`, `currentPhase` (`training-state.ts:123-126, :264`); display copy from `phaseFocus()` (`web-v2/lib/faff/phase-focus.ts:135`) | MEASURED | The engine's phase enum is `BASE / BUILD / PEAK / TAPER / RECOVERY / OFF` (`web-v2/app/api/today/purpose/route.ts:65-69`). The design's arc names four: Base / **Quality** / **Race specific** / Taper. Two of the four are new words for existing phases; RECOVERY and OFF have no place on the arc |
| `block.phaseWeek`, `block.toGo` | derived from `race.days_to_race`, `race.goal`, `race.date` (`training-state.ts:303-306`) | MEASURED | |
| `block.kicker` "2 weeks left of this phase" | **no field**; computable from `phases[].endWeekIdx` | — | client-side, precedent at `BlockClient.tsx:345` |
| stat "Quality share 18%" | **no field.** `weekIntensity()` (`web-v2/lib/plan/intensity-distribution.ts`) computes it; the helper is not on any route | — | **GAP 14 (wire).** `BlockClient.tsx:348-356` additionally flags that "target 20–25%" is a fabrication — doctrine states a **floor on easy share (≥75%)**, i.e. a quality *ceiling*, not a target band. The design's framing invites the wrong reading |
| stat "Long run 16 mi" / "This week 44 mi" | derived from `weeks[].days[]`; `weekPlanned`/`weekDone` are served | MEASURED | |
| PhaseBar `{name, weeks, current, at}` | `phases[]` gives name and week span; `current` and `at` derived | MEASURED — **except** legacy plans with no `plan_phases` rows, where `BlockClient.tsx:95-106` substitutes a proportional 45/30/15/rest split | **MODELLED phase boundaries, rendered identically to authored ones** |
| `block.say` | no single field; composed from `phaseFocus().focus` | template | |
| "Miles run 234 of 656" | **NOTHING.** Per-day pieces exist; nobody rolls them to a block total | — | **GAP 15** |
| "Sessions 38 of 42 · 3 missed, 1 moved" | **NOTHING.** Skips live in `day_actions`, moves in `adaptation` (`training-state.ts:52-61`); no rollup. Only a *weekly* analogue exists (`WeeklyCheckIn.tsx:71`) | — | **GAP 16** |
| "Longest so far / block peaks at 20 mi" | derived from `weeks[].days[]` | MEASURED | client-side |
| 16 week rows, 7 load bars each | `TrainingState.weeks[]` → `days[]{date,dow,type,mi,doneMi}` (`training-state.ts:214-241`) | MEASURED | |
| week flag "This week" | `weeks[].isCurrent` | MEASURED | |
| week flag "Cutback" / "Peak" | **not in the DB.** Derived by comparing adjacent weekly mileage (`BlockClient.tsx:123-151`) | **MODELLED label** | |
| week flag "Race week" | `plan_weeks.is_race_week` **does exist** (it is queried in `web-v2/app/api/plan/replan/route.ts:94-97`) but `loadTrainingState` never selects it (`training-state.ts:128-131`) | — | **GAP 17 (wire)** — one column in one SELECT |
| Workout library, "54 named sessions" | table + reader exist (`web-v2/lib/plan/workout-library.ts`, incl. `workoutLibraryStats()` at `:203`). **No HTTP route exposes it** | — | **GAP 18 (wire)** |
| "142 runs, 1,084 mi this year" | `/api/log` returns `totalRuns`/`totalMi` scoped to the requested limit/filters, **not year-to-date** | — | **GAP 19** |
| "Change the plan" sheet | see the replan mapping below | — | **GAPs 20–24** |

---

## 7a · Races

| Design field | Source | M/M | Notes |
|---|---|---|---|
| "Next A race" + name | `web-v2/lib/coach/races-state.ts:301-302`; also resolved in `targets/projection/route.ts:167-197` | MEASURED | |
| `season.out`, `season.dose` | derived from `daysAway`, `distance_label`, `date` | MEASURED | |
| `season.raceCount` "6 on file" | `RacesState.totalUpcoming`/`totalPast` (`races-state.ts:313-314`) are computed and **`/api/races` does not forward them** (`web-v2/app/api/races/route.ts:29-44`) | — | **GAP 25 (wire)** |
| stat "Goal Sub 3:30" | `races.meta.goalDisplay` | MEASURED (runner-stated) | |
| stat "Projected 3:31:48" | three different numbers ship in one payload: `projectionSec` (`targets/projection/route.ts:270-283`), `trajectoryProjectedSec` (`:775`, race-day), `trajectoryAccruedSec` (`:783`, today-accrued) | **ALL MODELLED** | **This is the sharpest honesty problem in the design.** `web-v2/lib/training/goal-projection.ts:271` reads `projectionSec = status === 'off-track' && vdotProjectionSec != null ? vdotProjectionSec : goalSec` — i.e. **the projection literally *is* the goal until a drift signal fires.** A "Projected 3:31:48" beside "Goal 3:30" can only differ once drift has fired; before that the design draws a two-number comparison of one number against itself |
| stat "Gap +1:48" | `totalGapSec` (`:457`) with the decomposition `fitnessSec` / `courseImpactSec` / `conditionsImpactSec` / `executionBufferSec` (`:458-462`); status vocabulary is `resolveGoalStatus()` → `ahead\|on-pace\|watching\|behind` (`web-v2/lib/faff/goal-status.ts:102`) | **MODELLED** | The design renders one number and one amber state. The backend serves a four-way decomposition and a four-tier status. Losing the decomposition is a choice; losing the status tiers means "amber when behind" has to re-derive a threshold that `ON_PACE_DEAD_BAND_SEC = 30` already defines |
| "Needs a decision" card | mechanism exists: `web-v2/lib/plan/goal-renegotiation.ts`, fires only after `GoalGapStatus === 'unclosable'` for `RENEGOTIATION_SUSTAINED_DAYS = 5` consecutive days. Writes a `plan_proposals` row `kind='goal_renegotiation'` with `alternatives{a,b,c}` | — | The exact sentence ("needs VDOT 49.8 and you are at 47.9") is not composed; the numbers are (`goalVdot`, `currentVdot`, `gapVdot` at `:794-798`). Nearest server-composed prose: `composeTargetsSummaryLine()` and `goalAssessment.statement` |
| decision options Hold / Move / Later | "Hold it" → `POST /api/plan/proposal {id, action:'dismiss'}`; "Move to 3:35" → `PATCH /api/race/{slug}`. **"Later" is inert everywhere** | — | |
| decision **settled** state, per-option reply, "Think again" | **NOTHING.** `plan_proposals.status` goes `pending → dismissed/accepted/auto_applied/expired`. No per-option reply text, **no un-dismiss path**; dismiss suppresses the kind for 14 days | — | **GAP 26.** The design's "Think again" button reopens a decision the backend has closed for a fortnight |
| schedule row name/date/rank | `/api/races`; rank from `races.meta->>'priority'` (`races-state.ts:163`) | MEASURED | `RacePriority` has five cases (`types.ts:243`) — `A, B, C, training_run, hilly_excluded`. The design's rank chip handles three |
| schedule row value (goal or finish) | `loadRacesState` computes `goal`, `finishTime`, `finishSource ∈ actual_result\|meta\|run_match`, `finishProvisional`, `finishProvisionalLabel` — and **`/api/races` returns none of them** (`route.ts:29-44` vs `races-state.ts:21-90`) | — | **GAP 27 (wire).** Also a race-data-doctrine hazard: a `run_match` finish **must** render with its provisional label, never as a result. The design's schedule row has one value slot and no label slot |
| expanded "Why it is on here" | `resolveRaceRole()` (`web-v2/lib/faff/race-roles.ts:50`) returns exactly this — `{role, line, tag, tone}`. **Served by no route** | — | **GAP 28 (wire)** |
| expanded "Taper: Three easy days" | the taper *rule* exists (`taperWeeksForDistance()`, `BLOCK_SHAPE[cat].taperWeeks`); **no per-race taper string is produced** | — | **GAP 29** |
| expanded "Reads as: VDOT 49 if hit" | **NOTHING calls `vdotFromRace()` on a *goal*.** One call away | — | **GAP 30** |
| expanded past "Read: VDOT 47.9" | `RaceVdotCandidate.vdot` exists (`web-v2/lib/training/vdot.ts:596-604`); `/api/targets/projection` returns only the winning VDOT, not per-race | — | **GAP 31 (wire)** |
| expanded "Weight: Full for 7 more days" | the mechanism exists and is exact — `VDOT_FULL_VALUE_DAYS = 56`, `VDOT_EXPIRY_DAYS = 84`, `FADE_PER_14D = 0.1` (`vdot.ts:946-988`), plus `authorityTier()` (`web-v2/lib/race/effort-authority.ts:93`). **The copy does not exist.** Nearest served field is `seed.health.vdotAnchor.tier ∈ fresh\|aging\|stale` — whose thresholds (56/120 d) **disagree with the fade's** (56/84 d) | — | **GAP 32**, and an inconsistency worth fixing while it is being wired |
| TrendBars `season.proj` (30 daily reads) | **exists.** `projection_snapshots` table, cron writer `web-v2/app/api/cron/snapshot-projections/route.ts`, reader `loadProjectionSeries(user, distanceMi, 90)` (`web-v2/lib/training/projection-snapshots.ts:131`) | **MODELLED** | **And it is a different model from the headline.** The stored `projection_sec` is `predictRaceTime(vdot, d)` — a *current-fitness* projection — while the "Projected" stat plate shows the goal-seeking number. **The headline and the trend beneath it can disagree by construction.** Rows exist only for days the cron ran; there is no gap-filling, so "Twelve weeks of daily reads" over-claims when the cron missed days |
| footnote "Best read so far 3:18" | derivable, `min()` over the series | — | trivial |
| evidence "Fitness · 49.8 needed · VDOT 47.9" | `goalVdot`, `currentVdot`, `gapVdot` (`:794-798`) | `goalVdot` and `projectedGainVdot` **MODELLED**; `currentVdot` measured-anchored | Design renders both as plain numerals on one row |
| evidence "Last race · 16 Jul · 63 days ago" | anchor date/distance exist (`loadLatestVdotWithAnchor`, `projection-snapshots.ts:184`); race **name** exists on the web seed only. **`/api/targets/projection` returns none of the three** | — | **GAP 33 (wire)** |
| coach log entries | `GET /api/coach/log` → `{entries[{id,kind,dateISO,title,body,meta,ts}]}`, stored as `coach_intents` rows with `reason LIKE 'coach_log_%'` | deterministic | **The backend has 8 kinds** (`web-v2/lib/coach/coach-log.ts:107`): `week_close, phase_boundary, first_ever, fitness_shift, easy_discipline, fitness_evidence, threshold_pattern, race_replacement`. **The design's vocabulary has 4.** `fitness_shift`, `fitness_evidence`, `race_replacement` have no home. Mapping precedent at `SeasonClient.tsx:187-199` |

---

## 8a · Race detail

`GET /api/race/[slug]`. Web precedent: `web-v2/components/redesign/races/RaceDetailClient.tsx`.

| Design field | Source | M/M | Notes |
|---|---|---|---|
| AppBar title + eyebrow | `race.name`, `distance_label`, `date`; `proximity ∈ post-race\|race-week\|sharpening\|building` (`race/[slug]/route.ts:214-217`) | MEASURED | |
| Goal / Projected / Gap row | this endpoint returns `effective_target{target_sec, source:'goal'\|'projection', goal_sec, projection_sec, stretch_goal_sec}` (`:305-320`) and `b_goal` (`:329-334`) — **but no gap.** The gap requires a second call to `/api/targets/projection?race_slug=` | MODELLED | Two endpoints for one three-value row |
| course elevation, 26 points | `/api/race/[slug]` returns raw `course_geometry`; the web seed pre-renders an SVG path and `RaceDetailClient.tsx:158-164` parses it *back* into a number array. For iPhone, serve the array | **MEASURED when GPX exists** — `resolveCourseElevation()` returns `provenance: 'measured' \| 'editorial' \| 'unknown'` (`web-v2/lib/race/course-elevation.ts:344`) | **Two honesty problems.** (a) The design's profile carries **no provenance mark**, so an editorial (typed-off-a-race-website) profile draws identically to a measured one — which is the exact bug `course-elevation.ts` was written to kill. (b) When there is no GPX at all a **fallback zigzag renders unconditionally** (`raceDetail.ts` FALLBACK path, noted at `RaceDetailClient.tsx:151-156`). That is a fabricated shape with no visual distinction |
| 3 labeled marks | `notablesFromElevation()` (`raceDetail.ts:40`) — a per-third read | **MODELLED** (derived from geometry thirds), except 4 curated `course_library` rows | |
| footnote "Net −120 ft" | `netElevFt`, `gainFt` | MEASURED/editorial per provenance | |
| footnote "Nothing over 2%" | per-phase grade exists only where `course_library.geometry_json.phases[].expected_mean_grade_pct` is authored — **4 curated courses** | — | **GAP 34** |
| pace plan by named section | **exists twice.** `buildRacePacing()` → `phases[]{label, start_mi, end_mi, pace_s_per_mi, display, cue}` (`web-v2/lib/race/pacing.ts:196`, cues at `:129-135`); and `buildPacing()` → 4 blocks `{seg:"Miles 1–6", sub, pace, cum}` (`web-v2/lib/race/race-detail-pacing.ts:86`) — a 1:1 match for the design | MODELLED | **Paced off the EFFECTIVE target, not the stated goal** (`race/[slug]/route.ts:150-167`). The build must use `effective_target.target_pace_s_per_mi` and never divide the stated goal by the distance |
| taper progress bar (10 of 16) | **NOTHING.** Inputs exist (`taperWeeksForDistance()`, `BLOCK_SHAPE[cat].taperWeeks`, `plan_phases` taper rows); no field composes them | — | **GAP 35** |
| gear plan · race shoe | **NOTHING on the race surfaces.** `recommendShoe(shoes, 'race')` exists (`web-v2/lib/shoe/recommend.ts:40`) and neither `/api/race/[slug]` nor `/execution-plan` returns any shoe. The only race gear artifact is the static packing list (`web-v2/lib/races/packing.ts:28`), whose "Race shoes" is a checklist item, not a named pair | — | **GAP 36** |
| coach line on the course | `RaceDetailSeed.insight` from `insightFor(name, distMi, netElevFt)` (`raceDetail.ts:114`) | **MODELLED/templated** — a function of net elevation and distance only | Per-race authored prose exists for exactly 4 courses |

---

## 9a · Onboarding

The design's 5-step flow is **not the app's five modes.** The design's five
radio options are five ways to *estimate fitness*. The app's five modes
(`docs/onboarding-qa-2026-08-19.md`) are `race`, `goal`, `justrun`, `coached`,
`beginner` — five different *products*. They are orthogonal axes and the design
covers one of them. This is Collision 4.

Field-level, against `POST /api/onboarding/complete`
(`web-v2/lib/onboarding/state.ts`):

| Design input | Backend | Verdict |
|---|---|---|
| Distance select `5k / 10k / half / marathon / No race yet` | `RaceDistance = '5k'\|'10k'\|'half'\|'marathon'\|'none'\|'coached'` (`state.ts:24`) | **The design's list is missing `coached`.** A runner whose own coach writes the plan cannot say so during onboarding |
| Race date, optional | accepted | fine |
| Goal time, optional | accepted | fine |
| mode "I have a recent race" → distance + finish time | `raceHistory[]` | ✅ |
| mode "I know my hard-effort pace" → "pace for 20 minutes" | `ttDistance ∈ '1mi'\|'5k'\|'10k'` + `ttTime` (`state.ts:151`) | ⚠️ **near-miss** — the backend takes a *time trial over a named distance*, not a 20-minute pace. Either the design's field changes or a 20-min→distance conversion has to be written and cited |
| mode "Training without racing" → weekly mileage stepper 10–70 | `weeklyMi` is an **11-value enum** `{0,5,15,25,35,45,55,65,75,85,95}` (`state.ts:155`) | ⚠️ a continuous stepper posts 24 and gets `null` |
| mode "Coming back from time off" → weeks off + mileage before | **NO FIELD EXISTS** for either | **GAP 37** |
| mode "New to structured training" | inferred, not stated — `experience_level = 'beginner'` from `histYears === '<1' \|\| histAvg ∈ {'0-5','5-15'}` (`complete/route.ts:229`) | ⚠️ works by side effect; the design offers it as a first-class choice |
| Days-per-week stepper, min 2 **max 7** | `VALID_FREQ = {0,1,2,3,4,5,6}` (`state.ts:156`) | ⚠️ **7 is rejected** and falls to `null` |
| Long-run day select Fri/Sat/Sun | `long_run_day` in `/api/settings` ALLOWED | ✅ |
| "Start sessions from this phone" switch | **does not exist** — Collision 3 | **GAP 38** |
| Reveal poster "Base begins today · Easy · 4 mi" | this is the exact hardcoded mini-poster that was **deleted on 2026-08-18** and again from the redesign port today — `docs/onboarding-qa-2026-08-19.md` §7 | **Do not reintroduce it.** Coached mode authors nothing; just-run mode authors nothing; race mode's day one is frequently a rest day. The reveal must read the real day-one row or say there isn't one |

---

## 10a · Settings

`GET/PATCH /api/settings`. `ALLOWED` is exactly: `units_distance`, `units_temp`,
`units_pace`, `long_run_day`, `rest_day`, `quality_days`, `available_days`,
`briefing_time`, `push_enabled` (`web-v2/app/api/settings/route.ts:13-16`).

| Design control | Backend | Verdict |
|---|---|---|
| Long run day | `long_run_day` — plan-shaping, re-runs `generatePlan` inline (`route.ts:23`, `maxDuration = 120`) | ✅ but **the switch takes up to two minutes and rewrites the plan.** The design's Select gives no indication |
| Days per week 2–7 | **not in `/api/settings`.** `weekly_frequency` is patchable via `PATCH /api/profile` with `intIn(1,7)` (`web-v2/app/api/profile/route.ts:77`) | ✅ different endpoint, wider range than onboarding's |
| "Start runs from this phone" | **does not exist** — Collision 3 | **GAP 39** |
| Coach voice statement row | no field; static copy | trivial |
| "Session reminders" switch | `push_enabled` — **one boolean for all 10 notification categories** (`web-v2/lib/notifications/templates.ts` renders raceDay, raceEve, sleepBanking, skipRecovery, weeklyCheckin, niggleCheck, sickCheck, streakMilestone, raceCountdown, stravaReconnect) | **GAP 40** — no per-category preference |
| "Weekly summary" switch | same single boolean | **GAP 41** |
| Units select mi/km | `units_distance` | ✅ |
| Strava connect toggle | separate `/api/strava/*` | ✅ |
| Email row | account | ✅ |
| Sign out | exists in the current client | ✅ |

---

## 11a · Shoes

`GET/POST/PATCH/DELETE /api/shoe`. Columns: `id, brand, model, color, color2,
run_types[], mileage, mileage_cap, baseline_mi, retired, preferred, notes`.

| Design element | Backend | Verdict |
|---|---|---|
| Card name + current mileage | `brand`/`model` + `mileage` computed on read from canonical runs | ✅ MEASURED |
| Progress bar against retirement mileage | **`mileage_cap` exists** — this is better than the brief assumed. But `POST` defaults it to a flat `400` (`web-v2/app/api/shoe/route.ts:94`) for every shoe, and nothing derives it from the shoe's type | see Collision 2 |
| "racing ~150–250 / trainers ~400" by model type | `run_types[]` exists and can carry the type; **nothing maps type → cap**, and no doctrine claim binds those numbers | **GAP 42** |
| Wear these / Retire these | `PATCH {id, preferred}` / `PATCH {id, retired}` | ✅ |
| Add a pair | `POST /api/shoe` | ✅ (the design marks its own button a no-op) |
| Retired list | `retired` boolean; GET returns retired shoes and expects the client to filter | ✅ |

---

## 12a / 12b · Live run

Both screens exist in the current app already:
`native-v2/Faff/Faff/Views/PhoneRunView.swift` and `TreadmillView.swift`, routed
from `RunActionMenu` via `RootTabView.outdoorRoute`. See Collision 3 — the
capability is not the problem; the *setting the design invents to gate it* is.

| Design field | Source | Notes |
|---|---|---|
| elapsed, distance, current pace, HR | `PhoneRunTracker` / `TreadmillHRStreamer` locally | ✅ |
| pace target band | `/api/watch/today` `phases[].targetPaceSPerMi` + `tolerancePaceSPerMi` | ✅ **MODELLED** target |
| HR ceiling band | `hrCeilingBpm` / `phases[].hrTargetBpm` | ✅ **MODELLED**, possibly off a crosswalk LTHR |
| "Interval 2 of 4 · 0.6 mi to go" | derivable from `phases[]` | ✅ |
| 12b speed / incline ± | `TreadmillView` already drives these and posts `phases[].actualSpeedMph` / `actualInclinePct`. The runner **types** the numbers — the phone does not talk to the treadmill; distance is `speed × time` and elevation is synthesised (`TreadmillView.swift:306`) | ✅ writing; **reading them back is GAP 11/12** |
| 12b "Next · 8.6 mph in 0.6 mi" | derivable from the next phase's target pace | ✅ |

Two constraints the design's live-run screens do not account for:

- **12a records only in the foreground.** `PhoneRunTracker.swift:111` sets
  `allowsBackgroundLocationUpdates = false` and the target has no location
  background mode. Lock the screen and the run pauses. The design shows no
  "keep this screen awake" affordance and no interrupted-run state.
- **12b's HEART tile is blank without a watch.** `TreadmillHRStreamer` reads HR
  from HealthKit where the watch wrote it; with no watch, `currentBpm` is nil
  forever. The design draws HEART as one of three equal stat columns with no
  empty variant.

---

## 13a · Injury flare

The design's screen is a **rest verdict** — "Not today". The backend has three
different things it could mean and the design merges them:

- **Niggle** (`web-v2/app/api/niggle`) — explicitly *"the runner can still
  train; the plan does NOT pause"* (`route.ts:10-12`). Severity <5 is logged and
  ignored; 5–6 downgrades the next quality day; ≥7 suspends running 48 h
  (`web-v2/lib/plan/adapt.ts:2145-2166`). `NiggleSeverity` has four bands
  (`types.ts:246`).
- **Injury** (`runner_injuries` + `web-v2/lib/plan/injury-builder.ts`) — an
  authored 12-week return plan with an **8-stage walk-run ladder**.
- **Sick** (`web-v2/app/api/sick`) — a separate episode model with three return
  gates.

| Design field | Source | Notes |
|---|---|---|
| `injury.area` + "Flagged 2 days ago" | `GET /api/niggle` → `{active:{body_part, side, severity, status, logged_at}}` | ✅ |
| `injury.verdict` | `buildSibling` composes niggle copy incl. `bail_trigger: 'pain > 4/10'` (`glance-adapter.ts:893-929`) | ✅ |
| "What changed · 12 mi this week" | derivable from `/api/training/state` | ✅ |
| check-in Better / Same / Worse | `/api/niggle/recovery` | ✅ — and `sick/recovery` uses the same `better\|same\|worse\|recovered` vocabulary |
| the walk-run stage, the pain rule, the return band | `WALK_RUN_LADDER`, `MAX_WALK_RUN_STAGE = 8`, `doctrineWeeksLabel()` (`web-v2/lib/plan/injury-protocols.ts:120-156, :624`) — the engine composes *"Walk-run ladder from week N, one stage a week, alternate days. Doctrine total return {band}. Pain 0-2 carry on, 3-5 hold, 6 or more stop."* (`injury-builder.ts:493`) | **none of it has a screen** — List B #7 |

---

## 14a · Week off

| Design field | Source | Notes |
|---|---|---|
| `weekOff.range` | — | the runner would set it |
| `weekOff.reason` "Travel · Denver" | `POST /api/plan/replan {reason:'travel', fromISO, toISO}` accepts the reason token but **stores no free-text reason** | design shows prose the backend does not keep |
| `weekOff.coach` | no producer | template |
| `weekOff.returns` "Monday 25 · Easy, 4 mi" | derivable from `/api/plan/week` after the replan | ✅ |

The design's Week off is the *only* screen that renders a replan result, and it
renders it as a settled fact. There is no "here is what this costs, confirm"
step anywhere — see Collision 2's replan mapping.

---

## 15a · Off-season

`web-v2/lib/faff/block-state.ts:20` gives `BetweenBlocksReason` **three** values:
`recovery`, `block-over`, `no-plan`. The design has one screen for all three.

| Design field | Source | Notes |
|---|---|---|
| `offSeason.since` "Since CIM · 3 weeks ago" | last race from `races-state` | ✅ |
| the **Silence** component | correct instinct, and the backend agrees: for `justrun` the engine authors nothing and the plan-drift cron does not even include the runner in its population (`docs/onboarding-qa-2026-08-19.md` §2.3) | ✅ **this is the design's best idea** |
| `offSeason.weekRange` "0 – 20 mi" | no producer | would be typed |
| "Plan the next block" | `POST /api/race` or `POST /api/profile/goal`, both of which author a plan | ✅ |

But: a runner who just finished a race with nothing booked is **not** in
off-season by the engine's reckoning. `authorOpenBlock` gives them a real
authored block — recovery, maintenance, or goal-build (List B #5). The design's
Off-season screen would render over the top of a plan that exists.

---

## 16a · Data outage

The one screen with no backend dependency, and the only screen that states a
content rule the rest of the design should have adopted: *"Readiness did not
load. Your score is fine, we just cannot see it."* — fault red means **we could
not read this value**, never a real value.

That rule is right and it is under-applied. Readiness is `null` on cold start by
design (`web-v2/lib/coach/readiness.ts:90`) and needs 14 days of history before
its band can move. **"We have not got enough of your data yet" is not the same
state as "the network failed", and the design has a screen for the second and
not the first.**

---

# PART 2 · The four collisions

## Collision 1 · The palette gate — **owner's call, not an engineering one**

### What the gate checks

`scripts/check-palette-sync.sh`, wired at `web-v2/package.json:8`:

```
"prebuild": "bash ../scripts/check-palette-sync.sh && bash ../scripts/check-doctrine.sh"
```

so it runs on **every Railway build**. Four sections:

1. **LOCK CHECK** — positive `grep` assertions that each surface's token file
   contains the exact locked hex for each semantic slot. Files:
   `native-v2/Faff/Faff/Theme.swift`,
   `legacy/native/Faff/FaffWatch Watch App/WatchTheme.swift` and `FaceKit.swift`.
   **Web's assertions are already commented out** — exempted 2026-08-18 for the
   site-wide redesign.
2. **RETIRED-HEX TRIPWIRE** — a `grep -rinE` over `native-v2/Faff/Faff` and the
   watch app for 24 retired hexes plus 20 decimal-RGB forms. **`web-v2` is
   excluded** for the same reason.
3. **WATCH HEX ALLOWLIST** — every `Color(hex: 0x……)` under the watch target
   must be one of ten values. **There is no equivalent allowlist for the iPhone
   target**, so new neutral hexes on iPhone are invisible to CI.
4. **Z2 LADDER RUNG** — `Theme.swift` must contain `z2 = Color(hex: 0x3EBD41)`.

Wired in two places, not one:
- `web-v2/package.json:8` `prebuild` → `railway.json` `buildCommand` runs
  `npm run build`, so **every Railway deploy runs the iPhone/watch lock** even
  though nothing about web changed.
- `scripts/ship-testflight-v2.sh:150`, under `set -euo pipefail` — **every
  TestFlight archive is gated.**
- The 10 GitHub Actions workflows are cron/ops only and invoke neither script.
  The Xcode build phase the script's own header mentions does not exist
  (`grep` over `*.pbxproj` finds nothing).

Baseline, run just now on this worktree:

```
palette-sync OK · iPhone/watch ten-color lock verified (web exempted for redesign, see header)
EXIT=0
```

### What this design violates

**(a) All sixteen positive assertions on `Theme.swift` fail.** Note the shape of
the check: `need()` greps for the exact *declaration form*
(`green *= Color\(hex: 0x3EBD41\)`), not for the hex's mere presence. So even the
three locked hexes the new design still contains — `#3EBD41`, `#F3AD38`,
`#27B4E0`, which survive as day-state gradient heads — fail unless the semantic
token names (`Theme.green`, `Theme.goal`, `Theme.dist`) survive with them, and
the new design's token vocabulary is `signal / attention / fault / four surface
steps`, not the old ten.

| assertion | requires | in the new design |
|---|---|---|
| `Theme.green` | `#3EBD41` | hex survives as the Easy gradient head; **the token does not** |
| `Theme.goal` | `#F3AD38` | hex survives as the Threshold gradient head; **the token does not** |
| `Theme.dist` | `#27B4E0` | hex survives as the Long-run gradient head; **the token does not** |
| `Theme.over` | `#FC4D64` | **gone** — fault red is `#FF4438` |
| `Theme.race` | `#D03F3F` | **gone** — race head is `#FF8847`, accent is `#FF5A1F` |
| `Theme.intervals` | `#FC4D64` | **gone** |
| four effort-dot `case` arms | `#3EBD41` / `#D03F3F` / `#FC4D64` | the design has no effort-dot system |
| TweakAccent ember ×2 | `#F3AD38` / `#D03F3F` | **gone** |
| gold / violet / cool accents ×3 | `#F0DF47` / `#B794F4` / `#3AA0E0` | **gone** — and this is the sharpest one: TweakAccent is a shipped *user-preference* feature that brief v2's own ADDENDUM ruled exempt-but-synced, and **the new design has no accent-variant system to map it onto at all** |
| Z2 ladder rung | `z2 = Color(hex: 0x3EBD41)` | **gone as a declaration** |

**(b) Three of the design's own hexes are on the RETIRED tripwire**, so they
fail CI *even if the positive assertions were satisfied*:

| design token | hex | status |
|---|---|---|
| Race gradient head | `#FF8847` | **RETIRED** |
| Race + Threshold gradient mid | `#E85D26` | **RETIRED** |
| Rest gradient head | `#008FEC` | **RETIRED** |

Note the irony: `#FF8847` and `#008FEC` are retired on iPhone/watch and *live*
in `web-v2/app/redesign/tokens/colors.css` right now, because web is exempted.
The same two hexes are simultaneously banned and shipped.

**(c) One violation is not machine-checked and matters more than the ten that
are.** The gate's header records a locked owner ruling:

> 2026-06-18 · ORANGE RETIRED. […] David ruled ANY orange reads "Strava"
> regardless of shade. […] `#E88021` retired app-wide; no orange anywhere.

**The new design's primary accent is signal orange `#FF5A1F`** — the runner's
current position, the primary action, the one highlighted bar in every chart.
That is a direct reversal of a locked ruling. No script will catch it because
`#FF5A1F` was never a canonical hex, so it is not on the retired list. It needs
a person to say yes.

**(d) Typography — not CI-enforced, and a hard build blocker anyway.**
`Design/running-app-design-brief-v2.md` lines 73-80 lock Oswald (display, ≥16pt)
· Inter (body/UI) and states *"No other typefaces."* The design specifies
Instrument Sans (interface + numerals) and Archivo 800 width 112 uppercase
(display). Nothing in CI greps for a font name — neither `check-palette-sync.sh`
nor the doctrine gate, whose registry contains zero hits for `Oswald`, `Inter`,
`font`, `typograph` or `palette`. The enforcement is the brief's prose.

But the app cannot render the new faces regardless: `native-v2/project.yml:77-88`
registers exactly Anton, Oswald ×5 and Inter ×5, and
`native-v2/Faff/Faff/Resources/Fonts/` holds those eleven `.ttf` files and
nothing else. **Instrument Sans and Archivo are not in the bundle** — they exist
in this repo only inside `docs/font-exploration-2026-05-27.html`.
`native-v2/Faff/Faff/Fonts.swift:29-70` hardcodes the `Oswald-*` / `Inter-*`
PostScript names. Licensing, adding the files, `project.yml`, and `Fonts.swift`
all have to move before a single label renders correctly.

Worth noting while it is open: `Fonts.swift:3` already ships **Anton** as a third
brand face, which "No other typefaces" prohibits. The gate never caught it
because it has no typography check.

**(e) A contradiction inside the design itself, which the owner should resolve
before the gate question is even asked.** The README's colour section states
*"No green anywhere — this app never grades a number as 'good.'"* The day-state
gradient table three paragraphs later opens with `Easy → #3EBD41 → #1F8A52 →
#0F4A3A` — the locked green, at full strength, as an entire full-bleed panel.
Both cannot be true. Which one wins changes whether `Theme.green` can survive at
all.

### The options

1. **Extend the exemption to iPhone.** One commit, same shape as the
   2026-08-18 web exemption: comment out the 16 `Theme.swift` assertions and
   scope the RETIRED tripwire to exclude `native-v2`. Watch keeps its lock.
   **Cost: ~1 h.** Consequence: neither web nor iPhone is locked while both are
   in flight, and brief v2's "byte-for-byte across three surfaces" intent is
   suspended for however long that lasts. This is what web did. Note it also
   unblocks **`ship-testflight-v2.sh`**, which aborts at line 150 under `set -e`
   before it archives — so without this, no TestFlight build ships either.
2. **Re-lock against the new palette.** Rewrite the assertion table to the new
   ten (or however many) semantic slots, move the three retired hexes off the
   retired list, add the new neutrals, and update brief v2 first as its own
   header instructs. **Cost: ~1 day**, and it cannot start until the palette is
   final and the watch's answer is known.
3. **Redesign all three surfaces together.** What the brief actually asks for.
   **Cost: iPhone + watch + web token unification, weeks.**

**Do not change the gate.** Options 1 and 2 are both owner decisions. The one
thing the build session must not do is quietly comment out an assertion to get a
green build.

---

## Collision 2 · "Start runs from this phone" — the setting does not exist; **the capability does**

The brief's premise is half right and the half that is wrong is the good half.

**Phone-initiated runs are fully built.**
`native-v2/Faff/Faff/Components/RunActionMenu.swift:25-42` is already a bottom
sheet with the design's exact two choices plus two more (niggle, view activity).
`native-v2/Faff/Faff/Views/RootTabView.swift:402-405`:

```swift
private var outdoorRoute: FaffRoute {
    let ws = WatchSync.shared
    return (ws.isPaired && ws.isWatchAppInstalled) ? .watchMirror : .phoneRun
}
```

`PhoneRunView.swift` (GPS, `PhoneRunTracker.swift`, 395 lines — full state
machine, accuracy filtering, trailing-30s pace window, its own Google-polyline
encoder) and `TreadmillView.swift` (speed/incline console) both exist and both
post a `WatchCompletion`-shaped payload to `/api/watch/workouts/complete`, whose
`ALLOWED_SOURCES` already whitelists `'phone'` (`route.ts:213`).

**Two limits the design must know about before it promotes this path from
fallback to first-class:**

- **The phone recorder is foreground-only.** `PhoneRunTracker.swift:111` sets
  `allowsBackgroundLocationUpdates = false`, and its header (lines 21-27) states
  that the iPhone target carries no `UIBackgroundModes` location entitlement and
  that none is being added. **Backgrounding the app or locking the screen pauses
  recording.** The design's 12a is drawn as a glance surface for a phone in a
  hand or an armband, which is survivable — but the moment a runner locks the
  screen mid-run, the run stops. Making this the *default* path needs the
  entitlement, which needs an App Store review justification.
- **The phone cannot read a treadmill and cannot get HR on its own.**
  `TreadmillView` is a console the *runner types into* — speed and incline are
  `@State` values, distance is `speed × time`, elevation is synthesised as
  `distDelta × 5280 × incline/100` (`TreadmillView.swift:306`).
  `TreadmillHRStreamer` is receive-only: it reads HR from HealthKit
  (`requestAuthorization(toShare: [], read: [hrType])`) where **the watch put
  it**. With no watch, `currentBpm` stays nil forever. The design's 12b shows a
  live HEART number beside SPEED and INCLINE with no watchless variant.

**So the collision is not "can the phone start a run".** It is:

- **The app decides automatically what the design wants the runner to decide.**
  Today, Outdoor routes to the watch when a Faff watch app is installed on a
  paired watch, and to the phone otherwise. The design replaces that inference
  with an explicit switch, and — much more consequentially — **makes that switch
  gate whether the RUN pill appears in the tab bar at all.** Today the RUN
  affordance is unconditional.
- **No such setting exists.** `/api/settings` `ALLOWED` does not contain it
  (`web-v2/app/api/settings/route.ts:13-16`); no migration adds it; grep finds
  no `fromPhone` / `start_from_phone` anywhere in `web-v2` or `native-v2`.
- **The design asks for it twice** — onboarding step 4 and Settings — and calls
  Settings "the single source of truth", so the two must write the same key.

**Cost: ~half a day** for the setting itself. One key added to `user_settings`,
one entry in `ALLOWED` (`web-v2/app/api/settings/route.ts:13-17` — anything not
in that set is rejected `400 not allowed`), one `Switch` in each of two screens,
and a conditional on the tab bar. Nothing new has to be built to *run*. The
background-location entitlement, if the owner wants phone runs to survive a
locked screen, is a separate and much larger piece of work.

**One thing to decide, not to guess:** turning the switch OFF must not hide the
RUN pill from a runner who has no watch, or they can never start anything. The
current code gates on `isPaired && isWatchAppInstalled` precisely because
"Outdoor dead-ended into a permanent *Standing by · start on your Apple Watch*
empty state with no watch that could ever answer" (`RootTabView.swift:390-397`).
That bug is fixed; the design's switch can reintroduce it.

---

## Collision 3 · Shoe retirement mileage — **most of it exists**

The brief says shoes carry "a `retired` boolean and tracked mileage, with no
threshold to draw a progress bar against". That is not what is there.

`web-v2/app/api/shoe/route.ts`:
- `mileage_cap NUMERIC` is a real column (DDL in `legacy/web/lib/db.ts:115-127`),
  selected on GET and returned, writable on POST and PATCH.
- `mileage` is computed on read from canonical runs (`computeShoeMileage`,
  `web-v2/lib/shoe/mileage.ts:28`, MAX-per-day-per-shoe to survive duplicate
  ingest) plus a manual `baseline_mi` offset (migration 141). **MEASURED.** The
  stored `shoes.mileage` column is stale and deliberately ignored — its header
  records that *0 of 7 stored values matched the run sum*.
- `pctUsed` is **already computed and served**:
  `web-v2/lib/coach/profile-state.ts:207-208` returns `cap` and
  `Math.round((m / cap) * 100)`. Threshold UI already keys off it —
  `ShoesView.swift:174` counts "RETIRE SOON" above 0.85,
  `TodayPostRunBody.swift:211` and `RunShoePickerSheet.swift:92` warn above 0.8.
- Auto-assign is implemented and wired at the single post-write chokepoint
  (`web-v2/lib/shoe/auto-assign.ts:35` via `afterRunWrite`), priority:
  runner's `/today` pick → Strava gear match → `recommendShoe`.

**So the progress bar is buildable today.** Three narrower things are missing:

1. **The cap default is a mess, not a gap.** Five sites hardcode three different
   numbers: POST create **400** (`app/api/shoe/route.ts:94`), auto-assign **400**
   (`auto-assign.ts:139`), coach profile-state **400**
   (`profile-state.ts:206`), the **iPhone garage card 450**
   (`ShoesView.swift:290`), and the **web Gear add-form 350**
   (`GearClient.tsx:177`). The same shoe added on web and on phone gets a
   different life, and a NULL cap draws its bar against 450 while the coach
   reasons against 400.
2. **Shoe TYPE is not stored, and `run_types` is not it.**
   `ShoeRunType = 'race'|'long'|'easy'|'recovery'|'tempo'|'intervals'|'as_needed'`
   (`web-v2/lib/shoe/recommend.ts:18-25`) is a **multi-select role tag** saying
   which workouts a shoe is for. A carbon racer and a daily trainer both tagged
   `["race","tempo"]` are indistinguishable. Nothing derives a life expectancy
   from a tag, and `recommendShoe` never consults `mileage_cap` at all — a shoe
   at 395/400 mi is still recommended.
3. **No doctrine claim binds the numbers.** Racing 150–250 and trainer 400 are
   assertions about equipment life. Per CLAUDE.md Rule 7 they want a
   `DOCTRINE_REGISTRY` entry with a `Research/` anchor, or they are three
   numbers someone typed. `Research/` has no shoe-life table that I could find —
   if there genuinely is none, the honest move is a `CONVENTION` citation, not a
   fabricated one.

**Cost: ~1 day** — a model-type field (new column, or a derived category), one
authoritative default table replacing the 350/400/450 spread, and a UI field the
web add-form (which currently splits a single "Name" input on whitespace into
brand/model) has no room for. **Plus a research question** for the numbers
themselves, which is not an engineering task.

---

## Collision 4 · The design covers one of five modes — **confirmed, and it is the largest gap in the bundle**

`docs/onboarding-qa-2026-08-19.md` verified all five modes end-to-end against
production accounts today. Against that ground truth:

| mode | authors a plan? | has an A race? | the design's Today / Block / Races |
|---|---|---|---|
| **race** | yes | yes | ✅ the whole bundle is drawn for this runner |
| **goal** (a distance goal, no race row) | **yes** — `training_plans.race_id = NULL`, `mode='race-prep'`, `goal_iso` set | **no** | Today works. **Block's "N weeks to [race]" has no race. Races' panel is headed "Next A race" and there isn't one.** Races has no other state |
| **justrun** | **no** — `training_plans` count 0, `races` 0, excluded from the plan-drift cron population | no | **Today has no prescription to render. Block has no block. Races has nothing.** Three destinations, three empty screens |
| **coached** | **no, by design and by gate** — `isCoachedExternally` refuses at all six authoring entry points (verified live in the QA doc §2.4) | **yes, and a goal too** | Races renders correctly off the saved race — measurement without prescription, which is the point of the mode. **Today and Block have nothing, and must say so without implying a failure** |
| **beginner** | yes | no | Today works. `goal_vdot: null`, `season_anchor_source: 'provisional_mileage'` — **every pace on the screen is off a provisional anchor and nothing says so** |

And the design's own onboarding **cannot select `coached` at all** — its distance
list is `5k / 10k / half / marathon / No race yet`, and the backend's sixth value
is `'coached'`.

Also confirmed by the QA doc and worth carrying into the build: this exact class
of bug already bit once. `CompletionScreenRedesign.tsx` rendered a hardcoded
`Easy 4.0 · 8:45 /mi · ~35m` day-one poster **for every mode including coached**,
where Faff authors nothing. It was fixed today. The new design's screen 9a step 5
is the same poster.

**Cost:**

- **coached** — one Today state, one Block state, one onboarding option, and the
  Races screen already works. **~1 day.**
- **justrun** — three empty states with real copy (the app already has good copy
  for this, shipped today: *"Nothing prescribed. Add a race or a goal and Faff
  builds the block around it. Runs you log land here either way."*). **~1 day.**
- **goal-mode** — Block and Races both need a no-race variant. Races' entire
  panel grammar is built around a named race. **~2 days**, and it needs a design
  answer first, not just an engineering one.
- **beginner / provisional anchor** — a provenance mark wherever a pace is
  rendered off `season_anchor_source: 'provisional_mileage'`. Cross-cutting.
  **~1 day** and it is the single highest-value honesty fix in the bundle.

---

## The replan mapping · "Change the plan" vs `/api/plan/replan`

`POST /api/plan/replan` accepts **exactly three reasons** — `'sick' | 'travel' |
'life'` — plus `fromISO` and `toISO` (`web-v2/app/api/plan/replan/route.ts:56`).
Three facts about it that change how the design's sheet should be built:

1. **It is a full re-author, not a surgical edit.** All three reasons run
   `generatePlan({raceSlug: plan.race_id})` (`:82`), archiving the current plan
   and re-deriving everything from today's inputs. `sick` additionally applies a
   Research/05 return-to-run ladder to the first three weeks of the *new* plan
   (50 / 60 / 75 % volume, week 1 quality stripped to easy, `:91-158`) via
   `mutatePlan`, so a validator violation refuses the ladder and reports
   `ladderWeeks: 0` rather than failing the request.
2. **`fromISO` and `toISO` are inert.** They are validated, then written into the
   audit blob at `:165`, and **never used to modify the plan**. `travel` and
   `life` are byte-identical in behaviour to each other and to `sick`-minus-the-
   ladder. The endpoint cannot take weeks 10 and 11 out; it can only rebuild.
3. **It has no caller.** Grepping `replan` across `web-v2/components`,
   `web-v2/app` and `native-v2/Faff` finds the route itself and an unrelated
   `{replanned:true}` toast from the settings/profile PATCH path. **`/api/plan/replan`
   is an orphan endpoint.** It also `404`s unless the active plan has a
   `race_id` (`:66-74`) — **a goal-mode or just-run runner cannot use it at all.**

| Design scenario | Backend | Verdict |
|---|---|---|
| **"I need an easier week"** · week 7 becomes a cutback | **no path.** Cutbacks are *authored*, not requested — `cutbackCadence(tsbAtStart)` (`generate.ts:1214`) sets every 4th non-taper week to 85 % of last peak (`:1300-1306`), with the cadence shifted by cumulative stress. **No parameter, column or endpoint marks a specific week index as a cutback.** The only way to get one is to re-author and hope the cadence lands there | **GAP 20 — no path** |
| **"I am away"** · weeks 10 and 11 out | `reason:'travel'` is accepted, but per fact 2 the named window is discarded. Whether the peak moves to week 14 is an emergent property of `generatePlan`, not something the caller asked for or can predict. **The design's copy promises a specific consequence the endpoint cannot deliver** | **GAP 21 — accepted in name only** |
| **"I can run more days"** · five now, six from week 7 | **"now" works.** `PATCH /api/profile {weekly_frequency}` is allowed and validated `intIn(1,7)` (`app/api/profile/route.ts:77`), is in `PLAN_SHAPING`, and fires `rebuildActivePlanForPrefs` inline returning `{ok, updated, replanned}`. Which days is separately editable via `PATCH /api/settings {available_days\|long_run_day\|rest_day\|quality_days}`. **"from week 7" does not exist** — `weekly_frequency` is a scalar with no effective date, no schedule and no per-week override | **GAP 22 — the scheduled half has no representation** |
| **"I entered another race"** · a 10k in week 11 replaces that week's quality session | **this one is real, and already implemented to the design's own sentence.** `POST /api/race` fires `fireAutoRebuild({kind:'a_race_added'})` (`app/api/race/route.ts:145-215`, guarded by plan-window relevance and `suppressDriftNearRace`), reaching `embedMidBlockRaces` (`generate.ts:3942+`). For a C race at `:3986-3990` it sets `type='race'`, `isQuality=true`, `subLabel='RACE'` and the note *"C race · this is the week's quality session. Run it as the workout."* A B race additionally gets a mini-taper (`MINI_TAPER_RUNNING_DAYS = 2`) and recovery days after | ✅ **but not through this sheet** — it is a side effect of saving a race, the runner never sees what changes, and there is no undo |

Two more things the sheet promises that no endpoint provides:

- **The stated trade-off before committing.** The design shows the coach's full
  consequence ("Ninety-six miles come out of the middle of the build · the peak
  moves to week 14 and the long run tops out at 18, not 20. Sub 3:30 is still
  on, with less margin.") and *then* a confirm button. **Nothing in the system
  previews a whole-plan change before committing it.** `/api/plan/replan` writes
  its audit row with `status:'auto_applied'` and links to the diff *after* the
  plan has already been replaced. `/api/plan/simulate` runs the real engine and
  writes nothing — but its input is `SimInputs`, synthetic *onboarding* answers,
  so it cannot simulate a delta against a live plan. `/api/plan/diff` compares
  two plans that both already exist and cannot show a hypothetical.
  **GAP 23 — this is the single most valuable missing endpoint in the bundle.**
- **Undo.** The design's Block screen shows a "Changed" list with an Undo per
  entry. `/api/plan/restore` is a different thing entirely — it restores **one
  workout row** the auto-adapter downgraded, promoting `original_*` back and
  rejecting `not_adapted` / `missing_originals` / `cannot_restore_past`.
  **Nothing restores a whole plan.** The old plan is archived, not deleted, so
  the data survives; no endpoint exposes going back to it. **GAP 24.**

Two things that *do* exist and should be used:

- `GET /api/plan/diff?from=&to=` returns `byDate[]` with
  `changeKind ∈ unchanged|distance|type|sub_label|added|removed` and
  `summary{daysChanged, milesDelta, qualityDaysChanged}`. `/api/plan/replan`
  already returns a `diffUrl` pointing at it. **The "Changed" list is feedable
  today.**
- **The propose-first pattern already exists and is fully wired on both ends —
  at single-workout granularity.** `GET /api/plan/workout-proposals` +
  `/:id/accept` + `/:id/dismiss` returns
  `{actionKind, actionPayload:{newType,newDate,shaveFraction,why}, reason, evidence}`
  and renders as "LET IT HAPPEN" / "KEEP ORIGINAL". **That is the design's sheet,
  one scale down.** Whoever builds the plan-level version should copy its shape
  rather than invent one. (Note `GET/POST /api/plan/proposal`, the plan-level
  sibling, carries a header stating *"NATIVE WIRING IS NOT DONE. This route is
  the contract only."*)

**Cost of a preview endpoint:** the engine is already pure enough to run
in-memory (`/api/plan/simulate` proves it) and the diff classifier already
exists. A `POST /api/plan/replan?dryRun=1` returning the same diff without
persisting is **~2 days** including the coach-sentence composition, and it
unlocks four design affordances at once. Making `fromISO`/`toISO` actually
remove the named weeks is a separate and larger piece of work.

---

# PART 3 · Constraint compliance

| Constraint | Verdict |
|---|---|
| **Never present a modelled value as measured** | **VIOLATED, repeatedly and structurally.** The design has no provenance mark of any kind. Concretely: (a) `Projected` on Races is the goal itself until drift fires; (b) the projection trend beneath it is a *different* model; (c) the HR ceiling may be an `HRmax × 0.92` crosswalk and the flag exists unread; (d) post-run rep verdicts are judged against heat-softened targets with no mark; (e) a race course profile with `provenance: 'editorial'` draws identically to a measured one, and a race with no GPX draws a fabricated zigzag; (f) block phase boundaries fall back to a proportional 45/30/15 split for legacy plans; (g) every pace shown to a beginner is off `season_anchor_source: 'provisional_mileage'`. **The design needs a provenance affordance and does not have one.** The token system has a slot ready for it: attention amber `#F2B03C`, spec'd as "stale data, a decision waiting" |
| **Readiness informs; it changes a session only on a convergence of independent signals, settled the night before** | **The design is compliant by omission and non-compliant by omission.** It never claims readiness moved the plan — good. But it renders readiness as one bare 0–100 integer in a list row, which is exactly the shape that invites "my score is 57, that's why today got easier". The convergence model's own contract (`web-v2/lib/coach/convergence.ts:54-56`) is: green = nothing happens · **amber = the runner is told, THE PLAN IS NOT TOUCHED** · red ≥3 domains = quality may be downgraded. **The design has no place to say "the plan is unchanged", which is the amber verdict's entire content.** See List B #2 |
| **The engine is allowed to decline** | **VIOLATED by omission.** `selectWorkout()` returns five distinct refusals, each with a runner-ready sentence, and every one is discarded (`web-v2/lib/workout-catalogue/select.ts:975-1005`; the result is dropped at `generate.ts:3203-3260`). The design has no screen for a week that correctly carries no quality session, no screen for the ultra refusal, and no screen for the eight plan-generation refusals in `loadGeneratorInputs`. The design's only "nothing here" screen is Off-season's **Silence** — which is the right component and is pointed at the wrong state |
| **Coach voice** | **Compliant.** Two em dashes in the whole 242 KB file: one in a code comment, one in the numeric range "6 — 8 AM". Zero exclamation marks in copy. No emoji. No hype. Nothing scolds — even the sharpest line ("Your last five easy days averaged 79% of max. Easy is 65 to 75 · run them under 148 and let the pace fall where it wants") states the number and the correction without blame. The middot separator matches house style. **This part of the handoff is ready to ship as written** |
| **The watch wire contract is frozen** | **`WatchCompletion` untouched. The week strip is safe. The calendar is not.** See the section below — this one needs more than a table row |

### The watch wire contract, in full

**`WatchCompletion` is untouched by this design and stays that way.** Canonical
copy at `legacy/native/Faff/FaffWatch Watch App/WatchWorkoutModels.swift:461-493`,
mirrored at `native-v2/Faff/Faff/Models/Watch.swift:289` under a header that says
*"DO NOT delete or modify the watch copy… it is the wire-contract source of
truth"*. `Encodable`, camelCase, **no `CodingKeys`**, so Swift's synthesised
encoder emits the property names verbatim. The backend declares both spellings
for `routePolyline` and `elevGainFt` because reading only the snake_case form
silently dropped every watch GPS track for a month (the Jun 8 regression, quoted
at `web-v2/app/api/watch/workouts/complete/route.ts:110-116`). Nothing in this
design goes near that path.

**`date_iso` is confirmed as the SwiftUI identity of a plan day** —
`native-v2/Faff/Faff/API.swift:1451`, `var id: String { date_iso }` — and on the
`/api/plan/week` path the invariant genuinely holds. `route.ts:150-152` emits
*"EXACTLY 7 contiguous days from weekStart… no dupes, no gaps"*, collapsing
double-booked dates through a `TYPE_PRIORITY` `bestByDate` map and exposing the
loser as `secondaryRun` rather than hiding it. It is swept combinatorially by
`web-v2/lib/plan/_audit_structural.test.ts` INVARIANT 2 (assertions at 199-218,
driven from line 443) and mirrored by a doctrine claim at
`web-v2/lib/doctrine/registry.ts:10946`. **The design's week strip — one rail per
day, keyed by date — is safe.**

**The design's calendar is not, and this is a live bug the build will walk into.**
The month/season calendar cannot use `/api/plan/week` (it would be 8+ round
trips, which is what `TrainingCalendarView.swift:195-202` does today). The
natural source is `/api/training/state` — and that endpoint **does not collapse
per date**. `web-v2/lib/coach/training-state.ts:133-134` selects every
`plan_workouts` row `ORDER BY date_iso` and `:214-239` maps them 1:1, so a
double-booked date yields **two** day objects. The server is honest about it:
each carries a unique `id: String(d.id)` (`:229`), the `plan_workouts` primary
key. **The client throws it away** —
`native-v2/Faff/Faff/API.swift:2122-2135` declares `var id: String { date }` and
omits `id` from `CodingKeys`, so the unique row id is never decoded.

Consequence: any `ForEach` over `TrainingPlanDay` — which a calendar listing days
by weekday letter and day-of-month necessarily is — hits **duplicate
`Identifiable` ids** on a double-booked date, where SwiftUI's behaviour is
undefined. `TrainView.swift:1316` and `1371-1375` already work around it by
building `[String: TrainingPlanDay]` dictionaries keyed by date, which silently
discards the second row — the same collapse `/api/plan/week` performs
deliberately and visibly, done here by accident and invisibly. A quieter bug
rides along: `training-state.ts:219` does `actualByDate.get(d.date_iso)` per row,
so two rows on one date both receive the same `doneMi`/`activityId` and the
completed run is double-attributed.

This is filed and half-fixed. `docs/PHONE-WATCH-AUDIT-2026-07-06.md:163` asked
for both halves — collapse per date server-side, and make `TrainingPlanDay.id`
use the `plan_workouts` id already in the payload. STRENGTH-3 (2026-08-17)
removed the strength enrichment that was the commonest source of same-date pairs
(`training-state.ts:256-261`), so the symptom got rarer. **Neither half of the
actual fix landed**, and adapter collisions — easy + long on one date, exactly
what `secondaryRun` exists to surface — still produce duplicate ids.

**Before building the calendar sheet, do one of the two.** Decoding the server's
`id` in `API.swift:2133-2135` is the smaller change.

---

# LIST A · Screens the backend cannot feed

Ranked by how much work closing the gap is. "Cannot feed" means the screen
cannot be built as drawn — not that it is impossible.

**1 · Races (7a) — the heaviest.** Six of its nine regions are blocked. The
schedule row's value/provenance, the per-race expansion (role, taper, VDOT read,
weight copy), the evidence rows' anchor identity, and the decision card's settled
state all need work; `/api/races` throws away fields `loadRacesState` already
computed. And the panel is headed "Next A race", which two of five modes do not
have. **~4–5 days**, of which about a day is pure wiring of existing helpers.

**2 · Race detail (8a).** The pace plan and the elevation profile are ready
(`race-detail-pacing.ts` matches the design 1:1). The taper progress bar has no
composer, the gear plan has no source on this endpoint, the grade footnote exists
for four courses, and the elevation fallback fabricates a shape. **~3 days.**

**3 · Block (6a) — mostly wiring, one real hole.** The 16 week rows, the load
bars, the phase arc and the stats are all reachable. The block-to-date rollup
(miles, sessions, missed, moved) does not exist at all, the workout library has
no endpoint, and the "Change the plan" sheet promises a preview and an undo that
no endpoint provides. **~3 days**, plus the ~2 days for a dry-run replan if that
sheet ships as drawn.

**4 · Today after the run, treadmill (5c).** The "On the belt" card is the only
region on any screen where the backend **writes** the data and then **drops it**
on every read path — and `avg_speed_mph` is null for exactly the runs the card
exists for. Add the client's inability to tell a Strava-synced treadmill run from
an outdoor one. **~2 days**, mostly on the read path and the Swift decode.

**5 · Onboarding (9a).** Two of the five fitness modes have no backend field
("coming back from time off"), one is a near-miss (20-minute pace vs a named
time trial), two stepper ranges exceed the accepted enums, and the distance list
omits `coached`. The step-5 reveal poster must read the real day-one row.
**~2 days.**

**6 · Today before the run (5a).** Individually small, collectively real: the
prescribed effort band does not exist, the week percentage is not on the wire,
today's shoe cannot be read back, the move/skip consequence copy has no producer,
and the niggle picker cannot satisfy `POST /api/niggle`. **~2 days.**

Not in List A but worth stating: **Settings (10a)** is one setting and two
notification toggles away from complete, **Shoes (11a)** is one default away, and
**Live run (12a/12b)** already exists in the app.

---

# LIST B · Engine states with no screen

The direction that bites hardest. 31 states the engine can legitimately enter
that this design does not draw. The six starters are verified and extended.

### The six named in the brief

**1 · A week that cannot carry a quality session.**
`selectWorkout()` (`web-v2/lib/workout-catalogue/select.ts`) returns **five**
refusals, not one: `nothing-placed-here` (`:978`), `no-anchor` (`:991`),
`no-quality-fits` (`:998`), plus `phase` and `not-renderable` from
`selectSlotWorkout()` (`web-v2/lib/plan/catalogue-rx.ts`). The reader for
`CONTINUOUS_TEMPO_MINUTES.min` is `select.ts:611` inside `fits()`, fed from
`catalogue.ts:347`; the copy is at `:1002`. Trigger: Daniels' at-pace weekly
share cap × weekly mileage yields fewer at-pace minutes than the shortest
doctrinal form of everything §15 places in that slot — roughly a 15–22 mi/wk
runner. **The refusal's `detail` sentence and its `rejected[]` list are
discarded** — `generate.ts:3203-3260` falls through to a legacy vocab line and
persists nothing. The runner sees a quality-typed day with no prescription and no
explanation. A screen needs: week volume, slot, phase, reason, the sentence, and
the threshold at which quality becomes available again.

**2 · Amber readiness. Confirmed: renders nowhere, and structurally cannot.**
`gradeConvergence()` (`web-v2/lib/coach/convergence.ts:580`, ladder at `:614-618`)
grades on how many of five domains are dragging. Amber writes one `coach_intents`
row with `reason = 'readiness_convergence_amber'` and mutates nothing
(`web-v2/lib/plan/adapt.ts:3405-3423`). Grepping the whole repo for that string
returns **three hits: the writer, a sibling, and a test.** Zero in
`web-v2/components`, `web-v2/app`, `native-v2`. And it could not render even if
someone tried: `web-v2/app/api/coach/intents/route.ts` `severityOf()` gives it
`'info'`, and the `unacked_only=true` banner filter matches only
`reason LIKE 'plan_adapt_%'` plus a fixed list — **the amber row is excluded from
the banner query entirely.** `readiness_convergence_red_no_quality` (`:3441`) has
the same shape and the same zero consumers.

**3 · Safe vs stretch goal targets. Eight verdicts, zero rendered.**
`web-v2/lib/training/goal-assessment.ts:104` —
`comfortable | realistic | ambitious | aggressive | out-of-reach | open-ended |
date-passed | unreadable`. Computed at `targets/projection/route.ts:627-663`,
shipped as `goalAssessment` at `:804`. Grepping `native-v2` + `web-v2/components`
+ `web-v2/app` for `goalAssessment`, `safeTarget`, `stretchTarget`,
`feasibility`, `reportAgainst`, `weeksToReach` returns **zero hits**. The Swift
`ProjectionSummary` family has no key for it. Unrendered payload includes
`safeTargetSec`, `stretchTargetSec`, `reportAgainstSec`,
**`reportingAgainstSafeTarget`** — the flag saying *we are quietly measuring you
against a different number than the one you set* — `requiredVdot`,
`plausibleVdotRatePerWeek`, `weeksToReach{min,max}`, a composed `statement`,
`cautions[]`, and `basis: 'projected'`, which the module's own docblock says no
surface may render as observed fitness.

**4 · The ultra refusal.**
`planAuthorshipUnsupported()` (`web-v2/lib/plan/supported-distances.ts:60`) with
`ULTRA_UNSUPPORTED_REASON` (`:50`): *"Ultra plans aren't built yet. The race is
on your calendar; training targets stay anchored to your current fitness."*
`POST /api/race` still creates the row and returns `plan_error`. **The runner
ends in a permanent state — an A race on the calendar, a goal saved, no plan,
forever — and it is communicated by a toast** (`TargetsView.swift:1126-1130`)
that they dismiss once. Nothing on Today, Block or Races says why the plan is
missing.

**5 · An open block.** `authorOpenBlock()`
(`web-v2/lib/plan/open-block.ts`) picks **three** modes, not two: `recovery`,
`maintenance`, `goal-build`; outcomes `authored | coached_externally | not_due |
already_pending | generation_failed`. It writes a `plan_proposals` row with
`proposal_kind='open_block'` — and `PLAN_TITLES`
(`web-v2/lib/coach/decision-cards.ts:176-190`) **has no `open_block` key**, so it
falls back to *"Your plan needs an update"* with the verb *"REBUILD THE PLAN"*.
`recordOpenBlock` never sets `newPlanId`, so the success case renders with
`actions: []`. **A runner who wakes the morning after a marathon with a freshly
authored reverse-taper block sees a generic, actionless "your plan needs an
update".**

**6 · Coached, just-run, and goal-mode-without-a-race.** See Collision 4. All
three verified live today.

### Extensions

**7 · The 8-stage walk-run injury ladder.** `WALK_RUN_LADDER`,
`MAX_WALK_RUN_STAGE = 8`, `MAX_STAGE_ADVANCE_PER_WEEK = 1`,
`ALTERNATE_DAY_THROUGH_STAGE = 7`, `INJURY_PLAN_MAX_WEEKS = 12`
(`web-v2/lib/plan/injury-protocols.ts:120-156`). The engine composes the whole
protocol as prose (`injury-builder.ts:493, :509`). What renders: one decision
card, then the plan phase string aliased to `.recovery`. **The stage number, the
pain 0-2/3-5/6+ rule, the alternate-day rule, `CrossTrainMode` (3 values), the
doctrine return band, and three distinct off-day copies all have no view.**

**8 · Sick episode.** `SickTrend = better | same | worse | recovered`. The
route's own docblock flags the hole: *"'worse' → trend logged. (Future · could
escalate to a 'consider clinical input' surface on day 7+.)"* — that surface does
not exist. The three return gates (fever-free 24 h, sleep ≥7 h, RHR within +5 of
baseline) are UI-owned and unmodelled in this design.

**9 · Niggle severity bands.** Four bands (`types.ts:246`), three behaviours
(`adapt.ts:2145-2166`): <5 logged and ignored, 5–6 downgrades the next quality
day, ≥7 suspends running 48 h. **One design screen.**

**10 · The heat gate.** `HeatFlag` (6) × `HeatGateAction` (5) —
`normal | reduce_hard_volume | reduce_intensity | easy_time_on_feet | cancel`
(`web-v2/lib/coach/heat-gate.ts:37,:49`), with WBGT/dewpoint/AQI bail thresholds.
The phone receives **one word**, `heat_band`, on the workout payload
(`API.swift:2785`). **The action, the reading and the "cease outdoor sessions"
verdict have no rendering at all.**

**11 · The progression gate.** `ACCELERATE | TAKE | HOLD | BACK_OFF`
(`web-v2/lib/plan/progression-gate.ts:50`). **Auto-applies overnight** — it is
deliberately not propose-first — and rewrites reps, rep duration and recovery on
one quality session. It surfaces as the generic `"Plan adapted · progression."`.
The runner's session changed while they slept and the app does not say what
changed or why.

**12 · Ten `coach_intents` reasons with no narration.**
`readiness_convergence_amber`, `readiness_convergence_red_no_quality`,
`calibration_completed`, and seven `plan_adapt_*` kinds (`reschedule`,
`downgrade`, `shave`, `mark_dirty`, `recompute_paces`, `upgrade`, `field_test`,
`progression`, `note`) fall to the generic `reason.replace(/_/g,' ')`.

**13 · Calibration mode and the voice band.**
`VoiceBand = calibration | guided | challenge`
(`web-v2/lib/coach/voice-band.ts:48`); `CalibrationStatus = pending | in_progress
| completed | skipped` (`web-v2/lib/coach/calibration.ts:56`) with
`/api/coach/calibration/{start,complete,status}`. The module says it is *"Called
from the 'Start calibration' tap on the Today banner"* — **there is no such
banner in native.** `CALIBRATION_INTRO_WEEKS = 2` and `EFFORT_CUED_TYPES` define
a by-feel, no-pace opening that no screen explains.

**14 · Provisional and stale anchors.**
`AnchorSource = measured_vdot | below_table_anchor | provisional_mileage`
(`web-v2/lib/plan/anchor-provenance.ts:30`). The whole goal + beginner population
runs on a provisional anchor with `goal_realism: {assessable:false}` persisted,
and **no screen says so**. Separately: `STALE_ONSET_DAYS = 7`,
`STALE_FULL_DAYS = 14`, `STALE_FLOOR = 0.5`
(`web-v2/lib/training/goal-projection.ts:401-403`) — **a projection silently
decays by up to half after a fortnight off**, and nothing marks it.
`provisionalResultPatch()` writes `{provisional:true}` on auto-detected race
results and the docblock is explicit that display must never label one as
curated.

**15 · Eight plan-generation refusals.** `loadGeneratorInputs()` in
`generate.ts`: ultra (×2), `'race not found'`, `'race missing date'`,
`'race distance unrecognized'`, **`'target < 2 weeks away; use race-week briefing
only'`** (`:7843`), `'target > 1 year out'`, `'plan needs at least 3 weeks
runway'` (`:7994`), plus `COACHED_SKIP_REASON`. The 2-weeks-away case is a
legitimate, common state — signed up for a race ten days out — and it names a
briefing surface the design does not list.

**16 · Six race-lifecycle handoffs with no title.** `race_graduate`,
`maintenance_to_raceprep`, `plan_elapsed`, `recovery_complete`, `open_block`,
`downgrade_quality`/`volume_shave` all write `plan_proposals` rows that
`PLAN_TITLES` does not cover, so all six render as *"Your plan needs an update"*.

**17 · Goal renegotiation content.** Has a title; the *content* — the revised
target band, the reasons, the "the ambition stays" framing — has no surface.

**18 · Goal-gap statuses and the limiter.**
`closing | static | widening | unclosable` (`web-v2/lib/plan/goal-gap.ts`), plus
`confidence`, `whatClosesIt[]`, and a nullable `limiter`. **When `limiter` is
null the guidance silently degrades to status-only** and the UI cannot tell the
degraded output from the full one. Zero grep hits for `limiter` or
`whatClosesIt` in `native-v2`.

**19 · Standing recommendations.** Five kinds
(`ease_down | shave | reschedule | maintain | push_back`); `workoutActionPhrase()`
phrases four. **`maintain` and `push_back` have no phrasing and no screen.**

**20 · Field test due.** `adapt.ts:2688`. Converts a quality day into a 30-minute
threshold field test that will re-anchor every pace in the plan. Phrased, but
nothing explains what it is or what it will change.

**21 · Fitness regression.** `adapt.ts:2875, :2911`. **The one adaptation that
makes every prescribed pace slower.** Race-sourced regressions auto-apply. It
renders as one line of generic `plan_adapt_recompute_paces` timeline text.

**22–31 · Enums with more cases than the design handles.** Each of these is a
state the engine can be in with no drawn destination:

| enum | file | cases | design covers |
|---|---|---|---|
| `DayState` | `web-v2/lib/faff/types.ts:230` | 12 | `done_ease_off`, `missed`, `skipped`, `sick`, `new_user`, `race_week` unmapped — **and `rest` has no Today composition** |
| `TodayStateKey` | `web-v2/lib/today/composition.ts:84` | 11 | `other-day`, `race-morning`, `post-race`, `recovery`, `race-week`, `taper`, `coached` have no screen |
| `BetweenBlocksReason` | `web-v2/lib/faff/block-state.ts:20` | 3 | one Off-season screen for `recovery`, `block-over`, `no-plan` |
| `AdaptationTriggerKind` | `web-v2/lib/plan/adapt.ts:133-171` | 15 | `readiness_pullback`, `field_test_due`, `heat_bail`, `progression_gate`, `fitness_regression`, `training_gap` have no surface |
| `AdaptationAction['kind']` | `adapt.ts:189` | 9 | 4 phrased |
| `TrainingInfluenceKind` | `web-v2/lib/coach/training-influence.ts:32` | 5 (`on_track, consistent, working, slipping, compromised`) | **0** — and it already ships on `TrainingPlanDay.trainingInfluence` (`API.swift:2122`) |
| `RacePriority` | `types.ts:243` | 5 | 3 — `training_run` and `hilly_excluded` unhandled |
| `AcwrBand` | `types.ts:241` | 4 | `detrain` has no state |
| `CoachLogKind` | `web-v2/lib/coach/coach-log.ts:107` | 8 | 4 |
| `SelectResult.reason` | `select.ts` + `catalogue-rx.ts` | 5 | **0** |
| `OpenBlockOutcome.reason` | `open-block.ts:60-72` | 5 | **0** |
| `HeatGateAction` / `HeatFlag` | `heat-gate.ts:49` / `:37` | 5 / 6 | **0** |
| `GoalFeasibility` | `goal-assessment.ts:104` | 8 | **0** |
| `ProgressionAction` | `progression-gate.ts:50` | 4 | **0** |
| `VoiceBand` / `CalibrationStatus` | `voice-band.ts:48` / `calibration.ts:56` | 3 / 4 | **0** |
| `AnchorSource` | `anchor-provenance.ts:30` | 3 | **0** |
| `CrossTrainMode` | `injury-protocols.ts:67` | 3 | **0** |

---

# PART 4 · Verification

Nothing in the engine changed. This document is the only file added.

| gate | baseline | after |
|---|---|---|
| `npx tsc --noEmit` (web-v2) | exit 0, no output | **exit 0, no output** |
| `bash scripts/check-palette-sync.sh` | `palette-sync OK · iPhone/watch ten-color lock verified` exit 0 | **unchanged, exit 0** |
| `bash scripts/check-doctrine.sh` | `doctrine OK · 222 citations resolve against Research/`, 2 files / 459 tests passed | **unchanged — 222 citations** |
| `npx vitest run lib/ --maxWorkers=4` | 193 files, 0 failures | **193 files passed (193) · 3769 tests passed (3769) · exit 0 · `FIRM failures: 0 across 0 types` / `WARN: 0 across 0 types`** |

**Note on the vitest baseline.** A worktree does not carry `node_modules` or
`.env.local`. Both were symlinked from the root checkout so the suite could run
at all — `web-v2/node_modules` and `web-v2/.env.local` are gitignored symlinks
and are not part of this commit. Without `.env.local` the suite reports **6
failures in 2 files** (`lib/plan/_wave1_smoke_dryrun.test.ts`,
`lib/plan/_open_block_authoring.test.ts`) purely because `DATABASE_URL` is
undefined — the exact failure mode `web-v2/vitest.setup.ts`'s header was written
about. With the symlink in place those tests reach the database and the suite
runs clean, as recorded above. No test file, fixture or engine source was
touched.

---

# The three things to tell whoever opens the build session tomorrow

**1 · Read `web-v2/components/redesign/` before writing a line of Swift.**
This is not a new design system — it is the dark theme of the one already
shipped on web at `/redesign/*`, sharing six byte-identical state hexes. Three
of the fourteen screens already have working TypeScript implementations
(`block/BlockClient.tsx`, `season/SeasonClient.tsx`,
`races/RaceDetailClient.tsx`) that have already solved most of the "the backend
does not serve this, derive it client-side" problems you are about to hit. About
a third of List A is wiring helpers that exist and are tested — `resolveRaceRole`,
`resolveGoalStatus`, `phaseFocus`, `weekIntensity`, `workoutLibraryStats`,
`race-detail-pacing` — to routes that do not yet return them. Do that first; it
is the cheapest third of the work and it de-risks the rest.

**2 · The design has no way to say "this number is modelled", and it needs one
before any of it ships.** Not as a caveat bolted on at the end — as a token-level
affordance decided on day one, because it recurs on nine surfaces. The palette
already reserves the slot: attention amber `#F2B03C`, spec'd as "outside its
target range, **stale data**, a decision waiting". The concrete cases are in Part
3: the Projected number that *is* the goal until drift fires; the trend beneath
it computed from a different model; the HR ceiling that may be an `HRmax × 0.92`
crosswalk with the flag already on the wire and unread; the elevation profile
that fabricates a zigzag when there is no GPX; every pace shown to a beginner
running off a provisional anchor. The engine already knows which is which and
says so in its payloads. The design currently throws that away, and the owner's
one locked rule is the one it throws away.

**3 · Two of the four collisions are owner decisions, not engineering, and
nothing ships until they are answered — raise them on day one, not in week two.**
The palette gate (Collision 1) fails **all sixteen** live `Theme.swift`
assertions plus three retired hexes the moment that file changes, and it gates
both the Railway deploy *and* `ship-testflight-v2.sh` — so a red gate means no
web deploy and no TestFlight build. On top of that the design's primary accent is
orange, which a locked 2026-06-18 ruling banned app-wide in as many words, and
Instrument Sans and Archivo are not in the app bundle at all. **Do not comment
out an assertion to get a green build.** Second: the design covers one of five
verified onboarding modes — coached, just-run and goal-mode-without-a-race have
no drawn destination on any of the three tabs, and the design's own onboarding
cannot even select `coached`.

The other two collisions turned out smaller than the brief assumed and should
just be done. "Start runs from this phone" is **half a day** — `PhoneRunView`,
`TreadmillView` and a two-choice `RunActionMenu` are all shipped and `'phone'`
is already a whitelisted completion source; only the setting and the tab-bar
gate are missing. Shoe retirement is **~1 day** — `mileage_cap` already exists
and `pctUsed` is already served; what is missing is a model type and one
authoritative default replacing the 350/400/450 spread across five files, plus a
research question about the numbers that engineering should not answer alone.

**One thing that is neither a collision nor a gap, and will bite in week one if
nobody is told:** the design's calendar sheet cannot be built on
`TrainingPlanDay` as it stands. `/api/training/state` does not collapse to one
row per date, and `API.swift:2133` sets `var id: String { date }` while omitting
the server's unique `id` from `CodingKeys` — so a double-booked date produces
duplicate SwiftUI `Identifiable` ids. It is a filed, half-fixed finding
(`docs/PHONE-WATCH-AUDIT-2026-07-06.md:163`). Decode the server's `id` before
building that screen, not after.
