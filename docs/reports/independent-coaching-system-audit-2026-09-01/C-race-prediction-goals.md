# Agent C — race prediction & goal handling audit, 2026-09-01

Independent audit of faff.run's race prediction and goal handling against
`CLAUDE.md` Rules 9/13/16/18/20, `docs/BRAIN_CONSTITUTION.md` §F/§G/§J/§K/§L,
`docs/PRODUCT_COACHING_DOCTRINE_BRIEFS.md` Brief 06/09, and the 2026-08-31
`PRODUCT_DECISIONS.md` entries.

**Evidence classes used below**
- **DIRECT VERIFICATION** — I ran it (falsified a gate, executed the real
  resolvers against read-only production, queried prod).
- **CODE-PATH INFERENCE** — traced by reading source; not executed.
- **FIXTURE EVIDENCE** — a test fixture, not real data.
- **UNVERIFIED** — could not confirm.

---

## 0 · Worktree correction (read this first)

**The worktree I was handed was NOT at `main` tip `7cac80f0`.** It was checked
out at `f43fb7a7` on the stale `claude/build-runcino-app-OIRJr` line — no
`web-v2/`, no `native-v2/`, the exact tell CLAUDE.md's
`feedback_verify_active_branch` memory names. I reset the worktree branch to
`7cac80f0` (verified the old HEAD was reachable from ~40 other refs first, so
nothing was lost) before doing any work. Everything below is against
`7cac80f0`. Anyone else given a worktree in this batch should check the same
thing. **DIRECT VERIFICATION** (`git log`, `ls`).

Tree left clean; the one temporary file I wrote (`web-v2/lib/audit/_agentc_matrix.test.ts`)
was deleted. No commits, no pushes, no writes outside the worktree. All DB
access via `faff_readonly`.

---

## 1 · Is there one canonical durability exponent?

**No. There are three fits of this runner's personal Riegel exponent live in
the tree, and the consolidation reports name only two of them.**

| # | Site | Method | Window | Shrunk? | Status |
|---|---|---|---|---|---|
| 1 | `web-v2/lib/training/durability-anchor.ts:~470` `resolveRaceExponent` | up to 6 races, recency-weighted, shrunk to the 1.06 prior | 180d lookback, 84d half-life | yes | **canonical** |
| 2 | `web-v2/lib/race/coach-goal.ts` `fitPersonalExponent` / `predictWithPersonalExponent` | 2-race log-ratio | 56d | no | legacy; **one live consumer remains** |
| 3 | `web-v2/lib/coach/limiter.ts:433` `fitRiegelExponent` | 2-race log-ratio, widest fresh pair | 56d (`CURVE_FRESHNESS_DAYS`) | no | **LIVE, never named by any report — duplicate authority** |

### 1a · `goal-projection.ts` DOES now consume the canonical exponent — claim confirmed

`web-v2/lib/training/goal-projection.ts:319-350`. **DIRECT VERIFICATION** (code
read + executed against prod):

```ts
const [marathonSpecificTraining, durabilityRead] = await Promise.all([...,
  resolveRaceExponent(userUuid).catch((): RaceExponentRead => ({ ok:false, reason:'no_races', races:0 })),
]);
const danielsProjectionSec = vdot != null ? predictRaceTime(vdot, raceDistanceMi) ?? null : null;
const durabilityProjection = durabilityRead.ok ? projectWithDurabilityExponent(durabilityRead, raceDistanceMi) : null;
const durabilityWeight = durabilityRead.ok ? durabilityRead.confidence : 0;
const vdotProjectionSecRaw =
  vdot == null ? null :
  durabilityProjection == null ? danielsProjectionSec :
  danielsProjectionSec == null ? durabilityProjection.sec :
  Math.round(durabilityWeight * durabilityProjection.sec + (1 - durabilityWeight) * danielsProjectionSec);
```

The 61a31565 "continuous blend, not a threshold" claim is **true and live**. On
the owner's account today the weight is `0.6210`, and `GoalProjection.durabilityBlend`
is populated for every one of his upcoming races (see the matrix in §8).

### 1b · FINDING C-1 (HIGH) — `limiter.ts` is a second, contradicting exponent authority, live on the coaching advice path

`lib/coach/limiter.ts` fits its own unshrunk two-race Riegel exponent and
classifies the runner against `CURVE_NEUTRAL_EXPONENT_BAND = [1.06, 1.08]`
(`limiter.ts:231`). It is called from `lib/plan/goal-gap.ts:678`
(`loadLimiterForGoal` → `diagnoseLimiter`), which composes `GoalGap.whatClosesIt`
— the coaching advice on the morning brief and the drift cron.

Its 56-day freshness window (`CURVE_FRESHNESS_DAYS = 56`, `limiter.ts:~246`)
admits **exactly one** of the owner's five graded races today (AFC, 16 days
old). `pickCurvePair` therefore returns `null`, `b` is `null`, and **no shape
finding is produced at all** — while `durability-anchor.ts`, reading the same
`races` table over 180 days, reports a raw fitted exponent of **1.1011**,
comfortably above the neutral band's 1.08 ceiling, i.e. clearly endurance-limited.

Observed live: `goalGap.limiter.primary = "threshold"` (a LEVEL limiter, the
goal-distance default) for a runner whose canonical durability read says his
limiter is the cross-distance fade. **DIRECT VERIFICATION** (executed
`computeGoalGap` against prod; result in §8).

This is Constitution §5 ("one question, one resolver") and Rule 16. The
consolidation report §1 asserts `durability-anchor.ts` is "the doctrine owner
for 'this runner's personal cross-distance exponent'"; `limiter.ts` was never
audited against that claim.

### 1c · `fitPersonalExponent` — one live consumer, correctly scoped

`app/api/targets/projection/route.ts:68,748,769`. This is the paused web
Targets route. **Not dead**, but not on the phone. The consolidation report's
account of this is accurate. `lib/race/race-role.ts:30` and
`lib/doctrine/registry.ts` reference it in prose / doctrine claims only.
**DIRECT VERIFICATION** (grep of all call sites).

---

## 2 · Do all true race projections route through `resolveRaceProjection`?

**Consumers found (all confirmed to call the resolver):**

| Consumer | File:line |
|---|---|
| Races list (`/api/v5/races`) | `app/api/v5/races/route.ts:404` |
| Race detail (`/api/v5/race/[slug]`) | `app/api/v5/race/[slug]/route.ts:204` |
| Goal gap (`GoalGap.trajectorySec`) | `lib/plan/goal-gap.ts:251` |
| Goal outlook note | `lib/plan/goal-outlook.ts:140` |
| Snapshot-projection push resolver | `lib/training/goal-projection-resolve.ts:62` |
| Race retrospective `nextRace.predictedSec` | `lib/race/retrospective.ts:434` |
| Web TargetsView (paused) | `components/faff-app/views/TargetsView.tsx:126` |

Downstream of `goal-gap.ts` (so fixed by inheritance, as the report claims):
`lib/plan/gap-report.ts:125`, `lib/coach/readiness-brief.ts:1850`,
`app/api/cron/plan-drift/route.ts:1300`, web `GapPanel.tsx` / `TrainView.tsx`.
**DIRECT VERIFICATION** (grep).

### 2a · The "no route computes it directly" test EXISTS and CAN FAIL — but its scope is two files

`web-v2/lib/training/_race_projection.test.ts:106-120`.

**Falsified (Rule 18): DIRECT VERIFICATION.** I appended
`const __falsify = predictRaceTime(44.1, 26.22);` to
`app/api/v5/race/[slug]/route.ts` and the gate went red:

```
FAIL  lib/training/_race_projection.test.ts > the two surfaces agree >
      neither route resolves a projection any other way
Tests  1 failed | 8 passed (9)
```
Restored; tree clean.

**FINDING C-2 (MEDIUM) — the gate's file list is exactly two entries.**
`_race_projection.test.ts:34-35`:

```ts
const LIST_ROUTE   = path.join(ROOT, 'app/api/v5/races/route.ts');
const DETAIL_ROUTE = path.join(ROOT, 'app/api/v5/race/[slug]/route.ts');
```

Nothing stops a *new* route, or any of the other seven consumers above, from
computing a projection directly. This is the exact shape Rule 20 records for
the coach-voice gate ("the gate's scope excluded `lib/plan`… 1,804 rows carried
them"). The `_goal_immutability.test.ts:437-449` guard 7 covers one more file
(`goal-outlook.ts`) and also passes/fails correctly, but there is no
tree-wide scanner.

### 2b · Sites that still compute a projection outside the resolver

| Site | What it computes | Verdict |
|---|---|---|
| `app/api/cron/snapshot-projections/route.ts:99` | `predictRaceTime(vdot,d)` → `projection_snapshots.projection_sec` | legitimate: this is the raw daily equivalence series, a genuinely distinct quantity. But see C-3. |
| `lib/race/effective-race-target.ts:114-121` | reads `projection_snapshots` to clamp the watch/execution race target | **FINDING C-3 — see below** |
| `lib/training/goal-assessment.ts:267` | `currentEquivalentSec` | documented byte-identical to rung 3; report §4.2's call is defensible |
| `lib/race/result-chain.ts:177-178` | post-race projection chain | different question (retrospective) |
| `app/api/targets/projection/route.ts` (×4) | paused web Targets | web-paused; still a second authority in the deployed API |
| `lib/plan/simulator.ts:264,323` | `p25/median/p75` band | **FINDING C-4 — see below** |

---

## 3 · `GoalGap.trajectorySec` — fixed, but the discriminator it added has zero readers

**Claim confirmed.** `lib/plan/goal-gap.ts:220-256` resolves through
`resolveRaceProjection`, recomputes `gapSec` off the resolved value, and exposes
`trajectoryBasis`. Live today: `trajectorySec = 12252 (3:24:12)`,
`trajectoryBasis = 'trajectory'`, `gapSec = 1452`. **DIRECT VERIFICATION.**

**FINDING C-5 (MEDIUM) — the name still outruns the meaning, and nothing reads
the escape hatch.** `trajectorySec` can honestly hold an `'equivalence'`-basis
value (rungs 2/3) or the raw snapshot fallback (`trajectoryBasis: null`). The
field was given `trajectoryBasis` so callers could tell. Grep across
`lib/ app/ components/`: **`trajectoryBasis` has zero consumers** — only three
comment mentions in `lib/audit/coercion-registry.ts`. Meanwhile
`lib/plan/gap-report.ts:141` prints `"Tracking ${formatTime(gap.trajectorySec)}"`
with no basis condition. Per Rule 20 that is a discriminator that is not in
force; per Rule 16 the sentence is not gated on the measurement.

---

## 4 · Are the four (actually seven) quantities kept distinct?

They are not four. Counting distinct "what will he run / what should he aim at"
numbers reachable for one race on one day:

1. rung-3 raw equivalence `predictRaceTime(vdot, d)`
2. rung-2 adjusted equivalence `GoalProjection.vdotProjectionSec` (durability-blended, + marathon specificity)
3. rung-1 trajectory `GoalProjection.trajectory.projectedSec` ← what "Projected" shows
4. pure durability projection (input to 2)
5. `GoalProjection.projectionSec` — **the GOAL itself when status is on-track/watching** (`goal-projection.ts:412`)
6. coach-set A/B/C (`coach-goal.ts`, only when no stated goal)
7. feasibility safe/stretch (`goal-assessment.ts:425-426`) and `achievableRaceTarget` (`achievable-target.ts`)
8. `EffectiveRaceTarget.targetSec` — what the watch and the execution plan actually pace

### 4a · FINDING C-6 (HIGH) — on the runner's next race the "Projected" number is FASTER than the coach's own A goal

Santa Monica 10K, 2026-09-13, 12 days out, no stated goal. Both of these render
on the same iPhone screen (`native-v2/Faff/Faff/ViewsV5/RaceDetailV5.swift`:
`statsRow` always draws "Projected"; `coachGoalSection:321` draws the COACH SET
tiles when `raceDetail.goal == nil`):

```
Projected     43:38          ← resolveRaceProjection rung 3, raw Daniels
COACH SET     A ~44:15 · B ~45:10 · C ~46:05   ← durability-exponent tiers
```

**Root cause, DIRECT VERIFICATION** (`app/api/v5/race/[slug]/route.ts:191`):
`goalProjection` is gated on `goalSec != null`, so a race with no stated goal
never calls `computeGoalProjection` and therefore **never gets the durability
blend**. Same runner, same day, same distance: with a goal the app uses the
durability-corrected model, without one it uses Daniels only. The coach's most
ambitious tier is 37 s slower than its own headline projection.

### 4b · FINDING C-7 (MEDIUM) — `GoalProjection.projectionSec` is the goal wearing the word "projection"

`lib/training/goal-projection.ts:412`:
```ts
const projectionSec = (status === 'off-track' || status === 'ahead') && vdotProjectionSec != null
  ? vdotProjectionSec : goalSec;
```
For LA Marathon 2027 (status `watching`) this returns **3:31:00 = the goal
exactly**, while `resolveRaceProjection` returns 3:27:51. `components/faff-app/seed.ts:2623`
assigns it straight to `goalRace.projected`. Web-paused, so not on the phone —
but it is a field on the canonical engine type whose name asserts a quantity it
is not. Rule 16.

Separately, three *different* quantities share the field name `projectionSec`:
`GoalProjection.projectionSec` (goal-or-equivalence),
`ProjectionSeriesRow.projectionSec` (raw snapshot equivalence),
`EffectiveRaceTarget.projectionSec` (snapshot). **DIRECT VERIFICATION** (grep).

### 4c · iPhone surfaces — what shows what

| Screen | Shows |
|---|---|
| `RacesV5.swift` / `RaceDetailV5.swift` | Goal · **Projected** (~ tilde, modelled) · Gap — from `resolveRaceProjection` |
| `RaceDetailV5.swift:321-343` | **COACH SET A/B/C** (~ tilde), only when `goal == nil` |
| `TodayView` / `/api/v5/today` | no projection value at all (verified: grep found none) |
| `ReadinessBriefSeed.swift` | does **not** decode `gapReport` — so §4d's A/B/C mismatch is not on the phone today |
| Watch race day (`lib/watch/build-workout.ts:2094-2136`) | `EffectiveRaceTarget.targetSec`, or coach-set B when no stated goal |

Feasibility targets (`goal-assessment.ts` safe/stretch) do not currently render
on any phone surface — matching the report's §4.4 claim. **CODE-PATH INFERENCE**
(read the Swift; did not render the app — see §11).

### 4d · FINDING C-8 (HIGH) — the morning brief prints two different numbers, both labelled "tracking"

`lib/plan/gap-report.ts:141` and `:170-178`. On the owner's live data today:

```
headline:  "Tracking 3:24:12 · Gap to 3:00:00 is wider than 13 weeks can close."
B-goal:    3:13:56 · "B-goal · where you're tracking"
```

**10 minutes 16 seconds apart, in one card, both asserting "tracking".** The
headline is `gap.trajectorySec` (the canonical resolver). The A/B/C block is
`sim.finalProjection.{p25,median,p75}` from `lib/plan/simulator.ts:323`
(`predictRaceTime(finalVdot, d)`) — a fourth, wholly independent projection
model that never touches `resolveRaceProjection`. **DIRECT VERIFICATION**
(executed `composeGapReport` against prod).

This is the CIM three-projections incident in the same file that was audited
for it. It is in the `/api/readiness/brief` payload today; the phone does not
decode `gapReport`, and web is paused, so **the payload divergence is live but
the render is not**. It will land the moment either surface adopts the field.

Note also: `gap-report.ts`'s A/B/C and `coach-goal.ts`'s A/B/C are two unrelated
A/B/C systems with the same letters.

---

## 5 · Confidence intervals — the honesty boundary holds; two places to watch

**Confirmed clean on the phone.** `lib/training/race-projection.ts:120-152`
returns `confidenceInterval: null, confidenceLabel: null` on the `'trajectory'`
rung by construction, and only passes them through on `'equivalence'`. Verified
against live data for every one of the owner's upcoming races: every one lands
on a rung where the CI is null or absent (matrix §8). Neither
`/api/v5/races` nor `/api/v5/race/[slug]` puts the fields in the response body,
and no Swift view decodes them. **DIRECT VERIFICATION.**

**FINDING C-9 (LOW, web-paused).** `components/faff-app/seed.ts:2623-2635`
attaches `gp.confidenceInterval` (computed around `vdotProjectionSec`) beside
`goalRace.projected = gp.projectionSec`. When status is `on-track`/`watching`
those are different numbers (§4b): for LA 2027 the band `[11692, 13250]`
describes 12471 while the printed value is 12660. Same pattern at
`app/api/targets/projection/route.ts:870-871`. Both are paused-web surfaces.

---

## 6 · Goal contamination into the capacity resolvers

**Sealed at compile time. Verified by falsification.**

`lib/training/capacity-resolver.ts:1590-1611` asserts all four resolvers'
parameter tuples with `AssertTrue<Equals<Parameters<typeof …>, CapacityResolverParams>>`.

**Falsification (DIRECT VERIFICATION):** I added `goalSec?: number` to
`resolveDurability`'s signature and ran `tsc --noEmit`:
```
lib/training/capacity-resolver.ts(1605,3): error TS2344: Type 'false' does not satisfy the constraint 'true'.
```
Restored.

The seal only covers parameters, so I also traced the transitive read graph
(`durability-anchor.ts`, `pace-corpus.ts`, `vdot-corpus.ts`, `vdot-inputs.ts`,
`vdot.ts`, `reexamination.ts`, `load-activity-evidence.ts`, `spec-builder.ts`)
for `tt_goal_*` / `goal_time` / `goal_race_distance` / `goalSec` reads: **only
comments remain**, all recording the removed `goalRunFloorMiForUser` leak
(`vdot-inputs.ts:780`). **DIRECT VERIFICATION** (grep).

### `scripts/check-goal-immutability.sh` — what it actually gates, and it fails correctly

It gates **goal mutation**, not goal contamination (contamination is the
compile-time seal above; there is no shell gate for it). Three guards:
declaration shape + retired-copy scan + native `informationalPlanKinds` presence;
gate-file presence; then the full 13-test vitest gate.

**Three falsifications run, all DIRECT VERIFICATION:**

| Injected violation | Result |
|---|---|
| Re-added `"Set the revised target to race off the fitness you have."` to `goal-outlook-copy.ts` | `FAIL · the retired imperative is back in the outlook copy (1 code lines)` |
| Re-admitted `'renegotiate'` to `RUNNER_INITIATED_GOAL_SOURCES` | `FAIL` at `_goal_immutability.test.ts:293` |
| Added `"goal_outlook": "SET THE REVISED TARGET"` to the phone's `planAcceptVerbs` | `FAIL · guard 4 · no informational kind has an accept verb (web and phone)` |
| Renamed `informationalPlanKinds` → `infoKinds` in the Swift | `FAIL` (both guard 1 and guard 4) |

All restored; tree clean.

**FINDING C-10 (LOW) — one weak grep.** `check-goal-immutability.sh`'s
`grep -q "informationalPlanKinds" "$NATIVE"` is a substring match: renaming the
symbol to `informationalPlanKindsXX` throughout passes guard 1 (the vitest guard 4
still catches the real regression, so the gate as a whole holds). Worth
anchoring on a word boundary.

---

## 7 · Goal cards — no accept path can mutate a goal; the re-nag is time-based

**Confirmed, three ways deep.** **DIRECT VERIFICATION** (code read + prod query
+ falsification):

1. `native-v2/Faff/Faff/Components/CoachDecisionCard.swift:367-384` — the
   `informationalPlanKinds` branch gives a `goal_outlook` card exactly one
   action, `.keep` ("KEEP THE GOAL ON THE BOARD"). No `.accept` in the tree;
   `planAcceptVerbs:324-332` carries no entry for the kind.
2. `app/api/plan/proposal/route.ts:144-150` — server refuses
   `action: 'accept'` for any `isInformationalProposalKind` with 400.
3. `app/api/race/[slug]/route.ts:333-345` — a goal PATCH with any source
   outside `RUNNER_INITIATED_GOAL_SOURCES` is rejected, never normalised.

### Production state (read-only query)

```
plan_proposals for 0645f40c-…:
  goal_outlook        pending      1   id=63, created 2026-08-31 03:40
  goal_renegotiation  expired      1   id=57
  goal_renegotiation  superseded   1   id=53
  goal_time_changed   expired     19 / superseded 2
```

Rows 53 and 57 **still carry `reasons.accept_path =
"PATCH /api/race/cim { goalSec, source: 'renegotiate' }"` and the retired
imperative in `reasons.message`** — but neither is `pending`, the phone renders
the kind as informational, and `lib/plan/proposals-state.ts:431-443`
recomposes the message from structured fields instead of printing
`reasons.message`. **No pending row of the renegotiating kind exists.**

### FINDING C-11 (MEDIUM) — the live card shows a stale number, 6 minutes off every other surface

Pending row 63 persists `projected_sec = 12613` (**3:30:13**) with
`projection_basis = 'trajectory'`. `proposals-state.ts:439` recomposes the
sentence from that persisted number, so the card on the phone today reads
**"This build projects 3:30:13"** while the Races list, race detail, goal gap
and morning brief all resolve **3:24:12** live. **361 seconds apart, on one
account, right now.** Rule 16: the number is persisted at write time and never
re-resolved at read time (Rule 10's posture question — this one is neither
recomputed nor labelled as a snapshot).

### FINDING C-12 (MEDIUM, already flagged by the goal-card audit — confirmed) — re-nag is time-based, not materiality-based

`lib/plan/goal-outlook.ts:210-232`. Three checks, none of which compares the new
projection to the old one:
- `OUTLOOK_SUSTAINED_DAYS = 5` (first surface)
- `OUTLOOK_REFRESH_DAYS = 7` (fresh pending blocks a rewrite)
- 14-day `recentDismiss` cooldown

Doctrine (`PRODUCT_DECISIONS.md` 2026-08-31): *"re-surfaces the decision only
when the outlook materially changes."* Not implemented. The prior audit's
finding stands unfixed.

**What "material change" would need to be, concretely:** compare the new
`reasons.projected_sec` against the most recent prior row's for the same kind
and skip the write when the delta is below a named threshold. The natural
threshold already exists in this codebase and is doctrine-bound rather than
invented: `lib/training/vdot-gain-rate.ts`'s `PROJECTION_NOISE_GRACE_VDOT`
(used at `lib/doctrine/registry.ts:571` to convert a VDOT noise floor into
seconds at a distance). Expressing materiality as "the projection moved by more
than the engine's own projection noise floor at this distance" reuses a number
the registry already gates, needs no new constant, and scales correctly across
5K and marathon — which a flat second count would not. Second, orthogonal
axis worth including: a change in `GoalGap.status` rung (e.g.
`unclosable → widening`) is material regardless of seconds.

---

## 8 · NUMERIC CONSISTENCY MATRIX

Executed live against read-only production (`faff_readonly`), 2026-09-01, owner
`0645f40c-951d-4ccc-b86e-9979cd26c795`, via a throwaway vitest harness calling
the **real** resolvers (`computeGoalProjection`, `resolveRaceProjection`,
`computeGoalGap`, `composeGapReport`, `loadCoachGoalForRace`, `assessGoal`,
`achievableRaceTarget`, `loadEffectiveRaceTarget`, `resolveGoalOutlookProjection`,
`resolveNextAGoalProjection`). **DIRECT VERIFICATION.**

**Inputs.** VDOT anchor `46.8`, anchored 2026-07-14 on a **4-mile** effort.
`resolveRaceExponent`: `ok, value 1.08691, raw fit 1.10107, confidence 0.62097,
evidenceScore 0.65513, 5 races, 2 distinct distances`.

### CIM — marathon 26.22 mi, 2026-12-06 (96 d), stated goal 3:00:00, priority A

| Consumer | Number | Δ vs "Projected" |
|---|---|---|
| **`resolveRaceProjection` → Races list + race detail "Projected"** (basis `trajectory`) | **3:24:12** (12252) | — |
| rung-3 raw equivalence `predictRaceTime(46.8, 26.22)` | 3:21:33 (12093) | −159 s |
| rung-2 `vdotProjectionSec` (durability-blended, w=0.621) | 3:27:51 (12471) | +219 s |
| pure durability projection (LA Marathon anchor, exp 1.0869) | 3:31:41 (12701) | +449 s |
| `GoalProjection.projectionSec` (status off-track → = vdotProjectionSec) | 3:27:51 (12471) | +219 s |
| confidence interval (around `vdotProjectionSec` only) | [3:08:53 – 3:39:31] pct 7.5 `research-span-cross` | — |
| confidence label | **LOW** · "behind on this runway" · "21:33 to find · 14 weeks to do it" | — |
| `resolveRaceProjection.confidenceInterval` | **null** (trajectory rung — correct) | — |
| `GoalGap.trajectorySec` / `trajectoryBasis` / `gapSec` | 3:24:12 / `trajectory` / +24:12 | 0 |
| `resolveGoalOutlookProjection` | 3:24:12 basis `trajectory` | 0 |
| **live pending goal-outlook CARD (`plan_proposals` 63)** | **3:30:13** (12613, persisted 2026-08-31) | **+361 s** |
| **morning brief headline** (`gap-report`) | "Tracking **3:24:12** · Gap to 3:00:00 is wider than 13 weeks can close." | 0 |
| **morning brief "B-goal · where you're tracking"** (simulator median) | **3:13:56** (11636) | **−616 s** |
| morning brief A-goal (sim p25) | 3:07:23 (11243) | −1009 s |
| morning brief C-goal (sim p75) | 3:20:29 (12029) | −223 s |
| `assessGoal.currentEquivalentSec` | 3:21:33 (12093) | −159 s |
| `assessGoal` feasibility | **out-of-reach** | — |
| `assessGoal.safeTargetSec` / `stretchTargetSec` | 3:15:20 / 3:12:22 | — |
| `achievableRaceTarget.targetSec` (what the plan prescribes) | **3:02:40** src `projected_ceiling`, ceiling 3:12:08 | — |
| **WATCH `EffectiveRaceTarget`** | **3:11:20** src `projection` (clamped off `projection_snapshots` 3:21:24) | **−772 s** |
| `resolveNextAGoalProjection` (push notification) | 3:24:12 basis `trajectory` | 0 |
| coach-set A/B/C | null (stated goal present) | — |
| `goalGap` status / confidence / weeks / consecutiveUnclosableDays / limiter | `unclosable` / 0.94 / 13 / 15 / **threshold** | — |

**Nine distinct numbers for one race on one day**, of which at least three are
labelled with "projects"/"tracking" in runner-facing prose.

### Santa Monica 10K — 6.2 mi, 2026-09-13 (12 d), **no stated goal**, priority B

| Consumer | Number |
|---|---|
| **`resolveRaceProjection` "Projected"** (basis `equivalence`, rung 3 — no goal ⇒ no `computeGoalProjection` ⇒ **no durability blend**) | **43:38** (2618) |
| pure durability projection (AFC 13.1 mi anchor) | 45:11 (2711) |
| **coach-set A / B / C** (`personal-exponent`, exp 1.08691, conf 0.621) | **44:15 / 45:10 / 46:05** |
| coach-set line | "Coach set from your current fitness. Yours to edit." |
| confidence interval | null |
| **WATCH race-day goal** (`build-workout.ts:2136`, coach-set **B**) | **45:10** |
| WATCH strategy / gel ladder distance | resolved from `todaysRace` (10K), not CIM — MIDGOAL-2/3 fixes verified in source |

**The Rule 16 incident that motivated MIDGOAL-2 does not recur** — the watch
resolves the race by `meta->>'date' = today` and carries the 10K's own coach-set
B, not CIM's 3:00:00. **CODE-PATH INFERENCE** (source read; I did not build the
watch payload end-to-end).

**But** "Projected 43:38" sits above "COACH SET A ~44:15" on the same screen —
finding C-6.

### Dodgers 10K — 6.21 mi, 2026-09-26 (25 d), stated goal 0:45:00, priority C

| Consumer | Number |
|---|---|
| **"Projected"** (basis `trajectory`) | **44:40** (2680) |
| rung-3 raw equivalence | 43:42 (2622) |
| rung-2 blended | 44:40 (2680) |
| pure durability | 45:16 |
| `GoalProjection.projectionSec` (status `watching` ⇒ **= goal**) | **45:00** |
| CI (around vdotProjectionSec) / label | [43:33 – 45:47] pct 2.5 / **MEDIUM** "doable, not banked" |
| `assessGoal` feasibility / safe / stretch | comfortable / 43:30 / 43:24 |
| `achievableRaceTarget` | 45:00 src `goal`, ceiling 43:19 |
| WATCH effective target | 45:00 src `goal` (**no 10K snapshot exists** ⇒ falls back to goal) |

### Run Malibu — HM 13.1 mi, 2026-11-08 (68 d), stated goal 1:30:00, priority B

| Consumer | Number |
|---|---|
| **"Projected"** (basis `trajectory`) | **1:38:10** (5890) |
| rung-3 raw equivalence | 1:36:50 (5810) |
| rung-2 blended | 1:39:58 (5998) |
| pure durability (AFC 13.1 anchor = his **slowest** half) | 1:41:53 |
| CI / label | [1:34:29 – 1:41:51] pct 3.8 / **LOW** "6:50 to find · 10 weeks to do it" |
| `assessGoal` feasibility / safe / stretch | aggressive / 1:34:35 / 1:33:31 |
| `achievableRaceTarget` | 1:30:00 src `goal`, ceiling 1:33:24 |
| **WATCH effective target** | **1:32:00** src `projection` (clamped off snapshot 1:36:50) |

### LA Marathon 2027 — 26.22 mi, 2027-03-07 (187 d), stated goal 3:31:00, priority A

| Consumer | Number |
|---|---|
| **"Projected"** (basis `trajectory`) | **3:27:51** (12471) |
| `GoalProjection.projectionSec` (status `watching` ⇒ **= goal**) | **3:31:00** (12660) |
| CI (around 12471) / label | [3:14:52 – 3:40:50] / MEDIUM |
| WATCH effective target | 3:31:00 src `goal` |

### FINDING C-3 (HIGH) — the watch paces off a different projection than every screen shows

`lib/race/effective-race-target.ts:114-121` clamps the race target to
`max(goal, 0.95 × projection)` where `projection` is read straight from
`projection_snapshots` — **the raw daily VDOT equivalence**, not
`resolveRaceProjection`. Live consequence for CIM:

- clamped off the snapshot (3:21:24 / 12084) → **watch target 3:11:20**
- clamped off the canonical trajectory (3:24:12 / 12252) → would be **3:14:00**

**160 seconds of prescribed race pacing** decided by which projection the
execution surface happens to read. Same resolver divergence reaches
`app/api/race/[slug]/execution-plan/route.ts:151`.

**Sub-finding C-3b (Rule 14).** That query is
`WHERE distance_mi BETWEEN $2*0.95 AND $2*1.05 … ORDER BY snapshot_date DESC LIMIT 1`.
Production holds **two rows for the same day and the same race** — `26.2 →
12084` and `26.22 → 12093` — and the query has no tiebreaker beyond
`snapshot_date`, so which of the two answers is undefined. 9 seconds today;
the point is the query does not name its population.

---

## 9 · Can a cron regenerate a renegotiation card today?

**A `goal_outlook` note: yes. A "revised target" card: no.**

`app/api/cron/plan-drift/route.ts:1334-1368` is the only writer
(`.github/workflows/plan-drift.yml`: `0 9 * * *` and `0 4 * * *`). It calls
`shouldSurfaceGoalOutlook` → `writeGoalOutlookNote`. The owner's gap is
`unclosable` with `consecutiveUnclosableDays = 15` ≥ 5, so it **would** fire —
it is currently blocked only by row 63 being pending and younger than
`OUTLOOK_REFRESH_DAYS = 7`. It unblocks 2026-09-07, and per C-12 nothing
compares the new number to the old.

The retired writer (`lib/plan/goal-renegotiation.ts`) is gone; no source file
outside comments and the retired-row test fixtures contains "revised target" /
"recommended race target" (`check-goal-immutability.sh` guard 1 scans for
exactly that and I falsified it). **DIRECT VERIFICATION.**

---

## 10 · Other findings

### C-13 (HIGH) — Rule 9 cliff: the durability anchor is chosen by a 0.0007 log-distance margin

`durability-anchor.ts:655-659`, `projectWithDurabilityExponent`:
```ts
const anchor = [...read.supporting].sort((a,b) =>
  Math.abs(Math.log(targetDistanceMi/a.distanceMi)) - Math.abs(Math.log(targetDistanceMi/b.distanceMi)))[0];
```
Selection is by log-distance nearness **only** — recency, race priority and
`lib/race/effort-authority.ts` grading are all ignored. The owner's five
supporting races include four half marathons stored at 13.109, 13.109, 13.16
and 13.1 miles. Computed for the Santa Monica 10K target:

| Anchor | log-distance | projection |
|---|---|---|
| AFC (13.1 mi, 1:41:53) — **selected** | 0.74806 | **45:11** |
| Rose Bowl (13.109 mi, 1:38:38) | 0.74875 | 43:43 |
| Disney (13.109 mi, 1:34:54) | 0.74875 | 42:03 |

**A 0.009-mile difference in stored course length — data entry, not
physiology — decides between a 45:11 and a 42:03 projection: 188 seconds.**
The same mechanism picks AFC (his *slowest* half) as the anchor for the
Run Malibu HM target, which is why that blended number is 3 minutes slower
than Daniels. **DIRECT VERIFICATION** (computed from the live `supporting` list).

Recommendation: anchor selection should be weighted (log-distance × recency ×
effort grade), or blended across the supporting set, not a hard argmin on a
quantity whose ties are decided by course-measurement noise.

### C-14 (MEDIUM) — Rule 9 cliff: `RIEGEL_MAX_DISTANCE_MI = 26.22` and CIM is stored at exactly 26.22

`durability-anchor.ts:620,653`. `projectWithDurabilityExponent` returns `null`
for `targetDistanceMi > 26.22`, which switches the whole durability blend off
and drops `computeGoalProjection` back to Daniels-only. CIM sits **exactly on
the boundary**. Recomputed: at 26.22 the blend gives 12470; at 26.23 it gives
12093 — **a 377-second discontinuity for 0.01 mi of stored distance**. His own
other marathons are stored at 26.2 and 26.219, so the value is arbitrary data
entry. **DIRECT VERIFICATION** (computed).

### C-15 (LOW) — stale comments that Rule 20's corollary says should be gated or deleted

All three still assert that `GoalGap.trajectorySec` is the raw snapshot, which
stopped being true with `cdc77c89`:
- `lib/plan/goal-outlook.ts:36-41` — *"`GoalGap.trajectorySec` is the projection SNAPSHOT (today's equivalence) wearing the word 'trajectory'"*
- `lib/plan/goal-outlook-copy.ts:22-26` — same claim about `trajectory_sec`
- `lib/plan/proposals-state.ts:426-429` — same
- `lib/plan/_goal_immutability.test.ts:443` — *"`gap.trajectorySec` is the snapshot wearing the trajectory's name"*

The consolidation report says it rewrote the stale comment in
`plan-drift/route.ts` (true, verified at :1350-1360) but these four were missed.

### C-16 — Rule 9's `achievable-target.ts` 95% cliff IS fixed

`achievable-target.ts:229-240`: `prescriptionFloorSec` + `max(goal, floor)`,
with the reasoning stated in the code. Verified live: CIM's goal (10800) is
below the floor and is clamped **to the edge** (3:02:40) rather than snapped
back to the unreduced ceiling (3:12:08). `effective-race-target.ts:57-65`
carries the value-identical twin, bound by `GOAL.prescribed-race-pace-ceiling`.
**DIRECT VERIFICATION.**

### C-17 (LOW) — no gate covers projection consistency at all

Of 25 scripts in `scripts/`, exactly one (`check-goal-immutability.sh`)
mentions `race-projection` / `resolveRaceProjection`, and only to check that
`goal-outlook.ts` calls it. There is no prebuild gate equivalent to
`check-normal-window.sh` that scans for projection re-derivation tree-wide.
Findings C-3, C-4, C-6, C-8 are all inside that hole. **DIRECT VERIFICATION.**

---

## 11 · What I could NOT verify (Rule 13)

- **I did not render any iPhone screen.** §4a/§4c are read from
  `RaceDetailV5.swift` and the route source, not from a screenshot. The
  Santa-Monica "Projected 43:38 above COACH SET A ~44:15" claim is
  **CODE-PATH INFERENCE + DIRECT VERIFICATION of both numbers**, not a render.
  It should be confirmed on the device before it is treated as shipped.
- **I did not execute `buildWatchWorkout`** end-to-end for a race day. §8's
  watch rows come from executing `loadEffectiveRaceTarget` and
  `loadCoachGoalForRace` directly (DIRECT), plus reading the wiring in
  `build-workout.ts:2094-2200` (CODE-PATH INFERENCE).
- **The prior goal-card audit's own rendering verification was inconclusive**
  and it says so honestly; I did not re-attempt it. Its
  `CoachDecisionCard.swift` ghost-DISMISS fix is on `main` and reads correctly,
  but has still never been watched to render.

---

## 12 · Findings, ranked

| # | Sev | Finding |
|---|---|---|
| C-1 | HIGH | `lib/coach/limiter.ts` is a third, unshrunk 56-day Riegel fit, live on the coaching-advice path, contradicting the canonical durability read (says no shape limiter; canonical says endurance-limited at raw exp 1.1011) |
| C-3 | HIGH | Watch + execution-plan race target clamps off `projection_snapshots` (raw equivalence), not `resolveRaceProjection` — 160 s of CIM pacing; plus an untiebroken 26.2-vs-26.22 duplicate-row query |
| C-6 | HIGH | A race with **no stated goal** never gets the durability blend, so "Projected 43:38" renders above the coach's own "A ~44:15" on the Santa Monica 10K screen, 12 days out |
| C-8 | HIGH | Morning-brief payload prints "Tracking 3:24:12" over "B-goal · where you're tracking 3:13:56" — 616 s, one card, from `simulator.ts`, a fourth projection model |
| C-13 | HIGH | Durability anchor selected by argmin over log-distance with no recency/grade weighting: a 0.009-mi course-length difference swings the 10K projection 188 s |
| C-11 | MED | The live pending goal-outlook card shows a persisted 3:30:13 while every live surface resolves 3:24:12 |
| C-12 | MED | Goal-outlook re-nag is time-based (7/14 d), not materiality-based, contrary to the 2026-08-31 decision |
| C-2 | MED | The "no route computes it directly" gate covers exactly 2 files |
| C-5 | MED | `GoalGap.trajectoryBasis` has zero consumers; `gap-report.ts` prints "Tracking X" ungated |
| C-7 | MED | `GoalProjection.projectionSec` returns the goal itself when on-track/watching; three unrelated `projectionSec` fields |
| C-14 | MED | `RIEGEL_MAX_DISTANCE_MI = 26.22` — CIM sits exactly on it; 0.01 mi flips the projection 377 s |
| C-9 | LOW | (web-paused) equivalence CI attached beside a goal-valued `projected` in `seed.ts` and the Targets route |
| C-10 | LOW | `check-goal-immutability.sh` guard-1 substring grep for `informationalPlanKinds` |
| C-15 | LOW | Four stale comments still asserting `trajectorySec` is the raw snapshot |
| C-17 | LOW | No prebuild gate scans for projection re-derivation tree-wide |

## 13 · Claims checked and CONFIRMED

- `61a31565` — continuous confidence blend in `goal-projection.ts`: **true**, live, weight 0.6210 today.
- `cdc77c89` — `GoalGap.trajectorySec` resolves canonically: **true**.
- `ad220f83` / goal-card audit — no accept path can mutate a goal: **true**, server-refused, phone has no verb, gate falsified three ways.
- Capacity resolvers are goal-sealed at compile time: **true**, falsified.
- `resolveRaceProjection` never attaches the equivalence CI to a trajectory number: **true**, and no live phone surface renders a CI at all.
- `fitPersonalExponent` retained with one real dependent (paused web Targets) + doctrine claims: **true**.
- MIDGOAL-2/3 (watch resolves the race it is standing on): **true in source**; Santa Monica would carry its own coach-set B 45:10, not CIM's 3:00:00.
- `achievable-target.ts`'s Rule 9 95%-cliff fix: **true**, verified on live data.
