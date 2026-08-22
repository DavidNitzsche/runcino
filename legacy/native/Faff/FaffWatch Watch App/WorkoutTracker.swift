//
//  WorkoutTracker.swift
//  FaffWatch
//
//  The real run recorder (scoping §"Phase 4"): turns the timer-driven
//  workout shell into an actual tracked run. Owns an HKWorkoutSession +
//  HKLiveWorkoutBuilder for live heart rate / distance / energy, an
//  HKWorkoutRouteBuilder + CLLocationManager for the GPS route, and
//  saves the finished HKWorkout to Apple Health (which then flows to
//  Strava / faff.run).
//
//  The WorkoutEngine still drives the phase clock + haptics; this tracker
//  records the session underneath and publishes live metrics the UI and
//  PaceDrift bind to. Entitlement + usage strings live on the watch
//  target (HealthKit + WKBackgroundModes: workout-processing).
//

import Foundation
import Combine
import HealthKit
import CoreLocation
import CoreMotion

@MainActor
final class WorkoutTracker: NSObject, ObservableObject {

    private let healthStore = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var routeBuilder: HKWorkoutRouteBuilder?
    private let locationManager = CLLocationManager()
    /// In-memory GPS coordinate accumulator for the completion polyline.
    /// Stores (lat, lng) pairs — lightweight vs full CLLocation — for all
    /// accurate fixes received during the run.  Read by buildCompletion
    /// BEFORE tracker.end() is called; cleared when a new workout starts.
    private(set) var gpsCoords: [(Double, Double)] = []
    /// Cumulative elevation GAIN in meters, summed from positive barometer-
    /// fused CLLocation.altitude deltas during the run. Read by buildCompletion
    /// BEFORE tracker.end(); cleared when a new workout starts. `lastAltitudeM`
    /// holds the previous fix's altitude for the per-fix delta.
    private(set) var elevGainM: Double = 0
    private var lastAltitudeM: Double? = nil
    /// Live running cadence (steps/min). CMPedometer gives `currentCadence`
    /// directly, which is far more reliable than differencing HealthKit's
    /// batched cumulative step count over wall-clock time.
    private let pedometer = CMPedometer()

    // ── Live metrics (views + PaceDrift bind to these) ────────────
    @Published private(set) var heartRate: Int = 0       // current bpm
    @Published private(set) var distanceMi: Double = 0   // cumulative
    @Published private(set) var paceSPerMi: Int = 0      // instantaneous (GPS)
    @Published private(set) var cadence: Int = 0         // spm (live; Phase-2 on device)
    @Published private(set) var activeEnergyKcal: Int = 0
    @Published private(set) var isRecording = false
    /// P2-56 · true once a distance-based phase has gone the whole run with
    /// essentially no distance banked (HealthKit denied / session failed to
    /// start / no GPS+no HK). Set by WorkoutEngine.tick()'s noDistanceSource
    /// fallback the first time it fires — an observable hook for any current
    /// or future face to show "no distance source" instead of a silently
    /// time-guided run. Never cleared mid-run (once true, the run stays
    /// degraded — flipping it back on a transient reconnect would be a lie).
    @Published private(set) var distanceSourceUnavailable = false

    /// Called by the engine the first time a distance phase falls back to
    /// its time estimate for lack of any real distance signal.
    func markDistanceSourceUnavailable() {
        guard !distanceSourceUnavailable else { return }
        distanceSourceUnavailable = true
    }

    // ── Running power (V5 Page 2) ──────────────────────────────────
    //
    // Watts, from HKQuantityType(.runningPower). OPTIONAL on purpose and
    // optional all the way to the board: running power needs an Apple Watch
    // that produces it and a run that lets it (it does not come off a
    // treadmill), so "no power" is an ordinary outcome, not a failure. The
    // design is explicit that an absent value DROPS THE SLOT — Page 2 becomes
    // a three-metric board — and never becomes a placeholder or a zero. That
    // only works if this is nil rather than 0, so it is nil.
    /// Current running power in watts. nil until a real sample lands, and nil
    /// again once samples stop (see `checkPowerStaleness`).
    @Published private(set) var powerWatts: Int?
    /// Whole-run aggregates, same shape as avgHr / avgCadence. Read BEFORE
    /// `end()` if a completion wants them; reset per run in `start()`.
    private var powSum = 0
    private var powCount = 0
    var avgPowerWatts: Int? { powCount > 0 ? Int((Double(powSum) / Double(powCount)).rounded()) : nil }
    /// Wall-clock time of the last real power sample; drives the staleness
    /// watchdog below.
    private var lastPowerSampleAt: Date?
    /// Power samples are more sporadic than HR, so a longer fuse than the
    /// 20 s used for the band.
    private static let powerStaleAfterSec: TimeInterval = 30

    /// Same argument as `checkHrStaleness()`, applied to power: HealthKit is
    /// event-driven, so a runner who steps onto a treadmill mid-run (or whose
    /// watch simply stops producing power) would otherwise keep a frozen
    /// wattage on Page 2 forever. Dropping back to nil makes the board do the
    /// thing the design asked for — lose the slot — instead of showing a
    /// number that stopped being true.
    ///
    /// Polled from `applyDeviceReading` (the device monitor's 2 s tick), NOT
    /// from the engine's 1 Hz clock: the monitor already runs for exactly the
    /// lifetime of a run, and this pass does not edit WorkoutEngine.
    private func checkPowerStaleness() {
        guard powerWatts != nil, let last = lastPowerSampleAt else { return }
        if Date.now.timeIntervalSince(last) >= Self.powerStaleAfterSec {
            powerWatts = nil
        }
    }

    // ── Device conditions (V5 `Low battery` / `Water lock` / Always-On) ──
    //
    // Everything here describes the WATCH, not the run. None of it may
    // influence recording: rule 8 says a flat battery, a locked screen and a
    // dark display all leave the run running. These are published for boards
    // to read and for nothing else.
    /// Battery 0…100, or nil when the device will not report a level. The
    /// `Low battery` board draws this because it is a real reading.
    @Published private(set) var batteryPercent: Int?
    /// Minutes of running the watch can still hold, MEASURED from this run's
    /// own drain — or nil. Never a constant. See `BatteryDrainEstimator`: it
    /// needs two observed battery-level transitions before it will answer, so
    /// nil is common, especially early. The board drops the clause; it does
    /// not guess.
    @Published private(set) var batteryProjectedMinutes: Int?
    /// True while watchOS water lock is engaged. Recording continues — this
    /// flag pauses nothing, ends nothing and gates no sensor. The board's job
    /// is to prove exactly that.
    @Published private(set) var isWaterLocked = false
    /// True while the display is in Always-On / wrist-down reduced luminance.
    /// Pushed in from SwiftUI via `.faffTracksLuminance(tracker)` — there is
    /// no imperative API for it (see `WatchLuminanceBridge`).
    @Published private(set) var isLuminanceReduced = false

    /// Set by the SwiftUI luminance bridge. Deliberately NOT reset in
    /// `start()`/`end()`: it describes the display, not the run.
    func setLuminanceReduced(_ reduced: Bool) {
        guard reduced != isLuminanceReduced else { return }
        isLuminanceReduced = reduced
    }

    /// Polls battery + water lock for the lifetime of a run. Lazy so the
    /// WKInterfaceDevice opt-in never happens for an app that never runs.
    private lazy var deviceMonitor: WatchDeviceMonitor = WatchDeviceMonitor { [weak self] reading in
        self?.applyDeviceReading(reading)
    }

    /// Republish only on change. The monitor ticks every 2 s; firing
    /// `objectWillChange` on every tick would re-render every bound face
    /// twice a minute for no new information.
    private func applyDeviceReading(_ reading: WatchDeviceMonitor.Reading) {
        if batteryPercent != reading.batteryPercent { batteryPercent = reading.batteryPercent }
        if batteryProjectedMinutes != reading.batteryProjectedMinutes {
            batteryProjectedMinutes = reading.batteryProjectedMinutes
        }
        if isWaterLocked != reading.isWaterLocked { isWaterLocked = reading.isWaterLocked }
        checkPowerStaleness()
    }

    private var mockTask: Task<Void, Never>?
    private var mockPaused = false
    /// The pace the simulator mock oscillates around (s/mi). The engine sets
    /// this to the current phase's target so the mock crosses the drift bands
    /// realistically for BOTH workouts and races (a race target of 8:46 vs a
    /// workout target of 6:31). Defaults to a threshold pace.
    var mockCenterPace = 391

    // ── Aggregates for the completion payload ─────────────────────
    private(set) var maxHr: Int = 0
    private var hrSum = 0
    private var hrCount = 0
    var avgHr: Int? { hrCount > 0 ? Int((Double(hrSum) / Double(hrCount)).rounded()) : nil }
    private var cadSum = 0
    private var cadCount = 0
    var avgCadence: Int? { cadCount > 0 ? Int((Double(cadSum) / Double(cadCount)).rounded()) : nil }
    /// EWMA-smoothed pace (s/mi) so the displayed number settles instead of
    /// bouncing frame-to-frame off raw speed samples.
    private var smoothedPaceSec: Double = 0

    // ── HR staleness watchdog (P2-53 · 2026-07-07) ─────────────────
    //
    // HealthKit is event-driven: apply(hr:) only runs when a NEW sample
    // lands. A loose/sweaty band that stops reading at minute 10 of a
    // 60-minute run used to leave `heartRate` frozen at its last live value
    // forever — every downstream consumer (the HR-ceiling alert in
    // WorkoutEngine.tick(), the per-tick phaseHrSum/phaseHrCount
    // accumulation that becomes completion.phases[].avgHr, every face's
    // "♥nnn" row) kept treating a 10-minute-stale reading as live. The
    // watchdog below is polled once a second from WorkoutEngine.tick()
    // (the engine already owns the only 1 Hz clock); it doesn't run its
    // own timer so it can never drift from the phase clock it's gating.
    /// Wall-clock time of the last sample with a real (>0) bpm value.
    /// nil before the first sample of the run ever lands.
    private var lastHrSampleAt: Date?
    /// A dropped-then-recovered band must not keep contributing a stale
    /// reading into hrSum/hrCount — see checkHrStaleness().
    private static let hrStaleAfterSec: TimeInterval = 20

    /// Poll for HR staleness — call once per second from the engine's tick.
    /// When no real sample has landed for `hrStaleAfterSec`, zero the
    /// PUBLISHED heartRate (every face already renders "♥—" / "—" at
    /// heartRate <= 0 — see ActiveWorkoutView's hrText helpers — so this is
    /// the ONE place that needs to change; no face edits required). The
    /// aggregate hrSum/hrCount are untouched here — they already stopped
    /// accumulating the moment apply(hr:) stopped being called with a real
    /// value, so avgHr is already honest; this only fixes the LIVE read.
    func checkHrStaleness() {
        guard heartRate > 0, let last = lastHrSampleAt else { return }
        if Date.now.timeIntervalSince(last) >= Self.hrStaleAfterSec {
            heartRate = 0
        }
    }

    var available: Bool { HKHealthStore.isHealthDataAvailable() }

    // MARK: - Authorization

    @discardableResult
    func requestAuthorization() async -> Bool {
        // In the simulator, the workout uses `startSimulatorMock()` and
        // never touches HealthKit. Skipping the auth prompt unblocks
        // automated sim drives (the HK consent sheet can't be clicked
        // reliably via simctl).
        #if targetEnvironment(simulator)
        return true
        #else
        guard available else { return false }
        // SHARE (write) set. The route MUST be here: HKWorkoutRouteBuilder
        // .finishRoute() silently fails to persist the GPS route without
        // write authorization for the workoutRoute series — which is why a
        // recorded run had no map even in Apple's own Workouts app. We also
        // write the workout itself and its sampled quantities.
        let share: Set<HKSampleType> = [
            HKQuantityType.workoutType(),
            HKSeriesType.workoutRoute(),
        ]
        let read: Set<HKObjectType> = [
            HKQuantityType(.heartRate),
            HKQuantityType(.distanceWalkingRunning),
            HKQuantityType(.activeEnergyBurned),
            HKQuantityType(.runningSpeed),   // device pace (treadmill + outdoor), not just GPS
            // Running power (watchOS 9+, deployment target here is 10.0 so no
            // availability guard is needed). Added to THIS set rather than a
            // second request — a second requestAuthorization call would put a
            // second consent sheet in front of the runner.
            HKQuantityType(.runningPower),
            HKObjectType.workoutType(),
            HKSeriesType.workoutRoute(),
        ]
        do {
            try await healthStore.requestAuthorization(toShare: share, read: read)
            return true
        } catch {
            return false
        }
        #endif
    }

    // MARK: - Lifecycle

    /// Freeze the published metrics to exact values (visual-regression
    /// fixtures — render a face with watch-app.html's canonical numbers).
    func setFixture(pace: Int, hr: Int, cadence: Int, distanceMi: Double) {
        self.paceSPerMi = pace; self.heartRate = hr; self.cadence = cadence; self.distanceMi = distanceMi
    }

    /// Configure CoreLocation for the route and bring updates online.
    ///
    /// The system location prompt must appear exactly ONCE, ever. We only
    /// call `requestWhenInUseAuthorization()` when the status is still
    /// `.notDetermined` (the very first run). On every later run the grant
    /// already persists, so we skip the request entirely and go straight to
    /// `startUpdatingLocation()` — that's what stops the "asks every launch"
    /// re-prompt. The first-run grant lands asynchronously, after start()
    /// has already returned; `locationManagerDidChangeAuthorization` then
    /// starts the updates once the user has answered.
    ///
    /// NOTE: do NOT set `allowsBackgroundLocationUpdates = true` here. On
    /// watchOS the active HKWorkoutSession (workout-processing) already keeps
    /// the app running, so CoreLocation keeps delivering route fixes during
    /// the run. Setting that flag requires the "location" background mode and
    /// otherwise throws an *uncatchable* NSException at runtime — which
    /// crashed the app on every Start. (It's an iOS-without-a-workout-session
    /// pattern, not needed on watchOS.)
    private func startLocationUpdates() {
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        locationManager.distanceFilter = 5
        switch locationManager.authorizationStatus {
        case .notDetermined:
            locationManager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            locationManager.startUpdatingLocation()
        default:
            break   // denied / restricted — run continues, route stays empty
        }
    }

    func start() {
        // Fresh per run — never carry distance / HR / cadence across
        // sessions (otherwise a second run starts with stale totals, e.g.
        // a race reading "0 to go / fuel done" before it begins).
        distanceMi = 0; paceSPerMi = 0; heartRate = 0; cadence = 0; activeEnergyKcal = 0
        maxHr = 0; hrSum = 0; hrCount = 0; cadSum = 0; cadCount = 0
        smoothedPaceSec = 0
        lastHrSampleAt = nil   // P2-53 · fresh watchdog per run
        distanceSourceUnavailable = false   // P2-56 · fresh per run
        // Power is fresh per run for the same reason distance is: a wattage
        // carried over from the last run reads as live on Page 2.
        powerWatts = nil; powSum = 0; powCount = 0; lastPowerSampleAt = nil
        mockPaused = false

        // Device conditions come online for the whole run — including in the
        // simulator, where they simply report whatever the sim reports (no
        // water lock, and whatever battery simctl is faking). Started BEFORE
        // the simulator early-return below so the state surface is identical
        // on both paths, and before the `available` guard so a watch that
        // cannot open an HKWorkoutSession still gets its battery board.
        deviceMonitor.start()

        #if targetEnvironment(simulator)
        startSimulatorMock(); return
        #endif
        guard available, session == nil else { return }
        let config = HKWorkoutConfiguration()
        config.activityType = .running
        config.locationType = .outdoor
        do {
            let s = try HKWorkoutSession(healthStore: healthStore, configuration: config)
            let b = s.associatedWorkoutBuilder()
            let ds = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: config)
            // Running power is NOT part of the default collection set for a
            // running configuration — it has to be asked for by name. Harmless
            // on a watch that cannot produce it or a runner who denied the
            // read: no samples land, `powerWatts` stays nil, and Page 2 draws
            // three metrics. Non-throwing, so it cannot break Start.
            ds.enableCollection(for: HKQuantityType(.runningPower), predicate: nil)
            b.dataSource = ds
            s.delegate = self
            b.delegate = self
            session = s
            builder = b
            routeBuilder = HKWorkoutRouteBuilder(healthStore: healthStore, device: nil)
            gpsCoords = []   // reset accumulator for the new run
            elevGainM = 0; lastAltitudeM = nil   // reset elevation accumulator

            // GPS route — requests auth only on the first ever run.
            startLocationUpdates()

            // Live cadence (steps/min) straight from CoreMotion.
            if CMPedometer.isCadenceAvailable() {
                pedometer.startUpdates(from: Date()) { [weak self] data, _ in
                    guard let self, let c = data?.currentCadence else { return }
                    let spm = Int((c.doubleValue * 60).rounded())   // steps/sec → steps/min
                    guard spm > 0, spm < 320 else { return }
                    Task { @MainActor in
                        self.cadence = spm; self.cadSum += spm; self.cadCount += 1
                    }
                }
            }

            // Bring up the audio session + chime engine BEFORE HK takes
            // over the workout-processing path. Activating an audio session
            // (.playback) DURING an active HKWorkoutSession raises an
            // uncatchable NSException on watchOS — that's the crash that
            // killed the user's run at mile 1. Doing it here, before
            // startActivity(), is the supported pattern: HK respects the
            // already-active session and coexists with it. No-op if audio
            // hardware refuses; chime() then degrades to haptic-only.
            //
            // P2-58 fix (2026-07-07) · UNCONDITIONAL, not gated on
            // audibleAlerts. The W-6 gate (activate only when Sound is
            // already ON at start) traded one bug for another: a runner who
            // starts muted and flips Sound ON mid-run at, say, mile 2 to
            // hear interval countdown beeps got the button UI change but
            // never heard a chime for the rest of the run — the audio
            // session was never brought up, and by that point an
            // HKWorkoutSession is already active, so calling activate()
            // from the Controls toggle handler would re-enter the exact
            // uncatchable-NSException crash this comment describes (that
            // crash fires on ANY activation attempt while HK is already
            // running, not specifically during startActivity — see
            // ChimePlayer.swift's own doc). The only safe place left to
            // activate is HERE, before HK takes over — every run gets audio
            // warmed up whether or not the runner starts muted. Muted
            // start already means no sound: activate() alone is SILENT
            // (only player.play() makes noise — see ChimePlayer's hot-path
            // doc), so this reintroduces no audible blip; it just means
            // Sound ON mid-run now actually works. W-6's original "battery
            // cost of a silent-running AVAudioEngine for the whole workout"
            // concern is the accepted trade for "the toggle isn't a dead
            // button" — re-verified per this fix's own instruction.
            ChimePlayer.shared.activate()

            let start = Date()
            s.startActivity(with: start)
            b.beginCollection(withStart: start) { _, _ in }
            isRecording = true
        } catch {
            // Tracking unavailable — the engine still guides the workout.
            session = nil
            builder = nil
        }
    }

    /// Pause the tracked session (stoplight / water stop). Live sampling
    /// and the route halt; resume() picks them back up.
    ///
    /// The device monitor deliberately keeps polling through a pause: the
    /// battery still drains while the runner stands at the lights, and a
    /// water lock engaged during a pause still needs its board.
    /// The runner answered "Drop GPS" on the battery board.
    ///
    /// This is a CHOICE the design offers, not a failure: the board names the
    /// cost in the same breath as the button ("GPS is most of that spend"), so
    /// the runner is not asked to work out that the pace read and the route
    /// are the same switch.
    ///
    /// What it does, honestly:
    ///  · Location updates stop. The route polyline ENDS HERE and resumes
    ///    never — the run keeps a partial track rather than a fabricated one.
    ///  · The run keeps recording. Distance continues from HealthKit's own
    ///    motion-derived source, which is less accurate and does not stop.
    ///  · Pace becomes untrusted, so nothing on a running face grades from
    ///    here on. The same posture as a treadmill, and for the same reason:
    ///    there is no trustworthy pace, so nothing may pose as one.
    ///
    /// Irreversible within the run, deliberately. Re-acquiring a fix would
    /// stitch a straight line across whatever was covered in between, which is
    /// the same defect that made a 2 mi out-and-back record as 0.00 mi.
    func dropGPS() {
        guard !gpsDropped else { return }
        gpsDropped = true
        locationManager.stopUpdatingLocation()
        // Marks pace as untrusted for the rest of the run — the running faces
        // read this exactly as they read a treadmill.
        markDistanceSourceUnavailable()
    }

    /// True once the runner has traded the route for battery. Sticky for the
    /// life of the run.
    @Published private(set) var gpsDropped = false

    func pause() {
        #if targetEnvironment(simulator)
        mockPaused = true; return
        #else
        session?.pause()
        locationManager.stopUpdatingLocation()
        #endif
    }

    func resume() {
        #if targetEnvironment(simulator)
        mockPaused = false; return
        #else
        session?.resume()
        locationManager.startUpdatingLocation()
        #endif
    }

    /// Stop the session and persist the HKWorkout + route to Health.
    /// Throw the run away. Nothing reaches Health, nothing is POSTed.
    ///
    /// The design gives "Discard it" no filled pill — it is text at 42% —
    /// precisely because this is irreversible, and until now it was ALSO
    /// dishonest: the discard path called `end()`, which finishes the builder
    /// and writes the HKWorkout to Health. A runner who threw a run away
    /// still found it in their activity rings.
    ///
    /// `discardWorkout()` is the HealthKit call that actually means discard.
    /// The session is ended first because a live session outliving its
    /// builder is how a run gets recovered on the next launch — which would
    /// resurrect exactly the run the runner just threw away.
    func discard() async {
        mockTask?.cancel(); mockTask = nil
        pedometer.stopUpdates()
        deviceMonitor.stop()
        batteryPercent = nil; batteryProjectedMinutes = nil; isWaterLocked = false
        locationManager.stopUpdatingLocation()
        guard let session, let builder else { isRecording = false; self.session = nil; self.builder = nil; return }
        let end = Date()
        session.stopActivity(with: end)
        session.end()
        do {
            try await builder.endCollection(at: end)
            try await builder.discardWorkout()
        } catch {
            // Best effort. A failure here leaves an orphaned builder, which
            // the next launch's recovery sweep will find and offer to save —
            // annoying, but it never invents data and never silently keeps
            // what the runner asked to be rid of.
        }
        isRecording = false
        self.session = nil
        self.builder = nil
        self.routeBuilder = nil
    }

    func end() async {
        mockTask?.cancel(); mockTask = nil
        pedometer.stopUpdates()
        // BEFORE the guard below — that guard returns early on the simulator
        // path and on a run that never opened a session, and the monitor is
        // started on both of those paths too. Stopping it here is the only
        // placement that always runs.
        deviceMonitor.stop()
        // Monitoring is off, so these are no longer things we know. Claiming
        // a water lock we can no longer observe would be the same class of
        // lie as a frozen heart rate.
        batteryPercent = nil; batteryProjectedMinutes = nil; isWaterLocked = false
        guard let session, let builder else { isRecording = false; return }
        locationManager.stopUpdatingLocation()
        let end = Date()
        session.stopActivity(with: end)
        session.end()
        do {
            try await builder.endCollection(at: end)
            let workout = try await builder.finishWorkout()
            if let workout, let routeBuilder {
                try? await routeBuilder.finishRoute(with: workout, metadata: nil)
            }
        } catch {
            // Best-effort save; metrics already surfaced live.
        }
        isRecording = false
        self.session = nil
        self.builder = nil
        self.routeBuilder = nil
        self.gpsCoords = []   // coords already consumed by buildCompletion; free memory
        self.elevGainM = 0; self.lastAltitudeM = nil   // elevation consumed too

        // Workout's over — tear down the audio session so the watch's
        // regular silent-mode behavior comes back when the user is just
        // looking at the summary or the home page.
        ChimePlayer.shared.deactivate()
    }

    // MARK: - Crash recovery (RK-3 · 2026-06-09)
    //
    // A watch crash / reboot mid-run used to be total loss: the HKWorkout
    // only persists in end(), and end() only runs from the engine's finish
    // path. HealthKit keeps the HKWorkoutSession alive system-side, though —
    // recoverActiveWorkoutSession hands it back on relaunch so the run can
    // be re-attached (RESUME) or closed out properly (END & SAVE). Two
    // documented mid-run crash classes exist in this file's comments; this
    // is the recovery net under both.

    /// Aggregate read of the recovered builder's statistics, for building a
    /// WatchCompletion without engine state. Read BEFORE end() tears the
    /// builder down.
    struct RecoveredStats {
        let distanceMi: Double?
        let avgHr: Int?
        let maxHr: Int?
        let kcal: Int?
        let elapsedSec: Int
        let startDate: Date?
    }

    /// Ask HealthKit for a session that outlived its process. nil when
    /// there's nothing to recover (the overwhelmingly common launch).
    /// Simulator always reports nil — the sim flow never opens a real
    /// HKWorkoutSession (startSimulatorMock instead).
    func recoverActiveSession() async -> HKWorkoutSession? {
        #if targetEnvironment(simulator)
        return nil
        #else
        guard available, session == nil, builder == nil else { return nil }
        return await withCheckedContinuation { (cont: CheckedContinuation<HKWorkoutSession?, Never>) in
            healthStore.recoverActiveWorkoutSession { s, _ in
                cont.resume(returning: s)
            }
        }
        #endif
    }

    /// Re-attach a recovered session so live metrics flow again and the
    /// existing end() path can persist the HKWorkout + route. Defensive by
    /// design: no force unwraps, every sub-step degrades gracefully — a
    /// crash loop in recovery is worse than no recovery.
    func adoptRecoveredSession(_ s: HKWorkoutSession) {
        guard session == nil else { return }
        let b = s.associatedWorkoutBuilder()
        s.delegate = self
        b.delegate = self
        // Recreate the live data source (Apple's documented recovery
        // pattern) so post-recovery samples keep landing in the builder.
        let ds = HKLiveWorkoutDataSource(healthStore: healthStore,
                                         workoutConfiguration: s.workoutConfiguration)
        // Same opt-in as start() — the recreated data source starts from
        // defaults, so power has to be re-enabled or Page 2 silently loses
        // its slot for the rest of a recovered run.
        ds.enableCollection(for: HKQuantityType(.runningPower), predicate: nil)
        b.dataSource = ds
        session = s
        builder = b
        // Fresh route builder — the pre-crash one (and its un-finished route
        // data) died with the old process. Post-recovery fixes still map.
        routeBuilder = HKWorkoutRouteBuilder(healthStore: healthStore, device: nil)
        gpsCoords = []
        elevGainM = 0; lastAltitudeM = nil

        // If the runner had paused at the moment of the crash, resume — the
        // recovered UI's elapsed/HR reads should be live either way.
        if s.state == .paused { s.resume() }

        // Restart collection. If the builder is already collecting (normal
        // for a recovered session) this completes with an error we ignore.
        b.beginCollection(withStart: Date()) { _, _ in }

        // GPS + cadence back online (same configuration as start()).
        startLocationUpdates()
        if CMPedometer.isCadenceAvailable() {
            pedometer.startUpdates(from: Date()) { [weak self] data, _ in
                guard let self, let c = data?.currentCadence else { return }
                let spm = Int((c.doubleValue * 60).rounded())
                guard spm > 0, spm < 320 else { return }
                Task { @MainActor in
                    self.cadence = spm; self.cadSum += spm; self.cadCount += 1
                }
            }
        }

        // DELIBERATELY no ChimePlayer.activate() here: activating an audio
        // session while an HKWorkoutSession is already running raises an
        // uncatchable NSException (the mile-1 crash — see start()). A
        // recovered run gets haptic-only cues; ChimePlayer.play() safely
        // no-ops while inactive.

        // Device conditions back online. The battery estimator starts a fresh
        // measurement window here, which is correct: the pre-crash window
        // died with the old process and there is no honest way to reconstruct
        // it. `batteryProjectedMinutes` therefore stays nil for a while after
        // a recovery — the right answer, not a regression.
        deviceMonitor.start()
        // Power is a live read, so a recovered run starts it empty and lets
        // the first post-recovery sample fill it. The aggregates are NOT
        // reset: on this path the engine's own accumulators are already
        // known to cover post-recovery time only (see recoveredStats()).
        powerWatts = nil
        lastPowerSampleAt = nil

        isRecording = true
        seedFromBuilderStatistics()
    }

    /// Prime the published metrics + aggregates from the recovered builder
    /// so the UI shows real numbers immediately instead of zeros until the
    /// next live sample lands.
    private func seedFromBuilderStatistics() {
        guard let builder else { return }
        let bpm = HKUnit.count().unitDivided(by: .minute())
        if let q = builder.statistics(for: HKQuantityType(.heartRate))?.mostRecentQuantity() {
            let hr = Int(q.doubleValue(for: bpm).rounded())
            if hr > 0 {
                heartRate = hr
                // P2-53 · start the staleness clock from the recovery moment,
                // not from whenever this historical sample was actually
                // recorded (pre-crash) — the seeded reading isn't provably
                // live, so treat "now" as its freshness baseline. If HK
                // doesn't resume delivering within hrStaleAfterSec, the
                // watchdog correctly zeroes it back out.
                lastHrSampleAt = .now
            }
        }
        if let q = builder.statistics(for: HKQuantityType(.heartRate))?.maximumQuantity() {
            maxHr = max(maxHr, Int(q.doubleValue(for: bpm).rounded()))
        }
        if let q = builder.statistics(for: HKQuantityType(.distanceWalkingRunning))?.sumQuantity() {
            distanceMi = q.doubleValue(for: .mile())
        }
        if let q = builder.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity() {
            activeEnergyKcal = Int(q.doubleValue(for: .kilocalorie()).rounded())
        }
    }

    /// Whole-run aggregates from the recovered builder, for the END & SAVE
    /// completion. Unlike the engine's per-tick accumulators (which only
    /// cover post-recovery time), these span the entire session.
    func recoveredStats() -> RecoveredStats {
        guard let builder else {
            return RecoveredStats(distanceMi: nil, avgHr: nil, maxHr: nil,
                                  kcal: nil, elapsedSec: 0, startDate: session?.startDate)
        }
        let bpm = HKUnit.count().unitDivided(by: .minute())
        let hrStats = builder.statistics(for: HKQuantityType(.heartRate))
        let avgHr = hrStats?.averageQuantity().map { Int($0.doubleValue(for: bpm).rounded()) }
        let maxHr = hrStats?.maximumQuantity().map { Int($0.doubleValue(for: bpm).rounded()) }
        let dist = builder.statistics(for: HKQuantityType(.distanceWalkingRunning))?
            .sumQuantity()?.doubleValue(for: .mile())
        let kcal = builder.statistics(for: HKQuantityType(.activeEnergyBurned))?
            .sumQuantity().map { Int($0.doubleValue(for: .kilocalorie()).rounded()) }
        return RecoveredStats(distanceMi: dist,
                              avgHr: avgHr,
                              maxHr: maxHr,
                              kcal: kcal,
                              elapsedSec: Int(builder.elapsedTime.rounded()),
                              startDate: session?.startDate)
    }

    /// Live elapsed seconds straight off the builder — drives the recovered
    /// screen's ticking clock (the engine isn't running yet at that point).
    var liveElapsedSec: Int { Int((builder?.elapsedTime ?? 0).rounded()) }

    /// End a recovered session and DISCARD its workout — the close-out a
    /// crashed TreadmillHRSession would have done itself (its HKWorkout is
    /// deliberately never saved; the iPhone's POST is canonical). Never used
    /// for outdoor runs.
    func endAndDiscardRecovered(_ s: HKWorkoutSession) async {
        let b = s.associatedWorkoutBuilder()
        let endAt = Date()
        s.stopActivity(with: endAt)
        s.end()
        do { try await b.endCollection(at: endAt) } catch { /* best effort */ }
        b.discardWorkout()
    }

    // MARK: - Apply samples (main actor)

    fileprivate func apply(hr: Int?, dist: Double?, energy: Int?, speedMps: Double? = nil,
                           powerW: Double? = nil) {
        if let hr, hr > 0 {
            heartRate = hr
            lastHrSampleAt = .now       // P2-53 · marks this reading live
            hrSum += hr
            hrCount += 1
            maxHr = max(maxHr, hr)
        }
        if let dist { distanceMi = dist }
        if let energy { activeEnergyKcal = energy }
        // Pace from HealthKit running speed ONLY (single source — the raw GPS
        // speed path used to also write paceSPerMi, and the two fought each
        // other every sample, which is what made the pace jitter). Clamp out
        // sensor spikes and EWMA-smooth so it settles. Cadence is CMPedometer.
        if let speedMps, speedMps > 0.2 {
            let raw = 1609.344 / speedMps                 // s/mi
            let clamped = min(max(raw, 150), 2400)        // 2:30…40:00 /mi sanity band
            smoothedPaceSec = smoothedPaceSec == 0 ? clamped : smoothedPaceSec * 0.7 + clamped * 0.3
            paceSPerMi = Int(smoothedPaceSec.rounded())
        }
        // Running power. Sanity-banded the same way pace is: a running human
        // is a low-hundreds-of-watts machine, so anything outside 20…2000 W
        // is a sensor artefact and is dropped rather than drawn. Out-of-band
        // samples do NOT refresh `lastPowerSampleAt`, so a sensor producing
        // only junk correctly ages out to nil instead of holding the slot.
        if let powerW, powerW >= 20, powerW <= 2000 {
            let w = Int(powerW.rounded())
            powerWatts = w
            lastPowerSampleAt = .now
            powSum += w
            powCount += 1
        }
    }

    fileprivate func applyLocations(_ locs: [CLLocation]) {
        // Route only — pace comes from HealthKit runningSpeed in apply(), NOT
        // from raw GPS speed here (having both write paceSPerMi made it jitter).
        routeBuilder?.insertRouteData(locs) { _, _ in }
        // Accumulate coordinates for the completion polyline that ships with
        // the watch completion payload.  Storing (lat, lng) only (~16 bytes
        // each) rather than full CLLocation objects keeps memory overhead
        // negligible for a 12+ mile run (~4000 pts at 5 m filter = ~64 KB).
        for loc in locs {
            gpsCoords.append((loc.coordinate.latitude, loc.coordinate.longitude))
            // Elevation GAIN from the barometer-fused altitude · sum positive
            // deltas only (net climb), and only when the vertical solution is
            // valid (verticalAccuracy >= 0; negative means altitude is junk).
            // CLLocation.altitude on Apple Watch fuses the barometric altimeter,
            // so this needs no separate CMAltimeter session.
            if loc.verticalAccuracy >= 0 {
                if let last = lastAltitudeM, loc.altitude - last > 0 {
                    elevGainM += loc.altitude - last
                }
                lastAltitudeM = loc.altitude
            }
        }
    }

    // MARK: - Simulator mock
    /// The watch simulator has no HealthKit/GPS data, so emit plausible
    /// live HR / pace / cadence (pace oscillates around ~6:31 so the
    /// drift zones — green/amber/red — are exercisable). Real metrics
    /// come from HKLiveWorkoutBuilder + GPS on a physical watch.
    private func startSimulatorMock() {
        guard mockTask == nil else { return }
        isRecording = true
        // Warp the mock the same way the engine's clock is warped, so a
        // distance-based phase (e.g. cruise warmup = 1.8 mi) completes
        // in proportional real time alongside time-based phases. Without
        // this the engine would auto-advance on distance at real-time
        // pace while time phases warp 30x — the run looks broken.
        let warp = WorkoutEngine.warpFactor
        mockTask = Task { @MainActor [weak self] in
            var t = 0.0
            while !Task.isCancelled {
                guard let self else { return }
                if self.mockPaused { try? await Task.sleep(for: .seconds(1)); continue }
                t += 1
                let drift = Int((sin(t / 7) * 18).rounded())
                self.paceSPerMi = self.mockCenterPace + drift
                self.heartRate = 164 + Int((sin(t / 11) * 6).rounded())
                self.cadence = 181 + Int((sin(t / 5) * 3).rounded())
                // Mock distance accumulates at ~0.0045 mi/sec at warp=1.
                // Scale up when warped so distance + time stay in sync.
                self.distanceMi += 0.0045 * warp
                self.hrSum += self.heartRate; self.hrCount += 1
                self.cadSum += self.cadence; self.cadCount += 1
                self.maxHr = max(self.maxHr, self.heartRate)
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }
}

// MARK: - HKLiveWorkoutBuilderDelegate

extension WorkoutTracker: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder,
                                    didCollectDataOf collectedTypes: Set<HKSampleType>) {
        let bpm = HKUnit.count().unitDivided(by: .minute())
        let mps = HKUnit.meter().unitDivided(by: .second())
        var hr: Int?
        var dist: Double?
        var energy: Int?
        var speed: Double?
        var power: Double?
        for type in collectedTypes {
            guard let qt = type as? HKQuantityType,
                  let stats = workoutBuilder.statistics(for: qt) else { continue }
            if qt == HKQuantityType(.heartRate) {
                if let q = stats.mostRecentQuantity() { hr = Int(q.doubleValue(for: bpm).rounded()) }
            } else if qt == HKQuantityType(.distanceWalkingRunning) {
                if let q = stats.sumQuantity() { dist = q.doubleValue(for: .mile()) }
            } else if qt == HKQuantityType(.activeEnergyBurned) {
                if let q = stats.sumQuantity() { energy = Int(q.doubleValue(for: .kilocalorie()).rounded()) }
            } else if qt == HKQuantityType(.runningSpeed) {
                if let q = stats.mostRecentQuantity() { speed = q.doubleValue(for: mps) }
            } else if qt == HKQuantityType(.runningPower) {
                if let q = stats.mostRecentQuantity() { power = q.doubleValue(for: .watt()) }
            }
        }
        // Capture by value — the loop is done mutating these, and capturing the
        // `var`s directly in the concurrent Task is a Swift 6 error.
        let hrV = hr, distV = dist, energyV = energy, speedV = speed, powerV = power
        Task { @MainActor in
            self.apply(hr: hrV, dist: distV, energy: energyV, speedMps: speedV, powerW: powerV)
        }
    }
}

// MARK: - HKWorkoutSessionDelegate

extension WorkoutTracker: HKWorkoutSessionDelegate {
    nonisolated func workoutSession(_ session: HKWorkoutSession,
                                    didChangeTo toState: HKWorkoutSessionState,
                                    from fromState: HKWorkoutSessionState,
                                    date: Date) {}
    nonisolated func workoutSession(_ session: HKWorkoutSession, didFailWithError error: Error) {}
}

// MARK: - CLLocationManagerDelegate

extension WorkoutTracker: CLLocationManagerDelegate {
    /// The first-run authorization grant arrives here asynchronously, after
    /// `start()` has already returned. Once the user has authorized, bring
    /// the route online — but only while a run is actually recording, so a
    /// late answer that lands after the workout ended doesn't spin location
    /// back up.
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        guard status == .authorizedWhenInUse || status == .authorizedAlways else { return }
        Task { @MainActor in
            guard self.isRecording else { return }
            manager.startUpdatingLocation()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        // Drop low-accuracy fixes before they enter the route.
        let good = locations.filter { $0.horizontalAccuracy >= 0 && $0.horizontalAccuracy <= 50 }
        guard !good.isEmpty else { return }
        Task { @MainActor in self.applyLocations(good) }
    }
}
