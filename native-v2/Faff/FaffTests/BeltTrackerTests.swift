//
//  BeltTrackerTests.swift
//  The belt's distance must follow the belt's speed.
//
//  David, 2026-08-21, on a treadmill run that recorded short:
//    "I did change it on the app. so it didnt read it or store it."
//
//  Two separate things have to hold for that never to happen again, and only
//  one of them lives in this file:
//
//    1 · the MODEL integrates whatever speed it is handed, per tick  ← here
//    2 · the VIEW hands it the speed the runner just set             ← on device
//
//  Part 2 is what actually broke: the clock lived in a `.background(
//  TimelineView)` subtree whose closure could capture a stale `self`, so the
//  integrator kept running at the speed the run started at. It is now
//  `.onReceive` on the main body, which re-registers on every state change.
//  That one is verified by driving the console, not by a unit test — SwiftUI
//  state is not reachable from here, and pretending otherwise would be a test
//  that proves nothing.
//
//  What this file pins is part 1, and the arithmetic of David's own run.
//

import XCTest
@testable import Faff

final class BeltTrackerTests: XCTestCase {

    /// Drive a tracker second by second, changing the belt part-way.
    private func run(_ plan: [(seconds: Int, mph: Double)], inclinePct: Double = 0) -> BeltTracker {
        var belt = BeltTracker()
        var t = Date(timeIntervalSince1970: 1_700_000_000)
        belt.resync(to: t)
        for leg in plan {
            for _ in 0..<leg.seconds {
                t = t.addingTimeInterval(1)
                belt.advance(to: t, speedMph: leg.mph, inclinePct: inclinePct, bpm: nil)
            }
        }
        return belt
    }

    /// The whole point. Half at 6.0, half at 9.0 must land on 7.5's distance —
    /// NOT on the speed it started at, and NOT on the speed it finished at.
    func testDistanceFollowsAMidRunSpeedChange() {
        let belt = run([(seconds: 600, mph: 6.0), (seconds: 600, mph: 9.0)])

        let expected = (600.0 / 3600.0) * 6.0 + (600.0 / 3600.0) * 9.0   // 2.50
        XCTAssertEqual(belt.distanceMi, expected, accuracy: 1e-9)

        // The two ways this has actually been got wrong, both excluded.
        let ifStuckAtStart = (1200.0 / 3600.0) * 6.0                      // 2.00
        let ifRecomputedAtEnd = (1200.0 / 3600.0) * 9.0                   // 3.00
        XCTAssertNotEqual(belt.distanceMi, ifStuckAtStart, accuracy: 0.01)
        XCTAssertNotEqual(belt.distanceMi, ifRecomputedAtEnd, accuracy: 0.01)
    }

    /// Raising the belt has to raise the RATE, not just the total. A runner
    /// who speeds up and watches the distance crawl at the old rate is
    /// looking at the bug David hit.
    func testRaisingTheBeltRaisesTheRate() {
        let slow = run([(seconds: 60, mph: 3.0)]).distanceMi
        let fast = run([(seconds: 60, mph: 12.0)]).distanceMi
        XCTAssertEqual(fast / slow, 4.0, accuracy: 1e-9)
    }

    /// Dropping the belt to a walk must nearly stop the accumulation. This is
    /// the on-device test written down: 60s at 12.0 then 60s at 1.0 adds a
    /// twelfth of what the first minute did, and a stale integrator would add
    /// the same again.
    func testDroppingTheBeltNearlyStopsTheDistance() {
        let belt = run([(seconds: 60, mph: 12.0), (seconds: 60, mph: 1.0)])
        let firstMinute = (60.0 / 3600.0) * 12.0                          // 0.2000
        let secondMinute = (60.0 / 3600.0) * 1.0                          // 0.0167
        XCTAssertEqual(belt.distanceMi, firstMinute + secondMinute, accuracy: 1e-9)
        XCTAssertLessThan(belt.distanceMi, firstMinute * 1.1)
    }

    /// Elevation rides on the same per-tick distance, so it has to follow a
    /// speed change too — climbing faster when the belt is faster at a fixed
    /// grade. This is what made David's stored 225 ft (not 224) evidence that
    /// his speed had moved at all.
    func testElevationFollowsTheSameIntegral() {
        let belt = run([(seconds: 600, mph: 6.0), (seconds: 600, mph: 9.0)], inclinePct: 1.0)
        let expectedMi = (600.0 / 3600.0) * 6.0 + (600.0 / 3600.0) * 9.0
        XCTAssertEqual(belt.elevGainFt, expectedMi * 5280.0 * 0.01, accuracy: 1e-6)
    }

    /// A constant 6.8 mph for 2250 s is exactly 4.25 mi and 224 ft. David's
    /// stored row holds 4.26 and 225 — which is how we knew the belt had in
    /// fact moved, and that the app had registered a little of it.
    func testDavidsRunReproducesAtConstantSpeed() {
        let belt = run([(seconds: 2250, mph: 6.8)], inclinePct: 1.0)
        XCTAssertEqual((belt.distanceMi * 100).rounded() / 100, 4.25, accuracy: 1e-9)
        XCTAssertEqual(belt.elevGainFt.rounded(), 224, accuracy: 1e-9)
    }

    /// Sub-second ticks must accumulate rather than being discarded. The old
    /// tick truncated to whole seconds and advanced its anchor anyway, so a
    /// fast clock threw the remainder away every time.
    func testSubSecondTicksAreNotDiscarded() {
        var belt = BeltTracker()
        var t = Date(timeIntervalSince1970: 1_700_000_000)
        belt.resync(to: t)
        for _ in 0..<3600 {                       // 3600 × 0.25s = 900s
            t = t.addingTimeInterval(0.25)
            belt.advance(to: t, speedMph: 8.0, inclinePct: 0, bpm: nil)
        }
        XCTAssertEqual(belt.elapsedSec, 900, accuracy: 1e-6)
        XCTAssertEqual(belt.distanceMi, (900.0 / 3600.0) * 8.0, accuracy: 1e-9)
    }
}
