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
