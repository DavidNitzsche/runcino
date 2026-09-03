//
//  DayFetchCoordinatorTests.swift
//  faff.run iPhone · REQCOORD-1's own regression coverage.
//
//  The coordinator exists to answer one measured defect: rapid navigation
//  fanned out into uncontrolled concurrent requests and crashed the local
//  dev server. These tests exercise the coordinator against an injected
//  fake fetcher — never a real network dependency — so dedup and the
//  concurrency bound are provable, not just plausible.
//

import XCTest
@testable import Faff

final class DayFetchCoordinatorTests: XCTestCase {

    private func sampleModel() throws -> V5Today {
        try JSONDecoder().decode(V5Today.self, from: Data(V5ContractTests.Fixtures.beforeRun.utf8))
    }

    /// Two overlapping calls asking for the SAME date must share one
    /// underlying fetch, not fire two — the exact fan-out this coordinator
    /// replaced.
    @MainActor
    func testDeduplicatesConcurrentRequestsForTheSameDate() async throws {
        let model = try sampleModel()
        actor CallCounter {
            var count = 0
            func increment() { count += 1 }
        }
        let counter = CallCounter()
        let coordinator = DayFetchCoordinator(maxConcurrent: 6) { _ in
            await counter.increment()
            try? await Task.sleep(nanoseconds: 40_000_000)
            return model
        }
        async let a = coordinator.fetch(["2026-09-10"])
        async let b = coordinator.fetch(["2026-09-10"])
        _ = await (a, b)
        let calls = await counter.count
        XCTAssertEqual(calls, 1, "two overlapping requests for one date must share ONE underlying fetch")
    }

    /// However many dates are requested, no more than `maxConcurrent`
    /// fetches are ever open at once — measured live via a peak counter,
    /// not inferred from wall-clock timing.
    @MainActor
    func testConcurrencyBoundIsRespected() async throws {
        let model = try sampleModel()
        actor PeakCounter {
            private var current = 0
            private(set) var peak = 0
            func enter() { current += 1; peak = max(peak, current) }
            func leave() { current -= 1 }
        }
        let counter = PeakCounter()
        let bound = 3
        let coordinator = DayFetchCoordinator(maxConcurrent: bound) { _ in
            await counter.enter()
            try? await Task.sleep(nanoseconds: 20_000_000)
            await counter.leave()
            return model
        }
        let dates = (1...12).map { String(format: "2026-09-%02d", $0) }
        _ = await coordinator.fetch(dates)
        let peak = await counter.peak
        XCTAssertLessThanOrEqual(peak, bound, "never more than maxConcurrent fetches should run at once")
        XCTAssertGreaterThan(peak, 1, "sanity: this test's own fake must actually run some fetches concurrently")
    }

    /// Every requested date that succeeds comes back, keyed by the date it
    /// was requested under.
    @MainActor
    func testAllRequestedDatesComeBackWhenFetchSucceeds() async throws {
        let model = try sampleModel()
        let coordinator = DayFetchCoordinator(maxConcurrent: 6) { _ in model }
        let dates = ["2026-09-01", "2026-09-02", "2026-09-03"]
        let results = await coordinator.fetch(dates)
        XCTAssertEqual(Set(results.keys), Set(dates))
    }

    /// A failed (nil) fetch contributes nothing — never a placeholder, and
    /// never crashes the batch it was part of.
    @MainActor
    func testFailedFetchIsOmittedNotCrashedOrCached() async throws {
        let coordinator = DayFetchCoordinator(maxConcurrent: 6) { _ in nil }
        let results = await coordinator.fetch(["2026-09-01"])
        XCTAssertTrue(results.isEmpty, "a nil (failed) fetch contributes nothing, never a placeholder")
    }

    /// `inFlightCount` — the seam the concurrency-bound test above reads
    /// indirectly — returns to zero once a batch actually completes, so a
    /// later, unrelated call never inherits a stale "in flight" entry.
    @MainActor
    func testInFlightCountReturnsToZeroAfterCompletion() async throws {
        let model = try sampleModel()
        let coordinator = DayFetchCoordinator(maxConcurrent: 6) { _ in model }
        _ = await coordinator.fetch(["2026-09-01", "2026-09-02"])
        XCTAssertEqual(coordinator.inFlightCount, 0)
    }

    /// STALE-RESPONSE REJECTION, at the coordinator's own layer: dedup only
    /// holds while a fetch is genuinely in flight. Once a batch completes,
    /// `inFlight` is cleared, so a SECOND, later call for the same date is a
    /// fresh fetch — never silently served a cached result from a slot that
    /// should already be gone. (The runner-facing half of "a stale response
    /// must never win" — cancelling a navigation the runner has already
    /// moved past — is `TodayHostV5.pendingDate` and `navigationTask`'s job,
    /// covered in `TodayNavigationTests`; this is the coordinator's own
    /// half of that guarantee.)
    @MainActor
    func testSequentialCallsForTheSameDateAfterCompletionFetchAgain() async throws {
        let model = try sampleModel()
        actor CallCounter {
            var count = 0
            func increment() { count += 1 }
        }
        let counter = CallCounter()
        let coordinator = DayFetchCoordinator(maxConcurrent: 6) { _ in
            await counter.increment()
            return model
        }
        _ = await coordinator.fetch(["2026-09-01"])
        _ = await coordinator.fetch(["2026-09-01"])
        let calls = await counter.count
        XCTAssertEqual(calls, 2, "a second, later call is a fresh fetch, not served from a stale in-flight slot")
    }

    /// A request batch larger than `maxConcurrent` is served in more than
    /// one wave — the coordinator does not silently drop the tail past the
    /// bound.
    @MainActor
    func testBatchLargerThanBoundStillReturnsEveryDate() async throws {
        let model = try sampleModel()
        let coordinator = DayFetchCoordinator(maxConcurrent: 2) { _ in model }
        let dates = (1...9).map { String(format: "2026-09-%02d", $0) }
        let results = await coordinator.fetch(dates)
        XCTAssertEqual(Set(results.keys), Set(dates))
    }
}
