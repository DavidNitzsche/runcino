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
        // client=ios → server returns paraphrased / shorter voice + fewer
        // topic cards. The phone has the structured workout card + week
        // strip leading the screen; the prose only needs to add color.
        var items = [
            URLQueryItem(name: "surface", value: surface),
            URLQueryItem(name: "client", value: "ios"),
        ]
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

    // MARK: - P29 settings + profile fetch

    static func fetchSettings() async throws -> UserSettings? {
        let url = baseURL.appendingPathComponent("api/settings")
        let (data, resp) = try await URLSession.shared.data(from: url)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(UserSettings.self, from: data)
    }

    static func patchSettings(_ patch: [String: Any]) async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/settings"))
        req.httpMethod = "PATCH"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: patch)
        let (_, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.badStatus((resp as? HTTPURLResponse)?.statusCode ?? -1)
        }
    }

    static func fetchProfile() async throws -> ProfileFields? {
        let url = baseURL.appendingPathComponent("api/profile")
        let (data, resp) = try await URLSession.shared.data(from: url)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(ProfileFields.self, from: data)
    }

    // MARK: - P29 manual run + race retro

    static func submitManualRun(_ body: [String: Any]) async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/run/manual"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (_, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.badStatus((resp as? HTTPURLResponse)?.statusCode ?? -1)
        }
    }

    static func submitRaceRetro(slug: String, body: [String: Any]) async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/race"))
        req.httpMethod = "PATCH"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var payload = body
        payload["slug"] = slug
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (_, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.badStatus((resp as? HTTPURLResponse)?.statusCode ?? -1)
        }
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

    /// Same as fetchWatchTodayRaw but decoded into WatchWorkout so the
    /// iPhone can render the structured workout card. Optional `date`
    /// override lets the WorkoutDetailModal preview any day's tile.
    /// Returns nil on the rest/no-workout branch.
    static func fetchWatchWorkout(date: String? = nil) async throws -> WatchWorkout? {
        var comps = URLComponents(
            url: baseURL.appendingPathComponent("api/watch/today"),
            resolvingAgainstBaseURL: false
        )!
        if let date { comps.queryItems = [URLQueryItem(name: "date", value: date)] }
        let (data, resp) = try await URLSession.shared.data(from: comps.url!)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.badStatus((resp as? HTTPURLResponse)?.statusCode ?? -1)
        }
        struct Wrapper: Decodable { let workout: WatchWorkout? }
        let w = try JSONDecoder().decode(Wrapper.self, from: data)
        return w.workout
    }

    /// Run log (P28). Returns weeks of runs for iPhone /log tab.
    static func fetchLog(limit: Int = 60) async throws -> LogState? {
        var comps = URLComponents(
            url: baseURL.appendingPathComponent("api/log"),
            resolvingAgainstBaseURL: false
        )!
        comps.queryItems = [URLQueryItem(name: "limit", value: "\(limit)")]
        let (data, resp) = try await URLSession.shared.data(from: comps.url!)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(LogState.self, from: data)
    }

    /// Single run detail (P28). Powers RunDetailSheet.
    static func fetchRunDetail(id: String) async throws -> RunDetail? {
        let url = baseURL.appendingPathComponent("api/runs/\(id)")
        let (data, resp) = try await URLSession.shared.data(from: url)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(RunDetail.self, from: data)
    }

    /// Real readiness score (P27.2). Replaces the hardcoded "88" placeholder
    /// that lived in TodayView. Returns nil when the server can't compute
    /// one (no health data yet) — UI degrades to a "?" instead of lying.
    static func fetchReadiness() async throws -> ReadinessSnapshot? {
        let url = baseURL.appendingPathComponent("api/readiness")
        let (data, resp) = try await URLSession.shared.data(from: url)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            return nil
        }
        return try? JSONDecoder().decode(ReadinessSnapshot.self, from: data)
    }

    /// Mon-Sun plan_workouts for the week containing `date` (or today).
    /// Drives the iPhone WeekStrip.
    static func fetchPlanWeek(date: String? = nil) async throws -> PlanWeek {
        var comps = URLComponents(
            url: baseURL.appendingPathComponent("api/plan/week"),
            resolvingAgainstBaseURL: false
        )!
        if let date { comps.queryItems = [URLQueryItem(name: "date", value: date)] }
        let (data, resp) = try await URLSession.shared.data(from: comps.url!)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.badStatus((resp as? HTTPURLResponse)?.statusCode ?? -1)
        }
        return try JSONDecoder().decode(PlanWeek.self, from: data)
    }
}

// MARK: - PlanWeek wire model
//
// Mirrors GET /api/plan/week response. PlanWeek.days[i] is one day in the
// Mon-Sun strip; today's row carries is_today=true so the week strip can
// highlight it without re-computing.
struct PlanWeek: Decodable {
    let plan_id: String?
    let week_start_iso: String?
    let week_end_iso: String?
    let today_iso: String
    let days: [PlanDay]
    let message: String?
}

struct PlanDay: Decodable, Identifiable {
    var id: String { date_iso }
    let date_iso: String
    let dow: Int
    let type: String
    let distance_mi: Double
    let sub_label: String?
    let is_today: Bool
    let is_past: Bool
}

// MARK: - Readiness (P27.2)
//
// /api/readiness returns null score when there's not enough data yet
// (e.g. fresh install before HK has synced). UI must degrade gracefully —
// don't lie with a placeholder number.
struct ReadinessSnapshot: Decodable {
    let score: Int?
    let band: String?
    let label: String?
    // inputs intentionally omitted on the iPhone for now — used by the
    // /health readiness modal on web. iPhone shows just the ring + label.
}

// MARK: - P29 Settings + Profile

struct UserSettings: Decodable {
    let units_distance: String?
    let units_temp: String?
    let units_pace: String?
    let long_run_day: String?
    let rest_day: String?
    let quality_days: [String]?
    let briefing_time: String?
    let push_enabled: Bool?
}

/// Subset of profile fields the iPhone settings sheet edits. The server
/// /api/profile returns more — we only decode what we use.
struct ProfileFields: Decodable {
    let lthr: Int?
    let maxhr: Int?
    let hrmax_observed: Int?
    let rhr: Int?
    let height_cm: Double?
    let gender: String?
    let experience_level: String?
    let birthday: String?
}
