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

@MainActor
final class WorkoutTracker: NSObject, ObservableObject {

    private let healthStore = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var routeBuilder: HKWorkoutRouteBuilder?
    private let locationManager = CLLocationManager()

    // ── Live metrics (views + PaceDrift bind to these) ────────────
    @Published private(set) var heartRate: Int = 0       // current bpm
    @Published private(set) var distanceMi: Double = 0   // cumulative
    @Published private(set) var paceSPerMi: Int = 0      // instantaneous (GPS)
    @Published private(set) var activeEnergyKcal: Int = 0
    @Published private(set) var isRecording = false

    // ── Aggregates for the completion payload ─────────────────────
    private(set) var maxHr: Int = 0
    private var hrSum = 0
    private var hrCount = 0
    var avgHr: Int? { hrCount > 0 ? Int((Double(hrSum) / Double(hrCount)).rounded()) : nil }

    var available: Bool { HKHealthStore.isHealthDataAvailable() }

    // MARK: - Authorization

    @discardableResult
    func requestAuthorization() async -> Bool {
        guard available else { return false }
        let share: Set<HKSampleType> = [HKQuantityType.workoutType()]
        let read: Set<HKObjectType> = [
            HKQuantityType(.heartRate),
            HKQuantityType(.distanceWalkingRunning),
            HKQuantityType(.activeEnergyBurned),
            HKObjectType.workoutType(),
            HKSeriesType.workoutRoute(),
        ]
        do {
            try await healthStore.requestAuthorization(toShare: share, read: read)
            return true
        } catch {
            return false
        }
    }

    // MARK: - Lifecycle

    func start() {
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

            // GPS route
            locationManager.delegate = self
            locationManager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
            locationManager.distanceFilter = 5
            locationManager.allowsBackgroundLocationUpdates = true
            locationManager.requestWhenInUseAuthorization()
            locationManager.startUpdatingLocation()

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

    /// Stop the session and persist the HKWorkout + route to Health.
    func end() async {
        guard let session, let builder else { return }
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
    }

    // MARK: - Apply samples (main actor)

    fileprivate func apply(hr: Int?, dist: Double?, energy: Int?) {
        if let hr, hr > 0 {
            heartRate = hr
            hrSum += hr
            hrCount += 1
            maxHr = max(maxHr, hr)
        }
        if let dist { distanceMi = dist }
        if let energy { activeEnergyKcal = energy }
    }

    fileprivate func applyLocations(_ locs: [CLLocation]) {
        routeBuilder?.insertRouteData(locs) { _, _ in }
        if let last = locs.last, last.speed > 0 {
            paceSPerMi = Int((1609.344 / last.speed).rounded())
        }
    }
}

// MARK: - HKLiveWorkoutBuilderDelegate

extension WorkoutTracker: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder,
                                    didCollectDataOf collectedTypes: Set<HKSampleType>) {
        let bpm = HKUnit.count().unitDivided(by: .minute())
        var hr: Int?
        var dist: Double?
        var energy: Int?
        for type in collectedTypes {
            guard let qt = type as? HKQuantityType,
                  let stats = workoutBuilder.statistics(for: qt) else { continue }
            if qt == HKQuantityType(.heartRate) {
                if let q = stats.mostRecentQuantity() { hr = Int(q.doubleValue(for: bpm).rounded()) }
            } else if qt == HKQuantityType(.distanceWalkingRunning) {
                if let q = stats.sumQuantity() { dist = q.doubleValue(for: .mile()) }
            } else if qt == HKQuantityType(.activeEnergyBurned) {
                if let q = stats.sumQuantity() { energy = Int(q.doubleValue(for: .kilocalorie()).rounded()) }
            }
        }
        Task { @MainActor in self.apply(hr: hr, dist: dist, energy: energy) }
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
