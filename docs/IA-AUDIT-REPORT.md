# Information Architecture Audit

_Session start 2026-06-08. Read-only product-IA lens, not visual design, not a bug hunt. The question this report answers: when a competitive marathoner opens the app, what does he need to see, when, and where? Companion to `DESIGN-AUDIT-REPORT.md` (visual + product), `UI-HEALTH-REPORT.md` (correctness), and `AUDIT-FIXES.md` (landed fixes). Where those reports already filed a finding, this one reframes it as a question of placement and order, and does not re-litigate the bug._

**The runner:** David. Advanced, 40M. AFC Half Marathon, Sun Aug 16 2026, **69 days out** today. Goal 1:30 (B 1:37). VDOT 47.9, projection 1:34:54, **gap 4:54**. Readiness today 38 PULL-BACK. Today's session: EASY 6mi, HR cap 144. Then CIM marathon Dec 6 (goal 3:00). The next 69 days are a peak-and-race block followed immediately by a marathon build, so the app has to do two jobs well: get him to the AFC start line sharp, and capture AFC's result so it seeds CIM.

**The three surfaces** (from `APP_FEATURE_SPEC.md:17-23`, confirmed in code):

| Surface | Intended job | Where the runner is |
|---|---|---|
| **Web** (`Shell.tsx`) | Planning, analysis, deep history, the command center | Sitting down to think |
| **iPhone** (`RootTabView.swift`) | Daily check-in, quick capture, race-day mode, watch companion | Living day to day |
| **Watch** (`FaffWatch`) | Workout execution, real-time guidance | Where the run happens |

Information density follows the device: web is the most expansive, the watch the most reductive. That gradient is mostly correct today. The problems are not the gradient, they are **(1) what is the hero on each surface, (2) where the most-actionable content lives, and (3) which surface owns which question.**

**The tab bars are not the same.** This matters for everything below:

- **iPhone** = `Today · Train · [RUN] · Health · Targets`. RUN is **not a page**: it is a center action button that opens a popover (`RootTabView.swift:115-122, 254-270` -> Outdoor / Treadmill / Log niggle / Log non-run). Activity is **retired from the bar**, reachable only as a deep-link route (`RootTabView.swift:201`). Profile is a sheet behind the avatar (`RootTabView.swift:142`).
- **Web** = `Today · Train · Health · Targets(=/races) · Activity(=/log) · Profile` in the sidebar (`Shell.tsx:25-43`). No RUN action (the web does not start runs). Activity **is** a primary surface here.

So "the 5 tabs" is the iPhone bar, and one of the five (RUN) is a launcher, not a destination. Hold that thought for Section B.

---

# Part 1. The surfaces, one at a time

For each: **(1) the job in one sentence, (2) is the content doing the job, (3) what moves, is added, or is cut.**

## TODAY

**Job:** "What do I run today, am I ready for it, and how does today fit the arc to race day." The product spec sets the bar at a 5-second read (`APP_FEATURE_SPEC.md:94`).

**Is it doing the job?** Partly, and **web and iPhone disagree on the hero**, which is the core finding.

- **Web** (`TodayView.tsx`): the workout hero is the centerpiece (`PlannedHeroV2` at `:557`, `CompletedHeroV2` at `:537`, rest panel at `:597`). Readiness is a 56px ring chip, top-right (`:159-197`). At the bottom, a 4-tile grid (`Tiles` at `:678`, def `:4209`): THE GAP, RACE DAY, WEEKLY VOLUME, TRAINING FORM.
- **iPhone** (`TodayView.swift`): the **readiness panel is the fixed hero** (`TodayReadinessPanel` at `:417-439`), and the **workout card is in a drag-up sheet** (200pt peek, `:457-478`; content is `TodayPreRunBodyV3`). So on iPhone the body-state leads and the prescription is one gesture down. On web it is the reverse.

Neither is wrong in the abstract, but they should not contradict each other, and **neither adapts to the day**. Today is a textbook case: readiness 38 PULL-BACK (the news) plus a near-zero-stakes EASY 6mi (not the news). The web buries the real story in a top-right chip; the iPhone leads with it but then makes the runner drag to see the (trivial) workout. The design brief's "the page is alive" rule says the hero is contextual, not positional, and names "recovery score" as a valid composite hero (cross-ref `DESIGN-AUDIT-REPORT.md` 1A). The right behavior is **state-driven and identical across web and iPhone**: on a quality day the workout is hero; on a low-readiness easy/rest day the readiness is hero; on race day the race is hero.

The biggest single miss is **race day**. Aug 16's plan row is `type=race` (DB-confirmed). On race morning both surfaces feed it to the generic workout hero. `grep` finds no race-day branch in either `TodayView` (cross-ref design 1B/6D). `RaceDayView.swift` exists but its only caller is `TargetsView.swift:300`. The most important morning of the block renders like a Tuesday.

**What moves / adds / cuts:**

- **CUT from Today** the standalone **TRAINING FORM tile** (`TodayView.tsx:4302-4360`) and **THE GAP tile** as a separate card (`:4218-4267`). These are season/Targets content (TSB and VDOT-projection), not "today." Keep their *signal* but fold it (see below). Note the inconsistency they create: web shows TRAINING FORM on Today, iPhone shows it nowhere (`UI-HEALTH 8.3`). Resolve by giving it one home, not zero-or-two.
- **MERGE** GAP + RACE DAY into **one race strip** on Today: countdown is the hero number, projection-vs-goal is the sub. The race name currently prints in both tile eyebrows (`:4219`, `:4270`). One race fact, once.
- **ADD a "fresh vs fatigued" line to the readiness block**, not a separate tile. Readiness answers *acute* recovery; training-form/TSB answers *chronic* load. A runner deciding how to take an easy day wants both in one read. Put TSB as a one-line caption under the readiness drivers (web and iPhone), sourced from `seed.form` which Today already loads.
- **ADD the state-driven hero swap** (workout / readiness / race) and make web and iPhone use the same rule.
- **ADD a visible Send-to-Watch CTA** on the iPhone workout card. The brief names it the canonical primary action; today it is a silent auto-push with no affordance (`WatchSync.swift:41`, cross-ref design 6C). This is the one button that connects the planner surface to the execution surface, and it is invisible.
- **KEEP** the week strip (web `:286-503`, iPhone `:237-272`) and the workout hero's completeness (both are genuinely good).
- **PROMOTE** the readiness "meaning" narrative onto the iPhone driver rows (web has it, iPhone drops `input.meaning`, `UI-HEALTH 2.4`). Placement, not new data.

## TRAIN

**Job:** "Show me my plan, where I am in the arc, how I am executing it, and **why** it is built this way" (`APP_FEATURE_SPEC.md:134`).

**Is it doing the job?** The *what* and *where* are strong; the *why* is thin.

- Web (`TrainView.tsx`) is the strongest planning surface in the app: header with phase + countdown (`:556-601`), a phase-colored **volume ramp to race day** (`:604-686`), an **EXECUTION strip** of planned-vs-actual per week (`:688-745`), phase cards, THIS WEEK, PROJECTION, KEY WORKOUTS, and a full-plan modal with month + weeks views (`:1060-1590`). For David last week that reads 45.8/44.6 mi -> ~100% green: he can see he is executing.
- iPhone (`TrainView.swift`) mirrors it: giant phase word hero (`:175-180`), THIS WEEK (`:208-241`), EXECUTION (`:247-324`), and FULL PLAN with weeks/calendar lenses (`:337-722`).

Two real gaps, both about **legibility of the arc**:

1. **Coaching context is essentially absent.** Both surfaces list the plan but barely explain it. The iPhone map is blunt: "overwhelmingly a plan lister, not a plan explainer... per-session purpose, pace targets, and physiological rationale are absent" (only phase one-liners like "Race-specific work" at `TrainView.swift:763-771`). Web has the phase FOCUS line and phase-card descriptions but **no week-level rationale** (the `plan_weeks.rationale` column is a stub: "QUALITY · week 1", cross-ref design 2D). Paces are shown as bare numbers (web `:795`, `:417`) with no "why this pace." For a runner closing a 4:54 gap, "why this session, why 7:17, what it trains" is exactly the missing read.
2. **The arc is under-marked.** The peak week is invisible (`is_peak=false` on all 11 weeks; David's wk7 64.5mi peak just sits in "RACE-SPECIFIC", cross-ref design 2B), and **pace progression is never visualized** (the ramp shows volume climbing, never the quality paces tightening, design 2E).

**What moves / adds / cuts:**

- **ADD per-session "why" to the workout detail**, not the list. Web's `PlanDayPanel` (`TrainView.tsx:1317-1463`) and iPhone's calendar day detail (`:1006-1035`) are the right homes: a one-line purpose + pace rationale per session, behind the existing tap. This is the single most valuable Train addition for a competitive runner and it has a home already; it just needs content.
- **ADD week-level rationale** to the THIS WEEK card (populate `plan_weeks.rationale` or drop the stub).
- **MARK the peak and cutback weeks** on the ramp (data flag + a "PEAK" pill on the tallest bar).
- **ADD a pace-progression view** alongside the volume ramp (the quality target tightening week to week).
- **CUT nothing.** Train is dense but every block earns its place. The fix is depth-on-tap, not removal.

## RUN (and the execution layer)

**Job (as built):** a launcher to start or log a run. **Job (as it should be):** "Send today's workout to my watch and start, or capture something the watch did not."

**Is it doing the job?** This is the weakest-defined surface, because **RUN is not a surface**, it is a center tab-bar button that opens a popover (`RootTabView.swift:254-270`): Outdoor (-> WatchMirror), Treadmill, Log niggle, Log non-run. The design rationale is sound on its face ("most runs start from the watch, so phone-side run-starting is a low-key option", `RootTabView.swift:11-14`). But three things are off:

1. **The most valuable tab slot houses the least-used path.** The center position is prime real estate, and it is given to an action that the design itself calls secondary, while the brief's *actual* primary action, Send-to-Watch from the Today card, does not exist (design 6C). The runner's real "start" flow is: open Today -> (no send button) -> raise wrist. The center RUN button mostly serves Treadmill and logging.
2. **It bundles health-logging into a "RUN" launcher.** "Log niggle" and "Log non-run" are body/cross-training actions wearing a running label. Semantically they belong to Health and Activity respectively.
3. **The execution layer it launches into (the watch) is excellent but has placement gaps** (next section).

**The watch active-run screen** (`ActiveWorkoutView.swift`, the live execution) is genuinely target-aware: a 5-page swipe (Controls / Face / Stats / Splits / Map) routing each phase to a purpose-built face, with prescribed target pace shown on every quality face (intervals `:247`, tempo `:490`, progression `:401`, race `:282`), pace recoloring by drift zone, rep strips, and interval HR floors. Two placement problems hit David *this week*:

- **Tempo misroutes to the EasyFace** when it is a single work phase (`:137-141`), hiding the persistent target-pace row and steady HR. David runs tempos Tue + Thu (7:17 @ HR149); the watch hides both mid-rep (design 9C). The data exists, the face does not receive it.
- **Easy/long HR shows bare bpm, not a Z2 zone label** (`EasyFace:170`, `HRFace:217`), though the watch knows the ceiling. The brief says zone labels are more glanceable (design 9D).

**The watch readiness glance** (`ReadinessGlanceView.swift`) is two swipes from the home page and **drops its one coaching sentence** (`recommendation` is on the model at `:110` but never rendered, `UI-HEALTH 9.2`). And there is **no complication**: between runs, nothing is glanceable without opening the app (`UI-HEALTH 9.3`).

**What moves / adds / cuts:**

- **MOVE Log niggle out of RUN into Health** (it is body data) and **keep Log non-run reachable from both RUN and Activity** (it is an activity). RUN should be runs.
- **ADD the visible Send-to-Watch primary action on the Today card** (see TODAY). That is the real "start," and it belongs on Today, not hidden in a center popover.
- **ROUTE tempo to a target-pace face** on the watch (design 9C, ship before AFC).
- **RENDER the readiness `recommendation`** on the watch glance and **make readiness reachable in one swipe** (or via complication).
- **Reconsider the center slot** (Section B): if RUN stays a launcher, its prominence should match its frequency, and the slot it occupies might serve the runner better as a real destination (history).

## HEALTH

**Job:** "Show me my body: recovery, biometrics, sleep, and where I am in the recovery cycle" (`APP_FEATURE_SPEC.md:196`).

**Is it doing the job?** On web, yes, and well-ordered. On iPhone, it lags and mis-orders.

- Web (`HealthView.tsx`) leads with the readiness gauge + drivers + aerobic + 7-day trend (`:369-467`), then interpretation (THE STORY + WHAT TO DO + RECOVERY PHASE, `:469-632`), then raw tiles (BODY / SLEEP / FORM, `:634-727`), then DEEPER INSIGHTS (`:729-835`). Verdict-before-metrics is the right order for a marathoner (design 3E confirms: keep it).
- iPhone (`HealthView.swift`) has the same spine but **buries WHAT TO DO as the 5th card** (web puts it one scroll-stop from the gauge, `UI-HEALTH/design 7E`) and historically fabricated values on cold start (being fixed).

Two IA-specific issues:

1. **"FORM" is overloaded on one page**: a FORM section (running mechanics: cadence/GCT/stride, `:713`) and a TRAINING FORM insight (Banister TSB, `:745`). Same word, two unrelated meanings, same screen (`UI-HEALTH 10.3`).
2. **Internal duplication**: HRV/RHR/sleep appear twice within Health itself, once as RECOVERY PHASE pillars (`:593-613`) and again as BODY/SLEEP tiles (`:634-707`).

**What moves / adds / cuts:**

- **RENAME** the mechanics section "RUNNING FORM"; reserve "TRAINING FORM" for TSB.
- **PROMOTE** iPhone WHAT TO DO above the aerobic + STORY cards (match web's placement). Render an empty state instead of vanishing.
- **ADD the injury/niggle history view here** (logging exists, no surface reads it back; David has 2 logged, `UI-HEALTH 7.1`). Health is its home: "left calf: 3 flares this season, 41 days since last." This is also where the niggle-logging moved from RUN lands.
- **ADD a training-form read to iPhone** at all (it has none, `UI-HEALTH 5.4`). This is the same TSB signal Today should caption; Health is its depth home.
- **KEEP the order.** Do not move body metrics above interpretation.

## TARGETS

**Job (as named):** goal/target management. **Job (as built and as originally spec'd):** "Will I hit my goal time, what is the gap made of, and what is the cheapest way to close it" plus the race calendar (the spec called this page **"Races"**, `APP_FEATURE_SPEC.md:166-167`).

**Is it doing the job?** The data is comprehensive and honest, but **the most valuable content is the least accessible**, and the name points at the wrong job.

- Web (`TargetsView.tsx`): ANSWER (goal + projection band + status, `:107-149`) -> PATH (drift signals + test points, `:160-191`) -> WORK (VDOT, `:193-227`) -> PRs -> RACES. The **gap decomposition** (Fitness / Conditions / Course / Execution + which seconds are trainable) lives in `GapPanel`, rendered **only when off-track** (`:153-158`). David is "watching," so **he never sees it.**
- iPhone (`K_TargetsProjection.swift`): shows the gap decomposition + a HIT LIST of cheapest movable seconds **always** (`:471-516`), which is richer than web for the common state. But it is **doubly buried**: the panel sits at the bottom of a hero dominated by a 50pt race name + 58pt goal time (`TargetsView.swift:226-264`), and within the panel the HIT LIST is the last block.

So "what is my 4:54 made of, and which seconds are trainable" is the single most useful thing a runner 69 days out can read, and it is hidden on web (wrong status gate) and buried on iPhone (wrong order). That is the headline IA inversion of this surface.

Naming: goal CRUD is dead or minimal. iPhone "+ ADD RACE" is a no-op (`TargetsView.swift:393`), `goalTile`/`GapBeam` is dead code (`:356-381`), personal goals are a single sheet. The page is a **race-projection + race-calendar** surface, not a goal manager. "Targets" oversells goal-setting and undersells what it does.

**What moves / adds / cuts:**

- **PROMOTE the gap decomposition to the top** of Targets on both surfaces, and **show it in every status** on web (port the iPhone's always-on behavior; the data already feeds the iPhone, design 4C). The answer to "am I on track" should *be* the decomposition, not a number above a hidden panel.
- **RENAME** the tab. "Targets" -> **"Race"** (or "Goal"). It matches the content (one A-race, its projection, the calendar) and the original spec. This also de-conflicts the four race doors (Section B/C).
- **SURFACE Goal VDOT** on iPhone (~50.7, the number David is chasing; server already computes it, `UI-HEALTH 8D`) and a **VDOT trend** (is he closing?). Both are cheap and high-value.
- **ADD the B-goal (1:37)** as a secondary tick (exists in data, surfaced nowhere, `UI-HEALTH 3.5`).
- **CUT the dead code** (`goalTile`, `ProfileNextRace` stubs) so the surface stops carrying two gap visualizations.

## ACTIVITY (history): a surface that is a tab on web and hidden on iPhone

**Job:** "Show me what I have done, and tell me whether I am getting fitter" (`APP_FEATURE_SPEC.md:236`, and Insights `:294`).

**Is it doing the job?** It logs well and answers "am I getting fitter" not at all.

- Web (`ActivityView.tsx`): volume hero + range switch, effort-mix donut, PRs, 18-week heatmap, BY THE NUMBERS, RECENT RUNS (`:50-200`). Structurally complete as a log.
- The recent-runs feed is the primary nav into run detail but renders **dead last** (`:177-198`), every row reads "Run · 6.0 mi · 8:15" (generic name, dead verdict badge, `UI-HEALTH 4.3`).
- **The #1 competitive-runner signal is missing entirely:** pace-at-HR efficiency over time ("my easy pace at 145bpm went 8:30 -> 8:10 over 8 weeks"). The history surface, of all places, does not answer "am I improving" (design 5B). The decoupling machinery exists (`computeDecouplingTrend`) but feeds Health as a within-run number, not a cross-run trend.
- **On iPhone, Activity is not on the tab bar at all** (`RootTabView.swift:201` route-only). The daily-companion surface has no obvious home for training history.

**What moves / adds / cuts:**

- **ADD the efficiency trend** (pace normalized to HR, or HR at fixed pace, over the range). This is the page's reason to exist for a competitive runner, and it is the spec's "Insights" job folded in.
- **PROMOTE the recent-runs feed** higher and **label rows by workout + verdict** ("Tempo 4mi @ T · NAILED IT").
- **GIVE iPhone a way in** (Section B): either a tab slot or a prominent Today/Profile entry beyond the easy-to-miss "ALL RUNS ›" link (`TodayView.swift:253`).

---

# Part 2. Big questions

## A. The runner's day: information flow

Mapping what David needs at each moment, which surface serves it now, and the gap. This is the spine of the whole audit: get the moments right and the page structures follow.

| Moment | What he needs | Surface now | Doing the job? | Gap |
|---|---|---|---|---|
| **Morning, before run** | Am I ready? What is today, and does my readiness change how I run it? | iPhone Today (readiness hero + workout sheet) | Mostly | Readiness and workout are split (hero vs sheet); no one line tying them ("HRV down, run this by the HR cap, not pace"). On a pull-back easy day that link is the whole point. |
| **Pre-run, 5 min before** | Exact target (pace/HR cap/effort), fuel, kit, weather window, and **get it onto the watch** | iPhone Today workout card (`TodayPreRunBodyV3`) | Card is complete | **Send-to-Watch is invisible** (silent auto-push). The defining pre-run action has no button. |
| **During run, on watch** | Current pace vs **target**, HR vs **zone**, where I am in the structure | Watch `ActiveWorkoutView` | Strong for intervals/long/race | **Tempo misroutes to EasyFace** (hides target pace + HR), and easy/long HR is bare bpm not a Z2 label. Both hit David this week. |
| **Immediately post-run** | Did I hit it? Quick verdict + the numbers that matter | Watch `SummaryView` (3 numbers) -> iPhone recap -> web recap | Gradient is right (each surface adds depth) | **Watch summary is too thin** at the highest-engagement second: no avg/max HR, no per-rep ladder (data is on the device, design 10A). |
| **Evening, recovery** | What does today's load mean, what do I do tonight, when is the next hard day | iPhone Today post-run recovery panel (`:395-416`) + Health | Good on iPhone | The recovery read is iPhone-only and solid; web Health is the depth. Fine. The miss is that **the "why" of tomorrow's session** is not previewed here. |
| **Weekly review** | Did I hit my weeks, am I getting fitter, what is next week | Web Train EXECUTION strip + Activity | Partial | **"Am I getting fitter" has no home** (no efficiency trend). Weekly planned-vs-actual is on Train but not mirrored on Activity. The weekly check-in auto-prompt was removed (`Shell.tsx:104-110`), so review is now pull-only with no nudge. |
| **Race week (T-7..T-1)** | Taper context ("volume down, intensity held, you will feel flat, that is normal"), logistics, pacing plan | Web Train phase + RaceView CountdownLadder (`RaceView.tsx:458-464`) | Thin | No taper-specific guidance on Today; logistics are buried at the bottom of RaceView (`:616-636`). |
| **Race morning** | The race takes the page: countdown to gun, goal pace + splits, fuel, logistics | Nothing auto-promotes | **No** | `RaceDayView` exists but never routes on race day. Today renders "RACE" as a generic workout hero (design 1B/6D). **The single most important morning looks like a Tuesday.** |
| **Post-race** | Capture the result, see what it means, seed the next block | No live writer for `races.actual_result` | **No** | AFC's result cannot be logged -> cannot update VDOT -> cannot seed CIM. The AFC->CIM backbone has no entry point (design 11A, `UI-HEALTH 7.2`). |

**The two structural holes in the day:** the morning-to-watch handoff (Send-to-Watch invisible) and the **race-day-to-next-block arc** (no race-day mode, no result capture). Both must ship before Aug 16, because both are about the race itself.

## B. Tab bar audit

**iPhone: `Today · Train · [RUN] · Health · Targets`. Web: `Today · Train · Health · Targets · Activity · Profile`.**

**Are these the right tabs, in the right order, with the right names?** Mostly the right *set*, with three specific problems.

**1. RUN is in the wrong place for what it is.** It occupies the center, highest-value slot but is a launcher, not a destination, and the design itself treats phone-side run-starting as secondary to the watch. Meanwhile the real primary action (Send-to-Watch) lives on Today, not here, and Activity (a thing a competitive runner reviews constantly) is exiled off the bar. **Recommendation:** keep a quick-start affordance, but it does not need to be a peer of Today/Train/Health/Targets. Two viable shapes:
   - **(a) Keep RUN central but make it honest:** strip the health-logging out of it (niggle -> Health, non-run stays), and accept that its main jobs are Treadmill + manual capture. Put the real "start today's run" as the Send-to-Watch button on Today.
   - **(b) Reclaim the slot for Activity** and demote run-start to a Today-card button + a Today header action. This gives the daily companion a history home (fixing the iPhone gap) and puts the start action where the workout already is.
   I lean **(b)**: the center slot is too valuable for a launcher whose primary path is "raise your wrist." History earns a tab on the daily surface more than a popover does.

**2. "Targets" is the wrong name.** The content is race projection + race calendar, the original spec name was "Races," and goal CRUD is dead. **Rename to "Race"** (icon already `flag.fill`). This is not cosmetic: it is the first step in collapsing the four race doors (Section C) into a clear spine.

**3. Activity is a first-class web surface and a hidden iPhone route.** On the daily-companion surface, where a runner most often asks "how have my last two weeks gone," history is the hardest thing to reach. Fix per (1b) or, at minimum, a prominent Today entry.

**Should HEALTH and TARGETS combine?** They are both "how am I doing" surfaces, so the question is fair. **No, keep them separate**, because they answer different questions on different clocks:

- **Health** = "is my body recovered, today and across this block" (acute readiness + chronic TSB + biometrics). Daily clock.
- **Targets/Race** = "will I hit my goal time" (VDOT projection vs goal, gap decomposition). Season clock.

Combining would overload one surface and blur the two clocks. **But the boundary needs sharpening**, because today they leak into each other: TSB (a Health/load concept) lives on Targets-adjacent Today tiles and on Health's DEEPER INSIGHTS, while VDOT (a Targets concept) has no presence on Health. The clean division:

- **Health owns** acute readiness + chronic load (TSB/training-form) + biometrics + recovery cycle + injury history. The "am I fresh or fatigued" axis.
- **Race owns** the race projection, the gap decomposition, the calendar, PRs-vs-goal. The "will I hit the time" axis.
- **The orphan** between them, "am I getting fitter" (VDOT trend + pace-at-HR efficiency), belongs on **Activity** (the trajectory of what I have done), with the current VDOT *number* echoed on Race. This gives the spec's "Insights" job a home without a new tab.

**Is there a surface that should exist and does not?** Yes, two, but neither needs to be a new tab:

- **Race Day Mode** (spec'd as iPhone Page 8, `APP_FEATURE_SPEC.md:513-523`). It should not be a tab; it should be an **auto-promoted state of Today** on race morning, reusing `RaceDayView`.
- **Insights / "am I getting fitter."** Spec'd as its own surface (`:292-316`); fold it into **Activity** as the efficiency trend rather than a new tab.

**Is there a surface that should be demoted?** **RUN**, from center destination to a Today-card action (per 1b). Everything else earns its place.

**Order:** the web spine `Today -> Train -> Health -> Targets -> Activity` reads execution -> plan -> body -> goal -> past, which is coherent (`UI-HEALTH 10.1`). If Activity comes to the iPhone bar, place it last (it is the past). Recommended iPhone bar: **`Today · Train · Health · Race · Activity`** with run-start as a Today action, or if the center launcher is kept, **`Today · Train · [RUN] · Race · Activity`** with Health reachable... no: Health must stay a tab. So the honest options are (b) `Today · Train · Health · Race · Activity` (launcher becomes a Today button) or keep five-with-RUN and accept Activity stays a deep-link. **Pick (b).**

## C. What moves where

Concrete migrations. Each line is a move, not a vibe.

**Off Today, onto their home surface:**

- **TRAINING FORM tile** (`TodayView.tsx:4302-4360`) -> its *depth* goes to **Health** (typed training-form card, which iPhone lacks entirely); its *one-line signal* stays on Today as a caption under the readiness drivers. Not a standalone tile.
- **THE GAP tile** (`:4218-4267`) -> merges with **RACE DAY** into a single race strip on Today (countdown hero + projection sub), with the full projection living on **Race**.
- **The deep post-run analysis panels** (RepsRail/EasyPanel/LongPanel/TempoPanel at `TodayView.tsx:2364-3777`) are correctly on the completed-run hero; **do not move them**, but ensure the same depth is reachable from **Activity** run-detail (today it is RunDetailModal-only).

**Onto Today, from elsewhere:**

- **The race countdown + projection** from Race -> a compact Today race strip (glance). Race keeps the depth.
- **The "fresh vs fatigued" TSB line** from Health -> a caption in the Today readiness block (glance). Health keeps the depth.
- **Send-to-Watch** is not a move, it is a missing element: add it to the Today card.

**Off Health:**

- **Nothing leaves Health.** It is correctly ordered. Add to it (injury history, iPhone training-form), do not subtract.

**Off Targets/Race, made more prominent:**

- **Gap decomposition + HIT LIST** (`K_TargetsProjection.swift:471-516`; web `GapPanel`) -> from "bottom of a buried panel" and "off-track-only" to **the top of Race, in every status**. This is the most important single migration in the report: the most actionable content moves from hidden to hero.

**Duplication to collapse to one home:**

- **Readiness number**: lives on Today (chip/panel), Health (gauge), watch glance. Keep all three (glance vs depth is intended) but **make them read one canonical value** (38 stored vs 44 live disagree today, `UI-HEALTH 10.2`). Placement is fine; the value must agree.
- **The week**: Today week strip + Train THIS WEEK + Train EXECUTION strip are three views of the same 7 days. Defensible (today / plan / adherence), but Today's strip and Train's THIS WEEK should not diverge in what "this week's miles" means (done vs planned, `TodayView.swift:2080-2084`).
- **The race**: four doors today (Targets tab, RaceView detail, RaceDayView morning, RACE DAY tile on Today). Collapse to a spine: **Race tab (goal + projection + calendar) -> Race detail (course + fueling + logistics) -> Race-day mode (auto-promoted into Today on race morning).** The RACE DAY tile on Today becomes the race strip that deep-links into that spine.
- **Goal time**: shown read-only on Targets (`TargetsView.tsx:111`) and editable on RaceView (`RaceView.tsx:405-412`). Keep the write surface on race detail; everything else displays it.

**Buried that should be prominent:**

- Gap decomposition (above).
- Activity recent-runs feed (`ActivityView.tsx:177-198`, dead last -> up).
- RaceView logistics (`RaceView.tsx:616-636`, dead last -> up during race week).
- iPhone WHAT TO DO on Health (5th card -> top).
- The per-session "why" on Train (does not exist -> into the day-detail panel).

## D. The first week experience

A new runner installs the app with no data. What does each tab show, and is it useful or confusing?

| Tab | Empty state today | Verdict |
|---|---|---|
| **Today** | Web: honest fallbacks (readiness grey "no-data" ring `:177`, "NO GOAL SET / Pick a primary race" `:4238`). iPhone: hydrates from cache, shows placeholder header, niggle/strava banners self-hide. | **OK on web, OK on iPhone structurally.** The confusion is no "start here" thread. |
| **Train** | Web: per-section fallbacks, PROJECTION shows "NO RACE GOAL SET · Pick a primary race on /races" (`:973-979`). iPhone: placeholder hero "ROAD TO RACE TBD · BASE · WK 1 OF 13 · 0 MI" (`:139-201`) with **no create-a-plan CTA**. | **Confusing on iPhone.** A fabricated-looking "WK 1 OF 13" with no plan and no way to make one. |
| **Health** | Web: every tile shows a dash placeholder + "trend builds with daily syncs" (honest, `HealthView.tsx:60`). iPhone: historically **fabricated** values (VO2 61.4, HRV 52) + fake trend charts (`UI-HEALTH 1.2`, being fixed). | **Web honest, iPhone was lying.** Must land the de-fabrication before any new user. |
| **Targets/Race** | Web: clean guest branch, "Set a primary race to start tracking your gap to goal" + one button (`TargetsView.tsx:42-67`). iPhone: "TOP GOAL / Set a target / OPEN / NO DATE SET" + cold projection "need a clean baseline run." | **Best-handled empty state in the app.** This is the model. |
| **Activity** | Web: maps over empty arrays, no "log your first run" placeholder; `Math.max(...[])` -> `-Infinity` risk on empty `vol` (`ActivityView.tsx:29`). iPhone: not a tab. | **Weak.** No first-run story, and a latent empty-data NaN. |

**The onboarding story that is missing:** there is no single "this is your training, start here" thread. The plan splits across Today (today only), Train (the week + block), and Race (the goal), and Activity is hidden on iPhone. A new runner cannot answer "where is my plan" or "where is my history" without hunting (`UI-HEALTH 10.5`). Two cheap fixes:

1. **A real first-run state on Train and Activity**: "No plan yet -> Set your goal race" (route to Race's clean empty state) and "No runs yet -> your history builds as you run / connect Strava."
2. **A first-use glossary.** HRV, ACWR, TSB, VDOT, "pull-back band," "negative split" are interpreted everywhere but **defined nowhere** (`UI-HEALTH 2.4/6.3`). The `StatTile onExplain`/WHY hook is already scaffolded (`atoms.tsx:177`) but unwired. A beginner follows the instruction but cannot evaluate the reasoning. One definition per term, on first tap.

And the deepest first-week trust problem is not an empty state at all: **the same metric shows different values across tabs** (readiness 38 vs 44; goal "off" on the Today bib vs "watching" on Race). A new user who sees "READY" on Today and a lower number on Health learns not to trust any number (`UI-HEALTH 10.2`). One canonical read per metric per day is the real first-week fix.

## E. Proposed page structures

For each surface: **top (hero) / middle (context) / bottom (reference) / on-tap (depth) / not here.** Citations are to what exists so each move is concrete.

### TODAY (web + iPhone, same rule)

- **Top (state-driven hero, one of three):**
  - Quality day -> **workout hero** (web `PlannedHeroV2:557` / iPhone `TodayPreRunBodyV3`), with a **visible Send-to-Watch button** (iPhone).
  - Low-readiness easy/rest day -> **readiness hero** (the gauge + drivers + the one-line "run this by HR cap" tie), workout demoted to a strip.
  - Race day -> **race hero** (auto-promote `RaceDayView`): countdown to gun, goal pace + splits, fuel, logistics.
- **Middle (context):** the **week strip** (web `:286-503` / iPhone `:237-272`); a single **race strip** (countdown + projection, merged from the GAP/RACE DAY tiles); the post-run **recovery panel** when the run is done (iPhone `:395-416`).
- **Bottom (reference):** weekly-volume glance (one bar row, not an equal-weight tile); tomorrow's preview with a one-line "why."
- **On-tap (depth):** readiness breakdown (drawer), completed-run analysis panels, day-scrubber to preview other days.
- **Not here:** standalone TRAINING FORM tile (-> Health, signal as caption), full projection (-> Race), run history (-> Activity), VDOT methodology.

### TRAIN (web + iPhone)

- **Top:** phase + countdown + FOCUS line (web `:556-601` / iPhone `:175-201`). Keep.
- **Middle:** the **volume ramp to race day with peak + cutback marked** (web `:604-686`); the **EXECUTION strip** (planned-vs-actual, web `:688-745`); THIS WEEK with a **week-level "why" line**.
- **Bottom:** phase cards; KEY WORKOUTS to race; FULL PLAN entry.
- **On-tap (depth):** per-session detail panel **with purpose + pace rationale** (web `PlanDayPanel:1317` / iPhone calendar day `:1006`); full-plan month/weeks modal.
- **Add:** a **pace-progression view** beside the volume ramp.
- **Not here:** today's execution depth (-> Today), body metrics, the projection number's internals (-> Race; Train keeps the simple PROJECTION card).

### HEALTH (web + iPhone)

- **Top:** readiness gauge + drivers + 7-day trend (web `:369-467`). Keep.
- **Middle:** **WHAT TO DO** (promote on iPhone to here, `:505`); THE STORY; RECOVERY PHASE when post-hard.
- **Bottom (reference):** BODY (sub-grouped recovery-signals then body-composition), SLEEP, **RUNNING FORM** (renamed mechanics), DEEPER INSIGHTS with a **typed TRAINING FORM card** (Fitness/Fatigue/TSB + band legend) on both surfaces.
- **On-tap (depth):** per-tile trend; **injury/niggle history** (new: list + body-map + recurrence + days-since-last-flare).
- **Not here:** the race projection / VDOT (-> Race), run log (-> Activity).

### RACE (renamed from Targets; web + iPhone)

- **Top (hero):** the **gap decomposition + status**, in every status, both surfaces. "4:54 to close = Fitness X (trainable) + Conditions Y + Course Z + Execution W," with the **HIT LIST** of cheapest movable seconds right under it. This is the page's reason to exist; it leads. (Port web from off-track-only `GapPanel:153` to always; raise iPhone `K_TargetsProjection` panel above the giant type.)
- **Middle:** goal time + projection band with CI + **Goal VDOT** + **VDOT trend** + B-goal tick; days-out.
- **Bottom (reference):** race calendar (upcoming + past); PRs anchored to goal.
- **On-tap (depth):** **Race detail** per race (course + elevation + pacing + fueling + logistics, `RaceView.tsx`); edit goal/priority (write surface).
- **Not here:** dead `goalTile`/`GapBeam` (delete); general goal CRUD (it is a race surface, not a goal manager).

### ACTIVITY (web; add to iPhone)

- **Top:** range switch + volume hero, and the **efficiency trend** ("pace at HR over time, am I getting fitter") as a co-hero. New, and the point of the page.
- **Middle:** effort-mix; **recent-runs feed promoted up**, rows labeled by workout + verdict.
- **Bottom (reference):** PRs; 18-week consistency heatmap; BY THE NUMBERS; weekly planned-vs-actual mirror.
- **On-tap (depth):** run detail (full splits/zones/map, same depth as the Today completed hero).
- **Not here:** readiness/recovery (-> Health). Activity is volume + trajectory, not body-state.

### iPhone (the bar itself)

- **Recommended:** `Today · Train · Health · Race · Activity`, with **run-start as a visible Send-to-Watch action on the Today card** (and Treadmill/manual-log via a Today header action or a slimmed RUN affordance). Niggle logging -> Health. This puts the daily companion's five tabs on the five things a runner actually navigates between, and gives history a home.
- **If the center RUN launcher is kept:** at least pull niggle-logging out of it and add the visible Send-to-Watch on Today, so the launcher is not the *only* path and not mis-labeled.

### Watch

- **Active workout (the hero):** keep the per-phase faces; **route tempo to a target-pace face** (target pace + steady HR), and **render HR as a Z2/OVER zone label** on easy/long. Keep target pace on every quality face. These are placement fixes, not new screens.
- **Between runs:** make **readiness one swipe away** and **render its `recommendation` line**; **add a complication** ("TODAY · TEMPO 8mi" + "READY 72 · AFC 38d") so the wrist-glance exists without opening the app (post-AFC per `AUDIT-FIXES.md:64`).
- **Post-run summary:** add **avg/max HR + per-rep ladder** (data is already on the device).
- **Not here:** coach prose, projection internals, anything the phone/web owns. The watch stays "7:17 next, 4 to go."

---

# Part 3. Sequencing for the 69 days

The IA moves, ordered by what the AFC->CIM arc cannot ship without. This complements the design report's matrix; here the lens is placement.

**Must land before AFC (Aug 16), these are about the race itself:**

1. **Race-day mode = an auto-promoted Today state** (`RaceDayView` into Today when `daysAway===0`). Web + iPhone. The race must take the page on race morning.
2. **Race-result capture** (`races.actual_result` writer + a result-anchored next-plan). Without it AFC cannot seed CIM. This is the post-race moment in Section A, and it is an IA hole as much as a feature hole: the result has nowhere to land.
3. **Send-to-Watch as a visible Today action** (iPhone). The pre-run moment has no button.
4. **Gap decomposition to the top of Race, every status** (port web off-track-only -> always; raise iPhone panel). The most actionable content stops being hidden.
5. **One canonical read per metric** (readiness, goal status, VDOT). Placement is meaningless while the values contradict.
6. **Watch: tempo gets a target-pace face; easy/long HR gets a zone label.** David runs tempos Tue + Thu; the during-run moment is wrong this week.

**Should land before CIM (Dec 6):**

7. **Rename Targets -> Race** and collapse the four race doors into the Race -> Race-detail -> Race-day spine.
8. **Efficiency trend on Activity** ("am I getting fitter"), and **give iPhone an Activity home** (the tab-bar reshape, 1b).
9. **Per-session "why" on Train** (into the day-detail panel) + mark peak/cutback + pace progression.
10. **iPhone Health parity:** promote WHAT TO DO, add a training-form card, render readiness "meaning."
11. **Injury/niggle history view on Health** (and move niggle-logging there from RUN).
12. **First-run states on Train + Activity, and a first-use glossary** (wire the scaffolded `onExplain`).

---

# One-paragraph close

The app already has the right surfaces in roughly the right order: execution, plan, body, goal, past, with a reductive watch and an expansive web. The IA work for the next 69 days is not new tabs, it is **moving three things to where the runner needs them and making one thing agree with itself.** Move the gap decomposition from hidden-on-web / buried-on-iPhone to the top of the Race page, in every status, because "what is my 4:54 made of and which seconds are trainable" is the most useful sentence a runner this close to a goal can read. Move the race itself from four scattered doors and a generic Tuesday hero to a single spine that auto-takes the page on race morning and captures the result that seeds CIM. Move the start action out of a hidden center popover onto the Today card where the workout already is. And make readiness read one number on every surface, because a contradiction on any tab erodes trust on all of them. The single most important sentence in this report is the same as the design report's: on the morning of August 16, the app must not show David a Tuesday. The corollary is this one: on the other 68 mornings, the page should change shape with his body and his block, not just swap the numbers.
