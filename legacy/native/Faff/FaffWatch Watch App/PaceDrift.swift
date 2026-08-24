//
//  PaceDrift.swift
//  FaffWatch
//
//  Pace-drift feedback for WORK intervals
//  (docs/native/01-watchos-scoping.md §4):
//
//    · green  (.onTarget)  — within ±tolerance of the prescribed pace
//    · amber  (.drifting)  — drifting beyond the tolerance band
//    · red    (.offTarget) — a large drift (beyond hardDrift)
//
//    · a single subtle haptic fires once the drift has been sustained
//      past `sustainSeconds`, and won't fire again until the runner
//      returns to the band (one cue per drift episode).
//
//  Pure logic, no SwiftUI / HealthKit — so it's unit-testable in
//  isolation. Phase 4 (HKLiveWorkoutBuilder) feeds it the live sampled
//  pace; the WORK screen colors itself from the returned zone.
//

import Foundation

enum PaceZone: Equatable {
    case onTarget   // green
    case drifting   // amber
    case offTarget  // red
}

struct PaceDriftEvaluator {
    let targetPaceSPerMi: Int
    let toleranceSPerMi: Int
    /// Drift magnitude (s/mi) beyond which the zone is red.
    var hardDriftSPerMi: Int = 15
    /// How long a drift must persist before the haptic fires.
    var sustainSeconds: TimeInterval = 5

    private var driftStartedAt: Date?
    private var firedForCurrentEpisode = false

    init(targetPaceSPerMi: Int, toleranceSPerMi: Int) {
        self.targetPaceSPerMi = targetPaceSPerMi
        // A zero/negative tolerance would make every sample "drift";
        // clamp to a sane floor.
        let clampedTol = max(1, toleranceSPerMi)
        self.toleranceSPerMi = clampedTol
        // Ensure the drifting band is always at least 5 s/mi wide.
        // With tolerance=20 s/mi, hardDrift=25; with tolerance=8, hardDrift=15.
        self.hardDriftSPerMi = max(15, clampedTol + 5)
    }

    struct Result: Equatable {
        let zone: PaceZone
        let fireHaptic: Bool
        /// Signed delta in s/mi (positive = slower than target).
        let deltaSPerMi: Int
    }

    /// Feed the latest sampled pace. `now` is injectable for testing the
    /// sustained-drift timer deterministically.
    /// The zone last returned, so the thresholds can widen in the direction
    /// the runner is already in. Starts on target: a run has not drifted until
    /// it has drifted.
    private var lastZone: PaceZone = .onTarget

    mutating func update(currentPaceSPerMi: Int, now: Date = Date()) -> Result {
        let delta = currentPaceSPerMi - targetPaceSPerMi
        let magnitude = abs(delta)

        // HYSTERESIS AT THE EDGES.
        //
        // A bare threshold repaints the wrist's only graded colour every time
        // the pace crosses it, and a runner holding one steady effort sits ON
        // the edge by definition — measured at 79 flips in four minutes with a
        // pace wandering 399 to 404 against a 391 ± 10 band. The upstream EWMA
        // smoothing cannot help: it removes noise, and this is not noise, it
        // is a boundary.
        //
        // So leaving a zone costs more than entering it: once out of the band
        // the runner must come back inside it by `edgeMargin` before the
        // colour returns, and the same going the other way. The number is
        // small — three seconds a mile is under the accuracy of a GPS pace —
        // so nothing legible changes except the flicker.
        let edgeMargin = 3
        let wasOnTarget = lastZone == .onTarget
        let wasOffTarget = lastZone == .offTarget
        let onTargetLimit = wasOnTarget ? toleranceSPerMi + edgeMargin
                                        : toleranceSPerMi - edgeMargin
        let hardLimit = wasOffTarget ? hardDriftSPerMi - edgeMargin
                                     : hardDriftSPerMi + edgeMargin

        let zone: PaceZone
        if magnitude <= max(0, onTargetLimit) {
            zone = .onTarget
        } else if magnitude <= max(0, hardLimit) {
            zone = .drifting
        } else {
            zone = .offTarget
        }
        lastZone = zone

        var fire = false
        if magnitude > toleranceSPerMi {
            if driftStartedAt == nil {
                driftStartedAt = now
                firedForCurrentEpisode = false
            }
            if let start = driftStartedAt,
               now.timeIntervalSince(start) >= sustainSeconds,
               !firedForCurrentEpisode {
                firedForCurrentEpisode = true
                fire = true
            }
        } else {
            // Back inside the band — reset the episode.
            driftStartedAt = nil
            firedForCurrentEpisode = false
        }

        return Result(zone: zone, fireHaptic: fire, deltaSPerMi: delta)
    }
}
