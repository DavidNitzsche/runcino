# The PACE replay corpus — 13 hand-authored fixtures, run through the real engine

**Date:** 2026-09-01 · **Status:** a permanent regression corpus
(`web-v2/lib/adaptation/_pace_replay_corpus.test.ts`, 18 tests, part of
`npm test`), not a one-off script. Nothing here is a mock — every fixture is
run through the real, unmodified `composeAdaptation`
(`web-v2/lib/adaptation/adaptation-engine.ts`) and, where relevant, the real
`checkPaceHrCompatibility` (`web-v2/lib/adaptation/pace-hr-compatibility.ts`).

Explicit instruction this corpus follows: **do not build a general
synthetic-history platform.** Build a small, explicit, hand-authored corpus
at the real `AdaptationInput`/`AdaptationEngineInput` shape — the same
discipline `docs/reports/absorption-reader-split-2026-09-01.md` §4 used for
its own five synthetic fixtures the same night, applied here to the
Adaptation Engine's own decision layer instead of the absorption classifier
underneath it. Every fixture builder in the test file mirrors
`web-v2/lib/adaptation/_adaptation_engine.test.ts`'s own
`capacityAt`/`stateAt`/`absorptionAt`/`session`/`baseInput` helpers — there
is no shared fixture-builder module in this codebase, so this file follows
that file's own per-file convention rather than inventing one.

`web-v2/lib/adaptation/adaptation-engine.ts` and
`web-v2/lib/adaptation/shadow-compare.ts` were read in full for this task and
were **not modified** — another agent owns them tonight, per instruction.

---

## What "real engine" means for this corpus, precisely

- `composeAdaptation` is **pure** — every input is a plain value — so it is
  exactly the function `resolveAdaptationProposals`
  (`load-adaptation-engine.ts`) calls once it has finished the impure,
  database-bound work of assembling an `AdaptationEngineInput` from a real
  account. There is no exported `detectPace`; it is a private lever inside
  `composeAdaptation`, reached the same way every real caller (including
  `shadow-compare.ts`) reaches it — by reading the `target: 'PACE'` arm of
  `composeAdaptation`'s output. That is what this corpus calls, unmocked.
- `checkPaceHrCompatibility` is likewise pure and is called directly,
  unmocked, in every fixture that concerns pace/HR compatibility.
- `runPaceShadowCompareCycle` (`shadow-compare.ts`) is **not called** by this
  corpus. It wraps `resolveAdaptationProposals`, which queries Postgres —
  there is no way to hand it a synthetic `AdaptationEngineInput` without
  either mocking the database (defeating the point of "the real engine") or
  duplicating its DB-shell logic here, which is exactly the "general
  synthetic-history platform" this task was told not to build. **Fixture 10**
  below documents this gap directly rather than working around it with a
  mock.

---

## The 13 fixtures, with real engine output

All console lines below are copied verbatim from a real
`npx vitest run lib/adaptation/_pace_replay_corpus.test.ts --reporter=verbose`
invocation on 2026-09-01. All 18 tests pass; `tsc --noEmit` is clean;
`scripts/check-coercion.sh`, `check-swallowed-failure.sh`,
`check-automatic-mutations.sh` and `check-anchor-derivation.sh` all pass.

### 1 · Improving threshold capacity, controlled corroboration — a clean PROGRESS case

Believed capacity 388 s/mi, prescribed 400 s/mi, three controlled quality
sessions, every other lever silenced (no long-run evidence, no authored
progression block, load not yet absorbed) so PACE is the only candidate.

```
PROGRESS conf=0.800 [REPEATED_CONTROLLED_QUALITY_EXECUTION,CAPACITY_LEADS_PRESCRIPTION_BY_A_USEFUL_STEP,PACE_STEP_CLAMPED_TO_DOCTRINE_QUANTUM]
400->394 :: unphased 400->394 (step 6.0, MOVED)
"Your recent threshold work consistently supports faster training. Move 1 of 1
 upcoming phase of threshold/tempo/cruise work: unphased 6 sec/mi quicker
 (1 row, 2026-09-01–2026-09-01)."
```

Confirms the baseline case is genuinely reachable and clamps to the
doctrinal quantum (6 s/mi) rather than jumping the full 12 s/mi gap.

### 2 · Apparently improving pace during taper/recovery — is the engine fooled?

Two sub-cases, both against a TAPER phase priced 475 s/mi, believed capacity
430 s/mi (a real 45 s/mi apparent gap — enough to look like a strong signal
if the engine were careless about corroboration).

**2a · one fast taper "sharpener" session is not corroboration:**

```
INSUFFICIENT_EVIDENCE conf=0.800 [SINGLE_STRONG_SESSION_IS_NOT_CORROBORATION]
475->475 :: TAPER 475->475 (step 0.0, held)
"Threshold pace holds. 1 of the last 1 quality sessions held together;
 3 are needed before the target moves."
```

One controlled, genuinely fast session inside the taper does **not** move
the target — the corroboration bar (`PACE_PROGRESS_MIN_SESSIONS = 3`) holds
regardless of how good that single session looked.

**2b · corroborated via the real lookback extension into the pre-taper block:**

```
stalenessFactor=0.690
PROGRESS conf=0.552 [REPEATED_CONTROLLED_QUALITY_EXECUTION,CAPACITY_LEADS_PRESCRIPTION_BY_A_USEFUL_STEP,
  PACE_STEP_CLAMPED_TO_DOCTRINE_QUANTUM,LOOKBACK_EXTENDED_PAST_A_PRESCRIBED_PERIOD,CONFIDENCE_DISCOUNTED_FOR_EVIDENCE_AGE]
475->466 :: TAPER 475->466 (step 9.0, MOVED)
```

Add two more controlled sessions from five to six weeks before the taper
(dated 2026-07-05/07-08, read against `today = 2026-08-20`) and the proposal
now clears corroboration and moves — but `stalenessFactor` is computed by
the **real** `evidenceStalenessFactor` function
(`lib/training/normal-window.ts`), not hand-picked, and it discounts
confidence from the undiscounted 0.8 to 0.552 (0.8 × 0.690) rather than
treating six-week-old evidence as if it were fresh. **Answer: no, the engine
is not fooled** — a taper's own reduced quality volume either starves the
evidence entirely (2a) or, when genuine corroboration exists further back,
is honestly discounted for its age (2b), never silently treated as current
proof.

### 3 · Old evidence crossing the staleness boundary — a real, walked half-life

Three fixed session dates (2026-08-01/03/05) and four adjacent synthetic
`todayISO` values, chosen so the **median age** of the evidence — the exact
quantity `evidenceStalenessFactor` keys on — crosses the 28-day base window
one day at a time. `stalenessFactor` is computed by the real function at
each date, not asserted by hand:

```
[2026-08-30 · median age 27] stalenessFactor=1.0000  PROGRESS conf=0.800
[2026-08-31 · median age 28] stalenessFactor=1.0000  PROGRESS conf=0.800
[2026-09-01 · median age 29] stalenessFactor=0.9755  PROGRESS conf=0.780
[2026-09-08 · median age 36] stalenessFactor=0.8203  PROGRESS conf=0.656
```

**Reading this literally:** the boundary itself (median age 27 → 28)
produces *zero* change — the discount is `pow(0.5, max(0, median − 28)/28)`,
so nothing happens until the median genuinely exceeds the base window. One
day past it (median 29), the discount is small (0.9755) and continuous, not
a jump; a week further out (median 36) it has grown smoothly to 0.8203.
Every evaluation date stays `PROGRESS`-eligible throughout — **the boundary
is a confidence gradient, never a behavioural cliff**, matching CLAUDE.md
Rule 9 ("a hair's difference in input must never produce a categorically
different plan"). Confidence tracks `0.8 × stalenessFactor` exactly at every
one of the four dates, asserted in the test, not eyeballed.

### 4 · Insufficient evidence, correctly distinct from a real HOLD

Same session *count* (2 controlled sessions, one short of the 3-session
bar) produces two different, correctly-distinguished decisions depending on
whether a third session exists and argues against the proposal:

**4a · nothing arguing against — an absence:**

```
INSUFFICIENT_EVIDENCE conf=0.800 [SINGLE_STRONG_SESSION_IS_NOT_CORROBORATION]
400->400 :: "Threshold pace holds. 2 of the last 2 quality sessions held
together; 3 are needed before the target moves."
```

**4b · a third session exists and beat the target without control — a finding:**

```
HOLD conf=0.800 [EXECUTION_BEAT_TARGET_WITHOUT_CONTROL,SINGLE_STRONG_SESSION_IS_NOT_CORROBORATION]
400->400 :: "Threshold pace holds. 2 of the last 3 quality sessions held
together; 3 are needed before the target moves."
```

The distinction is real, not cosmetic: `contradictionsIn` asserts (in the
engine's own §7 contradiction checker) that an `INSUFFICIENT_EVIDENCE`
proposal may never carry a "finding" reason code
(`EXECUTION_BEAT_TARGET_WITHOUT_CONTROL`, `ABSORPTION_POOR`, etc.) — Rule 11's
"don't know / measured zero / the read failed are three facts, never one,"
applied structurally rather than left to a reviewer's eye.

### 5 · Conflicting pace and HR evidence — the compatibility validator refuses

Same clean PROGRESS proposal as Fixture 1 (400 → 394 s/mi), but its three
backing sessions ran 13–15 bpm over the runner's own Z4 (Threshold) ceiling
with no temperature logged to explain it:

```
INCOMPATIBLE_REFUSE mayProceed=false band=160-167
"3 of the 3 controlled sessions backing this pace proposal ran 13, 14, 15 bpm
 over the runner's own Z4 ceiling (160-167 bpm) with no heat confounder to
 explain it. The pace this proposal asks for is not one the runner's own HR
 evidence agrees he can hold at threshold effort — refuse the pace step
 rather than silently moving HR to fit it."
```

Exactly the case `docs/PRODUCT_DECISIONS.md` 2026-09-01 §3 requires a
validator for: pace capacity evidence and cardiovascular evidence
independently resolved, and disagreeing.

### 6 · Heat-explained HR elevation — compatible, not penalized

Same shape, but the three sessions ran at 85°F, which
`heatHrBumpBpm(85) ≈ 14 bpm` fully covers against an 11 bpm overage:

```
COMPATIBLE_ENVIRONMENTAL_EXPLAINED mayProceed=true band=160-167
"3 session(s) ran hot relative to the Z4 ceiling, but the heat confounder
 (Research/03's own table) explains the overage. This is a same-day
 readiness/environment fact, not a capacity-belief change — HR stays where
 it is and the pace proposal is not penalized for a hot morning."
```

### 7 · Stale HR guidance — an advisory, never a silent auto-correction

Three sessions all read 8–10 bpm under the Z4 floor (160 bpm) — well past
the `STALE_CEILING_UNDERSHOOT_BPM = 5` bar:

```
COMPATIBLE_HR_CEILING_LIKELY_STALE mayProceed=true band=160-167
"3 controlled sessions backing this pace proposal all ran well under the
 runner's own Z4 floor (160 bpm). The pace proposal is compatible and
 proceeds — but this pattern is the HR owner's evidence to act on (LTHR
 re-anchor), not a side effect of this pace change. LTHR owner's own read:
 hold (below the re-test cadence but trending low)"
```

The pace proposal proceeds unblocked, and the LTHR staleness is surfaced as
an advisory that echoes whatever `lthr-reanchor.ts` already believes — this
validator never re-anchors LTHR itself, exactly as its file header commits
to.

### 8 · A phase already faster than the proposed capacity holds — the RACE-SPECIFIC bug pattern, replayed

The exact three-phase shape from the owner's real account
(`docs/reports/pace-shadow-compare-2026-09-01.md` Part 1): QUALITY 435,
RACE-SPECIFIC 424, TAPER 475 s/mi, believed capacity 430 s/mi.

```
PROGRESS 435->430 :: QUALITY 435->430 (step 5.0, MOVED);
  RACE-SPECIFIC 424->424 (step 0.0, held); TAPER 475->466 (step 9.0, MOVED)
"Move 2 of 3 upcoming phases of threshold/tempo/cruise work: QUALITY 5 sec/mi
 quicker (6 rows, 2026-09-01–2026-10-13); TAPER 9 sec/mi quicker
 (2 rows, 2026-11-17–2026-11-24)."
```

RACE-SPECIFIC — already priced 6 s/mi **faster** than believed capacity —
reports `moved: false`, unchanged at 424, never dragged along by QUALITY's
or TAPER's own gains. This is the exact bug the Part 1 fix
(`pace-shadow-compare-2026-09-01.md`) closed, replayed here as a permanent
regression fixture rather than a one-time verification.

### 9 · Taper deliberately slower than capacity — held / clamped, never read as under-performance, walked across its own start boundary

Three adjacent dates: the day before taper starts (QUALITY phase still
ahead, corroborated), the day taper starts (only TAPER remains in the
authored phases, no fresh quality work prescribed inside it yet), and five
days further in.

```
[2026-08-15] PROGRESS  QUALITY 435->430 (step 5.0, MOVED); TAPER 475->466 (step 9.0, MOVED)
[2026-08-16] INSUFFICIENT_EVIDENCE [NO_QUALITY_EVIDENCE_IN_WINDOW]  TAPER 475->475 (step 0.0, held)
[2026-08-20] INSUFFICIENT_EVIDENCE [NO_QUALITY_EVIDENCE_IN_WINDOW]  TAPER 475->475 (step 0.0, held)
```

Two invariants hold at every one of the three dates, asserted directly:
**the TAPER phase's own decision is never `REDUCE`**, and **its proposed
pace is never slower than its previous pace** — the engine never treats
TAPER's deliberate 45 s/mi gap to capacity as evidence *against* the runner.
Before the boundary, TAPER is included in a genuine PROGRESS and nudged by
its own small clamped step (9 s/mi, not the full 45); after the boundary,
with no fresh quality evidence to read, it sits flat via an
`INSUFFICIENT_EVIDENCE` refusal — an absence, never a finding. The
transition itself introduces no discontinuity in decision *kind* (never
flips to `REDUCE` or `HOLD`-with-a-finding at the boundary), which is the
concrete answer to "should hold, not be treated as under-performance."

### 10 · A young plan not yet reanchored canonically — the convergence guard this needs does not exist yet

`web-v2/lib/adaptation/shadow-compare.ts` was read in full for this task. It
has **no function today** that reads `training_plans.authored_iso` or
compares it against the last successful `reanchorActivePlan` run —
confirmed by reading the file end to end, not by a grep that could miss a
differently-named helper. `docs/reports/pace-shadow-compare-2026-09-01.md`
§3 names this exact gap explicitly: *"add a cheap guard (not built tonight,
out of scope per the brief) that flags a shadow-compare record when the
active plan's `authored_iso` is more recent than the last successful
`reanchorActivePlan` run for that plan — the same 'is this plan too young to
judge' pattern `detectVolume` already uses for
`CURRENT_PLAN_TOO_YOUNG_TO_JUDGE_ABSORPTION`."* `docs/PRODUCT_DECISIONS.md`
2026-09-01 §2 lists "an explicit decision on how authoring and recomputation
converge onto one brain" as one of the items **required before live PACE
authority is even reconsidered** — still open as of this report.

What this fixture does honestly, in the absence of that guard: it
constructs the exact contaminated shape the report describes — a phase's
`prescribedSecPerMi` still priced by the pre-migration cascade
(`generate.ts`'s VDOT path, 462 s/mi) while `capacity.threshold` already
reflects the canonical resolver (430 s/mi) — and shows the real engine's
output today:

```
PROGRESS conf=0.800 462->454 :: QUALITY 462->454 (step 8.0, MOVED)
"Your recent threshold work consistently supports faster training..."
```

`composeAdaptation` proposes `PROGRESS`, structurally indistinguishable from
Fixture 1's genuine case, because it has no field through which "two brains
pricing the same phase differently" could be told apart from "the runner
genuinely got faster" — that distinction lives one layer up, in whichever
service would resolve the authoring/recomputation convergence question, and
today nothing does. This is not a defect in `composeAdaptation` (capacity
resolution and the decision layer are deliberately different owners, per
its own file header) — it is the concrete shape the still-open convergence
guard needs to close. **This fixture is marked ready for when that guard
lands**: re-running it with a synthetic "plan authored after the last
reanchor" flag should flip this to a refusal or an explicit contamination
flag once the guard exists; today it cannot, and the test asserts the
*current* (gap-exposing) behavior rather than the desired future one, so it
will need updating — not silently passing — the day the guard ships.

### 11 · A stable HOLD — evidence genuinely doesn't support progression, and stays that way

Capacity and sessions that *would* corroborate a PACE move, but absorption
reads `poor`:

```
HOLD conf=0.800 [ABSORPTION_POOR]
400->400 :: "Threshold pace holds while the block is not being absorbed."
```

Run three independent times against the identical input. All three are
asserted `toEqual` after stripping only the `resolvedAt` timestamp — a pure
function of its inputs, proven rather than assumed, mirroring
`pace-shadow-compare-2026-09-01.md`'s own determinism proof but applied to
a HOLD instead of the one PROGRESS case that report demonstrated.

### 12 · Downward or restructure pressure — three distinct grounds, none of them a simple upward pace move

**12a · a session displaced by life, a clear slot open — `RESTRUCTURE`/`SCHEDULE`:**
`"1 session sat out of place this week. Move 1 into the clear days rather
than dropping the stimulus."`

**12b · marginal absorption, no safety trigger — `RESTRUCTURE`/`SPECIFICITY`:**
`"The work is being completed but not absorbed cleanly. Change the kind of
quality rather than the amount of it."`

**12c · state argues reduce — `REDUCE`/`RECOVERY`, ranked ahead of everything else:**
Built with the *same* evidence as Fixture 1 (capacity that would earn a PACE
PROGRESS), plus a `reduce`-arguing state. The safety reduction is promoted
first, and the earned PACE progression is not silently dropped — it is
demoted to an explicit `HOLD` naming the state
(`STATE_SAYS_TODAY_IS_NOT_THE_DAY`), per Rule 21 ("a lever that can only
ever fail to fire is the Rule 21 defect wearing a different hat" — here the
opposite failure mode, an earned progression vanishing without a trace, is
checked directly).

### 13 · An extreme stated-goal change — capacity belief and the proposal are byte-identical

`AdaptationEngineInput` (`adaptation-engine.ts` §3) has no goal field at
all, and `_NoGoalInInput` (§7) is a compile-time assertion that adding one
is a build error — the file's own header cites this as "the service which
cannot see the goal cannot train toward it." This fixture demonstrates the
*runtime* consequence: the identical input, run through `composeAdaptation`
twice, once narrated as "under a stated 5K goal" and once as "under a stated
100-mile ultramarathon goal" — comments only; there is no parameter through
which either goal could reach the function:

```
[F13 goal-invariant]
PROGRESS 400->394 :: ... == PROGRESS 400->394 :: ...
```

Asserted `toEqual` (stripping only `resolvedAt`) rather than eyeballed.
This is the same class of proof
`docs/reports/capacity-boundary-fix-2026-09-01.md` already ran at the
**capacity resolution** layer (`vdotRunFloorMi`/`goalRunFloorMiForUser` in
`vdot.ts`, a 5K-vs-marathon swap against `bestRecentVdot`'s admissibility
floor) — this fixture is the complementary proof at the **decision** layer
one step downstream, using an even more extreme swap (5K vs. ultramarathon),
confirming the "goal cannot move capacity or the resulting proposal"
guarantee holds at both owners the doctrine separates it across, not just
the one already checked.

---

## Multi-date walks — what they are, and what they explicitly are not

Fixtures 3 and 9 each evaluate the *same* underlying shape at 2–4 adjacent
**synthetic** `todayISO` values, constructed in-process in milliseconds.
This is legitimate **boundary-behavior testing**: it exercises the real
`evidenceStalenessFactor` half-life function and the real `phaseStep`/
`detectPace` logic across the exact inputs that change as a clock advances,
and it genuinely proves the mechanisms are continuous (Rule 9) rather than
cliff-edged at their own stated cutoffs.

**It is not, and does not substitute for, production shadow observation
over real elapsed days.** `docs/reports/pace-shadow-compare-2026-09-01.md`
§2 named that gap explicitly the same night this corpus was built:

> "The decision doc asks for 'day-to-day stability across repeated daily
> evaluations,' which genuinely needs real elapsed days the cron has not
> had yet — that evidence does not exist tonight and I am not fabricating
> it."

That statement still stands, unchanged, after this corpus. A synthetic date
walk can prove a function's behavior is continuous and correctly reasoned
across its own stated boundaries — median evidence age, a taper's start
date — because those are properties of the function and its declared
inputs, checkable in isolation. It cannot prove that a real runner's actual
week-to-week training, with all its correlated real-world noise (illness,
weather, life), produces a stable sequence of daily proposals over real
elapsed time. Those are different claims. This report makes only the first
one.

---

## What this corpus proves, and what it does not

**Proves:**

- `composeAdaptation` and `checkPaceHrCompatibility` — the real, unmodified
  functions — produce the documented decision on 13 explicit,
  hand-authored `AdaptationEngineInput`/`HrCheckedSession` shapes, each
  chosen to isolate one named behavior from the brief (clean PROGRESS,
  taper corroboration, staleness decay, the INSUFFICIENT_EVIDENCE/HOLD
  split, all three HR-compatibility branches, the RACE-SPECIFIC hold
  pattern, the TAPER hold pattern, REDUCE/RESTRUCTURE pressure, and
  goal-invariance).
- Two of those shapes are additionally walked across 2–4 adjacent synthetic
  evaluation dates, showing the specific mechanisms involved
  (`evidenceStalenessFactor`, the taper-boundary phase read) are continuous
  rather than cliff-edged — real boundary-behavior evidence, honestly
  scoped as exactly that.
- All 18 tests are permanent, `npm test`-visible regressions, not a
  one-off report artifact — a future change to `phaseStep`, the
  corroboration bar, or the HR-compatibility thresholds that breaks one of
  these 13 documented behaviors will fail loudly, not silently.

**Does not prove:**

- That these exact shapes occur with any particular frequency in real
  training, or that `load-adaptation-engine.ts` — the impure database shell
  — correctly assembles these shapes from raw activity data. That is
  `_adaptation_engine.audit.test.ts`'s job, against the one real account
  this database holds.
- Multi-day production stability. See "Multi-date walks" above — still a
  separately-needed, not-yet-available piece of evidence, per
  `pace-shadow-compare-2026-09-01.md` §2.
- That the authoring/recomputation convergence guard (Fixture 10) behaves
  correctly — it does not exist yet. Fixture 10 documents the gap and its
  exact shape; it does not close it.
- Anything about `shadow-compare.ts`'s own database-bound persistence or
  cron-wiring correctness, which this corpus deliberately does not touch
  (see "What 'real engine' means," above) to avoid building the
  general-purpose synthetic-history/mocking platform this task explicitly
  ruled out.

---

## Files touched

- `web-v2/lib/adaptation/_pace_replay_corpus.test.ts` — new. The corpus:
  13 fixtures, 18 tests, all passing, DB-free, part of `npm test`.
- `docs/reports/pace-replay-corpus-2026-09-01.md` — this report.

No file owned by another agent tonight (`adaptation-engine.ts`,
`shadow-compare.ts`, `pace-hr-compatibility.ts`, `lib/plan/generate.ts`) was
modified — each was read, in full, where this task needed to cite or reuse
it.

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run lib/adaptation/_pace_replay_corpus.test.ts` — 18/18
  passing.
- `npx vitest run lib/adaptation --exclude '**/*.audit.test.ts'` — 148/148
  passing (no regression in the adjacent suites).
- `scripts/check-coercion.sh`, `scripts/check-swallowed-failure.sh`,
  `scripts/check-automatic-mutations.sh`,
  `scripts/check-anchor-derivation.sh` — all pass.
