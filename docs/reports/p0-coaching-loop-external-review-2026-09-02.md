# faff.run · P0 coaching loop · complete handback for external review · 2026-09-02

**Recommendation: `NOT READY — IMPLEMENTATION INCOMPLETE`** (three PARTIAL acceptance areas, named in Part 1 §1 and §15).

This is one self-contained document. Everything an independent reviewer needs to issue `KEEP AND CONTINUE` or `STOP AND REBUILD` is inlined below: the scorecard and provenance (Part 1), the four phase reports written by the agents that did the work (Part 2), the day-by-day threshold replays before and after (Part 3), the 4 × 1-mile replay through every consumer (Part 4), the falsification logs of every new gate (Part 5), the live production change ledger (Part 6), the race-consistency, goal-isolation and parity artifacts (Part 7), the full commit list with files (Part 8), the final test-suite report (Part 9), and the independent audit this push answered (Part 10). Paths are relative to the repository root; every artifact is committed under `docs/reports/p0-coaching-loop-completion-handback-2026-09-01/` and reproducible from `web-v2/scripts/p0-proof/` against the read-only production role.

## How to read this

- **What was asked.** The independent audit of 2026-09-01 (Part 10) found five P0 defects in the coaching brain: the race row frozen at its authoring pace while every rehearsal moved; the watch grading tempo at ±8 s/mi while the phone printed ±20; the watch grading ceilings as bands and reps on instantaneous samples (the owner's near-perfect 4 × 1 mile scored drifted × 3 + missed); a coaching reader grading against an archived plan; and the threshold pace corpus acting as a second evidence engine (the anchor moved 430 → 420 s/mi off one session). The execution directive that followed ordered eight phases: trustworthy gates, one threshold evidence contract, execution grading truth, one race-pace brain, canonical initial authoring and cold start, a truthful Coaching Thesis, correction of the owner's live plan through the normal path, acceptance scenarios, and deletion of parallel truths.
- **What is on `main` and deployed.** Six pushes, first-parent `63d47b5d` → `331e6bab` → `0bb6ac8c` → `f967cab1` → `3c2d1eaa` → `16010927` (→ `7f6da4c8`, docs). Railway deployment `708a200b` (`f967cab1`) is the commit every production number in Part 1 was taken against; `9613910b` (`16010927`) is the commit the second live refresh ran against.
- **Who did what.** Phases 0, 2, 4 and 5 were executed by four isolated agents on their own branches (reports in Part 2, quoted verbatim); Phases 1, 3, 6, 7 and 8 and the integration were done by the coordinating session. Each agent's claims were re-run in the merged suite; their own falsification evidence is in their reports and was not re-falsified by the coordinator, which Part 1 §2 discloses.
- **The owner.** All production evidence is the account of the app's owner (user `0645f40c-951d-4ccc-b86e-9979cd26c795`), a marathoner with CIM on 2026-12-06 and a stated 3:00:00 goal.

---

# Part 1 · The completion handback (scorecard, provenance, ownership, artifacts, runner-readable output)



**Recommendation: `NOT READY — IMPLEMENTATION INCOMPLETE`**

Three of the fourteen acceptance areas are PARTIAL (phone/watch prescription consistency, HR semantic consistency, full automated verification), and the rule for this report is that a partial area is stated at the top and the push is not called complete. Everything else below is verified against the deployed commit and, where it touches the runner, against production data. The blockers are exact and short (§15), and none of them is a coaching number: the watch's compiled behaviour is defended by a source-bound TypeScript port rather than by running Swift; the watch decodes the race-day HR guidance but does not yet draw it; and the last two pushes to `main` were verified locally but the CI run for the final commit was still in progress when this report was written.

Every artifact cited here is committed under `docs/reports/p0-coaching-loop-completion-handback-2026-09-01/` and reproducible from `web-v2/scripts/p0-proof/` against the read-only production role.

---

## 1 · Executive pass/fail scorecard

| Acceptance area | PASS / FAIL / PARTIAL | Direct evidence | Remaining contradiction |
|---|---|---|---|
| Threshold evidence integrity | PASS | `threshold-replay-after-f967cab1.{json,log}` vs `threshold-replay-before-7cac80f0.{json,log}` (§4); `_threshold_evidence_contract.test.ts` 21 tests; `falsification/threshold-admission-ee-no-evidence.log`, `one-session-move-cap.log`, `staleness-lowers-support-not-level.log` | June still shows the pre-existing relaxed-bar flips (456↔430 on 06-04/06-09/06-17) when only one or two corroborating sessions exist; they are the "stronger tension relaxes K" rule, unchanged by this pass and disclosed in §4 |
| 4 × 1-mile execution grading | PASS | `four-by-one-mile-replay-f967cab1.md` (re-run against the deployed tree, `four-by-one-mile-replay-run-f967cab1.log`): hit / hit / hit / fast, jogs not graded, warm-up and cool-down "Under the ceiling"; Today after-run rendered on the deployed build (§5) | The watch lobby could not be rendered (unpaired simulator shows a cached payload); its wire payload is in `agent-reports/phase-grading.md` §watch-payload |
| Phone/Watch prescription consistency | PARTIAL | `lib/training/execution-semantics.ts` is the one tolerance/shape/verdict owner; `paceShape` rides the wire; `agent-reports/phase-grading.md` §2-§4 | The wrist's COMPILED grading is covered by a source-bound TS port of the Swift grader, not by executing Swift; the bail/abort boards compile but have never fired on a device |
| Initial authoring/recompute parity | PASS | `authoring-recompute-parity-live-plan-stamped-anchors-3c2d1eaa.json`: 77 rows replayed at the plan's last-priced anchors, 0 changed, max Δ 0 s/mi, 0 HR changes, 0 band changes (§6) | At TODAY's anchors 5 interval rows move −6 s/mi because the 2026-09-01 session raised the measured-VDOT candidate the high-intensity fallback reads (new evidence, not a second brain) — `authoring-recompute-parity-live-plan-3c2d1eaa.json` |
| Cold-start prescription safety | PASS | `lib/training/_cold_start_fixtures.test.ts` (10 golden runners print their prescribed paces, in the suite); `lib/training/self-reported-pr.ts` typed-PR rung; continuity walks replacing the `real > 0` cliff (`agent-reports/phase-authoring.md` §A) | Not rendered on a device for a cold-start account; verified by the fixture suite and the DB-backed corpus (`authoring-recompute-parity-audit-f967cab1.log`, four other real accounts) |
| Goal isolation | PASS | `race-consistency-after-refresh-f967cab1.json#goalIsolation` (§7): stated 3:00 / soft 3:30 / extreme 2:30 / none → identical capacity, confidence, evidence ids, current projection, training pace, expected gain, expected race day, range; only execution target and feasibility move | — |
| CIM training-to-race coherence | PASS | §8: bridge with value, evidence, confidence and change trigger at every step; race row 7:31/mi (3:17:00) = `outlook.execution`, MP rows 7:55/mi = `outlook.trainingPrescription`; the race-week tune-up row now 7:31/mi from the same refresh (run 33581160907, `live-plan-ledger/p6-race-rows-after2.txt`) | — |
| Santa Monica race consistency | PASS | §9: row 429 s/mi = execution 44:20 = coach-set B; A/C = the range edges; "Projected" 44:18 is the expected race day (a distinctly named quantity from the rounded execution target) | — |
| Race projection cross-consumer consistency | PASS | §9: Races list (rendered on the new build against the deployed server, `renders/phone-races-list-f967cab1.png`: 3:23:14 / +23:14), race detail, goal-gap, gap-report, next-A projection, goal-outlook note, notification source all read 12194 s from one object; `_race_projection.test.ts` forbids any other path | The race DETAIL screen with the new "How the number is built" section compiled (BUILD SUCCEEDED) but could not be rendered through the simulator automation: the schedule row highlights on tap and does not push the detail (four attempts, tap and touch-path). Its payload is proven by `scripts/p0-proof/race-consistency.ts` (the same library resolvers the route calls); the section is unverified on screen |
| HR semantic consistency | PARTIAL | §10: race rows carry `race_hr` (expected range / early ceiling / late allowance / checkpoint abort / informational flag) and no `hr_cap_bpm`; grader grace, easy ceiling, race bands all named with owners; `falsification/hr-informational-without-evidence.log` | The watch decodes `raceHr` (additive) but does not yet draw the expected range on the race face; the phone-side `HRAlerter` easy-run alarm has never fired for anyone (Phase 2 fixed its threshold copy, not its wiring) |
| Live-plan correction | PASS | §11 `live-plan-ledger/`: 4 race rows updated by `refreshRaceRowsForPlan` via the dispatched `snapshot-projections` run 33579154765 on deployed `f967cab1`; stamp `authored_state.race_row_refresh` records each row; 0 refused | — |
| Sealed-history immutability | PASS | `live-plan-ledger/p6-sealed-checksum-{before,after}.txt`: 7 sealed rows, md5 `1f9bc33de7f4cbb10c6807304305e1af` identical; goals identical (`p6-goals-{before,after}.txt`) | — |
| Regression-gate effectiveness | PASS | §12: 13 invariants broken on purpose with the failing output recorded (`falsification/*.log`), all restored green; the four phase agents' gates falsified in their reports | — |
| Full automated verification | PARTIAL | §13: tsc clean · prebuild 17/17 · `next build` exit 0 · Xcode `Faff` scheme BUILD SUCCEEDED twice (iphonesimulator + watchsimulator, incl. the watch decode) · full Vitest 8126 passed / 10 skipped / 0 failed on the final tree · CI `test-full` green on `331e6bab`, `3c2d1eaa`, `16010927` · Railway `9613910b` SUCCESS for `16010927` | `build-check` for `16010927` was still in progress when this report was finalised; the report itself is the only content that commit adds beyond the tune-up refresh and the watch decode, both verified locally |

---

## 2 · Exact implementation provenance

**Starting `origin/main`:** `7cac80f0` (the audit base). `main` moved to `a5367a38` (a TestFlight build-counter chore: docs + `project.pbxproj`) before the first integration push; every branch below was based on `7cac80f0` or `a5367a38`, and the integration line was built on `a5367a38`.

**Ending SHA on `main`:** `3c2d1eaa` at the time of writing, plus the follow-up commit that carries this report (see the tail of this section).

**Branches used**

| Branch | Base | Commits | Pushed | Verified with |
|---|---|---|---|---|
| `audit/independent-coaching-system-2026-09-01` | `7cac80f0` | 1 (`03052e6f`) | yes, not merged | `verify-commit.sh` CLEAN; `--no-verify` (hook needs `node_modules` + `Secrets.xcconfig` in a fresh worktree) |
| `p0/gates` (Phase 0) | `7cac80f0` | 10 | yes, full pre-push hook | agent report `agent-reports/phase-gates.md` |
| `feat/race-pace-brain` (Phases 1 + 3) | `7cac80f0` | 1 (`eda6cfc4`, 52 files, +2595/−1037) | yes, `--no-verify`, `verify-commit.sh` CLEAN | this report |
| `p0/grading` (Phase 2) | `7cac80f0` | 5 | yes | `agent-reports/phase-grading.md` |
| `p0/authoring` (Phase 4) | `7cac80f0` + merge of `origin/main` | 10 incl. 2 merges | yes, `--no-verify` (watch gate needs `Secrets.xcconfig`), `verify-commit.sh` CLEAN | `agent-reports/phase-authoring.md` |
| `p0/thesis` (Phase 5) | `7cac80f0` | 3 | yes | `agent-reports/phase-thesis.md` |
| `integrate/p0-2026-09-01` | `a5367a38` | the merges below | yes, fast-forwarded to `main` | this report |

**Merge order on `main` (first-parent), with the CI run and the Railway deployment of each push**

| Push | SHA | What | GitHub Actions (push event) | Railway |
|---|---|---|---|---|
| 1 | `63d47b5d` | merge `p0/gates` + `feat/race-pace-brain` (58 files, +3724/−1094) | build-check 33576063117 ✓ · Plan engine bench 33576063218 ✓ · test-full 33576063066 ✗ · Surface sweep 33576063064 ✗ (three run-shape/format lint findings in the brain's own files) | `3d51850d` SUCCESS then replaced |
| 2 | `331e6bab` | `81e165a3` merge `p0/grading` + `331e6bab` lint fix (3 files) | build-check 33577034775 ✓ · bench 33577034640 ✓ · test-full 33577034584 ✓ · Surface sweep 33577034629 ✓ | `57205cc0` SUCCESS then replaced |
| 3 | `0bb6ac8c` | merge `p0/authoring` (39 files, +6110/−862) incl. the race-row refresh seam, a Rule 12 floor fix, a coach-voice fix | build-check 33578144481 ✓ · bench 33578144484 ✓ · test-full 33578144574 ✗ (the authoring shadow-compare audit refuses to skip without `DATABASE_URL_RO`; fixed in push 5) | `eae272fc` SUCCESS then replaced (its "CRASHED" status is the SIGTERM of replacement, log in §13) |
| 4 | `f967cab1` | merge `p0/thesis` (16 files, +1556/−309) | build-check 33578779165 ✓ · bench 33578779143 ✓ · Surface sweep 33578779104 ✓ · test-full 33578779115 ✗ (same audit liveness) | `708a200b` **SUCCESS — the deployed commit every production number in this report was taken against** |
| 5 | `3c2d1eaa` | proof package, phone outlook section, staleness + race-row gates, CI acknowledgement of the credential-free audit skip (24 files) | test-full ✓ · build-check ✓ | `13419364` SUCCESS then replaced |
| 6 | `16010927` | this report, tune-up rows under the race-row refresh, watch `raceHr` decode, parity script | test-full ✓ · build-check in progress when this line was written | `9613910b` **SUCCESS** (2026-09-02T01:53Z) — the second refresh below ran against it |

The deployed SHA matches the verification code: `railway deployment list` reports `708a200b` = `f967cab1` SUCCESS; the replay, the consistency artifacts and the live-plan ledger were produced from a worktree at `f967cab1`/`3c2d1eaa` (identical `web-v2/lib` for everything read here, since `3c2d1eaa` adds tests, scripts, native code and one CI env var) against the read-only production role; the race-row refresh that changed production rows ran INSIDE production (workflow_dispatch of `snapshot-projections.yml`, run 33579154765, `completed success`, against `708a200b`) and stamped `authored_state.race_row_refresh.at = 2026-09-02T01:23:04.412Z`.

**Every commit (topological, 38 since `7cac80f0`, 30 non-merge)** — `git log --oneline 7cac80f0..3c2d1eaa`; per-commit file lists are `git show --stat <sha>`. The non-merge commits and their subject lines are listed in `git log --no-merges 7cac80f0..3c2d1eaa`, reproduced in the agent reports per phase; the integration-line commits are the five rows above plus `429bceb2` (gates merge) and `81e165a3` (grading merge).

**Migrations applied:** none. No DDL in any phase. **Production recomputation invoked:** two dispatches of the normal canonical path (`reanchorActivePlan` → `refreshRaceRowsForPlan` → convergence alert), not a special-case script — `gh workflow run snapshot-projections.yml --ref main` at 2026-09-02T01:22:56Z (run 33579154765, against `708a200b`/`f967cab1`, four race rows) and at 01:53:57Z (run 33581160907, against `9613910b`/`16010927`, the tune-up row; the four race rows reported `unchanged`). **`--no-verify` use:** every push from this session's worktrees (the pre-push hook needs a `node_modules` symlink and the gitignored `Secrets.xcconfig`); each pushed commit was verified with `scripts/verify-commit.sh <sha>` = CLEAN (`e5954b3a`→`eda6cfc4`, `63d47b5d`, `331e6bab`, `0bb6ac8c`, `f967cab1`, `3c2d1eaa`). **Not independently verified:** the four phase agents' own falsification claims were read from their reports and their gates re-run in the merged suite, not re-falsified by me; the watch's on-device behaviour (§1); the cold-start accounts on a device.

---

## 3 · Before/after ownership graph

| Question | Previous owner(s) | Previous duplicates | Final canonical owner | Declared fallback | Live consumers | Deleted paths | Enforcement |
|---|---|---|---|---|---|---|---|
| Threshold evidence | `pace-corpus.ts` label-based reader (its own admission, HR-split pooling of long runs) | Evidence Engine `activity-evidence.ts` classified the same activities separately | `classifyThresholdCandidatesDetailed` consuming Evidence Engine verdicts + watch phases; level by `thresholdCorpusFromInputs` (weighted K-th best, daily move cap, staleness on support only) | typed refusal `ThresholdPaceRead.ok=false` with `excluded[]` reasons | `resolveThresholdCapacity` → anchors, outlook, thesis, grader | label-only admission of non-quality labels; long-run HR-split pooling; direction-blind relaxation (`reexamination` weaker) | `_threshold_evidence_contract.test.ts` (21), registry `CONVENTION.threshold-evidence-authority-model`, falsification ×3 |
| Threshold capacity | `resolveThresholdCapacity` | snapshot VDOT (`loadLatestVdotWithAnchor`) fed every projection consumer as a second fitness read | `resolveThresholdCapacity` (unchanged owner) feeding `resolvePrescribedPaceAnchors` | tiers: direct → race-derived → vdot_fallback → user_prior → population_prior, all `sourceMode`-stamped | anchors, outlook.capacity, grader (Phase 2 F-5), thesis | projection consumers' snapshot reads (race-projection, effective-target, coach-goal-load, goal-gap trajectory) | `_race_projection.test.ts` consumer scan; `GOAL.prescribed-race-pace-ceiling` forbids `projection_snapshots` in effective-race-target |
| Easy ceiling | `resolveEasyCeiling` | `easy-discipline.ts` graded against an ARCHIVED plan's band (F-29); warm-ups graded as two-sided bands | `resolveEasyCeiling`; `paceShapeFor` says ceiling | direct → derived from threshold | anchors, spec-builder easy/long/shakeout, grader | archived-plan read; band-shaped grading of ceilings | ACTIVEPLAN-1 (user-scoped scan), Phase 2 shape gates |
| Durability | `resolveRaceExponent` | `limiter.ts#fitRiegelExponent` (own two-race fit, freshness window, distance floor); coach-goal's earlier own fit | `resolveRaceExponent` (`fitRaceExponent`) | population prior 1.06 with confidence | anchors.marathon, outlook, limiter (raw exponent), coach-goal | `fitRiegelExponent`, `pickCurvePair`, `MIN_CURVE_DISTANCE_RATIO`, `CURVE_FRESHNESS_DAYS` | `LIMITER.curve-shape-neutral-band` (forbids a fit in limiter.ts), `_limiter.test.ts` source scan, falsification |
| Initial pace authoring | legacy VDOT cascade in `generate.ts` (goal→T blends, `min(goalT, currentT)`, goal-gated I-pace) | `resolveCurrentTPace` ×3 copies | `resolvePrescribedPaceAnchors` via `lib/plan/authoring-anchors.ts`, every entry point | typed refusal → "the plan you have stands" | `persistComposedPlan`, five entry points | the whole goal→training-pace class (Phase 4 §B) | `scripts/check-goal-pace-leak.sh` (prebuild), shadow-compare unit + audit tests |
| Pace recomputation | `recomputePacesForPlan` with `race` PERMANENTLY exempt | none for training rows; race rows had NO owner after authoring | `recomputePacesForPlan` (training rows) + `refreshRaceRowsForPlan` (race and tune-up rows) inside the same transaction; cron and authoring call the refresh too | per-row typed refusal in the stamp | snapshot cron, authoring persist | the permanent exemption's effect | `_race_row_refresh_gate.test.ts` (5), falsification ×3 |
| Workout tolerance | five live widths (8/10/15/12/40) across phone, watch, recap | phone `strictPrescriptionType` vs watch `workout_spec.kind` | `lib/training/execution-semantics.ts` (one table, doctrine-cited) | — | phone Today, watch builder, recap, run detail | the five copies | Phase 2 gates (`agent-reports/phase-grading.md` §gates), falsified 7 ways |
| Execution grading | watch per-sample share inside ±8; server reconstruction; recap from mile splits | four completion ladders; grader priced off a second fitness | `execution-semantics.ts` verdicts; watch grades the SEGMENT AVERAGE; `paceShape` ceiling/window/effort/none | legacy payloads without `paceShape` graded by kind | watch, run detail, Today after-run, recap, training influence, Adaptation input | `missed` on a quicker-than-asked rep; mile-split averaging | Phase 2 gates; `_zz_replay_20260901.test.ts` (production replay) |
| Coaching Thesis | `coaching-thesis.ts` ranking normalised by an unrelated anchor's age; zero live callers | — | `rankCapacities` on raw confidence; `UNRANKABLE (NO_DIRECT_READER)` for fallback capacities; wired into Today's "why" and Block | `primaryLimiter: UNKNOWN` | Today route, Block route, phone (2 keys) | the normalised score | `_coaching_thesis.test.ts` (15, Rule 9 walk + falsifier), audit test on both owner dates |
| Race projection | `race-projection.ts` three-rung resolver fed by each consumer's own `computeGoalProjection`/snapshot VDOT | Races list, race detail, goal-gap, goal-outlook, goal-projection-resolve, seed, TargetsView each gathered inputs | `lib/race/race-outlook.ts` → `raceProjectionFromOutlook` (pure mapping) | `basis: null`, `projectedSec: null` | all of the above | `resolveRaceProjection`, every `computeGoalProjection` call in a consumer | `_race_projection.test.ts` (consumer scan, comments stripped), `_goal_immutability` guard 7, falsification |
| Marathon-training pace | `anchors.marathonSecPerMi` (`marathonPaceFromDurability`) — already canonical | authoring's `T + 18` population offset (legacy) | `anchors.marathonSecPerMi`, surfaced as `outlook.trainingPrescription` with `whyThisPace` | Daniels equivalence when no exponent | spec-builder MP/tempo rows (475 s/mi live), outlook, race detail | the `T+18` offset at authoring | shadow compare (race row 0 s/mi, MP rows +26 s/mi legacy→canonical) |
| Expected race-day outlook | `projectFitnessTrajectory` sizing the gain FROM THE GOAL GAP; gap-report A/B/C from the simulator's p25/p75 | three CIM numbers under "projected" | `outlook.expectedRaceDay` = equivalence at (capacity + `projectExpectedGain` from runway × execution) with a range | `basis: 'current_projection'` when there is no runway | Races, race detail, goal-gap, gap-report (A/B/C = range), next-A projection, notification, goal outlook | goal-sized gain; simulator band as A/B/C | `_race_outlook_contract.test.ts` (goal-free gain), `fitness-trajectory-belowtable` rewrite, registry simulator-band claim re-pointed, falsification |
| Race execution target | `effective-race-target.ts` (own 5% rule over a projection snapshot); spec-builder race branch at authoring; `achievableRaceTarget` at authoring/recompute | three moments, two rules | `outlook.execution` (goal pulls the target no further than the likely range's fast edge), `effectiveTargetFromOutlook` adapter, `refreshRaceRowsForPlan` writes it | `source: 'unavailable'` → no target | watch race day, execution plan, api race detail, race rows, coach-set | the snapshot read and the private 5% rule | `_effective_target.test.ts`, `_target_continuity.test.ts` (Rule 9 walk on the outlook), `GOAL.prescribed-race-pace-ceiling` | 
| HR expected range | spec-builder race branch `hr_cap_bpm = 0.92×LTHR` (a single cap for 26 miles) → watch `hrTargetBpm` | `RACE_HR_PCT_LTHR` in distance-doctrine used only by the execution plan | `lib/race/race-hr-guidance.ts` (expected range from `RACE_HR_PCT_LTHR`, validated against the runner's own comparable efforts; `informationalOnly` without evidence or on conflict) | `null` without LTHR | race rows `race_hr`, watch `raceHr`, race detail outlook, execution plan | `hr_cap_bpm` on race rows | `_race_outlook_contract` HR tests, `_race_row_refresh_gate` test 3, falsification |
| HR safety / bail | watch bail worded for HR and triggered by pace; abort boards drew nothing; phone `HRAlerter` at 0.95× its ceiling | — | `raceAbortHrBpm` (`0.95×LTHR + 3` = 163 for the owner's marathon) at `raceCheckpointMi`; Phase 2 re-wired the copy to the metric it evaluates; `HR_CAP_GRACE_BPM = 1` for the grader | — | execution plan, watch bail rule, grader | the 0.95 phone alarm threshold | Phase 2 gates (C-1, C-12) |

**Surviving second owners, reported as such:** `projection_snapshots` remains as (a) the day-to-day VDOT-equivalence TREND series in `goal-gap.ts` step 2 (a distinctly named quantity, "is the daily equivalence moving"), (b) the heat-detection VDOT in the Races list, and (c) the high-intensity fallback's measured-VDOT candidate. None of them is printed as a projection; (b) and (c) are fitness reads outside the Runner Model and are Phase 8 deletion candidates. `achievableRaceTarget` still seeds the race row at authoring and recompute (`prescribedRacePaceSec`); the seed is overwritten by the refresh in the same transaction and never reaches a runner, but it is a second computation of a race pace and should be deleted with the seed. The `race_week_tuneup` row was priced from that seed until the refresh was widened to it in this report's last commit.

---

## 4 · Threshold replay artifact

Script: `web-v2/scripts/p0-proof/threshold-replay.ts` (read-only; `DATABASE_URL=$DATABASE_URL_RO REPLAY_OUT=<dir> npx tsx --tsconfig tsconfig.json scripts/p0-proof/threshold-replay.ts 2026-06-01 2026-09-01 <label>`). Per day it records belief (s/mi, VDOT), confidence, source mode, contributing ids, every excluded id with its reason, each supporting observation's weight / representativeness / HR band / Evidence Engine kind, the daily move cap (prior, uncapped, allowed), and whether the belief changed. Files: `threshold-replay-before-7cac80f0.{json,log}` (the pre-P0 reader, run from a checkout at `7cac80f0`) and `threshold-replay-after-f967cab1.{json,log}` (the deployed reader). 93 days each.

| | Before (`7cac80f0`) | After (`f967cab1`) |
|---|---|---|
| Belief changes over 93 days | 15 | 15 |
| Largest single-day step | 27 s/mi | 26 s/mi (June, relaxed-bar regime, see below) |
| Steps after 2026-07-07 | 421→408→420→421→430→420 (07-16, 08-06, 08-23, 08-31, 09-01) | 433→430→426→430, then 430 held from 07-22 through 09-01 |
| 2026-09-01 belief | 420 s/mi (7:00) off ONE session | 430 s/mi (7:10), three corroborating sessions |

**Named dates (from the after JSON; the before column is the same script at `7cac80f0`):**

| Date | Before | After | Treatment |
|---|---|---|---|
| 2026-07-07 | 421 (ids 06-04 race, 06-09, 07-07) | **433, CAPPED** (prior 438, uncapped 430, allowed 5) | the 4×1 mi at 422 s/mi is admitted at weight 1 (HR in band, Evidence Engine `evidence`); the belief moves 5 s/mi that day and settles to 430 the next |
| 2026-07-12 | 421 | 426 · `-45100417674801` **excluded `LABEL_NON_QUALITY_UNPRICEABLE`** | a LONG run is never priced from its HR splits; only an Evidence Engine `threshold_like` segment could admit it, and none exists |
| 2026-07-14 (treadmill) | 421 | `-4269086812782646` **excluded `EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE`** | — |
| 2026-07-16 | **408 (7:00 → 6:48 in one day, off `-280549580846348`)** | 426 · `-280549580846348` **excluded `EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE`** | the I-pace day the audit named is not threshold evidence |
| 2026-08-06 (abandoned treadmill) | 420 (supported by `-226755616416002`) | 430 · `-226755616416002` **excluded `EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE`**; its single work phase carries `completed:false` and is dropped by `thresholdSegmentFromPhases` | contract test "an abandoned work phase is dropped" |
| 2026-08-23 | 421 | 430 · the unlabelled two-block session is admitted through Evidence Engine segments at reduced authority inside the AFC recovery window (`PRESCRIBED_WINDOW_AUTHORITY 0.75`, non-representative); cap applied on 08-23 in the intermediate build, not needed in the final reader | `SUPPORTING_EVIDENCE_ONLY_NOT_ANCHOR_MOVER` |
| 2026-08-30 | 421 | 430 · long run's marathon-pace segments admitted at 0.75, non-representative; the belief does not move | — |
| 2026-09-01 | **420 off one session (`-280549580846348` + `-226755616416002` were the other two "supports")** | **430**, supports `-258355938987883` (09-01, 422 s/mi, rep, HR in band, EE evidence), `-87627419857791` (07-07), `-2351254210708` (06-23); confidence 0.84 | the K-th-best weighted level is the third-fastest corroborated session; 09-01 becomes the fastest support and the level holds |

**Hero guard:** a single session cannot move the anchor by more than `THRESHOLD_ANCHOR_DAILY_MOVE_CAP_S_PER_MI = 5` × (days since the previous newest date + 1); `moveCap.applied` is recorded per day (true on 07-07 only in the final replay). **Unexplained jumps:** none after 07-07. The June flips (06-04 452, 06-05 456, 06-09 430, 06-11 455 …) come from the pre-existing "stronger tension relaxes the corroboration bar to 1–2 sessions" rule, unchanged in this pass; they are in the log with their reasons and are the remaining contradiction in §1.

---

## 5 · The real 4 × 1-mile acceptance matrix

Activity `-258355938987883`, 2026-09-01, plan row "4×1 mi @ T pace · 1 min jog", target 430 s/mi, LTHR 168. Full per-consumer output: `four-by-one-mile-replay-f967cab1.md` (written by `lib/training/_zz_replay_20260901.test.ts` running every consumer against production read-only on the deployed tree; run log `four-by-one-mile-replay-run-f967cab1.log`, 1 passed).

| # | Phase | Prescribed | Actual lap avg | Recovery | HR | Old verdict | New verdict | Explanation |
|---|---|---|---|---|---|---|---|---|
| 0 | Warm-up 2.10 mi | ceiling 502 s/mi | 516 | — | 140 | hit | hit · "Under the ceiling" | a ceiling, slower is correct |
| 1 | Interval 1 mi | 430 ± tolerance (execution-semantics threshold row) | 422 | — | 158 | drifted | **hit** · "On target" | graded on the segment average, not 5-s samples |
| 2 | Jog 61 s | none | 515 | 61 s vs 60 prescribed | 158 | — | not graded | recovery jogs carry no pace |
| 3 | Interval 1 mi | 430 | 429 | — | 161 | drifted | **hit** | — |
| 4 | Jog 64 s | none | 785 | 64 s | 156 | — | not graded | — |
| 5 | Interval 1 mi | 430 | 422 | — | 164 | drifted | **hit** | — |
| 6 | Jog 64 s | none | 1034 | 64 s | 157 | — | not graded | — |
| 7 | Interval 1 mi | 430 | 419 | — | 166 | **missed** | **fast** · "Quicker than target" | `missed` was returned on a rep run QUICKER than asked |
| 8 | Cool-down 2.11 mi | ceiling 502 | 534 | — | 153 | missed | hit · "Under the ceiling" | — |

Consumers, all agreeing on the same execution (from the replay file; the phone's Today after-run screen on the deployed build is `renders/phone-today-afterrun-f967cab1.png` when present): raw splits and interpreted segments (above); Evidence Engine `threshold_like` at weight 0.55 with `anchorMoveCandidate: true`; capacity reader admits it at weight 1 (`ee: evidence`, `hr: in_band`, representative) and holds 430; watch phase grader hit/hit/hit/fast; server execution reconstruction session verdict `executed`; Run Detail statuses on/on/on/fast; Today after-run "Heart rate, across the work 162 bpm · Pace, across the work 7:02" (**rendered on the deployed build against the deployed server**, iPhone 17 simulator, this session; the grading agent's renders of the same screen on its branch are in `agent-reports/phase-grading.md`); recap reads the reps (423 avg) not the mile splits (444); training influence and the Adaptation input read the same verdicts (the adaptation path stays shadow-only). **Not rendered:** the watch lobby (unpaired simulator shows a stale cached payload); the wire payload is in `agent-reports/phase-grading.md` and was re-composed against production by `lib/watch/_zz_watch_payload_20260901.test.ts`.

---

## 6 · Authoring/recomputation parity matrix

Script: `web-v2/scripts/p0-proof/authoring-recompute-parity.ts` (read-only): loads the owner's live plan rows, replays `recomputePacesForPlan`'s exact `buildWorkoutSpec` call in memory, and diffs pace, band edges, HR cap and kind for every future unsealed training row.

| Run | Anchors | Rows | Changed | Max Δ | Vol-weighted mean |Δ| | HR changes | Band changes | Structural |
|---|---|---|---|---|---|---|---|---|
| `…-stamped-anchors-3c2d1eaa.json` | the anchors the plan was LAST PRICED AT (`authored_state.pace_recompute.anchors`, 2026-08-31: T 430 · I 407 · R 371 · easy 502 · MP 475) — "recompute immediately, no new evidence" | 77 | **0** | 0 s/mi | 0 | 0 | 0 | 0 (structure is not repriced by a recompute) |
| `…-live-plan-3c2d1eaa.json` | today's anchors (I 401 · R 365; T, easy, MP unchanged) | 77 | 5 (all interval rows) | 6 s/mi | 0.4 s/mi | 0 | 0 | 0 |

The five interval rows move because the 2026-09-01 session raised the measured-VDOT candidate the high-intensity `vdot_fallback` reads; that is new evidence between 08-31 and today, not a second brain. Race rows are owned by the refresh and appear in §11. Other runners: the DB-backed corpus in `authoring-recompute-parity-audit-f967cab1.log` (legacy cascade vs canonical, four other real accounts) and the ten golden fixtures in `lib/training/_cold_start_fixtures.test.ts` (zero-run, typed-PR, sparse-history, returning, extreme-goal shapes) are in the suite; a zero-run and typed-PR runner authored and immediately recomputed in the DB was not exercised in this pass — the parity there rests on both paths calling the same `resolvePrescribedPaceAnchors` + `buildWorkoutSpec`, which `scripts/check-goal-pace-leak.sh` and the shadow-compare unit test pin.

---

## 7 · Goal-isolation proof

`race-consistency-after-refresh-f967cab1.json#goalIsolation` — the CIM outlook composed from ONE set of reads with four stated goals:

| Stated goal | Capacity (T s/mi · VDOT · conf · exponent · evidence ids) | Current projection | Training pace | Expected gain | Expected race day · range | Execution target · source | Feasibility |
|---|---|---|---|---|---|---|---|
| 3:00:00 (stated) | 430 · 47.8 · 0.84 · 1.087 · [-258355938987883, -87627419857791, -2351254210708] | 12390 | 475 | +2.60 | 12194 · 11817–12615 | **11820** · clamped to range edge | unlikely_currently |
| 3:30:00 | identical | 12390 | 475 | +2.60 | identical | **12600** · stated goal within range | comfortable |
| 2:30:00 | identical | 12390 | 475 | +2.60 | identical | **11820** · clamped to range edge | unlikely_currently |
| none | identical | 12390 | 475 | +2.60 | identical | **12190** · expected race day | no_goal |

Allowed to change: execution target, its source, feasibility, coach-set tiers (no-goal only). Not allowed and unchanged: capacity, confidence, evidence set, durability, current projection, training anchors, expected improvement, expected race day and its range. The gate: `_race_outlook_contract.test.ts` "a soft goal and an impossible goal earn the same expected improvement and the same expected race day"; falsified in `falsification/goal-isolation-gain-reads-goal.log`. At the training-pace level, `_authoring_shadow_compare.test.ts` pins "a threshold day prices identically for a 3:00 goal, a 5:00 goal and no goal" and "a race day IS allowed to move with the goal".

---

## 8 · CIM progression artifact

Live rows (`race-consistency-after-refresh-f967cab1.json#cimRaceSpecificRows`, plan `pln_9a57561debb776e5`, phases `phs_…`, weeks 10–14):

| Date | Wk | Type · identity | Purpose | Current MP training pace | Evidence · confidence | Progression mechanism | Expected race day | Stated goal | Race-row execution | HR guidance | Why it differs from its neighbour |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-11-03 | 10 | threshold · 4×1 km MP → 5K · 60 s jog | pace change under fatigue | 475 (opening reps) → 401 | T direct 0.84 · I vdot_fallback | pace progresses from capacity evidence, not from the calendar | 3:23:14 | 3:00:00 | — | grader HR grace 1 bpm against the row's cap | mixed-pace session; priced at both anchors |
| 2026-11-15 | 11 | long · 16 mi with 4 mi @ M | marathon-pace finish on tired legs | 475 finish; long band 502–537 | anchors direct | duration then density (Brief 07) | — | — | — | hr_cap 151 (easy ceiling `hrCapEasy`) on the easy portion | finish carries the MP anchor, the body carries the long band |
| 2026-11-17 | 12 | tempo · 2.5 WU · 11 mi @ MP · 1.5 CD | the rehearsal | **475 (7:55/mi)** | T 430 direct 0.84 · exponent 1.087 (5 races, conf 0.62) | MP moves when T moves or the exponent moves; controlled rehearsals move the anchor | 3:23:14 | 3:00:00 | — | expected race band informational on tempo rows; grader cap = Z4 seam | training pace, not race-day pace (the bridge's step 3) |
| 2026-11-24 | 13 | tempo · 2 WU · 7 mi @ MP · 1 CD | last rehearsal | 475 | same | same | same | same | — | same | — |
| 2026-12-01 | 13 | race_week_tuneup · 5 mi | race-pace tune-up | — | — | — | — | — | **451 s/mi (7:31), the execution target**, refreshed 2026-09-02T01:54:04Z (was 425 from the authoring seed) | race_hr as the race row | rehearses the day's pace, not the training MP |
| 2026-12-06 | 14 | race · 26.22 mi | the race | — | — | — | **3:23:14 · 3:16:57–3:30:15** | **3:00:00** | **451 s/mi (7:31), 3:17:00, source `stated_goal_clamped_to_range_edge`** | expected 148–160 · early ceiling 148 through 10 mi · late allowance 165 · checkpoint 10 mi abort 163 · validated against 7 comparable efforts (observed mean 154), enforced | see the bridge |

**The bridge (from `outlook.bridge`, every step with value, evidence, confidence, change trigger):**

```text
current capacity            7:10/mi threshold · VDOT 47.8 · conf 0.84 · runs -258355938987883, -87627419857791, -2351254210708
                            trigger: three corroborating threshold sessions faster or slower, HR in band
→ current projection        3:26:30 (3:20:18–3:32:42) · conf 0.62 · Daniels + personal exponent 1.087 at weight 0.62
                            trigger: threshold moves, or a graded race moves the exponent
→ marathon-training pace    7:55/mi · conf 0.73 · threshold carried to 26.2 mi through the exponent
                            "today's capacity, not race day's; the rehearsal teaches the effort, the block earns the pace"
                            trigger: the anchor or the exponent moving; controlled rehearsals move the anchor
→ expected improvement      +2.6 VDOT (1.9–2.7) · conf 0.59 · 10.7 build weeks × 0.35/wk × execution 0.97 (2 recent test points)
                            trigger: executing key sessions moves it up, missing them moves it down; time alone never moves it
→ expected race day         3:23:14 (3:16:57–3:30:15) · conf 0.36 · current projection + gain through the same equivalence
                            trigger: any input above; the range narrows as execution evidence accumulates
→ execution strategy        3:17:00 · 7:31/mi (band 7:26–7:36) · controlled start · HR 148–160 expected
                            "Your goal (3:00:00) is faster than the likely range's fast edge (3:16:57) · race to the edge; the goal stays yours."
                            trigger: the range moving, or a goal you change yourself
```

No transition lacks evidence, confidence or a trigger, so CIM coherence is PASS; the tune-up row is the item that was still on the seed when the table above was captured, and its refresh is in the last commit and §11.

---

## 9 · Race consistency matrices

From `race-consistency-after-refresh-f967cab1.json` (one process, one resolved outlook per race) and the rendered Races list.

**CIM (goal 3:00:00, 96 days out)**

| Field | Label shown | Meaning | Value | Canonical source | Confidence / range | Surface |
|---|---|---|---|---|---|---|
| `expectedRaceDay.expectedSec` | Projected | where this build lands on race day | 3:23:14 | outlook | 0.36 · 3:16:57–3:30:15 | Races list (rendered), race detail plate, goal-gap `expectedRaceDaySec`, gap-report headline "Tracking 3:23:14", next-A projection (snapshot cron / notification), goal-outlook note |
| `currentProjection.expectedSec` | Today's fitness would race | equivalence today | 3:26:30 | outlook | 0.62 · 3:20:18–3:32:42 | race detail outlook section (bridge step 2) |
| `trainingPrescription.paceSecPerMi` | Marathon pace in training now | the MP anchor | 7:55/mi | anchors.marathonSecPerMi | 0.73 | race detail outlook, plan MP rows (475) |
| `execution.targetSec` | Run the day at | execution target | 3:17:00 · 7:31/mi | outlook.execution | band ±5 | race row `pace_target_s_per_mi` 451 (lo 446 hi 456), `effective-race-target` (watch race day, execution plan, api race detail) target 11820 source `projection` |
| `statedGoal.sec` | Goal | the runner's goal | 3:00:00 | races row | — | everywhere; unchanged (§11) |
| gap | Gap | expected − goal | +23:14 | derived from the two above | — | Races list (rendered), goal-gap `gapSec` 1394, gap-report |
| `goalFeasibility` | — | compare, never edit | unlikely_currently; gap to fast edge 16:57 | outlook | — | goal-gap status `unclosable`, whatClosesIt |
| coach-set A/B/C | Coach set | no-goal tiers | null (a goal is stated) | outlook.coachSet | — | race detail |
| gap-report A/B/C | A/B/C-goal | range edges / expected | 3:16:57 / 3:23:14 / 3:30:15 | outlook range | — | morning brief / readiness brief |
| race_hr | Heart rate on the day | expected range, enforced | 148–160 · early ceiling 148 to mile 10 · late 165 · abort 163 at mile 10 | race-hr-guidance | 7 comparable efforts | race row, watch `raceHr`, race detail outlook |
| plan drift | proposal reasons | `expected_race_day_sec` | 12194 | goal-gap | — | plan-drift cron proposals (renamed from `trajectory_sec`) |
| retrospective `nextRace.predictedSec` | what this past race alone predicts | equivalence at a VDOT | distinct quantity by name (`equivalenceAtDistance`) | outlook module helper | — | race retrospective |

**Santa Monica 10K (no goal, 12 days out)**

| Field | Value | Source | Surface |
|---|---|---|---|
| expected race day | 44:18 (43:25–45:11), basis current_projection (no build weeks remain) | outlook | Races/detail "Projected" |
| execution target | 44:20 · 7:09/mi (429 s/mi), source expected_race_day | outlook | race row 429 (lo 424 hi 434) — was 444 before the refresh |
| coach set | A 43:25 · B 44:20 · C 45:10, method `race-outlook` | outlook.coachSet via coach-goal-load | race detail COACH SET |
| training prescription | 7:09/mi race-specific | outlook | — |
| race_hr | 168–176 · early ceiling 168 to mile 2 · late 181 · abort 179 at mile 2 · enforced (2 comparable efforts) | race-hr-guidance | race row, watch |

Different numbers appear only under different names: 44:18 (expected) vs 44:20 (the target, rounded to the nearest 5 s); 3:26:30 (today) vs 3:23:14 (race day) vs 3:17:00 (execution).

---

## 10 · HR semantics matrix

Owner LTHR 168 (`race_half · Americas Finest City · 2026-08-16`, set 2026-08-31), HRmax observed 183, RHR 46.

| Number | Meaning | Owner | Formula / evidence | Phone consumer | Watch consumer | Spoken | Grader | Safety |
|---|---|---|---|---|---|---|---|---|
| easy/long `hr_cap_bpm` 151 | Friel Z2 ceiling for easy running | `hrCapEasy` → `aerobicCeilingBpm(168)` = ceil(168×0.90)−1 = 151; max with 78%×183 = 143 | phone Today `hrCapStat` on easy/long/shakeout only | `hrCeilingBpm` → easy face guardrail row turns red and holds | — | `hrCapBreached`: avg > cap + `HR_CAP_GRACE_BPM` 1 | phone `HRAlerter` (never wired: `configure()` has no call site; threshold copy fixed by Phase 2) |
| threshold pass line | Z4→Z5a seam, at-or-under threshold | `zones.ts` | Friel edges of LTHR | run detail "in the band" sentences gated on WORK HR (Phase 2 C-6) | — | — | quality-day HR judgement | — |
| race `race_hr.expected_range_bpm` 148–160 (M) / 168–176 (10K) | expected response band | `race-hr-guidance.ts` | `RACE_HR_PCT_LTHR` [0.88,0.95] / [1.00,1.05] × LTHR, validated against comparable efforts within 5% of race pace | race detail outlook ("expect 148-160 bpm"), execution plan | `raceHr.expectedLo/HiBpm` decoded (not drawn yet) | no | not graded | informational unless `comparable_efforts > 0` and no conflict |
| `early_ceiling_bpm` 148 through mile 10 | opening restraint | same | range low edge through `raceCheckpointMi` | outlook | decoded | — | — | — |
| `late_allowance_bpm` 165 | drift allowed in the last third | same | range high + 5 | outlook | decoded | — | — | — |
| `checkpoint_abort_bpm` 163 at mile 10 | the bail figure | `raceAbortHrBpm` = 0.95×168+3 | execution plan bail line | watch bail rule (Phase 2 C-1 re-worded to HR) | yes, at the checkpoint | — | evaluates HR, the metric in its copy |
| `hr_cap_bpm` on race rows | — | **removed** (was 0.92×LTHR = 155 on CIM, 168 on Malibu) | — | `hrTargetBpm` null on race phases | — | — | a 26-mile alarm no longer exists |

Demonstrated: informational references cannot trigger alarms (race rows carry no cap; `informationalOnly` gates the checkpoint rule); expected bands are not hard targets (the race face shows a reference, the grader does not grade race HR); the bail rule names and evaluates HR; pace-adaptation compatibility reads the canonical HR evidence (`lib/adaptation` HR compatibility reads `hrCapBreached` and the anchored band, Phase 2 C-3); race-day HR guidance is compatible with the strategy (early ceiling = range low through the opening block the controlled start prescribes). **Not demonstrated:** the watch drawing the expected range — decoded, not rendered.

---

## 11 · Live production change ledger

Deployment `708a200b` (`f967cab1`), refresh run 33579154765, stamp `authored_state.race_row_refresh.at = 2026-09-02T01:23:04.412Z`, source `cron/snapshot-projections`, updated 4, refused 0. Before/after rows in `live-plan-ledger/p6-race-rows-{before,after}.txt`.

| Row | Date | Type | Sealed | Old pace · lo/hi · hr_cap | New pace · lo/hi · hr_cap | New `race_execution` | Provenance | Post-write check |
|---|---|---|---|---|---|---|---|---|
| `wko_5069bc75e324a69a` | 2026-09-13 | race (Santa Monica) | no | 444 · 439/449 · — | **429 · 424/434 · none** | target 2660 expected_race_day, expected 2658, goal null, HR 168–176 | outlook v1.0.0 resolved 01:23:02Z | re-read matches (`race-consistency-after-refresh`) |
| `wko_613649879df83f38` | 2026-09-26 | race (Dodgers, goal 45:00) | no | 435 · 430/440 · — | 435 · 430/440 · none | target 2700 stated_goal_within_range, expected 2656 | 01:23:03Z | ✓ |
| `wko_04050ebcd66f81d6` | 2026-11-08 | race (Run Malibu, goal 1:30:00) | no | 425 · 420/430 · **168** | **438 · 433/443 · none** | target 5740 clamped to range edge, expected 5887, HR 161–168 | 01:23:03Z | ✓ |
| `wko_8bfa8647379342ba` | 2026-12-06 | race (CIM, goal 3:00:00) | no | 436 · 431/441 · **155** | **451 · 446/456 · none** | target 11820 clamped to range edge, expected 12194, range 11817–12615, HR 148–160 | 01:23:04Z | ✓ |
| `wko_60e4afb00a4e2c33` | 2026-12-01 | race_week_tuneup | no | 425 · — · — | **451 · 446/456 · none** | target 11820 clamped to range edge (the CIM outlook) | run 33581160907 on `16010927`, resolved 01:54:04Z, stamp updated 1 / refused 0 | re-read matches (`p6-race-rows-after2.txt`); the four race rows reported `unchanged` (idempotent); sealed checksum still `1f9bc33de7f4cbb10c6807304305e1af` (`p6-sealed-checksum-after2.txt`) |

Future/unsealed rows changed: 4 + 1 (second run). Completed/sealed rows changed: **0** — `live-plan-ledger/p6-sealed-checksum-{before,after}.txt`: 7 sealed rows, md5 `1f9bc33de7f4cbb10c6807304305e1af` before and after. Stated goals unchanged: `p6-goals-{before,after}.txt` (CIM 3:00:00 / 10800, Malibu 1:30:00 / 5400, Dodgers 0:45:00 / 2700, Santa Monica none). Training rows: 0 changed by this run (`pace_recompute` stamp still 2026-08-31 `prescription_wire_1_promotion`, 77 rows; the reanchor found nothing to move).

---

## 12 · Regression falsification ledger

Each log in `falsification/` shows the mutation (a `sed` on the source), the gate's output against the broken code, and the gate's output after `git checkout --` restores it. Runner: `web-v2/scripts/p0-proof/falsify.sh`.

| Invariant | Defect it protects | Gate | Broken → | Restored | CI |
|---|---|---|---|---|---|
| Threshold admission and weighting | an activity with no Evidence Engine threshold evidence admitted as threshold | `_threshold_evidence_contract` | × (admission tests) | 21 passed | test-full ✓ |
| One-session belief movement | anchor moved 430→420 off one session | same (cap tests) | × | 21 passed | ✓ |
| Staleness lowers support, never the level | fitness decaying with the calendar | same (new, this report) | × "expected 440 to be 425" | 21 passed | ✓ |
| Goal isolation | the goal used as evidence of improvement | `_race_outlook_contract` | × | 26 passed | ✓ |
| Execution target ≤ likely range fast edge | racing a fantasy split | same | × | ✓ | ✓ |
| HR informational without evidence | a population band alarming for 26 miles | same | × | ✓ | ✓ |
| Race-row staleness | race row frozen at authoring | `_race_row_refresh_gate` | × (test 1) | 5 passed | ✓ |
| Race row HR cap returns | 0.92×LTHR cap on a race row | same (test 3) | × | ✓ | ✓ |
| Sealed-history immutability | refresh touching a completed day | same (test 4) | × | ✓ | ✓ |
| Projection consumer consistency | a route computing its own projection | `_race_projection` | × | ✓ | ✓ |
| Effective target second rule | a private 5% rule at the execution moment | `_effective_target` | × | ✓ | ✓ |
| Limiter grows its own fit | a second exponent engine | `_limiter` source scan | × | ✓ | ✓ |
| Tolerance ownership · easy-ceiling direction · recovery without pace · phone/watch consistency · authoring/recompute parity · Coaching Thesis stability · gate liveness (F-2/F-3/F-8/F-29/F-33/F-35/F-36) | see phase reports | Phase 2 gates (falsified 7 ways), `check-goal-pace-leak.sh` (3 ways), `_coaching_thesis` falsifier, Phase 0 gates (before/after outputs quoted in `agent-reports/phase-gates.md`) | recorded in the agent reports | — | ✓ |

Every gate above runs in `test-full` on every push to `main` (no path filter) and, for the prebuild scripts, on every Railway build.

---

## 13 · Complete verification results

- **Focused suites** (this session, RO credentials, final tree): `lib/race` 27 files; `lib/training/_threshold_evidence_contract` 21; `lib/audit` 10 files / 264; `lib/coach/_limiter` + `_limiter_continuity`; `lib/plan/_coach_sensible`, `_maint_invariants`, `_restore_continuity`, `_dosing_sweep_gate`, `_sweep_allusers` (30 tests, ~11,598 archetypes); `lib/format/_format_lint`, `lib/runs/_run_shape_lint`.
- **Full Vitest** on the final tree (`3c2d1eaa` + this report's gates) with `DATABASE_URL_RO`: 1695 suites, **8126 tests passed / 10 skipped / 0 failed** (`vitest-final-3c2d1eaa.json`: per-file status and every skipped test by name). The skips are DB-gated probes that print the owner's CIM block or dry-run a backfill against a live database (`lib/plan/_probe_*`, `lib/race/_probe_course_geometry_backfill`) and the two `workout vocabulary + three-band split` builds; all are `skipIf`-gated and reported as skipped, never passed. On `f967cab1` the same run was 8119 passed / 10 skipped / 0 failed.
- **Failed tests and root causes fixed in-line:** (1) `_run_shape_lint` ×2 + `_format_lint` ×1 on the brain's files after push 1 — raw `data->>` access, hand-rolled merge filter, private rounding — fixed by `331e6bab`; (2) `_coach_sensible` easy-day floor after the authoring merge — the floor was compared in raw miles against the mean, then quantised (39 min day against a 40 min floor); fixed by rounding the floor up to the half-mile the distribution quantises on; (3) `_authoring_shadow_compare.audit` liveness in CI without credentials — acknowledged deliberately in the no-secrets job (`ALLOW_AUDIT_SKIP`), consistent with its 62 other reported skips.
- **Typecheck:** `tsc --noEmit` clean on every pushed commit.
- **Prebuild gates (17):** palette-sync, spacing-tokens, modelled-mark, coach-voice (295→297 files after the widening), doctrine (324 citations), wire-keys (phone 106, watch 94, emitters 50), goal-immutability, automatic-mutations (per statement), swallowed-failure (identity ratchet, baseline 368), coercion (5 handed-back collapses still open, HANDED_BACK_FAILS=false), derived-consistency, generated-content, normal-window, client-graph, active-plan, goal-pace-leak (new), full gate — exit 0 on the merged tree (`scratchpad` logs `prebuild-int5`).
- **Next build:** `next build` exit 0 on `3c2d1eaa` (Compiled successfully).
- **Native builds:** `xcodebuild -scheme Faff -destination 'generic/platform=iOS Simulator'` BUILD SUCCEEDED, products `Debug-iphonesimulator` and `Debug-watchsimulator` (the watch target builds in the same scheme); the watch model change in this report's last commit was compiled the same way before push.
- **Full-suite CI (`test-full`):** ✗ 63d47b5d (lint findings) · ✓ 331e6bab · ✗ 0bb6ac8c · ✗ f967cab1 (audit liveness without credentials) · ✓ 3c2d1eaa · ✓ 16010927. `build-check` ✓ on every push through 3c2d1eaa; in progress on 16010927 when this line was written.
- **Deployment health:** Railway `708a200b` SUCCESS for `f967cab1`; the "CRASHED" shown on `eae272fc` is the container SIGTERM at replacement (`railway logs -d eae272fc…`: "✓ Ready in 420ms … Stopping Container … signal SIGTERM"), not a runtime failure.
- **Production endpoint checks:** the Races list rendered from the deployed server on the new build (`renders/phone-races-list-f967cab1.png`: Projected 3:23:14, Gap +23:14 = the outlook); the race-detail route's library resolvers exercised against production by `scripts/p0-proof/race-consistency.ts`; the snapshot cron ran end to end in production and stamped the plan.

---

## 14 · Runner-readable final output

1. **What does the app currently believe my threshold capacity is?** 7:10 per mile (VDOT 47.8), read directly from your own sessions, with confidence 0.84. It has held there since 22 July.
2. **Which runs produced that belief?** Three corroborating threshold sessions: the 4×1 mile on 1 September (7:02 average, heart rate in the threshold band), the 4×1 mile on 7 July, and the session on 23 June. Your 12 July long run, the 14 July treadmill run, the 16 July interval day and the abandoned treadmill session on 6 August are recorded as excluded, each with its reason; the 23 and 30 August sessions count as support at reduced authority because they sat inside the AFC recovery window.
3. **How did it judge my 4 × 1-mile workout?** Executed. Reps one to three on target (7:02, 7:09, 7:02 against 7:10), rep four quicker than target (6:59), recoveries not graded, warm-up and cool-down under their ceilings. Nothing calls it missed or drifted.
4. **What marathon pace is it training me at now, and why?** 7:55 per mile. That is your 7:10 threshold carried to 26.2 miles through your own endurance exponent (1.087, from five graded races). It is today's capacity, not race-day pace: the rehearsals teach the effort, and the block is expected to earn the faster number.
5. **How is the plan intended to make that faster?** By executing the key sessions: with 10.7 build weeks left and your execution at 0.97, the block is expected to add about 2.6 VDOT (a likely range of 1.9 to 2.7). That moves only when you complete or miss the sessions, never because a week passed.
6. **What does it currently expect me to run at CIM?** 3:23:14, with a likely range of 3:16:57 to 3:30:15, at confidence 0.36.
7. **How does that differ from my stated goal?** Your goal is 3:00:00. It stays your goal. It is 23:14 faster than the expected result and 16:57 faster than the fast edge of the likely range, so the day's plan runs to that edge: 3:17:00 at 7:31 per mile, a controlled start, heart rate expected between 148 and 160 with a ceiling of 148 through mile 10 and a bail check at mile 10 above 163.
8. **What evidence would improve or worsen the outlook?** Three corroborated threshold sessions faster than 7:10 with heart rate in the band move the capacity up; a new graded race moves the exponent; completing the marathon-pace rehearsals and long-run finishes raises the expected improvement; missing them lowers it. Nothing you type as a goal changes any of it.
9. **What will appear on my phone and Watch?** Phone: Races shows Projected 3:23:14 and Gap +23:14; the CIM detail shows the same number plus "How the number is built" (today's fitness 3:26:30, marathon pace in training 7:55, expected on race day 3:23:14 with the range, run the day at 3:17:00 · 7:31, and the heart-rate reference). Watch: on race day the target pace 7:31 with the controlled opening, the goal delta, and, once the watch face is updated, the expected heart-rate range as a reference rather than an alarm; today it decodes that range without drawing it.
10. **What remains uncertain?** The race-day range is wide (0.36 confidence) because the improvement depends on execution that has not happened yet; the interval pace anchor is a fallback from your VDOT rather than a direct read; the watch's grading is verified from its source and its payload, not by running it on a device; and the tune-up row in race week was re-priced only in the last commit of this report.

---

## 15 · Honest incompleteness

Stated at the top: three areas are PARTIAL, so the P0 push is not complete and Adaptation authority is not enabled (Pace Adaptation remains shadow-only; the shadow log ran unchanged through this pass).

- **Phone/Watch prescription consistency.** Blocker: the wrist grader's compiled behaviour is pinned by a source-bound TypeScript port (`agent-reports/phase-grading.md` §gates) rather than by executing Swift against the 2026-09-01 payload on a paired simulator; the bail/abort boards compile but have never fired on a device. Within scope; needs a paired watch simulator session or a device.
- **HR semantic consistency.** Blocker: the watch decodes `raceHr` (this report's last commit) but the race face does not draw the expected range yet, and the phone `HRAlerter` easy-run alarm has no call site. Within scope; a face change on the watch and one `configure()` call on the phone.
- **Full automated verification.** Blocker: `build-check` for the final commit `16010927` was still running when this report was finalised (test-full ✓, Railway ✓). No code reason; a reviewer can confirm it with `gh run list --branch main --limit 5`.

Everything above is reproducible from the committed scripts against the read-only role; the deployed commit for every production number is `f967cab1` (Railway `708a200b`).



---

# Part 2 · The four phase reports, verbatim

Written by the agents that executed Phases 0, 2, 4 and 5 on their own branches, before integration. Their branch names, SHAs and file paths are as they were at the time; every one of their commits is on `main` through the merges listed in Part 1 §2.


## 2.0 · Interim Phase 0 status note (sent for external review mid-run)


Interim note for external review. Phase 0 is running on branch `p0/gates`
(six commits on top of `main` at `7cac80f0`, not yet merged). Every commit
below was falsified before and after the fix — the gate was made to fail on
a planted violation, the fix landed, and the same plant was shown to fail
again — and the commit body records the plant and both results.

## What Phase 0 was asked to do

1. Repair the two evidence tests that pinned live production rows' data
   quality (they failed whenever the owner's account changed).
2. Close the gate holes the independent audit named: F-2 (the swallowed-
   failure ratchet was a budget), F-3 (coach-voice gate excluded `lib/plan`),
   F-8 (plan-writer registry was per file, not per statement), F-29
   (easy-discipline graded against an archived plan).
3. Add a full-suite CI job so a green push means the whole suite ran.
4. Stop a test from dirtying the repo it tests.

## Landed on `p0/gates` (in order)

| Commit | What it fixes | Falsified |
|---|---|---|
| `9c2c18d8` | Evidence test no longer asserts a live production row's data quality. The stale prod-row assertions are gone; the test now grades the reader's behaviour on fixtures and the audit variant stays read-only. | yes |
| `12086e29` | The adaptation shadow-compare test appended to a git-tracked JSONL log when run read-only. File fallback is now opt-in, so a test run cannot modify the repository. | yes |
| `e1ed5848` | F-2. `EMPTIED_BASELINE` was a scalar count, so a swallowed DB read could be added to the plan engine and paid for by tidying an unrelated `.catch`. The ratchet is now keyed on `file::symbol` identity, fails in both directions (new site, stale entry), and the shell gate's integer is cross-checked against the list length. | yes, A+B swap reproduced from the audit |
| `c634d479` | F-3. Coach-voice gate widened to `lib/plan`, `lib/watch`, `lib/execution`, `lib/prescription`, `lib/race`, `lib/today` (189 → 290 files). 85 findings: 65 runner-facing strings rewritten, 14 verbatim doctrine anchors exempted with `// ok:`, one JSDoc reflowed. | yes |
| `17834cbd` | F-8. `check-automatic-mutations.sh` now derives plan writers per statement (`file::enclosingFunction`, 17 sites), so a second writer inside an already-declared file can no longer inherit the first one's answers. Plant pinned as a fixture. | yes |
| `4c1c8c23` | F-29. The active-plan scanner skipped any `plan_workouts` query that never mentioned `training_plans`; that exact shape was the live bug. Gate widened to user-scoped `plan_workouts` reads. `easy-discipline.ts` now joins the active plan and takes the nearest upcoming easy row. Verified read-only across all seven production users: new band == active plan for 7/7; the old query read an archived plan for 2/7, one of them 40 s/mi off. | yes, both halves |

Files touched: 32 (+1,272 / −463), all under `web-v2/`.

## Still in flight on Phase 0

- Full-suite GitHub Actions job (item 3). The agent is running the affected
  suites now; the workflow file has not been pushed yet.
- Stale coercion-ratchet entry found while falsifying (`HANDED_BACK_KNOWN`
  carried one more entry than the scanner sees) — being closed the same way.
- Merge to `main`, in order, ahead of the Phase 1 evidence contract.

## What Phase 0 does not claim

- Nothing here changes a coaching number. Every commit is a gate, a test, or
  a population fix; the one behavioural change (easy-discipline's band) was
  proven to equal the active plan's band for every user.
- Green on these gates is not a deploy (Rule 19). The Railway deployment will
  be confirmed separately once `main` moves.



## 2.1 · Phase 0 · trustworthy baseline

### Phase 0 · trustworthy baseline — agent-gates

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

### 1 · Every gate falsified, before and after

Every one was broken on purpose FIRST, the failure output captured, then fixed,
then re-falsified, then restored. Nothing below is a fix I assumed worked.

#### F-2 · swallowed-failure ratchet was a budget, not a ratchet

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

#### F-3 · coach voice did not scan `lib/plan`

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

#### F-8 · automatic mutations derived plan writers per FILE

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

#### F-29 · ACTIVEPLAN-1 skipped any SQL not mentioning `training_plans`

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

#### F-33 · the HANDED_BACK assertion was unreachable dead code

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
### a 6th entry not on the ratchet
COERCION FAIL · 6 handed-back entries but 5 on HANDED_BACK_KNOWN
× no collapse is handed back that is not on the ratchet · the flag sets severity
    "lib/plan/falsify.ts::aNewCollapse::catch"

### a ratchet id with no entry
COERCION FAIL · 5 handed-back entries but 6 on HANDED_BACK_KNOWN
× no ratchet entry outlives the collapse it names
    "lib/plan/gone.ts::alreadyFixed::catch"
```

Both restored; `coercion OK · 33 argued exemptions, 132 on the named ratchet,
peripheral baseline 181`.

#### F-35 · `--silent` suppressed the doctrine report on every build

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

#### F-36 · four gates reported OK while checking nothing

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

#### The new CI liveness assertion (Task B), falsified

```
A · empty run   -> ['only 0 test files ran (floor 300)', 'only 0 tests passed (floor 7000)']
B · mass skip   -> ['only 6700 tests passed (floor 7000)',
                    '300 tests skipped (ceiling 120) — tests are being disabled']
C · real run    -> ['PASS']
```

---

### 2 · The seven-user easy-band proof (F-29)

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

### 3 · Coach voice — every string changed

85 findings on the widened scan. **65 strings rewritten**, **14 lines
exempted** with `// ok:` (every one a verbatim doctrine anchor), **1 JSDoc
reformatted with the string untouched**.

The complete before/after list is in **appendix A** at the bottom of this file
(80 entries across 31 files, recorded mechanically as each edit was applied,
not reconstructed afterwards). Summary by intent:

##### Runner-facing copy — dash replaced by a full stop or `·`, meaning unchanged

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

##### Runner-facing APP VOICE, not just punctuation — three refusal reasons

`lib/plan/generate.ts` returned `{ ok: false, reason: '… · try again in a
moment' }` three times. A coach does not say "try again in a moment".

- `'could not read your training history · try again in a moment'`
  → `'could not read your training history · the plan you have stands'`
- `'could not read your recent training · try again in a moment'`
  → `'could not read your recent training · the plan you have stands'`
- `'could not read your recent runs · try again in a moment'`
  → `'could not read your recent runs · the plan you have stands'`

(`lib/audit/_swallowed_failure_fixes.test.ts` pins two of these; updated.)

##### Engine diagnostics — fixed rather than exempted, because the fix is free

`lib/plan/validate.ts` ×15, `lib/plan/anchor-fit.ts` ×5,
`lib/plan/history-shapes.ts` ×2, `lib/plan/adaptive-ramp.ts`,
`lib/plan/mutate.ts`, `lib/race/course-elevation.ts` ×6,
`lib/race/course-geometry-source.ts` ×1. An exemption is debt; a `—` → `·` here
costs nothing.

##### The 14 exemptions — every one a verbatim doctrine anchor

Rewriting the dash would break the citation the registry resolves against.

- `lib/plan/goal-tiers.ts` ×6 and `lib/plan/history-shapes.ts` ×2 — `Research/22`
  section names (`§"Marathon — Advanced"`, `§"5K — Advanced"`, …).
- `lib/race/distance-doctrine.ts` ×6 — `citation:` strings quoting Research/08,
  /10 and /18 text; developer-facing provenance, never rendered.

##### One NOT exempted, fixed structurally

`lib/plan/zone-anchors.ts:85` — `§"Dosing rules — Daniels' caps"` sat on a
JSDoc **opening** line (`/**`), which the scanner does not skip. Reformatted so
the anchor line begins with `*`, which it already skips as a comment
continuation. **The string is byte-identical.**

---

### 4 · Everything else, by task

#### A · the two stale production-row assertions (`9c2c18d8`)

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

#### E · `allowFileFallback` (`12086e29`)

Default flipped `true` → `false`. Nothing that ships relied on the old default:
the cron route already passed `false`. The log directory now resolves PER CALL
from `FAFF_SHADOW_LOG_DIR` (not at module load) so a test can redirect it after
the module is cached. `_shadow_compare.audit.test.ts` is the one opt-in caller;
it writes to `mkdtemp` and **asserts the redirect took effect** rather than
assuming it. Verified: a full RO run of that file leaves `git status` clean.

Also deleted the stale premise in that file (migration 160 "not run") — the
table exists; the file posture is reached because the READ-ONLY role's INSERT is
refused at the Postgres permission level.

#### C5 · three of the seven live Rule 11 collapses fixed, 7 → 5

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

#### D · five false headers, four dangling citations (`6fa37dd2`)

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

### 5 · FOR THE COORDINATOR — the three simulator-band violations

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

### 6 · Verification

#### Prebuild — all 17 gates, exit 0

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

#### `npx tsc --noEmit`

Clean, run after every commit.

#### Full suite

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

#### `npx next build`

```
✓ Compiled successfully
  Linting and checking validity of types ...
  … full route table emitted …
next-build-exit=0
```

Rule 19's step. The gate chain being green is evidence about the checks; this
is the thing that actually ships.

#### Push

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

### 7 · Left undone, and why

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

### Appendix A · every coach-voice string, before and after

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



## 2.2 · Phase 2 · execution grading truth

### Phase 2 · execution grading truth

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

#### 1 · The 2026-09-01 run, before and after, through every consumer

Owner `0645f40c-951d-4ccc-b86e-9979cd26c795`, canonical `runs` row
`-258355938987883`, plan row `4×1 mi @ T pace · 1 min jog`, target 430 s/mi,
LTHR 168. Replayed live against production (read-only) by
`web-v2/lib/training/_zz_replay_20260901.test.ts`; full report at
`scratchpad/p0/replay.md`.

**The stored row carries neither `tolerancePaceSPerMi` nor `paceShape`** — it
predates both — so every "after" number below is the LEGACY-payload path,
which is what every already-deployed watch sends.

##### Per phase

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

##### Per consumer

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

#### 2 · The tolerance-owner proof

##### Before — five widths, and two classifications

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

##### After

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

#### 3 · Gate falsifications (Rule 18)

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

#### 4 · What changed, by audit finding

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

##### Found in this phase, not in the audit

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

#### 5 · Verification

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

##### Ratchets re-tightened

- `EMPTIED_BASELINE` 374 → **371**, with the reason written into the registry:
  three of the four `currentVdot` copies wrapped their query in
  `.catch(() => ({ rows: [] }))`.
- `PERIPHERAL_BASELINE` stays at 181. Two collapses I introduced were removed
  rather than allowlisted (a `.catch(() => null)` on `runnerToday` became a
  try/catch returning `READ_FAILED`; a second `resolveThresholdHr` read became
  `glance.lthr`, which is the number the card's own bands already use).

---

#### 6 · Renders (Rule 13)

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

#### 7 · What is NOT verified, and what I did not touch

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



## 2.3 · Phase 4 · canonical initial authoring + cold start

### Phase 4 — complete canonical initial authoring

Branch `p0/authoring`, pushed to `origin/p0/authoring` at `ff9de49f`.
Base: `origin/main` (`a5367a38`, merged in at `e048b22d`).

#### Commits

| sha | what |
|---|---|
| `c498e9b0` | merge `origin/canonical-authoring-migration-20260901` (8641a234) |
| `37a12b45` | merge `origin/cold-start-prior-fix-20260901` (5017962c) |
| `236d83e1` | A + B · continuous `user_prior` blend, typed-PR rung, canonical pace authoring |
| `e4e85f3e` | C · CANNOT-CONVERGE-1 — a plan with no measured VDOT is re-priced, and alerted |
| `047642aa` | D + E · shadow compare rebuilt, five report errors fixed, corpus reaches the layer |
| `085f9519` | gate · allowlist the shadow-compare module in `check-derived-consistency` |
| `e048b22d` | merge current `origin/main` |
| `ff9de49f` | fix · keep the long-run time cap on the CAPACITY band, not the prescription-padded one |

Both branches merged clean, as the audit predicted (one auto-merged file,
`generated-content-registry.ts`).

---

#### A · Cold start

##### The 188 s/mi cliff, replaced by a blend

`priorWeeklyMi` (`lib/training/capacity-resolver.ts`) no longer switches at
`real > 0`. It blends:

```
weeklyMi = coverage · real + (1 − coverage) · selfReport
coverage = min(1, runDays / USER_PRIOR_COVERAGE_SATURATION_RUN_DAYS)   // 16
```

`runDays` is the count of Rule 8-filtered representative days the runner
actually ran on — a new second half of the SAME read
(`normalWeeklyMileageDetail`, `lib/training/normal-window.ts`), so the rate and
the coverage cannot disagree. `normalWeeklyMileage` now delegates to it.

Coverage, not value: weighting by how close real mileage is to the self-report
would mean a runner honestly training 10 mi/wk after typing 40 never escapes
their own onboarding chip.

The `sourceMode` flip from `user_prior` to `population_prior` happens at
coverage = 1, where the blend has already converged on `real` — so the discrete
label change cannot move a pace.

##### The typed-PR rung

New module `lib/training/self-reported-pr.ts`, wired at
`composeThresholdCapacity` / `composeHighIntensityCapacity` tier 4 only (never
when a measured VDOT or a below-table anchor exists).

- **Validated.** `PR_MIN_PLAUSIBLE_PACE_S_PER_MI` 240 (4:00/mi), max 1200
  (20:00/mi), distance/time/when parsed, VDOT must land on the [30,85] table.
  Failures are `PrRejection` codes, surfaced as `ONBOARDING_PR_REJECTED`.
- **Conservative.** `USER_PR_MAX_WEIGHT = 0.60`, applied as a shrinkage toward
  the mileage prior — never a substitution.
- **Continuous authority.** `prPriorWeight = 0.60 × freshness × (1 − coverage)`.
  `USER_PR_HALF_LIFE_DAYS = 365`, deliberately NOT the 28-day confidence
  half-life (Rule 16 — one ages an observation, the other ages a statement
  about who the runner is). Replaces legacy `PARITY-1`'s hard 180-day cut.
- **Never `direct` / `race_derived`.** `user_prior`, confidence 0.15,
  `evidenceIds: []`, reason `ONBOARDING_PR_USER_PRIOR`.

##### Answered-zero

`ONBOARDING_MILEAGE_ANSWERED_ZERO` — the distinction
`loadOnboardingWeeklyMiPrior`'s own header promised and the `> 0` gate erased
one function later (Rule 20's prose corollary).

##### The cold-start fixture table

`lib/training/_cold_start_fixtures.test.ts`, printed on every run:

| fixture | threshold | easy ceiling | interval | mode | conf |
|---|---|---|---|---|---|
| zero-run · nothing answered | 10:42/mi | 12:02/mi | 9:53/mi | population_prior | 0.10 |
| zero-run · answered "I do not run yet" | 10:42/mi | 12:02/mi | 9:53/mi | population_prior | 0.10 |
| no-PR · 20 mi/wk self-report | 9:23/mi | 10:43/mi | 8:41/mi | user_prior | 0.15 |
| invalid-PR · + a 40-minute marathon typed | 9:23/mi | 10:43/mi | 8:41/mi | user_prior | 0.15 |
| typed-PR · + a recent 1:30 half | **8:04/mi** | 9:24/mi | 7:29/mi | user_prior | 0.15 |
| typed-PR (stale) · same half, 2+ yr ago | **9:11/mi** | 10:31/mi | 8:30/mi | user_prior | 0.15 |
| sparse-history · 1 logged run, 40 self-report | **7:52/mi** | 9:12/mi | 7:18/mi | user_prior | 0.15 |
| sparse-history · 4 logged runs, 40 self-report | 8:23/mi | 9:43/mi | 7:45/mi | user_prior | 0.15 |
| full month logged · 22 real, 40 self-report | 9:23/mi | 10:43/mi | 8:41/mi | population_prior | 0.10 |
| returning runner · measured VDOT, 10 months old | 7:17/mi | 8:37/mi | 6:46/mi | vdot_fallback | 0.20 |

Assertions: every set is ORDERED; only the two genuinely-no-information cases
sit on the VDOT-30 floor; typed / rejected / absent PR are three distinct
answers; **sparse history is never worse than no history** (the audit's Rule 9
signature, inverted); the goal cannot reach any of it (asserted on the input
KEYS, so a future `goalPaceSec` field fails before it can price anything).

##### The continuity walks

Three, in `_capacity_resolver.test.ts`:

- **3e-3b** the blended MILEAGE across real 0 → 40 mi/wk against a 40 mi/wk
  self-report. Worst single step ≤ 1.0 mi. Drives the REAL `priorWeeklyMi`, not
  a re-implementation.
- **3e-3c** the prescribed PACE across the same walk, bounded by the mileage
  ladder's own worst adjacent-rung step, **read out of the ladder at run time**.
- **3e-3d** the same walk with a typed PR on file.

**Falsified:** restoring the `real > 0` switch fails 3e-3, 3e-3c and 3e-3d.
3e-3b initially passed under the switch because it re-implemented the formula;
it now calls the exported `priorWeeklyMi` and fails too.

Test `3e-3` — which asserted the cliff as correct (`okNormal(1)` vs a 40 mi/wk
self-report expecting `population_prior`) — is rewritten. The
evidence-precedence PRINCIPLE it stated is still asserted, as a limit.

**Residual cliff, NOT mine and NOT closed:** `conservativeVdotFromMileage` is
itself a step ladder (30 → 32 at 15 mi/wk, and so on), so a runner crossing a
rung moves by that rung's whole width. It is a pre-existing Rule 9 defect in a
doctrine-bound CONVENTION constant that also moves plan composition; the walks
bound against it rather than pretending it is not there, and say so in the file.

---

#### B · Authoring is canonical

`composePlan`, `composeMaintenancePlan`, `composeRecoveryPlan`,
`persistComposedPlan` and `loadGeneratorInputs` price every zone from
`resolvePrescribedPaceAnchors` — the same seam `recompute-paces.ts` and
`reanchor-plan.ts` already used.

`lib/plan/authoring-anchors.ts` · `syntheticPaceAnchors` runs the IDENTICAL
pure capacity cores for every caller without a database (sweep archetypes,
bench personas, `/sim/plan`, fixtures). One pricing path, two sources for its
bottom rung — never a fallback to the cascade.

##### Deleted

| what | where |
|---|---|
| `blendedTPaceForWeek`, `gatedBlendFraction`, `measuredProgressFraction`, `BLEND_GRACE_FRACTION`, `maxSeasonalVdotGain` | `recompute-paces.ts` |
| the mid-block measured-progress gate (~70 lines) | `composeForUserInternal` |
| `ComposePlanInput.measuredProgressFraction` | `generate.ts` |
| `tPaceSec = min(tPaceFromGoal(goal), currentT)` | `loadGeneratorInputs` |
| the goal input to `resolveMarathonPace` at authoring | `composePlan` |
| `goalIPaceEligible` (the goal-distance-gated I-pace) | `generate.ts`, `persistPlan`, `specForComposedDay` |
| two of three `resolveCurrentTPace` copies | `composePlan`, `persistComposedPlan` |
| `conservativeVdotFromMileage`-as-authority | `composeMaintenancePlan`, `composeRecoveryPlan` |
| `tPaceFromGoal` import | `generate.ts`, `sim-inputs.ts` |

`maxSeasonalVdotGain` was a one-line alias for
`achievable-target.ts#seasonalVdotCeiling`; Race Prediction owns the quantity
outright now (Rule 16).

##### Legitimate VDOT that stays

- The resolvers' own declared fallback rungs.
- `vdotFromRace(goalSec)` for the goal-REALISM flag (prices nothing).
- `achievableRaceTarget`'s input — now `anchors.basis.threshold.vdot`, so the
  race target and the block are read off ONE fitness (Rule 16). Same call site,
  same provisional-anchor gate.

##### The gate

`scripts/check-goal-pace-leak.sh` (wired into `prebuild`, now 18 checks):
scans `lib/plan`, `lib/training`, `lib/prescription` for a training pace
derived from a goal, excluding `lib/training/achievable-target.ts`; comments
stripped so an epitaph is not read as a resurrection; liveness floor; positive
and negative controls before any finding; ratcheted allowlist with argued
reasons; guards the five deleted symbols as REMOVED; asserts the REPLACEMENT is
still wired.

**Falsified three ways** (each restored after):
1. reintroduce `const goalT = tPaceFromGoal(...)` in `composePlan` → FAIL, names the file;
2. break `const currentT = anchors.thresholdSecPerMi;` → FAIL, "no longer prices its threshold from the canonical anchors";
3. re-export `BLEND_GRACE_FRACTION` → FAIL twice (leak + resurrection).

Deleting a stale allowlist entry and re-adding a live one both behaved
correctly (the entry for `authoring-shadow-compare.ts` failed as stale when the
legacy leg was not yet written, and failed as unexplained once it was).

Registry: `EVIDENCE.no-calendar-pace-advance` is rewritten as GUARDED AS
REMOVED (the five symbols, plus the replacement's wiring);
`PACE.marathon-pace-is-not-ramped` re-points at `composePlan`'s
`anchors.marathonSecPerMi` and additionally fails if a goal is handed to
`resolveMarathonPace` again.

##### Race pricing — untouched

`achievableRaceTarget` / `boundedRacePaceSPerMi` call sites,
`prescribedRacePaceSec`, `spec-builder.ts`'s `case 'race'` and
`race_week_tuneup`, `RECOMPUTE_EXEMPT_TYPES`: unchanged. **Measured: the race
row moves 0 s/mi on every real account and across the archetype corpus.**

The only movement is the `achievableRaceTarget` INPUT (canonical VDOT rather
than the legacy cascade's), which shifts the owner's bounded mid-block target
by exactly **1 s/mi** (420 → 421). `_midrace_goal.test.ts` updated with the
argument.

---

#### C · Convergence

- **`reanchor-plan.ts` GUARD 2** no longer returns null for a runner with no
  measured VDOT. `reanchorOffCanonicalPrior` re-prices the block off
  `resolvePrescribedPaceAnchors` and stamps the CANONICAL source mode — never
  `measured_vdot`, and the provisional flag is derived from the mode, so
  nothing is laundered into a measurement. No-op on a plan already authored
  canonically.
- **`persistComposedPlan`** stamps
  `authored_state.pace_authoring = {source:'canonical', authored_directly:true,
  at, anchors:{…, basis}, model}` — Rule 10's stamp, with the basis.
- **`authoring-convergence.ts`** reads that key (its `AUTHORED_CANONICALLY`
  branch was written as "structurally unreachable"; it is reachable now and the
  predicate moved by one key name), and gains a fifth state
  `CANNOT_CONVERGE_NO_CANONICAL_PRICING`.
- **`alertOnUnconvergedPlan`** raises `ops_alerts` `kind: 'plan_convergence'`
  when a live plan carries no canonical pricing `CONVERGENCE_ALERT_AFTER_HOURS`
  (24) after authoring. Called from `snapshot-projections` AFTER the reanchor,
  so it judges what survives the fix.
- **`automatic-mutation-registry.ts`**: the `cron/snapshot-projections` entry
  declares the new writer and `ops_alerts`. `check-automatic-mutations.sh`
  passes.
- **Tests**: `lib/adaptation/_authoring_convergence.test.ts`, 8 assertions
  including a liveness floor and a "the replacement is wired" check.

---

#### D · The comparison

##### Mechanism changes

- Direction inverted: the canonical leg is what ships; the LEGACY leg is now
  the reconstruction (`legacyPricingFor`, `legacyShapedAnchors`,
  `legacySpecForComposedDay`).
- **Both legs RE-COMPOSE** (`composePlan` + `finalizeComposedPlan`), so
  selection, phases, distances and week volumes are compared for the first
  time — the class the old file could not see.
- Aggregates on **|Δ|**, with the signed figure printed beside it; whole-block
  and per-day-type, sorted by volume-weighted |Δ|; band edges computed;
  persisted `distance_mi` compared.
- `compareArchetype` drives the SAME comparison off `syntheticPaceAnchors`, so
  the sweep corpus reaches the canonical layer (Rule 15).
- The silent skip is gone: an always-running liveness block fails unless
  `ALLOW_AUDIT_SKIP=1`.

##### Owner (`cim`, 2026-09-01, 98 composed days)

Anchors: threshold 7:00/mi `direct` 0.79 vdot 49.2 · interval 6:41
`vdot_fallback` 0.50 · easy ceiling 8:22 `direct` 0.63 · shakeout 8:52 ·
marathon 7:43, exponent 1.087, personally evidenced.

| | |
|---|---|
| priced days / miles | 32 / 364.7 |
| mean abs delta | +11 s/mi (signed +2) |
| sum(abs delta x mi) | 4,376 s·mi (signed 2,036) |
| volume-weighted mean abs delta | +12 s/mi |
| MAX abs delta | +16 s/mi, on 11 days, all long runs |

| type | days | mi | mean delta | sum(abs x mi) |
|---|---|---|---|---|
| long | 11 | 172.8 | +16 | 2,765 |
| tempo | 6 | 61.5 | -3 | 752 |
| threshold | 5 | 39.2 | -11 | 439 |
| intervals | 5 | 34.5 | -7 | 421 |
| race | 4 | 51.7 | **0** | **0** |
| race_week_tuneup | 1 | 5.0 | **0** | **0** |

Phases: QUALITY 17d +12 · RACE-SPECIFIC 9d +12 · TAPER 6d +10 (flat — a
pricing change, not a calendar ramp).

Bands: easy x45 8:31-9:11 → 8:22-9:02 (-9) · long x11 8:06-8:41 → 8:22-8:57
(+16) · shakeout x3 9:11-9:41 → 8:52-9:22 (-19).

WU/CD 1.96 / 1.74 mi both legs. `hr_cap_bpm` divergences **0** (asserted).
Persisted `distance_mi` divergences **0**.

Structure: total block volume **606.5 → 605.5 mi (-1.0)**, **2** structural
diffs (wk3 49.2 → 48.7, wk10 55.5 → 55). Phases, long distances, quality
density and day sequences identical.

##### The other three real accounts

| account | mode | legacy T | canonical T | mean abs | vol-wt | struct | hr | dist |
|---|---|---|---|---|---|---|---|---|
| qa-phone-onboard | `user_prior` | 7:56 | **8:39** | +66 | +72 | 7 | 0 | 1 |
| qa-phone-verify | `population_prior` | 10:42 | 10:42 | (0 priced) | | 15 | 0 | 0 |
| qa-race | `user_prior` | 9:23 | 9:23 | +53 | +53 | 22 | 0 | 0 |
| apple-review | `user_prior` | 8:23 | 8:23 | +26 | +29 | 0 | 0 | 0 |

On `main` the canonical leg answered **10:42/mi for all four**. The cold-start
gap is closed on `apple-review` and `qa-race`; `qa-phone-onboard`'s residual is
**43 s/mi** (audit measured 101) and is the deliberate PR shrinkage.

##### Archetype corpus (stride 97, 42 archetypes)

| type | days | mi | sum(abs x mi) | vol-wt mean abs |
|---|---|---|---|---|
| long | 572 | 5,636 | 309,986 | **55.0 s/mi** |
| tempo | 175 | 1,206 | 4,025 | 3.3 |
| threshold | 62 | 412 | 1,180 | 2.9 |
| intervals | 91 | 486 | 707 | 1.5 |
| race_week_tuneup | 66 | 297 | 75 | 0.3 |
| race | 42 | 525 | **0** | **0.0** |

Worst archetype MAX abs delta 55 s/mi (long runs). **2** structural diffs
across the slice. **0** hr divergences. **0** asymmetric-null days.

##### The switch-over check, against production

`plan_workouts`, `pln_9a57561debb776e5`, future rows, read over
`faff_readonly`:

| | live row | canonical authoring |
|---|---|---|
| long `pace_target_s_per_mi` | 520 | **520** |
| easy band `lo` | 502 | **502** |
| shakeout band `lo` | 532 | **532** |

(The task's "T 430" is the live tempo-row minimum; the canonical threshold
anchor resolves to 420 today, which is "the current canonical value" — the
audit measured 7:00/mi on 2026-09-01 against 7:10 on 08-31.)

##### The five named gates

| gate | result |
|---|---|
| `_sweep_allusers.test.ts` | PASS |
| `_maint_invariants.test.ts` | PASS |
| `_dosing_sweep_gate.test.ts` | PASS |
| `_restore_continuity.test.ts` | PASS |
| `_coach_sensible.test.ts` | **1 of 6 RED** — see Open below |

(30 tests across the five; 29 pass.)

##### Report

`docs/reports/canonical-authoring-migration-2026-09-01.md` — a CORRECTED AND
SUPERSEDED section prepended, fixing all five errors with the replacing
numbers; the original body kept verbatim and marked HISTORICAL.

---

#### E · Deletions and hygiene

- `MODULE_ORPHANS` entry for `authoring-shadow-compare.ts` rewritten: it now
  holds the LEGACY reconstruction, which is why it must stay orphaned.
- Two false headers corrected: `prescription-resolver.ts`'s "STILL NOT WIRED:
  generate.ts's full-block authoring path", and `authoring-convergence.ts`'s
  "generate.ts is NOT migrated yet".
- `lib/plan/_null_anchor_reachability.test.ts` — the null-anchor leg in
  `buildWorkoutSpec` **is still reached**, by seven named callers, so it may
  not be deleted. Pinned as a ratchet (an entry that stops calling fails until
  removed); the three migrated callers are asserted to still pass anchors.
- `EMPTIED_BASELINE` tightened 374 → 373.
- `sim-inputs.ts` migrated (it mirrors authoring; leaving the leak there would
  have kept the simulator demonstrating a behaviour production no longer has),
  and now returns `composeInput` so the corpus comparison can drive it.

---

#### Defects found while doing this

1. **`composePaceAnchors` skipped its own §29 clamp on the marathon fallback.**
   For a runner on the population prior `resolveCapacityPrescription` returns
   an `effort` shell with no pace, so `point()` was null and the `??` took the
   RAW `marathonPaceFromDurability` value. The ordering gate then REFUSED any
   runner slower than ~13:20/mi threshold — the one runner the clamp matters
   most for was the one it was skipped for. Fixed in `prescription-resolver.ts`.
2. **`finalizeComposedPlan` reconciled sub_labels against a spec built WITHOUT
   the anchors the persist path uses.** A rep-count clamp is pace-dependent, so
   the label and the row were priced off two different runners (277 of 7,566
   rep-bearing days drifted). Fixed; `_label_truth.test.ts`'s own harness had
   the same fork and is fixed with it.
3. **The compare's first run reported -35.3 mi of block volume and was wrong**
   — the canonical leg arrived finalized and the legacy leg did not.
4. **An early compare passed the canonical VDOT to `achievableRaceTarget`
   unconditionally** and reported a 109 s/mi race "divergence" no shipped plan
   has, because `composePlan` gates that call on the provisional anchor.
5. **`easy_pace_s_per_mi` / `easyPaceSecPerMi` describe a band, and moving them
   onto the prescription-padded ceiling CUT LONG RUNS** for low-confidence
   runners (peak long 22.5 → 21 mi on the David-class fixture). Reverted to the
   capacity band with the argument in the tree — a volume reduction caused by
   the engine being unsure is not a call a wiring pass gets to make.

---

#### Verification

| check | result |
|---|---|
| `npx tsc --noEmit` | clean, on every commit |
| `npm run prebuild` (18 gates) | **PASS** — `PREBUILD_EXIT=0` on the final tree |
| `npx next build` | **PASS** — `BUILD_EXIT=0` on the final tree |
| `scripts/verify-commit.sh ff9de49f` | **CLEAN** (isolated worktree; watch gate N/A — commit touches no watch paths) |
| `npx vitest run` (whole suite, RO env) | **8,016 passed · 3 failed · 10 skipped** across 400 files |

The 3 failures:

- **2 x `lib/evidence/_activity_evidence.audit.test.ts`** — PRE-EXISTING.
  Verified by stashing my work and re-running on the merge base: same 2
  failures. It asserts facts about live production rows (`easy.splits` absent,
  classification `EASY`) that have since moved to `EASY_TO_AEROBIC_STEADY`. Not
  mine; not fixed.
- **1 x `lib/plan/_coach_sensible.test.ts`** — see Open, below.

---

#### OPEN, with reasons

1. **`_coach_sensible.test.ts` · the general-aerobic floor is RED, honestly.**
   With the goal blend deleted, the owner-class fixture is priced at its own
   threshold rather than a goal-blended one; easy pace 9:41/mi; one training
   week of fourteen has a median easy day of 4 mi = **39 min against doctrine's
   40-min general-aerobic floor** (`Research/00a` §2, 40-75 min). This is
   Rule 12's open finding stated in minutes, and CLAUDE.md sanctions this gate
   being red while Rule 12 is open. It passed before only because a
   goal-blended threshold made the assumed easy pace faster. **The migration
   did not create the short easy day; it stopped flattering it.** Closing it is
   Rule 12's own work (price easy days in MINUTES), not a one-liner.

2. **`refreshRaceRowsForPlan` is NOT called.** The Phase 3 coordinator asked
   for `await refreshRaceRowsForPlan(planId, { client, todayISO })` after
   persist. `lib/race/race-row-refresh.ts` does not exist on `origin`
   (`git ls-remote --heads origin` has no `feat/race-pace-brain`), so importing
   it would break `tsc --noEmit` and `next build` and make every verification
   claim in this pass unrunnable. Instead there is an explicit, argued SEAM
   COMMENT at the exact insertion point — **`persistComposedPlan` in
   `web-v2/lib/plan/generate.ts`, inside the `mutatePlan.apply` callback,
   immediately after the `UPDATE training_plans SET mode = $1` write and before
   the commit gate.** Merging Phase 3 on top of this branch is a one-line
   insertion there. No new goal-blend or `achievableRaceTarget`-derived race
   pace was added; the race row measures 0 s/mi of movement everywhere.

3. **`conservativeVdotFromMileage` is a step ladder** (a rung crossing moves a
   runner by up to ~36 s/mi of threshold). Pre-existing Rule 9 defect in a
   doctrine-bound CONVENTION constant that also moves plan composition; the
   walks bound against it and name it rather than smoothing it inside this
   pass. Belongs to whoever owns that table.

4. **Three §G leaks remain, allowlisted with reasons and a ratchet** in
   `check-goal-pace-leak.sh`: `lib/plan/adapt.ts` (adapt-time restore
   fallback — Phase 3's), `lib/training/prescriptions.ts` (the v5 Today display
   pace — the UI phase's), and `lib/plan/spec-builder.ts` (the definition site
   plus the legitimate `case 'race'` branch). Plus
   `lib/plan/authoring-shadow-compare.ts`, which reproduces the leak on purpose
   and cannot persist.

5. **Whether a confidence pad may shorten a long run** — surfaced by defect 5
   above, deliberately not decided here. DOCTRINE-3's owner's call.

6. **The push used `--no-verify`, disclosed.** The pre-push hook's watch gate
   fails in this worktree because `native-v2/Secrets.xcconfig` is gitignored
   and therefore absent (it exists in the root checkout), so `xcodegen` cannot
   generate the project. Purely environmental. `scripts/verify-commit.sh
   ff9de49f` reports CLEAN in its own isolated worktree and states that the
   commit **touches no watch paths, so the hook would have skipped the watch
   gate too**; the hook only reached it because pushing a brand-new branch
   scopes the range to everything. The always-run half (`tsc --noEmit` +
   `next build`) passed there and here.



## 2.4 · Phase 5 · truthful Coaching Thesis

### Phase 5 · the smallest truthful Coaching Thesis

Branch `p0/thesis`, pushed to `origin/p0/thesis`. Base `origin/main` @ `7cac80f0`
(newer than the required `43e15e88`). **Not merged, main untouched.**

---

#### 1 · Commits

| sha | title |
|---|---|
| `c69c8043` | `fix(thesis): the primary limiter stops flipping on an unrelated clock` |
| `bfaf9d9e` | `feat(thesis): wire the Coaching Thesis into Today's "why" and the Block screen` |
| `47182f4f` | `fix(thesis): no \`.catch\` on the thesis resolve, and the Rule 13 renders` |

All three carry the `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer.

Files touched:

```
web-v2/lib/training/coaching-thesis.ts            rewritten
web-v2/lib/training/_coaching_thesis.test.ts      new  (15 tests, Rule 9 walk + falsifier)
web-v2/lib/training/_coaching_thesis.audit.test.ts rewritten (both dates)
web-v2/lib/faff/why-voice.ts                      + thesisLead / thesisSessionName
web-v2/lib/faff/v5-today.ts                       + V5Today.thesis, ctx.thesis
web-v2/app/api/v5/today/route.ts                  thesis resolve + why composition + payload
web-v2/lib/plan/v5-block.ts                       thesis at block level
web-v2/lib/workout-catalogue/select.ts            + rationaleForRow()
web-v2/lib/plan/recompute-paces.ts                rationale write-when-absent only
web-v2/lib/audit/generated-content-registry.ts    MODULE_ORPHANS entry deleted
web-v2/lib/faff/_today_thesis.audit.test.ts       new  (Rule 13 render of the real route)
web-v2/lib/plan/_rationale_backfill.audit.test.ts new  (backfill dry run)
native-v2/.../DesignV5/APIV5.swift                + V5Thesis, V5Today.thesis, V5Block.thesis
native-v2/.../ViewsV5/TodayBeforeV5.swift         About section
native-v2/.../ViewsV5/BlockV5.swift               "Where this goes" section
```

Not touched, as instructed: `lib/race/*`, `race-projection.ts`, `spec-builder.ts`,
`build-workout.ts`, tolerance constants, `capacity-resolver.ts`. `recompute-paces.ts`
is touched only for the rationale write.

---

#### 2 · Task A — the ranking fix

##### What was wrong

`rankCapacities` normalized each capacity's confidence against its **own reachable
ceiling** before comparing: THRESHOLD/DURABILITY by `directCeiling` 0.90,
HIGH_INTENSITY by `fallbackCeiling` 0.50 (it has no direct reader). So
HIGH_INTENSITY's ranked score was

```
0.4 + 0.6 · 2^(−vdotAnchorAgeDays / 28)
```

— a pure function of the age of the best-recent-VDOT anchor. The limiter flipped
HIGH_INTENSITY → THRESHOLD overnight because a *threshold* run refreshed that anchor.

##### What it is now

- `RANKABLE_SOURCE_MODES = ['direct', 'inferred', 'race_derived']`. Anything at
  `vdot_fallback` / `user_prior` / `population_prior` is **UNRANKABLE** with reason
  `NO_DIRECT_READER` and can never be the primary limiter.
- **No normalization of any kind.** Rankable capacities sort ascending on their own
  resolved confidence. A capacity can no longer be promoted toward the limiter slot
  because its reachable ceiling is structurally low.
- `primaryLimiter` may be `'UNKNOWN'`; `confidence` is `number | null`.
- `CapacityStanding`'s unrankable branch carries **no `confidence` field**, so
  `standing.confidence` does not compile until the caller branches — the same
  Rule 11-as-a-type discipline as `NormalReading<T>` / `DurabilityComponent<T>`.
- Durability's sub-reads are **consumed and reported**, not re-derived: the fitted
  race exponent (or `null`, never the prior wearing its name), `POPULATION_ENDURANCE_PRIOR`
  beside it, and the decoupling reading.

##### One thing I did NOT do, and why

**No "durability is above/below neutral" verdict.** The task named "the race
exponent's raw value vs the neutral band". Turning `1.0869 vs 1.06` into a
categorical strength/weakness needs a band around the prior, and **no `Research/`
file states one** — `durability-anchor.ts`'s own header describes the finding in
prose ("his races fit closer to ~1.10 than to 1.06") but exports no classifier, and
nothing else in the repo does either. A bare point comparison at 1.06 would be a
fresh Rule 9 cliff; an invented band would be a physiology-asserting constant needing
a Rule 7 registry entry it cannot honestly get. So the numbers are **reported** on the
DURABILITY standing (auditable, consumable) and the verdict is not manufactured.
Stated in the module header and in the test file's Rule 22 block, not hidden.
**This is a decision the coordinator may want to reverse; it is the one place I
departed from a literal reading of the task.**

---

#### 3 · The two thesis outputs (read-only, owner's real account)

`npx vitest run lib/training/_coaching_thesis.audit.test.ts`, `DATABASE_URL` pinned
to `$DATABASE_URL_RO`.

```
══ COACHING THESIS · todayISO=2026-08-31 ══
  primaryLimiter=THRESHOLD  basis=LOWEST_CONFIDENCE_AMONG_EVIDENCED
  priority=increase_threshold_demand
  confidence=0.727  evidenceIds=["-280549580846348","-226755616416002","-87627419857791"]
  reasons=[LOWEST_CONFIDENCE_AMONG_EVIDENCED, CAPACITY_UNRANKABLE_NO_DIRECT_READER,
           LIMITER_HAS_DIRECT_EVIDENCE, KEY_SESSION_PRESENT_THIS_WEEK]
  standings:
    THRESHOLD      confidence=0.727 sourceMode=direct
    DURABILITY     confidence=0.900 sourceMode=direct
                     [raceExponent=1.0869051877057179 prior=1.06 decoupling=6.411111111111112]
    HIGH_INTENSITY UNRANKABLE (NO_DIRECT_READER) sourceMode=vdot_fallback
  heldConstant:
    DURABILITY [BETTER_EVIDENCED_THAN_THE_LIMITER] holding steady at confidence 0.90
      (direct), which is ahead of the limiter's
    HIGH_INTENSITY [NOT_LOOKED_AT_NO_DIRECT_READER] no direct, inferred or race-derived
      reader exists for this capacity yet (resolved at vdot_fallback), so it is not
      ranked and is not being called a weakness
  reconsiderIf:
    - [LIMITER_CONFIDENCE_OVERTAKEN] DURABILITY's confidence (currently 0.90) falls
      below THRESHOLD's (currently 0.73)
    - [UNRANKABLE_GAINS_A_DIRECT_READER] HIGH_INTENSITY gains a direct, inferred or
      race-derived reader and becomes rankable (it resolves at vdot_fallback today,
      and the ranking admits nothing below direct/inferred/race_derived)
    - [NEW_RACE_RESULT] a new race result changes any capacity's sourceMode, which can
      both admit a capacity to the ranking and move the confidences already in it
  addressedBy (1 session(s) this week):
    2026-09-01 threshold "4×1 mi @ T pace · 1 min jog" serves=MATCHES_LIMITER_FAMILY
      rationale: (none persisted)
  coachLine: Your durability is the best evidenced part of your training right now,
             so it holds. Threshold is where the work goes.
  modelVersion=2.0.0

══ COACHING THESIS · todayISO=2026-09-01 ══
  primaryLimiter=THRESHOLD  basis=LOWEST_CONFIDENCE_AMONG_EVIDENCED
  priority=increase_threshold_demand
  confidence=0.788  evidenceIds=["-280549580846348","-226755616416002"]
  reasons=[LOWEST_CONFIDENCE_AMONG_EVIDENCED, CAPACITY_UNRANKABLE_NO_DIRECT_READER,
           LIMITER_HAS_DIRECT_EVIDENCE, KEY_SESSION_PRESENT_THIS_WEEK]
  standings:
    THRESHOLD      confidence=0.788 sourceMode=direct
    DURABILITY     confidence=0.900 sourceMode=direct
                     [raceExponent=1.0869051877057179 prior=1.06 decoupling=6.411111111111112]
    HIGH_INTENSITY UNRANKABLE (NO_DIRECT_READER) sourceMode=vdot_fallback
  (heldConstant / reconsiderIf identical apart from the live numbers)
  addressedBy (1 session(s) this week):
    2026-09-01 threshold "4×1 mi @ T pace · 1 min jog" serves=MATCHES_LIMITER_FAMILY
      rationale: (none persisted)
  coachLine: Your durability is the best evidenced part of your training right now,
             so it holds. Threshold is where the work goes.
  modelVersion=2.0.0
```

**The limiter no longer moves overnight**, and the audit test asserts that as its
last line rather than leaving it to a reader.

Note the second-order improvement: the session credited on 08-31 is now the
2026-09-01 threshold session (which *can* produce threshold evidence), not the
09-03 hill reps with `pace_target_s_per_mi = NULL` that appendix E Finding 7 flagged
as structurally unable to evidence the capacity it was credited with.

---

#### 4 · The Rule 9 walk

`lib/training/_coaching_thesis.test.ts`, 15 tests, all green.

Walk: hold the owner's real THRESHOLD (0.7268) and DURABILITY (0.90) standings fixed,
move the VDOT anchor age 0 → 30 days in one-day steps, take HIGH_INTENSITY's
confidence from the engine's **own** `fallbackConfidence` (consumed, not re-derived),
and assert the set of limiters seen has exactly one member.

```
distinct limiters across ages 0..30  =  ['THRESHOLD']        ✓
```

**The falsifier** (Rule 18: a gate is a hypothesis until it has been made to fail) is
in the same describe block. It reproduces the deleted basis inline —
`confidence / reachableCeiling` per capacity — and asserts it **does** flip across
the identical walk:

```
distinct limiters, OLD basis, ages 0..30  =  ['HIGH_INTENSITY', 'THRESHOLD']   ✓
```

So the walk cannot go quietly dead: if the old basis ever stops flipping, the
falsifier fails and the file stops claiming something it no longer proves.

Other properties locked in the same file:

- every fallback rung refused / every evidenced rung admitted, as a table;
- a capacity with **higher** confidence on a fallback rung still loses to a lower
  direct one (the exact promotion the normalization used to perform);
- all three unrankable → `UNKNOWN`, `priority = establish_evidence_before_prioritising`,
  and `'confidence' in standing === false` on every standing;
- a durability standing with no personal exponent reports `raceExponent: null`, not
  the prior;
- the coach line carries no em dash, no exclamation mark, no interpunct, ≤ 2 sentences,
  and never mentions a missing engine reader.

---

#### 5 · Payload keys added

One shape, `ThesisWire`, emitted under `thesis` by **both** routes, so the two
surfaces cannot disagree (Rule 16):

| key | type | notes |
|---|---|---|
| `thesis` | object \| null | on `V5Today` and on `V5Block` |
| `thesis.limiter` | `'THRESHOLD' \| 'HIGH_INTENSITY' \| 'DURABILITY' \| 'UNKNOWN'` | |
| `thesis.priority` | `increase_threshold_demand` etc. | |
| `thesis.confidence` | number \| null | quantity, never a sentence |
| `thesis.coachLine` | string | THE composed sentence set |
| `thesis.reviewTrigger` | string | §F's review trigger, coach voice |

Five keys and no more. `standings`, `evidenceIds`, `heldConstant[].note` and the
structured `reconsiderIf[]` stay on the server's `CoachingThesis` — they are how the
sentence was arrived at, not something a runner acts on
(`PRODUCT_UX_SIMPLIFICATION_DOCTRINE`).

**Phone decoder** (`APIV5.swift`): `struct V5Thesis` with an explicit
`enum K: String, CodingKey { case coachLine, reviewTrigger }` — spelled out rather
than left to synthesis so `check-wire-keys.sh` can see the keys at all (its extractor
only reads `enum K` blocks; a synthesised conformance is invisible to it, which is the
green-light-over-an-unwatched-road failure that script's own header describes).
`V5Today.thesis` and `V5Block.thesis` added to their `enum K`s and decoded leniently.

`scripts/check-wire-keys.sh`: **OK · 107 phone keys** (was 104), all resolve in web-v2.

**Rendering, and Rule 17.** The phone decodes only the two fields it draws — no
decorative property. On Today the About section draws `why` **or** `thesis.coachLine`,
never both (they are alternatives: the route composes `why` out of this very thesis).
`reviewTrigger` is drawn **only on Block**, because it is a statement about the block
and Rule 17 is explicit that a sentence which would otherwise repeat per row belongs
to the block.

---

#### 6 · Task C — the rendered "why" copy

Rendered by driving the **real** `GET /api/v5/today` handler against the owner's real
rows over the read-only role (`lib/faff/_today_thesis.audit.test.ts`; only
`requireUserId` is stubbed, and the file says so in its header).

```
══ GET /api/v5/today?date=2026-09-03 ══  status=200
  panel.type  = Intervals        panel.dose = 6.5 mi
  WHY         = "Threshold is the limiter right now, so that is what the block is
                 building toward. Medium hill repeats."
  thesis      = { limiter: THRESHOLD, priority: increase_threshold_demand,
                  confidence: 0.7833333333333334,
                  coachLine: "Your durability is the best evidenced part of your
                              training right now, so it holds. Threshold is where
                              the work goes.",
                  reviewTrigger: "This gets revisited when a new race result lands,
                                  or when the evidence behind your threshold catches
                                  up with the rest." }

══ GET /api/v5/today?date=2026-09-08 ══  status=200
  panel.type  = Tempo            panel.dose = 6.2 mi
  WHY         = "Threshold is the limiter right now, and this is the session that
                 moves it. Continuous tempo."
  thesis      = { limiter: THRESHOLD, priority: increase_threshold_demand,
                  confidence: 0.7550244157414201, coachLine: <as above>,
                  reviewTrigger: <as above> }
```

The two sentences differ in exactly the honest place: the hills day **does not**
address the limiter and does not claim to; the tempo day does. That distinction comes
from `thesis.addressedBy`, not from the day's type.

The body (`Medium hill repeats.` / `Continuous tempo.`) is currently the day's own
note, because `selection_rationale` is absent on all 103 live rows. Once the Phase 6
recompute lands, the same words arrive through `coachSafeSessionName` off the row's
persisted rationale instead — same text, selector provenance.

##### Simulator render (Rule 13, done)

Built the `Faff` scheme (`BUILD SUCCEEDED`, 0 errors), pointed a throwaway build at a
local `next dev` running this branch against the read-only role, installed on the
booted iPhone 17 sim, and read the screen. **The temporary `API.baseURL` patch was
reverted and is not in any commit; the simulator's original app bundle was backed up
before install and restored afterwards.**

`today-0903-about.png` — Today, 2026-09-03, ABOUT section:

> **Threshold is the limiter right now, so that is what the block is building
> toward. Medium hill repeats.**

`block-thesis.png` — Block, "WHERE THIS GOES":

> This is where the fitness gets built. Hit the quality sessions, let the easy days
> stay easy.
>
> **Your durability is the best evidenced part of your training right now, so it
> holds. Threshold is where the work goes.**
>
> *This gets revisited when a new race result lands, or when the evidence behind your
> threshold catches up with the rest.*

Two distinct claims (where in the block / what the block is moving), no repetition,
no new card, no new screen.

Screenshots at `…/scratchpad/p0/today-0903-about.png` and `…/scratchpad/p0/block-thesis.png`.

**2026-09-08 was not rendered on the device**: the training-calendar sheet does not
make next week's rows tappable, and the week strip only covers the current week, so
there is no path to it in the UI. Its payload is above, and the 09-03 render proves
the About section draws `why` verbatim — but the 09-08 *screen* was not looked at.

---

#### 7 · Task D — the `selection_rationale` backfill (NOT run against production)

`preserveProgressionSql` **does** preserve `selection_rationale` already (RATIONALE-
PERSIST-1 widened its fold to `DURABLE_SPEC_KEYS`) — confirmed, and
`_progression_spec.test.ts` 8/8 still green. What it cannot do is *create* one, and
`buildWorkoutSpec` knows nothing about the catalogue, so a recompute could not
regenerate it.

`rationaleForRow(row)` (`lib/workout-catalogue/select.ts`) recomposes the identifying
half of the selector's own line from what the row carries: the catalogue entry's name
is written verbatim into `plan_workouts.notes` by the same selection, so the entry is
resolved by name and the line is rebuilt in the same shape and word order —
**minus** the `"N session(s) eligible, least recently used wins"` clause, which
existed only inside the call that made the choice and is not recoverable. It is
omitted, never guessed. `null` (not a partial guess) on a day the catalogue did not
fill.

`recompute-paces.ts` writes it **only when absent** — a stored rationale is the
selector's own record of a real choice and outranks anything recomposed after the
fact — and stamps `rationales_written` into `authored_state.pace_recompute` so the
effect is observable (Rule 21).

**Dry run on the live block** (`lib/plan/_rationale_backfill.audit.test.ts`,
read-only, writes nothing):

```
rows=103   already carry one=0   would be written=13   correctly refused=90

  2026-09-01 threshold  Cruise intervals (§5.3) · threshold on the threshold slot in QUALITY.
  2026-09-03 intervals  Medium hill repeats (§8.3) · hills on the intervals slot in QUALITY.
  2026-09-08 tempo      Continuous tempo (§5.2) · threshold on the tempo slot in QUALITY.
  2026-09-17 intervals  Long hill repeats (§8.4) · hills on the intervals slot in QUALITY.
  2026-09-22 tempo      Continuous mile cutdowns (§12.5) · cutdown on the tempo slot in QUALITY.
  2026-09-29 threshold  Sub-threshold / Norwegian intervals (§5.4) · threshold on the threshold slot in QUALITY.
  2026-10-01 intervals  800m repeats (§6.4) · vo2max on the intervals slot in QUALITY.
  2026-10-08 intervals  1K cutdowns (§12.3) · cutdown on the intervals slot in QUALITY.
  2026-10-13 threshold  Sub-threshold / Norwegian intervals (§5.4) · threshold on the threshold slot in QUALITY.
  2026-10-15 intervals  Mona fartlek (§9.2) · fartlek on the intervals slot in QUALITY.
  2026-10-20 threshold  Cruise intervals (§5.3) · threshold on the threshold slot in RACE-SPECIFIC.
  2026-10-27 tempo      Continuous mile cutdowns (§12.5) · cutdown on the tempo slot in RACE-SPECIFIC.
  (13th row not printed by the sample cap)
```

The 90 refusals are the easy / long / rest / shakeout days the catalogue never filled.
That is the right answer, not a gap.

##### The command for the coordinator to run in Phase 6

This is a production data write. **I did not run it.** It goes through the normal
recompute path, unchanged in every other respect:

```bash
### from web-v2/, with the WRITE DATABASE_URL (not the RO role)
npx tsx -e "
  import('@/lib/plan/recompute-paces').then(async (m) => {
    const r = await m.recomputePacesForPlan(
      'pln_9a57561debb776e5',
      { source: 'rationale_backfill_2026-09-01' },
    );
    console.log(JSON.stringify(r, null, 2));
  });
"
```

Or, if a route is preferred, whatever admin entry point already invokes
`recomputePacesForPlan` for this plan — the write is a side effect of the normal
recompute and needs no separate backfill endpoint.

Expected: `workouts_updated` in the tens, `rationales_written: 13`. Sealed rows
(those with a logged run on the day) and `RECOMPUTE_EXEMPT_TYPES` are skipped by the
existing filters, so a handful of the 13 may be skipped if they seal before it runs.
Verify afterwards with:

```sql
SELECT count(*) FILTER (WHERE workout_spec ? 'selection_rationale') AS with_rationale,
       count(*) AS total
  FROM plan_workouts WHERE plan_id = 'pln_9a57561debb776e5';
```

---

#### 8 · Task E — deletions

- `normalizedConfidence`, `HIGH_INTENSITY_REACHABLE_CEILING`,
  `DIRECT_REACHABLE_CEILING`, `clamp01`, `CapacityRanking`, `PrimaryLimiterBasis`
  — all gone with the normalization.
- `noteFor()` — replaced by `heldConstantFor()`, which is reason-coded.
- The `establish_threshold_evidence` / `establish_durability_evidence` /
  `establish_high_intensity_evidence` priorities — **unreachable** once a limiter must
  have direct/inferred/race-derived evidence, so deleted (Rule 26). The unevidenced
  case is now `UNKNOWN` + `establish_evidence_before_prioritising`.
  `increase_high_intensity_demand` is now a legitimate branch, because HIGH_INTENSITY
  can only reach `priorityFor` once it has the evidence that posture needs.
- The `MODULE_ORPHANS` entry for `coaching-thesis.ts` — deleted; the gate's staleness
  check would have failed until it was.
- The old audit test's assertions that pinned the ranking to `ranking[0]` /
  `normalizedConfidence` ordering — rewritten to the standings contract.

No test that pinned the flipping behaviour survived; the flipping is now asserted only
inside the falsifier, against a locally reconstructed copy of the deleted basis.

---

#### 9 · Verification

| check | result |
|---|---|
| `npx tsc --noEmit` | clean, after every commit |
| `lib/training/_coaching_thesis.test.ts` | 15/15 |
| `lib/training/_coaching_thesis.audit.test.ts` | 1/1 (both dates) |
| `lib/faff/_today_thesis.audit.test.ts` | 1/1 (real route, both dates) |
| `lib/plan/_rationale_backfill.audit.test.ts` | 1/1 |
| `lib/faff/_why_voice.test.ts`, `_surface_sweep.test.ts` | unchanged, green |
| `lib/plan/_progression_spec.test.ts`, `_rationale_persist.test.ts` | unchanged, green |
| `lib/audit/_generated_content_gate.test.ts` | green after the orphan deletion |
| **full `npx vitest run`** (RO env) | **1 failed file / 2 failed tests — identical to the `main` baseline** (`lib/evidence/_activity_evidence.audit.test.ts`, pre-existing; `main`'s own run: 1 failed file / 2 failed tests). 390 files / 7989 tests passing, up from 387 / 7972. |
| **all 17 prebuild gates** | **exit 0.** palette · spacing · modelled-mark · coach-voice (189 files) · doctrine (323 citations) · wire-keys (107 phone keys) · generated-content · surface-sweep · xcodeproj-sync (214/214) · swallowed-failure · derived-consistency · automatic-mutations · normal-window · goal-immutability · anchor-derivation · client-graph · coercion (peripheral baseline 181, unchanged) |
| `npx next build` | exit 0 |
| `xcodebuild -scheme Faff` (sim) | `** BUILD SUCCEEDED **`, 0 errors |
| watch gate (pre-push hook) | OK · 195 test cases, 20 boards |
| push | `origin/p0/thesis` created, no `--no-verify` needed |

##### Gates falsified (Rule 18)

- **The Rule 9 walk** — falsified by reconstructing the deleted basis inline and
  asserting it flips across the same walk. Green on the fix, and it names the old
  behaviour rather than merely asserting the new one.
- **`_coercion_scan`** — it caught my first draft, correctly, and I removed the two
  `.catch(() => null)` sites rather than arguing them into the registry. That is a
  gate failing on new work and being obeyed, which is the falsification this rule asks
  for.
- **`check-wire-keys`** — the phone key count moved 104 → 107, so the extractor
  demonstrably saw the new keys rather than reporting clean over nothing.

---

#### 10 · What is NOT verified, and open questions

1. **No durability direction verdict.** §3 above. If the coordinator wants
   "durability is above/below neutral" as a real signal, it needs a band with a
   `Research/` citation and a Rule 7 registry entry, and that is a decision, not an
   implementation detail.

2. **2026-09-08 was not rendered on the device.** Payload verified, screen not.
   The UI offers no path to next week's day detail.

3. **The route render stubs `requireUserId`.** Everything below the auth line runs
   for real; a break in authentication on `/api/v5/today` would not show up in a green
   run of that file. Named in its own header.

4. **The backfill has not run.** 13 rows would gain a rationale on the live block; the
   command is in §7. Until it does, every Today "why" body comes from
   `plan_workouts.notes` rather than from the selector's own record — same words on
   these rows, weaker provenance.

5. **`resolveCoachingThesis` now runs on every `/api/v5/today` and `/api/v5/block`
   request.** It resolves three capacities plus settings plus one plan query. On the
   local dev server the first (cold, uncached) `/api/v5/today` took 14 s and the
   second 9 s; that is `next dev` compile time dominating, and the whole route was
   already doing far more DB work than the thesis adds, but **I did not measure the
   added latency in isolation** and the route memo (`withRequestMemo`) does not cover
   the capacity resolvers. Worth a look if Today feels slower in TestFlight.

6. **`.catch` removal is a behaviour change on two live routes.** If
   `resolveCoachingThesis` throws for some runner shape I have not exercised, Today
   and Block now return the data-outage screen instead of drawing without a strategy.
   I argued that is correct (the resolver reads the same DB the routes already read
   uncaught, so a throw means the request was failing anyway), but only the owner's
   account was exercised end to end.

7. **HIGH_INTENSITY is unrankable for every runner today**, by construction, because
   `resolveHighIntensityCapacity` has no direct rung at all. That is the honest state,
   not a bug in this change — but it means the thesis currently ranks two capacities,
   not three, and the app cannot name speed as a limiter until that reader exists. The
   `reconsiderIf` trigger says so as a concrete condition, and the module header states
   it as the first thing this file cannot catch.

8. **Rule 19.** The branch is pushed but **not merged and not deployed**. Nothing here
   is live.



---

# Part 3 · Threshold replay, day by day

Script `web-v2/scripts/p0-proof/threshold-replay.ts`, owner, 2026-06-01 → 2026-09-01. A line beginning `*` is a day the belief changed; the lines under it give the delta, the resolver's reasons, every supporting observation (id, date, pace, weight, representative, HR band, Evidence Engine kind) and every excluded observation with its reason. `CAPPED(prior, uncapped)` marks the daily move cap. The JSON twins (`threshold-replay-before-7cac80f0.json`, `threshold-replay-after-f967cab1.json`) carry the same per-day records.

## 3.1 · BEFORE · the reader at `7cac80f0`

```
* 2026-06-01  T=457s/mi (7:37)  vdot=44.6  conf=0.7951  direct  ids=[17988861079,-1466010895152803,18047997225]
* 2026-06-02  T=430s/mi (7:10)  vdot=47.9  conf=0.8455  direct  ids=[-3558250452245243,17988861079,-1466010895152803]
    Δ -27s/mi from 457 · reasons=DIRECT_CORROBORATED_THRESHOLD_EVIDENCE,THREE_RECENT_CORROBORATING_SESSIONS,OBSERVATIONS_DISAGREE,FRESH_EVIDENCE
* 2026-06-03  T=457s/mi (7:37)  vdot=44.6  conf=0.7951  direct  ids=[-3558250452245243,-1466010895152803,18047997225]
    Δ 27s/mi from 430 · reasons=DIRECT_CORROBORATED_THRESHOLD_EVIDENCE,THREE_RECENT_CORROBORATING_SESSIONS,OBSERVATIONS_DISAGREE,FRESH_EVIDENCE
* 2026-06-04  T=437s/mi (7:17)  vdot=47  conf=0.813  direct  ids=[-3558250452245243,-1466010895152803,-1483290537416636]
    Δ -20s/mi from 457 · reasons=DIRECT_CORROBORATED_THRESHOLD_EVIDENCE,THREE_RECENT_CORROBORATING_SESSIONS,OBSERVATIONS_DISAGREE,FRESH_EVIDENCE
  2026-06-05  T=437s/mi (7:17)  vdot=47  conf=0.8081  direct  ids=[-3558250452245243,-1466010895152803,-1483290537416636]
  2026-06-06  T=437s/mi (7:17)  vdot=47  conf=0.8034  direct  ids=[-3558250452245243,-1466010895152803,-1483290537416636]
  2026-06-07  T=437s/mi (7:17)  vdot=47  conf=0.7987  direct  ids=[-3558250452245243,-1466010895152803,-1483290537416636]
  2026-06-08  T=437s/mi (7:17)  vdot=47  conf=0.7942  direct  ids=[-3558250452245243,-1466010895152803,-1483290537416636]
  2026-06-09  T=437s/mi (7:17)  vdot=47  conf=0.7897  direct  ids=[-3558250452245243,-1466010895152803,-1483290537416636]
  2026-06-10  T=437s/mi (7:17)  vdot=47  conf=0.7854  direct  ids=[-3558250452245243,-1466010895152803,-1483290537416636]
  2026-06-11  T=437s/mi (7:17)  vdot=47  conf=0.7812  direct  ids=[-3558250452245243,-1466010895152803,-1483290537416636]
  2026-06-12  T=437s/mi (7:17)  vdot=47  conf=0.7771  direct  ids=[-3558250452245243,-1466010895152803,-1483290537416636]
  2026-06-13  T=437s/mi (7:17)  vdot=47  conf=0.7731  direct  ids=[-3558250452245243,-1466010895152803,-1483290537416636]
  2026-06-14  T=437s/mi (7:17)  vdot=47  conf=0.7692  direct  ids=[-3558250452245243,-1466010895152803,-1483290537416636]
  2026-06-15  T=437s/mi (7:17)  vdot=47  conf=0.7653  direct  ids=[-3558250452245243,-1466010895152803,-1483290537416636]
* 2026-06-16  T=430s/mi (7:10)  vdot=47.9  conf=0.8427  direct  ids=[-3558250452245243,-27148287813731,-1466010895152803]
    Δ -7s/mi from 437 · reasons=DIRECT_CORROBORATED_THRESHOLD_EVIDENCE,THREE_RECENT_CORROBORATING_SESSIONS,OBSERVATIONS_DISAGREE,FRESH_EVIDENCE
  2026-06-17  T=430s/mi (7:10)  vdot=47.9  conf=0.8378  direct  ids=[-3558250452245243,-27148287813731,-1466010895152803]
* 2026-06-18  T=426s/mi (7:06)  vdot=48.4  conf=0.86  direct  ids=[-3558250452245243,-27148287813731,-251580989059278]
    Δ -4s/mi from 430 · reasons=DIRECT_CORROBORATED_THRESHOLD_EVIDENCE,THREE_RECENT_CORROBORATING_SESSIONS,OBSERVATIONS_AGREE,FRESH_EVIDENCE
  2026-06-19  T=426s/mi (7:06)  vdot=48.4  conf=0.8551  direct  ids=[-3558250452245243,-27148287813731,-251580989059278]
  2026-06-20  T=426s/mi (7:06)  vdot=48.4  conf=0.8503  direct  ids=[-3558250452245243,-27148287813731,-251580989059278]
  2026-06-21  T=426s/mi (7:06)  vdot=48.4  conf=0.8457  direct  ids=[-3558250452245243,-27148287813731,-251580989059278]
  2026-06-22  T=426s/mi (7:06)  vdot=48.4  conf=0.8411  direct  ids=[-3558250452245243,-27148287813731,-251580989059278]
  2026-06-23  T=426s/mi (7:06)  vdot=48.4  conf=0.8367  direct  ids=[-3558250452245243,-27148287813731,-251580989059278]
  2026-06-24  T=426s/mi (7:06)  vdot=48.4  conf=0.8324  direct  ids=[-3558250452245243,-27148287813731,-251580989059278]
  2026-06-25  T=426s/mi (7:06)  vdot=48.4  conf=0.8282  direct  ids=[-3558250452245243,-27148287813731,-251580989059278]
  2026-06-26  T=426s/mi (7:06)  vdot=48.4  conf=0.8241  direct  ids=[-3558250452245243,-27148287813731,-251580989059278]
  2026-06-27  T=426s/mi (7:06)  vdot=48.4  conf=0.82  direct  ids=[-3558250452245243,-27148287813731,-251580989059278]
  2026-06-28  T=426s/mi (7:06)  vdot=48.4  conf=0.8161  direct  ids=[-3558250452245243,-27148287813731,-251580989059278]
  2026-06-29  T=426s/mi (7:06)  vdot=48.4  conf=0.8123  direct  ids=[-3558250452245243,-27148287813731,-251580989059278]
  2026-06-30  T=426s/mi (7:06)  vdot=48.4  conf=0.8086  direct  ids=[-3558250452245243,-27148287813731,-251580989059278]
  2026-07-01  T=426s/mi (7:06)  vdot=48.4  conf=0.805  direct  ids=[-3558250452245243,-27148287813731,-251580989059278]
  2026-07-02  T=426s/mi (7:06)  vdot=48.4  conf=0.8014  direct  ids=[-3558250452245243,-27148287813731,-251580989059278]
  2026-07-03  T=426s/mi (7:06)  vdot=48.4  conf=0.798  direct  ids=[-3558250452245243,-27148287813731,-251580989059278]
  2026-07-04  T=426s/mi (7:06)  vdot=48.4  conf=0.7946  direct  ids=[-3558250452245243,-27148287813731,-251580989059278]
  2026-07-05  T=426s/mi (7:06)  vdot=48.4  conf=0.7913  direct  ids=[-3558250452245243,-27148287813731,-251580989059278]
  2026-07-06  T=426s/mi (7:06)  vdot=48.4  conf=0.7881  direct  ids=[-3558250452245243,-27148287813731,-251580989059278]
* 2026-07-07  T=421s/mi (7:01)  vdot=49  conf=0.8797  direct  ids=[-3558250452245243,-27148287813731,-87627419857791]
    Δ -5s/mi from 426 · reasons=DIRECT_CORROBORATED_THRESHOLD_EVIDENCE,THREE_RECENT_CORROBORATING_SESSIONS,OBSERVATIONS_AGREE,FRESH_EVIDENCE
  2026-07-08  T=421s/mi (7:01)  vdot=49  conf=0.8748  direct  ids=[-3558250452245243,-27148287813731,-87627419857791]
  2026-07-09  T=421s/mi (7:01)  vdot=49  conf=0.8701  direct  ids=[-3558250452245243,-27148287813731,-87627419857791]
  2026-07-10  T=421s/mi (7:01)  vdot=49  conf=0.8654  direct  ids=[-3558250452245243,-27148287813731,-87627419857791]
  2026-07-11  T=421s/mi (7:01)  vdot=49  conf=0.8609  direct  ids=[-3558250452245243,-27148287813731,-87627419857791]
  2026-07-12  T=421s/mi (7:01)  vdot=49  conf=0.8565  direct  ids=[-3558250452245243,-27148287813731,-87627419857791]
  2026-07-13  T=421s/mi (7:01)  vdot=49  conf=0.8521  direct  ids=[-3558250452245243,-27148287813731,-87627419857791]
  2026-07-14  T=421s/mi (7:01)  vdot=49  conf=0.8479  direct  ids=[-3558250452245243,-27148287813731,-87627419857791]
  2026-07-15  T=421s/mi (7:01)  vdot=49  conf=0.8438  direct  ids=[-3558250452245243,-27148287813731,-87627419857791]
* 2026-07-16  T=408s/mi (6:48)  vdot=50.8  conf=0.9  direct  ids=[-3558250452245243,-27148287813731,-280549580846348]
    Δ -13s/mi from 421 · reasons=DIRECT_CORROBORATED_THRESHOLD_EVIDENCE,THREE_RECENT_CORROBORATING_SESSIONS,OBSERVATIONS_AGREE,FRESH_EVIDENCE
* 2026-07-17  T=405s/mi (6:45)  vdot=51.2  conf=0.7928  direct  ids=[-3558250452245243,-27148287813731]
    Δ -3s/mi from 408 · reasons=DIRECT_CORROBORATED_THRESHOLD_EVIDENCE,THREE_RECENT_CORROBORATING_SESSIONS,OBSERVATIONS_AGREE,STALE_EVIDENCE,REEXAMINATION_LOWERED_THE_CORROBORATION_BAR
  2026-07-18  T=405s/mi (6:45)  vdot=51.2  conf=0.7906  direct  ids=[-3558250452245243,-27148287813731]
  2026-07-19  T=405s/mi (6:45)  vdot=51.2  conf=0.7884  direct  ids=[-3558250452245243,-27148287813731]
  2026-07-20  T=405s/mi (6:45)  vdot=51.2  conf=0.7862  direct  ids=[-3558250452245243,-27148287813731]
  2026-07-21  T=405s/mi (6:45)  vdot=51.2  conf=0.7841  direct  ids=[-3558250452245243,-27148287813731]
* 2026-07-22  T=408s/mi (6:48)  vdot=50.8  conf=0.8724  direct  ids=[-3558250452245243,-27148287813731,-280549580846348]
    Δ 3s/mi from 405 · reasons=DIRECT_CORROBORATED_THRESHOLD_EVIDENCE,THREE_RECENT_CORROBORATING_SESSIONS,OBSERVATIONS_AGREE,FRESH_EVIDENCE
  2026-07-23  T=408s/mi (6:48)  vdot=50.8  conf=0.8682  direct  ids=[-3558250452245243,-27148287813731,-280549580846348]
  2026-07-24  T=408s/mi (6:48)  vdot=50.8  conf=0.8641  direct  ids=[-3558250452245243,-27148287813731,-280549580846348]
  2026-07-25  T=408s/mi (6:48)  vdot=50.8  conf=0.8601  direct  ids=[-3558250452245243,-27148287813731,-280549580846348]
  2026-07-26  T=408s/mi (6:48)  vdot=50.8  conf=0.8561  direct  ids=[-3558250452245243,-27148287813731,-280549580846348]
  2026-07-27  T=408s/mi (6:48)  vdot=50.8  conf=0.8523  direct  ids=[-3558250452245243,-27148287813731,-280549580846348]
  2026-07-28  T=408s/mi (6:48)  vdot=50.8  conf=0.8486  direct  ids=[-3558250452245243,-27148287813731,-280549580846348]
  2026-07-29  T=408s/mi (6:48)  vdot=50.8  conf=0.845  direct  ids=[-3558250452245243,-27148287813731,-280549580846348]
  2026-07-30  T=408s/mi (6:48)  vdot=50.8  conf=0.8414  direct  ids=[-3558250452245243,-27148287813731,-280549580846348]
  2026-07-31  T=408s/mi (6:48)  vdot=50.8  conf=0.838  direct  ids=[-3558250452245243,-27148287813731,-280549580846348]
  2026-08-01  T=408s/mi (6:48)  vdot=50.8  conf=0.8346  direct  ids=[-3558250452245243,-27148287813731,-280549580846348]
* 2026-08-02  T=421s/mi (7:01)  vdot=49  conf=0.8116  direct  ids=[-27148287813731,-280549580846348,-87627419857791]
    Δ 13s/mi from 408 · reasons=DIRECT_CORROBORATED_THRESHOLD_EVIDENCE,THREE_RECENT_CORROBORATING_SESSIONS,OBSERVATIONS_AGREE,FRESH_EVIDENCE
  2026-08-03  T=421s/mi (7:01)  vdot=49  conf=0.8084  direct  ids=[-27148287813731,-280549580846348,-87627419857791]
  2026-08-04  T=421s/mi (7:01)  vdot=49  conf=0.8053  direct  ids=[-27148287813731,-280549580846348,-87627419857791]
  2026-08-05  T=421s/mi (7:01)  vdot=49  conf=0.8022  direct  ids=[-27148287813731,-280549580846348,-87627419857791]
* 2026-08-06  T=420s/mi (7:00)  vdot=49.2  conf=0.8897  direct  ids=[-27148287813731,-280549580846348,-226755616416002]
    Δ -1s/mi from 421 · reasons=DIRECT_CORROBORATED_THRESHOLD_EVIDENCE,THREE_RECENT_CORROBORATING_SESSIONS,OBSERVATIONS_AGREE,FRESH_EVIDENCE
  2026-08-07  T=420s/mi (7:00)  vdot=49.2  conf=0.8849  direct  ids=[-27148287813731,-280549580846348,-226755616416002]
  2026-08-08  T=420s/mi (7:00)  vdot=49.2  conf=0.8801  direct  ids=[-27148287813731,-280549580846348,-226755616416002]
  2026-08-09  T=420s/mi (7:00)  vdot=49.2  conf=0.8754  direct  ids=[-27148287813731,-280549580846348,-226755616416002]
  2026-08-10  T=420s/mi (7:00)  vdot=49.2  conf=0.8709  direct  ids=[-27148287813731,-280549580846348,-226755616416002]
  2026-08-11  T=420s/mi (7:00)  vdot=49.2  conf=0.8665  direct  ids=[-27148287813731,-280549580846348,-226755616416002]
  2026-08-12  T=420s/mi (7:00)  vdot=49.2  conf=0.8621  direct  ids=[-27148287813731,-280549580846348,-226755616416002]
  2026-08-13  T=420s/mi (7:00)  vdot=49.2  conf=0.8579  direct  ids=[-27148287813731,-280549580846348,-226755616416002]
  2026-08-14  T=420s/mi (7:00)  vdot=49.2  conf=0.8538  direct  ids=[-27148287813731,-280549580846348,-226755616416002]
  2026-08-15  T=420s/mi (7:00)  vdot=49.2  conf=0.8498  direct  ids=[-27148287813731,-280549580846348,-226755616416002]
* 2026-08-16  T=421s/mi (7:01)  vdot=49  conf=0.8334  direct  ids=[-280549580846348,-226755616416002,-87627419857791]
    Δ 1s/mi from 420 · reasons=DIRECT_CORROBORATED_THRESHOLD_EVIDENCE,THREE_RECENT_CORROBORATING_SESSIONS,OBSERVATIONS_AGREE,FRESH_EVIDENCE
  2026-08-17  T=421s/mi (7:01)  vdot=49  conf=0.8296  direct  ids=[-280549580846348,-226755616416002,-87627419857791]
  2026-08-18  T=421s/mi (7:01)  vdot=49  conf=0.8258  direct  ids=[-280549580846348,-226755616416002,-87627419857791]
  2026-08-19  T=421s/mi (7:01)  vdot=49  conf=0.8222  direct  ids=[-280549580846348,-226755616416002,-87627419857791]
  2026-08-20  T=421s/mi (7:01)  vdot=49  conf=0.8187  direct  ids=[-280549580846348,-226755616416002,-87627419857791]
  2026-08-21  T=421s/mi (7:01)  vdot=49  conf=0.8352  direct  ids=[-280549580846348,-226755616416002,-87627419857791]
  2026-08-22  T=421s/mi (7:01)  vdot=49  conf=0.8318  direct  ids=[-280549580846348,-226755616416002,-87627419857791]
  2026-08-23  T=421s/mi (7:01)  vdot=49  conf=0.8085  direct  ids=[-280549580846348,-226755616416002,-87627419857791]
  2026-08-24  T=421s/mi (7:01)  vdot=49  conf=0.8053  direct  ids=[-280549580846348,-226755616416002,-87627419857791]
  2026-08-25  T=421s/mi (7:01)  vdot=49  conf=0.8022  direct  ids=[-280549580846348,-226755616416002,-87627419857791]
  2026-08-26  T=421s/mi (7:01)  vdot=49  conf=0.7991  direct  ids=[-280549580846348,-226755616416002,-87627419857791]
  2026-08-27  T=421s/mi (7:01)  vdot=49  conf=0.7962  direct  ids=[-280549580846348,-226755616416002,-87627419857791]
  2026-08-28  T=421s/mi (7:01)  vdot=49  conf=0.7933  direct  ids=[-280549580846348,-226755616416002,-87627419857791]
  2026-08-29  T=421s/mi (7:01)  vdot=49  conf=0.7904  direct  ids=[-280549580846348,-226755616416002,-87627419857791]
  2026-08-30  T=421s/mi (7:01)  vdot=49  conf=0.7876  direct  ids=[-280549580846348,-226755616416002,-87627419857791]
* 2026-08-31  T=430s/mi (7:10)  vdot=47.9  conf=0.7268  direct  ids=[-280549580846348,-226755616416002,-87627419857791]
    Δ 9s/mi from 421 · reasons=DIRECT_CORROBORATED_THRESHOLD_EVIDENCE,THREE_RECENT_CORROBORATING_SESSIONS,OBSERVATIONS_AGREE,FRESH_EVIDENCE
* 2026-09-01  T=420s/mi (7:00)  vdot=49.2  conf=0.7884  direct  ids=[-280549580846348,-226755616416002]
    Δ -10s/mi from 430 · reasons=DIRECT_CORROBORATED_THRESHOLD_EVIDENCE,THREE_RECENT_CORROBORATING_SESSIONS,OBSERVATIONS_AGREE,FRESH_EVIDENCE,REEXAMINATION_LOWERED_THE_CORROBORATION_BAR
```

## 3.2 · AFTER · the reader at `f967cab1` (deployed)

```
* 2026-06-01  T=456s/mi (7:36)  vdot=44.7  conf=0.3463  vdot_fallback  ids=[sombrero-half]
  2026-06-02  T=456s/mi (7:36)  vdot=44.7  conf=0.3428  vdot_fallback  ids=[sombrero-half]
  2026-06-03  T=456s/mi (7:36)  vdot=44.7  conf=0.3393  vdot_fallback  ids=[sombrero-half]
* 2026-06-04  T=452s/mi (7:32)  vdot=45.1  conf=0.4855  vdot_fallback  ids=[-3558250452245243]
    Δ -4s/mi from 456 · reasons=NO_DIRECT_EVIDENCE,MEASURED_VDOT_FALLBACK
* 2026-06-05  T=456s/mi (7:36)  vdot=44.7  conf=0.3325  vdot_fallback  ids=[sombrero-half]
    Δ 4s/mi from 452 · reasons=NO_DIRECT_EVIDENCE,MEASURED_VDOT_FALLBACK
  2026-06-06  T=456s/mi (7:36)  vdot=44.7  conf=0.3293  vdot_fallback  ids=[sombrero-half]
  2026-06-07  T=456s/mi (7:36)  vdot=44.7  conf=0.3261  vdot_fallback  ids=[sombrero-half]
  2026-06-08  T=456s/mi (7:36)  vdot=44.7  conf=0.3231  vdot_fallback  ids=[sombrero-half]
* 2026-06-09  T=430s/mi (7:10)  vdot=47.8  conf=0.4523  vdot_fallback  ids=[-3558250452245243]
    Δ -26s/mi from 456 · reasons=NO_DIRECT_EVIDENCE,MEASURED_VDOT_FALLBACK
  2026-06-10  T=430s/mi (7:10)  vdot=47.8  conf=0.4461  vdot_fallback  ids=[-3558250452245243]
* 2026-06-11  T=455s/mi (7:35)  vdot=44.8  conf=0.8  direct  ids=[-182722411215424,-92768649631212]  CAPPED(prior 460, uncapped 440)
    Δ 25s/mi from 430 · reasons=DIRECT_CORROBORATED_THRESHOLD_EVIDENCE,SPARSE_CORROBORATION,OBSERVATIONS_AGREE,FRESH_EVIDENCE,REEXAMINATION_LOWERED_THE_CORROBORATION_BAR,SINGLE_SESSION_MOVE_CAPPED
    supporting: [{"id":"-182722411215424","date":"2026-06-09","pace":438,"w":1,"rep":true,"hr":"in_band","ee":"evidence"},{"id":"-92768649631212","date":"2026-06-11","pace":440,"w":1,"rep":true,"hr":"in_band","ee":"evidence"}]
    excluded: [{"id":"-1135018536585133","date":"2026-05-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17988861079","date":"2026-04-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-223275054","date":"2026-05-06","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-164879313431759","date":"2026-05-27","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-266958841059441","date":"2026-06-07","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-243713397221312","date":"2026-06-08","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-1010945655","date":"2026-04-29","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-4100288002784906","date":"2026-05-19","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18058896921","date":"2026-04-10","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17712636356","date":"2026-03-13","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17567906751","date":"2026-03-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1722688244","date":"2026-04-26","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2029406939","date":"2026-05-13","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1378831178","date":"2026-05-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-665301223","date":"2026-05-08","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-522630830","date":"2026-05-03","reason":"NO_QUALIFYING_SEGMENT"},{"id":"-1251512475","date":"2026-05-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1141962844","date":"2026-05-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-90172438","date":"2026-04-23","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17699939721","date":"2026-03-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17390698520","date":"2026-02-13","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17367191719","date":"2026-02-11","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-3558250452245243","date":"2026-06-02","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17455815127","date":"2026-02-19","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17990892823","date":"2026-04-05","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-241421579595571","date":"2026-05-29","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2987651096082307","date":"2026-06-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18084159177","date":"2026-04-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18125737240","date":"2026-04-15","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-254369820","date":"2026-05-15","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1109157298233570","date":"2026-05-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-3858000542489904","date":"2026-06-03","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-255472024","date":"2026-05-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17416695547","date":"2026-02-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-514138731845836","date":"2026-05-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1521382352","date":"2026-05-17","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2818378315677006","date":"2026-05-22","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17510972527","date":"2026-02-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2045716995500221","date":"2026-05-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17548470709","date":"2026-02-27","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1488380974","date":"2026-05-25","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-573194905917117","date":"2026-05-26","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17617971096","date":"2026-03-05","reason":"SESSION_BELOW_DURATION_FLOOR"},{"id":"-1466010895152803","date":"2026-05-31","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17746760747","date":"2026-03-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1483290537416636","date":"2026-06-04","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2142575830045023","date":"2026-06-05","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"17932871719","date":"2026-03-31","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-70333530507729","date":"2026-06-10","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"18048347952","date":"2026-04-09","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18006986135","date":"2026-04-06","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17944754521","date":"2026-04-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-3363396946462586","date":"2026-05-20","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17408461363","date":"2026-02-15","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18113279996","date":"2026-04-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18139504301","date":"2026-04-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18226742240","date":"2026-04-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18563126474","date":"2026-05-18","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17524965305","date":"2026-02-25","reason":"SESSION_BELOW_DURATION_FLOOR"},{"id":"17956464291","date":"2026-04-02","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17892279941","date":"2026-03-28","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17712645121","date":"2026-03-11","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17377505617","date":"2026-02-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17807724142","date":"2026-03-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1684834858","date":"2026-04-25","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18163053621","date":"2026-04-18","reason":"NO_QUALIFYING_SEGMENT"},{"id":"17596135564","date":"2026-03-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17665883608","date":"2026-03-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17486178424","date":"2026-02-22","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17797203117","date":"2026-03-20","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17787200683","date":"2026-03-19","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17849178980","date":"2026-03-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17665883469","date":"2026-03-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17467164488","date":"2026-02-20","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17654375467","date":"2026-03-08","reason":"LABEL_RACE"},{"id":"17855259593","date":"2026-03-25","reason":"OUTSIDE_LOOKBACK_WINDOW"},{"id":"17446885421","date":"2026-02-18","reason":"OUTSIDE_LOOKBACK_WINDOW"},{"id":"18047997225","date":"2026-04-08","reason":"OUTSIDE_LOOKBACK_WINDOW"}]
* 2026-06-12  T=450s/mi (7:30)  vdot=45.4  conf=0.7951  direct  ids=[-182722411215424,-92768649631212]  CAPPED(prior 460, uncapped 440)
    Δ -5s/mi from 455 · reasons=DIRECT_CORROBORATED_THRESHOLD_EVIDENCE,SPARSE_CORROBORATION,OBSERVATIONS_AGREE,FRESH_EVIDENCE,REEXAMINATION_LOWERED_THE_CORROBORATION_BAR,SINGLE_SESSION_MOVE_CAPPED
    supporting: [{"id":"-182722411215424","date":"2026-06-09","pace":438,"w":1,"rep":true,"hr":"in_band","ee":"evidence"},{"id":"-92768649631212","date":"2026-06-11","pace":440,"w":1,"rep":true,"hr":"in_band","ee":"evidence"}]
    excluded: [{"id":"-1135018536585133","date":"2026-05-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17988861079","date":"2026-04-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-223275054","date":"2026-05-06","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-164879313431759","date":"2026-05-27","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-266958841059441","date":"2026-06-07","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-243713397221312","date":"2026-06-08","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-1010945655","date":"2026-04-29","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-4100288002784906","date":"2026-05-19","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18058896921","date":"2026-04-10","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17712636356","date":"2026-03-13","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17567906751","date":"2026-03-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1722688244","date":"2026-04-26","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2029406939","date":"2026-05-13","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1378831178","date":"2026-05-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-665301223","date":"2026-05-08","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-522630830","date":"2026-05-03","reason":"NO_QUALIFYING_SEGMENT"},{"id":"-1251512475","date":"2026-05-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1141962844","date":"2026-05-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-90172438","date":"2026-04-23","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17699939721","date":"2026-03-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17390698520","date":"2026-02-13","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-3558250452245243","date":"2026-06-02","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17455815127","date":"2026-02-19","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17990892823","date":"2026-04-05","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-241421579595571","date":"2026-05-29","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2987651096082307","date":"2026-06-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18084159177","date":"2026-04-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18125737240","date":"2026-04-15","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-254369820","date":"2026-05-15","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1109157298233570","date":"2026-05-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-3858000542489904","date":"2026-06-03","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-255472024","date":"2026-05-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17416695547","date":"2026-02-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-514138731845836","date":"2026-05-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1521382352","date":"2026-05-17","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2818378315677006","date":"2026-05-22","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17510972527","date":"2026-02-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2045716995500221","date":"2026-05-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17548470709","date":"2026-02-27","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1488380974","date":"2026-05-25","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-573194905917117","date":"2026-05-26","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17617971096","date":"2026-03-05","reason":"SESSION_BELOW_DURATION_FLOOR"},{"id":"-1466010895152803","date":"2026-05-31","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17746760747","date":"2026-03-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1483290537416636","date":"2026-06-04","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2142575830045023","date":"2026-06-05","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"17932871719","date":"2026-03-31","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-70333530507729","date":"2026-06-10","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"18048347952","date":"2026-04-09","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18006986135","date":"2026-04-06","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17944754521","date":"2026-04-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-3363396946462586","date":"2026-05-20","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17408461363","date":"2026-02-15","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18113279996","date":"2026-04-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18139504301","date":"2026-04-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18226742240","date":"2026-04-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18563126474","date":"2026-05-18","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17524965305","date":"2026-02-25","reason":"SESSION_BELOW_DURATION_FLOOR"},{"id":"17956464291","date":"2026-04-02","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17892279941","date":"2026-03-28","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17712645121","date":"2026-03-11","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17377505617","date":"2026-02-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17807724142","date":"2026-03-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1684834858","date":"2026-04-25","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18163053621","date":"2026-04-18","reason":"NO_QUALIFYING_SEGMENT"},{"id":"17596135564","date":"2026-03-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17665883608","date":"2026-03-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17486178424","date":"2026-02-22","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17797203117","date":"2026-03-20","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17787200683","date":"2026-03-19","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17849178980","date":"2026-03-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17665883469","date":"2026-03-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17467164488","date":"2026-02-20","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17654375467","date":"2026-03-08","reason":"LABEL_RACE"},{"id":"17855259593","date":"2026-03-25","reason":"OUTSIDE_LOOKBACK_WINDOW"},{"id":"17446885421","date":"2026-02-18","reason":"OUTSIDE_LOOKBACK_WINDOW"},{"id":"18047997225","date":"2026-04-08","reason":"OUTSIDE_LOOKBACK_WINDOW"}]
* 2026-06-13  T=445s/mi (7:25)  vdot=46  conf=0.7903  direct  ids=[-182722411215424,-92768649631212]  CAPPED(prior 460, uncapped 440)
    Δ -5s/mi from 450 · reasons=DIRECT_CORROBORATED_THRESHOLD_EVIDENCE,SPARSE_CORROBORATION,OBSERVATIONS_AGREE,FRESH_EVIDENCE,REEXAMINATION_LOWERED_THE_CORROBORATION_BAR,SINGLE_SESSION_MOVE_CAPPED
    supporting: [{"id":"-182722411215424","date":"2026-06-09","pace":438,"w":1,"rep":true,"hr":"in_band","ee":"evidence"},{"id":"-92768649631212","date":"2026-06-11","pace":440,"w":1,"rep":true,"hr":"in_band","ee":"evidence"}]
    excluded: [{"id":"-1135018536585133","date":"2026-05-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17988861079","date":"2026-04-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-223275054","date":"2026-05-06","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-164879313431759","date":"2026-05-27","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-266958841059441","date":"2026-06-07","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-243713397221312","date":"2026-06-08","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-1010945655","date":"2026-04-29","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-4100288002784906","date":"2026-05-19","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18058896921","date":"2026-04-10","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17712636356","date":"2026-03-13","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17567906751","date":"2026-03-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1722688244","date":"2026-04-26","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2029406939","date":"2026-05-13","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1378831178","date":"2026-05-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-665301223","date":"2026-05-08","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-522630830","date":"2026-05-03","reason":"NO_QUALIFYING_SEGMENT"},{"id":"-1251512475","date":"2026-05-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1141962844","date":"2026-05-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-90172438","date":"2026-04-23","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17699939721","date":"2026-03-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17390698520","date":"2026-02-13","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-3558250452245243","date":"2026-06-02","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17455815127","date":"2026-02-19","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17990892823","date":"2026-04-05","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-241421579595571","date":"2026-05-29","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2987651096082307","date":"2026-06-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18084159177","date":"2026-04-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18125737240","date":"2026-04-15","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-254369820","date":"2026-05-15","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1109157298233570","date":"2026-05-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-3858000542489904","date":"2026-06-03","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-255472024","date":"2026-05-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17416695547","date":"2026-02-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-514138731845836","date":"2026-05-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1521382352","date":"2026-05-17","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2818378315677006","date":"2026-05-22","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17510972527","date":"2026-02-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2045716995500221","date":"2026-05-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17548470709","date":"2026-02-27","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1488380974","date":"2026-05-25","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-573194905917117","date":"2026-05-26","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17617971096","date":"2026-03-05","reason":"SESSION_BELOW_DURATION_FLOOR"},{"id":"-1466010895152803","date":"2026-05-31","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17746760747","date":"2026-03-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1483290537416636","date":"2026-06-04","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2142575830045023","date":"2026-06-05","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"17932871719","date":"2026-03-31","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-70333530507729","date":"2026-06-10","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"18048347952","date":"2026-04-09","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18006986135","date":"2026-04-06","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17944754521","date":"2026-04-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-3363396946462586","date":"2026-05-20","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17408461363","date":"2026-02-15","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18113279996","date":"2026-04-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18139504301","date":"2026-04-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18226742240","date":"2026-04-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18563126474","date":"2026-05-18","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17524965305","date":"2026-02-25","reason":"SESSION_BELOW_DURATION_FLOOR"},{"id":"17956464291","date":"2026-04-02","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17892279941","date":"2026-03-28","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17712645121","date":"2026-03-11","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17807724142","date":"2026-03-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1684834858","date":"2026-04-25","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18163053621","date":"2026-04-18","reason":"NO_QUALIFYING_SEGMENT"},{"id":"17596135564","date":"2026-03-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17665883608","date":"2026-03-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17486178424","date":"2026-02-22","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17797203117","date":"2026-03-20","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17787200683","date":"2026-03-19","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17849178980","date":"2026-03-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17665883469","date":"2026-03-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17467164488","date":"2026-02-20","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17654375467","date":"2026-03-08","reason":"LABEL_RACE"},{"id":"17855259593","date":"2026-03-25","reason":"OUTSIDE_LOOKBACK_WINDOW"},{"id":"17446885421","date":"2026-02-18","reason":"OUTSIDE_LOOKBACK_WINDOW"},{"id":"18047997225","date":"2026-04-08","reason":"OUTSIDE_LOOKBACK_WINDOW"}]
* 2026-06-14  T=440s/mi (7:20)  vdot=46.6  conf=0.7857  direct  ids=[-182722411215424,-92768649631212]
    Δ -5s/mi from 445 · reasons=DIRECT_CORROBORATED_THRESHOLD_EVIDENCE,SPARSE_CORROBORATION,OBSERVATIONS_AGREE,FRESH_EVIDENCE,REEXAMINATION_LOWERED_THE_CORROBORATION_BAR
    supporting: [{"id":"-182722411215424","date":"2026-06-09","pace":438,"w":1,"rep":true,"hr":"in_band","ee":"evidence"},{"id":"-92768649631212","date":"2026-06-11","pace":440,"w":1,"rep":true,"hr":"in_band","ee":"evidence"}]
    excluded: [{"id":"-1135018536585133","date":"2026-05-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17988861079","date":"2026-04-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-223275054","date":"2026-05-06","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-164879313431759","date":"2026-05-27","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-226447289863060","date":"2026-06-14","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-266958841059441","date":"2026-06-07","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-243713397221312","date":"2026-06-08","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-1010945655","date":"2026-04-29","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-4100288002784906","date":"2026-05-19","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18058896921","date":"2026-04-10","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17712636356","date":"2026-03-13","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17567906751","date":"2026-03-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1722688244","date":"2026-04-26","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2029406939","date":"2026-05-13","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1378831178","date":"2026-05-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-665301223","date":"2026-05-08","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-522630830","date":"2026-05-03","reason":"NO_QUALIFYING_SEGMENT"},{"id":"-1251512475","date":"2026-05-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1141962844","date":"2026-05-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-90172438","date":"2026-04-23","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17699939721","date":"2026-03-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-3558250452245243","date":"2026-06-02","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17455815127","date":"2026-02-19","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17990892823","date":"2026-04-05","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-241421579595571","date":"2026-05-29","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2987651096082307","date":"2026-06-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18084159177","date":"2026-04-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18125737240","date":"2026-04-15","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-254369820","date":"2026-05-15","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1109157298233570","date":"2026-05-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-3858000542489904","date":"2026-06-03","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-255472024","date":"2026-05-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17416695547","date":"2026-02-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-514138731845836","date":"2026-05-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1521382352","date":"2026-05-17","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2818378315677006","date":"2026-05-22","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17510972527","date":"2026-02-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2045716995500221","date":"2026-05-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17548470709","date":"2026-02-27","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1488380974","date":"2026-05-25","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-573194905917117","date":"2026-05-26","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17617971096","date":"2026-03-05","reason":"SESSION_BELOW_DURATION_FLOOR"},{"id":"-1466010895152803","date":"2026-05-31","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17746760747","date":"2026-03-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1483290537416636","date":"2026-06-04","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2142575830045023","date":"2026-06-05","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"17932871719","date":"2026-03-31","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-70333530507729","date":"2026-06-10","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"18048347952","date":"2026-04-09","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18006986135","date":"2026-04-06","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17944754521","date":"2026-04-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-3363396946462586","date":"2026-05-20","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17408461363","date":"2026-02-15","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18113279996","date":"2026-04-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18139504301","date":"2026-04-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18226742240","date":"2026-04-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18563126474","date":"2026-05-18","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17524965305","date":"2026-02-25","reason":"SESSION_BELOW_DURATION_FLOOR"},{"id":"17956464291","date":"2026-04-02","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17892279941","date":"2026-03-28","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17712645121","date":"2026-03-11","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17807724142","date":"2026-03-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1684834858","date":"2026-04-25","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18163053621","date":"2026-04-18","reason":"NO_QUALIFYING_SEGMENT"},{"id":"17596135564","date":"2026-03-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17665883608","date":"2026-03-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17486178424","date":"2026-02-22","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17797203117","date":"2026-03-20","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17787200683","date":"2026-03-19","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17849178980","date":"2026-03-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17665883469","date":"2026-03-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17467164488","date":"2026-02-20","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17654375467","date":"2026-03-08","reason":"LABEL_RACE"},{"id":"17855259593","date":"2026-03-25","reason":"OUTSIDE_LOOKBACK_WINDOW"},{"id":"17446885421","date":"2026-02-18","reason":"OUTSIDE_LOOKBACK_WINDOW"},{"id":"18047997225","date":"2026-04-08","reason":"OUTSIDE_LOOKBACK_WINDOW"}]
  2026-06-15  T=440s/mi (7:20)  vdot=46.6  conf=0.7811  direct  ids=[-182722411215424,-92768649631212]
  2026-06-16  T=440s/mi (7:20)  vdot=46.6  conf=0.7767  direct  ids=[-182722411215424,-92768649631212]
* 2026-06-17  T=430s/mi (7:10)  vdot=47.8  conf=0.4069  vdot_fallback  ids=[-3558250452245243]
    Δ -10s/mi from 440 · reasons=NO_DIRECT_EVIDENCE,MEASURED_VDOT_FALLBACK
* 2026-06-18  T=440s/mi (7:20)  vdot=46.6  conf=0.7938  direct  ids=[-251580989059278,-182722411215424,-92768649631212]
    Δ 10s/mi from 430 · reasons=DIRECT_CORROBORATED_THRESHOLD_EVIDENCE,SPARSE_CORROBORATION,OBSERVATIONS_AGREE,FRESH_EVIDENCE
    supporting: [{"id":"-251580989059278","date":"2026-06-18","pace":426,"w":1,"rep":true,"hr":"in_band","ee":"evidence"},{"id":"-182722411215424","date":"2026-06-09","pace":438,"w":1,"rep":true,"hr":"in_band","ee":"evidence"},{"id":"-92768649631212","date":"2026-06-11","pace":440,"w":1,"rep":true,"hr":"in_band","ee":"evidence"}]
    excluded: [{"id":"-1135018536585133","date":"2026-05-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17988861079","date":"2026-04-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-223275054","date":"2026-05-06","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-164879313431759","date":"2026-05-27","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-226447289863060","date":"2026-06-14","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-266958841059441","date":"2026-06-07","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-243713397221312","date":"2026-06-08","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-1010945655","date":"2026-04-29","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-4100288002784906","date":"2026-05-19","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18058896921","date":"2026-04-10","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17712636356","date":"2026-03-13","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17567906751","date":"2026-03-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1722688244","date":"2026-04-26","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2029406939","date":"2026-05-13","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1378831178","date":"2026-05-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-665301223","date":"2026-05-08","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-522630830","date":"2026-05-03","reason":"NO_QUALIFYING_SEGMENT"},{"id":"-1251512475","date":"2026-05-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1141962844","date":"2026-05-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-90172438","date":"2026-04-23","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17699939721","date":"2026-03-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-3558250452245243","date":"2026-06-02","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17455815127","date":"2026-02-19","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17990892823","date":"2026-04-05","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-241421579595571","date":"2026-05-29","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2987651096082307","date":"2026-06-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18084159177","date":"2026-04-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18125737240","date":"2026-04-15","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-254369820","date":"2026-05-15","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1109157298233570","date":"2026-05-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-3858000542489904","date":"2026-06-03","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-255472024","date":"2026-05-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-514138731845836","date":"2026-05-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1521382352","date":"2026-05-17","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2818378315677006","date":"2026-05-22","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17510972527","date":"2026-02-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2045716995500221","date":"2026-05-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17548470709","date":"2026-02-27","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1488380974","date":"2026-05-25","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-573194905917117","date":"2026-05-26","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17617971096","date":"2026-03-05","reason":"SESSION_BELOW_DURATION_FLOOR"},{"id":"-1466010895152803","date":"2026-05-31","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17746760747","date":"2026-03-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1483290537416636","date":"2026-06-04","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2142575830045023","date":"2026-06-05","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"17932871719","date":"2026-03-31","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-70333530507729","date":"2026-06-10","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"18048347952","date":"2026-04-09","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-27148287813731","date":"2026-06-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18006986135","date":"2026-04-06","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17944754521","date":"2026-04-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-20211252944965","date":"2026-06-15","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-142898519593835","date":"2026-06-17","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-3363396946462586","date":"2026-05-20","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18113279996","date":"2026-04-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18139504301","date":"2026-04-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18226742240","date":"2026-04-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18563126474","date":"2026-05-18","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17524965305","date":"2026-02-25","reason":"SESSION_BELOW_DURATION_FLOOR"},{"id":"17956464291","date":"2026-04-02","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17892279941","date":"2026-03-28","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17712645121","date":"2026-03-11","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17807724142","date":"2026-03-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1684834858","date":"2026-04-25","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18163053621","date":"2026-04-18","reason":"NO_QUALIFYING_SEGMENT"},{"id":"17596135564","date":"2026-03-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17665883608","date":"2026-03-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17486178424","date":"2026-02-22","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17797203117","date":"2026-03-20","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17787200683","date":"2026-03-19","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17849178980","date":"2026-03-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17665883469","date":"2026-03-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17467164488","date":"2026-02-20","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17654375467","date":"2026-03-08","reason":"LABEL_RACE"},{"id":"17855259593","date":"2026-03-25","reason":"OUTSIDE_LOOKBACK_WINDOW"},{"id":"17446885421","date":"2026-02-18","reason":"OUTSIDE_LOOKBACK_WINDOW"},{"id":"18047997225","date":"2026-04-08","reason":"OUTSIDE_LOOKBACK_WINDOW"}]
  2026-06-19  T=440s/mi (7:20)  vdot=46.6  conf=0.7889  direct  ids=[-251580989059278,-182722411215424,-92768649631212]
  2026-06-20  T=440s/mi (7:20)  vdot=46.6  conf=0.7842  direct  ids=[-251580989059278,-182722411215424,-92768649631212]
  2026-06-21  T=440s/mi (7:20)  vdot=46.6  conf=0.7795  direct  ids=[-251580989059278,-182722411215424,-92768649631212]
  2026-06-22  T=440s/mi (7:20)  vdot=46.6  conf=0.775  direct  ids=[-251580989059278,-182722411215424,-92768649631212]
* 2026-06-23  T=438s/mi (7:18)  vdot=46.8  conf=0.82  direct  ids=[-251580989059278,-2351254210708,-182722411215424]
    Δ -2s/mi from 440 · reasons=DIRECT_CORROBORATED_THRESHOLD_EVIDENCE,THREE_RECENT_CORROBORATING_SESSIONS,OBSERVATIONS_AGREE,FRESH_EVIDENCE
    supporting: [{"id":"-251580989059278","date":"2026-06-18","pace":426,"w":1,"rep":true,"hr":"in_band","ee":"evidence"},{"id":"-2351254210708","date":"2026-06-23","pace":430,"w":1,"rep":true,"hr":"in_band","ee":"evidence"},{"id":"-182722411215424","date":"2026-06-09","pace":438,"w":1,"rep":true,"hr":"in_band","ee":"evidence"}]
    excluded: [{"id":"-1135018536585133","date":"2026-05-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17988861079","date":"2026-04-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-223275054","date":"2026-05-06","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-164879313431759","date":"2026-05-27","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-226447289863060","date":"2026-06-14","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-266958841059441","date":"2026-06-07","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-243713397221312","date":"2026-06-08","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-1010945655","date":"2026-04-29","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-4100288002784906","date":"2026-05-19","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18058896921","date":"2026-04-10","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17712636356","date":"2026-03-13","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17567906751","date":"2026-03-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1722688244","date":"2026-04-26","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2029406939","date":"2026-05-13","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1378831178","date":"2026-05-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-665301223","date":"2026-05-08","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-522630830","date":"2026-05-03","reason":"NO_QUALIFYING_SEGMENT"},{"id":"-1251512475","date":"2026-05-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1141962844","date":"2026-05-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-90172438","date":"2026-04-23","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17699939721","date":"2026-03-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-3558250452245243","date":"2026-06-02","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17990892823","date":"2026-04-05","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-241421579595571","date":"2026-05-29","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2987651096082307","date":"2026-06-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18084159177","date":"2026-04-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18125737240","date":"2026-04-15","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-75222347127112","date":"2026-06-19","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-254369820","date":"2026-05-15","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1109157298233570","date":"2026-05-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-3858000542489904","date":"2026-06-03","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-255472024","date":"2026-05-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-514138731845836","date":"2026-05-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1521382352","date":"2026-05-17","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2818378315677006","date":"2026-05-22","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17510972527","date":"2026-02-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2045716995500221","date":"2026-05-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17548470709","date":"2026-02-27","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1488380974","date":"2026-05-25","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-573194905917117","date":"2026-05-26","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17617971096","date":"2026-03-05","reason":"SESSION_BELOW_DURATION_FLOOR"},{"id":"-1466010895152803","date":"2026-05-31","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17746760747","date":"2026-03-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1483290537416636","date":"2026-06-04","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2142575830045023","date":"2026-06-05","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"17932871719","date":"2026-03-31","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-70333530507729","date":"2026-06-10","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"18048347952","date":"2026-04-09","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-27148287813731","date":"2026-06-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18006986135","date":"2026-04-06","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17944754521","date":"2026-04-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-20211252944965","date":"2026-06-15","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-142898519593835","date":"2026-06-17","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-3363396946462586","date":"2026-05-20","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-127657343028184","date":"2026-06-21","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"18113279996","date":"2026-04-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18139504301","date":"2026-04-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18226742240","date":"2026-04-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18563126474","date":"2026-05-18","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17524965305","date":"2026-02-25","reason":"SESSION_BELOW_DURATION_FLOOR"},{"id":"17956464291","date":"2026-04-02","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17892279941","date":"2026-03-28","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17712645121","date":"2026-03-11","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17807724142","date":"2026-03-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1684834858","date":"2026-04-25","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18163053621","date":"2026-04-18","reason":"NO_QUALIFYING_SEGMENT"},{"id":"17596135564","date":"2026-03-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17665883608","date":"2026-03-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17797203117","date":"2026-03-20","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17787200683","date":"2026-03-19","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17849178980","date":"2026-03-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17665883469","date":"2026-03-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17654375467","date":"2026-03-08","reason":"LABEL_RACE"},{"id":"17855259593","date":"2026-03-25","reason":"OUTSIDE_LOOKBACK_WINDOW"},{"id":"18047997225","date":"2026-04-08","reason":"OUTSIDE_LOOKBACK_WINDOW"}]
  2026-06-24  T=438s/mi (7:18)  vdot=46.8  conf=0.8151  direct  ids=[-251580989059278,-2351254210708,-182722411215424]
  2026-06-25  T=438s/mi (7:18)  vdot=46.8  conf=0.8103  direct  ids=[-251580989059278,-2351254210708,-182722411215424]
  2026-06-26  T=438s/mi (7:18)  vdot=46.8  conf=0.8057  direct  ids=[-251580989059278,-2351254210708,-182722411215424]
  2026-06-27  T=438s/mi (7:18)  vdot=46.8  conf=0.8011  direct  ids=[-251580989059278,-2351254210708,-182722411215424]
  2026-06-28  T=438s/mi (7:18)  vdot=46.8  conf=0.7967  direct  ids=[-251580989059278,-2351254210708,-182722411215424]
  2026-06-29  T=438s/mi (7:18)  vdot=46.8  conf=0.7924  direct  ids=[-251580989059278,-2351254210708,-182722411215424]
  2026-06-30  T=438s/mi (7:18)  vdot=46.8  conf=0.7882  direct  ids=[-251580989059278,-2351254210708,-182722411215424]
  2026-07-01  T=438s/mi (7:18)  vdot=46.8  conf=0.7841  direct  ids=[-251580989059278,-2351254210708,-182722411215424]
  2026-07-02  T=438s/mi (7:18)  vdot=46.8  conf=0.7801  direct  ids=[-251580989059278,-2351254210708,-182722411215424]
  2026-07-03  T=438s/mi (7:18)  vdot=46.8  conf=0.7761  direct  ids=[-251580989059278,-2351254210708,-182722411215424]
  2026-07-04  T=438s/mi (7:18)  vdot=46.8  conf=0.7723  direct  ids=[-251580989059278,-2351254210708,-182722411215424]
  2026-07-05  T=438s/mi (7:18)  vdot=46.8  conf=0.7686  direct  ids=[-251580989059278,-2351254210708,-182722411215424]
  2026-07-06  T=438s/mi (7:18)  vdot=46.8  conf=0.765  direct  ids=[-251580989059278,-2351254210708,-182722411215424]
* 2026-07-07  T=433s/mi (7:13)  vdot=47.4  conf=0.84  direct  ids=[-87627419857791,-251580989059278,-2351254210708]  CAPPED(prior 438, uncapped 430)
    Δ -5s/mi from 438 · reasons=DIRECT_CORROBORATED_THRESHOLD_EVIDENCE,THREE_RECENT_CORROBORATING_SESSIONS,OBSERVATIONS_AGREE,FRESH_EVIDENCE,SINGLE_SESSION_MOVE_CAPPED
    supporting: [{"id":"-87627419857791","date":"2026-07-07","pace":422,"w":1,"rep":true,"hr":"in_band","ee":"evidence"},{"id":"-251580989059278","date":"2026-06-18","pace":426,"w":1,"rep":true,"hr":"in_band","ee":"evidence"},{"id":"-2351254210708","date":"2026-06-23","pace":430,"w":1,"rep":true,"hr":"in_band","ee":"evidence"}]
    excluded: [{"id":"-1135018536585133","date":"2026-05-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17988861079","date":"2026-04-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-223275054","date":"2026-05-06","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-164879313431759","date":"2026-05-27","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-226447289863060","date":"2026-06-14","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-266958841059441","date":"2026-06-07","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-191288470618193","date":"2026-07-06","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-243713397221312","date":"2026-06-08","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-1010945655","date":"2026-04-29","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-4100288002784906","date":"2026-05-19","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18058896921","date":"2026-04-10","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17712636356","date":"2026-03-13","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1722688244","date":"2026-04-26","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2029406939","date":"2026-05-13","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1378831178","date":"2026-05-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-665301223","date":"2026-05-08","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-522630830","date":"2026-05-03","reason":"NO_QUALIFYING_SEGMENT"},{"id":"-1251512475","date":"2026-05-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1141962844","date":"2026-05-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-90172438","date":"2026-04-23","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17699939721","date":"2026-03-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-3558250452245243","date":"2026-06-02","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17990892823","date":"2026-04-05","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-241421579595571","date":"2026-05-29","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2987651096082307","date":"2026-06-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18084159177","date":"2026-04-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18125737240","date":"2026-04-15","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-75222347127112","date":"2026-06-19","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-254369820","date":"2026-05-15","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1109157298233570","date":"2026-05-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-3858000542489904","date":"2026-06-03","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-255472024","date":"2026-05-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-514138731845836","date":"2026-05-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1521382352","date":"2026-05-17","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2818378315677006","date":"2026-05-22","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2045716995500221","date":"2026-05-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1488380974","date":"2026-05-25","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-573194905917117","date":"2026-05-26","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1466010895152803","date":"2026-05-31","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17746760747","date":"2026-03-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1483290537416636","date":"2026-06-04","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2142575830045023","date":"2026-06-05","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"17932871719","date":"2026-03-31","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-70333530507729","date":"2026-06-10","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"18048347952","date":"2026-04-09","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-27148287813731","date":"2026-06-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18006986135","date":"2026-04-06","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17944754521","date":"2026-04-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-20211252944965","date":"2026-06-15","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-142898519593835","date":"2026-06-17","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-3363396946462586","date":"2026-05-20","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-127657343028184","date":"2026-06-21","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-28841066621288","date":"2026-06-25","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-132305279286285","date":"2026-06-27","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"18113279996","date":"2026-04-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18139504301","date":"2026-04-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18226742240","date":"2026-04-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18563126474","date":"2026-05-18","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17956464291","date":"2026-04-02","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17892279941","date":"2026-03-28","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17712645121","date":"2026-03-11","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17807724142","date":"2026-03-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1684834858","date":"2026-04-25","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18163053621","date":"2026-04-18","reason":"NO_QUALIFYING_SEGMENT"},{"id":"17797203117","date":"2026-03-20","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17787200683","date":"2026-03-19","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17849178980","date":"2026-03-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17855259593","date":"2026-03-25","reason":"OUTSIDE_LOOKBACK_WINDOW"},{"id":"18047997225","date":"2026-04-08","reason":"OUTSIDE_LOOKBACK_WINDOW"}]
* 2026-07-08  T=430s/mi (7:10)  vdot=47.8  conf=0.8351  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
    Δ -3s/mi from 433 · reasons=DIRECT_CORROBORATED_THRESHOLD_EVIDENCE,THREE_RECENT_CORROBORATING_SESSIONS,OBSERVATIONS_AGREE,FRESH_EVIDENCE
    supporting: [{"id":"-87627419857791","date":"2026-07-07","pace":422,"w":1,"rep":true,"hr":"in_band","ee":"evidence"},{"id":"-251580989059278","date":"2026-06-18","pace":426,"w":1,"rep":true,"hr":"in_band","ee":"evidence"},{"id":"-2351254210708","date":"2026-06-23","pace":430,"w":1,"rep":true,"hr":"in_band","ee":"evidence"}]
    excluded: [{"id":"-1135018536585133","date":"2026-05-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17988861079","date":"2026-04-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-223275054","date":"2026-05-06","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-164879313431759","date":"2026-05-27","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-226447289863060","date":"2026-06-14","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-266958841059441","date":"2026-06-07","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-191288470618193","date":"2026-07-06","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-243713397221312","date":"2026-06-08","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-1010945655","date":"2026-04-29","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-4100288002784906","date":"2026-05-19","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18058896921","date":"2026-04-10","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17712636356","date":"2026-03-13","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1722688244","date":"2026-04-26","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2029406939","date":"2026-05-13","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1378831178","date":"2026-05-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-665301223","date":"2026-05-08","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-522630830","date":"2026-05-03","reason":"NO_QUALIFYING_SEGMENT"},{"id":"-1251512475","date":"2026-05-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1141962844","date":"2026-05-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-90172438","date":"2026-04-23","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17699939721","date":"2026-03-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-3558250452245243","date":"2026-06-02","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17990892823","date":"2026-04-05","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-241421579595571","date":"2026-05-29","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2987651096082307","date":"2026-06-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18084159177","date":"2026-04-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18125737240","date":"2026-04-15","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-75222347127112","date":"2026-06-19","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-254369820","date":"2026-05-15","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1109157298233570","date":"2026-05-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-3858000542489904","date":"2026-06-03","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-255472024","date":"2026-05-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-514138731845836","date":"2026-05-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1521382352","date":"2026-05-17","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2818378315677006","date":"2026-05-22","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2045716995500221","date":"2026-05-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1488380974","date":"2026-05-25","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-573194905917117","date":"2026-05-26","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1466010895152803","date":"2026-05-31","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17746760747","date":"2026-03-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1483290537416636","date":"2026-06-04","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2142575830045023","date":"2026-06-05","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"17932871719","date":"2026-03-31","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-70333530507729","date":"2026-06-10","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"18048347952","date":"2026-04-09","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-27148287813731","date":"2026-06-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18006986135","date":"2026-04-06","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17944754521","date":"2026-04-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-20211252944965","date":"2026-06-15","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-142898519593835","date":"2026-06-17","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-3363396946462586","date":"2026-05-20","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-127657343028184","date":"2026-06-21","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-28841066621288","date":"2026-06-25","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-132305279286285","date":"2026-06-27","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-208912546352697","date":"2026-07-08","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"18113279996","date":"2026-04-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18139504301","date":"2026-04-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18226742240","date":"2026-04-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18563126474","date":"2026-05-18","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17956464291","date":"2026-04-02","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17892279941","date":"2026-03-28","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17712645121","date":"2026-03-11","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17807724142","date":"2026-03-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1684834858","date":"2026-04-25","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18163053621","date":"2026-04-18","reason":"NO_QUALIFYING_SEGMENT"},{"id":"17797203117","date":"2026-03-20","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17787200683","date":"2026-03-19","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17849178980","date":"2026-03-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17855259593","date":"2026-03-25","reason":"OUTSIDE_LOOKBACK_WINDOW"},{"id":"18047997225","date":"2026-04-08","reason":"OUTSIDE_LOOKBACK_WINDOW"}]
  2026-07-09  T=430s/mi (7:10)  vdot=47.8  conf=0.8303  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
* 2026-07-10  T=426s/mi (7:06)  vdot=48.3  conf=0.8357  direct  ids=[-87627419857791,-251580989059278]
    Δ -4s/mi from 430 · reasons=DIRECT_CORROBORATED_THRESHOLD_EVIDENCE,THREE_RECENT_CORROBORATING_SESSIONS,OBSERVATIONS_AGREE,FRESH_EVIDENCE,REEXAMINATION_LOWERED_THE_CORROBORATION_BAR
    supporting: [{"id":"-87627419857791","date":"2026-07-07","pace":422,"w":1,"rep":true,"hr":"in_band","ee":"evidence"},{"id":"-251580989059278","date":"2026-06-18","pace":426,"w":1,"rep":true,"hr":"in_band","ee":"evidence"}]
    excluded: [{"id":"-1135018536585133","date":"2026-05-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17988861079","date":"2026-04-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-223275054","date":"2026-05-06","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-164879313431759","date":"2026-05-27","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-226447289863060","date":"2026-06-14","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-266958841059441","date":"2026-06-07","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-191288470618193","date":"2026-07-06","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-243713397221312","date":"2026-06-08","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-1010945655","date":"2026-04-29","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-4100288002784906","date":"2026-05-19","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18058896921","date":"2026-04-10","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17712636356","date":"2026-03-13","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1722688244","date":"2026-04-26","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2029406939","date":"2026-05-13","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1378831178","date":"2026-05-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-665301223","date":"2026-05-08","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-522630830","date":"2026-05-03","reason":"NO_QUALIFYING_SEGMENT"},{"id":"-1251512475","date":"2026-05-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1141962844","date":"2026-05-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-90172438","date":"2026-04-23","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17699939721","date":"2026-03-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-3558250452245243","date":"2026-06-02","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17990892823","date":"2026-04-05","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-241421579595571","date":"2026-05-29","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2987651096082307","date":"2026-06-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18084159177","date":"2026-04-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18125737240","date":"2026-04-15","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-75222347127112","date":"2026-06-19","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-254369820","date":"2026-05-15","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1109157298233570","date":"2026-05-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-3858000542489904","date":"2026-06-03","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-255472024","date":"2026-05-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-514138731845836","date":"2026-05-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1521382352","date":"2026-05-17","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2818378315677006","date":"2026-05-22","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2045716995500221","date":"2026-05-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1488380974","date":"2026-05-25","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-573194905917117","date":"2026-05-26","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1466010895152803","date":"2026-05-31","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17746760747","date":"2026-03-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1483290537416636","date":"2026-06-04","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2142575830045023","date":"2026-06-05","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"17932871719","date":"2026-03-31","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-70333530507729","date":"2026-06-10","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"18048347952","date":"2026-04-09","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-27148287813731","date":"2026-06-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18006986135","date":"2026-04-06","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17944754521","date":"2026-04-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-20211252944965","date":"2026-06-15","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-142898519593835","date":"2026-06-17","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-3363396946462586","date":"2026-05-20","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-127657343028184","date":"2026-06-21","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-28841066621288","date":"2026-06-25","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-132305279286285","date":"2026-06-27","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-208912546352697","date":"2026-07-08","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-71886754295643","date":"2026-07-09","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-104787411096713","date":"2026-07-10","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"18113279996","date":"2026-04-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18139504301","date":"2026-04-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18226742240","date":"2026-04-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18563126474","date":"2026-05-18","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17956464291","date":"2026-04-02","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17892279941","date":"2026-03-28","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17807724142","date":"2026-03-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1684834858","date":"2026-04-25","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18163053621","date":"2026-04-18","reason":"NO_QUALIFYING_SEGMENT"},{"id":"17797203117","date":"2026-03-20","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17787200683","date":"2026-03-19","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17849178980","date":"2026-03-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17855259593","date":"2026-03-25","reason":"OUTSIDE_LOOKBACK_WINDOW"},{"id":"18047997225","date":"2026-04-08","reason":"OUTSIDE_LOOKBACK_WINDOW"}]
  2026-07-11  T=426s/mi (7:06)  vdot=48.3  conf=0.8311  direct  ids=[-87627419857791,-251580989059278]
  2026-07-12  T=426s/mi (7:06)  vdot=48.3  conf=0.8267  direct  ids=[-87627419857791,-251580989059278]
  2026-07-13  T=426s/mi (7:06)  vdot=48.3  conf=0.8224  direct  ids=[-87627419857791,-251580989059278]
  2026-07-14  T=426s/mi (7:06)  vdot=48.3  conf=0.8182  direct  ids=[-87627419857791,-251580989059278]
  2026-07-15  T=426s/mi (7:06)  vdot=48.3  conf=0.8141  direct  ids=[-87627419857791,-251580989059278]
  2026-07-16  T=426s/mi (7:06)  vdot=48.3  conf=0.8101  direct  ids=[-87627419857791,-251580989059278]
  2026-07-17  T=426s/mi (7:06)  vdot=48.3  conf=0.8061  direct  ids=[-87627419857791,-251580989059278]
  2026-07-18  T=426s/mi (7:06)  vdot=48.3  conf=0.8023  direct  ids=[-87627419857791,-251580989059278]
  2026-07-19  T=426s/mi (7:06)  vdot=48.3  conf=0.7986  direct  ids=[-87627419857791,-251580989059278]
  2026-07-20  T=426s/mi (7:06)  vdot=48.3  conf=0.795  direct  ids=[-87627419857791,-251580989059278]
  2026-07-21  T=426s/mi (7:06)  vdot=48.3  conf=0.7914  direct  ids=[-87627419857791,-251580989059278]
* 2026-07-22  T=430s/mi (7:10)  vdot=47.8  conf=0.778  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
    Δ 4s/mi from 426 · reasons=DIRECT_CORROBORATED_THRESHOLD_EVIDENCE,THREE_RECENT_CORROBORATING_SESSIONS,OBSERVATIONS_AGREE,FRESH_EVIDENCE
    supporting: [{"id":"-87627419857791","date":"2026-07-07","pace":422,"w":1,"rep":true,"hr":"in_band","ee":"evidence"},{"id":"-251580989059278","date":"2026-06-18","pace":426,"w":1,"rep":true,"hr":"in_band","ee":"evidence"},{"id":"-2351254210708","date":"2026-06-23","pace":430,"w":1,"rep":true,"hr":"in_band","ee":"evidence"}]
    excluded: [{"id":"-1135018536585133","date":"2026-05-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17988861079","date":"2026-04-03","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-223275054","date":"2026-05-06","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-164879313431759","date":"2026-05-27","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-226447289863060","date":"2026-06-14","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-266958841059441","date":"2026-06-07","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-191288470618193","date":"2026-07-06","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-243713397221312","date":"2026-06-08","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-1010945655","date":"2026-04-29","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-4100288002784906","date":"2026-05-19","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-45100417674801","date":"2026-07-12","reason":"LABEL_NON_QUALITY_UNPRICEABLE"},{"id":"-180849195850364","date":"2026-07-13","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"18058896921","date":"2026-04-10","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-208859539241829","date":"2026-07-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-138576224060588","date":"2026-07-15","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-1722688244","date":"2026-04-26","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2029406939","date":"2026-05-13","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1378831178","date":"2026-05-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-665301223","date":"2026-05-08","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-522630830","date":"2026-05-03","reason":"NO_QUALIFYING_SEGMENT"},{"id":"-1251512475","date":"2026-05-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1141962844","date":"2026-05-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-90172438","date":"2026-04-23","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-3558250452245243","date":"2026-06-02","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17990892823","date":"2026-04-05","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-241421579595571","date":"2026-05-29","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2987651096082307","date":"2026-06-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18084159177","date":"2026-04-12","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18125737240","date":"2026-04-15","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-75222347127112","date":"2026-06-19","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-254369820","date":"2026-05-15","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1109157298233570","date":"2026-05-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-3858000542489904","date":"2026-06-03","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-255472024","date":"2026-05-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-514138731845836","date":"2026-05-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1521382352","date":"2026-05-17","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2818378315677006","date":"2026-05-22","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2045716995500221","date":"2026-05-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1488380974","date":"2026-05-25","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-573194905917117","date":"2026-05-26","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1466010895152803","date":"2026-05-31","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1483290537416636","date":"2026-06-04","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-2142575830045023","date":"2026-06-05","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"17932871719","date":"2026-03-31","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-70333530507729","date":"2026-06-10","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"18048347952","date":"2026-04-09","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-27148287813731","date":"2026-06-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18006986135","date":"2026-04-06","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17944754521","date":"2026-04-01","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-20211252944965","date":"2026-06-15","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-142898519593835","date":"2026-06-17","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-3363396946462586","date":"2026-05-20","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-127657343028184","date":"2026-06-21","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-28841066621288","date":"2026-06-25","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-132305279286285","date":"2026-06-27","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-208912546352697","date":"2026-07-08","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-71886754295643","date":"2026-07-09","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-104787411096713","date":"2026-07-10","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"18113279996","date":"2026-04-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-4269086812782646","date":"2026-07-14","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-280549580846348","date":"2026-07-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-91071585653357","date":"2026-07-17","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"18139504301","date":"2026-04-16","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-434657604578","date":"2026-07-22","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"-27464959454570","date":"2026-07-20","reason":"LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE"},{"id":"18226742240","date":"2026-04-21","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18563126474","date":"2026-05-18","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17956464291","date":"2026-04-02","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17892279941","date":"2026-03-28","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"-1684834858","date":"2026-04-25","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"18163053621","date":"2026-04-18","reason":"NO_QUALIFYING_SEGMENT"},{"id":"17849178980","date":"2026-03-24","reason":"EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE"},{"id":"17855259593","date":"2026-03-25","reason":"OUTSIDE_LOOKBACK_WINDOW"},{"id":"18047997225","date":"2026-04-08","reason":"OUTSIDE_LOOKBACK_WINDOW"}]
  2026-07-23  T=430s/mi (7:10)  vdot=47.8  conf=0.7746  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-07-24  T=430s/mi (7:10)  vdot=47.8  conf=0.7713  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-07-25  T=430s/mi (7:10)  vdot=47.8  conf=0.7681  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-07-26  T=430s/mi (7:10)  vdot=47.8  conf=0.765  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-07-27  T=430s/mi (7:10)  vdot=47.8  conf=0.7619  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-07-28  T=430s/mi (7:10)  vdot=47.8  conf=0.7589  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-07-29  T=430s/mi (7:10)  vdot=47.8  conf=0.756  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-07-30  T=430s/mi (7:10)  vdot=47.8  conf=0.7532  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-07-31  T=430s/mi (7:10)  vdot=47.8  conf=0.7504  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-01  T=430s/mi (7:10)  vdot=47.8  conf=0.7477  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-02  T=430s/mi (7:10)  vdot=47.8  conf=0.7451  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-03  T=430s/mi (7:10)  vdot=47.8  conf=0.7425  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-04  T=430s/mi (7:10)  vdot=47.8  conf=0.74  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-05  T=430s/mi (7:10)  vdot=47.8  conf=0.7376  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-06  T=430s/mi (7:10)  vdot=47.8  conf=0.7352  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-07  T=430s/mi (7:10)  vdot=47.8  conf=0.7328  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-08  T=430s/mi (7:10)  vdot=47.8  conf=0.7306  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-09  T=430s/mi (7:10)  vdot=47.8  conf=0.7084  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-10  T=430s/mi (7:10)  vdot=47.8  conf=0.7062  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-11  T=430s/mi (7:10)  vdot=47.8  conf=0.6841  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-12  T=430s/mi (7:10)  vdot=47.8  conf=0.682  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-13  T=430s/mi (7:10)  vdot=47.8  conf=0.68  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-14  T=430s/mi (7:10)  vdot=47.8  conf=0.6781  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-15  T=430s/mi (7:10)  vdot=47.8  conf=0.6762  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-16  T=430s/mi (7:10)  vdot=47.8  conf=0.6743  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-17  T=430s/mi (7:10)  vdot=47.8  conf=0.6725  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-18  T=430s/mi (7:10)  vdot=47.8  conf=0.7107  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-19  T=430s/mi (7:10)  vdot=47.8  conf=0.709  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-20  T=430s/mi (7:10)  vdot=47.8  conf=0.7073  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-21  T=430s/mi (7:10)  vdot=47.8  conf=0.7056  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-22  T=430s/mi (7:10)  vdot=47.8  conf=0.704  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-23  T=430s/mi (7:10)  vdot=47.8  conf=0.6825  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-24  T=430s/mi (7:10)  vdot=47.8  conf=0.681  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-25  T=430s/mi (7:10)  vdot=47.8  conf=0.6795  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-26  T=430s/mi (7:10)  vdot=47.8  conf=0.678  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-27  T=430s/mi (7:10)  vdot=47.8  conf=0.6766  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-28  T=430s/mi (7:10)  vdot=47.8  conf=0.6752  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-29  T=430s/mi (7:10)  vdot=47.8  conf=0.6739  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-30  T=430s/mi (7:10)  vdot=47.8  conf=0.6925  direct  ids=[-87627419857791,-251580989059278,-2351254210708]
  2026-08-31  T=430s/mi (7:10)  vdot=47.8  conf=0.6913  direct  ids=[-251580989059278,-87627419857791,-2351254210708]
  2026-09-01  T=430s/mi (7:10)  vdot=47.8  conf=0.84  direct  ids=[-258355938987883,-87627419857791,-2351254210708]
```



---

# Part 4 · The 4 × 1-mile workout through every consumer (deployed tree)

Written by `web-v2/lib/training/_zz_replay_20260901.test.ts` running every consumer against production read-only at `f967cab1` (run log: 1 passed).


## 2026-09-01 · 4×1 mi @ T pace · 1 min jog — every consumer

Owner `0645f40c-951d-4ccc-b86e-9979cd26c795`, canonical `runs` row `-258355938987883`.

### 0 · What is stored (BEFORE — the watch build that recorded it)

| # | phase | dur | dist | target | actual | avgHr | inTol | outTol | stored verdict |
|---|---|---|---|---|---|---|---|---|---|
| 0 | Warm-up | 1084s | 2.1 | 502 | 516 | 140 | 990 | 55 | **hit** |
| 1 | Interval · 1 mi | 424s | 1.01 | 430 | 422 | 158 | 120 | 295 | **drifted** |
| 2 | Jog 1 min | 61s | 0.12 | — | 515 | 158 | — | — | **—** |
| 3 | Interval · 1 mi | 431s | 1.01 | 430 | 429 | 161 | 240 | 180 | **drifted** |
| 4 | Jog 1 min | 64s | 0.08 | — | 785 | 156 | — | — | **—** |
| 5 | Interval · 1 mi | 423s | 1 | 430 | 422 | 164 | 145 | 270 | **drifted** |
| 6 | Jog 1 min | 64s | 0.06 | — | 1034 | 157 | — | — | **—** |
| 7 | Interval · 1 mi | 422s | 1.01 | 430 | 419 | 166 | 85 | 325 | **missed** |
| 8 | Cool-down | 1125s | 2.11 | 502 | 534 | 153 | 910 | 180 | **missed** |

Note: the row carries NO `tolerancePaceSPerMi` and NO `paceShape` — it
predates both fields — so every consumer below is exercising the
LEGACY-payload path, which is what every already-deployed watch sends.

### 1 · Activity Interpreter (`classifyStoredActivity`)

```json
{
  "modelVersion": "1.0.0",
  "activityId": "0645f40c-951d-4ccc-b86e-9979cd26c795-2026-09-01#0920",
  "date": "2026-09-01",
  "eligibility": {
    "admissible": true,
    "signals": {
      "distance": "high",
      "duration": "high",
      "pace": "moderate_high",
      "hr": "high",
      "power": "moderate",
      "dynamics": "moderate"
    },
    "signalReasons": [
      "PACE_STABILITY_CONFIRMED_BY_SPLITS",
      "POWER_STABILITY_UNVERIFIABLE_WITHOUT_SPLITS",
      "DYNAMICS_PRESENT_NOT_SURFACED"
    ],
    "continuity": {
      "grain": "per_split",
      "grade": "high",
      "weight": 0.9719717280038996,
      "unaccountedSec": 23,
      "unaccountedFraction": 0.005605654399220083,
      "interruptedSplitIndices": [],
      "reasons": [
        "SPLIT_TIMES_LEAVE_ACTIVITY_TIME_UNACCOUNTED",
        "NO_INTERRUPTION_SHAPED_SPLITS_AT_THIS_GRANULARITY"
      ]
    },
    "rejections": []
  },
  "environment": {
    "tempF": 69.3,
    "humidityPct": 70,
    "dewpointF": 59.09698499898506,
    "slowdownPct": 3.9247391666666664,
    "load": "moderate",
    "hrConfoundWeight": 0.26164927777777774,
    "hrCostPlausiblyElevated": true,
    "reasons": [
      "DEWPOINT_ESTIMATED_FROM_HUMIDITY",
      "CONDITIONS_MAKE_ELEVATED_HR_PLAUSIBLE"
    ]
  },
  "plannedIntent": "THRESHOLD",
  "observedExecution": "MIXED",
  "executionDivergedFromIntent": true,
  "executionQuality": "controlled",
  "structured": true,
  "segments": [
    {
      "index": 1,
      "splitIndices": [
        1,
        2
      ],
      "startSec": 0,
      "endSec": 1035,
      "spanSec": 1035,
      "distanceMi": 2,
      "meanPaceSecPerMi": 518,
      "meanHrBpm": 139.5,
      "meanPowerW": null,
      "hrZoneIdx": 1,
      "relativeIntensity": 1,
      "classification": "recovery",
      "confidence": 0.9683,
      "accumulatedMinutesBefore": 0,
      "underAccumulatedLoad": false,
      "reasons": [
        "NO_POWER_RECORDED_FOR_THIS_ACTIVITY"
      ]
    },
    {
      "index": 2,
      "splitIndices": [
        3,
        4,
        5,
        6
      ],
      "startSec": 1035,
      "endSec": 2809,
      "spanSec": 1774,
      "distanceMi": 4,
      "meanPaceSecPerMi": 444,
      "meanHrBpm": 160.5,
      "meanPowerW": null,
      "hrZoneIdx": 4,
      "relativeIntensity": 1.1669,
      "classification": "threshold_like",
      "confidence": 0.9445,
      "accumulatedMinutesBefo
```

### 2 · Run Detail (`mapWatchPhases` → `phase_breakdown`)

| # | type | target | actual | tol (AFTER) | shape (AFTER) | status BEFORE | status AFTER | label AFTER | watch verdict (stored) |
|---|---|---|---|---|---|---|---|---|---|
| 0 | warmup | 502 | 8:36 | 30 | ceiling | slow | **on** | Under the ceiling | hit |
| 1 | work | 430 | 7:02 | 8 | window | on | **on** | On target | drifted |
| 2 | recovery | — | 8:35 | — | none | — | **—** | — | — |
| 3 | work | 430 | 7:09 | 8 | window | on | **on** | On target | drifted |
| 4 | recovery | — | 13:05 | — | none | — | **—** | — | — |
| 5 | work | 430 | 7:02 | 8 | window | on | **on** | On target | drifted |
| 6 | recovery | — | 17:14 | — | none | — | **—** | — | — |
| 7 | work | 430 | 6:59 | 8 | window | fast | **fast** | Quicker than target | missed |
| 8 | cooldown | 502 | 8:54 | 30 | ceiling | slow | **on** | Under the ceiling | missed |

### 3 · The new wrist grader, replayed on the nine real phases

| # | type | target | actual | shape | AFTER | reads as | BEFORE (stored) |
|---|---|---|---|---|---|---|---|
| 0 | warmup | 502 | 516 | ceiling | **hit** | Under the ceiling | hit |
| 1 | work | 430 | 422 | window | **hit** | On target | drifted |
| 2 | recovery | — | 515 | none | **not_graded** | (nothing said) | — |
| 3 | work | 430 | 429 | window | **hit** | On target | drifted |
| 4 | recovery | — | 785 | none | **not_graded** | (nothing said) | — |
| 5 | work | 430 | 422 | window | **hit** | On target | drifted |
| 6 | recovery | — | 1034 | none | **not_graded** | (nothing said) | — |
| 7 | work | 430 | 419 | window | **fast** | Quicker than target | missed |
| 8 | cooldown | 502 | 534 | ceiling | **hit** | Under the ceiling | missed |

```json
{
  "verdict": "executed",
  "workVerdicts": [
    "hit",
    "hit",
    "hit",
    "fast"
  ],
  "hits": 3,
  "fasts": 1,
  "graded": 4,
  "lateCollapse": false,
  "recoveriesHonest": true
}
```

### 4 · Execution reconstruction + interpretation (`loadKeySessionExecutions`)

```json
{
  "dateISO": "2026-09-01",
  "type": "threshold",
  "planned": {
    "domain": "threshold",
    "workMinutes": 28.666666666666668,
    "workMi": 4,
    "meanWorkPaceSPerMi": 430,
    "recoveryIntent": "incomplete"
  },
  "plannedBasis": "expanded-spec",
  "actual": {
    "domain": "threshold",
    "workMinutes": 28.333333333333332,
    "workMi": 4.03,
    "meanWorkPaceSPerMi": 421.83622828784115,
    "recoveryIntent": "incomplete"
  },
  "actualBasis": "watch-phases",
  "readable": true,
  "read": {
    "state": "AS_PLANNED",
    "stimulusCompletion": 1,
    "evidence": {
      "execution": "full",
      "adaptation": "positive",
      "fitness": "moderate",
      "risk": "none"
    },
    "why": "Ran as prescribed."
  },
  "earnsProgression": true,
  "watchStatus": "completed",
  "toleranceShare": 0.35542168674698793,
  "workVerdicts": [
    "drifted",
    "drifted",
    "drifted",
    "missed"
  ],
  "establishedPaceSPerMi": 430,
  "replacedByRace": false
}
```

### 5 · Recap (`deriveRecap`)

Work-phase mean pace: **423 s/mi** against a 430 target.

**AFTER** (with the LTHR threaded, three arms):

> Tempo done.
> Tempo done · 4 mi @ 7:03 · avg HR 162 across the 4 reps.
> Ran 7s/mi under the target with the effort sitting just under the threshold seam · that pace cost less than the model expected. Worth a retest before it counts as a new number. consistent.

**BEFORE** is the same call with no `lthrBpm` — which is what the old
code did structurally, since it fed `plannedHrCap` into the band and
had only two arms. Shown for contrast:

> Tempo done.
> Tempo done · 4 mi @ 7:03 · avg HR 162 across the 4 reps.
> Ran 7s/mi under the target · no heart rate to say whether that was fitness or just a hot start. The test is stacking the next eight weeks, not winning today. consistent.

### 6 · Training influence (`composeTrainingInfluence`)

```json
{
  "kind": "on_track",
  "copy": "Threshold pace hit. Race-pace work compounding."
}
```

### 7 · Evidence / Targets test point (`judgeTestPointExecution`)

```json
{
  "actualS": 423,
  "verdict": "on",
  "basis": "work-phase-watch"
}
```




---

# Part 5 · Falsification ledger, full logs

Runner `web-v2/scripts/p0-proof/falsify.sh` (twelve) plus the staleness gate falsified by hand. Each log: the mutation as a diff, the gate's output against the broken code, the gate's output after restore.


## 5 · `effective-target-second-rule.log`

```
### effective-target-second-rule
mutation: sed -E "s/targetSec: x.targetSec,/targetSec: Math.round(x.targetSec * 0.95),/" lib/race/effective-race-target.ts
diff --git a/web-v2/lib/race/effective-race-target.ts b/web-v2/lib/race/effective-race-target.ts
index eaacf2b0..f3cc901a 100644
--- a/web-v2/lib/race/effective-race-target.ts
+++ b/web-v2/lib/race/effective-race-target.ts
@@ -91,7 +91,7 @@ export function effectiveTargetFromOutlook(goalSec: number, outlook: RaceOutlook
     return { targetSec: goalSec, source: 'goal', goalSec, projectionSec: null, projectionDateISO: null, outlook };
   }
   return {
-    targetSec: x.targetSec,
+    targetSec: Math.round(x.targetSec * 0.95),
     source: x.source === 'stated_goal_within_range' ? 'goal' : 'projection',
     goalSec,
     projectionSec: outlook.expectedRaceDay.expectedSec,

--- gate output (broken) ---
     × goal inside the likely range → the goal, source goal 4ms
     × goal beyond the fast edge → the edge, source projection, goal kept as the stretch 0ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected 10826 to be 11396 // Object.is equality
AssertionError: expected 10650 to be 11210 // Object.is equality
      Tests  2 failed | 2 passed (4)

--- gate output (restored) ---
 Test Files  1 passed (1)
      Tests  4 passed (4)
```


## 5 · `execution-target-past-fast-edge.log`

```
### execution-target-past-fast-edge
mutation: sed -E "s/targetSec = roundRaceTargetSec\(likelyRangeSec\[0\]\);/targetSec = goalSec;/" lib/race/race-outlook.ts
diff --git a/web-v2/lib/race/race-outlook.ts b/web-v2/lib/race/race-outlook.ts
index b7370f5d..54fd6bb8 100644
--- a/web-v2/lib/race/race-outlook.ts
+++ b/web-v2/lib/race/race-outlook.ts
@@ -484,7 +484,7 @@ export async function composeRaceOutlook(
       source = 'stated_goal_within_range';
       reasonVsExpected = `Your goal sits inside the likely range (${fmtTime(likelyRangeSec[0])}-${fmtTime(likelyRangeSec[1])}) · race to it.`;
     } else {
-      targetSec = roundRaceTargetSec(likelyRangeSec[0]);
+      targetSec = goalSec;
       source = 'stated_goal_clamped_to_range_edge';
       reasonVsExpected = `Your goal (${fmtTime(goalSec)}) is faster than the likely range's fast edge (${fmtTime(likelyRangeSec[0])}) · race to the edge; the goal stays yours.`;
     }

--- gate output (broken) ---
     × expected race day is current projection plus the expected gain, never slower than current 3ms
     × a goal beyond the fast edge is clamped TO the edge, and the goal stays the goal 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected [ Array(1) ] to deeply equal []
AssertionError: expected 8971 to be 11210 // Object.is equality
      Tests  2 failed | 11 passed (13)

--- gate output (restored) ---
 Test Files  1 passed (1)
      Tests  13 passed (13)
```


## 5 · `goal-isolation-gain-reads-goal.log`

```
### goal-isolation-gain-reads-goal
mutation: sed -E "s/executionQuality: signal\?\.executionQuality \?\? null,/executionQuality: (signal?.executionQuality ?? 1) * (race.statedGoalSec ? 10800 \/ race.statedGoalSec : 1),/" lib/race/race-outlook.ts
diff --git a/web-v2/lib/race/race-outlook.ts b/web-v2/lib/race/race-outlook.ts
index b7370f5d..6961f6be 100644
--- a/web-v2/lib/race/race-outlook.ts
+++ b/web-v2/lib/race/race-outlook.ts
@@ -423,7 +423,7 @@ export async function composeRaceOutlook(
   const gain = projectExpectedGain({
     raceDistanceMi: race.distanceMi,
     weeksToRace: weeksToRace ?? 0,
-    executionQuality: signal?.executionQuality ?? null,
+    executionQuality: (signal?.executionQuality ?? 1) * (race.statedGoalSec ? 10800 / race.statedGoalSec : 1),
     overPerformanceBonusVdot: signal?.overPerformanceBonusVdot ?? 0,
     responseFactor: null,
   });

--- gate output (broken) ---
     × a soft goal and an impossible goal earn the same expected improvement and the same expected race day 2ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected 2.008928571428571 to be close to 2.6785714285714284, received difference is 0.6696428571428572, but expected 5e-7
      Tests  1 failed | 12 passed (13)

--- gate output (restored) ---
 Test Files  1 passed (1)
      Tests  13 passed (13)
```


## 5 · `hr-informational-without-evidence.log`

```
### hr-informational-without-evidence
mutation: sed -E "s/const informationalOnly = comparable.length === 0 \|\| /const informationalOnly = /" lib/race/race-hr-guidance.ts
diff --git a/web-v2/lib/race/race-hr-guidance.ts b/web-v2/lib/race/race-hr-guidance.ts
index be59ad5f..33c34407 100644
--- a/web-v2/lib/race/race-hr-guidance.ts
+++ b/web-v2/lib/race/race-hr-guidance.ts
@@ -134,7 +134,7 @@ export function resolveRaceHrGuidance(args: {
   // A band with NO personal evidence behind it is a population figure and
   // may inform, never alarm; a band the runner's own efforts contradict is
   // informational for the opposite reason. Enforcement needs evidence.
-  const informationalOnly = comparable.length === 0 || (conflictBpm != null && conflictBpm > 0);
+  const informationalOnly = (conflictBpm != null && conflictBpm > 0);
   const reasons: RaceHrReason[] = ['DOCTRINE_BAND_FOR_DISTANCE'];
   if (comparable.length === 0) reasons.push('NO_COMPARABLE_EFFORTS_POPULATION_REFERENCE');
   else if (conflictBpm != null && conflictBpm > 0) reasons.push('OWN_EFFORTS_EXCEED_BAND_INFORMATIONAL_ONLY');

--- gate output (broken) ---
     × a marathon carries an expected range, an early ceiling and a checkpoint abort figure 2ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected false to be true // Object.is equality
      Tests  1 failed | 12 passed (13)

--- gate output (restored) ---
 Test Files  1 passed (1)
      Tests  13 passed (13)
```


## 5 · `limiter-grows-its-own-fit.log`

```
### limiter-grows-its-own-fit
mutation: sed -E "s/export interface CurveRead \{/export function fitRiegelExponent(a: number, b: number): number { return Math.log(a) \/ Math.log(b); }\nexport interface CurveRead {/" lib/coach/limiter.ts
diff --git a/web-v2/lib/coach/limiter.ts b/web-v2/lib/coach/limiter.ts
index 890f12c3..b05dcecf 100644
--- a/web-v2/lib/coach/limiter.ts
+++ b/web-v2/lib/coach/limiter.ts
@@ -137,6 +137,7 @@ export interface LimiterRead {
  * exponent engine beside the one Pace Prescription and Race Prediction read.
  * One fit, one set of validity rules, one number.
  */
+export function fitRiegelExponent(a: number, b: number): number { return Math.log(a) / Math.log(b); }
 export interface CurveRead {
   /** The RAW fitted exponent (`rawFittedExponent`), unshrunk — the SHAPE of
    *  the runner's curve is what a limiter diagnosis needs, and the shrunk

--- gate output (broken) ---
     × limiter.ts carries no Riegel fit of its own (2026-09-01 · one exponent engine) 3ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected '/**\n * The limiter · "what is actual…' not to match /fitRiegelExponent|pickCurvePair|MIN_C…/
 * is the original `shortfall × 1.6`.
      Tests  1 failed | 43 passed (44)

--- gate output (restored) ---
 Test Files  1 passed (1)
      Tests  44 passed (44)
```


## 5 · `one-session-move-cap.log`

```
### one-session-move-cap
mutation: sed -E "s/THRESHOLD_ANCHOR_DAILY_MOVE_CAP_S_PER_MI = 5/THRESHOLD_ANCHOR_DAILY_MOVE_CAP_S_PER_MI = 999/" lib/training/pace-corpus.ts
diff --git a/web-v2/lib/training/pace-corpus.ts b/web-v2/lib/training/pace-corpus.ts
index 42d6ca44..33df3078 100644
--- a/web-v2/lib/training/pace-corpus.ts
+++ b/web-v2/lib/training/pace-corpus.ts
@@ -523,7 +523,7 @@ export const EVIDENCE_ENGINE_UNAVAILABLE_AUTHORITY = 0.75;
  * model stability — doctrine's "one run rarely rewrites the runner" states the
  * direction, not this number.
  */
-export const THRESHOLD_ANCHOR_DAILY_MOVE_CAP_S_PER_MI = 5;
+export const THRESHOLD_ANCHOR_DAILY_MOVE_CAP_S_PER_MI = 999;
 
 /**
  * SPLIT-LEVEL WORK-SEGMENT SHAPE, not an absolute HR band — 2026-08-31,

--- gate output (broken) ---
     × caps the newest session's move to the convention per elapsed day, and reports the uncapped read 3ms
     × the same session is allowed twice the move the day after — the belief converges over days, it is not frozen 0ms
     × excludes 07-16 (HR out of band) and 08-06 (abandoned), admits 09-01 at full authority, and caps its first-day move 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected false to be true // Object.is equality
AssertionError: expected 419 to be less than 419
AssertionError: expected false to be true // Object.is equality
      Tests  3 failed | 16 passed (19)

--- gate output (restored) ---
 Test Files  1 passed (1)
      Tests  19 passed (19)
```


## 5 · `projection-consumer-computes-its-own.log`

```
### projection-consumer-computes-its-own
mutation: sed -E "s/const \{ projectedSec \} = raceProjectionFromOutlook\(nextAOutlook\);/const projectedSec = predictRaceTime(47.8, distanceMi ?? 26.2); void raceProjectionFromOutlook(nextAOutlook);/" app/api/v5/races/route.ts
diff --git a/web-v2/app/api/v5/races/route.ts b/web-v2/app/api/v5/races/route.ts
index 8a6c001a..b727748d 100644
--- a/web-v2/app/api/v5/races/route.ts
+++ b/web-v2/app/api/v5/races/route.ts
@@ -388,7 +388,7 @@ async function handleGET(req: NextRequest) {
       const nextAOutlook = (distanceMi != null && distanceMi > 0)
         ? await resolveRaceOutlookBySlug(userId, nextA.slug, todayISO).catch(() => null)
         : null;
-      const { projectedSec } = raceProjectionFromOutlook(nextAOutlook);
+      const projectedSec = predictRaceTime(47.8, distanceMi ?? 26.2); void raceProjectionFromOutlook(nextAOutlook);
       const gapSec = (projectedSec != null && goalSec != null) ? projectedSec - goalSec : null;
 
       const stats: V5StatOut[] = [

--- gate output (broken) ---
     × app/api/v5/races/route.ts resolves through the outlook 2ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: app/api/v5/races/route.ts must not read predictRaceTime for a race projection: expected '\nimport { NextRequest, NextResponse …' not to match /predictRaceTime\(/
      Tests  1 failed | 12 passed (13)

--- gate output (restored) ---
 Test Files  1 passed (1)
      Tests  13 passed (13)
```


## 5 · `race-row-hr-cap-returns.log`

```
### race-row-hr-cap-returns
mutation: sed -E "s/hr_cap_bpm: null,\n          fuel_mi: fuelMi\(distance_mi\)/X/; /2026-09-01 · P0 · a race row carries NO/,/hr_cap_bpm: null,/ s/hr_cap_bpm: null,/hr_cap_bpm: lthr ? Math.round(lthr * 0.92) : null,/" lib/plan/spec-builder.ts
diff --git a/web-v2/lib/plan/spec-builder.ts b/web-v2/lib/plan/spec-builder.ts
index 1fa1e122..055bc1d5 100644
--- a/web-v2/lib/plan/spec-builder.ts
+++ b/web-v2/lib/plan/spec-builder.ts
@@ -1619,7 +1619,7 @@ export function buildWorkoutSpec(
           // allowance, checkpoint abort, informational flag — is written onto
           // this row by `lib/race/race-row-refresh.ts` right after authoring
           // and on every recompute; `hr_cap_bpm` stays absent by design.
-          hr_cap_bpm: null,
+          hr_cap_bpm: lthr ? Math.round(lthr * 0.92) : null,
           fuel_mi: fuelMi(distance_mi),
           ...withRules,
         },

--- gate output (broken) ---
     × 3 · the authoring-time race branch writes no HR cap for the wrist to alarm on 3ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected 'case \'race\': {\n\n\n\n\n\n\n\n\n   …' to match /hr_cap_bpm:\s*null/
      Tests  1 failed | 4 passed (5)

--- gate output (restored) ---
 Test Files  1 passed (1)
      Tests  5 passed (5)
```


## 5 · `race-row-staleness-recompute-skips-refresh.log`

```
### race-row-staleness-recompute-skips-refresh
mutation: sed -E "s/raceRefresh = await refreshRaceRowsForPlan\(planId, \{/raceRefresh = null; const _skipped = (planId, {/" lib/plan/recompute-paces.ts
diff --git a/web-v2/lib/plan/recompute-paces.ts b/web-v2/lib/plan/recompute-paces.ts
index d8580e1b..0968a523 100644
--- a/web-v2/lib/plan/recompute-paces.ts
+++ b/web-v2/lib/plan/recompute-paces.ts
@@ -565,7 +565,7 @@ export async function recomputePacesForPlan(
     // sat at 7:16/mi for a whole block while every rehearsal moved; that
     // was `race` in the exemption list and nothing on the other side of it.
     const { refreshRaceRowsForPlan } = await import('@/lib/race/race-row-refresh');
-    raceRefresh = await refreshRaceRowsForPlan(planId, {
+    raceRefresh = null; const _skipped = (planId, {
       client: tx, todayISO: today, source: `recompute-paces/${opts?.source ?? 'standalone'}`,
     }).catch((e) => {
       console.error(`[recomputePacesForPlan] race-row refresh failed · plan=${planId}`, e);

--- gate output (broken) ---
     × 1 · recompute-paces calls the dedicated race-row path inside its transaction 3ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected '\n\nimport { pool } from \'@/lib/db/p…' to match /refreshRaceRowsForPlan\(planId,\s*\{\…/
      Tests  1 failed | 4 passed (5)

--- gate output (restored) ---
 Test Files  1 passed (1)
      Tests  5 passed (5)
```


## 5 · `sealed-history-refresh-touches-sealed.log`

```
### sealed-history-refresh-touches-sealed
mutation: sed -E "s/if \(row.sealed \|\| row.date_iso < today\)/if (false \&\& (row.sealed || row.date_iso < today))/" lib/race/race-row-refresh.ts
diff --git a/web-v2/lib/race/race-row-refresh.ts b/web-v2/lib/race/race-row-refresh.ts
index 18a6570b..bef1d8fd 100644
--- a/web-v2/lib/race/race-row-refresh.ts
+++ b/web-v2/lib/race/race-row-refresh.ts
@@ -211,7 +211,7 @@ async function refreshRaceRowsCore(
   const result: RaceRowRefreshResult = { planId, userUuid, todayISO: today, rows: [], updated: 0, refused: 0 };
   for (const row of rows) {
     const before = { paceSecPerMi: row.pace_target_s_per_mi != null ? Number(row.pace_target_s_per_mi) : null };
-    if (row.sealed || row.date_iso < today) {
+    if (false && (row.sealed || row.date_iso < today)) {
       result.rows.push({ id: row.id, dateISO: row.date_iso, slug: null, action: 'sealed', before, after: null });
       continue;
     }

--- gate output (broken) ---
     × 4 · the refresh merges field-level and DROPS hr_cap_bpm (Rule 6) 2ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected '\nimport { pool } from \'@/lib/db/poo…' to match /if \(row\.sealed \|\| row\.date_iso <…/
      Tests  1 failed | 4 passed (5)

--- gate output (restored) ---
 Test Files  1 passed (1)
      Tests  5 passed (5)
```


## 5 · `staleness-lowers-support-not-level.log`

```
### staleness-lowers-support-not-level
mutation: the LEVEL weight discounted by age (supportWeight → weight) in thresholdCorpusFromInputs
diff --git a/web-v2/lib/training/pace-corpus.ts b/web-v2/lib/training/pace-corpus.ts
index 42d6ca44..02128e33 100644
--- a/web-v2/lib/training/pace-corpus.ts
+++ b/web-v2/lib/training/pace-corpus.ts
@@ -2070,7 +2070,7 @@ export function thresholdCorpusFromInputs(
     const reasons = stalenessFactor < 1
       ? [...o.authority.reasons, 'AGE_DISCOUNTED_BEYOND_BASE_WINDOW' as const]
       : o.authority.reasons;
-    return { ...o, supportWeight: o.weight * stalenessFactor, authority: { ...o.authority, stalenessFactor, ageDays: age, reasons } };
+    return { ...o, weight: o.weight * stalenessFactor, authority: { ...o.authority, stalenessFactor, ageDays: age, reasons } };
   };
   const all = observations.map(discounted);
   const settle = (pool: readonly PaceObservation[]): { windowDays: number; inWindow: PaceObservation[]; outside: ExcludedObservation[] } => {

--- gate output (broken) ---
     × the level is read at full weight across the widened window · only the support is discounted 3ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected 440 to be 425 // Object.is equality
      Tests  1 failed | 20 passed (21)

--- gate output (restored) ---
 Test Files  1 passed (1)
      Tests  21 passed (21)
```


## 5 · `threshold-admission-ee-no-evidence.log`

```
### threshold-admission-ee-no-evidence
mutation: sed -E "s/evidenceKind === 'no_evidence'/evidenceKind === 'never_matches'/" lib/training/pace-corpus.ts
diff --git a/web-v2/lib/training/pace-corpus.ts b/web-v2/lib/training/pace-corpus.ts
index 42d6ca44..ba145251 100644
--- a/web-v2/lib/training/pace-corpus.ts
+++ b/web-v2/lib/training/pace-corpus.ts
@@ -1653,7 +1653,7 @@ export function classifyThresholdCandidatesDetailed(
         detail: `labelled ${norm}; the Evidence Engine ${evidenceKind === 'unavailable' ? 'was not read' : `read ${evidenceKind}`} for threshold` });
       continue;
     }
-    if (evidenceKind === 'no_evidence') {
+    if (evidenceKind === 'never_matches') {
       excluded.push({ id: row.id, date: row.date, reason: 'EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE', paceSecPerMi: null,
         detail: 'the Evidence Engine classified this run as demonstrating no threshold capacity' });
       continue;

--- gate output (broken) ---
     × the Evidence Engine's no_evidence verdict EXCLUDES a run whatever its label says 5ms
     × excludes 07-16 (HR out of band) and 08-06 (abandoned), admits 09-01 at full authority, and caps its first-day move 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected [ { id: 't', …(11) } ] to have a length of +0 but got 1
AssertionError: expected 'HR_OUTSIDE_THRESHOLD_BAND' to be 'EVIDENCE_ENGINE_NO_THRESHOLD_EVIDENCE' // Object.is equality
      Tests  2 failed | 17 passed (19)

--- gate output (restored) ---
 Test Files  1 passed (1)
      Tests  19 passed (19)
```



---

# Part 6 · Live production change ledger, raw

Read-only queries against production before the first refresh, after the first refresh (run 33579154765 on `f967cab1`) and after the second (run 33581160907 on `16010927`).


## 6 · `p6-race-rows-before.txt`

```
id | date_iso | type | pace | lo | hi | hrcap | has_exec | plan_id | race_slug
wko_5069bc75e324a69a | 2026-09-13 | race | 444 | 439 | 449 |  | f | pln_9a57561debb776e5 | 
wko_613649879df83f38 | 2026-09-26 | race | 435 | 430 | 440 |  | f | pln_9a57561debb776e5 | 
wko_04050ebcd66f81d6 | 2026-11-08 | race | 425 | 420 | 430 | 168 | f | pln_9a57561debb776e5 | 
wko_60e4afb00a4e2c33 | 2026-12-01 | race_week_tuneup | 425 |  |  |  | f | pln_9a57561debb776e5 | 
wko_8bfa8647379342ba | 2026-12-06 | race | 436 | 431 | 441 | 155 | f | pln_9a57561debb776e5 | 
(5 rows)
```


## 6 · `p6-race-rows-after.txt`

```
id | date_iso | type | pace | lo | hi | hrcap | exec_target | exec_source | expected | goal | hr_range | hr_info | resolved_at
wko_5069bc75e324a69a | 2026-09-13 | race | 429 | 424 | 434 |  | 2660 | expected_race_day | 2658 |  | [168, 176] | false | 2026-09-02T01:23:02.368Z
wko_613649879df83f38 | 2026-09-26 | race | 435 | 430 | 440 |  | 2700 | stated_goal_within_range | 2656 | 2700 | [168, 176] | false | 2026-09-02T01:23:03.041Z
wko_04050ebcd66f81d6 | 2026-11-08 | race | 438 | 433 | 443 |  | 5740 | stated_goal_clamped_to_range_edge | 5887 | 5400 | [161, 168] | false | 2026-09-02T01:23:03.708Z
wko_60e4afb00a4e2c33 | 2026-12-01 | race_week_tuneup | 425 |  |  |  |  |  |  |  |  |  | 
wko_8bfa8647379342ba | 2026-12-06 | race | 451 | 446 | 456 |  | 11820 | stated_goal_clamped_to_range_edge | 12194 | 10800 | [148, 160] | false | 2026-09-02T01:23:04.404Z
(5 rows)
```


## 6 · `p6-race-rows-after2.txt`

```
id | date_iso | type | pace | lo | hi | hrcap | exec_target | exec_source | resolved_at
wko_5069bc75e324a69a | 2026-09-13 | race | 429 | 424 | 434 |  | 2660 | expected_race_day | 2026-09-02T01:23:02.368Z
wko_613649879df83f38 | 2026-09-26 | race | 435 | 430 | 440 |  | 2700 | stated_goal_within_range | 2026-09-02T01:23:03.041Z
wko_04050ebcd66f81d6 | 2026-11-08 | race | 438 | 433 | 443 |  | 5740 | stated_goal_clamped_to_range_edge | 2026-09-02T01:23:03.708Z
wko_60e4afb00a4e2c33 | 2026-12-01 | race_week_tuneup | 451 | 446 | 456 |  | 11820 | stated_goal_clamped_to_range_edge | 2026-09-02T01:54:04.545Z
wko_8bfa8647379342ba | 2026-12-06 | race | 451 | 446 | 456 |  | 11820 | stated_goal_clamped_to_range_edge | 2026-09-02T01:23:04.404Z
(5 rows)
```


## 6 · `p6-stamp-after.txt`

```
jsonb_pretty
{
    "at": "2026-09-02T01:23:04.412Z",
    "rows": [
        {
            "id": "wko_5069bc75e324a69a",
            "date": "2026-09-13",
            "pace": 429,
            "action": "updated",
            "reason": null
        },
        {
            "id": "wko_613649879df83f38",
            "date": "2026-09-26",
            "pace": 435,
            "action": "updated",
            "reason": null
        },
        {
            "id": "wko_04050ebcd66f81d6",
            "date": "2026-11-08",
            "pace": 438,
            "action": "updated",
            "reason": null
        },
        {
            "id": "wko_8bfa8647379342ba",
            "date": "2026-12-06",
            "pace": 451,
            "action": "updated",
            "reason": null
        }
    ],
    "source": "cron/snapshot-projections",
    "refused": 0,
    "updated": 4
}
(1 row)
```


## 6 · `p6-stamp-after2.txt`

```
at|updated|refused
2026-09-02T01:54:05.161Z|1|0
(1 row)
```


## 6 · `p6-sealed-checksum-before.txt`

```
sealed_rows | checksum
7 | 1f9bc33de7f4cbb10c6807304305e1af
(1 row)
```


## 6 · `p6-sealed-checksum-after.txt`

```
sealed_rows | checksum
7 | 1f9bc33de7f4cbb10c6807304305e1af
(1 row)
```


## 6 · `p6-sealed-checksum-after2.txt`

```
sealed_rows | checksum
7 | 1f9bc33de7f4cbb10c6807304305e1af
(1 row)
```


## 6 · `p6-goals-before.txt`

```
slug | goal | goal_s
dodgers | 0:45:00 | 2700
run-malibu | 1:30:00 | 5400
cim | 3:00:00 | 10800
santa-monica-10k-2026-09-13 |  | 
(4 rows)
```


## 6 · `p6-goals-after.txt`

```
slug | goal | goal_s
dodgers | 0:45:00 | 2700
run-malibu | 1:30:00 | 5400
cim | 3:00:00 | 10800
santa-monica-10k-2026-09-13 |  | 
(4 rows)
```



---

# Part 7 · Race consistency, goal isolation, CIM rows, parity

From `web-v2/scripts/p0-proof/race-consistency.ts` (after the first refresh) and `authoring-recompute-parity.ts`, both read-only against production at `f967cab1`/`3c2d1eaa`.


## 7.1 · Canonical reads

```json
{
 "anchors": {
  "thresholdSecPerMi": 430,
  "intervalSecPerMi": 401,
  "repetitionSecPerMi": 365,
  "easyCeilingSecPerMi": 502,
  "shakeoutCeilingSecPerMi": 532,
  "marathonSecPerMi": 475,
  "basis": {
   "threshold": {
    "sourceMode": "direct",
    "confidence": 0.8400000000000001,
    "vdot": 47.8
   },
   "highIntensity": {
    "sourceMode": "vdot_fallback",
    "confidence": 0.5
   },
   "easyCeiling": {
    "sourceMode": "direct",
    "confidence": 0.6336475048158089
   },
   "marathon": {
    "sourceMode": "direct",
    "confidence": 0.8400000000000001,
    "enduranceExponent": 1.0869051877057179,
    "personallyEvidenced": true
   }
  }
 },
 "threshold": {
  "pace": 430,
  "vdot": 47.8,
  "confidence": 0.8400000000000001,
  "sourceMode": "direct",
  "evidenceIds": [
   "-258355938987883",
   "-87627419857791",
   "-2351254210708"
  ],
  "reasons": [
   "DIRECT_CORROBORATED_THRESHOLD_EVIDENCE",
   "THREE_RECENT_CORROBORATING_SESSIONS",
   "OBSERVATIONS_AGREE",
   "FRESH_EVIDENCE"
  ]
 },
 "durability": {
  "ok": true,
  "value": 1.0869051877057179,
  "confidence": 0.6209679155676007,
  "evidenceScore": 0.6551267278916443,
  "rawFittedExponent": 1.1010686765785074,
  "populationPrior": 1.06,
  "rmsLogResidual": 0.02498075341893887,
  "races": 5,
  "distinctDistances": 2,
  "supporting": [
   {
    "slug": "rose-bowl-half-2026",
    "date": "2026-01-18",
    "distanceMi": 13.109,
    "finishSec": 5918,
    "priority": "A",
    "weight": 1
   },
   {
    "slug": "disney-half-2026",
    "date": "2026-02-01",
    "distanceMi": 13.109,
    "finishSec": 5694,
    "priority": "A",
    "weight": 1
   },
   {
    "slug": "la-marathon-2026",
    "date": "2026-03-08",
    "distanceMi": 26.219,
    "finishSec": 12700,
    "priority": "A",
    "weight": 1
   },
   {
    "slug": "sombrero-half",
    "date": "2026-05-03",
    "distanceMi": 13.16,
    "finishSec": 6057,
    "priority": "C",
    "weight": 0.35
   },
   {
    "slug": "americas-finest-city",
    "date": "2026-08-16",
    "distanceMi": 13.1,
    "finishSec": 6113,
    "priority": "A",
    "weight": 1
   }
  ]
 }
}
```


## 7.2 · `cim` · the outlook

```json
{
 "race": {
  "slug": "cim",
  "name": "California International Marathon",
  "distanceMi": 26.22,
  "dateISO": "2026-12-06",
  "priority": "A",
  "statedGoalSec": 10800,
  "isPast": false,
  "daysToRace": 96,
  "weeksToRace": 13.7
 },
 "statedGoal": {
  "sec": 10800,
  "paceSecPerMi": 412
 },
 "capacity": {
  "thresholdSecPerMi": 430,
  "thresholdVdot": 47.8,
  "sourceMode": "direct",
  "confidence": 0.8400000000000001,
  "evidenceIds": [
   "-258355938987883",
   "-87627419857791",
   "-2351254210708"
  ],
  "newestEvidenceISO": "2026-09-01",
  "durabilityExponent": 1.0869051877057179,
  "durabilityRawExponent": 1.1010686765785074,
  "durabilityConfidence": 0.6209679155676007,
  "durabilityRaces": 5,
  "personallyEvidenced": true
 },
 "currentProjection": {
  "expectedSec": 12390,
  "likelyRangeSec": [
   12018,
   12762
  ],
  "confidence": 0.6209679155676007,
  "basis": "durability_blend",
  "danielsSec": 11881,
  "durabilitySec": 12701,
  "durabilityWeight": 0.6209679155676007,
  "specificityAdjustmentPct": null,
  "primaryLimiter": "endurance",
  "reasons": [
   "threshold direct \u00b7 confidence 0.84",
   "personal exponent 1.087 from 5 races \u00b7 weight 0.62"
  ]
 },
 "trainingPrescription": {
  "kind": "marathon_specific",
  "paceSecPerMi": 475,
  "source": "canonical_anchors",
  "enduranceExponent": 1.0869051877057179,
  "personallyEvidenced": true,
  "thresholdSecPerMi": 430,
  "whyThisPace": "Threshold 7:10/mi carried to 26.2 mi through your own endurance exponent (1.087). This is today's capacity, not race day's; the rehearsal teaches the effort, the block earns the pace."
 },
 "expectedImprovement": {
  "gainVdot": 2.5982142857142856,
  "gainRangeVdot": [
   1.9285714285714284,
   2.6785714285714284
  ],
  "buildWeeks": 10.7,
  "taperWeeks": 3,
  "executionQuality": 0.97,
  "responseFactor": 1,
  "overPerformanceBonusVdot": 0,
  "bindingCap": "runway",
  "basis": "plan_stimulus_and_execution",
  "reasons": [
   "GAIN_BOUNDED_BY_RUNWAY",
   "HISTORICAL_RESPONSE_UNKNOWN_POPULATION_RATE"
  ],
  "confidence": 0.585
 },
 "expectedRaceDay": {
  "expectedSec": 12194,
  "likelyRangeSec": [
   11817,
   12615
  ],
  "confidence": 0.36,
  "projectedVdot": 50.4,
  "basis": "trajectory",
  "reasons": [
   "2.6 VDOT expected from 10.7 build weeks at execution 0.97",
   "GAIN_BOUNDED_BY_RUNWAY",
   "HISTORICAL_RESPONSE_UNKNOWN_POPULATION_RATE"
  ]
 },
 "execution": {
  "targetSec": 11820,
  "paceSecPerMi": 451,
  "paceBandSecPerMi": [
   446,
   456
  ],
  "source": "stated_goal_clamped_to_range_edge",
  "strategyLabel": "Controlled start \u00b7 7:31/mi average",
  "reasonVsExpected": "Your goal (3:00:00) is faster than the likely range's fast edge (3:16:57) \u00b7 race to the edge; the goal stays yours.",
  "hr": {
   "lthrBpm": 168,
   "distanceCategory": "m",
   "expectedRangeBpm": [
    148,
    160
   ],
   "earlyCeilingBpm": 148,
   "earlyThroughMi": 10,
   "lateAllowanceBpm": 165,
   "checkpointMi": 10,
   "checkpointAbortBpm": 163,
   "informationalOnly": false,
   "evidence": {
    "comparableEfforts": 7,
    "observedMeanHr": 154,
    "conflictBpm": -11,
    "efforts": [
     {
      "id": "-245190372869167",
      "dateISO": "2026-08-30",
      "distanceMi": 13.49,
      "paceSecPerMi": 456.8569310600445,
      "avgHr": 159,
      "kind": "long"
     },
     {
      "id": "-522630830",
      "dateISO": "2026-05-03",
      "distanceMi": 13.44,
      "paceSecPerMi": 450.74404761904765,
      "avgHr": 163,
      "kind": "other"
     },
     {
      "id": "-251580989059278",
      "dateISO": "2026-06-18",
      "distanceMi": 8.15,
      "paceSecPerMi": 473.1288343558282,
      "avgHr": 149,
      "kind": "other"
     },
     {
      "id": "-127657343028184",
      "dateISO": "2026-06-21",
      "distanceMi": 13.15,
      "paceSecPerMi": 447.3764258555133,
      "avgHr": 141,
      "kind": "long"
     },
     {
      "id": "-2351254210708",
      "dateISO": "2026-06-23",
      "distanceMi": 8.12,
      "paceSecPerMi": 466.9950738916257,
      "avgHr": 149,
      "kind": "other"
     },
     {
      "id": "-164786796432085",
      "dateISO": "2026-08-09",
      "distanceMi": 12.37,
      "paceSecPerMi": 441.3096200485045,
      "avgHr": 157,
      "kind": "long"
     },
     {
      "id": "17654375467",
      "dateISO": "2026-03-08",
      "distanceMi": 26.7,
      "paceSecPerMi": 472.84644194756555,
      "avgHr": 161.7,
      "kind": "other"
     }
    ]
   },
   "reasons": [
    "DOCTRINE_BAND_FOR_DISTANCE",
    "VALIDATED_AGAINST_OWN_EFFORTS"
   ],
   "citation": "Research/08-pacing-and-race-week.md \u00a76.1 (race HR ceilings by distance, %LTHR; drift 3-5 bpm/hour)"
  }
 },
 "goalFeasibility": {
  "status": "unlikely_currently",
  "gapSec": 1394,
  "gapToRangeEdgeSec": 1017,
  "reasons": [
   "expected 3:23:14 \u00b7 range 3:16:57-3:30:15 \u00b7 goal 3:00:00"
  ]
 },
 "coachSet": null,
 "bridge": [
  {
   "step": "current_capacity",
   "label": "Current threshold capacity",
   "value": "7:10/mi (VDOT 47.8)",
   "valueSec": null,
   "paceSecPerMi": 430,
   "rangeSec": null,
   "confidence": 0.8400000000000001,
   "evidence": [
    "run -258355938987883",
    "run -87627419857791",
    "run -2351254210708"
   ],
   "changeTrigger": "Three corroborating threshold sessions faster or slower than this, with heart rate in the band.",
   "differsFromPrevious": null
  },
  {
   "step": "current_projection",
   "label": "What you could race today at 26.2 mi",
   "value": "3:26:30",
   "valueSec": 12390,
   "paceSecPerMi": 473,
   "rangeSec": [
    12018,
    12762
   ],
   "confidence": 0.6209679155676007,
   "evidence": [
    "threshold direct \u00b7 confidence 0.84",
    "personal exponent 1.087 from 5 races \u00b7 weight 0.62"
   ],
   "changeTrigger": "A change in threshold capacity, or a new graded race that moves your endurance exponent.",
   "differsFromPrevious": "Threshold pace carried to the race distance through your own endurance exponent, not the population table."
  },
  {
   "step": "training_prescription",
   "label": "Marathon-pace training now",
   "value": "7:55/mi",
   "valueSec": null,
   "paceSecPerMi": 475,
   "rangeSec": null,
   "confidence": 0.8400000000000001,
   "evidence": [
    "Threshold 7:10/mi carried to 26.2 mi through your own endurance exponent (1.087). This is today's capacity, not race day's; the rehearsal teaches the effort, the block earns the pace."
   ],
   "changeTrigger": "The threshold anchor or the endurance exponent moving; rehearsals at this pace that stay controlled will move the anchor.",
   "differsFromPrevious": "Same capacity, priced as a training stimulus: it may sit slower than race day because it is today's pace, not the pace the block is expected to earn."
  },
  {
   "step": "expected_improvement",
   "label": "Improvement the remaining block can deliver",
   "value": "+2.6 VDOT (1.9-2.7)",
   "valueSec": null,
   "paceSecPerMi": null,
   "rangeSec": null,
   "confidence": 0.585,
   "evidence": [
    "10.7 build weeks \u00b7 execution 0.97 from 2 recent test points",
    "GAIN_BOUNDED_BY_RUNWAY",
    "HISTORICAL_RESPONSE_UNKNOWN_POPULATION_RATE"
   ],
   "changeTrigger": "Executing key sessions moves this up; missed or uncontrolled sessions move it down; time passing alone never moves it.",
   "differsFromPrevious": "Sized from the runway and how the plan is being executed, never from the goal."
  },
  {
   "step": "expected_race_day",
   "label": "Expected on race day",
   "value": "3:23:14",
   "valueSec": 12194,
   "paceSecPerMi": 465,
   "rangeSec": [
    11817,
    12615
   ],
   "confidence": 0.36,
   "evidence": [
    "2.6 VDOT expected from 10.7 build weeks at execution 0.97",
    "GAIN_BOUNDED_BY_RUNWAY",
    "HISTORICAL_RESPONSE_UNKNOWN_POPULATION_RATE"
   ],
   "changeTrigger": "Every input above; the range narrows as execution evidence accumulates.",
   "differsFromPrevious": "Current projection plus the expected improvement, converted through the same equivalence."
  },
  {
   "step": "execution_target",
   "label": "What to run on the day",
   "value": "3:17:00 \u00b7 7:31/mi",
   "valueSec": 11820,
   "paceSecPerMi": 451,
   "rangeSec": null,
   "confidence": 0.36,
   "evidence": [
    "Your goal (3:00:00) is faster than the likely range's fast edge (3:16:57) \u00b7 race to the edge; the goal stays yours.",
    "HR 148-160 expected"
   ],
   "changeTrigger": "The expected race-day range moving, or you changing your goal.",
   "differsFromPrevious": "Pulled toward your goal as far as the likely range allows, and no further."
  }
 ],
 "flags": []
}
```


## 7.3 · `cim` · every library consumer

```json
{
 "race-projection.raceProjectionFromOutlook (Races list / Race detail \"Projected\")": {
  "projectedSec": 12194,
  "basis": "trajectory",
  "likelyRangeSec": [
   11817,
   12615
  ],
  "confidenceInterval": null,
  "confidenceLabel": null,
  "confidence": 0.36
 },
 "effective-race-target.loadEffectiveRaceTarget (watch race day / execution plan / api race detail)": {
  "targetSec": 11820,
  "source": "projection",
  "goalSec": 10800,
  "projectionSec": 12194
 },
 "coach-goal-load.loadCoachGoalForRace (coach-set A/B/C \u00b7 null when a goal is stated)": null,
 "plan_workouts race row (plan row \u00b7 watch reads its spec)": [
  {
   "id": "wko_8bfa8647379342ba",
   "date_iso": "2026-12-06",
   "type": "race",
   "pace_target_s_per_mi": 451,
   "distance_mi": "26.22",
   "lo": "446",
   "hi": "456",
   "hr_cap_bpm": null,
   "race_execution": {
    "reason": "Your goal (3:00:00) is faster than the likely range's fast edge (3:16:57) \u00b7 race to the edge; the goal stays yours.",
    "source": "stated_goal_clamped_to_range_edge",
    "target_sec": 11820,
    "feasibility": "unlikely_currently",
    "resolved_at": "2026-09-02T01:23:04.404Z",
    "model_version": "1.0.0",
    "threshold_vdot": 47.8,
    "stated_goal_sec": 10800,
    "likely_range_sec": [
     11817,
     12615
    ],
    "expected_gain_vdot": 2.5982142857142856,
    "threshold_s_per_mi": 430,
    "durability_exponent": 1.0869051877057179,
    "target_pace_s_per_mi": 451,
    "expected_race_day_sec": 12194,
    "current_projection_sec": 12390,
    "training_pace_s_per_mi": 475
   },
   "race_hr": {
    "reasons": [
     "DOCTRINE_BAND_FOR_DISTANCE",
     "VALIDATED_AGAINST_OWN_EFFORTS"
    ],
    "evidence": {
     "conflict_bpm": -11,
     "observed_mean_hr": 154,
     "comparable_efforts": 7
    },
    "lthr_bpm": 168,
    "checkpoint_mi": 10,
    "early_through_mi": 10,
    "early_ceiling_bpm": 148,
    "expected_range_bpm": [
     148,
     160
    ],
    "informational_only": false,
    "late_allowance_bpm": 165,
    "checkpoint_abort_bpm": 163
   },
   "plan_id": "pln_9a57561debb776e5"
  }
 ]
}
```


## 7.2 · `santa-monica-10k-2026-09-13` · the outlook

```json
{
 "race": {
  "slug": "santa-monica-10k-2026-09-13",
  "name": "Santa Monica 10k",
  "distanceMi": 6.2,
  "dateISO": "2026-09-13",
  "priority": "B",
  "statedGoalSec": null,
  "isPast": false,
  "daysToRace": 12,
  "weeksToRace": 1.7
 },
 "statedGoal": {
  "sec": null,
  "paceSecPerMi": null
 },
 "capacity": {
  "thresholdSecPerMi": 430,
  "thresholdVdot": 47.8,
  "sourceMode": "direct",
  "confidence": 0.8400000000000001,
  "evidenceIds": [
   "-258355938987883",
   "-87627419857791",
   "-2351254210708"
  ],
  "newestEvidenceISO": "2026-09-01",
  "durabilityExponent": 1.0869051877057179,
  "durabilityRawExponent": 1.1010686765785074,
  "durabilityConfidence": 0.6209679155676007,
  "durabilityRaces": 5,
  "personallyEvidenced": true
 },
 "currentProjection": {
  "expectedSec": 2658,
  "likelyRangeSec": [
   2605,
   2711
  ],
  "confidence": 0.6209679155676007,
  "basis": "durability_blend",
  "danielsSec": 2571,
  "durabilitySec": 2711,
  "durabilityWeight": 0.6209679155676007,
  "specificityAdjustmentPct": null,
  "primaryLimiter": "endurance",
  "reasons": [
   "threshold direct \u00b7 confidence 0.84",
   "personal exponent 1.087 from 5 races \u00b7 weight 0.62"
  ]
 },
 "trainingPrescription": {
  "kind": "race_specific",
  "paceSecPerMi": 429,
  "source": "canonical_anchors",
  "enduranceExponent": 1.0869051877057179,
  "personallyEvidenced": true,
  "thresholdSecPerMi": 430,
  "whyThisPace": "Today's projected race pace at 6.2 mi from current capacity."
 },
 "expectedImprovement": {
  "gainVdot": 0,
  "gainRangeVdot": [
   0,
   0
  ],
  "buildWeeks": 0,
  "taperWeeks": 2,
  "executionQuality": 0.97,
  "responseFactor": 1,
  "overPerformanceBonusVdot": 0,
  "bindingCap": "none",
  "basis": "no_runway",
  "reasons": [
   "NO_BUILD_WEEKS_REMAIN",
   "HISTORICAL_RESPONSE_UNKNOWN_POPULATION_RATE"
  ],
  "confidence": 0.6499999999999999
 },
 "expectedRaceDay": {
  "expectedSec": 2658,
  "likelyRangeSec": [
   2605,
   2711
  ],
  "confidence": 0.4,
  "projectedVdot": 47.8,
  "basis": "current_projection",
  "reasons": [
   "0 VDOT expected from 0 build weeks at execution 0.97",
   "NO_BUILD_WEEKS_REMAIN",
   "HISTORICAL_RESPONSE_UNKNOWN_POPULATION_RATE"
  ]
 },
 "execution": {
  "targetSec": 2660,
  "paceSecPerMi": 429,
  "paceBandSecPerMi": [
   424,
   434
  ],
  "source": "expected_race_day",
  "strategyLabel": "Controlled start \u00b7 7:09/mi average",
  "reasonVsExpected": "No stated goal \u00b7 race to where this build is expected to land you.",
  "hr": {
   "lthrBpm": 168,
   "distanceCategory": "10k",
   "expectedRangeBpm": [
    168,
    176
   ],
   "earlyCeilingBpm": 168,
   "earlyThroughMi": 2,
   "lateAllowanceBpm": 181,
   "checkpointMi": 2,
   "checkpointAbortBpm": 179,
   "informationalOnly": false,
   "evidence": {
    "comparableEfforts": 2,
    "observedMeanHr": 149,
    "conflictBpm": -32,
    "efforts": [
     {
      "id": "-127657343028184",
      "dateISO": "2026-06-21",
      "distanceMi": 13.15,
      "paceSecPerMi": 447.3764258555133,
      "avgHr": 141,
      "kind": "long"
     },
     {
      "id": "-164786796432085",
      "dateISO": "2026-08-09",
      "distanceMi": 12.37,
      "paceSecPerMi": 441.3096200485045,
      "avgHr": 157,
      "kind": "long"
     }
    ]
   },
   "reasons": [
    "DOCTRINE_BAND_FOR_DISTANCE",
    "VALIDATED_AGAINST_OWN_EFFORTS"
   ],
   "citation": "Research/08-pacing-and-race-week.md \u00a76.1 (race HR ceilings by distance, %LTHR; drift 3-5 bpm/hour)"
  }
 },
 "goalFeasibility": {
  "status": "no_goal",
  "gapSec": null,
  "gapToRangeEdgeSec": null,
  "reasons": [
   "NO_STATED_GOAL"
  ]
 },
 "coachSet": {
  "aSec": 2605,
  "bSec": 2660,
  "cSec": 2710,
  "basis": "expected_race_day_range"
 },
 "bridge": [
  {
   "step": "current_capacity",
   "label": "Current threshold capacity",
   "value": "7:10/mi (VDOT 47.8)",
   "valueSec": null,
   "paceSecPerMi": 430,
   "rangeSec": null,
   "confidence": 0.8400000000000001,
   "evidence": [
    "run -258355938987883",
    "run -87627419857791",
    "run -2351254210708"
   ],
   "changeTrigger": "Three corroborating threshold sessions faster or slower than this, with heart rate in the band.",
   "differsFromPrevious": null
  },
  {
   "step": "current_projection",
   "label": "What you could race today at 6.2 mi",
   "value": "44:18",
   "valueSec": 2658,
   "paceSecPerMi": 429,
   "rangeSec": [
    2605,
    2711
   ],
   "confidence": 0.6209679155676007,
   "evidence": [
    "threshold direct \u00b7 confidence 0.84",
    "personal exponent 1.087 from 5 races \u00b7 weight 0.62"
   ],
   "changeTrigger": "A change in threshold capacity, or a new graded race that moves your endurance exponent.",
   "differsFromPrevious": "Threshold pace carried to the race distance through your own endurance exponent, not the population table."
  },
  {
   "step": "training_prescription",
   "label": "Race-pace training now",
   "value": "7:09/mi",
   "valueSec": null,
   "paceSecPerMi": 429,
   "rangeSec": null,
   "confidence": 0.8400000000000001,
   "evidence": [
    "Today's projected race pace at 6.2 mi from current capacity."
   ],
   "changeTrigger": "The threshold anchor or the endurance exponent moving; rehearsals at this pace that stay controlled will move the anchor.",
   "differsFromPrevious": null
  },
  {
   "step": "expected_improvement",
   "label": "Improvement the remaining block can deliver",
   "value": "+0 VDOT (0-0)",
   "valueSec": null,
   "paceSecPerMi": null,
   "rangeSec": null,
   "confidence": 0.6499999999999999,
   "evidence": [
    "0 build weeks \u00b7 execution 0.97 from 2 recent test points",
    "NO_BUILD_WEEKS_REMAIN",
    "HISTORICAL_RESPONSE_UNKNOWN_POPULATION_RATE"
   ],
   "changeTrigger": "Executing key sessions moves this up; missed or uncontrolled sessions move it down; time passing alone never moves it.",
   "differsFromPrevious": "Sized from the runway and how the plan is being executed, never from the goal."
  },
  {
   "step": "expected_race_day",
   "label": "Expected on race day",
   "value": "44:18",
   "valueSec": 2658,
   "paceSecPerMi": 429,
   "rangeSec": [
    2605,
    2711
   ],
   "confidence": 0.4,
   "evidence": [
    "0 VDOT expected from 0 build weeks at execution 0.97",
    "NO_BUILD_WEEKS_REMAIN",
    "HISTORICAL_RESPONSE_UNKNOWN_POPULATION_RATE"
   ],
   "changeTrigger": "Every input above; the range narrows as execution evidence accumulates.",
   "differsFromPrevious": "Current projection plus the expected improvement, converted through the same equivalence."
  },
  {
   "step": "execution_target",
   "label": "What to run on the day",
   "value": "44:20 \u00b7 7:09/mi",
   "valueSec": 2660,
   "paceSecPerMi": 429,
   "rangeSec": null,
   "confidence": 0.4,
   "evidence": [
    "No stated goal \u00b7 race to where this build is expected to land you.",
    "HR 168-176 expected"
   ],
   "changeTrigger": "The expected race-day range moving, or you changing your goal.",
   "differsFromPrevious": null
  }
 ],
 "flags": []
}
```


## 7.3 · `santa-monica-10k-2026-09-13` · every library consumer

```json
{
 "race-projection.raceProjectionFromOutlook (Races list / Race detail \"Projected\")": {
  "projectedSec": 2658,
  "basis": "equivalence",
  "likelyRangeSec": [
   2605,
   2711
  ],
  "confidenceInterval": {
   "lo": 2605,
   "hi": 2711,
   "pct": 2,
   "method": "research-span"
  },
  "confidenceLabel": null,
  "confidence": 0.6209679155676007
 },
 "effective-race-target.loadEffectiveRaceTarget (watch race day / execution plan / api race detail)": null,
 "coach-goal-load.loadCoachGoalForRace (coach-set A/B/C \u00b7 null when a goal is stated)": {
  "kind": "time",
  "coachSet": true,
  "modelled": true,
  "aSec": 2605,
  "bSec": 2660,
  "cSec": 2710,
  "aDisplay": "43:25",
  "bDisplay": "44:20",
  "cDisplay": "45:10",
  "ciPct": 2,
  "oneSided": false,
  "specificityAdjustedPct": null,
  "method": "race-outlook",
  "personalExponent": 1.0869051877057179,
  "personalExponentConfidence": 0.6209679155676007,
  "vdotBasis": null,
  "hillAdjustedSec": null,
  "hillGainFtPerMi": null,
  "effortLine": null,
  "line": "Coach set from your current fitness. Yours to edit.",
  "setAt": "2026-09-01"
 },
 "plan_workouts race row (plan row \u00b7 watch reads its spec)": [
  {
   "id": "wko_5069bc75e324a69a",
   "date_iso": "2026-09-13",
   "type": "race",
   "pace_target_s_per_mi": 429,
   "distance_mi": "6.2",
   "lo": "424",
   "hi": "434",
   "hr_cap_bpm": null,
   "race_execution": {
    "reason": "No stated goal \u00b7 race to where this build is expected to land you.",
    "source": "expected_race_day",
    "target_sec": 2660,
    "feasibility": "no_goal",
    "resolved_at": "2026-09-02T01:23:02.368Z",
    "model_version": "1.0.0",
    "threshold_vdot": 47.8,
    "stated_goal_sec": null,
    "likely_range_sec": [
     2605,
     2711
    ],
    "expected_gain_vdot": 0,
    "threshold_s_per_mi": 430,
    "durability_exponent": 1.0869051877057179,
    "target_pace_s_per_mi": 429,
    "expected_race_day_sec": 2658,
    "current_projection_sec": 2658,
    "training_pace_s_per_mi": 429
   },
   "race_hr": {
    "reasons": [
     "DOCTRINE_BAND_FOR_DISTANCE",
     "VALIDATED_AGAINST_OWN_EFFORTS"
    ],
    "evidence": {
     "conflict_bpm": -32,
     "observed_mean_hr": 149,
     "comparable_efforts": 2
    },
    "lthr_bpm": 168,
    "checkpoint_mi": 2,
    "early_through_mi": 2,
    "early_ceiling_bpm": 168,
    "expected_range_bpm": [
     168,
     176
    ],
    "informational_only": false,
    "late_allowance_bpm": 181,
    "checkpoint_abort_bpm": 179
   },
   "plan_id": "pln_9a57561debb776e5"
  }
 ]
}
```


## 7.4 · `goal-gap.computeGoalGap (Progress / plan drift / proposals)`

```json
{
 "mode": "race",
 "raceSlug": "cim",
 "goalSec": 10800,
 "expectedRaceDaySec": 12194,
 "likelyRangeSec": [
  11817,
  12615
 ],
 "trajectoryBasis": "trajectory",
 "gapSec": 1394,
 "status": "unclosable",
 "weeksRemaining": 13,
 "whatClosesIt": [
  "Gap is wider than what is typically closable in 13 weeks.",
  "The goal stays on the board \u00b7 the projection is what moves.",
  "Training stays honest \u00b7 race-day execution still matters at any goal."
 ]
}
```


## 7.4 · `gap-report.composeGapReport (morning brief / readiness brief)`

```json
{
 "headline": "Tracking 3:23:14 \u00b7 Gap to 3:00:00 is wider than 13 weeks can close.",
 "expectedRaceDaySec": 12194,
 "goalSec": 10800,
 "gapSec": 1394,
 "status": "unclosable",
 "confidenceBand": {
  "p25Sec": 11817,
  "medianSec": 12194,
  "p75Sec": 12615
 },
 "alternativeRanges": {
  "a": {
   "sec": 11817,
   "label": "A-goal \u00b7 stretch but possible"
  },
  "b": {
   "sec": 12194,
   "label": "B-goal \u00b7 where you're tracking"
  },
  "c": {
   "sec": 12615,
   "label": "C-goal \u00b7 safe + executable"
  }
 }
}
```


## 7.4 · `goal-projection-resolve.resolveNextAGoalProjection (snapshot cron · projection-changed notification)`

```json
{
 "raceSlug": "cim",
 "goalSec": 10800,
 "projectedSec": 12194,
 "basis": "trajectory"
}
```


## 7.4 · `goal-outlook.resolveGoalOutlookProjection (goal outlook note)`

```json
{
 "projectedSec": 12194,
 "basis": "trajectory"
}
```


## 7.5 · Goal isolation (same reads, four stated goals)

```json
{
 "stated 3:00": {
  "capacity": {
   "threshold": 430,
   "vdot": 47.8,
   "confidence": 0.8400000000000001,
   "exponent": 1.0869051877057179,
   "evidenceIds": [
    "-258355938987883",
    "-87627419857791",
    "-2351254210708"
   ]
  },
  "currentProjectionSec": 12390,
  "trainingPaceSecPerMi": 475,
  "expectedGainVdot": 2.5982142857142856,
  "expectedRaceDaySec": 12194,
  "likelyRangeSec": [
   11817,
   12615
  ],
  "executionTargetSec": 11820,
  "executionSource": "stated_goal_clamped_to_range_edge",
  "feasibility": "unlikely_currently"
 },
 "soft 3:30": {
  "capacity": {
   "threshold": 430,
   "vdot": 47.8,
   "confidence": 0.8400000000000001,
   "exponent": 1.0869051877057179,
   "evidenceIds": [
    "-258355938987883",
    "-87627419857791",
    "-2351254210708"
   ]
  },
  "currentProjectionSec": 12390,
  "trainingPaceSecPerMi": 475,
  "expectedGainVdot": 2.5982142857142856,
  "expectedRaceDaySec": 12194,
  "likelyRangeSec": [
   11817,
   12615
  ],
  "executionTargetSec": 12600,
  "executionSource": "stated_goal_within_range",
  "feasibility": "comfortable"
 },
 "extreme 2:30": {
  "capacity": {
   "threshold": 430,
   "vdot": 47.8,
   "confidence": 0.8400000000000001,
   "exponent": 1.0869051877057179,
   "evidenceIds": [
    "-258355938987883",
    "-87627419857791",
    "-2351254210708"
   ]
  },
  "currentProjectionSec": 12390,
  "trainingPaceSecPerMi": 475,
  "expectedGainVdot": 2.5982142857142856,
  "expectedRaceDaySec": 12194,
  "likelyRangeSec": [
   11817,
   12615
  ],
  "executionTargetSec": 11820,
  "executionSource": "stated_goal_clamped_to_range_edge",
  "feasibility": "unlikely_currently"
 },
 "none": {
  "capacity": {
   "threshold": 430,
   "vdot": 47.8,
   "confidence": 0.8400000000000001,
   "exponent": 1.0869051877057179,
   "evidenceIds": [
    "-258355938987883",
    "-87627419857791",
    "-2351254210708"
   ]
  },
  "currentProjectionSec": 12390,
  "trainingPaceSecPerMi": 475,
  "expectedGainVdot": 2.5982142857142856,
  "expectedRaceDaySec": 12194,
  "likelyRangeSec": [
   11817,
   12615
  ],
  "executionTargetSec": 12190,
  "executionSource": "expected_race_day",
  "feasibility": "no_goal"
 }
}
```


## 7.6 · CIM race-specific rows (live)

```json
[
 {
  "id": "wko_5069bc75e324a69a",
  "date_iso": "2026-09-13",
  "type": "race",
  "sub_label": "RACE",
  "distance_mi": "6.2",
  "pace_target_s_per_mi": 429,
  "is_quality": true,
  "is_long": true,
  "kind": "long",
  "lo": "424",
  "hi": "434",
  "hr_cap_bpm": null,
  "finish": null,
  "race_execution": {
   "reason": "No stated goal \u00b7 race to where this build is expected to land you.",
   "source": "expected_race_day",
   "target_sec": 2660,
   "feasibility": "no_goal",
   "resolved_at": "2026-09-02T01:23:02.368Z",
   "model_version": "1.0.0",
   "threshold_vdot": 47.8,
   "stated_goal_sec": null,
   "likely_range_sec": [
    2605,
    2711
   ],
   "expected_gain_vdot": 0,
   "threshold_s_per_mi": 430,
   "durability_exponent": 1.0869051877057179,
   "target_pace_s_per_mi": 429,
   "expected_race_day_sec": 2658,
   "current_projection_sec": 2658,
   "training_pace_s_per_mi": 429
  },
  "race_hr": {
   "reasons": [
    "DOCTRINE_BAND_FOR_DISTANCE",
    "VALIDATED_AGAINST_OWN_EFFORTS"
   ],
   "evidence": {
    "conflict_bpm": -32,
    "observed_mean_hr": 149,
    "comparable_efforts": 2
   },
   "lthr_bpm": 168,
   "checkpoint_mi": 2,
   "early_through_mi": 2,
   "early_ceiling_bpm": 168,
   "expected_range_bpm": [
    168,
    176
   ],
   "informational_only": false,
   "late_allowance_bpm": 181,
   "checkpoint_abort_bpm": 179
  },
  "rationale": null,
  "notes": "Santa Monica 10k. B race \u00b7 race effort. Recovery days follow before quality resumes. Coach target 7:24/mi, set from your current fitness. Yours to change.",
  "phase": "phs_91058ab8011460b5",
  "week_start": "2026-09-07",
  "week_idx": 2,
  "is_race_week": false,
  "is_peak": false,
  "is_cutback": true
 },
 {
  "id": "wko_613649879df83f38",
  "date_iso": "2026-09-26",
  "type": "race",
  "sub_label": "RACE",
  "distance_mi": "6.21",
  "pace_target_s_per_mi": 435,
  "is_quality": true,
  "is_long": false,
  "kind": "long",
  "lo": "430",
  "hi": "440",
  "hr_cap_bpm": null,
  "finish": null,
  "race_execution": {
   "reason": "Your goal is at or slower than the expected result \u00b7 race to your goal.",
   "source": "stated_goal_within_range",
   "target_sec": 2700,
   "feasibility": "comfortable",
   "resolved_at": "2026-09-02T01:23:03.041Z",
   "model_version": "1.0.0",
   "threshold_vdot": 47.8,
   "stated_goal_sec": 2700,
   "likely_range_sec": [
    2603,
    2711
   ],
   "expected_gain_vdot": 0.3810714285714286,
   "threshold_s_per_mi": 430,
   "durability_exponent": 1.0869051877057179,
   "target_pace_s_per_mi": 435,
   "expected_race_day_sec": 2656,
   "current_projection_sec": 2663,
   "training_pace_s_per_mi": 429
  },
  "race_hr": {
   "reasons": [
    "DOCTRINE_BAND_FOR_DISTANCE",
    "VALIDATED_AGAINST_OWN_EFFORTS"
   ],
   "evidence": {
    "conflict_bpm": -27,
    "observed_mean_hr": 154,
    "comparable_efforts": 3
   },
   "lthr_bpm": 168,
   "checkpoint_mi": 2,
   "early_through_mi": 2,
   "early_ceiling_bpm": 168,
   "expected_range_bpm": [
    168,
    176
   ],
   "informational_only": false,
   "late_allowance_bpm": 181,
   "checkpoint_abort_bpm": 179
  },
  "rationale": null,
  "notes": "Dodgers. C race \u00b7 this is the week's quality session. Run it as the workout. Target 7:15/mi.",
  "phase": "phs_91058ab8011460b5",
  "week_start": "2026-09-21",
  "week_idx": 4,
  "is_race_week": false,
  "is_peak": false,
  "is_cutback": false
 },
 {
  "id": "wko_b60a0765ff28a887",
  "date_iso": "2026-11-03",
  "type": "threshold",
  "sub_label": "4\u00d71km \u00b7 MP \u2192 5K \u00b7 60s jog",
  "distance_mi": "8",
  "pace_target_s_per_mi": 407,
  "is_quality": true,
  "is_long": false,
  "kind": "threshold",
  "lo": null,
  "hi": null,
  "hr_cap_bpm": null,
  "finish": null,
  "race_execution": null,
  "race_hr": null,
  "rationale": null,
  "notes": "1K cutdowns \u00b7 Research/04 \u00a712.3. Start controlled. Each rep a little faster. The last one is the point.",
  "phase": "phs_922bfb702760cc83",
  "week_start": "2026-11-02",
  "week_idx": 10,
  "is_race_week": false,
  "is_peak": false,
  "is_cutback": true
 },
 {
  "id": "wko_04050ebcd66f81d6",
  "date_iso": "2026-11-08",
  "type": "race",
  "sub_label": "RACE",
  "distance_mi": "13.1",
  "pace_target_s_per_mi": 438,
  "is_quality": true,
  "is_long": true,
  "kind": "long",
  "lo": "433",
  "hi": "443",
  "hr_cap_bpm": null,
  "finish": null,
  "race_execution": {
   "reason": "Your goal (1:30:00) is faster than the likely range's fast edge (1:35:37) \u00b7 race to the edge; the goal stays yours.",
   "source": "stated_goal_clamped_to_range_edge",
   "target_sec": 5740,
   "feasibility": "unlikely_currently",
   "resolved_at": "2026-09-02T01:23:03.708Z",
   "model_version": "1.0.0",
   "threshold_vdot": 47.8,
   "stated_goal_sec": 5400,
   "likely_range_sec": [
    5737,
    6054
   ],
   "expected_gain_vdot": 1.8707142857142856,
   "threshold_s_per_mi": 430,
   "durability_exponent": 1.0869051877057179,
   "target_pace_s_per_mi": 438,
   "expected_race_day_sec": 5887,
   "current_projection_sec": 5958,
   "training_pace_s_per_mi": 455
  },
  "race_hr": {
   "reasons": [
    "DOCTRINE_BAND_FOR_DISTANCE",
    "VALIDATED_AGAINST_OWN_EFFORTS"
   ],
   "evidence": {
    "conflict_bpm": -18,
    "observed_mean_hr": 155,
    "comparable_efforts": 4
   },
   "lthr_bpm": 168,
   "checkpoint_mi": 5,
   "early_through_mi": 5,
   "early_ceiling_bpm": 161,
   "expected_range_bpm": [
    161,
    168
   ],
   "informational_only": false,
   "late_allowance_bpm": 173,
   "checkpoint_abort_bpm": 171
  },
  "rationale": null,
  "notes": "Run Malibu. B race \u00b7 race effort. Recovery days follow before quality resumes. Target 7:05/mi.",
  "phase": "phs_922bfb702760cc83",
  "week_start": "2026-11-02",
  "week_idx": 10,
  "is_race_week": false,
  "is_peak": false,
  "is_cutback": true
 },
 {
  "id": "wko_3ac6eb59ae4f0cd4",
  "date_iso": "2026-11-15",
  "type": "long",
  "sub_label": "LONG \u00b7 4mi @ M",
  "distance_mi": "16",
  "pace_target_s_per_mi": 520,
  "is_quality": false,
  "is_long": true,
  "kind": "long",
  "lo": "502",
  "hi": "537",
  "hr_cap_bpm": "151",
  "finish": null,
  "race_execution": null,
  "race_hr": null,
  "rationale": null,
  "notes": "Dress rehearsal \u00b7 Research/04 \u00a74.6. Steady 12mi, then 4mi at marathon pace. Race kit, race breakfast, race fuelling. Controlled effort, not a fitness test. Course drops 304 ft. Run at least 60% of this on downhill-similar terrain \u00b7 Research/11 \u00a7net-downhill adjustments.",
  "phase": "phs_922bfb702760cc83",
  "week_start": "2026-11-09",
  "week_idx": 11,
  "is_race_week": false,
  "is_peak": false,
  "is_cutback": false
 },
 {
  "id": "wko_c653c776197d3edd",
  "date_iso": "2026-11-17",
  "type": "tempo",
  "sub_label": "2.5 mi WU \u00b7 11 mi @ MP \u00b7 1.5 mi CD",
  "distance_mi": "15",
  "pace_target_s_per_mi": 475,
  "is_quality": true,
  "is_long": false,
  "kind": "tempo",
  "lo": null,
  "hi": null,
  "hr_cap_bpm": null,
  "finish": null,
  "race_execution": null,
  "race_hr": null,
  "rationale": null,
  "notes": "Marathon effort at the fitness you have shown, not goal pace. Not faster. This is a rehearsal, not a test.",
  "phase": "phs_ffdd99239ef3c034",
  "week_start": "2026-11-16",
  "week_idx": 12,
  "is_race_week": false,
  "is_peak": false,
  "is_cutback": false
 },
 {
  "id": "wko_f35d7b368a816616",
  "date_iso": "2026-11-24",
  "type": "tempo",
  "sub_label": "2 mi WU \u00b7 7 mi @ MP \u00b7 1 mi CD",
  "distance_mi": "10",
  "pace_target_s_per_mi": 475,
  "is_quality": true,
  "is_long": false,
  "kind": "tempo",
  "lo": null,
  "hi": null,
  "hr_cap_bpm": null,
  "finish": null,
  "race_execution": null,
  "race_hr": null,
  "rationale": null,
  "notes": "Marathon effort at the fitness you have shown, not goal pace. Not faster. This is a rehearsal, not a test.",
  "phase": "phs_ffdd99239ef3c034",
  "week_start": "2026-11-23",
  "week_idx": 13,
  "is_race_week": false,
  "is_peak": false,
  "is_cutback": false
 },
 {
  "id": "wko_8bfa8647379342ba",
  "date_iso": "2026-12-06",
  "type": "race",
  "sub_label": "RACE",
  "distance_mi": "26.22",
  "pace_target_s_per_mi": 451,
  "is_quality": true,
  "is_long": true,
  "kind": "long",
  "lo": "446",
  "hi": "456",
  "hr_cap_bpm": null,
  "finish": null,
  "race_execution": {
   "reason": "Your goal (3:00:00) is faster than the likely range's fast edge (3:16:57) \u00b7 race to the edge; the goal stays yours.",
   "source": "stated_goal_clamped_to_range_edge",
   "target_sec": 11820,
   "feasibility": "unlikely_currently",
   "resolved_at": "2026-09-02T01:23:04.404Z",
   "model_version": "1.0.0",
   "threshold_vdot": 47.8,
   "stated_goal_sec": 10800,
   "likely_range_sec": [
    11817,
    12615
   ],
   "expected_gain_vdot": 2.5982142857142856,
   "threshold_s_per_mi": 430,
   "durability_exponent": 1.0869051877057179,
   "target_pace_s_per_mi": 451,
   "expected_race_day_sec": 12194,
   "current_projection_sec": 12390,
   "training_pace_s_per_mi": 475
  },
  "race_hr": {
   "reasons": [
    "DOCTRINE_BAND_FOR_DISTANCE",
    "VALIDATED_AGAINST_OWN_EFFORTS"
   ],
   "evidence": {
    "conflict_bpm": -11,
    "observed_mean_hr": 154,
    "comparable_efforts": 7
   },
   "lthr_bpm": 168,
   "checkpoint_mi": 10,
   "early_through_mi": 10,
   "early_ceiling_bpm": 148,
   "expected_range_bpm": [
    148,
    160
   ],
   "informational_only": false,
   "late_allowance_bpm": 165,
   "checkpoint_abort_bpm": 163
  },
  "rationale": null,
  "notes": "Execute the plan. Pacing in race-week briefing.",
  "phase": "phs_ffdd99239ef3c034",
  "week_start": "2026-11-30",
  "week_idx": 14,
  "is_race_week": true,
  "is_peak": false,
  "is_cutback": false
 }
]
```


## 7.7 · HR profile inputs

```json
{
 "lthr": 168,
 "lthr_method": "race_half \u00b7 Americas Finest City \u00b7 2026-08-16",
 "lthr_set_at": "2026-08-31 02:40:47.71583+00",
 "hrmax": null,
 "hrmax_observed": 183,
 "rhr": 46,
 "users_max_hr": 183
}
```


## 7.8 · Authoring/recompute parity · at the plan's stamped anchors (no new evidence)

```json
{
 "user": "0645f40c-951d-4ccc-b86e-9979cd26c795",
 "today": "2026-09-01",
 "planId": "pln_9a57561debb776e5",
 "authoredISO": "2026-08-31 03:40:26.259869+00",
 "anchorsMode": "stamped (no new evidence)",
 "lastRecompute": {
  "at": "2026-08-31T21:48:43.840Z",
  "vdot": 47.9,
  "model": "prescription_resolver",
  "source": "prescription_wire_1_promotion",
  "anchors": {
   "basis": {
    "marathon": {
     "confidence": 0.7268354752028102,
     "sourceMode": "direct",
     "enduranceExponent": 1.0869051877057179,
     "personallyEvidenced": true
    },
    "threshold": {
     "vdot": 47.9,
     "confidence": 0.7268354752028102,
     "sourceMode": "direct"
    },
    "easyCeiling": {
     "confidence": 0.6344908530086352,
     "sourceMode": "direct"
    },
    "highIntensity": {
     "confidence": 0.2914260240653357,
     "sourceMode": "vdot_fallback"
    }
   },
   "interval_s_per_mi": 407,
   "marathon_s_per_mi": 475,
   "threshold_s_per_mi": 430,
   "repetition_s_per_mi": 371,
   "easy_ceiling_s_per_mi": 502,
   "shakeout_ceiling_s_per_mi": 532
  },
  "lthr_bpm": 168,
  "max_hr_bpm": 183,
  "workouts_updated": 77,
  "measured_progress_fraction": null
 },
 "raceRowRefresh": {
  "at": "2026-09-02T01:23:04.412Z",
  "rows": [
   {
    "id": "wko_5069bc75e324a69a",
    "date": "2026-09-13",
    "pace": 429,
    "action": "updated",
    "reason": null
   },
   {
    "id": "wko_613649879df83f38",
    "date": "2026-09-26",
    "pace": 435,
    "action": "updated",
    "reason": null
   },
   {
    "id": "wko_04050ebcd66f81d6",
    "date": "2026-11-08",
    "pace": 438,
    "action": "updated",
    "reason": null
   },
   {
    "id": "wko_8bfa8647379342ba",
    "date": "2026-12-06",
    "pace": 451,
    "action": "updated",
    "reason": null
   }
  ],
  "source": "cron/snapshot-projections",
  "refused": 0,
  "updated": 4
 },
 "anchorsToday": {
  "threshold": 430,
  "interval": 407,
  "repetition": 371,
  "easyCeiling": 502,
  "shakeoutCeiling": 532,
  "marathon": 475,
  "lthr": 168,
  "maxHr": 183
 },
 "rowsCompared": 77,
 "rowsChanged": 0,
 "maxPaceDeltaSPerMi": 0,
 "volumeWeightedMeanAbsDeltaSPerMi": 0,
 "hrChanges": 0,
 "bandChanges": 0,
 "structuralChanges": 0,
 "note": "structure (distance, type, day) is not repriced by a recompute by construction; race rows are owned by the race-row refresh and reported in the live-plan ledger"
}
diffs: []
```


## 7.9 · Authoring/recompute parity · at today's anchors

```json
{
 "user": "0645f40c-951d-4ccc-b86e-9979cd26c795",
 "today": "2026-09-01",
 "planId": "pln_9a57561debb776e5",
 "authoredISO": "2026-08-31 03:40:26.259869+00",
 "lastRecompute": {
  "at": "2026-08-31T21:48:43.840Z",
  "vdot": 47.9,
  "model": "prescription_resolver",
  "source": "prescription_wire_1_promotion",
  "anchors": {
   "basis": {
    "marathon": {
     "confidence": 0.7268354752028102,
     "sourceMode": "direct",
     "enduranceExponent": 1.0869051877057179,
     "personallyEvidenced": true
    },
    "threshold": {
     "vdot": 47.9,
     "confidence": 0.7268354752028102,
     "sourceMode": "direct"
    },
    "easyCeiling": {
     "confidence": 0.6344908530086352,
     "sourceMode": "direct"
    },
    "highIntensity": {
     "confidence": 0.2914260240653357,
     "sourceMode": "vdot_fallback"
    }
   },
   "interval_s_per_mi": 407,
   "marathon_s_per_mi": 475,
   "threshold_s_per_mi": 430,
   "repetition_s_per_mi": 371,
   "easy_ceiling_s_per_mi": 502,
   "shakeout_ceiling_s_per_mi": 532
  },
  "lthr_bpm": 168,
  "max_hr_bpm": 183,
  "workouts_updated": 77,
  "measured_progress_fraction": null
 },
 "raceRowRefresh": {
  "at": "2026-09-02T01:23:04.412Z",
  "rows": [
   {
    "id": "wko_5069bc75e324a69a",
    "date": "2026-09-13",
    "pace": 429,
    "action": "updated",
    "reason": null
   },
   {
    "id": "wko_613649879df83f38",
    "date": "2026-09-26",
    "pace": 435,
    "action": "updated",
    "reason": null
   },
   {
    "id": "wko_04050ebcd66f81d6",
    "date": "2026-11-08",
    "pace": 438,
    "action": "updated",
    "reason": null
   },
   {
    "id": "wko_8bfa8647379342ba",
    "date": "2026-12-06",
    "pace": 451,
    "action": "updated",
    "reason": null
   }
  ],
  "source": "cron/snapshot-projections",
  "refused": 0,
  "updated": 4
 },
 "anchorsToday": {
  "threshold": 430,
  "interval": 401,
  "repetition": 365,
  "easyCeiling": 502,
  "shakeoutCeiling": 532,
  "marathon": 475,
  "lthr": 168,
  "maxHr": 183
 },
 "rowsCompared": 77,
 "rowsChanged": 5,
 "maxPaceDeltaSPerMi": 6,
 "volumeWeightedMeanAbsDeltaSPerMi": 0.4,
 "hrChanges": 0,
 "bandChanges": 0,
 "structuralChanges": 0,
 "note": "structure (distance, type, day) is not repriced by a recompute by construction; race rows are owned by the race-row refresh and reported in the live-plan ledger"
}
diffs: [
 {
  "id": "wko_8d009736a66b0091",
  "date": "2026-10-01",
  "type": "intervals",
  "sub_label": "8\u00d7800 m @ I \u00b7 2 min jog",
  "distanceMi": 8.5,
  "diff": {
   "pace_target_s_per_mi": {
    "live": 407,
    "recomputed": 401
   }
  }
 },
 {
  "id": "wko_b0c2a6dbb58333a8",
  "date": "2026-10-08",
  "type": "intervals",
  "sub_label": "7\u00d71 km @ I \u00b7 1 min jog",
  "distanceMi": 8,
  "diff": {
   "pace_target_s_per_mi": {
    "live": 407,
    "recomputed": 401
   }
  }
 },
 {
  "id": "wko_93ac7db578bf3b24",
  "date": "2026-10-15",
  "type": "intervals",
  "sub_label": "2\u00d790s @ 5K \u00b7 90s jog + 4\u00d760s @ 5K \u00b7 60s jog + 4\u00d730s \u00b7 30s jog + 4\u00d715s @ mile \u00b7 15s jog",
  "distanceMi": 6.5,
  "diff": {
   "pace_target_s_per_mi": {
    "live": 403,
    "recomputed": 397
   }
  }
 },
 {
  "id": "wko_c2f12cc10284a1a2",
  "date": "2026-10-29",
  "type": "intervals",
  "sub_label": "6\u00d75 min @ I pace \u00b7 60s jog",
  "distanceMi": 8.5,
  "diff": {
   "pace_target_s_per_mi": {
    "live": 407,
    "recomputed": 401
   }
  }
 },
 {
  "id": "wko_b60a0765ff28a887",
  "date": "2026-11-03",
  "type": "threshold",
  "sub_label": "4\u00d71km \u00b7 MP \u2192 5K \u00b7 60s jog",
  "distanceMi": 8,
  "diff": {
   "pace_target_s_per_mi": {
    "live": 407,
    "recomputed": 401
   }
  }
 }
]
```


## 7.10 · Authoring shadow compare audit (legacy cascade vs canonical, owner + four real accounts, deployed tree)

```

 RUN  v4.1.7 /Volumes/WP/06 Claude Code/Runcino/.claude/worktrees/racepace-2026-09-01/web-v2

stdout | lib/plan/_authoring_shadow_compare.audit.test.ts > AUTHORING SHADOW COMPARE · liveness > states whether the DB-backed comparison ran at all
AUDIT LIVENESS · DATABASE_URL_RO present — the DB-backed comparison RAN.

 ✓ lib/plan/_authoring_shadow_compare.audit.test.ts > AUTHORING SHADOW COMPARE · liveness > states whether the DB-backed comparison ran at all 1ms
stdout | lib/plan/_authoring_shadow_compare.audit.test.ts > AUTHORING SHADOW COMPARE · canonical authoring vs the legacy cascade > runs against the owner's real account and reports the full structured diff

══ AUTHORING SHADOW COMPARE · owner (cim) ══════════════════════
account 0645f40c-951d-4ccc-b86e-9979cd26c795 · today 2026-09-01 · mode race-prep · 14 weeks · race distance 26.22mi
LEGACY pricing: threshold 7:11/mi · interval 6:53/mi · marathon 7:29/mi (T+18 population offset) · I-pace eligible false

CANONICAL ANCHORS (resolvePrescribedPaceAnchors):
  threshold  7:10/mi  · sourceMode direct · conf 0.84 · vdot 47.8
  interval   6:41/mi  · sourceMode vdot_fallback · conf 0.50
  repetition 6:05/mi
  easy ceil  8:22/mi  · sourceMode direct · conf 0.63
  shakeout   8:52/mi
  marathon   7:55/mi  · sourceMode direct · conf 0.84 · exponent 1.087 · personallyEvidenced true

DAY-BY-DAY (98 composed days):
wk phase          type        mi    legacy    canon     Δ      sub_label
0  QUALITY        long        14.5  8:24/mi   8:40/mi   + 16s  LONG
0  QUALITY        easy        5.0      -         -         -   EASY · 6×20s strides
0  QUALITY        tempo       8.5   7:11/mi   7:10/mi   -  1s  4.5mi continuous wave tempo
0  QUALITY        easy        5.0      -         -         -   EASY · 6×20s strides
0  QUALITY        intervals   8.0      -         -         -   8×3 min hills @ T-10K effort
0  QUALITY        easy        5.0      -         -         -   EASY
0  QUALITY        rest        0.0      -         -         -   REST
1  QUALITY        race        6.2   7:09/mi   7:09/mi      0s  RACE
1  QUALITY        easy        5.0      -         -         -   EASY · 6×20s strides
1  QUALITY        threshold   6.2   7:11/mi   7:10/mi   -  1s  2×1mi @ T pace · 60s jog
1  QUALITY        easy        5.0      -         -         -   EASY · 6×20s strides
1  QUALITY        easy        5.0      -         -         -   EASY
1  QUALITY        shakeout    2.0      -         -         -   SHAKEOUT · 4×20s strides
1  QUALITY        rest        0.0      -         -         -   REST
2  QUALITY        long        11.3  8:24/mi   8:40/mi   + 16s  LONG
2  QUALITY        rest        0.0      -         -         -   REST
2  QUALITY        easy        5.0      -         -         -   EASY
2  QUALITY        easy        5.0      -         -         -   EASY · 6×20s strides
2  QUALITY        intervals   6.5   6:53/mi   6:41/mi   - 12s  800m bound uphill + 800m flat jog + 700m stride down + 800m wind sprints · by effort
2  QUALITY        easy        4.5      -         -         -   EASY · 6×20s strides
2  QUALITY        rest        0.0      -         -         -   REST
3  QUALITY        long        14.5  8:24/mi   8:40/mi   + 16s  LONG
3  QUALITY        easy        6.0      -         -         -   EASY · 6×20s strides
3  QUALITY        threshold   9.5   7:11/mi   7:10/mi   -  1s  4×1mi @ T pace · 60s jog
3  QUALITY        easy        6.0      -         -         -   EASY · 6×20s strides
3  QUALITY        rest        0.0      -         -         -   REST
3  QUALITY        easy        6.5      -         -         -   EASY
3  QUALITY        race        6.2   7:15/mi   7:15/mi      0s  RACE
4  QUALITY        long        15.5  8:24/mi   8:40/mi   + 16s  LONG · 2.5mi @ M + 1mi @ E + 2mi @ M
4  QUALITY        easy        6.0      -         -         -   EASY · 6×20s strides
4  QUALITY        tempo       9.5   7:11/mi   7:10/mi   -  1s  5mi continuous tempo
4  QUALITY        easy        8.0      -         -         -   MEDIUM-LONG
4  QUALITY        intervals   7.5   6:53/mi   6:41/mi   - 12s  5×1200m @ I pace · 2 min jog
4  QUALITY        easy        7.0      -         -         -   EASY · 6×20s strides
4  QUALITY        rest        0.0      -         -         -   REST
5  QUALITY        long        14.0  8:24/mi   8:40/mi   + 16s  LONG
5  QUALITY        rest        0.0      -         -         -   REST
5  QUALITY        threshold   9.0   7:26/mi   7:25/mi   -  1s  6×1km @ ST pace · 60s jog
5  QUALITY        easy        6.0      -         -         -   EASY · 6×20s strides
5  QUALITY        intervals   6.5   6:48/mi   6:37/mi   - 11s  2×90s @ 5K · 90s jog + 4×60s @ 5K · 60s jog + 4×30s · 30s jog + 4×15s @ mile · 15s jog
5  QUALITY        easy        5.5      -         -         -   EASY · 6×20s strides
5  QUALITY        rest        0.0      -         -         -   REST
6  QUALITY        long        17.0  8:24/mi   8:40/mi   + 16s  LONG · 5mi @ M + 2mi @ T
6  QUALITY        easy        6.0      -         -         -   EASY · 6×20s strides
6  QUALITY        easy        7.5      -         -         -   EASY · 6×20s strides
6  QUALITY        easy        12.0     -         -         -   MEDIUM-LONG
6  QUALITY        intervals   6.5   7:29/mi   7:55/mi   + 26s  10×400m hills @ MP effort
6  QUALITY        easy        8.0      -         -         -   EASY
6  QUALITY        rest        0.0      -         -         -   REST
7  RACE-SPECIFIC  long        18.5  8:24/mi   8:40/mi   + 16s  LONG · 10.5mi @ MP
7  RACE-SPECIFIC  easy        6.0      -         -         -   EASY · 8×20s strides
7  RACE-SPECIFIC  threshold   8.0   6:53/mi   6:41/mi   - 12s  6×1km · MP → 5K · 60s jog
7  RACE-SPECIFIC  easy        11.5     -         -         -   MEDIUM-LONG
7  RACE-SPECIFIC  easy        6.5      -         -         -   EASY · 8×20s strides
7  RACE-SPECIFIC  easy        7.0      -         -         -   EASY
7  RACE-SPECIFIC  rest        0.0      -         -         -   REST
8  RACE-SPECIFIC  long        16.0  8:24/mi   8:40/mi   + 16s  LONG
8  RACE-SPECIFIC  rest        0.0      -         -         -   REST
8  RACE-SPECIFIC  tempo       8.5   7:11/mi   7:10/mi   -  1s  4.5mi continuous tempo
8  RACE-SPECIFIC  easy        6.5      -         -         -   EASY · 8×20s strides
8  RACE-SPECIFIC  intervals   7.5   6:53/mi   6:41/mi   - 12s  8×3 min @ I pace · 60s jog
8  RACE-SPECIFIC  easy        6.5      -         -         -   EASY · 8×20s strides
8  RACE-SPECIFIC  rest        0.0      -         -         -   REST
9  RACE-SPECIFIC  race        13.1  6:52/mi   6:52/mi      0s  RACE
9  RACE-SPECIFIC  easy        6.0      -         -         -   EASY · 8×20s strides
9  RACE-SPECIFIC  tempo       10.0  7:11/mi   7:10/mi   -  1s  3mi continuous mile cutdowns
9  RACE-SPECIFIC  easy        6.5      -         -         -   EASY · 8×20s strides
9  RACE-SPECIFIC  easy        6.0      -         -         -   EASY
9  RACE-SPECIFIC  shakeout    2.0      -         -         -   SHAKEOUT · 4×20s strides
9  RACE-SPECIFIC  rest        0.0      -         -         -   REST
10 RACE-SPECIFIC  long        20.0  8:24/mi   8:40/mi   + 16s  LONG · 4mi @ MP
10 RACE-SPECIFIC  easy        6.0      -         -         -   EASY · 8×20s strides
10 RACE-SPECIFIC  easy        5.0      -         -         -   EASY
10 RACE-SPECIFIC  easy        10.0     -         -         -   MEDIUM-LONG
10 RACE-SPECIFIC  easy        6.5      -         -         -   EASY · 8×20s strides
10 RACE-SPECIFIC  threshold   8.0   7:11/mi   7:10/mi   -  1s  2×1.5 mi @ T · 3 min jog
10 RACE-SPECIFIC  rest        0.0      -         -         -   REST
11 TAPER          long        18.5  8:24/mi   8:40/mi   + 16s  LONG
11 TAPER          easy        3.0      -         -         -   EASY · 6×20s strides
11 TAPER          tempo       15.0  7:29/mi   7:55/mi   + 26s  2.5 mi WU · 11 mi @ MP · 1.5 mi CD
11 TAPER          easy        3.0      -         -         -   EASY · 6×20s strides
11 TAPER          easy        3.0      -         -         -   EASY
11 TAPER          easy        3.0      -         -         -   EASY
11 TAPER          rest        0.0      -         -         -   REST
12 TAPER          long        13.0  8:24/mi   8:40/mi   + 16s  LONG
12 TAPER          easy        2.5      -         -         -   EASY · 6×20s strides
12 TAPER          tempo       10.0  7:29/mi   7:55/mi   + 26s  2 mi WU · 7 mi @ MP · 1 mi CD
12 TAPER          easy        2.5      -         -         -   EASY · 6×20s strides
12 TAPER          easy        2.5      -         -         -   EASY
12 TAPER          easy        2.5      -         -         -   EASY
12 TAPER          rest        0.0      -         -         -   REST
13 TAPER          race        26.2  6:52/mi   6:52/mi      0s  RACE
13 TAPER          easy        4.0      -         -         -   EASY · 40 MIN
13 TAPER          race_week_tu5.0   6:41/mi   6:41/mi      0s  5×400m @ 5K pace · 2min jog
13 TAPER          easy        4.0      -         -         -   EASY · 40 MIN
13 TAPER          easy        3.0      -         -         -   EASY · 30 MIN
13 TAPER          rest        0.0      -         -         -   REST
13 TAPER          shakeout    2.0      -         -         -   SHAKEOUT · 4×20s strides

WHOLE-BLOCK HEADLINE (ALL priced days, |Δ| — a signed mean lets divergences cancel):
  32 priced days over 366.2 mi
  mean |Δ| + 10s · mean signed Δ +  6s
  volume-weighted Σ|Δ|×mi 4079 s·mi · signed 3089 s·mi
  volume-weighted mean |Δ| + 11s
  MAX |Δ| + 26s on 3 day(s):
    wk6 intervals 6.5mi · 7:29/mi → 7:55/mi · 10×400m hills @ MP effort
    wk11 tempo 15.0mi · 7:29/mi → 7:55/mi · 2.5 mi WU · 11 mi @ MP · 1.5 mi CD
    wk12 tempo 10.0mi · 7:29/mi → 7:55/mi · 2 mi WU · 7 mi @ MP · 1 mi CD

BY DAY TYPE (sorted by volume-weighted |Δ| — the long runs cannot hide here):
  long                11 days   172.8 mi · mean Δ + 16s · Σ|Δ|×mi   2765 s·mi
  tempo                6 days    61.5 mi · mean Δ +  8s · Σ|Δ|×mi    687 s·mi
  intervals            5 days    34.5 mi · mean Δ -  4s · Σ|Δ|×mi    499 s·mi
  threshold            5 days    40.7 mi · mean Δ -  3s · Σ|Δ|×mi    129 s·mi
  easy                 0 days     0.0 mi · mean Δ    -   · Σ|Δ|×mi      0 s·mi
  rest                 0 days     0.0 mi · mean Δ    -   · Σ|Δ|×mi      0 s·mi
  race                 4 days    51.7 mi · mean Δ    0s · Σ|Δ|×mi      0 s·mi
  shakeout             0 days     0.0 mi · mean Δ    -   · Σ|Δ|×mi      0 s·mi
  race_week_tuneup     1 days     5.0 mi · mean Δ    0s · Σ|Δ|×mi      0 s·mi

BY PHASE (mean |Δ|):
  QUALITY             17 days · mean |Δ| + 10s
  RACE-SPECIFIC        9 days · mean |Δ| +  8s
  TAPER                6 days · mean |Δ| + 14s

BAND EDGES (easy / long / shakeout / recovery — the 45 easy days the old table showed as "-"):
  long         × 11 · legacy 8:06/mi–8:41/mi · canonical 8:22/mi–8:57/mi · Δ(lo) + 16s
  easy         × 45 · legacy 8:31/mi–9:11/mi · canonical 8:22/mi–9:02/mi · Δ(lo) -  9s
  shakeout     ×  3 · legacy 9:11/mi–9:41/mi · canonical 8:52/mi–9:22/mi · Δ(lo) - 19s

RACE ROW (READ-ONLY COMPARE · Phase 3 owns race pricing; nothing here changes it):
  wk1 race: legacy 7:09/mi · canonical 7:09/mi · Δ    0s
  wk3 race: legacy 7:15/mi · canonical 7:15/mi · Δ    0s
  wk9 race: legacy 6:52/mi · canonical 6:52/mi · Δ    0s
  wk13 race: legacy 6:52/mi · canonical 6:52/mi · Δ    0s
  wk13 race_week_tuneup: legacy 6:41/mi · canonical 6:41/mi · Δ    0s

WARM-UP / COOL-DOWN (mean, quality days) and HR GUIDANCE:
  warmup  legacy 2.00mi · canonical 2.00mi
  cooldown legacy 1.78mi · canonical 1.78mi
  hr_cap_bpm divergences: 0 (a function of lthr/maxHr only — any nonzero count is a finding)
  persisted distance_mi divergences (spec-summed total): 0

VOLUME / STRUCTURE (both legs RE-COMPOSED · the class the previous version could not see at all):
wk  phase           legacy mi  canon mi   legacy long  canon long  Q days L/C
0   QUALITY         46         46         14.5         14.5        2 / 2
1   QUALITY         29.4       29.4       6.2          6.2         2 / 2
2   QUALITY         32.3       32.3       11.3         11.3        1 / 1
3   QUALITY         49.2       48.7       14.5         14.5        2 / 2
4   QUALITY         53.5       53.5       15.5         15.5        2 / 2
5   QUALITY         41         41         14           14          2 / 2
6   QUALITY         57         57         17           17          1 / 1
7   RACE-SPECIFIC   57.5       57.5       18.5         18.5        1 / 1
8   RACE-SPECIFIC   45         45         16           16          2 / 2
9   RACE-SPECIFIC   43.6       43.6       13.1         13.1        2 / 2
10  RACE-SPECIFIC   55.5       55.5       20           20          1 / 1
11  TAPER           45.5       45.5       18.5         18.5        1 / 1
12  TAPER           33         33         13           13          1 / 1
13  TAPER           18         18         26.22        26.22       2 / 2
  TOTAL BLOCK VOLUME: legacy 606.5 mi · canonical 606.0 mi · Δ -0.5 mi

STRUCTURAL DIFFS: 1
  wk3 weeklyMi: 49.2 → 48.7

 ✓ lib/plan/_authoring_shadow_compare.audit.test.ts > AUTHORING SHADOW COMPARE · canonical authoring vs the legacy cascade > runs against the owner's real account and reports the full structured diff 13775ms
stdout | lib/plan/_authoring_shadow_compare.audit.test.ts > AUTHORING SHADOW COMPARE · canonical authoring vs the legacy cascade > runs against every other real account with an active plan (the DB-backed corpus)

══ AUTHORING SHADOW COMPARE · 4 other real, DB-backed account(s) ══

stdout | lib/plan/_authoring_shadow_compare.audit.test.ts > AUTHORING SHADOW COMPARE · canonical authoring vs the legacy cascade > runs against every other real account with an active plan (the DB-backed corpus)

  qa-phone-onboard-20260821-0900@faff.run: race-prep · 12wk · threshold sourceMode=user_prior conf=0.15
    legacy T 7:56/mi → canonical T 8:39/mi · easy ceil 10:27/mi · marathon 9:22/mi
    19 priced days / 149.6 mi · mean |Δ| + 66s · vol-weighted mean |Δ| + 72s · MAX |Δ| + 96s
    structural diffs 7 · hr divergences 0 · distance_mi divergences 1
      long              11d · mean Δ + 96s · Σ|Δ|×mi 9792
      intervals          3d · mean Δ + 39s · Σ|Δ|×mi 585
      threshold          2d · mean Δ + 43s · Σ|Δ|×mi 452
      easy               0d · mean Δ    -   · Σ|Δ|×mi 0

stdout | lib/plan/_authoring_shadow_compare.audit.test.ts > AUTHORING SHADOW COMPARE · canonical authoring vs the legacy cascade > runs against every other real account with an active plan (the DB-backed corpus)

  qa-phone-verify-20260821-0940@faff.run: maintenance · 1wk · threshold sourceMode=population_prior conf=0.10
    legacy T 10:42/mi → canonical T 10:42/mi · easy ceil 12:32/mi · marathon 11:44/mi
    0 priced days / 0 mi · mean |Δ|    -   · vol-weighted mean |Δ|    -   · MAX |Δ|    0s
    structural diffs 15 · hr divergences 0 · distance_mi divergences 0
      easy               0d · mean Δ    -   · Σ|Δ|×mi 0
      rest               0d · mean Δ    -   · Σ|Δ|×mi 0

stdout | lib/plan/_authoring_shadow_compare.audit.test.ts > AUTHORING SHADOW COMPARE · canonical authoring vs the legacy cascade > runs against every other real account with an active plan (the DB-backed corpus)

  qa-race-20260819-1231@faff.run: maintenance · 2wk · threshold sourceMode=user_prior conf=0.15
    legacy T 9:23/mi → canonical T 9:23/mi · easy ceil 11:11/mi · marathon 10:13/mi
    2 priced days / 12 mi · mean |Δ| + 53s · vol-weighted mean |Δ| + 53s · MAX |Δ| + 53s
    structural diffs 22 · hr divergences 0 · distance_mi divergences 0
      long               2d · mean Δ + 53s · Σ|Δ|×mi 636
      rest               0d · mean Δ    -   · Σ|Δ|×mi 0
      easy               0d · mean Δ    -   · Σ|Δ|×mi 0

stdout | lib/plan/_authoring_shadow_compare.audit.test.ts > AUTHORING SHADOW COMPARE · canonical authoring vs the legacy cascade > runs against every other real account with an active plan (the DB-backed corpus)

  apple-review@faff.run: race-prep · 5wk · threshold sourceMode=user_prior conf=0.15
    legacy T 8:23/mi → canonical T 8:23/mi · easy ceil 10:11/mi · marathon 9:04/mi
    8 priced days / 111.7 mi · mean |Δ| + 26s · vol-weighted mean |Δ| + 29s · MAX |Δ| + 53s
    structural diffs 0 · hr divergences 0 · distance_mi divergences 0
      long               3d · mean Δ + 53s · Σ|Δ|×mi 2756
      tempo              4d · mean Δ + 12s · Σ|Δ|×mi 449
      rest               0d · mean Δ    -   · Σ|Δ|×mi 0
      easy               0d · mean Δ    -   · Σ|Δ|×mi 0

4 account(s) produced a full comparison, 0 refused at the canonical anchor stage, 0 refused at composeForUser.

 ✓ lib/plan/_authoring_shadow_compare.audit.test.ts > AUTHORING SHADOW COMPARE · canonical authoring vs the legacy cascade > runs against every other real account with an active plan (the DB-backed corpus) 25089ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  18:27:36
   Duration  38.96s (transform 613ms, setup 13ms, import 18ms, tests 38.87s, environment 0ms)
```



---

# Part 8 · Every commit since the audit base `7cac80f0`

`git log --format='%h|%date|%s' 7cac80f0..7f6da4c8` (topological):

```
7f6da4c8|2026-09-01|docs(p0): handback — second refresh (tune-up row 425→451), CI and deploy status for the final pushes
16010927|2026-09-01|docs(p0): completion handback — scorecard, provenance, ownership graph, proof package; tune-up rows join the race-row refresh; watch decodes raceHr
3c2d1eaa|2026-09-01|proof(p0): race-outlook on the phone, staleness + race-row gates, falsification ledger, live-plan ledger
f967cab1|2026-09-01|merge: p0/thesis (Phase 5 · truthful Coaching Thesis) onto the integration line
0bb6ac8c|2026-09-01|merge: p0/authoring (Phase 4 · canonical initial authoring + cold start) onto the integration line
331e6bab|2026-09-01|fix(race): the brain reads runs through the accessor module and rounds through lib/format
81e165a3|2026-09-01|merge: p0/grading (Phase 2 · execution grading truth) onto the integration line
63d47b5d|2026-09-01|merge: p0/gates + feat/race-pace-brain onto main (P0 coaching loop · Phases 0, 1, 3)
d1ece9ca|2026-09-01|test(watch): the 2026-09-01 wire payload, composed against production
429bceb2|2026-09-01|Merge branch 'p0/gates' into integrate/p0-2026-09-01
ff9de49f|2026-09-01|fix(authoring): keep the long-run time cap on the CAPACITY band, not the prescription-padded one
eda6cfc4|2026-09-01|feat(race): one race-pace brain — RaceOutlook owns every projection-shaped number
e048b22d|2026-09-01|Merge remote-tracking branch 'origin/main' into p0/authoring
085f9519|2026-09-01|chore(gates): allowlist the shadow-compare module in check-derived-consistency, with the argument
f375e4f8|2026-09-01|fix(recap): the recap reads the reps, not the mile splits, and not the whole run
047642aa|2026-09-01|test(shadow-compare): measure the migration honestly — both legs re-composed, abs deltas not signed, the corpus reaches the layer
f21266e5|2026-09-01|ci: run the WHOLE test suite on main, with a liveness floor (F-31)
7ca28a94|2026-09-01|fix(grading): one fitness for grader and prescription, one completion ladder, one HR cap
6fa37dd2|2026-09-01|docs(code): delete 5 false header invariants and repair 4 dangling citations (F-30, F-38, F-42)
e4e85f3e|2026-09-01|feat(convergence): a plan with no measured VDOT is re-priced, not abandoned — and said out loud
47182f4f|2026-09-01|fix(thesis): no `.catch` on the thesis resolve, and the Rule 13 renders
95bc142b|2026-09-01|fix(gate): surface the 12 recorded doctrine violations, and stop 4 gates reporting OK over nothing (F-35, F-36)
236d83e1|2026-09-01|feat(coldstart+authoring): continuous user_prior blend, typed-PR rung, and canonical pace authoring
ec2d272b|2026-09-01|fix(gate,plan): the HANDED_BACK assertion was dead code; fix 3 of its 7 collapses (F-4/F-33)
4deb2a30|2026-09-01|feat(watch): grade the segment average, and let a phase say what its target means
4c1c8c23|2026-09-01|fix(coach): easy-discipline graded against an ARCHIVED plan's band (F-29)
17834cbd|2026-09-01|fix(gate): derive plan writers per STATEMENT, not per file (F-8)
bfaf9d9e|2026-09-01|feat(thesis): wire the Coaching Thesis into Today's "why" and the Block screen
a5367a38|2026-09-01|chore(ship): TestFlight build 249 — post-run label fix confirmed live
a27b35a0|2026-09-01|feat(evidence): one threshold evidence contract — weighted, Evidence-Engine-consuming corpus with a daily move cap
c634d479|2026-09-01|fix(gate): scan lib/plan, watch, execution, prescription, race, today for coach voice (F-3)
6c9f8dcc|2026-09-01|feat(grading): one execution-semantics owner — tolerance, pace shape, verdicts
e1ed5848|2026-09-01|fix(gate): key the EMPTIED swallow ratchet on identity, not a count (F-2)
c69c8043|2026-09-01|fix(thesis): the primary limiter stops flipping on an unrelated clock
12086e29|2026-09-01|fix(adaptation): a test must not dirty the repo it is testing
9c2c18d8|2026-09-01|test(evidence): stop pinning a live production row's data quality
37a12b45|2026-09-01|merge: cold-start-prior-fix-20260901 (user_prior mileage rung)
c498e9b0|2026-09-01|merge: canonical-authoring-migration-20260901 (shadow compare apparatus)
5017962c|2026-09-01|fix(capacity): wire self-reported onboarding mileage into the cold-start prior
8641a234|2026-08-31|feat(plan): shadow-compare legacy VDOT cascade vs canonical prescription anchors
```

## 8.1 · Files changed per non-merge commit

```
### 7f6da4c8 docs(p0): handback — second refresh (tune-up row 425→451), CI and deploy status for the final pushes
...p0-coaching-loop-completion-handback-2026-09-01.md | 19 ++++++++++---------
.../live-plan-ledger/p6-race-rows-after2.txt          |  7 +++++++
.../live-plan-ledger/p6-sealed-checksum-after2.txt    |  3 +++
.../live-plan-ledger/p6-stamp-after2.txt              |  3 +++
4 files changed, 23 insertions(+), 9 deletions(-)

### 16010927 docs(p0): completion handback — scorecard, provenance, ownership graph, proof package; tune-up rows join the race-row refresh; watch decodes raceHr
...coaching-loop-completion-handback-2026-09-01.md |  335 ++++
...horing-recompute-parity-live-plan-3c2d1eaa.json |  166 ++
...-parity-live-plan-stamped-anchors-3c2d1eaa.json |  101 +
.../renders/phone-races-list-f967cab1.png          |  Bin 0 -> 3114842 bytes
.../renders/phone-today-afterrun-f967cab1.png      |  Bin 0 -> 2424612 bytes
.../vitest-final-3c2d1eaa.json                     | 2071 ++++++++++++++++++++
native-v2/Faff/Faff/Models/Watch.swift             |   28 +-
web-v2/lib/race/race-row-refresh.ts                |   21 +-
.../scripts/p0-proof/authoring-recompute-parity.ts |  100 +
9 files changed, 2817 insertions(+), 5 deletions(-)

### 3c2d1eaa proof(p0): race-outlook on the phone, staleness + race-row gates, falsification ledger, live-plan ledger
.github/workflows/test-full.yml                    |     6 +
.../agent-reports/phase-authoring.md               |   459 +
.../agent-reports/phase-gates.md                   |   917 +
.../agent-reports/phase-grading.md                 |   314 +
.../agent-reports/phase-thesis.md                  |   489 +
.../four-by-one-mile-replay-f967cab1.md            |   252 +
.../live-plan-ledger/p6-goals-after.txt            |     6 +
.../live-plan-ledger/p6-goals-before.txt           |     6 +
.../live-plan-ledger/p6-race-rows-after.txt        |     7 +
.../live-plan-ledger/p6-race-rows-before.txt       |     7 +
.../live-plan-ledger/p6-sealed-checksum-after.txt  |     3 +
.../live-plan-ledger/p6-sealed-checksum-before.txt |     3 +
.../live-plan-ledger/p6-stamp-after.txt            |    38 +
.../race-consistency-after-refresh-f967cab1.json   |  1375 +
.../race-consistency-before-refresh-f967cab1.json  |  1014 +
.../threshold-replay-after-f967cab1.json           | 34913 +++++++++++++++++++
.../threshold-replay-before-7cac80f0.json          |  2048 ++
native-v2/Faff/Faff/DesignV5/APIV5.swift           |    69 +
native-v2/Faff/Faff/ViewsV5/RaceDetailV5.swift     |    67 +
web-v2/lib/race/_race_row_refresh_gate.test.ts     |    68 +
.../training/_threshold_evidence_contract.test.ts  |    40 +
web-v2/scripts/p0-proof/falsify.sh                 |    46 +
web-v2/scripts/p0-proof/race-consistency.ts        |   167 +
web-v2/scripts/p0-proof/threshold-replay.ts        |    39 +
24 files changed, 42353 insertions(+)

### 331e6bab fix(race): the brain reads runs through the accessor module and rounds through lib/format
web-v2/lib/race/race-outlook-payload.ts | 11 ++++++-----
web-v2/lib/race/race-outlook.ts         | 21 +++++++++++----------
web-v2/lib/race/race-row-refresh.ts     |  5 +++--
3 files changed, 20 insertions(+), 17 deletions(-)

### d1ece9ca test(watch): the 2026-09-01 wire payload, composed against production
.../lib/watch/_zz_watch_payload_20260901.test.ts   | 63 ++++++++++++++++++++++
1 file changed, 63 insertions(+)

### ff9de49f fix(authoring): keep the long-run time cap on the CAPACITY band, not the prescription-padded one
.../0645f40c-951d-4ccc-b86e-9979cd26c795.jsonl     |  4 ++
web-v2/lib/format/_format_lint.test.ts             |  2 +
web-v2/lib/plan/generate.ts                        | 56 +++++++++++++++-------
3 files changed, 45 insertions(+), 17 deletions(-)

### eda6cfc4 feat(race): one race-pace brain — RaceOutlook owns every projection-shaped number
docs/reports/p0-phase0-status-2026-09-01.md        |  47 ++
scripts/check-goal-immutability.sh                 |   9 +-
web-v2/app/api/cron/plan-drift/route.ts            |   8 +-
web-v2/app/api/cron/snapshot-projections/route.ts  |  29 +-
web-v2/app/api/race/[slug]/execution-plan/route.ts |  29 +-
web-v2/app/api/v5/race/[slug]/route.ts             |  29 +-
web-v2/app/api/v5/races/route.ts                   |  29 +-
web-v2/components/faff-app/seed.ts                 |  32 +-
web-v2/components/faff-app/types.ts                |   2 +-
web-v2/components/faff-app/views/TargetsView.tsx   |  13 +-
web-v2/components/faff-app/views/TrainView.tsx     |   2 +-
web-v2/lib/audit/_automatic_mutations.test.ts      |   3 +
web-v2/lib/audit/coercion-registry.ts              |  37 +-
web-v2/lib/audit/generated-content-registry.ts     |   2 +
web-v2/lib/audit/swallowed-failure-registry.ts     |   4 +-
web-v2/lib/coach/_limiter.test.ts                  | 100 +--
web-v2/lib/coach/_limiter_continuity.test.ts       |   2 +-
web-v2/lib/coach/limiter.ts                        |  94 +--
web-v2/lib/coach/readiness-brief.ts                |   4 +-
web-v2/lib/doctrine/registry.ts                    |  91 ++-
web-v2/lib/plan/_goal_immutability.test.ts         |   6 +-
web-v2/lib/plan/_plan_drift_lifecycle.test.ts      |   2 +-
web-v2/lib/plan/_progression_spec.test.ts          |   7 +
web-v2/lib/plan/gap-report.ts                      |  19 +-
web-v2/lib/plan/goal-gap.ts                        | 139 +++--
web-v2/lib/plan/goal-outlook-copy.ts               |   2 +-
web-v2/lib/plan/goal-outlook.ts                    |  44 +-
web-v2/lib/plan/proposals-state.ts                 |   2 +-
web-v2/lib/plan/recompute-paces.ts                 |  34 +-
web-v2/lib/plan/spec-builder.ts                    |  16 +-
web-v2/lib/race/_effective_target.test.ts          |  92 +--
web-v2/lib/race/_race_detail_pacing.test.ts        |  16 +-
web-v2/lib/race/_race_outlook_contract.test.ts     | 142 +++++
web-v2/lib/race/_race_outlook_fixture.ts           |  85 +++
web-v2/lib/race/coach-goal-load.ts                 |  32 +-
web-v2/lib/race/coach-goal.ts                      |  24 +-
web-v2/lib/race/effective-race-target.ts           | 176 +++---
web-v2/lib/race/race-hr-guidance.ts                | 171 ++++++
web-v2/lib/race/race-outlook-payload.ts            | 117 ++++
web-v2/lib/race/race-outlook.ts                    | 675 +++++++++++++++++++++
web-v2/lib/race/race-row-refresh.ts                | 293 +++++++++
web-v2/lib/race/retrospective.ts                   |  24 +-
web-v2/lib/training/_race_projection.test.ts       | 176 ++----
web-v2/lib/training/_target_continuity.test.ts     |  57 +-
.../_targets_projection_invariants.test.ts         |  24 +-
.../training/fitness-trajectory-belowtable.test.ts |  21 +-
web-v2/lib/training/fitness-trajectory.ts          | 142 +++--
web-v2/lib/training/goal-projection-resolve.ts     |  49 +-
web-v2/lib/training/goal-projection.ts             | 183 ++++--
web-v2/lib/training/pace-corpus.ts                 |  79 ++-
web-v2/lib/training/race-projection.ts             | 185 ++----
web-v2/lib/watch/build-workout.ts                  |  32 +-
52 files changed, 2595 insertions(+), 1037 deletions(-)

### 085f9519 chore(gates): allowlist the shadow-compare module in check-derived-consistency, with the argument
scripts/check-derived-consistency.sh | 1 +
1 file changed, 1 insertion(+)

### f375e4f8 fix(recap): the recap reads the reps, not the mile splits, and not the whole run
web-v2/app/api/runs/[id]/recap/route.ts         |  23 ++-
web-v2/app/api/v5/today/route.ts                |  26 +++
web-v2/lib/coach/run-recap.ts                   |  79 ++++++--
web-v2/lib/training/_zz_replay_20260901.test.ts | 246 ++++++++++++++++++++++++
web-v2/lib/training/threshold-band.ts           |  45 +++++
5 files changed, 407 insertions(+), 12 deletions(-)

### 047642aa test(shadow-compare): measure the migration honestly — both legs re-composed, abs deltas not signed, the corpus reaches the layer
.../canonical-authoring-migration-2026-09-01.md    | 258 +++++++-
scripts/check-goal-pace-leak.sh                    |   1 +
web-v2/lib/adaptation/authoring-convergence.ts     |  25 +-
web-v2/lib/audit/generated-content-registry.ts     |   2 +-
.../plan/_authoring_shadow_compare.audit.test.ts   | 229 ++++---
web-v2/lib/plan/_authoring_shadow_compare.test.ts  | 158 ++++-
web-v2/lib/plan/_null_anchor_reachability.test.ts  | 139 ++++
web-v2/lib/plan/authoring-shadow-compare.ts        | 712 ++++++++++++++++-----
web-v2/lib/plan/generate.ts                        |  50 +-
web-v2/lib/plan/sim-inputs.ts                      |  15 +
web-v2/lib/training/prescription-resolver.ts       |  20 +-
11 files changed, 1324 insertions(+), 285 deletions(-)

### f21266e5 ci: run the WHOLE test suite on main, with a liveness floor (F-31)
.github/workflows/test-full.yml | 117 ++++++++++++++++++++++++++++++++++++++++
.gitignore                      |   3 ++
2 files changed, 120 insertions(+)

### 7ca28a94 fix(grading): one fitness for grader and prescription, one completion ladder, one HR cap
native-v2/Faff/Faff/HRAlerter.swift            | 145 +++++++++++++++++++++---
native-v2/Faff/Faff/Models/Runs.swift          |  48 ++++++--
native-v2/Faff/Faff/ViewsV5/RunDetailV5.swift  |  30 +++++
web-v2/app/api/runs/[id]/recap/route.ts        |   9 ++
web-v2/app/api/v5/today/route.ts               |  19 ++++
web-v2/lib/adaptation/load.ts                  |  36 ++++--
web-v2/lib/audit/swallowed-failure-registry.ts |  13 ++-
web-v2/lib/coach/fitness-evidence.test.ts      |  33 +++---
web-v2/lib/coach/fitness-evidence.ts           |  68 ++++++-----
web-v2/lib/coach/race-replacement.test.ts      |   3 +
web-v2/lib/coach/race-replacement.ts           |  42 ++++---
web-v2/lib/coach/run-recap.ts                  |  71 ++++++++++--
web-v2/lib/coach/threshold-pattern.test.ts     |   3 +
web-v2/lib/coach/threshold-pattern.ts          |  43 ++++---
web-v2/lib/execution/_reconstruct.test.ts      |  50 ++++++++-
web-v2/lib/execution/interpret.ts              |  13 ++-
web-v2/lib/execution/load.ts                   |  56 +++++++++-
web-v2/lib/execution/reconstruct.ts            |  71 +++++++++---
web-v2/lib/faff/v5-today.ts                    |   7 +-
web-v2/lib/plan/_quality_drift_hr.test.ts      |  93 +++++++++++----
web-v2/lib/plan/adapt.ts                       |  24 ++--
web-v2/lib/plan/drift-monitor.ts               |  13 ++-
web-v2/lib/training/execution-semantics.ts     |  96 ++++++++++++++++
web-v2/lib/training/projection-snapshots.ts    | 149 +++++++++++++++++++++++++
web-v2/lib/watch/build-workout.ts              |   5 +-
25 files changed, 962 insertions(+), 178 deletions(-)

### 6fa37dd2 docs(code): delete 5 false header invariants and repair 4 dangling citations (F-30, F-38, F-42)
.../lib/adaptation/_adaptation_engine.audit.test.ts | 17 ++++++++++++++---
web-v2/lib/adaptation/authoring-convergence.ts      | 18 +++++++++++++++---
web-v2/lib/adaptation/load.ts                       | 14 +++++++++++---
web-v2/lib/doctrine/_doctrine_lint.test.ts          | 18 ++++++++++++++++--
web-v2/lib/doctrine/registry.ts                     |  7 +++++--
web-v2/lib/plan/drift-monitor.ts                    |  4 +++-
web-v2/lib/plan/pace-zones.ts                       |  7 +++++--
web-v2/lib/training/lthr-reanchor.ts                | 18 ++++++++++++++----
web-v2/lib/training/normal-window.ts                |  4 +++-
web-v2/scripts/adaptation-stability-report.ts       | 21 +++++++++++----------
10 files changed, 97 insertions(+), 31 deletions(-)

### e4e85f3e feat(convergence): a plan with no measured VDOT is re-priced, not abandoned — and said out loud
web-v2/app/api/cron/snapshot-projections/route.ts  |  26 +++-
.../lib/adaptation/_authoring_convergence.test.ts  | 112 +++++++++++++++
web-v2/lib/adaptation/authoring-convergence.ts     | 135 +++++++++++++++--
web-v2/lib/audit/automatic-mutation-registry.ts    |  13 +-
web-v2/lib/audit/swallowed-failure-registry.ts     |   9 +-
web-v2/lib/ops/alerts.ts                           |   8 +-
web-v2/lib/plan/reanchor-plan.ts                   | 159 ++++++++++++++++++++-
7 files changed, 439 insertions(+), 23 deletions(-)

### 47182f4f fix(thesis): no `.catch` on the thesis resolve, and the Rule 13 renders
.../0645f40c-951d-4ccc-b86e-9979cd26c795.jsonl     |   3 +
web-v2/app/api/v5/today/route.ts                   |  18 +++-
web-v2/lib/faff/_today_thesis.audit.test.ts        | 105 +++++++++++++++++++++
web-v2/lib/plan/_rationale_backfill.audit.test.ts  |  87 +++++++++++++++++
web-v2/lib/plan/v5-block.ts                        |  11 ++-
5 files changed, 215 insertions(+), 9 deletions(-)

### 95bc142b fix(gate): surface the 12 recorded doctrine violations, and stop 4 gates reporting OK over nothing (F-35, F-36)
scripts/check-coercion.sh                       | 26 +++++++-
scripts/check-doctrine.sh                       | 43 ++++++++++++-
scripts/check-generated-content.sh              | 26 +++++++-
scripts/check-swallowed-failure.sh              | 26 +++++++-
web-v2/lib/audit/generated-content-registry.ts  |  2 +
web-v2/lib/doctrine/_doctrine_gate.test.ts      | 68 ++++++++++++++++++++-
web-v2/lib/doctrine/runner-facing-violations.ts | 81 +++++++++++++++++++++++++
7 files changed, 266 insertions(+), 6 deletions(-)

### 236d83e1 feat(coldstart+authoring): continuous user_prior blend, typed-PR rung, and canonical pace authoring
scripts/check-goal-pace-leak.sh                  | 211 ++++++
web-v2/lib/doctrine/registry.ts                  | 161 +++--
web-v2/lib/plan/_audit_slow_runner.test.ts       |  13 +-
web-v2/lib/plan/_coach_sensible.test.ts          |  27 +-
web-v2/lib/plan/_label_truth.test.ts             |  17 +-
web-v2/lib/plan/_midrace_goal.test.ts            |  24 +-
web-v2/lib/plan/_rationale_persist.test.ts       |   2 +-
web-v2/lib/plan/_recompute_paces.test.ts         | 240 ++-----
web-v2/lib/plan/_training_lead_e2e.test.ts       |  77 ++-
web-v2/lib/plan/anchor-provenance.ts             |  52 ++
web-v2/lib/plan/authoring-anchors.ts             | 151 +++++
web-v2/lib/plan/generate.ts                      | 805 ++++++++++++++---------
web-v2/lib/plan/recompute-paces.ts               | 197 +-----
web-v2/lib/plan/sim-inputs.ts                    |  38 +-
web-v2/lib/training/_capacity_resolver.test.ts   | 353 +++++++++-
web-v2/lib/training/_cold_start_fixtures.test.ts | 265 ++++++++
web-v2/lib/training/capacity-resolver.ts         | 367 +++++++++--
web-v2/lib/training/normal-window.ts             |  45 +-
web-v2/lib/training/prescription-resolver.ts     |  41 +-
web-v2/lib/training/self-reported-pr.ts          | 258 ++++++++
web-v2/package.json                              |   2 +-
21 files changed, 2489 insertions(+), 857 deletions(-)

### ec2d272b fix(gate,plan): the HANDED_BACK assertion was dead code; fix 3 of its 7 collapses (F-4/F-33)
scripts/check-coercion.sh                         | 29 ++++++++-
web-v2/lib/audit/_coercion_scan.test.ts           | 65 ++++++++++++++++++--
web-v2/lib/audit/_swallowed_failure_fixes.test.ts |  4 +-
web-v2/lib/audit/coercion-registry.ts             | 73 +++++++++++++++++++----
web-v2/lib/plan/adapt.ts                          | 58 +++++++++++++++++-
web-v2/lib/plan/generate.ts                       | 43 +++++++++++--
6 files changed, 245 insertions(+), 27 deletions(-)

### 4deb2a30 feat(watch): grade the segment average, and let a phase say what its target means
.../Faff/FaffWatch Watch App/PaceDrift.swift       |  19 +-
.../FaffWatch Watch App/WatchWorkoutModels.swift   |  77 ++++-
.../Faff/FaffWatch Watch App/WorkoutEngine.swift   | 239 ++++++++++++++--
web-v2/lib/coach/run-state.ts                      |  31 ++-
web-v2/lib/coach/run-win.ts                        |  28 +-
web-v2/lib/execution/load.ts                       |   3 +-
web-v2/lib/execution/reconstruct.ts                |   3 +-
web-v2/lib/runs/run-shape.ts                       |  27 +-
web-v2/lib/training/_watch_grader_parity.test.ts   | 310 +++++++++++++++++++++
web-v2/lib/training/execution-semantics.ts         |  57 ++++
10 files changed, 734 insertions(+), 60 deletions(-)

### 4c1c8c23 fix(coach): easy-discipline graded against an ARCHIVED plan's band (F-29)
web-v2/lib/audit/_active_plan_scan.test.ts | 74 ++++++++++++++++++++++++++----
web-v2/lib/coach/easy-discipline.ts        | 55 ++++++++++++++++++----
2 files changed, 113 insertions(+), 16 deletions(-)

### 17834cbd fix(gate): derive plan writers per STATEMENT, not per file (F-8)
scripts/check-automatic-mutations.sh          |   7 +-
web-v2/lib/audit/_automatic_mutations.test.ts | 285 ++++++++++++++++++++++----
2 files changed, 251 insertions(+), 41 deletions(-)

### bfaf9d9e feat(thesis): wire the Coaching Thesis into Today's "why" and the Block screen
native-v2/Faff/Faff/DesignV5/APIV5.swift        |  51 +++++++++-
native-v2/Faff/Faff/ViewsV5/BlockV5.swift       |  29 +++++-
native-v2/Faff/Faff/ViewsV5/TodayBeforeV5.swift |  20 +++-
web-v2/app/api/v5/today/route.ts                |  43 +++++++++
web-v2/lib/audit/generated-content-registry.ts  |   2 -
web-v2/lib/faff/v5-today.ts                     |  19 ++++
web-v2/lib/faff/why-voice.ts                    |  37 +++++++-
web-v2/lib/plan/recompute-paces.ts              |  57 ++++++++++-
web-v2/lib/plan/v5-block.ts                     |  22 ++++-
web-v2/lib/training/coaching-thesis.ts          | 121 +++++++++++++++++++++++-
web-v2/lib/workout-catalogue/select.ts          |  62 ++++++++++++
11 files changed, 449 insertions(+), 14 deletions(-)

### a5367a38 chore(ship): TestFlight build 249 — post-run label fix confirmed live
docs/reports/testflight-ship-249-2026-09-01.md | 229 +++++++++++++++++++++++++
legacy/native/.asc.build                       |   2 +-
2 files changed, 230 insertions(+), 1 deletion(-)

### a27b35a0 feat(evidence): one threshold evidence contract — weighted, Evidence-Engine-consuming corpus with a daily move cap
web-v2/lib/doctrine/registry.ts                    |  64 ++
web-v2/lib/evidence/_reexamination.test.ts         |  17 +-
web-v2/lib/evidence/reexamination.ts               |  20 +
web-v2/lib/training/_capacity_resolver.test.ts     |  15 +-
web-v2/lib/training/_pace_corpus.test.ts           |   2 +
.../training/_threshold_evidence_contract.test.ts  | 320 +++++++++
web-v2/lib/training/capacity-resolver.ts           |  50 +-
web-v2/lib/training/pace-corpus.ts                 | 724 +++++++++++++++++++--
8 files changed, 1139 insertions(+), 73 deletions(-)

### c634d479 fix(gate): scan lib/plan, watch, execution, prescription, race, today for coach voice (F-3)
scripts/check-coach-voice.sh              | 40 +++++++++++++++++++++++++++++++
web-v2/lib/execution/interpret.ts         |  8 +++----
web-v2/lib/plan/adapt.ts                  |  2 +-
web-v2/lib/plan/adaptive-ramp.ts          |  2 +-
web-v2/lib/plan/anchor-fit.ts             | 10 ++++----
web-v2/lib/plan/block-preview.ts          |  6 ++---
web-v2/lib/plan/generate.ts               | 12 +++++-----
web-v2/lib/plan/goal-tiers.ts             | 12 +++++-----
web-v2/lib/plan/history-shapes.ts         |  8 +++----
web-v2/lib/plan/mutate.ts                 |  2 +-
web-v2/lib/plan/progression-gate.ts       |  4 ++--
web-v2/lib/plan/return-ladder.ts          |  2 +-
web-v2/lib/plan/validate.ts               | 30 +++++++++++------------
web-v2/lib/plan/workout-library-static.ts | 18 +++++++-------
web-v2/lib/plan/zone-anchors.ts           |  3 ++-
web-v2/lib/prescription/levers.ts         | 12 +++++-----
web-v2/lib/prescription/trajectory.ts     |  4 ++--
web-v2/lib/race/course-elevation.ts       | 12 +++++-----
web-v2/lib/race/course-geometry-source.ts |  2 +-
web-v2/lib/race/distance-doctrine.ts      | 12 +++++-----
20 files changed, 121 insertions(+), 80 deletions(-)

### 6c9f8dcc feat(grading): one execution-semantics owner — tolerance, pace shape, verdicts
web-v2/app/api/v5/today/route.ts                   |  28 +-
web-v2/components/faff-app/seed.ts                 |   5 +
web-v2/lib/coach/run-state.ts                      | 111 +++-
web-v2/lib/coach/training-influence.ts             |  18 +-
.../training/_execution_semantics_owner.test.ts    | 386 ++++++++++++
web-v2/lib/training/_pace_corpus.test.ts           |   2 +
web-v2/lib/training/execution-semantics.ts         | 649 +++++++++++++++++++++
web-v2/lib/training/goal-projection.ts             |  39 +-
web-v2/lib/training/spec-card.ts                   |  27 +-
web-v2/lib/watch/build-workout.ts                  | 153 ++---
10 files changed, 1308 insertions(+), 110 deletions(-)

### e1ed5848 fix(gate): key the EMPTIED swallow ratchet on identity, not a count (F-2)
web-v2/lib/audit/_swallow_scan.test.ts         |  90 +++++-
web-v2/lib/audit/swallowed-failure-registry.ts | 419 +++++++++++++++++++++++++
2 files changed, 493 insertions(+), 16 deletions(-)

### c69c8043 fix(thesis): the primary limiter stops flipping on an unrelated clock
web-v2/lib/training/_coaching_thesis.audit.test.ts | 160 +++--
web-v2/lib/training/_coaching_thesis.test.ts       | 315 +++++++++
web-v2/lib/training/coaching-thesis.ts             | 725 ++++++++++++++-------
3 files changed, 903 insertions(+), 297 deletions(-)

### 12086e29 fix(adaptation): a test must not dirty the repo it is testing
.../lib/adaptation/_shadow_compare.audit.test.ts   | 42 ++++++++++++++++------
web-v2/lib/adaptation/shadow-compare.ts            | 35 +++++++++++++-----
2 files changed, 58 insertions(+), 19 deletions(-)

### 9c2c18d8 test(evidence): stop pinning a live production row's data quality
.../lib/evidence/_activity_evidence.audit.test.ts  | 173 +++++++++++++++------
web-v2/lib/evidence/_activity_evidence.test.ts     | 123 +++++++++++++--
2 files changed, 235 insertions(+), 61 deletions(-)

### 5017962c fix(capacity): wire self-reported onboarding mileage into the cold-start prior
.../authoring-divergence-explained-2026-09-01.md   | 263 ++++++++++++++++++++
docs/reports/cold-start-prior-fix-2026-09-01.md    | 266 +++++++++++++++++++++
web-v2/lib/training/_capacity_resolver.test.ts     |  99 ++++++++
web-v2/lib/training/capacity-resolver.ts           | 207 ++++++++++++++--
4 files changed, 812 insertions(+), 23 deletions(-)

### 8641a234 feat(plan): shadow-compare legacy VDOT cascade vs canonical prescription anchors
.../canonical-authoring-migration-2026-09-01.md    | 544 +++++++++++++++++++++
web-v2/lib/audit/generated-content-registry.ts     |   2 +
.../plan/_authoring_shadow_compare.audit.test.ts   | 208 ++++++++
web-v2/lib/plan/_authoring_shadow_compare.test.ts  | 243 +++++++++
web-v2/lib/plan/authoring-shadow-compare.ts        | 335 +++++++++++++
5 files changed, 1332 insertions(+)
```



---

# Part 9 · Final full-suite report

```json
{
 "numTotalTestSuites": 1695,
 "numPassedTests": 8126,
 "numFailedTests": 0,
 "numPendingTests": 10,
 "numTotalTests": 8136
}
skipped (by name):
  course-geometry backfill · dry run against a live database reports every race carrying GPX and no geometry
  course-geometry backfill · dry run against a live database the shared writer, in dry run, plans exactly what the planner planned
  CIM block as the cron will author it composes and prints
  CIM block as the cron will author it same block on the days either side, in case the cron slips
  what the plan engine sees of the course reads CIM and the tune-ups
  does his CIM block contain a BASE phase? composes and prints the phases with the gate values that produced them
  CIM block · what the phone shows prints every session as persisted
  CIM block · the goal-relative pace path composes and prints
  workout vocabulary + three-band split marathon build
  workout vocabulary + three-band split half build
```


## 9.1 · Per-file status

```
passed     40  lib/account/deletion-plan.test.ts
passed     13  lib/adaptation/_absorption_split.test.ts
passed      2  lib/adaptation/_adaptation_engine.audit.test.ts
passed     72  lib/adaptation/_adaptation_engine.test.ts
passed     42  lib/adaptation/_adaptation_model.test.ts
passed      8  lib/adaptation/_authoring_convergence.test.ts
passed     12  lib/adaptation/_duration_volume_density_replay_corpus.test.ts
passed     18  lib/adaptation/_pace_replay_corpus.test.ts
passed      4  lib/adaptation/_shadow_compare.audit.test.ts
passed      7  lib/adaptation/pace-hr-compatibility.test.ts
passed      4  lib/audit/_active_plan_scan.test.ts
passed     11  lib/audit/_anchor_derivation_scan.test.ts
passed     23  lib/audit/_automatic_mutations.test.ts
passed     24  lib/audit/_client_graph.test.ts
passed     37  lib/audit/_coercion_scan.test.ts
passed     84  lib/audit/_generated_content_gate.test.ts
passed      9  lib/audit/_normal_window_scan.test.ts
passed     26  lib/audit/_swallow_scan.test.ts
passed     29  lib/audit/_swallowed_failure_fixes.test.ts
passed     17  lib/audit/_timezone_date_scan.test.ts
passed      9  lib/auth/auth-takeover.test.ts
passed      4  lib/auth/login-tz-capture.test.ts
passed      6  lib/auth/password-change-revokes.test.ts
passed      5  lib/auth/strava-state.test.ts
passed      3  lib/conservation/_plan_conservation.test.ts
passed     10  lib/conservation/_reader_lint.test.ts
passed      4  lib/conservation/_run_conservation.test.ts
passed      1  lib/conservation/_surface_figures.audit.test.ts
passed      9  lib/coach/_acwr_continuity.test.ts
passed      9  lib/coach/_adaptation_kind.test.ts
passed      7  lib/coach/_coach_log_kinds.test.ts
passed     34  lib/coach/_convergence.test.ts
passed      8  lib/coach/_convergence_loader.test.ts
passed     28  lib/coach/_heat_doctrine.test.ts
passed     17  lib/coach/_hr_zone_bucket.test.ts
passed     44  lib/coach/_limiter.test.ts
passed      9  lib/coach/_limiter_continuity.test.ts
passed     10  lib/coach/_memory.test.ts
passed      6  lib/coach/_no_silent_refire.test.ts
passed     13  lib/coach/_personal_goals_wiring.test.ts
passed     10  lib/coach/_phase_breakdown.test.ts
passed      8  lib/coach/_race_meta_sentinel.test.ts
passed     16  lib/coach/_readiness_doctrine.test.ts
passed     16  lib/coach/_reading_scope.test.ts
passed      8  lib/coach/_recap_aerobic.test.ts
passed      8  lib/coach/_recap_scope.test.ts
passed     17  lib/coach/_recommendation.test.ts
passed     14  lib/coach/_strength_doctrine.test.ts
passed     10  lib/coach/_tier_doctrine.test.ts
passed     23  lib/coach/acknowledge.test.ts
passed     16  lib/coach/coach-log.test.ts
passed      8  lib/coach/cold-start-personas.test.ts
passed     20  lib/coach/data-shape-personas.test.ts
passed     29  lib/coach/decision-cards.test.ts
passed     33  lib/coach/easy-discipline.test.ts
passed      8  lib/coach/episode-log.test.ts
passed     20  lib/coach/firing-policy.test.ts
passed     15  lib/coach/fitness-evidence.test.ts
passed      6  lib/coach/health-actions.race-week.test.ts
passed      5  lib/coach/health-actions.rule-two.test.ts
passed      3  lib/coach/health-state.hrv-median.test.ts
passed      7  lib/coach/heat-band.test.ts
passed     20  lib/coach/hr-thirds.test.ts
passed      5  lib/coach/log-state.enrich.test.ts
passed     14  lib/coach/morning-brief.test.ts
passed     17  lib/coach/race-replacement.test.ts
passed      8  lib/coach/races-state.test.ts
passed     36  lib/coach/run-purpose.test.ts
passed     45  lib/coach/run-recap.test.ts
passed      5  lib/coach/session-cue.test.ts
passed     17  lib/coach/threshold-pattern.test.ts
passed      5  lib/coach/voice-band-race-schema.test.ts
passed      7  lib/coach/voice-band-wiring.test.ts
passed     20  lib/coach/weather-adjust.test.ts
passed    655  lib/doctrine/_doctrine_gate.test.ts
passed     11  lib/doctrine/_doctrine_lint.test.ts
passed      4  lib/email/send-from.test.ts
passed      4  lib/evidence/_activity_evidence.audit.test.ts
passed     50  lib/evidence/_activity_evidence.test.ts
passed     17  lib/evidence/_reexamination.test.ts
passed     23  lib/execution/_interpret.test.ts
passed     24  lib/execution/_reconstruct.test.ts
passed      9  lib/faff/_display_type_name.test.ts
passed     25  lib/faff/_fitness_read.test.ts
passed     10  lib/faff/_post_run_surfaces.test.ts
passed     29  lib/faff/_prerun_card.test.ts
passed     10  lib/faff/_race_plate.test.ts
passed      9  lib/faff/_refusal_wire.test.ts
passed     27  lib/faff/_session_type_coverage.test.ts
passed      3  lib/faff/_stepped_day_plan.test.ts
passed      5  lib/faff/_stepped_day_route.test.ts
passed     21  lib/faff/_surface_contracts.test.ts
passed     23  lib/faff/_surface_sweep.test.ts
passed      1  lib/faff/_today_thesis.audit.test.ts
passed     21  lib/faff/_v5_today.test.ts
passed     12  lib/faff/_viewed_day.test.ts
passed     12  lib/faff/_why_voice.test.ts
passed     12  lib/faff/block-state.test.ts
passed      4  lib/faff/effort-map.test.ts
passed      9  lib/faff/glance-adapter.test.ts
passed     13  lib/faff/goal-status.test.ts
passed      9  lib/faff/key-workout-state.test.ts
passed     13  lib/faff/race-countdown.test.ts
passed     13  lib/faff/race-roles.test.ts
passed     12  lib/faff/ramp-scope.test.ts
passed     10  lib/faff/recap-voice.test.ts
passed      9  lib/faff/train-goal-status.test.ts
passed      6  lib/faff/unlogged-race-alert.test.ts
passed     12  lib/faff/week-mileage.test.ts
passed     45  lib/fitness/_fitness_model.test.ts
passed      9  lib/format/_format_lint.test.ts
passed      7  lib/notifications/_prompt_or_next_morning.test.ts
passed     15  lib/notifications/_session_moved_sender.test.ts
passed     38  lib/notifications/notifications-wire.test.ts
passed      5  lib/onboarding/_onboarding_e2e.test.ts
passed     28  lib/ops/_cron_ledger.test.ts
passed      7  lib/ops/_cron_stale_alert.test.ts
passed      8  lib/postrun-siege/_attribution.test.ts
passed     22  lib/postrun-siege/_controls.test.ts
passed     14  lib/postrun-siege/_parity.test.ts
passed      8  lib/postrun-siege/_race_recency.test.ts
passed   1430  lib/postrun-siege/_siege.test.ts
passed     24  lib/prescription/_levers.test.ts
passed     22  lib/prescription/_trajectory.test.ts
passed     30  lib/race/_course_elevation.test.ts
passed     12  lib/race/_course_elevation_trust_gate.test.ts
passed     24  lib/race/_distance_category.test.ts
passed      4  lib/race/_effective_target.test.ts
passed      5  lib/race/_goal_framing_accept.test.ts
passed      7  lib/race/_label_only_rows.test.ts
passed      2  lib/race/_probe_course_geometry_backfill.test.ts
passed      8  lib/race/_race_detail_pacing.test.ts
passed     64  lib/race/_race_doctrine.test.ts
passed     13  lib/race/_race_outlook_contract.test.ts
passed      7  lib/race/_race_role_accept.test.ts
passed      5  lib/race/_race_row_refresh_gate.test.ts
passed     60  lib/race/_representativeness.test.ts
passed     18  lib/race/_representativeness_upward.test.ts
passed     13  lib/race/auto-result.test.ts
passed      8  lib/race/b-goal.test.ts
passed      6  lib/race/coach-goal-durability.test.ts
passed     34  lib/race/coach-goal.test.ts
passed     13  lib/race/course-geometry-source.test.ts
passed     12  lib/race/distance.test.ts
passed     27  lib/race/execution-plan.test.ts
passed      4  lib/race/next-best-anchor.test.ts
passed     16  lib/race/pacing.test.ts
passed     14  lib/race/personal-records.test.ts
passed     33  lib/race/race-role.test.ts
passed      9  lib/race/races-user-scoping.test.ts
passed      4  lib/race/slug-claim.test.ts
passed     51  lib/plan/_adapt_invariants.test.ts
passed     20  lib/plan/_anchor_fit.test.ts
passed      2  lib/plan/_audit_connection_parity.test.ts
passed      3  lib/plan/_audit_easy_anchor.test.ts
passed      2  lib/plan/_audit_long_ramp.test.ts
passed      2  lib/plan/_audit_maintenance_buckets.test.ts
passed     13  lib/plan/_audit_nonrace.test.ts
passed      3  lib/plan/_audit_pace_anchors.test.ts
passed    556  lib/plan/_audit_periodization.test.ts
passed      1  lib/plan/_audit_persist_realization.test.ts
passed      8  lib/plan/_audit_persisted_quality.test.ts
passed      9  lib/plan/_audit_placement.test.ts
passed     10  lib/plan/_audit_slow_goal.test.ts
passed     16  lib/plan/_audit_slow_runner.test.ts
passed      2  lib/plan/_audit_stimulus_gap.test.ts
passed     10  lib/plan/_audit_structural.test.ts
passed      2  lib/plan/_audit_tier_experience.test.ts
passed      1  lib/plan/_audit_volume.test.ts
passed      3  lib/plan/_authoring_shadow_compare.audit.test.ts
passed     12  lib/plan/_authoring_shadow_compare.test.ts
passed     10  lib/plan/_backdate_guard.test.ts
passed      6  lib/plan/_base_gate_invariant.test.ts
passed     10  lib/plan/_bump_pullback_guard.test.ts
passed     10  lib/plan/_catalogue_wiring.test.ts
passed      6  lib/plan/_coach_sensible.test.ts
passed     21  lib/plan/_coldstart_doctrine.test.ts
passed     12  lib/plan/_convergence_downgrade.test.ts
passed     12  lib/plan/_dosing_composer.test.ts
passed     10  lib/plan/_dosing_doctrine.test.ts
passed      2  lib/plan/_dosing_sweep_gate.test.ts
passed      6  lib/plan/_downward_reanchor.test.ts
passed     12  lib/plan/_goal_framing_card.test.ts
passed     13  lib/plan/_goal_immutability.test.ts
passed      9  lib/plan/_graded_miss.test.ts
passed     17  lib/plan/_guard_fail_closed.test.ts
passed      8  lib/plan/_heat_trigger.test.ts
passed     28  lib/plan/_injury_doctrine.test.ts
passed      4  lib/plan/_intensity_doctrine.test.ts
passed      1  lib/plan/_label_distance_truth.test.ts
passed      1  lib/plan/_label_truth.test.ts
passed     30  lib/plan/_lifecycle_open_block.test.ts
passed      5  lib/plan/_maint_invariants.test.ts
passed      8  lib/plan/_maint_repro.test.ts
passed     12  lib/plan/_midblock_window.test.ts
passed      9  lib/plan/_midrace_goal.test.ts
passed     10  lib/plan/_midrace_invariants.test.ts
passed     10  lib/plan/_midrace_role.test.ts
passed      8  lib/plan/_missed_dedup_durable.test.ts
passed     17  lib/plan/_mp_doctrine.test.ts
passed     33  lib/plan/_mutation_boundary.test.ts
passed      8  lib/plan/_no_strength_rows.test.ts
passed      4  lib/plan/_null_anchor_reachability.test.ts
passed     22  lib/plan/_open_block_authoring.test.ts
passed      8  lib/plan/_overshoot_continuity.test.ts
passed      9  lib/plan/_overshoot_race_recency.test.ts
passed      9  lib/plan/_overshoot_recovery.test.ts
passed      3  lib/plan/_owned_days_reign.audit.test.ts
passed      9  lib/plan/_owned_days_reign.test.ts
passed     30  lib/plan/_plan_delta.test.ts
passed     14  lib/plan/_plan_delta_blockswap.test.ts
passed     15  lib/plan/_plan_drift_lifecycle.test.ts
passed     20  lib/plan/_plan_undo.test.ts
passed      2  lib/plan/_probe_cim_block.test.ts
passed      1  lib/plan/_probe_cim_course.test.ts
passed      1  lib/plan/_probe_cim_phases.test.ts
passed      1  lib/plan/_probe_cim_sessions.test.ts
passed      1  lib/plan/_probe_race_pace.test.ts
passed      2  lib/plan/_probe_vocabulary.test.ts
passed     11  lib/plan/_progression_dose_persisted.test.ts
passed     17  lib/plan/_progression_gate.test.ts
passed     18  lib/plan/_progression_pass.test.ts
passed      8  lib/plan/_progression_spec.test.ts
passed      9  lib/plan/_proposal_message.test.ts
passed      6  lib/plan/_quality_day.test.ts
passed     16  lib/plan/_quality_drift_hr.test.ts
passed      1  lib/plan/_r3_adv_g_david.test.ts
passed      4  lib/plan/_r3_adv_g_repro.test.ts
passed      1  lib/plan/_r3_lowvol_taper.test.ts
passed      1  lib/plan/_r3_lowvol_taper2.test.ts
passed      2  lib/plan/_r3_n2_repro.test.ts
passed     13  lib/plan/_race_pace_ceiling.test.ts
passed      9  lib/plan/_race_role_card.test.ts
passed      1  lib/plan/_race_runup.test.ts
passed      1  lib/plan/_race_weekcount_invariant.test.ts
passed      8  lib/plan/_ramp_readiness_bar.test.ts
passed      1  lib/plan/_rationale_backfill.audit.test.ts
passed      3  lib/plan/_rationale_persist.test.ts
passed      4  lib/plan/_rebuild_derivations.test.ts
passed      1  lib/plan/_recompute_paces.audit.test.ts
passed     16  lib/plan/_recompute_paces.test.ts
passed      7  lib/plan/_recovery_doctrine.test.ts
passed      3  lib/plan/_recovery_half_duration.test.ts
passed      4  lib/plan/_recovery_week_number.test.ts
passed     17  lib/plan/_replan_scenarios.test.ts
passed      3  lib/plan/_repro_live.test.ts
passed      2  lib/plan/_repro_lowvol.test.ts
passed     16  lib/plan/_restore_continuity.test.ts
passed      5  lib/plan/_runner_compromised_fail_closed.test.ts
passed      1  lib/plan/_screenshot_test.test.ts
passed     14  lib/plan/_seglong_authoring.test.ts
passed      4  lib/plan/_silent_rebuild_undoable.test.ts
passed      9  lib/plan/_skip_respected.test.ts
passed      5  lib/plan/_slot_allocation.test.ts
passed      3  lib/plan/_spike_rule_gate.test.ts
passed      2  lib/plan/_strict_n1_probe.test.ts
passed      3  lib/plan/_sublabel_voice.test.ts
passed      3  lib/plan/_supersede_intents.test.ts
passed      1  lib/plan/_sweep_allusers.test.ts
passed     23  lib/plan/_training_lead.test.ts
passed      8  lib/plan/_training_lead_e2e.test.ts
passed     14  lib/plan/_travel_invariants.test.ts
passed     31  lib/plan/_v5_block_scenarios.test.ts
passed     39  lib/plan/_variety_invariants.test.ts
passed     12  lib/plan/_vocab_doctrine.test.ts
passed      1  lib/plan/_wave1_smoke_dryrun.test.ts
passed      7  lib/plan/_week_note_scrub.test.ts
passed      4  lib/plan/_week_primary_run.test.ts
passed      4  lib/plan/_week_read_agreement.test.ts
passed     26  lib/plan/_zone_grammar.test.ts
passed     11  lib/plan/adapter-bench.test.ts
passed     22  lib/plan/adaptive-ramp.test.ts
passed     18  lib/plan/block-preview.test.ts
passed      3  lib/plan/calibration-intro.test.ts
passed      3  lib/plan/calibration.test.ts
passed     40  lib/plan/coaching-structural.test.ts
passed     13  lib/plan/drift-proposal-policy.test.ts
passed     11  lib/plan/generate-ultra.test.ts
passed    136  lib/plan/generator-bench.test.ts
passed      3  lib/plan/layout-from-prefs.test.ts
passed     11  lib/plan/pace-zones.test.ts
passed     58  lib/plan/plan-engine.test.ts
passed      2  lib/plan/plan-workouts-user-uuid.test.ts
passed     17  lib/plan/race-lifecycle.test.ts
passed     12  lib/plan/reanchor-plan.test.ts
passed     11  lib/plan/return-ladder.test.ts
passed     10  lib/plan/sim-inputs.test.ts
passed      3  lib/plan/simulator-db-errors.test.ts
passed     15  lib/plan/spec-completeness.test.ts
passed     17  lib/plan/strip-citations.test.ts
passed     10  lib/plan/validate.test.ts
passed     30  lib/runs/_absorption_invariant.test.ts
passed      5  lib/runs/_absorption_predicate.test.ts
passed      9  lib/runs/_cadence_units.test.ts
passed     10  lib/runs/_canonical_family.test.ts
passed     66  lib/runs/_coherence_gate.test.ts
passed     27  lib/runs/_coherence_regression.test.ts
passed      7  lib/runs/_dedup-health.audit.test.ts
passed      3  lib/runs/_identity_lint.test.ts
passed      9  lib/runs/_ingest-audit.audit.test.ts
passed     30  lib/runs/_ingest_integrity.test.ts
passed      7  lib/runs/_ingest_split_reconciliation.test.ts
passed      7  lib/runs/_pace_selfcheck.test.ts
passed      3  lib/runs/_plan_date_join_lint.test.ts
passed      8  lib/runs/_run_shape_lint.test.ts
passed      1  lib/runs/_splits_repair_sql.audit.test.ts
passed      1  lib/runs/_startutc-backfill-proposal.audit.test.ts
passed      6  lib/runs/_vocabulary_split.test.ts
passed      6  lib/runs/absorb-splits-verdict.test.ts
passed      6  lib/runs/belt-averages.test.ts
passed      3  lib/runs/circular-merge-repair.audit.test.ts
passed      7  lib/runs/derive-splits.test.ts
passed      9  lib/runs/distance-guard.test.ts
passed      7  lib/runs/emptyish-erase.test.ts
passed      9  lib/runs/energy.test.ts
passed     18  lib/runs/identity.test.ts
passed     24  lib/runs/ingest-survival.test.ts
passed     24  lib/runs/log-enrich.test.ts
passed     31  lib/runs/run-shape.test.ts
passed      7  lib/runs/split-coverage.test.ts
passed      5  lib/runs/split-sanity.test.ts
passed     16  lib/runtime/day-key.test.ts
passed      8  lib/runtime/request-memo.test.ts
passed      7  lib/shoe/_mileage_provenance.test.ts
passed     15  lib/shoe/lifespan.test.ts
passed      4  lib/strava/_tcx_cadence.test.ts
passed     10  lib/strava/build-tcx.test.ts
passed      9  lib/strava/push-resolve.test.ts
passed      8  lib/strava/push-unpushable.test.ts
passed      6  lib/strava/webhook-alerts.test.ts
passed      9  lib/strava/webhook-reconcile.test.ts
passed     17  lib/strava/webhook-verify.test.ts
passed     43  lib/terrain/grade-adjust.test.ts
passed     36  lib/today/composition.test.ts
passed     20  lib/today/post-race-composition.test.ts
passed     12  lib/watch/_heat.test.ts
passed     10  lib/watch/_session_class.test.ts
passed      8  lib/watch/_watch_anchor_split.test.ts
passed     15  lib/watch/_watch_cues_rules.test.ts
passed     22  lib/watch/_watch_lobby.test.ts
passed      4  lib/watch/_watch_recap_rows.test.ts
passed      9  lib/watch/_wire_labels.test.ts
passed      1  lib/watch/_zz_watch_payload_20260901.test.ts
passed     11  lib/training/_audit_goalmode.test.ts
passed      1  lib/training/_capacity_resolver.audit.test.ts
passed     45  lib/training/_capacity_resolver.test.ts
passed      1  lib/training/_coaching_thesis.audit.test.ts
passed     15  lib/training/_coaching_thesis.test.ts
passed      7  lib/training/_cold_start_fixtures.test.ts
passed      4  lib/training/_durability_anchor.audit.test.ts
passed     28  lib/training/_durability_anchor.test.ts
passed     11  lib/training/_elevation_doctrine.test.ts
passed     16  lib/training/_execution_semantics_owner.test.ts
passed     32  lib/training/_goal_assessment.test.ts
passed      1  lib/training/_goal_assessment_sample.test.ts
passed      3  lib/training/_goal_floor_isolation.test.ts
passed      7  lib/training/_heat_continuity.test.ts
passed     17  lib/training/_heat_model_doctrine.test.ts
passed     16  lib/training/_max_hr_lthr_floor.test.ts
passed     25  lib/training/_normal_window.test.ts
passed     16  lib/training/_pace_anchor.test.ts
passed      3  lib/training/_pace_corpus.audit.test.ts
passed     39  lib/training/_pace_corpus.test.ts
passed      1  lib/training/_prescription_resolver.audit.test.ts
passed     48  lib/training/_prescription_resolver.test.ts
passed     17  lib/training/_projection_trend.test.ts
passed      7  lib/training/_race_authority_durability.test.ts
passed     20  lib/training/_race_card.test.ts
passed      3  lib/training/_race_history.test.ts
passed     13  lib/training/_race_projection.test.ts
passed     21  lib/training/_spec_card.test.ts
passed      9  lib/training/_target_continuity.test.ts
passed     10  lib/training/_targets_projection_invariants.test.ts
passed     21  lib/training/_threshold_evidence_contract.test.ts
passed     12  lib/training/_vdot_corpus_anchor.test.ts
passed      8  lib/training/_vdot_inputs_provisional.test.ts
passed     12  lib/training/_vdot_split_clock.test.ts
passed     13  lib/training/_watch_grader_parity.test.ts
passed     12  lib/training/_workout_type.test.ts
passed      1  lib/training/_zz_replay_20260901.test.ts
passed     23  lib/training/biometrics-refresh.test.ts
passed     15  lib/training/confidence-cross-span.test.ts
passed     15  lib/training/expand-spec.test.ts
passed      7  lib/training/fitness-trajectory-belowtable.test.ts
passed      7  lib/training/fitness-trajectory-durability.test.ts
passed     14  lib/training/goal-projection-ahead.test.ts
passed      6  lib/training/goal-projection-belowtable.test.ts
passed      6  lib/training/goal-projection-durability.test.ts
passed     32  lib/training/goal-projection.test.ts
passed      7  lib/training/goal-ready-belowtable.test.ts
passed     10  lib/training/goal-ready.test.ts
passed      8  lib/training/lillian-sim.test.ts
passed     22  lib/training/lthr-reanchor.test.ts
passed      5  lib/training/lthr.test.ts
passed      7  lib/training/parse-race-time.test.ts
passed      6  lib/training/targets-summary-belowtable.test.ts
passed      6  lib/training/targets-summary-ultra.test.ts
passed     14  lib/training/vdot-anchor-fade.test.ts
passed      9  lib/training/vdot-goal-floor.test.ts
passed      5  lib/training/vdot-inputs-window.test.ts
passed     31  lib/training/vdot-race-authority.test.ts
passed     16  lib/training/vdot-selection-order.test.ts
passed     34  lib/training/vdot-slow-runner-floor.test.ts
passed      6  lib/training/zone-stimulus.test.ts
passed     18  lib/training/zones.test.ts
passed      5  lib/wire-format/_format_vectors.test.ts
passed     15  lib/workout-catalogue/_catalogue.test.ts
passed      4  lib/workout-catalogue/_reachability.test.ts
passed     31  lib/workout-catalogue/_select.test.ts
passed      1  lib/workout-catalogue/_smoke.test.ts
```



---

# Part 10 · The independent coaching-system audit this push answered (2026-09-01, branch `audit/independent-coaching-system-2026-09-01` @ `03052e6f`, verbatim)

## Independent coaching-system audit — 2026-09-01

Fresh-session, independent audit of faff.run's coaching brain as it exists on `main` at `7cac80f0`, traced from activity ingestion through plan generation, adaptation, race prediction, and runner-facing presentation. Every prior report was treated as a claim to verify; every number below that is not marked otherwise was produced by executing the real code against read-only production or by querying it directly. Seven scoped verification agents worked in isolated worktrees; their full reports are in `docs/reports/independent-coaching-system-audit-2026-09-01/` and are the evidence behind the summaries here.

### 0 · Executive verdict

**Is the coaching brain coherent?** Partly. The canonical layer the migration built is real and correctly bounded: the four capacity resolvers are goal-sealed at compile time, confidence decays while values hold, readiness and heat never touch capacity, one race does not rewrite the exponent, the flex path prices every zone from evidence, and the shadow adaptation path provably writes nothing but its own log. But the runner does not yet receive one coaching decision. Six questions still have two live owners (pace at authoring vs on the flex path, with a goal→pace blend still live on rebuilds; adaptation live vs shadow, disagreeing on every logged cycle; readiness; durability exponent; race projection; and eleven heart-rate numbers), the Coaching Thesis has zero live callers, and the Runner Model's threshold reader is a second evidence engine that admits sessions the real Evidence Engine refuses and ignores the hero-workout guard.

**Is the live plan trustworthy today?** On volume, structure, cutbacks and taper shape: yes, with caveats (Rule 8 applied correctly, the 45 mi/wk opening is honest, the block does not chase the goal). On race-specific pace: **no**. Every marathon-pace rehearsal is 7:55/mi and race day is 7:16/mi, because `race` rows are exempt from the recompute that moved everything else; the race-day HR cap of 155 is unachievable at that pace on his own data. He will arrive at CIM having never run the pace he is asked to race.

**Are current paces trustworthy?** Training paces are evidence-based and in the right direction, but not at the precision shown. The threshold anchor moved 10 s/mi in one day off one session, through a reader with no per-observation weight whose two supporting sessions on 2026-09-01 are an I-pace interval day (HR 91% of LTHR) and an abandoned, HR-less taper-week treadmill; two "runner is slower than we thought" observations lowered the corroboration bar and made the belief faster. The ±8 s/mi band is graded against instantaneous GPS pace on the wrist: this morning's near-perfect 4×1 mi (422/429/422/419 against 430, recoveries within 4 s, HR mid-band) was returned as drifted, drifted, drifted, missed, and the cool-down run 32 s/mi under its ceiling was "missed" too. Tempo days show ±20 on the phone and ±8 on the watch.

**Is race outlook trustworthy?** As a set, no. The phone's "Projected" is canonical and honest for races with a goal (CIM 3:24:12). But a race without a goal skips the durability blend entirely, so Santa Monica shows "Projected 43:38" above the coach's own "A ~44:15"; the watch and execution plan pace CIM off a raw snapshot (3:11:20 vs 3:14:00); the pending goal-outlook card still says 3:30:13; the morning-brief payload carries two "tracking" numbers ten minutes apart; and a third, unshrunk exponent fit in `limiter.ts` tells the coaching advice his limiter is threshold while the canonical read says endurance. Nine distinct numbers exist for CIM today.

**Is Pace adaptation ready for an owner-only canary?** **No.** The single proposal it would apply (435 → 430) rests on two sessions inside the AFC recovery window, is a proposal the engine itself deferred behind DURATION, sits one representative day from flipping to a refusal, and targets a belief that moved 10 s/mi yesterday off one session. The canary branch itself is genuinely off, atomic and narrow, but its runtime gate is unfalsifiable in CI, its audit snapshot is outside the transaction, its rollback is ungated, and it raises no alert. Landing the branch is low-risk; enabling it is not. Concrete promotion criteria are in §8.

**Three highest risks**

1. **Race-pace incoherence in the live block** (§5, N-1): 31.5 miles of "marathon pace" at 7:55, a race row frozen at 7:16 since authoring, an abort trigger at 7:38 between them, and an HR cap the pace cannot satisfy. Reaches the runner from week 8 (2026-10-19). Needs one product decision (§14 B) and a one-line exemption change.
2. **The threshold capacity reader is not the Evidence Engine** (§4, N-5): label-gated admission, no `completed` or HR gate, unweighted order statistic, direction-blind relaxation, hero guard unwired. Every quality pace, the shadow proposal, and the canary depend on a number that is one session from moving again.
3. **Grading and presentation contradict the prescription** (§6, §10, N-2/N-3/N-10/N-11): five tolerances for one band, ceilings graded as bands, eleven HR numbers with four live on one session, a bail that says "heart rate over 173" and is triggered by pace, a recap that says "in the band" without checking. The runner is told he failed sessions he executed, which is the mission statement failing on the screen. Underneath it, four gates that exist to catch exactly these classes were made to pass with the violation live (G-1, G-2), and no automated runner executes the full test suite (G-3).

**What is safe to ship immediately:** items 1–12 of §13 (tolerance owner, easy-discipline scope, zero-run HOLD, threshold corpus gates with a replay, thesis ranking, recap arms, race-consumer routing, cron double-run, gate repairs, CI full suite, migration-branch code merge, header cleanup). **What needs more shadow evidence:** any live PACE mutation (14 clean days after the evidence fixes, per §8). **What legacy authority should be deleted:** the authoring goal blend, `limiter.ts`'s exponent fit, `simulator.ts` as a projection source, `hrCapLong`, the six `currentVdot` copies, the `pass` rules nothing reads, the dead orphans and root probes (§12). **Whether the canary should begin:** not this week; §8 says exactly when. **What the next code agent executes autonomously:** §15.

---
### 1 · Audit provenance

| Item | Value |
|---|---|
| Audited tree | `main` at `7cac80f0` (local). `origin/main` was `43e15e88`; `7cac80f0` is one docs-only commit on top, unpushed at audit time. Every code path audited is byte-identical between the two. |
| Branches reviewed | `origin/canonical-authoring-migration-20260901` @ `8641a234` · `origin/cold-start-prior-fix-20260901` @ `5017962c` · `origin/pace-canary-infrastructure-20260901` @ `a0051439` |
| Database | Production Railway Postgres, role `faff_readonly` via `DATABASE_URL_RO`, read-only throughout. Owner `0645f40c-951d-4ccc-b86e-9979cd26c795`, active plan `pln_9a57561debb776e5`. No write URL was used by the coordinator or any agent; two agents additionally pinned `DATABASE_URL` to the RO URL for their test processes. |
| When | 2026-09-01, ~22:00 UTC → 2026-09-02 ~01:30 UTC |
| Isolation | Coordinator: `scripts/verify-commit.sh 7cac80f0` in `.claude/worktrees/verify-commit`; gates and tests in the root `web-v2` (clean of code changes at start). Seven agents in `.claude/worktrees/agent-*`. **Every agent worktree was created from the stale `claude/build-runcino-app-OIRJr` line (`f43fb7a7`, no `web-v2/`), not from `main`.** All seven detected it and reset to `7cac80f0` before reading code; each report states its audited commit. |
| Checks run | `verify-commit.sh 7cac80f0` → **CLEAN** (`tsc --noEmit` + `next build`, 108 s). All 17 `prebuild` gates → **PASS** (`check-wire-keys` alone takes 219 s). Full `vitest run` → **387 files passed, 1 failed; 7972 tests passed, 2 failed, 10 skipped** (209 s). Both failures are in `lib/evidence/_activity_evidence.audit.test.ts`, which asserts facts about a live production row that has since gained a splits array (§4, trace E). Migration and cold-start branches: `tsc` 0 errors, 11/11 + 2/2 and 47/47 pass, merge into `main` conflict-free; cold-start + main merged: 2828 tests pass. Canary branch: `tsc` clean, 56/56 runnable tests, merges clean. Gate falsifications performed and recorded in §2 and §11. |
| CI / deploy | GitHub `build-check` **success** at `43e15e88` (run 33548196444). Railway deployment `7126bab9` **SUCCESS** at `43e15e88`, live. Two consecutive Railway builds **FAILED** on 2026-09-01 (`2352f3e2` 01:32 UTC, `fe448a71` 01:42 UTC) until `cc0a1010` registered a `MODULE_ORPHANS` exemption; production ran the prior image for ~20 minutes. Rule 19 held at the end of the night, not throughout it. |
| Cron liveness | `ops_alerts.cron_ok` last success per job on 2026-09-01: run-adaptations 08:26, plan-drift 13:52, snapshot-projections 12:41, strava-sync 13:29, others between 12:39 and 14:31. `run-adaptations` scheduled 03:00 UTC fired 08:26 on 09-01 and 09:29 on 08-31; `prune-adaptation-shadow-log` has **never** recorded a completion. Nine `cron_stale` alerts from 2026-08-31 04:18 remain unacknowledged. |
| Reports consulted | `handback-2026-09-01.md`, `handback-round2-2026-09-01.md`, `handback-round3-2026-09-01.md`, `adaptation-authority-policy-brief-2026-09-01.md`, `status-and-answers-2026-08-31.md`, `workout-provenance-trace-2026-09-01.md`, `workout-fix-verification-2026-09-01.md`, `gate-verification-2026-09-01.md`, `race-prediction-consolidation-2026-09-01.md`, `race-prediction-goal-projection-durability-2026-09-01.md`, `goal-card-audit-2026-09-01.md`, `coaching-thesis-2026-09-01.md`, `shadow-log-production-2026-09-01.md`, `pace-shadow-compare-2026-09-01.md`, `pace-hr-compatibility-2026-09-01.md`, `hr-semantics-2026-09-01.md`, `absorption-*-2026-09-01.md` (three), `adaptation-reason-honesty-fix-2026-09-01.md`, `duration-volume-density-fixture-corpus-2026-09-01.md`, `pace-replay-corpus-2026-09-01.md`, `stability-report-tooling-2026-09-01.md`, `plan-version-audit-and-live-refresh-2026-09-01.md`, `taper-tempo-comparison-basis-2026-09-01.md`, `verification-policy-2026-09-01.md`, `ci-recovery-2026-09-01.md`, `canonical-authoring-migration-2026-09-01.md` (migration branch), `docs/reference-cases/todays-run-full-trace-2026-09-01.md` (untracked), `docs/PRODUCT_DECISIONS.md` 2026-08-30 → 2026-09-01 entries, and every doctrine document in `CLAUDE.md`'s required-reading list. |
| Evidence classes | **DIRECT** = executed or queried by this audit · **CODE-PATH** = traced in source, not executed · **FIXTURE** = proven only on synthetic inputs · **UNVERIFIED** = could not confirm. Marked per claim below. |
| Limitations | No iPhone or Watch screen was rendered (Rule 13). Every phone/watch finding is source-level plus production data; the numbers behind them were executed, the pixels were not. The `LiveRunOutdoorV5` screen and the goal-outlook card have now gone unrendered through three audits. The wrong-plan-version DB sweep (round 2 §E) and the 90-date absorption dual log (round 3 §8) were not re-run; their code is verified, their numbers are report evidence. Watch source audited is `legacy/native/Faff/FaffWatch Watch App` (what `ship-testflight-v2.sh` ships). |

**Push disclosure (Rule 20 / the 2026-09-01 `--no-verify` policy).** This report's own push to `audit/independent-coaching-system-2026-09-01` tripped `.githooks/pre-push`: in a fresh worktree the hook printed `web-v2/node_modules missing — skipping pre-push checks` (it skipped its web checks rather than failing) and then ran the watch gate, which failed on `xcodegen` because the untracked `Secrets.xcconfig` does not exist in a new worktree. The pushed range is 8 documentation files, 6,273 insertions, no runtime code. All seven conditions of the formal exception hold: (1) the failure is environmental and the range touches no watch path; (2) `scripts/verify-commit.sh 2bc0ba63` in the isolated verify worktree reports `CLEAN`, `check-web-build.sh PASS (38 s)`, `check-watch.sh N/A — commit does not touch watch paths, hook would skip it too`; (3) that tool runs the hook's own checks; (4) recorded here; (5) `build-check.yml` triggers only on pushes to `main`, so no CI run exists for this branch — stated, not assumed; (6) nothing merged, migrated, or destroyed; (7) disclosed in this paragraph and in the session's final message. The push was made with `--no-verify`. Two hook defects this exposes are recorded as S-10.


---

### 2 · Claim-verification ledger

Every material claim from the three handbacks and the authority-policy brief. **V** = VERIFIED · **PV** = PARTIALLY VERIFIED · **S** = STALE · **C** = CONTRADICTED · **NV** = NOT VERIFIABLE.

#### Handback 1 (`handback-2026-09-01.md`)

| # | Claim | Status | Evidence |
|---|---|---|---|
| 1.1 | Threshold capacity: `resolveThresholdCapacity`, direct, conf 0.727, 430 s/mi | **V** (as of 08-31) · **S** today | Production `adaptation_shadow_log` rows 1–10 carry `capacity_belief.paceSecPerMi 430, confidence 0.727→0.724`. Re-run on 2026-09-01 after the owner's morning session: **420 s/mi (7:00), conf 0.79** (Agent A, DIRECT). See §4 trace A. |
| 1.2 | Easy ceiling: `resolveEasyCeiling`, direct, conf 0.634, 502 s/mi | **V** | Prod `pace_recompute.anchors.easy 502`; resolver re-run returns 8:22, conf 0.63 (DIRECT). |
| 1.3 | High-intensity: `vdot_fallback`, conf 0.291, no direct reader | **V** (08-31) · moved | Thesis audit prints 0.291 `vdot_fallback`; 09-01 re-run returns 6:41/mi conf 0.50 (DIRECT). Still no direct reader. |
| 1.4 | Durability exponent: `resolveRaceExponent` is the one canonical source; `coach-goal.ts` consumes it | **PV → C on "one"** | `coach-goal.ts` and `goal-projection.ts` do consume it (DIRECT). **A third, unshrunk 56-day two-race fit lives in `lib/coach/limiter.ts:433` `fitRiegelExponent`, live on `goal-gap.ts:678` → coaching advice**, never named by any report (Agent C, DIRECT). |
| 1.5 | Race projection: every consumer routes through `resolveRaceProjection` | **PV** | Seven named consumers do (DIRECT). `lib/race/effective-race-target.ts:114` (watch/execution target) clamps off raw `projection_snapshots`; `lib/plan/simulator.ts:323` (morning-brief A/B/C) computes its own. §9. |
| 1.6 | Pace prescription (live flex): `resolvePrescribedPaceAnchors` in `recompute-paces.ts` / `reanchor-plan.ts` | **V** | Only three importers, all correct (DIRECT grep). Owner's future rows carry canonical anchors (DIRECT). |
| 1.7 | Initial authoring still on the VDOT cascade in `generate.ts` | **V** | 26 call expressions / 22 lines (report's name set) or 38 / 34 (broad set) (Agent A, DIRECT). |
| 1.8 | Coaching Thesis: `resolveCoachingThesis`, **"live, confidence-normalized"** | **C** | `grep -rn resolveCoachingThesis web-v2/lib web-v2/app` → the only caller is `_coaching_thesis.audit.test.ts`. **Zero live consumers.** Built and unit-tested; not wired to any route, plan path, or surface (DIRECT). |
| 1.9 | Adaptation proposals: shadow only, `resolveAdaptationProposals` not called live | **V** | Only caller is `shadow-compare.ts:315` (DIRECT). |
| 1.10 | `EVIDENCE_RUN_FLOOR_MI = 3.0` flat; `goalRunFloorMiForUser` deleted | **V** | `vdot.ts:726`; no non-comment reference remains (DIRECT). |
| 1.11 | `selection_rationale` persisted and wired into `/api/v5/today` | **V** in code · **inert live** | `spec-card.ts:591` → `v5-today.ts:668` → `route.ts:1593` (DIRECT). **0 of 103 rows on the live plan carry it** (authored one day before the fix) (DIRECT). |
| 1.12 | All listed commits on `origin/main` | **V** | 34 claimed SHAs checked with `git merge-base --is-ancestor`; all present (DIRECT). |
| 1.13 | Railway deploys `a8382aab` / `6190283395` / `4a4aa03c` SUCCESS | **NV** | Railway list shows the last 20 deployments only. Current deployment `7126bab9` at `43e15e88` is SUCCESS (DIRECT). |
| 1.14 | 4×1 card "after": WU `≤ 8:22`, reps `7:02-7:18`, HR `160-167 (Z4)`, recovery by feel, CD copy | **V** | Reproduced from the live row via `cardFromSpec` (Agent E, DIRECT). |
| 1.15 | 4×1 card: warm-up/cool-down HR `<139 bpm (Z1)` | **C** | At LTHR 168 the live string is `~< 142 bpm (Z1 Recovery)`; 139 needs LTHR 164 (Agent E, DIRECT). |
| 1.16 | Rep band ±8 s/mi "is the same tolerance the watch already grades against" | **PV** | True of the watch's `PaceDrift` (±8, instantaneous). False of every server consumer: evidence pipeline ±10, blended basis ±15, run-detail ±10, influence copy ±12 (Agent E, DIRECT). The `spec-card.ts:174` comment asserting parity is false for the server side. |
| 1.17 | EASYBAND-TIE-1: ceiling resolves to 502 s/mi | **V** | Band lo 502 on every future easy/long row (DIRECT). |
| 1.18 | Authoring/recompute gap "converges fast — 77 of 78 future rows rewritten" | **V for the owner** · **C as a general claim** | `reanchorActivePlan` GUARD 2 returns null on a null measured VDOT; **6 of 7 live plans have never been reanchored**, one for 24 days (Agent A, DIRECT). §7. |
| 1.19 | Phone and watch stamp identical WU/CD ceiling and recovery from one `expandSpecToPhases` | **V** for pace/structure · **C** for HR | Same expansion, same tolerance (Agent E, DIRECT). HR differs: phone `160–167`, watch work phase `168`, pass `≤164`, bail `>173` (Agents D+E, DIRECT). |
| 1.20 | Lookback extension: 28d→56d, 5 sessions found, 4 controlled | **V** on counts · **S** on mechanism | Reproduced (Agent B, DIRECT). The step is **7 days** (`REPRESENTATIVE_LOOKBACK_STEP_DAYS = 7`), not 28→56→120; 56 is where this account happened to land. **Two of the four controlled sessions (08-23, 08-30) are inside the AFC prescribed recovery window** (`isPrescribedNonNormal = true`, DIRECT). §8. |
| 1.21 | Unfiltered 42-day `classifyAdaptation` window holds DURATION; deliberately unfixed | **V** | `load.ts:494-502` still feeds the unfiltered input to the live path (DIRECT). |
| 1.22 | Historical tolerance 33.4 mi/wk vs 45 prescribed, Rule-8 filtered | **V** | Reproduced, 62 representative days (Agent B, DIRECT). |
| 1.23 | DENSITY: 1 owner row / 6 app-wide of ~4,639 carry a `progression` block | **V** exactly | `4639 / 6`; owner's one row is 2026-10-29 (DIRECT). |
| 1.24 | Compound-lever guard `MORE_THAN_ONE_STIMULUS_CHANGE` | **V** | Falsified both ways in `_adaptation_engine.test.ts:1290/1309` (Agent B, DIRECT). |
| 1.25 | `INSUFFICIENT_EVIDENCE` is a distinct enforced state; `contradictionsIn` fails a refusal wearing a finding code | **PV** | True in that direction. **One-directional**: a `HOLD` wearing `ABSORPTION_POOR` on a zero-run account passes with `contradictions = []` — three such rows in production today (Agent B, DIRECT). §8. |
| 1.26 | Regenerated-block dry run: PACE PROGRESS 438→430, conf 0.71 | **S** | Now 435→430 phase-grouped, conf 0.689 (DIRECT). And the PACE proposal is **deferred** behind DURATION in the engine's own ranking; the log has no `deferred` column (Agent B, DIRECT). |
| 1.27 | `hr_cap_bpm` does not move with a pace change | **V** (and correct per the 09-01 decision) | No pace input reaches `hrCapEasy`; canary writes only `pace_target_s_per_mi` (Agent D, DIRECT). |
| 1.28 | Full suite 7,892 passing; `_doctrine_gate` 4/658 fixed | **PV** | Doctrine gate 662/662 (DIRECT). Full suite today 7972 pass / **2 fail** (live-data drift, §4 trace E). |
| 1.29 | Goal blend deleted from the flex path; four functions kept only because `generate.ts` calls them | **V** · **new finding** | `recompute-paces.ts` no longer reads a goal (DIRECT). `generate.ts:9110` still calls `blendedTPaceForWeek`, and on a **mid-block rebuild** `BLEND_GRACE_FRACTION = 0.15` moves the authored threshold pace 15% toward the goal at **zero** demonstrated progress; the owner's live plan has `measured_progress_fraction = 0`, so it fired on 2026-08-31 (Agent A, DIRECT). §7. |
| 1.30 | Goal-card ghost DISMISS suppressed (`ad220f83`) | **V** in source · **UNVERIFIED** render | `CoachDecisionCard.swift:689-700` (DIRECT). Never rendered by any audit. |
| 1.31 | `GoalGap.trajectorySec` fixed (3:23:23 → 3:18:01) | **V** mechanism · **S** numbers | Resolves through `resolveRaceProjection` (DIRECT). Today 3:24:12. `trajectoryBasis` was added and has zero consumers (Agent C, DIRECT). |
| 1.32 | Confidence interval only on the equivalence rung, null on trajectory | **V** | `race-projection.ts:120-152`; no live phone surface renders a CI (Agent C, DIRECT). |
| 1.33 | `fitPersonalExponent` kept for two real dependents | **V** | Paused web Targets route + doctrine claim (Agent C, DIRECT). |
| 1.34 | Santa Monica coach-set B 44:02 → 45:10 | **V** | 45:10 today (Agent C, DIRECT). But the same screen's "Projected" is **43:38**, faster than coach-set A 44:15 (§9). |
| 1.35 | Two agents pushed with `--no-verify` | **V** | Disclosed in `bf3d66dd` and the round-2 policy; `verify-commit.sh` exists and was falsified (DIRECT). |

#### Handback round 2 (`handback-round2-2026-09-01.md`)

| # | Claim | Status | Evidence |
|---|---|---|---|
| 2.1 | Reader split landed (`7445f117`): `actual_load_absorption` / `representative_execution`, live path untouched | **V** | `load.ts:494-502` unfiltered; split outputs unwired (DIRECT). |
| 2.2 | Replay: 1 of 7 dates flipped (08-20); no Rule 9 discontinuity at boundaries | **NV** (report evidence) | Not re-run. |
| 2.3 | `adaptive-ramp.ts` does not consume `classifyAdaptation`; `progression-pass.ts` is the live consumer | **V** | `adapt.ts:110` imports progression-pass; `readAdaptation` header names it (DIRECT). |
| 2.4 | PACE target grouped by authored phase, not blended | **V** | `load-adaptation-engine.ts:342-364` `GROUP BY ph.id` (DIRECT). |
| 2.5 | TAPER "clamped to its own doctrinal ceiling" | **C** | The ceiling is the generic one-VDOT quantum priced at the phase's own pace; TAPER gets the **largest** step (9 s/mi) on rows 78 days out. Engine comment says TAPER "by design" reports `moved:false`; on the real account it moved (Agent B, DIRECT). |
| 2.6 | Zero mutation proven by RO fence + checksum; determinism 3 runs byte-identical | **V** | Only write in the path is the shadow-log INSERT; checksums equal on all rows (DIRECT). |
| 2.7 | Persistence blocked on DDL, drafted as migration 160 | **S** | Applied (round 3); table exists (DIRECT). |
| 2.8 | `generate.ts` calls the legacy cascade at "32 call expressions across 19 lines" | **C** | Neither count reproduces under any method; 26/22 or 38/34 (Agent A, DIRECT). The figure is also repeated in `authoring-convergence.ts:13`. |
| 2.9 | Contamination window "under 24 hours worst-case" | **C** | Indefinite for any runner without a measured VDOT (GUARD 2); demonstrated at 24 days (Agent A, DIRECT). |
| 2.10 | Live card HR `160-167 (Z4 Threshold)` is "a static display-only zone with zero downstream consumers" | **C** | The string is display-only; the Friel table behind it is the **enforcement band** in `pace-hr-compatibility.ts:234-238` and the bucketing table in `hr-zone-bucket.ts` (Agents B+D, DIRECT). |
| 2.11 | Pace/HR validator: four clauses, pure, zero live callers | **V** on callers · **PV** on clauses | Five verdicts, not four; `INSUFFICIENT_HR_EVIDENCE` permits (fail-open); never reads `proposedSecPerMi` (Agent B, DIRECT). |
| 2.12 | `verify-commit.sh` falsified per Rule 18 | **V** | Re-run on `7cac80f0`: CLEAN in 108 s (DIRECT). |
| 2.13 | GitHub Actions red for 10 consecutive runs | **V** historically · resolved | Green at `43e15e88` (DIRECT). |
| 2.14 | `ownedDaysSql` reign fix; 7 accounts / 674 plan-days / 97 dates corrected | **V** code · **NV** numbers | `e76ff593` on main; sweep not re-run. |
| 2.15 | Readiness table: 2 of 6 requirements met | **V** as of round 2 | Superseded by round 3 (below). |

#### Handback round 3 (`handback-round3-2026-09-01.md`)

| # | Claim | Status | Evidence |
|---|---|---|---|
| 3.1 | CI green at `6a751e93`, watched | **V** | Run 33454240414 success; green through `43e15e88` (DIRECT). |
| 3.2 | Migration 160 applied; retention (180 d / 400 rows) added; RO role cannot INSERT | **V** | Table present with the described columns and check constraints; RO INSERT fails with permission denied (observed inside the full suite) (DIRECT). Retention cron **has never recorded a completion** (`ops_alerts` empty for that source) (DIRECT). |
| 3.3 | Production shadow rows carry every audit-required field | **V** | Schema inspected; owner rows populated (DIRECT). |
| 3.4 | Convergence guard: four states; owner `REANCHORED_CANONICALLY` | **V** · **gap** | Correct (DIRECT). No state for "cannot converge — no measured VDOT", which is 6 of 7 live plans (Agent A). Contamination emits a contradiction but never changes `final_decision` (Agent B). |
| 3.5 | Migration branch: 22 real legacy-VDOT call expressions across 9 functions | **PV** | 22 is a **line** count; 26 expressions. The name set omits the goal→pace calls (`tPaceFromGoal`, `blendedTPaceForWeek`, `maxSeasonalVdotGain`) (Agent A, DIRECT). |
| 3.6 | Largest divergence 23 s/mi on two hill-repeat days (cruise-interval approximation); zero structural diffs | **C** | Largest today is +21 s/mi on **marathon-pace** days (flat `T+18` vs the runner's exponent); the 11 long runs at +16 s/mi carry 2,765 of 3,011 s·mi and are omitted from every summary; "zero structural diffs" is guaranteed by construction because both legs share `composed.weeks` (Agent A, DIRECT). |
| 3.7 | Cold-start accounts diverge ~35% (7:4x vs 10:42) from a missing onboarding-mileage rung | **V** · **incomplete** | Reproduced. A second missing input, the self-reported PR in `profile.race_history`, accounts for a residual 101 s/mi the cold-start fix does not touch (Agent A, DIRECT). |
| 3.8 | 11 new pure tests + 2 real-account audit tests; falsified | **V** | 11/11 + 2/2 pass (DIRECT). |
| 3.9 | PACE replay corpus: 13 fixtures, 18 tests, real engine | **V** | In the full suite, passing (DIRECT). |
| 3.10 | Multi-day stability: determinism proven, elapsed-day evidence accumulating | **V** | Two calendar days in production (08-31, 09-01). The git-tracked JSONL's 36 lines are **one day re-run 36 times by test processes**; the RO-role file fallback appends to a tracked file (Agent B, DIRECT, reproduced). |
| 3.11 | Absorption dual log across 90 dates; filtered reading never more permissive on real history | **PV** | Landed (`fd13f09b`). MASKING-1 fires only on total washout; a window with one good unprescribed session and three failed prescribed ones is strictly more permissive under filtering (Agent B, CODE-PATH). Not live. |
| 3.12 | HR compatibility "wired into the real production pipeline"; `REFUSED_HR_INCOMPATIBLE` refuses | **PV** | Wired into the **log record** only. `adaptation-engine.ts` never imports the validator; the engine's proposal set still says PROGRESS (Agent B, DIRECT). |
| 3.13 | Four HR quantities named; phone live-run `.reference` mode cannot alarm | **V** for `.reference` · **C** on the count | `.reference` returns `outOfRange=false` unconditionally (DIRECT). There are **eleven** distinct HR numbers at LTHR 168, four live at once on one threshold session (Agent D, DIRECT). "Mechanism 4 has no consumer" is false: `drift-monitor.ts:695` gates a VDOT refit on it. |
| 3.14 | Wrong-plan downstream audit; capacity-resolver 07-23 misclassification | **NV** | Not re-run. |
| 3.15 | 77 unsealed rows canonical; no corrections needed | **V** for training rows · **C** for the race row | Future training rows carry 151/168 anchors (DIRECT). `race` is in `RECOMPUTE_EXEMPT_TYPES`, so the CIM row still carries its authored 431–441 band while every MP rehearsal was moved to 475 (Agent E, DIRECT). §5. |
| 3.16 | Readiness table: phase-aware done, HR validator done, convergence guard done, rollback/audit done | **PV** | Each artifact exists. "Done" overstates two of them: the validator does not block in the engine, and the audit trail records a deferred proposal as PROGRESS. |

#### Authority-policy brief (`adaptation-authority-policy-brief-2026-09-01.md`)

| # | Claim | Status | Evidence |
|---|---|---|---|
| 4.1 | Capacity beliefs are direct evidence, adversarially verified | **V** | Resolvers goal-sealed at compile time (falsified by adding a goal param → `tsc` error) (Agent C, DIRECT). |
| 4.2 | Live plan-flex runs nightly through canonical resolvers; zero staleness on audit | **PV** | True for the owner. Six of seven live plans have never been reanchored (Agent A, DIRECT). |
| 4.3 | PACE lever: phase-aware, validator wired, convergence guard, shadow log with checksum, bounded fixture corpus, all falsified | **PV** | See 2.4, 3.12, 3.4, 2.6, 3.9. |
| 4.4 | Two evidence-layer bugs fixed (MASKING-1, reason honesty) | **V** | `fe448a71`, `2352f3e2` on main (DIRECT); MASKING-1's scope is narrower than its rationale (3.11). |
| 4.5 | Only one account has real training history | **V** | Six zero-run QA fixtures + owner (DIRECT). |
| 4.6 | Real multi-day stability cannot be closed tonight | **V** | Stability tool: `NOT_YET_ENOUGH_DATA`, 2 of 7 days (DIRECT). |

---

### 3 · Current ownership table

Intended owner per `docs/BRAIN_CONSTITUTION.md` §29. "Enforced" means a type or test makes the boundary fail, not a comment.

| Question | Intended owner | Actual live owner | Fallback | Shadow / duplicate paths | Live consumers | Source mode · confidence (owner, 09-01) | Enforced? | Report staleness |
|---|---|---|---|---|---|---|---|---|
| Activity interpretation | Activity Interpreter | `lib/evidence/activity-evidence.ts` via `classifyRecentActivities` | none | Watch-side phase verdicts (`WorkoutEngine.swift:1715-1729`) grade execution independently; `lib/execution/interpret.ts` maps `actual == null` → MISSED | `capacity-resolver.ts`, `load-adaptation-engine.ts`, `pace-hr-evidence.ts`, doctrine registry | per-activity | Partially (audit test against prod, 2 failures today) | Handbacks say nothing about it being the sole classifier; watch and `interpret.ts` are second answers |
| Evidence classification | Evidence Engine | same file (two-stage eligibility/weight) + `lib/evidence/reexamination.ts` | none | `drift-monitor.ts` reads `hr_target_bpm` to decide "fitness lead vs execution" — a second grading of the same run | capacity-resolver, adaptation loader | — | No tree-wide gate | — |
| Threshold capacity | Runner Model | `resolveThresholdCapacity` (`capacity-resolver.ts:1072`) | VDOT rung 4 → population prior | **`resolveCurrentTPace` computed three times in `generate.ts` (8952, 13298, 14154)** on the legacy cascade at authoring | recompute-paces, reanchor-plan, spec-builder (via anchors), coaching-thesis (unwired), adaptation loader | direct · 0.79 (420 s/mi) today; 0.727 (430) yesterday | Goal-sealed by type (`CapacityResolversAreGoalFree`), falsified | H1 §1 "one owner": true for the flex path only |
| High-intensity capacity | Runner Model | `resolveHighIntensityCapacity` | VDOT fallback (no direct reader) | `iPaceFromVdot(vdotFromTpace(t))` at `generate.ts:9159/10642` | same | vdot_fallback · 0.29 → 0.50 | type-sealed | — |
| Easy ceiling | Pace Prescription (from Runner Model) | `resolveEasyCeiling` → `resolveCapacityPrescription` | inherits threshold's mode | legacy `T+100` midpoint at authoring; `aerobicCapBpm`/`hrCapEasy`/`resolveHrCeiling` five derivations for the HR twin (§10) | recompute, watch builder, today route | direct · 0.63 (502) | anchor-set coherence gate (refuses, never clamps) | — |
| Durability | Runner Model | `resolveDurability` + `resolveRaceExponent` (`durability-anchor.ts`) | population 1.06 | **`lib/coach/limiter.ts:433` unshrunk 56-day fit (live, goal-gap advice)**; `coach-goal.ts fitPersonalExponent` (paused web only) | goal-projection (blend w=0.62), coach-goal, prescription-resolver MP | direct · 0.62 (exp 1.0869, raw 1.1011) | None for the limiter duplicate | H1 §10 "one canonical source" is false while `limiter.ts` lives |
| Readiness / current state | Readiness | **Two owners.** Canonical `runner-state.ts` (reporting-only: `ACWR_IS_REPORTED_NEVER_DRIVING`) consumed only by the shadow adaptation loader. **Live** readiness is `adapt.ts detectReadinessPullback` (`readiness_pullback`, since 2026-06-01) | — | `resolveCapacityPrescription` omits `state` by type; no live prescription ever sees readiness | adapt.ts (live), shadow engine | — | Type excludes state from live prescription; nothing reconciles the two readiness owners | Constitution §D "built as runner-state.ts" reads as if live; it is not |
| Coaching Thesis | Coaching Thesis | **Nobody.** `resolveCoachingThesis` exists (`coaching-thesis.ts:420` lines) and has **zero live callers** | — | Per-family static "why" strings (`why-voice.ts`) are what the runner actually reads | none | HIGH_INTENSITY · 0.291 raw / 0.583 normalized (test render) | none | **H1 §1 "live" is contradicted** |
| Workout identity selection | Plan Generator ← Workout Library | `lib/workout-catalogue/select.ts selectWorkout` inside `composePlan` | — | Rep count is a descending fit loop, not a ladder (`select.ts:788-791`, a `>` on a continuous budget = Rule 9 cliff) | plan authoring | LRU rotation | `_maint_invariants`, `_sweep_allusers` (no history fields, Rule 15) | Rationale computed at authoring; 0/103 live rows persist it |
| Workout parameterization | Pace Prescription + Plan Generator | `spec-builder.ts buildWorkoutSpec` (structure, HR fields, WU/CD split, `restS/540`) | — | Authoring leg prices from the cascade, recompute leg from anchors, both through the same builder | recompute, authoring, watch | — | dosing caps enforced; WU/CD residual split unguarded | — |
| Initial plan pace authoring | Pace Prescription | **Legacy VDOT cascade in `generate.ts`**, including a goal→pace blend on rebuild (`BLEND_GRACE_FRACTION 0.15`) and `tPaceSec = min(goalT, currentT)` at `:14160` | — | Migration branch: shadow compare only, unmerged | every new plan, every rebuild | vdot scalar (46.3 season anchor) | **No gate for goal→pace leakage** (`check-goal-immutability` watches mutation, not leakage) | H1 §4 correct that the gap exists; understated that the goal still reaches a pace |
| Plan recomputation / reanchoring | Pace Prescription | `recomputePacesForPlan` (via adapt) and `reanchorActivePlan` (via `snapshot-projections` cron, GUARD 2: measured VDOT required) | none by design (refuses) | `race` and `race_week_tuneup` rows exempt → race row frozen at authoring | nightly cron | canonical anchors | `check-automatic-mutations.sh`, anchor-derivation gate | "converges in <24 h" contradicted for unevidenced runners |
| Adaptation proposal | Adaptation Engine | **Two owners.** Live: `adapt.ts detectAdaptations` + `progression-pass.ts` (TAKE/ACCELERATE/HOLD/BACK_OFF) + `adaptive-ramp.ts tryAdaptiveBump`. Shadow: `composeAdaptation` (`adaptation-engine.ts`) | — | Shadow log records `agrees_with_live = false` on every row | live: run-adaptations cron; shadow: same cron, log only | shadow PACE PROGRESS (deferred) 435→430 · 0.689 | contradiction checker inside the shadow engine only; nothing compares the two owners | H1/H3 correctly say shadow-only; the live owner's 48 downward / 0 upward record stands |
| Live plan mutation | Adaptation Engine → Plan Generator | `applyAdaptations` (`adapt.ts`), `tryAdaptiveBump`, `recomputePacesForPlan`, `reanchorActivePlan`, `plan-drift` HR stamps, plus 12 route/lib writers of `plan_workouts` (§11) | — | canary branch adds a 13th writer, off | — | — | `automatic-mutation-registry.ts` enumerates cron/ingest writers | — |
| Race projection | Race Prediction | `resolveRaceProjection` (`race-projection.ts`) | equivalence rungs | `effective-race-target.ts` (watch/execution) reads raw snapshots; `simulator.ts` A/B/C; `goal-assessment.ts currentEquivalentSec`; `GoalProjection.projectionSec` returns the goal when on-track | races list/detail, goal-gap, goal-outlook, retrospective, snapshot push | trajectory 3:24:12 / equivalence 3:21:33 / blended 3:27:51 | `_race_projection.test.ts` covers **two files** | "all consumers route through it" is partial |
| Goal feasibility | Goal Feasibility | `goal-assessment.ts assessGoal` + `achievable-target.ts` (prescription floor) | — | none found | plan authoring (race target), morning brief | out-of-reach / floor 3:02:40 | Rule 9 cliff fixed (`max(goal, floor)`), verified live | — |
| HR prescription and safety | Safety + Pace Prescription | `spec-builder.ts` (`hr_cap_bpm`, `hr_target_bpm`, `lthr_bpm`, pass/bail/abort rules), `build-workout.ts` (`hrCeilingBpm`, `workHrTargetBpm`), `hrTargets()` strings | — | **Five aerobic-ceiling derivations, four threshold-band tops (164/167/168/171.4), three LTHR↔HRmax crosswalks** (§10) | phone, watch, recap, drift-monitor, shadow validator | LTHR 168 (stamped with method+date; the only Rule-10-compliant anchor) | none tree-wide | round-3 "four mechanisms" undercounts |
| Phone / Watch / spoken / grading presentation | UI | `/api/v5/today` (`v5-today.ts`, `spec-card.ts`), `lib/watch/build-workout.ts` (phases, cues, rules), watch `WorkoutEngine.swift` (verdicts, bail), `run-recap.ts` (post-run) | — | Watch grades ±8 instantaneous; recap grades the whole-run HR average; the bail is HR-worded and pace-triggered | runner | — | `check-wire-keys.sh`; no consistency gate across the four | H1 §5 "same code path" true for structure only |

**Dual authority still live, named plainly:** (1) pace prescription — legacy cascade at authoring vs canonical anchors on the flex path, with the goal reaching an authored pace on rebuild; (2) adaptation — `adapt.ts`/`progression-pass.ts` live vs `adaptation-engine.ts` shadow, disagreeing on every logged cycle; (3) readiness — `readiness_pullback` live vs `runner-state.ts` shadow; (4) durability exponent — canonical vs `limiter.ts`; (5) race projection — canonical vs snapshot-clamp (watch) vs simulator (morning brief); (6) HR — eleven numbers, four live on one session. **Unwired, not dual:** Coaching Thesis (zero consumers), `selection_rationale` (0/103 live rows), DENSITY lever (6 rows app-wide), race abort rules (shipped, never evaluated), `pass` rules (authored on 19 rows, read by one function).

---

### 4 · Real-run evidence traces

Eight canonical rows from the owner's history were traced end to end by calling the real resolvers against read-only production (`resolveThresholdCapacity`, `resolveEasyCeiling`, `resolveHighIntensityCapacity`, `resolveDurability`, `resolveCoachingThesis`, `resolveThresholdPaceCorpus`, `classifyStoredActivity`, `classifyRecentActivities`, `accumulateReexamination`, `fitRaceExponent`, `aggregateDecoupling`, `loadKeySessionExecutions`). Every reported number in the handbacks reproduced to the digit at `todayISO = 2026-08-31`: threshold 430 s/mi conf 0.7268 direct; easy ceiling 491.7 s/mi conf 0.6345; high-intensity I 407 / R 371 conf 0.2914 `vdot_fallback`; durability exponent 1.08691, race component conf 0.6210, overall 0.900; thesis primary limiter HIGH_INTENSITY normalized 0.5829. **At `2026-09-01`, after the owner's morning session, threshold is 420 s/mi conf 0.7884, high-intensity conf 0.500, and the thesis primary limiter has flipped to THRESHOLD.**

| Run | Raw | Interpreted (Activity Interpreter) | Context | Evidence admitted | Belief effect | Downstream | Sensible? |
|---|---|---|---|---|---|---|---|
| **A · 2026-09-01 4×1 mi threshold** (`-258355938987883`) | 8.50 mi, 8:03 whole-run, avg HR 154 / max 172, 69°F, 9 watch phases: reps 422/429/422/419 s/mi, rep HR 158/161/164/166, recoveries 61/64/64 s | 3 segments off mile splits: recovery, `threshold_like` (mi 3-6, conf 0.94), steady. `observedExecution MIXED`, `executionQuality controlled`. Threshold evidence weight **0.55 < ANCHOR_MOVE_MIN_WEIGHT 0.60 → anchorMoveCandidate: false** | dewpoint estimated, load moderate, not in a prescribed window | Pace corpus pools the 4 work phases into ONE observation: 1700 s / 4.03 mi = **421.84 s/mi**, pooled HR 162.2 = 0.966 LTHR, in the T band | **Threshold 430 → 420 (−2.3%, VDOT +1.3) in one day.** ~9 s/mi from this session displacing 2026-07-07 as third-fastest in a K-th-best order statistic; ~1 s/mi from the tension relaxation (below). Thesis limiter flips HI → THRESHOLD because the HI fallback anchor is now 0 days old | Watch graded the reps **drifted, drifted, drifted, missed** (±8 s/mi instantaneous) and the cool-down "missed" (534 vs a 502 *ceiling*). Recap: "Tempo done · 4 mi @ 7:03 · avg HR 154", no tip (this audit ran `deriveRecap`) | **Direction earned, magnitude unbounded.** The Evidence Engine's own hero-workout guard said "supporting evidence only"; the corpus that owns the anchor never consults it. The runner was told he missed a session he negative-split. |
| **B · 2026-07-16 "intervals"** (`-280549580846348`) | 5.73 mi, avg HR 139 / max 166, 9 phases | All four capacities `no_evidence`: `NO_HIGH_INTENSITY_WORK_PERFORMED`, `PACE_AND_HR_EXIST_BUT_DEMONSTRATE_NOTHING` | — | Pace corpus admits it as the **fastest threshold observation in the corpus**: 408.33 s/mi at `hrPct 0.9126` — more than two band-widths below `THRESHOLD_PCT_LTHR_BAND [0.95,1.02]`, and equal to the runner's resolved I-pace (407) | It is the k=1 entry in every resolution and is why k=2 (420) beats k=3 (421) | — | **No.** The Interpreter says this run demonstrated nothing; the Runner Model calls it his best threshold evidence. `thresholdSegmentFromPhases` computes `hrPct`/`hrBandDistance` and never gates on them; `classifyEasyCandidates` does. |
| **C · 2026-08-31 easy** (`-41598809443969`) | 6.18 mi, 8:21, avg HR 147, 76°F, 7 splits (re-ingested from Apple Watch at 22:11 UTC during this audit) | `EASY_TO_AEROBIC_STEADY`, one `easy_aerobic` segment 498 s/mi, HR 145.7, relativeIntensity 1.009; internal cost ok, rise 3.85% | — | Durability evidence at weight **0.22** (`DURATION_BELOW_PROTOCOL`, `ENVIRONMENTALLY_AFFECTED`, `ACTIVITY_INTERRUPTED`); no threshold/HI/easy-ceiling evidence | Easy ceiling unchanged 491.69 both days (slower than the ceiling cannot move a K-th-fastest statistic) | The two suite failures: `_activity_evidence.audit.test.ts` pinned this row's pre-re-ingest state (`splits_unreliable: true`, `EASY`) as fact | **Yes.** Benign fixture staleness (every diff is a refusal lifted by better data; all four resolvers byte-identical before/after the re-ingest). Rule 18 finding against the test, not the engine. |
| **D · 2026-08-30 long** (`-245190372869167`) | 13.49 mi, 7:53, avg HR **159** / max 179, 13 splits, plan LONG 13 mi @ 535 | 5 segments: easy, **threshold_like (mi 4-5)**, recovery, **threshold_like (mi 7-10)**, steady. 44.4 min of quality, no late collapse, residual HR +19 bpm. Threshold evidence 0.55; durability 0.55 `REPEATED_QUALITY_BLOCKS_WITHIN_ONE_ACTIVITY` | load high, hrConfoundWeight 0.40; inside the AFC recovery window (day 14) | **Pace corpus: excluded outright** — `labelExcludesThreshold('long')`. Durability: decoupling observation #9 (drift 10.1%, 103 min) moved the aggregate 5.95 → 6.41 %/hr and confidence 0.807 → 0.933 (falsified by re-running without it) | Zero threshold evidence from 44 min of threshold-like work because the plan called the day "long" | Recap: "ran harder than an aerobic long day" against a `hr_cap 145` frozen at LTHR 162 (live ceiling 151) | **Split.** Durability read is right and the value/confidence direction is doctrine-correct. Threshold exclusion by plan label is Constitution §11 inverted. |
| **E · 2026-08-24 recovery-window easy** (`-220066891328078`) | 4.02 mi, avg HR 139, **87.9°F**, day 8 after AFC | `EASY`, one recovery segment, pace stability high, environment load high (confound 0.56); all capacities `no_evidence`/`indeterminate`; **empty ledger** | prescribed post-race window | none | none; easy corpus excludes it via `excludePrescribedDays` | — | **Yes.** No negative finding of any kind. Rule 8 held at the Evidence Engine and easy-corpus layers. |
| **F · 2026-08-16 AFC half, 1:41:53** (`-161412146640788`) | 13.20 mi, 466 s/mi, avg HR **168** / max 178, 69°F, 83% humidity, priority A | **Two intent readers disagree:** `classifyStoredActivity` (active plan only) → `plannedIntent null`; `classifyRecentActivities` (`ownedDaysSql`) → `RACE`. With RACE: `beliefTension CONTRADICTS_CURRENT_ESTIMATE`, direction `observation_weaker_than_belief`, 467 vs believed 421 (−10.9%), weight 0.925 | fresh, race | Threshold evidence 0.55 `ENVIRONMENTALLY_AFFECTED`; durability none; **race exponent**: with AFC 1.08691 conf 0.621; without 1.09710 conf 0.531; AFC 10 min faster 1.11538 | One race moved the exponent **0.94%** (shrinkage toward 1.06 doing real work). But the tension observation is what relaxed the corroboration bar the next day (below) | `hr_cap_bpm 168` on the race row = his race-day average; graded amber one beat above | **Yes for the exponent; no for what the tension did with it.** Only 2 distinct distances across 5 races: the long arm rests on LA Marathon alone. |
| **G · 2026-08-28 heat easy** (`-255291701482225`) | 6.32 of 7 mi, avg HR 154, **96.9°F** | environment load **extreme**, confound 0.90, slowdown 13.5%; `AEROBIC_STEADY` diverged from EASY; zero segments; all capacities `no_evidence`; empty ledger | extreme heat | none | none | Recap: "Your HR (154) ran past the 145 target" — 145 is the pre-re-anchor cap frozen on a sealed row; run detail shows 151 for the same run | **Yes at the engine** (a 97°F run demonstrates nothing and is not held against him). **No at the recap** (two ceilings for one run on one phone). Heat never writes into any capacity: grep of capacity-resolver, pace-corpus, durability-anchor for temp/heat/dewpoint → zero hits; durability *excludes* hot runs rather than adjusting them. |
| **H · 2026-08-04 / 08-06 abandoned treadmill tempos** (`-196897009959912`, `-226755616416002`) | 08-06: work phase `completed: FALSE`, 2.86 of 4.0 mi, 1200 s, 419 s/mi, **no HR on the work phase**; 08-04: identical shape, 2.77 mi, **1161 s** | `plannedIntent null` (active-plan reader) vs `THRESHOLD` (reign reader — **the `e76ff593` fix verified working on exactly these dates**). Interpreter: zero segments, `observedExecution RECOVERY`, threshold `no_evidence` / `PACE_AND_HR_EXIST_BUT_DEMONSTRATE_NOTHING`, empty ledger | inside AFC taper; treadmill | **Pace corpus admits 08-06** at 419.58 s/mi, `hrBasis null` — it is **one of the two evidence ids behind the live 420 s/mi belief**. 08-04 is invisible because `THRESHOLD_MIN_SESSION_TOTAL_SEC = 1200` and its work phase is 1161 s | An abandoned, HR-less, taper-week treadmill session is half the runner's current threshold belief and makes him look faster than the sessions he finished | The under-execution findings in the adaptation reader for these dates are real (taper had not yet reduced these tempos), as round 2 §E concluded | **No, on both counts.** `thresholdSegmentFromPhases` filters `p.type === 'work'` and never reads `p.completed`; a 39-second difference decides whether a session is half the model or does not exist (Rule 9). |

#### The headline defect the traces surface: two "you are slower than we thought" observations made the engine believe he is faster

`resolveThresholdCapacity` runs two passes. Pass 1 resolves the corpus at `CORROBORATION_MIN_OBSERVATIONS = 3` and returns the **third-fastest** observation (`sorted[minObservations - 1]`, VDOT descending). Pass 2 collects belief-tension observations over 28 days and `accumulateReexamination` may lower the floor to 2. At `2026-09-01` the window holds exactly two tension observations, **both `observation_weaker_than_belief`** (AFC −10.9%, weight 0.925; the 09-01 session read at the Interpreter's diluted mile-split pace 444 vs 421, weight 0.853). Direction is computed, labelled `weaker`, and **never branched on** — only `conflicting` blocks relaxation. Falsified: identical inputs with `stronger`, `weaker`, and `weaker at weight 0.01` all return `effectiveMinObservations 2`. Lowering k in a descending sort can only move the answer **faster**: k=3 → 421, k=2 → 420, confidence 0.727 → 0.788. On 2026-08-31 the same mechanism was blocked (`conflicting`) because the pass-1 belief was 430 and 08-30 read `stronger`; a 9 s/mi change in the pass-1 belief flipped it from blocked to fired. The reference-case document `docs/reference-cases/todays-run-full-trace-2026-09-01.md` §3 is wrong on this point: it hand-supplied a 430 belief and reported `stronger`; against the resolver's own 421 the direction is `weaker` and the observation the relaxation drops is **today's own run**.

#### Checks requested by the brief

| Check | Result |
|---|---|
| Activity labels overriding observed physiology | **Yes, the plan's label.** `labelExcludesThreshold` / `labelExcludesEasy` in `pace-corpus.ts` gate admission on `workoutType` (source `plan`) before any physiology is read. 08-30's 44 min of threshold-like work contributes nothing (label `long`); the unlabelled 08-23 run is admissible. Strava/HealthKit names are not read anywhere: that half is clean. |
| Bad split ownership / wrong-plan attribution | **Reign fix verified** on 08-04/08-06 via `loadKeySessionExecutions` and `classifyRecentActivities`. **But `classifyStoredActivity` still reads the active plan only** (`archived_iso IS NULL … ORDER BY pw.id ASC LIMIT 1`), so it returns `plannedIntent null` for AFC while the batch reader returns `RACE` — which switches the tension weaker-arm on and off. Two answers to one question. |
| Whole-run averages obscuring structure | **Swapped strengths.** The pace corpus reads watch phases (421.8 s/mi on run A); the Activity Interpreter reads mile splits (444 s/mi). The tension mechanism compares the Interpreter's diluted number against a belief built from the corpus's undiluted one. |
| Taper/recovery treated as failure | **No** at the Evidence Engine and easy corpus. **Consistency dimension (weight 0.20) is unfiltered in both halves of the adaptation split**: AFC race week and recovery week count as plan misses in the reader that exists to exclude them. |
| Environment altering capacity | **No.** Verified by grep and by the durability reader's explicit heat exclusion. The gap is the other way: the pace corpus has no environmental awareness at all (safe for a K-th-fastest statistic, but `hrConfoundWeight` flows into `pressure` and nothing reads it). |
| One run rewriting the runner | **Exponent: no** (0.94% from an A-race, shrinkage working). **Threshold: yes, 2.3% in one day**, with the hero-workout guard computed by a module the anchor owner never consults. |
| Stale evidence | **Decay-confidence-not-value, verified numerically**: easy ceiling value bit-identical across days, confidence 0.63449 → 0.63365; half-life 28 d (capacity), 84 d (durability), 120 d (exponent coherence). No finding. |
| Missing evidence becoming a negative finding | **Yes, half the time, decided by the calendar.** HIGH_INTENSITY normalizes against its 0.50 fallback ceiling, so its ranking score is `0.4 + 0.6·2^(−anchorAgeDays/28)` — a function of the VDOT anchor's age, not of any high-intensity ability. It is the limiter whenever the last VDOT-qualifying run is older than ~10 days and never when it is younger. Observed flipping overnight with no HI session run. |
| Readiness → capacity | **No.** 93 readiness snapshots exist (HRV, RHR, ACWR, sleep, HR recovery, RPE); zero readiness imports in any capacity file and vice versa. Clean. |

---

### 5 · Active-plan coaching review

Plan `pln_9a57561debb776e5`, authored 2026-08-31 03:40 UTC, 15 weeks (idx 0–14), phases QUALITY wk0–7 · RACE-SPECIFIC wk8–11 · TAPER wk12–14, no BASE phase (`is_mid_block: true`). Anchors after the 2026-08-31 21:48 recompute: repetition 371 · interval 407 · threshold 430 · marathon 475 · easy ceiling 502 · shakeout ceiling 532. Ramp base `sustainedMi 45` (Rule 8 filtered; his unfiltered 4-week mean is 31.6), `peakMi 52.3`, `recentLongMi 18` (filtered) vs `spikeAnchorLongMi 13.5` (unfiltered, injury guard) — **Rule 8 correctly applied and correctly split.**

| wk | start | phase | mi | long | quality | easy days | note |
|---|---|---|---|---|---|---|---|
| 0 | 08-24 | QUALITY | 38.0* | 13.0 | 0 | 4, 7, 7, 7 | clipped historical week (two dates dropped by the backdate guard) |
| 1 | 08-31 | QUALITY | 45.0 | 15.0 | 2 | 4.5, 5.0, 5.5 | 4×1 mi Tue · hills Thu |
| 2 | 09-07 | QUALITY | 28.9 | 6.2 (race) | 2 | 4.5, 5, 5, 2 | cutback · Santa Monica 10K |
| 3 | 09-14 | QUALITY | 34.0 | 12.0 | 1 | 5, 5, 5 | post-race |
| 4 | 09-21 | QUALITY | 48.7 | 15.5 | 2 | 4.5, 6.5, 7 | Dodgers 10K Sat → 15.5 mi long Sun |
| 5 | 09-28 | QUALITY | 56.0 | 19.0 | 2 | 4.5, 6.5, 7 | 19-miler already adjudicated and held by the owner |
| 6 | 10-05 | QUALITY | **61.0** | 20.0 | 2 | 4.5, 12, 7.5 | peak; 20 mi with 3.5+2 @ M |
| 7 | 10-12 | QUALITY | 45.5 | 15.0 | 2 | 4.5, 5, 5.5 | cutback |
| 8 | 10-19 | RACE-SPEC | 60.0 | 19.5 | 1 | 5, 12, 7.5, 7.5 | 11 mi @ M inside the long |
| 9 | 10-26 | RACE-SPEC | **61.0** | 21.5 | 2 | 4.5, 9, 7.5 | peak long |
| 10 | 11-02 | RACE-SPEC | 45.6 | 13.1 (race) | 2 | 5, 10, 7.5, 2 | cutback · Run Malibu HM |
| 11 | 11-09 | RACE-SPEC | 44.0 | 16.0 | 1 | 4.5, 5, 5, 5 | dress rehearsal 4 mi @ M |
| 12 | 11-16 | TAPER | 48.0 | 19.0 | 1 | 3.5 ×4 | 11 mi @ MP Tue |
| 13 | 11-23 | TAPER | 36.0 | 14.0 | 1 | 3.0 ×4 | 7 mi @ MP Tue |
| 14 | 11-30 | TAPER | 43.7 | 26.22 (CIM) | 2 | 4, 4, 3, 2 | race week |

Taper measured against the live doctrine (`TAPER_DESCENT_SHAPE`, marathon race week 45% of peak — **not** the superseded 70/55/40): 78.7% / 59.0% / 28.7% (race week excl. the race) vs 82 / 60 / 45 — the shape is correct.

#### Verdicts

| Phase | Verdict | Why |
|---|---|---|
| QUALITY (wk 0–7) | **TRUSTWORTHY WITH CAVEATS** | Volume ramp honest against his filtered normal; cutback cadence right; easy days now varied (4.5/5/5.5, a 12-mile medium-long in wk 6). Caveats: wk3→wk4 is +43% off a post-race week (`weeklyVolWoWMaxPct` is guarded as *removed*, so nothing checks it); wk4→5 and wk5→6 add volume **and** intensity in the same week; race Saturday 09-26 then 15.5 mi Sunday 09-27 (21.7 mi in 24 h, 48-hour spacing rule); build-week easy days (4.5–5.5 mi ≈ 39–47 min) sit below his own 6.0 mi median and below `Research/00a` §2's general-aerobic floor (Rule 12's `flooredPerEasy = min(effectiveFloor, perEasyBudgetCap)` still unfixed); 09-08 asks 4.2 mi of jogging around 2.0 mi of tempo (residual-mileage split, visible as decimals 2.1/2.6/1.9 rather than a coach's "2 mi"). |
| RACE-SPECIFIC (wk 8–11) | **NOT TRUSTWORTHY on pace** | Every marathon-pace prescription (10-11, 10-25, 11-15 dress rehearsal) is **475 s/mi (7:55)**. Race day is **436 s/mi (7:16)**. He rehearses a 3:27 marathon and is asked to race 3:10. **Root cause found:** `race` is in `RECOMPUTE_EXEMPT_TYPES` (`recompute-paces.ts:322`), so the 2026-08-31 recompute moved 77 training rows onto the canonical MP (durability exponent 1.087) and could not touch the CIM row, which still carries its authored 431–441 band. The file's own comment at `:391` says race rows are threaded "so that the day race rows come into scope they cannot come in anchored to something stale"; that day has not come. `shakeout` was removed from the same list 70 lines above for exactly this reason. The 2026-08-30 audit blessed this three-tier design at a 7:56 / 7:41 split; the gap has since more than doubled. Also: race-day `hr_cap_bpm 155` is unachievable at 431–441 on his own data (12.4 mi at 441 → avg HR 157; AFC at 463 → 168); six sessions are labelled one workout and priced as another (two "mile cutdowns" with one flat 430; `4×1km MP → 5K` at a flat 407; `5×400m @ 5K pace` at 425, slower than I-pace and equal to the Malibu HM target). |
| TAPER (wk 12–14) | **NOT TRUSTWORTHY on pace** | Shape correct; both MP rehearsals (11 mi and 7 mi @ 475) inherit the defect above. Week 12 at 48 mi with 11 @ MP Tuesday and a 19-mile Sunday is a legitimate Pfitzinger-style first taper week. Quality resumes on day 5 after Run Malibu (B half); `Research/00b` ×0.6–0.7 gives day 6–9.8, and the plan's own 11-12 note promises "quality resumes after the recovery window" the day before it does. |
| **Block overall** | **TRUSTWORTHY WITH CAVEATS on volume and structure · NOT TRUSTWORTHY on race-specific pace** | The block does not chase the 3:00 goal; `goal_realism.flag` is honest. It never once rehearses the pace it asks him to race. |

#### Progression, thesis, and the arithmetic days

- **Duration and density progress; pace cannot.** Threshold work-volume 4.0 → 6.0 mi by wk 9, long 15 → 21.5, medium-long introduced wk 6. Every T session across 15 weeks is 430, every I 407, every M 475 — doctrine-correct in itself, but **2026-09-01 and 2026-10-20 are byte-identical sessions** (4×1 mi, 8.5 mi, 430, WU/CD 2.1/2.1) because the rep count is a descending fit loop on a threshold budget (`select.ts:788-791`: `while (reps > min && reps * one > sizeToMi) reps--`), not a ladder — and a `>` on a continuous budget is a Rule 9 cliff (4.999 mi buys 4 reps, 5.000 buys 5). Weeks 6 and 9 are identical at 61.0, which exceeds `CYCLE_GROWTH_CEILING.advanced 1.15 × peakMi 52.3 = 60.1` by 0.9 mi — the 2026-08-30 audit found the then-block "just under" this doctrine-bound ceiling; the re-authored block is over it.
- **Coaching Thesis vs plan.** On 08-31 the thesis named HIGH_INTENSITY the primary limiter with priority `establish_high_intensity_evidence`, and `addressedBy` credited the only session that week: 09-03 `10×60s hills @ 5K-10K effort` with `pace_target = NULL` — structurally unable to produce pace evidence. The first paced I session is 2026-10-01 (week 5). `repetition 371` is resolved and never prescribed: zero R-pace sessions in 15 weeks. The thesis is not inert in the block (six I-pace sessions exist), but nothing consumes it (§3), so the plan and the thesis agree by coincidence.
- **Rule 17.** "Conversational. Z2 HR cap. Finish with 6 relaxed 20-second strides, full recovery between." ×17; the downhill instruction ×9 (Rule 17's own canonical example was 11), in a plan authored the day after Rule 17 locked. The scrub strips citations correctly at read time (verified on every live note), so the runner does not see `Research/11 §…`; they do see the sentence nine times.
- **`selection_rationale` is on 0 of 103 rows** — the fix (`RATIONALE-PERSIST-1`) landed one day after this plan was authored. "Why this session" has no production answer today.

#### Questionable workouts, and what a coach would do

| Date | Session | Problem | Coach's change |
|---|---|---|---|
| 11-17, 11-24, 11-15, 10-25 | 11 / 7 / 4 / 11 mi @ M · **475** | 39 s/mi slower than race day 436; 31.5 mi of "marathon pace" at a pace he will not race | Pick one race number and run every rehearsal at it. If 475 is the honest current-fitness pace (the exponent argues it is: LA 3:31:40 off a 1:34:54 half), race day should be near 475, not 436. |
| 12-06 | CIM · 431–441 · `hr_cap 155` · abort at avgHr > 163 | Cap unachievable at the band; two HR numbers on one race; race row frozen since authoring | One HR reference that matches the pace; unfreeze the race row |
| 09-27 | LONG 15.5 the day after a 10K | 21.7 mi / 24 h | Move to Monday or cut to ~12 |
| 09-08 | 2.1 WU · 2 mi @ T · 2.1 CD | 4.2 mi of jogging around 2 mi of work | 1.5 WU · 3 mi @ T · 1 CD |
| 09-22, 10-27 | "4 / 6 mi @ T" with cutdown prose | Two workouts in one row; a single flat pace and "each mile 10–15 s/mi faster" cannot both be graded | Per-rep paces or continuous tempo, not both |
| 11-03 | `4×1km · MP → 5K` at 407 | Label brackets neither end of its own range (475 → ~391) | Per-rep ladder |
| 12-01 | `5×400m @ 5K pace` at 425 | Slower than I-pace, equals the HM race target | ~391 |
| 11-13 | `2×1.5 mi @ T`, 2.6 WU + 2.6 CD | 5.2 mi jogging around 3.0 mi work | 1.5 + 1.5 |
| 09-03, 09-17 | Hills by effort, no pace | The only sessions credited with the HI thesis; cannot evidence it | Keep the hills; add one paced I session before week 5 |

**What is good and must not be broken:** Rule 8 applied and split; the backdate guard; sealed-row immutability (week-0 rows still carry the pre-re-anchor 145 cap, everything after carries 151 — the mechanism proven by data); the block does not chase the goal; cutback cadence and taper shape; easy-day variation improved since the 2026-08-30 audit.

---

### 6 · The 4×1-mile fixture

**Production row** `wko_eaa8cfd7cb94310b` (2026-09-01; `2026-10-20` is byte-identical): `threshold · 4×1 mi @ T pace · 1 min jog · 8.5 mi · pace_target 430 · workout_spec {lthr_bpm 168, rep_count 4, rep_distance_mi 1, rep_pace_s_per_mi 430, rep_rest_s 60, warmup_mi 2.1, cooldown_mi 2.1, rules: pass hr ≤ 164 · bail hr > 173 "finish easy, the stimulus is banked"}`. `lthr_bpm` is stamped in the spec beside its derivation (Rule 10 stamp posture, correctly applied). `selection_rationale`: absent.

#### Before / after provenance

| Field | Authored 2026-08-31 03:40 (legacy cascade) | After the 21:48 recompute (canonical anchors) | Today's card (`cardFromSpec`, DIRECT) |
|---|---|---|---|
| Rep pace | 7:19 (439, VDOT scalar + 4 s/mi goal-facing grace) | 430 (`resolveThresholdCapacity`, direct, 0.727) | **7:02–7:18** (430 ± 8) |
| WU/CD pace | 9:03 flat (legacy easy-band midpoint = old T + 100) | 502 ceiling (`resolveEasyCeiling`) | **≤ 8:22** ceiling (`fmtPaceCeiling`) |
| WU/CD HR | ≤139 | — | **`~< 142 bpm (Z1 Recovery)`** (Friel Z1 at LTHR 168; the reports' "<139" needs LTHR 164) |
| Rep HR | 164–172 (a hand conflation; never existed in code) | — | **`~160–167 bpm (Z4 Threshold)`** — display string, suppressed on any step that has a pace (`pace_target ?? hr_target ?? effort_target`), so on this card the runner never sees it |
| Recovery | 1:00 @ 9:03 | 1:00, no pace | **1:00 "Honest jog, not standing."** (by feel, `RECOVERY-BYFEEL-1`) |
| Cool-down copy | "Do not skip it, it shortens tomorrow." | — | "Easy jog. Part of the workout, not extra mileage." |
| WU/CD distance | 2.1 / 2.1 (residual weekly mileage halved; textbook for this session, decimals are the tell elsewhere) | same | same |

Sealed/completed rows are immutable in the recompute path by two gates: `pw.date_iso::date >= today` (past rows never selected) and the `sealed` EXISTS on a canonical run for the date (`NOT (r.data ? 'mergedIntoId')`, Rule 14 predicate). Proven by data: week-0 rows carry `hr_cap_bpm 145` (LTHR 162), everything from 08-31 carries 151 (LTHR 168). The rewrite preserves `progression` and `selection_rationale` via `preserveProgressionSql` (Rule 6 field-level guard).

#### Why this workout, why four

Catalogue `cruise-intervals` (`Research/04` §5.3): 3–6 × 1 mi, 60 s recovery, WU/CD 2–3 mi. The row sits inside every band. **There is no 3→4→5 ladder**: `reps = max; while (reps > min && reps * one > sizeToMi) reps--`, so four reps means the week's threshold budget landed in [4, 5) mi; which catalogue entry wins is least-recently-used rotation. The rationale string that would explain it ("Cruise intervals (§5.3) · threshold on the threshold slot in QUALITY; N eligible, least recently used wins") was computed at authoring and discarded (plan predates `RATIONALE-PERSIST-1` by a day). Coaching Thesis explanation: none reaches any surface.

#### Cross-device consistency

| | Phone card | Watch phases (`buildWatchToday`) | Grader / rules |
|---|---|---|---|
| Structure | WU · Repeat 4× · CD | 9 phases from the same `expandSpecToPhases` | — |
| Rep pace | 7:02–7:18 | 430, tolerance **8** | watch: ±8 on **instantaneous** pace; server evidence pipeline ±10; blended basis ±15; run-detail ±10; influence copy ±12 |
| WU/CD pace | ≤ 8:22 ceiling | 502, tolerance 30 | watch grades a *band* (534 on the cool-down → "missed"; 516 on the warm-up → "hit") — the ceiling semantic does not exist on the wire |
| Recovery | 1:00 by feel | 60 s time, no pace | — |
| HR | `160–167` (not shown on this card) | work phase `hrTargetBpm 168` (decoded, rendered by no watch face) | pass `≤ 164` (read only by `goal-projection.ts`), bail `> 173` (text only; **the bail is triggered by two consecutive miles off PACE**, HR never evaluated) |
| Spoken cues | — | "Threshold is comfortably hard. If the first rep burns, the pace is wrong, not your legs." · "Last one. Run it at the pace of the first · that is the whole point of the session." · bail evidence "Heart rate over 173 and still climbing" | no cue for the pass rule |

**Are phone and watch asking for the same workout?** Yes on structure, distance, pace band and recovery. **No on heart rate**: three numbers for the same four reps (160–167 / 168 / ≤164) plus a bail at 173 that is never evaluated against HR. **Is the precision justified?** No: ±8 s/mi is 1.9% of a centre whose own uncertainty (0.727 confidence, a 4-mile anchor 48 days old on 08-31) is comparable to the half-width, and it is graded against instantaneous GPS pace. **Which signal is primary?** Nothing says; pace wins by `??` ordering. **Could the runner execute it without the model?** Yes, and he did — reps 422/429/422/419, recoveries 61/64/64 s, HR 158→166 — and the watch returned **drifted, drifted, drifted, missed**, plus "missed" on a cool-down run 32 s/mi under its ceiling. The last-rep cue told him to match the first; he ran 3 s/mi faster and was told he missed. That is the mission statement failing on the screen he was looking at (Rule 13, rendered by the runner himself).

**Instructions mutually compatible?** The card's own note "If the last one slips, the target was too fast" and the cue "run the last one at the pace of the first" agree with each other and with the doctrine. They are incompatible with a grader that scores 419 against 430 as a miss.

---

### 7 · Initial authoring migration

#### Legacy VDOT inventory on `main` (`generate.ts` @ `7cac80f0`, DIRECT)

| Name set | Call expressions | Distinct lines |
|---|---|---|
| Branch report's set (`vdot.ts` imports minus `parseRaceTime`, plus `conservativeVdotFromMileage`) | **26** | **22** |
| Broad set (adds `parseRaceTime`, `tPaceFromGoal`, `resolveMarathonPace`, `blendedTPaceForWeek`, `measuredProgressFraction`, `maxSeasonalVdotGain`, `achievableRaceTarget`, `boundedRacePaceSPerMi`) | **38** | **34** |

The branch report's "22 call sites" is a line count; the earlier "32 across 19 lines" (repeated verbatim in `authoring-convergence.ts:13`) reproduces under no method. By class: (a) legitimate declared fallback 1 · (b) duplicate authority **14 lines / 18 expressions** (`resolveCurrentTPace` computed three separate times at 8952, 13298, 14154; `tPaceFromVdot`, `iPaceFromVdot(vdotFromTpace(t))`, `conservativeVdotFromMileage`, `computeBestRecentVdot`) · (c) goal-sanity validation 7 · (d) race-prediction input 5 · **(e) goal → prescribed training pace, 7 lines, a class the branch inventory omits entirely**: `tPaceFromGoal` (8997, 14160), `maxSeasonalVdotGain` (9004), `clampToSanePace(goalTFloored)` (9018), `blendedTPaceForWeek` (9110), `resolveMarathonPace({…goalPaceSPerMi})` (9204), `measuredProgressFraction` (13019). Outside `generate.ts`: `zone-anchors.ts:227,235` round-trips a canonical pace through VDOT to price R/10K/3K zones on both legs (legitimate table lookup, but a below-table anchor silently clamps to VDOT 30); `plan-templates`, `goal-tiers`, `layout`, `catalogue-rx` are clean.

#### Does the goal still move an authored pace? **Yes, on the rebuild path.** (DIRECT, probe against the real functions with owner-shaped inputs)

```
currentT 7:11 · goalTraw 6:34 · achievableFloorT (goalT) 6:51
measuredProgressFraction = null  → blend 0.00 → 7:11   fresh authoring: clean
measuredProgressFraction = 0     → blend 0.15 → 7:08   REBUILD at zero demonstrated progress
measuredProgressFraction = 0.5   → blend 0.65 → 6:58
measuredProgressFraction = 1     → blend 1.00 → 6:51
```

`gatedBlendFraction` (`recompute-paces.ts:222-233`) returns `min(1, measured + BLEND_GRACE_FRACTION)` with `BLEND_GRACE_FRACTION = 0.15`; `composeForUserInternal` sets `measuredProgressFraction` whenever a prior plan for the same race exists. The owner's live plan carries `authored_state.pace_blend.measured_progress_fraction = 0` (DIRECT), so this fired on 2026-08-31 (3 s/mi here; ceiling 20 s/mi on this build, larger on longer ones). It is asymmetric (`BRK-1` keeps `currentT` when the goal is slower — only an ambitious goal moves the pace, and only faster). `generate.ts:14160`'s `tPaceSec = min(tPaceFromGoal(goal), currentT)` is a second, blunter leak for the plan-wide T the maintenance/recovery composers read. The flex path deleted its blend on 2026-08-31; authoring did not: **a live Constitution §7/§G violation and a §8 "two truths depending on which path ran last" state, with no gate** (`check-goal-immutability.sh` watches goal mutation, not goal→pace leakage). The nightly reanchor overwrites it within hours for the owner; for an unreanchored runner it stands.

#### The migration branch's shadow compare, reproduced (DIRECT, 2026-09-01, owner, 98-day CIM block)

| Δ (legacy → canonical) | Days | Type | Example |
|---|---|---|---|
| **+21 s/mi** | 3 | intervals ×1, tempo ×2 | `11 mi @ MP`, `7 mi @ MP`, `10×400m hills @ MP effort`: **7:22 → 7:43** |
| **+16 s/mi** | **11** | long | every long run wk0–12: 8:24 → 8:40 |
| −4 to −5 s/mi | 13 | tempo / threshold / intervals | `4×1 mi @ T`: 7:04 → 7:00 |
| 0 | 4 | race | identical |
| easy band edges −9 s/mi ×45 · shakeout −19 s/mi ×3 | | | printed as "-" in the branch's audit table |

Whole-block volume-weighted divergence: **3,011 s·mi over 366 priced miles (mean +8.2 s/mi), of which the 11 long runs carry 2,765**. The branch report's headline (largest divergence +23 s/mi on two hill-repeat days from a "cruise-interval approximation"; "+6 s·mi" quality-only proxy; "zero structural diffs") is wrong on the cause (the largest days are **marathon-pace** days: legacy refuses the 6:52 goal MP as out of zone and falls to the flat `T+18` population offset, canonical uses the runner's fitted exponent 1.087), omits 93% of the divergence, and "zero structural diffs" is guaranteed by construction because both legs share `composed.weeks` from the legacy compose (workout selection, phases, distances are never compared). The canonical side is more credible on every row, by the code's own doctrine comments (`spec-builder.ts:1160-1188`, `:1128-1135`). The compare is authoring-vs-canonical, not authoring-vs-what-the-runner-reads: the owner's live rows already carry the canonical numbers (long 520, MP 475). Fidelity limits: `describe.skipIf(!RO)` silently passes without the RO URL (Rule 18); the 4-account corpus block reports a signed mean only; persisted `distance_mi` is not compared.

#### Cold-start divergence, reproduced (DIRECT, cold-start branch)

Root cause on `main`: canonical `priorWeeklyMi` → refusal/0 → `conservativeVdotFromMileage(0)` = VDOT 30 → **10:42/mi**, while legacy seeds from **two** self-reported inputs: `profile.history_avg_weekly_mi` (`COLD-2`/`HIGHVOL-1`) and `profile.race_history` (`PARITY-1`, the typed PR). The branch names only the first. `SourceMode.user_prior` existed on `main` and was never assigned by any resolver.

The fix: `user_prior`, conf 0.15 (between population 0.10 and fallback floor 0.20), `evidenceIds: []`, goal structurally absent from its inputs (PASS on all four criteria). Cases: zero-run self-report 20 → 9:23, 30 → 8:23, 40 → 7:34, 100 → 6:54 (capped at VDOT 50). Returning runner (old VDOT 47, dated 2026-08 / 2026-05 / 2025-11): 7:17 at conf 0.34 / 0.21 / 0.20 — value held, confidence decayed, **correct**. Extreme goal: structurally cannot reach the resolver. **But:**

```
self-report 40 mi/wk on file, real habit mileage swept:
  real 0.00 → 7:34 user_prior
  real 0.05 → 10:42 population_prior      Δ +188 s/mi
  real 5    → 10:42
  real 15   → 10:08
  real 40   → 7:34
```

A hard switch at `real > 0`: a runner who logs one short run after onboarding jumps **+3:08/mi** and the **sparse-history** case (1–2 runs, weeks 1–4) lands worse than the zero-run case the branch was written to fix — Rule 9's own signature (the more engaged runner gets the worse plan). The branch's test `3e-3` asserts the cliff as correct. The fix closes about half the gap: `apple-review` +169 → +20 s/mi; `qa-phone-onboard` +107 → **+58 s/mi** (residual driven by the typed PR the canonical ladder has no rung for); `qa-phone-verify` (answered "0 mi/wk") unchanged, because `priorWeeklyMi`'s `> 0` gate erases the distinction the reader's own comment promises to keep (Rule 11/20).

#### Convergence guards: how long can a plan stay legacy-priced?

`reanchorActivePlan` has one production caller (`snapshot-projections` cron, 07:30 UTC) and GUARD 2 (`reanchor-plan.ts:289`) returns null unless `bestRecentVdot` is a measured read. **A runner with no qualifying measured VDOT is never reanchored — not late, never.** Production: 6 of 7 live plans have never been reanchored (`apple-review` for 24 days); the one that has is the only account with running history. A new user's plan is legacy-priced from authoring until their first 3-mile qualifying run produces a VDOT, not until the next cron. `authoring-convergence.ts` has no state for this ("cannot converge") — it is the majority state in the database. Lateness for an evidenced runner: max observed gap 15.7 h, one `cron_stale` alert.

#### Non-pace consequences of switching

`hr_cap_bpm`, WU/CD distances, rep count (owner): **unchanged** (DIRECT). Rep count and structure for cold-start accounts: **unverifiable by this mechanism** (rep counts cap against `repPaceSec`; a 100–180 s/mi difference could change them; the corpus block prints no structural check). Workout selection/phases: out of the mechanism's reach (§ above). Grading bands: easy −9, long +16, shakeout −19 at both edges. `restS / 540` (9:00/mi hardcoded recovery-jog pace for mileage accounting, nine sites in `spec-builder.ts`) is identical on both legs; after a migration it would be the only un-migrated pace constant left in the distance accounting.

#### Build / merge (DIRECT)

Migration branch: `tsc` 0 errors; 11/11 pure + 2/2 real-account tests. Cold-start branch: 0 errors; 47/47. Cold-start + `main` merged: 0 errors, 188 files / 2,828 tests pass, zero conflicts (one auto-merged file). All eight enforcement gates pass on the merged state — including `check-goal-immutability.sh`, which passes while the authoring goal-blend is live, because it watches mutation, not leakage.

#### Recommendation

- **`canonical-authoring-migration-20260901` → MERGE the code, REVISE the report.** Additive, shadow-only, cannot reach a write path, merges clean. Correct the five reporting errors (largest-divergence cause; long runs omitted; band deltas unreported; authoring-vs-reanchored; "zero structural diffs" by construction) and add the Rule 22 "cannot fail on" sentence; fix the silent `skipIf`. It does not clear the way to switch authoring, and its own §8 says so.
- **`cold-start-prior-fix-20260901` → REVISE before merge.** Blend by representative-day coverage instead of switching at `real > 0` (add a continuity walk; rewrite `3e-3`); add the self-reported-PR rung or decide explicitly that a typed PR does not price a plan; emit a distinct reason for "runner answered zero".
- **Do not switch authoring over yet.** Two prerequisites: close the cold-start gap fully (both self-reported inputs), and add a `CANNOT_CONVERGE_NO_MEASURED_VDOT` state to the convergence guard so unreanchorable plans are loud. Note in favour of the migration that its report never makes: switching authoring to canonical anchors would delete the goal→pace leak as a side effect.

---

### 8 · Adaptation authority assessment

#### Mechanisms verified (DIRECT unless noted)

| Mechanism | Verdict | Evidence |
|---|---|---|
| PACE phase-aware targeting | **Real** | `load-adaptation-engine.ts:342-364` groups by `ph.id`; live: QUALITY 7:15 (6 rows), RACE-SPECIFIC 7:04 (4), TAPER 7:55 (2). "TAPER clamped to its own doctrinal ceiling" **overclaims**: the ceiling is one generic training-lead VDOT point priced at the phase's own pace, so TAPER receives the **largest** step (9 s/mi) on rows 78 days out; the engine comment saying TAPER "by design" reports `moved:false` is false on the real account. |
| DURATION / VOLUME separation | **Real** | VOLUME held by filtered historical tolerance 33.4 vs 45 mi/wk (`normalWeeklyMileage`, 62 representative days); DURATION promoted 15 → 16 mi; PACE **deferred** behind DURATION by the one-stressor rule. Levers are plumbed separately but one activity (08-30) licenses two levers. |
| DENSITY reachability | **Inert** | 6 of 4,639 rows app-wide carry a `progression` block; the owner's one is 2026-10-29. Honest refusal, no lever. |
| Representative vs actual-load readers | **Real, unpromoted** | Live path still `classifyAdaptation(unfiltered)` (`load.ts:494-502`). MASKING-1 rescues negative rows only on **total washout**; a window with one good unprescribed session and three failed prescribed ones is strictly more permissive under filtering (its own rationale says it should not be). |
| `extendLookback` | **Constants honest; Rule 9 cliff live** | 120-day cap and 28-day half-life are labelled CONVENTION with doctrine-derived floors read at run time. The step is **7 days** (not 28→56→120). Continuity walk on real prescribed windows: `targetRepresentativeDays` 21 → 22 flips window 49 → 56 and PACE `INSUFFICIENT_EVIDENCE` (2 sessions) → `PROGRESS` (4). The owner sits exactly at the first clearing step. The existing "Rule 9" test (`_normal_window.test.ts:329`) checks day-count monotonicity, which cannot fail. |
| INSUFFICIENT_EVIDENCE vs HOLD | **Real, one-directional** | `contradictionsIn` catches a refusal wearing a finding, not a HOLD that had nothing to read. **Live in production:** zero-run accounts `apple-review`, `qa-beginner`, `qa-goal` receive `HOLD · "Threshold pace holds while the block is not being absorbed"` (band `poor` manufactured from `interpret.ts:213` mapping `actual == null` → `MISSED · 0`, and `readConsistency` treating `0/planned` as a real ratio); `qa-phone-onboard` gets the honest `INSUFFICIENT_EVIDENCE` only because its plan spans 3 weeks and the spread term fires. **The same collapse can reach the owner**: `run-adaptations` runs at 03:00 UTC, `strava-sync` at 08:02; unsynced runs read as MISSED; today he is protected only by dimensional dilution (+0.213 vs the −0.25 edge). |
| Compound-lever prevention | **Real** | Falsified both ways; a FITNESS restructure is withdrawn when a progression is promoted. |
| Authoring/reanchor guard | **Real; checks, does not ensure** | Four states, reads existing stamps. Contamination emits `PROGRESS_ON_UNCONVERGED_EVIDENCE` but **never changes `final_decision`**; a consumer reading the decision alone acts on contaminated evidence. 6 of 7 accounts read `REANCHOR_STATUS_UNKNOWN`. |
| Pace/HR compatibility | **Real, not in the engine** | Five verdicts; `INSUFFICIENT_HR_EVIDENCE` permits (fail-open). `adaptation-engine.ts` never imports the validator; `REFUSED_HR_INCOMPATIBLE` is a relabel in the log record. The validator never reads `proposedSecPerMi` (cannot scale with step size), needs 3 unexplained-hot sessions to refuse, and enforces on the Friel Z4 band that `hr-semantics-2026-09-01.md` calls display-only. HR evidence itself is real work-segment classification (an improvement over the pace proxy). |
| Zero-mutation shadow | **Proven** | Only write in the path is one `INSERT INTO adaptation_shadow_log`; in-band before/after checksum equal on every row. Checksum covers `id, pace_target_s_per_mi, distance_mi, type` only — not `workout_spec` (so not `hr_cap_bpm`), dates, or notes. |
| Shadow log retention | **Exists; never observed to run** | `prune-adaptation-shadow-log` scheduled 05:00 UTC; zero `ops_alerts` rows for that source ever. |

#### Production shadow records (all of them)

16 rows: 8 accounts × 2 cycles (2026-08-31 with three owner re-runs during the build night, 2026-09-01). Owner: `PROGRESS 435 → 430` on both days, `phases_moved {QUALITY, TAPER}`, identical five reason codes, `COMPATIBLE`, `contradictions []`, checksum `925312284e…:103` before and after, `zero_mutation_verified t`. The only day-over-day change is confidence 0.70906 → 0.68922, which traces to evidence ageing by one day (`evidenceIds` unchanged). `agrees_with_live = false` on every row: the shipped engine did nothing, the new one proposes PROGRESS. Two data-quality holes: `evidence_dates` is `null` for 2 of the 3 capacity evidence ids while the row records `CONFIDENCE_DISCOUNTED_FOR_EVIDENCE_AGE`; the schema has no `deferred` flag. **The git-tracked JSONL (36 lines) is one day (`2026-08-31`) re-evaluated 36 times in a 2 h 40 m window by test processes** — the RO role's INSERT fails, `persistShadowCompareRecord` falls back to appending to a tracked file (`allowFileFallback` defaults true); this audit reproduced the mechanism. It is determinism, not stability. The stability tool (`scripts/adaptation-stability-report.ts`, read-only, fails closed) reports `NOT_YET_ENOUGH_DATA · 2 of 7 consecutive days · 2 of 5 eligible cycles`.

#### Rule 21, remeasured

`coach_intents` app-wide: 48 downward/absorbing rows (`plan_adapt_downgrade 5, long_floor 5, reschedule 3, missed_noted 20, drop_missed 12, overridden 2, gap 1`), **zero** upward, ever. `vdot_auto_recalc` (1) is a recompute. The shadow log now instruments the same fact continuously.

#### The canary branch (`a0051439`)

Confirmed: OFF four independent ways (`PACE_CANARY_KILL`, `ENABLED === '1'`, allowlist, table-missing refusal); flag-off means zero DB activity; writes only `pace_target_s_per_mi` (never `workout_spec`/`hr_cap_bpm`); skips sealed rows with the Rule 14 predicate; plan UPDATE + `coach_intents` in one transaction; refuses on `REFUSED_HR_INCOMPATIBLE`; `tsc` clean, 56/56, merges clean. **Blocking defects:** (1) the runtime gate is not falsifiable in `npm test` — deleting both checks leaves 442 tests green (the only covering test is excluded from the suite and needs a scratch DB); (2) the `pace_canary_applications` audit snapshot is written **outside** the transaction and swallows its own failure → a committed mutation with no `rows_before` is un-rollbackable, and no `applied` row means the 7-day rate limit never engages → repeats nightly; (3) `rollbackPaceCanaryApplication` is ungated by the kill switch and takes an unscoped id; (4) no `ops_alerts` anywhere — with the flag on, the first signal is the owner noticing on his phone; (5) rollback resets the rate limit; (6) no cap on rows touched (TAPER rows 78 days out included); (7) owner scoping is an env-var convention, two uuids can be allowlisted; (8) no test asserts the canary can apply anything (Rule 22: the suite cannot fail on "inert"); (9) after an application the phone reads the moved `pace_target_s_per_mi` while the band-adherence sentence grades the unmoved `workout_spec.pace_target_s_per_mi_lo/hi` and the HR cap stays at the old anchor until the next reanchor (Rule 16 on a screen the runner reads).

#### Verdict on an owner-only PACE canary: **NO, not yet.**

Two of the four blockers are in the engine's **evidence**, not the canary's plumbing:

- **A · The proposal rests on recovery-window evidence.** The four "controlled" sessions are 07-07, 07-12, **08-23, 08-30**; the last two return `isPrescribedNonNormal = true` (days 7 and 14 after the AFC half). The loader argues this exemption explicitly (`load-adaptation-engine.ts:55-63`: "EXTENDED, NOT FILTERED … filtering a genuinely good session out because it happened during a recovery block would DESTROY evidence"). The argument has merit and cuts the opposite way from its sibling `historicalTolerance`. Exclude them and the count is 2 < 3: no proposal. Compounding: the median-age staleness discount is 0.976 (none) precisely because the two recent recovery-window sessions pull the median down.
- **B · The logged PROGRESS is a proposal the engine deferred.** `paceProposalOf` (`shadow-compare.ts:232-236`) falls back to the deferred list; the engine's ranking chose DURATION as the primary stressor. A canary applying this row applies a lever the engine did not choose — and if DURATION is ever also live, a `MORE_THAN_ONE_STIMULUS_CHANGE` the checker cannot see across the log boundary.
- **C · Rule 9 cliff at the lookback step** (above): one representative day separates PROGRESS from INSUFFICIENT_EVIDENCE on this account.
- **D · The zero-run HOLD collapse** is live on three accounts and reachable on the owner's by a sync outage.

Plus, since §4: **the threshold belief the proposal moves toward moved 10 s/mi in one day off one session, through a reader that never consults the hero-workout guard** — the canary would be chasing a number whose own stability has not been established.

**Evidence still missing and how to get it:** (1) a written ruling on recovery-window quality sessions as PACE capability evidence (a human decision; both answers are defensible; if "no", wait for clean evidence); (2) a `deferred` column and a refusal on it; (3) a continuity walk over the *decision* across the lookback step, falsified against today's code; (4) `interpret.ts:213` distinguishing "no run row exists yet" from "prescribed, day passed, not run", `readConsistency` on the filtered side, and the converse clause in `contradictionsIn` — falsified against today's three production rows; (5) the corpus admission fixes in §4 so the target belief is stable; (6) **14 consecutive clean production days** (not 7 — the evidence window turns over at a 7-day step), ≥12 eligible cycles, zero checksum violations / contradictions / `INCOMPATIBLE_REFUSE`-accepted-as-progress, zero unexplained flips, **zero cycles whose PACE proposal was deferred, zero cycles whose corroboration count would fall below 3 if recovery-window sessions were excluded**. Then the canary hardening (gate falsifiable in `npm test`; snapshot inside the transaction or abort; `ops_alerts` on apply and on `postWriteVerified === false`; rollback gated with a real invocation path; ≤ 5 s/mi, nearest phase only, ≤ 10 rows, one application per 14 days, rollback does not reset the clock; scope checked in code against a constant; stop rule: any disputed apply, unexplained flip, or `ops_alerts` row → kill and roll back).

The engine's disposition has genuinely changed — it proposes PROGRESS where the shipped engine never has, and says why. Switch it on today and the first live upward adaptation in this app's history would be one the engine itself did not choose, on evidence half gathered in a recovery block, one representative day from a refusal, toward a belief that moved 10 s/mi yesterday off one session.

---

### 9 · Race prediction and goals

#### Exponent authority

| Site | Method | Window | Shrunk | Status |
|---|---|---|---|---|
| `durability-anchor.ts resolveRaceExponent` | ≤6 races, recency-weighted, shrunk to 1.06 | 180 d, 84 d half-life | yes | canonical · 1.08691 (raw 1.10107), conf 0.621, 5 races, **2 distinct distances** |
| `coach-goal.ts fitPersonalExponent` | 2-race log ratio | 56 d | no | legacy; one live consumer (paused web Targets) + a doctrine claim |
| **`lib/coach/limiter.ts:433 fitRiegelExponent`** | 2-race log ratio, widest fresh pair | 56 d | no | **LIVE on `goal-gap.ts:678` → `whatClosesIt` coaching advice; never named by any report.** Its window admits 1 of 5 races → no pair → no shape finding → falls back to "threshold" as the limiter, while the canonical read says raw 1.1011, clearly endurance-limited. |

`goal-projection.ts:319-350` consumes the canonical exponent through a continuous confidence blend (weight 0.6210 today) — `61a31565` is real and live. Capacity resolvers are goal-sealed at compile time: adding `goalSec?` to `resolveDurability` fails `tsc` at `capacity-resolver.ts:1605` (falsified). `check-goal-immutability.sh` gates goal **mutation** (three injections all went red) — not goal contamination, which has no shell gate; it also relies on a substring grep for `informationalPlanKinds`.

#### Consumers of `resolveRaceProjection` and the ones that bypass it

Routed: races list, race detail, `goal-gap.ts` (`trajectorySec`), `goal-outlook.ts`, `goal-projection-resolve.ts`, `retrospective.ts`, paused `TargetsView`; downstream `gap-report`, readiness brief, plan-drift, `GapPanel`. The "no route computes it directly" test (`_race_projection.test.ts:106-120`) **can fail** (falsified by appending a `predictRaceTime` call to the detail route) but covers **exactly two files**. Bypasses: `effective-race-target.ts:114-121` (watch/execution target clamps `max(goal, 0.95 × projection)` off raw `projection_snapshots`); `simulator.ts:323` (morning-brief A/B/C); `GoalProjection.projectionSec` (returns the **goal itself** when status is on-track/watching); `goal-assessment.ts currentEquivalentSec` (documented equivalence, defensible). `trajectoryBasis` was added to `GoalGap` as an honesty discriminator and has **zero consumers**; `gap-report.ts:141` prints "Tracking X" ungated. Four comments still assert `trajectorySec` is the raw snapshot.

#### Cross-consumer numeric matrix (DIRECT, real resolvers against RO production, 2026-09-01)

**CIM — marathon 26.22 mi, 2026-12-06, stated goal 3:00:00, A**

| Consumer | Number | Δ vs "Projected" |
|---|---|---|
| **`resolveRaceProjection` → Races list + detail "Projected"** (trajectory) | **3:24:12** | — |
| rung-3 raw equivalence `predictRaceTime(46.8, 26.22)` | 3:21:33 | −159 s |
| rung-2 durability-blended `vdotProjectionSec` (w 0.621) | 3:27:51 | +219 s |
| pure durability projection (LA Marathon anchor, exp 1.0869) | 3:31:41 | +449 s |
| `GoalProjection.projectionSec` (off-track → = blended) | 3:27:51 | +219 s |
| confidence interval (around the blended number only) | 3:08:53 – 3:39:31 · LOW | — |
| `resolveRaceProjection.confidenceInterval` | null (trajectory rung, correct) | — |
| `GoalGap.trajectorySec` / basis / gap | 3:24:12 / `trajectory` / +24:12 | 0 |
| **live pending goal-outlook card** (`plan_proposals` 63, persisted 08-31) | **3:30:13** | **+361 s** |
| **morning brief headline** (`gap-report`) | "Tracking **3:24:12**" | 0 |
| **morning brief "B-goal · where you're tracking"** (simulator median) | **3:13:56** | **−616 s** |
| morning brief A / C (simulator p25 / p75) | 3:07:23 / 3:20:29 | −1009 / −223 s |
| `assessGoal` current equivalent / feasibility / safe / stretch | 3:21:33 / out-of-reach / 3:15:20 / 3:12:22 | — |
| `achievableRaceTarget` (what the plan prescribes) | **3:02:40** (`projected_ceiling`, floor clamp) | — |
| **WATCH / execution `EffectiveRaceTarget`** | **3:11:20** (clamped off snapshot 3:21:24) | **−772 s**; would be 3:14:00 off the canonical number: **160 s of prescribed pacing** decided by which projection the execution surface reads |
| push notification `resolveNextAGoalProjection` | 3:24:12 | 0 |
| `goalGap` status / confidence / limiter | unclosable / 0.94 / **threshold** (from `limiter.ts`; canonical durability says endurance) | — |

Nine distinct numbers for one race on one day; three wear "projects"/"tracking" in runner-facing prose. The morning-brief divergence is live in the `/api/readiness/brief` payload; the phone does not decode `gapReport` and web is paused, so it is unrendered today.

**Santa Monica 10K — 2026-09-13, no stated goal, B**

| Consumer | Number |
|---|---|
| **"Projected"** (rung 3, raw Daniels — **no goal ⇒ `computeGoalProjection` never runs ⇒ no durability blend**, `race/[slug]/route.ts:191`) | **43:38** |
| pure durability projection (AFC 13.1 anchor) | 45:11 |
| **coach-set A / B / C** (personal exponent) | **44:15 / 45:10 / 46:05** |
| WATCH race-day goal (`build-workout.ts:2136`, coach-set B) | 45:10 |
| WATCH strategy / gel ladder | resolved from today's race (10K), not CIM — the MIDGOAL-2 incident does not recur (CODE-PATH) |

**"Projected 43:38" renders directly above "COACH SET A ~44:15" on `RaceDetailV5.swift`: the coach's most ambitious tier is 37 s slower than its own headline, 12 days out.** (Numbers DIRECT; the screen composition CODE-PATH, not rendered.)

**Dodgers 10K** (goal 45:00, C): Projected 44:40 · `projectionSec` = goal 45:00 · CI 43:33–45:47 MEDIUM · watch target 45:00 (no 10K snapshot ⇒ goal). **Run Malibu HM** (goal 1:30:00, B): Projected 1:38:10 · blended 1:39:58 · pure durability 1:41:53 (AFC, his slowest half, chosen as anchor) · watch target **1:32:00** (clamped off snapshot 1:36:50). **LA Marathon 2027** (goal 3:31:00, A): Projected 3:27:51 · `projectionSec` = goal 3:31:00 · watch 3:31:00.

#### Goal handling

No accept path can mutate a goal, three ways deep: the phone gives `goal_outlook` exactly one action (`.keep`), the server returns 400 on `accept` for informational kinds, and a goal PATCH with a non-runner source is rejected. Rows 53/57 (`goal_renegotiation`) still carry the retired `accept_path` and imperative in `reasons`, but are `expired`/`superseded` and `proposals-state.ts` recomposes the prose from structured fields. **Re-nag is time-based** (`OUTLOOK_SUSTAINED_DAYS 5`, `OUTLOOK_REFRESH_DAYS 7`, 14-day dismiss cooldown), not materiality-based as the 2026-08-31 decision requires; the `plan-drift` cron will re-fire on 2026-09-07 and nothing compares the new number to the old. A materiality check should reuse `PROJECTION_NOISE_GRACE_VDOT` (already doctrine-gated, scales across distances) plus a `GoalGap.status` rung change.

#### Rule 9 cliffs in the durability path (DIRECT, computed on live data)

- **Anchor selection is argmin on log-distance only** (`durability-anchor.ts:655-659`), no recency or effort-grade weighting. Four halves stored at 13.109 / 13.109 / 13.16 / 13.1 mi: a **0.009-mile** course-length difference picks AFC (45:11) over Disney (42:03) for the 10K target — **188 s on a data-entry artifact** — and picks his slowest half as the Run Malibu anchor.
- **`RIEGEL_MAX_DISTANCE_MI = 26.22` and CIM is stored at exactly 26.22.** At 26.22 the blend gives 12,470; at 26.23 the durability projection returns null and the model drops to Daniels-only, 12,093 — **377 s for 0.01 mi**. His other marathons are stored at 26.2 and 26.219.
- `projection_snapshots` holds duplicate rows (26.2 → 12,084 and 26.22 → 12,093) for the same day and race; the watch's query has no tiebreaker beyond `snapshot_date` (Rule 14).
- The `achievable-target.ts` 95% cliff **is** fixed (`max(goal, floor)`; CIM clamped to the edge 3:02:40, verified live).

---

### 10 · HR semantics and safety

At LTHR 168 / HRmax 183 the app computes **eleven** structurally different heart-rate numbers, and on the 2026-09-01 threshold session **four are live at once and disagree**: card `~160–167 (Z4)`, live-run gauge `168 expected`, pass `≤ 164`, bail `> 173`. On the 09-03 interval row: card `~> 168`, gauge `176 expected`, pass `≤ 164` — running the app's stated expectation guarantees failing its stated pass criterion by 12 beats and tripping its bail by 3.

#### Value → producer → consumer → meaning (LTHR 168, HRmax 183; every number produced by calling the real function)

| bpm | Producer | Formula | Persisted? (Rule 10) | Consumers | Meaning |
|---|---|---|---|---|---|
| 168 `profile.lthr` | `lthr-reanchor-store.ts:109` (AFC half avg HR, 1:1) | `lthrFromRace` gated by effort-authority | **with anchor** (`lthr_method` = race, `lthr_set_at`) — the only Rule-10-compliant anchor in the app | everything below | threshold HR |
| 183 `users.max_hr` | `max-hr.ts:454` ratchet | monotone-up over 365 d | no stamp, can never fall | aerobic caps, easy-discipline, %max zones | HRmax (also `profile.hrmax_observed 183`, `profile.hrmax NULL`) |
| 46 / 52 | `profile.rhr` / `users.resting_hr` | — | two columns, 6 bpm apart | readiness | resting HR |
| Z1 <142 · Z2 143–151 · Z3 152–159 · Z4 160–167 · Z5 168+ | `lthrZones` (`zones.ts:198`) | Friel 85/90/95/100% | recomputed | `hrTargets`, `resolveHrZoneShares`, **`pace-hr-compatibility`** | population percentages on an individual anchor; carry `~`, labelled nowhere as population |
| **151** | `aerobicCeilingBpm` (`zones.ts:178`) → `hrCapEasy` (`spec-builder.ts:389`) → `hr_cap_bpm` | `max(ceil(168×0.90)−1, round(183×0.78))` | **persisted in `workout_spec`, no anchor stamp** (0 rows carry one); refreshed only for `date_iso >= today` | watch `hrCeilingBpm` (the only wrist alarm), phone `.ceiling` gauge, recap, easy-discipline | **aerobic ceiling** (AC) |
| 145 | same formula at LTHR 162 | — | frozen on 4 sealed rows (08-26 → 08-30) | recap | a repudiated ceiling: recap says "ran past the 145 target" while run detail's live read says 151 for the same run |
| 155 | `spec-builder.ts:1462` tempo `hr_target_bpm`; `:1618` marathon race `hr_cap_bpm` | `round(168×0.92)` | persisted, no stamp | live-run reference; **`drift-monitor.ts:695`** (VDOT-refit gate); recap; race-day graded cap | expected response (tempo) / **race ceiling graded as a hard cap** |
| 168 | `spec-builder.ts:1518` `lthr_bpm` (threshold/intervals); `build-workout.ts:1814` `workHrTargetBpm`; `:1618` HM race cap | = LTHR | persisted | phone `.reference` gauge (never alarms); HM race graded cap | expected response / **race cap set to his race-day average** |
| 176 | `build-workout.ts:1814` intervals | `round(168×1.05)` | wire only | phone gauge on 60-s hill reps the card refuses to price (`HR_TARGET_MIN_REP_SEC 30`) | expected response |
| 164 | `thresholdPassHrBpm` (`zones.ts:193`) | `round(168×0.975)` | `workout_spec.rules` | **`goal-projection.ts:881` only**; the watch never evaluates it; authored on interval rows where VO2 work (103–107% LTHR) cannot satisfy it | pass criterion |
| 167 | `pace-hr-compatibility.ts:265` | Z4 upper | pure | shadow validator → canary gate | refusal edge |
| 171.4 | `threshold-band.ts:44` | target × 1.02 (→ 158 off a tempo target) | pure | `drift-monitor`, `run-recap.ts:590` | grading band top |
| 173 | `spec-builder.ts:1061` bail | LTHR + 5 | rules | phone contingency card; watch bail board **text** | contingency — **never evaluated against HR** |
| 179 | `distance-doctrine.ts:354` race abort | round(168×1.05)+3 | rules | phone text; **`WatchRule` decodes `metric/op/value` and reads none of them; "only `bail` draws a board"** | safety stop — inert |
| heat bump 0–20 | `heat-adjustment.ts:132` | ≥77°F | pure | `judgeEasyRunHr`, easy-discipline exclusion, compatibility overage, run-state display | environment adjustment — interpretation only, correctly |
| HRV / RHR / ACWR | `convergence.ts`, `acwr.ts` | — | recomputed | `runner-state.ts` (reported, never driving), `adapt.ts readiness_pullback` | readiness — never an anchor, correctly |

#### Verifications

| Check | Result |
|---|---|
| Informational reference cannot trigger a safety alarm | **Phone live-run: yes, fixed** (`RangeScale.reference` returns `outOfRange=false` unconditionally, speaks "informational only"). **Watch: yes** (`hrTargetBpm` decoded and read by zero faces; the only alarm keys on `hrCeilingBpm`, null for all but easy/long). **But a third alarm is wrong and armed**: `native-v2/Faff/Faff/HRAlerter.swift` fires at `ceiling × 0.95` and says "above your {ceiling} ceiling" (144 called "above 151"), has `predicate: nil` where its header claims a workout gate, and reads a `UserDefaults` ceiling whose only writer has no call site. Dormant only because the enable flag is never written. And the phone's precedence puts `.expected` **ahead of** `.ceiling`: mutually exclusive only by a server invariant nothing checks. |
| Faster pace does not raise `hr_cap_bpm` | **Clean on every path**, including the canary branch (writes only the pace column; refuses on HR incompatibility). |
| Heat does not rewrite capacity | **Clean — the cleanest boundary audited.** `heat-adjustment.ts` imports no DB; watch heat easing is hard-disabled (`build-workout.ts:1904`); only LTHR writers are the reanchor store, the watch field test, the HRmax ratchet and `/api/health/manual`. |
| Cardiac lag on quality work | **Three inconsistent postures**: the card refuses an HR band under 30 s; the wire stamps `hrTargetBpm` on 60-s hill reps anyway; the watch's HR check is instantaneous from tick one with no settle window (`WorkoutEngine.swift:1101`, strict `>`, no hysteresis); post-run grading averages the whole segment, which absorbs lag by accident and states nowhere that it does. |
| Same number, different meaning across surfaces | **Yes, four ways.** 168 is simultaneously one past the card's band top, the gauge's "expected", and a graded hard cap on the HM race row (`askedHrIsHardCap = Boolean(hr_cap_bpm > 0)`), where it equals his AFC race-day average by construction — one beat from amber on his own PR, on phone and wrist. |
| Static Friel zones labelled | `~` only. Nowhere says "population percentages"; `computeZones`'s Tanaka branch carries an honesty note the LTHR branch does not. `spec-card.ts:424` calls the Z1 warm-up string "the real constraint" while `prescriptions.ts:284` says the same values "must never be presented as something the runner is meant to hit or hold" — both edited 2026-09-01. |
| Rule 10 stamps on the owner's rows | **Zero spec rows carry an anchor stamp.** All 59 future rows current (151/168); four sealed rows frozen at 145; the recap quotes the frozen number and run detail quotes the live one for the same run. |

#### Conflicts that matter most

1. **The bail says "Heart rate over 173 and still climbing" and is triggered by pace.** `shouldOfferBailNow` = `milesAdrift >= 2` (two consecutive miles outside the *pace* band, `WorkoutEngine.swift:1997-2004`); HR is never read; `declinedBail` recap copy then asserts "the bail line tripped". A runner at 150 bpm is told his HR is over 173; a runner at 180 holding pace is never offered the bail. **The race `abort` rules draw nothing at all** — a safety stop shipped, persisted, and inert (Rule 21's signature on a safety mechanism).
2. **"with the heart rate still in the band" is asserted without checking the band** (`run-recap.ts:593`): guard is `actualAvgHr != null && plannedHrCap != null`, no band test; `ranBelowThresholdBand` exists in the same module and is not imported. At HR 154 against a 168 cap it says "a soft lead the targets should probably catch up to" — converting a session that never reached intensity into a recommendation to make targets faster. Reachable on the owner's data (today's session shape: rep HR 158–166, whole-run 154; the branch did not fire today only because the under-target delta path routed elsewhere — this audit ran `deriveRecap` on the real shape and got no tip).
3. **Four ceilings for one threshold band (164 / 167 / 168 / 171.4) and two give opposite advice on the same session**: at avg work HR 171 the recap says the targets should get faster (`171 < 171.4`) while `pace-hr-compatibility` (`171 − 167 = 4` unexplained, ×3 → `INCOMPATIBLE_REFUSE`) refuses the progression. The validator the 2026-09-01 §3 decision makes the gate on live PACE authority is itself one of the two contradicting answers.
4. **`hr_cap_bpm` holds a race-effort ceiling and an aerobic ceiling in one column** and both are graded (`askedHrIsHardCap`); AFC came in at avg HR exactly 168 against a 168 cap.
5. **`threshold-band.ts` is applied to a target that is not the threshold**: on tempo rows `plannedHrCap` is `hr_target_bpm 155`, so the band top is 158 and a tempo at 160 bpm — the floor of the app's own "Z4 Threshold" — is told "that is past threshold". `drift-monitor` reads only `hr_target_bpm`, present on 6 of 19 quality rows (tempo), so the mechanism whose header asks "did the heart rate agree this was threshold work" is blind on every actual threshold session (Rule 15, on production data).
6. Five aerobic-ceiling derivations (`aerobicCeilingBpm`, `hrCapEasy`, `hrCapLong` alias, `resolveHrCeiling` derived arm without the `max()`, `aerobicCapBpm`, plus HRmax-anchored `easy-discipline`) that diverge for any runner with `maxHr > 1.154 × lthr`; three mutually inconsistent LTHR↔HRmax crosswalks (×0.90, ÷0.92, +22) that do not round-trip (183 → 165 → 179).

#### Recommended single owner per HR question

Threshold HR: `profile.lthr` (already correct). HRmax: `loadEffectiveMaxHr`; collapse `profile.hrmax*` to mirrors. Zones: `lthrZones`, nobody re-derives a percentage. Aerobic ceiling: `aerobicCeilingBpm` wrapped once by `hrCapEasy`; delete `hrCapLong`; `resolveHrCeiling` and `aerobicCapBpm` call it. Threshold band edges: Z4 upper (167, "under threshold") and Z5a top (171, "at threshold") derived from `FRIEL_7_ZONE_EDGES`; `thresholdPassHrBpm`'s 0.975 and `THRESHOLD_HR_CEILING_OF_TARGET`'s 1.02 stop being typed literals, so the validator and the recap agree by construction. Expected quality HR: one resolver off the zone the session is prescribed for; collapse `hr_target_bpm`/`lthr_bpm` to one field with one meaning. Grading: `threshold-band.ts` takes LTHR, not the row's target; `drift-monitor` COALESCEs both fields; `run-recap` imports the floor. Race HR: its own field, not graded as an aerobic cap. Bail/abort: evaluate `metric/op/value` on the wrist or drop the HR wording. Heat and readiness: already single-owner and interpretation-only; leave them.

---

### 11 · Additional findings

Issues not covered by the supplied reports. Numbered for reference in §12–§15; severity is user impact.

#### Live coaching correctness

| # | Sev | Finding | Evidence |
|---|---|---|---|
| N-1 | **P0** | **The race row is frozen at authoring.** `race` and `race_week_tuneup` are in `RECOMPUTE_EXEMPT_TYPES` (`recompute-paces.ts:322`), so the CIM row carries its 03:40 authored 431–441 band while every MP rehearsal was moved to 475 at 21:48. The block rehearses 3:27 and asks him to race 3:10; the race's own abort trigger (7:38) sits between the two; `hr_cap_bpm 155` is unachievable at the band on his own data. `shakeout` was removed from the same list for the identical reason. | §5, DIRECT |
| N-2 | **P0** | **Watch grades tempo at ±8 s/mi, phone prints ±20.** `build-workout.ts:1706` classifies on `workout_spec.kind` (`tempo → threshold → 8`); `today/route.ts:1514` classifies on `strictPrescriptionType` (`tempo → tempo → 20`) under a comment saying "Same tolerance the watch applies." 6 rows in the owner's active block, 21 across live plans. A runner at 7:26 against 7:10 reads "on target" on the phone and gets an amber sustained-drift haptic on the wrist. | Agent F, DIRECT |
| N-3 | **P0** | **The watch grades ceilings as bands and averages as instants.** Cool-down at 534 against a 502 *ceiling* → "missed"; warm-up at 516 → "hit". Reps graded `drifted` (avg in band but <70% of instantaneous samples in a ±8 band) and `missed` (419 vs 430±8, 3 s/mi past the fast edge). No `ceiling` semantic exists on the wire. Today's near-perfect session returned zero "hit" reps. | §6, DIRECT (production phases) |
| N-4 | **P0** | **The easy-pace band the coach grades against is read from an archived plan for 3 of 7 users.** `easy-discipline.ts:756` queries `plan_workouts` on `user_uuid` alone, `ORDER BY date_iso DESC LIMIT 1` — every plan version ever, furthest-future day wins. User `606bcc38` is graded against 543 s/mi from a dead plan while his active plan prescribes 583. The owner is safe only because his CIM block runs later than any archived plan. `ACTIVEPLAN-1` skips any SQL that does not mention `training_plans`; Rule 14's own bug planted verbatim passed the gate. | Agent F, DIRECT |
| N-5 | **P1** | **The threshold corpus is a second Evidence Engine that disagrees with the first.** `resolveThresholdPaceCorpus` never consults `classifyActivityEvidence`: it admits 07-16 (Interpreter: `no_evidence`, HR 91% LTHR, I-pace) as the fastest threshold observation and 08-06 (abandoned treadmill, `completed:false`, no work-phase HR, inside the AFC taper) as one of two live evidence ids; `thresholdSegmentFromPhases` filters `type === 'work'` only, computes `hrPct`/`hrBandDistance` and never gates on them, has no per-observation weight, and the estimate is an unweighted K-th-best order statistic. Belief-tension relaxation is direction-blind (two `weaker` observations lowered the bar and made the belief faster). The hero-workout guard exists, fires (`anchorMoveCandidate: false`), and is wired to nothing that owns the anchor. Result: threshold moved 430 → 420 in one day off one session. | §4, DIRECT (falsified) |
| N-6 | **P1** | **Coaching Thesis is built and unwired; its limiter is a step function of an unrelated clock.** Zero live callers of `resolveCoachingThesis`. HIGH_INTENSITY's ranking score is `0.4 + 0.6·2^(−vdotAnchorAgeDays/28)`, so it is the primary limiter whenever the last VDOT-qualifying run is >~10 days old and never otherwise; flipped HI → THRESHOLD overnight with no HI session. "No reader" becomes a negative finding half the time, decided by the calendar (Rule 11). | §3–4, DIRECT |
| N-7 | **P1** | **`limiter.ts` is a third exponent authority on the coaching-advice path**, contradicting the canonical durability read (§9). | Agent C, DIRECT |
| N-8 | **P1** | **A race with no stated goal never gets the durability blend** (`race/[slug]/route.ts:191` gates `computeGoalProjection` on `goalSec != null`): "Projected 43:38" above "COACH SET A ~44:15" for Santa Monica, 12 days out. | §9, DIRECT numbers / CODE-PATH screen |
| N-9 | **P1** | **Watch and execution plan pace off `projection_snapshots`, not the canonical projection**: CIM watch target 3:11:20 vs 3:14:00 (160 s); snapshot query has duplicate rows and no tiebreak. | §9 |
| N-10 | **P1** | **Recap asserts "heart rate still in the band" without checking the band** and recommends faster targets off a session that never reached intensity; `threshold-band.ts` applied to a tempo target (155) calls 160 bpm "past threshold"; `drift-monitor` reads only `hr_target_bpm` (6 of 19 quality rows) so its HR corroboration is blind on every threshold session. | §10 |
| N-11 | **P1** | **The watch bail is HR-worded and pace-triggered; the race abort rules are inert.** `shouldOfferBailNow = milesAdrift >= 2`; `WatchRule` decodes `metric/op/value` and reads none. | §10 |
| N-12 | **P1** | **The execution grader prices "established pace" off `T−30 / T−18 / T+100`** (`reconstruct.ts:557`), 22–46 s/mi off the table's R pace and 20 s/mi off the prescribed easy ceiling, every offset biasing `failedAtKnownPace` toward true, and prints the wrong number ("comfortable before, at 6:24/mi" vs a 5:50 prescription). Its VDOT comes from six hand-copied `projection_snapshots` reads with no freshness bound and no tiebreak (three rows per user per day), three of them wrapped in `.catch(() => [])`. Four of nine coach-log finding types (`fitness_evidence`, `easy_discipline`, `threshold_pattern`, `first`) have fired zero times for any runner, which is why none of this was visible. | Agent F, DIRECT |
| N-13 | **P1** | **The goal→pace blend is live at authoring on rebuilds** (`BLEND_GRACE_FRACTION 0.15` at zero progress; `tPaceSec = min(goalT, currentT)` at `generate.ts:14160`), with no gate. | §7 |
| N-14 | **P1** | **6 of 7 live plans have never been reanchored** and never will be until a measured VDOT exists (GUARD 2); the convergence guard has no state for it. | §7 |
| N-15 | **P1** | **Zero-run accounts receive `HOLD · "block is not being absorbed"`** from `interpret.ts:213` (`actual == null → MISSED · 0`) and `readConsistency` (`0/planned` as a real ratio); which accounts get the honest refusal is decided by how many weeks the plan spans; `contradictionsIn` cannot see it; reachable on the owner via a sync outage (`run-adaptations` 03:00 UTC, `strava-sync` 08:02). | §8 |
| N-16 | **P2** | **Every cron runs twice a day.** Per-job GitHub workflows POST routes directly without `isDue`; verified in `ops_alerts` (plan-drift 4× on 09-01) and in the shadow log (two rows per user per day against a documented rate of one). `readiness-snapshot` is a full `DO UPDATE`, so the owner's morning score is the afternoon recompute (08-31: computed 09:10 PT, after his run). | Agent F, DIRECT |
| N-17 | **P2** | **Four jobs can never raise a staleness alert** (`notifications`, `strava-push-poll`, `keep-warm`, `prune-adaptation-shadow-log` are in `EXCLUDED_FROM_TICK`, which the health loop does not iterate); the prune job's new heartbeat is read by nothing. **Zero `ops_alerts` acknowledged in 82 days** against 90 unacked rows (73 error-severity `webhook_failure`, 9 `cron_stale`). The push leg is gated on `OPS_SLACK_WEBHOOK_URL`, undocumented; whether it is set in Railway is the single highest-value thing for a human to check. | Agent F, DIRECT |
| N-18 | **P2** | **`training_plans.authored_state` is full-replaced by `reanchor-plan.ts:659`** from a snapshot read outside its own transaction (Rule 6); four other writers of the same column merge. A dismissed "your paces moved" card can come back. | Agent F, CODE-PATH |
| N-19 | **P2** | **Three definitions of the easy HR ceiling** (authoring `max(0.895·LTHR, 0.78·HRmax)`, watch without the `max`, phone `z2.upper` ignoring the spec); **three unordered "today's row" pickers** in one phone request vs an ordered one on the watch; **four incompatible completion graders** (60% / ±25% / 40% / display-only) and HR-cap grace of 0 vs +5 bpm between recap arms. The MP rehearsal ships the runner's *threshold* HR to the wrist as `hrTargetBpm` because the spec's deliberate `null` is indistinguishable from missing (harmless only because no watch face reads the field). | Agent F |
| N-20 | **P2** | **Cold-start prior fix has a 188 s/mi Rule 9 cliff** and closes only half the gap. | §7 |
| N-21 | **P2** | **Durability anchor selection cliffs** (0.009 mi → 188 s; `RIEGEL_MAX_DISTANCE_MI = 26.22` with CIM at exactly 26.22 → 377 s). | §9 |
| N-22 | **P2** | **The live goal-outlook card shows a persisted 3:30:13** while every live surface resolves 3:24:12; re-nag is time-based. | §9 |
| N-23 | **P2** | **`hrCapEasy`'s HRmax branch is unreachable** (LTHR is derived as 0.90·HRmax, so `0.895·LTHR ≈ 0.805·HRmax` always wins the `max`), making the live easy cap 80% of HRmax where doctrine says 78%. Recorded as a doctrine violation nobody reads (below). | Agent F |
| N-24 | **P2** | **Rule 17 on the live block**: one sentence ×17, the downhill instruction ×9 (plus a row that says it twice in one sentence), pace band printed twice on Today by two formatters, distance three times on an easy day, easy pace as a band on the panel and a ceiling on the step; per-row boilerplate still ships on the wire and is de-duplicated in one renderer only. | Agent F + DIRECT |
| N-25 | **P3** | **`HRAlerter.swift`** fires at `ceiling × 0.95`, says "above your ceiling", has no workout predicate, and its ceiling writer has no call site. Dormant and armed. | §10 |

#### Gates and verification

| # | Sev | Finding | Evidence |
|---|---|---|---|
| G-1 | **P1** | **Four gates pass while the violation they exist to stop is live** (each falsified, then restored): `check-swallowed-failure.sh` is a scalar ratchet (a new swallowed read in `generate.ts` is green if a peripheral one is removed); `check-coach-voice.sh` still excludes `lib/plan` (Rule 20's own named gap — `"Great work! You crushed it — keep going."` in `block-preview.ts` reports clean; 1,801 of the owner's 4,021 rows carry an em dash, the composers at `generate.ts:5127/7016` still emit them); `check-automatic-mutations.sh` is file-granular (a second `UPDATE plan_workouts` inside an already-declared file is free); `ACTIVEPLAN-1` skips no-join queries (N-4). | Agent F, DIRECT |
| G-2 | **P1** | **`check-coercion.sh` prints OK over seven live Rule 11 collapses** it itemises as "NOT exemptions", one of which (`generate.ts:4544`) silently disables the 3-hour long-run time cap; `HANDED_BACK_FAILS` sits as `if (!FLAG) return;` above the only assertion — Rule 18's named anti-pattern. Two more of the seven disable the layoff detector and the chronic-volume floor on a failed read. | Agent F, DIRECT |
| G-3 | **P1** | **No automated runner executes the full test suite.** `build-check.yml` runs prebuild (14 gate files) + build; `surface-sweep` and `plan-engine-bench` run path-filtered subsets; `lib/adaptation/**` matches no filter. `_adaptation_engine.test.ts`, both replay corpora, `_adaptation_model.test.ts`, 131 of 136 `lib/plan` test files never run automatically. `shadow-compare.ts` (665 lines, nightly, every user) has one test, RO-gated, skipped in every workflow; its "three independent layers prove this" header describes a manual once-run check as a proof. | Agent F + DIRECT (`grep vitest .github/workflows`) |
| G-4 | **P2** | **`check-doctrine.sh` runs `--silent` and suppresses `12 recorded violations`**, three self-described "REAL VIOLATION, RUNNER-FACING, NOT FIXED HERE" (`CONVENTION.simulator-projection-band`: a 5K A-goal and C-goal ten seconds apart). Four older gate stages `exit 0` with an OK line when vitest is absent (`*_SKIP_VITEST` / non-executable binary); the newer gates hard-fail. `surface-sweep` files 651 runner-facing findings as ungated "observations", two of which are hard laws elsewhere. | Agent F |
| G-5 | **P2** | **Rule 15's corpus gap is 0.76% closed**: 89 of 11,687 archetypes carry `history`; `race` mode has three. | Agent F |
| G-6 | **P2** | **The `_race_projection` gate covers two files**; no tree-wide gate for projection re-derivation, goal→pace leakage, HR-number consistency, or tolerance consistency. | §9 |
| G-7 | **P2** | **The RO-role file fallback appends to a git-tracked file**: a read-only audit run writes `docs/reports/adaptation-shadow-log/*.jsonl`; the 36-line file is one day re-run 36 times. `allowFileFallback` defaults to true. | §8, reproduced |
| G-8 | **P2** | **`_activity_evidence.audit.test.ts` pins a live production row's data-quality state as fact**; went red on ordinary re-ingest. | §4 |
| G-9 | **P3** | Doc rot in the files that produced the original incidents: `lthr-reanchor.ts:79` still says "imports no database at any depth" while `:85 → lthr.ts:180` reaches `await import('@/lib/db/pool')` (the correction sits 17 lines below); `_adaptation_engine.audit.test.ts:6` says nothing live calls `resolveAdaptationProposals` (shadow-compare does); `load.ts:1043` says migration 160 is not run; `run-adaptations/route.ts:22` and `snapshot-projections.yml:20` cite the deleted `refresh-briefings`; `CRON_AUDIT.md` lists 6 of 15 crons; `automatic-mutation-registry.ts:188` names a table that does not exist; four comments cite files that do not exist (`normal-window-exemptions.ts`, `drift-cron.ts`, `citation.ts`, `docs/2026-05-19-sim-sweep.md` — the last also in `CLAUDE.md`); `authoring-convergence.ts:13` repeats the unreproducible "32 across 19 lines". | Agent F + DIRECT |

#### Process, artifacts, and safety

| # | Sev | Finding | Evidence |
|---|---|---|---|
| S-1 | **P1** | **Every isolated agent worktree in this audit was created from the stale `claude/build-runcino-app-OIRJr` line** (`f43fb7a7`, no `web-v2/`), not `main`. All seven agents caught it; an agent that did not would have audited the pre-rewrite app and reported confidently. The Agent tool's worktree base is the environment's "main branch (for PRs)" setting, not the working line `CLAUDE.md` names. | DIRECT |
| S-2 | **P1** | **Two consecutive Railway builds failed on 2026-09-01** (`2352f3e2`, `fe448a71`, 01:32–01:42 UTC) until `cc0a1010` registered a `MODULE_ORPHANS` exemption. Round-3 handback reports both commits as landed; neither was live for ~20 minutes. Rule 19 held by the morning, not through the night. | DIRECT (`railway deployment list`) |
| S-3 | **P2** | **The shadow-compare path is permanently on for every user** with no flag; disabling it needs a `DROP TABLE` or a redeploy. It roughly doubles `run-adaptations`' per-user work against `maxDuration = 120`, and runs twice a day (N-16). | Agent F + DIRECT |
| S-4 | **P2** | **81 scratch probe scripts are committed at `web-v2/` root; three issue production WRITES** on `DATABASE_URL` with no guard (`_diag_jun9_fix.mjs` is a bare `UPDATE runs SET data = …` on a hard-coded row). | Agent F, DIRECT |
| S-5 | **P2** | **`AGENTS.md` (untracked, root) is a stale copy of the old `CLAUDE.md`**: web as "command center", brief v2 as design authority, no mission statement, none of Rules 6–23. `.codex/config.toml` is beside it. A Codex agent reading it starts on the abandoned posture. **`adaptive-engine/`** (untracked, root: `package.json`, `server/`, `sim/`, `src/`, `test/`) is a parallel package nothing references. | DIRECT |
| S-6 | **P2** | **`plan_workouts` has no retention**: 4,123 of 4,639 rows belong to 51 archived plans (`clearActivePlansFor` archives and leaves rows — the source of the 47-versions defect and of N-4); `pg_stat_user_tables.n_live_tup` reads 103 against 4,639 with autovacuum/analyze never run. `ops_alerts` now carries cron heartbeats, alerts, census rows and account-deletion tombstones with no kind-aware retention. | Agent F, DIRECT |
| S-7 | **P2** | `NODE_ENV` is one unasserted variable between production and an auth bypass to the owner's account (`session.ts:293`, `DEV_USER_UUID` published in `.env.example` as his real uuid); five env vars name one origin; `.env.example` documents six variables nothing reads and omits `CRON_SECRET` (28 reads) and every ops/APNs variable. | Agent F |
| S-8 | **P3** | Nine `cron_stale` alerts from 2026-08-31 04:18 ("no recorded successful completion") remain unacknowledged; the local-only docs commit `7cac80f0` was unpushed at audit time; 372 AppleDouble `._*` sidecars sit beside `web-v2/lib` sources (excluded by vitest and the module walker, but the volume notes say they corrupt packs and break `find`-driven tooling). | DIRECT |
| S-9 | **P3** | `MODULE_ORPHANS` is well maintained (three 08-31 entries correctly removed when wired), but four entries are dead code by the registry's own admission: `lib/plan/core.ts`, `lib/strava/streams.ts`, `components/profile/InlineGapEditor.tsx` + `ProfileGapInput.tsx`, `lib/faff/state-tokens.ts`. | Agent F |
| S-10 | **P2** | **The pre-push hook cannot be satisfied from a fresh worktree, and half of it skips silently.** Without `web-v2/node_modules` it prints a skip line and runs no web check (a gate reporting nothing when it cannot run, Rule 18 point 2); its watch-path scoping fires on a docs-only new branch and `xcodegen` fails on the untracked `Secrets.xcconfig`. Every isolated worktree (the policy's own prescribed remedy) hits both. The exception path (`verify-commit.sh`) therefore becomes the default path, which is the opposite of what the policy intends. | DIRECT (this report's push) |

#### What is working and must not be re-litigated

Capacity resolvers goal-sealed at compile time (falsified). Decay-confidence-not-value implemented exactly (verified numerically). Readiness never touches capacity. Heat modifies interpretation only; durability excludes hot runs. One race does not rewrite the exponent (0.94% from an A-race; shrinkage real). Rule 8 applied and split correctly in the plan's ramp base. Sealed-row immutability proven by production data. `ownedDaysSql` reign fix verified on the exact dates. Zero-mutation shadow path proven by the only write and by in-band checksums. Phase-aware PACE grouping, the five-state machine, compound-lever withdrawal, the four-state convergence guard, honest CONVENTION labelling of the lookback constants, the stability tool's read-only posture. The `_race_projection`, `check-goal-immutability`, `check-doctrine`, `check-normal-window`, `check-client-graph` and `check-coercion` (scan) gates all failed correctly when falsified. Rule 23's founding instance is closed (both crons ensure `reanchorLthr` themselves) and the in-process heartbeat has fixed punctuality. `plan_workouts.workout_spec`'s Rule 6 guard is real and used by all six writers. The citation scrub is correct on every live note. The block does not chase the 3:00 goal.

---

### 12 · KEEP / FIX / MERGE / SIMPLIFY / DELETE

| Decision | Target | Why |
|---|---|---|
| **KEEP** | `capacity-resolver.ts` (four resolvers, goal seal, confidence model), `durability-anchor.ts resolveRaceExponent`, `race-projection.ts`, `recompute-paces.ts` / `reanchor-plan.ts` as the flex-path owner, `normal-window.ts`, `authoring-convergence.ts`, `shadow-compare.ts`'s zero-mutation design, the five-state adaptation machine, `pace-hr-evidence.ts` (real work-segment HR), `heat-adjustment.ts`, `runner-state.ts`, `preserveProgressionSql`, `strip-citations.ts`, `verify-commit.sh`, the stability tool | Verified real, correctly bounded, and the things this migration got right. |
| **FIX** | `recompute-paces.ts:322` — remove `race` (and `race_week_tuneup`) from `RECOMPUTE_EXEMPT_TYPES` so race rows re-price with the block, or make the race-day target consume `resolveRaceProjection`/`achievableRaceTarget` at read time | N-1. Decide the race number first (§14 B). |
| **FIX** | One exported `sessionToleranceSec(kind)` consumed by `today/route.ts:1514`, `spec-card.ts:382`, `build-workout.ts:1706`, `goal-projection.ts:1161/1246`, `run-state.ts:1564`, `training-influence.ts:101`; a test that fails when any stops calling it | N-2, §6 (five tolerances for one number). |
| **FIX** | Wire `paceShape: 'ceiling' | 'window'` onto watch phases; the watch grades a ceiling as "under", never as a band; grade reps on segment average with a stated settle window, not instantaneous samples | N-3. |
| **FIX** | `easy-discipline.ts:756` — scope to the active plan's nearest upcoming easy row; widen `ACTIVEPLAN-1` to any user-scoped `plan_workouts` read without a plan pin | N-4, G-1. |
| **FIX** | `pace-corpus.ts thresholdSegmentFromPhases` — reject `completed === false`, gate on the LTHR band (as the easy reader does), consult `classifyActivityEvidence`'s weight and `anchorMoveCandidate`, cap a single session's move; `accumulateReexamination` — relax only on `stronger`, never `weaker`; compute tension off the corpus's phase pace, not mile splits; smooth `THRESHOLD_MIN_SESSION_TOTAL_SEC` | N-5. |
| **FIX** | `coaching-thesis.ts rankCapacities` — a capacity with no direct reader is UNRANKABLE, not scored off an unrelated anchor's age; then wire the thesis to `/api/v5/today` and to the Plan Generator (its intended consumer), or delete it | N-6. |
| **FIX** | `lib/coach/limiter.ts` — consume `resolveRaceExponent`; delete `fitRiegelExponent` | N-7. |
| **FIX** | `race/[slug]/route.ts:191` — run the durability blend for goal-less races; `effective-race-target.ts:114` — clamp off `resolveRaceProjection`; `proposals-state.ts` — re-resolve the outlook number at read time or label it as a snapshot | N-8, N-9, N-22. |
| **FIX** | `run-recap.ts:593` — three arms (above / in / below band, via `threshold-band.ts` taking LTHR); `drift-monitor.ts:695` — `COALESCE(hr_target_bpm, lthr_bpm)`; `WorkoutEngine.swift shouldOfferBailNow` — evaluate `metric/op/value` or drop the HR wording; race `abort` rules — draw or delete | N-10, N-11. |
| **FIX** | `reconstruct.ts establishedPaceFor` — price from the canonical anchors (or delete the grader's own fitness table); one `resolveCurrentVdotSnapshot()` with a staleness posture replacing six copies | N-12. |
| **FIX** | `interpret.ts:213` — three states (no row yet / prescribed and not run / ran); `readConsistency` on the filtered side of the Rule 8 fork and never `0/planned` on an un-ingested week; `contradictionsIn` converse clause (a HOLD carrying `ABSORPTION_POOR` must have had absorption to read); a `deferred` column on the shadow log and a refusal on it; a continuity walk over the *decision* across the lookback step | N-15, §8 blockers B–D. |
| **FIX** | Per-job workflows call `isDue` (or only the tick fires them); `EXCLUDED_FROM_TICK` jobs still get staleness watched; ack the nine stale `cron_stale` rows; `authored_state` writers merge (`reanchor-plan.ts:659`) | N-16, N-17, N-18. |
| **FIX** | Gates: `EMPTIED_BASELINE` keyed on `file::symbol`; `check-coach-voice.sh` scope adds `lib/plan`, `lib/watch`, `lib/execution`, `lib/prescription`, `lib/race`, `lib/today`; `check-automatic-mutations.sh` per statement; `HANDED_BACK_FAILS` guard moved *under* the assertion (or the seven sites owned); `check-doctrine.sh` prints recorded violations and fails on runner-facing ones; older gates hard-fail without vitest; `allowFileFallback` defaults false; `_activity_evidence.audit.test.ts` branches on the row's actual state | G-1, G-2, G-4, G-7, G-8. |
| **FIX** | CI: a workflow that runs the full `vitest run` on every push to `main` (or, at minimum, `lib/adaptation/**`, `lib/training/**`, `lib/plan/**`); make the canary runtime gate falsifiable inside it | G-3, §8. |
| **MERGE** | `canonical-authoring-migration-20260901` (code only; report corrected as §7 lists) | Additive, shadow-only, clean merge, genuinely useful apparatus. |
| **MERGE after revision** | `cold-start-prior-fix-20260901` — blend by representative-day coverage, add the typed-PR rung or an explicit decision against it, distinct reason for "answered zero" | §7. |
| **MERGE after hardening, keep OFF** | `pace-canary-infrastructure-20260901` — snapshot inside the transaction, gate falsifiable in `npm test`, `ops_alerts`, gated rollback with an invocation path, row cap, rate limit not reset by rollback, scope constant in code | §8. Landing is low-risk; enabling is not. |
| **SIMPLIFY** | HR: one aerobic-ceiling owner (`aerobicCeilingBpm` wrapped by `hrCapEasy`; delete `hrCapLong`; `resolveHrCeiling` and `aerobicCapBpm` call it); threshold-band edges derived from `FRIEL_7_ZONE_EDGES` so `thresholdPassHrBpm`, `THRESHOLD_HR_CEILING_OF_TARGET` and `pace-hr-compatibility` agree by construction; one field for expected quality HR; race HR in its own field, ungraded as an aerobic cap; one LTHR↔HRmax crosswalk | §10 (eleven numbers → four meanings). |
| **SIMPLIFY** | `generate.ts`: collapse the three `resolveCurrentTPace` computations to one `resolvePrescribedPaceAnchors` call; delete the goal→pace class (e) entirely when authoring migrates | §7. |
| **SIMPLIFY** | Grading: one completion grader (60% / ±25% / 40% → one), one HR-cap grace, one "today's row" picker (the watch's ordered one) shared by the phone | N-19. |
| **DELETE** | `coach-goal.ts fitPersonalExponent` once the paused web Targets route is retired or re-pointed; `simulator.ts`'s A/B/C as a projection source in `gap-report.ts`; `hrCapLong`; the four dead `MODULE_ORPHANS` entries (`lib/plan/core.ts`, `lib/strava/streams.ts`, `InlineGapEditor.tsx` + `ProfileGapInput.tsx`, `state-tokens.ts`); the three write-capable root probe scripts (`_diag_jun9_fix.mjs`, `_diag_elev_fix_jun18.mjs`, `_backfill_jul9_write.mjs`) and the other 78 root probes; `AGENTS.md`'s stale content (replace with a pointer to `CLAUDE.md`); the false header sentences in G-9; `pass` rules on interval rows (or the whole `pass` rule if only `goal-projection.ts:881` reads it) | Constitution §26: prefer deletion. |
| **DELETE (data, needs go)** | `plan_workouts` / `plan_weeks` / `plan_phases` rows of archived plans (4,123 rows), after the wrong-plan readers are scoped | S-6. Destructive; per-statement go required. |

---

### 13 · Prioritized execution plan

**A** = can proceed autonomously under the standing autonomy rules · **D** = needs a product decision first (see §14) · **G** = needs David's explicit go (DDL, data, env).

#### Immediate live correctness

| P | Item | Impact | Owner / path | Change | Deps | Risk | Verification | A/D/G |
|---|---|---|---|---|---|---|---|---|
| 1 | Race row re-prices with the block | Runner rehearses 3:27 and is asked to race 3:10 from week 8 | `lib/plan/recompute-paces.ts:322`; `spec-builder.ts` race branch | Remove `race`/`race_week_tuneup` from `RECOMPUTE_EXEMPT_TYPES`, re-derive `pace_target_s_per_mi_lo/hi` and race HR from the canonical anchors on each recompute | §14 B (which race number) | Medium: moves the only row the runner will race off | Falsify: prove the race row is untouched today, then touched after; render the CIM race card on the phone against production; assert MP rehearsal pace and race band within one doctrine-cited spread | D then A |
| 2 | One tolerance | Same session reads "on target" on phone, amber on wrist (6 live rows) | `lib/training/prescriptions.ts` (new `sessionToleranceSec`), `app/api/v5/today/route.ts:1514`, `lib/training/spec-card.ts:382`, `lib/watch/build-workout.ts:1706`, `goal-projection.ts:1161/1246`, `run-state.ts:1564`, `training-influence.ts:101` | One exported function, every site calls it, a test that greps for literal `8`/`10`/`12`/`15`/`20` tolerances and fails on any | none | Low | Falsify by re-adding a literal; build the watch payload and the today payload for the owner's 09-08 tempo row and assert equal bands | A |
| 3 | Watch ceiling semantic + average-based rep verdicts | Perfect sessions graded "missed" | `lib/watch/build-workout.ts` phases (`paceShape`), `WatchWorkoutModels.swift`, `WorkoutEngine.swift:1715-1729` | Ceiling phases grade "under/over the ceiling" only; work phases graded on segment average against the band with a stated settle window | none | Medium (watch ship) | Replay today's real phases through the new verdict function and assert 4 hits + WU/CD under-ceiling; Rule 13: run on the simulator | A (TF ship needs go) |
| 4 | Easy-discipline plan scope | 3 of 7 users graded against a dead plan | `lib/coach/easy-discipline.ts:756`; `lib/audit/_active_plan_scan.test.ts:60` | Join the active plan, nearest upcoming easy row; widen the scanner to any user-scoped `plan_workouts` read without a plan pin | none | Low | Falsify the scanner with the verbatim Rule 14 query; re-run the seven-user production comparison and assert `picked_lo = active_lo` for all | A |
| 5 | Threshold corpus admission | Threshold anchor moved 10 s/mi in a day off one session; abandoned HR-less treadmill is half the belief | `lib/training/pace-corpus.ts thresholdSegmentFromPhases`, `lib/evidence/reexamination.ts accumulateReexamination`, `capacity-resolver.ts` pass 2 | Reject `completed:false`; require in-band HR (or weight by `hrBandDistance`); consult `classifyActivityEvidence` weight / `anchorMoveCandidate`; per-session move cap; relax only on `stronger`; tension from phase pace; smooth the 1200 s floor | none | Medium: changes the live threshold anchor and therefore every quality pace on the next recompute; must be replayed | Historical replay across the owner's season (Enforcement §12): plot the anchor day by day before/after; assert 07-16 and 08-06 leave the supporting set; assert the 09-01 session moves the anchor by ≤ the cap; falsify each gate | A (replay gates it) |
| 6 | Zero-run HOLD collapse | Three accounts told their block "is not being absorbed"; owner exposed to a sync outage | `lib/execution/interpret.ts:213`, `lib/adaptation/adaptation-model.ts readConsistency/readExecution`, `adaptation-engine.ts contradictionsIn` | Third state for "no row yet"; unknown sessions dropped from the mean; consistency filtered and never `0/planned` on an un-ingested week; converse contradiction clause | none | Low (shadow only today; `progression-pass` is live for the unfiltered reader — verify byte-identity for the owner) | Falsify against today's three production rows (must go red, then INSUFFICIENT_EVIDENCE); re-run the 90-date dual log and diff | A |
| 7 | Recap and drift-monitor HR bands | "soft lead" recommendation off a session that never reached intensity; threshold sessions invisible to HR corroboration | `lib/coach/run-recap.ts:590-598`, `lib/training/threshold-band.ts`, `lib/plan/drift-monitor.ts:695` | Three arms; band taken from LTHR; COALESCE both spec fields | §14 C (enforcement band) for the compatibility validator only | Low | Run `deriveRecap` on the owner's 09-01 and 08-30 shapes and assert the sentences; unit tests for all three arms | A |
| 8 | Bail / abort semantics on the wrist | HR-worded board raised by pace; safety stop inert | `legacy/native/Faff/FaffWatch Watch App/WorkoutEngine.swift:1997`, `WatchWorkoutModels.swift:87-116`, `lib/watch/build-workout.ts splitRuleRegisters` | Evaluate `metric/op/value` against `tracker.heartRate` (the `hrOverCeiling` shape at `:1101`), or ship pace-worded evidence for a pace trigger; draw abort boards | none | Medium (watch) | Simulator replay with synthetic HR; Rule 13 render | A (TF ship needs go) |
| 9 | No-goal race projection, watch race target, outlook card number | 43:38 above A 44:15 twelve days out; 160 s of CIM pacing; stale 3:30:13 card | `app/api/v5/race/[slug]/route.ts:191`, `lib/race/effective-race-target.ts:114`, `lib/plan/proposals-state.ts:439` | Blend for goal-less races; clamp off `resolveRaceProjection`; re-resolve at read time | none | Low | Extend `_race_projection.test.ts` to these files; re-run the §9 matrix and assert one number per surface per race | A |
| 10 | `limiter.ts` exponent | Coaching advice names "threshold" while durability is the limiter | `lib/coach/limiter.ts:433`, `lib/plan/goal-gap.ts:678` | Consume `resolveRaceExponent`; delete the local fit | none | Low | Assert `goalGap.limiter` on the owner reads the durability read's shape finding | A |
| 11 | Cron double-run and readiness overwrite | Morning score is the afternoon recompute | `.github/workflows/*.yml` (per-job), `app/api/cron/*/route.ts`, `lib/ops/cron-ledger.ts` | Route every scheduled call through `isDue`; readiness-snapshot writes once per day unless forced | none | Low | Count `cron_ok` per source per day = 1 for a week; readiness `computed_at` ≤ 09:00 local | A |
| 12 | Execution grader anchor | Wrong "comfortable before at …" number; biased fitness-evidence findings | `lib/execution/reconstruct.ts:557`, six `currentVdot` copies | Price from canonical anchors; one snapshot reader with staleness | 5 | Low (finding types have never fired) | Unit tests at VDOT 40/50/65 against the table; production replay of `coach_log_fitness_evidence` candidates | A |

#### Migration completion

| P | Item | Path | Change | Deps | A/D/G |
|---|---|---|---|---|---|
| 13 | Merge the migration branch (code), correct its report | `origin/canonical-authoring-migration-20260901` | Fast-forward-safe merge; fix §7's five report errors; `skipIf` → hard requirement; Rule 22 sentence | none | A |
| 14 | Revise and merge the cold-start branch | `capacity-resolver.ts priorWeeklyMi`, `_capacity_resolver.test.ts 3e-3` | Coverage-weighted blend; continuity walk; typed-PR rung or decision; "answered zero" reason | §14 D | D then A |
| 15 | Convergence guard: `CANNOT_CONVERGE_NO_MEASURED_VDOT` | `lib/adaptation/authoring-convergence.ts`, `reanchor-plan.ts:289` | New state; `ops_alerts` when a live plan has been in it > 7 days | none | A |
| 16 | Delete the authoring goal blend, gate goal→pace leakage | `generate.ts:8997-9110, 14160`, `scripts/check-goal-immutability.sh` | Remove class (e); scanner for any pace derived from `goalSec` outside `achievable-target.ts` | 13 | A (Constitution §G is settled doctrine) |
| 17 | Switch authoring to `resolvePrescribedPaceAnchors` | `generate.ts composePlan`, `persistComposedPlan`, `loadGeneratorInputs` | One anchor call replacing 14 lines of duplicate authority; archetype sweep + continuity walk | 14, 15, 16; a `CANNOT_CONVERGE` population must be handled first | D (switch-over is a product call per the branch's own §8) |

#### Adaptation canary preparation

| P | Item | Path | Deps | A/D/G |
|---|---|---|---|---|
| 18 | Rulings on recovery-window PACE evidence, deferred proposals, enforcement HR band, phase scope | — | — | **D** (§14 A, C, E) |
| 19 | `deferred` column + refusal; continuity walk over the decision at the lookback step (falsified red first); recovery-window-excluded corroboration count logged per cycle | `db/migrations/16x` (additive), `shadow-compare.ts`, `_normal_window.test.ts:329` | 18 | G (DDL) then A |
| 20 | Canary hardening (§8 list) and a CI job that runs its harness against a scratch DB | canary branch | 19 | A |
| 21 | 14 consecutive clean production days meeting §8 criteria; stability tool verdict `READY` | — | 6, 19 | wait |

#### Product / UX cleanup

| P | Item | Path | A/D/G |
|---|---|---|---|
| 22 | HR simplification (§10 owner table): five ceilings → one, four band tops → two edges, race HR field, one expected-HR resolver, `HRAlerter.swift` fixed before its toggle is wired | `zones.ts`, `spec-builder.ts`, `build-workout.ts`, `prescriptions.ts`, `easy-discipline.ts`, `threshold-band.ts`, `pace-hr-compatibility.ts`, `HRAlerter.swift` | A (after §14 C) |
| 23 | Rule 17 on Today and in the composer: block-level downhill note, one pace-band formatter, one distance, ceiling not band on the panel, de-dup on the wire not in one renderer | `generate.ts:5127`, `spec-card.ts:506-549`, `today/route.ts:1711`, `v5-today.ts:1084` | A |
| 24 | Rationale and thesis reach the runner: backfill `selection_rationale` on the live plan via the next recompute; wire the thesis (after item 5's ranking fix) into Today's "why" | `recompute-paces.ts`, `coaching-thesis.ts`, `why-voice.ts` | A |
| 25 | Goal-outlook re-nag materiality (`PROJECTION_NOISE_GRACE_VDOT` + status rung) | `lib/plan/goal-outlook.ts:210` | A |
| 26 | Durability anchor selection weighted by recency × grade; `RIEGEL_MAX_DISTANCE_MI` tolerance | `durability-anchor.ts:620-659` | A |
| 27 | Gate repairs (G-1, G-2, G-4, G-7, G-8) and CI full-suite run (G-3) | `scripts/check-*.sh`, `lib/audit/*registry.ts`, `.github/workflows/` | A |
| 28 | Ops: staleness for excluded jobs, ack the stale alerts, decide `OPS_SLACK_WEBHOOK_URL`, `.env.example` truth, `NODE_ENV` boot assertion | `lib/ops/cron-ledger.ts`, `app/api/cron/tick/route.ts`, `.env.example`, `instrumentation.ts` | A + G (env) |
| 29 | Delete: dead orphans, root probes, stale `AGENTS.md`, false headers, `hrCapLong`, `fitPersonalExponent` (with the paused route) | see §12 | A (probes: confirm first) |

#### Deferred ideas

Evidence-coverage scoring (`docs/design/plan-evidence-coverage-2026-08-31.md`); a direct high-intensity reader (the thesis is not meaningful for HI until one exists); a trajectory-specific confidence band; per-rep ladders for cutdown sessions; `plan_workouts` archived-row retention (needs a data-go and the readers scoped first); the `restS / 540` mileage constant → shakeout ceiling.

---

### 14 · Exact blockers and decisions needed

Only questions that doctrine, evidence, or code cannot settle.

- **A · Is a quality session run inside a prescribed post-race recovery window admissible as PACE capability evidence?** The loader argues yes (`load-adaptation-engine.ts:55-63`: filtering it out "would DESTROY evidence"); Rule 8 and the sibling `historicalTolerance` argue no. Today's PACE proposal exists only under "yes" (4 sessions vs 2). Both readings are defensible; the answer decides whether there is anything to canary this month.
- **B · Which number is race day?** The block prescribes 475 s/mi (7:55) for every marathon-pace rehearsal from the runner's own durability exponent, and 436 s/mi (7:16) on the race row from a frozen `achievableRaceTarget` clamp that is 24 s/mi off the 3:00 goal pace training must never chase. The three-tier design was blessed at 7:56 / 7:41; it is now 7:55 / 7:16. Either the race target moves toward the evidence, or the rehearsals move toward the target, or the design is re-stated with a bounded spread. This is the single most consequential coaching call in the block and it must be made before week 8 (2026-10-19).
- **C · Which HR band is the enforcement band?** The Friel Z4 band (`160–167`) is both "display-only, never enforced" (hr-semantics report) and the refusal threshold of the validator that gates live PACE authority (`pace-hr-compatibility.ts:234`). Either it is enforceable and the display copy says so, or the validator needs an LTHR-based band. Related: threshold band top = 167, 168, 171.4 or 164 — pick two edges.
- **D · Does a typed onboarding PR price a plan?** Legacy `PARITY-1` says yes (`profile.race_history`); the canonical ladder has no rung. It is the residual 101 s/mi on cold-start accounts. A `user_prior` VDOT rung, or an explicit "no".
- **E · May a canary write phases beyond the nearest one, and may a DEFERRED proposal ever be mutable?** Recommendation: no and no. Needs a written ruling because the current log records the deferred TAPER move as PROGRESS.
- **F · Environment facts only David can read:** is `OPS_SLACK_WEBHOOK_URL` set on Railway (decides whether nobody looks or nothing tells anyone)? Is Railway app-sleeping enabled (decides whether the in-process scheduler's dependence on `keep-warm` is real)?
- **G · Destructive or data actions needing a go:** deleting the three write-capable root probe scripts; deleting 4,123 archived-plan `plan_workouts` rows; the additive `deferred` migration; acknowledging the nine stale alerts.

---

### 15 · Suggested next brief

Paste-ready. Executes the autonomous items in §13; stops only at the decisions in §14.

> **Brief — live coaching correctness pass, post-audit (2026-09-01)**
>
> Base: `origin/main` (fetch first; fast-forward only; never force). Work in an isolated worktree created **from `main`**, and verify `git rev-parse HEAD` and `ls web-v2` before reading code — the Agent tool's default worktree base is the stale `claude/build-runcino-app-OIRJr` line. Read `CLAUDE.md`, `docs/BRAIN_CONSTITUTION.md`, and `docs/reports/independent-coaching-system-audit-2026-09-01.md` §11–§14 first. Production access is `DATABASE_URL_RO` only; every audit test pins `DATABASE_URL` to the RO URL. No live Adaptation Engine mutation, no goal changes, no history rewrites, no DDL without a per-statement go.
>
> **Execute, in order. Each item: falsify the check against the unfixed code first (Rule 18), fix, verify by rendering or executing against the owner's real data (Rule 13), commit, push, confirm the Railway deployment reaches `SUCCESS` (Rule 19), then move on.**
>
> 1. **Tolerance.** Add `sessionToleranceSec(kind)` to `lib/training/prescriptions.ts`; make `app/api/v5/today/route.ts:1514`, `lib/training/spec-card.ts:382`, `lib/watch/build-workout.ts:1706`, `lib/training/goal-projection.ts:1161,1246`, `lib/coach/run-state.ts:1564,1584`, `lib/training/training-influence.ts:101` call it. Add `_tolerance_owner.test.ts` that fails on any literal tolerance outside the owner. Prove: build the owner's 2026-09-08 tempo row through `buildWatchToday` and `/api/v5/today` and assert identical bands.
> 2. **Easy-discipline scope.** Rewrite `lib/coach/easy-discipline.ts:756` to the active plan's nearest upcoming easy row (join `training_plans … archived_iso IS NULL`, `date_iso >= today ORDER BY date_iso ASC`). Widen `lib/audit/_active_plan_scan.test.ts:60` to flag any user-scoped `plan_workouts` read with no plan pin; plant the verbatim Rule 14 query and watch it fail. Prove: re-run the seven-user comparison read-only; all `picked_lo = active_lo`.
> 3. **Zero-run HOLD.** `lib/execution/interpret.ts:213`: return `NOT_YET_OBSERVED` when no run row exists and the day has not passed or ingest is younger than the session; `lib/adaptation/adaptation-model.ts readExecution` drops unknown sessions from the mean; `readConsistency` ignores weeks with zero ingested runs and moves to the filtered side in `load.ts loadRepresentativeExecutionInput`; `adaptation-engine.ts contradictionsIn` gains `HOLD_CLAIMS_ABSORPTION_WITHOUT_EVIDENCE`. Prove: the three production rows (`apple-review`, `qa-beginner`, `qa-goal`) go red under the new clause, then resolve to `INSUFFICIENT_EVIDENCE`; the owner's live `progression-pass` output is byte-identical before/after (this reader is live).
> 4. **Threshold corpus.** In `lib/training/pace-corpus.ts thresholdSegmentFromPhases`: skip phases with `completed === false`; require pooled HR inside `THRESHOLD_PCT_LTHR_BAND` when HR exists (mirror `classifyEasyCandidates`); attach `classifyActivityEvidence`'s threshold weight and `anchorMoveCandidate` to each `PaceObservation`; in `capacity-resolver.ts composeThresholdCapacity` cap any single session's contribution to the anchor at one doctrine quantum (`PACE_STEP_S_PER_MI`) per day; in `lib/evidence/reexamination.ts accumulateReexamination` relax the corroboration floor only when `direction === 'stronger'`; compute belief tension from the corpus's phase pace. Smooth `THRESHOLD_MIN_SESSION_TOTAL_SEC` (linear weight 900–1200 s). Prove with a historical replay (`docs/DOCTRINE_ENFORCEMENT… §12`): day-by-day threshold anchor for the owner from 2026-06-01 → today, before and after; assert 2026-07-16 and 2026-08-06 leave the supporting set, 2026-09-01 moves the anchor ≤ the cap, and no day moves more than the cap. Report the replay table in the handback.
> 5. **Thesis ranking.** `lib/training/coaching-thesis.ts rankCapacities`: a capacity whose only source is `vdot_fallback`/`population_prior` is `UNRANKABLE` with reason `NO_DIRECT_READER`, never a numeric rank. Prove: the owner's thesis is stable across 2026-08-31 → 2026-09-01. Do not wire it yet.
> 6. **Recap HR arms.** `lib/coach/run-recap.ts:590-598` three arms via `threshold-band.ts` taking `lthr` (add the parameter; `drift-monitor.ts:695` COALESCEs `hr_target_bpm, lthr_bpm`). Prove by running `deriveRecap` on the owner's real 2026-09-01 and 2026-08-30 shapes and pasting the sentences.
> 7. **Race prediction consumers.** `app/api/v5/race/[slug]/route.ts:191` runs the durability blend for goal-less races; `lib/race/effective-race-target.ts:114` clamps off `resolveRaceProjection`; `lib/plan/proposals-state.ts:439` re-resolves the outlook number; `lib/coach/limiter.ts` consumes `resolveRaceExponent` and `fitRiegelExponent` is deleted; extend `lib/training/_race_projection.test.ts` to every file in the audit's §9 consumer list. Prove: re-run the §9 matrix script against production; one number per surface per race; Santa Monica "Projected" ≥ coach-set A.
> 8. **Cron double-run.** Every per-job workflow calls the route with `?via=schedule` and the route consults `isDue` before running; `readiness-snapshot` refuses a second write on the same `snapshot_date` unless `force=1`. Prove over three days: one `cron_ok` per source per day.
> 9. **Gates.** `lib/audit/swallowed-failure-registry.ts` ratchet keyed `file::symbol`; `scripts/check-coach-voice.sh targets()` adds `web-v2/lib/plan web-v2/lib/watch web-v2/lib/execution web-v2/lib/prescription web-v2/lib/race web-v2/lib/today` (expect it to go red on `generate.ts:5127/7016` and `block-preview.ts:192`; fix the copy); `lib/audit/_coercion_scan.test.ts:367` moves the `HANDED_BACK_FAILS` guard under the assertion and the seven sites get owners (start with `generate.ts:4544`: refuse, never silently drop the 3-hour cap); `check-automatic-mutations.sh` per-statement; `check-doctrine.sh` drops `--silent` and fails on any recorded violation tagged runner-facing; older gates hard-fail without vitest; `shadow-compare.ts persistShadowCompareRecord` `allowFileFallback` defaults `false`; `_activity_evidence.audit.test.ts` branches on the row's live `splits_unreliable`. Falsify every one both ways and paste the failing output.
> 10. **CI.** Add `.github/workflows/test-full.yml` running `npx vitest run` in `web-v2` on every push to `main` (RO-gated audit tests skip cleanly without credentials — confirm they skip, not pass). Watch it green.
> 11. **Merge `origin/canonical-authoring-migration-20260901`** (code) after correcting `docs/reports/canonical-authoring-migration-2026-09-01.md` per the audit's §7. Fast-forward only.
> 12. **Headers and artifacts.** Delete the false sentences listed in the audit's G-9; replace `AGENTS.md` with a three-line pointer to `CLAUDE.md`; remove `authoring-convergence.ts:13`'s "32 across 19 lines"; add `CANNOT_CONVERGE_NO_MEASURED_VDOT` to the convergence guard with an `ops_alerts` raise after 7 days.
>
> **Do not do without a decision (report as blocked, with the evidence):** race-day number (§14 B — but prepare the change to `RECOMPUTE_EXEMPT_TYPES` behind a constant so it is a one-line switch); enforcement HR band (§14 C); typed-PR prior rung (§14 D); anything that writes the canary tables; deleting probe scripts or archived plan rows.
>
> **Tests required:** every new gate falsified in both directions with output pasted; `npx tsc --noEmit` clean; full `vitest run` with the count of passed/failed/skipped and the name of every failing file (do not describe a rerun that passes as a root cause); the 17-script prebuild chain; `scripts/verify-commit.sh <sha>` on every commit pushed with `--no-verify`, with the seven-condition disclosure.
>
> **Deployment verification:** after each push, `railway deployment list` shows `SUCCESS` for that commit hash; `gh run list --workflow=build-check.yml` success; a health probe of `/api/v5/today` for the owner over the RO role reflects the change (e.g. the tolerance band).
>
> **Production checks (read-only) to include in the handback:** the seven-user easy-band comparison; the threshold-anchor replay table; the shadow-log rows for the days elapsed with `deferred`/`recovery-excluded` columns if the migration was approved, or a statement that they were not; the `cron_ok` per-source-per-day count; the §9 matrix re-run.
>
> **Handback format:** one file, `docs/reports/live-correctness-pass-<date>.md`, sections: (1) what shipped, commit by commit, with Railway deployment ids; (2) what was falsified, with the failing output; (3) what was rendered or executed on real data, with the numbers; (4) what changed for the runner, in one paragraph he can read; (5) what was blocked and why, quoting the §14 letter; (6) anything discovered that this brief did not name. No claim of "done" for anything not deployed and verified.
