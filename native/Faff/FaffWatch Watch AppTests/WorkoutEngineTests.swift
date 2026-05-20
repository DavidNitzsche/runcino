//
//  WorkoutEngineTests.swift
//  FaffWatch Watch AppTests
//
//  Tests for the WorkoutEngine state machine. These exercise the
//  deterministic, manually-driven path (start → end-interval skips →
//  finish) — not the wall-clock timer — so they run instantly and don't
//  depend on real elapsed time or sensors.
//

import Testing
import Foundation
@testable import FaffWatch_Watch_App

@MainActor
struct WorkoutEngineTests {

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
            name: "Test",
            summary: "test",
            totalEstimatedMinutes: 27,
            phases: phases,
            completionEndpoint: "/api/watch/workouts/complete",
            expiresAt: "2026-05-21T08:00:00Z"
        )
    }

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
        for _ in workout.phases.indices {
            engine.endCurrentPhase()
        }

        #expect(engine.state == .finished)

        let completion = try #require(engine.completion)
        #expect(completion.workoutId == "test-3phase")
        // The final phase was ended early, so the run is partial.
        #expect(completion.status == "partial")
        #expect(completion.phases.count == workout.phases.count)
        // Every recorded phase was skipped (completed == false).
        #expect(completion.phases.allSatisfy { $0.completed == false })
        #expect(completion.phases.first?.label == "Warmup")
        #expect(completion.phases.last?.type == "cooldown")
    }

    @Test func abandonFinishesImmediatelyAsAbandoned() throws {
        let engine = WorkoutEngine(workout: makeWorkout())
        engine.start()
        engine.abandon()
        #expect(engine.state == .finished)
        let completion = try #require(engine.completion)
        #expect(completion.status == "abandoned")
        // Only the in-progress phase is recorded on abandon.
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
}
