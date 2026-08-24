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
    /// The prescribed band under the pace, when the session prescribes one.
    ///
    /// This was missing from the whole V6 generation and the omission was
    /// invisible, because the preview harness passed a band that the router
    /// never did — so every board reviewed on screen had a gauge and every
    /// board a runner would actually see had none. A graded number with no
    /// band says "you are wrong" and refuses to say what right was.
    var band: (start: Double, end: Double, marker: Double, inBand: Bool)? = nil
    let heartRate: String?
    let distance: String
    var distanceUnit: String = "mi"
    let elapsed: String

    var body: some View {
        WorkoutPage {
            // ONE STACK, ALWAYS. Four rows whether or not the strap is
            // reading, so every number keeps its size and its position.
            //
            // The first version built three stacks — pace, then the fault
            // sentence, then distance and time — and each sized itself
            // independently, so the pace came out visibly larger than the two
            // numbers under it. One column rendered at three sizes, which is
            // the thing the whole sizing rule exists to prevent. It looked
            // fine in isolation and was obvious the moment the board was set
            // beside the others on a contact sheet.
            WorkoutMetricStack(band: band, bandRow: 0, metrics: [
                WorkoutMetric(value: pace, unit: paceUnit, grade: grade, role: "Pace"),
                heartRate.map {
                    WorkoutMetric(value: $0, unit: "bpm", role: "Heart rate")
                } ?? WorkoutMetric(value: "No heart signal", fault: true,
                                   role: "Heart rate unavailable"),
                WorkoutMetric(value: distance, unit: distanceUnit, role: "Distance"),
                WorkoutMetric(value: elapsed, role: "Elapsed"),
            ])
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
///
/// AND NO BAND, for the same reason. The gauge's whole content is where the
/// mark sits relative to the lit segment; at the always-on refresh rate that
/// position is a minute stale, and a stale mark is a more confident lie than a
/// stale number — it is drawn as a position rather than read as a figure. The
/// pace still grades, because the colour survives being a minute old in a way
/// that a coordinate does not.
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

/// Every phase board is the same shape: numbers, and one quiet line at the
/// foot saying where you are in the session.
///
/// NO PHASE LABEL. It went the same way the metric labels went, and for the
/// same reason — the runner configured this session and knows they are running
/// a threshold block. A word at the top saying THRESHOLD is designed for
/// somebody meeting the screen for the first time while running a marathon,
/// which is nobody.
///
/// It went through two worse versions first. Both the name and the count
/// started in the top strip, where they landed beside the system clock and
/// competed with it. Splitting them helped; removing the name entirely is what
/// actually fixed it, and it handed the numbers back about 20pt.
///
/// The name still exists — VoiceOver announces it, because the accessibility
/// layer stays explicit exactly where the visual one is minimal.
struct PhaseFaceV6: View {
    /// "Work", "Recovery", "Threshold", "Mile 9". NEVER DRAWN.
    let phase: String
    /// "3 of 6", "sub 3:30". The one thing on the board that is reference
    /// rather than telemetry, which is why it sits centred at the foot rather
    /// than on the column with everything else.
    var context: String? = nil
    /// The prescribed band and where the runner is in it, drawn under the
    /// metric that is being graded. Without it the board says "you are on
    /// target" and never says what the target is — which is fine until the
    /// moment a runner drifts and needs to correct.
    var band: (start: Double, end: Double, marker: Double, inBand: Bool)? = nil
    /// Which row the band belongs under. 0 unless the graded metric moved.
    var bandRow: Int = 0
    let metrics: [WorkoutMetric]

    var body: some View {
        WorkoutPage {
            VStack(alignment: .leading, spacing: 0) {
                WorkoutMetricStack(band: band, bandRow: bandRow, metrics: metrics)

                if let context {
                    Text(context)
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .tracking(0.4)
                        .foregroundStyle(.white.opacity(0.42))
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .center)
                        // Pushed into the bottom inset, which is safe HERE and
                        // would not be on the left edge: the corner curve bites
                        // at the corners, and the horizontal centre of the
                        // bottom edge is the least curved point on the display.
                        // An offset rather than a smaller inset, so the metric
                        // stack keeps its full region.
                        .offset(y: 12)
                }
            }
            .accessibilityLabel(phase)
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
    PhaseFaceV6(phase: "Work", context: "3 of 6", metrics: [
        WorkoutMetric(value: "1:12", role: "Time left in rep"),
        WorkoutMetric(value: "6:48", unit: "/mi", grade: .onTarget, role: "Pace"),
        WorkoutMetric(value: "168", unit: "bpm", role: "Heart rate"),
        WorkoutMetric(value: "0.42", unit: "mi", role: "Rep distance"),
    ])
}

#Preview("Recovery") {
    PhaseFaceV6(phase: "Recovery", metrics: [
        WorkoutMetric(value: "1:12", role: "Time left"),
        WorkoutMetric(value: "148", unit: "bpm", role: "Heart rate"),
    ])
}

#Preview("Always-On") {
    AlwaysOnFaceV6(pace: "7:42", grade: .onTarget, distance: "5.72", elapsedMinutes: "44")
}

// MARK: - What is coming

/// The rest of the session, from where the runner is standing.
///
/// The one thing the running surface could not answer. Mid-rep a runner
/// wondering "how many left, and what is after this" had to remember, because
/// every board shows the phase in flight and nothing else — the lobby's
/// breakdown page exists but is gone the moment Start is pressed.
///
/// A THIRD PAGE, not a new gesture. The faces already page vertically and
/// carry Apple's own page indicator, so this costs the runner nothing to find
/// and nothing to learn. It is drawn only when there IS something coming: the
/// design's rule that an empty page is never drawn to even a count applies
/// exactly here, and on an easy run there is no structure to show.
///
/// No countdown, no live figure. This is the one board on the running surface
/// that is reference rather than telemetry, and putting a ticking number on it
/// would make it compete with the face the runner came from.
struct RunUpNextV6: View {
    struct Step: Identifiable {
        let id: Int
        let name: String
        let dose: String
        /// The one in flight. Drawn in fill, not in a border — there are no
        /// borders anywhere in this design.
        let current: Bool
    }

    let steps: [Step]

    var body: some View {
        WorkoutPage {
            ScrollView {
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(steps) { s in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text(s.name)
                                .font(.system(size: 15, weight: s.current ? .semibold : .regular,
                                              design: .rounded))
                                .foregroundStyle(s.current ? WatchV5.value
                                                           : WatchV5.value.opacity(0.62))
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                            Spacer(minLength: 4)
                            Text(s.dose)
                                .font(.system(size: 15, weight: .semibold, design: .rounded))
                                .monospacedDigit()
                                .foregroundStyle(s.current ? WatchV5.value
                                                           : WatchV5.value.opacity(0.62))
                                .lineLimit(1)
                        }
                        .padding(.horizontal, 9)
                        .padding(.vertical, 7)
                        .background(s.current ? WatchV5.surface3 : .clear,
                                    in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    }
                }
                // The last row clears the bottom curve rather than dying under it.
                .padding(.bottom, 14)
            }
        }
    }
}

#Preview("Up next · mid-session") {
    RunUpNextV6(steps: [
        .init(id: 0, name: "Work", dose: "400 m", current: true),
        .init(id: 1, name: "Recovery", dose: "90 sec", current: false),
        .init(id: 2, name: "Work", dose: "400 m", current: false),
        .init(id: 3, name: "Recovery", dose: "90 sec", current: false),
        .init(id: 4, name: "Cool-down", dose: "10 min", current: false),
    ])
}
