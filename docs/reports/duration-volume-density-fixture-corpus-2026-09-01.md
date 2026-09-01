# The DURATION / VOLUME / DENSITY replay corpus — 9 hand-authored fixtures, run through the real engine

**Date:** 2026-09-01 · **Status:** a permanent regression corpus
(`web-v2/lib/adaptation/_duration_volume_density_replay_corpus.test.ts`, 12
tests across 9 named fixtures, part of `npm test`), not a one-off script.
Nothing here is a mock — every fixture is run through the real, unmodified
`composeAdaptation` (`web-v2/lib/adaptation/adaptation-engine.ts`) and, for
Fixture DURATION-3, the real `classifyAdaptation`
(`web-v2/lib/adaptation/adaptation-model.ts`) and the real
`filterExecutionEvidenceByPrescribedWindow` / `prescribedWindowsFrom`
(`web-v2/lib/adaptation/load.ts` / `web-v2/lib/training/normal-window.ts`).

This is the sibling of `docs/reports/pace-replay-corpus-2026-09-01.md`, which
built 13 fixtures for the PACE lever at the real `AdaptationEngineInput` shape
but did not cover DURATION, VOLUME or DENSITY with the same rigor. Same
explicit instruction, followed exactly the same way: **do not build a general
synthetic-history platform.** A small, named, hand-authored fixture set.

`web-v2/lib/adaptation/adaptation-engine.ts`, `load.ts`, `shadow-compare.ts`
and `web-v2/lib/plan/generate.ts` were read for this task and **not
modified** — off-limits, per instruction, for other concurrent agents'
ownership.

---

## What "real engine" means for this corpus, precisely

- `composeAdaptation` is **pure** — every input is a plain value — so it is
  exactly what `resolveAdaptationProposals` (`load-adaptation-engine.ts`)
  calls once it has finished the impure, database-bound work of assembling a
  real `AdaptationEngineInput`. There are no exported `detectVolume`/
  `detectDuration`/`detectDensity` functions; each is a private lever inside
  `composeAdaptation`, reached the same way every real caller reaches it — by
  reading the `target: 'VOLUME'` / `'DURATION'` / `'DENSITY'` (or
  `'QUALITY_VOLUME'`, the session lever's sibling name) arm of its output.
- Fixture DURATION-3 additionally calls `classifyAdaptation` and
  `filterExecutionEvidenceByPrescribedWindow` directly and unmocked — the
  identical real, pure functions `_absorption_split.test.ts` and
  `docs/reports/absorption-reader-split-2026-09-01.md` already exercised for
  the `representative_execution` shadow-mode split the same night, reused
  here to build the ABSORPTION half of a DURATION fixture from first
  principles instead of typing a verdict by hand.
- `load.ts` is on this task's do-not-touch list. Nothing here edits it —
  `filterExecutionEvidenceByPrescribedWindow` is only ever *called*, at its
  existing exported signature.

---

## The 9 fixtures, with real engine output

All console lines below are copied verbatim from a real
`npx vitest run lib/adaptation/_duration_volume_density_replay_corpus.test.ts --reporter=verbose`
invocation on 2026-09-01. All 12 tests pass; `npx tsc --noEmit` is clean;
`npx vitest run lib/adaptation --exclude '**/*.audit.test.ts' --exclude '**/*.script.ts'`
is 164/164 passing (no regression in the adjacent suites, up from the PACE
corpus's own 148/148 the same night); `scripts/check-coercion.sh`,
`check-swallowed-failure.sh`, `check-automatic-mutations.sh`,
`check-anchor-derivation.sh`, `check-normal-window.sh` and
`check-doctrine.sh` all pass.

### DURATION 1 · a long run tolerated cleanly, absorption genuinely good — a clean PROGRESS case

One controlled long run, `durabilityEvidence: true`, no late-run collapse,
absorption band `normal` (permits load progression):

```
PROGRESS conf=0.700 [LONG_RUN_TOLERATED_WITHOUT_COLLAPSE] 16->17 ::
"The last long run finished under control. Take the long run to 17 mi."
```

**Falsified:** the identical clean long run, with absorption pulled to
`marginal`, does **not** still progress:

```
HOLD conf=0.600 [ABSORPTION_MARGINAL] 16->16 ::
"The long run holds at 16 mi. The current load is being completed but not
 absorbed cleanly, and a longer long run is more of the same load."
```

Confirms the PROGRESS above genuinely rests on the absorption read, not
merely on a long run being present in `evidence.recent`.

### DURATION 2 · tolerated but absorption marginal — held correctly, never a finding about the run itself

The **same** clean long run as DURATION-1 (byte-identical `LongRunRead`),
absorption forced to `marginal`:

```
HOLD conf=0.600 [ABSORPTION_MARGINAL] 16->16 ::
"The long run holds at 16 mi. The current load is being completed but not
 absorbed cleanly, and a longer long run is more of the same load."
```

**Falsified:** restoring absorption to `normal` on the identical long-run
evidence flips it to PROGRESS (byte-identical to DURATION-1's own output).
This confirms `detectDuration`'s own structure, read directly in the source:
`absorptionPermitsLoadProgression` is checked **before** `evidence.recent`
is ever read — the hold above is never a sentence about the long run.

### DURATION 3 · a long run inside a taper/recovery window — today's LIVE behavior vs. the not-yet-promoted `representative_execution` counterfactual

`docs/reports/absorption-reader-split-2026-09-01.md` §6 traced
`detectDuration` directly and found its absorption gate is fed
`actual_load_absorption` — the raw 42-day window, no taper/race/recovery
exclusion at all — and named this as the exact live mechanism that would
flip once a human promotes `representative_execution` (still shadow-mode
only as of that report; **not** wired into any live path). This fixture
builds the concrete shape the report described: 3 genuinely clean quality
sessions before a half marathon's taper, 5 missed inside its taper+recovery
window (`prescribedWindowsFrom` on a half at 2026-08-16 excludes
2026-08-02..2026-08-30 — the identical shape `_absorption_split.test.ts`
already uses for its own fixture) — read two ways through the real
`classifyAdaptation`, each verdict then fed into the real `composeAdaptation`
alongside one genuinely tolerated long run.

**Unfiltered — `actual_load_absorption`, what `detectDuration` reads today:**

```
marginal/STAY execution=-1.125 :: "Holding the current stimulus rather than
 adding to it — 3 of 8 key sessions delivered the full stimulus · 5 not run."

[DURATION-3 LIVE]
HOLD conf=0.600 [ABSORPTION_MARGINAL] 16->16 ::
"The long run holds at 16 mi. The current load is being completed but not
 absorbed cleanly, and a longer long run is more of the same load."
```

**Filtered — `representative_execution`, the shadow-mode counterfactual
(not wired anywhere live):**

```
normal/PROGRESS execution=2.000 :: "Recent sessions look good, but it is not
 yet enough weeks to call it a trend. Staying on the planned progression."

[DURATION-3 COUNTERFACTUAL]
PROGRESS conf=0.700 [LONG_RUN_TOLERATED_WITHOUT_COLLAPSE] 16->17 ::
"The last long run finished under control. Take the long run to 17 mi."
```

**The gate ordering matters, concretely:** `evidence.recent` — the actual
long-run read — is byte-identical in both calls. The taper's own long-run
`lookback` mechanism (Rule 8, `representativeLookback`) is **already wired
live** for `longRun.recent`/`longRun.lookback` themselves (confirmed by
reading `load-adaptation-engine.ts`'s `longRunFrom` call site). What is
**not** yet wired is the separate, upstream `absorption` gate `detectDuration`
checks first — that is `representative_execution`, and it is what this
fixture isolates.

**Falsified (without touching `load.ts`):** `load.ts` is off-limits to edit,
so the break is applied at the *input* the real, unmodified
`filterExecutionEvidenceByPrescribedWindow` is given, not to its source.
Calling it with an **empty window list** — the exact input state that exists
when `isPrescribedNonNormal` can exclude nothing — collapses the "filtered"
verdict back to the unfiltered one:

```
[DURATION-3 FALSIFY · windows=[]]
marginal/STAY execution=-1.125 :: "Holding the current stimulus rather than
 adding to it — 3 of 8 key sessions delivered the full stimulus · 5 not run."

[DURATION-3 FALSIFY compose]
HOLD conf=0.600 [ABSORPTION_MARGINAL] 16->16 :: ...
```

Confirms the real `prescribedWindowsFrom([...])` windows — not some artifact
of the specific dates chosen — are what unlock the counterfactual PROGRESS.

**Read plainly: this fixture demonstrates a real, currently-live gap, not a
fix.** `detectDuration` today, unmodified, holds a runner whose actual long
run was clean and tolerated, because the *load-absorption* verdict feeding
its first gate is diluted by a taper/recovery block it does not exclude.
Promoting `representative_execution` (a human decision, explicitly deferred
per `docs/PRODUCT_DECISIONS.md` 2026-09-01 §1) would close it. This fixture
does not promote anything — it makes the gap a permanent, named regression
fixture so the day it *is* promoted, this file needs updating rather than
silently starting to pass on old assumptions.

### DURATION 4 · insufficient long-run evidence in the window — INSUFFICIENT_EVIDENCE, not HOLD

Absorption permits progression; `longRun.recent` is empty:

```
INSUFFICIENT_EVIDENCE conf=0.600 [NO_LONG_RUN_EVIDENCE_IN_WINDOW] 16->16 ::
"The long run stays at 16 mi. No long run in the last 28 days to read."
```

Asserted structurally: an `INSUFFICIENT_EVIDENCE` proposal never carries a
reason code that asserts a finding (`LONG_RUN_SHOWED_LATE_COLLAPSE` is
explicitly absent) — Rule 11's "don't know / measured zero / the read
failed are three facts," checked in code rather than left to a reviewer's
eye, mirroring the same structural check the PACE corpus's Fixture 4 already
runs for `contradictionsIn`.

**Falsified:** adding exactly the one tolerated long run
`DURATION_PROGRESS_MIN_TOLERATED_LONGS` requires flips it straight to
PROGRESS (byte-identical to DURATION-1's output), confirming the empty
window — not some other silent condition — is what drove the refusal.

### VOLUME 5 · a mature, absorbed plan with headroom → PROGRESS

Three weeks each at ≥90% of a 45 mi/wk prescription:

```
PROGRESS conf=0.800 [RECENT_LOAD_ABSORBED,STEP_CLAMPED_TO_RAMP_CAP] 45->49.5 ::
"The last 3 weeks were absorbed at 45 mi. Take the week to 49.5 mi."
```

`historicalTolerance` was set (sustained 50 mi/wk, consistent with the
absorbed-weeks read) but the assertion confirms it is **never consulted on
this path** — `reasonCodes` does not contain
`HISTORICAL_VOLUME_TOLERANCE_ESTABLISHED`. This is a genuine, honestly-noted
finding about `detectVolume`'s own structure (matching
`absorption-reader-split-2026-09-01.md` §6's own observation about VOLUME):
the mature-plan branch answers entirely off `recentWeeks`/`absorbed`, and a
supportive `historicalTolerance` value sitting alongside it is inert.

**Falsified:** dropping two of the three weeks below the 90%-absorbed share
(same current, same ceiling) correctly holds instead:

```
HOLD conf=0.800 [LOAD_NOT_YET_ABSORBED] 45->45 ::
"Weekly volume holds at 45 mi. 1 of the last 3 scheduled weeks came in
 complete; 2 are needed before the week grows."
```

### VOLUME 6 · historical tolerance below the prescribed week — the exact pattern found on the owner's real account the night `absorption-reader-split-2026-09-01.md` was written

Mirrors that report's §6 numbers precisely: a one-week-old plan (`scheduled.
length < VOLUME_PROGRESS_MIN_ABSORBED_WEEKS`) prescribing 45 mi/wk, against
33.4 mi/wk of Rule-8-filtered historical tolerance:

```
HOLD conf=0.800 [CURRENT_PLAN_TOO_YOUNG_TO_JUDGE_ABSORPTION,LOAD_NOT_YET_ABSORBED] 45->45 ::
"Weekly volume holds at 45 mi. Your own recent training averages 33.4 mi a
 week, which is below the week already prescribed."
```

**Falsified:** raising the identical young plan's historical tolerance to 50
mi/wk (clearly above both the 90%-of-current bar *and* current itself — see
the note below on why 44 alone is not enough) flips it to PROGRESS:

```
PROGRESS conf=0.600 [HISTORICAL_VOLUME_TOLERANCE_ESTABLISHED,
  CURRENT_PLAN_TOO_YOUNG_TO_JUDGE_ABSORPTION,STEP_CLAMPED_TO_RAMP_CAP,
  STEP_HELD_TO_DEMONSTRATED_HISTORICAL_VOLUME] 45->49.5 ::
"This plan is too new to judge, and your own training has been holding 50
 mi a week. Take the week to 49.5 mi."
```

**A finding surfaced while tuning this falsification, worth recording
directly:** the first attempt raised historical tolerance to 44 mi/wk — high
enough to clear the 90%-of-current admissibility test (44 ≥ 45 × 0.9) — and
the fixture *still held*, with a different, correct reason
(`STEP_HELD_TO_DEMONSTRATED_HISTORICAL_VOLUME`): "This plan is too new to
judge, and it is already at the 44 mi a week your own training supports."
`detectVolume` treats "history supports the number, but that number is at or
below current" as its own distinct hold, separate from "history does not
support this week at all." Both are correct, doctrine-consistent readings —
history that only just clears the admissibility bar does not, on its own,
buy a *step past* the current week — but it means a value in the 40.5-45
mi/wk band produces a HOLD for two structurally different reasons depending
on exactly where it falls, which is worth a future reader knowing rather
than rediscovering.

### VOLUME 7 · a plan too young to judge current-week absorption, correctly falling back to filtered historical tolerance — the Rule 8 fix

`adaptation-engine.ts`'s own header names this exactly: "a plan authored
yesterday knows nothing about a runner who has held 43 mi/wk since June."
This fixture mirrors that shape: a one-day-old plan prescribing 38 mi/wk
against 44 mi/wk of established historical tolerance:

```
PROGRESS conf=0.600 [HISTORICAL_VOLUME_TOLERANCE_ESTABLISHED,
  CURRENT_PLAN_TOO_YOUNG_TO_JUDGE_ABSORPTION,STEP_CLAMPED_TO_RAMP_CAP,
  STEP_HELD_TO_DEMONSTRATED_HISTORICAL_VOLUME] 38->41.8 ::
"This plan is too new to judge, and your own training has been holding 44
 mi a week. Take the week to 41.8 mi."
```

The step is capped **to what history actually demonstrates** (41.8, itself
below the 44 mi/wk ceiling because the week-over-week/absolute ramp caps
bind first) — asserted directly: `proposedVal <= 44`. Never a mile past what
the runner has shown he tolerates, matching the engine's own comment: "the
history says he tolerates 43, it does not say he tolerates 48."

**Falsified:** the identical young plan with VOLUME-6's own historical number
(33.4, below the bar) correctly holds instead of progressing:

```
HOLD conf=0.800 [CURRENT_PLAN_TOO_YOUNG_TO_JUDGE_ABSORPTION,LOAD_NOT_YET_ABSORBED] 38->38 ::
"Weekly volume holds at 38 mi. Your own recent training averages 33.4 mi a
 week, which is below the week already prescribed."
```

VOLUME 6 and VOLUME 7 are a matched pair by construction — same mechanism
(`planTooYoung` → `historicalTolerance` fallback), opposite outcome, each
one's falsification is literally the other fixture's own numbers.

### DENSITY 8 · a plan row that DOES carry a progression-block marker — evaluable, not refused

`density.gate = 'RESOLVED'` with one `ACCELERATE` resolution that shortens
recovery on the same work (`lever: 'work_density'`):

```
PROGRESS conf=0.700 [PROGRESSION_GATE_RESOLVED_A_DENSER_SESSION]
reps=4->reps=4 :: "Absorbing the block well. Same pace, less recovery."
```

`set.refusals` is confirmed empty for the DENSITY lever.

**Falsified:** the identical resolution, but the gate reports
`NO_AUTHORED_PROGRESSION_BLOCK` (DENSITY-9's own shape), correctly refuses
instead of evaluating stale content:

```
REFUSED lever=DENSITY code=NO_PROGRESSION_TARGETS ::
"No plan row in the week carries a progression block, so the progression
 gate had nothing to decide about. This is an authoring gap in the Plan
 Generator, not a runner-evidence gap, and no amount of training will close it."
```

### DENSITY 9 · a plan row that does NOT carry a progression-block marker — refuses with `NO_PROGRESSION_TARGETS`, never silence

The default, unmodified density slice (`gate: 'NO_AUTHORED_PROGRESSION_BLOCK'`,
`resolutions: []`) — the production reality named in `adaptation-engine.ts`'s
own header comment, measured 2026-08-31 at six plan rows out of 4,639 across
the whole database carrying a progression block at all:

```
REFUSED lever=DENSITY code=NO_PROGRESSION_TARGETS ::
"No plan row in the week carries a progression block, so the progression
 gate had nothing to decide about. This is an authoring gap in the Plan
 Generator, not a runner-evidence gap, and no amount of training will close it."
```

Asserted byte-identical to the exported `densityRefusalFor('NO_AUTHORED_
PROGRESSION_BLOCK')` — a consumer and this corpus read the exact same
sentence (Rule 16).

**Falsified:** handing the gate a resolved block (DENSITY-8's own resolution)
makes the refusal disappear and a PROGRESS proposal appear in its place
(byte-identical to DENSITY-8's output) — confirming the refusal is genuinely
gated on `gate !== 'RESOLVED'`, not simply "density never fires regardless
of input."

---

## Falsification summary (Rule 18)

Every one of the 9 fixtures was falsified — the specific clause argued to
drive its decision was flipped, the WRONG verdict was confirmed, then the
real input was restored and the correct verdict re-confirmed:

| Fixture | What was flipped | Wrong verdict confirmed | Real verdict confirmed |
|---|---|---|---|
| DURATION 1 | absorption normal → marginal | HOLD | PROGRESS |
| DURATION 2 | absorption marginal → normal | PROGRESS | HOLD |
| DURATION 3 | real prescribed windows → `[]` (filter inert) | HOLD (collapses to live) | PROGRESS (counterfactual) |
| DURATION 4 | empty `recent` → one tolerated long run | PROGRESS | INSUFFICIENT_EVIDENCE |
| VOLUME 5 | 3/3 absorbed weeks → 1/3 absorbed | HOLD | PROGRESS |
| VOLUME 6 | historical 33.4 → 50 mi/wk | PROGRESS | HOLD |
| VOLUME 7 | historical 44 → 33.4 mi/wk | HOLD | PROGRESS |
| DENSITY 8 | gate RESOLVED → NO_AUTHORED_PROGRESSION_BLOCK | refusal | PROGRESS |
| DENSITY 9 | gate NO_AUTHORED_PROGRESSION_BLOCK → RESOLVED | PROGRESS | refusal |

DURATION and DENSITY each have 3-4 fixtures falsified (all of them); VOLUME
has all 3. DENSITY has only 2 fixtures total in this corpus (both
falsified) — the task asked for "8. carries a marker" and "9. doesn't," which
is a complete pair by construction, and each one's falsification is
literally the other fixture's own shape.

---

## What this corpus proves, and what it does not

**Proves:**

- `composeAdaptation` — the real, unmodified function — produces the
  documented decision on 9 explicit, hand-authored `AdaptationEngineInput`
  shapes, each isolating one named DURATION/VOLUME/DENSITY behavior: clean
  tolerance, absorption-gated hold (twice, as a matched pair), the
  live/not-yet-promoted `representative_execution` gap, absence vs. finding,
  mature-plan absorption, the exact real-account historical-tolerance
  shortfall, the Rule 8 young-plan fallback, and the authored/unauthored
  progression-block split.
- Every fixture's driving clause was falsified directly against the real
  code — not merely asserted once and trusted. A future change to
  `absorptionPermitsLoadProgression`, the `VOLUME_PROGRESS_MIN_ABSORBED_WEEKS`
  bar, the historical-tolerance fallback, or `densityRefusalFor` that breaks
  one of these 9 documented behaviors fails loudly, in `npm test`, not
  silently.
- Fixture DURATION-3 traces a real, currently-live gap named in
  `absorption-reader-split-2026-09-01.md` §6 to a concrete before/after using
  only real, unmodified functions (`classifyAdaptation`,
  `filterExecutionEvidenceByPrescribedWindow`, `composeAdaptation`) — not a
  hypothetical description of the gap, an executable one, permanently
  regression-tested in its *current* (unpromoted) state.

**Does not prove:**

- **That these exact shapes occur with any particular frequency in real
  training**, or that `load-adaptation-engine.ts` — the impure database
  shell — correctly assembles these shapes from raw activity data for any
  account. That is `_adaptation_engine.audit.test.ts`'s job, against the one
  real account this database holds.
- **Cross-runner diversity.** Per `absorption-reader-split-2026-09-01.md` §2:
  exactly one real account in this database has training history at all
  (`dnitch85@me.com`); every other account is a zero-run QA fixture. Three of
  these nine fixtures (DURATION-3, VOLUME-6, VOLUME-7) deliberately mirror
  that one account's own real numbers (45 mi/wk / 33.4 mi/wk historical
  tolerance; the AFC taper's real session shape). This is still, honestly,
  **one account's evidence shape wrapped in synthetic scenarios** — the same
  limitation `pace-replay-corpus-2026-09-01.md` named for its own 13
  fixtures. It buys confidence that the DECISION LAYER handles these shapes
  correctly when they occur; it buys nothing about how often a real
  population of runners would produce them, what shapes a *different*
  runner's training would present that this one account never has, or
  whether the loader (`load-adaptation-engine.ts`) reliably produces these
  exact input shapes from any account's raw data.
- **That DURATION-3's counterfactual is the right call to promote.**
  `docs/PRODUCT_DECISIONS.md` 2026-09-01 §1 reserves that decision for a
  human, after reviewing `absorption-reader-split-2026-09-01.md`'s full
  season-wide shadow-run. This fixture makes the DURATION-specific
  consequence of that decision concrete and permanently testable; it takes
  no position on whether to promote.
- **Multi-day production stability**, or anything about `shadow-compare.ts`'s
  own database-bound persistence or cron-wiring correctness — out of scope
  here for the identical reason the PACE corpus named: touching that file's
  DB-bound logic would mean either mocking the database or duplicating its
  shell, which is exactly the general-purpose synthetic-history platform
  this task was told not to build.

---

## Files touched

- `web-v2/lib/adaptation/_duration_volume_density_replay_corpus.test.ts` —
  new. 9 fixtures, 12 tests, all passing, DB-free, part of `npm test`.
- `docs/reports/duration-volume-density-fixture-corpus-2026-09-01.md` — this
  report.

No file owned by another agent tonight (`adaptation-engine.ts`, `load.ts`,
`shadow-compare.ts`, `lib/plan/generate.ts`) was modified — each was read, in
full or in the relevant part, where this task needed to cite or reuse it.

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run lib/adaptation/_duration_volume_density_replay_corpus.test.ts --reporter=verbose` — 12/12 passing.
- `npx vitest run lib/adaptation --exclude '**/*.audit.test.ts' --exclude '**/*.script.ts'` — 164/164 passing (no regression in the adjacent suites).
- `scripts/check-coercion.sh` — pass (33 argued exemptions, 133 on the named ratchet).
- `scripts/check-swallowed-failure.sh` — pass (13 argued exemptions).
- `scripts/check-automatic-mutations.sh` — pass (23 registry entries, gate green).
- `scripts/check-anchor-derivation.sh` — pass (4 sites, 5 declared files verified).
- `scripts/check-normal-window.sh` — pass (33 registry entries, all argued).
- `scripts/check-doctrine.sh` — pass (323 citations resolve against `Research/`).
