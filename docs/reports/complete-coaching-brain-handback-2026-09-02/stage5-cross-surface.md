# Stage 5 · cross-surface verification — the contract, and what it found

**Branch** `stage5/cross-surface`, based on `a0ba9c9f`. **Not merged to main.**
**Date** 2026-09-02. **Reference runner** `0645f40c-951d-4ccc-b86e-9979cd26c795`,
active plan `pln_9a57561debb776e5`. **Production read-only throughout**
(`faff_readonly`; the suite asserts `current_user` before its first read and the
role has no write grant). No production write was attempted or made.

**One file added, nothing else touched:**
`web-v2/lib/audit/_cross_surface_contract.test.ts`. No implementation file, no
existing test, no script, no registry.

---

## 0 · The answer first

**The suite is green and that is not the headline. It found five live
disagreements**, and the reason it is green is that each one is registered as a
ratcheted exemption whose own test fails in three directions — when it closes,
when it changes shape, and when it spreads.

**Three of the five are the same failure, and it is the failure this stage
exists to catch:** a blocker closed *in code* on 2026-09-02 whose fix is
authoring-time, sitting on a block authored 2026-08-31. The ownership gates that
closed those blockers pass, correctly, because they scan source. The runner's
plan still carries the old numbers, on both the phone and the wrist, today.

Quoting `_race_target_ownership.test.ts`'s own Rule 22 section, which is the
gap this file was built into:

> · It cannot tell whether `race-outlook`'s answer is CORRECT.
> · It cannot see the wrist.
> · It cannot prove the refresh RAN. … they do not prove any production row has
>   been rewritten yet.

The single most important sentence in this report: **B7 made it impossible for a
row to prescribe a threshold pace beside a marathon heart rate. The runner's next
tempo session, 2026-09-08, still does — 430 s/mi, 155 bpm, pass line 164 — and
the watch ships all three.**

---

## 1 · What was built

`web-v2/lib/audit/_cross_surface_contract.test.ts`, 8 tests, ~830 lines.

Two blocks:

- **`cross-surface contract · registry hygiene (no database)`** — always runs.
  Asserts the exemption registry is non-empty, unique-id'd, and that every entry
  carries a reason, an observation, an owner and a closing condition above a
  minimum length. Prints a loud warning when `DATABASE_URL_RO` is unset saying
  the live half did not run and its own passing is not evidence.
- **`cross-surface contract · LIVE production (read-only)`** — 19 contracts,
  **214 live readings**, plus one test per registered disagreement.

**Every reading on both sides of every comparison is a real production read.
There is not one fixture in the file** (Rule 13 point 2). The phone side is the
actual `GET /api/v5/today` route handler invoked with a `NextRequest`; the watch
side is `buildWatchToday`, which is the entirety of `GET /api/watch/today`. The
only thing stubbed anywhere is `requireUserId`, because the session layer is not
what is under test.

### Machinery

| Helper | What it asserts |
|---|---|
| `contract(quantity, readings, minPaths, excluding)` | every non-null reading is the same number; at least `minPaths` resolved (liveness); every id in `excluding` still exists in the registry |
| `pairContract(quantity, canonical, other, knownId)` | a per-row two-sided comparison where the exclusion has to be decided per row |
| `stampContract(quantity, live, stamped, maxDriftSec, why)` | a deliberately-frozen value stays within an argued bound of the live resolver it was struck from — Rule 10's "freeze with provenance" posture, made checkable |
| `judge(entry, a, b, ctx)` | a registered disagreement is still exactly the recorded shape — fails on agreement (stale) and on a different shape (moved) |
| `judgeCount(entry, seen, ofHowMany)` | fails on zero occurrences (stale) and on more than `maxOccurrences` (spread) |

---

## 2 · Every quantity covered, and every path resolved for it

All values are the live production reads of 2026-09-02. **`ok` means every listed
path returned the same number.**

### 2.1 Threshold pace — **430 s/mi (7:10), 17 paths, ok**

| # | Path |
|---|---|
| 1 | `capacity-resolver.resolveThresholdCapacity(user, today).paceSecPerMi` |
| 2 | `load-prescription-anchors.resolvePrescribedPaceAnchors → composePaceAnchors.thresholdSecPerMi` |
| 3 | `training_plans.authored_state.pace_recompute.anchors.threshold_s_per_mi` |
| 4-5 | `plan_workouts.pace_target_s_per_mi` on the two future non-MP tempo rows (2026-09-08, 2026-09-22) |
| 6-7 | `plan_workouts.workout_spec.tempo_pace_s_per_mi` on the same two |
| 8-11 | `workout_spec.race_execution.threshold_s_per_mi` on all four future race rows |
| 12 | watch · `buildWatchToday('2026-09-08')` work phase `targetPaceSPerMi` (shape `window`, ±8) |
| 13 | iPhone · `GET /api/v5/today?date=2026-09-08` work step `"7:02-7:18 /mi"` → centre 430 |

*(17 because the race-row and tempo-row groups each contribute per row.)*

Basis on the canonical side: `sourceMode: direct`, confidence 0.835, VDOT 47.8.

### 2.2 Marathon pace — **472 s/mi (7:52), 10 paths, ok**

| # | Path |
|---|---|
| 1 | `composePaceAnchors.marathonSecPerMi` (durability exponent 1.0825, `personallyEvidenced: true`) |
| 2 | `race-outlook.trainingPrescription.paceSecPerMi` for the goal race |
| 3-4 | `pace_target_s_per_mi` on the two MP rehearsals (2026-11-17 · 11 mi @ MP, 2026-11-24 · 7 mi @ MP) |
| 5-6 | `workout_spec.tempo_pace_s_per_mi` on the same two |
| 7-9 | `workout_spec.finish_pace_s_per_mi` on the three M-finish long runs (2026-10-11, 10-25, 11-15) |
| 10 | CIM row `workout_spec.race_execution.training_pace_s_per_mi` |

**And the band's fast edge — 460 s/mi, 7 paths, ok**: `anchors.marathonRangeSecPerMi[0]`,
`race-outlook.trainingPrescription.rangeSecPerMi[0]`, `marathon_range_s_per_mi[0]`
on both MP rows, `finish_range_s_per_mi[0]` on all three M finishes.

### 2.3 The race projection — **11982 s (3:19:42), 3 paths + a stamp, ok**

| # | Path |
|---|---|
| 1 | `race-outlook.expectedRaceDay.expectedSec` (basis `trajectory`, projected VDOT 50.4) |
| 2 | `race-projection.raceProjectionFromOutlook().projectedSec` — **what `v5/races` and `v5/race/[slug]` render** |
| 3 | `goal_projection_snapshots.projected_sec`, latest row |
| stamp | CIM row `race_execution.expected_race_day_sec` = **11981**, 1 s drift, inside the argued 5 s bound |

**Excluded under `TARGETS-ROUTE-SHOWS-A-SECOND-PROJECTION`:**
`GET /api/targets/projection`.

**And the current-fitness expectation kept separate — 12230 s (3:23:50)**:
`race-outlook.currentProjection.expectedSec` against the row's
`current_projection_sec` 12231 (1 s stamp drift). Plus an explicit assertion that
**the two are not the same number** — Rule 16's own CIM incident was three
"projected" finishes live at once, and a contract that checks each against its own
owner would pass an engine that had collapsed them.

### 2.4 The HR band

| Quantity | Value | Paths | Verdict |
|---|---|---|---|
| aerobic HR ceiling | **151 bpm** | **62** — `zones.aerobicCeilingBpm(168)`, `workout_spec.hr_cap_bpm` on all 60 future aerobic rows, `buildWatchToday.hrCeilingBpm`, iPhone panel `"151 bpm"` | ok |
| threshold HR pass line | **164 bpm** | **20** — `zones.thresholdPassHrBpm(168)`, `rules[pass,hr].value` on all 18 future quality rows, the watch's own rules array | ok |
| prescribed HR target · row-vs-wrist | **155 bpm** | 5 — 4 rows plus the watch phase `hrTargetBpm` | ok *(they agree; both are wrong — see §3.1)* |
| **prescribed HR target · row-vs-canonical** | **164 vs 155** | 2 | **DISAGREES — registered** |

The ceiling chain is clean end to end and the pass line is clean end to end. The
target chain is not, and the wrist faithfully carries the row's error.

### 2.5 The prescribed race target — all four race rows, ok

| Row | Target | Paths |
|---|---|---|
| 2026-09-13 Santa Monica 10K | 416 | 3 |
| 2026-09-26 Dodgers 10K | 435 | 3 |
| 2026-11-08 Malibu HM | 422 | 3 |
| 2026-12-06 CIM | 443 | 4 (adds `race-outlook.execution.paceSecPerMi`) |

Paths per row: `pace_target_s_per_mi`, `race_execution.target_pace_s_per_mi`, the
`pace_target_s_per_mi_lo/hi` band centre, and for the goal race the owner itself.

**Excluded under `AUTHORED-SEED-IS-STILL-AN-UNSTAMPED-SECOND-RECORD`:**
`authored_state.prescribed_race_pace`.

**The pace-adrift abort, per row** — `racePaceAbortRule(distance, that row's own
target)` against the stored rule. Canonical: 437 / 457 / 443 / 465. Stored:
466 / 457 / 446 / 458. **Three of four diverge — registered.**

### 2.6 Two quantities the sweep added because the first run demanded them

| Quantity | Value | Paths | Verdict |
|---|---|---|---|
| easy / long pace ceiling | **502 s/mi (8:22)** | **60** — anchors, the authored stamp, `pace_target_s_per_mi_lo` on every future easy/long/recovery row, the iPhone work step `"no faster than 8:22 /mi"`, the iPhone panel band's fast edge | ok |
| shakeout pace ceiling | **532 s/mi (8:52)** | 5 | ok, and asserted **≠ 502** |

**Excluded under `WATCH-CEILING-IS-THE-BAND-MIDPOINT`:** the watch phase target.

---

## 3 · The five live disagreements

Each is a `KNOWN_DISAGREEMENTS` entry carrying both paths, a **shape predicate**
(not a hardcoded pair — see §5), the numbers observed, an argued reason, the
owning module, and what closing looks like. Each has its own test.

### 3.1 `HR-TARGET-ROW-IS-STALE` — 4 rows · **9 bpm** · reaches phone AND wrist

```
row 2026-09-08 (and 09-22, and two more)
  tempo_pace_s_per_mi   430   ← the canonical Daniels T out of resolveThresholdCapacity
  hr_target_bpm         155   ← round(168 × 0.925), the MARATHON row of the Friel table
  rules[pass,hr]        164   ← thresholdPassHrBpm(168), the THRESHOLD row

  canonical now:  prescribedHrTargetBpm({intensity:'threshold', lthr:168}) = 164
  watch payload:  phases[work].hrTargetBpm = 155, rules[pass] = 164
```

**The wrist asks for a heart rate that the same payload's pass rule marks as a
fail.** His own 2026-09-01 threshold session held 162 bpm at 7:02/mi, so the
prescribed target is 7 bpm below what he demonstrably holds at the pace it
prescribes.

This is verbatim the class the Stage 5 directive said "must be impossible now."
It is impossible in code — `zones.ts#prescribedHrTargetBpm` owns it and
`_hr_intensity_ownership.test.ts` gates it — and it is still true in the data,
because B7 (`9c5d9ce0`, 2026-09-02 05:34) changes what `spec-builder` *writes*
and nothing rewrites an already-authored spec. The block was authored 2026-08-31.

**Owner of the fix:** `lib/plan/recompute-paces.ts`, or a one-off backfill. It is
the only path that rewrites unsealed future rows.
**Closes when:** every future quality row carries `prescribedHrTargetBpm` of the
intensity its pace was prescribed at.

### 3.2 `RACE-ABORT-ANCHORED-TO-A-REPLACED-SEED` — 3 of 4 race rows

| Race | Target | Stored abort | Canonical | Gap |
|---|---|---|---|---|
| Santa Monica 10K 2026-09-13 | 416 | **466** | 437 | 29 s/mi **loose** — ~12% off, it can essentially never fire |
| Dodgers 10K 2026-09-26 | 435 | 457 | 457 | agrees |
| Malibu HM 2026-11-08 | 422 | **446** | 443 | 3 s/mi loose |
| **CIM 2026-12-06** | 443 | **458** | **465** | **7 s/mi TIGHT — the B-goal switch fires early** |

458 is `round(1.05 × 436)`, and 436 is the authoring seed the brain replaced.
The CIM row is the one that matters: on marathon day the wrist offers "switch to
the B plan" at a pace that is inside the runner's own prescribed band.

The B2 commit measured these same four rows in its own message and did not repair
them, because its fix is at authoring and refresh time.

**Owner of the fix:** `lib/race/race-row-refresh.ts#refreshRaceRowsForPlan` — it
already reprices the rule; it has not been run over this plan since B2 landed.
**Closes when:** every race row satisfies `stored === racePaceAbortRule(row target)`.

### 3.3 `AUTHORED-SEED-IS-STILL-AN-UNSTAMPED-SECOND-RECORD` — **180 s**

```
plan_workouts 2026-12-06        pace 443 s/mi   race_execution.target_sec 11610  (3:13:30)
authored_state.prescribed_race_pace  436 s/mi                 target_sec 11430  (3:10:30)
                                     ceiling_vdot 47.1  ← stale against a live threshold VDOT of 47.8
                                     authority: (absent)
```

`_race_target_ownership.test.ts` proves in source that no live module reads
`pace_s_per_mi` back as a value, and that gate is real and correct. What it
cannot see is that the blob is still a second, un-stamped, materially different
record of the same quantity on the runner's active plan. The `authority:
'provenance_only'` stamp B2 added lands on the next authoring.

### 3.4 `WATCH-CEILING-IS-THE-BAND-MIDPOINT` — **NEW, not in the scorecard** — 20 s/mi, every aerobic day

```
2026-09-02  easy 5 mi   spec band [502, 542]
  iPhone work step   "no faster than 8:22 /mi"        →  502
  iPhone panel       "Pace band 8:22-9:02/mi"          →  fast edge 502
  watch work phase   targetPaceSPerMi 522, paceShape 'ceiling', tolerance 30

2026-09-06  long 15 mi  spec band [502, 537]
  iPhone work step   "no faster than 8:22 /mi"        →  502
  watch work phase   targetPaceSPerMi 520, paceShape 'ceiling'
```

`paceShape: 'ceiling'` means, in the wire contract's own words, "do not go FASTER
than it." So **a 8:30/mi easy run is compliant on the phone and too fast on the
wrist.** And it is graded, not decorative: `phaseToleranceSec`'s own doc comment
says a ceiling phase carries a tolerance only "for a legacy client to draw its
band; the GRADER ignores it."

Mechanism: `lib/training/expand-spec.ts#expandEasy` / `#expandLong` set the work
phase's `targetPaceSPerMi` to `mid = round((lo + hi) / 2)` while `paceShapeFor`
declares that phase a ceiling. Both surfaces call the same expander; the phone's
card layer prints `lo` and the watch ships the phase target. `WU/CD-CEIL-1`
(2026-09-01) fixed exactly this for warm-up and cool-down — those two agree at
502 — and left the work phase on the midpoint.

**Owner of the fix:** `lib/training/expand-spec.ts`. One line, and it changes
what the wrist grades, which is why it is reported rather than done here.

### 3.5 `TARGETS-ROUTE-SHOWS-A-SECOND-PROJECTION` — four numbers, one race, one payload

```
canonical (v5/races, v5/race)                    11982   3:19:42   trajectory
GET /api/targets/projection · projectionSec      11902   3:18:22   raw Daniels equivalence
GET /api/targets/projection · summaryLine        "Projection 3:15:06 against a 3:00:00 goal"
GET /api/targets/projection · raceProjections[]  Marathon "3:29:17"  method personal-exponent
```

Three of those four strings say "projection". `goal_projection_snapshots` agrees
with the canonical 11982; `projection_snapshots(race_slug='cim')` holds the
11902, which the nightly cron writes and which `goal-gap.ts#classifyTrend` reads —
and that status can trigger a rebuild.

Demoted, not inert: the scorecard records this route's only Swift callers as v4
views behind `-faffLegacy`. It is still a deployed authenticated route.
`_race_projection.test.ts`'s hardcoded six-file scope cannot see it.

---

## 4 · Falsification — every assertion, broken on purpose, on live data

Eleven perturbations, each applied alone, each reverted before the next. Script:
`scratchpad/s5/falsify.sh`; per-case logs `scratchpad/s5/F1.log … F11.log`;
transcript `scratchpad/s5/falsify.out`. **All eleven were detected.**

```
=== F1 · a real, different production number injected into the threshold contract
F1  DETECTED
  · threshold pace (s/mi): 2 DIFFERENT NUMBERS across 18 paths —

=== F2 · liveness floor
F2  DETECTED
  · threshold pace (s/mi): LIVENESS — resolved 17 of 17 paths, floor is 99. Nulls: (none)

=== F3 · a contract naming a registry id that no longer exists
F3  DETECTED
  · projected finish · cim (s): excludes a path under KNOWN id "NO-SUCH-ENTRY", which the
    registry no longer holds. The entry was deleted without putting its path back into
    this contract.

=== F4 · the stamp-drift bound
F4  DETECTED
  · projected finish · cim · race_execution.expected_race_day_sec: STAMP DRIFT 1s exceeds
    the 0s bound (live 11982, stamped 11981).

=== F5 · KNOWN entry, STALE direction (the two sides agree)
F5  DETECTED
  Error: STALE EXEMPTION — HR-TARGET-ROW-IS-STALE: all 4 candidate sites now AGREE.
  Delete the registry entry and drop the exclusion from its contract.

=== F6 · KNOWN entry, the divergence changes shape
F6  DETECTED
  Error: THE DISAGREEMENT MOVED — HR-TARGET-ROW-IS-STALE still diverges but no longer in
  the recorded shape. A different defect is now producing this gap and it has not been argued.

=== F7 · the occurrence ratchet, SPREAD direction
F7  DETECTED
  Error: THE DISAGREEMENT SPREAD — HR-TARGET-ROW-IS-STALE: 4 sites diverge, the ratchet
  allows 2. Either a new site started producing the old number, or the cap was never
  lowered after the last repair. The ratchet may shrink, never grow.

=== F8 · the occurrence ratchet, STALE-by-count direction
F8  DETECTED
  Error: STALE EXEMPTION — RACE-ABORT-ANCHORED-TO-A-REPLACED-SEED: all 4 candidate sites
  now AGREE.

=== F9 · registry hygiene rejects an unargued entry
F9  DETECTED
  AssertionError: TARGETS-ROUTE-SHOWS-A-SECOND-PROJECTION.owner is too thin to be an
  argued reason: expected 1 to be greater than 20

=== F10 · the two race quantities must stay distinct
F10 DETECTED
  AssertionError: the trajectory projection and the current-fitness expectation are the
  SAME number — two quantities Rule 16 separated have collapsed back into one

=== F11 · the shakeout and easy anchors must stay distinct
F11 DETECTED
  AssertionError: the shakeout ceiling and the easy ceiling are the same number — two
  anchors have collapsed into one
```

Two notes on method:

- **F1 is deliberately not a synthetic `+1`.** The falsifier is the marathon
  anchor — a number the engine really produces, for the neighbouring quantity,
  taken from the same production read. A gate that only detects impossible values
  is weaker than one that detects a plausible mix-up, and a plausible mix-up is
  what actually happens.
- **F4 is how the 1-second stamp drift was measured rather than assumed.** The
  bound test and the measurement are the same instrument.
- **F5 through F8 are the four ways a registry entry can stop meaning anything**
  — it closes, it changes shape, it spreads, or its argument was never written.
  All four fail. That is the part to re-check if the file is edited.

**A twelfth falsification happened by accident and is the most useful one.** The
easy-ceiling contract's first version read `workout_spec.kind` instead of the row
`type`, and immediately reported *"6 DIFFERENT NUMBERS across 67 paths"* — 430,
417, 438 and two 532s pulled in beside the 502s. A race row carries `kind:
'long'` and a shakeout carries `kind: 'easy'`, and each is priced off a different
anchor. The check caught its own author's Rule 14 scoping mistake on the first
run, which is the only kind of first-run failure worth having. Fixed, and the
reasoning is written into the code rather than into this report only.

---

## 5 · Why the exemptions pin a SHAPE and not a pair

The obvious design — record "155 vs 164" and assert it — goes red the morning
the runner's LTHR moves, which is normal, correct engine behaviour. A gate that
cries wolf on normal behaviour is a gate people switch off, and this repo has
already learned that lesson twice (`vitest.setup.ts`'s header is about exactly
this).

So each entry carries a predicate over the two live values plus context:

```ts
// HR-TARGET-ROW-IS-STALE
shape: (canonical, persisted, ctx) =>
  persisted !== canonical && persisted === ctx.marathonIntensityTarget,
```

"the persisted target is the MARATHON row of the same doctrine table while the
canonical answer is the THRESHOLD row" survives a re-anchor, and still fails the
moment either side changes character. The 2026-09-02 numbers are carried in an
`observed` field and printed on failure — evidence, not an assertion.

`maxOccurrences` is the second half. Without it, `shape` alone would wave through
a brand-new row diverging the same way. It is a ratchet: it may shrink, never
grow, and zero occurrences fails as a stale exemption.

---

## 6 · What this suite CANNOT fail on (Rule 22), stated unflatteringly

Written into the file header too, so it travels with the code.

1. **A wrong number every surface agrees about.** This is a coherence check, not
   a correctness check. If the threshold resolver returns 700 s/mi tomorrow,
   every path here returns 700 and the file is green. Nothing in it reads
   doctrine. `lib/doctrine/registry.ts` is where correctness lives.
2. **Swift.** `native-v2` renders these payloads. A phone build that ignores
   `paceShape`, rounds differently, or draws a ceiling as a band passes every
   assertion. Rule 13 is only half-satisfied by an API-level check and **this is
   the half it is not.** The watch grader has `_watch_grader_parity.test.ts`;
   nothing gates what the iPhone DRAWS from these numbers.
3. **It is ONE runner.** A defect needing a second runner — no LTHR, no goal
   race, coached mode, a plan mid-rebuild — is unreachable. This is the Rule 15
   hole this file has, and it is the *opposite* of `_sweep_allusers`'s: that
   corpus has 11,598 archetypes that cannot express a history; this one has a
   complete history and no breadth. Neither substitutes for the other.
4. **It is ONE day.** The row sweeps walk every future row of the active plan, so
   the persisted half covers the taper and race weeks. The phone and watch
   payload comparisons are sampled on a handful of named dates, because each is a
   full route invocation.
5. **A quantity nobody thought to add.** There is no discovery mechanism.
   `cadence`, `fuel_mi`, `readinessScore`, elevation-adjusted pace, and the
   HR-drift band (which has *no server owner at all* — scorecard Row 18) are each
   shown on more than one surface and none is checked. The list is hand-written
   and inherits whatever its author failed to imagine.
6. **Whether a job RAN.** It compares the row against the resolver today. It says
   nothing about whether `plan-drift` or `run-adaptations` will fire tonight, or
   in what order (Rule 23).
7. **`describe.skipIf(!RO)` deletes the whole live half on one unset variable.**
   The always-on registry block is what stops that being silent, and it is a much
   weaker check than the one it guards.

Also honest: **the four `pairContract` abort checks do not themselves assert
agreement** — divergence there is owned entirely by the registry entry's test,
which walks all four rows and applies `judge` plus `judgeCount`. If that entry
were deleted without restoring the assertion, `pairContract`'s unknown-id check
fires (falsified as F3). That is the seam, and it is deliberate, not accidental.

---

## 7 · Findings I could not fix inside my boundary

The boundary was files whose names contain `_contract`. Every item in §3 needs an
implementation change or a data repair. Restated as actions, ranked by what
reaches the runner soonest:

| # | Action | Owner | Reaches |
|---|---|---|---|
| 1 | Rewrite `hr_target_bpm` on every unsealed future quality row from `prescribedHrTargetBpm` of the intensity the pace was prescribed at | `lib/plan/recompute-paces.ts` or a backfill | **iPhone + watch, next tempo is 2026-09-08** |
| 2 | Run `refreshRaceRowsForPlan` over `pln_9a57561debb776e5` so the four race rows' aborts are repriced | `lib/race/race-row-refresh.ts` | **watch, race day; CIM's is 7 s/mi TIGHT** |
| 3 | Carry the ceiling, not the band centre, on a ceiling-shaped work phase | `lib/training/expand-spec.ts#expandEasy/#expandLong` | **watch, every easy and long day** |
| 4 | Stamp or rewrite `authored_state.prescribed_race_pace` on the live plan | `lib/plan/generate.ts` (next authoring) | plan authoring |
| 5 | Delete `/api/targets/projection`, or make it resolve `race-outlook` | `app/api/targets/projection/route.ts` | v4 shell only, but it feeds `classifyTrend`, which can rebuild |

Items 1, 2 and 4 are **data repairs on the runner's live plan**, which is a
production write and therefore needs David's explicit go per the standing rule.
Items 3 and 5 are code.

**A note on 1 and 2 that is worth more than either fix:** both are the *same
gap*, and it is a gap in the gate design, not in the code. Rule 20's corollary
says fix the gate and not just the instance. The gate here is the class of
ownership check that scans source and concludes the question has one owner. **A
source-level ownership proof says nothing about the rows already written.** Every
future consolidation will have this shape, and the general fix is that a blocker
is not closed until the runner's live data satisfies it — which is precisely what
this suite now measures, and why it is worth running nightly rather than on push.

---

## 8 · Discipline

- `npx tsc --noEmit` — clean.
- `npm run prebuild` (all 18 gates) — clean.
- `npx vitest run lib/audit/_cross_surface_contract.test.ts` — 8/8, 19 contracts,
  214 live readings.
- Commits: `b56e795e` (the suite) and the falsification-record commit on
  `stage5/cross-surface`. **Not merged to main.**
- **Disclosure:** nothing used `--no-verify`. The pre-push watch gate failed once
  with `Invalid config file "Secrets.xcconfig"` — that file is gitignored
  (`.gitignore:43`) and simply absent from this worktree. Rather than override, I
  copied it in from the parent checkout; `git check-ignore` confirms it stays out
  of git, and the gate then passed (`watch OK · 195 test cases; 20 boards`). The
  gate's own `xcodegen` run modified `native-v2/Faff.xcodeproj/project.pbxproj`
  as a side effect; that was reverted and the working tree is clean.
- Production was read-only throughout. `current_user` is asserted to be
  `faff_readonly` before the first read in every test that touches the database.

### The exFAT AppleDouble hazard

This suite does no `find` and no file-count liveness assertion, so the
`._*`-sidecar trap that broke main on 2026-08-30 cannot bite it. That is worth
saying explicitly rather than leaving as an absence: **if this file ever grows a
source scan, its liveness floor must be set from a count taken with
`! -name '._*'`,** because a local count on this volume is roughly double what a
clean CI checkout sees.
