//
//  WorkoutRootView.swift
//  FaffWatch
//
//  Top-level router for the watch app · owns the WorkoutEngine and
//  switches between IDLE → active workout → SUMMARY.
//
//  WIRING (after adding the FaffWatch target per
//  docs/native/03-watchos-target-setup.md): point the auto-generated
//  ContentView's body at `WorkoutRootView()`.  Do NOT add a second
//  `@main` — the wizard generates FaffWatchApp.swift; this file is a
//  plain View, not an app entry point.
//
//  v0 loads WatchWorkout.sample so the flow runs in the simulator with
//  no paired iPhone.  WatchConnectivity (real workout push) replaces
//  the sample in a later phase — swap `engine` construction for the
//  received payload at that point.
//

import SwiftUI

struct WorkoutRootView: View {
    @StateObject private var engine = WorkoutEngine(workout: .sample)

    var body: some View {
        switch engine.state {
        case .idle:
            IdleView(workout: engine.workout) { engine.start() }
        case .running:
            ActiveWorkoutView(engine: engine)
        case .finished:
            SummaryView(workout: engine.workout,
                        completion: engine.completion) { engine.reset() }
        }
    }
}

#Preview {
    WorkoutRootView()
}
