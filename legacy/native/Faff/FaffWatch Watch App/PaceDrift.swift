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
        self.toleranceSPerMi = max(1, toleranceSPerMi)
    }

    struct Result: Equatable {
        let zone: PaceZone
        let fireHaptic: Bool
        /// Signed delta in s/mi (positive = slower than target).
        let deltaSPerMi: Int
    }

    /// Feed the latest sampled pace. `now` is injectable for testing the
    /// sustained-drift timer deterministically.
    mutating func update(currentPaceSPerMi: Int, now: Date = Date()) -> Result {
        let delta = currentPaceSPerMi - targetPaceSPerMi
        let magnitude = abs(delta)

        let zone: PaceZone
        if magnitude <= toleranceSPerMi {
            zone = .onTarget
        } else if magnitude <= hardDriftSPerMi {
            zone = .drifting
        } else {
            zone = .offTarget
        }

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
