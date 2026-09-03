//
//  PhoneSync.swift
//  FaffWatch
//
//  Watch side of the iPhone↔watch bridge (WatchConnectivity).
//
//  The workout "is just there": on launch we read the latest
//  application context the iPhone already delivered, AND — if the
//  iPhone is reachable — ask it directly for today's workout. Either
//  path populates `todayWorkout` with no user action.
//
//  When a workout finishes, `sendCompletion` queues the result back to
//  the iPhone via transferUserInfo (reliable, survives the iPhone being
//  briefly unreachable); the iPhone POSTs it to the backend.
//

import Foundation
import Combine
import WatchConnectivity

@MainActor
final class PhoneSync: NSObject, ObservableObject {
    static let shared = PhoneSync()

    /// Today's workout, once received from the iPhone. nil until synced.
    @Published private(set) var todayWorkout: WatchWorkout?
    /// The §G readiness read — pushed alongside the workout, available any day.
    @Published private(set) var readiness: WatchReadiness?
    /// Set instead of `todayWorkout` on rest/race/no-plan days.
    @Published private(set) var noWorkoutMessage: String?

    /// The 0821 lobby glance — `weekStrip` / `sessionMoved` / `dayState`, the
    /// three OPTIONAL objects `GET /api/watch/today` carries on BOTH branches
    /// of its response (web-v2/lib/watch/build-workout.ts).
    ///
    /// One published container rather than three published fields: they are
    /// one read of one day and a router that saw two of them updated and the
    /// third not would be drawing half of yesterday. The three accessors
    /// below reach into it, so `phone.dayState` reads the same either way.
    ///
    /// PERSISTENCE. Nothing new is stored for these. They ride the SAME
    /// WatchConnectivity application context the workout rides, and
    /// WatchConnectivity persists the last received context across app
    /// launches — which is what `activate()`'s
    /// `apply(session.receivedApplicationContext)` has always been reading.
    /// An offline watch therefore has the glance on exactly the terms it has
    /// the workout: whatever the phone last delivered, until it delivers
    /// another. Adding a second shelf for it would be a second answer to a
    /// question that already has one.
    @Published private(set) var todayGlance: WatchTodayGlance?

    /// The lobby's "This week" page. nil until a glance-carrying payload lands.
    var weekStrip: WatchWeekStrip? { todayGlance?.weekStrip }
    /// "The session already moved" — the coach's one line, never a score.
    var sessionMoved: WatchSessionMoved? { todayGlance?.sessionMoved }
    /// The structured empty state (rest · no-session). The flat
    /// `noWorkoutMessage` still rides beside it and is still the fallback.
    var dayState: WatchDayState? { todayGlance?.dayState }
    /// Today's session, already run — the lobby's post-run recap. Rides
    /// beside `todayWorkout`, never replaces it.
    var completedToday: WatchCompletedRun? { todayGlance?.completedToday }
    /// True once we've received any context (so the UI can distinguish
    /// "nothing yet" from "synced, but no workout today").
    @Published private(set) var hasSynced: Bool = false
    /// Last sync failure, for the lobby to read (M-13 hardening). Set when
    /// a workout payload arrives but fails to decode (the watch keeps the
    /// previous workout — that must not be 100% silent anymore) and when a
    /// direct request to the phone errors. Cleared on the next good decode.
    @Published private(set) var lastSyncError: String?

    /// Completion upload status — the SummaryView status line (W-7) binds to
    /// this after a run finishes to show "Sending…", "Sent", or a failure hint.
    enum SyncState: Equatable {
        case idle, sending, sent
        case failed(String)
    }
    @Published private(set) var syncState: SyncState = .idle
    // `staleWorkout` DELETED (2026-08-23). It had no callers and was broken in
    // the same way RK-2 was: a default ISO8601DateFormatter cannot parse the
    // server's fractional seconds, so it always returned false. A staleness
    // check that always says "fresh" is worse than none — use
    // `WatchWorkout.isExpired`, which routes through parseExpiry.

    private override init() { super.init() }

    // MARK: Direct-to-backend writeback (independent of the iPhone bridge)
    //
    // The PRIMARY path for a finished workout is transferUserInfo → iPhone →
    // backend. But that bridge is fragile (the iPhone may be off, the app
    // killed, the WCSession queue stalled — that's how a recorded run once
    // vanished). So the watch ALSO posts the completion straight to the
    // backend itself, whenever it has a network and an auth token the iPhone
    // shared with it. The backend keys on workoutId/start-minute and is fully
    // idempotent, so a run arriving by BOTH paths is de-duped to one row.

    private let tokenKey = "faff.watch.authToken.v1"
    private let pendingKey = "faff.watch.pendingDirect.v1"

    /// Background URLSession identifier. A background session lets watchOS run
    /// the POST out-of-process, so a completion uploaded as the runner taps
    /// Done survives the app being suspended seconds later — the old
    /// URLSession.shared data task was killed on suspension and only retried
    /// the next time the watch app was opened.
    static let bgSessionId = "run.faff.watch.completions.v1"

    /// Created exactly once per process for this identifier. On relaunch,
    /// recreating it reconnects to transfers the system finished while we were
    /// suspended. Delegate callbacks arrive on a background queue, so the
    /// handlers hop to the main actor before touching state.
    private lazy var bgSession: URLSession = {
        let cfg = URLSessionConfiguration.background(withIdentifier: Self.bgSessionId)
        cfg.isDiscretionary = false           // send ASAP
        cfg.sessionSendsLaunchEvents = true   // wake the app to deliver completion events
        return URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
    }()

    /// workoutIds with an upload in flight, so overlapping flushes don't
    /// double-schedule. Backend is idempotent on workoutId, so this is
    /// tidiness, not correctness.
    private var inFlight: Set<String> = []

    /// Instantiate the lazy background session (call at launch + on relaunch
    /// so it reconnects to finished transfers and delivers their delegate events).
    func ensureBackgroundSession() { _ = bgSession }

    /// Auth token the iPhone shares via application context. Persisted so it
    /// survives watch-app restarts (the iPhone may not be reachable later).
    private var authToken: String? {
        get { UserDefaults.standard.string(forKey: tokenKey) }
        set { UserDefaults.standard.set(newValue, forKey: tokenKey) }
    }

    /// TRUE WHEN THIS PROCESS IS HOSTING THE TEST BUNDLE.
    ///
    /// `FaffWatch Watch AppTests` runs with the watch APP as its `TEST_HOST`,
    /// so every test executes inside a fully live `PhoneSync` whose `apiBase`
    /// was `https://www.faff.run` and whose POST paths are
    /// `api/watch/workouts/complete` and `api/runs/{id}/rpe` — the two calls
    /// that mint and annotate real rows in the owner's training history.
    ///
    /// The iPhone target has been fenced since 2026-08-21, when eight phantom
    /// `phone_conc_*` runs reached the production database from a test that
    /// assumed "every POST fails at the network layer". The watch target had
    /// no equivalent. What kept it safe was only that a fresh simulator
    /// install has no token, since `flushDirectCompletions` returns early
    /// without one — an accident of state, not a barrier, and one that a test
    /// seeding `UserDefaults` would remove without anyone noticing.
    ///
    /// WHY THIS AND NOT THE PHONE'S `NSPrincipalClass` + `URLProtocol` FENCE.
    /// `URLProtocol.registerClass` governs `URLSession.shared`. The dangerous
    /// call here does NOT use it: `flushDirectCompletions` posts through a
    /// **background** `URLSessionConfiguration.background` session, which
    /// out-of-process uploads and therefore ignores registered URLProtocols
    /// entirely. A copy of the phone's fence would have looked identical,
    /// passed review, and left the completion upload wide open. Moving the
    /// BASE URL is transport-independent by construction.
    private static let isHostingTests: Bool =
        NSClassFromString("XCTestCase") != nil
        || ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
        || ProcessInfo.processInfo.environment["XCTestBundlePath"] != nil

    /// Same base-URL rule as the iPhone target (FaffAPI.baseURL): an explicit
    /// override wins, else prod. (localhost is meaningless from the watch, so
    /// unlike the phone we don't fall back to it.)
    ///
    /// Under test it is neither — see `isHostingTests`. `.invalid` is a
    /// reserved TLD (RFC 2606 §2), so it cannot resolve anywhere, ever, on any
    /// network, and a test that reaches the network gets the offline result
    /// its own comments already claim to be exercising. The env override still
    /// wins, so a test that deliberately points at a local stub is unaffected.
    private var apiBase: URL {
        if let s = ProcessInfo.processInfo.environment["FAFF_API_BASE"], let u = URL(string: s) { return u }
        if Self.isHostingTests { return URL(string: "https://watch-tests.invalid")! }
        return URL(string: "https://www.faff.run")!
    }

    private var pendingDirect: [Data] {
        get { (UserDefaults.standard.array(forKey: pendingKey) as? [Data]) ?? [] }
        set { UserDefaults.standard.set(newValue, forKey: pendingKey) }
    }

    private func enqueueDirect(_ data: Data) {
        var q = pendingDirect
        q.append(data)
        if q.count > 50 { q.removeFirst(q.count - 50) } // bound growth
        pendingDirect = q
    }

    /// Schedule a background upload for every queued completion the backend
    /// hasn't accepted yet. No-op without a token. Returns immediately — the
    /// uploads run out-of-process and survive app suspension;
    /// urlSession(_:task:didCompleteWithError:) drops accepted items.
    func flushDirectCompletions() async {
        guard let token = authToken else { return }
        let url = apiBase.appendingPathComponent("api/watch/workouts/complete")
        for data in pendingDirect {
            guard let id = Self.workoutId(from: data), !inFlight.contains(id) else { continue }
            guard let fileURL = Self.writeTempBody(data, id: id) else { continue }
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            // Background sessions require a file-based upload task (the Data
            // variant + async/completion-handler API aren't supported).
            let task = bgSession.uploadTask(with: req, fromFile: fileURL)
            task.taskDescription = id   // correlate completion → queue entry
            inFlight.insert(id)
            task.resume()
        }
    }

    private func removePending(workoutId id: String) {
        pendingDirect = pendingDirect.filter { Self.workoutId(from: $0) != id }
    }

    // MARK: temp-file + decode helpers (background uploads read body from a file)
    private struct WorkoutIdProbe: Decodable { let workoutId: String }
    private static func workoutId(from data: Data) -> String? {
        (try? JSONDecoder().decode(WorkoutIdProbe.self, from: data))?.workoutId
    }
    private static func tempBodyURL(id: String) -> URL {
        let safe = id.replacingOccurrences(of: "/", with: "_")
        return FileManager.default.temporaryDirectory
            .appendingPathComponent("faff-completion-\(safe).json")
    }
    private static func writeTempBody(_ data: Data, id: String) -> URL? {
        let url = tempBodyURL(id: id)
        do { try data.write(to: url, options: .atomic); return url } catch { return nil }
    }
    private static func cleanTempBody(id: String?) {
        guard let id else { return }
        try? FileManager.default.removeItem(at: tempBodyURL(id: id))
    }

    func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
        // Whatever the iPhone last delivered is already waiting here — this is
        // also where an offline watch gets the day back, workout and glance
        // alike, since WatchConnectivity persists the last received context.
        // Flagged as a REPLAY: it may be days old, so it must not stamp the
        // widget shelf with today's date on the strength of the wall clock.
        apply(session.receivedApplicationContext, replayed: true)
        // Push up anything queued while we were offline / token-less.
        Task { await flushDirectCompletions() }
        // Same for any effort rating still waiting on its run to resolve.
        Task { await flushPendingEffort() }
    }

    /// Ask the iPhone for today's workout right now (used on launch when
    /// the iPhone is reachable, so we don't wait for the next context push).
    ///
    /// `onUnreachable` (optional) fires when the request can't be delivered —
    /// either the session isn't activated/reachable up front, or sendMessage
    /// reports an error. The stale-plan flow (RK-2) uses it to offer START
    /// ANYWAY immediately instead of waiting out the full timeout; failures
    /// are no longer silent.
    func requestTodayWorkout(onUnreachable: (() -> Void)? = nil) {
        let session = WCSession.default
        guard session.activationState == .activated, session.isReachable else {
            onUnreachable?()
            return
        }
        session.sendMessage(["request": "today"], replyHandler: { [weak self] reply in
            Task { @MainActor in self?.apply(reply) }
        }, errorHandler: { [weak self] error in
            Task { @MainActor in
                self?.lastSyncError = "Phone request failed: \(error.localizedDescription)"
                print("[PhoneSync] requestTodayWorkout error: \(error.localizedDescription)")
                onUnreachable?()
            }
        })
    }

    /// Send a finished workout's result up two independent ways:
    ///   1. transferUserInfo → iPhone → backend (reliable when the iPhone is
    ///      around; survives the iPhone being briefly unreachable).
    ///   2. a direct POST from the watch to the backend (covers the iPhone
    ///      being off / the app killed). Persisted + retried until accepted.
    /// The backend de-dupes, so both arriving is fine.
    func sendCompletion(_ completion: WatchCompletion) {
        guard let data = try? JSONEncoder().encode(completion) else { return }
        syncState = .sending
        if WCSession.isSupported() {
            // transferUserInfo has a hard ~65 536-byte limit (audit RK-2, 2026-06-09):
            // any run longer than ~65 min at 5-sec telemetry exceeds the cap and the
            // transfer silently fails with no delegate callback. transferFile has no
            // size limit and is reliable even when the iPhone is unreachable.
            let cap = 60_000  // conservative margin below the 65 536 B hard limit
            if data.count > cap {
                if let fileURL = Self.writeTempBody(data, id: completion.workoutId) {
                    WCSession.default.transferFile(fileURL, metadata: ["completion": "v1"])
                }
            } else {
                WCSession.default.transferUserInfo(["completion": data])
            }
        }
        enqueueDirect(data)
        Task { await flushDirectCompletions() }
    }

    // MARK: - Post-run effort (RPE), from the watch's own finish flow
    //
    // The owner's ask: an effort rating in Faff's own watch finish flow,
    // capturing this from where most runs actually happen, not left to the
    // phone alone. It writes to the SAME table and through the SAME route
    // the iPhone's "How hard was it" picker already uses —
    // `POST /api/runs/{id}/rpe` → `post_run_rpe` — so this is one data
    // source with two capture surfaces, never two RPE systems (see
    // TodayAfterV5.swift's `effortScale` / HostsV5.swift's `logEffort`).
    //
    // THE ID PROBLEM. `sendCompletion` above has already fired by the time
    // the runner sees the finish boards — it has to, so a completion
    // survives the app being suspended seconds later. But the row it
    // creates keys on `runs.id`, a bigint the BACKEND derives (SHA-1 of the
    // — possibly cross-day-forked — workoutId; see
    // `web-v2/app/api/watch/workouts/complete/route.ts`'s `stableId`). The
    // watch cannot safely re-derive that hash client-side: duplicating a
    // server-computed id in two places is exactly the drift Rule 16 warns
    // about, and the cross-day fork depends on a same-user comparison the
    // watch does not have visibility into. So the watch RESOLVES the id
    // (`GET .../workouts/complete?workoutId=`, added alongside the existing
    // POST) rather than guessing it.
    //
    // THE TIMING PROBLEM. The completion the id depends on may not have
    // reached `runs` yet — it is itself on a durable, retried queue. A
    // picked effort is therefore queued exactly like `pendingDirect`
    // completions are: written durably first, resolved+posted best-effort
    // immediately, and retried on every future `activate()` until the
    // backend accepts it or permanently refuses it. Rule 23: no job here
    // assumes the completion already landed — it retries until it can prove
    // it did.

    private let pendingEffortKey = "faff.watch.pendingEffort.v1"

    private struct PendingEffort: Codable {
        let workoutId: String
        let rpe: Int
        /// Bounds how long a rating waits on a completion that never
        /// resolves (e.g. the run was rejected as sub-threshold and will
        /// never get a `runs` row) — dropped after 14 days rather than
        /// retried forever.
        let capturedAt: Date
    }

    private var pendingEffort: [PendingEffort] {
        get {
            guard let data = UserDefaults.standard.data(forKey: pendingEffortKey),
                  let items = try? JSONDecoder().decode([PendingEffort].self, from: data)
            else { return [] }
            return items
        }
        set {
            guard let data = try? JSONEncoder().encode(newValue) else { return }
            UserDefaults.standard.set(data, forKey: pendingEffortKey)
        }
    }

    /// Called the moment the runner picks a number (or the moment a queued
    /// pick is retried). Durable-first: written to the queue before the
    /// network is even attempted, so a picked rating survives the watch
    /// app being suspended the instant the runner swipes away — the exact
    /// failure `pendingDirect` above already exists to guard against.
    func submitPostRunEffort(workoutId: String, rpe: Int) {
        var q = pendingEffort
        // One outstanding rating per run: a re-pick (shouldn't happen from
        // the UI, since the board advances on the first tap, but a retried
        // flush racing a fresh pick is possible) replaces rather than
        // duplicates the entry.
        q.removeAll { $0.workoutId == workoutId }
        q.append(PendingEffort(workoutId: workoutId, rpe: rpe, capturedAt: Date()))
        pendingEffort = q
        Task { await flushPendingEffort() }
    }

    /// Resolve + POST every queued rating. Safe to call any time (launch,
    /// activation, right after a fresh pick) — empty queue is a no-op, and
    /// an item mid-flight from a previous call is simply retried again,
    /// which the backend's own idempotent upsert on (user_id, activity_id)
    /// makes harmless.
    func flushPendingEffort() async {
        guard let token = authToken else { return }
        let maxAge: TimeInterval = 14 * 24 * 3600
        var remaining: [PendingEffort] = []
        for item in pendingEffort {
            if Date().timeIntervalSince(item.capturedAt) > maxAge {
                continue   // dead-letter: the completion this depended on never landed
            }
            guard let runId = await resolveRunId(workoutId: item.workoutId, token: token) else {
                remaining.append(item)   // not synced yet — retry on the next flush
                continue
            }
            let posted = await postEffort(runId: runId, rpe: item.rpe, token: token)
            if !posted { remaining.append(item) }
        }
        pendingEffort = remaining
    }

    /// `GET /api/watch/workouts/complete?workoutId=` → the `runs.id` the
    /// backend minted for this completion, or nil when it hasn't synced
    /// yet (not an error — the caller retries).
    private func resolveRunId(workoutId: String, token: String) async -> String? {
        var comps = URLComponents(url: apiBase.appendingPathComponent("api/watch/workouts/complete"),
                                   resolvingAgainstBaseURL: false)
        comps?.queryItems = [URLQueryItem(name: "workoutId", value: workoutId)]
        guard let url = comps?.url else { return nil }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        struct Resolved: Decodable { let ok: Bool; let id: String? }
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              let http = resp as? HTTPURLResponse, (200...299).contains(http.statusCode),
              let decoded = try? JSONDecoder().decode(Resolved.self, from: data)
        else { return nil }
        return decoded.id
    }

    /// `POST /api/runs/{id}/rpe { rpe }` — the exact endpoint and body
    /// shape `HostsV5.swift`'s `logEffort` posts from the iPhone. Returns
    /// true on acceptance OR on a permanent client error (bad rpe range,
    /// run not found for this user): both mean "stop retrying", the same
    /// contract `flushDirectCompletions`'s 4xx branch uses.
    private func postEffort(runId: String, rpe: Int, token: String) async -> Bool {
        var req = URLRequest(url: apiBase.appendingPathComponent("api/runs/\(runId)/rpe"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["rpe": rpe])
        guard let (_, resp) = try? await URLSession.shared.data(for: req),
              let http = resp as? HTTPURLResponse
        else { return false }   // network error — retry later
        if (200...299).contains(http.statusCode) { return true }
        if (400...499).contains(http.statusCode) { return true }   // permanent — drop
        return false   // 5xx — retry later
    }

    // MARK: Apply incoming context / reply

    /// `replayed` is true when the payload is the LAST context the phone
    /// delivered, being re-read out of `receivedApplicationContext` at launch
    /// or on activation, rather than one that has just arrived. It changes
    /// exactly one thing: a replayed payload that carries no evidence of the
    /// day it was built for does not get stamped with today's date on the
    /// widget shelf. See `writeWidgetSnapshot`.
    fileprivate func apply(_ payload: [String: Any], replayed: Bool = false) {
        // Auth token the iPhone shares so the watch can post completions
        // directly. Persist it; if it changed, retry any queued completions.
        if let token = payload["authToken"] as? String, !token.isEmpty, token != authToken {
            authToken = token
            Task { await flushDirectCompletions() }
            Task { await flushPendingEffort() }
        }
        // Sign-out. The phone has no key for this today (its `logout()` clears
        // TokenStore and pushes nothing), so this is the hook rather than a
        // live path — one boolean and the shelf is wiped. Deliberately NOT
        // wired to the 401/403 branch below: an access token expiring is not
        // the runner signing out, and clearing a good prescription off their
        // watch face every time a token ages would be a worse bug than the
        // one this closes.
        if payload["signedOut"] as? Bool == true {
            signOut()
            return
        }
        // Readiness rides alongside the workout (or arrives on its own) — decode
        // it independently so a rest/race day still lights up the glance.
        if let rData = payload["readiness"] as? Data,
           let r = try? JSONDecoder().decode(WatchReadiness.self, from: rData) {
            readiness = r
        }
        // The 0821 glance. Read with `try?` end to end and BEFORE the workout,
        // so it is published whether or not the workout that arrived beside it
        // decodes — and so that a glance object this build cannot parse costs
        // nothing. It never touches `lastSyncError`: the runner can execute
        // the session without a week strip, so a glance failure is not a sync
        // failure. The workout decode below is untouched and still strict.
        //
        // `arrivedGlance` is deliberately a LOCAL as well as being published.
        // The published one is sticky — a payload with no glance in it leaves
        // the last one standing, the same way a payload with no workout leaves
        // the last workout standing. The widget snapshot below must NOT be
        // built off that sticky copy: yesterday's `dayState: week_off` beside
        // today's bare rest line would put "WEEK OFF" on the face for a day
        // nobody said that about. The snapshot sees only this payload's own
        // evidence.
        let arrivedGlance = Self.decodeGlance(from: payload)
        if let g = arrivedGlance {
            todayGlance = g
        }
        if let data = payload["workout"] as? Data {
            // Decode failures keep the current workout but are RECORDED —
            // M-13 was a fractional readinessScore failing this decode and
            // the watch silently running yesterday's plan. The models layer
            // is now tolerant of fractional ints; anything that still fails
            // lands in lastSyncError so the lobby (and a tethered debugger)
            // can see it.
            do {
                let workout = try JSONDecoder().decode(WatchWorkout.self, from: data)
                todayWorkout = workout
                noWorkoutMessage = nil
                hasSynced = true
                lastSyncError = nil
                writeWidgetSnapshot(workout: workout, message: nil, glance: arrivedGlance, replayed: replayed)
            } catch {
                lastSyncError = "Workout decode failed: \(error.localizedDescription)"
                print("[PhoneSync] workout decode failed: \(error)")
                // AND NOTHING IS WRITTEN TO THE WIDGET SHELF. This is the
                // branch that matters. We do not know what today holds, so
                // the last good snapshot stays where it is and goes stale
                // honestly — the widget draws it at 48% under "2 days old",
                // which is true. Clearing it here, or writing a rest board
                // because a decode failed, would replace something true with
                // something invented. Do not "helpfully" add a write here.
            }
        } else if let message = payload["noWorkout"] as? String {
            todayWorkout = nil
            noWorkoutMessage = message
            hasSynced = true
            writeWidgetSnapshot(workout: nil, message: message, glance: arrivedGlance, replayed: replayed)
        }
        // Empty/unknown payloads leave current state untouched — and write no
        // snapshot. A context carrying only a refreshed authToken has resolved
        // nothing about the day and must not spend a reload saying so.
    }

    /// Wipe every trace of the signed-in runner from this watch, including the
    /// widget shelf. `FaffWidgetStore.clear()` is the purpose-built destructive
    /// call (the shelf's default path always preserves), so this is the only
    /// place it is used.
    func signOut() {
        authToken = nil
        todayWorkout = nil
        todayGlance = nil
        readiness = nil
        noWorkoutMessage = nil
        lastSyncError = nil
        hasSynced = false
        FaffWidgetStore.clear()
    }

    // MARK: The 0821 glance · where it is read out of

    /// Pull the glance out of a bridge payload.
    ///
    /// TWO sources, in order, because the phone relay has two shapes:
    ///
    ///  · `glance` — a Data blob carrying either a bare `WatchTodayGlance` or
    ///    a whole `/api/watch/today` body. `WatchTodayGlance` decodes both
    ///    (JSONDecoder ignores keys it was not asked for), so the phone can
    ///    forward either without reshaping. This is the key the REST branch
    ///    needs: today the phone sends only `noWorkout: <String>` there and
    ///    the day's weekStrip/dayState never leave the phone.
    ///  · `workout` — on a session day the phone forwards the ENTIRE response
    ///    body under this key (WatchSync.syncTodayToWatch: `ctx["workout"] =
    ///    data`), so the glance is already inside it and needs no new wire.
    ///
    /// Never throws, never records an error. A shape this build does not
    /// understand reads as absent, which is what every build before it saw.
    private static func decodeGlance(from payload: [String: Any]) -> WatchTodayGlance? {
        let d = JSONDecoder()
        if let raw = payload["glance"] as? Data,
           let g = try? d.decode(WatchTodayGlance.self, from: raw), !g.isEmpty {
            return g
        }
        if let raw = payload["workout"] as? Data,
           let g = try? d.decode(WatchTodayGlance.self, from: raw), !g.isEmpty {
            return g
        }
        return nil
    }

    // MARK: - Simulator · render a REAL payload

    /// Drive the app from a real `/api/watch/today` body held in a file, so a
    /// change to something the runner sees can be verified by RENDERING it with
    /// the runner's own data instead of a fixture.
    ///
    /// WHY THIS EXISTS. Until now the simulator had exactly two sources and
    /// both are fixtures: `WatchWorkout.sample*` and the `-face` harness.
    /// CLAUDE.md Rule 13 says it in as many words — *"Never a sample fixture
    /// for a display fix. Fixtures skip the exact code paths that break."*
    /// `_FacePreview.swift` already carries a warning it earned: it once drew
    /// a pace gauge the router never passed, so every screenshot reviewed was
    /// accurate about a screen that did not exist. There was no way to look at
    /// the real thing, so nobody did, and the rule had no apparatus behind it.
    ///
    /// It reconstructs the applicationContext EXACTLY as the phone builds it
    /// (`WatchSync.syncTodayToWatch` — the workout object alone under
    /// `workout`, the whole body under `glance`) and hands it to the same
    /// `apply` every live payload goes through. It decodes nothing itself: a
    /// second decode path would be a second answer to a question that already
    /// has one, and that is precisely how a harness ends up disagreeing with
    /// the product it exists to show.
    ///
    /// Simulator-only, and reached only from an explicit `-payload` launch
    /// argument, so there is no path to it on a wrist.
    #if targetEnvironment(simulator)
    func applyLocalPayloadFile(_ path: String) {
        guard let raw = FileManager.default.contents(atPath: path) else {
            lastSyncError = "-payload: no file at \(path)"
            return
        }
        guard let obj = (try? JSONSerialization.jsonObject(with: raw)) as? [String: Any] else {
            lastSyncError = "-payload: \(path) is not a JSON object"
            return
        }
        var ctx: [String: Any] = [:]
        if let w = obj["workout"], let wData = try? JSONSerialization.data(withJSONObject: w) {
            ctx["workout"] = wData
        } else if let msg = obj["message"] as? String {
            ctx["noWorkout"] = msg
        }
        ctx["glance"] = raw
        apply(ctx)
    }
    #endif
}

// MARK: - The widget shelf (complications + Smart Stack)
//
// A widget process is not this process: no WCSession, no network, no
// PhoneSync. Everything it draws it reads off the App Group shelf, and this
// is the only thing that writes it — the call site
// FaffWidgetSnapshot.swift's `// NEEDS:` note specifies.
//
// The rules that note lays down, and which the code below keeps:
//
//   · Success → a session snapshot.
//   · noWorkout / rest → the rest snapshot.
//   · DECODE FAILURE → nothing is written. Handled in `apply` itself, where
//     the catch has no write in it at all.
//   · Sign-out → FaffWidgetStore.clear(). See `signOut()`.
//
// And the two prohibitions:
//
//   · Not on every message. `FaffWidgetStore.write` no-ops on an identical
//     payload, and every field below is derived deterministically from the
//     payload, so a re-push of the same day re-derives the same snapshot and
//     spends no reload. `writtenAt` moving is why the store's guard compares
//     on `sameContent` rather than `==`.
//   · Not for a day other than the one the payload is for. `sessionDay` is
//     taken from the payload's OWN evidence — the week strip's today, or the
//     day baked into `workoutId` (the server builds it as
//     `<userId>-<yyyy-MM-dd>`) — and falls back to the wall clock only for a
//     payload that has JUST arrived. A replayed context with no day in it
//     writes nothing rather than restamping a three-day-old rest day as today.

extension PhoneSync {

    /// Write what the day resolved to, or return without writing.
    ///
    /// `workout` non-nil is the success branch; `message` non-nil is the
    /// no-session branch. Both are nil only from a caller that has resolved
    /// nothing, and that writes nothing.
    ///
    /// PRECEDENCE IS THE ROUTER'S, NOT ITS OWN. `WorkoutRootView.idleHome`
    /// draws the session when there is one and falls to `dayState` only when
    /// there is not — a no-session reason can ride BESIDE a workout, and the
    /// router still runs the session. The face follows the app, so the order
    /// here is the same order. If that precedence ever changes, change it in
    /// both places or the complication starts contradicting the lobby.
    func writeWidgetSnapshot(workout: WatchWorkout?,
                             message: String?,
                             glance: WatchTodayGlance?,
                             replayed: Bool) {
        guard workout != nil || message != nil else { return }

        // The day the payload is FOR, never "now" unless now is all we have
        // and the payload is fresh.
        let day: String
        if let iso = glance?.weekStrip?.days.first(where: { $0.isToday })?.dateIso,
           Self.looksLikeDay(iso) {
            day = iso
        } else if let id = workout?.workoutId, let iso = Self.dayFromWorkoutId(id) {
            day = iso
        } else if !replayed {
            day = FaffWidgetStore.dayString()
        } else {
            // Replayed context, no day in it. Whatever is on the shelf was
            // written when this context was live and carries the right day;
            // leave it and let it age honestly.
            return
        }

        // ── The session ──
        //
        // Every string comes out of `WatchLobbyAdapter`, which is the one
        // place that knows both the wire's shape and the design's vocabulary.
        // Deriving a second ramp here — off paceLabel, off the phase shape,
        // off anything — would be a second answer to a question that already
        // has one, and the two answers would drift the first time a session
        // type was added.
        //
        // Ledes are stored RAW, not uppercased. `WDisplayWord` uppercases at
        // draw time (WatchKitV5.swift), the lobby stores `workout.name` raw,
        // and `FaffWidgetContent`'s own no-plan lede is sentence case — so
        // raw is what keeps the shelf comparable with everything around it.
        if let w = workout {
            let name = w.name.trimmingCharacters(in: .whitespacesAndNewlines)
            let dose = WatchLobbyAdapter.dose(for: w)
            FaffWidgetStore.write(FaffSessionSnapshot(
                sessionDay: day,
                ramp: WatchLobbyAdapter.ramp(for: w).wireName,
                lede: name.isEmpty ? nil : name,
                dose: dose.isEmpty ? nil : dose,
                workoutId: w.workoutId
            ))
            return
        }

        // ── No session, with a reason ──
        if let ds = glance?.dayState {
            let title = ds.title.trimmingCharacters(in: .whitespacesAndNewlines)
            FaffWidgetStore.write(FaffSessionSnapshot(
                sessionDay: day,
                ramp: (ds.isRestDay ? V5LobbyRamp.rest : .noSession).wireName,
                // ONE DELIBERATE DIVERGENCE from the router, which draws no
                // lede on the No-session board. That board has a coach
                // sentence under the space where a lede would go; a
                // complication has no sentence register at all, so dropping
                // the lede there leaves the face with nothing on it. `title`
                // is what the wire calls the display lede ("Nothing today" ·
                // "Week off" · "Off-season") and it is drawn, not composed.
                lede: title.isEmpty ? nil : title,
                // No dose on either board. There is no dose.
                dose: nil,
                workoutId: nil
            ))
            return
        }

        // ── No session, and no reason on the wire ──
        //
        // A flat `noWorkout` line from a phone build that does not forward the
        // glance yet. The message is byte-stable by server contract, so the
        // one branch worth separating is separated: a rest day is a rest day,
        // and "No active plan." is NOT one and must not be drawn on a wrist as
        // though the runner had been told to rest. Both ledes are the design's
        // own board names, not composed prose, and both are superseded the
        // moment `dayState` starts arriving.
        let isRest = (message ?? "").lowercased().hasPrefix("rest day")
        FaffWidgetStore.write(FaffSessionSnapshot(
            sessionDay: day,
            ramp: (isRest ? V5LobbyRamp.rest : .noSession).wireName,
            lede: isRest ? "Rest" : "No session",
            dose: nil,
            workoutId: nil
        ))
    }

    // ── Derivations · which day ──

    /// `yyyy-MM-dd`, shape only. Enough for what it guards: a field that is
    /// empty, or something else entirely. It is not validating a calendar —
    /// the store parses the string properly when it measures staleness.
    static func looksLikeDay(_ s: String) -> Bool {
        guard s.count == 10 else { return false }
        for (i, ch) in Array(s).enumerated() {
            if i == 4 || i == 7 {
                if ch != "-" { return false }
            } else if !ch.isNumber {
                return false
            }
        }
        return true
    }

    /// The server builds `workoutId` as `<userId>-<yyyy-MM-dd>`
    /// (build-workout.ts). The trailing ten characters are therefore the day
    /// the session was prescribed FOR — which is what staleness is measured
    /// against, and which survives the payload sitting in a persisted context
    /// for three days before this watch reads it again.
    static func dayFromWorkoutId(_ id: String) -> String? {
        guard id.count >= 10 else { return nil }
        let tail = String(id.suffix(10))
        return looksLikeDay(tail) ? tail : nil
    }
}

// MARK: - WCSessionDelegate (background-queue callbacks)

extension PhoneSync: WCSessionDelegate {
    nonisolated func session(_ session: WCSession,
                             activationDidCompleteWith state: WCSessionActivationState,
                             error: Error?) {
        Task { @MainActor in
            // Same replayed context as activate() reads — same flag.
            self.apply(session.receivedApplicationContext, replayed: true)
            self.requestTodayWorkout()
        }
    }

    nonisolated func session(_ session: WCSession,
                             didReceiveApplicationContext applicationContext: [String: Any]) {
        Task { @MainActor in self.apply(applicationContext) }
    }

    /// transferUserInfo completion — first time we've ever known whether the
    /// phone received it (audit RK-2). On failure the direct-POST path is the
    /// fallback; we just update syncState so the SummaryView can reflect it.
    nonisolated func session(_ session: WCSession,
                             didFinish userInfoTransfer: WCSessionUserInfoTransfer,
                             error: Error?) {
        let failed = error != nil
        Task { @MainActor in
            if failed {
                if self.syncState == .sending {
                    self.syncState = .failed("Transfer failed · uploading directly")
                }
            } else {
                if self.syncState == .sending { self.syncState = .sent }
            }
        }
    }

    /// iPhone → watch real-time messages. Today handles two requests:
    ///   · `startTreadmillHR` · iPhone TreadmillView started a session ·
    ///     spin up TreadmillHRSession so HK gets fast HR samples.
    ///   · `stopTreadmillHR` · iPhone TreadmillView ended · tear down
    ///     the session so the watch returns to passive sensing.
    /// Reply with `{status, sessionId}` so the iPhone knows the watch
    /// accepted (or that the watch app wasn't reachable, in which case
    /// the iPhone shows a graceful "Open Faff on watch for live HR" hint).
    nonisolated func session(_ session: WCSession,
                             didReceiveMessage message: [String: Any],
                             replyHandler: @escaping ([String: Any]) -> Void) {
        let request = (message["request"] as? String) ?? ""
        let sessionId = (message["sessionId"] as? String) ?? ""
        switch request {
        case "startTreadmillHR":
            Task { @MainActor in
                let live = TreadmillHRSession.shared
                await live.start(sessionId: sessionId)
                // 2026-08-28 · this used to reply "started" unconditionally,
                // before `start()` even ran to completion — so a session that
                // failed to start (HK auth, conflicting session) told the
                // phone it had succeeded, and `treadmillSessionConfirmed`
                // came back true for a bridge that was never actually up.
                replyHandler(["status": live.isActive ? "started" : "failed", "sessionId": sessionId])
            }
        case "stopTreadmillHR":
            Task { @MainActor in
                // 2026-08-21 · watch/push audit · match the sessionId before
                // ending, exactly as the durable transferUserInfo path below
                // already does. Without it, a late or replayed stop for a
                // PREVIOUS session killed the live one — the phone crashing
                // mid-treadmill and relaunching into a new session is the
                // real sequence (TreadmillHRSession.start() documents that
                // exact restart), and the watch would then sample no HR for
                // the rest of the run with nothing on screen to explain it.
                let live = TreadmillHRSession.shared
                if live.isActive, live.sessionId != sessionId, !sessionId.isEmpty {
                    replyHandler(["status": "ignored-stale", "sessionId": sessionId])
                    return
                }
                await live.end()
                replyHandler(["status": "stopped", "sessionId": sessionId])
            }
        default:
            replyHandler(["status": "unknown"])
        }
    }

    /// No-reply messages from the iPhone.
    ///   · `pingTreadmillHR` — the treadmill keepalive (audit P2-49): the
    ///     phone pings every ~2 min while its console is live;
    ///     TreadmillHRSession's dead-man timer auto-ends the HR session when
    ///     pings stop arriving (phone died, app killed, out of range).
    ///   · `treadmillStats` (2026-08-28) — distance / elapsed / pace, pushed
    ///     every tick while the run is live, so TreadmillHRView can show
    ///     David's "in run layout" (distance/time/pace/HR) instead of bpm
    ///     alone. The watch has no independent way to know any of these —
    ///     see WatchSync.sendTreadmillLiveStats's doc on the phone side.
    nonisolated func session(_ session: WCSession,
                             didReceiveMessage message: [String: Any]) {
        let sessionId = (message["sessionId"] as? String) ?? ""
        switch message["request"] as? String {
        case "pingTreadmillHR":
            Task { @MainActor in
                TreadmillHRSession.shared.ping(sessionId: sessionId)
            }
        case "treadmillStats":
            let distanceMi = message["distanceMi"] as? Double
            let elapsedSec = message["elapsedSec"] as? Int
            let paceSecPerMi = message["paceSecPerMi"] as? Int
            Task { @MainActor in
                TreadmillHRSession.shared.applyLiveStats(
                    sessionId: sessionId, distanceMi: distanceMi,
                    elapsedSec: elapsedSec, paceSecPerMi: paceSecPerMi)
            }
        default:
            break
        }
    }

    /// Durable stop for the treadmill HR bridge (audit P2-49). When the watch
    /// is unreachable at End, the iPhone queues `treadmillStop` via
    /// transferUserInfo — delivered here on the next connection so the HR
    /// session ends as soon as the pipe is back instead of waiting out the
    /// dead-man timer.
    ///
    /// 2026-08-27 · `treadmillStart` is the same durable fallback for the
    /// OTHER end of the bridge — the watch wasn't reachable the instant the
    /// treadmill console appeared, so `startTreadmillHRSession` queued this
    /// instead of the live message. Only start if nothing is already active,
    /// same reasoning as the stop guard: a late/replayed start must not
    /// clobber a session that's already running (or already ended) for a
    /// DIFFERENT id than the one this delivery carries.
    nonisolated func session(_ session: WCSession,
                             didReceiveUserInfo userInfo: [String: Any]) {
        if let stopId = userInfo["treadmillStop"] as? String {
            Task { @MainActor in
                // Only end the session the phone asked about · a stale stop from
                // a previous workout must not kill a newer session.
                if TreadmillHRSession.shared.isActive,
                   TreadmillHRSession.shared.sessionId == stopId {
                    await TreadmillHRSession.shared.end()
                }
            }
            return
        }
        if let startId = userInfo["treadmillStart"] as? String {
            Task { @MainActor in
                let live = TreadmillHRSession.shared
                if !live.isActive || live.sessionId == startId {
                    await live.start(sessionId: startId)
                }
            }
        }
    }
}

// MARK: - Background upload delegate (out-of-process completion POSTs)
//
// PhoneSync is @MainActor, but URLSession delegate callbacks arrive on the
// session's background delegateQueue, so these are nonisolated and hop to the
// main actor before touching authToken / pendingDirect / inFlight.
extension PhoneSync: URLSessionDataDelegate {
    nonisolated func urlSession(_ session: URLSession,
                                task: URLSessionTask,
                                didCompleteWithError error: Error?) {
        let id = task.taskDescription
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        let failed = (error != nil)
        Task { @MainActor in
            if let id { self.inFlight.remove(id) }
            if !failed, (200...299).contains(status) {
                if let id { self.removePending(workoutId: id) }   // accepted → drop from durable queue
                Self.cleanTempBody(id: id)
                if self.syncState == .sending { self.syncState = .sent }
            } else if status == 401 || status == 403 {
                self.authToken = nil                               // stale token → stop; iPhone re-shares one
                Self.cleanTempBody(id: id)
            } else if (400...499).contains(status) {
                // Permanent client error (400 bad-request, 404 not-found, 409 already-accepted,
                // etc.) — the backend will never accept this payload regardless of retries.
                // Drop from the durable queue so it doesn't accumulate forever (dead-letter).
                if let id { self.removePending(workoutId: id) }
                Self.cleanTempBody(id: id)
            }
            // Network errors / 5xx: leave queued + temp file in place; next
            // activate()/sendCompletion() flush retries it.
        }
    }
}
