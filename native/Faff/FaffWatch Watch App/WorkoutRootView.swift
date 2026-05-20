//
//  WorkoutRootView.swift
//  FaffWatch
//
//  Top-level router for the watch app.
//
//  The workout comes from the paired iPhone via WatchConnectivity
//  (PhoneSync) — it "is just there" with no manual push. States:
//
//    · no sync yet      → "Open Faff on your iPhone"
//    · synced, rest day → the rest/no-workout message
//    · synced, workout  → IdleView (Start) → active workout → SUMMARY
//
//  A WorkoutEngine is created when the user taps Start and discarded
//  when they finish, so each run binds to the latest synced workout.
//  On finish, the completion payload is handed back to the iPhone.
//

import SwiftUI
import Combine

@MainActor
final class WatchRootModel: ObservableObject {
    @Published var engine: WorkoutEngine?

    func start(_ workout: WatchWorkout) {
        let engine = WorkoutEngine(workout: workout)
        self.engine = engine
        engine.start()
    }

    func reset() {
        engine?.reset()
        engine = nil
    }
}

struct WorkoutRootView: View {
    @ObservedObject private var phone = PhoneSync.shared
    @StateObject private var model = WatchRootModel()

    var body: some View {
        content
            .onAppear {
                phone.activate()
                phone.requestTodayWorkout()
            }
    }

    @ViewBuilder
    private var content: some View {
        if let engine = model.engine {
            if engine.state == .finished {
                SummaryView(workout: engine.workout, completion: engine.completion) {
                    if let completion = engine.completion {
                        phone.sendCompletion(completion)
                    }
                    model.reset()
                }
            } else {
                ActiveWorkoutView(engine: engine)
            }
        } else if let workout = phone.todayWorkout {
            IdleView(workout: workout) { model.start(workout) }
        } else if let message = phone.noWorkoutMessage {
            NoWorkoutView(message: message)
        } else {
            WaitingForPhoneView()
        }
    }
}

/// Rest / race / no-plan day — nothing to execute.
private struct NoWorkoutView: View {
    let message: String
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "moon.zzz.fill")
                .font(.title2)
                .foregroundStyle(.secondary)
            Text(message)
                .font(.callout)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 8)
    }
}

/// No workout received yet — prompt the user to open the iPhone app.
private struct WaitingForPhoneView: View {
    var body: some View {
        VStack(spacing: 10) {
            ProgressView()
            Text("Open Faff on your iPhone to load today's workout.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 10)
    }
}

#Preview("Workout") {
    // Preview can't reach a phone; show the idle screen from the sample.
    IdleView(workout: .sample) { }
}
