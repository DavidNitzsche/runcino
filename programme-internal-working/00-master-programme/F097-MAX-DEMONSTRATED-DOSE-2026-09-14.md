# F097 — MAX_DEMONSTRATED_DOSE aggregator built and wired — 2026-09-14

**Status: FIXED, typechecked (`npx tsc --noEmit` clean), unit-tested (7 + 3
new tests, all passing), Rule 18 falsified (revert reproduced the exact
pre-fix defect, restore fixed it), full suite run with no new failures versus
baseline. Committed on `fix/f097-max-demonstrated-dose-2026-09-14`, based on
`origin/main`, NOT pushed, NOT merged.**

The finding: `MAX_DEMONSTRATED_DOSE` ("the biggest session of this type he's
actually completed") had no implementation anywhere in the tree.
`lib/execution/reconstruct.ts#actualStimulus` already computed the per-run
shape (`{domain, workMi, workMinutes}`) a reader would aggregate over, and
`lib/plan/adjudication/adjudicate.ts#athleteEvidenceFor` was already built to
grade a prescribed dose against a demonstrated maximum — but nothing walked
history and took a MAX by domain, so the slot was null everywhere it was
read. Two doctrine sub-questions had blocked building it (recorded in
`lib/runner-state/ownership.ts`'s own OPEN entry since 2026-09-06): lifetime
vs. rolling window (and what window), and whether Rule 8's taper exclusion
applies to a MAX read. Both are now settled by the coach consultant
(`for coaching consult/consult-log/2026-09-14-023-max-demonstrated-dose-design.md`,
corrected by `2026-09-15-025-delegated-calibration-rulings.md`): a rolling
**30-day** window (not the retracted 8-week figure), reusing
`lib/plan/generate.ts#recentPeakLongMi`'s window-construction pattern for the
same `Research/00a` spike-threshold citation, with taper/race-week/post-race-
recovery days excluded from the candidate pool for a narrower correctness
reason argued in 023 (not a literal Rule-8-habit-filter application).

---

## 1 · The exact fix

### 1.1 New file — `web-v2/lib/execution/max-demonstrated-dose.ts`

`export async function maxDemonstratedDoseByDomain(userUuid, todayISO): Promise<{ atPaceMinutesByDomain: Record<string, number>; windowDescribed: string }>`

For each domain (threshold, interval, marathon, race — `easy`/`recovery`
excluded, see the file's own header), computes the biggest COMPLETED session
in `[todayISO − 30, todayISO]`, taper/race-week/post-race-recovery days
dropped from the candidate pool first. Built from existing, reused pieces
only:

- `ownedDaysSql` (`lib/plan/owned-days.ts`) for the plan-day rows, queried
  `WHERE is_quality = true OR is_long = true` — deliberately WIDER than
  `lib/execution/load.ts#loadKeySessionExecutions`'s `is_quality = true`
  alone, because `plan/generate.ts` always authors a `type: 'long'` day
  `isQuality: false` (confirmed by grep), so a quality-only reader would stay
  structurally blind to the marathon-pace domain the finding names by name.
  A new reader, not a widened `load.ts` — that function has seven other call
  sites and is the adaptation model's own execution-gate predicate; changing
  its WHERE clause for this reader's sake would be an unscoped side effect on
  all of them.
- `resolveDateRangeExecutions` (`lib/execution/day-resolver.ts`) for the
  matched-run identity per day — never "same date, richest run" (the
  EXECUTION-IDENTITY-1 rule `load.ts` already follows).
- `plannedStimulus` + `actualStimulus` (`lib/execution/reconstruct.ts`),
  reused verbatim — this file never re-derives `{domain, workMinutes}`, it
  only MAXes what those functions already compute.
- `loadPrescribedWindows` + `isPrescribedNonNormal`
  (`lib/training/normal-window.ts`) for taper/race-week/post-race-recovery
  detection — the same general-purpose detector already shared by
  `lib/safety/load-safety.ts`, `lib/race/representativeness-inputs.ts` and
  several `lib/coach/` readers. Not the mechanism `recentPeakLongMi` uses for
  its OWN habit half (`eligibleDaysBack`/`PrescribedSpan`,
  `lib/plan/generate.ts`, `lib/plan/`-private) — that pair answers a
  different question for a different reader.
- `roundTo` (`lib/format/run.ts`) for the one-decimal rounding, not a
  hand-rolled `Math.round(x*10)/10` — `_format_lint.test.ts` caught the
  hand-rolled version on the first full-suite run (see §4).

```ts
export const MAX_DEMONSTRATED_DOSE_WINDOW_DAYS = 30;
```

is the one number, bound to the `Research/00a-distance-running-training.md`
"prior 30 days" citation per ruling 025 — not copied from
`recentPeakLongMi`'s own literal implementation, which is actually 28 days
(an untouched, independently-argued detail of that function this session's
scope keeps clear of; the header names this discrepancy explicitly so nobody
mistakes 28 for a source).

Two internal reads (`resolvePrescribedPaceAnchors`, `resolveCurrentVdotSnapshot`)
are wrapped in try/catch rather than `.catch(() => null)`, mirroring
`load.ts`'s own deliberate choice for the identical read — the shorter form
is exactly the shape `lib/audit/coercion-scan.ts#findBlindIndirect`
(COERCION-1) polices, and the full-suite run caught it (see §4).

### 1.2 `web-v2/lib/runner-state/store/loaders.ts`

`loadMaxDemonstratedDose(userUuid, todayISO)` — previously a synchronous,
argument-ignoring function that unconditionally returned `absentBelief(...)` —
now calls `maxDemonstratedDoseByDomain` and submits a real `MaxDoseBelief`
(`{ atPaceMinutesByFamily }`), or `failedBelief` if the read throws. Wired
into `buildRunnerBeliefInput`'s `Promise.all` batch. **Exported**, the one
deliberate exception to this file's "loaders stay private" convention —
needed so the Rule 18 falsification test could isolate this one field without
mocking nine unrelated owner functions.

### 1.3 `web-v2/lib/runner-state/ownership.ts`

The `MAX_DEMONSTRATED_DOSE` registry entry updated to reflect the new owner:

- `canonical`: now points at `maxDemonstratedDoseByDomain` (was `null`).
- `rule8Side`: corrected from `'HABIT'` to `'ABSORBED_LOAD'` — the prior value
  predates any doctrine review and is contradicted by the settled ruling
  (023: *"'Biggest session of this type he has completed' sits on the
  tissue-tolerance side... not the habit side"*; 025: this belief is *"close
  enough to the same shape"* as `recentPeakLongMi`'s own spike anchor, which
  is documented as correctly EXEMPTED from Rule 8's habit filter). This does
  NOT contradict the candidate-pool taper exclusion the aggregator still
  applies — that is 023's own narrower, independent correctness argument, not
  a Rule-8-habit claim, and the entry's own comment now says so explicitly so
  the two are never conflated.
- `conflict.verdict`: `OPEN` → `ROUTED` (a reader had to be BUILT, not merely
  redirected, so `RESOLVED` would overstate it). `notRoutedBecause` cleared
  per the registry's own contract.
- The `athleteEvidenceFor` competing entry's `computes` text updated to state
  plainly what remains open: **no production call site yet threads this
  belief's value into `athleteEvidenceFor`'s arguments.** See §3.

---

## 2 · Tests

### 2.1 `web-v2/lib/execution/_max_demonstrated_dose.test.ts` (7 tests)

Uses `type: 'race'` fixtures throughout — `actualDomain` returns `'race'`
unconditionally for a race-intended session, with no pace-window comparison,
which lets every scenario control the credited `workMinutes` directly via
`movingTimeS` with zero risk of an unrelated pace-anchor detail silently
reclassifying the domain. Domain classification itself is `reconstruct.ts`'s
own concern, already covered by `_reconstruct.test.ts`.

- **(a)** the bigger of two real completed in-window sessions wins its domain.
- **(b)** a taper day never wins, however large — the real session wins
  instead; and **(b2)** when the ONLY candidate sits in a taper window, the
  domain reports nothing at all (never a false zero, never the taper number).
- **(c)** a session outside the 30-day window never counts, even though it
  would otherwise be the biggest.
- **(d)** the window is genuinely ROLLING — the identical fixture row counts
  for `todayISO = 2026-09-14` and falls out of range for `todayISO =
  2026-09-16`, with no change to the fixture itself. The mock's `pool.query`
  implementation filters candidate rows by the ACTUAL `fromISO`/`toISOExclusive`
  bound params the function passes (mimicking real `date_iso >= $2 AND
  date_iso < $3` SQL), so this is testing the function's own date math, not a
  hand-picked fixture.
- Plus: the window constant is 30 (not the retracted 8-week figure), and an
  empty result is a real submitted `{}`, never a thrown error.

### 2.2 `web-v2/lib/runner-state/store/_max_demonstrated_dose_loader.test.ts` (3 tests)

Tests the loader wiring in isolation (`maxDemonstratedDoseByDomain` mocked):
a real per-domain result is submitted (never absent); an empty result is
still submitted (`"measured, none found"` is a real Rule 11 answer, per
`MaxDoseBelief`'s own doc comment); a thrown read produces `failedBelief`,
never a silent absence.

### 2.3 Rule 18 falsification

`loadMaxDemonstratedDose` was temporarily reverted, in place, to its exact
pre-fix body (`return absentBelief(...)`, ignoring both arguments) and the
loader test suite re-run: **all 3 tests failed**, reproducing the precise
defect — the belief stays absent regardless of what the real aggregator would
have returned. The file was then restored from a pre-revert backup (not via
`git stash`, which is shared across this repo's worktrees per an existing
project note) and the suite re-run clean. Full transcript of both runs is in
this session's tool history.

---

## 3 · What is explicitly NOT done, and why

**No production caller feeds this belief into `athleteEvidenceFor` yet.**
Investigating the actual call graph found `athleteEvidenceFor` has exactly
one production caller today, `lib/brain/option-lane.ts`, and it prices
`demonstratedMaxToday` off `detectRampSignals`'s weekly-volume peak — a
different question (weekly volume, not per-workout-type dose). The other
consumer, `lib/plan/adjudication-corpus.ts`, is a fixture/simulation bridge
whose own header states "runtime code must never import it." So the
runner-state belief slot (`RunnerBeliefs.MAX_DEMONSTRATED_DOSE`) is now real
and non-null, but wiring an actual `athleteEvidenceFor` caller to read it is
a separate, not-yet-scoped integration — named explicitly in the updated
`ownership.ts` entry rather than left implicit. This matches the task's own
scope boundary ("do not touch the downstream dose-grading/Rule-21 logic...
beyond what's needed to make it receive real values") — there was no existing
downstream wiring to touch.

**`recentPeakLongMi` untouched**, as instructed. Read as a reference pattern
only. Its own literal window is 28 days, not 30 — a pre-existing,
independently-argued detail of that function, named in this file's header
rather than silently copied as if it were the citation's source.

**No `lib/doctrine/registry.ts` entry added.** Considered it (the existing
`RAMP.single-session-spike` claim already binds the same `Research/00a`
citation to `recentPeakLongMi`), but that claim's `check()` reads
`generate.ts` internals specific to the 110% multiple and the long-run ramp
seed; extending it to also assert my window constant risked destabilizing a
CI-fatal, delicate existing gate for a citation my file already states
plainly in its own header. A standalone new claim was possible but not
required by the task's verification bar, so it was left as a scoping
decision rather than done unilaterally — flagged here for the reviewer to
weigh.

---

## 4 · Verification run, in order

1. `npx tsc --noEmit` — clean at every checkpoint (4 checkpoints total: after
   the new file, after wiring `loaders.ts`, after `ownership.ts`, after the
   coercion-scan fix).
2. `vitest run lib/execution/_max_demonstrated_dose.test.ts` — 7/7 pass.
3. `vitest run lib/runner-state/store/_max_demonstrated_dose_loader.test.ts` — 3/3 pass.
4. `vitest run lib/runner-state/_runner_state.test.ts` — 52/52 pass (the
   `BELIEF_OWNERSHIP` registry gate, unaffected by the `rule8Side` and
   `canonical` edits).
5. First full-suite run (`vitest run`, no filter) surfaced two real
   regressions from my own new file, both fixed before landing:
   - `lib/audit/_coercion_scan.test.ts` — the two blind `.catch(() => null)`
     calls tripped the load-bearing coercion ratchet (170 → 172 peripheral
     sites). Fixed by switching to try/catch, matching `load.ts`'s own
     precedent for the identical read (§1.1).
   - `lib/format/_format_lint.test.ts` — the hand-rolled
     `Math.round(minutes*10)/10` tripped the shared-rounding-rule lint. Fixed
     by importing `roundTo` from `lib/format/run.ts`.
6. `bash scripts/check-belief-owners.sh` — OK, unaffected (`quantity-owners.ts`
   tracks a different twelve quantities; `MAX_DEMONSTRATED_DOSE` is not one).
7. `bash scripts/check-doctrine.sh` — OK, 351 citations resolve; unaffected
   (no `registry.ts` edit, see §3).
8. `bash scripts/check-swallowed-failure.sh` — OK, 26/26 pass.
9. Final full-suite run: **691 files, 12671 tests · 12406 passed, 4 failed, 1
   expected fail, 260 skipped.** The 4 failures are in 3 files, none touched
   by this change and confirmed pre-existing:
   - `lib/plan/_authoring_shadow_compare.audit.test.ts` and
     `lib/adaptation/canonical-shadow/_f038_reign_scoping.audit.test.ts` — both
     are DB-liveness placeholders that fail by design when
     `DATABASE_URL_RO` is unset (their own assertion message says so),
     unrelated to any code path this fix touches.
   - `lib/plan/_rolling_seven_ceiling.test.ts` — 2 failures in a plan-authoring
     fixture (`lib/plan/`), a directory this change never touches (confirmed
     via `git status`); reproduced identically in isolation, independent of
     run order.

No file outside `web-v2/lib/execution/` and `web-v2/lib/runner-state/` was
modified.

---

## 5 · Files touched

- `web-v2/lib/execution/max-demonstrated-dose.ts` (new)
- `web-v2/lib/execution/_max_demonstrated_dose.test.ts` (new)
- `web-v2/lib/runner-state/store/loaders.ts` (modified — `loadMaxDemonstratedDose`
  now real and exported; header comment updated)
- `web-v2/lib/runner-state/store/_max_demonstrated_dose_loader.test.ts` (new)
- `web-v2/lib/runner-state/ownership.ts` (modified — `MAX_DEMONSTRATED_DOSE`
  entry: `canonical`, `rule8Side`, `conflict`, `movesUpOn` reader, competing
  entry text)
