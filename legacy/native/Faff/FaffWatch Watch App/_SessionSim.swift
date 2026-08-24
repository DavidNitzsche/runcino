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
import SwiftUI

enum SessionSim {
    static var request: (archetype: String, at: Int)? {
        let a = ProcessInfo.processInfo.arguments
        guard let i = a.firstIndex(of: "-sim"), i + 1 < a.count else { return nil }
        let at = a.firstIndex(of: "-at").flatMap { $0 + 1 < a.count ? Int(a[$0 + 1]) : nil } ?? 0
        return (a[i + 1], at)
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
                                units: String? = nil) -> WatchWorkout {
        WatchWorkout(workoutId: id, name: name, summary: name,
                     totalEstimatedMinutes: phases.reduce(0) { $0 + $1.durationSec } / 60,
                     phases: phases,
                     completionEndpoint: "/api/watch/workouts/complete",
                     expiresAt: "2099-12-31T00:00:00Z",
                     distanceMi: distanceMi,
                     isRace: isRace, goalSec: goalSec, gelsMi: gelsMi,
                     unitsDistance: units)
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
                engine.start()
            }
    }
}
