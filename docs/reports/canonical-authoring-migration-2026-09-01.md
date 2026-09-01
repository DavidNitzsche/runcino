# Canonical authoring migration — inventory, shadow mechanism, real diffs

**Scope.** `web-v2/lib/plan/generate.ts` (14,236 lines) still authors every
plan through the legacy VDOT cascade (`lib/training/vdot.ts`) — zero
references to `capacity-resolver.ts` or `prescription-resolver.ts`, confirmed
fresh by grep. `recompute-paces.ts` and `reanchor-plan.ts` (the flex/
recompute path) already price every unrun day through the canonical
`resolvePrescribedPaceAnchors` layer. This report begins closing that gap, per
the explicit brief: inventory, classify, wire a SHADOW-ONLY comparison, run it
against real data, add tests. **It does not switch authoring over.** No line
of `generate.ts` or `spec-builder.ts` changed. No plan any real user reads was
touched. That decision is out of scope tonight and is named as a decision for
a human at the end of this document.

Everything below was produced against `origin/main`
(`3ebaf3ac` as of branch point, confirmed no drift in any file this report
depends on before writing this document — see §7) from a rebuilt worktree —
this worktree's assigned base branch predated the entire `web-v2` rewrite
(still had `web/`, `ios/`, no `web-v2` at all), so the first step was
recreating a current branch from `origin/main` inside the same isolated
worktree. See §7 for the full account.

---

## 1 · Inventory — every legacy VDOT-cascade call site in `generate.ts`

Re-counted fresh against the exact functions `generate.ts` imports from
`lib/training/vdot.ts` (`parseRaceTime` excluded — it parses a typed time
string, not a fitness derivation; `EVIDENCE_RUN_FLOOR_MI` excluded — it is a
constant, not a call expression):

**22 real call sites, across 9 functions, from line 8683 to line 14156.**
(`conservativeVdotFromMileage` is re-exported through `spec-builder.ts` rather
than imported directly from `vdot.ts`, and is counted here because it is part
of the same cascade and `capacity-resolver.ts`'s own fallback tiers call the
identical function.) The prior scope report
(`pace-shadow-compare-2026-09-01.md` §3) counted "32 call expressions across
19 distinct lines" the day before — the discrepancy is counting method (that
count included nested calls inside comments, e.g. the three lines below that
merely *mention* `iPaceFromVdot(vdotFromTpace(weekT))` inside a doc comment
without calling it). Both counts land on the same conclusion: this is not a
small, isolable call site, it is threaded through the file's authoring logic,
in a different function on almost every phase of composition.

| Line | Function | Call | Coaching question it answers |
|---|---|---|---|
| 8683 | `composePlan` | `predictRaceTime(bestRecentVdot, raceDistanceMi)` | Demonstrated pace at THIS race's distance, from measured evidence only — feeds tier classification (beginner/intermediate/advanced volume band) |
| 8709 | `composePlan` | `predictRaceTime(bestRecentVdot, h.distanceMi)` | Same question, at a horizon race's distance (Rule 11's "does a bigger future race raise this block's long-run dials") |
| 8942 | `composePlan` | `conservativeVdotFromMileage(recentWeeklyMi)` | Cold-start VDOT floor when no measured VDOT exists |
| 8952 | `composePlan` | `resolveCurrentTPace(bestRecentVdot, belowTableAnchor, recentWeeklyMi, conservativeVdotFromMileage)` | **THE primary authoring-time threshold-pace resolution** — every easy/long/recovery/quality band anchors off this |
| 8956 | `composePlan` | `tPaceFromVdot(estimatedCurrentVdot)` | Fallback threshold pace when `resolveCurrentTPace` returns no pace |
| 9010 | `composePlan` | `tPaceFromVdot(estimatedCurrentVdot + seasonalGainVdot)` | The "achievable floor" — current fitness plus a doctrine-capped in-season VDOT gain, bounding how fast the goal-blend may prescribe |
| 9018 | `composePlan` | `clampToSanePace(goalTFloored, belowTableAnchor.anchor.paceSPerMi)` | Clamps the goal-blended threshold pace to never run faster than a below-table runner's own demonstrated pace |
| 9058 | `composePlan` | `vdotFromRace(goalSec, raceDistanceMi)` | The VDOT the stated goal implies, for the goal-realism flag |
| 9065 | `composePlan` | `predictRaceTime(estimatedCurrentVdot, raceDistanceMi)` | Current-fitness predicted finish time, for the direction-aware goal-realism flag |
| 9158 | `composePlan` | `iPaceFromAnchorPace(belowTableAnchor.anchor)` | Interval pace for a below-table runner (Riegel, not VDOT-table) |
| 9159 | `composePlan` | `iPaceFromVdot(vdotFromTpace(t))` | Interval pace for every other runner, inverting the week's blended T-pace back through VDOT |
| 9893 | `composeMaintenancePlan` | `tPaceFromVdot(conservativeVdotFromMileage(0))` | The absolute cold-start floor pace for a runner with zero everything |
| 10338 | `composeRecoveryPlan` | `tPaceFromVdot(conservativeVdotFromMileage(recentWeeklyMi \|\| 0))` | Cold-start floor pace, recovery-composer's own copy |
| 10641 | `specForComposedDay` | `iPaceFromAnchorPace(belowTableAnchor.anchor)` | Per-day interval pace, below-table branch (the exact site `canonicalSpecForComposedDay` replaces — see §2) |
| 10642 | `specForComposedDay` | `iPaceFromVdot(vdotFromTpace(weekT))` | Per-day interval pace, measured-VDOT branch |
| 13014 | `composeForUserInternal` | `vdotFromRace(goalSec, raceDistanceMi)` | Goal-implied VDOT, for the mid-block rebuild's "how much of the season's ambition has been banked" gate (`measuredProgressFraction`) |
| 13048 | `composeForUserInternal` | `predictRaceTime(bestRecentVdot, raceDistanceMi)` | Same tier-classification question as 8683, for the maintenance/recovery (non-race) branch |
| 13298 | `persistComposedPlan` | `resolveCurrentTPace(bestRecentVdot, belowTableAnchor, recentWeeklyMi, conservativeVdotFromMileage)` | The easy/long/recovery anchor pace, computed a SECOND time (independently of `composePlan`'s own 8952) at persist time — the exact site `recompute-paces.ts` already replaced with `anchors.easyCeilingSecPerMi` on the flex path |
| 13654 | `loadGeneratorInputs` | `vdotFromRace(goalSec, raceDistanceMi)` | Pure input-sanity check: is the typed goal off the VDOT table's top edge (a likely data-entry error)? |
| 13655 | `loadGeneratorInputs` | `predictRaceTime(85, raceDistanceMi)` | Same check, the other half of the off-the-top comparison |
| 13886 | `loadGeneratorInputs` | `computeBestRecentVdot(raceCandidates, todayISO, 180, runCandidates, runFloorMi)` | **THE primary evidence-gathering step** — the best measured VDOT from the runner's races/runs, which every downstream cascade call in this file consumes |
| 14154 | `loadGeneratorInputs` | `resolveCurrentTPace(bestRecentVdot, belowTableAnchor, recentWeeklyMi, conservativeVdotFromMileage)` | The plan-wide fallback T-pace, computed a THIRD time (independently of 8952 and 13298) |

### 1.1 · A finding the inventory itself surfaces, before any classification

**One question — "what threshold pace should this authoring use" — is
computed three separate times** (8952 in `composePlan`, 13298 in
`persistComposedPlan`, 14154 in `loadGeneratorInputs`), from the same
underlying `bestRecentVdot`/`belowTableAnchor`/`recentWeeklyMi` inputs, by
three independently-written call sites to the same `resolveCurrentTPace`
function. They agree today because all three read the same inputs at the
same instant in the same request — but this is exactly the shape CLAUDE.md's
Rule 16 names ("if two surfaces show the same label they show the same
number... resolve a displayed quantity in ONE place"), and it is a defect
this migration would incidentally fix as a side effect of routing all three
through one `resolvePrescribedPaceAnchors(userId, todayISO)` call, computed
once per authoring run and threaded through.

---

## 2 · Classification

**(a) Legitimate to keep — not a duplicate-authority defect, even after
migration.**

| Lines | Why it stays |
|---|---|
| 13654–13656 | Pure input validation: is the runner's TYPED goal physiologically off the Daniels table's top edge (a likely wheel/entry error)? This never resolves capacity — it rejects malformed input before capacity is ever consulted. `capacity-resolver.ts` has no equivalent function and should not grow one; this is data hygiene, not fitness. |
| 13014 | `vdotFromRace` here feeds `measuredProgressFraction` — "how much of THIS SEASON'S stated ambition has the runner actually earned in measured VDOT gain." This is explicitly goal-relative (it compares the goal's implied VDOT against a season anchor), and `capacity-resolver.ts`'s four resolvers are compile-time sealed against ever seeing a goal (§0 of that file). This question is Adaptation Engine / Coaching Thesis territory (Constitution §I), not Pace Prescription (§G) — it is not a duplicate, it is a different owner's question that happens to route through the same underlying VDOT scalar. |

**(b) Duplicate pace/capacity authority — the exact question
`resolveThresholdCapacity` / `resolveHighIntensityCapacity` /
`resolveEasyCeiling` now own.**

| Lines | What replaces it |
|---|---|
| 8942, 8952, 8956, 9010, 9018 | `anchors.thresholdSecPerMi` (+ `anchors.basis.threshold`) — this is the primary authoring-time threshold resolution, and it is the single largest block of duplicate authority in the file |
| 9158, 9159, 10641, 10642 | `anchors.intervalSecPerMi` — and per `recompute-paces.ts`'s own PRESCRIPTION-WIRE-1 precedent, the goal-distance I-pace ELIGIBILITY GATE itself should be deleted, not just have its pace source swapped: high-intensity capacity answers for every runner unconditionally once wired, a marathoner's own 800s are run at their own 3-5K effort, not at a slower pace because of what is on their calendar |
| 9893, 10338 | `anchors.thresholdSecPerMi` at the population-prior/cold-start rung — **but see §3.2's real finding: this is not a safe drop-in swap today** |
| 13048 | Same tier-classification question as 8683/8709 — see the (c) bucket below for why this one needs care, not a naive swap |
| 13298 | `anchors.easyCeilingSecPerMi` — the exact site `recompute-paces.ts` already replaced on the flex path; this is the least risky single swap in the file, because the proof it works already exists in production on a different code path |
| 13886 | The evidence-gathering step `capacity-resolver.ts`'s own `loadVdotFallback` re-implements independently (same `bestRecentVdot` function, slightly different explicit arguments — `180` days here vs. the resolver's own default, `EVIDENCE_RUN_FLOOR_MI` here vs. `CAPACITY_RUN_FLOOR_MI` there, both 3.0 today but two separately-named constants for the same number) |
| 14154 | Third independent computation of the same question 8952 and 13298 already answer — see §1.1 |

**(c) Race Prediction's own VDOT consumption — a different owner (Constitution
§J, not §G), needs its input source moved, NOT its owning function
replaced.**

| Lines | The subtlety |
|---|---|
| 8683, 8709, 9065, 13048 | `predictRaceTime(bestRecentVdot, distanceMi)` for tier classification and the goal-realism flag. `recompute-paces.ts`'s RACEPACE-1 precedent is the model: `achievableRaceTarget` (the Race Prediction function) stays exactly what it is, but its `currentVdot` argument moves from a locally-recomputed VDOT to `anchors.basis.threshold.vdot`, "so the race target and the block's paces are read off the same fitness" (Rule 16). **A naive swap here would reintroduce a real, already-fixed bug.** `composePlan`'s own COLD-1 comment (line ~8675) is explicit that `demonstratedPaceSec`/tier classification is deliberately NEVER backfilled with `conservativeVdotFromMileage`, because a mileage self-report is not demonstrated capacity and feeding it in is "exactly how a typed goal time used to authorize advanced-tier volume off zero evidence." But `anchors.basis.threshold.vdot` CAN legitimately be `vdot_fallback`-or-worse sourced — the canonical resolver's own bottom rungs reach `conservativeVdotFromMileage` too, just through a different door. A future migrator wiring these four call sites must gate on `anchors.basis.threshold.sourceMode` (only `direct` / `race_derived` / `inferred` should reach tier classification; `vdot_fallback` and below should behave as `bestRecentVdot == null` does today), not read `anchors.basis.threshold.vdot` unconditionally. This is exactly the kind of gotcha the shadow mechanism exists to catch before it ships. |

---

## 3 · The shadow-compare mechanism — real code

`web-v2/lib/plan/authoring-shadow-compare.ts` (new, ~250 lines). **Zero lines
of `generate.ts` or `spec-builder.ts` changed.** The file has no import of
`mutatePlan`, `persistPlan`, `persistComposedPlan`, or any pool write —
verifiable by grep, and independently proven by the real-account audit test's
own before/after checksum discipline is unnecessary here because the
mechanism structurally cannot reach a write path: it calls exactly two
read-only entry points.

- **The legacy leg** — `composeForUser` (`generate.ts`, already exported,
  already documented as existing "so every verification of a dated plan
  defect... can drive the wiring against real rows, without persisting").
  Unmodified.
- **The canonical leg** — `resolvePrescribedPaceAnchors` (already exported
  from `load-prescription-anchors.ts`), the identical function
  `recompute-paces.ts` / `reanchor-plan.ts` call in production. Unmodified.

The one new function, `canonicalSpecForComposedDay`, is a shadow twin of
`generate.ts`'s own `specForComposedDay` — same day-placement inputs, the six
canonical anchors substituted for the legacy per-call VDOT derivations, in
exactly the shape `recompute-paces.ts` already proved out in production:

```ts
export function canonicalSpecForComposedDay(
  d: DayPlan,
  anchors: PrescribedPaceAnchors,
  legacy: LegacyAuthoringArgs,
  totalWeeks: number,
  goalSec: number | null,
  raceDistanceMi: number,
): { paceTargetSPerMi: number | null; spec: ReturnType<typeof buildWorkoutSpec>['spec'] } {
  const canonicalRacePaceSec = achievableRaceTarget({
    goalSec,
    currentVdot: anchors.basis.threshold.vdot,
    raceDistanceMi,
    totalWeeks,
  })?.paceSPerMi ?? null;

  const raceGoalPaceSec = d.raceGoalPaceSec !== undefined ? d.raceGoalPaceSec : (legacy.goalPaceSec ?? null);
  const prescribedRacePaceSec = d.raceGoalPaceSec !== undefined ? null : canonicalRacePaceSec;

  const built = buildWorkoutSpec(
    d.type, d.distanceMi,
    anchors.thresholdSecPerMi,          // tPaceSec — legacy weekT's canonical twin
    legacy.lthr,
    d.subLabel,
    legacy.maxHr ?? null,
    raceGoalPaceSec,
    anchors.intervalSecPerMi,           // iPaceSec — unconditional, per PRESCRIPTION-WIRE-1
    anchors.easyCeilingSecPerMi,        // easyAnchorTSec
    d.effortCued === true,
    prescribedRacePaceSec,
    anchors,                            // the argument every real caller still passes null
  );
  return { paceTargetSPerMi: built.paceTargetSPerMi, spec: built.spec };
}
```

`runAuthoringShadowCompare(input: GenerateInput)` calls `composeForUser` once,
reproduces `persistComposedPlan`'s exact legacy-args construction (copied
statement-for-statement, not re-derived — so the "legacy" leg of the
comparison is provably what would actually ship, not a re-implementation that
could quietly answer a different question), calls
`resolvePrescribedPaceAnchors`, and for every composed day calls both
`specForComposedDay` (real, untouched) and `canonicalSpecForComposedDay` (new,
shadow), producing a per-day `{legacy, canonical, paceDeltaSPerMi}` record.

### 3.1 · Why the "flag" is a separate function, not a boolean inside `generate.ts`

The brief asked for the comparison "behind a flag/parameter that defaults to
not affecting persisted output." Given `generate.ts` is 14,236 lines, the
single largest and most heavily-gated file in the plan engine, and several
other sessions were touching adjacent files the same night (per this
worktree's own isolation), the safer reading of that instruction — the one
this pass took — is: **the flag is which function a caller reaches for.**
`specForComposedDay` is real, untouched, and every real caller still gets it
unconditionally. `canonicalSpecForComposedDay` is reachable only from this
file and its own tests. A boolean living inside the real authoring function is
one accidental default away from changing what a live plan persists; a
function nothing in the real path imports cannot, structurally, do that. This
is named here explicitly as the interpretation chosen, for a human to
disagree with if a different shape is preferred for the eventual live wiring.

### 3.2 · Gate compliance (Rule 18, Rule 20)

The new files were run through the project's own enforcement scripts, not
just `tsc`:

- `check-doctrine.sh` — pass (662/662, 323 citations resolve)
- `check-normal-window.sh` — pass
- `check-coercion.sh` — **caught a real Rule 11 violation on first run**
  (`v > 0 ? v : null` reproducing generate.ts's own coercion shape while
  reading `prescribed_race_pace.pace_s_per_mi`), fixed by restructuring into
  explicit guard clauses with a named invariant (a pace can never legitimately
  be zero, unlike a count or distance) rather than adding an exemption —
  Rule 18's first-preference remedy. Re-run: 35/35 pass.
- `check-swallowed-failure.sh` — pass (25/25)
- `check-generated-content.sh` — **caught a real module-orphan finding**:
  `authoring-shadow-compare.ts` has no runtime importer by design (it is
  shadow-only). Added to `MODULE_ORPHANS` with an argued reason naming this
  report and the explicit boundary that a runtime importer here would be the
  defect the report exists to prevent. Re-run: 258/258 pass.
- `check-coach-voice.sh`, `check-client-graph.sh` — pass

---

## 4 · Structured diffs — the owner's real account

Run via `web-v2/lib/plan/_authoring_shadow_compare.audit.test.ts`, read-only,
against the `faff_readonly` Postgres role, `npx vitest run
lib/plan/_authoring_shadow_compare.audit.test.ts`. Account
`0645f40c-951d-4ccc-b86e-9979cd26c795`, race `cim`, 2026-08-31, 14-week
marathon block, 98 composed days.

**Canonical anchors resolved:**

| Anchor | Pace | sourceMode | confidence |
|---|---|---|---|
| threshold | 7:10/mi | `direct` | 0.73 |
| interval | 6:47/mi | `vdot_fallback` | 0.29 |
| repetition | 6:11/mi | — | — |
| easy ceiling | 8:22/mi | `direct` | 0.63 |
| shakeout | 8:52/mi | — | — |
| marathon | 7:55/mi | `direct` | 0.73 (exponent 1.087, personally evidenced) |

**Quality pace by phase (mean canonical − legacy, s/mi):**

| Phase | Days | Mean Δ |
|---|---|---|
| QUALITY | 11 | −2s |
| RACE-SPECIFIC | 6 | −5s |
| TAPER | 4 | +11s |

**Easy/long ceiling:** legacy 8:39/mi vs. canonical 8:22/mi, Δ −17s (the
canonical resolver reads the easy ceiling slightly faster).

**Race-specific work:** the plan's own race day and three of the four
embedded tune-ups land within 0–6 s/mi of each other; the fourth
(`race_week_tuneup`, +3s) is inside the same band.

**Warm-up/cool-down:** legacy mean 1.97mi warm-up / 1.76mi cool-down vs.
canonical 1.97mi / 1.75mi — effectively identical, as expected, since neither
leg's warm-up/cool-down sizing formula was touched.

**HR guidance:** byte-identical on both legs by construction (`hr_cap_bpm` is
a pure function of `lthr`/`maxHr`, which the shadow leg deliberately holds
fixed — it is not part of this migration's scope).

**Total stress proxy** (Σ (canonical − legacy) × distanceMi over quality
days): **+6 s·mi** — a negligible net difference across the whole block.

**Structural diffs** (kind or rep_count mismatch, not just a point pace
difference): **none.** Every day's workout structure — reps, sets, rest,
kind — is identical between the two legs; only the pace numbers inside that
identical structure differ.

**Discontinuities (Rule 9):** none observable from a single real account at a
single point in the input space — a single generated plan is one point, and a
cliff requires walking adjacent inputs. That coverage is in §6's new tests,
not this section; see there for what the continuity walk found (nothing, on
this file's new code).

**On this account, for this well-evidenced runner, the two paths agree
closely.** The largest single-day divergence anywhere in the 98-day block is
+23s/mi (two hill-repeat days whose legacy leg used a cruise-interval
`T − 18` approximation the canonical `anchors.intervalSecPerMi` reads more
precisely). No day flips between "quality" and "easy" character, no rep count
changes, no warm-up/cool-down category shifts.

---

## 5 · Structured diffs — the DB-backed corpus, and why it isn't `_sweep_allusers`

**`resolvePrescribedPaceAnchors` is DB-backed per `userId`.** There is no way
to run a synthetic `ComposePlanInput` archetype — the kind `_sweep_allusers`'s
11,598-row corpus is built from, with no backing `users` row — through it at
all. This is not a gap in this pass's effort; it is structural. Per Rule 15's
own finding about that exact corpus ("its `Arc` type has no
`dailyMiMostRecentFirst`... `hist` is null for every archetype"), the
synthetic fixtures were never going to exercise a DB-backed evidence ladder
regardless of what this migration did.

**What was reachable instead: every real account this database holds.**
Queried fresh (not hardcoded), rather than assumed:

| Account | Runs | Mode | Threshold sourceMode | Legacy T | Canonical T | Mean quality Δ |
|---|---|---|---|---|---|---|
| owner (`dnitch85@me.com`) | 270 | race-prep, marathon | `direct`, conf 0.73 | — | 7:10/mi | −2 to −5s (see §4) |
| `qa-phone-onboard-…` | 0 | race-prep, half | `population_prior`, conf 0.10 | 7:42/mi | **10:42/mi** | **+107s** (7 days) |
| `qa-phone-verify-…` | 0 | maintenance | `population_prior`, conf 0.10 | 10:42/mi | 10:42/mi | — (no quality days) |
| `qa-race-…` | 0 | maintenance | `population_prior`, conf 0.10 | 7:56/mi | 10:42/mi | — (no quality days) |
| `apple-review@faff.run` | 0 | race-prep, marathon | `population_prior`, conf 0.10 | 7:43/mi | **10:42/mi** | **+169s** (3 days) |

Every zero-run account produced a full comparison — none refused at either
leg. 4/4 other real, DB-backed accounts compared cleanly (0 refused at the
canonical anchor stage, 0 refused at `composeForUser`).

### 5.1 · The real finding: the population-prior rung diverges by ~35%, not a few seconds

This is the single most important result in this report, and it did not show
up on the owner's own account because his threshold read is `direct` — the
divergence lives entirely at the bottom of the ladder, exactly where a
brand-new runner's FIRST plan is authored.

**Root cause, traced to the source, not inferred:**

- The legacy cascade's cold-start floor
  (`generate.ts:13845-13872`, `loadGeneratorInputs`) reads
  `profile.history_avg_weekly_mi` — the runner's own SELF-REPORTED onboarding
  weekly-mileage average — the moment real measured mileage reads zero. This
  is deliberate, doctrine-cited behavior (comments tagged `COLD-2`,
  `HIGHVOL-1`): "Seed the zeros from the runner's SELF-REPORTED onboarding
  baselines — the documented purpose of `profile.history_*`."
- The canonical resolver's cold-start floor
  (`capacity-resolver.ts`'s `loadVdotFallback` → `priorWeeklyMi` →
  `normalWeeklyMileage`) reads **only `runs`**, Rule-8-filtered. It has no
  path to `profile.history_avg_weekly_mi` at all — confirmed by reading
  `normal-window.ts`'s `normalWeeklyMileage`, which calls `mileageByDay`
  (real logged runs) and nothing else. For a zero-run account this correctly,
  honestly refuses (`NormalReading.ok === false`), and
  `priorWeeklyMi`'s refusal branch floors to `weeklyMi: 0` — which
  `conservativeVdotFromMileage(0)` turns into the VDOT-30 floor, `tPaceFromVdot(30)
  ≈ 10:42/mi`.

**Both sides are individually defensible and internally consistent with their
own stated doctrine.** `capacity-resolver.ts`'s own header is explicit that
`normalWeeklyMileage`, not an unfiltered reader, is the correct input for a
habit-shaped question (Rule 8's own corollary). The legacy cascade's
`COLD-2`/`HIGHVOL-1` comments are equally explicit and equally doctrine-cited
that a self-report is the right thing to seed a cold-start pace floor from
when no measurement exists at all — `conservativeVdotFromMileage`'s own
header (quoted inside `capacity-resolver.ts` itself) even describes exactly
this use: "a self-reported weekly mileage bucket." **The gap is that
`loadVdotFallback` never actually wires that self-report in** — it was built
to answer "what does this runner's LOGGED training look like as habit,"
which is the right question for the Rule-8 corollary, but it is not the same
question the legacy cascade's `COLD-2` fallback answers, which is closer to
"what did this runner tell us at onboarding, when we have no measurement at
all." `capacity-resolver.ts`'s own Rule-22 section ("what this cannot fail
on") does not name this gap.

**Product consequence, stated plainly: every runner's FIRST plan — the one
authored the day they finish onboarding, before they have logged a single
run — would be paced at the near-beginner VDOT-30 floor under the canonical
path, regardless of what they typed about their own running history at
signup, until this is fixed.** That is a categorical difference in kind, not
degree, and it affects the exact population (brand-new sign-ups) that a first
authoring pass is by definition serving.

**This is not a decision this pass makes.** Whether the intended fix is
threading `profile.history_avg_weekly_mi` into `loadVdotFallback` as a new,
explicitly-marked `population_prior` evidence source (matching the legacy
cascade's own provisional-mileage discipline — `provisional_mileage`,
three readers refuse to inherit it), or whether the product intent has
actually changed and a self-report genuinely should not carry a runner past
the true population floor until a real run lands, is exactly the kind of
call CLAUDE.md's "decisions" bucket names: state the decision, state the
options, pause. Named here as the largest single open question this report
produces.

---

## 6 · New tests

`web-v2/lib/plan/_authoring_shadow_compare.test.ts` — pure, no database, 11
tests, all passing:

- **Continuity (Rule 9), 3 tests** — walks the threshold anchor in 1s/mi
  steps across a 100s/mi range and asserts no >1s/mi jump in a
  tempo/threshold day's headline pace, no >1mi jump in a long run's
  warm-up/cool-down, and no oscillating rep-count flip on an intervals day.
- **Monotonicity, 2 tests** — a slower threshold anchor never produces a
  faster tempo pace; a slower easy ceiling never produces a faster easy-day
  pace band.
- **Goal isolation, 3 tests** — a threshold day and an easy day's pace band
  price identically across a null goal, a 3:00 marathon goal and a 5:00
  marathon goal (proving the new wiring does not leak goal data into
  capacity-derived fields it has no business touching); a control test
  proves this isn't "nothing ever changes" by confirming a RACE day's pace
  legitimately does move with the goal.
- **Extreme inputs, 3 tests** — an elite-fast threshold anchor (4:40/mi) does
  not crash and keeps warm-up/cool-down sane; a below-table-slow anchor
  (13:20/mi) produces no negative or non-finite pace anywhere across five
  workout types; a null `repetitionSecPerMi` (Rule 11's below-table branch)
  does not crash a rep-pace day.

**Falsified before being trusted (Rule 18):** the monotonicity test was run
with its assertion deliberately inverted (`toBeLessThan` in place of
`toBeGreaterThanOrEqual`) and confirmed to fail with a real assertion error
(`expected 360 to be less than -Infinity`) before being reverted to its
correct form. This is not asserted in the file's own comments as a general
claim — it was actually run, both directions, in this session.

`web-v2/lib/plan/_authoring_shadow_compare.audit.test.ts` — the real-account
harness in §4/§5, 2 tests, all passing (one against the owner's own account,
one sweeping every other real DB-backed account with an active plan).

**Full regression sweep, this worktree, this session:**

| Suite | Result |
|---|---|
| `tsc --noEmit`, whole project | 0 errors |
| `lib/plan/` | 132 files, 2059 passed, 8 skipped |
| `lib/training/` + `lib/audit/` | 66 files, 1021 passed |
| `check-doctrine.sh` | pass, 662/662, 323 citations |
| `check-normal-window.sh` | pass |
| `check-coercion.sh` | pass, 35/35 |
| `check-swallowed-failure.sh` | pass, 25/25 |
| `check-generated-content.sh` | pass, 258/258 |
| `check-coach-voice.sh` | pass |
| `check-client-graph.sh` | pass, 24/24 |

One pre-existing, unrelated flake was found and root-caused during
verification, not introduced by this work: `_durability_anchor.audit.test.ts`
failed with "the server does not support SSL connections" when this
worktree's `.env.local` carried only `DATABASE_URL_RO` and not `DATABASE_URL`
— that test file (unlike the `_adaptation_engine.audit.test.ts` /
`_authoring_shadow_compare.audit.test.ts` convention of overriding
`process.env.DATABASE_URL = RO` inside the test body) relies on
`vitest.setup.ts` loading `DATABASE_URL` directly, which was simply unset in
this minimal worktree env. Fixed by pointing this worktree's own
`web-v2/.env.local` `DATABASE_URL` at the same read-only role (never the
write-capable one) rather than leaving it unset. Confirmed: this file's own
new tests never depended on this, and the fix touches only a gitignored,
untracked env file, not committed code.

---

## 7 · Worktree currency (Rule: "a worktree's starting branch is often NOT
current")

This worktree's assigned base branch predated the entire `web-v2`/`native-v2`
rewrite — `web-v2/lib/plan/generate.ts` did not exist in the checkout at all,
the tree still held `web/`, `ios/`, root-level `BUILD_PLAN.md`, and
AppleDouble `._*` sidecars, and it sat **3,741 commits behind `origin/main`**
(8 commits ahead, all pre-rewrite work unrelated to this task). Following
CLAUDE.md's explicit instruction ("confirm your base is current... a
worktree's starting branch is often NOT current") and the matching memory
entry ("`ls web-v2` missing" is the exact tell), a fresh branch
(`canonical-authoring-migration-20260901`) was created from `origin/main`
inside this same isolated worktree — not the shared root checkout, which
other sessions were using — before any of the work above began. `git fetch`
was re-run once more before writing this document; three commits had landed
on `origin/main` in the interim, none touching `generate.ts`,
`spec-builder.ts`, `capacity-resolver.ts`, `prescription-resolver.ts`,
`load-prescription-anchors.ts` or `recompute-paces.ts` (confirmed by
`git diff --stat`), so this report's line numbers and findings are current
against `origin/main` as of the DB reads in §4/§5.

**Post-write update.** Before finishing, `origin/main` was fetched once more
and a fourth commit (`7800d72b`, an unrelated HR-contingency-rule refactor
touching two lines of `spec-builder.ts`, nothing this work reads) had landed.
The branch was rebased cleanly onto it (`git rebase origin/main`, no
conflicts, working tree clean, `git rebase --continue` completed on the
first try) and the full verification in §6 was re-run afterward — same
results, all green. The branch named below is current against `origin/main`
at the moment this report was finished, not merely at the moment it was
started.

---

## 8 · Honest assessment — is this "coaching-sensible"? (my own read, for a
human to weigh)

**On the owner's real, evidence-rich account: yes, closely.** The largest
single divergence anywhere in a 14-week, 98-day marathon block is 23 seconds
per mile on two hill-repeat days, the structure of every workout is
byte-identical between the two paths, and the net "total stress" shift across
the whole block is a handful of seconds-times-miles — noise, not a defect.
Where the two paths do disagree, the disagreements are individually
explicable: the canonical resolver reads interval pace off a purpose-built
high-intensity capacity read rather than an approximated cruise offset, and
the easy ceiling reads slightly faster off `resolveEasyCeiling`'s own
direct-evidence tier. Neither looks like a regression; both look like the
canonical layer answering its own question a little more precisely than the
formula it replaces.

**On every cold-start account this database holds: no, not yet, and the gap
is large enough to block a switch on its own.** A ~35% slower threshold pace
for a runner's very first plan is not a rounding difference — it would
change a brand-new marathon-goal runner's opening week from "7:43/mi quality
work" to "10:42/mi quality work," which is a different plan in kind, not
degree, and it would do so silently, for every single first-time authoring,
because that population is by definition zero-run. §5.1 traces the exact
root cause and the exact file (`capacity-resolver.ts`'s `loadVdotFallback`)
that would need to change, and names the two live options rather than picking
one. **This alone is sufficient reason not to switch authoring over tonight**,
independent of anything else in this report.

**The structural finding in §1.1 (one question, three independent
computations) and the goal-isolation gotcha in the (c) bucket (§2) are both
worth fixing as part of whatever pass does the eventual wiring — the first as
a straightforward simplification, the second as a correctness requirement,
not an optional cleanup.**

This is my own read, clearly labelled as such, for a human reviewing this
report to weigh — not a decision, and not something this pass acted on.

---

## 9 · The boundary this pass held, and where the work lives

**No line of `generate.ts` or `spec-builder.ts` was touched.** No plan any
real user reads was regenerated, mutated, or persisted differently than it
would have been without this work. Every DB access ran through the
`faff_readonly` role. The only file outside `lib/plan/authoring-shadow-
compare.ts` and its two test files that changed is
`lib/audit/generated-content-registry.ts`, adding one argued
`MODULE_ORPHANS` entry so the project's own enforcement gate stays green and
honest about the new file's deliberately-unreachable-from-runtime status.

**Given the size and risk of this change — a 22-call-site inventory touching
the largest, most heavily-gated file in the plan engine, on a night several
other sessions are independently landing work on `main` — this work is being
left on its own branch (`canonical-authoring-migration-20260901`) rather than
merged.** The brief's own step 8 (switching authoring over) is explicitly
gated on human review of exactly the diffs in §4/§5, and step 9 (deleting
legacy) is further gated behind step 8. This report is the evidence for that
review, not a proposal to skip it. The branch is a clean, additive diff
against `origin/main` (`git diff --stat` shows three new files and one
one-entry registry addition) and should dry-run-merge without conflict
whenever it is reviewed — no file it touches has moved on `origin/main` since
this branch point (§7).
