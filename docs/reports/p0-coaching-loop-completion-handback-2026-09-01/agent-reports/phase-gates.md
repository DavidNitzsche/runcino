# Phase 0 · trustworthy baseline — agent-gates

Branch `p0/gates`, based on `origin/main` `7cac80f0` (newer than the specified
`43e15e88`, which is an ancestor). Ten commits, none pushed to main, nothing
merged.

| # | SHA | Subject |
|---|---|---|
| A | `9c2c18d8` | test(evidence): stop pinning a live production row's data quality |
| E | `12086e29` | fix(adaptation): a test must not dirty the repo it is testing |
| C1 | `e1ed5848` | fix(gate): key the EMPTIED swallow ratchet on identity, not a count (F-2) |
| C2 | `c634d479` | fix(gate): scan lib/plan, watch, execution, prescription, race, today for coach voice (F-3) |
| C3 | `17834cbd` | fix(gate): derive plan writers per STATEMENT, not per file (F-8) |
| C4 | `4c1c8c23` | fix(coach): easy-discipline graded against an ARCHIVED plan's band (F-29) |
| C5 | `ec2d272b` | fix(gate,plan): the HANDED_BACK assertion was dead code; fix 3 of its 7 collapses (F-4/F-33) |
| C6/C7 | `95bc142b` | fix(gate): surface the 12 recorded doctrine violations, and stop 4 gates reporting OK over nothing (F-35, F-36) |
| D | `6fa37dd2` | docs(code): delete 5 false header invariants and repair 4 dangling citations (F-30, F-38, F-42) |
| B | `f21266e5` | ci: run the WHOLE test suite on main, with a liveness floor (F-31) |

---

# 1 · Every gate falsified, before and after

Every one was broken on purpose FIRST, the failure output captured, then fixed,
then re-falsified, then restored. Nothing below is a fix I assumed worked.

## F-2 · swallowed-failure ratchet was a budget, not a ratchet

**BEFORE (the defect, reproduced exactly as the audit demonstrated).** One
`.catch(() => ({ rows: [] }))` planted in `lib/plan/generate.ts`, plus one
unrelated `.catch` tidied out of `lib/strava/connection-status.ts`:

```
swallowed-failure OK · 13 argued exemptions, empty-result baseline 374
```

A swallowed database read added TO THE PLAN ENGINE, paid for with a peripheral
cleanup, green.

**AFTER.** Same A+B swap, both halves named:

```
× no EMPTIED site is added, anywhere
    lib/plan/generate.ts::layoutWeek · 1 site(s), 0 on the ratchet
× no EMPTIED ratchet entry outlives the site it names
    lib/strava/connection-status.ts::loadReauthFailedRunIds
SWALLOWED-FAILURE FAIL · a database failure can still reach a runner as an answer
```

`EMPTIED_KNOWN` is now 374 `file::symbol` ids with per-id counts, modelled on
`LOAD_BEARING_KNOWN`. `EMPTIED_BASELINE` stays as the integer the shell reads
with sed on a cold container, cross-checked against the list length by a third
assertion so the two cannot drift apart. Restored; green.

## F-3 · coach voice did not scan `lib/plan`

**BEFORE.** `'Great work! You crushed it — keep going.'`
· in `lib/faff/goal-status.ts` (in scope) → FAIL, names exclamation mark, em
dash and hype.
· byte-identical in `lib/plan/block-preview.ts` (out of scope):

```
check-coach-voice · rule four
check-coach-voice OK · 189 user-facing source file(s) clean
```

**AFTER.** Scope widened to `lib/plan`, `lib/watch`, `lib/execution`,
`lib/prescription`, `lib/race`, `lib/today`. 189 → 290 files, 85 findings on
first run. Same string, same file:

```
✗ exclamation mark · web-v2/lib/plan/block-preview.ts:1
    Great work! You crushed it — keep going.
✗ em dash · web-v2/lib/plan/block-preview.ts:1
✗ hype · web-v2/lib/plan/block-preview.ts:1
```

Restored; `check-coach-voice OK · 290 user-facing source file(s) clean`.

## F-8 · automatic mutations derived plan writers per FILE

**BEFORE.** A second `UPDATE plan_workouts SET pace_target_s_per_mi = 600 …`
appended to `lib/plan/reanchor-plan.ts` (already declared under
`cron/snapshot-projections`):

```
guard 1 · registry shape   ok · 23 entries, ids unique, floors present
guard 2 · gate present     ok · gate present with its guards
guard 3 · full gate        ok · Tests  20 passed
PASS
```

**AFTER.** Same append, exactly one assertion fires:

```
× every plan-writing STATEMENT maps to a declared plan writer
    lib/plan/reanchor-plan.ts::quietlyRewritePaces  [UPDATE]  lib/plan/reanchor-plan.ts:699
FAILED · read the header of this file before changing anything.
```

Restored; `guard 3 · full gate ok · Tests 23 passed · PASS`.

## F-29 · ACTIVEPLAN-1 skipped any SQL not mentioning `training_plans`

**BEFORE.** Rule 14's own documented defect, verbatim in shape, appended to
`lib/coach/race-replacement.ts`:

```sql
SELECT COUNT(*)::text AS n FROM plan_workouts pw
 WHERE pw.user_uuid = $1 AND pw.is_quality = true
   AND pw.date_iso >= (CURRENT_DATE - INTERVAL '7 days')::text
```

```
Test Files  1 passed (1)
     Tests  4 passed (4)
```

**AFTER.** Same plant:

```
ACTIVEPLAN [user-scoped]  lib/coach/race-replacement.ts
× no unguarded, unexempted join reads across every plan version
```

Widening it produced exactly ONE live finding, `lib/coach/easy-discipline.ts`,
fixed in the same commit. Restored; green.

## F-33 · the HANDED_BACK assertion was unreachable dead code

**BEFORE.** `_coercion_scan.test.ts:367` carried `if (!HANDED_BACK_FAILS)
return;` above its only `expect`. I replaced the assertion body with
`expect(1, 'this assertion is unreachable').toBe(2)`:

```
Test Files  1 passed (1)
     Tests  35 passed (35)
```

An impossible assertion passing is the strongest possible proof the branch had
never run. That is the mechanism that held F-4's seven live Rule 11 collapses
open while every build printed `coercion OK`.

**AFTER.** The assertion always runs; `HANDED_BACK_FAILS` only sets severity
against a new `HANDED_BACK_KNOWN` ratchet. Falsified in BOTH directions, and
the cold-container shell shape check fires too:

```
# a 6th entry not on the ratchet
COERCION FAIL · 6 handed-back entries but 5 on HANDED_BACK_KNOWN
× no collapse is handed back that is not on the ratchet · the flag sets severity
    "lib/plan/falsify.ts::aNewCollapse::catch"

# a ratchet id with no entry
COERCION FAIL · 5 handed-back entries but 6 on HANDED_BACK_KNOWN
× no ratchet entry outlives the collapse it names
    "lib/plan/gone.ts::alreadyFixed::catch"
```

Both restored; `coercion OK · 33 argued exemptions, 132 on the named ratchet,
peripheral baseline 181`.

## F-35 · `--silent` suppressed the doctrine report on every build

**BEFORE.** `check-doctrine.sh:114` ran `vitest run lib/doctrine --silent`. The
entire build output was:

```
doctrine OK · 323 citations resolve against Research/
```

The suppressed line was `=== DOCTRINE · 323 claims · 12 recorded violations ===`
plus twelve reasons, three of which open with "REAL VIOLATION, RUNNER-FACING,
NOT FIXED HERE".

**AFTER.** `--silent` replaced by `--disable-console-intercept` (vitest buffers
console output and drops it for a PASSING file — the report is printed by a
passing test on purpose, so it was suppressed a second way). The twelve now
print in full on every build.

A fourth RUNNER-FACING exemption planted in the registry:

```
× every RUNNER-FACING exemption is acknowledged with an owner and a decision
    "CONVENTION.simulator-projection-band::falsify-runner-facing"
× no exemption is stale · a recorded violation that no longer reproduces must be deleted
DOCTRINE FAIL
```

Restored; `doctrine OK`, 664 tests.

## F-36 · four gates reported OK while checking nothing

**BEFORE.** `check-coercion.sh`, `check-doctrine.sh`,
`check-generated-content.sh` and `check-swallowed-failure.sh` all printed a
caveat and `exit 0` with an OK line when the vitest binary was not executable.

**AFTER.** Falsified on all four by pointing `VITEST` at a non-existent binary
while `node_modules` is present (a pruned devDeps install):

```
=== check-doctrine          exit=1
    DOCTRINE FAIL · node_modules is present but …/vitest-PRUNED is not executable
=== check-coercion          exit=1
    COERCION FAIL · node_modules is present but …/vitest-PRUNED is not executable
=== check-swallowed-failure exit=1
    SWALLOWED-FAILURE FAIL · node_modules is present but …/vitest-PRUNED is not executable
=== check-generated-content exit=1
    GENERATED-CONTENT FAIL · node_modules is present but …/vitest-PRUNED is not executable
```

All four previously exited **0** with an OK line. The genuine cold-container
case stays honest — re-verified in a tree with no `node_modules` at all, the
checkable gates print `no node_modules (cold container) · ran the shape check
only` and pass. Restored.

## The new CI liveness assertion (Task B), falsified

```
A · empty run   -> ['only 0 test files ran (floor 300)', 'only 0 tests passed (floor 7000)']
B · mass skip   -> ['only 6700 tests passed (floor 7000)',
                    '300 tests skipped (ceiling 120) — tests are being disabled']
C · real run    -> ['PASS']
```

---

# 2 · The seven-user easy-band proof (F-29)

Run read-only as `faff_readonly`. The verification resolves the truth
INDEPENDENTLY rather than reusing either reader's ordering clause — Rule 14's
own warning that a check reusing the reader's filter reproduces the bug instead
of revealing it.

- **OLD** = the retired query verbatim: no plan pin, `ORDER BY date_iso DESC`.
- **NEW** = the shipped query: active plan only, nearest UPCOMING easy row.
- **TRUTH** = the active plan's band, resolved from `training_plans.archived_iso
  IS NULL` → `plan_id`, independent of both.

```
 runner   | old_read_archived_plan | old_lo | new_lo | active_plan_lo | new==active | old==active
----------+------------------------+--------+--------+----------------+-------------+------------
 0645f40c | f                      |    502 |    502 |            502 | t           | t
 606bcc38 | t                      |    543 |    583 |            583 | t           | f
 9298919a | f                      |    556 |    556 |            556 | t           | t
 b04e35e9 | f                      |    722 |    722 |            722 | t           | t
 bcefea06 | f                      |    583 |    583 |            583 | t           | t
 d2f504ac | f                      |    722 |    722 |            722 | t           | t
 fb21cb09 | t                      |    643 |    643 |            643 | t           | t
```

**`new == active` for 7 of 7.** No user gets a null band, so the fix introduces
no new refusal.

The old query read an **archived** plan for **2 of 7** (the audit measured 3 —
`d2f504ac`'s plan has been rebuilt since, which is exactly the volatility that
makes this defect dangerous rather than stable). For `606bcc38` the numbers
differed materially: graded against **543 s/mi (9:03/mi) from a plan that no
longer exists** while his active plan prescribes **583 s/mi (9:43/mi)**. A
runner executing his current plan exactly as written was being told he ran his
easy days 40 s/mi too fast.

The owner was safe **only by accident**: his CIM block runs further out than any
archived plan, so `ORDER BY date_iso DESC` happened to land on it. A rebuild to
a shorter horizon (post-race recovery, a mid-block rebuild) would have flipped
him silently.

Second defect in the same statement, fixed with it: the comment said "newest
easy spec wins" but `ORDER BY date_iso DESC` picks the **furthest-future
scheduled day**, which is a different quantity (Rule 16). An archived
long-horizon block outranks a freshly authored short one by construction.

Query kept at
`/private/tmp/claude-501/.../scratchpad/p0/easy-band-proof.sql`.

---

# 3 · Coach voice — every string changed

85 findings on the widened scan. **65 strings rewritten**, **14 lines
exempted** with `// ok:` (every one a verbatim doctrine anchor), **1 JSDoc
reformatted with the string untouched**.

The complete before/after list is in **appendix A** at the bottom of this file
(80 entries across 31 files, recorded mechanically as each edit was applied,
not reconstructed afterwards). Summary by intent:

### Runner-facing copy — dash replaced by a full stop or `·`, meaning unchanged

| File | n | What it is |
|---|---|---|
| `lib/plan/generate.ts` | 3 | the downhill-simulation long run (`:5127`), the embedded-T MLR (`:7016`), the taper downhill note (`:12473`) |
| `lib/execution/interpret.ts` | 4 | the post-run `why` a runner reads on Today |
| `lib/plan/workout-library-static.ts` | 9 | workout `notes` and `prescriptionText` |
| `lib/prescription/levers.ts` | 6 | the instruction and reasons attached to a session |
| `lib/prescription/trajectory.ts` | 2 | progression `change` sentences |
| `lib/plan/block-preview.ts` | 3 | incl. the `PROVISIONAL —` disclaimer at `:192` |
| `lib/plan/progression-gate.ts` | 2 | the ACCELERATE and HOLD `why` |
| `lib/plan/return-ladder.ts` | 1 | the walk-run stage line |
| `lib/plan/adapt.ts` | 1 | the heat-trigger `why` |

### Runner-facing APP VOICE, not just punctuation — three refusal reasons

`lib/plan/generate.ts` returned `{ ok: false, reason: '… · try again in a
moment' }` three times. A coach does not say "try again in a moment".

- `'could not read your training history · try again in a moment'`
  → `'could not read your training history · the plan you have stands'`
- `'could not read your recent training · try again in a moment'`
  → `'could not read your recent training · the plan you have stands'`
- `'could not read your recent runs · try again in a moment'`
  → `'could not read your recent runs · the plan you have stands'`

(`lib/audit/_swallowed_failure_fixes.test.ts` pins two of these; updated.)

### Engine diagnostics — fixed rather than exempted, because the fix is free

`lib/plan/validate.ts` ×15, `lib/plan/anchor-fit.ts` ×5,
`lib/plan/history-shapes.ts` ×2, `lib/plan/adaptive-ramp.ts`,
`lib/plan/mutate.ts`, `lib/race/course-elevation.ts` ×6,
`lib/race/course-geometry-source.ts` ×1. An exemption is debt; a `—` → `·` here
costs nothing.

### The 14 exemptions — every one a verbatim doctrine anchor

Rewriting the dash would break the citation the registry resolves against.

- `lib/plan/goal-tiers.ts` ×6 and `lib/plan/history-shapes.ts` ×2 — `Research/22`
  section names (`§"Marathon — Advanced"`, `§"5K — Advanced"`, …).
- `lib/race/distance-doctrine.ts` ×6 — `citation:` strings quoting Research/08,
  /10 and /18 text; developer-facing provenance, never rendered.

### One NOT exempted, fixed structurally

`lib/plan/zone-anchors.ts:85` — `§"Dosing rules — Daniels' caps"` sat on a
JSDoc **opening** line (`/**`), which the scanner does not skip. Reformatted so
the anchor line begins with `*`, which it already skips as a comment
continuation. **The string is byte-identical.**

---

# 4 · Everything else, by task

## A · the two stale production-row assertions (`9c2c18d8`)

`_activity_evidence.audit.test.ts` pinned the 2026-08-31 easy run's
PRE-RE-INGEST state as fact. The row was re-ingested from the watch on
2026-09-01 with seven splits and a 3300 s elapsed clock.

**I found a THIRD stale assertion the audit did not report**: the file also
asserted no RPE existed for that run under any key. One was filed (rpe 4,
`logged_at 2026-08-31 21:18`). It had been masked — the first failure aborted
the test before reaching line 155.

- The degraded-row case is now a **fixture** (`EASY_RUN_DEGRADED`, §D of
  `_activity_evidence.test.ts`), runs with no database, and carries a falsifier
  that the SAME row with splits restored refuses LESS and never more.
- The audit test asserts only INVARIANTS and BRANCHES on the row's live
  `splits_unreliable`: the three capacities stay `no_evidence`,
  `anchorMoveCandidate` stays false, every capacity and ledger entry reporting
  evidence carries `supporting_evidence_only`.
- Splits are read through `normaliseSplits` (watch rows store `pace: "8:14"`,
  not `paceSecPerMi` — re-spelling the shape by hand tests the spelling);
  `splits_validation` is asserted for SHAPE, not for its numbers; the RPE block
  asserts the KEY (row id, never `data.activityId`), which is the Rule 14 point
  it exists to make.
- Both file headers rewritten to say what is true, both carrying a Rule 22
  "what this cannot fail on" line.

## E · `allowFileFallback` (`12086e29`)

Default flipped `true` → `false`. Nothing that ships relied on the old default:
the cron route already passed `false`. The log directory now resolves PER CALL
from `FAFF_SHADOW_LOG_DIR` (not at module load) so a test can redirect it after
the module is cached. `_shadow_compare.audit.test.ts` is the one opt-in caller;
it writes to `mkdtemp` and **asserts the redirect took effect** rather than
assuming it. Verified: a full RO run of that file leaves `git status` clean.

Also deleted the stale premise in that file (migration 160 "not run") — the
table exists; the file posture is reached because the READ-ONLY role's INSERT is
refused at the Postgres permission level.

## C5 · three of the seven live Rule 11 collapses fixed, 7 → 5

Behaviour byte-identical when the reads succeed.

1. **`lib/plan/generate.ts:4544`** — the 3-hour long-run time cap. A null
   `easyPaceSecPerMi` silently skipped it: the safest reading of the data
   producing the most aggressive plan. For a 12:00/mi runner the cap binds at
   15 mi; without it a distance-driven 20-miler is a four-hour long run. The cap
   still cannot be APPLIED without a pace (nothing to divide by, and inventing
   one would be worse) — what changed is that the skip is now a structured
   `SAFETY CAP NOT APPLIED` refusal naming the cap, the doctrine citation, the
   week and the consequence.
2. **`lib/plan/adapt.ts::detectTrainingGap`** — `mileageByDay(...).catch(() =>
   new Map())` minted an empty history, which reads as "no gap" one line later,
   so a blip disabled the whole layoff-and-comeback detector AND reported the
   runner as not compromised. Now a structured `DETECTOR REFUSED` and a
   distinguishable null.
3. **`lib/plan/adapt.ts::detectVolumeOvershoot`** — `observableCoverageDays(...)
   .catch(() => 0)` collapsed the chronic-volume floor, and the comment two
   lines above already warned a lower baseline makes the shave fire MORE
   readily. Wrong direction for a reducing mechanism. Now refuses the pass.

`LOAD_BEARING_KNOWN` tightened 133 → 132 as a consequence — the coercion ratchet
caught its own now-stale entry and made me delete it, which is the ratchet
working.

The remaining five each carry an **owner** now (the gate requires it): the field
was added because "awaiting an owner" was equally true of all seven forever and
nothing told a routed entry from an abandoned one.

## D · five false headers, four dangling citations (`6fa37dd2`)

Every one verified false at HEAD before being touched.

| Site | The claim | Verified |
|---|---|---|
| `lib/training/lthr-reanchor.ts` | "PURE and imports no database at any depth" | `lthrFromRace` → `lthr.ts:180` → `await import('@/lib/db/pool')`. The sentence Rule 19 is named for, still present, 17 lines above a comment explaining it was untrue. |
| `_adaptation_engine.audit.test.ts` | "nothing in this repo calls `resolveAdaptationProposals` on a live path" | `shadow-compare.ts:315`, inside `runPaceShadowCompareCycle`, called unconditionally per user by the run-adaptations cron. |
| `lib/adaptation/load.ts` | migration 160 "NOT RUN" | `to_regclass('public.adaptation_shadow_log')` resolves; table holds 16 rows. |
| `lib/adaptation/authoring-convergence.ts` | "32 call expressions" | Re-counted at HEAD over the cited report's own import list: **35 across 31 lines**. Number removed rather than corrected — a count in a header rots faster than what it describes. The checkable half (zero `capacity-resolver` references in generate.ts) stays. |
| `scripts/adaptation-stability-report.ts` | prune route "never calls recordCronSuccess() at all" | It does, at `prune-adaptation-shadow-log/route.ts:44`. The caveat turned a real absence into a shrug. |

Citations: `normal-window-exemptions.ts` (never existed) → `normal-window-registry.ts`;
`lib/plan/drift-cron.ts` (no successor) → `app/api/cron/plan-drift/route.ts`;
`docs/2026-05-19-sim-sweep.md` (deleted, no successor anywhere in `docs/`) —
both citers now state the finding directly and name what enforces it.

`_doctrine_lint.test.ts:422` cited `lib/plan/citation.ts`, which has never
existed — a citation that does not resolve, inside the allowlist whose entire
subject is citations that do not resolve. **I kept the entries** (each is argued
beside it and the list is a ratchet) and replaced the sentence with the verified
truth: five `// TODO: no matching heading` markers exist, in `adapt.ts`,
`drift-monitor.ts`, `goal-gap.ts` and `run-state.ts` — and several entries carry
no marker at all (`seed-from-onboarding.ts:264`), so "already self-flagged" was
untrue of the list as a whole.

---

# 5 · FOR THE COORDINATOR — the three simulator-band violations

Acknowledged by name in `web-v2/lib/doctrine/runner-facing-violations.ts`, with
an owner and what the runner sees. **Acknowledged is not resolved.** They are
one defect and they resize together. `SIGMA_SEC_PER_MILE`'s short-distance rows
are far tighter than `Research` §13.7's ±1.5% floor:

| Distance | Band | §13.7 floor | What the runner sees |
|---|---|---|---|
| 5K | **±0.38%** | ±1.5% | a 19:46 projection gives A-goal 19:41, C-goal 19:51. Ten seconds apart is not three goals. |
| 10K | **±0.73%** | ±1.5% | a 40:59 projection spans 38 s A-goal to C-goal — twice as certain as §13.7's own same-day 5K→10K prediction. |
| half | **±1.38%** | ±1.5% | under the floor, marginally, same direction. |

The marathon row clears comfortably (±3.46% against a ±3% entry), which shows
the shape: the per-mile sigma is calibrated for the marathon and everything
shorter inherits a band that is too tight. Widening it changes what every 5K
runner is shown — a product decision for David, not a gate fix, so it was not
taken unilaterally.

**Two markers, not one.** The 5K and 10K rows say RUNNER-FACING; the half row —
same defect, same surface, one distance over — says "REAL VIOLATION, MARGINAL"
and never uses the word. Matching only RUNNER-FACING would have let two thirds
of one finding through, and would have made the marker something a future author
could drop by rewording instead of fixing.

---

# 6 · Verification

## Prebuild — all 17 gates, exit 0

```
palette-sync OK · iPhone v5 palette + typography locked …
spacing-tokens OK · every padding/spacing call in ViewsV5 + DesignV5 goes through V5.S.*
check-modelled-mark OK · 39 v5 source file(s) + 33 composer(s) + 115 web file(s) clean
check-coach-voice OK · 290 user-facing source file(s) clean          ← was 189
doctrine OK · 323 citations resolve against Research/
check-wire-keys OK · every declared key resolves in web-v2
generated-content OK · 38 authored columns, every one with a named reader
surface-sweep PASS · xcodeproj-sync PASS
swallowed-failure OK · 13 argued exemptions, empty-result baseline 374
derived-consistency OK · 1424 files opened, 314 family/file sites found
automatic-mutations PASS · normal-window PASS · goal-immutability PASS
anchor-derivation PASS · client-graph PASS
coercion OK · 33 argued exemptions, 132 on the named ratchet, peripheral baseline 181
COERCION · 5 known collapse(s) still open (HANDED_BACK_FAILS=false)   ← was 7
```

## `npx tsc --noEmit`

Clean, run after every commit.

## Full suite

**With `DATABASE_URL_RO` exported** (`DATABASE_URL` overridden onto the
read-only role), from `web-v2`:

```
Test Files  388 passed | 7 skipped (395)
     Tests  7987 passed | 10 skipped (7997)
  Duration  215.18s
exit=0
```

`git status --short` immediately after: **clean**. No test wrote to the tree —
which is the Task E fix holding (before it, the RO audit run appended three
records to the git-tracked `docs/reports/adaptation-shadow-log/*.jsonl`).

**Without credentials** (both variables unset — what CI will see):

```
Test Files  371 passed | 24 skipped (395)
     Tests  7935 passed | 62 skipped (7997)
exit=0
```

The 62 skips are credential-gated and every one reports as **skipped**, never
"passed". Enumerated from vitest's own JSON:

- 16 `*.audit.test.ts` files, fully skipped (46 tests) — all
  `describe.skipIf(!DATABASE_URL_RO)` or `RO ? describe : describe.skip`.
  Confirmed in isolation: running exactly those 16 with the variable unset
  gives `Test Files 16 skipped (16) / Tests 46 skipped (46)`.
- 8 further DB-gated files, fully skipped (11 tests): `lib/plan/_probe_cim_block`,
  `_probe_cim_course`, `_probe_cim_phases`, `_probe_cim_sessions`,
  `_probe_race_pace`, `_probe_vocabulary`, `_wave1_smoke_dryrun`,
  `lib/race/_probe_course_geometry_backfill`.
- 5 of 22 cases in `lib/plan/_open_block_authoring.test.ts`.

## `npx next build`

```
✓ Compiled successfully
  Linting and checking validity of types ...
  … full route table emitted …
next-build-exit=0
```

Rule 19's step. The gate chain being green is evidence about the checks; this
is the thing that actually ships.

## Push

`git push -u origin p0/gates` — **the full pre-push hook passed. No
`--no-verify`, nothing bypassed.**

```
✓ next build green. Railway is building the same tree.
watch OK · 195 test cases (195 @Test declarations); 20 boards inside Apple's content box
 * [new branch]        p0/gates -> p0/gates
```

The first attempt DID fail, and it is worth recording why, because it was the
environmental case the task anticipated:

```
WATCH FAIL · xcodegen could not generate native-v2/Faff.xcodeproj
  - Invalid config file "Secrets.xcconfig" for config "Debug"
✗ Watch gate FAILED. Push aborted.
```

Two things, neither of them my diff. `native-v2/Secrets.xcconfig` is
gitignored, so it exists in the root checkout and NOT in this worktree. And
the watch gate ran at all only because pushing a NEW branch gives the hook no
remote sha to range-diff, so its `scoped=0` fallback runs every gate
unconditionally — my range touches zero watch or native paths (`git diff
--name-only origin/main...HEAD` matches none of the five watch prefixes).

Rather than reach for `--no-verify`, I symlinked the gitignored
`Secrets.xcconfig` into the worktree and re-ran the real hook, which then
passed both halves in full. The symlink is removed and the `project.pbxproj`
the watch gate regenerated is reverted; `git status` in the worktree is clean.

---

# 7 · Left undone, and why

**Nothing in the assigned scope is incomplete.** Four things I found and did
NOT do, each a deliberate call:

1. **The three simulator-band violations are acknowledged, not fixed.**
   Resizing `SIGMA_SEC_PER_MILE` changes what every 5K and 10K runner is shown.
   That is David's call, not a gate fix, and taking it unilaterally is the
   thing §5 exists to prevent. Listed in full above.

2. **Two `try again in a moment` strings survive, outside the six directories
   I was told to add.** `app/api/coach/facts/route.ts:238` and
   `components/faff-app/views/TargetsView.tsx:430`. The second is web frontend,
   which CLAUDE.md has paused. The first is `app/api/coach`, and only
   `app/api/v5` is in scope. Worth noting as a Rule 22 gap in the coach-voice
   gate: **it cannot see JSX text nodes at all** — the TargetsView string is
   bare JSX, not a quoted literal, so widening the scope to
   `components/faff-app` (which is already in scope) would still not catch it.

3. **Four of the seven HANDED_BACK collapses remain**, each now with a named
   owner. Three need a signature change across a module boundary
   (`runnerIsCompromised`'s five internal detectors, `resolveShape`'s day
   budget, readiness' five pillars); the fourth
   (`chooseRescheduleDate::weeklyFrequency`) is blocked on
   `profile.weekly_frequency` being NULL for 8 of 16 production profiles —
   fixing the collapse without fixing the data would start refusing reschedules
   for half the accounts.

4. **`generate.ts`'s 75-minute general-aerobic day cap** has the same
   silently-disabled shape as the 3-hour long-run cap I fixed. Its registry
   entry is narrowed to say so and it is queued behind the one that is done.
   I fixed the one the audit traced and named, rather than opening a second
   front in the same commit.

---

# Appendix A · every coach-voice string, before and after

Entries marked `(exempted, not rewritten)` are the 14 doctrine anchors, where
the string is unchanged and only a `// ok:` reason was appended to the line.

**`web-v2/lib/plan/generate.ts`**

- `then ${finishMi}mi at ${mPaceWord} — on terrain that descends like your race.`
  → `then ${finishMi}mi at ${mPaceWord}, on terrain that descends like your race.`

- `ease back to steady after — embedded, no stop either side.`
  → `ease back to steady after. Embedded, no stop either side.`

- `race-pace downhill of the block — keep the taper's downhill running short and easy.`
  → `race-pace downhill of the block. Keep the taper's downhill running short and easy.`

- `reason: 'could not read your training history · try again in a moment'`
  → `reason: 'could not read your training history · the plan you have stands'`

- `reason: 'could not read your recent training · try again in a moment'`
  → `reason: 'could not read your recent training · the plan you have stands'`

- `reason: 'could not read your recent runs · try again in a moment'`
  → `reason: 'could not read your recent runs · the plan you have stands'`

**`web-v2/lib/execution/interpret.ts`**

- `'Unplanned hard running. Recorded as load, not as credit — whether it was absorbed is next week s question.'`
  → `'Unplanned hard running. Recorded as load, not as credit. Whether it was absorbed is next week s question.'`

- `and a higher recovery cost — the rest of the week has to account for it.'`
  → `and a higher recovery cost. The rest of the week has to account for it.'`

- `'Different shape, same stimulus — the work duration and the intensity both landed where the session intended.`
  → `'Different shape, same stimulus. The work duration and the intensity both landed where the session intended.`

- `That is worth more than the missed reps — it says something about today, or about the last few weeks.'`
  → `That is worth more than the missed reps. It says something about today, or about the last few weeks.'`

**`web-v2/lib/plan/progression-gate.ts`**

- `asks for a little more than the plan had drawn up — ${stepped.change}.``
  → `asks for a little more than the plan had drawn up · ${stepped.change}.``

- `The step up is deferred, not cancelled — repeating a stimulus you have not finished adapting to is how the next one lands better.'`
  → `The step up is deferred, not cancelled. Repeating a stimulus you have not finished adapting to is how the next one lands better.'`

**`web-v2/lib/plan/return-ladder.ts`**

- `'Silent again next time out and the stage moves — one advance a week.'`
  → `'Silent again next time out and the stage moves. One advance a week.'`

**`web-v2/lib/plan/adapt.ts`**

- `Heat no longer changes a session in this app — pace it by feel.``
  → `Heat no longer changes a session in this app. Pace it by feel.``

**`web-v2/lib/plan/workout-library-static.ts`**

- `'None — keep the whole thing easy.'`
  → `'None. Keep the whole thing easy.'`

- `Never skip strides — keep neuromuscular sharpness.`
  → `Never skip strides · they keep neuromuscular sharpness.`

- `Continuous — no walk breaks.`
  → `Continuous, no walk breaks.`

- `MP exact — not faster.`
  → `MP exact, not faster.`

- `'20 mi w/ 2×4 mi @ MP — full kit + fuel rehearsal'`
  → `'20 mi w/ 2×4 mi @ MP · full kit + fuel rehearsal'`

- `'"Comfortably hard" — sustainable for ~1 hr in a race.`
  → `'"Comfortably hard" · sustainable for ~1 hr in a race.`

- `Pace discipline is everything — too hard collapses the model.`
  → `Pace discipline is everything. Too hard collapses the model.`

- `Recoveries are MP — not easy.`
  → `Recoveries are MP, not easy.`

- `'Off — hydrate, fuel, sleep'`
  → `'Off · hydrate, fuel, sleep'`

**`web-v2/lib/prescription/levers.ts`**

- ``${args.preferredReason} — and this is the cheapest lever on it that still has room``
  → ``${args.preferredReason} · the cheapest lever on it that still has room``

- `'a VO2max session is a rep set — §6.1 bottoms out at three reps'`
  → `'a VO2max session is a rep set · §6.1 bottoms out at three reps'`

- `min becomes ${next.reps} x ${next.repMinutes} min — same volume, less rest``
  → `min becomes ${next.reps} x ${next.repMinutes} min · same volume, less rest``

- `back off and finish at the earlier pace — that is a complete session, not a failed one.'`
  → `back off and finish at the earlier pace. That is a complete session, not a failed one.'`

- `controlled probes — not yet a pattern``
  → `controlled probes · not yet a pattern``

- `controlled probes at the reached pace — repeated evidence, not one good day``
  → `controlled probes at the reached pace · repeated evidence, not one good day``

**`web-v2/lib/prescription/trajectory.ts`**

- `'recovery week — the stimulus holds'`
  → `'recovery week · the stimulus holds'`

- `'every lever is at its doctrine cap — the session holds'`
  → `'every lever is at its doctrine cap · the session holds'`

**`web-v2/lib/plan/block-preview.ts`**

- `'data before the rebuild happens, so it defaults to false — recovery plans '`
  → `'data before the rebuild happens, so it defaults to false. Recovery plans '`

- `disclaimer: 'PROVISIONAL — phase shape only (how many weeks of BASE/QUALITY/RACE-SPECIFIC/TAPER). '`
  → `disclaimer: 'PROVISIONAL · phase shape only (how many weeks of BASE/QUALITY/RACE-SPECIFIC/TAPER). '`

- `+ 'and no recent-quality-habit ramp) — not the real prescribed week the actual rebuild will build. '`
  → `+ 'and no recent-quality-habit ramp), not the real prescribed week the actual rebuild will build. '`

**`web-v2/lib/plan/anchor-fit.ts`**

- `' — the anchor IS the depressed mean.'`
  → `' · the anchor IS the depressed mean.'`

- ``run plus ${days - 1} at ${EASY_BELOW_LONG} of it). No ceiling is involved — the ` +`
  → ``run plus ${days - 1} at ${EASY_BELOW_LONG} of it). No ceiling is involved · the ` +`

- `' — and there is no block behind this runner to be a percentage OF.'`
  → `' · and there is no block behind this runner to be a percentage OF.'`

- ``conservativeVdotFromMileage(${f.meanMi.toFixed(1)}) — the interruption itself. ``
  → ``conservativeVdotFromMileage(${f.meanMi.toFixed(1)}) · the interruption itself. ``

- ``at week 5-6, after this block — the reverse taper ends at 70-80%, not above it.``
  → ``at week 5-6, after this block · the reverse taper ends at 70-80%, not above it.``

**`web-v2/lib/plan/adaptive-ramp.ts`**

- `+ `${action.bumps.length} row(s) proposed, 0 changed — the mutation boundary refused the ``
  → `+ `${action.bumps.length} row(s) proposed, 0 changed · the mutation boundary refused the ``

**`web-v2/lib/plan/mutate.ts`**

- ``[plan/mutate] could not record outcome (${rec.outcome}, source=${rec.source}) — ` +`
  → ``[plan/mutate] could not record outcome (${rec.outcome}, source=${rec.source}) · ` +`

**`web-v2/lib/plan/history-shapes.ts`**

- `Inside the recovery window the engine itself prescribed — THE case that broke everything.'`
  → `Inside the recovery window the engine itself prescribed · THE case that broke everything.'`

- `'Two weeks off with nothing behind them — a trip, a cold.`
  → `'Two weeks off with nothing behind them · a trip, a cold.`

**`web-v2/lib/race/course-elevation.ts`**

- `'track carries no coordinates — route cannot be verified'`
  → `'track carries no coordinates · route cannot be verified'`

- `% of the nominal distance — short of the course``
  → `% of the nominal distance · short of the course``

- `% of the nominal distance — longer than the course``
  → `% of the nominal distance · longer than the course``

- `m elevation jump between consecutive samples — corrupt altitude data``
  → `m elevation jump between consecutive samples · corrupt altitude data``

- `elevation samples per mile — too coarse for gross gain``
  → `elevation samples per mile · too coarse for gross gain``

- `m gap between consecutive points — signal dropout``
  → `m gap between consecutive points · signal dropout``

**`web-v2/lib/race/course-geometry-source.ts`**

- `` Curated course_library value still wins — stored for the route line, not for the elevation.``
  → `` Curated course_library value still wins · stored for the route line, not for the elevation.``

**`web-v2/lib/plan/validate.ts`**

- ``— volume-curve series not re-snapshotted after finalize`,`
  → ``· volume-curve series not re-snapshotted after finalize`,`

- ``${ctx.priorPlanPeakLongMi}mi — likely bad input data (run-history gap, VDOT signal loss)`,`
  → ``${ctx.priorPlanPeakLongMi}mi · likely bad input data (run-history gap, VDOT signal loss)`,`

- ``${Math.round(ceiling)}mi (base ${Math.round(rampBase)}mi) — plan ramp is unsupported by current fitness`,`
  → ``${Math.round(ceiling)}mi (base ${Math.round(rampBase)}mi) · plan ramp is unsupported by current fitness`,`

- `violations.push('No TAPER phase in plan blocks — plan will not taper before race');`
  → `violations.push('No TAPER phase in plan blocks · plan will not taper before race');`

- ``need ≥${minNonRaceTaperWks} for ${raceDistanceMi >= 20 ? 'marathon/ultra' : 'half-marathon'} — ` +`
  → ``need ≥${minNonRaceTaperWks} for ${raceDistanceMi >= 20 ? 'marathon/ultra' : 'half-marathon'} · ` +`

- ``(need ≥${c.taperDropMinPct}% by race) — taper too shallow`,`
  → ``(need ≥${c.taperDropMinPct}% by race) · taper too shallow`,`

- ``(max ${c.taperDropMaxPct}% for this distance, Research/08 §9.1) — taper too deep`,`
  → ``(max ${c.taperDropMaxPct}% for this distance, Research/08 §9.1) · taper too deep`,`

- ``${Math.round(expected * 10) / 10}mi at ${wksLeft} weeks out (Research/08 §9.1) — taper week too shallow`,`
  → ``${Math.round(expected * 10) / 10}mi at ${wksLeft} weeks out (Research/08 §9.1) · taper week too shallow`,`

- ``Taper week ${taperW[i].startISO}: ${taperW[i].weeklyMi}mi is ABOVE peak ${peakVol}mi — taper must reduce volume`,`
  → ``Taper week ${taperW[i].startISO}: ${taperW[i].weeklyMi}mi is ABOVE peak ${peakVol}mi · taper must reduce volume`,`

- ``${ref.weeklyMi}mi — taper must descend`,`
  → ``${ref.weeklyMi}mi · taper must descend`,`

- ``${taperW[i - 1].weeklyMi}mi — taper must descend`,`
  → ``${taperW[i - 1].weeklyMi}mi · taper must descend`,`

- ``Week ${week.startISO} (${week.phase}): no quality sessions prescribed — ` +`
  → ``Week ${week.startISO} (${week.phase}): no quality sessions prescribed · ` +`

- ``${(curr / chronic).toFixed(2)} — doctrine's high-risk line is ${ACWR_HIGH_RISK}`,`
  → ``${(curr / chronic).toFixed(2)} · doctrine's high-risk line is ${ACWR_HIGH_RISK}`,`

- ``Week ${week.startISO} (${week.phase}): ${d.type} ${d.distanceMi}mi exceeds the long ${longMi}mi — ` +`
  → ``Week ${week.startISO} (${week.phase}): ${d.type} ${d.distanceMi}mi exceeds the long ${longMi}mi · ` +`

- ``(dow ${raceDay.dow}) — no prescription may fall after race day`,`
  → ``(dow ${raceDay.dow}) · no prescription may fall after race day`,`

**`web-v2/lib/plan/goal-tiers.ts:586 (exempted, not rewritten)`**

- `'m': 3,      // §"Marathon — Beginner" Phases row: "peak (3 wk)"`
  → `// ok: Research/22 section names are verbatim doctrine anchors the registry resolves against; rewriting the dash breaks the citation`

**`web-v2/lib/plan/goal-tiers.ts:958 (exempted, not rewritten)`**

- `advanced:     { peakWeeklyMileageBand: [40, 70], peakLongMiBand: [8, 12],  qualityPerWeek: 3, longRunShare: 0.`
  → `// ok: Research/22 section names are verbatim doctrine anchors the registry resolves against; rewriting the dash breaks the citation`

**`web-v2/lib/plan/goal-tiers.ts:964 (exempted, not rewritten)`**

- `advanced:     { peakWeeklyMileageBand: [50, 75], peakLongMiBand: [13, 15], qualityPerWeek: 3, longRunShare: 0.`
  → `// ok: Research/22 section names are verbatim doctrine anchors the registry resolves against; rewriting the dash breaks the citation`

**`web-v2/lib/plan/goal-tiers.ts:980 (exempted, not rewritten)`**

- `advanced:     { peakWeeklyMileageBand: [65, 90],  peakLongMiBand: [22, 24], qualityPerWeek: 2, longRunShare: 0`
  → `// ok: Research/22 section names are verbatim doctrine anchors the registry resolves against; rewriting the dash breaks the citation`

**`web-v2/lib/plan/goal-tiers.ts:981 (exempted, not rewritten)`**

- `intermediate: { peakWeeklyMileageBand: [45, 55],  peakLongMiBand: [20, 22], qualityPerWeek: 2, longRunShare: 0`
  → `// ok: Research/22 section names are verbatim doctrine anchors the registry resolves against; rewriting the dash breaks the citation`

**`web-v2/lib/plan/goal-tiers.ts:982 (exempted, not rewritten)`**

- `developing:   { peakWeeklyMileageBand: [30, 45],  peakLongMiBand: [16, 20], qualityPerWeek: 1, longRunShare: 0`
  → `// ok: Research/22 section names are verbatim doctrine anchors the registry resolves against; rewriting the dash breaks the citation`

**`web-v2/lib/plan/history-shapes.ts:320 (exempted, not rewritten)`**

- `cite: 'Research/00a §"Volume progression rules" (the down weeks) + Research/22 §"Marathon — Intermediate" buil`
  → `// ok: Research/22 section names are verbatim doctrine anchors; the cite field must match the doc byte for byte`

**`web-v2/lib/plan/history-shapes.ts:336 (exempted, not rewritten)`**

- `cite: 'Research/00a §"Volume progression rules" · the climb the down weeks punctuate; Research/22 §"Marathon —`
  → `// ok: Research/22 section names are verbatim doctrine anchors; the cite field must match the doc byte for byte`

**`web-v2/lib/race/distance-doctrine.ts:133 (exempted, not rewritten)`**

- `citation: 'Research/08 §3.1 (:60) + §3.2 (:73-76) — "hit goal pace within 1-2 sec"',`
  → `// ok: citation strings quoting Research doc text; developer-facing provenance, never rendered at a runner`

**`web-v2/lib/race/distance-doctrine.ts:138 (exempted, not rewritten)`**

- `citation: 'Research/08 §3.1 (:61) + §3.3 (:89-92) — 0-2 km GP+5-10, then at GP',`
  → `// ok: citation strings quoting Research doc text; developer-facing provenance, never rendered at a runner`

**`web-v2/lib/race/distance-doctrine.ts:153 (exempted, not rewritten)`**

- `citation: 'Research/08 §3.1 (:63) — no ultra row; the marathon band\'s conservative end',`
  → `// ok: citation strings quoting Research doc text; developer-facing provenance, never rendered at a runner`

**`web-v2/lib/race/distance-doctrine.ts:481 (exempted, not rewritten)`**

- `citation: 'Research/10 (:141-146) — ultra warm-up is 10% of 5K: walk to start',`
  → `// ok: citation strings quoting Research doc text; developer-facing provenance, never rendered at a runner`

**`web-v2/lib/race/distance-doctrine.ts:573 (exempted, not rewritten)`**

- `'5k': { bandGPerHr: [0, 0], targetGPerHr: 0, citation: 'Research/18 §11 (:369) — 5K: 0 g/hr' },`
  → `// ok: citation strings quoting Research doc text; developer-facing provenance, never rendered at a runner`

**`web-v2/lib/race/distance-doctrine.ts:574 (exempted, not rewritten)`**

- `'10k': { bandGPerHr: [0, 30], targetGPerHr: 0, citation: 'Research/18 §11 (:370) — 10K: 0-30, last third only'`
  → `// ok: citation strings quoting Research doc text; developer-facing provenance, never rendered at a runner`

**`web-v2/lib/plan/zone-anchors.ts:85 (reformatted JSDoc, string unchanged)`**

- `/** The four quality paces `Research/01` ...`
  → `/**\n *  The four quality paces ... (the anchor line now begins with `*`, which the scanner skips as a comment)`
