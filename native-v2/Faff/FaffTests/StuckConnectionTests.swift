//
//  StuckConnectionTests.swift
//  STUCKCONN-2 · the stale banner that would not go away.
//
//  David, 2026-09-04, with a healthy server and an eleven-hour-old cache on
//  screen: "There's no error. There is some huge bug somewhere making this
//  happen. I've brought this up MANY times."
//
//  He was right on both counts. STUCKCONN-1 named the cause correctly (a dead
//  pooled HTTP/2 connection URLSession keeps reusing) and then shipped a
//  detector that could not fire in that situation, plus a Retry button that
//  reissued the request down the same dead connection.
//
//  ─────────────────────────────────────────────────────────────────────────
//  RULE 22 · WHAT THIS FILE CANNOT FAIL ON
//
//  It cannot fail on the WINDOW or THRESHOLD being wrong. `windowSec` (90) and
//  `threshold` (3) are private to the actor and are policy, not measurement;
//  a build that moved either would pass every test here while changing when a
//  runner's connection actually gets reset.
//
//  It cannot fail on `URLSession.shared.reset` not actually fixing a stuck
//  connection. That is Foundation's behaviour and no unit test observes it.
//  The evidence for that half is the OS log in STUCKCONN-1's incident.
//
//  And it cannot prove the Retry button is wired, only that the function it
//  should call exists and is reachable. `_retry_resets_pool` in the sweep
//  checks the call sites textually, which is the weaker but honest check.
//

import XCTest
@testable import Faff

final class StuckConnectionTests: XCTestCase {

    // MARK: - the foreground predicate

    func testColdStartDoesNotResetThePool() {
        // Nil `lastActiveAt` is a fresh process. There is no pool to be stale,
        // so spending a reset here fixes a state that cannot exist.
        XCTAssertFalse(ForegroundWork.shouldResetConnections(now: Date(), lastActiveAt: nil))
    }

    func testAnOrdinaryAppSwitchDoesNotResetThePool() {
        let now = Date()
        XCTAssertFalse(ForegroundWork.shouldResetConnections(
            now: now, lastActiveAt: now.addingTimeInterval(-30)))
    }

    func testTheElevenHourCaseResets() {
        // The actual incident, to the hour.
        let now = Date()
        XCTAssertTrue(ForegroundWork.shouldResetConnections(
            now: now, lastActiveAt: now.addingTimeInterval(-11 * 3600)))
    }

    func testTheBoundaryIsContinuousAndOneDirectional() {
        // Rule 9 in miniature: no window of time where a LONGER background
        // resets and a shorter one does not, or vice versa.
        let now = Date()
        var sawFalse = false
        var sawTrue = false
        var previous = false
        for secs in stride(from: 0.0, through: 900.0, by: 15.0) {
            let v = ForegroundWork.shouldResetConnections(
                now: now, lastActiveAt: now.addingTimeInterval(-secs))
            if v { sawTrue = true } else { sawFalse = true }
            XCTAssertFalse(previous && !v, "the predicate flipped back to false at \(secs)s")
            previous = v
        }
        XCTAssertTrue(sawFalse, "nothing in the walk declined to reset")
        XCTAssertTrue(sawTrue, "nothing in the walk reset")
    }

    // MARK: - the error predicate

    func testTheBrokenPooledConnectionErrorsAllCount() {
        // `.networkConnectionLost` is the one STUCKCONN-1 excluded, and it is
        // what Foundation raises when a connection the pool believed open
        // turns out to be dead. That exclusion is why the detector never fired.
        for code in [URLError.Code.timedOut, .networkConnectionLost, .cannotConnectToHost] {
            XCTAssertTrue(API.isStuckConnectionSignal(URLError(code)),
                          "\(code) should count as a stuck-connection signal")
        }
    }

    func testACleanRefusalIsNotAStuckConnection() {
        // A cancelled request and a device with no network at all are not the
        // pool being broken, and resetting on them would tear down connections
        // for no reason.
        for code in [URLError.Code.cancelled, .notConnectedToInternet, .userAuthenticationRequired] {
            XCTAssertFalse(API.isStuckConnectionSignal(URLError(code)),
                           "\(code) must not trigger a pool reset")
        }
    }

    func testANonURLErrorIsNotAStuckConnection() {
        struct Other: Error {}
        XCTAssertFalse(API.isStuckConnectionSignal(Other()))
    }
}
