# Race Prediction consolidation — 2026-09-01

Follow-up to `docs/reports/race-prediction-external-review-2026-08-31.md`
(the source audit this work executes against). Scope: pick one canonical
personal-exponent source, fix `GoalGap.trajectorySec`, remove
projection-precedence copy-paste outside `race-projection.ts`, and thread
confidence/basis onto runner-facing projections — as far as that is safely
mechanical. Everything requiring real product/design judgment is written up
as a decision + plan below rather than guessed at.

All numbers under "Verified" were read from the live production database
(read-only) against the owner's real account, per CLAUDE.md Rule 13 — not a
fixture, not a mock.

---

## 1. What was found (confirming the external review)

Read `lib/race/coach-goal.ts` and `lib/training/durability-anchor.ts` in
full. Confirmed the review's central finding: two independent fits of the
same physiological quantity — this runner's own cross-distance Riegel
fatigue exponent — existed in the codebase, from the same `races` table,
answering to different callers:

| | `coach-goal.ts` (`fitPersonalExponent`) | `durability-anchor.ts` (`fitRaceExponent`) |
|---|---|---|
| Method | 2-race log-ratio, most recent + nearest qualifying by distance ratio | Recency-weighted, up to 6 races, shrunk toward the 1.06 population prior by evidence quality |
| Window | 56 days | 180-day lookback, 84-day confidence half-life |
| Thin evidence | Hard reject (`[1.03, 1.13]` band, or `null`) | Shrinks toward the prior; never silently disables (Rule 11) |
| Consumer | `deriveCoachGoal`'s no-stated-goal A/B/C tiers | Was: nothing outside `capacity-resolver.ts` / `prescription-resolver.ts` (pace prescription) |

`durability-anchor.ts` is confirmed the correct canonical source: it is the
fitness-vector rebuild's purpose-built, more rigorous resolver (Rule 10/11
compliant by construction — its refusal branch carries no `value` field, so
`.value` does not typecheck until a caller branches), already the doctrine
owner for "this runner's personal cross-distance exponent" on the pace side.
Two independent fits of one question is exactly Rule 16's violation shape.

---

## 2. What was fixed

### 2.1 `coach-goal.ts` now consumes `durability-anchor.ts`, not its own fit

- Added `projectWithDurabilityExponent(read: RaceExponentRead, targetDistanceMi)`
  in `lib/race/coach-goal.ts` — same anchor-selection rule (nearest
  supporting race in log-distance) and same Riegel validity window the old
  `predictWithPersonalExponent` used, but reading `RaceExponentRead.value`
  (durability-anchor's shrunk exponent) and its `supporting` races instead
  of a locally-fitted `PersonalExponentFit`.
- `CoachGoalInput.exponentFit: PersonalExponentFit | null` → replaced with
  `durabilityExponent?: RaceExponentRead | null`. `deriveCoachGoal`'s step 4
  now branches on the durability read first, Daniels-VDOT second — same
  fallback order as before, different (canonical) source.
- Added `CoachGoalTargets.personalExponentConfidence: number | null` —
  `durability-anchor.ts`'s `confidence`, threaded through so the coach-set
  A/B/C card carries how much to trust the exponent it used, per the task's
  "with its confidence" instruction.
- `lib/race/coach-goal-load.ts` (the one caller that assembles the input for
  the live iPhone race-detail route) now calls
  `durability-anchor.ts#resolveRaceExponent(userId)` instead of loading
  `loadVdotInputs`' race candidates and calling `fitPersonalExponent` itself.

**Deliberately NOT deleted:** `fitPersonalExponent`, `predictWithPersonalExponent`,
`PersonalExponentFit`, `ExponentFitRace`, and their constants
(`PERSONAL_EXPONENT_MIN/MAX`, `EXPONENT_FIT_WINDOW_DAYS`,
`EXPONENT_FIT_MIN_DISTANCE_RATIO`) all stay in the file, unchanged. Two real,
confirmed dependents remain:

- `app/api/targets/projection/route.ts` — the paused web Targets surface
  (out of active development per CLAUDE.md's locked scope; not touched).
- `lib/doctrine/registry.ts`'s `PREDICTION.personal-exponent-two-point-fit`
  and `PREDICTION.exponent-fit-freshness-window` claims — CI-gated doctrine
  tests that verify this file's own two-point formula against Research/02
  §11.4's worked example. Deleting the function would break the gate for no
  reason; the doctrine claim is about the formula's arithmetic, not about
  which system uses it for A/B/C tiers.

Deleting a still-depended-on function to manufacture a cleaner diff is
exactly Rule 20's failure shape ("a stale exemption fails until deleted"
cuts both ways — don't delete what is not actually stale). Both dependents
and the reasoning are documented in the file's own header.

**Verified for real**, against David's live account
(`0645f40c-951d-4ccc-b86e-9979cd26c795`):

`resolveRaceExponent` returns:
```
ok: true, value: 1.0869051877057179, rawFittedExponent: 1.1010686765785074,
confidence: 0.6227831813203759, evidenceScore: 0.6551267278916443,
races: 5, distinctDistances: 2
```
(fitted across Rose Bowl Half, Disney Half, LA Marathon, Sombrero Half,
America's Finest City Half — the value and raw fit match the account's cited
real numbers exactly, 1.0869 shrunk from a raw 1.1011.)

The **old** `fitPersonalExponent`, run against the same account's real race
candidates today, returns **`null`** — its 56-day freshness window admits
only one qualifying race (America's Finest City, 15 days old) with nothing
to pair it against, so `deriveCoachGoal` was *always* falling back to plain
Daniels-VDOT for this runner's only upcoming no-goal race (Santa Monica
10K), despite him carrying 5 real graded races on file. The old exemption
mechanism was silently starving itself on the one account the app runs
against.

Rendered through the full path (`loadCoachGoalForRace` → `deriveCoachGoal`)
for that race:

| | B (the coach-set time) | method |
|---|---|---|
| Old (Daniels-VDOT, `exponentFit` was null) | **44:02** | `daniels-vdot` |
| New (durability-anchor, confidence 0.623) | **45:10** | `personal-exponent` |

A/C came out 44:15 / 46:05. The shift is real evidence, not just the
exponent: the new anchor is a graded A-priority half-marathon race result
(Rose Bowl, 5918s); the old Daniels-VDOT number was anchored on VDOT 46.3,
itself resolved from a 4-mile training effort. Both the exponent AND the
anchor evidence improved.

### 2.2 `GoalGap.trajectorySec` — the confirmed live Rule 16 defect

`computeGoalGap` used to alias `latest.projectionSec` — the *raw* daily VDOT
equivalence snapshot `app/api/cron/snapshot-projections/route.ts` writes to
`projection_snapshots` — as `trajectorySec`, while every other live surface
(Races list, race detail, `goal-outlook.ts`) had already been migrated to
resolve "the projection" through `resolveRaceProjection`'s trajectory rung.
`goal-outlook.ts`'s own header already named this exact defect in this exact
field but only fixed its own local read.

**Fix**, mirroring `goal-outlook.ts#resolveGoalOutlookProjection`'s
established pattern exactly: `computeGoalGap` now loads the VDOT anchor,
calls `computeGoalProjection`, and resolves through `resolveRaceProjection`.
`trajectorySec` is the resolved value; `gapSec` is recomputed off it (so it
can never disagree with the number beside it); a new `trajectoryBasis:
RaceProjectionBasis | null` field is exposed. Falls back to the raw snapshot
only when live resolution genuinely produces nothing (honest degrade, Rule
11 — `trajectoryBasis` is `null` exactly then, so a caller can tell). The
14-day snapshot series stays as the input to `classifyTrend`/`computeConfidence`
— that's a legitimately distinct question ("is the day-to-day read moving
toward the goal, and how stable is it") from "what will the runner run,"
and is documented as such in the code.

Every direct consumer of `gap.trajectorySec` — `lib/plan/gap-report.ts`
(the morning brief's headline), `lib/coach/readiness-brief.ts`,
`app/api/cron/plan-drift/route.ts`'s `goal_gap_widening` proposal, the web
`GapPanel.tsx`/`TrainView.tsx` — is fixed automatically by this change, since
they all just read the field. No changes were needed in any of them. The
stale comment in `plan-drift/route.ts` claiming `goalGap.trajectorySec` was
"the projection SNAPSHOT... wearing the word trajectory" was rewritten to
describe the current (fixed) state and explain why `goal-outlook.ts` still
resolves its own copy independently (a stricter null-handling contract, not
a re-derivation).

**Verified for real**, against David's live CIM goal (3:00:00 marathon,
2026-12-06):

| | trajectorySec | gap to goal |
|---|---|---|
| Old (raw `projection_snapshots` value the field used to alias) | 12203s = **3:23:23** | 23:23 |
| New (resolved via canonical `resolveRaceProjection`, `basis: 'trajectory'`) | 11881s = **3:18:01** | 18:01 |

**322 seconds (5m22s) of difference**, on the one real account this app
runs against, for the exact field the morning brief's headline and the
drift cron's rebuild trigger both read.

### 2.3 Copy-pasted precedence logic removed outside the canonical resolver

- **`lib/training/goal-projection-resolve.ts#resolveNextAGoalProjection`** —
  its own header admitted it "mirrors `app/api/v5/races/route.ts`'s inline
  resolution," a hand copy kept in sync by nobody (no test equivalent to
  `_goal_immutability.test.ts`'s import-regex check existed for it). Now
  calls `resolveRaceProjection` directly. Added `basis` to
  `ResolvedGoalProjection`. Its one consumer
  (`app/api/cron/snapshot-projections/route.ts`, the projection-change push
  notification) is unaffected — same field names, additive `basis`.

- **`lib/race/retrospective.ts`'s `nextRace.predictedSec`** — used to call
  `predictRaceTime(anchorVdot, nextA.distance_mi)` directly, bypassing the
  resolver entirely (confirmed the review's finding). This reader asks a
  genuinely different question from "today's projection" — "what does THIS
  ONE PAST RACE's fitness alone predict for the next A race," a
  retrospective what-if anchored on a specific historical result, not the
  runner's current trajectory — so routing it through `resolveRaceProjection`
  with a full `goalProjection` would have been dishonest (it would have
  looked like it was answering the live question). Instead it now calls
  `resolveRaceProjection({ goalProjection: null, vdot: anchorVdot,
  distanceMi })`, which always lands on rung 3 (raw equivalence) — same
  number as before, now through the one function every cross-distance
  projection in the app resolves through, and now carries an honest
  `predictedBasis: 'equivalence'` instead of a bare number. Consumers are
  all web (paused per CLAUDE.md) plus a read-only admin diagnostic; none
  needed changes (additive field).

### 2.4 Confidence and basis threaded onto the canonical resolver's output

`resolveRaceProjection`'s output type (`RaceProjection`) gained
`confidenceInterval: ConfidenceInterval | null` and `confidenceLabel:
ConfidenceLabel | null` — `computeGoalProjection` already computes both
(`computeConfidenceInterval`, tested, reused elsewhere) but discarded them
before reaching the resolver, per the external review §5's exact finding
("every live 'Projected' figure... is a bare point estimate").

**The honesty boundary that was kept, on purpose:** `computeGoalProjection`'s
confidence interval is computed *around `vdotProjectionSec`* — today's
equivalence — not around the execution-scaled trajectory. So
`confidenceInterval`/`confidenceLabel` are populated **only** when `basis
=== 'equivalence'`; they are always `null` on the `'trajectory'` rung.
Attaching the equivalence's band to the trajectory number would print a
range describing a different quantity than the point estimate beside it —
exactly the mislabeling Rule 16 exists to forbid. A trajectory-specific band
does not exist yet (§4.1 below).

This is a **data-layer** fix only. `app/api/v5/races/route.ts` and
`app/api/v5/race/[slug]/route.ts` now have `confidenceInterval`/
`confidenceLabel` available on every `resolveRaceProjection()` call they
already make — the fields ride along in the existing call, nothing new to
wire — but I did not add them to either route's JSON response body, and did
not touch any iPhone/web rendering. That is a real UI decision (how a range
+ confidence + basis + primary limiter should read next to "Projected"
without violating Rule 17's "say it once" or reintroducing the four-concepts
confusion) and is written up as a decision item in §4.4, not guessed at.

---

## 3. Gates this touched, and why (Rule 18/20 discipline)

Two audit gates (`lib/audit/_coercion_scan.test.ts`,
`lib/audit/_swallow_scan.test.ts`) initially went red against this diff.
Both were investigated to the actual mechanism, not silently padded:

- **`lib/audit/coercion-registry.ts`** — `LOAD_BEARING_KNOWN` gained 2 new
  `lib/plan/goal-gap.ts::computeGoalGap::catch` entries: the two new
  `.catch()` sites §2.2 added (loading the VDOT anchor, calling
  `computeGoalProjection`) are the **exact same shape**
  `lib/plan/goal-outlook.ts::resolveGoalOutlookProjection::catch` already
  carries twice on this list, for the identical purpose. Both fail closed —
  a failed anchor read zeroes `vdot`, which starves `resolveRaceProjection`
  down to `null`, and `trajectorySec` falls back to the already-verified-safe
  raw-snapshot value with `trajectoryBasis: null` honestly signaling the
  live resolution didn't run. `PERIPHERAL_BASELINE` moved 180 → 182: one new
  site (`coach-goal.ts::projectWithDurabilityExponent::t`) is the same
  `t > 0 ? ... : null` shape its sibling `predictWithPersonalExponent::t`
  already carries (a race-projection of zero or negative seconds is not a
  measurement, same argument as this file's own `usableMeasurement`
  precedent); the other
  (`coach-goal-load.ts::loadCoachGoalForRace::catch`) is the OLD `try {
  await loadVdotInputs(...) } catch { exponentFit = null; }` — a *statement*
  the scanner cannot see by its own documented limitation — converted to a
  visible `.catch()` expression, which made an existing coercion auditable
  rather than adding a new one. Full accounts are written in the registry
  file itself, matching its own established style for prior growth
  (the "179 → 180 · THE EVIDENCE ENGINE" precedent already in the file).

- **`lib/audit/swallowed-failure-registry.ts`** — `EMPTIED_BASELINE` 375 →
  **374**. §2.1's `coach-goal-load.ts` fix genuinely deleted a
  swallowed-failure site: the old code's try/catch wrapped a real DB-backed
  read (`loadVdotInputs` queries `races`) whose failure and whose "no
  qualifying races" outcome were indistinguishable, both landing as
  `exponentFit = null`. That whole block is gone. This is the gate's own
  "the ratchet only works if it is re-tightened" case — a real fix, not
  slack.

Both changes are documented in the registries themselves with a full
account, per Rule 18's "never widen the classifier to swallow it" and the
files' own established convention for a genuine, argued exception.

**Not touched, and not caused by this work:** `_coercion_scan.test.ts` and
`_generated_content_gate.test.ts` also fail on `lib/plan/progression-spec.ts`
(a coercion site) and `lib/training/coaching-thesis.ts` (an orphan module) —
both introduced by commit `455476c2` ("the smallest real Coaching Thesis"),
already on `main` before this session started, entirely unrelated to race
prediction. `git status` at the time of this work also showed
`lib/training/expand-spec.ts`, `lib/training/spec-card.ts`,
`lib/plan/spec-builder.ts`, `lib/watch/build-workout.ts`,
`app/api/v5/today/route.ts`, and — notably — `lib/training/goal-projection.ts`
itself as modified by another concurrent agent session (the Pace
Prescription wiring work, per the `66a5fea5` commit already on `main`);
13 test failures in `_spec_card.test.ts` / `expand-spec.test.ts` /
`goal-projection.test.ts`'s `judgeTestPointExecution` trace to that
in-flight work, not to anything in this diff. None of these files were
edited here. `race-projection.ts`'s new type-only import of
`ConfidenceInterval`/`ConfidenceLabel` from `goal-projection.ts` is a
read-only dependency on that file's already-exported public types — worth a
quick re-check once the other session's edit lands, but it did not need any
coordination to build against tonight (`tsc --noEmit` is clean against the
tree as it stands).

---

## 4. Deferred, with a decision and a plan — not guessed at

### 4.1 Should `goal-projection.ts`'s core trajectory math consume `durability-anchor.ts`?

**Not done.** This is the external review's own open question #2, and its
own text already flags it as needing "a reviewer's sign-off before touching
Rule-16-protected code." `goal-projection.ts` (2,477 lines) is the plan
engine's central trajectory/drift/adaptation input — it feeds the drift
cron, the simulator, and the adaptation loop — and, concretely, it was under
live concurrent edit by another agent session for the entire duration of
this work (§3). Wiring a new cross-distance mechanism into it safely
requires an archetype-sweep re-run (Rule 15: a mechanism the test corpus
cannot reach is untested) and a Rule 9 continuity walk (a personal-exponent
swap-in is exactly the kind of "two computed quantities compared" that can
manufacture a cliff), neither of which fits inside a mechanical
consolidation pass, and neither of which should happen while the same file
is mid-edit elsewhere.

**Recommendation, argued:** yes, build it, as a dedicated follow-up once
the concurrent Pace Prescription work lands and the tree is quiet.
Concretely: at the point `vdotProjectionSec`/`trajectory.projectedSec`
project across distances from the VDOT anchor (Daniels table inversion via
`predictRaceTime`), consult `durability-anchor.ts#resolveRaceExponent` the
same way `coach-goal.ts#projectWithDurabilityExponent` now does — anchor on
the nearest supporting race in log-distance, project with the shrunk
exponent — and fall back to the existing Daniels-table path when the
durability read refuses (`ok: false`) or its confidence is too low to
prefer over the table (a threshold that itself needs the archetype sweep to
set honestly, not invented here). I've spawned a background task
(`race-prediction-goal-projection-durability`) with this exact scope so it
doesn't get lost; see the chip.

### 4.2 `goal-assessment.ts#assessGoal`'s `currentEquivalentSec`

**Left as-is**, per the external review's own conclusion (§2.1 of that
report): `race-projection.ts`'s own header already documents this value as
"byte-identical" to the resolver's rung-3 fallback — a genuinely different
purpose (today's equivalence feeding the feasibility verdict) computed with
the same primitive (`predictRaceTime`) rather than a competing re-derivation
of "the projection." Not a Rule 16 violation in spirit; re-plumbing it to
call through the resolver for pure hygiene would touch a well-tested,
doctrine-heavy file for no behavior change. Not fixed.

### 4.3 Primary limiter on the projection envelope

**Not built generally.** `lib/plan/goal-gap.ts` already computes `limiter:
LimiterRead | null` via `diagnoseLimiter`, but as a *sibling* field on
`GoalGap`, not on the projection itself — and only where an active plan +
goal exists to diagnose against.

**Recommendation:** for a race with an active plan + goal (where
`computeGoalGap` already runs), thread the same `diagnoseLimiter` call into
`app/api/v5/races/route.ts` and `app/api/v5/race/[slug]/route.ts`'s
response envelope, mirroring `goal-gap.ts`'s existing shape, so "Projected"
can carry a `primaryLimiter` field next to it. For `coach-goal.ts`'s A/B/C
tiers (races with **no** stated goal, so no `GoalGap` exists) there is no
natural target to diagnose a limiter against — recommend explicitly
deferring "primary limiter" for that surface rather than inventing one, and
revisiting only if David asks for it.

### 4.4 Visually distinguishing the four concepts (Rule 16)

**Not touched.** This is real design/product work, not a mechanical wire,
and CLAUDE.md is explicit that a piece requiring judgment I can't safely
make alone should be written up rather than guessed at. What I found,
concretely, for whoever picks this up:

- **iPhone (`RaceDetailV5.swift` / `RacesV5.swift`, live surface):**
  "Projected" (the race-projection stack, §2.4) and — only when no stated
  goal exists — the coach-set A/B/C tiles (`coach-goal.ts`, §2.1) can appear
  on the same screen. `CoachGoalTargets.coachSet` is already `true` and
  `line` already reads "Coach set from your current fitness... Yours to
  edit," so the data already distinguishes them; what's missing is a
  **visual** treatment (a chip/caption) that reads as "coach-set" at a
  glance rather than looking like a fourth "Projected." Feasibility targets
  (`goal-assessment.ts`'s safe/stretch) do not currently render alongside
  either — `race-card.ts#composeRaceCard` was restructured 2026-08-26 to
  return `null` rather than a decision-card shape, per David's own ruling —
  so there is no live third-label collision to design against today, only a
  two-way one (Projected vs. coach-set A/B/C), which narrows the design
  problem.
- **Web (`GapPanel.tsx` / `TrainView.tsx`, paused):** already fixed by §2.2
  at the value layer; `composeHeadline`'s copy is basis-neutral ("Tracking
  X...") and doesn't currently assert a wrong basis, so there's no new label
  work required there even once web resumes.

Recommend: when this surface is next touched with design attention, treat
"Projected" and "Coach-set A/B/C" as the two labels that need visual (not
just textual) separation on the phone, and revisit whether Feasibility
targets should ever render on the same screen before designing a
three/four-way system nobody currently needs.

### 4.5 Vocabulary drift across doctrine docs (external review §9 Q7)

Not touched — cosmetic, low priority, explicitly out of this task's scope
(consolidating code paths, not doc wording).

---

## 5. New tests

`web-v2/lib/race/coach-goal-durability.test.ts` (new, 8 tests, all passing):

- `projectWithDurabilityExponent` reproduces the exact projection arithmetic
  the legacy `predictWithPersonalExponent` used, off a real
  `fitRaceExponent` read.
- Refuses cleanly on an `ok: false` read (Rule 11 — the type itself is the
  guard).
- Refuses outside Riegel's validity window (ultra distances).
- `deriveCoachGoal` with a usable `durabilityExponent` reports
  `method: 'personal-exponent'`, and its `personalExponent` /
  `personalExponentConfidence` are **exactly** the durability read's own
  `value` / `confidence` — the "one canonical value flows through" proof the
  task asked for, enforced by direct equality assertion, not approximation.
- `deriveCoachGoal` with a refused or absent `durabilityExponent` falls back
  to `daniels-vdot`, byte-identical to the pre-existing behavior.
- A dedicated test proves shrinkage is real and observable: the same
  2-race fixture that used to feed the legacy fit unshrunk now produces a
  `value` strictly between the raw two-race slope and the population prior
  — i.e., this is provably not the old fit relabeled.

`coach-goal.test.ts`'s old `exponentFit`-based test was removed (the field
no longer exists on `CoachGoalInput` — this is enforced by the TypeScript
compiler now, not just a test) with a pointer to the replacement file.

All 34 pre-existing tests in `coach-goal.test.ts`, all 662 doctrine-gate
tests, and the full `_race_projection.test.ts` / `_goal_assessment.test.ts`
/ `_goal_immutability.test.ts` / `_race_role_card.test.ts` /
`_plan_drift_lifecycle.test.ts` / `_race_doctrine.test.ts` suites (953 of
954 tests in the scoped sweep) pass unchanged. `tsc --noEmit` is clean.

---

## 6. Files touched

- `web-v2/lib/race/coach-goal.ts` — durability-anchor wiring, new bridging
  function, deprecation header, confidence field.
- `web-v2/lib/race/coach-goal-load.ts` — calls `resolveRaceExponent` instead
  of `fitPersonalExponent`.
- `web-v2/lib/race/coach-goal.test.ts` — obsolete `exponentFit` test
  removed.
- `web-v2/lib/race/coach-goal-durability.test.ts` — new, 8 tests.
- `web-v2/lib/race/retrospective.ts` — `nextRace.predictedSec` routed
  through the canonical resolver; new `predictedBasis` field.
- `web-v2/lib/plan/goal-gap.ts` — `trajectorySec` resolved canonically; new
  `trajectoryBasis` field.
- `web-v2/lib/training/goal-projection-resolve.ts` — delegates to
  `resolveRaceProjection` instead of reimplementing its precedence; new
  `basis` field.
- `web-v2/lib/training/race-projection.ts` — `confidenceInterval` /
  `confidenceLabel` threaded onto the output type, populated only on the
  honest rung.
- `web-v2/app/api/cron/plan-drift/route.ts` — stale comment corrected to
  describe the fixed state.
- `web-v2/lib/audit/coercion-registry.ts`,
  `web-v2/lib/audit/swallowed-failure-registry.ts` — ratchets
  re-tightened/argued for this diff's real, investigated changes.
