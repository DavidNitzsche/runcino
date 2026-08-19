# Onboarding · five-mode end-to-end QA · 2026-08-19

The front door, run end to end for the first time. Every row below was produced by
driving the real HTTP endpoints with a real production session cookie and then
reading the persisted rows back out of the production database. Nothing here is
inferred from source.

- **Base:** `origin/main` @ `137e2cf2`
- **Server:** `http://localhost:3000` (root checkout, today's code) for the mode runs;
  `http://localhost:3100` (this worktree) for before/after on the two UI fixes.
- **Accounts:** the `…-1231` batch only. `dnitch85@me.com` and `apple-review@faff.run`
  were never touched. Nothing was deleted. No DDL, no hand-edited rows.

| mode | account | user_uuid |
|---|---|---|
| race | `qa-race-20260819-1231@faff.run` | `fb21cb09-0d33-42d7-a848-f56fd81d3f53` |
| goal | `qa-goal-20260819-1231@faff.run` | `bcefea06-43ae-4573-a066-020142915f01` |
| justrun | `qa-justrun-20260819-1231@faff.run` | `227e28a6-a6c1-4954-8d9a-30da16ef00f3` |
| coached | `qa-coached-20260819-1231@faff.run` | `2dfae94a-1a75-4dc6-b244-a79fedee242c` |
| beginner | `qa-beginner-20260819-1231@faff.run` | `b04e35e9-01df-4d1b-9fee-44332be312f6` |

---

## 1 · The matrix

| check | race | goal | justrun | coached | beginner |
|---|---|---|---|---|---|
| onboarding POST 200 | **PASS** | **PASS** | **PASS** | **PASS** | **PASS** |
| mode persisted, not coerced | **PASS** | **PASS** | **PASS** | **PASS** | **PASS** |
| plan authored where one should be | **PASS** | **PASS** | n/a | n/a | **PASS** |
| plan NOT authored where it shouldn't be | n/a | n/a | **PASS** | **PASS** | n/a |
| weekly frequency honoured | **PASS** (3→3) | **PASS** (5→5) | n/a | n/a | **PASS** (2→2) |
| available_days honoured | n/a (unset) | **PASS** | n/a | n/a | **FAIL** — week 0 only (D1) |
| beginner volume | n/a | n/a | n/a | n/a | **PASS** for this path; **FAIL** for the maintenance path (D2) |
| day-one surface: no crash | **PASS** | **PASS** | **PASS** | **PASS** | **PASS** |
| day-one surface: no fabricated numbers | **PASS** | **PASS** | **FAIL→FIXED** (D3) | **FAIL→FIXED** (D4) | **PASS** |
| dosing · 0 enforced findings | **PASS** | **PASS** | n/a | n/a | **PASS** |
| `validateComposedPlan` | **PASS** | **PASS** | n/a | n/a | **PASS** |
| placement invariants | **PASS** | **PASS** | n/a | n/a | **FAIL** — 1 violation (D1) |
| coached keeps authoring nothing afterwards | n/a | n/a | n/a | **PASS** | n/a |
| goal plan visible to the lifecycle | n/a | **PASS** | n/a | n/a | **PASS** |
| surfaces don't render a plan that doesn't exist | n/a | n/a | **FAIL→FIXED** (D3) | **PARTIAL→FIXED** (D4) | n/a |

Separately found, both in the engine and **not fixed** (another agent owns those files):
**D5** race-mode day one is a 10 mi/wk maintenance block for a 20–25 mi/wk runner;
**D6** the maintenance/recovery composers never front-load a first run.

---

## 2 · Mode by mode, with the evidence

### 2.1 race — `qa-race-20260819-1231@faff.run`

Request (`POST /api/onboarding/complete`), a deliberate **low-frequency** runner:

```json
{"distance":"half","date":"2026-12-13","time":"1:45:00","weeklyMi":25,"weeklyFreq":3,
 "histAvg":"15-25","histLong":"6-10","histYears":"1-3","raceHistory":[],
 "name":"QA Race","timezone":"America/Los_Angeles","startDate":"2026-08-19",
 "longRunDay":"sun","connectionsSkipped":true,"birthday":"1990-05-04","sex":"M","height_cm":180}
```

Response (HTTP 200, 8.13 s):

```json
{"success":true,"redirect":"/onboarding?step=done",
 "plan":{"ok":true,"mode":"race-prep","race_slug":"my-half-marathon-2026-12-13",
         "plan_id":"pln_ba76b3a4eb19d3a7","weeks_generated":4}}
```

`profile` read back:

```json
{"goal_race_distance":"half","goal_race_date":"2026-12-13","goal_race_time":"1:45:00",
 "weekly_mileage_target":25,"weekly_frequency":3,"history_avg_weekly_mi":20,
 "history_longest_recent_mi":8,"history_years_running":"1-3",
 "experience_level":"intermediate",
 "user_settings":{"rest_day":"sat","long_run_day":"sun","coached_externally":false},
 "onboarded":"2026-08-19 19:37"}
```

`races` row created and correct — priority A, real `distanceMi`, canonical goal:

```json
{"slug":"my-half-marathon-2026-12-13",
 "meta":{"date":"2026-12-13","name":"My Half Marathon","priority":"A","distanceMi":13.1,
         "goalDisplay":"1:45:00","distanceLabel":"Half Marathon","location":null},
 "plan":{"goal":{"finish_time_s":6300}}}
```

`training_plans`: `pln_ba76b3a4eb19d3a7` · `mode=maintenance` · `race_id=my-half-marathon-2026-12-13`
· `goal_iso=2026-12-13` · 4 week rows · 28 workout rows. Maintenance, not race-prep, because
the half is 116 days out and `BUILD_WINDOW_WEEKS.hm = 12` — by design, `TOTAL_WEEKS =
floor(16.6 − 12) = 4`.

The week the runner actually gets (identical ×4):

```
2026-08-19 dow3 rest  0     "REST"
2026-08-20 dow4 rest  0     "REST"
2026-08-21 dow5 easy  3.0   "EASY"
2026-08-22 dow6 rest  0     "REST"
2026-08-23 dow0 long  4.0   "LONG"       pace=636
2026-08-24 dow1 rest  0     "REST"
2026-08-25 dow2 easy  3.0   "3mi w/ 6×1min surges"   (is_quality)
```

**Frequency honoured: 3 stated → 3 running days.** No sign of the historical
"3-day runner gets a 6-day plan" bug on this path.

`authored_state` (excerpt): `{"mode":"maintenance","tier":"intermediate","total_weeks":4,
"recent_avg_mpw":20,"target_long_mi":4,"target_weekly_mi":14,
"maintenance_shape":{"daysPerWeek":3,"qualityType":"fartlek","longPctOfPeak":0.75,
"qualityPerWeek":1,"weeklyPctOfPeak":0.7}}` — see **D5**: `target_weekly_mi` 14, realized 10.

---

### 2.2 goal — `qa-goal-20260819-1231@faff.run`

Two steps, because that is the real flow: onboarding authors nothing, the goal authors the plan.

`POST /api/onboarding/complete` with `distance:"none"`, `weeklyMi:35`, `weeklyFreq:5`,
`histAvg:"25-35"`, `histLong:"10+"`, `histYears:"3-7"`:

```json
{"success":true,"redirect":"/onboarding?step=done","plan":{"ok":true,"mode":"none"}}
```

`POST /api/profile/goal` `{"distance_label":"Half Marathon","goal_time":"1:38:00",
"plan_weeks":14,"start_date":"2026-08-19","available_days":["mon","tue","wed","thu","sat","sun"]}`:

```json
{"ok":true,"distance_label":"Half Marathon","goal_time":"1:38:00","goal_seconds":5880,
 "plan_weeks":14,"plan":{"ok":true,"plan_id":"pln_2684dabde181e595","weeks":15},"plan_error":null}
```

Persisted: `tt_goal_distance="Half Marathon"`, `tt_goal_time="1:38:00"`,
`tt_goal_time_seconds=5880`, `tt_goal_plan_weeks=14`,
`user_settings.available_days=["mon","tue","wed","thu","sat","sun"]`.
**`races` table: empty** — no race row was invented.

`training_plans`: `pln_2684dabde181e595` · `mode=race-prep` · **`race_id = NULL`** ·
`goal_iso=2026-11-29` · 15 week rows · 105 workouts. Phases BASE → QUALITY →
RACE-SPECIFIC → TAPER, all four present in `plan_phases`.

Weekly volume series (day-sums): `29.5, 32, 31, 24.5, 31.5, 32, 34, 26.5, 34, 34.5, 35.5,
27, 35.5, 24, 9` — cutbacks at W3/W7/W11/W13, peak 35.5 against a stated 30 mi/wk history
and a `tier_peak_weekly_band` of `[35,45]`.

**Frequency honoured: 5 stated → 5 running days every week.**
**available_days honoured: zero runs land on Friday, the one day excluded.**

Week 0 as the runner sees it:

```
2026-08-19 dow3 intervals 5.5  "9×60s hills @ 5K-10K effort · 2 min jog down"
2026-08-20 dow4 easy      4.0  "EASY · 6×20s strides"
2026-08-22 dow6 easy      4.0  "EASY"
2026-08-23 dow0 long     12.0  "LONG"   pace=576
2026-08-25 dow2 easy      4.0  "EASY · 6×20s strides"
```

Race week is honest — a real taper into a 13.1 "RACE" row on the goal date:

```
2026-11-25 dow3 easy      4.0  "EASY · 40 MIN"
2026-11-26 dow4 easy      3.0  "EASY · 35 MIN"
2026-11-28 dow6 shakeout  2.0  "SHAKEOUT · 4×20s strides"
2026-11-29 dow0 race     13.1  "RACE"   pace=449
```

`authored_state` carries an honest provisional anchor rather than a fabricated one:
`"pace_blend":{"goal_vdot":46.2,"build_weeks":13,"season_anchor_vdot":40,
"season_anchor_source":"provisional_mileage","season_anchor_provisional":true,
"measured_progress_fraction":null}` and `"goal_realism":{"flag":false,
"basis":"provisional_mileage","goalVdot":46.2,"assessable":false}`.

**Lifecycle visibility** — the INNER-JOIN fix, checked against the real row by running the
cron's own SQL:

```
=== plan-drift POPULATION query ===
  qa-goal-20260819-1231@faff.run      inPopulation=true

=== activePlanRow lookup (LEFT JOIN races) ===
  {"plan_id":"pln_2684dabde181e595","race_id":null,"race_date":null,
   "goal_mode":"true","mode":"race-prep","last_workout_iso":"2026-12-01"}
  (pre-fix INNER JOIN would return: NOTHING — invisible to the cron)
```

The plan is now visible, and `last_workout_iso` gives it the end the elapsed check needs.

---

### 2.3 justrun — `qa-justrun-20260819-1231@faff.run`

`POST /api/onboarding/complete` with `distance:"none"`, no `ttDistance`,
`weeklyMi:25`, `weeklyFreq:4`, `histAvg:"15-25"`, `histLong:"6-10"`, `histYears:"3-7"`:

```json
{"success":true,"redirect":"/onboarding?step=done","plan":{"ok":true,"mode":"none"}}
```

Persisted: `goal_race_distance="none"`, `tt_goal_* = null`, `weekly_frequency=4`,
`user_settings={"coached_externally":false}`.

```
=== RACES ===            []
=== TRAINING_PLANS ===   []  (count 0)
=== PLAN_PROPOSALS ===   []
```

**Authors nothing. Confirmed.** And it stays that way: the nightly `plan-drift` cron's
population is "every user with an active plan **UNION** every user with a race row and no
active plan". A just-run runner is in neither set:

```
qa-justrun-20260819-1231@faff.run   inPopulation=false
```

so the open-block handoff can never fire for them unprompted. `GET /api/plan/week` returns
`{"plan_id":null,…,"days":[],"message":"No active plan."}`.

The **day-one surface was not honest** — see **D3**, now fixed.

---

### 2.4 coached — `qa-coached-20260819-1231@faff.run`

`POST /api/onboarding/complete` `{"distance":"coached", …}`:

```json
{"success":true,"redirect":"/onboarding?step=done","plan":{"ok":true,"mode":"coached"}}
```

Persisted: `goal_race_distance="none"` (the CHECK-constraint-safe encoding),
`user_settings={"coached_externally":true}`.
`training_plans` count **0**. `races` **[]**.

Then the two things a coached runner actually does next.

`POST /api/race` `{"name":"QA Coached A Race","date":"2026-11-22",
"distance_label":"Marathon","priority":"A","goal":"3:15:00"}`:

```json
{"ok":true,"slug":"qa-coached-a-race-2026-11-22","plan":null,"plan_error":null,
 "coached_externally":true}
```

`POST /api/profile/goal` `{"distance_label":"Marathon","goal_time":"3:15:00","plan_weeks":14}`:

```json
{"ok":true,"distance_label":"Marathon","goal_time":"3:15:00","goal_seconds":11700,
 "plan_weeks":14,"plan":null,"plan_error":null,"coached_externally":true}
```

**The race saved, the goal saved, nothing was authored.** Read back:

```json
{"goal_race_distance":"none","tt_goal_distance":"Marathon","tt_goal_time":"3:15:00",
 "tt_goal_time_seconds":11700,"tt_goal_plan_weeks":14,
 "user_settings":{"coached_externally":true}}
races: [{"slug":"qa-coached-a-race-2026-11-22",
         "meta":{"date":"2026-11-22","priority":"A","distanceMi":26.2,
                 "goalDisplay":"3:15:00","distanceLabel":"Marathon"}}]
training_plans: 0     plan_proposals: 0
```

The route-level gate is not the only thing standing there. Every authoring entry point was
called directly against this live account, and every one refused:

```
user_uuid = 2dfae94a-1a75-4dc6-b244-a79fedee242c
isCoachedExternally = true
before: training_plans=0 plan_proposals=0
resolveGoalTarget         = {"distanceMi":26.2,"goalSec":11700,"raceDateISO":"2026-11-25"}
generatePlan(goalTarget)  = {"ok":false,"reason":"coached_externally"}
generatePlan(raceSlug)    = {"ok":false,"reason":"coached_externally"}
authorOpenBlock           = {"ok":false,"mode":null,"reason":"coached_externally"}
authorOpenBlock(no tgt)   = {"ok":false,"mode":null,"reason":"coached_externally"}
fireAutoRebuild           = {"ok":false,"reason":"coached_externally"}
rebuildActivePlanForPrefs = {"ok":false,"reason":"coached_externally"}
after:  training_plans=0 plan_proposals=0 races=1
goal still saved: {"tt_goal_distance":"Marathon","tt_goal_time":"3:15:00",
                   "tt_goal_time_seconds":11700}
```

The gate that landed today has now run against a real account. It holds on all six entries,
including the two that only exist inside the nightly crons, and it costs the runner nothing:
the goal and the race both persist.

Note that a coached runner **is** in the `plan-drift` population (race row, no active plan),
so `authorOpenBlock` is reached every night — and returns `coached_externally` rather than
authoring. That is the path the gate was written for and it is exercised above.

---

### 2.5 beginner — `qa-beginner-20260819-1231@faff.run`

A true beginner at 2 days/week: `distance:"none"`, `weeklyMi:0`, `weeklyFreq:2`,
`histAvg:"0-5"`, `histLong:"0-3"`, `histYears:"<1"`, `experienceLevel:"beginner"`.

```json
{"success":true,"redirect":"/onboarding?step=done","plan":{"ok":true,"mode":"none"}}
```

`experience_level` persisted as **`beginner`** (not silently coerced to intermediate).
`weekly_frequency=2`, `weekly_mileage_target=0`, `history_avg_weekly_mi=3`,
`history_longest_recent_mi=2`.

Then `POST /api/profile/goal` `{"distance_label":"5K","goal_time":"32:00","plan_weeks":12,
"available_days":["tue","thu","sat"]}`:

```json
{"ok":true,"distance_label":"5K","goal_time":"32:00","goal_seconds":1920,"plan_weeks":12,
 "plan":{"ok":true,"plan_id":"pln_5e51f75b89cc8f00","weeks":13},"plan_error":null}
```

`training_plans`: `pln_5e51f75b89cc8f00` · `mode=race-prep` · `race_id=NULL` · 13 weeks.
Volume series: `3, 3, 3, 3, 4.5, 5, 5, 5, 6.5, 7, 8, 7, 2`.

```
W0  2026-08-19 dow3 easy 1.0 "EASY" | 2026-08-22 dow6 long 2.0 "LONG"
W4  2026-09-19 dow6 long 2.5       | 2026-09-22 dow2 tempo 2.0 "2mi E w/ 5×1 min surges @ T effort"
W10 2026-10-31 dow6 long 4.0 PEAK  | 2026-11-03 dow2 tempo 4.0
W12 2026-11-12 dow4 shakeout 2.0   | 2026-11-14 dow6 race 3.1 "RACE"  pace=618
```

**Frequency honoured: 2 stated → exactly 2 running days, every week of 13.**
This is **not** a scaled-down marathon build and **not** one four-mile run a week — it is a
2-day 5K build that opens at 1 mi + 2 mi and peaks at 8 mi/wk. `goal_tier: "developing"`,
`tier_peak_weekly_band: [16,24]` with the plan held to 8 by the 2-day budget — the ramp,
not the tier, is what binds. `goal_vdot: null` and `season_anchor_source:
"provisional_mileage"` — nothing invented.

Two real problems on this account: **D1** (a run on a day they said they cannot run) and
**D2** (the couch-to-5K opening is unreachable from onboarding).

---

## 3 · The gates, run for real

Not eyeballed. The persisted `plan_weeks` / `plan_workouts` / `plan_phases` rows for every
account were reconstructed into a `ComposePlanResult` and fed to the same three gates the
engine uses: `planDosingFindings` (the enforcement path), the placement invariants ported
from `_audit_placement.test.ts`, and `validateComposedPlan` with a context built from each
runner's own persisted profile.

```
######## qa-race-20260819-1231@faff.run · 1 active plan(s)
  --- pln_ba76b3a4eb19d3a7 mode=maintenance race_id=my-half-marathon-2026-12-13 weeks=4
      weeklyMi series: 10, 10, 10, 10
      DOSING · findings=0 enforced=0 byContext={"training":0,"taper":0,"race-week":0}
      PLACEMENT · violations=0
      validateComposedPlan · PASS

######## qa-goal-20260819-1231@faff.run · 1 active plan(s)
  --- pln_2684dabde181e595 mode=race-prep race_id=NULL weeks=15
      weeklyMi series: 29.5, 32, 31, 24.5, 31.5, 32, 34, 26.5, 34, 34.5, 35.5, 27, 35.5, 24, 9
      DOSING · findings=0 enforced=0 byContext={"training":0,"taper":0,"race-week":0}
      PLACEMENT · violations=0
      validateComposedPlan · PASS

######## qa-justrun-20260819-1231@faff.run · 0 active plan(s)
  (no plan — nothing to gate)

######## qa-coached-20260819-1231@faff.run · 0 active plan(s)
  (no plan — nothing to gate)

######## qa-beginner-20260819-1231@faff.run · 1 active plan(s)
  --- pln_5e51f75b89cc8f00 mode=race-prep race_id=NULL weeks=13
      weeklyMi series: 3, 3, 3, 3, 4.5, 5, 5, 5, 6.5, 7, 8, 7, 2
      DOSING · findings=0 enforced=0 byContext={"training":0,"taper":0,"race-week":0}
      PLACEMENT · violations=1
        wk0[BASE]: run on UNAVAILABLE dow 3 (easy 1mi)
      validateComposedPlan · PASS
```

Zero enforced dosing findings across all three plans. `validateComposedPlan` passes all
three. One placement violation, and it is real — **D1**.

---

## 4 · What a brand-new runner actually sees on day one

Rendered `/today`, signed in as each account, 2026-08-19.

**race** — header `MAINTENANCE · 116d to My Half`. Hero `REST` · "Rest is training. Sleep,
hydrate, mobilize." Week strip: Mon–Thu rest, **Fri Easy 3.0 mi · 11:03**, Sat rest,
**Sun Long 4.0 mi · 10:36**. `THE GAP · MY HALF · 1:45:00 TARGET · "Log a recent race to
project" · Projection pending`. `RACE DAY · 116 DAYS TO GO · Dec 13`. Readiness `0 of 7 ·
Building your baseline`. Honest throughout — but their first two days are rest days and the
week is 10 mi against the 25 they reported (**D5**, **D6**).

**goal** — hero `INTERVALS 5.5 mi` with a real breakdown (`WARMUP 1.5 mi easy build ~15 min`
/ `WORK 9 × ? mi · 2:00 jog rest · 5K–10K effort` / `COOLDOWN 1 mi easy ~10 min`), week
`0.0 of 29.5 mi`. The `?` in "9 × ? mi" is a time-based rep with no distance — cosmetic, not
fabricated. No race countdown, correctly, because there is no race.

**justrun** — *was*: `Active block`, hero `REST` · "Rest is training", a rest-day read
saying "let **yesterday's run** consolidate" for someone who has never logged a run,
plus `SLEEP TARGET 8h tonight` / `MOBILITY 15 min · hips, calves` / `FUEL Balanced + hydrate`,
and `ACTIVE BLOCK · Held the line`. Faff prescribed none of that. *Now*: `No plan yet` ·
hero `NO PLAN` · "Nothing prescribed. Add a race or a goal and Faff builds the block around
it. Runs you log land here either way." — no rest-day card, no prescription. (**D3**)

**coached** — hero `COACHED` · "Your coach owns the plan. Faff tracks the work. Runs land
here from your watch or Strava." plus the Final Surge / TrainingPeaks calendar pointer. That
part was already right. The header chip said `Active block` and the week band `IN ACTIVE
BLOCK` for a runner with no block; both now read `No plan yet`. (**D4**) `THE GAP · QA
COACHED A · 3:15:00 · Projection pending` and `RACE DAY · 95 DAYS TO GO · Nov 22` render
correctly off the saved race — measurement without prescription, which is the point of the
mode.

**beginner** — hero `EASY 1.0 mi` · `12:22/mi TARGET PACE` · `~12 min EST TIME` ·
`EFFORT TARGET Conversational · Z2`. Correct for a day-one runner and derived, not typed.

Nothing crashed. `/today`, `/plan` returned 200 for all five; `/api/briefing` and
`/api/plan/week` returned 200 for all five. The string `8:45` appears nowhere in any
rendered `/today`.

---

## 5 · Defects

### D1 · MAJOR · `frontLoadFirstRun` ignores `available_days` — **NOT FIXED** (engine file)

`web-v2/lib/plan/generate.ts:3857`, called at `:5120`.

> "get them running on day one." A mid-week onboarder … whose preferred run days fall later
> in the week would otherwise stare at several rest days before their first run.

The function relocates an easy run onto week 0's start day. It never checks
`input.availableDows`. Every runner who signs up mid-week **and** named the days they can
run gets their first-ever session on a day they told us they cannot run.

Live: `qa-beginner-20260819-1231@faff.run` said Tue/Thu/Sat, signed up on a Wednesday, and
was given `2026-08-19 dow3 easy 1.0mi`. Week 1 onward correctly uses dow2/dow6.

Isolated repro (identical inputs, only the anchor weekday differs):

```
WED-anchored (onboarding) start=2026-08-19 weekStart=2026-08-19
  W0 runs: dow3:easy:2 dow6:long:2
  W1 runs: dow2:easy:2 dow6:long:2
  W0 runs on UNAVAILABLE dows: dow3

MON-anchored (control)    start=2026-08-17 weekStart=2026-08-17
  W0 runs: dow2:easy:2 dow6:long:2
  W1 runs: dow2:easy:2 dow6:long:2
  W0 runs on UNAVAILABLE dows: none
```

`_audit_placement.test.ts` cannot see this: its `START` is always a Monday
(`const START = '2026-01-05'; // a Monday`), and `frontLoadFirstRun` is skipped on a Monday
anchor. Invariant 8 has therefore never been checked on the anchor that onboarding actually
uses.

Suggested shape: pick the donor's destination from `availableDows` when set, and no-op when
the anchor day is unavailable — a runner who cannot run today does not need to be started
today.

### D2 · MAJOR · the couch-to-5K opening is unreachable from onboarding — **NOT FIXED** (engine file)

`COLD-START-1` in `web-v2/lib/plan/generate.ts` fires on
`noVolumeSignal = !(peakAnchor > 0) && !(input.recentLongMi > 0)`. It works exactly as
designed when it fires:

```
── TRUE ZERO (recentWeeklyMi=0, recentLongMi=0)
   wk1 runs=3 total=1.8mi [easy:0.6 "8 min run/walk" ×3]
   wk2 runs=3 total=2.4mi [easy:0.8 "10 min run/walk" ×3]
   wk3 runs=3 total=2.7mi [easy:0.9 "12 min run/walk" ×3]
   wk4 runs=3 total=3.3mi [easy:1.1 "14 min run/walk" ×3]
```

But onboarding cannot produce a true zero. The lowest chips on the deck map to non-zero
midpoints in `lib/onboarding/state.ts`:

```
HIST_AVG_MIDPOINTS["0-5"]  = 3
HIST_LONG_MIDPOINTS["0-3"] = 2
```

and `generate.ts` seeds `recentWeeklyMi` / `recentLongMi` from those columns when there is
no run history. Confirmed on the live account: `authored_state.derived_from =
{"recentLongMi":2,"recentWeeklyMi":3,…}`. So `noVolumeSignal` is false and the same runner
gets the ordinary maintenance arithmetic:

```
── onboarding lowest chips (recentWeeklyMi=3, recentLongMi=2)
   wk1 runs=1 total=2.0mi [long:2 "LONG"]
   wk2 runs=1 total=2.0mi [long:2 "LONG"]
   wk3 runs=1 total=2.0mi [long:2 "LONG"]
   wk4 runs=1 total=2.0mi [long:2 "LONG"]
```

One run a week — the exact failure shape COLD-START-1 was written to remove, at two miles
instead of four. Reachable today by a true beginner who picks a 5K more than 10 weeks out
(5K build window = 10 weeks → the remainder is a maintenance block), and by any beginner the
open-block cron reaches.

Two candidate fixes, both in engine files, both for whoever owns them:
either widen the trigger (a runner reporting the bottom bucket with
`weekly_mileage_target = 0` and `history_years_running = '<1'` is doctrine's sedentary
starter regardless of a 3 mi/wk midpoint), or let the deck carry a genuine "I don't run yet"
answer that persists 0 rather than 3. The second is cleaner — the midpoint is a lie about a
runner who ticked the bottom of the range.

This did **not** hit the beginner account's actual plan, because setting a 5K goal routes
through the periodized builder rather than the maintenance composer. It is a live hole on a
neighbouring path.

### D3 · MAJOR · plan-less runners were shown a rest-day prescription — **FIXED**

`components/faff-app/views/TodayView.tsx`, `components/faff-app/seed.ts`,
`components/faff-app/overlays/WeeklyCheckIn.tsx`.

`/api/onboarding/complete`'s just-run branch says, in its own comment, that the runner
"lands on the empty TODAY (add a race or goal to start a plan)". They did not. With no plan
row for the day, `d.type` falls through to `'rest'` and Today handed them the full REST kit —
the "Rest is training" hero, a rest-day read about letting "yesterday's run consolidate"
(they have never run), a sleep target, a mobility block, a fuel line, an `Active block`
header chip and an `ACTIVE BLOCK` week band. Faff prescribed none of it. Same class as the
hardcoded `EASY 4.0 · 8:45/mi`, for a whole day instead of one stat.

`lib/today/composition.ts` already names this state — `prescribed: 'none'`, "there is no
plan row at all, which is the only case where the day has no work to lead with" — and
coached mode has had its own honest hero since 2026-06-10. This is that treatment for the
other way of having no prescription.

Guarded so it can only fire when there is genuinely nothing: no plan row on any day of the
visible week, and no planned mileage anywhere in the season. A runner whose block opens next
Monday keeps the ordinary rest day.

Verified on `qa-justrun-…` at `:3100`:

```
No plan yet
THIS MORNING  Nothing on the plan today.
NO PLAN
Nothing prescribed. Add a race or a goal and Faff builds the block around it.
Runs you log land here either way.
```

No rest-day card, no sleep target, no mobility block. `race` and `beginner` renders are
byte-unchanged; `coached` keeps its COACHED hero.

### D4 · MEDIUM · "Active block" asserted for a runner with no block — **FIXED**

Two fallbacks, `seed.ts` (`phaseLabel` → `'In active block'`, `weekOf` → `'Active block'`)
and `WeeklyCheckIn.tsx` (`seed.goalRace?.phaseLabel ?? 'Active block'`). All three fired for
exactly the runner who has no block. `season.weekDays` is empty precisely when no plan was
authored (`adaptSeason` returns `weekDays: []` for `!training?.weeks?.length`), so that is
the discriminator. Now reads `No plan yet`. Confirmed on both `justrun` and `coached`.

### D5 · MEDIUM · race-mode day one is half the runner's stated volume — **NOT FIXED** (engine file)

A runner who reports 20 mi/wk (25 target) and puts a half 116 days out is given a 4-week
maintenance block of **10 mi/wk with four rest days**. `MAINTENANCE_BY_TIER.intermediate`
takes 70% of the peak anchor, and the header on that table says the anchor comes "from the
just-completed race-prep block". A day-one onboarder has no completed block — the number
being cut by 30% is their *current* volume, and they are trying to build toward a race, not
hold a season.

Secondary, same account: `authored_state.target_weekly_mi = 14` while the days sum to 10.
`finalizeComposedPlan`'s VOL-1 reconcile rewrites `ComposedWeek.weeklyMi` and
`MAINT-WEEKLYML-1` re-snapshots `vols`, but the `target_weekly_mi` scalar in
`authored_state` is never reconciled, so the audit surface disagrees with the plan by 4 mi.
Isolated (pre-finalize) repro shows the same split: `target_weekly_mi=14`, realized 11.
UI is unaffected — `/api/briefing` reads the day-sum ("WEEK · 0.0 of 10.0 mi").

### D6 · MEDIUM · the maintenance and recovery composers never front-load a first run — **NOT FIXED** (engine file)

`frontLoadFirstRun` is called from `composePlan` only (`generate.ts:5120`). Neither
`composeMaintenancePlan` nor `composeRecoveryPlan` calls it. So the "get them running on day
one" rule does not apply to the one onboarding path most likely to need it: the runner whose
race is outside the build window, who therefore gets a maintenance block. `qa-race-…`
signed up on a Wednesday and their first run is Friday, after two rest days. Note the
interaction with D1 — fixing D1 first makes adding this safe.

### D7 · LOW · coached runners are assigned an experience tier from no evidence

Coached onboarding posts no volume or history (correctly — the route says "coached posts
none of these"), and the CAP-2 derivation in `/api/onboarding/complete` falls through to
`'intermediate'`. `qa-coached-…` has `experience_level: "intermediate"` with nothing behind
it. Harmless while Faff authors nothing for them, but it is a stated fact with no source,
and it becomes load-bearing the moment a coached runner switches modes. Leaving
`experience_level` null when no history was collected would be more honest.

### D8 · LOW · "Held the line." on a runner with zero history

The week band under the new `NO PLAN YET` label still reads "Held the line." — the
zero-delta copy for week-over-week volume. Literally true (0 vs 0), but it implies a
maintained streak for someone who has never run. Cosmetic; not touched.

---

## 6 · Anything in another agent's files

D1, D2, D5 and D6 all live in `web-v2/lib/plan/generate.ts` (D2 also touches
`lib/onboarding/state.ts`'s midpoint tables and, if the deck route is taken,
`app/api/onboarding/complete/route.ts`). Per the brief those files belong to concurrent
agents, so all four are reported and none are fixed. Nothing in `validate.ts`,
`goal-tiers.ts`, `plan-templates.ts`, `distance-category.ts`, `spec-builder.ts`,
`expand-spec.ts`, `lib/workout-catalogue/`, `catalogue-rx.ts`, `build-workout.ts` or
`native-v2/` was modified.

Files changed by this pass, all outside that set:

- `web-v2/components/redesign/onboarding/CompletionScreenRedesign.tsx` (D3-class fabrication)
- `web-v2/components/faff-app/views/TodayView.tsx` (D3)
- `web-v2/components/faff-app/seed.ts` (D4)
- `web-v2/components/faff-app/overlays/WeeklyCheckIn.tsx` (D4)

---

## 7 · The completion screen

`components/onboarding/CompletionScreen.tsx` dropped its hardcoded
`EASY 4.0 · 8:45/mi · ~35m` mini-poster on 2026-08-18. Its **redesign port** did not —
`components/redesign/onboarding/CompletionScreenRedesign.tsx` still rendered
`Easy 4.0.` / `8:45 /mi` / `~35m` on every completion, including coached mode where Faff
authors nothing, and `/redesign/onboarding?step=done` is a live route. Before and after, same
four URLs, root server vs this worktree:

```
?step=done&distance=coached
  :3000  "Your plan is built | Day one. | Your first day is ready. | Tomorrow · Thu · Aug 20 | Easy 4.0. | 8:45"
  :3100  "Faff is tracking | You're set. | Your coach owns the plan. Faff tracks the work — runs,
          readiness, health — and stays out of the prescriptions."

?step=done&distance=none
  :3000  "Your plan is built | Day one. | Your first day is ready. | … | Easy 4.0. | 8:45"
  :3100  "You're all set | You're in. | No plan yet, and that's fine. Log runs your way, or add a
          race or goal from Today whenever you want one built."

?step=done&distance=half&date=2026-12-13&time=1:45:00
  :3000  "… Half marathon plan around Dec 13. First day below … | Easy 4.0. | 8:45"
  :3100  "Your plan is built | Day one. | Half marathon plan around Dec 13. Head to Today for day
          one. | 116 d To race"

?step=done&distance=none&tt_distance=5k&tt_time=25-27
  :3000  "… Your first day is ready. | … | Easy 4.0. | 8:45"
  :3100  "Your plan is built | Day one. | Your plan is building. Head to Today for day one."
```

`8:45 present: False · Easy 4.0 present: False` on all four after. The only number the
screen still states is the days-to-race the runner typed themselves.

---

## 8 · How to re-check any row

Every account above is untouched apart from the writes described. The state of any of them
can be re-read with the plan/profile/race/proposal queries used here; the gate results can be
re-derived by feeding `plan_weeks` + `plan_workouts` + `plan_phases` into
`planDosingFindings`, `validateComposedPlan` and the `_audit_placement.test.ts` invariants.
The temporary harnesses that did that were deleted after the run and are not part of this
commit — D1's repro is the one worth re-creating, and its inputs are printed in §5.

Not run: `POST /api/cron/plan-drift` itself. It iterates every user in the population,
including `dnitch85@me.com`, and can author plans and write proposals. The parts of it this
QA needed were verified by running its own SQL read-only and by calling
`authorOpenBlock` / `fireAutoRebuild` / `rebuildActivePlanForPrefs` directly against the
coached account, where they refuse before writing anything.
