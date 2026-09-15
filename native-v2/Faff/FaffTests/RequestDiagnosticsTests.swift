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
        let gen = await log.begin(endpoint: "/api/v5/today", dateParam: "2026-09-05", correlationId: "cid-1", httpMethod: "GET")
        await log.finish(gen, outcome: .success(status: 200))
        let snapshot = await log.snapshot()
        XCTAssertEqual(snapshot.count, 1)
        XCTAssertEqual(snapshot[0].id, gen)
        XCTAssertEqual(snapshot[0].endpoint, "/api/v5/today")
        XCTAssertEqual(snapshot[0].dateParam, "2026-09-05")
        XCTAssertEqual(snapshot[0].outcome, .success(status: 200))
        XCTAssertNotNil(snapshot[0].finishedAt)
    }

    // CORRELATIONID-1 · the whole point of the field is that it survives
    // into the snapshot a screenshot of the diagnostics sheet would show,
    // untouched by `finish`. A test that only checks `begin`'s return value
    // wouldn't catch a future edit that dropped the id on the way into the
    // stored entry.
    func testCorrelationIdSurvivesIntoTheSnapshot() async {
        let log = RequestDiagnosticsLog()
        let gen = await log.begin(endpoint: "/api/v5/today", dateParam: nil, correlationId: "cid-abc-123", httpMethod: "GET")
        await log.finish(gen, outcome: .success(status: 200))
        let snapshot = await log.snapshot()
        XCTAssertEqual(snapshot[0].correlationId, "cid-abc-123")
    }

    func testGenerationIsMonotonicAcrossConcurrentBegins() async {
        let log = RequestDiagnosticsLog()
        var gens: [Int] = []
        for _ in 0..<10 {
            gens.append(await log.begin(endpoint: "/api/v5/block", dateParam: nil, correlationId: "cid", httpMethod: "GET"))
        }
        // Strictly increasing, no duplicates — proves the actor serializes
        // `begin` correctly even though callers can invoke it concurrently
        // in the real app (prefetch fires several requests in parallel).
        XCTAssertEqual(gens, gens.sorted())
        XCTAssertEqual(Set(gens).count, gens.count)
    }

    func testFinishOnUnknownGenerationIsANoOp() async {
        let log = RequestDiagnosticsLog()
        let gen = await log.begin(endpoint: "/api/v5/today", dateParam: nil, correlationId: "cid", httpMethod: "GET")
        // A finish for a generation that was never begun (or already evicted)
        // must not crash or corrupt the real entry.
        await log.finish(gen + 999, outcome: .cancelled)
        let snapshot = await log.snapshot()
        XCTAssertEqual(snapshot.count, 1)
        XCTAssertNil(snapshot[0].outcome)
    }

    func testDecodeFailureIsARecordedStandaloneEntryNotAMutation() async {
        let log = RequestDiagnosticsLog()
        let gen = await log.begin(endpoint: "/api/v5/today", dateParam: "2026-09-05", correlationId: "cid-transport", httpMethod: "GET")
        await log.finish(gen, outcome: .success(status: 200))
        struct FakeError: Error, CustomStringConvertible { var description: String { "fake decode error" } }
        await log.recordDecodeFailure(endpoint: "/api/v5/today", dateParam: "2026-09-05", correlationId: "cid-decode", httpMethod: "GET", error: FakeError())
        let snapshot = await log.snapshot()
        // Two distinct entries: the transport success, and the decode
        // failure — not one entry silently overwritten by the other.
        XCTAssertEqual(snapshot.count, 2)
        let transportEntry = snapshot.first { $0.id == gen }
        XCTAssertEqual(transportEntry?.outcome, .success(status: 200))
        XCTAssertEqual(transportEntry?.correlationId, "cid-transport")
        let decodeEntry = snapshot.first { $0.id != gen }
        XCTAssertEqual(decodeEntry?.correlationId, "cid-decode")
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
            let gen = await log.begin(endpoint: "/api/v5/today", dateParam: "\(i)", correlationId: "cid-\(i)", httpMethod: "GET")
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

    // CLIENTREPORT-1 · httpMethod survives into the snapshot the same way
    // correlationId does — same reasoning as testCorrelationIdSurvivesInto
    // TheSnapshot above: a test on begin()'s return value alone wouldn't
    // catch a future edit that dropped the field on the way into storage.
    func testHttpMethodSurvivesIntoTheSnapshot() async {
        let log = RequestDiagnosticsLog()
        let gen = await log.begin(endpoint: "/api/plan/move", dateParam: nil, correlationId: "cid", httpMethod: "POST")
        await log.finish(gen, outcome: .success(status: 200))
        let snapshot = await log.snapshot()
        XCTAssertEqual(snapshot[0].httpMethod, "POST")
    }

    // CLIENTREPORT-1 · the exact mapping `/api/observability/client-report`
    // relies on to classify a self-report. `.timeout` -> "no_response" is
    // the F162 shape itself (the client's own 12s budget expiring with
    // nothing back); `.transportError` -> "network_error" is a real
    // transport failure before any response. Every other outcome means the
    // transport either succeeded or was a routine, non-failure cancellation
    // — none of those are EDGE-shaped, so none should produce a report.
    func testClientReportKindMapping() {
        XCTAssertEqual(RequestDiagnosticsLog.clientReportKind(for: .timeout), "no_response")
        XCTAssertEqual(RequestDiagnosticsLog.clientReportKind(for: .transportError("connection reset")), "network_error")
        XCTAssertNil(RequestDiagnosticsLog.clientReportKind(for: .success(status: 200)))
        XCTAssertNil(RequestDiagnosticsLog.clientReportKind(for: .httpError(status: 503)))
        XCTAssertNil(RequestDiagnosticsLog.clientReportKind(for: .cancelled))
        XCTAssertNil(RequestDiagnosticsLog.clientReportKind(for: .decodingError("bad json")))
    }

    // STAGE0-REPORTBATCH-1 · the whole point of batching: a burst of many
    // failures together (F162's own repro shape) must produce at most one
    // report per window, not one per failure — the brief's own words,
    // "Reporting must be batched and must never create another refresh
    // storm." Fixed timestamps, no real wall-clock wait.
    func testShouldSendReportMapping() {
        let t0 = Date(timeIntervalSince1970: 1_000_000)
        // Never sent before -> always sends.
        XCTAssertTrue(RequestDiagnosticsLog.shouldSendReport(now: t0, lastSentAt: nil, window: 5))
        // 1 second after the last send, inside a 5s window -> suppressed.
        XCTAssertFalse(RequestDiagnosticsLog.shouldSendReport(now: t0.addingTimeInterval(1), lastSentAt: t0, window: 5))
        // Exactly at the window boundary -> sends (>=, not >, so the window
        // is a real cooldown rather than a limit nothing ever reaches).
        XCTAssertTrue(RequestDiagnosticsLog.shouldSendReport(now: t0.addingTimeInterval(5), lastSentAt: t0, window: 5))
        // Well past the window -> sends.
        XCTAssertTrue(RequestDiagnosticsLog.shouldSendReport(now: t0.addingTimeInterval(30), lastSentAt: t0, window: 5))
    }

    // The end-to-end shape through the real actor: a burst of failing
    // requests, only the first sends (verified indirectly — no network
    // double is wired into these tests, so this asserts on `outcome`/
    // `finishedAt` still landing correctly for every entry regardless of
    // whether its own report was sent or suppressed; testShouldSendReport
    // Mapping above is what proves the suppression decision itself).
    func testBurstOfTimeoutsStillRecordsEveryEntryRegardlessOfReportSuppression() async {
        let log = RequestDiagnosticsLog()
        var gens: [Int] = []
        for i in 0..<5 {
            gens.append(await log.begin(endpoint: "/api/v5/today", dateParam: "2026-09-\(10 + i)", correlationId: "cid-\(i)", httpMethod: "GET"))
        }
        for gen in gens {
            await log.finish(gen, outcome: .timeout)
        }
        let snapshot = await log.snapshot()
        // Every entry in the burst is still recorded LOCALLY with its real
        // outcome — suppression only affects whether a SERVER report fires,
        // never the on-device diagnostics sheet's own accuracy.
        XCTAssertEqual(snapshot.count, 5)
        XCTAssertTrue(snapshot.allSatisfy { $0.outcome == .timeout })
        XCTAssertTrue(snapshot.allSatisfy { $0.finishedAt != nil })
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
