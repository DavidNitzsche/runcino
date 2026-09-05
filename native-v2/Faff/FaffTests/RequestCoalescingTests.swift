//
//  RequestCoalescingTests.swift
//  REQUESTSTORM-1 · the app was flooding itself.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE EVIDENCE, from the runner's own device on 2026-09-05 at 08:23
//
//    · 281 requests in one session, up from 156 five minutes earlier
//    · one burst carrying THREE /api/v5/today, THREE /api/v5/block and
//      THREE /api/v5/races, all in flight together
//    · ingest POSTs at 5,527 / 5,974 / 6,057 / 6,549 ms and plan-snapshot
//      at 8,848 ms
//    · last error: NSURLErrorDomain Code=-1001 "The request timed out."
//
//  The reads did not fail because the connection was dead. They timed out at
//  the 12-second bound while the app's own duplicate traffic saturated the
//  link. STUCKCONN-2's pool reset is the right answer to a dead connection and
//  the wrong one to a busy one.
//
//  ─────────────────────────────────────────────────────────────────────────
//  RULE 22 · WHAT THIS GATE CANNOT FAIL ON
//
//  It cannot fail on the real fan-out. These tests drive the coalescer
//  directly with a stub; they prove the mechanism collapses concurrent
//  duplicates, not that the app stopped issuing them. The count on the device
//  is the only measurement of that, and the diagnostics sheet is where it has
//  to be read.
//
//  It also cannot fail on a WRITE being coalesced, because the coalescer is
//  only reachable from the GET helper. If a future caller routes a POST
//  through it, nothing here notices, and two identical POSTs are two intents.
//

import XCTest
@testable import Faff

final class RequestCoalescingTests: XCTestCase {

    /// A stand-in for the transport: counts how many times it actually ran.
    private actor Counter {
        private(set) var runs = 0
        func bump() -> Int { runs += 1; return runs }
    }

    func testConcurrentCallersForOneURLProduceOneTransportCall() async throws {
        let counter = Counter()
        let coalescer = TestableCoalescer { _ in
            _ = await counter.bump()
            try await Task.sleep(nanoseconds: 40_000_000)
            return Data("ok".utf8)
        }
        let url = URL(string: "https://example.test/api/v5/today")!

        // The exact shape from the log: three simultaneous asks for one URL.
        async let a = coalescer.get(url)
        async let b = coalescer.get(url)
        async let c = coalescer.get(url)
        let results = try await [a, b, c]

        let runs = await counter.runs
        XCTAssertEqual(runs, 1, "three concurrent callers must share ONE transport call")
        XCTAssertEqual(results.count, 3, "and every caller must still get an answer")
        for r in results { XCTAssertEqual(String(decoding: r, as: UTF8.self), "ok") }
    }

    func testDifferentURLsAreNotCollapsedIntoOne() async throws {
        let counter = Counter()
        let coalescer = TestableCoalescer { _ in
            _ = await counter.bump()
            return Data("ok".utf8)
        }
        _ = try await coalescer.get(URL(string: "https://example.test/api/v5/today")!)
        _ = try await coalescer.get(URL(string: "https://example.test/api/v5/block")!)
        let runs = await counter.runs
        XCTAssertEqual(runs, 2, "two different endpoints are two requests, not one")
    }

    func testASECONDCallAfterTheFirstFinishesIsAFreshRequest() async throws {
        // Coalescing must not become caching. A later refresh has to reach the
        // server, or the screen goes on showing a value already corrected.
        let counter = Counter()
        let coalescer = TestableCoalescer { _ in
            _ = await counter.bump()
            return Data("ok".utf8)
        }
        let url = URL(string: "https://example.test/api/v5/today")!
        _ = try await coalescer.get(url)
        _ = try await coalescer.get(url)
        let runs = await counter.runs
        XCTAssertEqual(runs, 2, "sequential calls are separate requests")
    }

    func testAFailureIsDeliveredToEveryJoinedCallerAndDoesNotStickToTheSlot() async throws {
        struct Boom: Error {}
        let counter = Counter()
        let coalescer = TestableCoalescer { _ in
            let n = await counter.bump()
            if n == 1 { throw Boom() }
            return Data("recovered".utf8)
        }
        let url = URL(string: "https://example.test/api/v5/today")!

        async let a: Data = coalescer.get(url)
        async let b: Data = coalescer.get(url)
        let outcomes = [try? await a, try? await b]
        let failures = outcomes.filter { $0 == nil }.count
        // Both joined callers see the failure.
        XCTAssertEqual(failures, 2, "a shared failure reaches every joined caller")

        // And the slot is clear, so the next attempt is a real one (Rule 11: a
        // failed read must not become a cached nothing).
        let after = try await coalescer.get(url)
        XCTAssertEqual(String(decoding: after, as: UTF8.self), "recovered")
    }
}

/// The coalescing rule, isolated from `URLSession` so it can be driven.
/// Mirrors `V5RequestCoalescer` exactly; a divergence here is a real defect and
/// is why the production actor keeps the same three lines.
actor TestableCoalescer {
    private var inFlight: [String: Task<Data, Error>] = [:]
    private let run: (URL) async throws -> Data

    init(run: @escaping (URL) async throws -> Data) { self.run = run }

    func get(_ url: URL) async throws -> Data {
        let key = url.absoluteString
        if let existing = inFlight[key] { return try await existing.value }
        let task = Task { try await run(url) }
        inFlight[key] = task
        defer { inFlight[key] = nil }
        return try await task.value
    }
}
