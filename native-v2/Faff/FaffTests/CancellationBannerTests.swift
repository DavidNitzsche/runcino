//
//  CancellationBannerTests.swift
//  faff.run iPhone · CANCELBANNER-1's own coverage.
//
//  David, physical device, after SHELLBYPASS-1 shipped: the shell no longer
//  collapsed, but the app kept "repeatedly" claiming it couldn't reach faff
//  during what was, by his own account, ordinary browsing. Root cause:
//  `API.authedSend`'s catch block posted the same global
//  `.faffReachabilityLost` banner for a request the RUNNER'S OWN NEXT TAP
//  cancelled (routine — `goTo`'s `navigationTask?.cancel()` fires on every
//  fast navigation) as it did for a genuinely dead connection.
//  `API.isCancellation(_:)` is the extracted decision `authedSend` now
//  gates the banner on; these tests are what prove it actually
//  distinguishes the two.
//

import XCTest
@testable import Faff

final class CancellationBannerTests: XCTestCase {

    // MARK: - The cases that must NOT raise the banner

    func testSwiftConcurrencyCancellationIsRecognized() {
        XCTAssertTrue(API.isCancellation(CancellationError()))
    }

    func testFoundationURLErrorCancelledIsRecognized() {
        XCTAssertTrue(API.isCancellation(URLError(.cancelled)))
    }

    // MARK: - The cases that MUST still raise the banner — a genuine
    // connectivity failure must never be swallowed by a cancellation check
    // that's too broad.

    func testTimedOutIsNotTreatedAsCancellation() {
        XCTAssertFalse(API.isCancellation(URLError(.timedOut)))
    }

    func testNotConnectedToInternetIsNotTreatedAsCancellation() {
        XCTAssertFalse(API.isCancellation(URLError(.notConnectedToInternet)))
    }

    func testCannotConnectToHostIsNotTreatedAsCancellation() {
        XCTAssertFalse(API.isCancellation(URLError(.cannotConnectToHost)))
    }

    func testNetworkConnectionLostIsNotTreatedAsCancellation() {
        XCTAssertFalse(API.isCancellation(URLError(.networkConnectionLost)))
    }

    func testDnsLookupFailedIsNotTreatedAsCancellation() {
        XCTAssertFalse(API.isCancellation(URLError(.dnsLookupFailed)))
    }

    /// A completely unrelated error type (not even a `URLError`) must read
    /// as a real failure, not silently pass as a cancellation just because
    /// it isn't explicitly handled.
    func testAnUnrelatedErrorTypeIsNotTreatedAsCancellation() {
        struct SomeOtherError: Error {}
        XCTAssertFalse(API.isCancellation(SomeOtherError()))
    }

    func testDecodingErrorIsNotTreatedAsCancellation() {
        let decodeError = DecodingError.dataCorrupted(
            DecodingError.Context(codingPath: [], debugDescription: "test"))
        XCTAssertFalse(API.isCancellation(decodeError))
    }
}
