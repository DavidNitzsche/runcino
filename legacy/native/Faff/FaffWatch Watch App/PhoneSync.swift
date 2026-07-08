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

    /// True when `todayWorkout` is set but its `expiresAt` has already passed —
    /// the watch is showing yesterday's plan. IdleView should prompt the runner
    /// to sync the iPhone (W-5).
    var staleWorkout: Bool {
        guard let w = todayWorkout else { return false }
        let iso = ISO8601DateFormatter()
        guard let exp = iso.date(from: w.expiresAt) else { return false }
        return exp < Date.now
    }

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

    /// Same base-URL rule as the iPhone target (FaffAPI.baseURL): an explicit
    /// override wins, else prod. (localhost is meaningless from the watch, so
    /// unlike the phone we don't fall back to it.)
    private var apiBase: URL {
        if let s = ProcessInfo.processInfo.environment["FAFF_API_BASE"], let u = URL(string: s) { return u }
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
        // Whatever the iPhone last delivered is already waiting here.
        apply(session.receivedApplicationContext)
        // Push up anything queued while we were offline / token-less.
        Task { await flushDirectCompletions() }
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

    // MARK: Apply incoming context / reply

    fileprivate func apply(_ payload: [String: Any]) {
        // Auth token the iPhone shares so the watch can post completions
        // directly. Persist it; if it changed, retry any queued completions.
        if let token = payload["authToken"] as? String, !token.isEmpty, token != authToken {
            authToken = token
            Task { await flushDirectCompletions() }
        }
        // Readiness rides alongside the workout (or arrives on its own) — decode
        // it independently so a rest/race day still lights up the glance.
        if let rData = payload["readiness"] as? Data,
           let r = try? JSONDecoder().decode(WatchReadiness.self, from: rData) {
            readiness = r
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
            } catch {
                lastSyncError = "Workout decode failed: \(error.localizedDescription)"
                print("[PhoneSync] workout decode failed: \(error)")
            }
        } else if let message = payload["noWorkout"] as? String {
            todayWorkout = nil
            noWorkoutMessage = message
            hasSynced = true
        }
        // Empty/unknown payloads leave current state untouched.
    }
}

// MARK: - WCSessionDelegate (background-queue callbacks)

extension PhoneSync: WCSessionDelegate {
    nonisolated func session(_ session: WCSession,
                             activationDidCompleteWith state: WCSessionActivationState,
                             error: Error?) {
        Task { @MainActor in
            self.apply(session.receivedApplicationContext)
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
                    self.syncState = .failed("Transfer failed — uploading directly")
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
                TreadmillHRSession.shared.start(sessionId: sessionId)
                replyHandler(["status": "started", "sessionId": sessionId])
            }
        case "stopTreadmillHR":
            Task { @MainActor in
                await TreadmillHRSession.shared.end()
                replyHandler(["status": "stopped", "sessionId": sessionId])
            }
        default:
            replyHandler(["status": "unknown"])
        }
    }

    /// No-reply messages from the iPhone. `pingTreadmillHR` is the treadmill
    /// keepalive (audit P2-49): the phone pings every ~2 min while its console
    /// is live; TreadmillHRSession's dead-man timer auto-ends the HR session
    /// when pings stop arriving (phone died, app killed, out of range).
    nonisolated func session(_ session: WCSession,
                             didReceiveMessage message: [String: Any]) {
        guard (message["request"] as? String) == "pingTreadmillHR" else { return }
        let sessionId = (message["sessionId"] as? String) ?? ""
        Task { @MainActor in
            TreadmillHRSession.shared.ping(sessionId: sessionId)
        }
    }

    /// Durable stop for the treadmill HR bridge (audit P2-49). When the watch
    /// is unreachable at End, the iPhone queues `treadmillStop` via
    /// transferUserInfo — delivered here on the next connection so the HR
    /// session ends as soon as the pipe is back instead of waiting out the
    /// dead-man timer.
    nonisolated func session(_ session: WCSession,
                             didReceiveUserInfo userInfo: [String: Any]) {
        guard let stopId = userInfo["treadmillStop"] as? String else { return }
        Task { @MainActor in
            // Only end the session the phone asked about · a stale stop from
            // a previous workout must not kill a newer session.
            if TreadmillHRSession.shared.isActive,
               TreadmillHRSession.shared.sessionId == stopId {
                await TreadmillHRSession.shared.end()
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
