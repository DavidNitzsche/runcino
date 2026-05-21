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

    func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
        // Whatever the iPhone last delivered is already waiting here.
        apply(session.receivedApplicationContext)
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

    /// Queue a finished workout's result back to the iPhone.
    func sendCompletion(_ completion: WatchCompletion) {
        guard WCSession.isSupported() else { return }
        guard let data = try? JSONEncoder().encode(completion) else { return }
        WCSession.default.transferUserInfo(["completion": data])
    }

    // MARK: Apply incoming context / reply

    fileprivate func apply(_ payload: [String: Any]) {
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
}
