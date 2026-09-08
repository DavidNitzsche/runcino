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
//  ─────────────────────────────────────────────────────────────────────────
//  WATCH-TODAY-SINGLEFLIGHT-1 (2026-09-07 review)
//
//  `/api/watch/today` briefly had its own bespoke single-flight actor
//  (`WatchTodayGate`, `API.swift`) rather than routing through this one — a
//  duplicate answer to the question this file already tests. That actor is
//  deleted; the endpoint now shares `V5RequestCoalescer` with every other
//  `/api/v5/*` GET, and `testDatedWatchTodayRequestDoesNotShareTodaysSlot`
//  below proves the one behavior that was previously hand-written
//  (`date != nil` must not share "today"'s slot) falls out of URL-keying
//  for free.
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

    /// WATCH-TODAY-SINGLEFLIGHT-1 (2026-09-07 review) · `/api/watch/today`
    /// used to be single-flighted by a bespoke `WatchTodayGate` actor with
    /// its own hand-written `date == nil` special case. That actor is
    /// deleted; the endpoint now routes through this same
    /// `V5RequestCoalescer`/`TestableCoalescer` shape, and the special case
    /// falls out of URL-keying for free — a `?date=` query string is a
    /// different map key. This proves that property directly against the
    /// real request shapes: two of the three cold-launch callers ask for
    /// "today" (no date) while a concurrent legacy-shell day-preview asks
    /// for a specific date, and the dated call must NOT share today's
    /// in-flight slot.
    func testDatedWatchTodayRequestDoesNotShareTodaysSlot() async throws {
        let counter = Counter()
        let coalescer = TestableCoalescer { _ in
            _ = await counter.bump()
            try await Task.sleep(nanoseconds: 30_000_000)
            return Data("ok".utf8)
        }
        let today = URL(string: "https://example.test/api/watch/today")!
        let dated = URL(string: "https://example.test/api/watch/today?date=2026-09-10")!

        async let a = coalescer.get(today)
        async let b = coalescer.get(today)
        async let c = coalescer.get(dated)
        let results = try await [a, b, c]

        let runs = await counter.runs
        XCTAssertEqual(runs, 2, "the two undated callers share one call; the dated one gets its own")
        XCTAssertEqual(results.count, 3, "every caller still gets an answer")
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
///
/// A MIRROR of `V5RequestCoalescer`, kept for failure-injection ergonomics —
/// a throwing/sleeping transport is trivial to hand it. It is not evidence
/// about the production actor and never was: see WATCH-TODAY-SINGLEFLIGHT-2
/// below, where a regression injected into the real actor left every test
/// above green. `RealRequestCoalescerTests` is what watches the real one.
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

// ─────────────────────────────────────────────────────────────────────────
// WATCH-TODAY-SINGLEFLIGHT-2 (2026-09-07) · the tests above drive a MIRROR.
// These drive the real thing.
//
// Rule 18 says a gate is not trusted until it has been made to fail. The
// first round of this fix added `testDatedWatchTodayRequestDoesNotShareTodays
// Slot` above and called it a falsification proof. It was not one: every case
// above drives `TestableCoalescer`, a hand-maintained COPY of the production
// actor declared just above. A follow-up review reintroduced the exact
// regression the fix was written to guard against — an `await Task.yield()`
// between `V5RequestCoalescer.get(_:)`'s check-for-in-flight and its
// store-of-a-new-in-flight — into the PRODUCTION actor in `APIV5.swift`,
// rebuilt, and ran this whole bundle: 368 of 368 still passed. A copy of
// three lines cannot fail on those three lines.
//
// So the two cases below drive `V5RequestCoalescer.shared` itself, over the
// real `API.authedGET` → `URLSession.shared` path, with a counting
// `URLProtocol` in front of the wire. They go red when the actor is broken,
// and they were falsified against that same injected `Task.yield()` before
// landing.
//
// RULE 22 · WHAT THIS GATE CANNOT FAIL ON
//
// It shares the mirror tests' blind spot on the real fan-out: it proves the
// mechanism collapses concurrent duplicates, not that the app stopped issuing
// them. It cannot fail on a WRITE being coalesced. And it cannot fail on a
// SEQUENTIAL duplicate (REQUESTSTORM-2's shape), which is
// `ForegroundWork.shouldLoadOnForeground`'s job, not this actor's.
//
// What it CAN fail on, and the mirror tests structurally could not: the
// production actor's own concurrency, and whether `/api/watch/today`'s
// fetchers are still wired to it at all.
// ─────────────────────────────────────────────────────────────────────────

@MainActor
final class RealRequestCoalescerTests: XCTestCase {

    override func setUp() async throws {
        try await super.setUp()
        // Registered in FRONT of `FenceProtocol` — URLProtocol consults the
        // most recently registered class first — so nothing here reaches a
        // server. See NetworkFence.swift.
        URLProtocol.registerClass(CountingTransportStub.self)
        CountingTransportStub.reset()
    }

    override func tearDown() async throws {
        URLProtocol.unregisterClass(CountingTransportStub.self)
        try await super.tearDown()
    }

    /// The mechanism, against the REAL actor.
    ///
    /// N concurrent callers ask `V5RequestCoalescer.shared` for one URL. The
    /// wire must be touched exactly once. This is the case that fails when a
    /// suspension point appears between the in-flight check and the in-flight
    /// store: every caller then misses the map and opens its own transport
    /// call.
    ///
    /// The URL carries a per-run nonce, so the count can never be polluted by
    /// the test HOST app's own launch traffic — which shares this process and
    /// this singleton, and does fire `/api/watch/today` as the bundle loads.
    func testRealCoalescerCollapsesConcurrentIdenticalGETs() async throws {
        let nonce = UUID().uuidString
        let url = URL(string: "https://www.faff.run/api/watch/today?__probe=\(nonce)")!
        let callers = 14

        let joinsBefore = await V5RequestCoalescer.shared.joins()
        try await withThrowingTaskGroup(of: Void.self) { group in
            for _ in 0..<callers {
                group.addTask { _ = try await V5RequestCoalescer.shared.get(url) }
            }
            try await group.waitForAll()
        }
        let joinsAfter = await V5RequestCoalescer.shared.joins()

        let hits = CountingTransportStub.hits(matching: nonce)
        XCTAssertEqual(
            hits, 1,
            "\(callers) concurrent callers for one URL must touch the wire ONCE through "
            + "the real V5RequestCoalescer; it touched it \(hits) times")
        XCTAssertGreaterThanOrEqual(
            joinsAfter - joinsBefore, callers - 1,
            "the actor's own joinedCount must record \(callers - 1) callers joining an "
            + "existing request; it recorded \(joinsAfter - joinsBefore)")
    }

    /// The WIRING, against the real production call path.
    ///
    /// `/api/watch/today`'s three cold-launch callers (API.swift's
    /// WATCH-TODAY-SINGLEFLIGHT-1 note) must actually route through the shared
    /// coalescer — not through a re-added bespoke gate, and not straight to
    /// `authedGET`. This fails if anybody unwires them, which the mirror tests
    /// structurally cannot see.
    ///
    /// It also re-proves the `date != nil` property end to end: the dated
    /// caller gets its own transport call, because the coalescer is keyed on
    /// the full URL.
    func testWatchTodayFetchersShareOneTransportCallThroughTheRealCoalescer() async throws {
        // Drain first. The host app boots to host this bundle and fires its
        // own /api/watch/today at launch; one sequential call settles that
        // slot so the concurrent block below starts from an empty table.
        _ = try? await API.fetchWatchTodayRaw()
        CountingTransportStub.reset()

        // The real cold-launch shape: two undated callers (WatchSync's
        // `fetchWatchTodayRaw` and the launch prefetch's `fetchWatchWorkout`)
        // plus one dated day-preview from the legacy shell, all in flight
        // together. The undated `fetchWatchWorkout` writes {"workout":null} to
        // AppCache's .todayWorkout slot — the legitimate rest-day shape, read
        // by no other test.
        async let a: Data = API.fetchWatchTodayRaw()
        async let b: WatchWorkout? = API.fetchWatchWorkout()
        async let c: WatchWorkout? = API.fetchWatchWorkout(date: "2026-09-10")
        _ = try await (a, b, c)

        let undated = CountingTransportStub.hits(matching: "/api/watch/today", excluding: "date=")
        let dated = CountingTransportStub.hits(matching: "date=2026-09-10")
        XCTAssertEqual(
            undated, 1,
            "the two undated cold-launch callers must share ONE /api/watch/today transport "
            + "call; the wire saw \(undated)")
        XCTAssertEqual(
            dated, 1,
            "the dated day-preview must NOT share today's slot; it gets its own call")
    }
}

/// Counts what actually reaches the wire, and holds each response open long
/// enough that concurrent callers genuinely overlap.
///
/// Every member is `nonisolated` for the reason `FenceProtocol` documents:
/// this target builds at `SWIFT_DEFAULT_ACTOR_ISOLATION: MainActor`, while
/// `URLProtocol` calls `startLoading()` on URLSession's own thread.
final class CountingTransportStub: URLProtocol {

    nonisolated(unsafe) private static let lock = NSLock()
    nonisolated(unsafe) private static var seen: [String] = []

    /// How long a response is held open: long enough that every caller in a
    /// test has entered the actor before the first one finishes and its
    /// `defer` clears the slot, short enough to keep the suite fast.
    private static let holdOpenSec = 0.15

    nonisolated static func reset() {
        lock.lock(); defer { lock.unlock() }
        seen = []
    }

    /// Requests that reached the wire whose URL contains `matching` and, when
    /// given, does not contain `excluding`.
    nonisolated static func hits(matching needle: String, excluding: String? = nil) -> Int {
        lock.lock(); defer { lock.unlock() }
        return seen.filter { url in
            guard url.contains(needle) else { return false }
            if let excluding { return !url.contains(excluding) }
            return true
        }.count
    }

    nonisolated override class func canInit(with request: URLRequest) -> Bool { true }
    nonisolated override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    nonisolated override func startLoading() {
        let url = request.url
        Self.lock.lock()
        Self.seen.append(url?.absoluteString ?? "(no url)")
        Self.lock.unlock()

        DispatchQueue.global().asyncAfter(deadline: .now() + Self.holdOpenSec) {
            guard let client = self.client, let url else { return }
            let resp = HTTPURLResponse(
                url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"])!
            client.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
            client.urlProtocol(self, didLoad: Data(#"{"workout":null}"#.utf8))
            client.urlProtocolDidFinishLoading(self)
        }
    }

    nonisolated override func stopLoading() {}
}
