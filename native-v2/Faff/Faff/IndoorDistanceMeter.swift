//
//  IndoorDistanceMeter.swift
//  faff.run iPhone · a MEASURED distance for a run with no GPS.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY
//
//  The treadmill console's distance is an integral of the belt speed the
//  runner TYPED IN. Nothing measures it. That is a stated number, not a
//  measured one, and on 2026-08-20 the two came apart:
//
//    David ran, moved the belt speed on the app's OWN ± steppers, watched the
//    number change on screen, and the app came back LOWER than the
//    treadmill's display. The app was told and did not listen. The recorder
//    lived in a View struct and ticked from a closure captured inside a
//    `.background` subtree, so it integrated `speedMph` as it stood when the
//    closure was made. The display re-read state on every render and was
//    always right; the integrator's copy was right only until the next tap.
//
//    The stored row pins the size of it. The run integrated to 4.26 mi over
//    2250 s closing at 6.8 mph, and a flat 6.8 for that duration is 4.25 mi —
//    so the TOTAL time the integrator ever spent above 6.8 is worth 18-54
//    mph-seconds, one to four minutes out of a 37:30 session. Ten minutes at
//    +0.4 mph alone would have stored 4.32. Stale most of the time, refreshed
//    occasionally, which is what an occasionally-rebuilt subtree gives you.
//
//  That defect is fixed at its root in BeltSession.swift, which is where the
//  belt speed now lives. This file is the second half of the answer: even
//  when the app hears every tap, the number is still only what the runner
//  told it. So measure something.
//
//  The app cannot read the belt. But the phone can measure the runner.
//  `CMPedometer` is accelerometer-derived and works with no GPS and no
//  signal, which is exactly what an indoor run is — it is the same class of
//  sensor the Apple Watch uses to measure an indoor run on the wrist.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT THIS DOES NOT DO
//
//  It does not silently become the run's distance. Two reasons:
//
//   1. A phone propped on the treadmill's console — which is where a phone
//      spends most treadmill runs — measures nothing. A reading of zero from
//      a stationary phone is not evidence that the runner stood still. So
//      every reading is gated on CADENCE: unless the step rate says the
//      phone was on a running body, this reports `.notCarried` and offers no
//      number at all. A refusal is a correct answer.
//
//   2. Even when it is carried, it is a second independent reading, not a
//      verdict. One signal does not get to overwrite the number the runner
//      watched all session. It corroborates the belt figure, or it
//      contradicts it — and a contradiction is something to SAY, not
//      something to resolve behind the runner's back.
//
//  What it changes today is provenance: a belt figure standing on its own is
//  modelled and wears the amber mark; a belt figure a carried phone agrees
//  with is corroborated and does not.
//

import Foundation
import CoreMotion

@MainActor
final class IndoorDistanceMeter: ObservableObject {

    /// What the phone is able to say about this run.
    enum Reading: Equatable {
        /// No pedometer on this device, or the runner declined motion access.
        case unavailable
        /// Running, but the phone has not been on a moving body — parked on
        /// the console, or in a bag. There is no measurement to offer.
        case notCarried
        /// A real accelerometer-derived distance for this session.
        case measured(mi: Double)

        var miles: Double? {
            if case .measured(let mi) = self { return mi }
            return nil
        }
    }

    /// Step rate below which we will not claim to have measured anything.
    /// Running cadence is 140-190 spm; even a hand-carried phone reads most
    /// of it. A phone resting on the console reads close to nothing. 100 is
    /// well clear of both.
    private static let carriedStepsPerMin: Double = 100

    /// How far apart two readings of the same run may be before they are
    /// telling different stories. 3% of the distance, floored at 0.15 mi so
    /// a short run is not flagged over a rounding step.
    static func materiallyDisagree(beltMi: Double, measuredMi: Double) -> Bool {
        let tolerance = Swift.max(0.15, beltMi * 0.03)
        return abs(beltMi - measuredMi) > tolerance
    }

    @Published private(set) var reading: Reading = .unavailable
    /// Raw cumulative values, for the payload. Nil until the first update.
    @Published private(set) var rawDistanceMi: Double?
    @Published private(set) var rawSteps: Int?
    /// Live cadence in steps per minute, straight off `CMPedometerData`.
    /// Nil when the phone is not being carried — a parked phone's zero is not
    /// a cadence, it is an absence.
    @Published private(set) var currentCadenceSpm: Int?
    /// Whole-session mean cadence: total steps over the measured window.
    /// The phone-driven watch bridge has no cadence channel at all
    /// (TreadmillHRSession collects heart rate only, and the phone reads HR
    /// out of HealthKit rather than over WatchConnectivity), so on a treadmill
    /// this is the only cadence the app can get without a new watch message.
    /// Same carried gate as the distance: nil unless the phone was on a
    /// running body.
    @Published private(set) var avgCadenceSpm: Int?

    private let pedometer = CMPedometer()
    private var startedAt: Date?
    private var running = false

    // ── The MOVING clock ────────────────────────────────────────────────────
    //
    // 2026-08-25 · every rate below used to be `steps / (now - startedAt)`,
    // which is WALL CLOCK. The consoles that own this meter never stop it on
    // pause — `meter.start` is called in `.onAppear` and `meter.stop` in
    // `.onDisappear`, and `session.togglePause()` sits between them — so a
    // paused minute went straight into the denominator while the run's own
    // stored `totalDurationSec` is the belt's MOVING clock. Two clocks for one
    // run.
    //
    // The size of it: 30 minutes at a true 170 spm with a 5-minute pause banks
    // 5100 steps and divides them by 35 minutes, and the run is filed at 146
    // spm — a figure the Health page then grades against a 170 target. The
    // same denominator drives the `carriedStepsPerMin` gate, so a long enough
    // pause also drops the rate under 100 and the whole reading collapses to
    // `.notCarried`: the belt cross-check disappears, silently, on a run where
    // the phone was carried the entire time.
    //
    // Steps taken DURING a pause are excluded from the numerator too, off the
    // cumulative count at each boundary — a runner stretching beside the belt
    // is not running at 200 spm.
    /// Moving seconds, as the owning session counts them. Nil until an owner
    /// reports one, in which case wall clock is all there is.
    private var movingSec: Double?
    /// Cumulative step count when the current pause began, or nil when moving.
    private var pausedStepBaseline: Int?
    /// Steps banked across completed pauses.
    private var stepsWhilePaused: Int = 0

    /// Report the owning session's moving clock and pause state.
    ///
    /// Call on every tick. `movingSec` is the session's own elapsed clock — the
    /// one that stops on pause and is what the run is ultimately stored with —
    /// so the step rate is measured over the same seconds the distance is.
    func note(movingSec: Double, isPaused: Bool) {
        self.movingSec = max(0, movingSec)
        if isPaused {
            if pausedStepBaseline == nil { pausedStepBaseline = rawSteps ?? 0 }
        } else if let base = pausedStepBaseline {
            stepsWhilePaused += max(0, (rawSteps ?? base) - base)
            pausedStepBaseline = nil
        }
    }

    /// Steps taken while actually moving.
    private func movingSteps(_ cumulative: Int) -> Int {
        let duringThisPause = pausedStepBaseline.map { max(0, cumulative - $0) } ?? 0
        return max(0, cumulative - stepsWhilePaused - duringThisPause)
    }

    /// True when this device can measure at all — used to decide whether to
    /// say anything about a missing reading.
    static var isSupported: Bool {
        CMPedometer.isDistanceAvailable() && CMPedometer.isStepCountingAvailable()
    }

    /// Begin measuring from `when`. Idempotent. Requests motion access on
    /// first use; a declined prompt simply leaves the reading `.unavailable`
    /// and the run records exactly as it did before this file existed.
    func start(from when: Date) {
        guard !running, Self.isSupported else { return }
        running = true
        startedAt = when
        pedometer.startUpdates(from: when) { [weak self] data, error in
            guard let data, error == nil else { return }
            let meters = data.distance?.doubleValue
            let steps = data.numberOfSteps.intValue
            // currentCadence is steps per SECOND on CMPedometerData.
            let cadenceSpm = data.currentCadence.map { $0.doubleValue * 60.0 }
            Task { @MainActor [weak self] in
                self?.ingest(meters: meters, steps: steps, cadenceSpm: cadenceSpm, at: Date())
            }
        }
    }

    func stop() {
        guard running else { return }
        running = false
        pedometer.stopUpdates()
    }

    private func ingest(meters: Double?, steps: Int, cadenceSpm: Double?, at now: Date) {
        rawSteps = steps
        if let meters { rawDistanceMi = meters / 1609.344 }

        guard let startedAt else { return }
        // The session's own moving clock when an owner reports one; wall clock
        // is the fallback for a caller that has no pause concept at all.
        let minutes = (movingSec ?? now.timeIntervalSince(startedAt)) / 60.0
        // Under half a minute there is not enough of a step rate to judge.
        guard minutes >= 0.5 else { return }
        let stepsPerMin = Double(movingSteps(steps)) / minutes
        guard stepsPerMin >= Self.carriedStepsPerMin else {
            reading = .notCarried
            currentCadenceSpm = nil
            avgCadenceSpm = nil
            return
        }
        avgCadenceSpm = Int(stepsPerMin.rounded())
        if let c = cadenceSpm, c > 0 { currentCadenceSpm = Int(c.rounded()) }
        guard let mi = rawDistanceMi, mi > 0 else {
            reading = .notCarried
            return
        }
        reading = .measured(mi: mi)
    }
}
