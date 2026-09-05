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
| HRCEILING-1 | shared → iPhone + Watch | Threshold sessions graded against a 149 bpm easy-day cap while LTHR is 168 | implemented |
| HRCHANNEL-1 | shared → iPhone + Watch | An absent HR ceiling read as a breached one; every post-ZONEBAND-1 quality session was ungradeable as evidence | implemented |
| HRFLATLINE-1 | shared → iPhone | A held HR value graded as a measurement — 8 distinct bpm across 21 phases | implemented |
| GRADETRACE-1 | shared | The replay records WHY a grade does not count, not just that it does not | implemented |
| NATIVECI-1 | iPhone + Watch | `native-check.yml` — no workflow had ever compiled a Swift file | implemented |
| AUDITCI-1 | shared | `audit-suite.yml` — a skipped production audit now FAILS instead of passing green | implemented |
| TODAY-RECON | iPhone | Today/week-strip handback verified claim by claim; §5 closed | implemented (audit) |
| TUNEUP-RETRACTION | shared | Three fifths of the TUNEUPTYPE-1 finding retracted, with a gate | implemented |

---

## Open, in priority order

| # | Surface | Item | Owner | Blocker |
|---|---|---|---|---|
| 0 | shared → iPhone + Watch | **MOVE-A-RUN** — the runner picks a session and a day; the coach ranks valid options, explains the cost, previews, confirms, and can undo. Weekend-away long run is the acceptance case. One of the two remaining breaks in the loop | next session | none |
| 0 | shared | **Wire `checkPromotion` into plan authoring and adaptation promotion** so the adjudication layer blocks in production, not only in tests | next session | none |
| 0 | shared | **DOSE-RESPONSIVE-TAPER** — nothing re-SIZES a taper dose from Malibu execution, recovery, HR behaviour or recent load. Every reader exists; no writer uses them | next session | none |
| 1 | iPhone + Watch | **Ship the integrated build** — everything below the line is merged and unshipped | next session | none |
| 2 | iPhone + Watch | **Physical device pass** — SMOKE (6 min) then the rest of PHYSICAL-TESTS.md | **David** | a device |
| 3 | shared | Adaptation promotion — shadow period on production + retire the 3 legacy mutators in ONE change | **David** (live authority) | calendar time, then a decision |
| 4 | shared | `audit-suite.yml` needs the `DATABASE_URL_RO` repository secret | **David** | a credential only he can add |
| 5 | shared | S4-1 · the long run stops developing six weeks out | **David** (coaching call) | see BASELINE-PLAN-AUDIT |
| 6 | iPhone | Display-side flat-line HR — `runPhases` still surfaces a held value to the runner; HRFLATLINE-1 is scoped to evidence only | next session | none |
| 7 | shared | `_durability_anchor.audit.test.ts` flakes at vitest's 5s default under full-suite load against the live DB | next session | none |
| 8 | shared | S4-3 · the B 10K is tapered harder than the B half (whole-week rounding in doctrine-bound tables) | table owner | doctrine |
| 9 | iPhone | MOVE-A-RUN not built — the runner moved his week by hand in the backend | parked | product decision |
| 10 | iPhone | TFCLAIM-1 · build 272's commit message credits a fix authored 5h38m after upload | resolved by construction in the next build's mapping | none |

### Merged, deployed, NOT shipped — the whole point of the next build

| Item | Commit | Surface |
|---|---|---|
| REDUNDANT-PACE-1 · work pace no longer repeats the header | `39d69b71` | iPhone |
| ACTIVITY-PLACEMENT-1 · activity renders under the hero | `39d69b71` | iPhone |
| TODAYSHELL-1, HEROPANEL-1, STALEDEBOUNCE-1, CACHEDAT-1, PANELMOTION-2 | various | iPhone |
| WORKOUTPHASES-1/2, HRPHASE-1, HRGRADE-1 | `645d540e`, `ea901bea`, `0e80296d` | iPhone |

`WORKOUTPHASES-1/2` ARE in build 275; the rest are not. Exact per-build
ancestry is in `TODAY-RECONCILIATION.md` and the final HANDBACK.

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
