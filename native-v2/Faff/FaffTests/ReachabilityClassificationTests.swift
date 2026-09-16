//
//  ReachabilityClassificationTests.swift
//  faff.run iPhone · BA-01R items 10/11 — F147's own coverage.
//
//  David, physical device, fully connected: a completed run showed "isn't
//  available offline." Root cause: `API.authedSend`'s catch block posted
//  the SAME global `.faffReachabilityLost` signal for a request that merely
//  TIMED OUT as it did for a genuine dropped connection — `isOffline`
//  (`HostsV5.swift`) is driven by that one notification, with no way to
//  tell the two apart once it fired. `API.shouldRaiseReachabilityLost(_:)`
//  is the extracted decision `authedSend` now gates the banner on; these
//  tests are what prove it actually distinguishes the two, the same
//  discipline `CancellationBannerTests.swift` already applies to the
//  sibling `isCancellation` predicate in this same file.
//
//  Rule 16 note: this delegates to `SettingsLoadFailure.categorize`, whose
//  own classification behavior is already covered by
//  `SettingsFailureStateTests.testRealTransportFailuresKeepTheirOwnCategories`
//  — these tests exist to pin the NEW gate built on top of it (which of
//  `categorize`'s outcomes may raise the banner), not to re-prove `categorize`
//  itself.
//

import XCTest
@testable import Faff

final class ReachabilityClassificationTests: XCTestCase {

    // MARK: - RULE 18 FALSIFIER · the regression itself

    /// The exact defect: before this predicate existed, a timeout raised the
    /// banner identically to a dropped connection. If this ever reads true
    /// again, F147 is back.
    func testRuleEighteenFalsifier_timeoutMustNeverRaiseTheBanner() {
        XCTAssertFalse(API.shouldRaiseReachabilityLost(URLError(.timedOut)),
                        "RULE 18: a timeout is not a transport reachability loss — this is the exact F147 regression shape")
    }

    // MARK: - The cases that MUST raise the banner

    func testNotConnectedToInternetRaisesTheBanner() {
        XCTAssertTrue(API.shouldRaiseReachabilityLost(URLError(.notConnectedToInternet)))
    }

    func testCannotConnectToHostRaisesTheBanner() {
        XCTAssertTrue(API.shouldRaiseReachabilityLost(URLError(.cannotConnectToHost)))
    }

    func testNetworkConnectionLostRaisesTheBanner() {
        XCTAssertTrue(API.shouldRaiseReachabilityLost(URLError(.networkConnectionLost)))
    }

    func testDnsLookupFailedRaisesTheBanner() {
        XCTAssertTrue(API.shouldRaiseReachabilityLost(URLError(.dnsLookupFailed)))
    }

    func testCannotFindHostRaisesTheBanner() {
        XCTAssertTrue(API.shouldRaiseReachabilityLost(URLError(.cannotFindHost)))
    }

    // MARK: - The cases that must NOT raise the banner — every one of these
    // used to, before this fix, and each is a distinct reason it must not.

    func testTimedOutDoesNotRaiseTheBanner() {
        XCTAssertFalse(API.shouldRaiseReachabilityLost(URLError(.timedOut)))
    }

    /// Already excluded upstream (`authedSend` returns early via
    /// `isCancellation` before this predicate is ever consulted), but the
    /// predicate itself must still answer honestly if ever called directly.
    func testCancellationDoesNotRaiseTheBanner() {
        XCTAssertFalse(API.shouldRaiseReachabilityLost(CancellationError()))
        XCTAssertFalse(API.shouldRaiseReachabilityLost(URLError(.cancelled)))
    }

    func testUnauthorizedDoesNotRaiseTheBanner() {
        XCTAssertFalse(API.shouldRaiseReachabilityLost(APIAuthError.unauthorized))
    }

    func testServerErrorDoesNotRaiseTheBanner() {
        XCTAssertFalse(API.shouldRaiseReachabilityLost(API.APIError.badStatus(503)))
    }

    func testADecodeFailureDoesNotRaiseTheBanner() {
        let decodeError = DecodingError.dataCorrupted(
            DecodingError.Context(codingPath: [], debugDescription: "test"))
        XCTAssertFalse(API.shouldRaiseReachabilityLost(decodeError))
    }

    func testAnUnrelatedErrorTypeDoesNotRaiseTheBanner() {
        struct SomeOtherError: Error {}
        XCTAssertFalse(API.shouldRaiseReachabilityLost(SomeOtherError()))
    }
}
