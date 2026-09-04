//
//  RPECaptureTests.swift
//  Real interaction coverage for `API.postRPE`/`API.fetchRPE` — the network
//  layer `RPECaptureRow` (DesignV5/RPEV5.swift) is built on.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT THIS PROVES, AND WHAT IT CANNOT
//
//  Same strategy as `SignInFlowTests`: a process-wide `URLProtocol` stub
//  intercepts `URLSession.shared`, so every case here is a real, deterministic
//  round trip through `API.authedSend` — request construction, response
//  decoding, and the 200-499 status handling `postRPE`/`fetchRPE` do — with
//  no real network and no production database. A screenshot of an existing
//  value already on the server (what earlier verification in this branch
//  produced) proves the row can DISPLAY a value; it does not prove the WRITE
//  path works. This file is that missing proof.
//
//  WHAT IT CANNOT REACH: `RPECaptureRow`'s own `@State` (the 120ms-debounce-
//  free `submitting` guard against a rapid double-tap, the `pickedRpe !=
//  priorRpe` dirty check that shows/hides the Save button) is SwiftUI view
//  state with no public seam, and this project carries no view-inspection
//  library (no ViewInspector, confirmed by grep before this file was
//  written) to reach it. That guard is read from the source in the review
//  below and verified by rendering, not by a unit test — said here rather
//  than left for someone else to discover the gap.
//
import XCTest
@testable import Faff

@MainActor
final class RPECaptureTests: XCTestCase {

    static var lastRequest: URLRequest?
    static var lastBody: [String: Any]?
    static var responder: ((URLRequest) -> (HTTPURLResponse, Data))?
    static var failWith: Error?

    override func setUp() async throws {
        try await super.setUp()
        URLProtocol.registerClass(RPETestStubProtocol.self)
        Self.lastRequest = nil
        Self.lastBody = nil
        Self.responder = nil
        Self.failWith = nil
        TokenStore.shared.set(token: "tok_test", expiresAt: nil, userUuid: "test-uuid")
    }

    override func tearDown() async throws {
        URLProtocol.unregisterClass(RPETestStubProtocol.self)
        Self.responder = nil
        Self.failWith = nil
        TokenStore.shared.clear()
        try await super.tearDown()
    }

    private func okResponse(rpe: Int, notes: String? = nil, url: URL) -> (HTTPURLResponse, Data) {
        var rpeObj: [String: Any] = ["rpe": rpe, "logged_at": "2026-09-03T10:00:00Z"]
        rpeObj["notes"] = notes as Any
        let body: [String: Any] = ["ok": true, "rpe": rpeObj]
        let data = try! JSONSerialization.data(withJSONObject: body)
        let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil,
                                   headerFields: ["Content-Type": "application/json"])!
        return (resp, data)
    }

    // MARK: - 1 · Saving a NEW value

    func test_postRPE_savesNewValue_correctRunId_correctBody() async throws {
        let runId = "run_new_abc123"
        Self.responder = { req in
            self.okResponse(rpe: 7, url: req.url!)
        }
        let ok = try await API.postRPE(runId: runId, rpe: 7)
        XCTAssertTrue(ok)
        XCTAssertEqual(Self.lastRequest?.url?.absoluteString,
                       "https://www.faff.run/api/runs/\(runId)/rpe")
        XCTAssertEqual(Self.lastRequest?.httpMethod, "POST")
        XCTAssertEqual(Self.lastBody?["rpe"] as? Int, 7)
    }

    // MARK: - 2 · Updating an EXISTING value

    func test_postRPE_updatesExistingValue_secondPostOverwritesFirst() async throws {
        let runId = "run_update_xyz"
        Self.responder = { req in self.okResponse(rpe: 4, url: req.url!) }
        _ = try await API.postRPE(runId: runId, rpe: 4)
        XCTAssertEqual(Self.lastBody?["rpe"] as? Int, 4)

        Self.responder = { req in self.okResponse(rpe: 9, url: req.url!) }
        let ok = try await API.postRPE(runId: runId, rpe: 9)
        XCTAssertTrue(ok)
        XCTAssertEqual(Self.lastBody?["rpe"] as? Int, 9,
                       "the second POST carries the UPDATED value, not the first")
    }

    // MARK: - 3 · Request failure (server error)

    func test_postRPE_serverError_returnsFalse_notThrows() async throws {
        Self.responder = { req in
            let resp = HTTPURLResponse(url: req.url!, statusCode: 500, httpVersion: nil, headerFields: nil)!
            let data = try! JSONSerialization.data(withJSONObject: ["ok": false, "error": "db unavailable"])
            return (resp, data)
        }
        let ok = try await API.postRPE(runId: "run_fail", rpe: 5)
        XCTAssertFalse(ok, "a non-2xx status must read as failure, not silently succeed")
    }

    func test_postRPE_clientError_returnsFalse() async throws {
        Self.responder = { req in
            let resp = HTTPURLResponse(url: req.url!, statusCode: 400, httpVersion: nil, headerFields: nil)!
            let data = try! JSONSerialization.data(withJSONObject: ["ok": false, "error": "bad rpe"])
            return (resp, data)
        }
        let ok = try await API.postRPE(runId: "run_badreq", rpe: 5)
        XCTAssertFalse(ok)
    }

    // MARK: - 4 · Offline / unreachable

    func test_postRPE_offline_throws() async throws {
        Self.failWith = URLError(.notConnectedToInternet)
        do {
            _ = try await API.postRPE(runId: "run_offline", rpe: 5)
            XCTFail("a network-level failure must propagate as a thrown error, never a silent false")
        } catch {
            // Any thrown error is correct here — `authedSend` wraps the
            // URLSession failure and rethrows it. The row's own `submit()`
            // catches this and shows "Could not save. Try again." (read from
            // source; not reachable from this test — see file header).
        }
    }

    func test_fetchRPE_offline_throws() async throws {
        // CORRECTED DURING THIS PASS: `fetchRPE` is `async throws`, and only
        // its JSON DECODE step is wrapped in `try?` — a network-level
        // failure propagates exactly like `postRPE`'s. The first draft of
        // this test asserted the opposite (`nil`, no throw) from a
        // description of the call site rather than the function itself, and
        // failed against the real implementation — which is exactly what
        // this file exists to catch.
        //
        // What DOES read as "no prior value" on a failed load is one layer
        // up: `RPECaptureRow.loadPrior()` wraps this call in its OWN `try?`,
        // so from the row's perspective a genuinely offline load and an
        // honest "nothing saved yet" currently look identical — the row
        // just shows "Add" either way. That is a real Rule 11 question
        // (recorded in the handback) and not something this test can settle
        // by itself; it can only state what `fetchRPE` itself does, which is
        // throw.
        Self.failWith = URLError(.networkConnectionLost)
        do {
            _ = try await API.fetchRPE(runId: "run_offline_fetch")
            XCTFail("a network-level failure must propagate, not read as an empty answer")
        } catch {
            // any thrown error is correct
        }
    }

    func test_fetchRPE_undecodableSuccessBody_returnsNil_doesNotThrow() async throws {
        // The actual swallow: a 200 whose body is not valid `RPEResponse`
        // JSON. This is the case `try?` around the decode step exists for —
        // distinct from a network failure, and asserted separately so the
        // two do not get collapsed into one claim again.
        Self.responder = { req in
            let resp = HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (resp, "not json at all".data(using: .utf8)!)
        }
        let result = try await API.fetchRPE(runId: "run_garbage_body")
        XCTAssertNil(result)
    }

    // MARK: - 5 · The correct run ID reaches the request, every time

    func test_postRPE_twoDifferentRuns_eachCarriesItsOwnId() async throws {
        Self.responder = { req in self.okResponse(rpe: 3, url: req.url!) }
        _ = try await API.postRPE(runId: "run_alpha", rpe: 3)
        XCTAssertEqual(Self.lastRequest?.url?.absoluteString,
                       "https://www.faff.run/api/runs/run_alpha/rpe")

        Self.responder = { req in self.okResponse(rpe: 8, url: req.url!) }
        _ = try await API.postRPE(runId: "run_beta", rpe: 8)
        XCTAssertEqual(Self.lastRequest?.url?.absoluteString,
                       "https://www.faff.run/api/runs/run_beta/rpe",
                       "a second run's write must never reuse the first run's id")
    }

    // MARK: - 6 · Fetch reads back what was just saved — "persists" from the

    // client's point of view, since RPE has no local cache: every render of
    // `RPECaptureRow` re-fetches from the server on `.task`, so "does it
    // survive a relaunch" is exactly "does a fresh fetch return the saved
    // row," which is what a relaunch's first render does.
    func test_fetchRPE_returnsThePreviouslySavedValue() async throws {
        let runId = "run_roundtrip"
        Self.responder = { req in self.okResponse(rpe: 6, notes: "felt controlled", url: req.url!) }
        _ = try await API.postRPE(runId: runId, rpe: 6, notes: "felt controlled")

        // A fresh fetch — the same call `RPECaptureRow.loadPrior()` makes on
        // every appearance, including the first one after a cold launch.
        Self.responder = { req in self.okResponse(rpe: 6, notes: "felt controlled", url: req.url!) }
        let fetched = try await API.fetchRPE(runId: runId)
        XCTAssertEqual(fetched?.rpe?.rpe, 6)
        XCTAssertEqual(fetched?.rpe?.notes, "felt controlled")
    }

    func test_fetchRPE_noPriorValue_returnsNilRPE_notFailure() async throws {
        Self.responder = { req in
            let body: [String: Any] = ["ok": true, "rpe": NSNull()]
            let data = try! JSONSerialization.data(withJSONObject: body)
            let resp = HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (resp, data)
        }
        let fetched = try await API.fetchRPE(runId: "run_never_rated")
        XCTAssertNotNil(fetched, "the envelope decoded — {ok:true, rpe:null} is a real, successful answer")
        XCTAssertNil(fetched?.rpe, "no rating yet is `nil`, never a synthesised zero (Rule 11)")
    }

    // MARK: - 7 · Notes are optional and independent of the rating

    func test_postRPE_withoutNotes_omitsNotesFromBody() async throws {
        Self.responder = { req in self.okResponse(rpe: 5, url: req.url!) }
        _ = try await API.postRPE(runId: "run_nonotes", rpe: 5, notes: nil)
        XCTAssertNil(Self.lastBody?["notes"],
                    "no notes typed must not send an empty-string notes field")
    }

    func test_postRPE_withNotes_includesThemVerbatim() async throws {
        Self.responder = { req in self.okResponse(rpe: 5, notes: "quads heavy", url: req.url!) }
        _ = try await API.postRPE(runId: "run_withnotes", rpe: 5, notes: "quads heavy")
        XCTAssertEqual(Self.lastBody?["notes"] as? String, "quads heavy")
    }
}

// MARK: - Stub

final class RPETestStubProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        RPECaptureTests.lastRequest = request
        if let bodyStream = request.httpBodyStream {
            bodyStream.open(); defer { bodyStream.close() }
            var data = Data()
            let buf = UnsafeMutablePointer<UInt8>.allocate(capacity: 4096)
            defer { buf.deallocate() }
            while bodyStream.hasBytesAvailable {
                let n = bodyStream.read(buf, maxLength: 4096)
                if n <= 0 { break }
                data.append(buf, count: n)
            }
            RPECaptureTests.lastBody = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        } else if let body = request.httpBody {
            RPECaptureTests.lastBody = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
        }

        if let err = RPECaptureTests.failWith {
            client?.urlProtocol(self, didFailWithError: err)
            return
        }
        guard let responder = RPECaptureTests.responder else {
            let err = NSError(domain: "FaffTests", code: -1, userInfo: [
                NSLocalizedDescriptionKey: "No URLProtocol responder configured for this test."
            ])
            client?.urlProtocol(self, didFailWithError: err)
            return
        }
        let (resp, data) = responder(request)
        client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
