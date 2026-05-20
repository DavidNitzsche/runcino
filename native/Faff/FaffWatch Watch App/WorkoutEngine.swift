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
        case countingDown
        case running
        case finished
    }

    /// A brief full-screen flip the UI overlays at the edges of a rep —
    /// "Ease off · 3s left" before a work interval ends, "Go · Int 4" when
    /// the next work interval begins (watch-app.html §C3). Self-clearing.
    enum TransitionCue: Equatable {
        case headsUp(title: String, sub: String)   // amber, before a rep ends
        case go(title: String, sub: String?)       // green, entering a work rep
    }

    // MARK: Published surface (views bind to these)

    @Published private(set) var state: State = .idle
    @Published private(set) var currentIndex: Int = 0
    /// Whole seconds elapsed in the current phase.
    @Published private(set) var phaseElapsedSec: Int = 0
    /// Whole seconds elapsed across the whole workout.
    @Published private(set) var totalElapsedSec: Int = 0
    /// True while the run is paused (stoplights, water stops). The clock
    /// freezes and the tracked session pauses with it.
    @Published private(set) var isPaused = false
    /// 3 · 2 · 1 pre-roll value, shown by CountdownView while .countingDown.
    @Published private(set) var countdownValue = 0
    /// A transient transition flip; nil most of the time.
    @Published var transition: TransitionCue?

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
    private var countdownTask: Task<Void, Never>?
    private var transitionClear: Task<Void, Never>?
    private var phaseStart: Date = .now
    private var workoutStart: Date = .now
    /// When the current pause began (nil when running).
    private var pauseStart: Date?
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

    // MARK: Splits + session map (the on-demand pages)

    enum SplitState { case done, current, upcoming }

    struct Split: Identifiable {
        let id: Int            // phase index
        let repNo: Int         // 1-based work-rep ordinal
        let label: String
        let targetSPerMi: Int?
        let paceSPerMi: Int?   // banked (done) or live (current); nil upcoming
        let state: SplitState
    }

    /// One row per WORK interval: banked pace for finished reps, live pace
    /// for the current one, dash for the rest (watch-app.html §D · Splits).
    var splits: [Split] {
        let works = workout.phases.filter { $0.type == .work }
        return works.enumerated().map { (i, p) in
            if let r = results.first(where: { $0.index == p.index }) {
                return Split(id: p.index, repNo: i + 1, label: p.label,
                             targetSPerMi: p.targetPaceSPerMi, paceSPerMi: r.actualPaceSPerMi, state: .done)
            }
            if p.index == currentIndex {
                let live = (tracker?.paceSPerMi).flatMap { $0 > 0 ? $0 : nil }
                return Split(id: p.index, repNo: i + 1, label: p.label,
                             targetSPerMi: p.targetPaceSPerMi, paceSPerMi: live, state: .current)
            }
            return Split(id: p.index, repNo: i + 1, label: p.label,
                         targetSPerMi: p.targetPaceSPerMi, paceSPerMi: nil, state: .upcoming)
        }
    }

    /// Zone for a banked/live split pace vs its own target (for coloring
    /// the splits + session map without re-running the live evaluator).
    func zone(forPace pace: Int?, target: Int?) -> PaceZone {
        guard let pace, let target else { return .onTarget }
        let d = abs(pace - target)
        if d <= 10 { return .onTarget }
        if d <= 15 { return .drifting }
        return .offTarget
    }

    // MARK: Lifecycle

    /// Pre-roll 3 · 2 · 1 (each with a tick), then start for real. Gives
    /// the GPS a beat to lock so the first seconds aren't a panic.
    func beginCountdown() {
        guard state == .idle else { return }
        state = .countingDown
        countdownValue = 3
        Haptics.tick()
        // Start the recorder NOW so the workout session keeps the app
        // awake through the count (watchOS suspends an app with no active
        // session — that would freeze the countdown). The phase clock
        // doesn't begin until start() resets phaseStart below.
        tracker?.start()
        countdownTask?.cancel()
        countdownTask = Task { [weak self] in
            for n in [3, 2, 1] {
                guard let self, self.state == .countingDown else { return }
                self.countdownValue = n
                Haptics.tick()
                try? await Task.sleep(for: .seconds(1))
            }
            guard let self, self.state == .countingDown else { return }
            self.start()
        }
    }

    func start() {
        guard state == .idle || state == .countingDown else { return }
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

    /// Freeze the clock for a stoplight / water stop. Elapsed time and
    /// phase progress hold; the tracked session pauses with them.
    func pause() {
        guard state == .running, !isPaused else { return }
        isPaused = true
        pauseStart = .now
        transition = nil
        tracker?.pause()
        Haptics.play(.transitionCooldown)
    }

    /// Resume from a pause — shift the phase + workout origins forward by
    /// the paused interval so the time off the clock never counts.
    func resume() {
        guard state == .running, isPaused, let ps = pauseStart else { return }
        let delta = Date.now.timeIntervalSince(ps)
        phaseStart = phaseStart.addingTimeInterval(delta)
        workoutStart = workoutStart.addingTimeInterval(delta)
        pauseStart = nil
        isPaused = false
        tracker?.resume()
        Haptics.play(.transitionWork)
    }

    func reset() {
        stopTimer()
        countdownTask?.cancel(); countdownTask = nil
        transitionClear?.cancel(); transitionClear = nil
        state = .idle
        currentIndex = 0
        phaseElapsedSec = 0
        totalElapsedSec = 0
        bankedSec = 0
        results = []
        didFireAlmostDone = false
        isPaused = false
        pauseStart = nil
        countdownValue = 0
        transition = nil
        completion = nil
    }

    /// Show a transition flip for a beat, then clear it (unless something
    /// newer replaced it in the meantime).
    private func flash(_ cue: TransitionCue, for seconds: Double) {
        transition = cue
        transitionClear?.cancel()
        transitionClear = Task { [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            guard let self, self.transition == cue else { return }
            self.transition = nil
        }
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
        guard state == .running, !isPaused, let phase = currentPhase else { return }

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

        // "Almost done" cue · 3s before a WORK interval ends — haptic +
        // a full-screen heads-up flip ("Ease off") so you don't overrun.
        if phase.type == .work, !didFireAlmostDone, phaseRemainingSec <= 3, phaseRemainingSec > 0 {
            didFireAlmostDone = true
            Haptics.almostDone()
            flash(.headsUp(title: "Ease off", sub: "\(phaseRemainingSec)s left"), for: 2.6)
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
        if let p = currentPhase {
            Haptics.play(p.haptic)
            // Entering a work rep gets a green "Go" flip with the target;
            // the warmup (first phase) is opened from the countdown, not a flip.
            if p.type == .work {
                let n = workout.phases.prefix(currentIndex + 1).filter { $0.type == .work }.count
                let sub = p.targetPaceSPerMi.map { "Target \(PaceFormat.mmss($0))/mi" }
                flash(.go(title: "Go · Int \(n)", sub: sub), for: 1.5)
            }
        }
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
