# Plan Generator — external review

**Scope.** The block architecture: how a 14-16 week training block gets
authored — phase structure, weekly volume, long-run sizing, the whole-block-
vs-flex split — not the day-to-day workout-identity selection inside a
composed week (catalogue vs. generic-slot trajectory, pace-band sizing,
"why this workout"), which a sibling report published the same night already
covers in depth (`docs/reports/workout-selection-external-review-2026-08-31.md`).
That report explicitly scoped itself away from block architecture; this one
is the other half. Everything below was read from the live repository on
`main` on 2026-08-31, and the test/gate numbers were produced by actually
running the suite on that date, not recalled from a commit message.

The two files named in the brief — `web-v2/lib/plan/generate.ts` (14,199
lines) and `web-v2/lib/plan/spec-builder.ts` (1,991 lines) — plus their real
supporting cast, traced from the actual import graph rather than assumed:
`goal-tiers.ts` (phase/tier constants), `intensity-distribution.ts`,
`quality-day.ts`, `workout-catalogue/select.ts` (via `catalogue-rx.ts`),
`validate.ts`, `mutate.ts`, `recompute-paces.ts` and `reanchor-plan.ts` (the
pace-flex path), `adaptive-ramp.ts` (the volume-flex path), and
`lib/training/vdot.ts` (the still-live VDOT cascade).

---

## Executive summary

The Plan Generator is a large, mature, heavily doctrine-cited system with a
genuinely coherent phase architecture that matches Brief 04's prescribed
shape (general → specific → race-specific → taper) almost exactly, and a real
"whole block authored, two axes flex" architecture that is actually
implemented as described in `docs/PRODUCT_DECISIONS.md` — not just claimed.
It has an unusual, well-documented history of real, production-shipped
defects (Rule 9's discontinuity cliffs, Rule 12's easy-day-as-residual bug,
the SPIKEROLL-1 spike rule), and — checked directly rather than assumed —
**every one of those specific defects this review could verify is now fixed
and gated**, including two where the repository's own standing documentation
(`docs/PRODUCT_DECISIONS.md`, `docs/spikeroll-1-handback.md`) is now stale
and says otherwise. That staleness is itself a finding, not a footnote — see
§3.

Three things are worth an outside opinion:

1. **`generate.ts` still runs the old VDOT cascade for every authored
   plan.** Tonight's new Runner Model / Pace Prescription layer
   (`capacity-resolver.ts`, `prescription-resolver.ts`) is wired into the
   pace-**flex** path (`recompute-paces.ts`, `PRESCRIPTION-WIRE-1`) but not
   into full-block **authoring** — confirmed by 23 direct call sites of
   `tPaceFromVdot`/`resolveCurrentTPace`/`vdotFromRace`/etc. still in
   `generate.ts`, and by `capacity-resolver.ts`'s own header, which names
   `generate.ts` and `spec-builder.ts` as explicitly untouched. This matches
   what the task brief expected, and is not itself a defect — it is a named,
   in-progress migration — but it means a runner's *first* plan is priced by
   the legacy cascade the rest of the app is actively moving away from, and
   only stops being priced by it once the flex path rewrites an unrun week.

2. **The doctrine-citation gate is currently red, for exactly the file this
   report covers, and nobody has re-pointed it.** `_doctrine_gate.test.ts`
   fails 4 of 658 tests right now, all four bound to
   `spec-builder.ts#buildWorkoutSpec`'s easy/tempo/marathon/interval pace
   formulas. The formulas were legitimately refactored (to accept the new
   `anchors` parameter as an optional override) as part of the same
   prescription-wiring effort in finding 1 — but the citation gate's regex
   still hunts for the old unconditional literal expression and no longer
   finds it. This is Rule 18/20's exact target class: a gate that stopped
   watching and nothing noticed. See §4.

3. **`layoutWeek` is a 3,141-line, ~40-parameter function — 22% of the
   entire file by itself.** It is the single largest concentration of
   per-week authoring logic in the codebase and a real complexity/
   maintainability risk, even though — checked directly — it does not appear
   to cross an ownership boundary (it places days and sizes sessions; it does
   not invent physiology). See §5.

Test suite: the full `lib/plan/` vitest run passes cleanly most of the time
(126/132 files, ~2028-2030/2036-2038 tests), but **is not fully
deterministic** — `reanchor-plan.test.ts` intermittently fails 3 of its 12
tests when run inside the full batch (reproduced twice), while passing
12/12 every time it runs alone. That is a test-isolation problem, not (as
far as could be determined) a product defect, but it means "green" from this
suite is not currently a fully trustworthy signal on the first try. See §6.

---

## 1. What the Plan Generator actually does, end to end

### 1.1 Entry points and inputs

Eight live call sites feed `generatePlan()`/`composeForUser()`: the goal and
race API routes, the block-preview route, the plan generate/proposal/replan
routes, the plan simulator, onboarding completion, `auto-rebuild.ts`,
`open-block.ts`, and `result-chain.ts` (post-race re-anchoring). This is a
heavily-invoked, live production path, not a legacy corner.

`GenerateInput` (line 388) accepts, confirmed against the real signature:

- `userId`
- `raceSlug` **or** `goalTarget: { distanceMi, goalSec, raceDateISO }` —
  mutually exclusive; a race-anchored plan reads distance/date/goal off the
  `races` row, a goal-anchored plan (no race row) synthesizes the same three
  fields from a stated fitness goal. Both converge on the identical
  downstream pipeline — "every distance gets a real build," per the code
  comment.
- `openTarget` — the no-target ("just run") path; resolves to today +
  `openBlockShapeAnchorMi()`, `goalSec = null`.
  `planAuthorshipUnsupported()` gates ultra distances (50K+) out of all three
  paths with one shared refusal string, rather than silently capping them to
  marathon doctrine (a fixed, cited P1-41 defect).
- `startAnchor: 'today' | 'monday'` and optional `startDateISO` — onboarding
  starts week 0 today (no past-dated prescriptions); an established runner's
  regeneration starts Monday.

`loadGeneratorInputs()` (717 lines, the largest loader in the file) then
resolves that into `ComposePlanInput` — confirmed fields include
`raceDistanceMi`, `goalSec`/`goalPaceSec`, `courseTerrain`, `raceDateISO`,
`startMondayISO`, `level`, `recentWeeklyMi`, `rampBaseMi` +
`rampBaseEvidence`, `easyDayMedianMi`, `recentLongMi`, `spikeAnchorLongMi`,
`recentQualityDistanceMi`, `recentQualityPerWeek`, `bestRecentVdot` (+
`bestRecentVdotSelfReported`), plus injury/return, availability and
travel-window carriers threaded further down. This is a superset of Brief
04's stated minimum input list (goal, race distance/date, current fitness,
durability, current weekly volume, recent longest run, training frequency,
history, available days, injury/return state, experience level) — every
named minimum input is present, several times over in provenance detail
(e.g. `bestRecentVdotSelfReported` distinguishes a typed PR from a measured
one, which Brief 01's fallback-ladder doctrine explicitly asks for).

### 1.2 Phase structure

`sizeBlocks()` (line 2791) confirms the phase list is exactly Brief 04's
shape, under different labels: **BASE → QUALITY → RACE-SPECIFIC → TAPER**,
each with a `rationale` and a `Research/` citation baked into the returned
`BlockPlan`. `BASE` = general development, `QUALITY` = specific development,
`RACE-SPECIFIC` = race-specific preparation, `TAPER` = taper. Taper length is
fixed per distance category (`BLOCK_SHAPE[cat].taperWeeks`, doctrine-bound
and CI-checked — see §3). `isMidBlock` can skip `BASE` entirely for a runner
already doing quality work, folding those weeks into `QUALITY` rather than
demoting them into a fresh aerobic-only block — the mid-block-awareness
doctrine referenced throughout the file's comments.

A recent fix (`RUNWAY-1`, in the same function) caps every phase floor at
what is *actually left* in a short runway rather than an unconditional
minimum, closing a bug where a short-runway plan's phases could sum to
double `totalWeeks` and silently never reach `TAPER` at all — confirmed by
reading the function's own before/after arithmetic proof in its header
comment.

### 1.3 Volume, long-run sizing, and the ramp base

`volumeCurve()` (402 lines) and `cycleBoundedPeak()` (line 3046) determine
the week-by-week weekly-mileage target, bounded by `CYCLE_GROWTH_CEILING`
(a runner cannot jump from a 52 mi/wk peak to a 65-90 mi/wk "advanced" band
in one cycle — confirmed against the CIM-block audit entry in
`PRODUCT_DECISIONS.md`, where this ceiling correctly held a block at 60.14
instead of the tier's aspirational 65-90). `resolveRampBase()` (line 1309)
and `rampBaseForBuild()` decide what the block ramps *from* — normally the
runner's trailing mean, but lifted to a higher base when the mean is
depressed by an engine-mandated taper/recovery window the runner didn't
choose (Rule 8's habit-vs-capability split, and the exact mechanism Rule 9's
"walk A/B" continuity tests exercise — see §3). `cutbackCadence()` sets
deload frequency (every 3rd week under high cumulative load via a Banister
TSB read, else every 4th) and is shared by `volumeCurve` (which cuts weekly
mileage) and `layoutWeek` (which relaxes the long-run floor on the same cut
weeks) — a fixed historical divergence (#13 audit, 2026-06-16) that would
otherwise have deloaded volume while pinning the long run to peak.

### 1.4 Per-week authoring — `layoutWeek`

`layoutWeek()` (line 4020, 3,141 lines, ~40 destructured parameters) is
where a week's shape actually gets decided: which day is long, which days
are quality (via `spacedQualityDowsFromAvailable`/`scheduleQuality`), how
the long run's distance and any embedded race-pace segment are sized
(`racePaceLongThisWeek`), how easy-day distance is set from the demonstrated
floor, and how travel windows / available-day constraints reshape all of it.
Downstream, `embedMidBlockRaces()` (534 lines) inserts tune-up races,
`enforceWeeklyRampCeiling()` (357 lines) and `finalizeComposedPlan()` (767
lines) apply the cross-week guards described in §3 (dosing caps, the spike
rule, the intensity floor) **after** the week-by-week authoring loop
completes — the code comment in the SPIKEROLL-1 hand-back doc is explicit
that this ordering matters: a guard reading pre-finalization values sees
numbers higher than what the runner will actually run, so a guard "has to
read the plan that ships," not the plan mid-construction.

### 1.5 "The block is built whole and flexes on two axes" — verified, not just claimed

`docs/PRODUCT_DECISIONS.md`'s 2026-08-30 entry locks this as David's own
call: all fourteen-plus weeks are authored and visible at once, layout/
session-types/dates/phases/taper are fixed once authored, and only **pace**
and **distance** flex on weeks not yet run. Checked against the actual code:

- **Authoring is genuinely whole-block.** `composePlan()` (1,134 lines) is a
  single call that walks every phase/week in `sizeBlocks()`'s output and
  returns the full composed block; there is no partial-horizon or
  provisional-arc mechanism anywhere in the function.
- **Pace flexes through a real, separate mechanism**: `recompute-paces.ts`
  (722 lines) is the file stamped `PRESCRIPTION-WIRE-1 (2026-08-31)` — its
  own header states it "rewrites every unrun day of a fourteen-week block,"
  deliberately **not** consulting readiness (a tired Tuesday must not write
  a slower November), and it is the file that actually calls the new
  `resolvePrescribedPaceAnchors`/`prescription-resolver.ts` layer — see §2.
- **Distance/volume flexes through a genuinely different mechanism**:
  `adaptive-ramp.ts` implements the weekly-target and long-run "bump" (+5%
  weekly, +1mi long, both capped at the tier band), gated on readiness,
  two consecutive earned-progression quality sessions, a clean long run, and
  a 7-day cooldown. Notably, this module's own header records that it was
  **wired, cron-mounted, unit-tested, and inert for its entire life** until
  2026-08-30 — a second gate inside it read a `runs.data->>'type'` field
  that has never held a session type, so the bump condition was never
  jointly true. This is the same "wired but never fires" failure shape
  CLAUDE.md's Rule 21 names for the adaptation layer generally, caught and
  fixed in the volume-flex half of this exact "two axes" architecture the
  same night the architecture was locked.

So the architectural claim in `PRODUCT_DECISIONS.md` is not aspirational —
both flex mechanisms exist, are structurally separate from `generate.ts`'s
authoring pass, and (as of the 2026-08-30/31 fixes) are both live rather
than dormant.

---

## 2. Ownership boundary check against `BRAIN_CONSTITUTION.md`

`§H. Plan Generator` states: "Consumes Coaching Thesis, Runner Model,
readiness constraints, goal/race requirements, training phase, available
days, recent training, load history, adaptation decisions... **Does not
calculate threshold fitness, race prediction, readiness, evidence
confidence, adaptation eligibility — it USES those answers, never recreates
them.**"

**Checked directly, this boundary is not yet honored for pace, and the repo
already says so — the question is whether that's still accurately
communicated.**

- `generate.ts` still imports and directly calls the legacy VDOT cascade:
  `tPaceFromVdot`, `vdotFromTpace`, `iPaceFromVdot`, `iPaceFromAnchorPace`,
  `vdotFromRace`, `predictRaceTime`, `resolveCurrentTPace`,
  `conservativeVdotFromMileage`, `computeBestRecentVdot` — **23 call sites**
  across the file, including the primary threshold-pace resolution at
  authoring time (`currentTResolved = resolveCurrentTPace(...)`, line 8923)
  and the entire race-realism/goal-flagging logic (lines 9029-9130).
- Neither `capacity-resolver.ts` nor `prescription-resolver.ts` is imported
  by `generate.ts` **at all** — not even type-only.
- `spec-builder.ts` imports `prescription-resolver.ts` **type-only**
  (`import type { PrescribedPaceAnchors }`), specifically so that the
  runtime import graph is unaffected (the file's own comment cites Rule 19's
  `check-client-graph.sh` as the reason). `buildWorkoutSpec()` now takes an
  optional `anchors: PrescribedPaceAnchors | null = null` parameter that,
  when supplied, replaces five fixed-offset formulas (easy = T+80, tempo =
  T, marathon = T+18, interval = T-18, etc.) with the caller's resolved
  capacity read. But **every authoring caller today passes nothing, and the
  function's own doc comment says so explicitly**: *"NULL — the default,
  and every authoring caller today — leaves this file byte-identical."*
  `generate.ts`'s two call sites (lines 10615 and 11758) both omit the
  argument.
- `capacity-resolver.ts`'s own file header is unambiguous and matches this
  exactly: *"NOT WIRED. `generate.ts`, `spec-builder.ts`, `reanchor-plan.ts`,
  `recompute-paces.ts`... are all untouched by this change and still
  resolve paces the old way. Wiring them is the NEXT phase."* — except that
  claim is now **half true and half stale in the same sentence**:
  `recompute-paces.ts` is no longer untouched. It is the file that already
  imports `resolvePrescribedPaceAnchors` from
  `lib/training/load-prescription-anchors.ts` (the DB-shell wrapper around
  `prescription-resolver.ts`) and calls it for real, at runtime, to rewrite
  every unrun day of the block. `generate.ts` and `spec-builder.ts`
  (for authoring) remain genuinely untouched, matching the claim; but the
  header sentence as written no longer accurately describes its own
  neighbor file, because that neighbor was wired the same night the header
  was written or shortly after.

**Verdict on this boundary: not a violation as defined by BRAIN_CONSTITUTION
§8** ("during migration: OLD → shadow only, NEW → authority... never
'sometimes old, sometimes new, depending on screen'") — because the split
here is not screen-dependent, it is **authoring-vs-flex-dependent**, which is
an explicit, named, single migration boundary, not an ad hoc one. A plan's
Tuesday threshold pace is priced by the old cascade the moment it is
authored and by the new resolver the moment `recompute-paces.ts` next
touches that unrun day — one rule, consistently applied, just not yet
finished. But the *documentation* of that boundary (the header comment in
`capacity-resolver.ts`) is already one file out of date, which is worth
fixing cheaply before the next reader trusts it at face value.

---

## 3. Real defect history in this file — checked against the live code, not memory

CLAUDE.md's Rules document an unusual number of production-shipped defects
specific to `generate.ts`. Checked directly, one at a time:

| Defect | Doc claims | Verified state (2026-08-31) |
|---|---|---|
| **Rule 9's five discontinuity cliffs** (`resolveRampBase`, `interruptionWeeks`, long sizing at ~3489, `achievable-target.ts`, taper restore) | Fixed via `_restore_continuity.test.ts` + `_coach_sensible.test.ts` | `_restore_continuity.test.ts` passes. `_coach_sensible.test.ts` (the phase-structure/continuity walk) passes **6/6**, including the two continuity walks (A: 28-day-mean crossing 0.70×sustained; B: `interruptionWeeks` crossing the resume level). |
| **`PRODUCT_DECISIONS.md` 2026-08-30 §6: "The phase-structure gate stays RED. Not loosened."** | Documented as a deliberately-red gate, held open pending a real fix (hysteresis or a more robust input) | **Stale.** Commit `81bf30eb` (`fix(rule9): the last cliffs — an interruption is measured in weeks OFF, and easy running stops quantising the week`) fixed it the same night by exactly the remedy the decision entry called for — the gate is green as of this report. The decision-log entry was never updated to close the loop. This is a documentation gap, not a re-litigated engineering call: the fix took the argued-for form (a more robust input), it just landed after the entry was written. |
| **Rule 12's easy-day-as-residual bug** (`flooredPerEasy = min(effectiveFloor, perEasyBudgetCap)`, `_coach_sensible.test.ts` "an easy day is long enough" case) | "Deliberately RED while open," per CLAUDE.md's Rule 12 text | Also fixed, same commit (`81bf30eb`, `RULE12-RESIDUAL-1`) — the "an easy day is long enough to be the run doctrine describes" test in `_coach_sensible.test.ts` passes. |
| **`docs/spikeroll-1-handback.md`: "the 110% spike rule... HELD BACK... NOT landed on `main`."** | Written, verified, `void enforceSpikeRule;` beneath the code so it compiles but does nothing, blocked on moving four protected answer keys (334 `_sweep_allusers` failures, 12 `_dosing_sweep_gate` breaches, `_audit_long_ramp` red, `RAMP.single-session-spike` red, `_audit_periodization` snapshot moving) | **Stale — landed.** `enforceSpikeRule()` is called for real (`generate.ts:11398`), not voided. Commit `ecb5972c` (`feat(spikeroll-1): land the 110% single-run spike guard, held back one cycle`) shipped it with an argued, cited exemption for anchors under a 5-mile "coherence floor" (below 5mi, a 0.5mi grid step cannot express a 110% ratio at all — `floor(2 × 1.10 × 2)/2 = 2.0`, an exempt-but-still-guarded population per `layoutWeek`'s own pre-finalization `rampCeiling`). All four previously-blocking gates are green now: `_sweep_allusers` (0 firm failures, 11,598 archetypes), `_dosing_sweep_gate` (0 enforced breaches), `_audit_long_ramp` and `_audit_periodization` both pass. |
| **The "sub-5mi runners" open question the task brief expected to still be live** | — | Resolved with a named, cited convention (`SPIKE_MAX_SHARE`/the 5-mile coherence floor, `generate.ts` ~line 2005-2039), not still open. |
| **Dosing-cap enforcement** | Rule 7's log records it CLOSED 2026-08-28, enforced at authoring, corpus-gated | Confirmed: `_dosing_sweep_gate.test.ts` passes (0 enforced breaches across the full archetype matrix), and `applyDosingCaps` is called inside `finalizeComposedPlan`. |

**The pattern worth naming explicitly**: this file's standing documentation
(`PRODUCT_DECISIONS.md`, the spikeroll hand-back doc) is written at a level
of care that makes it genuinely load-bearing — but two separate entries in
it are now factually wrong about the current state of the code, both in the
*safe* direction (understating what has been fixed, not overstating it). A
reader trusting either document today without checking the code would
conclude two real gates are still red when they are green. Given how much
of this repository's own operating discipline (Rules 18, 20) is about not
trusting documentation that nothing verifies, this is worth a cheap,
deliberate closing pass: update both entries to point at the commits that
resolved them, the same discipline Rule 7's registry section already
practices for its own "closed" bullets.

---

## 4. A live, currently-red gate this review found that the task brief did not anticipate

Running `_doctrine_gate.test.ts` (Rule 7's citation-binding enforcement,
`lib/doctrine/registry.ts` + `_doctrine_gate.test.ts`) produces **654 passed,
4 failed, out of 658**. All four failures are bound to
`lib/plan/spec-builder.ts#buildWorkoutSpec` and are the pace formulas
directly implicated in §2's finding:

- `PACE.easy-band-off-threshold` — expects the literal pattern
  `const easyLo = easyAnchorT + (\d+), easyHi = easyAnchorT + (\d+);`
- `PACE.tempo-is-threshold` — expects `tempo` to resolve unconditionally to
  `tPaceSec`
- `PACE.marathon-offset` — expects the literal pattern
  `const mp = tPaceSec + (\d+);`
- `PACE.interval-offset` — expects the literal pattern
  `const interval = tPaceSec - (\d+);`

The actual code (verified, `spec-builder.ts` lines 1040-1060) now reads:

```ts
const easyLo = anchors ? anchors.easyCeilingSecPerMi : easyAnchorT + 80;
const easyHi = easyLo + 40;
const tempo  = anchors ? anchors.thresholdSecPerMi : tPaceSec;
const interval = anchors ? anchors.intervalSecPerMi : tPaceSec - 18;
```

This is the `PRESCRIPTION-WIRE-1` scaffolding from §1.5/§2 — a legitimate,
deliberate refactor, currently behaviorally inert for every authoring caller
(`anchors` is always `null` from `generate.ts` today, so the `else` branch
fires and the numeric behavior is unchanged, as `spec-builder.ts`'s own
comment states). But the doctrine gate's regex-based literal matcher was
never re-pointed at the new conditional expression, so **the gate that
exists specifically to catch an un-cited or drifted physiology constant is
currently blind to this file** — it fails loudly, which is the gate doing
its job (Rule 18: fail loudly rather than report clean on nothing), but it
has been failing since the refactor landed and nothing in this session's
visible history shows it being triaged.

This is exactly Rule 20's target ("a product rule with no gate is a
hypothesis... when a rule IS violated, fix the gate, not just the
instance") — except inverted: here the gate itself needs the fix (re-point
the pattern or export the underlying constant so the claim can import it,
per the gate's own error message), not the engine. The engine's numeric
behavior appears unchanged and doctrine-correct today; what's broken is
purely the enforcement, which means the very next change to `easyLo`/
`tempo`/`mp`/`interval` — including the one that finally flips `anchors`
from always-null to sometimes-populated for authoring — will ship with **no
citation check watching it** unless this is fixed first.

---

## 5. Complexity and internal duplication

**File and function size**, measured directly:

- `generate.ts`: 14,199 lines, 86 top-level functions, ~480 `if` statements,
  4,808 comment lines (~34% of the file — genuinely dense doctrine citation
  and defect-history documentation, not boilerplate).
- The ten largest functions, by line count: `layoutWeek` (3,141),
  `composePlan` (1,134), `finalizeComposedPlan` (767),
  `loadGeneratorInputs` (717), `embedMidBlockRaces` (534),
  `composeMaintenancePlan` (494), `volumeCurve` (402),
  `enforceWeeklyRampCeiling` (357), `composeForUserInternal` (341),
  `composeRecoveryPlan` (315).
- `layoutWeek` alone is **22% of the entire file's line count**, in one
  function, with roughly 40 destructured parameters in its signature.

Measured against `BRAIN_CONSTITUTION.md` §25 ("three levels of code are
enough most of the time... be suspicious if a simple coaching decision
travels through ten abstraction layers") and §24 ("resist micro-services
inside the monolith... prefer small pure helpers"): `layoutWeek` is the
opposite failure mode from the one those sections warn against — not
over-abstracted, but under-decomposed. It does not, on inspection, appear to
cross an *ownership* boundary (every branch inside it is placing a day,
sizing a session, or applying a doctrine-cited rule to this week's own
inputs — it does not invent physiology or recompute fitness), so this is a
**maintainability/operability risk, not a doctrinal violation**. But a
40-parameter, 3,141-line function is a real cost: every reader has to hold
the whole thing in mind to reason about one branch, and the SPIKEROLL-1
hand-back doc's own account of where the guard "had to go, and where it must
not" (§2 of that doc) is exactly the kind of subtle pre-finalization-vs-
final-value distinction that a function this size makes easy to get wrong
twice.

**Internal duplicate-computation risk** (the Rule 16 pattern found on the
Races UI screen tonight, checked for an equivalent inside this file): no
clear instance found. The closest candidate — `predictRaceTime(vdot,
distance)` wrapped in a `Math.round(t / distance)` IIFE, appearing
near-verbatim at four separate call sites (lines ~8654, ~8680, ~9036,
~13011) — is not a duplicate-*logic* risk, because all four calls route
through the one shared `predictRaceTime` function for genuinely different
distances (the plan's own race, a horizon race, the goal distance, a
no-race-anchor branch). It is a minor **mechanical** duplication (the same
five-line pattern typed four times) that could be a single named helper
(e.g. `demonstratedPaceAtMi(vdot, distanceMi)`), but it is not a case of two
places computing the same answer to the same question differently — each
call site is legitimately answering a different question with the one
canonical function. No broader internal-duplication audit of `generate.ts`
was completed to full depth given the file's size; this is a spot-check on
the pattern the task specifically flagged, not an exhaustive sweep.

---

## 6. Test coverage and gate health — real numbers, run just now

`cd web-v2 && npx vitest run lib/plan/`, run three times on 2026-08-31:

| Run | Test files | Tests |
|---|---|---|
| 1 | 126 passed, 6 skipped (132) | 2028 passed, 8 skipped (2036) |
| 2 (piped through grep) | 125 passed, **1 failed**, 6 skipped (132) | 2025 passed, **3 failed**, 8 skipped (2036) |
| 3 | 126 passed, 6 skipped (132) | 2030 passed, 8 skipped (2038) |

**The failure is real and reproducible, and it is a test-isolation problem,
not a product defect as far as this review could determine.** The single
failing file is always `lib/plan/reanchor-plan.test.ts`, and the specific
assertion failures do not correspond to the `it()` block names reported
(e.g. a test named `"5K-build intervals re-anchor to true I-pace"` throws on
an assertion about `shouldReanchorRacePrep`, which belongs to a different
`it()` block later in the same file) — the signature of cross-test state
leakage rather than a genuine logic bug. Run standalone
(`npx vitest run lib/plan/reanchor-plan.test.ts`), the same file passes
**12/12 every time**, with no flakiness observed across repeated runs. The
total test count also drifts by a few between full-suite runs (2028 / 2025 /
2030) even outside the named failure, which is additional, independent
evidence that the full-batch run is not fully deterministic. Per Rule 18
("a gate is not trusted until it has been made to fail... on purpose, then
restore"), this specific non-determinism has not been root-caused here and
should be, since a green run cannot currently be taken as unconditional
confirmation on the first try — a re-run is presently required to
distinguish "real regression" from "batch interference."

**The specific named gates** the task brief asked about, run individually:

| Gate | Result |
|---|---|
| `_sweep_allusers.test.ts` | 1 test, passed (11,598 archetypes swept internally, 0 firm failures) |
| `_maint_invariants.test.ts` | passed |
| `_coach_sensible.test.ts` | 6/6 passed |
| `_dosing_sweep_gate.test.ts` | 2/2 passed (0 enforced cap breaches, full matrix) |
| `_spike_rule_gate.test.ts` | passed |
| `_restore_continuity.test.ts` | passed |
| `_audit_long_ramp.test.ts` + `_audit_periodization.test.ts` (together) | 558/558 passed |
| All five gates above, run together | 27/27 passed |
| `_doctrine_gate.test.ts` (Rule 7, whole-repo scope) | **654/658 passed, 4 failed** — see §4 |

Every gate explicitly named in the task brief is green. The one red gate
found (`_doctrine_gate.test.ts`) was not named in the brief and directly
implicates `spec-builder.ts`, which is in scope.

---

## 7. Open questions worth a second opinion

1. **Is 14-16 weeks authored fully upfront still the right call, given how
   much of it the flex layer already rewrites?** `recompute-paces.ts`
   rewrites the pace anchor on "every unrun day of the block" the moment the
   new resolver has something better to say, and `adaptive-ramp.ts` can bump
   weekly volume and the long run mid-block. The whole-block decision was
   made explicitly for a UX reason (David: "I think the whole block should
   be built... so there's still confidence there in seeing everything") —
   worth checking whether that reasoning still holds now that the flex
   machinery is materially more capable than it was on 2026-08-30, or
   whether the "committed window" design it superseded deserves a second
   look for a narrower reason than the one it was originally proposed for.

2. **Should `PRODUCT_DECISIONS.md`'s 2026-08-30 §6 entry and
   `docs/spikeroll-1-handback.md` be updated now that both describe a red
   gate that is actually green?** Not a technical question, but a process
   one: this review found two separate standing documents describing the
   engine as more conservative/unfinished than it currently is. Given how
   much of this repository's operating discipline depends on those documents
   being trustworthy at face value (Rules 7, 18, 20 all assume a reader can
   trust what a doc claims about gate state), closing the loop on both is
   cheap and the alternative is a slow accumulation of exactly this kind of
   drift.

3. **Is `layoutWeek`'s size a decomposition worth doing, or an accepted cost
   of "one owner, internally complex"?** The function does not appear to
   cross an ownership boundary, so this is not a Brain Constitution
   violation in the strict sense — but a 3,141-line function with ~40
   parameters is a real cost to every future change inside it, and the
   SPIKEROLL-1 hand-back doc's own account of a subtle pre-finalization-vs-
   final-value bug inside this exact area is a concrete illustration of the
   kind of mistake this size makes easier to make. Worth asking whether a
   deliberate decomposition pass (by phase, or by concern — day placement
   vs. distance sizing vs. race-pace segment embedding) is worth scheduling,
   independent of any specific bug.

4. **Should the doctrine gate's literal-pattern matching be made resilient
   to a conditional-branch refactor, structurally, rather than re-pointed
   file by file?** This is the second time in one night a legitimate
   prescription-resolver wiring step has silently broken a citation binding
   (the sibling workout-selection report separately confirms
   `prescription-resolver.ts` is imported type-only across the plan-
   generation path). If the wiring phase is going to touch `easyLo`/`tempo`/
   `mp`/`interval` again soon (which §2 suggests it will, since `anchors` is
   currently always null and presumably will not stay that way), the gate
   will need re-pointing again unless its matching strategy is made more
   robust to "the same physiological constant, now behind a conditional" —
   worth deciding once rather than patching per-occurrence.

5. **Does the sub-5-mile spike-rule exemption need its own standing gate?**
   `docs/spikeroll-1-handback.md` §5 names this as still owed: "the standing
   assertion across the whole block, as a gate (Rule 18), with the 110%
   figure parsed out of `Research/00a` at run time... not written, because a
   gate for a mechanism that is held back would be a gate that has to be
   held back with it." That reasoning no longer applies — the mechanism has
   landed — so the deferred gate is now unblocked and worth prioritizing;
   right now the 5-mile coherence-floor exemption is enforced by the code
   but not independently asserted by a standing test the way the rest of
   Rule 7's registry claims are.

6. **Is the flakiness in §6 worth root-causing before it masks a real
   regression?** A test suite that occasionally reports a false failure
   trains the team to re-run rather than investigate, which is exactly the
   failure mode Rule 18 exists to prevent in the other direction (a gate
   that reports clean when it shouldn't). This one reports *unclean* when it
   shouldn't, which is a smaller cost today but the same underlying
   trust-erosion risk over time.
