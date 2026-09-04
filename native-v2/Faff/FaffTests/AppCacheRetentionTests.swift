//
//  AppCacheRetentionTests.swift
//  faff.run iPhone · RETENTION-1's own coverage — the maintenance item David
//  flagged after approving the Today/week-strip reliability closure at
//  TestFlight build 259: TODAYPERSIST-1's per-date and per-week disk cache
//  had no eviction, so a runner who browses widely over a long season would
//  accumulate `UserDefaults` keys without bound.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THESE TESTS SWAP `AppCache.store`
//
//  `AppCache` writes through `UserDefaults.standard` in production, which on
//  a dev machine already carries real dynamic keys from the simulator this
//  session has installed and driven all day. A cap-and-evict test that reads
//  "how many `v5.day.*` keys exist" against `.standard` would be counting
//  entries this test never wrote, and its pass/fail would depend on
//  whatever that machine happened to have lying around — exactly the kind
//  of environment-dependent flakiness this project has repeatedly had to
//  dig out of other gates. Each test below points `AppCache.store` at a
//  freshly named, empty `UserDefaults` suite for its own duration and
//  restores `.standard` in `tearDown`, so eviction counts are counting only
//  what the test itself put there.
//

import XCTest
@testable import Faff

final class AppCacheRetentionTests: XCTestCase {

    private var suite: UserDefaults!
    private var suiteName: String!

    override func setUp() {
        super.setUp()
        suiteName = "AppCacheRetentionTests.\(UUID().uuidString)"
        suite = UserDefaults(suiteName: suiteName)
        AppCache.store = suite
    }

    override func tearDown() {
        suite.removePersistentDomain(forName: suiteName)
        AppCache.store = .standard
        super.tearDown()
    }

    // MARK: - Basic round trip, on the swapped store — sanity check that the
    // swap itself doesn't change ordinary read/write behavior.

    func testWriteThenReadRoundTripsOnTheSwappedStore() {
        let key = "v5.day.2026-09-01"
        let payload = Data(#"{"ok":true}"#.utf8)
        AppCache.writeRawDynamic(key, data: payload)
        XCTAssertEqual(AppCache.readRawDynamic(key), payload)
    }

    // MARK: - The cap itself

    /// Writing exactly the cap's worth of day entries evicts nothing —
    /// the cap is inclusive, not "cap minus one".
    func testExactlyAtCapEvictsNothing() {
        for i in 0..<60 {
            AppCache.writeRawDynamic("v5.day.2026-\(String(format: "%02d-%02d", (i / 28) + 1, (i % 28) + 1))", data: Data())
        }
        XCTAssertEqual(dynamicKeyCount(kindPrefix: "v5.day."), 60)
    }

    /// One entry past the cap evicts exactly one — the OLDEST, by its
    /// write/touch timestamp — and every entry written after it survives.
    func testOneOverCapEvictsExactlyTheOldest() {
        for i in 0..<61 {
            AppCache.writeRawDynamic(dayKey(i), data: Data())
        }
        XCTAssertEqual(dynamicKeyCount(kindPrefix: "v5.day."), 60)
        XCTAssertNil(AppCache.readRawDynamic(dayKey(0)), "the first-written entry should have been evicted")
        XCTAssertNotNil(AppCache.readRawDynamic(dayKey(60)), "the most recently written entry must survive")
    }

    /// Writing well past the cap never lets the count grow unbounded — the
    /// property RETENTION-1 exists to guarantee, stated as itself rather
    /// than only as a single-entry example.
    func testWritingManyMoreThanTheCapNeverExceedsIt() {
        for i in 0..<250 {
            AppCache.writeRawDynamic(dayKey(i), data: Data())
        }
        XCTAssertEqual(dynamicKeyCount(kindPrefix: "v5.day."), 60)
    }

    // MARK: - LRU, not plain FIFO — a read counts as recent use too

    /// The classic LRU case: entry 0 is written first (oldest by write
    /// time), but it's READ again right before the cap is breached — that
    /// read must save it from eviction, and the entry that's actually
    /// evicted is whichever was truly least-recently-touched instead.
    func testAReadTouchProtectsAnEntryFromEviction() {
        for i in 0..<60 {
            AppCache.writeRawDynamic(dayKey(i), data: Data())
        }
        // Touch entry 0 — it is now the MOST recently used, not the least.
        _ = AppCache.readRawDynamic(dayKey(0))
        // One more write breaches the cap by one.
        AppCache.writeRawDynamic(dayKey(60), data: Data())

        XCTAssertNotNil(AppCache.readRawDynamic(dayKey(0)), "a re-read entry must survive the next eviction")
        // Entry 1 was written right after entry 0 and never touched again —
        // it is now the least-recently-used and should be the one evicted.
        XCTAssertNil(AppCache.readRawDynamic(dayKey(1)), "the entry nobody touched since should be evicted instead")
    }

    // MARK: - Kinds are policed independently

    /// Filling `v5.day.*` past its cap must never evict a `v5.week.*`
    /// entry, and vice versa — matches how they're already read separately
    /// (`seedCachesFromDisk`'s `acceptDay`/`acceptWeek` are two loops, not
    /// one shared one), so eviction has to respect the same boundary.
    func testDayAndWeekCapsAreEnforcedIndependently() {
        AppCache.writeRawDynamic("v5.week.2026-09-01", data: Data("week".utf8))
        for i in 0..<70 {
            AppCache.writeRawDynamic(dayKey(i), data: Data())
        }
        XCTAssertEqual(dynamicKeyCount(kindPrefix: "v5.day."), 60)
        XCTAssertEqual(AppCache.readRawDynamic("v5.week.2026-09-01"), Data("week".utf8),
                       "filling the day cache past its cap must not touch the week cache")
    }

    func testWeekCapEvictsIndependentlyOfDayEntries() {
        for i in 0..<30 {
            AppCache.writeRawDynamic(dayKey(i), data: Data())
        }
        for i in 0..<25 {
            AppCache.writeRawDynamic(weekKey(i), data: Data())
        }
        XCTAssertEqual(dynamicKeyCount(kindPrefix: "v5.week."), 20)
        XCTAssertEqual(dynamicKeyCount(kindPrefix: "v5.day."), 30, "well under its own cap, untouched by the week eviction")
    }

    // MARK: - The fixed-slot cache is never policed by this at all

    /// `Key`-based fixed slots (one per screen, never per date) have no
    /// growth problem and must never be swept by dynamic-key retention —
    /// confirms `enforceRetention` really does gate on the two known kind
    /// prefixes and nothing else.
    func testFixedSlotCacheIsUnaffectedByDynamicRetention() {
        let fixedPayload = Data(#"{"today":true}"#.utf8)
        AppCache.writeRaw(.v5Today, data: fixedPayload)
        for i in 0..<200 {
            AppCache.writeRawDynamic(dayKey(i), data: Data())
        }
        XCTAssertEqual(AppCache.readRaw(.v5Today), fixedPayload)
    }

    // MARK: - Helpers

    private func dayKey(_ i: Int) -> String {
        "v5.day.2026-\(String(format: "%02d-%02d", (i / 28) + 1, (i % 28) + 1))"
    }

    private func weekKey(_ i: Int) -> String {
        "v5.week.2026-\(String(format: "%02d-%02d", (i / 4) + 1, ((i % 4) * 7) + 1))"
    }

    /// Counts DATA keys of a kind directly against the swapped suite,
    /// deliberately not reusing any AppCache-internal helper — an
    /// independent count is what makes this a real assertion about what
    /// eviction left behind, not a test that could pass by construction.
    private func dynamicKeyCount(kindPrefix: String) -> Int {
        let fullPrefix = "faff.cache." + kindPrefix
        return suite.dictionaryRepresentation().keys
            .filter { $0.hasPrefix(fullPrefix) && !$0.hasSuffix(".at") }
            .count
    }
}
