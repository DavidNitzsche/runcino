# iPhone QA + Product Experience Audit

_Session 2026-06-09. The live iPhone app is `native-v2/Faff/Faff`. Read-only audit — no edits, no builds, no data writes. The lens is two questions, asked of every screen: **(1) Does it work correctly on iPhone? (2) When a runner opens it, is he seeing what he needs?** I did not build this system._

_Companion to `DESIGN-AUDIT-REPORT.md` (2026-06-08, product+design), `IA-AUDIT-REPORT.md` (placement), and `AUDIT-FIXES.md` (landed fixes). Those are a **prior snapshot**; this report verifies their findings against the code as it stands today, with particular attention to the changes the owner says shipped in TestFlight builds 176/177/180/182/183._

**The runner — David.** Advanced, 40M. A-race **AFC Half Marathon, Sun Aug 16 2026 — 68 days out**. Goal 1:30 (B 1:37). VDOT 47.9, projection 1:34:54, gap 4:54, Goal VDOT ~50.7. Then **CIM marathon Dec 6** (goal 3:00). LTHR 162, HRmax 181, RHR 52. Readiness today **38 PULL-BACK** (HRV 29 vs 56 base, sleep 5.7h). Today: **EASY 6mi, HR cap 144**. This week: Tue tempo 8mi @7:17/HR149, Thu tempo 6.5mi @7:17, Sun long 13mi @8:00. His runs come mostly from the Apple Watch / HealthKit and are usually named "Run." His RACE-SPECIFIC phase is plan weeks 6–8 (≈ mid-July, ~5 weeks out).

---

## How to read this report

Findings use one verdict each: **BROKEN** (crashes / logic error), **WRONG** (shows incorrect data), **MISSING** (a runner need is absent), **PASS** (correct), **DECISION** (a judgment call for David), **DEAD CODE** (compiled, unreachable). Flags: 🚨 shows wrong information · ⚠️ missing something a runner needs before AFC · 💡 small change, big win.

Every `file:line` I personally opened and confirmed is marked **(verified)**. The rest are from the systematic cluster reads and are reliable to within a few lines.

---

## The headline: the prior audit is partly out of date — in both directions

**Good news that shipped since 2026-06-08 (verified):**

| Prior finding | Status now | Evidence |
|---|---|---|
| 6D · "No race-day mode anywhere" | **FIXED** | `TodayView.swift:136-154` **(verified)** — Today auto-promotes into `RaceDayView` on race morning, correctly gated (`selectedIsToday && !isDone && effort==.race && (days_to_race==0 ‖ date==today)`). |
| 7A / UI-HEALTH 1.2 · 3 Health fabrication residuals | **FIXED (all 3)** | `HealthView.swift:839-849` real `dailyReadiness`/honest zeros, no `Double.random` **(verified)**; `:601-615` baseline from real `composition.baseline`, no `score+3` **(verified)**; `:368-405` aerobic line gated on real `vo2Trend`, no hardcoded string. |
| 7E · WHAT TO DO buried 5th | **FIXED** | `HealthView.swift:206` — now the 2nd card, one scroll-stop under the gauge. |
| 8D · GOAL VDOT missing on iPhone | **FIXED** | `K_TargetsProjection.swift:455-457` — `GOAL` pill renders ~50.7. |
| TF177 · Confidence band | **WORKING** | `K_TargetsProjection.swift:406-421` — `lo – hi · WORD · descriptor`, en-dash, tier-tinted, collapses cleanly cold. |
| 8B · gap decomposition + HIT LIST | **WORKING, every status** | `K_TargetsProjection.swift:66-119, 471-516` — richer than web (web hides it off-track). |
| Recovery panel fake % grid / projection curve | **GONE** | `TodayRecoveryPanel.swift` — 3 real pillars, dead curve removed. |

**Findings the prior audit raised that are STILL OPEN, plus new ones it didn't catch — these shape the 68 days:**

1. 🚨 **Train mislabels the RACE-SPECIFIC phase as "BASE"** (new, verified) — `Theme.swift:436`.
2. 🚨 **The HR target on the pre-run card is hardcoded** and disagrees with the watch — `TodayPreRunBodyV3.swift:626-636` (verified).
3. 🚨 **The run-detail map is a fake hardcoded squiggle** for every run — `RunDetailView.swift:419-454` (verified).
4. 🚨 **Two divergent post-run experiences** — TF180 rep-ladder & TF183 work-pace-hero are **not on the iPhone run-detail path** (they were web/watch commits).
5. 🚨 **The run feed is undifferentiated** (every row "Run", no verdict) and 🚨 **the only entry to history vanishes if the plan fails to load**.
6. 🚨 **Onboarding shows fabricated import miles and a fabricated projection** to a new user.
7. ⚠️ **RaceDayView now routes but renders no gun-time / splits / logistics** — race morning is reachable but thin.
8. ⚠️ **Shoe garage is non-functional** (add is a no-op; no roles UI; no baseline-mileage field) — the "shipped" claims are false on native.
9. ⚠️ **No glossary / tap-to-explain on iPhone** (web shipped one); ⚠️ **Send-to-Watch is still invisible**.
10. ⚠️ **The purpose-on-tap explainer (PlannedView) is orphaned** — Train is still a plan lister, not an explainer.

---

# 1 · TODAY TAB

`Views/TodayView.swift` (2139 lines) + `Components/Today*` + `RootTabView.swift`. The screen David opens every morning.

---
## Today · hero composition + RACE-DAY MODE · PASS
**What's there:** `TodayView.body` (`:128-154`, **verified**) is state-driven, not positional. It first checks `raceDayRouteSlug`; if set, the **whole Today surface becomes `RaceDayView`** on race morning. Otherwise `mainBody` branches past-day → post-run → readiness-hero. Effort/color derive from the resolved `FaffEffort`.
**What's wrong:** Nothing in the routing. This directly fixes design-audit 6D.
**What's missing:** n/a
**Proposed fix:** n/a — keep.
**Priority:** PASS. **VERDICT (race-day mode just shipped): WORKING** — `TodayView.swift:136-154`. The branch is correctly gated and passes `nr.slug` from `profile.nextARace`; the `days_to_race==0 ‖ date==today` double-gate handles the Pacific-vs-local-midnight drift. (The *destination* is thin — see §6D below.)

---
## Today · readiness on a PULL-BACK day · WRONG (product)
**What's there:** On a normal day `mainBody` renders `TodayReadinessPanel` (ring + WHY strip + 6 chips), with the workout in the drag-up sheet below it.
**What's wrong:** The composition is **identical regardless of readiness** — there is no branch on `readiness.score`/`band` that changes the hierarchy (`TodayView.swift:448-469`). A readiness-38 PULL-BACK morning is structurally the same as a 90 SHARP morning. Critically, **there is no line tying readiness to how to run today** — the panel says "HRV and Sleep are dragging" (descriptive) and the sheet shows an HR cap, but nothing says "Readiness 38 — keep this 6mi genuinely easy, run by the 144 cap not pace." The two stories live on two disconnected surfaces. (The prescriptive reaction layer was deliberately gutted — but the *descriptive tie* is also absent, and that's the gap a runner feels at 5:30am.)
**What's missing:** One bridge line on a pull-back easy/recovery day.
**Proposed fix:** When `readiness.band` is pull-back/back-off and the day is easy/recovery, surface a single descriptive line near the HR-cap pill (reuse `readiness.formLine`). Descriptive, not prescriptive — no-reactive-coach safe.
**Priority:** AFC. **VERDICT (pull-back hero just shipped): PARTIAL** — the readiness hero exists but does not promote above the workout and carries no readiness→run bridge.

---
## Today · Send-to-Watch · MISSING
**What's there:** The pre-run card's only footer button is "Skip this run." The watch handoff happens silently at launch via `WatchSync.pushTodayToWatch()`.
**What's wrong:** The brief's canonical primary action has **no affordance** — no trigger, no "Sent ✓" confirmation. The bottom Start/Send CTA bar is suppressed (`TodayView.swift:513-543`, **verified**), and its supporting symbols (`startCTAButton`/`startButtonShell` at `:1805-1884`) are a dead orphan graph. A *second* dead pre-run stack (`existingPrescriptionAndConditions`, `:1040-1225`, ~185 lines) also survives.
**What's missing:** A visible "Send to Watch" CTA (→ "Sent ✓ — start on your watch").
**Proposed fix:** Restore a persistent CTA calling `pushTodayToWatch()`, reading the already-published `isWatchAppInstalled`/`lastSyncStatus`. Reconcile or delete the ~250 lines of dead Today code while you're in there.
**Priority:** AFC (the connect-to-the-watch action is invisible).

---
## Today · stat chips · PASS
**What's there:** Six chips in `TodayReadinessPanel`, all correctly sourced (no fabrication): LAST NIGHT ← `hkImporter.lastNightHours ?? readiness.sleep7Avg`; THIS WEEK ← `weekDoneMi` (sum of `done_mi`, **done not planned**, `TodayView.swift:2021/2128` — verified); VO₂ ← `profile.physiology.vo2`; BEST WINDOW ← `forecast.best_window`; TO RACE ← `days_to_race` (<14) else weeks; NEXT HARD ← first quality day after today.
**What's wrong:** Minor — `nextHardLabel` walks days strictly after today (`:1615`), so if today *is* the hard day it shows the next one. No data issue.
**What's missing:** n/a
**Proposed fix:** n/a
**Priority:** PASS.

---
## Today · drag sheet, week strip, rest day, post-run routing · PASS
**What's there:** The **drag sheet** (`DragSheet.swift`) peeks at 200pt clearing the tab bar, carries the full pre-run prescription (pre) / recap (done) — genuinely different content from the readiness hero behind it, not a repeat. The **week strip** (`WeekStrip.swift`) shows per-day effort with distinct done/skipped/rest glyphs; "this week's miles" ambiguity is resolved (planned sum is isolated to the weather context). **Rest day** renders a calm readiness hero. **Post-run routing** is clean: `isPostRunMode` → `TodayRecoveryPanel` + `TodayPostRunBody` (`TodayView.swift:435-447, 860`).
**What's wrong:** Nothing functional.
**What's missing:** n/a
**Proposed fix:** n/a
**Priority:** PASS.

---
## Today · post-run body + conditions note · PASS
**What's there:** `TodayPostRunBody` renders a server-composed `recap` (win line hidden when null — honest), stats trio that **swaps to WORK PACE for tempo/intervals** (`:311-326`), avg HR/elev/conditions, route map (only with ≥2 polyline points), and per-type HOW IT WENT. The verdict is rendered verbatim from the server (no client raw re-judging).
**What's wrong:** Nothing. The heat-adjusted **conditions note now renders inline** (`TodayPostRunBody.swift:602-621`), resolving design-audit 10A on this surface.
**What's missing:** n/a
**Proposed fix:** Drop dead `comparisonRows`/`fuelingSubtext` (latent).
**Priority:** PASS. **VERDICT (conditions note shipped): WORKING** on the Today post-run surface.

---
## Today · RootTabView · PASS
**What's there:** 5-element bar — Today · Train · **RUN** (center) · Health · **Goal** (the "Targets" tab is labeled "Goal" with a flag icon, `RootTabView.swift:35/43` — **verified**). RUN opens `RunActionMenu` (Outdoor → WatchMirror / Treadmill / Log niggle / Log non-run). Activity is route-only (`.activity`, `:201` — verified). Profile is a sheet behind the avatar.
**What's wrong:** Nothing.
**What's missing:** n/a
**Proposed fix:** n/a
**Priority:** PASS.

---

# 2 · TRAIN TAB

`Views/TrainView.swift` + `PlannedView.swift` + `WeekAheadView.swift` + `WeeklySheet.swift`.

---
## Train · RACE-SPECIFIC phase mislabels as "BASE" · 🚨 WRONG
**What's there:** Phase resolves through `TrainPhase(phaseKey:)` (`Theme.swift:432-438`, **verified**). It lowercases the server label and switches: `"quality" → .build`, everything else `TrainPhase(rawValue:) ?? .base`. Valid rawValues are `base/build/peak/taper/race`.
**What's wrong:** The plan's phase labels are `'BASE'`, `'QUALITY'`, `'RACE-SPECIFIC'`, `'TAPER'` (`web-v2/lib/plan/generate.ts:411-429` — **verified**), emitted **raw** to the iPhone (`training-state.ts:138` `phaseFor` returns `p.label`; `:242, :268` — verified). `"race-specific"` matches no rawValue and is **not aliased**, so it falls to `.base`. During David's **RACE-SPECIFIC block (plan wk6-8, ~5 weeks out)** the Train tab will render the phase word as **"BASE"**, color it base/teal, and show the **BASE phase-context copy** during his hardest, most race-specific weeks. The web is immune — it normalizes `race-specific → peak` in *two* places (`state-loader.ts:546-547`, web `TrainView.tsx phaseKey()`); only the iPhone mapper is incomplete. The `"quality"` alias proves the iPhone consumes raw labels and someone simply forgot the sibling.
**What's missing:** A `"race-specific"`/`"race_specific"` alias.
**Proposed fix:** One line — `case "race-specific", "race_specific": self = .peak` (match the web) in `Theme.swift:434`. Also centralize the duplicated phase-accent palette (`TrainView.swift:830` and `:1243`).
**Priority:** AFC. **VERDICT (quality→build mapping just shipped): WORKING for quality, but its sibling RACE-SPECIFIC is broken** — `Theme.swift:436`.

---
## Train · tapping a workout shows no purpose line · 🚨 MISSING
**What's there:** The only tappable detail on Train is the **calendar** day cell → a strip showing date + title + **"X mi"** (`TrainView.swift:1078-1090`). THIS WEEK rows aren't tappable at all; a week tap expands a dots-and-mileage peek.
**What's wrong:** **No per-session purpose or pace rationale is reachable from Train.** The "why this session / why 7:17 / what it trains" content the prior audit said was missing is *still* missing on this path. It DOES exist — richly, with Daniels/Research citations — in **`PlannedView.swift`** (WHY-THIS card `:54-65`, cited `WorkoutWhyCard` `:78-87`, `:360-382`). But `PlannedView` is **orphaned**: the only push of `FaffRoute.planned` is `WeekAheadView.swift:157`, and **nothing pushes `.weekAhead`** (**verified** — Today dropped its `.planned` route at `TodayView.swift:1424`). So the explainer is unreachable in the live app.
**What's missing:** A tap path from Train into the per-session purpose+pace+citation content.
**Proposed fix:** Wire `TrainWeekRow` and the calendar day cell to push `FaffRoute.planned(date:)`. One wire resurrects the entire (already-built) explainer layer and closes the prior audit's "lister not explainer" finding.
**Priority:** AFC. **VERDICT (purpose-line-on-tap just shipped): NOT FOUND on Train** — the content exists in PlannedView but is unreachable.

---
## Train · phase context card + QUALITY→BUILD + execution strip · PASS
**What's there:** A real **phase context card** (`TrainView.swift:248-284`) — accent bar, eyebrow "`<PHASE> PHASE · WK x–y OF n`", authored 2-3 sentence focus paragraph. **QUALITY→BUILD** mapping is correct (`Theme.swift:435`). A real **EXECUTION strip** (`:334-367`) shows actual/planned mi + completion bar (green ≥0.95 / amber ≥0.80 / red) + session ratio; for David last week it reads ~45.8/45 green.
**What's wrong:** Two nits: the phase-card copy is phase-generic (not plan-specific) and shows no target volume; the exec strip renders planned as `Int` while actual is `%.1f` (45.8 vs 45 reads as a phantom 0.4mi gap, `:1383`) and caps the bar at 100% (over-execution invisible).
**What's missing:** Phase target volume; consistent decimals.
**Proposed fix:** Use `%.1f` for both numbers; allow a slight over-fill at >100%.
**Priority:** polish. **VERDICT (phase context card just shipped): WORKING.**

---
## Train · peak week unmarked · ⚠️ MISSING
**What's there:** Weeks get a ★ if they contain quality work (`isStarWeek`, `:881`). No dedicated PEAK marker.
**What's wrong:** `TrainingPlanWeek` (`API.swift:1431-1450`) has **no `isPeak` field**, so David's wk7 (64.5mi peak) is unlabeled — the tallest volume bar is the only hint. (Confirms design-audit 2B.)
**What's missing:** A "PEAK" badge.
**Proposed fix:** Client-side `argmax(plannedMi)` → badge that row "PEAK" (no schema change). Better: engine flag.
**Priority:** CIM.

---
## Train · full plan (weeks + calendar) · PASS
**What's there:** WEEKS lens (phase-grouped, per-week volume bar, key-session label, NOW tag, expandable peek, gold RACE row) + CALENDAR lens (month grid, today ringed, **race day flagged 🏁 gold**, effort-colored capsules, legend, bounded pagination).
**What's wrong:** Nothing material.
**What's missing:** Pace-progression visualization (paces tightening week to week) — absent on both surfaces.
**Proposed fix:** Add a quality-pace progression line beside the volume ramp (CIM).
**Priority:** PASS / CIM (pace progression).

---
## Train · cold start (no plan) · 🚨 WRONG
**What's there:** With no plan, the header still renders inline fallbacks → the pill reads **"WK 1 OF 13 · 0 MI"** (`TrainView.swift:146/197`), and the cards below vanish.
**What's wrong:** That's a fabricated-looking week count (`?? 13` invents 13 weeks) with **no empty state and no "create a plan" CTA** — exactly the trap design-audit 'D' flagged, still unfixed. David has a plan so he won't hit it, but any fresh install or plan-fetch failure does.
**What's missing:** A no-plan empty state + CTA.
**Proposed fix:** Guard the body on empty weeks → render an empty-state card instead of fabricating "WK 1 OF 13 · 0 MI".
**Priority:** CIM (real, but David is insulated).

---
## Train · dead/legacy views · DEAD CODE
**What's there:** `WeekAheadView` (unreachable — nothing pushes `.weekAhead`), `WeeklySheet` (zero call sites **and** 100% hardcoded mock — "WEEK 14", "47 mi", "CIM · 184 days out", a fabricated 7-day chart; would render pure fiction if mounted).
**What's wrong:** Carrying cost + a landmine (`WeeklySheet`).
**Proposed fix:** Delete `WeeklySheet`; either wire a live entry to `WeekAheadView` (which would also restore the PlannedView path) or delete it.
**Priority:** polish.

---

# 3 · HEALTH TAB

`Views/HealthView.swift` + `Components/HealthSeed.swift` + `HealthBarCard` + `HealthMetricSheet` + `ReadinessBriefSheet`.

---
## Health · fabrication residuals · PASS (all 3 fixed)
**What's there:** All three glance-hero fabrications the prior audit flagged are gone (**verified** for a + b): the 7-DAY bars use real `dailyReadiness` else honest zeros (`:839-849`, no `Double.random`); the hero baseline line reads real `composition.baseline` with a guard (`:601-615`, no `score+3`/`−3`); the aerobic card gates on real `vo2Trend` (`:368-405`, no hardcoded "still climbing"). `HealthSeed` body tiles all gate on real data → `noDataMetric()` "—"; phantom BODY TEMP gone.
**What's wrong:** Cosmetic only — a stale doc-comment at `HealthView.swift:12` still lists "BODY TEMP"; the `sevenDay()` doc-comment at `:836` still says "synthesized" though the code does zeros.
**What's missing:** n/a
**Proposed fix:** Fix the stale comments.
**Priority:** PASS. **VERDICT (TF176 fabrication fix): WORKING — UI-HEALTH 1.2 can close.**

---
## Health · WHAT TO DO promotion + readiness breakdown + rolling avgs · PASS
**What's there:** Card order is now drivers → **WHAT TO DO** (`:206`) → 7-day bars → aerobic → STORY → recovery — WHAT TO DO is the first actionable card, one scroll from the gauge. Drivers list shows real signed deltas (HRV −18, Sleep −14, etc.). HRV 7-day / RHR 3-day rolling averages are computed server-side and labeled honestly ("· 7d avg" / "· 3d avg").
**What's wrong:** WHAT TO DO has no empty-state placeholder — it vanishes if `actions` is empty (benign; a PULL-BACK day always populates it).
**What's missing:** An empty-state line.
**Proposed fix:** Render a "keep syncing" line when actions empty.
**Priority:** PASS / polish. **VERDICT (WHAT TO DO promoted): WORKING** (`:206`).

---
## Health · recovery panel honesty · PASS
**What's there:** `recoveryPhaseCard` shows only RECOVERY PHASE eyebrow + anchor + day-of (server strings). The fake per-pillar % grid and EARLIEST QUALITY countdown are confirmed removed.
**What's wrong:** Nothing.
**What's missing:** n/a
**Proposed fix:** n/a
**Priority:** PASS.

---
## Health · no glossary / tap-to-explain · ⚠️ MISSING
**What's there:** The metric bottom sheet (`HealthMetricSheet`) gives a one-line coach explanation per metric on tap. Drivers show raw acronyms (HRV, RHR, LOAD, ACWR, HRV CV) with values.
**What's wrong:** There is **no tap-to-explain / WHY / glossary** for the terms themselves anywhere on iPhone (grep for glossary/definition/WhyButton → zero). Web shipped a `GlossaryDrawer` bottom-sheet for HRV/VDOT/ACWR/LTHR/TSB/HRmax/RHR (commit `ae5a41f4`). The iPhone runner gets bare acronyms with no recourse. This is the largest real gap on the surface.
**What's missing:** A term-definition affordance.
**Proposed fix:** Port the web glossary set; the `HealthMetricSheet` / `LearnArticleSheet` are natural hosts (see §8). Long-press a driver row → definition.
**Priority:** AFC (web parity; runner needs it).

---
## Health · ReadinessBriefSheet · PASS (discoverability nit)
**What's there:** The deepest readiness explainer in the app (92pt ring, 14-day trend, 5 tap-to-expand pillars with **per-pillar `meaning`** and confounders), honest cold-start. Reachable from **Today** (`TodayView.swift:638`), not Health.
**What's wrong:** The Health hero gauge is **not tappable** to open it — a runner on Health can't drill into the same breakdown without going back to Today.
**What's missing:** A tap target on the Health gauge.
**Proposed fix:** Make the Health hero gauge open `ReadinessBriefSheet` too.
**Priority:** 💡 polish.

---

# 4 · GOAL TAB

`Views/TargetsView.swift` + `Components/Toolkit/K_TargetsProjection.swift` + `H_Race.swift`.

---
## Goal · confidence band + GOAL VDOT + gap decomposition · PASS
**What's there:** **Confidence band** renders in correct order (`K_TargetsProjection.swift:406-421`) — `1:31:56 – 1:37:52 · MEDIUM · doable, not banked`, en-dash, tier-tinted, collapses cleanly cold. **GOAL VDOT pill** present (`:455-457`). **Gap decomposition** (Fitness/Conditions/Course/Execution + controllability tags) + **HIT LIST** of cheapest movable seconds render in **every status** including "watching" (`:66-119, 471-516`) — richer than web. Zero local race-time math (all server-derived).
**What's wrong:** Nothing in the components.
**What's missing:** `confidenceLabel.detail` is decoded but never rendered (minor).
**Proposed fix:** Optionally surface `detail` under the band.
**Priority:** PASS. **VERDICT (TF177 band + TF183 GOAL VDOT): both WORKING.**

---
## Goal · the actionable content is buried below a giant hero · ⚠️ WRONG (structure)
**What's there:** `heroBlock` order (`TargetsView.swift:219-295`): A-RACE label → **50pt race name** → 30pt days-out → **58pt goal-time hero** (`:256-263`) → THEN the projection panel (whose gap bar is itself the 4th element inside the card).
**What's wrong:** The single most useful content for a runner 68 days out — the gap decomposition + HIT LIST — is the **last block of the last card**, pushed well below the fold by ~320-360pt of oversized hero numbers the runner already knows. The 58pt goal time is decorative repetition (every projection `headlineText` branch already states the goal).
**What's missing:** Promotion of the actionable layer.
**Proposed fix:** Shrink the goal-time hero from 58pt to ~32pt (or move the projection panel directly under days-out) so the confidence band + gap bar clear the fold.
**Priority:** AFC.

---
## Goal · "+ ADD RACE" is a live no-op button · 🚨 BROKEN
**What's there:** Under the races list, "+ ADD RACE" renders via `addButton` (`TargetsView.swift:42`).
**What's wrong:** `addButton` is `Button {} label:` with an **empty action** (`:366` — verified context) — tapping does nothing. (The sibling "Set a non-race goal" button correctly opens a sheet.) A visible affordance that silently fails.
**What's missing:** A real add-race flow, or remove the button.
**Proposed fix:** Wire it to an add-race sheet or delete it.
**Priority:** CIM (dead affordance; David's races already exist).

---
## Goal · missing vs web + B-goal invisible · ⚠️ MISSING
**What's there:** Current VDOT + a single last-MOVE pill.
**What's wrong:** Missing vs web: **VDOT 6-week trend** (is he closing?), the **PATH** drift-signals/test-points narrative, **PRs anchored to goal**, the decoded-but-unrendered `raceProjections[]` equivalent times, and `confidenceInterval.method`/`pct`. Most pointedly, **the B-goal (1:37) is shown nowhere on the Goal tab** — `ProjectionSummary` carries only a single `goalSec`.
**What's missing:** B-goal tick; VDOT trend; methodology footnote.
**Proposed fix:** Thread B-goal into `ProjectionSummary` and show it beside the A-goal; add a VDOT-trend pill; render `confidenceInterval.method`/`pct` as a footnote; surface `raceProjections` as an equivalent-times strip (data is already on the wire).
**Priority:** B-goal = AFC (a stated race goal he can't see); rest = CIM.

---
## Goal · race-day routing note + dead code · PASS / cleanup
**What's there:** `RaceDayView` now has **three** callers, not one: `TargetsView.swift:300` (tap any race row), `RootTabView.swift:195` (route), and **`TodayView.swift:137`** (race-morning takeover). The prior audit's "only caller is TargetsView:300" is now false. `goalTile` dead code does **not exist** (grep → zero; the prior line number drifted). `WithinReachSheet` has **no caller** and is fully hardcoded (5K/"20:24") — effectively dead.
**Proposed fix:** Remove `WithinReachSheet` (or wire it intentionally).
**Priority:** PASS / polish.

---

# 5 · ACTIVITY / RUN CENTER TAB

`Components/RunActionMenu.swift` + `Views/ActivityView.swift`.

---
## RUN center button · PASS
**What's there:** `RunActionMenu` opens a clean action sheet — Outdoor / Treadmill / Log niggle / Log non-run, dismiss-then-fire on a 0.15s delay.
**What's wrong:** Nothing functional. (There's no phone-only GPS outdoor start — "Outdoor" mirrors the watch — consistent with the watch-first doctrine.)
**What's missing:** n/a
**Proposed fix:** n/a
**Priority:** PASS.

---
## Activity · history entry vanishes if the plan fails to load · 🚨 BROKEN
**What's there:** "ALL RUNS ›" is a `NavigationLink(value: .activity)` in the THIS WEEK header (`TodayView.swift:284`), the intended primary entry (Activity is not a tab).
**What's wrong:** That entire header is nested inside `if let week = plan {` (`TodayView.swift:268` — **verified**). If `/api/plan` blips or the runner has no plan, **the only path to run history disappears.** A network hiccup = unreachable history.
**What's missing:** A plan-independent entry.
**Proposed fix:** Hoist the THIS WEEK / ALL RUNS header out of the `if let week = plan` block (one-line scope).
**Priority:** AFC. **VERDICT (TF176 ALL RUNS entry): WORKING but fragile** — present, but gated behind plan load.

---
## Activity · run feed is undifferentiated · 🚨 WRONG
**What's there:** Each row (`ActivityView.swift:542-601`) = date · source glyph · **`run.name`** · pace/time/effort-title · distance.
**What's wrong:** `run.name` defaults to **"Run"** (`Runs.swift:165`) and all David's watch runs are literally "Run" — so the feed is a column of identical "Run." The only differentiator is `effort.title`, but `FaffEffort.fromType` has `default: .easy` (`Theme.swift:256`), so any run the backend didn't classify (watch runs with no `workoutType`) collapses to "Easy" (wrong word, wrong color). **There is no verdict/outcome badge at all** — the feed can't answer "which of these went well." (Confirms design-audit 5C.)
**What's missing:** A type-derived label and a per-run verdict chip.
**Proposed fix:** Render `effort.title.uppercased()` when `name` is empty/"Run"; add a small outcome chip from the recap `win`.
**Priority:** AFC (the feed is the runner's history and reads as noise).

---
## Activity · no efficiency trend + no empty state · ⚠️ MISSING / polish
**What's there:** STATS shows mileage hero, totals, PRs, 18-week volume heatmap.
**What's wrong:** No **pace-at-HR efficiency trend** ("am I getting fitter" — the #1 competitive-runner signal) anywhere (design-audit 5B). No empty-state UI for a new user (no crash risk — Swift `.max(by:)` is Optional-safe, guards present).
**What's missing:** An efficiency tile; a "no runs yet" block.
**Proposed fix:** Add a pace-at-fixed-HR trend to STATS (needs a backend trend endpoint); add an empty-state block.
**Priority:** CIM (efficiency); polish (empty state).

---

# 6 · RUN DETAIL

`Views/RunDetailView.swift` (live path) + `Components/HowItWentPanel.swift` (Today-only) + `Components/Toolkit/I_RunDetail.swift`. **Note `CompletedView.swift` is dead-but-routable** with stale demo data ("Reseda loop", `ReadinessRing(82)`) — never construct `.completed`.

---
## Run detail · two divergent post-run experiences · 🚨 MISSING (the structural finding)
**What's there:** There are **two completely different post-run surfaces with no shared analysis layer.** **Today's** completed sheet gets the rich per-type `HowItWentPanel` — THE REPS rep ladder, THE TEMPO work-pace block, AEROBIC STAMP, THE LONG thirds. The **Activity → `RunDetailView`** path (every run older than today) gets a generic stack: hero (3 stats) → HOW IT WENT text → mile bars → phase list → trace → zones.
**What's wrong:** The TF claims attributed to run-detail were **web/watch commits, not native**: TF183 work-pace-hero (`080c7e7c`) touched only `web-v2`; TF180 rep-ladder (`d492023f`) touched only the **watch** SummaryView. On the iPhone Activity path, the run-detail hero's third stat is **blended avg pace** (`RunDetailView.swift:318→539`) even for a tempo or 5×1mi — work pace is demoted to a "WORK SEGMENTS" tile far down — and **there is no rep ladder** (the richer `PhaseBreakdownList` in `I_RunDetail.swift:20-109` is dead). So a runner reviewing any past quality session sees a lie at the top and no per-rep breakdown.
**What's missing:** The per-type analysis on the Activity path.
**Proposed fix:** Mount `HowItWentPanel` (keyed on effort) inside `RunDetailView`. This single change gives work-pace-hero + rep-ladder to every run and closes both TF claims at once on iPhone.
**Priority:** AFC. **VERDICT (TF183 work-pace hero / TF180 rep ladder on iPhone run detail): NOT FOUND** — present on Today only; the Activity run-detail path is generic.

---
## Run detail · the route map is a fake squiggle · 🚨 WRONG
**What's there:** Every run with `has_route` renders `routePanel` (`RunDetailView.swift:419-454` — **verified**): a **fixed, hardcoded `Path`** Bézier squiggle with a static "START / FINISH" marker.
**What's wrong:** It ignores the real `route_polyline` on the wire (`Runs.swift:214`) and draws the **same decorative shape for every run.** A competitive runner will immediately see the map isn't his route. (The section's *gating* was fixed to `has_route`; the panel it gates was never replaced.)
**What's missing:** The actual GPS polyline.
**Proposed fix:** Render `route_polyline` (decode + scale to the frame) instead of the hardcoded `Path`.
**Priority:** AFC.

---
## Run detail · mile splits + conditions note · PASS
**What's there:** MILE SPLITS render whenever `!splitBars.isEmpty` with **no per-type gating** (`RunDetailView.swift:93-105`) — so easy runs show splits. The CONDITIONS note renders from `recap.conditions_note` (`:74-79`).
**What's wrong:** Splits depend on the run actually carrying `splits` (a known watch-vs-HK pipeline churn); silent when absent — a data risk, not a UI gate.
**What's missing:** n/a
**Proposed fix:** n/a (UI correct).
**Priority:** PASS. **VERDICT (TF183 easy-splits gate removed): WORKING** (native was never type-gated); **(conditions note): WORKING.**

---
## Run detail · per-type completeness · ⚠️ generic across types
**What's there:** Same section stack regardless of type, gated only on data presence.
**What's wrong:** Per type: **easy** has no Z1/Z2-share readout or HR-drift (the KEPT-IT-EASY gauge is Today-only); **tempo** shows blended hero not work pace; **intervals** show a flat mile-bar chart, no rep ladder; **long** has no thirds / negative-split call-out (Today's `ThePLongPanel` has it). Plus the fake route map above.
**What's missing:** Type-aware depth (solved by mounting `HowItWentPanel`).
**Proposed fix:** As above.
**Priority:** AFC (folds into the HowItWentPanel mount).

---

# 7 · SETTINGS / PROFILE / SHOES

`Views/ProfileView.swift` (live, behind avatar) + `Views/SettingsView.swift` (buried) + `Views/ShoesView.swift` + `Components/Toolkit/G_Settings.swift`. **ProfileView and SettingsView overlap and disagree** — two settings screens, two different notification UIs, one of them inert (below).

---
## Shoes · garage is non-functional · 🚨 BROKEN / MISSING
**What's there:** `ShoesView` lists in-rotation + retired shoes with mileage and life bars; role is a single tag **inferred client-side from the shoe's name string** (`inferRole`, `:172-179`).
**What's wrong:** **"+ ADD A SHOE" is an explicit no-op** (`ShoesView.swift:125-127` "Add-shoe flow not wired in v3 yet · placeholder"). There is **no multi-select roles UI** — the iPhone `Shoe` model (`Runs.swift:350-362`) decodes neither `run_types` (the backend's multi-role array) nor `baseline_mi`, though `web-v2/app/api/shoe/route.ts` fully supports both. Mileage is real but systematically low (watch/HK runs never get a shoe; no auto-assign on iPhone).
**What's missing:** Add-shoe, role chips, baseline-mileage entry, mileage-on-read for watch runs.
**Proposed fix:** Add `run_types: [String]?` + `baseline_mi` to the `Shoe` model; wire "+ ADD A SHOE" → `POST /api/shoe`; render `run_types` instead of name-matching; add role multi-select.
**Priority:** AFC (a claimed-shipped core feature that is absent). **VERDICT (multi-select roles / auto-assign just shipped): NOT FOUND on iPhone.**

---
## Profile · baseline weekly mileage field · 🚨 MISSING
**What's there:** `ProfileFields` carries lthr/maxhr/rhr/height/gender/experience.
**What's wrong:** There is **no baseline weekly-mileage field** in Profile or Settings (grep for weekly_mileage/weeklyMileage/target_volume → only HR/HRV "baseline" structs). The "16-A baseline mileage shipped" claim is **false for native-v2**. (`baseline_mi` exists on the *shoe* record — a different concept.)
**What's missing:** A baseline weekly-mileage input the coach can calibrate against.
**Proposed fix:** Add a "Baseline weekly mileage" row → PATCH profile (confirm the backend field name).
**Priority:** AFC (claimed-shipped, absent). **VERDICT (16-A baseline mileage just shipped): NOT FOUND on iPhone.**

---
## Profile · LTHR/HRmax/VDOT have no WHY / glossary · 🚨 MISSING
**What's there:** PHYSIOLOGY shows LTHR 162 / MAX HR 181 / VDOT 47 as `StatTile`s with a `ProvenanceLine` under each ("from your recent race PR", etc.).
**What's wrong:** **No tap-to-explain on any term** — and `StatTile` *has* the affordance built in (`explainText`/`onExplain` → a "What is this? ›" button, `B_Provenance.swift:79-112`), ProfileView just doesn't pass it (`:213-215`). Web shipped a real `GlossaryDrawer`; iPhone has nothing. The decoded HR-zone table (`ProfileZoneTable`) is **never rendered** (web shows it).
**What's missing:** Tap-to-explain + the Z1–Z5 table.
**Proposed fix:** Wire `StatTile(onExplain:)` to a glossary sheet mirroring the web `GLOSSARY` (HRV/VDOT/LTHR/HRmax/RHR/ACWR/TSB); render the `zones` table.
**Priority:** AFC (glossary parity); CIM (zone table).

---
## Profile/Settings · overlap, fake-editable rows, hardcoded Pro state · ⚠️ WRONG
**What's there:** Two settings surfaces. ProfileView has the real 7-category `NotificationPrefsList`. SettingsView has a **different, hardcoded 4-toggle notifications block** that never loads from or saves to the server.
**What's wrong:** (1) Editing notifications in SettingsView **persists nothing**; the two UIs contradict. (2) ProfileView's "Daily briefing / Long run day / Rest day" rows show hardcoded values ("07:00"/"Saturday"/"Monday") with empty `onTap` closures (`:260-281`) — they look editable, do nothing, and may display values that don't match reality. (3) **Strava reconnect has no action on ProfileView** (the most-discoverable screen) — the working OAuth flow is only in the buried SettingsView. (4) **"Faff Pro · Active" is hardcoded for every user** (`ProfileView.swift:459`), then taps into an upsell that contradicts it.
**What's missing:** Real persistence; a reconnect action on Profile; a truthful Pro state.
**Proposed fix:** Consolidate to one settings surface; remove or wire the placeholder rows; make Profile's Strava row tap through to `StravaOAuthSession`; drive the Pro label off real entitlement.
**Priority:** AFC for removing the fake-editable rows + the Profile Strava reconnect; CIM for consolidation.

---
## Run launchers · WatchMirror lies about "live"; Treadmill solid · ⚠️ WRONG / PASS
**What's there:** `TreadmillView` is the most complete run surface — real timer, segment derivation, live HR via `TreadmillHRStreamer`, real `POST /complete` with `source:"treadmill"`. `WatchMirrorView` shows a planned-workout hero with a "FOLLOWING APPLE WATCH · MIRRORED" pill + green live dot.
**What's wrong:** `WatchMirrorView` **does not mirror a live run** — it fetches the *planned* workout once and shows static details; `liveOk` is hardcoded `true`. The "MIRRORED" pill and pulse dot promise a live feed that isn't happening, and ~160 lines of dead fake-data views (fake "6:48/mi", "TO FINISH 10.0mi") remain compiled. Treadmill depends on a backend honoring `source:"treadmill"`/`indoor:true` — confirm that brief landed or treadmill runs mis-ingest.
**What's missing:** Either a real live feed or honest copy.
**Proposed fix:** Change the WatchMirror pill to "TODAY'S PLAN · START ON YOUR WATCH" (or implement a real feed); delete the dead views; confirm the treadmill backend wire is deployed.
**Priority:** AFC (the label misrepresents what the screen does + verify treadmill ingest); polish (dead code).

---

# 8 · SLIDE PANELS AND SHEETS

`Views/*Sheet.swift` + `Components/Toolkit/A–J`. The owner's question: do they add value or just repeat the main screen — and is anything buried that shouldn't be?

---
## NudgeSheet · the readiness drill-down is unreachable · 🚨 BROKEN
**What's there:** A Morning Check readiness sheet (ring + WHY rows decomposing the score into sleep/HRV/RHR contributions). Coach-voice clean, reactive accept/decline removed.
**What's wrong:** It's mounted on `$showNudge` (`TodayView.swift:595`) but **`showNudge` is never set true anywhere** (grep → zero). The bell opens the *inbox*, not this. So at readiness 38, with the red pip showing, the runner **cannot open the why-rows that justify the score.**
**What's missing:** A trigger.
**Proposed fix:** Wire the readiness ring/pip tap to `showNudge = true` (or delete the orphan — but it's genuinely additive, so wire it).
**Priority:** AFC.

---
## Sheets · ReturnGateCard missing leaves "sick" a one-way trap · ⚠️ MISSING
**What's there:** `SymptomReportSheet` (log niggle/sick) and `LogNonRunSheet` are live and post to real endpoints. `NewGoalSheet` is live.
**What's wrong:** `ReturnGateCard` (the "ready to run again?" return-from-sick gate) is **dead** (no call site), though `/api/sick/recovery` exists. Logging "sick" pauses the plan with **no mounted UI to resume** — a one-way pause.
**What's missing:** A mount for `ReturnGateCard` in the sick/paused state.
**Proposed fix:** Mount `ReturnGateCard` on Today when the plan is paused for illness.
**Priority:** AFC (a pause with no resume is a trap).

---
## LearnArticleSheet · the cheapest home for the missing glossary · PASS / AFC opportunity
**What's there:** A real education reader (eyebrow → body → citations → related links) from `/api/learn/[slug]`, reachable from `WorkoutWhyCard` on PlannedView — but PlannedView is orphaned (§2), so in practice the reader has **almost no live door**, and its browse layer `ArticleIndexCard` is dead.
**What's wrong:** Narrow reachability; the ~41 non-workout articles are undiscoverable.
**What's missing:** A browse/index entry + glossary term articles.
**Proposed fix:** Mount `ArticleIndexCard` (Health or Profile) and wire glossary terms (HRV/VDOT/ACWR/TSB) as `.learn(slug:)` deep links. This is the cheapest way to close the glossary gap (§3, §7) — the reader infra already exists.
**Priority:** AFC (closes the glossary hole).

---
## PRSheet · hardcoded race result — never wire as-is · 🚨 DEAD CODE
**What's there:** A polished PR-celebration full-screen sheet.
**What's wrong:** Zero call sites, and **every value is hardcoded** ("1:29:48", "first sub-1:30", "CIM's sub-3 is right on track"). If revived as-is it would display a **fabricated race result** — a direct violation of the locked race-data source-of-truth rule, and stale (references CIM, not AFC).
**What's missing:** Real data wiring + a post-race trigger.
**Proposed fix:** Do not mount as-is. Rebuild to take a real `races.actual_result` model and fire from the (not-yet-built) race-retro flow. The *concept* is valuable (it's the missing post-race moment) — the implementation is a mockup.
**Priority:** CIM (concept); flag now (must never ship hardcoded).

---
## Built-but-dark high-value signals · ⚠️ MISSING (inventory)
**What's there:** Several genuinely useful components are built and unmounted: `LoadBandChip` (ACWR band — the only ACWR visualization, dark), `WorkSegmentRow` (work-only pace/HR for intervals), `FormMetricsGrid` (8 form metrics already decoded on `RunDetail.form`), `StateChangeToast` (the "your paces moved" notice after a race recalculates VDOT — the closed-loop signal).
**Proposed fix:** Mount `LoadBandChip` (Train/Health), `WorkSegmentRow` + `FormMetricsGrid` (RunDetail), and fire `StateChangeToast` on post-race VDOT/LTHR change.
**Priority:** CIM (LoadBandChip/WorkSegmentRow lean AFC if the run-detail mount happens anyway).

---
## Other sheets · PASS / cleanup
**What's there:** `NotificationInboxSheet` works (minor: subtitle promises "tap to ack" but rows are display-only; timestamp parsing has the known node-pg TZ fragility). `BriefingTopicCard` is solid (live on Today). `DailyCheckChip` (niggle daily check) is live and honest. `SymptomReportSheet`/`LogNonRunSheet`/`NewGoalSheet` all work.
**Dead code (no live call site):** `StravaPushHistorySheet`, `UsageSheet` (both intentionally retired 2026-06-02), `PRSheet`, `EffortDot`, `DayStatePill`, `ConditionsLine`, `WatchPreviewTimeline`, `ProfileGapCard`, `ConnectASourceBanner`, `CitationChip`, `CitationRow`, `PostRunCheckinChips`, `TodayShoeOverrideSheet`, `CompletedView`, `WeekAheadView`, `WeeklySheet`, `SpectatorView`, `PaywallView` + the dead Today/WatchMirror blocks.
**Priority:** polish (cleanup); see Decisions for the reactive-coach residue.

---

# 9 · ONBOARDING / COLD START

`FaffApp.swift` (launch gate) + `Views/Onboarding/ColdStart/SignIn/RolePick/Paywall/Pro/Spectator`.

---
## Onboarding · fabricated import + projection shown to a new user · 🚨 WRONG
**What's there:** A 4-step flow (welcome → connect → target → projection) that POSTs `/api/onboarding/complete`.
**What's wrong:** The "connect" sources carry **hardcoded fake history** — Apple Health "642 mi / 78 runs", Strava "**1184 mi / 142 runs**", Garmin "980 mi / 120 runs" (`OnboardingView.swift:163-170`). Tapping a source does **not** request HealthKit auth or start Strava OAuth — it only inserts a string into a Set (`:222-226`) — yet the UI then shows **"1184 mi · 142 RUNS · SINCE 2024 · DUPLICATES REMOVED"** as if a real import happened. The projection panel shows a **hardcoded** "PROJECTED TODAY 4:15:00 · modeled from your imported history" (`:584-591, :496-504`) for a user who imported nothing. There's also **no race-date picker** (race hardcoded to today+112d) and **no profile collection** (age/weight/sex/RHR/HRmax — the coach's keystone inputs are never asked).
**What's missing:** Real connect actions; honest empty/real import counts; a date picker; profile fields.
**Proposed fix:** Replace the hardcoded source rows with real HealthKit-auth / Strava-OAuth triggers showing real (or honestly empty) counts; remove or honestly label the projection until data exists; add a race-date picker + basic profile fields.
**Priority:** AFC (fabrication shown as real to every new user).

---
## Cold start · the real "start here" state is dead code · ⚠️ MISSING
**What's there:** `ColdStartView` is a genuinely good no-data empty state ("NOTHING TO SHOW YET · BY DESIGN", "3–5 RUNS TO YOUR FIRST READINESS SCORE").
**What's wrong:** It's **mounted nowhere** (zero call sites), and its two CTAs are stubbed. So a real new runner gets the fabricated onboarding above, then lands on empty tabs with no guidance — there is no "start here" thread.
**What's missing:** Mount it (or its pattern) on the empty Today/Activity/Health states with working CTAs.
**Proposed fix:** Wire `ColdStartView` into the no-data tab states; hook its buttons to the RUN menu + connect flow.
**Priority:** AFC (this is the missing onboarding thread; cheap — the view exists).

---
## RolePick · a choice that does nothing · ⚠️ DECISION
**What's there:** A Runner-vs-Spectator picker in the launch gate.
**What's wrong:** **The picked role is discarded** (`FaffApp.swift:211` `onPick: { _ in advance(.onboarding) }`); both choices route to the runner onboarding, and `SpectatorView` (fully hardcoded "Mile 18.2", "David", "CIM") is never mounted. It adds a step that sets a false expectation in the first 30 seconds.
**What's missing:** Either honor the role or drop the step.
**Proposed fix:** Drop RolePick from the gate until the spectator product exists.
**Priority:** AFC (confusing dead step in cold start).

---
## Auth + paywall · PASS / cleanup
**What's there:** Apple + email both mint real tokens (`SignInWithAppleView.swift:50-62`); sign-out exists. No crashes / no force-unwraps in the cluster.
**What's wrong:** Auth isn't enforced as a gate (deliberate beta choice). Apple sign-in always re-walks onboarding (doesn't thread the redirect). Terms/Privacy links are visual-only (App-Store-review risk). **Two divergent paywalls** (`PaywallView` $8.99 / `ProView` $9.99) are both unwired StoreKit stubs, neither pushed.
**Proposed fix:** Thread the Apple redirect; wire Terms/Privacy before submission; pick one paywall, delete the other, before monetizing.
**Priority:** CIM (no monetization gating today); Terms/Privacy = AFC *if* submitting to review.

---

# 10 · OVERALL INFORMATION FLOW

---
## Morning (wake-up) · PASS, with the §1 gaps
Today is the right wake-up surface and mostly does its job — readiness gauge + verdict, then the EASY 6mi. The dilution is the §1 set: no readiness→run bridge on a pull-back day, Send-to-Watch invisible, HR cap shown wrong on the card.

## Pre-run · ⚠️ WRONG
The card is execution-complete *except* the HR target is hardcoded and disagrees with the watch (§1 / TodayPreRunBodyV3:626-636). For a tempo it says "160-168 · Z4" when David's prescription is HR149 — it would push him too hard. **VERDICT:** the defining pre-run action (Send-to-Watch) has no button; the HR number is wrong.

## During run · (watch — out of iPhone scope)
Covered in the design audit (tempo misroutes to EasyFace; easy/long HR shows bare bpm). Not re-litigated here.

## Post-run · split, and honest-on-Today only
Today's recap is honest and rich (server verdict, conditions note, per-type panels). But the *same run reviewed later from Activity* gets a generic detail with a blended-pace hero and a **fake route map** — the depth doesn't survive the trip to history (§6).

## Evening / weekly · PASS-ish
The recovery panel gives an honest evening read. Weekly understanding lives on Train's EXECUTION strip (good) — but "am I getting fitter" has no home (no efficiency trend, §5).

## First week (new user) · 🚨 the weakest journey
Fabricated onboarding (§9) → dead cold-start guidance (§9) → empty tabs → undefined jargon (§3/§7). A new runner is shown fake mileage and a fake projection, then given no thread to real data. **VERDICT:** the cold-start path works mechanically (no crashes) but is built on fabrication and dead "start here" code.

## The cross-surface trust issue (carried from design-audit 10C)
The same metric can read differently across tabs (readiness live ~44 vs stored 38; goal status). That's a server/architecture fix (one canonical read per metric), not an iPhone-only bug, but it lands on the iPhone runner as "which number do I believe." Flagged here for completeness; the fix is the B2/B4 consolidation in the prior reports.

---

# PRIORITY LIST

## Must fix before AFC (Aug 16) — 68 days

| # | Finding | File | Fix size |
|---|---|---|---|
| 1 | 🚨 **RACE-SPECIFIC phase mislabels as "BASE"** (wrong word/color/coaching wk6-8) | `Theme.swift:436` | 1 line |
| 2 | 🚨 **Pre-run HR target hardcoded**, disagrees with watch (tempo "160-168" vs real 149; easy "<140" vs cap 144) | `TodayPreRunBodyV3.swift:626-636` | ~2-3h |
| 3 | 🚨 **Run-detail map is a fake hardcoded squiggle** for every run | `RunDetailView.swift:419-454` | ~0.5d |
| 4 | 🚨 **Activity run-detail is generic** — no work-pace hero, no rep ladder (TF180/183 are web/watch-only) | mount `HowItWentPanel` in `RunDetailView` | ~1d |
| 5 | 🚨 **Run feed undifferentiated** (every row "Run", no verdict, default→Easy) | `ActivityView.swift:542-601` | ~0.5d |
| 6 | 🚨 **History entry vanishes if plan fails to load** | `TodayView.swift:268` | 1 line |
| 7 | 🚨 **Onboarding shows fabricated import + projection**; never really connects; no race-date/profile | `OnboardingView.swift:163-170, 496-591` | ~1-2d |
| 8 | 🚨 **Shoe garage non-functional** (add no-op; no roles UI; model drops `run_types`/`baseline_mi`) | `ShoesView.swift:125`, `Runs.swift:350-362` | ~1d |
| 9 | 🚨 **Baseline weekly-mileage field absent** (16-A not on native) | ProfileView/SettingsView | ~0.5d |
| 10 | 🚨 **No glossary/tap-to-explain** (LTHR/HRmax/VDOT/HRV/ACWR bare) — wire `StatTile.onExplain` + mount `ArticleIndexCard`/`LearnArticleSheet` | ProfileView/HealthView | ~1d |
| 11 | ⚠️ **RaceDayView renders no gun-time/countdown, no goal splits, no logistics**; fuel vanishes w/o `gelsMi` | `RaceDayView.swift` | ~1d |
| 12 | ⚠️ **Send-to-Watch CTA invisible** (suppressed; silent auto-push) | `TodayView.swift:513-543` | ~0.5d |
| 13 | ⚠️ **Purpose-on-tap missing on Train** — wire `FaffRoute.planned` to resurrect the orphaned explainer | `TrainView` → `PlannedView` | ~0.5d |
| 14 | ⚠️ **NudgeSheet readiness drill-down unreachable** (`showNudge` never set) | `TodayView.swift:595` | ~1h |
| 15 | ⚠️ **"Sick" is a one-way trap** — mount `ReturnGateCard` to resume | Today (paused state) | ~0.5d |
| 16 | ⚠️ **WatchMirror falsely labels a static plan as a live "MIRRORED" feed** | `WatchMirrorView.swift` | ~1h (copy) |
| 17 | ⚠️ **ColdStartView dead** — mount the only real "start here" guidance | empty tab states | ~0.5d |
| 18 | ⚠️ **RolePick is a no-op step** + readiness-on-a-pull-back-day has no bridge line | `FaffApp.swift:211`; `TodayView` | ~0.5d |
| 19 | ⚠️ **B-goal (1:37) shown nowhere on Goal**; goal-time hero buries the gap decomposition | `ProjectionSummary`; `TargetsView.swift:256` | ~0.5d |
| 20 | ⚠️ **Fake-editable Profile rows + Profile Strava has no reconnect action + "Pro · Active" hardcoded** | `ProfileView.swift:260-281, 432, 459` | ~0.5d |
| — | ⚠️ Verify **treadmill backend wire** (`source:"treadmill"`) is deployed or runs mis-ingest | confirm web-v2 | check |

## Should fix before CIM (Dec 6)

- **Mount the built-but-dark signals:** `LoadBandChip` (ACWR), `WorkSegmentRow` + `FormMetricsGrid` (RunDetail), `StateChangeToast` (post-race VDOT bump — the AFC→CIM closed loop).
- **Efficiency trend** on Activity ("am I getting fitter" — pace at fixed HR over 8-12 wk). Needs a backend endpoint.
- **Mark the peak week** (wk7 64.5mi) + add a **pace-progression** view on Train.
- **PRSheet / post-race retro** rebuilt against `races.actual_result` (never hardcoded) — the AFC result-capture moment.
- **Train cold-start** empty state + create-plan CTA (replace "WK 1 OF 13 · 0 MI").
- **Goal tab depth:** VDOT 6-week trend, methodology footnote, `raceProjections` equivalent-times strip, "+ ADD RACE" wired or removed.
- **HR zone table** on Profile; **WHAT TO DO** empty-state on Health; Health gauge → ReadinessBriefSheet.
- **Consolidate ProfileView/SettingsView** into one settings surface (kill the inert SettingsView notification toggles).
- **Apple sign-in** redirect threading; **Terms/Privacy** links before App Store submission; pick one paywall.

## Polish / nice to have

- Delete the dead-code inventory (§8) — `WeeklySheet`, `CompletedView`, `WatchMirror` fake views, `SpectatorView`, the ~250 lines of dead Today CTA/prescription stacks, retired sheets.
- Fix stale comments (`HealthView.swift:12` BODY TEMP; `:836` "synthesized").
- Exec-strip decimals + over-execution signal; `NotificationInboxSheet` "tap to ack" copy; phase-accent palette de-dup; SPO₂ next to RESP on Health.
- **Decision for David — RPEEntryCard:** `RPEEntryCard` ("how hard did that feel?", Borg CR10) is **still mounted** on `RunDetailView.swift:209`. It doesn't prescribe and doesn't drive coach advice, but it is a subjective feeling-capture of the kind the no-reactive-coach gut targeted. Keep it (neutral logging) or remove it? `PostRunCheckinChips` (the gutted "Nailed it/Solid/Survived" + body-check pattern) is correctly dead — delete it to match the gutting.

---

## One-paragraph close

The race-morning hole is closed — Today now genuinely takes the page on race day (`TodayView.swift:136-154`), and the Health fabrication the prior audit chased is gone. What remains splits cleanly: a short list of **wrong numbers a runner will act on** — the phase mislabel, the hardcoded HR target, the fake route map, the undifferentiated feed — and a longer list of **depth that exists but doesn't reach the runner** — the orphaned plan explainer, the rich run analysis stranded on Today, the dead cold-start guidance, the glossary the web has and the phone doesn't. The single most damaging thing for a competitive runner is #2 and #3 together: on a tempo the app tells him to run at the wrong heart rate, and when he reviews the run it shows him a map that isn't his. Fix the numbers first, then connect the depth that's already built — most of the AFC list is wiring, not new construction. And on the morning of August 16, the app already won't show David a Tuesday; make sure it shows him his gun time, his splits, and his fuel.
