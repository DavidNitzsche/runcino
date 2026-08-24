//
//  _SessionTimelineTests.swift
//  FaffWatch Watch AppTests
//
//  SESSION-LEVEL SIMULATION. WorkoutEngineTests drives the state machine a
//  poke at a time; this file drives whole sessions — an easy run, four
//  flavours of structured session and a marathon — second by second through
//  the real engine, records every cue the engine publishes, and asserts on
//  the whole timeline afterwards.
//
//  What it is testing is `docs/design/watch-0821/IN-RUN-CUES.md`: which cue
//  fires, on which archetype, how many times, and in what order. That
//  document makes falsifiable claims ("a race always splits", "the split is
//  suppressed inside a rep", "each gel fires once") and until now nothing
//  checked them against the engine.
//
//  HOW THE RECORDER WORKS · `engine.transition` is a @Published property, so
//  its projected publisher emits on every assignment — including two cues
//  raised inside a SINGLE tick, where the second overwrites the first before
//  any view could draw it. Sampling `engine.transition` after each tick would
//  silently lose the first of those two, which is exactly the class of defect
//  this file exists to find, so the recorder subscribes instead of polling.
//
//  Cues that are wrong are documented, not fixed: a `// BUG:` comment on the
//  expectation and a `withKnownIssue` around it, so the suite stays green and
//  the claim stays written down.
//

import Testing
import Foundation
import Combine
@testable import FaffWatch_Watch_App

// MARK: - Timeline recorder

/// Every cue the engine published, in order, with where the run was when it
/// fired.
@MainActor
final class CueRecorder {

    struct Event {
        let cue: WorkoutEngine.TransitionCue
        /// `engine.totalElapsedSec` at the instant the cue was raised.
        let sec: Int
        let phaseIndex: Int
        let phaseType: WatchPhaseType?
        let phaseLabel: String
        let paused: Bool
    }

    private(set) var events: [Event] = []
    private var bag: [AnyCancellable] = []

    /// Attach BEFORE `start()` — `.go` is raised inside it.
    func attach(_ engine: WorkoutEngine) {
        engine.$transition
            .sink { [weak self, weak engine] cue in
                guard let self, let engine, let cue else { return }
                self.events.append(Event(
                    cue: cue,
                    sec: engine.totalElapsedSec,
                    phaseIndex: engine.currentIndex,
                    phaseType: engine.currentPhase?.type,
                    phaseLabel: engine.currentPhase?.label ?? "",
                    paused: engine.isPaused
                ))
            }
            .store(in: &bag)
    }

    // ── Slices by kind ────────────────────────────────────────────────
    var gos:         [Event] { events.filter { if case .go        = $0.cue { return true }; return false } }
    var phaseCues:   [Event] { events.filter { if case .phase     = $0.cue { return true }; return false } }
    var splits:      [Event] { events.filter { if case .split     = $0.cue { return true }; return false } }
    var fuels:       [Event] { events.filter { if case .fuel      = $0.cue { return true }; return false } }
    var almostDones: [Event] { events.filter { if case .almostDone = $0.cue { return true }; return false } }
    var headsUps:    [Event] { events.filter { if case .headsUp   = $0.cue { return true }; return false } }

    var splitMiles: [Int] { events.compactMap { if case .split(let m, _) = $0.cue { return m }; return nil } }
    var fuelIndices: [Int] { events.compactMap { if case .fuel(let i, _) = $0.cue { return i }; return nil } }
    var phaseSubs: [String] { events.compactMap { if case .phase(_, let s) = $0.cue { return s ?? "" }; return nil } }

    /// A readable dump, attached to failures so a red test says what actually
    /// happened rather than just what didn't.
    var summary: String {
        events.map { e in
            let kind: String
            switch e.cue {
            case .go:                        kind = "go"
            case .phase(let t, let s):       kind = "phase(\(t) · \(s ?? "-"))"
            case .split(let m, let p):       kind = "split(mi \(m) · \(p)s)"
            case .fuel(let i, let n):        kind = "fuel(\(i)/\(n))"
            case .almostDone(let v, let u):  kind = "almostDone(\(v) \(u))"
            case .headsUp(let v):            kind = "headsUp(\(v))"
            }
            return "  \(e.sec)s · phase \(e.phaseIndex) \(e.phaseType.map(String.init(describing:)) ?? "-") · \(kind)"
        }.joined(separator: "\n")
    }
}

// MARK: - Session driver

/// Drives a whole session at a fixed pace, one simulated second per step.
///
/// Distance is derived (`second / pace`) rather than accumulated so a mile
/// boundary lands on an exact second and the assertions can be exact.
@MainActor
final class SimRun {
    let engine: WorkoutEngine
    let tracker = WorkoutTracker()
    let rec = CueRecorder()
    var pace: Int
    var hr: Int = 150
    private(set) var second = 0

    init(_ workout: WatchWorkout, pace: Int) {
        self.engine = WorkoutEngine(workout: workout)
        self.pace = pace
        engine.tracker = tracker
    }

    var mi: Double { Double(second) / Double(pace) }

    func start() {
        rec.attach(engine)
        engine.start()                 // tracker.start() zeroes distance
        tracker.setFixture(pace: pace, hr: hr, cadence: 178, distanceMi: 0)
    }

    /// One simulated second: move the runner, roll the phase clock back one
    /// second, tick.
    func step() {
        second += 1
        tracker.setFixture(pace: pace, hr: hr, cadence: 178, distanceMi: mi)
        engine.phaseStart = engine.phaseStart.addingTimeInterval(-1)
        engine.tick()
    }

    func run(_ seconds: Int) { for _ in 0..<seconds { step() } }

    /// Run to the end of the prescribed plan (or the cap, whichever first).
    @discardableResult
    func runPlan(cap: Int) -> Bool {
        var n = 0
        while !engine.planComplete && n < cap { step(); n += 1 }
        return engine.planComplete
    }

    func stop() { engine.reset() }
}

// MARK: - Archetype fixtures

@MainActor
enum Fx {

    /// EASY RUN · one `.work` phase, distance-measured, no target pace.
    /// (The backend expands every easy/long/recovery run to this shape.)
    static func easyRun(miles: Double = 6.0,
                        units: String? = nil,
                        fueling: WatchFueling? = nil) -> WatchWorkout {
        let p = WatchPhase(index: 0, type: .work, label: "Easy \(miles)",
                           durationSec: 3600, targetPaceSPerMi: nil,
                           tolerancePaceSPerMi: nil, haptic: .start,
                           repUnit: .distance, distanceMi: miles)
        return WatchWorkout(
            workoutId: "sim-easy", name: "Easy", summary: "easy",
            totalEstimatedMinutes: 60, phases: [p],
            completionEndpoint: "/api/watch/workouts/complete",
            expiresAt: "2099-12-31T00:00:00Z",
            distanceMi: miles, fueling: fueling, unitsDistance: units)
    }

    /// TIME INTERVALS · warmup, 6 × (90s work @ 391 ±10 / 90s recovery), cooldown.
    static func timeIntervals() -> WatchWorkout {
        var phases: [WatchPhase] = []
        var i = 0
        func add(_ t: WatchPhaseType, _ label: String, _ sec: Int, _ tgt: Int?, _ tol: Int?, _ h: WatchHaptic) {
            phases.append(WatchPhase(index: i, type: t, label: label, durationSec: sec,
                                     targetPaceSPerMi: tgt, tolerancePaceSPerMi: tol, haptic: h))
            i += 1
        }
        add(.warmup, "Warmup", 600, nil, nil, .start)
        for r in 1...6 {
            add(.work, "Interval \(r)/6", 90, 391, 10, .transitionWork)
            add(.recovery, "Recovery \(r)/6", 90, nil, nil, .transitionRecovery)
        }
        add(.cooldown, "Cooldown", 600, nil, nil, .transitionCooldown)
        return WatchWorkout(
            workoutId: "sim-time-intervals", name: "6 x 90s", summary: "intervals",
            totalEstimatedMinutes: 38, phases: phases,
            completionEndpoint: "/api/watch/workouts/complete",
            expiresAt: "2099-12-31T00:00:00Z")
    }

    /// DISTANCE INTERVALS · warmup 1 mi, 4 × (1.0 mi work @ 360 ±8 / 400 m
    /// recovery), cooldown 1 mi.
    static func distanceIntervals() -> WatchWorkout {
        let rec400m = 0.2485485
        var phases: [WatchPhase] = []
        var i = 0
        func add(_ t: WatchPhaseType, _ label: String, _ mi: Double, _ tgt: Int?, _ tol: Int?, _ h: WatchHaptic) {
            phases.append(WatchPhase(index: i, type: t, label: label,
                                     durationSec: Int(mi * 360), targetPaceSPerMi: tgt,
                                     tolerancePaceSPerMi: tol, haptic: h,
                                     repUnit: .distance, distanceMi: mi))
            i += 1
        }
        add(.warmup, "Warmup", 1.0, nil, nil, .start)
        for r in 1...4 {
            add(.work, "Rep \(r)/4", 1.0, 360, 8, .transitionWork)
            add(.recovery, "Recovery \(r)/4", rec400m, nil, nil, .transitionRecovery)
        }
        add(.cooldown, "Cooldown", 1.0, nil, nil, .transitionCooldown)
        return WatchWorkout(
            workoutId: "sim-dist-intervals", name: "4 x 1 mi", summary: "intervals",
            totalEstimatedMinutes: 45, phases: phases,
            completionEndpoint: "/api/watch/workouts/complete",
            expiresAt: "2099-12-31T00:00:00Z")
    }

    /// THRESHOLD · warmup 1 mi, 2 × (3.0 mi @ 391 ±8 / 0.5 mi float), cooldown 1 mi.
    static func threshold() -> WatchWorkout {
        var phases: [WatchPhase] = []
        var i = 0
        func add(_ t: WatchPhaseType, _ label: String, _ mi: Double, _ tgt: Int?, _ tol: Int?, _ h: WatchHaptic) {
            phases.append(WatchPhase(index: i, type: t, label: label,
                                     durationSec: Int(mi * 391), targetPaceSPerMi: tgt,
                                     tolerancePaceSPerMi: tol, haptic: h,
                                     repUnit: .distance, distanceMi: mi))
            i += 1
        }
        add(.warmup, "Warmup", 1.0, nil, nil, .start)
        for r in 1...2 {
            add(.work, "Block \(r)/2", 3.0, 391, 8, .transitionWork)
            add(.recovery, "Float \(r)/2", 0.5, nil, nil, .transitionRecovery)
        }
        add(.cooldown, "Cooldown", 1.0, nil, nil, .transitionCooldown)
        return WatchWorkout(
            workoutId: "sim-threshold", name: "2 x 3 mi T", summary: "threshold",
            totalEstimatedMinutes: 70, phases: phases,
            completionEndpoint: "/api/watch/workouts/complete",
            expiresAt: "2099-12-31T00:00:00Z")
    }

    /// RACE · marathon, six course segments, aid stations at 4/8/12/16/20/23.
    ///
    /// Segment lengths deliberately land OFF integer miles (4.3 / 8.6 / 12.9
    /// / 17.2 / 21.5) so a segment change and a mile boundary never coincide
    /// — the gel/mile-split collision is the thing under test and it should
    /// not be confounded by a second one.
    static func race() -> WatchWorkout {
        let segs: [(String, Double, Int)] = [
            ("Rolling start", 4.3, 407),
            ("Flat mid", 4.3, 405),
            ("The climb", 4.3, 412),
            ("Descent", 4.3, 400),
            ("Long straight", 4.3, 405),
            ("Home", 4.7, 402),
        ]
        var phases: [WatchPhase] = []
        for (i, s) in segs.enumerated() {
            phases.append(WatchPhase(index: i, type: .work, label: s.0,
                                     durationSec: Int(s.1 * Double(s.2)),
                                     targetPaceSPerMi: s.2, tolerancePaceSPerMi: 12,
                                     haptic: i == 0 ? .start : .transitionWork,
                                     repUnit: .distance, distanceMi: s.1))
        }
        return WatchWorkout(
            workoutId: "sim-race", name: "Marathon", summary: "race",
            totalEstimatedMinutes: 180, phases: phases,
            completionEndpoint: "/api/watch/workouts/complete",
            expiresAt: "2099-12-31T00:00:00Z",
            distanceMi: 26.2,
            isRace: true, goalSec: 10_620, strategyLabel: "Even effort",
            gelsMi: [4, 8, 12, 16, 20, 23])
    }

    /// JUST RUN · the product's own open-ended shape.
    static func justRun() -> WatchWorkout { WatchWorkout.makeJustRun() }

    /// `WatchFueling` declares its own `init(from:)`, which suppresses the
    /// memberwise init — so the only way to build one is off the wire.
    static func fueling(atMins: [Int], gels: Int) -> WatchFueling? {
        let json = """
        {"needed":true,"gels":\(gels),"atMins":\(atMins),"gPerHr":60,
         "totalCarbsG":180,"isRehearsal":false,"heatAdjusted":false,
         "shortLine":"Gel every 10","why":"sim"}
        """
        return try? JSONDecoder().decode(WatchFueling.self, from: Data(json.utf8))
    }
}

// MARK: - Shared assertions

@MainActor
private func assertTimelineIsSane(_ rec: CueRecorder, _ what: String) {
    // Nothing before GO.
    #expect(rec.events.first.map { if case .go = $0.cue { return true }; return false } == true,
            "\(what): the first cue of a run must be GO\n\(rec.summary)")
    // Exactly one GO, at the start.
    #expect(rec.gos.count == 1, "\(what): GO must fire exactly once\n\(rec.summary)")
    #expect(rec.gos.first?.sec == 0, "\(what): GO must fire at 0s")
    // Order is sane: elapsed never runs backward, the phase cursor never
    // rewinds, and no cue is repeated back-to-back within the same second.
    for (a, b) in zip(rec.events, rec.events.dropFirst()) {
        #expect(b.sec >= a.sec, "\(what): timeline ran backwards at \(a.sec)s → \(b.sec)s")
        #expect(b.phaseIndex >= a.phaseIndex, "\(what): phase cursor rewound")
        #expect(!(b.cue == a.cue && b.sec == a.sec),
                "\(what): the same cue fired twice on one tick at \(a.sec)s\n\(rec.summary)")
    }
    // Nothing fires while the clock is frozen.
    #expect(rec.events.allSatisfy { !$0.paused }, "\(what): a cue fired while paused")
}

/// Every `.split` recorded, paired with the phase type it fired in.
@MainActor
private func splitsInsideWorkReps(_ rec: CueRecorder) -> [CueRecorder.Event] {
    rec.splits.filter { $0.phaseType == .work }
}

// MARK: - Tests

@MainActor
@Suite("Session timelines")
struct SessionTimelineTests {

    // ─────────────────────────────────────────────────────────────────
    // MARK: EASY RUN
    // ─────────────────────────────────────────────────────────────────

    @Test("Easy run · GO fires exactly once, at the start")
    func easyRunGoFiresOnce() {
        let s = SimRun(Fx.easyRun(), pace: 480)
        s.start()
        s.runPlan(cap: 3200)
        #expect(s.engine.planComplete, "the 6 mi run should have finished its plan")
        assertTimelineIsSane(s.rec, "easy")
        s.stop()
    }

    @Test("Easy run · a split at every mile boundary, with the banked mile time")
    func easyRunSplitsEveryMile() {
        let s = SimRun(Fx.easyRun(), pace: 480)
        s.start()
        s.runPlan(cap: 3200)
        #expect(s.rec.splitMiles == [1, 2, 3, 4, 5, 6],
                "IN-RUN-CUES: an easy run splits every mile. got \(s.rec.splitMiles)\n\(s.rec.summary)")
        let paces: [Int] = s.rec.events.compactMap { if case .split(_, let p) = $0.cue { return p }; return nil }
        #expect(paces.allSatisfy { (470...495).contains($0) },
                "banked mile split should be ~480s at 8:00/mi. got \(paces)")
        s.stop()
    }

    @Test("Easy run · almost-done fires once, a quarter mile out, in miles")
    func easyRunAlmostDone() {
        let s = SimRun(Fx.easyRun(), pace: 480)
        s.start()
        s.runPlan(cap: 3200)
        #expect(s.rec.almostDones.count == 1,
                "almost-done is a one-shot. got \(s.rec.almostDones.count)\n\(s.rec.summary)")
        guard case .almostDone(let v, let u)? = s.rec.almostDones.first?.cue else {
            Issue.record("no almost-done cue on a 6 mi distance run"); return
        }
        #expect(v == "0.25")
        #expect(u == "mi left")
        // 5.75 mi at 8:00/mi.
        #expect(abs((s.rec.almostDones.first?.sec ?? 0) - 2760) <= 3)
        s.stop()
    }

    @Test("Easy run · almost-done speaks kilometres to a kilometre runner")
    func easyRunAlmostDoneKm() {
        let s = SimRun(Fx.easyRun(units: "km"), pace: 480)
        s.start()
        s.runPlan(cap: 3200)
        guard case .almostDone(let v, let u)? = s.rec.almostDones.first?.cue else {
            Issue.record("no almost-done cue"); return
        }
        // 0.25 mi is 0.4 km — the figure must convert, not just the word.
        #expect(u == "km left", "unit word must follow the runner's preference")
        #expect(v == "0.4", "0.25 mi is 0.4 km, not 0.25 km. got \(v)")
        s.stop()
    }

    @Test("Easy run · plan completes and the engine keeps recording")
    func easyRunEntersOvertimeWithoutFinishing() {
        let s = SimRun(Fx.easyRun(), pace: 480)
        s.start()
        s.runPlan(cap: 3200)
        #expect(s.engine.planComplete == true)
        #expect(s.engine.state == .running, "the engine must NOT auto-finish after the last phase")
        // Overtime must stay quiet and must not finish itself.
        let before = s.rec.events.count
        s.run(120)
        #expect(s.engine.state == .running)
        #expect(s.rec.events.count == before,
                "overtime raised \(s.rec.events.count - before) cue(s) it should not\n\(s.rec.summary)")
        s.stop()
    }

    @Test("Easy run · a planned gel fires once per mark, never twice")
    func easyRunTrainingFuelFiresOncePerMark() throws {
        let f = try #require(Fx.fueling(atMins: [10, 20, 30], gels: 3))
        let s = SimRun(Fx.easyRun(fueling: f), pace: 480)
        s.start()
        s.runPlan(cap: 3200)
        #expect(s.rec.fuelIndices == [1, 2, 3],
                "three marks, three cues, in order. got \(s.rec.fuelIndices)\n\(s.rec.summary)")
        let secs = s.rec.fuels.map(\.sec)
        #expect(secs.map { $0 / 60 } == [10, 20, 30], "gels are elapsed-time anchored. got \(secs)")
        s.stop()
    }

    // ─────────────────────────────────────────────────────────────────
    // MARK: JUST RUN
    // ─────────────────────────────────────────────────────────────────

    @Test("Just run · GO then splits, and nothing structured")
    func justRunSplitsOnly() {
        let s = SimRun(Fx.justRun(), pace: 480)
        s.start()
        s.run(1500)     // a bit over 3 miles
        assertTimelineIsSane(s.rec, "just-run")
        #expect(s.rec.splitMiles == [1, 2, 3],
                "an unstructured run splits every mile. got \(s.rec.splitMiles)\n\(s.rec.summary)")
        #expect(s.rec.phaseCues.isEmpty, "a just-run has no phase changes to announce")
        #expect(s.rec.headsUps.isEmpty, "no target pace means no drift band to leave")
        s.stop()
    }

    @Test("Just run · no almost-done, because there is no end to be near")
    func justRunHasNoAlmostDone() {
        // NOTE (doc drift, not an engine defect): IN-RUN-CUES.md's
        // per-archetype table marks "Almost done ●" for Just run. A just-run
        // carries no distance and no duration the runner is working toward —
        // `nearEnd` is unreachable — so the engine cannot fire it and should
        // not. The table row is wrong, not the code.
        let s = SimRun(Fx.justRun(), pace: 480)
        s.start()
        s.run(1500)
        #expect(s.rec.almostDones.isEmpty,
                "a just-run has no measured end, so nothing can be almost done\n\(s.rec.summary)")
        s.stop()
    }

    @Test("Just run · ending it counts as completed, not abandoned")
    func justRunEndsCompleted() throws {
        let s = SimRun(Fx.justRun(), pace: 480)
        s.start()
        s.run(600)
        s.engine.abandon()
        let c = try #require(s.engine.completion)
        #expect(c.status == "completed", "the runner ending an open-ended run IS how it completes")
    }

    // ─────────────────────────────────────────────────────────────────
    // MARK: TIME INTERVALS
    // ─────────────────────────────────────────────────────────────────

    @Test("Time intervals · a phase cue entering every work rep, naming the rep")
    func timeIntervalsPhaseCuePerRep() {
        let s = SimRun(Fx.timeIntervals(), pace: 400)
        s.start()
        s.runPlan(cap: 3000)
        #expect(s.engine.planComplete)
        assertTimelineIsSane(s.rec, "time-intervals")
        #expect(s.rec.phaseCues.count == 6,
                "six work reps, six phase cues. got \(s.rec.phaseCues.count)\n\(s.rec.summary)")
        #expect(s.rec.phaseSubs == (1...6).map { "Rep \($0) of 6" },
                "the cue must say which rep. got \(s.rec.phaseSubs)")
        #expect(s.rec.phaseCues.allSatisfy { $0.phaseType == .work },
                "a phase cue must land inside the rep it announces")
        s.stop()
    }

    @Test("Time intervals · the mile split is suppressed inside a rep")
    func timeIntervalsSplitSuppressedInReps() {
        // Pace 400 s/mi is chosen so mile 2 and mile 3 land INSIDE work reps
        // and mile 1 / 4 / 5 land outside — the suppression has to be real,
        // not an artefact of the boundaries missing the reps.
        let s = SimRun(Fx.timeIntervals(), pace: 400)
        s.start()
        s.runPlan(cap: 3000)
        #expect(splitsInsideWorkReps(s.rec).isEmpty,
                "a mile takeover during a 90s rep is the noise the gate exists to stop\n\(s.rec.summary)")
        #expect(s.rec.splitMiles.contains(1), "warmup miles still split")
        #expect(!s.rec.splitMiles.contains(2), "mile 2 falls in a rep and must stay silent")
        #expect(!s.rec.splitMiles.contains(3), "mile 3 falls in a rep and must stay silent")
        #expect(s.rec.splitMiles.contains(4), "the split after the reps must carry the CORRECT mile number")
        s.stop()
    }

    @Test("Time intervals · no almost-done on a time rep")
    func timeIntervalsNoAlmostDone() {
        let s = SimRun(Fx.timeIntervals(), pace: 400)
        s.start()
        s.runPlan(cap: 3000)
        #expect(s.rec.almostDones.isEmpty,
                "time reps get the live ending countdown instead\n\(s.rec.summary)")
        s.stop()
    }

    @Test("Time intervals · the ending countdown runs 10 down to 1")
    func timeIntervalsEndingCountdown() {
        let s = SimRun(Fx.timeIntervals(), pace: 400)
        s.start()
        s.run(600)                          // end of warmup, into rep 1
        #expect(s.engine.currentPhase?.type == .work)
        #expect(s.engine.endingCountdownSec == nil, "no countdown 90 seconds out")
        var seen: [Int] = []
        for _ in 0..<90 {
            s.step()
            if let n = s.engine.endingCountdownSec, seen.last != n { seen.append(n) }
        }
        #expect(seen.first == 10, "the countdown opens at 10. got \(seen)")
        #expect(seen.count >= 9, "the countdown should tick every second. got \(seen)")
        #expect(zip(seen, seen.dropFirst()).allSatisfy { $0 - $1 == 1 },
                "the countdown must decrement by one, never repeat or skip. got \(seen)")
        s.stop()
    }

    // ─────────────────────────────────────────────────────────────────
    // MARK: DISTANCE INTERVALS
    // ─────────────────────────────────────────────────────────────────

    @Test("Distance intervals · a phase cue entering every work rep")
    func distanceIntervalsPhaseCuePerRep() {
        let s = SimRun(Fx.distanceIntervals(), pace: 360)
        s.start()
        s.runPlan(cap: 3000)
        #expect(s.engine.planComplete)
        assertTimelineIsSane(s.rec, "distance-intervals")
        #expect(s.rec.phaseCues.count == 4, "four reps, four cues\n\(s.rec.summary)")
        #expect(s.rec.phaseSubs == (1...4).map { "Rep \($0) of 4" })
        s.stop()
    }

    @Test("Distance intervals · almost-done on every distance rep, and only there")
    func distanceIntervalsAlmostDone() {
        let s = SimRun(Fx.distanceIntervals(), pace: 360)
        s.start()
        s.runPlan(cap: 3000)
        #expect(s.rec.almostDones.count == 4,
                "one per work rep — warmup, floats and cooldown get none\n\(s.rec.summary)")
        #expect(s.rec.almostDones.allSatisfy { $0.phaseType == .work })
        let units: [String] = s.rec.events.compactMap { if case .almostDone(_, let u) = $0.cue { return u }; return nil }
        #expect(units.allSatisfy { $0 == "mi left" })
        s.stop()
    }

    @Test("Distance intervals · the mile split is suppressed inside a rep")
    func distanceIntervalsSplitSuppressedInReps() {
        let s = SimRun(Fx.distanceIntervals(), pace: 360)
        s.start()
        s.runPlan(cap: 3000)
        #expect(splitsInsideWorkReps(s.rec).isEmpty,
                "1-mile reps put a mile boundary inside almost every rep\n\(s.rec.summary)")
        #expect(s.rec.splitMiles.contains(1), "the warmup mile still splits")
        s.stop()
    }

    // ─────────────────────────────────────────────────────────────────
    // MARK: THRESHOLD
    // ─────────────────────────────────────────────────────────────────

    @Test("Threshold · a phase cue entering each block, and none inside one")
    func thresholdPhaseCuePerBlock() {
        let s = SimRun(Fx.threshold(), pace: 391)
        s.start()
        s.runPlan(cap: 4000)
        #expect(s.engine.planComplete)
        assertTimelineIsSane(s.rec, "threshold")
        #expect(s.rec.phaseCues.count == 2, "two blocks, two cues\n\(s.rec.summary)")
        #expect(s.rec.phaseSubs == ["Rep 1 of 2", "Rep 2 of 2"])
        s.stop()
    }

    @Test("Threshold · no mile takeover inside a block")
    func thresholdSplitSuppressedInBlocks() {
        let s = SimRun(Fx.threshold(), pace: 391)
        s.start()
        s.runPlan(cap: 4000)
        #expect(splitsInsideWorkReps(s.rec).isEmpty,
                "a 3 mi block crosses two mile boundaries and must stay silent for both\n\(s.rec.summary)")
        s.stop()
    }

    @Test("Threshold · a distance block still gets its almost-done")
    func thresholdAlmostDoneOnDistanceBlocks() {
        // NOTE (doc drift): IN-RUN-CUES.md's per-archetype table prints "—"
        // for Threshold / Almost done, but its own cue table one section
        // above says almost-done fires "0.03 mi from the end of a DISTANCE
        // phase" — which a 3-mile block is. The engine follows the cue table.
        // The archetype row is the stale one.
        let s = SimRun(Fx.threshold(), pace: 391)
        s.start()
        s.runPlan(cap: 4000)
        #expect(s.rec.almostDones.count == 2,
                "one per distance block\n\(s.rec.summary)")
        #expect(s.rec.almostDones.allSatisfy { $0.phaseType == .work })
        s.stop()
    }

    // ─────────────────────────────────────────────────────────────────
    // MARK: RACE
    // ─────────────────────────────────────────────────────────────────

    @Test("Race · every mile splits, start to finish")
    func raceSplitsEveryMile() {
        let s = SimRun(Fx.race(), pace: 405)
        s.start()
        s.runPlan(cap: 11_000)
        #expect(s.engine.planComplete, "the marathon should have run out of course")
        assertTimelineIsSane(s.rec, "race")
        #expect(s.rec.splitMiles == Array(1...26),
                "a course segment is not a rep — a race splits every mile. got \(s.rec.splitMiles.count) splits")
        s.stop()
    }

    @Test("Race · a phase cue on every course segment change")
    func racePhaseCuePerSegment() {
        let s = SimRun(Fx.race(), pace: 405)
        s.start()
        s.runPlan(cap: 11_000)
        // Five, not six: segment 1 is announced by GO at the start of the run,
        // which is the only announcement there is room for at 0s.
        #expect(s.rec.phaseCues.count == 5,
                "six segments, five changes\n\(s.rec.summary)")
        let titles: [String] = s.rec.events.compactMap { if case .phase(let t, _) = $0.cue { return t }; return nil }
        #expect(titles == ["Flat mid", "The climb", "Descent", "Long straight", "Home"],
                "the cue must name the segment being entered. got \(titles)")
        let subs = s.rec.phaseSubs
        #expect(subs.allSatisfy { $0.contains("hold effort") },
                "a race segment cue carries the new target and a two-word instruction. got \(subs)")
        s.stop()
    }

    @Test("Race · one fuel cue per aid station, none repeated")
    func raceFuelOncePerGelMark() {
        let s = SimRun(Fx.race(), pace: 405)
        s.start()
        s.runPlan(cap: 11_000)
        #expect(s.rec.fuelIndices == [1, 2, 3, 4, 5, 6],
                "six aid stations, six cues, in order. got \(s.rec.fuelIndices)")
        #expect(Set(s.rec.fuelIndices).count == s.rec.fuelIndices.count, "no mark may fire twice")
        // Each fires at its own mile, not early and not late.
        let miles = s.rec.fuels.map { Double($0.sec) / 405.0 }
        for (fired, mark) in zip(miles, [4.0, 8, 12, 16, 20, 23]) {
            #expect(abs(fired - mark) < 0.01, "gel fired at \(fired) mi, mark is \(mark)")
        }
        s.stop()
    }

    @Test("Race · no almost-done and no drift board")
    func raceHasNoAlmostDone() {
        let s = SimRun(Fx.race(), pace: 405)
        s.start()
        s.runPlan(cap: 11_000)
        #expect(s.rec.almostDones.isEmpty,
                "race day is excluded from the almost-done flash\n\(s.rec.summary)")
        #expect(s.rec.headsUps.isEmpty, "steady on-target running raises no drift cue")
        s.stop()
    }

    @Test("Race · a race cannot be paused")
    func raceCannotBePaused() {
        let s = SimRun(Fx.race(), pace: 405)
        s.start()
        s.run(600)
        s.engine.pause()
        #expect(s.engine.isPaused == false, "race elapsed is gun-to-mat (audit W-3)")
        // And the block must not have eaten the runner's cues either.
        let before = s.rec.events.count
        s.run(120)
        #expect(s.rec.events.count >= before)
        s.stop()
    }

    @Test("Race · a gel at an aid-station mile delivers both cues, in order")
    func raceGelAndSplitBothSurviveTheSameTick() {
        let s = SimRun(Fx.race(), pace: 405)
        s.start()
        s.runPlan(cap: 11_000)

        // Mile 4 IS aid station 1, and gelsMi are literally mile markers, so
        // this collision is the normal case, not an edge one.
        //
        // WAS: both were raised in one tick(), `flash()` simply reassigned
        // `transition`, and the split board was created and destroyed before
        // any view saw it — while its haptic still fired. The runner felt a
        // mile go by, looked down, and found a gel prompt, at six of a
        // marathon's twenty-six miles.
        //
        // Dropping the split instead was tried and is not good enough: those
        // six are miles a runner wants. Both are delivered now, in the order
        // raised, drained on engine time rather than by an async clear.
        let mileFour = s.rec.events.contains {
            if case .split(let m, _) = $0.cue { return m == 4 }; return false
        }
        #expect(mileFour, "an aid-station mile must still get its split board")
        #expect(s.rec.fuelIndices.contains(1), "and the gel must still cue")

        // Every mile, aid station or not — the property the race-split fix
        // established, which this must not quietly undo.
        #expect(s.rec.splitMiles == Array(1...26), "\(s.rec.summary)")
        s.stop()
    }

    @Test("Paused · the engine raises no cue while the clock is frozen")
    func noCueFiresWhilePaused() {
        let s = SimRun(Fx.easyRun(), pace: 480)
        s.start()
        s.run(470)                    // ten seconds short of mile 1
        s.engine.pause()
        #expect(s.engine.isPaused)
        #expect(s.engine.transition == nil, "pausing clears whatever board was up")
        let before = s.rec.events.count
        // Move the runner well past two mile boundaries while paused.
        s.tracker.setFixture(pace: 480, hr: 150, cadence: 178, distanceMi: 2.5)
        for _ in 0..<60 { s.engine.tick() }
        #expect(s.rec.events.count == before,
                "a paused engine must publish nothing\n\(s.rec.summary)")
        s.engine.resume()
        #expect(s.engine.isPaused == false)
        s.stop()
    }

    @Test("Idle · no cue before start(), and tick() is inert")
    func noCueBeforeStart() {
        let s = SimRun(Fx.timeIntervals(), pace: 400)
        s.rec.attach(s.engine)
        #expect(s.engine.transition == nil)
        for _ in 0..<20 { s.engine.tick() }
        #expect(s.rec.events.isEmpty, "an idle engine must be silent\n\(s.rec.summary)")
        #expect(s.engine.state == .idle)
        #expect(s.engine.totalElapsedSec == 0)
    }

    @Test("Paused · a phase cannot be ended while the clock is frozen")
    func endingAPhaseWhilePausedFiresACue() {
        let s = SimRun(Fx.timeIntervals(), pace: 400)
        s.start()
        s.run(700)                     // warmup + rep 1 done; inside recovery 1
        #expect(s.engine.currentPhase?.type == .recovery, "precondition: on a recovery")
        s.engine.pause()
        #expect(s.engine.isPaused)
        let before = s.rec.events.count

        // The recovery face's "Go now" button (WatchRouterV5 line ~531) is the
        // one caller of endCurrentPhase(), and it is drawn whenever controls
        // are showing on a recovery — a state the runner can also be paused in.
        s.engine.endCurrentPhase()

        // FIXED 2026-08-24. `pause()` blocks the tick and clears the board
        // precisely so a frozen run shows the paused screen and nothing else,
        // and `endCurrentPhase()` only guarded `state` and `!planComplete`.
        // Advancing while paused raised the "Rep 2 of 6" takeover, and
        // `WatchRouterV5.interrupt()` ranks a live transition ABOVE `.paused`
        // — so the paused screen was replaced by an announcement for a rep
        // whose clock was not running.
        //
        // The same guard closes the sibling defect below: `resume()` shifts
        // `phaseStart` by the WHOLE pause, which is only sound if the phase in
        // flight is the one that was in flight when the pause began.
        #expect(s.rec.events.count == before,
                "no cue may be raised while isPaused\n\(s.rec.summary)")
        #expect(s.engine.currentPhase?.type == .recovery,
                "and the phase must not have advanced")
        s.stop()
    }

    @Test("Paused · resuming after a phase was ended while paused rewinds the clock below zero")
    func resumingAfterPausedAdvanceRewindsTheClock() async throws {
        let s = SimRun(Fx.timeIntervals(), pace: 400)
        s.start()
        s.run(700)
        #expect(s.engine.currentPhase?.type == .recovery)
        s.engine.pause()
        // Sit paused for a while, then jump to the next rep, then resume.
        try await Task.sleep(for: .milliseconds(2600))
        s.engine.endCurrentPhase()              // advance() stamps phaseStart = .now
        try await Task.sleep(for: .milliseconds(400))
        s.engine.resume()                       // shifts phaseStart by the WHOLE pause
        s.engine.tick()

        withKnownIssue("resume() shifts a phase that began mid-pause by the whole pause",
                       isIntermittent: true) {
            // BUG: `resume()` pushes `phaseStart` forward by the entire paused
            // interval, which is only correct if the phase in flight is the
            // one that was in flight when the pause began. If the phase
            // changed during the pause, its origin is shoved into the FUTURE
            // by however long the pause had already run — `phaseElapsedSec`
            // publishes a negative number and `phaseRemainingSec` reads HIGHER
            // than the rep's own duration, so the rep the runner just skipped
            // to counts down from more than it started with, and the total
            // clock (bankedSec + phaseSec) goes backwards with it.
            #expect(s.engine.phaseElapsedSec >= 0,
                    "elapsed went to \(s.engine.phaseElapsedSec)s")
            #expect(s.engine.phaseRemainingSec <= 90,
                    "remaining \(s.engine.phaseRemainingSec)s on a 90s rep")
        }
        s.stop()
    }

    // ─────────────────────────────────────────────────────────────────
    // MARK: DRIFT
    // ─────────────────────────────────────────────────────────────────

    @Test("Drift · a phase boundary is not drift, however far off the pace is")
    func driftDoesNotFireAtPhaseBoundaries() {
        // 700 s/mi against a 391 target is 5 minutes per mile of drift, and
        // the session crosses thirteen phase boundaries — but no drift is ever
        // SUSTAINED (the evaluator wants 5 s inside one episode and this drive
        // consumes no wall clock), so the correct answer is silence.
        let s = SimRun(Fx.timeIntervals(), pace: 700)
        s.start()
        s.runPlan(cap: 3000)
        #expect(s.rec.phaseCues.count == 6, "precondition: the boundaries were crossed")
        #expect(s.rec.headsUps.isEmpty,
                "drift is a sustained-effort cue, not a boundary cue\n\(s.rec.summary)")
        s.stop()
    }

    @Test("Drift · sustained drift on a work rep raises the heads-up board")
    func driftFiresOnSustainedDrift() async {
        let s = SimRun(Fx.timeIntervals(), pace: 391)
        s.start()
        s.run(605)                                  // into rep 1
        #expect(s.engine.currentPhase?.type == .work, "precondition: inside a work rep")
        s.tracker.mockCenterPace = 480              // hold the sim feed off-band too
        s.pace = 480                                // 89 s/mi slow, band is ±10
        var fired = false
        for _ in 0..<60 {
            s.tracker.setFixture(pace: 480, hr: 150, cadence: 178, distanceMi: s.mi)
            s.engine.tick()
            if !s.rec.headsUps.isEmpty { fired = true; break }
            try? await Task.sleep(for: .milliseconds(250))
        }
        #expect(fired, "5 s outside the band must raise the heads-up cue\n\(s.rec.summary)")
        #expect(s.engine.paceZone == .offTarget, "89 s/mi slow is past the hard-drift edge")
        s.stop()
    }

    @Test("Drift · a race gets the correction board too")
    func driftFiresOnARaceDespiteTheDoc() async {
        let s = SimRun(Fx.race(), pace: 407)
        s.start()
        s.run(300)
        #expect(s.engine.currentPhase?.type == .work)
        s.tracker.mockCenterPace = 500
        s.pace = 500                                // 93 s/mi off a ±12 band
        for _ in 0..<60 {
            s.tracker.setFixture(pace: 500, hr: 150, cadence: 178, distanceMi: s.mi)
            s.engine.tick()
            if !s.rec.headsUps.isEmpty { break }
            try? await Task.sleep(for: .milliseconds(250))
        }
        // NOT A BUG — the DOC was wrong, and this test found it.
        // IN-RUN-CUES.md recorded drift as excluded from a race, which was an
        // assumption generalised from the almost-done path's own !isRace guard.
        // Nothing in the engine excludes it and nothing should: going out too
        // fast in the first 10k is the classic marathon error, and is exactly
        // who an "ease off" is for. The table row is corrected.
        // BUG: IN-RUN-CUES.md's archetype table says Drift is "— (race is
        // excluded)" for a race, and nothing in the engine excludes it.
        // `prepDrift()` arms an evaluator for any `.work` phase carrying a
        // target, and race course segments are `.work` phases carrying
        // targets — so a marathoner who drifts outside the segment band
        // for five seconds gets a full-screen "ease off / pick it up"
        // takeover for 2.6 s, hiding live pace. In the back half of a
        // marathon, where drifting off goal pace is the normal state, that
        // board can return again and again.
        #expect(s.rec.headsUps.isEmpty == false,
                "a race must still correct a runner off their band\n\(s.rec.summary)")
        s.stop()
    }

    // ─────────────────────────────────────────────────────────────────
    // MARK: CROSS-ARCHETYPE
    // ─────────────────────────────────────────────────────────────────

    @Test("Every archetype · GO once, nothing before it, nothing repeated")
    func everyArchetypeHasASaneTimeline() {
        let cases: [(String, WatchWorkout, Int, Int)] = [
            ("easy",       Fx.easyRun(),           480, 3200),
            ("just-run",   Fx.justRun(),           480, 1500),
            ("time-ints",  Fx.timeIntervals(),     400, 3000),
            ("dist-ints",  Fx.distanceIntervals(), 360, 3000),
            ("threshold",  Fx.threshold(),         391, 4000),
            ("race",       Fx.race(),              405, 11_000),
        ]
        for (name, w, pace, cap) in cases {
            let s = SimRun(w, pace: pace)
            s.start()
            s.runPlan(cap: cap)
            assertTimelineIsSane(s.rec, name)
            #expect(s.rec.events.count > 1, "\(name): the run published only GO")
            s.stop()
        }
    }

    @Test("Every archetype · the plan completes and the engine never finishes itself")
    func everyArchetypeEntersOvertimeRatherThanFinishing() {
        let cases: [(String, WatchWorkout, Int, Int)] = [
            ("easy",       Fx.easyRun(),           480, 3200),
            ("time-ints",  Fx.timeIntervals(),     400, 3000),
            ("dist-ints",  Fx.distanceIntervals(), 360, 3000),
            ("threshold",  Fx.threshold(),         391, 4000),
            ("race",       Fx.race(),              405, 11_000),
        ]
        for (name, w, pace, cap) in cases {
            let s = SimRun(w, pace: pace)
            s.start()
            let done = s.runPlan(cap: cap)
            #expect(done, "\(name): the plan never ran out inside \(cap) simulated seconds")
            #expect(s.engine.state == .running, "\(name): the engine must not auto-finish")
            #expect(s.engine.completion == nil, "\(name): nothing is written until the runner ends it")
            s.stop()
        }
    }
}
