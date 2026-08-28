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

    // ── Live stats from the phone (2026-08-28) ────────────────────────
    //
    // Distance, elapsed time and pace all live on the iPhone — the belt has
    // no GPS and the speed × time arithmetic is entirely the phone's
    // (`BeltSession`). Pushed here via WatchSync.sendTreadmillLiveStats so
    // TreadmillHRView can show David's "in run layout" (distance/time/pace/
    // HR) instead of bpm alone.

    @Published private(set) var liveDistanceMi: Double?
    @Published private(set) var liveElapsedSec: Int?
    /// Nil when the belt is stopped/speed is zero — a pace of "0:00" would
    /// claim a speed nobody is running at.
    @Published private(set) var livePaceSecPerMi: Int?

    // ── Runaway-session guards (audit P2-49 · 2026-07-06) ─────────────
    //
    // The stop message only arrives while the phone is reachable. Phone
    // dies / leaves range / app killed → this session used to run FOREVER
    // (continuous HR sampling, major battery drain, nothing on the watch
    // face explaining why). Two layers now bound it:
    //   · dead-man timer  · the iPhone pings every ~2 min while the
    //     treadmill console is live; no ping for DEAD_MAN_SEC → auto-end.
    //   · absolute cap    · no treadmill HR bridge session outlives
    //     ABSOLUTE_MAX_SEC regardless of pings.

    /// Auto-end when no phone ping for this long. Generous vs the phone's
    /// ~120s ping cadence so a few dropped pings don't kill a live session.
    private static let DEAD_MAN_SEC: TimeInterval = 15 * 60
    /// Hard ceiling on any treadmill HR bridge session.
    private static let ABSOLUTE_MAX_SEC: TimeInterval = 4 * 3600
    /// Last keepalive from the iPhone · seeded at start so pre-ping builds
    /// (or a phone that never pings) still get the full dead-man window.
    private var lastPhonePingAt: Date = .distantPast
    /// 60s watchdog · checks both guards while the session is active.
    private var watchdog: Timer?

    private override init() { super.init() }

    /// Keepalive from the iPhone (WatchSync.pingTreadmillHRSession).
    /// Resets the dead-man window. Ignores pings for a different session.
    func ping(sessionId: String) {
        guard isActive, self.sessionId == sessionId else { return }
        lastPhonePingAt = Date()
    }

    /// Live distance/elapsed/pace from the iPhone (WatchSync.
    /// sendTreadmillLiveStats). Same session-match guard as `ping` — a stat
    /// push for a session that isn't (or is no longer) the active one must
    /// not overwrite the current run's numbers with a stale run's.
    func applyLiveStats(sessionId: String, distanceMi: Double?, elapsedSec: Int?, paceSecPerMi: Int?) {
        guard isActive, self.sessionId == sessionId else { return }
        if let distanceMi { self.liveDistanceMi = distanceMi }
        if let elapsedSec { self.liveElapsedSec = elapsedSec }
        self.livePaceSecPerMi = paceSecPerMi
    }

    private func startWatchdog() {
        watchdog?.invalidate()
        let t = Timer(timeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.watchdogFire() }
        }
        RunLoop.main.add(t, forMode: .common)
        watchdog = t
    }

    private func watchdogFire() {
        guard isActive, let startedAt else { return }
        let now = Date()
        if now.timeIntervalSince(startedAt) >= Self.ABSOLUTE_MAX_SEC
            || now.timeIntervalSince(lastPhonePingAt) >= Self.DEAD_MAN_SEC {
            Task { await end() }
        }
    }

    /// Idempotent. If a session is already active for the same sessionId,
    /// no-op. If a session exists for a DIFFERENT sessionId, the old one
    /// is torn down first (the iPhone restarted treadmill before stopping
    /// us cleanly · happens on app crash + relaunch).
    ///
    /// 2026-08-28 · David: "the HR never worked. it said to open the watch
    /// app but the watch app never went into treadmill mode." Root cause —
    /// `WorkoutTracker.requestAuthorization()` is the ONLY place this watch
    /// app has ever requested `HKQuantityType.workoutType()` SHARE
    /// authorization, and it only runs when the runner taps Start ON THE
    /// WATCH itself (`WorkoutRootView.launch()`). A runner who always starts
    /// from the phone — which is the entire point of the treadmill bridge —
    /// never triggers that path, so the authorization can sit at
    /// `.notDetermined` indefinitely. `HKWorkoutSession(...)` below then
    /// fails into the `catch` block with nothing surfaced anywhere: `isActive`
    /// never flips true, `WorkoutRootView`'s router never switches into
    /// `TreadmillHRView()`, and the watch just sits on its ordinary lobby —
    /// exactly what was reported. `start()` now requests its own
    /// authorization first, same share/read shape `WorkoutTracker` already
    /// proves works for outdoor runs, plus the four running-form reads
    /// `TreadmillHRStreamer.swift` (iPhone) needs from this session's writes.
    func start(sessionId: String) async {
        if isActive, self.sessionId == sessionId { return }
        // Close the OLD session by value, not by property. `end()` is async,
        // so the Task ran after this synchronous body finished and operated on
        // the session this method had just created — invalidating the new
        // watchdog, discarding the new workout and clearing isActive. The one
        // scenario the comment above says this handles is the one it broke,
        // and it leaked the old HKWorkoutSession too, which kept sampling
        // system-side until the next launch's recovery sweep found it.
        if isActive {
            let staleSession = session
            let staleBuilder = builder
            session = nil
            builder = nil
            isActive = false
            Task { await Self.closeOut(session: staleSession, builder: staleBuilder) }
        }

        guard HKHealthStore.isHealthDataAvailable() else { return }

        let share: Set<HKSampleType> = [HKQuantityType.workoutType()]
        let read: Set<HKObjectType> = [
            HKQuantityType(.heartRate),
            HKQuantityType(.activeEnergyBurned),
            HKQuantityType(.runningPower),
            HKQuantityType(.runningGroundContactTime),
            HKQuantityType(.runningVerticalOscillation),
            HKQuantityType(.runningStrideLength),
        ]
        do {
            try await healthStore.requestAuthorization(toShare: share, read: read)
        } catch {
            print("[TreadmillHRSession] HealthKit authorization request failed: \(error.localizedDescription)")
            // Fall through and try anyway — a prior grant (e.g. from an
            // outdoor watch-started run) may already cover this, and a
            // failed REQUEST is not the same as a failed AUTHORIZATION.
        }

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
            // 2026-08-28 · a fresh session must not open showing the PRIOR
            // run's distance/elapsed/pace — these only ever update again
            // once the phone's first `treadmillStats` push lands.
            self.liveDistanceMi = nil
            self.liveElapsedSec = nil
            self.livePaceSecPerMi = nil
            // P2-49 · seed the dead-man window and arm the watchdog.
            self.lastPhonePingAt = start
            self.startWatchdog()
        } catch {
            // 2026-08-28 · this used to swallow the error completely — no
            // print, no state change, nothing. Session-start failures ARE
            // rare once authorization is granted, but "rare" is not "never,"
            // and a silent failure here is indistinguishable from the bridge
            // simply not being asked to start at all.
            print("[TreadmillHRSession] HKWorkoutSession start failed: \(error.localizedDescription)")
            session = nil
            builder = nil
        }
    }

    /// End the session. Discards the HKWorkout (we don't want a duplicate
    /// "Indoor Run" in Apple Health · the iPhone treadmill POST is the
    /// canonical source). Idempotent.
    /// Close a session by VALUE, so a restart cannot tear down the session it
    /// just created. Deliberately `static` and deliberately takes its
    /// arguments: there is no path from here to `self.session`, which is what
    /// makes the restart race unrepresentable rather than merely fixed.
    private static func closeOut(session: HKWorkoutSession?,
                                 builder: HKLiveWorkoutBuilder?) async {
        guard let session, let builder else { return }
        let endAt = Date()
        session.stopActivity(with: endAt)
        session.end()
        do {
            try await builder.endCollection(at: endAt)
            try await builder.discardWorkout()
        } catch {
            // Best effort. The HR samples already streamed to HealthKit are
            // untouched either way — they are their own rows.
        }
    }

    func end() async {
        watchdog?.invalidate()
        watchdog = nil
        guard let session, let builder else {
            isActive = false; currentBpm = 0; startedAt = nil; sessionId = nil
            liveDistanceMi = nil; liveElapsedSec = nil; livePaceSecPerMi = nil
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
        self.liveDistanceMi = nil
        self.liveElapsedSec = nil
        self.livePaceSecPerMi = nil
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
    nonisolated func workoutSession(_ session: HKWorkoutSession, didFailWithError error: Error) {
        // 2026-08-28 · was a total no-op — an async failure after a
        // successful start (distinct from the synchronous init/startActivity
        // failure caught in `start()`) left isActive stuck true with a dead
        // session underneath it and nothing in the logs to explain either.
        print("[TreadmillHRSession] workout session failed: \(error.localizedDescription)")
    }
}
