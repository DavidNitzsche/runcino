# CORRECTED v2 — faff.run Brain, Evidence, Learning & Adaptation Forensic Audit
## Correction pass on the 2026-09-10 FINAL report, incorporating Coach-audit and Runner-Data-audit reconciliation

---

## HOW TO READ THIS DOCUMENT

This is a **correction pass**, not a re-run. It amends `docs/audit-2026-09-10-brain-adaptation-forensic-audit-FINAL.md` (v1, commit `c99d924ea`) in place of nine specific, named defects the requester identified in v1, plus reconciles 17 additional findings surfaced by two parallel audit tracks (a "Coach audit" and a "Runner Data audit") running concurrently in this same repository. Every correction below traces to a fresh, independently-dispatched investigation completed after v1 shipped — none of this is re-assertion of v1's own claims. Sections not listed in the correction log are UNCHANGED from v1 and are not reproduced in full here; read v1 alongside this document.

**Evidence tags**, used precisely per the requester's own distinction: **[SRC]** (source, file:line), **[PROD-RO]** (a query actually run against `faff_readonly`), **[TEST]** (real, unmodified production code actually executed against real data — NOT the same as a UI render), **[RENDER]** (an actual screen, actually observed — pixel-level, via simulator or device), **[INF]**, **[BLOCKED: reason]**.

---

## SHORT CORRECTION LOG

| # | v1 defect | What changed in v2 |
|---|---|---|
| 1 | Claimed the §9 UI dispute was "settled"/"closed" using [TEST] evidence as if it were [RENDER] | Reclassified. The source-ROUTING question is closed by [TEST]. The runner-visible PIXEL result remains [BLOCKED: not rendered]. Every "resolved"/"closed" statement about the display itself is walked back. |
| 2 | "Learn from it: YES" | Replaced with six separate per-stage verdicts (observe / classify / compute / persist-durable-belief / change-behavior / explain). None reach "complete loop" status. |
| 3 | Called `mark_upgrade` (VOLUME) "live," implying it functions | Corrected: **ACTIVELY BLOCKED**, not merely reachable. Full 9-step trace included, ending in a real rollback+refusal caused directly by Migration 166's table absence. This reconciles with, and confirms, the contradiction flagged from the Main Agent. |
| 4 | Called automatic pace re-anchor "auto for re-anchor," exempted implicitly by calling it calibration | Corrected: real, live, ungated side door. `reanchorLthr` has zero authority parameter; at least 3 of 5 call sites are bare unattended cron entry points; the mutation-boundary gate is structurally blind to it (wrong table). "Calibration not adaptation" holds only as current behavior, not as an enforced boundary. |
| 5 | "Twice historically" / vague historical-mutation language | Full enumeration below: **6 individual mutation events across 5 distinct mechanisms**, exact dates, before/after values, scope, and audit-trail status for each. A previously-unknown **5th mechanism** (2026-09-03 "silent rebuild") was found and confirmed. |
| 6 | Recovery P0 severity ambiguous re: release-blocking | Explicit: **YES, blocks the next TestFlight candidate unless explicitly waived.** Required test matrix specified (7 cases). |
| 7 | State-predicate ledger's "completed" called safely-routed by design; race-week called a benign 3-way split | Corrected via independent falsifier: "completed" has **one real misrouted consumer and one partially-misrouted consumer**, not zero. Race-week has **two of its three implementations giving conflicting answers to the identical named doctrine quantity** (a real Rule 16 violation, with proof), not three benign different questions. |
| 8 | §11 TestFlight conclusion | Rewritten. Recovery P0 blocks. Two render-dependent questions stay open. Internal-availability vs. physical-verification-safety now distinguished. |
| 9 | No provenance section | Added, §14 below. |
| Coach-1–9 | New — items from a parallel "Coach audit" track | 4 CONFIRMED (one real new Brain-boundary side door, one doctrine violation, one duplicated-judgment defect, one partial proposal-state collapse), 2 CONTRADICTED (both findings favorable — tune-up taper and race-projection unification both check out clean) |
| RD-1–8 | New — items from a parallel "Runner Data audit" track | 6 CONFIRMED (one is a **live instance of a previously-believed-fixed bug on the dominant write path**), 1 CONTRADICTED (a false detail — 2 senders not 3 — inside an otherwise-confirmed mechanism), 1 CONFIRMED as a correction to v1's own §5/§6 inventory (`recoveryExtensions`/`ceilingLift` moves from "unused" to "surfaced") |

---

## 1. RENDER STATUS — CORRECTED

**v1 overstated this. Corrected verdict below.**

What was actually done: a prior track [TEST]-executed the real, unmodified `resolveWorkoutVerdict()`/`routePhases`-construction against today's real run data (via a throwaway harness, deleted after, `git status` confirmed clean) and got a 14-entry, fully-populated `sectionPieces` array. A second, independent falsifier pass reproduced this exactly. **This is [TEST] evidence: real code, real data, executed outside the actual running application, with no screen ever rendered.**

What was attempted and failed: an actual [RENDER] attempt (build the real app, install to simulator, authenticate as David, view the real Today screen for this run) was tried and **could not be completed** — `[BLOCKED: sessions.session_token stores only a SHA-256 hash of the bearer token; no plaintext token is recoverable from a read-only DB dump by design, and no offline/token-free Today-equivalent harness exists in the codebase (unlike Run Detail and Proposals, which do have one)]`. This is a hard cryptographic wall, not an effort shortfall.

**Correct statement of what is and is not resolved:**
- **CLOSED, by [TEST]**: which code path is *selected* — `sectionPieces` (paced) fires, `workoutPhasePieces` (pace-less fallback) does not. The original stale-comment diagnosis in `TodayAfterV5.swift` is confirmed stale.
- **STILL OPEN, `[BLOCKED: not rendered]`**: what the runner's actual screen looks like — exact rendered text, font, layout, whether any string resembling "not completed" appears anywhere on the real screen for any reason unrelated to the routing question, whether stride pace displays correctly at real device scale, whether the "Under the ceiling" label and 521 s/mi pace actually paint as expected. **No claim of "resolved," "settled," or "closed" about the display itself survives this correction** — every such sentence in v1 (executive verdict, §9 discussion, §12 finding #2) should be read as "the routing question is closed; the display itself remains unverified."

---

## 2. LEARNING VERDICT — CORRECTED, six separate stages

v1's single "Learn from it: YES" is retracted as a global claim. Below are six separate verdicts. **Green marks a criterion the system genuinely satisfies; the pattern is deliberately not uniform.**

| Stage | Verdict | Evidence |
|---|---|---|
| **Observe** (ingest, canonicalize, dedup) | **YES** — real, live, durable | `[SRC]`/`[PROD-RO]`, unchanged from v1 |
| **Classify** (evidence admissibility, credibility, execution identity) | **YES, with confirmed gaps** — real and live for the mainline path, but two genuine side doors now confirmed: `load-activity-evidence.ts`'s date-only intent match (bypasses `day-resolver.ts`), and the still-live symmetric `[0.7,1.3]` distance band on the *primary* watch-completion write path (the asymmetric fix only reached the secondary ingest route) | `[SRC]`, this pass |
| **Compute** (shadow proposals: PACE/VOLUME/DURATION) | **YES** — real, falsification-tested, executes daily against real data | `[SRC]`+`[PROD-RO]`, v1 unchanged |
| **Persist a durable belief change** | **PARTIAL, and narrower than "learning" implies.** The only mechanism that durably changes a stored belief on its own is the LTHR/pace re-anchor (`reanchorLthr`) — and this is **not** the adaptation-decision pipeline; it's a separate, ungated calibration write (see §4). Shadow-log PROGRESS rows (8 for PACE) are **not** persisted as belief changes — they're log entries about a hypothetical. VOLUME/DURATION's two historical real belief changes (§5) both came from a now-retired mechanism, not the live architecture. | `[PROD-RO]`+`[SRC]` |
| **Change behavior** (alter what's actually prescribed) | **NO, under the current, live architecture.** Every confirmed instance of behavior actually changing (§5's 6 events) either predates the 2026-09-02 authority seam or, in `mark_upgrade`'s case, is **actively blocked from completing** by the Migration 166 ledger requirement (§3). | This pass |
| **Explain** (tell the runner what changed and why) | **NO / UNCONFIRMED across the board.** No track, including this correction pass, found a confirmed runner-facing surface explaining any shadow PROGRESS row, either historical auto-rebuild, or any proposal's evidence basis, beyond the raw JSON `message` field stored in the DB row itself. | Unconfirmed by any pass to date |

**Net:** the system has a real, working sensory and evaluative layer (observe/classify/compute) with two now-confirmed gaps in classify. It does not have a complete learning loop — the belief-persistence, behavior-change, and explanation stages are each either narrow, historical-only, or entirely unconfirmed.

---

## 3. MIGRATION 166 / `mark_upgrade` — FULL END-TO-END TRACE, CORRECTED VERDICT

**v1's framing ("runner-approved only, by explicit design," presented without qualification) is corrected.** `mark_upgrade` is wired and reachable, but **cannot currently complete successfully**, and this is now precisely traced rather than inferred.

1. **Trigger**: `web-v2/lib/plan/adaptive-ramp.ts:937`, `actionForAdaptiveRamp()` — builds `{kind:'mark_upgrade', bumps, ...}`. `[SRC]`
2. **Proposal creation**: reached via `run-adaptations` cron's `tryAdaptiveBump` import. Zero rows exist (`plan_workout_proposals`: 0 of 8 total are `mark_upgrade`; `coach_intents`: 0 `plan_adapt_upgrade` rows). `[PROD-RO]`
3. **Runner display**: no dedicated card — `mark_upgrade` joined `PROPOSABLE_KINDS` (2026-09-05) specifically so it renders through the *existing generic* `V5ProposalWire[]` surface (`ProposalCardV5.swift`, switches on generic fields, not `action_kind`). Reachable via the same UI every other proposal kind uses. `[SRC]`
4. **Acceptance**: `POST /api/plan/workout-proposals/[id]/accept` → `brain/proposal/accept.ts`. A `DISTANCE_CHANGE`/`MORE` maps to `mark_upgrade`, routed to `case 'ADAPTATION_PIPELINE'`, which calls `applyAdaptations(userUuid, [adaptation], 'RUNNER_ACCEPTED', {...})` — authority is explicitly threaded as `'RUNNER_ACCEPTED'`, not assumed. `[SRC]`
5. **Ledger write**: `applyAdaptations` wraps the action in `mutatePlan({authority, touches:'structural', ledger:{...}, apply:...})`. `mutate.ts`'s `landDecisionInTransaction` computes `requireLedger = touches !== 'authorship'` — TRUE for `mark_upgrade`. `[SRC]`
6. **Transaction behavior when the table is absent**: as of `LEDGERREQUIRED-1` (2026-09-06), when `recordDecisionInTransaction` returns `{state:'table_absent'}`, `landDecisionInTransaction` **throws** `LedgerRefusedMutation('ledger_unwritten', ...)`. `mutatePlan`'s outer catch issues a `ROLLBACK`, logs the refusal on a separate connection, and returns `fail('ledger_unwritten', ...)`. **The entire transaction — including the plan mutation itself — is rolled back before commit.** This is neither silent-success nor a corrupted partial write. `[SRC]`
7. **Plan mutation**: does not persist. Rolled back at step 6.
8. **Success/failure response**: `applyAdaptations` treats the non-ok boundary as a refusal, returns `0` applied. `accept.ts`'s `zeroIsNotSuccess('mark_upgrade')` fires: `{ok:false, error:'apply_failed', detail:'the mark_upgrade was accepted and touched no row; the plan did not move'}`. `[SRC]`
9. **UI acknowledgement**: the runner receives an explicit stated failure, not a false success and not silence.

**Verdict: ACTIVELY BLOCKED**, derived from the current code's real transaction/error-handling structure (there is no organic fired instance to confirm this empirically against — zero rows exist either way). This directly confirms the Main Agent's flagged contradiction: **Migration 166's absence does block adaptation Apply for this lever, today, by design of a fix that landed 2026-09-06** — v1's framing predates awareness of this specific mechanism and should not be read as claiming VOLUME's runner-approved path is currently functional. It is safely inert, not silently broken.

---

## 4. AUTOMATIC PACE RE-ANCHORING — CORRECTED, treated as a real finding, not exempted by naming

**What durably changes:** `reanchorLthr()` (`lthr-reanchor-store.ts:66-134`) writes `profile.lthr`/`lthr_method`/`lthr_set_at` via a direct, unconditional `pool.query` UPDATE — a bare write to the `profile` table, entirely outside `mutatePlan`. `hr_cap_bpm` and pace targets on individual `plan_workouts` rows are a **separate downstream effect**, occurring only when `recompute-paces.ts` subsequently re-derives `workout_spec` off the new LTHR — and *that* step does run inside an already-authority-checked `mutatePlan` transaction. `[SRC]`

**Is the re-anchor itself gated? No.** `reanchorLthr`'s signature carries no `authority` parameter and no reference to `AUTOMATIC_ADAPTATION_AUTHORITY` anywhere in its file.

**Every caller, traced:**
- `cron/run-adaptations/route.ts:221` — unattended nightly cron, zero preceding authority check.
- `cron/plan-drift/route.ts:196` — unattended cron, same.
- `cron/silent-rebuild/route.ts:124` — operator-dispatched (a human triggers the job), but the code path itself calls `reanchorLthr` with no authority check.
- `api/race/route.ts:469` (runner edits a race) and `race/result-chain.ts:212` (runner submits a result) — runner-initiated, but the LTHR write is still a bare unconditional call with no explicit "update my threshold HR" consent step.

**At least 3 of 5 call sites are bare, ungated, unattended cron entry points.** `[SRC]`

**Reconciliation with `AUTOMATIC_ADAPTATION_AUTHORITY===false` and "zero side doors":** this is a real gap in that claim's scope, not a false alarm. `_mutation_boundary.test.ts`'s scanner (`WRITE_RE`) matches only `plan_workouts` writes — it is **structurally blind** to `profile` table writes, so `reanchorLthr` is invisible to the one gate that exists to catch exactly this shape of problem. This is not a legitimate, argued exemption (unlike `recompute-paces.ts`, which the same gate correctly and explicitly names) — no exemption was ever claimed for `reanchorLthr` because the gate doesn't know to ask the question.

**Direct answer to "do not exempt merely by naming it calibration":** today, behaviorally, `reanchorLthr` genuinely is bounded calibration — it never overwrites a field-tested or manually-entered anchor, respects a ±3bpm noise floor, and follows Friel's re-test cadence, with no discretionary "push" logic present. But **nothing in the code enforces that boundary structurally** — there is no authority check that would refuse a future change to this function if push logic were added. It is functioning as calibration today and constructed as an unguarded automatic-prescription-change side door simultaneously; the label is currently doing the enforcement work a gate should be doing. **This is added to the severity table below as a new, real finding (§10).**

---

## 5. HISTORICAL BEHAVIOR-CHANGING MUTATIONS — full enumeration, 6 events, 5 mechanisms

No ambiguous language. Every event below is independently `[PROD-RO]`-confirmed this pass or in a prior pass, re-verified.

| # | Date/time (UTC) | Mechanism | Scope | Before → After | Audit trail |
|---|---|---|---|---|---|
| 1 | 2026-05-24 08:24:22 | `plan_mutations`, `trigger_kind='positive-drift'`, `status='applied'` | Workout `946dad0c-...` (long run, 2026-05-31, plan `8599e3a1-...`) | `original_distance_mi=11` → proposed `12.1` → stored `12.0` | `plan_mutations` row itself is the audit trail — this is the one mechanism in this table with a durable, purpose-built log |
| 2 | 2026-05-25 18:27:11 | `plan_mutations`, `trigger_kind='positive-drift'`, `status='applied'` | Workout `ec7ae0eb-...` (easy run, 2026-06-01, plan `8599e3a1-...`) | `original_distance_mi=4.5` → proposed `4.9` → stored `5.0` | Same as above |
| 3 | 2026-06-02 12:37:42 | `drift_cron_auto`/`volume_drift` (retired 2026-09-02), `plan_proposals id=1` | Whole-plan volume basis | `weeklyAvg4w` 20.1 → **35.7** mi/wk (77%), plan `8599e3a1-...` → `pln_d8bf42492f09dfe2`; continued 35.7→37.6→39.1 over ~3 weeks | **Zero** `coach_intents` rows |
| 4 | 2026-08-25 09:29:32 | `drift_cron_auto`/`long_drift` (retired 2026-09-02), `plan_proposals id=54` | Long-run/weekly target | `target_weekly_mi` 17 → **41**; `actual_median_mi 11.5` vs `authored_median_mi 7` (64.3% drift), plan `pln_eb73331e19230ad9` → `pln_974c307d22ee0f61` | **Zero** `coach_intents` rows. The retirement route's own comment names this exact event as a contributing cause of the mechanism's own 2026-09-02 retirement (it "bumped his easy-day target 4→7... `easy_drift` reacted to THAT number the next night") |
| 5 | 2026-09-02 | `reanchor-plan.ts` bypassing `AUTOMATIC_ADAPTATION_AUTHORITY`, called unattended from `cron/snapshot-projections` | 76 workouts rewritten | `[BLOCKED: exact before/after field values not reconstructed this pass — a targeted DB query found no coach_intents trace near the event, consistent with the pattern, but did not locate a row-level before/after audit table for this specific rewrite]` | **Zero** `coach_intents` rows found in a direct check of this window. **Closed 2026-09-05** (`REANCHORPROPOSES-1`) — `reanchor-plan.ts` now threads `authority:'RUNNER_ACCEPTED'` at every write site |
| 6 | 2026-09-03 18:43:01 | **`silent_rebuild`, operator-dispatched (`cron/silent-rebuild/route.ts`) — newly confirmed this pass, previously absent from every version of this audit** | Whole plan re-authored under updated engine rules | `pln_9a57561debb776e5` (authored 08-31) → `pln_7636bcc0a201bf2d`; `thisWeekMi` 45→46.5, `nextWeekMi`→18.2, `longRunMi` 15→15 (unchanged), weeks 15→15, `daysChangedFromToday:86` | **Deliberately zero** `coach_intents` — this is the ONE mechanism in this table where the missing trail is by explicit design, not omission: the route's own header states "NO new coach_intents." `plan_proposals id=65` (`kind='silent_rebuild'`, `status='auto_applied'`, `source='silent_rebuild_dispatch'`, `reasons.trigger='operator_dispatch'`) is itself the record. |

**Corrected framing:** this is not "twice, historically." It is **6 individual applied mutations across 5 distinct mechanisms**, three of which (#3, #4, #5) are fully automatic with **zero** intentional audit trail (a real, repeated Rule 21/11 gap — now a *confirmed pattern of three*, not one instance), one (#6) is automatic but *deliberately* undocumented in `coach_intents` by the operator tooling's own design (a different category of gap — intentional, not an oversight, but still worth naming since it means `coach_intents` can never be trusted as a complete picture of "what changed" even prospectively), and two (#1, #2) are runner-approved-adjacent (`positive-drift`, applied without an explicit runner accept step but logged in a purpose-built table).

---

## 6. THE NEW RECOVERY P0 — kept, elevated to explicit release-blocking, required test matrix

**Status: P0, unchanged. Explicitly: YES, this blocks the next TestFlight candidate unless explicitly waived by David, until fixed, independently re-reviewed, and physically exercised (not just [TEST]-executed).**

The defect (unchanged from v1): `recoveriesHonestOf()` only evaluates recovery-duration tolerance when `prescribedSec` resolves; `resolveWorkoutVerdict()` only reads `spec.rep_rest_s`, never `spec.strides_recovery_s`. 119 workouts system-wide (57 David's own) use the unread field exclusively — for all of them, the tolerance check is a silent no-op, always returning "no signal" rather than pass/fail.

**Required test matrix before this can be considered fixed** (specification only — no code was written or executed for this correction pass):

1. Workout spec carries `rep_rest_s` only (existing, should-already-work interval/tempo case) — confirm unaffected by the fix.
2. Workout spec carries `strides_recovery_s` only (the broken case) — confirm the fix reads it as a fallback prescribed-recovery source.
3. A recovery intentionally shortened via `recoveryEndedEarly`/WALKBACK-2 (`endedEarlyByChoice: true`) — confirm it is correctly EXCLUDED from the tolerance check regardless of which spec field supplied `prescribedSec`.
4. A recovery genuinely cut short with **no** `recoveryEndedEarly` flag (a real cheating case) on a `strides_recovery_s` workout — confirm the fix now correctly returns `false` (fails tolerance), not `null`.
5. The **final** recovery in a session, immediately preceding an `overtime`/session-end phase — confirm no off-by-one or "last phase is exempt" behavior accidentally excludes it from grading.
6. A workout spec with **neither** `rep_rest_s` nor `strides_recovery_s` populated (a genuinely missing prescription) — confirm the function still correctly returns `null` ("no signal"), not a false pass or a crash.
7. An older, pre-fix payload/row that predates this change entirely — confirm the fix doesn't attempt to retroactively re-grade historical rows in a way that changes their stored verdict without an explicit, separately-approved backfill decision.

---

## 7. STATE-PREDICATE LEDGER — independent falsifier pass results

### "completed" — corrected from "OPEN by design, zero violations" to a mixed, partially-violated verdict

| Concept | Verdict | Detail |
|---|---|---|
| Raw `runs.data.status` | **SAFELY ROUTED** | Read only as a passthrough decoration (`watchStatus`), honestly labeled by `classify-evidence.ts`, never treated as a graded verdict |
| Raw `phases[].completed` | **MISROUTED** | `web-v2/lib/coach/run-win.ts:751,778,789,791` uses the exact `p.completed !== false` idiom that `verdict.ts`'s COMPLETION-STATE-1 fix (2026-09-05) specifically killed elsewhere for collapsing `null` ("wire never said") into "completed" — this is a **live re-introduction of a named, previously-fixed bug class** in a sibling file, producing runner-facing coach-voice text ("clean session") on data that never claimed completion |
| `sessionLadder`/`SessionVerdict` | **SAFELY ROUTED** | Exactly two direct callers, both consuming it for its stated grading/display purpose; native code has an explicit `// COMPLETION-STATE-1` guard comment showing it was deliberately hardened |
| `ExecutionRead.state` | **PARTIALLY MISROUTED** | The canonical progression-eligibility path (`adaptation/load.ts`, `adaptive-ramp.ts`) is correct. But `brain/option-lane.ts`'s `ExecutionQuality`/`executionQualityFrom` builds a **second, independently-derived** answer to "is he absorbing the work" from raw `completion.partial`/`completion.overrun` fields rather than from the canonical `earnsProgressionCredit`/`ExecutionRead` resolver — feeding the same PUSH/HOLD/PULL_BACK decision via two uncorrelated signals |

**Corrected verdict:** "completed" is not a clean 4-concept, zero-violation structure. **One real misrouted consumer, one partially-misrouted consumer.**

### race-week — corrected from "OPEN, three-way benign divergence" to "two of three genuinely conflict"

- `recovery-phase.ts` vs. the other two: **DIFFERENT QUESTIONS**, confirmed benign — a different cited doctrine column ("return to quality" vs. "no quality"), explicitly advisory/non-binding by its own header, self-aware of and deliberately deferring to the plan engine.
- `raceWindowFor()` vs. `POST_RACE_RECOVERY_WEEKS`: **CONFLICTING ANSWERS TO THE IDENTICAL QUESTION — a real Rule 16 violation.** Proof: `demand-input.ts:190` calls its `raceWindowFor`-derived output `noQualityWindowDays` — the exact name/question `POST_RACE_RECOVERY_WEEKS`'s own header claims to own — and the two disagree at the 5K boundary (0 days vs. 5 days), with **both values live in binding decision paths** (`weekly-demand.ts`'s `recoveryDebt`/`raceOverlap`, and `pickPlanMode`'s whole-plan-mode gate). This is the same 5K gap CLAUDE.md's Rule 8 section already names, but reframed correctly here as two independently-hand-typed owners of one quantity, not a benign granularity difference.

### New ledger row — "plan-day distance match" (from Runner-Data audit item 1)

| Predicate | Canonical owner | Competing implementation | Verdict | Evidence |
|---|---|---|---|---|
| Plan-day distance match (feeds `day-resolver.ts`'s LEGACY tier) | `plan-type-stamp.ts`'s `distanceMatchesPlan()`, asymmetric `[0.7, 2.0]` (`OVERRUN-MATCH-1`, 2026-09-04) | An inlined, never-imported symmetric `[0.7, 1.3]` band at `api/watch/workouts/complete/route.ts:756` | **OPEN, not ROUTED** — and this is the more serious of the two: the asymmetric fix reached only the secondary `ingest/workout` route. The watch-completion route is documented in its own comments as **"the PRIMARY source — watch is tier-5 and wins canonical selection"** and was, until 2026-09-04, **the only writer of `planWorkoutId`**. The exact bug class `OVERRUN-MATCH-1` was built to fix is still live on the dominant write path. | `[SRC]` |

### New ledger row — "execution identity"/"supplemental" side door (Coach-audit item 3 / item 8)

| Predicate | Canonical owner | Competing implementation | Verdict | Evidence |
|---|---|---|---|---|
| Which run satisfies which prescribed day (execution identity) | `day-resolver.ts`, whose own header states (quoting David verbatim) that same-calendar-date matching alone is "named EXPLICITLY INSUFFICIENT" | `load-activity-evidence.ts`'s `classifyStoredActivity`/`classifyRecentActivities` matches a plan day to **every** run on that date via `ownedDaysSql` (a date-only join), never checking `planWorkoutId` or calling `day-resolver.ts` at all | **OPEN — a genuine, newly-confirmed side door.** A supplemental run landing on a day that also had a scheduled quality session would silently inherit that session's `PlannedIntent` in evidence classification. This directly extends Exhibit 3's supplemental-run finding: the crediting behavior Exhibit 3 confirmed (full mileage, correctly classified `SUPPLEMENTAL_RUN`) sits downstream of a classifier that, on a day with a co-occurring scheduled run, may mislabel *which* run is which. | `[SRC]` |

---

## 8. BRAIN-BOUNDARY SIDE DOORS — from the Coach-audit reconciliation

Three real, previously-unknown Brain-ownership violations, confirmed:

1. **`HowItWentPanel.swift` is a genuine second Brain for HR-drift.** Two independently-hand-coded threshold ladders (`AerobicStampPanel.driftBand`, `ThePLongPanel`'s tag logic) disagree numerically at a real input (delta=10bpm: one calls it `LATE FADE`, the other `SOME DRIFT`). Nuance that matters for triage: the server's doctrine-cited, duration-gated computation (`aerobic-decoupling.ts`, `decoupling-trend.ts`) exists and is correct, but **is exposed by no API route at all** — the panel isn't ignoring an available field, it's substituting for one that was never wired. **Owned by Brain** (this is exactly the kind of physiological-threshold judgment `RUNNER_AUTHORITY_TIERS`/doctrine-citation discipline exists to centralize); the fix is exposing a wire, not just deleting the client logic.
2. **`standing-recommendation.ts` violates the readiness doctrine's own 3-domain convergence requirement.** It fires `ease_down` off any single readiness domain, and its own code comment admits it "mirrors the day-of adapter's `detectReadinessPullback` logic" — the exact single-signal gate that `convergence.ts`'s header says explicitly "had to go." Never migrated. **Squarely Brain/Readiness-owned logic, currently duplicated and stale in a Coach-surface file.**
3. **`load-activity-evidence.ts`'s date-only matching** (§7 above) — **Brain/Evidence-Engine-owned**, a real, new side door.

Two Coach-audit claims were investigated and **CONTRADICTED** (both favorably):
4. **Tune-up race taper**: backwards from the claim. C-priority races get the LEAST taper-like treatment (pure cutback, doctrine-cited), not more. Only B-priority gets a scoped 2-day mini-taper; full multi-week taper is reserved for the actual A-race only. Working as designed.
5. **Race projection List/Detail divergence**: contradicted. `race-projection.ts` is confirmed a pure mapping with no independent computation; both List and Detail render the identical value under the identical label, enforced by a live cross-surface contract test running against production. A real prior divergence (week-strip) was already found and fixed. One out-of-scope caveat: `targets/projection/route.ts` calls `predictRaceTime` directly in several places — a Targets-surface question, not investigated further here.

**Proposal state semantics (Coach-audit item 4) — partially confirmed, and reconciles item 5's Migration-166 question precisely:**
- Accepted-then-Apply-failed vs. accepted-then-succeeded: **CONFIRMED collapsed**, but only in a **separate "modern lane"** proposal-accept path (`api/plan/workout-proposals/[id]/accept/route.ts`'s `acceptProposal`/`applyBrainAction`), which stamps `status='accepted'` before calling apply and does **not** call `reopenProposal` on failure — unlike the legacy lane, which explicitly guards this. **This is a different code path from `mark_upgrade`'s `ADAPTATION_PIPELINE` lane**, which §3 above confirms correctly rolls back via `mutatePlan`'s ledger requirement. Do not conflate the two: VOLUME's specific upward-adaptation lane is safe; this separate, broader lane (used by other proposal kinds) is not.
- Accepted-then-undone: **CONFIRMED collapsed at the status-column level** — only `coach_intents`'s free-text explanation distinguishes it from a failure, and only for the undo case.
- Never-answered: **CONTRADICTED** — has its own `status='expired'`.
- Safety-superseded: **CONTRADICTED** — has its own `status='superseded'` with a full ledger/reassessment trail, confirmed live on this account.
- Safety-refusal vs. transport-failure: distinguished only transiently in the HTTP response (`AcceptOutcome.error`: `'rejected'` vs. `'apply_failed'`/`'read_failed'`), never persisted to the row.

**Coach-audit item 9 (stride-day `executed` verdicts):** confirmed as correct policy going forward — any Coach-side messaging that reads a stride-day workout's `'executed'` verdict should treat that verdict as **unverified pending the §6 fix**, since the recovery-honesty check is currently a no-op for exactly those workouts. This is not a new defect; it is the correct operational consequence of the §6 P0 and should be stated as such wherever Coach-side surfaces consume this verdict.

---

## 9. RUNNER-DATA RECONCILIATION — remaining items not covered above

- **Pause data**: the "3rd Swift sender" detail is **CONTRADICTED** (only 2 senders exist — `TreadmillView.swift`, `LiveRunTreadmillV5.swift`; checked and ruled out `PhoneRunTracker.swift` and the native watch completion struct). But the core discard mechanism is **CONFIRMED, precisely**: `clockAudit` is persisted **only when `driftSec` exceeds tolerance** — i.e., only when pause data *fails* to fully explain a timing gap. When pause data succeeds at explaining drift, it's used arithmetically and then discarded — nothing is stored. **8 of 8** real nonzero `pausedSec` submissions found in raw ingest payloads (`coach_intents`, reason=`watch_completion`) are confirmed absent from the corresponding `runs.data` rows. This corrects and sharpens v1's earlier, less specific pause-data finding.
- **RPE**: **CONFIRMED**, 13/13 real rows (`post_run_rpe.rpe`, not in `runs.data`). Downstream weighting is a **hardcoded binary threshold** (`RPE_HARDER_THAN_EXPECTED=8`), uncited in the doctrine registry — genuinely unproven, not a continuous evidence weight. A second field, `subjectiveEffort`, is written into the evidence ledger but has **zero downstream readers anywhere** — write-only. One RPE row belongs to an absorbed (non-canonical) run and is **orphaned** (not double-counted, but silently unreachable from the canonical sibling).
- **VDOT eligibility OR gate**: **CONFIRMED, and worse than claimed** — `passesRunHonestyGate` is `isQuality || isHardEffort`, and `hrTraceIsCredible` is never imported into `vdot.ts` at all, so **neither branch** of the OR ever checks HR-trace credibility, not just the type branch.
- **`recoveryExtensions`/`ceilingLift`**: **CONFIRMED to have a live Run Detail consumer** (`run-state.ts`'s `loadRunDetail` → `api/runs/[id]/route.ts` → `RunDetailV5.swift` renders both a "Lifted the ceiling" line and a combined "Recovery" row). **This corrects v1's inherited §5/§6 classification of these fields as "collected but unused" — they should move to "collected and surfaced."**
- **Phase transition cause**: **CONFIRMED as stated**, with a precise nuance — two narrow, purpose-built exceptions exist (`repSkips`, and `recoveryEndedEarly`/WALKBACK-2), each covering exactly one specific scenario matched by `phaseIndex`. Every other transition type (an ordinary Next tap, an automatic timer/distance completion, a watch-detected GPS event) has no cause field anywhere in `phases[]`.

---

## 10. UPDATED SEVERITY TABLE — additions only (full table otherwise unchanged from v1 §10)

| # | Finding | Severity | Status |
|---|---|---|---|
| 15 | **`reanchorLthr` has zero authority gating and is invisible to the one mutation-boundary gate that exists to catch this** (§4) | **P1 — new this pass** | OPEN. Not urgent by current behavior (no push logic present), but structurally unenforced. |
| 16 | **Symmetric `[0.7,1.3]` distance-match band still live on the PRIMARY/dominant watch-completion write path**, despite `OVERRUN-MATCH-1` (§7) | **P1 — new this pass, more serious than originally scoped** | OPEN. The believed-fixed bug class is still live on the write path that matters most. |
| 17 | **`load-activity-evidence.ts`'s date-only intent matching** (§7/§8) | **P1 — new this pass** | OPEN. Real evidence-corruption risk on any day with a co-occurring supplemental + scheduled run. |
| 18 | **`HowItWentPanel.swift`'s independent HR-drift ladders** (§8) | **P2 — new this pass** | OPEN. Client-side judgment substituting for an unexposed server computation. |
| 19 | **`standing-recommendation.ts`'s single-domain ease, contradicting the 3-domain convergence doctrine** (§8) | **P1 — new this pass** | OPEN. A real, live doctrine violation on a runner-facing recommendation. |
| 20 | **Proposal-accept "modern lane" collapses accepted-then-failed with accepted-then-succeeded** (§8) | **P1 — new this pass** | OPEN. Distinct from the (confirmed-safe) `mark_upgrade` lane. |
| 21 | **RPE's hardcoded, doctrine-uncited weighting; `subjectiveEffort` write-only field** (§9) | **P3 — new this pass** | OPEN. |
| 5 (rev.) | `coach_intents` gap for automatic upward events | **P0, unchanged, now confirmed as a pattern of THREE (events #3/#4/#5 in §5), not one** | OPEN |

---

## 11. TESTFLIGHT CONCLUSION — REWRITTEN

**The §6 recovery P0 blocks the next TestFlight candidate, unless David explicitly waives it.** It is a real, twice-independently-confirmed integrity gap (via direct [TEST] execution of the real production function, by two separate sessions) — not a cosmetic issue, and it degrades silently, which is the worst failure mode this doctrine names. It should not ship without the fix, the required test matrix (§6), and a fresh independent review of the fix itself — none of which are things this correction pass performed (no code was written).

**Two items remain explicitly open, unrendered, and unresolved — neither should be treated as closed for TestFlight purposes:**
- Whether the Rose Bowl Half is actually missing from the runner-facing PR screen (vs. only from an audit document's own prose).
- Whether the proposal-13-style bundled reprice card correctly communicates anchor directions to the runner.

**A distinction this correction pass introduces, per the requester's instruction:** "internal TestFlight availability" (can a build be installed and used by David for further manual testing) is a **different, weaker** claim than "considered safe for physical verification of any of this report's findings." Given that a genuine [RENDER] of the Today screen was attempted and blocked (§1), **no claim in this report about the runner-visible screen should be treated as verified for physical release purposes** — only the source-routing question is closed. An internal build could reasonably be installed to attempt the blocked render (§1) as a next step, which is different from certifying the screen itself as correct.

---

## 12. RECOMMENDED IMPLEMENTATION ORDER — updated

1. Fix the §6 recovery-honesty field-name gap (unchanged top priority — smallest, most consequential).
2. **Fix the still-live symmetric `[0.7,1.3]` band on `api/watch/workouts/complete/route.ts`** — import and use `plan-type-stamp.ts`'s asymmetric matcher instead, closing the gap `OVERRUN-MATCH-1` was believed to have already closed.
3. **Route `load-activity-evidence.ts`'s intent matching through `day-resolver.ts`** instead of its own date-only join.
4. Attempt the blocked [RENDER] (§1) via a purpose-built offline Today harness (mirroring the existing Run Detail/Proposals harnesses) — this is now the single highest-value unblocking investment, since it would close both the display-verification gap and give future passes a repeatable tool.
5. Fix `run-win.ts`'s reintroduced `completed !== false` collapse.
6. Decide and execute on the now-confirmed 3-instance `coach_intents` gap (§5, events #3/#4/#5) — needs David's decision.
7. Migrate `standing-recommendation.ts` off its stale single-domain gate onto `convergence.ts`.
8. Add an authority parameter to `reanchorLthr`, or extend `_mutation_boundary.test.ts`'s scanner to cover `profile` table writes so the gate can at least see this mechanism.
9. Fix the "modern lane" proposal-accept collapse (reopen-on-failure, matching the legacy lane's existing guard).
10. Everything else from v1 §12, unchanged in relative order.

---

## 13. QUESTIONS FOR DAVID — updated

All six from v1 §13 stand, unchanged. Two new ones:

7. **The 2026-09-03 "silent rebuild" mechanism is intentionally undocumented in `coach_intents` by its own design** ("NO new coach_intents"). Is that acceptable as a standing operational tool for landing engine-rule changes into live plans, or should it also write a ledger entry — even though it's operator-dispatched rather than autonomous?
8. **Should the primary watch-completion ingestion route be brought onto the same asymmetric distance-match band as the (secondary) ingest route**, or is there a reason the two routes intentionally use different bands that this pass didn't surface?

---

## 14. PROVENANCE

- **Final audit branch:** `audit/brain-forensic-2026-09-10`
- **Base SHA (checkpoint of original 8-session handback, before any new work):** `80fca013f94b99ee5af3f84e79590591d42141da`
- **v1 checkpoint commit (handback + 4 domain reports, verbatim):** `5b41b0d99706bb5440f6d3a9a0e2a2aad2b73710`
- **v1 final-report commit:** `c99d924ea` *(full: run `git log --oneline audit/brain-forensic-2026-09-10` for the complete hash)*
- **This v2 correction is written to:** `docs/audit-2026-09-10-brain-adaptation-forensic-audit-v2-CORRECTED.md` — commit SHA and file hash to be recorded immediately after this file is committed (see the commit that follows this document).
- **Current `origin/main` at completion (freshly fetched):** `99757c1204f27a1fa86504efd580842bc81c72b2` — has moved ahead of this branch's base (`80fca013f`) during this session, as expected given other work continues on `main` concurrently. This audit branch was never rebased onto the new tip and nothing here depends on doing so; `[SRC]`/`[PROD-RO]` citations throughout this report remain pinned to the base commit stated above unless a specific claim says otherwise.
- **Final report commit SHA (this v2 document):** `6b5f565041c50c4afd426ea7a05375ddf993b683`
- **v2 report file hash:** `d5344a820abd3fd8b12175b95f74e302f7cebbd3` (`git hash-object`)
- **Final `git status` at completion (unrelated concurrent-session files, confirmed untouched):**
  ```
   M docs/audit-2026-09-09-historical-data-forensic-audit.md
   M docs/reports/historical-data-audit-2026-09-09/domain-{A,B,C,D}-*.md
  ?? AGENTS.md
  ?? docs/audit-2026-09-09-coach-forensic-audit.md
  ?? docs/audit-2026-09-09-historical-data-forensic-audit-v1-to-v2-delta-log.md
  ?? docs/audit-2026-09-09-historical-data-forensic-audit-v2*.md  (v2 and v2.1, plus a v2-to-v2.1 delta log)
  ?? docs/reports/coach-audit-2026-09-09/
  ?? docs/reports/historical-data-audit-2026-09-09/domain-B-cohort-completion.md
  ?? docs/reports/historical-data-audit-2026-09-09/v2-correction-*.md  (4 files)
  ```
  All of the above belong to a separate concurrent session working directly in this shared checkout, confirmed still growing in number and still entirely uncommitted at the time this report's commit landed. None of it was read, incorporated, or touched.
- **Concurrent uncommitted work exclusion, confirmed:** throughout this entire session, a separate concurrent process was found working directly and uncommitted in this same shared checkout (modifying the original v1 handback/domain-report files in place, and adding its own untracked "v1-to-v2-delta" and "coach-forensic-audit" files). None of that work was read, incorporated, merged, or committed by this pass at any point. Every commit this pass made staged and committed **only its own newly-created files, by explicit path** — `git add -A` was never used. This will be re-confirmed with a final `git status` immediately after this document is committed.

*No code changes, migrations, or production writes were made in the production of this correction. Every new factual claim above traces to a freshly-dispatched, independent investigation completed after v1 shipped.*
