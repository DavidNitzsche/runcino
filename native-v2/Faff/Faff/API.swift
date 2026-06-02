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

/// Decodes from either a JSON number OR a JSON string. Backstop against
/// Postgres-NUMERIC drift · pg-node returns NUMERIC columns as strings to
/// preserve precision and most API routes don't coerce. A single un-cast
/// column (e.g. profile.height_cm) used to crash an entire response decode.
///
/// Use anywhere a column might come through as either. Read the value via
/// `.value` (Double?).
struct FlexibleDouble: Decodable {
    let value: Double?
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self.value = nil; return }
        if let d = try? c.decode(Double.self) { self.value = d; return }
        if let i = try? c.decode(Int.self)    { self.value = Double(i); return }
        if let s = try? c.decode(String.self) { self.value = Double(s); return }
        self.value = nil
    }
}

/// Sibling to FlexibleDouble for Int fields. The server emits HR / cadence /
/// elevation as JS numbers — Apple Watch and HK averaging produce fractional
/// values which are JSON-valid but throw `Int.self`. One throw inside a
/// nested Codable failed the whole parent array (the "no runs on iPhone"
/// failure mode). Every Int decode site that reads server data should use
/// this helper instead of `try c.decodeIfPresent(Int.self, ...)`.
extension KeyedDecodingContainer {
    /// Decode as Int, falling back to Double-rounded, returning nil for
    /// null/missing/type-mismatch. Mirrors the server's `Number(x) || null`.
    func decodeFlexInt(forKey key: Key) -> Int? {
        if let i = try? decode(Int.self, forKey: key) { return i }
        if let d = try? decode(Double.self, forKey: key), d.isFinite { return Int(d.rounded()) }
        return nil
    }
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

    // MARK: - Email + password (fallback while Apple flow is being fixed)

    struct EmailSignInResponse: Decodable {
        let ok: Bool
        let token: String?
        let expires_at: String?
        let user_uuid: String?
        let created: Bool?
        let error: String?
        /// Server emits "/today" for runners with onboarding_complete=true
        /// (returning users skip RolePick + Onboarding) and "/onboarding"
        /// for new sign-ups. The iPhone reads this to skip the post-signin
        /// gate when David signs back in.
        let redirect: String?
    }

    /// POST /api/auth/email · single endpoint that handles both signin
    /// (email exists with a password_hash) and signup (new email · name
    /// required). Same response shape as signInWithApple so TokenStore
    /// can persist the result with one helper. `name` is required only
    /// when the email isn't on file yet · the backend returns 404 in
    /// that case so the iPhone can re-prompt for it.
    static func signInWithEmail(email: String, password: String, name: String? = nil) async throws -> EmailSignInResponse {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/auth/email"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["email": email, "password": password]
        if let n = name, !n.isEmpty { body["name"] = n }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, _) = try await URLSession.shared.data(for: req)
        return try JSONDecoder().decode(EmailSignInResponse.self, from: data)
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
    // MARK: - Strava connection status

    struct StravaStatusResponse: Decodable {
        let state: String          // "connected" | "needs_reauth" | "disconnected"
        let last_push_at: String?
        let reason: String?        // populated when state != "connected"
    }

    /// GET /api/strava/status · drives the iPhone reconnect banner.
    /// Returns nil when the call fails so callers can hide the banner
    /// rather than nag with a false alarm.
    static func fetchStravaStatus() async throws -> StravaStatusResponse? {
        let url = baseURL.appendingPathComponent("api/strava/status")
        let (data, http): (Data, HTTPURLResponse) = try await API.authedGET(url)
        guard (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(StravaStatusResponse.self, from: data)
    }

    static func fetchStravaConnectURL() async throws -> URL? {
        // platform=ios tells the server to encode state with `:ios` so the
        // callback knows to 302 to faff://strava/callback (which
        // ASWebAuthenticationSession catches) instead of /today.
        var comps = URLComponents(
            url: baseURL.appendingPathComponent("api/auth/strava"),
            resolvingAgainstBaseURL: false
        )!
        comps.queryItems = [
            URLQueryItem(name: "action", value: "connect"),
            URLQueryItem(name: "platform", value: "ios"),
        ]
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

    // MARK: - Coach purpose + recap (2026-05-31)
    //
    // Backend doctrine: lib/coach/run-purpose.ts + lib/coach/run-recap.ts.
    // Both endpoints return the same shape · verdict + facts + citations,
    // plus conditions_note + coach_tip on the recap side. The deterministic
    // engine reads workout type + phase + execution + weather and produces
    // research-cited copy that the iPhone renders directly · no per-run
    // hand-crafted strings, the coach derives it.
    static func fetchTodayPurpose(date: String? = nil) async throws -> RunPurpose? {
        var comps = URLComponents(url: baseURL.appendingPathComponent("api/today/purpose"), resolvingAgainstBaseURL: false)!
        if let date { comps.queryItems = [URLQueryItem(name: "date", value: date)] }
        var req = URLRequest(url: comps.url!)
        req.httpMethod = "GET"
        let (data, http) = try await API.authedSend(req)
        guard (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(RunPurpose.self, from: data)
    }

    static func fetchRunRecap(runId: String) async throws -> RunRecap? {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/runs/\(runId)/recap"))
        req.httpMethod = "GET"
        let (data, http) = try await API.authedSend(req)
        guard (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(RunRecap.self, from: data)
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

    /// /api/readiness/brief · full envelope for the redesigned full
    /// readiness brief sheet. Drives ReadinessBriefSheet. Same composer
    /// (loadReadinessBrief) the web seed reads · iPhone + web stay in
    /// sync on numbers/copy/streaks/movers.
    ///
    /// Returns nil when the runner has no CoachState (brand-new user) ·
    /// the sheet renders its cold-start variant.
    static func fetchReadinessBrief() async throws -> ReadinessBriefSeed? {
        let url = baseURL.appendingPathComponent("api/readiness/brief")
        let (data, http): (Data, HTTPURLResponse) = try await API.authedGET(url)
        guard (200..<300).contains(http.statusCode) else { return nil }
        let envelope = try? JSONDecoder().decode(ReadinessBriefResponse.self, from: data)
        return envelope?.brief
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
    ///
    /// `raceSlug` scopes the facts to a single race (required by the
    /// `race_detail` surface). Backend treats the surface + slug as the
    /// composite key; without the slug the race_detail surface 400s and
    /// the AT A GLANCE block on RaceDayView never renders.
    static func fetchCoachFacts(surface: String, raceSlug: String? = nil) async throws -> CoachFactsBlock? {
        var comps = URLComponents(
            url: baseURL.appendingPathComponent("api/coach/facts"),
            resolvingAgainstBaseURL: false
        )!
        var items = [URLQueryItem(name: "surface", value: surface)]
        if let raceSlug, !raceSlug.isEmpty {
            items.append(URLQueryItem(name: "race", value: raceSlug))
        }
        comps.queryItems = items
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

    /// /api/targets/projection — VDOT + projection_sec + held_days + gap
    /// decomposition (Fitness / Conditions / Course / Execution) for the
    /// redesigned Targets surface. Cold path (no VDOT yet / no goal race)
    /// returns ok=true with nulls; the panel renders the cold state.
    ///
    /// distanceMi defaults to half-marathon (13.1) since that's the most
    /// common active-goal distance · the panel can re-fetch when the
    /// runner pivots to a different race.
    static func fetchTargetsProjection(distanceMi: Double = 13.1, raceSlug: String? = nil) async throws -> ProjectionSummary? {
        var comps = URLComponents(url: baseURL.appendingPathComponent("api/targets/projection"), resolvingAgainstBaseURL: false)!
        var qi = [URLQueryItem(name: "distance_mi", value: String(distanceMi))]
        if let s = raceSlug { qi.append(URLQueryItem(name: "race_slug", value: s)) }
        comps.queryItems = qi
        let (data, http): (Data, HTTPURLResponse) = try await API.authedGET(comps.url!)
        guard (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(ProjectionSummary.self, from: data)
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

    // Lenient decode · per doctrine 2026-05-31. Server has shipped
    // partial PlanWeek payloads during plan-regen windows · today_iso
    // briefly null, days array missing. Strict decode would nuke the
    // whole Today week strip; defensive defaults keep it rendering.
    enum CodingKeys: String, CodingKey {
        case plan_id, week_start_iso, week_end_iso, today_iso, days, message
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.plan_id = try c.decodeIfPresent(String.self, forKey: .plan_id)
        self.week_start_iso = try c.decodeIfPresent(String.self, forKey: .week_start_iso)
        self.week_end_iso = try c.decodeIfPresent(String.self, forKey: .week_end_iso)
        self.today_iso = try c.decodeIfPresent(String.self, forKey: .today_iso) ?? ""
        self.days = (try? c.decode([PlanDay].self, forKey: .days)) ?? []
        self.message = try c.decodeIfPresent(String.self, forKey: .message)
    }
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
    let completedRunId: String?
    let done_mi: Double?
    let skipped: Bool?

    // Lenient decode · doctrine 2026-05-31. Server has emitted partial
    // PlanDay rows (null type / distance_mi) during plan-regen windows;
    // strict decode would drop the ENTIRE PlanWeek.days array via the
    // throwing array decoder. View code reads non-optionals directly,
    // so we default them safely here.
    enum CodingKeys: String, CodingKey {
        case date_iso, dow, type, distance_mi, sub_label, is_today, is_past
        case completedRunId, done_mi, skipped
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.date_iso = try c.decodeIfPresent(String.self, forKey: .date_iso) ?? ""
        self.dow = c.decodeFlexInt(forKey: .dow) ?? 0
        self.type = try c.decodeIfPresent(String.self, forKey: .type) ?? "rest"
        self.distance_mi = try c.decodeIfPresent(Double.self, forKey: .distance_mi) ?? 0
        self.sub_label = try c.decodeIfPresent(String.self, forKey: .sub_label)
        self.is_today = try c.decodeIfPresent(Bool.self, forKey: .is_today) ?? false
        self.is_past = try c.decodeIfPresent(Bool.self, forKey: .is_past) ?? false
        self.completedRunId = try c.decodeIfPresent(String.self, forKey: .completedRunId)
        self.done_mi = try c.decodeIfPresent(Double.self, forKey: .done_mi)
        self.skipped = try c.decodeIfPresent(Bool.self, forKey: .skipped)
    }
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
    /// Rich breakdown emitted by /api/readiness · one row per input metric
    /// (sleep / hrv / rhr / load / rpe) with weight + plain-English meaning.
    /// Powers NudgeSheet's "WHY" + "COACH" sections so the Morning Check
    /// stops rendering placeholder values. Added 2026-05-31.
    let inputs: [ReadinessInput]?
}

/// One contribution to the readiness score · mirrors ReadinessBreakdown
/// row shape from lib/coach/readiness.ts. `weight` is the contribution to
/// the score (negative = dragged it down, positive = lifted it). `meaning`
/// is the runner-facing reason phrased as plain coach voice.
///
/// Lenient decode (doctrine 2026-05-31) · this is the bug class that
/// emptied NudgeSheet's WHY rows earlier. The 2026-05-30 fix made
/// `inputs` optional on ReadinessSnapshot; this completes the layer by
/// making every individual row decode tolerant too. A single missing
/// `key` or `meaning` field used to drop the entire ReadinessSnapshot.
struct ReadinessInput: Decodable, Identifiable, Hashable {
    let key: String          // "sleep" / "hrv" / "rhr" / "load" / "rpe"
    let label: String        // "SLEEP · 28%" (already capped + weighted)
    let observedV: String?   // "5.8h · 7-night avg"
    let observedSub: String? // "-1.7h vs 7.5h target"
    let weight: Int          // -14, +6, etc · sign indicates direction
    let meaning: String      // one-liner the runner sees on tap
    var id: String { key }

    enum CodingKeys: String, CodingKey {
        case key, label, observedV, observedSub, weight, meaning
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.key = try c.decodeIfPresent(String.self, forKey: .key) ?? ""
        self.label = try c.decodeIfPresent(String.self, forKey: .label) ?? ""
        self.observedV = try c.decodeIfPresent(String.self, forKey: .observedV)
        self.observedSub = try c.decodeIfPresent(String.self, forKey: .observedSub)
        self.weight = c.decodeFlexInt(forKey: .weight) ?? 0
        self.meaning = try c.decodeIfPresent(String.self, forKey: .meaning) ?? ""
    }
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
    // FlexibleDouble · Postgres NUMERIC column comes through as a string
    // from pg-node. Crashes the whole ProfileFields decode if we expect
    // Double. Read via `heightCm` accessor below.
    let height_cm: FlexibleDouble?
    var heightCm: Double? { height_cm?.value }
    let gender: String?
    let experience_level: String?
    let birthday: String?
    let cross_training_modes: [String]?
    let strava_connected_at: String?
    let health_connected_at: String?
    let onboarded_at: String?
    /// `var` (not `let`) so ProfileView can flip these via the
    /// NotificationPrefsList toggle bindings · the PATCH back to
    /// /api/profile lives at the call site.
    var strava_auto_push: Bool?
    var phone_hr_alerts: Bool?
}

// MARK: - ProfileState (full /profile rendering)
//
// Mirrors web-v2/lib/coach/profile-state.ts → trimmed to identity +
// physiology + connections. Other slices (shoes, nextARace, prefs)
// have their own dedicated endpoints. Replaces the hardcoded "David
// Nitzsche / MALE · 40 · LOS ANGELES" + "181 bpm" string literals
// that lived in ProfileView.swift.

// Lenient decoder (doctrine 2026-05-31 round 2). Same risk pattern as
// LogState: a sub-field null in any required slice (identity / physiology /
// connections) used to throw and drop the entire ProfileState · all 5
// page-header avatars + the profile screen + the targets/train tiles
// would have gone blank. Each slice now decodes via `try? ... ?? empty`
// so a partial response degrades gracefully.
struct ProfileState: Decodable {
    let identity: ProfileIdentity
    let physiology: ProfilePhysiology
    let connections: ProfileConnections
    let shoes: [ProfileShoe]?
    let nextARace: ProfileNextRace?

    enum CodingKeys: String, CodingKey {
        case identity, physiology, connections, shoes, nextARace
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.identity = (try? c.decode(ProfileIdentity.self, forKey: .identity)) ?? .empty
        self.physiology = (try? c.decode(ProfilePhysiology.self, forKey: .physiology)) ?? .empty
        self.connections = (try? c.decode(ProfileConnections.self, forKey: .connections)) ?? .empty
        self.shoes = try? c.decode([ProfileShoe].self, forKey: .shoes)
        self.nextARace = try? c.decode(ProfileNextRace.self, forKey: .nextARace)
    }
}

struct ProfileIdentity: Decodable {
    let full_name: String?
    let sex: String?
    let birthday: String?
    let age: Int?
    let city: String?
    // FlexibleDouble · backstop against Postgres NUMERIC strings. A naked
    // `Double?` here used to throw on the JSON `"185.0"` payload that
    // /api/profile/state was emitting · the whole ProfileState decode
    // would fail (silent · inside try?) and EVERY iPhone view that reads
    // profile.identity (TodayView avatar · ActivityView · ProfileView ·
    // TargetsView · TrainView · 5 surfaces) would lose its data. Fixed
    // 2026-05-31.
    let height_cm: FlexibleDouble?
    var heightCm: Double? { height_cm?.value }
    let experience_level: String?

    /// Empty fallback used by ProfileState when the wire emits a malformed
    /// identity block (rare · pre-onboarding rows or migration windows).
    static let empty = ProfileIdentity(
        full_name: nil, sex: nil, birthday: nil, age: nil, city: nil,
        height_cm: nil, experience_level: nil
    )

    init(full_name: String?, sex: String?, birthday: String?, age: Int?,
         city: String?, height_cm: FlexibleDouble?, experience_level: String?) {
        self.full_name = full_name; self.sex = sex; self.birthday = birthday
        self.age = age; self.city = city
        self.height_cm = height_cm; self.experience_level = experience_level
    }

    enum CodingKeys: String, CodingKey {
        case full_name, sex, birthday, age, city, height_cm, experience_level
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.full_name = try c.decodeIfPresent(String.self, forKey: .full_name)
        self.sex = try c.decodeIfPresent(String.self, forKey: .sex)
        self.birthday = try c.decodeIfPresent(String.self, forKey: .birthday)
        self.age = c.decodeFlexInt(forKey: .age)
        self.city = try c.decodeIfPresent(String.self, forKey: .city)
        self.height_cm = try c.decodeIfPresent(FlexibleDouble.self, forKey: .height_cm)
        self.experience_level = try c.decodeIfPresent(String.self, forKey: .experience_level)
    }

    /// Single source of truth for the page-header avatar (5 views call it).
    /// Was duplicated across TodayView · ActivityView · TargetsView ·
    /// TrainView · ProfileView and EVERY copy fell back to the first
    /// letter of `city` when `full_name` was nil · David has city =
    /// "Los Angeles" and full_name = null so every header rendered "L"
    /// as if his name was Larry. City-first-letter is a meaningless
    /// identity proxy · fall back to empty (gradient pill renders
    /// clean) instead of inventing an initial. (2026-05-31)
    var avatarInitials: String {
        guard let n = full_name?.trimmingCharacters(in: .whitespaces), !n.isEmpty else {
            return ""
        }
        let parts = n.split(separator: " ")
        let first = parts.first.map(String.init)?.prefix(1) ?? ""
        let last  = parts.count > 1 ? String(parts.last!).prefix(1) : ""
        return (String(first) + String(last)).uppercased()
    }
}

struct ProfilePhysiology: Decodable {
    let max_hr: Int?
    let max_hr_source: String?     // 'observed' / 'lthr-derived' / 'formula' / 'manual'
    let rhr: Int?
    // FlexibleDouble backstop · Postgres NUMERIC-as-string risk applies to
    // every float-shaped physiology field. Today /api/profile/state returns
    // vo2 / weight_lb / vdot as proper numbers (verified prod 2026-05-31)
    // but the iPhone shouldn't crash if a future migration changes that.
    // Public `var vo2 / weight_lb / vdot` accessors below preserve the
    // existing Double? API every view already reads.
    private let _vo2: FlexibleDouble?
    private let _weight_lb: FlexibleDouble?
    private let _vdot: FlexibleDouble?
    var vo2: Double?       { _vo2?.value }
    var weight_lb: Double? { _weight_lb?.value }
    var vdot: Double?      { _vdot?.value }
    let lthr: Int?
    // v3 chrome cutover (2026-05-28) — Phase 25b adds the computed HR
    // zone table + LTHR-method provenance so the iPhone can render the
    // same 5-row Z1-Z5 anchor table the web /profile shows.
    let lthr_method: String?
    let zones: ProfileZoneTable?

    /// Empty fallback used by ProfileState when the wire emits a malformed
    /// physiology block. Every field is already optional · the explicit
    /// init keeps the parent ProfileState init mirror-symmetric with
    /// identity/connections.
    static let empty = ProfilePhysiology(
        max_hr: nil, max_hr_source: nil, rhr: nil,
        _vo2: nil, _weight_lb: nil, _vdot: nil,
        lthr: nil, lthr_method: nil, zones: nil
    )
    private init(max_hr: Int?, max_hr_source: String?, rhr: Int?,
                 _vo2: FlexibleDouble?, _weight_lb: FlexibleDouble?, _vdot: FlexibleDouble?,
                 lthr: Int?, lthr_method: String?, zones: ProfileZoneTable?) {
        self.max_hr = max_hr; self.max_hr_source = max_hr_source; self.rhr = rhr
        self._vo2 = _vo2; self._weight_lb = _weight_lb; self._vdot = _vdot
        self.lthr = lthr; self.lthr_method = lthr_method; self.zones = zones
    }

    enum CodingKeys: String, CodingKey {
        case max_hr, max_hr_source, rhr
        case _vo2 = "vo2"
        case _weight_lb = "weight_lb"
        case _vdot = "vdot"
        case lthr, lthr_method, zones
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.max_hr = c.decodeFlexInt(forKey: .max_hr)
        self.max_hr_source = try c.decodeIfPresent(String.self, forKey: .max_hr_source)
        self.rhr = c.decodeFlexInt(forKey: .rhr)
        self._vo2 = try c.decodeIfPresent(FlexibleDouble.self, forKey: ._vo2)
        self._weight_lb = try c.decodeIfPresent(FlexibleDouble.self, forKey: ._weight_lb)
        self._vdot = try c.decodeIfPresent(FlexibleDouble.self, forKey: ._vdot)
        self.lthr = c.decodeFlexInt(forKey: .lthr)
        self.lthr_method = try c.decodeIfPresent(String.self, forKey: .lthr_method)
        self.zones = try? c.decode(ProfileZoneTable.self, forKey: .zones)
    }
}

/// Mirrors web's `ZoneTable` (lib/training/zones.ts). `method` is
/// "lthr-friel" when an LTHR exists, "pct-mhr" when only MaxHR is known.
struct ProfileZoneTable: Decodable {
    let method: String              // "lthr-friel" | "pct-mhr"
    let anchor: ProfileZoneAnchor
    let zones: [ProfileHRZone]
    let citation: String?
    let note: String?

    enum CodingKeys: String, CodingKey { case method, anchor, zones, citation, note }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.method = try c.decodeIfPresent(String.self, forKey: .method) ?? ""
        self.anchor = (try? c.decode(ProfileZoneAnchor.self, forKey: .anchor))
            ?? ProfileZoneAnchor(label: "", bpm: 0)
        self.zones = (try? c.decode([ProfileHRZone].self, forKey: .zones)) ?? []
        self.citation = try c.decodeIfPresent(String.self, forKey: .citation)
        self.note = try c.decodeIfPresent(String.self, forKey: .note)
    }
}

struct ProfileZoneAnchor: Decodable {
    let label: String               // "LTHR" / "MaxHR"
    let bpm: Int

    init(label: String, bpm: Int) { self.label = label; self.bpm = bpm }

    enum CodingKeys: String, CodingKey { case label, bpm }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.label = try c.decodeIfPresent(String.self, forKey: .label) ?? ""
        self.bpm = c.decodeFlexInt(forKey: .bpm) ?? 0
    }
}

struct ProfileHRZone: Decodable, Identifiable {
    let idx: Int                    // 1 … 5
    let label: String               // "Recovery" / "Aerobic" / …
    let shortLabel: String          // "Z1" … "Z5"
    let lower: Int                  // bpm
    let upper: Int                  // bpm
    let purpose: String             // 1-line description
    var id: Int { idx }

    enum CodingKeys: String, CodingKey { case idx, label, shortLabel, lower, upper, purpose }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.idx = c.decodeFlexInt(forKey: .idx) ?? 0
        self.label = try c.decodeIfPresent(String.self, forKey: .label) ?? ""
        self.shortLabel = try c.decodeIfPresent(String.self, forKey: .shortLabel) ?? ""
        self.lower = c.decodeFlexInt(forKey: .lower) ?? 0
        self.upper = c.decodeFlexInt(forKey: .upper) ?? 0
        self.purpose = try c.decodeIfPresent(String.self, forKey: .purpose) ?? ""
    }
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

    enum CodingKeys: String, CodingKey {
        case id, name, brand, model, color, mileage, cap, pctUsed, preferred, retired
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        self.name = try c.decodeIfPresent(String.self, forKey: .name)
        self.brand = try c.decodeIfPresent(String.self, forKey: .brand)
        self.model = try c.decodeIfPresent(String.self, forKey: .model)
        self.color = try c.decodeIfPresent(String.self, forKey: .color)
        self.mileage = try c.decodeIfPresent(Double.self, forKey: .mileage)
        self.cap = try c.decodeIfPresent(Double.self, forKey: .cap)
        self.pctUsed = try c.decodeIfPresent(Double.self, forKey: .pctUsed)
        self.preferred = try c.decodeIfPresent(Bool.self, forKey: .preferred)
        self.retired = try c.decodeIfPresent(Bool.self, forKey: .retired)
    }
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

    enum CodingKeys: String, CodingKey { case slug, name, date, goal, days_to_race }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.slug = try c.decodeIfPresent(String.self, forKey: .slug) ?? ""
        self.name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        self.date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        self.goal = try c.decodeIfPresent(String.self, forKey: .goal)
        self.days_to_race = c.decodeFlexInt(forKey: .days_to_race) ?? 0
    }
}

struct ProfileConnections: Decodable {
    let strava: ProfileConnectionState
    let appleHealth: ProfileConnectionState
    let appleWatch: ProfileConnectionState

    static let empty = ProfileConnections(
        strava: .empty, appleHealth: .empty, appleWatch: .empty
    )
    init(strava: ProfileConnectionState,
         appleHealth: ProfileConnectionState,
         appleWatch: ProfileConnectionState) {
        self.strava = strava; self.appleHealth = appleHealth; self.appleWatch = appleWatch
    }

    enum CodingKeys: String, CodingKey { case strava, appleHealth, appleWatch }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.strava = (try? c.decode(ProfileConnectionState.self, forKey: .strava)) ?? .empty
        self.appleHealth = (try? c.decode(ProfileConnectionState.self, forKey: .appleHealth)) ?? .empty
        self.appleWatch = (try? c.decode(ProfileConnectionState.self, forKey: .appleWatch)) ?? .empty
    }
}

struct ProfileConnectionState: Decodable {
    let connected: Bool
    let lastSync: String?
    let note: String

    /// Empty fallback · used when parent ProfileConnections decode skips a
    /// per-source row · the connection-row UI reads `connected` (false)
    /// + empty `note` and renders the "not connected" CTA cleanly.
    static let empty = ProfileConnectionState(connected: false, lastSync: nil, note: "")
    init(connected: Bool, lastSync: String?, note: String) {
        self.connected = connected; self.lastSync = lastSync; self.note = note
    }

    enum CodingKeys: String, CodingKey { case connected, lastSync, note }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.connected = try c.decodeIfPresent(Bool.self, forKey: .connected) ?? false
        self.lastSync = try c.decodeIfPresent(String.self, forKey: .lastSync)
        self.note = try c.decodeIfPresent(String.self, forKey: .note) ?? ""
    }
}

// MARK: - TrainingState (iPhone /training)
//
// Mirrors web-v2/lib/coach/training-state.ts. Powers the multi-week
// plan arc, phase strip, and week-ahead detail. The TypeScript shape
// already includes a `PlanWeek` interface, distinct from our wire
// model in API.swift — we name ours `TrainingPlanWeek` here to avoid
// colliding with the simpler PlanWeek (Mon-Sun day strip) used by
// /api/plan/week + WeekStripView.

// Lenient decoder (doctrine 2026-05-31 round 2). TrainingState was strict;
// a single missing/null `today` or per-week `phase` field would have
// dropped the whole TrainingState · the Train tab and the season-arc
// bars + phase headline + this-week panel all read off this. Same fix
// shape as LogState/ProfileState.
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
    let last_adapted_at: String?

    enum CodingKeys: String, CodingKey {
        case plan_id, today, race, phases, weeks, currentPhase, currentWeekIdx
        case nextQuality, weekDone, weekPlanned, last_adapted_at
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.plan_id = try c.decodeIfPresent(String.self, forKey: .plan_id)
        self.today = try c.decodeIfPresent(String.self, forKey: .today) ?? ""
        self.race = try? c.decode(TrainingRace.self, forKey: .race)
        self.phases = (try? c.decode([TrainingPlanPhase].self, forKey: .phases)) ?? []
        self.weeks = (try? c.decode([TrainingPlanWeek].self, forKey: .weeks)) ?? []
        self.currentPhase = try c.decodeIfPresent(String.self, forKey: .currentPhase)
        self.currentWeekIdx = c.decodeFlexInt(forKey: .currentWeekIdx)
        self.nextQuality = try? c.decode(TrainingNextQuality.self, forKey: .nextQuality)
        self.weekDone = try c.decodeIfPresent(Double.self, forKey: .weekDone) ?? 0
        self.weekPlanned = try c.decodeIfPresent(Double.self, forKey: .weekPlanned)
        self.last_adapted_at = try c.decodeIfPresent(String.self, forKey: .last_adapted_at)
    }
}

struct TrainingRace: Decodable {
    let slug: String
    let name: String
    let date: String
    let goal: String?
    let days_to_race: Int

    enum CodingKeys: String, CodingKey { case slug, name, date, goal, days_to_race }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.slug = try c.decodeIfPresent(String.self, forKey: .slug) ?? ""
        self.name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        self.date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        self.goal = try c.decodeIfPresent(String.self, forKey: .goal)
        self.days_to_race = c.decodeFlexInt(forKey: .days_to_race) ?? 0
    }
}

struct TrainingPlanPhase: Decodable, Identifiable {
    let label: String
    let startWeekIdx: Int
    let endWeekIdx: Int
    var id: String { "\(label)|\(startWeekIdx)-\(endWeekIdx)" }

    enum CodingKeys: String, CodingKey { case label, startWeekIdx, endWeekIdx }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.label = try c.decodeIfPresent(String.self, forKey: .label) ?? ""
        self.startWeekIdx = c.decodeFlexInt(forKey: .startWeekIdx) ?? 0
        self.endWeekIdx = c.decodeFlexInt(forKey: .endWeekIdx) ?? 0
    }
}

struct TrainingPlanWeek: Decodable, Identifiable {
    let idx: Int
    let phase: String
    let startDate: String
    let plannedMi: Double
    let days: [TrainingPlanDay]
    let isCurrent: Bool
    var id: Int { idx }

    enum CodingKeys: String, CodingKey { case idx, phase, startDate, plannedMi, days, isCurrent }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.idx = c.decodeFlexInt(forKey: .idx) ?? 0
        self.phase = try c.decodeIfPresent(String.self, forKey: .phase) ?? ""
        self.startDate = try c.decodeIfPresent(String.self, forKey: .startDate) ?? ""
        self.plannedMi = try c.decodeIfPresent(Double.self, forKey: .plannedMi) ?? 0
        self.days = (try? c.decode([TrainingPlanDay].self, forKey: .days)) ?? []
        self.isCurrent = try c.decodeIfPresent(Bool.self, forKey: .isCurrent) ?? false
    }
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

    enum CodingKeys: String, CodingKey { case date, dow, type, mi, label, doneMi, activityId }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        self.dow = c.decodeFlexInt(forKey: .dow) ?? 0
        self.type = try c.decodeIfPresent(String.self, forKey: .type) ?? "rest"
        self.mi = try c.decodeIfPresent(Double.self, forKey: .mi) ?? 0
        self.label = try c.decodeIfPresent(String.self, forKey: .label)
        self.doneMi = try c.decodeIfPresent(Double.self, forKey: .doneMi) ?? 0
        self.activityId = try c.decodeIfPresent(String.self, forKey: .activityId)
    }
}

struct TrainingNextQuality: Decodable {
    let date: String
    let dow: Int
    let type: String
    let label: String?
    let mi: Double

    enum CodingKeys: String, CodingKey { case date, dow, type, label, mi }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        self.dow = c.decodeFlexInt(forKey: .dow) ?? 0
        self.type = try c.decodeIfPresent(String.self, forKey: .type) ?? "rest"
        self.label = try c.decodeIfPresent(String.self, forKey: .label)
        self.mi = try c.decodeIfPresent(Double.self, forKey: .mi) ?? 0
    }
}

// MARK: - HealthState (iPhone /health)
//
// Mirrors web-v2/lib/coach/health-state.ts. 30-day daily series for
// each metric so the iPhone can draw a sparkline next to the current
// value + delta, plus a summary block.
//
// Lenient decoder (doctrine 2026-05-31 round 2). A single null on any
// HealthDay row used to throw, cascade up through `[HealthDayBpm]`, and
// drop the whole HealthState · the Health tab would render as empty
// even though /api/health returned 200 with most metrics present.

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

    enum CodingKeys: String, CodingKey {
        case today, sleepSeries, rhrSeries, hrvSeries, weightSeries
        case sleep, rhr, hrv, weight, cadence, vo2, watchMode, watchItems
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.today = try c.decodeIfPresent(String.self, forKey: .today) ?? ""
        self.sleepSeries = (try? c.decode([HealthDayHours].self, forKey: .sleepSeries)) ?? []
        self.rhrSeries = (try? c.decode([HealthDayBpm].self, forKey: .rhrSeries)) ?? []
        self.hrvSeries = (try? c.decode([HealthDayMs].self, forKey: .hrvSeries)) ?? []
        self.weightSeries = (try? c.decode([HealthDayLb].self, forKey: .weightSeries)) ?? []
        self.sleep = (try? c.decode(SleepSummary.self, forKey: .sleep))
            ?? SleepSummary(avg7n: nil, avg30n: nil, deficit7: 0)
        self.rhr = (try? c.decode(RhrSummary.self, forKey: .rhr))
            ?? RhrSummary(current: nil, baseline: nil, delta: nil)
        self.hrv = (try? c.decode(HrvSummary.self, forKey: .hrv))
            ?? HrvSummary(current: nil, baseline: nil, pctAboveBaseline: nil)
        self.weight = (try? c.decode(WeightSummary.self, forKey: .weight))
            ?? WeightSummary(current: nil, delta30: nil)
        self.cadence = (try? c.decode(CadenceSummary.self, forKey: .cadence))
            ?? CadenceSummary(baseline: nil)
        self.vo2 = (try? c.decode(Vo2Summary.self, forKey: .vo2))
            ?? Vo2Summary(current: nil)
        self.watchMode = try c.decodeIfPresent(String.self, forKey: .watchMode) ?? "steady"
        self.watchItems = (try? c.decode([WatchItem].self, forKey: .watchItems)) ?? []
    }
}

struct HealthDayHours: Decodable {
    let date: String; let hours: Double
    enum CodingKeys: String, CodingKey { case date, hours }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        self.hours = try c.decodeIfPresent(Double.self, forKey: .hours) ?? 0
    }
}
struct HealthDayBpm: Decodable {
    let date: String; let bpm: Int
    enum CodingKeys: String, CodingKey { case date, bpm }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        self.bpm = c.decodeFlexInt(forKey: .bpm) ?? 0
    }
}
struct HealthDayMs: Decodable {
    let date: String; let ms: Int
    enum CodingKeys: String, CodingKey { case date, ms }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        self.ms = c.decodeFlexInt(forKey: .ms) ?? 0
    }
}
struct HealthDayLb: Decodable {
    let date: String; let lb: Double
    enum CodingKeys: String, CodingKey { case date, lb }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        self.lb = try c.decodeIfPresent(Double.self, forKey: .lb) ?? 0
    }
}

struct SleepSummary: Decodable {
    let avg7n: Double?; let avg30n: Double?; let deficit7: Double
    init(avg7n: Double?, avg30n: Double?, deficit7: Double) {
        self.avg7n = avg7n; self.avg30n = avg30n; self.deficit7 = deficit7
    }
    enum CodingKeys: String, CodingKey { case avg7n, avg30n, deficit7 }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.avg7n = try c.decodeIfPresent(Double.self, forKey: .avg7n)
        self.avg30n = try c.decodeIfPresent(Double.self, forKey: .avg30n)
        self.deficit7 = try c.decodeIfPresent(Double.self, forKey: .deficit7) ?? 0
    }
}
struct RhrSummary: Decodable {
    let current: Int?; let baseline: Int?; let delta: Int?
    init(current: Int?, baseline: Int?, delta: Int?) {
        self.current = current; self.baseline = baseline; self.delta = delta
    }
    enum CodingKeys: String, CodingKey { case current, baseline, delta }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.current = c.decodeFlexInt(forKey: .current)
        self.baseline = c.decodeFlexInt(forKey: .baseline)
        self.delta = c.decodeFlexInt(forKey: .delta)
    }
}
struct HrvSummary: Decodable {
    let current: Int?; let baseline: Int?; let pctAboveBaseline: Double?
    init(current: Int?, baseline: Int?, pctAboveBaseline: Double?) {
        self.current = current; self.baseline = baseline; self.pctAboveBaseline = pctAboveBaseline
    }
    enum CodingKeys: String, CodingKey { case current, baseline, pctAboveBaseline }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.current = c.decodeFlexInt(forKey: .current)
        self.baseline = c.decodeFlexInt(forKey: .baseline)
        self.pctAboveBaseline = try c.decodeIfPresent(Double.self, forKey: .pctAboveBaseline)
    }
}
struct WeightSummary: Decodable {
    let current: Double?; let delta30: Double?
    init(current: Double?, delta30: Double?) { self.current = current; self.delta30 = delta30 }
    enum CodingKeys: String, CodingKey { case current, delta30 }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.current = try c.decodeIfPresent(Double.self, forKey: .current)
        self.delta30 = try c.decodeIfPresent(Double.self, forKey: .delta30)
    }
}
struct CadenceSummary: Decodable {
    let baseline: Int?
    init(baseline: Int?) { self.baseline = baseline }
    enum CodingKeys: String, CodingKey { case baseline }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.baseline = c.decodeFlexInt(forKey: .baseline)
    }
}
struct Vo2Summary: Decodable {
    let current: Double?
    init(current: Double?) { self.current = current }
    enum CodingKeys: String, CodingKey { case current }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.current = try c.decodeIfPresent(Double.self, forKey: .current)
    }
}

struct WatchItem: Decodable, Identifiable {
    let label: String
    let status: String      // 'amber' / 'red'
    let note: String
    var id: String { label + status }

    enum CodingKeys: String, CodingKey { case label, status, note }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.label = try c.decodeIfPresent(String.self, forKey: .label) ?? ""
        self.status = try c.decodeIfPresent(String.self, forKey: .status) ?? "amber"
        self.note = try c.decodeIfPresent(String.self, forKey: .note) ?? ""
    }
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

// MARK: - Forecast (2026-06-02 round 15 · design pkg #3 follow-up)
//
// Per web agent's brief (backend-followup-active-energy-no-toast-needed
// neighbor): /api/forecast/<YYYY-MM-DD> returns display-ready strings
// (range_label, best_window) the iPhone renders directly. No client-
// side derivation · the server composes so iPhone / web / future watch
// surfaces all read identical copy. Separate from WeatherBaseline
// which is the temp-delta engine context (intentionally narrow).

struct DailyForecast: Decodable {
    let date: String
    let temp_min_f: Double?
    let temp_max_f: Double?
    let conditions: String?
    let precip_chance_pct: Double?
    let wind_mph: Double?
    let source: String?
    /// Pre-composed range string · "60-78° · Cloudy". Render directly.
    let range_label: String?
    /// Pre-composed best-window string · "Before 7 AM" / "6-8 AM" /
    /// "6-9 AM". Render directly.
    let best_window: String?
}

extension API {
    /// Fetch the daily forecast for a given date · returns nil on 404
    /// (no GPS-anchored home base yet, or date outside the ~16-day
    /// Open-Meteo window). 30-min cache + SWR upstream.
    static func fetchDailyForecast(date: String) async throws -> DailyForecast? {
        let url = baseURL.appendingPathComponent("api/forecast/\(date)")
        let (data, http): (Data, HTTPURLResponse) = try await API.authedGET(url)
        guard (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(DailyForecast.self, from: data)
    }
}

// LearnArticle model lives in Models/Tips.swift — was the original P40
// home; extended with citations_json in the 2026-05-30 audit so the
// /api/learn/[slug] reader has the full payload to render.
