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
    /// The SAME problem, one level down: `state` alone doesn't change during
    /// the countdown — only `countdownValue` ticks 3 → 2 → 1 while `state`
    /// holds at `.countingDown` the whole time. Without its own forward the
    /// countdown board rendered once at 3, on the state flip INTO
    /// `.countingDown`, and then never again until the NEXT state flip —
    /// `.countingDown` → `.running` — three seconds later, which is a state
    /// change that no longer matches `case .countingDown`. The board never
    /// held; it just never got a second chance to draw.
    private var countdownForward: AnyCancellable?
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

    func start(_ workout: WatchWorkout, indoors: Bool = false) {
        // A second tap before the authorization await returns used to build a
        // SECOND engine on the same tracker. bind() keeps only the newer one,
        // but the first has already called tracker.start() and begun its
        // countdown — and each start() zeroes distanceMi, hrSum, maxHr and the
        // smoothed pace while the HealthKit session keeps running. The run
        // silently loses its first seconds and its aggregates.
        //
        // `self.engine` is assigned synchronously at the end of this method —
        // the only `await` lives inside a detached Task — so this guard alone
        // closes the window. A `launching` flag would look more careful and
        // guard nothing, because it would be set and cleared inside one
        // synchronous call.
        guard engine == nil else { return }
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
            // The indoor choice is lost across a stale refresh, deliberately:
            // the runner is about to be shown the lobby again with a fresher
            // session, and carrying a decision across a board they have to
            // re-answer is how a setting ends up applied to a run nobody asked
            // it for.
            beginStaleRefresh()
            return
        }
        launch(workout, indoors: indoors)
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

    private func launch(_ workout: WatchWorkout, indoors: Bool = false) {
        clearStale()
        Task {
            // Prompt for HealthKit (+ location) before the session starts
            // so the run is recorded from the first second.
            await tracker.requestAuthorization()
            let engine = WorkoutEngine(workout: workout)
            engine.tracker = tracker
            if indoors {
                // DECLARED, not discovered. `isTreadmill` reads
                // `distanceSourceUnavailable`, which until now was only ever
                // set by inference — six minutes of no distance progress, or a
                // phase running well past its estimate. That is late, and it
                // cannot tell a treadmill from a tunnel.
                //
                // The runner just told us. Setting it here means the belt run
                // grades nothing from its first second, draws no band it will
                // not judge, and is never auto-paused for standing still on a
                // machine that is moving under them.
                tracker.markDistanceSourceUnavailable()
            }
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
        countdownForward = engine.$countdownValue
            .removeDuplicates()
            .sink { [weak self] _ in self?.objectWillChange.send() }
        self.engine = engine
    }

    func reset() {
        stateForward?.cancel(); stateForward = nil
        countdownForward?.cancel(); countdownForward = nil
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
    /// The recovered HKWorkoutSession, held so "Throw it away" can end AND
    /// discard it. The tracker adopts it for the live readouts, but discard
    /// needs the session object itself and there is no un-adopt.
    private var recoveredSession: HKWorkoutSession?
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
                // P2-54 fix (2026-07-07) · nothing recoverable via HealthKit
                // (e.g. battery death — the HKWorkoutSession itself lapsed
                // with the hardware, so recoverActiveWorkoutSession has no
                // builder to hand back). A leftover snapshot's banked phase
                // results are the ONLY surviving record of the run — the
                // prior behaviour silently deleted them here, so a runner
                // whose watch died at mile 16 of an 18-mile long run found
                // NOTHING when they recharged and reopened the app: no run
                // row, no partial credit. Build a completion from the
                // snapshot alone (zero-stats RecoveredStats — there's no
                // builder to read from) and send it — status 'partial',
                // exactly like a live END & SAVE — BEFORE clearing the
                // snapshot, so a send failure can't lose the data twice.
                if let snap {
                    let zeroStats = WorkoutTracker.RecoveredStats(
                        distanceMi: nil, avgHr: nil, maxHr: nil,
                        kcal: nil, elapsedSec: 0, startDate: nil)
                    let completion = WorkoutEngine.completionFromRecovery(snapshot: snap, stats: zeroStats)
                    PhoneSync.shared.sendCompletion(completion)
                    WorkoutEngine.clearSnapshot()
                    // Same post-recovery receipt as a live END & SAVE — the
                    // runner should see their salvaged mileage, not silently
                    // land back on the idle home screen after losing the
                    // battery mid-run.
                    let summaryWorkout = snap.decodedWorkout()
                        ?? Self.recoveredStubWorkout(completion: completion)
                    recoverySummary = RecoverySummary(workout: summaryWorkout, completion: completion)
                }
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
            recoveredSession = session
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

    /// Throw away a recovered run. The addendum draws this as text at 42%
    /// with no pill, deliberately — a filled pill beside a filled pill is how
    /// a run gets thrown away by accident.
    ///
    /// The HKWorkoutSession is ended and discarded, so nothing reaches
    /// HealthKit and nothing is POSTed. That is destructive and irreversible,
    /// which is exactly why it is the unpilled option.
    func discardRecovered() {
        guard let session = recoveredSession else {
            recoveredRun = nil
            return
        }
        recoveredRun = nil
        recoveredSession = nil
        Task { await tracker.endAndDiscardRecovered(session) }
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

    // The `-face` visual-regression harness is GONE, with the fixtures it
    // rendered. It diffed against docs/design/watch-app.html, which the 0821
    // handoff retires, so its 24 reference images all describe faces that no
    // longer ship. Re-pointing it at the new boards is real work and worth
    // doing; leaving it in place pointing at a dead design would have been a
    // green harness proving nothing, which is the failure mode this build has
    // hit four times already. See docs/design/watch-0821/AUDIT.md.

    var body: some View {
        if let sim = SessionSim.request {
            // The REAL surface, driven by a REAL engine — see _SessionSim.swift.
            SessionSimView(archetype: sim.archetype, at: sim.at)
        } else if let face = FacePreview.selected {
            FacePreviewView(name: face)
        } else {
            appBody
        }
    }

    private var appBody: some View {
        content
            .onAppear {
                // Crash recovery: if a run was in progress when the app crashed or the
                // watch rebooted, restore the engine from the snapshot (RK-3, 2026-06-09).
                phone.activate()
                // A notification tap made before WCSession was up is queued in
                // UserDefaults and was never read back. One line closes it.
                FaffNotificationHandoff.flushPending()
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
            WatchRecoveryReceiptV5(
                summary: summary,
                onDone: { model.dismissRecoverySummary() }
            )
        } else if let recovered = model.recoveredRun {
            // RK-3 — a run outlived its process (crash / reboot mid-run).
            // Live elapsed / distance / HR from the re-attached session,
            // plus RESUME (when the snapshot reconstructed) and END & SAVE.
            // The addendum draws this one. It leads with the EVIDENCE that
            // the run is really there — nobody trusts an offer to resume
            // something the watch cannot describe — and "Throw it away" is
            // text at 42% with no pill, the same rule as Discard on the end
            // confirmation.
            PreSessionRecoveredRunBoard(
                // The WALL CLOCK the run began at — "from 7:11" — not its
                // duration with "ago" bolted on, which drew "FROM 41:02 AGO"
                // and printed the same number twice on one board.
                startedAt: WatchRunStart.label(secondsAgo: model.tracker.liveElapsedSec),
                distance: WFmt.miles(model.tracker.distanceMi),
                duration: WFmt.clock(model.tracker.liveElapsedSec),
                // Without a snapshot the engine cannot be rebuilt, so the
                // honest lead verb is the one that is actually available —
                // but it must not be the SAME words as the quiet option
                // below it, which is what "Save it as is" twice produced.
                carryOnLabel: recovered.canResume ? "Carry on" : "Save what is there",
                onCarryOn: {
                    // Without a snapshot the engine cannot be rebuilt, so the
                    // honest offer is to save what exists rather than to
                    // pretend the session can continue.
                    recovered.canResume ? model.resumeRecovered()
                                        : model.endAndSaveRecovered()
                },
                onSaveAsIs: { model.endAndSaveRecovered() },
                onDiscard: { model.discardRecovered() }
            )
        } else if let engine = model.engine {
            // ── The 0821 boards ──────────────────────────────────────────
            // Presentation only; the state machine above is unchanged. The
            // old ActiveWorkoutView / CountdownView / SummaryView are no
            // longer reached from here and go with the legacy palette.
            switch engine.state {
            case .finished:
                // Completion is auto-sent on the .finished transition (see
                // WatchRootModel) — Done just dismisses + resets.
                //
                // Race day gets its own board because the clock is NOT the
                // result and must not pose as one: amber until the chip time
                // lands, and the coach's sentence waits for the phone.
                WatchFinishSurfaceV5(
                    engine: engine,
                    tracker: model.tracker,
                    onDone: { model.reset() }
                )
            case .countingDown:
                // The last frame of the lobby, not a new place — the
                // session's own ramp, one numeral, nothing else moving.
                V5LobbyCountdown(
                    ramp: WatchLobbyAdapter.ramp(for: engine.workout),
                    seconds: max(1, engine.countdownValue)
                )
            case .idle, .running:
                // The decision seam, wired in exactly one place. Every one of
                // these is recorded on the run and surfaces on the phone —
                // the watch does not quietly forget what the runner chose.
                WatchRunSurfaceV5(engine: engine, tracker: model.tracker)
                    .onEndAndSave { engine.finish(save: true) }
                    .onDiscardRun {
                        // BOTH calls, and the second is the one that matters.
                        // `finish(save:)` sets the engine to .idle but never
                        // nils it, and the router renders the running surface
                        // for .idle as well as .running — so a discarded run
                        // left a DEAD engine on screen with the clock frozen
                        // and every exit closed: End & Save, Pause, Lap and
                        // Skip all guard on .running and silently refuse. The
                        // only way out was force-quitting the app.
                        engine.finish(save: false)
                        model.reset()
                    }
                    .onCeilingLift { bpm in engine.recordCeilingLift(readingBpm: bpm) }
                    .onRepSkip { _, _ in engine.recordRepSkip() }
                    .onRecoveryExtend { added in engine.recordRecoveryExtension(addedSec: added) }
                    .onDropGPS {
                        // The runner traded the route for the run. Distance
                        // survives from motion; the polyline ends here, which
                        // is the honest outcome of the choice they made.
                        model.tracker.dropGPS()
                    }
            }
        } else {
            // Home: lobby/rest (default) → JUST RUN (escape hatch — one
            // swipe right, always available regardless of today's plan) →
            // readiness glance. JUST RUN spins up an unstructured workout
            // (no target, no rep structure) so the user can run anytime —
            // rest days, when the phone hasn't paired, or when they want
            // to override today's plan and just go.
            // ── ONE lobby, no side tabs ──────────────────────────────────
            //
            // The 0821 design pages poster → breakdown → week and stops. The
            // two tabs that used to live beside it are deliberately gone:
            //
            //  · JUST RUN was an escape hatch parked one swipe right of every
            //    lobby. The design gives the escape a home ON the board that
            //    needs it — "Run anyway" on Rest day, "Plain run" on a stale
            //    or absent plan — so it appears where it is true and nowhere
            //    else.
            //
            //  · The READINESS GLANCE was a score. The design is explicit
            //    that readiness never appears as a score, because a score on
            //    a lobby is a thing to argue with at 6am; it appears as a
            //    session that has ALREADY changed, with the reason stated
            //    once. That is `sessionMoved` on the poster, and a second
            //    surface showing the number would undo the ruling.
            idleHome
        }
    }

    @ViewBuilder
    private var idleHome: some View {
        // ── dayState WINS over a workout, deliberately ───────────────────
        //
        // The server ships the session beside `dayState` when an open injury,
        // a logged sick day or a travel week holds, so a deployed watch keeps
        // running the plan exactly as before. A 0821 build must not: the
        // design says the watch does NOT prescribe through an injury, a
        // sickness or a week off — it carries the engine's own sentence and
        // offers a plain run.
        //
        // The first draft of this router had it the other way round and would
        // have drawn a threshold session to a runner the plan already knows is
        // injured. Caught by the session wiring the widget, which has to make
        // the same call and could not make it differently without the
        // complication contradicting the lobby.
        if let dayState = phone.dayState {
            // Rest day / No session, now three pages: why nothing today (1),
            // what's next when the loaded week still has a day ahead (2),
            // and the same "This week" board every lobby ends on (3).
            WatchRestSurfaceV5(
                dayState: dayState,
                weekStrip: phone.weekStrip,
                onEscape: { model.start(.makeJustRun()) }
            )
        } else if let workout = phone.todayWorkout ?? Self.simulatorWorkout {
            if let recap = phone.completedToday ?? Self.simulatorCompletedToday {
                // Today's own session is already run — the lobby draws the
                // recap instead of Start. Checked first, ahead of the stale-
                // plan board: whether the CACHED prescription is fresh has
                // nothing to say about a session that already happened.
                V5LobbyRecap(
                    typeLabel: workout.name,
                    distanceMi: recap.distanceMi,
                    durationSec: recap.durationSec,
                    paceSPerMi: recap.paceSPerMi,
                    rows: recap.rows,
                    units: workout.unitsDistance
                )
            } else if model.stalePending && workout.isExpired {
                // RK-2 — the cached plan is past its window and a refetch is
                // out. The moment a fresh payload lands, `isExpired` reads
                // false and this branch falls back to the normal START.
                // Amber, not red: stale evidence is what amber means
                // everywhere in this product, and nothing FAILED to read.
                // The prescription is still drawn at 48% — hiding it would
                // be pretending we do not have it.
                PreSessionStalePlanBoard(
                    ageKicker: WatchLobbyAdapter.ageLabel(for: workout),
                    sessionType: workout.name,
                    sessionDose: WatchLobbyAdapter.dose(for: workout),
                    onRunAnyway: { model.startAnyway(workout) },
                    onPlainRun: { model.start(.makeJustRun()) }
                )
            } else {
                WatchLobbySurfaceV5(
                    workout: workout,
                    weekStrip: phone.weekStrip,
                    sessionMoved: phone.sessionMoved,
                    onStart: { model.start(workout) }
                    // No onStartIndoors — David 2026-08-26: "I dont think we
                    // need a treadmill/indoors run from the watch. Those
                    // will always be started from the phone." The pill was
                    // reading as a status label ("you are indoors") rather
                    // than the alternate-start button it actually is, on
                    // top of not being wanted at all. `onStartIndoors`
                    // defaults to nil, which is what suppresses the pill —
                    // see V5LobbyPoster's own doc on that parameter.
                )
            }
        } else if phone.noWorkoutMessage != nil {
            // Older server, or a payload with no structured day state. The
            // sentence is all we have, so the board carries it rather than
            // inventing a reason it does not know.
            V5LobbyRefusal(
                lede: nil,
                sentence: phone.noWorkoutMessage ?? "",
                escapeLabel: "Just run",
                ramp: .noSession,
                onEscape: { model.start(.makeJustRun()) }
            )
        } else {
            // Nothing has ever arrived. This is the WHOLE of onboarding on
            // the wrist: the plan is made on the phone and this app is a
            // receiver, so the board says that and stops.
            PreSessionFirstLaunchBoard(
                onPlainRun: { model.start(.makeJustRun()) }
            )
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

    /// Sim has no paired phone → show today already run, with David's own
    /// verified 2026-08-27 figures (3.14 mi against a 7 mi ask, 121 avg bpm
    /// under a 145 cap, effort logged 4 of 10), so the recap board is
    /// exercisable against real numbers rather than round ones that would
    /// hide a formatting bug a real payload wouldn't.
    private static var simulatorCompletedToday: WatchCompletedRun? {
        #if targetEnvironment(simulator)
        guard ProcessInfo.processInfo.arguments.contains("-completed") else { return nil }
        return WatchCompletedRun(
            distanceMi: 3.14, durationSec: 1716, paceSPerMi: 546.4968152866242, avgHr: 121,
            rows: [
                WatchCompletedRow(rowId: "distance", label: "Distance", sub: "asked 7 mi", value: "3.14 mi"),
                WatchCompletedRow(rowId: "heart", label: "Heart", sub: "under 145", value: "121"),
                WatchCompletedRow(rowId: "effort", label: "Effort", value: "4 of 10"),
                WatchCompletedRow(rowId: "hr_avg", label: "Heart rate, avg", value: "121 bpm"),
            ]
        )
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





#Preview("Workout") {
    // Preview can't reach a phone; show the idle screen from the sample.
}
