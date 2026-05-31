//
//  API.swift
//  Networking client. Points at the web-v2 staging URL until cutover.
//

import Foundation

extension Notification.Name {
    /// Posted when any /api/* call returns 401. RootContainer listens for
    /// this and bounces to SignIn so the user can mint a fresh session.
    /// Auth contract changed 2026-05-30 · /api/* no longer falls back to
    /// the default user when no token is present.
    static let faffSessionExpired = Notification.Name("faff.session.expired")
}

enum APIAuthError: Error { case unauthorized }

enum API {

    /// Auth-aware GET helper. Every read-side endpoint should call this so
    /// (a) the Authorization: Bearer token is attached when present and
    /// (b) a 401 posts .faffSessionExpired so the gate can take over.
    static func authedGET(_ url: URL) async throws -> (Data, HTTPURLResponse) {
        let req = URLRequest(url: url)
        return try await authedSend(req)
    }

    /// Auth-aware request helper for ANY HTTP method (POST/PATCH/DELETE/etc.).
    /// Caller assembles the URLRequest (method, headers, body); we attach the
    /// bearer + do 401 handling so write paths share the same session contract
    /// as reads. Returns the (Data, HTTPURLResponse) tuple — caller decides
    /// what to do with the body / status.
    static func authedSend(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        var req = request
        TokenStore.shared.authorize(&req)
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw APIError.badStatus(-1) }
        if http.statusCode == 401 {
            NotificationCenter.default.post(name: .faffSessionExpired, object: nil)
            throw APIAuthError.unauthorized
        }
        return (data, http)
    }
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

        let (data, http): (Data, HTTPURLResponse) = try await API.authedGET(comps.url!)
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.badStatus(http.statusCode)
        }
        let decoded = try JSONDecoder().decode(Briefing.self, from: data)
        // Cache the raw bytes so the next launch can hydrate this
        // surface synchronously — no skeleton, no waiting.
        // Mode-keyed surfaces (race-detail/today proximity-aware) only
        // cache the default mode; per-mode caching would balloon the
        // store. Race-detail prefetches its own cache via prefetchedDetail.
        AppCache.writeRaw(briefingKey(surface), data: data)
        return decoded
    }

    /// Map briefing surface name to its AppCache key. Per-surface keys
    /// so /today's brief doesn't overwrite /training's, etc.
    private static func briefingKey(_ surface: String) -> AppCache.Key {
        switch surface {
        case "training": return .trainingBriefing
        case "races":    return .racesBriefing
        case "health":   return .healthBriefing
        case "profile":  return .profileBriefing
        default:         return .todayBriefing
        }
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
        _ = try await API.authedSend(req)
    }

    /// Closed loop §8.6 — submit a profile gap input (height, weight, etc.).
    static func updateProfile(_ patch: [String: Any]) async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/profile"))
        req.httpMethod = "PATCH"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: patch)
        _ = try await API.authedSend(req)
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
        let (data, _): (Data, HTTPURLResponse) = try await API.authedGET(comps.url!)
        let r = try? JSONDecoder().decode(StravaConnectURLResponse.self, from: data)
        guard let urlStr = r?.url else { return nil }
        return URL(string: urlStr)
    }

    // MARK: - P29 settings + profile fetch

    static func fetchSettings() async throws -> UserSettings? {
        let url = baseURL.appendingPathComponent("api/settings")
        let (data, http): (Data, HTTPURLResponse) = try await API.authedGET(url)
        guard (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(UserSettings.self, from: data)
    }

    static func patchSettings(_ patch: [String: Any]) async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/settings"))
        req.httpMethod = "PATCH"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: patch)
        let (_, http): (Data, HTTPURLResponse) = try await API.authedSend(req)
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.badStatus(http.statusCode)
        }
    }

    static func fetchProfile() async throws -> ProfileFields? {
        let url = baseURL.appendingPathComponent("api/profile")
        let (data, http): (Data, HTTPURLResponse) = try await API.authedGET(url)
        guard (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(ProfileFields.self, from: data)
    }

    // MARK: - P40 race detail

    static func fetchRaceDetail(slug: String) async throws -> RaceDetailResponse? {
        let url = baseURL.appendingPathComponent("api/race/\(slug)")
        let (data, http): (Data, HTTPURLResponse) = try await API.authedGET(url)
        guard (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(RaceDetailResponse.self, from: data)
    }

    // MARK: - P32 shoe assignment

    static func fetchShoes() async throws -> ShoesResponse? {
        let url = baseURL.appendingPathComponent("api/shoe")
        let (data, http): (Data, HTTPURLResponse) = try await API.authedGET(url)
        guard (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(ShoesResponse.self, from: data)
    }

    static func assignShoeToRun(runId: String, shoeId: Int?) async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/runs/\(runId)"))
        req.httpMethod = "PATCH"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = ["shoe_id": shoeId as Any]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (_, http): (Data, HTTPURLResponse) = try await API.authedSend(req)
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.badStatus(http.statusCode)
        }
    }

    // MARK: - P29 manual run + race retro

    static func submitManualRun(_ body: [String: Any]) async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/run/manual"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (_, http): (Data, HTTPURLResponse) = try await API.authedSend(req)
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.badStatus(http.statusCode)
        }
    }

    static func submitRaceRetro(slug: String, body: [String: Any]) async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/race"))
        req.httpMethod = "PATCH"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var payload = body
        payload["slug"] = slug
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (_, http): (Data, HTTPURLResponse) = try await API.authedSend(req)
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.badStatus(http.statusCode)
        }
    }

    /// Fetch today's WatchWorkout shape as raw Data so we can forward it
    /// unchanged to the watch via applicationContext (preserves field shape
    /// exactly — the watch decodes from Data into its own WatchWorkout).
    static func fetchWatchTodayRaw() async throws -> Data {
        let url = baseURL.appendingPathComponent("api/watch/today")
        let (data, http): (Data, HTTPURLResponse) = try await API.authedGET(url)
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.badStatus(http.statusCode)
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
        let (data, http): (Data, HTTPURLResponse) = try await API.authedGET(comps.url!)
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.badStatus(http.statusCode)
        }
        let w = try JSONDecoder().decode(TodayWorkoutWrapper.self, from: data)
        // Cache the *raw* wrapper (not just the workout) so the next
        // launch decodes back through the same shape. Today's workout
        // only — caching the WorkoutDetailModal preview-for-tomorrow
        // would just cause stale-data confusion.
        if date == nil {
            AppCache.writeRaw(.todayWorkout, data: data)
        }
        return w.workout
    }

    /// Run log (P28). Returns weeks of runs for iPhone /log tab.
    static func fetchLog(limit: Int = 60) async throws -> LogState? {
        var comps = URLComponents(
            url: baseURL.appendingPathComponent("api/log"),
            resolvingAgainstBaseURL: false
        )!
        comps.queryItems = [URLQueryItem(name: "limit", value: "\(limit)")]
        let (data, http): (Data, HTTPURLResponse) = try await API.authedGET(comps.url!)
        guard (200..<300).contains(http.statusCode) else { return nil }
        guard let decoded = try? JSONDecoder().decode(LogState.self, from: data) else { return nil }
        AppCache.writeRaw(.logState, data: data)
        return decoded
    }

    /// Single run detail (P28). Powers RunDetailSheet.
    static func fetchRunDetail(id: String) async throws -> RunDetail? {
        let url = baseURL.appendingPathComponent("api/runs/\(id)")
        let (data, http): (Data, HTTPURLResponse) = try await API.authedGET(url)
        guard (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(RunDetail.self, from: data)
    }

    /// Real readiness score (P27.2). Replaces the hardcoded "88" placeholder
    /// that lived in TodayView. Returns nil when the server can't compute
    /// one (no health data yet) — UI degrades to a "?" instead of lying.
    static func fetchReadiness() async throws -> ReadinessSnapshot? {
        let url = baseURL.appendingPathComponent("api/readiness")
        let (data, http): (Data, HTTPURLResponse) = try await API.authedGET(url)
        guard (200..<300).contains(http.statusCode) else {
            return nil
        }
        guard let decoded = try? JSONDecoder().decode(ReadinessSnapshot.self, from: data) else { return nil }
        AppCache.writeRaw(.readiness, data: data)
        return decoded
    }

    // MARK: - P-SKIP · Skip Today (Phase 12, 2026-05-28)
    //
    // Mirrors web-v2/app/api/today/skip/route.ts (POST + DELETE + GET).
    // The GET handler is added in Phase 12 so the iPhone can hydrate
    // todaySkipped without a separate /briefing round-trip.

    private struct SkipResponse: Decodable {
        let skipped: Bool
        let date: String
    }

    /// POST /api/onboarding/complete · persists the onboarding answers
    /// and (for race-mode) seeds an initial plan. Returns true on a 2xx.
    static func completeOnboarding(payload: [String: Any]) async throws -> Bool {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/onboarding/complete"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (_, http): (Data, HTTPURLResponse) = try await API.authedSend(req)
        guard (200..<300).contains(http.statusCode) else { return false }
        return true
    }

    /// POST /api/strava/push/[runId] · manually push a completed run to
    /// Strava. Idempotent: a second push of the same runId is a no-op.
    /// Returns true on a 2xx response; false on any failure.
    static func pushRunToStrava(runId: String) async throws -> Bool {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/strava/push/\(runId)"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = "{}".data(using: .utf8)
        let (_, http): (Data, HTTPURLResponse) = try await API.authedSend(req)
        guard (200..<300).contains(http.statusCode) else { return false }
        return true
    }

    /// POST /api/coach/proposal · accept or decline a coach swap proposal.
    /// `proposal` is the alternative the coach surfaced (shape varies by
    /// proposal kind; passes through as-is for the server to apply).
    /// Returns true on a 2xx; false on any failure.
    static func postCoachProposal(action: String, proposal: [String: Any]) async throws -> Bool {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/coach/proposal"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = ["action": action, "proposal": proposal]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (_, http): (Data, HTTPURLResponse) = try await API.authedSend(req)
        guard (200..<300).contains(http.statusCode) else { return false }
        return true
    }

    /// GET /api/coach/facts?surface=<…> → deterministic coach facts for any
    /// of the supported surfaces (today / plan / races / race_detail /
    /// health / me). Returns nil on any decode or HTTP error so callers can
    /// gracefully hide the section rather than show a fake fact.
    static func fetchCoachFacts(surface: String) async throws -> CoachFactsBlock? {
        var comps = URLComponents(
            url: baseURL.appendingPathComponent("api/coach/facts"),
            resolvingAgainstBaseURL: false
        )!
        comps.queryItems = [URLQueryItem(name: "surface", value: surface)]
        let (data, http): (Data, HTTPURLResponse) = try await API.authedGET(comps.url!)
        guard (200..<300).contains(http.statusCode) else { return nil }
        let envelope = try? JSONDecoder().decode(CoachFactsEnvelope.self, from: data)
        return envelope?.block
    }

    /// GET /api/today/skip → returns whether today is currently marked
    /// as skipped. Defaults to false on any network / decode error so
    /// the UI doesn't lie about a skip the user didn't make.
    static func fetchTodaySkipped() async throws -> Bool {
        let url = baseURL.appendingPathComponent("api/today/skip")
        let (data, http): (Data, HTTPURLResponse) = try await API.authedGET(url)
        guard (200..<300).contains(http.statusCode) else {
            return false
        }
        let decoded = try? JSONDecoder().decode(SkipResponse.self, from: data)
        return decoded?.skipped ?? false
    }

    /// POST /api/today/skip → mark today as skipped. Server uses
    /// `process.env.DEFAULT_USER_ID` and the same -7h "today" offset
    /// as the glance loader (lib/coach/glance-state.ts:56).
    static func postSkipToday() async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/today/skip"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // Empty body — server picks today by default.
        req.httpBody = "{}".data(using: .utf8)
        let (_, http): (Data, HTTPURLResponse) = try await API.authedSend(req)
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.badStatus(http.statusCode)
        }
    }

    /// DELETE /api/today/skip → undo today's skip.
    static func deleteSkipToday() async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/today/skip"))
        req.httpMethod = "DELETE"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = "{}".data(using: .utf8)
        let (_, http): (Data, HTTPURLResponse) = try await API.authedSend(req)
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.badStatus(http.statusCode)
        }
    }

    /// Full /profile state — identity + physiology + connections — shaped
    /// identically to web's ProfileState. Replaces hardcoded values in
    /// ProfileView. See web-v2/app/api/profile/state/route.ts.
    static func fetchProfileState() async throws -> ProfileState? {
        let url = baseURL.appendingPathComponent("api/profile/state")
        let (data, http): (Data, HTTPURLResponse) = try await API.authedGET(url)
        guard (200..<300).contains(http.statusCode) else { return nil }
        guard let decoded = try? JSONDecoder().decode(ProfileState.self, from: data) else { return nil }
        AppCache.writeRaw(.profileState, data: data)
        return decoded
    }

    /// /api/races — race list for the iPhone /races tab. Same endpoint
    /// the web list reads. Sorted upcoming-first.
    static func fetchRaces() async throws -> RaceListResponse? {
        let url = baseURL.appendingPathComponent("api/races")
        let (data, http): (Data, HTTPURLResponse) = try await API.authedGET(url)
        guard (200..<300).contains(http.statusCode) else { return nil }
        guard let decoded = try? JSONDecoder().decode(RaceListResponse.self, from: data) else { return nil }
        AppCache.writeRaw(.raceList, data: data)
        return decoded
    }

    /// /api/training/state — full plan state for the /training tab.
    /// Powers the iPhone PhaseStrip / mileage arc / week-ahead detail,
    /// using the same data web /training reads.
    static func fetchTrainingState() async throws -> TrainingState? {
        let url = baseURL.appendingPathComponent("api/training/state")
        let (data, http): (Data, HTTPURLResponse) = try await API.authedGET(url)
        guard (200..<300).contains(http.statusCode) else { return nil }
        guard let decoded = try? JSONDecoder().decode(TrainingState.self, from: data) else { return nil }
        AppCache.writeRaw(.trainingState, data: data)
        return decoded
    }

    /// GET /api/prescription — pulls back JUST the weather_baseline block
    /// for surfacing "HOTTER THAN USUAL" tags. The full prescription shape
    /// (paces, hrTargets, fueling) is not decoded here — WatchWorkout
    /// already carries the structured workout, and we only need the heat
    /// context for the tag. Pass `type` and `weeklyMi` to match the
    /// /api/prescription contract.
    static func fetchPrescriptionWeather(type: String, weeklyMi: Int, date: String? = nil) async throws -> WeatherBaseline? {
        var comps = URLComponents(
            url: baseURL.appendingPathComponent("api/prescription"),
            resolvingAgainstBaseURL: false
        )!
        var items = [
            URLQueryItem(name: "type", value: type),
            URLQueryItem(name: "weeklyMi", value: "\(weeklyMi)"),
        ]
        if let date { items.append(URLQueryItem(name: "date", value: date)) }
        comps.queryItems = items
        let (data, http): (Data, HTTPURLResponse) = try await API.authedGET(comps.url!)
        guard (200..<300).contains(http.statusCode) else { return nil }
        let envelope = try? JSONDecoder().decode(PrescriptionWeatherEnvelope.self, from: data)
        return envelope?.weather_baseline
    }

    /// GET /api/learn/[slug] — full doctrine article body the modal reads.
    /// 45 articles seeded server-side after the 2026-05-30 audit pass. Returns
    /// nil when slug not found (404). Cached for an hour by the server's
    /// Cache-Control header so we don't bother with AppCache here.
    static func fetchLearnArticle(slug: String) async throws -> LearnArticle? {
        let url = baseURL.appendingPathComponent("api/learn/\(slug)")
        let (data, http): (Data, HTTPURLResponse) = try await API.authedGET(url)
        guard (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(LearnArticle.self, from: data)
    }

    /// /api/health/state — 30-day trends + summary + watch-mode for
    /// every health metric the iPhone /health tab renders.
    static func fetchHealthState() async throws -> HealthState? {
        let url = baseURL.appendingPathComponent("api/health/state")
        let (data, http): (Data, HTTPURLResponse) = try await API.authedGET(url)
        guard (200..<300).contains(http.statusCode) else { return nil }
        guard let decoded = try? JSONDecoder().decode(HealthState.self, from: data) else { return nil }
        AppCache.writeRaw(.healthState, data: data)
        return decoded
    }

    /// Mon-Sun plan_workouts for the week containing `date` (or today).
    /// Drives the iPhone WeekStrip.
    static func fetchPlanWeek(date: String? = nil) async throws -> PlanWeek {
        var comps = URLComponents(
            url: baseURL.appendingPathComponent("api/plan/week"),
            resolvingAgainstBaseURL: false
        )!
        if let date { comps.queryItems = [URLQueryItem(name: "date", value: date)] }
        let (data, http): (Data, HTTPURLResponse) = try await API.authedGET(comps.url!)
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.badStatus(http.statusCode)
        }
        let decoded = try JSONDecoder().decode(PlanWeek.self, from: data)
        // Current-week only — date-overridden fetches are previews and
        // shouldn't overwrite the canonical plan-week cache.
        if date == nil {
            AppCache.writeRaw(.planWeek, data: data)
        }
        return decoded
    }

    // MARK: - Notifications v1 (2026-05-28 deck)

    /// POST /api/notifications/register with the APNs device token after
    /// UIApplication delegate hands it back. Called from FaffApp's
    /// didRegisterForRemoteNotifications path. Soft-fail: on network error
    /// we silently retry next foreground.
    static func registerDeviceToken(_ token: String, appVersion: String?) async {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/notifications/register"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = [
            "device_token": token,
            "platform": "ios",
        ]
        if let v = appVersion { body["app_version"] = v }
        do {
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
            _ = try? await API.authedSend(req)
        } catch {
            // JSON failed to serialize — silent.
        }
    }

    /// POST /api/notifications/ack when the runner taps a rich-notification
    /// action on the lock screen. The web's per-category routing handles
    /// the side-effect (skip un-skip, niggle recovery insert, weekly check-in,
    /// etc.) — see app/api/notifications/ack/route.ts.
    static func ackNotification(
        category: String,
        action: String,
        dedupKey: String?
    ) async {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/notifications/ack"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = [
            "category": category,
            "action": action,
        ]
        if let d = dedupKey { body["dedup_key"] = d }
        do {
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
            _ = try? await API.authedSend(req)
        } catch {
            // Silent.
        }
    }

    /// Fire every per-tab endpoint in parallel on app launch so the
    /// cache is warm by the time the user taps any tab. Best-effort;
    /// failures are silent — the per-tab .task in each View will retry.
    ///
    /// Called once from FaffApp.task at boot. 2026-05-27: shipped after
    /// David asked "before that first tap? we can just go through the
    /// app and load things." This is the iPhone equivalent of opening
    /// every web page once on session start so subsequent navigations
    /// are warm.
    static func prefetchAllOnLaunch() async {
        // Fire-and-forget. Each helper writes to AppCache on success
        // (see writeRaw calls above). View .task hooks still re-fetch
        // so a stale prefetch never sticks — they just have content
        // to show in the meantime.
        async let b1 = (try? await briefing(surface: "today"))
        async let b2 = (try? await briefing(surface: "training"))
        async let b3 = (try? await briefing(surface: "races"))
        async let b4 = (try? await briefing(surface: "health"))
        async let b5 = (try? await briefing(surface: "profile"))
        async let w  = (try? await fetchWatchWorkout())
        async let pw = (try? await fetchPlanWeek())
        async let r  = (try? await fetchReadiness())
        async let ts = (try? await fetchTrainingState())
        async let hs = (try? await fetchHealthState())
        async let ps = (try? await fetchProfileState())
        async let rl = (try? await fetchRaces())
        async let lg = (try? await fetchLog(limit: 80))
        // Discard results — side effect is the cache writes above.
        _ = await (b1, b2, b3, b4, b5)
        _ = await (w, pw, r)
        _ = await (ts, hs, ps, rl, lg)
    }
}

// MARK: - Watch workout wrapper
//
// `/api/watch/today` returns `{ "workout": WatchWorkout | null }`. The
// wrapper lives at top-level (not nested in fetchWatchWorkout) so the
// AppCache hydration path in TodayView can decode the same shape from
// the cached bytes.

struct TodayWorkoutWrapper: Decodable {
    let workout: WatchWorkout?
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
    // Phase 17 (2026-05-28) — real signals from /api/plan/week. Replaces
    // the FaffAdapter heuristic `is_past && type != "rest"` for DONE
    // checkmarks, and unblocks the WeekStrip header's `X / N mi` rollup.
    // Both optional — server emits null when no canonical run that day.
    let completedRunId: String?
    let done_mi: Double?
}

// MARK: - Readiness (P27.2)
//
// /api/readiness returns null score when there's not enough data yet
// (e.g. fresh install before HK has synced). UI must degrade gracefully —
// don't lie with a placeholder number.
//
// Phase 12 (2026-05-28) · added per-metric values (sleep7Avg, rhrCurrent,
// rhrBaseline, hrvCurrent, hrvBaseline, loadAcwr) so the Sibling
// MiniTiles can render real numbers + deltas instead of `—`. All
// optional — server emits null when no health data. Mirrors the
// glance-adapter.ts `bodyTiles()` field surface.
struct ReadinessSnapshot: Decodable {
    let score: Int?
    let band: String?
    let label: String?
    // Per-metric readiness inputs — additive in Phase 12. Used by
    // FaffAdapter.bodyTiles() to mirror glance-adapter.ts:384-443
    // (the SLEEP / RHR / HRV / LOAD MiniTile recipes).
    let sleep7Avg: Double?
    let rhrCurrent: Int?
    let rhrBaseline: Int?
    let hrvCurrent: Int?
    let hrvBaseline: Int?
    let loadAcwr: Double?
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
    // v3 chrome cutover (2026-05-28) — Phase 25b adds the shoes + zones +
    // nextARace slices the web /profile renders. All optional so older
    // server responses still decode. Empty fall-back is "—" in the UI.
    let shoes: [ProfileShoe]?
    let nextARace: ProfileNextRace?
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
    // v3 chrome cutover (2026-05-28) — Phase 25b adds the computed HR
    // zone table + LTHR-method provenance so the iPhone can render the
    // same 5-row Z1-Z5 anchor table the web /profile shows.
    let lthr_method: String?
    let zones: ProfileZoneTable?
}

/// Mirrors web's `ZoneTable` (lib/training/zones.ts). `method` is
/// "lthr-friel" when an LTHR exists, "pct-mhr" when only MaxHR is known.
struct ProfileZoneTable: Decodable {
    let method: String              // "lthr-friel" | "pct-mhr"
    let anchor: ProfileZoneAnchor
    let zones: [ProfileHRZone]
    let citation: String?
    let note: String?
}

struct ProfileZoneAnchor: Decodable {
    let label: String               // "LTHR" / "MaxHR"
    let bpm: Int
}

struct ProfileHRZone: Decodable, Identifiable {
    let idx: Int                    // 1 … 5
    let label: String               // "Recovery" / "Aerobic" / …
    let shortLabel: String          // "Z1" … "Z5"
    let lower: Int                  // bpm
    let upper: Int                  // bpm
    let purpose: String             // 1-line description
    var id: Int { idx }
}

/// One row in PROFILE's SHOE ROTATION section. Mirrors the per-shoe
/// shape web's loadProfileState returns (id, brand, model, mileage, cap,
/// pctUsed, retired). All optional so the wire format can grow without
/// breaking the decoder.
struct ProfileShoe: Decodable, Identifiable {
    let id: String
    let name: String?
    let brand: String?
    let model: String?
    let color: String?
    let mileage: Double?
    let cap: Double?
    let pctUsed: Double?
    let preferred: Bool?
    let retired: Bool?
}

/// `nextARace` slice from /api/profile/state — the upcoming A-race
/// the user is training for. Powers the "Training for …" line below
/// the page header.
struct ProfileNextRace: Decodable {
    let slug: String
    let name: String
    let date: String
    let goal: String?
    let days_to_race: Int
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
    /// ISO timestamp of the last run-adaptations cron pass. Drives the
    /// "Plan refreshed Xh ago" freshness line on the Train tab so the
    /// runner knows the plan is alive. Optional — null when the cron
    /// hasn't run yet for this plan. New 2026-05-30 audit.
    let last_adapted_at: String?
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

// MARK: - Prescription weather (2026-05-30 audit · "HOTTER THAN USUAL" tag)
//
// Tiny envelope around /api/prescription · we only decode the weather block.
// `deltaF` is positive when today is hotter than the 14-day baseline at the
// runner's typical lat/lon; negative when cooler. The iPhone surfaces the
// tag when |deltaF| >= 6 (Maughan curve calls 5°F the meaningful threshold).

struct PrescriptionWeatherEnvelope: Decodable {
    let weather_baseline: WeatherBaseline?
}

struct WeatherBaseline: Decodable {
    let tempF: Double?
    let baselineTempF: Double?
    let deltaF: Int?
}

// LearnArticle model lives in Models/Tips.swift — was the original P40
// home; extended with citations_json in the 2026-05-30 audit so the
// /api/learn/[slug] reader has the full payload to render.
