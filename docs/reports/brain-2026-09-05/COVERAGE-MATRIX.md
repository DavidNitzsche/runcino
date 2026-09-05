# The adaptation coverage matrix

**Read-only audit, 2026-09-05, against `origin/main` at `bcfe68b80`.**
**Nothing in this pass was fixed. Nothing was written to the database.**

The owner's complaint was that the brain "contains multiple intelligent modules
that are shadowed, unwired, orphaned or absent from the shipped product," and
that he wanted one matrix saying, per lever, exactly where the path stops.

This is that matrix. Twenty-three levers, seventeen columns each. Where a column
has no owner it says **MISSING**, not a description of what ought to exist.

---

## 0 · The three sentences that explain every row below

**One.** There is exactly one automatic-adaptation authority and it is off:
`AUTOMATIC_ADAPTATION_AUTHORITY: false` at
`web-v2/lib/plan/adaptation-authority.ts:96`. That is an owner ruling from
2026-09-02 and it is honestly implemented. It is not the problem.

**Two.** The seal is not direction-neutral. `PROPOSABLE_KINDS` at
`web-v2/lib/plan/adaptation-authority.ts:108-109` is
`{downgrade, shave, reschedule, field_test}`. Every one of those either reduces
load or spends a session. The upward action kinds the engine can emit
(`recompute_paces`, `reshape`, `mark_upgrade`, `mark_dirty` at
`web-v2/lib/plan/adapt.ts:287`) are **not** in that set, so
`sealAutomaticActions` at `adaptation-authority.ts:247-259` converts them to
record-only notes. The result is structural, not incidental: **inside the seam a
downward adaptation can still land, because the runner can accept a card, and an
upward one cannot land by any route.** Exactly one upward path exists, and it
works precisely because it sits OUTSIDE the seam by explicit exemption
(`adaptation-authority.ts:66-73`): `reanchorActivePlan`. It also keeps no ledger,
which is why the engine's own records say the app has never pushed. See the
correction at the end of section 1.

**Three.** The card the downward lane depends on has no screen in the shipped
app. `Components/CoachDecisionCard.swift` and the
`API.fetchWorkoutProposals()` call at `native-v2/Faff/Faff/Views/TodayView.swift:3323`
live in the v4 shell, and `native-v2/Faff/Faff/FaffApp.swift:533-537` renders
`RootTabView()` only under the `-faffLegacy` launch argument; the live shell is
`FaffV5Root`. Nothing under `native-v2/Faff/Faff/ViewsV5/` or `DesignV5/`
references `workout-proposals`, `CoachDecisionCard` or `plan_adapt`.

So the pipeline inside the seam is: detect, refuse the upward half outright,
route the downward half to a card, render the card nowhere. Production agrees,
below.

**One more sentence, because the brief asked to be corrected.** The single lever
that is genuinely complete end to end (threshold pace) is complete because it
runs outside all of this. That is not a hidden hack: it is a documented, argued
exemption. But it means the answer to "what is wrong with the brain" is not "the
seal". It is that the seal made the sealed half unobservable, the shipped phone
lost the screen the sealed half depends on, and the one working lever reports to
nobody.

---

## 1 · What production says (read-only, `DATABASE_URL_RO`, owner uuid `0645f40c…`)

### `coach_intents`, every reason, every user, whole life of the table

```
strength_skip              87    plan_adapt_downgrade         5
watch_completion           66    plan_adapt_long_floor        5
watch_heat_easing          51    workout_swapped              4
strength_resume            41    plan_adapt_reschedule        3
calibration_completed      31    plan_adapt_overridden        2
plan_adapt_missed_noted    20    goal_card_dismissed          2
coach_log_week_close       16    vdot_auto_recalc             1
plan_adapt_drop_missed     15    lthr_auto_calibrated         1
profile_field_added         8    plan_adapt_gap               1
                                 (+ 5 single-row coach_log_* kinds)
```

**Zero rows, ever, for every upward or pace-moving reason:**
`plan_adapt_upgrade`, `plan_adapt_bump`, `plan_adapt_progression`,
`plan_adapt_recompute_paces`, `plan_adapt_reshape`, `plan_adapt_sealed`.

CLAUDE.md Rule 21 recorded this as "309 rows, 20 distinct reasons, zero upward."
The count has moved; the zero has not. **I can correct one thing in the brief:
the ledger is now worse than Rule 21 states, because the seal's own accounting
reason `plan_adapt_sealed` also has zero rows.** The seal landed 2026-09-02 and
has never once had a plan-mutating action to refuse. That is not the seal
working. It is the detectors upstream of it producing nothing.

### `plan_workout_proposals`, the entire table

| id | kind | status | workout date | created | resolved |
|---|---|---|---|---|---|
| 1 | downgrade | expired | 2026-07-02 | 2026-07-01 | 2026-07-03 |
| 2 | downgrade | expired | 2026-07-07 | 2026-07-06 | 2026-07-08 |
| 3 | downgrade | expired | 2026-07-09 | 2026-07-10 | 2026-07-10 |
| 4 | downgrade | expired | 2026-07-12 | 2026-07-13 | 2026-07-13 |
| 5 | downgrade | expired | 2026-08-06 | 2026-08-07 | 2026-08-07 |
| 6 | field_test | **pending** | 2026-08-25 | 2026-08-23 | |
| 7 | field_test | **pending** | 2026-09-09 | 2026-09-02 | |

Seven rows in the life of the product. **Zero accepted. Zero dismissed.** All
five downgrades are readiness pullbacks from a detector that has since been
deleted (RUNNER-OWNS-READINESS, 2026-09-02), so nothing can write that kind
again.

Row 6 is the proof that nobody is looking. `loadPendingProposals` at
`web-v2/lib/plan/workout-proposals.ts:159-166` auto-expires any pending row
whose `workout_date_iso < CURRENT_DATE` on **every single fetch**. Row 6's date
passed eleven days ago and it is still `pending`. Either the endpoint has not
been called for this runner in eleven days, or the expiry write is failing
silently into the `.catch(() => {})` on `workout-proposals.ts:166`. Both
readings agree with finding three in section 0.

### `adaptation_shadow_log` · the engine has been asking to push, daily, and losing

```
today_iso   decision   agrees_with_live   engine_previous → proposed
2026-08-31  PROGRESS   false              435 → 430 sec/mi   (x3 readings)
2026-09-01  PROGRESS   false              435 → 430 sec/mi   (x2)
2026-09-02  PROGRESS   false              436 → 430 sec/mi   (x2)
2026-09-03  PROGRESS   false              436 → 430 sec/mi   (x1)
```

Explanation string on every one of them: "Your recent threshold work
consistently supports faster training." `live_training_lead_fired = false` and
`live_recompute_paces_fired = false` on all eight rows. **Four consecutive days
of an upward proposal, correctly reasoned, against a live path that did nothing
each time.** This is Rule 21's zero with dates attached.

The `PROGRESS` verdict stops on 2026-09-03 and does not return. The reason is in
the same table: from 2026-09-04 the rows read `convergence_state
REANCHORED_CANONICALLY`, `evidence_mode user_prior`, "No recent threshold work
to price the target from." A full block re-author on 2026-09-03 reset the
evidence the proposal rested on.

### The one lever that did move, and how

`plan_proposals` carries `silent_rebuild | auto_applied | silent_rebuild_dispatch |
2026-09-03`. `training_plans.authored_state->>'t_pace_s_per_mi'` went from `394`
on the archived plan to `430` on the live one. `.github/workflows/silent-rebuild.yml:9`
is `workflow_dispatch:` only · **there is no schedule.** So the single mechanism
that actually moves a prescribed number in production is a human running a
workflow by hand, which demolishes the block and re-authors it from scratch.
CLAUDE.md Rule 23: "Manual triggering is a bridge, never a fix."

### `training_plans.adaptation_log` on the live plan is `[]`

`last_adapted_at` is `2026-09-05`. The log is an empty array. Rule 21's "make it
observable" requirement is unmet on the active block: something stamped the
timestamp and recorded nothing about what it did.

### The canonical engine's deferral queue has no table

```
to_regclass('public.canonical_adaptation_deferrals') → NULL
to_regclass('public.canonical_adaptation_shadow_log') → present
```

`web-v2/db/migrations/165_canonical_adaptation_deferrals.sql` exists in the repo
and has never been applied. `web-v2/lib/audit/generated-content-registry.ts:361-367`
is honest about this ("applied to a local scratch database only"), which is to
its credit, but the consequence stands: the 2026-09-03 `WEEKLY_VOLUME` record
carries `suppressed_by.reconsiderAtISO = 2026-09-07`, and there is nowhere in
production for that promise to live. `web-v2/lib/adaptation/canonical-shadow/run-live-shadow-evaluation.ts:332-341`
describes the queue as the thing that stops a `reconsiderAtISO` being "a PROMISE
nothing kept." On production it is exactly that.

### `canonical_adaptation_shadow_log` · three rows, one day, a plan that no longer exists

All three rows are `evaluated_at 2026-09-03 18:22`, against `pln_9a57561debb776e5`,
which was archived twenty-one minutes later at `18:43`. Nothing since, across two
days, while the sibling shadow pass in the same cron loop
(`app/api/cron/run-adaptations/route.ts:157-158` vs `:184-186`) has written every
day including today. **The cause is UNVERIFIED.** The live plan does carry a
readable `t_pace_s_per_mi` (430), so it is not the refusal at
`web-v2/lib/adaptation/canonical-shadow/live-input.ts:697-699`. Candidates I
could not separate statically: a refusal inside `buildLiveCanonicalInput`
(`live-input.ts:543/548/560/565/575`), a throw caught at
`run-live-shadow-evaluation.ts:222`, or a persistence failure swallowed by
`persistOne` returning `false`.

### Two live owners for "threshold pace", 42 s/mi apart, on the same day

On 2026-09-03 the canonical shadow log recorded `THRESHOLD_PACE before_value
394` (read from `authored_state.t_pace_s_per_mi`,
`live-input.ts:690`) while `adaptation_shadow_log` recorded `engine_previous
436` for the same runner on the same day (read from the priced
`plan_workouts` rows). Same name, same runner, same date, two numbers. CLAUDE.md
Rule 16.

### A correction to the brief I was given, and to CLAUDE.md Rule 21

**I was told, and I believed for most of this audit, that no upward adaptation
has ever fired in production. That is wrong, and the way it is wrong matters.**

`training_plans.authored_state.pace_zone_event` on the archived plan
`pln_9a57561debb776e5` reads:

```json
{"atISO":"2026-09-02T05:55:11.121Z","fromVdot":46.3,"toVdot":47.7,
 "direction":"faster","evidenceSource":"training",
 "acknowledgedAt":"2026-09-03T06:54:06.847Z"}
```

An upward re-anchor, off **training** evidence, that rewrote 76 workouts and
wrote 12 rationales (`authored_state.pace_recompute.workouts_updated: 76`,
`rationales_written: 12`, `source: "reanchor_fitness_shift"`), surfaced through
`/api/v5/paces` and `ViewsV5/PacesMovedV5.swift`, **and the runner acknowledged
it on his phone the next morning.** The upward lever works. It is live. It has
fired.

It fires through `reanchorActivePlan`
(`web-v2/lib/plan/reanchor-plan.ts:466`), called from
`web-v2/app/api/cron/snapshot-projections/route.ts:129`, on the daily `30 7 * * *`
schedule. That is the one automatic plan writer **deliberately left outside the
seam**, named as such at `web-v2/lib/plan/adaptation-authority.ts:66-73`.

So the real finding is sharper than "nothing pushes up":

- The upward lever that works writes **no `coach_intents` row** and **no
  `training_plans.adaptation_log` entry**. That is exactly why Rule 21's census
  reads zero, and why the live plan's `adaptation_log` is `[]`.
- **The engine's own observability cannot see its only functioning progression
  path.** Rule 21 asks that every adaptation write what it did, in which
  direction, and on what evidence. The one that does push up writes it into a
  jsonb blob on the plan row, which no ledger reads and which a block rebuild
  discards: the live plan `pln_7636bcc0a201bf2d` has `pace_zone_event = NULL`,
  so the acknowledged 2026-09-02 push is already gone from the runner's record.
- Everything the seam DOES gate is still at zero, and that half of Rule 21 stands.

---

## 2 · Legend and shared cells

**Status values.** `live` = valid evidence can alter a future prescription
today. `shadow` = it computes and logs and cannot write. `held` = wired but
blocked behind an undecided question. `sealed` = deliberately switched off by an
owner ruling. `orphaned` = built, tested, no caller. `missing` = no owner at all.

**A lever is complete only when** valid evidence can alter an appropriate future
prescription, produce an explanation, and reach every intended surface behind the
right authority boundary. **One of the twenty-three meets that bar: threshold
pace.** Everything else stops somewhere.

**Shared cells, so they are not repeated twenty-three times:**

- **Authority gate, every automatic path:** `web-v2/lib/plan/adaptation-authority.ts:96`,
  applied at `:224-262` and `:273-275`. The three exemptions are named at `:53-73`:
  runner-initiated routes, AUTHORED lifecycle facts in `app/api/cron/plan-drift/route.ts`,
  and `reanchorActivePlan`.
- **The propose lane cannot carry most levers.** `plan_workout_proposals.action_payload`
  holds only `newType`, `newDate`, `shaveFraction`
  (`web-v2/lib/plan/workout-proposals.ts:33-36`, `:125-127`), and the accept
  route rebuilds exactly those three
  (`web-v2/app/api/plan/workout-proposals/[id]/accept/route.ts:48-55`). **Even
  with the seam open on the propose side, a dose, a pace or a distance bump has
  nowhere to live.**
- **Any explanation is keyed on the row having changed, not on a decision having
  been made.** `web-v2/lib/coach/adaptation-info.ts:188` computes `wasAdapted`
  from type / sub-label / distance / date differing from the authored original.
  A `note` changes none of those, so every record-only judgment is invisible on
  every surface by construction.
- **Watch adaptation explanation:** exactly one channel,
  `web-v2/lib/watch/build-workout.ts:1274-1310` (`sessionMoved.line`), rendered
  `WatchRouterV5.swift:1783` → `FacesLobbyV5.swift:275-279`. Plus `heatNote`
  (`build-workout.ts:2296`), which shares the same single 14pt register and loses
  to `sessionMoved` when both exist.
- **Phone adaptation explanation:** `originalType` / `originalSubLabel` are read
  at `app/api/v5/today/route.ts:755-756` into `lib/faff/v5-today.ts:946-947` and
  **never read by any composer branch; `grep originalType native-v2` returns
  nothing.** The v5 wire carries no adaptation reason at all.

---

## 3 · The matrix

Every lever uses the shared cells above unless it says otherwise. `MISSING`
means no owner, not "not found yet".

---

### 1 · Weekly mileage

| Column | Owner |
|---|---|
| evidence inputs | Authoring `recentWeeklyMileage` `generate.ts:898`, `recentPeakWeeklyMileage` `:967`, `resolveRampBase` `:1457` / `:1692`. Adaptation (shadow) `WeekObservation.completedMi`, `lib/adaptation/canonical/levers/weekly-volume.ts:182`. Down `detectVolumeOvershoot` `lib/plan/adapt.ts:4016`. Orphan advisory `lib/adaptation/volume-evidence/classify.ts:204`, `admit.ts:168` |
| evidence exclusions | Rule 8 via `lib/training/normal-window.ts:281/:335/:385`, `SUSTAINED_WEEK_RANK = 3` `:668`, `SUSTAINED_LOOKBACK_WEEKS = 16` `:679`; canonical lever `weekly-volume.ts:198-208` and `:355-385`; canonical row `runNotMergedSql` `adaptive-ramp.ts:352` and `classify.ts:94`; race recency `OVERSHOOT_RACE_RECENCY_DAYS` `adapt.ts:1196` |
| belief/state owner | **FOUR.** `LoadProgressionContract` `lib/plan/load-progression-contract.ts:279`; `DemonstratedVolumeBelief` `volume-evidence/belief.ts:150` (orphan); `RampOpportunity.currentPeakWeekly` `adaptive-ramp.ts:109`; `currentWeeklyMi` `weekly-volume.ts:183` |
| proposal generator | Up `planUpgrade` `adaptive-ramp.ts:644`. Down `adapt.ts:4832`. Shadow `evaluateWeeklyVolume` `weekly-volume.ts:182`. Orphan `volume-evidence/respond.ts:222` |
| progression threshold | ACWR `< 1.3` `adaptive-ramp.ts:177` **and** last 2 key sessions earning progression `:181/:185` **and** last long decoupling `< 5%` `:160` **and** headroom `> ceiling x 0.05` `load-progression-contract.ts:174` **and** no bump in 7 d `:159` **and** no pull-back in 48 h `:921`. Caps `+5.0 mi/wk` `:634`, `+1.0 mi/easy day` `:635`. Canonical: 3 consecutive non-cutback weeks at `>= 95%` `contract-constants.ts:138/:151`, step `<= 5%` `:175` |
| regression threshold | `completedMi > baseline x 1.25` `adapt.ts:1128`, baseline `max(scheduled7d, chronic28d)` `:1082`; response a flat **17% shave of the next 7 days** `:4863`. **No ACWR gate, no execution precondition, no cooldown.** Canonical REGRESS bounded to `-5%` `weekly-volume.ts:583-660` |
| arbitration owner | Shadow `arbitrate` `lib/adaptation/canonical/arbitration.ts:443`, priority `:187`, `MAX_MATERIAL_LEVERS_PER_CYCLE = 1` `contract-constants.ts:333`. Live **MISSING** |
| interaction | `detectSimultaneousStressAddition` `lib/plan/adjudication/adjudicate.ts:444` · called only from the orphaned `volume-evidence/respond.ts:413` |
| future-plan-mutation owner | `applyAdaptations` `adapt.ts:1610`; bump `UPDATE` `:1869`, shave `UPDATE` `:1840`. **There is no `plan_weeks` mileage column** · `generate.ts:13820` inserts only `week_idx, week_start_iso, phase_id, is_race_week, rationale, is_peak, is_cutback`, so weekly mileage is always `SUM(plan_workouts.distance_mi)` |
| authority gate | Up refused on the first statement `adaptive-ramp.ts:1031`. Down `shave` is in `LOAD_REDUCING_ACTION_KINDS` `adapt.ts:1317`, always proposed |
| persistence | `coach_intents` `adapt.ts:1662-1672`; `plan_workout_proposals` `workout-proposals.ts:132`; `training_plans.adaptation_log` `adapt.ts:2181`, which stores only `{n, ts}`; `canonical_adaptation_shadow_log` |
| runner-facing explanation | Down `adaptation-info.ts:141`. Up never written. Orphan sentence `volume-evidence/explain.ts:60` |
| phone serialization | Status only: `lib/plan/v5-block.ts:166`, `:506`; `lib/plan/week-loader.ts:28`. Change explanation **MISSING** |
| watch serialization | Status only `build-workout.ts:808`, `:800`. Change explanation via `sessionMoved.wasLine` when a row's distance moved |
| tests | 19 files touch the UP path; **12 sit under `lib/adaptation/canonical*`, which `canonical/_cannot_mutate.test.ts:5-17` proves cannot write**, and 1 more is the orphan directory. Production-reachable UP files: 3, and all three assert the refusal |
| production reachability | **The upward path has never fired.** `docs/reports/core-closure-2026-09-04/ADAPTATION-VERDICT.md:246`: gate `V2-week-completion (>= 0.95)` is "NO, 0.9023" before and after the readability fixes. `plan_adapt_upgrade` and `plan_adapt_bump`: **0 rows, verified against production.** Down: 5 proposals, all expired unactioned |
| **status** | **up sealed · down live via a card nobody can see · canonical shadow · advisory orphaned** |

---

### 2 · Run frequency

| Column | Owner |
|---|---|
| evidence inputs | `profile.weekly_frequency` `generate.ts:17510` (a stated setting); measured fallback `derivedTrainingDaysPerWeek` `generate.ts:2384` |
| evidence exclusions | Canonical row only `generate.ts:2394`. **No Rule 8 filter**; the header at `:2366-2372` argues rank-3 makes one depressed window harmless, which is mitigation, not exclusion |
| belief/state owner | **MISSING.** No module holds a belief about frequency |
| proposal generator | **MISSING** |
| progression threshold | **MISSING** |
| regression threshold | **MISSING** |
| arbitration owner | **MISSING** |
| interaction | Frequency is a constraint on other levers, never a lever: `adapt.ts:4619`; gates thirteen mechanisms per `generate.ts:2344-2352` |
| future-plan-mutation owner | **MISSING** |
| authority gate | N/A |
| persistence | `profile.weekly_frequency`. No `coach_intents` reason exists |
| runner-facing explanation | **MISSING** |
| phone serialization | Settings write only `app/api/profile/route.ts:141` → `API.swift:2160`. **No route emits a plan-derived days-per-week count** |
| watch serialization | **MISSING** |
| tests | 0 up, 0 down. Nearest is `_adapt_invariants.test.ts:364/:378`, which assert reschedule REFUSES when frequency is unknown |
| production reachability | Not reachable. Live hazard: `generate.ts:2338` records `profile.weekly_frequency` NULL for 8 of 16 production profiles, the owner's among them |
| **status** | **missing** |

---

### 3 · Long-run distance

| Column | Owner |
|---|---|
| evidence inputs | Authoring `recentLongMi` `generate.ts:2110`, `coherentRecentLong` `:434`. Shadow `LongRunObservation` + `longestInPrior30DaysMi` `canonical/levers/long-run.ts:85`. Ramp `currentPeakLong` `adaptive-ramp.ts:123` |
| evidence exclusions | **Split correctly per Rule 8's corollary.** Habit half filtered; spike anchor unfiltered and named at `long-run.ts:82-86` and `generate.ts:1793`, `:5418` |
| belief/state owner | **TWO.** `currentLongRunMi` `long-run.ts:110` (shadow); `longFloor` `generate.ts:5392` (authoring) |
| proposal generator | Up `adaptive-ramp.ts:644`. Shadow `evaluateLongRun` `long-run.ts:110`. Down: the undifferentiated `shave` `adapt.ts:4832` |
| progression threshold | `LONG_RUN_COMPLETION_MIN_FRAC = 0.95` over `LONG_RUN_LOOKBACK_COUNT = 2` `contract-constants.ts:186/:187`; step `<= 1.0 mi` `:190`; spike ceiling `1.10 x` prior-30-day max `long-run.ts:73`; `LONG_RUN_MIN_WEEKS_TO_SERVE_BUILD = 3` `:108`. Ramp `MAX_LONG_BUMP_MI = 1.0` `adaptive-ramp.ts:633` |
| regression threshold | Both of the last 2 long runs below 95% `long-run.ts:289`, floored at `before - 1.0 mi` `:351-357`, plus the 17% shave |
| arbitration owner | Shadow only, rank 2 `arbitration.ts:187` |
| interaction | `coherentWithWeeklyVolume` `:88`, `collidesWithRaceOrTaper` `:92`, `weeksRemainingInBuild` `:90` |
| future-plan-mutation owner | `applyAdaptations` `adapt.ts:1869` / `:1840` |
| authority gate | Up dead at `adaptive-ramp.ts:1031` |
| persistence | `coach_intents`; `canonical_adaptation_shadow_log` |
| runner-facing explanation | `adaptation-info.ts:141`; authoring `whyLongRun` `lib/plan/strategy-contracts.ts:591` |
| phone serialization | Status only `v5-block.ts:165`, `:529`. Change explanation **MISSING** |
| watch serialization | Day type and planned mi `build-workout.ts:799-800`; long-run day name `:882-884`. A named long-run-distance field is **MISSING** |
| tests | UP: 1 production-reachable file, and it tests the cap rather than the landing |
| production reachability | `ADAPTATION-VERDICT.md:242`: `LONG_RUN / L4-durability-readable` blocked **26 of 40**. Three months of belief trail moved the long run `12.0 -> 12.1 mi` (`:52`). **And the one production evaluation, 2026-09-03, returned `REFUSE`: "There are only 1 recent long runs to read, and the contract asks for 2"** · on the owner's live marathon block |
| **status** | **up sealed · down live via a card nobody can see · canonical shadow** |

---

### 4 · Long-run structure

| Column | Owner |
|---|---|
| evidence inputs | **MISSING.** `resolveMarathonSpecificLadder` `lib/plan/marathon-specific-ladder.ts:338` is a pure function of the block calendar. Its own header `:63-70`: "it does not read the database, and it knows nothing about what the runner has recently run" |
| evidence exclusions | N/A, nothing is read |
| belief/state owner | **MISSING.** `:163-168`: "With adaptation disabled there is no execution to consult, so 'earned' is answered from what the BLOCK ITSELF has already authored." The taxonomy exists (`LongRunKind` `lib/plan/long-run-rows.ts:82`); no belief does |
| proposal generator | **MISSING.** No `AdaptationAction` kind touches it `adapt.ts:287` |
| progression threshold | Authoring only: `MP_EARNED_STEP_MI = 4` `:170`, `MP_FAST_FINISH_MAX_MI = 6` `:92`, `MP_LADDER_FIRST_DAYS = 84` `:155`, `MP_SHARPEN_WINDOW_DAYS = [10,17]` `:152` |
| regression threshold | **MISSING.** The nearest thing is `DESIGNEDWEEKEND-1`, explicitly a `note` that changes nothing, `adapt.ts:4891-4895` |
| arbitration owner | **MISSING** |
| interaction | `MP_LONG_COUNTS_AS_QUALITY_MI = 6` `:178`, consumed `generate.ts:5815` / `:5895` |
| future-plan-mutation owner | **MISSING** |
| authority gate | N/A |
| persistence | **MISSING.** No `coach_intents` reason, no canonical lever |
| runner-facing explanation | Authoring narrative only, `lib/plan/v5-block.ts:551-554` |
| phone serialization | Prescription only `app/api/v5/today/route.ts:2056-2061`. **`longRunKind` is on no wire at all** · zero hits across `web-v2/app`, `lib/watch` and all of `native-v2` |
| watch serialization | `phases[].isFinishSegment` `build-workout.ts:2101` (the prescription, not a change) |
| tests | Adaptation: 0 up, 0 down. Rule 15 hazard: `lib/plan/history-shapes.ts:99-100` sets `maxCompletedMpMi: null` corpus-wide, so MP evidence is UNKNOWN for every fixture |
| production reachability | Not reachable as an adaptation |
| **status** | **missing** |

---

### 5 · Marathon-pace dose

Same owner and same verdict as lever 4. Role bands `MP_ROLE_DOSE_MI`
`marathon-specific-ladder.ts:203-220`; cadence `MP_LADDER_MIN_GAP_WEEKS = 2` /
`MAX = 3` `:79-80`. It is the only lever in this matrix whose "has he earned it"
test is answered from what the plan already wrote rather than from anything the
runner did. Evidence inputs, belief, proposal generator, both thresholds,
arbitration, mutation owner, persistence and both change-explanation channels:
**MISSING**.

**status: live at authoring · missing as a lever**

---

### 6 · Threshold pace

| Column | Owner |
|---|---|
| evidence inputs | `resolveThresholdPaceCorpus` -> `loadThresholdCorpusInputs` `lib/training/pace-corpus.ts:2007-2054`; bands `:406-464`. Shadow `GradedSession[]` `canonical/levers/threshold-pace.ts:106-115` |
| evidence exclusions | Prescription side is **weighted, not filtered** (`pace-corpus.ts:1955-1961` says so). Canonical side excludes via `canonical/admissibility.ts` |
| belief/state owner | **TWO, and they disagreed by 42 s/mi in production on 2026-09-03.** (a) `resolveThresholdCapacity` `lib/training/capacity-resolver.ts:1543`. (b) `authored_state.t_pace_s_per_mi` read at `canonical-shadow/live-input.ts:690`. `:673-679` concedes they agree only "until the day this engine's own proposals start being accepted somewhere" |
| proposal generator | Shadow `evaluateThresholdPace` `threshold-pace.ts:117`. Sealed `recompute_paces` `adapt.ts:4910/4936/4963`. **Live** `reanchorActivePlan` `lib/plan/reanchor-plan.ts:466` |
| progression threshold | Canonical: 2 qualifying sessions in 28 d, step 3 s/mi, max 5, 2:1 majority `contract-constants.ts:67/84/94/95/107/131`. Live `training_lead`: `TRAINING_LEAD_DELTA_THRESHOLD = 1.0` VDOT `adapt.ts:3646` with `MIN_SESSIONS = 2` `:3669`, `MIN_SPAN_DAYS = 14` `:3670`, `MAX_AGE_DAYS = 28` `:3681`. Self-heal `SELF_HEAL_REANCHOR_DELTA = 2.0` `lib/training/pace-anchor.ts:67`, applied `reanchor-plan.ts:197`, plus `REANCHOR_ANCHOR_DELTA_S_PER_MI = 3` `:145` |
| regression threshold | Canonical: **the same bar**, stated at `threshold-pace.ts:23-33`. Live `REGRESSION_DELTA_THRESHOLD = 1.5` `adapt.ts:3398/3408`; the 1.0-up-versus-1.5-down asymmetry is argued from doctrine at `adapt.ts:3638-3644`. Self-heal symmetric at 2.0 |
| arbitration owner | Shadow only `arbitration.ts:443`; `THRESHOLD_PACE` is last of three `:187`, so a volume HOLD suppresses it. It did, on four boundaries in `docs/reports/core-closure-2026-09-04/COUNTERFACTUAL.md` World A |
| interaction | `MAX_MATERIAL_LEVERS_PER_CYCLE = 1` `contract-constants.ts:333` |
| future-plan-mutation owner | `recomputePacesForPlan` `lib/plan/recompute-paces.ts:232` (sealed) and `reanchorActivePlan` `reanchor-plan.ts:466`, `UPDATE plan_workouts SET pace_target_s_per_mi` at `:856` (**live**) |
| authority gate | `recompute_paces` is not proposable `adaptation-authority.ts:109`. `reanchorActivePlan` is exempted by name `adaptation-authority.ts:66-73` |
| persistence | `plan_workouts.pace_target_s_per_mi` + `workout_spec`; `training_plans.authored_state.pace_recompute` and `.pace_zone_event`; `canonical_adaptation_shadow_log` |
| runner-facing explanation | `app/api/v5/paces/route.ts:145`, `:261-263` · per-zone before and after, coach line, evidence list, modelled marks. **The best runner-facing explanation in the product** |
| phone serialization | `paceNote` `app/api/v5/today/route.ts:127-152`, assigned `:2238` -> `ViewsV5/TodayBeforeV5.swift:637` -> `PacesHostV5` `ViewsV5/HostsV5.swift:2674` -> `ViewsV5/PacesMovedV5.swift`. **Live, and acknowledged in production at 2026-09-03T06:54** |
| watch serialization | Value only `build-workout.ts:85`. Change explanation only via `sessionMoved` |
| tests | `canonical/_lever_contracts.test.ts`, `_symmetry.test.ts`, `_magnitude_bounds.test.ts`; `lib/training/_capacity_resolver.test.ts` |
| production reachability | **It fired.** 2026-09-02, VDOT 46.3 -> 47.7, faster, training-sourced, 76 workouts rewritten, 12 rationales, rendered and acknowledged. Separately: `plan_adapt_recompute_paces` is 0 rows ever (the sealed path), and the canonical shadow returned `REFUSE` on 2026-09-03 for want of a qualifying session |
| **status** | **live (via `reanchorActivePlan`, outside the seam) · shadow (canonical) · sealed (legacy)** |

---

### 7 · Threshold dose

| Column | Owner |
|---|---|
| evidence inputs | `AdaptationVerdict` from `classifyAdaptation` `lib/adaptation/adaptation-model.ts:685`, read `adapt.ts:3977`; prior shape `plan_workouts.workout_spec.progression` `lib/plan/progression-spec.ts:48-49` |
| evidence exclusions | `runnerIsCompromisedFailClosed` `adapt.ts:3974` (now only gap re-entry); `PRIOR_LOOKBACK_DAYS = 21` `lib/plan/progression-pass.ts:400`. **No explicit Rule 8 taper filter** |
| belief/state owner | `plan_workouts.workout_spec.progression` |
| proposal generator | `resolveWeekProgression` `progression-pass.ts:207` -> `resolveProgressionStep` `lib/plan/progression-gate.ts:89` -> `reshape` `adapt.ts:5030` |
| progression threshold | `ACCELERATE` needs `band === 'strong'` `progression-gate.ts:109-137`, which needs weighted mean `>= 0.75` **AND** `MIN_WEEKS_FOR_STRONG = 3` **AND** `strongMinShare = 0.6` · `adaptation-model.ts:306/:321/:361`, combined at `:744` |
| regression threshold | `HOLD` at mean `< -0.25`, `BACK_OFF` at `< -1.1` cutting 20% · `adaptation-model.ts:308-310`, `progression-gate.ts:79/:143-162`. **The upward bar carries two AND-conditions the downward bar does not** (`adaptation-model.ts:744`). That is Rule 21's "the bar to go up may not be higher than the bar to come down", in one line |
| arbitration owner | **MISSING.** Nothing arbitrates a reshape against a pace or a volume move |
| interaction | Documented `progression-pass.ts:60-66`, enforced only by the UPDATE's column list `:895-903` |
| future-plan-mutation owner | `applyProgressionReshape` `progression-pass.ts:794`, UPDATE `:895` |
| authority gate | **Fails it twice.** `reshape` is not proposable `adaptation-authority.ts:109`; and the proposal payload has no field for a `WorkShape` `workout-proposals.ts:33-36` |
| persistence | `coach_intents` `plan_adapt_sealed`, `value.sealed_kind = 'reshape'` `adaptation-authority.ts:174-204` |
| runner-facing explanation | Composed `progression-pass.ts:391`, `progression-gate.ts:128/135/151/160`, and unreachable: the note carries `noteField: null` `adaptation-authority.ts:172` |
| phone serialization | **MISSING** |
| watch serialization | **MISSING** |
| tests | Census `lib/audit/_verdict_coverage.test.ts:44-49`: `ACCELERATE 8 · BACK_OFF 3`, `TAKE 4 · HOLD 22` |
| production reachability | `plan_adapt_progression`: **0 rows, ever.** `plan_adapt_sealed`: 0 rows, so the gate has not even recorded a refusal |
| **status** | **sealed** |

---

### 8 · Interval pace

| Column | Owner |
|---|---|
| evidence inputs | **MISSING, and the code says so on every estimate it returns.** `composeHighIntensityCapacity` `lib/training/capacity-resolver.ts:1797-1804`: "1 · direct · NOT BUILT. `NO_DIRECT_HIGH_INTENSITY_READER` is on every estimate this function returns." The only input is `VdotFallbackRead` `:1767-1770` |
| evidence exclusions | Inherited from the VDOT chain only |
| belief/state owner | `resolveHighIntensityCapacity` `capacity-resolver.ts:1901`; R-pace null below the table `:1846` |
| proposal generator | **MISSING** |
| progression threshold | **MISSING** |
| regression threshold | **MISSING** |
| arbitration owner | **MISSING** |
| interaction | The old goal-based I-pace gate was deleted `recompute-paces.ts:428-444`, `reanchor-plan.ts:288-295` |
| future-plan-mutation owner | `recomputePacesForPlan` `:232`; `refreshedPaceAndSpec` `reanchor-plan.ts:277`, watched at 3 s/mi `:145/:167-169` |
| authority gate | As lever 6 |
| persistence | `plan_workouts.pace_target_s_per_mi`; anchor stamp |
| runner-facing explanation | `V5Paces` shows the zone move `app/api/v5/paces/route.ts:136-140` and marks it modelled. Nothing states that no interval evidence was read; live confidence on the owner's account is 0.29 `recompute-paces.ts:441-443` |
| phone serialization | `SpecCard` step `pace_target` `lib/training/prescriptions.ts:184` |
| watch serialization | `targetPaceSPerMi` `build-workout.ts:85`, `:588` |
| tests | `lib/training/_capacity_resolver.test.ts` |
| production reachability | The number exists for every runner. **No interval session the runner runs can move it** |
| **status** | **missing as a belief · live only as a derivation of the threshold anchor** |

---

### 9 · Interval dose

Same owner and same seal as lever 7. Authoring caps `INTERVAL_REP_MINUTES {3,5}`
`lib/prescription/levers.ts:198`, `INTERVAL_MIN_REPS = 3` `:228`,
`REPETITION_REP_METRES {200,600}` `:244`, `INTERVAL_RECOVERY_MIN_FRACTION = 0.5`
`:314`; weekly share caps `AT_PACE_WEEKLY_SHARE_CAP {threshold 0.10, interval
0.08, repetition 0.05}` `:143`.

**The pace lever is unreachable at authoring by construction:** `selectLever`
`levers.ts:437-450` requires `band === 'strong'` and authoring always passes
`normal` (`lib/prescription/trajectory.ts:108`).

**The missing owner is built, named and orphaned.**
`web-v2/lib/plan/adjudication/dose-responsive.ts` is the evaluator that can
resize "distance, quality dose, repetitions, rep duration and recovery length",
and it has no caller. Registry entry and open decision at
`lib/audit/generated-content-registry.ts:383-384`.

**status: live at authoring · sealed as an adaptation · evaluator orphaned**

---

### 10 · Easy and recovery work

| Column | Owner |
|---|---|
| evidence inputs | `easyDayMedianMi` `generate.ts:2523-2570`; `resolveEasyPaceCorpus` `pace-corpus.ts:1969`, lookback 90 d `:712` |
| evidence exclusions | Rule 8 applied and named in line `generate.ts:2547`, with the defect history at `:2528-2542`; canonical row `:2554`; easy pace corpus **filtered** `pace-corpus.ts:1985` |
| belief/state owner | `easyMileFloor` `generate.ts:11272`, persisted `:11813`; pace `resolveEasyCeiling` `capacity-resolver.ts:2002` |
| proposal generator | Up `MAX_PER_EASY_BUMP_MI = 1.0` `adaptive-ramp.ts:635`. Down the 17% shave and the gap shave `GAP_SHAVE_FRACTIONS = [0.30, 0.15]` `adapt.ts:700` |
| progression threshold | +1.0 mi per easy day behind all six ramp gates |
| regression threshold | 25% over baseline fires, 17% comes off `adapt.ts:1128`, `:4863` |
| arbitration owner | **MISSING** at the day level |
| interaction | **Rule 12's defect is still present in shape.** Easy is sized from the remainder after the long run and quality: `perEasyRaw = floor((remainingMi / easyCount) * 2) / 2` `generate.ts:7955`, with a floor applied afterwards `:7992-7995` rather than the order being reversed. `recoveryDayAfterLongMi` `lib/plan/plan-templates.ts:284`, used `generate.ts:8356` |
| future-plan-mutation owner | `applyAdaptations` `adapt.ts:1840` / `:1868` |
| authority gate | Up refused `adaptive-ramp.ts:1031`; down proposable. **The only easy-work change the runner can act on is the one that removes work** |
| persistence | `plan_workouts.distance_mi`; `coach_intents` |
| runner-facing explanation | `coach_log_easy_discipline` `lib/coach/coach-log.ts:144` · an observation about execution, not a lever change |
| phone serialization | Observation only, `V5LogEntry` on the races screen `app/api/v5/races/route.ts:583-584` |
| watch serialization | `sessionMoved.wasLine` when the distance moved |
| tests | `lib/plan/_coach_sensible.test.ts`, deliberately red while Rule 12 is open |
| production reachability | Down reachable, up unreachable |
| **status** | **up sealed · down live via a card nobody can see** |

---

### 11 · Workout frequency (quality sessions per week)

| Column | Owner |
|---|---|
| evidence inputs | `recentQualityPerWeek` `generate.ts:2260` |
| evidence exclusions | **Rule 8 applied, and this reader is the reason the rule exists.** `eligibleDaysBack(todayISO, 28, spans)` `generate.ts:2295`, defect documented `:2273-2283`; canonical row `:2303`; refuses rather than returning 0 `:2296` |
| belief/state owner | `generate.ts:2260` (habit), `densityForWeek` `generate.ts:10712` (prescription). Authoring only |
| proposal generator | **DOWNWARD ONLY, AND SHADOW-ONLY.** `detectReduce` `lib/adaptation/adaptation-engine.ts:1838`, magnitude `quality_sessions_per_week` `:342`, step `Math.max(0, qualityPerWeek - 1)` `:1856` |
| progression threshold | **MISSING.** `densityForWeek` ramps habit toward the runner's stated preference over 4 weeks at authoring `generate.ts:10717-10726` and never exceeds it |
| regression threshold | `adaptation-engine.ts:1846-1848`: fires on `STATE_ARGUES_REDUCE` or `absorption.band === 'poor'`. Minus one session |
| arbitration owner | `composeAdaptation` `adaptation-engine.ts:2001`. But its only production reach is `runAndPersistPaceShadowCompare` `lib/adaptation/shadow-compare.ts:751`, which is **PACE-only** (`shadow-compare.ts:2-5`), **so the density verdict is computed and discarded every night** |
| interaction | `AdaptationProposal` is a discriminated union on a singular `target` `adaptation-engine.ts:386-393`: one stressor at a time is a property of the type |
| future-plan-mutation owner | **MISSING for an increase.** Decrease writes via `downgrade` `adapt.ts:1817` |
| authority gate | `downgrade` always proposes `adapt.ts:1317` |
| persistence | `plan_adapt_downgrade` only |
| runner-facing explanation | `adaptation-info.ts` kind `'downgrade'` |
| phone serialization | Status only `v5-block.ts:530`, `:161`, `:511` |
| watch serialization | **MISSING.** `WatchWeekStripDay` carries `type` only |
| tests | **UP 0 / DOWN 1** |
| production reachability | **The only lever whose sole implementation can arithmetically only subtract.** Its own header says so, `adaptation-engine.ts:1832-1838` |
| **status** | **down: shadow, computed and discarded · up: missing** |

---

### 12 · Recovery spacing

| Column | Owner |
|---|---|
| evidence inputs | Authoring `spacedQualityDowsFromAvailable` `generate.ts:249`, `gapRank` `:284`; validation `requiredSeparationDays` `lib/plan/validate.ts:467` |
| evidence exclusions | N/A, read off the authored calendar |
| belief/state owner | **MISSING.** Nothing holds a belief about how much separation THIS runner needs |
| proposal generator | **MISSING** |
| progression threshold | **MISSING** |
| regression threshold | **MISSING as a lever.** It appears only as a veto on going up: `PULLBACK_BUMP_LOOKBACK_HOURS = 48` `adaptive-ramp.ts:921`, `pullbackBlocksBump` `:961`, fed by `PULLBACK_INTENT_REASONS = ['plan_adapt_downgrade','plan_adapt_shave']` `:950` |
| arbitration owner | **MISSING** |
| interaction | `HARD_SESSION_SPACING_H = 48` `lib/plan/adjudication/weekly-demand.ts:443` prices crowding; reaches production only through `canonical/demand-ceiling.ts:88`, i.e. shadow |
| future-plan-mutation owner | **MISSING** |
| authority gate | N/A |
| persistence | **MISSING** |
| runner-facing explanation | **MISSING.** `requiredSeparationDays` never leaves the generator: zero hits under `app/api` or `native-v2` |
| phone serialization | Countdown only `lib/coach/recovery-brief.ts:102-108` -> `Models/RecoveryBrief.swift:219`. Not a spacing policy |
| watch serialization | **MISSING** |
| tests | UP 0 / DOWN 2, both encoding spacing as a veto on going up |
| production reachability | The 48 h veto is live. **Nothing implements the direction where good spacing unlocks anything** |
| **status** | **missing as a lever · live as a suppressor** |

---

### 13 · Race targets

| Column | Owner |
|---|---|
| evidence inputs | `composeRaceOutlook` `lib/race/race-outlook.ts:512` · canonical threshold capacity `:75`, durability exponent `:76`, forward gain `:84`, race HR evidence `:368`, stated goal `:349-351` |
| evidence exclusions | Canonical row `race-outlook.ts:68`, applied `:373`. Rule 8: **only the staleness half** · `:74` imports `REPRESENTATIVE_STALENESS_HALF_LIFE_DAYS` and nothing else; the taper exclusion enters indirectly via `capacity-resolver.ts:246`. **Race-recency MISSING in the outlook itself** |
| belief/state owner | `race-outlook.ts:512`, one owner, gated by `lib/race/_race_target_ownership.test.ts:37-43`. Rule 16's three-projection defect is closed |
| proposal generator | Ceiling `achievableRaceTarget` `lib/training/achievable-target.ts:199`; execution adapter `lib/race/effective-race-target.ts:107`; display `lib/training/race-projection.ts:53` |
| progression threshold | `trainingLeadFires` `adapt.ts:3699` at `+1.0` VDOT with 2 sessions over 14 d; race-sourced `adapt.ts:3099/:3128` at `+1.5`; self-heal `abs(delta) >= 2.0` `reanchor-plan.ts:197`. Runway ceiling `min(MAX_BLOCK_GAIN_VDOT, buildWeeks x VDOT_GAIN_PER_WEEK_MAX)` `achievable-target.ts:107` |
| regression threshold | `fitnessRegressionFires` `adapt.ts:3408` at `-1.5`; self-heal symmetric at 2.0. The 1.0-vs-1.5 asymmetry is argued from the doctrine table at `adapt.ts:3640-3644` |
| arbitration owner | `detectAdaptations` exclusivity `adapt.ts:1424`, `:1440`; band arbitration `max(goal, prescriptionFloorSec(ceiling, 0.05))` `achievable-target.ts:235-237` |
| interaction | Taper subtracted from build weeks `achievable-target.ts:106`; regression suppressed inside 7 d pre-race `adapt.ts:3443` |
| future-plan-mutation owner | `refreshRaceRowsForPlan` `lib/race/race-row-refresh.ts:500`, called from `generate.ts:17187`, `recompute-paces.ts:570`, and `app/api/cron/snapshot-projections/route.ts:168`; pace rewrite `reanchor-plan.ts:856` |
| authority gate | **Split, and the split is the finding.** `recompute_paces` is sealed to a note. `reanchorActivePlan` + `refreshRaceRowsForPlan` run nightly OUTSIDE the seam by explicit exemption `adaptation-authority.ts:66-73`, so race targets DO move automatically |
| persistence | `plan_workouts.pace_target_s_per_mi` + `workout_spec.race_execution` / `race_hr` `race-row-refresh.ts:172`; `authored_state.prescribed_race_pace` marked `authority: 'provenance_only'` `generate.ts:12093-12095` |
| runner-facing explanation | `projectionCoachLine` `lib/training/race-projection.ts:84`, called `app/api/v5/race/[slug]/route.ts:383` |
| phone serialization | `app/api/v5/race/[slug]/route.ts:447`, `:466`; list `app/api/v5/races/route.ts:414`, `:419` -> `DesignV5/APIV5.swift:1310-1311`, `:1287-1300` -> `ViewsV5/RaceDetailV5.swift:287`, `:295`, `:452-484` |
| watch serialization | PARTIAL and mislabelled. Only `goalSec = eff.targetSec` `build-workout.ts:2389` -> `:2565`, drawn as "Goal" `WatchRouterV5.swift:1763`. `projectedSec`, `basis` and `likelyRangeSec` never reach the watch |
| tests | `lib/training/_target_continuity.test.ts` (Rule 9 walk, falsified); `lib/plan/_race_pace_ceiling.test.ts:82-140`; `lib/race/_race_target_ownership.test.ts:45-60`, which states its own blind spots |
| production reachability | **LIVE** through `snapshot-projections` at 07:30 UTC. Dead through `adapt.ts` |
| **status** | **live (outlook plus nightly reprice) · sealed (every `adapt.ts` re-anchor trigger)** |

---

### 14 · Taper

| Column | Owner |
|---|---|
| evidence inputs | **Distance and block length only. No runner evidence at all.** `taperFactor` `lib/plan/goal-tiers.ts:599`; `TAPER_RACE_WEEK_PCT_OF_PEAK` `:405-411`; `TAPER_DESCENT_SHAPE` `:394`; lengths `BLOCK_SHAPE[cat].taperWeeks` `generate.ts:2894-2903` and the pinned twin `TAPER_WEEKS_BY_DISTANCE` `lib/training/fitness-trajectory.ts:103-109`. The only runner-derived input is the realized peak `nonTaperPeakR` `generate.ts:14383` |
| evidence exclusions | N/A. The taper is instead an INPUT to Rule 8 `lib/training/normal-window.ts:218`, `:227-229` |
| belief/state owner | **MISSING.** There is no taper belief. `plan_weeks.phase_id = 'TAPER'` `generate.ts:13820` is the whole state |
| proposal generator | Budget `generate.ts:3914`; realized enforcement `:14391-14392`; restore floor `:14478-14479`; validator `lib/plan/validate.ts:877` |
| progression threshold | **MISSING.** The only upward motion is the over-taper restore floor `generate.ts:14479` (`doctrineTarget / 1.12`), a doctrine-band correction, not an evidence response |
| regression threshold | `target = min(tw.weeklyMi, nonTaperPeakR * factor, priorTaper)` `generate.ts:14392`. `priorTaper` makes the descent one-way `:14506` |
| arbitration owner | `generate.ts:14384-14507` inside `finalizeComposedPlan` |
| interaction | Race target `achievable-target.ts:106`; Rule 8 `normal-window.ts:218`; adapt suppression `adapt.ts:1481`, `:3443`, `:3218`; goal gap `lib/plan/goal-gap.ts:386` |
| future-plan-mutation owner | `generate.ts:13820` only, at full authoring. **Nothing rewrites an existing taper** |
| authority gate | Indirect: `fireAutoRebuild` `lib/plan/auto-rebuild.ts:141`. Ceiling check `validate.ts:877-878` |
| persistence | `plan_weeks.phase_id`, `plan_phases.label` |
| runner-facing explanation | `app/api/v5/race/[slug]/route.ts:281-312` (`taperProgress`, `taperEndpoints`, `taperCentreLabel`) |
| phone serialization | `app/api/v5/race/[slug]/route.ts:459` -> `DesignV5/APIV5.swift:1233-1235`, `:2234-2236` -> `ViewsV5/RaceDetailV5.swift:115-116`, `:713-727`. Phase arc `lib/plan/v5-block.ts:203-206` -> `ViewsV5/BlockV5.swift:301-307`. **No `isTaper` boolean and no `taperWeeks` number ever crosses** |
| watch serialization | **MISSING.** No taper field in `build-workout.ts` and none in `WatchWorkoutModels.swift` |
| tests | `lib/plan/_r3_lowvol_taper.test.ts`; doctrine `lib/doctrine/registry.ts:2211-2245`, `:11920-11949` |
| production reachability | LIVE at authoring only. A taper is fixed the moment the block is written |
| **status** | **live at authoring · missing as an adaptation lever, on every column** |

---

### 15 · Post-race recovery

| Column | Owner |
|---|---|
| evidence inputs | Distance plus declared priority only. `POST_RACE_RECOVERY_WEEKS` `lib/plan/goal-tiers.ts:112-118`; `RECOVERY_EFFORT_SCALE` `:283-285`; depth `:147-153`; run days `:163-169`. Runner input: `peakAnchor` `generate.ts:12988` |
| evidence exclusions | Recovery is an INPUT to Rule 8, not a consumer: `normal-window.ts:154`, `:219` |
| belief/state owner | `training_plans.mode = 'recovery'`, decided by `pickPlanMode` `goal-tiers.ts:699`, `:713-717` and `openBlockMode` `lib/plan/race-lifecycle.ts:165-181` |
| proposal generator | `composeRecoveryPlan` `generate.ts:12916`, dispatch `:16789-16791` |
| progression threshold | **MISSING.** `recoveryEffortScale` `goal-tiers.ts:292-295` shortens by DECLARED priority, never by evidence. The exit is calendar-only: `recoveryCompleteDue` `race-lifecycle.ts:86-94` returns `lastWorkoutISO <= todayISO` |
| regression threshold | **MISSING.** No readiness, HRV, RHR or execution signal extends the window anywhere in `web-v2/lib` |
| arbitration owner | `app/api/cron/plan-drift/route.ts:737`, `:745`, `:781-786`, `:788-796` |
| interaction | Rule 8 window `normal-window.ts:219`; ramp `recoveryBlockCeilingPct` `goal-tiers.ts:271` -> `generate.ts:9921-9923`, `:14259` |
| future-plan-mutation owner | `fireAutoRebuild('recovery_complete')` `plan-drift/route.ts:788-796`; post-race entry `lib/race/result-chain.ts:160`, `:317-332` |
| authority gate | Explicitly OUTSIDE the seal `adaptation-authority.ts:58-65` |
| persistence | `training_plans.mode`, `plan_weeks.phase_id`, `plan_proposals.proposal_kind = 'recovery_complete'` |
| runner-facing explanation | `app/api/today/purpose/route.ts:363-381`. The "what block comes next" answer exists and is **ORPHANED**: `lib/plan/block-preview.ts` plus `app/api/race/[slug]/block-preview/route.ts`, both dead per `generated-content-registry.ts:452-453` and `:589-590` |
| phone serialization | **Broken at the DTO.** The server sends `postRace` `app/api/today/purpose/route.ts:371-376`; `RunPurpose`'s CodingKeys `Models/CoachPayloads.swift:54-57` omit it, so `slug`/`name`/`date`/`daysSince` are dropped and the window is re-derived client-side `Components/RecoveryWindowStrip.swift:88-140` · in the v4 shell |
| watch serialization | **MISSING.** `WatchDayState.kind` only ever emits `'rest'` `build-workout.ts:874` or `'no_session'` `:945` |
| tests | `lib/plan/_recovery_doctrine.test.ts`, `race-lifecycle.test.ts:43-48`, `_plan_drift_lifecycle.test.ts:226-287` |
| production reachability | LIVE. `plan-drift` at 04:00 and 09:00 UTC. One `recovery_complete` auto-applied 2026-08-31 |
| **status** | **live (authoring plus lifecycle exit) · missing as an adaptation lever · preview orphaned · watch missing** |

---

### 16 · Scheduling

| Column | Owner |
|---|---|
| evidence inputs | Runner-initiated: `recommendReschedule` `lib/plan/reschedule.ts:1983`; plan shape `:182`; races `:858`; seal `:184`; constraint `:363`. Automatic: `chooseRescheduleDate` `adapt.ts:593` |
| evidence exclusions | Race proximity at DAY grain `reschedule.ts:1162`, `:1256`, `:1278`; sealed days `:1425`; taper and A-race weeks `:1440-1452`. Rule 8 not applicable (placement, not habit) |
| belief/state owner | `RescheduleDecision` `reschedule.ts:606`, `origin: 'RUNNER_CONSTRAINT'`, `evidenceEffect: 'NONE'` as a literal type `:303-309` |
| proposal generator | `reschedule.ts:1983`, candidate weights `:257-279` |
| progression threshold | Not a progression lever. Search window `:213-218` (long 3, quality 2, easy 6 days) |
| regression threshold | Discrete refusals only, `:1417`, `:1424`, `:1425`, `:1428`, `:1431`, `:1440`, `:1447`, `:1463`, `:2061` |
| arbitration owner | `:2068` (zero-deficit `clean` pool) and `:2156-2161` (compromises only when clean is empty) |
| interaction | **Structurally severed.** `reschedule.ts:23-27` and `_reschedule_not_adaptation.test.ts` walk the import graph and fail on any edge to `adapt.ts`, `adaptive-ramp.ts`, `progression-pass.ts`, `auto-rebuild.ts`, `recompute-paces.ts` |
| future-plan-mutation owner | `applyReschedule` `:2423` and `undoReschedule` `:2677`, both through `mutatePlan` |
| authority gate | Proposal token `:2373`; post-completion refusal `:2401` |
| persistence | `plan_reschedules`, DDL `db/migrations/163_plan_reschedules.sql:74-113`, applied to production 2026-09-03 |
| runner-facing explanation | `:1420`, `:1426`, `:1429`, `:1432`, `:1443`, `:1450`; tradeoff copy `:2166-2185` |
| phone serialization | `app/api/plan/reschedule/route.ts:81/:117/:142` -> `ViewsV5/RescheduleV5.swift:251/:278/:290`, mounted `ViewsV5/BlockV5.swift:417-419`. **Live in the shipped V5 shell** |
| watch serialization | `sessionMoved.kind: 'reschedule'` `build-workout.ts:1308` -> `FacesLobbyV5.swift:275-279` |
| tests | `_reschedule_contract.test.ts` (881 lines), `_reschedule_not_adaptation.test.ts`, `_move_never_deletes.test.ts`; fixture `_reschedule_fixture.ts`, verbatim production rows |
| production reachability | **YES for the runner-initiated path.** Note `163:71-72`: as of 2026-09-03 no reschedule row exists yet. The automatic path emits `kind:'reschedule'` `adapt.ts:4669` into a propose lane no shipped surface reads |
| **status** | **live (runner-initiated) · orphaned (engine-initiated)** |

Five separate code paths can move a session: `reschedule.ts` (RS-1),
`POST /api/today/reschedule`, `POST /api/plan/change` `move_day`,
`PATCH /api/plan/workout`, and `adapt.ts:593`. Named by the module itself at
`reschedule.ts:77-93`.

---

### 17 · Missed training

| Column | Owner |
|---|---|
| evidence inputs | `detectMissedKeyWorkout` `adapt.ts:2669`; candidates `:2684-2696`; completion `getCanonicalRunIds` `:2705`; stimulus contradiction `:2723`; skips from `day_actions` `:2785-2796` |
| evidence exclusions | Canonical row `:2705`. **Rule 8 correctly not applied to the miss detector** (it asks what happened, not what is normal). But see the re-ramp gap in the pathologies |
| belief/state owner | `partitionMissedCandidates` `:2535` · skipped / long / stale / rescheduable |
| proposal generator | `adapt.ts:4460-4708` |
| progression threshold | Completion bar `completionThresholdMi` `:474`, plus a contradiction gate `:2761-2777`: a run the interpreter calls EASY cannot complete a quality prescription |
| regression threshold | Staleness `isStaleMissed` `:485` · more than 3 days past. One reschedule per pass, the rest dropped `:2810-2814`. Missed long runs are never rescheduled `:2560-2562` |
| arbitration owner | Suppressed entirely while a gap is active or handled within 7 days `:1387-1393`, `hasRecentGapIntent` `:1590` |
| interaction | Anti-stacking downgrade paired via `onlyIfRescheduledId` `:4700-4706`, enforced `:1742-1745`. A skip is respected, never rescheduled `:2556-2559` |
| future-plan-mutation owner | `adapt.ts:1698-1739` and `:1740+`, through `applyAdaptations` |
| authority gate | `reschedule` and `downgrade` both land in the propose lane `adaptation-authority.ts:252` |
| persistence | `MISSED_HANDLED_REASONS` `adapt.ts:2598-2603`; durable dedup on the authored date `:2654`; `day_actions` `db/migrations/114_day_actions.sql:21-27` |
| runner-facing explanation | Composed at `:2589`, `:4484`, `:4493`, `:4612`, `:4664`, `:4673`, `:4705` |
| phone serialization | **MISSING.** The notes carry a workout id so they join `adaptation-info.ts:161`, but every consumer gates on `wasAdapted` `:188`, which is false for a note. Proposals reach only the v4 shell |
| watch serialization | **MISSING**, same `wasAdapted` gate at `build-workout.ts:1284` |
| tests | `_graded_miss.test.ts`, `_skip_respected.test.ts`, `_missed_dedup_durable.test.ts`, `_adapt_invariants.test.ts:433-457` |
| production reachability | **Detection yes, response no.** `plan_adapt_missed_noted` 20 rows and `plan_adapt_drop_missed` 15 rows in production, the most recent 2026-09-03, so the detector is working daily. The reschedule and downgrade go to a card nobody reads |
| **status** | **live (record-only, invisible) · orphaned (the response)** |

---

### 18 · Illness

| Column | Owner |
|---|---|
| evidence inputs | `readIllness` `lib/safety/load-safety.ts:121-145`; runner writes `app/api/sick/route.ts:87` / `:135` |
| evidence exclusions | Not applicable, a point read of an open episode |
| belief/state owner | `classifySafety` `lib/safety/safety-verdict.ts:331`, the single declared owner `:113-116`, gated by `_safety_ownership.test.ts` |
| proposal generator | **MISSING.** `adapt.ts:1395-1398`: there is no illness detector "and there is no place for one" |
| progression threshold | `cleared_at IS NULL` only. The bar to return to full training is the runner tapping clear `app/api/sick/route.ts:135`. No time-based or evidence-based return |
| regression threshold | Any uncleared episode is `STOP` `safety-verdict.ts:351-354`; `hasFever` only changes the reason string |
| arbitration owner | `safety-verdict.ts:346-359`, precedence injury > illness > niggle > clear; unreadable-signal logic `:373-387` |
| interaction | **One-way and indirect.** `runnerIsCompromised` no longer returns illness; `adapt.ts:1522-1529` states the consequence outright: a field test may be proposed and a progression step taken during a logged illness. The only path illness reaches the plan is that the runner stops running and `detectTrainingGap` `:2865` reads the days off |
| future-plan-mutation owner | **MISSING.** `generate.ts` contains zero references to `sick_episodes`; `adapt.ts` imports no safety module |
| authority gate | `mayEmitRunnableWorkout` `safety-verdict.ts:438`; the UNKNOWN branch carries no `state` field `:270-283`, so a caller cannot read it as safe |
| persistence | `sick_episodes` |
| runner-facing explanation | `safety-verdict.ts` copy plus `ViewsV5/SickV5.swift` |
| phone serialization | `app/api/v5/today/route.ts:572-590` -> `DesignV5/APIV5.swift:2103` -> `ViewsV5/SickV5.swift`, `TodayBeforeV5.swift:218`. **Live** |
| watch serialization | State only `build-workout.ts:1633`. The explaining `dayState.coachLine` is decoded `WatchWorkoutModels.swift:922` and **never drawn** |
| tests | `_safety_verdict.test.ts`, `_safety_ownership.test.ts`, `_readiness_trigger_removal_scan.test.ts` |
| production reachability | **YES as a same-day gate.** It cannot change any future day |
| **status** | **live as a same-day gate · missing as an adaptation lever** |

---

### 19 · Pain and injury

Four sub-systems, four different states.

**(a) Niggle and injury as a same-day gate · live.** `readInjury`
`load-safety.ts:85-119`, `readNiggle` `:147-172`; `stateFromInjury`
`safety-verdict.ts:309-316`; minor -> `MODIFY`, moderate and major -> `STOP`
`:313-315`; `NIGGLE_CAUTION_SEVERITY = 5` `:228`, which `:218-227` declares
**not research-cited**. An unrecognised severity string reads as `major`
`load-safety.ts:103-106`, which is the safe direction. Future-plan mutation:
**MISSING**. Niggle is reachable from the phone `ViewsV5/HostsV5.swift:1979`;
**injury is not** · no file under `native-v2` calls `/api/injuries`, and the only
creator is `web-v2/components/faff-app/toolkit/sheets.tsx:381-391` on the paused
web frontend.

**(b) Injury plan mode · sealed.** `buildInjuryPlan` `lib/plan/injury-builder.ts:408-415`
returns a refusal as its first statement, `void input;` at `:409`; the real body
survives as unreachable `buildInjuryPlanBody` `:420`. Registered at
`generated-content-registry.ts:407-408`; gate `_injury_mode_sealed.test.ts`.
Kept alive only because four live `INJURY.*` doctrine claims read its constants
(`lib/doctrine/registry.ts:12557`, `:12603`, `:15490`, `:15582`).

**(c) Return-to-running ladder · live, runner-driven, practically unreachable.**
`computeReturnLadderState` `lib/plan/return-ladder.ts:83`;
`MIN_SESSIONS_PER_STAGE = 2` `:37`, `MIN_DAYS_BETWEEN_ADVANCES = 7` `:44`;
regression is `something_off` repeating the stage `:20-22`. Routes
`app/api/v5/return/route.ts:45`; phone `ViewsV5/ReturnToRunningV5.swift` mounted
`HostsV5.swift:2362`. It writes no `plan_workouts` row, and it is reachable only
with an active `runner_injuries` row (`return-checkin-store.ts:33-44`), which the
phone cannot create.

**(d) Injury as a demand price · shadow.** `INJURY_UPLIFT_BY_SEVERITY`
`lib/plan/adjudication/weekly-demand.ts:487-491`, all labelled
`POLICY_ASSUMPTION` `:475-486`. Reachable only through
`canonical-shadow/demand-input.ts:11` -> `live-input.ts:89`, and `live-input.ts`
has no non-test importer.

**status: live (niggle gate) · sealed (plan mode) · live-but-unreachable (ladder) · shadow (demand price) · missing (future-plan mutation)**

---

### 20 · Environmental adjustment

There is no environmental adjustment lever. Four doctrine-modelled readings
exist and **none can change a prescription or write `plan_workouts`.**

| Column | Owner |
|---|---|
| evidence inputs | Weather `app/api/cron/enrich-weather/route.ts:43` -> `lib/weather/openmeteo.ts:801`; grid cache `:662-685`; grade `lib/terrain/run-terrain.ts:88-123`; treadmill `:76-78`; belt incline `:137`; altitude `lib/race/representativeness-inputs.ts:161-167`. **Dewpoint is never stored, only estimated** `lib/training/heat-model.ts:234` |
| evidence exclusions | `HEAT_CONFOUND_TEMP_F = 77` `lib/coach/easy-discipline.ts:386`; terrain confound `:399-405`; race recency +/- 14 d `:407-412`; decoupling heat artifact `lib/adaptation/load.ts:344-353`; treadmill pace bar `canonical/admissibility.ts:77-87` |
| belief/state owner | Heat safety `lib/coach/heat-gate.ts:273`; heat pace cost `heat-model.ts:327`; heat HR `lib/weather/heat-adjustment.ts:132`; terrain `lib/terrain/grade-adjust.ts:478` |
| proposal generator | Heat `heat-gate.ts:273-379`, whose only production consumer is informational `lib/coach/heat-acclimatization.ts:329-334`. Treadmill `build-workout.ts:2018-2070`, the only live environmental prescription mutation, and it writes a wire payload not a plan row. Altitude **MISSING** (`registry.ts:7676-7680`, exemption `altitude-trigger-unimplemented`) |
| progression threshold | Heat returns to `normal` at WBGT `<= 64 F` `heat-gate.ts:107-108`. **No environmental progression mechanism exists**: `heat-acclimatization.ts:345` computes a `pacingAdjustPct` no prescription reads |
| regression threshold | `WBGT_FLAGS` five rungs `heat-gate.ts:107-113`; `WBGT_BAIL_F = 86` `:131`; `AQI_BAIL = 200` `:135`. Race authority `lib/race/representativeness.ts:283-286` |
| arbitration owner | Internal to `heat-gate.ts:256-262`. `canonical/arbitration.ts` has **no environmental participation** |
| interaction | `composeEffortFactor` `grade-adjust.ts:363-372` combines heat and grade, **but the heat leg is hard-zeroed at its only judging call site**: `lib/coach/run-recap.ts:400-403` passes `heatSlowdownPct: 0` |
| future-plan-mutation owner | **MISSING.** `adapt.ts:4817-4831` (`heat_bail`) returns a record-only note and the trigger is deprecated `adapt.ts:218-222` |
| authority gate | `authorityScaledVdot` `representativeness.ts:1268-1277`, consumed `adapt.ts:3106-3128`. **This is the one real environmental effect on the training model: a discount on a race result** |
| persistence | `runs.data.weather`; `workout_weather_cache`; watch heat easing `coach_intents` (51 production rows, all 2026-08-25/26) |
| runner-facing explanation | `heat-adjustment.ts:168`; `heat-gate.ts:325-351`; HEAT DRIFT chip `lib/coach/heat-band.ts:57`; `grade-adjust.ts:576-580` |
| phone serialization | Terrain `lib/coach/run-state.ts:1368-1372` -> `Models/Runs.swift:389/406/462` -> `RunAnalysisV5.swift:661-675`. Treadmill card `lib/faff/v5-today.ts:1508-1521` -> `TodayAfterV5.swift:1444`. **Pre-run conditions MISSING**; `weather_context` is not decoded anywhere in `native-v2` |
| watch serialization | Belt targets `build-workout.ts:2071-2075`. `heatNote` is decoded `WatchWorkoutModels.swift:547` but **always null, because `heat` is hardcoded null at `build-workout.ts:2160-2169`** |
| tests | `_heat_trigger.test.ts`, `_heat_doctrine.test.ts:128-191`, `grade-adjust.test.ts:205-248`. `run-terrain.ts` has **no dedicated test** |
| production reachability | Terrain judging YES; belt prescription YES; heat to any plan change NO; heat to target easing NO; altitude NO |
| **status** | **terrain live · treadmill live · heat gate held · `heat_bail` sealed · `lib/watch/heat.ts` sealed and orphaned · altitude missing** |

---

### 21 · Cross-training

Every adaptation column is **MISSING**. The table has exactly one non-test
reader, its own CRUD route `app/api/cross-training/route.ts:26-34`, `:58-64`.
Nothing reads `cross_training_sessions` into any coaching decision; ACWR is
running-only `lib/coach/acwr.ts:57`. `_no_strength_rows.test.ts:72` forbids
`'cross'` in any `INSERT INTO plan_workouts`. Phone serialization MISSING;
registered uncalled at `generated-content-registry.ts:602-603`. HealthKit maps
`crossTraining` at `HealthKitImporter.swift:1767` and posts it to `/api/strength`
`:1806`, so the two paths are disjoint.

**Live comment promising an invariant nothing enforces:**
`app/api/cross-training/route.ts:4-6` · "The coach reads recent rows to credit
cross-training toward fitness preservation during INJURY mode." Nothing reads
the table, and injury mode is sealed.

**status: orphaned (a write-only sink)**

---

### 22 · Strength work

| Column | Owner |
|---|---|
| evidence inputs | `lib/coach/strength-recommender.ts:530-543`, `:468-472`; load `lib/coach/strength-load.ts:89-121`; ingest `app/api/strength/route.ts:130-150` from `HealthKitImporter.swift:1791-1817` |
| evidence exclusions | **MISSING and a live Rule 14 hazard.** `strength-recommender.ts:536-543` scopes on `tp.archived_iso IS NULL` rather than a named plan, and is not listed in `lib/audit/active-plan-exemptions.ts`. Contrast `lib/coach/training-state.ts:263` and `lib/plan/week-loader.ts:211`, which do exclude |
| belief/state owner | `strength-recommender.ts:464-506`; weekly verdict `lib/coach/strength-status.ts:61-97` |
| proposal generator | `strength-recommender.ts:238-390` |
| progression threshold | `:301`, `DEFAULT_STRENGTH_DAYS_PER_WEEK = 2` `:151`; phase caps `:424-444`, the maintenance rung documented **inert** at `:429-435`; habit up-bar `:505` |
| regression threshold | `ACWR_HIGH_SPIKE_THRESHOLD = 1.5` `:153` -> cap 1 `:300`; race week 0 `:265-272`; taper 1 `:438`; dormant at 21 days `:497` |
| arbitration owner | `:301`, `:315`, `:320-321`. No shared arbitration with the running levers |
| interaction | **One-directional and severed.** Strength reads running ACWR; running load does not read strength `lib/coach/glance-state.ts:605-612`, rationale `strength-load.ts:4-56` |
| future-plan-mutation owner | **MISSING, gated shut.** `generate.ts:13807-13809`; gate `_no_strength_rows.test.ts:72`, `:42` |
| authority gate | Ingest only. The recommender has no gate because it has no caller |
| persistence | `strength_sessions`. **No `rpe` column**, so `sessionRpeAu` `strength-load.ts:74-75` returns null for every input production can supply |
| runner-facing explanation | `strength-recommender.ts:901-970`. None of it reaches a runner |
| phone serialization | Ingest only. Server-to-phone **MISSING**: decode models removed `API.swift:2679-2682`, wire keys removed `glance-state.ts:211-212` |
| watch serialization | `FacesLobbyV5.swift:523` still decodes `"strength"`; `build-workout.ts:1657-1667` orders it at 1, above `'rest'` at 0, with no exclusion |
| tests | `lib/coach/_strength_doctrine.test.ts`, whose header `:24-28` states the module is unwired |
| production reachability | Ingest **YES** (87 `strength_skip` and 41 `strength_resume` rows in production, through 2026-08-09). Recommender **NO** |
| **status** | **sealed surface · orphaned engine · live ingest** |

---

### 23 · Goal changes

| Column | Owner |
|---|---|
| evidence inputs | `detectGoalChanged` `adapt.ts:2956-2997` reads `users.vdot_manual_override_at` and `profile.updated_at` only `:2962-2964`. **It never reads the race goal.** Goal gap reads `races.plan.goal.finish_time_s` `lib/plan/goal-gap.ts:175` |
| evidence exclusions | None on the trigger. Freshness guard on the snapshot series `plan-drift/route.ts:1212` |
| belief/state owner | **THREE STORES, TWO OF THEM FOR THE SAME QUANTITY:** `races.plan.goal.finish_time_s`, `races.meta.goalDisplay`, `profile.tt_goal_*` |
| proposal generator | `writeGoalOutlookNote` `lib/plan/goal-outlook.ts:180`, informational only per `lib/plan/goal-immutability.ts:69` |
| progression threshold | `adapt.ts:2980-2981`, direction-agnostic: an override or a profile edit within 24 h, newer than `authored_iso` |
| regression threshold | `OUTLOOK_SUSTAINED_DAYS = 5` `goal-outlook.ts:58`; unclosable `ceiling = maxClosableInRemainingTime x 1.5` `goal-gap.ts:456`, fires `:530`. **Writes a note, never a renegotiation** |
| arbitration owner | `RUNNER_INITIATED_GOAL_SOURCES` `goal-immutability.ts:56`, enforced `app/api/race/[slug]/route.ts:335-343` |
| interaction | The goal is echoed and never used as capacity `race-outlook.ts:61-64`; bounded `achievable-target.ts:237`; volume sealed by `_goal_volume_seal.test.ts` |
| future-plan-mutation owner | `fireAutoRebuild('goal_time_changed')` `app/api/race/route.ts:382-390` |
| authority gate | `scripts/check-goal-immutability.sh` in prebuild plus `_goal_immutability.test.ts` eight guards. **It guards the wrong route · see the pathologies** |
| persistence | `races.meta.goalDisplay` `app/api/race/route.ts:311/316/352`; `races.plan.goal.finish_time_s` `app/api/race/[slug]/route.ts:367/373`; audit `coach_intents.reason = 'goal_edited_by_runner'` `:387` |
| runner-facing explanation | `lib/plan/goal-outlook-copy.ts` via `lib/coach/decision-cards.ts:231`; the `take` / `hold` accept actions were removed `app/api/v5/goal-answer/route.ts:31-39` |
| phone serialization | Write `Components/RaceEditSheet.swift:263-269` -> `API.swift:1047` -> `PATCH /api/race`. Card `DesignV5/APIV5.swift:1961-1966` -> `ViewsV5/HostsV5.swift:2178-2192` |
| watch serialization | **MISSING** |
| tests | `_goal_immutability.test.ts` (falsified both directions), `_goal_volume_seal.test.ts:44-60`, `_midrace_goal.test.ts:20-27` |
| production reachability | Runner-initiated path LIVE (4 `goal_time_changed` auto-applied, 31 expired). `detectGoalChanged`'s `recompute_paces` is sealed to a note |
| **status** | **live (runner-initiated re-author) · sealed (cron response) · the immutability gate guards a dead route** |

---

## 4 · The ten worst gaps, ranked by distance from the runner

Ranked by how far the failure sits from the person it is supposed to serve. A
gap at rank 1 costs him something today; a gap at rank 10 costs him a mechanism
he does not yet know he is missing.

**1 · The proposal card has no screen.** Every plan-mutating action the seal
allows becomes a `plan_workout_proposals` row
(`app/api/cron/run-adaptations/route.ts:337`). The only Swift caller of
`GET /api/plan/workout-proposals` is `Views/TodayView.swift:3323`, reachable only
under `-faffLegacy` (`FaffApp.swift:533-534`). **Seven rows in the life of the
product, zero accepted, zero dismissed, and one dated 2026-08-25 still `pending`
eleven days after the read path was supposed to expire it.** The whole downward
lane terminates in a screen that does not exist.

**2 · No lever change is explained on the phone.** `originalType` and
`originalSubLabel` are loaded per request at `app/api/v5/today/route.ts:755-756`,
declared at `lib/faff/v5-today.ts:946-947`, read by no composer branch, and
absent from every Swift `CodingKeys`. **The wrist knows why a session changed
(`build-workout.ts:1274-1310`) and the phone does not.** That is backwards from
every product doc in the repo.

**3 · The one upward lever that works is invisible to the engine's own ledger.**
`reanchorActivePlan` moved the owner's anchor 46.3 -> 47.7 VDOT on 2026-09-02,
rewrote 76 workouts, and he acknowledged it on his phone. It wrote **no
`coach_intents` row and no `adaptation_log` entry**. Rule 21's census therefore
reads zero, the live plan's `adaptation_log` is `[]`, and the acknowledged event
was discarded by the 2026-09-03 rebuild (`pace_zone_event` is NULL on the live
plan). **Nobody auditing this engine can tell that it pushed.**

**4 · The engine asked to push, out loud, four days running, and nothing
listened.** `adaptation_shadow_log` carries `PROGRESS`, `agrees_with_live=false`,
435 -> 430 s/mi, on 2026-08-31, 09-01, 09-02 and 09-03, with
`live_training_lead_fired = false` every time. Then a block rebuild reset the
evidence and the verdict became `INSUFFICIENT_EVIDENCE`.

**5 · The seal is direction-asymmetric and nothing says so.**
`PROPOSABLE_KINDS` `adaptation-authority.ts:108-109` contains only load-reducing
or session-spending kinds. `reshape`, `mark_upgrade`, `recompute_paces` and
`mark_dirty` become notes with `noteField: null` `:172`, which
`adaptation-info.ts:161` cannot join. **A downward adaptation has a runner-gated
path to landing; an upward one has none, gated or ungated.** The seam's own
header presents itself as direction-neutral.

**6 · The propose lane structurally cannot carry most levers.**
`plan_workout_proposals.action_payload` holds `newType`, `newDate`,
`shaveFraction` and nothing else `workout-proposals.ts:33-36`. **Opening the seam
tomorrow would still leave threshold dose, interval dose, MP dose, long-run
structure and any distance bump with nowhere to live.** This is the gap that
makes "just flip the switch" a false remedy.

**7 · Interval pace has no evidence reader at all, and the code says so.**
`capacity-resolver.ts:1797-1804`: "1 · direct · NOT BUILT.
`NO_DIRECT_HIGH_INTENSITY_READER` is on every estimate this function returns."
The owner's live confidence on that anchor is 0.29 `recompute-paces.ts:441-443`.
**No interval session he ever runs can move his interval pace.** The `V5Paces`
screen renders the zone move and marks it modelled; it never says the evidence
does not exist.

**8 · Quality density can only ever be subtracted.** `detectReduce`
`adaptation-engine.ts:1838` is the sole implementation, its step is
`Math.max(0, qualityPerWeek - 1)` `:1856`, there is no upward counterpart
anywhere, and its verdict never reaches production because its only reach is
`shadow-compare.ts:751`, which is pace-only. Grep across the tree: zero upward
density code, zero upward density tests.

**9 · The canonical engine covers 3 of 23 levers and stopped emitting two days
ago.** `CanonicalLever` `lib/adaptation/canonical/input.ts:84` is
`THRESHOLD_PACE | WEEKLY_VOLUME | LONG_RUN`. Its production log has **three rows
total**, all from 2026-09-03, all against a plan archived twenty-one minutes
later, and none since, while the sibling shadow pass in the same cron loop writes
daily. Its deferral queue table does not exist in production
(`to_regclass('public.canonical_adaptation_deferrals')` returns NULL), so every
`reconsiderAtISO` it writes is a promise nothing keeps.

**10 · Twenty-two prebuild gates, and not one can see any of the nine above.**
`web-v2/package.json:8` runs 22 checks covering palette, spacing, voice,
doctrine, wire keys, mutations, swallowed reads, normal-window, goal
immutability, anchor derivation and the client graph. **None asks whether a
written proposal has a renderer, whether a migration in `db/migrations` is
applied to production, whether an adaptation reason has a runner-facing reader,
or whether any upward lever has ever fired for a real runner.** Rule 20's own
shape, at the level of the gate set.

---

## 5 · Every pathology found, by class

### First-line `return null` or equivalent early refusal

- `lib/plan/adaptive-ramp.ts:1031` · `tryAdaptiveBump`'s first statement, before
  any read. Rule 21's entire volume axis.
- `lib/plan/injury-builder.ts:408-415` · `buildInjuryPlan` returns
  `{ok:false, ...}` as its first statement, `void input;` at `:409`.
- `lib/plan/adapt.ts:932` · `buildReRampActions` returns `[]` unless the gap band
  is exactly `shave_70_85`.
- `lib/coach/strength-load.ts:74-75` · `sessionRpeAu` returns null for every
  input production can supply, because `strength_sessions` has no `rpe` column.
- `lib/plan/reanchor-plan.ts:391` · `if (st.pace_authoring?.source ===
  'canonical') return null;` with a comment two lines above `:388-391` claiming
  it is "reported as a deferral rather than a bare null so a caller can tell 'no
  work needed' from 'no plan' (Rule 11)". It returns the identical value the "no
  plan" branch returns at `:384`.
- `lib/coach/strength-recommender.ts:265-272`, `:1038`, `:1081`.

### Permanent seal

- `lib/plan/adaptation-authority.ts:96` · typed `false`, not `boolean`, so the
  open branch at `:231-233` is type-narrowed away.
- `lib/watch/build-workout.ts:2160-2169` · `const heat = null`, described as
  "permanently off", **no exit criteria**. It is why `heatNote`
  (`WatchWorkoutModels.swift:547`) and `WatchFueling.heatAdjusted` are always
  null, and why `build-workout.ts:2703-2708`'s claim that `heatAdjusted` was
  fixed is false sixty lines below the seal.
- `lib/plan/adapt.ts:4818-4822` · the deprecated `heat_bail` case.
- `lib/plan/_no_strength_rows.test.ts:72` with an empty exemption list at `:42`.

### One-way ratchet

- `lib/plan/adapt.ts:1868-1872` · `UPDATE plan_workouts SET distance_mi = $1
  WHERE id = $2 AND distance_mi < $1`, declared at `:292-295` as "a SQL guard
  ensuring distance never decreases".
- `users.max_hr` is monotone up and never falls: `adapt.ts:2366`,
  `reanchor-plan.ts:788`, `recompute-paces.ts:376`. It sets `race_hr` on the race
  row.
- `generate.ts:14392` / `:14506` · `priorTaper` means a taper week may never be
  higher than the one before it, in either direction of correction.
- `lib/adaptation/volume-evidence/belief.ts:167-176` · the `raise` helper returns
  `from` whenever the candidate is not larger; `applyCapacityLoss` `:227` lowers
  three fields and **excludes `peakWeeklyMi` by construction** `:248`. Argued at
  `contract.ts:507-524` as the directory's one deliberate asymmetry, and it
  favours the runner. This is the only ratchet in the list that is arguably right.
- `lib/plan/adapt.ts:712-724` `gapAlreadyHandled` combined with
  `adaptation-authority.ts:248-250`: the `plan_adapt_gap` marker is a `note`, so
  it **applies** and suppresses re-detection `adapt.ts:2923`, while the comeback
  shaves go to a card nobody reads. **The comeback protocol is offered once per
  gap and then silently never again.**

### Suppressor with no upward counterpart

- `lib/plan/adapt.ts:4863` · `volume_overshoot` shaves 17% at a `> 1.25 x`
  trigger `:1128`, with no ACWR gate, no execution precondition and no cooldown.
  Its notional opposite `tryAdaptiveBump` is sealed AND carries six preconditions
  the shave does not.
- `lib/adaptation/adaptation-engine.ts:1838` · the only quality-density mover in
  the tree, and `:1856` can only subtract.
- `lib/coach/heat-gate.ts:256-262` · a five-rung downgrade ladder with nothing
  above `normal`; `heat-acclimatization.ts:345` computes an adjustment no
  prescription reads.
- `lib/plan/adaptive-ramp.ts:961` `pullbackBlocksBump` · a pull-back blocks a
  bump for 48 h. There is no symmetric rule by which a bump blocks a pull-back.
- `lib/adaptation/canonical/levers/weekly-volume.ts:583` · the REGRESS branch
  fires off completions alone and does not require `included` to be non-empty,
  while PROGRESS requires supporting key sessions `:705`, no short long runs
  `:727` and no repeated deterioration `:739`. `COUNTERFACTUAL.md:79` records
  this firing live: **an APPLIED WEEKLY_VOLUME REGRESS with "0 admitted, 32
  excluded, confidence 0 supporting".**
- `lib/adaptation/adaptation-model.ts:744` · `strong` requires the mean AND two
  extra gates; `marginal` and `poor` require the mean alone. **The bar to go up
  carries two AND-conditions the bar to come down does not.**
- `lib/coach/strength-recommender.ts:300` · ACWR above 1.5 caps at 1; nothing
  raises above the default 2 on a low ACWR.

### Upward mechanism with no regression counterpart

- `lib/plan/adapt.ts:1861-1882` · `mark_upgrade` can only raise distance and the
  SQL guard forbids the inverse on the same axis.
- `lib/plan/goal-tiers.ts:292-295` · `recoveryEffortScale` only ever SHORTENS
  post-race recovery (A 1.0 -> B 0.65 -> C 0.35). Nothing lengthens it, on any
  signal.
- `lib/coach/heat-acclimatization.ts:228` · dose accrual and `daysToFullAcclim`
  with **no de-acclimatization decay**.
- `lib/adaptation/volume-evidence/respond.ts:222` · the whole directory raises
  and never lowers, deferring the downward question to `adapt.ts` and
  `weekly-volume.ts`. Since the directory is orphaned and those two are live, the
  net effect is that only the downward twin is wired.

### Boolean cliff

Confirmed still live:

- `lib/plan/adaptive-ramp.ts:497` · `peakHeadroomMi > tierWeeklyUpperMi x 0.05`.
- `lib/plan/adapt.ts:1128` · `completedMi > baseline x 1.25`: nothing, or a 17%
  cut, on a tenth of a mile.
- `lib/adaptation/canonical/levers/weekly-volume.ts:775-776` · PROGRESS becomes
  HOLD at exactly `nextWeekPrescribedMi >= before x 1.05`.
- `lib/adaptation/canonical/contract-constants.ts:151` -
  `VOLUME_WEEK_COMPLETION_MIN_FRAC = 0.95`, against a measured real-runner best of
  **0.9023** (`ADAPTATION-VERDICT.md:246`) and a near-miss of 90.2%.
- `lib/plan/marathon-specific-ladder.ts:178` · `MP_LONG_COUNTS_AS_QUALITY_MI = 6`:
  5.9 MP miles buys a second midweek quality day, 6.0 does not.
- `lib/plan/reschedule.ts:245-246` · a 17.9 mi long needs 1 recovery day, an
  18.0 mi long needs 2, which flips a candidate between the `clean` pool `:2068`
  and `compromises`, shown only when clean is empty `:2156`. **This directly
  contradicts the module's own header at `:130-136`**, which promises no
  candidate is accepted or rejected by comparing a continuous quantity against a
  threshold.
- `lib/plan/adapt.ts:690-696` `classifyGapBand` · 3 / 4 / 7 / 8 / 14 / 15 days
  off select nothing, one easy day, a two-week 70/85 shave plus a whole re-ramp,
  a rebuild proposal.
- `lib/plan/adapt.ts:474-477` · 59.9% of a prescription is a miss, 60.1% is
  complete.
- `lib/plan/adapt.ts:485-487` · more than 3 days makes a miss stale.
- `lib/plan/adapt.ts:954` · `RERAMP_MIN_BASE_SIGNAL_MI = 2`.
- `lib/plan/goal-gap.ts:527`, `:530` · `gap > ceiling` flips the whole status to
  `unclosable` on a continuous margin.
- `lib/plan/race-lifecycle.ts:176` · `if (weeks <= 0) return 'maintenance'`, so a
  5K can never route to a recovery block because
  `POST_RACE_RECOVERY_WEEKS['5k'] = 0` `goal-tiers.ts:113`.
- `lib/plan/generate.ts:14422-14424` · `holds` flips between two different taper
  scaling formulas.
- `lib/safety/safety-verdict.ts:228` / `:355` · `NIGGLE_CAUTION_SEVERITY = 5`,
  self-declared as uncited.
- Six separate step thresholds on the same heat quantity -
  `lib/coach/heat-band.ts:56`, `lib/coach/weather-adjust.ts:161`,
  `lib/weather/heat-adjustment.ts:134` and `:156`, `lib/coach/run-state.ts:1103`,
  `lib/training/fueling.ts:79-81` · inside a model whose own header
  `heat-model.ts:7-13` says every axis is interpolated to avoid exactly this.

**Two cliffs named in the brief are FIXED, and CLAUDE.md is stale about both.**
`achievable-target.ts:185-189` / `:235-237` now uses `prescriptionFloorSec` plus
`max`, gated by `lib/training/_target_continuity.test.ts`. The taper restore
moved from `generate.ts:9896` to `:14478-14480`, gated by
`_restore_continuity.test.ts`. **No `88.2` or `87.9` exists anywhere under
`web-v2/lib`.** CLAUDE.md's Rule 9 table should be updated: it cites two line
numbers and two values that no longer exist.

Mitigated for contrast, and worth copying:
`lib/adaptation/canonical/levers/shared.ts:44` `meetsCompletionBar` subtracts
`COMPLETION_FRACTION_EPSILON` precisely because a bare `>=` is a cliff.

### Two owners for one quantity (Rule 16)

- **Threshold pace, LIVE AND DISAGREEING IN PRODUCTION.** On 2026-09-03 the
  canonical shadow log recorded `THRESHOLD_PACE before_value 394` (from
  `authored_state.t_pace_s_per_mi`, `canonical-shadow/live-input.ts:690`) while
  `adaptation_shadow_log` recorded `engine_previous 436` (from the priced
  `plan_workouts` rows) for the same runner on the same day. **42 s/mi apart.**
  `live-input.ts:673-679` concedes the two agree only "until the day this
  engine's own proposals start being accepted somewhere".
- **Weekly mileage, four owners with four different step sizes:** `adapt.ts:4863`
  (17% shave), `adaptive-ramp.ts:644` (+5 mi), `weekly-volume.ts:182` (+/- 5%),
  `volume-evidence/respond.ts:222` (+5%).
- **Long-run distance, three:** `adaptive-ramp.ts:633`, `long-run.ts:110`,
  `generate.ts:5392`.
- **Hard-day separation, three, in three different units:**
  `lib/plan/validate.ts:467` (days, enforced),
  `lib/plan/adjudication/weekly-demand.ts:443` (hours, priced),
  `generate.ts:284` (rank, scheduled).
- **Demonstrated peak weekly:** `load-progression-contract.ts:230` vs
  `volume-evidence/belief.ts:150`. The second exists specifically to feed the
  first `belief.ts:267`, and nothing wires them.
- **The stated goal.** `PATCH /api/race` `app/api/race/route.ts:308-316` · the
  route the phone actually calls · writes ONLY `meta.goalDisplay`, and
  `POST /api/race:119` inserts `plan` as `'{}'::jsonb`. So for any race added on
  the phone, `races.plan.goal.finish_time_s` is never set. `race-outlook.ts:349-351`
  reads meta first and is fine; `goal-gap.ts:175`, `adapt.ts:2483`,
  `lib/coach/voice-band.ts:567` and `canonical-shadow/live-input.ts:567-568` read
  `plan.goal` ONLY. `goal-gap.ts:179-181` then returns null, so **`computeGoalGap`
  refuses and the `goal_outlook` note can never fire for those runners.**
- **"Days around a race that are not normal":** `lib/coach/easy-discipline.ts:974-978`
  vs `lib/training/normal-window.ts:218-219`. Documented and exempted at
  `lib/audit/normal-window-registry.ts:487-504`; the 5K under-exclusion is real
  and unfixed, exactly as CLAUDE.md predicts.
- **"Is this a treadmill run":** `lib/terrain/run-terrain.ts:76-78`,
  `canonical-shadow/live-input.ts:331-332`, `app/api/v5/today/route.ts:1003`.
- **"Heat HR bump":** `lib/weather/heat-adjustment.ts:100-114` documents that the
  uncited one-bpm-per-degree formula was removed and replaced by `heatHrBumpBpm`
  `:132`. **That exact removed formula is still executing at
  `lib/coach/run-state.ts:1102`**, on the branch its own comment `:1097-1099`
  calls the one that carries this in production.
- **`loadPendingProposals` is declared twice for two different tables:**
  `lib/coach/proposals-state.ts:29` and `lib/plan/workout-proposals.ts:155`.
- **The adaptation "was X" sentence** is composed independently in three places
  from one `AdaptationInfo`: `build-workout.ts:1291-1300`,
  `components/faff-app/adapt-text.ts:56`, `lib/adaptation-harness/observe.ts:102`.
- **The prescribed race target** was a three-way split and is now closed to
  `race-outlook.execution`, gated by `lib/race/_race_target_ownership.test.ts:8-43`.
  That one is fixed and worth noting as the model.

### A comment promising an invariant nothing enforces (Rule 20)

- `lib/plan/load-progression-contract.ts:54` · "demonstratedLoadAfterEachWeek ·
  recomputed from completed weeks, which is what moves every number above."
  **Nothing recomputes it.** `resolveLoadProgressionContract` has exactly one
  production caller, `generate.ts:11633`, at authoring.
  `volume-evidence/belief.ts:13` names this defect and was written to close it,
  and is itself orphaned.
- `lib/plan/adaptive-ramp.ts:14-15` · the header's pipeline diagram names
  `buildBumpAction(userId, opp, activePlan)` returning
  `AdaptationAction['kind' = 'bump_distance']`. **Neither symbol exists anywhere
  in the tree.**
- `lib/plan/adapt.ts:583` · "respects weekly_frequency", while `generate.ts:2338`
  records that column NULL for 8 of 16 production profiles.
- `lib/plan/adapt.ts:1894-1899` · "COMPLETION FOLLOW-UP (not built here)" on the
  field test. It IS partly built now (`app/api/watch/workouts/complete/route.ts:1098-1130`
  captures LTHR), but **only LTHR** · the proposal's own runner-facing reason says
  "Pace anchors are going stale" and nothing derives a pace anchor from the test.
  The comment is stale and the gap it describes is half-real.
- `app/api/cross-training/route.ts:4-6` · "The coach reads recent rows to credit
  cross-training toward fitness preservation during INJURY mode." Nothing reads
  the table; injury mode is sealed.
- `components/faff-app/toolkit/sheets.tsx:377-379` · "so the adaptation engine
  flips into INJURY mode and the walk-run scaffold can fire". `detectInjuryActive`
  is deleted and `buildInjuryPlan` refuses.
- `app/api/injuries/route.ts:9` · cites `lib/plan/adapt.ts.detectInjuryActive()`,
  which no longer exists.
- `db/migrations/163_plan_reschedules.sql:14-20` · justifies itself against
  `plan_mutations` as "the adaptation seam's record". **`plan_mutations` has zero
  writers and zero readers in `web-v2`** (verified in production: 4 rows, all
  `positive-drift`, none since 2026-05-25).
- `.github/workflows/run-adaptations.yml:11-13` · "Reactive triggers
  (missed_key_workout, niggle, sick, injury, pr_bank, goal_changed,
  volume_overshoot) still apply immediately". Three of those detectors are
  deleted and nothing applies immediately under the seal.
- `db/migrations/114_day_actions.sql:11` · "A skip does NOT cascade". Four
  consecutive skips reach `classifyGapBand`, which is exactly a cascade;
  `adapt.ts:2526-2529` acknowledges it.
- `lib/watch/build-workout.ts:2703-2708` · claims `WatchFueling.heatAdjusted` was
  fixed; `heat` is null sixty lines above.
- `lib/watch/heat.ts:22-26` · justifies having no bail threshold by pointing at
  `detectHeatBail`, deleted 2026-08-27.
- `lib/coach/strength-recommender.ts:993-994` and `lib/coach/strength-status.ts:16-22`
  · both name callers and downstream effects that do not exist.
- `app/api/race/[slug]/route.ts:431` returns `rebuildTriggered: true`
  unconditionally, including when `fireAutoRebuild` threw and was swallowed at
  `:416-418`.
- `lib/faff/v5-today.ts:979` documents `weatherKicker` as `"55F, light rain, no
  wind" · pre-run only`; `app/api/v5/today/route.ts:2165` assigns a **duration**.
  One name, two quantities.
- `WatchSync.swift:142-144` instructs a future editor to change `WatchReadiness`
  and `/api/watch/readiness` together. **`web-v2/app/api/watch/` has no
  `readiness/` route.**
- `native-v2/Faff/Faff/ViewsV5/RunDetailV5.swift:68-70` says the decoder lacks
  `terrain_label`; `Models/Runs.swift:462` decodes it.

### A module with no caller

The registry is the map, and it is bigger than the brief said: **75 registered
orphan modules** (`lib/audit/generated-content-registry.ts:382-581`), 41 authored
columns (`:97-372`), 12 uncalled routes (`:588-610`). The coaching-relevant ones:

- `lib/adaptation/volume-evidence/{contract,classify,admit,belief,respond,explain}.ts`
  · registry `:389-401`. The whole path from "he ran more" to "future mileage
  rises".
- `lib/plan/adjudication/dose-responsive.ts` · registry `:383-384`. The evaluator
  half of an `EarningGate` that nothing evaluates, and the missing owner for
  threshold dose, interval dose and MP dose.
- `lib/plan/block-preview.ts` and `app/api/race/[slug]/block-preview/route.ts` -
  registry `:452-453`, `:589-590`. "INSTANCE 3, STILL OPEN." The only "what block
  comes after recovery" answer in the app.
- `lib/plan/injury-builder.ts` · registry `:407`.
- `lib/coach/strength-recommender.ts` `:489`, `strength-status.ts` `:491`,
  `strength-load.ts` `:571`.
- `app/api/cross-training/route.ts` `:602`.
- `lib/watch/heat.ts` · `loadHeatEasing:398`, `loadHeatEasingPct:377`.
- `app/api/coach/read/route.ts:98-132` · **emits the richest lever-level
  adaptation payload in the app and has zero callers**, asserted in the repo at
  `lib/audit/_ui_computes_nothing.test.ts:79`.
- `app/api/race/[slug]/route.ts` PATCH · no Swift caller, and it is the ONLY
  route `GOAL_MUTATION_ROUTES` `lib/plan/goal-immutability.ts:43-46` guards for
  the race goal. **The immutability gate protects a dead route while the live one
  is ungated.**

**The orphan gate has a hole.** `lib/plan/adjudication/weekly-demand.ts` is not
registered, because it has an importer
(`canonical-shadow/demand-input.ts:11`) whose own importer
(`canonical-shadow/live-input.ts:89`) has no non-test importer anywhere. **A
module reachable only through a chain of unreachable modules passes the
no-caller check.**

### A caller whose output nothing consumes

- `app/api/v5/today/route.ts:755-756` -> `lib/faff/v5-today.ts:946-947`. A
  LATERAL join per request, threaded into a context type, read by no branch and
  absent from every Swift key.
- Every sealed judgment: `toObservationalNote` sets `noteField: null`
  `adaptation-authority.ts:172`, and `adaptation-info.ts:161` joins on
  `ci.field = pw.id`.
- `lib/plan/adaptive-ramp.ts:883` -> `:564` -> `:644`. The whole detection chain
  runs only from `tryAdaptiveBump:1046`, unreachable past `:1031`.
  `detectGreenRampOpportunity` has no other caller in the tree.
- `lib/plan/adaptive-ramp.ts:841` `ceilingCanNeverBind` · its only consumer is a
  `console.warn` at `:445-452`.
- `lib/adaptation/canonical/contract-constants.ts:85`
  `THRESHOLD_EVIDENCE_WINDOW_DAYS_TIGHT` · its own doc comment says "Nothing
  reads it yet".
- `composeAdaptation` `adaptation-engine.ts:2001` produces `VOLUME`, `DURATION`,
  `DENSITY`, `RECOVERY`, `SPECIFICITY` and `SCHEDULE` proposals; its only
  production reach is `shadow-compare.ts:751`, which is PACE-only, **so five of
  the eight lever verdicts are computed and dropped every night.**
- `app/api/cron/run-adaptations/route.ts:303-319` · the session-moved push
  snapshots either side of `applyAdaptations(uid, applyNow)`. Under the seal that
  lane is note-only and notes `continue` before `touched++`
  `adapt.ts:1678-1688`, so before always equals after and `renderSessionMoved`
  `lib/notifications/templates.ts:471` **can never fire**.
- `adapt.ts:2160-2164` · `last_adapted_at` is stamped on every pass including a
  no-op, and it is half the phone's cache key `app/api/v5/today/route.ts:353`, so
  **the nightly cron busts the plan cache for a plan that did not change.**
  Verified: `last_adapted_at` is 2026-09-05 on a plan whose `adaptation_log` is `[]`.
- `lib/coach/run-recap.ts:860` declares `conditionsNote` and never assigns it, so
  `lib/faff/v5-today.ts:266` ships a permanently null field that
  `ViewsV5/TodayAfterV5.swift:262` renders.
- `app/api/v5/goal-answer/route.ts:104` parses `targetSec` and no branch reads it.
- `strategyLabel` decoded `WatchWorkoutModels.swift:484` and rendered nowhere.
- `postRace` emitted `app/api/today/purpose/route.ts:371-376`, absent from
  `RunPurpose`'s CodingKeys `Models/CoachPayloads.swift:54-57`.
- `hrCeilingSource` emitted `build-workout.ts:2279`, absent from the watch's
  CodingKeys `WatchWorkoutModels.swift:549-554`.
- `app/api/coach/intents/route.ts:170-196` switches on eleven `plan_adapt_*`
  reason strings · `plan_adapt_volume_overshoot`, `plan_adapt_rhr_spike`,
  `plan_adapt_sleep_crater`, `plan_adapt_missed_key_workout`,
  `plan_adapt_niggle_reported`, `plan_adapt_pr_bank`, `plan_adapt_goal_changed`,
  `plan_adapt_long_floor`, `plan_adapt_sick_episode_active`,
  `plan_adapt_injury_active`, `plan_adapt_readiness_pullback`. **No production
  file writes any of them.** Confirmed against the production reason census.
- `readiness-snapshot` cron runs nightly at 08:15 UTC and writes
  `readiness_snapshots`. After RUNNER-OWNS-READINESS **no lever reads it into any
  prescription decision** (`progression-gate.ts:36-37`, `adaptive-ramp.ts:38-58`).

### A test fixture production can never create (Rule 15)

- `lib/plan/sim-matrix.ts:74-92` · `Arc.history` is optional and roughly 11,598
  of ~11,700 archetypes carry none. The file names the consequence at `:25-32`.
- `lib/plan/history-shapes.ts:662` · `executed: true` set unconditionally for
  every logged day. A real 16-week history contains missed and truncated sessions.
- `lib/plan/history-shapes.ts:99-100` · `maxCompletedMpMi: null` corpus-wide, so
  long-run-structure evidence is UNKNOWN everywhere.
- `lib/plan/adjudication-corpus.ts` · registry `:447`: "a production caller would
  also need real execution grades, which this corpus deliberately does not have."
- `lib/adaptation/canonical/*` (12 test files) · `canonical/_cannot_mutate.test.ts:5-17`
  proves the subtree cannot write, so every symmetry and lever-contract proof in
  it certifies behaviour that cannot reach a plan.
- `lib/adaptation/canonical/_replay_ledger.test.ts` · its header (quoted at
  `docs/MASTER_CORE_PRODUCT_PROGRAM.md:353-357`) says it is "a reconstruction
  grounded in documented figures, not a literal database export". **It asserts
  `PROGRESS >= 4` while the real replay produced PROGRESS 0.**
- `lib/adaptation-harness/worlds.harness.test.ts:616-624` -
  `w3.the-upward-volume-path-fires`, marked `binding`, calls `tryAdaptiveBump`,
  which returns null on its first line. **The suite is excluded from `npm test`
  (`vitest.config.ts:36`), so a binding check that cannot pass is also never run.**
- `lib/notifications/_session_moved_sender.test.ts:94-105` · hand-built
  before/after snapshots the production apply lane cannot produce.
- `lib/plan/_seal_single_seam.test.ts:164-166` mandates that the open branch of
  `sealAutomaticActions` exists, which is unreachable while the constant is typed
  `false`.
- `lib/coach/_strength_doctrine.test.ts:164-165` · every `sessionRpeAu` call with
  a non-null RPE; the column does not exist.
- `lib/coach/easy-discipline.test.ts:163` · `gapSPerMi` is hardcoded null at
  `easy-discipline.ts:929`, so `TERRAIN_CONFOUND_GAP_PCT` is unreachable.
- `lib/watch/_heat.test.ts:53-217` · `adjustPhasesForHeat` with `applied: true`;
  the one call site passes null.
- `lib/plan/_heat_trigger.test.ts:78-81` · a `heat_bail` downgrade; the case emits
  only a note.
- `lib/race/_race_outlook_fixture.ts` · builds `RaceOutlookReads` from bare
  numbers, so `composeRaceOutlook`'s refusal branches on real read failure are
  unexercised. Counterexample worth copying: `lib/plan/_reschedule_fixture.ts` is
  verbatim production data (`generated-content-registry.ts:414`).
- Repaired instance worth keeping visible: `lib/plan/_bump_pullback_guard.test.ts:17-27`
  records that three tests "PASSED VACUOUSLY, satisfied by a function that never
  looked" once the seam shut the entry point.

### A shadow path with no stated exit criteria

- **The canonical engine.** `lib/adaptation/_promotion_contract.test.ts:29-32`:
  "The gate cannot know when someone decides to promote."
  `ADAPTATION-VERDICT.md:202` lists the remaining work as "a live shadow period,
  calendar time, not code" **with no duration, no count and no metric.**
  `app/api/admin/canonical-adaptation-shadow/route.ts:38-43` names the open
  product decision and sets no criterion.
- `lib/adaptation/shadow-compare.ts` · mentions "a promotion review" at `:110`,
  `:202`, `:633` and states no threshold, sample size or date.
- `lib/coach/strength-load.ts:44-54` · a three-step follow-up with no owner, no
  date and no trigger, deferred to by `glance-state.ts:611`.
- `lib/watch/build-workout.ts:2160-2169` · "permanently off" with no exit.
- **`reanchorActivePlan` is the genuinely unbounded item.**
  `adaptation-authority.ts:66-73` leaves the one automatic plan writer outside the
  seam "for the owner to rule on", with no date, no condition, and no gate that
  will fail when the ruling is overdue.

For contrast, the orphan directory does carry one:
`generated-content-registry.ts:390` · "THIS ENTRY EXPIRES the moment the owner
opens the seam or wires the advisory to a surface."

### Rule 8, Rule 11 and Rule 14 findings surfaced in passing

- **Unregistered Rule 8 gap.** `adapt.ts:4761-4771` computes `preAbsenceWeeklyMi`
  over the 28 days before a layoff and feeds it to `buildReRampActions:921`,
  which rescales up to 62 days of future weeks. That is a habit reader, it applies
  no taper or post-race exclusion, and it is **absent from
  `lib/audit/normal-window-registry.ts`** (which carries only
  `detectVolumeOvershoot` for that file, `:420-430`). The scanner cannot see it
  because the aggregation is a TypeScript helper call, not SQL.
- **Rule 14 gap.** `strength-recommender.ts:536-543` scopes on
  `tp.archived_iso IS NULL` rather than a named plan and is not in
  `lib/audit/active-plan-exemptions.ts`. Harmless only because the module has no
  caller.
- **Rule 11 swallows on the proposal read path.**
  `lib/plan/workout-proposals.ts:166` swallows the expiry UPDATE failure and
  `:187` returns `{rows: []}` on a failed SELECT, so "the read failed" and "you
  have no proposals" are the same answer to the phone.
- **Rule 11 on the race target.** `lib/race/effective-race-target.ts:85-87`
  `catch { outlook = null; }` collapses a read failure into
  `targetSec: goalSec ?? 0` at `:112` wearing `source: 'goal'`. The three-state
  distinction the header claims at `:55-57` is not observable by a caller reading
  `targetSec` / `source`. UNVERIFIED whether
  `lib/audit/swallowed-failure-registry.ts` covers this shape.
- **Stale reason vocabulary in a live cron.** `app/api/cron/plan-drift/route.ts:544`
  and `:781` catch with `{compromised: true, reason: 'injury'}`, a reason
  `runnerIsCompromised` `adapt.ts:1538` can no longer return, and spend it at
  `:559` and `:784`. `:545` also branches on `mode_label === 'injury-return'`, a
  plan mode nothing can now create.
- **Watch strength and cross leak.** `_no_strength_rows.test.ts:179-183` holds
  `training-state.ts:263` and `week-loader.ts:211` to `type NOT IN
  ('strength','cross','xt')`. `lib/watch/build-workout.ts:1657-1667` is not in
  that list and orders `'cross'` at 2 and `'strength'` at 1, both above `'rest'`
  at 0, so a legacy pre-2026-08-17 row on an otherwise-empty day is selected and
  rendered by `FacesLobbyV5.swift:522-523`.
- **Live doctrine claims over orphaned code.**
  `STRENGTH.phase-frequency-cap-matches-the-matrix` `lib/doctrine/registry.ts:12661`
  and the four `INJURY.*` claims `:12557`, `:12603`, `:15490`, `:15582` run in
  `prebuild` against constants in modules with no caller.
- **Doctrine contradiction.** `docs/PLAN_SIMPLIFICATION_DOCTRINE.md:54` puts
  "automatic return-to-training ladders" on the removal list, while
  `lib/plan/return-ladder.ts`, `/api/v5/return` and
  `ViewsV5/ReturnToRunningV5.swift` are live. The defensible reading is that this
  ladder is check-in-driven and writes no plan row, but the doctrine text does not
  carve that out.

---

## 6 · Where I corrected the brief, and where I corrected CLAUDE.md

The brief asked to be told when it was wrong. Four places.

**1 · "No upward adaptation has ever fired."** Wrong, and importantly so. See
section 1: `reanchorActivePlan` moved the owner's threshold anchor UP off
training evidence on 2026-09-02 and he acknowledged it the next morning. The
true statement is narrower and sharper: *no adaptation inside the seam has ever
fired, and the one outside it writes to a place no ledger reads.*

**2 · "`lib/adaptation/volume-evidence/` plus `dose-responsive.ts` are registered
orphans in `generated-content-registry.ts` (111 entries total)."** The directions
are right; the count is not. The file holds **41 authored-column entries**
(`:97-372`), **75 module orphans** (`:382-581`) and **12 uncalled routes**
(`:588-610`) · 128 in all. The module-orphan list alone is larger than the number
given.

**3 · CLAUDE.md Rule 9's table is stale in two rows.** `achievable-target.ts:196`
and `generate.ts:9896` are both cited with values (`95.1/94.9`, `88.2/87.9`) that
**no longer exist anywhere under `web-v2/lib`**. Both cliffs were fixed and both
now carry continuity gates (`_target_continuity.test.ts`,
`_restore_continuity.test.ts`). Rule 18 applies to the rule text itself: a
citation that no longer resolves stops the next reader from checking.

**4 · CLAUDE.md Rule 21's ledger is out of date and understates the problem.**
It records 309 rows and 20 reasons. Production now shows 23 distinct reasons, and
the zero is wider than stated: `plan_adapt_sealed`, the reason the 2026-09-02 seal
writes when it refuses a plan mutation, also has **zero rows**. The seal has never
had anything to refuse.

---

## 7 · What I could not verify

- **Why `canonical_adaptation_shadow_log` stopped emitting after 2026-09-03.**
  The fact is verified (3 rows, one day, a plan archived 21 minutes later, nothing
  since while the sibling shadow pass in the same cron loop writes daily). The
  cause is not. It is not the `t_pace_s_per_mi` refusal at
  `canonical-shadow/live-input.ts:697-699` · the live plan carries 430. Remaining
  candidates: a refusal inside `buildLiveCanonicalInput` (`live-input.ts:543`,
  `:548`, `:560`, `:565`, `:575`), a throw caught at
  `run-live-shadow-evaluation.ts:222`, or `persistOne` returning false. Reading
  the Railway logs for `[canonical-shadow]` would settle it in one look.
- **Why `plan_workout_proposals` row 6 is still `pending` eleven days after its
  date passed.** Two readings, both consistent with the evidence: the shipped app
  never calls `GET /api/plan/workout-proposals` (which section 0 finding three
  independently supports), or the expiry UPDATE is failing into the
  `.catch(() => {})` at `workout-proposals.ts:166`. I could not separate them
  without a log.
- **Rule 13 is not satisfied anywhere in this audit.** No build, no simulator, no
  screenshot. Every claim about what a runner sees is static import-graph and
  string analysis plus production data. The claim that carries the most weight -
  that the shipped V5 shell has no proposal surface · rests on
  `FaffApp.swift:533-537` plus the absence of any `workout-proposals`,
  `CoachDecisionCard` or `plan_adapt` reference under `ViewsV5/` and `DesignV5/`.
  **It should be confirmed on the device before anyone acts on it.**
- Whether `/api/v5/race-authority` is reached from Swift by a path constructed at
  runtime rather than a literal.
- Whether the watch widget and complication path renders any of the fields marked
  dark in lever 13 and 18.
- Whether `lib/audit/swallowed-failure-registry.ts` covers the
  `effective-race-target.ts:85-87` shape.
- I did not execute the test suite. Test counts and verdict censuses above come
  from the repo's own `lib/audit/_verdict_coverage.test.ts` and from reading the
  files, not from a run.

---

## 8 · FINDINGS · things I wanted to fix and did not

Recorded here per the brief. None of this was changed.

1. **`lib/plan/adaptive-ramp.ts:14-15` names two symbols that do not exist**
   (`buildBumpAction`, `AdaptationAction['kind' = 'bump_distance']`). One-line
   comment repair.
2. **`lib/plan/adapt.ts:1894-1899`'s "COMPLETION FOLLOW-UP (not built here)" is
   half stale.** LTHR capture landed 2026-08-28 at
   `app/api/watch/workouts/complete/route.ts:1098`. The pace half is still
   missing, which matters because the field-test proposal's own runner-facing
   reason is "Pace anchors are going stale". The comment should say which half.
3. **`app/api/cron/plan-drift/route.ts:544/:781` construct
   `{compromised: true, reason: 'injury'}`**, a value the type's producer can no
   longer return.
4. **`.github/workflows/run-adaptations.yml:11-13` describes behaviour the seal
   removed three days before this audit.**
5. **`lib/coach/run-state.ts:1102` is still executing the heat-HR formula
   `lib/weather/heat-adjustment.ts:100-114` says was removed as uncited.**
6. **A gate worth writing, and the cheapest one on this list:** a scan that fails
   when a `plan_workout_proposals.action_kind` has no live renderer. It would have
   caught finding 1 in section 4 the day the V5 shell shipped. A sibling gate:
   fail when a file in `web-v2/db/migrations/` is not recorded as applied to
   production, which would have caught the missing
   `canonical_adaptation_deferrals` table.

---

## 9 · The one-paragraph version

The brain is not missing. It is largely built, heavily tested and unusually
well-documented, and almost none of it can reach the runner. Of twenty-three
levers: **one is complete** (threshold pace, through a path deliberately outside
the seam that keeps no ledger); **three more move only when a human dispatches a
full block rebuild by hand**; **seven are sealed**, and the seal is
direction-asymmetric in a way its own header does not admit; **five are shadow**,
computing correct verdicts nightly that nothing consumes; and **seven have no
owner at all**. The single highest-leverage repair is not opening the seam. It is
that the propose-first lane · the whole downward half of the product, the half
that already works · terminates in a card the shipped phone has no screen for,
and has done since the V5 shell replaced the V4 one.
