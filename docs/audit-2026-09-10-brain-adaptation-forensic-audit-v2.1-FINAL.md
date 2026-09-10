# BRAIN v2.1 — faff.run Brain, Evidence, Learning & Adaptation Forensic Audit
## Standalone, consolidated report. Replaces v1 and v2 for operational use — no splicing required.

---

## HEADER

**What this document is.** This is the single canonical Brain report as of 2026-09-10. It supersedes `docs/audit-2026-09-10-brain-adaptation-forensic-audit-FINAL.md` (v1) and `docs/audit-2026-09-10-brain-adaptation-forensic-audit-v2-CORRECTED.md` (v2) in full — every finding from both is either carried forward unchanged, corrected below, or explicitly marked superseded. Nothing here should need to be read alongside v1/v2 to be understood.

**Method across all three rounds:** v1 was a gap-fill pass building on an inherited 8-session historical-data audit. v2 corrected 9 named defects in v1 plus reconciled 17 findings from two parallel tracks (a "Coach audit" and a "Runner Data audit"). This v2.1 corrects 7 more named defects in v2, reconciles the fully-read Runner Data v2.1 report (previously only chat-relayed excerpts had been consumed), and reconciles 4 further disputed findings from a "Coach v2" track, all four pinned to one shared commit.

**Evidence tags, precise:** **[SRC]** (file:line), **[PROD-RO]** (query actually run), **[TEST]** (real, unmodified production code actually executed against real data), **[RENDER]** (an actual screen, actually observed), **[INF]**, **[BLOCKED: reason]**. Per explicit instruction: an HTTP response body is `[SRC]`/`[TEST]` evidence about API behavior, never promoted to a claim about what a runner-visible screen shows.

---

## 1. EXECUTIVE VERDICT

**Observe/classify/compute:** real and live, with two confirmed classification-layer gaps (a still-live symmetric distance-match band on the primary ingestion path; a date-only evidence-intent matcher bypassing the canonical execution-identity owner). See §8.

**Persist a durable belief / change behavior:** the only mechanism that durably self-changes a belief today is the LTHR/pace re-anchor — itself a confirmed ungated side door (§5), not the adaptation-decision pipeline. Every confirmed instance of automatic prescription-level behavior change in this account's history is now fully enumerated (§3) and every one of them is **either retired or currently blocked from completing**:
- Three `drift_cron_auto`-family events (2026-06-02 volume, 2026-08-25 duration-up, 2026-08-26 duration-down) — retired 2026-09-02.
- `positive-drift` (2026-05-24/25) — **newly traced this pass, verdict: RETIRED.** It was, when live, an ungated automatic side door structurally identical in shape to `reanchorLthr` (no authority check, no runner-accept step) — but its code lives entirely in `legacy/web`, which the live Railway build (`package.json`/`railway.json`, both scoped to `web-v2` exclusively) does not build or start. Zero `web-v2` imports of it. Production data confirms zero activity since 2026-05-25.
- `mark_upgrade` (VOLUME, runner-approved) — confirmed **ACTIVELY BLOCKED** by Migration 166's absent table (§4), not merely unfired.
- The 2026-09-02 "76 workouts" re-anchor event — **now DISPUTED/UNCONFIRMED**, not asserted (§3).

**Net, precisely stated:** no lever's automatic-mutation path is both live and unblocked under the architecture that actually ships today. Every historical instance of real automatic behavior change belongs to code that is retired, unbuilt, or (for `mark_upgrade`) transactionally refused. This is a stronger, more precise claim than "change behavior: NO" alone — it is NO, and every mechanism that could make it YES has been individually traced to why it currently can't.

**Explain:** no confirmed runner-facing surface explains any shadow PROGRESS row, historical auto-rebuild, or proposal's evidence basis, beyond the raw JSON stored in the DB row. Unchanged from v2.

**The §9 Today-screen symptom is now far more completely explained** (§9 below) — not by either side of the original mechanism dispute, but by a third, separate, now-deleted Swift component, confirmed live on every TestFlight build across the relevant window via git history and the App Store Connect API. A literal simulator/device render was still not performed, and this document does not claim one.

**One P0 remains the clear release blocker**: the recovery-honesty check's field-name gap (§10), independently confirmed three times now (this track twice, the Runner Data track once, all three by different methods).

---

## 2. LEARNING VERDICT — six stages, unchanged from v2, confirmed still accurate

| Stage | Verdict |
|---|---|
| Observe | YES |
| Classify | YES, two confirmed gaps (§8) |
| Compute | YES |
| Persist durable belief | PARTIAL — only the LTHR/pace re-anchor, itself ungated (§5) |
| Change behavior | **NO** — see §1's precise restatement above |
| Explain | NO / unconfirmed |

---

## 3. HISTORICAL MUTATION INVENTORY — reconciled, non-overlapping, final

Combines this track's own findings with the fully-read Runner Data v2.1 report's independent re-derivation. Where the two tracks queried the identical tables and got identical numbers, that is stated as cross-confirmation, not as two separate facts.

| # | Date (UTC) | Mechanism | Authority | Before → after | Scope | Audit trail | Status |
|---|---|---|---|---|---|---|---|
| 1 | 2026-05-21 08:24:22* / 05-24 08:24:22 | `positive-drift`, `plan_mutations id a5a9088f...` | **Automatic, ungated** (no authority check anywhere in `legacy/web`'s call chain) | `distance_mi` → 12.1 (workout `946dad0c...`) | Single workout | Row exists in `plan_mutations` | **RETIRED** — mechanism lives only in unbuilt `legacy/web`; zero activity since 05-25 |
| 2 | 2026-05-25 18:27:11 | `positive-drift`, `plan_mutations id 3e353dc3...` | Same as #1 | `distance_mi` → 4.9 (workout `ec7ae0eb...`) | Single workout | Same as #1 | Same as #1 |
| 3 | 2026-06-02 12:37:42 | `drift_cron_auto`/`volume_drift`, `plan_proposals id=1` | Automatic | `weeklyAvg4w` 20.1→35.7 mi/wk (+77%) | Whole-plan rebuild | **Zero** `coach_intents` trace | **RETIRED** 2026-09-02 |
| 4 | 2026-08-25 09:29:32 | `drift_cron_auto`/`long_drift`, `plan_proposals id=54` | Automatic | `authored_median_mi` 7→`actual_median_mi` 11.5 (+64.3%) | Long-run basis | **Zero** `coach_intents` trace | **RETIRED**, same cutover |
| 5 | **2026-08-26 — CORRECTED this pass, was missing from v2's table** | `drift_cron_auto`/`easy_drift`, `plan_proposals id=55` | Automatic | `authored_median_mi` 7→`actual_median_mi` **4** (easy days, **-42.9%, DOWNWARD**) | Easy-day basis, one week | `plan_proposals` row exists | **RETIRED**, same cutover. Landed one day after #4, same rolling window, opposite direction — direct within-account proof this class of mechanism was genuinely bidirectional before retirement |
| 6 | **2026-09-02, "76 workouts" re-anchor — DOWNGRADED to DISPUTED/UNCONFIRMED this pass, was presented as PROD-RO-confirmed in v2** | `reanchor-plan.ts` bypassing the authority seam, cited by a code comment in `lib/brain/mutation/authority.ts` | Historical side door, closed 2026-09-05 | `[DISPUTED]` — no `created_at`/`updated_at` column on `plan_workouts`, no dedicated audit table exists. The independently-re-derived closest evidence: `lthr_bpm=168` appears on **23 rows total** (13 on the currently-active plan, 10 on its predecessor) — not 76, and no single plan or date shows a 76-row cluster of either the pre- or post-anchor value. | **Zero** `coach_intents` trace found in a direct query of the window | **The mechanism CLASS (an authority-seam-bypassing re-anchor) is real and independently corroborated as closed 2026-09-05. The specific claim — 76 workouts, on 2026-09-02 — is not verifiable from the current schema and must not be cited as a confirmed count or date going forward.** |
| 7 | 2026-09-03 18:43:01 | `silent_rebuild`, operator-dispatched, `plan_proposals id=65` | Operator-dispatched (a human explicitly runs the job; the route code itself has no authority check) | Whole-plan rebuild, `thisWeekMi`→46.5, `longRunMi`→15 unchanged | Whole-plan (`new_plan_id` = the account's currently active plan) | Row exists, `message` field present. Deliberately **no** `coach_intents` write — the route's own header states this by design | **LIVE** — this IS the currently active plan |

*Note on row 1's timestamp: `plan_mutations id a5a9088f...` is stamped `2026-05-24 08:24:22`; an earlier related `seen`-status batch from the same mechanism runs 2026-05-21 through 05-22, not applied. Corrected to avoid the ambiguous double-date that appeared in an intermediate draft of this table.

**This replaces every earlier "twice historically" or "6 events" framing.** It is **7 named rows across 5 distinct mechanisms** (`positive-drift`; `drift_cron_auto`'s three sub-kinds treated as one retired cron with three fired instances; the disputed re-anchor; `silent_rebuild`), of which **4 mechanism-instances are confirmed automatic and ungated** (rows 1-2 as one mechanism, 3, 4, 5), **1 is confirmed real but historically ungated and now closed** (row 6's mechanism class, though its specific count is unconfirmed), and **1 is operator-dispatched, not autonomous** (row 7). Three of the confirmed-automatic instances (3, 4, 5) left zero `coach_intents` trace — this is now a confirmed pattern of three, on top of `positive-drift`'s own separate zero-trace history.

---

## 4. `mark_upgrade` / MIGRATION 166 — reworded, API-vs-UI distinction enforced

**Unchanged in substance from v2 — the 9-step trace stands, verdict ACTIVELY BLOCKED.** Reworded per explicit instruction to prevent an HTTP payload being read as a UI claim:

- **API behavior: source-confirmed, `[SRC]`.** On accept, `mutatePlan`'s `landDecisionInTransaction` computes `requireLedger=true` for `mark_upgrade` (`touches:'structural'`); when `recordDecisionInTransaction` returns `table_absent`, the function throws, the transaction rolls back, and `accept.ts`'s `zeroIsNotSuccess('mark_upgrade')` returns `{ok:false, error:'apply_failed', detail:'...the plan did not move'}`. This is what the server actually does and returns — confirmed by reading the real code's transaction/error-handling structure.
- **Runner-visible acknowledgement: `[BLOCKED: not rendered]`.** Whether the runner's phone actually surfaces this failure response as a legible message, a silent no-op, or something else has not been checked by any pass. The API-level trace does not establish this, and this document does not claim it does.

---

## 5. AUTOMATIC PACE RE-ANCHORING — caller count corrected

**v2's "at least 3 of 5 call sites are bare unattended cron entry points" conflated categories. Corrected:**

| Caller | Category | Authority check on `reanchorLthr` itself |
|---|---|---|
| `cron/run-adaptations/route.ts:221` | **Unattended, scheduled cron** | None |
| `cron/plan-drift/route.ts:196` | **Unattended, scheduled cron** | None |
| `cron/silent-rebuild/route.ts:124` | **Operator-dispatched** (a human explicitly triggers this job — distinct from an unattended cron) | None |
| `api/race/route.ts:469` (runner edits a race) | **Runner-initiated HTTP request** | None |
| `race/result-chain.ts:212` (runner submits a result) | **Runner-initiated HTTP request** | None |

**Precise count: 2 of 5 are unattended scheduled crons; 1 is operator-dispatched (not unattended — a human decides to run it, but the code path has no gate); 2 are runner-initiated.** The finding that matters is unchanged by this correction and should not be softened by it: **all five**, across all three categories, reach `reanchorLthr()` with zero authority parameter and zero gate at the function itself. The `_mutation_boundary.test.ts` gate remains structurally blind to this (it scans only `plan_workouts` writes; `reanchorLthr` writes `profile`). "Calibration not adaptation" remains true as current behavior, not as an enforced boundary.

---

## 6. `positive-drift` — full end-to-end trace (new this pass)

1. **Mechanism**: `legacy/web/coach/plan-adapter.ts:361`, `detectPositiveDrift()`. Computes `drift = (last7Mi − prescribedWeeklyMi) / prescribedWeeklyMi`; if `drift ≥ 0.15`, bumps every non-rest/non-race workout in the next 7 days by `min(0.10, drift×0.35)`.
2. **Caller**: not a cron — fires on-**read**, every time the plan is fetched, via `adaptPlan(...,{persist:true})` called from `plan-lifecycle.ts:129`'s `getCurrentPlan`, wired into several `legacy/web` API routes.
3. **Eligibility**: `poorDaysCount<3`; `daysSinceLastRun≤3`; current week not TAPER/RACE_WEEK/MAINTENANCE; drift≥15%; bump capped at 10%/week (`Research/00a` ramp cap).
4. **Authority gate**: none, structurally. `positive-drift` is absent from `APPROVAL_TRIGGERS`; `requiresApproval=false` triggers `maybeMutate()`'s direct `Object.assign(w,changes)` plus direct writes. Zero reference anywhere to `web-v2/lib/plan/adaptation-authority.ts` — this code predates that module entirely.
5. **Proposal/acceptance**: none. `status:'applied'` is set immediately, no runner accept step. The 8 `seen` rows are not a pending-approval queue; `shouldFire()` always returns true, and idempotency dedup (not runner action) is what stops re-firing.
6. **Mutation boundary**: bypassed entirely — `plan-store.ts`'s `insertMutation()`/`updateWorkout()` write `plan_mutations`/`plan_workouts` directly, never through `mutatePlan`.
7. **Durable write**: confirmed — both tables, direct writes, same production database `web-v2` uses today.
8. **Audit record**: none — `[PROD-RO]` confirms zero `coach_intents` rows referencing either mutated workout or matching `positive-drift`/`above plan` text anywhere near the event dates.
9. **Live today?** **No.** `git grep -n "positive-drift" origin/main` matches only inside `legacy/web`. `legacy/web` is confirmed, via root `package.json`'s build script and `railway.json`'s build/start commands, to be entirely excluded from what Railway builds and serves — only `web-v2` ships. `web-v2` never imports `legacy/web`. Production `plan_mutations`: 10 rows total, 100% `positive-drift`, zero activity since 2026-05-25.

**Verdict: (d) Retired.** Structurally, when it was live, this was an ungated automatic side door — identical in shape to `reanchorLthr` (§5), just in unshipped code rather than shipped code. It does not contradict "Change behavior: NO" for the current architecture; it is one more entry in the list of historical mechanisms that WERE automatic and ungated, all of which are now either retired or blocked. **If `legacy/web` were ever rebuilt or redeployed, this exact defect would return unchanged from day one** — worth naming as a standing risk of that codebase, not just a historical footnote.

---

## 7. DECISION-LEDGER CALLERS — definitive named list

**Confirmed independently by two separate tracks against current `origin/main`, byte-identical: 8 distinct write-caller files, 11 call-site lines.** No discrepancy to explain — this track's own earlier count (Track R, dispatched independently) already matched this exactly; it simply hadn't been published as a named table before. The definitive list:

| # | File | Line(s) | Function called |
|---|---|---|---|
| 1 | `web-v2/app/api/coach/proposal/[id]/decline/route.ts` | 167 | `recordDecision` |
| 2 | `web-v2/app/api/plan/workout-proposals/[id]/dismiss/route.ts` | 140 | `recordDecision` |
| 3 | `web-v2/app/api/today/reschedule/route.ts` | 365 | `recordDecision` |
| 4 | `web-v2/lib/adaptation/canonical-shadow/live-arbitration-proposals.ts` | 167, 263 | `recordDecision` (×2) |
| 5 | `web-v2/lib/brain/option-lane.ts` | 596 | `recordDecision` |
| 6 | `web-v2/lib/brain/orchestration/move-orchestrator.ts` | 1246, 1337 | `recordDecision` (×2) |
| 7 | `web-v2/lib/plan/mutate.ts` | 1088, 1143 | `recordDecision` + `recordDecisionInTransaction` |
| 8 | `web-v2/lib/plan/workout-proposals.ts` | 248 | `recordDecision` |

**Explicitly excluded, named so the exclusion is checkable:** `app/api/admin/decision-ledger/route.ts` (read-only, GET-only, every function it calls is a SELECT); `lib/runner-state/store/lineage.ts` (imports only a read function and a type); `lib/plan/reschedule.ts:2499` (calls a **local, unrelated, same-named** `recordDecision(tx,d)` defined in the same file with a different signature — a naming collision with the ledger's function, not a call to it). These three were the source of both earlier over-counts (v1's "10", one intermediate pass's confusion).

---

## 8. STATE-PREDICATE LEDGER — carried forward unchanged, confirmed good

Per explicit instruction, this section stands as corrected in v2 and required no further correction this pass:
- "completed": one real misrouted consumer (`run-win.ts`'s reintroduced `completed!==false` collapse), one partially-misrouted consumer (`option-lane.ts`'s duplicate `ExecutionQuality` signal bypassing the canonical resolver), two safely-routed.
- Race-week: `recovery-phase.ts` vs. the other two = different questions, benign. `raceWindowFor()` vs. `POST_RACE_RECOVERY_WEEKS` = genuine Rule-16 conflict, proven via a name collision (`demand-input.ts` naming its output `noQualityWindowDays`) and a live 5K disagreement (0 vs. 5 days) in two separate binding decision paths.
- New rows: the plan-day distance-match predicate (two live matchers, only one fixed, on the wrong path — see §9's cross-confirmation below) and the `load-activity-evidence.ts` date-only execution-identity side door.

**Cross-confirmation from the fully-read Runner Data v2.1 report:** its independent, actually-executed (not hand-traced) 4-scenario test of both matchers reproduces this finding exactly, and adds precision this track didn't have: the ambiguity-refusal behavior lives in the CALLER (`ingest/workout/route.ts`'s `candidates.length===1` gate), not in `plan-type-stamp.ts`'s `distanceMatchesPlan` itself, which is a pure boolean predicate with no refusal logic of its own. `watch/workouts/complete/route.ts`'s own separate, inlined symmetric band has no refusal logic at all — it silently picks the closest candidate. Both routes agree on under-run and ordinary-match scenarios; they diverge only at the ceiling (confirmed: `watch/workouts/complete` fails to match Case 5.1's exact real-world 37%-overrun shape, replicated live) and on ambiguity handling (one silently commits, one explicitly refuses — a second, independent behavioral difference worth its own product decision).

---

## 9. THE §9 TODAY-SCREEN SYMPTOM — most complete account yet, TEST/RENDER discipline maintained

**The mechanism dispute is resolved more completely than this track's own earlier passes achieved**, via the fully-read Runner Data v2.1 report's independent work, cross-checked here rather than merely cited:

Neither side of the original v1 dispute (`sectionPieces` GPS-mile-keyed vs. phase-keyed) was actually the live cause. A **third, separate Swift component**, `workoutPhasesTile`/`phaseTrailingText`, introduced 2026-09-04 and deleted 2026-09-08 (`154edbf97`), rendered **unconditionally**, above whichever of `sectionPieces`/`workoutPhasePieces` the other two mechanisms debated. Its wire type has no pace field at all — structurally absent, not gated — and its rendering function stamps the literal string `"not completed"` for any phase with `completed:false`, regardless of type. Feeding today's real raw phase data through this component's logic reproduces the reported symptom exactly.

**Evidence tier, stated precisely, per instruction:**
- **Current server payload — [TEST], proven.** A real call to `/api/v5/today` against a database copy of this exact run confirms: `routePhases` is phase-keyed with 14/14 entries; every recovery carries a real, non-null pace; the string `"not completed"` occurs zero times in the response.
- **Which build was on the phone — [SRC]+[PROD-RO], strong but not certain.** Build 290 is confirmed (via the live App Store Connect API) to be the newest build ever uploaded — not, as an earlier draft stated, "the only build ever shipped" (a long ship history precedes it, including builds 275 and 278). `workoutPhasesTile` was compiled into every build from its 2026-09-04 introduction through 290. The exact build a given phone was running at the moment of any specific run is never transmitted to the server by any code path — `[BLOCKED: not queryable]`. Since no build newer than 290 has ever existed, 290 was the newest build that COULD have been installed; that it specifically (rather than an earlier build in the same window) was what produced the reported symptom is the best-evidenced **[INF]**, not a certainty — though any build in that window reproduces the same symptom, which narrows the practical uncertainty considerably.
- **Actual Swift rendering — still `[BLOCKED: no simulator/device render performed]`.** No pass, including this one, built and ran the app to watch the screen draw. This document does not claim otherwise.

**The single most actionable fact in this section:** `154edbf97`'s deletion (the actual fix) is merged to `main` but has **never shipped in any TestFlight build**. The defect the runner reported is dormant on his phone, not fixed there, until a new build is cut and distributed.

**A related, separately-important correction:** tracing `resolveWorkoutVerdict()`'s exact field resolution for today's run confirms — independently, by this track's own earlier [TEST] execution and now cross-confirmed by Runner Data v2.1's standalone script — that `prescribedSec` resolves to `null` (not 60) for all six recoveries, because the grading code reads `rep_rest_s` (absent on this strides-shaped spec) and never `strides_recovery_s` (the field actually populated). `recoveriesHonestOf` returns `null` ("no signal"), and `sessionLadder`'s gate (`recoveriesHonest !== false`) does not block on `null`. **Today's run shows `'executed'` — this was never in dispute between this track's own passes, and is now triple-confirmed.** This is precisely the §10 P0 below, not a separate finding.

---

## 10. THE P0 — recovery-honesty check, unchanged, now triple-confirmed, release-blocking

Unchanged in substance from v2. **Status: explicitly release-blocking for the next TestFlight candidate, unless waived by David.** Now independently confirmed a third time (by the fully-read Runner Data v2.1 report's own standalone script, in addition to this track's two prior [TEST] confirmations) — this is the most-verified single finding in the entire audit lineage. The 7-case required test matrix from v2 stands unchanged: `rep_rest_s`-only, `strides_recovery_s`-only, intentional early-end (`recoveryEndedEarly:true`), genuine cheating with no early-end flag, the session-final recovery, a spec with neither field, and a pre-fix historical payload.

---

## 11. BRAIN-BOUNDARY SIDE DOORS — reconciled against Coach v2, pinned to `99757c1204f27a1fa86504efd580842bc81c72b2`

All four checked fresh against this exact commit by an independent pass.

1. **`HowItWentPanel.swift`'s two disagreeing HR-drift ladders — DOWNGRADED. Was "live second Brain," now confirmed dead code.** `HowItWentPanel` is constructed at exactly one site codebase-wide, `TodayPostRunBody.swift`'s `howItWent` property, gated `if hiwEffort == .intervals`. Because the only live caller pre-filters to `.intervals`, the panel's own internal switch can never reach its `.easy/.recovery`/`.long` branches — `AerobicStampPanel` and `ThePLongPanel` (the two components carrying the disputed ladders) are genuinely unreachable; only `RepsPostPanel` ever renders. The numeric disagreement between the two ladders remains real as dormant source, but it is not currently causing any runner-visible inconsistency. **Reclassify from a live Brain-boundary violation to a dead-code cleanup candidate.**
2. **Proposal-accept `reopenProposal()` gap — PARTIALLY SUPERSEDED, precise scope now established.** `reopenProposal` (via `sayIfTheCardCouldNotBePutBack()`) IS called at `accept/route.ts:255,298,328` — but all three sit inside the LEGACY lane (rows with no stored action, pre-2026-09-05). **Two modern lanes still leave a stale `'accepted'` status on Apply failure with no reopen call**: the `ACTIONCOMPLETE-1` lane (lines 162-166) and the `reprice` lane (lines 223-225). The earlier finding stands, precisely rescoped: it applies to the two modern lanes specifically, not to "the accept flow" generally, and does not apply to legacy-lane rows.
3. **Race projection — number and label are different questions; both findings are TRUE, not contradictory.** The underlying number remains genuinely unified (`race-projection.ts` is confirmed still a pure mapping, both List and Detail call through it). But the **label differs by design in the common live case**: List shows the plate's literal "Projected"; Detail, when the newer "race-pace brain" layer set is present (the normal state for an upcoming race), deliberately **suppresses** its own "Projected" plate (citing Rule 17, no duplicate content) in favor of the actionable layer's own label — `"Run the day at"` or `"Race it at"` depending on pacing control. This is intentional design, not a defect, and this document's earlier "confirmed properly unified" language should be read as about the NUMBER only — it did not verify label parity, and label parity does not hold in the normal case, by design.
4. **Tune-up race "frequency-cap copy branch" — CONTRADICTED.** No such branch exists at the pinned commit. The only frequency-cap logic near race-priority code (`generate.ts:9649-9668`, inside `embedMidBlockRaces`) runs unconditionally regardless of priority by correct design (a runner-level weekly-frequency constraint applies the same regardless of the tune-up race's priority), and it mutates real schedule fields — it is not a text-only copy path. C-race scheduling itself (`generate.ts:9186-9317`) is re-confirmed doctrine-correct and unchanged: pure cutback, no taper, exactly as originally found.

**Standing, unaffected by this reconciliation:** `standing-recommendation.ts`'s single-domain readiness gate (violates the 3-domain convergence doctrine) and `load-activity-evidence.ts`'s date-only intent match (bypasses `day-resolver.ts`) were not part of this reconciliation round and stand as found in v2.

---

## 12. RUNNER-DATA CARRYOVER FINDINGS — confirmed standing, no changes required

Per explicit instruction, these stand from v2 unchanged:
- Pause data: 2 confirmed senders (a "3rd sender" detail was contradicted earlier), discard mechanism confirmed exactly (`clockAudit` persists only when pause FAILS to explain drift), 8/8 real nonzero submissions confirmed lost. **The fully-read Runner Data v2.1 report adds real precision here, folded in**: a genuine manual-vs-automatic pause distinction exists in-app (`pausedAutomatically` flag) but is discarded before the wire and is unrecoverable for every historical row; a third, HealthKit-specific auto-pause signal exists separately; and — critically — **the fix must not collapse into one decision**. Three separable questions: (1) persist the raw fact (near-pure bug fix), (2) display it (open product/UX question), (3) use it in grading (separate, more consequential, explicitly NOT recommended by any pass to date). Any implementation should scope itself to (1) only unless (2)/(3) receive explicit separate sign-off.
- RPE: 13/13 rows confirmed, hardcoded uncited binary threshold, `subjectiveEffort` write-only field, one orphaned row from an absorbed run.
- VDOT-eligibility OR gate: confirmed, worse than originally stated — neither branch checks HR-trace credibility.
- `recoveryExtensions`/`ceilingLift`: confirmed to have a live Run Detail consumer, corrected out of "collected but unused."
- Phase-transition cause: confirmed absent except for two narrow, purpose-built exceptions (`repSkips`, `recoveryEndedEarly`).

---

## 13. SEVERITY TABLE — deltas only from v2 (full table otherwise stands)

| # | Finding | Severity | Change this pass |
|---|---|---|---|
| — | Recovery-honesty field-name gap (§10) | **P0** | Unchanged, now triple-confirmed |
| — | `coach_intents` gap for automatic upward events | **P0** | Now confirmed a pattern of **3** retired-mechanism instances (rows 3/4/5 in §3) plus `positive-drift`'s separate zero-trace history — strengthened, not new |
| — | `HowItWentPanel`'s duplicate HR-drift ladders | ~~P2~~ → **P4** | **Downgraded** — confirmed dead code, not a live boundary violation (§11.1) |
| — | Proposal-accept `reopenProposal` gap | **P1**, unchanged in severity | **Rescoped** to the two modern lanes specifically (§11.2), not the whole accept flow |
| — | Race-projection label divergence (List "Projected" vs. Detail's actionable label) | **P4 — new, working as designed** | Not a defect; named so nobody "fixes" it without realizing it's intentional Rule-17 behavior |
| — | Tune-up race "frequency-cap copy branch" | — | **Removed** — does not exist at the pinned commit |
| — | 2026-09-02 "76 workouts" re-anchor | was implicitly treated as confirmed | **Downgraded to explicitly DISPUTED/UNCONFIRMED** — do not cite the count or date as established fact going forward |
| — | `positive-drift` historical automatic side door | — | **New row, but RETIRED status** — no action needed, named for completeness and as a standing risk if `legacy/web` is ever redeployed |

---

## 14. TESTFLIGHT CONCLUSION — unchanged from v2

The §10 P0 blocks the next TestFlight candidate unless explicitly waived. The two render-dependent open questions (Rose Bowl Half PR-screen check, proposal-13 card wording) remain open — though note §9's `workoutPhasesTile` finding substantially narrows the practical uncertainty around the §9 symptom specifically, even without a literal device render. Internal-build availability remains distinct from physical-verification-safety, per v2's original framing.

---

## 15. RECOMMENDED IMPLEMENTATION ORDER — unchanged ordering from v2, one addition

1. Fix the §10 recovery-honesty field-name gap.
2. Fix the still-live symmetric distance-match band on `watch/workouts/complete/route.ts` (the primary ingestion path).
3. Route `load-activity-evidence.ts` through `day-resolver.ts`.
4. **New**: cut and distribute a TestFlight build once 1-3 land — `154edbf97`'s `workoutPhasesTile` deletion and both WALKBACK merges are already on `main` and would ship automatically, closing the §9 symptom definitively without further engineering.
5. Fix `run-win.ts`'s reintroduced `completed!==false` collapse.
6. Decide and execute on the `coach_intents` gap (now 3 confirmed instances).
7. Migrate `standing-recommendation.ts` onto `convergence.ts`.
8. Add reopen-on-failure to the two modern accept lanes (§11.2).
9. Delete the now-confirmed-dead `AerobicStampPanel`/`ThePLongPanel` code, or wire a real server-computed decoupling value to them if the panel is still wanted.
10. Everything else from v2 §12, unchanged in relative order.

---

## 16. QUESTIONS FOR DAVID — unchanged from v2, one added

All eight from v2 §13 stand. New:

9. **The September 2 "76 workouts" re-anchor's specific scope could not be confirmed from the current schema** — only a class-level signature (23 rows at the post-anchor LTHR value) was found. Is this worth adding a dedicated audit-trail mechanism for (a timestamp column, a dedicated re-anchor log), given it's the second time this exact class of event has proven unreconstructable after the fact?

---

## 17. PROVENANCE

- **Final audit branch:** `audit/brain-forensic-2026-09-10`
- **Base SHA:** `80fca013f94b99ee5af3f84e79590591d42141da`
- **Prior commits on this branch (unchanged, all authored by this track):** `5b41b0d99` (checkpoint), `c99d924ea` (v1), `b23bcd664` (v2)
- **This v2.1 report's commit SHA:** *(recorded immediately below, after commit)*
- **This v2.1 report's file hash:** *(recorded immediately below, after commit)*
- **`origin/main` at time of the Coach-v2 reconciliation (§11), freshly fetched and pinned by that sub-investigation:** `99757c1204f27a1fa86504efd580842bc81c72b2`, confirmed via `git rev-parse HEAD` inside that investigation's own isolated worktree before any claim was checked.

**Exactly what was consumed, and what was not — stated precisely per instruction:**

| Input | How consumed | Read directly? |
|---|---|---|
| `docs/audit-2026-09-09-historical-data-forensic-audit-v2.1.md` | Read in full, this turn, both halves (offset 0 and offset 279) | **Yes** — file hash `d769e1c0733cdd74e5a2683996e86b8faa7a65ea` |
| `docs/audit-2026-09-09-historical-data-forensic-audit-v2-to-v2.1-delta-log.md` | Read in full, this turn | **Yes** — file hash `38a4227a3d90f237aad5284995996caa3938779d` |
| The "9 Coach-audit findings" and "8 Runner-Data findings" reconciled into v2 | These arrived as text relayed inside user messages during that turn, not as files this track read directly | **No — transmitted excerpt, not a file read.** Independently re-verified via this track's own dispatched investigations before being incorporated (see v2's §8/§9 for those investigations' own citations) |
| The "4 Coach-v2 findings" reconciled in §11 above | Same — relayed as text in a user message, then independently re-derived by a dispatched investigation pinned to `99757c120` | **No — transmitted excerpt.** Independently re-verified, not taken on the relaying message's word |
| `docs/audit-2026-09-09-historical-data-forensic-audit-v2.md` (the intermediate v2, distinct from v2.1) | Not opened — superseded by v2.1, which states it corrects v2 in place | **No** |
| `docs/audit-2026-09-09-historical-data-forensic-audit-v1-to-v2-delta-log.md` | Not opened | **No** |
| `docs/audit-2026-09-09-coach-forensic-audit.md` and `docs/reports/coach-audit-2026-09-09/*.md` (4 files) | Not opened — this track only ever received relayed excerpts from these, per the row above | **No** |

**Final `git status --short` at hand-back** (captured after this document's own commit, below): unrelated concurrent-session files remain present, untouched, exactly as in v2's own provenance section — that session's own artifact set has continued growing (now includes v2.1 and its delta log, both now directly read by this track for the first time as of this document) but nothing about it has been merged, committed, or altered by this track at any point across v1, v2, or v2.1.

*No code changes, migrations, or production writes were made in the production of this report.*
