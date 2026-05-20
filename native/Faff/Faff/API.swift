//
//  API.swift
//  Faff
//
//  Networking layer for the Faff.run backend.  Talks to the tier-1
//  stable public endpoints (see /docs/api/tier-1-stable-public.md in
//  the repo) using Bearer-token auth.
//
//  Single-file v0 · keeps it simple.  Generic request helper handles
//  auth header injection + JSON decode.  Specific calls (login,
//  fetchToday, ingestSamples, etc.) wrap the generic helper with
//  their request/response types.
//
//  Created on 2026-05-19 · Phase 2 iPhone bridge work.
//

import Foundation

// MARK: - Configuration

enum API {
    /// Backend base URL.  Defaults to production (faff.run) in
    /// release builds; falls back to localhost in DEBUG builds so
    /// the iPhone simulator hits the Mac's `npm run dev` server.
    ///
    /// To override either default for one-off testing, set the
    /// FAFF_API_BASE_URL environment variable on the Xcode scheme
    /// (Product → Scheme → Edit Scheme → Run → Arguments → Environment
    /// Variables).  Useful for pointing at a staging deploy or your
    /// Mac's LAN IP if testing from a physical iPhone on the same Wi-Fi.
    static let baseURL: URL = {
        if let override = ProcessInfo.processInfo.environment["FAFF_API_BASE_URL"],
           let url = URL(string: override) {
            return url
        }
        #if DEBUG
        return URL(string: "http://localhost:3000")!
        #else
        // Canonical API host. The apex faff.run 301-redirects to www, and
        // redirects can mangle POST bodies (login), so target www directly.
        return URL(string: "https://www.faff.run")!
        #endif
    }()
}

// MARK: - Error types

enum APIError: Error, LocalizedError {
    case invalidURL
    case noData
    case unauthorized
    case http(status: Int, body: String?)
    case decoding(String)
    case network(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL:               return "Internal error: bad URL"
        case .noData:                   return "No data returned"
        case .unauthorized:             return "Session expired — sign in again"
        case .http(let status, let b):  return "HTTP \(status)\(b.map { ": \($0)" } ?? "")"
        case .decoding(let msg):        return "Could not parse response: \(msg)"
        case .network(let err):         return err.localizedDescription
        }
    }
}

// MARK: - Response types · matching the backend's JSON shapes

struct LoginResponse: Decodable {
    let accessToken: String
    let refreshToken: String
    let expiresIn: Int
    let user: AuthUser
}

struct AuthUser: Decodable {
    let id: String
    let email: String
    let name: String
    let isAdmin: Bool
}

struct WatchWorkout: Decodable {
    let workoutId: String?
    let name: String?
    let summary: String?
    let totalEstimatedMinutes: Int?
    let phases: [WatchPhase]?
    let completionEndpoint: String?
    let expiresAt: String?

    /// Set when there's no workout today (rest day, no plan window, etc.).
    let reason: String?
    let message: String?
}

struct WatchPhase: Decodable {
    let type: String   // 'warmup' | 'work' | 'recovery' | 'cooldown'
    let label: String
    let durationSec: Int
    let targetPaceSPerMi: Int?
    let tolerancePaceSPerMi: Int?
    let haptic: String
}

// MARK: - The client

@MainActor
final class FaffAPI {
    static let shared = FaffAPI()
    private init() {}

    // MARK: Auth

    func login(email: String, password: String) async throws -> LoginResponse {
        struct Body: Encodable { let email: String; let password: String }
        let response: LoginResponse = try await request(
            method: "POST",
            path: "/api/auth/token",
            body: Body(email: email, password: password),
            authenticated: false
        )
        TokenStore.shared.accessToken = response.accessToken
        TokenStore.shared.refreshToken = response.refreshToken
        return response
    }

    func logout() async {
        guard let refresh = TokenStore.shared.refreshToken else {
            TokenStore.shared.clear()
            return
        }
        struct Body: Encodable { let refreshToken: String }
        // Fire-and-forget · don't block UI on network success.  Explicit
        // result type so the generic T resolves to EmptyResponse.
        let _: EmptyResponse? = try? await request(
            method: "POST",
            path: "/api/auth/token/revoke",
            body: Body(refreshToken: refresh),
            authenticated: false
        )
        TokenStore.shared.clear()
    }

    // MARK: Watch

    func fetchToday() async throws -> WatchWorkout {
        try await request(method: "GET", path: "/api/watch/today")
    }

    /// Raw GET /api/watch/today body, forwarded verbatim to the watch via
    /// WatchConnectivity so the watch decodes the exact backend shape (no
    /// cross-target re-encode mismatch).
    func fetchTodayRaw() async throws -> Data {
        guard let url = URL(string: "/api/watch/today", relativeTo: API.baseURL) else {
            throw APIError.invalidURL
        }
        var req = URLRequest(url: url)
        if let token = TokenStore.shared.accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch {
            throw APIError.network(error)
        }
        guard let http = response as? HTTPURLResponse else {
            throw APIError.http(status: 0, body: nil)
        }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(status: http.statusCode, body: String(data: data, encoding: .utf8))
        }
        return data
    }

    /// POST a completed-workout payload (already-encoded JSON the watch
    /// produced) to the backend completion endpoint.
    func postWatchCompletion(_ jsonBody: Data) async throws {
        let _: EmptyResponse = try await perform(
            method: "POST",
            path: "/api/watch/workouts/complete",
            body: jsonBody,
            authenticated: true,
            as: EmptyResponse.self
        )
    }

    // MARK: HealthKit ingest

    /// Batch-upload HealthKit samples to POST /api/health/ingest. Bearer
    /// auth; the backend UPSERTs by (type, dateISO) so re-sends are safe.
    /// Returns the per-type ingest counts.
    @discardableResult
    func ingestHealthSamples(_ samples: [HealthSample]) async throws -> IngestResult {
        struct Body: Encodable { let samples: [HealthSample] }
        return try await request(
            method: "POST",
            path: "/api/health/ingest",
            body: Body(samples: samples),
            authenticated: true
        )
    }

    // MARK: Daily check-in

    /// Today's check-in if one is logged, else nil. Bearer auth.
    func getCheckin() async throws -> Checkin? {
        let r: CheckinGetResponse = try await request(method: "GET", path: "/api/checkin", authenticated: true)
        return r.checkin
    }

    /// Log/overwrite today's check-in (1–10 each). Returns the saved row.
    @discardableResult
    func postCheckin(energy: Int, soreness: Int, stress: Int) async throws -> Checkin? {
        struct Body: Encodable { let energy: Int; let soreness: Int; let stress: Int }
        let r: CheckinPostResponse = try await request(
            method: "POST", path: "/api/checkin",
            body: Body(energy: energy, soreness: soreness, stress: stress),
            authenticated: true
        )
        return r.checkin
    }

    // MARK: Generic helpers

    private func request<Body: Encodable, T: Decodable>(
        method: String,
        path: String,
        body: Body,
        authenticated: Bool = true
    ) async throws -> T {
        let encoded = try JSONEncoder().encode(body)
        return try await perform(
            method: method,
            path: path,
            body: encoded,
            authenticated: authenticated,
            as: T.self
        )
    }

    private func request<T: Decodable>(
        method: String,
        path: String,
        authenticated: Bool = true
    ) async throws -> T {
        try await perform(
            method: method,
            path: path,
            body: nil,
            authenticated: authenticated,
            as: T.self
        )
    }

    private func perform<T: Decodable>(
        method: String,
        path: String,
        body: Data?,
        authenticated: Bool,
        as: T.Type
    ) async throws -> T {
        guard let url = URL(string: path, relativeTo: API.baseURL) else {
            throw APIError.invalidURL
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.httpBody = body
        if body != nil {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if authenticated, let token = TokenStore.shared.accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch {
            throw APIError.network(error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.http(status: 0, body: nil)
        }

        if http.statusCode == 401 {
            throw APIError.unauthorized
        }
        guard (200..<300).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8)
            throw APIError.http(status: http.statusCode, body: body)
        }

        if T.self == EmptyResponse.self {
            return EmptyResponse() as! T
        }

        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decoding(error.localizedDescription)
        }
    }
}

// MARK: - Helper types

struct EmptyResponse: Decodable {}

/// One HealthKit reading in the backend's ingest shape. `type` must be one
/// of the server's accepted strings (resting_hr, max_hr, vo2_max,
/// sleep_hours, workout_hr_avg). `dateISO` is "yyyy-MM-dd".
struct HealthSample: Codable {
    let type: String
    let value: Double
    let dateISO: String
    let source: String
}

/// POST /api/health/ingest response.
struct IngestResult: Decodable {
    let ok: Bool
    let ingested: Int
    let skipped: Int
}

/// A logged daily check-in (1–10 scales). Decoded as Double so numeric
/// JSON (int or float) is tolerated.
struct Checkin: Decodable {
    let energy: Double
    let soreness: Double
    let stress: Double
    let notes: String?
}
struct CheckinGetResponse: Decodable { let ok: Bool; let today: String?; let checkin: Checkin? }
struct CheckinPostResponse: Decodable { let ok: Bool; let checkin: Checkin? }
