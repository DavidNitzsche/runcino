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

    /// `trend` must be one of: recovered | better | same | worse.
    /// Defaults to "recovered" — the "Yes, ease me back" CTA on ReturnGateCard.
    @discardableResult
    static func postSickRecovery(trend: String = "recovered") async throws -> Bool {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/sick/recovery"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["today": trend])
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

    /// HK-import path · POST `/api/strength` with `source='apple_health'`
    /// + `hk_uuid`. Idempotent server-side via the unique partial index on
    /// `strength_sessions(hk_uuid) WHERE hk_uuid IS NOT NULL` — re-syncing
    /// the same HKWorkout upserts duration_min/session_type/date and
    /// preserves any runner-added notes.
    ///
    /// Contract: designs/briefs/strength-hk-ingest-brief.md (2026-06-01).
    @discardableResult
    static func postStrengthFromHK(date: String,
                                   sessionType: String,
                                   durationMin: Int,
                                   hkUUID: String) async throws -> Bool {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/strength"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "date": date,
            "session_type": sessionType,
            "duration_min": durationMin,
            "source": "apple_health",
            "hk_uuid": hkUUID,
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (_, http) = try await API.authedSend(req)
        return (200..<300).contains(http.statusCode)
    }

    /// DELETE `/api/strength?hk_uuid=...` · owner-scoped delete by HK uuid.
    /// Used by the HK strength importer when a runner removes a workout
    /// from Apple Fitness · the iPhone's delete-diff sweep on each sync
    /// resolves the missing uuids and calls this.
    ///
    /// Idempotent: backend returns 200 `{ ok, deleted: 0 }` when no row
    /// matches, so re-sweeps on every sync are safe.
    ///
    /// Contract: designs/briefs/strength-hk-delete-backend-brief.md
    /// (2026-06-01). Endpoint is iPhone-blocking until shipped — the
    /// caller (HealthKitImporter.syncStrengthDeletes) catches non-2xx and
    /// keeps the uuid in the local cache so the next sync retries.
    @discardableResult
    static func deleteStrengthByHKUUID(_ hkUUID: String) async throws -> Bool {
        var comps = URLComponents(
            url: baseURL.appendingPathComponent("api/strength"),
            resolvingAgainstBaseURL: false
        )!
        comps.queryItems = [URLQueryItem(name: "hk_uuid", value: hkUUID)]
        var req = URLRequest(url: comps.url!)
        req.httpMethod = "DELETE"
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

    // MARK: - Pending coach proposals (Today stack)

    static func fetchPendingProposals() async throws -> [PendingProposal] {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/coach/proposals"))
        req.httpMethod = "GET"
        let (data, http) = try await API.authedSend(req)
        guard (200..<300).contains(http.statusCode) else { return [] }
        let env = try? JSONDecoder().decode(ProposalsResponse.self, from: data)
        return env?.proposals ?? []
    }

    // MARK: - Per-workout adapter proposals (propose-first flow)

    /// GET /api/plan/workout-proposals · pending plan_workout_proposals
    /// rows. Drives the Today banner + the repurposed NudgeSheet
    /// (LET IT HAPPEN / KEEP ORIGINAL).
    static func fetchWorkoutProposals() async throws -> [WorkoutProposal] {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/plan/workout-proposals"))
        req.httpMethod = "GET"
        let (data, http) = try await API.authedSend(req)
        guard (200..<300).contains(http.statusCode) else { return [] }
        let env = try? JSONDecoder().decode(WorkoutProposalsResponse.self, from: data)
        return env?.proposals ?? []
    }

    /// accept=true → POST /api/plan/workout-proposals/:id/accept (server
    /// re-applies the stored action via applyAdaptations · provenance chip
    /// + coach_intents audit included). accept=false → POST /:id/dismiss
    /// (plan unchanged, banner clears on next load).
    @discardableResult
    static func respondWorkoutProposal(id: Int, accept: Bool) async throws -> Bool {
        let path = "api/plan/workout-proposals/\(id)/\(accept ? "accept" : "dismiss")"
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "POST"
        let (_, http) = try await API.authedSend(req)
        return (200..<300).contains(http.statusCode)
    }

    // MARK: - Notification inbox

    static func fetchNotificationInbox(days: Int = 14, limit: Int = 50) async throws -> [NotifInboxItem] {
        var comps = URLComponents(
            url: baseURL.appendingPathComponent("api/notifications/inbox"),
            resolvingAgainstBaseURL: false
        )!
        comps.queryItems = [
            URLQueryItem(name: "days", value: "\(days)"),
            URLQueryItem(name: "limit", value: "\(limit)")
        ]
        var req = URLRequest(url: comps.url!)
        req.httpMethod = "GET"
        let (data, http) = try await API.authedSend(req)
        guard (200..<300).contains(http.statusCode) else { return [] }
        let env = try? JSONDecoder().decode(NotifInboxResponse.self, from: data)
        return env?.items ?? []
    }

    // MARK: - Strava push history

    static func fetchStravaPushes() async throws -> [StravaPushRow] {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/strava/pushes"))
        req.httpMethod = "GET"
        let (data, http) = try await API.authedSend(req)
        guard (200..<300).contains(http.statusCode) else { return [] }
        let env = try? JSONDecoder().decode(StravaPushesResponse.self, from: data)
        return env?.pushes ?? []
    }

    // MARK: - LLM usage rollup

    static func fetchUsage(days: Int = 14) async throws -> UsageResponse? {
        var comps = URLComponents(
            url: baseURL.appendingPathComponent("api/usage"),
            resolvingAgainstBaseURL: false
        )!
        comps.queryItems = [URLQueryItem(name: "days", value: "\(days)")]
        var req = URLRequest(url: comps.url!)
        req.httpMethod = "GET"
        let (data, http) = try await API.authedSend(req)
        guard (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(UsageResponse.self, from: data)
    }

    // MARK: - Per-day shoe override

    @discardableResult
    static func setShoeForDay(date: String, shoeId: Int?) async throws -> Bool {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/today/shoe"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "date": date,
            "shoe_id": shoeId as Any
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (_, http) = try await API.authedSend(req)
        return (200..<300).contains(http.statusCode)
    }

    // MARK: - Move / edit a planned workout

    /// PATCH /api/plan/workout · move or re-type a planned workout in
    /// place. Pass new_date_iso to "move" the workout to another calendar
    /// slot; pass type / distance / sub_label to edit it.
    @discardableResult
    static func patchPlannedWorkout(planId: String,
                                    dateIso: String,
                                    newDateIso: String? = nil,
                                    type: String? = nil,
                                    distanceMi: Double? = nil,
                                    subLabel: String? = nil) async throws -> Bool {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/plan/workout"))
        req.httpMethod = "PATCH"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = [
            "plan_id": planId,
            "date_iso": dateIso
        ]
        if let n = newDateIso { body["new_date_iso"] = n }
        if let t = type { body["type"] = t }
        if let d = distanceMi { body["distance_mi"] = d }
        if let s = subLabel { body["sub_label"] = s }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (_, http) = try await API.authedSend(req)
        return (200..<300).contains(http.statusCode)
    }

    // MARK: - GPX upload for a race course

    @discardableResult
    static func uploadRaceGPX(slug: String, gpxData: Data, filename: String = "course.gpx") async throws -> Bool {
        let boundary = "FaffBoundary-\(UUID().uuidString)"
        var req = URLRequest(url: baseURL.appendingPathComponent("api/race/gpx"))
        req.httpMethod = "POST"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data()
        func append(_ s: String) { body.append(s.data(using: .utf8)!) }
        // slug field
        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"slug\"\r\n\r\n")
        append("\(slug)\r\n")
        // file
        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n")
        append("Content-Type: application/gpx+xml\r\n\r\n")
        body.append(gpxData)
        append("\r\n--\(boundary)--\r\n")
        req.httpBody = body
        let (_, http) = try await API.authedSend(req)
        return (200..<300).contains(http.statusCode)
    }
}
