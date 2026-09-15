# F080 — `assessGoal()` consumes the canonical race outlook's verdict — 2026-09-14

**Status: FIXED, typechecked (`npx tsc --noEmit` clean in `web-v2`), unit-tested
(new F080 describe block, 4 tests, including a literal Rule 18
revert/reproduce/restore falsification), full relevant suite green (686 test
files / 12,615 tests · 631 files passed, 3 pre-existing failures unrelated to
this change — see §6). Committed on `fix/f080-assessgoal-ownership-2026-09-14`
based on `origin/main`, NOT pushed, NOT merged.**

## 1 · What was broken

Independent product review (IPR-20260914-007, F080) found that
`assessGoal()` (`web-v2/lib/training/goal-assessment.ts`) and the canonical
race outlook (`web-v2/lib/race/race-outlook.ts#composeRaceOutlook`) computed
genuinely different goal-feasibility verdicts for the same runner on the same
day, for an ordinary required-gain case — not cold start, not open-ended, not
date-passed. Confirmed by grep: neither file imports or wraps the other.

- `assessGoal()` took `currentVdot` off a **stored** `projection_snapshots` /
  `loadLatestVdotWithAnchor` row (up to days old), and had no
  `executionQuality` input at most of its call sites — which the function
  defaults to `1.0`, i.e. **perfect execution assumed**.
- `composeRaceOutlook()` reads the **live** `resolveThresholdCapacity` ladder
  and discounts `expectedRaceDay` by the runner's **actual measured
  execution** (`projectExpectedGain`).

Result: a goal could read `"realistic"` on `assessGoal()` and
`"aggressive"` on the outlook, and the two vocabularies (`GoalFeasibility` vs
`RaceOutlook['goalFeasibility']['status']`) don't even fully overlap.

This was a **live, dormant** Rule 16 (duplicate-owner) violation — invisible
today only because nothing renders it. Grep-confirmed before this fix landed:
`assessGoal()`'s only render path was gutted in August down to a quiet badge
on 4 unrelated trigger cards (`app/api/v5/races/route.ts#composeRaceCard`,
heat / course-changed / chip-lock / two-A-races), and the outlook's own
`goalFeasibility` is serialized and decoded client-side but rendered nowhere
in native Swift. Zero user-facing harm today; the urgency was "fix before
anyone wires `assessGoal`'s number to a screen."

`web-v2/lib/runner-state/ownership.ts`'s `GOAL_FEASIBILITY` belief entry
already named this exact conflict and the right fix direction ("the correct
fix is for `assessGoal` to consume the outlook verdict rather than compute
its own"), but its own prose also claimed **"both verdicts render on the same
race surface,"** which the independent reviewer checked against the actual
render tree and found **inaccurate** — neither verdict renders today. That
prose is corrected in this fix (§4).

## 2 · The precedent followed

`web-v2/lib/training/race-projection.ts` already solves this exact shape of
problem for the finish-time / "Projected" side of this same file's domain.
Its own header states the pattern in so many words:

> "Now there is ONE object — `RaceOutlook` — and this module is a **pure
> mapping** from it to the two-field shape... **No inputs are gathered here;
> nothing is computed here.** A caller that wants "Projected" resolves the
> outlook and maps it, so two screens holding the same outlook cannot
> disagree."

That module does not call `composeRaceOutlook()` itself (which is async and
DB-backed) — it takes an already-resolved `RaceOutlook` as its only
parameter and reads named fields off it. `assessGoal()` is documented as
**pure** (`todayISO` keeps it deterministic and the caller owns every read"),
so it cannot call the async `composeRaceOutlook()` either. The fix applies
`race-projection.ts`'s exact shape: `assessGoal()` gained an optional
`outlook: RaceOutlook | null` input, and when a caller passes one that
resolved, `assessGoal()` reads `feasibility` / `safeTargetSec` /
`stretchTargetSec` off it rather than recomputing them from the doctrine
gain-rate band and a stored VDOT.

(Note on the finding's phrasing: the task description referred to this
precedent as resolving "the finish-time split." Ownership.ts itself has no
literal text under that name — the two non-OPEN entries in its registry are
`LONG_RUN_TOLERANCE` (RESOLVED, a genuine two-questions split, not a
consume-pattern) and `THRESHOLD_PACE` (ROUTED, a real "loser defers to the
canonical composer" precedent). `race-projection.ts` is the actual, plainly
documented "pure mapping so two callers can't disagree" pattern for the
finish-time/projection quantity in this exact file's neighbourhood, and is
what this fix followed; `THRESHOLD_PACE`'s ROUTED shape is the same idea and
is cited for cross-reference. This is flagged for transparency rather than
silently substituted.)

## 3 · The exact fix

### 3.1 `web-v2/lib/training/goal-assessment.ts` — the core change

- Added `outlook?: RaceOutlook | null` to `GoalAssessmentInput` (type-only
  import of `RaceOutlook` from `@/lib/race/race-outlook` — no runtime edge,
  same convention `race-projection.ts` uses).
- Added `feasibilityFromOutlookStatus()`, mapping
  `RaceOutlook['goalFeasibility']['status']` onto `GoalFeasibility`.
  `comfortable` / `realistic` / `aggressive` are the **same word** in both
  vocabularies by construction (these are exactly the reviewer's diverging
  case); `unlikely_currently` maps to `assessGoal`'s own worst band,
  `out-of-reach`; `no_goal` / `unavailable` never reach it (gated out below).
- In `assessGoal()`'s main branch (the "ordinary required-gain" path — the
  cold-start/open-ended/date-passed refusal branches above it are untouched,
  since the finding is specifically about the ordinary case):
  - `outlookUsable` gates on the outlook having actually resolved
    (`goalFeasibility.status` not `'no_goal'`/`'unavailable'`, and
    `expectedRaceDay.expectedSec`/`likelyRangeSec` present).
  - When usable: `feasibility = feasibilityFromOutlookStatus(status)`,
    `safeTargetSec = expectedRaceDay.expectedSec`, `stretchTargetSec =
    expectedRaceDay.likelyRangeSec[0]` (fast edge), and the "today's fitness"
    number used in the statement/output (`currentEquivalentSec`) is read
    from `currentProjection.expectedSec` (the live capacity read) rather than
    the stale VDOT-derived equivalence.
  - When not usable (no caller-supplied outlook, or the outlook itself
    refused): falls back to the pre-existing doctrine gain-rate computation
    unchanged (`requiredGain` vs `safeGain`/`stretchGain`) — an honest
    degrade (Rule 11: "could not consume the canonical verdict" is a
    different fact from "consumed it and it said comfortable"), not a silent
    reopening of the two-formula defect for callers that DO migrate.
  - `requiredVdot`/`requiredVdotRatePerWeek` (a different belief — "how many
    VDOT points a week does the goal need," not "is the goal realistic") are
    computed unconditionally, unchanged, in both branches.
- A dense WHY comment at the `outlook` field cites Rule 16, the
  `ownership.ts` `GOAL_FEASIBILITY` entry, the `race-projection.ts`
  precedent, and Rule 11's refusal posture.

### 3.2 Wiring the 3 production call sites (additive — no signature-breaking
change was needed, since `outlook` is optional; wired anyway so the fix has
real effect rather than an unused parameter)

- **`web-v2/lib/plan/goal-gap.ts`** (`computeGoalGap` → `loadGoalAssessment`):
  this file already resolves `outlookForGap` (a `RaceOutlook`) for its own
  `gapSec`/`trajectoryBasis` fields a few lines above the `assessGoal` call —
  threaded through at zero extra cost.
- **`web-v2/app/api/v5/races/route.ts`**: `nextAOutlook` used to resolve via
  `resolveRaceOutlookBySlug` *after* the `assessGoal()` call, purely to feed
  the "Projected" stat. Moved the resolution earlier (ahead of the
  `assessGoal` call) and passed it in; the later "Projected" code now reuses
  the same `nextAOutlook` instead of re-resolving.
- **`web-v2/app/api/targets/projection/route.ts`**: the outlook was resolved
  inside a `try` block scoped to the "Projected" section, unreachable from
  the `goalAssessment` closure further down. Hoisted a `raceOutlookForAssessment`
  variable to the enclosing scope, set inside the existing try block, and
  passed into the `assessGoal()` call.

### 3.3 `web-v2/lib/runner-state/ownership.ts` — `GOAL_FEASIBILITY` correction

- `conflict.verdict`: `'OPEN'` → `'ROUTED'`.
- `because`/`notRoutedBecause`: rewritten in the same style as the
  `THRESHOLD_PACE` ROUTED entry — states what was routed, cites F080 and
  IPR-20260914-007, and **explicitly corrects the "both verdicts render on
  the same race surface" claim**: neither verdict renders today;
  `assessGoal`'s only use is the 4 quiet trigger-card badges in
  `composeRaceCard`, and the outlook's `goalFeasibility` reaches the wire but
  is decoded nowhere in native Swift. States this was "dormant, not
  displayed" — the reason F080 was framed as pre-emptive, not as an active
  incident.
- `competing[0]` (the `assessGoal` entry): `computes` rewritten to describe
  the routed behaviour (consumes `RaceOutlook` when passed; falls back to the
  standalone gain-band read only when no usable outlook exists) and
  `canDisagree` flipped `true` → `false`, matching the routed entries
  elsewhere in the registry (e.g. `seed-from-onboarding.ts`'s entry under
  `THRESHOLD_PACE`).
- The other two competing owners under this belief (`goal-ready.ts#computeGoalReady`,
  `achievable-target.ts#achievableRaceTarget`) were **not** touched — they
  are not part of this fix's scope and remain their own, still-open,
  question.

## 4 · Before/after evidence for the diverging fixture

Fixture (`web-v2/lib/training/_goal_assessment.test.ts`, new `F080` describe
block): VDOT 46 stale/stored snapshot, marathon goal needing +1.5 VDOT
points, 16 weeks out (13 build weeks) — the exact "REACHABLE" scenario
already locked by an existing test, reused verbatim as the reviewer's
"ordinary" case. A parallel canonical outlook for the *same* runner/day: live
capacity two points under the stale snapshot (VDOT 44 vs 46), execution
discounted so the goal sits just past the likely range's fast edge (VDOT 46)
→ outlook `goalFeasibility.status: 'aggressive'`.

| | `assessGoal()` before fix (no outlook, or pre-fix code) | `composeRaceOutlook()` | `assessGoal()` after fix (outlook consumed) |
|---|---|---|---|
| Verdict | `'realistic'` | `'aggressive'` | `'aggressive'` |

**Rule 18 falsification, done literally** (not merely a within-test
comparison): saved the fixed `goal-assessment.ts`, restored the pre-fix
version from `HEAD` via `git show HEAD:web-v2/lib/training/goal-assessment.ts`
(file copy, not `git stash` — this worktree's stash is shared with other
worktrees per a standing note in this project), ran the new F080 tests:

```
FAIL  CONSUMED · the same fixture, with the canonical outlook attached, agrees with it
AssertionError: expected 'realistic' to be 'aggressive'
FAIL  feasibilityFromOutlookStatus shares vocabulary ...
TypeError: feasibilityFromOutlookStatus is not a function
```

This reproduces the *exact* reviewer's disagreement (`'realistic'` vs
`'aggressive'`, same fixture) against the pre-fix code. Restored the fixed
file; all 36 tests in the file pass again, `npx tsc --noEmit` clean.

## 5 · Behaviour change note (explicitly flagged, not silently absorbed)

For the 4 existing trigger-card badge call sites
(`app/api/v5/races/route.ts#composeRaceCard`) and the 2 other production
callers (`targets/projection` route, `goal-gap.ts`): **wherever an outlook
resolves successfully, `assessGoal()`'s verdict, `safeTargetSec`,
`stretchTargetSec`, and the "today's fitness" figure in its `statement` will
now generally differ from what they were before this fix**, because they now
read live, execution-discounted numbers instead of a stale VDOT snapshot with
perfect execution assumed. This is the fix working as intended — the two
paths converging — not a regression. Concretely: a runner whose actual
execution has been poor, or whose stored VDOT snapshot is stale/optimistic,
will now see `assessGoal`-derived output shift toward the (more honest)
outlook's read, which is more often the *more cautious* verdict, matching
`feedback_execution_is_the_lever` (execution is the lever, not what's
assumed). No call site's *signature* required a breaking change — `outlook`
is additive/optional — so nothing needed a compatibility shim.

## 6 · Full verification

- `npx tsc --noEmit` in `web-v2`: clean at every checkpoint, including the
  final state.
- `web-v2/lib/training/_goal_assessment.test.ts`: 36/36 pass (32 pre-existing
  + 4 new F080 tests: falsification reproduction, consumption/agreement,
  unusable-outlook degrade, vocabulary-mapping unit test).
- Full relevant sweep run explicitly (23 files / 362 tests, all pass):
  `_limiter`, `_doctrine_lint`, `_format_lint`, `_goal_framing_card`,
  `_plan_drift_lifecycle`, `_race_role_card`,
  `_runner_compromised_fail_closed`, `_seal_single_seam`,
  `_training_lead_e2e`, `_course_elevation_trust_gate`, all of
  `lib/runner-state`, `drift-proposal-policy`, `_goal_assessment_sample`,
  `_coaching_thesis`, `_goal_assessment`, `_targets_projection_invariants`,
  `_thesis_limiter_consistency`, `_race_card`, `_race_projection`,
  `_vdot_snapshot_owner`.
- Additional goal-adjacent sweep (41 files / 630 tests, all pass):
  `_audit_slow_goal`, `_goal_immutability`, `_goal_pace_contamination`,
  `_goal_volume_seal`, `_midrace_goal`, all of `lib/race`.
- Full repo suite: `npx vitest run` in `web-v2` → **631 files passed, 3
  failed, 52 skipped** (686 files; 12,350 passed, 4 failed, 1 expected-fail,
  260 skipped of 12,615 tests). The 3 failures are **pre-existing and
  unrelated** — confirmed by grep that none of the 3 failing files reference
  `goal-assessment.ts`, `race-outlook.ts`, `goal-gap.ts`, or either touched
  route file:
  - `lib/plan/_authoring_shadow_compare.audit.test.ts` and
    `lib/adaptation/canonical-shadow/_f038_reign_scoping.audit.test.ts` are
    DB-liveness audit gates that explicitly fail closed when
    `DATABASE_URL_RO` is not set in this environment (by design, per their
    own Rule 18 assertion — "skipping it silently would report green for a
    check that looked at nothing").
  - `lib/plan/_rolling_seven_ceiling.test.ts` (2 sub-failures) is a
    plan-generation rolling-7-day ceiling test, unrelated to goal
    feasibility, that fails independent of this change (a fixture/ceiling
    interaction in `generate.ts`, not touched here).

## 7 · Scope discipline

- `race-outlook.ts`'s own computation was not touched — it remains the
  trusted source of truth per the register's framing. Only `assessGoal()`
  changed to consume it.
- Nothing was wired to any new UI surface. The 4 existing trigger-card badge
  call sites keep their exact rendering (`composeRaceCard`) — only the data
  feeding `assessGoal()` changed, and only when a caller supplies a resolved
  outlook.
- No native/Swift changes — none were needed; nothing in Swift consumes
  `assessGoal`'s output today, and no call-site signature broke (the new
  field is optional).

## 8 · Files touched

- `web-v2/lib/training/goal-assessment.ts` — core fix.
- `web-v2/lib/training/_goal_assessment.test.ts` — new F080 test block (4
  tests).
- `web-v2/lib/plan/goal-gap.ts` — wired `outlookForGap` through
  `loadGoalAssessment`.
- `web-v2/app/api/v5/races/route.ts` — hoisted `nextAOutlook` resolution
  earlier, wired into `assessGoal`.
- `web-v2/app/api/targets/projection/route.ts` — hoisted
  `raceOutlookForAssessment`, wired into `assessGoal`.
- `web-v2/lib/runner-state/ownership.ts` — `GOAL_FEASIBILITY` entry: verdict
  `OPEN` → `ROUTED`, corrected the "both render" prose, updated the
  `assessGoal` competing-owner description and `canDisagree`.

Branch: `fix/f080-assessgoal-ownership-2026-09-14`, based on `origin/main`.
Not pushed, not merged.
