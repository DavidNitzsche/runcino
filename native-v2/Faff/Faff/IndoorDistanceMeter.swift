//
//  IndoorDistanceMeter.swift
//  faff.run iPhone · a MEASURED distance for a run with no GPS.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY
//
//  The treadmill console's distance is an integral of the belt speed the
//  runner TYPED IN. That is a stated number, not a measured one, and the
//  distinction is not academic — it is the whole of the 2026-08-20 defect:
//
//    David ran, changed the belt speed a couple of times, and the app came
//    back LOWER than the treadmill's own display. The stored row proves the
//    console's own arithmetic was working — the run's integrated distance
//    (4.26 mi) is strictly greater than 2250 s at a constant 6.8 mph
//    (4.25 mi), and its incline-derived elevation (225 ft) is likewise a foot
//    above what a constant 6.8 would give (224 ft), so at least one belt
//    change did reach the integrator. The app was reading low because it was
//    faithfully integrating a number that had gone stale on the screen: he
//    moved the belt, and nothing told the app.
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

    private let pedometer = CMPedometer()
    private var startedAt: Date?
    private var running = false

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
            Task { @MainActor [weak self] in
                self?.ingest(meters: meters, steps: steps, at: Date())
            }
        }
    }

    func stop() {
        guard running else { return }
        running = false
        pedometer.stopUpdates()
    }

    private func ingest(meters: Double?, steps: Int, at now: Date) {
        rawSteps = steps
        if let meters { rawDistanceMi = meters / 1609.344 }

        guard let startedAt else { return }
        let minutes = now.timeIntervalSince(startedAt) / 60.0
        // Under half a minute there is not enough of a step rate to judge.
        guard minutes >= 0.5 else { return }
        let stepsPerMin = Double(steps) / minutes
        guard stepsPerMin >= Self.carriedStepsPerMin else {
            reading = .notCarried
            return
        }
        guard let mi = rawDistanceMi, mi > 0 else {
            reading = .notCarried
            return
        }
        reading = .measured(mi: mi)
    }
}
