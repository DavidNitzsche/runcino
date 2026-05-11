# Runcino Migration Gap Analysis

> **Generated:** 2026-05-11 · Read-only inventory of the gap between the locked May 2026 mockups (`designs/*-2026-05-09.html`) and the live web app (`web/app/`), plus a status check on the Coach Build Plan and a surface-to-Coach wiring matrix.

This report is the source of truth for the next migration sprint. Three sections:

1. **Page-level migration map** — what each mockup maps to in the live app, what's missing, how big the lift is.
2. **Coach Build Plan status delta** — what's actually complete in `web/coach/` vs what the plan claims.
3. **Surface-to-Coach matrix** — every coaching judgment shown in the mockups, where the doctrine lives, and whether the UI is wired.

Appendix: anomalies, dead code, recommended first 3 actions.

---

## Section 1 · Page-level migration map

The mockup designs locked on 2026-05-09 are a complete redesign of every main surface. They share a strict design language (Oswald + Jost + JetBrains Mono, dark layered palette, race-orange gradients only for race-imminent surfaces, coach-blue for plan adaptations, amber for "today / attention," green for healed / ready states).

The existing `web/app/*` pages are functional but use an earlier, lighter design language. The gap is *not* CSS — it's data shape and component vocabulary.

| Mockup file | Target route | Existing impl | What's missing | Effort | Blockers |
|---|---|---|---|---|---|
| `overview-2026-05-09.html` (1,573 lines) | `/` (currently redirects to `/races`; needs to become Overview) | `web/app/page.tsx` (1,479 lines) — has Greeting, TodayTile, ThisWeekTile, CoachTodayCard, VdotCard, RecoveryWidget, TrainingPulseTile, FunStatsSection | Greet band with 5 state tiles (PHASE / A-RACE / WEEK / READINESS / TODAY); Today hero card with structure breakdown + pace target + HR cap; Readiness ring with 5 signal bars + Sleep/Last-hard/Next-hard footer; Race-countdown hero with imminent gradient + UP-NEXT B-race inset + AFC finish-time projections (Floor/Goal/Stretch); Week strip with projected-overshoot bar; Trajectory chart with TODAY / PEAK / RACE markers + 5 phase pills; Plan Adapted card with was→now diffs; HRV + RHR + Sleep + Effort sparks; Body Systems 5-row card with healed dates; Pace zones + 14-day distribution + race-pace context; VDOT gradient card with tier band + equivalent race times; Load gauge + 4-wk ACWR sparkline; Weekly miles (4 past + 4 ahead); Long-run progression (6 past + 4 ahead); UP-NEXT B-race tile; Year-in-running heatmap (52 weeks); Monthly volume bars; PR shelf; YTD ring + counter | XL | Coach.assessReadiness signal breakdown (effort trend, load balance, mileage trend, easy pace, recent strain — currently only level+message); Coach.bodySystems() (does NOT exist); Coach.trajectory() / 14-week forecast (does NOT exist); Coach.adaptedPlan() (does NOT exist, Stage A in plan); HealthKit data (HRV, sleep, body temp — M2 placeholder); ACWR / load gauge (lib/coach-principles.ts has acwr() but the gauge needs sweet-spot classification); finish-time projection scenarios (Floor/Goal/Stretch — does NOT exist) |
| `training-2026-05-09.html` (670 lines) | `/training` | `web/app/training/page.tsx` (672 lines) — has TODAY card, this-week strip, next-up list, 12-week chart | TODAY card needs: Why-this-is-light explainer copy, KPI strip (Distance/Duration/Pace target/HR cap), Workout STRUCTURE (warm-up/main/cool-down), Ready-to-Run signals (Sleep/HRV/RHR/Soreness), Conditions + Coach note inset; GOAL TRACKING card with Fitness-Now / AFC-Goal / Headroom + Proof Sessions Ahead list; NEXT-4-WEEKS card (4 blocks with mi/qual/long); PLAN ADAPTED card (same diff pattern as overview); PATH TO AFC build curve with 14 weeks of data points + phase tints + peak diamond + race marker; Build-block summary strip (Total/Peak/Long-run-max/Quality days/Race-pace mi/Cutbacks); Phase breakdown strip (BASE→BUILD→PEAK→TAPER→RACE) | L | Coach.proofSessions() (does NOT exist); 4-week-ahead structured plan (Stage 4 plan_templates wiring); 14-week trajectory model (does NOT exist) |
| `races-2026-05-09.html` (498 lines) | `/races` | `web/app/races/page.tsx` (399 lines) — has UpcomingRaceHero, lists | A-RACE HERO gradient card with Goal/Fitness-predicts/Headroom/Build-starts quad + UP NEXT inset + Open/Edit CTAs; Latest Result recap card with Coach Read verdict + Place/Conditions/AvgHR tiles; Full-year season timeline track with marker dots colored by status (PR / past / upcoming-A / upcoming-B); Upcoming + Recent list pattern with A/B/C priority letter blocks | M | Coach.raceFitnessPrediction(race) (race_prediction.ts exists but isn't called from /races); Coach.coachRead(race) — post-race verdict generator (Stage R "Retrospective loop" — pending); season timeline data shape |
| `health-2026-05-09.html` (709 lines) | `/health` | `web/app/health/page.tsx` (220 lines, mostly M2 placeholders for HealthKit) | Daily mood check-in banner (5 emojis); Readiness composite with 5 named-in-plain-English signal bars; HRV detail card with 30-day chart + 7-day daily bars + low/high stats; RHR detail with 7-day bars + low/high; Sleep with 7-night bars + Deep/REM/Efficiency stage breakdown; Body Systems (5 rows: Glycogen 24-72h / Muscle 5-10d / Connective 2-4wk / CNS 2-4wk / Immune 1-3wk) with "Quality returns" callout; HR Zones 14-day with daily mix bars; Training Stress 30D + Form (CTL-ATL); VO2max 6-mo trend; Respiratory rate 7-night; Body temp 7-night | XL | HealthKit ingestion (HRV, sleep, body temp, resp rate, body temp baseline — entire `health` block in `.runcino.json` schema doesn't exist yet); recovery_protocols.ts has the body-system timeline doctrine (`00b §Tissue Healing Timelines`) — needs surface; CTL/ATL/Form calculations exist in wearables.ts doctrine but aren't computed against actuals |
| `log-2026-05-09.html` (411 lines) | `/log` | `web/app/log/page.tsx` (462 lines) — has run feed, monthly volume, PRs | Year-in-running heat strip (53 weeks colored by intensity, race weeks bright orange); Monthly volume bars 2026 vs 2025 (shaded vs solid); Personal Bests shelf with 6 tiles (5K/10K/HM/M + 1mi + Longest); Recent Runs feed table (Date/Workout/Dist/Time/Pace/HR/RPE) | M | RPE per run (no current data source — needs daily check-in or manual log); cross-year comparison (Strava sync supports it via rollupYear) |
| `profile-2026-05-09.html` (691 lines) | `/profile` | `web/app/profile/page.tsx` (461 lines) — has shoes, run-type prefs | Identity hero with name + age + city + lifetime miles/races/days/peak-year quads; Lifetime PRs list (5K/10K/HM/M/50K); Personal Goals card with 6 categorized goals (Volume/Speed/Distance/Habit/Strength/Health) + progress bars + Coach-respect rationale; VDOT gradient card; HR 5-zone card; Mileage tier card (LOW/MID band with marker); Training preferences (long-run day, quality days, rest, units); Connections (Strava live, HealthKit live, Garmin soon); Shoe rotation list with 5 shoes + caps; Coach Details card — Pace Zones / Long-run cap / Easy-share target / Cutback cadence + Plan-integrity validation | L | Personal Goals data model (does NOT exist); identity profile (name/age/city — no user table); Coach Details requires Coach.engineDetails() (does NOT exist); plan-integrity validation hook (does NOT exist) |
| `_template-detail-2026-05-09.html` (794 lines, canonical full-page detail-view pattern) | `/runs/[id]` and any other detail view (race detail, workout detail, etc.) | `web/app/runs/[id]/page.tsx` (450 lines) — has run header, splits, course visual, retrospective panel | Greet band with 5 KPI tiles (Distance/Time/Avg pace/Avg HR/Elevation); Coach Read card with verdict text + +12% baseline unlocked pin + decision deltas (Vol/wk, Long-run cap); Route map card with mile markers + start/finish dots; Mile-by-mile elevation profile with horizontal grade gradient + 7 mile cards (M1-M7) with grade %, pace, HR; Climbs card with Cat-5 classification; HR · Time in Zone bar; Conditions card; Gear card with shoe + watch + HRM tiles | L | Coach.runRead(activity) (does NOT exist as a Coach method — closest is the retrospective workflow in lib/retrospective.ts); climb classification (course.ts has hill protocols but no climb-detection); per-mile grade calculation (lib/gpx-analysis.ts does this for races but not regular runs); Coach delta logic — what triggers a +12% baseline unlock vs no change |
| `_template-edit-2026-05-09.html` (475 lines) | Modal overlay system for any edit screen | none — no modal system in current app | Modal/overlay system with form fields (label/input/help/unit/select); chip-group picker; radio-row list; foot-meta + save/cancel | S | Modal library or hand-rolled overlay component; design tokens for form fields (already in template CSS) |
| `_template-action-2026-05-09.html` (495 lines) | Multi-step action modal (Add Goal canonical example) | none | Step-wise modal with chip-picker → input → preview pattern; foot-meta with Coach reaction copy | S | same modal infrastructure as edit template |
| `_template-confirm-2026-05-09.html` (449 lines) | Destructive confirm modal (Retire Shoe canonical example) | none | Narrow modal with warning eyebrow + summary tile + danger button | S | same modal infrastructure |
| `_template-empty-2026-05-09.html` (480 lines) | Empty/Loading/Error state atoms | inline empty states in some pages | Three side-by-side card variants demonstrating the state pattern; `.empty-state`, `.skeleton` (shimmer), `.empty-glyph` primitives | S | nothing — pure CSS + JSX |

**Effort summary:** 1 XL (Overview), 1 XL (Health — primarily HealthKit blocker), 2 L (Training, Profile), 2 L (Detail template, Races), 1 M (Log), 4 S (templates).

**Total estimate, calendar:** 4-6 weeks at deliberate pace if no Coach engine work is gated behind the UI. The Coach methods that don't yet exist (bodySystems, trajectory, adaptedPlan, proofSessions, raceFitnessPrediction, coachRead, engineDetails, runRead) are the long-lead items.

---

## Section 2 · Coach Build Plan status delta

The Coach Build Plan at `docs/COACH_BUILD_PLAN.md` enumerates 6 stages of doctrine work (0-6) plus 2 deferred behavior stages (R, A). Below is the actual code state in `web/coach/` against each stage.

**Headline finding:** Stages 0-3 doctrine work is largely complete and Research-cited. Stage 4 doctrine (plan_templates.ts) is present and Research-cited. But the **engine wire-up** (`web/coach/coach.ts` methods + `web/coach/citations.ts`) still leans on the LEGACY `coaching-research.md` for runtime citations. `citations.ts` exclusively uses `rc()` (the legacy helper) — every workout-type citation users see today is sourced from the synthesis doc, not `/Research/`.

| Stage | Status | Evidence | What's stubbed vs real | Blockers / migration needs |
|---|---|---|---|---|
| **0 · Migration prerequisite** (cite() helper + plan/memory) | ✅ Complete | `web/coach/doctrine/cite.ts` (3.3KB) implements 3-form cite — legacy + research with proper doc IDs. Memory entries `feedback_research_canonical_path.md` and `coach_build_plan.md` exist. | Real. The helper supports `cite('§X', 'snippet', 'research', '01')` properly. | None |
| **1 · Foundational** — pace_zones (01), race_prediction (02), hr_zones (03), workouts (04) | ✅ Complete (doctrine) | `pace_zones.ts` 32KB / 17 research-cites · `race_prediction.ts` 29KB / 17 research-cites · `hr_zones.ts` 40KB / 23 research-cites · `workouts.ts` 59KB / 28 research-cites + 1 legacy-cite | All four files are real, dense, cite the canonical `/Research/` docs. workouts.ts still has one legacy `'coaching-research'` citation. | workouts.ts has 1 legacy citation to migrate (not a blocker — already overwhelmingly Research-cited) |
| **2 · Practical** — weather (06), pacing+race_week (08), injury_return (05) | ✅ Complete (doctrine), 🟡 partially wired | `weather.ts` 33KB / 23 research-cites · `pacing.ts` 26KB / 18 research-cites · `race_week.ts` 29KB / 19 research-cites · `injury_return.ts` 26KB / 7 research-cites. Engine wiring: `coach.briefRaceMorning` reads `lib/weather-slowdown.ts` which is Research/06-cited. | `coach.paceStrategy()` still throws "Stage 1" (never implemented despite plan claiming Stage 2 doctrine done). `coach.fuelingFor()` still throws "Stage 1". `coach.taperDepth()` still throws "Stage 1". injury_return.ts has 7 legacy `'coaching-research'` citations and only 7 research cites — needs migration audit. | `coach.paceStrategy / fuelingFor / taperDepth` are still stubs — the plan called these out as 🟡 stubbed in the Plan table itself. injury_return.ts citation mix needs cleanup. |
| **3 · Recovery / load / signals** — recovery_protocols (00b), wearables (15), age (14) | ✅ Complete (doctrine), 🟡 partially wired | `recovery_protocols.ts` 36KB / 22 research-cites · `wearables.ts` 7.8KB / 5 research-cites · `age.ts` 8.6KB / 5 research-cites. Engine: `coach.assessReadiness` is real (Stage 3 done), but uses ACWR + intensity from `lib/coach-principles.ts`, not from the new doctrine. | wearables.ts is small (7.8KB) and likely thin against the 40KB `/Research/15`. Body-systems data (the Health page's Glycogen/Muscle/Connective/CNS/Immune cards) is in `recovery_protocols.ts` (`00b §Tissue Healing Timelines`) but **no Coach method surfaces it**. | Need `Coach.bodySystems(daysSinceLastRace)` to drive Health + Overview cards. Need `Coach.formScore(ctl, atl)` for the Form/CTL-ATL card. Both can be deterministic — doctrine is ready. |
| **4 · Plan templates** — plan_templates (22) | ✅ Doctrine done; engine consumer pending | `plan_templates.ts` 25KB / 4 research-cites. Recent commits (`feat(coach): Stage 4 — engine consumes plan templates`) suggest engine starts to read templates. | Plan_templates.ts only has 4 research-cites for 25KB — the file is structurally heavy (15 plans embedded) but light on per-rule citation. Hard to audit whether every template detail is research-grounded vs invented scaffolding. | The "first behavior change" — engine producing real structured plans rather than ad-hoc weeks — is partially live but unverified against Training-page mockup's 4-week-ahead block. Mockup shows specific cell content ("First T tempo Tue", "Cruise intervals Thu") that requires the engine to actually invoke template-driven scheduling. |
| **5 · Equipment / fueling / sex-specific** — hydration (19), sex (13). Footwear/fueling-products **deferred** per plan | 🟡 Partial | `hydration.ts` 17KB / 12 research-cites · `sex.ts` 13KB / 6 research-cites. `fueling.ts` exists (5KB) but has 11 LEGACY `'coaching-research'` cites and 0 research cites — it's pre-migration. `shoes.ts` 2.7KB has 5 legacy cites — stub. | fueling.ts is fully legacy. shoes.ts is a 2.7KB stub. footwear (Research/17, 33KB) and fueling_products (Research/18, 33KB) are **not extracted into doctrine at all** despite the mockups showing shoe rotation with mileage caps. | Mockup's Profile shoe rotation pulls from existing `lib/shoe-store.ts` (real DB column) — doesn't need doctrine. But fueling card on race detail wants Research/18 numbers — needs fueling_products.ts. |
| **6 · Specialized** — cross_training (09), mobility (10), course (11), travel (12), mental (20). Form deferred | 🟡 Mostly done | `cross_training.ts` 10KB / 5 research-cites · `mobility.ts` 10KB / 7 research-cites · `course.ts` 11KB / 6 research-cites · `travel.ts` 7KB / 5 research-cites · `mental.ts` 18KB / 13 research-cites. `cadence.ts` (placeholder for form work) is 3KB / 6 legacy cites — pre-migration. | All Specialized doctrine present in modest depth; legacy-cite-heavy in form/cadence area. course.ts can classify climbs (mockup shows "Cat 5 Moderate") but `Coach.classifyClimb()` doesn't exist as a callable method. | Mockup's run-detail page wants per-climb classification — course.ts has the framework but no surface route. |
| **R · Retrospective loop** — `coach.retrospect(plan, actual)` → personal calibration | ❌ Not started | `coach.ts` line 252: `retrospect(): Promise<CoachDecision<RetrospectiveOutput>> { return this.notYet(4, 'retrospect'); }` | Throws. | Mockup's run-detail "Coach Read" card with "+12% baseline unlocked" decision deltas requires this. Currently the "Coach Adapted" copy in the overview/training mockups is hardcoded narrative. |
| **A · Adaptive replanning** — `coach.adjustForReality(missed, sleep)` | ❌ Not started | `coach.ts` line 253: `adjustForReality(): ... { return this.notYet(5, 'adjustForReality'); }`. Note: a recent commit (`feat(coach): Stage A — voice reconciles when today's actual diverges`) suggests partial work in `web/coach/explanations.ts`. | Throws (the Coach method); partial reconciliation in explanations.ts. | Mockup's Plan Adapted cards (Overview + Training) need this fully wired — was→now diffs are real decisions, not narrative. |

### Legacy-citation migration audit

Files in `web/coach/doctrine/` that still cite `docs/coaching-research.md` (LEGACY synthesis) per memory entry `feedback_research_canonical_path.md`:

| File | Legacy cites | Research cites | Verdict |
|---|---|---|---|
| `cite.ts` | 4 | (helper) | Helper still mentions legacy paths in JSDoc — fine. |
| `intensity.ts` | 7 | 0 | **Needs full migration** — 00a-distance-running-training.md §TID has the canonical content |
| `heat.ts` | 7 | 0 | **Should be deleted** — replaced by `weather.ts` per plan but heat.ts is still in the doctrine index (see Anomalies) |
| `load.ts` | 6 | 0 | **Needs migration** — 00a §Load + 13 + 15 |
| `cadence.ts` | 6 | 0 | **Needs migration** — Research/16 form-biomechanics |
| `post_race.ts` | 7 | 0 | **Needs migration** — 00b §Post-Race + 5 |
| `recovery.ts` | 7 | 0 | **Needs migration or deletion** — overlaps with recovery_protocols.ts |
| `fueling.ts` | 11 | 0 | **Needs full migration** — Research/18 + 19 |
| `recovery_protocols.ts` | 22 | 22 | **Mixed citations** — file has both research (22) and legacy (22). The legacy ones are likely orphans from the migration in progress; one cite per concept should be the rule |
| `strength.ts` | 11 (incl. amp) | 0 | **Needs migration** — Research/07-strength-programming.md |
| `shoes.ts` | 5 | 0 | **Stub — needs Research/17 extraction** |
| `workouts.ts` | 29 | 28 | **Mixed citations** — fix double-cite pattern, prefer research |
| `volume.ts` | 8 | 0 | **Needs migration** — 00a §Volume + 22 |
| `masters.ts` | 9 | 0 | **Deprecated** — replaced by age.ts per plan; should be deleted |
| `taper.ts` | 6 | 0 | **Needs migration** — Research/08 + 22 |
| `citations.ts` (the engine-level helper, NOT a doctrine file) | uses `rc()` exclusively | 0 | **CRITICAL** — every workout-type citation users see today still points at the legacy synthesis doc. This is the user-facing audit trail. |

**Bottom line on doctrine:** doctrine extraction is ~70% migrated to `/Research/`. The 30% gap is concentrated in the older doctrine files (intensity, load, cadence, recovery, post_race, fueling, strength, volume, taper) — the ones that landed in Stage 0 before the canonical-source decision on 2026-05-06. Stage 1+ files are nearly all Research-cited.

**Bottom line on engine:** `citations.ts` is the choke point. Until it's rewritten to issue `cite('§', 'snippet', 'research', 'XX')` instead of `rc()`, every "why?" tap in the mockups will point users at the legacy synthesis doc, not the canonical research library.

---

## Section 3 · Surface-to-Coach matrix

Every coaching judgment shown in the 11 mockups, the doctrine module that should back it, and the current wiring status. Status legend:

- ❌ **Not wired** — hardcoded text or value in the mockup; no Coach method exists or it's not called from anywhere
- 🟡 **Doctrine exists, no route** — doctrine module has the data, but no Coach method surfaces it, OR a Coach method exists but isn't called from the UI
- 🟢 **Fully wired** — Coach method exists, doctrine-backed, called from the page, renders the string in the UI today

### Overview page (`overview-2026-05-09.html`)

| Mockup location | Type | Doctrine module | Wiring | Research citation | Effort |
|---|---|---|---|---|---|
| Greet → PHASE tile · "RECOVERY 2/2 · DAY 6 POST-SOMBRERO" | classification | recovery_protocols.ts (`00b §Post-Race Recovery`) | 🟡 | Research/00b · §Post-Race | M |
| Greet → A-RACE COUNTDOWN · "98 D · AFC HALF" | computed | (none — pure date math) | 🟢 | n/a | n/a |
| Greet → READINESS · "88/100 · BUILDING +0.30 · COACH +12%" | classification | (composite score — no doctrine yet) | ❌ | n/a | L |
| Greet → TODAY · "3.0 mi RECOVERY JOG · 8:55–9:25" | prescription | workouts.ts + pace_zones.ts | 🟢 (Coach.prescribeWorkout wired) | Research/04 + 01 | n/a |
| TODAY hero → "Recovery jog" title + Why-this-is-light explainer | prescription + rationale | recovery_protocols.ts | 🟡 (workout type wired; rationale paragraph is mockup-hardcoded) | Research/00b · §Tissue Healing | M |
| TODAY → KPI strip · Distance / Duration / Pace target / HR cap Z1 | derived | pace_zones.ts + hr_zones.ts | 🟢 (prescribeWorkout returns paceBand + hrZone) | Research/01 + 03 | S |
| TODAY → STRUCTURE warm-up/main/cool-down breakdown | prescription | workouts.ts | ❌ (Coach.prescribeWorkout returns one paragraph, not structure) | Research/04 · §Workout anatomy | M |
| READINESS RING → "88/100 · BUILDING" + 5 signal bars (Effort trend / Load balance / Mileage trend / Easy pace / Recent strain) | classification | wearables.ts + recovery_protocols.ts | 🟡 (Coach.assessReadiness returns level+message+acwr+easyShare; mockup wants 5 named signals with +0.25/-0.25 weights) | Research/15 · §HRV + ACWR; Research/13.1 | M |
| READINESS RING → Sleep 7:42 / Last hard +46h / Next hard ~9d footer | derived | wearables.ts | ❌ (no Coach method for "last hard" / "next hard" — derived from activity log + plan) | Research/00b · §Hard-day spacing | M |
| READINESS RING → "▲ Quality returns when recovery window closes" verbiage | rationale | recovery_protocols.ts (`00b §Tissue Healing Timelines`) | ❌ | Research/00b | S |
| RACE COUNTDOWN hero (white-on-gradient) "Americas Finest City · 98 days" | display | (data) | 🟢 (data) | n/a | n/a |
| RACE COUNTDOWN → UP NEXT B-RACE inset · "Mission Bay 10K · 44d · Tune-up · goal 42:00 · sharpens AFC" | classification | race_week.ts (B-race vs A-race priority) | ❌ (no concept of "tune-up sharpens AFC" — that's a Coach insight) | Research/08 · §Race week + 22 · §Multi-race seasons | M |
| RACE COUNTDOWN → BASE/BUILD/PEAK/TAPER progress bar w/ "14D TO BUILD WINDOW" | classification | plan_templates.ts (phase boundaries) | 🟡 | Research/22 · §Phase structure | M |
| RACE COUNTDOWN → CURRENT 7:00/mi vs GOAL 7:15/mi · "ON TRACK · 15s/mi HEADROOM" | prediction | race_prediction.ts + pace_zones.ts | 🟡 (race_prediction.ts exists with 29KB / 17 research-cites; no Coach surface) | Research/02 · §Riegel + age-grading | M |
| RACE COUNTDOWN → AFC FINISH TIME PROJECTIONS · Floor 1:38 / Goal 1:35 / Stretch 1:32 | prediction | race_prediction.ts (confidence intervals) | ❌ (doctrine has confidence intervals but no Coach.predictRaceTime with scenarios) | Research/02 · §Multi-race weighted fit | M |
| WEEK STRIP → "PROJECTING 22.1 · +8.1 OVER" header | classification | (engine forecast — currently in coach-engine.ts weekShape) | 🟡 (data exists, mockup wants a band with projected-overshoot dashed segment) | Research/00a · §Volume progression | S |
| WEEK STRIP day cards (7 days, type-tag color, MON–SUN) | prescription | workouts.ts + plan_templates.ts | 🟢 (coachDaily.weekShape provides this) | Research/04 + 22 | S |
| WEEK STRIP day card · "+5.4 vs plan" Coach delta pin | classification | (engine — comparing actual vs scheduled) | 🟡 (storage has actuals; needs Coach.weekDeltas()) | n/a | S |
| TRAJECTORY card · "PATH TO AFC · 14 WEEKS · 98 days · 5 phases · peaks at 44 mi/wk" | prediction | plan_templates.ts | ❌ (no Coach.trajectory14wk method) | Research/22 · §Plan skeletons | L |
| TRAJECTORY card · PEAK TARGET diamond at 44 mi/wk | prediction | plan_templates.ts (HM Advanced peak ~44) | 🟡 | Research/22 · §Half plans | S |
| TRAJECTORY card · phase pills (Hold floor / Base · LT / Build / Peak 44 / Taper) | classification | plan_templates.ts | 🟡 | Research/22 | S |
| PLAN ADAPTED · "Coach added volume and lifted the long-run cap" + +12% pin | plan-change | (Stage A — adjustForReality) | ❌ (Coach.adjustForReality throws) | Research/00a · §ACWR + 13 | L |
| PLAN ADAPTED · Volume 14→17 mi/wk decision delta | plan-change | volume.ts + plan_templates.ts | ❌ | Research/00a §Volume + 22 | S |
| PLAN ADAPTED · Long-run cap 7.4→8.2 mi decision delta | plan-change | recovery_protocols.ts (10% rule) | ❌ | Research/00a · §10% rule | S |
| HRV spark · "68ms · ↑ BASELINE · +6%" | classification | wearables.ts | 🟡 (wearables.ts has HRV doctrine; needs HealthKit data flow) | Research/15 · §HRV interpretation | M |
| RESTING HR spark · "42bpm · STABLE · −1bpm vs base" | classification | wearables.ts | 🟡 (same) | Research/15 · §RHR baseline | M |
| SLEEP spark · "7:42 · DEEP · Deep 1:54 · REM 1:46" | classification | recovery_protocols.ts | 🟡 (doctrine has sleep stage references) | Research/00b · §Sleep | M |
| EFFORT spark · "4.2 · ↓ EASIER · WAS 4.6 · DRIFT −0.4" | classification | (engine — RPE rollup) | ❌ (RPE not tracked) | n/a | M |
| BODY SYSTEMS card · "5 systems · 5 timelines" with Glycogen / Muscle / Connective / CNS / Immune + healed-date estimates | prediction | recovery_protocols.ts (`00b §Tissue Healing Timelines`) | ❌ (doctrine has it; no Coach.bodySystems method) | Research/00b · §Tissue Healing | M |
| BODY SYSTEMS · "Quality work returns ~MAY 24 · 15 days" callout | prediction | recovery_protocols.ts | ❌ | Research/00b | S |
| PACE ZONES card · "VDOT 49.2 · Daniels · DISNEY HALF" + 5 zones (E/M/T/I/R) | derived | pace_zones.ts | 🟢 (pace_zones.ts has DANIELS_PACE_OFFSETS; vdot.ts in lib/) | Research/01 · §VDOT + pace tables | n/a |
| PACE ZONES · 14-day distribution bars "Running 92% easy · aiming ≥80%" | classification | intensity.ts | 🟡 (intensity.ts has POLARIZED_DISTRIBUTION but with legacy cites; assessReadiness uses lib/coach-principles intensityTarget) | Research/00a · §TID | S |
| PACE ZONES · "Current fitness 7:00/mi · AFC goal 7:15/mi · 15s/mi headroom" | prediction | race_prediction.ts + pace_zones.ts | 🟡 | Research/02 + 01 | S |
| VDOT card · "49.2 · RAW 50.0 · DECAY −0.8 · 6 MO TREND · ADV YOU tier band · 5K 19:32 / 10K 40:55 / HM 1:31 / M 3:11" | classification + prediction | pace_zones.ts + race_prediction.ts + age.ts | 🟡 (vdot.ts in lib/; tier banding doesn't exist; equivalent race times via Riegel doctrine) | Research/01 + 02 + 14 | M |
| LOAD GAUGE · "1.05 · SWEET SPOT · 0.8–1.2 SAFE" with arc gauge | classification | load.ts + wearables.ts | 🟡 (acwr() in lib/coach-principles; "sweet spot" classification doctrine in 00a §13.1 but legacy-cited) | Research/00a · §ACWR + 13.1 | S |
| LOAD GAUGE · 4-week ACWR trend "Holding sweet spot" | classification | load.ts | 🟡 | Research/00a · §13.1 | S |
| WEEKLY MILES card · "22 mi · +12% vs 8W AVG · Peak Apr 13–19 · 42 mi" | derived | volume.ts | 🟢 (strava-stats.ts weeklyMiles + funStats) | Research/00a · §Volume | n/a |
| LONG RUN card · "5 mi · NEXT · 6 past + 4 ahead · Peak 14 mi" | derived | plan_templates.ts | 🟡 (data exists in weekShape but mockup wants 10-week strip with race weeks marked) | Research/22 | S |
| UP NEXT B-RACE chip · "Mission Bay 10K · 44 D · GOAL 42:00 · Fitness predicts 41:32 · +28s headroom · TUNE-UP FOR AFC · ON TRACK" | prediction | race_prediction.ts | ❌ (no Coach.raceFitnessPrediction) | Research/02 | M |
| YEAR HEAT card · 53-week heatmap with race-week orange + dashed-future race squares | display | (year-of-running rollup) | 🟢 (strava-stats.yearOfRunningHeatmap exists) | n/a | n/a |
| YTD card · "503 mi · DAY 129 · 35% INTO 2026 · +22 vs 2025 same day · PROJECTED EOY 1,650 · Calories 62.8k ≈ 220 BURRITOS" | derived | (Strava rollup) | 🟢 (rollupYear in strava-stats; fun-stats exists) | n/a | n/a |

### Training page (`training-2026-05-09.html`)

| Mockup location | Type | Doctrine module | Wiring | Research citation | Effort |
|---|---|---|---|---|---|
| TODAY hero · "Recovery jog · Why this is light: connective tissue still rebuilding from Sombrero (day 6 / 14–21 day window). Easy aerobic moves blood without restarting damage." | rationale | recovery_protocols.ts (`00b §Tissue Healing Timelines`) | ❌ (hardcoded) | Research/00b | M |
| READY TO RUN signals · Sleep 7:42 +18m goal · HRV 68ms ▲+4 vs base · RHR 42 ▼−1 vs base · Soreness Mild calf/connective | classification | wearables.ts + recovery_protocols.ts | 🟡 | Research/15 + 00b | M |
| CONDITIONS + COACH NOTE inset · "62°F · 12 mph · cloudy / Settle into pace — don't chase. Cap effort if HR drifts above 145." | prescription | weather.ts + hr_zones.ts | 🟡 (weather.ts and hr_zones.ts have the data; no Coach.dailyConditionsNote) | Research/06 + 03 | M |
| GOAL TRACKING · "Pace toward 1:35:00 · 7:15/MI" + Fitness Now 1:32 / AFC Goal 1:35 / Headroom +15s/mi | prediction | race_prediction.ts | ❌ | Research/02 | M |
| PROOF SESSIONS AHEAD list · Tue May 26 "First T tempo · 4×1mi @ T", Sat Jun 14 "First HMP miles · 3×2mi", Jun 22 Mission Bay 10K, Sat Jul 12 "Race-pace 8mi" | prescription | plan_templates.ts + workouts.ts | 🟡 (Stage 4 engine consumes templates; but mockup-specific "proof sessions" classification doesn't exist as Coach.keyWorkoutsAhead()) | Research/22 · §HM build proof points | M |
| LATEST PROOF · APR 23 · "3 × 1mi @ T pace · 6:55 avg (target 7:00). HR 167 avg · sustainable. ✓ ON TARGET" | classification | pace_zones.ts (pace target vs actual) | ❌ (retrospect not implemented) | Research/01 + 02 | M |
| PR/GOAL/STRETCH tile row · PR 1:32 Disney / GOAL 1:35 AFC / STRETCH 1:30 | prediction | race_prediction.ts | 🟡 | Research/02 | S |
| WEEK STRIP (same as Overview) | prescription | workouts.ts + plan_templates.ts | 🟢 | Research/04 + 22 | n/a |
| NEXT 4 WEEKS card · 4 blocks with mi/qual/long · "Recovery wraps · Base block opens" + "Recovery week 2", "Base · LT in · First T tempo Tue · long climbs", "Base · build LR", "Base · cutback −20% volume" | plan-change | plan_templates.ts | ❌ (no Coach.next4Weeks() method; engine produces today + week shape only, not 4-week ahead) | Research/22 · §HM build blocks | L |
| PATH TO AFC build curve · 14-week weekly volume trajectory · peak 44 / long-run-max 14 / 52 race-pace mi / 28 quality days | prediction | plan_templates.ts | ❌ | Research/22 · §HM 14-wk template | L |
| Phase breakdown strip · BASE 2W · BUILD 5W · PEAK 4W · TAPER 3W · RACE | classification | plan_templates.ts + race_week.ts | 🟡 | Research/22 + 08 | S |
| PLAN ADAPTED (same as Overview) | plan-change | (Stage A) | ❌ | Research/00a + 13 | L |

### Races page (`races-2026-05-09.html`)

| Mockup location | Type | Doctrine module | Wiring | Research citation | Effort |
|---|---|---|---|---|---|
| A-RACE HERO · GOAL 1:35:00 / FITNESS PREDICTS 1:32 / HEADROOM +15s/mi · CONFIDENCE HIGH / BUILD STARTS 14d | prediction | race_prediction.ts | ❌ | Research/02 | M |
| LATEST RESULT · "Big Sur Marathon · APR 27 · MARATHON · HILLY · 4.2K FT GAIN · 3:36:55 · LIFETIME PR −5:29 · 8:17/mi · ▼ NEGATIVE SPLIT −0:12" | derived | (race results from storage + course-facts) | 🟢 (data exists in SavedRace.actualResult; negative-split classification doesn't) | n/a | S |
| LATEST RESULT · COACH READ verdict · "Sustained 7:42/mi avg on hills with no late fade. Aerobic engine confirmed for AFC build — fitness on track for sub-1:35." | classification + plan-change | (Stage R retrospective) | ❌ (Coach.retrospect throws; lib/retrospective.ts has heuristics but no doctrine citations) | Research/02 + 11 | L |
| Stats · "Place 247/3.2k · TOP 8% · AG #23" | derived | (Strava best_efforts) | 🟡 (Strava has division/AG data) | n/a | S |
| Stats · "AVG HR 156 · 83% MAX · Z3 STEADY" | classification | hr_zones.ts | 🟡 | Research/03 | S |
| 2026 SEASON TIMELINE · race dots colored by status (PR / past / upcoming-A / upcoming-B) | display | (race storage + race_week.ts) | 🟡 | n/a | S |
| UPCOMING list · A/B/C priority letters with phase/build context · "Mission Bay 10K · TUNE-UP FOR AFC · 23 days of build · base→build phase transition" | classification | race_week.ts | ❌ | Research/22 · §Multi-race seasons | M |
| RECENT list · Sombrero "SENTIMENTAL EFFORT" · Big Sur "PR · 8:17/mi" · Point Magu "BIG SUR PREP" classifications | classification | race_week.ts | ❌ (these labels are inferred from race priority + result vs PR — but the rule doesn't exist) | Research/22 | S |

### Health page (`health-2026-05-09.html`)

| Mockup location | Type | Doctrine module | Wiring | Research citation | Effort |
|---|---|---|---|---|---|
| DAILY CHECK-IN · 5-emoji mood + "Logged 7:42 AM · Great" | input | mental.ts (`Research/20 · §Mood logging`) | ❌ | Research/20 | S |
| READINESS COMPOSITE 88/100 + 5 named signal bars in plain English | classification | wearables.ts + recovery_protocols.ts | 🟡 (same as Overview signal bars) | Research/15 + 13.1 | M |
| HRV 30-day + 7-day daily + low/high stats | display | wearables.ts | 🟡 (doctrine ready; HealthKit blocked) | Research/15 · §HRV | M |
| RHR 7-day + daily bars + low/high | display | wearables.ts | 🟡 | Research/15 · §RHR | M |
| SLEEP 7-night bars + Deep/REM/Efficiency breakdown | display | recovery_protocols.ts | 🟡 | Research/00b · §Sleep | M |
| BODY SYSTEMS card · 5 systems w/ healed-date predictions · "Quality work returns ~MAY 24" | prediction | recovery_protocols.ts (`00b §Tissue Healing Timelines`) | ❌ (no Coach method) | Research/00b | M |
| HR ZONES 14-day · "POLARIZED INTACT · 92% EASY · TARGET 80%" + daily mix bars | classification | intensity.ts + hr_zones.ts | 🟡 (intensity.ts has POLARIZED_DISTRIBUTION; daily-mix bars need 14-day rollup) | Research/00a · §TID + 03 | S |
| TRAINING STRESS 30D · "FITNESS 62 · FATIGUE 38 · FORM +24 · ▲ FRESH" + Form callout · "Peaked Apr 13–19 · 142 mi · Race ready" | classification | wearables.ts (CTL/ATL/TSB) | ❌ (doctrine has CTL/ATL definitions in wearables.ts but no Coach.formScore method) | Research/15 · §CTL/ATL | M |
| VO2MAX 6-month trend "52 ml/kg · ↑ +1.2 · 90th %ile · M 38" | classification | wearables.ts + age.ts | ❌ (no VO2max estimation in code; Apple Watch provides estimate; age-grading is in age.ts) | Research/15 + 14 | M |
| RESPIRATORY RATE 7-night + baseline | display | wearables.ts | 🟡 (HealthKit blocked) | Research/15 | S |
| BODY TEMP 7-night baseline | display | wearables.ts + sex.ts | 🟡 (HealthKit blocked; sex.ts has body-temp cyclical doctrine for menstrual cycle) | Research/15 + 13 | S |

### Log page (`log-2026-05-09.html`)

| Mockup location | Type | Doctrine module | Wiring | Research citation | Effort |
|---|---|---|---|---|---|
| Year heat strip (53 weeks) | display | (Strava rollup) | 🟢 | n/a | n/a |
| Monthly volume bars 2026 vs 2025 | display | (Strava rollup) | 🟢 (rollupYear) | n/a | n/a |
| Personal Bests shelf · 5K/10K/HM/M + 1 mile + Longest | derived | race_prediction.ts (PR detection) | 🟢 (strava-stats.naivePRs + Strava best_efforts) | n/a | n/a |
| Recent Runs feed row · Sun May 3 ★ Sombrero Half "RACE · C-EFFORT · SENTIMENTAL" | classification | race_week.ts (effort tagging) | ❌ | Research/08 · §Race priority | S |
| Recent Runs feed · Wed Apr 23 Threshold tempo "5MI @ T · TAPER" | classification | workouts.ts | 🟡 (workout-type tagging exists; "TAPER" context label doesn't) | Research/04 | S |
| RPE per run · "3" / "9" / "6" | input | mental.ts | ❌ (no daily RPE input) | Research/20 | S |

### Profile page (`profile-2026-05-09.html`)

| Mockup location | Type | Doctrine module | Wiring | Research citation | Effort |
|---|---|---|---|---|---|
| Identity hero · Lifetime mi / Races / Days run / Peak year | derived | (Strava lifetime rollup) | 🟡 (Strava sync goes 200 activities deep — lifetime needs full history) | n/a | S |
| LIFETIME PRs · 5K/10K/HM/M/50K rows | derived | race_prediction.ts (PR registry) | 🟢 (Strava bests) | n/a | n/a |
| PERSONAL GOALS card · 6 goals (Volume/Speed/Distance/Habit/Strength/Health) + Coach respect copy | input + plan-change | plan_templates.ts + recovery_protocols.ts | ❌ (no goals data model; "Coach is bumping +12% absorbed weeks" etc. is hardcoded narrative) | Research/22 | L |
| VDOT card (same as Overview) | classification | pace_zones.ts | 🟡 | Research/01 | n/a |
| HR 5-ZONE card · HRMAX 187 / RHR 42 / Z1-Z5 ranges | derived | hr_zones.ts | 🟢 (hr_zones.ts has Karvonen + Friel LTHR; vdot.ts/coach-state.ts assemble HRmax) | Research/03 | n/a |
| MILEAGE TIER · "35 mi/wk · LOW BAND (20-40) · ▲ +12% V8W" with band marker | classification | volume.ts | ❌ (volume.ts has tier doctrine but classification not surfaced) | Research/00a · §Volume by experience | S |
| TRAINING PREFERENCES (long-run day / quality day / typical rest / units) | input | (profile prefs) | 🟡 (some prefs exist in shoe profile; no general training prefs model) | n/a | S |
| CONNECTIONS · Strava LIVE / HealthKit LIVE / Garmin SOON | display | (integration status) | 🟡 (Strava is real; HealthKit is M2 placeholder) | n/a | S |
| SHOE ROTATION · 5 shoes + caps + mileage bars + "RETIRE / 1 NEAR CAP" | display + plan-change | shoes.ts | 🟢 (lib/shoe-store.ts + lib/shoe-utils.ts) | Research/17 (NOT extracted to doctrine) | n/a |
| COACH DETAILS · "Long-run cap 8.2 / Easy-share 92% target ≥80 / Cutback every 3 wks / Pace zones from VDOT 49.2" + "▲ Plan integrity validated · 12/12 rules OK" | engine state | (multi-doctrine) | ❌ (no Coach.engineDetails() method; plan-integrity validation doesn't exist) | Research/00a + 01 + 22 | L |

### Detail template (`_template-detail-2026-05-09.html` — run detail canonical)

| Mockup location | Type | Doctrine module | Wiring | Research citation | Effort |
|---|---|---|---|---|---|
| KPI band · Distance / Time / Avg pace / Avg HR / Elevation | derived | (Strava activity data) | 🟢 | n/a | n/a |
| COACH READ card · "Recovery run, but you absorbed more" + "Ran +4.7 mi over plan at RPE −0.4. HR stayed Z1–Z2..." + +12% BASELINE UNLOCKED pin | classification + plan-change | (Stage R retrospect + Stage A adjust) | ❌ | Research/00a + 13 + 22 | L |
| COACH READ · VOL/WK 14→17 + LONG-RUN CAP 7.4→8.2 decision deltas | plan-change | volume.ts + recovery_protocols.ts | ❌ | Research/00a + 00b | M |
| ROUTE MAP card · mile markers + start/finish dots | display | (GPX parsing) | 🟡 (lib/gpx-analysis.ts does this for races; runs need same treatment) | n/a | M |
| MILE-BY-MILE · elevation profile + 7 mile cards with grade % / pace / HR | display + classification | course.ts (grade classification) | 🟡 (course.ts has hill grade thresholds; per-mile rollup for non-race runs doesn't exist) | Research/11 · §Hill grades | M |
| CLIMBS card · "2 climbs · CAT 5" + "▲ MI 2.1–3.0 · 2.4% · +116 ft" + "NO FADE" | classification + verdict | course.ts | ❌ (no Coach.classifyClimb / Coach.fadeAnalysis) | Research/11 · §Climb categorization | M |
| HR · TIME IN ZONE · Z1 37m / Z2 20m / Z3+ 2m · "▲ POLARIZED" | classification | hr_zones.ts + intensity.ts | 🟡 | Research/03 + 00a | S |
| CONDITIONS · 61°F / 53° dew / 72% / 4 mph SW · "MARINE LAYER · NO PENALTY" | classification | weather.ts | 🟡 (weather.ts has the data; per-run penalty assessment not wired) | Research/06 | S |
| GEAR · Speedgoat 5 · 287/400 mi + Fenix 7 + HRM-Pro | display | shoes.ts | 🟢 (shoe-store.ts) | n/a | n/a |
| RUN ACTIONS · View on Strava / Edit / Delete | nav | n/a | 🟢 | n/a | n/a |

### Templates (edit / action / confirm / empty)

The 4 modal/state templates are scaffolding, not coaching surfaces. They reference Coach copy in body text ("Coach derives pace zones from this", "Coach will rebuild the 14-week plan") but require no Coach method beyond what the underlying form (Edit goal, Add goal, Retire shoe) needs.

| Template | Used where | Coach copy in template | Wiring |
|---|---|---|---|
| `_template-edit` (Edit A-Race Goal) | Profile / Races edit screens | "Coach derives pace zones from this. Current fitness predicts 1:32 — you have +15 s/mi headroom." | ❌ (live prediction value hardcoded; needs race_prediction.ts wiring) |
| `_template-action` (Add Personal Goal) | Profile · Add goal flow | "Volume goals tell the Coach to ramp your weekly mileage toward a target." | ❌ (goals data model doesn't exist) |
| `_template-confirm` (Retire Shoe) | Profile · Shoe row · Retire | n/a | 🟢 (shoes work; pattern just needs the modal infrastructure) |
| `_template-empty` (Empty/Loading/Error) | Every page | n/a | partial (some pages have empty states; no skeleton/error atom system) |

---

## 🚩 Anomalies appendix

### Doctrine

1. **`heat.ts` should be deleted.** The plan explicitly says weather.ts replaces it (`web/coach/doctrine/heat.ts · §0 in plan: "Practical · weather.ts (06, replaces heat.ts)"`). But heat.ts is still exported from `doctrine/index.ts` and still has 7 legacy citations. Live code may still import from heat.ts when it should be reading weather.ts.

2. **`masters.ts` should be deleted.** Same story: replaced by age.ts per plan. Still in index.ts with 9 legacy cites.

3. **`cadence.ts` is the placeholder for form.ts.** The plan says `form.ts (16)` should exist. Instead we have cadence.ts (3KB, 6 legacy cites) and no form.ts. Form work is bigger than just cadence.

4. **`recovery.ts` vs `recovery_protocols.ts` overlap.** recovery.ts is small (3.6KB) and legacy-cited; recovery_protocols.ts is huge (36KB) and Research/00b-cited. Both are exported from the barrel. Likely import collisions and ambiguous source-of-truth.

5. **`citations.ts` is the engine-level helper, NOT a doctrine file, and it's entirely legacy.** Every workout-type citation users see today via Coach.prescribeWorkout's citations[] field still points at `docs/coaching-research.md`. This is the single largest user-facing legacy debt.

6. **plan_templates.ts has only 4 research-cites for 25KB.** Either the file is mostly invented scaffolding without research backing (concerning per `feedback_engine_match_research.md` memory), or it's structurally heavy but citation-light. Audit required.

7. **`shoes.ts` and `fueling.ts` are skeletal but called from real engine code.** fueling.ts has 11 legacy cites and 0 research cites despite Research/18 and Research/19 being 33KB + 27KB. shoes.ts is similarly thin against Research/17 (33KB). These two are the next stage-5 deliverables.

### Engine

8. **3 Coach methods on coach.ts still throw.** `paceStrategy`, `taperDepth`, `fuelingFor` are stubs with "Stage 1" hints. The doctrine for all 3 has been written for weeks. This is the biggest gap between doctrine and consumption.

9. **`retrospect` and `adjustForReality` throw.** Stage R and Stage A in the plan. Required by every "Plan Adapted" / "Coach Read" / decision-delta surface in the mockups. These are the largest pending pieces of behavioral logic.

10. **The Coach has no `bodySystems`, `trajectory`, `proofSessions`, `raceFitnessPrediction`, `coachRead`, `engineDetails`, `runRead`, or `weekDeltas` methods.** All required by the mockups. None planned in the current Stage table. Need to be added to the Coach Build Plan as Stage 7+ (UI consumption layer).

### Web app

11. **`/training`, `/retrospective`, `/research`, `/settings/integrations` are noted as "broken" in STATUS.md** — they reference dead CSS classes (`.runcino-card`, `.btn-accent`, `--color-paper`). When migrating to the May 9 designs, these existing files should likely be deleted rather than patched, since the new design system uses a completely different vocabulary.

12. **`web/app/page.tsx` is 1,479 lines** — a god-component. The current Overview is one giant TSX file. Migrating to the May 9 mockup is a good moment to split into card-level components matching the mockup's row structure.

13. **`/api/coach/today` returns `coach.workout` and `coach.readiness` but no `coach.bodySystems` / `coach.trajectory` / etc.** The API surface needs to grow alongside the Coach methods.

### Designs

14. **The 11 mockups don't include a workout-detail page.** `/workout/[date]/page.tsx` exists in the live app (520 lines) and shows a single day's plan. The May 9 mockups have TODAY in Training but no expanded workout view. Either the mockup set is incomplete or workout detail collapses into the Training-page TODAY card.

15. **No "race day" / "live race" mockup in the May 9 set.** Existing `designs/iphone-app.html` has Screen 3 (live race day) but no May 9 equivalent. Race-day surface is implied (race-imminent gradient on hero-race) but not specified.

16. **No mockup for `/races/new` (Add race flow).** Live app has it (862 lines). The Action template suggests Add Race could fit the action-modal pattern, but the existing 862-line form is much heavier — probably needs a dedicated full-page mockup before redesigning.

---

## Recommended first 3 actions

1. **Rewrite `web/coach/citations.ts` to issue Research-canonical citations.** Every other migration step is downstream of users actually seeing `/Research/` snippets when they tap "why?". This is a 1-2 hour, mechanical job — port the §-numbers from `docs/coaching-research.md` to their `/Research/` equivalents and switch `rc()` → `cite(.., 'research', '01')` etc. Removes the single largest user-facing legacy-cite debt in one PR.

2. **Add the missing Coach methods needed by the mockups, even as stubs, to unblock UI work.** Specifically: `Coach.bodySystems(state)`, `Coach.trajectory14wk(state, raceDate)`, `Coach.proofSessions(state, raceDate)`, `Coach.raceFitnessPrediction(race)`, `Coach.weekDeltas(state)`, `Coach.engineDetails(state)`. All can return placeholder values initially — the goal is to define the API surface so the new pages can be wired in parallel with engine work, not behind it.

3. **Build the Overview page against the May 9 mockup as a vertical slice.** It's the most ambitious mockup (XL) but it exercises every doctrine module and every Coach method gap. Pick this as the proving ground; the templates (edit/action/confirm/empty) and the other 5 main pages then port over with the same component library. Critically: gate the Overview rebuild on the Coach API surface from step 2, not the doctrine work — doctrine is mostly ready; the engine and UI are the bottleneck.

---

*End of report.*
