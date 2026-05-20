# Per-screen spec (items 1–4)

For each screen: **states**, **verbatim copy**, **data binding** (source + any
conflict with already-wired data), **interactions / haptics**. The **populated
render with exact values is `docs/design/faff-app.html`** — open it alongside this.

Copy is verbatim. `**bold**` = Inter 700 inline. "{…}" = dynamic value.

Global interaction model:
- **Tabs** (Today/Plan/Coach/Health/Races): cross-fade, no slide. No haptic.
- **Sheets** (Workout detail, Run recap, Metric detail, Why-this): slide up,
  medium detent, drag-to-dismiss, swipe down to close. Grab handle. Haptic:
  `.impact(.soft)` on present.
- **Push** (Race detail, Profile): standard nav push (slide from trailing), back
  swipe. Profile pushes from the avatar.
- **Tap targets** (chip, tile, row, button): `.impact(.light)` on tap.
- **Primary actions** (Start Run, send): `.impact(.medium)`.
- Pull-to-refresh on each tab → re-fetch; `.impact(.soft)` at threshold.

---

## 1 · Today (tab)

**States:** Populated (run day) · Empty (rest day — hero swaps) · Loading · Error.

**Copy — populated (run day):**
- Date strip: dow letters M T W T F S S; days 18–24; Wed 20 = today (orange ring).
- Coach brief: "Good afternoon, {firstName}. Your body is **still cleaning up from the race** — let it finish before we push. Easy **{5.5 mi}** today, conversational. {89} days to {Americas Finest City}."
- Hero eyebrow: "TODAY · {BASE}". Why chip: "Why this".
- Hero title: "{EASY RUN}" (workout label, uppercased).
- Stats: {5.5} **mi** DISTANCE · {8:29} **/mi** PACE · {~47} **min** TIME.
- Buttons: "Open Workout" · "Skip" · "Substitute".
- Readiness: label "Readiness", badge "Watch Load"; ring {64}; copy "Load is climbing (ACWR {1.42}). Keep easy days easy. Connect Apple Health for HRV & sleep."
- Check-in: label "Today's Check-in", status "Logged" (✓); slider "Energy" {6}.

**Copy — empty (rest day):** eyebrow "TODAY · {BASE}", title "REST", body:
"No run on the schedule today. **Recovery is part of training** — let the body
absorb the work from this week and come into the next session fresh." (No stats,
no Open Workout; readiness/check-in still show.)

**Copy — error:** card "Couldn't load today. Check your connection." + "Try again".

**Data binding:**
- Date strip: current ISO week in user TZ (`synthetic-plan`); per-day status from `completed-runs`. Selected = tapped date.
- Coach brief: `generateBriefing()` (`lib/coach-briefing`) — greeting by local hour, post-race context, distance, days-to-race, race label.
- Hero workout: `findTodayWorkout()` → label/type/distance; pace via `resolveFitness` + `describeWorkout` (**pace band from plan/VDOT, not hard-coded**); duration = paceSec × miles.
- Readiness ring + copy: `computeReadinessScore()` (ACWR-driven). Badge "Watch Load" when load-elevated; **score is real, surface-only — never auto-edits the plan.**
- Check-in: `daily_checkin` row (energy/soreness/stress). "Logged"/"Not logged".
- ⚠️ Conflict check: ring shows 64 + "Watch Load" because HRV/sleep aren't connected in this state; if Apple Health IS connected the copy/inputs change (see live `computeReadinessScore`).

**Interactions / haptics:**
- Tap date cell → re-render Today for that date (past = recap inline, future = preview; §1a/1b). `.impact(.light)`.
- Tap **Why this** → Why-this sheet (§11).
- Tap hero card / **Open Workout** → Workout detail sheet (§2). `.impact(.medium)`.
- **Skip** → confirm action sheet ("Skip today's run?"). **Substitute** → substitution menu sheet.
- Drag **Energy** slider → write `daily_checkin`; `.selection()` haptic per step.
- Tap avatar (sticky bar) → Profile push. Tap race chip → Race detail push.

---

## 1a · Today · past date (recap inline)

Hero becomes a recap. **Copy:** eyebrow "{MON MAY 18} · DONE", badge "On plan";
brief "Monday's easy run, logged. Relaxed and even — HR sat in **Zone 2** the whole
way; you're absorbing the race well. {89} days to {Americas Finest City}."; title
"EASY RUN"; stats {5.1} mi DISTANCE · {8:34} /mi AVG PACE · {43:42} TIME; note
"{5.1 / 5.0} mi planned · ran it right"; button "View full recap". Coach verdict
(green "Coach"): "Even pacing, no surge. Exactly the easy day the plan wanted —
easy days easy so the hard days can be hard." Logged card "Logged Mon morning"
(✓): Energy {6}, RPE {3} (read-only sliders).
**Binding:** actual = synced activity (HealthKit/Strava); plan = synthetic-plan;
RPE/energy = that day's `daily_checkin`. **Interaction:** "View full recap" → Run
recap sheet (§3).

## 1b · Today · future date (preview)

**Copy:** eyebrow "{SAT MAY 23} · PLANNED", badge "Upcoming"; brief "Saturday's
long run — **{12 easy aerobic miles}**. Time on feet rebuilds the base; keep it
conversational, the distance is the work. {89} days to {Americas Finest City}.";
title "LONG RUN"; stats {12} mi · {8:45} /mi · {~1:45}; note "Fuel + hydrate —
effort over 90 min"; button "Open workout". Readiness card → placeholder: badge
"{Sat} AM", dashed ring "—", "Your readiness score posts **Saturday morning**,
once sleep & HRV sync." Check-in → disabled: status "Opens {Sat} AM", slider
opacity 0.4, value "—". **Interaction:** "Open workout" → Workout detail (preview
variant — no Start Run until the day).

---

## 2 · Workout detail (sheet from Today)

**States:** Populated · Loading (skeleton structure rows).
**Copy:** eyebrow "{Easy · Base · today}"; title "EASY RUN / 5.5 MI". Structure
card "Structure": **Warm-up** / "First mile relaxed, settle in" / {1.0} mi ·
**Easy · conversational** / "{8:29} /mi · Zone 2" / {4.0} mi · **Cool-down** /
"Last half-mile soft" / {0.5} mi. Why verdict "Why this run": "You raced eleven
days ago. Easy miles flush the legs without re-stressing tissue that's still
repairing — duration is the stimulus, not pace." Focus verdict "Focus": "Hold a
sentence the whole way. If the watch buzzes you over {8:29}, ease off — slower is
fine today." Conditions card: "{62°F · light breeze}" / "good easy weather" ·
"{Endorphin Speed 4}" / "{182 mi}". Buttons: "Start Run" · "Move" / "Skip" / "Swap".
**Binding:** structure from `api/plan` / `plan-week` + pace doctrine; why/focus
from `buildWhyThisWorkout`; weather = forecast (`pre-workout-briefing`); shoe =
gear/last-similar. **⚠️ "Start Run":** in the design the phone *starts* the run
(replaces the old "Send to Watch"). On the future-date preview variant, hide
Start Run. **Interactions:** Start Run → active-run flow / watch handoff,
`.impact(.medium)`. Move/Skip/Swap → respective sheets. Swipe down dismisses.

---

## 3 · Run recap (sheet, auto-presents after a synced run)

**States:** Populated · Loading.
**Copy:** header "{Mon May 18} · Synced from Apple Watch" + badge "On plan"; title
"EASY RUN". Stats: {5.1} mi DISTANCE · {8:34} /mi AVG PACE · {43:42} TIME · {142}
bpm AVG HR. Route map (see assets). Splits card "Mile splits · target {8:29–9:19}":
rows {1} {8:41} {138} · {2} {8:36} {141} · {3} {8:33} {143} · {4} {8:30} {144} ·
{5} {8:28} {146}. Coach verdict "Coach": "Even and controlled — finished a touch
quicker than you started, with HR holding Zone 2 throughout. Textbook easy day;
you're absorbing the race well." RPE card: "{3} RPE / 10" + "**Felt easy** — you
logged it conversational with fresh legs. Matches the data."
**Binding:** all from the synced HealthKit/Strava workout (distance/pace/time/HR,
per-mile splits + HR); target band from plan pace; coach read = post-run
reconciliation; RPE = `daily_checkin`/post-run prompt. **⚠️ Reconciliation
(prescribed vs actual) is partial in backend today** — flag.
**Interactions:** auto-present on app open after a new synced run (`.impact(.soft)`);
drag-dismiss; route map tap → full-screen map (future).

---

## 4 · Plan (tab)

**States:** Populated · Empty (no plan yet) · Loading (skeleton rows) · Error.
**Copy:** eyebrow "{Base · week 3 of 14}"; title "This Week". Progress card:
"{2 of 5} sessions done" · "**{43} mi** planned"; bar {33}%. Week rows (dot · day ·
name / sub · value): Mon Easy "5 mi · done" ✓ · Tue Easy + strides "4 mi · done"
✓ · **Wed** (today/amber) Easy run "5.5 mi · today" 5.5 · Thu Easy "6 mi" 6 · Fri
Rest "recovery" — · Sat Long run "12 mi · aerobic" 12 · Sun Easy "5 mi" 5.
"Coming up": Wk4 "Build volume · 48 mi {first tempo}" · Wk5 "Cutback · 38 mi {absorb}".
**Empty copy:** "No plan yet. Set a goal race and we'll build your weeks." + "Set a race".
**Binding:** `synthetic-plan` currentWeek + phase; done/today markers from
`completed-runs` (done = ≥60% of planned distance); coming-up = next phases.
**Interactions:** tap a day row → that day's Workout detail (§2). "Coming up" rows
→ week detail. Deep edit → web (note: "Edit on faff.run"). Pull-to-refresh.

---

## 5 · Coach (tab)

**States:** Populated · Empty (no data) · Loading.
**Copy:** eyebrow "Coach"; title "Today's Read". Coach label "{Wed May 20} ·
{Base week 3}"; brief "Good afternoon, {firstName}. You're **eleven days out from
the race** and the legs are still settling — exactly on schedule. Easy today; we
rebuild the base, then the engine work starts. {89} days to {Americas Finest City}."
Verdicts: **Why** "Tissue repair isn't finished. Easy volume rebuilds without
re-loading damaged fibers." · **Focus** "Conversational only. The win is
consistency at low stress, not any run feeling fast." · **Back off if** "Resting
HR stays high two mornings, or the legs feel dead by Thursday — we'll trade the
long run for easy miles." Eyebrow "Signals": green "On track" — "Two easy days
banked at conversational effort. Discipline paying off." · amber "Watching" —
"Acute load up 42% (ACWR {1.42}). Normal post-race — hold easy until it settles
under 1.3."
**Binding:** `api/brief` (DailyBriefing) + `coach-briefing.ts`; verdicts from
`buildWhyThisWorkout` / coach engine (**every clause must trace to research per
project rule — no extrapolation**); signals from the engine's findings.
**Interactions:** **read-only — not a chat.** No input. Tap a signal → its detail
(future). Pull-to-refresh.

---

## 6 · Health (tab) — tile dashboard

**States:** Populated (connected) · Empty (no wearable) · Loading (shimmer tiles) · Error.
**Copy:** eyebrow "Apple Health · synced {2m ago}"; title "Body State". Hero: ring
{64}, badge "Hold easy", copy "Vitals are strong — but acute load is elevated
post-race. Stay aerobic until it settles."
- **Recovery & Vitals**: HRV {68} ms ↑{6}·7d · Resting HR {48} bpm ↓{2} · Sleep
  {7:48} "need 7:30" · Respiration {14.2} /min "steady" · VO₂max {51} ml/kg ↑{1} ·
  Wrist temp {+0.2} °F "normal".
- **Running Dynamics · last run**: Cadence {178} spm ↑{3} · Stride {1.18} m
  "steady" · Vert Osc {8.2} cm "efficient" · Grnd Contact {242} ms ↓{6} · Vert
  Ratio {6.9} % "good" · Run Power {287} W "avg".
- **Training Load**: Load · ACWR {1.42} "watching" · Volume {9.5} /43 mi "on pace"
  · Form · TSB {−4} "fresh".
**Empty copy (tile):** value "—", delta "No data". Section CTA: "Connect Apple Health".
**Binding (READ THIS — conflicts with what's wired):**
- ✅ **Real now** (`health_samples`, HealthKit ingest, 7-day avg): HRV, Resting HR,
  Sleep, VO₂max (+ Max HR). These tiles populate live.
- ❌ **No data source yet — render EMPTY ("No data") in the live app:** Cadence,
  Stride, Vertical Oscillation, Ground Contact, Run Power, Respiration, Wrist
  temp, Body mass. The iOS `HealthKitManager` does **not** read these and Strava
  doesn't provide running dynamics. **Do not hard-code 178 spm etc.** They light
  up only when the ingest is extended. (The mockup shows them populated to
  document the *intended* layout/values.)
- Training Load: ACWR + Volume derivable from Strava history; Form/TSB needs ~30 days.
- Delta colors: `good` = green, `watch` = `amberInk`, `flat` = textDim.
**Interactions:** tap any tile → Metric detail sheet (§7), `.impact(.light)`.
Tap "Connect Apple Health" → HealthKit auth. Pull-to-refresh.

---

## 7 · Metric detail (sheet from a Health tile) — HRV exemplar

**One template for every tile**; only the metric, chart, verdict, related set change.
**States:** Populated · Loading (shimmer chart).
**Copy (HRV):** eyebrow "Recovery & Vitals · Apple Health". Hero: "HRV · 7-day
average" + badge "Well recovered"; "{68} ms · ↑ {6} vs 30-day"; "Baseline
{58–66} ms · CV {5.1}% · stable". Segmented "7D / 30D / 90D" (30D default). Chart:
30-day line + normal-range band; axis "{Apr 20} / {May 5} / Today". Verdict "What
this means": "Your 7-day average sits above your 30-day baseline with low
day-to-day variation (CV {5.1}%). The parasympathetic system is well-recovered — a
green light for quality once acute load settles." Feeds-Readiness card: ring {64},
"**Feeds Readiness** · HRV is the strongest positive input — load is what's
holding the score at {64}." Related tiles: Resting HR {48} ↓2 · Sleep {7:48} ·
Respiration {14.2}.
**Binding:** series from `health_samples` (or the metric's source); baseline/CV
computed; verdict = research-grounded read (e.g. Plews CV for HRV); "Feeds
Readiness" links to `computeReadinessScore` inputs.
**Interactions:** segmented control swaps range (animate chart). "Feeds Readiness"
row → Coach/Readiness. Related tile tap → that metric's detail. Drag-dismiss.

---

## 8 · Races (tab)

**States:** Populated · Empty (no race set) · Loading.
**Copy:** eyebrow "Next A-race". Race card (orange): "{Americas Finest City Half}"
/ "{AFC Half}" / "{San Diego · 17 Aug 2026}" / "{89} days out"; goal {1:38} Goal
time · {7:28} Goal pace · {Base} Phase · wk {3/14}. "Recent": {Carlsbad Half} "9
May · A-race" {1:41} · {La Jolla 10K} "22 Mar · tune-up" {44:12} · {Resolution Run
5K} "1 Jan" {20:38}. "Personal bests": {20:14} 5K · {43:50} 10K · {1:39} Half ·
{3:42} Full. **Empty copy:** "No race yet. Pick your goal and we'll plan backward
from race day." + "Add a race".
**Binding:** `api/races` (`listRacesDB`, actual_result first); countdown =
days-to-race; goal pace = goal time ÷ distance; phase/week from plan; PRs from
results. **Interactions:** tap race card → Race detail push. Pull-to-refresh.

---

## 9 · Race detail (push from Races)

**States:** Populated · Loading.
**Copy:** header back "Races" + share; eyebrow "A-Race · Goal {1:38}"; title "AFC
HALF"; sub "{Americas Finest City · San Diego · Aug 17}". Countdown card (orange):
"Countdown" {89} "days to go" · "Goal pace" {7:28} /mi; {1:38} Goal time · {~1:40}
Projected · VDOT {49} · {Even} Strategy · ±{10}s; "**Within reach** — your
threshold work over the next two blocks closes the **~{8} s/mi** gap to goal."
Course card: route map; "Course" / "Route & profile · GPX"; "{13.11} mi · +{180} /
−{310} ft · **net −{130} ft (fast)**"; elevation chart + grade band. "Phase-by-Phase
Pacing": ① Opening rollers [Rolling] "Mile {0.0 → 2.0} · {2.0} mi" {7:35} "{15:10}
cum" · ② Hwy 163 descent [−2.4%] "{2.0 → 5.0} · {3.0} mi" {7:12} "{36:46} cum" · ③
Bayfront flat [Flat] "{5.0 → 10.0} · {5.0} mi" {7:28} "{1:14:06} cum" · ④ Harbor
finish [+0.6%] "{10.0 → 13.1} · {3.1} mi" {7:33} "{1:37:48} finish". Footer button
(ghost, lock): "Race-day brief unlocks {Aug 10} · T−7".
**Binding:** `getRaceDB(slug)`; countdown/projection from `computeRaceTrajectory` +
aggregate VDOT (`computeAggregateVdot`, `vdotRow`); course profile + phases from
the race GPX (`buildElevationPath`, phases); pace per phase coach-computed from
elevation + goal; race-day brief generates at T−7.
**Interactions:** back → Races. Share → share sheet. Tap route → full map. Phase
rows non-interactive. **Note:** the standalone fueling row was removed when the
route map was added — fueling lives in the full plan; re-add only if desired.

---

## 10 · Profile (push from avatar)

**States:** Populated.
**Copy:** header "Profile" (back + "Done"). Identity: avatar "{D}", "{David
Nitzsche}", "{VDOT 49 · Half-marathon focus}". "Integrations": Apple Health
[Connect] · Strava [Connected ✓] · Apple Watch [Paired ✓] · Garmin [Connect].
"App": Races "{AFC Half} ›" · Run log "{142 runs} ›" · Notifications "{4 on} ›" ·
Units "{Miles} ›" · Open on web "faff.run ›".
**Binding:** `api/profile` / `connectors` / `auth`; integration status from OAuth
connectors; counts from data.
**Interactions:** "Done" / back → dismiss. Each integration row → connect/manage.
Each app row → its sub-screen. "Open on web" → Safari to faff.run.

---

## 11 · Why this (sheet from the Why chip)

**States:** Populated.
**Copy:** eyebrow "Coach · why this workout"; title "Why easy today". Brief:
"You're **11 days past the race** and still in the base phase. Easy aerobic miles
are the highest-value thing you can do right now — they rebuild the engine without
re-stressing tissue that's still repairing." Verdicts: **Where you are** "Base ·
week {3 of 14}. We're banking aerobic volume so the engine work later lands on a
deeper, healthier foundation." · **What it builds** "Conversational running grows
capillary density and mitochondria and flushes residual race fatigue — adaptations
you can't rush with hard days." · **Why not harder** "Quality returns in ~2 weeks
once tissue fully recovers. Pushing now trades a small gain today for a setback
next week." Signals: green "Evidence" — "Easy-day HR is down 4 bpm at the same
pace over three weeks — the aerobic base is taking." · amber "Watching" — "Acute
load (ACWR {1.42}) is still elevated post-race, which is why today stays easy, not
threshold." Button: "Open today's coach read".
**Binding:** `buildWhyThisWorkout` (workout type/phase/VDOT) — research-grounded.
**Interactions:** "Open today's coach read" → Coach tab. Drag-dismiss.

---

## Cross-screen conflicts to resolve before implementing

1. **Running-dynamics + respiration/temp/body-mass tiles (Health)** have no data
   source today → must render as honest "No data" in the live app, OR extend the
   iOS HealthKit ingest. (The mockup shows them populated to document layout.)
2. **"Start Run"** replaces "Send to Watch" everywhere — confirm the active-run /
   watch-handoff flow it triggers.
3. **Run recap reconciliation** (prescribed vs actual splits) is only partially
   wired in backend.
4. **Race detail fueling** row was cut to fit the route map — decide whether to
   re-add.
