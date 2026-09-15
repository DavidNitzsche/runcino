//
//  LaunchOrchestrationTests.swift
//  BA-01 required test #1 (ASAP-IMPLEMENTATION-SEQUENCE.md): "A launch-
//  orchestration test proves a normal Today launch schedules no more than
//  two runner-data reads: Today and plan snapshot."
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT THIS PROVES, AND WHAT IT DOES NOT
//
//  TodayHostV5's launch `.task` (HostsV5.swift, BA01-1, 2026-09-15) is:
//    1. PlanSnapshotStore.shared.loadFromDiskSynchronously()  — disk only
//    2. seedCachesFromDisk()                                  — disk only
//    3. await surface.load()                                   → /api/v5/today
//    4. Task { await syncPlanSnapshot() }                       → /api/v5/plan-snapshot
//  Steps 1-2 touch no network at all. This test drives the exact production
//  call path behind steps 3-4 — `API.fetchV5Today()` /
//  `API.fetchPlanSnapshotRaw()` → `V5RequestCoalescer.shared` / `authedGET`
//  → `URLSession.shared` — over `CountingTransportStub`
//  (RequestCoalescingTests.swift's WATCH-TODAY-SINGLEFLIGHT-2 stub, reused
//  here rather than duplicated) and proves the wire sees exactly one hit for
//  each, two total.
//
//  RULE 22 · WHAT THIS TEST CANNOT FAIL ON
//
//  It does not render `TodayHostV5` or execute its actual `.task` closure —
//  SwiftUI's view lifecycle isn't exercised here, only the two calls that
//  closure makes. So this cannot catch a THIRD call being added to that
//  `.task` block in the view itself; that is exactly what the required test
//  #7 source-level gate (`check-no-storm-regression.sh`) is for — the two
//  together are the intended coverage, not either alone. What this test adds
//  that the source gate structurally cannot: proof that neither call, once
//  actually run through the real transport and the real coalescer, secretly
//  produces a second wire hit of its own (a retry, a double-fire, a
//  coalescer regression of the kind WATCH-TODAY-SINGLEFLIGHT-2 found).
//
//  RULE 18 NOTE — a bug caught while building this file, not in it
//
//  The first version of this test used `hits(matching: "")` as a "total
//  count" (reasoning: `String.contains("")` is always true). Debugging why
//  it reported 0 hits despite a real, observed decode error proving the
//  request DID reach `CountingTransportStub` traced back to a genuine
//  Foundation bridging discrepancy: `"https://www.faff.run/api/v5/today"
//  .contains("")` returned `false` in this exact build/target, while
//  `"hello".contains("")` returned `true` for a plain Swift string literal
//  in an isolated `swift` REPL script. Confirmed reproducible, not a fluke.
//  Fixed by adding `CountingTransportStub.totalHitCount()` as its own
//  accessor (RequestCoalescingTests.swift) rather than relying on an
//  empty-needle substring match for "how many total."
//

import XCTest
@testable import Faff

@MainActor
final class LaunchOrchestrationTests: XCTestCase {

    override func setUp() async throws {
        try await super.setUp()
        URLProtocol.registerClass(CountingTransportStub.self)
        CountingTransportStub.reset()
    }

    override func tearDown() async throws {
        URLProtocol.unregisterClass(CountingTransportStub.self)
        try await super.tearDown()
    }

    /// The exact two calls TodayHostV5's launch `.task` makes, fired
    /// concurrently the way the real task fires them (`surface.load()`
    /// awaited on the main flow, `syncPlanSnapshot()` as a sibling
    /// background task) — proven to touch the wire exactly once each, and
    /// to touch nothing else, two total.
    func testNormalLaunchSchedulesExactlyTwoRunnerDataReads() async throws {
        // Drain first. The host app boots to host this test bundle and may
        // still have its own /api/v5/today in flight through the same
        // `V5RequestCoalescer.shared` singleton this test drives — one
        // sequential call to each endpoint settles any such in-flight slot
        // before the counted block below starts from an empty table. Same
        // discipline as
        // `testWatchTodayFetchersShareOneTransportCallThroughTheRealCoalescer`
        // in RequestCoalescingTests.swift.
        _ = try? await API.fetchV5Today()
        _ = try? await API.fetchPlanSnapshotRaw()
        CountingTransportStub.reset()

        async let todayResult = try? await API.fetchV5Today()
        async let snapshotResult = try? await API.fetchPlanSnapshotRaw()
        _ = await todayResult
        _ = await snapshotResult

        let todayHits = CountingTransportStub.hits(matching: "/api/v5/today")
        let snapshotHits = CountingTransportStub.hits(matching: "/api/v5/plan-snapshot")
        XCTAssertEqual(todayHits, 1,
                       "a normal launch must read Today exactly once; the wire saw \(todayHits)")
        XCTAssertEqual(snapshotHits, 1,
                       "a normal launch must read the plan snapshot exactly once; the wire saw \(snapshotHits)")

        let total = CountingTransportStub.totalHitCount()
        XCTAssertEqual(total, 2,
                       "ASAP required test #1: a normal Today launch must schedule no more than "
                       + "two runner-data reads (Today, plan snapshot); the wire saw \(total)")
    }

    /// Rule 18 falsifier for this test itself: a THIRD read alongside the
    /// real two must be caught by the exact same total-count assertion
    /// above, not just by the two per-endpoint checks (which would both
    /// still pass on their own — this proves the total-count assertion is
    /// load-bearing, not decoration).
    func testRuleEighteenFalsifier_aThirdReadAlongsideTheRealTwoFailsTheTotalCount() async throws {
        _ = try? await API.fetchV5Today()
        _ = try? await API.fetchPlanSnapshotRaw()
        _ = try? await API.fetchV5Block()
        CountingTransportStub.reset()

        async let todayResult = try? await API.fetchV5Today()
        async let snapshotResult = try? await API.fetchPlanSnapshotRaw()
        // The regression this whole BA-01 fix removed: an extra eager read
        // fired alongside the two legitimate ones.
        async let blockResult = try? await API.fetchV5Block()
        _ = await (todayResult, snapshotResult, blockResult)

        let total = CountingTransportStub.totalHitCount()
        XCTAssertNotEqual(total, 2,
                          "falsifier sanity check: three concurrent distinct-endpoint reads must "
                          + "NOT report as only two — if this fires, the counting mechanism itself "
                          + "cannot be trusted to catch a real storm regression")
        XCTAssertEqual(total, 3, "three distinct endpoints, three wire hits, no coalescing across URLs")
    }
}
