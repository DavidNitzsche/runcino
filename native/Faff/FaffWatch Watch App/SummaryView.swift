//
//  SummaryView.swift
//  FaffWatch
//
//  End-of-workout screen (scoping state machine · SUMMARY).  Shows the
//  per-phase result of what was just executed and a Done button that
//  returns to IDLE.
//
//  The completion payload shown here is the exact body the iPhone
//  bridge will POST to /api/watch/workouts/complete once the
//  WatchConnectivity + HealthKit writeback path is wired (phase 6).
//  In this shell it's displayed locally, not yet sent.
//

import SwiftUI

struct SummaryView: View {
    let workout: WatchWorkout
    let completion: WatchCompletion?
    let onDone: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                VStack(spacing: 2) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.title)
                        .foregroundStyle(.green)
                    Text("Workout complete")
                        .font(.headline)
                    Text(workout.name)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }

                if let completion {
                    HStack {
                        Text("Total")
                        Spacer()
                        Text(PaceFormat.clock(completion.totalDurationSec))
                            .monospacedDigit()
                    }
                    .font(.caption)

                    if completion.status != "completed" {
                        Text(completion.status.uppercased())
                            .font(.caption2).fontWeight(.bold)
                            .foregroundStyle(.orange)
                    }

                    Divider()

                    ForEach(completion.phases, id: \.index) { phase in
                        PhaseResultRow(phase: phase)
                    }
                }

                Button(action: onDone) {
                    Text("Done").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .padding(.top, 4)
            }
            .padding(.horizontal, 6)
        }
    }
}

private struct PhaseResultRow: View {
    let phase: WatchCompletionPhase

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Image(systemName: phase.completed ? "checkmark" : "xmark")
                .font(.caption2)
                .foregroundStyle(phase.completed ? .green : .secondary)
            Text(phase.label)
                .font(.caption)
            Spacer()
            Text(PaceFormat.clock(phase.actualDurationSec))
                .font(.caption)
                .monospacedDigit()
                .foregroundStyle(.secondary)
        }
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
            totalDistanceMi: nil,
            totalDurationSec: 3120,
            avgHr: nil,
            maxHr: nil,
            phases: [
                WatchCompletionPhase(index: 0, type: "warmup", label: "Warmup", targetPaceSPerMi: nil, actualPaceSPerMi: nil, actualDurationSec: 600, avgHr: nil, completed: true),
                WatchCompletionPhase(index: 1, type: "work", label: "Interval 1/5", targetPaceSPerMi: 391, actualPaceSPerMi: nil, actualDurationSec: 420, avgHr: nil, completed: true),
            ]
        )
    ) { }
}
