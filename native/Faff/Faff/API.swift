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
    /// Backend base URL.  Production: https://faff.run.  Override
    /// to http://localhost:3000 (or your Mac's LAN IP) during local
    /// dev against `cd web && npm run dev`.
    static let baseURL = URL(string: "https://faff.run")!
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
        // Fire-and-forget · don't block UI on network success
        _ = try? await request(
            method: "POST",
            path: "/api/auth/token/revoke",
            body: Body(refreshToken: refresh),
            authenticated: false,
            decode: EmptyResponse.self
        )
        TokenStore.shared.clear()
    }

    // MARK: Watch

    func fetchToday() async throws -> WatchWorkout {
        try await request(method: "GET", path: "/api/watch/today")
    }

    // MARK: Generic helpers

    private func request<Body: Encodable, T: Decodable>(
        method: String,
        path: String,
        body: Body,
        authenticated: Bool = true
    ) async throws -> T {
        try await request(
            method: method,
            path: path,
            body: try JSONEncoder().encode(body),
            authenticated: authenticated,
            decode: T.self
        )
    }

    private func request<T: Decodable>(
        method: String,
        path: String,
        authenticated: Bool = true
    ) async throws -> T {
        try await request(
            method: method,
            path: path,
            body: nil,
            authenticated: authenticated,
            decode: T.self
        )
    }

    private func request<T: Decodable>(
        method: String,
        path: String,
        body: Data?,
        authenticated: Bool,
        decode: T.Type
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
