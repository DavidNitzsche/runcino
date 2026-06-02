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
    /// Guard so the finished workout's completion is sent to the iPhone exactly
    /// once, the moment the run ends — NOT gated on the user tapping "Done" on
    /// the summary (a wrist-drop there used to mean the run never synced).
    private var didSendCompletion = false

    func start(_ workout: WatchWorkout) {
        // Flag 6 (backend audit 2026-06-02) — refuse to start a stale
        // workout. Risk: runner opens the watch app the next morning
        // before iPhone has pushed today's payload via WCSession, and
        // taps Start on yesterday's cached `todayWorkout`. The run
        // would record against the wrong day's plan.
        //
        // Window: backend stamps `expiresAt = issuedAt + 14h` (per
        // backend-response-to-watch-2026-06-02.md). 14h covers both
        // the evening-issued workout that's used the next morning and
        // the morning-issued workout that's used that evening, while
        // still catching the day-late start. Parse-failure is permissive
        // (fall through and start) to avoid blocking legit runs on a
        // malformed timestamp; the gap is very small.
        if let exp = ISO8601DateFormatter().date(from: workout.expiresAt),
           Date.now > exp {
            // Trigger a re-fetch from iPhone; once it lands via
            // applicationContext the IdleView re-renders with the
            // fresh workout, and the runner can re-tap Start.
            PhoneSync.shared.requestTodayWorkout()
            return
        }
        Task {
            // Prompt for HealthKit (+ location) before the session starts
            // so the run is recorded from the first second.
            await tracker.requestAuthorization()
            let engine = WorkoutEngine(workout: workout)
            engine.tracker = tracker
            didSendCompletion = false
            stateForward = engine.$state
                .removeDuplicates()
                .sink { [weak self] newState in
                    guard let self else { return }
                    self.objectWillChange.send()
                    // Auto-send the completion as soon as the run finishes.
                    if newState == .finished, !self.didSendCompletion,
                       let completion = engine.completion {
                        self.didSendCompletion = true
                        PhoneSync.shared.sendCompletion(completion)
                    }
                }
            self.engine = engine
            engine.beginCountdown()
        }
    }

    func reset() {
        stateForward?.cancel(); stateForward = nil
        didSendCompletion = false
        engine?.reset()
        engine = nil
    }
}

struct WorkoutRootView: View {
    @ObservedObject private var phone = PhoneSync.shared
    @ObservedObject private var treadmillHR = TreadmillHRSession.shared
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
                #if targetEnvironment(simulator)
                // -autostart launch arg: skip the lobby tap and immediately
                // begin the simulator workout. For automated sim drives via
                // `xcrun simctl launch ... -autostart`.
                if ProcessInfo.processInfo.arguments.contains("-autostart"),
                   model.engine == nil,
                   let w = Self.simulatorWorkout {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                        model.start(w)
                    }
                }
                #endif
            }
    }

    @ViewBuilder
    private var content: some View {
        if treadmillHR.isActive {
            // iPhone TreadmillView started us · take over the watch
            // screen with the live HR display. Takes precedence over
            // the idle TabView so a wrist-glance during the treadmill
            // session shows the heart rate immediately.
            TreadmillHRView()
        } else if let engine = model.engine {
            switch engine.state {
            case .finished:
                // Completion is auto-sent on the .finished transition (see
                // WatchRootModel) — Done just dismisses + resets.
                SummaryView(workout: engine.workout, completion: engine.completion) {
                    model.reset()
                }
            case .countingDown:
                CountdownView(engine: engine)
            case .idle, .running:
                ActiveWorkoutView(engine: engine, tracker: model.tracker)
            }
        } else {
            // Home: lobby/rest (default) → JUST RUN (escape hatch — one
            // swipe right, always available regardless of today's plan) →
            // readiness glance. JUST RUN spins up an unstructured workout
            // (no target, no rep structure) so the user can run anytime —
            // rest days, when the phone hasn't paired, or when they want
            // to override today's plan and just go.
            TabView {
                idleHome.tag(0)
                ResponsiveFace {
                    JustRunFace(onStart: { model.start(.makeJustRun()) })
                }.tag(1)
                ResponsiveFace {
                    ReadinessGlanceView(readiness: phone.readiness ?? Self.simulatorReadiness)
                }.tag(2)
            }
            .tabViewStyle(.page)
        }
    }

    @ViewBuilder
    private var idleHome: some View {
        if let workout = phone.todayWorkout ?? Self.simulatorWorkout {
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
        let args = ProcessInfo.processInfo.arguments
        // -race  → race-day faces (watch-app.html §F)
        // -cruise → 4 × 1 mile threshold reps with mixed distance/time phases,
        //          to verify the engine + face router consume the new
        //          structured-workout payload correctly.
        if args.contains("-race") { return .sampleRace }
        if args.contains("-cruise") { return .sampleCruise }
        return .sample
        #else
        return nil
        #endif
    }

    /// Sim has no paired phone → show a sample readiness read so the glance
    /// page is exercisable.
    private static var simulatorReadiness: WatchReadiness? {
        #if targetEnvironment(simulator)
        // Neutral fixture — no canned "Hit today's prescription" copy (it's
        // no longer the recommendation pattern), no real race name leaking.
        return WatchReadiness(score: 82, state: "green", label: "Primed",
                              recommendation: "Sleep banked. Today's session is good to go.",
                              hrvMs: 68, rhrBpm: 48, suppressReason: nil,
                              nextRace: nil)
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
        ResponsiveFace {
            VStack(spacing: 0) {
                HStack {
                    Text("FAFF").font(WatchTheme.display(15)).italic().tracking(1.5).foregroundStyle(WatchTheme.C.orange)
                    Spacer()
                }
                .padding(.leading, 8).padding(.top, 14)   // FAFF baseline level with the OS clock
                Spacer()
                // Big green REST + the body read (no "REST DAY" eyebrow — that's "rest" twice).
                Text("REST").font(WatchTheme.display(80)).foregroundStyle(WatchTheme.C.green)
                Text(message)
                    .font(WatchTheme.body(13, .medium)).foregroundStyle(WatchTheme.C.t2)
                    .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 180).padding(.top, 8)
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .padding(.horizontal, 14).padding(.bottom, 12)
        }
    }
}

/// No workout received yet — prompt the user to open the iPhone app.
private struct WaitingForPhoneView: View {
    var body: some View {
        ResponsiveFace {
            VStack(spacing: 10) {
                ProgressView().tint(WatchTheme.C.orange)
                Text("Open Faff on your iPhone to load today's workout.")
                    .font(WatchTheme.body(12, .medium))
                    .foregroundStyle(WatchTheme.C.t2)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

#Preview("Workout") {
    // Preview can't reach a phone; show the idle screen from the sample.
    IdleView(workout: .sample) { }
}
