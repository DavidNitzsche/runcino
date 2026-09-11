//
//  ColdOpenCacheHonestyTests.swift
//  faff.run iPhone · COLDOPEN-1's own coverage.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE DEFECT
//
//  `AppCache.fresh()` (renamed `withinIdentityWindow` by this fix) gated
//  `AppCache.read(_:as:)` directly: the instant a decodable, on-disk payload
//  turned 12h01m old, `read` returned nil — identical to a cold install that
//  had never cached anything. `V5Surface` seeds `model` from exactly that
//  call at `init`, so a runner who had not opened the app in over 12 hours,
//  combined with ANY failed refresh (a real outage, a slow container, one
//  dropped request), fell all the way through to the full `OutageBodyV5`
//  scaffold — "Readiness did not load" — with a perfectly legible day sitting
//  on disk two feet away. See `docs/audit-2026-09-11-session-handback.md` §5
//  Finding 1, which this fix closes.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE FALSIFICATION MATRIX (Rule 18 — run against the UNFIXED code first)
//
//  Six states, confirmed against `AppCache`/`SurfaceStoreV5` on unmodified
//  `origin/main` before this fix landed, then re-confirmed against the fix:
//
//    · Cold               — no cache entry, fetch fails.
//        BEFORE: isOutage. AFTER: unchanged (there is genuinely nothing to
//        show, and none of this is presentation to preserve).
//    · Warm                — cache <12h old, fetch fails.
//        BEFORE: model renders, stale banner after debounce. AFTER:
//        unchanged — this case was never broken, and stays that way.
//    · Offline (>12h cache) — fetch throws a transport error.
//        BEFORE: isOutage (the cache was already unreadable at `init`).
//        AFTER: model renders immediately, stale banner discloses the real
//        age.
//    · 12h01m-expired      — decodable cache, age just past the cutoff,
//        fetch fails. THE CORE REPRO.
//        BEFORE: isOutage — `AppCache.read` had already returned nil, so
//        `model` was nil before the fetch even ran.
//        AFTER: model renders from the expired cache; `stale` becomes true
//        (age disclosed) without ever touching `model`.
//    · Reconnect            — same seed, but the refresh SUCCEEDS.
//        BEFORE: N/A (moot — there was nothing to recover FROM once nil).
//        AFTER: silent recovery — `stale` clears, `cachedAt` advances, no
//        residual banner.
//    · Corrupt-cache        — bytes on disk, but they do not decode.
//        BEFORE and AFTER: identical to Cold — a corrupt payload must never
//        be confused with a valid-but-old one. This is the case COLDOPEN-1
//        must NOT touch.
//
//  Each "BEFORE" line above was independently confirmed by re-adding the old
//  `guard let data = readRaw(key), fresh(key) else { return nil }` gate to
//  a scratch copy of `read(_:as:)` and re-running this file — every "AFTER"
//  assertion failed exactly as predicted, and passed again on revert. That
//  falsification is not left as a standing toggle in this file (there is no
//  production seam to flip it through), but it is the reason each `AFTER`
//  block below states, in its own comment, what the pre-fix behavior was and
//  why — a reviewer can reproduce it by temporarily restoring the old gate.
//
//  ─────────────────────────────────────────────────────────────────────────
//  ALL THREE SURFACES SHARE THIS CODE
//
//  `V5Surfaces.today()`/`.block()`/`.races()` all construct a `V5Surface`
//  through the identical `init`, keyed only by which `AppCache.Key` they
//  read. `testAllThreeCacheKeysShareTheSameFix` exercises `.v5Today`,
//  `.v5Block` and `.v5Races` through the same expired-cache-fetch-fails
//  scenario to confirm the fix is not accidentally Today-specific.
//
//  ─────────────────────────────────────────────────────────────────────────
//  RULE 22 · WHAT THIS GATE CANNOT FAIL ON
//
//  · It cannot fail on the RENDERING. `stale`/`model`/`isOutage` are the
//    flags a screen switches on; whether `HostsV5.swift` actually reads them
//    the way this file assumes is a screenshot's claim, not this one's — see
//    the simulator-render evidence in the session report instead.
//  · It cannot fail on the DEBOUNCE WINDOW being right. Every wait below is
//    `staleSettleWait`, chosen to outlast STALEDEBOUNCE-1's 1.2s; if that
//    constant changes without this one changing too, these tests would stop
//    observing the settled answer and could pass vacuously. Kept as a single
//    named constant for exactly that reason — one place to fix.
//  · It cannot fail on a REAL network condition. "Offline" and "fetch fails"
//    are the same stand-in throw at this layer; the distinction the product
//    spec draws between them is a copy/UX question one layer up
//    (`HostsV5.swift`'s `isOffline`-gated day-navigation card), not something
//    this file's fake `fetch` closures can honestly claim to exercise.
//

import XCTest
@testable import Faff

@MainActor
final class ColdOpenCacheHonestyTests: XCTestCase {

    /// STALEDEBOUNCE-1 (and COLDOPEN-1's own `discloseAgeIfStillUnconfirmed`)
    /// both wait 1.2s. This outlasts it comfortably.
    private let staleSettleWait: UInt64 = 1_800_000_000

    private struct Payload: Codable, Equatable { let ok: Bool }

    private var suite: UserDefaults!
    private var suiteName: String!

    override func setUp() {
        super.setUp()
        // Same isolation discipline as `AppCacheRetentionTests`: a fresh,
        // empty `UserDefaults` suite per test, so a real device's actual
        // `.v5Today` cache (or a previous test's) can never leak into an
        // assertion about age boundaries.
        suiteName = "ColdOpenCacheHonestyTests.\(UUID().uuidString)"
        suite = UserDefaults(suiteName: suiteName)
        AppCache.store = suite
    }

    override func tearDown() {
        suite.removePersistentDomain(forName: suiteName)
        AppCache.store = .standard
        super.tearDown()
    }

    // MARK: - Helpers

    /// Writes `payload` under `key` and then rewrites its timestamp to
    /// `age` ago — `AppCache.writeRaw` always stamps "now", so backdating
    /// requires poking the same `".at"` key it writes, independently
    /// reconstructed here (not via any `AppCache`-internal helper) for the
    /// same reason `AppCacheRetentionTests.dynamicKeyCount` does: an
    /// independent write is what makes the resulting assertion a real claim
    /// about `AppCache`'s own age logic, not a tautology against itself.
    private func seed(_ key: AppCache.Key, payload: Payload, age: TimeInterval) {
        AppCache.writeRaw(key, data: try! JSONEncoder().encode(payload))
        let backdated = Date().addingTimeInterval(-age)
        suite.set(backdated, forKey: "faff.cache." + key.rawValue + ".at")
    }

    /// Corrupt bytes under `key` — decodable as raw `Data` (so `readRaw`
    /// finds something) but not as `Payload`.
    private func seedCorrupt(_ key: AppCache.Key) {
        AppCache.writeRaw(key, data: Data("not json at all {".utf8))
    }

    private func surface(cache: AppCache.Key, fetch: @escaping () async throws -> API.V5Fetch<Payload>) -> V5Surface<Payload> {
        V5Surface(cache: cache, fetch: fetch)
    }

    // MARK: - Cold: no cache entry, fetch fails

    func testColdNoCacheFetchFailsIsAnHonestOutage() async throws {
        let s = surface(cache: .v5Today) { throw URLError(.notConnectedToInternet) }
        XCTAssertNil(s.model, "nothing was ever cached — a cold start")
        XCTAssertTrue(s.isColdStart)

        await s.load()
        try await Task.sleep(nanoseconds: staleSettleWait)

        XCTAssertNil(s.model, "no cache and a failed fetch — there is genuinely nothing to show")
        XCTAssertTrue(s.isOutage, "this is the one case the outage scaffold exists for")
    }

    // MARK: - Warm: cache <12h old, fetch fails

    func testWarmCacheFetchFailsKeepsContentAndDisclosesAge() async throws {
        seed(.v5Today, payload: Payload(ok: true), age: 30 * 60) // 30 minutes
        let s = surface(cache: .v5Today) { throw URLError(.notConnectedToInternet) }

        XCTAssertEqual(s.model, Payload(ok: true), "a warm cache seeds immediately")
        XCTAssertFalse(s.isOutage, "content is in hand — this was never the outage case")

        await s.load()
        try await Task.sleep(nanoseconds: staleSettleWait)

        XCTAssertEqual(s.model, Payload(ok: true), "a failed refresh must never delete usable content")
        XCTAssertTrue(s.stale, "the failed refresh is disclosed")
        XCTAssertFalse(s.isOutage, "model is non-nil — never the outage screen")
    }

    // MARK: - Offline: no network at all, cache >12h old

    func testOfflineWithExpiredCacheStillShowsContent() async throws {
        seed(.v5Today, payload: Payload(ok: true), age: 30 * 60 * 60) // 30 hours
        let s = surface(cache: .v5Today) { throw URLError(.notConnectedToInternet) }

        // BEFORE this fix: `AppCache.read` had already returned nil at this
        // point (30h > `maxAgeSec`), so `model` started nil here and this
        // assertion failed.
        XCTAssertEqual(s.model, Payload(ok: true), "a decodable cache seeds regardless of age")

        await s.load()
        try await Task.sleep(nanoseconds: staleSettleWait)

        XCTAssertEqual(s.model, Payload(ok: true), "still on screen — nothing deleted it")
        XCTAssertTrue(s.stale, "30h old with no confirming refresh — honestly disclosed")
        XCTAssertFalse(s.isOutage, "BEFORE this fix this was true; the whole point of COLDOPEN-1 is that it no longer is")
    }

    // MARK: - 12h01m-expired: decodable cache, just past the cutoff, fetch fails

    func testJustPastTheCutoffFetchFailsIsTheCoreRepro() async throws {
        let justPast = AppCache.maxAgeSec + 60 // 12h01m
        seed(.v5Today, payload: Payload(ok: true), age: justPast)
        let s = surface(cache: .v5Today) { throw URLError(.notConnectedToInternet) }

        // THE DEFECT, DIRECTLY. Before COLDOPEN-1, `AppCache.read` applied
        // `fresh(key)` (now `withinIdentityWindow`) INSIDE the read, so a
        // payload one minute past `maxAgeSec` decoded to nil right here —
        // this assertion is what a scratch revert of `read(_:as:)` fails on.
        XCTAssertEqual(s.model, Payload(ok: true), "one minute past the old cutoff must still seed")
        XCTAssertFalse(s.isColdStart, "there is real content — this is not a cold start")

        await s.load()
        try await Task.sleep(nanoseconds: staleSettleWait)

        XCTAssertEqual(s.model, Payload(ok: true), "the failed refresh must not have deleted it")
        XCTAssertTrue(s.stale, "past the identity window with no confirmation — disclosed")
        XCTAssertFalse(s.isOutage, "BEFORE this fix: true. AFTER: the defect this test exists to close")
        XCTAssertNotNil(s.cachedAt, "the banner needs a real age to report")
    }

    /// The disclosure must not depend on a refresh ever having been
    /// attempted — a runner who opens the app and sees the screen before
    /// `.task` even calls `load()` (or on a build where it never gets the
    /// chance) still deserves the honest age, not silence that looks like
    /// currency.
    func testJustPastTheCutoffDisclosesEvenWithNoRefreshAttempted() async throws {
        let justPast = AppCache.maxAgeSec + 60
        seed(.v5Today, payload: Payload(ok: true), age: justPast)
        let s = surface(cache: .v5Today) { .ok(Payload(ok: true)) } // never called below

        XCTAssertFalse(s.stale, "not yet — the debounce has not settled")
        try await Task.sleep(nanoseconds: staleSettleWait)
        XCTAssertTrue(s.stale, "the seed alone, past the identity window, is enough to disclose")
        XCTAssertEqual(s.model, Payload(ok: true), "disclosure never removes the content")
    }

    // MARK: - Reconnect: recovery once the network returns

    func testReconnectAfterExpiredCacheFailureIsSilent() async throws {
        let justPast = AppCache.maxAgeSec + 60
        seed(.v5Today, payload: Payload(ok: true), age: justPast)

        var shouldFail = true
        let s = surface(cache: .v5Today) {
            if shouldFail { throw URLError(.notConnectedToInternet) }
            return .ok(Payload(ok: false))
        }

        await s.load()
        try await Task.sleep(nanoseconds: staleSettleWait)
        XCTAssertTrue(s.stale, "still down — banner showing with the honest age")
        let staleCachedAt = s.cachedAt

        // The network returns.
        shouldFail = false
        await s.load()

        XCTAssertFalse(s.stale, "a confirmed fresh read clears the banner silently")
        XCTAssertEqual(s.model, Payload(ok: false), "the new payload replaces the old one")
        XCTAssertNotEqual(s.cachedAt, staleCachedAt, "the disk timestamp actually advanced")
    }

    /// A fast, healthy refresh must never even flash the banner — the
    /// debounce is what keeps COLDOPEN-1's disclosure silent in the common
    /// case (old cache, but the network is fine).
    func testAFastSuccessfulRefreshNeverShowsTheBanner() async throws {
        let justPast = AppCache.maxAgeSec + 60
        seed(.v5Today, payload: Payload(ok: true), age: justPast)
        let s = surface(cache: .v5Today) { .ok(Payload(ok: false)) }

        await s.load()
        XCTAssertFalse(s.stale, "the refresh landed well inside the debounce window")

        // Let the debounce window fully elapse — the scheduled disclosure
        // from `init` must have been superseded by the successful load
        // above (its own `cachedAt` no longer matches the seeded value),
        // not merely delayed.
        try await Task.sleep(nanoseconds: staleSettleWait)
        XCTAssertFalse(s.stale, "no residual banner once settled")
        XCTAssertEqual(s.model, Payload(ok: false))
    }

    // MARK: - Corrupt-cache: bytes exist, but do not decode

    func testCorruptCacheIsTreatedAsNoUsableCacheNotAsValidButOld() async throws {
        seedCorrupt(.v5Today)
        let s = surface(cache: .v5Today) { throw URLError(.notConnectedToInternet) }

        XCTAssertNil(s.model, "undecodable bytes are not a payload, whatever their age")
        XCTAssertTrue(s.isColdStart, "must read exactly like Cold, not like a valid-but-old cache")

        await s.load()
        try await Task.sleep(nanoseconds: staleSettleWait)

        XCTAssertNil(s.model)
        XCTAssertTrue(s.isOutage, "no usable cache and a failed fetch — the honest outage, same as Cold")
    }

    /// The same corrupt bytes, but recent — confirms the corruption itself
    /// is what disqualifies it, independent of age either way.
    func testCorruptCacheFailsEvenWhenRecentlyWritten() async throws {
        seedCorrupt(.v5Today)
        // seedCorrupt already stamped "now" via `writeRaw` — no backdating.
        let s = surface(cache: .v5Today) { .ok(Payload(ok: true)) }
        XCTAssertNil(s.model, "a fresh timestamp does not make undecodable bytes decodable")
    }

    // MARK: - All three surfaces share this code

    func testAllThreeCacheKeysShareTheSameFix() async throws {
        for key: AppCache.Key in [.v5Today, .v5Block, .v5Races] {
            let justPast = AppCache.maxAgeSec + 60
            seed(key, payload: Payload(ok: true), age: justPast)
            let s = surface(cache: key) { throw URLError(.notConnectedToInternet) }

            XCTAssertEqual(s.model, Payload(ok: true), "\(key.rawValue) must seed an expired-but-decodable cache")

            await s.load()
            try await Task.sleep(nanoseconds: staleSettleWait)

            XCTAssertEqual(s.model, Payload(ok: true), "\(key.rawValue) must not lose content on a failed refresh")
            XCTAssertFalse(s.isOutage, "\(key.rawValue) must not fall into the outage scaffold")
            XCTAssertTrue(s.stale, "\(key.rawValue) must disclose its age")
        }
    }

    // MARK: - `AppCache` itself, independent of `V5Surface`

    func testAppCacheReadIgnoresAgeEntirely() {
        seed(.v5Today, payload: Payload(ok: true), age: 30 * 24 * 60 * 60) // 30 days
        XCTAssertEqual(AppCache.read(.v5Today, as: Payload.self), Payload(ok: true),
                        "however old, if it decodes, `read` hands it back")
    }

    func testWithinIdentityWindowTrueJustInsideTheCutoff() {
        seed(.v5Today, payload: Payload(ok: true), age: AppCache.maxAgeSec - 1)
        XCTAssertTrue(AppCache.withinIdentityWindow(.v5Today))
    }

    func testWithinIdentityWindowFalseJustPastTheCutoff() {
        seed(.v5Today, payload: Payload(ok: true), age: AppCache.maxAgeSec + 1)
        XCTAssertFalse(AppCache.withinIdentityWindow(.v5Today))
    }

    func testWithinIdentityWindowFalseWhenNeverWritten() {
        XCTAssertFalse(AppCache.withinIdentityWindow(.v5Today))
    }
}
