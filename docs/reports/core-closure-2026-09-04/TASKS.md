# Core-product closure — TASKS

Branch `core/closure-2026-09-04`, worktree `/private/tmp/core-closure-0904`,
based on `origin/main` @ `72f2f84c`.

**SCOPE, corrected 2026-09-04 mid-session by David:** the products are the
**native iPhone app**, the **Apple Watch app**, and the shared backend / DB /
APIs / coaching, plan and adaptation engines / sync / deploy work those two
require. Browser-facing pages are out of scope and do not count toward the
closure verdict. Living under `web-v2` does not make code web-only — almost all
of it is the native apps' server.

Every row below is labelled: **iPhone** · **Watch** · **shared** (a native
dependency that happens to live server-side) · **web-only**.

Status vocabulary stays separated: **implemented** / **merged** / **deployed** /
**shipped** / **physically verified**.

---

## Scope audit of this session's work

**Result: nothing was web-only. Nothing removed, nothing deferred.**

Checked rather than assumed — the one item that looked web-shaped is not:
`app/api/plan/undo/route.ts` (SEALDATE-1) is called by the iPhone at
`native-v2/Faff/Faff/API+Toolkit.swift:422`
(`POST /api/plan/undo · put the previous training block back`).

| Surface | Items |
|---|---|
| shared → iPhone + Watch | FORMATLINT-1, EXECID-SCAN-1, LABELTRUTH-3, TUNEUPTYPE-1 ratchet, S4 audit, S5 verdict, S7 inventory |
| shared → iPhone | SEALDATE-1, RACENUM-1, SNAPSHOTQUANTITY-1, LIVEDATES-1, LEXICONWORD-1 |
| Watch | WATCHGATE-1, WATCHFALLBACK (the 5th consequence of TUNEUPTYPE-1) |
| web-only | **none** |

---

## Closed this session

| Id | Surface | What | State |
|---|---|---|---|
| FORMATLINT-1 | shared → iPhone + Watch | `spec-card.ts` whole-mile label dedup pinned to one spelling; the only thing keeping `test-full` red on main for three consecutive commits | merged `5104342f`, deployed, **in build 275** |
| SEALDATE-1 | shared → iPhone | 4th date-coincidence-as-completion path in `/api/plan/undo`, which the phone calls, under a comment falsely claiming resolver parity | merged `5104342f`, deployed, **in build 275** |
| EXECID-SCAN-1 | shared → iPhone + Watch | SQL scanner: a surface that stops calling the canonical execution resolver now fails loudly. Falsified both directions | merged `5104342f`, deployed |
| RACENUM-1 | shared → iPhone | Cross-surface race-number gate could not pass anywhere credentials exist; made evidence-aware | merged `28c882ec`, deployed |
| SNAPSHOTQUANTITY-1 | shared → iPhone | Daily projection snapshot removed from an identity contract it can never satisfy; replaced with a Rule 23 freshness check | merged `28c882ec`, deployed |
| LIVEDATES-1 | shared → iPhone | Two live `/api/v5/today` audits pinned to hard-coded dates against a plan the runner legitimately moves | merged `28c882ec`, deployed |
| LEXICONWORD-1 | shared → iPhone | Coach lexicon matched substrings: "Asics **Superb**last 3" reported as hype | merged `28c882ec`, deployed |
| LABELTRUTH-3 | shared → iPhone + Watch | `retitleLeadMi` re-imposed the authoring floor it exists to reconcile away | merged `94a207bb`, deployed |
| TUNEUPTYPE-1 | shared → iPhone + Watch | Attempted, **reverted**; held by a ratchet at 3,475 | merged `94a207bb`, scoped follow-up |
| WATCHFALLBACK | Watch | Known-open defect re-measured at 127 instances; entry restored with evidence after a reverted experiment | merged `94a207bb` |
| WATCHGATE-1 | Watch | `check-watch.sh` had been reporting PARTIAL (board geometry skipped, no booted simulator). Booted one; now **OK, all guards executed** | verified |
| S4-AUDIT | shared → iPhone + Watch | Live 15-week CIM block audited week by week | implemented (audit) |
| S5-VERDICT | shared → iPhone + Watch | Adaptation replay + shadow + promote/hold — **HOLD** | implemented (audit) |
| S7-INVENTORY | shared → iPhone + Watch | Race-number inventory: 9 quantities, one name each, coherent | implemented (audit) |

---

## Open, in priority order

| # | Surface | Item | Blocker |
|---|---|---|---|
| 1 | iPhone + Watch | **Physical-device verification** — PHYSICAL-TESTS.md against build 275 | **David only** |
| 2 | shared → iPhone + Watch | TUNEUPTYPE-1 consumer-side fix (5 sites ask "is this row in a race week") | none — scoped |
| 3 | shared → iPhone + Watch | Adaptation: make the threshold-direction gate readable (85% data blocks) before promotion | none |
| 4 | iPhone | Post-run reconciliation | **collision** — another session is live in `TodayAfterV5`/`v5-today.ts` |
| 5 | iPhone | Today integration | **their handback** |
| 6 | — | S4-1: the long run stops developing six weeks out | **a coaching decision, David's** |

---

## Findings raised, not owned by this session

**VACUOUS-AUDITS · shared → iPhone.** The 16 `*.audit.test.ts` files are
`describe.skipIf(!DATABASE_URL_RO)` and neither CI nor Railway has that
credential. Three were red against production all day while everything reported
green — including the Rule 16 enforcement for every race number the **phone**
renders. **Recommendation:** give `test-full` the read-only credential, or add a
scheduled workflow that runs only the audit files with it.

**NOCI-NATIVE · iPhone + Watch.** No workflow runs either suite. Both green
today (346 and 223), measured by hand. Nothing would have said otherwise. This
is now the highest-value CI gap, since these are the products.

**TFCLAIM-1 · iPhone.** Build 272's commit message credits a fix authored 5h38m
after the build was uploaded. Today-lane; flagged, not touched.

**MOVE-A-RUN · iPhone.** The owner moved his own week by hand in the backend on
2026-09-03, around travel, because the in-app feature does not exist. Explicit
runner-requested rescheduling is in-scope doctrine; the surface is not built.

**S4-3 · shared.** The B-priority 10K is tapered 47% while the B-priority half
gets no taper. Driven by whole-week rounding in doctrine-bound constants.
