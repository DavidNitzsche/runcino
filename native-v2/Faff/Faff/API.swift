//
//  API.swift
//  Networking client. Points at the web-v2 staging URL until cutover.
//

import Foundation

enum API {
    /// Production API base. next.faff.run was the pre-cutover staging
    /// subdomain — it's no longer routed, which caused build 65/66 to
    /// land on a 404 HTML page in TestFlight. www.faff.run is the live
    /// app and verified to return JSON on /api/briefing.
    static var baseURL: URL = URL(string: "https://www.faff.run")!

    enum APIError: Error {
        case invalidURL
        case badStatus(Int)
        case noData
    }

    static func briefing(surface: String, mode: String? = nil) async throws -> Briefing {
        var comps = URLComponents(url: baseURL.appendingPathComponent("api/briefing"), resolvingAgainstBaseURL: false)!
        var items = [URLQueryItem(name: "surface", value: surface)]
        if let mode { items.append(URLQueryItem(name: "mode", value: mode)) }
        comps.queryItems = items

        let (data, resp) = try await URLSession.shared.data(from: comps.url!)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.badStatus((resp as? HTTPURLResponse)?.statusCode ?? -1)
        }
        return try JSONDecoder().decode(Briefing.self, from: data)
    }

    /// Closed loop §8.1 — record SOLID / TIRED / WRECKED check-in.
    static func checkin(rating: String, briefingId: String?) async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/checkin"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "rating": rating,
            "briefing_id": briefingId ?? NSNull(),
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await URLSession.shared.data(for: req)
    }

    /// Closed loop §8.6 — submit a profile gap input (height, weight, etc.).
    static func updateProfile(_ patch: [String: Any]) async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/profile"))
        req.httpMethod = "PATCH"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: patch)
        _ = try await URLSession.shared.data(for: req)
    }

    /// Fetch today's WatchWorkout shape as raw Data so we can forward it
    /// unchanged to the watch via applicationContext (preserves field shape
    /// exactly — the watch decodes from Data into its own WatchWorkout).
    static func fetchWatchTodayRaw() async throws -> Data {
        let url = baseURL.appendingPathComponent("api/watch/today")
        let (data, resp) = try await URLSession.shared.data(from: url)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.badStatus((resp as? HTTPURLResponse)?.statusCode ?? -1)
        }
        return data
    }
}
