import Foundation

/// Swift mirror of `.runcino.json` schema v1.1.0 (see docs/SCHEMA.md).
///
/// The web app produces; iOS consumes. Codable maps 1:1 with the JSON.
struct RuncinoPlan: Codable, Equatable {
    let schemaVersion: String
    let generatedAt: String
    let generator: String

    let race: Race
    let goal: Goal
    let fitnessSummary: FitnessSummary
    let tolerance: Tolerance
    let phases: [Phase]
    let intervals: [Interval]
    let fueling: Fueling
    let brief: Brief?

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case generatedAt = "generated_at"
        case generator
        case race, goal
        case fitnessSummary = "fitness_summary"
        case tolerance, phases, intervals, fueling, brief
    }

    // MARK: - Race

    struct Race: Codable, Equatable {
        let name: String
        let date: String
        let distanceMi: Double
        let distanceM: Int
        let totalGainFt: Int
        let totalLossFt: Int

        enum CodingKeys: String, CodingKey {
            case name, date
            case distanceMi = "distance_mi"
            case distanceM = "distance_m"
            case totalGainFt = "total_gain_ft"
            case totalLossFt = "total_loss_ft"
        }
    }

    // MARK: - Goal

    struct Goal: Codable, Equatable {
        let finishTimeS: Int
        let finishTimeDisplay: String
        let strategy: String
        let flatPaceSPerMi: Int
        let warmup: Warmup
        let claudeRationale: String?

        enum CodingKeys: String, CodingKey {
            case finishTimeS = "finish_time_s"
            case finishTimeDisplay = "finish_time_display"
            case strategy
            case flatPaceSPerMi = "flat_pace_s_per_mi"
            case warmup
            case claudeRationale = "claude_rationale"
        }

        struct Warmup: Codable, Equatable {
            let enabled: Bool
            let distanceMi: Double
            let paceSPerMi: Int?

            enum CodingKeys: String, CodingKey {
                case enabled
                case distanceMi = "distance_mi"
                case paceSPerMi = "pace_s_per_mi"
            }
        }
    }

    // MARK: - Fitness

    struct FitnessSummary: Codable, Equatable {
        let baselineRace: BaselineRace?
        let weeklyMileage: Int?
        let weeklyMileageTrend6Wk: Int?
        let longestRecentLongRunMi: Double?
        let longestRecentLongRunAgeWk: Int?
        let restingHrBpm: Int?
        let restingHrTrend8Wk: Int?
        let age: Int?
        let weightLb: Double?
        let source: String

        enum CodingKeys: String, CodingKey {
            case baselineRace = "baseline_race"
            case weeklyMileage = "weekly_mileage"
            case weeklyMileageTrend6Wk = "weekly_mileage_trend_6wk"
            case longestRecentLongRunMi = "longest_recent_long_run_mi"
            case longestRecentLongRunAgeWk = "longest_recent_long_run_age_wk"
            case restingHrBpm = "resting_hr_bpm"
            case restingHrTrend8Wk = "resting_hr_trend_8wk"
            case age
            case weightLb = "weight_lb"
            case source
        }

        struct BaselineRace: Codable, Equatable {
            let name: String
            let finishS: Int
            let monthsAgo: Int

            enum CodingKeys: String, CodingKey {
                case name
                case finishS = "finish_s"
                case monthsAgo = "months_ago"
            }
        }
    }

    // MARK: - Tolerance

    struct Tolerance: Codable, Equatable {
        let paceSPerMi: Int

        enum CodingKeys: String, CodingKey {
            case paceSPerMi = "pace_s_per_mi"
        }
    }

    // MARK: - Phase (human-readable)

    struct Phase: Codable, Equatable, Identifiable {
        let index: Int
        let label: String
        let startMi: Double
        let endMi: Double
        let distanceMi: Double
        let targetPaceSPerMi: Int
        let targetPaceDisplay: String
        let meanGradePct: Double
        let elevationGainFt: Int
        let elevationLossFt: Int
        let cumulativeTimeS: Int
        let cumulativeTimeDisplay: String
        let note: String

        var id: Int { index }

        enum CodingKeys: String, CodingKey {
            case index, label
            case startMi = "start_mi"
            case endMi = "end_mi"
            case distanceMi = "distance_mi"
            case targetPaceSPerMi = "target_pace_s_per_mi"
            case targetPaceDisplay = "target_pace_display"
            case meanGradePct = "mean_grade_pct"
            case elevationGainFt = "elevation_gain_ft"
            case elevationLossFt = "elevation_loss_ft"
            case cumulativeTimeS = "cumulative_time_s"
            case cumulativeTimeDisplay = "cumulative_time_display"
            case note
        }
    }

    // MARK: - Interval (machine-readable, feeds WorkoutKit)

    enum Interval: Codable, Equatable, Identifiable {
        case pace(PaceInterval)
        case fuel(FuelInterval)
        case landmark(LandmarkInterval)

        var id: Int { index }
        var index: Int {
            switch self {
            case .pace(let p): return p.index
            case .fuel(let f): return f.index
            case .landmark(let l): return l.index
            }
        }
        var atMi: Double {
            switch self {
            case .pace(let p): return p.atMi
            case .fuel(let f): return f.atMi
            case .landmark(let l): return l.atMi
            }
        }
        var label: String {
            switch self {
            case .pace(let p): return p.label
            case .fuel(let f): return f.label
            case .landmark(let l): return l.label
            }
        }

        // Polymorphic decode by discriminator `kind`
        enum CodingKeys: String, CodingKey { case kind }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            let kind = try c.decode(String.self, forKey: .kind)
            switch kind {
            case "pace":
                self = .pace(try PaceInterval(from: decoder))
            case "fuel":
                self = .fuel(try FuelInterval(from: decoder))
            case "landmark":
                self = .landmark(try LandmarkInterval(from: decoder))
            default:
                throw DecodingError.dataCorruptedError(
                    forKey: .kind, in: c, debugDescription: "Unknown interval kind: \(kind)"
                )
            }
        }
        func encode(to encoder: Encoder) throws {
            switch self {
            case .pace(let p): try p.encode(to: encoder)
            case .fuel(let f): try f.encode(to: encoder)
            case .landmark(let l): try l.encode(to: encoder)
            }
        }
    }

    struct PaceInterval: Codable, Equatable {
        let index: Int
        let phaseIdx: Int
        let kind: String
        let atMi: Double
        let distanceMi: Double
        let targetPaceSPerMi: Int
        let toleranceSPerMi: Int
        let label: String

        enum CodingKeys: String, CodingKey {
            case index
            case phaseIdx = "phase_idx"
            case kind
            case atMi = "at_mi"
            case distanceMi = "distance_mi"
            case targetPaceSPerMi = "target_pace_s_per_mi"
            case toleranceSPerMi = "tolerance_s_per_mi"
            case label
        }
    }

    struct FuelInterval: Codable, Equatable {
        let index: Int
        let phaseIdx: Int
        let kind: String
        let atMi: Double
        let durationS: Int
        let item: String
        let gelNumber: Int
        let label: String

        enum CodingKeys: String, CodingKey {
            case index
            case phaseIdx = "phase_idx"
            case kind
            case atMi = "at_mi"
            case durationS = "duration_s"
            case item
            case gelNumber = "gel_number"
            case label
        }
    }

    struct LandmarkInterval: Codable, Equatable {
        let index: Int
        let phaseIdx: Int
        let kind: String
        let atMi: Double
        let durationS: Int
        let label: String

        enum CodingKeys: String, CodingKey {
            case index
            case phaseIdx = "phase_idx"
            case kind
            case atMi = "at_mi"
            case durationS = "duration_s"
            case label
        }
    }

    // MARK: - Fueling summary

    struct Fueling: Codable, Equatable {
        let carbTargetGPerHr: Int
        let totalCarbsG: Int
        let gelCount: Int
        let gelCarbsG: Int
        let gelBrand: String
        let notes: String

        enum CodingKeys: String, CodingKey {
            case carbTargetGPerHr = "carb_target_g_per_hr"
            case totalCarbsG = "total_carbs_g"
            case gelCount = "gel_count"
            case gelCarbsG = "gel_carbs_g"
            case gelBrand = "gel_brand"
            case notes
        }
    }

    // MARK: - Brief

    struct Brief: Codable, Equatable {
        let generatedAt: String
        let weatherInput: String
        let narrative: String
        let planAdjustments: [Adjustment]

        enum CodingKeys: String, CodingKey {
            case generatedAt = "generated_at"
            case weatherInput = "weather_input"
            case narrative
            case planAdjustments = "plan_adjustments"
        }

        struct Adjustment: Codable, Equatable, Identifiable {
            let phaseIdx: Int
            let paceDeltaSPerMi: Int
            let reason: String

            var id: Int { phaseIdx }

            enum CodingKeys: String, CodingKey {
                case phaseIdx = "phase_idx"
                case paceDeltaSPerMi = "pace_delta_s_per_mi"
                case reason
            }
        }
    }

    // MARK: - Validation

    enum ValidationError: Error, LocalizedError {
        case unsupportedSchema(String)
        case emptyPhases
        case nonContiguousPhases
        case paceOutOfBounds(Int)
        case timeDriftTooLarge(Int)

        var errorDescription: String? {
            switch self {
            case .unsupportedSchema(let v): return "Unsupported schema version: \(v)"
            case .emptyPhases: return "Plan has no phases"
            case .nonContiguousPhases: return "Phases are non-contiguous"
            case .paceOutOfBounds(let p): return "Pace \(p) s/mi is out of bounds [240, 900]"
            case .timeDriftTooLarge(let d): return "Plan time disagrees with goal by \(d) s"
            }
        }
    }

    static func validate(_ plan: RuncinoPlan) throws {
        guard plan.schemaVersion.hasPrefix("1.") else {
            throw ValidationError.unsupportedSchema(plan.schemaVersion)
        }
        guard !plan.phases.isEmpty else { throw ValidationError.emptyPhases }
        for i in 1 ..< plan.phases.count {
            let gap = abs(plan.phases[i].startMi - plan.phases[i - 1].endMi)
            if gap > 0.01 { throw ValidationError.nonContiguousPhases }
        }
        for p in plan.phases {
            if p.targetPaceSPerMi < 240 || p.targetPaceSPerMi > 900 {
                throw ValidationError.paceOutOfBounds(p.targetPaceSPerMi)
            }
        }
        let planTime = plan.phases.reduce(0) { acc, p in
            acc + Int(Double(p.targetPaceSPerMi) * p.distanceMi)
        }
        let drift = abs(planTime - plan.goal.finishTimeS)
        if drift > 30 { throw ValidationError.timeDriftTooLarge(drift) }
    }
}
