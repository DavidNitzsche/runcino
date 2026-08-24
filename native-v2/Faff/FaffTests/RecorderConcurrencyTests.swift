//
//  RecorderConcurrencyTests.swift
//  Drives the three recorders' sensor-callback paths from the contexts the
//  sensors actually use, so Thread Sanitizer has something to look at.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHY THESE TESTS EXIST IN THIS SHAPE
//
//  The iPhone target builds at `SWIFT_STRICT_CONCURRENCY: minimal`, so the
//  compiler is not checking any of this. The recorders run for 30-120 minutes
//  while CoreLocation, HealthKit and WatchConnectivity call back on their own
//  queues, and the only thing keeping those callbacks off the published state
//  is a hand-written hop that nothing verifies.
//
//  So: call the delegate entry points from a BACKGROUND queue — which is
//  where CoreLocation delivers — while the main actor reads the published
//  properties, at a rate far above a real receiver's. Under
//  `-enableThreadSanitizer YES` an unsynchronised access shows up as a report
//  rather than as a wrong number on a run six weeks from now.
//
//  These assert little. They are an exercise harness; the sanitizer is the
//  assertion.
//

import XCTest
import CoreLocation
@testable import Faff

final class RecorderConcurrencyTests: XCTestCase {

    // Every request this class can make is intercepted and failed.
    //
    // `test_overlappingDurableSaves` used to register nothing, on the written
    // assumption that "every POST fails at the network layer, which is the
    // offline case." That assumption held only on a machine with no route to
    // faff.run. On a developer Mac it does not: the simulator carries a real
    // Keychain session, the POSTs SUCCEED, and the eight synthetic
    // `phone_conc_*` completions land in the PRODUCTION runs table under the
    // signed-in runner. That happened on 2026-08-21 — eight phantom 2 mi runs
    // on a real training day, which then outvoted that day's actual 9.14 mi
    // run for the week strip's tap target.
    //
    // `TestStubProtocol.canInit` returns true for every request and, with no
    // responder set, fails it. So the offline case is now actually offline,
    // and no test in this file can reach a live backend regardless of what a
    // future test adds.
    override func setUp() async throws {
        try await super.setUp()
        URLProtocol.registerClass(TestStubProtocol.self)
        SignInFlowTests.responder = nil
    }

    override func tearDown() async throws {
        URLProtocol.unregisterClass(TestStubProtocol.self)
        SignInFlowTests.responder = nil
        try await super.tearDown()
    }

    /// `didUpdateLocations` is `nonisolated` and CoreLocation calls it on the
    /// queue the manager was created on — not the main actor. It hops via
    /// `Task { @MainActor }`. This hammers that hop from a background queue
    /// while the main actor reads the published state the hop writes.
    func test_locationCallbacksFromBackgroundQueue_whileMainActorReads() async {
        let tracker = await PhoneRunTracker()
        let manager = CLLocationManager()

        let base = CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194)
        let deliveries = 400

        let sensor = DispatchQueue(label: "test.gps", qos: .userInitiated)
        let done = expectation(description: "fixes delivered")

        sensor.async {
            for i in 0..<deliveries {
                let loc = CLLocation(
                    coordinate: CLLocationCoordinate2D(latitude: base.latitude + Double(i) * 0.00003,
                                                       longitude: base.longitude),
                    altitude: 10,
                    horizontalAccuracy: 5,
                    verticalAccuracy: 5,
                    course: 0,
                    speed: 3.0,
                    timestamp: Date().addingTimeInterval(Double(i) * 0.01)
                )
                tracker.locationManager(manager, didUpdateLocations: [loc])
            }
            // Authorization changes arrive on the same queue and touch the
            // same published properties from the same hop.
            tracker.locationManagerDidChangeAuthorization(manager)
            done.fulfill()
        }

        // Read the published state from the main actor throughout, so the
        // sanitizer sees both sides of every access.
        for _ in 0..<400 {
            _ = await MainActor.run {
                (tracker.distanceMi, tracker.elapsedSec, tracker.routeCoords.count,
                 tracker.hasFirstFix, tracker.trackHasGap, tracker.currentPaceSecPerMi)
            }
            await Task.yield()
        }

        await fulfillment(of: [done], timeout: 20)
        // Drain the hops the deliveries queued.
        try? await Task.sleep(nanoseconds: 300_000_000)
    }

    /// `saveCompletionDurably` is reachable from three consoles at once and
    /// its drain releases the main actor on every POST. Fire overlapping
    /// saves so the sanitizer sees the UserDefaults-backed queue accessed
    /// from concurrent tasks.
    @MainActor
    func test_overlappingDurableSaves() async {
        let key = "faff.watch.pendingCompletions.v2"
        UserDefaults.standard.set([Data](), forKey: key)
        WatchSync.shared.resetDrainStateForTesting()
        defer {
            UserDefaults.standard.set([Data](), forKey: key)
            WatchSync.shared.resetDrainStateForTesting()
        }

        func payload(_ i: Int) -> Data {
            try! JSONSerialization.data(withJSONObject: [
                "workoutId": "phone_conc_\(i)",
                "startedAt": "2026-08-21T15:00:00Z",
                "completedAt": "2026-08-21T15:25:00Z",
                "status": "completed",
                "totalDistanceMi": 2.0,
                "totalDurationSec": 900,
                "source": "phone",
            ])
        }

        // Every POST fails at the network layer — the class-level
        // `TestStubProtocol` refuses all of them (see setUp) — which is the
        // offline case, and the queue must still hold every payload
        // afterwards.
        await withTaskGroup(of: Void.self) { group in
            for i in 0..<8 {
                group.addTask { @MainActor in
                    _ = await WatchSync.shared.saveCompletionDurably(payload(i))
                }
            }
        }

        let q = (UserDefaults.standard.array(forKey: key) as? [Data]) ?? []
        XCTAssertEqual(q.count, 8,
                       "Eight overlapping durable saves must leave eight runs on disk. "
                       + "A short count is a completion destroyed by a concurrent drain.")
    }
}
