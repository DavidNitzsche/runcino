//
//  SignInFlowTests.swift
//  End-to-end XCTest cover of the Sign In With Apple → /api/auth/apple →
//  TokenStore → Bearer-attach loop.
//
//  Strategy: register a process-wide URLProtocol stub that intercepts every
//  outbound request hitting `URLSession.shared`. Each test sets the
//  responder closure to either:
//
//    · the synthetic `{ ok: true, token, expires_at, user_uuid }` payload
//      we expect the iPhone to receive from the real /api/auth/apple, OR
//    · a 401 envelope to verify the .faffSessionExpired notification fires.
//
//  We assert against TokenStore's published state + the request bodies the
//  app sent · the only real I/O involved is the in-process URLProtocol
//  bounce, so the test runs offline + deterministically.
//

import XCTest
@testable import Faff

@MainActor
final class SignInFlowTests: XCTestCase {

    // Cleared on every test setUp so prior cases never bleed into the next.
    static var lastRequest: URLRequest?
    static var lastBody: [String: Any]?
    static var responder: ((URLRequest) -> (HTTPURLResponse, Data))?

    override func setUp() async throws {
        try await super.setUp()
        URLProtocol.registerClass(TestStubProtocol.self)
        Self.lastRequest = nil
        Self.lastBody = nil
        Self.responder = nil
        // Wipe TokenStore so each test starts signed-out. The Keychain row
        // for the test bundle is process-isolated, but explicit clear keeps
        // the @Published state honest in the test runner.
        TokenStore.shared.clear()
    }

    override func tearDown() async throws {
        URLProtocol.unregisterClass(TestStubProtocol.self)
        Self.responder = nil
        try await super.tearDown()
    }

    // MARK: - POST /api/auth/apple body shape + happy path

    func test_signInWithApple_postsCorrectBody_andSavesToken() async throws {
        Self.responder = { _ in
            let body: [String: Any] = [
                "ok": true,
                "token": "tok_abc123",
                "expires_at": "2026-08-30T00:00:00Z",
                "user_uuid": "0645f40c-aaaa-bbbb-cccc-26c79500abcd",
            ]
            let data = try! JSONSerialization.data(withJSONObject: body)
            let resp = HTTPURLResponse(url: URL(string: "https://www.faff.run/api/auth/apple")!,
                                       statusCode: 200, httpVersion: nil,
                                       headerFields: ["Content-Type": "application/json"])!
            return (resp, data)
        }

        var components = PersonNameComponents()
        components.givenName = "David"
        components.familyName = "Nitzsche"
        let resp = try await API.signInWithApple(
            identityToken: "fixture-jwt-from-apple",
            appleUserId: "001234.abc.def",
            email: "dnitch85@me.com",
            fullName: components
        )

        // 1. POST body has the exact shape /api/auth/apple expects.
        XCTAssertEqual(Self.lastRequest?.url?.absoluteString, "https://www.faff.run/api/auth/apple")
        XCTAssertEqual(Self.lastRequest?.httpMethod, "POST")
        XCTAssertEqual(Self.lastBody?["identity_token"] as? String, "fixture-jwt-from-apple")
        XCTAssertEqual(Self.lastBody?["user"] as? String, "001234.abc.def")
        XCTAssertEqual(Self.lastBody?["email"] as? String, "dnitch85@me.com")
        let fullName = Self.lastBody?["full_name"] as? [String: String]
        XCTAssertEqual(fullName?["givenName"], "David")
        XCTAssertEqual(fullName?["familyName"], "Nitzsche")

        // 2. Response decoded · the call returned what /api/auth/apple sends.
        XCTAssertTrue(resp.ok)
        XCTAssertEqual(resp.token, "tok_abc123")
        XCTAssertEqual(resp.user_uuid, "0645f40c-aaaa-bbbb-cccc-26c79500abcd")

        // 3. TokenStore.shared persisted the session (mirroring what
        //    SignInWithAppleView does in its onCompletion handler).
        TokenStore.shared.set(token: resp.token,
                              expiresAt: resp.expires_at,
                              userUuid: resp.user_uuid)
        XCTAssertEqual(TokenStore.shared.token, "tok_abc123")
        XCTAssertEqual(TokenStore.shared.userUuid, "0645f40c-aaaa-bbbb-cccc-26c79500abcd")
        XCTAssertTrue(TokenStore.shared.isSignedIn)
    }

    // MARK: - Bearer attach on subsequent calls

    func test_subsequentRequest_includesAuthorizationBearer() async throws {
        // Pre-seed a session.
        TokenStore.shared.set(token: "tok_xyz789",
                              expiresAt: "2026-08-30T00:00:00Z",
                              userUuid: "0645f40c-aaaa-bbbb-cccc-26c79500abcd")

        Self.responder = { _ in
            // Any read-side endpoint will do · /api/log is harmless.
            let body: [String: Any] = ["weeks": []]
            let data = try! JSONSerialization.data(withJSONObject: body)
            let resp = HTTPURLResponse(url: URL(string: "https://www.faff.run/api/log")!,
                                       statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (resp, data)
        }

        _ = try? await API.fetchLog(limit: 10)

        // The stubbed request carries the Bearer header that TokenStore.authorize attached.
        let auth = Self.lastRequest?.value(forHTTPHeaderField: "Authorization")
        XCTAssertEqual(auth, "Bearer tok_xyz789",
                       "API helper must attach Authorization: Bearer on every authenticated read.")
    }

    // MARK: - 401 → .faffSessionExpired notification fires

    func test_401Response_postsSessionExpiredNotification() async throws {
        TokenStore.shared.set(token: "tok_stale", expiresAt: nil, userUuid: nil)

        Self.responder = { _ in
            let data = Data("{\"error\":\"Unauthorized\"}".utf8)
            let resp = HTTPURLResponse(url: URL(string: "https://www.faff.run/api/log")!,
                                       statusCode: 401, httpVersion: nil, headerFields: nil)!
            return (resp, data)
        }

        let notif = expectation(forNotification: .faffSessionExpired, object: nil)
        _ = try? await API.fetchLog(limit: 10)
        await fulfillment(of: [notif], timeout: 1.0)
    }

    // MARK: - TokenStore Keychain round-trip

    func test_tokenStore_keychainPersists() throws {
        TokenStore.shared.clear()
        TokenStore.shared.set(token: "tok_keychain",
                              expiresAt: "2026-08-30T00:00:00Z",
                              userUuid: "uuid-keychain-row")

        // Re-read via the nonisolated authorize() path that the API uses ·
        // proves the keychain write landed and is visible from any actor.
        var req = URLRequest(url: URL(string: "https://www.faff.run/api/log")!)
        TokenStore.shared.authorize(&req)
        XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer tok_keychain")
    }
}

// MARK: - URLProtocol stub
//
// Captures every request that flows through URLSession.shared, parses the
// JSON body (if any), and hands control to the test's `responder` closure.
// Test failure paths log a clear "no responder configured" so a missing
// stub doesn't masquerade as a hang.

final class TestStubProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        // Cache the request + parsed body so the assertions can read them.
        SignInFlowTests.lastRequest = request
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
            SignInFlowTests.lastBody = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        } else if let body = request.httpBody {
            SignInFlowTests.lastBody = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
        }

        guard let responder = SignInFlowTests.responder else {
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
