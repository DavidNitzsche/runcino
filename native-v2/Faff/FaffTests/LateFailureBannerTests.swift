//
//  LateFailureBannerTests.swift
//  faff.run iPhone · LATEFAILURE-1's own coverage.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE BUG, FROM DAVID'S PHYSICAL DEVICE
//
//  A real backend reliability event (502s and ~13s client timeouts across
//  `/api/v5/plan-snapshot`, `/api/watch/today`, `/api/readiness`,
//  `/api/v5/today`, `/api/v5/block`, `/api/ingest/workout`), followed by a
//  real recovery — every one of those endpoints subsequently answered 200.
//  Decisions > Request Log showed `sync state: idle`, `sync generation`
//  advancing, and a recent `last successful sync`. The global "Can't reach
//  faff. Showing what you had 6 hours ago." banner never cleared on its own.
//
//  `SurfaceCancellationTests` (CANCELBANNER-2, same file, same day) named
//  this exact gap as a known, still-open defect while fixing a NEIGHBOURING
//  one: "a genuinely-failed load that lands after a healthy one still raises
//  the banner over current content, indefinitely, until the next success."
//  CANCELBANNER-2 only silenced a late CANCELLATION arriving after a
//  success. It did nothing for a late, genuine FAILURE (a timeout, a 502)
//  arriving after a success — which is exactly what David's phone hit, and
//  exactly what this file is about.
//
//  ─────────────────────────────────────────────────────────────────────────
//  ROOT CAUSE
//
//  `V5Surface.markStaleAfterDebounce()` used to bump its generation counter
//  at COMPLETION time (on every success, absence, or failure), never at
//  START time. So when an OLDER, slower request (started first, still
//  in flight) finally failed AFTER a NEWER request had already succeeded,
//  the failure's own bump made it look like "the newest event" — the
//  debounce guard only asks "did anything else finish while I waited",
//  and by the time the old failure is even recorded, the newer success has
//  already happened and stopped mattering to that question. 1.2 seconds
//  later, `stale` flips back to `true` over a screen that is, in truth,
//  completely current, and nothing ever asks the surface to refresh again
//  on its own — the banner is stuck until the runner forces a fresh load.
//
//  The fix (`SurfaceStoreV5.swift`) claims an attempt number at the START
//  of `load()`/`presentSync()`, before any `await`, and gates every
//  completion — success, absence, AND failure — on still being the latest
//  attempt. A straggling failure from a superseded attempt is dropped the
//  instant it is caught, before it can even schedule the debounced "show".
//
//  ─────────────────────────────────────────────────────────────────────────
//  RULE 22 · WHAT THIS GATE CANNOT FAIL ON
//
//  · It cannot fail on the RENDERING. `stale`/`cachedAt` are the flags;
//    whether `StaleBannerV5` is actually wired to them is a view-hierarchy
//    claim a screenshot settles, not this file.
//  · It cannot fail on true concurrency at the transport layer —
//    `V5RequestCoalescer` collapses two truly-simultaneous GETs to the same
//    URL into one shared result, so this file drives the race the way it
//    actually occurs in production per `SurfaceCancellationTests`' own
//    measurement: two SEQUENTIAL `load()` calls whose underlying requests
//    settle out of order, not two requests literally in flight together on
//    the same URL.
//  · It cannot fail on Block/Races sharing a DIFFERENT implementation from
//    Today — they share this exact generic `V5Surface<Model>` class, so
//    `testBlockSurfaceSharesTheSameLateFailureFix` is a proof the fix lives
//    in one place, not independent coverage of a second one.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WATCH (`/api/watch/today`) IS ARCHITECTURALLY INDEPENDENT OF THIS FILE
//
//  `WatchSync` (`WatchSync.swift`) is a plain `NSObject`/`ObservableObject`
//  that pushes the watch payload over `WCSession` — it does not hold a
//  `V5Surface`, has no `stale` flag, and does not feed `StaleBannerV5` or
//  any of the outage machinery this file tests. There is no equivalent
//  recovery test to write for it here; per the task's own instruction,
//  saying so explicitly is the correct outcome rather than a test that
//  would only assert something true by construction.
//

import XCTest
@testable import Faff

@MainActor
final class LateFailureBannerTests: XCTestCase {

    /// STALEDEBOUNCE-1 waits 1.2s before flipping `stale`. Anything longer
    /// than that is enough to observe the settled answer.
    private let staleSettleWait: UInt64 = 1_800_000_000

    private struct Payload: Codable, Equatable { let ok: Bool }

    /// Lets a test control exactly when the FIRST call to a surface's fetch
    /// resolves, and with what, while a SECOND call resolves immediately —
    /// the shape `SurfaceCancellationTests` measured live: two sequential
    /// `load()` calls whose underlying requests settle out of order, not
    /// two requests genuinely in flight together on one coalesced URL.
    private actor StaggeredFetch<T> {
        private var pendingFirst: CheckedContinuation<API.V5Fetch<T>, Error>?
        private var callCount = 0
        private let secondResult: () -> API.V5Fetch<T>

        init(secondResult: @escaping () -> API.V5Fetch<T>) {
            self.secondResult = secondResult
        }

        func next() async throws -> API.V5Fetch<T> {
            callCount += 1
            if callCount == 1 {
                return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<API.V5Fetch<T>, Error>) in
                    pendingFirst = cont
                }
            }
            return secondResult()
        }

        /// Resolve the FIRST call's pending continuation with a genuine
        /// (non-cancellation) failure, as if a slow request finally timed
        /// out or 502'd well after a later, faster call already succeeded.
        func failFirst(with error: Error) {
            pendingFirst?.resume(throwing: error)
            pendingFirst = nil
        }
    }

    // MARK: - 1. Generation N fails; generation N+1 succeeds → banner clears
    // automatically, no user action.

    func testGenerationNFailsThenGenerationNPlus1SucceedsClearsTheBanner() async throws {
        var shouldFail = true
        let s = V5Surface<Payload>(cache: nil) {
            shouldFail ? .failed : .ok(Payload(ok: true))
        }

        await s.load()   // generation N: a 502, surfaced as `.failed`
        try await Task.sleep(nanoseconds: staleSettleWait)
        XCTAssertTrue(s.stale, "setup check: a genuine failure must raise the banner")

        shouldFail = false
        await s.load()   // generation N+1: the backend recovered
        XCTAssertFalse(s.stale, "the banner must clear the instant the next load succeeds, with no user action")
        XCTAssertEqual(s.model, Payload(ok: true))
    }

    // MARK: - 2. Generation N times out; generation N+1 succeeds; generation
    // N then completes LATE (after N+1) → the late, stale failure must NOT
    // restore/re-trigger the banner. THE DEFECT, DIRECTLY.

    func testALateArrivingFailureAfterANewerSuccessDoesNotResurrectTheBanner() async throws {
        let staggered = StaggeredFetch<Payload> { .ok(Payload(ok: true)) }
        let s = V5Surface<Payload>(cache: nil) { try await staggered.next() }

        // Generation N: starts first, hangs (the ~13s timeout David's phone
        // actually hit) — represented here as a continuation this test
        // controls directly rather than a real clock.
        let staleLoad = Task { await s.load() }
        // Give generation N's fetch a moment to actually register as
        // in-flight (StaggeredFetch's callCount == 1) before generation N+1
        // starts, so the two are ordered the way the incident was ordered.
        try await Task.sleep(nanoseconds: 100_000_000)

        // Generation N+1: starts second, resolves fast, succeeds — the real
        // recovery David's log showed (`/api/v5/today` back to 200).
        await s.load()
        XCTAssertFalse(s.stale, "setup check: the newer, successful load must clear the banner")
        XCTAssertEqual(s.model, Payload(ok: true))

        // Generation N FINALLY fails, arriving after N+1 already succeeded —
        // the exact out-of-order completion from the bug report.
        await staggered.failFirst(with: URLError(.timedOut))
        await staleLoad.value

        try await Task.sleep(nanoseconds: staleSettleWait)
        XCTAssertFalse(s.stale, "a late, superseded failure must never resurrect the banner over a newer success")
        XCTAssertEqual(s.model, Payload(ok: true), "the newer, correct model must survive the late straggler too")
    }

    // MARK: - 3. Core Today data succeeds while an optional/non-critical
    // endpoint fails → no global "can't reach" banner.

    func testAFailingOptionalSurfaceNeverRaisesAnUnrelatedCoreSurfacesBanner() async throws {
        // Each `V5Surface` owns exactly one endpoint's health — there is no
        // shared/global flag a failing surface could reach into. `today`
        // stands in for a core read (`/api/v5/today`); `optional` stands in
        // for a non-critical one (e.g. `/api/readiness`) that the checklist
        // is explicit must not be allowed to raise Today's own banner.
        let today = V5Surface<Payload>(cache: nil) { .ok(Payload(ok: true)) }
        let optional = V5Surface<Payload>(cache: nil) { .failed }

        await today.load()
        await optional.load()
        try await Task.sleep(nanoseconds: staleSettleWait)

        XCTAssertFalse(today.stale, "an optional endpoint's failure must never raise a core surface's banner")
        XCTAssertTrue(optional.stale, "the optional surface still records its OWN failure — just not globally")
    }

    // MARK: - 4. Core Today data remains unavailable while unrelated
    // profile/settings calls succeed → banner correctly STAYS UP. The
    // "don't clear on any 200" overcorrection check.

    func testCoreSurfaceStaysDownDespiteAnUnrelatedSurfaceSucceeding() async throws {
        let today = V5Surface<Payload>(cache: nil) { .failed }
        await today.load()
        try await Task.sleep(nanoseconds: staleSettleWait)
        XCTAssertTrue(today.stale, "setup check: core data is down")

        // Stands in for /api/profile/state, /api/profile/notifications, etc.
        // succeeding during the same window — an unrelated surface's own
        // success must have no path back into `today`'s flag.
        let profileSettings = V5Surface<Payload>(cache: nil) { .ok(Payload(ok: true)) }
        await profileSettings.load()

        XCTAssertTrue(today.stale, "an unrelated surface succeeding must never clear the core surface's own banner")
    }

    // MARK: - 5. Cached data displays first during a real outage, then
    // fresh data arrives → the displayed cache-age claim AND the banner
    // state both update truthfully once fresh data commits.

    func testCachedAgeAndBannerBothUpdateTruthfullyOnceFreshDataLands() async throws {
        // AppCacheRetentionTests' own pattern: point `AppCache.store` at an
        // isolated suite for this test's duration so the assertion is about
        // what THIS test wrote, not whatever a dev machine's simulator has
        // lying around in `.standard`.
        let suiteName = "LateFailureBannerTests.\(UUID().uuidString)"
        let suite = UserDefaults(suiteName: suiteName)!
        AppCache.store = suite
        defer {
            suite.removePersistentDomain(forName: suiteName)
            AppCache.store = .standard
        }

        let sixHoursAgo = Date().addingTimeInterval(-6 * 3600)
        AppCache.writeRaw(.v5Today, data: try JSONEncoder().encode(Payload(ok: true)))
        // `writeRaw` just stamped "now" — overwrite it to simulate a cache
        // that is genuinely six hours old, matching David's own banner text.
        suite.set(sixHoursAgo, forKey: "faff.cache.v5.today.at")

        var shouldFail = true
        let s = V5Surface<Payload>(cache: .v5Today) {
            shouldFail ? .failed : .ok(Payload(ok: true))
        }
        // Seeded synchronously from disk at init, per this store's own
        // contract — the cached payload is on screen before any network
        // call, and its age is the true one from disk.
        XCTAssertEqual(s.model, Payload(ok: true))
        XCTAssertEqual(s.cachedAt, sixHoursAgo)

        await s.load()   // the real outage: refresh fails, cache stays up
        try await Task.sleep(nanoseconds: staleSettleWait)
        XCTAssertTrue(s.stale)
        XCTAssertEqual(s.cachedAt, sixHoursAgo,
                       "the banner's age claim must stay honest — still six hours old, not reset by a failed refresh")

        shouldFail = false
        await s.load()   // fresh data arrives
        XCTAssertFalse(s.stale, "the banner must clear the instant fresh data commits")
        let cachedAt = try XCTUnwrap(s.cachedAt)
        XCTAssertTrue(Date().timeIntervalSince(cachedAt) < 5,
                      "the age claim must now read as current — no lingering six-hours-old text once fresh data landed")
    }

    // MARK: - 6. Block shares the same `V5Surface` machinery as Today — the
    // fix lives in one class, and this proves it holds there too rather
    // than assuming a shared generic type behaves identically without
    // being asked. (Watch is architecturally independent — see this file's
    // header for why no equivalent test exists for it.)

    func testBlockSurfaceSharesTheSameLateFailureFix() async throws {
        let staggered = StaggeredFetch<Payload> { .ok(Payload(ok: true)) }
        // `V5Surfaces.block()` wires the identical `V5Surface<V5Block>`
        // machinery to `/api/v5/block`; a bare `V5Surface<Payload>` here
        // exercises the exact same class the real Block surface uses.
        let block = V5Surface<Payload>(cache: nil) { try await staggered.next() }

        let staleLoad = Task { await block.load() }
        try await Task.sleep(nanoseconds: 100_000_000)
        await block.load()
        XCTAssertFalse(block.stale, "setup check: Block's own newer, successful load clears its banner")

        await staggered.failFirst(with: URLError(.timedOut))
        await staleLoad.value

        try await Task.sleep(nanoseconds: staleSettleWait)
        XCTAssertFalse(block.stale, "Block must not resurrect its banner from a late, superseded failure either")
    }
}
