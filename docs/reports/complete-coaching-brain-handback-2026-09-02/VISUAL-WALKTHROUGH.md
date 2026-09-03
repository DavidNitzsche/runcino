# Visual walkthrough — faff iPhone, every screen, real data

**Walked 2026-09-03, 00:00–00:30 PT. Branch `audit/visual-walkthrough` off `main` `65f7d5de`.**

> *"The app is also so buggy and clunky. It would be worth visually walking the app after
> pushing it to work through a lot of the visual issues and dead ends. No placeholder, etc."*
> *"I want this app Runna level."*

This is an audit. Every finding below was seen on a rendered screen, not read out of source.
Source is cited only to name the cause once the screen had already shown the defect.

---

## How this was rendered, and why nothing could reach production

- `next dev` on **port 3111** in this worktree, with `DATABASE_URL` bound to the
  **`faff_readonly`** Postgres role. Verified before the walk began:
  `current_user = faff_readonly`, and `UPDATE users …` → `permission denied for table users`.
  The client was structurally incapable of writing.
- A **signed** Debug build of `native-v2` at `main` `65f7d5de`, installed on simulator
  `iPhone 17 · 8829D8FB-278F-458A-B895-C7E799F07E78`, launched with
  `-faffHost http://127.0.0.1:3111`. No `API.swift` or `Info.plist` edit was needed —
  `FaffApp.applyHostOverrideIfAsked()` already provides a DEBUG-only host override.
- **Cache trap avoided.** Every screen below was matched to a request in the dev-server log
  before it was trusted. Nothing here is the app's 12-hour `AppCache` — *except* §1.4, where
  serving from cache **is** the finding, and that was produced deliberately by killing the
  server.
- **Write barrier held.** `middleware.ts` + `client-attestation.ts` refused the only mutating
  request the walk produced: `REFUSED POST /api/plan/change · x-faff-client-env: simulator`.
  Every other request in the session was a GET. `runs`, `races`, `training_plans`,
  `plan_workouts` and `users` were read and never written.
- Runner `0645f40c-951d-4ccc-b86e-9979cd26c795`, live CIM block, week 2 of 15, today =
  Thu 3 Sep, INTERVALS 6.5 mi.

**Contrast was measured, not eyeballed** — pixels sampled from the PNGs and run through a WCAG
relative-luminance calculation. Ratios below are from that, and the boxes sampled are named.

---

## Headline counts

| Severity | Count |
|---|---|
| Dead ends and broken paths | **6** |
| Placeholder or wrong data shown as real | **5** |
| Misleading content | **9** |
| Visual defects | **11** |
| Clunk | **8** |
| Polish | **7** |
| **Total** | **46** |

**The three worst things:**

1. **No tab ever returns to its own root, and the back control scrolls away with the content.**
   Open a past day from the calendar and the Today tab is *permanently* a past day. Tapping
   "Today" does nothing. The edge-swipe back gesture does nothing. Twelve minutes and four
   tab switches later it was still showing Tuesday. (§1.1)
2. **With the server unreachable, the app is visually identical to a healthy app.** Full
   readiness score, full week mileage, full prescription — all from a 12-hour cache, with no
   banner, no staleness mark, no "could not reach faff". The design has a whole screen for
   this (16a) and none of it fires. (§1.4)
3. **Block prints the same coach sentence twice, back to back**, because a server fix landed
   11 hours after the app started rendering the same field. (§3.1)

---

# 1 · Dead ends and broken paths

### 1.1 · The Today tab gets permanently stuck on a past day — and there is no way back except scrolling
**Screen:** Today → past-day view · **Shots:** `08-DEADEND-today-tab-inert.png`, `22-DEADEND-today-tab-stuck-on-past-day.png`, `05-past-run-earlier.png`
**Path:** Today → calendar icon → tap any "Done" day → scroll down.

Once you are on a past day:
- the only back control is a `‹ Today` pill **inside the scrolling gradient panel**, so it is
  off-screen the moment you read anything;
- the **interactive back gesture does nothing** (swiped from the left edge, screen unchanged);
- **tapping the "Today" tab does nothing** — no pop to root, no scroll to top;
- switching to Block and back **restores the past day, scrolled where you left it**.

Verified twice, twelve minutes apart. `22-…` was captured after visiting Block, Races, race
detail, edit-race and shoes; the Today tab still showed Tuesday 1 September.

**What it should be:** re-tapping the active tab pops to root (the universal iOS affordance),
the back control is pinned rather than scrolled, and the interactive pop gesture is enabled.
**Fix:** app release. `ShellV5.swift` owns `paths[.today]`; the tab-bar button needs to clear it.

### 1.2 · Same defect on every other tab
**Screens:** Races → race detail; Today → Settings; Today → Shoes; Block → Past runs.
Races kept the AFC race-detail screen across a tab switch. Settings (pushed on the Today tab)
survived a Today-tab tap. This is one root cause, not four bugs, but it is reachable from
every corner of the app.

### 1.3 · Race Detail (8a) is unreachable for any upcoming race
**Screen:** Races → THE SCHEDULE · **Shot:** `16-RACES-projected-no-tilde.png`
Tapping **California International Marathon** highlights the row and produces nothing. Same
for every upcoming race. The full Race Detail screen (course profile, gear plan, pace plan)
only opens from a **COMPLETED** row's expansion, via a `Race detail ›` sub-row.
`RacesV5.swift`'s own header says so: *"7a.html's schedule rows only ever toggle local
expand-in-place … `onEvidenceTap` is exposed as the nearest hook a composition root has if 8a
is meant to be reached from this screen at all."* `ShellV5` carries `V5Route.raceDetail(slug:)`
as a real destination reachable only from a `faff://races/{slug}` deep link.

So the runner can inspect the course and gear plan of a race he has already run, and not of
the one he is training for. **Fix:** app release; the hook already exists.

### 1.4 · Offline is indistinguishable from online
**Screen:** every screen · **Shot:** `29-OFFLINE-no-indication-today.png`
Killed the dev server, relaunched the app. Today rendered **completely normally**: the
gradient poster, INTERVALS 6.5 mi, the week strip, `Readiness 73 / 100`, `5K fitness
0:19:40 – 0:22:00`, `This week 21.1 mi`, `Sleep 6.6h`. Nothing anywhere said the data could
not be refreshed. No banner, no timestamp, no amber.

`API.authedSend` posts `.faffReachabilityLost` on a network failure with a comment saying it
exists *"so the runner sees 'can't reach Faff' instead of every surface silently falling back
to empty/stale cache."* Nothing visible came of it. The design's 16a data-outage screen
(ErrorNote + Skeleton + coach line) does not appear.

**What it should be:** 16a. At minimum a persistent "last updated" mark once a fetch fails.
**Fix:** app release.

### 1.5 · "Cut back a week" cannot be pointed at a week
**Screen:** Block → Change the plan → Cut back a week · **Shot:** `14-cutback-refusal-deadspace.png`
The scenario silently picks the next week (week 3), and week 3 is already a cutback, so the
runner gets `Week 3 is already a cutback.` and one action, `Leave it alone`. There is no week
picker. For this runner the entire cutback feature is a dead end that cannot be reached at all.
(The **refusal treatment itself is right** — see §7.)

### 1.6 · "End" discards a run with no confirmation and no feedback
**Screen:** Live run (outdoor) · **Shots:** `28-liverun-outdoor-empty-tiles.png`
Tapping **End** dismissed the run instantly. No confirm sheet, no summary, no "run discarded",
nothing in the server log (no POST at all). The End button is full-width, fault-red, and sits
directly beside Pause. A mis-tap at mile 18 loses the run silently.
**What it should be:** a confirm, or a summary, or at minimum a sentence.

---

# 2 · Placeholder or wrong data shown as real

### 2.1 · Settings says Strava is not connected. It is.
**Screen:** Settings → DATA · **Shot:** `31-SETTINGS-strava-not-connected-twice.png`
The row reads **"Strava / Not connected"** with the value **"Not connected"** — the same two
words printed twice on one row, six points apart.

It is also false. `connector_tokens` holds a live `strava` row for this runner:
`provider_user_id 203630`, `scope activity:read_all activity:write read`,
`connected_at 2026-06-01`, `disconnected_at NULL`. `users.strava_writeback = true`. The
past-run screen renders **"Published to Strava"** for a run this app pushed.

**Cause.** `SettingsV5` reads `StravaConnection.isConnected`, a `UserDefaults` mirror
(`faff.strava.connected.v1`). Every one of the eight `StravaConnection.set(...)` call sites is
in the **legacy `Views/` tree** — `ProfileView`, `ActivityView`, `SettingsView`, `TodayView`.
There are **zero call sites in `ViewsV5/`**. The v5 app never runs those screens, so the mirror
is never written and `UserDefaults.bool` returns its `false` default forever. Rule 11 exactly:
"never synced" and "explicitly disconnected" collapse into one value.

**Second consequence, worse than the row.** `TodayPostRunBody.swift:155` gates the
**Push to Strava** button on the same flag — so that action is permanently hidden in v5. The
post-run screen shows only a passive "Published to Strava" line, never a button.
**Fix:** app release. Set the mirror from `/api/profile/state`'s `connections.strava.connected`
on a v5 load, or read the wire directly and delete the mirror.

### 2.2 · The Edit Race sheet is interactive while it shows the wrong date and distance
**Screen:** Races → completed race → Race detail → ✎ · **Shots:** `20-EDITRACE-wrong-prefill.png` (loading), `21-editrace-loaded-correct.png` (loaded)
For a race run on **16 Aug 2026**, the sheet opened showing **Date `Sep 3, 2026`** (today) and
**Distance `Other`**, with the Race-morning fields blank. Every control was live. A caption
directly under the Goal field reads *"Changing the date or A goal rebuilds your plan around it."*

It **does** populate correctly a few seconds later (`Aug 16, 2026`, `Half Marathon`, gun time,
wave, bib, location). So this is a loading state that shows plausible defaults instead of a
skeleton, on a form whose Save rebuilds a 15-week block. It also renders a spinner **inside**
the Goal text field.
**Honest caveat:** the window was wide here because the dev server was cold-compiling; on
production it is shorter. The shape is still wrong.
**Fix:** app release — disable the form, or show a skeleton, until the load resolves.

### 2.3 · A race-day gear plan showing today's shoe
**Screen:** Race detail (Americas Finest City, 16 Aug) · **Shot:** `19-racedetail-course-caption-soup.png`
GEAR PLAN reads **"NB SC Trainer v3 - red · 12 mi · 4% of its life"**. That shoe has 12.4 miles
on it *today*; it cannot be what was worn for a half marathon 18 days ago (the race alone is
13.1). It is the current rotation default, presented as the plan for a race in the past.

### 2.4 · A retired shoe with zero miles
**Screen:** Shoes → RETIRED · **Shot:** `24-shoes-retired-zero-mi.png`
`Nike Vomero Plus — 0 mi`. Either a real zero or an unreadable value; the runner cannot tell,
and retiring a shoe with no miles on it is meaningless either way.

### 2.5 · A completed race with no priority chip
**Screen:** Races → COMPLETED · **Shot:** (in `16-…`, scrolled)
`Big Sur Marathon` renders a blank square where every other row carries A/B/C. A missing value
drawn as empty space rather than as an honest "unrated".

---

# 3 · Misleading content

### 3.1 · Block prints the same coach sentence twice, adjacent
**Screen:** Block → WHERE THIS GOES · **Shot:** `11-BLOCK-duplicate-coach-line.png`

> *"Your races fade with distance faster than your speed predicts, so durability is where the
> work goes. Your threshold holds."*
>
> *"Your races fade with distance faster than your speed predicts, so durability is where the
> work goes. Your threshold holds, and this week's long run is the session that builds it."*

Two tiles, one above the other. The second is a superset of the first.

**Cause, exactly.** `bfaf9d9e` (2026-09-01 16:24) wired `model.thesis.coachLine` into
`BlockV5.swift`. `824b47b6` (2026-09-02 03:30) then routed the thesis into the server's
`coachLine` field, on the stated belief that *"`Thesis`, `reviewTrigger` and `limiter` appear
zero times in the whole of `native-v2`"* — which had been false for eleven hours. Both are on
`main`. `BlockV5.swift`'s own comment claims the two lines *"sit together without repeating
each other (Rule 17)"*; nothing checks that claim.

**Fix: server-side, one line, no app release.** `blockCoachLine()` in
`web-v2/lib/plan/v5-block.ts` should go back to returning `phaseLine`, since the app now
renders the thesis itself. Left in the catalogue rather than the diff — another agent landed
that change yesterday and `_block_thesis_line.test.ts` gates it.

### 3.2 · The projected-finish trend chart makes a 5% change look like a 500% one
**Screen:** Races → Projected finish · **Shot:** `17-RACES-trend-chart-misleading.png`
Caption: *"Faster by 10m 30s over 4 days"* — a **5.2%** improvement on a 3:19:43 projection.
Measured bar heights (image pixels, baseline y≈1460): **289, 103, 53, 53, 54**. The first bar
is **5.4× the last**, and the last **three days are pixel-identical** (53/53/54).

The bars are scaled to the window's own min/max instead of to zero, so the chart cannot
distinguish three of the five days it plots and grossly overstates the one change it can see.
This is the same shape as the trend chart in Rule 13's own examples.

### 3.3 · The coach log is not in date order
**Screen:** Races → THE LOG · **Shot:** `18-RACES-log-out-of-order.png`
Card dates top to bottom: `2026-08-30`, `2026-08-16`, `2026-08-23`, `2026-08-16`, `2026-08-16`.

### 3.4 · A log entry written on race day still speaks in the present tense, three weeks on
**Screen:** Races → THE LOG → RACE REPLACED (2026-08-16)
> *"**Today's race** counts as real fitness evidence … so **the days ahead should** account for
> that rather than read today as banked training."*
Read on 3 September about a race on 16 August.

### 3.5 · "28.4 mi of 17 planned" stated as if nothing happened
**Screen:** Races → THE LOG (2026-08-23)
A 167% overshoot, reported flatly, followed by *"all easy by design."*

### 3.6 · Week 1 is labelled QUALITY and contains zero quality sessions
**Screen:** Block → EVERY WEEK → Wk 1 expanded · **Shot:** `12-block-wk1-zero-quality.png`
`Wk 1 / QUALITY / 38 mi`; expanded: `Long run 13 mi · Quality sessions 0 · Mileage 38 mi`. The
Races log for the same week says *"all easy by design."* One week, two claims, on two screens.

### 3.7 · The same session has two names on two screens
**Screens:** Training calendar / Today (past day) say **"Threshold · 8.5 mi"** and render
**THRESHOLD** as the poster. Past runs says **"Intervals · 4×1.0mi @ 7:02"**.
**Shots:** `04-training-calendar.png`, `05-past-run-earlier.png`, `25-pastruns-naming-inconsistent.png`

### 3.8 · One shoe, two mileages
`Asics Megablast` — **62.7 mi** on the run-detail screen ("62.7 mi on them"), **77.7 mi** on
the Shoes screen. Same present-tense phrasing, 15 miles apart.
`NB SC Trainer v3 - red` — **12 mi** on Today, **12 mi** on race detail, **12.4 mi** on Shoes.
**Shots:** `07-run-bottom-log.png`, `23-shoes-zero-mi-labels.png`

### 3.9 · Settings says 5 days a week; the plan prescribes 6
**Screen:** Settings → TRAINING vs Training calendar · **Shots:** `30-settings-top.png`, `04-training-calendar.png`
`Days per week: 5`. This week: Mon, Tue, Wed, Thu, Fri and Sun are all running days; only
Saturday is rest. That is six.

### 3.10 · "Cadence, across the 7 reps" on an easy run whose own coach line says six strides
**Screen:** Past runs → Wed 2 Sep · **Shot:** `26-rundetail-second-surface-7-reps.png`
`Work executed` says *"Six strides after, walk-backs taken."* `READING` says *"Cadence, across
the 7 reps."* Same thing, two counts, 400 points apart, and "reps" is the wrong word for
strides on an easy run.

---

# 4 · Visual defects

### 4.1 · Scrolling content collides with the system clock on every screen
**Shots:** `02-today-statusbar-collision.png`, `03-today-panel-under-clock.png`, and visible in
`10`, `13`, `18`, `25`, `29`.
There is no top safe-area inset, scrim or fade. The **INTERVALS** display type scrolls straight
over the clock and the Dynamic Island; on Block, "Miles run" lands on "12:06"; on Races,
"Big Sur M…" and "3:36:…" sit under the wifi and battery glyphs. This is on every scrolling
screen in the app and it is the first thing that reads as unfinished.
The design contract is explicit: *"One scrolling content band **between** the status bar and
the bottom chrome."*

### 4.2 · Measured contrast failures on the light gradient panels
Sampled from the PNGs, WCAG relative luminance. Ink vs its own local ground:

| Screen | Element | Ratio | Needs | |
|---|---|---|---|---|
| Races | `94 days out` kicker (~14px) | **2.98 : 1** | 4.5 | **fail** |
| Races | `Goal` plate label (~13px) | **3.00 : 1** | 4.5 | **fail** |
| Block | `Quality share` plate label | **3.11 : 1** | 4.5 | **fail** |
| Block | `Long run` plate label | **3.30 : 1** | 4.5 | **fail** |
| Races | `Projected` plate label | **3.34 : 1** | 4.5 | **fail** |
| Races | `2 A races this season` | **3.92 : 1** | 4.5 | **fail** |
| Block | `14 weeks to California International Marathon` | **4.19 : 1** | 4.5 | **fail** |
| Block | `BLOCK` place label (~26pt) | 3.81 : 1 | 3.0 | pass |
| Block | `33%` value (large) | 3.92 : 1 | 3.0 | pass |

The pattern is specific and fixable: it is the **dimmed secondary ink** (≈`#E6E0F8` / `#D5E6EF`)
on the **light half of a light ramp**, made worse inside the translucent stats plate, which
lightens the ground under the very labels that were already the dimmest thing on it.
The dark-ink orange panels on Today measure **5.17 – 8.25 : 1** and are fine — this is the
light-ink half of `PanelInk` only. **Shots:** `09-block-top.png`, `16-RACES-projected-no-tilde.png`

### 4.3 · "September 3" wraps mid-word to "Septembe / r 3"
**Screen:** Block header · **Shot:** `09-block-top.png`. On the header of a primary tab.

### 4.4 · The phase-arc labels sit on two different baselines
**Screen:** Block → THE ARC · **Shot:** `11-BLOCK-duplicate-coach-line.png`
`QUALITY` and `TAPER` are on one baseline; `RACE-SPECIFIC` drops to a second line below them.

### 4.5 · The Block stats plate does not share a baseline
`Quality share 33%` and `Long run 15 mi` sit on one baseline; `This week's mileage` wraps to two
lines and pushes `45 mi` 33px lower. **Shot:** `09-block-top.png`

### 4.6 · The race-detail course caption is a four-column collision
**Screen:** Race detail → COURSE · **Shot:** `19-racedetail-course-caption-soup.png`
`722 ft gain` | `Net -130 ft` | `Measured elevation differs from the listed course profile.`
(3 lines) | `Measured from GPS.` (2 lines) — four items on one row at four different vertical
alignments, two of them sentences. The two sentences also say the same thing twice.

### 4.7 · Bottom-sheet dead space
**Shots:** `14-cutback-refusal-deadspace.png`, `13-change-the-plan-sheet.png`
The refusal state is one line of text and one action above roughly **950 points of empty
black**. Every sheet in the app uses one fixed tall detent regardless of content.

### 4.8 · A system date picker dropped into a designed app
**Screen:** Change the plan → Travel · **Shot:** `15-travel-datepicker.png`
`9/4/26` and `9/10/26` — the app's fourth date format. Both pills are trailing-aligned inside
full-width tiles, leaving a large empty grey field to the left of each.

### 4.9 · The live-run screen renders a large empty hole where the heart tile belongs
**Screen:** Live run (outdoor) · **Shot:** `28-liverun-outdoor-empty-tiles.png`
Roughly 200 points of black between the PACE tile and the "No heart rate source" note. The
PACE tile itself is ~250 points tall containing one small red dash.

### 4.10 · Four different date formats
`Friday, September 4` (move-a-day) · `Sun, Sep 13, 2026` (schedule) · `9/4/26` (travel) ·
`2026-08-16` (evidence, coach log). Plus `Mon 31` in the calendar and `AUG 24 → AUG 30` in
Past runs.

### 4.11 · Inconsistent AppBar top inset
Training calendar puts its title tight under the status bar; Shoes and Settings leave roughly
110–120 points of empty black above theirs. **Shots:** `04`, `23`, `30`.

---

# 5 · Clunk

### 5.1 · Future days in the training calendar are not tappable
Tapped `Fri 4 · Easy · 5.5 mi` — nothing, not even a press state. Only past and today open.
The screen's whole job is "what's coming". `04-training-calendar.png`

### 5.2 · Move-a-day is a four-step drill with a one-option last step
Change the plan → Move a day → *Which session* (2 options) → *Move it to* (**1** option:
`Saturday, September 5 · Rest`) → trade-off. The app already knows the only answer.

### 5.3 · Tapping the active tab does nothing
No scroll-to-top, no pop-to-root. Verified on Today, Block and Races.

### 5.4 · Two doors to the same feature, with different names
`Block → Change the plan → Travel` and `Settings → TRAVEL → Travel windows`.
`Block → Change the plan → Move a day` and `Block → Find the best day`.

### 5.5 · Two sign-outs, two treatments
Account sheet: `Sign out / End this session on this device ›` (a navigation row with a chevron).
Settings: a full-width fault-red `Sign out` button. Same action, two designs, one tap apart.

### 5.6 · The RUN → Outdoor transition shows ten seconds of pure black
**Shot:** `27-LIVERUN-blank-black.png`. No tab bar, no content, no spinner, no way back. On the
most time-critical action in the app.

### 5.7 · The loading skeleton does not reserve the layout
Past runs, run detail and race detail all render the *same* six-row skeleton card followed by a
screen of black, then swap to a completely different layout. The design's rule is *"reserve
their final layout space always"*. **Shots:** `27`, and the skeleton before `25`/`26`.

### 5.8 · Bare unlabelled counters
`THE SCHEDULE  5`, `COMPLETED  6`, `EVERY WEEK  All 15` — right-aligned numbers with no unit or
noun, two of which look tappable and are not.

---

# 6 · Polish

1. **`~>` reads as an arrow.** Today's work tile shows `~> 168 bpm (Z5 VO2 / Max)`. The `~` is
   the server's hand-written modelled mark (`lib/training/prescriptions.ts:371`) baked into a
   string in body ink. The app **retired the amber tilde app-wide** on 2026-08-21 on David's
   instruction (`ValuesV5.swift`: *"we dont need the tilde. its obvious and implied"*), so this
   is now the only tilde left in the product and it means nothing. Say "above 168 bpm".
2. **"EARLIER"** as the place label on a past day. It names no day. The week strip carries the
   identity; the headline should too.
3. **"Not feeling right · Report symptoms and pause today"** rendered on a run screen for a run
   two days ago.
4. **"Move or skip" said three times in one card**: row label, sub-label
   ("Move to another day, or skip it"), and expansion header ("Move or skip this run").
5. **"all easy by design." three times in four log cards.**
6. **`0 mi` under every shoe bar.** Deliberate (it names the axis origin, replacing a worse
   "New" badge — `ShoesV5.swift` says so), but it renders in the same 13px quiet ink as
   `500 mi retirement`, which *is* a value, so it still reads as one. Not edited.
7. **`no faster than 8:22 /mi` twice on Today** (warm up and cool down) and
   **`Week 2 of 15` four times** across Today's panel, the account sheet, Block's `Weeks in`
   and Block's `All 15`.

---

# 7 · What is already good — do not touch this

Genuinely careful work, verified on screen:

- **The dark-ink treatment on the light day-state gradients works.** Today's quality ramp
  measures **8.25 : 1** (TODAY), **6.18 : 1** (INTERVALS), **5.17 : 1** (6.5 mi),
  **6.44 : 1** (kicker), **4.79 : 1** (week line). `check-panel-ink.sh` earned its place.
- **The `#` run-id bug is genuinely fixed.** `fetchV5RunDetail` now percent-encodes, and the
  log shows `GET /api/runs/…-2026-09-02%230919 200`. Both of this runner's most recent runs
  open correctly. That is the "That run is not in your log any more" bug, closed. I checked the
  sibling call site `/api/v5/race/\(slug)` for the same shape — `slugify()` reduces to
  `[a-z0-9-]`, so it is safe.
- **The refusal state is exactly right.** `Week 3 is already a cutback.` with an amber rail and
  a single `Leave it alone` — a refusal that reads as an answer, not an error. Precisely what
  the contract asks for.
- **The route map.** CARTO dark tiles, an amber→orange pace gradient, and an honest legend:
  *"Amber slowest, orange fastest. Colour reads speed, not a grade."*
- **The coach voice, wherever it appears.** No hype, no exclamation marks, no emoji, no em
  dashes. *"This sits outside what your current threshold range predicts. It is noted, and the
  next session like it will settle whether the number moves. The plan is unchanged."*
  *"That comes off a training run two days ago, so it is a lead rather than a result. A race
  would settle it."* This is the best thing in the app.
- **The "Change the plan" trade-off machinery.** Propose-then-confirm with a state token, five
  real scenarios, and a sheet that can say no.
- **Honest absence, done properly.** *"No heart rate source · running from the phone with no
  watch paired."* — a stated fact, not a blank tile.
- **Expand-in-place** is used consistently and works: shoes, move-or-skip, week rows,
  completed-race rows. `Move to Saturday · Sits before Sunday's long run` is a real
  explanation, not a label.
- **Tabular figures and the type system.** Numerals align everywhere, the display face is
  correct, and nothing renders below 12px.
- **The write barrier.** It refused the one mutating request this session produced, named the
  reason, and named the remedy.

---

# 8 · What I changed

One fix, in a file no other agent has touched since 2026-08-28:

**`native-v2/Faff/Faff/ViewsV5/SettingsV5.swift`** — the Strava row passed the same string as
both `sub` and `value`, rendering "Not connected" twice on one row. Dropped the `sub`.

**Verified per Rule 13, by rendering it:** rebuilt signed, reinstalled on the simulator,
relaunched against the read-only server, and walked back to Settings → DATA. The row now reads
`Strava` … `Not connected ›`, once.
Before: `31-SETTINGS-strava-not-connected-twice.png` · After: `32-FIXED-strava-row-said-once.png`.

This does **not** fix §2.1's underlying wrongness — the row now says "Not connected" once
instead of twice, and it is still the wrong answer until the `StravaConnection` mirror is
wired for v5.

Everything else is structural and stayed in this catalogue: §3.1 is a one-line server change in
a file another agent shipped to yesterday; §1.1–1.3 are shell/navigation; §2.1's real fix is a
wiring change across `HostsV5`.

**Needs an app release:** §1.1, §1.2, §1.3, §1.4, §1.6, §2.1, §2.2, §4.1, §4.2, §4.9, §5.3,
§5.6, §5.7, and the fix above.
**Server-side only, no release:** §3.1, §3.3 (log ordering), §3.4 (tense), §3.7 (session
naming), §6.1 (`~>`).
**Either:** §3.8, §3.9, §4.10 — these are "one quantity, one name" decisions before they are
code.

---

# 9 · Two things I could not settle, and am not going to guess about

1. **Background recording.** The RUN sheet and the location prompt both say an outdoor run
   *"keeps recording with your screen locked and the phone in a pocket."*
   `docs/faff-iphone-design-contract.md` §4 says the opposite: *"Recording is
   **foreground-only** — a phone in a pocket with the screen off stops the run."* One of them
   is wrong and a runner will lose a run over it. I cannot test backgrounding in the simulator.
2. **The design contract has drifted in two places** and should be updated rather than treated
   as a defect list: the amber `~` modelled mark was deliberately retired app-wide on
   2026-08-21, and the Races decision card (verdict + safe/stretch + three target buttons) is
   absent, which is consistent with the standing "the coach never renegotiates a stated goal"
   rule. Neither is a bug; both make the contract misleading to the next reader.
