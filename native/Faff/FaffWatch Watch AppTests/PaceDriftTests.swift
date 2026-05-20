//
//  PaceDriftTests.swift
//  FaffWatch Watch AppTests
//
//  Unit tests for PaceDriftEvaluator (docs/native/01-watchos-scoping.md
//  §4). Pure logic, no device/sensors required.
//

import Testing
import Foundation
@testable import FaffWatch_Watch_App

struct PaceDriftTests {

    // MARK: Zones

    @Test func withinToleranceIsOnTarget() {
        var eval = PaceDriftEvaluator(targetPaceSPerMi: 391, toleranceSPerMi: 10)
        let r = eval.update(currentPaceSPerMi: 395)
        #expect(r.zone == .onTarget)
        #expect(r.fireHaptic == false)
        #expect(r.deltaSPerMi == 4)
    }

    @Test func atToleranceEdgeIsStillOnTarget() {
        var eval = PaceDriftEvaluator(targetPaceSPerMi: 391, toleranceSPerMi: 10)
        // exactly +10 s/mi is the edge of the band → still green
        #expect(eval.update(currentPaceSPerMi: 401).zone == .onTarget)
    }

    @Test func beyondToleranceIsDrifting() {
        var eval = PaceDriftEvaluator(targetPaceSPerMi: 391, toleranceSPerMi: 10)
        // +14 s/mi: past the band but within the hard-drift threshold
        let r = eval.update(currentPaceSPerMi: 405)
        #expect(r.zone == .drifting)
        #expect(r.deltaSPerMi == 14)
    }

    @Test func beyondHardDriftIsOffTarget() {
        var eval = PaceDriftEvaluator(targetPaceSPerMi: 391, toleranceSPerMi: 10)
        // +19 s/mi: past the 15 s/mi hard-drift threshold → red
        #expect(eval.update(currentPaceSPerMi: 410).zone == .offTarget)
    }

    @Test func runningFastAlsoDrifts() {
        var eval = PaceDriftEvaluator(targetPaceSPerMi: 391, toleranceSPerMi: 10)
        // 21 s/mi *faster* than target is just as much a drift as slower
        let r = eval.update(currentPaceSPerMi: 370)
        #expect(r.zone == .offTarget)
        #expect(r.deltaSPerMi == -21)
    }

    // MARK: Sustained-drift haptic

    @Test func hapticFiresOnceAfterSustainedDrift() {
        var eval = PaceDriftEvaluator(targetPaceSPerMi: 391, toleranceSPerMi: 10)
        let t0 = Date()

        // Drift starts — no cue yet.
        #expect(eval.update(currentPaceSPerMi: 410, now: t0).fireHaptic == false)
        // Still drifting, but under the 5s sustain window.
        #expect(eval.update(currentPaceSPerMi: 410, now: t0.addingTimeInterval(3)).fireHaptic == false)
        // Crossed 5s of sustained drift → fire exactly once.
        #expect(eval.update(currentPaceSPerMi: 410, now: t0.addingTimeInterval(5)).fireHaptic == true)
        // Same episode, later sample → does NOT fire again.
        #expect(eval.update(currentPaceSPerMi: 410, now: t0.addingTimeInterval(6)).fireHaptic == false)
    }

    @Test func returningToBandResetsTheEpisode() {
        var eval = PaceDriftEvaluator(targetPaceSPerMi: 391, toleranceSPerMi: 10)
        let t0 = Date()

        _ = eval.update(currentPaceSPerMi: 410, now: t0)
        #expect(eval.update(currentPaceSPerMi: 410, now: t0.addingTimeInterval(5)).fireHaptic == true)

        // Back inside the band — episode resets.
        let back = eval.update(currentPaceSPerMi: 391, now: t0.addingTimeInterval(6))
        #expect(back.zone == .onTarget)
        #expect(back.fireHaptic == false)

        // A NEW drift episode can fire its own cue.
        #expect(eval.update(currentPaceSPerMi: 410, now: t0.addingTimeInterval(7)).fireHaptic == false)
        #expect(eval.update(currentPaceSPerMi: 410, now: t0.addingTimeInterval(12)).fireHaptic == true)
    }

    @Test func zeroToleranceIsClampedSoOnTargetIsReachable() {
        // A degenerate tolerance shouldn't make every sample "drift".
        var eval = PaceDriftEvaluator(targetPaceSPerMi: 391, toleranceSPerMi: 0)
        #expect(eval.update(currentPaceSPerMi: 391).zone == .onTarget)
    }
}
