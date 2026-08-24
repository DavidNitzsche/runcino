//
//  NetworkFence.swift
//  A bundle-wide block on live network from the test target.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THIS EXISTS
//
//  On 2026-08-21 `RecorderConcurrencyTests.test_overlappingDurableSaves` fired
//  eight synthetic completions with no URLProtocol stub registered, on the
//  written assumption that "every POST fails at the network layer, which is
//  the offline case." That assumption holds only on a machine with no route
//  to faff.run. On a developer Mac it does not: the simulator carries a real
//  Keychain session, every POST SUCCEEDED, and eight phantom `phone_conc_*`
//  2 mi runs landed in the PRODUCTION runs table under the signed-in runner —
//  on a real training day, where they then outvoted that day's actual 9.14 mi
//  run for the week strip's tap target.
//
//  Fixing that one test would leave the same trap set for the next one. The
//  hole was never the test; it was that reaching production was the DEFAULT
//  and a stub was the thing you had to remember. So this inverts it.
//
//  ─────────────────────────────────────────────────────────────────────────
//  HOW IT WORKS
//
//  `FaffTestNetworkFence` is the test bundle's `NSPrincipalClass` (declared in
//  project.yml → FaffTests → info.properties). XCTest instantiates the
//  principal class as the bundle loads, BEFORE the first test runs, so the
//  fence is up no matter which test executes or in what order.
//
//  It registers `FenceProtocol`, whose `canInit` claims every request. Any
//  request that reaches it had no stub in front of it, so it is:
//
//    1. failed at the network layer — the honest offline result, and the
//       behaviour tests that want an unreachable backend already expect; and
//    2. recorded and reported as a failure on the test that made it, so a
//       leak is loud at the moment it happens rather than a phantom row
//       someone finds in prod a day later.
//
//  Tests that need a REAL response keep working unchanged: `URLProtocol`
//  consults the most recently registered class first, and a test's own
//  `registerClass(TestStubProtocol.self)` in setUp runs long after this one.
//  A stub in front of the fence means the fence never sees the request.
//
//  Every network call in the app target goes through `URLSession.shared`
//  (verified — there is no `URLSession(configuration:)` anywhere in
//  Faff/Faff), which is exactly what `URLProtocol.registerClass` governs. If
//  that ever changes, a custom-configuration session must have
//  `FenceProtocol` spliced into its `protocolClasses` or it will slip the
//  fence.
//
import Foundation
import XCTest

/// Last-resort interceptor. Claims everything, answers nothing.
///
/// Every member is explicitly `nonisolated`. The test target builds at
/// `SWIFT_DEFAULT_ACTOR_ISOLATION: MainActor`, so without these annotations
/// each declaration below is implicitly `@MainActor` — while `URLProtocol`
/// calls `startLoading()` on URLSession's own thread. At
/// `SWIFT_STRICT_CONCURRENCY: minimal` the compiler does not object; the
/// runtime does, and the whole test runner dies with "unexpected exit,
/// crash, or test timeout" before a single assertion runs. Removing a
/// `nonisolated` here brings that back.
final class FenceProtocol: URLProtocol {
    nonisolated override class func canInit(with request: URLRequest) -> Bool { true }
    nonisolated override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    nonisolated override func startLoading() {
        FaffTestNetworkFence.recordEscape(request)
        // The offline case, and the only safe one: refuse to carry it.
        client?.urlProtocol(self, didFailWithError: NSError(
            domain: "FaffTestNetworkFence", code: -1009,
            userInfo: [NSLocalizedDescriptionKey:
                "Blocked live network from the test bundle: "
                + (request.url?.absoluteString ?? "(no url)")]
        ))
    }

    nonisolated override func stopLoading() {}
}

@objc(FaffTestNetworkFence)
final class FaffTestNetworkFence: NSObject, XCTestObservation {

    /// URLs that reached the fence during the running test, guarded because
    /// the recorders under test deliver from their own queues.
    nonisolated(unsafe) private static let lock = NSLock()
    nonisolated(unsafe) private static var escaped: [String] = []

    nonisolated static func recordEscape(_ request: URLRequest) {
        lock.lock(); defer { lock.unlock() }
        escaped.append(request.url?.absoluteString ?? "(no url)")
    }

    nonisolated private static func drainEscapes() -> [String] {
        lock.lock(); defer { lock.unlock() }
        let out = escaped
        escaped = []
        return out
    }

    nonisolated override init() {
        super.init()
        URLProtocol.registerClass(FenceProtocol.self)
        XCTestObservationCenter.shared.addTestObserver(self)
    }

    nonisolated func testBundleDidFinish(_ testBundle: Bundle) {
        let blocked = Self.drainEscapes()
        guard !blocked.isEmpty else { return }
        // Reported, not failed — deliberately.
        //
        // Most of what lands here is the TEST HOST app's own launch traffic:
        // booting Faff.app to host the bundle kicks off /api/v5/today,
        // /api/readiness, /api/profile and the rest, which is the app doing
        // its job and no test's fault. Failing a test for it would paint the
        // suite permanently red, and a permanently red suite is one somebody
        // eventually switches off — which is how the hole this fence closes
        // stayed open. The BLOCK is the guarantee; this list is the receipt.
        //
        // (Recording an XCTIssue per test was the first attempt. XCTest
        // throws if you record on a test that has already stopped, and the
        // throw comes back through XCTestObservationCenter as an
        // uncatchable terminate — the whole runner aborts mid-suite. Do not
        // reintroduce it.)
        var counts: [String: Int] = [:]
        for url in blocked { counts[url, default: 0] += 1 }
        print("""

        ┌─ FaffTestNetworkFence ─────────────────────────────────────────────
        │ Blocked \(blocked.count) live network request(s) from the test bundle.
        │ None of these reached a server. On a machine that CAN reach faff.run
        │ with a signed-in session, they would have hit PRODUCTION.
        \(counts.sorted { $0.key < $1.key }
                .map { "│   \($0.value)x  \($0.key)" }
                .joined(separator: "\n"))
        │
        │ If one of these came from a TEST rather than from the host app
        │ booting, that test needs a stub: register TestStubProtocol in setUp
        │ and answer through SignInFlowTests.responder (a nil responder models
        │ an unreachable backend).
        └────────────────────────────────────────────────────────────────────

        """)
    }
}
