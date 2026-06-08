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

    func start() {
        // Fresh per run — never carry distance / HR / cadence across
        // sessions (otherwise a second run starts with stale totals, e.g.
        // a race reading "0 to go / fuel done" before it begins).
        distanceMi = 0; paceSPerMi = 0; heartRate = 0; cadence = 0; activeEnergyKcal = 0
        maxHr = 0; hrSum = 0; hrCount = 0; cadSum = 0; cadCount = 0
        smoothedPaceSec = 0
        mockPaused = false
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
            b.dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: config)
            s.delegate = self
            b.delegate = self
            session = s
            builder = b
            routeBuilder = HKWorkoutRouteBuilder(healthStore: healthStore, device: nil)
            gpsCoords = []   // reset accumulator for the new run
            elevGainM = 0; lastAltitudeM = nil   // reset elevation accumulator

            // GPS route
            locationManager.delegate = self
            locationManager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
            locationManager.distanceFilter = 5
            // NOTE: do NOT set `allowsBackgroundLocationUpdates = true` here. On
            // watchOS the active HKWorkoutSession (workout-processing) already
            // keeps the app running, so CoreLocation keeps delivering route
            // fixes during the run. Setting that flag requires the "location"
            // background mode and otherwise throws an *uncatchable* NSException
            // at runtime — which crashed the app on every Start. (It is an
            // iOS-without-a-workout-session pattern, not needed on watchOS.)
            locationManager.requestWhenInUseAuthorization()
            locationManager.startUpdatingLocation()

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
    func end() async {
        mockTask?.cancel(); mockTask = nil
        pedometer.stopUpdates()
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

    // MARK: - Apply samples (main actor)

    fileprivate func apply(hr: Int?, dist: Double?, energy: Int?, speedMps: Double? = nil) {
        if let hr, hr > 0 {
            heartRate = hr
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
            }
        }
        // Capture by value — the loop is done mutating these, and capturing the
        // `var`s directly in the concurrent Task is a Swift 6 error.
        let hrV = hr, distV = dist, energyV = energy, speedV = speed
        Task { @MainActor in self.apply(hr: hrV, dist: distV, energy: energyV, speedMps: speedV) }
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
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        // Drop low-accuracy fixes before they enter the route.
        let good = locations.filter { $0.horizontalAccuracy >= 0 && $0.horizontalAccuracy <= 50 }
        guard !good.isEmpty else { return }
        Task { @MainActor in self.applyLocations(good) }
    }
}
