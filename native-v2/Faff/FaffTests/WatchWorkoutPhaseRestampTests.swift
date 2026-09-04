//
//  WatchWorkoutPhaseRestampTests.swift
//  faff.run iPhone · PACESHAPE-1 (2026-09-03) — the re-stamp drops fields silently.
//
//  `WatchWorkout.init(from:)` decodes `[WatchPhase]` once (correctly reading
//  every field), then re-builds each phase through the memberwise init JUST
//  to stamp its cursor `index` — and that second construction had its own,
//  separately-maintained list of which fields to carry forward. `hrRole`
//  (HR-ROLE-1) and `treadmillInclinePct`/`treadmillSpeedMph`
//  (TREADMILL-HILL-1) were both added to `WatchPhase` and both silently
//  dropped right here, because nobody updated this second list when they
//  were added to the first.
//
//  This is exactly the kind of gap unit tests that construct `WatchPhase`
//  directly (every other test file in this target) cannot see — they never
//  go through `WatchWorkout`'s own JSON decoder at all. Only a real
//  end-to-end decode test, against the real wire shape, can catch it — Rule
//  15: a mechanism no test can reach is untested however many other cases
//  pass. This file decodes a real payload (the exact shape curled from
//  production during this session's verification) and asserts every
//  optional phase field survives.
//
import XCTest
@testable import Faff

final class WatchWorkoutPhaseRestampTests: XCTestCase {

    /// The real wire shape for today's hills workout, captured during this
    /// session's Rule 13 verification — a warm-up (`.ceiling` pace shape,
    /// a real tolerance band) and a hill work rep (`treadmillSpeedMph`/
    /// `treadmillInclinePct`, `hrRole: observational`, `paceShape: none`).
    private static let realHillsWorkoutJSON = """
    {
      "workoutId": "wko_test123",
      "name": "10\\u00d760s hills @ 5K-10K effort",
      "summary": "Hills",
      "totalEstimatedMinutes": 50,
      "completionEndpoint": "/api/watch/workouts/complete",
      "expiresAt": "2099-01-01T00:00:00Z",
      "phases": [
        {
          "type": "warmup",
          "label": "Warm-up",
          "durationSec": 783,
          "targetPaceSPerMi": 502,
          "tolerancePaceSPerMi": 30,
          "paceShape": "ceiling",
          "haptic": "start",
          "repUnit": "distance",
          "distanceMi": 1.5
        },
        {
          "type": "work",
          "label": "Hill 1 of 10 \\u00b7 1 min",
          "durationSec": 60,
          "targetPaceSPerMi": null,
          "tolerancePaceSPerMi": null,
          "paceShape": "none",
          "haptic": "transition-work",
          "repUnit": "time",
          "hrTargetBpm": 176,
          "hrRole": "observational",
          "treadmillInclinePct": 5,
          "treadmillSpeedMph": 7.7
        }
      ]
    }
    """

    private func decode() throws -> WatchWorkout {
        try JSONDecoder().decode(WatchWorkout.self, from: Data(Self.realHillsWorkoutJSON.utf8))
    }

    func test_warmupPhaseKeepsItsPaceShapeThroughTheReStamp() throws {
        let w = try decode()
        let warmup = try XCTUnwrap(w.phases.first { $0.type == .warmup })
        XCTAssertEqual(warmup.paceShape, .ceiling,
                        "the re-stamp must not drop paceShape — a ceiling phase decoding as nil (defaulting to .window) is exactly PACESHAPE-1's own bug rendering live")
    }

    func test_hillRepKeepsItsTreadmillFieldsThroughTheReStamp() throws {
        let w = try decode()
        let hill = try XCTUnwrap(w.phases.first { $0.type == .work })
        XCTAssertEqual(hill.treadmillSpeedMph, 7.7,
                        "TREADMILL-HILL-2's fix reads this field — dropped here, it silently falls back to the flat 7.0 mph guess on every real device")
        XCTAssertEqual(hill.treadmillInclinePct, 5)
    }

    func test_hillRepKeepsItsHrRoleThroughTheReStamp() throws {
        let w = try decode()
        let hill = try XCTUnwrap(w.phases.first { $0.type == .work })
        // This one is the dangerous case BECAUSE its wrong answer looks
        // right: `effectiveHrRole` defaults dropped-to-nil to
        // `.observational`, which happens to match this hill rep's real
        // value — so this specific assertion could pass even with the bug
        // present. It is here as a DIRECT field check (not through
        // `effectiveHrRole`) so it does not share that blind spot.
        XCTAssertEqual(hill.hrRole, .observational)
    }

    /// The actual regression this file exists to prevent recurring: every
    /// field the memberwise init accepts must survive one full decode
    /// round-trip, not just the ones a hand-picked case happens to need.
    func test_noOptionalPhaseFieldIsLostBetweenTheRawDecodeAndTheReStampedWorkout() throws {
        let w = try decode()
        for phase in w.phases {
            // index/type/label/durationSec are non-optional and already
            // proven correct by decoding at all. Everything below is what
            // the re-stamp's own field list controls.
            if phase.type == .warmup {
                XCTAssertNotNil(phase.paceShape, "warmup phase lost paceShape in the re-stamp")
                XCTAssertNotNil(phase.targetPaceSPerMi, "warmup phase lost targetPaceSPerMi in the re-stamp")
                XCTAssertNotNil(phase.tolerancePaceSPerMi, "warmup phase lost tolerancePaceSPerMi in the re-stamp")
            }
            if phase.type == .work {
                XCTAssertNotNil(phase.hrRole, "work phase lost hrRole in the re-stamp")
                XCTAssertNotNil(phase.treadmillSpeedMph, "work phase lost treadmillSpeedMph in the re-stamp")
                XCTAssertNotNil(phase.treadmillInclinePct, "work phase lost treadmillInclinePct in the re-stamp")
                XCTAssertNotNil(phase.hrTargetBpm, "work phase lost hrTargetBpm in the re-stamp")
            }
        }
    }
}
