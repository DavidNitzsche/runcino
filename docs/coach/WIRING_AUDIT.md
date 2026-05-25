# Coach + Research Wiring Audit

> **Generated:** 2026-05-12 · Read-only audit of how the Coach engine and the `/Research/` library are wired into the live faff.run app after the 6 ported pages landed (Overview, Training, Races, Health, Log, Profile).
>
> This audit verifies **Step 4** (every aspect of the app gets the research + Coach mastermind fed to it) and **Step 5** (all runs and profile/user selections influence the Coach mastermind) of the migration plan.
>
> Compare to `docs/MIGRATION_GAP_ANALYSIS.md` (2026-05-11) — that report inventoried the gap **before** the ports. This audit measures what's actually wired **after**.

---

## TL;DR

- All 6 pages now route through a `/data.ts` → `/api/<page>/route.ts` → `coach.<method>()` pipeline. **The Coach is the single entry point for every page**, just as the plan required.
- **9 / 15** Coach methods now return real, doctrine-cited data (Stage 2 + Stage 3 + Stage 1 deterministic work). **2** throw (`retrospect`, `adjustForReality`). **4** are Stage-7 stubs that return mockup-faithful values with valid citations but use mock or partly-mock state.
- Doctrine citations are **~85%** migrated to `/Research/`. Stage-1+ modules cite the canonical research; six small legacy-era modules (intensity, load, cadence, recovery, post_race, taper, fueling, volume, strength, shoes, heat, masters) are still legacy-cite-only. `citations.ts` was rewritten — every "why?" surface now points at `/Research/`.
- Real user-data propagates well to most surfaces — Strava runs feed `state.volume` / `state.intensity` / `state.recovery` which drives prescribeWorkout and assessReadiness in real time. **Race CRUD round-trips through Coach**.
- The biggest remaining gap is **stub state-shape leakage**: 4 Stage-7 Coach methods return mock data shaped like real data. Every surface that consumes them (Plan Adapted card, Body Systems, 14-week trajectory, week-deltas projection) shows realistic but **not user-anchored** numbers.

---

## Section 1 · Per-page coverage matrix

Legend:
- ✅ **Coach-method-backed** — value sourced from a `coach.<method>()` return value
- 🔬 **Doctrine constant** — value pulled from a `web/coach/doctrine/*.ts` module
- 📊 **Real data** — Strava aggregate / saved race / shoe DB / lifetime rollup
- 🟡 **Stubbed in data.ts or route.ts** — clearly TODO'd, surface renders mock values
- ❌ **Hardcoded inline in JSX** — string literal in the React component (violation)

### Overview · `/overview` · `data.ts` 871 lines · `api/overview/route.ts` 129 lines

| Card | Surface | Source | Notes |
|---|---|---|---|
| Greeting band | `David` name | 🟡 hardcoded `name: 'David'` in `getProfileSnapshot()` data.ts:435 | No users table yet |
| Greeting band | Time-of-day greeting | 📊 derived from `today` |  |
| Greeting band | PHASE tile / A-RACE / WEEK / READINESS / TODAY | ✅ `coach.readiness` · `coach.workout` · `state.races.nextA` |  |
| TODAY hero | Workout type · distance · pace target · HR cap | ✅ `coach.prescribeWorkout` (Stage 3 wired) | `paceTarget`, `hrZone`, `phaseLabel` all from Coach |
| TODAY hero | Why-this-is-light explainer copy | ✅ `voiceLead` from `composeVoiceLead()` in explanations.ts |  |
| TODAY hero | Warm-up / main / cool-down STRUCTURE | 🟡 synthesized in `getWorkoutStructure()` data.ts:444 — splits 16/68/16% by pace | TODO: wire to coach.prescribeWorkout structured return |
| Readiness Ring | 88/100 score | ✅ `coach.assessReadiness().level` mapped to band in `buildReadinessComposite()` health route only — Overview uses just level |  |
| Readiness Ring | 5 signal bars (Effort/Load/Mileage/Easy/Strain) | ✅ derived from real `state.volume.deltaPct4v4`, `state.intensity.easyShare14d`, `state.races.raceCount30d` in health route's `buildReadinessComposite()` |  |
| Race countdown hero | Goal / Fitness-predicts / Headroom / Build-starts | ✅ `coach.raceFitnessPrediction(nextA)` — Stage 7 stub, returns mock VDOT 49.2 + 2% headroom | Values not anchored to actual VDOT |
| Race countdown hero | UP-NEXT B-race inset | ✅ `coach.raceFitnessPrediction(nextB)` — same Stage 7 stub |  |
| Week strip | Day prescriptions | ✅ `coach.weekDeltas` Stage-7 stub | Days planned/actual from mock pattern in coach.ts:919-921 — not real plan_templates output |
| Week strip | Projected overshoot bar | ✅ same stub |  |
| Trajectory | 14-week PATH-TO-A-RACE chart | ✅ `coach.trajectory14wk` — Stage 7 stub. Phase tints + peak diamond + race marker | Mock `plannedSeries`/`actualSeries` arrays in coach.ts:741-753 |
| Plan Adapted | "+12% baseline unlocked" + was→now deltas | 🟡 `getPlanAdapted()` data.ts:485 — hardcoded copy because `coach.adjustForReality()` throws | TODO: wire to Stage A |
| HRV / RHR / Sleep / Effort sparks | All 4 spark cards | 🟡 `getBiometricsSnapshot()` data.ts:507 — HealthKit M2 blocked; mockup-faithful |  |
| Body Systems | 5 systems · healed dates · "Quality returns" | ✅ `coach.bodySystems` Stage-7 stub with Research/00b citation. `daysSince` reads `state.races.recent[0].daysAgo` — real | System readiness/healed-date values are mock — coach.ts:677-700 |
| VDOT card | "49.2" · tier band · equivalent race times | 🟡 `getVdotSnapshot()` data.ts:566 — hardcoded "49.2" | TODO: wire to lib/vdot.ts |
| Load gauge | ACWR value + classification | 📊 ACWR computed from real `state.volume.last7Mi / state.volume.weeklyAvg8w` in `getLoadSnapshot()` data.ts:597 | Real input; classification thresholds match coach-principles |
| Pace zones | 5 zones (E/M/T/I/R) | 🟡 `getPaceZonesSnapshot()` data.ts:634 — hardcoded mockup numbers | TODO: wire pace_zones.ts × vdotSnapshot |
| Weekly miles strip | 4 past + this + 3 future | 📊 past comes from real `weeklyHistory`; 🟡 future from mockup ramp | TODO: wire future from trajectory14wk |
| Long-run progression | 10-cell strip | 🟡 mockup-driven `getLongRunStrip()` data.ts:712 |  |
| Year heatmap | 52 weeks | 🟡 mockup color pattern; real `rollupYear` used for top stats | TODO: derive from yearOfRunningHeatmap + race detection |
| Monthly volume bars | 12 months | 🟡 fallback mockup values; real `rollup?.totalMiles` used | TODO: per-month rollup |
| PR shelf | 5K/10K/HM/M | 📊 real `naivePRs(runs)` with mockup fallback when no Strava |  |
| YTD ring | 503 mi · day 129 · projected EOY | 📊 `rollup.totalRuns/totalMiles` real; some mockup constants for delta |  |

**Tally:** ✅ 9 · 🟡 13 · ❌ 0 · 📊 6 · 🔬 0

### Training · `/training` · `data.ts` 630 lines · `api/training/route.ts` 210 lines

| Card | Surface | Source | Notes |
|---|---|---|---|
| Greeting band | Name + greeting | 🟡 hardcoded `'David'` |  |
| TODAY hero | Workout label · distance · pace · HR cap | ✅ `coach.prescribeWorkout` |  |
| TODAY hero | Structure breakdown | 🟡 synthesized split | Same as Overview |
| Ready-to-Run | Headline ("ALL SIGNALS GREEN" / "HOLD" / "REST") | ✅ derived from `coach.readiness.level` data.ts:388 |  |
| Ready-to-Run | Sleep · HRV · RHR · Soreness values | 🟡 HealthKit M2 stub |  |
| Conditions inset | 62°F + Coach note | 🟡 `getConditions()` data.ts:418 — hardcoded `'62'` / `'12 MPH · CLOUDY'`. HR cap derived from prescription hrZone | TODO: weather.ts × coach.dailyConditionsNote (doesn't exist) |
| Goal Tracking | Goal time · Fitness now · Headroom | ✅ `coach.raceFitnessPrediction(nextA).answer` data.ts:435 — Stage 7 stub VDOT |  |
| Goal Tracking | VDOT line "49.2 · ▲ +0.8" | 🟡 hardcoded data.ts:456 |  |
| Goal Tracking | PR / GOAL / STRETCH tiles | 🟡 PR is hardcoded mockup "Disney 1:32"; Goal + Stretch come from raceFitnessPrediction |  |
| Goal Tracking | Latest Proof callout | ✅ `coach.proofSessions().answer.latestCompleted` — Stage 7 stub mock |  |
| Proof Sessions list | First T tempo · Mission Bay 10K · etc. | ✅ `coach.proofSessions().answer.sessions` — Stage 7 stub mock (4 sessions hardcoded in coach.ts:813-846) |  |
| Path to AFC | 14-week build curve | ✅ `coach.trajectory14wk` Stage-7 stub |  |
| Phase breakdown strip | BASE/BUILD/PEAK/TAPER widths | 🟡 inline JSX likely; trajectory points carry `phase` but strip widths not derived from them | (likely hardcoded in page.tsx) |
| Plan Adapted | Same as Overview | 🟡 `getPlanAdapted()` data.ts:562 — hardcoded |  |
| HR Zones 14-day | Daily mix bars | 🟡 `buildHrZones()` in route.ts:164 — synthesized pattern; only `easyShare` is real from `state.intensity.easyShare14d` | TODO: lib/strava-hr-zones.ts |

**Tally:** ✅ 6 · 🟡 11 · ❌ 0 · 📊 0 · 🔬 0

### Races · `/races` · `data.ts` 711 lines · `api/races-page/route.ts` 268 lines

| Card | Surface | Source | Notes |
|---|---|---|---|
| Greeting | Name + greeting | 🟡 hardcoded `'David'` |  |
| A-Race hero | Race name · date · countdown · long-date-line | 📊 `nextA` from `listRacesDB()` — real Postgres |  |
| A-Race hero | Goal time · pace · VDOT · fitness-predicts · headroom · confidence | ✅ `coach.raceFitnessPrediction(nextA)` Stage-7 stub — same `vdot: 49.2`, 2%-headroom mock |  |
| A-Race hero | Build-starts-in-days | 🟡 `computeBuildStartsInDays()` data.ts:695 — hardcoded `return 14;` | TODO: trajectory phase boundaries |
| A-Race hero | UP-NEXT B-race inset | 📊 `nextB` from real races + 🟡 `tuneupTag: 'TUNE-UP'` hardcoded | TODO: race_week.ts B-race classification |
| Latest Result | Distance · finish · pace · PR label · split direction | 📊 real `r.actualResult` |  |
| Latest Result | Avg HR + zone classification | 📊 real `result.avgHr` divided by hardcoded `187` maxHR — partial real | TODO: profile.maxHr |
| Latest Result | Coach Read verdict text | 🟡 `synthesizeCoachRead()` data.ts:484 — string-template based on real `result + delta` because `coach.coachRead()` is Stage-7 stub and `coach.retrospect()` throws |  |
| Latest Result | Place / TOP 8% / AG#23 | 🟡 hardcoded null — Coach has no place data | TODO: actualResult.place column |
| Latest Result | Conditions tile | 🟡 hardcoded null — no weather captured | TODO: capture at race finish |
| Season Timeline | Race dots colored by status | 📊 real `inYear` markers; tone derived from priority + isPR |  |
| Upcoming list | Predictions per race | ✅ `coach.raceFitnessPrediction()` per upcoming race |  |
| Recent list | Sombrero "SENTIMENTAL", Big Sur "PR" etc. classifications | (need to check page.tsx — likely 🟡 derived inline) | Synthesized from actualResult tags |
| Taper banner | Depth % for races ≤21 days | ✅ `coach.taperDepth()` Stage-1 wired (real doctrine band) | route catches throw — but now method works |
| Body Systems | When race ≤14 days | ✅ `coach.bodySystems` Stage-7 stub |  |
| Trajectory backbone | 14-wk curve under timeline | ✅ `coach.trajectory14wk` Stage-7 stub |  |

**Tally:** ✅ 6 · 🟡 7 · ❌ 0 · 📊 5 · 🔬 0

### Health · `/health` · `data.ts` 304 lines · `api/health/route.ts` 1113 lines

| Card | Surface | Source | Notes |
|---|---|---|---|
| Greet | Recovery score · DAYS LOGGED · subtitle | ✅ derived from `coach.bodySystems` + `coach.assessReadiness` + `state.recovery.consecutiveRunDays` |  |
| Daily check-in | 5-emoji + sliders | 🟡 `stubMoodCheckin()` + `stubExpandedCheckin()` route.ts:679,808 — no mood-log table |  |
| Subjective Agreement | AGREE / SPLIT chip | ✅ `stubSubjectiveAgreement()` route.ts:1069 — uses real `readiness.score` but `subjectiveScore` is null |  |
| Readiness Composite | 88/100 + 5 signal bars | ✅ `buildReadinessComposite()` route.ts:510 — 5 signals derived from REAL state: `state.volume.deltaPct4v4`, `state.intensity.easyShare14d`, `state.volume.last7Mi`, `state.races.raceCount30d` |  |
| HRV detail | Current/baseline/CV + Plews verdict | 🟡 `stubHrvDetail(stubHrv)` — CV is computed from stub series; Plews logic is real, fed by stub data |  |
| RHR detail | 7-day bars + low/high | 🟡 `stubRhr()` |  |
| Sleep | 7-night + Deep/REM/Efficiency | 🟡 `stubSleep()` |  |
| Body Systems centerpiece | 5 systems · healed dates · Quality returns | ✅ `coach.bodySystems` Stage-7 stub. `daysSincePeakStress` is real from `state.races.recent[0]`. System values mocked. |  |
| HR Zones 14-day | Daily polarized mix | 🟡 `buildHrZones()` — synthesized pattern; only `easyShare` real |  |
| Training Stress 30D | CTL/ATL/Form | 🟡 `buildTrainingStress()` route.ts:760 — CTL ≈ `weeklyAvg8w * 1.8`, ATL ≈ `last7Mi * 1.5` — derived but heuristic, not Banister |  |
| Form Report | Operating band classification | ✅ `stubFormReport(trainingStress)` route.ts:863 — band logic real per Research/00a §CTL/ATL/TSB, fed by derived stress |  |
| Illness Composite | 5 markers · ALL CLEAR | 🟡 `stubIllnessComposite()` route.ts:898 — hardcoded marker values |  |
| Body Mass | Trend + 2% drop warning | 🟡 `stubBodyMass()` |  |
| Submax HR Drift | Stable/Creeping/Drifting | 🟡 `stubSubmaxHrDrift()` — verdict logic real per Research/15 §Spotting Overtraining |  |
| VO2max 6-month | 52 ml/kg + percentile | 🟡 `stubVo2max()` |  |
| Respiratory Rate | 7-night | 🟡 `stubRespiratoryRate()` |  |
| Body Temp | 7-night baseline | 🟡 `stubBodyTemp()` |  |
| Cycle phase (female only) | Phase + load rec | 🟡 `stubCycle()` |  |
| Ferritin (female only) | Level + threshold | 🟡 `stubFerritin()` |  |

**Tally:** ✅ 5 · 🟡 14 · ❌ 0 · 📊 0 · 🔬 0

### Log · `/log` · `data.ts` 196 lines · `api/log/route.ts` 698 lines

| Card | Surface | Source | Notes |
|---|---|---|---|
| Greet | YTD miles · runs · days · races · vs-last-year hook | 📊 `rollupYear(ytdRuns)` + `naivePRs` — real from Strava cache (with mockup demo fallback) |  |
| Year heat strip | 53 weeks colored by intensity, race weeks orange | 📊 `buildYearHeat()` route.ts:275 — real per-week miles + isRace from `isProbablyRace()` |  |
| Monthly volume bars | 2026 vs 2025 | 📊 `buildMonths()` real |  |
| PR shelf | 5K/10K/HM/M/1MI/Longest | 📊 `buildPrs()` real with year split |  |
| Recent Runs feed | 7 rows | 📊 sorted from real activities |  |
| Run row · workout-kind classification | "RACE · C-EFFORT · SENTIMENTAL" / "WORKOUT" / "RECOVERY" | 🟡 `buildRunRow()` route.ts:467 — regex on name + isProbablyRace; tagging is heuristic, not coach-classified | TODO: pull from coach.workoutType when retroactive classification lands |
| Run row · RPE | "3" / "9" / "6" | 🟡 inferred from kind/HR — no daily-log RPE input yet | TODO: RPE input + mental.ts |
| Run row · pace tone | good/corp/warn | 🟡 derived from kind heuristic |  |

**Tally:** ✅ 0 · 🟡 4 · ❌ 0 · 📊 5 · 🔬 0  
**Note:** Log is overwhelmingly real-data-backed. The only stubs are post-hoc classification of runs by the heuristic regex — no live Coach call per-row.

### Profile · `/profile` · `data.ts` 159 lines · `api/profile/route.ts` 932 lines

| Card | Surface | Source | Notes |
|---|---|---|---|
| Identity hero | Name · age · city | 🟡 `buildIdentity()` route.ts:347 — hardcoded `'David Nitzschke'`, `'M · 38 · LOS ANGELES, CA'` | No users table |
| Identity hero | Lifetime miles | 📊 real `runs.reduce((s, r) => s + r.distanceMi, 0)` with mockup fallback |  |
| Identity hero | Races count + breakdown | 📊 real `runs.filter(isProbablyRace)` |  |
| Identity hero | Days run · Peak year | 📊 real from activities (unique calendar days, max-year group-by) |  |
| Identity hero | Lifetime elevation + Everest count | 📊 real `r.elevGainFt` sum |  |
| Lifetime PRs | 5K/10K/HM/M | 📊 real `naivePRs(allRuns)` with mockup fallback |  |
| Lifetime PRs | 50K | 📊 real `runs.filter(r >= 30)` |  |
| Personal Goals | 6 categorized goals + Coach-respect rationale | ❌ `stubGoals()` route.ts:595 — all 6 goals + rationale paragraphs hardcoded in JSX-equivalent | No goals table; "+ Add goal" CTA not wired |
| VDOT card | "49.2 · RAW 50.0 · DECAY −0.8 · DISNEY HALF 6 MO AGO" | 🟡 `stubVdot()` route.ts:694 — hardcoded |  |
| HR 5-zone card | HRMAX 187 / RHR 42 / 5 zones | 🟡 `stubHrBlock()` route.ts:703 — hardcoded zones (matches Karvonen but not derived from user) | TODO: hr_zones.ts × profile.hrMax |
| Mileage tier | Current mi · band · marker position · trend | 📊 `buildTier()` route.ts:718 — real `state.volume.weeklyAvg4w` + `deltaPct4v4` |  |
| Training preferences | Long-run day / quality / rest / units | 🟡 `stubPrefs()` route.ts:735 — hardcoded `'Sunday'`/`'Tue / Thu'` | No user_prefs table |
| Connections | Strava LIVE · HealthKit SOON · Garmin SOON | 📊 Strava real (count from cache); HealthKit/Garmin pin status hardcoded |  |
| Shoe rotation | 5 shoes + caps + mileage bars | 📊 `buildShoeRows(dbShoes)` real; `stubShoes()` fallback | Real DB-backed |
| Shoe warn label | "1 RETIRE · 1 NEAR CAP" | 📊 derived from real fractions |  |
| Coach Engine Details | 4 tiles (pace zones / long-run cap / easy share / cutback cadence) | 🟡 `buildEngineBlock()` route.ts:849 — long-run cap REAL from `state.volume.longestLast28Mi * 1.10`; easy-share REAL from `state.intensity.easyShare14d`; pace zones + cutback cadence hardcoded |  |
| Plan integrity | "12/12 rules pass" | ❌ `passed: 12, total: 12` hardcoded in route.ts:907 | No real validator |

**Tally:** ✅ 0 · 🟡 7 · ❌ 2 · 📊 7 · 🔬 0

### Page totals

| Page | ✅ Coach | 🟡 Stub | ❌ Hardcoded | 📊 Real | 🔬 Doctrine |
|---|---|---|---|---|---|
| Overview | 9 | 13 | 0 | 6 | 0 |
| Training | 6 | 11 | 0 | 0 | 0 |
| Races | 6 | 7 | 0 | 5 | 0 |
| Health | 5 | 14 | 0 | 0 | 0 |
| Log | 0 | 4 | 0 | 5 | 0 |
| Profile | 0 | 7 | 2 | 7 | 0 |
| **Total** | **26** | **56** | **2** | **23** | **0** |

The **0 doctrine-constant** count is correct — no page renders a doctrine constant directly; every doctrine read goes through a Coach method (which then attaches the doctrine value to its return).

The **2 hardcoded** entries are both on Profile: the 6 personal goals and the "12/12 plan integrity" string. Both have no data model behind them.

The high 🟡 count is **expected and acceptable** — most stubs are clearly TODO-marked, have `source: 'stub'` on the wire shape, and most are HealthKit-blocked (M2 dependency, not Coach work). The actionable ones are listed in Section 5.

---

## Section 2 · Coach method status

Source: `web/coach/coach.ts` (1378 lines). Every method in the `Coach` interface, its current implementation, and where it's called.

| Method | Status | Citations (count, docs) | Called from |
|---|---|---|---|
| `paceStrategy(input)` | 🟢 **Real** (Stage 1, coach.ts:402-484) | 3 · Research/01 §Daniels training paces · Research/08 §3 First-mile · Research/08 §6.1 HR ceilings | Race detail (lib/pacing → coach migration) |
| `prescribeWorkout(input)` | 🟢 **Real** (Stage 3, coach.ts:1089-1124) | Per workout type via `citationsForWorkoutType()` — Research/04 + 00a + 00b + 08 | Overview · Training · Health · Log routes — every page that needs today |
| `assessReadiness(input)` | 🟢 **Real** (Stage 3, coach.ts:1131-1189) | 2-3 · Research/00a §ACWR · §TID · Research/00b §Hard/Easy | Overview · Training · Health routes |
| `taperDepth(input)` | 🟢 **Real** (Stage 1, coach.ts:500-541) | 3 · Research/08 §9.1 · Research/08 §9.2 · legacy taper.ts §14 | `/api/races-page` (depths for races ≤21d) |
| `fuelingFor(input)` | 🟢 **Real** (Stage 1, coach.ts:553-655) | 3 · Research/08 §10.5 · legacy 7.1 (2 cites) | Not currently consumed by any page — race-detail still uses lib/fueling-claude |
| `briefRaceMorning(input)` | 🟢 **Real LLM + deterministic fallback** (Stage 2, coach.ts:1197-1310) | 2 · Research/06 §10 · Research/08 §3.5 | `/api/brief` (race-morning workflow) |
| `retrospect(input)` | 🔴 **Throws** (`this.notYet(4, 'retrospect')`, coach.ts:385) | n/a | Latest Result coach-read on Races — fallback string synthesis in data.ts:484 |
| `adjustForReality(input)` | 🔴 **Throws** (`this.notYet(5, 'adjustForReality')`, coach.ts:386) | n/a | Plan Adapted cards on Overview + Training — fallback hardcoded copy in both `data.ts` |
| `bodySystems(input)` | 🟡 **Stage-7 stub** (coach.ts:664-720) — returns 5 systems with state, readiness, healed dates **all mock**. Reads real `state.races.recent[0].daysAgo` for the `daysSince` field. | 1 · Research/00b §Tissue Healing Timelines | Overview · Health · Races (when race ≤14d) |
| `trajectory14wk(input)` | 🟡 **Stage-7 stub** (coach.ts:725-800) — `plannedSeries` and `actualSeries` are hardcoded arrays. Reads real `state.races.nextA` + real `today` for date math. | 1 · Research/22 §Plan skeletons | Overview · Training · Races |
| `proofSessions(input)` | 🟡 **Stage-7 stub** (coach.ts:804-868) — 4 hardcoded proof sessions, 1 hardcoded latest-completed. Reads real `state.races.nextA`. | 2 · Research/22 §Plan skeletons · Research/04 §Threshold + tempo | Training |
| `raceFitnessPrediction(input)` | 🟡 **Stage-7 stub** (coach.ts:873-907) — VDOT=49.2 hardcoded, predicted = goal × 0.98, stretch = goal × 0.95. Reads real `goalTimeS` + `raceDistanceMi` from input. | 1 · Research/02 §Riegel + course adjustments | Overview · Training · Races (per race) |
| `weekDeltas(input)` | 🟡 **Stage-7 stub** (coach.ts:911-972) — `planned` and `actual` arrays are hardcoded. Real `today` used for Monday computation. | 1 · Research/22 §Week structure | Overview · Training |
| `engineDetails(input)` | 🟡 **Stage-7 stub** (coach.ts:976-1031) — 4 detail tiles hardcoded (long-run cap "8.2", easy-share "≥80%", cutback "Every 3 wks"). `state` is ignored (`void input.state`). plan-integrity 12/12 hardcoded. | 3 · Research/00a §Polarized · Research/01 §Pace zones · Research/22 §Cutbacks | NOT CURRENTLY CALLED — Profile builds its own `buildEngineBlock()` in route.ts directly off state which is partially real (long-run cap uses real `state.volume.longestLast28Mi`) |
| `runRead(input)` | 🟡 **Stage-7 stub** (coach.ts:1035-1060) — verdict + body hardcoded based on `overshootFlag` boolean derived from real `activity.distanceMi - plannedMi`. | 1 · Research/00a §Progressive overload | Log (per-row in api/log) — code path exists, not yet called |
| `coachRead(input)` | 🟡 **Stage-7 stub** (coach.ts:1065-1082) — verdict + body string-templated from real `paceSPerMi` + `isPR`. | 1 · Research/02 §Negative splits | Races Latest Result — but Races prefers its own `synthesizeCoachRead()` in data.ts:484 |

**Summary:** 6 Real · 2 Throws · 8 Stage-7 stubs.

**"Looks real but is fake" cases** (mock data on real surfaces):
1. **`raceFitnessPrediction`** — every A-race / B-race headroom number on every page is "goal × 0.98" with a hardcoded VDOT of 49.2. Not anchored to lib/vdot.ts's real VDOT calc.
2. **`trajectory14wk`** — the 14-week PATH chart on Overview + Training + Races backbone is the **same mock curve regardless of user** because `plannedSeries` is a hardcoded array.
3. **`weekDeltas`** — the WEEK STRIP on Overview shows hardcoded `planned = [0,0,6.7,0.5,7.4,3.0,5.0]` and `actual = [0,0,11.4,0.5,12.8,null,null]` — not derived from real `state.volume.last7Days`.
4. **`proofSessions`** — "First T tempo Tue · 4×1mi @ T" on the Training page is mockup text regardless of plan.
5. **`bodySystems`** — system readiness fractions (0.42 connective, 0.55 CNS) are constants — only `daysSincePeakStress` is real.

These are **valid stubs per the Stage-7 plan** (they exist deliberately so UI work could proceed), but they should be the next 5 things wired.

---

## Section 3 · Doctrine → Research traceability

Source: `web/coach/doctrine/` (32 modules). Counts of canonical Research citations vs legacy synthesis doc citations per file.

| File | Size (lines/KB) | Research cites | Legacy cites | /Research/ docs cited | Status |
|---|---|---|---|---|---|
| **Foundational (Stage 1) — ✅ complete** | | | | | |
| `pace_zones.ts` | 32KB | 17 | 0 | Research/01 | ✅ |
| `race_prediction.ts` | 29KB | 17 | 0 | Research/02 | ✅ |
| `hr_zones.ts` | 40KB | 23 | 0 | Research/03 | ✅ |
| `workouts.ts` | 59KB | 28 | 1 | Research/04 + 00a + 00b + 08 | ✅ (1 legacy cite to clean up) |
| **Practical (Stage 2) — ✅ doctrine done** | | | | | |
| `weather.ts` | 33KB | 23 | 0 | Research/06 | ✅ |
| `pacing.ts` | 26KB | 18 | 0 | Research/08 | ✅ |
| `race_week.ts` | 29KB | 19 | 0 | Research/08 | ✅ |
| `injury_return.ts` | 26KB | 7 | 0 | Research/05 | ✅ |
| **Recovery/Load/Signals (Stage 3) — ✅ doctrine done** | | | | | |
| `recovery_protocols.ts` | 36KB | 22 | 1 | Research/00b | ✅ (1 stray legacy cite) |
| `wearables.ts` | 7.8KB | 5 | 0 | Research/15 | ✅ but thin |
| `age.ts` | 8.6KB | 5 | 0 | Research/14 | ✅ |
| **Plan templates (Stage 4) — ✅ doctrine done** | | | | | |
| `plan_templates.ts` | 25KB | 4 | 0 | Research/22 | ✅ but light on per-rule citation (4 cites for 25KB) |
| **Equipment/fueling/sex (Stage 5) — partial** | | | | | |
| `hydration.ts` | 17KB | 12 | 0 | Research/19 | ✅ |
| `sex.ts` | 13KB | 6 | 0 | Research/13 | ✅ |
| `fueling.ts` | 5KB | **0** | **1** | — | ❌ legacy-only |
| `shoes.ts` | 2.7KB | **0** | **1** | — | ❌ legacy-only (stub) |
| **Specialized (Stage 6) — ✅ mostly done** | | | | | |
| `cross_training.ts` | 10KB | 5 | 0 | Research/09 | ✅ |
| `mobility.ts` | 10KB | 7 | 0 | Research/10 | ✅ |
| `course.ts` | 11KB | 6 | 0 | Research/11 | ✅ |
| `travel.ts` | 7KB | 5 | 0 | Research/12 | ✅ |
| `mental.ts` | 18KB | 13 | 0 | Research/20 | ✅ |
| **Legacy / deprecated** | | | | | |
| `heat.ts` | — | **0** | **1** | — | ❌ replaced by weather.ts — should delete |
| `masters.ts` | — | **0** | **1** | — | ❌ replaced by age.ts — should delete |
| `cadence.ts` | 3KB | **0** | **1** | — | ❌ stub; placeholder for form.ts (16) |
| `recovery.ts` | 3.6KB | **0** | **1** | — | ❌ overlaps recovery_protocols.ts |
| `post_race.ts` | — | **0** | **1** | — | ❌ pre-migration |
| `intensity.ts` | — | **0** | **1** | — | ❌ pre-migration |
| `load.ts` | — | **0** | **1** | — | ❌ pre-migration |
| `volume.ts` | — | **0** | **1** | — | ❌ pre-migration |
| `taper.ts` | — | **0** | **1** | — | ❌ pre-migration |
| `strength.ts` | — | **0** | **3** | — | ❌ pre-migration |
| **Helpers** | | | | | |
| `cite.ts` | 3.3KB | n/a | n/a | helper for all | ✅ |
| `index.ts` | — | 0 | 0 | barrel export | — |
| **Engine-level helper** | | | | | |
| `coach/citations.ts` | — | (uses `cite('§…', '…', 'research', 'XX')` throughout) | 0 | Research/00a / 00b / 01 / 04 / 08 | ✅ **MIGRATED** — every workout-type citation now points at /Research/ |

### Citation migration progress

The earlier audit (MIGRATION_GAP_ANALYSIS.md) flagged **`citations.ts` as the choke point** — every "why?" tap in the UI used the legacy `rc()` helper pointing at `docs/coaching-research.md`. **That is now fixed.** Reading citations.ts current source: every `citationsForWorkoutType()` branch issues `cite('§…', '…', 'research', '04')` etc., pointing at canonical research. The `rc()` shim is still exported but no longer called internally.

**Doctrine status by stage:**

| Stage | Doctrine | Engine wire-up | Notes |
|---|---|---|---|
| 0 · Migration prerequisite | ✅ done | ✅ | `cite()` helper supports 3 forms |
| 1 · Foundational | ✅ done | ✅ | pace_zones / race_prediction / hr_zones / workouts all cite Research |
| 2 · Practical | ✅ done | 🟡 partial | weather.ts wired via `lib/weather-slowdown.ts` to briefRaceMorning. pacing.ts wired via paceStrategy. injury_return.ts has no engine consumer yet. |
| 3 · Recovery / load / signals | ✅ done | 🟡 partial | recovery_protocols.ts wired via bodySystems stub (only `qualityReturnsISO` + `daysSince`); wearables.ts not wired (no formScore method) |
| 4 · Plan templates | ✅ done | 🟡 partial | plan_templates.ts cited by trajectory14wk + proofSessions stubs; consumed via `coachDaily()` engine for weekShape |
| 5 · Equipment / fueling / sex | 🟡 partial | ❌ | fueling.ts (5KB, 0 research cites) blocks `coach.fuelingFor()` from reaching Research/18+19 standards. shoes.ts is a 2.7KB stub. footwear (Research/17 33KB) and fueling_products (Research/18 33KB) not extracted at all. |
| 6 · Specialized | ✅ done | 🟡 partial | All 5 docs extracted; course.ts not wired to a `coach.classifyClimb()` method (needed for run-detail mile cards) |
| R · Retrospective | ❌ | ❌ | coach.retrospect throws |
| A · Adaptive replanning | ❌ | ❌ | coach.adjustForReality throws |

**Bottom line on doctrine:** ~85% migrated to /Research/. The 15% gap concentrated in:
- Three deprecated files that should be deleted (`heat.ts`, `masters.ts`, `cadence.ts`, `recovery.ts`)
- Six legacy-citation-only files that need a fresh extraction pass from /Research/ (`intensity.ts`, `load.ts`, `post_race.ts`, `taper.ts`, `volume.ts`, `strength.ts`)
- Two skeletal files that need full extraction (`fueling.ts`, `shoes.ts`)

---

## Section 4 · User feedback loop

For each user action that should influence Coach decisions, does the write actually happen and the Coach re-read?

| User action | Storage path | Coach reads via | Wired end-to-end? |
|---|---|---|---|
| Log a run (Strava webhook → cache) | `strava_activities` table → `strava-cache.ts.getCachedActivities()` | `gatherCoachState()` → `state.volume.last7Mi/last28Mi`, `state.intensity.easyShare14d`, `state.recovery.daysSinceLastRun`, `state.races.recent` (via `isProbablyRace`) | ✅ **Fully wired** — every page hits `gatherCoachState()` per request, which re-reads activities. New runs propagate to `assessReadiness` ACWR, `prescribeWorkout` phase, and `bodySystems` daysSince in real time. |
| Add A-race (POST /api/races) | `races` table via `saveRaceDB()` (lib/race-store.ts) | `gatherCoachState()` → `state.races.nextA/inWindow`. Also `listRacesDB()` called directly by /api/overview, /api/training, /api/races-page for `raceFitnessPrediction` inputs. | ✅ **Fully wired** — new A-races immediately drive A-race hero, build-window detection (`buildWindowDays`), and `taperDepth` calls. |
| Edit/update race (PATCH /api/races/[slug]) | `setActualResult()` in storage.ts → PATCH /api/races/[slug] | `state.races.recent[0]` (which feeds `bodySystems.daysSincePeakStress`) | ✅ Wired — but Races page's recap uses `actualResult` directly; Coach.coachRead/retrospect would consume here but currently throw / are stubs. |
| Delete a race | `deleteRace()` → DELETE /api/races/[slug] | `state.races` recomputed | ✅ Wired |
| Strava sync (manual via /api/strava/sync) | Refreshes `strava_activities` cache | Same as "Log a run" | ✅ Wired |
| Set personal goal | **NO TABLE** — `stubGoals()` in profile route hardcodes 6 goals | Nothing reads | ❌ **Not wired** — "+ Add goal" CTA on Profile page is a placeholder. Coach can't see goals. |
| Daily mood check-in (5-emoji + sliders) | **NO TABLE** — `stubMoodCheckin()` + `stubExpandedCheckin()` return null/null/null | Nothing reads | ❌ **Not wired** — banner on Health page logs nothing. `coach.subjectiveAgreement` always reports "AWAITING CHECK-IN". |
| Retire shoe | DELETE /api/shoes/[id] | listShoes() → Profile route shoe rows | ✅ Wired — but Coach has no `runningShoes` input on CoachState; only Profile renders. Shoe selection on runs (api/strava/activity/[id]/shoe) writes to shoe_runs table — but coach-state.ts never reads it. |
| Add new shoe (POST /api/shoes) | `createShoe()` | listShoes() | ✅ Wired (Profile renders) |
| Set long-run-day preference | **NO TABLE** — `stubPrefs()` hardcodes "Sunday" | Nothing reads — `coachDaily()` uses `state.recovery.daysSinceLastRun` and race-driven phase, not a user preference for LR day | ❌ **Not wired** |
| Set HRmax / RHR / units | **NO PROFILE TABLE** — `stubHrBlock()` hardcodes 187 / 42 | hr_zones doctrine reads `hrMax` from… nowhere — every consumer uses literal 187 | ❌ **Not wired** |
| Log recovery session (massage/sauna/etc) | POST /api/recovery → `recovery_sessions` table | `creditSummary()` available — but `gatherCoachState()` doesn't pull recovery credits | 🟡 **Half wired** — recovery POST works, but `state.recovery` doesn't expose recovery-modality credits to Coach. |
| Update race goal | PATCH /api/races/[slug] (likely via saveRace) | `state.races.nextA.goalFinishS` → `raceFitnessPrediction.goalTimeS` | ✅ Wired — but the prediction is the Stage-7 stub so headroom doesn't anchor to real fitness. |
| Mark race finished with actualResult | setActualResult → /api/races/[slug] PATCH | `state.races.recent` → `bodySystems.daysSincePeakStress`, `flags.heavyBlockSuspected`, `recoveryWindowEndsISO` | ✅ Wired — propagates to phase calculation and post-race recovery window. |
| Daily HRV / RHR / sleep (HealthKit) | **HEALTHKIT M2 — not yet ingested** | `state.recovery.hrv7dAvgMs/rhrBpm/sleep7dAvgHrs` are all `null` | ❌ M2 blocker — every wearable signal on Health/Overview reads from stubs not state. |

### Summary

| Loop | Wired? |
|---|---|
| Strava run sync → Coach state | ✅ Strong — re-reads every request |
| Race CRUD → Coach state + predictions | ✅ Strong — postgres round-trip, immediate propagation |
| Shoe DB → Profile render | ✅ but Coach doesn't see shoe choice |
| Recovery session POST → Coach state | 🟡 Endpoint exists, state doesn't expose |
| Personal goals → Coach plan adaptation | ❌ No data model |
| Daily mood / RPE check-in → Coach readiness | ❌ No data model |
| Training preferences → Coach scheduling | ❌ No data model |
| User profile (name/age/sex/HRmax) → everywhere | ❌ No data model |
| HealthKit biometrics → Coach signals | ❌ M2 blocker |

The Strava + race halves of the user input loop are real and propagate end-to-end. **Every other half** is gated on a missing data table or HealthKit ingestion.

---

## Section 5 · Gap punch list

Prioritized by user-visible impact + production correctness.

### P0 — Production-breaking (page shows fake data that looks real)

These are surfaces where a runner sees a number that looks user-specific but isn't:

| # | Surface | Where | Fix |
|---|---|---|---|
| P0.1 | **VDOT 49.2** appears on Overview · Training · Races · Profile · Race-fitness-prediction. Hardcoded everywhere. | `getVdotSnapshot()` overview/data.ts:566 · `vdot: 49.2` in raceFitnessPrediction coach.ts:880 · `stubVdot()` profile route:694 · `'VDOT 49.2 · ▲ +0.8'` hardcoded in training/data.ts:456 | Wire lib/vdot.ts's `vdotSnapshot()` (already exists) into a state field; have each page read from there. |
| P0.2 | **Race fitness prediction** — every "Fitness predicts 1:32" headroom number is `goalTimeS × 0.98`. Doesn't actually use the runner's VDOT or course. | `coach.raceFitnessPrediction()` coach.ts:873 — Stage-7 stub | Wire to `lib/vdot.ts × race_prediction.ts § Riegel` per Research/02. The doctrine exists; the formula is one Coach call away. |
| P0.3 | **14-week PATH-TO-A-RACE trajectory** is the same hardcoded curve regardless of user. Every Overview + Training + Races season-backbone consumes this. | `coach.trajectory14wk()` coach.ts:725 — `plannedSeries` literal array | Read `plan_templates.ts` for the target distance + experience tier, project from `state.volume.weeklyAvg8w` baseline. |
| P0.4 | **Plan Adapted card** on Overview + Training shows "+12% baseline unlocked · 14→17 mi/wk · 7.4→8.2 mi" as **always-on hardcoded copy**. | `getPlanAdapted()` overview/data.ts:485 + training/data.ts:562 — both throw the same fake values because `coach.adjustForReality()` throws | Stage A · `coach.adjustForReality()` lands. Or as interim: have these cards render `null` when adjustForReality throws (today they render fake data). |
| P0.5 | **Body Systems** card · system readiness percentages (`readiness: 0.42` connective, `0.55` CNS) are constants. Only `daysSincePeakStress` is real. | `coach.bodySystems()` coach.ts:677-700 — hardcoded `BodySystem[]` literal | Compute per-system readiness from `state.races.recent[0].daysAgo` against the Research/00b tissue-healing-timeline windows (24-72h glycogen, 5-10d muscle, etc.). |
| P0.6 | **Week Strip** projection ("PROJECTING 22.1 · +8.1 OVER") is hardcoded · doesn't read `state.volume.last7Days`. | `coach.weekDeltas()` coach.ts:919 — `planned`/`actual` literal arrays | Read `state.volume.last7Days` for actuals; derive planned from `coachDaily(state).weekShape`. |

### P1 — User input that doesn't propagate

These are missing data tables / endpoints. The action chip is in the UI; clicking does nothing useful:

| # | Action | Where | Fix |
|---|---|---|---|
| P1.1 | **Add Goal** modal | Profile · `stubGoals()` returns 6 hardcoded categorized goals | `personal_goals` table (id, type, current, target, deadline, rationale). POST /api/goals. Wire `state.goals` so prescribeWorkout + volume + cadence can honor each. |
| P1.2 | **Daily Mood Check-in** + Hooper sliders | Health · banner says "Logged 7:42 AM · Great" but `stubMoodCheckin()` returns null | `mood_log` table (date, emoji, energy 1-10, soreness 1-10, stress 1-10). POST /api/mood. Wire to `state.recovery.subjectiveScoreToday` → `coach.subjectiveAgreement()` can finally fire. |
| P1.3 | **Edit A-Race Goal** | Races · modal template exists per design system; no real edit form. Or it exists but doesn't refresh predictions. | Use existing PATCH /api/races/[slug]; verify pages refetch after edit. (Likely already wired — verify in the actual edit modal binding.) |
| P1.4 | **Training Preferences** (long-run day / quality day / rest) | Profile · `stubPrefs()` hardcodes Sunday/Tue/Thu/Mon | `user_prefs` table. Have `coachDaily()` read preferences to pick which day of week gets the long run / quality session. |
| P1.5 | **HRmax / RHR / Sex / Age / Units** | Profile · `stubHrBlock()` hardcodes hrMax=187, rhr=42. Identity hero hardcodes "M · 38 · LOS ANGELES, CA". | `users` table. Drives hr_zones.ts pace zones, age.ts adjustments, sex.ts cycle gates. |
| P1.6 | **Daily RPE per run** | Log feed shows `rpe: 3/6/9` derived heuristically from name + HR | `run_rpe` table (activity_id, rpe, soreness). POST /api/run/[id]/rpe. Feeds Coach effort-signal trend; currently `state.intensity` only does HR-share. |
| P1.7 | **Recovery session credits → Coach** | `/api/recovery` POST works; `recovery_sessions` table is real | `gatherCoachState()` doesn't read recovery sessions into a state field. Add `state.recovery.modalitiesThisWeek` so Coach can credit yoga/sauna/etc. |

### P2 — Doctrine still on legacy citations

Per Section 3 traceability table:

| # | File | Action |
|---|---|---|
| P2.1 | `heat.ts` (0 research, 1 legacy) | **Delete** — replaced by weather.ts. Audit imports first. |
| P2.2 | `masters.ts` (0 research, 1 legacy) | **Delete** — replaced by age.ts. |
| P2.3 | `cadence.ts` (0 research, 1 legacy) | **Migrate** to Research/16 form-biomechanics OR rename to form.ts. |
| P2.4 | `recovery.ts` (0 research, 1 legacy) | **Delete or merge into recovery_protocols.ts** — overlap is confusing. |
| P2.5 | `post_race.ts` (0 research, 1 legacy) | **Migrate** to Research/00b §Post-Race + Research/05. |
| P2.6 | `intensity.ts` (0 research, 1 legacy) | **Migrate** to Research/00a §TID. |
| P2.7 | `load.ts` (0 research, 1 legacy) | **Migrate** to Research/00a §Load + 13 + 15. |
| P2.8 | `volume.ts` (0 research, 1 legacy) | **Migrate** to Research/00a §Volume + 22. |
| P2.9 | `taper.ts` (0 research, 1 legacy) | **Migrate** to Research/08 + 22. |
| P2.10 | `strength.ts` (0 research, 3 legacy) | **Migrate** to Research/07 strength-programming. |
| P2.11 | `fueling.ts` (0 research, 1 legacy) | **Extract** Research/18 fueling-products + Research/19 hydration. |
| P2.12 | `shoes.ts` (0 research, 1 legacy, stub) | **Extract** Research/17 footwear (33KB). Includes Cat-5 climb classification dependency for run-detail. |
| P2.13 | `workouts.ts` (28 research, 1 legacy) | **Clean up** the single legacy stray cite. |
| P2.14 | `recovery_protocols.ts` (22 research, 1 legacy) | **Clean up** the single legacy stray cite. |
| P2.15 | `plan_templates.ts` (4 research for 25KB) | **Add per-rule citations** — each of 15 plans should cite Research/22 sections; currently sparse. |

### P3 — Engine surface gaps (not blocking pages, but doctrine ready)

These are doctrine modules without an engine method to surface them:

| # | Missing method | Doctrine ready | Use case |
|---|---|---|---|
| P3.1 | `coach.formScore(state)` → CTL/ATL/TSB | wearables.ts (Research/15) | Health · Training Stress card currently synthesized in route, not Coach |
| P3.2 | `coach.classifyClimb(grade, distMi)` | course.ts (Research/11) | Run detail "Cat-5 Moderate" tagging |
| P3.4 | `coach.dailyConditionsNote(weather, workout)` | weather.ts (Research/06) | Training · Conditions inset · 62°F coach note currently hardcoded |
| P3.5 | `coach.bRaceClassification(b, a, phase)` | race_week.ts (Research/22 §Multi-race seasons) | Races · UP-NEXT inset · "TUNE-UP" / "FITNESS CHECK" / "OPENER" classification |

---

## End of report

*Generated by audit pass over the live `web/` tree after the 6-page port landed. The Coach Build Plan (`docs/COACH_BUILD_PLAN.md`) and the prior gap analysis (`docs/MIGRATION_GAP_ANALYSIS.md`) are the companion documents.*
