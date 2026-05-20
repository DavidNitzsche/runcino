//
//  WorkoutEngine.swift
//  FaffWatch
//
//  The workout state machine (docs/native/01-watchos-scoping.md
//  §"Workout state machine on the watch"):
//
//      IDLE → WARMUP → INTERVAL[1..N] ⇄ RECOVERY → COOLDOWN → SUMMARY → IDLE
//
//  Forward-only · the user can skip a phase early ("End interval") but
//  never jump backward.  This is the UI-shell phase: a plain Timer
//  drives the clock.  Phase 4 swaps the timer for HKLiveWorkoutBuilder
//  sampling without changing this state surface — the views bind to
//  the published properties either way.
//

import Foundation
import Combine

@MainActor
final class WorkoutEngine: ObservableObject {

    enum State: Equatable {
        case idle
        case running
        case finished
    }

    // MARK: Published surface (views bind to these)

    @Published private(set) var state: State = .idle
    @Published private(set) var currentIndex: Int = 0
    /// Whole seconds elapsed in the current phase.
    @Published private(set) var phaseElapsedSec: Int = 0
    /// Whole seconds elapsed across the whole workout.
    @Published private(set) var totalElapsedSec: Int = 0

    /// Live pace-vs-target zone for the WORK screen (green/amber/red) and
    /// the signed delta in s/mi. Updated from the tracker's GPS pace.
    @Published private(set) var paceZone: PaceZone = .onTarget
    @Published private(set) var paceDeltaSPerMi: Int = 0

    let workout: WatchWorkout

    /// The run recorder underneath the phase clock. Set by the root model
    /// before start(). When present, the engine records real metrics and
    /// folds them into the completion; when nil it degrades to the
    /// timer-only guide.
    var tracker: WorkoutTracker?
    private var driftEval: PaceDriftEvaluator?

    // MARK: Private timing state

    private var ticker: Task<Void, Never>?
    private var phaseStart: Date = .now
    private var workoutStart: Date = .now
    /// Wall-clock seconds already banked from completed phases (so the
    /// total clock survives the per-phase resets).
    private var bankedSec: Int = 0
    private var didFireAlmostDone = false

    /// Per-phase execution record, accumulated as the workout runs.
    /// `completed` flips to false when the user ends a phase early.
    private var results: [WatchCompletionPhase] = []

    init(workout: WatchWorkout) {
        self.workout = workout
    }

    // MARK: Derived

    var currentPhase: WatchPhase? {
        guard workout.phases.indices.contains(currentIndex) else { return nil }
        return workout.phases[currentIndex]
    }

    var nextPhase: WatchPhase? {
        let n = currentIndex + 1
        guard workout.phases.indices.contains(n) else { return nil }
        return workout.phases[n]
    }

    /// 0…1 progress through the current phase (0 if the phase has no
    /// duration, which shouldn't happen for a valid payload).
    var phaseProgress: Double {
        guard let p = currentPhase, p.durationSec > 0 else { return 0 }
        return min(1, Double(phaseElapsedSec) / Double(p.durationSec))
    }

    var phaseRemainingSec: Int {
        guard let p = currentPhase else { return 0 }
        return max(0, p.durationSec - phaseElapsedSec)
    }

    // MARK: Lifecycle

    func start() {
        guard state == .idle else { return }
        state = .running
        currentIndex = 0
        phaseElapsedSec = 0
        totalElapsedSec = 0
        bankedSec = 0
        results = []
        didFireAlmostDone = false
        workoutStart = .now
        phaseStart = .now
        tracker?.start()
        prepDrift()
        if let p = currentPhase { Haptics.play(p.haptic) }
        startTimer()
    }

    /// Arm a fresh pace-drift evaluator when the current phase is a WORK
    /// interval with a target pace; clear it otherwise.
    private func prepDrift() {
        if let p = currentPhase, p.type == .work, let target = p.targetPaceSPerMi {
            driftEval = PaceDriftEvaluator(targetPaceSPerMi: target, toleranceSPerMi: p.tolerancePaceSPerMi ?? 10)
        } else {
            driftEval = nil
        }
        paceZone = .onTarget
        paceDeltaSPerMi = 0
    }

    /// User tapped "End interval" — bank the current phase as ended
    /// early and advance.
    func endCurrentPhase() {
        guard state == .running else { return }
        advance(completedCurrent: false)
    }

    /// User abandoned the whole workout from the active screen.
    func abandon() {
        guard state == .running else { return }
        recordCurrentPhase(completed: false)
        finish(status: "abandoned")
    }

    func reset() {
        stopTimer()
        state = .idle
        currentIndex = 0
        phaseElapsedSec = 0
        totalElapsedSec = 0
        bankedSec = 0
        results = []
        didFireAlmostDone = false
        completion = nil
    }

    // MARK: Timer tick

    private func startTimer() {
        stopTimer()
        // A main-actor Task loop rather than a Timer: the closure inherits
        // this class's @MainActor isolation, so tick() stays on the main
        // actor (no Swift 6 concurrency warning), and Task.sleep keeps the
        // clock ticking without blocking the run loop.
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(250))
                guard let self else { return }
                self.tick()
            }
        }
    }

    private func stopTimer() {
        ticker?.cancel()
        ticker = nil
    }

    private func tick() {
        guard state == .running, let phase = currentPhase else { return }

        phaseElapsedSec = Int(Date.now.timeIntervalSince(phaseStart))
        totalElapsedSec = bankedSec + phaseElapsedSec

        // Live pace-drift on WORK intervals — color the pace + fire a
        // single sustained-drift cue. Driven by the tracker's GPS pace.
        if phase.type == .work, let pace = tracker?.paceSPerMi, pace > 0 {
            let r = driftEval?.update(currentPaceSPerMi: pace)
            if let r {
                paceZone = r.zone
                paceDeltaSPerMi = r.deltaSPerMi
                if r.fireHaptic { Haptics.almostDone() }
            }
        }

        // "Almost done" cue · 3s before a WORK interval ends.
        if phase.type == .work, !didFireAlmostDone, phaseRemainingSec <= 3, phaseRemainingSec > 0 {
            didFireAlmostDone = true
            Haptics.almostDone()
        }

        if phaseElapsedSec >= phase.durationSec {
            advance(completedCurrent: true)
        }
    }

    // MARK: State transitions

    private func advance(completedCurrent: Bool) {
        recordCurrentPhase(completed: completedCurrent)

        // Bank the wall-clock time actually spent in the phase we're
        // leaving (honest even when the user skipped early).
        bankedSec += Int(Date.now.timeIntervalSince(phaseStart))

        if currentIndex + 1 >= workout.phases.count {
            finish(status: completedCurrent ? "completed" : "partial")
            return
        }

        currentIndex += 1
        phaseStart = .now
        phaseElapsedSec = 0
        totalElapsedSec = bankedSec
        didFireAlmostDone = false
        prepDrift()
        if let p = currentPhase { Haptics.play(p.haptic) }
    }

    private func recordCurrentPhase(completed: Bool) {
        guard let p = currentPhase else { return }
        let actual = Int(Date.now.timeIntervalSince(phaseStart))
        let pace = tracker?.paceSPerMi ?? 0
        let hr = tracker?.heartRate ?? 0
        results.append(WatchCompletionPhase(
            index: p.index,
            type: p.type.rawValue,
            label: p.label,
            targetPaceSPerMi: p.targetPaceSPerMi,
            actualPaceSPerMi: pace > 0 ? pace : nil,
            actualDurationSec: actual,
            avgHr: hr > 0 ? hr : nil,
            completed: completed
        ))
    }

    private func finish(status: String) {
        stopTimer()
        state = .finished
        Haptics.play(.end)
        completion = buildCompletion(status: status)
        // Persist the HKWorkout + GPS route to Health (async, best-effort).
        if let tracker {
            Task { await tracker.end() }
        }
    }

    // MARK: Completion payload (ready for phase-6 writeback)

    /// Populated when the workout finishes · the exact body the iPhone
    /// bridge will POST to /api/watch/workouts/complete.
    @Published private(set) var completion: WatchCompletion?

    private func buildCompletion(status: String) -> WatchCompletion {
        let iso = ISO8601DateFormatter()
        let dist = tracker?.distanceMi ?? 0
        let maxHr = tracker?.maxHr ?? 0
        return WatchCompletion(
            workoutId: workout.workoutId,
            startedAt: iso.string(from: workoutStart),
            completedAt: iso.string(from: .now),
            status: status,
            totalDistanceMi: dist > 0 ? (dist * 100).rounded() / 100 : nil,
            totalDurationSec: totalElapsedSec,
            avgHr: tracker?.avgHr,
            maxHr: maxHr > 0 ? maxHr : nil,
            phases: results
        )
    }
}
