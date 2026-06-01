//
//  API+Toolkit.swift
//  Endpoint methods for the Faff Component Toolkit (Phase 2026-05-31).
//
//  Adds the API methods every toolkit component reaches for:
//    · /api/coach/intents               · CoachActivityTimeline + WhatChangedExpander + AdaptationCard
//    · /api/streak                      · StreakPill
//    · /api/niggle  + /recovery + DELETE · SymptomReportSheet + DailyCheckChip
//    · /api/sick    + /recovery + DELETE · SymptomReportSheet + ReturnGateCard
//    · /api/strength · /api/cross-training · LogNonRunSheet
//    · /api/goals                       · NewGoalSheet
//    · /api/runs/[id]/rpe GET/POST      · RPEEntryCard
//    · /api/profile/notifications GET/PATCH · NotificationPrefsList
//    · /api/checkin POST                · PostRunCheckinChips
//
//  Every method goes through API.authedSend so the bearer attach +
//  401-auto-bounce stays consistent.
//

import Foundation

extension API {

    // MARK: - Coach intents

    /// `reasonLike` accepts either a bare prefix ("plan_adapt_") or a
    /// LIKE pattern with a trailing `%` ("plan_adapt_%"). The upstream
    /// endpoint expects a prefix and appends `%` server-side, so we
    /// strip any trailing `%` before sending.
    static func fetchCoachIntents(limit: Int = 20,
                                  since: String? = nil,
                                  reasonLike: String? = nil) async throws -> [CoachIntent] {
        var comps = URLComponents(
            url: baseURL.appendingPathComponent("api/coach/intents"),
            resolvingAgainstBaseURL: false
        )!
        var qs = [URLQueryItem(name: "limit", value: "\(limit)")]
        if let since { qs.append(URLQueryItem(name: "since", value: since)) }
        if let rl = reasonLike {
            let prefix = rl.hasSuffix("%") ? String(rl.dropLast()) : rl
            qs.append(URLQueryItem(name: "reason_prefix", value: prefix))
        }
        comps.queryItems = qs
        var req = URLRequest(url: comps.url!)
        req.httpMethod = "GET"
        let (data, http) = try await API.authedSend(req)
        guard (200..<300).contains(http.statusCode) else { return [] }
        let env = try? JSONDecoder().decode(CoachIntentsResponse.self, from: data)
        return env?.intents ?? []
    }

    // MARK: - Streak

    static func fetchStreak() async throws -> StreakResponse? {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/streak"))
        req.httpMethod = "GET"
        let (data, http) = try await API.authedSend(req)
        guard (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(StreakResponse.self, from: data)
    }

    // MARK: - Niggle

    static func fetchActiveNiggle() async throws -> NiggleRow? {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/niggle"))
        req.httpMethod = "GET"
        let (data, http) = try await API.authedSend(req)
        guard (200..<300).contains(http.statusCode) else { return nil }
        let env = try? JSONDecoder().decode(NiggleEnvelope.self, from: data)
        return env?.active
    }

    @discardableResult
    static func postNiggle(bodyPart: String,
                           severity: Int,
                           status: String,
                           note: String? = nil) async throws -> Bool {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/niggle"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = [
            "body_part": bodyPart,
            "severity": severity,
            "status": status
        ]
        if let n = note { body["note"] = n }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (_, http) = try await API.authedSend(req)
        return (200..<300).contains(http.statusCode)
    }

    @discardableResult
    static func postNiggleRecovery(status: NiggleStatus) async throws -> Bool {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/niggle/recovery"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["status": status.rawValue])
        let (_, http) = try await API.authedSend(req)
        return (200..<300).contains(http.statusCode)
    }

    @discardableResult
    static func clearNiggle() async throws -> Bool {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/niggle"))
        req.httpMethod = "DELETE"
        let (_, http) = try await API.authedSend(req)
        return (200..<300).contains(http.statusCode)
    }

    // MARK: - Sick

    static func fetchActiveSick() async throws -> SickRow? {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/sick"))
        req.httpMethod = "GET"
        let (data, http) = try await API.authedSend(req)
        guard (200..<300).contains(http.statusCode) else { return nil }
        let env = try? JSONDecoder().decode(SickEnvelope.self, from: data)
        return env?.active
    }

    @discardableResult
    static func postSick(symptoms: [String], fever: Bool) async throws -> Bool {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/sick"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // Field names match web-v2/app/api/sick/route.ts:
        //   symptoms (string[]) · has_fever (bool) · started (ISO date).
        // iPhone provides `fever` argument-side for ergonomic call sites;
        // wire mapping is below.
        let body: [String: Any] = [
            "symptoms": symptoms,
            "has_fever": fever,
            "started": Self.isoTodayUTC()
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (_, http) = try await API.authedSend(req)
        return (200..<300).contains(http.statusCode)
    }

    @discardableResult
    static func postSickRecovery() async throws -> Bool {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/sick/recovery"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: [:] as [String: Any])
        let (_, http) = try await API.authedSend(req)
        return (200..<300).contains(http.statusCode)
    }

    // MARK: - Strength / Cross-training

    @discardableResult
    static func postStrength(type: String, durationMin: Int, notes: String? = nil) async throws -> Bool {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/strength"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // Field names match web-v2/app/api/strength/route.ts:
        //   date · session_type · duration_min · notes.
        var body: [String: Any] = [
            "date": Self.isoTodayUTC(),
            "session_type": type.lowercased(),
            "duration_min": durationMin
        ]
        if let n = notes { body["notes"] = n }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (_, http) = try await API.authedSend(req)
        return (200..<300).contains(http.statusCode)
    }

    @discardableResult
    static func postCrossTraining(modality: String,
                                  durationMin: Int,
                                  intensity: String,
                                  hr: Int? = nil) async throws -> Bool {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/cross-training"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // Field names match web-v2/app/api/cross-training/route.ts:
        //   date · modality · duration_min · intensity (easy|moderate|hard) · avg_hr.
        var body: [String: Any] = [
            "date": Self.isoTodayUTC(),
            "modality": modality.lowercased(),
            "duration_min": durationMin,
            "intensity": intensity.lowercased()
        ]
        if let h = hr { body["avg_hr"] = h }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (_, http) = try await API.authedSend(req)
        return (200..<300).contains(http.statusCode)
    }

    // MARK: - Goals

    @discardableResult
    static func postGoal(type: String, target: String, deadline: String) async throws -> Bool {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/goals"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // Field names match web-v2/app/api/goals/route.ts:
        //   goal_type ('volume' | 'speed' | 'distance' | 'habit' | 'strength' | 'health') ·
        //   target (string) · deadline (ISO date · optional).
        let body: [String: Any] = [
            "goal_type": type.lowercased(),
            "target": target,
            "deadline": deadline
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (_, http) = try await API.authedSend(req)
        return (200..<300).contains(http.statusCode)
    }

    // MARK: - RPE

    static func fetchRPE(runId: String) async throws -> RPEResponse? {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/runs/\(runId)/rpe"))
        req.httpMethod = "GET"
        let (data, http) = try await API.authedSend(req)
        guard (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(RPEResponse.self, from: data)
    }

    @discardableResult
    static func postRPE(runId: String, rpe: Int, notes: String? = nil) async throws -> Bool {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/runs/\(runId)/rpe"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["rpe": rpe]
        if let n = notes { body["notes"] = n }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (_, http) = try await API.authedSend(req)
        return (200..<300).contains(http.statusCode)
    }

    // MARK: - Notification prefs

    static func fetchNotificationPrefs() async throws -> NotificationPrefs? {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/profile/notifications"))
        req.httpMethod = "GET"
        let (data, http) = try await API.authedSend(req)
        guard (200..<300).contains(http.statusCode) else { return nil }
        // Server may return {prefs: {...}} or the prefs blob directly · try both.
        if let direct = try? JSONDecoder().decode(NotificationPrefs.self, from: data) { return direct }
        struct Wrap: Decodable { let prefs: NotificationPrefs? }
        return (try? JSONDecoder().decode(Wrap.self, from: data))?.prefs
    }

    @discardableResult
    static func patchNotificationPrefs(_ prefs: NotificationPrefs) async throws -> Bool {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/profile/notifications"))
        req.httpMethod = "PATCH"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(prefs)
        let (_, http) = try await API.authedSend(req)
        return (200..<300).contains(http.statusCode)
    }

    // MARK: - Checkin reply

    static func postCheckin(activityId: String,
                            execution: String,
                            body: [String]) async throws -> String? {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/checkin"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let payload: [String: Any] = [
            "activity_id": activityId,
            "execution": execution,
            "body": body
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (data, http) = try await API.authedSend(req)
        guard (200..<300).contains(http.statusCode) else { return nil }
        let env = try? JSONDecoder().decode(CheckinResponse.self, from: data)
        return env?.coach_reply
    }

    // MARK: - Internal helpers

    /// Today's date in UTC as yyyy-MM-dd. Used for niggle/sick/strength/
    /// cross-training/goal POST bodies where the server validates a strict
    /// ISO date string. Backed callers below.
    static func isoTodayUTC() -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        return f.string(from: Date())
    }
}
