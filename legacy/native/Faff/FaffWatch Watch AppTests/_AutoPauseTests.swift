//
//  _AutoPauseTests.swift
//  FaffWatch Watch AppTests
//
//  Auto-pause, and the two things it must never do: stop a runner the watch
//  has merely lost sight of, and stop a race.
//

import Testing
import Foundation
@testable import FaffWatch_Watch_App

@MainActor
struct AutoPauseTests {

    private func rig(isRace: Bool = false) -> (WorkoutEngine, WorkoutTracker) {
        let phase = WatchPhase(index: 0, type: .work, label: "Easy",
                               durationSec: 7200, targetPaceSPerMi: nil,
                               tolerancePaceSPerMi: nil, haptic: .start)
        let w = WatchWorkout(workoutId: "ap", name: "Easy", summary: "e",
                             totalEstimatedMinutes: 120, phases: [phase],
                             completionEndpoint: "/c",
                             expiresAt: "2099-12-31T00:00:00Z",
                             distanceMi: 10, isRace: isRace,
                             goalSec: isRace ? 3600 : nil)
        let e = WorkoutEngine(workout: w)
        let t = WorkoutTracker()
        e.tracker = t
        return (e, t)
    }

    /// Roll the clock a second at a time so every window boundary is crossed.
    private func run(_ e: WorkoutEngine, seconds: Int, mi: @autoclosure () -> Double,
                     tracker: WorkoutTracker, cadence: Int) {
        for _ in 0..<seconds {
            tracker.setFixture(pace: 540, hr: 150, cadence: cadence, distanceMi: mi())
            e.phaseStart = e.phaseStart.addingTimeInterval(-1)
            e.tick()
        }
    }

    @Test func standingStillPausesTheRun() {
        let (e, t) = rig()
        e.start()
        var mi = 0.0
        // Two minutes of running, so the run has proved it can measure distance.
        run(e, seconds: 120, mi: { mi += 0.0031; return mi }(), tracker: t, cadence: 170)
        #expect(e.isPaused == false)

        // Stopped at a light: distance frozen, legs still.
        run(e, seconds: 40, mi: mi, tracker: t, cadence: 0)
        #expect(e.isPaused, "fifteen seconds under 2 mph with no cadence is a stop")
        #expect(e.pausedAutomatically)
        e.reset()
    }

    @Test func gpsLossDoesNotPauseARunnerStillRunning() {
        let (e, t) = rig()
        e.start()
        var mi = 0.0
        run(e, seconds: 120, mi: { mi += 0.0031; return mi }(), tracker: t, cadence: 170)

        // Under a bridge: distance stops advancing, legs do not.
        run(e, seconds: 120, mi: mi, tracker: t, cadence: 168)
        #expect(e.isPaused == false,
                "cadence says the runner is running; the watch has only lost sight of them")
        e.reset()
    }

    @Test func movingAgainResumesTheRun() {
        let (e, t) = rig()
        e.start()
        var mi = 0.0
        run(e, seconds: 120, mi: { mi += 0.0031; return mi }(), tracker: t, cadence: 170)
        run(e, seconds: 40, mi: mi, tracker: t, cadence: 0)
        #expect(e.isPaused)

        run(e, seconds: 30, mi: { mi += 0.0031; return mi }(), tracker: t, cadence: 170)
        #expect(e.isPaused == false, "the light went green")
        #expect(e.pausedAutomatically == false)
        e.reset()
    }

    @Test func aPauseTheRunnerAskedForIsTheirsToEnd() {
        let (e, t) = rig()
        e.start()
        var mi = 0.0
        run(e, seconds: 120, mi: { mi += 0.0031; return mi }(), tracker: t, cadence: 170)

        e.togglePause()
        #expect(e.isPaused)
        #expect(e.pausedAutomatically == false)

        // Running again on the spot — a treadmill, a warm-up jog beside a
        // partner — must NOT undo a pause the runner chose.
        run(e, seconds: 60, mi: { mi += 0.0031; return mi }(), tracker: t, cadence: 170)
        #expect(e.isPaused, "the watch may only undo its own pause")
        e.reset()
    }

    @Test func aRaceIsNeverPausedByTheWatch() {
        let (e, t) = rig(isRace: true)
        e.start()
        var mi = 0.0
        run(e, seconds: 120, mi: { mi += 0.0031; return mi }(), tracker: t, cadence: 170)
        // A full stop at an aid station.
        run(e, seconds: 120, mi: mi, tracker: t, cadence: 0)
        #expect(e.isPaused == false, "race elapsed is gun-to-mat (audit W-3)")
        e.reset()
    }

    @Test func theRunnerCanTurnItOff() {
        UserDefaults.standard.set(false, forKey: "autoPause")
        defer { UserDefaults.standard.removeObject(forKey: "autoPause") }
        let (e, t) = rig()
        e.start()
        var mi = 0.0
        run(e, seconds: 120, mi: { mi += 0.0031; return mi }(), tracker: t, cadence: 170)
        run(e, seconds: 60, mi: mi, tracker: t, cadence: 0)
        #expect(e.isPaused == false)
        e.reset()
    }
}
