//
//  RetryOwnershipTests.swift
//  BA-01 required test #3 (ASAP-IMPLEMENTATION-SEQUENCE.md), "exactly one
//  owning request" half — the "no neighbor/week prefetch" half is covered by
//  TodayNavigationTests.swift's shouldPrefetchWeek tests (BA01-3).
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT "ONE OWNING REQUEST" MEANS HERE
//
//  `retryPending` (HostsV5.swift) re-enters `goTo(date, force: true,
//  skipWeekPrefetch: true)`. For a date not already in `dayCache` — which a
//  failed date normally is not — `goTo`'s else-branch does exactly one thing
//  that touches the network: `navigationTask = Task { await
//  surface.fetchOnce(refresh) }`. `fetchOnce` (SurfaceStoreV5.swift,
//  FETCHOWNER-1) temporarily swaps in the one-off fetch closure, calls
//  `load()` exactly once, then restores the standing fetch — it is the
//  single mechanism `goTo`'s Retry path relies on for "one owning request."
//  `goTo`/`retryPending` are private to `TodayHostV5` (by design — see
//  HostsV5.swift's own extracted-pure-function pattern for stateful logic
//  this file already uses), so this drives `V5Surface.fetchOnce` directly,
//  the same way SurfaceCancellationTests.swift drives `V5Surface.load()`
//  directly rather than through a live host.
//
//  RULE 22 · WHAT THIS TEST CANNOT FAIL ON
//
//  It does not prove `goTo` ACTUALLY calls `fetchOnce` on retry (that is a
//  source-reading fact, not something this file can observe) — it proves
//  that fetchOnce ITSELF, the mechanism goTo relies on, only ever issues one
//  call to whatever closure it's given, and that a second, immediately
//  following retry doesn't leave a first one still contributing writes to
//  `model` behind the caller's back.
//

import XCTest
@testable import Faff

@MainActor
final class RetryOwnershipTests: XCTestCase {

    private struct Payload: Decodable, Equatable { let n: Int }

    private actor CallCounter {
        private(set) var count = 0
        func bump() -> Int { count += 1; return count }
    }

    /// The direct case: one Retry, one call to the owning fetch closure.
    func testFetchOnceCallsItsClosureExactlyOnce() async throws {
        let counter = CallCounter()
        let surface = V5Surface<Payload>(cache: nil) {
            let n = await counter.bump()
            return .ok(Payload(n: n))
        }

        await surface.fetchOnce { .ok(Payload(n: await counter.bump())) }

        let calls = await counter.count
        XCTAssertEqual(calls, 1,
                       "a single Retry must own exactly one fetch call; the closure ran \(calls) times")
        XCTAssertEqual(surface.model, Payload(n: 1))
    }

    /// `fetchOnce` restores the surface's STANDING fetch afterward
    /// (FETCHOWNER-1) — a later, unrelated refresh (foreground, a plan
    /// mutation) must call the ORIGINAL closure the surface was constructed
    /// or last rebound with, not the one-off retry closure left behind. If
    /// this regressed, an app-wide foreground refresh after a Retry on some
    /// OTHER date would silently keep re-fetching that abandoned date
    /// instead of the surface's real subject.
    func testFetchOnceRestoresTheStandingFetchAfterward() async throws {
        let standingCounter = CallCounter()
        let retryCounter = CallCounter()
        let surface = V5Surface<Payload>(cache: nil) {
            .ok(Payload(n: await standingCounter.bump()))
        }

        // The retry's own one-off fetch, exactly as goTo's else-branch
        // passes `refresh` to `fetchOnce`.
        await surface.fetchOnce { .ok(Payload(n: await retryCounter.bump() + 1000)) }
        let retryCallsAfterFetchOnce = await retryCounter.count
        let standingCallsAfterFetchOnce = await standingCounter.count
        XCTAssertEqual(retryCallsAfterFetchOnce, 1)
        XCTAssertEqual(standingCallsAfterFetchOnce, 0,
                       "the retry's one-off fetch must not touch the standing fetch at all")

        // A later, unrelated refresh (e.g. .faffForegroundRefresh) must hit
        // the ORIGINAL standing fetch, not the retry's now-stale closure.
        await surface.load()
        let standingCallsAfterLoad = await standingCounter.count
        let retryCallsAfterLoad = await retryCounter.count
        XCTAssertEqual(standingCallsAfterLoad, 1,
                       "a refresh after a Retry must call the surface's real standing fetch")
        XCTAssertEqual(retryCallsAfterLoad, 1,
                       "the retry's one-off closure must never be called again after fetchOnce returns")
    }

    /// Rule 18 falsifier: prove this counting mechanism can actually see a
    /// double-fire, so a passing count of 1 above is a real fact and not an
    /// artifact of a counter that can't go above 1.
    func testRuleEighteenFalsifier_twoDirectCallsAreCountedAsTwo() async throws {
        let counter = CallCounter()
        let surface = V5Surface<Payload>(cache: nil) {
            .ok(Payload(n: await counter.bump()))
        }
        await surface.fetchOnce { .ok(Payload(n: await counter.bump())) }
        await surface.fetchOnce { .ok(Payload(n: await counter.bump())) }
        let calls = await counter.count
        XCTAssertEqual(calls, 2,
                       "sanity check: two genuinely separate fetchOnce calls must count as two, "
                       + "or this mechanism cannot be trusted to catch a real double-fire")
    }
}
