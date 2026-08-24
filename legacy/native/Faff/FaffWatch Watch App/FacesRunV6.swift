//
//  FacesRunV6.swift
//  FaffWatch
//
//  The running faces and structured-phase boards, on the native foundation.
//
//  These are small on purpose. `WorkoutPage` owns the shell and the insets,
//  `WorkoutMetricStack` owns sizing and rhythm, `WorkoutMetric` owns the
//  grade and the accessibility label. What is left here is the only thing
//  that is actually ours: WHICH numbers a board shows, in what order, and
//  which one the session is asking the runner to hold.
//
//  The V5 faces this replaces were three times the size and each did its own
//  layout, which is why no two of them agreed on where anything sat.
//
//  NAMED `...V6` while both generations are in the module. The first draft
//  reused the V5 names verbatim, which gave Swift two `RunFacePerformance`
//  types and silently bound the OLD file's previews to the NEW initialiser —
//  a compile error that read as if the old file were broken. The suffix goes
//  when the V5 faces do.
//
//  DESIGN RULES STILL IN FORCE (0821 handoff):
//    · colour grades, and only the one value the session asks you to hold
//    · a treadmill grades nothing — there is no trustworthy pace on a belt
//    · red names a SENSOR in words, never a figure
//    · four metrics maximum, one left edge
//    · no persistent labels
//    · no animation
//

import SwiftUI

// MARK: - Page 1 · the primary face

struct RunFaceV6: View {
    let pace: String
    var paceUnit: String = "/mi"
    let grade: MetricGrade
    let heartRate: String?
    let distance: String
    var distanceUnit: String = "mi"
    let elapsed: String

    var body: some View {
        WorkoutPage {
            if let heartRate {
                WorkoutMetricStack(metrics: [
                    WorkoutMetric(value: pace, unit: paceUnit, grade: grade, role: "Pace"),
                    WorkoutMetric(value: heartRate, unit: "bpm", role: "Heart rate"),
                    WorkoutMetric(value: distance, unit: distanceUnit, role: "Distance"),
                    WorkoutMetric(value: elapsed, role: "Elapsed"),
                ])
            } else {
                // RULE 2 · a sensor we could not read is NAMED, in words. The
                // other three slots are untouched, so the failure reads as one
                // slot rather than one screen — and a greyed last-known number
                // was explicitly rejected, because the runner cannot tell it
                // has stopped moving.
                VStack(alignment: .leading, spacing: 0) {
                    WorkoutMetricStack(metrics: [
                        WorkoutMetric(value: pace, unit: paceUnit, grade: grade, role: "Pace"),
                    ])
                    .frame(maxHeight: .infinity)

                    Text("No heart signal")
                        .font(.system(size: 17, weight: .semibold, design: .rounded))
                        .foregroundStyle(WatchV5.fault)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityLabel("Heart rate unavailable")

                    WorkoutMetricStack(metrics: [
                        WorkoutMetric(value: distance, unit: distanceUnit, role: "Distance"),
                        WorkoutMetric(value: elapsed, role: "Elapsed"),
                    ])
                    .frame(maxHeight: .infinity)
                }
            }
        }
    }
}

// MARK: - Page 2 · performance

struct PerfFaceV6: View {
    let cadence: String
    let averagePace: String
    var averagePaceUnit: String = "/mi"
    /// Absent values DROP OUT. The board becomes three metrics, or two. It
    /// never draws a placeholder — a dash in a slot is a claim that the slot
    /// is working.
    var power: String? = nil
    var elevation: String? = nil
    var elevationUnit: String = "ft"

    var body: some View {
        WorkoutPage {
            WorkoutMetricStack(metrics: metrics)
        }
    }

    private var metrics: [WorkoutMetric] {
        var m: [WorkoutMetric] = [
            WorkoutMetric(value: cadence, unit: "spm", role: "Cadence"),
            WorkoutMetric(value: averagePace, unit: averagePaceUnit, role: "Average pace"),
        ]
        if let power { m.append(WorkoutMetric(value: power, unit: "W", role: "Power")) }
        if let elevation { m.append(WorkoutMetric(value: elevation, unit: elevationUnit, role: "Elevation")) }
        return m
    }
}

// MARK: - Always-On

/// Wrist down. Three values, and NO ticking second — a second that the
/// display cannot redraw is a lie.
struct AlwaysOnFaceV6: View {
    let pace: String
    var paceUnit: String = "/mi"
    let grade: MetricGrade
    let distance: String
    var distanceUnit: String = "mi"
    let elapsedMinutes: String

    var body: some View {
        WorkoutPage {
            WorkoutMetricStack(metrics: [
                WorkoutMetric(value: pace, unit: paceUnit, grade: grade, role: "Pace"),
                WorkoutMetric(value: distance, unit: distanceUnit, role: "Distance"),
                WorkoutMetric(value: elapsedMinutes, unit: "min", role: "Elapsed"),
            ])
        }
    }
}

// MARK: - Structured phases

/// Every phase board is the same shape: the phase named once in the same slot,
/// then telemetry under it in page 1's order, so the muscle memory survives
/// the board swapping underneath the runner mid-session.
struct PhaseFaceV6: View {
    let phase: String
    /// "Rep 3 of 6", "1:12 left". Carries figures, so it is set in the
    /// telemetry register with tabular digits — a countdown in a proportional
    /// face shuffles sideways as it ticks.
    var detail: String? = nil
    let metrics: [WorkoutMetric]

    var body: some View {
        WorkoutPage {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline) {
                    Text(phase.uppercased())
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .tracking(1)
                        .foregroundStyle(.white.opacity(0.62))
                    if let detail {
                        Spacer(minLength: 6)
                        Text(detail)
                            .font(.system(size: 13, weight: .semibold, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(.white.opacity(0.62))
                    }
                }
                .accessibilityElement(children: .combine)
                .padding(.bottom, 2)

                WorkoutMetricStack(metrics: metrics)
            }
        }
    }
}

// MARK: - Previews

#Preview("Page 1 · on target") {
    RunFaceV6(pace: "7:38", grade: .onTarget, heartRate: "154",
            distance: "8.72", elapsed: "1:14:28")
}

#Preview("Page 1 · drifting") {
    RunFaceV6(pace: "10:59", grade: .drifting, heartRate: "199",
            distance: "26.22", elapsed: "3:48:21")
}

#Preview("Page 1 · no heart signal") {
    RunFaceV6(pace: "7:38", grade: .onTarget, heartRate: nil,
            distance: "8.72", elapsed: "1:14:28")
}

#Preview("Page 1 · treadmill, nothing grades") {
    RunFaceV6(pace: "8:00", grade: .neutral, heartRate: "142",
            distance: "3.10", elapsed: "24:48")
}

#Preview("Page 2 · full") {
    PerfFaceV6(cadence: "158", averagePace: "7:51",
                       power: "287", elevation: "+842")
}

#Preview("Page 2 · power and climb absent") {
    PerfFaceV6(cadence: "204", averagePace: "12:34")
}

#Preview("Work interval") {
    PhaseFaceV6(phase: "Work", detail: "3 of 6 · 1:12", metrics: [
        WorkoutMetric(value: "6:48", unit: "/mi", grade: .onTarget, role: "Pace"),
        WorkoutMetric(value: "168", unit: "bpm", role: "Heart rate"),
        WorkoutMetric(value: "0.42", unit: "mi", role: "Rep distance"),
    ])
}

#Preview("Recovery") {
    PhaseFaceV6(phase: "Recovery", detail: "1:12", metrics: [
        WorkoutMetric(value: "1:12", role: "Time left"),
        WorkoutMetric(value: "148", unit: "bpm", role: "Heart rate"),
    ])
}

#Preview("Always-On") {
    AlwaysOnFaceV6(pace: "7:42", grade: .onTarget, distance: "5.72", elapsedMinutes: "44")
}
