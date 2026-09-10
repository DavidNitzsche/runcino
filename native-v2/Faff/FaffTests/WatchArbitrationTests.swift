//
//  WatchArbitrationTests.swift
//  FaffTests
//
//  ARB-1 (2026-09-09) · DUPLICATE-1's cross-device recording-lock mechanism
//  (`WatchSync.watchActiveWorkoutIsCurrent`, native-v2/Faff/Faff/WatchSync.swift)
//  shipped 2026-09-03 with the phone-side refusal wired into `HostsV5.swift`
//  and the watch-side refusal wired into `WorkoutRootView.swift`, but zero
//  test file anywhere in the repo referenced it — Rule 15's shape exactly:
//  "wired, tested and inert" would at least have SOME test; this had none.
//
//  These tests exercise the two pure functions the phone side of the
//  handshake actually decides on: is a remembered watch session still
//  "current" (`isActiveWorkoutCurrent`), and does a raw applicationContext
//  payload parse into the right id/timestamp (`parseActiveWorkout`). Both
//  were extracted from `watchActiveWorkoutIsCurrent` / the WCSessionDelegate
//  callback specifically so they could be exercised here without a live
//  WCSession or a paired device — the same "pure, directly testable" shape
//  `PhoneRunTracker.resolveStartWorkoutId` already uses for Decision 1.
//
//  Falsified against a deliberately broken comparison before landing (flip
//  `<=` to `<` and the boundary test fails; invert the nil-guard and the
//  "no watch session" test fails) — Rule 18.
//

import XCTest
@testable import Faff

final class WatchArbitrationStalenessTests: XCTestCase {
    @MainActor
    func test_noWatchSessionIsNeverCurrent() {
        XCTAssertFalse(WatchSync.isActiveWorkoutCurrent(id: nil, stampedAt: Date()))
    }

    @MainActor
    func test_idWithNoTimestampIsNeverCurrent() {
        // Malformed payload (id present, stamp absent) must not be read as
        // "active forever" — Rule 11: absence is its own fact.
        XCTAssertFalse(WatchSync.isActiveWorkoutCurrent(id: "w1", stampedAt: nil))
    }

    @MainActor
    func test_freshWatchSessionIsCurrent() {
        let now = Date()
        let startedASecondAgo = now.addingTimeInterval(-1)
        XCTAssertTrue(WatchSync.isActiveWorkoutCurrent(id: "w1", stampedAt: startedASecondAgo, now: now, staleAfter: 6 * 60 * 60))
    }

    @MainActor
    func test_thisIsTheGuardAConcurrentStartActuallyHits() {
        // The exact scenario item 11 is about: the watch is mid-run right
        // now (started two minutes ago) and the runner also opens the phone
        // Run tab. `HostsV5.swift` reads exactly this call before ever
        // calling `tracker.start()` — if this returns true, the phone must
        // refuse instead of recording a second, independent activity.
        let now = Date()
        let watchStartedAt = now.addingTimeInterval(-120)
        XCTAssertTrue(WatchSync.isActiveWorkoutCurrent(id: "u1-2026-09-09", stampedAt: watchStartedAt, now: now))
    }

    @MainActor
    func test_staleFlagDoesNotBlockForever() {
        // The watch crashed mid-run and never cleared its flag. Six hours
        // and one second later the phone must be free to start — this is
        // the safety-valve half of the mechanism, not the primary one.
        let now = Date()
        let sixHoursOneSecondAgo = now.addingTimeInterval(-(6 * 60 * 60 + 1))
        XCTAssertFalse(WatchSync.isActiveWorkoutCurrent(id: "w1", stampedAt: sixHoursOneSecondAgo, now: now, staleAfter: 6 * 60 * 60))
    }

    @MainActor
    func test_exactlyAtTheStaleBoundaryStillCounts() {
        // `<=`, not `<` — the boundary itself is still "current." A prior
        // draft of this comparison used `<` and this is the test that would
        // have caught it.
        let now = Date()
        let exactlySixHoursAgo = now.addingTimeInterval(-(6 * 60 * 60))
        XCTAssertTrue(WatchSync.isActiveWorkoutCurrent(id: "w1", stampedAt: exactlySixHoursAgo, now: now, staleAfter: 6 * 60 * 60))
    }
}

final class WatchArbitrationParseTests: XCTestCase {
    func test_parsesIdAndTimestampFromALiveContext() {
        let ref = Date(timeIntervalSinceReferenceDate: 800_000)
        let ctx: [String: Any] = [
            "activeWorkoutId": "u1-2026-09-09",
            "activeWorkoutStartedAt": ref.timeIntervalSinceReferenceDate,
        ]
        let (id, stampedAt) = WatchSync.parseActiveWorkout(from: ctx)
        XCTAssertEqual(id, "u1-2026-09-09")
        XCTAssertEqual(stampedAt, ref)
    }

    func test_missingKeyIsReadAsAbsentNotAsUnchanged() {
        // WatchConnectivity's own contract: applicationContext always
        // carries the FULL state, never a diff. A context with no
        // `activeWorkoutId` key must parse as "no active workout," not be
        // skipped as "nothing to update."
        let (id, stampedAt) = WatchSync.parseActiveWorkout(from: [:])
        XCTAssertNil(id)
        XCTAssertNil(stampedAt)
    }

    func test_idWithoutATimestampKeyStillParsesTheId() {
        // The caller (`applyWatchActiveWorkout`) is what stamps "now" for a
        // malformed id-only payload — the parse layer itself just reports
        // what it found.
        let (id, stampedAt) = WatchSync.parseActiveWorkout(from: ["activeWorkoutId": "w1"])
        XCTAssertEqual(id, "w1")
        XCTAssertNil(stampedAt)
    }

    func test_wrongTypedValuesAreTreatedAsAbsent() {
        // A payload carrying garbage for these keys (a bug somewhere
        // upstream) must not crash the parse or coerce into some other id.
        let (id, stampedAt) = WatchSync.parseActiveWorkout(from: [
            "activeWorkoutId": 42,
            "activeWorkoutStartedAt": "not-a-number",
        ])
        XCTAssertNil(id)
        XCTAssertNil(stampedAt)
    }
}
