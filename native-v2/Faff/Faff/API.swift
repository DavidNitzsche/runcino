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

    // MARK: - P39 auth — Sign in with Apple

    struct AppleSignInResponse: Decodable {
        let ok: Bool
        let token: String?
        let expires_at: String?
        let user_uuid: String?
        let error: String?
    }

    /// POST /api/auth/apple with the identity_token + user from
    /// ASAuthorizationAppleIDProvider. Returns the server's opaque session
    /// token that the client persists in keychain and sends as Bearer.
    static func signInWithApple(
        identityToken: String,
        appleUserId: String,
        email: String?,
        fullName: PersonNameComponents?
    ) async throws -> AppleSignInResponse {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/auth/apple"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = [
            "identity_token": identityToken,
            "user": appleUserId,
        ]
        if let email { body["email"] = email }
        if let name = fullName {
            var nm: [String: String] = [:]
            if let g = name.givenName { nm["givenName"] = g }
            if let f = name.familyName { nm["familyName"] = f }
            if !nm.isEmpty { body["full_name"] = nm }
        }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, _) = try await URLSession.shared.data(for: req)
        return try JSONDecoder().decode(AppleSignInResponse.self, from: data)
    }

    // MARK: - P39 Strava OAuth

    struct StravaConnectURLResponse: Decodable {
        let url: String
    }

    /// Get the URL to open in Safari for Strava OAuth. The callback lands
    /// on /api/auth/strava?action=callback which writes the tokens.
    static func fetchStravaConnectURL() async throws -> URL? {
        var comps = URLComponents(
            url: baseURL.appendingPathComponent("api/auth/strava"),
            resolvingAgainstBaseURL: false
        )!
        comps.queryItems = [URLQueryItem(name: "action", value: "connect")]
        let (data, _) = try await URLSession.shared.data(from: comps.url!)
        let r = try? JSONDecoder().decode(StravaConnectURLResponse.self, from: data)
        guard let urlStr = r?.url else { return nil }
        return URL(string: urlStr)
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

    // MARK: - P40 race detail

    static func fetchRaceDetail(slug: String) async throws -> RaceDetailResponse? {
        let url = baseURL.appendingPathComponent("api/race/\(slug)")
        let (data, resp) = try await URLSession.shared.data(from: url)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(RaceDetailResponse.self, from: data)
    }

    // MARK: - P32 shoe assignment

    static func fetchShoes() async throws -> ShoesResponse? {
        let url = baseURL.appendingPathComponent("api/shoe")
        let (data, resp) = try await URLSession.shared.data(from: url)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(ShoesResponse.self, from: data)
    }

    static func assignShoeToRun(runId: String, shoeId: Int?) async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/runs/\(runId)"))
        req.httpMethod = "PATCH"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = ["shoe_id": shoeId as Any]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (_, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.badStatus((resp as? HTTPURLResponse)?.statusCode ?? -1)
        }
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

    /// Full /profile state — identity + physiology + connections — shaped
    /// identically to web's ProfileState. Replaces hardcoded values in
    /// ProfileView. See web-v2/app/api/profile/state/route.ts.
    static func fetchProfileState() async throws -> ProfileState? {
        let url = baseURL.appendingPathComponent("api/profile/state")
        let (data, resp) = try await URLSession.shared.data(from: url)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(ProfileState.self, from: data)
    }

    /// /api/races — race list for the iPhone /races tab. Same endpoint
    /// the web list reads. Sorted upcoming-first.
    static func fetchRaces() async throws -> RaceListResponse? {
        let url = baseURL.appendingPathComponent("api/races")
        let (data, resp) = try await URLSession.shared.data(from: url)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(RaceListResponse.self, from: data)
    }

    /// /api/training/state — full plan state for the /training tab.
    /// Powers the iPhone PhaseStrip / mileage arc / week-ahead detail,
    /// using the same data web /training reads.
    static func fetchTrainingState() async throws -> TrainingState? {
        let url = baseURL.appendingPathComponent("api/training/state")
        let (data, resp) = try await URLSession.shared.data(from: url)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(TrainingState.self, from: data)
    }

    /// /api/health/state — 30-day trends + summary + watch-mode for
    /// every health metric the iPhone /health tab renders.
    static func fetchHealthState() async throws -> HealthState? {
        let url = baseURL.appendingPathComponent("api/health/state")
        let (data, resp) = try await URLSession.shared.data(from: url)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(HealthState.self, from: data)
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
    let cross_training_modes: [String]?
    let strava_connected_at: String?
    let health_connected_at: String?
    let onboarded_at: String?
    let strava_auto_push: Bool?
    let phone_hr_alerts: Bool?
}

// MARK: - ProfileState (full /profile rendering)
//
// Mirrors web-v2/lib/coach/profile-state.ts → trimmed to identity +
// physiology + connections. Other slices (shoes, nextARace, prefs)
// have their own dedicated endpoints. Replaces the hardcoded "David
// Nitzsche / MALE · 40 · LOS ANGELES" + "181 bpm" string literals
// that lived in ProfileView.swift.

struct ProfileState: Decodable {
    let identity: ProfileIdentity
    let physiology: ProfilePhysiology
    let connections: ProfileConnections
}

struct ProfileIdentity: Decodable {
    let full_name: String?
    let sex: String?
    let birthday: String?
    let age: Int?
    let city: String?
    let height_cm: Double?
    let experience_level: String?
}

struct ProfilePhysiology: Decodable {
    let max_hr: Int?
    let max_hr_source: String?     // 'observed' / 'lthr-derived' / 'formula' / 'manual'
    let rhr: Int?
    let vo2: Double?
    let weight_lb: Double?
    let vdot: Double?
    let lthr: Int?
}

struct ProfileConnections: Decodable {
    let strava: ProfileConnectionState
    let appleHealth: ProfileConnectionState
    let appleWatch: ProfileConnectionState
}

struct ProfileConnectionState: Decodable {
    let connected: Bool
    let lastSync: String?
    let note: String
}

// MARK: - TrainingState (iPhone /training)
//
// Mirrors web-v2/lib/coach/training-state.ts. Powers the multi-week
// plan arc, phase strip, and week-ahead detail. The TypeScript shape
// already includes a `PlanWeek` interface, distinct from our wire
// model in API.swift — we name ours `TrainingPlanWeek` here to avoid
// colliding with the simpler PlanWeek (Mon-Sun day strip) used by
// /api/plan/week + WeekStripView.

struct TrainingState: Decodable {
    let plan_id: String?
    let today: String
    let race: TrainingRace?
    let phases: [TrainingPlanPhase]
    let weeks: [TrainingPlanWeek]
    let currentPhase: String?
    let currentWeekIdx: Int?
    let nextQuality: TrainingNextQuality?
    let weekDone: Double
    let weekPlanned: Double?
}

struct TrainingRace: Decodable {
    let slug: String
    let name: String
    let date: String
    let goal: String?
    let days_to_race: Int
}

struct TrainingPlanPhase: Decodable, Identifiable {
    let label: String
    let startWeekIdx: Int
    let endWeekIdx: Int
    /// Use the label + start/end index as the stable id so SwiftUI's
    /// ForEach doesn't redraw the strip when the row order is stable.
    var id: String { "\(label)|\(startWeekIdx)-\(endWeekIdx)" }
}

struct TrainingPlanWeek: Decodable, Identifiable {
    let idx: Int
    let phase: String
    let startDate: String
    let plannedMi: Double
    let days: [TrainingPlanDay]
    let isCurrent: Bool
    var id: Int { idx }
}

struct TrainingPlanDay: Decodable, Identifiable {
    let date: String
    let dow: Int
    let type: String
    let mi: Double
    let label: String?
    let doneMi: Double
    let activityId: String?
    var id: String { date }
}

struct TrainingNextQuality: Decodable {
    let date: String
    let dow: Int
    let type: String
    let label: String?
    let mi: Double
}

// MARK: - HealthState (iPhone /health)
//
// Mirrors web-v2/lib/coach/health-state.ts. 30-day daily series for
// each metric so the iPhone can draw a sparkline next to the current
// value + delta, plus a summary block.

struct HealthState: Decodable {
    let today: String
    let sleepSeries: [HealthDayHours]
    let rhrSeries: [HealthDayBpm]
    let hrvSeries: [HealthDayMs]
    let weightSeries: [HealthDayLb]
    let sleep: SleepSummary
    let rhr: RhrSummary
    let hrv: HrvSummary
    let weight: WeightSummary
    let cadence: CadenceSummary
    let vo2: Vo2Summary
    let watchMode: String              // 'steady' / 'watch-amber' / 'watch-red' / 'green'
    let watchItems: [WatchItem]
}

struct HealthDayHours: Decodable { let date: String; let hours: Double }
struct HealthDayBpm:   Decodable { let date: String; let bpm: Int }
struct HealthDayMs:    Decodable { let date: String; let ms: Int }
struct HealthDayLb:    Decodable { let date: String; let lb: Double }

struct SleepSummary:   Decodable { let avg7n: Double?; let avg30n: Double?; let deficit7: Double }
struct RhrSummary:     Decodable { let current: Int?; let baseline: Int?; let delta: Int? }
struct HrvSummary:     Decodable { let current: Int?; let baseline: Int?; let pctAboveBaseline: Double? }
struct WeightSummary:  Decodable { let current: Double?; let delta30: Double? }
struct CadenceSummary: Decodable { let baseline: Int? }
struct Vo2Summary:     Decodable { let current: Double? }

struct WatchItem: Decodable, Identifiable {
    let label: String
    let status: String      // 'amber' / 'red'
    let note: String
    var id: String { label + status }
}

// MARK: - Race list (iPhone /races)
//
// Mirrors GET /api/races. The web /races page also shows this list
// under the brief; the iPhone was previously missing it.

struct RaceListResponse: Decodable {
    let races: [RaceListItem]
}

struct RaceListItem: Decodable, Identifiable {
    let slug: String
    let name: String?
    let date: String?              // ISO yyyy-mm-dd
    let priority: String?          // "A" / "B" / "C"
    let distance_label: String?
    let location: String?
    let days_to_race: Int?
    /// Slug doubles as the stable identity for SwiftUI ForEach.
    var id: String { slug }
}
