//
//  TreadmillHRStreamer.swift   (build 136)
//
//  Live HR feed for the iPhone TreadmillView. When the runner is wearing
//  an Apple Watch on the treadmill, the watch streams HR samples into
//  HealthKit; we read them here in ~5-30s latency batches and surface a
//  live bpm display + per-phase avg/max for the WatchCompletion payload.
//
//  Pattern mirrors HRAlerter.swift (phone-side HR ceiling alert) ·
//  HKObserverQuery triggers a drain via HKAnchoredObjectQuery, anchored
//  at the session start so we don't pick up old samples.
//
//  Lifecycle:
//   · start(from:) on the first play tick · idempotent
//   · closePhase() at every segment boundary · returns (avg, max) for
//     the just-closed phase, resets the phase buffer
//   · closeSession() at end-of-workout · returns session-level (avg, max)
//   · stop() on view dismiss (best-effort · observer keeps registered)
//
//  Non-watch users: currentBpm stays nil, closePhase returns (nil, nil),
//  the view shows no HR pill, payload's avgHr/maxHr fields stay null.
//  Backend resolveCalories tier 3 estimator already handles null HR
//  cleanly, so this fails gracefully end-to-end.
//

import Foundation
import HealthKit

@MainActor
final class TreadmillHRStreamer: ObservableObject {
    /// Most recent bpm seen · drives the live display. Nil until the
    /// first sample lands (or forever, if no watch is paired).
    @Published private(set) var currentBpm: Int?

    /// HKHealthStore is thread-safe per Apple's docs · reads happen via
    /// callbacks, no awaits on the store directly.
    nonisolated private let store = HKHealthStore()
    private var observerActive = false
    private var anchor: HKQueryAnchor?

    /// Buffer for the current phase · cleared by closePhase().
    private var phaseSamples: [Double] = []
    /// Buffer for the whole session · cleared by closeSession().
    /// Kept separate so closePhase() doesn't disturb session-level stats.
    private var sessionSamples: [Double] = []

    /// Begin streaming HR samples. Requests HK auth on first call (no-op
    /// if already granted in the standard import auth sweep). Anchors at
    /// `when` so historical samples don't leak into the session.
    func start(from when: Date) async {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        guard !observerActive else { return }

        let hrType = HKQuantityType(.heartRate)
        _ = try? await store.requestAuthorization(toShare: [], read: [hrType])

        let predicate = HKQuery.predicateForSamples(
            withStart: when, end: nil, options: [.strictStartDate]
        )
        let observer = HKObserverQuery(sampleType: hrType, predicate: predicate) { [weak self] _, _, _ in
            Task { await self?.drain(predicate: predicate) }
        }
        store.execute(observer)
        observerActive = true

        // First drain · catches any samples that landed in the gap
        // between the watch starting its workout and our observer
        // registering.
        await drain(predicate: predicate)
    }

    /// Best-effort stop · observer query stays registered (cheap), but
    /// further drains short-circuit.
    func stop() {
        observerActive = false
    }

    /// Capture (avg, max) for the just-closed phase + reset the phase
    /// buffer. Session buffer is untouched.
    func closePhase() -> (avg: Int?, max: Int?) {
        let avg = phaseSamples.isEmpty
            ? nil
            : Int((phaseSamples.reduce(0, +) / Double(phaseSamples.count)).rounded())
        let max = phaseSamples.max().map { Int($0.rounded()) }
        phaseSamples.removeAll(keepingCapacity: true)
        return (avg, max)
    }

    /// Capture (avg, max) for the whole session.
    func closeSession() -> (avg: Int?, max: Int?) {
        let avg = sessionSamples.isEmpty
            ? nil
            : Int((sessionSamples.reduce(0, +) / Double(sessionSamples.count)).rounded())
        let max = sessionSamples.max().map { Int($0.rounded()) }
        return (avg, max)
    }

    private func drain(predicate: NSPredicate) async {
        guard observerActive else { return }
        let hrType = HKQuantityType(.heartRate)
        let bpm = HKUnit.count().unitDivided(by: .minute())
        let snapshotAnchor = self.anchor

        let (samples, newAnchor): ([HKQuantitySample], HKQueryAnchor?) = await withCheckedContinuation { cont in
            let q = HKAnchoredObjectQuery(
                type: hrType, predicate: predicate, anchor: snapshotAnchor, limit: HKObjectQueryNoLimit
            ) { _, samps, _, anchor, _ in
                cont.resume(returning: ((samps as? [HKQuantitySample]) ?? [], anchor))
            }
            store.execute(q)
        }
        self.anchor = newAnchor ?? self.anchor
        guard !samples.isEmpty else { return }

        for s in samples {
            let v = s.quantity.doubleValue(for: bpm)
            phaseSamples.append(v)
            sessionSamples.append(v)
            // Drive the live display off the newest sample.
            currentBpm = Int(v.rounded())
        }
    }
}
