//
//  ForegroundWorkTests.swift
//  BA-01 required test #4 (ASAP-IMPLEMENTATION-SEQUENCE.md): "A foreground
//  test proves duplicate foreground signals coalesce while a post-import
//  signal still produces one required refresh."
//
//  `ForegroundWork.shouldLoadOnForeground(now:lastLoadAt:mustLoad:)`
//  (Util/ForegroundWork.swift, REQUESTSTORM-2/REQUESTSTORM-3) is the exact
//  mechanism this test names: two ordinary foreground posts inside
//  `foregroundLoadCoalesceSec` (3s) collapse to one real reload, but the
//  post-import post (tagged `mustLoadKey` → `mustLoad: true`) bypasses that
//  window unconditionally, because it exists specifically to catch a run the
//  first load could not have seen yet (REQUESTSTORM-3's own header explains
//  why narrowing or reshaping the window cannot fix this — only an
//  unconditional bypass can). No prior test file exercised this function at
//  all before this one — a caseless-enum free function existing specifically
//  so "a test can ask the question without standing up a SwiftUI scene"
//  (the file's own header) had never actually been asked.
//

import XCTest
@testable import Faff

final class ForegroundWorkTests: XCTestCase {

    private let epoch = Date(timeIntervalSince1970: 1_000_000)

    // MARK: - Duplicate foreground signals coalesce

    /// The ordinary case this whole mechanism exists for: a second
    /// `.faffForegroundRefresh` landing well inside the 3s window (e.g. the
    /// two deliberate posts `FaffApp` fires per foreground — immediate, then
    /// post-HealthKit-import) must NOT trigger a second `load()`.
    func testASecondSignalInsideTheCoalesceWindowDoesNotReload() {
        let lastLoadAt = epoch
        let secondSignal = epoch.addingTimeInterval(1.0)
        XCTAssertFalse(
            ForegroundWork.shouldLoadOnForeground(now: secondSignal, lastLoadAt: lastLoadAt),
            "a foreground signal 1s after the last load, well inside the "
            + "\(ForegroundWork.foregroundLoadCoalesceSec)s coalesce window, must not reload")
    }

    /// Right at the edge — just under the window — still coalesces.
    func testASignalJustUnderTheWindowStillCoalesces() {
        let lastLoadAt = epoch
        let secondSignal = epoch.addingTimeInterval(ForegroundWork.foregroundLoadCoalesceSec - 0.1)
        XCTAssertFalse(ForegroundWork.shouldLoadOnForeground(now: secondSignal, lastLoadAt: lastLoadAt))
    }

    /// A signal genuinely past the window is a real second foreground, not
    /// the tail of the same one, and must reload.
    func testASignalPastTheWindowReloads() {
        let lastLoadAt = epoch
        let laterSignal = epoch.addingTimeInterval(ForegroundWork.foregroundLoadCoalesceSec + 0.1)
        XCTAssertTrue(ForegroundWork.shouldLoadOnForeground(now: laterSignal, lastLoadAt: lastLoadAt),
                      "a foreground signal past the coalesce window is a genuine second foreground")
    }

    // MARK: - A post-import (mustLoad) signal always produces its required refresh

    /// THE REGRESSION THIS FUNCTION EXISTS TO PREVENT (REQUESTSTORM-3):
    /// the post-import post lands well inside the ordinary coalesce window
    /// (HealthKit import: 0.7-2s; window: 3s) — a plain coalescing check
    /// would swallow it, and the run it just pulled in would never reach
    /// the screen until a force-quit relaunch. `mustLoad: true` must bypass
    /// the throttle regardless of how close together the two signals are.
    func testAPostImportSignalInsideTheWindowStillReloads() {
        let lastLoadAt = epoch
        let postImportSignal = epoch.addingTimeInterval(1.0) // well inside 3s
        XCTAssertTrue(
            ForegroundWork.shouldLoadOnForeground(now: postImportSignal, lastLoadAt: lastLoadAt, mustLoad: true),
            "RULE 18: a post-import signal must reload even 1s after the prior load — this is "
            + "exactly the case REQUESTSTORM-3 exists to fix (a completed run invisible until "
            + "force-quit), and it is a real-world timing, not an edge case")
    }

    /// Even a post-import signal arriving in the SAME INSTANT as the last
    /// load must still reload — there is no gap small enough to legitimately
    /// swallow it, which is the whole point of an unconditional bypass
    /// rather than a narrower window (see REQUESTSTORM-3's own header for
    /// why narrowing the window cannot work: moving the stamp edge only
    /// shrinks the gap, it never closes the failure mode).
    func testAPostImportSignalAtZeroGapStillReloads() {
        XCTAssertTrue(ForegroundWork.shouldLoadOnForeground(now: epoch, lastLoadAt: epoch, mustLoad: true))
    }

    /// Rule 18 falsifier: confirm `mustLoad` is actually load-bearing by
    /// checking the exact same inputs WITHOUT it — this must coalesce, so
    /// the `mustLoad: true` result above is proven to come from the bypass,
    /// not from some other property of these particular timestamps.
    func testRuleEighteenFalsifier_theSameGapWithoutMustLoadCoalesces() {
        let lastLoadAt = epoch
        let signal = epoch.addingTimeInterval(1.0)
        XCTAssertFalse(
            ForegroundWork.shouldLoadOnForeground(now: signal, lastLoadAt: lastLoadAt, mustLoad: false),
            "RULE 18: the identical 1s gap without mustLoad must coalesce — if this also "
            + "returned true, the mustLoad tests above would be proving nothing")
    }

    // MARK: - Default parameter preserves every existing caller's question

    /// `mustLoad` defaults to `false` specifically so every caller that only
    /// ever asked the coalescing question keeps asking exactly that
    /// question (the function's own doc comment) — confirms the 2-arg call
    /// shape behaves identically to an explicit `mustLoad: false`.
    func testOmittingMustLoadDefaultsToTheCoalescingBehavior() {
        let lastLoadAt = epoch
        let signal = epoch.addingTimeInterval(1.0)
        XCTAssertEqual(
            ForegroundWork.shouldLoadOnForeground(now: signal, lastLoadAt: lastLoadAt),
            ForegroundWork.shouldLoadOnForeground(now: signal, lastLoadAt: lastLoadAt, mustLoad: false))
    }
}
