//
//  WatchWorkoutModels.swift
//  FaffWatch
//
//  Data shapes for the watch app.  The INCOMING workout mirrors the
//  backend GET /api/watch/today payload (and the iPhone target's
//  Faff/API.swift WatchWorkout) — duplicated here per
//  docs/native/03-watchos-target-setup.md ("v0 duplication is fine;
//  consolidate later" once a shared module exists).
//
//  The OUTGOING completion mirrors the backend POST
//  /api/watch/workouts/complete body (web/lib/watch-completion.ts), so
//  when WatchConnectivity + HealthKit writeback land (phases 4-6) the
//  engine's result can be sent straight up with no reshaping.
//
//  This is the UI-shell phase (scoping step 3): timer-driven, no
//  HKWorkoutSession yet, so live pace/HR fields are nil here.
//

import Foundation

// MARK: - Incoming · today's prescribed workout

enum WatchPhaseType: String, Codable {
    case warmup, work, recovery, cooldown
}

enum WatchHaptic: String, Codable {
    case start
    case transitionWork = "transition-work"
    case transitionRecovery = "transition-recovery"
    case transitionCooldown = "transition-cooldown"
    case end
}

/// How a rep is measured — a time interval ("7 min") or a fixed distance
/// ("800 m" / "1 mi"). Drives whether the engine advances/counts down by
/// elapsed time or by GPS distance, and how the remaining value reads.
enum WatchRepUnit: String, Codable {
    case time, distance
}

struct WatchPhase: Codable, Identifiable {
    /// Stable identity for SwiftUI lists · the cursor index assigned at
    /// decode time (the backend payload has no per-phase id).
    var id: Int { index }
    let index: Int
    let type: WatchPhaseType
    let label: String
    let durationSec: Int
    let targetPaceSPerMi: Int?
    let tolerancePaceSPerMi: Int?
    let haptic: WatchHaptic
    /// How this rep is measured. Defaults to `.time` so older payloads
    /// (and every non-rep phase) behave exactly as before.
    let repUnit: WatchRepUnit
    /// Fixed rep distance in miles · set only on distance reps. (durationSec
    /// is still carried as a time ESTIMATE for distance reps — used for the
    /// total-time estimate and as a fallback.)
    let distanceMi: Double?

    /// The backend payload omits `index` (the phases array is ordered
    /// and the watch walks it with a cursor).  We assign it during
    /// decode via WatchWorkout's custom init so each phase carries its
    /// own position for labels + completion reporting.
    init(index: Int, type: WatchPhaseType, label: String, durationSec: Int,
         targetPaceSPerMi: Int?, tolerancePaceSPerMi: Int?, haptic: WatchHaptic,
         repUnit: WatchRepUnit = .time, distanceMi: Double? = nil) {
        self.index = index
        self.type = type
        self.label = label
        self.durationSec = durationSec
        self.targetPaceSPerMi = targetPaceSPerMi
        self.tolerancePaceSPerMi = tolerancePaceSPerMi
        self.haptic = haptic
        self.repUnit = repUnit
        self.distanceMi = distanceMi
    }

    private enum CodingKeys: String, CodingKey {
        case type, label, durationSec, targetPaceSPerMi, tolerancePaceSPerMi, haptic, repUnit, distanceMi
    }

    /// Decoding without an index — used only when a phase is decoded in
    /// isolation.  WatchWorkout normally re-stamps indices on decode.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.index = 0
        self.type = try c.decode(WatchPhaseType.self, forKey: .type)
        self.label = try c.decode(String.self, forKey: .label)
        self.durationSec = try c.decode(Int.self, forKey: .durationSec)
        self.targetPaceSPerMi = try c.decodeIfPresent(Int.self, forKey: .targetPaceSPerMi)
        self.tolerancePaceSPerMi = try c.decodeIfPresent(Int.self, forKey: .tolerancePaceSPerMi)
        self.haptic = try c.decode(WatchHaptic.self, forKey: .haptic)
        self.repUnit = try c.decodeIfPresent(WatchRepUnit.self, forKey: .repUnit) ?? .time
        self.distanceMi = try c.decodeIfPresent(Double.self, forKey: .distanceMi)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(type, forKey: .type)
        try c.encode(label, forKey: .label)
        try c.encode(durationSec, forKey: .durationSec)
        try c.encodeIfPresent(targetPaceSPerMi, forKey: .targetPaceSPerMi)
        try c.encodeIfPresent(tolerancePaceSPerMi, forKey: .tolerancePaceSPerMi)
        try c.encode(haptic, forKey: .haptic)
        try c.encode(repUnit, forKey: .repUnit)
        try c.encodeIfPresent(distanceMi, forKey: .distanceMi)
    }
}

struct WatchWorkout: Codable {
    let workoutId: String
    let name: String
    let summary: String
    let totalEstimatedMinutes: Int
    let phases: [WatchPhase]
    let completionEndpoint: String
    let expiresAt: String
    // Home-screen glance fields (watch-app.html §A). Optional so an older
    // payload still decodes; the phone bridge fills them from the plan +
    // readiness read.
    let readinessScore: Int?
    let readinessLabel: String?     // "Primed" / "Hold easy" / "Back off"
    let distanceMi: Double?
    let paceLabel: String?          // training-zone tag, e.g. "T", "I", "E"
    // Race day (watch-app.html §F). isRace flips the faces to the race
    // layout (proj finish / to-go / gel cues) fed by these fields.
    let isRace: Bool
    let goalSec: Int?               // goal finish time
    let strategyLabel: String?      // "Even effort · 8:46 flat"
    let gelsMi: [Double]?           // gel marker mile points

    private enum CodingKeys: String, CodingKey {
        case workoutId, name, summary, totalEstimatedMinutes, phases, completionEndpoint, expiresAt
        case readinessScore, readinessLabel, distanceMi, paceLabel
        case isRace, goalSec, strategyLabel, gelsMi
    }

    init(workoutId: String, name: String, summary: String, totalEstimatedMinutes: Int,
         phases: [WatchPhase], completionEndpoint: String, expiresAt: String,
         readinessScore: Int? = nil, readinessLabel: String? = nil,
         distanceMi: Double? = nil, paceLabel: String? = nil,
         isRace: Bool = false, goalSec: Int? = nil, strategyLabel: String? = nil, gelsMi: [Double]? = nil) {
        self.workoutId = workoutId
        self.name = name
        self.summary = summary
        self.totalEstimatedMinutes = totalEstimatedMinutes
        self.phases = phases
        self.completionEndpoint = completionEndpoint
        self.expiresAt = expiresAt
        self.readinessScore = readinessScore
        self.readinessLabel = readinessLabel
        self.distanceMi = distanceMi
        self.paceLabel = paceLabel
        self.isRace = isRace
        self.goalSec = goalSec
        self.strategyLabel = strategyLabel
        self.gelsMi = gelsMi
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.workoutId = try c.decode(String.self, forKey: .workoutId)
        self.name = try c.decode(String.self, forKey: .name)
        self.summary = try c.decode(String.self, forKey: .summary)
        self.totalEstimatedMinutes = try c.decode(Int.self, forKey: .totalEstimatedMinutes)
        self.completionEndpoint = try c.decode(String.self, forKey: .completionEndpoint)
        self.expiresAt = try c.decode(String.self, forKey: .expiresAt)
        self.readinessScore = try c.decodeIfPresent(Int.self, forKey: .readinessScore)
        self.readinessLabel = try c.decodeIfPresent(String.self, forKey: .readinessLabel)
        self.distanceMi = try c.decodeIfPresent(Double.self, forKey: .distanceMi)
        self.paceLabel = try c.decodeIfPresent(String.self, forKey: .paceLabel)
        self.isRace = try c.decodeIfPresent(Bool.self, forKey: .isRace) ?? false
        self.goalSec = try c.decodeIfPresent(Int.self, forKey: .goalSec)
        self.strategyLabel = try c.decodeIfPresent(String.self, forKey: .strategyLabel)
        self.gelsMi = try c.decodeIfPresent([Double].self, forKey: .gelsMi)
        // Re-stamp each phase with its cursor index.
        let raw = try c.decode([WatchPhase].self, forKey: .phases)
        self.phases = raw.enumerated().map { (i, p) in
            WatchPhase(index: i, type: p.type, label: p.label, durationSec: p.durationSec,
                       targetPaceSPerMi: p.targetPaceSPerMi,
                       tolerancePaceSPerMi: p.tolerancePaceSPerMi, haptic: p.haptic)
        }
    }
}

// MARK: - Outgoing · completion writeback (phase 6)

struct WatchCompletionPhase: Encodable {
    let index: Int
    let type: String
    let label: String
    let targetPaceSPerMi: Int?
    let actualPaceSPerMi: Int?
    let actualDurationSec: Int
    let avgHr: Int?
    let completed: Bool
}

struct WatchCompletion: Encodable {
    let workoutId: String
    let startedAt: String
    let completedAt: String
    let status: String          // "completed" | "partial" | "abandoned"
    let totalDistanceMi: Double?
    let totalDurationSec: Int
    let avgHr: Int?
    let maxHr: Int?
    var avgCadence: Int? = nil
    let phases: [WatchCompletionPhase]
}

// MARK: - Sample · drives the simulator UI flow before WCSession exists

extension WatchWorkout {
    /// A hardcoded threshold session so the shell can be exercised in
    /// the simulator without a paired iPhone (WatchConnectivity lands
    /// in a later phase).  Mirrors the "Threshold · Cruise Intervals"
    /// catalog entry in web/lib/watch-workout.ts.
    static var sample: WatchWorkout {
        var phases: [WatchPhase] = []
        var idx = 0
        func add(_ type: WatchPhaseType, _ label: String, _ sec: Int,
                 target: Int?, tol: Int?, haptic: WatchHaptic) {
            phases.append(WatchPhase(index: idx, type: type, label: label, durationSec: sec,
                                     targetPaceSPerMi: target, tolerancePaceSPerMi: tol, haptic: haptic))
            idx += 1
        }
        add(.warmup, "Warmup", 600, target: nil, tol: nil, haptic: .start)
        for rep in 1...5 {
            add(.work, "Interval \(rep)/5", 420, target: 391, tol: 10, haptic: .transitionWork)
            if rep < 5 {
                add(.recovery, "Recovery \(rep)/5", 90, target: nil, tol: nil, haptic: .transitionRecovery)
            }
        }
        add(.cooldown, "Cooldown", 600, target: nil, tol: nil, haptic: .transitionCooldown)
        let total = phases.reduce(0) { $0 + $1.durationSec }
        return WatchWorkout(
            workoutId: "sample-threshold",
            name: "5×7",
            summary: "5×7 min @ 6:31 · 90s rec",
            totalEstimatedMinutes: total / 60,
            phases: phases,
            completionEndpoint: "/api/watch/workouts/complete",
            expiresAt: "2026-05-21T08:00:00Z",
            readinessScore: 82,
            readinessLabel: "Primed",
            distanceMi: 6.4,
            paceLabel: "T"
        )
    }

    /// A point-to-point race fed to the same engine (watch-app.html §F):
    /// a flat list of terrain-aware course phases, each with its own even-
    /// effort target pace, plus gel markers. Drives the race faces in the
    /// simulator (launch with -race) before phone race sync exists.
    static var sampleRace: WatchWorkout {
        var phases: [WatchPhase] = []
        var idx = 0
        func add(_ label: String, _ sec: Int, target: Int, tol: Int = 12) {
            phases.append(WatchPhase(index: idx, type: .work, label: label, durationSec: sec,
                                     targetPaceSPerMi: target, tolerancePaceSPerMi: tol,
                                     haptic: .transitionWork))
            idx += 1
        }
        // Big Sur-shaped: rolling start, the Hurricane Point climb (slow
        // target), the descent (fast), then the long run-in. Targets are
        // even EFFORT, so pace shifts with terrain.
        add("Opening rollers", 1500, target: 526)   // 8:46
        add("Bixby descent",   900,  target: 502)    // 8:22
        add("Hurricane climb", 1140, target: 638)    // 10:38
        add("Point descent",   720,  target: 514)    // 8:34
        add("Coast miles",     3120, target: 532)    // 8:52
        add("Carmel run-in",   1500, target: 520)    // 8:40
        let total = phases.reduce(0) { $0 + $1.durationSec }
        return WatchWorkout(
            workoutId: "sample-bigsur",
            name: "Big Sur",
            summary: "Even effort · 8:46 flat",
            totalEstimatedMinutes: total / 60,
            phases: phases,
            completionEndpoint: "/api/watch/workouts/complete",
            expiresAt: "2026-05-21T08:00:00Z",
            readinessScore: 88,
            readinessLabel: "Race ready",
            distanceMi: 26.2,
            paceLabel: "Goal",
            isRace: true,
            goalSec: 13_800,            // 3:50:00
            strategyLabel: "Even effort · 8:46 flat",
            gelsMi: [4, 8, 12, 16, 20, 23]
        )
    }
}

// MARK: - Pace formatting helpers

enum PaceFormat {
    /// "6:31" from 391 s/mi.
    static func mmss(_ secondsPerMile: Int) -> String {
        let m = secondsPerMile / 60
        let s = secondsPerMile % 60
        return "\(m):\(String(format: "%02d", s))"
    }

    /// "2:15" from 135 seconds (durations / elapsed clocks).
    static func clock(_ seconds: Int) -> String {
        let m = seconds / 60
        let s = seconds % 60
        return "\(m):\(String(format: "%02d", s))"
    }

    /// "1:34:20" / "3:50" — h:mm:ss for race-length clocks, m:ss under an hour.
    static func hms(_ seconds: Int) -> String {
        let h = seconds / 3600
        let m = (seconds % 3600) / 60
        let s = seconds % 60
        if h > 0 { return "\(h):\(String(format: "%02d", m)):\(String(format: "%02d", s))" }
        return "\(m):\(String(format: "%02d", s))"
    }

    /// "3:50" — hours:minutes, for goal/projection at race scale.
    static func hm(_ seconds: Int) -> String {
        let h = seconds / 3600
        let m = (seconds % 3600) / 60
        return "\(h):\(String(format: "%02d", m))"
    }
}
