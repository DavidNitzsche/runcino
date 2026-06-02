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

    /// POST every queued completion straight to the backend; drop the ones
    /// the server accepts, keep the rest for the next attempt. No-op without
    /// a token (the iPhone hasn't shared one yet — the transferUserInfo path
    /// still covers the run).
    func flushDirectCompletions() async {
        guard let token = authToken else { return }
        let q = pendingDirect
        guard !q.isEmpty else { return }
        let url = apiBase.appendingPathComponent("api/watch/workouts/complete")
        var remaining: [Data] = []
        for data in q {
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            req.httpBody = data
            do {
                let (_, resp) = try await URLSession.shared.data(for: req)
                let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
                if (200...299).contains(code) { continue }       // accepted → drop
                if code == 401 || code == 403 { authToken = nil } // stale token → stop using it
                remaining.append(data)                            // retry later
            } catch {
                remaining.append(data)
            }
        }
        pendingDirect = remaining
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
    func requestTodayWorkout() {
        let session = WCSession.default
        guard session.activationState == .activated, session.isReachable else { return }
        session.sendMessage(["request": "today"], replyHandler: { [weak self] reply in
            Task { @MainActor in self?.apply(reply) }
        }, errorHandler: nil)
    }

    /// Send a finished workout's result up two independent ways:
    ///   1. transferUserInfo → iPhone → backend (reliable when the iPhone is
    ///      around; survives the iPhone being briefly unreachable).
    ///   2. a direct POST from the watch to the backend (covers the iPhone
    ///      being off / the app killed). Persisted + retried until accepted.
    /// The backend de-dupes, so both arriving is fine.
    func sendCompletion(_ completion: WatchCompletion) {
        guard let data = try? JSONEncoder().encode(completion) else { return }
        if WCSession.isSupported() {
            WCSession.default.transferUserInfo(["completion": data])
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
        if let data = payload["workout"] as? Data,
           let workout = try? JSONDecoder().decode(WatchWorkout.self, from: data) {
            todayWorkout = workout
            noWorkoutMessage = nil
            hasSynced = true
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
}
