# The canonical Adaptation Engine, replayed against real training

**Runner** `0645f40c-951d-4ccc-b86e-9979cd26c795` · **Race** CIM, 2026-12-06 ·
**Goal** 3:00:00 (10,800 s, 412 s/mi) · **Active plan** `pln_9a57561debb776e5`
**Extracted** 2026-09-02 from production, read-only, as `faff_readonly`
**Harness** `scripts/adaptation-real-replay/` · run with `bash scripts/adaptation-real-replay/run.sh`

---

## What this replaces

`lib/adaptation/canonical/_replay_ledger.test.ts` shipped a 13-row ledger
reading **PROGRESS 6 · HOLD 3 · REFUSE 4, zero disagreements**, and said in its
own header what that ledger is:

> It is a hand-authored reconstruction grounded in the documented figures … not
> a database export. No production credentials were available in this worktree.

This replay uses the rows. 156 canonical runs (`NOT (data ? 'mergedIntoId')`),
2026-01-01 to 2026-09-02; the 9 plan versions that were ever *in force* out of
48; 570 prescriptions; 11 races read from `races.actual_result`. Forty decision
points, 120 records.

## THE HEADLINE

| | PROGRESS | HOLD | REGRESS | REFUSE |
|---|---:|---:|---:|---:|
| **All levers** | **0** | 94 | 20 | 6 |
| THRESHOLD_PACE | 0 | 40 | 0 | 0 |
| WEEKLY_VOLUME | 0 | 25 | 15 | 0 |
| LONG_RUN | 0 | 29 | 5 | 6 |

**The engine built to end Rule 21's zero proposes zero increases on the runner
Rule 21 measured.** Twenty downward moves, none upward. The hand-authored ledger
said 6 PROGRESS; the real data says 0.

The carried belief only ever falls:

```
2026-06-03   T 442 s/mi   volume 43.5 mi/wk   long 12 mi   (seeded)
2026-07-20   442          41.3               12
2026-07-27   442          39.2               12
2026-08-03   442          37.2               12
2026-08-10   442          35.3               12
2026-08-17   442          33.5               12
2026-08-24   442          31.8               12
2026-08-31   442          30.2               12
```

The threshold anchor never moves at all across three months. Volume falls 13.3
mi/wk across the seven weekly boundaries that applied a step — 15 REGRESS
records were raised, and the 8 at session boundaries were correctly deferred to
the weekly boundary rather than applied twice. **That ends at 30.2 mi/wk for a
runner whose 2026-07-20 week was 47.5 mi and whose
`authored_state.ramp_base.sustainedMi` is 45** — and
it lands within 4.5 mi of the 31.6 mi/wk figure CLAUDE.md Rule 8 already lists
as a defect in the row "Marathon block opened at 31 mi/wk". A different engine
reaching the same wrong number by a different route.

**Not a data-starvation artifact.** A sensitivity run that pre-windows the
evidence to 28 days before handing it to the engine produces the identical
distribution (`PROGRESS 0 · HOLD 94 · REGRESS 20 · REFUSE 6`). The inertia is in
the bars, not in the window.

---

## The ledger

Forty decision points. `W` weekly volume · `L` long run · `T` threshold pace.
Weekly boundaries arbitrate; session boundaries record and defer (13 records
were suppressed by `PLAN_LOAD` with a `reconsiderAtISO`, which is the cadence
rule working).

| Decision date | Boundary | W | L | T |
|---|---|---|---|---|
| 2026-06-03 → 06-19 (10 points) | mixed | HOLD | HOLD | HOLD |
| 2026-06-22 → 06-29 (6 points) | mixed | HOLD | **REFUSE** | HOLD |
| 2026-07-06 → 07-17 (6 points) | mixed | HOLD | HOLD | HOLD |
| 2026-07-20 | weekly | **REGRESS** −2.2 mi | HOLD | HOLD |
| 2026-07-22 | session | HOLD | HOLD | HOLD |
| 2026-07-24 | session | REGRESS | HOLD | HOLD |
| 2026-07-26 | session | REGRESS | **REGRESS** −1.0 mi | HOLD |
| 2026-07-27 | weekly | REGRESS −2.1 mi | **REGRESS +1.5 mi** ⚠ | HOLD |
| 2026-08-03 | weekly | REGRESS −2.0 mi | REGRESS −1.0 mi | HOLD |
| 2026-08-05, 08-07 | session | REGRESS | REGRESS | HOLD |
| 2026-08-10, 08-12 | mixed | REGRESS −1.9 mi | HOLD | HOLD |
| 2026-08-17 (×2) | mixed | REGRESS −1.8 mi | HOLD | HOLD |
| 2026-08-24 | weekly | REGRESS −1.7 mi | HOLD | HOLD |
| 2026-08-31 (×2) | mixed | REGRESS −1.6 mi | HOLD | HOLD |
| 2026-09-02 | session | HOLD | HOLD | HOLD |

Full per-record detail — evidence included, excluded and contradictory, the
magnitude, the limit constant it cites, and the coach sentence — is written by
`REPLAY_LEDGER_OUT=<path> bash scripts/adaptation-real-replay/run.sh`.

### Scoring, against doctrine and against what happened next

Never against the legacy engine, which fired zero upward adaptations in 309
production intents.

| Cluster | Decision | Subsequent evidence | Verdict |
|---|---|---|---|
| June, insufficient corroboration | HOLD | Sessions graded PARTIAL/DIFFERENT for weeks; nothing to corroborate | **beneficial** — refusing was correct |
| 2026-06-22 long-run REFUSE | REFUSE | The 06-21 long was truncated; how it finished was genuinely unknown | **beneficial** — Q29 applied correctly |
| 2026-07-20 volume REGRESS −2.2 | REGRESS | He had just run 0 mi in the week of 06-29 and 28 mi against 49.5 in 06-22 | **beneficial** — the prescription was ahead of him |
| 2026-07-27 → 08-31 volume, 6 further applied steps | REGRESS ×6 | 08-17 week 28.4 mi, 08-24 week 34.8 mi, 08-31 week 14.7/13 = 113% | **harmful** — the belief fell below what he was demonstrably running |
| 2026-07-27 long-run "REGRESS +1.5" | REGRESS | Proposed an INCREASE past its own stated limit | **harmful** — see finding 2 |
| 2026-09-02 threshold HOLD | HOLD | His 09-01 session at 7:02/mi, graded FULL, recorded as *contradictory* | **harmful** — see finding 3 |
| 2026-09-02 long-run HOLD | HOLD | The 08-30 long deteriorated late (avg HR 159 against a 145 cap) | **beneficial** — correct and well-reasoned |

---

## Findings

### 1 · The volume REGRESS compounds against a belief it has already passed

`evaluateWeeklyVolume`'s `allWeeksMissed` branch compares completion against the
week the **plan prescribed**, then moves the **carried belief** by up to −5%. The
two are different quantities (Rule 16). Once the belief has fallen below what he
actually runs, nothing stops it falling further.

At 2026-08-17 the belief was 33.5 mi/wk. The three non-cutback weeks in the
window completed 39.8, 4.2 and 47.5 mi — two of them **above** the belief being
reduced. It was reduced anyway, because each had missed a 46-64 mi prescription
written by the *previous* block. Seven consecutive applied steps, 43.5 → 30.2.

The reason string is honest about the prescription — "the prescribed level is
running ahead of what is being absorbed" — and that sentence is true. The number
it moves is not the prescription.

**Suggested owner question:** should REGRESS clamp at `max(proposed, mean
completed non-cutback volume)`? That is continuous, monotone, and cannot walk
below demonstrated work.

### 2 · A REGRESS that proposes an INCREASE, past its own limit, and says "eases"

One record, 2026-07-27, `LONG_RUN`:

```
decision   REGRESS
magnitude  +1.5 long_run_mi   (limit 1, LONG_RUN_MAX_STEP_MI)
reason     "The long run eases from 12 mi to 13.5 mi."
```

`levers/long-run.ts`, the `bothMissed` branch:

```ts
const proposed = Math.max(roundTo(meanCompleted), roundTo(before - LONG_RUN_MAX_STEP_MI));
```

`Math.max` exists to stop the proposal falling more than a mile. It has no upper
clamp at `before`. Here `before` was `nextWeekLongRunMi` = 12 and `meanCompleted`
was 13.5 (his 18.0 mi long of 07-25, and 9.09 mi in a week that prescribed 17),
so a "regression" proposed +1.5 mi — **half a mile past the cap the record
itself names**, under a sentence saying the opposite.

Three defects in one record: an upward move labelled REGRESS, a magnitude
exceeding its declared limit, and a coach sentence that contradicts its own
number (Rule 16). The `_lever_contracts.test.ts` suite does not catch it because
its fixtures never put `meanCompleted` above `before`.

### 3 · A FULL threshold session, 20 s/mi faster than the anchor, recorded as contradictory

At the final decision point the threshold lever holds, on this evidence:

```
included      2026-08-16  HALF race at 7:47/mi, graded FULL
              2026-09-01  threshold session at 7:02/mi, graded FULL
contradictory 2026-09-01  "Points the other way at 7:02/mi against an anchor of 7:22/mi."
decision      HOLD · "Recent sessions point in both directions."
```

The direction rule is `agree >= 2 && agree >= 2 * disagree`. With one session on
each side neither direction clears it, and the tie-break
`slower.length < faster.length ? slower : faster` is false at 1-vs-1, so **the
faster session is the one written into the contradictory list.** His best
threshold work of the block is filed as evidence against itself.

This is not a units artifact, and that was checked rather than assumed. The CIM
plan's own `authored_state.derived_from.bestRecentVdot` is **44.1** after the
half; the repo's own Daniels table (`tPaceFromVdot`) puts T pace at VDOT 44.1 at
**462 s/mi**, against a raced 467 — about 5 s/mi apart. So admitting a half at
its finish pace is close to right at this runner's level. The 09-01 session at
422 s/mi sits just under VDOT 49 (`tPaceFromVdot(48) = 429`). It is a genuine
~45 s/mi disagreement between two FULL-graded pieces of evidence 16 days apart,
and HOLD is a defensible answer to it.

What is *not* defensible is that a 1-1 split can never resolve. Any runner who
races and then trains well sits at 1-1 for four weeks. **The 2:1 majority rule
is a wall at low evidence counts**, which is precisely the failure the lever's
own comment says it fixed when it replaced unanimity.

### 4 · The threshold lever spends a race's FINISH pace with no distance step

`GradedSession.workPaceSecPerMi` is compared straight to the anchor. For a
threshold session that is correct. For a **race**, which Q20 admits as directly
relevant, it is the average over 6.2 or 13.1 miles, and a 10K and a half are
raced at different fractions of threshold. The half happens to land within
~5 s/mi. **His next race is the Santa Monica 10K on 2026-09-13**, raced faster
than T, and the same code path will read it the same way in the opposite
direction. Either the field needs a race-specific meaning or the lever needs the
equivalence step; today neither exists.

### 5 · C4 compares MEAN work HR to the ceiling, and the mean hides the drift

His 2026-09-01 session graded **FULL**. Its four work reps ran at HR 158 → 161 →
164 → **166** against the spec's own pass rule, `avgHr ≤ 164 on the work`. The
duration-weighted mean is 162.2, so C4 is MET and the breach on the last rep is
invisible. `assessDeterioration` does not see it either: +3.5 bpm across the
thirds is under the 6 bpm signal.

Q12's stated reason for having seven conditions rather than a pace-OR-HR rule is
that "averages can hide failed repetitions". C4 is itself an average. This is
also the `ADAPTATION_PROGRESSION_DOCTRINE` case — *a fast-but-uncontrolled
session is not evidence pace should move* — and FULL is the grade that unlocks
the larger 5 s/mi step.

### 6 · PRODUCTION DATA · a post-race recovery block is flagged as ordinary, and as a PEAK

`pln_eb73331e19230ad9`, `mode: 'recovery'`, authored the day after his A-race
half, carries:

```
weekIdx 0  2026-08-17  is_cutback FALSE  is_peak FALSE
weekIdx 1  2026-08-24  is_cutback FALSE  is_peak TRUE
```

Rule 8 — *"It cannot look at taper and recover as my 'normal'. Ever."* The
canonical engine delegates the whole of that protection to one boolean,
`WeekObservation.isCutback`, and the row that would populate it says `false` for
two weeks of prescribed post-race recovery, with the second marked a peak.

Read naively, the 2026-08-17 week counts as a completed non-cutback week at
**167%** (28.4 mi run against a 17 mi recovery prescription) and becomes evidence
supporting an increase. The harness reads `training_plans.mode` instead and
records the row as a defect; nothing in the app does. Two separate things to fix:
the rows, and the fact that a Rule 8 protection rests on a field nothing gates.

Correcting it made the engine **more** regressive here (REGRESS 17 → 20), because
excluding the recovery weeks leaves only the missed July weeks in the window.

### 7 · `evaluateWeeklyVolume` never windows its key sessions

`weeks` is windowed to three. `keySessions` is not windowed at all — it receives
`input.qualitySessions` whole and marks every session graded below SUBSTANTIAL as
contradictory forever. At 2026-09-02 the volume record carried **19 contradictory
items**, including *"2026-06-11 A key session graded DIFFERENT"* — a June session
in a September decision. Nothing in `input.ts` says the caller must pre-window.

It is not currently load-bearing (the sensitivity run proves week completion
binds first), but it is a latent wall of exactly the Rule 21 shape.

### 8 · Coach-voice: "The long run stays at no distance."

Three distinct reason strings render this. `miText(0)` → `fmtMi(0)` → null →
`'no distance'`, because `before` is `plan.nextWeekLongRunMi`, which is 0 in any
week the plan schedules no long run. The runner reads a sentence that is not
English about a lever that is not applicable.

---

## Rule 15 · which real session reached which mechanism

| Mechanism | Reached by |
|---|---|
| Threshold, below corroboration bar | June-August; only 2 sessions ever cleared admissibility |
| Threshold, contradiction HOLD | 2026-09-02, AFC half vs the 09-01 threshold set |
| Race as threshold evidence | AFC half 2026-08-16 (`races.actual_result` 6113 s) |
| 5K/marathon wrong-lever exclusion | Big Sur, LA Marathon (`WRONG_LEVER_FOR_THIS_SESSION`) |
| Treadmill excluded for pace, kept for load | 2026-08-27, 08-20, 08-18, 08-06, 08-04 |
| Heat, terrain not representative for pace | 2026-08-11 (heat), 2026-08-26 (361 ft/mi) |
| Truncation, work captured (Q29 pace OK) | 2026-06-11, 06-16, 06-19, 06-21, 08-11, 08-23, 08-26, **09-02** |
| Truncation fatal to durability | 2026-06-21 long → long-run REFUSE ×6 |
| Prescribed-recovery / taper week exclusion | 2026-07-06, 08-10, 08-17, 08-24 |
| Measured-zero week (not a failed read) | 2026-06-29, 0 mi against 40 prescribed |
| Failed read → REFUSE on all three levers | asserted directly with `readable: false` |
| Multi-week consistency | 2026-08-17 → 08-31, three weeks at 167% / 92% / 113% |
| Volume REGRESS | 15 records |
| Long-run REGRESS | 5 records |
| Long-run late-deterioration HOLD | 2026-08-30 long, avg HR 159 against a 145 cap |
| Cadence deferral to the weekly boundary | 13 suppressed records |
| Easy runs with strides are not threshold evidence | 2026-09-02 (6 strides), never enters `qualitySessions` |

**Nothing reached these** — 13 of roughly 30 branch shapes fired:

- **every PROGRESS branch, on all three levers**
- `THRESHOLD_PACE` REGRESS, the same-day-oscillation HOLD, the all-on-anchor
  confirmation HOLD, and the below-meaningful-step HOLD
- `WEEKLY_VOLUME` REFUSE (both the <3-weeks and the unreadable-week paths), the
  bad-key-session HOLD, the short-long-run HOLD, the repeated-deterioration
  HOLD, the steps-this-cycle HOLD, and the `planAlreadyProgresses` HOLD — the
  clause the lever's own comment calls "what makes this a coach and not a
  ratchet"
- `LONG_RUN` `failedFollowUp` HOLD, `unreadableFollowUp` REFUSE, the coherence,
  collision, weeks-remaining, steps-this-cycle and **spike-ceiling** HOLDs
- exclusion reasons `DATA_UNREADABLE` and `SINGLE_EXCEPTIONAL_PERFORMANCE`

Four of the decision-point classes the brief named turn out to be **unreachable
on his real history**, and that is itself the finding rather than an omission:

- **pace improvement without volume readiness** — the arbitration path that
  defers a pace move while volume is not ready needs a moving pace verdict.
  There was never one, so cross-lever suppression was exercised only by the
  cadence rule (13 records), never by lever-vs-lever demand.
- **volume completion without pace improvement** — needs a volume PROGRESS.
  There was never one.
- **durability improvement** — needs a long-run PROGRESS. There was never one.
- **a one-off exceptional performance** — the
  `SINGLE_EXCEPTIONAL_PERFORMANCE` exclusion fires only on two qualifying
  sessions on the SAME DAY. He never had two, so the corroboration bar caught
  every one-off before that exclusion could.

Per Rule 15, adding more decision points would not help. These need a runner
whose evidence clears an upward bar, and across three months of his real
training none does.

---

## Inputs that could not be built, and why

Recorded rather than filled in. Thirteen distinct, from `Diagnostics.couldNotBuild`:

| Input | Why |
|---|---|
| Stimulus grade, 2026-06-02 / 06-04 / 06-09 | No `phases` on the row. Nobody segmented the work, so C1, C2, C5 and C6 are all unreadable → INSUFFICIENT. Pre-watch-app Strava rows. |
| Stimulus grade, 2026-08-11 race-week tune-up | Pace discounted for heat (96.9 °F) and the HR channel unreadable. Two discounted channels is an absence of evidence, not evidence. |
| Work denominator, 2026-05-19 / 05-26 threshold | `workout_spec` carries neither a rep set nor `tempo_distance_mi`. |
| Work denominator, race rows (08-16, 09-13) | A race spec has a pace band, not a work denominator. Races bypass the grader and read from `races.actual_result` instead. |
| Next-week prescription, 08-10 / 08-12 / 08-17 / 08-24 / 08-31 | The AFC block ended on race day and the CIM block was not authored until 08-31. For five decision points the plan genuinely prescribed nothing ahead. |
| Race thirds, every race | `races.actual_result.miles` is EMPTY on all 11 races. There are no per-mile race splits, so Q13 gets an honest refusal rather than whole-run thirds off the training row. |
| Long-run thirds where the prescription varies pace | "LONG · 9mi @ HM" finishes fast by design. `comparable: false` → deterioration UNKNOWN, per Q13's own warning. |
| Cutback status, weeks 2026-05-11 and 2026-08-31 | No `plan_weeks` row for the plan in force. Read as false and reported. |
| Long-run/prescription date match, weeks 07-13 and 07-27 | The long was prescribed for 07-19 and 08-02; the longest runs were 07-13 and 08-01. Matched by week, and the slip recorded. |

Also worth naming: **`profile.weekly_frequency` is NULL** for this runner, the
Rule 11 defect CLAUDE.md records for 8 of 16 production profiles. It is not an
input to this engine, but it is live in his row.

---

## Falsification

Per Rule 18, the no-lookahead filter was broken on purpose and watched. Deleting
the `< asOf` comparison in `buildInputAt`'s `before()`:

```
× no record cites EXCLUDED or CONTRADICTORY evidence dated on or after its own decision date
  AssertionError: expected [ …(537) ] to deeply equal []
  + "2026-08-03 THRESHOLD_PACE cited …-2026-08-11#1842 @ 2026-08-11"
  + "2026-08-03 THRESHOLD_PACE cited …-2026-08-16#0615 @ 2026-08-16"
  + "2026-08-05 WEEKLY_VOLUME cited trd_512EF492… @ 2026-08-06"
  … 534 more

× a fabricated future session never reaches any earlier decision
  AssertionError: expected [ '2026-06-03 THRESHOLD_PACE', …(39) ] to deeply equal []
```

537 leaks and 40 POISON citations. The filter was restored and all 12 tests
returned green.

**One honest negative, stated rather than hidden.** The *included*-evidence test
did **not** fail. The future sessions that leaked were excluded by grade or by
window rather than included, so an included-only assertion could not see them.
That is exactly why the excluded/contradictory test exists, and it is what an
included-only check — the shape the engine's own ledger uses — cannot catch.

---

## Nothing was written to production

- Every statement issued against production was a `SELECT`, run as
  `faff_readonly` (schema exploration by `psql -c`, the extract by one `psql -f`).
  No `INSERT`, `UPDATE`, `DELETE`, DDL or plan rebuild was issued, and the role
  cannot issue one.
- The replay itself **opens no database connection at all**. It reads
  `real-history.snapshot.json` and nothing else, and its vitest config
  deliberately omits `setupFiles`, so `.env.local` is never loaded and no
  `DATABASE_URL` is in scope. The production write barrier in `lib/verify/`
  therefore had nothing to refuse — it was neither triggered nor worked around.
- No plan was persisted, no rebuild triggered, no client run that could post an
  activity.
- `git status` on the branch shows one untracked directory,
  `scripts/adaptation-real-replay/`. Branch `proof/adaptation-real-replay`, base
  `d88d0e3b`, not merged.

## Where the harness lives, and why it is not under `lib/`

`lib/adaptation/canonical/_cannot_mutate.test.ts` guard 4 asserts that no file
under `web-v2/lib` or `web-v2/app` contains the string
`@/lib/adaptation/canonical`, with **no allowlist**. Separately,
`generated-content-registry.ts` lists every engine file in `MODULE_ORPHANS`
because "this whole directory is deliberately unwired, and gated that way", and
`_generated_content_gate.test.ts`'s staleness check fails the moment any of them
gains an importer inside `web-v2/{app,lib,components,scripts}`.

A replay must import the engine. The first draft of this harness, under
`web-v2/lib/adaptation/canonical-replay/`, turned both gates red — correctly.
Rather than edit gates this session does not own, or evade guard 4 with a
relative import, the harness sits at the repo root beside `scripts/sim` and
`scripts/voice-eval`, outside every directory those gates scan.

**This is a decision someone has to make before the engine can be wired at all.**
Today the canonical Adaptation Engine cannot acquire its first consumer inside
the application — not a route, not a cron, not a proof harness — without an
argued allowlist being added to those two gates.

One gate finding was mine and is fixed: `check-coercion.sh` flagged
`sec > 0 ? sec / mi : null` in the harness as zero-erasure. It is now a named
`distanceAndDurationRecorded` predicate, because the null there is Rule 11's
ABSENCE state and the code should say so.

---

## What this replay cannot fail on

- **A wrong input.** Prescriptions are matched to activities by calendar date;
  two long-run slips are recorded above, and a session run a day late would be
  graded against the wrong prescription or dropped. `phases` arrives already
  segmented by the watch and is trusted.
- **The seed.** The threshold anchor is seeded at 442 s/mi, the T target the
  plan in force actually prescribed on 2026-06-04. Deliberately not
  `authored_state.t_pace_s_per_mi` (407), which is goal-blended. If the seed is
  wrong, every proposal is wrong by the same offset and nothing here notices.
- **The counterfactual.** The belief is carried forward under the engine's own
  decisions, so from the first move onward this describes a season he did not
  have. Every later row is conditional on the earlier ones.
- **Whether the bounds are right.** It can show the volume lever moved −5%; it
  cannot show −5% was the right size.
- **Long-horizon consequence.** Verdicts are judged against the following few
  weeks, not against a race he has not run.
