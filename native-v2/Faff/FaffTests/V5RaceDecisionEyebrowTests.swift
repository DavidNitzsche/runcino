//
//  V5RaceDecisionEyebrowTests.swift
//  The "Needs a decision" eyebrow drew unconditionally on RaceDecisionCardV5,
//  regardless of `card.shape`. A `.fact` card (course changed, chip-time
//  lock) and a `.choice` card (two A races conflicting) both said "NEEDS A
//  DECISION" even though nothing about the goal was being decided — the one
//  place this file's own doc comment ("switched on `shape` — never on
//  `verdict`") was NOT actually applied, while the target tiles and the
//  answer-button style right below it were already correctly gated.
//
//  `V5CardShape.raceDecisionEyebrow` is the single resolver both the view and
//  this test call, so there is exactly one place this decision is made.
//
//  ─────────────────────────────────────────────────────────────────────────
//  WHAT THIS TEST CANNOT FAIL ON (Rule 22)
//
//  · Whether the CHOSEN COPY is the best possible wording — it pins the three
//    values against regressing to the pre-fix "always decision" bug, not
//    against a copy-review opinion.
//  · Whether the eyebrow actually RENDERS on screen — only a rendered
//    screenshot answers that (Rule 13); this is the logic that feeds it.
//  · Any other card in the app. This is scoped to `V5CardShape` only.
//

import XCTest
@testable import Faff

final class V5RaceDecisionEyebrowTests: XCTestCase {

    /// The one shape that IS a decision about the goal keeps the original copy.
    func testDecisionShapeNeedsADecision() {
        XCTAssertEqual(V5CardShape.decision.raceDecisionEyebrow, "Needs a decision")
    }

    /// `.fact` covers three real triggers (heat, course changed, chip-time
    /// lock) and none of them is a decision about the goal — the defect this
    /// test exists to pin down.
    func testFactShapeIsNotLabelledADecision() {
        XCTAssertNotEqual(V5CardShape.fact.raceDecisionEyebrow, "Needs a decision")
        XCTAssertEqual(V5CardShape.fact.raceDecisionEyebrow, "Worth knowing")
    }

    /// `.choice` (two A races conflicting) is not a decision the ENGINE makes
    /// either — same bug, same fix.
    func testChoiceShapeIsNotLabelledADecision() {
        XCTAssertNotEqual(V5CardShape.choice.raceDecisionEyebrow, "Needs a decision")
        XCTAssertEqual(V5CardShape.choice.raceDecisionEyebrow, "Choose one")
    }

    /// All three of `RacesV5Sample`'s fact/choice fixtures decode to the shape
    /// this file assumes they do, so the eyebrow they resolve to on the real
    /// preview screens matches what these unit assertions check.
    func testSampleFixturesCarryTheShapesThisTestAssumes() {
        XCTAssertEqual(RacesV5Sample.decode("course").card?.shape, .fact)
        XCTAssertEqual(RacesV5Sample.decode("lock").card?.shape, .fact)
        XCTAssertEqual(RacesV5Sample.decode("races").card?.shape, .choice)
        XCTAssertEqual(RacesV5Sample.decode("ahead").card?.shape, .decision)
    }
}
