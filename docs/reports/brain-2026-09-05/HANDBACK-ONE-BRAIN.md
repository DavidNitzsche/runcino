# Handback · one brain

**Start `141d025cd` · end `3d6bc1e79`.** Deploy confirmed at the foot of this file.

`AUTOMATIC_ADAPTATION_AUTHORITY` is still `false`. No live plan was written, no
production migration applied, no plan data modified.

---

## 1 · The record, corrected

Every item you listed, answered.

| question | answer |
|---|---|
| **Actual ending commit** | at the foot of this file, with its deployment id |
| **"weekly volume reaches a proposal" vs "threshold pace is the only complete lever"** | **Both were true and the pairing was misleading.** The volume LANE is open (`mark_upgrade` reaches `PROPOSABLE_KINDS` and the V5 card renders it) but nothing GENERATES a `mark_upgrade`, because `tryAdaptiveBump` returns null on its first line. An open lane with no traffic. Threshold pace was "complete" only in the sense that `reanchorActivePlan` fires end to end, and it did so OUTSIDE the authority boundary, which is the defect below. |
| **TestFlight 280 contains** | the V5 proposal card (`ProposalCardV5`, mounted in `TodayBeforeV5`), STUCKCONN-2, the corrected adjudication layer. Source `7998ad4b9`. |
| **TestFlight 281 contains** | everything in 280 plus REQUESTSTORM-1. Source `e4295b1e8`. |
| **Is Move-a-Run on main / deployed / in 280** | `lib/plan/reschedule.ts`, its API route and the iPhone sheet are on main and deployed (`6b8c12c25`). The RS-9 race-proximity fix and the never-delete fix are in 280. It does **not** re-adjudicate: `weekly-demand.ts` reaches `lib/adaptation/**`, a forbidden directory for that surface. |
| **Is the proposal card physically mounted in V5** | **Yes**, and now rendered: `TodayBeforeV5.proposalsSection`. Screenshots under `docs/verification/2026-09-05-v5-proposal-surface/`. |
| **Does reanchorActivePlan rewrite workouts while the flag is false** | **It did.** It never consulted the seam and is called from `snapshot-projections`, an unattended cron. On 2026-09-02 it moved VDOT 46.3 to 47.7 and rewrote 76 workouts. It now declares `COACHING_ADAPTATION` under a named, logged, expiring hold. |
| **Why canonical shadow stopped after 2026-09-03** | **Not established.** Three production rows exist, all from 2026-09-03, all against a plan archived twenty-one minutes later. The fact is verified; the cause is not, and I am not guessing. |
| **394 vs 436 threshold** | Resolved. It was **five** numbers, not two. See below. |

---

## 2 · One brain · what consolidated

Full map in `ONE-BRAIN-CONSOLIDATION.md`. The three that matter:

**One authority boundary.** `MutatePlanOptions.authority` is REQUIRED. Twenty
call sites across seventeen files now declare which of five classes they are.
Adding a writer without classifying it is a compile error.

**`applyAdaptations` could not tell its two callers apart.** The proposal-accept
route and the unattended cron made the same call. That is exactly how a
runner-consented change and an automatic one became indistinguishable at the
write. Authority is now a parameter, threaded from the caller.

**Threshold pace was five numbers.** 430 canonical, 431 legacy, **394 derived
from your 3:00 goal**, 430 persisted, 440 in the adapters' gating anchor.
Widest pair 46 s/mi. The goal side door is deleted and guarded as removed.

---

## 3 · The asymmetry, with its mechanism

`Research/01` gives the UPWARD trigger no session count and the DOWNWARD trigger
"≥2 sessions". `ADAPTATION.training-lead-quantum` parsed the number out of the
**downward** row and pinned it to the **upward** constant.

To go up the engine demanded 2 sessions, a 14-day span, evidence under 28 days
old, and a run as the winner. To come down: none of those. Its only downward
corroboration counted `snapshot_date` rows, which are cron mornings and not
sessions.

Both arms now corroborate through one direction-free helper.

---

## 4 · The banner, and three wrong diagnoses

Your request log settled it. **The app was flooding itself.**

- 281 requests in one session, 156 five minutes earlier
- one burst carrying three `/api/v5/today`, three `/api/v5/block`, three `/api/v5/races`
- ingest POSTs at 5.5 to 6.5 seconds, plan-snapshot at 8.8
- `NSURLErrorDomain Code=-1001 "The request timed out"`

`.faffForegroundRefresh` is posted twice per foreground and observed by eight
files. Plus a seven-request launch prefetch whose own comment says every view
re-fetches anyway.

**STUCKCONN-2 reset the connection pool on three timeouts.** That is right for a
dead connection and wrong for a busy one: it tears down the in-flight requests
and the app re-fires the same burst into a cold pool. I diagnosed twice from the
previous incident's OS log rather than from your device, and shipped both times.

Fixed by coalescing: one in-flight GET per URL, second caller joins the first.
Coalescing rather than throttling, because a throttle DROPS a refresh and a
dropped refresh is how a screen keeps showing a corrected value.

---

## 5 · Held back, and exactly why

- **`reanchorActivePlan`** · `COACHING_ADAPTATION` under a named hold. Owner
  David, blocker "the refusal has nowhere to go until reanchor raises a
  proposal", expiry "reanchor creates a proposal and applies it under
  RUNNER_ACCEPTED". Logged every run.
- **`wire-adjudication`** · still unmerged. 0 of 7 plans promote, six purely for
  absent history.
- **`reshape`** · out of the proposal lane; your 2026-09-02 ruling names it.
- **Three threshold owners** · OPEN with file:line rather than half-migrated.

---

## 6 · Not done, with precise blockers

| item | blocker |
|---|---|
| Durable ledger | **Not built.** The authority boundary logs to console, not to a table. A migration is required and you have not approved one. |
| Reassessment scheduler | **Not built.** Same migration constraint. |
| Generalized action schema | **Partial.** `newDistanceMi` added; pace, dose, repetitions, multi-row still cannot be carried. |
| Orchestration path | **Not built.** |
| Cold start policy | **Not built.** Six of seven plans still fail promotion for absent history. |
| End-to-end demonstrations A-I | **Not run.** They need the ledger and the orchestrator. |

**None of these should be described as operational, and I am not describing
them that way.**


---

## 7 · Ten direct answers

**1 · If I outperform next week, what changes?** `demonstratedVolume` in
`lib/adaptation/volume-evidence/belief.ts`, continuously and confidence-weighted.
Your 2026-06-15 week (47.3 against 45.5) now contributes 27.8% of a step where
it contributed zero. Fatigue moves on a separate channel and always moves.

**2 · If threshold and mileage improve together, what advances?** Volume, then
the long run, then pace, cited to `PROGRESSIVE_BASELINE_DOCTRINE`. The loser is
deferred, not discarded. **This priority is still static; phase-aware
arbitration is not built.**

**3 · When does the deferred change return?** At the next weekly boundary,
through the deferral queue. **In memory only. Its migration is unapplied, so it
does not survive a process restart.**

**4 · What exact proposal appears on my phone?** A card with direction
(PUSH / HOLD / PULL BACK / MOVE / RECOVERY / STOP), a headline, the evidence
sentence, an effective date, a standing, and Do it / Leave it / Details.
Rendered, with screenshots. **Shipped in build 280 and 281.**

**5 · What happens after I accept it?** `/api/plan/workout-proposals/[id]/accept`
rebuilds the action and applies it through `applyAdaptations` under
`RUNNER_ACCEPTED`. **That round trip has not been executed end to end.**

**6 · What reaches my Watch?** One sentence, `sessionMoved.line`, and only for a
moved session. **No other lever reaches the wrist.**

**7 · What survives a plan rebuild?** Today: `plan_workouts` rows and their ids.
**Beliefs, decisions and acknowledgements do not, because the durable ledger
does not exist.** This is the single largest gap.

**8 · Can I move a run and trigger complete re-adjudication?** Move yes,
re-adjudicate no. `weekly-demand.ts` reaches `lib/adaptation/**`, a forbidden
directory for the rescheduling surface.

**9 · Can the ledger see every automatic and runner-approved change?** **No.
There is no ledger.** The authority boundary logs to console.

**10 · Which of the 23 levers are truly complete?** **One: threshold pace**, and
only after tonight's unification. Weekly volume has an open lane with no
generator. Everything else stops before the runner.

---

## 8 · Deployment

    3d6bc1e79   pushed 2026-09-05T10:27:00-07:00
    TestFlight 280   from 7998ad4b9   V5 proposal card, STUCKCONN-2
    TestFlight 281   from e4295b1e8   plus REQUESTSTORM-1

Tests: 10,862 passing, 1 expected fail, zero unexpected failures, 22/22 gates.

Migrations applied to production: **none**.
