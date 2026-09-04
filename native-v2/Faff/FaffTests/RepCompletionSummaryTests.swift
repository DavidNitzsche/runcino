//
//  RepCompletionSummaryTests.swift
//  faff.run iPhone · does "N of N completed" ever claim more than the data proves.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS EXISTS
//
//  COMPLETION-STATE-1 (2026-09-05), David's own words: "Today and Run Detail
//  cannot say '4 of 4 completed' when the wire has no explicit completion
//  status and the implementation is counting returned rep records." The bug
//  was `verdict.ts`'s `n.completed !== false`, which read a genuinely
//  unknown completion signal as a confirmed "yes" — the exact shape Rule 11
//  exists to forbid.
//
//  `repCompletionSummary` (`RepBreakdownV5.swift`) is the fix: a pure
//  function from a list of per-rep `RepRecordState` to the weakest claim the
//  data supports. This file exercises it directly, against synthetic
//  states, rather than against a rendered run — the six cases the closure
//  pass asked to be verified (complete / ended-early / partial-final-rep /
//  skipped-rep / extra-rep / incomplete-phase-data) do not all occur
//  together in any one real fixture on hand, and hand-editing a fixture's
//  JSON to fake one would be exactly the fabrication Rule 13 forbids for a
//  RENDER. Testing the resolver's own logic directly is the honest way to
//  prove it, and `RunDetailV5.workCompletion` / `TodayAfterV5
//  .repCompletionGrid` are the two real call sites that feed it genuine
//  wire data — see the render verification in the round's handback for the
//  cases those two DO have real fixtures for (all-complete, on both
//  RunDetail and Today).
//

import XCTest
@testable import Faff

final class RepCompletionSummaryTests: XCTestCase {

    // MARK: - 1 · complete

    func testAllCompletedMatchingPlanned() {
        let s = repCompletionSummary(states: [.completed, .completed, .completed, .completed], planned: 4)
        XCTAssertEqual(s?.label, "Completed")
        XCTAssertEqual(s?.value, "4 of 4")
        XCTAssertNil(s?.sub)
    }

    func testAllCompletedNoPlannedKnown() {
        // Today, currently: no prescribed rep count on the wire. Still
        // allowed to say "completed" — every recorded rep IS confirmed so.
        let s = repCompletionSummary(states: [.completed, .completed, .completed, .completed], planned: nil)
        XCTAssertEqual(s?.label, "Completed")
        XCTAssertEqual(s?.value, "4 of 4")
        XCTAssertNil(s?.sub)
    }

    // MARK: - 2 · ended-early / partial-final-rep

    func testPartialFinalRepEndedEarly() {
        let s = repCompletionSummary(states: [.completed, .completed, .completed, .partial], planned: 4)
        XCTAssertEqual(s?.label, "Completed")
        XCTAssertEqual(s?.value, "3 of 4")
        XCTAssertEqual(s?.sub, "1 ended early")
    }

    func testMultiplePartial() {
        let s = repCompletionSummary(states: [.completed, .partial, .partial], planned: nil)
        XCTAssertEqual(s?.value, "1 of 3")
        XCTAssertEqual(s?.sub, "2 ended early")
    }

    // MARK: - 3 · skipped-rep — a decision, never a lapse (rep_skips)

    /// SKIP-TRANSPARENCY-1, 2026-09-05. David, directly: "Do not turn four
    /// prescribed reps with one chosen skip into '3 of 3 completed.' That
    /// can imply only three were prescribed." A chosen skip still has a
    /// phase record, and is one of the RECORDED reps — the denominator must
    /// not shrink to hide it.
    func testChosenSkipNamedAgainstTheFullPrescribedCount() {
        let s = repCompletionSummary(states: [.completed, .completed, .completed, .skipped], planned: nil)
        XCTAssertEqual(s?.label, "Completed")
        // NOT "3 of 3" — that reads as though only three reps ever existed.
        XCTAssertEqual(s?.value, "3 of 4")
        XCTAssertEqual(s?.sub, "1 intentionally skipped")
    }

    /// The exact four-reps-one-skip shape from David's own example, with an
    /// explicit `planned` too (Run Detail's real case, via
    /// `planned_spec.rep_count`) — confirms the denominator is the
    /// prescribed count whether it comes from `planned` or from the
    /// recorded set itself.
    func testFourPrescribedOneChosenSkipReadsAsThreeOfFour() {
        let s = repCompletionSummary(states: [.completed, .completed, .completed, .skipped], planned: 4)
        XCTAssertEqual(s?.value, "3 of 4")
        XCTAssertEqual(s?.sub, "1 intentionally skipped")
    }

    func testSkipAndPartialCombine() {
        let s = repCompletionSummary(states: [.completed, .partial, .skipped], planned: nil)
        // Three reps recorded (one completed, one partial, one skipped) —
        // the denominator is the full three, not two.
        XCTAssertEqual(s?.value, "1 of 3")
        XCTAssertEqual(s?.sub, "1 ended early, 1 intentionally skipped")
    }

    // MARK: - 4 · extra-rep — more recorded than the plan prescribed

    func testExtraRepRecordedBeyondPlanned() {
        let s = repCompletionSummary(states: [.completed, .completed, .completed, .completed, .completed], planned: 4)
        // "Completed" is not licensed for the total here — the plan asked
        // for four; a fifth is a fact about what happened, not a claim
        // about a fifth thing having been "completed" against nothing.
        XCTAssertEqual(s?.label, "Recorded")
        XCTAssertEqual(s?.value, "5")
        XCTAssertEqual(s?.sub, "1 more than planned")
    }

    // MARK: - 5 · missing-rep — fewer recorded than the plan prescribed

    func testMissingRepBelowPlanned() {
        let s = repCompletionSummary(states: [.completed, .completed, .completed], planned: 4)
        XCTAssertEqual(s?.label, "Completed")
        XCTAssertEqual(s?.value, "3 of 4")
        XCTAssertEqual(s?.sub, "1 missing")
    }

    // MARK: - 6 · incomplete-phase-data — the wire never said either way

    func testUnknownCompletionNeverClaimsCompleted() {
        let s = repCompletionSummary(states: [.unknown, .unknown, .unknown, .unknown], planned: 4)
        // THE CENTRAL CLAIM THIS PASS EXISTS TO FIX: four reps arrived, none
        // of them carrying a completion signal — this must never read
        // "4 of 4 completed", the exact defect a coercion produced.
        XCTAssertEqual(s?.label, "Recorded")
        XCTAssertEqual(s?.value, "4")
        XCTAssertFalse(s?.label.lowercased().contains("complete") ?? true)
    }

    func testOneUnknownAmongOthersStillWithholdsCompleted() {
        // Even ONE unresolved rep is enough to withhold the claim for the
        // whole set — "3 of 4 completed, one unknown" would still assert
        // three definite completions the data may not support as cleanly
        // once one rep's signal is missing; the honest, simple claim is the
        // bare count.
        let s = repCompletionSummary(states: [.completed, .completed, .completed, .unknown], planned: 4)
        XCTAssertEqual(s?.label, "Recorded")
        XCTAssertEqual(s?.value, "4")
    }

    // MARK: - edges

    func testEmptyStatesReturnsNil() {
        XCTAssertNil(repCompletionSummary(states: [], planned: nil))
    }
}
