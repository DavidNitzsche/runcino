//
//  _SessionSim.swift
//  FaffWatch
//
//  TEMPORARY review harness. Remove with _FacePreview.swift.
//
//  Renders the REAL running surface, driven by a REAL engine, at any point in
//  a real session: `-sim intervals -at 300`.
//
//  WHY THIS EXISTS. Every board reviewed so far was drawn from a fixture I
//  wrote by hand, and twice that turned out to be a screen the router could
//  not actually produce — a band the router never passed, and a phase-change
//  board whose unit the router draws twice. A fixture is a claim about the
//  engine; this is the engine.
//
//  It mounts `WatchRunSurfaceV5`, which is what the app mounts. Nothing here
//  reimplements the router's decisions: the archetypes below build a workout,
//  the driver rolls the clock, and the shipping view decides what to draw.
//
//  IT IS SILENT BY DEFAULT (2026-09-01). Running the real engine means running
//  the real voice, and a warped session speaks a mile split every few seconds
//  out of the host machine's speakers. Pass `-speak` to hear it; do not pass it
//  to review a board. See `SessionSim.speak`.
//
import SwiftUI

enum SessionSim {
    static var request: (archetype: String, at: Int)? {
        let a = ProcessInfo.processInfo.arguments
        guard let i = a.firstIndex(of: "-sim"), i + 1 < a.count else { return nil }
        let at = a.firstIndex(of: "-at").flatMap { $0 + 1 < a.count ? Int(a[$0 + 1]) : nil } ?? 0
        return (a[i + 1], at)
    }

    /// `-hr <n>` · the heart rate the mock holds, so an HR-metric bail or
    /// abort rule can actually be breached. Nil leaves the mock's own centre.
    ///
    /// The stream is otherwise real: `WorkoutTracker`'s mock feeds the SAME
    /// `tracker.heartRate` the engine reads on the wrist, `noteRuleMetric`
    /// accumulates against the rule's own `metric` / `op` / `value`, and the
    /// 120-second sustain (`Research/03` §2, HR kinetics) is 120 seconds of
    /// real time whatever the time-warp, because the tick loop sleeps in wall
    /// clock. Nothing here shortcuts the rule.
    static var mockHr: Int? {
        let a = ProcessInfo.processInfo.arguments
        return a.firstIndex(of: "-hr").flatMap { $0 + 1 < a.count ? Int(a[$0 + 1]) : nil }
    }

    /// `-speak` · let the session TALK. Off by default, and that default is
    /// the whole point.
    ///
    /// THIS HARNESS RUNS THE REAL ENGINE, which is its value and was also its
    /// hazard: the engine says every mile split through `SpokenCues`, and at
    /// `-warp 30` a mile passes about every seven seconds. Driving a marathon
    /// to reach a mile-10 rule therefore reads "mile one, mile two…" out of
    /// the machine's speakers for the whole run. That happened on 2026-09-01,
    /// out loud, on the owner's machine, four times, while the thing under
    /// review was a BOARD — a picture, needing no audio at all.
    ///
    /// So the harness is silent unless silence is the thing being reviewed.
    /// Spoken cues are verified the way everything else here is: by asserting
    /// the cue TEXT and its trigger in a test, and reading the payload.
    static var speak: Bool {
        ProcessInfo.processInfo.arguments.contains("-speak")
    }

    /// `-pacedrift <n>` · how far the mock's pace wanders, s/mi.
    ///
    /// Set it small to model a runner HOLDING pace, which is the only way to
    /// isolate an HR rule. With the default 18 against a 12 s race band the
    /// mock drifts out of the band, `milesAdrift` moves, and a bail guard
    /// wired to the PACE evidence fires for the wrong reason — which is
    /// exactly what masked the dead-observer defect on its first falsification.
    static var mockPaceDrift: Double? {
        let a = ProcessInfo.processInfo.arguments
        return a.firstIndex(of: "-pacedrift").flatMap { $0 + 1 < a.count ? Double(a[$0 + 1]) : nil }
    }

    // MARK: Archetypes

    private static func phase(_ i: Int, _ t: WatchPhaseType, _ label: String,
                             sec: Int, target: Int? = nil, tol: Int? = nil,
                             mi: Double? = nil, haptic: WatchHaptic = .transitionWork) -> WatchPhase {
        WatchPhase(index: i, type: t, label: label, durationSec: sec,
                   targetPaceSPerMi: target, tolerancePaceSPerMi: tol, haptic: haptic,
                   repUnit: mi == nil ? .time : .distance, distanceMi: mi)
    }

    private static func workout(_ id: String, _ name: String, _ phases: [WatchPhase],
                                distanceMi: Double? = nil, isRace: Bool = false,
                                goalSec: Int? = nil, gelsMi: [Double]? = nil,
                                units: String? = nil,
                                rules: [WatchRule]? = nil,
                                raceHr: WatchRaceHr? = nil) -> WatchWorkout {
        WatchWorkout(workoutId: id, name: name, summary: name,
                     totalEstimatedMinutes: phases.reduce(0) { $0 + $1.durationSec } / 60,
                     phases: phases,
                     completionEndpoint: "/api/watch/workouts/complete",
                     expiresAt: "2099-12-31T00:00:00Z",
                     distanceMi: distanceMi,
                     isRace: isRace, goalSec: goalSec, gelsMi: gelsMi,
                     raceHr: raceHr,
                     unitsDistance: units,
                     rules: rules)
    }

    static func build(_ name: String) -> WatchWorkout {
        switch name {
        case "intervals":
            var p = [phase(0, .warmup, "Warm-up", sec: 600, haptic: .start)]
            for r in 0..<6 {
                p.append(phase(p.count, .work, "Work", sec: 90, target: 391, tol: 10))
                p.append(phase(p.count, .recovery, "Recovery", sec: 90, haptic: .transitionRecovery))
                _ = r
            }
            p.append(phase(p.count, .cooldown, "Cool-down", sec: 600, haptic: .transitionCooldown))
            return workout("sim-intervals", "6 x 400 m", p)

        case "threshold":
            var p = [phase(0, .warmup, "Warm-up", sec: 900, haptic: .start)]
            for _ in 0..<2 {
                p.append(phase(p.count, .work, "Threshold", sec: 1200, target: 391, tol: 8, mi: 3.0))
                p.append(phase(p.count, .recovery, "Recovery", sec: 240, haptic: .transitionRecovery))
            }
            p.append(phase(p.count, .cooldown, "Cool-down", sec: 900, haptic: .transitionCooldown))
            return workout("sim-threshold", "2 x 3 mi", p)

        case "race":
            var p: [WatchPhase] = []
            for (i, seg) in [("Opening rollers", 1500, 526), ("Bixby descent", 900, 502),
                             ("Hurricane climb", 1140, 638), ("Point descent", 720, 514),
                             ("Coast miles", 3120, 532), ("Carmel run-in", 1500, 520)].enumerated() {
                p.append(phase(i, .work, seg.0, sec: seg.1, target: seg.2, tol: 12))
            }
            return workout("sim-race", "Marathon", p, distanceMi: 26.2, isRace: true,
                           goalSec: 13_800, gelsMi: [4, 8, 12, 16, 20, 23])

        case "racebail":
            /* HR-SEMANTICS-2 · the RACE ABORT, driveable.
             *
             * The owner's real CIM guidance: abort at mile 10 above 163 bpm
             * (`raceAbortHrBpm` = 0.95 × LTHR 168 + 3), expected band 148-160.
             * `scope: "mile-10"` gates it, `metric: "hr"` decides it, and the
             * board draws only after `hrRuleSustainSec` (120 s).
             *
             * Before C-1 an abort drew NOTHING — `bailRule` looked for a bail
             * and nothing else, so every race abort the plan authored was
             * persisted, shipped, decoded and inert. Run this with
             * `-sim racebail -warp 60 -hr 180` to put it on screen.
             */
            var rp: [WatchPhase] = []
            for (i, seg) in [("Opening", 3600, 451), ("Middle", 3600, 451),
                             ("Late", 3600, 451), ("Run-in", 1620, 451)].enumerated() {
                rp.append(phase(i, .work, seg.0, sec: seg.1, target: seg.2, tol: 12))
            }
            return workout("sim-racebail", "CIM", rp, distanceMi: 26.22, isRace: true,
                           goalSec: 11_820,
                           rules: [WatchRule(
                               kind: "abort", metric: "hr", op: ">", value: 163,
                               scope: "mile-10", action: "switch_to_b_goal",
                               label: "Mile 10 heart rate over 163 · switch to the B plan",
                               evidence: "Mile 10 heart rate over 163",
                               judgement: "The A goal is gone from here · run the B plan and finish the race that is still in front of you.")],
                           raceHr: WatchRaceHr(expectedLoBpm: 148, expectedHiBpm: 160,
                                               earlyCeilingBpm: 148, earlyThroughMi: 10,
                                               lateAllowanceBpm: 165, checkpointMi: 10,
                                               checkpointAbortBpm: 163, informationalOnly: false))

        case "thresholdbail":
            /* The BAIL, on a threshold session: drop to easy above 173 bpm
             * (`thresholdPassHrBpm`-derived), scope `work`, no mile gate.
             * `-sim thresholdbail -warp 60 -hr 185`. */
            var bp = [phase(0, .warmup, "Warm-up", sec: 600, haptic: .start)]
            for _ in 0..<4 {
                bp.append(phase(bp.count, .work, "Interval · 1 mi", sec: 430, target: 430, tol: 8, mi: 1.0))
                bp.append(phase(bp.count, .recovery, "Jog 1 min", sec: 60, haptic: .transitionRecovery))
            }
            bp.append(phase(bp.count, .cooldown, "Cool-down", sec: 600, haptic: .transitionCooldown))
            return workout("sim-thresholdbail", "4 x 1 mi", bp, distanceMi: 8.5,
                           rules: [WatchRule(
                               kind: "bail", metric: "hr", op: ">", value: 173,
                               scope: "work", action: "drop_to_easy",
                               label: "Heart rate over 173 and still climbing · drop to easy",
                               evidence: "Heart rate over 173 and still climbing",
                               judgement: "The stimulus is already banked · forcing the rest of the reps buys fatigue, not fitness.")])

        case "km":
            return workout("sim-km", "Easy",
                           [phase(0, .work, "Easy", sec: 3600, mi: 6.0, haptic: .start)],
                           distanceMi: 6.0, units: "km")

        case "justrun":
            return workout("sim-justrun", "Just run",
                           [phase(0, .work, "Just run", sec: 3600, haptic: .start)])

        default:   // "easy"
            return workout("sim-easy", "Easy",
                           [phase(0, .work, "Easy", sec: 3600, target: 537, tol: 25, mi: 6.0,
                                  haptic: .start)],
                           distanceMi: 6.0)
        }
    }
}

/// Mounts the shipping surface and lets a REAL session run.
///
/// USES THE APP'S OWN TIME WARP rather than rolling the clock by hand.
/// `-warp 60` makes the engine perceive a minute per second, so a ten-minute
/// warm-up finishes in ten seconds and a marathon is watchable. That path was
/// already in the engine (`WorkoutEngine.warpFactor`) and is a far better
/// simulation than ticking manually: the real timer loop runs, the real
/// transitions fire, the real cues clear on their real schedules.
///
/// The tracker feeds itself. On a simulator with no HealthKit or GPS,
/// `WorkoutTracker` starts a mock that oscillates pace, heart rate and cadence
/// around plausible centres — which is why a hand-set fixture was pointless
/// here: the mock overwrites it a second later. `mockCenterPace` is the one
/// dial worth turning, so a session's pace relates to the target it is being
/// graded against.
struct SessionSimView: View {
    let archetype: String
    let at: Int

    @StateObject private var engine: WorkoutEngine
    @StateObject private var tracker = WorkoutTracker()

    init(archetype: String, at: Int) {
        self.archetype = archetype
        self.at = at
        _engine = StateObject(wrappedValue: WorkoutEngine(workout: SessionSim.build(archetype)))
    }

    var body: some View {
        WatchRunSurfaceV5(engine: engine, tracker: tracker)
            .task {
                engine.tracker = tracker
                // Sit the mock near the first target that exists, so the band
                // is exercised rather than pinned to one end of itself.
                let target = engine.workout.phases
                    .compactMap { $0.targetPaceSPerMi }.first ?? 537
                tracker.mockCenterPace = target
                // HR-SEMANTICS-2 · `-hr <n>`, so a safety rule can be breached.
                if let hr = SessionSim.mockHr { tracker.mockCenterHr = hr }
                if let d = SessionSim.mockPaceDrift { tracker.mockPaceDriftS = d }
                // MUTE FIRST, START SECOND. `SpokenCues.enabled` reads this key
                // on every call, so writing it before `start()` silences the
                // opening cue too. See `SessionSim.speak`.
                if !SessionSim.speak {
                    UserDefaults.standard.set(false, forKey: "spokenCues")
                }
                engine.start()
            }
    }
}
