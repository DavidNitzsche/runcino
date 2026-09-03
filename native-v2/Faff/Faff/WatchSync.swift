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
    /// Mirrors `WCSession.isReachable` as an observable value. Added for the
    /// pre-run lobby (`RunLobbyV5`), which needs to show live watch
    /// reachability without polling `WCSession.default` directly. Updated
    /// wherever the delegate already reads reachability for its own logic —
    /// this never changes what those call sites decide, it only publishes
    /// the same fact somewhere a SwiftUI view can observe it.
    @Published private(set) var isReachable = false
    /// True once the watch replies "ok" to a `startTreadmillHR` message.
    /// P-6: prior code returned `true` on reachability alone; this is the
    /// real ack flag for TreadmillView's "live HR" affordance.
    @Published private(set) var treadmillSessionConfirmed = false

    // MARK: - DUPLICATE-1 (2026-09-03) · cross-device recording lock
    //
    // Explicit tile selection (Decision 1) closes the routing path THROUGH
    // this app's own lobby — it does nothing about a runner starting the
    // watch directly from its face and separately starting the phone (or
    // the reverse). "Add a shared live-session identity communicated
    // through WatchConnectivity... before phone recording begins, check
    // for an active Watch session."
    //
    // `applicationContext` is the right primitive: it always carries the
    // FULL current state (not a diff), is delivered even across a
    // disconnection (queued and redelivered on reconnect), and the watch
    // side (`PhoneSync.publishActiveWorkout`, legacy/native's watch target)
    // publishes through the identical channel this file already uses to
    // push readiness and today's workout — one shared primitive, not a
    // second wire invented for this.
    //
    // A missing key on a fresh context is read as "no active workout," per
    // Rule 11 (three facts: an id, an explicit absence, or "never told") —
    // this file has never once received an application context before this
    // round, so `watchActiveWorkoutId` starts `nil` and stays that way
    // until the watch actually says otherwise.
    @Published private(set) var watchActiveWorkoutId: String?
    private var watchActiveWorkoutStampedAt: Date?

    /// A staleness ceiling, not the primary mechanism — the watch is
    /// expected to clear its own flag on End, the same way it clears
    /// `treadmillSessionConfirmed`'s underlying session. This exists only
    /// so a flag the watch failed to clear (a killed process, a crash
    /// mid-run) cannot block every future phone start forever — Rule 11
    /// again: a stale "yes" and a live "yes" are different facts, and only
    /// one of them should still gate a start hours later.
    private static let activeWorkoutStaleAfter: TimeInterval = 6 * 60 * 60

    /// What `LiveRunHostV5` actually reads before starting the phone
    /// tracker for `.outdoor` — the raw id alone does not answer "is this
    /// still true right now."
    var watchActiveWorkoutIsCurrent: Bool {
        guard watchActiveWorkoutId != nil, let stampedAt = watchActiveWorkoutStampedAt else { return false }
        return Date().timeIntervalSince(stampedAt) <= Self.activeWorkoutStaleAfter
    }

    /// The phone's own half of the same handshake — published so the watch
    /// (once it reads this app's context) can refuse a direct-from-wrist
    /// start while the phone already owns a session. Symmetric with
    /// `watchActiveWorkoutId`: `nil` clears the key entirely rather than
    /// sending an empty string, so a stale reader cannot mistake "cleared"
    /// for "started, empty id."
    func publishPhoneActiveWorkout(id: String?) {
        var ctx = lastContext ?? [:]
        if let id {
            ctx["phoneActiveWorkoutId"] = id
            ctx["phoneActiveWorkoutStartedAt"] = Date().timeIntervalSinceReferenceDate
        } else {
            ctx.removeValue(forKey: "phoneActiveWorkoutId")
            ctx.removeValue(forKey: "phoneActiveWorkoutStartedAt")
        }
        sendContext(ctx)
    }

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
    ///
    /// NOTHING HERE MAY INSTRUCT (2026-09-02). Readiness no longer changes a
    /// training decision, so the wrist gets the readings and not a verdict on
    /// them. Two things carry that:
    ///
    ///   · `label` is `/api/readiness`'s own band word — SHARP / READY /
    ///     MODERATE / PULL BACK — which names where the score sits. It is not
    ///     the "Primed / Hold easy / Back off" grammar the old glance had.
    ///   · `recommendation` is a WIRE KEY the watch decoder requires, not a
    ///     recommendation. What it carries is `formLine`, the TSB caption
    ///     ("Form +8 · fresh"), which is a reading. Renaming the key means
    ///     changing `WatchReadiness` and `/api/watch/readiness` together, so
    ///     it is left as-is and named here instead. If anything ever puts an
    ///     instruction in this slot because of what the key is called, that
    ///     is the bug this comment exists to stop.
    static func readinessPayload(from snap: ReadinessSnapshot) -> Data? {
        // /api/readiness bands: sharp | ready | moderate | pull-back | unknown.
        // The watch's `state` is a TINT, not a verdict: green / yellow / red
        // colour the reading, they do not tell the runner what to run.
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

    /// `force` bypasses the 60s throttle for an explicit runner-initiated
    /// retry (the pre-run lobby's "Retry" button) — the throttle exists to
    /// stop background triggers hammering the endpoint, not to make a
    /// runner's own tap into a silent no-op.
    func refresh(force: Bool = false) async {
        guard force || Date().timeIntervalSince(lastRefreshAt) > 60 else { return }
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

            /* HR-SEMANTICS-2 (2026-09-01) · TODAY'S AEROBIC CEILING REACHES THE
             * PHONE ALARM.
             *
             * `HRAlerter` has never fired for anyone: `configure` had no call
             * site, so its ceiling was a `UserDefaults` value nothing wrote.
             * This is the one place on the phone that already holds today's
             * prescription, so it is where the number comes from — the SAME
             * `hrCeilingBpm` the wrist guardrail uses, not a second derivation.
             *
             * Absent on a quality day, a race, and a long run with a race-pace
             * finish (`resolveHrCeiling` suppresses it there on purpose), and
             * nil DISARMS the alarm for the day rather than leaving yesterday's
             * easy-day number watching a threshold session. */
            let workoutDict = obj["workout"] as? [String: Any]
            let todaysCeiling = (workoutDict?["hrCeilingBpm"] as? NSNumber)?.intValue
            await MainActor.run { HRAlerter.shared.applyTodaysCeiling(todaysCeiling) }
            // THE GLANCE, ON BOTH BRANCHES.
            //
            // The 0821 lobby pages poster → breakdown → week, shows a session
            // that has already changed with the reason stated once, and draws
            // a reasoned refusal on a rest day. All three read `weekStrip`,
            // `sessionMoved` and `dayState`, which the server has emitted
            // since 2026-08-21 and this relay threw away: the line above
            // re-serialises ONLY `obj["workout"]`, so every glance object was
            // built, sent over the network, parsed here, and dropped one hop
            // before the decoder written for it.
            //
            // Nothing errored. The week page simply never appeared, and a
            // rest day fell back to the bare message string.
            //
            // The whole body goes under its own key rather than replacing
            // `ctx["workout"]`, because a deployed watch decodes that key
            // strictly as a WatchWorkout and would reject the envelope.
            ctx["glance"] = raw
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

    /// The cap drops the NEWEST, not the oldest.
    ///
    /// This file's own docblock, twenty lines down, says "a failed POST must
    /// never mean data loss" — and the trim was `removeFirst`, which discards
    /// the runs that have been waiting longest and are therefore the ones
    /// least likely to be recoverable from anywhere else. A watch run that
    /// failed to send last week outranks one recorded ten seconds ago that is
    /// still sitting in memory upstream.
    ///
    /// Fifty completions is already far past any honest backlog, so reaching
    /// the cap at all means something is wrong. Refusing the newest at least
    /// fails in the direction that keeps the older evidence.
    fileprivate func enqueue(_ data: Data) {
        var q = pendingCompletions
        guard q.count < Self.maxPending else {
            lastSyncStatus = "Relay queue full · \(q.count) runs still unsent"
            return
        }
        q.append(data)
        pendingCompletions = q
    }

    /// Far past any honest backlog. Reaching it means the drain is failing.
    static let maxPending = 50

    /// Durable save for iPhone-authored completions (treadmill console ·
    /// audit P1-21). The payload is the same WatchCompletion wire shape the
    /// watch relay uses, POSTed to the same endpoint, so it rides the SAME
    /// UserDefaults-backed queue: persisted BEFORE the first POST attempt,
    /// retried on launch (activationDidComplete), foreground (refresh()) and
    /// watch-reachability until the server 2xx/409s. Gyms are the canonical
    /// dead-signal environment — a failed POST must never mean data loss.
    ///
    /// Returns `true` when the payload synced during this call, `false` when
    /// it stayed queued (offline · 5xx · 401, a drain already running, or the
    /// post-failure backoff still holding). Either way the run is safe on
    /// disk; the caller can dismiss.
    ///
    /// `false` is now always honest. It used to be readable as `true` off a
    /// concurrent drain's stale write-back — the console reporting a saved
    /// run that had just been erased from the queue.
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

    /// Non-nil while a treadmill start is unconfirmed — the sessionId to
    /// retry the LIVE handshake for the moment the watch becomes reachable
    /// (`sessionReachabilityDidChange` below). Cleared on confirm or stop.
    ///
    /// 2026-08-28 · David: "how do I know it's linked? It's confusing." The
    /// durable `transferUserInfo` fallback below has no reply channel, so a
    /// watch that was unreachable at Start and only comes into range later
    /// (opened on the wrist, exactly what the phone's own prompt asks for)
    /// left `treadmillSessionConfirmed` false FOREVER — the phone's prompt
    /// never updated one way or the other, confirmed or failed, regardless
    /// of whether the watch actually picked it up. Tracking the pending id
    /// lets reachability-change retry the LIVE path, which DOES get a real
    /// reply, turning "we don't know" into an answer within seconds of the
    /// runner doing exactly what the prompt told them to do.
    private var pendingTreadmillSessionId: String?

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
        guard s.activationState == .activated else { return false }
        treadmillSessionConfirmed = false
        pendingTreadmillSessionId = sessionId
        // 2026-08-27 · durable start, mirroring stopTreadmillHRSession below.
        // An unreachable watch at the exact moment the console appears used to
        // mean the bridge never engaged for the whole run — no retry until the
        // next 60s poll, itself gated on the same reachability check. Queue the
        // durable fallback so a watch that wakes mid-run still gets the start.
        guard s.isReachable else {
            s.transferUserInfo(["treadmillStart": sessionId])
            return false
        }
        sendLiveTreadmillStart(sessionId: sessionId)
        return true
    }

    /// The live half of `startTreadmillHRSession` — split out so
    /// `sessionReachabilityDidChange` can retry it without re-running the
    /// reachability gate (it's calling this BECAUSE reachability just
    /// changed to true) or re-queuing another durable fallback on top of the
    /// one already in flight.
    private func sendLiveTreadmillStart(sessionId: String) {
        WCSession.default.sendMessage(
            ["request": "startTreadmillHR", "sessionId": sessionId],
            replyHandler: { [weak self] reply in
                Task { @MainActor [weak self] in
                    // 2026-08-27 · the watch's actual reply is
                    // {"status": "started", "sessionId": ...} — there is no
                    // "ok" key and never has been, so this read was checking
                    // for a key that can't exist and treadmillSessionConfirmed
                    // was permanently false regardless of whether the watch
                    // session actually started.
                    let ok = (reply["status"] as? String) == "started"
                    self?.treadmillSessionConfirmed = ok
                    if ok { self?.pendingTreadmillSessionId = nil }
                }
            },
            errorHandler: { [weak self] err in
                Task { @MainActor [weak self] in self?.treadmillSessionConfirmed = false }
                print("[WatchSync] startTreadmillHR failed: \(err.localizedDescription)")
            }
        )
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
        if pendingTreadmillSessionId == sessionId { pendingTreadmillSessionId = nil }
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

    /// Distance / elapsed time / pace, pushed to the watch every tick while
    /// the treadmill run is live — the watch has no independent way to know
    /// any of these (no GPS indoors, and the belt's speed × time arithmetic
    /// lives entirely on the phone), so `TreadmillHRView` cannot show David's
    /// "in run layout" (distance/time/pace/HR, same as the outdoor faces)
    /// without the phone handing it these numbers directly.
    ///
    /// Best-effort, like the ping above · a live tally that misses one tick
    /// gets the next one a second later, so there is nothing worth a durable
    /// retry here. Silently no-ops when unreachable — the watch just holds
    /// its last-known values rather than freezing on an error.
    func sendTreadmillLiveStats(sessionId: String, distanceMi: Double, elapsedSec: Int, paceSecPerMi: Int?) {
        guard WCSession.isSupported() else { return }
        let s = WCSession.default
        guard s.activationState == .activated, s.isReachable else { return }
        var payload: [String: Any] = [
            "request": "treadmillStats",
            "sessionId": sessionId,
            "distanceMi": distanceMi,
            "elapsedSec": elapsedSec,
        ]
        if let paceSecPerMi { payload["paceSecPerMi"] = paceSecPerMi }
        s.sendMessage(payload, replyHandler: nil, errorHandler: { _ in /* best-effort */ })
    }

    /// Guards against a flush that is already running, and against the whole
    /// queue re-POSTing on a failure that will fail identically for all of it.
    ///
    /// ─────────────────────────────────────────────────────────────────────
    /// WHY `flushing` IS SAFE, AND WHAT WOULD BREAK IT
    ///
    /// A check-then-act flag is only atomic if nothing suspends between the
    /// check and the set. `WatchSync` is `@MainActor` (see the class
    /// declaration), and every statement from `guard !flushing` down to
    /// `flushing = true` is synchronous — the UserDefaults read, the empty
    /// test, the backoff test. So two triggers cannot both observe `false`.
    ///
    /// That is a property of the code between those two lines, not of the
    /// flag. Putting ANY `await` in that span — an async token read, an
    /// async reachability probe — reintroduces the race the flag exists to
    /// prevent, and the compiler will not say so: the iPhone target builds
    /// at `SWIFT_STRICT_CONCURRENCY: minimal`. Set the flag first if
    /// anything ever needs to await up there.
    private var flushing = false
    /// Set when a trigger fired during a drain, so the drain loops again
    /// rather than leaving the newcomer stranded. Without it the guard above
    /// silently swallows the arrival: `didReceiveUserInfo` enqueues and then
    /// calls this, and that call returns at the guard having done nothing.
    private var flushAgain = false
    private var lastFlushFailedAt: Date?
    /// After a whole-queue failure, wait before trying again. Three unthrottled
    /// triggers feed this — session activation, file receive, userInfo receive
    /// — and each used to fan out the entire queue back to back. With an
    /// expired session that is up to fifty POSTs that all 401, fifty times,
    /// each one posting `.faffSessionExpired`.
    private static let retryBackoffSec: TimeInterval = 60

    /// ─────────────────────────────────────────────────────────────────────
    /// THE WRITE-BACK REMOVES WHAT LANDED · IT DOES NOT ASSIGN A SNAPSHOT
    ///
    /// This is the second half of the `flushing` guard, and without it the
    /// guard makes a run LESS safe rather than more.
    ///
    /// `q` is read once, then every POST releases the main actor for as long
    /// as the network takes. Five triggers can enqueue into that window:
    /// session activation, `didReceive file:`, `didReceiveUserInfo`,
    /// reachability, and `saveCompletionDurably` (treadmill End, outdoor End,
    /// and the interrupted-run flush). Assigning `pendingCompletions = keep`
    /// — a list derived entirely from `q` — erases every one of them.
    ///
    /// Concretely, and this is now a single interleaving rather than a race:
    ///
    ///   1. Queue is [A]. A drain starts, snapshots [A], awaits POST A.
    ///   2. The watch delivers B. `didReceiveUserInfo` → `enqueue(B)` →
    ///      queue is [A, B] → it calls this, which returns at `flushing`.
    ///   3. POST A returns 200. `keep` is empty. The write assigns [].
    ///
    /// B is now neither on the server nor on disk. It is gone, and it was
    /// destroyed by the drain that was told about it. The runner is shown
    /// "will sync later" and never sees the run again. Gyms are the
    /// canonical dead-signal environment; this is exactly the loss the
    /// durable queue exists to prevent.
    ///
    /// So: re-read the queue after the POSTs and remove exactly what the
    /// server accepted. Anything that arrived mid-flight survives by
    /// construction, and the re-run loop picks it up on the next pass
    /// instead of stranding it until the next foreground.
    func flushPendingCompletions() async {
        // One at a time. Two triggers arriving together used to run two full
        // drains over the same array and race on the write-back.
        guard !flushing else {
            flushAgain = true
            return
        }
        if let failedAt = lastFlushFailedAt,
           Date().timeIntervalSince(failedAt) < Self.retryBackoffSec {
            return
        }
        guard !pendingCompletions.isEmpty else { return }
        flushing = true
        defer { flushing = false }

        repeat {
            flushAgain = false
            let q = pendingCompletions
            if q.isEmpty { break }

            var landed: [Data] = []
            var stalled = false
            for data in q {
                if await postCompletion(data) {
                    landed.append(data)
                } else {
                    // The first refusal stops the run: this item and
                    // everything after it stay queued. Whatever made it fail
                    // — no session, no network, the server down — applies to
                    // the rest of the queue too, and walking on earns one
                    // repeated failure per item. With an expired session that
                    // was up to fifty POSTs that all 401, each posting
                    // .faffSessionExpired.
                    lastFlushFailedAt = Date()
                    stalled = true
                    break
                }
            }

            if !landed.isEmpty {
                // Re-read. The queue as it stands NOW includes anything
                // enqueued while those POSTs were in flight; `q` does not.
                // One removal per success, so a payload legitimately enqueued
                // twice loses exactly the copies the server accepted.
                var live = pendingCompletions
                for done in landed {
                    if let i = live.firstIndex(of: done) { live.remove(at: i) }
                }
                pendingCompletions = live
                // Trigger a plan refresh so TodayView picks up the new
                // completedRunId and pivots to the post-run view without
                // waiting for the next foreground wakeup.
                NotificationCenter.default.post(name: .faffForegroundRefresh, object: nil)
            }
            if stalled { break }
            lastFlushFailedAt = nil
        } while flushAgain
        // No suspension point between the loop test and the `defer`, so a
        // `flushAgain` set by another trigger either lands before the test
        // (and loops) or after `flushing` clears (and starts a fresh drain).
        // Neither can be dropped.
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
        isReachable = s.isReachable
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

    /// DUPLICATE-1 · the watch's half of the handshake, received. Always the
    /// FULL current context (WatchConnectivity's own contract, not a diff),
    /// so a context that omits `activeWorkoutId` is read as "no longer
    /// active" — never "unchanged, ask again later." This is the one
    /// applicationContext-receiving delegate method on the phone; nothing
    /// previously read anything the watch sent back through this channel.
    nonisolated func session(_ session: WCSession,
                             didReceiveApplicationContext applicationContext: [String: Any]) {
        let id = applicationContext["activeWorkoutId"] as? String
        let stampedAt = (applicationContext["activeWorkoutStartedAt"] as? TimeInterval)
            .map { Date(timeIntervalSinceReferenceDate: $0) }
        Task { @MainActor in
            self.watchActiveWorkoutId = id
            self.watchActiveWorkoutStampedAt = id != nil ? (stampedAt ?? Date()) : nil
        }
    }

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
        let reachable = session.isReachable
        Task { @MainActor in self.isReachable = reachable }
        guard reachable else { return }
        Task { @MainActor in
            await self.refresh()
            // 2026-08-28 · the watch coming into reach is exactly the moment
            // a queued `treadmillStart` transferUserInfo delivers — but
            // transferUserInfo has no reply, so this is the phone's only
            // chance to find out whether it actually took. Retry the LIVE
            // handshake, which DOES get a real reply now that the watch is
            // reachable. See `pendingTreadmillSessionId`'s doc for the full
            // story — this closes the "prompt never updates" confusion.
            if let sessionId = self.pendingTreadmillSessionId, !self.treadmillSessionConfirmed {
                self.sendLiveTreadmillStart(sessionId: sessionId)
            }
        }
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

// MARK: - Test seam
//
// `WatchSync` is a singleton, so the drain's guard flag and its post-failure
// backoff persist across every test in a bundle: a test that legitimately
// fails a POST leaves the next one unable to drain at all. Compiled out of
// release builds, and it resets only the drain's own bookkeeping — never the
// queue, which is the durability contract and belongs to the caller.

#if DEBUG
extension WatchSync {
    func resetDrainStateForTesting() {
        flushing = false
        flushAgain = false
        lastFlushFailedAt = nil
    }
}
#endif
