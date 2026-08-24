//
//  _FacePreview.swift
//  FaffWatch
//
//  TEMPORARY review harness. `-face <name>` renders one board with fixed
//  fixtures so a screenshot is deterministic and free of engine state.
//
//  REMOVE BEFORE SHIP, together with its mount in WorkoutRootView.
//
//  A WARNING THIS FILE EARNED. The harness used to pass a band to the phase
//  boards that the router never passed, so every board reviewed on screen had
//  a gauge under the pace and every board a runner would see had none. The
//  screenshots were accurate about a screen that did not exist.
//
//  So the rule for anything added here: a fixture may only supply what the
//  router supplies. If a board needs a value to look right, the router is
//  where that value has to come from, and this file follows it.
//
//  Fixtures are deliberately UGLY. Round numbers hide width bugs — the size
//  collapse survived a twelve-cell matrix because every cell in it was short.
//  So: 10:59, 1:11:48, 5:59:59, 100.0, 204, 12:34.
//
import SwiftUI

enum FacePreview {
    static var selected: String? {
        let a = ProcessInfo.processInfo.arguments
        guard let i = a.firstIndex(of: "-face"), i + 1 < a.count else { return nil }
        return a[i + 1]
    }
}

/// Bands as the router computes them: `band(for:)` maps the prescribed window
/// onto the middle 40% of the strip, so a target of 6:20-6:45 with the runner
/// at 6:31 lands the mark just left of centre inside the lit segment.
private let inBand  = (start: 0.30, end: 0.70, marker: 0.44, inBand: true)
private let offBand = (start: 0.30, end: 0.70, marker: 0.86, inBand: false)

struct FacePreviewView: View {
    let name: String

    var body: some View {
        switch name {

        // MARK: Page 1

        case "p1":
            RunFaceV6(pace: "7:38", grade: .onTarget, band: inBand,
                      heartRate: "154", distance: "8.72", elapsed: "1:14:28")
        case "p1drift":
            RunFaceV6(pace: "8:24", grade: .drifting, band: offBand,
                      heartRate: "171", distance: "12.06", elapsed: "1:41:53")
        case "p1nohr":
            RunFaceV6(pace: "7:38", grade: .onTarget, band: inBand,
                      heartRate: nil, distance: "8.72", elapsed: "1:14:28")
        case "p1tread":
            // A belt grades nothing and gets no gauge: there is no trustworthy
            // pace to put a mark on. White throughout, by rule.
            RunFaceV6(pace: "8:00", grade: .neutral,
                      heartRate: "142", distance: "3.10", elapsed: "24:48")
        case "p1free":
            // A steady run with no prescribed band. Pace is measured, not
            // graded, so it is white and there is no strip.
            RunFaceV6(pace: "8:57", grade: .neutral,
                      heartRate: "139", distance: "6.21", elapsed: "55:36")
        case "p1ugly":
            // Worst case in every slot at once.
            RunFaceV6(pace: "10:59", grade: .drifting, band: offBand,
                      heartRate: "204", distance: "100.0", elapsed: "5:59:59")

        // MARK: Page 2

        case "p2":
            PerfFaceV6(cadence: "158", averagePace: "7:51",
                       power: "287", elevation: "+842")
        case "p2min":
            // Power and climb absent. The board becomes two metrics; it never
            // draws a dash, because a dash claims the slot is working.
            PerfFaceV6(cadence: "204", averagePace: "12:34")
        case "p2tread":
            PerfFaceV6(cadence: "176", averagePace: "9:14")

        // MARK: Always-On

        case "alwayson":
            AlwaysOnFaceV6(pace: "7:42", grade: .onTarget,
                           distance: "5.72", elapsedMinutes: "44")

        // MARK: Structured phases

        case "warmup":
            PhaseFaceV6(phase: "Warm-up", metrics: [
                WorkoutMetric(value: "4:12", role: "Time left"),
                WorkoutMetric(value: "9:31", unit: "/mi", role: "Pace"),
                WorkoutMetric(value: "128", unit: "bpm", role: "Heart rate"),
                WorkoutMetric(value: "1.06", unit: "mi", role: "Distance"),
            ])
        case "work":
            PhaseFaceV6(phase: "Work", context: "3 of 6",
                        band: offBand, bandRow: 1, metrics: [
                WorkoutMetric(value: "1:12", role: "Time left in rep"),
                WorkoutMetric(value: "6:48", unit: "/mi", grade: .drifting, role: "Pace"),
                WorkoutMetric(value: "168", unit: "bpm", role: "Heart rate"),
                WorkoutMetric(value: "0.42", unit: "mi", role: "Rep distance"),
            ])
        case "recovery":
            // Two metrics, no pace, no band. A recovery is not asking for a
            // pace and drawing one invites the runner to race it.
            PhaseFaceV6(phase: "Recovery", context: "3 of 6", metrics: [
                WorkoutMetric(value: "1:12", role: "Time left"),
                WorkoutMetric(value: "148", unit: "bpm", role: "Heart rate"),
            ])
        case "strides":
            // Cadence, not pace: over twenty seconds a GPS pace is mostly lag.
            PhaseFaceV6(phase: "Strides", context: "4 of 8", metrics: [
                WorkoutMetric(value: "0:14", role: "Time left in stride"),
                WorkoutMetric(value: "191", unit: "spm", role: "Cadence"),
                WorkoutMetric(value: "162", unit: "bpm", role: "Heart rate"),
            ])
        case "threshold":
            PhaseFaceV6(phase: "Threshold", context: "2 of 4",
                        band: inBand, bandRow: 1, metrics: [
                WorkoutMetric(value: "5:30", role: "Time left in rep"),
                WorkoutMetric(value: "6:31", unit: "/mi", grade: .onTarget, role: "Pace"),
                WorkoutMetric(value: "6:34", unit: "avg", role: "Average pace"),
                WorkoutMetric(value: "172", unit: "bpm", role: "Heart rate"),
            ])
        case "race":
            // The graded metric is row 0 here, not row 1 — which is why the
            // router derives the band row instead of hardcoding it.
            PhaseFaceV6(phase: "Mile 9", context: "sub 3:30",
                        band: inBand, bandRow: 0, metrics: [
                WorkoutMetric(value: "7:52", unit: "/mi", grade: .onTarget, role: "Pace"),
                WorkoutMetric(value: "−0:22", role: "Against goal"),
                WorkoutMetric(value: "9.14", unit: "mi", role: "Distance"),
                WorkoutMetric(value: "1:11:48", role: "Elapsed"),
            ])
        case "raceugly":
            PhaseFaceV6(phase: "Mile 26", context: "sub 3:30",
                        band: offBand, bandRow: 0, metrics: [
                WorkoutMetric(value: "10:59", unit: "/mi", grade: .drifting, role: "Pace"),
                WorkoutMetric(value: "+12:47", role: "Against goal"),
                WorkoutMetric(value: "26.22", unit: "mi", role: "Distance"),
                WorkoutMetric(value: "4:38:02", role: "Elapsed"),
            ])

        // MARK: The metric-count matrix
        //
        // Task 2 of the foundation brief: one to four metrics on the final
        // shell, at ugly widths, so the sizing rule is checked at every count
        // rather than at the one a board happens to use.

        case "m1":
            WorkoutPage { WorkoutMetricStack(metrics: [
                WorkoutMetric(value: "10:59", unit: "/mi", grade: .onTarget, role: "Pace"),
            ]) }
        case "m2":
            WorkoutPage { WorkoutMetricStack(metrics: [
                WorkoutMetric(value: "1:11:48", role: "Elapsed"),
                WorkoutMetric(value: "204", unit: "bpm", role: "Heart rate"),
            ]) }
        case "m3":
            WorkoutPage { WorkoutMetricStack(metrics: [
                WorkoutMetric(value: "10:59", unit: "/mi", grade: .drifting, role: "Pace"),
                WorkoutMetric(value: "100.0", unit: "mi", role: "Distance"),
                WorkoutMetric(value: "5:59:59", role: "Elapsed"),
            ]) }
        case "m4":
            WorkoutPage { WorkoutMetricStack(metrics: [
                WorkoutMetric(value: "10:59", unit: "/mi", grade: .drifting, role: "Pace"),
                WorkoutMetric(value: "204", unit: "bpm", role: "Heart rate"),
                WorkoutMetric(value: "100.0", unit: "mi", role: "Distance"),
                WorkoutMetric(value: "5:59:59", role: "Elapsed"),
            ]) }
        case "m4band":
            WorkoutPage { WorkoutMetricStack(band: offBand, bandRow: 0, metrics: [
                WorkoutMetric(value: "10:59", unit: "/mi", grade: .drifting, role: "Pace"),
                WorkoutMetric(value: "204", unit: "bpm", role: "Heart rate"),
                WorkoutMetric(value: "100.0", unit: "mi", role: "Distance"),
                WorkoutMetric(value: "5:59:59", role: "Elapsed"),
            ]) }

        default:
            Color.black
        }
    }
}
