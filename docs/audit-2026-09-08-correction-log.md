# Correction log — faff.run Master Status Audit (2026-09-08)

This is the material-change log for the reconciliation pass David requested over `docs/audit-2026-09-08-full-status-master-report.md`. No product code was changed producing this log or the report edits it describes — this is a documentation-only correction pass over evidence already gathered. Organized by David's own numbered brief so each change traces back to the request that produced it.

## 1. Status framing

- Removed the "STATUS: FINAL" vs. "draft pending final review" contradiction. Confirmed both required reviews (final cross-track contradiction reviewer; Exhibit D10's independent UX/IA-and-design reviewer) had actually run — their corrections are already cited throughout the report's own text (§7 items 4-7; the "corrected here after this report's own final review" language in §1/§3). The stale footer was a leftover drafting artifact, not evidence the review hadn't happened; removed and replaced with an explicit statement naming both reviews as complete.
- Replaced the single "STATUS: FINAL" line with five explicit, separate statuses at the top: Audit status (COMPLETE), Report status (CORRECTED), Product status (PARTIAL), Next-TestFlight readiness (BLOCKED), Full-product readiness (NOT ACHIEVED).
- Removed the claim that "two items remain open." That sentence was describing two things this audit's own process could not itself verify (physical/production-speed access), not the number of open product items — the report's own registers list dozens. The corrected top section states this distinction explicitly and points to §10a for the real count and disposition of each.
- Added an explicit statement that every reviewer condition was incorporated into the report's *findings*, not fixed in the *product* — this was implied but never stated outright in the first version, and the first version's "PASS WITH CONDITIONS... applied as a correction" language could be misread as "the defect was fixed."

## 2. Stale statements

- §12's Evidence Engine bullet ("no track directly checked whether that dependency is now satisfied") was stale — the bounded inspection had already run and was already reported under Product Item 7 by the time that bullet was drafted. Replaced with the actual conclusion (two incompatible classifiers, one flatline gap, neither in the sweep corpus) and named required work.
- §12's ownership-ledger bullet ("See the Brain Ownership Ledger exhibit below once it lands") was stale for the same reason — Exhibits A and C had already landed earlier in the same document. Replaced with a pointer to the completed exhibits plus a new prioritization (added as "Exhibit C — Prioritization synthesis").
- Searched the full document for "not yet checked," "once it lands," "pending review," "placeholder," "no track investigated," "to be added," "see below" — no further stale instances found beyond the two above and one benign forward-reference (Exhibit A row 5's "see below," which correctly points to already-included content later in the same document).

## 3. Item-level statuses (one per item, per the report's own rule)

- **Product Item 3 (Run execution):** IMPLEMENTED — VERIFICATION INCOMPLETE → **PARTIAL**. Historical Item 8's simultaneous phone/Watch start gap is now scoped explicitly into this item, since it directly affects recording locks, duplicate-session prevention, and handoff.
- **Product Item 7 (Adaptation):** IMPLEMENTED — VERIFICATION INCOMPLETE → **PARTIAL**. The item's own evidence (universal Migration 166 block, DENSITY dark, VOLUME unable to land cards, broken undo accounting, disagreeing evidence classifiers, pace-anchor bypasses) does not support "implemented."
- **Product Item 9 (Coaching voice):** two statuses (PROVEN COMPLETE / UNKNOWN) → **one status: IMPLEMENTED — VERIFICATION INCOMPLETE.** Sub-findings (mechanical proven, live unknown) preserved as bullets, not item-level statuses.
- **Historical Item 8:** IMPLEMENTED — VERIFICATION INCOMPLETE → **PARTIAL**, matching Product Item 3.
- **Historical Item 12:** two statuses → **one status: IMPLEMENTED — VERIFICATION INCOMPLETE**, matching Product Item 9.
- **Historical Item 14:** two statuses (PROVEN COMPLETE / BLOCKED — REQUIRES DAVID) → **one status: BLOCKED — REQUIRES DAVID.** Build-currency is now described as a completed sub-task, not the item's own status.
- **Historical Item 15:** "See §13 below" → **PARTIAL**, with a one-line rationale.

## 4. Final runner-loop verdict (§13)

- Every row now carries exactly one of YES/PARTIAL/NO/UNKNOWN — no qualified verdicts.
- "Can it build?" renamed to **"Can it build a sound training plan?"** to stop it reading as a software-build/CI claim.
- Added a new row: **"Can the current source build, test, and ship through the required release pipeline?" → NO** (backend CI red; TestFlight 44 commits behind).
- "Can it execute?": YES → **PARTIAL** (simultaneous-start gap; no physical execution ever confirmed).
- "Can it interpret?": "YES, with two confirmed gaps" → **PARTIAL**.
- "Can it explain?": "YES, mechanically; UNKNOWN, live" → **PARTIAL**, one verdict.
- "Can it operate without backend intervention?": kept PARTIAL, but the evidence column now explicitly separates (a) deliberate approval gates, (b) missing product capability, (c) manual operational recovery, (d) one-off stale-data repair — these were previously collapsed into one undifferentiated PARTIAL.

## 5. Release-classification contradictions reconciled

- **Migration 166:** the report previously called it both a high-severity safety/correctness blocker and "does not block release" with no scope statement reconciling the two. Reconciled: it blocks any release that claims adaptation-apply is operational; it does not block a release that explicitly excludes adaptation-apply, provided honest-refusal behavior on visible decision cards is confirmed (flagged UNKNOWN — the one item this correction pass could not resolve from existing evidence). Approval is no longer recommended from the report's own summary alone — a full migration packet (SQL, locking, timeouts, backfill, deployment order, rollback, `DATABASE_URL_RO`-cannot-execute-it proof, independent review) is now a prerequisite, stated in §11 decision 3.
- **Dormant `effective-race-target.ts` field:** Product Item 11 called it a current-release blocker; the Risk Register called it non-blocking. Reconciled to one classification, used in both places: "non-blocking correctness debt; must be fixed, removed, or guarded before any consumer is added."
- **Shoes DB-error swallowing:** reclassified from "non-blocking polish" to "low-severity correctness/honesty debt" with an explicit disposition (does not block the next internal TestFlight; should not be carried to a broader release).
- **Strava webhook reconcile:** reclassified from "CI/release-integrity blocker" to "reliability/operations gap (Rule 23 shape), not a CI defect," with an explicit disposition (acceptable for the next internal-only TestFlight given existing per-event alerting; required before any broader beta).
- **Today/Block/Races outage-recovery:** "unconfirmed severity — could be release-blocking" → **"CONDITIONAL BLOCKER — MUST REPRODUCE AGAINST PRODUCTION SPEED,"** a disposition rather than a hedge.

## 6. Next-release scope rebuilt (new §10a)

Added a new section, §10a, with a 23-row release-decision table covering every candidate blocker named across the rest of the document (CI failures, identity bypasses, Settings defects, HR-flatline, travel misreading, simultaneous start, Migration 166, undo accounting, reprice rendering, Row 12, all four confirmed release-blocking UX/design defects, outage-recovery, TestFlight lag, physical verification, Strava). Each row carries severity, confirmed/suspected, reachability, runner impact, safety impact, required fix, dependency, owner, and an explicit YES/NO/CONDITIONAL disposition for the next internal TestFlight, with rationale. This replaces the first version's narrower five-item "smallest defensible scope" in §11, which the review correctly identified as omitting more than a dozen items this same report called blockers elsewhere.

## 7. UX/IA and design-system exhibits integrated (new §D11)

Added Exhibit D11 (screen/state inventory, palette/token compliance, typography compliance including the 14-site `.system()` font violation, spacing/geometry — disclosed as a gap, not audited — six-gradient compliance with the shared-hex/`ThemeV5.swift` exemption note, signal-orange — disclosed as not separately audited, label-grammar — partial, green-as-grade violations with the explicit live-vs-legacy scope boundary, component inventory/duplication map with the same scope boundary, a Nielsen matrix stating plainly that only 4 of 10 heuristics were assessed (H2/H3/H6/H7/H9/H10 are UNKNOWN, not assumed to pass), iOS convention findings, an honest disclosure that no full Dynamic Type/device matrix was built, a terminology dictionary (partial), an iconography inventory (partial), and a merged KEEP/REFINE/RESTYLE/UNIFY/REMOVE/CREATE register with five-tier priority). Corrected D8's evidence language to distinguish render-sample, render-with-production-data, source-inspection, and production-query evidence types rather than treating a source trace or a DB query as equivalent to a render.

## 8. Modelled-value tilde conflict

Identified and did not silently resolve: CLAUDE.md's own current design-source-of-truth text still names the amber `~` mark as locked, current handoff language; this audit separately found the mark deliberately retired 2026-08-21 and the code correctly implementing that retirement, with two documents (a header comment and the external design-contract doc) stale against it. Classified `BLOCKED — REQUIRES DAVID` and added as David decision 5 with five explicit sub-questions, rather than assuming the code's current behavior is the intended one.

## 9. Evidence ledger completed (§6)

Replaced the "selected load-bearing items" framing with a complete ledger: the original 10-row load-bearing table (retained, unchanged, as §6a) plus a full pass over all 27 Product items (§6b) and all 15 Historical items (§6c), each with whatever commit/reviewer/test/production/physical evidence exists in the document — cells with no independently captured evidence are marked "—" rather than padded.

## 10. Evidence-language precision

- "No physical-device verification of anything has ever been closed... at any point" → "No documented physical-device verification was found in the repository, reports, and records reviewed... this audit can prove the absence of a record, not that no physical action was ever privately taken" (§1, §2, Historical Item 8/14, §13).
- Added a new "how to read every evidence claim" note (before §2) distinguishing deploy-success-proves-deployment, HTTP-reachability-proves-the-checked-endpoint, code-presence-proves-implementation-not-runtime-behavior, a-test-count-proves-its-own-assertions, and a-render-is-not-physical-verification — five caveats that were previously implicit or stated once and not consistently applied.
- Specified the exact 5 endpoints behind the previously-unqualified "every checked endpoint" Railway-reachability claim.

## 11. Remaining internal inconsistencies (David's numbered list)

All 15 items in David's own "resolve these explicitly" list are addressed by the changes above; the two not otherwise covered:
- Product Item 19 (onboarding UNKNOWN) vs. D10's "onboarding was not under-covered" — clarified as two different claims: render-catalog coverage exists (5 entries + full Settings render); complete onboarding-flow *behavior* was not audited. The UNKNOWN now names the flow specifically.
- The "no component duplication" claim was already scoped to "the live layer" in most instances on inspection; Exhibit D11i now states the scope boundary explicitly and names the compiled legacy exceptions (two Settings implementations, `ActivityView`, `TodayView`) so the boundary isn't left to inference.

## 12. CI remediation language

- Replaced "raise the skip ceiling from 120 to 205" with a category-aware policy (credential-blocked / DB-dependent / expected-failure / explicitly-disabled / unexpected-and-uncategorized buckets, each ratcheted independently, failing only when the unexpected bucket grows).
- Added explicit `DATABASE_URL_RO` scoping requirements (least-privilege, trusted-workflow-only, no log exposure, both credential-present and credential-absent paths independently tested).
- Replaced "decide bump vs. re-pin" for `_belief_source_pins.test.ts` with an explicit decision procedure (determine whether behavior actually changed before choosing either path; independent reviewer sign-off required either way).
- Added a requirement that the format-lint fix branch (`e46eab476`) be independently re-reviewed and the full suite re-run before merge, since it predates 44+ commits of drift and its original approval cannot be assumed to still hold cleanly.

## 13. Architectural findings preserved

No architectural finding was deleted or downgraded in this pass — Exhibits A, B, C, and D and their sub-findings (7-8 adaptation mechanisms, two evidence classifiers, 20 belief rows, 12 state predicates, 6 dedup strategies, 5 race-protection implementations, the runtime-diffing-vs-static-registry recommendation) are all still present. A new prioritization pass was added (Exhibit C's synthesis table) so they carry explicit disposition without being flattened into the next-release scope.

## 14. Systematic cliff-sweep recommendation

Unchanged in substance (still a bounded, multi-day, two-stage architecture-quality task, not scheduled as part of the next release) — Exhibit B and §12 tier 3 already stated this correctly in the first version; no material correction was needed here beyond what's already reflected in §10a's disposition of the sweep as "NO — deferred."

## 15. David decision list rebuilt (§11)

Replaced the first version's 7-item list with a 12-item list containing only genuine product/production decisions, in dependency order: next-release scope (pointing to §10a), whether adaptation-apply is in scope, Migration 166 approval (gated on the new migration packet), the row-12 fix, the amber-tilde conflict, `is_peak`/`selectionRationale`/phase-answer fields, `RunLogV5` feature parity, VDOT placement, Health screen timing, HealthKit dry-run sequencing, adaptation-mechanism consolidation timing, and notification-history timing.

## 16. Deliverable and artifact preservation

This log, the corrected master report, and the two Pass-1 raw reports are being committed together in one documentation-only commit (no application code) once this correction pass is confirmed complete, so this correction — like the report it corrects — does not become the next untracked "final" record. See the commit referenced in the session's own closing message for the exact SHA.
