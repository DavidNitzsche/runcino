# Agent G — Coaching-brain end-to-end trace on the owner's real data

**Audited commit: `7cac80f006cca1e1718bdb9dfdff48a3e22f4166` (main tip).** The
worktree was created from the stale `claude/build-runcino-app-OIRJr` line
(`f43fb7a7`, no `web-v2/`, no `native-v2/`); I `git reset --hard 7cac80f0`
before any work. Every number below was produced against that tree.

**Method.** Read-only production (`DATABASE_URL_RO`, role `faff_readonly`).
Five throwaway vitest probes under `web-v2/lib/training/_agentg_probe*.test.ts`
called the real, unmodified exported functions — `resolveThresholdCapacity`,
`resolveEasyCeiling`, `resolveHighIntensityCapacity`, `resolveDurability`,
`resolveCoachingThesis`, `resolveThresholdPaceCorpus`, `resolveEasyPaceCorpus`,
`resolveRaceExponent`, `resolveDecoupling`, `classifyStoredActivity`,
`classifyRecentActivities`, `accumulateReexamination`, `fitRaceExponent`,
`aggregateDecoupling`, `readAdaptationSplit`, `loadKeySessionExecutions`.
Nothing was written. Probes deleted after use.

**One caveat on reproducibility.** The owner's phone re-synced mid-session: the
2026-08-31 row (`-41598809443969`) was rewritten at **22:11:18 UTC**
(`ingestedAt` and `weather_enriched_at` both stamped then) between two of my
probe runs. I re-ran the full capacity probe afterwards and diffed: **every
resolver output was byte-identical except `computedAt`.** See §11.

---

## 0 · Resolver numbers reproduced (the verification the task asked for)

All four canonical resolvers + the thesis, run for real, both dates.

### `todayISO = 2026-08-31` — the report numbers, confirmed exactly

| Resolver | Value | Confidence | sourceMode | evidenceIds |
|---|---|---|---|---|
| `resolveThresholdCapacity` | **430 s/mi**, VDOT 47.9 | **0.7268354752028102** | `direct` | `-280549580846348`, `-226755616416002`, `-87627419857791` |
| `resolveEasyCeiling` | 491.69435215946845 s/mi (8:12) | **0.6344908530086352** | `direct` | `-127657343028184`, `-75222347127112`, `-70333530507729` |
| `resolveHighIntensityCapacity` | I 407 / R 371, VDOT 46.8 | **0.2914260240653357** | **`vdot_fallback`** | `-4269086812782646` |
| `resolveDurability` | exponent **1.0869051877057179** | 0.90 overall | `direct` | 5 races + 9 decoupling obs |
| — race exponent component | 1.0869051877057179 | **0.6209679155676007** | `race_derived` | rose-bowl-half-2026, disney-half-2026, la-marathon-2026, sombrero-half, americas-finest-city |
| — decoupling component | 6.411111111111112 %/hr | 0.90 (capped; raw 0.9330464934149868) | `direct` | 9 runs, 2026-03-28 → 2026-08-30 |
| `resolveCoachingThesis` | primary limiter **HIGH_INTENSITY** | 0.2914260240653357 | — | normalized **0.5828520481306714** |

**Every figure in the brief reproduced to the digit**: threshold 430 / 0.727
direct; easy ceiling 0.634; HI `vdot_fallback` 0.291; durability exponent
1.0869 with race-component conf 0.621 and overall 0.900; thesis primary limiter
HIGH_INTENSITY at normalized 0.583.

### `todayISO = 2026-09-01` — one day later, and this is where it gets interesting

| Resolver | Value | Confidence | sourceMode | evidenceIds |
|---|---|---|---|---|
| Threshold | **420 s/mi**, VDOT 49.2 | **0.7884089971986553** | `direct` | `-280549580846348`, `-226755616416002` (**2**) |
| Easy ceiling | 491.69435215946845 (unchanged) | 0.6336475048158089 | `direct` | same 3 |
| High-intensity | I 401 / R 365, VDOT 47.7 | **0.500** (the fallback-band ceiling) | `vdot_fallback` | `-258355938987883` |
| Durability | 1.0869051877057179 (identical) | 0.90 | `direct` | identical |
| Thesis | primary limiter **THRESHOLD** | 0.7884089971986553 | — | HIGH_INTENSITY normalized **1.00** |

`resolveThresholdCapacity`'s AFTER reasons carry
`REEXAMINATION_LOWERED_THE_CORROBORATION_BAR`. The thesis confidence is
byte-identical to the threshold confidence (Rule 16 holding — confirmed, not
assumed).

---

## 1 · The eight runs, traced

Raw rows are the canonical ones (`NOT (data ? 'mergedIntoId')`). Where two
readers disagree about a run, both are given.

### (a) 2026-09-01 · controlled threshold · `-258355938987883`

**Raw.** 8.50 mi, 4103 s moving, 8:03/mi whole-run, avg HR 154 / max 172,
tempF 69.3, source `watch`, 8 mile splits + **9 watch phases**,
`workoutType: threshold`, `workoutTypeSource: plan`.
Plan row `wko_eaa8cfd7cb94310b` (active plan `pln_9a57561debb776e5`):
`4×1 mi @ T pace · 1 min jog`, `rep_pace_s_per_mi 430`, `hr_cap_bpm 168`.

**Interpreted — two systems, two granularities.**
- **Activity Interpreter** (`classifyStoredActivity`): reads *mile splits*,
  produces **3 segments** — 1) miles 1-2 `recovery` conf 0.9683, 2) miles 3-6
  `threshold_like` conf 0.9445, 3) miles 7-8 `steady_aerobic` conf 0.9592.
  `plannedIntent: THRESHOLD`, `observedExecution: MIXED`,
  `executionDivergedFromIntent: true`, `executionQuality: controlled`,
  `structured: true`.
- **Pace corpus** (`thresholdSegmentFromPhases`): reads the *watch phases* and
  gets a much better number — 1700 s of work, **421.84 s/mi**, `hrPct 0.9657`
  (`pct_lthr`), `hrBandDistance 0.551`. This is the reader that actually feeds
  the Runner Model.

  **The two systems read different fields off the same row.** The Interpreter's
  own header names the phases gap as a known ceiling; the pace corpus closed it
  and the Interpreter did not. That is the granularity mismatch, sized: mile
  splits give 444 s/mi, phases give 421.8 s/mi — **22 s/mi** apart on one run.

**Context flags.** `environment: tempF 69.3, humidity 70%, dewpoint 59.1 (est),
slowdownPct 3.92, load moderate, hrConfoundWeight 0.2616,
hrCostPlausiblyElevated true`, reason `DEWPOINT_ESTIMATED_FROM_HUMIDITY`.
Not inside any Rule 8 prescribed window.

**Evidence admitted.** Interpreter: threshold `evidence`, strength moderate,
weight **0.55** = `SINGLE_ACTIVITY_EVIDENCE_CEILING` < `ANCHOR_MOVE_MIN_WEIGHT`
0.60 → `supporting_evidence_only`; durability `evidence` 0.55
(`QUALITY_SURVIVED_ACCUMULATED_LOAD`, `NO_LATE_RUN_PACING_COLLAPSE`,
`RESIDUAL_CARDIOVASCULAR_LOAD_INTO_CLOSE`, residual HR +16 bpm);
high-intensity **no evidence** (`NO_HIGH_INTENSITY_WORK_PERFORMED`,
`GRANULARITY_CANNOT_RESOLVE_INTERVALS`); easy ceiling no evidence.
`anchorMoveCandidate: false`.
Pace corpus: admitted, and at `k=3` it IS one of the three supporting
observations (421.84 s/mi) — see §2 for why it then falls out.

**Beliefs it moved.** Threshold 430 → **420** (see §2 — not by being counted).
HI moved derivatively (its only input is the shared VDOT fallback, and its
anchor became this very run). Durability: **structurally ineligible** —
`loadDecouplingObservations`' SQL excludes `threshold` from both the run's own
type and the owning plan's type. Easy ceiling: untouched, correctly.

**Prescribed next.** Thesis `addressedBy` names this same row; next quality is
`wko_e346d05fc84e0977` 2026-09-03 `10×60s hills @ 5K-10K effort`.

**Sensible?** Mostly yes at the Interpreter layer. The `MIXED` +
`SINGLE_ACTIVITY_BELOW_ANCHOR_MOVE_TIER` verdict is the right conservative
read. The defect is downstream (§2).

### (b) high-intensity work — 2026-07-16 · `-280549580846348`

**Raw.** 5.73 mi, avg HR 139 / max 166, tempF 73.5, `workoutType: intervals`
(`workoutTypeSource: plan`), 9 phases, 5 splits.

**Interpreted.** Interpreter: 3 segments — `recovery` (1.0), `easy_aerobic`
(1.0), `recovery` (0.9433). **All four capacities `no_evidence`**;
high-intensity explicitly `NO_HIGH_INTENSITY_WORK_PERFORMED`; threshold
`NO_SUSTAINED_THRESHOLD_SEGMENT`, `PACE_AND_HR_EXIST_BUT_DEMONSTRATE_NOTHING`.

**Pace corpus.** Admits it as the **fastest threshold observation in the entire
corpus**: `408.33 s/mi` (6:48/mi), 1225 s, source `phases`, `hrPct 0.9126`,
`hrBandDistance 2.0679`.

**This is the load-bearing contradiction.** `THRESHOLD_PCT_LTHR_BAND` is
`[0.95, 1.02]`. This observation sits at **0.9126 — more than two band-widths
below the threshold HR band** — and is admitted anyway, because
`thresholdSegmentFromPhases` computes `hrPct`/`hrBandDistance` and **never
gates on them** (contrast `classifyEasyCandidates`, which does:
`if (!inZone || basis == null) continue`). And it is an *intervals* session, so
its reps are at I-pace by design — the resolved I-pace for this runner is
**407 s/mi**, i.e. this "threshold" observation is I-pace to within a second.

**Effect.** It is the k=1 entry in the descending-VDOT sort, so it is in the
supporting set at every corroboration floor and it is what makes the k=2 answer
(420) faster than the k=3 answer (421). **Sensible? No.** The Interpreter says
this run demonstrated nothing; the Runner Model calls it the runner's best
threshold evidence.

### (c) typical easy — 2026-08-31 · `-41598809443969`

**Raw.** 6.18 mi, 3095 s, 8:21/mi, avg HR 147 / max 164, tempF 76.2, humidity
65%, source `apple_watch`, **7 splits**, `splits_validation {deltaS -110,
durationS 3095, splitsSumS 2985, droppedCount 7}`, `splits_unreliable: false`,
`hrZonePcts: null`, `workoutType: null`, `type: easy`.

**Interpreted.** `plannedIntent: EASY` (active plan `wko_6da44c11918e27a9`),
`observedExecution: EASY_TO_AEROBIC_STEADY`, one `easy_aerobic` segment,
mean pace 498 s/mi, mean HR 145.7, relativeIntensity 1.009, conf 0.9836.
`internalCost: ok, risePct 3.85, 5.56 %/60min, moderate, withinDoctrineNormalBand`.
Durability `evidence` at weight **0.2206** (`STABLE_OUTPUT_WITH_RISING_INTERNAL_COST`,
`DURATION_BELOW_PROTOCOL`, `ENVIRONMENTALLY_AFFECTED`, `ACTIVITY_INTERRUPTED`).
Threshold/HI/easy-ceiling: no evidence.

**Easy corpus.** Not in the supporting set. The ceiling stayed
491.69435215946845 s/mi on both dates off 06-10/06-19/06-21 — this run's
500.8 s/mi whole-run pace is slower than the ceiling and cannot move a
K-th-fastest statistic.

**Sensible? Yes** — and see §11 for the "two classifications" question.

### (d) 2026-08-30 long run · `-245190372869167`

**Raw.** 13.49 mi, 6163 s moving, 7:53/mi, avg HR **159** / max 179, tempF 73.5
(row) / 76.3 (weather object the Interpreter reads), 13 splits, 1 phase,
`workoutType: long`, `workoutTypeSource: plan`, plan `wko_5e2b35ad98ddfc6d`
LONG 13 mi @ 535 s/mi. `hrZonePcts {z1 11, z2 17, z3 9, z4 36, z5 27}`.

**Interpreted.** 5 segments: `easy_aerobic` (mi 1-3), **`threshold_like`
(mi 4-5)**, `recovery` (mi 6), **`threshold_like` (mi 7-10)**, `steady_aerobic`
(mi 11-13). 44.4 min of quality in 2 blocks, 38.8 of it under accumulated load,
`closingVsOpeningPaceRatio 1.0348`, `lateRunPacingCollapse false`, residual HR
+19.3 bpm. Threshold `evidence` 0.55; durability `evidence` 0.55 with
`REPEATED_QUALITY_BLOCKS_WITHIN_ONE_ACTIVITY`.
Environment: **load `high`, hrConfoundWeight 0.4020**.

**Pace corpus.** **Excluded outright.** `labelExcludesThreshold('long')` is
true, so a run in which the Evidence Engine found 44 minutes of threshold-like
work in two blocks contributes **zero** threshold evidence, because the plan
called the day "long". See §4.

**Durability — this one does land.** It is decoupling observation #9:
`driftPct 10.1, durationMin 102.7`. Its arrival moved the aggregate from
**5.95 → 6.411** %/hr and the component confidence **0.8068 → 0.9330** (I
falsified this by re-running `aggregateDecoupling` without it). Note the
direction: the drift number got *worse* and the confidence went *up*, which is
correct — confidence is about corroboration, not about the value.

**Sensible? Split.** The durability read is good. The threshold exclusion is
the defect in §4.

### (e) taper/recovery run inside 08-02→08-30 — 2026-08-24 · `-220066891328078`

**Raw.** 4.02 mi, avg HR 139 / max 159, tempF **87.9**, 5 splits, `workoutType:
easy`, plan `wko_6f8319fd8cce61e1` EASY 4 mi. Inside AFC's post-race recovery
window.

**Interpreted.** `plannedIntent EASY`, `observedExecution EASY`, one `recovery`
segment, `paceStability high (cv 0.0157)`, environment load `high`,
hrConfoundWeight 0.5611. All capacities `no_evidence` or `indeterminate`;
`internalCost` refuses with `insufficient_analysable_splits`; **empty ledger**.

**No negative finding of any kind was produced.** The Evidence Engine does not
score a taper day as a failure. Easy corpus correctly excludes it via
`excludePrescribedDays`. **Sensible? Yes.**

### (f) AFC half — 2026-08-16 · `-161412146640788` · 1:41:53

**Raw.** 13.20 mi, 6163 s… (execution reader: 101.88 min work, 13.11 mi,
**466.29 s/mi**), avg HR 168 / max 178, tempF 68.9, humidity 83%, 14 splits,
`workoutType: race`, `workoutTypeSource: plan`. `races.slug
americas-finest-city`, priority **A**, finishSec **6113**.

**Interpreted — and here the two intent readers disagree.**
- `classifyStoredActivity` → **`plannedIntent: null`**, because its plan lookup
  is `archived_iso IS NULL` (active plan only) and the active plan
  `pln_9a57561debb776e5` starts **2026-08-24**.
- `classifyRecentActivities` → **`plannedIntent: RACE`**, because it uses
  `ownedDaysSql` (the reign fix), which resolves the plan version that actually
  owned 2026-08-16.

Same activity, same day, two answers to "what was this meant to be" — §5.

**With intent RACE**, the Interpreter produces the single most consequential
observation in the window:
```
beliefTension: CONTRADICTS_CURRENT_ESTIMATE
direction: observation_weaker_than_belief
believedPaceSecPerMi 421 · observedPaceSecPerMi 467
magnitudeSecPerMi -46 (-10.9%) · observedMinutes 101.1
reexaminationWeight 0.9248
reasons: GRADED_EFFORT_SLOWER_THAN_BELIEF_WHILE_FRESH, NOT_CORROBORATED_BY_THIS_ACTIVITY_ALONE
```
Capacities: threshold `evidence` 0.55 (`ENVIRONMENTALLY_AFFECTED`), durability
`no_evidence`, `anchorMoveCandidate false`.

**Race exponent — "does one run rewrite the runner?"** Falsified directly with
`fitRaceExponent`:

| Race set | exponent | confidence |
|---|---|---|
| all 5 (with AFC) | 1.0869051877057179 | 0.6209679155676007 |
| 4, AFC removed | 1.0970963720255964 | 0.5307512084403458 |
| AFC 10 min faster (1:31:53) | 1.1153755857705820 | 0.6160430360292516 |

AFC moved the exponent by **−0.0102 (0.94%)** and *raised* confidence. A
10-minute swing in that one race moves it **+0.0285 (2.6%)**. Blended against
`POPULATION_PRIOR 1.06`; `rawFittedExponent` was 1.1011 and the reported value
is 1.0869, so shrinkage is doing real work. **One race does not rewrite the
runner.** The genuine narrowness is elsewhere: `distinctDistances: 2` across 5
races (four halves and one marathon), so the long arm of the curve rests
entirely on LA Marathon 2026.

**Sensible? Yes for the exponent, no for what the tension does with it** — §2.

### (g) heat-affected — 2026-08-28 · `-255291701482225`

**Raw.** 6.32 mi, avg HR 154 / max 172, **tempF 96.9**, humidity 30%, plan
`wko_8a28cffd8f02a38c` EASY 7 mi (he ran 6.32), 6 splits in the row but the
Interpreter reports `HR_CURVE_ABSENT`.

**Interpreted.** `environment: dewpointF 60.36, slowdownPct 13.46, load
**extreme**, hrConfoundWeight **0.8973**`. `plannedIntent EASY`,
`observedExecution AEROBIC_STEADY`, `executionDivergedFromIntent true`,
zero segments, `continuity grade unknown`. Threshold/HI/easy-ceiling
`no_evidence`; durability `indeterminate` (`NO_HR_CURVE_TO_READ_INTERNAL_COST`).
Empty ledger.

**Does heat write into capacity?** No — see §6. **Sensible? Yes.** A 97°F run
correctly demonstrates nothing and is not held against him.

### (h) under-executed sessions — 2026-08-04 `-196897009959912` and 2026-08-06 `-226755616416002`

**Raw (08-06).** Treadmill, 4.86 mi, avg HR **129** / max **134**, no tempF,
3 phases:
```
warmup   completed:true   2.00 mi  1074 s  537 s/mi  avgHr 129 maxHr 134
work     completed:FALSE  2.86 mi  1200 s  419 s/mi  (NO avgHr, NO maxHr)   label "4.0 mi tempo"
cooldown completed:FALSE  no distance, no duration
```
**Raw (08-04).** Same shape: work phase `completed:false`, **2.77 mi** of 4.0,
1161 s, 419 s/mi, no HR on the work phase.

**Plan attribution (the `ownedDaysSql` / e76ff593 check).** `loadKeySessionExecutions`
returns for both dates `type: tempo`, `plannedBasis: expanded-spec`, planned
`domain threshold, workMinutes 27.93, workMi 4, meanWorkPaceSPerMi 419` — i.e.
the plan version that was live in early August, not the active plan (which does
not cover those dates at all). **The reign fix is verified working**, on the
exact two dates named. `classifyRecentActivities` likewise returns
`plannedIntent: THRESHOLD` for both.

**Interpreted (08-06).** `plannedIntent: null` via `classifyStoredActivity`
(active-plan-only), `observedExecution: RECOVERY`, **zero segments**,
`environment: INDOOR_ACTIVITY, hrConfoundWeight 0`, continuity `unknown`
weight 0.6. All capacities: threshold **`no_evidence`**
(`NO_SUSTAINED_THRESHOLD_SEGMENT`, `PACE_AND_HR_EXIST_BUT_DEMONSTRATE_NOTHING`),
HI no evidence, durability `indeterminate`, easy ceiling no evidence.
Empty ledger. **The Activity Interpreter's verdict is: this run demonstrated
nothing.**

**Pace corpus (08-06).** Admits it as
`{paceSecPerMi 419.58, durationSec 1200, source 'phases', hrBasis null,
hrPct null, hrBandDistance null}` — **and it is one of the two `evidenceIds`
backing the live 420 s/mi threshold belief on 2026-09-01.**

So an **abandoned treadmill tempo — work phase `completed: false`, 2.86 of 4.0
prescribed miles, zero heart rate on the work segment, run inside AFC's
prescribed taper window** — is 50% of this runner's current threshold capacity
belief, and it makes him look *faster* than the sessions he actually finished.

`thresholdSegmentFromPhases` filters `p.type === 'work'` and **never reads
`p.completed`**; `pooledHr` falls to `null` and nothing rejects the segment for
it.

**And 08-04 is invisible for a 39-second reason.** `THRESHOLD_MIN_SESSION_TOTAL_SEC`
is 1200 (20 min). 08-06's work phase is **exactly 1200 s**; 08-04's is
**1161 s**. Same abandoned workout, same 419 s/mi belt pace, one is half the
runner model and the other does not exist. That is Rule 9's cliff signature.

**Sensible? No, on both counts.**

---

## 2 · The headline defect: two "you are slower than we thought" observations made the engine believe he is faster

Reproduced end to end against production, both dates.

`resolveThresholdCapacity` runs two passes. Pass 1 resolves the corpus at the
default floor `CORROBORATION_MIN_OBSERVATIONS = 3`. Pass 2 hands that belief to
`classifyRecentActivities` over `REEXAMINATION_WINDOW_DAYS = 28`, collects
belief-tension observations, and `accumulateReexamination` may lower the floor
by one (never below 2).

**At `todayISO = 2026-09-01`, pass 1's belief is 421 s/mi**, and the window
`[2026-08-04, 2026-09-01]` holds exactly two tension observations:

| Date | Run | Intent | Direction | Observed vs believed | Weight |
|---|---|---|---|---|---|
| 2026-08-16 | AFC half | RACE | **observation_weaker_than_belief** | 467 vs 421 (**10.9% slower**) | 0.9248 |
| 2026-09-01 | 4×1 mi | THRESHOLD | **observation_weaker_than_belief** | 444 vs 421 (**5.5% slower**) | 0.8534 |

```
direction: 'weaker'
reasons: ['REPEATED_TENSION_LOWERED_THE_CORROBORATION_BAR']
→ effectiveMinObservations 3 → 2
```

And `corroboratedCorpusVdot` is **the k-th best VDOT of N, sorted descending**:

```
sorted[minObservations - 1].vdot
```

so lowering k can only ever move the answer **up** the sorted list. Measured on
the real corpus at 2026-09-01 (7 observations):

| k | resolved | VDOT |
|---|---|---|
| 5 | 435 s/mi | 47.2 |
| 4 | 430 s/mi | 47.9 |
| **3** (default) | **421 s/mi** | 49.0 |
| **2** (relaxed) | **420 s/mi** | 49.2 |

**Two observations that the runner ran materially slower than believed — one of
them a real A-race, run fresh, 10.9% off — lowered the corroboration bar, and
lowering the bar made the threshold belief faster (421 → 420) and more
confident (0.727 → 0.788).**

`accumulateReexamination` computes `direction`, labels it `'weaker'`, prints it
in the returned object, and **never branches on it**. The only direction that
blocks relaxation is `'conflicting'`. Falsified directly (Rule 18) — identical
inputs, both directions:

```
direction=observation_stronger_than_belief → effectiveMinObservations 2
direction=observation_weaker_than_belief   → effectiveMinObservations 2
weight 0.01, weaker                         → effectiveMinObservations 2
```

`pressure` (0.9446 here) is computed from the weights and is explicitly never
thresholded — so a heat-confounded, low-continuity observation relaxes the bar
exactly as hard as a clean one. That is where `hrConfoundWeight` goes to die:
it flows into `reexaminationWeight`, into `pressure`, and then nothing reads it.

**Secondary: the mechanism is self-referential and non-monotone.** Pass 1's
belief decides which observations *count* as tension, which decides the floor,
which decides the belief. On 2026-08-31 the belief was 430, so 08-30 read
`stronger` and AFC read `weaker` → `conflicting` → **no relaxation, 430 stands**.
One day later the belief is 421, 08-30 flips to `observation_consistent_with_belief`,
and the direction becomes unanimous `weaker` → relaxation fires. **A 9 s/mi
change in the pass-1 belief flipped the mechanism from "blocked" to "fired".**

**The existing reference-case doc is wrong here.** `docs/reference-cases/
todays-run-full-trace-2026-09-01.md` §3 says the relaxation "dropped the oldest,
slowest of the three prior sessions (2026-07-07)" and cites
`direction: observation_stronger_than_belief`. Both are artifacts of supplying a
hand-picked belief of 430 rather than the resolver's own pass-1 belief of 421.
At `k=3` the supporting set is `{07-16, 08-06, **09-01**}` — 07-07 is already
out — and what the relaxation actually drops is **today's own run**. The run
that triggered the re-examination is the run the re-examination discards.

---

## 2b · The 10 s/mi move from one session — decomposed, and the hero-workout test

**Does the threshold reader count each rep as a separate observation? NO.**
`thresholdSegmentFromPhases` filters `p.type === 'work'`, then **pools** every
qualifying phase into a single segment (`totalSec += sec; totalMi += mi`) and
emits ONE `PaceObservation`. `thresholdPaceCorpus` then de-dupes by `o.id`
("a duplicate id keeps the FASTER read"), so one run can never contribute twice.
Verified arithmetically against the row's own phases:

| Phase | Label | mi | sec | s/mi | avgHr | maxHr | target | verdict | completed |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
| 1 | Warm-up | 2.10 | 1084 | 516 | 140 | 151 | 502 | hit | true |
| 2 | Interval · 1 mi | 1.01 | 424 | **422** | 158 | 162 | 430 | drifted | true |
| 3 | Jog 1 min | 0.12 | 61 | 515 | 158 | 162 | — | — | true |
| 4 | Interval · 1 mi | 1.01 | 431 | **429** | 161 | 165 | 430 | drifted | true |
| 5 | Jog 1 min | 0.08 | 64 | 785 | 156 | 164 | — | — | true |
| 6 | Interval · 1 mi | 1.00 | 423 | **422** | 164 | 169 | 430 | drifted | true |
| 7 | Jog 1 min | 0.06 | 64 | 1034 | 157 | 169 | — | — | true |
| 8 | Interval · 1 mi | 1.01 | 422 | **419** | 166 | 172 | 430 | **missed** | true |
| 9 | Cool-down | 2.11 | 1125 | 534 | — | — | — | — | — |

Pooled work: `1700 s` (424+431+423+422) over `4.03 mi` → **421.84 s/mi** —
byte-matching the corpus's reported `durationSec 1700, paceSecPerMi
421.83622828784115`. The three jog recoveries are `type: recovery` and are
correctly excluded from the pool, so the corpus does **not** suffer the
mile-averaging dilution the Interpreter does (§7). **One workout, one
observation.**

**Were the reps classified as threshold evidence, and was the HR right?**
Yes, and yes. Duration-weighted pooled work HR is
`(158·424 + 161·431 + 164·423 + 166·422) / 1700 = 162.24 bpm`, giving
`hrPct = 162.24 / 168 = 0.96571` — matching the corpus's reported
`0.9657107843137256` — which sits **inside** `THRESHOLD_PCT_LTHR_BAND
[0.95, 1.02]`, `hrBandDistance 0.551`. The "~158" figure is rep 1 alone; HR
climbed 158 → 161 → 164 → 166 across the set. The `drifted`/`missed` verdicts
are the watch grading against the workout's own `pass if avgHr ≤ 164` rule
(rep 4 at 166 crossed it), well under the `bail if > 173` line — an
HR-ceiling annotation, not a pace failure. So on HR grounds this is a clean,
in-band threshold observation. The **Evidence Engine** separately called
segment 2 (miles 3-6) `threshold_like` at conf 0.9445, `executionQuality:
controlled`, and produced threshold `evidence` at weight 0.55.

### Where the 10 s/mi actually came from

| Step | Corpus | k | Supporting (fastest → slowest) | k-th best | Resolved |
|---|---|---|---|---|---|
| 2026-08-31 | 6 obs | 3 | 07-16 **408.33** · 08-06 **419.58** · 07-07 **429.50** | 429.50 | **430** s/mi · VDOT 47.9 · conf 0.7268 |
| 2026-09-01 pass 1 | 7 obs | 3 | 07-16 408.33 · 08-06 419.58 · **09-01 421.84** | 421.84 | **421** s/mi · VDOT 49.0 |
| 2026-09-01 pass 2 | 7 obs | **2** | 07-16 408.33 · 08-06 419.58 | 419.58 | **420** s/mi · VDOT 49.2 · conf 0.7884 |

**So ~9 of the 10 s/mi is attributable to this one session, directly**: it
landed at 421.84 s/mi, which is faster than 2026-07-07's 429.50, so it
**displaced 07-07 as the third-fastest observation** — and the estimate *is*
the third-fastest observation. The remaining ~1 s/mi is the direction-blind
tension relaxation of §2. Confidence rose 0.7268 → 0.7884 in the same step,
because `freshnessScore` re-based on a same-day observation.

**The live evidence list, with weights, on each date:**

| Date | Run id | s/mi | dur | source | hrBasis | hrPct | hrBandDist | in 08-31 anchor? | in 09-01 anchor? |
|---|---|---:|---:|---|---|---:|---:|---|---|
| 2026-07-16 | `-280549580846348` | 408.33 | 1225 s | phases | pct_lthr | 0.9126 | **2.068 (outside)** | ✅ | ✅ |
| 2026-08-06 | `-226755616416002` | 419.58 | 1200 s | phases | **null** | **null** | **null** | ✅ | ✅ |
| 2026-09-01 | `-258355938987883` | 421.84 | 1700 s | phases | pct_lthr | 0.9657 | 0.551 | — | ❌ (dropped by the k=3→2 relaxation) |
| 2026-07-07 | `-87627419857791` | 429.50 | 2154 s | splits | pct_lthr | 0.9783 | 0.191 | ✅ | ❌ (displaced) |
| 2026-07-14 | `-4269086812782646` | 435.00 | 870 s | splits | pct_lthr | 0.9344 | 1.445 | — | — |

`PaceObservation` **carries no weight field at all.** Every admitted observation
counts identically in the sort; nothing down-weights the 07-16 entry for sitting
two band-widths outside the T-HR band, or the 08-06 entry for having no HR at
all, or up-weights 07-07 for being the longest (2154 s) and most HR-credible
(0.9783) reading in the set. The estimate is an unweighted order statistic.

### Would doctrine's hero-workout test pass this?

**No, and the reason is structural rather than a matter of degree.**

The guard doctrine asks for **exists and is correct**: `activity-evidence.ts`
defines `SINGLE_ACTIVITY_EVIDENCE_CEILING = 0.55` and
`ANCHOR_MOVE_MIN_WEIGHT = 0.60`, and for this exact run it produced

```
threshold: weight 0.55 · anchorEffect "supporting_evidence_only"
anchorMoveCandidate: false
anchorMoveReasons: ["SINGLE_ACTIVITY_BELOW_ANCHOR_MOVE_TIER",
                    "MIXED_INTENSITY_ACTIVITY_AVERAGE_NOT_EVIDENCE"]
```

— an explicit, correct "this activity alone may not move the anchor."

**And the anchor moved 10 s/mi anyway, the same day, off that activity.**
`resolveThresholdPaceCorpus` never imports, calls or consults
`classifyActivityEvidence`; it reads `runs` and `coach_intents` directly and
applies its own admission rules (`labelExcludesThreshold`, duration windows) with
no weight, no anchor-move tier and no reference to the Evidence Engine's verdict.
The hero-workout guard is real, is enforced, and is **wired to a system that does
not own the anchor.** This is the same "wired, tested and inert" shape CLAUDE.md
names as this codebase's signature failure — except here the inert half is a
*safety* guard on the *upward* path.

Sizing it against doctrine's own language — "one run should rarely rewrite the
runner": one session moved the threshold anchor **2.3%** (430 → 420 s/mi) and
VDOT **+1.3** (47.9 → 49.2) in a single day, and that will propagate to every
prescribed quality pace the next time `recompute-paces.ts` runs. For comparison,
the AFC half — a real A-race — moved the durability exponent **0.94%**, because
*that* fit shrinks toward a population prior and weights by priority and recency.
The threshold reader has neither mechanism.

**The direction is earned; the magnitude is unbounded.** This was a genuinely
strong session — four reps at 419-429 against a 430 target, HR mid-T-band,
`executionQuality: controlled`, no late collapse — and Rule 21 is explicit that
the plan must be able to get harder and that this push path had never once fired
for this runner. Crediting it is right. The defect is that *how far* it moves the
belief is decided by which slot it happens to land in on a 7-row sorted list,
with no cap, no weighting and the one guard designed to cap it sitting in another
module. A corpus one observation smaller, or a k of 2 instead of 3, and the same
session would have moved the anchor a different amount for no physiological
reason.

---

## 3 · The Coaching Thesis's primary limiter is a step function of an unrelated anchor's age

`rankCapacities` normalises each capacity by its *reachable* ceiling:
THRESHOLD and DURABILITY by `directCeiling = 0.90`, HIGH_INTENSITY by
`fallbackCeiling = 0.50` (it has no direct reader, so 0.50 is all it can ever
score). The lowest normalised confidence becomes the primary limiter.

HIGH_INTENSITY's confidence is `fallbackConfidence(anchorDate, today) =
0.20 + 0.30 · 2^(−days/28)`, so its normalised value is
`0.4 + 0.6 · 2^(−days/28)`, where *days* is the age of the best-recent-VDOT
anchor run — **a quantity with nothing to do with high-intensity ability**.
Walked against THRESHOLD's normalised 0.8760:

```
anchor age  0d → 1.0000    7d → 0.9045    9d → 0.8802
           10d → 0.8684   14d → 0.8243   20d → 0.7657
```

**The limiter flips between age 9 and age 10 days.** Observed live:

| Date | HI anchor | age | HI norm | Primary limiter | Priority | addressedBy |
|---|---|---|---|---|---|---|
| 2026-08-31 | `-4269086812782646` (07-14) | 48 d | 0.5829 | **HIGH_INTENSITY** | `establish_high_intensity_evidence` | 09-03 hills |
| 2026-09-01 | `-258355938987883` (today) | 0 d | 1.0000 | **THRESHOLD** | `increase_threshold_demand` | 09-01 threshold |

Overnight, with no high-intensity session run and no high-intensity evidence
gained, the app's stated top training priority changed from "establish
high-intensity evidence" to "increase threshold demand" — because a *threshold*
run refreshed a VDOT anchor. This is Rule 9 exactly: a categorical change in
what the plan emphasises, hinging on a hair.

### Is HIGH_INTENSITY-as-limiter a finding about the runner or an artifact?

**On 2026-08-31 it was an artifact, and the code says so out loud.** The
thesis's own reasons were `HIGH_INTENSITY_STRUCTURALLY_CEILINGED`,
`LIMITER_HAS_NO_DIRECT_EVIDENCE`; `notPriority` carries "no direct evidence
reader exists for this capacity yet". The normalisation is a genuinely good
idea — it stops a reader-less capacity from being permanently blamed. But it
does not go far enough: because the ceiling normalisation makes HI's score a
pure function of anchor freshness, HI is *guaranteed* to be the limiter whenever
the runner has not produced a VDOT-qualifying run in ~10 days, and *guaranteed*
not to be whenever he has. Neither state is information about his 3-5K ability.

The honest posture would be to rank HIGH_INTENSITY as **unrankable** while it
has no direct reader (Rule 11: "we did not look" is not "we looked and found
weakness"), rather than giving it a score that oscillates on an unrelated clock.
As it stands, "no evidence" does become a negative finding roughly half the
time — and the half is decided by the calendar.

---

## 4 · Activity labels overriding observed physiology — YES

**Where:** `classifyThresholdCandidates` / `classifyEasyCandidates` in
`lib/training/pace-corpus.ts`.

```ts
labelExcludesThreshold: norm === 'easy' | 'recovery' | 'long' | 'shakeout' | 'race'
labelExcludesEasy:      QUALITY_TYPES.has(norm) || norm === 'race'
```

`norm` is `normalizeDataWorkoutType(data->>'workoutType')` — and on this
runner's rows `workoutTypeSource` is **`plan`**. So the plan's own prescription
decides which of the runner's days are admissible as capacity evidence, before
any physiology is read.

**Concrete cost, on real rows:**
- **2026-08-30** — the Interpreter found 44.4 minutes of `threshold_like` work
  in two blocks, `REPEATED_QUALITY_BLOCKS_WITHIN_ONE_ACTIVITY`, 36% of the run
  in Z4 and 27% in Z5 against LTHR 168. Labelled `long` → **contributes zero
  threshold evidence.**
- **2026-08-16** — a genuine race half at 466 s/mi. Labelled `race` →
  contributes zero threshold evidence to the corpus (it reaches the model only
  through the race exponent and, perversely, through the tension mechanism in
  §2).
- **2026-08-23** — `workoutType` is NULL, so nothing excludes it; the
  Interpreter found 47.2 minutes of `threshold_like` work across 2 blocks. The
  *unlabelled* run is admissible and the two labelled ones are not.

The Strava/HealthKit *name* field ("Run", "Treadmill") is not read anywhere in
classification — that half is clean. It is the **plan label** that overrides
physiology. Doctrine-wise this is defensible as intent-awareness, but the effect
is that over-execution on an easy day and under-execution on a quality day are
both structurally invisible to the Runner Model, which is the opposite of what
the adaptation doctrine asks for.

---

## 5 · Split ownership / wrong-plan attribution

**The reign fix works where it was applied.** `ownedDaysSql` is used by
`classifyRecentActivities` and `loadKeySessionExecutions`, and both return the
correct historical plan for 2026-08-04 and 2026-08-06 (`tempo`, work 4 mi @
419 s/mi) even though the active plan `pln_9a57561debb776e5` begins 2026-08-24.
The owner has **47 plan versions**; nothing I ran read an archived one by
accident.

**But there are two different answers to the same question, live.**
`classifyStoredActivity` still uses `archived_iso IS NULL ... ORDER BY pw.id ASC
LIMIT 1` — active plan only. Measured on the same rows:

| Date | `classifyStoredActivity` | `classifyRecentActivities` |
|---|---|---|
| 2026-08-04 | `plannedIntent: null` | `THRESHOLD` |
| 2026-08-06 | `plannedIntent: null` | `THRESHOLD` |
| 2026-08-16 (AFC) | `plannedIntent: null` | `RACE` |
| 2026-09-01 | `THRESHOLD` | `THRESHOLD` |

This is not cosmetic. `readBeliefTension`'s weaker arm is gated on
`graded = plannedIntent ∈ {RACE, TIME_TRIAL, THRESHOLD}`. Through
`classifyStoredActivity`, **the AFC race produces no tension at all**; through
`classifyRecentActivities` it produces the highest-weight tension in the window.
Any surface that renders a single run's evidence via `classifyStoredActivity`
will show a different verdict than the Runner Model used. Constitution
"one question, one owner" — this row has two.

Secondary: `ORDER BY pw.id ASC LIMIT 1` picks an arbitrary row on a date with
more than one plan workout. Not currently biting (no doubles in this account's
active plan), but it is a lottery, not a rule.

---

## 6 · Environmental context — interpretation only, correctly

**Does heat write into any capacity value? No.** `lib/training/capacity-resolver.ts`
and `lib/training/pace-corpus.ts` contain **zero** references to `tempF`,
`temp_f`, `heat`, `dewpoint` or `wbgt`. Verified by grep.

`durability-anchor.ts` handles heat the right way — by **exclusion, not
adjustment**: `qualifyingDecouplingObservation` returns `null` when
`row.tempF >= HEAT_CONFOUND_TEMP_F`, and its header argues explicitly against
reusing the `heat-adjustment.ts` pace-adjustment machinery because that answers
a different question. That is Constitution §"environmental context modifies
interpretation, never the value" honoured.

The Evidence Engine computes a full environmental read per activity
(`load`, `slowdownPct`, `hrConfoundWeight`, `hrCostPlausiblyElevated`) — on the
owner's runs this ranged from `moderate`/0.2616 (09-01) to `extreme`/0.8973
(08-28 at 96.9°F) — and uses it to weight and to attach `ENVIRONMENTALLY_AFFECTED`.

**The gap is on the other side.** The pace corpus, which is the reader that
actually sets the numbers, has no environmental awareness at all: no heat
exclusion, no confound gate, nothing. A threshold session run at 96.9°F would be
admitted at face pace. Because the corpus statistic is *K-th fastest*, that
biases safely for threshold (heat makes you slower, and slow observations sink
in the sort) — but it means the environmental machinery is doing no work for the
capacity that matters most, while the Evidence Engine that computes it feeds
only the `pressure` term that nothing reads (§2).

---

## 7 · Whole-run averages vs structure

Mixed, and the two systems have swapped strengths:

| Reader | Reads | On the 09-01 4×1 mi |
|---|---|---|
| Activity Interpreter | mile splits → 3 segments | work at **444 s/mi** |
| Pace corpus (`thresholdSegmentFromPhases`) | watch phases | work at **421.84 s/mi** |
| Watch's own phases | per-rep | 7:02 / 7:09 / 7:02 / 6:59 |

So the capacity reader **does** look at structure, and looks at the better
structure. The Interpreter — the system whose whole job is interpreting the
activity — is the one still on mile splits, and its own header names this. The
22 s/mi gap that opens between them is what fed the "observation is slower than
belief" tension in §2: the tension is computed off the Interpreter's diluted
444, not off the corpus's 421.8. **The belief-tension mechanism is comparing a
diluted number against a belief built from an undiluted one.**

For the 08-04/08-06 treadmills the corpus reads phases and gets the "work"
phase's 419 s/mi in isolation — structure without any completion or HR check
(§1h). Structure-aware is not the same as honest.

---

## 8 · Taper / recovery treated as failure

**At the Evidence Engine layer: no.** 2026-08-24 (inside the AFC recovery
window) produced no negative finding, empty ledger, no anchor pressure.

**At the easy corpus: no** — `resolveEasyPaceCorpus` calls
`excludePrescribedDays`, and `EASY_CORPUS_LOOKBACK_DAYS` was widened to 90
precisely because AFC's exclusion window (≈08-02 → 08-30) ate most of a 60-day
lookback. Well-argued and Rule-8-correct.

**At the threshold corpus: deliberately not filtered** — the file argues
threshold is a capability question, not a habit question, so the Rule 8 fork
falls on the capability side. Defensible in principle. In practice it means the
08-06 abandoned taper-week treadmill (§1h) is half the live threshold belief.

**At the adaptation split's Rule-8 filter: correctly asymmetric.**
`applyRepresentativeWindow` excludes prescribed days, and only on *total
washout* rescues rows — and only **negative** ones (`MISSED`, `PARTIAL_FAILED`,
verdict `slow`). Positive taper rows are never rescued. The asymmetry is argued
and points the safe way.

**At the consistency dimension: NOT filtered, in either reader.** This is a real
gap. `loadRepresentativeExecutionInput` re-derives only
`keySessionExecutions` / `keySessionsPlanned` / `keySessionsCompleted` /
`targetVerdicts`; `weeklyPlannedMi` / `weeklyActualMi` pass through from
`loadAdaptationInput` untouched. So `readConsistency` (weight **0.20**) scores
the AFC taper and post-race weeks as plan misses in the Rule-8-filtered reader
too. Observed identical in both halves:

```
consistency  score -0.4048200584451487  weight 0.20
"weekly volume averaging 82% of plan · one week at 7% of plan against a 82% average"
```

His real weekly mileage over the 42-day window:
`07-13 39.8 · 07-20 47.5 · 07-27 4.2 · 08-03 39.8 · 08-10 23.2 · 08-17 28.4 ·
08-24 34.8 · 08-31 14.7 (partial)`. The named 7% week is **07-27** (4.2 mi),
which is genuinely outside the prescribed windows — so the specific sentence is
honest. But **08-10 (race week) and 08-17 (post-race recovery) are both inside
the AFC window and both drag the 82% mean down**, in the reader that exists to
exclude exactly those. Structural Rule 8 violation with real, if modest, effect.

One presentation risk worth naming: the two halves emit the *same sentence
template* with contradicting numbers —
`"2 of 7 key sessions delivered the full stimulus"` versus
`"7 of 11 key sessions delivered the full stimulus"`. The counts differ
legitimately (the representative reader widens its lookback before excluding),
but if either string ever reaches a screen next to the other it is a Rule 16
incident waiting to happen. Currently shadow-only.

---

## 9 · Stale evidence: is it decay-confidence-not-value?

**Yes, correctly, and I verified the value never moves.**

- `CAPACITY_CONFIDENCE_HALF_LIFE_DAYS = 28`. It is consumed only inside
  `directEvidenceConfidence` (`freshnessScore`) and `fallbackConfidence`.
  Nothing multiplies a pace or an exponent by it.
- Observed across one day with identical evidence: easy ceiling **491.69435215946845
  s/mi on both dates** (value bit-identical), confidence **0.6344908530086352 →
  0.6336475048158089**. Exactly the doctrine behaviour.
- `directEvidenceConfidence`'s header states it is monotone in evidence and
  reads no value at all — confirmed by reading: `countScore` from the count,
  `consistencyScore` from the spread, `freshnessScore` from the newest date.
  A faster reading cannot inflate its own confidence.
- Durability uses a separate, deliberately slower half-life:
  `DURABILITY_HALF_LIFE_DAYS = 84`, plus
  `RACE_EXPONENT_TIME_COHERENCE_HALFLIFE_DAYS = 120`.
- One-value-single-observation is scored honestly: `consistencyScore = 0` for a
  single supporting value, explicitly *not* "perfect agreement".

Applied and correct. No finding.

---

## 10 · Readiness

**Inputs that exist for the owner** (93 `readiness_snapshots`, 2026-09-01):
```
score 70 · band ready
hrv          weight  +6   59 ms · 7d median      (baseline 52 ms)
rhr          weight   0   47 bpm · 3d avg        (baseline 48 bpm)
load         weight   0   In range · 1.21 ACWR   (this week 5.3 · month avg 4.3 mi/day)
sleep        weight  −6   6.4 h · 7-night avg    (−1.1 h vs target)
hr_recovery  weight   0   42 bpm drop            (baseline 43 bpm)
```
Plus `post_run_rpe` (subjective effort 6 on 09-01, 7 on 08-30, 4 on 08-31) and
`subjective_checkins`, both read by the Evidence Engine.

**Does any of it write into capacity? No.** `capacity-resolver.ts`,
`pace-corpus.ts`, `durability-anchor.ts` and `coaching-thesis.ts` contain zero
readiness imports; `lib/coach/readiness*.ts` imports no capacity resolver.
The separation the doctrine demands (`currentFitness = baseFitness ×
fatiguePenalty` is the named anti-pattern) is structurally held. Clean.

---

## 11 · The two audit-test failures (coordinator's question)

**Both are one row: `-41598809443969`, the 2026-08-31 easy run.**

**What changed.** The row's `fetched_at` is still `2026-08-31 18:23:41`, but its
`ingestedAt` now reads **`2026-09-01T22:11:18.789Z`** and
`weather_enriched_at` **`2026-09-01 22:11:18.884`** — both stamped *during this
audit session*, minutes apart from my own probe runs. The row was re-ingested
from Apple Watch (its `activityId` is now `wko_F1BC81A2-…`, a workout UUID) and
then weather-enriched. It now carries **7 splits** with HR;
`splits_validation {deltaS −110, durationS 3095, splitsSumS 2985,
droppedCount 7}` and `splits_unreliable: false`.

**What the test expected.** The audit file's header states the row "carries
`splits_unreliable: true` … seven splits were computed at ingest and DROPPED —
and it stores no elapsed clock at all", and asserts
`Array.isArray(easy.splits) === false`, `easy.splits_unreliable === true`,
`observedExecution === 'EASY'`, `internalCost.ok === false` with reason
`no_hr_curve`, `capacities.durability.kind === 'indeterminate'`,
`continuity.grade === 'unknown'`, `ledger` empty.

**What it now produces** (`classifyStoredActivity`, run for real):
```
signals: pace high, hr high (was: HR_CURVE_ABSENT)
continuity: grain per_split · grade high · weight 0.9670
observedExecution: EASY_TO_AEROBIC_STEADY     (was EASY)
segments: 1 × easy_aerobic, 498 s/mi, HR 145.7, relativeIntensity 1.009, conf 0.9836
internalCost: ok · risePct 3.85 · 5.56 %/60min · moderate · withinDoctrineNormalBand
durability: evidence · low_to_moderate · weight 0.2206 · supporting_evidence_only
ledger: 2 entries (AEROBIC_DURABILITY_OBSERVATION)
threshold / high_intensity / easy_ceiling: no_evidence (unchanged)
anchorMoveCandidate: false (unchanged)
```

**Verdict: benign test-fixture staleness, not a "one run, two truths" defect.**
The reasoning, against Constitution §14:

1. **The row genuinely changed.** This is not the same input read two ways — the
   splits were absent when the fixture was written and are present now, because
   a later ingest supplied them. A classifier that produced the same output from
   strictly more data would be the defect.
2. **Every difference is a refusal being lifted, in the direction §14 requires.**
   `internalCost` went from `ok:false / no_hr_curve` to `ok:true` with
   `confidence 0.7195, band moderate`; durability went from `indeterminate`
   (an explicit "we cannot tell") to `evidence` at weight **0.2206** — the
   *lowest* weight of any run I traced, carrying `DURATION_BELOW_PROTOCOL`,
   `ENVIRONMENTALLY_AFFECTED`, `ACTIVITY_INTERRUPTED`. Better data raised
   confidence; it did not invent an alternate truth.
3. **`EASY` → `EASY_TO_AEROBIC_STEADY` is a refinement, not a contradiction.**
   The old label came off the whole-run mean; the new one comes from a segment
   read (`relativeIntensity 1.009`, right at the easy/steady boundary). Both
   describe an easy run. Nothing that was "no" became "yes": threshold,
   high-intensity and easy-ceiling stayed `no_evidence`, and
   `anchorMoveCandidate` stayed `false` — which are the assertions the file's own
   header calls the point of the exercise, and they all still pass.
4. **Nothing downstream moved.** I re-ran the full capacity probe after the
   rewrite and diffed against the run from two minutes before: **every field of
   all four resolvers, both pace corpora and the Coaching Thesis was identical**;
   the only line that changed was `computedAt`. Specifically — easy ceiling
   491.69435215946845 s/mi and its three evidence ids unchanged (the run's
   500.8 s/mi cannot move a K-th-fastest statistic); threshold corpus
   observations unchanged; the run produces no belief tension
   (`no_comparable_observation`) either way; it is not a key session, so load
   absorption is untouched.

**The real finding is about the test, and it is a Rule 18 one.** The file
asserts a *negative* — "these signals do not exist in production for this run" —
against a live, mutable production row, with the specific values
(`splits_unreliable: true`, `droppedCount 7`) written into its header prose as
fact. It was true when written and is false now, and nothing warned. A test that
pins a production row's data-quality state will go red on ordinary ingest, and
its header will keep asserting the old state to every future reader (Rule 20's
corollary: a header comment nothing verifies is documentation, not enforcement).
The fix is to make the degraded-row case a fixture and keep the production run
for the assertions that are invariant (`no_evidence` on the three capacities,
`anchorMoveCandidate false`), or to branch the test on the row's actual
`splits_unreliable` and assert the honest result for whichever state it is in.

Recap text was not checked — that is a render surface and Rule 13 requires a
screenshot I did not take.

---

## 12 · Defect list

| # | Severity | Finding | Evidence |
|---|---|---|---|
| 1 | **High** | Belief-tension relaxation is direction-blind. Two `weaker` observations (AFC 10.9% slow, 09-01 5.5% slow) lowered the corroboration bar; the bar is a K-th-best order statistic, so lowering it can only make the runner look faster. Live: 421 → 420 s/mi, conf 0.727 → 0.788. | §2; falsified with `accumulateReexamination` both directions |
| 1b | **High** | The hero-workout guard is not wired to the anchor. `activity-evidence.ts` graded the 09-01 session `weight 0.55 < ANCHOR_MOVE_MIN_WEIGHT 0.60`, `anchorMoveCandidate: false` — and the threshold anchor moved **430 → 420 s/mi (2.3%, VDOT +1.3)** the same day off that session, because `resolveThresholdPaceCorpus` never consults the Evidence Engine. ~9 of the 10 s/mi is the session displacing 2026-07-07 as the third-fastest observation in a K-th-best statistic with **no per-observation weight and no cap**. | §2b |
| 2 | **High** | `thresholdSegmentFromPhases` never reads `phase.completed` and has no HR gate. An abandoned treadmill tempo (`completed:false`, 2.86 of 4.0 mi, **no HR on the work phase**) is one of the two evidence ids behind the live threshold belief. The easy reader gates on HR; the threshold reader does not. | §1h |
| 3 | **High** | The Activity Interpreter and the pace corpus return **opposite verdicts** on the same runs and the corpus wins. 08-06: Interpreter `no_evidence` / `PACE_AND_HR_EXIST_BUT_DEMONSTRATE_NOTHING`, corpus admits at 419.58 s/mi. 07-16: Interpreter `no_evidence`, corpus admits at 408.33 s/mi as the corpus's fastest observation, at `hrPct 0.9126` — **two band-widths below** `THRESHOLD_PCT_LTHR_BAND [0.95, 1.02]`, and equal to the resolved I-pace of 407. | §1b, §1h |
| 4 | **High** | Coaching Thesis primary limiter flips categorically (HIGH_INTENSITY ↔ THRESHOLD) on the **age of an unrelated VDOT anchor**, crossing between 9 and 10 days. Observed live across one night with no HI session run. Rule 9. | §3 |
| 5 | **Medium** | Two different answers to "which plan owned this day": `classifyStoredActivity` (active-plan-only) vs `classifyRecentActivities`/`loadKeySessionExecutions` (`ownedDaysSql`). AFC reads `RACE` in one and `null` in the other, which switches the belief-tension weaker arm on and off. | §5 |
| 6 | **Medium** | Rule 9 cliff: `THRESHOLD_MIN_SESSION_TOTAL_SEC = 1200`. 08-06's abandoned work phase is exactly 1200 s and is half the runner model; 08-04's identical abandoned work phase is 1161 s and does not exist. | §1h |
| 7 | **Medium** | Plan label overrides observed physiology in the capacity readers. 08-30's 44.4 min of `threshold_like` work in two blocks contributes zero threshold evidence because the plan called the day `long`. Over- and under-execution are structurally invisible to the Runner Model. | §4 |
| 8 | **Medium** | The consistency dimension (weight 0.20) is not Rule 8-filtered in **either** half of the adaptation split, including the half whose entire purpose is that filter. AFC race week and recovery week both count as plan misses. | §8 |
| 9 | **Low/Medium** | `hrConfoundWeight` and `reexaminationWeight` are computed all the way to `pressure` and then never read at the decision point (`accumulateReexamination` branches only on a count). A 97°F, no-HR-curve observation relaxes the bar exactly as hard as a clean one. | §2, §6 |
| 10 | **Low** | Belief tension is computed off the Interpreter's mile-split pace (444 s/mi) while the belief is built from the corpus's phase pace (421.8 s/mi). The mechanism is comparing two different quantities. | §7 |
| 11 | **Low** | `_activity_evidence.audit.test.ts` pins a live production row's data-quality state as a fact in prose and asserts a negative against it. It went red on an ordinary re-ingest. Rule 18. | §11 |
| 12 | **Low** | `classifyStoredActivity`'s plan lookup is `ORDER BY pw.id ASC LIMIT 1` — arbitrary on a multi-workout day. | §5 |
| 13 | **Note** | `resolveRaceExponent` fits over 5 races but only **2 distinct distances** (4 halves + 1 marathon). The long arm rests entirely on LA Marathon 2026. Not a bug; a stated fragility. | §1f |

## 13 · What is working well

- Decay-confidence-not-value: implemented exactly, verified numerically (§9).
- Goal isolation: no resolver can be handed a goal; `CAPACITY_RUN_FLOOR_MI = 3.0`
  is flat and evidence-only (the `goalRunFloorMiForUser` leak is gone).
- Readiness never touches capacity (§10).
- Environment modifies interpretation, never value; durability excludes heat
  rather than adjusting for it (§6).
- One race does not rewrite the runner: AFC moved the exponent 0.94% and the
  fit shrinks toward the population prior (§1f).
- Rule 16 held where checked: the thesis confidence, the threshold confidence
  and the shadow-log capacity belief are one number from one resolver.
- Taper days produce no negative findings at the Evidence Engine layer (§1e).
- `ownedDaysSql` reign attribution verified working on 08-04 and 08-06 (§5).
- Single-activity ceilings (`0.55` < `ANCHOR_MOVE_MIN_WEIGHT 0.60`) mean no one
  run ever moves an anchor alone — held on every run traced.
