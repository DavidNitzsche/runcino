//
//  HRAlerterArmingTests.swift
//  The phone's HR alarm is armed by the PLAN, or not at all.
//

import XCTest
@testable import Faff

/// HR-SEMANTICS-2 (2026-09-01).
///
/// `HRAlerter` had never fired for anyone: `configure(enabled:ceiling:)` had no
/// call site, so `ceilingBpm` was a `UserDefaults` value nothing ever wrote.
/// C-12 fixed three real defects inside it (it alarmed at 0.95 × the ceiling
/// while claiming the ceiling; it watched every heart-rate sample the watch had
/// ever written, desk and staircase included; one sample was enough) — and the
/// fixed code still could not run, because nothing armed it.
///
/// It is armed now, from ONE number: `WatchWorkout.hrCeilingBpm`, which
/// `lib/watch/build-workout.ts#resolveHrCeiling` emits for easy and long
/// sessions only and suppresses on a long run carrying an HM/M finish. That
/// resolver already answers the question this alarm must never get wrong —
/// WHEN a ceiling applies — so the decision below spends its answer rather
/// than writing a second one.
///
/// WHAT THESE TESTS CANNOT FAIL ON (Rule 22):
///
///   · They exercise the arming DECISION, not HealthKit. That a
///     `HKObserverQuery` actually fires, that background delivery is granted,
///     and that the sustain window behaves on a real wrist are unproven here —
///     `start()` needs a device and an entitlement this build does not carry.
///   · They cannot see the call sites. `WatchSync.pushTodayToWatch` supplying
///     the ceiling and `ProfileView` supplying the toggle are asserted by the
///     wire-source test below, which reads them, because a pure function
///     nobody calls is exactly the failure this file exists to close.
final class HRAlerterArmingTests: XCTestCase {

    /// An easy day carries a ceiling, and the alarm watches THAT number —
    /// not 95% of it, which is what it used to alarm at while telling the
    /// runner he was over the ceiling itself.
    func testAnEasyDayArmsAtItsOwnCeiling() {
        XCTAssertEqual(HRAlerter.armedCeiling(toggleOn: true, workoutHrCeilingBpm: 151), 151)
    }

    /// THE ONE THAT MATTERS. A quality session sends no ceiling, because the
    /// runner is supposed to be well above any easy-day line for the whole
    /// work block. An alarm that fired here would be buzzing at a runner for
    /// executing the session correctly.
    func testAQualityDayDoesNotArmAtAll() {
        XCTAssertNil(HRAlerter.armedCeiling(toggleOn: true, workoutHrCeilingBpm: nil))
    }

    /// Same for a race and for a long run with a race-pace finish: the server
    /// suppresses the ceiling on both, and nil must disarm rather than fall
    /// back to a stored number.
    func testASuppressedCeilingDisarmsRatherThanReusingAStoredOne() {
        XCTAssertNil(HRAlerter.armedCeiling(toggleOn: true, workoutHrCeilingBpm: nil))
        XCTAssertNil(HRAlerter.armedCeiling(toggleOn: true, workoutHrCeilingBpm: 0))
    }

    /// The toggle is a veto, not a source. It can only switch off an alarm the
    /// plan already armed.
    func testTheToggleOffSilencesAnArmedDay() {
        XCTAssertNil(HRAlerter.armedCeiling(toggleOn: false, workoutHrCeilingBpm: 151))
    }

    /// A toggle on and no ceiling is still silence — the two conditions are
    /// AND, and the old code had neither.
    func testToggleAloneIsNotEnough() {
        XCTAssertNil(HRAlerter.armedCeiling(toggleOn: false, workoutHrCeilingBpm: nil))
    }

    /// `applyTodaysCeiling` REPLACES the ceiling every refresh, including with
    /// nil. The defect it prevents: yesterday's easy-day 151 left watching
    /// today's threshold session.
    @MainActor
    func testTodaysCeilingReplacesYesterdays() {
        let a = HRAlerter.shared
        a.configure(enabled: false, ceiling: 151)
        XCTAssertEqual(a.ceilingBpm, 151)
        a.applyTodaysCeiling(nil)
        XCTAssertNil(a.ceilingBpm, "a quality day must clear the ceiling, not keep the last one")
        XCTAssertNil(UserDefaults.standard.object(forKey: "faff.phone_hr_ceiling"))
        a.applyTodaysCeiling(148)
        XCTAssertEqual(a.ceilingBpm, 148)
        a.configure(enabled: false, ceiling: nil)
    }

    /// RULE 20 · the wiring itself, because a pure decision nobody calls is
    /// the exact shape of the bug this replaces. Reads the two call sites.
    func testTheAlarmIsActuallyWired() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()   // FaffTests
            .deletingLastPathComponent()   // Faff
        let sync = try String(contentsOf: root.appendingPathComponent("Faff/WatchSync.swift"), encoding: .utf8)
        XCTAssertTrue(sync.contains("HRAlerter.shared.applyTodaysCeiling"),
                      "today's ceiling must reach the alarm from the one place that holds the prescription")
        XCTAssertTrue(sync.contains("hrCeilingBpm"),
                      "and it must be the plan's own ceiling, not a second derivation")
        let profile = try String(contentsOf: root.appendingPathComponent("Faff/Views/ProfileView.swift"), encoding: .utf8)
        XCTAssertTrue(profile.contains("HRAlerter.shared.configure(enabled:"),
                      "the settings toggle must reach the alarm; it used to write the server and stop")
    }
}
