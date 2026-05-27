//
//  WorkoutEngineTests.swift
//  FaffWatch Watch AppTests
//
//  Tests for the WorkoutEngine state machine.
//
//  Two flavors of test:
//    1. MANUAL path — start / endCurrentPhase / abandon / reset. Drives
//       the public API without time passing. Fast, deterministic.
//    2. SIMULATED-CLOCK path — uses `simulate(_:engine:seconds:)` to roll
//       the engine's `phaseStart` backward and call `tick()` directly.
//       Exercises auto-advance, countdowns, fuel cues, mile-splits, HR
//       ceiling, and every other tick-driven behavior in zero real time.
//
//  The simulated-clock helper is the key for catching the bugs that bit
//  the user during a real run (intervals never changing, time going UP
//  instead of DOWN, distance not tracking). The manual path alone misses
//  all of those because none of them depend on tick() firing.
//

import Testing
import Foundation
@testable import FaffWatch_Watch_App

@MainActor
struct WorkoutEngineTests {

    // MARK: - Workout fixtures

    /// 3-phase time-based workout: warmup → 1 rep → cooldown.
    /// All phases are TIME reps so tests can advance by simulated seconds.
    private func makeWorkout() -> WatchWorkout {
        let phases = [
            WatchPhase(index: 0, type: .warmup, label: "Warmup",
                       durationSec: 600, targetPaceSPerMi: nil,
                       tolerancePaceSPerMi: nil, haptic: .start),
            WatchPhase(index: 1, type: .work, label: "Interval 1/1",
                       durationSec: 420, targetPaceSPerMi: 391,
                       tolerancePaceSPerMi: 10, haptic: .transitionWork),
            WatchPhase(index: 2, type: .cooldown, label: "Cooldown",
                       durationSec: 600, targetPaceSPerMi: nil,
                       tolerancePaceSPerMi: nil, haptic: .transitionCooldown),
        ]
        return WatchWorkout(
            workoutId: "test-3phase",
            name: "Test", summary: "test",
            totalEstimatedMinutes: 27,
            phases: phases,
            completionEndpoint: "/api/watch/workouts/complete",
            expiresAt: "2026-05-21T08:00:00Z"
        )
    }

    /// Distance-based interval workout — exercises the distance auto-
    /// advance path. 1-mile warmup + 1-mile work rep + 1-mile cooldown.
    private func makeDistanceWorkout() -> WatchWorkout {
        let phases = [
            WatchPhase(index: 0, type: .warmup, label: "Warmup",
                       durationSec: 600, targetPaceSPerMi: nil,
                       tolerancePaceSPerMi: nil, haptic: .start,
                       repUnit: .distance, distanceMi: 1.0),
            WatchPhase(index: 1, type: .work, label: "Rep 1/1",
                       durationSec: 420, targetPaceSPerMi: 391,
                       tolerancePaceSPerMi: 10, haptic: .transitionWork,
                       repUnit: .distance, distanceMi: 1.0),
            WatchPhase(index: 2, type: .cooldown, label: "Cooldown",
                       durationSec: 600, targetPaceSPerMi: nil,
                       tolerancePaceSPerMi: nil, haptic: .transitionCooldown,
                       repUnit: .distance, distanceMi: 1.0),
        ]
        return WatchWorkout(
            workoutId: "test-dist",
            name: "Test dist", summary: "test",
            totalEstimatedMinutes: 27,
            phases: phases,
            completionEndpoint: "/api/watch/workouts/complete",
            expiresAt: "2026-05-21T08:00:00Z"
        )
    }

    // MARK: - Simulated-clock helper

    /// Roll the engine's `phaseStart` backward by `seconds` and run one
    /// tick. Cumulative across calls: each call adds to the simulated
    /// elapsed in the current phase. Production code never calls this.
    private func simulate(_ engine: WorkoutEngine, seconds: Int) {
        engine.phaseStart = engine.phaseStart.addingTimeInterval(-Double(seconds))
        engine.tick()
    }

    // MARK: - MANUAL state machine (existing coverage)

    @Test func startsRunningAtFirstPhase() {
        let engine = WorkoutEngine(workout: makeWorkout())
        engine.start()
        #expect(engine.state == .running)
        #expect(engine.currentIndex == 0)
        #expect(engine.currentPhase?.label == "Warmup")
        engine.reset()
    }

    @Test func endCurrentPhaseAdvancesCursor() {
        let engine = WorkoutEngine(workout: makeWorkout())
        engine.start()
        engine.endCurrentPhase()
        #expect(engine.currentIndex == 1)
        #expect(engine.currentPhase?.type == .work)
        #expect(engine.state == .running)
        engine.reset()
    }

    @Test func nextPhaseLooksAhead() {
        let engine = WorkoutEngine(workout: makeWorkout())
        engine.start()
        #expect(engine.nextPhase?.type == .work)
        engine.reset()
    }

    @Test func skippingEveryPhaseFinishesAsPartial() throws {
        let workout = makeWorkout()
        let engine = WorkoutEngine(workout: workout)
        engine.start()
        for _ in workout.phases.indices { engine.endCurrentPhase() }
        #expect(engine.state == .finished)
        let completion = try #require(engine.completion)
        #expect(completion.workoutId == "test-3phase")
        #expect(completion.status == "partial")
        #expect(completion.phases.count == workout.phases.count)
        #expect(completion.phases.allSatisfy { $0.completed == false })
    }

    @Test func abandonFinishesImmediatelyAsAbandoned() throws {
        let engine = WorkoutEngine(workout: makeWorkout())
        engine.start()
        engine.abandon()
        #expect(engine.state == .finished)
        let completion = try #require(engine.completion)
        #expect(completion.status == "abandoned")
        #expect(completion.phases.count == 1)
    }

    @Test func resetReturnsToIdle() {
        let engine = WorkoutEngine(workout: makeWorkout())
        engine.start()
        engine.endCurrentPhase()
        engine.reset()
        #expect(engine.state == .idle)
        #expect(engine.currentIndex == 0)
        #expect(engine.completion == nil)
    }

    // MARK: - COUNTDOWN: phaseRemainingSec decrements (bug: "time went UP not DOWN")

    @Test func phaseRemainingSecDecrementsAcrossTicks() {
        let engine = WorkoutEngine(workout: makeWorkout())
        engine.start()

        // Warmup is 600s. Initial: 600 remaining, 0 elapsed.
        #expect(engine.phaseRemainingSec == 600)
        #expect(engine.phaseElapsedSec == 0)

        // Simulate 10 seconds of wall-clock — remaining should drop.
        simulate(engine, seconds: 10)
        #expect(engine.phaseElapsedSec == 10)
        #expect(engine.phaseRemainingSec == 590)

        // Another 100 seconds — keeps decrementing, never goes negative.
        simulate(engine, seconds: 100)
        #expect(engine.phaseElapsedSec == 110)
        #expect(engine.phaseRemainingSec == 490)

        engine.reset()
    }

    @Test func phaseRemainingSecNeverGoesNegative() {
        let engine = WorkoutEngine(workout: makeWorkout())
        engine.start()
        // Simulate WAY more time than the phase duration — clamped to 0.
        simulate(engine, seconds: 5000)
        #expect(engine.phaseRemainingSec >= 0)
        engine.reset()
    }

    // MARK: - AUTO-ADVANCE on time (bug: "never changed to new interval")

    @Test func timeBasedPhaseAutoAdvancesAtDuration() {
        let engine = WorkoutEngine(workout: makeWorkout())
        engine.start()

        // Warmup is 600s. Tick at 599s — should still be in warmup.
        simulate(engine, seconds: 599)
        #expect(engine.currentIndex == 0)
        #expect(engine.currentPhase?.type == .warmup)

        // Add 2 more seconds (total 601s elapsed) — must auto-advance.
        simulate(engine, seconds: 2)
        #expect(engine.currentIndex == 1, "auto-advance should fire at duration")
        #expect(engine.currentPhase?.type == .work)

        engine.reset()
    }

    @Test func timeBasedAutoAdvanceMarksPhaseCompleted() throws {
        let engine = WorkoutEngine(workout: makeWorkout())
        engine.start()
        simulate(engine, seconds: 601)   // past warmup duration
        engine.abandon()                 // finalize to read completion
        let completion = try #require(engine.completion)
        #expect(completion.phases.first?.completed == true,
                "auto-advanced warmup should be marked completed=true (not skipped)")
    }

    @Test func walkingThroughEveryTimePhaseFinishesAsComplete() throws {
        let workout = makeWorkout()
        let engine = WorkoutEngine(workout: workout)
        engine.start()

        for phase in workout.phases {
            // Advance past this phase's duration; auto-advance fires.
            simulate(engine, seconds: phase.durationSec + 1)
        }
        // After the cooldown auto-completes, engine should be finished.
        #expect(engine.state == .finished)

        let completion = try #require(engine.completion)
        #expect(completion.status == "completed")
        #expect(completion.phases.count == workout.phases.count)
        #expect(completion.phases.allSatisfy { $0.completed == true })
    }

    // MARK: - DISTANCE tracking + auto-advance (bug: "distance not tracking")

    @Test func phaseCoveredMiReflectsTrackerDistance() {
        let tracker = WorkoutTracker()
        let engine = WorkoutEngine(workout: makeDistanceWorkout())
        engine.tracker = tracker
        engine.start()

        // Initial: tracker at 0, phaseCoveredMi = 0.
        #expect(engine.phaseCoveredMi == 0)

        // Inject 0.5 mi of distance into the tracker.
        tracker.setFixture(pace: 391, hr: 150, cadence: 178, distanceMi: 0.5)
        #expect(engine.phaseCoveredMi == 0.5,
                "phaseCoveredMi should track distanceMi minus phaseStartMi")

        engine.reset()
    }

    @Test func distanceBasedPhaseAutoAdvancesAtDistance() {
        let tracker = WorkoutTracker()
        let engine = WorkoutEngine(workout: makeDistanceWorkout())
        engine.tracker = tracker
        engine.start()

        // Warmup is 1.0 mi. At 0.99 mi, still in warmup.
        tracker.setFixture(pace: 391, hr: 150, cadence: 178, distanceMi: 0.99)
        simulate(engine, seconds: 1)
        #expect(engine.currentIndex == 0)

        // Cross 1.0 mi — must auto-advance to the work rep.
        tracker.setFixture(pace: 391, hr: 150, cadence: 178, distanceMi: 1.01)
        simulate(engine, seconds: 1)
        #expect(engine.currentIndex == 1,
                "distance auto-advance should fire when phaseCoveredMi >= distanceMi")
        #expect(engine.currentPhase?.type == .work)

        engine.reset()
    }

    @Test func phaseRemainingMiDecrementsWithTrackerDistance() {
        let tracker = WorkoutTracker()
        let engine = WorkoutEngine(workout: makeDistanceWorkout())
        engine.tracker = tracker
        engine.start()

        // Initial: 1.0 mi phase, 0 covered → 1.0 remaining.
        #expect(engine.phaseRemainingMi == 1.0)

        tracker.setFixture(pace: 391, hr: 150, cadence: 178, distanceMi: 0.3)
        #expect(abs((engine.phaseRemainingMi ?? 0) - 0.7) < 0.001)

        tracker.setFixture(pace: 391, hr: 150, cadence: 178, distanceMi: 0.8)
        #expect(abs((engine.phaseRemainingMi ?? 0) - 0.2) < 0.001)

        engine.reset()
    }

    // MARK: - MILE-SPLIT flash gating (bug: "fires during work intervals")

    @Test func mileSplitDoesNotFireDuringWorkPhase() {
        let tracker = WorkoutTracker()
        let engine = WorkoutEngine(workout: makeWorkout())  // time-based
        engine.tracker = tracker
        engine.start()
        // Advance past warmup so we're in the WORK phase.
        simulate(engine, seconds: 601)
        #expect(engine.currentPhase?.type == .work)
        // Cross a mile boundary while in the work phase.
        tracker.setFixture(pace: 391, hr: 150, cadence: 178, distanceMi: 1.01)
        simulate(engine, seconds: 1)
        // Mile-split flashes are noise during a work rep — the runner is
        // already focused on the rep's pace/target. No `.split` transition
        // should be set.
        if case .split = engine.transition { Issue.record("mile-split flashed during work phase") }
    }

    @Test func mileSplitFiresDuringWarmupOrCooldown() {
        let tracker = WorkoutTracker()
        let engine = WorkoutEngine(workout: makeWorkout())
        engine.tracker = tracker
        engine.start()
        // Still in warmup (no time elapsed). Cross a mile boundary.
        tracker.setFixture(pace: 391, hr: 150, cadence: 178, distanceMi: 1.01)
        simulate(engine, seconds: 1)
        var sawSplitInWarmup = false
        if case .split = engine.transition { sawSplitInWarmup = true }
        #expect(sawSplitInWarmup,
                "mile-split SHOULD fire in unstructured phases (warmup / cooldown / just-run)")
    }

    // MARK: - PAUSE freezes progress

    @Test func pauseFreezesPhaseElapsed() {
        let engine = WorkoutEngine(workout: makeWorkout())
        engine.start()
        simulate(engine, seconds: 30)
        #expect(engine.phaseElapsedSec == 30)

        engine.pause()
        // Simulate 100 seconds of wall clock while paused.
        engine.phaseStart = engine.phaseStart.addingTimeInterval(-100)
        // Tick now would normally count those 100s — but paused tick is
        // a no-op. To make this test resilient, also explicitly call tick.
        engine.tick()
        // Resume — the engine should bump phaseStart forward by the wall
        // time spent paused, so phaseElapsedSec stays at ~30.
        engine.resume()
        engine.tick()
        #expect(engine.phaseElapsedSec <= 32,
                "pause must not allow elapsed to advance — was \(engine.phaseElapsedSec)")
        engine.reset()
    }
}
