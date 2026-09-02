# Phase 2 · execution grading truth

Branch `p0/grading`, pushed to `origin/p0/grading`, based on `origin/main`
`7cac80f0`. Five commits. Not merged, nothing pushed to `main`.

```
6c9f8dcc feat(grading): one execution-semantics owner — tolerance, pace shape, verdicts
4deb2a30 feat(watch): grade the segment average, and let a phase say what its target means
7ca28a94 fix(grading): one fitness for grader and prescription, one completion ladder, one HR cap
f375e4f8 fix(recap): the recap reads the reps, not the mile splits, and not the whole run
d1ece9ca test(watch): the 2026-09-01 wire payload, composed against production
```

---

## 1 · The 2026-09-01 run, before and after, through every consumer

Owner `0645f40c-951d-4ccc-b86e-9979cd26c795`, canonical `runs` row
`-258355938987883`, plan row `4×1 mi @ T pace · 1 min jog`, target 430 s/mi,
LTHR 168. Replayed live against production (read-only) by
`web-v2/lib/training/_zz_replay_20260901.test.ts`; full report at
`scratchpad/p0/replay.md`.

**The stored row carries neither `tolerancePaceSPerMi` nor `paceShape`** — it
predates both — so every "after" number below is the LEGACY-payload path,
which is what every already-deployed watch sends.

### Per phase

| # | phase | target | actual | avgHr | BEFORE (stored watch verdict) | AFTER (wrist grader) | AFTER (run detail `status`) | AFTER (word the runner reads) |
|---|---|---|---|---|---|---|---|---|
| 0 | Warm-up 2.10 mi | 502 | 516 | 140 | hit | **hit** | on (was `slow`) | Under the ceiling |
| 1 | Interval 1 mi | 430 | 422 | 158 | **drifted** | **hit** | on | On target |
| 2 | Jog 1 min (61 s) | — | 515 | 158 | — | **not graded** | — | (nothing said) |
| 3 | Interval 1 mi | 430 | 429 | 161 | **drifted** | **hit** | on | On target |
| 4 | Jog 1 min (64 s) | — | 785 | 156 | — | **not graded** | — | (nothing said) |
| 5 | Interval 1 mi | 430 | 422 | 164 | **drifted** | **hit** | on | On target |
| 6 | Jog 1 min (64 s) | — | 1034 | 157 | — | **not graded** | — | (nothing said) |
| 7 | Interval 1 mi | 430 | 419 | 166 | **missed** | **fast** | fast | Quicker than target |
| 8 | Cool-down 2.11 mi | 502 | 534 | 153 | **missed** | **hit** | on (was `slow`) | Under the ceiling |

Nothing calls it missed, drifted or slow. The last rep is `fast` and SAYS
`fast` — the runner ran three seconds a mile quicker than the fast edge, on
the rep the watch's own cue had told him to run at the pace of the first, and
the old word for that was `missed`.

### Per consumer

| Consumer | BEFORE | AFTER |
|---|---|---|
| Activity Interpreter `classifyStoredActivity` | admissible, `threshold_like`, executionQuality `controlled` | unchanged — it was already right |
| Evidence Engine segment classification | segment 2 = `threshold_like`, HR zone 4, confidence 0.944 | unchanged |
| Wrist grader (replayed on the 9 real phases) | drifted / drifted / drifted / missed; cool-down missed | `hit / hit / hit / fast`; session **`executed`**, `recoveriesHonest: true`, `lateCollapse: false` |
| Run Detail `mapWatchPhases` | `status` graded at ±10 while the row shipped `tolerance_pace_sec: 8`; warm-up and cool-down `slow` | `status` and `tolerance_pace_sec` from one owner; warm-up/cool-down `on`; new `pace_shape` + `status_label` on the wire |
| `reconstruct` / `interpretExecution` | `AS_PLANNED`, established pace **400** (`t − 30` … here `t` itself for threshold, so 430 → the retired offsets bit other domains harder) | `AS_PLANNED`, stimulusCompletion 1, earnsProgression true, established pace **420** — the prescribed threshold anchor, not an offset |
| Today after-run | `Heart rate, across the work` was silently null (field-name mismatch); no ceiling/window distinction | `Heart rate, across the work 162 bpm`; per-piece rows carry the four reps and both easy legs with no failure language |
| `deriveRecap` | *"Work pace averaged 7:24/mi · 14s/mi off the 7:10/mi"* — a 444 s/mi mean invented from mile splits that contain the jogs; and, with an LTHR fed, *"with the heart rate still in the band"* asserted without checking | *"Tempo done · 4 mi @ 7:03 · avg HR 162 across the 4 reps. Ran 7s/mi under the target with the effort sitting just under the threshold seam · that pace cost less than the model expected. Worth a retest before it counts as a new number. consistent."* |
| `composeTrainingInfluence` | tolerance 12 (a fifth width) | tolerance 8 from the owner; verdict `on_track`, *"Threshold pace hit. Race-pace work compounding."* |
| Targets test point `judgeTestPointExecution` | ±10, basis `work-phase-watch` | ±8 from the owner; verdict **`on`**, basis `work-phase-watch` |
| Adaptation input `loadKeySessionExecutions` | `establishedPaceSPerMi` recomputed downstream from a possibly-different vdot | carried on the row; `earnsProgression: true` |

`workVerdicts` on the interpreted row still reads
`drifted / drifted / drifted / missed` — correctly. Those are the words the
watch WROTE on 2026-09-01 and they are a stored fact; the server accepts them
as legacy values and no build emits them any more.

---

## 2 · The tolerance-owner proof

### Before — five widths, and two classifications

| where | width | site |
|---|---|---|
| phone card + watch band shown | ±8 | `today/route.ts:1515`, `spec-card.ts:382`, `build-workout.ts:1712` |
| evidence / adaptation pipeline | ±10 (±40 long) | `goal-projection.ts:1161` |
| blended-overall basis | ±15 | `goal-projection.ts:1246` |
| run-detail phase colouring | ±10, while shipping `tolerance_pace_sec: 8` | `run-state.ts:1564`, `:1584` |
| "on track / slipping" copy | ±12 (±18 long) | `training-influence.ts:103` |

and the phone classified on `strictPrescriptionType` while the wrist
classified on `workout_spec.kind`, so a **tempo** row printed ±20 on the phone
and was graded at ±8 on the wrist. 21 live plan rows.

### After

`web-v2/lib/training/execution-semantics.ts` owns: `classifySession` (moved
from `build-workout.ts`, re-exported there), `sessionToleranceSec`,
`EASY_PHASE_TOLERANCE_S_PER_MI`, `paceShapeFor`, `phaseToleranceSec`,
`gradeWorkPhase` / `gradeCeilingPhase` / `gradePhase`, `gradeSession`,
`phaseVerdictLabel`, the wire verdict vocabulary, `COMPLETION_LADDER`, and
`HR_CAP_GRACE_BPM`.

Doctrine: `Research/01-pace-zones-vdot.md` §"Pace zone width and lock-in
rules". The E row's ±30 is taken verbatim for every non-quality session; the
quality widths (8/12) are WIDER than the doc's ±3 and the module header argues
why (±3 is a track split; this grades a GPS segment average against a
0.727-confidence anchor, and Brief 03 forbids manufacturing precision). What is
gated is the ORDERING, read out of the doc at run time.

`EXECSEM-1` scans all six consumers for the owner import and for tolerance
literals. Two race-day literals in `build-workout.ts` carry argued exemptions
(race pacing is a separate owner, Constitution §J, and the coordinator owns
that branch) plus a test that fails the moment they stop agreeing with
`sessionToleranceSec('race')`. One more exemption covers `parsePaceTarget`'s
`(hi - lo) / 2`, which is a range PARSE and not a width.

---

## 3 · Gate falsifications (Rule 18)

Every new gate was broken on purpose and watched to fail, then restored.

| Gate | Falsification | Result |
|---|---|---|
| EXECSEM-1 literals | restored `const tolerance = input.type === 'long' ? 18 : 12` in `training-influence.ts` | **FAIL** · "a tolerance literal outside …" |
| EXECSEM-1 literals (v1) | the SAME edit against the first version of the scanner | **PASSED** — the digit did not sit immediately after the `=`. The scanner was rewritten to take the whole right-hand side, and this is recorded in its header. |
| EXECSEM-1 import | deleted the owner import from `today/route.ts` and put `8` back | **FAIL** · "these grade a pace but do not call the owner" |
| EXECSEM-1 ratchet | planted a stale exemption (`toleranceGone: 99`) | **FAIL** · "these exemptions no longer match anything — delete them" |
| EXECSEM-2 doctrine ordering | set `threshold: 25` in the owner's table | **FAIL** · `expected 25 to be less than 12`, plus two more |
| EXECSEM-5b ceiling arm | reverted `WorkoutEngine.swift`'s ceiling arm to a two-sided band | **FAIL** · "a ceiling phase has no slow edge" |
| EXECSEM-5b sample share | reintroduced `pctInBand >= 0.7` into `WorkoutEngine.swift` | **FAIL** · "the sample-share verdict is gone" |

Both new gates also carry a Rule 22 "what this cannot fail on" section and a
liveness assertion (EXECSEM-5's matrix asserts it compared > 1500 cases; the
scanner asserts each consumer file is > 500 bytes).

---

## 4 · What changed, by audit finding

| Finding | Fix |
|---|---|
| **E Finding 2** · flawless session graded a failure | the whole of commits 1, 2 and 4 |
| **F-1** · tempo ±8 vs ±20, 21 live rows | one `classifySession`, one `sessionToleranceSec`; the false parity comment in `spec-card.ts:164-179` corrected to a structural claim the gate enforces |
| **F-5** · `establishedPaceFor` off the raw VDOT cascade, 11-46 s/mi slower, always the same direction | reads `PrescribedPaceAnchors` — the plan's own six numbers — resolved once in `loadKeySessionExecutions` and carried on the row |
| **F-6** · six hand-copied `currentVdot` readers | `resolveCurrentVdotSnapshot` with a total ORDER BY (Rule 14), a 14-day staleness bound, and a typed three-state refusal. `EMPTIED_BASELINE` 374 → 371. `result-chain.ts` and `simulator.ts` are NOT folded in: they filter by `distance_mi` and answer a different question — the audit's "six" is really four. |
| **F-12** | not in scope this phase; noted below |
| **F-13** | not in scope this phase; noted below |
| **F-14** · four completion answers, 0-vs-+5 HR grace | `COMPLETION_LADDER` (all three lines on one scale, each citation kept, and the missing sentence added: "not missed" and "full stimulus" are different lines and 62.5% is correctly both); `HR_CAP_GRACE_BPM` derived from `aerobicCeilingBpm`'s own `ceil(x) − 1`, applied at all four sites |
| **F-16** | not in scope this phase |
| **D 2d** · no settle window | the grader now uses the segment AVERAGE, which absorbs both the runner's acceleration and the instrument's settling by construction. `REP_SETTLE_ALLOWANCE_SEC` is exported and documented for the sample-level consumers. |
| **D C-1** · bail worded for HR, triggered by pace | `shouldOfferBailNow` evaluates the rule's own `metric`/`op`/`value` against `tracker.heartRate`, sustained 120 s (Research/03 §2). Pace rules keep two-miles-adrift. |
| **D C-1 (race)** · `abort` rules inert | an abort now draws a board when no bail exists, gated on its own metric and `mile-N` scope. `recordBail` takes its kind and label off the rule instead of hardcoding "bail" / "Bail line". |
| **D C-3** · `threshold-band.ts` fed a non-threshold anchor | `RecapInput.lthrBpm` is its own field; `drift-monitor.ts` COALESCEs `hr_target_bpm, lthr_bpm` (it read `hr_target_bpm` alone, which spec-builder only authors on tempo rows, so the discriminator was dark on every threshold and interval row) |
| **D C-6** · "heart rate still in the band" asserted without checking | four arms, `ranBelowThresholdBand` imported, and the band read off the WORK heart rate |
| **D C-12** · HRAlerter | fires at the ceiling not 0.95×; bounded to running workouts; sustained 60 s; copy states the two numbers it has |

### Found in this phase, not in the audit

1. **`tempoExecution` averaged the wrong partition.** It identified work
   splits by pace proximity and recomputed a mean from MILE splits. A mile
   split containing a 61-second jog is not a rep. On this session the reps
   averaged 423 and the heuristic read 444, so the recap said "14s/mi off the
   target" on a set that was 7 s/mi faster than asked. `repPaces` is rung 1
   now; the heuristic is the fallback for runs with no phases.
2. **The threshold-band sentences were gated on the whole-run heart rate.**
   154 across 8.5 miles versus 162 across the four reps — 91.7% versus 96.4%
   of LTHR, opposite sides of the zone-4 floor. Both routes now supply
   `readings` from `deriveReadingScopes`, which already owned that question
   and already refuses below the HR kinetics floor.
3. **There are two lines under the threshold seam and they meant one thing.**
   `Research/03` §6 puts Friel Z4 at 95-99% ("SubThreshold · just below LT")
   and Z5a at 100-102% ("At LT · cruise intervals"). A mile rep with a 60-second
   jog lives in Z4 — HR sawtooths across the recoveries — so `ranBelowThresholdBand`
   alone called a correctly executed cruise set "never reached the intensity".
   `ranInSubThresholdBand` splits them and the two get opposite sentences.
4. **`composeTrainingInfluence` was inert until this phase's grep.** It IS
   wired (`components/faff-app/seed.ts:1179`), but only into the WEB seed,
   which CLAUDE.md pauses. It has never reached the phone. Rule 21's signature
   failure, unfixed here because the fix is a phone surface, not a grading one.

---

## 5 · Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` (full, RO env) | **7956 passed, 64 skipped, 373 files** |
| All 17 prebuild gates (`npm run prebuild`) | **exit 0** — palette, spacing, modelled-mark, coach-voice, doctrine (323 citations), wire-keys (106+95+50 keys), generated-content, surface-sweep, xcodeproj-sync (214 files), swallowed-failure (baseline 371), derived-consistency, automatic-mutations, normal-window, goal-immutability, anchor-derivation, client-graph, coercion (peripheral baseline 181) |
| `npx next build` | **exit 0** (Rule 19's last step) |
| `scripts/check-watch.sh` | **OK · 195 test cases, 20 boards** |
| `xcodebuild -scheme Faff` (iOS 26.5 sim) | **BUILD SUCCEEDED**, signed and unsigned |
| `xcodebuild -scheme "FaffWatch Watch App"` (watchOS 26.5 sim) | **BUILD SUCCEEDED** |
| Push | `git push -u origin p0/grading` clean, pre-push hook ran the watch gate and passed. No `--no-verify` was needed. |

The first `check-watch.sh` run reported `Executed 0 tests` and FAILED. That was
a derived-data collision with the phone/watch `xcodebuild` invocations I was
running concurrently — the script's own header warns about exactly that. Two
subsequent clean runs both report 195 test cases. Recorded because the gate
correctly refused to read `** TEST SUCCEEDED ** / Executed 0 tests` as a pass.

### Ratchets re-tightened

- `EMPTIED_BASELINE` 374 → **371**, with the reason written into the registry:
  three of the four `currentVdot` copies wrapped their query in
  `.catch(() => ({ rows: [] }))`.
- `PERIPHERAL_BASELINE` stays at 181. Two collapses I introduced were removed
  rather than allowlisted (a `.catch(() => null)` on `runnerToday` became a
  try/catch returning `READ_FAILED`; a second `resolveThresholdHr` read became
  `glance.lthr`, which is the number the card's own bands already use).

---

## 6 · Renders (Rule 13)

`scratchpad/p0/shots/`

| File | What it shows |
|---|---|
| `phone-afterrun-top.png` | Today after-run, 2026-09-01, **against this branch** — `Heart rate, across the work 162 bpm`, `Pace, across the work 7:02` |
| `phone-afterrun-piecebypiece.png` | PIECE BY PIECE — Warm Up 8:36, Intervals 7:00 / 7:07 / 7:03 / 6:58, Recoveries, Cool Down 8:53, no failure language on any row |
| `watch-lobby-p1.png` | the watch lobby — **NOT this branch**, see below |

**How the phone render was done, and the caveat.** The app's `baseURL` is
`https://www.faff.run`, so a stock build renders the DEPLOYED server, not this
branch. To render this branch I temporarily pointed `API.swift` at
`http://localhost:3111`, added an ATS exception to `Info.plist`, ran
`next start` from this worktree against the read-only production database,
rebuilt SIGNED (an unsigned build cannot read the Keychain token — see the
`unsigned sim build breaks Keychain auth` memory), and confirmed the built
dylib carries `http://localhost:3111` and no longer carries `www.faff.run`.
**Both temporary edits have been reverted and `git status` on `native-v2` is
clean.**

**The watch lobby could NOT be rendered against this branch.** The watch
simulator receives its workout over WatchConnectivity from a paired phone;
unpaired, it renders whatever payload it last cached — here a `5×7 · 6.40 mi ·
6:21-6:41 /mi` from an earlier session, which is not today's workout and does
not come from my server. Per the brief, the payload is shown instead:
`scratchpad/p0/watch-payload.md`, produced by
`lib/watch/_zz_watch_payload_20260901.test.ts` running `buildWatchToday`
against production read-only.

```
| # | type      | label           | unit     | target | tol | paceShape | hrTargetBpm |
| 0 | warmup    | Warm-up         | 2.1 mi   | 502    |  30 | ceiling   | —           |
| 1 | work      | Interval · 1 mi | 1 mi     | 430    |   8 | window    | 168         |
| 2 | recovery  | Jog 1 min       | 60 s     | —      |   — | none      | —           |
| 3 | work      | Interval · 1 mi | 1 mi     | 430    |   8 | window    | 168         |
| 4 | recovery  | Jog 1 min       | 60 s     | —      |   — | none      | —           |
| 5 | work      | Interval · 1 mi | 1 mi     | 430    |   8 | window    | 168         |
| 6 | recovery  | Jog 1 min       | 60 s     | —      |   — | none      | —           |
| 7 | work      | Interval · 1 mi | 1 mi     | 430    |   8 | window    | 168         |
| 8 | cooldown  | Cool-down       | 2.1 mi   | 502    |  30 | ceiling   | —           |
```

`hrCeilingBpm` is null on a threshold session, so the lobby's heart row has
nothing to draw for this workout — which is why the "watch lobby heart row"
the brief asks for does not exist on this session even in principle.

---

## 7 · What is NOT verified, and what I did not touch

**Unverified.**

1. **The wrist's compiled behaviour.** `_watch_grader_parity.test.ts` ports the
   Swift verdict rule into TypeScript and asserts it agrees with `gradePhase`
   across 1728 matrix cases plus the real session, AND reads
   `WorkoutEngine.swift` to assert the shape it ports is still there. It does
   not RUN Swift. The 195-case watch test suite passes but does not cover the
   new verdict rule; `PaceDriftTests` still exercise `.window` only, because
   the ceiling parameter defaults to `.window` for source compatibility.
2. **The bail and abort boards.** `noteRuleMetric`, the HR sustain window, the
   `mile-N` scope gate and the abort fallthrough compile and are read by the
   parity gate's source assertions. None has fired on a device. The race abort
   in particular now DRAWS where it previously drew nothing, and that is a
   behaviour change on race day that nobody has seen.
3. **`HRAlerter`.** Still has no `configure(...)` call site, so it remains
   dormant. The three defects are fixed but the fixed code has never executed.
   The workout predicate bounds HR samples to running workouts in the last
   hour, which is the closest HealthKit lets you get to "during a workout"
   without a specific `HKWorkout` — it is not the same thing as sample-level
   workout attribution.
4. **The Today after-run card renders no coach verdict at all** on this build.
   The recap composes one and `/api/v5/today` returns it; `TodayAfterV5`'s
   verdict block did not draw on the screen I captured. I did not chase this —
   it is a phone-surface question, not a grading one — but the improved recap
   sentence is therefore engine-verified and NOT screen-verified.
5. **Rule 17 on the recap.** The output reads `Tempo done.` followed by
   `Tempo done · 4 mi @ 7:03 · …` — the verdict and the first fact repeat the
   phrase, on one screen. Pre-existing, not introduced here, and left alone.
6. **Deployment.** Rule 19: nothing was pushed to `main` and no Railway deploy
   was triggered or confirmed. `next build` passing is evidence about the
   build, not about production.

**Deliberately not touched** (coordinator-owned): `lib/race/*`,
`lib/training/race-projection.ts`, `goal-projection.ts`'s race logic,
`recompute-paces.ts` exemptions, `spec-builder.ts`'s race branch, and
`build-workout.ts`'s race-day section (lines ~2080-2250 — the two race
tolerance literals there are exempted in the gate with an argued reason and a
test that fails if they diverge from the table).

**Left open from the audit,** in scope for a later phase, not this one:

- **F-12** · three definitions of the easy/long HR ceiling; the phone's reads
  `computeZones({lthr}).z2.upper` and never looks at the spec.
- **F-13** · three unordered pickers for "today's plan row"; only the watch
  orders correctly.
- **F-16** · the pace band printed twice on Today by two formatters that can
  drift.
- **C-5** · the `pass` rule is authored where a VO2 session cannot meet it and
  is read by nothing that matters. Still true. It reaches no card, no watch
  board and no recap; `goal-projection.ts:881` is its only reader.
- **C-7** · four ceilings for one threshold band.
- **`fmtPaceCeiling` prints `≤ 8:22 /mi`** for a ceiling whose meaning is "do
  not run FASTER than 8:22". The `≤` reads as a time bound and therefore as
  the opposite instruction. Left alone because changing it moves locked card
  copy and `_spec_card.test.ts`, but it is a real ambiguity on the screen and
  the grading fix does not remove it.
- **`composeTrainingInfluence` reaches only the paused web surface.** Wired,
  tested, and invisible to the phone.
