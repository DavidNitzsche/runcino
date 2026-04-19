import Foundation
import WorkoutKit
import HealthKit

/// Turns a RuncinoPlan into a WorkoutKit CustomWorkout ready to be
/// previewed to the user and scheduled to their Apple Watch.
///
/// Each interval maps as follows:
///   • pace     → IntervalStep(.work, goal: .distance(mi), alert: .pace(target, tolerance))
///   • fuel     → IntervalStep(.work, goal: .time(durationS, .seconds))
///                 with a haptic at start (WorkoutKit fires one automatically at step boundaries)
///   • landmark → same as fuel but shorter (10s)
///
/// The Watch's native Fitness/Workout UI renders this as a guided
/// workout. No custom watchOS code required.
enum WorkoutBuilder {
    enum BuildError: Error, LocalizedError {
        case emptyIntervals
        case invalidPace(Int)
        var errorDescription: String? {
            switch self {
            case .emptyIntervals: return "Plan has no intervals to schedule."
            case .invalidPace(let p): return "Pace \(p) s/mi is out of bounds."
            }
        }
    }

    static func build(from plan: RuncinoPlan) throws -> CustomWorkout {
        guard !plan.intervals.isEmpty else { throw BuildError.emptyIntervals }

        var steps: [IntervalStep] = []
        steps.reserveCapacity(plan.intervals.count)

        for interval in plan.intervals {
            switch interval {
            case .pace(let p):
                steps.append(try paceStep(p))
            case .fuel(let f):
                steps.append(fuelStep(f))
            case .landmark(let l):
                steps.append(landmarkStep(l))
            }
        }

        let block = IntervalBlock(steps: steps, iterations: 1)

        return try CustomWorkout(
            activity: .running,
            location: .outdoor,
            displayName: "\(plan.race.name) · \(plan.goal.finishTimeDisplay)",
            warmup: nil,
            blocks: [block],
            cooldown: nil
        )
    }

    // MARK: - Step factories

    private static func paceStep(_ p: RuncinoPlan.PaceInterval) throws -> IntervalStep {
        guard p.targetPaceSPerMi >= 240, p.targetPaceSPerMi <= 900 else {
            throw BuildError.invalidPace(p.targetPaceSPerMi)
        }

        // Target pace as meters per second (WorkoutKit uses UnitSpeed)
        let targetMetersPerSec = metersPerMile / Double(p.targetPaceSPerMi)
        let lowerBoundMetersPerSec = metersPerMile / Double(p.targetPaceSPerMi + p.toleranceSPerMi)
        let upperBoundMetersPerSec = metersPerMile / Double(max(p.targetPaceSPerMi - p.toleranceSPerMi, 1))

        let target = Measurement<UnitSpeed>(value: targetMetersPerSec, unit: .metersPerSecond)
        let lower  = Measurement<UnitSpeed>(value: lowerBoundMetersPerSec, unit: .metersPerSecond)
        let upper  = Measurement<UnitSpeed>(value: upperBoundMetersPerSec, unit: .metersPerSecond)

        let alert = SpeedRangeAlert(target: target, lowerBound: lower, upperBound: upper, metric: .current)

        return IntervalStep(
            .work,
            goal: .distance(p.distanceMi, .miles),
            alert: alert
        )
    }

    private static func fuelStep(_ f: RuncinoPlan.FuelInterval) -> IntervalStep {
        IntervalStep(
            .work,
            goal: .time(Double(f.durationS), .seconds),
            alert: nil
        )
    }

    private static func landmarkStep(_ l: RuncinoPlan.LandmarkInterval) -> IntervalStep {
        IntervalStep(
            .work,
            goal: .time(Double(l.durationS), .seconds),
            alert: nil
        )
    }

    private static let metersPerMile: Double = 1609.344
}
