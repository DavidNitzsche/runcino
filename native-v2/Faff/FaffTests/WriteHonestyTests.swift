//
//  WriteHonestyTests.swift
//  faff.run iPhone · TODAYWRITE-1's own coverage.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT WENT WRONG
//
//  A Product Experience review drove the real app with the niggle and sick
//  writes failing, and verified the result four ways — the rendered screen, a
//  direct query against the database, the network log, and the code. Today
//  said:
//
//      "Left calf flagged · The coach has it, it shapes tomorrow"
//      "Reported · Logged. Today rests."
//
//  with ZERO rows written for either. Two halves, both required:
//
//   1 · `HostsV5.swift` destroyed the answer. `flagNiggle`, `reportSick`,
//       `checkInNiggle`, `logSickTrend` and `pickShoe` all ended
//       `_ = try? await API.authedSend(req)` (or the `API.post*` equivalent),
//       so nothing above them could know whether the write landed — and
//       `API.authedSend` does not even throw on a 500, so a `try?` was not
//       the only thing being swallowed.
//
//   2 · The views moved their own `@State` to the CONFIRMED row's copy in
//       the button's action handler, before any answer existed.
//
//  Either half alone is survivable; together they are a coach asserting it
//  has a runner's pain on file when it has nothing. It is Rule 11 at a
//  write — LANDED, DID-NOT-LAND and CANCELLED are three facts — and the same
//  discipline `TodayAfterV5.performStravaPush` already followed in the same
//  file ("only flips to `.done`/`.dup` on the server's own confirmed status,
//  never optimistically, per the bug this replaced").
//
//  ─────────────────────────────────────────────────────────────────────────
//  RULE 22 · WHAT THIS GATE CANNOT FAIL ON
//
//  · It cannot fail on the RENDERING. These cases drive the pure decisions —
//    `v5WriteSettlement`, `v5SettleWrite`, `V5RowWriteState.settled`, and the
//    two copy tables — not a view hierarchy. Whether `niggleRow` actually
//    draws `ErrorNote` for `.failed`, and whether that Retry is reachable
//    with a finger, is a claim only a screenshot against a real failing
//    write settles. Both were verified that way on device for this change;
//    nothing here would notice if a later edit dropped either.
//
//  · It cannot fail on the WIRING. It proves the settlement is computed
//    correctly and that the copy is gated on it. It does NOT prove that
//    `TodayHostV5` hands each view the right closure, or that `Self.ok(_:)`
//    is the status check every one of the five actually calls — that is a
//    one-line reading at five call sites.
//
//  · It cannot fail on a write that LANDS AND LOSES ITS RESPONSE. That is a
//    genuinely different fact (`V5WriteSettlement.didNotLand`'s own doc says
//    so), and neither the wire nor this suite can currently tell it from a
//    refusal. A row that says "not saved" about something the server did in
//    fact save is a known, argued-for cost of the two-state settlement.
//
//  · It says NOTHING about how likely any of these failures are. Only that
//    when one arrives, no row claims the coach has something it does not.
//
//  ─────────────────────────────────────────────────────────────────────────
//  DISTRIBUTION (Rule 22 · check both sides, not just the count)
//
//  Every settlement gets both directions: a failed write must not show the
//  confirmed copy, AND a successful write must still show it. An engine that
//  never confirms anything would pass a suite that only checked the first,
//  and would be just as wrong.
//

import XCTest
@testable import Faff

final class WriteHonestyTests: XCTestCase {

    // MARK: - The settlement itself
    //
    // `succeeded` is "the server answered 2xx", never "the call returned" —
    // `API.authedSend` hands back a 500 without throwing, which is why the
    // hosts compute it from the real status code.

    func testATwoHundredIsALandedWrite() {
        XCTAssertEqual(v5WriteSettlement(.success(true)), .landed)
    }

    func testANonSuccessStatusDidNotLand() {
        XCTAssertEqual(v5WriteSettlement(.success(false)), .didNotLand)
    }

    func testATransportFailureDidNotLand() {
        XCTAssertEqual(v5WriteSettlement(.failure(URLError(.notConnectedToInternet))), .didNotLand)
        XCTAssertEqual(v5WriteSettlement(.failure(URLError(.timedOut))), .didNotLand)
    }

    /// The runner's own navigation tearing the write down is not a failure.
    /// Both cancellation shapes, for the same reason `API.isCancellation`
    /// checks both — which one `URLSession` throws is not guaranteed.
    func testBothCancellationShapesSettleAsCancelled() {
        XCTAssertEqual(v5WriteSettlement(.failure(CancellationError())), .cancelled)
        XCTAssertEqual(v5WriteSettlement(.failure(URLError(.cancelled))), .cancelled)
    }

    func testAnUnrelatedErrorIsAFailureNotACancellation() {
        struct SomeOtherError: Error {}
        XCTAssertEqual(v5WriteSettlement(.failure(SomeOtherError())), .didNotLand)
    }

    // MARK: - `v5SettleWrite` · the one place the do/catch lives

    func testSettleWriteReportsARealSuccess() async {
        let settlement = await v5SettleWrite { true }
        XCTAssertEqual(settlement, .landed)
    }

    func testSettleWriteReportsANonSuccessStatus() async {
        let settlement = await v5SettleWrite { false }
        XCTAssertEqual(settlement, .didNotLand)
    }

    func testSettleWriteReportsAThrowRatherThanSwallowingIt() async {
        struct Boom: Error {}
        let settlement = await v5SettleWrite { throw Boom() }
        XCTAssertEqual(settlement, .didNotLand)
    }

    func testSettleWriteDoesNotDressACancellationAsAFailure() async {
        let settlement = await v5SettleWrite { throw URLError(.cancelled) }
        XCTAssertEqual(settlement, .cancelled)
    }

    // MARK: - The row's state machine
    //
    // `.done` is the state every fabricated sentence was drawn from. This is
    // the line: it is reachable from `.landed` and from nothing else.

    func testOnlyALandedWriteReachesDone() {
        XCTAssertEqual(V5RowWriteState.settled(.landed, token: "Left calf"), .done("Left calf"))
        XCTAssertEqual(V5RowWriteState.settled(.didNotLand, token: "Left calf"), .failed("Left calf"))
        XCTAssertEqual(V5RowWriteState.settled(.cancelled, token: "Left calf"), .idle)
    }

    /// The failure keeps the token, so Retry resends what the runner
    /// actually picked rather than whatever the row shows by then.
    func testAFailedStateRemembersWhatWasSubmitted() {
        XCTAssertEqual(V5RowWriteState.settled(.didNotLand, token: "Achilles").token, "Achilles")
    }

    func testOnlySendingCountsAsInFlight() {
        XCTAssertTrue(V5RowWriteState.sending("x").isSending)
        XCTAssertFalse(V5RowWriteState.idle.isSending)
        XCTAssertFalse(V5RowWriteState.done("x").isSending)
        XCTAssertFalse(V5RowWriteState.failed("x").isSending)
    }

    // MARK: - The niggle row's own words
    //
    // Asserting the SHAPE of what the runner reads, not the absence of a bad
    // string — an absence-only assertion is satisfied by garbage (Rule 13 §3).

    func testAFlagThatLandedSaysTheCoachHasIt() {
        let state = V5RowWriteState.settled(.landed, token: "Left calf")
        let copy = TodayAfterV5.niggleCopy(state)
        XCTAssertEqual(copy?.label, "Left calf flagged")
        XCTAssertEqual(copy?.sub, "The coach has it \u{00B7} it shapes tomorrow")
    }

    /// THE DEFECT, DIRECTLY. Before this change, this exact state produced
    /// the copy asserted above.
    func testAFlagThatDidNotLandNeverSaysTheCoachHasIt() {
        let state = V5RowWriteState.settled(.didNotLand, token: "Left calf")
        let copy = TodayAfterV5.niggleCopy(state)
        XCTAssertEqual(copy?.label, "Left calf")
        XCTAssertEqual(copy?.sub, "Not saved")
        XCTAssertNotEqual(copy?.sub, "The coach has it \u{00B7} it shapes tomorrow")
    }

    func testAFlagStillInFlightClaimsNothingInThePastTense() {
        let copy = TodayAfterV5.niggleCopy(.sending("Left calf"))
        XCTAssertEqual(copy?.sub, "Sending")
        XCTAssertFalse(copy?.label.hasSuffix("flagged") ?? false)
    }

    /// A cancelled write leaves the picker, which has no settled copy at all.
    func testACancelledFlagLeavesNoSettledSentence() {
        XCTAssertNil(TodayAfterV5.niggleCopy(V5RowWriteState.settled(.cancelled, token: "Left calf")))
    }

    /// Walk every state and assert the confirmed sentence appears exactly
    /// once across the whole machine. A future edit that reuses it for
    /// `.sending` or `.failed` fails here even if the two cases above are
    /// updated to match.
    func testTheConfirmedSentenceBelongsToExactlyOneState() {
        let states: [V5RowWriteState] = [.idle, .sending("Left calf"), .done("Left calf"), .failed("Left calf")]
        let confirmed = states.filter { TodayAfterV5.niggleCopy($0)?.sub == "The coach has it \u{00B7} it shapes tomorrow" }
        XCTAssertEqual(confirmed.count, 1)
        XCTAssertEqual(confirmed.first, .done("Left calf"))
    }

    // MARK: - The sick report row's own words
    //
    // "Today rests" is a claim about the PLAN. The plan only rests once the
    // server has the report.

    func testASickReportThatLandedSaysThePlanRests() {
        let copy = SickReportRowV5.copy(for: V5RowWriteState.settled(.landed, token: "sick_report"))
        XCTAssertEqual(copy.label, "Reported")
        XCTAssertEqual(copy.sub, "Logged. Today rests.")
        XCTAssertTrue(SickReportRowV5.isReported(V5RowWriteState.settled(.landed, token: "sick_report")))
    }

    /// THE DEFECT, DIRECTLY.
    func testASickReportThatDidNotLandNeverSaysThePlanRests() {
        let state = V5RowWriteState.settled(.didNotLand, token: "sick_report")
        let copy = SickReportRowV5.copy(for: state)
        XCTAssertEqual(copy.label, "Not sent")
        XCTAssertEqual(copy.sub, "The coach has not seen this yet")
        XCTAssertNotEqual(copy.sub, "Logged. Today rests.")
        // And the form stays available, so the report is not stranded.
        XCTAssertFalse(SickReportRowV5.isReported(state))
    }

    func testASickReportStillInFlightClaimsNothing() {
        let copy = SickReportRowV5.copy(for: .sending("sick_report"))
        XCTAssertEqual(copy.label, "Sending")
        XCTAssertFalse(SickReportRowV5.isReported(.sending("sick_report")))
    }

    /// A cancelled report returns the row to its untouched invitation rather
    /// than to either verdict.
    func testACancelledSickReportReturnsToTheInvitation() {
        let state = V5RowWriteState.settled(.cancelled, token: "sick_report")
        XCTAssertEqual(SickReportRowV5.copy(for: state).label, "Not feeling right")
    }

    func testThePlanRestsSentenceBelongsToExactlyOneState() {
        let states: [V5RowWriteState] = [.idle, .sending("sick_report"), .done("sick_report"), .failed("sick_report")]
        let confirmed = states.filter { SickReportRowV5.copy(for: $0).sub == "Logged. Today rests." }
        XCTAssertEqual(confirmed.count, 1)
        XCTAssertEqual(confirmed.first, .done("sick_report"))
    }

    // MARK: - The shared shape, end to end
    //
    // The five writes (`flagNiggle`, `reportSick`, `checkInNiggle`,
    // `logSickTrend`, `pickShoe`) now go through ONE settlement path, so one
    // case covers what five hand-rolled copies used to get wrong
    // independently. This walks a stand-in write from the transport error all
    // the way to the row state, which is the sequence the review measured.

    func testAFailingTransportNeverLeavesARowClaimingSuccess() async {
        for failure in [URLError(.notConnectedToInternet), URLError(.timedOut), URLError(.badServerResponse)] {
            let settlement = await v5SettleWrite { throw failure }
            let state = V5RowWriteState.settled(settlement, token: "Left calf")
            XCTAssertEqual(state, .failed("Left calf"), "\(failure.code)")
            XCTAssertNotEqual(TodayAfterV5.niggleCopy(state)?.sub,
                              "The coach has it \u{00B7} it shapes tomorrow")
            XCTAssertNotEqual(SickReportRowV5.copy(for: state).sub, "Logged. Today rests.")
        }
    }

    /// A non-2xx that never throws — the shape `API.authedSend` actually
    /// produces for a 500, and the one a `try?` could never have caught.
    func testAFiveHundredNeverLeavesARowClaimingSuccess() async {
        let settlement = await v5SettleWrite { false }
        let state = V5RowWriteState.settled(settlement, token: "sick_report")
        XCTAssertEqual(state, .failed("sick_report"))
        XCTAssertEqual(SickReportRowV5.copy(for: state).sub, "The coach has not seen this yet")
    }

    /// The other half of the distribution: a healthy write must still land on
    /// the confirmed copy. Overcorrecting into a row that never confirms
    /// anything is its own defect.
    func testAHealthyWriteStillConfirms() async {
        let settlement = await v5SettleWrite { true }
        XCTAssertEqual(V5RowWriteState.settled(settlement, token: "Left calf"), .done("Left calf"))
        XCTAssertEqual(TodayAfterV5.niggleCopy(.done("Left calf"))?.sub,
                       "The coach has it \u{00B7} it shapes tomorrow")
        XCTAssertEqual(SickReportRowV5.copy(for: .done("sick_report")).sub, "Logged. Today rests.")
    }
}
