//
//  SummaryView.swift
//  FaffWatch
//
//  End-of-workout readout on the dark v4 canon (watch-app.html §E): a
//  green check ring, "Complete", a 3-column stat grid (reps, avg pace,
//  miles, avg HR, cadence, time), then "Saved · syncing". The completion
//  payload is the exact body the iPhone bridge POSTs to
//  /api/watch/workouts/complete.
//

import SwiftUI

struct SummaryView: View {
    let workout: WatchWorkout
    let completion: WatchCompletion?
    let onDone: () -> Void

    private var workReps: (done: Int, total: Int) {
        let total = workout.phases.filter { $0.type == .work }.count
        let done = completion?.phases.filter { $0.type == "work" && $0.completed }.count ?? 0
        return (done, total)
    }
    private var avgPace: String {
        guard let c = completion, let mi = c.totalDistanceMi, mi > 0.05 else { return "—" }
        return PaceFormat.mmss(Int(Double(c.totalDurationSec) / mi))
    }

    // Race finish (watch-app.html §F): finish time vs goal + split shape.
    private var goalDelta: (String, Color)? {
        guard workout.isRace, let goal = workout.goalSec, let c = completion else { return nil }
        let d = c.totalDurationSec - goal
        if d <= 0 { return ("\(PaceFormat.clock(-d)) under goal", WatchTheme.C.green) }
        return ("\(PaceFormat.clock(d)) over goal", WatchTheme.C.warn)
    }

    var body: some View {
        // Authored for the Ultra canvas, scaled to fit any watch (no scroll needed).
        ResponsiveFace {
            VStack(spacing: 0) {
                Spacer(minLength: 0)
                Text(titleText.uppercased())
                    .font(WatchTheme.display(30)).foregroundStyle(WatchTheme.C.ink)

                if workout.isRace {
                    raceFinish
                } else {
                    workoutGrid
                }

                Text("Saved · syncing").font(WatchTheme.body(9.5, .semibold)).tracking(0.4)
                    .foregroundStyle(WatchTheme.C.t2).textCase(.uppercase).padding(.top, 12)

                Button(action: onDone) {
                    Text("DONE").font(WatchTheme.sub(13, .semibold)).tracking(1.5)
                        .frame(maxWidth: .infinity).padding(.vertical, 10)
                        .foregroundStyle(WatchTheme.C.ink)
                        .overlay(Capsule().stroke(WatchTheme.C.track, lineWidth: 1.5))
                }
                .buttonStyle(.plain).padding(.top, 12)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var titleText: String {
        if workout.isRace { return "Finish" }
        return completion?.status == "completed" || completion == nil ? "Complete" : completion!.status
    }

    @ViewBuilder private var raceFinish: some View {
        Text(PaceFormat.hms(completion?.totalDurationSec ?? 0))
            .font(WatchTheme.display(56)).tracking(-1).foregroundStyle(WatchTheme.C.green)
            .lineLimit(1).minimumScaleFactor(0.5).padding(.top, 8)
        if let (text, color) = goalDelta {
            Text(text).font(WatchTheme.body(13, .semibold)).foregroundStyle(color).padding(.top, 4)
        }
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 12) {
            cell(completion?.totalDistanceMi.map { String(format: "%.1f", $0) } ?? "—", "Miles")
            cell(avgPace, "Avg pace")
            cell(completion?.avgHr.map { "\($0)" } ?? "—", "Avg HR")
        }.padding(.top, 13)
    }

    @ViewBuilder private var workoutGrid: some View {
        let r = workReps
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 12) {
            cell("\(r.done)/\(r.total)", "Reps")
            cell(avgPace, "Avg pace")
            cell(completion?.totalDistanceMi.map { String(format: "%.1f", $0) } ?? "—", "Miles")
            cell(completion?.avgHr.map { "\($0)" } ?? "—", "Avg HR")
            cell(completion?.avgCadence.map { "\($0)" } ?? "—", "Cadence")
            cell(PaceFormat.clock(completion?.totalDurationSec ?? 0), "Time")
        }
        .padding(.top, 13)
    }

    private func cell(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(WatchTheme.display(22)).foregroundStyle(WatchTheme.C.ink)
                .lineLimit(1).minimumScaleFactor(0.5)
            Text(label.uppercased()).font(WatchTheme.body(7.5, .semibold)).tracking(0.4)
                .foregroundStyle(WatchTheme.C.t2).lineLimit(1)
        }.frame(maxWidth: .infinity)
    }
}

#Preview {
    SummaryView(
        workout: .sample,
        completion: WatchCompletion(
            workoutId: "sample-threshold",
            startedAt: "2026-05-19T06:00:00Z",
            completedAt: "2026-05-19T06:52:00Z",
            status: "completed",
            totalDistanceMi: 6.4,
            totalDurationSec: 3134,
            avgHr: 171,
            maxHr: 182,
            phases: []
        )
    ) { }
}
