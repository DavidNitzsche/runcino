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
    /// One tracker for the app's lifetime; the engine binds to it per run.
    let tracker = WorkoutTracker()
    /// Forwards the engine's phase-state changes so the router below re-runs
    /// when the engine moves countdown → running → finished. Without this the
    /// root only observes `model`, so a state flip after the engine is
    /// assigned (e.g. the countdown completing) would never re-render.
    private var stateForward: AnyCancellable?

    func start(_ workout: WatchWorkout) {
        Task {
            // Prompt for HealthKit (+ location) before the session starts
            // so the run is recorded from the first second.
            await tracker.requestAuthorization()
            let engine = WorkoutEngine(workout: workout)
            engine.tracker = tracker
            stateForward = engine.$state
                .removeDuplicates()
                .sink { [weak self] _ in self?.objectWillChange.send() }
            self.engine = engine
            engine.beginCountdown()
        }
    }

    func reset() {
        stateForward?.cancel(); stateForward = nil
        engine?.reset()
        engine = nil
    }
}

struct WorkoutRootView: View {
    @ObservedObject private var phone = PhoneSync.shared
    @StateObject private var model = WatchRootModel()

    /// Visual-regression fixture: `-face <name>` renders one face with the
    /// canonical values so scripts/watch can diff it. Short-circuits the app.
    private static var fixtureFace: String? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-face"), i + 1 < args.count else { return nil }
        return args[i + 1]
    }

    var body: some View {
        if let face = Self.fixtureFace {
            WatchFixtureView(face: face)
        } else {
            appBody
        }
    }

    private var appBody: some View {
        content
            .onAppear {
                phone.activate()
                phone.requestTodayWorkout()
            }
    }

    @ViewBuilder
    private var content: some View {
        if let engine = model.engine {
            switch engine.state {
            case .finished:
                SummaryView(workout: engine.workout, completion: engine.completion) {
                    if let completion = engine.completion {
                        phone.sendCompletion(completion)
                    }
                    model.reset()
                }
            case .countingDown:
                CountdownView(engine: engine)
            case .idle, .running:
                ActiveWorkoutView(engine: engine, tracker: model.tracker)
            }
        } else if let workout = phone.todayWorkout ?? Self.simulatorWorkout {
            IdleView(workout: workout) { model.start(workout) }
        } else if let message = phone.noWorkoutMessage {
            NoWorkoutView(message: message)
        } else {
            WaitingForPhoneView()
        }
    }

    /// The watch is a companion (the phone pushes the workout over
    /// WatchConnectivity). The simulator has no paired phone, so fall
    /// back to the bundled sample — which mirrors the /api/watch/today
    /// shape — so the faces + state machine are fully exercisable.
    private static var simulatorWorkout: WatchWorkout? {
        #if targetEnvironment(simulator)
        // Launch with -race to exercise the race-day faces (watch-app.html §F).
        return ProcessInfo.processInfo.arguments.contains("-race") ? .sampleRace : .sample
        #else
        return nil
        #endif
    }
}

/// Rest / race / no-plan day — nothing to execute (watch-app.html §A ·
/// rest day): green eyebrow, a plain "REST" hero, and the body read.
private struct NoWorkoutView: View {
    let message: String
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("FAFF").font(WatchTheme.display(15)).italic().tracking(1.5).foregroundStyle(WatchTheme.C.orange)
                Spacer()
            }
            Spacer(minLength: 4)
            // w-rest (deck §A): green eyebrow, big green REST, the body read.
            VStack(spacing: 8) {
                Text("Rest day").font(WatchTheme.body(11, .bold)).tracking(0.5)
                    .foregroundStyle(WatchTheme.C.green).textCase(.uppercase)
                Text("REST").font(WatchTheme.display(70)).tracking(-1).foregroundStyle(WatchTheme.C.green)
                Text(message)
                    .font(WatchTheme.body(12.5, .medium)).foregroundStyle(WatchTheme.C.t2)
                    .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity)
            Spacer(minLength: 4)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .padding(.horizontal, 10).padding(.bottom, 2)
        .background(WatchTheme.C.bg.ignoresSafeArea())
    }
}

/// No workout received yet — prompt the user to open the iPhone app.
private struct WaitingForPhoneView: View {
    var body: some View {
        VStack(spacing: 10) {
            ProgressView().tint(WatchTheme.C.orange)
            Text("Open Faff on your iPhone to load today's workout.")
                .font(WatchTheme.body(12, .medium))
                .foregroundStyle(WatchTheme.C.t2)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WatchTheme.C.bg.ignoresSafeArea())
    }
}

#Preview("Workout") {
    // Preview can't reach a phone; show the idle screen from the sample.
    IdleView(workout: .sample) { }
}
