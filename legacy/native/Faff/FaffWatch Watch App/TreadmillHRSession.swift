//
//  TreadmillHRSession.swift   (FaffWatch · build matched to iPhone 137)
//
//  Lightweight HKWorkoutSession that activates fast HR sampling for the
//  iPhone TreadmillView. The iPhone is the primary UI · this session
//  exists ONLY to flip the watch into "active workout" mode so the HR
//  sensor polls every 5-15s instead of the passive every-5-minutes
//  baseline. The samples land in HK, the iPhone's
//  TreadmillHRStreamer reads them, and the runner sees live BPM on the
//  treadmill console.
//
//  Distinct from WorkoutTracker:
//    · WorkoutTracker drives the Faff watch app's own structured
//      outdoor run (countdown, phase haptics, GPS route, finishes the
//      HKWorkout). Owned by WorkoutEngine.
//    · TreadmillHRSession runs in parallel · no UI flow, no route, no
//      cadence, no completion payload. Just opens the workout session
//      so HR streams. The iPhone POSTs the completion to the backend
//      with its own per-phase actuals; this session doesn't save the
//      HKWorkout (call `discardWorkout()` on end so HK doesn't keep an
//      unwanted "Indoor Run" entry duplicating the treadmill run).
//
//  Lifecycle:
//    · PhoneSync receives `startTreadmillHR` → start()
//    · session runs; HK streams HR samples in the background
//    · PhoneSync receives `stopTreadmillHR` OR runner taps Stop on
//      TreadmillHRView → end()
//

import Foundation
import Combine
import HealthKit

@MainActor
final class TreadmillHRSession: NSObject, ObservableObject {
    static let shared = TreadmillHRSession()

    private let healthStore = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?

    /// Streaming flag · drives WorkoutRootView's route into TreadmillHRView.
    @Published private(set) var isActive: Bool = false
    /// Live HR for the watch's own display (the iPhone reads its own
    /// copy from HK directly via TreadmillHRStreamer).
    @Published private(set) var currentBpm: Int = 0
    /// Session start · used by the view to show "running for 12:34".
    @Published private(set) var startedAt: Date?
    /// SessionId from the iPhone · echoed back so the phone can match
    /// stop responses to the start it asked for.
    @Published private(set) var sessionId: String?

    private override init() { super.init() }

    /// Idempotent. If a session is already active for the same sessionId,
    /// no-op. If a session exists for a DIFFERENT sessionId, the old one
    /// is torn down first (the iPhone restarted treadmill before stopping
    /// us cleanly · happens on app crash + relaunch).
    func start(sessionId: String) {
        if isActive, self.sessionId == sessionId { return }
        if isActive { Task { await end() } }

        guard HKHealthStore.isHealthDataAvailable() else { return }
        let config = HKWorkoutConfiguration()
        config.activityType = .running
        config.locationType = .indoor   // ← key difference from WorkoutTracker
        do {
            let s = try HKWorkoutSession(healthStore: healthStore, configuration: config)
            let b = s.associatedWorkoutBuilder()
            b.dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: config)
            s.delegate = self
            b.delegate = self
            session = s
            builder = b
            let start = Date()
            s.startActivity(with: start)
            b.beginCollection(withStart: start) { _, _ in }
            self.sessionId = sessionId
            self.startedAt = start
            self.isActive = true
        } catch {
            // Session-start failures are rare (auth missing, conflicting
            // session). Leave isActive=false; the iPhone gracefully
            // shows no live HR pill if samples don't appear.
            session = nil
            builder = nil
        }
    }

    /// End the session. Discards the HKWorkout (we don't want a duplicate
    /// "Indoor Run" in Apple Health · the iPhone treadmill POST is the
    /// canonical source). Idempotent.
    func end() async {
        guard let session, let builder else {
            isActive = false; currentBpm = 0; startedAt = nil; sessionId = nil
            return
        }
        let endAt = Date()
        session.stopActivity(with: endAt)
        session.end()
        do {
            try await builder.endCollection(at: endAt)
            // Discard rather than finishWorkout() · we don't want this
            // session creating an "Indoor Run" HKWorkout that competes
            // with the iPhone's POST to /api/watch/workouts/complete.
            // The HR samples already streamed to HK during the session
            // are not discarded · they live on HKQuantitySample rows
            // anchored at their original timestamps.
            builder.discardWorkout()
        } catch {
            // Best-effort.
        }
        self.session = nil
        self.builder = nil
        self.isActive = false
        self.currentBpm = 0
        self.startedAt = nil
        self.sessionId = nil
    }

    // MARK: - HR plumbing for the watch's own display
    //
    // The iPhone reads HR directly from HK via TreadmillHRStreamer ·
    // it doesn't need the watch to forward anything. We pull HR off
    // the live builder ONLY so TreadmillHRView can display "162 bpm"
    // when the runner glances at the watch mid-treadmill.

    fileprivate func applyHR(_ bpm: Int) {
        if bpm > 0 { currentBpm = bpm }
    }
}

// MARK: - HKLiveWorkoutBuilderDelegate

extension TreadmillHRSession: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder,
                                    didCollectDataOf collectedTypes: Set<HKSampleType>) {
        let bpm = HKUnit.count().unitDivided(by: .minute())
        var hr: Int?
        for type in collectedTypes {
            guard let qt = type as? HKQuantityType, qt == HKQuantityType(.heartRate),
                  let stats = workoutBuilder.statistics(for: qt),
                  let q = stats.mostRecentQuantity() else { continue }
            hr = Int(q.doubleValue(for: bpm).rounded())
        }
        let hrV = hr
        Task { @MainActor in
            if let v = hrV { self.applyHR(v) }
        }
    }
}

// MARK: - HKWorkoutSessionDelegate

extension TreadmillHRSession: HKWorkoutSessionDelegate {
    nonisolated func workoutSession(_ session: HKWorkoutSession,
                                    didChangeTo toState: HKWorkoutSessionState,
                                    from fromState: HKWorkoutSessionState,
                                    date: Date) {}
    nonisolated func workoutSession(_ session: HKWorkoutSession, didFailWithError error: Error) {}
}
