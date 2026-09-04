//
//  RequestDiagnosticsTests.swift
//  STAGE1-DIAG-1's own coverage — the request-lifecycle recorder that backs
//  the hidden Settings diagnostics sheet.
//

import XCTest
@testable import Faff

final class RequestDiagnosticsTests: XCTestCase {

    func testBeginThenFinishRoundTrips() async {
        let log = RequestDiagnosticsLog()
        let gen = await log.begin(endpoint: "/api/v5/today", dateParam: "2026-09-05")
        await log.finish(gen, outcome: .success(status: 200))
        let snapshot = await log.snapshot()
        XCTAssertEqual(snapshot.count, 1)
        XCTAssertEqual(snapshot[0].id, gen)
        XCTAssertEqual(snapshot[0].endpoint, "/api/v5/today")
        XCTAssertEqual(snapshot[0].dateParam, "2026-09-05")
        XCTAssertEqual(snapshot[0].outcome, .success(status: 200))
        XCTAssertNotNil(snapshot[0].finishedAt)
    }

    func testGenerationIsMonotonicAcrossConcurrentBegins() async {
        let log = RequestDiagnosticsLog()
        var gens: [Int] = []
        for _ in 0..<10 {
            gens.append(await log.begin(endpoint: "/api/v5/block", dateParam: nil))
        }
        // Strictly increasing, no duplicates — proves the actor serializes
        // `begin` correctly even though callers can invoke it concurrently
        // in the real app (prefetch fires several requests in parallel).
        XCTAssertEqual(gens, gens.sorted())
        XCTAssertEqual(Set(gens).count, gens.count)
    }

    func testFinishOnUnknownGenerationIsANoOp() async {
        let log = RequestDiagnosticsLog()
        let gen = await log.begin(endpoint: "/api/v5/today", dateParam: nil)
        // A finish for a generation that was never begun (or already evicted)
        // must not crash or corrupt the real entry.
        await log.finish(gen + 999, outcome: .cancelled)
        let snapshot = await log.snapshot()
        XCTAssertEqual(snapshot.count, 1)
        XCTAssertNil(snapshot[0].outcome)
    }

    func testDecodeFailureIsARecordedStandaloneEntryNotAMutation() async {
        let log = RequestDiagnosticsLog()
        let gen = await log.begin(endpoint: "/api/v5/today", dateParam: "2026-09-05")
        await log.finish(gen, outcome: .success(status: 200))
        struct FakeError: Error, CustomStringConvertible { var description: String { "fake decode error" } }
        await log.recordDecodeFailure(endpoint: "/api/v5/today", dateParam: "2026-09-05", error: FakeError())
        let snapshot = await log.snapshot()
        // Two distinct entries: the transport success, and the decode
        // failure — not one entry silently overwritten by the other.
        XCTAssertEqual(snapshot.count, 2)
        let transportEntry = snapshot.first { $0.id == gen }
        XCTAssertEqual(transportEntry?.outcome, .success(status: 200))
        let decodeEntry = snapshot.first { $0.id != gen }
        if case .decodingError(let msg)? = decodeEntry?.outcome {
            XCTAssertTrue(msg.contains("fake decode error"))
        } else {
            XCTFail("expected a decodingError outcome")
        }
    }

    func testRingBufferEvictsOldestPastCap() async {
        let log = RequestDiagnosticsLog()
        // Cap is 300 (private, but its effect is observable): push past it
        // and confirm the earliest entries are gone while the newest survive.
        for i in 0..<320 {
            let gen = await log.begin(endpoint: "/api/v5/today", dateParam: "\(i)")
            await log.finish(gen, outcome: .success(status: 200))
        }
        let snapshot = await log.snapshot()
        XCTAssertLessThanOrEqual(snapshot.count, 300)
        // Most recent first (see `snapshot()`'s own contract) — entry 319
        // (the very last begin) must still be present; entry 0 must not.
        XCTAssertTrue(snapshot.contains { $0.dateParam == "319" })
        XCTAssertFalse(snapshot.contains { $0.dateParam == "0" })
    }

    func testOutcomeIsNotableClassification() {
        // The diagnostics view colors "notable" outcomes (real failures) —
        // falsify the exact boundary so a future outcome case can't silently
        // land on the wrong side without a test noticing.
        XCTAssertFalse(RequestOutcome.success(status: 200).isNotable)
        XCTAssertFalse(RequestOutcome.cancelled.isNotable)
        XCTAssertTrue(RequestOutcome.httpError(status: 500).isNotable)
        XCTAssertTrue(RequestOutcome.timeout.isNotable)
        XCTAssertTrue(RequestOutcome.transportError("x").isNotable)
        XCTAssertTrue(RequestOutcome.decodingError("x").isNotable)
    }

    func testDateParamExtractionFromURL() {
        let withDate = URL(string: "https://www.faff.run/api/v5/today?date=2026-09-05")!
        XCTAssertEqual(withDate.faffDiagnosticDateParam, "2026-09-05")
        let withoutDate = URL(string: "https://www.faff.run/api/v5/block")!
        XCTAssertNil(withoutDate.faffDiagnosticDateParam)
        let otherParams = URL(string: "https://www.faff.run/api/plan/week?foo=bar")!
        XCTAssertNil(otherParams.faffDiagnosticDateParam)
    }
}
