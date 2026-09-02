# Race specifications · the four races in the CIM block

Resolved 2026-09-02 against production, read-only, through the same functions
the authoring transaction calls. Nothing was written. The proof is in
§Harness at the end, and the raw output is beside this file in
`race-specs-evidence.json`.

**Every pace below came from a twelve-argument `buildWorkoutSpec` call made by
`persistedDayShape`, and from `refreshRaceRowsForPlan` run afterwards.** The
previous preview's identical 6:52/mi across the 10K, the half and the marathon
was a seven-argument call. It is gone. The four races now read 6:56, 7:15,
7:02 and 7:23 per mile, and each number has an owner.

Anchors this compose priced the block at: threshold 7:10/mi (VDOT 47.8,
direct, confidence 0.84) · interval 6:41/mi · easy ceiling 8:22/mi · marathon
7:52/mi (range 7:40 to 8:08, personal endurance exponent 1.083) · LTHR 168 ·
max HR 183.

---

## 1 · 2026-09-13 · Santa Monica 10k · 6.2 mi

**Role.** B. From `races.meta.priority`. The `race_role` card has never been
answered for this race (`meta.plannedRole` is null), so the plan uses its
default B framing rather than one he chose.

**Intended purpose.** A raced tune-up eleven days out, taken at race effort.
The plan's own words on the row: *"Santa Monica 10k. B race · race effort.
Recovery days follow before quality resumes."* The week is cut to 24.4 mi with
no long run, there is a three-day mini-taper into it, and the four days after
it are easy only.

**Stated goal.** None. `meta.goalDisplay` is null. Because there is no stated
goal, the coach sets one.

**Current projection.** 42:59, likely range 42:07 to 43:51, confidence 0.51.
Basis `durability_blend`, primary limiter endurance. Expected on race day is
the same 42:59, because at eleven days out with a taper inside them the engine
credits 0.00 VDOT of gain over 0 build weeks. Confidence on the race-day
figure drops to 0.33 and its basis reads `current_projection`, not
`trajectory`.

**Prescribed execution target.** **43:00 · 6:56/mi**, band 6:51 to 7:01/mi.
Source `expected_race_day`. The engine's own sentence: *"No stated goal · race
to where this build is expected to land you."*

**Pace plan.**

| Segment | Miles | Pace | Cue |
|---|---|---|---|
| Settle | 0 to 1 | 7:03/mi | Bank nothing |
| Target pace | 1 to 6.2 | 6:55/mi | Repay the opening, then hold |

Course: 202 ft of climb, the hard stretch a 104 ft grind on San Vicente
between miles 3 and 4.8, then 92 ft down to the line.

**HR and effort guidance.** Expect 168 to 176 bpm. Ceiling 168 through mile 2,
late allowance to 181, checkpoint at mile 2 with an abort at 179.
**Informational only.** Zero comparable efforts in his history at this
intensity and duration, so the band is the doctrine band for the distance and
a population reference, not a read of him. The row records that honestly:
`informational_only: true`, reasons `NO_COMPARABLE_EFFORTS_POPULATION_REFERENCE`.

**Abort, switch and restraint rules.**

- Mile 2 check: avg HR over 179 · switch to the B plan.
- Mile 2 check: pace slower than 7:17/mi (437 s/mi) · switch to the B plan.

No restraint rule. This is a full race effort by design.

**Effect on adjacent training.**

| Date | Session |
|---|---|
| 09-10 | 5.5 easy, *"Inside the mini-taper for Santa Monica 10k · no quality this close."* |
| 09-11 | 2.0 shakeout, 4×20s strides |
| 09-12 | Rest |
| **09-13** | **Race** |
| 09-14 to 09-17 | Easy only, 6.0 / 5.0 / 6.0 / 5.0, tagged *"Post-race recovery · day N after Santa Monica 10k"* |
| 09-18 | First quality back: 2×1.5 mi @ T, 3 min jog, *"Cruise-interval re-entry, light end"* |

Week of 09-07 is 24.4 mi and carries no long run.

**Findings on this race.**

1. **Two coach-set A/B/C tables are live for this one race, and both reach the
   same screen.** `resolveRaceOutlook` produces A 42:05 · B 43:00 · C 43:50
   from the expected-race-day range. `loadCoachGoalForRace`, which is what
   `RaceDetailV5` actually draws under the words COACH SET, produces A 42:45 ·
   B 43:40 · C 44:30, hill-adjusted by 39 s for 35.2 ft/mi. The same screen
   draws "Run the day at 43:00 · 6:56/mi" from the first and the tier line
   from the second. The A times are 40 s apart. The hill adjustment is applied
   to one and not the other.
2. **The race-morning brief does not exist for this race.**
   `GET /api/race/[slug]/execution-plan` returns 404, *"no goal time set ·
   execution plan needs a goal"*, because it gates on `meta.goalDisplay` while
   every other race surface gates on the outlook target. So warm-up timeline,
   heat rules, B-goal trigger, per-mile splits and fuelling are all absent for
   the first race of the block, on a course whose own notes say the marine
   layer can burn off mid-race. See also §Cross-cutting finding 3.

---

## 2 · 2026-09-26 · Dodgers · 6.21 mi

**This is the one to read carefully.**

**Role.** C. From `races.meta.priority`. The `race_role` card does not fire for
C races at all (`generate.ts`: *"the race_role card never fires for C"*), so
there is no answered role and no role-shaped prescription.

**Intended purpose.** The week's quality session, run with a bib on. The plan's
own words on the row: *"Dodgers. C race · this is the week's quality session.
Run it as the workout. Target 7:15/mi."* The rest day moves to 09-24 to make
room, and its note says so: *"Off. Dodgers takes this week's quality slot; rest
moves here."*

**Stated goal.** 45:00 (7:15/mi). His, from `meta.goalDisplay`.

**Current projection.** 43:04, likely range 42:12 to 43:56, confidence 0.51.
Expected on race day 42:56, range 42:04 to 43:50, from +0.35 VDOT over 1.4
build weeks, bounded by runway.

**Prescribed execution target.** **45:00 · 7:15/mi**, band 7:10 to 7:20/mi.
Source `stated_goal_within_range`. Feasibility `comfortable`, gap −124 s. The
engine's sentence: *"Your goal is at or slower than the expected result · race
to your goal."*

**Pace plan.**

| Segment | Miles | Pace | Cue |
|---|---|---|---|
| Settle | 0 to 1 | 7:22/mi | Bank nothing |
| Target pace | 1 to 6.21 | 7:13/mi | Repay the opening, then hold |

The race-morning brief adds a third segment and this line: *"Open at 7:22 for
the first mile. Then it's 7:13s the rest of the way · the early patience comes
back to you. **Push the final mile on feel.**"*

Course: rolling, about 450 ft of gain through Elysian Park, evening start,
typical 75 to 85°F. The brief's heat table fires at 65, 70, 75 and 80°F, the
75°F row reading *"add 15s/mi and consider racing the B plan from the start."*

**HR and effort guidance.** Expect 168 to 176 bpm. Ceiling 168 through mile 2,
late allowance to 181, checkpoint at mile 2 with an abort at 179. Validated
against 3 comparable efforts of his own (observed mean 154 bpm). This is the
full 10K race band, identical to the Santa Monica band eleven days earlier and
identical to what an A-priority 10K would receive.

**Abort, switch and restraint rules.**

- Mile 2 check: avg HR over 179 · switch to the B plan.
- Mile 2 check: pace slower than 7:37/mi (457 s/mi) · switch to the B plan.
- Race-morning brief B-goal trigger, mile 2, HR over 179 or pace slower than
  7:37/mi: *"Back off 15 s/mi for 2 miles and reassess. Finishing strong beats
  blowing up."*

**No restraint rule exists, and no rule anywhere mentions the next day.**

**Effect on adjacent training.**

| Date | Session |
|---|---|
| 09-23 | 9.5 medium-long |
| 09-24 | Rest, *"Dodgers takes this week's quality slot; rest moves here."* |
| 09-25 | 7.0 easy, 6×20s strides |
| **09-26** | **Race, 6.21 mi** |
| **09-27** | **Long run, 18.0 mi**, note: *"Conversational throughout. Build the engine."* |
| 09-28 | Rest |
| 09-29 | 6×1km @ ST pace, 9.0 mi |

**24.21 mi across the pair.** The week totals 56.2 mi, the highest week in the
block to that point. The composer recorded the decision:

```
code:     ACCEPT_AS_HARD_WORKOUT
detail:   18mi long run stands 1 day(s) after Dodgers (6.21mi, C effort)
          · 24.21mi across the pair
citation: Research/00b §"Recovery by Effort" (C race · treat like a hard workout)
          · Research/22 §"Multi-Race Year Planning"
```

### Finding · the controlled C effort is NOT conveyed, and the pairing is invisible

Reported prominently, as instructed. Four separate facts, each verified on the
surface that owns it.

**a · One clause of one string is the entire controlled framing.** The words
*"C race · this is the week's quality session. Run it as the workout"* live in
`plan_workouts.notes`. That string reaches exactly one place a runner looks:
the Today card's `why` line, on the day itself, via `week-loader.ts` and
`why-voice.ts`. It is not on the race detail screen, not on the watch, and not
visible before race morning. `TrainingPlanDay` on the phone has no `notes`
field at all.

**b · Every structured field prescribes an all-out race.** The row's sub-label
is `RACE`. The HR guidance is the full 10K band with a 179 bpm abort. The pace
plan's second segment is labelled "Goal pace" with the cue "Repay the opening,
then hold". The abort rules read "switch to the B plan", which is racing
language. The race-morning brief says "Push the final mile on feel". Nothing
caps the effort, and nothing says hold back.

**c · `priority` is loaded by the race-pace brain and never read by it.**
`RaceForOutlook.priority` is populated in `loadRaceForOutlook` and appears
nowhere else in `lib/race/race-outlook.ts`. The execution target for a C race
is computed exactly as for an A race. The only reason this row is 2:04 slower
than his expected 42:56 is that he typed a soft goal. **If he changed the
Dodgers goal to 43:00, the engine would prescribe 43:00** and nothing in the
system would object, the day before an 18-mile long run.

**d · The app has a C-race framing and it is switched off for this race.**
`lib/race/coach-goal.ts` carries, by name:

```
if (input.priority === 'C') return {
  kind: 'effort', reason: 'c_priority',
  line: 'No time goal. Run it hard and enjoy the day.',
}
```

It is unreachable here because the branch above it returns null the moment a
runner has stated a goal. He stated 45:00, so the one sentence in the codebase
that says a C race carries no time goal never fires on his C race.

**e · Nothing on either day names the other.** The 09-27 long-run note reads
*"Conversational throughout. Build the engine. Course drops 304 ft..."* with no
mention of the race the previous evening. The race row does not mention the
long run. The `placement_compromises` record that states the pairing, with its
citation, is written to `training_plans.authored_state` and **read by no API
route, no web component and no Swift file.** The handback's own
`stage2-plan-generation.md` says as much: *"server-side audit fields no client
decodes."* The engine looked at the pairing, decided, cited its decision, and
told nobody.

A separate agent is implementing a typed exception for this pairing. The
primary-stressor rule is untouched here. This section reports only what the
specification says today.

**f · The race-day step note is written for a marathon.** `spec-card.ts`
attaches `NOTE.race` to the work step of a race day (`workNote`, `case 'race'`),
which the phone draws under the "Race day" group: *"Hold the plan through the
first 5K. Mile 1 decisions are paid for at mile 12."*
This is a 6.21-mile race. The first 5K is half of it and mile 12 does not
exist. The same table's own header says *"Notes are written per PHASE ROLE,
never per distance ... A note that names a distance is a second place for the
card to contradict the plan, so none of these name one."* This one names two.
It lands identically on Santa Monica.

---

## 3 · 2026-11-08 · Run Malibu · 13.1 mi

**Role.** B. `meta.plannedRole` is null, so again the default B framing rather
than an answered role.

**Intended purpose.** A raced half four weeks out from CIM. The row's words:
*"Run Malibu. B race · race effort. Recovery days follow before quality
resumes."*

**Stated goal.** 1:30:00 (6:52/mi). His.

**Current projection.** 1:36:02, likely range 1:33:38 to 1:38:26, confidence
0.51. Expected on race day 1:34:33, range 1:32:06 to 1:37:19, from +1.84 VDOT
over 7.6 build weeks, bounded by runway.

**Prescribed execution target.** **1:32:10 · 7:02/mi**, band 6:57 to 7:07/mi.
Source `stated_goal_clamped_to_range_edge`. Feasibility `aggressive`, gap +273 s.
The engine's sentence: *"Your goal (1:30:00) is faster than the likely range's
fast edge (1:32:06) · race to the edge; the goal stays yours."*

**Pace plan.**

| Segment | Miles | Pace | Cue |
|---|---|---|---|
| Settle | 0 to 1 | 7:14/mi | Bank nothing |
| Find rhythm | 1 to 3 | 7:08/mi | Ease onto target |
| Target pace | 3 to 13.1 | 7:00/mi | Repay the opening, then hold |

**HR and effort guidance.** Expect 161 to 168 bpm. Ceiling 161 through mile 5,
late allowance to 173, checkpoint at mile 5 with an abort at 171. Validated
against 1 comparable effort (observed mean 157 bpm). One effort is thin
evidence and the row says so.

**Fuelling.** 2 servings, about 45 g/hr, at roughly 41 and 82 minutes (miles
5.8 and 11.7). The row carries `fuel_mi: [5, 9, 13]`.

**Abort, switch and restraint rules.**

- Mile 5 check: avg HR over 171 · switch to the B plan.
- Mile 5 check: pace slower than 7:23/mi (443 s/mi) · switch to the B plan.

No restraint rule. Full race effort.

**Effect on adjacent training.**

| Date | Session |
|---|---|
| 11-06 | 2.0 shakeout, *"Loosen the legs for Run Malibu"* |
| 11-07 | Rest |
| **11-08** | **Race** |
| 11-09 | Rest |
| 11-10 to 11-12 | Easy only, tagged *"Post-race recovery · day N after Run Malibu"* |
| 11-15 | 17.0 dress rehearsal, race kit and race fuelling, all at easy effort |

Week of 11-02 is 45.6 mi with no long run. Week of 11-09 is 39.5 mi, a
cutback. The block then turns into its taper.

**Finding · the row contradicts itself on the rebuild.** The note the runner
reads says *"Target 6:52/mi."* The row prescribes 7:02/mi. Ten seconds a mile,
2:11 across a half marathon, on one row.

The cause is structural, not a typo. `embedMidBlockRaces` writes the note at
authoring from the stated goal (412 s/mi), then `refreshRaceRowsForPlan` moves
`pace_target_s_per_mi`, the band, `race_execution.target_sec` and the pace
abort to 422 and **never touches `notes`.** Verified across every writer:
`recompute-paces.ts` sets pace, spec and sub-label only; `race-row-refresh.ts`
sets pace and spec only; `adapt.ts` writes notes only on the field-test
conversion, which cannot reach a race row. So the sentence is frozen at
authoring for the life of the block while the number beside it moves with the
evidence.

The live plan has the same defect in both directions today: Santa Monica reads
*"Coach target 7:24/mi"* against a row at 6:56/mi, which is 28 s/mi and 2:54
across a 10K.

---

## 4 · 2026-12-06 · California International Marathon · 26.22 mi

**Role.** A. The goal race the block is built for.

**Intended purpose.** The block's target. Everything else in this document
serves it. The row's words: *"Execute the plan. Pacing in race-week
briefing."*

**Stated goal.** 3:00:00 (6:52/mi). Untouched. `load_tier_reduced_by_goal` is
false, and `authored_state.prescribed_race_pace` is stamped
`authority: provenance_only`, so nothing reads it back as a number.

**Current projection.** 3:23:50, likely range 3:17:43 to 3:29:57, confidence
0.51, limiter endurance. Expected on race day 3:19:42, range 3:13:28 to
3:26:51, from +2.56 VDOT over 10.6 build weeks, bounded by runway.

**Prescribed execution target.** **3:13:30 · 7:23/mi**, band 7:18 to 7:28/mi.
Source `stated_goal_clamped_to_range_edge`. Feasibility `unlikely_currently`,
gap +19:42. The engine's sentence: *"Your goal (3:00:00) is faster than the
likely range's fast edge (3:13:28) · race to the edge; the goal stays yours."*

The goal is not renegotiated anywhere. The target and the goal are two named
quantities on the row, and the row states both.

**Pace plan.** Course-aware, built from the CIM geometry rather than a flat
split:

| Segment | Miles | Pace | Cue |
|---|---|---|---|
| Folsom Dam drop | 0 to 2 | 7:28/mi | Settle in |
| Orangevale rollers | 2 to 7 | 7:33/mi | Find the rhythm |
| Fair Oaks hills | 7 to 9.5 | 7:27/mi | Find the rhythm |
| Auburn Blvd descent | 9.5 to 10.9 | 7:16/mi | Find the rhythm |
| Sacramento valley | 10.9 to 26.2 | 7:19/mi | Lock goal pace |

**HR and effort guidance.** Expect 148 to 160 bpm. Ceiling 148 through mile
10, late allowance to 165, checkpoint at mile 10 with an abort at 163.
Validated against 4 comparable efforts (observed mean 155 bpm). The strongest
evidence base of the four races.

Training prescription for the block, which is a different number and correctly
labelled as one: **marathon pace 7:52/mi**, *"Threshold 7:10/mi carried to 26.2
mi through your own endurance exponent (1.083), which rests on one marathon so
far. This is today's capacity, not race day's; the rehearsal teaches the
effort, the block earns the pace."*

**Fuelling.** 7 servings, 75 g/hr, 280 g total, roughly every 26 minutes. Row
carries `fuel_mi: [5, 9, 13, 17, 21, 25]`. Carb load 8 to 12 g/kg/day across
36 to 48 h. Breakfast 3 to 4 g/kg, 2.5 to 3 h out. Caffeine 200 mg before the
gun, 100 mg at mile 13, 100 mg at mile 20.

**Abort, switch and restraint rules.**

- Mile 10 check: avg HR over 163 · switch to the B plan.
- Mile 10 check: pace slower than 7:45/mi (465 s/mi) · switch to the B plan.
- Heat table at 65, 70, 75, 80°F, adding 11, 18, 24 and 33 s/mi.

**Effect on adjacent training.** Three taper weeks: 11-16 at 46.0 mi with a
19.0 long, 11-23 at 33.5 with a 13.5 long, race week 11-30 at 44.2. Tune-up
12-01, 5×400m @ 5K pace. Shakeout 12-05, 2.0 mi.

**Two adjacent observations, both verified against the live plan as well as
the rebuild.**

1. **The race-week tune-up carries marathon pace as its headline number.**
   `refreshRaceRowsForPlan` treats `race_week_tuneup` as a race row and
   reprices `pace_target_s_per_mi` on 12-01 to **443 s/mi (7:23/mi)**, the CIM
   execution pace, while `rep_pace_s_per_mi` on the same row stays 401
   (6:41/mi) and the label says *"5×400m @ 5K pace"*. The refresh's own
   comment says a tune-up is *"a rehearsal AT the race's execution pace"*, and
   `TAPER-SHARP-1` says the race-week sharpener is 5K-pace reps deliberately
   **faster** than race pace. Both cannot be right. This lands on his live plan
   today, not only on the rebuild.
2. **The same pass adds a mid-race abort to that interval session.** The
   captured write puts *"Mile 2 check: pace slower than 7:45/mi · switch to the
   B plan"* onto a 4.5-mile 5×400m workout, because `racePaceAbortRule` is
   given the row's own distance and does not ask whether the row is a race.
3. **The warm-up timeline has no clock times.** Every step returns
   `clock: null` because `races.meta.startTime` for CIM is the single character
   `·`. The steps still carry their minutes-before-gun offsets.

---

## Cross-cutting findings

1. **`notes` is frozen at authoring and is the only place the coaching purpose
   of a race is stated in words.** Section 3 has the measurement. It affects
   every race row that the refresh reprices, and it is the sentence the phone
   draws as the Today card's `why`.

2. **The persisted `race_execution` and `race_hr` blocks are read by nothing.**
   Every runner-facing race number is re-resolved at request time:
   `/api/v5/race/[slug]` and `/api/v5/races` call `resolveRaceOutlookBySlug`,
   `/api/watch/today` and `/api/race/[slug]` call `loadEffectiveRaceTarget`.
   The two spec keys are written by `race-row-refresh.ts` and read only by its
   own change detector. This is not itself wrong, since one owner resolves all
   of them, but it means the row is provenance and the screen is the truth, and
   the two can only be compared by a probe like this one.

3. **Two different gates decide whether a race has a plan.** The phone's "Pace
   plan" section is gated on `outlook.execution.targetSec` and renders for all
   four races. The race-morning brief route is gated on `meta.goalDisplay` and
   404s for Santa Monica. One race therefore has a pace plan and no warm-up,
   fuelling, heat table or B-goal trigger.

4. **The race-morning brief is not reachable in the shipping app.** It is
   consumed by `RaceDayView.swift`, which lives under `RootTabView()`, which
   `FaffApp.swift` renders only under the `-faffLegacy` launch argument. In the
   v5 shell the warm-up timeline, heat rules, carb load and B-goal trigger are
   computed and never drawn. Reported as a fact about reachability, not as a
   claim about intent.

5. **`execution.strategyLabel` reaches the phone payload and no view draws
   it.** All four resolve to the same shape, *"Controlled start · X/mi
   average"*, so the same sentence would describe a C-effort evening 10K and a
   goal marathon. The watch has its own unrelated field of the same name,
   built as *"{goal} goal"*.

6. **A formatting defect in the brief's strategy line.** Run Malibu's reads
   *"Then it's 6:60s the rest of the way"*. 420 s/mi is 7:00, not 6:60.
   `composeRaceExecutionPlan` formats that clause differently from every other
   pace on the same screen.

---

## Harness · what was driven, and what was not

**Run:** `npx vitest run --config scripts/p0-proof/vitest.harness.config.ts`
from `web-v2`, with `web-v2/scripts/p0-proof/race-specs.harness.test.ts`.

### The fence

Two independent guards, because one is a claim and the other is a fact.

- The harness sets `process.env.DATABASE_URL` to `DATABASE_URL_RO` before the
  first dynamic import that can reach `lib/db/pool`, and refuses to start if
  that variable is absent. Every application import in the file is dynamic for
  this reason.
- It then asserts the connected role's privileges and stops if any is true.
  Measured: `current_user = faff_readonly`, `plan_workouts` INSERT false,
  UPDATE false, `training_plans` INSERT false, UPDATE false, `races` UPDATE
  false.
- `refreshRaceRowsForPlan` is driven through a `Queryable` that forwards SELECT
  to the read-only pool and **captures** everything else without sending it.

**Result: the production path attempted 12 writes. 0 were issued.** Ten
`UPDATE plan_workouts` and two `UPDATE training_plans`, all captured with their
bound parameters, which is where the finished specifications in this document
come from.

### The production boundary that was exercised

In the order `generatePlan` runs it:

| Step | Function | What it is |
|---|---|---|
| 1 | `composeForUser` | what `generatePlan` stages before it persists |
| 2 | `resolveAuthoringRaceSeed` | what `persistComposedPlan` resolves before opening the transaction, from `race-outlook`, the canonical race-pace owner. Returned `443 s/mi · 11610 s · stated_goal_clamped_to_range_edge` |
| 3 | `persistedDayShape` → `specForComposedDay` → `buildWorkoutSpec` | what `persistPlan` binds into the `plan_workouts` INSERT. **All twelve arguments**, assembled from the same expressions `persistComposedPlan` uses, including `prescribedRacePaceSec` from step 2, `easyAnchorTSec` and the canonical `anchors`. `specForComposedDay`'s own header records that it was extracted so an audit would stop reconstructing this call by hand |
| 4 | `refreshRaceRowsForPlan` → `refreshRaceRowsCore` → `raceSlugForRow` / `planRaceSlug` → `loadRaceForOutlook` → `resolveRaceOutlook` → `raceExecutionSpecFields` → `rulesRepricedTo` → `racePaceAbortRule` | what authoring runs post-persist inside the same transaction, and what owns race pacing |

Step 4 was run twice. Once against the live plan's own rows, untouched, which
is production exactly as the daily cron runs it. Once against the rebuild's
rows from step 3, which is the state the transaction sees one statement after
the INSERT. **Both runs produced the same five paces: 416, 435, 422, 443, 443.**
`resolveRaceOutlook` reads runs, races and profile and no plan data, which is
why the two agree by construction and why this document's numbers hold for the
rebuild as well as the live block.

Then the surfaces, each through its own resolver rather than from the engine
side: `buildRacePacing` on the outlook target for the phone's Pace plan;
`loadEffectiveRaceTarget` plus `composeRaceExecutionPlan` with the
execution-plan route's own argument list and its own 404 gate; and
`loadCoachGoalForRace` for the COACH SET line.

### The harness was made to fail before it was trusted (Rule 18)

Setting `prescribedRacePaceSec: null` in `persistArgs`, which is exactly the
seven-argument shape the previous preview had, and running again:

```
AssertionError: expected 412 to be 443
  expect(cimAuthored?.pace_target_s_per_mi).toBe(seed.paceSecPerMi)
```

412 s/mi is 6:52/mi, the stated 3:00 goal pace, and it is the artifact this
document exists to remove. The argument was restored and the run is green
again.

Two things that assertion also teaches. The **refreshed** pace cannot see this
defect at all: `refreshRaceRowsForPlan` reprices every race row from the
outlook regardless of what authoring wrote, so a broken authoring call still
ends at 443 on the row. The defect is only visible on the authored row, before
the refresh, which is where the check is placed. And the harness carries a
liveness assertion for the same reason: it fails if the production path stops
attempting writes, rather than reporting "0 writes issued" over a path that
did nothing.

### What was NOT exercised, stated plainly

- **`persistPlan` and `mutatePlan` were not run.** They cannot be run without
  writing. `mutatePlan` with `touches: 'authorship'` **commits by design** and
  carries no dry-run branch: its own comment says a rolled-back rebuild would
  leave the runner with no active plan. A rolled-back transaction was not an
  option either, because `faff_readonly` holds no INSERT privilege, so the
  first statement would have failed rather than demonstrating anything. Step 3
  covers the gap as far as it can be covered: `persistedDayShape` returns
  exactly the values `persistPlan` binds, and it is the writer's own function,
  not a reconstruction of it.
- **The Next.js route handlers themselves.** Auth wrapper, JSON serialisation
  and HTTP status. Their composition functions and their gate conditions were
  driven; the handlers were not.
- **No rendering.** Nothing here was verified on a device or a simulator. Where
  this document says what the runner reads, that is traced from the resolver to
  the Swift view by file and line, not seen on a screen. Rule 13 is satisfied
  for the *resolution* and not for the *pixels*, and that distinction is the
  honest one. The surface claims that carry the most weight are the ones in
  §Cross-cutting 2 and §2a, and both rest on grep-complete traces:
  `race_execution` and `race_hr` have no reader outside their own writer, and
  `placement_compromises` has no reader in `app/api`, `components`, or any
  Swift file.

### Nothing unproducible

All ten fields resolved for all four races. Two carry a stated absence rather
than a value, and both are findings rather than gaps in this probe: Santa
Monica has no stated goal, and Santa Monica has no race-morning brief because
the route that builds one gates on the goal it does not have.
