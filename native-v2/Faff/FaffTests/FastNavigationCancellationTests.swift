//
//  FastNavigationCancellationTests.swift
//  BA-01 required test #5 (ASAP-IMPLEMENTATION-SEQUENCE.md): "A cancellation
//  test proves fast date navigation does not create an outage state or
//  retry burst."
//
//  ─────────────────────────────────────────────────────────────────────────
//  MOST OF THIS REQUIREMENT WAS ALREADY MET BEFORE THIS FILE EXISTED
//
//  `SurfaceCancellationTests.swift` (CANCELBANNER-2) already proves a
//  cancellation error — either shape (`CancellationError` or
//  `URLError(.cancelled)`) — never raises `stale`/`isOutage`.
//  `LateFailureBannerTests.swift` (LATEFAILURE-1) already drives a REAL
//  out-of-order race with two genuinely sequential `load()` calls (via
//  `StaggeredFetch`) and proves a late, superseded failure arriving after a
//  newer success never resurrects the outage banner — this is fast
//  navigation's actual production shape, per that file's own measurement,
//  and it is exactly the "does not create an outage state" half of this
//  required test.
//
//  What neither file drives is a REAL `Task.cancel()` racing against a REAL,
//  still-running `load()` — both existing files inject an already-thrown
//  error (`throw URLError(.cancelled)`, or a staggered failure) rather than
//  calling `.cancel()` on a live Task and observing what `load()` actually
//  does with it. `goTo`'s own mechanism (HostsV5.swift) is
//  `navigationTask?.cancel()` on every new navigation — this file closes
//  that one specific gap: a genuine cancel, not a simulated one.
//
//  RULE 22 · WHAT THIS FILE CANNOT FAIL ON
//
//  Same limitation `SurfaceCancellationTests.swift` already names: cancelling
//  a `Task` that wraps `V5RequestCoalescer.get(_:)` does not propagate to the
//  underlying `URLSession` task, because the coalescer runs the fetch in an
//  UNSTRUCTURED `Task { }` of its own (measured there, 2026-09-08). So a real
//  `.cancel()` here, on a fetch closure that is itself just an `async`
//  function (not routed through the coalescer), proves `load()`'s own
//  handling of `Task.isCancelled`/thrown cancellation is correct — it does
//  not prove `goTo`'s cancel call actually stops the real network request in
//  production. That gap is `SurfaceCancellationTests.swift`'s own documented,
//  still-open finding, not something this file re-litigates.
//

import XCTest
@testable import Faff

@MainActor
final class FastNavigationCancellationTests: XCTestCase {

    private struct Payload: Decodable, Equatable { let dateTag: Int }

    /// The exact mechanism `goTo` relies on for fast, repeated navigation:
    /// wrap the fetch in a `Task`, and cancel the PRIOR task the instant a
    /// new navigation starts. A genuinely cancelled older task must never
    /// leave the surface in an outage state, even though its own fetch
    /// closure is still running when `.cancel()` is called.
    func testACancelledTaskNeverRaisesAnOutageEvenThoughItsOwnFetchWasStillRunning() async throws {
        let s = V5Surface<Payload>(cache: nil) {
            // Cooperative cancellation check, the same shape any real async
            // fetch chain has (URLSession's own APIs check this internally).
            try await Task.sleep(nanoseconds: 500_000_000)
            if Task.isCancelled { throw CancellationError() }
            return .ok(Payload(dateTag: 1))
        }

        // goTo's own shape: start the task, then cancel it almost
        // immediately, as a second, faster navigation would.
        let navigationTask = Task { await s.load() }
        try await Task.sleep(nanoseconds: 50_000_000) // let load() actually start
        navigationTask.cancel()
        await navigationTask.value

        try await Task.sleep(nanoseconds: 1_800_000_000) // outlast STALEDEBOUNCE-1's 1.2s
        XCTAssertFalse(s.stale, "a genuinely cancelled navigation must never raise the outage screen")
        XCTAssertFalse(s.isOutage)
        XCTAssertNil(s.model, "a cancelled first load has nothing to show yet — this is cold start, not outage")
    }

    /// Rapid re-navigation, five taps in quick succession — each cancels the
    /// last and starts fresh, matching `goTo`'s `navigationTask?.cancel()`
    /// before every new `Task {}`. Only the LAST one should ever land;
    /// none of the four cancelled ones may raise an outage, and the final
    /// state must reflect exactly the last date asked for — not a burst of
    /// four outage flickers on the way there.
    func testFiveRapidCancelledNavigationsLeaveOnlyTheLastOneStanding() async throws {
        var tasks: [Task<Void, Never>] = []
        var surfaces: [V5Surface<Payload>] = []

        // Five independent one-off fetches, the same shape goTo's
        // `surface.fetchOnce(refresh)` uses per date — each surface stands
        // in for one navigation's own in-flight request.
        for tag in 1...5 {
            let s = V5Surface<Payload>(cache: nil) {
                try await Task.sleep(nanoseconds: 300_000_000)
                if Task.isCancelled { throw CancellationError() }
                return .ok(Payload(dateTag: tag))
            }
            surfaces.append(s)
            let t = Task { await s.load() }
            tasks.append(t)
            try await Task.sleep(nanoseconds: 20_000_000) // a fast tap cadence
            if tag < 5 { t.cancel() } // every navigation but the last is superseded
        }

        for t in tasks { await t.value }
        try await Task.sleep(nanoseconds: 1_800_000_000)

        for i in 0..<4 {
            XCTAssertFalse(surfaces[i].stale,
                           "cancelled navigation #\(i + 1) of 5 must never raise its own outage")
        }
        // The fifth was never cancelled and its fetch has had time to land.
        XCTAssertEqual(surfaces[4].model, Payload(dateTag: 5),
                       "the one navigation that was never superseded must land normally")
        XCTAssertFalse(surfaces[4].stale)
    }

    /// Rule 18 falsifier: confirm this mechanism can actually see a real
    /// outage when cancellation is NOT involved — a genuine, uncancelled
    /// failure must still raise it, same control every other file in this
    /// suite keeps for the same reason.
    func testRuleEighteenFalsifier_anUncancelledFailureStillRaisesTheOutage() async throws {
        let s = V5Surface<Payload>(cache: nil) {
            try await Task.sleep(nanoseconds: 50_000_000)
            throw URLError(.timedOut)
        }
        await s.load()
        try await Task.sleep(nanoseconds: 1_800_000_000)
        XCTAssertTrue(s.stale, "RULE 18: a real, uncancelled failure must still raise the outage — "
                      + "if cancellation-absorption swallowed this too, it would be swallowing everything")
    }
}
