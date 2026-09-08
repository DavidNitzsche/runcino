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
//  · It cannot DETECT a write that lands and loses its response. Neither the
//    wire nor this suite can tell that from a refusal, and TODAYWRITE-2 does
//    not change that — the settlement is still two-state on purpose.
//
//    What TODAYWRITE-2 DID change is what the row is allowed to SAY about it.
//    The paragraph that used to stand here called a row reading "not saved"
//    over a row the server had in fact saved "a known, argued-for cost". It
//    was not a cost worth paying: `/api/sick` and `/api/niggle` were bare
//    INSERTs, so the Retry that copy invited inserted a SECOND active episode,
//    and the recovery endpoints cleared only the newest — the first stayed
//    active forever and the runner stayed in forced rest. Proven end to end
//    against a production clone with a forward-then-discard proxy.
//
//    So the copy tables below now assert the honest shape, and
//    `testNoFailureCopyAssertsWhatTheServerDid` walks every failure sentence
//    the five write helpers can draw and fails on any that claims to know.
//    What this file still cannot see is whether the SERVER-side dedup holds;
//    that is `_write_idempotency_scan.test.ts` plus the live repro.
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
import SwiftUI
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
        XCTAssertEqual(copy?.sub, "Not confirmed")
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
        XCTAssertEqual(copy.label, "Not confirmed")
        XCTAssertEqual(copy.sub, "The coach may not have this yet")
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
        XCTAssertEqual(SickReportRowV5.copy(for: state).sub, "The coach may not have this yet")
    }

    // MARK: - TODAYWRITE-2 · no failure sentence claims to know what the
    //         server did
    //
    // `.didNotLand` means "it did not land, OR WE COULD NOT TELL" — its own
    // doc says so. `API.authedSend` bounds a request at 12 seconds, so a
    // write that reaches the server, commits, and answers slowly arrives
    // here identical to one that never left. Proven against a production
    // clone: the row was written, the client saw an empty reply, the copy
    // read "Nothing was written", the Retry it invited inserted a SECOND
    // active episode, and "recovered" then cleared only the newer one.
    //
    // So: the row may state what THE PHONE knows, and may hedge what might
    // follow. It may not assert what the server did.

    /// The banned shape, as the runner would read it. Each entry is a
    /// sentence fragment that asserts a fact about the SERVER — every one of
    /// them was live copy before this change.
    private static let confidentServerClaims = [
        "nothing was written",
        "did not save",
        "did not send",
        "has not seen",
        "not saved",
        "not sent",
        "has not changed",
        "still has yesterday",
        "still logged against",
    ]

    /// THE GATE. Walks every sentence any of the five write helpers can draw
    /// in its failure state — the shared `ErrorNote` sentences AND both row
    /// copy tables — and fails on any that claims to know.
    ///
    /// Falsified before landing: restoring any one of the five original
    /// literals fails this, naming the sentence and the phrase.
    func testNoFailureCopyAssertsWhatTheServerDid() {
        var sentences = V5UnconfirmedCopy.all
        sentences.append(TodayAfterV5.niggleCopy(.failed("Left calf"))?.sub ?? "")
        let sick = SickReportRowV5.copy(for: .failed("sick_report"))
        sentences.append(sick.label)
        sentences.append(sick.sub)

        // 4 shared ErrorNote sentences + the niggle row's sub + the sick
        // row's label and sub. A drop here means the walk got narrower, not
        // that the app got safer.
        XCTAssertEqual(sentences.count, 7, "a sentence was dropped from the walk, not from the app")

        for sentence in sentences {
            let lower = sentence.lowercased()
            for claim in Self.confidentServerClaims {
                XCTAssertFalse(
                    lower.contains(claim),
                    """
                    THE DEFECT: "\(sentence)" asserts "\(claim)".
                    `.didNotLand` cannot tell a refusal from a write that landed and
                    lost its answer, so this sentence is false whenever the latter
                    happened. Say what the phone knows, not what the server did.
                    """)
            }
        }
    }

    /// The other direction (Rule 22). Copy that claims nothing at all is not
    /// honest, it is useless — a runner who taps and sees nothing cannot tell
    /// a failure from a dead button. Every failure sentence must still SAY
    /// something and must still invite the retry.
    func testEveryFailureSentenceStillTellsTheRunnerSomething() {
        for sentence in V5UnconfirmedCopy.all {
            XCTAssertTrue(sentence.lowercased().contains("not confirmed"),
                          "a failure must name itself as unconfirmed: \(sentence)")
            XCTAssertTrue(sentence.lowercased().contains("trying again is safe"),
                          """
                          \(sentence)
                          The runner is told a retry is safe because `/api/sick` and
                          `/api/niggle` de-duplicate an identical ACTIVE report. If
                          that server guard is ever removed, this clause becomes a
                          second false claim and must go with it.
                          """)
            XCTAssertFalse(sentence.contains("—"), "coach voice carries no em dashes")
            XCTAssertFalse(sentence.contains("!"), "coach voice carries no exclamation marks")
        }
    }

    /// Rule 16 · the niggle flag and the flare check-in are the same
    /// situation, so they are the same sentence rather than two literals that
    /// can drift.
    func testThePainReportFailureIsOneSentenceNotTwo() {
        XCTAssertEqual(V5UnconfirmedCopy.coachMayNotHaveIt,
                       V5UnconfirmedCopy.coachMayNotHaveIt)
        XCTAssertEqual(Set(V5UnconfirmedCopy.all).count, V5UnconfirmedCopy.all.count,
                       "two sentences in the table are identical — collapse them into one name")
    }

    /// The shoe note names the pair the SCREEN is still showing. That is a
    /// fact about this screen, true in both worlds, because the reload only
    /// runs on `.landed`.
    func testTheShoeFailureNamesTheScreenNotTheDatabase() {
        let s = V5UnconfirmedCopy.shoePick(current: "Vaporfly 3")
        XCTAssertTrue(s.contains("Vaporfly 3"))
        XCTAssertTrue(s.contains("still shows"), "must describe the screen")
        XCTAssertFalse(s.lowercased().contains("still logged"), "must not describe the database")
    }

    // MARK: - TODAYWRITE-2 · a view with no handler wired fails SAFE
    //
    // Every one of these closures defaulted to `{ _ in .landed }`, so any
    // screen that forgot to pass a real handler FABRICATED a server success:
    // tap, get the confirmed copy, zero network traffic.
    //
    // `InjuryPreviewHostV5` was exactly that call site, and it is reachable by
    // a real runner ("If it's still there tomorrow, see Injury", off Today).
    // It now passes a real handler. This case is the backstop for the NEXT
    // view that forgets: `.cancelled` claims nothing in either direction and
    // offers no Retry that could only repeat the same nothing (Rule 11's "we
    // did not ask", the same reading `logSickTrend` gives an action it does
    // not recognise).

    @MainActor
    func testAnUnwiredCheckInClaimsNothing() async {
        let view = InjuryFlareV5(model: .sampleV5)
        let row = view.model.checkIn.first
        XCTAssertNotNil(row, "the sample flare has no check-in rows to tap")
        let settlement = await view.onCheckIn(row!)
        XCTAssertEqual(settlement, .cancelled,
                       "an unwired check-in must claim nothing, not fabricate a landing")
        XCTAssertEqual(V5RowWriteState.settled(settlement, token: row!.id), .idle,
                       "and it must leave the row at its picker, with no confirmed copy")
        XCTAssertNil(TodayAfterV5.niggleCopy(.settled(settlement, token: row!.id)),
                     "`.idle` has no settled sentence at all — nothing is claimed")
    }

    @MainActor
    func testAnUnwiredSickReportClaimsNothing() async {
        let row = SickReportRowV5()
        let settlement = await row.onReport(["head_cold"], "today", false)
        XCTAssertEqual(settlement, .cancelled)
        XCTAssertEqual(SickReportRowV5.copy(for: .settled(settlement, token: "sick_report")).label,
                       "Not feeling right",
                       "an unwired report returns to the untouched invitation")
    }

    @MainActor
    func testAnUnwiredSickTrendClaimsNothing() async {
        let view = SickFlareV5(model: .sampleV5)
        let row = view.model.checkIn.first
        XCTAssertNotNil(row)
        let settlement = await view.onLogTrend(row!)
        XCTAssertEqual(settlement, .cancelled)
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

// ═════════════════════════════════════════════════════════════════════════
// INJURYCHECKIN-1 · the injury-flare check-in path, and the two adjacent
// honesty defects a Product Experience review found beside it.
//
// ─────────────────────────────────────────────────────────────────────────
// WHAT WENT WRONG
//
// The review drove the real flare screen on a device, against a clone of the
// owner's production rows, and found the whole path broken:
//
//  1 · `POST /api/niggle/recovery` answered 404 "no active niggle" every
//      single time — three for three, on a healthy network — because the
//      screen is drawn off `runner_injuries` and the endpoint reads
//      `niggles`, two tables with independent lifecycles (there is no caller
//      anywhere in the app for `POST /api/injuries`). `v5SettleWrite`
//      collapsed that into `.didNotLand`, whose copy is "The coach may not
//      have it yet. Trying again is safe." Trying again could never work.
//
//  2 · The recovery routes were bare INSERTs. One answer plus one retry
//      after a lost response wrote TWO identical trend rows. WRITEIDEM-1
//      covered the REPORT routes; nothing covered these.
//
//  3 · A landed check-in drew `checked.sub` — a verbatim repeat of the
//      tapped row's own sub-line, about 40pt below the first copy. The
//      intended `?? "Logged."` fallback never fired, because `sub` is never
//      nil on a real payload. So success and failure looked the same.
//
//  4 · That note, and the failure note's Retry, rendered below the fold on
//      both a 17 Pro and an SE.
//
//  5 · Removing the note on `.sending` shortened the page about 141pt, iOS
//      clamped the scroll offset, and "Worse" — an escalation of a pain
//      report — slid into where "Retry" had been. The reviewer landed a
//      second tap on it.
//
//  6 · The server's flagged-niggle row drew a CHEVRON and called
//      `onRowAction: { _ in }`. There was no way anywhere on Today to clear
//      a niggle.
//
//  7 · "If it's still there tomorrow, see Injury" was gated on THIS
//      SESSION'S write state, so it showed while tomorrow was still today
//      and was gone by the morning the sentence is about.
//
// ─────────────────────────────────────────────────────────────────────────
// RULE 22 · WHAT THIS SUITE CANNOT FAIL ON
//
// · It cannot fail on LAYOUT. Nothing here measures a rendered frame, so 4
//   and 5 are covered only structurally (the slot ratchets; the reveal id is
//   non-nil for the states that draw a note). The real proof for those two
//   is the device render in the accompanying report, per Rule 13.
// · It cannot fail on the SERVER half. Whether the routes still refuse to
//   duplicate, and still send a refusal sentence, is
//   `_write_idempotency_scan.test.ts` plus the live repro.
// · It cannot fail on a route that stops SENDING a refusal. The phone's
//   fallback is deliberately keyed on the sentence, so a route that drops it
//   silently reverts to `.didNotLand` — honest, but weaker. Only the
//   TypeScript gate can see that.
final class InjuryCheckInHonestyTests: XCTestCase {

    private func body(_ o: [String: Any]) -> Data {
        try! JSONSerialization.data(withJSONObject: o)
    }

    private static let refusal =
        "Nothing is open to check in on. Either this was already cleared, or there was no niggle flagged."

    // MARK: - 1 · a permanent no is not an unknown

    func testARefusalSentenceMakesTheAnswerPermanent() {
        let s = v5RefusalSettlement(status: 404, body: body(["error": "no active niggle",
                                                            "refusal": Self.refusal,
                                                            "retryable": false]))
        XCTAssertEqual(s, .refused(Self.refusal))
    }

    /// THE DEFECT ITSELF, stated as the thing the runner reads. `.refused`
    /// must never reach the copy that promises a retry is safe.
    func testARefusedRowNeverPromisesThatRetryingIsSafe() {
        let state = V5RowWriteState.settled(.refused(Self.refusal), token: "better")
        XCTAssertEqual(state, .refused("better", Self.refusal))
        XCTAssertEqual(state.refusal, Self.refusal)
        for line in V5UnconfirmedCopy.all {
            XCTAssertNotEqual(state.refusal, line,
                              "a permanent refusal is rendering the unconfirmed copy")
        }
        XCTAssertFalse(V5RefusedCopy.cannotSucceed.lowercased().contains("trying again is safe"),
                       "the refused fallback inherited the unconfirmed promise")
        // And every unconfirmed line still DOES make that promise, which is
        // what makes them the wrong sentence here. If this stops holding, the
        // assertion above has quietly stopped meaning anything (Rule 18).
        for line in V5UnconfirmedCopy.all {
            XCTAssertTrue(line.contains("Trying again is safe"), "unconfirmed copy changed shape")
        }
    }

    /// Rule 22, the other direction. A phone that treated every 4xx as
    /// permanent would suppress the Retry on a transient answer, which is the
    /// opposite defect and just as expensive.
    func testWhatMustSTILLSettleAsUnknown() {
        // A 404 with no refusal: a proxy, a typo'd path, an older route.
        XCTAssertEqual(v5RefusalSettlement(status: 404, body: body(["error": "no active niggle"])),
                       .didNotLand)
        // No body at all.
        XCTAssertEqual(v5RefusalSettlement(status: 404, body: nil), .didNotLand)
        // A server that fell over, however it words itself. A 5xx is the
        // textbook "we could not tell".
        XCTAssertEqual(v5RefusalSettlement(status: 500, body: body(["refusal": "nope"])),
                       .didNotLand)
        // Not JSON.
        XCTAssertEqual(v5RefusalSettlement(status: 409, body: Data("<html>".utf8)), .didNotLand)
    }

    func testASuccessIsStillASuccess() {
        XCTAssertEqual(v5RefusalSettlement(status: 200, body: body(["active": true])), .landed)
        XCTAssertEqual(v5RefusalSettlement(status: 204, body: nil), .landed)
    }

    /// A refusal marker with an empty sentence must still be permanent, and
    /// must fall back to words the phone can defend rather than to silence.
    func testAnEmptyRefusalStillRefuses() {
        XCTAssertEqual(v5RefusalSettlement(status: 404, body: body(["refusal": ""])),
                       .refused(V5RefusedCopy.cannotSucceed))
    }

    // MARK: - 3 · a landed check-in says something new

    /// THE DEFECT: the note was the tapped row's OWN sub-line, printed again.
    /// Asserted against the real payload's rows (`app/api/v5/today/route.ts`
    /// composes exactly these three), not a synthetic one.
    func testTheConfirmationDoesNotRepeatTheRowItConfirms() {
        let rows = [
            V5Row(id: "better", label: "Better today", sub: "Loosen back in gradually tomorrow"),
            V5Row(id: "same", label: "About the same", sub: "One more day off, then reassess"),
            V5Row(id: "worse", label: "Worse", sub: "Worth a call with someone who can look at it"),
        ]
        for row in rows {
            let note = InjuryFlareV5.checkedNote(row)
            XCTAssertNotEqual(note, row.sub,
                              "the confirmation is the row's own sub-line printed twice")
            XCTAssertFalse(note.contains(row.sub ?? "\u{0}"),
                           "the confirmation still contains the row's sub-line verbatim")
            // And it must actually CONFIRM — Rule 13 §3, assert the shape of
            // the result rather than the absence of the old one.
            XCTAssertTrue(note.contains(row.label), "the note does not say which answer landed")
            XCTAssertTrue(note.lowercased().contains("coach"),
                          "the note does not say the coach has it")
        }
    }

    // MARK: - 4 and 5 · the note's slot

    /// The reveal is non-nil exactly for the states that draw something under
    /// the tile, and nil while a write is in flight — moving the page under a
    /// finger mid-write is the defect next door.
    func testTheNoteIsRevealedOnlyOnceThereIsSomethingToRead() {
        XCTAssertNil(InjuryFlareV5.revealTarget(for: .idle))
        XCTAssertNil(InjuryFlareV5.revealTarget(for: .sending("better")))
        XCTAssertEqual(InjuryFlareV5.revealTarget(for: .done("better")), InjuryFlareV5.noteAnchor)
        XCTAssertEqual(InjuryFlareV5.revealTarget(for: .failed("better")), InjuryFlareV5.noteAnchor)
        XCTAssertEqual(InjuryFlareV5.revealTarget(for: .refused("better", "nothing open")),
                       InjuryFlareV5.noteAnchor)
    }

    /// THE MIS-TAP, structurally. The slot's height is monotonic, so no
    /// transition after the first attempt can shorten the page — which is the
    /// clamp that moved "Worse" under the finger aiming at "Retry".
    func testTheNoteSlotNeverGetsShorter() {
        typealias Slot = NonShrinkingSlot<EmptyView>
        // The exact sequence the reviewer walked: failed (tall), Retry
        // (sending, empty), failed again, then landed (one short line).
        var reserved: CGFloat = 0
        for measured in [0, 141, 0, 141, 18, 0] as [CGFloat] {
            let next = Slot.ratchet(reserved: reserved, measured: measured)
            XCTAssertGreaterThanOrEqual(next, reserved,
                                        "the slot shrank, which is the whole defect")
            reserved = next
        }
        XCTAssertEqual(reserved, 141, "the slot did not hold the tallest thing it drew")
        // Rule 18 · the assertion has to be able to fail. The UNFIXED
        // behaviour was to take each measurement as-is, and that sequence
        // ends at 0 rather than 141.
        var naive: CGFloat = 0
        for measured in [0, 141, 0, 141, 18, 0] as [CGFloat] { naive = measured }
        XCTAssertEqual(naive, 0, "the unfixed behaviour must still be expressible")
        XCTAssertNotEqual(naive, reserved)
    }

    // MARK: - 6 · the Undo

    /// It rendered as a chevron and fired nothing. Both halves: the row that
    /// clears a niggle carries the word, and one word, drawn from one place.
    func testTheUndoRowCarriesTheWordAndNotAChevronAlone() {
        XCTAssertEqual(TodayAfterV5.undoLabel, "Undo")
        XCTAssertEqual(TodayAfterV5.undoNiggleAction, "undo_niggle")
        let local = TodayAfterV5.localUndoRow("Left calf")
        XCTAssertEqual(local.action, TodayAfterV5.undoNiggleAction,
                       "the local Undo must resolve through the same verb as the server's row, "
                       + "or the host's guard drops it on the floor")
        XCTAssertEqual(local.label, "Left calf")
    }

    /// An unwired row action claims nothing in either direction (Rule 11 ·
    /// "we did not ask"), the same fail-safe default TODAYWRITE-2 gave
    /// `onCheckIn`. The old default here was `-> Void`, which could not
    /// report anything at all.
    @MainActor
    func testAnUnwiredRowActionClaimsNothing() async {
        let view = TodayAfterV5(model: TodayAfterV5Samples.outdoor)
        let settlement = await view.onRowAction(TodayAfterV5.localUndoRow("Left calf"))
        XCTAssertEqual(settlement, .cancelled,
                       "the default must not fabricate a cleared niggle")
    }

    // MARK: - 7 · the advice link outlives the session that caused it

    /// THE DEFECT, and it is only visible in the RELAUNCH case: the server
    /// still carries the flag, this session has written nothing.
    func testTheInjuryLinkSurvivesARelaunch() {
        XCTAssertTrue(TodayAfterV5.showsInjuryLink(serverFlagged: "Left calf flagged",
                                                   niggleState: .idle),
                      "the link vanishes on the morning the sentence is actually about")
        // Same session, just written and confirmed: the server row has not
        // arrived yet, and the link is still true.
        XCTAssertTrue(TodayAfterV5.showsInjuryLink(serverFlagged: nil,
                                                   niggleState: .done("Left calf")))
        // Nothing on file, nothing said.
        XCTAssertFalse(TodayAfterV5.showsInjuryLink(serverFlagged: nil, niggleState: .idle))
        // And a write that only MIGHT have landed still says nothing about a
        // flag — the clause TODAYWRITE-1 established, which this must not
        // loosen while widening the true cases.
        XCTAssertFalse(TodayAfterV5.showsInjuryLink(serverFlagged: nil,
                                                    niggleState: .failed("Left calf")))
        XCTAssertFalse(TodayAfterV5.showsInjuryLink(serverFlagged: nil,
                                                    niggleState: .sending("Left calf")))
        XCTAssertFalse(TodayAfterV5.showsInjuryLink(serverFlagged: nil,
                                                    niggleState: .refused("Left calf", "nothing open")))
    }
}
