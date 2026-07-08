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
    /// True once the watch replies "ok" to a `startTreadmillHR` message.
    /// P-6: prior code returned `true` on reachability alone; this is the
    /// real ack flag for TreadmillView's "live HR" affordance.
    @Published private(set) var treadmillSessionConfirmed = false

    private var pendingContext: [String: Any]?

    // MARK: Readiness → watch glance (P1-30 · 2026-07-06)
    //
    // The watch home TabView carries a readiness glance (ReadinessGlanceView,
    // fed by PhoneSync.apply(payload["readiness"])) — but nothing on the
    // iPhone ever sent that key, so the glance was permanently empty on every
    // real device. The iPhone shapes /api/readiness into the WatchReadiness
    // JSON the watch decodes and rides it on every context push and
    // sendMessage reply.

    /// Last encoded readiness payload — reused when /api/readiness is
    /// transiently down and spliced into sendMessage replies.
    private var lastReadinessPayload: Data?
    /// Last full applicationContext sent — pushReadiness merges into it so a
    /// readiness-only update can't clobber the workout the watch would
    /// otherwise read from receivedApplicationContext on its next launch.
    private var lastContext: [String: Any]?

    /// Shape a ReadinessSnapshot (/api/readiness) into the JSON the watch's
    /// WatchReadiness decoder expects. `state` / `label` / `recommendation`
    /// are non-optional on the watch decoder, so they are always present.
    static func readinessPayload(from snap: ReadinessSnapshot) -> Data? {
        // /api/readiness bands: sharp | ready | moderate | pull-back | unknown.
        // Glance grammar: green (good) / yellow (hold) / red (back off).
        let state: String
        switch snap.band {
        case "sharp", "ready": state = "green"
        case "moderate":       state = "yellow"
        case "pull-back":      state = "red"
        default:               state = "yellow" // unknown → score nil → empty state
        }
        var dict: [String: Any] = [
            "state": state,
            "label": snap.label ?? snap.band?.uppercased() ?? "",
            "recommendation": snap.formLine ?? "",
        ]
        if let s = snap.score { dict["score"] = s }
        else { dict["suppressReason"] = "no-data" }
        if let hrv = snap.hrvCurrent { dict["hrvMs"] = hrv }
        if let rhr = snap.rhrCurrent { dict["rhrBpm"] = rhr }
        return try? JSONSerialization.data(withJSONObject: dict)
    }

    /// Immediate re-push when the iPhone refreshes its own readiness read
    /// (TodayView.loadAll) — the wrist glance updates without waiting for the
    /// next 60s-throttled /api/watch/today cycle.
    func pushReadiness(_ snapshot: ReadinessSnapshot) {
        guard let payload = Self.readinessPayload(from: snapshot) else { return }
        // Skip when nothing changed — updateApplicationContext deliveries are
        // system-throttled; don't spend one on a no-op.
        if payload == lastReadinessPayload { return }
        lastReadinessPayload = payload
        var ctx = lastContext ?? [:]
        if let t = TokenStore.shared.token { ctx["authToken"] = t }
        ctx["readiness"] = payload
        ctx["syncedAt"] = Date().timeIntervalSinceReferenceDate
        sendContext(ctx)
    }

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
        // Count the launch push against refresh()'s 60s window — scenePhase
        // flips to .active right after didFinishLaunching, and the cold
        // launch shouldn't hit /api/watch/today twice back-to-back.
        lastRefreshAt = Date()
        Task { await self.pushTodayToWatch() }
    }

    // MARK: Foreground / reachability re-push (RK-4 · 2026-06-09)
    //
    // start() runs once per process (didFinishLaunching). An app that sat
    // backgrounded overnight never re-pushed today's workout — the watch
    // kept yesterday's context until the next cold launch. refresh() is the
    // re-entry point: re-fetch /api/watch/today, push context, retry any
    // stranded pendingContext, and drain the completion relay queue.
    // Called on scenePhase → .active and when the watch becomes reachable.

    /// Earliest next refresh — at most one per 60s regardless of caller
    /// (mirrors FaffApp's lastImportAt throttle pattern; kept here so the
    /// foreground and reachability paths share one window).
    private var lastRefreshAt: Date = .distantPast

    func refresh() async {
        guard Date().timeIntervalSince(lastRefreshAt) > 60 else { return }
        lastRefreshAt = Date()
        await pushTodayToWatch()
        flushPendingContextIfPossible()
        await flushPendingCompletions()
    }

    /// Re-send a context stranded by an earlier failure (activation race,
    /// transient WCSession error). pushTodayToWatch normally supersedes it
    /// with a fresher payload; this covers the fetch-failed-offline case
    /// where the stranded context is still the best one we have.
    private func flushPendingContextIfPossible() {
        guard let pending = pendingContext, WCSession.isSupported(),
              WCSession.default.activationState == .activated else { return }
        do {
            try WCSession.default.updateApplicationContext(pending)
            pendingContext = nil
        } catch {
            // Keep it queued; the next activation/refresh retries.
        }
    }

    // MARK: Push today's workout to the watch

    func pushTodayToWatch() async {
        // Readiness fetch runs concurrently with the workout fetch — the
        // glance payload rides the same context push (P1-30).
        async let readinessSnap = (try? await API.fetchReadiness())
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
            // Nonce prevents updateApplicationContext being skipped when content
            // is identical to the last delivery (watchOS compares the dict; a
            // same-day re-push would be silently dropped without this).
            ctx["syncedAt"] = Date().timeIntervalSinceReferenceDate
            // workout / message — decode the response shape and route.
            let obj = try JSONSerialization.jsonObject(with: raw) as? [String: Any] ?? [:]
            if obj["workout"] != nil {
                // Re-encode just the workout object as Data (watch decodes Data → WatchWorkout)
                let workoutJSON = try JSONSerialization.data(withJSONObject: obj["workout"] as Any)
                ctx["workout"] = workoutJSON
            } else if let msg = obj["message"] as? String {
                ctx["noWorkout"] = msg
            }
            // Readiness for the watch glance (P1-30). Fall back to the last
            // good payload so a transient /api/readiness failure doesn't
            // blank an already-lit glance.
            if let snap = await readinessSnap,
               let r = Self.readinessPayload(from: snap) {
                lastReadinessPayload = r
            }
            if let r = lastReadinessPayload { ctx["readiness"] = r }
            sendContext(ctx)
        } catch {
            lastSyncStatus = "Watch fetch error: \(error.localizedDescription)"
        }
    }

    private func sendContext(_ context: [String: Any]) {
        lastContext = context
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

    /// Durable save for iPhone-authored completions (treadmill console ·
    /// audit P1-21). The payload is the same WatchCompletion wire shape the
    /// watch relay uses, POSTed to the same endpoint, so it rides the SAME
    /// UserDefaults-backed queue: persisted BEFORE the first POST attempt,
    /// retried on launch (activationDidComplete), foreground (refresh()) and
    /// watch-reachability until the server 2xx/409s. Gyms are the canonical
    /// dead-signal environment — a failed POST must never mean data loss.
    ///
    /// Returns `true` when the payload synced during this call, `false` when
    /// it stayed queued (offline · 5xx · 401). Either way the run is safe on
    /// disk; the caller can dismiss.
    func saveCompletionDurably(_ data: Data) async -> Bool {
        enqueue(data)
        await flushPendingCompletions()
        return !pendingCompletions.contains(data)
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

    /// Ask the watch to start an indoor-running HR session.
    /// Returns `true` if the message was *sent* (watch was reachable at send
    /// time). The watch's actual acknowledgement is reflected in
    /// `treadmillSessionConfirmed` once the reply handler fires (async).
    /// P-6 2026-06-10: prior doc said "returns whether the watch acknowledged"
    /// but the replyHandler was `{ _ in }` — always `true` if reachable,
    /// regardless of whether the watch session actually started.
    @discardableResult
    func startTreadmillHRSession(sessionId: String) -> Bool {
        guard WCSession.isSupported() else { return false }
        let s = WCSession.default
        guard s.activationState == .activated, s.isReachable else { return false }
        treadmillSessionConfirmed = false
        s.sendMessage(
            ["request": "startTreadmillHR", "sessionId": sessionId],
            replyHandler: { [weak self] reply in
                Task { @MainActor [weak self] in
                    self?.treadmillSessionConfirmed = reply["ok"] != nil
                }
            },
            errorHandler: { [weak self] err in
                Task { @MainActor [weak self] in self?.treadmillSessionConfirmed = false }
                print("[WatchSync] startTreadmillHR failed: \(err.localizedDescription)")
            }
        )
        return true
    }

    /// Ask the watch to end the indoor-running HR session. Idempotent ·
    /// safe to call even if the watch never received the start.
    ///
    /// P2-49 (2026-07-06): the stop used to be sent ONLY when the watch was
    /// reachable at that instant — a watch briefly out of range at End kept
    /// its indoor workout session running for hours. Now the unreachable /
    /// failed path falls back to transferUserInfo, which watchOS delivers on
    /// the next connection; the watch's own dead-man timer (no phone ping)
    /// is the second layer.
    func stopTreadmillHRSession(sessionId: String) {
        guard WCSession.isSupported() else { return }
        let s = WCSession.default
        guard s.activationState == .activated else { return }
        guard s.isReachable else {
            s.transferUserInfo(["treadmillStop": sessionId])
            return
        }
        s.sendMessage(
            ["request": "stopTreadmillHR", "sessionId": sessionId],
            replyHandler: { _ in },
            errorHandler: { err in
                print("[WatchSync] stopTreadmillHR failed: \(err.localizedDescription)")
                // Queue the durable fallback · delivered on next connection.
                WCSession.default.transferUserInfo(["treadmillStop": sessionId])
            }
        )
    }

    /// Keepalive while the treadmill console is live (P2-49). The watch
    /// resets its dead-man timer on every ping; when pings stop arriving
    /// (phone died, app killed, runner walked off) the watch auto-ends the
    /// HR session instead of sampling for hours. Best-effort · no reply.
    func pingTreadmillHRSession(sessionId: String) {
        guard WCSession.isSupported() else { return }
        let s = WCSession.default
        guard s.activationState == .activated, s.isReachable else { return }
        s.sendMessage(
            ["request": "pingTreadmillHR", "sessionId": sessionId],
            replyHandler: nil,
            errorHandler: { _ in /* best-effort · dead-man covers the gap */ }
        )
    }

    func flushPendingCompletions() async {
        let q = pendingCompletions
        guard !q.isEmpty else { return }
        var keep: [Data] = []
        var anySucceeded = false
        for data in q {
            let ok = await postCompletion(data)
            if !ok { keep.append(data) }
            else { anySucceeded = true }
        }
        pendingCompletions = keep
        // Trigger a plan refresh so TodayView picks up the new completedRunId
        // and pivots to the post-run view without waiting for the next
        // foreground wakeup.
        if anySucceeded {
            NotificationCenter.default.post(name: .faffForegroundRefresh, object: nil)
        }
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
            if (200..<300).contains(http.statusCode) { return true }
            // 409 = already accepted (idempotent backend) → treat as success, drop from queue.
            if http.statusCode == 409 { return true }
            // Other 4xx (400 bad-request, 404 not-found, etc.) are permanent client errors —
            // retrying will never succeed; dead-letter by returning true so the caller drops it.
            if (400..<500).contains(http.statusCode) && http.statusCode != 401 { return true }
            return false  // 401 (needs re-auth) or 5xx — keep and retry
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

    /// Watch sent a large completion via transferFile (audit RK-2 fallback: payloads
    /// >60 KB exceed transferUserInfo cap; the watch uses transferFile instead).
    nonisolated func session(_ session: WCSession, didReceive file: WCSessionFile) {
        guard file.metadata?["completion"] as? String == "v1" else { return }
        guard let data = try? Data(contentsOf: file.fileURL) else { return }
        Task { @MainActor in
            self.enqueue(data)
            await self.flushPendingCompletions()
        }
    }

    /// Watch just came into reach (app opened on wrist, Bluetooth back) —
    /// push a fresh context + drain queues. Same 60s throttle as the
    /// foreground path (inside refresh()), so reachability flaps can't
    /// hammer /api/watch/today. (RK-4)
    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        guard session.isReachable else { return }
        Task { @MainActor in await self.refresh() }
    }

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
                    // Include the auth token so the watch can POST completions
                    // directly after a fresh install (without waiting for the next
                    // applicationContext push). The watch already gets it via context,
                    // but a sendMessage reply is faster on first launch.
                    if let t = TokenStore.shared.token { reply["authToken"] = t }
                    if let w = obj["workout"], JSONSerialization.isValidJSONObject(w) {
                        // Gate with isValidJSONObject — see didReceiveUserInfo
                        // comment above for the NSException-vs-try? story.
                        reply["workout"] = (try? JSONSerialization.data(withJSONObject: w)) ?? Data()
                    } else if let msg = obj["message"] as? String {
                        reply["noWorkout"] = msg
                    }
                    // Readiness for the glance (P1-30). Cached payload keeps
                    // the reply fast; a cold start (no cache yet) fetches once.
                    if self.lastReadinessPayload == nil,
                       let snap = try? await API.fetchReadiness() {
                        self.lastReadinessPayload = Self.readinessPayload(from: snap)
                    }
                    if let r = self.lastReadinessPayload { reply["readiness"] = r }
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
