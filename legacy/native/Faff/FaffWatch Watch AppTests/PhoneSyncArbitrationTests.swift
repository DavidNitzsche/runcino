//
//  PhoneSyncArbitrationTests.swift
//  FaffWatch Watch AppTests
//
//  ARB-1 (2026-09-09) · the watch-side half of DUPLICATE-1's cross-device
//  recording lock (`PhoneSync.phoneActiveWorkoutIsCurrent`, refused in
//  `WorkoutRootView.launch`) shipped 2026-09-03 with zero test coverage —
//  see `WatchArbitrationTests.swift` (FaffTests, phone side) for the mirror
//  image and the full rationale. Both pure functions exercised here were
//  extracted specifically so they are testable without a live WCSession or
//  a paired iPhone.
//
//  Falsified against a deliberately broken comparison before landing.
//

import Testing
import Foundation
@testable import FaffWatch_Watch_App

struct PhoneSyncArbitrationStalenessTests {
    @MainActor @Test func noPhoneSessionIsNeverCurrent() {
        #expect(PhoneSync.isActiveWorkoutCurrent(id: nil, stampedAt: Date()) == false)
    }

    @MainActor @Test func idWithNoTimestampIsNeverCurrent() {
        #expect(PhoneSync.isActiveWorkoutCurrent(id: "p1", stampedAt: nil) == false)
    }

    @MainActor @Test func thisIsTheGuardAConcurrentStartActuallyHits() {
        // Item 11's scenario, mirrored: the phone is mid-run right now and
        // the runner also taps Start on the watch face. `WorkoutRootView
        // .launch` reads exactly this before ever building a `WorkoutEngine`
        // — if this returns true, the watch must refuse (`blockedByPhone`)
        // instead of opening a second HKWorkoutSession for the same run.
        let now = Date()
        let phoneStartedAt = now.addingTimeInterval(-45)
        #expect(PhoneSync.isActiveWorkoutCurrent(id: "phone-run", stampedAt: phoneStartedAt, now: now) == true)
    }

    @MainActor @Test func staleFlagDoesNotBlockForever() {
        let now = Date()
        let sixHoursOneSecondAgo = now.addingTimeInterval(-(6 * 60 * 60 + 1))
        #expect(PhoneSync.isActiveWorkoutCurrent(id: "p1", stampedAt: sixHoursOneSecondAgo, now: now, staleAfter: 6 * 60 * 60) == false)
    }

    @MainActor @Test func exactlyAtTheStaleBoundaryStillCounts() {
        let now = Date()
        let exactlySixHoursAgo = now.addingTimeInterval(-(6 * 60 * 60))
        #expect(PhoneSync.isActiveWorkoutCurrent(id: "p1", stampedAt: exactlySixHoursAgo, now: now, staleAfter: 6 * 60 * 60) == true)
    }
}

struct PhoneSyncArbitrationParseTests {
    @MainActor @Test func parsesIdAndTimestampFromALivePayload() {
        let ref = Date(timeIntervalSinceReferenceDate: 900_000)
        let payload: [String: Any] = [
            "phoneActiveWorkoutId": "phone-run",
            "phoneActiveWorkoutStartedAt": ref.timeIntervalSinceReferenceDate,
        ]
        let (id, stampedAt) = PhoneSync.parsePhoneActiveWorkout(from: payload)
        #expect(id == "phone-run")
        #expect(stampedAt == ref)
    }

    @MainActor @Test func missingKeyIsReadAsAbsentNotAsUnchanged() {
        let (id, stampedAt) = PhoneSync.parsePhoneActiveWorkout(from: [:])
        #expect(id == nil)
        #expect(stampedAt == nil)
    }

    @MainActor @Test func idWithoutATimestampKeyStillParsesTheId() {
        let (id, stampedAt) = PhoneSync.parsePhoneActiveWorkout(from: ["phoneActiveWorkoutId": "phone-run"])
        #expect(id == "phone-run")
        #expect(stampedAt == nil)
    }

    @MainActor @Test func wrongTypedValuesAreTreatedAsAbsent() {
        let (id, stampedAt) = PhoneSync.parsePhoneActiveWorkout(from: [
            "phoneActiveWorkoutId": 42,
            "phoneActiveWorkoutStartedAt": "not-a-number",
        ])
        #expect(id == nil)
        #expect(stampedAt == nil)
    }
}
