//
//  F124_TreadmillControlLossTests.swift
//  FaffWatch Watch AppTests
//
//  F124 · a watch-owned outdoor run must never be silently swapped away by
//  a phone-driven treadmill HR bridge session taking the screen. See
//  TreadmillHRSession.start()'s own F124 comment (and WorkoutRootView's
//  WatchRootModel.ownsActiveRunState) for the full root-cause trace; this
//  proves the guard those two changes added actually holds.
//
//  Rule 18 falsification (performed manually against this exact test, not
//  by CI): comment out the `guard !WatchRootModel.ownsActiveRunState else
//  { ... }` block in TreadmillHRSession.start() and re-run —
//  `guardBlocksStartWhileOutdoorRunActive` must fail (isActive flips
//  true). Restore the guard and confirm it passes again. See the F124
//  write-up (programme-internal-working/00-master-programme/
//  F124-TREADMILL-CONTROL-LOSS-2026-09-14.md) for the actual run's result.
//

import Testing
import Foundation
@testable import FaffWatch_Watch_App

@MainActor
struct F124TreadmillControlLossTests {

    /// Minimal single-phase workout — nothing about F124 depends on phase
    /// structure, only on an engine existing at all (a watch-owned run in
    /// progress).
    private func makeMinimalWorkout() -> WatchWorkout {
        WatchWorkout(
            workoutId: "f124-test",
            name: "Test", summary: "test",
            totalEstimatedMinutes: 10,
            phases: [
                WatchPhase(index: 0, type: .warmup, label: "Warmup",
                           durationSec: 600, targetPaceSPerMi: nil,
                           tolerancePaceSPerMi: nil, haptic: .start)
            ],
            completionEndpoint: "/api/watch/workouts/complete",
            expiresAt: "2099-12-31T00:00:00Z"
        )
    }

    /// The core F124 regression. With a watch-owned outdoor run's engine
    /// live, a treadmill HR bridge start must be refused BEFORE it ever
    /// touches HealthKit — `isActive` must stay false, so
    /// `WorkoutRootView.content` never has a reason (or a live session) to
    /// prefer `TreadmillHRView` over the run already on screen. Before the
    /// fix, `TreadmillHRSession.start()` had no such guard at all and
    /// would have proceeded straight into `HKHealthStore.
    /// isHealthDataAvailable()` / session construction regardless of
    /// `model.engine`.
    @Test
    func guardBlocksStartWhileOutdoorRunActive() async {
        let model = WatchRootModel()
        model.engine = WorkoutEngine(workout: makeMinimalWorkout())
        #expect(WatchRootModel.ownsActiveRunState == true)

        await TreadmillHRSession.shared.start(sessionId: "f124-session-1")

        #expect(TreadmillHRSession.shared.isActive == false)

        // Cleanup — TreadmillHRSession.shared is a real process-lifetime
        // singleton; leaving it started (it shouldn't be, but belt and
        // suspenders) would bleed into whichever test runs next.
        await TreadmillHRSession.shared.end()
        model.engine = nil
    }

    /// `ownsActiveRunState` reads the SAME three properties
    /// `WorkoutRootView.content` already treats as "the watch owns this
    /// screen" (`engine`, `recoveredRun`, `recoverySummary`) rather than a
    /// separate flag that could drift from the router it describes.
    /// Exercises the property directly, independent of HealthKit, so a
    /// future edit to the router's own conditions is caught here too.
    @Test
    func guardIsClearWithNoWatchOwnedRunState() {
        let model = WatchRootModel()
        #expect(WatchRootModel.ownsActiveRunState == false)
        model.engine = WorkoutEngine(workout: makeMinimalWorkout())
        #expect(WatchRootModel.ownsActiveRunState == true)
        model.engine = nil
        #expect(WatchRootModel.ownsActiveRunState == false)
    }
}
