//
//  SummaryView.swift
//  FaffWatch
//
//  End-of-workout readout under the locked grammar — three big number rows
//  + Done button, same shape as the in-run faces.
//
//    workout: avg pace (green) · miles (blue) · total time (white)
//    race:    finish time (white) · goal delta (green/over) · miles (blue)
//
//  The completion payload is the exact body the iPhone bridge POSTs to
//  /api/watch/workouts/complete (auto-sent the moment the run ends, not
//  gated on the Done tap — see WatchRootModel).
//

import SwiftUI

struct SummaryView: View {
    let workout: WatchWorkout
    let completion: WatchCompletion?
    let onDone: () -> Void

    var body: some View {
        ResponsiveFace {
            if workout.isRace {
                raceSummary
            } else {
                workoutSummary
            }
        }
    }

    // MARK: - Workout summary (avg pace · miles · elapsed)

    @ViewBuilder
    private var workoutSummary: some View {
        CompleteFace(
            label:    labelText,
            pace:     avgPaceText,
            distance: milesText,
            elapsed:  elapsedText,
            onDone:   onDone
        )
    }

    private var labelText: String {
        // Workout type label (e.g. "Threshold", "Easy run") — pulled from
        // the workout name, capped to a short tag size. Falls back to
        // status when the name is empty (rare).
        if !workout.name.isEmpty { return workout.name }
        return (completion?.status ?? "Complete").capitalized
    }
    private var avgPaceText: String {
        guard let c = completion, let mi = c.totalDistanceMi, mi > 0.05 else { return "—:—" }
        return PaceFormat.mmss(Int(Double(c.totalDurationSec) / mi))
    }
    private var milesText: String {
        completion?.totalDistanceMi.map { String(format: "%.1f", $0) } ?? "—"
    }
    private var elapsedText: String {
        let s = completion?.totalDurationSec ?? 0
        return s >= 3600 ? PaceFormat.hms(s) : PaceFormat.clock(s)
    }

    // MARK: - Race summary (finish time · goal delta · miles)

    @ViewBuilder
    private var raceSummary: some View {
        RaceFinishCard(
            label:     workout.name.isEmpty ? "Finish" : workout.name,
            finish:    raceFinishText,
            delta:     raceDeltaText,
            deltaRole: raceDeltaRole,
            distance:  milesText,
            onDone:    onDone
        )
    }

    private var raceFinishText: String {
        let s = completion?.totalDurationSec ?? 0
        return s >= 3600 ? PaceFormat.hms(s) : PaceFormat.clock(s)
    }
    /// Signed delta-to-goal as "-0:48" (under, green) / "+0:24" (over, red).
    /// Renders "—" until enough banked to compare.
    private var raceDeltaText: String {
        guard let goal = workout.goalSec, let c = completion else { return "—" }
        let d = c.totalDurationSec - goal
        let a = abs(d)
        let mag = a >= 60 ? "\(a / 60):" + String(format: "%02d", a % 60) : "\(a)s"
        return d <= 0 ? "-\(mag)" : "+\(mag)"
    }
    private var raceDeltaRole: Role {
        guard let goal = workout.goalSec, let c = completion else { return .neutral }
        return c.totalDurationSec <= goal ? .live : .over
    }
}

/// Race-day finish card — finish time (white) · goal delta (live/over) ·
/// distance (blue). Sibling to CompleteFace; same shape, race-specific rows.
private struct RaceFinishCard: View {
    let label: String
    let finish: String
    let delta: String
    let deltaRole: Role
    let distance: String
    var onDone: () -> Void = {}
    var body: some View {
        GeometryReader { geo in
            let h = geo.size.height
            ZStack {
                LinearGradient(colors: [Color(hex: 0x0C2A14), .black],
                               startPoint: .top, endPoint: .bottom)
                    .ignoresSafeArea()
                VStack(alignment: .leading, spacing: 0) {
                    FaceLabel(text: label, color: Faff.live, size: h * 0.06)
                        .topTagInset(h)
                    VStack(alignment: .leading, spacing: h * 0.012) {
                        BigValue(text: finish,   role: .neutral, size: h * 0.18)
                        BigValue(text: delta,    role: deltaRole, size: h * 0.18)
                        BigValue(text: distance, role: .dist,    size: h * 0.18)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                    Button(action: onDone) {
                        Text("Done")
                            .font(.custom("HelveticaNeue-Bold", size: h * 0.12))
                            .foregroundStyle(Color(hex: 0x06210C))
                            .frame(maxWidth: .infinity).padding(.vertical, h * 0.022)
                            .background(Capsule().fill(Faff.live))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, h * 0.075)
                .padding(.bottom, h * 0.085)
            }
        }
    }
}
