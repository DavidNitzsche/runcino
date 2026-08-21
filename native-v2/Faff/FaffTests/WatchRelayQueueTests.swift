//
//  WatchRelayQueueTests.swift
//  The relay queue is the only thing standing between a recorded run and
//  nothing. This locks the one property that makes it durable.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT THIS CATCHES
//
//  `flushPendingCompletions` snapshots the queue, then `await`s a POST per
//  entry. Every one of those awaits releases the main actor, and five
//  triggers can enqueue into that window: session activation,
//  `didReceive file:`, `didReceiveUserInfo`, reachability, and
//  `saveCompletionDurably` (treadmill End, outdoor End, interrupted-run
//  flush). If the write-back assigns a list derived from the SNAPSHOT, every
//  one of those arrivals is erased — the run is on neither the server nor the
//  disk, and `saveCompletionDurably` reads the same wipe as "synced" and
//  tells the runner it saved.
//
//  The test holds one POST open and enqueues during it, which is the shape of
//  a gym save landing while a foreground refresh is draining. It fails
//  against a snapshot-assignment write-back and passes against a
//  remove-what-landed one.
//
//  Thread Sanitizer cannot see this: `WatchSync` is `@MainActor` and every
//  access is correctly isolated. It is a lost update across a suspension
//  point, not a memory race, so it needs a behavioural test.
//

import XCTest
@testable import Faff

@MainActor
final class WatchRelayQueueTests: XCTestCase {

    /// The on-disk key `WatchSync.pendingCompletions` is a computed property
    /// over. Read directly, because the queue IS the durability contract —
    /// this asserts against what would survive a kill, not against a private
    /// field.
    private let pendingKey = "faff.watch.pendingCompletions.v2"

    private var queue: [Data] {
        get { (UserDefaults.standard.array(forKey: pendingKey) as? [Data]) ?? [] }
        set { UserDefaults.standard.set(newValue, forKey: pendingKey) }
    }

    override func setUp() async throws {
        try await super.setUp()
        URLProtocol.registerClass(TestStubProtocol.self)
        SignInFlowTests.responder = nil
        queue = []
        // The drain guard and the post-failure backoff live on a singleton,
        // so an earlier test that failed a POST would otherwise leave this
        // one unable to drain at all.
        WatchSync.shared.resetDrainStateForTesting()
    }

    override func tearDown() async throws {
        URLProtocol.unregisterClass(TestStubProtocol.self)
        SignInFlowTests.responder = nil
        queue = []
        try await super.tearDown()
    }

    private func completion(_ id: String) -> Data {
        // The real wire shape, so `postCompletion`'s timezone splice runs the
        // same decode / re-encode path it does in production.
        try! JSONSerialization.data(withJSONObject: [
            "workoutId": id,
            "startedAt": "2026-08-21T15:00:00Z",
            "completedAt": "2026-08-21T15:25:00Z",
            "status": "completed",
            "totalDistanceMi": 3.1,
            "totalDurationSec": 1500,
            "source": "phone",
        ])
    }

    func test_completionEnqueuedDuringDrain_survivesTheWriteBack() async throws {
        let a = completion("phone_A")
        let b = completion("phone_B")
        queue = [a]

        SignInFlowTests.responder = { req in
            // `TestStubProtocol` has already drained the body — read it from
            // there rather than `req.httpBody`, which URLProtocol presents as
            // an `httpBodyStream` and therefore reads back nil.
            let id = SignInFlowTests.lastBody?["workoutId"] as? String
            let url = req.url ?? URL(string: "https://www.faff.run")!
            if id == "phone_A" {
                // Hold A's POST open. On a real run this window is however
                // long the network takes, and the main actor is free for all
                // of it.
                Thread.sleep(forTimeInterval: 0.6)
                return (HTTPURLResponse(url: url, statusCode: 200,
                                        httpVersion: nil, headerFields: nil)!, Data())
            }
            // B is refused, so there is exactly one correct outcome: it stays
            // on disk. A drain that drops it has destroyed a recorded run.
            return (HTTPURLResponse(url: url, statusCode: 500,
                                    httpVersion: nil, headerFields: nil)!, Data())
        }

        let drain = Task { await WatchSync.shared.flushPendingCompletions() }

        // Let the drain snapshot [A] and get into its POST.
        try await Task.sleep(nanoseconds: 250_000_000)
        XCTAssertEqual(queue.count, 1, "the drain should not have written back yet")

        // Exactly what `enqueue` does to the queue, and exactly what the watch
        // delegate and both console End buttons do to it mid-drain.
        queue = queue + [b]

        await drain.value

        XCTAssertTrue(queue.contains(b),
                      "A completion enqueued during a drain was erased by that drain's "
                      + "write-back. The run is on neither the server nor the disk.")
        XCTAssertFalse(queue.contains(a),
                       "A completion the server accepted should be dropped from the queue.")
    }
}
