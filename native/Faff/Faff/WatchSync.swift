//
//  WatchSync.swift
//  Faff
//
//  iPhone side of the iPhone↔watch bridge (WatchConnectivity).
//
//  Design goal: the watch workout "is just there" — no manual push.
//  Two mechanisms cover that:
//
//    1. updateApplicationContext — whenever the iPhone app fetches
//       today's workout, it sets it as the session's application
//       context. WatchConnectivity delivers the latest context to the
//       watch automatically (even in the background), so it's present
//       the next time the watch app opens.
//
//    2. didReceiveMessage — when the watch opens and is reachable, it
//       asks the iPhone directly; we fetch fresh and reply.
//
//  Completion writeback: the watch sends its WatchCompletion payload via
//  transferUserInfo; we receive it here and POST it to the backend.
//

import Foundation
import Combine
import WatchConnectivity

@MainActor
final class WatchSync: NSObject, ObservableObject {
    static let shared = WatchSync()

    /// Human-readable last-sync state, surfaced on the iPhone TodayView.
    @Published private(set) var lastSyncStatus: String?

    /// Real pairing state (WCSession), surfaced in Profile so the Apple
    /// Watch row reflects whether a watch is paired with the Faff watch
    /// app installed — there is no "connect" step; pairing is the link.
    @Published private(set) var isPaired = false
    @Published private(set) var isWatchAppInstalled = false

    @MainActor private func refreshPairing() {
        guard WCSession.isSupported() else { return }
        let s = WCSession.default
        isPaired = s.isPaired
        isWatchAppInstalled = s.isWatchAppInstalled
    }

    /// Latest context we want the watch to have, retained until the
    /// session is activated (updateApplicationContext fails pre-activation).
    private var pendingContext: [String: Any]?

    private override init() { super.init() }

    // MARK: Lifecycle

    func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    // MARK: Push today's workout to the watch

    /// Fetch today's workout and hand it to the watch as application
    /// context. Called automatically on login + on every TodayView
    /// refresh — never from a user-facing button.
    func syncTodayToWatch() async {
        guard WCSession.isSupported() else { return }
        var ctx: [String: Any] = [:]
        // Readiness glance (§G) — available any day; push it alongside the workout.
        if let readiness = try? await FaffAPI.shared.fetchReadinessRaw() { ctx["readiness"] = readiness }
        do {
            let data = try await FaffAPI.shared.fetchTodayRaw()
            let peek = try? JSONDecoder().decode(TodayPeek.self, from: data)
            if let peek, peek.workoutId != nil {
                ctx["workout"] = data
                lastSyncStatus = "Synced to watch ✓"
            } else {
                ctx["noWorkout"] = peek?.message ?? "No workout today"
                lastSyncStatus = "Watch: \(peek?.message ?? "No workout today")"
            }
        } catch {
            lastSyncStatus = "Watch sync failed: \(error.localizedDescription)"
        }
        if !ctx.isEmpty { sendContext(ctx) }
    }

    private func sendContext(_ context: [String: Any]) {
        let session = WCSession.default
        guard session.activationState == .activated else {
            pendingContext = context
            return
        }
        do {
            try session.updateApplicationContext(context)
        } catch {
            pendingContext = context
            lastSyncStatus = "Watch context error: \(error.localizedDescription)"
        }
    }

    /// Reply payload for a watch-initiated request (synchronous-ish).
    fileprivate func todayReply() async -> [String: Any] {
        var reply: [String: Any] = [:]
        if let readiness = try? await FaffAPI.shared.fetchReadinessRaw() { reply["readiness"] = readiness }
        do {
            let data = try await FaffAPI.shared.fetchTodayRaw()
            let peek = try? JSONDecoder().decode(TodayPeek.self, from: data)
            if let peek, peek.workoutId != nil { reply["workout"] = data }
            else { reply["noWorkout"] = peek?.message ?? "No workout today" }
        } catch {}
        return reply
    }
}

// MARK: - WCSessionDelegate (background-queue callbacks)

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
        }
    }

    // iOS requires these two; re-activate after a paired-watch switch.
    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}
    nonisolated func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    /// The watch asks for today's workout on launch (when reachable).
    nonisolated func session(_ session: WCSession,
                             didReceiveMessage message: [String: Any],
                             replyHandler: @escaping ([String: Any]) -> Void) {
        guard message["request"] as? String == "today" else {
            replyHandler([:])
            return
        }
        Task { @MainActor in
            replyHandler(await self.todayReply())
        }
    }

    /// The watch finished a workout and sent its completion payload.
    nonisolated func session(_ session: WCSession,
                             didReceiveUserInfo userInfo: [String: Any]) {
        guard let data = userInfo["completion"] as? Data else { return }
        Task { @MainActor in
            do {
                try await FaffAPI.shared.postWatchCompletion(data)
                self.lastSyncStatus = "Workout completion uploaded ✓"
            } catch {
                self.lastSyncStatus = "Completion upload failed: \(error.localizedDescription)"
            }
        }
    }
}

// MARK: - Lightweight peek at the /api/watch/today shape

/// Just enough of the payload to decide workout-vs-rest without
/// re-modeling the whole thing (we forward the raw Data either way).
private struct TodayPeek: Decodable {
    let workoutId: String?
    let message: String?
    let reason: String?
}
