# Race Prediction — goal-projection durability follow-up, 2026-09-01

Follow-up to `docs/reports/race-prediction-consolidation-2026-09-01.md` §4.1,
itself executing against `docs/reports/race-prediction-external-review-2026-08-31.md`
open question #2 ("should race prediction be rebuilt on
`durability-anchor.ts` directly"). Scope, per §4.1's own recommendation:
wire `durability-anchor.ts#resolveRaceExponent` into
`lib/training/goal-projection.ts#computeGoalProjection`'s cross-distance
projection (`vdotProjectionSec`, `trajectory.projectedSec`) — the plan
engine's central trajectory input, which feeds the drift cron, the
simulator, and the adaptation loop — the same way
`lib/race/coach-goal.ts#projectWithDurabilityExponent` already does for the
coach-set A/B/C tiers, with a confidence floor "set honestly" against real
evidence rather than invented.

All numbers under "Verified" were read from the live production database
(read-only) against the owner's real account, per CLAUDE.md Rule 13 — not a
fixture, not a mock.

---

## 1. The gate before starting: concurrent edit

Per this task's own instruction, `git status` was checked first.
`web-v2/lib/training/goal-projection.ts` was under live, active edit by
another interactive session ("Marathon plan generation review", root
checkout) for the entire early part of this work — its own uncommitted diff
touched `contiguousWorkWindowMi`/`blendedExpectation` (a by-feel recovery-jog
accounting fix, unrelated to cross-distance projection). Work proceeded in
an isolated worktree (`.claude/worktrees/durability-goal-projection`,
branched from `main` at `cdc77c89`) rather than in the shared root checkout,
avoiding any collision with that session's in-progress work. Once that
session's commit (`28ceac34`, "warm-up/cool-down read as a ceiling, quality
reps as a band, the between-rep jog goes by feel") landed on `main` and the
tree went quiet, this work's diff was rebased forward with `git apply
--3way` (clean, no conflicts — the two changes touch disjoint functions in
the same file) and re-verified in the root checkout before finishing.

---

## 2. The threshold question — answered by rejecting the premise

The task's own brief anticipated a confidence *threshold*: fall back to
Daniels when the durability read "refuses or its confidence is too low to
prefer over the table," with the cutoff "set honestly... by running it
against the real archetype sweep / golden-runner fixtures."

**Two things were checked before picking a number, and both argue against a
threshold at all:**

### 2.1 No existing corpus reaches this function (Rule 15)

`lib/plan/_sweep_allusers.test.ts` (the archetype sweep; ~7680 archetypes
graded against a research answer key) and its extracted corpus generator
`lib/plan/sim-matrix.ts` were read in full and grepped for
`computeGoalProjection`, `goal-projection`, and `durability`. **Zero
matches.** The sweep exercises `lib/plan/generate.ts`'s plan-composition
function only — it never calls `computeGoalProjection`, never touches the
`races` table `resolveRaceExponent` reads, and its `Arc` type's
`raceHistory` field (added 2026-08-30's HIST-1 fix, itself locked by
CLAUDE.md Rule 15 for exactly this reason on a different mechanism) is
irrelevant here because the sweep's whole subsystem doesn't reach
`computeGoalProjection` at all — not "the fixture type can't express race
history," a stronger finding than the task's own framing anticipated. A
threshold "tuned against the archetype sweep" would have been tuned against
nothing: there was no dial connected to anything.

`lib/training/prescription-resolver.ts`'s "golden runner" fixtures
(`_prescription_resolver.test.ts`) were checked next — the pace-prescription
side's own durability consumer. Also unrelated: different subsystem,
different question (what pace to run in training, not what time to project
on race day).

### 2.2 The codebase already has an argued answer for this exact shape, and it isn't a threshold

`lib/training/prescription-resolver.ts#confidencePosition` (reused by
`capacity-resolver.ts`'s durability-aware pace windows) is the established,
already-shipped pattern for "a downstream consumer with no human
confidence-reading step blends a durability-corrected value with a
population fallback." Its own doc comment states the reasoning directly:

> "CONTINUOUS AND MONOTONE (Rule 9). Every widening below is a linear
> function of `1 - position`, so no prescription changes in KIND across a
> threshold on a continuous quantity."

This is precisely CLAUDE.md Rule 9's own concern, already solved once in
this codebase for the sibling durability consumer. `coach-goal.ts`'s
`projectWithDurabilityExponent` usage is a *hard* on/off (any `ok: true`
read wins outright) — but that's defensible specifically because a human
reads `personalExponentConfidence` next to the number before trusting it
(the coach-set tile). `computeGoalProjection`'s trajectory has no such human
step: it feeds `resolveRaceProjection` → the Races list, the race detail
screen, the drift cron's rebuild trigger, and the simulator, automatically.
A hard threshold there means a runner whose confidence crosses 0.50 today
sees the projection jump discontinuously between two different models
overnight — manufacturing exactly the cliff Rule 9 exists to forbid, for a
runner who did nothing to deserve a jump.

**Decision: no threshold. A continuous confidence-weighted blend.**
`vdotProjectionSecRaw = weight · durabilityProjectionSec + (1 − weight) ·
danielsProjectionSec`, where `weight = durabilityRead.confidence` directly
— already a 0..1 evidence+freshness score on its own documented scale
(`durability-anchor.ts`'s own header: "Decay moves CONFIDENCE, never
`value`"), reused as-is rather than remapped onto `capacity-resolver.ts`'s
DIFFERENT `CAPACITY_CONFIDENCE_BANDS` scale (checked and rejected — that
scale is calibrated for `capacity-resolver.ts`'s own multi-source blend
semantics, not `RaceExponentRead.confidence`'s; reusing the NUMBER without
reusing the SCALE it's calibrated against would be the two-computed-
quantities mismatch Rule 16 warns about, not a fix for it). Zero invented
constants. At `weight = 0` (refused read, or `RaceExponentRead.confidence`
genuinely at its floor) the formula reduces to the untouched Daniels-only
value exactly; at `weight = 1` it reduces to the pure durability projection
exactly. Every value in between is a linear interpolation — continuous by
construction, not by tuning.

---

## 3. What was built

### 3.1 `durability-anchor.ts` gains `projectWithDurabilityExponent`

Relocated from `lib/race/coach-goal.ts`, where it was first built
2026-09-01 for the earlier consolidation pass. `coach-goal.ts` imports
`marathonSpecificityAdjustment` from `goal-projection.ts` — importing
`coach-goal.ts` into `goal-projection.ts` to reuse the function would have
created a circular module dependency. Moving the (already pure,
dependency-free) function to `durability-anchor.ts`, the file that already
owns `RaceExponentRead` and `resolveRaceExponent`, resolves the cycle and is
arguably its more natural home regardless. `coach-goal.ts` now imports and
re-exports the same name — its own call site and `coach-goal-durability
.test.ts`'s import needed zero edits. Same function, same shape, one name,
two canonical callers now (Rule 16).

**Consequence discovered, not anticipated:** this scanner
(`lib/audit/coercion-registry.ts`) treats `lib/training` as an "engine
directory" (load-bearing) and `lib/race` as peripheral. The function's
`t > 0 ? {...} : null` ternary — unchanged — genuinely *reclassifies* on the
move, from peripheral to load-bearing, because it is now reachable from a
load-bearing consumer (`goal-projection.ts`) as well as the peripheral one
(`coach-goal.ts`). `PERIPHERAL_BASELINE` moves 182 → 181;
`LOAD_BEARING_KNOWN` gains
`lib/training/durability-anchor.ts::projectWithDurabilityExponent::t`, with
a full argued account in the registry (Rule 18/20 discipline) — the ternary
degrades to the exact same honest Daniels-only fallback a refused read
already produces, never a fabricated confident number.

### 3.2 `goal-projection.ts#computeGoalProjection`

- Fetches `durabilityRead = await resolveRaceExponent(userUuid)` in
  parallel with the existing conditional `marathonSpecificTraining` load
  (both independent `userUuid`-keyed reads). `.catch()` degrades to the
  same typed `{ ok: false, reason: 'no_races', races: 0 }` refusal
  `resolveRaceExponent` itself returns for "no races" — a query failure and
  "this runner has no qualifying races" are indistinguishable from this call
  site regardless, so nothing is lost by collapsing them here (documented in
  the code; this call site has no way to tell them apart the way
  `coach-goal-load.ts`'s own fix in the prior consolidation pass could,
  because that fix controlled the query directly).
- Computes the blend described in §2.2 for `vdotProjectionSecRaw`, gated
  first on `vdot != null` (a genuinely null VDOT is this file's own existing
  cold-start contract — durability alone was deliberately NOT made
  sufficient to project without it, unlike `coach-goal.ts`'s A/B/C tiers,
  because everything downstream here — the trajectory, the drift status
  ladder — already assumes a real VDOT exists).
- Everything downstream of the raw blend — the marathon-specificity +5%
  adjustment, the confidence interval/band, the staleness check — is left
  reading the **original** `vdotAnchorDistanceMi`/`vdotAnchorDateISO`, not
  the durability projection's own anchor race. This is a deliberate scope
  boundary, not an oversight: because the blend is continuous rather than a
  hard swap, the OUTPUT number is always a *mix* of both bases, so switching
  the categorical downstream logic (which marathon-specificity band applies,
  which staleness check fires) to track whichever input currently has more
  weight would reintroduce exactly the cliff the blend was built to avoid —
  a discrete input (which anchor "wins") driving a discrete band, jumping in
  and out of applicability as confidence crosses a boundary, even though the
  seconds value itself moves smoothly. `coach-goal.ts`'s hard-swap design
  can safely re-point its anchor because it never has a "mixed" state to
  misrepresent; this design does. Recommendation for a later pass, not built
  here: if this boundary is ever revisited, it should reason about a
  *blended* anchor distance and staleness read, not a discrete swap.
- New field: `GoalProjection.durabilityBlend: { weight: number;
  anchorDistanceMi: number } | null` — purely additive (checked: no test in
  the repo does a deep-equal snapshot of the full `GoalProjection` shape),
  null exactly when the read refused or `vdot` is null, non-null (including
  at `weight` near 0) whenever a durability read was genuinely consulted —
  Rule 11: "thin evidence" and "no read attempted" are different facts.

### 3.3 `fitness-trajectory.ts#projectFitnessTrajectory`

This module is imported by a client component (`GapPanel.tsx`, stated in
its own file header) and therefore must stay free of any server-only
import — `durability-anchor.ts` imports `pg` via `@/lib/db/pool`. So the
durability read is resolved and blended entirely in `goal-projection.ts`
(already server-only) and handed in as a new, optional, **plain-data**
parameter: `currentSecOverride?: number | null`.

`trajectory.currentSec` honors the override when supplied.
`trajectory.projectedSec` then preserves the SAME relative improvement the
existing VDOT-space training-response model already computed
(`danielsProjectedSec / danielsCurrentSec` — a ratio, not a re-derivation)
on top of the corrected baseline, rather than inventing a "projected
durability" reading, which has no real anchor to fit: there is no race
result for a day that hasn't happened yet. This keeps the entire VDOT-space
model (gain rate, execution quality, plan ceiling — Research/01-grounded
temporal reasoning about *when* fitness changes, an orthogonal question to
durability's *cross-distance shape* question) completely untouched; only
the final distance conversion is corrected. `gapSec`, `aheadOfGoal`
(including its `goalBelowTable` branch, which reads `gapSec` directly), and
every VDOT-space field (`currentVdot`, `projectedVdot`, `gapVdot`,
`reachable`) all stay internally consistent because they are recomputed
from the corrected `currentSec`/`projectedSec` in the same pass — no
post-hoc field overriding, which would have risked exactly the kind of
silent inconsistency Rule 9 warns about.

`currentSecOverride` omitted/null is proven byte-identical to the function's
prior behavior (`x · (y/x) = y` algebraically, confirmed exactly by test —
see §4).

`goal-projection.ts` reuses the SAME blended value it computes for
`vdotProjectionSecRaw` as this override, rather than resolving durability a
second time inside the trajectory call — `projectFitnessTrajectory`'s own
internal `predictRaceTime(currentVdot, raceDistanceMi)` was already
byte-identical to that quantity's Daniels-only half (same `vdot`, same
`raceDistanceMi` — a pre-existing duplication this file already had, now
kept in sync instead of left to drift into two different answers, rather
than a new one introduced by this change).

---

## 4. New tests

`lib/training/fitness-trajectory-durability.test.ts` (7 tests, pure
function, no DB) — the `currentSecOverride` arithmetic in isolation:
omitted-override regression identity, ratio-preservation in both directions
(slower and faster corrections), `gapSec` recomputation, VDOT-space fields
left untouched, and a continuity walk sweeping the override across 400
seconds in 20 steps asserting monotonicity and no single-step jump beyond
noise.

`lib/training/goal-projection-durability.test.ts` (6 tests, DB-mocked,
mirrors `goal-projection-ahead.test.ts`'s established mocking pattern) — the
wiring, cross-checked against direct calls to `resolveRaceExponent`/
`projectWithDurabilityExponent` (not a hardcoded expected number): no-races
regression identity for both `vdotProjectionSec` and `trajectory.currentSec`;
an exact blend-formula match against independently-computed expected values
for a real 5-race fixture shaped on the account this app runs against;
internal consistency between `vdotProjectionSec` and `trajectory.currentSec`;
graceful degrade outside Riegel's validity window (a 50K target); and a
continuity check across two REAL evidence shapes (thin 2-race vs. rich
5-race) proving richer evidence produces higher weight and proportionally
more movement — this doubles as the corpus Rule 15 asks this mechanism to
have, since `_sweep_allusers.test.ts` supplies none (§2.1).

All pre-existing suites this touches were re-run and are unaffected:
`goal-projection.test.ts`, `goal-projection-ahead.test.ts`,
`goal-projection-belowtable.test.ts`, `_race_projection.test.ts`,
`_goal_immutability.test.ts`, `coach-goal.test.ts`,
`coach-goal-durability.test.ts`, `_race_authority_durability.test.ts`,
`fitness-trajectory-belowtable.test.ts`, plus the full `lib/training`,
`lib/plan`, `lib/race`, `lib/coach`, `lib/fitness`, `lib/doctrine`, and
`lib/audit` trees: **4889 passed, 10 intentionally skipped, 0 newly
failing.** Two pre-existing failures remain
(`lib/plan/progression-spec.ts`'s coercion site,
`lib/training/coaching-thesis.ts`'s orphan-module gate) — confirmed, by
stashing this diff and re-running, to be already red on `main` at
`cdc77c89` before this work started, from commit `455476c2` ("the smallest
real Coaching Thesis"), entirely unrelated to race prediction and already
named as such in the prior consolidation report. `tsc --noEmit` is clean.

---

## 5. Verified for real, against David's live account (`0645f40c-951d-4ccc-b86e-9979cd26c795`)

Read live from the production database (read-only), David's real CIM goal
(3:00:00 marathon, 2026-12-06, 97 days out at read time):

`resolveRaceExponent` returns the same read the prior consolidation report
verified: `ok: true, value: 1.0869, confidence: 0.6228, evidenceScore:
0.6551, races: 5, distinctDistances: 2` (Rose Bowl Half, Disney Half, LA
Marathon, Sombrero Half, America's Finest City Half).

| | vdotProjectionSec | gap to 3:00:00 goal |
|---|---|---|
| Old (Daniels-only, `predictRaceTime(46.3, 26.22)`) | 12203s = **3:23:23** | 23:23 |
| Pure durability projection (LA Marathon anchor, exponent 1.0869) | 12701s = **3:31:41** | 31:41 |
| New (blended, weight 0.6228) | 12513s = **3:28:33** | 28:33 |

**310 seconds (5m10s) slower/more honest** than the old Daniels-only
number, on the one live account this app runs against — reflecting real
evidence: this runner's own graded marathon and half-marathon results (5
races, 2 distinct distances) say his cross-distance fade is worse than the
population 1.06 Riegel exponent the old path assumed.

| | trajectory.projectedSec | gap to goal |
|---|---|---|
| Old (pure Daniels, `predictRaceTime(projectedVdot 47.8, 26.22)`) | 11881s = **3:18:01** | 18:01 |
| New (durability-corrected baseline, same modelled gain ratio preserved) | 12183s = **3:23:03** | 23:03 |

**302 seconds (5m2s) slower/more honest.** (The old-trajectory number,
11881s, independently reproduces the prior consolidation report's own §2.2
"New (resolved via canonical `resolveRaceProjection`)" figure exactly — a
useful cross-check that this read is landing on the same live number that
report already validated for the goal-gap fix, computed via a completely
different code path here.)

`status` reads `off-track` either way — this fix does not flip the ladder,
it corrects how far off-track the honest number says he is, which is
exactly the trajectory the drift cron's rebuild trigger and the simulator
both read.

---

## 6. Deferred, with a decision — not guessed at

**The specificity-adjustment/staleness anchor boundary (§3.2).** Left
reading the original VDOT anchor rather than the durability projection's
own anchor race, on purpose — see the reasoning there. Revisit only if a
later pass needs a blended-anchor read for that logic too.

**A dedicated projection-focused archetype corpus.** §2.1 confirms
`_sweep_allusers.test.ts` cannot exercise this mechanism at all — it is a
different subsystem (plan composition, not runtime trajectory). Building a
parallel corpus (many synthetic accounts with race histories, feeding
`computeGoalProjection` across a spread of confidence/evidence shapes,
`HIST-1`-style) is real, standalone infrastructure work, not a drive-by
inside this task. The new `goal-projection-durability.test.ts` fixtures
(thin vs. rich real-evidence shapes) are the corpus this mechanism has
today; recommend a dedicated sweep only if this integration point sees
enough future churn to warrant one.

---

## 7. Files touched

- `web-v2/lib/training/durability-anchor.ts` — gains
  `projectWithDurabilityExponent` (relocated) + its Riegel-window constants.
- `web-v2/lib/race/coach-goal.ts` — imports + re-exports the relocated
  function; header comments updated.
- `web-v2/lib/training/goal-projection.ts` — durability read, continuous
  blend, `durabilityBlend` field, trajectory wiring.
- `web-v2/lib/training/fitness-trajectory.ts` — `currentSecOverride` param,
  ratio-preserving `projectedSec`.
- `web-v2/lib/audit/coercion-registry.ts` — `PERIPHERAL_BASELINE` 182 → 181,
  new `LOAD_BEARING_KNOWN` entry, full argued account.
- `web-v2/lib/training/fitness-trajectory-durability.test.ts` — new, 7 tests.
- `web-v2/lib/training/goal-projection-durability.test.ts` — new, 6 tests.
