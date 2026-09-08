//
//  SurfaceCancellationTests.swift
//  faff.run iPhone · CANCELBANNER-2's own coverage.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT WENT WRONG
//
//  `API.authedSend` learned in CANCELBANNER-1 that a cancelled request is not
//  an outage, and `API.isCancellation` was extracted precisely because which
//  error `URLSession.shared.data(for:)` throws for a Task-cancelled request
//  is NOT guaranteed across OS/SDK versions: it is either Swift concurrency's
//  `CancellationError` or Foundation's `URLError(.cancelled)`.
//
//  `V5Surface.load()` — the layer above, which owns `stale` and therefore
//  owns the runner-facing data-outage screen — never used that helper. It
//  caught `CancellationError` only. So every cancellation that arrived in the
//  OTHER shape fell through to the generic catch, took
//  `markStaleAfterDebounce()`, and 1.2 seconds later the runner was reading
//  "cannot reach the server" about a request the app itself had superseded.
//
//  Measured by a Product Experience review on the real app: the outage screen
//  stood for 25-41 seconds with NO `/api/v5/today` request ever having been
//  ISSUED, and once for 69 seconds AFTER the real request had already
//  returned 200 — because the load that superseded this one had long since
//  painted, and nothing about its success could clear a `stale` flag its
//  cancelled sibling had already set.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHERE THE CANCELLATION ACTUALLY COMES FROM — measured 2026-09-08, because
//  the obvious answer is WRONG and the next reader should not spend the same
//  afternoon on it.
//
//  The natural repro is fast week-strip stepping: `goTo` calls
//  `navigationTask?.cancel()` on every tap that arrives before the last one
//  landed. It was driven end to end against a real backend slowed to 4s, on
//  the UNFIXED code, and NO false banner appeared — the case passed, which
//  makes it worthless as a gate (Rule 18). The reason is
//  `V5RequestCoalescer.get`: it runs the fetch inside an UNSTRUCTURED
//  `Task { }`, and cancelling the caller does not cancel that task, so
//  `URLSession` is never asked to cancel and no cancellation error is
//  produced at all. Every V5 read goes through that coalescer.
//
//  What DOES deliver `URLError(.cancelled)` into `load()` is
//  `URLSession.shared.reset` — it cancels every in-flight task, and it is
//  called by `API.resetConnectionPool()`, which every outage Retry in
//  `HostsV5.swift` runs before refetching, and by `StuckConnectionMonitor`
//  after three transport signals in ninety seconds. Those are exactly the
//  conditions the reviewer was in when they saw it.
//
//  A double-Retry driver for that was also built and also could not be made
//  to fail, because `markStaleAfterDebounce`'s 1.2s generation check absorbs
//  a cancelled load whenever a successful one lands within the window. The
//  surviving symptom needs the opposite order — the cancelled load losing
//  the race and landing AFTER the successful one, which is what the
//  reviewer's "69 seconds AFTER the real request returned 200" describes.
//  Forcing that ordering from outside the app was not achieved. So the
//  falsified proof of this fix is the unit level, below; there is no
//  end-to-end one, and that is stated rather than implied.
//
//  ─────────────────────────────────────────────────────────────────────────
//  RULE 22 · WHAT THIS GATE CANNOT FAIL ON
//
//  · It cannot fail on a REAL cancellation. These cases throw the two error
//    shapes directly from a stand-in fetch, which is what makes the decision
//    testable at all — but it means they prove `load()`'s handling, not that
//    any particular in-app event produces either shape. See the section
//    above for what was tried and what it cost.
//
//  · It cannot fail on a LATE LOSER. `markStaleAfterDebounce` sets `stale`
//    1.2s after a failed load with no check that a NEWER load has since
//    succeeded — the generation counter only cancels a pending stale, it
//    does not stop one scheduled after the success. So a genuinely-failed
//    load that lands after a healthy one still raises the banner over
//    current content, indefinitely, until the next success. This fix makes
//    a CANCELLED late loser silent, which closes the reviewer's own case;
//    the failed late loser is a separate, still-open defect and nothing
//    here would notice it.
//
//  · It cannot fail on the RENDERING. `stale` is the flag; whether
//    `StaleBannerV5` and the outage body are actually wired to it is a view
//    hierarchy claim a screenshot settles.
//
//  · It cannot fail on the DEBOUNCE window being right. It waits out
//    STALEDEBOUNCE-1's 1.2s and asserts what is true afterwards. If that
//    constant changes, `staleSettleWait` below must change with it, and
//    nothing forces that — which is why the failing case is kept as the
//    liveness probe: if the wait ever stops being long enough, the control
//    case stops going stale and fails loudly rather than passing vacuously.
//
//  ─────────────────────────────────────────────────────────────────────────
//  DISTRIBUTION (Rule 22)
//
//  Both directions, deliberately. A cancellation must be absorbed AND a real
//  transport failure must still raise. A surface that swallowed everything
//  would pass a suite that only checked the first, and would be the worse
//  bug: it would leave the runner reading a stale day with nothing saying so.
//

import XCTest
@testable import Faff

@MainActor
final class SurfaceCancellationTests: XCTestCase {

    /// STALEDEBOUNCE-1 waits 1.2s before flipping `stale`. Anything longer
    /// than that is enough to observe the settled answer.
    private let staleSettleWait: UInt64 = 1_800_000_000

    private struct Payload: Decodable, Equatable { let ok: Bool }

    /// A surface with no disk cache, so `model` starts nil and every
    /// observation below is about THIS load and nothing a previous run left
    /// behind.
    private func surface(throwing error: Error) -> V5Surface<Payload> {
        V5Surface(cache: nil) { () async throws -> API.V5Fetch<Payload> in throw error }
    }

    // MARK: - The cases that must be absorbed silently

    /// THE DEFECT, DIRECTLY. Before CANCELBANNER-2 this went stale and drew
    /// the outage screen.
    func testAFoundationCancelledRequestIsNotAnOutage() async throws {
        let s = surface(throwing: URLError(.cancelled))
        await s.load()
        try await Task.sleep(nanoseconds: staleSettleWait)
        XCTAssertFalse(s.stale, "URLError(.cancelled) must never raise the data-outage screen")
        XCTAssertFalse(s.isOutage)
        XCTAssertNil(s.absentReason)
    }

    /// The shape that was already handled. Kept so a future edit cannot fix
    /// one and break the other.
    func testASwiftConcurrencyCancellationIsNotAnOutage() async throws {
        let s = surface(throwing: CancellationError())
        await s.load()
        try await Task.sleep(nanoseconds: staleSettleWait)
        XCTAssertFalse(s.stale, "CancellationError must never raise the data-outage screen")
        XCTAssertFalse(s.isOutage)
    }

    /// A cancelled load must not disturb content the surface already holds
    /// — the superseding load owns the screen, and this one has nothing to
    /// say about it.
    func testACancelledRefreshLeavesGoodContentAlone() async throws {
        let s = V5Surface<Payload>(cache: nil) { .ok(Payload(ok: true)) }
        await s.load()
        XCTAssertEqual(s.model, Payload(ok: true))

        await s.refreshBehind { () async throws -> API.V5Fetch<Payload> in throw URLError(.cancelled) }
        try await Task.sleep(nanoseconds: staleSettleWait)
        XCTAssertEqual(s.model, Payload(ok: true))
        XCTAssertFalse(s.stale)
    }

    // MARK: - The cases that MUST still raise it
    //
    // These are the liveness probes as well as the control: if the
    // cancellation check were widened until it swallowed everything, or if
    // `staleSettleWait` stopped outlasting the debounce, these fail.

    func testAnOfflineDeviceStillRaisesTheOutage() async throws {
        let s = surface(throwing: URLError(.notConnectedToInternet))
        await s.load()
        try await Task.sleep(nanoseconds: staleSettleWait)
        XCTAssertTrue(s.stale, "a genuine transport failure must still be surfaced")
        XCTAssertTrue(s.isOutage)
    }

    func testATimeoutStillRaisesTheOutage() async throws {
        let s = surface(throwing: URLError(.timedOut))
        await s.load()
        try await Task.sleep(nanoseconds: staleSettleWait)
        XCTAssertTrue(s.stale)
    }

    func testADecodeFailureStillRaisesTheOutage() async throws {
        let s = surface(throwing: DecodingError.dataCorrupted(
            DecodingError.Context(codingPath: [], debugDescription: "test")))
        await s.load()
        try await Task.sleep(nanoseconds: staleSettleWait)
        XCTAssertTrue(s.stale)
    }

    /// A `.failed` fetch outcome — a 5xx that came back cleanly rather than
    /// throwing — is a read failure and keeps its banner. Nothing about the
    /// cancellation fix touches this path; the case is here so a future
    /// widening of the catch cannot quietly take it.
    func testAFailedFetchOutcomeStillRaisesTheOutage() async throws {
        let s = V5Surface<Payload>(cache: nil) { .failed }
        await s.load()
        try await Task.sleep(nanoseconds: staleSettleWait)
        XCTAssertTrue(s.stale)
    }

    /// And a refusal is still not an outage — rule three, untouched.
    func testARefusalIsStillNotAnOutage() async throws {
        let s = V5Surface<Payload>(cache: nil) { .absent("Your paces have not moved.") }
        await s.load()
        try await Task.sleep(nanoseconds: staleSettleWait)
        XCTAssertFalse(s.stale)
        XCTAssertEqual(s.absentReason, "Your paces have not moved.")
    }
}
