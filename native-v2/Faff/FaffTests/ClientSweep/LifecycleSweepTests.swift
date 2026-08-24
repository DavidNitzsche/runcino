//
//  LifecycleSweepTests.swift
//  faff.run iPhone · state that went stale while the app was away.
//
//  ─────────────────────────────────────────────────────────────────────────
//  THE CLASS THAT PRODUCED A SCREENSHOT NOBODY COULD REPRODUCE.
//
//  The other three sweeps in this directory ask what happens to a payload. This
//  one asks what happens to TIME: the runner backgrounds the app, the server
//  corrects a value, the runner comes back, and the screen still shows the old
//  one. Nothing about the payload is wrong. Nothing about the decode is wrong.
//  The screen is simply answering a question that was asked earlier.
//
//  It is the hardest of the four to test and the easiest to hit, and most of
//  it had no seam to test through at all until this file — the decisions lived
//  inline in a SwiftUI closure, where a test cannot reach them.
//
//  WHAT IS COVERED HERE, and it is not everything: see the "NOT COVERED"
//  section at the foot of this file, which names every hop that still needs a
//  device. An unsimulated hop reported as clean is exactly the failure this
//  suite exists to correct.
//

import XCTest
@testable import Faff

final class LifecycleSweepTests: XCTestCase {

    private let key = AppCache.Key.userSettings

    override func tearDown() {
        AppCache.clearAll()
        super.tearDown()
    }

    // MARK: - The cache's own clock

    /// `AppCache.fresh` takes an injectable `now`, which is the one piece of
    /// this machinery that was already testable. Twelve hours, so a cached
    /// payload cannot survive the boundary between one training day and the
    /// next.
    func testCacheExpiresAtTwelveHoursAndNotBefore() {
        let ledger = SweepLedger("lifecycle · cache age", floor: 6)
        AppCache.writeRaw(key, data: Data("{}".utf8))
        guard let at = AppCache.writtenAt(key) else {
            return XCTFail("writeRaw did not stamp a timestamp — the whole TTL rests on it")
        }

        let cases: [(String, TimeInterval, Bool)] = [
            ("just written",          0,              true),
            ("an hour later",         3_600,          true),
            ("eleven hours later",    11 * 3_600,     true),
            ("one second short",      12 * 3_600 - 1, true),
            ("exactly twelve hours",  12 * 3_600,     true),
            ("one second past",       12 * 3_600 + 1, false),
            ("the next morning",      20 * 3_600,     false),
        ]

        for (name, offset, expected) in cases {
            ledger.exercised("AppCache.fresh")
            let actual = AppCache.fresh(key, now: at.addingTimeInterval(offset))
            guard actual != expected else { continue }
            ledger.found("AppCache.fresh",
                         "\(name): fresh = \(actual), expected \(expected)",
                         onScreen: expected
                            ? "an honest data-outage screen where a good cached day was available"
                            : "yesterday's session drawn as today's, with nothing on screen saying it is old")
        }

        /// A CLOCK THAT WENT BACKWARDS IS NOT FRESHNESS. A payload stamped in
        /// the future (timezone change, a clock correction) must not read as
        /// fresh forever.
        ledger.exercised("AppCache.fresh")
        XCTAssertFalse(AppCache.fresh(key, now: at.addingTimeInterval(-60)),
                       "a cache stamped in the future read as fresh")

        ledger.settle()
    }

    /// THE HOLE IN THE TTL. `read` checks freshness; `readRaw` does not, and
    /// callers reach for it whenever they want the untyped bag.
    ///
    /// Recorded rather than asserted-away: this is real, it is how
    /// `Units.applyLocalPatch` preserves fields it does not name, and changing
    /// it is a behaviour decision rather than a bug fix.
    func testReadRawDeliberatelyBypassesTheAgeCheck() {
        AppCache.writeRaw(key, data: Data(#"{"units_distance":"km"}"#.utf8))
        UserDefaults.standard.set(Date().addingTimeInterval(-48 * 3_600),
                                  forKey: "faff.cache.\(key.rawValue).at")

        XCTAssertFalse(AppCache.fresh(key), "the stamp did not take")
        XCTAssertNil(AppCache.read(key, as: UserSettings.self),
                     "`read` must refuse a two-day-old payload")
        XCTAssertNotNil(AppCache.readRaw(key),
                        "`readRaw` bypasses the age check by design — if this ever changes, Units.applyLocalPatch loses the fields it preserves")
    }

    // MARK: - A stale cache silently changes the runner's units

    /// THE SCREENSHOT DEFECT, IN THE SMALLEST FORM I CAN PROVE WITHOUT A DEVICE.
    ///
    /// `Units.preference` reads through `AppCache.read`, which is TTL-guarded.
    /// Past twelve hours the read misses and the preference falls back to the
    /// DEFAULT — miles and Fahrenheit. For a runner who set kilometres, every
    /// distance and every pace on every screen silently switches units, with
    /// no outage banner, because as far as the app is concerned nothing failed.
    ///
    /// A screenshot taken past that boundary shows numbers that are correct for
    /// units the runner never chose, and it cannot be reproduced afterwards —
    /// the next successful fetch re-writes the cache and the app looks fine.
    func testUnitsRevertToImperialOnceTheCacheAges() throws {
        let settings = #"{"units_distance":"km","units_temp":"C"}"#
        AppCache.writeRaw(key, data: Data(settings.utf8))

        XCTAssertEqual(Units.preference.distance, .km, "a fresh cache must honour the runner's choice")
        XCTAssertEqual(Units.preference.temperature, .c)

        // Age it past the boundary. Nothing else changes.
        UserDefaults.standard.set(Date().addingTimeInterval(-13 * 3_600),
                                  forKey: "faff.cache.\(key.rawValue).at")

        XCTAssertEqual(Units.preference.distance, .mi, """
        KNOWN, AND RECORDED RATHER THAN FIXED HERE. Past the 12h TTL a \
        kilometres runner is shown miles with no marker. The fix is a units \
        preference that outlives the payload cache — it is a product decision \
        about what units mean when we are offline, not a decode bug, and it \
        should not be made inside a test file.
        """)
        XCTAssertEqual(Units.preference.temperature, .f)

        // And the number on the glass really does change. This is the part a
        // runner would actually see.
        XCTAssertEqual(Units.formatDistance(miles: 10, unit: .km), "16.1")
        XCTAssertEqual(Units.formatDistance(miles: 10), "10.0",
                       "the same run, the same cache, two different distances either side of a timeout")
    }

    // MARK: - Coming back to the app

    /// THE DEFECT THIS FILE WAS OPENED FOR.
    ///
    /// The HealthKit import throttle used to gate the surface refresh too, so
    /// returning within thirty seconds refreshed NOTHING — and left no trace,
    /// because `V5Surface.stale` only means "a refresh failed", never "no
    /// refresh happened".
    func testAQuickReturnStillRefreshesTheSurfaces() {
        let ledger = SweepLedger("lifecycle · foreground", floor: 8)
        let t0 = Date()

        let cases: [(String, TimeInterval, Bool)] = [
            ("straight back",     1,   false),
            ("ten seconds",       10,  false),
            ("twenty-nine",       29,  false),
            ("thirty exactly",    30,  false),
            ("thirty-one",        31,  true),
            ("five minutes",      300, true),
        ]

        for (name, gap, shouldImport) in cases {
            ledger.exercised("ForegroundWork.shouldImport")
            let actual = ForegroundWork.shouldImport(now: t0.addingTimeInterval(gap), lastImportAt: t0)
            guard actual != shouldImport else { continue }
            ledger.found("ForegroundWork.shouldImport",
                         "\(name) (\(Int(gap))s): import = \(actual), expected \(shouldImport)",
                         onScreen: "two parallel HealthKit ingests of the same days")
        }

        // THE PART THAT WAS WRONG. The surface refresh must not inherit the
        // import's throttle at any gap at all.
        for (name, gap, _) in cases {
            ledger.exercised("ForegroundWork.shouldRefreshSurfaces")
            _ = gap
            guard !ForegroundWork.shouldRefreshSurfaces(isActive: true) else { continue }
            ledger.found("ForegroundWork.shouldRefreshSurfaces",
                         "\(name): a foreground that refreshed nothing",
                         onScreen: "Today still showing the session the server corrected while the app was away, with no stale marker, because no refresh was attempted")
        }

        ledger.exercised("ForegroundWork.shouldRefreshSurfaces")
        XCTAssertFalse(ForegroundWork.shouldRefreshSurfaces(isActive: false),
                       "backgrounding must not fire a refresh")

        ledger.settle()
    }

    // MARK: - A failed refresh keeps the old value on screen

    /// `V5Surface.load()` on failure keeps `model` and sets `stale`. That is
    /// the right call — an outage should not blank a screen the runner was
    /// reading — but it means the LAST GOOD VALUE stays visible, so `stale`
    /// is the only thing standing between the runner and a confidently wrong
    /// number. Pinned so it cannot be quietly dropped.
    @MainActor
    func testAFailedRefreshMarksStaleAndKeepsTheOldModel() async throws {
        let today = try JSONDecoder().decode(
            V5Today.self, from: Data(V5ContractTests.Fixtures.beforeRun.utf8))
        let surface = V5Surface<V5Today>(cache: nil, fetch: { .ok(today) })
        await surface.load()
        XCTAssertNotNil(surface.model, "could not seed the surface")

        // The server goes away while the runner is looking at the screen.
        await surface.rebind({ .failed })

        XCTAssertNotNil(surface.model, "a failed refresh must not blank a screen the runner is reading")
        XCTAssertTrue(surface.stale, """
        A FAILED REFRESH LEFT THE OLD VALUE ON SCREEN AND DID NOT SAY SO. \
        `stale` is the only signal separating a live number from a stranded \
        one; without it the runner cannot tell.
        """)
    }

    /// And a refusal is not an outage. Rule three: a refusal is a correct
    /// answer, and it must clear the model rather than leave a contradicting
    /// one underneath its own reason.
    @MainActor
    func testARefusalClearsTheModelAndCarriesItsReason() async throws {
        let today = try JSONDecoder().decode(
            V5Today.self, from: Data(V5ContractTests.Fixtures.beforeRun.utf8))
        let surface = V5Surface<V5Today>(cache: nil, fetch: { .ok(today) })
        await surface.load()
        XCTAssertNotNil(surface.model)

        await surface.rebind({ .absent("No plan yet.") })

        XCTAssertNil(surface.model, "a refusal must not leave the previous payload drawn beneath it")
        XCTAssertEqual(surface.absentReason, "No plan yet.")
        XCTAssertFalse(surface.stale, "a refusal is an answer, not an outage")
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// NOT COVERED, AND SAID SO RATHER THAN SKIPPED SILENTLY
//
// Every item here is a real hop in this defect class that this file does NOT
// exercise. An unsimulated hop reported as clean is the failure the sweep
// exists to correct, so they are named:
//
//  1 · THE ACTUAL BACKGROUND/FOREGROUND TRANSITION. `scenePhase` is delivered
//      by UIKit. These tests exercise the DECISION the transition makes, not
//      the transition. Proving the notification reaches every observer needs a
//      running app — an XCUITest that backgrounds and re-activates, or a device.
//
//  2 · THE @STATE HOSTS THAT NEVER REFRESH AT ALL. RunLogHostV5,
//      RunDetailHostV5, ShoesHostV5, SettingsHostV5 and the RUN pill in
//      FaffV5Root hold their data in plain `@State` behind a one-shot `.task`,
//      with no `.faffForegroundRefresh` observer and no `refreshable`. They are
//      structurally load-once for the life of the process. Nothing here can
//      see that, because there is no seam to test through — the fix and the
//      test are the same piece of work, and it is a bigger change than this
//      sweep should make on its own.
//
//  3 · SettingsCache. An actor with NO TTL despite two comments claiming one
//      ("if missing or stale", "without waiting for TTL expiry" — there is no
//      TTL). A settings or profile change made anywhere else is invisible to
//      this process until it restarts. Untestable here without a network stub:
//      `warm()` calls the API directly, and the test bundle's NSPrincipalClass
//      fence blocks unstubbed requests by design.
//
//  4 · `V5Surface.cachedAt` is a `let`, snapshotted at init and never updated
//      after a successful refresh. Any "cached N minutes ago" affordance built
//      on it would itself be stale. No such affordance is drawn today, so there
//      is nothing to assert against — a loaded gun rather than a live defect.
//
//  5 · THE DOUBLE REFRESH. Three tab hosts observe `.faffForegroundRefresh`
//      twice — once through `V5Surface`'s own unthrottled observer and once
//      through the 3s-throttled `v5ReloadOnForeground` modifier. Harmless, and
//      worth knowing before anyone counts requests in a log.
//
//  6 · WIDGET AND WATCH TIMELINE STALENESS. A different process with a
//      different lifecycle. Entirely outside this bundle.
// ─────────────────────────────────────────────────────────────────────────────
