# Closure · cross-surface disagreements and two estimator decisions

**Branch** `closure/cross-surface`, based on `16664371`, **pushed, not merged.**
Four commits:

```
77ad1d7d  fix(runs): a lookup by run id names the canonical population, and a gate says so
4b60d8c0  fix(terrain): one downhill giveback, 0.50, and a gate that makes a second one impossible
cc23e404  fix(targets): one clearly named projection per meaning, resolved by its owner
8ff1003c  feat(volume): a sustained-volume estimator replaces the fragile mean
```

**Date** 2026-09-02. **Reference runner** `0645f40c-951d-4ccc-b86e-9979cd26c795`,
active plan `pln_9a57561debb776e5`. **Production read-only throughout**
(`faff_readonly`, `current_user` asserted before the first read in every test
that touches the database). No production write was attempted or made.

---

## 0 · The answer first

All four items are closed. One registry entry deleted and its path put back
into its contract. Three defects the brief did not name were found by the gate
written for item 2 and fixed in the same commit. One claim in the brief is
contradicted by the data and is corrected below. One pre-existing suite failure
is reported, not touched.

| # | Item | Before | After |
|---|---|---|---|
| 1 | targets route | 4 numbers, 3 called "projection" | 1 projection, 11982, resolved by `race-outlook`; each other meaning named |
| 2 | `loadRunDetail` | 118 of 274 rows resolved to the merge LOSER | all 118 redirect to the survivor; 2 more surfaces had the same defect |
| 3 | downhill giveback | 0.65 **and** 0.50 **and** 1.00 | one owner at **0.50**, a second declaration now fails the doctrine gate |
| 4 | sustained volume | mean over days · **33.7** mi/wk | 3rd-highest representative week · **39.5** mi/wk, refusal typed |

**Registry entries deleted:** `TARGETS-ROUTE-SHOWS-A-SECOND-PROJECTION`
(with its own test), and its excluded path restored into the projection
contract, which now resolves **9 paths at 11982** instead of 7.

**Registry entries remaining** — none of them mine, all owned by other agents'
boundaries: `HR-TARGET-ROW-IS-STALE`, `RACE-ABORT-ANCHORED-TO-A-REPLACED-SEED`,
`AUTHORED-SEED-IS-STILL-AN-UNSTAMPED-SECOND-RECORD`,
`WATCH-CEILING-IS-THE-BAND-MIDPOINT`.

---

## 1 · The targets route · four numbers, one race

### Before, live read

```
GET /api/targets/projection                                   2026-09-02

  projectionSec              11902  3:18:22   raw Daniels equivalence
  summaryLine                       3:15:06   "Projection 3:15:06 against a
                                               3:00:00 goal"
  raceProjections[Marathon]  12557  3:29:17   cross-distance equivalence
  trajectoryProjectedSec     11706  3:15:06   the trajectory — and the one the
                                              v4 card actually draws
                                              (projSec = trajectoryProjectedSec
                                               ?? projectionSec)

canonical, every other surface   11982  3:19:42
```

Three of those four strings say "projection". They are not all wrong: they are
four DIFFERENT quantities wearing one word.

### After, same live read

```
  projectionSec           11982   3:19:42
  projectionBasis         'trajectory'
  projectionRangeSec      [11608, 12411]
  projectionSource        'race_outlook'
  trajectoryProjectedSec  11982            legacy alias, SAME number
  currentFitnessSec       12230   3:23:50  not called a projection
  trajectoryAccruedSec    12207   3:23:27  TODAY, between the two
  summaryLine             "Projection 3:19:42 against a 3:00:00 goal. …"
  equivalentTimes         5K 20:25 · 10K 43:14 · Half 1:38:38 · Marathon 3:29:17
  raceProjections         absent
  totalGapSec  1102 → 1182     fitnessSec  1018 → 1098
  confidenceInterval  [10828, 12584] → [11083, 12881]  (re-centred)
```

`projectionSec` resolves through `lib/race/race-outlook.ts`; `currentFitnessSec`
comes off the SAME outlook object, so the two quantities this route separates
cannot be answered by two engines and drift apart again. `applySpec` is
deliberately not applied on top of an outlook number — the outlook already
prices durability and marathon specificity, and stacking would double-count
§13.1.

### The accrual had to move with it

`trajectoryAccruedSec` ran `predictRaceTime` over `vdot + gain × fraction` off
the route's own snapshot VDOT. Left alone, once `projectionSec` became 11982 it
would have printed a **TODAY of 3:18:22 beside a race day of 3:19:42** — the
screen saying the build makes him slower. It now interpolates between the two
numbers the payload names. The S4 doctrine and its clamp are unchanged: it
credits executed work, it does not measure or decay fitness, and TODAY can never
read faster than the current-fitness anchor. `max` of two continuous quantities
is continuous and monotone, so no Rule 9 cliff is introduced; and choosing the
owner on "does a race row exist" is a discrete fact, not a threshold on a
continuous quantity.

### Falsification · six ways, on live production data

```
T0  control                                 8 passed · 9 paths at 11982
T1  the route answers from its own chain    DETECTED
      "the targets route answered from its own chain, not from race-outlook —
       the number may agree today and will drift the moment either engine moves:
       expected 'route_equivalence' to be 'race_outlook'"
T2  `raceProjections` reappears             DETECTED
      "the targets payload still publishes `raceProjections`. Its Marathon row
       is a cross-distance EQUIVALENCE, materially incompatible with this race's
       projection (3:29:17 against 3:19:42 on 2026-09-02)"
T3  summaryLine quotes a different number   DETECTED
      "summaryLine quotes 12230s while the payload's projection is 11982s.
       Rule 16: a sentence about a measurement is gated on that measurement."
T4  the legacy alias keeps the old number   DETECTED
      "projected finish · cim (s): 2 DIFFERENT NUMBERS across 9 paths"
T5  currentFitnessSec collapsed into it     DETECTED
      "the targets route publishes current fitness and the projection as ONE
       number. They are different quantities (12230 against 11982)"
T6  restored                                8 passed
```

Log: `scratchpad/closure/falsify_targets.log`.

### What this cannot fail on (Rule 22)

It is a coherence check, not a correctness one — if `race-outlook` returns a
wrong number tomorrow, all nine paths return it and the file is green. It
cannot see Swift, so it cannot tell you the v4 card draws what the payload says.
It is one runner and one day.

### Needs another agent

`raceProjections` → `equivalentTimes` drops a key the v4 depth card decodes with
`try?`, so that section hides rather than breaks. To draw it again,
`native-v2/Faff/Faff/Models/ToolkitPayloads.swift` (the `RaceProjectionEntry`
key and `CodingKeys`) and `K_TargetsProjectionDepth.swift` need the rename.
Reported, not touched — `native-v2/**` is another agent's boundary.

Also unchanged and still true: the nightly cron writes `projection_snapshots`
and `lib/plan/goal-gap.ts#classifyTrend` reads that table DIRECTLY, not through
this route, so the 11902 that can trigger a rebuild is untouched by this fix.
`lib/plan/**` is outside my boundary.

---

## 2 · `loadRunDetail` · canonical-run selection

### Measured on production before touching anything

```
274 rows for the reference runner · 156 canonical · 118 MERGED LOSERS (43%)
  0 of the 118 loser id strings also match a canonical row
  0 dangling pointers · 0 pointer chains needing a second hop
  0 other accounts have any canonical runs at all
```

Because no loser id collides with a canonical one, **every one of those 118 ids
resolved to the loser, deterministically.** Against their survivors the losers
differ on splits (44 of 118 — most carrying ZERO against 5-13), average HR (54),
shoe (66) and elevation (58).

### Before / after, by running the real function against HEAD and then the fix

```
BEFORE  29 of the first 30 absorbed ids returned a DIFFERENT payload than
        their canonical twin.
BEFORE  /api/runs/19966462921  (Strava's id for the 2026-08-30 13.49 mi long
        run)  →  0 splits.      canonical row: 13 splits.
AFTER   all 118 absorbed ids resolve to their survivor, via 'absorbed_pointer'
AFTER   the same id → 13 splits, matching the canonical read exactly
AFTER   an unknown id is still `no_such_run`, not a redirect
```

### The gate found two more surfaces the brief did not name

`IDENTITY-1` in `lib/runs/_absorption_predicate.test.ts` scans template literals
for `runIdentityMatchSql(` and demands the same statement carry
`CANONICAL_ROW_SQL`/`runNotMergedSql` or an argued, statement-scoped exemption.
On its first run it reported five call sites and two unguarded ones I had not
looked at:

- **`app/api/runs/[id]/recap/route.ts`** — whose own comment reads *"Load the
  canonical run"* while the query did not say so (Rule 19's corollary, exactly).
  It then handed the loser's row id to `loadRunTwins`, and a loser has no twins,
  so the ranked-instrument elevation read degraded as well.
- **`PATCH /api/runs/[id]`** — the shoe assignment wrote `shoe_id` onto the
  loser. `lib/shoe/mileage.ts` computes shoe mileage from CANONICAL runs, so
  those miles never accrued and the pick did not come back: the same symptom the
  2026-05-27 synthetic-id fallback was added for (*"I selected it, clicked off,
  came back. not there."*), from a different cause.

### Why the predicate alone would have been the wrong fix

Adding `AND ${CANONICAL_ROW_SQL}` and stopping there 404s all 118 — the Strava
id lives ONLY on the loser and it is the id every saved link carries. So one
owner, `lib/runs/canonical-ref.ts#resolveCanonicalRunRowId`, follows
`data.mergedIntoId` to the survivor. Rule 11, three facts kept apart:
`canonical` / `absorbed_pointer` / `dangling_pointer` (corruption — serve the
loser and warn, rather than erase a run that happened) / `no_such_run`.

### Falsification · four ways

```
F0  control                                     9 passed
F1  canonical predicate dropped from rung 1     DETECTED (unguarded statement)
F2  the exempted rung-2 statement guarded       DETECTED (stale exemption)
F3  the fragment renamed                        DETECTED (liveness: 0 < 3)
F4  exemption fingerprint widened to 'FROM runs'
      FIRST ATTEMPT: NOT DETECTED. Breadth was measured against the unguarded
      set only, which cannot see over-breadth while a file holds exactly one
      unguarded statement. Rewritten to measure against every identity
      statement in the file — DETECTED.
F5  restored                                    9 passed
```

Log: `scratchpad/closure/falsify_identity.log`. F4 is the one worth keeping:
the gate's first version could not fail on the exact abuse it was written to
prevent, and only running it against a deliberate abuse showed that.

### What it cannot fail on (Rule 22), written into the file header

1. A query that reaches `runs` by identity WITHOUT the shared fragment — it keys
   on the fragment's name, so a hand-typed `data->>'activityId' = $2` is
   invisible. `_run_shape_lint` is what pushes callers onto the fragment.
2. Whether the pointer it follows is SOUND. It checks the population is named,
   not that the merge was right.
3. `user_uuid` scope — Rule 14's other half, other scanners.
4. Multi-hop pointer chains. None exist; nothing here would notice one.

### Ratchet side effect

Two `MERGED_FILTER_ALLOWED` entries in `_run_shape_lint.test.ts`
(`lib/coach/run-state.ts`, `app/api/runs/[id]/route.ts`) went stale when the
hand-typed predicates were replaced, and its own staleness test forced their
deletion. That is the ratchet working.

---

## 3 · The downhill coefficient · his decision, implemented

### Before · THREE values for one physical quantity, all green

| Site | Value | Reaches |
|---|---|---|
| `lib/terrain/grade-adjust.ts#DESCENT_GIVEBACK_FRACTION` | **0.65** | recap, run detail, VDOT candidates |
| `lib/training/elevation-model.ts#DESCENT_RECOVERY_FRACTION` | **0.50** | race splits, Targets projection, representativeness |
| `lib/training/elevation-model.ts#gradePaceMultiplier` downhill branch | **1.00** | race splits — a symmetric refund, six lines below the file's own 0.5 |

`TERRAIN.grade-cost-per-pct` already cross-checks the two modules' CLIMB
coefficients and errors with *"Planned courses and executed runs must cost a
hill the same."* Nothing did that for the descent.

### After · one owner, `lib/terrain/grade-adjust.ts#DESCENT_GIVEBACK_FRACTION = 0.50`

`DESCENT_RECOVERY_FRACTION` is **deleted**, not deprecated. `elevation-model.ts`
imports the owner and re-exports it under the one name so a reader still sees
what it spends without a second literal existing. `gradePaceMultiplier` now
spends the same giveback.

### The uncertainty, recorded and read at run time

Three passages, three answers:

| Source | Says |
|---|---|
| `Research/01` §Hills, prose | "give back roughly **60–70%**" |
| `Research/01` §Hills, its OWN Minetti table, three rows above that sentence | −6% 0.83 vs +6% 1.34 → **0.50** · −4% 0.88 vs +4% 1.21 → **0.57** · −2% 0.94 vs +2% 1.10 → **0.60** |
| `Research/11` §Pacing Rule | climbs +10-30 s/mi, descents −5-15 → **0.50** |

Two of the three support 0.50 and it is the conservative end of all three. The
doc contradicts itself: the table it derived from an energy-cost equation says
50-60% and falls with grade; only the "simpler rule" beside it says 60-70%. The
claim's `check` now **parses that table out of the doc** and refuses if it stops
yielding three paired grades, so the argument cannot outlive its evidence.

### Measured, not asserted — and the direction is NOT the same on both sides

- **Course pricing.** Lower k prices a course HARDER. His CIM, from its own row
  (**723 ft gain, −304 ft net → 1027 ft loss**) at his prescribed 7:23/mi:
  **0.65 → 15 s of course cost, 0.50 → 58 s, Δ +43 s.** Conservative, and it is
  what the app already did on this side (elevation-model was the 0.50 half).
- **Executed-run judging.** Lower k hands back less, so the flat-equivalent pace
  comes out FASTER and a hilly run reads marginally FITTER. **That is the
  direction this change actually moves**, and it is the less conservative one,
  so it was A/B'd against live reads rather than reasoned about:

```
45 of the 62 canonical runs since 2026-06-01 move
~1 s/mi typically · 17.98 s/mi at most (2026-08-26, 2807 ft of climb)

  2026-09-01   8.50mi   0.50: -13.95 s/mi   0.65:  -9.76   shift 4.18
  2026-08-30  13.49mi   0.50:  -2.52        0.65:  -1.76   shift 0.76
  2026-08-26   7.78mi   0.50: -22.33        0.65:  -4.35   shift 17.98

threshold capacity   430 s/mi · VDOT 47.8 · confidence identical to 16 decimals
CIM expected race day  11982 s                        — BOTH UNCHANGED
```

Conservative where it prices a race, neutral where it judges a run. My first
draft of the header claimed the conservative direction for both; the A/B showed
that was false and the comment was corrected before commit.

### Falsification · seven ways

```
D0  control (0.50)                          663 passed
D1  0.75, above the prose band              DETECTED · "ABOVE §Hills' stated
      60-70%. The exemption covers the conservative direction only"
D2  0.30, below the doc's own table         DETECTED · "below even the lowest
      ratio §Hills' own Minetti table implies (50.0%)"
D3  0.65, back inside the prose band        DETECTED as a STALE exemption
D4  a second declaration reappears          DETECTED · "declared in 2 place(s)"
D5  the walk pointed at a 4-file tree       DETECTED · liveness floor
D6  the doc's paired grades deleted         DETECTED · "cannot be checked
      without it"   (Research/01 restored; git status confirms)
D7  restored                                663 passed
```

Log: `scratchpad/closure/falsify_descent.log`.

The exemption is scoped to the violating condition (Rule 18 point 3): above the
band it fails with no exemption available, below the table it fails, and a
second declaration anywhere under `web-v2/lib` fails a WALK with its own
file-count floor. `._*` is excluded from that walk — this volume is exFAT and a
local count is roughly double CI's.

`_elevation_doctrine.test.ts`'s "exactly one place the coefficient is written
down" guard was a hand-written list of TWO files with `lib/terrain/` not on it,
which is precisely how 0.65 and 0.50 coexisted for a year. It is a walk now,
and it gained a test that the per-mile multiplier and the whole-course form
spend the SAME giveback — asserted at 0.5% of grade, where the 15 s/mi ceiling
is not binding (at 472 s/mi the cap starts biting around 0.96%, which is how the
symmetric-refund bug stayed invisible).

### Residual second owners · reported, not changed

Each is a different question with its own argued registry claim; folding them
into this coefficient would change goal framing and race strategy.

- `lib/race/coach-goal.ts#hillAdjustmentSec` — prices GROSS gain with **zero**
  descent credit, cited to `Research/02` "downhills do not symmetrically refund
  the cost". `COURSE.hill-cost-rate` locks the zero and asserts
  `hillAdjustmentSec({elevationGainFt: -100}) === null`.
- `lib/race/race-detail-pacing.ts#DOWNHILL_CLOSE_CREDIT` (0.007) — a pacing
  STRATEGY for a net-downhill close, `Research/08` §18.1.
- `GRADE_COST_PER_PCT` is still declared in both modules (0.033 each) and
  `GRADE_MODEL_MAX_PCT` 15 vs `GRADE_LINEAR_LIMIT_PCT` 10 still differ against
  the same "10–15%" sentence. Both already registry-watched; neither is the
  descent.

---

## 4 · The sustained-volume estimator

### What was there

Rule 8's filter was correct and stayed correct; what sat on top of it was a
MEAN — and not even a mean of weeks. `normalWeeklyMileageDetail` summed
representative DAYS and divided by `representativeDays/7`, so it held no weekly
series at all, and a fortnight of 45 beside a fortnight of 20 was
indistinguishable from four weeks of 32.5.

### A correction to the brief, from the data

The brief lists 21 raw weeks and says *"one zero week and one 4.2-mile week,
neither taper, neither prescribed."* **Both sit inside the Americas Finest City
prescribed window (2026-08-02 … 08-30.)** Under Rule 8 they are not low weeks at
all — they are weeks with 0 and 3 representative days. His six prescribed
windows are:

```
rose-bowl-half-2026    2026-01-04..02-01     big-sur-marathon   2026-04-05..05-24
disney-half-2026       2026-01-18..02-15     sombrero-half      2026-04-19..05-10
la-marathon-2026       2026-02-15..04-05     americas-finest-city 2026-08-02..08-30
```

which is also why the representative series stops at nine weeks however far the
lookback reaches.

### His real record · trailing 7-day blocks, Rule 8 applied, read 2026-09-02

```
endISO       mi     rep days
2026-09-02   21.7      3      partial — today mid-week, inside AFC
2026-08-26    0        0      entirely inside AFC
2026-08-19    0        0      entirely inside AFC
2026-08-12    0        0      entirely inside AFC
2026-08-05    4.2      3      partial — inside AFC
2026-07-29   23.1      7   ←  the nine complete weeks
2026-07-22   38.0      7
2026-07-15   49.6      7
2026-07-08   19.8      7
2026-07-01   19.8      7
2026-06-24   36.0      7
2026-06-17   39.5      7
2026-06-10   46.4      7
2026-06-03   38.7      7
2026-05-27   19.7      3      partial — inside Big Sur / Sombrero
older        0         0      entirely inside Big Sur / Sombrero
```

A partly-prescribed week is now ABSENT from the series rather than counted
(Rule 11 — it is "cannot read", not "ran little"), and scaling it up to a 7-day
rate would invent mileage he never ran.

### Every candidate method against that record

| Method | Answer | Verdict |
|---|---|---|
| mean over representative DAYS (the old reader, live) | **33.7** | replaced |
| mean of the nine complete weeks | 34.5 | below his own median — what a left tail does to an average |
| 20% trimmed mean | 34.5 | discards the tails, then averages the middle; still an average, lands on the mean |
| median | 38.0 | robust, wrong question — half a runner's weeks are below his median by definition |
| **3rd-highest week (CHOSEN)** | **39.5** | above the median, well under the peak |
| 2nd-highest | 46.4 | near his peak; two weeks is not a sustained level |
| longest run ≥35 / ≥40 | 4 wks / 1 wk | most literal, and brittle exactly as he warned — one interrupted week resets the run to zero, so an isolated zero DESTROYS the answer |
| `recentWeeklyMileageMi` (unfiltered twin, unchanged) | 34.3 | different question, kept |

### Why the 3rd-highest, and why it is not a new threshold

It is the engine's OWN definition of "sustained". `lib/plan/generate.ts#resolveRampBase`
already reads the 3rd-highest of a 16-week series and states the argument in its
own doc: *"3rd-highest, so no single (or double) outlier week sets a base."*
`SUSTAINED_WEEK_RANK` and `SUSTAINED_LOOKBACK_WEEKS` are bound to
`RAMP_BASE_SUSTAINED_RANK` / `RAMP_BASE_LOOKBACK_WEEKS` **by assertion, not
import** (generate.ts imports this module; a value import would close a cycle) —
the same posture `MIN_REPRESENTATIVE_DAYS` and
`REPRESENTATIVE_STALENESS_HALF_LIFE_DAYS` already take in this file.

The argument is about an ABSOLUTE outlier count, not a percentile: whatever the
sample size, discarding the two best weeks means no fluke and no pair of flukes
can BE the answer, while a level reached three times inside a bounded recent
window is not an anomaly — it is a training block, which is exactly the evidence
a capacity question wants.

**The case for 39.5 is that it sits one and a half miles above his own median.**
The method is not buying optimism here: it refuses to be dragged to 34.5 by the
two 19.8 weeks a mean averages in, and it lands where his middling week already
was. He ran 39.5 or better in three of nine weeks, and 38 or better in five.

**Nothing is fitted to 43.5.** CLAUDE.md's Rule 8 table records that figure from
a wider, partly-unfiltered basis on 2026-08-30. This method comes from
`RAMP_BASE_SUSTAINED_RANK` and lands at 39.5; the gap is a fact about two
windows, not a target.

### Robustness, demonstrated rather than claimed

```
insert a 0-mile week   mean 34.5 → 31.1        sustained 39.5 → 39.5
insert a 4.2 week      mean falls              sustained 39.5 → 39.5
insert one 90 week     never becomes the answer
insert two (90, 88)    neither becomes the answer
insert three           86 becomes the answer — DELIBERATE, and stated as a
                       limitation: three weeks at a level is a training block
```

### Refusal

Below `MIN_SUSTAINED_WEEKS` complete representative weeks, through the same
`NormalReading<T>` union whose refusal branch carries **no `value` field**, so
`reading.value` still does not compile until the caller branches. The floor is
DERIVED, not chosen: the k-th highest of n must sit in the upper half of its own
sample or it is describing a middling week wearing the word — `k ≤ n/2` gives
`n ≥ 2k = 6`.

**Blast radius, measured:** every account with canonical runs was walked. There
is exactly **one**, and it is ANSWERED (9 weeks, lookback 120 d, outer bound
reached), not refused. Stated plainly because it is also a Rule 15 admission:
**the refusal path is unreachable on production data** and is carried entirely
by the pure tests.

### One owner

`sustainedWeeklyMileage` is it. `normalWeeklyMileage` and
`normalWeeklyMileageDetail` are narrowings that compute nothing of their own, so
a sustained reading here and one anywhere else cannot be two numbers. The 28-day
(or 90-day) argument is now a BASE the lookback widens from, never a window the
answer is averaged over — a weekly order statistic cannot be taken from four
weeks. Widening goes through `representativeLookback`, which is clause 1's
sanctioned "extend AFTER excluding" and admits no prescribed day at any width.

All four existing callers get the new reading without any forbidden file being
touched, because the change is inside the function they already call:
`lib/plan/goal-gap.ts`, `app/api/targets/projection/route.ts`,
`app/api/v5/races/route.ts`, `lib/adaptation/load-adaptation-engine.ts`. The
last of those renders it to the runner as *"Your own recent training averages X
mi a week"* and had been calling a 90-day MEAN `sustainedWeeklyMi` — a Rule 16
violation in the existing code, now true to its name.

### Falsification · eight ways

```
S0  control                                    37 passed · shell PASS
S1  rank drifts from RAMP_BASE_SUSTAINED_RANK  DETECTED (4 tests)
S2  lookback drifts from RAMP_BASE_LOOKBACK    DETECTED
S3  refusal floor typed in, not derived        DETECTED by BOTH the suite and
      the shell gate
S4  the estimator becomes a MEAN again         DETECTED (6 tests)
S5  the estimator becomes a MEDIAN             DETECTED (3 tests)
S6  a partly-prescribed week counted as low    DETECTED
S7  the estimator un-exported                  DETECTED by the shell gate
S8  restored                                   37 passed · shell PASS
```

Log: `scratchpad/closure/falsify_sustained.log`.

`scripts/check-normal-window.sh` guard 1 grew six pinned exports plus two
structural checks — that the module still CITES `RAMP_BASE_SUSTAINED_RANK` (a
module that stops naming it has quietly become a second definition of
"sustained") and that the floor is still an expression rather than a literal.

### What the suite cannot fail on (Rule 22)

Whether 3rd-highest is the RIGHT definition — it checks the engine agrees with
itself and that the statistic behaves; the doctrine argument is in the two module
headers. Anything about a real runner beyond the nine-week regression anchor.
And whether trailing 7-day blocks are the right week boundary — it asserts what
the code does, it cannot tell you that is the best choice.

### Ratcheted arguments re-argued, not widened

- `_format_lint.test.ts`'s exemption for this module justified its rounding by
  **byte-identity with `recentWeeklyMileageMi`**. That is no longer true — it is
  a different statistic now — so the entry states the real reason:
  `mileageByDay` already returns 0.1-mi miles and the series keeps the
  resolution its source has.
- The three `HABIT_READERS` entries reading `normalWeeklyMileage` said
  "28 days"; they now say "28-day base, widened to 16 representative weeks" and
  name the change.

---

## 5 · Discipline

Before every commit: `npx tsc --noEmit`, the affected vitest with
`DATABASE_URL=$DATABASE_URL_RO`, and `npm run prebuild` from `web-v2/`
(18 gates). All clean, exit 0.

Final state of the whole suite: **8654 passed, 15 skipped, 1 failed.**

The one failure is **`lib/postrun/_postrun_corpus.audit.test.ts`**, a coach-voice
finding on today's run:

```
2026-09-02: briefing.detail.paragraphs — scolding: "not good enough"
2026-09-02: evidence.runnerSummary     — scolding: "not good enough"
2026-09-02: briefing.whyNot[1]         — scolding: "not good enough"
```

It is **pre-existing and not mine**. The string lives at
`lib/postrun/experience.ts:551` and `:744` (*"the recording is not good enough to
read"*), is byte-identical at my base `16664371` and at current `origin/main`,
and that test's import graph (`lib/postrun/load.ts`, `lib/faff/explanation.ts`,
`lib/faff/coach-lexicon.ts`, `lib/postrun/experience.ts`) contains none of the
nineteen files I changed. `lib/postrun/**` is outside my boundary. It reads to
me as a lexicon false positive — the sentence is about the RECORDING, not the
runner — but the call belongs to whoever owns that surface.

`next build` is green on every push (the pre-push hook runs it), so Rule 19's
last step is covered.

**Disclosure:** nothing used `--no-verify`. The pre-push watch gate failed once
with `Invalid config file "Secrets.xcconfig"` — that file is gitignored
(`.gitignore:43`) and simply absent from a fresh worktree. Rather than override,
I copied it in from the parent checkout; `git check-ignore -v` confirms it stays
out of git. The gate's own `xcodegen` run then modified
`native-v2/Faff.xcodeproj/project.pbxproj` as a side effect on each push; that
was reverted every time and the working tree is clean.

**The exFAT AppleDouble hazard.** Both new file walks — the descent
single-owner scan in `lib/doctrine/resolve.ts#sourceFilesUnder` and the
coefficient walk in `_elevation_doctrine.test.ts` — exclude `._*` explicitly and
carry a file-count floor. A local count on this volume is roughly double a clean
CI checkout's.

---

## 6 · Everything I could not do inside my boundary

| Action | Owner | Why it matters |
|---|---|---|
| Rename `raceProjections` → `equivalentTimes` in `ToolkitPayloads.swift` and `K_TargetsProjectionDepth.swift` | `native-v2/**` | until then the v4 depth card's "AT OTHER DISTANCES" section hides (it decodes with `try?`, so it degrades rather than breaks) |
| `projection_snapshots` still holds 11902 and `lib/plan/goal-gap.ts#classifyTrend` reads that TABLE directly, not this route | `lib/plan/**` | the number that can trigger a rebuild is untouched by item 1 |
| `lib/race/coach-goal.ts#hillAdjustmentSec` zero descent credit, `race-detail-pacing.ts#DOWNHILL_CLOSE_CREDIT` | mine by path, but each has its own argued registry claim for a DIFFERENT question | left deliberately; changing them moves goal framing and race strategy |
| `GRADE_COST_PER_PCT` declared twice, `GRADE_MODEL_MAX_PCT` 15 vs `GRADE_LINEAR_LIMIT_PCT` 10 against one "10–15%" sentence | already registry-watched | the climb twin of the defect item 3 closed |
| `lib/postrun/experience.ts` "not good enough" voice finding | `lib/postrun/**` | one red test on `main` today |
| The four remaining `KNOWN_DISAGREEMENTS` | `lib/plan/recompute-paces.ts`, `lib/race/race-row-refresh.ts`, `lib/plan/generate.ts`, `lib/training/expand-spec.ts` | three are data repairs on the live plan and need David's explicit go |
