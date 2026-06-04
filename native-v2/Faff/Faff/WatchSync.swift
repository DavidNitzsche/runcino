//
//  WatchSync.swift  (native-v2 · iPhone side)
//
//  iPhone↔watch bridge for the v2 app. Mirrors the behavior of
//  legacy/native/Faff/Faff/WatchSync.swift so the (frozen) watch app
//  receives the same shape of applicationContext.
//
//  Contract: docs/coach/WATCH_CONTRACT.md
//

import Foundation
import Combine
import WatchConnectivity

@MainActor
final class WatchSync: NSObject, ObservableObject {
    static let shared = WatchSync()

    @Published private(set) var lastSyncStatus: String?
    @Published private(set) var isPaired = false
    @Published private(set) var isWatchAppInstalled = false

    private var pendingContext: [String: Any]?

    // Durable completion queue. The watch sends WatchCompletion via
    // transferUserInfo; POSTing can fail (no network, token refresh,
    // 5xx). We persist + retry until the server accepts.
    private let pendingKey = "faff.watch.pendingCompletions.v2"
    private var pendingCompletions: [Data] {
        get { (UserDefaults.standard.array(forKey: pendingKey) as? [Data]) ?? [] }
        set { UserDefaults.standard.set(newValue, forKey: pendingKey) }
    }

    private override init() { super.init() }

    func start() {
        guard WCSession.isSupported() else { return }
        let s = WCSession.default
        s.delegate = self
        s.activate()
        Task { await self.pushTodayToWatch() }
    }

    // MARK: Push today's workout to the watch

    func pushTodayToWatch() async {
        do {
            let raw = try await API.fetchWatchTodayRaw()
            // Build applicationContext per WATCH_CONTRACT.md
            var ctx: [String: Any] = [:]
            // Pass the iPhone's session token along · the watch needs it to
            // POST workout completions back to /api/watch/workouts/complete
            // (which now requires Bearer after the 2026-05-30 audit). Watch
            // tolerates absence on first launch, but without this the watch
            // can never land its runs.
            if let t = TokenStore.shared.token {
                ctx["authToken"] = t
            }
            // workout / message — decode the response shape and route.
            let obj = try JSONSerialization.jsonObject(with: raw) as? [String: Any] ?? [:]
            if obj["workout"] != nil {
                // Re-encode just the workout object as Data (watch decodes Data → WatchWorkout)
                let workoutJSON = try JSONSerialization.data(withJSONObject: obj["workout"] as Any)
                ctx["workout"] = workoutJSON
            } else if let msg = obj["message"] as? String {
                ctx["noWorkout"] = msg
            }
            // Readiness wires when §8.3 endpoint ships in P3.
            sendContext(ctx)
        } catch {
            lastSyncStatus = "Watch fetch error: \(error.localizedDescription)"
        }
    }

    private func sendContext(_ context: [String: Any]) {
        let session = WCSession.default
        guard WCSession.isSupported() else { return }
        guard session.activationState == .activated else {
            pendingContext = context
            return
        }
        do {
            try session.updateApplicationContext(context)
            lastSyncStatus = "Synced \(Date().formatted(date: .omitted, time: .shortened))"
        } catch {
            pendingContext = context
            lastSyncStatus = "Watch context error: \(error.localizedDescription)"
        }
    }

    // MARK: Receive completions from watch (via transferUserInfo)

    fileprivate func enqueue(_ data: Data) {
        var q = pendingCompletions
        q.append(data)
        if q.count > 50 { q.removeFirst(q.count - 50) }
        pendingCompletions = q
    }

    // MARK: - Treadmill HR bridge (2026-06-01 · build 137)
    //
    // The iPhone TreadmillView wants HK to sample HR every 5-15s, not
    // every 5 minutes. The watch's sensor only polls that fast when an
    // active HKWorkoutSession is running. So when TreadmillView starts,
    // ask the watch to spin up a minimal indoor-running session via
    // TreadmillHRSession. Watch teardown is symmetric on stop.
    //
    // Best-effort: if the watch app isn't reachable (not installed, not
    // launched, in low-power mode), the message fails silently and the
    // iPhone gracefully shows no live HR pill. The treadmill workout
    // still records · the iPhone's POST is independent of the watch.

    /// Ask the watch to start an indoor-running HR session. Returns
    /// whether the watch acknowledged (used by TreadmillView to show
    /// "Open Faff on watch for live HR" when the watch isn't reachable).
    @discardableResult
    func startTreadmillHRSession(sessionId: String) -> Bool {
        guard WCSession.isSupported() else { return false }
        let s = WCSession.default
        guard s.activationState == .activated, s.isReachable else { return false }
        s.sendMessage(
            ["request": "startTreadmillHR", "sessionId": sessionId],
            replyHandler: { _ in },
            errorHandler: { err in
                print("[WatchSync] startTreadmillHR failed: \(err.localizedDescription)")
            }
        )
        return true
    }

    /// Ask the watch to end the indoor-running HR session. Idempotent ·
    /// safe to call even if the watch never received the start.
    func stopTreadmillHRSession(sessionId: String) {
        guard WCSession.isSupported() else { return }
        let s = WCSession.default
        guard s.activationState == .activated, s.isReachable else { return }
        s.sendMessage(
            ["request": "stopTreadmillHR", "sessionId": sessionId],
            replyHandler: { _ in },
            errorHandler: { err in
                print("[WatchSync] stopTreadmillHR failed: \(err.localizedDescription)")
            }
        )
    }

    func flushPendingCompletions() async {
        let q = pendingCompletions
        guard !q.isEmpty else { return }
        var keep: [Data] = []
        for data in q {
            let ok = await postCompletion(data)
            if !ok { keep.append(data) }
        }
        pendingCompletions = keep
    }

    private func postCompletion(_ data: Data) async -> Bool {
        var req = URLRequest(url: API.baseURL.appendingPathComponent("api/watch/workouts/complete"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // 2026-06-03 round 83 · splice the device timezone onto the
        // completion body before POST. Backend
        // (designs/briefs/iphone-tz-sync-backend-ready.md) reads
        // body.timezone to auto-populate profile.timezone (first sync)
        // AND stores it on runs.data->>'timezone' for travel-aware
        // recovery (a Tokyo run stays tagged Tokyo). The watch app
        // doesn't currently include the field, so the iPhone splices
        // it in here · cheaper than a watch-app rebuild + new
        // TestFlight pair. If decode fails (shouldn't · payload is
        // always JSON from the watch), fall back to the raw bytes.
        if var dict = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
            if dict["timezone"] == nil {
                dict["timezone"] = TimeZone.current.identifier
            }
            if let mutated = try? JSONSerialization.data(withJSONObject: dict) {
                req.httpBody = mutated
            } else {
                req.httpBody = data
            }
        } else {
            req.httpBody = data
        }
        // Was raw URLSession with no Authorization header. After the
        // 2026-05-30 audit added Bearer auth to /api/watch/workouts/complete
        // (and dropped the ?user_id fallback), every queued watch completion
        // POST'd by the iPhone silently 401'd · the queue grew unbounded
        // and watch runs never landed. Route through authedSend so the
        // bearer attaches and 401 surfaces via .faffSessionExpired.
        do {
            let (_, http) = try await API.authedSend(req)
            return (200..<300).contains(http.statusCode)
        } catch {
            return false
        }
    }

    @MainActor
    private func refreshPairing() {
        guard WCSession.isSupported() else { return }
        let s = WCSession.default
        isPaired = s.isPaired
        isWatchAppInstalled = s.isWatchAppInstalled
    }
}

extension WatchSync: WCSessionDelegate {
    nonisolated func session(_ session: WCSession,
                             activationDidCompleteWith state: WCSessionActivationState,
                             error: Error?) {
        Task { @MainActor in
            self.refreshPairing()
            if let pending = self.pendingContext, state == .activated {
                try? session.updateApplicationContext(pending)
                self.pendingContext = nil
            }
            if state == .activated { await self.flushPendingCompletions() }
        }
    }

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}
    nonisolated func sessionDidDeactivate(_ session: WCSession) { session.activate() }

    nonisolated func session(_ session: WCSession,
                             didReceiveUserInfo userInfo: [String: Any] = [:]) {
        // Watch sent a WatchCompletion via transferUserInfo. Persist + retry.
        //
        // Wire shape (confirmed by watch agent 2026-05-26): the value is
        // `Data` — JSONEncoder().encode(WatchCompletion). Single path. The
        // previous code called JSONSerialization.data(withJSONObject: payload)
        // on whatever sat there, which threw an Obj-C NSException when handed
        // a Data blob (NSExceptions bypass `try?` → app launch crash on
        // every activation because queued userInfo persists). Now we type-
        // check the cast; no re-serialize, no JSONSerialization path that
        // could NSException.
        guard let data = userInfo["completion"] as? Data else {
            // Unexpected shape — log + drop, never crash.
            if let payload = userInfo["completion"] {
                print("[WatchSync] dropping non-Data completion payload type=\(type(of: payload))")
            }
            return
        }
        Task { @MainActor in
            self.enqueue(data)
            await self.flushPendingCompletions()
        }
    }

    nonisolated func session(_ session: WCSession,
                             didReceiveMessage message: [String: Any],
                             replyHandler: @escaping ([String: Any]) -> Void) {
        // Watch opened and asked for today directly.
        Task { @MainActor in
            do {
                let raw = try await API.fetchWatchTodayRaw()
                if let obj = try? JSONSerialization.jsonObject(with: raw) as? [String: Any] {
                    var reply: [String: Any] = [:]
                    if let w = obj["workout"], JSONSerialization.isValidJSONObject(w) {
                        // Gate with isValidJSONObject — see didReceiveUserInfo
                        // comment above for the NSException-vs-try? story.
                        reply["workout"] = (try? JSONSerialization.data(withJSONObject: w)) ?? Data()
                    } else if let msg = obj["message"] as? String {
                        reply["noWorkout"] = msg
                    }
                    replyHandler(reply)
                } else {
                    replyHandler(["noWorkout": "No workout."])
                }
            } catch {
                replyHandler(["noWorkout": "Sync failed."])
            }
        }
    }
}
