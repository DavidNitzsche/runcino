//
//  OverviewModels.swift
//  Faff
//
//  Decodes the slice of GET /api/overview the iPhone Today screen needs.
//  The endpoint returns the legacy `me` data without auth, so the
//  companion can read real data without a login.
//
//  Only the fields the UI consumes are modeled; JSONDecoder ignores the
//  rest of the (large) envelope. Verified shapes against the live route
//  on 2026-05-19 — no invented fields.
//

import Foundation
import SwiftUI

struct OverviewResponse: Decodable {
    let ok: Bool
    let today: String?
    let planCurrentPhase: String?
    let profileName: String?
    let workout: CoachAnswer<OWorkout>?
    let readiness: CoachAnswer<OReadiness>?
    let briefing: CoachAnswer<OBriefing>?
    let planWeekWorkouts: [OPlanDay]?
    let state: OState?
    /// Day-aware coach line, identical to the /overview web page
    /// (server-composed via generateBriefing). Preferred over the
    /// client-composed fallback.
    let coachLine: String?
    /// Actual miles logged per day this week (dateISO → mi). Drives
    /// honest "done" markers. Empty/absent for anonymous reads.
    let completedByDate: [String: Double]?
    /// Dates the runner deliberately SKIPPED this week — distinct from a
    /// missed/unlogged day so the strip + heroes can mark them differently.
    let skippedDates: [String]?
    /// Recent coach plan adaptations (last 7d), grouped by reason — drives the
    /// dismissible "Coach updated your plan" card. `adaptationsLatestTs` lets
    /// the card show only when there's something newer than last dismissed.
    let coachAdaptations: [OCoachAdaptation]?
    let adaptationsLatestTs: String?
    /// Active connector providers (e.g. ["strava"]). Real integration
    /// status for the More tab. Empty/absent for anonymous reads.
    let connectors: [String]?
    /// Daily readiness score (0–100) + state; nil when suppressed/anon
    /// (ring renders dashed "No data" then). Surface-only.
    let readinessScore: Int?
    let readinessState: String?   // "green" | "yellow" | "red"
    let readinessRecommendation: String?  // verbatim coach copy (web parity)
    /// Next weeks' long-run distances (Plan "Coming up").
    let planFutureLongRuns: [OFutureLong]?
    /// A-race fitness projection (Race detail). nil when no A-race goal.
    let raceProjection: ORaceProjection?
}

struct ORaceProjection: Decodable {
    let projectedDisplay: String?
    let vdot: Double?
    let goalPaceSPerMi: Double?
    let predictedPaceSPerMi: Double?
    let headroomSPerMi: Double?
    let confidence: String?
}

struct OFutureLong: Decodable, Identifiable {
    let weekStartISO: String?
    let longMi: Double?
    var id: String { weekStartISO ?? UUID().uuidString }
}

struct OState: Decodable {
    let races: ORaces?
    let recovery: ORecovery?
    let volume: OVolume?
    let flags: OFlags?
}
struct ORaces: Decodable {
    let nextA: ORace?
    let recent: [ORecentRace]?
}
struct ORace: Decodable {
    let slug: String?
    let name: String?
    let date: String?
    let distanceMi: Double?
    let goalDisplay: String?
    let daysAway: Int?
}
struct ORecentRace: Decodable {
    let name: String?
    let date: String?
    let distanceMi: Double?
    let finishS: Double?
}
struct ORecovery: Decodable {
    let hrv7dAvgMs: Double?
    let rhrBpm: Double?
    let sleep7dAvgHrs: Double?
    let daysSinceLastRun: Int?
}
struct OVolume: Decodable {
    let last7Mi: Double?
    let last28Mi: Double?
    let weeklyAvg8w: Double?
}
struct OFlags: Decodable { let healthKitAvailable: Bool? }

/// CoachDecision<T> envelope — we only read `answer`.
struct CoachAnswer<T: Decodable>: Decodable { let answer: T }

struct OWorkout: Decodable {
    let label: String?
    let type: String?
    let distanceMi: Double?
    let paceTargetSPerMi: Double?
    let isQuality: Bool?
    let isLong: Bool?
    let hrZone: Int?                 // e.g. 2  (NOT a string)
    let phaseLabel: String?          // e.g. "Post-race recovery"
    let coachToday: OCoachToday?     // structured object
    let voiceLead: String?           // prose — used for the detail "why"
}

struct OCoachToday: Decodable {
    let modeDetail: String?
    let today: OCoachTodayInner?
}
struct OCoachTodayInner: Decodable {
    let description: String?
}

struct OReadiness: Decodable {
    let level: String?      // "green" | "yellow" | "red"
    let message: String?
    let acwr: Double?
    let easyShare: Double?
}

struct OBriefing: Decodable {
    let text: String?
    let label: String?
    let clauses: [OClause]?
}
struct OClause: Decodable { let kind: String?; let text: String? }

struct OPlanDay: Decodable {
    let dateISO: String?
    let dow: Int?
    let type: String?
    let distanceMi: Double?
    let paceTargetSPerMi: Double?
    let durationMin: Double?
    let isQuality: Bool?
    let isLong: Bool?
    let hasStrength: Bool?
    let notes: String?
    let subLabel: String?
    /// describeWorkout key the backend resolved, e.g. "Threshold · Cruise
    /// Intervals" / "Easy". Present only on enriched (non-rest) days.
    let label: String?
    /// Server-computed structured workout (pace band + steps + effort +
    /// why), the SAME describeWorkout the web modal renders.
    let description: ODescription?
}

/// Mirrors lib/workout-descriptions.ts `WorkoutDescription`.
struct ODescription: Decodable {
    let zone: String?          // "Easy · Zone 2 + Strides"
    let paceTarget: String?    // "8:29–8:59/mi · strides at 1-mile race pace"
    let effort: String?
    let why: String?
    let steps: [OStep]?
}

/// One recipe step — either `simple` (name/duration/pace/zone) or `loop`
/// (name/times/items). Both kinds decode into this one struct; the
/// unused fields stay nil.
struct OStep: Decodable {
    let kind: String?          // "simple" | "loop"
    let name: String?
    // simple
    let duration: String?
    let pace: String?
    let zone: String?
    let hrTarget: String?
    // loop
    let times: Int?
    let items: [OLoopItem]?
}

struct OLoopItem: Decodable {
    let verb: String?
    let duration: String?
    let pace: String?
    let zone: String?
    let suffix: String?
    let hrTarget: String?
}

/// Structured described workout for a single plan day (GET /api/plan/workout).
struct PlanWorkoutDetail: Decodable {
    let label: String?
    let type: String?
    let distanceMi: Double?
    let description: ODescription?
}
private struct PlanWorkoutResponse: Decodable { let ok: Bool; let workout: PlanWorkoutDetail? }

@MainActor
enum WorkoutDayAPI {
    /// The real describeWorkout for `date` (steps + effort + why + zone), or
    /// nil for rest days / no plan. Bearer-aware so it resolves to the user.
    static func fetch(date: String) async throws -> PlanWorkoutDetail? {
        guard let url = URL(string: "/api/plan/workout?date=\(date)", relativeTo: API.baseURL) else { throw APIError.invalidURL }
        var req = URLRequest(url: url); req.timeoutInterval = 20
        if let token = TokenStore.shared.accessToken { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
        return try JSONDecoder().decode(PlanWorkoutResponse.self, from: data).workout
    }
}

/// One grouped coach adaptation (from /api/overview coachAdaptations).
struct OCoachAdaptation: Decodable, Identifiable {
    let reason: String
    let citation: String?
    let count: Int
    let days: [String]
    let ts: String
    var id: String { reason }
}

// MARK: - Full plan (GET /api/plan-range) — every week as built

struct PlanRangeResponse: Decodable {
    let ok: Bool
    let today: String?
    let days: [PlanRangeDay]?
}

struct OPaceBand: Decodable { let lowS: Double?; let highS: Double? }

struct PlanRangeDay: Decodable, Identifiable {
    let date: String?
    let type: String?            // RunWorkoutType ("general_aerobic","long_steady","threshold","rest"…)
    let label: String?
    let distanceMi: Double?
    let description: String?     // workout notes ("Easy run — conversational pace…")
    let paceTargetSPerMi: OPaceBand?
    let isQuality: Bool?
    let isLong: Bool?
    let isToday: Bool?
    let hasStrength: Bool?
    /// Miles actually logged that day (from the real activity), or nil.
    let completedMi: Double?
    /// The runner deliberately skipped this day (distinct from "missed").
    let skipped: Bool?
    var id: String { date ?? UUID().uuidString }
    var isRest: Bool { (type ?? "rest") == "rest" || (distanceMi ?? 0) <= 0 }

    /// Completed = logged ≥ 60% of the planned distance.
    var isDone: Bool {
        guard let mi = distanceMi, mi > 0, let actual = completedMi else { return false }
        return actual >= mi * 0.6
    }
    /// Logged a run but under 60% of plan — "short", not done, not missed.
    var isShort: Bool {
        guard let mi = distanceMi, mi > 0, let actual = completedMi, actual > 0 else { return false }
        return actual < mi * 0.6
    }
    var isSkipped: Bool { skipped == true }

    /// "8:14–8:44" from the band, or single value, or "Easy" when no gate.
    var paceDisplay: String {
        guard let lo = paceTargetSPerMi?.lowS, lo > 0 else { return "Easy" }
        let hi = paceTargetSPerMi?.highS ?? lo
        func mmss(_ s: Double) -> String { let t = Int(s.rounded()); return "\(t/60):\(String(format: "%02d", t%60))" }
        return hi > lo ? "\(mmss(lo))–\(mmss(hi))" : mmss(lo)
    }
    /// Estimated minutes from distance × mid-pace.
    var durationMin: Int? {
        guard let d = distanceMi, d > 0, let lo = paceTargetSPerMi?.lowS, lo > 0 else { return nil }
        let mid = (lo + (paceTargetSPerMi?.highS ?? lo)) / 2
        return Int((d * mid / 60).rounded())
    }

    private enum CodingKeys: String, CodingKey {
        case date, type, label, distanceMi, description, paceTargetSPerMi, isQuality, isLong, isToday, hasStrength, completedMi, skipped
    }
}

@MainActor
enum PlanRangeAPI {
    static func fetch(months: Int = 6) async throws -> PlanRangeResponse {
        guard let url = URL(string: "/api/plan-range?months=\(months)", relativeTo: API.baseURL) else { throw APIError.invalidURL }
        var req = URLRequest(url: url); req.timeoutInterval = 35
        if let token = TokenStore.shared.accessToken { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await URLSession.shared.data(for: req) } catch { throw APIError.network(error) }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.http(status: (response as? HTTPURLResponse)?.statusCode ?? 0, body: nil)
        }
        return try JSONDecoder().decode(PlanRangeResponse.self, from: data)
    }
}

// MARK: - Races list (upcoming + recent, lightweight)

struct RaceSummary: Decodable, Identifiable {
    let slug: String?
    let name: String?
    let date: String?
    let distanceMi: Double?
    let goalDisplay: String?
    let priority: String?
    let daysAway: Int?
    let isPast: Bool?
    let finishS: Double?
    let finishDisplay: String?
    let paceDisplay: String?
    var id: String { slug ?? UUID().uuidString }
}
private struct RacesSummaryResponse: Decodable { let races: [RaceSummary]? }

@MainActor
enum RacesListAPI {
    static func fetch() async throws -> [RaceSummary] {
        guard let url = URL(string: "/api/races/summary", relativeTo: API.baseURL) else { throw APIError.invalidURL }
        var req = URLRequest(url: url); req.timeoutInterval = 30
        if let token = TokenStore.shared.accessToken { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await URLSession.shared.data(for: req) } catch { throw APIError.network(error) }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.http(status: (response as? HTTPURLResponse)?.statusCode ?? 0, body: nil)
        }
        return (try JSONDecoder().decode(RacesSummaryResponse.self, from: data)).races ?? []
    }
}

// MARK: - Race course (downsampled geometry + phase pacing)

/// Full course payload for the race-detail screen, served by
/// /api/races/[slug]/course (the heavy GPX is parsed server-side).
struct RaceCourse: Decodable {
    let ok: Bool
    let slug: String?
    let name: String?
    let date: String?
    let distanceMi: Double?
    let goalDisplay: String?
    let strategy: String?
    let stats: RaceCourseStats?
    let coords: [[Double]]?       // [[lat, lon], …] map polyline
    let samples: [RaceCourseSample]?
    let phases: [RacePhase]?
    let fueling: RaceFueling?
    let gels: [RaceGel]?
    let projection: RaceProjection?
    let brief: RaceBrief?
    let briefGeneratesISO: String?
}

/// Race-day execution brief. Generated at T−7d; null until then.
struct RaceBrief: Decodable {
    let narrative: String?
    let weatherInput: String?
    let generatedAt: String?
    let adjustments: [RaceBriefAdjustment]?
}

struct RaceBriefAdjustment: Decodable, Identifiable {
    let phaseIdx: Int?
    let paceDeltaSPerMi: Double?
    let reason: String?
    var id: Int { phaseIdx ?? 0 }
}

/// Race projection — same math as the /races/[slug] web page
/// (computeAggregateVdot) so iPhone and web agree for the same user.
struct RaceProjection: Decodable {
    let currentVdot: Double?
    let currentVdotLabel: String?
    let predictedDisplay: String?
    let goalDisplay: String?
    let goalVdot: Double?
    let vdotGap: Double?
    let paceTGapS: Double?
    let onPace: Bool?
}

struct RaceFueling: Decodable {
    let gelBrand: String?
    let gelCount: Int?
    let gelCarbsG: Int?
    let totalCarbsG: Int?
    let carbTargetGPerHr: Int?
    let notes: String?
}

struct RaceGel: Decodable, Identifiable {
    let number: Int?
    let atMi: Double?
    let item: String?
    let label: String?
    var id: Int { number ?? 0 }
}

struct RaceCourseStats: Decodable {
    let gainFt: Double?
    let lossFt: Double?
    let netFt: Double?
    let minFt: Double?
    let maxFt: Double?
    let distanceMi: Double?
}

/// One elevation-profile sample: distance (mi), elevation (ft), grade (%).
struct RaceCourseSample: Decodable, Identifiable {
    let d: Double
    let e: Double
    let g: Double
    var id: Double { d }
}

struct RacePhase: Decodable, Identifiable {
    let label: String?
    let startMi: Double?
    let endMi: Double?
    let distanceMi: Double?
    let targetPaceDisplay: String?
    let targetPaceSPerMi: Double?
    let cumulativeTimeDisplay: String?
    let meanGradePct: Double?
    let gainFt: Double?
    let lossFt: Double?
    let note: String?
    var id: String { "\(label ?? "")-\(startMi ?? 0)" }
}

@MainActor
enum RaceCourseAPI {
    static func fetch(slug: String) async throws -> RaceCourse {
        guard let url = URL(string: "/api/races/\(slug)/course", relativeTo: API.baseURL) else { throw APIError.invalidURL }
        var req = URLRequest(url: url); req.timeoutInterval = 35
        if let token = TokenStore.shared.accessToken { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await URLSession.shared.data(for: req) } catch { throw APIError.network(error) }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.http(status: (response as? HTTPURLResponse)?.statusCode ?? 0, body: nil)
        }
        return try JSONDecoder().decode(RaceCourse.self, from: data)
    }
}

// MARK: - Shoes (gear rotation + mileage)

struct ShoesResponse: Decodable { let shoes: [Shoe]? }

struct Shoe: Decodable, Identifiable {
    let id: Int
    let brand: String?
    let model: String?
    let color: String?
    let runTypes: [String]?
    let mileage: Double?
    let mileageCap: Double?
    let retired: Bool?
    let preferred: Bool?
    let notes: String?

    var name: String { [brand, model].compactMap { $0 }.joined(separator: " ") }
    var wearFraction: Double {
        guard let m = mileage, let cap = mileageCap, cap > 0 else { return 0 }
        return min(max(m / cap, 0), 1)
    }
    /// Mirrors the web shoeStatus(): ≥0.90 Retire soon (warn), ≥0.70
    /// Aging (amber), ≥0.20 Healthy (green), else Fresh (green).
    static func status(_ wear: Double) -> (String, Color) {
        if wear >= 0.90 { return ("Retire soon", Faff.C.warn) }
        if wear >= 0.70 { return ("Aging", Faff.C.milestone) }
        if wear >= 0.20 { return ("Healthy", Faff.C.recovery) }
        return ("Fresh", Faff.C.recovery)
    }
    private enum CodingKeys: String, CodingKey {
        case id, brand, model, color, mileage, retired, preferred, notes
        case runTypes = "run_types"
        case mileageCap = "mileage_cap"
    }
}

@MainActor
enum ShoesAPI {
    static func fetch() async throws -> [Shoe] {
        guard let url = URL(string: "/api/shoes", relativeTo: API.baseURL) else { throw APIError.invalidURL }
        var req = URLRequest(url: url); req.timeoutInterval = 30
        if let token = TokenStore.shared.accessToken { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await URLSession.shared.data(for: req) } catch { throw APIError.network(error) }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.http(status: (response as? HTTPURLResponse)?.statusCode ?? 0, body: nil)
        }
        return (try JSONDecoder().decode(ShoesResponse.self, from: data)).shoes ?? []
    }
    /// Create a shoe: POST /api/shoes (brand, model, run_types required).
    @discardableResult
    static func create(_ fields: [String: Any]) async throws -> Bool {
        try await send(method: "POST", path: "/api/shoes", body: fields)
    }
    /// Edit a shoe: PUT /api/shoes/[id] (any subset of fields).
    @discardableResult
    static func update(id: Int, _ fields: [String: Any]) async throws -> Bool {
        try await send(method: "PUT", path: "/api/shoes/\(id)", body: fields)
    }
    private static func send(method: String, path: String, body: [String: Any]) async throws -> Bool {
        guard let url = URL(string: path, relativeTo: API.baseURL) else { throw APIError.invalidURL }
        var req = URLRequest(url: url); req.httpMethod = method; req.timeoutInterval = 30
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = TokenStore.shared.accessToken { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await URLSession.shared.data(for: req) } catch { throw APIError.network(error) }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.http(status: (response as? HTTPURLResponse)?.statusCode ?? 0, body: String(data: data, encoding: .utf8))
        }
        return true
    }
}

// MARK: - Health daily series (metric-detail trend)

struct HealthSeriesPoint: Decodable, Identifiable {
    let date: String
    let value: Double
    var id: String { date }
}
private struct HealthSeriesResponse: Decodable { let series: [HealthSeriesPoint]? }

@MainActor
enum HealthSeriesAPI {
    static func fetch(type: String, days: Int) async throws -> [HealthSeriesPoint] {
        guard let url = URL(string: "/api/health/series?type=\(type)&days=\(days)", relativeTo: API.baseURL) else { throw APIError.invalidURL }
        var req = URLRequest(url: url); req.timeoutInterval = 30
        if let token = TokenStore.shared.accessToken { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await URLSession.shared.data(for: req) } catch { throw APIError.network(error) }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.http(status: (response as? HTTPURLResponse)?.statusCode ?? 0, body: nil)
        }
        return (try JSONDecoder().decode(HealthSeriesResponse.self, from: data)).series ?? []
    }
}

// MARK: - Plan actions (skip / move / swap)

@MainActor
enum PlanActionAPI {
    @discardableResult
    static func skip(dateISO: String, type: String?, mi: Double?) async throws -> Bool {
        var body: [String: Any] = ["dateISO": dateISO]
        if let type { body["plannedWorkoutType"] = type }
        if let mi { body["plannedMi"] = mi }
        return try await post(path: "/api/plan/skip", body: body)
    }
    @discardableResult
    static func reschedule(action: String, from: String, to: String) async throws -> Bool {
        try await post(path: "/api/plan/reschedule", body: ["action": action, "fromDateISO": from, "toDateISO": to])
    }
    private static func post(path: String, body: [String: Any]) async throws -> Bool {
        guard let url = URL(string: path, relativeTo: API.baseURL) else { throw APIError.invalidURL }
        var req = URLRequest(url: url); req.httpMethod = "POST"; req.timeoutInterval = 30
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = TokenStore.shared.accessToken { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await URLSession.shared.data(for: req) } catch { throw APIError.network(error) }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.http(status: (response as? HTTPURLResponse)?.statusCode ?? 0, body: String(data: data, encoding: .utf8))
        }
        return true
    }
}

// MARK: - Run recap (a completed run synced from Strava/Apple Health)

struct RunByDateResponse: Decodable {
    let ok: Bool
    let maxHr: Double?
    let run: RunRecap?
}

struct RunRecap: Decodable {
    let id: String?
    let name: String?
    let description: String?
    let date: String?
    let distanceMi: Double?
    let movingTimeS: Double?
    let paceSPerMi: Double?
    let avgHr: Double?
    let maxHr: Double?
    let avgCadence: Double?
    let elevGainFt: Double?
    let type: String?
    let splits: [RunSplit]?
    let summaryPolyline: String?
    let startLatLng: [Double]?
    let endLatLng: [Double]?

    var durationDisplay: String {
        guard let s = movingTimeS, s > 0 else { return "—" }
        let t = Int(s); let h = t / 3600, m = (t % 3600) / 60, sec = t % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, sec) : String(format: "%d:%02d", m, sec)
    }
    var paceDisplay: String { OverviewFormat.pace(paceSPerMi) }
}

struct RunSplit: Decodable, Identifiable {
    let mile: Int
    let paceSPerMi: Double
    let paceDisplay: String?
    let avgHr: Double?
    let elevDeltaFt: Double?
    var id: Int { mile }
}

@MainActor
enum RunByDateAPI {
    static func fetch(date: String) async throws -> RunByDateResponse {
        guard let url = URL(string: "/api/runs/by-date?date=\(date)", relativeTo: API.baseURL) else { throw APIError.invalidURL }
        var req = URLRequest(url: url); req.timeoutInterval = 35
        if let token = TokenStore.shared.accessToken { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await URLSession.shared.data(for: req) } catch { throw APIError.network(error) }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.http(status: (response as? HTTPURLResponse)?.statusCode ?? 0, body: nil)
        }
        return try JSONDecoder().decode(RunByDateResponse.self, from: data)
    }
}

// MARK: - Fetch (anonymous; hits API.baseURL)

@MainActor
enum OverviewAPI {
    static func fetch() async throws -> OverviewResponse {
        guard let url = URL(string: "/api/overview", relativeTo: API.baseURL) else {
            throw APIError.invalidURL
        }
        var req = URLRequest(url: url)
        req.timeoutInterval = 35
        if let token = TokenStore.shared.accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await URLSession.shared.data(for: req) }
        catch { throw APIError.network(error) }
        guard let http = response as? HTTPURLResponse else { throw APIError.http(status: 0, body: nil) }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(status: http.statusCode, body: String(data: data, encoding: .utf8))
        }
        return try JSONDecoder().decode(OverviewResponse.self, from: data)
    }
}

// MARK: - Display helpers (real data → strings, honest about missing)

enum OverviewFormat {
    /// Distance number, integer when whole. nil → em dash.
    static func distance(_ mi: Double?) -> String {
        guard let mi else { return "—" }
        return mi == mi.rounded() ? String(Int(mi)) : String(format: "%.1f", mi)
    }
    /// "7:11" from 431 s/mi. nil → "Easy" (an easy run has no pace gate).
    static func pace(_ sPerMi: Double?) -> String {
        guard let s = sPerMi, s > 0 else { return "Easy" }
        let m = Int(s) / 60, sec = Int(s) % 60
        return "\(m):\(String(format: "%02d", sec))"
    }
    static func paceUnit(_ sPerMi: Double?) -> String? {
        (sPerMi ?? 0) > 0 ? "/mi" : nil
    }
    /// Duration in minutes from an explicit value, else distance × pace.
    static func durationMin(distanceMi: Double?, paceSPerMi: Double?, explicit: Double?) -> Int? {
        if let e = explicit, e > 0 { return Int(e.rounded()) }
        if let d = distanceMi, let p = paceSPerMi, d > 0, p > 0 { return Int((d * p / 60).rounded()) }
        return nil
    }
    /// Readiness level → (badge text, semantic).
    static func readinessBadge(_ level: String?) -> (String, ReadinessTone) {
        switch (level ?? "").lowercased() {
        case "green": return ("Primed", .green)
        case "yellow": return ("Watch", .amber)
        case "red": return ("Back off", .red)
        default: return ("No data", .none)
        }
    }
    enum ReadinessTone { case green, amber, red, none }
}

// MARK: - Today's workout, sourced from the plan artifact (the truth)

/// The scheduled workout for today. Prefers `planWeekWorkouts` (the plan
/// artifact the web renders) over `workout.answer` (the route flags that
/// as the OLD engine — it can say "General aerobic" when the plan says
/// threshold). Falls back to the old engine only if the plan is missing.
struct DerivedWorkout {
    let type: String
    let label: String          // "Threshold · Cruise Intervals"
    let distanceMi: Double?
    let paceSPerMi: Double?
    let durationMin: Int?
    let isQuality: Bool
    let isRest: Bool
    let notes: String?
    let zone: Int?
    /// Server-computed structured workout (band + steps + effort + why).
    /// nil for the old-engine fallback / rest days.
    let detail: ODescription?

    init(plan: OPlanDay?, fallback: OWorkout?) {
        if let p = plan, let t = p.type {
            type = t
            isQuality = p.isQuality ?? false
            isRest = (t == "rest")
            distanceMi = p.distanceMi
            paceSPerMi = p.paceTargetSPerMi
            notes = p.notes
            zone = DerivedWorkout.zone(for: t)
            detail = p.description
            // Prefer the backend's resolved describeWorkout label/zone.
            label = p.label
                ?? DerivedWorkout.label(type: t, notes: p.notes, isQuality: p.isQuality ?? false)
            durationMin = OverviewFormat.durationMin(distanceMi: p.distanceMi, paceSPerMi: p.paceTargetSPerMi, explicit: p.durationMin)
        } else if let w = fallback {
            type = w.type ?? "easy"
            isQuality = w.isQuality ?? false
            isRest = false
            distanceMi = w.distanceMi
            paceSPerMi = w.paceTargetSPerMi
            notes = w.coachToday?.today?.description ?? w.voiceLead
            zone = w.hrZone
            detail = nil
            label = w.label ?? "Today's run"
            durationMin = OverviewFormat.durationMin(distanceMi: w.distanceMi, paceSPerMi: w.paceTargetSPerMi, explicit: nil)
        } else {
            type = "rest"; isQuality = false; isRest = true
            distanceMi = nil; paceSPerMi = nil; durationMin = nil; notes = nil; zone = nil
            label = "Rest"; detail = nil
        }
    }

    /// Pace band string for display ("8:29–8:59"), preferring the
    /// server's resolved band, falling back to the single plan pace.
    var paceDisplay: String {
        if let pt = detail?.paceTarget, let band = DerivedWorkout.paceBand(pt) { return band }
        return OverviewFormat.pace(paceSPerMi)
    }
    /// Extract just the leading "M:SS–M:SS" (or "M:SS") from a paceTarget
    /// string like "8:29–8:59/mi · strides at 1-mile race pace".
    static func paceBand(_ s: String) -> String? {
        // Range first, then single time.
        if let r = s.range(of: #"\d+:\d{2}\s*[–-]\s*\d+:\d{2}"#, options: .regularExpression) {
            return String(s[r]).replacingOccurrences(of: " ", with: "")
        }
        if let r = s.range(of: #"\d+:\d{2}"#, options: .regularExpression) {
            return String(s[r])
        }
        return nil
    }

    /// One-line effort guidance for the coach strip / detail.
    var guidance: String {
        switch type {
        case "threshold", "tempo": return "Comfortably hard, controlled threshold effort, then cool down easy."
        case "interval", "vo2", "quality": return "Hard reps with full recoveries. Hit the paces, don't exceed them."
        case "easy", "general_aerobic", "recovery": return "Easy and conversational. If you can't talk, slow down."
        case "long": return "Steady aerobic miles. Time on feet, not pace."
        case "rest": return "Rest day. Let the work absorb."
        default: return ""
        }
    }

    static func zone(for type: String) -> Int? {
        switch type {
        case "threshold", "tempo": return 4
        case "interval", "vo2", "quality": return 5
        case "easy", "long", "general_aerobic", "recovery": return 2
        default: return nil
        }
    }
    static func niceType(_ t: String) -> String {
        switch t {
        case "threshold": return "Threshold"
        case "tempo": return "Tempo"
        case "interval", "vo2": return "Intervals"
        case "easy": return "Easy run"
        case "long": return "Long run"
        case "recovery": return "Recovery"
        case "rest": return "Rest"
        case "general_aerobic": return "General aerobic"
        default: return t.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
    static func label(type: String, notes: String?, isQuality: Bool) -> String {
        let nice = niceType(type)
        if isQuality, let n = notesName(notes) { return "\(nice) · \(n)" }
        return nice
    }
    /// The lead phrase of the notes (before the em dash) is the workout's
    /// name, e.g. "Cruise intervals — warm up…" → "Cruise intervals".
    static func notesName(_ notes: String?) -> String? {
        guard let n = notes else { return nil }
        let lead = (n.components(separatedBy: "—").first ?? n)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return (2...40).contains(lead.count) ? lead : nil
    }
}

extension OverviewResponse {
    var planToday: OPlanDay? { planWeekWorkouts?.first { $0.dateISO == today } }
    /// A plan day is "done" only when a real run covered ≥60% of the
    /// planned distance — not merely because the date is in the past.
    func isPlanDayDone(_ d: OPlanDay) -> Bool {
        guard let date = d.dateISO, let planned = d.distanceMi, planned > 0 else { return false }
        let actual = completedByDate?[date] ?? 0
        return actual >= planned * 0.6
    }
    /// Logged a run, but under 60% of the planned distance — "short", which is
    /// neither done/on-plan nor missed (they did run something).
    func isPlanDayShort(_ d: OPlanDay) -> Bool {
        guard let date = d.dateISO, let planned = d.distanceMi, planned > 0 else { return false }
        let actual = completedByDate?[date] ?? 0
        return actual > 0 && actual < planned * 0.6
    }
    /// The runner deliberately skipped this day (distinct from "missed").
    func isPlanDaySkipped(_ d: OPlanDay) -> Bool {
        guard let date = d.dateISO else { return false }
        return skippedDates?.contains(date) ?? false
    }
    func isPlanDaySkipped(dateISO: String?) -> Bool {
        guard let date = dateISO else { return false }
        return skippedDates?.contains(date) ?? false
    }
    var todayWorkout: DerivedWorkout { DerivedWorkout(plan: planToday, fallback: workout?.answer) }
    var raceCountdown: (name: String, days: Int)? {
        if let r = state?.races?.nextA, let n = r.name, let d = r.daysAway { return (n, d) }
        return nil
    }
    /// True only when real recovery biometrics exist (HRV/RHR/sleep).
    var hasHealthData: Bool {
        let r = state?.recovery
        return (r?.hrv7dAvgMs != nil) || (r?.rhrBpm != nil) || (r?.sleep7dAvgHrs != nil)
    }
    var acwrValue: Double? {
        guard let l7 = state?.volume?.last7Mi, let avg = state?.volume?.weeklyAvg8w, avg > 0 else { return nil }
        return l7 / avg
    }
    /// Coach copy composed from the PLAN workout + accurate briefing
    /// clauses (greeting/body-state) + race. The backend briefing's
    /// workout clause is old-engine and disagrees with the plan, so we
    /// don't use it. Markdown bold preserved for AttributedString.
    /// The coach line to render: the server's day-aware line when present
    /// (matches the web), else the client-composed fallback.
    var coachRead: String {
        if let l = coachLine, !l.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return l }
        return composedCoach
    }

    var composedCoach: String {
        let dw = todayWorkout
        var parts: [String] = []
        for c in (briefing?.answer.clauses ?? []) where c.kind == "greeting" || c.kind == "body-state" {
            if let t = c.text, !t.isEmpty { parts.append(t) }
        }
        if dw.isRest { parts.append("Today is a rest day. Let the work absorb.") }
        else { parts.append("Today is \(dw.label.lowercased()) at \(OverviewFormat.distance(dw.distanceMi)) mi. \(dw.guidance)") }
        if let rc = raceCountdown { parts.append("\(rc.days) days to \(rc.name).") }
        return parts.joined(separator: " ")
    }
}
