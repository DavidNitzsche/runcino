# faff.run — UX Bloat Audit, Synthesis

**2026-08-31. Scope: iPhone + Watch (the app's actual focus, per CLAUDE.md's
locked 2026-08-31 decision). Web was audited too (`web-v2/app/**`,
`components/faff-app/**`) but is deprioritized — findings preserved for the
record in a separate section at the bottom, excluded from the action list.**

Six sub-audits fed this synthesis, each reading the real component trees, not
guessing from names: **Today** (`TodayBeforeV5.swift`, `TodayAfterV5.swift`,
`TodayChangedV5.swift`), **Races** (`RacesV5.swift`, `RaceDetailV5.swift`,
`AddRaceV5.swift`, `CourseImportV5.swift`), **Block/Plan** (`BlockV5.swift`,
`PacesMovedV5.swift`, `ReturnToRunningV5.swift`), **RunLog/RunDetail/Settings**
(`RunLogV5.swift`, `RunDetailV5.swift`, `SettingsV5.swift`, `ShoesV5.swift`,
`SickV5.swift`, `TravelV5.swift`, `StateScreensV5.swift`), **Watch** (all of
`native-v2/Faff Watch App`), and **Web** (deprioritized, see bottom).

Grading rubric throughout: `docs/PRODUCT_UX_SIMPLIFICATION_DOCTRINE.md`'s one
rule — "only surface information that changes what the runner should
understand or do next" — against the four questions (slow down today? why
did tomorrow change? is my goal realistic? is training working?).

---

## TOP PRIORITY — correctness, not just bloat

### 1. Race-prediction numbers can disagree across the Races surface (Rule 16 recurrence)

The exact defect class Rule 16 in `CLAUDE.md` documents as a previously-fixed
incident (three different projected finish times live at once) has partially
recurred, and it's iPhone-native, not web:

- `RacesV5.swift`'s panel "Projected" stat and the `TrendBars` headline are
  **provably the same value** (I independently verified this: both trace to
  one `projectedSec` computed once in `web-v2/app/api/v5/races/route.ts`,
  reused twice) — this part is fine, not a bug.
- But the decision card's **"Stretch target"** and **"Safe target"** tiles
  come from a *different* backend function (`composeRaceCard` /
  `lib/training/goal-assessment.ts`), which models feasibility targets, not
  the raw current projection. That's plausibly a legitimate, distinct
  concept (a target you could realistically hit vs. where you're projected
  to finish today) — but **nothing in the UI labels the difference**, so the
  runner sees three or four clock times on one screen with no way to tell
  which kind of number is which.
- `RaceDetailV5.swift`'s own code comment self-documents this is *"the third
  copy of the Goal/Projected/Gap row"* on the app (the panel plate and the
  decision card's target tiles are the other two).
- `RaceDetailV5.swift`'s `coachGoalSection` (shown only when the runner never
  set a goal) can render **four simultaneous modelled finish-time numbers**
  on one screen — a coach-set A/B/C tier plus the stats row's own
  "Projected" — two of which sit two seconds apart in the sample data.

**Fix:** label every projection-shaped number with what kind of number it is
("current projection" vs. "a target that's still realistic"), and confirm
(quick backend check, not a rebuild) whether `composeRaceCard`'s targets
should also route through the shared `resolveRaceProjection` rather than a
second, adjacent function. This is the single highest-value fix in this
audit — it's the exact bug class this app has already paid to fix once.

### 2. Raw VDOT decimals leak directly into runner-facing coach-voice copy

`RacesV5.swift` — four separate locations: the decision-card question copy
("VDOT reads at 51.2 against a goal that only needed 49.8"), the evidence
row ("VDOT 47.9"), and the schedule-row "Read"/"Reads as" detail lines
("VDOT 49," "VDOT 47.9," "VDOT 46.2," "VDOT 43.8"). This is the doctrine's
own explicitly-named anti-pattern, verbatim, not a borderline case.

**Fix:** replace with comparative coach-voice language ("your fitness now
covers the goal" / "you're about a minute short of the pace this needs")
instead of printing two decimals and letting the runner do the math.

### 3. The goal-acceptance card needs an explicit policy decision

`RacesV5.swift`'s `RaceDecisionCardV5` has a `.decision` shape whose answer
buttons include **"Take 3:16:45"** — accepting a revised race target — POSTed
via `API.answerGoalCard`. It's opt-in (three co-equal choices including
"Hold the goal," not a forced default), which is meaningfully different from
the historical incident CLAUDE.md documents (a cron that unilaterally
PATCHed a stated goal with no equal-weight alternative). But it is still,
unambiguously, a card that renegotiates a stated race goal, and the standing
rule is "the coach projects, it never renegotiates a stated goal." Whether
this opt-in, three-way framing satisfies that rule or still violates it by
existing at all needs an explicit decision — flagging rather than silently
picking a side, per the source audit's own posture.

### 4. Live functional bugs (unambiguous, fix regardless of any design decision)

- `WorkoutDetail.tsx` (iPhone) — the "PLANNED · WK 14" badge is a **literal
  hardcoded string**, not derived from any week variable. Shows on every
  non-today workout regardless of actual week.
- **Splits were being silently dropped at ingest** (found and already fixed
  by the Evidence Engine work tonight, noted here for completeness — a
  duplicate, stricter tolerance check in `/api/ingest/workout` was deleting
  real per-mile data before it ever reached the database).
- **RPE loader bug** (also found and fixed tonight) — `post_run_rpe` was
  keyed wrong and would have returned zero RPE for every run in the app.

---

## The readiness-as-bare-number pattern — the single most-repeated finding

Doctrine: "readiness should render as a coaching VERDICT (proceed / caution
/ reduce / recover / stop), not a numeric score." This shows up as a bare
number, unguarded, in at least three places:

- **iPhone Today** — `TodayBeforeV5.swift`'s "Readiness" row in the "Where
  you are" section renders a bare score (e.g. "64") as the primary/default
  rendering. The pillar breakdown behind a "why?" tap is correctly gated —
  only the default row itself is the problem.
- **Watch** — confirmed CLEAN. Explicitly checked: no numeric readiness
  score renders anywhere on the watch. A `WatchReadiness(score:)` fixture
  exists in `WorkoutRootView.swift` but is dead code — no live call site
  routes to it, left over from a retired "readiness glance" tab. Worth
  deleting outright so it can't get wired back in by accident (a numeric-
  score type sitting unused in a file with an explicit "readiness never
  appears as a score" code comment is exactly the kind of landmine Rule 20
  warns about).

**Fix (iPhone only, one location):** replace the bare score with the band
word ("Building" / "Primed" / "Caution" etc.) as the default rendering;
leave the numeric pillar detail exactly where it already is, behind "why?".

---

## HIDE cluster — raw sensor/compliance data as permanent rows, should demote

Grouped by theme since the same pattern recurs across screens:

**Raw HR zones as a permanent chart** (doctrine's own named example):
- iPhone Today after-run — `zoneTile` ("Where the heart sat," full 5-segment
  bar) renders unconditionally.
- iPhone RunDetail — same chart, same fix needed, one shared component.

**Cadence / ground-contact-time / vertical-oscillation / power** (doctrine
names cadence explicitly):
- iPhone Today after-run `readingSection` — "Cadence" and "Cadence, across
  the work" rows, unguarded standing rows.
- iPhone RunDetail `readingRows` — "Cadence" row, no ceiling/comparison/
  verdict attached anywhere on the screen it could support.
- **Watch — already correctly handled.** Cadence is one swipe away from the
  primary running face, never default-visible, drops out cleanly when
  absent — this already satisfies the doctrine's bar and needed no fix. One
  deliberate, well-reasoned exception exists (Strides phase board uses
  cadence as the *primary* metric, with the code explaining exactly why GPS
  pace lags on a 15-25s stride and cadence responds instantly) — a genuine
  case where the "wrong" metric is actually right, worth citing as a model
  for how to make an exception correctly.

**Workout-compliance percentages/fractions** (doctrine names this by name):
- iPhone Today — "This week" row shown twice (before-run "77%," after-run
  "86%") as a bare percentage list row.
- iPhone Block — "So far in this block" section: "Sessions 38 of 42 · 3
  missed, 1 moved" and "Miles run 234 of 656" as permanent stat tiles, plus
  the identical pattern repeated **per completed week** (up to 6 more times)
  in the week-by-week detail list. This is the clearest single doctrine hit
  in the Block audit — a 3-row stat-tile cluster shaped almost exactly like
  the doctrine's own "giant fitness dashboard" negative example, just
  smaller.

**Fitness sub-scores as a standing card:**
- iPhone Today "Training Form" tile — the ring + one-line helper is fine
  (KEEP), but a raw "Fitness N · Fatigue N" subtext prints permanently
  beside it, restating the same thing the ring already says in words.

---

## MERGE cluster — the same fact told more than once on one screen

- **iPhone Today after-run:** distance/pace/avg-HR appear **up to three
  times** on one screen — the poster stats row, the "asked vs ran" table,
  and a server-composed recap sentence that restates the same three numbers
  in prose. Confirmed against the file's own real sample data, not
  hypothetical. The client already has a dedup guard for one of the three
  overlaps (`hrAvgShownInAskedVsRan`) but nothing analogous for the recap
  sentence — worth extending that guard rather than adding a new one.
- **iPhone Races:** the Goal/Projected/Gap triple repeats three times
  (panel plate, decision-card target tiles, schedule row) — self-documented
  in the code's own comment as "the third copy," see Top Priority #1.
- **iPhone Block:** "This week" mileage shown in both the panel stat and the
  current week's own row in the week list; phase-remaining stated three
  ways (kicker, coach line, phase-bar position).
- **Watch:** one confirmed live duplicate — the "already ran today" lobby
  recap draws average heart rate twice (once as "Heart · under 145 · 121,"
  once as "Heart rate, avg · 121 bpm") in the same fixture. Given these rows
  are server-composed, this needs a check on the live `build-workout.ts`
  composer, not just the client.

---

## DELETE cluster — dead code, vanity numbers, no decision served

- iPhone Today — `StandingRecAdvisory`, an already-gutted component (~100
  dead lines, call site is `{false && (...)}`) — safe to remove outright.
- iPhone Watch — the dead `WatchReadiness(score:)` fixture (see readiness
  section above).
- iPhone Watch — "Lap" control was already deleted for having no visible
  downstream effect — cited as the right precedent, not a new finding.

---

## KEEP — model examples worth replicating elsewhere

These aren't just "fine," they're the pattern the rest of the app should
copy:

- **Watch is the strongest surface in the whole audit.** The countdown
  screen ("nothing moves except the number"), the recovery-phase board
  (deliberately omits pace because "a recovery is not asking for one"), the
  spoken-cue system (drawn text and spoken text derive from one shared
  source, structurally unable to diverge), the ceiling-override rewrite
  (replaced an unanswerable alert with two real choices), and the End-
  confirm pattern (states what's unfinished as fact, never a warning) are
  all genuinely excellent and match the doctrine closely already.
- iPhone Today's `RecoveryWindowStrip` — explicitly fixed a real bug where a
  recovery window's span was stated three inconsistent ways; now one source.
- iPhone Today's after-run recap tile — the doctrine's own worked example
  ("Good easy miles… we're not treating that as a fitness issue"),
  reproduced almost verbatim in the real sample data.
- iPhone RaceDetail's result-logging flow — implements the race-data
  source-of-truth checklist correctly (provisional label, tilde, no drawing
  once confirmed).
- iPhone Block's plan-change sheet — every refusal path (known-unavailable,
  engine-declined, network-failed) is implemented with the correct distinct
  treatment for each, no shortcuts.

---

## Architectural question for a deliberate decision (not a quick fix)

**`components/redesign/season/SeasonClient.tsx`** (web-side, but the finding
matters regardless of web's paused status) is a complete, already-built
"Progress" screen that matches the target doctrine almost exactly — single
goal-race hero, categorical (not decimal) confidence, "where the gap sits,"
"the lever" (one improvement, not a list) — and its own header documents
that a forced-goal-decision bug was already found and fixed in this exact
file on 2026-08-30. It is fully orphaned from navigation. Since web is
paused, this isn't an active action item, but it's worth knowing this
design already exists and works when iPhone's own Progress-shaped surface
gets built — don't design that from scratch, this is most of the pattern
already proven out.

---

## Totals (iPhone + Watch only)

Approximate, by verdict, across the five iPhone sub-audits + Watch — exact
row counts are in each sub-audit's own report, preserved in full in this
session's transcript:

- **KEEP:** clear majority of items across every screen — the app is not
  broadly over-built, the issues are concentrated in specific, identifiable
  clusters (HR zones, cadence/GCT, compliance percentages, readiness score).
- **MERGE:** ~10-12 confirmed instances, concentrated on Today after-run and
  Races.
- **HIDE:** ~12-15 confirmed instances, concentrated in the after-run/detail
  screens' "Reading" sections and Block's "So far" section.
- **DELETE:** small (3-4) but include real dead code, not just opinions.
- **Correctness bugs surfaced incidentally:** 4 (the race-prediction
  labeling gap, the hardcoded week badge, plus the two already-fixed
  ingest/RPE bugs from the Evidence Engine work).

**The single biggest opportunity:** fixing the Rule-16 recurrence on Races
(Top Priority #1) — it's the only finding in this audit that's a trust/
correctness issue rather than a polish issue, it's iPhone-native (fully in
scope), and the underlying shared resolver already exists, so the fix is a
labeling and one-function-reroute question, not new engineering.

---

## Web findings — deprioritized, preserved for the record only

The full web sub-audit (`web-v2/app/**`, `components/faff-app/**`) is
extensive and found real issues of its own — most notably the *web-side*
instance of the Rule 16 recurrence (`TrainView.tsx` and `GapPanel.tsx`
bypassing the shared `resolveRaceProjection` resolver via a stale fallback
field whose own code comment names it as "the Rule 16 defect"), several
hardcoded/lying UI states (a settings form claiming every integration is
"CONNECTED" regardless of truth, a live unit toggle nothing downstream
honors), and the same readiness-as-bare-number pattern in two more
locations (`HealthView.tsx`, `Drawer.tsx`).

**None of this is being actioned right now.** Per CLAUDE.md's locked scope
(2026-08-31): "the web frontend is ignored until further notice... don't
propose it, don't fix it, don't spend effort on it, until [David] says
otherwise." Recorded here so nothing is lost if/when web work resumes — the
full findings live in this session's transcript and can be re-synthesized
into their own action list at that time.
