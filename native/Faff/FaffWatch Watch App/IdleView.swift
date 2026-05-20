//
//  IdleView.swift
//  FaffWatch
//
//  The watch's start screen (scoping §1 "Today's workout on the watch,
//  ready to start").  Shows the workout name + one-line summary with a
//  big Start button.  No login on the watch — auth lives on the iPhone.
//

import SwiftUI

struct IdleView: View {
    let workout: WatchWorkout
    let onStart: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            VStack(spacing: 2) {
                Text(workout.name)
                    .font(.headline)
                    .multilineTextAlignment(.center)
                Text(workout.summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            Text("≈ \(workout.totalEstimatedMinutes) min · \(workout.phases.count) phases")
                .font(.caption2)
                .foregroundStyle(.secondary)

            Button(action: onStart) {
                Label("Start", systemImage: "play.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.green)
        }
        .padding(.horizontal, 8)
    }
}

#Preview {
    IdleView(workout: .sample) { }
}
