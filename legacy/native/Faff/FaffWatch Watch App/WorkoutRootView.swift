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
import HealthKit

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

    // MARK: Stale-plan gate (RK-2 · 2026-06-09)

    /// True between a stale-triggered refetch and either a fresh workout
    /// landing or the runner overriding. The lobby swaps START for the
    /// STALE state while this is set.
    @Published private(set) var stalePending = false
    /// Flips true ~10s after the stale refetch went out unanswered, or
    /// immediately when the phone is unreachable / sendMessage errors —
    /// surfaces the START ANYWAY override. Race morning with the phone in
    /// a gear bag must never brick the START button.
    @Published private(set) var staleOverrideAvailable = false
    private var staleTimeoutTask: Task<Void, Never>?

    func start(_ workout: WatchWorkout) {
        // Flag 6 (backend audit 2026-06-02) — refuse to start a stale
        // workout. Risk: runner opens the watch app the next morning
        // before iPhone has pushed today's payload via WCSession, and
        // taps Start on yesterday's cached `todayWorkout`. The run
        // would record against the wrong day's plan.
        //
        // Window: backend stamps `expiresAt = issuedAt + 14h` (per
        // backend-response-to-watch-2026-06-02.md). Parsing accepts both
        // fractional (toISOString) and plain ISO-8601 — the old default
        // formatter couldn't read fractional seconds, so this gate had
        // NEVER actually fired (RK-2). Parse failure stays permissive.
        //
        // When expired: never a silent return. The lobby flips to an
        // explicit STALE state, a refetch goes out, and if no fresh
        // workout lands (phone unreachable / timeout) the runner gets a
        // clearly-labeled START ANYWAY override to run the cached session.
        if workout.isExpired {
            beginStaleRefresh()
            return
        }
        launch(workout)
    }

    /// Explicit override from the STALE state — run the cached workout
    /// even though its expiry window has passed.
    func startAnyway(_ workout: WatchWorkout) {
        launch(workout)
    }

    private func beginStaleRefresh() {
        stalePending = true
        staleOverrideAvailable = false
        // Failures are visible now: unreachable phone / sendMessage error
        // offers the override immediately instead of leaving a dead button.
        PhoneSync.shared.requestTodayWorkout(onUnreachable: { [weak self] in
            self?.staleOverrideAvailable = true
        })
        staleTimeoutTask?.cancel()
        staleTimeoutTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(10))
            guard !Task.isCancelled, let self, self.stalePending else { return }
            self.staleOverrideAvailable = true
        }
    }

    private func clearStale() {
        staleTimeoutTask?.cancel(); staleTimeoutTask = nil
        stalePending = false
        staleOverrideAvailable = false
    }

    private func launch(_ workout: WatchWorkout) {
        clearStale()
        Task {
            // Prompt for HealthKit (+ location) before the session starts
            // so the run is recorded from the first second.
            await tracker.requestAuthorization()
            let engine = WorkoutEngine(workout: workout)
            engine.tracker = tracker
            bind(engine)
            engine.beginCountdown()
        }
    }

    /// Shared engine wiring for fresh starts AND crash-recovery resumes:
    /// forward state flips to the router + auto-send the completion once.
    private func bind(_ engine: WorkoutEngine) {
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
    }

    func reset() {
        stateForward?.cancel(); stateForward = nil
        didSendCompletion = false
        engine?.reset()
        engine = nil
    }

    // MARK: Crash recovery (RK-3 · 2026-06-09)

    struct RecoveredRunState {
        var canResume: Bool
        var saving = false
    }
    struct RecoverySummary {
        let workout: WatchWorkout
        let completion: WatchCompletion
    }

    /// Non-nil while a recovered HKWorkoutSession is waiting on the
    /// runner's RESUME / END & SAVE decision.
    @Published private(set) var recoveredRun: RecoveredRunState?
    /// End-of-recovery receipt — drives a SummaryView after END & SAVE.
    @Published private(set) var recoverySummary: RecoverySummary?
    private var recoveredResume: (workout: WatchWorkout, snapshot: WorkoutEngine.RunSnapshot)?
    private var recoveredSnapshot: WorkoutEngine.RunSnapshot?
    private var didAttemptRecovery = false

    /// Called once at first root appearance. If HealthKit hands back a
    /// session that outlived its process (crash / reboot mid-run), re-attach
    /// it and surface the RECOVERED state. No recoverable session → normal
    /// startup, zero behavior change. Every step is defensive — a crash
    /// loop in recovery would be worse than no recovery.
    func attemptRecovery() {
        guard !didAttemptRecovery else { return }
        didAttemptRecovery = true
        guard engine == nil else { return }
        Task {
            let snap = WorkoutEngine.loadSnapshot()
            guard let session = await tracker.recoverActiveSession() else {
                // Nothing recoverable. A leftover snapshot means the run
                // died in a way HealthKit couldn't bridge (e.g. battery
                // death where the session lapsed) — no builder exists to
                // save from, so clear it; a lingering snapshot would
                // mislabel a future recovery.
                if snap != nil { WorkoutEngine.clearSnapshot() }
                return
            }
            // TreadmillHRSession runs are indoor and their HKWorkout is
            // deliberately discarded (the iPhone's POST is the canonical
            // record — see TreadmillHRSession). Our own tracker only ever
            // opens OUTDOOR sessions, so indoor → treadmill: end-and-discard
            // exactly as that flow's own end() would have.
            if session.workoutConfiguration.locationType == .indoor {
                await tracker.endAndDiscardRecovered(session)
                if snap == nil { return }
                // Keep any outdoor-run snapshot for a later attempt? No —
                // its session is gone too (only one session survives).
                WorkoutEngine.clearSnapshot()
                return
            }
            tracker.adoptRecoveredSession(session)
            // Pair the snapshot with THIS session only when their start
            // times agree — a stale snapshot from an older crashed run must
            // not be grafted onto a different session's data.
            let validSnap: WorkoutEngine.RunSnapshot? = {
                guard let snap else { return nil }
                guard let sessionStart = session.startDate else { return snap }
                let gap = abs(sessionStart.timeIntervalSince1970 - snap.startedAtEpoch)
                return gap <= 600 ? snap : nil
            }()
            recoveredSnapshot = validSnap
            recoveredResume = {
                guard let validSnap, let w = validSnap.decodedWorkout() else { return nil }
                let indexOk = validSnap.planComplete || w.phases.indices.contains(validSnap.currentIndex)
                return indexOk ? (w, validSnap) : nil
            }()
            recoveredRun = RecoveredRunState(canResume: recoveredResume != nil)
        }
    }

    /// RESUME — rebuild the engine at the snapshot's phase and re-enter the
    /// active workout flow. Only offered when the snapshot decoded cleanly.
    func resumeRecovered() {
        guard let plan = recoveredResume else { return }
        let engine = WorkoutEngine(workout: plan.workout)
        engine.tracker = tracker
        bind(engine)
        engine.resumeFromSnapshot(plan.snapshot)
        recoveredRun = nil
        recoveredResume = nil
        recoveredSnapshot = nil
    }

    /// END & SAVE — close the session through the normal end() path (the
    /// HKWorkout + route persist), build a completion from builder
    /// statistics + snapshot phases, and send it through the existing
    /// completion pipeline so the run reaches the server. Works with or
    /// without a snapshot — the HKWorkout is never discarded.
    func endAndSaveRecovered() {
        guard recoveredRun != nil, recoveredRun?.saving != true else { return }
        recoveredRun?.saving = true
        let snap = recoveredSnapshot
        Task {
            // Builder statistics must be read BEFORE end() tears it down.
            let stats = tracker.recoveredStats()
            await tracker.end()
            let completion = WorkoutEngine.completionFromRecovery(snapshot: snap, stats: stats)
            PhoneSync.shared.sendCompletion(completion)
            WorkoutEngine.clearSnapshot()
            let summaryWorkout = snap?.decodedWorkout()
                ?? Self.recoveredStubWorkout(completion: completion)
            recoverySummary = RecoverySummary(workout: summaryWorkout, completion: completion)
            recoveredRun = nil
            recoveredResume = nil
            recoveredSnapshot = nil
        }
    }

    func dismissRecoverySummary() {
        recoverySummary = nil
    }

    /// Minimal workout shell for the post-recovery summary when no snapshot
    /// survived (SummaryView only reads name / isRace from it).
    private static func recoveredStubWorkout(completion: WatchCompletion) -> WatchWorkout {
        WatchWorkout(
            workoutId: completion.workoutId,
            name: "Recovered",
            summary: "Recovered run",
            totalEstimatedMinutes: max(1, completion.totalDurationSec / 60),
            phases: [],
            completionEndpoint: "/api/watch/workouts/complete",
            expiresAt: "2099-12-31T00:00:00Z"
        )
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
                // Crash recovery: if a run was in progress when the app crashed or the
                // watch rebooted, restore the engine from the snapshot (RK-3, 2026-06-09).
                Task { await model.attemptRecovery() }
                phone.activate()
                phone.requestTodayWorkout()
                // RK-3 — ask HealthKit for a session that outlived its
                // process (crash / reboot mid-run). One-shot; no-op on a
                // normal launch.
                model.attemptRecovery()
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
        } else if let summary = model.recoverySummary {
            // END & SAVE receipt — the recovered run's numbers, then home.
            SummaryView(workout: summary.workout, completion: summary.completion) {
                model.dismissRecoverySummary()
            }
        } else if let recovered = model.recoveredRun {
            // RK-3 — a run outlived its process (crash / reboot mid-run).
            // Live elapsed / distance / HR from the re-attached session,
            // plus RESUME (when the snapshot reconstructed) and END & SAVE.
            RecoveredRunView(
                tracker: model.tracker,
                canResume: recovered.canResume,
                saving: recovered.saving,
                onResume: { model.resumeRecovered() },
                onEndSave: { model.endAndSaveRecovered() }
            )
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
            if model.stalePending && workout.isExpired {
                // RK-2 — the cached plan is past its window and a refetch is
                // out. The moment a fresh payload lands, `isExpired` reads
                // false and this branch falls back to the normal START.
                StalePlanView(
                    overrideAvailable: model.staleOverrideAvailable,
                    onStartAnyway: { model.startAnyway(workout) }
                )
            } else {
                IdleView(workout: workout) { model.start(workout) }
            }
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
        // -finish → long run with an HM/M finish segment, to verify the
        // engine + router show the EASY face on the build and the FINISH
        // face on the finish phase (not the rep face), with a FINISH cue.
        if args.contains("-finish") { return .sampleLongFinish }
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
                    Text("FAFF").font(WatchTheme.display(15)).italic().tracking(1.5).foregroundStyle(Faff.race)
                    Spacer()
                }
                .padding(.leading, 8).padding(.top, 14)   // FAFF baseline level with the OS clock
                Spacer()
                // Big green REST + the body read (no "REST DAY" eyebrow — that's "rest" twice).
                Text("REST").font(WatchTheme.display(80)).foregroundStyle(Faff.live)
                Text(message)
                    .font(WatchTheme.body(13, .medium)).foregroundStyle(Faff.t2)
                    .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 180).padding(.top, 8)
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .padding(.horizontal, 14).padding(.bottom, 12)
        }
    }
}

/// RK-2 — the cached plan is expired and a refetch is in flight. Amber
/// STALE hero + status line; once the phone proves unreachable (or ~10s
/// pass) a START ANYWAY capsule appears so race morning with the phone in
/// a gear bag never bricks the start.
private struct StalePlanView: View {
    let overrideAvailable: Bool
    let onStartAnyway: () -> Void

    var body: some View {
        ResponsiveFace {
            VStack(spacing: 0) {
                HStack {
                    Text("FAFF").font(WatchTheme.display(15)).italic().tracking(1.5).foregroundStyle(Faff.race)
                    Spacer()
                }
                .padding(.leading, 8).padding(.top, 14)   // FAFF baseline level with the OS clock
                Spacer()
                Text("STALE").font(WatchTheme.display(64)).foregroundStyle(Faff.goal)
                Text(overrideAvailable
                     ? "Phone unreachable. Cached session only."
                     : "Syncing today's session.")
                    .font(WatchTheme.body(13, .medium)).foregroundStyle(Faff.t2)
                    .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 180).padding(.top, 6)
                if !overrideAvailable {
                    ProgressView().tint(Faff.goal).padding(.top, 8)
                }
                Spacer()
                if overrideAvailable {
                    Button(action: onStartAnyway) {
                        Text("START ANYWAY")
                            .font(.custom("HelveticaNeue-Bold", size: 16)).tracking(1.5)
                            .foregroundStyle(Color.black)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 9)
                            .background(Capsule().fill(Faff.goal))
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 15)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .padding(.horizontal, 14).padding(.bottom, 12)
        }
    }
}

/// RK-3 — a run outlived its process. Live reads come straight off the
/// re-attached session (builder elapsed, tracker distance/HR); RESUME
/// re-enters the guided workout at the snapshot's phase, END & SAVE closes
/// the session out properly so the HKWorkout + completion are never lost.
private struct RecoveredRunView: View {
    @ObservedObject var tracker: WorkoutTracker
    let canResume: Bool
    let saving: Bool
    let onResume: () -> Void
    let onEndSave: () -> Void

    private var distText: String {
        tracker.distanceMi > 0 ? String(format: "%.2f", tracker.distanceMi) : "—"
    }
    private var hrText: String {
        tracker.heartRate > 0 ? "♥\(tracker.heartRate)" : "♥—"
    }
    private func elapsedText() -> String {
        let s = tracker.liveElapsedSec
        return s >= 3600 ? PaceFormat.hms(s) : PaceFormat.clock(s)
    }

    var body: some View {
        ResponsiveFace {
            GeometryReader { geo in
                let h = geo.size.height
                ZStack {
                    Color.black.ignoresSafeArea()
                    VStack(alignment: .leading, spacing: 0) {
                        FaceLabel(text: "RECOVERED", color: Faff.goal, size: h * 0.06)
                            .topTagInset(h)
                        VStack(alignment: .leading, spacing: h * 0.012) {
                            TimelineView(.periodic(from: .now, by: 1)) { _ in
                                BigValue(text: elapsedText(), role: .neutral, size: h * 0.14)
                            }
                            BigValue(text: distText, role: .dist, size: h * 0.14)
                            BigValue(text: hrText, role: .neutral, size: h * 0.14)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                        if saving {
                            HStack {
                                Spacer()
                                ProgressView().tint(Faff.goal)
                                Spacer()
                            }
                            .padding(.vertical, h * 0.035)
                        } else {
                            VStack(spacing: h * 0.018) {
                                if canResume {
                                    Button(action: onResume) {
                                        HStack(spacing: h * 0.028) {
                                            Image(systemName: "play.fill")
                                                .font(.system(size: h * 0.048, weight: .bold))
                                            Text("RESUME")
                                                .font(.custom("HelveticaNeue-Bold", size: h * 0.072))
                                                .tracking(1.5)
                                        }
                                        .foregroundStyle(Faff.onLive)
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, h * 0.020)
                                        .background(Capsule().fill(Faff.live))
                                    }
                                    .buttonStyle(.plain)
                                }
                                Button(action: onEndSave) {
                                    Text("END & SAVE")
                                        .font(.custom("HelveticaNeue-Bold", size: h * 0.072))
                                        .tracking(1.5)
                                        .foregroundStyle(.white)
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, h * 0.020)
                                        .background(Capsule().fill(Faff.brand))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .padding(.horizontal, h * 0.075)
                    .padding(.bottom, h * 0.045)
                }
            }
        }
    }
}

/// No workout received yet — prompt the user to open the iPhone app.
private struct WaitingForPhoneView: View {
    var body: some View {
        ResponsiveFace {
            VStack(spacing: 10) {
                ProgressView().tint(Faff.race)
                Text("Open Faff on your iPhone to load today's workout.")
                    .font(WatchTheme.body(12, .medium))
                    .foregroundStyle(Faff.t2)
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
