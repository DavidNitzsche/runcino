//
//  V5RaceStatsColumnsTests.swift
//  An unset goal is not an unreadable one.
//

import XCTest
@testable import Faff

final class V5RaceStatsColumnsTests: XCTestCase {

    /// All three columns of race detail's Goal / Projected / Gap plate
    /// rendered through `unreadableIfAbsent`, which turns nil into
    /// `FaffValue.unreadable` — a FAULT RED dash that VoiceOver reads as
    /// "could not be read".
    ///
    /// The add-a-race sheet calls a goal time "Optional" in as many words, so
    /// a race entered without one drew two red dashes claiming a data failure
    /// that never happened. Fault red is defined as "we could not read this
    /// value" and "never used to render a real value"; rule three is the same
    /// idea in the other direction — a designed absence must not wear the
    /// outage's clothes. Seen on screen 8e.
    func testARaceWithNoGoalDrawsNoGoalOrGapColumn() {
        let cols = RaceDetailV5.showsColumns(goal: nil, middle: "3:31:48", gap: nil)
        XCTAssertFalse(cols.goal)
        XCTAssertFalse(cols.gap)
        XCTAssertTrue(cols.middle)
        XCTAssertTrue(cols.any, "there is still a projection to show")
    }

    /// The ordinary case is untouched.
    func testAGoalRaceStillDrawsAllThree() {
        let cols = RaceDetailV5.showsColumns(goal: "3:30:00", middle: "3:31:48", gap: "+1:48")
        XCTAssertTrue(cols.goal)
        XCTAssertTrue(cols.middle)
        XCTAssertTrue(cols.gap)
        XCTAssertTrue(cols.any)
    }

    /// A past race with no result logged: a goal, and nothing to compare it
    /// to. The plate still draws, with the one column that means something.
    func testAPastRaceWithNoResultKeepsTheGoalOnly() {
        let cols = RaceDetailV5.showsColumns(goal: "1:38:00", middle: nil, gap: nil)
        XCTAssertTrue(cols.goal)
        XCTAssertFalse(cols.middle)
        XCTAssertFalse(cols.gap)
        XCTAssertTrue(cols.any)
    }

    /// Nothing at all to say: the plate does not draw an empty tile.
    func testNothingToShowDrawsNoPlate() {
        XCTAssertFalse(RaceDetailV5.showsColumns(goal: nil, middle: nil, gap: nil).any)
    }

    /// An empty string is absence, not a value. The route sends null, but a
    /// `V5Number` carrying "" would otherwise draw a labelled blank.
    func testEmptyStringsCountAsAbsent() {
        XCTAssertFalse(RaceDetailV5.showsColumns(goal: "", middle: "", gap: "").any)
    }
}
