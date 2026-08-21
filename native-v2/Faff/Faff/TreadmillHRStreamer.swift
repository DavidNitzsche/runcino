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
    /// The registered observer, so it can actually be retired. `stop()` used
    /// to only flip `observerActive`, leaving the query live on the store —
    /// and `start()` executes a NEW one every time it re-anchors, so a
    /// console reopened inside one app launch accumulated observers, each
    /// still firing `drain` with its OWN (earlier) predicate. That is how a
    /// previous session's heart rate leaks into this one's average.
    private var observer: HKObserverQuery?
    private var anchor: HKQueryAnchor?
    /// True while a drain is in flight. See `drain`.
    private var isDraining = false
    /// Set when the observer fired during a drain, so the samples it was
    /// telling us about are collected rather than dropped.
    private var drainAgain = false
    /// The instant this stream is anchored at · the run's start, not the
    /// screen's. Kept so a later caller with a better answer can re-anchor.
    private var anchorDate: Date?

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
        // 2026-08-21 · this was a bare `guard !observerActive else { return }`,
        // so the FIRST caller pinned the sample anchor and every later, more
        // accurate one was silently discarded. `LiveRunHostV5` used to call it
        // with "whenever the plan finished loading" and beat the console's own
        // call with the run's real start instant. That host call is gone, and
        // this now re-anchors instead of ignoring: a second start with a
        // different date, before any sample has landed, is someone telling us
        // the run actually began somewhere else. Once samples exist the
        // anchor is load-bearing and a re-anchor would discard them, so an
        // active stream with data stands.
        if observerActive {
            guard anchorDate != when, sessionSamples.isEmpty else { return }
            observerActive = false
            anchor = nil
        }
        // Retire whatever is registered before registering another. Without
        // this the old query keeps firing against its old predicate, and its
        // drains append pre-re-anchor samples into the buffers this run's
        // avg/max are computed from.
        retireObserver()
        anchorDate = when

        let hrType = HKQuantityType(.heartRate)
        _ = try? await store.requestAuthorization(toShare: [], read: [hrType])

        let predicate = HKQuery.predicateForSamples(
            withStart: when, end: nil, options: [.strictStartDate]
        )
        let q = HKObserverQuery(sampleType: hrType, predicate: predicate) { [weak self] _, _, _ in
            Task { await self?.drain(predicate: predicate) }
        }
        store.execute(q)
        observer = q
        observerActive = true

        // First drain · catches any samples that landed in the gap
        // between the watch starting its workout and our observer
        // registering. HealthKit fires the observer on registration too, so
        // this and that first callback are two drains asking for the same
        // window — `drain` is non-reentrant precisely because of this pair.
        await drain(predicate: predicate)
    }

    /// Stop streaming. The observer is retired, not merely muted.
    func stop() {
        observerActive = false
        retireObserver()
    }

    private func retireObserver() {
        if let q = observer { store.stop(q) }
        observer = nil
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

    /// Capture (avg, max) for the whole session, and reset.
    ///
    /// The reset was missing, and this object outlives a single run: the
    /// treadmill and outdoor consoles share one instance for the whole
    /// `LiveRunHostV5` lifetime, and `stop()` then `start()` gives the same
    /// instance a second run. Without the clear, run two's `avgHr` was the
    /// mean of run one and run two — and `start`'s re-anchor guard
    /// (`sessionSamples.isEmpty`) could never be satisfied again either, so
    /// run two also kept run one's anchor date.
    ///
    /// Cleared HERE and not in `stop()` on purpose: `LiveRunHostV5.end()`
    /// calls `hr.stop()` before `hr.closeSession()`, so clearing on stop
    /// would drop the heart rate off every phone-recorded outdoor run.
    func closeSession() -> (avg: Int?, max: Int?) {
        let avg = sessionSamples.isEmpty
            ? nil
            : Int((sessionSamples.reduce(0, +) / Double(sessionSamples.count)).rounded())
        let max = sessionSamples.max().map { Int($0.rounded()) }
        sessionSamples.removeAll(keepingCapacity: false)
        phaseSamples.removeAll(keepingCapacity: false)
        anchor = nil
        anchorDate = nil
        return (avg, max)
    }

    /// ─────────────────────────────────────────────────────────────────────
    /// WHY THIS IS NON-REENTRANT
    ///
    /// `anchor` is read before the HealthKit query and written after it, and
    /// the `await` between the two releases the main actor. Two drains in
    /// flight therefore both snapshot the SAME anchor, both get the SAME
    /// batch back, and both append it — every sample in that window counted
    /// twice.
    ///
    /// It is not a rare interleaving; `start` produces it on every stream.
    /// `store.execute(observer)` makes HealthKit fire the observer straight
    /// away, and the line after it awaits a drain of its own. The observer's
    /// drain runs while that one is suspended, sees `anchor == nil`, and
    /// re-reads the identical catch-up batch — the samples the watch wrote
    /// between starting its workout and this stream registering.
    ///
    /// Duplicating a whole window leaves `max` alone but pulls `avg` toward
    /// the duplicated stretch, and that average ships as `actualAvgHr` on the
    /// phase and `avgHr` on the completion. It is presented as measured, so
    /// it has to be arithmetically what was measured.
    ///
    /// The re-run flag matters as much as the guard: an observer firing
    /// during a drain is HealthKit saying there are new samples, and simply
    /// dropping that callback would lose them until the next write.
    private func drain(predicate: NSPredicate) async {
        guard observerActive else { return }
        if isDraining {
            drainAgain = true
            return
        }
        isDraining = true
        defer { isDraining = false }

        let hrType = HKQuantityType(.heartRate)
        let bpm = HKUnit.count().unitDivided(by: .minute())

        repeat {
            drainAgain = false
            guard observerActive else { break }
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
            // A stop that landed while the query was out. Advance the anchor
            // (so a later start does not re-read this window) but do not feed
            // a session that has already been closed out.
            guard observerActive else { break }
            guard !samples.isEmpty else { continue }

            for s in samples {
                let v = s.quantity.doubleValue(for: bpm)
                phaseSamples.append(v)
                sessionSamples.append(v)
                // Drive the live display off the newest sample.
                currentBpm = Int(v.rounded())
            }
        } while drainAgain
    }
}

// MARK: - Preview seam
//
// `currentBpm` is `private(set)` — real samples only come from HealthKit.
// DEBUG-only, compiled out of release builds: lets a #Preview show a live HR
// tile (or the deliberate no-source layout, by simply not calling this).

#if DEBUG
extension TreadmillHRStreamer {
    func seedForPreview(bpm: Int?) {
        currentBpm = bpm
    }
}
#endif
